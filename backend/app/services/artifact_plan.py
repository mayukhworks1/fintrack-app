"""
The plan step before an artifact is built.

"Make a to-do list organiser" leaves most of what matters unsaid: who uses it,
whether people share the same list, which features count, how it should look.
Building straight from the sentence means the model guesses all of it, and a
wrong guess costs a full build. So a quick, cheap call first proposes a plan —
a title, a one-line summary, the features it would build (pre-selected, all
editable) and two to four targeted questions with sensible defaults — and the
person confirms or adjusts it in a few clicks. Their choices are folded into
the build prompt by the client.

The plan is a convenience, never a gate. It has a short time limit, and if
the model is slow, refuses, or returns something unusable, the response says
`fallback` and the client builds straight from the prompt as before.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from . import artifact, artifact_design
from .openrouter import _prompt_for, _try_chat

logger = logging.getLogger("fintrack.artifact_plan")

TASK = "artifact_plan"
TIMEOUT_S = 15.0
MAX_TOKENS = 1200
MAX_PROMPT_CHARS = 4000

MIN_FEATURES, MAX_FEATURES = 3, 8
MAX_QUESTIONS = 4
MAX_OPTIONS = 5

PLAN_SYSTEM = """You plan small interactive web apps before they are built. \
Someone has described an app in a sentence. Propose a plan they can confirm in a \
few clicks: what you would build, and the few questions whose answers would most \
change the result.

The app can be anything: a calculator, to-do list, CRM, booking page, poll, quiz, \
habit tracker, inventory, a landing page with a sign-up list, a small game. It runs \
as one HTML file, and can keep data in a cloud database either shared by everyone \
with the link or private to each person.

Return ONLY a JSON object, no markdown fences, no commentary:
{
  "title": "short product-like name, 2-5 words",
  "summary": "1-2 sentences: what it does and for whom",
  "features": ["5-8 concrete features the best app of this kind has, each under 70 characters"],
  "questions": [
    {"id": "kebab-case-id", "question": "short question", "options": ["2-5 short options"],
     "multi": false, "default": "one of the options"}
  ]
}

Rules:
- Features are specific ("Filter by All / Active / Done with counts"), not vague \
("Good UX"). When the app keeps data, include the data features too: saving to \
the cloud so it is there on every visit, sharing one list between everyone with \
the link where that fits, and who can add or edit.
- 2-4 questions, each one that genuinely changes what gets built. Never ask about \
visual style or colours; that is offered separately.
- When the app keeps data, ALWAYS include these two questions:
  {"id": "data-sharing", "question": "Should everyone with the link see the same data?", \
"options": ["Yes, one shared set of data", "No, each person has their own"], ...}
  {"id": "who-edits", "question": "Who can add or edit?", \
"options": ["Anyone with the link", "Only me", "Anyone can add, only I can edit"], ...}
  choosing defaults that suit the app (a poll or sign-up list is shared; a personal \
budget is private).
- Add one or two questions specific to the domain (for a to-do list: due dates and \
priorities? for a quiz: how many questions? for a booking page: what is booked?).
- "default" is one of the options; for "multi": true it is a list of options.
- Plain, friendly words. Indian context where money or dates are involved."""

_EXAMPLE_PROMPT = "make a to do list organiser"
_EXAMPLE_RESPONSE = json.dumps({
    "title": "Task Organiser",
    "summary": "A clean to-do list for planning your day: add tasks fast, set due dates "
               "and priorities, and clear what's done.",
    "features": [
        "Add tasks with Enter, edit inline, delete with undo",
        "Filter All / Active / Done with live counts",
        "Due dates with overdue tasks flagged",
        "Priority levels shown as badges",
        "Drag to reorder, or Alt+Up/Down",
        "Clear completed in one click",
        "Saved to the cloud, there on every visit",
    ],
    "questions": [
        {"id": "data-sharing", "question": "Should everyone with the link see the same data?",
         "options": ["Yes, one shared list", "No, each person has their own"],
         "multi": False, "default": "No, each person has their own"},
        {"id": "who-edits", "question": "Who can add or edit?",
         "options": ["Anyone with the link", "Only me", "Anyone can add, only I can edit"],
         "multi": False, "default": "Only me"},
        {"id": "organise", "question": "How should tasks be organised?",
         "options": ["One simple list", "Projects or lists", "Today / Upcoming / Someday"],
         "multi": False, "default": "One simple list"},
    ],
})


# --- JSON repair ------------------------------------------------------------------

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")
_SMART = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


def _balanced_object(text: str) -> str | None:
    """The first {...} in `text`, closing whatever a cut-off answer left open."""
    start = text.find("{")
    if start == -1:
        return None
    stack: list[str] = []
    in_str = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if stack:
                stack.pop()
            if not stack:
                return text[start:i + 1]
    # Truncated: close the open string and brackets, dropping a dangling key or comma.
    tail = text[start:]
    if in_str:
        tail += '"'
    tail = re.sub(r'[,:]\s*$', "", tail.rstrip())
    tail = re.sub(r',\s*"[^"]*"\s*$', "", tail)
    return tail + "".join(reversed(stack))


def parse_plan_json(raw: str) -> dict | None:
    """
    Best-effort parse of a model's plan: strips fences and prose around the
    object, straightens smart quotes, drops trailing commas and closes an
    answer that was cut off. None when nothing usable is there.
    """
    text = _FENCE.sub("", (raw or "").strip()).translate(_SMART)
    candidates = [text]
    obj = _balanced_object(text)
    if obj:
        candidates.append(obj)
    for cand in candidates:
        for attempt in (cand, _TRAILING_COMMA.sub(r"\1", cand)):
            try:
                parsed = json.loads(attempt)
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(parsed, dict):
                return parsed
    return None


# --- normalising -------------------------------------------------------------------

def _text(value: Any, limit: int) -> str:
    if isinstance(value, dict):
        value = value.get("label") or value.get("name") or value.get("text") or ""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit].rstrip()


def _features(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = [part for part in re.split(r"[\n;]+", raw)]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = _text(item, 90).lstrip("-•* ").strip()
        if text and text.lower() not in seen:
            seen.add(text.lower())
            out.append(text)
        if len(out) >= MAX_FEATURES:
            break
    return out


def _slug(text: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]
    return slug or fallback


def _questions(raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    ids: set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        question = _text(item.get("question") or item.get("text"), 160)
        if not question:
            continue
        options = item.get("options")
        if isinstance(options, str):
            options = options.split(",")
        if not isinstance(options, list):
            continue
        opts: list[str] = []
        for o in options:
            t = _text(o, 60)
            if t and t not in opts:
                opts.append(t)
        opts = opts[:MAX_OPTIONS]
        if len(opts) < 2:
            continue
        qid = _slug(str(item.get("id") or question), f"q{index + 1}")
        # Style is offered as its own row with real directions behind it.
        if qid in ("style", "theme", "visual-style", "look") or "style" in qid:
            continue
        if qid in ids:
            continue
        ids.add(qid)
        multi = bool(item.get("multi")) or str(item.get("type", "")).lower() == "multi"
        default = item.get("default")
        if multi:
            wanted = default if isinstance(default, list) else [default]
            chosen = [o for o in opts if o in wanted]
            default_value: Any = chosen or [opts[0]]
        else:
            default_value = default if isinstance(default, str) and default in opts else opts[0]
        out.append({"id": qid, "question": question, "options": opts,
                    "multi": multi, "default": default_value})
        if len(out) >= MAX_QUESTIONS:
            break
    return out


def _fallback_title(prompt: str) -> str:
    words = re.sub(r"^(please\s+)?(make|build|create|design)\s+(me\s+)?(an?\s+|the\s+)?",
                   "", prompt.strip(), flags=re.IGNORECASE).split()
    return " ".join(words[:5]).strip(" .").capitalize() or "New app"


def normalise_plan(parsed: dict, prompt: str) -> dict | None:
    """A plan the client can render, or None when the model's was unusable."""
    features = _features(parsed.get("features"))
    questions = _questions(parsed.get("questions"))
    if len(features) < MIN_FEATURES and not questions:
        return None
    direction = artifact_design.pick(prompt)
    return {
        "fallback": False,
        "title": _text(parsed.get("title"), 60) or _fallback_title(prompt),
        "summary": _text(parsed.get("summary"), 300),
        "features": features,
        "questions": questions,
        "style_options": artifact_design.style_options(),
        "style_default": direction.key,
    }


def fallback(reason: str) -> dict:
    """Build straight from the prompt; `reason` is for logs and tests, not people."""
    return {"fallback": True, "reason": reason}


# --- entry point ---------------------------------------------------------------------

async def plan_artifact(prompt: str, content_type: str = artifact.CONTENT_TYPE) -> dict:
    """
    Propose a plan for an artifact. Raises ValueError for a request the caller
    must fix; any failure of the model itself returns a fallback instead.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError(f"Prompt is too long (max {MAX_PROMPT_CHARS} characters).")
    if content_type != artifact.CONTENT_TYPE:
        raise ValueError("Planning is available for artifacts only.")

    try:
        system = await _prompt_for(TASK, PLAN_SYSTEM)
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": _EXAMPLE_PROMPT},
            {"role": "assistant", "content": _EXAMPLE_RESPONSE},
            {"role": "user", "content": prompt},
        ]
        result = await asyncio.wait_for(
            _try_chat(messages, max_tokens=MAX_TOKENS, temperature=0.3, extract=False,
                      task=TASK, budget_s=TIMEOUT_S),
            timeout=TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        return fallback("timeout")
    except Exception as exc:  # refused, no provider, every model failed
        logger.info("artifact plan fell back: %s", exc)
        return fallback("unavailable")

    parsed = parse_plan_json(result.get("content", ""))
    if parsed is None:
        return fallback("unparseable")
    plan = normalise_plan(parsed, prompt)
    return plan if plan is not None else fallback("empty")
