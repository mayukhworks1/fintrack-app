"""
Shared data for artifacts: the records behind window.fintrack.db.

An artifact is one HTML file in a sandboxed frame with an opaque origin. It
holds no session and its data cannot be trusted to it, so its data goes
through the app that frames it: the frame posts a request to its parent, the
parent calls the API (routers/artifact_data.py), and changes come back the
same way. This module is everything about the records that does not depend on
HTTP: names and sizes, the access settings, the SQL, and the wake-up for
clients waiting on a change.

Records
-------
A record is a JSON object in a named collection of one page. Collections are
created by use. Every insert, update and delete takes the next value of one
sequence (`seq`), and a delete leaves a tombstone, so "what changed since N"
is a range scan that includes deletes. Writes to one page hold an advisory
lock for their transaction, so the seq values of one page commit in order and
a reader that has seen N can never later find a smaller one appear.

Scope
-----
A record is shared (scope_owner = '') or private to one person (scope_owner
= "u:<user id>" for a signed-in user, "v:<visitor hash>" otherwise). Every
read filters on it: a private record is returned to the person it belongs to
and to the page's owner (in the moderation views), never to anyone else.

Keys
----
`ukey` is an optional key, unique among the live records of one collection and
scope. upsert() writes by key; db.doc(name) is the record keyed `name` in the
internal collection "_doc"; uploaded files are records in "_files".

Access (published_pages.metadata.data)
--------------------------------------
    access: "owner"       only the owner changes data; visitors read it
            "link_read"   anyone with the link reads; only the owner changes it
            "link_write"  anyone with the link adds, edits and deletes
    own_only: with link_write, people change and delete only what they added

The owner (the page's creator, or a superadmin) can always read, change and
delete everything.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import math
import random
import re
import time
from collections import deque
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from ..config import settings
from ..db import valkey as vk

logger = logging.getLogger("fintrack.artifact_data")

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------

MAX_RECORDS_PER_PAGE = 5_000
MAX_RECORD_BYTES = 16 * 1024
MAX_COLLECTIONS = 20
MAX_FILES_PER_PAGE = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_DEPTH = 12
MAX_WHERE_FIELDS = 8
DEFAULT_LIST_LIMIT = 500
MAX_LIST_LIMIT = 1_000
MAX_CHANGES = 500
MAX_WAIT_S = 25.0
# A long-poll wakes at once for a write made by this process; this is how
# often it also looks at the database, for a write made by another worker.
POLL_INTERVAL_S = 2.0
TOMBSTONE_RETENTION_DAYS = 30
MAX_INCREMENT = 1e12

# Writes per minute: one person on one page, and one address across pages.
VISITOR_WRITES_PER_MIN = 60
IP_WRITES_PER_MIN = 240
FILE_UPLOADS_PER_MIN = 10

COLLECTION_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
KEY_RE = re.compile(r"^[^\x00-\x1f]{1,120}$")
# Path words the routes use beside collection names.
RESERVED = frozenset({"changes", "settings", "export", "stream", "me", "summary", "doc", "files",
                      "count", "query", "upsert"})
VISITOR_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

DOC_COLLECTION = "_doc"
FILES_COLLECTION = "_files"

SCOPES = ("shared", "private")
ACCESS_LEVELS = ("owner", "link_read", "link_write")
DEFAULT_SETTINGS = {"access": "link_write", "own_only": False}

# Images and PDFs only, recognised by their first bytes, never by what the
# client says they are. SVG is left out on purpose: it can carry script.
FILE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
    (b"%PDF-", "application/pdf", "pdf"),
)

NOT_READY_DETAIL = "Shared data is not available yet. The database is being updated; try again in a minute."

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def collection_name(name: str) -> str:
    if not isinstance(name, str) or not COLLECTION_RE.match(name) or name.lower() in RESERVED:
        raise HTTPException(
            422,
            "Collection names start with a letter and use only letters, digits, - and _ "
            "(at most 40 characters).",
        )
    return name


def doc_name(name: str) -> str:
    if not isinstance(name, str) or not COLLECTION_RE.match(name):
        raise HTTPException(422, "Document names start with a letter and use only letters, digits, - and _.")
    return name


def scope_of(value: Any) -> str:
    if value in (None, ""):
        return "shared"
    if value not in SCOPES:
        raise HTTPException(422, "scope must be \"shared\" or \"private\"")
    return value


def record_key(value: Any) -> str:
    if not isinstance(value, str) or not KEY_RE.match(value):
        raise HTTPException(422, "A key is text of 1 to 120 characters.")
    return value


def field_name(value: Any) -> str:
    if not isinstance(value, str) or not FIELD_RE.match(value):
        raise HTTPException(422, "Field names use letters, digits and _ and do not start with a digit.")
    return value


def visitor_hash(raw: str | None) -> str | None:
    """The stored form of an anonymous visitor id (a keyed hash; the raw id
    never reaches the database), or None when none or a malformed one is sent."""
    if not raw or not VISITOR_RE.match(raw):
        return None
    return hmac.new(settings.app_secret.encode(), f"visitor:{raw}".encode(), hashlib.sha256).hexdigest()[:40]


def handle(page_id: str, who: str) -> str:
    """An opaque id for "me" on one page: stable, different on every page, and
    useless for acting as that person."""
    return hmac.new(settings.app_secret.encode(), f"me:{page_id}:{who}".encode(), hashlib.sha256).hexdigest()[:12]


def _depth(value: Any, level: int = 0) -> int:
    if level > MAX_DEPTH:
        return level
    if isinstance(value, dict):
        return max([_depth(v, level + 1) for v in value.values()] or [level + 1])
    if isinstance(value, list):
        return max([_depth(v, level + 1) for v in value] or [level + 1])
    return level


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def encode(data: Any) -> str:
    """A record's data as stored: a JSON object within the size and depth caps."""
    if not isinstance(data, dict):
        raise HTTPException(422, "A record must be a JSON object, like {\"title\": \"Buy milk\"}.")
    if _depth(data) > MAX_DEPTH:
        raise HTTPException(422, "This record is nested too deeply.")
    try:
        text = _dumps(data)
    except (TypeError, ValueError):
        raise HTTPException(422, "A record may hold only text, numbers, true/false, null, lists and objects.")
    if "\\u0000" in text or "\x00" in text:
        raise HTTPException(422, "A record cannot contain a NUL character.")
    if len(text.encode("utf-8")) > MAX_RECORD_BYTES:
        raise HTTPException(413, f"This record is too large: the limit is {MAX_RECORD_BYTES // 1024} KB.")
    return text


def parse_body(raw: bytes) -> dict:
    """A request body: JSON, an object, and not much larger than one record."""
    if len(raw) > MAX_RECORD_BYTES * 2 + 1024:
        raise HTTPException(413, f"This record is too large: the limit is {MAX_RECORD_BYTES // 1024} KB.")
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        raise HTTPException(422, "The request body must be JSON.")
    if not isinstance(body, dict):
        raise HTTPException(422, "The request body must be a JSON object.")
    return body


def parse_where(raw: Any) -> dict | None:
    """`where` as a JSON object of field -> value (equality), from a query
    string or a body. Values may be any JSON; matching is containment."""
    if raw in (None, "", {}):
        return None
    if isinstance(raw, str):
        if len(raw) > 4096:
            raise HTTPException(422, "where is too long")
        try:
            raw = json.loads(raw)
        except ValueError:
            raise HTTPException(422, "where must be a JSON object")
    if not isinstance(raw, dict):
        raise HTTPException(422, "where must be a JSON object")
    if len(raw) > MAX_WHERE_FIELDS:
        raise HTTPException(422, f"where takes at most {MAX_WHERE_FIELDS} fields")
    for k in raw:
        field_name(k)
    encode(raw)
    return raw


def parse_order(order_by: Any, desc: Any) -> tuple[str | None, bool]:
    if order_by in (None, ""):
        return None, bool(desc in (True, "1", "true"))
    if order_by not in ("created_at", "updated_at"):
        field_name(order_by)
    return order_by, desc in (True, "1", "true")


def file_kind(data: bytes) -> tuple[str, str]:
    for sig, mime, ext in FILE_SIGNATURES:
        if data.startswith(sig):
            return mime, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    raise HTTPException(415, "Only images (PNG, JPEG, GIF, WebP) and PDFs can be uploaded.")


def settings_of(metadata: Any) -> dict:
    meta = metadata
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = {}
    raw = (meta or {}).get("data") if isinstance(meta, dict) else None
    out = dict(DEFAULT_SETTINGS)
    if isinstance(raw, dict):
        if raw.get("access") in ACCESS_LEVELS:
            out["access"] = raw["access"]
        if isinstance(raw.get("own_only"), bool):
            out["own_only"] = raw["own_only"]
    return out


def validate_settings(body: dict) -> dict:
    access = body.get("access")
    if access not in ACCESS_LEVELS:
        raise HTTPException(422, "access must be one of: " + ", ".join(ACCESS_LEVELS))
    own_only = body.get("own_only", False)
    if not isinstance(own_only, bool):
        raise HTTPException(422, "own_only must be true or false")
    return {"access": access, "own_only": own_only}


def finite_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise HTTPException(422, "Expected a number.")
    if not math.isfinite(n) or n < 0:
        raise HTTPException(422, "Expected a whole number of zero or more.")
    return int(n)


# ---------------------------------------------------------------------------
# Who may do what
# ---------------------------------------------------------------------------


class Actor:
    """Who is asking: the page's owner, a signed-in user, or a visitor."""

    def __init__(self, *, page_id: str, is_owner: bool, user_id: str | None, visitor: str | None):
        self.page_id = page_id
        self.is_owner = is_owner
        self.user_id = str(user_id) if user_id else None
        self.visitor = visitor

    @property
    def identity(self) -> str | None:
        """Whose private records are "mine"."""
        if self.user_id:
            return f"u:{self.user_id}"
        return f"v:{self.visitor}" if self.visitor else None

    def private_owner(self) -> str:
        if not self.identity:
            raise HTTPException(400, "Private data needs a visitor id. Reload the page and try again.")
        return self.identity

    def owns(self, row) -> bool:
        if self.user_id and row["created_by_user"] is not None and str(row["created_by_user"]) == self.user_id:
            return True
        return bool(self.visitor and row["created_by_visitor"] == self.visitor)

    def can_add(self, conf: dict) -> bool:
        return self.is_owner or conf["access"] == "link_write"

    def can_change(self, conf: dict, row) -> bool:
        if self.is_owner:
            return True
        if conf["access"] != "link_write":
            return False
        if row["scope_owner"]:
            return row["scope_owner"] == self.identity
        return self.owns(row) if conf["own_only"] else True

    def me(self, conf: dict) -> dict:
        who = self.identity or "anon"
        return {
            "id": handle(self.page_id, who),
            "isOwner": self.is_owner,
            "canAdd": self.can_add(conf),
            "canEditOthers": self.is_owner or (conf["access"] == "link_write" and not conf["own_only"]),
            "signedIn": bool(self.user_id),
        }


def forbidden(conf: dict) -> HTTPException:
    if conf["access"] != "link_write":
        return HTTPException(403, "Only the owner can change the data in this artifact.")
    return HTTPException(403, "You can only change what you added.")


# ---------------------------------------------------------------------------
# Rate limits
# ---------------------------------------------------------------------------

_local_hits: dict[str, deque] = {}


def _local_allow(key: str, limit: int, window: float) -> bool:
    """The in-process limiter, for a deployment without Valkey."""
    now = time.monotonic()
    q = _local_hits.setdefault(key, deque())
    while q and q[0] <= now - window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    if len(_local_hits) > 20_000:  # forget idle keys rather than grow forever
        for k in [k for k, v in _local_hits.items() if not v or v[-1] <= now - window][:5_000]:
            _local_hits.pop(k, None)
    return True


def reset_rate_limits() -> None:
    _local_hits.clear()


async def allow(key: str, limit: int, window: int = 60) -> bool:
    if vk._client is not None:
        ok, _ = await vk.rate_check(key, limit=limit, window_sec=window, bucket="artdata")
        return ok
    return _local_allow(key, limit, window)


async def check_write_rate(page_id: str, who: str, ip: str, *, files: bool = False) -> None:
    if files and not await allow(f"f:{page_id}:{who}", FILE_UPLOADS_PER_MIN):
        raise HTTPException(429, "Too many uploads in a short time. Wait a moment and try again.",
                            headers={"Retry-After": "30"})
    if not await allow(f"w:{page_id}:{who}", VISITOR_WRITES_PER_MIN):
        raise HTTPException(429, "Too many changes in a short time. Wait a moment and try again.",
                            headers={"Retry-After": "20"})
    if ip and not await allow(f"ip:{ip}", IP_WRITES_PER_MIN):
        raise HTTPException(429, "Too many changes from this network. Wait a moment and try again.",
                            headers={"Retry-After": "30"})


# ---------------------------------------------------------------------------
# Readiness (migration 0007)
# ---------------------------------------------------------------------------

_ready: bool | None = None
_ready_checked_at = 0.0
_RETRY_S = 30.0


def reset_ready_cache() -> None:
    global _ready, _ready_checked_at
    _ready, _ready_checked_at = None, 0.0


async def ready(conn) -> bool:
    global _ready, _ready_checked_at
    if _ready:
        return True
    if _ready is False and time.monotonic() - _ready_checked_at < _RETRY_S:
        return False
    try:
        ok = bool(await conn.fetchval("SELECT to_regclass('artifact_records') IS NOT NULL"))
    except Exception as exc:
        logger.debug("artifact_records readiness check failed: %s", exc)
        ok = False
    _ready, _ready_checked_at = ok, time.monotonic()
    return ok


async def require_ready(conn) -> None:
    if not await ready(conn):
        raise HTTPException(503, NOT_READY_DETAIL)


# ---------------------------------------------------------------------------
# Change notification
# ---------------------------------------------------------------------------

_waiters: dict[str, set[asyncio.Future]] = {}


def notify(page_id: str) -> None:
    """Wake every request in this process waiting on this page (a data
    change, or the page itself republished)."""
    for fut in _waiters.pop(str(page_id), set()):
        if not fut.done():
            fut.set_result(True)


async def _sleep_until_change(page_id: str, timeout: float) -> None:
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    _waiters.setdefault(str(page_id), set()).add(fut)
    try:
        await asyncio.wait_for(fut, timeout)
    except asyncio.TimeoutError:
        pass
    finally:
        group = _waiters.get(str(page_id))
        if group is not None:
            group.discard(fut)
            if not group:
                _waiters.pop(str(page_id), None)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

_COLS = ("id, collection, data, created_at, updated_at, created_by_user, created_by_visitor, "
         "version, seq, deleted_at, scope_owner, ukey")
_RCOLS = ", ".join("r." + c.strip() for c in _COLS.split(","))


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, datetime) else (str(v) if v is not None else None)


def record_dict(row, actor: Actor, with_author: bool = False) -> dict:
    data = row["data"]
    if isinstance(data, str):
        data = json.loads(data)
    d = {
        "id": str(row["id"]),
        "collection": row["collection"],
        "data": data if row["deleted_at"] is None else None,
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
        "version": row["version"],
        "seq": row["seq"],
        "scope": "private" if row["scope_owner"] else "shared",
        "mine": actor.owns(row),
    }
    if row["ukey"] is not None:
        d["key"] = row["ukey"]
    if row["deleted_at"] is not None:
        d["deleted"] = True
    if with_author:
        name = row["author_name"] if "author_name" in row.keys() else None
        if row["created_by_user"] is not None:
            d["author"] = name or "Signed-in user"
        elif row["created_by_visitor"]:
            d["author"] = "Visitor " + row["created_by_visitor"][:6]
        else:
            d["author"] = "Unknown"
    return d


class _Sql:
    """A WHERE clause built with numbered parameters (values never inlined)."""

    def __init__(self, *args):
        self.args = list(args)
        self.parts: list[str] = []

    def arg(self, value) -> str:
        self.args.append(value)
        return f"${len(self.args)}"

    def add(self, clause: str) -> None:
        self.parts.append(clause)

    @property
    def where(self) -> str:
        return " AND ".join(self.parts)


def _visibility(q: _Sql, actor: Actor, scope: str) -> None:
    """Restrict a query to the records this actor may see in this scope.
    scope "all" (both, everyone's) is the owner's moderation view only."""
    if scope == "all":
        if not actor.is_owner:
            raise HTTPException(403, "Only the owner can see everyone's data.")
        return
    if scope == "private":
        me = actor.identity
        if not me:
            q.add("FALSE")
            return
        q.add(f"r.scope_owner = {q.arg(me)}")
        return
    if scope == "visible":  # the change feed: shared, plus my own private records
        me = actor.identity
        q.add(f"(r.scope_owner = '' OR r.scope_owner = {q.arg(me)})" if me else "r.scope_owner = ''")
        return
    q.add("r.scope_owner = ''")


def _order(q: _Sql, order_by: str | None, desc: bool) -> str:
    direction = "DESC" if desc else "ASC"
    if order_by is None:
        return f"r.created_at {direction}, r.seq {direction}"
    if order_by in ("created_at", "updated_at"):
        return f"r.{order_by} {direction}, r.seq {direction}"
    # jsonb ordering: numbers numerically, text as text; a missing field last.
    return f"r.data -> {q.arg(order_by)} {direction} NULLS LAST, r.seq {direction}"


async def cursor_of(conn, page_id: str) -> int:
    return int(await conn.fetchval(
        "SELECT COALESCE(MAX(seq), 0) FROM artifact_records WHERE page_id = $1", page_id) or 0)


async def list_records(conn, page_id: str, collection: str, actor: Actor, *, scope: str = "shared",
                       since: int | None = None, limit: int | None = None, where: dict | None = None,
                       order_by: str | None = None, desc: bool = False, with_author: bool = False) -> dict:
    limit = max(1, min(int(limit or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT))
    q = _Sql(page_id, collection)
    q.add("r.page_id = $1")
    q.add("r.collection = $2")
    _visibility(q, actor, scope)
    if where:
        q.add(f"r.data @> {q.arg(_dumps(where))}::jsonb")
    if since is not None:
        q.add(f"r.seq > {q.arg(int(since))}")
        order = "r.seq"
    else:
        q.add("r.deleted_at IS NULL")
        order = _order(q, order_by, desc)
    author = ", u.full_name AS author_name" if with_author else ""
    join = " LEFT JOIN auth_users u ON u.id = r.created_by_user" if with_author else ""
    lim = q.arg(limit + 1)
    async with conn.transaction(isolation="repeatable_read", readonly=True):
        rows = await conn.fetch(
            f"SELECT {_RCOLS}{author} FROM artifact_records r{join} WHERE {q.where} ORDER BY {order} LIMIT {lim}",
            *q.args)
        cursor = await cursor_of(conn, page_id)
    has_more = len(rows) > limit
    rows = rows[:limit]
    if since is not None and has_more:
        cursor = rows[-1]["seq"]
    return {"records": [record_dict(r, actor, with_author) for r in rows], "cursor": cursor, "has_more": has_more}


async def count_records(conn, page_id: str, collection: str, actor: Actor, *, scope: str = "shared",
                        where: dict | None = None) -> int:
    q = _Sql(page_id, collection)
    q.add("r.page_id = $1")
    q.add("r.collection = $2")
    q.add("r.deleted_at IS NULL")
    _visibility(q, actor, scope)
    if where:
        q.add(f"r.data @> {q.arg(_dumps(where))}::jsonb")
    return int(await conn.fetchval(f"SELECT COUNT(*) FROM artifact_records r WHERE {q.where}", *q.args))


async def get_record(conn, page_id: str, collection: str, actor: Actor, *, record_id: str | None = None,
                     key: str | None = None, scope: str = "shared") -> dict | None:
    q = _Sql(page_id, collection)
    q.add("r.page_id = $1")
    q.add("r.collection = $2")
    q.add("r.deleted_at IS NULL")
    if record_id is not None:
        q.add(f"r.id = {q.arg(record_id)}")
        # By id, a record is visible in either scope it may be seen in.
        _visibility(q, actor, "all" if actor.is_owner else "visible")
    else:
        q.add(f"r.ukey = {q.arg(key)}")
        _visibility(q, actor, scope)
    row = await conn.fetchrow(f"SELECT {_RCOLS} FROM artifact_records r WHERE {q.where} LIMIT 1", *q.args)
    return record_dict(row, actor) if row else None


async def changes(conn, page_id: str, actor: Actor, since: int, *, scope: str = "visible",
                  limit: int = MAX_CHANGES) -> dict:
    limit = max(1, min(int(limit or MAX_CHANGES), MAX_CHANGES))
    q = _Sql(page_id, int(since))
    q.add("r.page_id = $1")
    q.add("r.seq > $2")
    _visibility(q, actor, scope)
    lim = q.arg(limit + 1)
    async with conn.transaction(isolation="repeatable_read", readonly=True):
        rows = await conn.fetch(
            f"SELECT {_RCOLS} FROM artifact_records r WHERE {q.where} ORDER BY r.seq LIMIT {lim}", *q.args)
        latest = await cursor_of(conn, page_id)
    has_more = len(rows) > limit
    rows = rows[:limit]
    # Without more to come, every record up to `latest` was looked at in this
    # snapshot (some were not this reader's to see), so the cursor moves there.
    cursor = rows[-1]["seq"] if has_more else max(latest, rows[-1]["seq"] if rows else 0, int(since))
    out = {"changes": [record_dict(r, actor) for r in rows], "cursor": cursor, "has_more": has_more}
    # A cursor from the future (a restored database, another page's cursor):
    # the client's copy cannot be trusted, so it starts over from a full list.
    if since > latest:
        out["reset"] = True
        out["cursor"] = latest
    return out


async def wait_for_changes(pool, page_id: str, actor: Actor, since: int, wait: float, *,
                           rev_sql: str, known_rev: str | None, scope: str = "visible") -> dict:
    """Changes after `since`, waiting up to `wait` seconds for the first one,
    or for the page itself to be republished (its rev to change). No
    connection is held while waiting. `rev_sql` is a trusted expression over
    published_pages chosen by the router."""
    wait = max(0.0, min(float(wait or 0), MAX_WAIT_S))
    deadline = time.monotonic() + wait
    probe = (f"SELECT (SELECT COALESCE(MAX(seq), 0) FROM artifact_records WHERE page_id = $1) AS latest, "
             f"(SELECT {rev_sql} FROM published_pages WHERE id = $1) AS rev")
    while True:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(probe, page_id)
            rev = _iso(row["rev"]) if row else None
            latest = int(row["latest"]) if row else 0
            left = deadline - time.monotonic()
            moved = latest != since or (known_rev is not None and rev != known_rev)
            if moved or left <= 0:
                res = await changes(conn, page_id, actor, since, scope=scope)
                if res["changes"] or res.get("reset") or left <= 0 or (known_rev is not None and rev != known_rev):
                    res["rev"] = rev
                    return res
                since = res["cursor"]  # only others' private changes: keep waiting from here
        await _sleep_until_change(page_id, min(max(left, 0.05), POLL_INTERVAL_S))


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


async def _lock(conn, page_id: str) -> None:
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 7007))", str(page_id))


async def _check_caps(conn, page_id: str, collection: str) -> None:
    row = await conn.fetchrow(
        "SELECT COUNT(*) AS total, "
        "COUNT(DISTINCT collection) FILTER (WHERE collection NOT LIKE '\\_%') AS colls, "
        "COALESCE(BOOL_OR(collection = $2), FALSE) AS has, "
        "COUNT(*) FILTER (WHERE collection = $3) AS files "
        "FROM artifact_records WHERE page_id = $1 AND deleted_at IS NULL",
        page_id, collection, FILES_COLLECTION)
    if int(row["total"]) >= MAX_RECORDS_PER_PAGE:
        raise HTTPException(409, f"This artifact is full: it holds at most {MAX_RECORDS_PER_PAGE:,} records.")
    if not collection.startswith("_") and not row["has"] and int(row["colls"]) >= MAX_COLLECTIONS:
        raise HTTPException(409, f"This artifact already uses {MAX_COLLECTIONS} collections, the most it can have.")
    if collection == FILES_COLLECTION and int(row["files"]) >= MAX_FILES_PER_PAGE:
        raise HTTPException(409, f"This artifact already holds {MAX_FILES_PER_PAGE} files, the most it can have.")


async def _insert(conn, page_id, collection, text, actor: Actor, scope_owner: str, key: str | None):
    return await conn.fetchrow(
        f"INSERT INTO artifact_records (page_id, collection, data, created_by_user, created_by_visitor, "
        f"scope_owner, ukey) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING {_COLS}",
        page_id, collection, text, actor.user_id, actor.visitor, scope_owner, key)


async def _write(conn, record_id, text):
    return await conn.fetchrow(
        f"UPDATE artifact_records SET data = $2::jsonb, version = version + 1, updated_at = NOW(), "
        f"seq = nextval('artifact_records_seq') WHERE id = $1 RETURNING {_COLS}",
        record_id, text)


def _owner_for(actor: Actor, scope: str) -> str:
    return actor.private_owner() if scope == "private" else ""


def _data(row) -> dict:
    data = row["data"]
    return json.loads(data) if isinstance(data, str) else dict(data)


async def add_record(conn, page_id: str, collection: str, data: dict, actor: Actor, conf: dict, *,
                     scope: str = "shared") -> dict:
    if not actor.can_add(conf):
        raise forbidden(conf)
    text = encode(data)
    owner = _owner_for(actor, scope)
    async with conn.transaction():
        await _lock(conn, page_id)
        await _check_caps(conn, page_id, collection)
        row = await _insert(conn, page_id, collection, text, actor, owner, None)
    return record_dict(row, actor)


async def _locked_row(conn, page_id: str, collection: str, actor: Actor, *, record_id: str | None = None,
                      key: str | None = None, scope: str = "shared", missing_ok: bool = False):
    if record_id is not None:
        row = await conn.fetchrow(
            f"SELECT {_COLS} FROM artifact_records "
            "WHERE id = $1 AND page_id = $2 AND collection = $3 AND deleted_at IS NULL FOR UPDATE",
            record_id, page_id, collection)
        # Someone else's private record does not exist, as far as this actor knows.
        if row and row["scope_owner"] and not actor.is_owner and row["scope_owner"] != actor.identity:
            row = None
    else:
        row = await conn.fetchrow(
            f"SELECT {_COLS} FROM artifact_records "
            "WHERE page_id = $1 AND collection = $2 AND scope_owner = $3 AND ukey = $4 AND deleted_at IS NULL "
            "FOR UPDATE",
            page_id, collection, _owner_for(actor, scope), key)
    if not row and not missing_ok:
        raise HTTPException(404, "That record does not exist (it may have been deleted).")
    return row


async def update_record(conn, page_id: str, collection: str, record_id: str, patch: dict, actor: Actor,
                        conf: dict, *, if_version: int | None = None, replace: bool = False) -> dict:
    """Field-level merge (or a replacement): fields not in the patch keep the
    value they have now, whoever wrote it last. With if_version the write
    happens only on that version (409 otherwise)."""
    if not isinstance(patch, dict):
        raise HTTPException(422, "A change must be a JSON object of the fields to set.")
    async with conn.transaction():
        await _lock(conn, page_id)
        row = await _locked_row(conn, page_id, collection, actor, record_id=record_id)
        if not actor.can_change(conf, row):
            raise forbidden(conf)
        if if_version is not None and int(if_version) != row["version"]:
            raise HTTPException(409, "This record was changed by someone else. Reload and try again.")
        text = encode(dict(patch) if replace else {**_data(row), **patch})
        row = await _write(conn, record_id, text)
    return record_dict(row, actor)


async def upsert_record(conn, page_id: str, collection: str, key: str, data: dict, actor: Actor, conf: dict, *,
                        scope: str = "shared", replace: bool = False, if_version: int | None = None) -> dict:
    """Write the record with this key: merge into it (or replace it) when it
    exists, create it when it does not. Safe against two people at once: the
    page lock serialises them, and the unique index backs it up."""
    if not isinstance(data, dict):
        raise HTTPException(422, "A record must be a JSON object.")
    async with conn.transaction():
        await _lock(conn, page_id)
        row = await _locked_row(conn, page_id, collection, actor, key=key, scope=scope, missing_ok=True)
        if row is None:
            if not actor.can_add(conf):
                raise forbidden(conf)
            if if_version not in (None, 0):
                raise HTTPException(409, "This record was changed by someone else. Reload and try again.")
            text = encode(data)
            await _check_caps(conn, page_id, collection)
            row = await _insert(conn, page_id, collection, text, actor, _owner_for(actor, scope), key)
        else:
            if not actor.can_change(conf, row):
                raise forbidden(conf)
            if if_version is not None and int(if_version) != row["version"]:
                raise HTTPException(409, "This record was changed by someone else. Reload and try again.")
            row = await _write(conn, row["id"], encode(dict(data) if replace else {**_data(row), **data}))
    return record_dict(row, actor)


async def increment(conn, page_id: str, collection: str, actor: Actor, conf: dict, field: str, by: float, *,
                    record_id: str | None = None, key: str | None = None, scope: str = "shared") -> dict:
    """Add `by` to a numeric field atomically (a missing field counts as 0).
    By key, a missing record is created holding just that field."""
    field_name(field)
    if isinstance(by, bool) or not isinstance(by, (int, float)) or not math.isfinite(by) or abs(by) > MAX_INCREMENT:
        raise HTTPException(422, "by must be a number")
    async with conn.transaction():
        await _lock(conn, page_id)
        row = await _locked_row(conn, page_id, collection, actor, record_id=record_id, key=key, scope=scope,
                                missing_ok=key is not None)
        if row is None:
            if not actor.can_add(conf):
                raise forbidden(conf)
            await _check_caps(conn, page_id, collection)
            row = await _insert(conn, page_id, collection, encode({field: by}), actor, _owner_for(actor, scope), key)
            return record_dict(row, actor)
        if not actor.can_change(conf, row):
            raise forbidden(conf)
        data = _data(row)
        current = data.get(field, 0)
        if current is None:
            current = 0
        if isinstance(current, bool) or not isinstance(current, (int, float)):
            raise HTTPException(409, f"\"{field}\" is not a number, so it cannot be incremented.")
        total = current + by
        if isinstance(total, float) and total.is_integer() and abs(total) < 2 ** 53:
            total = int(total)
        data[field] = total
        row = await _write(conn, row["id"], encode(data))
    return record_dict(row, actor)


async def delete_record(conn, page_id: str, collection: str, actor: Actor, conf: dict, *,
                        record_id: str | None = None, key: str | None = None, scope: str = "shared") -> dict:
    async with conn.transaction():
        await _lock(conn, page_id)
        row = await _locked_row(conn, page_id, collection, actor, record_id=record_id, key=key, scope=scope)
        if not actor.can_change(conf, row):
            raise forbidden(conf)
        before = _data(row)
        row = await conn.fetchrow(
            f"UPDATE artifact_records SET deleted_at = NOW(), updated_at = NOW(), data = '{{}}'::jsonb, "
            f"version = version + 1, seq = nextval('artifact_records_seq') WHERE id = $1 RETURNING {_COLS}",
            row["id"])
    await maybe_purge(conn)
    out = record_dict(row, actor)
    out["_before"] = before  # for the router (a file's stored path); never sent
    return out


async def clear_collection(conn, page_id: str, collection: str) -> list[dict]:
    """Delete every live record of a collection (owner only). Returns the
    data the records held, so the router can remove uploaded files."""
    async with conn.transaction():
        await _lock(conn, page_id)
        rows = await conn.fetch(
            "SELECT data FROM artifact_records WHERE page_id = $1 AND collection = $2 AND deleted_at IS NULL",
            page_id, collection)
        await conn.execute(
            "UPDATE artifact_records SET deleted_at = NOW(), updated_at = NOW(), data = '{}'::jsonb, "
            "version = version + 1, seq = nextval('artifact_records_seq') "
            "WHERE page_id = $1 AND collection = $2 AND deleted_at IS NULL",
            page_id, collection)
    await maybe_purge(conn)
    return [_data(r) for r in rows]


async def summary(conn, page_id: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT collection, COUNT(*) AS count, COUNT(*) FILTER (WHERE scope_owner <> '') AS private, "
        "MAX(updated_at) AS updated_at FROM artifact_records "
        "WHERE page_id = $1 AND deleted_at IS NULL GROUP BY collection ORDER BY collection",
        page_id)
    return [{"name": r["collection"], "count": int(r["count"]), "private": int(r["private"]),
             "updated_at": _iso(r["updated_at"])} for r in rows]


async def export_rows(conn, page_id: str, collection: str | None) -> list:
    cond, args = ("AND r.collection = $2", [page_id, collection]) if collection else ("", [page_id])
    return await conn.fetch(
        f"SELECT {_RCOLS}, u.full_name AS author_name "
        "FROM artifact_records r LEFT JOIN auth_users u ON u.id = r.created_by_user "
        f"WHERE r.page_id = $1 AND r.deleted_at IS NULL {cond} ORDER BY r.collection, r.created_at, r.seq "
        f"LIMIT {MAX_RECORDS_PER_PAGE}",
        *args)


async def maybe_purge(conn, chance: float = 0.02) -> None:
    """Now and then, drop tombstones older than the retention window."""
    if random.random() >= chance:
        return
    try:
        await conn.execute(
            "DELETE FROM artifact_records WHERE deleted_at IS NOT NULL "
            f"AND deleted_at < NOW() - INTERVAL '{int(TOMBSTONE_RETENTION_DAYS)} days'")
    except Exception as exc:
        logger.debug("artifact tombstone purge failed: %s", exc)
