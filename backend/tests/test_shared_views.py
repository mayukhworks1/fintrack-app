"""
Public share links: what a link sends, which records it covers, and who may
make or audit one.

  * the public payload carries only the fields the link shows (no Profit,
    costs, remarks or raw Teable metadata unless the owner chose the column)
  * a live edit link can only edit records its filters currently match
  * a live link re-applies the owner's whole filter state — advanced rules,
    the page's own search fields — and refuses what it cannot re-apply
  * tax-ledger links need module.tax.share; access logs need shared.manage
  * the public edit model takes null for an empty number (no 422)
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import app.services.shared_views as S
from app.services.shared_views import SharedViewService


PROJECT_FIELDS = {
    "Client": "Acme",
    "Project Name": "Rebrand",
    "Project Status": "Active",
    "Health": "On Track",
    "Amount Billed So far": 500000,
    "Actual Profit": 120000,
    "Profit percentage": 24.0,
    "Input cost so far": 380000,
    "Combined monthly salary of all the resources": 90000,
}

INVOICE_FIELDS = {
    "Invoice Number": "INV-1",
    "Client Name": "Acme",
    "Project": "Rebrand",
    "Category": "Project",
    "Payment Status": "Pending",
    "Amount Raised": 100000,
    "Amount with Tax": 118000,
    "Amount Received": 0,
    "Outstanding Amount": 118000,
    "Raised Date": "2026-09-01T00:00:00.000Z",
    "Raised By": "staff@theworks.in",
    "Remark": "client disputes the second milestone",
    "Reference": [{"name": "po.pdf", "presignedUrl": "https://files.example/po.pdf?sig=x"}],
}


def _request():
    return SimpleNamespace(headers={}, client=None)


def _view(**overrides):
    view = {
        "token": "tok",
        "title": "Shared",
        "created_at": None,
        "expires_at": None,
        "is_active": True,
        "access_mode": "read",
        "resource_type": "projects",
        "record_ids": ["rec1"],
        "view_config": None,
    }
    view.update(overrides)
    return view


@pytest.fixture
def public(monkeypatch):
    """get_public_data / update_public_record against an in-memory link and record store."""
    state = {"view": _view(), "records": {}, "updates": [], "source_calls": 0}

    async def get_public_view(self, token):
        return dict(state["view"])

    async def no_log(self, *a, **k):
        return None

    async def live_get(resource_type, service, record_id):
        rec = state["records"].get(record_id)
        if rec is None:
            raise LookupError(record_id)
        return {"id": record_id, **rec}

    async def live_update(resource_type, record_id, cleaned, request):
        state["updates"].append((record_id, cleaned))
        return state.get("update_result") or {"id": record_id, "fields": {}}

    async def all_records(*a, **k):
        state["source_calls"] += 1
        return [{"id": rid, **rec} for rid, rec in state["records"].items()]

    monkeypatch.setattr(S, "get_pool", lambda: None if state.get("no_pool") else object())
    monkeypatch.setattr(SharedViewService, "get_public_view", get_public_view)
    monkeypatch.setattr(SharedViewService, "_log_access", no_log)
    monkeypatch.setattr(S, "_live_service_for", lambda rt: object())
    monkeypatch.setattr(S, "_live_get_record", live_get)
    monkeypatch.setattr(S, "_live_update_record", live_update)

    import app.services.invoice as inv
    import app.services.status as st
    import app.services.teable as tb
    monkeypatch.setattr(inv.InvoiceService, "get_all_invoices", all_records)
    monkeypatch.setattr(st.StatusService, "_list_from_teable", all_records)
    monkeypatch.setattr(tb.TeableService, "get_all_records", all_records)
    return state


def _get(state):
    return asyncio.run(SharedViewService().get_public_data("tok", _request()))


# ── 1. the public payload is projected server-side ───────────────────────────

class TestPublicFieldProjection:
    def test_project_cards_do_not_ship_profit_or_costs_by_default(self, public):
        public["records"] = {"rec1": {"fields": dict(PROJECT_FIELDS)}}
        data = _get(public)
        fields = data["records"][0]["fields"]
        assert fields == {
            "Client": "Acme", "Project Name": "Rebrand", "Project Status": "Active",
            "Health": "On Track", "Amount Billed So far": 500000,
        }
        assert "Actual Profit" not in data["shared_fields"]
        assert "Profit percentage" not in data["shared_fields"]

    def test_profit_is_sent_only_when_the_owner_shows_that_column(self, public):
        public["view"] = _view(view_config={"columns": ["Client", "Project Name", "Actual Profit", "Profit percentage"]})
        public["records"] = {"rec1": {"fields": dict(PROJECT_FIELDS)}}
        fields = _get(public)["records"][0]["fields"]
        assert fields["Actual Profit"] == 120000 and fields["Profit percentage"] == 24.0
        # Amount Billed was not chosen this time, and costs are never publishable.
        assert "Amount Billed So far" not in fields
        assert "Input cost so far" not in fields
        assert "Combined monthly salary of all the resources" not in fields

    def test_live_invoice_link_drops_unchosen_fields_and_teable_metadata(self, public):
        public["view"] = _view(
            resource_type="invoices", record_ids=["__dynamic__"],
            view_config={"columns": ["Invoice Number", "Client Name", "Amount Raised"]},
        )
        public["records"] = {"rec1": {
            "fields": dict(INVOICE_FIELDS),
            "createdBy": "owner@theworks.in",
            "lastModifiedTime": "2026-10-01T10:00:00.000Z",
        }}
        record = _get(public)["records"][0]
        assert set(record) == {"id", "fields"}
        assert "Remark" not in record["fields"]
        assert "Raised By" not in record["fields"]
        assert "Reference" not in record["fields"]
        assert record["fields"]["Amount Raised"] == 100000
        # record-level timestamp travels inside fields, where the page reads it
        assert record["fields"]["lastModifiedTime"] == "2026-10-01T10:00:00.000Z"

    def test_edit_links_show_the_fields_they_let_the_holder_change(self, public):
        public["view"] = _view(
            resource_type="invoices", access_mode="edit",
            view_config={"columns": ["Invoice Number", "Client Name"]},
        )
        public["records"] = {"rec1": {"fields": dict(INVOICE_FIELDS)}}
        fields = _get(public)["records"][0]["fields"]
        assert fields["Remark"] == INVOICE_FIELDS["Remark"]   # editable, so its current value is shown
        assert "Raised By" not in fields

    def test_status_attachments_are_opt_in(self, public):
        rec = {"fields": {"Client": "Acme", "Project": "Site", "Status": "In progress",
                          "Attachments": [{"name": "a.png", "presignedUrl": "https://x"}]}}
        public["view"] = _view(resource_type="status")
        public["records"] = {"rec1": rec}
        assert "Attachments" not in _get(public)["records"][0]["fields"]
        public["view"] = _view(resource_type="status", view_config={"columns": ["Client", "Attachments"]})
        assert _get(public)["records"][0]["fields"]["Attachments"][0]["name"] == "a.png"

    def test_owner_advanced_rules_are_not_published(self, public):
        public["view"] = _view(
            record_ids=["__dynamic__"],
            view_config={"filterConditions": [{"field": "Actual Profit", "op": "gt", "value": "100000"}]},
        )
        public["records"] = {"rec1": {"fields": dict(PROJECT_FIELDS)}}
        data = _get(public)
        assert data["total"] == 1
        assert "filterConditions" not in (data["view_config"] or {})


# ── 2. live edit links are bounded by their filters ──────────────────────────

class TestPublicEditScope:
    def _edit_view(self, **vc):
        return _view(resource_type="invoices", access_mode="edit", record_ids=["__dynamic__"], view_config=vc)

    def _patch(self, record_id, fields):
        return asyncio.run(SharedViewService().update_public_record("tok", record_id, fields))

    def test_record_outside_the_live_filter_is_refused_before_any_write(self, public):
        public["view"] = self._edit_view(filterClient="Acme")
        public["records"] = {"other": {"fields": {**INVOICE_FIELDS, "Client Name": "Globex"}}}
        with pytest.raises(ValueError, match="not part of this shared view"):
            self._patch("other", {"Remark": "paid"})
        assert public["updates"] == []

    def test_record_inside_the_live_filter_is_updated(self, public):
        public["view"] = self._edit_view(filterClient="Acme")
        public["records"] = {"mine": {"fields": dict(INVOICE_FIELDS)}}
        self._patch("mine", {"Remark": "chased", "Raised By": "attacker@x"})
        assert public["updates"] == [("mine", {"Remark": "chased"})]

    def test_advanced_rules_bound_edits_too(self, public):
        public["view"] = self._edit_view(filterConditions=[{"field": "Amount Raised", "op": "gt", "value": "500000"}])
        public["records"] = {"small": {"fields": dict(INVOICE_FIELDS)}}
        with pytest.raises(ValueError):
            self._patch("small", {"Remark": "x"})
        assert public["updates"] == []

    def test_unknown_record_is_refused(self, public):
        public["view"] = self._edit_view()
        with pytest.raises(ValueError):
            self._patch("missing", {"Remark": "x"})
        assert public["updates"] == []

    def test_snapshot_links_keep_their_record_list(self, public):
        public["view"] = _view(resource_type="invoices", access_mode="edit", record_ids=["mine"])
        public["records"] = {"mine": {"fields": dict(INVOICE_FIELDS)}, "other": {"fields": dict(INVOICE_FIELDS)}}
        with pytest.raises(ValueError):
            self._patch("other", {"Remark": "x"})
        self._patch("mine", {"Remark": "x"})
        assert public["updates"] == [("mine", {"Remark": "x"})]

    def test_read_only_links_cannot_edit(self, public):
        public["view"] = _view(resource_type="invoices", access_mode="read", record_ids=["__dynamic__"])
        public["records"] = {"mine": {"fields": dict(INVOICE_FIELDS)}}
        with pytest.raises(PermissionError):
            self._patch("mine", {"Remark": "x"})

    def test_edit_whitelist_and_paid_rules(self):
        assert S._public_edit_fields("invoices", {"Remark": "r", "Amount Raised": 1}) == {"Remark": "r"}
        with pytest.raises(ValueError, match="Amount Received"):
            S._public_edit_fields("invoices", {"Payment Status": "Paid", "Cleared Date": "2026-10-01"})
        with pytest.raises(ValueError, match="Cleared Date"):
            S._public_edit_fields("invoices", {"Payment Status": "Paid", "Amount Received": 10})
        assert S._public_edit_fields("tax-ledger", {"Remark": "r"}) == {}

    def test_router_answers_400_for_an_out_of_scope_record(self, public, monkeypatch):
        from app.routers import shared_views as R
        import app.db.valkey as vk

        async def allow(*a, **k):
            return True, 0
        monkeypatch.setattr(vk, "rate_check", allow)
        public["view"] = self._edit_view(filterClient="Acme")
        public["records"] = {"other": {"fields": {**INVOICE_FIELDS, "Client Name": "Globex"}}}
        app = FastAPI()
        app.include_router(R.router)
        res = TestClient(app).patch("/api/public/view/tok/records/other", json={"remark": "x"})
        assert res.status_code == 400
        assert public["updates"] == []

    def test_the_edit_response_carries_only_the_links_fields(self, public, monkeypatch):
        """Teable answers a PATCH with the whole record; the holder must not get it."""
        from app.routers import shared_views as R
        import app.db.valkey as vk

        async def allow(*a, **k):
            return True, 0
        monkeypatch.setattr(vk, "rate_check", allow)
        public["view"] = _view(resource_type="projects", access_mode="edit", record_ids=["rec1"])
        public["records"] = {"rec1": {"fields": dict(PROJECT_FIELDS)}}
        public["update_result"] = {
            "id": "rec1", "createdBy": "owner@theworks.in",
            "fields": {**PROJECT_FIELDS, "Project Status": "Done"},
        }
        app = FastAPI()
        app.include_router(R.router)
        res = TestClient(app).patch("/api/public/view/tok/records/rec1", json={"project_status": "Done"})
        assert res.status_code == 200
        body = res.json()
        assert set(body) == {"id", "fields"} and body["id"] == "rec1"
        assert body["fields"]["Project Status"] == "Done"
        for internal in ("Actual Profit", "Profit percentage", "Input cost so far",
                         "Combined monthly salary of all the resources"):
            assert internal not in body["fields"]

    def test_public_edit_model_takes_null_for_an_empty_number(self, public, monkeypatch):
        """The public page sends null (not '') for a blank amount; null means 'leave it'."""
        from app.routers import shared_views as R
        import app.db.valkey as vk

        async def allow(*a, **k):
            return True, 0
        monkeypatch.setattr(vk, "rate_check", allow)
        public["view"] = _view(resource_type="invoices", access_mode="edit", record_ids=["mine"])
        public["records"] = {"mine": {"fields": dict(INVOICE_FIELDS)}}
        app = FastAPI()
        app.include_router(R.router)
        client = TestClient(app)
        assert client.patch("/api/public/view/tok/records/mine", json={"amount_received": ""}).status_code == 422
        res = client.patch("/api/public/view/tok/records/mine", json={"amount_received": None, "remark": "ok"})
        assert res.status_code == 200
        assert public["updates"] == [("mine", {"Remark": "ok"})]


# ── 3. a live link re-applies the owner's whole filter state ─────────────────

def _live(public, resource_type, records, **vc):
    public["view"] = _view(resource_type=resource_type, record_ids=["__dynamic__"], view_config=vc)
    public["records"] = {f"r{i}": {"fields": f} for i, f in enumerate(records)}
    return [r["id"] for r in _get(public)["records"]]


class TestLiveViewFilters:
    def test_status_advanced_rules_are_applied(self, public):
        ids = _live(public, "status", [
            {"Client": "Birla Open Minds", "Project": "A", "Status": "In progress"},
            {"Client": "Maitrimetal", "Project": "B", "Status": "In progress"},
        ], advancedConditions=[{"id": "c1", "field": "Client", "op": "contains", "value": "birla"}])
        assert ids == ["r0"]

    def test_status_board_counts_a_blank_status_as_not_started(self, public):
        ids = _live(public, "status", [
            {"Client": "A", "Project": "x"},
            {"Client": "A", "Project": "y", "Status": "Completed"},
        ], filterStatus="Not started")
        assert ids == ["r0"]

    def test_status_search_keeps_the_owners_untrimmed_term(self, public):
        ids = _live(public, "status", [
            {"Client": "Acme", "Project": "acme site"},
            {"Client": "Acmeville", "Project": "x"},
        ], search="acme ")
        assert ids == ["r0"]

    def test_invoice_search_uses_the_invoices_page_fields(self, public):
        base = dict(INVOICE_FIELDS)
        ids = _live(public, "invoices", [
            {**base, "Description": "Pending milestone"},           # page searches Description
            {**base, "Remark": "pending signoff"},                  # page does not search Remark …
            {**base, "Payment Status": "Pending"},                  # … or Payment Status
        ], search="pending")
        assert ids == ["r0"]

    def test_invoice_advanced_rules_are_applied(self, public):
        base = dict(INVOICE_FIELDS)
        ids = _live(public, "invoices", [
            {**base, "Amount Raised": 750000},
            {**base, "Amount Raised": 100000},
        ], filterConditions=[{"field": "Amount Raised", "op": "gt", "value": "500000"}])
        assert ids == ["r0"]

    def test_tax_ledger_search_uses_the_tax_page_fields(self, public):
        paid = {**INVOICE_FIELDS, "Payment Status": "Paid", "Raised Date": "2026-05-10"}
        ids = _live(public, "tax-ledger", [
            {**paid, "Client Name": "Acme"},
            {**paid, "Client Name": "Globex", "Remark": "acme referral"},       # Remark is not searched
            {**paid, "Client Name": "Globex", "Category": "Acme partner"},      # nor Category
            {**paid, "Client Name": "Acme", "Raised Date": "2026-02-10"},       # outside the period
        ], search=" acme ", invoiceScope="tax", periodFrom="2026-04-01", periodTo="2027-03-31")
        assert ids == ["r0"]

    def test_tax_ledger_search_never_spans_two_fields(self):
        f = {"fields": {**INVOICE_FIELDS, "Payment Status": "Paid", "Invoice Number": "INV-7", "Project": "Rebrand"}}
        cfg = {"invoiceScope": "tax", "search": "inv-7 rebrand"}
        assert S._record_matches_view("tax-ledger", cfg, f) is False
        assert S._record_matches_view("tax-ledger", {**cfg, "search": "rebrand"}, f) is True

    def test_tax_ledger_excludes_foreign_currency_like_the_page(self, public):
        paid = {**INVOICE_FIELDS, "Payment Status": "Paid", "Raised Date": "2026-05-10"}
        ids = _live(public, "tax-ledger", [paid, {**paid, "Currency": "USD"}, {**paid, "Currency": " inr "}],
                    invoiceScope="tax")
        assert ids == ["r0", "r2"]

    def test_month_filter_reads_the_owners_local_month(self, public):
        base = dict(INVOICE_FIELDS)
        records = [
            {**base, "Raised Date": "2026-03-31T18:30:00.000Z"},   # 1 April in IST
            {**base, "Raised Date": "2026-03-15T00:00:00.000Z"},
        ]
        assert _live(public, "invoices", records, monthFilter="2026-04", utcOffsetMinutes=330) == ["r0"]
        # links saved before the offset was sent keep the old text reading
        assert _live(public, "invoices", records, monthFilter="2026-03") == ["r0", "r1"]

    def test_saved_link_with_unreplayable_rules_shows_nothing(self, public):
        ids = _live(public, "invoices", [dict(INVOICE_FIELDS)],
                    filterConditions=[{"field": "Client Name", "op": "regex", "value": "A.*"}])
        assert ids == []
        assert public["source_calls"] == 0

    @pytest.mark.parametrize("raw,op,value,expected", [
        ("Birla Open Minds", "contains", "BIRLA", True),
        ("Birla", "not_contains", "acme", True),
        ("", "is_empty", "", True),
        (["a", None, "b"], "is", "a · b", True),
        ("₹5,00,000", "gte", "500000", True),
        (None, "neq", "5", False),
        ("2026-04-01T00:00:00.000Z", "date_is", "2026-04-01", True),
        ("2026-04-01T10:00", "date_is_not", "2026-05-01", False),   # local time, no offset: never guessed
        ("not a date", "date_before", "2026-01-01", False),
    ])
    def test_condition_semantics_match_filter_builder(self, raw, op, value, expected):
        assert S._match_condition(raw, op, value, None) is expected


class TestLiveViewSaveChecks:
    def test_sanitizer_drops_incomplete_rows_and_flags_unknown_ones(self):
        vc = S._sanitize_view_config({"filterConditions": [
            {"field": "Client Name", "op": "contains", "value": ""},      # incomplete: skipped like the page
            {"field": "", "op": "is", "value": "x"},
            {"field": "Client Name", "op": "is_empty"},
            {"field": "Amount Raised", "op": "gt", "value": 0},
        ]})
        assert vc["filterConditions"] == [
            {"field": "Client Name", "op": "is_empty", "value": ""},
            {"field": "Amount Raised", "op": "gt", "value": 0},
        ]
        assert "liveUnsupported" not in vc
        for bad in ({"field": "x", "op": "regex", "value": "y"},
                    {"field": "x", "op": "is", "value": ["y"]},
                    {"field": "x", "op": "contains", "value": "y" * 300}):
            assert S._sanitize_view_config({"filterConditions": [bad]})["liveUnsupported"] is True
        assert S._sanitize_view_config({"search": "q" * 300})["liveUnsupported"] is True

    def _pool(self):
        class Conn:
            async def fetchrow(self, sql, *params):
                return {"token": params[0], "record_ids": params[2], "view_config": params[7], "is_active": True}

        class Pool:
            def acquire(self):
                return self

            async def __aenter__(self):
                return Conn()

            async def __aexit__(self, *a):
                return False
        return Pool()

    def test_create_refuses_a_live_link_it_cannot_reapply_but_allows_the_snapshot(self, monkeypatch):
        monkeypatch.setattr(S, "get_pool", self._pool)
        vc = {"filterConditions": [{"field": "Client Name", "op": "regex", "value": "A.*"}]}
        with pytest.raises(ValueError, match="snapshot"):
            asyncio.run(SharedViewService().create(None, ["__dynamic__"], "editor", view_config=vc, resource_type="invoices"))
        row = asyncio.run(SharedViewService().create(None, ["rec1"], "editor", view_config=vc, resource_type="invoices"))
        assert row["is_dynamic"] is False

    def test_a_searched_projects_view_is_shared_as_a_snapshot_not_live(self, monkeypatch):
        # The Projects page's search is Teable full-text, capped at 20 and blind to the
        # client/status filters; a live link would publish every substring match.
        monkeypatch.setattr(S, "get_pool", self._pool)
        svc = SharedViewService()
        vc = {"type": "card", "filterClient": "", "search": "acme"}
        with pytest.raises(ValueError, match="snapshot"):
            asyncio.run(svc.create(None, ["__dynamic__"], "editor", view_config=vc, resource_type="projects"))
        assert asyncio.run(svc.create(None, ["p1"], "editor", view_config=vc, resource_type="projects"))["is_dynamic"] is False
        for ok_vc in ({**vc, "search": "  "}, {**vc, "search": ""}):
            assert asyncio.run(svc.create(None, ["__dynamic__"], "editor", view_config=ok_vc, resource_type="projects"))["is_dynamic"]
        # other pages' searches are replayed exactly, so they stay live
        assert asyncio.run(svc.create(None, ["__dynamic__"], "editor", view_config=vc, resource_type="invoices"))["is_dynamic"]

    def test_update_refuses_re_scoping_a_searched_projects_link_live(self, monkeypatch):
        monkeypatch.setattr(S, "get_pool", self._pool)

        async def existing(self, token):
            return {"token": token, "resource_type": "projects", "is_dynamic": False, "record_ids": ["p1"],
                    "view_config": {"search": "acme"}}
        monkeypatch.setattr(SharedViewService, "get", existing)
        with pytest.raises(ValueError, match="snapshot"):
            asyncio.run(SharedViewService().update("tok", {"record_ids": ["__dynamic__"]}))
        with pytest.raises(ValueError, match="snapshot"):
            asyncio.run(SharedViewService().update("tok", {"record_ids": ["__dynamic__"], "view_config": {"search": "x"}}))

    def test_update_refuses_turning_such_a_snapshot_live(self, monkeypatch):
        monkeypatch.setattr(S, "get_pool", self._pool)

        async def existing(self, token):
            return {"token": token, "is_dynamic": False, "record_ids": ["rec1"],
                    "view_config": {"liveUnsupported": True}}
        monkeypatch.setattr(SharedViewService, "get", existing)
        with pytest.raises(ValueError, match="snapshot"):
            asyncio.run(SharedViewService().update("tok", {"record_ids": ["__dynamic__"]}))


# ── 4 & 5. who may share the tax ledger, and who may read access logs ─────────

def _client(monkeypatch, perms):
    from app.routers import deps
    from app.routers import shared_views as R

    async def fake_auth(request: Request):
        request.state.is_email_auth = True
        request.state.auth_role = "admin"
        request.state.auth_user_id = "u1"
        return "editor"

    async def fake_perms(user_id, *, fresh=False):
        return set(perms)

    monkeypatch.setattr(deps, "get_effective_permissions", fake_perms)
    monkeypatch.setattr(R, "get_effective_permissions", fake_perms)

    async def create(self, **kwargs):
        return {"token": "new", "resource_type": kwargs["resource_type"]}

    async def get(self, token):
        return {"token": token, "resource_type": "tax-ledger" if token == "tax" else "invoices"}

    async def update(self, token, data):
        return {"token": token, **data}

    async def accesses(self, token, limit=200):
        return [{"ip": "203.0.113.9", "lat": 12.9, "lon": 77.6}]

    async def delete_accesses(self, token, ids):
        return len(ids)

    async def stats(self, token):
        return {"total_events": 1}

    monkeypatch.setattr(SharedViewService, "create", create)
    monkeypatch.setattr(SharedViewService, "get", get)
    monkeypatch.setattr(SharedViewService, "update", update)
    monkeypatch.setattr(SharedViewService, "get_accesses", accesses)
    monkeypatch.setattr(SharedViewService, "delete_accesses", delete_accesses)
    monkeypatch.setattr(SharedViewService, "get_accesses_stats", stats)

    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[deps.require_auth] = fake_auth
    return TestClient(app)


def _share(resource_type):
    return {"record_ids": ["__dynamic__"], "resource_type": resource_type}


class TestSharePermissions:
    def test_tax_ledger_links_need_module_tax_share(self, monkeypatch):
        client = _client(monkeypatch, {"module.shared.manage"})
        res = client.post("/api/shared-views", json=_share("tax-ledger"))
        assert res.status_code == 403
        assert "module.tax.share" in res.json()["detail"]
        assert client.post("/api/shared-views", json=_share("invoices")).status_code == 201

    def test_tax_share_alone_is_enough_for_tax_but_not_other_modules(self, monkeypatch):
        client = _client(monkeypatch, {"module.tax.share"})
        assert client.post("/api/shared-views", json=_share("tax-ledger")).status_code == 201
        assert client.post("/api/shared-views", json=_share("invoices")).status_code == 403

    def test_rescoping_a_tax_link_needs_module_tax_share(self, monkeypatch):
        client = _client(monkeypatch, {"module.shared.manage"})
        assert client.patch("/api/shared-views/tax", json={"is_active": True}).status_code == 403
        assert client.patch("/api/shared-views/inv", json={"is_active": True}).status_code == 200
        client = _client(monkeypatch, {"module.shared.manage", "module.tax.share"})
        assert client.patch("/api/shared-views/tax", json={"is_active": True}).status_code == 200


class TestAccessLogPermissions:
    @pytest.mark.parametrize("method,path,body", [
        ("get", "/api/shared-views/inv/accesses", None),
        ("delete", "/api/shared-views/inv/accesses", {"access_ids": ["a1"]}),
        ("get", "/api/shared-views/inv/stats", None),
    ])
    def test_access_log_endpoints_need_shared_manage(self, monkeypatch, method, path, body):
        denied = _client(monkeypatch, {"module.finance.view"})
        kwargs = {"json": body} if body is not None else {}
        res = denied.request(method.upper(), path, **kwargs)
        assert res.status_code == 403
        assert "module.shared.manage" in res.json()["detail"]
        allowed = _client(monkeypatch, {"module.shared.manage"})
        assert allowed.request(method.upper(), path, **kwargs).status_code == 200
