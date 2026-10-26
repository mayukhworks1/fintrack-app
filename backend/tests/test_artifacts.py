"""
Artifacts: interactive mini-apps stored as pages with content_type "artifact".

An artifact must be accepted wherever a page type is, be generated with its own
brief, and be served exactly as a Web Page is — the same renderer, the same
sandbox, the same Content-Security-Policy. The public routes are called
directly against a one-page fake database.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.routers.artifacts as A
import app.routers.pages as P
from app.services import artifact, page_ai, page_render

DOC = (
    "<!DOCTYPE html><html><head><title>GST Calculator</title>"
    '<meta name="description" content="Work out GST &amp; totals in ₹.">'
    "</head><body><button id=go>Go</button><script>go.onclick=()=>1</script></body></html>"
)


class OnePagePool:
    def __init__(self, row):
        self.row = row
        self.inserted = None

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetchrow(self, sql, *args):
        if sql.lstrip().upper().startswith("INSERT"):
            self.inserted = args
            return {**self.row, "content_type": args[2], "content": args[3]}
        key = args[0] if args else None
        return self.row if key in (self.row["slug"], str(self.row["id"])) else None

    async def fetchval(self, sql, *args):
        return None


def _row(**over):
    row = {
        "id": uuid.uuid4(), "slug": "gst", "title": "GST", "content_type": "artifact",
        "content": DOC, "is_published": True, "is_password_protected": False,
        "password_hash": None, "published_at": datetime.now(timezone.utc),
        "expires_at": None, "metadata": json.dumps({}), "updated_at": None,
        "created_by": None, "updated_by": None, "created_at": None,
    }
    row.update(over)
    return row


@pytest.fixture
def page(monkeypatch):
    def install(**over):
        pool = OnePagePool(_row(**over))
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        monkeypatch.setattr(A, "get_pool", lambda: pool)
        return pool
    return install


def _render(slug="gst", t=None):
    return asyncio.run(P.public_render_page(slug, t))


def _get(slug="gst"):
    return json.loads(asyncio.run(P.public_get_page(slug, request=None)).body)


class _Req:
    def __init__(self, user_id=None, role="user"):
        self.state = type("S", (), {"auth_user_id": user_id, "auth_role": role})()
        self.headers = {"host": "api.example"}


class TestAccepted:
    def test_create_stores_an_artifact(self, page, monkeypatch):
        pool = page()

        async def no_images(c):
            return c, 0
        monkeypatch.setattr(P, "externalise_inline_images", no_images)
        body = P.CreatePageBody(title="GST", content_type="artifact", content=DOC)
        out = asyncio.run(P.create_page(body, _Req("u1"), role="editor"))
        assert pool.inserted[2] == "artifact"
        assert out["content_type"] == "artifact"

    def test_page_builder_accepts_the_type(self):
        assert "artifact" in page_ai._SUPPORTED_TYPES
        assert page_ai._rules_for("artifact", "a GST calculator") == artifact.ARTIFACT_RULES

    def test_other_types_are_still_refused(self):
        with pytest.raises(ValueError, match="Web Page and Document"):
            asyncio.run(page_ai.generate_page("x", content_type="csv"))


class TestRenderedLikeHtml:
    def test_same_document_and_headers_as_a_web_page(self, page):
        page(content_type="artifact")
        art = _render()
        page(content_type="html")
        web = _render()
        assert art.body == web.body
        assert art.headers["content-security-policy"] == web.headers["content-security-policy"]

    def test_csp_carries_the_sandbox_without_same_origin(self, page):
        page()
        resp = _render()
        csp = resp.headers["content-security-policy"]
        assert f"sandbox {page_render.PAGE_SANDBOX}" in csp
        assert "allow-same-origin" not in csp
        assert "object-src 'none'" in csp
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert "go.onclick" in resp.body.decode()

    def test_unpublished_artifact_is_not_served(self, page):
        page(is_published=False)
        with pytest.raises(HTTPException) as e:
            _render()
        assert e.value.status_code == 404

    def test_protected_artifact_ships_no_source(self, page):
        page(metadata=json.dumps({"protect_source": True}))
        body = _get()
        assert body["content"] == "" and body["render_token"]
        with pytest.raises(HTTPException):
            _render()
        assert "contextmenu" in _render(t=body["render_token"]).body.decode()

    def test_password_protected_artifact_needs_a_token(self, page):
        page(is_password_protected=True)
        assert _get()["requires_password"] is True
        with pytest.raises(HTTPException) as e:
            _render()
        assert e.value.status_code == 401


class TestLinkPreview:
    def test_description_comes_from_the_document(self):
        assert artifact.describe(DOC) == "Work out GST & totals in ₹."

    def test_falls_back_to_the_title(self):
        assert artifact.describe("<html><head><title> EMI  planner </title></head></html>") == "EMI planner"
        assert artifact.describe("") == ""

    def test_share_card_uses_it(self, page, monkeypatch):
        monkeypatch.setattr(P.settings, "frontend_url", "https://app.example")
        page()
        html = asyncio.run(P.public_share_card("gst", _Req())).body.decode()
        assert "Work out GST &amp; totals in ₹." in html

    def test_an_authored_description_wins(self, page):
        page(metadata=json.dumps({"description": "Mine"}))
        assert P._share_fields(_row(metadata=json.dumps({"description": "Mine"})))["description"] == "Mine"


class TestEmbedById:
    def test_needs_a_token(self, page):
        pool = page()
        with pytest.raises(HTTPException) as e:
            asyncio.run(A.render_artifact_by_id(str(pool.row["id"]), None))
        assert e.value.status_code == 401

    def test_a_slug_token_does_not_unlock_it(self, page):
        pool = page()
        with pytest.raises(HTTPException):
            asyncio.run(A.render_artifact_by_id(str(pool.row["id"]), P._render_token("gst")))

    def test_owner_mints_a_token_that_renders(self, page):
        pool = page(is_published=False, created_by="u1")
        pid = str(pool.row["id"])
        tok = asyncio.run(A.mint_artifact_token(pid, _Req("u1"), role="editor"))["token"]
        resp = asyncio.run(A.render_artifact_by_id(pid, tok))
        assert "go.onclick" in resp.body.decode()
        assert f"sandbox {page_render.PAGE_SANDBOX}" in resp.headers["content-security-policy"]

    def test_someone_else_cannot_mint(self, page):
        pool = page(created_by="u1")
        with pytest.raises(HTTPException) as e:
            asyncio.run(A.mint_artifact_token(str(pool.row["id"]), _Req("u2"), role="editor"))
        assert e.value.status_code == 403


class TestGeneration:
    def test_build_uses_the_artifact_brief_and_skips_stock_images(self, monkeypatch):
        seen = {}

        async def fake_chat(messages, **kw):
            seen["messages"] = messages
            seen["task"] = kw.get("task")
            return {"content": "```html\n" + DOC.replace("<body>", '<body><div class="placeholder">Finance</div>') + "\n```",
                    "model": "m", "model_short": "m"}
        monkeypatch.setattr(page_ai, "_try_chat", fake_chat)
        out = asyncio.run(page_ai.generate_page("GST calculator", content_type="artifact"))
        assert seen["task"] == "page_build"
        assert seen["messages"][0]["content"] == artifact.ARTIFACT_RULES
        assert "unsplash" not in out["content"]
        assert out["content"].startswith("<!DOCTYPE html>")

    def test_brief_names_the_constraints(self):
        rules = artifact.ARTIFACT_RULES
        for phrase in ("NO network calls", "localStorage", "prefers-color-scheme", "aria-live", "en-IN"):
            assert phrase in rules
        for host in artifact.CDN_ALLOWLIST:
            assert host in rules

    def test_refine_goes_through_the_edit_path_with_the_artifact_note(self, monkeypatch):
        captured = {}

        async def admit(task):
            captured["task"] = task

        class Cascade:
            def __init__(self, task):
                self.dead = set()

            async def provider_for(self, spec):
                return object()

            def failed(self, *a, **k):
                pass

            def give_up(self):
                raise RuntimeError("no model")

        async def ordered(task):
            return [object()]

        def build(spec, messages, **kw):
            captured["messages"] = messages
            raise RuntimeError("stop")

        monkeypatch.setattr(page_ai.gateway, "admit", admit)
        monkeypatch.setattr(page_ai, "_Cascade", Cascade)
        monkeypatch.setattr(page_ai, "_ordered_models", ordered)
        monkeypatch.setattr(page_ai, "_build_payload", build)
        monkeypatch.setattr(page_ai, "_failure_text", lambda exc, p: str(exc))

        async def run():
            frames = []
            with pytest.raises(RuntimeError, match="no model"):
                async for f in page_ai.stream_generate_page("make it blue", content_type="artifact", existing=DOC):
                    frames.append(f)
            return frames

        frames = asyncio.run(run())
        assert captured["task"] == "page_build"
        assert frames[0]["mode"] == "edit"
        system = captured["messages"][0]["content"]
        assert system.startswith(page_ai.page_edit.EDIT_RULES)
        assert artifact.REVISION_NOTE in system


class TestStorageBridge:
    def test_prelude_can_seed_and_report_storage(self):
        out = page_render.build_document(DOC)
        assert "__ftstore:" in out and "__ft_artifact_store" in out
        # The prelude still runs before any author script.
        assert out.index("__ftstore:") < out.index("go.onclick")
