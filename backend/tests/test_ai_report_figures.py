"""
The figures the AI chat context and the board pack put in front of the model
and of leadership, computed from mirror rows that look like real Teable data:
soft-deleted rows, Cancelled invoices, losses stored as negative fractions and
the real cost field names.

The fake pool answers the SELECTs routers/ai.py issues against the mirrors,
honouring their WHERE deleted_at IS NULL, ORDER BY and LIMIT, so a query that
drops the filter or the totals that lean on a LIMIT both show up in the output.
"""

import asyncio
import datetime as dt
import re

import pytest

import app.routers.ai as ai
from app.db.sync import _extract_invoice
from app.services.invoice import InvoiceService
from app.services.openrouter import _format_records_context, format_chat_records_context

T0 = dt.datetime(2026, 10, 1, 12, 0, tzinfo=dt.timezone.utc)


class FakeMirrorPool:
    def __init__(self, projects=(), invoices=()):
        # (fields, deleted) pairs, oldest sync first
        self.tables = {"projects_mirror": list(projects), "invoices_mirror": list(invoices)}
        self.queries: list[str] = []

    async def fetch(self, sql, *args):
        s = " ".join(sql.split())
        self.queries.append(s)
        m = re.fullmatch(
            r"SELECT (?P<cols>.+?) FROM (?P<table>\w+)(?P<live> WHERE deleted_at IS NULL)?"
            r"(?: ORDER BY (?P<order>.+?))?(?: LIMIT (?P<limit>\d+))?", s)
        assert m, f"unexpected fetch: {s}"
        rows = [f for f, deleted in self.tables[m["table"]] if not (m["live"] and deleted)]
        if m["order"] and m["order"].startswith("raised_date DESC"):
            rows.sort(key=lambda f: f.get("Raised Date") or "", reverse=True)
        elif m["order"] and m["order"].startswith("synced_at DESC"):
            rows.reverse()
        if m["limit"]:
            rows = rows[: int(m["limit"])]
        if m["cols"] == "fields":
            return [{"fields": dict(f)} for f in rows]
        cols = [c.strip() for c in m["cols"].split(",")]
        return [{c: _extract_invoice(f)[c] for c in cols} for f in rows]

    async def fetchrow(self, sql, *args):
        s = " ".join(sql.split())
        self.queries.append(s)
        assert s.startswith("SELECT MAX(synced_at) AS last_sync FROM projects_mirror"), s
        return {"last_sync": T0}


def _inv(no, status="Pending", raised=10_000.0, with_tax=11_800.0, received=0.0, day=1, **extra):
    return {
        "Invoice Number": no, "Project": "PMS", "Payment Status": status,
        "Amount Raised": raised, "Amount with Tax": with_tax, "Amount Received": received,
        "Raised Date": f"2026-{1 + day // 28:02}-{1 + day % 28:02}", **extra,
    }


ACME = {
    "Client": "Acme", "Project Name": "PMS", "Project Status": "Active", "Health": "🟢 Good",
    "Amount Billed So far": 500_000, "Actual Profit": 100_000, "Profit percentage": 0.2,
    "Input cost so far": 300_000, "Total Overhead Cost": 100_000, "Target Achieved ": True,
}
BETA_LOSS = {
    "Client": "Beta", "Project Name": "Ops", "Project Status": "Active", "Health": "🔴 Critical",
    "Amount Billed So far": 200_000, "Actual Profit": -50_000, "Profit percentage": -0.25,
    "Input cost so far": 200_000, "Total Overhead Cost": 50_000,
}
DELETED_PROJECT = {
    "Client": "Gone", "Project Name": "Deleted", "Amount Billed So far": 9_999_999,
    "Actual Profit": 9_999_999, "Input cost so far": 9_999_999, "Total Overhead Cost": 9_999_999,
    "Profit percentage": -0.9, "Health": "🔴",
}


@pytest.fixture
def no_status(monkeypatch):
    async def empty(self, *a, **k):
        return []
    monkeypatch.setattr("app.services.status.StatusService.list_all", empty)


# ── chat context ─────────────────────────────────────────────────────────────

class TestChatContext:
    def _pool(self):
        invoices = [(_inv(f"INV-{i:03}", day=i), False) for i in range(70)]
        invoices += [
            (_inv("INV-CXL", status="Cancelled", raised=50_000, with_tax=59_000, day=80), False),
            (_inv("INV-P1", status="Paid", raised=20_000, with_tax=23_600, received=21_600, day=2), False),
            (_inv("INV-P2", status="Paid", raised=20_000, with_tax=23_600, received=21_600, day=3), False),
            (_inv("INV-DEL", status="Pending", raised=999_999, with_tax=999_999, day=90), True),
        ]
        projects = [(ACME, False), (DELETED_PROJECT, True)]
        return FakeMirrorPool(projects, invoices), [f for f, d in invoices if not d]

    def test_totals_cover_every_live_invoice_and_match_the_invoices_page(self, no_status):
        pool, live = self._pool()
        ctx = asyncio.run(ai._build_context_pg(pool))

        expected = InvoiceService()._compute_summary([{"fields": f} for f in live])
        assert expected["total_invoices"] == 73 and expected["total_outstanding"] == 700_000
        assert "Total Invoices: 73 (Active: 72;" in ctx
        assert f"Outstanding: ₹{expected['total_outstanding']:,.0f}" in ctx
        assert f"Total Received: ₹{expected['total_received']:,.0f}" in ctx
        assert f"Total with GST: ₹{expected['total_with_tax']:,.0f}" in ctx
        assert f"Collection Rate: {expected['collection_rate']:.1f}%" in ctx

    def test_the_itemised_list_is_labelled_as_a_sample(self, no_status):
        pool, _ = self._pool()
        ctx = asyncio.run(ai._build_context_pg(pool))
        assert "sample: the 60 most recent of 73" in ctx
        records_block = ctx.split("=== LIVE INVOICE RECORDS", 1)[1].split("===", 2)[1]
        assert records_block.count("\n[INV-") == 60

    def test_deleted_rows_are_left_out(self, no_status):
        pool, _ = self._pool()
        ctx = asyncio.run(ai._build_context_pg(pool))
        assert "INV-DEL" not in ctx and "999,999" not in ctx
        assert "Total Projects: 1\n" in ctx and "Total Billed: ₹500,000" in ctx
        assert "Gone" not in ctx
        for q in pool.queries:
            assert "deleted_at IS NULL" in q, q

    def test_a_small_book_is_not_called_a_sample(self):
        summary = InvoiceService()._compute_summary([{"fields": _inv("INV-1")}])
        text = ai._fmt_chat_invoice_context(summary, [{"fields": _inv("INV-1")}], limit=60)
        assert "=== LIVE INVOICE RECORDS ===" in text and "sample" not in text


# ── board pack payload and renderer ──────────────────────────────────────────

class TestBoardPackPayload:
    def _payload(self):
        pool = FakeMirrorPool(
            projects=[(ACME, False), (BETA_LOSS, False), (DELETED_PROJECT, True)],
            invoices=[
                (_inv("INV-LIVE", day=5, **{"Next followup": "2026-10-15"}), False),
                (_inv("INV-OLD", day=1), False),
                (_inv("INV-GONE", raised=999_999, with_tax=999_999, day=9), True),
            ],
        )
        return asyncio.run(ai._build_report_payload_pg(pool)), pool

    def test_cost_base_reads_the_real_teable_fields(self):
        payload, _ = self._payload()
        s = payload["project_summary"]
        assert s["total_input_cost"] == 500_000
        assert s["total_overhead"] == 150_000
        assert s["total_cost"] == 650_000

    def test_deleted_projects_and_invoices_are_not_counted(self):
        payload, pool = self._payload()
        s, inv = payload["project_summary"], payload["invoice_summary"]
        assert s["total_projects"] == 2 and s["total_billed"] == 700_000
        assert inv["total_invoices"] == 2 and inv["total_raised"] == 20_000
        assert all(p["invoice_no"] != "INV-GONE" for p in inv["pending_invoices"])
        assert all("deleted_at IS NULL" in q for q in pool.queries)

    def test_losses_are_scaled_to_percent(self):
        payload, _ = self._payload()
        s = payload["project_summary"]
        assert [(p["name"], p["pct"]) for p in s["at_risk"]] == [("Beta / Ops", -25.0)]
        assert s["worst_project"] == {"name": "Beta / Ops", "pct": -25.0}
        assert s["best_project"] == {"name": "Acme / PMS", "pct": 20.0}

    def test_board_pack_text_carries_the_figures(self):
        payload, _ = self._payload()
        text = ai._build_board_pack_report(
            payload["project_summary"], payload["project_records"], payload["invoice_summary"], [])
        assert "Input cost: ₹5,00,000." in text
        assert "Overhead: ₹1,50,000." in text
        assert "Total cost base: ₹6,50,000." in text
        ops_line = next(line for line in text.splitlines() if line.startswith("- Beta / Ops:"))
        assert "(-25.0%)" in ops_line
        assert "Profit=-25.0%" in text   # the at-risk bullet

    def test_client_billing_summary_shows_profit(self):
        payload, _ = self._payload()
        text = ai._build_template_report("client-billing-summary", payload, [])
        assert "Acme · ₹500,000 billed · ₹100,000 profit" in text
        assert "Beta · ₹200,000 billed · ₹-50,000 profit" in text


class TestBoardPackRecommendations:
    def _section(self, text, label):
        return text.split(label, 1)[1].split("\n\n", 1)[0]

    def test_derived_from_the_data_not_fixed_text(self):
        pool = FakeMirrorPool(
            projects=[(ACME, False), (BETA_LOSS, False)],
            invoices=[(_inv("INV-777", day=3), False)],
        )
        payload = asyncio.run(ai._build_report_payload_pg(pool))
        text = ai._build_board_pack_report(
            payload["project_summary"], payload["project_records"], payload["invoice_summary"], [])

        assert "green" not in text
        assert "WM/26-27/009" not in text and "WM/26-27/020" not in text
        recs = self._section(text, "Recommendations:")
        actions = self._section(text, "Action Items This Week:")
        assert "Beta / Ops" in recs and "₹10,000 is outstanding" in recs
        assert "Follow up on [INV-777] PMS" in actions and "no follow-up date set" in actions
        assert "Agree a recovery plan for Beta / Ops (margin -25.0%" in actions

    def test_a_clean_portfolio_names_nothing(self):
        pool = FakeMirrorPool(projects=[(ACME, False)], invoices=[])
        payload = asyncio.run(ai._build_report_payload_pg(pool))
        text = ai._build_board_pack_report(
            payload["project_summary"], payload["project_records"], payload["invoice_summary"], [])
        recs = self._section(text, "Recommendations:")
        actions = self._section(text, "Action Items This Week:")
        assert "No tracked project has a negative margin" in recs
        assert "collections" not in recs
        assert "Follow up on" not in actions and "recovery plan" not in actions


# ── negative profit fractions in the chat/report formatters ─────────────────

class TestNegativeMargins:
    @pytest.mark.parametrize("raw,shown", [(-0.25, "-25.0%"), (0.4479, "44.8%"), (-35, "-35.0%")])
    def test_chat_records_context(self, raw, shown):
        out = format_chat_records_context([{"fields": {"Client": "C", "Profit percentage": raw}}])
        assert f"Margin {shown}" in out

    def test_report_records_context(self):
        out = _format_records_context([{"fields": {"Client": "C", "Profit percentage": -0.25}}])
        assert "Profit %: -25.00%" in out

    def test_margin_helper(self):
        assert ai._margin_pct(-0.25) == -25.0
        assert ai._margin_pct(0.5) == 50.0
        assert ai._margin_pct(45) == 45
        assert ai._margin_pct(None) == 0
