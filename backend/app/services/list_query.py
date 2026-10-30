"""
The pieces every server-side list shares: invoices, web invoices, projects.

A list request is the same shape on every page — a search, some filters, a
whitelisted sort, a keyset cursor and totals — so the parts that do not
depend on the table live here once:

  * QueryError, the 400 every builder raises on input it does not know;
  * SqlParams, which numbers bound values ($1, $2…) so no value is ever
    written into SQL text;
  * like_pattern, a search word as a LIKE operand with its wildcards escaped;
  * the cursor codec: an opaque, tamper-checked (sort, order, key, id);
  * grouping helpers that turn GROUPING SETS rows, or plain Python rows run
    through the same measure definitions, into {group: {key: measures}}.
"""
from __future__ import annotations

import base64
import binascii
import json
import math
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

TOP_CHAR = "\U0010ffff"   # sorts after any text, in Python and under COLLATE "C"


class QueryError(ValueError):
    """A request the endpoint refuses (400)."""


class SqlParams:
    """Bound values of one statement. $1 = now, $2 = today (UTC), $3 = tz offset."""

    def __init__(self, now: datetime, tz: int):
        self.values: list[Any] = [now, now.astimezone(timezone.utc).date(), tz]

    def add(self, value: Any) -> str:
        self.values.append(value)
        return f"${len(self.values)}"


# Every statement names $1-$3 once, so Postgres knows their types even when a
# query has no other use for them.
PARAMS_PREAMBLE = "($1::timestamptz, $2::date, $3::int) IS NOT NULL"


def like_pattern(token: str) -> str:
    return "%" + token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def clean_text(value: Optional[str], name: str, maxlen: int = 255) -> Optional[str]:
    if value is None:
        return None
    value = str(value)
    if len(value) > maxlen:
        raise QueryError(f"{name} is too long")
    return value or None


# ── Cursor ─────────────────────────────────────────────────────────────────

def encode_cursor(sort: str, order: str, key: Any, record_id: str) -> str:
    if isinstance(key, float) and math.isinf(key):
        key = "+inf" if key > 0 else "-inf"
        kind = "inf"
    else:
        kind = "f" if isinstance(key, (int, float)) else "s"
    raw = json.dumps({"s": sort, "o": order, "t": kind, "k": key, "i": record_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(sort: str, order: str, text_sort: bool, cursor: str) -> tuple[Any, str]:
    """(key, record id) of a cursor made for this sort and order; QueryError otherwise."""
    try:
        if len(cursor) > 2000:
            raise ValueError
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise QueryError("invalid cursor") from None
    if data.get("s") != sort or data.get("o") != order:
        raise QueryError("cursor belongs to a different sort")
    rid, kind, key = data.get("i"), data.get("t"), data.get("k")
    if not isinstance(rid, str) or not 0 < len(rid) <= 60:
        raise QueryError("invalid cursor")
    if kind == "s" and text_sort and isinstance(key, str) and len(key) <= 1000:
        return key, rid
    if kind == "f" and not text_sort and isinstance(key, (int, float)) and not isinstance(key, bool):
        return float(key), rid
    if kind == "inf" and not text_sort and key in ("+inf", "-inf"):
        return (math.inf if key == "+inf" else -math.inf), rid
    raise QueryError("invalid cursor")


def keyset_sql(key: str, text_sort: bool, desc: bool, p: SqlParams, cursor: tuple[Any, str]) -> str:
    """The row-value comparison that starts a page after `cursor`."""
    cast = "::text" if text_sort else "::double precision"
    cmp = "<" if desc else ">"
    return f'({key}, teable_id COLLATE "C") {cmp} ({p.add(cursor[0])}{cast}, {p.add(cursor[1])}::text)'


def py_keyset_page(keyed: list[tuple[Any, str, dict]], desc: bool, *, limit: int,
                   cursor: Optional[tuple[Any, str]] = None, offset: int = 0):
    """keyset_sql over (sort key, id, record) triples already in memory."""
    keyed = sorted(keyed, key=lambda t: (t[0], t[1]), reverse=desc)
    if cursor is not None:
        ck = (cursor[0], cursor[1])
        keyed = [t for t in keyed if ((t[0], t[1]) < ck if desc else (t[0], t[1]) > ck)]
    else:
        keyed = keyed[offset:]
    page = keyed[:limit]
    more = len(keyed) > limit
    nxt = (page[-1][0], page[-1][1]) if more and page else None
    return [t[2] for t in page], nxt


# ── Grouping ───────────────────────────────────────────────────────────────

Measures = list[tuple[str, str, Callable[[dict], float]]]


def grouping_sql(base: str, measures: Measures, groups: Iterable[str]) -> str:
    """One pass over `base` (a SELECT) that totals every measure per group and overall."""
    groups = list(groups)
    sums = ",\n          ".join(f"sum({expr})::float8 AS {name}" for name, expr, _ in measures)
    sets = ", ".join(["()"] + [f"({g})" for g in groups])
    keys = ", ".join(groups)
    return f"""
        WITH base AS ({base})
        SELECT GROUPING({keys}) AS g, {keys},
          {sums}
        FROM base
        GROUP BY GROUPING SETS ({sets})
    """


def group_rows_from_sql(rows, groups: list[str], measures: Measures) -> dict[str, dict[Any, dict]]:
    """{group name or "total": {key: {measure: value}}} from the GROUPING SETS rows."""
    out: dict[str, dict[Any, dict]] = {"total": {None: {name: 0.0 for name, _, _ in measures}}}
    for g in groups:
        out[g] = {}
    width = len(groups)
    for row in rows:
        mask = row["g"]
        values = {name: float(row[name] or 0) for name, _, _ in measures}
        if mask == (1 << width) - 1:
            out["total"][None] = values
            continue
        for i, g in enumerate(groups):
            if not mask & (1 << (width - 1 - i)):
                out[g][row[g]] = values
                break
    return out


def group_rows_py(rows: list[dict], groups: Iterable[str], measures: Measures) -> dict[str, dict[Any, dict]]:
    """group_rows_from_sql, computed over Python rows with the same measures."""
    groups = list(groups)
    out: dict[str, dict[Any, dict]] = {"total": {None: {name: 0.0 for name, _, _ in measures}}}
    for g in groups:
        out[g] = {}
    for r in rows:
        contrib = {name: float(fn(r)) for name, _, fn in measures}
        targets = [out["total"][None]]
        for g in groups:
            targets.append(out[g].setdefault(r[g], {name: 0.0 for name, _, _ in measures}))
        for t in targets:
            for k, v in contrib.items():
                t[k] += v
    return out


def r2(x: Any) -> float:
    return round(float(x or 0), 2)
