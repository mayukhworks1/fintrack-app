"""
Block document pages (content_type "doc").

The content is the editor's JSON. The server accepts and stores it, refuses
content that is not a document, reads its text for word counts and link
previews, and serves it on the public endpoints like any other page.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.pages as P
from app.services import page_doc


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    return node


DOC = {
    "type": "doc",
    "content": [
        {"type": "heading", "attrs": {"level": 1}, "content": [_t("Q4 plan")]},
        {"type": "paragraph", "content": [_t("Ship the "), _t("new", "bold"), _t(" billing flow."),
                                           {"type": "hardBreak"}, _t("Then review.")]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [{"type": "paragraph", "content": [_t("Draft")]}]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [{"type": "paragraph", "content": [_t("Sign off")]}]},
        ]},
        {"type": "callout", "attrs": {"icon": "💡", "tone": "blue"}, "content": [{"type": "paragraph", "content": [_t("Budget is fixed")]}]},
        {"type": "details", "content": [
            {"type": "detailsSummary", "content": [_t("Appendix")]},
            {"type": "detailsContent", "content": [{"type": "paragraph", "content": [_t("Hidden detail")]}]},
        ]},
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [{"type": "paragraph", "content": [_t("Item")]}]},
                {"type": "tableHeader", "content": [{"type": "paragraph", "content": [_t("Cost")]}]},
            ]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [{"type": "paragraph", "content": [_t("Hosting")]}]},
                {"type": "tableCell", "content": [{"type": "paragraph", "content": [_t("1200")]}]},
            ]},
        ]},
        {"type": "codeBlock", "attrs": {"language": "js"}, "content": [_t("const a = 1")]},
        {"type": "embed", "attrs": {"url": "https://youtu.be/dQw4w9WgXcQ"}},
        {"type": "horizontalRule"},
    ],
}
DOC_JSON = json.dumps(DOC)


class TestTextExtraction:
    def test_reads_every_block_as_its_own_line(self):
        text = page_doc.doc_text(DOC_JSON)
        lines = text.split("\n")
        assert lines[0] == "Q4 plan"
        assert "Ship the new billing flow." in lines
        assert "Then review." in lines
        assert "Draft" in lines and "Sign off" in lines
        assert "Budget is fixed" in lines
        assert "Appendix" in lines and "Hidden detail" in lines
        assert "Item\tCost" in lines and "Hosting\t1200" in lines
        assert "const a = 1" in lines
        assert "{" not in text and "type" not in text

    def test_word_count_counts_text_not_json(self):
        assert page_doc.word_count(DOC_JSON, "doc") == len(page_doc.doc_text(DOC_JSON).split())
        assert page_doc.word_count(DOC_JSON, "doc") < len(DOC_JSON.split())
        # Other types are unchanged.
        assert page_doc.word_count("one two three", "markdown") == 3
        assert page_doc.word_count('{"type":"doc"}', "text") == 1

    def test_excerpt_is_short_and_cut_at_a_word(self):
        long = json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [_t("word " * 100)]}]})
        ex = page_doc.doc_excerpt(long, 50)
        assert len(ex) <= 51 and ex.endswith("…") and not ex[:-1].endswith(" ")

    def test_empty_and_foreign_content_have_no_text(self):
        assert page_doc.doc_text("") == ""
        assert page_doc.doc_text("# just markdown") == ""
        assert page_doc.doc_text('{"type":"paragraph"}') == ""


class TestValidation:
    def test_accepts_a_document_and_empty_content(self):
        page_doc.validate_doc(DOC_JSON)
        page_doc.validate_doc("")
        page_doc.validate_doc(None)

    @pytest.mark.parametrize("bad", [
        "# markdown, not a document",
        '{"type": "paragraph"}',
        '{"type": "doc", "content": "nope"}',
        '{"type": "doc", "content": [{"text": "no type"}]}',
        '{"type": "doc", "content": [{"type": "text", "text": 5}]}',
        "[1, 2]",
    ])
    def test_refuses_what_is_not_a_document(self, bad):
        with pytest.raises(page_doc.InvalidDoc):
            page_doc.validate_doc(bad)

    def test_refuses_absurd_nesting(self):
        node = {"type": "paragraph"}
        for _ in range(100):
            node = {"type": "blockquote", "content": [node]}
        with pytest.raises(page_doc.InvalidDoc):
            page_doc.validate_doc(json.dumps({"type": "doc", "content": [node]}))


# ---------------------------------------------------------------------------
# Endpoints, against a small fake database
# ---------------------------------------------------------------------------

class FakePool:
    """Enough of asyncpg for create / update / public reads of one page."""

    def __init__(self, row=None):
        self.row = row
        self.versions = []
        self.inserted = None

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetchval(self, sql, *args):
        if "MAX(version_num)" in sql:
            return len(self.versions)
        return None  # slug is free

    async def execute(self, sql, *args):
        if "INSERT INTO page_versions" in sql:
            self.versions.append({"content": args[3], "content_type": args[4], "word_count": args[7],
                                  "note": args[8] if len(args) > 8 else None})

    async def fetchrow(self, sql, *args):
        if sql.lstrip().startswith("INSERT INTO published_pages"):
            slug, title, ctype, content, meta, pw, pwh, uid, exp = args
            self.row = _row(slug=slug, title=title, content_type=ctype, content=content, metadata=meta,
                            is_published=False, created_by=uid)
            self.inserted = self.row
            return self.row
        if sql.lstrip().startswith("UPDATE published_pages"):
            cols = [c.split(" = ")[0].strip() for c in sql.split("SET", 1)[1].split("WHERE")[0].split(",")]
            for col, val in zip(cols, args):
                self.row[col] = val
            return self.row
        if "saved_at FROM page_versions" in sql:
            return {"saved_at": datetime.now(timezone.utc)} if self.versions else None
        if self.row and args and args[0] in (self.row["slug"], str(self.row["id"])):
            return self.row
        return None


OWNER = str(uuid.uuid4())


def _row(**over):
    row = {
        "id": uuid.uuid4(), "slug": "q4-plan", "title": "Q4 plan", "content_type": "doc",
        "content": DOC_JSON, "is_published": True, "is_password_protected": False,
        "password_hash": None, "published_at": datetime.now(timezone.utc), "expires_at": None,
        "metadata": json.dumps({}), "updated_at": datetime(2026, 10, 1, tzinfo=timezone.utc),
        "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc), "created_by": OWNER, "updated_by": OWNER,
        "view_count": 0,
    }
    row.update(over)
    return row


def _req():
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=OWNER, auth_role="user"),
                           headers={"host": "api.example"})


@pytest.fixture
def pool(monkeypatch):
    def install(row=None):
        p = FakePool(row)
        monkeypatch.setattr(P, "get_pool", lambda: p)
        return p
    return install


class TestAuthoring:
    def test_a_doc_page_is_created_with_its_json(self, pool):
        p = pool()
        body = P.CreatePageBody(title="Q4 plan", content_type="doc", content=DOC_JSON)
        out = asyncio.run(P.create_page(body, _req(), role="editor"))
        assert out["content_type"] == "doc"
        assert json.loads(out["content"]) == DOC

    def test_an_empty_doc_page_is_created(self, pool):
        pool()
        out = asyncio.run(P.create_page(P.CreatePageBody(title="Blank", content_type="doc"), _req(), role="editor"))
        assert out["content_type"] == "doc" and out["content"] == ""

    def test_a_doc_page_with_non_document_content_is_refused(self, pool):
        pool()
        body = P.CreatePageBody(title="x", content_type="doc", content="# markdown")
        with pytest.raises(HTTPException) as e:
            asyncio.run(P.create_page(body, _req(), role="editor"))
        assert e.value.status_code == 422

    def test_other_types_are_not_checked(self, pool):
        pool()
        out = asyncio.run(P.create_page(P.CreatePageBody(title="x", content_type="markdown", content="{oops"), _req(), role="editor"))
        assert out["content"] == "{oops"

# Saving (version snapshots, conversion to blocks, word counts) is covered
# against Postgres in tests/test_pages_perf_pg.py::TestUpdatePage.


class TestPublic:
    def test_public_endpoint_returns_the_document(self, pool):
        pool(_row())
        resp = asyncio.run(P.public_get_page("q4-plan", request=None))
        body = json.loads(resp.body)
        assert body["content_type"] == "doc"
        assert json.loads(body["content"]) == DOC

    def test_protected_doc_still_ships_its_document(self, pool):
        """Protection for documents is enforced by the viewer, as for Markdown;
        only web pages are withheld and served through the render URL."""
        pool(_row(metadata=json.dumps({"protect_source": True})))
        body = json.loads(asyncio.run(P.public_get_page("q4-plan", request=None)).body)
        assert json.loads(body["content"]) == DOC

    def test_password_protected_doc_needs_the_password(self, pool):
        pool(_row(is_password_protected=True, password_hash=P._hash_password("pw")))
        body = json.loads(asyncio.run(P.public_get_page("q4-plan", request=None)).body)
        assert body.get("requires_password") and "content" not in body
        with pytest.raises(HTTPException) as e:
            asyncio.run(P.public_verify_password("q4-plan", P.VerifyPasswordBody(password="nope")))
        assert e.value.status_code == 401
        ok = asyncio.run(P.public_verify_password("q4-plan", P.VerifyPasswordBody(password="pw")))
        assert json.loads(ok["content"]) == DOC

    def test_link_preview_describes_a_doc_by_its_text(self, pool, monkeypatch):
        monkeypatch.setattr(P.settings, "frontend_url", "https://app.example")
        pool(_row())
        html = asyncio.run(P.public_share_card("q4-plan", _req())).body.decode()
        assert 'og:description" content="Q4 plan Ship the new billing flow.' in html
        assert "&quot;type&quot;" not in html and '"type"' not in html

    def test_written_description_wins(self, pool, monkeypatch):
        monkeypatch.setattr(P.settings, "frontend_url", "https://app.example")
        pool(_row(metadata=json.dumps({"description": "Our plan for the quarter"})))
        html = asyncio.run(P.public_share_card("q4-plan", _req())).body.decode()
        assert 'content="Our plan for the quarter"' in html
        assert "billing flow" not in html

    def test_markdown_preview_is_unchanged(self, pool, monkeypatch):
        monkeypatch.setattr(P.settings, "frontend_url", "https://app.example")
        pool(_row(content_type="markdown", content="# Secret plan"))
        f = P._share_fields(P.get_pool().row)
        assert f["description"] == ""
