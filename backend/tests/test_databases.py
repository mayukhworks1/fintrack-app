"""
Databases: schema validation, values, the row query's SQL, CSV, and the
router's row CRUD and ownership.

The router is called directly against a real Postgres (tests/pg_harness.py;
those tests are skipped without one): its writes are set-based SQL that an
in-memory stand-in could not check. The filter/sort SQL itself is pinned at
the builder: every client value must arrive as a bind parameter, never in
the SQL text.
"""

import asyncio
import csv
import io
import json
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.databases as R
import app.routers.pages as P
import app.services.databases as D

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())


def run(coro):
    return asyncio.run(coro)


def req(user=ALICE, role="editor"):
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role), headers={})


def schema(**extra):
    raw = {
        "properties": [
            {"id": "title", "name": "Name", "type": "title"},
            {"id": "status", "name": "Status", "type": "select",
             "options": [{"id": "todo", "name": "To do", "color": "gray"},
                         {"id": "done", "name": "Done", "color": "green"}]},
            {"id": "tags", "name": "Tags", "type": "multi_select",
             "options": [{"id": "fin", "name": "Finance", "color": "blue"},
                         {"id": "ops", "name": "Ops", "color": "red"}]},
            {"id": "amount", "name": "Amount", "type": "number", "format": "inr"},
            {"id": "due", "name": "Due", "type": "date"},
            {"id": "ok", "name": "OK", "type": "checkbox"},
            {"id": "site", "name": "Site", "type": "url"},
            {"id": "who", "name": "Owner", "type": "person"},
            {"id": "notes", "name": "Notes", "type": "text"},
            {"id": "created", "name": "Created", "type": "created_time"},
            {"id": "edited", "name": "Edited", "type": "last_edited_time"},
        ],
        "views": [{"id": "v1", "name": "Table", "type": "table"},
                  {"id": "v2", "name": "Board", "type": "board", "group_by": "status"}],
    }
    raw.update(extra)
    return D.normalize_schema(raw)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class TestSchema:
    def test_normalises_and_defaults(self):
        s = schema()
        assert s["default_view"] == "v1"
        assert s["row_type"] == "doc"
        assert s["views"][1]["group_by"] == "status"
        assert next(p for p in s["properties"] if p["id"] == "amount")["format"] == "inr"

    @pytest.mark.parametrize("mutate, msg", [
        (lambda r: r["properties"].pop(0), "title"),
        (lambda r: r["properties"].append({"id": "x", "name": "Name", "type": "text"}), "share a name"),
        (lambda r: r["properties"].append({"id": "status", "name": "Other", "type": "text"}), "share an id"),
        (lambda r: r["properties"].append({"id": "bad id!", "name": "B", "type": "text"}), "id is not valid"),
        (lambda r: r["properties"].append({"id": "z", "name": "Z", "type": "formula"}), "Unknown property type"),
        (lambda r: r["properties"].append({"id": "n", "name": "N", "type": "number", "format": "usd"}), "number format"),
        (lambda r: r["views"].append({"id": "v9", "name": "X", "type": "timeline"}), "Unknown view type"),
        (lambda r: r["views"].append({"id": "v9", "name": "B", "type": "board", "group_by": "amount"}), "select property"),
        (lambda r: r["views"].append({"id": "v9", "name": "C", "type": "calendar", "date_prop": "notes"}), "date property"),
        (lambda r: r["views"][0].update(filter={"op": "and", "rules": [{"prop": "amount", "cmp": "contains", "value": 1}]}), "does not apply"),
        (lambda r: r["views"][0].update(filter={"op": "xor", "rules": []}), "and / or"),
        (lambda r: r["views"][0].update(sort=[{"prop": "amount", "dir": "sideways"}]), "asc or desc"),
    ])
    def test_rejects(self, mutate, msg):
        raw = {
            "properties": [{"id": "title", "name": "Name", "type": "title"},
                           {"id": "status", "name": "Status", "type": "select", "options": []},
                           {"id": "amount", "name": "Amount", "type": "number"},
                           {"id": "notes", "name": "Notes", "type": "text"}],
            "views": [{"id": "v1", "name": "Table", "type": "table"}],
        }
        mutate(raw)
        with pytest.raises(D.SchemaError, match=msg):
            D.normalize_schema(raw)

    def test_view_references_to_deleted_properties_drop_out(self):
        s = D.normalize_schema({
            "properties": [{"id": "title", "name": "Name", "type": "title"}],
            "views": [{"id": "v", "name": "T", "type": "table", "hidden": ["gone"],
                       "sort": [{"prop": "gone", "dir": "asc"}],
                       "filter": {"op": "and", "rules": [{"prop": "gone", "cmp": "eq", "value": "x"}]}}],
        })
        v = s["views"][0]
        assert v["hidden"] == [] and v["sort"] == [] and v["filter"] is None

    def test_filter_groups_nest_one_level(self):
        s = schema()
        ok = D.normalize_filter({"op": "or", "rules": [
            {"prop": "status", "cmp": "eq", "value": "done"},
            {"op": "and", "rules": [{"prop": "amount", "cmp": "gt", "value": "5"}]},
        ]}, s)
        assert ok["rules"][1]["rules"][0]["value"] == 5.0
        with pytest.raises(D.SchemaError, match="nest"):
            D.normalize_filter({"op": "or", "rules": [{"op": "and", "rules": [
                {"op": "and", "rules": [{"prop": "amount", "cmp": "gt", "value": 1}]}]}]}, s)

    def test_filter_values_are_checked(self):
        s = schema()
        with pytest.raises(D.SchemaError, match="one of its options"):
            D.normalize_filter({"rules": [{"prop": "status", "cmp": "eq", "value": "nope"}]}, s)
        with pytest.raises(D.SchemaError, match="date"):
            D.normalize_filter({"rules": [{"prop": "due", "cmp": "before", "value": "soon"}]}, s)
        with pytest.raises(D.SchemaError, match="number"):
            D.normalize_filter({"rules": [{"prop": "amount", "cmp": "gt", "value": "lots"}]}, s)

    def test_unreadable_schema_falls_back_to_default(self):
        assert D.schema_of({"database": {"properties": "nope"}})["properties"][0]["type"] == "title"
        assert D.schema_of("not json")["views"][0]["type"] == "table"


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------

class TestValues:
    def test_clean_props(self):
        s = schema()
        out = D.clean_props(s, {
            "status": "Done", "tags": ["fin", "Ops", "fin"], "amount": "₹1,20,000.50",
            "due": "31/12/2026", "ok": "yes", "site": "example.com", "who": "Asha", "notes": "",
        })
        assert out == {"status": "done", "tags": ["fin", "ops"], "amount": 120000.5, "due": "2026-12-31",
                       "ok": True, "site": "https://example.com", "who": "Asha", "notes": None}

    @pytest.mark.parametrize("pid, value", [
        ("status", "Maybe"), ("tags", ["nope"]), ("amount", "abc"), ("due", "2026-13-45"),
        ("ok", "perhaps"), ("site", "javascript:alert(1)"), ("site", "<x>"), ("created", "2026-01-01"),
        ("title", "x"), ("ghost", 1), ("notes", {"a": 1}),
    ])
    def test_rejects_bad_values(self, pid, value):
        with pytest.raises(D.SchemaError):
            D.clean_props(schema(), {pid: value})

    def test_retyping_converts_values(self):
        old = schema()
        props = [dict(p) for p in old["properties"]]
        for p in props:
            if p["id"] == "notes":
                p["type"] = "number"
            if p["id"] == "status":
                p["type"] = "multi_select"
            if p["id"] == "tags":
                p["options"] = [o for o in p["options"] if o["id"] != "ops"]
        new = D.normalize_schema({"properties": props, "views": old["views"][:1]})
        out = D.convert_props(old, new, [{"notes": "1,500", "status": "done", "tags": ["fin", "ops"]},
                                         {"notes": "n/a", "gone": 1}])
        assert out[0]["notes"] == 1500
        assert out[0]["tags"] == ["fin"]
        assert out[1] == {}

    def test_add_options_for(self):
        p = {"id": "s", "name": "S", "type": "multi_select", "options": []}
        assert D.add_options_for(p, ["a, b", "B", ""])
        assert [o["name"] for o in p["options"]] == ["a", "b"]


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def _placeholders(sql):
    return sorted({int(n) for n in re.findall(r"\$(\d+)", sql)})


class TestQueryBuilder:
    HOSTILE = "x'); DROP TABLE published_pages; --"

    def test_every_value_is_a_parameter(self):
        s = schema()
        flt = D.normalize_filter({"op": "or", "rules": [
            {"prop": "title", "cmp": "contains", "value": self.HOSTILE},
            {"prop": "notes", "cmp": "eq", "value": self.HOSTILE},
            {"op": "and", "rules": [
                {"prop": "amount", "cmp": "gte", "value": 10},
                {"prop": "tags", "cmp": "contains", "value": "fin"},
                {"prop": "ok", "cmp": "eq", "value": True},
                {"prop": "due", "cmp": "on_or_after", "value": "2026-01-01"},
                {"prop": "created", "cmp": "before", "value": "2026-12-01"},
                {"prop": "status", "cmp": "empty"},
            ]},
        ]}, s)
        sort = D.normalize_sort([{"prop": "status", "dir": "desc"}, {"prop": "amount", "dir": "asc"}], s)
        db = str(uuid.uuid4())
        sql, args = D.build_rows_query(db, s, flt, sort, limit=50, offset=100, owner=ALICE, search="50%_off")
        assert self.HOSTILE not in sql and "DROP" not in sql
        assert _placeholders(sql) == list(range(1, len(args) + 1))
        assert args[0] == db and args[1] == ALICE
        assert "%x'); DROP TABLE published\\_pages; --%" in args
        assert json.dumps(["fin"]) in args
        assert "%50\\%\\_off%" in args
        assert args[-2:] == [50, 100]
        assert " OR " in sql and " AND " in sql
        assert "p.deleted_at IS NULL" in sql
        # every placeholder carries an explicit cast
        assert len(re.findall(r"\$\d+(?![\d:])", sql)) == 0

    def test_limits_are_clamped(self):
        _sql, args = D.build_rows_query(str(uuid.uuid4()), schema(), limit=10_000, offset=-5)
        assert args[-2:] == [D.MAX_PAGE, 0]

    def test_property_ids_are_parameters_too(self):
        sql, args = D.build_rows_query(str(uuid.uuid4()), schema(),
                                       D.normalize_filter({"rules": [{"prop": "amount", "cmp": "gt", "value": 1}]}, schema()))
        assert "'amount'" not in sql and "amount" in args

    def test_select_sort_follows_option_order(self):
        sql, args = D.build_rows_query(str(uuid.uuid4()), schema(), None,
                                       [{"prop": "status", "dir": "asc"}])
        assert "array_position" in sql and ["todo", "done"] in args

    @pytest.mark.parametrize("ptype", sorted(D.OPERATORS))
    def test_every_operator_builds(self, ptype):
        s = schema()
        prop = next(p for p in s["properties"] if p["type"] == ptype)
        sample = {"title": "a", "text": "a", "url": "a", "person": "a", "number": 1, "date": "2026-01-01",
                  "created_time": "2026-01-01", "last_edited_time": "2026-01-01", "select": "todo",
                  "multi_select": "fin", "checkbox": True}[ptype]
        for cmp in D.OPERATORS[ptype]:
            rule = {"prop": prop["id"], "cmp": cmp, "value": sample}
            flt = D.normalize_filter({"rules": [rule]}, s)
            sql, args = D.build_rows_query(str(uuid.uuid4()), s, flt, [{"prop": prop["id"], "dir": "desc"}])
            assert _placeholders(sql) == list(range(1, len(args) + 1))


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

class TestCsv:
    def test_export_neutralises_formulas_and_keeps_numbers(self):
        s = schema()
        when = datetime(2026, 10, 1, 6, 30, tzinfo=timezone.utc)
        rows = [{"title": "=HYPERLINK(\"https://evil\")", "created_at": when, "updated_at": when,
                 "props": json.dumps({"amount": -1500, "notes": "+cmd", "status": "done", "tags": ["fin", "ops"], "ok": True})}]
        out = list(csv.reader(io.StringIO(D.export_csv(s, rows))))
        head, row = out[0], out[1]
        assert head[:4] == ["Name", "Status", "Tags", "Amount"]
        cells = dict(zip(head, row))
        assert cells["Name"].startswith("'=")
        assert cells["Notes"] == "'+cmd"
        assert cells["Amount"] == "-1500"
        assert cells["Status"] == "Done" and cells["Tags"] == "Finance, Ops" and cells["OK"] == "Yes"
        assert cells["Created"] == "2026-10-01 12:00"

    def test_import_plan_and_rows(self):
        s = schema()
        grid = D.parse_csv("Name;Stage;Value;When;Extra\n'=SUM(1);Blocked;\"1,200\";2026-02-03;x\nB;Done;;bad;y\n")
        new, plan = D.plan_import(s, grid[0], [
            {"column": 0, "prop": "title"}, {"column": 1, "prop": "status"},
            {"column": 2, "prop": "amount"}, {"column": 3, "new_type": "date", "name": "Due"},
        ])
        assert [p["name"] for p in new["properties"]][-1] == "Due 2"  # name clash resolved
        rows = D.import_rows(new, grid[1:], plan)
        status = next(p for p in new["properties"] if p["id"] == "status")
        blocked = next(o["id"] for o in status["options"] if o["name"] == "Blocked")
        assert rows[0][0] == "=SUM(1)"  # export quote undone
        assert rows[0][1]["status"] == blocked and rows[0][1]["amount"] == 1200
        assert rows[1][1]["status"] == "done" and "amount" not in rows[1][1]

    @pytest.mark.parametrize("mapping, msg", [
        ([{"column": 9, "prop": "title"}], "column"),
        ([{"column": 0, "prop": "created"}], "cannot be imported"),
        ([{"column": 0, "new_type": "title"}], "Cannot create"),
        ([{"column": 0, "prop": "notes"}, {"column": 1, "prop": "notes"}], "Two columns"),
    ])
    def test_import_mapping_rejects(self, mapping, msg):
        with pytest.raises(D.SchemaError, match=msg):
            D.plan_import(schema(), ["a", "b"], mapping)

    def test_import_size_cap(self):
        with pytest.raises(D.SchemaError, match="2 MB"):
            D.parse_csv("a\n" + "x" * (D.MAX_IMPORT_BYTES + 1))


class TestTemplates:
    @pytest.mark.parametrize("key", D.TEMPLATE_KEYS)
    def test_templates_are_valid(self, key):
        s, rows, icon = D.template(key)
        assert icon
        for _title, props in rows:
            D.clean_props(s, props)

    def test_required_templates_exist(self):
        names = {t["name"] for t in D.template_list()}
        assert {"Client CRM", "Invoice tracker", "Project tracker", "Content calendar", "Task board"} <= names


# ---------------------------------------------------------------------------
# Router against Postgres (tests/pg_harness.py; skipped without one)
# ---------------------------------------------------------------------------

class Env:
    def __init__(self, pg):
        self.pg = pg
        self.alice = pg.user("Alice")
        self.bob = pg.user("Bob")

    def call(self, fn):
        return self.pg.run(lambda pool: fn())

    def page(self, pid):
        r = self.pg.sql("SELECT * FROM published_pages WHERE id = $1", pid)
        return dict(r[0]) if r else None

    def children(self, pid):
        return [dict(r) for r in self.pg.sql(
            "SELECT * FROM published_pages WHERE parent_id = $1 ORDER BY position", pid)]


@pytest.fixture
def db(pg):
    return Env(pg)


def make_db(env, template="tasks", user=None, role="editor"):
    user = user or env.alice
    return env.call(lambda: R.create_database(R.CreateDatabaseBody(title="Work", template=template),
                                              req(user, role), role))


def fails(env, fn):
    with pytest.raises(HTTPException) as e:
        env.call(fn)
    return e.value.status_code


class TestRouter:
    def test_create_from_template_makes_rows(self, db):
        out = make_db(db)
        assert out["database"]["views"][0]["type"] == "board"
        rows = db.children(out["id"])
        assert len(rows) == 3 and all(json.loads(r["metadata"])["db_row"] == out["id"] for r in rows)
        assert db.page(out["id"])["content_type"] == "database"

    def test_unknown_template(self, db):
        assert fails(db, lambda: R.create_database(R.CreateDatabaseBody(template="nope"), req(db.alice), "editor")) == 422

    def test_row_crud(self, db):
        d = make_db(db, "blank")
        a = req(db.alice)
        row = db.call(lambda: R.create_row(d["id"], R.RowBody(title="First", props={"notes": "hello"}), a, "editor"))
        assert row["title"] == "First" and row["props"] == {"notes": "hello"}
        assert db.page(row["id"])["content_type"] == "doc"
        upd = db.call(lambda: R.update_row(d["id"], row["id"], R.RowPatchBody(title="Renamed", props={"notes": None}),
                                           a, "editor"))
        assert upd["title"] == "Renamed" and upd["props"] == {}
        assert db.call(lambda: R.query_rows(d["id"], R.QueryBody(), a, "editor"))["total"] == 1
        db.call(lambda: R.delete_rows(d["id"], R.IdsBody(ids=[row["id"]]), a, "editor"))
        assert db.page(row["id"])["deleted_at"] is not None
        assert db.call(lambda: R.query_rows(d["id"], R.QueryBody(), a, "editor"))["total"] == 0

    def test_row_values_are_validated(self, db):
        d = make_db(db)
        assert fails(db, lambda: R.create_row(d["id"], R.RowBody(title="x", props={"status": "Nope"}),
                                              req(db.alice), "editor")) == 422
        rid = db.children(d["id"])[0]["id"]
        assert fails(db, lambda: R.update_row(d["id"], str(rid), R.RowPatchBody(props={"status": "Nope"}),
                                              req(db.alice), "editor")) == 422

    def test_bulk_update_for_board_drag(self, db):
        d = make_db(db)
        ids = [str(p["id"]) for p in db.children(d["id"])]
        out = db.call(lambda: R.bulk_update_rows(d["id"], R.BulkBody(updates=[
            R.BulkItem(id=ids[0], props={"status": "o3"}, position=1.5),
            R.BulkItem(id=ids[1], position=2.5),
        ]), req(db.alice), "editor"))
        assert out["rows"][0]["props"]["status"] == "o3" and out["rows"][0]["position"] == 1.5
        assert db.page(ids[1])["position"] == 2.5

    def test_bulk_refuses_rows_of_another_database(self, db):
        d1, d2 = make_db(db), make_db(db)
        stray = str(db.children(d2["id"])[0]["id"])
        assert fails(db, lambda: R.bulk_update_rows(d1["id"], R.BulkBody(updates=[R.BulkItem(id=stray, position=1)]),
                                                    req(db.alice), "editor")) == 404

    def test_query_uses_view_and_parameters(self, db):
        d = make_db(db, "invoices")
        out = db.call(lambda: R.query_rows(d["id"], R.QueryBody(view_id="v_unpaid"), req(db.alice), "editor"))
        assert all(not r["props"].get("paid") for r in out["rows"])
        assert fails(db, lambda: R.query_rows(d["id"], R.QueryBody(
            filter={"rules": [{"prop": "amount", "cmp": "like", "value": 1}]}), req(db.alice), "editor")) == 422
        assert fails(db, lambda: R.query_rows(d["id"], R.QueryBody(view_id="nope"), req(db.alice), "editor")) == 404

    def test_ownership(self, db):
        d = make_db(db)
        b = req(db.bob)
        for call in (
            lambda: R.get_database(d["id"], b, "editor"),
            lambda: R.query_rows(d["id"], R.QueryBody(), b, "editor"),
            lambda: R.create_row(d["id"], R.RowBody(title="x"), b, "editor"),
            lambda: R.export_csv(d["id"], b, "editor"),
        ):
            assert fails(db, call) == 403
        # The superadmin reaches everything, and its listing is not scoped.
        sa = req(db.bob, "superadmin")
        db.call(lambda: R.create_row(d["id"], R.RowBody(title="Bob's"), sa, "superadmin"))
        assert db.call(lambda: R.query_rows(d["id"], R.QueryBody(), sa, "superadmin"))["total"] == 4
        assert db.call(lambda: R.query_rows(d["id"], R.QueryBody(), req(db.alice), "editor"))["total"] == 3

    def test_not_a_database(self, db):
        pid = db.pg.page(db.alice, "Plain")
        assert fails(db, lambda: R.get_database(pid, req(db.alice), "editor")) == 409

    def test_trashed_database_refuses_writes(self, db):
        d = make_db(db)
        db.pg.sql("UPDATE published_pages SET deleted_at = NOW() WHERE id = $1", d["id"])
        assert fails(db, lambda: R.create_row(d["id"], R.RowBody(title="x"), req(db.alice), "editor")) == 409

    def test_schema_update_retypes_rows(self, db):
        d = make_db(db, "blank")
        a = req(db.alice)
        row = db.call(lambda: R.create_row(d["id"], R.RowBody(title="r", props={"notes": "Urgent"}), a, "editor"))
        props = d["database"]["properties"]
        props[1] = {**props[1], "type": "select", "options": []}
        out = db.call(lambda: R.update_schema(d["id"], R.SchemaBody(properties=props), a, "editor"))
        opt = out["database"]["properties"][1]["options"][0]
        assert opt["name"] == "Urgent"
        assert D.props_of(db.page(row["id"])["metadata"]) == {"notes": opt["id"]}
        assert json.loads(db.page(d["id"])["metadata"])["database"] == out["database"]
        assert fails(db, lambda: R.update_schema(d["id"], R.SchemaBody(properties=[]), a, "editor")) == 422

    def test_csv_round_trip(self, db):
        d = make_db(db, "blank")
        a = req(db.alice)
        out = db.call(lambda: R.import_csv(d["id"], R.ImportBody(
            csv="Name,Notes,Score\n=evil(),\"a, b\",7\nPlain,,\n",
            mapping=[{"column": 0, "prop": "title"}, {"column": 1, "prop": "notes"},
                     {"column": 2, "new_type": "number"}]), a, "editor"))
        assert out["created"] == 2
        assert [p["name"] for p in out["database"]["properties"]] == ["Name", "Notes", "Score"]
        resp = db.call(lambda: R.export_csv(d["id"], a, "editor"))
        text = resp.body.decode("utf-8").lstrip("﻿")
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0] == ["Name", "Notes", "Score"]
        assert rows[1] == ["'=evil()", "a, b", "7"]
        assert resp.headers["content-disposition"].endswith('.csv"')

    def test_publish_rows_and_public_rows(self, db):
        d = make_db(db)
        assert db.call(lambda: R.publish_rows(d["id"], R.PublishRowsBody(published=True), req(db.alice),
                                              "editor"))["updated"] == 3
        first = db.children(d["id"])[0]
        db.pg.sql("UPDATE published_pages SET is_published = FALSE WHERE id = $1", first["id"])
        page = db.page(d["id"])
        pub = db.pg.run(lambda pool: R.public_rows(pool, page))["database_rows"]
        assert len(pub) == 3
        assert sum(1 for r in pub if r["slug"]) == 2
        assert db.pg.run(lambda pool: R.public_rows(pool, {"content_type": "markdown"})) == {}

    def test_row_context(self, db):
        d = make_db(db)
        rid = str(db.children(d["id"])[0]["id"])
        ctx = db.call(lambda: R.row_context(rid, req(db.alice), "editor"))
        assert ctx["database"]["id"] == d["id"] and ctx["row"]["id"] == rid
        plain = db.pg.page(db.alice, "Plain")
        assert db.call(lambda: R.row_context(plain, req(db.alice), "editor"))["database"] is None

    def test_page_editor_save_keeps_props_and_schema(self, db):
        d = make_db(db)
        a = req(db.alice)
        rid = str(db.children(d["id"])[0]["id"])
        before = D.props_of(db.page(rid)["metadata"])
        db.call(lambda: P.update_page(rid, P.UpdatePageBody(metadata={"description": "x", "props": {}}), a, "editor"))
        meta = json.loads(db.page(rid)["metadata"])
        assert meta["props"] == before and meta["description"] == "x"
        db.call(lambda: P.update_page(d["id"], P.UpdatePageBody(metadata={"folder": "f"}), a, "editor"))
        assert "database" in json.loads(db.page(d["id"])["metadata"])


def test_database_routes_take_their_id_from_the_path():
    """Every /{db_id} route must read db_id from the path. A dependency that
    names its parameter page_id turned into a required query parameter, and
    every database request answered 422."""
    from fastapi.dependencies.utils import get_flat_dependant
    from app.routers import databases as D

    checked = 0
    for route in D.router.routes:
        if "{db_id}" not in getattr(route, "path", ""):
            continue
        flat = get_flat_dependant(route.dependant)
        assert not [q.name for q in flat.query_params if q.name in ("page_id", "db_id")], route.path
        assert "db_id" in [p.name for p in flat.path_params], route.path
        checked += 1
    assert checked >= 9
