"""
Insight cards for the phone screens: a few plain-language findings, each with
one tap to the list that shows them, plus the small series the summary cards
draw (cash in over six complete months, pending invoices by age).

Every card is a fixed rule over figures the mirrors already hold, so the same
data always gives the same cards:

  overdue_45         pending invoices raised more than 45 days ago
  gst_due            GSTR-3B for last month, due on the 20th of this month
                     (GST on the INR invoices raised in that month, the Tax
                     Ledger's own arithmetic)
  followups_due      invoices whose next follow-up is today or earlier
  slow_payer         the client whose paid invoices (last 12 months, three or
                     more) took longest past the 30-day overdue mark
  collections_trend  last month's cash in against the month before, when it
                     moved 5% or more
  project_loss       projects with a negative profit percentage
  projects_at_risk   projects marked At Risk or Critical that are not losing money

Figures come from invoices_mirror / projects_mirror in a couple of grouped
statements (never row by row to the browser); when a mirror cannot answer, the
same facts are worked out in Python over the records the Teable fallback
loads. The facts are cached briefly under the invoice and project cache
namespaces, so the writes and syncs that bust those lists bust these too.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

from . import invoice_query as iq
from .list_query import SqlParams

SCOPES = ("dashboard", "invoices", "projects", "tax")
SCOPE_RULES: dict[str, tuple[str, ...]] = {
    "dashboard": ("overdue_45", "gst_due", "followups_due", "project_loss", "slow_payer",
                  "projects_at_risk", "collections_trend"),
    "invoices": ("overdue_45", "followups_due", "slow_payer", "collections_trend"),
    "projects": ("project_loss", "projects_at_risk"),
    "tax": ("gst_due",),
}
INVOICE_RULES = {"overdue_45", "gst_due", "followups_due", "slow_payer", "collections_trend"}
PROJECT_RULES = {"project_loss", "projects_at_risk"}
CHART_SCOPES = ("dashboard", "invoices")

MAX_CARDS = 5
OVERDUE_DAYS = 30           # the list's own overdue rule (aggregates.overdue_count)
LONG_OVERDUE_DAYS = 45
GST_DUE_DAY = 20            # GSTR-3B: the 20th of the month after the tax period
SLOW_PAYER_MIN_INVOICES = 3
SLOW_PAYER_MIN_LATE_DAYS = 7
PAYER_WINDOW_DAYS = 365
TREND_MIN_PCT = 5.0
CASH_MONTHS = 6
AGING_BUCKETS = (("0-30", "0–30", 0, 30), ("31-60", "31–60", 31, 60), ("61-90", "61–90", 61, 90),
                 ("90+", "90+", 91, None))
_TTL = 30
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ── Indian formats ─────────────────────────────────────────────────────────

def format_inr(amount: float) -> str:
    """₹ with en-IN grouping, whole rupees: 465600 -> ₹4,65,600; 1234567.8 -> ₹12,34,568."""
    value = int(math.floor(abs(float(amount or 0)) + 0.5))
    digits = str(value)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return f"{'-' if amount and float(amount) < 0 and value else ''}₹{digits}"


def format_day(d: date) -> str:
    """DD MMM: 20 Nov, 05 Dec."""
    return f"{d.day:02d} {_MONTHS[d.month - 1]}"


def month_label(key: str) -> str:
    """'2026-10' -> 'Oct'."""
    return _MONTHS[int(key[5:7]) - 1]


def plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n:,} {one if n == 1 else (many or one + 's')}"


# ── Calendar ───────────────────────────────────────────────────────────────

def local_today(now: datetime, tz: int) -> date:
    return (now.astimezone(timezone.utc) + timedelta(minutes=tz)).date()


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def add_months(d: date, n: int) -> date:
    idx = d.year * 12 + (d.month - 1) + n
    return date(idx // 12, idx % 12 + 1, 1)


def gst_return(today: date) -> dict:
    """The GSTR-3B return due next: last month's, on the 20th of this month.
    After the 20th that return is past and this month's is not yet complete,
    so the next one is this month's, due on the 20th of next month."""
    if today.day <= GST_DUE_DAY:
        period = add_months(today, -1)
        due = date(today.year, today.month, GST_DUE_DAY)
    else:
        period = date(today.year, today.month, 1)
        nxt = add_months(today, 1)
        due = date(nxt.year, nxt.month, GST_DUE_DAY)
    return {"period": month_key(period), "due": due, "days_left": (due - today).days}


def cash_months(today: date) -> list[str]:
    """The last CASH_MONTHS complete months, oldest first (this month is not over yet)."""
    return [month_key(add_months(today, -i)) for i in range(CASH_MONTHS, 0, -1)]


def _bucket(aging: float) -> str:
    for key, _, lo, hi in AGING_BUCKETS:
        if hi is None or aging <= hi:
            return key
    return AGING_BUCKETS[-1][0]


# ── Facts: Python (the Teable fallback, and the tests' reference) ──────────

def _empty_invoice_facts(today: date) -> dict:
    return {
        "today": today.isoformat(),
        "aging": {k: {"count": 0, "amount": 0.0} for k, *_ in AGING_BUCKETS},
        "overdue45": {"count": 0, "amount": 0.0},
        "followups": 0,
        "cash": {k: 0.0 for k in cash_months(today)},
        "payers": [],
        "gst": None,
    }


def invoice_facts_py(records: list[dict], now: datetime, tz: int = 0, owner: Optional[str] = None,
                     *, with_gst: bool = True) -> dict:
    from ..db.sync import _parse_date

    today = local_today(now, tz)
    out = _empty_invoice_facts(today)
    if owner:
        owner_lc = owner.lower()
        records = [r for r in records if str((r.get("fields") or {}).get("Raised By", "")).lower() == owner_lc]
    payers: dict[str, list[int]] = {}
    since = now.astimezone(timezone.utc).date() - timedelta(days=PAYER_WINDOW_DAYS)
    for rec in records:
        row = iq._row(rec, now, tz)
        f = row["fields"]
        st = row["st"]
        if st == "Pending":
            b = out["aging"][_bucket(row["aging"])]
            b["count"] += 1
            b["amount"] += row["raised"]
            if row["aging"] > LONG_OVERDUE_DAYS:
                out["overdue45"]["count"] += 1
                out["overdue45"]["amount"] += row["raised"]
        if row["fday"] is not None and row["fday"] <= row["_today"]:
            out["followups"] += 1
        if row["cmonth"] in out["cash"]:
            out["cash"][row["cmonth"]] += row["rec"] if row["rec"] != 0 else row["raised"]
        raised_d, cleared_d = _parse_date(f.get("Raised Date")), _parse_date(f.get("Cleared Date"))
        if (st == "Paid" and row["client"] and raised_d and cleared_d and cleared_d >= raised_d
                and cleared_d >= since):
            payers.setdefault(row["client"], []).append((cleared_d - raised_d).days)
    out["payers"] = sorted(
        ({"client": c, "count": len(d), "avg_days": sum(d) / len(d)} for c, d in payers.items()
         if len(d) >= SLOW_PAYER_MIN_INVOICES),
        key=lambda p: (-p["avg_days"], p["client"]))
    if with_gst:
        ret = gst_return(today)
        qry = iq.build_query(tax_scope="all", period=f"m-{ret['period']}", tz=tz)
        tax = iq.py_tax(iq.py_filter(records, qry, None, now), qry, now)
        out["gst"] = _gst_fact(ret, tax)
    return _rounded(out)


def _gst_fact(ret: dict, tax: dict) -> dict:
    return {"period": ret["period"], "due": ret["due"].isoformat(), "days_left": ret["days_left"],
            "gst": tax["paid"]["gst"] + tax["open"]["gst"],
            "count": tax["paid"]["count"] + tax["open"]["count"]}


def _rounded(out: dict) -> dict:
    for b in out["aging"].values():
        b["amount"] = round(b["amount"], 2)
    out["overdue45"]["amount"] = round(out["overdue45"]["amount"], 2)
    out["cash"] = {k: round(v, 2) for k, v in out["cash"].items()}
    for p in out["payers"]:
        p["avg_days"] = round(p["avg_days"], 2)
    if out["gst"]:
        out["gst"]["gst"] = round(out["gst"]["gst"], 2)
    return out


def _project_text(f: dict, key: str) -> str:
    return str(f.get(key) or "").strip()


def project_facts_py(records: list[dict]) -> dict:
    from .project_query import _amount

    loss, risk = [], []
    for r in records:
        f = r.get("fields") or {}
        pct = _amount(f.get("Profit percentage"))
        entry = {"id": r.get("id"), "name": _project_text(f, "Project Name"), "client": _project_text(f, "Client"),
                 "pct": round(pct, 2) if pct is not None else None,
                 "profit": round(_amount(f.get("Actual Profit")) or 0.0, 2)}
        health = _project_text(f, "Health")
        if (pct or 0) < 0:
            loss.append(entry)
        elif health in ("At Risk", "Critical"):
            risk.append({**entry, "health": health})
    return {"loss": sorted(loss, key=lambda e: (e["pct"], str(e["id"]))),
            "risk": sorted(risk, key=lambda e: (e["health"] != "Critical", str(e["id"])))}


# ── Facts: SQL over the mirrors ────────────────────────────────────────────

def invoice_facts_sql_text(where: str, p: SqlParams, today: date, since: date,
                           src: iq.Source = iq.INVOICES) -> str:
    first, since = p.add(cash_months(today)[0]), p.add(since)
    return f"""
        WITH b AS (
          SELECT payment_status AS st,
            COALESCE(amount_raised, 0)::float8 AS raised,
            COALESCE(amount_received, 0)::float8 AS rec,
            client_name AS client, raised_date, cleared_date,
            {iq._utc_day('followup_at')} AS fday,
            {iq.AGING_SQL} AS aging,
            {iq._local_month('cleared_at')} AS cmonth
          FROM {src.table}
          WHERE {where}
        )
        SELECT 'aging' AS kind,
          CASE WHEN aging <= 30 THEN '0-30' WHEN aging <= 60 THEN '31-60' WHEN aging <= 90 THEN '61-90'
               ELSE '90+' END AS key,
          count(*)::int AS n, sum(raised)::float8 AS amount
        FROM b WHERE st = 'Pending' GROUP BY 2
        UNION ALL
        SELECT 'overdue45', NULL, count(*)::int, COALESCE(sum(raised), 0)::float8
        FROM b WHERE st = 'Pending' AND aging > {LONG_OVERDUE_DAYS}
        UNION ALL
        SELECT 'followups', NULL, count(*)::int, 0::float8 FROM b WHERE fday IS NOT NULL AND fday <= $2::date
        UNION ALL
        SELECT 'cash', cmonth, count(*)::int, sum(CASE WHEN rec <> 0 THEN rec ELSE raised END)::float8
        FROM b WHERE cmonth >= {first}::text GROUP BY cmonth
        UNION ALL
        SELECT 'payer', client, count(*)::int, avg(cleared_date - raised_date)::float8
        FROM b
        WHERE st = 'Paid' AND client IS NOT NULL AND raised_date IS NOT NULL AND cleared_date IS NOT NULL
          AND cleared_date >= raised_date AND cleared_date >= {since}::date
        GROUP BY client HAVING count(*) >= {SLOW_PAYER_MIN_INVOICES}
    """


async def invoice_facts_sql(pool, now: datetime, tz: int = 0, owner: Optional[str] = None,
                            *, with_gst: bool = True) -> Optional[dict]:
    """The facts from invoices_mirror, or None when the mirror holds no invoices yet."""
    if not await pool.fetchval("SELECT EXISTS (SELECT 1 FROM invoices_mirror WHERE deleted_at IS NULL)"):
        return None
    today = local_today(now, tz)
    p = SqlParams(now, tz)
    where = iq.where_sql(iq.InvoiceQuery(tz=tz), owner, p)
    since = now.astimezone(timezone.utc).date() - timedelta(days=PAYER_WINDOW_DAYS)
    sql = invoice_facts_sql_text(where, p, today, since)
    rows = await pool.fetch(sql, *p.values)
    out = _empty_invoice_facts(today)
    payers = []
    for r in rows:
        kind, key, n, amount = r["kind"], r["key"], int(r["n"] or 0), float(r["amount"] or 0)
        if kind == "aging":
            out["aging"][key] = {"count": n, "amount": amount}
        elif kind == "overdue45":
            out["overdue45"] = {"count": n, "amount": amount}
        elif kind == "followups":
            out["followups"] = n
        elif kind == "cash" and key in out["cash"]:
            out["cash"][key] = amount
        elif kind == "payer":
            payers.append({"client": key, "count": n, "avg_days": amount})
    out["payers"] = sorted(payers, key=lambda x: (-x["avg_days"], x["client"]))
    if with_gst:
        ret = gst_return(today)
        qry = iq.build_query(tax_scope="all", period=f"m-{ret['period']}", tz=tz)
        tp = SqlParams(now, tz)
        tax_rows = await pool.fetch(iq.tax_sql(iq.where_sql(qry, owner, tp)), *tp.values)
        out["gst"] = _gst_fact(ret, iq.shape_tax(iq._tax_rows_from_sql(tax_rows)))
    return _rounded(out)


async def project_facts_sql(pool) -> Optional[dict]:
    if not await pool.fetchval("SELECT EXISTS (SELECT 1 FROM projects_mirror WHERE deleted_at IS NULL)"):
        return None
    rows = await pool.fetch(
        "SELECT teable_id AS id, fields FROM projects_mirror WHERE deleted_at IS NULL "
        "AND (COALESCE(profit_percent, 0) < 0 OR health IN ('At Risk', 'Critical'))")
    return project_facts_py([{"id": r["id"], "fields": iq._fields_of(r)} for r in rows])


# ── Rules ──────────────────────────────────────────────────────────────────

def _href(path: str, **params) -> str:
    params = {k: v for k, v in params.items() if v not in (None, "")}
    return f"{path}?{urlencode(params)}" if params else path


def _card(rule: str, score: float, tone: str, title: str, *, value: Optional[str] = None,
          detail: Optional[str] = None, action: Optional[dict] = None, subject: str = "") -> dict:
    return {"id": f"{rule}:{subject}" if subject else rule, "rule": rule, "score": round(score, 3), "tone": tone,
            "title": title, "value": value, "detail": detail, "action": action}


def _weight(amount: float) -> float:
    """A small nudge by size, so a larger sum of the same kind ranks first."""
    return min(4.0, math.log10(max(1.0, float(amount or 0))) / 2)


def rule_overdue_45(f: dict) -> Optional[dict]:
    o = f["overdue45"]
    if o["count"] <= 0:
        return None
    today = date.fromisoformat(f["today"])
    cutoff = today - timedelta(days=LONG_OVERDUE_DAYS + 1)
    return _card(
        "overdue_45", 90 + _weight(o["amount"]), "negative",
        f"{plural(o['count'], 'invoice')} overdue over {LONG_OVERDUE_DAYS} days",
        value=format_inr(o["amount"]),
        detail=f"Raised on or before {format_day(cutoff)} and still pending",
        action={"label": "Review", "href": _href("/invoices", status="Pending", to=cutoff.isoformat())},
    )


def rule_gst_due(f: dict) -> Optional[dict]:
    g = f.get("gst")
    if not g or g["gst"] <= 0:
        return None
    due = date.fromisoformat(g["due"])
    days = g["days_left"]
    when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
    score = 95 if days <= 3 else (85 if days <= 7 else 60)
    return _card(
        "gst_due", score + _weight(g["gst"]), "warning" if days <= 7 else "info",
        f"GST due {format_day(due)}",
        value=format_inr(g["gst"]),
        detail=f"GSTR-3B for {month_label(g['period'])} {g['period'][:4]} · {when} · "
               f"{plural(g['count'], 'invoice')} raised",
        action={"label": "Open ledger", "href": _href("/tax", period=f"m-{g['period']}", scope="all")},
        subject=g["period"],
    )


def rule_followups_due(f: dict) -> Optional[dict]:
    n = f["followups"]
    if n <= 0:
        return None
    return _card(
        "followups_due", 80 + min(4.0, n / 5), "warning",
        f"{plural(n, 'follow-up')} due",
        detail="Next follow-up is today or earlier",
        action={"label": "Open", "href": _href("/invoices", followup="1")},
    )


def rule_slow_payer(f: dict) -> Optional[dict]:
    for p in f["payers"]:
        late = p["avg_days"] - OVERDUE_DAYS
        if late >= SLOW_PAYER_MIN_LATE_DAYS:
            days = int(round(late))
            return _card(
                "slow_payer", 55 + min(4.0, late / 15), "info",
                f"{p['client']} pays {plural(days, 'day')} late on average",
                detail=f"{round(p['avg_days'])} days to pay against the {OVERDUE_DAYS}-day mark · "
                       f"{plural(p['count'], 'paid invoice')} in the last 12 months",
                action={"label": "See invoices", "href": _href("/invoices", client=p["client"])},
                subject=p["client"],
            )
    return None


def rule_collections_trend(f: dict) -> Optional[dict]:
    keys = list(f["cash"])
    if len(keys) < 2:
        return None
    last, before = keys[-1], keys[-2]  # the last complete month and the one before it
    a, b = f["cash"][last], f["cash"][before]
    if a <= 0 or b <= 0:
        return None
    change = (a - b) / b * 100
    if abs(change) < TREND_MIN_PCT:
        return None
    up = change > 0
    first, end = date.fromisoformat(f"{last}-01"), add_months(date.fromisoformat(f"{last}-01"), 1) - timedelta(days=1)
    return _card(
        "collections_trend", (30 if up else 45) + min(4.0, abs(change) / 25), "positive" if up else "warning",
        f"Collections {'up' if up else 'down'} {round(abs(change))}% vs last month",
        value=format_inr(a),
        detail=f"{month_label(last)}: {format_inr(a)} in · {month_label(before)}: {format_inr(b)}",
        action={"label": "See payments", "href": _href(
            "/invoices", status="Paid", date_field="Cleared Date", **{"from": first.isoformat(), "to": end.isoformat()})},
        subject=last,
    )


def rule_project_loss(f: dict) -> Optional[dict]:
    loss = f["loss"]
    if not loss:
        return None
    one = len(loss) == 1
    title = f"{plural(len(loss), 'project')} running at a loss"
    detail = (f"{loss[0]['name'] or 'Untitled'}" + (f" · {loss[0]['client']}" if loss[0]["client"] else "")
              + (f" · {loss[0]['pct']:g}% margin" if loss[0]["pct"] is not None else "")) if one else \
        f"Worst: {loss[0]['name'] or 'Untitled'} at {loss[0]['pct']:g}% margin"
    href = _href("/projects", q=loss[0]["name"]) if one and loss[0]["name"] else \
        _href("/projects", sort="Profit percentage", order="asc")
    return _card("project_loss", 75 + min(4.0, len(loss)), "negative", title, detail=detail,
                 action={"label": "Review", "href": href})


def rule_projects_at_risk(f: dict) -> Optional[dict]:
    risk = f["risk"]
    if not risk:
        return None
    critical = sum(1 for r in risk if r["health"] == "Critical")
    one = len(risk) == 1
    return _card(
        "projects_at_risk", 50 + min(4.0, len(risk) + critical), "warning",
        f"{plural(len(risk), 'project')} {'is' if one else 'are'} at risk",
        detail=(f"{risk[0]['name'] or 'Untitled'} · {risk[0]['health']}" if one
                else f"{critical} critical · {len(risk) - critical} at risk"),
        action={"label": "Review", "href": _href("/projects", q=risk[0]["name"]) if one and risk[0]["name"]
                else _href("/projects", sort="Profit percentage", order="asc")},
    )


RULES = {
    "overdue_45": rule_overdue_45,
    "gst_due": rule_gst_due,
    "followups_due": rule_followups_due,
    "slow_payer": rule_slow_payer,
    "collections_trend": rule_collections_trend,
    "project_loss": rule_project_loss,
    "projects_at_risk": rule_projects_at_risk,
}


def rank(cards: list[dict]) -> list[dict]:
    return sorted(cards, key=lambda c: (-c["score"], c["id"]))


def build_cards(scope: str, inv: Optional[dict], prj: Optional[dict], *, limit: int = MAX_CARDS) -> list[dict]:
    cards = []
    for rule in SCOPE_RULES[scope]:
        facts = inv if rule in INVOICE_RULES else prj
        if facts is None:
            continue
        card = RULES[rule](facts)
        if card:
            cards.append(card)
    return rank(cards)[:limit]


def build_charts(inv: Optional[dict], tz: int = 0) -> Optional[dict]:
    """The summary cards' series: cash in for six months, pending by age (each
    bucket with the list link that shows it)."""
    if inv is None:
        return None
    today = date.fromisoformat(inv["today"])

    def bucket_href(lo: int, hi: Optional[int]) -> str:
        newest = today - timedelta(days=lo) if lo else None
        oldest = today - timedelta(days=hi) if hi is not None else None
        return _href("/invoices", status="Pending", **{
            "from": oldest.isoformat() if oldest else None,
            "to": newest.isoformat() if newest else None,
        })

    return {
        "cash_in": [{"key": k, "label": month_label(k), "amount": v} for k, v in inv["cash"].items()],
        "aging": [{"key": key, "label": label, "count": inv["aging"][key]["count"],
                   "amount": inv["aging"][key]["amount"], "href": bucket_href(lo, hi)}
                  for key, label, lo, hi in AGING_BUCKETS],
    }


def respond(scope: str, inv: Optional[dict], prj: Optional[dict], *, tz: int = 0) -> dict:
    out: dict[str, Any] = {"scope": scope, "cards": build_cards(scope, inv, prj)}
    if scope in CHART_SCOPES:
        out["charts"] = build_charts(inv, tz)
    if inv is not None:
        out["today"] = inv["today"]
    return out


# ── Cached facts ───────────────────────────────────────────────────────────

def _today_key(now: datetime) -> str:
    return now.astimezone(timezone.utc).date().isoformat()


async def cached_invoice_facts(pool, now: datetime, tz: int, owner: Optional[str], *, with_gst: bool,
                               load_records) -> dict:
    """Invoice facts, under the invoice cache namespace (busted by every invoice write and sync)."""
    from ..utils.cache import cache

    key = f"{iq.INVOICES.cache}ins:{(owner or '*').lower()}:{tz}:{int(with_gst)}:{_today_key(now)}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    facts = None
    if pool is not None:
        try:
            facts = await invoice_facts_sql(pool, now, tz, owner, with_gst=with_gst)
        except Exception:
            facts = None
    if facts is None:
        facts = invoice_facts_py(await load_records(), now, tz, owner, with_gst=with_gst)
    cache.set(key, facts, ttl=_TTL)
    return facts


async def cached_project_facts(pool, now: datetime, *, load_records) -> dict:
    """Project facts, under the project cache namespace."""
    from ..utils.cache import cache

    key = f"project:ins:{_today_key(now)}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    facts = None
    if pool is not None:
        try:
            facts = await project_facts_sql(pool)
        except Exception:
            facts = None
    if facts is None:
        facts = project_facts_py(await load_records())
    cache.set(key, facts, ttl=_TTL)
    return facts
