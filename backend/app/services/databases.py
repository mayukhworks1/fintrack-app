"""
Databases: a page whose rows are pages.

Storage follows the page tree and needs no tables of its own:

  * the database is a page with content_type "database"; its schema
    (properties), its saved views and the default view live in the page's
    metadata under "database";
  * every row is a child page (parent_id = the database page) whose property
    values live in its own metadata under "props", keyed by property id. The
    title property is the row page's title; created / last edited time are the
    row page's created_at / updated_at.

A row is an ordinary page, so it opens in the page editor, keeps versions, can
be published on its own and goes to the trash like any page.

This module is pure: schema and value validation, the parameterised SQL for
filtering and sorting rows over the props JSON, CSV conversion and the
templates. The router (routers/databases.py) does the I/O.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from ..utils.csv_safe import csv_safe_row

CONTENT_TYPE = "database"

PROP_TYPES = (
    "title", "text", "number", "date", "select", "multi_select", "person",
    "checkbox", "url", "created_time", "last_edited_time",
)
# Values the server works out; never written by a client.
COMPUTED_TYPES = ("created_time", "last_edited_time")
VIEW_TYPES = ("table", "board", "gallery", "calendar")
COLORS = ("gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red")
NUMBER_FORMATS = ("plain", "inr", "percent")
# Content types a row page may take. "doc" is the block editor's type.
ROW_TYPES = ("markdown", "doc", "text")

MAX_PROPS = 60
MAX_OPTIONS = 100
MAX_VIEWS = 20
MAX_RULES = 20
MAX_SORTS = 5
MAX_TEXT = 10_000
MAX_NAME = 100
MAX_PAGE = 500
MAX_IMPORT_ROWS = 2000
MAX_IMPORT_BYTES = 2_000_000

IST = timezone(timedelta(hours=5, minutes=30), "IST")

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")


class SchemaError(ValueError):
    """A schema, view, filter or value the client sent is not acceptable."""


def new_id(prefix: str = "") -> str:
    return prefix + secrets.token_hex(4)


# ---------------------------------------------------------------------------
# Operators
# ---------------------------------------------------------------------------

_TEXT_OPS = ("eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty")
_DATE_OPS = ("eq", "before", "after", "on_or_before", "on_or_after", "empty", "not_empty")

OPERATORS: dict[str, tuple[str, ...]] = {
    "title": _TEXT_OPS,
    "text": _TEXT_OPS,
    "url": _TEXT_OPS,
    "person": _TEXT_OPS,
    "number": ("eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"),
    "date": _DATE_OPS,
    "created_time": _DATE_OPS,
    "last_edited_time": _DATE_OPS,
    "select": ("eq", "neq", "empty", "not_empty"),
    "multi_select": ("contains", "not_contains", "empty", "not_empty"),
    "checkbox": ("eq",),
}

_VALUELESS = ("empty", "not_empty")


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def default_schema() -> dict:
    view = {"id": "v_table", "name": "Table", "type": "table"}
    return normalize_schema({
        "properties": [{"id": "title", "name": "Name", "type": "title"}],
        "views": [view],
        "default_view": "v_table",
    })


def _name(value: Any, what: str) -> str:
    name = str(value or "").strip()
    if not name:
        raise SchemaError(f"{what} needs a name")
    if len(name) > MAX_NAME:
        raise SchemaError(f"{what} name is longer than {MAX_NAME} characters")
    return name


def _ident(value: Any, what: str) -> str:
    sid = str(value or "")
    if not _ID_RE.match(sid):
        raise SchemaError(f"{what} id is not valid")
    return sid


def _options(raw: Any, prop_name: str) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SchemaError(f"Options of {prop_name} must be a list")
    if len(raw) > MAX_OPTIONS:
        raise SchemaError(f"{prop_name} has more than {MAX_OPTIONS} options")
    out, ids, names = [], set(), set()
    for o in raw:
        if not isinstance(o, dict):
            raise SchemaError(f"Options of {prop_name} must be objects")
        oid = _ident(o.get("id"), "Option")
        name = _name(o.get("name"), "An option")
        if oid in ids:
            raise SchemaError(f"{prop_name} has two options with the same id")
        if name.lower() in names:
            raise SchemaError(f"{prop_name} has two options called {name}")
        ids.add(oid)
        names.add(name.lower())
        color = o.get("color") if o.get("color") in COLORS else "gray"
        out.append({"id": oid, "name": name, "color": color})
    return out


def _property(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise SchemaError("Each property must be an object")
    ptype = raw.get("type")
    if ptype not in PROP_TYPES:
        raise SchemaError(f"Unknown property type: {str(ptype)[:40]}")
    prop = {
        "id": _ident(raw.get("id"), "Property"),
        "name": _name(raw.get("name"), "A property"),
        "type": ptype,
    }
    if ptype in ("select", "multi_select"):
        prop["options"] = _options(raw.get("options"), prop["name"])
    if ptype == "number":
        fmt = raw.get("format") or "plain"
        if fmt not in NUMBER_FORMATS:
            raise SchemaError(f"Unknown number format: {str(fmt)[:20]}")
        prop["format"] = fmt
    width = raw.get("width")
    if isinstance(width, (int, float)) and not isinstance(width, bool):
        prop["width"] = int(max(60, min(800, width)))
    return prop


def _rule(raw: Any, props: dict[str, dict], depth: int) -> dict | None:
    if not isinstance(raw, dict):
        raise SchemaError("A filter rule must be an object")
    if "rules" in raw:
        if depth >= 2:
            raise SchemaError("Filter groups can nest one level deep")
        return _filter(raw, props, depth + 1)
    pid = raw.get("prop")
    prop = props.get(pid) if isinstance(pid, str) else None
    if prop is None:
        return None  # a rule on a deleted property drops out
    cmp = raw.get("cmp")
    if cmp not in OPERATORS[prop["type"]]:
        raise SchemaError(f"Operator {str(cmp)[:20]} does not apply to {prop['name']}")
    rule = {"prop": pid, "cmp": cmp}
    if cmp not in _VALUELESS:
        rule["value"] = filter_value(prop, raw.get("value"))
    return rule


def _filter(raw: Any, props: dict[str, dict], depth: int = 1) -> dict | None:
    if raw in (None, {}, []):
        return None
    if not isinstance(raw, dict):
        raise SchemaError("A filter must be an object")
    op = raw.get("op", "and")
    if op not in ("and", "or"):
        raise SchemaError("A filter joins its rules with and / or")
    rules_in = raw.get("rules") or []
    if not isinstance(rules_in, list):
        raise SchemaError("Filter rules must be a list")
    if len(rules_in) > MAX_RULES:
        raise SchemaError(f"A filter takes at most {MAX_RULES} rules")
    rules = [r for r in (_rule(x, props, depth) for x in rules_in) if r]
    return {"op": op, "rules": rules} if rules else None


def normalize_filter(raw: Any, schema: dict) -> dict | None:
    return _filter(raw, {p["id"]: p for p in schema["properties"]})


def normalize_sort(raw: Any, schema: dict) -> list[dict]:
    if not raw:
        return []
    if not isinstance(raw, list):
        raise SchemaError("Sorts must be a list")
    if len(raw) > MAX_SORTS:
        raise SchemaError(f"At most {MAX_SORTS} sorts")
    props = {p["id"] for p in schema["properties"]}
    out = []
    for s in raw:
        if not isinstance(s, dict):
            raise SchemaError("A sort must be an object")
        if s.get("dir", "asc") not in ("asc", "desc"):
            raise SchemaError("Sort direction is asc or desc")
        if s.get("prop") in props:
            out.append({"prop": s["prop"], "dir": s.get("dir", "asc")})
    return out


def filter_value(prop: dict, value: Any) -> Any:
    """The comparison value of a filter rule, checked against the property."""
    t = prop["type"]
    if t in ("number",):
        num = _to_number(value)
        if num is None:
            raise SchemaError(f"Filter on {prop['name']} needs a number")
        return num
    if t in ("date", "created_time", "last_edited_time"):
        d = _to_date(value)
        if d is None:
            raise SchemaError(f"Filter on {prop['name']} needs a date (YYYY-MM-DD)")
        return d[:10]
    if t == "checkbox":
        if isinstance(value, bool):
            return value
        if str(value).lower() in ("true", "false"):
            return str(value).lower() == "true"
        raise SchemaError(f"Filter on {prop['name']} needs true or false")
    if t in ("select", "multi_select"):
        ids = {o["id"] for o in prop.get("options", [])}
        if value not in ids:
            raise SchemaError(f"Filter on {prop['name']} needs one of its options")
        return value
    s = "" if value is None else str(value)
    if len(s) > 500:
        raise SchemaError("Filter text is too long")
    return s


def _view(raw: Any, schema: dict) -> dict:
    if not isinstance(raw, dict):
        raise SchemaError("Each view must be an object")
    vtype = raw.get("type")
    if vtype not in VIEW_TYPES:
        raise SchemaError(f"Unknown view type: {str(vtype)[:20]}")
    props = {p["id"]: p for p in schema["properties"]}
    view: dict[str, Any] = {
        "id": _ident(raw.get("id"), "View"),
        "name": _name(raw.get("name"), "A view"),
        "type": vtype,
        "filter": _filter(raw.get("filter"), props),
        "sort": normalize_sort(raw.get("sort"), schema),
    }
    keep = lambda ids: [i for i in (ids or []) if isinstance(i, str) and i in props]  # noqa: E731
    view["hidden"] = list(dict.fromkeys(keep(raw.get("hidden"))))
    view["order"] = list(dict.fromkeys(keep(raw.get("order"))))
    widths = raw.get("widths") or {}
    if isinstance(widths, dict):
        view["widths"] = {k: int(max(60, min(800, v))) for k, v in widths.items()
                          if k in props and isinstance(v, (int, float)) and not isinstance(v, bool)}
    footer = raw.get("footer") or {}
    if isinstance(footer, dict):
        view["footer"] = {k: v for k, v in footer.items()
                          if k in props and props[k]["type"] == "number" and v in ("sum", "avg")}
    if vtype == "board":
        gb = raw.get("group_by")
        if gb is not None and (gb not in props or props[gb]["type"] != "select"):
            raise SchemaError("A board groups by a select property")
        if gb is None:
            gb = next((p["id"] for p in schema["properties"] if p["type"] == "select"), None)
        view["group_by"] = gb
    if vtype == "calendar":
        dp = raw.get("date_prop")
        dated = ("date", "created_time", "last_edited_time")
        if dp is not None and (dp not in props or props[dp]["type"] not in dated):
            raise SchemaError("A calendar is laid out by a date property")
        if dp is None:
            dp = next((p["id"] for p in schema["properties"] if p["type"] == "date"), None)
        view["date_prop"] = dp
    if vtype in ("board", "gallery", "calendar"):
        view["card_props"] = list(dict.fromkeys(keep(raw.get("card_props"))))[:8]
    if vtype == "gallery":
        view["cover"] = raw.get("cover") if raw.get("cover") in ("cover", "none") else "cover"
    return view


def normalize_schema(raw: Any) -> dict:
    """A clean copy of a database schema, or SchemaError saying what is wrong."""
    if not isinstance(raw, dict):
        raise SchemaError("The database schema must be an object")
    props_in = raw.get("properties")
    if not isinstance(props_in, list) or not props_in:
        raise SchemaError("A database needs at least its title property")
    if len(props_in) > MAX_PROPS:
        raise SchemaError(f"A database takes at most {MAX_PROPS} properties")
    props = [_property(p) for p in props_in]
    ids = [p["id"] for p in props]
    if len(set(ids)) != len(ids):
        raise SchemaError("Two properties share an id")
    names = [p["name"].lower() for p in props]
    if len(set(names)) != len(names):
        raise SchemaError("Two properties share a name")
    titles = [p for p in props if p["type"] == "title"]
    if len(titles) != 1 or titles[0]["id"] != "title":
        raise SchemaError("A database has exactly one title property, with id 'title'")
    schema: dict[str, Any] = {"version": 1, "properties": props}

    views_in = raw.get("views") or [{"id": "v_table", "name": "Table", "type": "table"}]
    if not isinstance(views_in, list):
        raise SchemaError("Views must be a list")
    if len(views_in) > MAX_VIEWS:
        raise SchemaError(f"A database takes at most {MAX_VIEWS} views")
    views = [_view(v, schema) for v in views_in]
    if len({v["id"] for v in views}) != len(views):
        raise SchemaError("Two views share an id")
    schema["views"] = views
    dv = raw.get("default_view")
    schema["default_view"] = dv if dv in {v["id"] for v in views} else views[0]["id"]
    rt = raw.get("row_type") or "doc"
    schema["row_type"] = rt if rt in ROW_TYPES else "doc"
    return schema


def schema_of(metadata: Any) -> dict:
    """The schema stored on a database page, or a fresh one if it is missing
    or unreadable (a page turned into a database by hand)."""
    meta = _as_dict(metadata)
    try:
        return normalize_schema(meta.get("database"))
    except SchemaError:
        return default_schema()


def _as_dict(v: Any) -> dict:
    if not v:
        return {}
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {}
    return dict(v) if isinstance(v, dict) else {}


def props_of(metadata: Any) -> dict:
    props = _as_dict(metadata).get("props")
    return dict(props) if isinstance(props, dict) else {}


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------

def _to_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        f = float(value)
    else:
        s = str(value).strip().replace("₹", "").replace(",", "").replace("%", "").replace(" ", "")
        if s.upper().startswith("RS."):
            s = s[3:]
        if not s:
            return None
        try:
            f = float(s)
        except ValueError:
            return None
    return f if math.isfinite(f) else None


_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%Y/%m/%d")


def _to_date(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        return value.astimezone(IST).strftime("%Y-%m-%dT%H:%M") if value.tzinfo else value.strftime("%Y-%m-%dT%H:%M")
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s:
        return None
    if _DATE_RE.match(s):
        try:
            datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None
        return s
    if re.match(r"^\d{4}-\d{2}-\d{2}T", s):  # a longer ISO timestamp
        try:
            datetime.strptime(s[:16], "%Y-%m-%dT%H:%M")
            return s[:16]
        except ValueError:
            return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


_TRUE = ("true", "yes", "y", "1", "✓", "x", "done", "checked")
_FALSE = ("false", "no", "n", "0", "", "unchecked")


def _to_url(value: Any) -> str | None:
    s = str(value or "").strip()
    if not s:
        return None
    if len(s) > 2000 or any(c.isspace() for c in s) or any(c in s for c in "<>\"'"):
        raise SchemaError("Not a valid link")
    low = s.lower()
    if low.startswith(("https://", "http://", "mailto:")):
        return s
    if ":" in s.split("/", 1)[0] or "." not in s:
        raise SchemaError("Links start with https://, http:// or mailto:")
    return "https://" + s


def _option_lookup(prop: dict) -> tuple[set[str], dict[str, str]]:
    opts = prop.get("options", [])
    return {o["id"] for o in opts}, {o["name"].lower(): o["id"] for o in opts}


def clean_value(prop: dict, value: Any) -> Any:
    """A property value as stored, or SchemaError. None clears the value."""
    t = prop["type"]
    name = prop["name"]
    if t in COMPUTED_TYPES or t == "title":
        raise SchemaError(f"{name} cannot be set directly")
    if value is None or value == "" or value == []:
        return False if t == "checkbox" else None
    if t == "text" or t == "person":
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise SchemaError(f"{name} takes text")
        s = str(value)
        limit = MAX_TEXT if t == "text" else 200
        if len(s) > limit:
            raise SchemaError(f"{name} is longer than {limit} characters")
        return s
    if t == "number":
        num = _to_number(value)
        if num is None:
            raise SchemaError(f"{name} takes a number")
        return int(num) if num.is_integer() and abs(num) < 2**53 else num
    if t == "date":
        d = _to_date(value)
        if d is None:
            raise SchemaError(f"{name} takes a date (YYYY-MM-DD)")
        return d
    if t == "checkbox":
        if isinstance(value, bool):
            return value
        s = str(value).strip().lower()
        if s in _TRUE:
            return True
        if s in _FALSE:
            return False
        raise SchemaError(f"{name} takes true or false")
    if t == "url":
        return _to_url(value)
    if t == "select":
        ids, by_name = _option_lookup(prop)
        if isinstance(value, str) and value in ids:
            return value
        if isinstance(value, str) and value.strip().lower() in by_name:
            return by_name[value.strip().lower()]
        raise SchemaError(f"{name} takes one of its options")
    if t == "multi_select":
        ids, by_name = _option_lookup(prop)
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list) or len(value) > 50:
            raise SchemaError(f"{name} takes a list of its options")
        out = []
        for v in value:
            if isinstance(v, str) and v in ids:
                oid = v
            elif isinstance(v, str) and v.strip().lower() in by_name:
                oid = by_name[v.strip().lower()]
            else:
                raise SchemaError(f"{name} takes a list of its options")
            if oid not in out:
                out.append(oid)
        return out or None
    raise SchemaError(f"{name} cannot be set")  # pragma: no cover


def clean_props(schema: dict, props: Any) -> dict:
    """Validated property values from a client, keyed by property id."""
    if props is None:
        return {}
    if not isinstance(props, dict):
        raise SchemaError("Properties must be an object")
    by_id = {p["id"]: p for p in schema["properties"]}
    out = {}
    for pid, value in props.items():
        prop = by_id.get(pid)
        if prop is None:
            raise SchemaError(f"Unknown property: {str(pid)[:40]}")
        out[pid] = clean_value(prop, value)
    return out


def value_text(prop: dict, value: Any) -> str:
    """A property value as plain text (CSV export, retyping)."""
    t = prop["type"]
    if t == "checkbox":
        return "Yes" if value is True else "No"
    if value is None:
        return ""
    if t == "select":
        return next((o["name"] for o in prop.get("options", []) if o["id"] == value), "")
    if t == "multi_select":
        names = {o["id"]: o["name"] for o in prop.get("options", [])}
        return ", ".join(names[v] for v in (value if isinstance(value, list) else []) if v in names)
    if t == "number" and isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def lenient_value(prop: dict, text: Any) -> Any:
    """Best effort at turning text (an imported cell, a retyped value) into a
    value of this property. Anything that does not fit becomes empty."""
    t = prop["type"]
    if t in COMPUTED_TYPES or t == "title":
        return None
    if t == "multi_select" and isinstance(text, str):
        text = [s for s in (x.strip() for x in text.split(",")) if s]
    if t == "checkbox" and isinstance(text, str) and text.strip().lower() not in _TRUE + _FALSE:
        return False
    try:
        return clean_value(prop, text)
    except SchemaError:
        if t == "multi_select" and isinstance(text, list):
            ids, by_name = _option_lookup(prop)
            kept = [v for v in text if isinstance(v, str) and (v in ids or v.lower() in by_name)]
            return clean_value(prop, kept) if kept else None
        return None


def add_options_for(prop: dict, texts: Iterable[str]) -> bool:
    """Give a select / multi-select an option for every distinct name in
    `texts` it does not have yet. True when options were added."""
    if prop["type"] not in ("select", "multi_select"):
        return False
    opts = prop.setdefault("options", [])
    have = {o["name"].lower() for o in opts}
    added = False
    for raw in texts:
        parts = raw.split(",") if prop["type"] == "multi_select" else [raw]
        for name in (p.strip() for p in parts):
            if not name or name.lower() in have or len(opts) >= MAX_OPTIONS:
                continue
            opts.append({"id": new_id("o"), "name": name[:MAX_NAME], "color": COLORS[len(opts) % len(COLORS)]})
            have.add(name.lower())
            added = True
    return added


def convert_props(old: dict, new: dict, rows_props: list[dict]) -> list[dict]:
    """Rewrite stored values after properties were retyped or lost options.

    Returns the new props dict for each row (same order). Values of deleted
    properties are dropped too, so a row never carries stale data.
    """
    old_by = {p["id"]: p for p in old["properties"]}
    new_by = {p["id"]: p for p in new["properties"]}
    out = []
    for props in rows_props:
        nxt = {}
        for pid, value in props.items():
            np_ = new_by.get(pid)
            op_ = old_by.get(pid)
            if np_ is None or np_["type"] in COMPUTED_TYPES or np_["type"] == "title":
                continue
            if op_ is not None and op_["type"] != np_["type"]:
                text = value_text(op_, value)
                if np_["type"] == "multi_select" and op_["type"] == "select":
                    text = [text] if text else []
                nxt[pid] = lenient_value(np_, text)
            elif np_["type"] in ("select", "multi_select"):
                nxt[pid] = lenient_value(np_, value)
            else:
                nxt[pid] = value
        out.append({k: v for k, v in nxt.items() if v is not None})
    return out


# ---------------------------------------------------------------------------
# SQL over the props JSON
# ---------------------------------------------------------------------------

class _Params:
    """Collects bind values; every value from a client goes in here, never
    into the SQL text."""

    def __init__(self, start: int = 1):
        self.values: list[Any] = []
        self.start = start

    def add(self, value: Any, cast: str) -> str:
        self.values.append(value)
        return f"${self.start + len(self.values) - 1}::{cast}"


def _like(s: str, where: str) -> str:
    s = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return {"contains": f"%{s}%", "starts_with": f"{s}%", "ends_with": f"%{s}"}[where]


def _raw(prop: dict, params: _Params) -> str:
    """JSON of the value, for jsonb operators."""
    return f"(p.metadata->'props'->{params.add(prop['id'], 'text')})"


def _text_expr(prop: dict, params: _Params) -> str:
    if prop["type"] == "title":
        return "p.title"
    return f"(p.metadata->'props'->>{params.add(prop['id'], 'text')})"


def _date_expr(prop: dict, params: _Params) -> str:
    t = prop["type"]
    if t == "created_time":
        return "to_char(p.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')"
    if t == "last_edited_time":
        return "to_char(p.updated_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')"
    return f"LEFT({_text_expr(prop, params)}, 10)"


def _number_expr(prop: dict, params: _Params) -> str:
    key = params.add(prop["id"], "text")
    return (f"(CASE WHEN jsonb_typeof(p.metadata->'props'->{key}) = 'number' "
            f"THEN (p.metadata->'props'->>{key})::float8 END)")


def _rule_sql(rule: dict, props: dict[str, dict], params: _Params) -> str:
    if "rules" in rule:
        return _filter_sql(rule, props, params)
    prop = props[rule["prop"]]
    t, cmp, value = prop["type"], rule["cmp"], rule.get("value")

    if t in ("title", "text", "url", "person"):
        x = f"COALESCE({_text_expr(prop, params)}, '')"
        if cmp == "empty":
            return f"{x} = ''"
        if cmp == "not_empty":
            return f"{x} <> ''"
        if cmp == "eq":
            return f"lower({x}) = lower({params.add(value, 'text')})"
        if cmp == "neq":
            return f"lower({x}) <> lower({params.add(value, 'text')})"
        if cmp in ("contains", "starts_with", "ends_with"):
            return f"{x} ILIKE {params.add(_like(value, cmp), 'text')} ESCAPE '\\'"
        if cmp == "not_contains":
            return f"{x} NOT ILIKE {params.add(_like(value, 'contains'), 'text')} ESCAPE '\\'"

    if t == "number":
        x = _number_expr(prop, params)
        if cmp == "empty":
            return f"{x} IS NULL"
        if cmp == "not_empty":
            return f"{x} IS NOT NULL"
        sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[cmp]
        if cmp == "neq":
            return f"({x} IS NULL OR {x} <> {params.add(value, 'float8')})"
        return f"{x} {sym} {params.add(value, 'float8')}"

    if t in ("date", "created_time", "last_edited_time"):
        x = _date_expr(prop, params)
        if cmp == "empty":
            return f"COALESCE({x}, '') = ''"
        if cmp == "not_empty":
            return f"COALESCE({x}, '') <> ''"
        sym = {"eq": "=", "before": "<", "after": ">", "on_or_before": "<=", "on_or_after": ">="}[cmp]
        return f"{x} {sym} {params.add(value, 'text')}"

    if t == "select":
        x = f"COALESCE({_text_expr(prop, params)}, '')"
        if cmp == "empty":
            return f"{x} = ''"
        if cmp == "not_empty":
            return f"{x} <> ''"
        if cmp == "eq":
            return f"{x} = {params.add(value, 'text')}"
        return f"{x} <> {params.add(value, 'text')}"

    if t == "multi_select":
        key = params.add(prop["id"], "text")
        arr = (f"(CASE WHEN jsonb_typeof(p.metadata->'props'->{key}) = 'array' "
               f"THEN p.metadata->'props'->{key} ELSE '[]'::jsonb END)")
        if cmp == "empty":
            return f"jsonb_array_length({arr}) = 0"
        if cmp == "not_empty":
            return f"jsonb_array_length({arr}) > 0"
        has = f"{arr} @> {params.add(json.dumps([value]), 'jsonb')}"
        return has if cmp == "contains" else f"NOT ({has})"

    if t == "checkbox":
        x = f"COALESCE({_raw(prop, params)} = 'true'::jsonb, FALSE)"
        return f"{x} = {params.add(bool(value), 'boolean')}"

    raise SchemaError(f"Operator {cmp} does not apply to {prop['name']}")  # pragma: no cover


def _filter_sql(flt: dict, props: dict[str, dict], params: _Params) -> str:
    joiner = " AND " if flt["op"] == "and" else " OR "
    parts = [_rule_sql(r, props, params) for r in flt["rules"]]
    return "(" + joiner.join(parts) + ")" if parts else "TRUE"


def _sort_sql(sort: list[dict], props: dict[str, dict], params: _Params) -> list[str]:
    out = []
    for s in sort:
        prop = props[s["prop"]]
        t = prop["type"]
        if t == "number":
            x = _number_expr(prop, params)
        elif t == "created_time":
            x = "p.created_at"
        elif t == "last_edited_time":
            x = "p.updated_at"
        elif t == "select":
            ids = [o["id"] for o in prop.get("options", [])]
            x = f"array_position({params.add(ids, 'text[]')}, {_text_expr(prop, params)})"
        elif t == "multi_select":
            ids = [o["id"] for o in prop.get("options", [])]
            x = f"array_position({params.add(ids, 'text[]')}, {_raw(prop, params)}->>0)"
        elif t == "checkbox":
            x = f"COALESCE({_raw(prop, params)} = 'true'::jsonb, FALSE)"
        elif t == "date":
            x = f"NULLIF({_text_expr(prop, params)}, '')"
        else:
            x = f"NULLIF(lower({_text_expr(prop, params)}), '')"
        out.append(f"{x} {'DESC' if s['dir'] == 'desc' else 'ASC'} NULLS LAST")
    return out


ROW_COLS = ("p.id, p.slug, p.title, p.icon, p.cover, p.content_type, p.is_published, "
            "p.expires_at, p.created_at, p.updated_at, p.position, p.created_by, "
            "p.metadata->'props' AS props")


def build_rows_query(
    db_id: str,
    schema: dict,
    flt: dict | None = None,
    sort: list[dict] | None = None,
    limit: int = 100,
    offset: int = 0,
    owner: str | None = None,
    search: str | None = None,
    with_total: bool = True,
    max_limit: int = MAX_PAGE,
) -> tuple[str, list[Any]]:
    """SELECT for a page of rows, with the total in every row (with_total).
    An export or the public view reads one bounded page without the total
    (max_limit above MAX_PAGE), in one statement.

    flt and sort must already be normalised against the schema (so every
    property id and operator is known). Client values only ever travel as
    bind parameters; the SQL text is built from fixed fragments.
    """
    props = {p["id"]: p for p in schema["properties"]}
    params = _Params()
    where = [f"p.parent_id = {params.add(db_id, 'uuid')}", "p.deleted_at IS NULL"]
    if owner is not None:
        where.append(f"p.created_by = {params.add(owner, 'uuid')}")
    if flt:
        where.append(_filter_sql(flt, props, params))
    if search:
        where.append(f"p.title ILIKE {params.add(_like(search[:200], 'contains'), 'text')} ESCAPE '\\'")
    order = _sort_sql(sort or [], props, params) + ["p.position ASC NULLS LAST", "p.created_at ASC", "p.id ASC"]
    limit = max(1, min(int(limit), max_limit))
    offset = max(0, int(offset))
    total = ", COUNT(*) OVER () AS total_count" if with_total else ""
    sql = (
        f"SELECT {ROW_COLS}{total} "
        "FROM published_pages p "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY {', '.join(order)} "
        f"LIMIT {params.add(limit, 'int')} OFFSET {params.add(offset, 'int')}"
    )
    return sql, params.values


# ---------------------------------------------------------------------------
# Serialising rows
# ---------------------------------------------------------------------------

def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def row_dict(row: Any, schema: dict | None = None) -> dict:
    props = row["props"] if "props" in _keys(row) else props_of(row["metadata"])
    props = _as_dict(props) if not isinstance(props, dict) else props
    if schema is not None:
        known = {p["id"] for p in schema["properties"]}
        props = {k: v for k, v in props.items() if k in known}
    return {
        "id": str(row["id"]),
        "slug": row["slug"],
        "title": row["title"] or "",
        "icon": _get(row, "icon"),
        "cover": _get(row, "cover"),
        "content_type": _get(row, "content_type"),
        "is_published": bool(_get(row, "is_published", False)),
        "position": _get(row, "position"),
        "created_at": _iso(_get(row, "created_at")),
        "updated_at": _iso(_get(row, "updated_at")),
        "props": props,
    }


def _keys(row: Any) -> set:
    try:
        return set(row.keys())
    except AttributeError:
        return set()


def _get(row: Any, key: str, default: Any = None) -> Any:
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def _fmt_time(v: Any) -> str:
    if isinstance(v, datetime):
        return v.astimezone(IST).strftime("%Y-%m-%d %H:%M")
    return str(v or "")


def export_csv(schema: dict, rows: list[Any]) -> str:
    """CSV of every row in schema order. Text cells that a spreadsheet would
    run as a formula are neutralised; numbers stay numbers."""
    props = schema["properties"]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(csv_safe_row(p["name"] for p in props))
    for r in rows:
        values = props_of(r["metadata"]) if "metadata" in _keys(r) else _as_dict(r["props"])
        out: list[Any] = []
        for p in props:
            if p["type"] == "title":
                out.append(r["title"] or "")
            elif p["type"] == "created_time":
                out.append(_fmt_time(r["created_at"]))
            elif p["type"] == "last_edited_time":
                out.append(_fmt_time(r["updated_at"]))
            elif p["type"] == "number" and isinstance(values.get(p["id"]), (int, float)):
                out.append(values[p["id"]])
            else:
                out.append(value_text(p, values.get(p["id"])))
        w.writerow(csv_safe_row(out))
    return buf.getvalue()


def parse_csv(text: str) -> list[list[str]]:
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise SchemaError("The CSV is larger than 2 MB")
    text = text.lstrip("﻿")
    try:
        sample = text[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample.strip() else csv.excel
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any((c or "").strip() for c in r)]
    if len(rows) > MAX_IMPORT_ROWS + 1:
        raise SchemaError(f"The CSV has more than {MAX_IMPORT_ROWS} rows")
    return rows


def _unformula(cell: str) -> str:
    """Undo the leading quote an export puts before formula-like text."""
    if cell.startswith("'") and len(cell) > 1 and cell[1] in "=+-@\t\r":
        return cell[1:]
    return cell


def plan_import(schema: dict, header: list[str], mapping: list[dict]) -> tuple[dict, list[tuple[int, dict | None]]]:
    """Apply an import mapping to a copy of the schema.

    mapping: [{"column": i, "prop": "<id>"} | {"column": i, "new_type": t,
    "name": "..."} | {"column": i, "prop": "title"}]. Columns left out are
    skipped. Returns (new schema, [(column index, property)]).
    """
    schema = json.loads(json.dumps(schema))
    by_id = {p["id"]: p for p in schema["properties"]}
    names = {p["name"].lower() for p in schema["properties"]}
    plan: list[tuple[int, dict | None]] = []
    used: set[str] = set()
    if not isinstance(mapping, list):
        raise SchemaError("The column mapping must be a list")
    for m in mapping:
        if not isinstance(m, dict):
            raise SchemaError("Each mapping entry must be an object")
        col = m.get("column")
        if not isinstance(col, int) or isinstance(col, bool) or not (0 <= col < len(header)):
            raise SchemaError("A mapping names a column the CSV does not have")
        if m.get("prop"):
            prop = by_id.get(m["prop"])
            if prop is None or prop["type"] in COMPUTED_TYPES:
                raise SchemaError("A mapping names a property that cannot be imported into")
        elif m.get("new_type"):
            ntype = m["new_type"]
            if ntype not in PROP_TYPES or ntype in COMPUTED_TYPES or ntype == "title":
                raise SchemaError(f"Cannot create a {str(ntype)[:20]} property from a column")
            name = _name(m.get("name") or header[col], "A property")
            base, n = name, 2
            while name.lower() in names:
                name = f"{base} {n}"[:MAX_NAME]
                n += 1
            prop = _property({"id": new_id("p"), "name": name, "type": ntype, "options": []})
            schema["properties"].append(prop)
            by_id[prop["id"]] = prop
            names.add(name.lower())
        else:
            continue
        if prop["id"] in used:
            raise SchemaError(f"Two columns are mapped to {prop['name']}")
        used.add(prop["id"])
        plan.append((col, prop))
    if len(schema["properties"]) > MAX_PROPS:
        raise SchemaError(f"A database takes at most {MAX_PROPS} properties")
    return schema, plan


def import_rows(schema: dict, body: list[list[str]], plan: list[tuple[int, dict]]) -> list[tuple[str, dict]]:
    """(title, props) for each CSV row. Select options named in the CSV that
    the property lacks are added to the schema (in place)."""
    for col, prop in plan:
        if prop["type"] in ("select", "multi_select"):
            add_options_for(prop, (_unformula(r[col]) for r in body if col < len(r)))
    out = []
    for r in body:
        title, props = "", {}
        for col, prop in plan:
            cell = _unformula(r[col].strip()) if col < len(r) else ""
            if prop["type"] == "title":
                title = cell[:500]
                continue
            v = lenient_value(prop, cell)
            if v is not None and v is not False:
                props[prop["id"]] = v
        out.append((title, props))
    return out


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _opts(*pairs: tuple[str, str]) -> list[dict]:
    return [{"id": f"o{i}", "name": n, "color": c} for i, (n, c) in enumerate(pairs, 1)]


def _iso_in(days: int) -> str:
    return (datetime.now(IST).date() + timedelta(days=days)).isoformat()


def _templates() -> dict[str, dict]:
    return {
        "blank": {
            "name": "Empty database", "icon": "🗃️",
            "description": "A table with a name column. Add the properties you need.",
            "schema": {
                "properties": [{"id": "title", "name": "Name", "type": "title"},
                               {"id": "notes", "name": "Notes", "type": "text"}],
                "views": [{"id": "v_table", "name": "Table", "type": "table"}],
            },
            "rows": [],
        },
        "crm": {
            "name": "Client CRM", "icon": "🤝",
            "description": "Leads and clients through the pipeline, with deal value and next follow-up.",
            "schema": {
                "properties": [
                    {"id": "title", "name": "Company", "type": "title"},
                    {"id": "stage", "name": "Stage", "type": "select", "options": _opts(
                        ("Lead", "gray"), ("Contacted", "blue"), ("Proposal", "yellow"),
                        ("Negotiation", "orange"), ("Won", "green"), ("Lost", "red"))},
                    {"id": "contact", "name": "Contact", "type": "text"},
                    {"id": "email", "name": "Email", "type": "url"},
                    {"id": "value", "name": "Deal value", "type": "number", "format": "inr"},
                    {"id": "owner", "name": "Owner", "type": "person"},
                    {"id": "followup", "name": "Next follow-up", "type": "date"},
                    {"id": "tags", "name": "Tags", "type": "multi_select", "options": _opts(
                        ("Retainer", "purple"), ("Project", "blue"), ("Referral", "green"))},
                ],
                "views": [
                    {"id": "v_pipe", "name": "Pipeline", "type": "board", "group_by": "stage",
                     "card_props": ["value", "followup"]},
                    {"id": "v_all", "name": "All clients", "type": "table",
                     "sort": [{"prop": "value", "dir": "desc"}]},
                    {"id": "v_cal", "name": "Follow-ups", "type": "calendar", "date_prop": "followup"},
                ],
            },
            "rows": [
                ("Asha Textiles", {"stage": "o3", "contact": "Asha Rao", "value": 240000, "followup": 2, "tags": ["o2"]}),
                ("Kaveri Foods", {"stage": "o1", "contact": "Vikram Iyer", "value": 90000, "followup": 5, "tags": ["o3"]}),
                ("Northwind Studio", {"stage": "o5", "contact": "Meera Shah", "value": 480000, "followup": 14, "tags": ["o1"]}),
            ],
        },
        "invoices": {
            "name": "Invoice tracker", "icon": "🧾",
            "description": "Invoices raised, amounts in rupees, due dates and what is still unpaid.",
            "schema": {
                "properties": [
                    {"id": "title", "name": "Invoice", "type": "title"},
                    {"id": "client", "name": "Client", "type": "text"},
                    {"id": "amount", "name": "Amount", "type": "number", "format": "inr"},
                    {"id": "gst", "name": "GST", "type": "number", "format": "percent"},
                    {"id": "status", "name": "Status", "type": "select", "options": _opts(
                        ("Draft", "gray"), ("Sent", "blue"), ("Overdue", "red"), ("Paid", "green"))},
                    {"id": "issued", "name": "Issued", "type": "date"},
                    {"id": "due", "name": "Due", "type": "date"},
                    {"id": "paid", "name": "Paid", "type": "checkbox"},
                ],
                "views": [
                    {"id": "v_all", "name": "All invoices", "type": "table",
                     "sort": [{"prop": "due", "dir": "asc"}]},
                    {"id": "v_unpaid", "name": "Unpaid", "type": "table",
                     "filter": {"op": "and", "rules": [{"prop": "paid", "cmp": "eq", "value": False}]}},
                    {"id": "v_status", "name": "By status", "type": "board", "group_by": "status",
                     "card_props": ["amount", "due"]},
                    {"id": "v_due", "name": "Due dates", "type": "calendar", "date_prop": "due"},
                ],
            },
            "rows": [
                ("INV-1041", {"client": "Asha Textiles", "amount": 118000, "gst": 18, "status": "o2", "issued": -10, "due": 5}),
                ("INV-1042", {"client": "Kaveri Foods", "amount": 59000, "gst": 18, "status": "o3", "issued": -40, "due": -10}),
                ("INV-1040", {"client": "Northwind Studio", "amount": 236000, "gst": 18, "status": "o4", "issued": -30, "due": -15, "paid": True}),
            ],
        },
        "projects": {
            "name": "Project tracker", "icon": "📐",
            "description": "Projects with status, priority, owner, budget and deadline.",
            "schema": {
                "properties": [
                    {"id": "title", "name": "Project", "type": "title"},
                    {"id": "status", "name": "Status", "type": "select", "options": _opts(
                        ("Not started", "gray"), ("In progress", "blue"), ("On hold", "yellow"), ("Done", "green"))},
                    {"id": "priority", "name": "Priority", "type": "select", "options": _opts(
                        ("Low", "gray"), ("Medium", "yellow"), ("High", "red"))},
                    {"id": "owner", "name": "Owner", "type": "person"},
                    {"id": "budget", "name": "Budget", "type": "number", "format": "inr"},
                    {"id": "progress", "name": "Progress", "type": "number", "format": "percent"},
                    {"id": "deadline", "name": "Deadline", "type": "date"},
                    {"id": "link", "name": "Brief", "type": "url"},
                ],
                "views": [
                    {"id": "v_board", "name": "Board", "type": "board", "group_by": "status",
                     "card_props": ["priority", "deadline"]},
                    {"id": "v_table", "name": "Table", "type": "table"},
                    {"id": "v_gallery", "name": "Gallery", "type": "gallery", "card_props": ["status", "owner"]},
                    {"id": "v_timeline", "name": "Deadlines", "type": "calendar", "date_prop": "deadline"},
                ],
            },
            "rows": [
                ("Website refresh", {"status": "o2", "priority": "o3", "budget": 350000, "progress": 40, "deadline": 21}),
                ("Q3 audit pack", {"status": "o1", "priority": "o2", "budget": 80000, "progress": 0, "deadline": 30}),
                ("Brand guidelines", {"status": "o4", "priority": "o1", "budget": 120000, "progress": 100, "deadline": -3}),
            ],
        },
        "content": {
            "name": "Content calendar", "icon": "🗓️",
            "description": "Posts and articles by channel, scheduled on a calendar.",
            "schema": {
                "properties": [
                    {"id": "title", "name": "Title", "type": "title"},
                    {"id": "publish", "name": "Publish date", "type": "date"},
                    {"id": "channel", "name": "Channel", "type": "multi_select", "options": _opts(
                        ("Blog", "blue"), ("LinkedIn", "purple"), ("Instagram", "pink"), ("Newsletter", "orange"))},
                    {"id": "status", "name": "Status", "type": "select", "options": _opts(
                        ("Idea", "gray"), ("Writing", "yellow"), ("Review", "orange"), ("Scheduled", "blue"), ("Published", "green"))},
                    {"id": "writer", "name": "Writer", "type": "person"},
                    {"id": "link", "name": "Link", "type": "url"},
                ],
                "views": [
                    {"id": "v_cal", "name": "Calendar", "type": "calendar", "date_prop": "publish",
                     "card_props": ["channel"]},
                    {"id": "v_board", "name": "Pipeline", "type": "board", "group_by": "status",
                     "card_props": ["channel", "publish"]},
                    {"id": "v_table", "name": "All posts", "type": "table",
                     "sort": [{"prop": "publish", "dir": "asc"}]},
                ],
            },
            "rows": [
                ("GST changes explained", {"publish": 3, "channel": ["o1", "o4"], "status": "o2"}),
                ("Year-end checklist", {"publish": 8, "channel": ["o2"], "status": "o4"}),
                ("Client story: Northwind", {"publish": 15, "channel": ["o1", "o3"], "status": "o1"}),
            ],
        },
        "tasks": {
            "name": "Task board", "icon": "✅",
            "description": "To do, doing, done — with assignees and due dates.",
            "schema": {
                "properties": [
                    {"id": "title", "name": "Task", "type": "title"},
                    {"id": "status", "name": "Status", "type": "select", "options": _opts(
                        ("To do", "gray"), ("Doing", "blue"), ("Done", "green"))},
                    {"id": "assignee", "name": "Assignee", "type": "person"},
                    {"id": "due", "name": "Due", "type": "date"},
                    {"id": "tags", "name": "Tags", "type": "multi_select", "options": _opts(
                        ("Finance", "green"), ("Ops", "blue"), ("Urgent", "red"))},
                    {"id": "created", "name": "Created", "type": "created_time"},
                ],
                "views": [
                    {"id": "v_board", "name": "Board", "type": "board", "group_by": "status",
                     "card_props": ["assignee", "due", "tags"]},
                    {"id": "v_table", "name": "List", "type": "table"},
                    {"id": "v_cal", "name": "Calendar", "type": "calendar", "date_prop": "due"},
                ],
            },
            "rows": [
                ("Reconcile October bank statement", {"status": "o2", "due": 1, "tags": ["o1"]}),
                ("File GSTR-1", {"status": "o1", "due": 4, "tags": ["o1", "o3"]}),
                ("Renew office lease", {"status": "o3", "due": -2, "tags": ["o2"]}),
            ],
        },
    }


TEMPLATE_KEYS = ("blank", "crm", "invoices", "projects", "content", "tasks")


def template_list() -> list[dict]:
    t = _templates()
    return [{"key": k, "name": t[k]["name"], "icon": t[k]["icon"], "description": t[k]["description"]}
            for k in TEMPLATE_KEYS]


def template(key: str) -> tuple[dict, list[tuple[str, dict]], str]:
    """(schema, sample rows as (title, props), icon). Date offsets in the
    samples become dates relative to today."""
    t = _templates().get(key)
    if t is None:
        raise SchemaError("Unknown template")
    schema = normalize_schema(t["schema"])
    dated = {p["id"] for p in schema["properties"] if p["type"] == "date"}
    rows = []
    for title, props in t["rows"]:
        rows.append((title, {k: (_iso_in(v) if k in dated else v) for k, v in props.items()}))
    return schema, rows, t["icon"]
