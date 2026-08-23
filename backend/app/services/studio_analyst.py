"""
Answering questions about the finance data.

The pipeline is fixed and deterministic:

    question → spec (model) → validate → compile → run → explain (model)

The model appears twice and writes no SQL in either place. First it maps a
question onto the registry in studio_data.py; then it reads the numbers back in
prose. Everything between those two points is code that can be tested without a
model in the loop, which is what makes the risky half reviewable.

Nothing here is an agent loop. There is no tool calling anywhere in this
codebase and every model in the cascade is on a free tier, where multi-step
loops are unreliable and rate-limited. A fixed pipeline gives up flexibility and
buys back a bounded number of model calls per question and a path that fails in
ways you can name.
"""

from __future__ import annotations

import json
import logging
import re
import time

from ..db.postgres import get_pool
from . import studio_data
from .openrouter import _try_chat

logger = logging.getLogger("fintrack.studio.analyst")

# An aggregate over mirrored tables should be milliseconds. This is a guard
# against a pathological plan, not a normal-path budget — the pool is shared
# with the rest of the app and a slow analytical query starves dashboard traffic.
QUERY_TIMEOUT_MS = 8000


def _system_prompt() -> str:
    return (
        "You translate a question about business data into a JSON query spec.\n\n"
        "Return ONLY a JSON object with these keys:\n"
        '  dataset    — one of the dataset names below\n'
        '  metric     — one metric key from that dataset\n'
        '  dimensions — list of 0-2 dimension keys to group by (empty for a single total)\n'
        '  period     — one period key\n'
        '  sort       — metric_desc | metric_asc | dimension_asc | dimension_desc\n'
        '  limit      — integer, at most 200\n'
        '  chart      — bar | line | pie | table\n\n'
        "Rules:\n"
        "- Use ONLY the keys listed below. Never invent a metric, dimension or period.\n"
        "- Group by month or quarter when the question is about a trend, and chart it as a line.\n"
        "- Use pie only for a share-of-total question with one dimension.\n"
        "- No dimensions means one number, which is right for 'what is my total ...'.\n"
        "- If the question cannot be answered with these keys, return "
        '{"error": "<short reason>"} instead of guessing.\n\n'
        "AVAILABLE:\n" + studio_data.describe_for_model()
    )


# Reasoning traces are stripped before the JSON is looked for. Several models in
# the free cascade emit them even with reasoning excluded, and their contents are
# full of braces.
_THINK_BLOCK = re.compile(r"<(think|thinking|reasoning)>.*?</\1>", re.DOTALL | re.IGNORECASE)

# Keys that mark a candidate object as the spec rather than some other object
# the model happened to write on the way there.
_SPEC_KEYS = frozenset({"dataset", "metric", "error"})


def _json_candidates(text: str):
    """
    Yield every balanced {...} span in `text`, outermost first, left to right.

    The previous implementation was a single greedy `\\{.*\\}`, which spans from
    the first brace in the response to the last. That works only when the JSON
    is the sole braced thing present. It is not: models narrate ("the metric key
    is {total_outstanding}"), show an example spec before the real one, append a
    closing note, or emit a reasoning trace — and in every one of those cases the
    greedy span swallowed prose and failed to parse, producing "I could not turn
    that into a query" for a question the model had in fact answered correctly.

    Brace counting is string-aware, so a brace inside a JSON string value does
    not throw off the depth.
    """
    depth = 0
    start = -1
    in_string = False
    escaped = False

    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth:
                depth -= 1
                if depth == 0 and start != -1:
                    yield text[start:i + 1]
                    start = -1


def parse_spec(raw: str) -> dict:
    """
    Pull the spec out of whatever the model wrapped it in.

    Free models add prose, code fences and reasoning despite instructions, so
    the JSON is located rather than assumed to be the whole response. Candidates
    are tried in order and the first one that both parses and looks like a spec
    wins — an example object the model wrote before its real answer is skipped
    rather than being mistaken for it.
    """
    text = _THINK_BLOCK.sub(" ", (raw or "").strip())
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text.strip()).strip()

    fallback: dict | None = None
    for candidate in _json_candidates(text):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        if _SPEC_KEYS & parsed.keys():
            return parsed
        # Parsed, but carries none of the keys that identify a spec. Keep it in
        # case nothing better turns up, so a model that renames a key still gets
        # a specific validation error from build() instead of this generic one.
        if fallback is None:
            fallback = parsed

    if fallback is not None:
        return fallback

    logger.warning("analyst: no spec JSON in model response: %r", (raw or "")[:400])
    raise studio_data.SpecError(
        "I could not turn that into a query. Try naming the measure and the "
        "grouping directly — for example, \"total outstanding by project\"."
    )


def format_value(value, unit: str) -> str:
    """Render a number the way the app already writes them, so the prose matches
    the chart beside it."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if unit == "currency":
        return f"Rs {number:,.0f}"
    if unit == "percent":
        return f"{number:,.1f}%"
    if unit == "days":
        return f"{number:,.0f} days"
    return f"{number:,.0f}"


async def run_query(compiled: studio_data.CompiledQuery) -> list[dict]:
    """Execute a compiled query under a statement timeout."""
    pool = get_pool()
    if not pool:
        raise RuntimeError("The database is unavailable.")

    async with pool.acquire() as conn:
        # SET LOCAL must be inside the transaction — outside one it is a no-op
        # that Postgres only warns about, so the timeout would silently not
        # apply. Scoping it this way is also what stops the guard leaking onto
        # the next borrower of this pooled connection.
        async with conn.transaction():
            await conn.execute(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS}")
            rows = await conn.fetch(compiled.sql, *compiled.params)
    return [dict(r) for r in rows]


def _rows_for_model(compiled: studio_data.CompiledQuery, rows: list[dict]) -> str:
    """A compact table for the explaining call — the numbers, not the schema."""
    if not rows:
        return "(no rows)"
    lines = [" | ".join(compiled.columns)]
    for row in rows[:40]:
        cells = []
        for col in compiled.columns:
            value = row.get(col)
            cells.append(format_value(value, compiled.metric.unit) if col == "value" else str(value))
        lines.append(" | ".join(cells))
    return "\n".join(lines)


_EXPLAIN = (
    "You are reading a result table from a finance system and explaining it.\n"
    "- State what the numbers show in two or three sentences. No preamble.\n"
    "- Quote the figures exactly as they appear. Never recompute or round them.\n"
    "- Name the largest and smallest entries when there is a ranking, and say "
    "something about the shape of the distribution if it is notable.\n"
    "- Do not speculate about causes. The table is all you know.\n"
    "- If the table is empty, say plainly that nothing matched the filters."
)


async def analyze(question: str, owner_email: str | None) -> dict:
    """
    Answer a data question.

    Returns {answer, spec, rows, columns, chart, sql, latency_ms, ...}. The SQL
    is returned deliberately: an answer about money that cannot be checked is
    not much better than a guess, and the compiled statement is the only
    complete account of what was actually asked.
    """
    question = (question or "").strip()
    if not question:
        raise ValueError("A question is required.")
    if len(question) > 2000:
        raise ValueError("That question is too long — try asking it more directly.")

    started = time.time()

    spec_result = await _try_chat(
        [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": question},
        ],
        max_tokens=400,
        temperature=0.1,   # this is a mapping task, not a creative one
        extract=False,
    )
    spec = parse_spec(spec_result.get("content", ""))

    if spec.get("error"):
        raise studio_data.SpecError(
            f"{spec['error']} I can answer questions about "
            f"{', '.join(studio_data.DATASETS)}."
        )

    compiled = studio_data.build(spec, owner_email)
    rows = await run_query(compiled)

    if rows:
        explain = await _try_chat(
            [
                {"role": "system", "content": _EXPLAIN},
                {"role": "system", "content":
                    f"Question: {question}\n"
                    f"Measure: {compiled.metric.label}\n"
                    f"Results:\n{_rows_for_model(compiled, rows)}"},
                {"role": "user", "content": question},
            ],
            max_tokens=500,
            temperature=0.3,
            extract=False,
        )
        answer = (explain.get("content") or "").strip()
        model = explain.get("model_short") or explain.get("model", "")
    else:
        # No second model call for an empty result. There is nothing to
        # interpret, and the honest sentence is cheaper and more accurate than
        # anything a model would write about zero rows.
        answer = (
            f"No {compiled.dataset.label.lower()} matched that query"
            + (f" for {compiled.period.replace('_', ' ')}" if compiled.period != "all_time" else "")
            + "."
        )
        model = spec_result.get("model_short") or spec_result.get("model", "")

    return {
        "answer": answer,
        "kind": "data",
        "chart": compiled.chart,
        "columns": compiled.columns,
        "rows": [
            {k: (float(v) if k == "value" and v is not None else v) for k, v in row.items()}
            for row in rows
        ],
        "unit": compiled.metric.unit,
        "metric_label": compiled.metric.label,
        "dataset_label": compiled.dataset.label,
        "dimension_labels": [d.label for d in compiled.dimensions],
        "period": compiled.period,
        "spec": spec,
        "sql": compiled.sql,
        "scoped": bool(owner_email),
        "model": model,
        "latency_ms": int((time.time() - started) * 1000),
    }
