"""
Databases: schema validation, values, the row query's SQL, CSV, and the
router's row CRUD and ownership.

The router is called directly against an in-memory store that answers the
statements it sends (recognised by a distinctive fragment of each), as in
test_page_tree.py. The filter/sort SQL itself is pinned at the builder: every
client value must arrive as a bind parameter, never in the SQL text.
"""

import asyncio
import csv
import io
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.databases as R
import app.routers.pages as P
import app.services.databases as D
import app.services.page_tree as T

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())


def run(coro):
    return asyncio.run(coro)


def req(user=ALICE, role="editor"):
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role))


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
# Router against an in-memory store
# ---------------------------------------------------------------------------

class FakeDB:
    def __init__(self):
        self.pages: dict[str, dict] = {}
        self.queries: list[tuple[str, list]] = []
        self._t = 0

    def add(self, title, owner=ALICE, parent=None, content_type="markdown", metadata=None, **over):
        self._t += 1
        pid = str(uuid.uuid4())
        now = datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=self._t)
        self.pages[pid] = {
            "id": pid, "slug": f"{title.lower().replace(' ', '-')}-{self._t}", "title": title, "icon": None,
            "cover": None, "parent_id": parent, "position": float(self._t), "content_type": content_type,
            "content": "", "is_published": False, "updated_at": now, "created_at": now, "created_by": owner,
            "updated_by": owner, "deleted_at": None, "expires_at": None, "is_password_protected": False,
            "password_hash": None, "published_at": None, "metadata": json.dumps(metadata or {}), "view_count": 0,
        }
        self.pages[pid].update(over)
        return pid

    def with_props(self, p):
        return {**p, "props": json.dumps(D.props_of(p["metadata"]))}

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
            return True
        if "WHERE slug = $1" in sql:
            return next((p["id"] for p in self.pages.values() if p["slug"] == a[0]), None)
        if "SELECT metadata FROM published_pages" in sql:
            return self.pages[str(a[0])]["metadata"]
        if "MAX(position)" in sql:
            return max((p["position"] for p in self.pages.values() if p["parent_id"] == a[0]), default=None)
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def fetchrow(self, sql, *a):
        if sql.startswith("INSERT INTO published_pages"):
            self._t += 1
            now = datetime(2026, 10, 2, tzinfo=timezone.utc) + timedelta(minutes=self._t)
            pid = str(uuid.uuid4())
            row = {
                "id": pid, "slug": a[0], "title": a[1], "content_type": a[2], "metadata": a[3],
                "created_by": a[4], "updated_by": a[4], "parent_id": a[5], "content": "",
                "is_published": False, "created_at": now, "updated_at": now, "deleted_at": None,
                "expires_at": None, "cover": None, "is_password_protected": False, "password_hash": None,
                "published_at": None, "view_count": 0,
            }
            if "position" in sql.split("VALUES")[0]:
                row["position"] = a[6] if a[6] is not None else 10_000.0 + self._t
                row["icon"] = a[7]
            else:
                row["position"] = 10_000.0 + self._t
                row["icon"] = a[6]
            self.pages[pid] = row
            return self.with_props(row)
        if sql.startswith("UPDATE published_pages SET"):
            p = self.pages[str(a[-1])]
            cols = sql.split("SET ", 1)[1].split(" WHERE")[0].split(", ")
            for col, value in zip(cols, a):
                p[col.split(" = ")[0]] = value
            return self.with_props(p)
        if "LEFT JOIN published_pages d" in sql:
            p = self.pages.get(str(a[0]))
            if not p:
                return None
            d = self.pages.get(str(p["parent_id"])) if p["parent_id"] else None
            return {**p, "db_id": d and d["id"], "db_title": d and d["title"], "db_icon": None,
                    "db_metadata": d and d["metadata"], "db_type": d and d["content_type"],
                    "db_owner": d and d["created_by"]}
        if "FROM published_pages WHERE id = $1" in sql:
            p = self.pages.get(str(a[0]))
            return dict(p) if p else None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def fetch(self, sql, *a):
        if "COUNT(*) OVER ()" in sql:
            self.queries.append((sql, list(a)))
            rows = [p for p in self.pages.values() if p["parent_id"] == a[0] and p["deleted_at"] is None]
            if "p.created_by = $2" in sql:
                rows = [p for p in rows if str(p["created_by"]) == str(a[1])]
            rows.sort(key=lambda p: p["position"])
            limit, offset = a[-2], a[-1]
            page = rows[offset:offset + limit]
            return [{**self.with_props(p), "total_count": len(rows)} for p in page]
        if "WITH RECURSIVE down" in sql:
            out, frontier, depth = [], [str(a[0])], 0
            while frontier:
                out += [{**self.pages[i], "depth": depth} for i in frontier]
                frontier = [p["id"] for p in self.pages.values() if p["parent_id"] in frontier]
                depth += 1
            return out
        if "SELECT id, metadata FROM published_pages WHERE parent_id = $1" in sql:
            return [dict(p) for p in self.pages.values() if p["parent_id"] == a[0]]
        raise AssertionError(f"unexpected fetch: {sql}")

    async def execute(self, sql, *a):
        if "SET metadata = $1::jsonb, updated_at" in sql:
            self.pages[str(a[3])]["metadata"] = a[0]
            return "UPDATE 1"
        if "SET deleted_at = $1 WHERE id = ANY" in sql:
            for i in a[1]:
                self.pages[str(i)]["deleted_at"] = a[0]
            return f"UPDATE {len(a[1])}"
        if "SET is_published = $1" in sql:
            n = 0
            for p in self.pages.values():
                if p["parent_id"] == a[2] and p["deleted_at"] is None and (len(a) < 4 or p["created_by"] == a[3]):
                    p["is_published"] = a[0]
                    n += 1
            return f"UPDATE {n}"
        raise AssertionError(f"unexpected execute: {sql}")

    async def executemany(self, sql, rows):
        assert "SET metadata = $1::jsonb WHERE id = $2" in sql
        for meta, pid in rows:
            self.pages[str(pid)]["metadata"] = meta


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(R, "get_pool", lambda: fake)
    monkeypatch.setattr(P, "get_pool", lambda: fake)
    T.reset_ready_cache()
    yield fake
    T.reset_ready_cache()


def make_db(fake, template="tasks", user=ALICE, role="editor"):
    return run(R.create_database(R.CreateDatabaseBody(title="Work", template=template), req(user, role), role))


class TestRouter:
    def test_create_from_template_makes_rows(self, db):
        out = make_db(db)
        assert out["database"]["views"][0]["type"] == "board"
        rows = [p for p in db.pages.values() if p["parent_id"] == out["id"]]
        assert len(rows) == 3 and all(json.loads(r["metadata"])["db_row"] == out["id"] for r in rows)
        assert db.pages[out["id"]]["content_type"] == "database"

    def test_unknown_template(self, db):
        with pytest.raises(HTTPException) as e:
            run(R.create_database(R.CreateDatabaseBody(template="nope"), req(), "editor"))
        assert e.value.status_code == 422

    def test_row_crud(self, db):
        d = make_db(db, "blank")
        row = run(R.create_row(d["id"], R.RowBody(title="First", props={"notes": "hello"}), req(), "editor"))
        assert row["title"] == "First" and row["props"] == {"notes": "hello"}
        assert db.pages[row["id"]]["content_type"] == "doc"
        upd = run(R.update_row(d["id"], row["id"], R.RowPatchBody(title="Renamed", props={"notes": None}), req(), "editor"))
        assert upd["title"] == "Renamed" and upd["props"] == {}
        listed = run(R.query_rows(d["id"], R.QueryBody(), req(), "editor"))
        assert listed["total"] == 1
        run(R.delete_rows(d["id"], R.IdsBody(ids=[row["id"]]), req(), "editor"))
        assert db.pages[row["id"]]["deleted_at"] is not None
        assert run(R.query_rows(d["id"], R.QueryBody(), req(), "editor"))["total"] == 0

    def test_row_values_are_validated(self, db):
        d = make_db(db)
        with pytest.raises(HTTPException) as e:
            run(R.create_row(d["id"], R.RowBody(title="x", props={"status": "Nope"}), req(), "editor"))
        assert e.value.status_code == 422

    def test_bulk_update_for_board_drag(self, db):
        d = make_db(db)
        ids = [p["id"] for p in db.pages.values() if p["parent_id"] == d["id"]]
        out = run(R.bulk_update_rows(d["id"], R.BulkBody(updates=[
            R.BulkItem(id=ids[0], props={"status": "o3"}, position=1.5),
            R.BulkItem(id=ids[1], position=2.5),
        ]), req(), "editor"))
        assert out["rows"][0]["props"]["status"] == "o3" and out["rows"][0]["position"] == 1.5
        assert db.pages[ids[1]]["position"] == 2.5

    def test_bulk_refuses_rows_of_another_database(self, db):
        d1, d2 = make_db(db), make_db(db)
        stray = next(p["id"] for p in db.pages.values() if p["parent_id"] == d2["id"])
        with pytest.raises(HTTPException) as e:
            run(R.bulk_update_rows(d1["id"], R.BulkBody(updates=[R.BulkItem(id=stray, position=1)]), req(), "editor"))
        assert e.value.status_code == 404

    def test_query_uses_view_and_parameters(self, db):
        d = make_db(db, "invoices")
        run(R.query_rows(d["id"], R.QueryBody(view_id="v_unpaid"), req(), "editor"))
        sql, args = db.queries[-1]
        assert "jsonb" in sql and "paid" in args and False in args
        with pytest.raises(HTTPException) as e:
            run(R.query_rows(d["id"], R.QueryBody(filter={"rules": [{"prop": "amount", "cmp": "like", "value": 1}]}), req(), "editor"))
        assert e.value.status_code == 422
        with pytest.raises(HTTPException) as e:
            run(R.query_rows(d["id"], R.QueryBody(view_id="nope"), req(), "editor"))
        assert e.value.status_code == 404

    def test_ownership(self, db):
        d = make_db(db)
        for call in (
            lambda: R.get_database(d["id"], req(BOB), "editor"),
            lambda: R.query_rows(d["id"], R.QueryBody(), req(BOB), "editor"),
            lambda: R.create_row(d["id"], R.RowBody(title="x"), req(BOB), "editor"),
            lambda: R.export_csv(d["id"], req(BOB), "editor"),
        ):
            with pytest.raises(HTTPException) as e:
                run(call())
            assert e.value.status_code == 403
        # The superadmin reaches everything, and its listing is not scoped.
        assert run(R.query_rows(d["id"], R.QueryBody(), req(BOB, "superadmin"), "superadmin"))["total"] == 3
        assert "p.created_by =" not in db.queries[-1][0]
        run(R.query_rows(d["id"], R.QueryBody(), req(), "editor"))
        assert "p.created_by = $2" in db.queries[-1][0]

    def test_not_a_database(self, db):
        pid = db.add("Plain")
        with pytest.raises(HTTPException) as e:
            run(R.get_database(pid, req(), "editor"))
        assert e.value.status_code == 409

    def test_trashed_database_refuses_writes(self, db):
        d = make_db(db)
        db.pages[d["id"]]["deleted_at"] = datetime.now(timezone.utc)
        with pytest.raises(HTTPException) as e:
            run(R.create_row(d["id"], R.RowBody(title="x"), req(), "editor"))
        assert e.value.status_code == 409

    def test_schema_update_retypes_rows(self, db):
        d = make_db(db, "blank")
        row = run(R.create_row(d["id"], R.RowBody(title="r", props={"notes": "Urgent"}), req(), "editor"))
        props = d["database"]["properties"]
        props[1] = {**props[1], "type": "select", "options": []}
        out = run(R.update_schema(d["id"], R.SchemaBody(properties=props), req(), "editor"))
        opt = out["database"]["properties"][1]["options"][0]
        assert opt["name"] == "Urgent"
        assert D.props_of(db.pages[row["id"]]["metadata"]) == {"notes": opt["id"]}
        assert json.loads(db.pages[d["id"]]["metadata"])["database"] == out["database"]
        with pytest.raises(HTTPException) as e:
            run(R.update_schema(d["id"], R.SchemaBody(properties=[]), req(), "editor"))
        assert e.value.status_code == 422

    def test_csv_round_trip(self, db):
        d = make_db(db, "blank")
        out = run(R.import_csv(d["id"], R.ImportBody(
            csv="Name,Notes,Score\n=evil(),\"a, b\",7\nPlain,,\n",
            mapping=[{"column": 0, "prop": "title"}, {"column": 1, "prop": "notes"},
                     {"column": 2, "new_type": "number"}]), req(), "editor"))
        assert out["created"] == 2
        assert [p["name"] for p in out["database"]["properties"]] == ["Name", "Notes", "Score"]
        resp = run(R.export_csv(d["id"], req(), "editor"))
        text = resp.body.decode("utf-8").lstrip("﻿")
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0] == ["Name", "Notes", "Score"]
        assert rows[1] == ["'=evil()", "a, b", "7"]
        assert resp.headers["content-disposition"].endswith('.csv"')

    def test_publish_rows_and_public_rows(self, db):
        d = make_db(db)
        assert run(R.publish_rows(d["id"], R.PublishRowsBody(published=True), req(), "editor"))["updated"] == 3
        first = next(p for p in db.pages.values() if p["parent_id"] == d["id"])
        first["is_published"] = False
        pub = run(R.public_rows(db, db.pages[d["id"]]))["database_rows"]
        assert len(pub) == 3
        assert sum(1 for r in pub if r["slug"]) == 2
        assert run(R.public_rows(db, {"content_type": "markdown"})) == {}

    def test_row_context(self, db):
        d = make_db(db)
        rid = next(p["id"] for p in db.pages.values() if p["parent_id"] == d["id"])
        ctx = run(R.row_context(rid, req(), "editor"))
        assert ctx["database"]["id"] == d["id"] and ctx["row"]["id"] == rid
        plain = db.add("Plain")
        assert run(R.row_context(plain, req(), "editor"))["database"] is None

    def test_page_editor_save_keeps_props_and_schema(self, db, monkeypatch):
        async def noop(*a, **k):
            return None
        monkeypatch.setattr(P, "_snapshot_version", noop)
        d = make_db(db)
        rid = next(p["id"] for p in db.pages.values() if p["parent_id"] == d["id"])
        before = D.props_of(db.pages[rid]["metadata"])
        db.pages[rid]["metadata"] = json.dumps({**json.loads(db.pages[rid]["metadata"])})
        run(P.update_page(rid, P.UpdatePageBody(metadata={"description": "x", "props": {}}), req(), "editor"))
        meta = json.loads(db.pages[rid]["metadata"])
        assert meta["props"] == before and meta["description"] == "x"
        run(P.update_page(d["id"], P.UpdatePageBody(metadata={"folder": "f"}), req(), "editor"))
        assert "database" in json.loads(db.pages[d["id"]]["metadata"])
