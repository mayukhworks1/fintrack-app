"""
Page comments, mentions and notifications.

The routes are called directly against an in-memory database that answers the
statements routers/comments.py sends (recognised by identity with the
module's SQL constants). The SQL itself runs against Postgres through the
migration; what is pinned here is the behaviour the comments panel and the
notification bell rely on.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.comments as R
import app.services.page_comments as C

ALICE = str(uuid.uuid4())   # owns the page
BOB = str(uuid.uuid4())     # another user, no access
ROOT = str(uuid.uuid4())    # superadmin
CAROL = str(uuid.uuid4())   # disabled superadmin: never mentionable


class FakeDB:
    def __init__(self, ready=True):
        self.ready = ready
        self.users = {
            ALICE: {"id": ALICE, "email": "alice@x.in", "first_name": "Alice", "last_name": "Rao",
                    "full_name": None, "avatar_url": None, "status": "active", "role": "user"},
            BOB: {"id": BOB, "email": "bob@x.in", "first_name": "Bob", "last_name": None,
                  "full_name": None, "avatar_url": None, "status": "active", "role": "user"},
            ROOT: {"id": ROOT, "email": "root@x.in", "first_name": None, "last_name": None,
                   "full_name": "Root Admin", "avatar_url": "/api/auth/avatar/r", "status": "active",
                   "role": "superadmin"},
            CAROL: {"id": CAROL, "email": "carol@x.in", "first_name": "Carol", "last_name": None,
                    "full_name": None, "avatar_url": None, "status": "disabled", "role": "superadmin"},
        }
        self.pages = {}
        self.comments: dict[str, dict] = {}
        self.notifications: list[dict] = []
        self._t = 0

    def now(self):
        self._t += 1
        return datetime(2026, 10, 26, tzinfo=timezone.utc) + timedelta(minutes=self._t)

    def add_page(self, owner=ALICE, title="Plan"):
        pid = str(uuid.uuid4())
        self.pages[pid] = {"id": pid, "created_by": owner, "title": title, "slug": title.lower()}
        return pid

    # -- pool / connection protocol -----------------------------------------
    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        return self

    def _person(self, uid, prefix):
        u = self.users.get(str(uid)) if uid else None
        keys = ("id", "first_name", "last_name", "full_name", "email", "avatar_url")
        return {prefix + k: (u[k] if u else None) for k in keys}

    def _comment_row(self, c):
        return {**c, **self._person(c["author_user_id"], "a_"), **self._person(c.get("resolved_by"), "r_")}

    def _eligible(self, owner):
        return [u for u in self.users.values()
                if u["status"] == "active" and (u["id"] == str(owner) or u["role"] == "superadmin")]

    async def fetchval(self, sql, *a):
        if sql is C.READY_SQL:
            return self.ready
        if sql is R.UNREAD_COUNT_SQL:
            return sum(1 for n in self.notifications if n["user_id"] == a[0] and n["read_at"] is None)
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def fetchrow(self, sql, *a):
        if sql is R.PAGE_SQL:
            return self.pages.get(str(a[0]))
        if sql is R.ONE_COMMENT_SQL:
            c = self.comments.get(str(a[0]))
            return dict(c) if c else None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def fetch(self, sql, *a):
        ordered = sorted(self.comments.values(), key=lambda c: c["created_at"])
        if sql is R.PAGE_COMMENTS_SQL:
            return [self._comment_row(c) for c in ordered if c["page_id"] == a[0]]
        if sql is R.THREAD_COMMENTS_SQL:
            return [self._comment_row(c) for c in ordered if c["thread_id"] == a[0]]
        if sql is R.THREAD_AUTHORS_SQL:
            seen = []
            for c in ordered:
                if c["thread_id"] == a[0] and c["deleted_at"] is None and c["author_user_id"] not in seen:
                    seen.append(c["author_user_id"])
            return [{"author_user_id": s} for s in seen]
        if sql is R.MENTION_IDS_SQL:
            return [u for u in self._eligible(a[0]) if u["id"] in a[1]]
        if sql is R.MENTION_SEARCH_SQL:
            q = a[1].lower()
            return [u for u in self._eligible(a[0])
                    if not q or q in u["email"] or q in (C.display_name(u) or "").lower()]
        if sql is R.NOTIFICATIONS_SQL:
            rows = [n for n in reversed(self.notifications)
                    if n["user_id"] == a[0] and (not a[1] or n["read_at"] is None)][: a[2]]
            out = []
            for n in rows:
                p = self.pages.get(n["page_id"]) or {}
                c = self.comments.get(n["comment_id"]) or {}
                out.append({**n, "page_title": p.get("title"), "page_slug": p.get("slug"),
                            "thread_id": c.get("thread_id"), **self._person(n["actor_user_id"], "a_")})
            return out
        raise AssertionError(f"unexpected fetch: {sql}")

    async def execute(self, sql, *a):
        if sql is R.INSERT_COMMENT_SQL:
            cid, page_id, thread_id, parent_id, author, body, anchor = a
            self.comments[cid] = {
                "id": cid, "page_id": page_id, "thread_id": thread_id, "parent_id": parent_id,
                "author_user_id": author, "body": body, "anchor": anchor, "resolved_at": None,
                "resolved_by": None, "created_at": self.now(), "edited_at": None, "deleted_at": None,
            }
        elif sql is R.EDIT_COMMENT_SQL:
            self.comments[a[0]].update(body=a[1], edited_at=self.now())
        elif sql is R.DELETE_COMMENT_SQL:
            self.comments[a[0]].update(body="", deleted_at=self.now())
        elif sql is R.DROP_COMMENT_NOTIFICATIONS_SQL:
            self.notifications = [n for n in self.notifications if n["comment_id"] != a[0]]
        elif sql is R.RESOLVE_SQL:
            self.comments[a[0]].update(resolved_at=self.now(), resolved_by=a[1])
        elif sql is R.REOPEN_SQL:
            self.comments[a[0]].update(resolved_at=None, resolved_by=None)
        elif sql is R.MARK_READ_SQL:
            for n in self.notifications:
                if n["id"] == a[0] and n["user_id"] == a[1] and n["read_at"] is None:
                    n["read_at"] = self.now()
        elif sql is R.MARK_ALL_READ_SQL:
            for n in self.notifications:
                if n["user_id"] == a[0] and n["read_at"] is None:
                    n["read_at"] = self.now()
        elif sql is R.MARK_PAGE_READ_SQL:
            for n in self.notifications:
                if n["user_id"] == a[0] and n["page_id"] == a[1] and n["read_at"] is None:
                    n["read_at"] = self.now()
        else:
            raise AssertionError(f"unexpected execute: {sql}")

    async def executemany(self, sql, rows):
        assert sql is R.INSERT_NOTIFICATION_SQL
        for user_id, kind, page_id, comment_id, actor, payload in rows:
            self.notifications.append({
                "id": str(uuid.uuid4()), "user_id": user_id, "kind": kind, "page_id": page_id,
                "comment_id": comment_id, "actor_user_id": actor, "payload": payload,
                "read_at": None, "created_at": self.now(),
            })


@pytest.fixture
def db(monkeypatch):
    C.reset_ready_cache()
    fake = FakeDB()
    monkeypatch.setattr(R, "get_pool", lambda: fake)
    queued = []
    monkeypatch.setattr(R, "_queue_mention_email", lambda *a: queued.append(a))
    fake.queued_mail = queued
    yield fake
    C.reset_ready_cache()


def req(user=ALICE, role="user"):
    return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role, auth_user_name="X"),
                           headers={})


def run(coro):
    return asyncio.run(coro)


def status_of(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value.status_code


def new_thread(page, text="Looks good", user=ALICE, role="user", anchor=None):
    return run(R.create_thread(page, R.NewThreadBody(body=text, anchor=anchor), req(user, role), role))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

class TestThreads:
    def test_create_list_reply(self, db):
        page = db.add_page()
        t = new_thread(page, "First thought")
        assert t["comments"][0]["body"] == "First thought"
        assert t["comments"][0]["author"]["name"] == "Alice Rao"
        assert t["comments"][0]["mine"] is True
        out = run(R.reply(page, t["id"], R.ReplyBody(body="Root here"), req(ROOT, "superadmin"), "superadmin"))
        assert out["comment"]["author"]["name"] == "Root Admin"
        assert out["comment"]["parent_id"] == t["id"]
        listing = run(R.list_comments(page, req(), "all", "user"))
        assert listing["ready"] is True and listing["counts"] == {"open": 1, "resolved": 0}
        [thread] = listing["threads"]
        assert [c["body"] for c in thread["comments"]] == ["First thought", "Root here"]
        assert thread["reply_count"] == 1
        assert [c["mine"] for c in thread["comments"]] == [True, False]

    def test_anchor_is_cleaned_and_kept(self, db):
        page = db.add_page()
        t = new_thread(page, "On this line", anchor={
            "block_id": "blk-1", "from": 12, "to": 4, "quote": "<b>Revenue</b> grew", "evil": "x",
        })
        assert t["anchor"] == {"block_id": "blk-1", "from": 4, "to": 12, "quote": "Revenue grew"}
        bad = new_thread(page, "Page level", anchor={"block_id": "<script>", "from": True})
        assert bad["anchor"] is None

    def test_html_is_stripped_and_empty_is_rejected(self, db):
        page = db.add_page()
        t = new_thread(page, "<img src=x onerror=alert(1)>Hello <b>there</b>\x00 a < b")
        assert t["comments"][0]["body"] == "Hello there a < b"
        assert status_of(R.create_thread(page, R.NewThreadBody(body="  <br> "), req(), "user")) == 422

    def test_edit_own_only(self, db):
        page = db.add_page()
        t = new_thread(page, "Typo")
        cid = t["comments"][0]["id"]
        edited = run(R.edit_comment(page, cid, R.EditBody(body="Fixed"), req(), "user"))
        assert edited["comments"][0]["body"] == "Fixed" and edited["comments"][0]["edited_at"]
        # The superadmin can see the page but cannot put words in Alice's mouth.
        assert status_of(R.edit_comment(page, cid, R.EditBody(body="Hijack"), req(ROOT, "superadmin"), "superadmin")) == 403

    def test_delete_is_soft_and_thread_disappears_when_empty(self, db):
        page = db.add_page()
        t = new_thread(page, "Root")
        r = run(R.reply(page, t["id"], R.ReplyBody(body="Reply"), req(), "user"))
        run(R.delete_comment(page, t["id"], req(), "user"))
        [thread] = run(R.list_comments(page, req(), "all", "user"))["threads"]
        assert thread["comments"][0]["deleted"] is True and thread["comments"][0]["body"] == ""
        run(R.delete_comment(page, r["comment"]["id"], req(), "user"))
        assert run(R.list_comments(page, req(), "all", "user"))["threads"] == []

    def test_cannot_delete_someone_elses_comment_but_superadmin_can(self, db):
        page = db.add_page()
        t = new_thread(page, "Admin note", user=ROOT, role="superadmin")
        r = run(R.reply(page, t["id"], R.ReplyBody(body="mine"), req(), "user"))
        assert status_of(R.delete_comment(page, t["id"], req(), "user")) == 403
        assert run(R.delete_comment(page, r["comment"]["id"], req(ROOT, "superadmin"), "superadmin"))["ok"]

    def test_resolve_and_reopen(self, db):
        page = db.add_page()
        t = new_thread(page)
        done = run(R.resolve_thread(page, t["id"], req(), "user"))
        assert done["resolved_at"] and done["resolved_by"]["name"] == "Alice Rao"
        assert run(R.list_comments(page, req(), "open", "user"))["threads"] == []
        assert len(run(R.list_comments(page, req(), "resolved", "user"))["threads"]) == 1
        back = run(R.reopen_thread(page, t["id"], req(), "user"))
        assert back["resolved_at"] is None

    def test_reply_reopens_a_resolved_thread(self, db):
        page = db.add_page()
        t = new_thread(page)
        run(R.resolve_thread(page, t["id"], req(), "user"))
        out = run(R.reply(page, t["id"], R.ReplyBody(body="One more thing"), req(), "user"))
        assert out["thread"]["resolved_at"] is None

    def test_reply_to_a_reply_is_not_a_thread(self, db):
        page = db.add_page()
        t = new_thread(page)
        r = run(R.reply(page, t["id"], R.ReplyBody(body="r"), req(), "user"))
        assert status_of(R.reply(page, r["comment"]["id"], R.ReplyBody(body="x"), req(), "user")) == 404
        other = db.add_page()
        assert status_of(R.reply(other, t["id"], R.ReplyBody(body="x"), req(), "user")) == 404


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------

class TestPermissions:
    def test_other_users_cannot_read_or_write(self, db):
        page = db.add_page(owner=ALICE)
        t = new_thread(page)
        assert status_of(R.list_comments(page, req(BOB), "all", "user")) == 403
        assert status_of(R.create_thread(page, R.NewThreadBody(body="hi"), req(BOB), "user")) == 403
        assert status_of(R.reply(page, t["id"], R.ReplyBody(body="hi"), req(BOB), "user")) == 403
        assert status_of(R.resolve_thread(page, t["id"], req(BOB), "user")) == 403
        assert status_of(R.mention_search(page, req(BOB), "", "user")) == 403

    def test_superadmin_can_comment_on_any_page(self, db):
        page = db.add_page(owner=BOB)
        assert new_thread(page, "Checked", user=ROOT, role="superadmin")["comments"][0]["body"] == "Checked"

    def test_writes_need_a_signed_in_account(self, db):
        page = db.add_page()
        assert status_of(R.create_thread(page, R.NewThreadBody(body="hi"), req(None, "superadmin"), "superadmin")) == 400

    def test_missing_page_is_404(self, db):
        assert status_of(R.list_comments(str(uuid.uuid4()), req(), "all", "user")) == 404

    def test_no_public_route(self):
        paths = [r.path for r in R.router.routes]
        assert all(not p.startswith("/api/public") for p in paths)


# ---------------------------------------------------------------------------
# Mentions -> notifications
# ---------------------------------------------------------------------------

class TestMentions:
    def test_search_lists_people_who_can_open_the_page(self, db):
        page = db.add_page(owner=ALICE)
        names = {p["name"] for p in run(R.mention_search(page, req(), "", "user"))}
        assert names == {"Alice Rao", "Root Admin"}          # not Bob, not disabled Carol
        assert [p["name"] for p in run(R.mention_search(page, req(), "root", "user"))] == ["Root Admin"]

    def test_mention_creates_a_notification_and_queues_mail(self, db):
        page = db.add_page(owner=ALICE)
        t = new_thread(page, f"Please check @[Rooty]({ROOT}) and @[Bob]({BOB}) and @[Me]({ALICE})")
        body = t["comments"][0]["body"]
        # The server's name replaces the typed one; Bob cannot open the page,
        # so his token falls back to text; self-mentions notify nobody.
        assert f"@[Root Admin]({ROOT})" in body and "@Bob" in body and f"({BOB})" not in body
        assert [(n["user_id"], n["kind"]) for n in db.notifications] == [(ROOT, "mention")]
        assert len(db.queued_mail) == 1
        payload = json.loads(db.notifications[0]["payload"])
        assert payload["page_title"] == "Plan" and payload["excerpt"].startswith("Please check @Root Admin")

    def test_reply_notifies_thread_participants(self, db):
        page = db.add_page(owner=ALICE)
        t = new_thread(page, "Started", user=ROOT, role="superadmin")
        run(R.reply(page, t["id"], R.ReplyBody(body="Answer"), req(), "user"))
        assert [(n["user_id"], n["kind"]) for n in db.notifications] == [(ROOT, "reply")]

    def test_edit_notifies_only_new_mentions(self, db):
        page = db.add_page(owner=ALICE)
        t = new_thread(page, f"cc @[R]({ROOT})")
        cid = t["comments"][0]["id"]
        run(R.edit_comment(page, cid, R.EditBody(body=f"cc @[R]({ROOT}) again"), req(), "user"))
        assert len(db.notifications) == 1

    def test_bell_flow_list_count_mark_read(self, db):
        page = db.add_page(owner=ALICE)
        new_thread(page, f"one @[R]({ROOT})")
        new_thread(page, f"two @[R]({ROOT})")
        root = req(ROOT, "superadmin")
        assert run(R.unread_count(root, "superadmin")) == {"count": 2}
        listing = run(R.list_notifications(root, False, 30, "superadmin"))
        assert listing["unread"] == 2
        first = listing["items"][0]
        assert first["kind"] == "mention" and first["actor"]["name"] == "Alice Rao"
        assert first["page_id"] == page and first["page_title"] == "Plan" and first["thread_id"]
        assert first["excerpt"] == "two @Root Admin"
        assert run(R.mark_read(first["id"], root, "superadmin"))["unread"] == 1
        # Someone else's id does nothing to Root's notifications.
        run(R.mark_read(listing["items"][1]["id"], req(), "user"))
        assert run(R.unread_count(root, "superadmin")) == {"count": 1}
        assert run(R.mark_all_read(root, R.ReadAllBody(), "superadmin"))["unread"] == 0
        assert run(R.list_notifications(root, True, 30, "superadmin"))["items"] == []

    def test_deleting_a_comment_drops_its_notifications(self, db):
        page = db.add_page(owner=ALICE)
        t = new_thread(page, f"hey @[R]({ROOT})")
        run(R.delete_comment(page, t["id"], req(), "user"))
        assert db.notifications == []


class TestMentionEmail:
    def test_rate_limited_per_recipient(self, monkeypatch):
        import app.services.emailer as E
        sent = []

        async def fake_send(to, subject, text, html=None):
            sent.append((to, subject, html))
            return {"sent": True}

        async def allow(*a, **k):
            return True
        monkeypatch.setattr(E, "is_email_configured", lambda: True)
        monkeypatch.setattr(E, "send_email", fake_send)
        import app.db.valkey as V
        monkeypatch.setattr(V, "set_nx", allow)
        C._mail_sent.clear()
        who = [{"id": ROOT, "email": "root@x.in"}]
        assert run(C.send_mention_emails(who, "Alice <b>", "Plan", f"hi @[R]({ROOT})", "https://a/pages")) == 1
        assert run(C.send_mention_emails(who, "Alice", "Plan", "again", "")) == 0
        assert len(sent) == 1 and "Alice &lt;b&gt;" in sent[0][2] and sent[0][1] == "Alice <b> mentioned you on Plan"
        C._mail_sent.clear()

    def test_not_configured_sends_nothing(self, monkeypatch):
        import app.services.emailer as E
        monkeypatch.setattr(E, "is_email_configured", lambda: False)
        assert run(C.send_mention_emails([{"id": ROOT, "email": "r@x"}], "A", "P", "b", "")) == 0

    def test_mail_failure_never_raises(self, monkeypatch):
        import app.services.emailer as E

        async def boom(*a, **k):
            raise RuntimeError("smtp down")
        monkeypatch.setattr(E, "is_email_configured", lambda: True)
        monkeypatch.setattr(E, "send_email", boom)
        C._mail_sent.clear()
        assert run(C.send_mention_emails([{"id": BOB, "email": "b@x"}], "A", "P", "b", "")) == 0
        C._mail_sent.clear()


# ---------------------------------------------------------------------------
# Before migration 0005
# ---------------------------------------------------------------------------

class TestBeforeMigration:
    @pytest.fixture
    def cold(self, db):
        db.ready = False
        C.reset_ready_cache()
        return db

    def test_reads_are_empty(self, cold):
        page = cold.add_page()
        out = run(R.list_comments(page, req(), "all", "user"))
        assert out == {"ready": False, "threads": [], "counts": {"open": 0, "resolved": 0}}
        assert run(R.unread_count(req(), "user")) == {"count": 0}
        assert run(R.list_notifications(req(), False, 30, "user"))["items"] == []

    def test_writes_are_503(self, cold):
        page = cold.add_page()
        tid = str(uuid.uuid4())
        assert status_of(R.create_thread(page, R.NewThreadBody(body="hi"), req(), "user")) == 503
        assert status_of(R.reply(page, tid, R.ReplyBody(body="hi"), req(), "user")) == 503
        assert status_of(R.resolve_thread(page, tid, req(), "user")) == 503
        assert status_of(R.mark_all_read(req(), R.ReadAllBody(), "user")) == 503

    def test_permissions_still_apply_before_the_migration(self, cold):
        page = cold.add_page(owner=ALICE)
        assert status_of(R.list_comments(page, req(BOB), "all", "user")) == 403

    def test_readiness_check_never_raises(self):
        C.reset_ready_cache()

        class Broken:
            async def fetchval(self, *a):
                raise RuntimeError("no db")
        assert run(C.comments_ready(Broken())) is False
        C.reset_ready_cache()


class TestTextHelpers:
    def test_mention_ids_dedupe_and_validate(self):
        body = f"@[A]({ROOT}) @[A again]({ROOT}) @[x](not-a-uuid-not-a-uuid-not-a-uuid-xxxx)"
        assert C.mention_ids(body) == [ROOT]

    def test_keep_mentions_cleans_names(self):
        out = C.keep_mentions(f"@[x]({ROOT})", {ROOT: "Evil](javascript:x)"})
        assert out == f"@[Eviljavascript:x]({ROOT})"
