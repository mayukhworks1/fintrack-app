"""
Sessions and admin authorisation.

  * session tokens carry a nonce, so their 16-char hint is unique
  * email/SSO/impersonation tokens are session-bound: no session row, no access
  * logout revokes nothing for a token whose signature does not verify
  * auth paths never take a second pooled connection while holding one, and
    pool acquisition has a bounded wait
  * user management has a role hierarchy: only an email-authenticated
    superadmin grants superadmin or acts on a superadmin account
  * resend-invite is for accounts that have not activated, and returns the
    link only to a superadmin
  * superadmin set-password commits the password, the revocation and the audit
    row together
  * exiting impersonation revokes the impersonation session
"""

import asyncio
import importlib
import json
import re
import sys
import time

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.db.postgres as pg
import app.routers.admin as admin
import app.routers.auth as A
import app.routers.deps as D
import app.services.auth_master as M
import app.services.emailer as emailer


def _real_asyncpg():
    """
    The installed asyncpg. smoke_test.py swaps a stub into sys.modules when it
    is collected, so in a full run `import asyncpg` (here and in
    app.db.postgres) can yield the stub. Import the real one past it, then put
    sys.modules back as it was.
    """
    mod = sys.modules.get("asyncpg")
    if mod is not None and hasattr(mod, "Record"):
        return mod
    def ours(k):
        return k == "asyncpg" or k.startswith("asyncpg.")
    saved = {k: sys.modules.pop(k) for k in list(sys.modules) if ours(k)}
    try:
        return importlib.import_module("asyncpg")
    finally:
        for k in [k for k in sys.modules if ours(k)]:
            del sys.modules[k]
        sys.modules.update(saved)


class _PgError(Exception):
    """Stands in for asyncpg.PostgresError."""


class _Req:
    """Just enough of a Starlette Request for the auth helpers."""

    def __init__(self, **state):
        self.headers = {"user-agent": "pytest"}
        self.client = type("C", (), {"host": "203.0.113.9"})()
        self.state = type("S", (), {})()
        self.state.request_id = "r1"
        for k, v in state.items():
            setattr(self.state, k, v)
        self.url = type("U", (), {"path": "/x"})()


def _old_format_token(role: str, ttl: int = 300) -> str:
    """A token as minted before the nonce: base64url("{expiry}:{role}").sig"""
    payload = f"{int(time.time()) + ttl}:{role}".encode()
    return f"{A._b64url(payload)}.{A._b64url(A._sign(payload))}"


def _lookup_row(*, session: bool, auth_role: str = "admin", legacy_active=None) -> dict:
    row = {"session_id": None, "user_id": None, "expires_at": None, "revoked_at": None,
           "metadata": None, "email": None, "first_name": None, "last_name": None,
           "full_name": None, "status": None, "teable_email": None, "auth_role": None,
           "legacy_active": legacy_active}
    if session:
        row.update(session_id="s-actor", user_id="u-actor", email="actor@x.test", status="active",
                   auth_role=auth_role, metadata=json.dumps({"auth_role": auth_role}))
    return row


class _AuthLookupPool:
    """Answers deps._AUTH_LOOKUP_SQL with an active email session, or none."""

    def __init__(self, session: bool = False, auth_role: str = "admin"):
        self.session, self.auth_role = session, auth_role
        self.hints: list[str] = []

    async def fetchrow(self, sql, *args):
        assert "auth_sessions s" in sql
        self.hints.append(args[0])
        return _lookup_row(session=self.session, auth_role=self.auth_role)

    async def execute(self, *a):
        return "UPDATE 1"


# ── 1. tokens carry a nonce; old tokens keep working ─────────────────────────

class TestTokenNonce:
    def test_same_second_same_role_tokens_differ_within_the_hint(self, monkeypatch):
        monkeypatch.setattr(A.time, "time", lambda: 1_900_000_000.0)
        tokens = [A.make_token("editor") for _ in range(50)]
        assert len({t[:16] for t in tokens}) == 50
        assert all(A.verify_token(t) == "editor" for t in tokens)

    def test_an_email_login_and_a_shared_password_login_in_one_second_do_not_collide(self, monkeypatch):
        # The original collision: superadmin/admin email logins carry legacy
        # role 'editor', exactly like the shared APP_PASSWORD.
        monkeypatch.setattr(A.time, "time", lambda: 1_900_000_000.0)
        email = A.make_token("editor", session_bound=True)
        legacy = A.make_token("editor")
        assert email != legacy and email[:16] != legacy[:16]

    @pytest.mark.parametrize("role", ["editor", "viewer", "web", "all", "admin"])
    def test_a_pre_nonce_token_still_verifies_with_its_role(self, role):
        tok = _old_format_token(role)
        assert A.verify_token(tok) == role
        assert A.token_is_session_bound(tok) is False

    def test_the_oldest_role_less_token_still_reads_as_editor(self):
        payload = f"{int(time.time()) + 300}".encode()
        assert A.verify_token(f"{A._b64url(payload)}.{A._b64url(A._sign(payload))}") == "editor"

    def test_a_pre_nonce_token_still_resolves_to_its_session_row(self, monkeypatch):
        tok = _old_format_token("editor")
        pool = _AuthLookupPool(session=True)
        monkeypatch.setattr(D, "get_pool", lambda: pool)
        req = _Req()
        assert asyncio.run(D.require_auth(req, token=tok)) == "editor"
        assert pool.hints == [tok[:16]]          # the hint its rows were stored under
        assert req.state.is_email_auth is True and req.state.auth_role == "admin"

    def test_new_tokens_still_reject_expiry_and_tampering(self):
        assert A.verify_token(A.make_token("editor", ttl=-1)) is None
        payload_b64, sig = A.make_token("viewer").split(".", 1)
        forged = A._b64url_decode(payload_b64).replace(b":viewer", b":admin")
        assert A.verify_token(f"{A._b64url(forged)}.{sig}") is None


# ── 2. session-bound tokens need their session row ───────────────────────────

class _VerifyPool:
    def __init__(self, raises: bool = False):
        self.raises = raises

    async def fetchrow(self, sql, *a):
        if self.raises:
            raise ConnectionError("database blip")
        return None


class TestSessionBoundTokens:
    def test_a_deleted_users_token_is_refused_not_downgraded(self, monkeypatch):
        # Deleting a user deletes the auth_sessions row; the token used to
        # come back as an unscoped legacy 'editor'.
        monkeypatch.setattr(D, "get_pool", lambda: _AuthLookupPool(session=False))
        with pytest.raises(HTTPException) as e:
            asyncio.run(D.require_auth(_Req(), token=A.make_token("editor", session_bound=True)))
        assert e.value.status_code == 401

    def test_a_shared_password_token_without_a_session_row_still_works(self, monkeypatch):
        monkeypatch.setattr(D, "get_pool", lambda: _AuthLookupPool(session=False))
        req = _Req()
        assert asyncio.run(D.require_auth(req, token=A.make_token("editor"))) == "editor"
        assert req.state.is_email_auth is False

    def test_without_postgres_a_session_bound_token_fails_closed_with_503(self, monkeypatch):
        monkeypatch.setattr(D, "get_pool", lambda: None)
        with pytest.raises(HTTPException) as e:
            asyncio.run(D.require_auth(_Req(), token=A.make_token("editor", session_bound=True)))
        assert e.value.status_code == 503          # not 401: clients keep the token

    def test_without_postgres_shared_password_tokens_keep_working(self, monkeypatch):
        monkeypatch.setattr(D, "get_pool", lambda: None)
        assert asyncio.run(D.require_auth(_Req(), token=A.make_token("admin"))) == "admin"

    def test_the_session_marker_cannot_be_stripped(self):
        payload_b64, sig = A.make_token("editor", session_bound=True).split(".", 1)
        payload = A._b64url_decode(payload_b64)
        assert payload.endswith(b":editor:s")
        assert A.verify_token(f"{A._b64url(payload[:-2])}.{sig}") is None

    @pytest.mark.parametrize("pool,status", [(_VerifyPool(), 401), (None, 503), (_VerifyPool(raises=True), 503)])
    def test_verify_never_answers_a_session_bound_token_as_a_bare_role(self, monkeypatch, pool, status):
        monkeypatch.setattr(pg, "_pool", pool)
        with pytest.raises(HTTPException) as e:
            asyncio.run(A.verify(authorization=f"Bearer {A.make_token('editor', session_bound=True)}"))
        assert e.value.status_code == status

    def test_verify_still_answers_shared_password_tokens_through_a_database_blip(self, monkeypatch):
        monkeypatch.setattr(pg, "_pool", _VerifyPool(raises=True))
        out = asyncio.run(A.verify(authorization=f"Bearer {A.make_token('viewer')}"))
        assert out == {"valid": True, "role": "viewer"}

    def test_email_and_sso_logins_mint_session_bound_tokens(self, monkeypatch):
        async def primary_role(uid):
            return "admin"

        async def no_log(**kw):
            return None

        class P:
            async def fetchval(self, sql, *a):
                return "sess-1"

            def acquire(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        monkeypatch.setattr(M, "log_login", no_log)
        monkeypatch.setattr(M, "_primary_role", primary_role)
        monkeypatch.setattr(M, "get_pool", lambda: P())
        out = asyncio.run(M._create_session_for_user(
            {"id": "u1", "email": "u@x.test", "first_name": "U", "last_name": "X",
             "full_name": "U X", "status": "active"},
            _Req(), login_method="password"))
        assert A.verify_token(out["token"]) == "editor"
        assert A.token_is_session_bound(out["token"]) is True


# ── 3. logout needs a valid signature ────────────────────────────────────────

class _RecordingPool:
    def __init__(self):
        self.executed: list[tuple[str, tuple]] = []

    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        return "UPDATE 1"


class TestLogoutVerifiesTheToken:
    def test_a_forged_token_with_a_victims_hint_revokes_nothing(self, monkeypatch):
        pool = _RecordingPool()
        monkeypatch.setattr(pg, "_pool", pool)
        victim = _old_format_token("editor")          # hint guessable from the login second
        forged = f"{victim[:16]}AAAA.not-a-signature"
        out = asyncio.run(A.logout(authorization=f"Bearer {forged}"))
        assert out["logged_out"] is False
        assert pool.executed == []

    def test_an_expired_token_revokes_nothing(self, monkeypatch):
        pool = _RecordingPool()
        monkeypatch.setattr(pg, "_pool", pool)
        out = asyncio.run(A.logout(authorization=f"Bearer {A.make_token('editor', ttl=-1)}"))
        assert out["logged_out"] is False and pool.executed == []

    def test_a_valid_token_revokes_its_own_sessions(self, monkeypatch):
        pool = _RecordingPool()
        monkeypatch.setattr(pg, "_pool", pool)
        tok = A.make_token("editor", session_bound=True)
        assert asyncio.run(A.logout(authorization=f"Bearer {tok}")) == {"logged_out": True}
        assert [args for _, args in pool.executed] == [(tok[:16],), (tok[:16],)]
        assert "login_sessions" in pool.executed[0][0] and "auth_sessions" in pool.executed[1][0]


# ── 4. no second pooled connection while holding one ─────────────────────────

class _OneConnectionPool:
    """
    A pool of exactly one connection. A second acquire while it is held is the
    deadlock in miniature — every request holding one connection and waiting
    for another — so it fails the test instead of hanging.
    """

    def __init__(self, conn):
        self.conn = conn
        self.held = False

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self_):
                if pool.held:
                    raise AssertionError("second pooled connection requested while one is held")
                pool.held = True
                return pool.conn

            async def __aexit__(self_, *exc):
                pool.held = False
                return False

        return _Ctx()

    async def execute(self, sql, *args):
        async with self.acquire() as c:
            return await c.execute(sql, *args)

    async def fetchrow(self, sql, *args):
        async with self.acquire() as c:
            return await c.fetchrow(sql, *args)

    async def fetchval(self, sql, *args):
        async with self.acquire() as c:
            return await c.fetchval(sql, *args)


class _AuthConn:
    """Canned rows by SQL substring; records each write and whether a transaction was open."""

    def __init__(self, rows: dict | None = None):
        self.rows = rows or {}
        self.writes: list[tuple[str, bool]] = []
        self.in_tx = False

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self_):
                conn.in_tx = True

            async def __aexit__(self_, *exc):
                conn.in_tx = False
                return False

        return _Tx()

    async def fetchrow(self, sql, *args):
        for key, row in self.rows.items():
            if key in sql:
                return row
        return None

    async def fetchval(self, sql, *args):
        return None

    async def execute(self, sql, *args):
        self.writes.append((" ".join(sql.split()), self.in_tx))
        return "OK"

    def events(self):
        return [w for w in self.writes if "INSERT INTO auth_events" in w[0]]


@pytest.fixture
def one_conn(monkeypatch):
    def install(rows=None):
        conn = _AuthConn(rows)
        monkeypatch.setattr(M, "get_pool", lambda: _OneConnectionPool(conn))
        return conn
    monkeypatch.setattr(M, "hash_password", lambda pw, **kw: "pbkdf2_sha256$1$c2FsdA$ZGlnZXN0")

    async def sent(*a, **kw):
        return {"sent": True}
    monkeypatch.setattr(M, "send_email", sent)
    return install


class TestNoNestedPoolAcquire:
    def test_a_bad_oauth_state_is_recorded_after_the_connection_is_released(self, one_conn):
        conn = one_conn()
        with pytest.raises(HTTPException) as e:
            asyncio.run(M.consume_oauth_state("s" * 30, "google", _Req()))
        assert e.value.status_code == 400
        assert conn.events() and conn.events()[0][1] is False   # not inside the (empty) transaction

    def test_a_good_oauth_state_is_consumed_in_its_transaction(self, one_conn):
        conn = one_conn({"FROM auth_oauth_states": {"redirect_to": "/invoices"}})
        assert asyncio.run(M.consume_oauth_state("s" * 30, "google", _Req())) == "/invoices"
        assert [w for w in conn.writes if "used_at = NOW()" in w[0]] and not conn.events()

    def test_forgot_password_for_an_unknown_email(self, one_conn):
        conn = one_conn()
        out = asyncio.run(M.create_password_reset("nobody@x.test", _Req()))
        assert out["ok"] is True and len(conn.events()) == 1

    def test_registering_an_existing_email(self, one_conn):
        conn = one_conn({"FROM auth_users WHERE email_normalized": {"id": "u1", "status": "active"}})
        out = asyncio.run(M.create_pending_user("dup@x.test", "a-long-password", None, _Req()))
        assert out == {"created": False, "status": "pending_approval"} and len(conn.events()) == 1

    def test_an_invalid_reset_link_is_recorded_outside_the_rolled_back_transaction(self, one_conn):
        conn = one_conn()
        with pytest.raises(HTTPException) as e:
            asyncio.run(M.reset_password_with_token("t" * 30, "a-long-password", _Req()))
        assert e.value.status_code == 400
        assert [in_tx for _, in_tx in conn.events()] == [False]
        assert not [w for w in conn.writes if "UPDATE auth_users" in w[0]]

    def test_a_reset_for_an_inactive_user_is_recorded_too(self, one_conn):
        conn = one_conn({"FROM auth_password_resets": {"id": 1, "user_id": "u1", "email": "u@x.test",
                                                       "status": "disabled"}})
        with pytest.raises(HTTPException) as e:
            asyncio.run(M.reset_password_with_token("t" * 30, "a-long-password", _Req()))
        assert e.value.status_code == 403
        assert [in_tx for _, in_tx in conn.events()] == [False]

    def test_a_completed_reset_writes_its_event_inside_the_same_transaction(self, one_conn):
        conn = one_conn({"FROM auth_password_resets": {"id": 1, "user_id": "u1", "email": "u@x.test",
                                                       "status": "active"}})
        out = asyncio.run(M.reset_password_with_token("t" * 30, "a-long-password", _Req()))
        assert out["ok"] is True
        assert [in_tx for _, in_tx in conn.events()] == [True]
        assert all(in_tx for sql, in_tx in conn.writes if "UPDATE" in sql)

    def test_ten_concurrent_bad_callbacks_against_a_ten_connection_pool_all_finish(self, monkeypatch):
        """
        The reported wedge, reproduced: a pool of ten where acquire waits for a
        free connection, as asyncpg's does. Ten callers each holding one and
        asking for an eleventh never finish; releasing first, they all do.
        """
        class SlowConn(_AuthConn):
            async def fetchrow(self, sql, *args):
                await asyncio.sleep(0.01)           # let every caller take its connection
                return None

        class TenConnectionPool:
            def __init__(self):
                self.free = asyncio.Semaphore(10)

            def acquire(self):
                pool = self

                class _Ctx:
                    async def __aenter__(self_):
                        await pool.free.acquire()
                        return SlowConn()

                    async def __aexit__(self_, *exc):
                        pool.free.release()
                        return False

                return _Ctx()

            async def execute(self, sql, *args):
                async with self.acquire() as c:
                    return await c.execute(sql, *args)

        async def burst():
            pool = TenConnectionPool()
            monkeypatch.setattr(M, "get_pool", lambda: pool)
            return await asyncio.wait_for(asyncio.gather(
                *(M.consume_oauth_state("s" * 30, "google", _Req()) for _ in range(10)),
                return_exceptions=True), timeout=2)
        results = asyncio.run(burst())
        assert all(isinstance(r, HTTPException) and r.status_code == 400 for r in results)


class TestPoolAcquireIsBounded:
    @pytest.fixture(autouse=True)
    def _real(self):
        self.asyncpg = _real_asyncpg()
        # The production class, or the same class built on the real Pool when
        # app.db.postgres was imported against smoke_test's stub.
        self.Bounded = (pg._BoundedAcquirePool if issubclass(pg._BoundedAcquirePool, self.asyncpg.Pool)
                        else pg._bounded_pool_class(self.asyncpg.Pool))

    def _bare_pool(self, cls):
        # min_size=0: awaiting it builds the slots without opening a connection
        return cls("postgres://u:p@127.0.0.1:1/db", min_size=0, max_size=1, max_queries=50000,
                   max_inactive_connection_lifetime=0, setup=None, init=None, loop=None,
                   connection_class=self.asyncpg.Connection, record_class=self.asyncpg.Record)

    def test_a_held_pool_times_out_instead_of_waiting_forever(self, monkeypatch):
        monkeypatch.setattr(pg, "_POOL_ACQUIRE_TIMEOUT_S", 0.05)

        async def run():
            pool = self._bare_pool(self.Bounded)
            await pool
            pool._queue.get_nowait()               # the only slot is now held
            t0 = time.perf_counter()
            with pytest.raises(asyncio.TimeoutError):
                await pool.fetchval("SELECT 1")    # the helpers go through acquire() too
            with pytest.raises(asyncio.TimeoutError):
                async with pool.acquire():
                    pass
            return time.perf_counter() - t0
        assert asyncio.run(run()) < 2

    def test_an_explicit_timeout_still_wins(self):
        pool = self.asyncpg.Pool.__new__(self.Bounded)
        assert pool.acquire().timeout == pg._POOL_ACQUIRE_TIMEOUT_S
        assert pool.acquire(timeout=0.5).timeout == 0.5

    def test_init_pool_hands_out_the_bounded_pool(self, monkeypatch):
        import app.db.migrate as migrate
        from app.config import settings
        monkeypatch.setattr(pg, "asyncpg", self.asyncpg)
        monkeypatch.setattr(pg, "_BoundedAcquirePool", self.Bounded)

        async def create_pool(dsn, **kw):
            return self._bare_pool(self.asyncpg.Pool)

        class FakeConn:
            async def execute(self, sql):
                return "OK"

        class Ctx:
            async def __aenter__(self):
                return FakeConn()

            async def __aexit__(self, *a):
                return False

        async def no_migrations():
            return True

        monkeypatch.setattr(pg._BoundedAcquirePool, "acquire", lambda self, *, timeout=None: Ctx())
        monkeypatch.setattr(pg.asyncpg, "create_pool", create_pool)
        monkeypatch.setattr(migrate, "run_migrations", no_migrations)
        monkeypatch.setattr(settings, "postgres_url", "postgres://u:p@h/db")
        monkeypatch.setattr(pg, "_pool", None)
        asyncio.run(pg.init_pool())
        assert type(pg._pool) is pg._BoundedAcquirePool


# ── 5–8. admin user management, over HTTP ────────────────────────────────────

class _AdminDB:
    """
    Pool and connection for the admin handlers. Answers by SQL shape, records
    writes, and models a transaction: writes inside one survive only if it
    commits. Like Postgres, it rejects an aggregate in RETURNING.
    """

    def __init__(self, *, actor_row, target_is_superadmin=False, not_activated=True,
                 metadata=None, fail_on=None):
        self.actor_row = actor_row
        self.target_is_superadmin = target_is_superadmin
        self.not_activated = not_activated
        self.metadata = metadata
        self.fail_on = fail_on
        self.writes: list[tuple[str, tuple]] = []
        self._pending: list | None = None

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def transaction(self):
        db = self

        class _Tx:
            async def __aenter__(self_):
                db._pending = []

            async def __aexit__(self_, exc_type, *a):
                pending, db._pending = db._pending, None
                if exc_type is None:
                    db.writes.extend(pending)
                return False

        return _Tx()

    def _write(self, sql, args):
        sql = " ".join(sql.split())
        if re.search(r"RETURNING\s+COUNT\s*\(", sql, re.I):
            raise _PgError("aggregate functions are not allowed in RETURNING")
        if self.fail_on and self.fail_on in sql:
            raise _PgError(f"forced failure on {self.fail_on}")
        (self._pending if self._pending is not None else self.writes).append((sql, args))

    def wrote(self, fragment):
        return [w for w in self.writes if fragment in w[0]]

    async def execute(self, sql, *args):
        if "SET last_seen_at" in sql:          # deps' background touch
            return "UPDATE 1"
        self._write(sql, args)
        return "OK"

    async def fetchval(self, sql, *args):
        if "r.role_key = 'superadmin'" in sql:
            return self.target_is_superadmin
        if "FROM auth_roles WHERE role_key" in sql:
            return 7
        self._write(sql, args)
        return 2 if "WITH changed" in sql else None

    async def fetchrow(self, sql, *args):
        if "FROM (SELECT 1) AS _one" in sql:
            return self.actor_row
        if sql.lstrip().upper().startswith("UPDATE"):
            self._write(sql, args)
        return {"id": "u-target", "user_id": "u-target", "email": "target@x.test", "status": "active",
                "first_name": None, "last_name": None, "full_name": "Target", "auth_role": "viewer",
                "not_activated": self.not_activated, "metadata": self.metadata}


ACTORS = {
    "legacy_admin": (lambda: A.make_token("admin"), _lookup_row(session=False)),
    "email_admin": (lambda: A.make_token("editor", session_bound=True), _lookup_row(session=True, auth_role="admin")),
    "superadmin": (lambda: A.make_token("editor", session_bound=True), _lookup_row(session=True, auth_role="superadmin")),
}
ALL_ADMIN_PERMS = {"module.admin.users.manage", "module.admin.users.approve", "system.roles.manage"}


@pytest.fixture
def admin_api(monkeypatch):
    """TestClient on the admin router as a given actor, against an _AdminDB."""

    async def approved_email(*a, **kw):
        return {"sent": True}

    async def created(**kw):
        return {"created": True, "id": "u-new", "role_key": kw["role_key"], "invite": {"sent": True}}

    monkeypatch.setattr(M, "send_user_approved_email", approved_email)
    monkeypatch.setattr(M, "create_admin_invited_user", created)
    monkeypatch.setattr(M, "hash_password", lambda pw, **kw: "pbkdf2_sha256$1$c2FsdA$ZGlnZXN0")

    def build(actor, perms=ALL_ADMIN_PERMS, **db_kw):
        mint, actor_row = ACTORS[actor]
        db = _AdminDB(actor_row=actor_row, **db_kw)
        monkeypatch.setattr(D, "get_pool", lambda: db)
        monkeypatch.setattr(admin, "get_pool", lambda: db)

        async def effective(user_id, *, fresh=False):
            return set(perms)
        monkeypatch.setattr(D, "get_effective_permissions", effective)
        app = FastAPI()
        app.include_router(admin.router)
        client = TestClient(app)
        client.headers["Authorization"] = f"Bearer {mint()}"
        return client, db
    return build


def _call(client, method, path, body):
    kw = {"json": body} if body is not None else {}
    return client.request(method.upper(), path, **kw)


U = "/api/admin/auth/users/u-target"
ACTIONS_ON_A_SUPERADMIN = [
    ("patch", f"{U}/role", {"role_key": "viewer"}),
    ("patch", f"{U}/approve", {"role_key": "viewer"}),
    ("patch", f"{U}/reactivate", {}),
    ("patch", f"{U}/reject", {}),
    ("patch", f"{U}/disable", {}),
    ("delete", f"{U}?force=true", None),
    ("post", f"{U}/force-password-reset", None),
    ("post", f"{U}/resend-invite", None),
    ("post", f"{U}/sessions/revoke", None),
    ("post", f"{U}/set-password", {"password": "a-long-new-password"}),
    ("post", "/api/admin/impersonate/u-target", None),
]
GRANTS_OF_SUPERADMIN = [
    ("post", "/api/admin/auth/users", {"email": "new@x.test", "role_key": "superadmin"}),
    ("patch", f"{U}/role", {"role_key": "superadmin"}),
    ("patch", f"{U}/approve", {"role_key": "superadmin"}),
    ("patch", f"{U}/reactivate", {"role_key": "superadmin"}),
]


class TestRoleHierarchy:
    def test_creating_a_user_needs_users_manage(self, admin_api):
        client, _ = admin_api("email_admin", perms={"module.admin.users.approve"})
        res = client.post("/api/admin/auth/users", json={"email": "new@x.test", "role_key": "viewer"})
        assert res.status_code == 403 and "users.manage" in res.text

    @pytest.mark.parametrize("actor", ["legacy_admin", "email_admin"])
    @pytest.mark.parametrize("method,path,body", GRANTS_OF_SUPERADMIN)
    def test_only_a_superadmin_grants_superadmin(self, admin_api, actor, method, path, body):
        client, db = admin_api(actor)
        res = _call(client, method, path, body)
        assert res.status_code == 403, res.text
        assert not db.wrote("auth_user_roles") and not db.wrote("UPDATE auth_users")

    @pytest.mark.parametrize("method,path,body", GRANTS_OF_SUPERADMIN)
    def test_a_superadmin_can_grant_superadmin(self, admin_api, method, path, body):
        client, _ = admin_api("superadmin")
        assert _call(client, method, path, body).status_code == 200

    @pytest.mark.parametrize("actor", ["legacy_admin", "email_admin"])
    @pytest.mark.parametrize("method,path,body", ACTIONS_ON_A_SUPERADMIN)
    def test_admins_cannot_act_on_a_superadmin_account(self, admin_api, actor, method, path, body):
        client, db = admin_api(actor, target_is_superadmin=True)
        res = _call(client, method, path, body)
        assert res.status_code == 403, res.text
        assert db.writes == []

    @pytest.mark.parametrize("method,path,body", ACTIONS_ON_A_SUPERADMIN)
    def test_a_superadmin_can_act_on_a_superadmin_account(self, admin_api, monkeypatch, method, path, body):
        async def sent(*a, **kw):
            return {"sent": True}
        monkeypatch.setattr(emailer, "send_email", sent)
        client, _ = admin_api("superadmin", target_is_superadmin=True)
        assert _call(client, method, path, body).status_code == 200

    def test_admins_still_manage_ordinary_accounts(self, admin_api):
        client, db = admin_api("email_admin", target_is_superadmin=False)
        assert client.patch(f"{U}/disable", json={}).status_code == 200
        assert db.wrote("SET status = 'disabled'")


class TestDeleteEndsLegacyPathSessions:
    def test_login_rows_are_ended_before_the_session_rows_go(self, admin_api):
        client, db = admin_api("superadmin")
        assert client.delete(f"{U}?force=true").status_code == 200
        order = [sql for sql, _ in db.writes]
        ended = next(i for i, s in enumerate(order) if s.startswith("UPDATE login_sessions SET is_active = false"))
        deleted = next(i for i, s in enumerate(order) if s.startswith("DELETE FROM auth_sessions"))
        assert ended < deleted


class TestResendInvite:
    @pytest.fixture(autouse=True)
    def _undelivered(self, monkeypatch):
        async def not_sent(*a, **kw):
            return {"sent": False, "reason": "email_not_configured"}
        monkeypatch.setattr(emailer, "send_email", not_sent)

    def test_an_activated_account_gets_no_invite(self, admin_api):
        client, db = admin_api("superadmin", not_activated=False)
        res = client.post(f"{U}/resend-invite")
        assert res.status_code == 409
        assert not db.wrote("auth_password_resets")

    @pytest.mark.parametrize("actor", ["legacy_admin", "email_admin"])
    def test_an_undelivered_invite_link_is_not_returned_to_an_admin(self, admin_api, actor):
        client, _ = admin_api(actor)
        res = client.post(f"{U}/resend-invite")
        assert res.status_code == 200
        body = res.json()
        assert body["invite_url"] is None and "reset_token" not in res.text
        assert "not delivered" in body["message"]

    def test_a_superadmin_gets_the_undelivered_link(self, admin_api):
        client, _ = admin_api("superadmin")
        body = client.post(f"{U}/resend-invite").json()
        assert body["invite_url"] and "reset_token=" in body["invite_url"]


class TestSetPassword:
    def test_password_revocation_and_audit_all_commit(self, admin_api):
        client, db = admin_api("superadmin")
        res = client.post(f"{U}/set-password", json={"password": "a-long-new-password"})
        assert res.status_code == 200, res.text
        assert res.json()["sessions_revoked"] == 2
        assert db.wrote("UPDATE auth_users SET password_hash")
        assert db.wrote("UPDATE auth_sessions SET revoked_at = NOW()")
        audit = db.wrote("admin_set_password")
        assert audit and json.loads(audit[0][1][2]) == {"sessions_revoked": 2}

    def test_a_failed_audit_write_leaves_the_password_unchanged(self, admin_api):
        client, db = admin_api("superadmin", fail_on="INSERT INTO auth_events")
        with pytest.raises(_PgError):
            client.post(f"{U}/set-password", json={"password": "a-long-new-password"})
        assert not db.wrote("UPDATE auth_users")


class TestImpersonation:
    def test_impersonation_tokens_are_session_bound(self, admin_api):
        client, db = admin_api("superadmin")
        res = client.post("/api/admin/impersonate/u-target")
        assert res.status_code == 200
        token = res.json()["token"]
        assert A.token_is_session_bound(token)
        assert db.wrote("INSERT INTO auth_sessions")[0][1][1] == token[:16]

    def test_exit_revokes_the_session_when_metadata_arrives_as_a_json_string(self, admin_api):
        # asyncpg hands JSONB back as a str; exit used to call .get() on it.
        client, db = admin_api("email_admin", metadata=json.dumps({"impersonated_by": "u-actor"}))
        res = client.post("/api/admin/impersonate/exit")
        assert res.status_code == 200, res.text
        assert db.wrote("UPDATE auth_sessions SET revoked_at = NOW() WHERE id")
        ended = db.wrote("impersonation_ended")
        assert ended and ended[0][1][1] == "u-actor"

    def test_exit_from_an_ordinary_session_is_refused(self, admin_api):
        client, db = admin_api("email_admin", metadata=json.dumps({"auth_role": "admin"}))
        assert client.post("/api/admin/impersonate/exit").status_code == 400
        assert db.writes == []
