"""
Pages, databases and live editing against a real Postgres (tests/pg_harness.py).

What is pinned here is what only the database can show: set-based writes
that are correct for every row and all-or-nothing, value merges that keep
concurrent edits, revision checks, the version snapshot taken in the same
statement as the save, the 0006 migration in both directions, and the
queries that replaced per-row round trips. Skipped without PostgreSQL.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException

import app.routers.databases as RD
import app.routers.page_tree as RT
import app.routers.pages as RP
from app.services import collab as C
from app.services import databases as D
from app.services import page_doc
from app.utils.fast_json import body_of
from tests import pg_harness
from tests.conftest import req

DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello there world"}]}]}
DOC_JSON = json.dumps(DOC, separators=(",", ":"))


def status(coro_fn, env):
    with pytest.raises(HTTPException) as e:
        env.run(coro_fn)
    return e.value


# ---------------------------------------------------------------------------
# Migration 0006
# ---------------------------------------------------------------------------

class TestMigration:
    def _objects(self, env):
        idx = {r["indexname"] for r in env.sql(
            "SELECT indexname FROM pg_indexes WHERE tablename IN ('published_pages','page_versions','page_views')")}
        cols = {(r["table_name"], r["column_name"]) for r in env.sql(
            "SELECT table_name, column_name FROM information_schema.columns WHERE column_name = 'asset_paths'")}
        table = env.sql("SELECT to_regclass('page_create_requests') IS NOT NULL AS t")[0]["t"]
        return idx, cols, table

    def test_upgrade_downgrade_upgrade(self, pg_upto):
        env = pg_upto("0005_comments")
        owner = env.user()
        url = "/api/public/pages/asset/pages/2026/10/abc-photo.png"
        pid = env.page(owner, "Old", content=f'<img src="{url}"><a href="{url}?x=1">x</a>')
        env.sql("INSERT INTO page_versions (page_id, content) VALUES ($1, $2)", pid,
                '{"src":"/api/public/pages/asset/pages/v/one.png"}')

        pub = env.page(owner, "Live", content="live text", published=True)

        up = pg_harness.migration_statements(pg_harness.BACKEND / "migrations/versions/0006_pages_perf.py")
        down = pg_harness.migration_statements(pg_harness.BACKEND / "migrations/versions/0006_pages_perf.py",
                                               "downgrade")
        for s in up:
            env.execute(s)
        idx, cols, table = self._objects(env)
        assert {"pp_owner_live_updated_idx", "pp_live_updated_idx", "pv_viewer_viewed_idx",
                "pver_page_num_idx", "pp_asset_paths_idx", "pver_asset_paths_idx"} <= idx
        assert cols == {("published_pages", "asset_paths"), ("page_versions", "asset_paths")} and table
        # Backfilled from existing content, query string and duplicates dropped.
        assert env.sql("SELECT asset_paths FROM published_pages WHERE id = $1", pid)[0][0] == \
            ["pages/2026/10/abc-photo.png"]
        assert env.sql("SELECT asset_paths FROM page_versions WHERE page_id = $1", pid)[0][0] == ["pages/v/one.png"]
        # A page published before the migration publishes exactly its content;
        # an unpublished one has no published copy.
        assert env.sql("SELECT published_content IS NULL AS n FROM published_pages WHERE id = $1", pid)[0][0]
        live = env.sql("SELECT published_content, published_title, draft_changed FROM published_pages "
                       "WHERE id = $1", pub)[0]
        assert (live["published_content"], live["published_title"], live["draft_changed"]) == \
            ("live text", "Live", False)
        # One unique index on slug, and the bootstrap does not add one back.
        slug_idx = lambda: [r["indexname"] for r in env.sql(  # noqa: E731
            "SELECT indexname FROM pg_indexes WHERE tablename = 'published_pages' AND indexdef LIKE '%(slug)%'")]
        assert slug_idx() == ["idx_published_pages_slug"]
        from app.db.postgres import SCHEMA
        env.execute(SCHEMA)
        assert slug_idx() == ["idx_published_pages_slug"]
        with pytest.raises(Exception):
            env.page(owner, "Dup", slug=env.sql("SELECT slug FROM published_pages WHERE id = $1", pid)[0][0])

        for s in down:
            env.execute(s)
        idx, cols, table = self._objects(env)
        assert not cols and not table and "pp_live_updated_idx" not in idx
        assert sorted(slug_idx()) == ["idx_published_pages_slug", "published_pages_slug_key"]
        for s in up:
            env.execute(s)
        assert self._objects(env)[2]

    def test_trigger_keeps_asset_paths(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "A", content="no assets")
        assert pg.sql("SELECT asset_paths FROM published_pages WHERE id = $1", pid)[0][0] == []
        pg.sql("UPDATE published_pages SET content = $2 WHERE id = $1", pid,
               'x "/api/public/pages/asset/pages/a/b.png" y &quot;/api/public/pages/asset/pages/c.png&quot;')
        assert sorted(pg.sql("SELECT asset_paths FROM published_pages WHERE id = $1", pid)[0][0]) == \
            ["pages/a/b.png", "pages/c.png"]


# ---------------------------------------------------------------------------
# Page list and tree
# ---------------------------------------------------------------------------

def _database(env, owner, rows=3, title="Deals"):
    schema, _samples, _icon = D.template("blank")
    db = env.page(owner, title, content_type="database", metadata={"database": schema})
    ids = [env.page(owner, f"Row {i}", parent=db, metadata={"props": {}, "db_row": db}, position=float(i))
           for i in range(rows)]
    return db, ids


class TestListAndTree:
    def test_list_leaves_out_rows_and_slims_metadata(self, pg):
        owner = pg.user()
        page = pg.page(owner, "Notes", metadata={"folder": "Ops", "description": "d", "sheet": {"big": "x" * 1000}})
        db, rows = _database(pg, owner)
        resp = pg.run(lambda pool: RP.list_pages(req(owner), "editor"))
        items = body_of(resp)
        assert {i["id"] for i in items} == {page, db}
        notes = next(i for i in items if i["id"] == page)
        assert notes["metadata"] == {"folder": "Ops", "description": "d", "_slim": True}
        full = body_of(pg.run(lambda pool: RP.list_pages(req(owner), "editor", include_rows=True, full_metadata=True)))
        assert len(full) == 2 + len(rows) and "sheet" in next(i for i in full if i["id"] == page)["metadata"]

    def test_list_etag_and_304(self, pg):
        owner = pg.user()
        pg.page(owner, "A")
        first = pg.run(lambda pool: RP.list_pages(req(owner), "editor"))
        tag = first.headers["etag"]
        again = pg.run(lambda pool: RP.list_pages(req(owner, headers={"if-none-match": tag}), "editor"))
        assert again.status_code == 304 and again.body == b""
        pg.page(owner, "B")
        changed = pg.run(lambda pool: RP.list_pages(req(owner, headers={"if-none-match": tag}), "editor"))
        assert changed.status_code == 200 and len(body_of(changed)) == 2

    def test_list_pages_through(self, pg):
        owner = pg.user()
        for i in range(5):
            pg.page(owner, f"P{i}")
        r1 = pg.run(lambda pool: RP.list_pages(req(owner), "editor", limit=3))
        r2 = pg.run(lambda pool: RP.list_pages(req(owner), "editor", limit=3, offset=3))
        assert r1.headers["x-has-more"] == "1" and r2.headers["x-has-more"] == "0"
        ids = [i["id"] for i in body_of(r1) + body_of(r2)]
        assert len(ids) == len(set(ids)) == 5

    def test_slim_metadata_sent_back_keeps_the_rest(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Sheet", metadata={"folder": "Ops", "sheet": {"widths": [1, 2]}})
        item = body_of(pg.run(lambda pool: RP.list_pages(req(owner), "editor")))[0]
        # As the page list's "move to folder" does: spread the item's metadata.
        meta = {**item["metadata"]}
        meta.pop("folder")
        out = pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(metadata=meta), req(owner), "editor"))
        assert out["metadata"] == {"sheet": {"widths": [1, 2]}}
        assert "_slim" not in json.loads(pg.sql("SELECT metadata FROM published_pages WHERE id = $1", pid)[0][0])

    def test_tree_leaves_out_rows_and_answers_304(self, pg):
        owner = pg.user()
        top = pg.page(owner, "Top")
        db, rows = _database(pg, owner)
        resp = pg.run(lambda pool: RT.page_tree(req(owner), "editor"))
        data = body_of(resp)
        assert {n["id"] for n in data["pages"]} == {top, db}
        assert not next(n for n in data["pages"] if n["id"] == db)["has_children"]
        again = pg.run(lambda pool: RT.page_tree(req(owner, headers={"if-none-match": resp.headers["etag"]}), "editor"))
        assert again.status_code == 304
        withrows = body_of(pg.run(lambda pool: RT.page_tree(req(owner), "editor", include_rows=True)))
        assert len(withrows["pages"]) == 2 + len(rows)

    def test_recent_matches_the_definition(self, pg):
        owner, other = pg.user(), pg.user()
        ids = [pg.page(owner, f"P{i}") for i in range(12)]
        pg.page(other, "Theirs")
        for i, pid in enumerate(ids):
            pg.sql("UPDATE published_pages SET updated_at = NOW() - interval '1 minute' * $2 WHERE id = $1",
                   pid, (i * 7) % 12 + 1)
        # Opened recently: an old page jumps to the top.
        pg.sql("UPDATE published_pages SET updated_at = NOW() - interval '30 days' WHERE id = $1", ids[0])
        pg.sql("INSERT INTO page_views (page_id, viewer_user_id, viewed_at) VALUES ($1, $2, NOW())", ids[0], owner)
        got = pg.run(lambda pool: RT.page_recent(req(owner), 5, "editor"))
        expected = pg.sql(
            "SELECT p.id FROM published_pages p LEFT JOIN LATERAL (SELECT MAX(viewed_at) AS seen FROM page_views "
            "WHERE page_id = p.id AND viewer_user_id = $1) v ON TRUE WHERE p.deleted_at IS NULL AND p.created_by = $1 "
            "ORDER BY GREATEST(p.updated_at, COALESCE(v.seen, p.updated_at)) DESC LIMIT 5", owner)
        assert [g["id"] for g in got] == [str(r["id"]) for r in expected]
        assert got[0]["id"] == ids[0]


# ---------------------------------------------------------------------------
# Context endpoint
# ---------------------------------------------------------------------------

class TestContext:
    def test_shape(self, pg):
        owner = pg.user()
        root = pg.page(owner, "Root")
        mid = pg.page(owner, "Mid", parent=root)
        db, rows = _database(pg, owner)
        row = rows[0]
        pg.sql("UPDATE published_pages SET parent_id = $1 WHERE id = $2", mid, db)
        kids = [pg.page(owner, f"Kid {i}", parent=row, position=float(i)) for i in range(3)]
        pg.page(owner, "Grandkid", parent=kids[0])
        tid = str(uuid.uuid4())
        pg.sql("INSERT INTO page_comments (id, page_id, thread_id, author_user_id, body) VALUES ($1, $2, $1, $3, 'x')",
               tid, row, owner)
        out = pg.run(lambda pool: RT.page_context(row, req(owner), "editor", children_limit=2))
        single = pg.run(lambda pool: RP.get_page(row, req(owner), "editor"))
        assert out["page"] == single
        assert [b["title"] for b in out["breadcrumbs"]] == ["Root", "Mid", "Deals"]
        assert [c["title"] for c in out["children"]] == ["Kid 0", "Kid 1"] and out["children_has_more"]
        assert out["children"][0]["has_children"] is True
        rc = out["row_context"]
        assert rc["database"]["id"] == db and rc["row"]["id"] == row and "properties" in rc["database"]["database"]
        assert out["open_thread_count"] == 1
        plain = pg.run(lambda pool: RT.page_context(kids[1], req(owner), "editor"))
        assert plain["row_context"] is None and plain["children"] == [] and not plain["children_has_more"]

    def test_access(self, pg):
        owner, other = pg.user(), pg.user()
        pid = pg.page(owner, "Mine")
        assert status(lambda pool: RT.page_context(pid, req(other), "editor"), pg).status_code == 403
        assert status(lambda pool: RT.page_context(str(uuid.uuid4()), req(owner), "editor"), pg).status_code == 404


# ---------------------------------------------------------------------------
# Saving a page
# ---------------------------------------------------------------------------

class TestUpdatePage:
    def test_version_is_the_previous_content_and_word_count_fills_in(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc")
        new = DOC_JSON.replace("Hello", "Goodbye")
        out = pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content=new), req(owner), "editor"))
        assert out["content"] == new
        v = pg.sql("SELECT content, word_count, version_num FROM page_versions WHERE page_id = $1", pid)
        assert len(v) == 1 and v[0]["content"] == DOC_JSON and v[0]["version_num"] == 1
        listed = pg.run(lambda pool: RP.list_page_versions(pid, req(owner), 50, "editor"))
        assert listed["items"][0]["word_count"] == page_doc.word_count(DOC_JSON, "doc") == 3
        assert pg.sql("SELECT word_count FROM page_versions WHERE page_id = $1", pid)[0][0] == 3

    def test_autosave_is_throttled_but_a_note_or_another_writer_is_not(self, pg):
        owner, admin = pg.user(), pg.user()
        pid = pg.page(owner, "Doc", content="a")
        save = lambda text, who=owner, role="editor", note=None: pg.run(  # noqa: E731
            lambda pool: RP.update_page(pid, RP.UpdatePageBody(content=text, version_note=note), req(who, role), role))
        save("b")
        save("c")
        assert pg.sql("SELECT count(*) FROM page_versions WHERE page_id = $1", pid)[0][0] == 1
        save("d", note="Checkpoint")
        assert pg.sql("SELECT note FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0][0] == "Checkpoint"
        # Someone else saves over the owner's work: the owner's copy is kept.
        save("e", who=admin, role="superadmin")
        last = pg.sql("SELECT content, saved_by FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0]
        assert last["content"] == "d" and str(last["saved_by"]) == admin
        # ...and back again.
        save("f")
        assert pg.sql("SELECT content FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0][0] == "e"

    def test_converting_markdown_saves_a_named_version_first(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Q4", content="# Q4 plan\n\nShip it.")
        pg.sql("INSERT INTO page_versions (page_id, content) VALUES ($1, 'older')", pid)
        body = RP.UpdatePageBody(content_type="doc", content=DOC_JSON, version_note="Before converting to blocks")
        out = pg.run(lambda pool: RP.update_page(pid, body, req(owner), "editor"))
        assert out["content_type"] == "doc" and json.loads(out["content"]) == DOC
        snap = pg.sql("SELECT content, content_type, note FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0]
        assert (snap["content"], snap["content_type"], snap["note"]) == ("# Q4 plan\n\nShip it.", "markdown",
                                                                         "Before converting to blocks")

    def test_switching_to_doc_needs_document_content(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Md", content="# hi")
        e = status(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content_type="doc"), req(owner), "editor"), pg)
        assert e.status_code == 422

    def test_stale_base_is_a_conflict(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content="one")
        first = pg.run(lambda pool: RP.get_page(pid, req(owner), "editor"))
        ok = pg.run(lambda pool: RP.update_page(
            pid, RP.UpdatePageBody(content="two", base_updated_at=first["updated_at"]), req(owner), "editor"))
        e = status(lambda pool: RP.update_page(
            pid, RP.UpdatePageBody(content="three", base_updated_at=first["updated_at"]), req(owner), "editor"), pg)
        assert e.status_code == 409 and e.detail["code"] == "conflict"
        assert e.detail["current"]["updated_at"] == ok["updated_at"]
        assert pg.sql("SELECT content FROM published_pages WHERE id = $1", pid)[0][0] == "two"
        # Without a base the save applies (older clients).
        pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="four"), req(owner), "editor"))
        assert pg.sql("SELECT content FROM published_pages WHERE id = $1", pid)[0][0] == "four"

    def test_trashed_page_refuses_writes(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc")
        pg.run(lambda pool: RT.trash_page(pid, req(owner), "editor"))
        for fn in (lambda pool: RP.update_page(pid, RP.UpdatePageBody(title="x"), req(owner), "editor"),
                   lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"),
                   lambda pool: RT.set_appearance(pid, RT.AppearanceBody(icon="x"), req(owner), "editor")):
            e = status(fn, pg)
            assert e.status_code == 409 and "trash" in e.detail

    def test_size_cap(self, pg, monkeypatch):
        owner = pg.user()
        pid = pg.page(owner, "Doc")
        monkeypatch.setattr(RP, "MAX_CONTENT_CHARS", 10)
        e = status(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="x" * 11), req(owner), "editor"), pg)
        assert e.status_code == 413 and "too large" in e.detail
        e = status(lambda pool: RP.create_page(RP.CreatePageBody(title="t", content="x" * 11), req(owner), "editor"), pg)
        assert e.status_code == 413

    def test_snapshot_failure_does_not_abort_the_transaction(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc")

        async def go(pool):
            async with pool.acquire() as conn:
                async with conn.transaction():
                    # A row that cannot be inserted (page id that does not exist).
                    await RP._snapshot_version(conn, str(uuid.uuid4()), {"title": "t", "content": "c",
                                               "content_type": "markdown", "metadata": "{}"}, owner, note="n")
                    await conn.execute("UPDATE published_pages SET title = 'still works' WHERE id = $1", pid)
        pg.run(go)
        assert pg.sql("SELECT title FROM published_pages WHERE id = $1", pid)[0][0] == "still works"

    def test_legacy_session_without_user_cannot_edit_ownerless_page(self, pg):
        pid = pg.page(None, "Legacy")
        e = status(lambda pool: RP.update_page(pid, RP.UpdatePageBody(title="x"), req(None, "editor"), "editor"), pg)
        assert e.status_code == 403


    def test_live_room_refuses_content_but_not_settings(self, pg, monkeypatch):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc")

        async def busy(page_id, force=False):
            raise C.Busy("live")
        monkeypatch.setattr(RP.collab, "before_external_write", busy)
        e = status(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content=DOC_JSON), req(owner), "editor"), pg)
        assert e.status_code == 409
        out = pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(title="Renamed", content_type="doc"),
                                                 req(owner), "editor"))
        assert out["title"] == "Renamed" and out["content"] == DOC_JSON

    def test_flushed_live_edits_are_kept_in_history(self, pg, monkeypatch):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc")
        pg.sql("INSERT INTO page_versions (page_id, content, saved_by) VALUES ($1, 'older', $2)", pid, owner)

        async def flushed(page_id, force=False):
            return "Live edits before this change"
        monkeypatch.setattr(RP.collab, "before_external_write", flushed)
        pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content=DOC_JSON), req(owner), "editor"))
        assert pg.sql("SELECT note FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0][0] == \
            "Live edits before this change"


class TestDrafts:
    def _public(self, env, slug):
        return json.loads(env.run(lambda pool: RP.public_get_page(slug, request=None)).body)

    def test_edits_stay_a_draft_until_published(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Launch", content="v1", slug="launch")
        out = pg.run(lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"))
        assert out["has_unpublished_changes"] is False and out["published_at_rev"]
        assert "published_content" not in out
        pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(title="Launch (draft)", content="v2"),
                                           req(owner), "editor"))
        pub = self._public(pg, "launch")
        assert (pub["content"], pub["title"]) == ("v1", "Launch")
        page = pg.run(lambda pool: RP.get_page(pid, req(owner), "editor"))
        assert page["content"] == "v2" and page["has_unpublished_changes"] is True
        assert "published_content" not in page and "draft_changed" not in page
        listed = body_of(pg.run(lambda pool: RP.list_pages(req(owner), "editor")))
        assert listed[0]["has_unpublished_changes"] is True
        html = pg.run(lambda pool: RP.public_render_page("launch")).body.decode()
        assert "v1" in html and "v2" not in html
        # Publishing again ("Update") makes the draft public.
        out = pg.run(lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"))
        assert out["has_unpublished_changes"] is False
        assert self._public(pg, "launch")["content"] == "v2"
        # Editing back to the published text clears the flag by itself.
        pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="v3"), req(owner), "editor"))
        upd = pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="v2"), req(owner), "editor"))
        assert upd["has_unpublished_changes"] is False

    def test_an_unpublished_page_has_no_pending_changes(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Draft")
        out = pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="x"), req(owner), "editor"))
        assert out["has_unpublished_changes"] is False

    def test_live_edits_do_not_reach_the_public(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc", slug="doc-live")
        pg.run(lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"))
        new = DOC_JSON.replace("Hello", "Draft")
        assert pg.run(lambda pool: C.PgPageStore().save(pid, new, base=DOC_JSON, user_id=owner))
        assert json.loads(self._public(pg, "doc-live")["content"]) == DOC

    def test_published_copy_keeps_its_files_in_use(self, pg):
        owner = pg.user()
        img = '<img src="/api/public/pages/asset/pages/p/pub.png">'
        pid = pg.page(owner, "Pic", content=img, slug="pic")
        pg.run(lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"))
        pg.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="no picture"), req(owner), "editor"))
        assert "pages/p/pub.png" in pg.run(lambda pool: RP._asset_page_owners(pool, ["pages/p/pub.png"]))

    def test_publishing_rows_publishes_their_copies(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        row = str(pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 LIMIT 1", db["id"])[0][0])
        pg.sql("UPDATE published_pages SET content = 'row body' WHERE id = $1", row)
        pg.run(lambda pool: RD.publish_rows(db["id"], RD.PublishRowsBody(published=True), req(owner), "editor"))
        assert pg.sql("SELECT published_content FROM published_pages WHERE id = $1", row)[0][0] == "row body"

    def test_before_migration_0006_the_page_is_served_as_stored(self, pg_upto):
        env = pg_upto("0005_comments")
        owner = env.user()
        pid = env.page(owner, "Old", content="v1", slug="old")
        env.run(lambda pool: RP.publish_page(pid, RP.PublishBody(published=True), req(owner), "editor"))
        out = env.run(lambda pool: RP.update_page(pid, RP.UpdatePageBody(content="v2"), req(owner), "editor"))
        assert out["has_unpublished_changes"] is False
        assert json.loads(env.run(lambda pool: RP.public_get_page("old", request=None)).body)["content"] == "v2"


class TestCreate:
    def test_client_request_id_dedupes(self, pg):
        owner = pg.user()
        body = RP.CreatePageBody(title="New", client_request_id="req-12345678")
        a = pg.run(lambda pool: RP.create_page(body, req(owner), "editor"))
        b = pg.run(lambda pool: RP.create_page(body, req(owner), "editor"))
        assert a["id"] == b["id"]
        # Concurrent retries: one page.
        body2 = RP.CreatePageBody(title="Other", client_request_id="req-abcdefgh")

        async def both(pool):
            return await asyncio.gather(RP.create_page(body2, req(owner), "editor"),
                                        RP.create_page(body2, req(owner), "editor"))
        x, y = pg.run(both)
        assert x["id"] == y["id"]
        assert pg.sql("SELECT count(*) FROM published_pages")[0][0] == 2
        # Another user with the same id gets their own page.
        someone = pg.user()
        c = pg.run(lambda pool: RP.create_page(body, req(someone), "editor"))
        assert c["id"] != a["id"]

    def test_dedupe_without_migration_0006(self, pg_upto):
        env = pg_upto("0005_comments")
        owner = env.user()
        body = RP.CreatePageBody(title="New", client_request_id="req-12345678")
        a = env.run(lambda pool: RP.create_page(body, req(owner), "editor"))
        b = env.run(lambda pool: RP.create_page(body, req(owner), "editor"))
        assert a["id"] == b["id"]

    def test_child_is_created_under_its_parent_in_one_insert(self, pg):
        owner = pg.user()
        parent = pg.page(owner, "Parent")
        out = pg.run(lambda pool: RT.create_child_page(parent, RP.CreatePageBody(title="Kid"), req(owner), "editor"))
        assert out["parent_id"] == parent
        assert str(pg.sql("SELECT parent_id FROM published_pages WHERE id = $1", out["id"])[0][0]) == parent


class TestDelete:
    def test_delete_moves_the_subtree_to_the_trash(self, pg):
        owner = pg.user()
        db, rows = _database(pg, owner)
        out = pg.run(lambda pool: RP.delete_page(db, req(owner), "editor"))
        assert set(out["trashed"]) == {db, *rows}
        assert pg.sql("SELECT count(*) FROM published_pages WHERE deleted_at IS NULL")[0][0] == 0

    def test_delete_forever_cleans_rows_left_behind_and_checks_assets_once(self, pg, monkeypatch):
        owner = pg.user()
        db, rows = _database(pg, owner)
        pg.sql("UPDATE published_pages SET content = $2 WHERE id = $1", rows[0],
               '<img src="/api/public/pages/asset/pages/x/one.png">')
        pg.run(lambda pool: RT.trash_page(db, req(owner), "editor"))
        pg.run(lambda pool: RT.restore_page(rows[1], req(owner), "editor"))   # restored on its own
        checks, deleted = [], []

        async def owners(pool, paths):
            checks.append(list(paths))
            return {}

        async def gone(path):
            deleted.append(path)
        monkeypatch.setattr(RP, "_asset_page_owners", owners)
        import app.services.storage as S
        monkeypatch.setattr(S, "delete_path", gone)
        pg.run(lambda pool: RT.delete_page_forever(db, req(owner), "editor"))
        left = pg.sql("SELECT metadata FROM published_pages WHERE id = $1", rows[1])[0][0]
        assert "db_row" not in json.loads(left) and "props" not in json.loads(left)
        assert checks == [["pages/x/one.png"]] and deleted == ["pages/x/one.png"]


class TestAssets:
    def test_reference_lookup_uses_the_arrays_and_matches_the_old_scan(self, pg):
        owner, other = pg.user(), pg.user()
        pg.page(owner, "A", content='<img src="/api/public/pages/asset/pages/a/one.png">')
        b = pg.page(other, "B", content="nothing")
        pg.sql("INSERT INTO page_versions (page_id, content) VALUES ($1, $2)", b,
               '{"src":"/api/public/pages/asset/pages/a/one.png"}')
        paths = ["pages/a/one.png", "pages/a/none.png"]
        new = pg.run(lambda pool: RP._asset_page_owners(pool, paths))
        assert {str(o) for o in new["pages/a/one.png"]} == {owner, other} and "pages/a/none.png" not in new


# ---------------------------------------------------------------------------
# Tree structure
# ---------------------------------------------------------------------------

class TestMove:
    def _order(self, env, parent):
        return [r["title"] for r in env.sql(
            "SELECT title FROM published_pages WHERE parent_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL "
            "ORDER BY position, created_at", parent)]

    def test_index_placement_and_renumbering(self, pg):
        owner = pg.user()
        root = pg.page(owner, "Root")
        a = pg.page(owner, "A", parent=root, position=1.0)
        pg.page(owner, "B", parent=root, position=1.0 + 1e-9)
        c = pg.page(owner, "C", parent=root, position=5.0)
        pg.run(lambda pool: RT.move_page(c, RT.MoveBody(parent_id=root, index=0), req(owner), "editor"))
        assert self._order(pg, root) == ["C", "A", "B"]
        # No room between A and B: everything is renumbered in one statement.
        pg.run(lambda pool: RT.move_page(c, RT.MoveBody(parent_id=root, index=1), req(owner), "editor"))
        assert self._order(pg, root) == ["A", "C", "B"]
        positions = [r[0] for r in pg.sql("SELECT position FROM published_pages WHERE parent_id = $1 ORDER BY position", root)]
        assert positions == [1024.0, 2048.0, 3072.0]
        pg.run(lambda pool: RT.move_page(a, RT.MoveBody(parent_id=root), req(owner), "editor"))
        assert self._order(pg, root) == ["C", "B", "A"]
        pg.run(lambda pool: RT.move_page(a, RT.MoveBody(parent_id=None, index=99), req(owner), "editor"))
        assert self._order(pg, None)[-1] == "A"

    def test_row_moved_out_of_its_database_stops_being_a_row(self, pg):
        owner = pg.user()
        db, rows = _database(pg, owner)
        pg.sql("UPDATE published_pages SET metadata = metadata || '{\"props\": {\"x\": 1}}' WHERE id = $1", rows[0])
        pg.run(lambda pool: RT.move_page(rows[0], RT.MoveBody(parent_id=None), req(owner), "editor"))
        meta = json.loads(pg.sql("SELECT metadata FROM published_pages WHERE id = $1", rows[0])[0][0])
        assert "db_row" not in meta and "props" not in meta
        # Reordered inside its database it stays a row.
        pg.run(lambda pool: RT.move_page(rows[1], RT.MoveBody(parent_id=db, index=0), req(owner), "editor"))
        assert "db_row" in json.loads(pg.sql("SELECT metadata FROM published_pages WHERE id = $1", rows[1])[0][0])

    def test_concurrent_moves_cannot_make_a_cycle(self, pg):
        owner = pg.user()
        a, b = pg.page(owner, "A"), pg.page(owner, "B")

        async def both(pool):
            return await asyncio.gather(
                RT.move_page(a, RT.MoveBody(parent_id=b), req(owner), "editor"),
                RT.move_page(b, RT.MoveBody(parent_id=a), req(owner), "editor"),
                return_exceptions=True)
        results = pg.run(both)
        errors = [r for r in results if isinstance(r, HTTPException)]
        assert len(errors) == 1 and errors[0].status_code == 409
        parents = {str(r["id"]): r["parent_id"] for r in pg.sql("SELECT id, parent_id FROM published_pages")}
        assert parents[a] is None or parents[b] is None

    def test_children_are_bounded_with_a_cursor(self, pg, monkeypatch):
        owner = pg.user()
        root = pg.page(owner, "Root")
        for i in range(7):
            pg.page(owner, f"K{i}", parent=root, position=float(i))
        from fastapi.responses import Response
        seen, cursor = [], None
        while True:
            resp = Response()
            got = pg.run(lambda pool: RT.page_children(root, req(owner), "editor", limit=3, cursor=cursor, response=resp))
            seen += [g["title"] for g in got]
            cursor = resp.headers.get("x-next-cursor")
            if not cursor:
                break
        assert seen == [f"K{i}" for i in range(7)]


# ---------------------------------------------------------------------------
# Databases
# ---------------------------------------------------------------------------

def _tasks_db(env, owner):
    return env.run(lambda pool: RD.create_database(RD.CreateDatabaseBody(title="Tasks", template="tasks"),
                                                    req(owner), "editor"))


def _prop(db, ptype):
    return next(p["id"] for p in db["database"]["properties"] if p["type"] == ptype)


class TestImport:
    def _body(self, rows, import_id=None, mapping=None):
        csv = "Name,Notes\n" + "\n".join(f"{t},{n}" for t, n in rows)
        return RD.ImportBody(csv=csv, mapping=mapping or [{"column": 0, "prop": "title"},
                                                          {"column": 1, "new_type": "text", "name": "Notes"}],
                             import_id=import_id)

    def test_one_insert_for_every_row(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        before = pg.sql("SELECT count(*), max(position) FROM published_pages WHERE parent_id = $1", db["id"])[0]
        hostile = "Robert'); DROP TABLE published_pages --"
        rows = [("Same", "a"), ("Same", "b"), (hostile, "=cmd|' /C calc'!A0"), ("", "untitled")]
        out = pg.run(lambda pool: RD.import_csv(db["id"], self._body(rows), req(owner), "editor"))
        assert out["created"] == 4 and out["database"]["revision"] >= 1
        got = pg.sql("SELECT title, slug, position, metadata FROM published_pages WHERE parent_id = $1 "
                     "AND position > $2 ORDER BY position", db["id"], before[1])
        assert [g["title"] for g in got] == ["Same", "Same", hostile, ""]
        assert len({g["slug"] for g in got}) == 4
        assert all(g["position"] > before[1] for g in got)
        notes = next(p["id"] for p in out["database"]["properties"] if p["name"] == "Notes")
        assert json.loads(got[2]["metadata"])["props"][notes] == "=cmd|' /C calc'!A0"
        assert json.loads(got[0]["metadata"])["db_row"] == db["id"]

    def test_a_retried_import_creates_nothing_twice(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        n0 = pg.sql("SELECT count(*) FROM published_pages WHERE parent_id = $1", db["id"])[0][0]
        body = self._body([("A", "1"), ("B", "2")], import_id="imp-1")

        async def twice(pool):
            return await asyncio.gather(RD.import_csv(db["id"], body, req(owner), "editor"),
                                        RD.import_csv(db["id"], body, req(owner), "editor"))
        a, b = pg.run(twice)
        assert sorted([bool(a.get("duplicate")), bool(b.get("duplicate"))]) == [False, True]
        assert a["created"] == b["created"] == 2
        assert pg.sql("SELECT count(*) FROM published_pages WHERE parent_id = $1", db["id"])[0][0] == n0 + 2

    def test_permissions_and_bad_input(self, pg):
        owner, other = pg.user(), pg.user()
        db = _tasks_db(pg, owner)
        assert status(lambda pool: RD.import_csv(db["id"], self._body([("A", "1")]), req(other), "editor"),
                      pg).status_code == 403
        bad = self._body([("A", "1")], mapping=[{"column": 9, "prop": "title"}])
        assert status(lambda pool: RD.import_csv(db["id"], bad, req(owner), "editor"), pg).status_code == 422
        many = self._body([("A", "1")], mapping=[{"column": 0, "prop": "title"}] * 201)
        assert status(lambda pool: RD.import_csv(db["id"], many, req(owner), "editor"), pg).status_code == 422


class TestRows:
    def test_bulk_is_one_update_and_all_or_nothing(self, pg):
        owner, other = pg.user(), pg.user()
        db = _tasks_db(pg, owner)
        status_prop = next(p for p in db["database"]["properties"] if p["type"] == "select")
        opt = status_prop["options"][-1]["id"]
        rows = [str(r["id"]) for r in pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 ORDER BY position", db["id"])]
        items = [RD.BulkItem(id=rows[0], props={status_prop["id"]: opt}, position=1.5),
                 RD.BulkItem(id=rows[1], title="Renamed"),
                 RD.BulkItem(id=rows[0], title="Twice")]
        out = pg.run(lambda pool: RD.bulk_update_rows(db["id"], RD.BulkBody(updates=items), req(owner), "editor"))
        assert [r["id"] for r in out["rows"]] == [rows[0], rows[1]]
        assert out["rows"][0]["props"][status_prop["id"]] == opt and out["rows"][0]["title"] == "Twice"
        assert out["rows"][0]["position"] == 1.5 and out["rows"][1]["title"] == "Renamed"
        # A row of another database: nothing at all is written.
        other_db = _tasks_db(pg, owner)
        foreign = str(pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 LIMIT 1", other_db["id"])[0][0])
        bad = [RD.BulkItem(id=rows[2], title="Should not stick"), RD.BulkItem(id=foreign, title="x")]
        assert status(lambda pool: RD.bulk_update_rows(db["id"], RD.BulkBody(updates=bad), req(owner), "editor"),
                      pg).status_code == 404
        assert pg.sql("SELECT title FROM published_pages WHERE id = $1", rows[2])[0][0] != "Should not stick"
        # Someone else's row in a database the caller can reach (superadmin
        # made it): 403.
        theirs = pg.page(other, "Theirs", parent=db["id"], metadata={"props": {}, "db_row": db["id"]})
        e = status(lambda pool: RD.bulk_update_rows(db["id"], RD.BulkBody(updates=[RD.BulkItem(id=theirs, title="x")]),
                                                    req(owner), "editor"), pg)
        assert e.status_code == 403
        # Invalid values are refused before anything is written.
        e = status(lambda pool: RD.bulk_update_rows(db["id"], RD.BulkBody(updates=[
            RD.BulkItem(id=rows[0], props={"nope": 1})]), req(owner), "editor"), pg)
        assert e.status_code == 422

    def test_delete_rows_takes_their_sub_pages(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        rows = [str(r["id"]) for r in pg.sql("SELECT id FROM published_pages WHERE parent_id = $1", db["id"])]
        sub = pg.page(owner, "Sub", parent=rows[0])
        out = pg.run(lambda pool: RD.delete_rows(db["id"], RD.IdsBody(ids=rows[:2]), req(owner), "editor"))
        assert set(out["trashed"]) == {rows[0], rows[1], sub}
        stamps = {r[0] for r in pg.sql("SELECT deleted_at FROM published_pages WHERE id = ANY($1::uuid[])", out["trashed"])}
        assert len(stamps) == 1
        e = status(lambda pool: RD.delete_rows(db["id"], RD.IdsBody(ids=[rows[2], db["id"]]), req(owner), "editor"), pg)
        assert e.status_code == 404
        assert pg.sql("SELECT deleted_at FROM published_pages WHERE id = $1", rows[2])[0][0] is None

    def test_concurrent_cell_edits_are_all_kept(self, pg):
        owner = pg.user()
        db = pg.run(lambda pool: RD.create_database(RD.CreateDatabaseBody(title="CRM", template="crm"), req(owner), "editor"))
        texts = [p["id"] for p in db["database"]["properties"] if p["type"] in ("text", "url", "number")][:4]
        assert len(texts) >= 2
        row = str(pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 LIMIT 1", db["id"])[0][0])
        props = {p["id"]: p for p in db["database"]["properties"]}
        value = lambda pid, i: i if props[pid]["type"] == "number" else (  # noqa: E731
            f"https://x.in/{i}" if props[pid]["type"] == "url" else f"v{i}")

        async def edits(pool):
            await asyncio.gather(*(RD.update_row(db["id"], row, RD.RowPatchBody(props={pid: value(pid, n)}),
                                                 req(owner), "editor")
                                   for n in range(5) for pid in texts))
        pg.run(edits)
        stored = json.loads(pg.sql("SELECT metadata FROM published_pages WHERE id = $1", row)[0][0])["props"]
        for pid in texts:
            assert pid in stored

    def test_cell_edit_is_checked_against_the_schema_it_lands_on(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        row = str(pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 LIMIT 1", db["id"])[0][0])
        victim = next(p for p in db["database"]["properties"] if p["type"] not in ("title",) and p["type"] not in D.COMPUTED_TYPES)

        async def race(pool):
            async with pool.acquire() as locker:
                tr = locker.transaction()
                await tr.start()
                await locker.execute("SELECT 1 FROM published_pages WHERE id = $1 FOR UPDATE", db["id"])
                value = {"select": victim.get("options", [{}])[0].get("id"), "multi_select": [],
                         "checkbox": True, "number": 1, "date": "2026-01-01"}.get(victim["type"], "x")
                edit = asyncio.create_task(RD.update_row(db["id"], row, RD.RowPatchBody(props={victim["id"]: value}),
                                                         req(owner), "editor"))
                await asyncio.sleep(0.3)
                assert not edit.done()          # waiting on the schema lock
                # The property goes away while the edit waits.
                schema = json.loads(await locker.fetchval("SELECT metadata FROM published_pages WHERE id = $1", db["id"]))
                schema["database"]["properties"] = [p for p in schema["database"]["properties"] if p["id"] != victim["id"]]
                await locker.execute("UPDATE published_pages SET metadata = $2::jsonb WHERE id = $1", db["id"], json.dumps(schema))
                await tr.commit()
                with pytest.raises(HTTPException) as e:
                    await edit
                return e.value.status_code
        assert pg.run(race) == 422

    def test_schema_revision_and_deleted_list(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        schema = db["database"]
        rev = schema["revision"]
        props = [dict(p) for p in schema["properties"]]
        keep_out = next(p for p in props if p["type"] not in ("title", "select", "date"))
        # A tab that does not know about keep_out: it stays.
        sent = [p for p in props if p["id"] != keep_out["id"]]
        out = pg.run(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(properties=sent, revision=rev, deleted=[]),
                                                   req(owner), "editor"))
        assert keep_out["id"] in {p["id"] for p in out["database"]["properties"]}
        assert out["database"]["revision"] == rev + 1
        # Its stale revision now: 409 with the current schema.
        e = status(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(properties=props, revision=rev),
                                                 req(owner), "editor"), pg)
        assert e.status_code == 409 and e.detail["database"]["revision"] == rev + 1
        # Removing needs the id in `deleted`.
        out = pg.run(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(
            properties=props, revision=rev + 1, deleted=[keep_out["id"]]), req(owner), "editor"))
        assert keep_out["id"] not in {p["id"] for p in out["database"]["properties"]}
        # An older client (no revision, no deleted): left out still means removed.
        legacy = [p for p in out["database"]["properties"] if p["id"] == "title"]
        table = [{"id": "v_table", "name": "Table", "type": "table"}]
        out = pg.run(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(properties=legacy, views=table),
                                                   req(owner), "editor"))
        assert [p["id"] for p in out["database"]["properties"]] == ["title"]

    def test_retype_converts_every_row_in_one_statement(self, pg):
        owner = pg.user()
        db = pg.run(lambda pool: RD.create_database(RD.CreateDatabaseBody(title="CRM", template="crm"), req(owner), "editor"))
        text = next(p for p in db["database"]["properties"] if p["type"] == "text")
        rows = [str(r["id"]) for r in pg.sql("SELECT id FROM published_pages WHERE parent_id = $1", db["id"])]
        for i, r in enumerate(rows):
            pg.sql("UPDATE published_pages SET metadata = jsonb_set(metadata, '{props}', metadata->'props' || $2::jsonb) "
                   "WHERE id = $1", r, json.dumps({text["id"]: "Hot" if i % 2 else "Cold"}))
        props = [dict(p, type="select", options=[]) if p["id"] == text["id"] else p for p in db["database"]["properties"]]
        out = pg.run(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(properties=props), req(owner), "editor"))
        opts = {o["name"]: o["id"] for o in next(p for p in out["database"]["properties"] if p["id"] == text["id"])["options"]}
        assert set(opts) == {"Hot", "Cold"}
        stored = {json.loads(m[0])["props"][text["id"]] for m in pg.sql(
            "SELECT metadata FROM published_pages WHERE parent_id = $1", db["id"])}
        assert stored == set(opts.values())

    def test_view_endpoint_touches_only_that_view(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        rev = db["database"]["revision"]
        # Someone adds a property meanwhile.
        props = db["database"]["properties"] + [{"id": "p_new", "name": "Added", "type": "text"}]
        pg.run(lambda pool: RD.update_schema(db["id"], RD.SchemaBody(properties=props), req(owner), "editor"))
        view = dict(db["database"]["views"][0], name="Renamed view")
        out = pg.run(lambda pool: RD.put_view(db["id"], view["id"], RD.ViewBody(view=view), req(owner), "editor"))
        assert out["view"]["name"] == "Renamed view"
        assert "p_new" in {p["id"] for p in out["database"]["properties"]}
        assert out["database"]["revision"] == rev + 2
        e = status(lambda pool: RD.put_view(db["id"], view["id"], RD.ViewBody(view=view, revision=rev), req(owner), "editor"), pg)
        assert e.status_code == 409
        new_view = {"name": "Board 2", "type": "table"}
        out = pg.run(lambda pool: RD.put_view(db["id"], "v_two", RD.ViewBody(view=new_view, make_default=True), req(owner), "editor"))
        assert out["database"]["default_view"] == "v_two"
        out = pg.run(lambda pool: RD.delete_view(db["id"], "v_two", req(owner), None, "editor"))
        assert "v_two" not in {v["id"] for v in out["database"]["views"]}

    def test_get_with_rows_and_query_with_database(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        out = pg.run(lambda pool: RD.get_database(db["id"], req(owner), "editor", rows=True))
        assert out["query"]["total"] == len(out["query"]["rows"]) > 0 and out["database"]["revision"] == 0
        q = pg.run(lambda pool: RD.query_rows(db["id"], RD.QueryBody(include_database=True), req(owner), "editor"))
        assert q["database"]["id"] == db["id"] and q["rows"]

    def test_export_and_public_rows_read_past_one_page(self, pg, monkeypatch):
        owner = pg.user()
        db, _rows = _database(pg, owner, rows=0)
        pg.sql("INSERT INTO published_pages (slug, title, metadata, created_by, parent_id, position) "
               "SELECT 'r-' || g, 'R' || g, jsonb_build_object('props', '{}'::jsonb, 'db_row', $1::text), $2, $1::uuid, g "
               "FROM generate_series(1, 650) g", db, owner)
        resp = pg.run(lambda pool: RD.export_csv(db, req(owner), "editor"))
        assert resp.body.decode("utf-8").count("\r\n") == 651
        page = pg.sql("SELECT * FROM published_pages WHERE id = $1", db)[0]
        out = pg.run(lambda pool: RD.public_rows(pool, page))
        assert len(out["database_rows"]) == 650

    def test_row_writes_need_the_database_alive(self, pg):
        owner = pg.user()
        db = _tasks_db(pg, owner)
        row = str(pg.sql("SELECT id FROM published_pages WHERE parent_id = $1 LIMIT 1", db["id"])[0][0])
        pg.run(lambda pool: RT.trash_page(db["id"], req(owner), "editor"))
        e = status(lambda pool: RD.update_row(db["id"], row, RD.RowPatchBody(title="x"), req(owner), "editor"), pg)
        assert e.status_code == 409


# ---------------------------------------------------------------------------
# Live editing storage
# ---------------------------------------------------------------------------

class TestCollabStore:
    def test_load_is_light_and_save_snapshots_in_one_statement(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc")
        store = C.PgPageStore()
        rec = pg.run(lambda pool: store.load(pid))
        assert rec.content is None and rec.size == len(DOC_JSON) and not rec.trashed
        new = DOC_JSON.replace("Hello", "Hi")
        assert pg.run(lambda pool: store.save(pid, new, base=DOC_JSON, user_id=owner)) is True
        assert pg.sql("SELECT content FROM published_pages WHERE id = $1", pid)[0][0] == new
        v = pg.sql("SELECT content, note FROM page_versions WHERE page_id = $1", pid)
        assert [(x["content"], x["note"]) for x in v] == [(DOC_JSON, None)]
        # Written elsewhere since: kept in History with a note, then saved.
        pg.sql("UPDATE published_pages SET content = $2 WHERE id = $1", pid, DOC_JSON.replace("Hello", "Other"))
        assert pg.run(lambda pool: store.save(pid, new + " ", base=new, user_id=owner)) is True
        last = pg.sql("SELECT content, note FROM page_versions WHERE page_id = $1 ORDER BY id DESC LIMIT 1", pid)[0]
        assert last["note"] == "Saved before live edits were merged" and "Other" in last["content"]
        pg.run(lambda pool: RT.trash_page(pid, req(owner), "editor"))
        assert pg.run(lambda pool: store.save(pid, new, base=new + " ", user_id=owner)) is False

    def test_too_large_page_is_not_opened_live(self, pg):
        owner = pg.user()
        pid = pg.page(owner, "Doc", content=DOC_JSON, content_type="doc")
        C.limits.max_live_content_chars = 10

        async def go(pool):
            rec = await C.get_hub().store.load(pid)
            with pytest.raises(C.TooLarge):
                await C.get_hub().join(rec, client=None)
        pg.run(go)
        assert not C.get_hub().rooms
