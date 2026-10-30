"""
Server-side project list: search, filters, sort, keyset paging and totals.

The Projects page polled GET /api/projects every five seconds and the summary
every ten, and sent its search to Teable's full-text search (20 results at
most, blind to the page's filters). GET /api/projects/query answers one page
plus the totals of the filtered scope and of the whole portfolio from
projects_mirror's generated columns (migration 0010), with an ETag so an
unchanged poll is a bodiless 304.

The totals are the KPI cards' and the signals panel's: what
TeableService._compute_summary adds up, plus the page's own "needs action"
and "blind spot" rules, which used to run in the browser over whatever 100
projects the list happened to return. Each rule is written once as SQL and
once as Python (the Teable fallback and the tests' reference).
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

from ..models import resolve_status
from .invoice_common import cell_text, project_matches_search, search_tokens
from .list_query import (
    PARAMS_PREAMBLE,
    TOP_CHAR,
    QueryError,
    SqlParams,
    clean_text,
    decode_cursor as _decode_cursor,
    encode_cursor as _encode_cursor,
    group_rows_from_sql,
    group_rows_py,
    grouping_sql,
    keyset_sql,
    like_pattern,
    py_keyset_page,
    r2,
)

logger = logging.getLogger("fintrack.project_query")

DEFAULT_LIMIT = 48
MAX_LIMIT = 200
ACTION_QUEUE = 4

# Sortable columns: field name -> (kind, mirror column). Anything else is refused.
SORTS: dict[str, tuple[str, str]] = {
    "Amount Billed So far": ("num", "billed_amount"),
    "Profit percentage":    ("num", "profit_percent"),
    "Target Revenue":       ("num", "target_revenue"),
    "Actual Profit":        ("num", "profit_amount"),
    "Project Name":         ("text", "project_name"),
    "Client":               ("text", "client"),
}


@dataclass
class ProjectQuery:
    q: str = ""
    status: Optional[str] = None
    client: Optional[str] = None
    sort: str = "Amount Billed So far"
    order: str = "desc"

    @property
    def tokens(self) -> list[str]:
        return search_tokens(self.q)

    @property
    def filtered(self) -> bool:
        return bool(self.tokens or self.status or self.client)

    def filter_key(self) -> str:
        return json.dumps([self.tokens, self.status, self.client], separators=(",", ":"))


def build_project_query(*, q: Optional[str] = None, status: Optional[str] = None, client: Optional[str] = None,
                        sort: Optional[str] = None, order: Optional[str] = None) -> ProjectQuery:
    """Validate request parameters; QueryError on anything unknown."""
    if q is not None and len(q) > 200:
        raise QueryError("q is too long")
    sort = sort or "Amount Billed So far"
    if sort not in SORTS:
        raise QueryError(f"cannot sort by {sort[:60]}")
    order = (order or "desc").lower()
    if order not in ("asc", "desc"):
        raise QueryError("order must be asc or desc")
    status = clean_text(status, "status")
    return ProjectQuery(
        q=(q or "").strip(),
        # "active", "on hold"… name the Teable options, as GET /api/projects reads them.
        status=resolve_status(status) if status else None,
        client=clean_text(client, "client"),
        sort=sort, order=order,
    )


def encode_cursor(qry: ProjectQuery, key: Any, record_id: str) -> str:
    return _encode_cursor(qry.sort, qry.order, key, record_id)


def decode_cursor(qry: ProjectQuery, cursor: str) -> tuple[Any, str]:
    return _decode_cursor(qry.sort, qry.order, SORTS[qry.sort][0] == "text", cursor)


# ── The page's rules, SQL and Python ───────────────────────────────────────
# A project needs action when it loses money or its health is Critical
# (rank 3) or At Risk (rank 2); a blind spot has neither health nor status.

_RANK_SQL = ("(CASE WHEN COALESCE(profit_percent, 0) < 0 OR health = 'Critical' THEN 3 "
             "WHEN health = 'At Risk' THEN 2 ELSE 0 END)")


def _amount(value: Any) -> Optional[float]:
    """ft_inv_num in Python."""
    from .invoice_query import _num
    return _num(value)


def py_rank(f: dict) -> int:
    health = cell_text(f.get("Health"))
    if (_amount(f.get("Profit percentage")) or 0) < 0 or health == "Critical":
        return 3
    return 2 if health == "At Risk" else 0


def _status_col(f: dict) -> Optional[str]:
    """db.sync._extract_project's status / client / project_name columns."""
    return str(f.get("Project Status", "") or "")[:80] or None


def _text_col(f: dict, key: str) -> Optional[str]:
    return str(f.get(key, "") or "")[:255] or None


MEASURES: list[tuple[str, str, Callable[[dict], float]]] = [
    ("n", "1", lambda r: 1),
    ("billed", "billed", lambda r: r["billed"]),
    ("profit", "profit", lambda r: r["profit"]),
    ("input", "input", lambda r: r["input"]),
    ("overhead", "overhead", lambda r: r["overhead"]),
    ("pct_sum", "COALESCE(pct, 0)", lambda r: r["pct"] or 0.0),
    ("pct_n", "CASE WHEN pct IS NULL THEN 0 ELSE 1 END", lambda r: r["pct"] is not None),
    ("target", "CASE WHEN target THEN 1 ELSE 0 END", lambda r: bool(r["target"])),
    ("needs", "CASE WHEN rank > 0 THEN 1 ELSE 0 END", lambda r: r["rank"] > 0),
    ("blind", "CASE WHEN blind THEN 1 ELSE 0 END", lambda r: r["blind"]),
]
GROUPS = ("status_k", "client_k", "health_k")


def _base_sql(where: str) -> str:
    return f"""
        SELECT
          COALESCE(billed_amount, 0)::float8 AS billed,
          COALESCE(profit_amount, 0)::float8 AS profit,
          COALESCE(input_cost, 0)::float8 AS input,
          COALESCE(overhead_cost, 0)::float8 AS overhead,
          profit_percent::float8 AS pct,
          target_achieved AS target,
          {_RANK_SQL} AS rank,
          (health IS NULL AND status IS NULL) AS blind,
          COALESCE(status, 'Unknown') AS status_k,
          COALESCE(client, 'Unknown') AS client_k,
          COALESCE(health, 'Unknown') AS health_k
        FROM projects_mirror
        WHERE {where}
    """


def _py_row(record: dict) -> dict:
    f = record.get("fields") or {}
    health = cell_text(f.get("Health"))
    status = _status_col(f)
    return {
        "billed": _amount(f.get("Amount Billed So far")) or 0.0,
        "profit": _amount(f.get("Actual Profit")) or 0.0,
        "input": _amount(f.get("Input cost so far")) or 0.0,
        "overhead": _amount(f.get("Total Overhead Cost")) or 0.0,
        "pct": _amount(f.get("Profit percentage")),
        "target": _truthy(f.get("Target Achieved ")),
        "rank": py_rank(f),
        "blind": health is None and status is None,
        "status_k": status or "Unknown",
        "client_k": _text_col(f, "Client") or "Unknown",
        "health_k": health or "Unknown",
    }


def _truthy(v: Any) -> bool:
    """ft_truthy in Python."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, (str, list, dict)):
        return len(v) > 0
    return False


def where_sql(qry: ProjectQuery, p: SqlParams) -> str:
    w = [PARAMS_PREAMBLE, "deleted_at IS NULL"]
    for tok in qry.tokens:
        w.append(f"search_text LIKE {p.add(like_pattern(tok))}")
    if qry.status:
        w.append(f"status = {p.add(qry.status)}")
    if qry.client:
        w.append(f"client = {p.add(qry.client)}")
    return " AND ".join(w)


def py_matches(record: dict, qry: ProjectQuery) -> bool:
    f = record.get("fields") or {}
    if qry.status and _status_col(f) != qry.status:
        return False
    if qry.client and _text_col(f, "Client") != qry.client:
        return False
    return project_matches_search(f, qry.q)


def _sort_key_sql(qry: ProjectQuery) -> str:
    kind, col = SORTS[qry.sort]
    desc = qry.order == "desc"
    if kind == "num":
        return f"COALESCE(({col})::double precision, '{'-' if desc else ''}Infinity'::double precision)"
    sentinel = "''" if desc else "U&'\\+10FFFF'"
    return f'(COALESCE(lower({col}), {sentinel}) COLLATE "C")'


def py_sort_key(qry: ProjectQuery, record: dict) -> Any:
    kind, _ = SORTS[qry.sort]
    desc = qry.order == "desc"
    f = record.get("fields") or {}
    if kind == "num":
        val = _amount(f.get(qry.sort))
        return val if val is not None else (-math.inf if desc else math.inf)
    text = _text_col(f, qry.sort)
    return text.lower() if text is not None else ("" if desc else TOP_CHAR)


def _order_sql(qry: ProjectQuery) -> str:
    direction = "DESC" if qry.order == "desc" else "ASC"
    return f'{_sort_key_sql(qry)} {direction}, teable_id COLLATE "C" {direction}'


# ── Shaping ────────────────────────────────────────────────────────────────

def _label(f: dict) -> str:
    return f"{f.get('Client', '?')} / {f.get('Project Name', '?')}"


def shape(groups: dict, extras: dict, *, workspace: bool = False) -> dict:
    m = groups["total"][None]
    billed, profit = m["billed"], m["profit"]
    out = {
        "count": int(m["n"]),
        "total_billed": r2(billed),
        "total_profit": r2(profit),
        "total_input_cost": r2(m["input"]),
        "total_overhead": r2(m["overhead"]),
        "total_cost": r2(m["input"] + m["overhead"]),
        "avg_profit_pct": r2(m["pct_sum"] / m["pct_n"]) if m["pct_n"] else 0.0,
        "margin": round(profit / billed * 100, 2) if billed > 0 else 0.0,
        "target_achieved_count": int(m["target"]),
        "needs_action": int(m["needs"]),
        "blind_spots": int(m["blind"]),
        "by_status": {k: int(v["n"]) for k, v in sorted(groups["status_k"].items(), key=lambda kv: (-kv[1]["n"], kv[0]))},
        "by_client": {k: int(v["n"]) for k, v in sorted(groups["client_k"].items(), key=lambda kv: (-kv[1]["n"], kv[0]))},
        "by_health": {k: int(v["n"]) for k, v in sorted(groups["health_k"].items(), key=lambda kv: (-kv[1]["n"], kv[0]))},
        "client_billed": {k: r2(v["billed"]) for k, v in sorted(groups["client_k"].items())},
        "client_profit": {k: r2(v["profit"]) for k, v in sorted(groups["client_k"].items())},
        **extras,
    }
    if workspace:
        out["facets"] = {
            "clients": sorted(k for k in groups["client_k"] if k != "Unknown"),
            "statuses": sorted(k for k in groups["status_k"] if k != "Unknown"),
        }
    return out


def _entry(record_id: str, f: dict, **more) -> dict:
    return {"id": record_id, "name": f.get("Project Name") or "", "client": f.get("Client") or "",
            "health": f.get("Health") or "", **more}


# ── Python execution (Teable fallback, and the tests' reference) ───────────

def _py_extras(records: list[dict], qry: ProjectQuery) -> dict:
    """The lists beside the totals: the action queue in list order, the
    largest billed exposure, and the best and worst margins."""
    ordered, _ = py_page(records, qry, limit=len(records) + 1)
    queue = sorted((r for r in ordered if py_rank(r.get("fields") or {}) > 0),
                   key=lambda r: -py_rank(r.get("fields") or {}))[:ACTION_QUEUE]
    by_billed = sorted(records, key=lambda r: (-(_amount((r.get("fields") or {}).get("Amount Billed So far")) or 0.0),
                                               str(r.get("id"))))
    pcts = [(v, str(r.get("id")), r) for r in records
            if (v := _amount((r.get("fields") or {}).get("Profit percentage"))) is not None]
    best = min(pcts, key=lambda t: (-t[0], t[1]), default=None)
    worst = min(pcts, key=lambda t: (t[0], t[1]), default=None)
    return {
        "action_queue": [_entry(r["id"], r.get("fields") or {}, rank=py_rank(r.get("fields") or {})) for r in queue],
        "highest_exposure": _entry(by_billed[0]["id"], by_billed[0].get("fields") or {},
                                   billed=r2(_amount(by_billed[0]["fields"].get("Amount Billed So far")) or 0))
        if by_billed else None,
        "best_project": {"name": _label(best[2]["fields"]), "pct": round(best[0], 2)} if best else
        {"name": None, "pct": None},
        "worst_project": {"name": _label(worst[2]["fields"]), "pct": round(worst[0], 2)} if worst else
        {"name": None, "pct": None},
    }


def py_aggregates(records: list[dict], qry: ProjectQuery, *, workspace: bool = False) -> dict:
    groups = group_rows_py([_py_row(r) for r in records], GROUPS, MEASURES)
    return shape(groups, _py_extras(records, qry), workspace=workspace)


def py_page(records: list[dict], qry: ProjectQuery, *, limit: int,
            cursor: Optional[tuple[Any, str]] = None, offset: int = 0):
    keyed = [(py_sort_key(qry, r), str(r.get("id") or ""), r) for r in records]
    return py_keyset_page(keyed, qry.order == "desc", limit=limit, cursor=cursor, offset=offset)


def query_records(records: list[dict], qry: ProjectQuery, *, limit: int, cursor: Optional[tuple[Any, str]],
                  offset: int, aggregates: bool) -> dict:
    records = [{"id": r.get("id"), "fields": dict(r.get("fields") or {})} for r in records if r.get("id")]
    matched = [r for r in records if py_matches(r, qry)]
    page, nxt = py_page(matched, qry, limit=limit, cursor=cursor, offset=offset)
    out: dict[str, Any] = {"records": page, "next": nxt, "total": len(matched)}
    if aggregates:
        ws = py_aggregates(records, ProjectQuery(sort=qry.sort, order=qry.order), workspace=True)
        scope = py_aggregates(matched, qry) if qry.filtered else scope_of(ws)
        out.update(aggregates=scope, workspace=ws)
    return out


def scope_of(ws: dict) -> dict:
    return {k: v for k, v in ws.items() if k != "facets"}


# ── SQL execution ──────────────────────────────────────────────────────────

_TTL_WORKSPACE = 15
_TTL_SCOPE = 10


def _fields_of(row) -> dict:
    raw = row["fields"]
    return raw if isinstance(raw, dict) else json.loads(raw or "{}")


def _page_sql(qry: ProjectQuery, where: str, p: SqlParams, cursor: Optional[tuple[Any, str]],
              limit: int, offset: int) -> str:
    key = _sort_key_sql(qry)
    if cursor is not None:
        where += " AND " + keyset_sql(key, SORTS[qry.sort][0] == "text", qry.order == "desc", p, cursor)
        offset = 0
    return (f"SELECT teable_id, fields, {key} AS sort_key FROM projects_mirror WHERE {where} "
            f"ORDER BY {_order_sql(qry)} LIMIT {int(limit) + 1} OFFSET {int(offset)}")


async def _sql_aggregates(pool, qry: ProjectQuery, now: datetime, *, workspace: bool) -> dict:
    from ..utils.cache import cache

    key = f"project:q:{'ws' if workspace else 'scope'}:{qry.sort}:{qry.order}:{'' if workspace else qry.filter_key()}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    p = SqlParams(now, 0)
    where = where_sql(qry, p)
    rows = await pool.fetch(grouping_sql(_base_sql(where), MEASURES, GROUPS), *p.values)
    groups = group_rows_from_sql(rows, list(GROUPS), MEASURES)
    queue = await pool.fetch(
        f"SELECT teable_id, fields, {_RANK_SQL} AS rank FROM projects_mirror WHERE {where} AND {_RANK_SQL} > 0 "
        f"ORDER BY {_RANK_SQL} DESC, {_order_sql(qry)} LIMIT {ACTION_QUEUE}", *p.values)
    top = await pool.fetchrow(
        f"SELECT teable_id, fields, COALESCE(billed_amount, 0)::float8 AS billed FROM projects_mirror WHERE {where} "
        f'ORDER BY COALESCE(billed_amount, 0) DESC, teable_id COLLATE "C" ASC LIMIT 1', *p.values)
    best = await pool.fetchrow(
        f"SELECT fields, profit_percent::float8 AS pct FROM projects_mirror WHERE {where} AND profit_percent IS NOT NULL "
        f'ORDER BY profit_percent DESC, teable_id COLLATE "C" ASC LIMIT 1', *p.values)
    worst = await pool.fetchrow(
        f"SELECT fields, profit_percent::float8 AS pct FROM projects_mirror WHERE {where} AND profit_percent IS NOT NULL "
        f'ORDER BY profit_percent ASC, teable_id COLLATE "C" ASC LIMIT 1', *p.values)
    extras = {
        "action_queue": [_entry(r["teable_id"], _fields_of(r), rank=int(r["rank"])) for r in queue],
        "highest_exposure": _entry(top["teable_id"], _fields_of(top), billed=r2(top["billed"])) if top else None,
        "best_project": {"name": _label(_fields_of(best)), "pct": round(best["pct"], 2)} if best else
        {"name": None, "pct": None},
        "worst_project": {"name": _label(_fields_of(worst)), "pct": round(worst["pct"], 2)} if worst else
        {"name": None, "pct": None},
    }
    out = shape(groups, extras, workspace=workspace)
    cache.set(key, out, ttl=_TTL_WORKSPACE if workspace else _TTL_SCOPE)
    return out


async def query_mirror(pool, qry: ProjectQuery, *, limit: int, cursor: Optional[tuple[Any, str]], offset: int,
                       aggregates: bool, now: datetime) -> Optional[dict]:
    """The query against projects_mirror, or None when the mirror holds no projects yet."""
    p = SqlParams(now, 0)
    where = where_sql(qry, p)
    rows = await pool.fetch(_page_sql(qry, where, p, cursor, limit, offset), *p.values)
    more = len(rows) > limit
    rows = rows[:limit]
    out: dict[str, Any] = {
        "records": [{"id": r["teable_id"], "fields": _fields_of(r)} for r in rows],
        "next": (lambda k: (k if isinstance(k, str) else float(k), rows[-1]["teable_id"]))(rows[-1]["sort_key"])
        if more and rows else None,
    }
    if aggregates:
        ws = await _sql_aggregates(pool, ProjectQuery(sort=qry.sort, order=qry.order), now, workspace=True)
        scope = await _sql_aggregates(pool, qry, now, workspace=False) if qry.filtered else scope_of(ws)
        out.update(aggregates=scope, workspace=ws, total=scope["count"])
    else:
        cp = SqlParams(now, 0)
        out["total"] = int(await pool.fetchval(f"SELECT count(*) FROM projects_mirror WHERE {where_sql(qry, cp)}",
                                               *cp.values))
    if out["total"] == 0 and not out["records"]:
        if not await pool.fetchval("SELECT EXISTS (SELECT 1 FROM projects_mirror WHERE deleted_at IS NULL)"):
            return None
    return out
