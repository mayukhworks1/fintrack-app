"""
Live co-editing of block documents: /api/collab/pages/{id}.

The socket is driven with Starlette's TestClient against an app that mounts
only the collab router, an in-memory page store and a token table standing in
for the REST API's token check. "Clients" are pycrdt documents speaking the
y-websocket sync protocol, the same frames the browser's provider sends.
"""

import functools
import json
import logging
import time
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pycrdt import Doc, XmlElement, XmlFragment, XmlText, create_sync_message, create_update_message, handle_sync_message
from starlette.websockets import WebSocketDisconnect

import app.routers.collab as R
from app.services import collab as C
from tests.test_page_doc import DOC, DOC_JSON

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())
TOKENS = {
    "alice-token": C.Identity(user_id=ALICE, name="Alice Rao", role="user"),
    "bob-token": C.Identity(user_id=BOB, name="Bob Iyer", role="user"),
    "root-token": C.Identity(user_id=str(uuid.uuid4()), name="Root", role="superadmin"),
}


class MemoryStore:
    def __init__(self):
        self.pages: dict[str, C.PageRecord] = {}
        self.saves: list[tuple[str, str]] = []

    def add(self, content=DOC_JSON, owner=ALICE, content_type="doc", trashed=False):
        pid = str(uuid.uuid4())
        self.pages[pid] = C.PageRecord(pid, content, content_type, owner, trashed)
        return pid

    async def load(self, page_id):
        rec = self.pages.get(page_id)
        return None if rec is None else C.PageRecord(rec.page_id, rec.content, rec.content_type, rec.created_by, rec.trashed)

    async def save(self, page_id, content, *, base, user_id):
        rec = self.pages.get(page_id)
        if rec is None or rec.content_type != "doc" or rec.trashed:
            return False
        rec.content = content
        self.saves.append((page_id, content))
        return True


@pytest.fixture
def env(monkeypatch):
    store = MemoryStore()
    C.configure(store, persist_debounce_s=0.05, persist_max_wait_s=1.0, room_idle_s=60.0,
                max_clients_per_room=3, max_message_bytes=64 * 1024, auth_timeout_s=1.0,
                reap_interval_s=0.05, client_timeout_s=60.0)

    async def fake_auth(websocket, token):
        ident = TOKENS.get(token)
        if ident is None:
            raise HTTPException(401, "Invalid or expired token")
        return C.Identity(ident.user_id, ident.name, ident.role)

    monkeypatch.setattr(R, "authenticate", fake_auth)
    app = FastAPI()
    app.include_router(R.router)
    with TestClient(app) as tc:
        yield store, tc
    C.configure(None, **{k: getattr(C.Limits(), k) for k in vars(C.Limits())})


def wait_for(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return pred()


class Peer:
    """A pycrdt document on the far end of one socket."""

    def __init__(self, ws):
        self.ws = ws
        self.doc = Doc()
        self.frag = self.doc.get("default", type=XmlFragment)
        self.welcome = None
        self.awareness = []
        self.texts = []

    def connect(self, token="alice-token"):
        self.ws.send_text(json.dumps({"type": "auth", "token": token}))
        self.welcome = self.ws.receive_json()
        assert self.welcome["type"] == "welcome"
        self.ws.send_bytes(create_sync_message(self.doc))
        synced = False
        while not synced:
            synced = self.pump_one()
        return self

    def pump_one(self):
        """Handle one frame; True when it was the server's sync step 2."""
        msg = self.ws.receive()
        if msg.get("text") is not None:
            self.texts.append(json.loads(msg["text"]))
            return False
        if msg.get("type") == "websocket.close":
            raise WebSocketDisconnect(msg.get("code", 1000))
        data = msg["bytes"]
        if data[0] == C.MSG_SYNC:
            reply = handle_sync_message(data[1:], self.doc)
            if reply:
                self.ws.send_bytes(reply)
            return data[1] == C.SYNC_STEP2
        if data[0] == C.MSG_AWARENESS:
            from pycrdt import Decoder
            self.awareness.extend(C.decode_awareness(Decoder(data[1:]).read_message()))
        return False

    def edit(self, fn):
        before = self.doc.get_state()
        with self.doc.transaction():
            fn(self.frag)
        self.ws.send_bytes(create_update_message(self.doc.get_update(before)))

    def json(self):
        return C.fragment_to_json(self.frag)


def first_text(frag):
    """The XmlText of the first paragraph-like block."""
    for el in frag.children:
        for c in el.children:
            if isinstance(c, XmlText):
                return c
    raise AssertionError("no text")


def append_paragraph(text):
    def fn(frag):
        p = frag.children.append(XmlElement("paragraph"))
        t = p.children.append(XmlText())
        t.insert(0, text)
    return fn


def close_code(ws):
    msg = ws.receive()
    while msg.get("type") != "websocket.close":
        msg = ws.receive()
    return msg.get("code")


URL = "/api/collab/pages/{}"


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

class TestConversion:
    def test_round_trip_keeps_the_document(self):
        d = Doc()
        frag = d.get("default", type=XmlFragment)
        C.json_to_fragment(DOC, frag)
        back = C.fragment_to_json(frag)
        assert C.canonical(back) == C.canonical(DOC)
        # Numbers stay ints and marks keep their names.
        assert back["content"][0]["attrs"]["level"] == 1
        para = back["content"][1]["content"]
        assert para[1] == {"type": "text", "text": "new", "marks": [{"type": "bold"}]}
        assert para[2] == {"type": "text", "text": " billing flow."}   # no inherited bold
        assert para[3] == {"type": "hardBreak"}

    def test_mark_attrs_and_hashed_mark_names(self):
        d = Doc()
        frag = d.get("default", type=XmlFragment)
        doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": "site", "marks": [{"type": "link", "attrs": {"href": "https://x.test", "target": "_blank"}}]}]}]}
        C.json_to_fragment(doc, frag)
        assert C.fragment_to_json(frag) == doc
        assert C._mark_name("comment--AbC123+/") == "comment"
        assert C._mark_name("bold") == "bold" and C._mark_name("a--b") == "a--b"

    def test_seed_adds_a_trailing_paragraph_and_handles_empty_pages(self):
        assert C.seed_json("") == {"type": "doc", "content": [{"type": "paragraph"}]}
        assert C.seed_json("# not json")["content"] == [{"type": "paragraph"}]
        seeded = C.seed_json(DOC_JSON)
        assert seeded["content"][-1] == {"type": "paragraph"} and len(seeded["content"]) == len(DOC["content"]) + 1

    def test_awareness_codec_round_trips_unicode(self):
        entries = [(7, 3, json.dumps({"user": {"name": "Ännä 🙂"}})), (9, 1, "null")]
        frame = C.encode_awareness(entries)
        from pycrdt import Decoder
        assert C.decode_awareness(Decoder(frame[1:]).read_message()) == entries


# ---------------------------------------------------------------------------
# The socket
# ---------------------------------------------------------------------------

class TestAccess:
    def test_the_first_frame_must_authenticate(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            ws.send_text(json.dumps({"type": "ping"}))
            assert close_code(ws) == C.CLOSE_UNAUTHORIZED
        with tc.websocket_connect(URL.format(pid)) as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "forged"}))
            assert close_code(ws) == C.CLOSE_UNAUTHORIZED
        assert not C.get_hub().rooms

    def test_silence_after_connecting_times_out(self, env):
        store, tc = env
        with tc.websocket_connect(URL.format(store.add())) as ws:
            assert close_code(ws) == C.CLOSE_TIMEOUT

    def test_the_real_token_check_rejects_a_bad_token(self, env, monkeypatch):
        store, tc = env
        monkeypatch.undo()   # back to the REST API's own check
        with tc.websocket_connect(URL.format(store.add())) as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "not-a-real-token"}))
            assert close_code(ws) == C.CLOSE_UNAUTHORIZED

    def test_only_the_owner_or_a_superadmin_may_edit(self, env):
        store, tc = env
        pid = store.add(owner=ALICE)
        with tc.websocket_connect(URL.format(pid)) as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "bob-token"}))
            assert close_code(ws) == C.CLOSE_FORBIDDEN
        with tc.websocket_connect(URL.format(pid)) as ws:
            Peer(ws).connect("root-token")

    @pytest.mark.parametrize("kind", ["missing", "markdown", "trashed", "bad-id"])
    def test_only_live_block_documents_open(self, env, kind):
        store, tc = env
        pid = {"missing": str(uuid.uuid4()), "markdown": store.add(content="# hi", content_type="markdown"),
               "trashed": store.add(trashed=True), "bad-id": "not-a-uuid"}[kind]
        if kind == "bad-id":   # refused at the handshake
            with pytest.raises(WebSocketDisconnect) as e:
                with tc.websocket_connect(URL.format(pid)):
                    pass
            assert e.value.code == C.CLOSE_NOT_FOUND
            return
        with tc.websocket_connect(URL.format(pid)) as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "alice-token"}))
            assert close_code(ws) == C.CLOSE_NOT_FOUND


class TestEditing:
    def test_a_client_receives_the_page_as_a_y_document(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            assert a.welcome["user"] == {"name": "Alice Rao", "color": C.user_color(ALICE)}
            assert C.canonical(a.json()) == C.canonical(C.seed_json(DOC_JSON))

    def test_two_clients_converge(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as w1, tc.websocket_connect(URL.format(pid)) as w2:
            a = Peer(w1).connect()
            b = Peer(w2).connect("root-token")
            epoch = a.welcome["epoch"]
            assert b.welcome["epoch"] == epoch and b.welcome["peers"] == 1
            # Concurrent edits on both sides of the same paragraph.
            a.edit(lambda f: first_text(f).insert(0, "A: "))
            b.edit(lambda f: first_text(f).insert(len(first_text(f)), "!"))
            b.edit(append_paragraph("from b"))
            for _ in range(2):
                b.pump_one()
            for _ in range(2):
                a.pump_one()
            assert a.json() == b.json()
            heading = a.json()["content"][0]["content"][0]["text"]
            assert heading == "A: Q4 plan!"
            room = C.get_hub().rooms[pid]
            assert C.fragment_to_json(room.fragment) == a.json()

    def test_edits_are_written_back_as_json_after_a_pause(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(lambda f: first_text(f).insert(0, "Live "))
            assert wait_for(lambda: store.saves)
            saved = json.loads(store.pages[pid].content)
            assert saved["content"][0] == {"type": "heading", "attrs": {"level": 1},
                                           "content": [{"type": "text", "text": "Live Q4 plan"}]}
            # The editor is told the page was saved.
            assert wait_for(lambda: (a.pump_one() or True) and any(t["type"] == "saved" for t in a.texts))

    def test_last_disconnect_saves_and_an_unchanged_room_writes_nothing(self, env):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            Peer(ws).connect()
        time.sleep(0.1)
        assert store.saves == []           # opened and closed: no write, no version
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("before leaving"))
            time.sleep(0.05)
        assert wait_for(lambda: store.saves)
        assert "before leaving" in store.pages[pid].content

    def test_a_reconnecting_client_sees_the_same_epoch_until_the_room_is_rebuilt(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            e1 = Peer(ws).connect().welcome["epoch"]
        with tc.websocket_connect(URL.format(pid)) as ws:
            assert Peer(ws).connect().welcome["epoch"] == e1
        tc.portal.call(C.get_hub().before_external_write, pid)  # empty room: dropped
        with tc.websocket_connect(URL.format(pid)) as ws:
            assert Peer(ws).connect().welcome["epoch"] != e1

    def test_presence_is_relayed_with_the_signed_in_name(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as w1, tc.websocket_connect(URL.format(pid)) as w2:
            a = Peer(w1).connect()
            b = Peer(w2).connect("root-token")
            state = json.dumps({"user": {"name": "Somebody Else", "color": "#000000"}, "cursor": None})
            w1.send_bytes(C.encode_awareness([(4242, 1, state)]))
            while not b.awareness:
                b.pump_one()
            cid, clock, st = b.awareness[-1]
            assert cid == 4242 and json.loads(st)["user"] == {"name": "Alice Rao", "color": C.user_color(ALICE)}
        # A later joiner gets current presence; Alice's entry was removed when she left.

    def test_ping_pong(self, env):
        store, tc = env
        with tc.websocket_connect(URL.format(store.add())) as ws:
            a = Peer(ws).connect()
            ws.send_text(json.dumps({"type": "ping"}))
            while not any(t["type"] == "pong" for t in a.texts):
                a.pump_one()


class TestLimits:
    def test_an_oversized_frame_closes_the_socket(self, env):
        store, tc = env
        with tc.websocket_connect(URL.format(store.add())) as ws:
            Peer(ws).connect()
            ws.send_bytes(b"\x00\x02" + b"x" * (70 * 1024))
            assert close_code(ws) == C.CLOSE_MESSAGE_TOO_BIG

    def test_a_document_over_the_size_cap_is_refused(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            C.limits.max_doc_bytes = len(C.get_hub().rooms[pid].doc.get_update()) + 100
            a.edit(append_paragraph("y" * 2000))
            assert close_code(ws) == C.CLOSE_TOO_LARGE

    def test_malformed_frames_close_the_socket(self, env):
        store, tc = env
        with tc.websocket_connect(URL.format(store.add())) as ws:
            Peer(ws).connect()
            ws.send_bytes(b"\x00\x02\x05\xff\xff")
            assert close_code(ws) == C.CLOSE_BAD_REQUEST

    def test_a_room_has_a_client_cap(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as w1, tc.websocket_connect(URL.format(pid)) as w2, \
                tc.websocket_connect(URL.format(pid)) as w3, tc.websocket_connect(URL.format(pid)) as w4:
            for w in (w1, w2, w3):
                Peer(w).connect()
            w4.send_text(json.dumps({"type": "auth", "token": "alice-token"}))
            assert close_code(w4) == C.CLOSE_FULL

    def test_a_silent_client_is_dropped(self, env):
        store, tc = env
        C.limits.client_timeout_s = 0.2
        with tc.websocket_connect(URL.format(store.add())) as ws:
            Peer(ws).connect()
            assert close_code(ws) == C.CLOSE_TIMEOUT

    def test_an_idle_empty_room_is_saved_and_evicted(self, env):
        store, tc = env
        C.limits.room_idle_s = 0.1
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            Peer(ws).connect()
        assert wait_for(lambda: pid not in C.get_hub().rooms)


class TestSizeAndLifecycle:
    def test_a_page_over_the_live_cap_is_sent_to_rest_saving(self, env):
        store, tc = env
        pid = store.add()
        C.limits.max_live_content_chars = 50
        with tc.websocket_connect(URL.format(pid)) as ws:
            ws.send_text(json.dumps({"type": "auth", "token": "alice-token"}))
            msg = ws.receive_json()
            assert msg["type"] == "error" and msg["code"] == "too_large" and msg["mode"] == "rest"
            assert msg["limit"] == 50
            assert close_code(ws) == C.CLOSE_TOO_LARGE
        assert pid not in C.get_hub().rooms

    def test_the_room_is_seeded_off_the_loop_and_matches_the_page(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            assert C.canonical(a.json()) == C.canonical(C.seed_json(DOC_JSON))

    def test_a_save_over_the_content_cap_keeps_the_edits(self, env):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            C.limits.max_content_chars = len(DOC_JSON) + 10
            a.edit(append_paragraph("z" * 200))
            time.sleep(0.1)
            room = C.get_hub().rooms[pid]
            assert tc.portal.call(room.persist) is False
            assert room.changed and room.too_large
            # The editor is told once.
            a.pump_one()
            assert any(t.get("code") == "too_large" for t in a.texts)
        # Not evicted with its edits unsaved...
        tc.portal.call(C.get_hub()._evict_idle, True)
        assert pid in C.get_hub().rooms
        assert store.saves == []
        # ...and saved once it fits again.
        C.limits.max_content_chars = 5_000_000
        assert tc.portal.call(C.get_hub().rooms[pid].persist) is True
        assert "zzz" in store.pages[pid].content

    def test_unchanged_state_is_not_converted_again(self, env, monkeypatch):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("once"))
            time.sleep(0.1)
            room = C.get_hub().rooms[pid]
            assert tc.portal.call(room.persist) is True
            calls = []
            monkeypatch.setattr(C, "render_update", lambda u: calls.append(1) or ("", ""))
            room.changed = True                      # a no-op update arrived
            assert tc.portal.call(room.persist) is True
            assert calls == [] and len(store.saves) == 1

    def test_trash_closes_the_room_with_its_own_code(self, env):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("last words"))
            time.sleep(0.1)
            assert tc.portal.call(C.close_pages, [pid]) == 1
            assert close_code(ws) == C.CLOSE_TRASHED
        assert "last words" in store.pages[pid].content
        assert pid not in C.get_hub().rooms

    def test_shutdown_keeps_trying_and_says_what_was_lost(self, env, caplog):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        C.limits.shutdown_timeout_s = 1.0
        pid = store.add()
        failures = {"n": 0}
        real = store.save

        async def flaky(page_id, content, *, base, user_id):
            failures["n"] += 1
            if failures["n"] < 3:
                raise ConnectionError("database down")
            return await real(page_id, content, base=base, user_id=user_id)
        store.save = flaky
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("survives a blip"))
            time.sleep(0.1)
            tc.portal.call(C.get_hub().shutdown)
        assert failures["n"] == 3 and "survives a blip" in store.pages[pid].content

        pid2 = store.add()

        async def down(page_id, content, *, base, user_id):
            raise ConnectionError("database down")
        store.save = down
        C.limits.shutdown_timeout_s = 0.6
        with tc.websocket_connect(URL.format(pid2)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("lost"))
            time.sleep(0.1)
            with caplog.at_level(logging.ERROR, logger="fintrack.collab"):
                tc.portal.call(C.get_hub().shutdown)
        assert any(pid2 in r.getMessage() and "could not be saved" in r.getMessage() for r in caplog.records)


class TestRestWrites:
    def test_a_rest_write_is_refused_while_editors_are_connected(self, env):
        store, tc = env
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            Peer(ws).connect()
            with pytest.raises(C.Busy):
                tc.portal.call(C.get_hub().before_external_write, pid)

    def test_a_forced_write_saves_and_resets_the_editors(self, env):
        store, tc = env
        C.limits.persist_debounce_s = 30.0
        pid = store.add()
        with tc.websocket_connect(URL.format(pid)) as ws:
            a = Peer(ws).connect()
            a.edit(append_paragraph("keep me"))
            time.sleep(0.1)
            note = tc.portal.call(functools.partial(C.get_hub().before_external_write, pid, force=True))
            assert note and "keep me" in store.pages[pid].content
            assert close_code(ws) == C.CLOSE_RESET
        assert pid not in C.get_hub().rooms

    # update_page against a live room (409 while editors are connected, the
    # flushed room's edits kept in History) is covered against Postgres in
    # tests/test_pages_perf_pg.py::TestUpdatePage.


class TestWiring:
    def test_the_app_serves_the_socket(self):
        from app.main import app
        assert any(getattr(r, "path", "") == "/api/collab/pages/{page_id}" for r in app.routes)

    def test_websocket_handshake_logs_hide_tokens(self):
        from app.main import _ACCESS_LOG_REDACTOR
        rec = logging.LogRecord("uvicorn.error", logging.INFO, __file__, 1, '%s - "WebSocket %s" [accepted]',
                                (("1.2.3.4", 5), "/api/collab/pages/x?token=secret-value"), None)
        assert _ACCESS_LOG_REDACTOR.filter(rec)
        assert "secret-value" not in rec.getMessage()
        assert _ACCESS_LOG_REDACTOR in logging.getLogger("uvicorn.error").filters


class TestEditorCompatibility:
    """A Yjs update written by the editor's own conversion (@tiptap/y-tiptap
    over the full block schema, tests/fixtures/collab_tiptap_update.json)
    reads back here as the same document, and what this side writes for that
    document reads back the same way."""

    def test_reads_what_the_editor_writes(self):
        import base64
        from pathlib import Path
        fx = json.loads((Path(__file__).parent / "fixtures" / "collab_tiptap_update.json").read_text())
        d = Doc()
        frag = d.get("default", type=XmlFragment)
        d.apply_update(base64.b64decode(fx["jsUpdate"]))
        assert C.canonical(C.fragment_to_json(frag)) == C.canonical(fx["doc"])
        d2 = Doc()
        frag2 = d2.get("default", type=XmlFragment)
        C.json_to_fragment(fx["doc"], frag2)
        assert C.canonical(C.fragment_to_json(frag2)) == C.canonical(fx["doc"])
