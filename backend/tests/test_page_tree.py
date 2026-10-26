"""
Nested pages: moves, cycles, trash, favourites, ownership and the public family.

The routes are called directly against a real Postgres (tests/pg_harness.py;
skipped without one). What is pinned here is the behaviour the sidebar and
the public viewer rely on.
"""

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.page_tree as R
import app.routers.pages as P
import app.services.page_tree as T
from app.utils.fast_json import body_of

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())


def _ids(rows):
    return [str(r["id"]) for r in rows]


class _Pages:
    """db.pages[id] -> the row as a dict (ids as strings), read from Postgres."""

    def __init__(self, env):
        self.env = env

    def __getitem__(self, pid):
        rows = self.env.sql("SELECT * FROM published_pages WHERE id = $1", str(pid))
        if not rows:
            raise KeyError(pid)
        d = dict(rows[0])
        for k in ("id", "parent_id", "created_by", "updated_by"):
            if d.get(k) is not None:
                d[k] = str(d[k])
        return d

    def __contains__(self, pid):
        return bool(self.env.sql("SELECT 1 FROM published_pages WHERE id = $1", str(pid)))


class TreeDB:
    """The tree's tests against Postgres (tests/pg_harness.py)."""

    def __init__(self, env):
        self.env = env
        self.pages = _Pages(env)
        for uid in (ALICE, BOB):
            env.sql("INSERT INTO auth_users (id, email, email_normalized, full_name, status) "
                    "VALUES ($1, $2, $2, 'T', 'active')", uid, f"{uid[:8]}@example.in")

    def add(self, title, owner=ALICE, parent=None, published=False):
        return self.env.page(owner, title, parent=parent, published=published,
                             slug=title.lower().replace(" ", "-"))


_CURRENT: dict = {}


@pytest.fixture
def db(pg, monkeypatch):
    async def no_assets(paths):
        return None
    monkeypatch.setattr(R, "_delete_asset_paths", no_assets)
    _CURRENT["env"] = pg
    yield TreeDB(pg)
    _CURRENT.clear()


def req(user=ALICE, role="user"):
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role))


def run(coro):
    env = _CURRENT.get("env")
    if env is None:
        return asyncio.run(coro)

    async def go(pool):
        return await coro
    return env.run(go)


def status_of(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value.status_code


# ---------------------------------------------------------------------------

class TestPureHelpers:
    def test_cycle_detection_walks_the_new_parents_chain(self):
        parent_of = {"c": "b", "b": "a", "a": None}
        assert T.would_cycle("a", "c", parent_of)
        assert T.would_cycle("a", "a", parent_of)
        assert not T.would_cycle("c", "a", parent_of)
        assert not T.would_cycle("a", None, parent_of)

    def test_cycle_detection_survives_a_loop_already_in_the_data(self):
        assert not T.would_cycle("x", "a", {"a": "b", "b": "a"})

    def test_place_at_takes_midpoints_and_renumbers_when_crowded(self):
        assert T.place_at([1.0, 2.0], 1) == (1.5, None)
        assert T.place_at([1.0, 2.0], 0) == (1.0 - 1024, None)
        assert T.place_at([1.0, 2.0], 9) == (2.0 + 1024, None)
        pos, fresh = T.place_at([1.0, 1.0 + 1e-9], 1)
        assert fresh == [1024.0, 3072.0] and pos == 2048.0

    def test_a_page_whose_parent_is_out_of_sight_shows_at_the_top(self):
        rows = [{"id": "a", "parent_id": "hidden", "title": "A"}, {"id": "b", "parent_id": "a", "title": "B"}]
        nodes = {n["id"]: n for n in T.tree_nodes(rows)}
        assert nodes["a"]["parent_id"] is None and nodes["a"]["has_children"]
        assert nodes["b"]["parent_id"] == "a" and not nodes["b"]["has_children"]


class TestTree:
    def test_tree_is_nested_and_scoped_to_the_owner(self, db):
        root = db.add("Root")
        kid = db.add("Kid", parent=root)
        db.add("Bob page", owner=BOB)
        d = body_of(run(R.page_tree(req(), role="editor")))
        assert d["ready"] is True
        nodes = {n["id"]: n for n in d["pages"]}
        assert set(nodes) == {root, kid}
        assert nodes[kid]["parent_id"] == root and nodes[root]["has_children"]

    def test_superadmin_sees_every_page(self, db):
        db.add("Mine")
        db.add("Bob page", owner=BOB)
        assert len(body_of(run(R.page_tree(req(role="superadmin"), role="editor")))["pages"]) == 2

    def test_before_the_migration_the_tree_is_flat_and_writes_say_why(self, pg_upto, monkeypatch):
        env = pg_upto("0003_ai_gateway")
        monkeypatch.setitem(_CURRENT, "env", env)
        owner = env.user()
        # No tree columns before 0004: inserted by hand.
        a = str(env.sql("INSERT INTO published_pages (slug, title, created_by) VALUES ('a', 'A', $1) RETURNING id",
                        owner)[0][0])
        req = lambda: SimpleNamespace(state=SimpleNamespace(auth_user_id=owner, auth_role="user"))  # noqa: E731
        d = body_of(run(R.page_tree(req(), role="editor")))
        assert d["ready"] is False and d["pages"][0]["parent_id"] is None
        with pytest.raises(HTTPException) as e:
            run(R.trash_page(a, req(), role="editor"))
        assert e.value.status_code == 503 and "0004" in e.value.detail
        assert run(R.page_breadcrumbs(a, req(), role="editor")) == []


class TestMove:
    def test_reorder_among_siblings(self, db):
        root = db.add("Root")
        a = db.add("A", parent=root)
        b = db.add("B", parent=root)
        run(R.move_page(b, R.MoveBody(parent_id=root, index=0), req(), role="editor"))
        kids = run(R.page_children(root, req(), role="editor"))
        assert [k["title"] for k in kids] == ["B", "A"]

    def test_nest_and_unnest(self, db):
        a, b = db.add("A"), db.add("B")
        node = run(R.move_page(b, R.MoveBody(parent_id=a), req(), role="editor"))
        assert node["parent_id"] == a
        node = run(R.move_page(b, R.MoveBody(parent_id=None), req(), role="editor"))
        assert node["parent_id"] is None

    def test_moving_a_page_under_its_own_descendant_is_refused(self, db):
        a = db.add("A")
        b = db.add("B", parent=a)
        c = db.add("C", parent=b)
        assert status_of(R.move_page(a, R.MoveBody(parent_id=c), req(), role="editor")) == 409
        assert status_of(R.move_page(a, R.MoveBody(parent_id=a), req(), role="editor")) == 409
        assert db.pages[a]["parent_id"] is None

    def test_cannot_move_someone_elses_page_or_into_it(self, db):
        mine, theirs = db.add("Mine"), db.add("Theirs", owner=BOB)
        assert status_of(R.move_page(theirs, R.MoveBody(parent_id=None), req(), role="editor")) == 403
        assert status_of(R.move_page(mine, R.MoveBody(parent_id=theirs), req(), role="editor")) == 403

    def test_a_bad_parent_id_is_a_422(self, db):
        a = db.add("A")
        assert status_of(R.move_page(a, R.MoveBody(parent_id="nope"), req(), role="editor")) == 422

    def test_breadcrumbs_run_from_the_top(self, db):
        a = db.add("A")
        b = db.add("B", parent=a)
        c = db.add("C", parent=b)
        crumbs = run(R.page_breadcrumbs(c, req(), role="editor"))
        assert [x["title"] for x in crumbs] == ["A", "B"]


class TestTrash:
    def test_trash_takes_the_subtree_and_hides_it_from_lists(self, db):
        a = db.add("A")
        b = db.add("B", parent=a)
        keep = db.add("Keep")
        res = run(R.trash_page(a, req(), role="editor"))
        assert set(res["trashed"]) == {a, b}
        assert _ids(body_of(run(P.list_pages(req(), role="editor")))) == [keep]
        assert [n["id"] for n in body_of(run(R.page_tree(req(), role="editor")))["pages"]] == [keep]
        assert [t["id"] for t in run(R.page_trash(req(), role="editor"))] == [a]

    def test_restore_brings_the_subtree_back(self, db):
        a = db.add("A")
        b = db.add("B", parent=a)
        run(R.trash_page(a, req(), role="editor"))
        run(R.restore_page(a, req(), role="editor"))
        assert db.pages[a]["deleted_at"] is None and db.pages[b]["deleted_at"] is None
        assert db.pages[b]["parent_id"] == a

    def test_restoring_a_child_of_a_trashed_page_lifts_it_to_the_top(self, db):
        a = db.add("A")
        b = db.add("B", parent=a)
        run(R.trash_page(b, req(), role="editor"))
        run(R.trash_page(a, req(), role="editor"))
        run(R.restore_page(b, req(), role="editor"))
        assert db.pages[b]["parent_id"] is None and db.pages[b]["deleted_at"] is None

    def test_delete_forever_only_from_the_trash(self, db):
        a = db.add("A")
        assert status_of(R.delete_page_forever(a, req(), role="editor")) == 409
        run(R.trash_page(a, req(), role="editor"))
        run(R.delete_page_forever(a, req(), role="editor"))
        assert a not in db.pages

    def test_someone_elses_page_cannot_be_trashed(self, db):
        theirs = db.add("Theirs", owner=BOB)
        assert status_of(R.trash_page(theirs, req(), role="editor")) == 403
        assert db.pages[theirs]["deleted_at"] is None

    def test_trashed_page_is_gone_from_every_public_route(self, db):
        a = db.add("A", published=True)
        run(R.trash_page(a, req(), role="editor"))
        assert status_of(P.public_get_page("a", request=None)) == 404
        assert status_of(P.public_render_page("a")) == 404
        assert status_of(P.public_verify_password("a", P.VerifyPasswordBody(password=""))) == 404
        assert P._share_fields(db.pages[a])["title"] == "Page not found"


class TestPublicFamily:
    def _get(self, slug):
        return json.loads(run(P.public_get_page(slug, request=None)).body)

    def test_published_children_and_published_ancestors_only(self, db):
        root = db.add("Root", published=True)
        mid = db.add("Mid", parent=root, published=True)
        db.add("Leaf", parent=mid, published=True)
        db.add("Draft", parent=mid, published=False)
        gone = db.add("Gone", parent=mid, published=True)
        run(R.trash_page(gone, req(), role="editor"))
        d = self._get("mid")
        assert [c["slug"] for c in d["children"]] == ["leaf"]
        assert [b["slug"] for b in d["breadcrumbs"]] == ["root"]

    def test_the_trail_stops_at_an_unpublished_ancestor(self, db):
        root = db.add("Root", published=True)
        mid = db.add("Mid", parent=root, published=False)
        db.add("Leaf", parent=mid, published=True)
        assert self._get("leaf")["breadcrumbs"] == []


class TestFavourites:
    def test_add_list_remove(self, db):
        a = db.add("A")
        run(R.add_favourite(a, req(), role="editor"))
        run(R.add_favourite(a, req(), role="editor"))  # idempotent
        assert [f["id"] for f in run(R.page_favourites(req(), role="editor"))] == [a]
        assert body_of(run(R.page_tree(req(), role="editor")))["favourites"] == [a]
        run(R.remove_favourite(a, req(), role="editor"))
        assert run(R.page_favourites(req(), role="editor")) == []

    def test_cannot_star_someone_elses_page(self, db):
        theirs = db.add("Theirs", owner=BOB)
        assert status_of(R.add_favourite(theirs, req(), role="editor")) == 403

    def test_trashed_favourite_drops_out(self, db):
        a = db.add("A")
        run(R.add_favourite(a, req(), role="editor"))
        run(R.trash_page(a, req(), role="editor"))
        assert run(R.page_favourites(req(), role="editor")) == []
        assert body_of(run(R.page_tree(req(), role="editor")))["favourites"] == []


class TestAppearance:
    def test_icon_is_set_and_cleared(self, db):
        a = db.add("A")
        assert run(R.set_appearance(a, R.AppearanceBody(icon="🚀"), req(), role="editor"))["icon"] == "🚀"
        assert run(R.set_appearance(a, R.AppearanceBody(icon=""), req(), role="editor"))["icon"] is None

    def test_markup_and_script_covers_are_refused(self, db):
        a = db.add("A")
        assert status_of(R.set_appearance(a, R.AppearanceBody(icon="<b>"), req(), role="editor")) == 422
        assert status_of(R.set_appearance(a, R.AppearanceBody(cover="javascript:alert(1)"), req(), role="editor")) == 422


def test_tree_routes_are_registered_before_the_page_id_route():
    from app.main import app
    paths = [getattr(r, "path", "") for r in app.routes]
    assert paths.index("/api/pages/tree") < paths.index("/api/pages/{page_id}")
    assert paths.index("/api/pages/trash") < paths.index("/api/pages/{page_id}")
