"""
Every route that spends model calls stands behind the daily AI quota, and
page generation behind module.ai.use as well — exercised over HTTP against
the real app, with the model calls themselves stubbed out.

Before this, only routers/ai.py was gated. Page generation, invoice parsing
and the status-board AI update called the same shared model cascade with no
cap: a user whose allowance was spent, or whose AI access had been revoked,
carried on through them and drained the budget chat and Studio depend on.
"""

import pytest
from fastapi.testclient import TestClient

import app.main as M
import app.routers.ai as A
import app.routers.deps as D
import app.routers.invoices as INV
import app.routers.pages as P
import app.routers.status as ST
import app.services.ai_usage as U
import app.services.openrouter as OR
from app.routers.auth import make_token

PDF = ("invoice.pdf", b"%PDF-1.4 stub", "application/pdf")

# path -> (token role, stub name, request kwargs)
ROUTES = {
    "/api/pages/ai-generate":     ("editor", "generate_page", {"json": {"prompt": "A bakery landing page"}}),
    "/api/pages/ai/interview":    ("editor", "analyze_prompt_needs", {"json": {"prompt": "A bakery landing page"}}),
    "/api/pages/ai/stream":       ("editor", "stream_generate_page", {"json": {"prompt": "A bakery landing page"}}),
    "/api/pages/ai/section-edit": ("editor", "edit_page_section",
                                   {"json": {"content": "<section id='a'></section>", "section_id": "a", "prompt": "darker"}}),
    "/api/pages/ai/fix-error":    ("editor", "fix_page_script_error",
                                   {"json": {"content": "<script>x()</script>", "error": {"message": "x is not defined"}}}),
    "/api/invoices/parse":        ("editor", "parse_invoice", {"files": {"file": PDF}}),
    "/api/web-invoices/parse":    ("all", "parse_web_invoice", {"files": {"file": PDF}}),
    "/api/status/ai-update":      ("editor", "ai_status_update", {"json": {"record_ids": ["rec1"]}}),
}
PAGE_ROUTES = [p for p in ROUTES if p.startswith("/api/pages/")]


@pytest.fixture
def model(monkeypatch):
    """Stub every model entry point these routes use; record each call."""
    calls = []

    def rec(name, result):
        async def stub(*a, **k):
            calls.append(name)
            return result
        return stub

    async def stream_stub(*a, **k):
        calls.append("stream_generate_page")
        yield {"type": "done", "content": "<html></html>"}

    page = {"content": "<html></html>", "model": "m", "model_short": "m", "warnings": []}
    monkeypatch.setattr(P, "generate_page", rec("generate_page", page))
    monkeypatch.setattr(P, "analyze_prompt_needs", rec("analyze_prompt_needs", {"needs_interview": False}))
    monkeypatch.setattr(P, "stream_generate_page", stream_stub)
    monkeypatch.setattr(P, "edit_page_section", rec("edit_page_section", {"content": "<html></html>"}))
    monkeypatch.setattr(P, "fix_page_script_error", rec("fix_page_script_error", {"content": "<html></html>"}))
    # The main router imports the parser at module load; the web router and the
    # status router import theirs from openrouter at call time.
    monkeypatch.setattr(INV, "parse_invoice_document", rec("parse_invoice", {"Invoice Number": "INV-1"}))
    monkeypatch.setattr(OR, "parse_invoice_document", rec("parse_web_invoice", {"Invoice Number": "INV-1"}))
    monkeypatch.setattr(OR, "ai_status_update", rec("ai_status_update", {"content": "On track.", "model": "m"}))

    class Svc:
        async def list_all(self):
            return [{"id": "rec1", "fields": {"Client": "Acme", "Project": "Site"}}]
    monkeypatch.setattr(ST, "_svc", lambda: Svc())
    return calls


@pytest.fixture
def quota(monkeypatch):
    state = {"allowed": True}

    async def quota_state(user_id, role=None):
        return {"allowed": state["allowed"], "used": 200 if not state["allowed"] else 0,
                "limit": 200, "metered": True}

    monkeypatch.setattr(U, "quota_state", quota_state)

    # These routes are called with legacy password tokens, which carry no user
    # id and are metered by the per-role shared budget instead.
    async def rate_check(key, limit=60, window_sec=60, bucket="ratelimit"):
        return state["allowed"], 0

    monkeypatch.setattr(A, "rate_check", rate_check)
    return state


@pytest.fixture
def client():
    return TestClient(M.app)


def _call(client, path, role=None, **extra):
    token_role, _, kwargs = ROUTES[path]
    headers = {"Authorization": f"Bearer {make_token(role or token_role)}"}
    return client.post(path, headers=headers, **kwargs, **extra)


class TestQuotaOverHttp:
    @pytest.mark.parametrize("path", list(ROUTES))
    def test_a_spent_allowance_is_refused_before_the_model_runs(self, client, model, quota, path):
        quota["allowed"] = False
        r = _call(client, path)
        assert r.status_code == 429, r.text
        assert "Daily AI limit reached" in r.json()["error"]["message"]
        assert model == []

    @pytest.mark.parametrize("path", list(ROUTES))
    def test_the_same_request_reaches_the_model_while_allowance_remains(self, client, model, quota, path):
        r = _call(client, path)
        assert r.status_code == 200, r.text
        assert model == [ROUTES[path][1]]


@pytest.fixture
def email_user(monkeypatch):
    """An email-auth session for a non-privileged user, with a chosen permission set."""
    granted: set[str] = set()

    async def attach(request, token_hint, **_kw):
        request.state.is_email_auth = True
        request.state.auth_user_id = "00000000-0000-0000-0000-0000000000aa"
        request.state.auth_user_email = "maker@example.com"
        request.state.auth_role = "user"
        return {"user_id": request.state.auth_user_id}

    async def perms(user_id, *, fresh=False):
        return set(granted)

    monkeypatch.setattr(D, "_attach_auth_session", attach)
    monkeypatch.setattr(D, "get_effective_permissions", perms)
    monkeypatch.setattr(INV, "get_effective_permissions", perms)   # _require_invoice_write
    return granted


class TestInvoiceParseNeedsWriteAccess:
    """The quota does not meter legacy tokens and require_permission waves
    them through, so the read-only viewer password could loop the model via
    /api/invoices/parse. It now takes the same gate as creating an invoice."""

    @pytest.mark.parametrize("legacy_role", ["viewer", "web", "all", "admin"])
    def test_a_legacy_token_that_cannot_create_invoices_is_refused(self, client, model, quota, legacy_role):
        r = _call(client, "/api/invoices/parse", role=legacy_role)
        assert r.status_code == 403, r.text
        assert model == []

    def test_a_scoped_email_user_who_may_create_invoices_gets_through(self, client, model, quota, email_user):
        email_user.add("module.invoices.create")
        r = _call(client, "/api/invoices/parse", role="viewer")
        assert r.status_code == 200, r.text
        assert model == ["parse_invoice"]


class TestPagesNeedAiPermission:
    @pytest.mark.parametrize("path", PAGE_ROUTES)
    def test_a_user_without_module_ai_use_is_refused(self, client, model, quota, email_user, path):
        r = _call(client, path, role="viewer")
        assert r.status_code == 403
        assert "module.ai.use" in r.json()["error"]["message"]
        assert model == []

    @pytest.mark.parametrize("path", PAGE_ROUTES)
    def test_granting_it_lets_the_same_user_through(self, client, model, quota, email_user, path):
        email_user.add("module.ai.use")
        r = _call(client, path, role="viewer")
        assert r.status_code == 200, r.text
        assert model == [ROUTES[path][1]]
