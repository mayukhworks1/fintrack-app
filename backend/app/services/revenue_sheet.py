"""
A project revenue spreadsheet filled from the workspace's own data: one row per
project with what was billed, received and is outstanding (from the invoices
mirror), its costs (from the projects mirror) and its latest status line (from
the status mirror). Profit, margin and the totals row are spreadsheet formulas,
so the sheet stays live when someone edits an amount.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Optional

from .invoice_common import cell_text
from .invoice_query import _amount as _inv_amount
from .project_query import _amount as _proj_amount

HEADER = ["Client", "Project", "Invoices", "Billed (excl. GST)", "Received", "Outstanding",
          "Costs", "Profit", "Margin", "Last invoice", "Project status", "Latest update"]

# Column formats for the sheet editor (metadata.sheet), as the templates use.
_INR = {"type": "inr", "decimals": 0}
SHEET = {
    "v": 1, "header": True, "freezeRows": 1,
    "colWidths": {"0": 170, "1": 230, "10": 120, "11": 420},
    "colFormats": {"2": {"type": "number", "decimals": 0}, "3": _INR, "4": _INR, "5": _INR, "6": _INR,
                   "7": _INR, "8": {"type": "percent", "decimals": 1}, "9": {"type": "date"}},
    "colAlign": {"2": "center", "10": "center"},
}


def _key(text: Optional[str]) -> str:
    return " ".join((text or "").lower().replace("–", "-").split())


def _date(value: Any) -> Optional[datetime]:
    text = cell_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def build_rows(invoices: list[dict], projects: list[dict], statuses: list[dict]) -> list[dict]:
    """One dict per project, merged by project name (case and dash insensitive)."""
    rows: dict[str, dict] = {}

    def row_for(project: str, client: Optional[str]) -> dict:
        k = _key(project)
        r = rows.get(k)
        if r is None:
            r = rows[k] = {"client": client or "", "project": project, "invoices": 0, "billed": 0.0,
                           "received": 0.0, "outstanding": 0.0, "costs": None, "last": None,
                           "status": "", "update": ""}
        if client and not r["client"]:
            r["client"] = client
        return r

    for f in projects:
        name = cell_text(f.get("Project Name"))
        if not name:
            continue
        r = row_for(name, cell_text(f.get("Client")))
        cost = (_proj_amount(f.get("Input cost so far")) or 0.0) + (_proj_amount(f.get("Total Overhead Cost")) or 0.0)
        r["costs"] = cost if cost else r["costs"]
        r["status"] = cell_text(f.get("Project Status")) or r["status"]

    for f in invoices:
        status = (cell_text(f.get("Payment Status")) or "").lower()
        if status == "cancelled":
            continue
        name = cell_text(f.get("Project")) or "No project"
        r = row_for(name, cell_text(f.get("Client Name")) or cell_text(f.get("Client")))
        r["invoices"] += 1
        r["billed"] += _inv_amount(f.get("Amount Raised"))
        r["received"] += _inv_amount(f.get("Amount Received"))
        if status != "paid":
            r["outstanding"] += _inv_amount(f.get("Outstanding Amount"))
        raised = _date(f.get("Raised Date"))
        if raised and (r["last"] is None or raised > r["last"]):
            r["last"] = raised

    for f in statuses:
        name = cell_text(f.get("Project"))
        if not name:
            continue
        r = rows.get(_key(name))
        if r is None:
            r = row_for(name, cell_text(f.get("Client")))
        r["update"] = cell_text(f.get("Short Status")) or r["update"]
        r["status"] = r["status"] or (cell_text(f.get("Status")) or "")

    out = list(rows.values())
    out.sort(key=lambda r: (-r["billed"], r["client"].lower(), r["project"].lower()))
    return out


def _n(v: Optional[float]) -> str:
    if v is None:
        return ""
    return str(int(v)) if float(v).is_integer() else f"{v:.2f}"


def to_csv(rows: list[dict]) -> str:
    """The sheet as CSV: amounts as plain numbers, profit/margin/totals as formulas."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    for i, r in enumerate(rows):
        n = i + 2
        w.writerow([r["client"], r["project"], r["invoices"], _n(r["billed"]), _n(r["received"]),
                    _n(r["outstanding"]), _n(r["costs"]), f"=D{n}-G{n}", f"=IF(D{n}=0,0,H{n}/D{n})",
                    r["last"].date().isoformat() if r["last"] else "", r["status"], r["update"]])
    last = len(rows) + 1
    t = last + 1
    w.writerow(["Total", "", f"=SUM(C2:C{last})", f"=SUM(D2:D{last})", f"=SUM(E2:E{last})",
                f"=SUM(F2:F{last})", f"=SUM(G2:G{last})", f"=SUM(H2:H{last})",
                f"=IF(D{t}=0,0,H{t}/D{t})", "", "", ""])
    return buf.getvalue()


async def build_sheet(pool) -> dict:
    """{title, content, sheet, projects} from the live mirrors."""
    async with pool.acquire() as conn:
        inv = await conn.fetch("SELECT fields FROM invoices_mirror WHERE deleted_at IS NULL")
        proj = await conn.fetch("SELECT fields FROM projects_mirror WHERE deleted_at IS NULL")
        try:
            st = await conn.fetch("SELECT fields FROM status_mirror WHERE deleted_at IS NULL")
        except Exception:
            st = []

    def fields(rows):
        import json
        out = []
        for r in rows:
            f = r["fields"]
            out.append(json.loads(f) if isinstance(f, str) else (f or {}))
        return out

    rows = build_rows(fields(inv), fields(proj), fields(st))
    today = datetime.now().strftime("%d %b %Y")
    return {"title": f"Project revenue · {today}", "content": to_csv(rows), "sheet": SHEET, "projects": len(rows)}
