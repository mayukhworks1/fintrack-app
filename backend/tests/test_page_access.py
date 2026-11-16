"""
"Request the password" for published pages and artifacts (routers/page_access.py).

The same cases as the shared view flow (tests/test_share_access.py), for pages:

  * a page password is stored as the hash plus a MultiFernet copy, on create
    and on every change; neither appears in an API answer; "show password"
    is the owner's alone; a password set before copies were kept says so
  * the visitor's request: stored, validated, honeypot, duplicates, per-IP
    limits, missing / unpublished / unprotected / expired pages
  * the owner and superadmins are told in the app and by email, with signed
    Approve / Deny links that confirm before acting
  * approval emails the current password; without a mailer, or when sending
    fails, the owner gets it; a password that predates copies asks to be set
    again, or is approved by hand
  * auto-approve domains (exact, off by default), audit rows; migration 0012

Tests that need Postgres skip without one (tests/pg_harness.py).
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request

import app.routers.deps as deps
import app.routers.page_access as PA
import app.routers.pages as RP
import app.routers.shared_views as R
import app.services.shared_views as S
from app.services import share_access as SA
from tests import pg_harness

PW = "Page-secret-1!"


def _app():
    async def fake_auth(request: Request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "Missing authorization token")
        request.state.auth_user_id = uid
        request.state.auth_role = request.headers.get("x-test-role", "user")
        request.state.is_email_auth = False
        return "editor"

    app = FastAPI()
    app.include_router(R.router)
    app.include_router(RP.router)
    app.include_router(PA.router)
    app.dependency_overrides[deps.require_auth] = fake_auth
    return app


class Mail:
    def __init__(self):
        self.sent: list[dict] = []
        self.configured = True
        self.fail = False

    async def send(self, to, subject, text, html_body):
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html_body})
        return {"sent": not self.fail, **({"reason": "brevo_error"} if self.fail else {})}

    def to(self, addr):
        return [m for m in self.sent if m["to"] == addr]


@pytest.fixture
def env(pg, monkeypatch):
    from app.db import valkey
    monkeypatch.setattr(valkey, "_client", None)
    SA.reset_rate_limits()
    getter = lambda: pg._pool  # noqa: E731
    for mod in (S, R, PA):
        monkeypatch.setattr(mod, "get_pool", getter)
    mail = Mail()
    monkeypatch.setattr(SA, "send_mail", mail.send)
    monkeypatch.setattr(SA, "mailer_configured", lambda: mail.configured)
    pg.app = _app()
    pg.mail = mail
    pg.owner = pg.user("Owner")
    pg.other = pg.user("Someone else")
    pg.admin = pg.user("Admin")
    pg.sql("INSERT INTO auth_user_roles (user_id, role_id) SELECT $1::uuid, id FROM auth_roles WHERE role_key = 'superadmin'",
           pg.admin)
    yield pg
    SA.reset_rate_limits()


def call(env, fn, ip="198.51.100.7"):
    async def main(pool):
        transport = httpx.ASGITransport(app=env.app, client=(ip, 1234))
        async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as c:
            return await fn(c)
    return env.run(main)


def O(env):
    return {"X-Test-User": env.owner}


async def make_page(env, c, *, password=PW, publish=True, title="Q3 plan"):
    res = await c.post("/api/pages/", headers=O(env), json={
        "title": title, "content_type": "artifact", "content": "<!DOCTYPE html><html><body>hi</body></html>",
        "is_password_protected": bool(password), "password": password})
    assert res.status_code == 200, res.text
    page = res.json()
    if publish:
        pub = await c.post(f"/api/pages/{page['id']}/publish", headers=O(env), json={"published": True})
        assert pub.status_code == 200, pub.text
    return page


def ask(c, slug, **body):
    return c.post(f"/api/public/pages/{slug}/access-request",
                  json={"name": "Ana Lee", "email": "ana@acme.com", "message": "For the board pack", **body},
                  headers={"Origin": "https://app.test"})


def audit_types(env):
    return [r["event_type"] for r in env.sql("SELECT event_type FROM auth_events ORDER BY id")]


def requests_rows(env):
    return env.sql("SELECT * FROM shared_view_access_requests ORDER BY created_at")


def owner_email(env):
    return env.sql("SELECT email FROM auth_users WHERE id = $1::uuid", env.owner)[0][0]


# ===========================================================================
# Migration 0012
# ===========================================================================

class TestMigration0012:
    PATH = pg_harness.BACKEND / "migrations/versions/0012_page_access_requests.py"

    def test_up_down_up(self, pg_upto):
        env = pg_upto("0011_shared_view_access")
        owner = env.user()
        pid = env.page(owner, "Old page")
        env.sql("INSERT INTO shared_views (token, created_by) VALUES ('oldlink', 'editor')")
        env.sql("INSERT INTO shared_view_access_requests (view_token, name, email) VALUES ('oldlink', 'A', 'a@b.co')")
        up = pg_harness.migration_statements(self.PATH)
        down = pg_harness.migration_statements(self.PATH, "downgrade")
        for s in up:
            env.execute(s)
        row = env.sql("SELECT password_enc, auto_approve_domains FROM published_pages WHERE id = $1", pid)[0]
        assert row["password_enc"] is None and row["auto_approve_domains"] == "[]"
        env.sql("INSERT INTO shared_view_access_requests (page_id, name, email) VALUES ($1, 'B', 'b@b.co')", pid)
        # Exactly one of view_token / page_id.
        with pytest.raises(Exception):
            env.sql("INSERT INTO shared_view_access_requests (name, email) VALUES ('C', 'c@b.co')")
        with pytest.raises(Exception):
            env.sql("INSERT INTO shared_view_access_requests (view_token, page_id, name, email) "
                    "VALUES ('oldlink', $1, 'C', 'c@b.co')", pid)
        env.sql("DELETE FROM published_pages WHERE id = $1", pid)            # cascades to its requests
        assert env.sql("SELECT COUNT(*) FROM shared_view_access_requests")[0][0] == 1
        env.sql("INSERT INTO published_pages (slug, title) VALUES ('p2', 'P2')")
        p2 = env.sql("SELECT id FROM published_pages WHERE slug = 'p2'")[0][0]
        env.sql("INSERT INTO shared_view_access_requests (page_id, name, email) VALUES ($1, 'D', 'd@b.co')", p2)
        for s in down:
            env.execute(s)
        cols = {r[0] for r in env.sql(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'published_pages'")}
        assert not {"password_enc", "auto_approve_domains"} & cols
        # Page requests go with the column; shared view requests stay.
        assert env.sql("SELECT COUNT(*) FROM shared_view_access_requests")[0][0] == 1
        for s in up:
            env.execute(s)


# ===========================================================================
# Password storage
# ===========================================================================

class TestPasswordStorage:
    def test_create_and_change_store_hash_and_ciphertext_never_returned(self, env):
        async def go(c):
            page = await make_page(env, c)
            got = (await c.get(f"/api/pages/{page['id']}", headers=O(env))).json()
            first = await env._pool.fetchrow("SELECT password_hash, password_enc FROM published_pages")
            changed = await c.put(f"/api/pages/{page['id']}", headers=O(env),
                                  json={"is_password_protected": True, "password": "Changed-pass-2"})
            return page, got, first, changed.json()
        page, got, first, changed = call(env, go)
        for payload in (page, got, changed):
            text = str(payload)
            assert PW not in text and "password_hash" not in text and "password_enc" not in text
            assert "auto_approve_domains" not in text
        assert first["password_hash"] == SA.hash_password(PW)
        assert PW not in first["password_enc"] and SA.decrypt_password(first["password_enc"]) == PW
        row = env.sql("SELECT password_hash, password_enc FROM published_pages")[0]
        assert row["password_hash"] == SA.hash_password("Changed-pass-2")
        assert SA.decrypt_password(row["password_enc"]) == "Changed-pass-2"

    def test_visitor_check_still_uses_the_hash(self, env):
        async def go(c):
            page = await make_page(env, c)
            bad = await c.post(f"/api/public/pages/{page['slug']}/verify", json={"password": "nope"})
            ok = await c.post(f"/api/public/pages/{page['slug']}/verify", json={"password": PW})
            return bad, ok
        bad, ok = call(env, go)
        assert bad.status_code == 401 and ok.status_code == 200 and ok.json()["render_token"]

    def test_show_password_is_the_owners_and_audited(self, env):
        async def go(c):
            page = await make_page(env, c)
            pid = page["id"]
            shown = await c.get(f"/api/pages/{pid}/password", headers=O(env))
            other = await c.get(f"/api/pages/{pid}/password", headers={"X-Test-User": env.other})
            admin = await c.get(f"/api/pages/{pid}/password",
                                headers={"X-Test-User": env.admin, "X-Test-Role": "superadmin"})
            anon = await c.get(f"/api/pages/{pid}/password")
            return shown, other, admin, anon
        shown, other, admin, anon = call(env, go)
        assert shown.json() == {"password": PW, "is_password_protected": True}
        assert other.status_code == 403 and admin.json()["password"] == PW and anon.status_code == 401
        assert "page_password.revealed" in audit_types(env)

    def test_a_password_set_before_copies_were_kept(self, env):
        async def go(c):
            page = await make_page(env, c)
            env_page = page["id"]
            await c.get("/api/pages/", headers=O(env))
            return env_page
        pid = call(env, go)
        env.sql("UPDATE published_pages SET password_enc = NULL WHERE id = $1", pid)

        async def go2(c):
            return (await c.get(f"/api/pages/{pid}/password", headers=O(env)),
                    await c.get(f"/api/pages/{pid}/access", headers=O(env)))
        shown, summary = call(env, go2)
        assert shown.status_code == 409 and shown.json()["detail"]["code"] == "password_not_stored"
        assert summary.json()["is_password_protected"] is True and summary.json()["password_stored"] is False


class TestAccessSettings:
    def test_summary_and_auto_approve_domains(self, env):
        async def go(c):
            page = await make_page(env, c)
            pid = page["id"]
            before = (await c.get(f"/api/pages/{pid}/access", headers=O(env))).json()
            saved = await c.put(f"/api/pages/{pid}/access", headers=O(env),
                                json={"auto_approve_domains": ["TheWorks.in", "@acme.co.uk", ""]})
            bad = await c.put(f"/api/pages/{pid}/access", headers=O(env), json={"auto_approve_domains": ["nope"]})
            other = await c.put(f"/api/pages/{pid}/access", headers={"X-Test-User": env.other},
                                json={"auto_approve_domains": []})
            return before, saved, bad, other
        before, saved, bad, other = call(env, go)
        assert before == {"is_password_protected": True, "password_stored": True, "auto_approve_domains": [],
                          "pending": 0, "mailer_configured": True}
        assert saved.json()["auto_approve_domains"] == ["theworks.in", "acme.co.uk"]
        assert bad.status_code == 400 and other.status_code == 403
        assert "share_access.auto_domains_changed" in audit_types(env)


# ===========================================================================
# The visitor's request
# ===========================================================================

class TestRequests:
    def test_stored_owner_and_superadmin_told_and_audited(self, env):
        async def go(c):
            page = await make_page(env, c)
            res = await ask(c, page["slug"])
            dup = await ask(c, page["slug"])
            return page, res, dup
        page, res, dup = call(env, go)
        assert res.status_code == 202 and dup.json() == res.json() == SA.REQUEST_ACCEPTED
        rows = requests_rows(env)
        assert len(rows) == 1
        r = rows[0]
        assert (str(r["page_id"]), r["view_token"], r["name"], r["email"], r["message"], r["status"], r["ip"]) == \
            (page["id"], None, "Ana Lee", "ana@acme.com", "For the board pack", "pending", "198.51.100.7")
        notes = env.sql("SELECT user_id::text AS u, kind, payload FROM notifications")
        assert {n["u"] for n in notes} == {env.owner, env.admin} and {n["kind"] for n in notes} == {"access_request"}
        assert '"page_id": "%s"' % page["id"] in notes[0]["payload"] and '"resource_type": "page"' in notes[0]["payload"]
        mails = env.mail.to(owner_email(env))
        assert len(mails) == 1
        m = mails[0]
        assert "Ana Lee" in m["subject"] and "Q3 plan" in m["subject"]
        assert "/api/public/view-access/decide?" in m["text"] and PW not in m["text"] + m["html"]
        assert "published page" in m["html"]
        assert "share_access.requested" in audit_types(env)

    def test_validation_and_honeypot(self, env):
        async def go(c):
            slug = (await make_page(env, c))["slug"]
            return (await ask(c, slug, email="ana@acme"), await ask(c, slug, name="  "),
                    await ask(c, slug, message="x" * 1001), await ask(c, slug, website="http://spam"))
        bad, noname, long_msg, honey = call(env, go)
        assert bad.status_code == 422 and "email" in bad.json()["detail"]["fields"]
        assert noname.status_code == 422 and "name" in noname.json()["detail"]["fields"]
        assert long_msg.status_code == 422 and "message" in long_msg.json()["detail"]["fields"]
        assert honey.status_code == 202 and honey.json() == SA.REQUEST_ACCEPTED
        assert requests_rows(env) == [] and env.mail.sent == []

    def test_missing_unpublished_unprotected_and_expired_pages(self, env):
        async def go(c):
            draft = await make_page(env, c, publish=False, title="Draft")
            open_ = await make_page(env, c, password=None, title="Open")
            expiring = await make_page(env, c, title="Expiring")
            env_ids = expiring["id"]
            return draft, open_, expiring, env_ids
        draft, open_, expiring, eid = call(env, go)
        env.sql("UPDATE published_pages SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1", eid)

        async def go2(c):
            return (await ask(c, "no-such-page"), await ask(c, draft["slug"]), await ask(c, open_["slug"]),
                    await ask(c, expiring["slug"]))
        missing, unpublished, unprotected, expired = call(env, go2)
        assert missing.status_code == 404 and unpublished.status_code == 404 and unprotected.status_code == 404
        assert expired.status_code == 410
        assert requests_rows(env) == []

    def test_rate_limits(self, env, monkeypatch):
        monkeypatch.setattr(SA, "REQUEST_LIMIT_PER_IP", (2, 3600))

        async def go(c):
            slug = (await make_page(env, c))["slug"]
            return [(await ask(c, slug, email=f"p{i}@acme.com")).status_code for i in range(3)]
        assert call(env, go) == [202, 202, 429]

    def test_auto_approve_domain_sends_at_once(self, env):
        async def go(c):
            page = await make_page(env, c)
            await c.put(f"/api/pages/{page['id']}/access", headers=O(env), json={"auto_approve_domains": ["theworks.in"]})
            await ask(c, page["slug"], email="ravi@theworks.in", name="Ravi")
            await ask(c, page["slug"], email="eve@evil-theworks.in", name="Eve")
            return page
        page = call(env, go)
        rows = {r["email"]: r for r in requests_rows(env)}
        assert rows["ravi@theworks.in"]["status"] == "approved" and rows["ravi@theworks.in"]["decided_via"] == "auto"
        assert rows["ravi@theworks.in"]["sent_at"] is not None
        assert rows["eve@evil-theworks.in"]["status"] == "pending"
        sent = env.mail.to("ravi@theworks.in")
        assert len(sent) == 1 and PW in sent[0]["html"] and f"https://app.test/p/{page['slug']}" in sent[0]["text"]
        assert "Open the page" in sent[0]["html"]
        assert env.mail.to("eve@evil-theworks.in") == []

    def test_off_by_default(self, env):
        async def go(c):
            await ask(c, (await make_page(env, c))["slug"], email="ravi@theworks.in")
        call(env, go)
        assert requests_rows(env)[0]["status"] == "pending" and env.mail.to("ravi@theworks.in") == []

    def test_page_requests_stay_out_of_the_links_list(self, env):
        async def go(c):
            await ask(c, (await make_page(env, c))["slug"])
            return (await c.get("/api/shared-views/access-requests",
                                headers={"X-Test-User": env.admin, "X-Test-Role": "superadmin"})).status_code
        call(env, go)
        rows = env.sql("SELECT COUNT(*) FROM shared_view_access_requests r JOIN shared_views v ON v.token = r.view_token")
        assert rows[0][0] == 0


# ===========================================================================
# Decisions
# ===========================================================================

class TestDecisions:
    async def _setup(self, env, c):
        page = await make_page(env, c)
        await ask(c, page["slug"])
        rid = str(await env._pool.fetchval("SELECT id FROM shared_view_access_requests ORDER BY created_at DESC LIMIT 1"))
        return page, rid

    def test_list_and_approve_sends_the_current_password(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            pid = page["id"]
            await c.put(f"/api/pages/{pid}", headers=O(env), json={"is_password_protected": True, "password": "Newer-pass-3"})
            listing = (await c.get(f"/api/pages/{pid}/access-requests", headers=O(env))).json()
            other = await c.get(f"/api/pages/{pid}/access-requests", headers={"X-Test-User": env.other})
            res = await c.post(f"/api/pages/{pid}/access-requests/{rid}/approve", headers=O(env), json={})
            again = await c.post(f"/api/pages/{pid}/access-requests/{rid}/approve", headers=O(env), json={})
            return page, listing, other, res, again
        page, listing, other, res, again = call(env, go)
        assert listing["pending"] == 1 and listing["requests"][0]["view_title"] == "Q3 plan"
        assert listing["requests"][0]["page_id"] == page["id"] and other.status_code == 403
        body = res.json()
        assert res.status_code == 200 and body["sent"] is True and "password" not in body
        mail = env.mail.to("ana@acme.com")[-1]
        assert "Newer-pass-3" in mail["html"] and PW not in mail["html"]
        assert f"https://app.test/p/{page['slug']}" in mail["text"]
        assert again.status_code == 409
        row = requests_rows(env)[0]
        assert (row["status"], str(row["decided_by"]), row["decided_via"]) == ("approved", env.owner, "app")
        assert {"share_access.approved", "share_access.sent"} <= set(audit_types(env))

    def test_a_request_of_another_page_is_not_found_here(self, env):
        async def go(c):
            _, rid = await self._setup(env, c)
            mine = await make_page(env, c, title="Another")
            return await c.post(f"/api/pages/{mine['id']}/access-requests/{rid}/approve", headers=O(env), json={})
        assert call(env, go).status_code == 404
        assert requests_rows(env)[0]["status"] == "pending"

    def test_without_a_mailer_the_owner_gets_the_password(self, env):
        env.mail.configured = False

        async def go(c):
            page, rid = await self._setup(env, c)
            return page, await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env), json={})
        page, res = call(env, go)
        body = res.json()
        assert body["sent"] is False and body["reason"] == "email_not_configured"
        assert body["password"] == PW and body["url"].endswith(f"/p/{page['slug']}")
        assert env.mail.sent == [] and "share_access.send_skipped" in audit_types(env)

    def test_send_failure_falls_back_to_the_owner(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            env.mail.fail = True
            return await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env), json={})
        body = call(env, go).json()
        assert body["sent"] is False and body["password"] == PW
        assert "share_access.send_failed" in audit_types(env)

    def test_deny_with_a_note(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            return await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/deny", headers=O(env),
                                json={"note": "Please ask Priya directly."})
        res = call(env, go)
        assert res.status_code == 200 and res.json()["status"] == "denied"
        mail = env.mail.to("ana@acme.com")[-1]
        assert "Please ask Priya directly." in mail["html"] and PW not in mail["html"]
        assert "share_access.denied" in audit_types(env)

    def test_old_password_asks_to_be_set_again_or_shared_by_hand(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            await env._pool.execute("UPDATE published_pages SET password_enc = NULL WHERE id = $1", page["id"])
            refused = await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env), json={})
            still = await env._pool.fetchval("SELECT status FROM shared_view_access_requests WHERE id = $1::uuid", rid)
            manual = await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env),
                                  json={"manual": True})
            return refused, still, manual
        refused, still, manual = call(env, go)
        assert refused.status_code == 409
        detail = refused.json()["detail"]
        assert detail["code"] == "password_not_stored" and "Set the password again" in detail["message"]
        assert still == "pending"
        body = manual.json()
        assert manual.status_code == 200 and body["status"] == "approved" and body["sent"] is False
        assert body["reason"] == "manual" and body["password"] is None
        assert env.mail.to("ana@acme.com") == []

    def test_setting_the_password_again_makes_it_emailable(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            await env._pool.execute("UPDATE published_pages SET password_enc = NULL WHERE id = $1", page["id"])
            await c.put(f"/api/pages/{page['id']}", headers=O(env), json={"is_password_protected": True, "password": PW})
            return await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env), json={})
        assert call(env, go).json()["sent"] is True
        assert PW in env.mail.to("ana@acme.com")[-1]["html"]

    def test_unpublished_page_cannot_be_approved(self, env):
        async def go(c):
            page, rid = await self._setup(env, c)
            await c.post(f"/api/pages/{page['id']}/publish", headers=O(env), json={"published": False})
            return await c.post(f"/api/pages/{page['id']}/access-requests/{rid}/approve", headers=O(env), json={})
        res = call(env, go)
        assert res.status_code == 409 and "not published" in res.text

    def test_email_links_confirm_then_act(self, env):
        async def go(c):
            await self._setup(env, c)
            owner_mail = [m for m in env.mail.sent if "/decide?" in m["text"]][0]
            approve = [ln.split(": ", 1)[1] for ln in owner_mail["text"].splitlines() if ln.startswith("Approve")][0]
            u = urlparse(approve)
            url = f"{u.path}?{u.query}"
            page = await c.get(url)
            after_get = await env._pool.fetchval("SELECT status FROM shared_view_access_requests")
            done = await c.post(url)
            replay = await c.post(url)
            q = parse_qs(u.query)
            tampered = await c.post(f"{u.path}?r={q['r'][0]}&a=deny&e={q['e'][0]}&s={q['s'][0]}")
            return page, after_get, done, replay, tampered
        page, after_get, done, replay, tampered = call(env, go)
        assert page.status_code == 200 and "Send the password?" in page.text and "Q3 plan" in page.text
        assert 'method="post"' in page.text and after_get == "pending"
        assert done.status_code == 200 and "Password sent" in done.text
        assert "Already approved" in replay.text and tampered.status_code == 400
        assert requests_rows(env)[0]["decided_via"] == "email"
        assert PW in env.mail.to("ana@acme.com")[-1]["html"]

    def test_expired_email_link(self, env):
        async def go(c):
            _, rid = await self._setup(env, c)
            return await c.post("/api/public/view-access/decide", params=SA.action_params(rid, "deny", ttl=-10))
        res = call(env, go)
        assert res.status_code == 410 and requests_rows(env)[0]["status"] == "pending"
