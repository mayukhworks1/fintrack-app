"""
Shared artifact data (window.fintrack.db) against a real Postgres.

The routes are driven over ASGI with httpx, on the same event loop as the
database pool. Owner identity comes from a stand-in for require_auth that
reads X-Test-User; anonymous visitors send X-Visitor-Id like the app does.
Pinned here: the migration, the "not ready" answer before it runs, the change
cursor (deletes included, nothing skipped under concurrency), scoping to the
page and to the person, every access setting, password / expiry /
unpublished checks, the caps and rate limits, queries, atomic increment and
upsert, single-record documents, files, long-poll wake-ups, export and the
settings surviving an editor save. Skipped without PostgreSQL.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request

import app.routers.artifact_data as R
import app.routers.pages as RP
from app.services import artifact_data as D
from tests import pg_harness
from tests.conftest import req

VA = "visitor-aaaaaaaaaaaaaaaaaaaa"
VB = "visitor-bbbbbbbbbbbbbbbbbbbb"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _app(monkeypatch):
    async def fake_auth(request: Request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "Missing authorization token")
        request.state.auth_user_id = uid
        request.state.auth_role = request.headers.get("x-test-role", "user")
        return "editor"

    async def optional_user(request: Request):
        uid = request.headers.get("x-test-user")
        return (uid, request.headers.get("x-test-role", "user")) if uid else (None, None)

    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[R.require_auth] = fake_auth
    monkeypatch.setattr(R, "_optional_user", optional_user)
    D.reset_rate_limits()
    return app


@pytest.fixture
def env(pg, monkeypatch):
    pg.app = _app(monkeypatch)
    pg.owner = pg.user("Owner")
    pg.slug = f"todo-{uuid.uuid4().hex[:6]}"
    pg.pid = pg.page(pg.owner, "Todo", content_type="artifact", content="<p>x</p>", published=True, slug=pg.slug)
    pg.sql("UPDATE published_pages SET published_at = NOW() - INTERVAL '1 hour', "
           "published_at_rev = NOW() - INTERVAL '1 hour', published_content = content, "
           "published_content_type = content_type, published_title = title WHERE id = $1", pg.pid)
    return pg


def call(env, fn):
    async def main(pool):
        transport = httpx.ASGITransport(app=env.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            return await fn(c)
    return env.run(main)


def pub(env, slug=None):
    return f"/api/public/pages/{slug or env.slug}/data"


def own(env, pid=None):
    return f"/api/pages/{pid or env.pid}/data"


def V(v):
    return {"X-Visitor-Id": v}


def O(env, uid=None):
    return {"X-Test-User": uid or env.owner}


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

class TestMigration:
    def test_upgrade_downgrade_upgrade(self, pg_upto):
        env = pg_upto("0006_pages_perf")
        path = pg_harness.BACKEND / "migrations/versions/0007_artifact_records.py"
        up = pg_harness.migration_statements(path)
        down = pg_harness.migration_statements(path, "downgrade")
        exists = lambda: env.sql("SELECT to_regclass('artifact_records') IS NOT NULL AS t")[0]["t"]  # noqa: E731
        assert not exists()
        for s in up:
            env.execute(s)
        idx = {r["indexname"] for r in env.sql("SELECT indexname FROM pg_indexes WHERE tablename = 'artifact_records'")}
        assert {"ar_page_coll_created_idx", "ar_page_seq_idx", "ar_page_key_uidx", "ar_data_gin_idx"} <= idx
        for s in down:
            env.execute(s)
        assert not exists()
        for s in up:
            env.execute(s)
        assert exists()

    def test_records_go_with_their_page(self, env):
        call(env, lambda c: c.post(pub(env) + "/todos", json={"data": {"t": 1}}, headers=V(VA)))
        env.sql("DELETE FROM published_pages WHERE id = $1", env.pid)
        assert env.sql("SELECT COUNT(*) AS n FROM artifact_records")[0]["n"] == 0

    def test_not_ready_is_503(self, pg_upto, monkeypatch):
        env = pg_upto("0006_pages_perf")
        env.app = _app(monkeypatch)
        owner = env.user()
        env.page(owner, "T", content_type="artifact", published=True, slug="t-ready")
        r = call(env, lambda c: c.get("/api/public/pages/t-ready/data/todos"))
        assert r.status_code == 503 and "not available yet" in r.json()["detail"]


# ---------------------------------------------------------------------------
# The shared to-do list, end to end
# ---------------------------------------------------------------------------

class TestSharedRecords:
    def test_two_visitors_and_the_owner_see_the_same_list(self, env):
        async def flow(c):
            s = (await c.get(pub(env), headers=V(VA))).json()
            assert s["settings"] == {"access": "link_write", "own_only": False}
            assert s["me"]["canAdd"] and not s["me"]["isOwner"]
            a = (await c.post(pub(env) + "/todos", json={"data": {"title": "Milk", "done": False}}, headers=V(VA))).json()
            b = (await c.post(pub(env) + "/todos", json={"data": {"title": "Eggs"}}, headers=V(VB))).json()
            assert a["mine"] and a["scope"] == "shared" and b["seq"] > a["seq"]
            seen_b = (await c.get(pub(env) + "/todos", headers=V(VB))).json()
            assert [r["data"]["title"] for r in seen_b["records"]] == ["Milk", "Eggs"]
            assert [r["mine"] for r in seen_b["records"]] == [False, True]
            owner = (await c.get(own(env) + "/todos", headers=O(env))).json()
            assert [r["data"]["title"] for r in owner["records"]] == ["Milk", "Eggs"]
            assert owner["records"][0]["author"].startswith("Visitor ")
            # B ticks A's task (field-level merge keeps the title), then deletes it.
            p = (await c.patch(pub(env) + f"/todos/{a['id']}", json={"data": {"done": True}}, headers=V(VB))).json()
            assert p["data"] == {"title": "Milk", "done": True} and p["version"] == 2
            cur = seen_b["cursor"]
            d = await c.delete(pub(env) + f"/todos/{a['id']}", headers=V(VB))
            assert d.status_code == 200 and d.json()["deleted"]
            ch = (await c.get(pub(env) + f"/changes?since={cur}", headers=V(VA))).json()
            # A record appears once, in its latest state: here, deleted.
            assert [(x["id"], x.get("deleted", False)) for x in ch["changes"]] == [(a["id"], True)]
            assert ch["changes"][-1]["data"] is None and ch["cursor"] >= ch["changes"][-1]["seq"]
            again = (await c.get(pub(env) + f"/changes?since={ch['cursor']}", headers=V(VA))).json()
            assert again["changes"] == [] and again["cursor"] == ch["cursor"]
            listed = (await c.get(pub(env) + "/todos", headers=V(VA))).json()
            assert [r["data"]["title"] for r in listed["records"]] == ["Eggs"]
        call(env, flow)

    def test_visitor_id_is_stored_hashed(self, env):
        call(env, lambda c: c.post(pub(env) + "/todos", json={"data": {"t": 1}}, headers=V(VA)))
        stored = env.sql("SELECT created_by_visitor FROM artifact_records")[0][0]
        assert stored and VA not in stored and stored == D.visitor_hash(VA)

    def test_a_write_needs_an_identity(self, env):
        r = call(env, lambda c: c.post(pub(env) + "/todos", json={"data": {"t": 1}}))
        assert r.status_code == 400
        r = call(env, lambda c: c.post(pub(env) + "/todos", json={"data": {"t": 1}}, headers=V("short")))
        assert r.status_code == 400

    def test_a_web_page_takes_no_data_from_visitors(self, env):
        slug = "web-" + uuid.uuid4().hex[:6]
        env.page(env.owner, "Web", content_type="html", content="<p>x</p>", published=True, slug=slug)

        async def flow(c):
            me = (await c.get(pub(env, slug), headers=V(VA))).json()
            assert me["me"]["canAdd"] is False
            r = await c.post(pub(env, slug) + "/todos", json={"data": {"t": "spam"}}, headers=V(VA))
            assert r.status_code == 403
        call(env, flow)

    def test_records_are_scoped_to_their_page(self, env):
        other_slug = "other-" + uuid.uuid4().hex[:6]
        other = env.page(env.owner, "Other", content_type="artifact", published=True, slug=other_slug)

        async def flow(c):
            a = (await c.post(pub(env) + "/todos", json={"data": {"t": "secret"}}, headers=V(VA))).json()
            assert (await c.get(pub(env, other_slug) + "/todos", headers=V(VA))).json()["records"] == []
            for res in (await c.patch(pub(env, other_slug) + f"/todos/{a['id']}", json={"data": {"t": 1}}, headers=V(VA)),
                        await c.delete(pub(env, other_slug) + f"/todos/{a['id']}", headers=V(VA)),
                        await c.get(pub(env, other_slug) + f"/todos/{a['id']}", headers=V(VA)),
                        await c.delete(own(env, other) + f"/todos/{a['id']}", headers=O(env))):
                assert res.status_code == 404
            ch = (await c.get(pub(env, other_slug) + "/changes?since=0", headers=V(VA))).json()
            assert ch["changes"] == []
        call(env, flow)

    def test_cursor_never_skips_under_concurrent_writes(self, env):
        async def flow(c):
            await asyncio.gather(*(c.post(pub(env) + "/todos", json={"data": {"n": i}}, headers=V(VA if i % 2 else VB))
                                   for i in range(30)))
            got, cur = [], 0
            while True:
                ch = (await c.get(pub(env) + f"/changes?since={cur}", headers=V(VA))).json()
                got += ch["changes"]
                cur = ch["cursor"]
                if not ch["has_more"]:
                    break
            assert sorted(x["data"]["n"] for x in got) == list(range(30))
            seqs = [x["seq"] for x in got]
            assert seqs == sorted(seqs) and len(set(seqs)) == 30
        D.VISITOR_WRITES_PER_MIN, old = 1000, D.VISITOR_WRITES_PER_MIN
        try:
            call(env, flow)
        finally:
            D.VISITOR_WRITES_PER_MIN = old

    def test_a_cursor_from_the_future_resets(self, env):
        r = call(env, lambda c: c.get(pub(env) + "/changes?since=999999999", headers=V(VA))).json()
        assert r["reset"] is True and r["changes"] == []


# ---------------------------------------------------------------------------
# Access settings
# ---------------------------------------------------------------------------

def _set(env, access, own_only=False):
    r = call(env, lambda c: c.put(own(env) + "/settings", json={"access": access, "own_only": own_only}, headers=O(env)))
    assert r.status_code == 200, r.text


class TestAccess:
    def test_owner_only(self, env):
        a = call(env, lambda c: c.post(own(env) + "/todos", json={"data": {"t": 1}}, headers=O(env))).json()
        _set(env, "owner")

        async def flow(c):
            assert (await c.get(pub(env) + "/todos", headers=V(VA))).status_code == 200
            assert (await c.post(pub(env) + "/todos", json={"data": {"t": 2}}, headers=V(VA))).status_code == 403
            assert (await c.patch(pub(env) + f"/todos/{a['id']}", json={"data": {"t": 2}}, headers=V(VA))).status_code == 403
            assert (await c.delete(pub(env) + f"/todos/{a['id']}", headers=V(VA))).status_code == 403
            s = (await c.get(pub(env), headers=V(VA))).json()
            assert s["me"]["canAdd"] is False and s["settings"]["access"] == "owner"
            # The owner, signed in, on the public page acts as the owner.
            assert (await c.post(pub(env) + "/todos", json={"data": {"t": 3}}, headers=O(env))).status_code == 200
            # Another signed-in user is just a visitor.
            stranger = env.owner_b
            assert (await c.post(pub(env) + "/todos", json={"data": {"t": 4}}, headers=O(env, stranger))).status_code == 403
        env.owner_b = env.user("Stranger")
        call(env, flow)

    def test_link_read(self, env):
        _set(env, "link_read")
        r = call(env, lambda c: c.post(pub(env) + "/todos", json={"data": {"t": 2}}, headers=V(VA)))
        assert r.status_code == 403

    def test_own_only(self, env):
        _set(env, "link_write", own_only=True)

        async def flow(c):
            a = (await c.post(pub(env) + "/todos", json={"data": {"t": "A"}}, headers=V(VA))).json()
            assert (await c.patch(pub(env) + f"/todos/{a['id']}", json={"data": {"t": "B"}}, headers=V(VB))).status_code == 403
            assert (await c.delete(pub(env) + f"/todos/{a['id']}", headers=V(VB))).status_code == 403
            assert (await c.post(pub(env) + f"/todos/{a['id']}/increment", json={"field": "n"}, headers=V(VB))).status_code == 403
            assert (await c.patch(pub(env) + f"/todos/{a['id']}", json={"data": {"t": "A2"}}, headers=V(VA))).status_code == 200
            # The owner moderates everything.
            assert (await c.delete(own(env) + f"/todos/{a['id']}", headers=O(env))).status_code == 200
        call(env, flow)

    def test_settings_validation_and_owner_only(self, env):
        stranger = env.user("Stranger")

        async def flow(c):
            assert (await c.put(own(env) + "/settings", json={"access": "everyone"}, headers=O(env))).status_code == 422
            assert (await c.put(own(env) + "/settings", json={"access": "owner", "own_only": "yes"}, headers=O(env))).status_code == 422
            assert (await c.put(own(env) + "/settings", json={"access": "owner"}, headers=O(env, stranger))).status_code == 403
            assert (await c.get(own(env) + "/todos", headers=O(env, stranger))).status_code == 403
            assert (await c.get(own(env) + "/export", headers=O(env, stranger))).status_code == 403
            assert (await c.delete(own(env) + "/todos", headers=O(env, stranger))).status_code == 403
            assert (await c.get(own(env) + "/todos")).status_code == 401
            # A superadmin may.
            assert (await c.get(own(env) + "/todos", headers={**O(env, stranger), "X-Test-Role": "superadmin"})).status_code == 200
        call(env, flow)

    def test_settings_survive_an_editor_save(self, env):
        _set(env, "owner", True)
        before = env.sql("SELECT updated_at FROM published_pages WHERE id = $1", env.pid)[0][0]
        env.run(lambda pool: RP.update_page(env.pid, RP.UpdatePageBody(metadata={"description": "x"}), req(env.owner), "editor"))
        meta = json.loads(env.sql("SELECT metadata FROM published_pages WHERE id = $1", env.pid)[0][0])
        assert meta["data"] == {"access": "owner", "own_only": True} and meta["description"] == "x"
        assert before is not None


# ---------------------------------------------------------------------------
# Page protection
# ---------------------------------------------------------------------------

class TestProtection:
    def test_unpublished_only_through_the_owner_door(self, env):
        pid = env.page(env.owner, "Draft", content_type="artifact", published=False, slug="draft-x")

        async def flow(c):
            assert (await c.get("/api/public/pages/draft-x/data/todos", headers=V(VA))).status_code == 404
            assert (await c.post("/api/public/pages/draft-x/data/todos", json={"data": {}}, headers=V(VA))).status_code == 404
            assert (await c.post(own(env, pid) + "/todos", json={"data": {"t": 1}}, headers=O(env))).status_code == 200
            assert len((await c.get(own(env, pid) + "/todos", headers=O(env))).json()["records"]) == 1
        call(env, flow)

    def test_not_an_artifact(self, env):
        env.page(env.owner, "Doc", content_type="markdown", published=True, slug="md-x")
        assert call(env, lambda c: c.get("/api/public/pages/md-x/data/todos")).status_code == 404

    def test_trashed(self, env):
        env.sql("UPDATE published_pages SET deleted_at = NOW() WHERE id = $1", env.pid)
        assert call(env, lambda c: c.get(pub(env) + "/todos")).status_code == 404

    def test_expired(self, env):
        env.sql("UPDATE published_pages SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", env.pid)

        async def flow(c):
            assert (await c.get(pub(env) + "/todos", headers=V(VA))).status_code == 410
            assert (await c.post(pub(env) + "/todos", json={"data": {}}, headers=V(VA))).status_code == 410
            assert (await c.get(pub(env) + "/changes", headers=V(VA))).status_code == 410
        call(env, flow)

    def test_password(self, env):
        env.sql("UPDATE published_pages SET is_password_protected = TRUE, password_hash = 'x' WHERE id = $1", env.pid)
        good = RP._render_token(env.slug)
        wrong = RP._render_token("some-other-slug")

        async def flow(c):
            for h in ({}, {"X-Page-Token": "nonsense"}, {"X-Page-Token": wrong}):
                assert (await c.get(pub(env) + "/todos", headers={**V(VA), **h})).status_code == 401
                assert (await c.post(pub(env) + "/todos", json={"data": {}}, headers={**V(VA), **h})).status_code == 401
            ok = await c.post(pub(env) + "/todos", json={"data": {"t": 1}}, headers={**V(VA), "X-Page-Token": good})
            assert ok.status_code == 200
            expired = RP._render_token(env.slug, ttl=-5)
            assert (await c.get(pub(env) + "/todos", headers={**V(VA), "X-Page-Token": expired})).status_code == 401
        call(env, flow)


# ---------------------------------------------------------------------------
# Caps, validation, rate limits
# ---------------------------------------------------------------------------

class TestCaps:
    def test_validation(self, env):
        async def flow(c):
            h = V(VA)
            assert (await c.post(pub(env) + "/1bad", json={"data": {}}, headers=h)).status_code == 422
            assert (await c.post(pub(env) + "/a'b", json={"data": {}}, headers=h)).status_code in (404, 422)
            assert (await c.post(pub(env) + "/x" * 1 + "y" * 45, json={"data": {}}, headers=h)).status_code == 422
            assert (await c.get(pub(env) + "/_files_x", headers=h)).status_code == 422
            assert (await c.post(pub(env) + "/todos", json={"data": [1, 2]}, headers=h)).status_code == 422
            assert (await c.post(pub(env) + "/todos", json={"data": "str"}, headers=h)).status_code == 422
            assert (await c.post(pub(env) + "/todos", content=b"not json", headers=h)).status_code == 422
            assert (await c.post(pub(env) + "/todos", json=[1], headers=h)).status_code == 422
            big = {"data": {"t": "x" * (D.MAX_RECORD_BYTES + 10)}}
            assert (await c.post(pub(env) + "/todos", json=big, headers=h)).status_code == 413
            huge = b'{"data":{"t":"' + b"x" * 100_000 + b'"}}'
            assert (await c.post(pub(env) + "/todos", content=huge, headers=h)).status_code == 413
            deep: dict = {}
            cur = deep
            for _ in range(20):
                cur["a"] = {}
                cur = cur["a"]
            assert (await c.post(pub(env) + "/todos", json={"data": deep}, headers=h)).status_code == 422
            assert (await c.patch(pub(env) + "/todos/not-a-uuid", json={"data": {}}, headers=h)).status_code == 404
            assert (await c.get(pub(env) + "/todos?where=%7Bbad", headers=h)).status_code == 422
            assert (await c.get(pub(env) + "/todos?order_by=a;drop", headers=h)).status_code == 422
            assert (await c.get(pub(env) + "/todos?where=" + json.dumps({"x y": 1}), headers=h)).status_code == 422
            # SQL-looking values are only ever parameters.
            r = await c.post(pub(env) + "/todos", json={"data": {"t": "'); DROP TABLE artifact_records; --"}}, headers=h)
            assert r.status_code == 200
            w = json.dumps({"t": "'); DROP TABLE artifact_records; --"})
            assert len((await c.get(pub(env) + "/todos", params={"where": w}, headers=h)).json()["records"]) == 1
        call(env, flow)

    def test_record_and_collection_caps(self, env, monkeypatch):
        monkeypatch.setattr(D, "MAX_RECORDS_PER_PAGE", 3)
        monkeypatch.setattr(D, "MAX_COLLECTIONS", 2)

        async def flow(c):
            h = V(VA)
            assert (await c.post(pub(env) + "/a", json={"data": {}}, headers=h)).status_code == 200
            assert (await c.post(pub(env) + "/b", json={"data": {}}, headers=h)).status_code == 200
            r = await c.post(pub(env) + "/c", json={"data": {}}, headers=h)
            assert r.status_code == 409 and "collections" in r.json()["detail"]
            assert (await c.post(pub(env) + "/a", json={"data": {}}, headers=h)).status_code == 200
            r = await c.post(pub(env) + "/a", json={"data": {}}, headers=h)
            assert r.status_code == 409 and "full" in r.json()["detail"]
            # Deleting frees room; the owner is held to the same caps.
            rid = (await c.get(pub(env) + "/a", headers=h)).json()["records"][0]["id"]
            assert (await c.delete(pub(env) + f"/a/{rid}", headers=h)).status_code == 200
            assert (await c.post(own(env) + "/b", json={"data": {}}, headers=O(env))).status_code == 200
            assert (await c.post(own(env) + "/b", json={"data": {}}, headers=O(env))).status_code == 409
        call(env, flow)

    def test_rate_limits(self, env, monkeypatch):
        monkeypatch.setattr(D, "VISITOR_WRITES_PER_MIN", 3)
        monkeypatch.setattr(D, "IP_WRITES_PER_MIN", 5)

        async def flow(c):
            codes = [(await c.post(pub(env) + "/t", json={"data": {}}, headers=V(VA))).status_code for _ in range(4)]
            assert codes == [200, 200, 200, 429]
            # Another visitor from the same address hits the address limit.
            codes = [(await c.post(pub(env) + "/t", json={"data": {}}, headers=V(VB))).status_code for _ in range(3)]
            assert codes == [200, 200, 429]
            # Reads are not limited.
            assert (await c.get(pub(env) + "/t", headers=V(VA))).status_code == 200
        call(env, flow)


# ---------------------------------------------------------------------------
# Private scope
# ---------------------------------------------------------------------------

class TestPrivate:
    def test_private_records_belong_to_one_person(self, env):
        user = env.user("Signed in")

        async def flow(c):
            a = (await c.post(pub(env) + "/notes", json={"data": {"t": "A's"}, "scope": "private"}, headers=V(VA))).json()
            assert a["scope"] == "private"
            await c.post(pub(env) + "/notes", json={"data": {"t": "shared"}}, headers=V(VB))
            mine = (await c.get(pub(env) + "/notes?scope=private", headers=V(VA))).json()["records"]
            assert [r["data"]["t"] for r in mine] == ["A's"]
            assert (await c.get(pub(env) + "/notes?scope=private", headers=V(VB))).json()["records"] == []
            shared = (await c.get(pub(env) + "/notes", headers=V(VB))).json()["records"]
            assert [r["data"]["t"] for r in shared] == ["shared"]
            # Nothing of A's reaches B by any other route.
            assert (await c.get(pub(env) + f"/notes/{a['id']}", headers=V(VB))).status_code == 404
            assert (await c.patch(pub(env) + f"/notes/{a['id']}", json={"data": {"t": 1}}, headers=V(VB))).status_code == 404
            assert (await c.delete(pub(env) + f"/notes/{a['id']}", headers=V(VB))).status_code == 404
            assert (await c.get(pub(env) + "/notes?scope=all", headers=V(VB))).status_code == 403
            assert (await c.get(pub(env) + "/notes/count?scope=private", headers=V(VB))).json()["count"] == 0
            ch_b = (await c.get(pub(env) + "/changes?since=0", headers=V(VB))).json()
            assert [x["data"]["t"] for x in ch_b["changes"]] == ["shared"]
            ch_a = (await c.get(pub(env) + "/changes?since=0", headers=V(VA))).json()
            assert sorted(x["data"]["t"] for x in ch_a["changes"]) == ["A's", "shared"]
            assert ch_b["cursor"] == ch_a["cursor"]
            # The owner moderates all of it.
            every = (await c.get(own(env) + "/notes?scope=all", headers=O(env))).json()["records"]
            assert len(every) == 2
            # A signed-in user's private data follows the user, not the device.
            await c.post(pub(env) + "/notes", json={"data": {"t": "U"}, "scope": "private"},
                         headers={**V(VA), "X-Test-User": user})
            on_b = (await c.get(pub(env) + "/notes?scope=private", headers={**V(VB), "X-Test-User": user})).json()
            assert [r["data"]["t"] for r in on_b["records"]] == ["U"]
        call(env, flow)


# ---------------------------------------------------------------------------
# Queries, increment, upsert, documents
# ---------------------------------------------------------------------------

class TestQueries:
    def test_where_order_count_get(self, env):
        async def flow(c):
            h = V(VA)
            for name, score, team in [("a", 5, "red"), ("b", 12, "blue"), ("c", 9, "red"), ("d", None, "red")]:
                data = {"name": name, "team": team}
                if score is not None:
                    data["score"] = score
                await c.post(pub(env) + "/scores", json={"data": data}, headers=h)
            res = (await c.get(pub(env) + "/scores", params={"where": json.dumps({"team": "red"}), "order_by": "score",
                                                           "desc": "1"}, headers=h)).json()["records"]
            assert [r["data"]["name"] for r in res] == ["c", "a", "d"]
            res = (await c.get(pub(env) + "/scores", params={"order_by": "score", "limit": 2}, headers=h)).json()
            assert [r["data"]["name"] for r in res["records"]] == ["a", "c"] and res["has_more"]
            n = (await c.get(pub(env) + "/scores/count", params={"where": json.dumps({"team": "red"})}, headers=h)).json()
            assert n == {"count": 3}
            one = res["records"][0]
            got = (await c.get(pub(env) + f"/scores/{one['id']}", headers=h)).json()
            assert got["data"]["name"] == "a"
        call(env, flow)

    def test_increment_is_atomic(self, env, monkeypatch):
        monkeypatch.setattr(D, "VISITOR_WRITES_PER_MIN", 1000)
        monkeypatch.setattr(D, "IP_WRITES_PER_MIN", 1000)

        async def flow(c):
            rec = (await c.post(pub(env) + "/polls", json={"data": {"q": "Lunch?", "yes": 0}}, headers=V(VA))).json()
            await asyncio.gather(*(c.post(pub(env) + f"/polls/{rec['id']}/increment", json={"field": "yes", "by": 1},
                                          headers=V(VA if i % 2 else VB)) for i in range(25)))
            got = (await c.get(pub(env) + f"/polls/{rec['id']}", headers=V(VA))).json()
            assert got["data"] == {"q": "Lunch?", "yes": 25} and got["version"] == 26
            bad = await c.post(pub(env) + f"/polls/{rec['id']}/increment", json={"field": "q"}, headers=V(VA))
            assert bad.status_code == 409
            for by in ("1", True, None, 1e30):
                r = await c.post(pub(env) + f"/polls/{rec['id']}/increment", json={"field": "yes", "by": by}, headers=V(VA))
                assert r.status_code == 422
            r = await c.post(pub(env) + f"/polls/{rec['id']}/increment", json={"field": "yes", "by": -2.5}, headers=V(VA))
            assert r.json()["data"]["yes"] == 22.5
        call(env, flow)

    def test_upsert_makes_one_record_per_key(self, env, monkeypatch):
        monkeypatch.setattr(D, "VISITOR_WRITES_PER_MIN", 1000)
        monkeypatch.setattr(D, "IP_WRITES_PER_MIN", 1000)

        async def flow(c):
            await asyncio.gather(*(c.post(pub(env) + "/stock/upsert", json={"key": "sku-1", "data": {f"f{i}": i}},
                                          headers=V(VA)) for i in range(12)))
            recs = (await c.get(pub(env) + "/stock", headers=V(VA))).json()["records"]
            assert len(recs) == 1 and recs[0]["key"] == "sku-1"
            assert recs[0]["data"] == {f"f{i}": i for i in range(12)}  # every field merged in
            r = await c.post(pub(env) + "/stock/upsert", json={"key": "sku-1", "data": {"only": 1}, "replace": True},
                             headers=V(VA))
            assert r.json()["data"] == {"only": 1}
            stale = await c.post(pub(env) + "/stock/upsert", json={"key": "sku-1", "data": {"x": 1}, "version": 1},
                                 headers=V(VA))
            assert stale.status_code == 409
            # Keys are per scope: a private record under the same key is another record.
            p = await c.post(pub(env) + "/stock/upsert", json={"key": "sku-1", "data": {"mine": 1}, "scope": "private"},
                             headers=V(VB))
            assert p.status_code == 200 and p.json()["scope"] == "private"
            assert (await c.post(pub(env) + "/stock/upsert", json={"key": "", "data": {}}, headers=V(VA))).status_code == 422
        call(env, flow)

    def test_patch_version_check(self, env):
        async def flow(c):
            rec = (await c.post(pub(env) + "/t", json={"data": {"a": 1}}, headers=V(VA))).json()
            ok = await c.patch(pub(env) + f"/t/{rec['id']}", json={"data": {"b": 2}, "version": 1}, headers=V(VB))
            assert ok.status_code == 200 and ok.json()["data"] == {"a": 1, "b": 2}
            stale = await c.patch(pub(env) + f"/t/{rec['id']}", json={"data": {"a": 9}, "version": 1}, headers=V(VA))
            assert stale.status_code == 409
        call(env, flow)

    def test_documents(self, env):
        async def flow(c):
            assert (await c.get(pub(env) + "/doc/config", headers=V(VA))).json() == {"record": None}
            s = (await c.put(pub(env) + "/doc/config", json={"data": {"theme": "dark", "goal": 10}}, headers=V(VA))).json()
            assert s["key"] == "config" and s["data"] == {"theme": "dark", "goal": 10}
            m = (await c.put(pub(env) + "/doc/config", json={"data": {"goal": 12}, "merge": True}, headers=V(VB))).json()
            assert m["data"] == {"theme": "dark", "goal": 12}
            r = (await c.put(pub(env) + "/doc/config", json={"data": {"goal": 1}}, headers=V(VB))).json()
            assert r["data"] == {"goal": 1}
            i = (await c.post(pub(env) + "/doc/likes/increment", json={"field": "count"}, headers=V(VA))).json()
            i = (await c.post(pub(env) + "/doc/likes/increment", json={"field": "count"}, headers=V(VB))).json()
            assert i["data"] == {"count": 2}
            got = (await c.get(pub(env) + "/doc/likes", headers=V(VB))).json()["record"]
            assert got["data"]["count"] == 2
            assert (await c.get(pub(env) + "/doc/bad name", headers=V(VA))).status_code == 422
            summary = (await c.get(own(env), headers=O(env))).json()["collections"]
            assert {"name": "_doc", "count": 2} == {k: summary[0][k] for k in ("name", "count")}
        call(env, flow)


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

class FakeStorage:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def upload_bytes(self, data, path, content_type="application/octet-stream"):
        self.files[path] = data
        return path

    async def delete_path(self, path):
        self.deleted.append(path)
        self.files.pop(path, None)


class TestFiles:
    def test_upload_types_sizes_and_delete(self, env, monkeypatch):
        from app.services import storage
        fake = FakeStorage()
        monkeypatch.setattr(storage, "upload_bytes", fake.upload_bytes)
        monkeypatch.setattr(storage, "delete_path", fake.delete_path)

        async def flow(c):
            h = {**V(VA), "X-File-Name": "receipt%20one.png", "Content-Type": "application/octet-stream"}
            r = await c.post(pub(env) + "/files", content=PNG, headers=h)
            assert r.status_code == 200, r.text
            rec = r.json()
            assert rec["data"]["type"] == "image/png" and rec["data"]["name"] == "receipt one.png"
            assert rec["data"]["url"].startswith(f"/api/public/pages/asset/pages/artifact-data/{env.pid}/")
            assert "path" not in rec["data"]
            assert list(fake.files) == [rec["data"]["url"].split("/asset/", 1)[1]]
            for body in (b"<svg onload=alert(1)>", b"MZ\x90\x00", b"GIF8"):  # svg, exe, truncated gif
                assert (await c.post(pub(env) + "/files", content=body, headers=h)).status_code == 415
            assert (await c.post(pub(env) + "/files", content=b"", headers=h)).status_code == 400
            big = PNG + b"\x00" * D.MAX_FILE_BYTES
            assert (await c.post(pub(env) + "/files", content=big, headers=h)).status_code == 413
            pdf = await c.post(pub(env) + "/files", content=b"%PDF-1.7\n...", headers=h)
            assert pdf.json()["data"]["type"] == "application/pdf"
            listed = (await c.get(pub(env) + "/files", headers=V(VB))).json()["records"]
            assert len(listed) == 2 and all("path" not in r["data"] for r in listed)
            d = await c.delete(pub(env) + f"/files/{rec['id']}", headers=V(VA))
            assert d.status_code == 200
            await asyncio.sleep(0.05)
            assert len(fake.deleted) == 1 and fake.deleted[0].startswith(f"pages/artifact-data/{env.pid}/")
            # Visitors cannot reach the internal collection directly.
            assert (await c.patch(pub(env) + f"/_files/{rec['id']}", json={"data": {"path": "pages/x"}}, headers=V(VA))).status_code == 422
        call(env, flow)

    def test_upload_respects_access(self, env, monkeypatch):
        from app.services import storage
        monkeypatch.setattr(storage, "upload_bytes", FakeStorage().upload_bytes)
        _set(env, "link_read")
        r = call(env, lambda c: c.post(pub(env) + "/files", content=PNG, headers=V(VA)))
        assert r.status_code == 403

    def test_failed_storage_leaves_no_record(self, env, monkeypatch):
        from app.services import storage

        async def boom(*a, **k):
            raise RuntimeError("down")
        monkeypatch.setattr(storage, "upload_bytes", boom)
        r = call(env, lambda c: c.post(pub(env) + "/files", content=PNG, headers=V(VA)))
        assert r.status_code == 502
        assert env.sql("SELECT COUNT(*) AS n FROM artifact_records WHERE deleted_at IS NULL")[0]["n"] == 0


# ---------------------------------------------------------------------------
# Realtime
# ---------------------------------------------------------------------------

class TestRealtime:
    def test_long_poll_wakes_on_a_write(self, env):
        async def flow(c):
            s = (await c.get(pub(env), headers=V(VA))).json()

            async def writer():
                await asyncio.sleep(0.3)
                await c.post(pub(env) + "/todos", json={"data": {"t": "new"}}, headers=V(VB))

            t0 = time.monotonic()
            res, _ = await asyncio.gather(
                c.get(pub(env) + "/changes", params={"since": s['cursor'], "wait": 10, "rev": s["rev"]}, headers=V(VA)), writer())
            took = time.monotonic() - t0
            assert [x["data"]["t"] for x in res.json()["changes"]] == ["new"]
            assert took < 1.5, took
            # Nothing happening: it returns empty when the wait is up.
            t0 = time.monotonic()
            empty = (await c.get(pub(env) + "/changes", params={"since": res.json()['cursor'], "wait": 1, "rev": s["rev"]},
                                 headers=V(VA))).json()
            assert empty["changes"] == [] and 0.9 < time.monotonic() - t0 < 3
        call(env, flow)

    def test_republish_wakes_a_waiting_viewer(self, env):
        async def flow(c):
            s = (await c.get(pub(env), headers=V(VA))).json()

            async def publish():
                await asyncio.sleep(0.3)
                await RP.publish_page(env.pid, RP.PublishBody(published=True), req(env.owner), "editor")

            t0 = time.monotonic()
            res, _ = await asyncio.gather(
                c.get(pub(env) + "/changes", params={"since": s['cursor'], "wait": 10, "rev": s["rev"]}, headers=V(VA)), publish())
            assert res.json()["rev"] != s["rev"] and time.monotonic() - t0 < 1.5
        call(env, flow)

    def test_others_private_writes_do_not_wake_me(self, env):
        async def flow(c):
            s = (await c.get(pub(env), headers=V(VA))).json()

            async def writer():
                await asyncio.sleep(0.2)
                await c.post(pub(env) + "/n", json={"data": {"t": 1}, "scope": "private"}, headers=V(VB))

            res, _ = await asyncio.gather(
                c.get(pub(env) + "/changes", params={"since": s['cursor'], "wait": 1, "rev": s["rev"]}, headers=V(VA)), writer())
            body = res.json()
            assert body["changes"] == [] and body["cursor"] > s["cursor"]
        call(env, flow)


# ---------------------------------------------------------------------------
# Owner tools
# ---------------------------------------------------------------------------

class TestOwnerTools:
    def test_clear_and_export(self, env):
        async def flow(c):
            await c.post(pub(env) + "/signups", json={"data": {"name": "=HYPERLINK(\"x\")", "slot": "9am"}}, headers=V(VA))
            await c.post(pub(env) + "/signups", json={"data": {"name": "Asha", "tags": ["a"]}}, headers=V(VB))
            csv_res = await c.get(own(env) + "/export?format=csv&collection=signups", headers=O(env))
            text = csv_res.text
            assert csv_res.headers["content-disposition"].endswith('.csv"')
            assert "'=HYPERLINK" in text and "name,slot,tags" in text and '"[""a""]"' in text
            js = (await c.get(own(env) + "/export?format=json", headers=O(env))).json()
            assert len(js) == 2 and all("author" in r and "mine" not in r for r in js)
            assert (await c.get(own(env) + "/export?format=xml", headers=O(env))).status_code == 422
            cur = (await c.get(own(env), headers=O(env))).json()["cursor"]
            cl = (await c.delete(own(env) + "/signups", headers=O(env))).json()
            assert cl == {"ok": True, "deleted": 2}
            ch = (await c.get(pub(env) + f"/changes?since={cur}", headers=V(VA))).json()
            assert len(ch["changes"]) == 2 and all(x["deleted"] for x in ch["changes"])
            assert (await c.get(pub(env) + "/signups", headers=V(VA))).json()["records"] == []
        call(env, flow)
