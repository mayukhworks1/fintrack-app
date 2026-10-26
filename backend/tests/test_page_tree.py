"""
Nested pages: moves, cycles, trash, favourites, ownership and the public family.

The routes are called directly against an in-memory database that answers the
handful of queries the tree makes (recognised by a distinctive fragment of
each). The SQL itself is exercised against Postgres by the migration; what is
pinned here is the behaviour the sidebar and the public viewer rely on.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.page_tree as R
import app.routers.pages as P
import app.services.page_tree as T

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())


def _ids(rows):
    return [str(r["id"]) for r in rows]


class FakeDB:
    def __init__(self, ready=True):
        self.ready = ready
        self.pages: dict[str, dict] = {}
        self.favs: list[tuple[str, str]] = []
        self._t = 0

    # -- helpers -------------------------------------------------------------
    def add(self, title, owner=ALICE, parent=None, published=False, **over):
        self._t += 1
        pid = str(uuid.uuid4())
        now = datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=self._t)
        self.pages[pid] = {
            "id": pid, "slug": title.lower().replace(" ", "-"), "title": title, "icon": None,
            "parent_id": parent, "position": float(self._t), "content_type": "markdown",
            "content": "", "is_published": published, "updated_at": now, "created_at": now,
            "created_by": owner, "deleted_at": None, "expires_at": None,
            "is_password_protected": False, "password_hash": None, "published_at": now,
            "metadata": json.dumps({}), "view_count": 0, "cover": None,
        }
        self.pages[pid].update(over)
        return pid

    def _ordered(self, rows):
        return sorted(rows, key=lambda r: (r["position"] is None, r["position"] or 0, r["created_at"]))

    def _scoped(self, rows, args, idx):
        if len(args) > idx:
            rows = [r for r in rows if str(r["created_by"]) == str(args[idx])]
        return rows

    # -- pool / connection protocol -----------------------------------------
    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        return self

    async def fetchval(self, sql, *a):
        if "information_schema.columns" in sql:
            return self.ready
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def fetchrow(self, sql, *a):
        if "UPDATE published_pages SET parent_id = $1::uuid, position = $2" in sql:
            p = self.pages[a[2]]
            p["parent_id"], p["position"] = a[0], a[1]
            return dict(p)
        if "UPDATE published_pages SET icon" in sql or "UPDATE published_pages SET cover" in sql:
            p = self.pages[a[-1]]
            for part, value in zip(sql.split("SET ", 1)[1].split(" WHERE")[0].split(", "), a):
                p[part.split(" = ")[0]] = value
            return dict(p)
        if "WHERE slug = $1" in sql:
            hit = [p for p in self.pages.values() if p["slug"] == a[0]]
            return dict(hit[0]) if hit else None
        if "FROM published_pages WHERE id = $1" in sql:
            p = self.pages.get(str(a[0]))
            return dict(p) if p else None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def fetch(self, sql, *a):
        live = [p for p in self.pages.values() if p["deleted_at"] is None]
        if "WITH RECURSIVE up" in sql:
            out, cur, depth = [], self.pages.get(str(a[0])), 0
            while cur is not None and depth <= T.MAX_DEPTH:
                out.append({**cur, "depth": depth})
                cur = self.pages.get(str(cur["parent_id"])) if cur["parent_id"] else None
                depth += 1
            return out
        if "WITH RECURSIVE down" in sql:
            out, frontier, depth = [], [str(a[0])], 0
            while frontier and depth <= T.MAX_DEPTH:
                out += [{**self.pages[i], "depth": depth} for i in frontier]
                frontier = [p["id"] for p in self.pages.values() if p["parent_id"] in frontier]
                depth += 1
            return out
        if "SELECT page_id FROM page_favourites" in sql:
            return [{"page_id": p} for u, p in self.favs if u == a[0]]
        if "FROM page_favourites f JOIN" in sql:
            rows = [self.pages[p] for u, p in self.favs if u == a[0] and self.pages[p]["deleted_at"] is None]
            return self._scoped(rows, a, 1)
        if "parent_id IS NOT DISTINCT FROM" in sql:
            rows = [p for p in live if p["parent_id"] == a[0] and p["id"] != a[1]]
            return self._ordered(self._scoped(rows, a, 2))
        if "LEFT JOIN published_pages pp" in sql:
            rows = [p for p in self.pages.values() if p["deleted_at"] is not None]
            rows = self._scoped(rows, a, 0)
            return [{**p, "parent_deleted_at": (self.pages[p["parent_id"]]["deleted_at"] if p["parent_id"] else None)}
                    for p in sorted(rows, key=lambda r: r["deleted_at"], reverse=True)]
        if "WHERE parent_id = $1 AND is_published" in sql:
            return self._ordered([p for p in live if p["parent_id"] == str(a[0]) and p["is_published"]])
        if "WHERE p.parent_id = $1" in sql:
            rows = self._scoped([p for p in live if p["parent_id"] == a[0]], a, 1)
            return [{**p, "has_children": any(c["parent_id"] == p["id"] for c in live)} for p in self._ordered(rows)]
        if "view_count" in sql:  # GET /api/pages/
            rows = live if "deleted_at IS NULL" in sql else list(self.pages.values())
            return self._scoped(rows, a, 0)
        if "ORDER BY created_at" in sql and "deleted_at" not in sql:  # flat, pre-migration
            keep = ("id", "slug", "title", "content_type", "is_published", "updated_at", "created_by")
            return [{k: p[k] for k in keep} for p in self._scoped(list(self.pages.values()), a, 0)]
        if "WHERE deleted_at IS NULL" in sql:  # the tree
            return self._ordered(self._scoped(live, a, 0))
        raise AssertionError(f"unexpected fetch: {sql}")

    async def execute(self, sql, *a):
        if "SET deleted_at = $1 WHERE id = ANY" in sql:
            for i in a[1]:
                self.pages[str(i)]["deleted_at"] = a[0]
        elif "SET deleted_at = NULL WHERE id = ANY" in sql:
            for i in a[0]:
                self.pages[str(i)]["deleted_at"] = None
        elif "SET parent_id = NULL WHERE id" in sql:
            self.pages[a[0]]["parent_id"] = None
        elif sql.startswith("DELETE FROM published_pages WHERE id = ANY"):
            for i in a[0]:
                self.pages.pop(str(i), None)
            for p in self.pages.values():  # ON DELETE SET NULL
                if p["parent_id"] not in self.pages:
                    p["parent_id"] = None
        elif sql.startswith("INSERT INTO page_favourites"):
            if (a[0], a[1]) not in self.favs:
                self.favs.append((a[0], a[1]))
        elif sql.startswith("DELETE FROM page_favourites"):
            self.favs = [f for f in self.favs if f != (a[0], a[1])]
        else:
            raise AssertionError(f"unexpected execute: {sql}")

    async def executemany(self, sql, rows):
        assert sql.startswith("UPDATE published_pages SET position")
        for pos, pid in rows:
            self.pages[str(pid)]["position"] = pos


@pytest.fixture
def db(monkeypatch):
    T.reset_ready_cache()
    fake = FakeDB()
    monkeypatch.setattr(R, "get_pool", lambda: fake)
    monkeypatch.setattr(P, "get_pool", lambda: fake)

    async def no_assets(content):
        return None
    monkeypatch.setattr(R, "_delete_page_assets", no_assets)
    yield fake
    T.reset_ready_cache()


def req(user=ALICE, role="user"):
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role))


def run(coro):
    return asyncio.run(coro)


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
        d = run(R.page_tree(req(), role="editor"))
        assert d["ready"] is True
        nodes = {n["id"]: n for n in d["pages"]}
        assert set(nodes) == {root, kid}
        assert nodes[kid]["parent_id"] == root and nodes[root]["has_children"]

    def test_superadmin_sees_every_page(self, db):
        db.add("Mine")
        db.add("Bob page", owner=BOB)
        assert len(run(R.page_tree(req(role="superadmin"), role="editor"))["pages"]) == 2

    def test_before_the_migration_the_tree_is_flat_and_writes_say_why(self, db):
        db.ready = False
        a = db.add("A")
        d = run(R.page_tree(req(), role="editor"))
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
        assert _ids(run(P.list_pages(req(), role="editor"))) == [keep]
        assert [n["id"] for n in run(R.page_tree(req(), role="editor"))["pages"]] == [keep]
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
        assert run(R.page_tree(req(), role="editor"))["favourites"] == [a]
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
        assert run(R.page_tree(req(), role="editor"))["favourites"] == []


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
