"""
Live co-editing for block documents (content_type "doc").

One room per page, held in this process's memory. The room owns a Yjs
document (pycrdt) whose XmlFragment "default" is what the editor's
Collaboration extension binds to. The page's `content` column — the editor's
TipTap JSON — stays the source of truth on disk:

  * a room is seeded from the page's JSON when the first editor connects
    (server-side conversion, the same shape @tiptap/y-tiptap writes), so two
    editors opening an empty room at once can never both seed it;
  * the room writes TipTap JSON back ~3 s after the last change (and at
    least every 20 s during continuous typing), when the last editor leaves,
    when an idle room is evicted and at shutdown;
  * versions are written on the existing cadence (`_snapshot_version`, at
    most one per five minutes), plus an unthrottled one whenever the stored
    JSON changed underneath the room, so nothing written elsewhere is lost.

Why no table for Yjs updates: every other writer (the REST editor, AI
generation, version restore, conversions) writes JSON, so a stored update
log would have to be rebuilt from JSON after each of them anyway. Instead
each room carries an `epoch`; a client reconnecting to a different epoch
knows the server's document was rebuilt and re-syncs from scratch rather than
merging (which would duplicate content). See `before_external_write` for how
REST writes and live rooms keep out of each other's way.

Wire protocol (y-websocket compatible binary frames, plus small JSON text
frames for control):
  client -> {"type":"auth","token":...}   first frame, within AUTH_TIMEOUT_S
  server -> {"type":"welcome","epoch":...,"user":{name,color},...}
  binary    [0, ...] sync (step1 / step2 / update), [1, ...] awareness,
            [3] query awareness
  client -> {"type":"ping"}  server -> {"type":"pong"}
  server -> {"type":"saved","at":...} after each write to the page
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Protocol

from pycrdt import Decoder, Doc, XmlElement, XmlFragment, XmlText, create_sync_message, create_update_message, handle_sync_message, write_var_uint

from . import page_doc

logger = logging.getLogger("fintrack.collab")

FRAGMENT = "default"

MSG_SYNC = 0
MSG_AWARENESS = 1
MSG_QUERY_AWARENESS = 3
SYNC_STEP1 = 0
SYNC_STEP2 = 1
SYNC_UPDATE = 2

# Close codes the client understands (4xxx are application codes).
CLOSE_BAD_REQUEST = 4400
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_TIMEOUT = 4408
CLOSE_RESET = 4409          # the page was rewritten outside the room; reconnect
CLOSE_TOO_LARGE = 4413
CLOSE_FULL = 4429
CLOSE_GOING_AWAY = 1001
CLOSE_MESSAGE_TOO_BIG = 1009


@dataclass
class Limits:
    max_clients_per_room: int = 16
    max_rooms: int = 200
    max_message_bytes: int = 1 << 20          # one inbound frame
    max_doc_bytes: int = 8 << 20              # encoded Yjs state of one room
    max_content_chars: int = 5_000_000        # same cap as the REST editor
    max_awareness_bytes: int = 8 << 10
    persist_debounce_s: float = 3.0
    persist_max_wait_s: float = 20.0
    room_idle_s: float = 120.0                # empty room kept for quick reconnects
    client_timeout_s: float = 60.0            # no frame (pings included) for this long
    auth_timeout_s: float = 10.0
    reauth_s: float = 300.0
    reap_interval_s: float = 10.0
    send_queue: int = 512


limits = Limits()

PALETTE = ["#2383e2", "#d9730d", "#0f7b6c", "#9065b0", "#e03e3e", "#c14c8a", "#64473a", "#dfab01", "#4d6461", "#337ea9"]


def user_color(seed: str) -> str:
    h = hashlib.sha256((seed or "").encode()).digest()
    return PALETTE[h[0] % len(PALETTE)]


# ---------------------------------------------------------------------------
# TipTap JSON <-> Y.XmlFragment, mirroring @tiptap/y-tiptap
# ---------------------------------------------------------------------------
#
# y-tiptap stores each node as an XmlElement named after its type with its
# non-null attrs as attributes, and each run of adjacent text nodes as one
# XmlText whose formatting attributes are {markType: markAttrs}. Marks of a
# type that does not exclude itself get a "--<hash>" suffix there; reading
# strips it. Numbers come back from Yjs as floats and are made ints again.

def _norm(v: Any) -> Any:
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        return int(v)
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_norm(x) for x in v]
    return v


def _mark_name(attr: str) -> str:
    base, sep, tail = attr.rpartition("--")
    if sep and base and len(tail) == 8 and all(c.isalnum() or c in "+/=" for c in tail):
        return base
    return attr


def _marks_to_attrs(marks: Any) -> dict:
    out: dict = {}
    for m in marks or []:
        if isinstance(m, dict) and isinstance(m.get("type"), str):
            attrs = m.get("attrs")
            out[m["type"]] = attrs if isinstance(attrs, dict) else {}
    return out


def _append_content(parent, content: Any) -> None:
    nodes = content if isinstance(content, list) else []
    i = 0
    while i < len(nodes):
        node = nodes[i]
        if not isinstance(node, dict):
            i += 1
            continue
        if node.get("type") == "text":
            text = parent.children.append(XmlText())
            while i < len(nodes) and isinstance(nodes[i], dict) and nodes[i].get("type") == "text":
                t = nodes[i].get("text")
                if isinstance(t, str) and t:
                    text.insert(len(text), t, _marks_to_attrs(nodes[i].get("marks")))
                i += 1
            continue
        if isinstance(node.get("type"), str):
            el = parent.children.append(XmlElement(node["type"]))
            attrs = node.get("attrs")
            if isinstance(attrs, dict):
                for k, v in attrs.items():
                    if v is not None and k != "ychange":
                        el.attributes[k] = v
            _append_content(el, node.get("content"))
        i += 1


def json_to_fragment(doc_json: dict, fragment: XmlFragment) -> None:
    """Write a TipTap document into an empty fragment, in one transaction."""
    with fragment.doc.transaction():
        _append_content(fragment, doc_json.get("content"))


def _node_json(item) -> list[dict]:
    if isinstance(item, XmlText):
        out = []
        for insert, attrs in item.diff():
            if not isinstance(insert, str) or not insert:
                continue
            node: dict = {"type": "text", "text": insert}
            if attrs:
                marks = []
                for k, v in attrs.items():
                    mark: dict = {"type": _mark_name(k)}
                    if isinstance(v, dict) and v:
                        mark["attrs"] = _norm(v)
                    marks.append(mark)
                node["marks"] = marks
            out.append(node)
        return out
    if isinstance(item, XmlElement):
        if not item.tag:
            return []
        node = {"type": item.tag}
        attrs = {k: _norm(v) for k, v in item.attributes}
        if attrs:
            node["attrs"] = attrs
        children = [n for c in item.children for n in _node_json(c)]
        if children:
            node["content"] = children
        return [node]
    return []


def fragment_to_json(fragment: XmlFragment) -> dict:
    return {"type": "doc", "content": [n for c in fragment.children for n in _node_json(c)]}


def dumps(doc_json: dict) -> str:
    """Compact, like the editor's JSON.stringify."""
    return json.dumps(doc_json, separators=(",", ":"), ensure_ascii=False)


def seed_json(content: str | None) -> dict:
    """The document a room starts from. Empty or unreadable content becomes
    one empty paragraph, and a document that does not end in a paragraph gets
    one — the editor's trailing-node rule would otherwise add it in every
    client that opens the room, at once."""
    doc = page_doc.parse_doc(content) or {"type": "doc", "content": []}
    content_list = [n for n in (doc.get("content") or []) if isinstance(n, dict)]
    if not content_list or content_list[-1].get("type") != "paragraph":
        content_list.append({"type": "paragraph"})
    return {"type": "doc", "content": content_list}


def canonical(content: str | dict | None) -> str:
    """Compare documents by meaning: null attrs and empty attrs/marks dropped,
    keys and marks sorted. Used to skip writes that would change nothing."""
    doc = page_doc.parse_doc(content) if isinstance(content, str) or content is None else content

    def walk(n):
        if isinstance(n, dict):
            out = {}
            for k, v in n.items():
                if v is None:
                    continue
                if k in ("attrs", "marks", "content") and not v:
                    continue
                out[k] = walk(v)
            if isinstance(out.get("marks"), list):
                # Mark order carries no meaning (the editor sorts them itself).
                out["marks"] = sorted(out["marks"], key=lambda m: json.dumps(m, sort_keys=True))
            return out
        if isinstance(n, list):
            return [walk(x) for x in n]
        return _norm(n)

    return json.dumps(walk(doc or {}), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# Awareness frames (y-protocols/awareness encoding)
# ---------------------------------------------------------------------------

def _var_string(s: str) -> bytes:
    b = s.encode("utf-8")
    return write_var_uint(len(b)) + b


def decode_awareness(payload: bytes) -> list[tuple[int, int, str]]:
    dec = Decoder(payload)
    n = dec.read_var_uint()
    out = []
    for _ in range(n):
        cid = dec.read_var_uint()
        clock = dec.read_var_uint()
        state = dec.read_var_string()
        out.append((cid, clock, state))
    return out


def encode_awareness(entries: list[tuple[int, int, str]]) -> bytes:
    body = write_var_uint(len(entries)) + b"".join(
        write_var_uint(cid) + write_var_uint(clock) + _var_string(state) for cid, clock, state in entries
    )
    return bytes([MSG_AWARENESS]) + write_var_uint(len(body)) + body


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

@dataclass
class PageRecord:
    page_id: str
    content: str | None
    content_type: str
    created_by: str | None
    trashed: bool = False


class PageStore(Protocol):
    async def load(self, page_id: str) -> PageRecord | None: ...

    async def save(self, page_id: str, content: str, *, base: str | None, user_id: str | None) -> bool:
        """Write the room's JSON. False when the page is gone or no longer a
        block document (the room then closes)."""
        ...


class PgPageStore:
    """published_pages, through the app's asyncpg pool."""

    async def load(self, page_id: str) -> PageRecord | None:
        from ..db.postgres import get_pool
        from . import page_tree

        pool = get_pool()
        if not pool:
            raise RuntimeError("Database unavailable")
        row = await pool.fetchrow("SELECT * FROM published_pages WHERE id = $1", page_id)
        if not row:
            return None
        return PageRecord(page_id, row["content"], row["content_type"], str(row["created_by"]) if row["created_by"] else None,
                          page_tree.is_trashed(row))

    async def save(self, page_id: str, content: str, *, base: str | None, user_id: str | None) -> bool:
        from ..db.postgres import get_pool
        from ..routers.pages import _snapshot_version
        from . import page_tree

        pool = get_pool()
        if not pool:
            raise RuntimeError("Database unavailable")
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow("SELECT * FROM published_pages WHERE id = $1 FOR UPDATE", page_id)
                if not row or row["content_type"] != page_doc.DOC_TYPE or page_tree.is_trashed(row):
                    return False
                # Written elsewhere since the room last saw it (a race the REST
                # guard should prevent): keep that copy in History first.
                note = None
                if (row["content"] or "") != (base or "") and canonical(row["content"]) != canonical(base):
                    note = "Saved before live edits were merged"
                await _snapshot_version(conn, page_id, row, user_id, note=note)
                await conn.execute(
                    "UPDATE published_pages SET content = $1, updated_at = $2, updated_by = $3 WHERE id = $4",
                    content, datetime.now(timezone.utc), user_id, page_id,
                )
        return True


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

@dataclass
class Identity:
    user_id: str | None
    name: str
    role: str
    color: str = ""

    def __post_init__(self):
        if not self.color:
            self.color = user_color(self.user_id or self.name)


class Client:
    """One socket. Frames go out through a bounded queue drained by a writer
    task, so a slow reader can never stall the room."""

    def __init__(self, send_bytes: Callable[[bytes], Awaitable[None]], send_text: Callable[[str], Awaitable[None]],
                 close: Callable[[int, str], Awaitable[None]], identity: Identity):
        self.id = uuid.uuid4().hex
        self.identity = identity
        self._send_bytes = send_bytes
        self._send_text = send_text
        self._close = close
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=limits.send_queue)
        self.awareness_ids: set[int] = set()
        self.last_seen = time.monotonic()
        self.authed_at = time.monotonic()
        self.closed = False
        self._writer = asyncio.create_task(self._drain(), name=f"collab-writer-{self.id[:6]}")

    async def _drain(self):
        try:
            while True:
                item = await self.queue.get()
                if item is None:
                    return
                if isinstance(item, tuple):
                    await self._close(*item)
                    return
                if isinstance(item, bytes):
                    await self._send_bytes(item)
                else:
                    await self._send_text(item)
        except Exception:
            self.closed = True

    def send(self, item: bytes | str) -> None:
        if self.closed:
            return
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            # Too far behind to catch up incrementally; it re-syncs on reconnect.
            self.close(CLOSE_TIMEOUT, "client too slow")

    def send_json(self, obj: dict) -> None:
        self.send(json.dumps(obj, separators=(",", ":")))

    def close(self, code: int, reason: str = "") -> None:
        if self.closed:
            return
        self.closed = True
        while True:  # the close frame jumps the queue
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self.queue.put_nowait((code, reason[:120]))

    async def finish(self) -> None:
        if not self.closed:
            self.closed = True
            try:
                self.queue.put_nowait(None)
            except asyncio.QueueFull:
                self._writer.cancel()
        try:
            await asyncio.wait_for(self._writer, timeout=2)
        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
            self._writer.cancel()


class RoomFull(Exception):
    pass


class Busy(Exception):
    """A REST write hit a page that is being edited live."""


class Room:
    def __init__(self, record: PageRecord, store: PageStore):
        self.page_id = record.page_id
        self.store = store
        self.epoch = uuid.uuid4().hex
        self.doc = Doc()
        self.fragment = self.doc.get(FRAGMENT, type=XmlFragment)
        json_to_fragment(seed_json(record.content), self.fragment)
        self.base_content = record.content or ""
        self.clients: dict[str, Client] = {}
        self.awareness: dict[int, tuple[int, str]] = {}
        self.changed = False          # edits not yet written to the page
        self.edited = False           # any live edit since the room loaded
        self.first_change_at = 0.0
        self.last_active = time.monotonic()
        self.last_editor: str | None = None
        self.doc_bytes = len(self.doc.get_update())
        self._outbox: list[bytes] = []
        self._sub = self.doc.observe(lambda ev: self._outbox.append(ev.update))
        self._timer: asyncio.TimerHandle | None = None
        self._persist_lock = asyncio.Lock()
        self._persist_task: asyncio.Task | None = None
        self.closed = False

    # -- membership ---------------------------------------------------------

    def add(self, client: Client) -> None:
        self.clients[client.id] = client
        self.last_active = time.monotonic()
        client.send_json({
            "type": "welcome", "epoch": self.epoch,
            "user": {"name": client.identity.name, "color": client.identity.color},
            "peers": len(self.clients) - 1,
            "maxMessageBytes": limits.max_message_bytes,
        })
        client.send(create_sync_message(self.doc))
        if self.awareness:
            client.send(encode_awareness([(cid, clock, state) for cid, (clock, state) in self.awareness.items()]))

    def remove(self, client: Client) -> None:
        self.clients.pop(client.id, None)
        self.last_active = time.monotonic()
        gone = []
        for cid in client.awareness_ids:
            clock, _ = self.awareness.pop(cid, (0, "null"))
            gone.append((cid, clock + 1, "null"))
        if gone:
            self.broadcast(encode_awareness(gone))

    def broadcast(self, frame: bytes | str, exclude: Client | None = None) -> None:
        for c in list(self.clients.values()):
            if c is not exclude:
                c.send(frame)

    # -- frames -------------------------------------------------------------

    def handle(self, client: Client, data: bytes) -> None:
        if not data:
            return
        kind = data[0]
        if kind == MSG_SYNC:
            self._handle_sync(client, data[1:])
        elif kind == MSG_AWARENESS:
            self._handle_awareness(client, data[1:])
        elif kind == MSG_QUERY_AWARENESS:
            client.send(encode_awareness([(cid, clock, state) for cid, (clock, state) in self.awareness.items()]))
        # Anything else (auth frames of other servers, future types) is ignored.

    def _handle_sync(self, client: Client, msg: bytes) -> None:
        if not msg:
            raise ValueError("empty sync message")
        if msg[0] in (SYNC_STEP2, SYNC_UPDATE):
            self.doc_bytes += len(msg)
            if self.doc_bytes > limits.max_doc_bytes:
                self.doc_bytes = len(self.doc.get_update())
                if self.doc_bytes + len(msg) > limits.max_doc_bytes:
                    client.close(CLOSE_TOO_LARGE, "document too large for live editing")
                    return
        self._outbox = []
        reply = handle_sync_message(msg, self.doc)  # a whole frame, type byte included
        if reply:
            client.send(reply)
        updates, self._outbox = self._outbox, []
        if updates:
            for u in updates:
                self.broadcast(create_update_message(u), exclude=client)
            self._mark_changed(client)

    def _handle_awareness(self, client: Client, msg: bytes) -> None:
        if len(msg) > limits.max_awareness_bytes:
            return
        dec = Decoder(msg)
        payload = dec.read_message() or b""
        entries = []
        for cid, clock, state in decode_awareness(payload)[:4]:
            owner_ok = cid in client.awareness_ids or not any(cid in c.awareness_ids for c in self.clients.values())
            if not owner_ok:
                continue  # someone else's client id
            try:
                parsed = json.loads(state)
            except ValueError:
                continue
            if isinstance(parsed, dict):
                # Presence carries the signed-in name and colour, whatever the
                # client claims.
                parsed["user"] = {"name": client.identity.name, "color": client.identity.color}
                state = json.dumps(parsed, separators=(",", ":"))
                client.awareness_ids.add(cid)
                self.awareness[cid] = (clock, state)
            else:
                state = "null"
                client.awareness_ids.discard(cid)
                self.awareness.pop(cid, None)
            entries.append((cid, clock, state))
        if entries:
            self.broadcast(encode_awareness(entries), exclude=client)

    # -- persistence --------------------------------------------------------

    def _mark_changed(self, client: Client) -> None:
        now = time.monotonic()
        if not self.changed:
            self.first_change_at = now
        self.changed = True
        self.edited = True
        self.last_active = now
        self.last_editor = client.identity.user_id
        self._schedule()

    def _schedule(self, delay: float | None = None) -> None:
        if self._timer:
            self._timer.cancel()
        if delay is None:
            wait_left = self.first_change_at + limits.persist_max_wait_s - time.monotonic()
            delay = max(0.0, min(limits.persist_debounce_s, wait_left))
        loop = asyncio.get_running_loop()
        self._timer = loop.call_later(delay, self._fire)

    def _fire(self) -> None:
        self._timer = None
        if self._persist_task is None or self._persist_task.done():
            self._persist_task = asyncio.create_task(self.persist(), name=f"collab-persist-{self.page_id[:8]}")

    def current_json(self) -> str:
        return dumps(fragment_to_json(self.fragment))

    async def persist(self) -> bool:
        """Write the room's document to the page if it changed. True when the
        page holds the room's content afterwards."""
        async with self._persist_lock:
            if not self.changed:
                return True
            if self._timer:
                self._timer.cancel()
                self._timer = None
            self.changed = False
            content = self.current_json()
            if canonical(content) == canonical(self.base_content):
                return True
            if len(content) > limits.max_content_chars:
                logger.warning("collab: page %s is over the content cap; not saved", self.page_id)
                self.broadcast(json.dumps({"type": "error", "code": "too_large",
                                           "message": "This document is too large to save."}))
                return False
            try:
                page_doc.validate_doc(content)
                ok = await self.store.save(self.page_id, content, base=self.base_content, user_id=self.last_editor)
            except Exception as exc:
                logger.warning("collab: saving page %s failed: %s", self.page_id, exc)
                self.changed = True
                if not self.closed:
                    self._schedule(5.0)
                return False
            if not ok:
                for c in list(self.clients.values()):
                    c.close(CLOSE_NOT_FOUND, "page is no longer a document")
                return False
            self.base_content = content
            self.broadcast(json.dumps({"type": "saved", "at": datetime.now(timezone.utc).isoformat()}))
            return True

    def close(self) -> None:
        self.closed = True
        if self._timer:
            self._timer.cancel()
            self._timer = None
        try:
            self.doc.unobserve(self._sub)
        except Exception:
            pass


class Hub:
    """Every room in this process."""

    def __init__(self, store: PageStore | None = None):
        self.store: PageStore = store or PgPageStore()
        self.rooms: dict[str, Room] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._reaper: asyncio.Task | None = None

    def _lock(self, page_id: str) -> asyncio.Lock:
        lock = self._locks.get(page_id)
        if lock is None:
            lock = self._locks[page_id] = asyncio.Lock()
        return lock

    async def join(self, record: PageRecord, client: Client) -> Room:
        async with self._lock(record.page_id):
            room = self.rooms.get(record.page_id)
            if room is None:
                if len(self.rooms) >= limits.max_rooms:
                    await self._evict_idle(force_one=True)
                    if len(self.rooms) >= limits.max_rooms:
                        raise RoomFull("server is at its live-editing capacity")
                room = Room(record, self.store)
                self.rooms[record.page_id] = room
            if len(room.clients) >= limits.max_clients_per_room:
                raise RoomFull("too many editors on this page")
            room.add(client)
        self._ensure_reaper()
        return room

    async def leave(self, room: Room, client: Client) -> None:
        room.remove(client)
        if not room.clients:
            await room.persist()

    async def before_external_write(self, page_id: str, *, force: bool = False) -> str | None:
        """Called before the page's content is written outside the room.

        While editors are connected a plain write is refused (Busy -> 409):
        their next save would overwrite it, or it would overwrite them. A
        forced write (version restore) saves the room, disconnects everyone
        with CLOSE_RESET so they re-sync to the new content, and drops it.

        An empty room is saved and dropped, so the next editor starts from
        what the write left. Returns a version note when the room carried
        live edits, so the caller keeps them in History whatever the version
        throttle says.
        """
        room = self.rooms.get(page_id)
        if room is None:
            return None
        if room.clients and not force:
            raise Busy("This page is open for live editing. Your changes will sync when the live connection is back.")
        async with self._lock(page_id):
            room = self.rooms.get(page_id)
            if room is None:
                return None
            await room.persist()
            for c in list(room.clients.values()):
                c.close(CLOSE_RESET, "page was rewritten; reconnect")
            self._drop(room)
            return "Live edits before this change" if room.edited else None

    def _drop(self, room: Room) -> None:
        room.close()
        if self.rooms.get(room.page_id) is room:
            del self.rooms[room.page_id]
        lock = self._locks.get(room.page_id)
        if lock is not None and not lock.locked():
            self._locks.pop(room.page_id, None)

    def _ensure_reaper(self) -> None:
        if self._reaper is None or self._reaper.done():
            self._reaper = asyncio.create_task(self._reap_loop(), name="collab-reaper")

    async def _reap_loop(self) -> None:
        while self.rooms:
            await asyncio.sleep(limits.reap_interval_s)
            try:
                await self.reap()
            except Exception as exc:  # never let the reaper die quietly
                logger.warning("collab reaper: %s", exc)

    async def reap(self) -> None:
        now = time.monotonic()
        for room in list(self.rooms.values()):
            for c in list(room.clients.values()):
                if now - c.last_seen > limits.client_timeout_s:
                    c.close(CLOSE_TIMEOUT, "no heartbeat")
        await self._evict_idle()

    async def _evict_idle(self, force_one: bool = False) -> None:
        now = time.monotonic()
        idle = sorted((r for r in self.rooms.values() if not r.clients), key=lambda r: r.last_active)
        for room in idle:
            if not force_one and now - room.last_active < limits.room_idle_s:
                continue
            if await room.persist() or not room.changed:
                if not room.clients:
                    self._drop(room)
                    if force_one:
                        return

    async def shutdown(self) -> None:
        if self._reaper:
            self._reaper.cancel()
        for room in list(self.rooms.values()):
            try:
                await asyncio.wait_for(room.persist(), timeout=10)
            except Exception as exc:
                logger.warning("collab: final save of page %s failed: %s", room.page_id, exc)
            for c in list(room.clients.values()):
                c.close(CLOSE_GOING_AWAY, "server restarting")
            self._drop(room)

    def stats(self) -> dict:
        return {"rooms": len(self.rooms), "clients": sum(len(r.clients) for r in self.rooms.values())}


hub = Hub()


def configure(store: PageStore | None = None, **limit_overrides) -> Hub:
    """Replace the hub (tests, local harnesses) and adjust limits."""
    global hub
    for k, v in limit_overrides.items():
        if not hasattr(limits, k):
            raise AttributeError(k)
        setattr(limits, k, v)
    hub = Hub(store)
    return hub


def get_hub() -> Hub:
    return hub


async def before_external_write(page_id: str, *, force: bool = False) -> str | None:
    return await hub.before_external_write(page_id, force=force)


async def shutdown() -> None:
    await hub.shutdown()
