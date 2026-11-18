"""
Password-protected shared view links and "request the password".

  * the password is stored as the published pages hash plus a MultiFernet
    copy that decrypts back to it; neither ever appears in an API answer
  * unlock tokens: right password only, scoped to the link, refused once the
    password changes, expired and tampered tokens refused; the data, edit and
    event endpoints all refuse a protected link without one
  * per-IP / per-link limits on unlock and on requests, and the honeypot
  * strict email validation
  * signed Approve / Deny links: expiry, tampering, wrong action; the GET is
    only a confirmation page, the POST acts
  * domain auto-approve (exact domains only, off by default)
  * the mailer gets the right content (mocked), and without a mailer the
    owner gets the password to pass on
  * audit rows for every request, decision and send; migration 0011 both ways

Tests that need Postgres skip without one (tests/pg_harness.py).
"""

from __future__ import annotations

import time
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request

import app.routers.deps as deps
import app.routers.shared_views as R
import app.services.shared_views as S
from app.services import share_access as SA
from tests import pg_harness


# ===========================================================================
# Unit: hashing, encryption, tokens, signatures, validation
# ===========================================================================

class TestPasswordStorage:
    def test_hash_is_the_pages_scheme(self):
        from app.routers.pages import _hash_password
        assert SA.password_matches("correct horse 9!", _hash_password("correct horse 9!"))
        assert SA.password_matches("correct horse 9!", SA.hash_password("correct horse 9!"))
        assert not SA.password_matches("correct horse 9", SA.hash_password("correct horse 9!"))
        assert not SA.password_matches("anything", None)

    def test_encryption_round_trip_and_ciphertext_hides_the_password(self):
        enc = SA.encrypt_password("Tr0ub4dor&3xyz")
        assert "Tr0ub4dor" not in enc
        assert SA.decrypt_password(enc) == "Tr0ub4dor&3xyz"
        assert SA.encrypt_password("Tr0ub4dor&3xyz") != enc          # Fernet is randomised
        assert SA.decrypt_password("not-a-token") is None
        assert SA.decrypt_password(None) is None

    def test_password_columns(self):
        cols = SA.password_columns("s3cret-pass")
        assert SA.password_matches("s3cret-pass", cols["password_hash"])
        assert SA.decrypt_password(cols["password_enc"]) == "s3cret-pass"
        assert SA.password_columns(None) == {"password_hash": None, "password_enc": None}

    @pytest.mark.parametrize("bad", ["short", "x" * 129, "line\nbreak1", 12345678])
    def test_password_rules(self, bad):
        with pytest.raises(ValueError):
            SA.validate_password(bad)


class TestUnlockTokens:
    def test_valid_only_for_its_link_and_version(self):
        t = SA.unlock_token("tokA", 3)
        assert SA.unlock_token_valid("tokA", 3, t)
        assert not SA.unlock_token_valid("tokB", 3, t)
        assert not SA.unlock_token_valid("tokA", 4, t)       # password changed

    def test_expired_and_tampered(self):
        assert not SA.unlock_token_valid("tokA", 0, SA.unlock_token("tokA", 0, ttl=-5))
        t = SA.unlock_token("tokA", 0)
        exp, _, sig = t.partition(".")
        assert not SA.unlock_token_valid("tokA", 0, f"{int(exp) + 9999}.{sig}")
        assert not SA.unlock_token_valid("tokA", 0, f"{exp}.{'0' * len(sig)}")
        for junk in (None, "", "abc", "x.y"):
            assert not SA.unlock_token_valid("tokA", 0, junk)

    def test_not_interchangeable_with_a_page_render_token(self):
        from app.routers.pages import _render_token
        assert not SA.unlock_token_valid("same-slug", 0, _render_token("same-slug"))

    def test_require_unlocked(self):
        open_view = {"token": "t", "is_password_protected": False}
        SA.require_unlocked(open_view, None)
        locked = {"token": "t", "is_password_protected": True, "password_version": 2}
        with pytest.raises(SA.PasswordRequired):
            SA.require_unlocked(locked, None)
        SA.require_unlocked(locked, SA.unlock_token("t", 2))


class TestSignedActionLinks:
    def test_round_trip(self):
        p = SA.action_params("11111111-1111-1111-1111-111111111111", "approve")
        assert SA.verify_action(p["r"], p["a"], p["e"], p["s"]) == "ok"

    def test_tampering(self):
        p = SA.action_params("11111111-1111-1111-1111-111111111111", "approve")
        assert SA.verify_action(p["r"], "deny", p["e"], p["s"]) == "invalid"
        assert SA.verify_action("22222222-2222-2222-2222-222222222222", "approve", p["e"], p["s"]) == "invalid"
        assert SA.verify_action(p["r"], "approve", str(int(p["e"]) + 60), p["s"]) == "invalid"
        assert SA.verify_action(p["r"], "approve", p["e"], "f" * 64) == "invalid"
        assert SA.verify_action(p["r"], "delete", p["e"], p["s"]) == "invalid"
        assert SA.verify_action(p["r"], "approve", "soon", p["s"]) == "invalid"

    def test_expiry(self):
        p = SA.action_params("11111111-1111-1111-1111-111111111111", "deny", ttl=-1)
        assert SA.verify_action(p["r"], p["a"], p["e"], p["s"]) == "expired"


class TestEmailValidation:
    @pytest.mark.parametrize("good,normal", [
        ("ana@theworks.in", "ana@theworks.in"),
        ("  Ana.Lee+share@Mail.TheWorks.IN ", "Ana.Lee+share@mail.theworks.in"),
        ("o'neil@example.co.uk", "o'neil@example.co.uk"),
        ("x@xn--80ak6aa92e.com", "x@xn--80ak6aa92e.com"),
    ])
    def test_accepts(self, good, normal):
        assert SA.validate_email(good) == normal

    @pytest.mark.parametrize("bad", [
        "", "plain", "a@b", "a@b.c", "@x.com", "a@.com", "a..b@x.com", ".a@x.com", "a.@x.com",
        "a@x..com", "a@-x.com", "a@x-.com", "a b@x.com", "a@x.com\r\nBcc: v@x.com", "a@[127.0.0.1]",
        '"q"@x.com', "a@@x.com", "a@x.c0m", "a@x.123", ("a" * 65) + "@x.com", "a@" + ("b" * 250) + ".com",
        None, 42,
    ])
    def test_rejects(self, bad):
        with pytest.raises(ValueError):
            SA.validate_email(bad)


class TestDomains:
    def test_normalize(self):
        assert SA.normalize_domains(["TheWorks.in", "@theworks.in", " acme.co.uk ", ""]) == ["theworks.in", "acme.co.uk"]
        assert SA.normalize_domains("theworks.in, acme.com") == ["theworks.in", "acme.com"]
        assert SA.normalize_domains(None) == []
        for bad in (["not a domain"], ["localhost"], ["x.1"], [5]):
            with pytest.raises(ValueError):
                SA.normalize_domains(bad)

    def test_exact_match_only(self):
        assert SA.domain_auto_approved("ana@theworks.in", ["theworks.in"])
        assert SA.domain_auto_approved("ana@THEWORKS.in", ["theworks.in"])
        assert not SA.domain_auto_approved("ana@evil-theworks.in", ["theworks.in"])
        assert not SA.domain_auto_approved("ana@theworks.in.evil.com", ["theworks.in"])
        assert not SA.domain_auto_approved("ana@mail.theworks.in", ["theworks.in"])
        assert not SA.domain_auto_approved("ana@theworks.in", [])


class TestLocalRateLimit:
    def test_window(self, monkeypatch):
        import asyncio
        from app.db import valkey
        monkeypatch.setattr(valkey, "_client", None)
        SA.reset_rate_limits()

        async def go():
            return [await SA.rate_ok("k", 3, 60) for _ in range(5)]
        assert asyncio.run(go()) == [True, True, True, False, False]
        SA.reset_rate_limits()


class TestEmailContent:
    def test_owner_email_escapes_visitor_input(self):
        subject, text, body = SA.owner_email(
            link_title="Q3 <invoices>", name="<script>x</script>", email="a@b.com", message="hi <b>",
            approve_href="https://api/a?x=1&y=2", deny_href="https://api/d", review_href="", to_email="o@x.com")
        assert "<script>" not in body and "&lt;script&gt;" in body
        assert "Approve &amp; send password" in body and "https://api/a?x=1&amp;y=2" in body
        assert "https://api/a?x=1&y=2" in text

    def test_approved_email_has_link_password_and_expiry(self):
        _, text, body = SA.approved_email(link_title="Board", name="Ana", url="https://app/view/tok",
                                          password="Pw-123456!", expires_at="2026-12-01T10:00:00+00:00",
                                          to_email="ana@x.com")
        for part in ("https://app/view/tok", "Pw-123456!", "01 Dec 2026"):
            assert part in body and part in text


# ===========================================================================
# Against Postgres: the endpoints end to end
# ===========================================================================

def _app(env):
    async def fake_auth(request: Request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "Missing authorization token")
        request.state.auth_user_id = uid
        request.state.auth_role = "superadmin"
        request.state.is_email_auth = False
        return "editor"

    app = FastAPI()
    app.include_router(R.router)
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
    monkeypatch.setattr(S, "get_pool", getter)
    monkeypatch.setattr(R, "get_pool", getter)
    mail = Mail()
    monkeypatch.setattr(SA, "send_mail", mail.send)
    monkeypatch.setattr(SA, "mailer_configured", lambda: mail.configured)

    async def records(resource_type, ids):
        return [{"id": i, "fields": {"Client": "Acme", "Project": "Atlas", "Status": "In progress",
                                     "Short Status": "ok", "Current Status (Detailed)": "fine"}} for i in ids]
    monkeypatch.setattr(S, "_fetch_snapshot_records", records)

    async def no_log(self, *a, **k):
        return None
    monkeypatch.setattr(S.SharedViewService, "_log_access", no_log)

    pg.app = _app(pg)
    pg.mail = mail
    pg.owner = pg.user("Owner")
    pg.admin = pg.user("Admin")
    pg.sql("INSERT INTO auth_user_roles (user_id, role_id) SELECT $1::uuid, id FROM auth_roles WHERE role_key = 'superadmin'",
           pg.admin)
    yield pg
    SA.reset_rate_limits()


def call(env, fn):
    async def main(pool):
        transport = httpx.ASGITransport(app=env.app, client=("198.51.100.7", 1234))
        async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as c:
            return await fn(c)
    return env.run(main)


def O(env):
    return {"X-Test-User": env.owner}


def make_link(env, c, **extra):
    async def go():
        res = await c.post("/api/shared-views", headers=O(env), json={
            "title": "Atlas board", "record_ids": ["rec1", "rec2"], "resource_type": "status",
            "password": "Sup3r-secret!", **extra})
        assert res.status_code == 201, res.text
        return res.json()
    return go()


def audit_types(env):
    return [r["event_type"] for r in env.sql("SELECT event_type FROM auth_events ORDER BY id")]


class TestMigration0011:
    PATH = pg_harness.BACKEND / "migrations/versions/0011_shared_view_access.py"

    def test_up_down_up(self, pg_upto):
        env = pg_upto("0010_list_queries")
        env.sql("INSERT INTO shared_views (token, created_by) VALUES ('oldlink', 'editor')")
        up = pg_harness.migration_statements(self.PATH)
        down = pg_harness.migration_statements(self.PATH, "downgrade")
        for s in up:
            env.execute(s)
        row = env.sql("SELECT password_hash, password_version, auto_approve_domains FROM shared_views")[0]
        assert row["password_hash"] is None and row["password_version"] == 0 and row["auto_approve_domains"] == "[]"
        env.sql("INSERT INTO shared_view_access_requests (view_token, name, email) VALUES ('oldlink', 'A', 'a@b.co')")
        with pytest.raises(Exception):
            env.sql("INSERT INTO shared_view_access_requests (view_token, name, email, status) "
                    "VALUES ('oldlink', 'A', 'a@b.co', 'maybe')")
        env.sql("DELETE FROM shared_views WHERE token = 'oldlink'")         # cascades to requests
        assert env.sql("SELECT COUNT(*) FROM shared_view_access_requests")[0][0] == 0
        for s in down:
            env.execute(s)
        cols = {r[0] for r in env.sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'shared_views'")}
        assert not {"password_hash", "password_enc", "password_version", "owner_user_id"} & cols
        assert not env.sql("SELECT to_regclass('shared_view_access_requests')")[0][0]
        for s in up:
            env.execute(s)


class TestOwnerSide:
    def test_create_stores_only_hash_and_ciphertext_and_never_returns_them(self, env):
        async def go(c):
            view = await make_link(env, c, auto_approve_domains=["TheWorks.in"])
            listing = (await c.get("/api/shared-views", headers=O(env))).json()
            return view, listing
        view, listing = call(env, go)
        assert view["is_password_protected"] is True and view["auto_approve_domains"] == ["theworks.in"]
        for payload in (view, *listing["views"]):
            text = str(payload)
            assert "Sup3r-secret!" not in text and "password_hash" not in text and "password_enc" not in text
        row = env.sql("SELECT password_hash, password_enc, owner_user_id FROM shared_views")[0]
        assert SA.password_matches("Sup3r-secret!", row["password_hash"])
        assert SA.decrypt_password(row["password_enc"]) == "Sup3r-secret!"
        assert str(row["owner_user_id"]) == env.owner
        assert "share_password.set" in audit_types(env)

    def test_reveal_change_and_remove(self, env):
        async def go(c):
            view = await make_link(env, c)
            t = view["token"]
            shown = (await c.get(f"/api/shared-views/{t}/password", headers=O(env))).json()
            short = await c.patch(f"/api/shared-views/{t}", headers=O(env), json={"password": "short"})
            changed = await c.patch(f"/api/shared-views/{t}", headers=O(env), json={"password": "N3w-password!"})
            shown2 = (await c.get(f"/api/shared-views/{t}/password", headers=O(env))).json()
            removed = await c.patch(f"/api/shared-views/{t}", headers=O(env), json={"remove_password": True})
            shown3 = (await c.get(f"/api/shared-views/{t}/password", headers=O(env))).json()
            anon = await c.get(f"/api/shared-views/{t}/password")
            return shown, short, changed, shown2, removed, shown3, anon
        shown, short, changed, shown2, removed, shown3, anon = call(env, go)
        assert shown["password"] == "Sup3r-secret!"
        assert short.status_code == 400
        assert changed.json()["is_password_protected"] and shown2["password"] == "N3w-password!"
        assert removed.json()["is_password_protected"] is False and shown3["password"] is None
        assert anon.status_code == 401
        types = audit_types(env)
        assert {"share_password.revealed", "share_password.changed", "share_password.removed"} <= set(types)


class TestUnlockAndDataEndpoints:
    def test_data_needs_a_valid_unlock_token(self, env):
        async def go(c):
            view = await make_link(env, c, access_mode="edit")
            t = view["token"]
            out = {"locked": await c.get(f"/api/public/view/{t}")}
            out["bad_header"] = await c.get(f"/api/public/view/{t}", headers={"X-View-Token": "123.abc"})
            out["wrong"] = await c.post(f"/api/public/view/{t}/unlock", json={"password": "nope"})
            out["right"] = await c.post(f"/api/public/view/{t}/unlock", json={"password": "Sup3r-secret!"})
            ut = out["right"].json()["unlock_token"]
            out["open"] = await c.get(f"/api/public/view/{t}", headers={"X-View-Token": ut})
            out["edit_locked"] = await c.patch(f"/api/public/view/{t}/records/rec1", json={"status": "Done"})
            out["event_locked"] = await c.post(f"/api/public/view/{t}/event", json={"event_type": "record_detail"})
            out["event_ok"] = await c.post(f"/api/public/view/{t}/event?u={ut}", json={"event_type": "record_detail"})
            # Changing the password ends the old unlock.
            await c.patch(f"/api/shared-views/{t}", headers=O(env), json={"password": "Another-pass1"})
            out["after_change"] = await c.get(f"/api/public/view/{t}", headers={"X-View-Token": ut})
            return out
        out = call(env, go)
        assert out["locked"].status_code == 403 and out["locked"].json()["detail"]["code"] == "password_required"
        assert "Atlas" not in out["locked"].text
        assert out["bad_header"].status_code == 403
        assert out["wrong"].status_code == 403 and out["wrong"].json()["detail"]["code"] == "incorrect_password"
        assert out["right"].status_code == 200 and out["right"].json()["expires_in"] == SA.UNLOCK_TTL_SECONDS
        assert out["open"].status_code == 200 and out["open"].json()["total"] == 2
        assert out["edit_locked"].status_code == 403
        assert out["event_locked"].status_code == 403 and out["event_ok"].status_code == 204
        assert out["after_change"].status_code == 403

    def test_open_links_are_unchanged(self, env):
        async def go(c):
            res = await c.post("/api/shared-views", headers=O(env), json={"record_ids": ["rec1"]})
            t = res.json()["token"]
            return res.json(), await c.get(f"/api/public/view/{t}")
        view, pub = call(env, go)
        assert view["is_password_protected"] is False
        assert pub.status_code == 200 and pub.json()["is_password_protected"] is False

    def test_expired_link_answers_expired_not_password(self, env):
        async def go(c):
            view = await make_link(env, c)
            env_t = view["token"]
            return env_t
        t = call(env, go)
        env.sql("UPDATE shared_views SET expires_at = NOW() - INTERVAL '1 hour' WHERE token = $1", t)

        async def go2(c):
            return (await c.get(f"/api/public/view/{t}"),
                    await c.post(f"/api/public/view/{t}/unlock", json={"password": "Sup3r-secret!"}),
                    await c.post(f"/api/public/view/{t}/access-request", json={"name": "A", "email": "a@acme.com"}))
        get, unlock, req = call(env, go2)
        for r in (get, unlock, req):
            assert r.status_code == 404 and "expired" in r.text
        assert env.sql("SELECT COUNT(*) FROM shared_view_access_requests")[0][0] == 0

    def test_unlock_rate_limited_per_ip_and_per_link(self, env, monkeypatch):
        monkeypatch.setattr(SA, "UNLOCK_LIMIT_PER_IP", (3, 900))
        monkeypatch.setattr(SA, "UNLOCK_LIMIT_PER_LINK", (5, 900))

        async def go(c):
            t = (await make_link(env, c))["token"]
            codes = [(await c.post(f"/api/public/view/{t}/unlock", json={"password": "x"})).status_code for _ in range(4)]
            # Another IP: its own budget, but the link's budget runs out.
            other = httpx.AsyncClient(transport=httpx.ASGITransport(app=env.app, client=("203.0.113.9", 1)),
                                      base_url="http://api.test")
            async with other:
                more = [(await other.post(f"/api/public/view/{t}/unlock", json={"password": "Sup3r-secret!"})).status_code
                        for _ in range(3)]
            return codes, more
        codes, more = call(env, go)
        assert codes == [403, 403, 403, 429]
        # The link has seen 3 counted tries (the 4th stopped at the IP limit): 2 left.
        assert more == [200, 200, 429]


class TestAccessRequests:
    def _request(self, c, t, **body):
        return c.post(f"/api/public/view/{t}/access-request",
                      json={"name": "Ana Lee", "email": "ana@acme.com", "message": "For the review", **body},
                      headers={"Origin": "https://app.test"})

    def test_request_is_stored_owner_and_superadmin_told_and_audited(self, env):
        async def go(c):
            t = (await make_link(env, c))["token"]
            res = await self._request(c, t)
            dup = await self._request(c, t)
            return t, res, dup
        t, res, dup = call(env, go)
        assert res.status_code == 202 and dup.json() == res.json()
        rows = env.sql("SELECT * FROM shared_view_access_requests")
        assert len(rows) == 1
        r = rows[0]
        assert (r["name"], r["email"], r["message"], r["status"], r["ip"]) == \
            ("Ana Lee", "ana@acme.com", "For the review", "pending", "198.51.100.7")
        notes = env.sql("SELECT user_id::text AS u, kind, payload FROM notifications")
        assert {n["u"] for n in notes} == {env.owner, env.admin} and {n["kind"] for n in notes} == {"access_request"}
        owner_mail = env.mail.to(env.sql("SELECT email FROM auth_users WHERE id = $1::uuid", env.owner)[0][0])
        assert len(owner_mail) == 1
        m = owner_mail[0]
        assert "Ana Lee" in m["subject"] and "Atlas board" in m["subject"]
        assert "/api/public/view-access/decide?" in m["text"] and "Sup3r-secret!" not in m["text"] + m["html"]
        assert "share_access.requested" in audit_types(env)

    def test_validation_and_honeypot(self, env):
        async def go(c):
            t = (await make_link(env, c))["token"]
            bad = await self._request(c, t, email="ana@acme")
            noname = await self._request(c, t, name="   ")
            honey = await self._request(c, t, website="http://spam")
            return bad, noname, honey
        bad, noname, honey = call(env, go)
        assert bad.status_code == 422 and "email" in bad.json()["detail"]["fields"]
        assert noname.status_code == 422 and "name" in noname.json()["detail"]["fields"]
        assert honey.status_code == 202 and honey.json() == R._REQUEST_ACCEPTED
        assert env.sql("SELECT COUNT(*) FROM shared_view_access_requests")[0][0] == 0
        assert env.mail.sent == []

    def test_unknown_and_open_links(self, env):
        async def go(c):
            t = (await c.post("/api/shared-views", headers=O(env), json={"record_ids": ["rec1"]})).json()["token"]
            return await self._request(c, "nosuchlink"), await self._request(c, t)
        missing, open_ = call(env, go)
        assert missing.status_code == 404 and open_.status_code == 404

    def test_request_rate_limits(self, env, monkeypatch):
        monkeypatch.setattr(SA, "REQUEST_LIMIT_PER_IP", (2, 3600))

        async def go(c):
            t = (await make_link(env, c))["token"]
            return [(await self._request(c, t, email=f"p{i}@acme.com")).status_code for i in range(3)]
        assert call(env, go) == [202, 202, 429]

    def test_auto_approve_domain_sends_at_once(self, env):
        async def go(c):
            t = (await make_link(env, c, auto_approve_domains=["theworks.in"]))["token"]
            await self._request(c, t, email="ravi@theworks.in", name="Ravi")
            await self._request(c, t, email="ravi@evil-theworks.in", name="Eve")
            return t
        t = call(env, go)
        rows = {r["email"]: r for r in env.sql("SELECT * FROM shared_view_access_requests")}
        assert rows["ravi@theworks.in"]["status"] == "approved" and rows["ravi@theworks.in"]["decided_via"] == "auto"
        assert rows["ravi@theworks.in"]["sent_at"] is not None
        assert rows["ravi@evil-theworks.in"]["status"] == "pending"
        sent = env.mail.to("ravi@theworks.in")
        assert len(sent) == 1 and "Sup3r-secret!" in sent[0]["html"] and f"https://app.test/view/{t}" in sent[0]["text"]
        assert env.mail.to("ravi@evil-theworks.in") == []
        assert {"share_access.approved", "share_access.sent"} <= set(audit_types(env))

    def test_off_by_default(self, env):
        async def go(c):
            t = (await make_link(env, c))["token"]
            await self._request(c, t, email="ravi@theworks.in")
        call(env, go)
        assert env.sql("SELECT status FROM shared_view_access_requests")[0][0] == "pending"
        assert env.mail.to("ravi@theworks.in") == []


class TestDecisions:
    def _setup(self, env, c):
        async def go():
            t = (await make_link(env, c))["token"]
            await c.post(f"/api/public/view/{t}/access-request", json={"name": "Ana", "email": "ana@acme.com"},
                         headers={"Origin": "https://app.test"})
            rid = str(await arid(env))
            return t, rid
        return go()

    def test_in_app_approve_sends_the_current_password(self, env):
        async def go(c):
            t, rid = await self._setup(env, c)
            # The password changes after the request was made.
            await c.patch(f"/api/shared-views/{t}", headers=O(env), json={"password": "Changed-pass9"})
            listing = (await c.get("/api/shared-views/access-requests", headers=O(env))).json()
            res = await c.post(f"/api/shared-views/access-requests/{rid}/approve", headers=O(env), json={})
            again = await c.post(f"/api/shared-views/access-requests/{rid}/approve", headers=O(env), json={})
            return listing, res, again
        listing, res, again = call(env, go)
        assert listing["pending"] == 1 and listing["requests"][0]["view_title"] == "Atlas board"
        body = res.json()
        assert res.status_code == 200 and body["sent"] is True and "password" not in body
        mail = env.mail.to("ana@acme.com")[-1]
        assert "Changed-pass9" in mail["html"] and "Sup3r-secret!" not in mail["html"]
        assert again.status_code == 409
        row = env.sql("SELECT status, decided_by::text AS by, decided_via FROM shared_view_access_requests")[0]
        assert (row["status"], row["by"], row["decided_via"]) == ("approved", env.owner, "app")

    def test_without_a_mailer_the_owner_gets_the_password(self, env):
        env.mail.configured = False

        async def go(c):
            t, rid = await self._setup(env, c)
            return await c.post(f"/api/shared-views/access-requests/{rid}/approve", headers=O(env), json={})
        res = call(env, go).json()
        assert res["sent"] is False and res["reason"] == "email_not_configured"
        assert res["password"] == "Sup3r-secret!" and res["url"].endswith("/view/" + res["request"]["view_token"])
        assert env.mail.sent == []
        assert "share_access.send_skipped" in audit_types(env)

    def test_send_failure_falls_back_to_the_owner(self, env):
        async def go(c):
            _, rid = await self._setup(env, c)
            env.mail.fail = True
            return await c.post(f"/api/shared-views/access-requests/{rid}/approve", headers=O(env), json={})
        res = call(env, go).json()
        assert res["sent"] is False and res["password"] == "Sup3r-secret!"
        assert "share_access.send_failed" in audit_types(env)

    def test_deny_with_a_note(self, env):
        async def go(c):
            _, rid = await self._setup(env, c)
            return await c.post(f"/api/shared-views/access-requests/{rid}/deny", headers=O(env),
                                json={"note": "Please ask Priya directly."})
        res = call(env, go)
        assert res.status_code == 200 and res.json()["status"] == "denied"
        mail = env.mail.to("ana@acme.com")[-1]
        assert "Please ask Priya directly." in mail["html"] and "Sup3r-secret!" not in mail["html"]
        assert "share_access.denied" in audit_types(env)

    def test_email_links_confirm_then_act(self, env):
        async def go(c):
            await self._setup(env, c)
            owner_mail = [m for m in env.mail.sent if "/decide?" in m["text"]][0]
            approve = [ln.split(": ", 1)[1] for ln in owner_mail["text"].splitlines() if ln.startswith("Approve")][0]
            path = urlparse(approve)
            url = f"{path.path}?{path.query}"
            page = await c.get(url)
            state_after_get = await astatus(env)
            done = await c.post(url)
            replay = await c.post(url)
            q = parse_qs(path.query)
            tampered = await c.post(f"{path.path}?r={q['r'][0]}&a=deny&e={q['e'][0]}&s={q['s'][0]}")
            return page, state_after_get, done, replay, tampered
        page, state_after_get, done, replay, tampered = call(env, go)
        assert page.status_code == 200 and "Send the password?" in page.text and 'method="post"' in page.text
        assert page.headers["referrer-policy"] == "no-referrer"
        assert state_after_get == "pending"                       # a link scanner's GET does nothing
        assert done.status_code == 200 and "Password sent" in done.text
        assert env_status(env) == "approved"
        assert "Already approved" in replay.text
        assert tampered.status_code == 400
        assert env.sql("SELECT decided_via FROM shared_view_access_requests")[0][0] == "email"

    def test_expired_email_link(self, env):
        async def go(c):
            await self._setup(env, c)
            rid = str(await arid(env))
            p = SA.action_params(rid, "deny", ttl=-10)
            return await c.post("/api/public/view-access/decide", params=p)
        res = call(env, go)
        assert res.status_code == 410 and env_status(env) == "pending"


async def arid(env):
    return await env._pool.fetchval("SELECT id FROM shared_view_access_requests ORDER BY created_at DESC LIMIT 1")


async def astatus(env):
    return await env._pool.fetchval("SELECT status FROM shared_view_access_requests ORDER BY created_at DESC LIMIT 1")


def env_rid(env):
    return env.sql("SELECT id FROM shared_view_access_requests ORDER BY created_at DESC LIMIT 1")[0][0]


def env_status(env):
    return env.sql("SELECT status FROM shared_view_access_requests ORDER BY created_at DESC LIMIT 1")[0][0]


def test_auto_approve_takes_whole_emails_as_well_as_domains():
    from app.services import share_access as SA
    allowed = SA.normalize_domains("Sakshi@TheWorks.in, client.com")
    assert allowed == ["sakshi@theworks.in", "client.com"]
    assert SA.domain_auto_approved("sakshi@theworks.in", allowed)
    assert not SA.domain_auto_approved("rahul@theworks.in", allowed)
    assert SA.domain_auto_approved("anyone@client.com", allowed)
    import pytest
    with pytest.raises(ValueError, match="not a valid email"):
        SA.normalize_domains("sakshi@")


class TestSaltedLinkPasswords:
    def test_new_hashes_are_salted_pbkdf2_and_verify(self):
        from app.services import share_access as SA
        a, b = SA.hash_password("correct horse 1"), SA.hash_password("correct horse 1")
        assert a.startswith("pbkdf2_sha256$") and a != b
        assert SA.password_matches("correct horse 1", a)
        assert not SA.password_matches("wrong", a)

    def test_passwords_set_before_salting_still_work(self):
        import hashlib
        from app.services import share_access as SA
        legacy = hashlib.sha256(b"old secret 12").hexdigest()
        assert SA.password_matches("old secret 12", legacy)
        assert not SA.password_matches("old secret 13", legacy)
        assert not SA.password_matches("", legacy)
