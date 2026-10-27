"""
Admin → AI gateway over HTTP.

  * every route is superadmin-only: the legacy admin password and an email
    admin get 403, and nothing is written or called
  * a key goes in and never comes back — not in a response, not in a
    validation error, not in an audit row; only its last four characters
  * every write leaves an auth_events row naming what changed
  * bad values are 422, unknown providers and tasks 404
  * with the gateway tables missing, reads serve the defaults and writes
    answer 503 with the storage message
  * the call log filters by IST day and builds its SQL parameters in order

The router runs on top of the real gateway service, against an in-memory fake
of the gateway tables, auth_events and ai_traces that answers by SQL shape.
"""

import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.routers.ai as AI
import app.routers.ai_gateway as R
import app.routers.auth as A
import app.routers.deps as D
import app.services.openrouter as O
from app.services import ai_gateway as G
from app.services import ai_usage

NOW = datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)      # 11:30 IST
BASE = "/api/admin/ai-gateway"
STORAGE_503 = {"detail": "AI gateway storage is not ready (database migration 0003 has not run)."}

PROVIDER_COLUMNS = ("key", "enabled", "base_url", "api_key_enc", "key_hint", "key_set_by", "key_set_at",
                    "timeout_s", "daily_request_cap", "daily_token_cap", "models",
                    "last_test_at", "last_test_ok", "last_test_ms", "last_test_error")


class UndefinedTableError(Exception):
    sqlstate = "42P01"


class UndefinedColumnError(Exception):
    sqlstate = "42703"


class _Ctx:
    def __init__(self, enter=None, exit=None):
        self._enter, self._exit = enter, exit

    async def __aenter__(self):
        return self._enter() if callable(self._enter) else self._enter

    async def __aexit__(self, exc_type, *a):
        if self._exit:
            self._exit(exc_type is None)
        return False


def _lookup_row(*, session: bool, auth_role: str = "admin") -> dict:
    row = {"session_id": None, "user_id": None, "expires_at": None, "revoked_at": None,
           "metadata": None, "email": None, "first_name": None, "last_name": None,
           "full_name": None, "status": None, "teable_email": None, "auth_role": None,
           "legacy_active": None}
    if session:
        row.update(session_id="s-actor", user_id="00000000-0000-0000-0000-00000000a11c",
                   email="root@x.test", status="active", auth_role=auth_role,
                   metadata=json.dumps({"auth_role": auth_role}))
    return row


ACTORS = {
    "legacy_admin": (lambda: A.make_token("admin"), _lookup_row(session=False)),
    "email_admin": (lambda: A.make_token("editor", session_bound=True), _lookup_row(session=True, auth_role="admin")),
    "superadmin": (lambda: A.make_token("editor", session_bound=True), _lookup_row(session=True, auth_role="superadmin")),
}


class GatewayAdminDB:
    """
    Pool and connection for the gateway routes. Keeps the gateway tables in
    memory and applies the service's upserts to them, so a response read back
    after a write shows the write. Records every write (a transaction's only
    if it commits), and every call-log query with its parameters.
    `missing=True` is a database migration 0003 never reached.
    """

    def __init__(self, *, actor_row, providers=(), tasks=(), settings=None, prompts=(), usage=(),
                 call_groups=(), call_rows=(), call_detail=None, missing=False, fail_audit=False):
        self.actor_row = actor_row
        self.providers = {p["key"]: dict(p) for p in providers}
        self.tasks = {t["key"]: {"enabled": True, "route": None, "daily_cap": None,
                                 "prompt_version": 0, **t} for t in tasks}
        self.settings = dict(settings or {})
        self.prompts = [dict(p) for p in prompts]
        self.usage = [dict(u) for u in usage]
        self.call_groups = [dict(g) for g in call_groups]
        self.call_rows = [dict(r) for r in call_rows]
        self.call_detail = call_detail
        self.missing = missing
        self.fail_audit = fail_audit
        self.writes: list[tuple[str, tuple]] = []
        self.log_queries: list[tuple[str, tuple]] = []
        self._pending: list | None = None

    # connection and transaction
    def acquire(self):
        return _Ctx(self)

    def transaction(self):
        def begin():
            self._pending = []

        def end(commit):
            pending, self._pending = self._pending, None
            if commit:
                self.writes.extend(pending)
        return _Ctx(begin, end)

    # helpers
    def wrote(self, fragment):
        return [w for w in self.writes if fragment in w[0]]

    def audits(self):
        return [{"event_type": args[0], "email": args[4], "metadata": json.loads(args[9])}
                for sql, args in self.wrote("INSERT INTO auth_events")]

    def gateway_writes(self):
        return [w for w in self.writes if "ai_gateway_" in w[0]]

    def _check(self, sql):
        if not self.missing:
            return
        if "ai_gateway_" in sql:
            raise UndefinedTableError('relation "ai_gateway_providers" does not exist')
        if "ai_traces" in sql and re.search(r"t\.task|t\.status|status IS NULL", sql):
            raise UndefinedColumnError('column "task" does not exist')

    def _record(self, sql, args):
        (self._pending if self._pending is not None else self.writes).append((" ".join(sql.split()), args))

    @staticmethod
    def _bind(values_sql, args):
        out = []
        for item in values_sql.split(","):
            item = item.strip()
            m = re.match(r"\$(\d+)", item)
            out.append(args[int(m.group(1)) - 1] if m else NOW)
        return out

    def _upsert(self, sql, args):
        m = re.search(r"INSERT INTO (\w+) \((.*?)\) VALUES \((.*?)\) ON CONFLICT", sql)
        table, cols = m.group(1), [c.strip() for c in m.group(2).split(",")]
        row = dict(zip(cols, self._bind(m.group(3), args)))
        store = self.providers if table == "ai_gateway_providers" else self.tasks
        current = store.setdefault(row["key"], {"key": row["key"]} if table == "ai_gateway_providers"
                                   else {"key": row["key"], "enabled": True, "route": None,
                                         "daily_cap": None, "prompt_version": 0})
        if "models" in row and row["models"] is None and "COALESCE(EXCLUDED.models" in sql:
            row.pop("models")
        if "last_test_at = NULL" in sql:
            current.update(last_test_at=None, last_test_ok=None, last_test_ms=None, last_test_error=None)
        current.update(row)

    # reads
    async def fetchrow(self, sql, *args):
        if "FROM (SELECT 1) AS _one" in sql:
            return self.actor_row
        self._check(sql)
        if "FROM ai_traces" in sql and "user_id = $1::uuid" in sql:
            return {"calls": 0, "prompt_tokens": 0, "answer_tokens": 0, "avg_latency_ms": 0, "failed": 0}
        if "FROM ai_traces t" in sql:
            self.log_queries.append((sql, args))
            return self.call_detail if self.call_detail and self.call_detail["id"] == args[0] else None
        if "FROM ai_gateway_prompts" in sql:
            task, version = args
            for p in self.prompts:
                if p["task"] == task and p["version"] == version:
                    return {"version": p["version"], "prompt": p["prompt"],
                            "created_at": p.get("created_at", NOW), "created_by": p.get("created_by")}
            return None
        if "FROM ai_gateway_providers WHERE key = $1 FOR UPDATE" in sql:
            row = self.providers.get(args[0])
            return None if row is None else {"base_url": row.get("base_url"),
                                             "has_key": row.get("api_key_enc") is not None}
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def fetch(self, sql, *args):
        await asyncio.sleep(0)
        self._check(sql)
        if "ai_gateway_models" in sql or "ai_gateway_limits" in sql:
            # Migration 0008 has not run on this fake: the 0003 settings serve.
            raise UndefinedTableError('relation "ai_gateway_limits" does not exist')
        if "FROM ai_traces t" in sql:
            self.log_queries.append((sql, args))
            return [dict(g) for g in self.call_groups] if "GROUP BY 1" in sql else [dict(r) for r in self.call_rows]
        if "FROM ai_traces" in sql:
            return [dict(u) for u in self.usage]
        if "JOIN ai_gateway_tasks" in sql:
            return [{"task": p["task"], "prompt": p["prompt"]} for p in self.prompts
                    if self.tasks.get(p["task"], {}).get("prompt_version") == p["version"]]
        if "FROM ai_gateway_prompts" in sql:
            (task,) = args
            rows = sorted((p for p in self.prompts if p["task"] == task), key=lambda p: -p["version"])
            return [{"version": p["version"], "created_at": p.get("created_at", NOW),
                     "created_by": p.get("created_by"), "reverted": p["prompt"] is None,
                     "chars": len(p["prompt"] or "")} for p in rows][:50]
        if "FROM ai_gateway_providers" in sql:
            return [{c: p.get(c) for c in PROVIDER_COLUMNS} for p in self.providers.values()]
        if "FROM ai_gateway_tasks" in sql:
            return [{**t, "route": t["route"] if t["route"] is None or isinstance(t["route"], str)
                     else json.dumps(t["route"])} for t in self.tasks.values()]
        if "FROM ai_gateway_settings" in sql:
            return [{"key": k, "value": json.dumps(v)} for k, v in self.settings.items()]
        raise AssertionError(f"unexpected fetch: {sql}")

    async def fetchval(self, sql, *args):
        self._check(sql)
        (task,) = args
        if "FOR UPDATE" in sql:
            return self.tasks[task]["prompt_version"]
        if "MAX(version)" in sql:
            return max((p["version"] for p in self.prompts if p["task"] == task), default=0) + 1
        raise AssertionError(f"unexpected fetchval: {sql}")

    # writes
    async def execute(self, sql, *args):
        if "SET last_seen_at" in sql:          # deps' background session touch
            return "UPDATE 1"
        self._check(sql)
        flat = " ".join(sql.split())
        if flat.startswith("INSERT INTO auth_events") and self.fail_audit:
            raise ConnectionResetError("audit write lost")
        self._record(sql, args)
        if flat.startswith(("INSERT INTO ai_gateway_providers", "INSERT INTO ai_gateway_tasks (key, enabled",
                            "INSERT INTO ai_gateway_tasks (key, route", "INSERT INTO ai_gateway_tasks (key, daily")):
            self._upsert(flat, args)
        elif flat.startswith("UPDATE ai_gateway_providers SET api_key_enc = NULL"):
            row = self.providers.get(args[0])
            if row:
                row.update(api_key_enc=None, key_hint=None, key_set_by=None, key_set_at=None,
                           last_test_at=None, last_test_ok=None, last_test_ms=None, last_test_error=None)
                if "models = NULL" in flat:
                    row["models"] = None
        elif flat.startswith("INSERT INTO ai_gateway_tasks (key, updated_by)"):
            self.tasks.setdefault(args[0], {"key": args[0], "enabled": True, "route": None,
                                            "daily_cap": None, "prompt_version": 0})
        elif flat.startswith("INSERT INTO ai_gateway_prompts"):
            task, version, prompt, by = args
            self.prompts.append({"task": task, "version": version, "prompt": prompt,
                                 "created_by": by, "created_at": NOW})
        elif flat.startswith("UPDATE ai_gateway_tasks SET prompt_version"):
            self.tasks[args[0]]["prompt_version"] = args[1]
        elif flat.startswith("INSERT INTO ai_gateway_settings"):
            self.settings[args[0]] = json.loads(args[1])
        return "OK"


@pytest.fixture
def gateway_api(monkeypatch):
    """TestClient on the gateway router as a given actor, against a GatewayAdminDB."""
    monkeypatch.setattr(G, "_config", None)
    monkeypatch.setattr(G, "_config_expires", 0.0)
    monkeypatch.setattr(G, "_generation", 0)
    monkeypatch.setattr(G, "_inflight", {})
    monkeypatch.setattr(G, "_usage_day", None)
    monkeypatch.setattr(G, "_usage_base", G._Usage())
    monkeypatch.setattr(G, "_usage_local", [])
    monkeypatch.setattr(G, "_usage_expires", 0.0)
    monkeypatch.setattr(G, "_read_failing", False)
    monkeypatch.setattr(G, "_now", lambda: NOW)
    monkeypatch.setattr(G.settings, "groq_api_key", None)
    monkeypatch.setattr(G.settings, "openrouter_api_key", None)
    monkeypatch.setattr(G.settings, "ai_gateway_secret", None)

    def no_network():
        raise AssertionError("no provider may be contacted here")
    monkeypatch.setattr(G, "get_http", no_network)

    async def no_model(*a, **kw):
        raise AssertionError("no model may be called here")
    monkeypatch.setattr(O, "_try_chat", no_model)

    def build(actor="superadmin", **db_kw):
        mint, actor_row = ACTORS[actor]
        db = GatewayAdminDB(actor_row=actor_row, **db_kw)
        for module in (D, R, G, ai_usage):
            monkeypatch.setattr(module, "get_pool", lambda: db)
        app = FastAPI()
        app.include_router(R.router)
        client = TestClient(app)
        client.headers["Authorization"] = f"Bearer {mint()}"
        return client, db
    return build


def stored(key, plain, **extra):
    """A provider row holding `plain` as its stored key."""
    return {"key": key, "api_key_enc": G.encrypt_key(plain), "key_hint": plain[-4:],
            "key_set_by": "root@x.test", "key_set_at": NOW, **extra}


def models(*ids):
    return json.dumps([{"id": i, "context": 131072, "vision": None, "free": None} for i in ids])


REAL_TRY_CHAT = O._try_chat
GROQ_KEY = "gsk_live_0123456789abcdefTAt2"
OR_KEY = "sk-or-v1-fedcba9876543210ZZ99"


# ── who may call ─────────────────────────────────────────────────────────────

EVERY_ROUTE = [
    ("get", "", None),
    ("patch", "/providers/groq", {"enabled": False}),
    ("put", "/providers/groq/key", {"api_key": GROQ_KEY}),
    ("delete", "/providers/groq/key", None),
    ("post", "/providers/groq/test", None),
    ("post", "/providers/test-all", None),
    ("patch", "/tasks/chat", {"enabled": False}),
    ("get", "/tasks/chat/prompt", None),
    ("get", "/tasks/chat/prompt/versions/1", None),
    ("put", "/tasks/chat/prompt", {"prompt": "Be brief."}),
    ("post", "/tasks/chat/test", {"input": "hello"}),
    ("patch", "/global", {"daily_call_cap": 10}),
    ("get", "/calls", None),
    ("get", "/calls/1", None),
    ("post", "/providers", {"preset": "openai", "api_key": "sk-proj-0123456789abcdef"}),
    ("delete", "/providers/groq", None),
    ("post", "/providers/groq/models/fetch", None),
    ("put", "/models", {"provider": "groq", "model": "openai/gpt-oss-20b", "enabled": False}),
    ("post", "/models/import", {"provider": "groq", "models": ["openai/gpt-oss-20b"]}),
    ("delete", "/models", None),
    ("get", "/models/stats", None),
    ("put", "/routing/default", {"route": None}),
    ("patch", "/breaker", {"failures": 2}),
    ("post", "/breaker/reset", {}),
    ("put", "/limits", {"scope": "global", "target": "", "limits": []}),
]


def _call(client, method, path, body=None):
    kw = {"json": body} if body is not None else {}
    return client.request(method.upper(), BASE + path, **kw)


class TestSuperadminOnly:
    @pytest.mark.parametrize("actor", ["legacy_admin", "email_admin"])
    @pytest.mark.parametrize("method,path,body", EVERY_ROUTE)
    def test_admins_are_refused_and_nothing_happens(self, gateway_api, actor, method, path, body):
        client, db = gateway_api(actor, providers=[stored("groq", GROQ_KEY)])
        res = _call(client, method, path, body)
        assert res.status_code == 403, res.text
        assert db.writes == [] and db.log_queries == []

    @pytest.mark.parametrize("method,path,body", EVERY_ROUTE)
    def test_no_token_is_401(self, gateway_api, method, path, body):
        client, db = gateway_api()
        del client.headers["Authorization"]
        assert _call(client, method, path, body).status_code == 401
        assert db.writes == []

    def test_every_route_on_the_router_is_listed_above(self):
        listed = {(m.upper(), BASE + p) for m, p, _ in EVERY_ROUTE}
        paths = {(m, r.path) for r in R.router.routes for m in r.methods}
        concrete = {(m, re.sub(r"\{key\}", "groq" if "/providers/" in p else "chat", p)
                     .replace("{version}", "1").replace("{call_id}", "1")) for m, p in paths}
        assert concrete == listed

    def test_every_route_depends_on_require_superadmin(self):
        for route in R.router.routes:
            assert any(d.call is D.require_superadmin for d in route.dependant.dependencies), route.path

    def test_the_task_test_is_held_to_the_ai_quota(self, gateway_api, monkeypatch):
        route = next(r for r in R.router.routes if r.path.endswith("/tasks/{key}/test"))
        assert any(d.call is AI._ai_quota for d in route.dependant.dependencies)

        async def spent(user_id, role=None):
            return {"allowed": False, "metered": True, "used": 200, "limit": 200, "remaining": 0}
        monkeypatch.setattr(ai_usage, "quota_state", spent)
        client, _ = gateway_api()
        res = client.post(f"{BASE}/tasks/chat/test", json={})
        assert res.status_code == 429 and "Daily AI limit reached" in res.text


# ── state ────────────────────────────────────────────────────────────────────

class TestState:
    def test_the_state_carries_providers_tasks_usage_and_no_key(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "openrouter_api_key", OR_KEY)
        client, _ = gateway_api(
            providers=[stored("groq", GROQ_KEY, models=models("openai/gpt-oss-120b"),
                              last_test_at=NOW, last_test_ok=True, last_test_ms=278)],
            tasks=[{"key": "judge", "route": [{"provider": "groq", "model": "openai/gpt-oss-120b"},
                                              {"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                    "daily_cap": 40, "prompt_version": 1}],
            prompts=[{"task": "judge", "version": 1, "prompt": "Check it."}],
            settings={"daily_call_cap": 500},
            usage=[{"task": "chat", "provider": "groq", "calls": 7, "tokens": 9000},
                   {"task": "judge", "provider": "openrouter", "calls": 2, "tokens": 400}],
        )
        res = client.get(BASE)
        assert res.status_code == 200
        body = res.json()
        assert GROQ_KEY not in res.text and OR_KEY not in res.text
        assert body["storage_ok"] is True and body["day"] == "2026-10-15"
        assert body["global"] == {"daily_call_cap": 500, "daily_token_cap": None,
                                  "calls_today": 9, "tokens_today": 9400}

        groq, orr = body["providers"]
        assert (groq["key"], orr["key"]) == ("groq", "openrouter")
        assert groq["key_source"] == "stored" and groq["key_hint"] == "TAt2" and groq["ready"] is True
        assert groq["key_set_by"] == "root@x.test" and groq["env_var"] == "GROQ_API_KEY"
        assert groq["requests_today"] == 7 and groq["tokens_today"] == 9000
        assert groq["last_test"] == {"at": NOW.isoformat(), "ok": True, "ms": 278, "error": None,
                                     "model_count": 1}
        assert groq["models"] == [{"id": "openai/gpt-oss-120b", "context": 131072, "vision": None, "free": None}]
        assert groq["used_by"]["openai/gpt-oss-120b"][:2] == ["chat", "judge"]
        assert groq["used_by"]["llama-3.3-70b-versatile"] == ["judge"]
        assert orr["key_source"] == "env" and orr["key_hint"] == "ZZ99" and orr["last_test"] is None
        assert orr["used_by"] == {"google/gemma-4-31b-it:free": ["invoice_parse"],
                                  "openrouter/free": [k for k in G.TASKS if k != "judge"]}

        tasks = {t["key"]: t for t in body["tasks"]}
        assert list(tasks) == list(G.TASKS)
        judge = tasks["judge"]
        assert judge["label"] == "Answer check" and judge["output"] == "json" and judge["personal_data"]
        assert judge["daily_cap"] == 40 and judge["calls_today"] == 2 and judge["tokens_today"] == 400
        assert judge["prompt"] == {"editable": True, "version": 1, "overridden": True}
        assert judge["default_route"] == [dict(s) for s in G.DEFAULT_ROUTE]
        assert judge["route_warnings"] == [
            {"index": 1, "level": "error", "message": "Not offered by Groq — calls to it will fail"}]
        assert tasks["page_build"]["prompt"] == {"editable": False, "version": 0, "overridden": False}
        assert tasks["chat"]["calls_today"] == 7 and tasks["chat"]["enabled"] is True

    def test_without_the_tables_the_defaults_are_served(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", GROQ_KEY)
        client, _ = gateway_api(missing=True)
        body = client.get(BASE).json()
        assert body["storage_ok"] is False
        assert body["providers"][0]["key_source"] == "env" and body["providers"][0]["ready"] is True
        assert all(t["enabled"] and t["route"] == t["default_route"] for t in body["tasks"])
        assert body["global"]["calls_today"] == 0


# ── providers ────────────────────────────────────────────────────────────────

class TestProviders:
    def test_patch_saves_audits_and_returns_the_provider(self, gateway_api):
        client, db = gateway_api(providers=[stored("groq", GROQ_KEY)])
        res = client.patch(f"{BASE}/providers/groq", json={
            "enabled": False, "timeout_s": 20, "daily_request_cap": 900, "daily_token_cap": None,
            "base_url": "https://api.groq.com/openai/v2/"})
        assert res.status_code == 200, res.text
        p = res.json()
        assert p["enabled"] is False and p["ready"] is False and p["timeout_s"] == 20
        assert p["daily_request_cap"] == 900 and p["base_url"] == "https://api.groq.com/openai/v2"
        assert p["key_source"] == "stored"                 # same host: the key stays
        assert p["default_base_url"] == "https://api.groq.com/openai/v1" and p["default_timeout_s"] == 30
        assert GROQ_KEY not in res.text
        (audit,) = db.audits()
        assert audit["event_type"] == "ai_gateway_provider_saved" and audit["email"] == "root@x.test"
        assert audit["metadata"] == {"actor_role": "superadmin", "provider": "groq", "changes": {
            "enabled": False, "timeout_s": 20, "daily_request_cap": 900, "daily_token_cap": None,
            "base_url": "https://api.groq.com/openai/v2"}}
        assert db.wrote("INSERT INTO ai_gateway_providers")[0][1][-1] == "root@x.test"

    def test_another_host_drops_the_stored_key_and_never_gets_the_env_key(self, gateway_api, monkeypatch):
        """A key belongs to the host it was entered for: pointing the provider
        elsewhere must not hand that host the stored key or the server's own."""
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-env-key-0000")
        client, db = gateway_api(providers=[stored("groq", GROQ_KEY, models=models("openai/gpt-oss-120b"),
                                                   last_test_at=NOW, last_test_ok=True, last_test_ms=90)])
        res = client.patch(f"{BASE}/providers/groq", json={"base_url": "https://gw.example/openai/v1"})
        assert res.status_code == 200, res.text
        p = res.json()
        assert p["base_url"] == "https://gw.example/openai/v1"
        assert p["key_source"] == "none" and p["key_hint"] is None and p["ready"] is False
        assert p["last_test"] is None and p["models"] == []
        assert db.providers["groq"]["api_key_enc"] is None
        (audit,) = db.audits()
        assert audit["metadata"]["key_removed"] is True
        chat = {t["key"]: t for t in client.get(BASE).json()["tasks"]}["chat"]
        assert chat["route_warnings"][0]["message"] == \
            "No key saved for this base URL (GROQ_API_KEY is only sent to api.groq.com)"

        # Back on the provider's own host, the env key applies again.
        res = client.patch(f"{BASE}/providers/groq", json={"base_url": None})
        p = res.json()
        assert p["base_url"] == "https://api.groq.com/openai/v1"
        assert p["key_source"] == "env" and p["ready"] is True
        assert "key_removed" not in db.audits()[-1]["metadata"]

    def test_an_empty_patch_changes_and_audits_nothing(self, gateway_api):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/providers/groq", json={}).status_code == 200
        assert db.writes == []

    def test_unknown_provider_is_404(self, gateway_api):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/providers/openai", json={"enabled": True}).status_code == 404
        assert client.put(f"{BASE}/providers/openai/key", json={"api_key": GROQ_KEY}).status_code == 404
        assert client.delete(f"{BASE}/providers/openai/key").status_code == 404
        assert client.post(f"{BASE}/providers/openai/test").status_code == 404
        assert db.writes == []

    @pytest.mark.parametrize("body", [
        {"timeout_s": 3}, {"timeout_s": 121}, {"timeout_s": "30"}, {"timeout_s": 30.5},
        {"enabled": "yes"}, {"enabled": None}, {"daily_request_cap": 0}, {"daily_token_cap": -5},
        {"daily_request_cap": True}, {"base_url": "http://api.groq.com/openai/v1"},
        {"base_url": "https://" + "a" * 200}, {"base_url": "https://"}, {"region": "eu"},
        {"base_url": "https://user:sk-secret@proxy.example"}, {"base_url": "https://127.0.0.1:6379"},
        {"base_url": "https://localhost/v1"}, {"base_url": "https://internal/x#"},
        {"base_url": "https://h.example/x?a="}, {"base_url": "https://api.groq.com:8443/openai/v1"},
    ])
    def test_bad_values_are_422_and_write_nothing(self, gateway_api, body):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/providers/groq", json=body).status_code == 422
        assert db.writes == []

    def test_a_key_sent_to_the_wrong_form_is_refused_without_echoing_it(self, gateway_api):
        client, db = gateway_api()
        res = client.patch(f"{BASE}/providers/groq", json={"api_key": GROQ_KEY})
        assert res.status_code == 422 and "api_key" in res.text
        assert GROQ_KEY not in res.text and db.writes == []

    def test_set_key_stores_ciphertext_and_returns_only_the_hint(self, gateway_api):
        client, db = gateway_api()
        res = client.put(f"{BASE}/providers/groq/key", json={"api_key": GROQ_KEY})
        assert res.status_code == 200, res.text
        assert GROQ_KEY not in res.text
        p = res.json()
        assert p["key_source"] == "stored" and p["key_hint"] == "TAt2" and p["ready"] is True
        assert p["key_set_by"] == "root@x.test" and p["key_unreadable"] is False
        assert G.decrypt_key(db.providers["groq"]["api_key_enc"]) == GROQ_KEY
        assert all(GROQ_KEY not in repr(args) for _, args in db.writes)
        (audit,) = db.audits()
        assert audit["event_type"] == "ai_gateway_key_set"
        assert audit["metadata"] == {"actor_role": "superadmin", "provider": "groq", "key_hint": "TAt2"}

    @pytest.mark.parametrize("payload", [
        {"api_key": "gsk short key with spaces 1234"},
        {"api_key": "gsk_THISISTHESECRETKEY\x00"},
        {"api_key": "gsk_clé_with_accent_12"},
        {"api_key": "gsk-123"},
        {"api_key": "g" * 401},
        {"api_key": None},
        {"apiKey": GROQ_KEY},
        {"api_key": 12345678901},
        [GROQ_KEY],
        GROQ_KEY,
    ])
    def test_a_malformed_key_body_is_422_and_never_echoed(self, gateway_api, payload):
        client, db = gateway_api()
        res = client.put(f"{BASE}/providers/groq/key", json=payload)
        assert res.status_code == 422
        assert "8 to 400 characters" in res.text
        for secret in (GROQ_KEY, "gsk short key with spaces", "THISISTHESECRETKEY", "g" * 401):
            assert secret not in res.text
        assert db.writes == []

    def test_a_body_that_is_not_json_is_refused_without_echoing_it(self, gateway_api):
        client, db = gateway_api()
        res = client.put(f"{BASE}/providers/groq/key", content=f"api_key={GROQ_KEY}",
                         headers={"Content-Type": "application/json"})
        assert res.status_code == 422 and GROQ_KEY not in res.text
        assert db.writes == []

    def test_remove_key_falls_back_to_env_and_audits_the_old_hint(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-env-key-0000ENV1")
        client, db = gateway_api(providers=[stored("groq", GROQ_KEY)])
        res = client.delete(f"{BASE}/providers/groq/key")
        assert res.status_code == 200
        p = res.json()
        assert p["key_source"] == "env" and p["key_hint"] == "ENV1" and p["key_set_by"] is None
        assert "gsk-env-key-0000ENV1" not in res.text
        (audit,) = db.audits()
        assert audit["event_type"] == "ai_gateway_key_removed"
        assert audit["metadata"] == {"actor_role": "superadmin", "provider": "groq", "key_hint": "TAt2"}

    def test_removing_when_only_the_env_key_is_set_audits_no_hint(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-env-key-0000ENV1")
        client, db = gateway_api()
        assert client.delete(f"{BASE}/providers/groq/key").json()["key_source"] == "env"
        assert db.audits()[0]["metadata"] == {"actor_role": "superadmin", "provider": "groq", "key_hint": None}

    def test_a_key_stored_under_another_secret_is_reported_unreadable(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "ai_gateway_secret", "the-secret-before")
        row = stored("groq", GROQ_KEY)
        monkeypatch.setattr(G.settings, "ai_gateway_secret", "the-secret-after")
        client, _ = gateway_api(providers=[row])
        res = client.get(BASE)
        groq = res.json()["providers"][0]
        assert groq["key_unreadable"] is True and groq["key_source"] == "none" and groq["ready"] is False
        assert groq["key_hint"] == "TAt2" and GROQ_KEY not in res.text
        chat = next(t for t in res.json()["tasks"] if t["key"] == "chat")
        assert {"index": 0, "level": "error", "message": "Stored key can't be read — set it again"} \
            in chat["route_warnings"]

    def test_a_lost_audit_row_does_not_fail_the_saved_change(self, gateway_api):
        client, db = gateway_api(fail_audit=True)
        res = client.patch(f"{BASE}/providers/groq", json={"timeout_s": 25})
        assert res.status_code == 200 and res.json()["timeout_s"] == 25
        assert db.wrote("INSERT INTO ai_gateway_providers") and not db.audits()


class _ModelsAPI:
    """Stands in for the shared HTTP client: answers GET {base}/models."""

    def __init__(self, status=200, payload=None):
        self.status, self.payload, self.calls = status, payload, []

    async def get(self, url, headers=None, timeout=None):
        self.calls.append((url, headers))
        return httpx.Response(self.status, json=self.payload, request=httpx.Request("GET", url))


class TestConnectionTest:
    def test_a_test_records_the_model_list_and_returns_the_provider(self, gateway_api, monkeypatch):
        client, db = gateway_api(providers=[stored("groq", GROQ_KEY)])
        api = _ModelsAPI(payload={"data": [
            {"id": "openai/gpt-oss-120b", "context_window": 131072},
            {"id": "openai/gpt-oss-20b", "context_window": 131072},
            {"id": "whisper-large-v3"},
        ]})
        monkeypatch.setattr(G, "get_http", lambda: api)
        res = client.post(f"{BASE}/providers/groq/test")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True and body["model_count"] == 2 and body["error"] is None
        assert body["provider"]["last_test"]["ok"] is True
        assert [m["id"] for m in body["provider"]["models"]] == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
        assert api.calls[0][0] == "https://api.groq.com/openai/v1/models"
        assert GROQ_KEY not in res.text
        assert db.audits() == []

    def test_a_rejected_key_is_reported_without_the_key(self, gateway_api, monkeypatch):
        client, _ = gateway_api(providers=[stored("groq", GROQ_KEY)])
        monkeypatch.setattr(G, "get_http", lambda: _ModelsAPI(status=401, payload={"error": "bad"}))
        body = client.post(f"{BASE}/providers/groq/test").json()
        assert body["ok"] is False and body["error"] == "Key rejected by Groq"
        assert body["provider"]["last_test"]["ok"] is False

    def test_test_all_covers_every_provider(self, gateway_api, monkeypatch):
        client, _ = gateway_api(providers=[stored("openrouter", OR_KEY)])
        monkeypatch.setattr(G, "get_http", lambda: _ModelsAPI(payload={"data": [
            {"id": "openrouter/free", "context_length": 200000,
             "architecture": {"input_modalities": ["text", "image"]}}]}))
        res = client.post(f"{BASE}/providers/test-all")
        assert res.status_code == 200
        results = res.json()["results"]
        assert set(results) == {"groq", "openrouter"}
        assert results["groq"]["ok"] is False and results["groq"]["error"] == "No key set (GROQ_API_KEY)"
        assert results["openrouter"]["ok"] is True and results["openrouter"]["model_count"] == 1
        assert results["openrouter"]["provider"]["models"][0]["vision"] is True
        assert OR_KEY not in res.text


# ── tasks ────────────────────────────────────────────────────────────────────

class TestTasks:
    def test_patch_saves_route_cap_and_switch(self, gateway_api):
        client, db = gateway_api()
        route = [{"provider": "openrouter", "model": "openrouter/free"},
                 {"provider": "groq", "model": " openai/gpt-oss-20b "}]
        res = client.patch(f"{BASE}/tasks/judge", json={"enabled": False, "route": route, "daily_cap": 25})
        assert res.status_code == 200, res.text
        t = res.json()
        assert t["key"] == "judge" and t["enabled"] is False and t["daily_cap"] == 25
        assert t["route"] == [{"provider": "openrouter", "model": "openrouter/free"},
                              {"provider": "groq", "model": "openai/gpt-oss-20b"}]
        (audit,) = db.audits()
        assert audit["event_type"] == "ai_gateway_task_saved"
        assert audit["metadata"]["task"] == "judge"
        assert audit["metadata"]["changes"] == {"enabled": False, "daily_cap": 25, "route": t["route"]}

    def test_route_null_goes_back_to_the_default(self, gateway_api):
        client, _ = gateway_api(tasks=[{"key": "chat", "route": [{"provider": "groq", "model": "x-model"}]}])
        assert {t["key"]: t for t in client.get(BASE).json()["tasks"]}["chat"]["route_custom"] is True
        res = client.patch(f"{BASE}/tasks/chat", json={"route": None})
        assert res.json()["route"] == [dict(s) for s in G.DEFAULT_ROUTE]
        assert res.json()["route_custom"] is False

    @pytest.mark.parametrize("body", [
        {"route": []},
        {"route": [{"provider": "groq", "model": "m"}] * 7},
        {"route": [{"provider": "openai", "model": "gpt-4o"}]},
        {"route": [{"provider": "groq", "model": "bad model id"}]},
        {"route": [{"provider": "groq", "model": "x" * 121}]},
        {"route": [{"provider": "groq"}]},
        {"route": [{"provider": "groq", "model": "m", "weight": 2}]},
        {"route": "groq"},
        {"daily_cap": 0},
        {"daily_cap": "10"},
        {"enabled": 1},
        {"prompt": "sneaky"},
    ])
    def test_bad_values_are_422_and_write_nothing(self, gateway_api, body):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/tasks/chat", json=body).status_code == 422
        assert db.writes == []

    def test_unknown_task_is_404(self, gateway_api):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/tasks/translate", json={"enabled": False}).status_code == 404
        assert client.get(f"{BASE}/tasks/translate/prompt").status_code == 404
        assert client.put(f"{BASE}/tasks/translate/prompt", json={"prompt": "x"}).status_code == 404
        assert client.post(f"{BASE}/tasks/translate/test", json={}).status_code == 404
        assert db.writes == []


class TestPrompts:
    def test_the_built_in_prompt_before_any_override(self, gateway_api):
        client, _ = gateway_api()
        body = client.get(f"{BASE}/tasks/chat/prompt").json()
        assert body["editable"] is True and body["overridden"] is False and body["version"] == 0
        assert body["default"] == O.SYSTEM_PROMPT and body["current"] == O.SYSTEM_PROMPT
        assert body["history"] == []

    @pytest.mark.parametrize("task", [k for k, t in G.TASKS.items() if t.prompt_editable])
    def test_every_editable_task_has_its_built_in_prompt(self, gateway_api, task):
        client, _ = gateway_api()
        body = client.get(f"{BASE}/tasks/{task}/prompt").json()
        assert isinstance(body["default"], str) and len(body["default"]) > 40

    def test_project_analysis_starts_from_the_chat_prompt(self, gateway_api):
        client, _ = gateway_api()
        assert client.get(f"{BASE}/tasks/project_analysis/prompt").json()["default"] == O.SYSTEM_PROMPT

    def test_save_then_revert_versions_the_prompt(self, gateway_api):
        client, db = gateway_api()
        res = client.put(f"{BASE}/tasks/judge/prompt", json={"prompt": "Check every figure."})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["version"] == 1 and body["overridden"] is True
        assert body["current"] == "Check every figure." and body["default"] != body["current"]
        assert [h["version"] for h in body["history"]] == [1]
        assert body["history"][0]["chars"] == len("Check every figure.") and not body["history"][0]["reverted"]

        res = client.put(f"{BASE}/tasks/judge/prompt", json={"prompt": "   "})
        body = res.json()
        assert body["version"] == 2 and body["overridden"] is False and body["current"] == body["default"]
        assert [(h["version"], h["reverted"]) for h in body["history"]] == [(2, True), (1, False)]

        first, second = db.audits()
        assert first["event_type"] == second["event_type"] == "ai_gateway_prompt_saved"
        assert first["metadata"] == {"actor_role": "superadmin", "task": "judge", "version": 1,
                                     "reverted": False, "chars": 19}
        assert second["metadata"]["reverted"] is True and second["metadata"]["version"] == 2
        assert "Check every figure." not in json.dumps(first["metadata"])

        version = client.get(f"{BASE}/tasks/judge/prompt/versions/1").json()
        assert version["version"] == 1 and version["prompt"] == "Check every figure."
        assert version["created_by"] == "root@x.test"
        assert client.get(f"{BASE}/tasks/judge/prompt/versions/2").json()["prompt"] is None

    def test_a_missing_version_is_404(self, gateway_api):
        client, _ = gateway_api()
        assert client.get(f"{BASE}/tasks/chat/prompt/versions/7").status_code == 404
        assert client.get(f"{BASE}/tasks/chat/prompt/versions/0").status_code == 404

    @pytest.mark.parametrize("task", ["page_build", "studio_analyze"])
    def test_an_assembled_prompt_is_read_only(self, gateway_api, task):
        client, db = gateway_api()
        body = client.get(f"{BASE}/tasks/{task}/prompt").json()
        assert body["editable"] is False and body["overridden"] is False and body["history"] == []
        assert body["default"].startswith(G.TASKS[task].prompt_note) and body["current"] == body["default"]
        res = client.put(f"{BASE}/tasks/{task}/prompt", json={"prompt": "Do something else."})
        assert res.status_code == 400 and "cannot be edited" in res.text
        assert db.writes == []

    def test_the_page_prompt_shows_the_rules_it_is_built_from(self, gateway_api):
        from app.services import page_ai
        client, _ = gateway_api()
        text = client.get(f"{BASE}/tasks/page_build/prompt").json()["default"]
        assert page_ai._HTML_RULES.strip() in text and page_ai._FIX_ERROR_SYSTEM.strip() in text

    @pytest.mark.parametrize("body", [{"prompt": "x" * 20_001}, {}, {"prompt": 5}, {"text": "x"}])
    def test_bad_prompt_bodies_are_422(self, gateway_api, body):
        client, db = gateway_api()
        assert client.put(f"{BASE}/tasks/chat/prompt", json=body).status_code == 422
        assert db.writes == []


class TestTaskTest:
    @pytest.fixture
    def model(self, monkeypatch):
        """Stands in for the cascade: records what it was asked, reports the
        steps in `seen["steps"]` through the attempts list, then answers or
        raises `seen["raise"]`."""
        seen = {"steps": [{"provider": "groq", "model": "openai/gpt-oss-120b", "ok": True,
                           "ms": 812, "error": None}]}

        async def fake(messages, **kw):
            seen.update(messages=messages, **kw)
            kw["attempts"].extend(dict(step, http_status=200) for step in seen["steps"])
            if "raise" in seen:
                raise seen["raise"]
            return {"content": "Alpha needs attention.", "model": "openai/gpt-oss-120b",
                    "model_short": "gpt-oss-120b", "provider": "groq"}
        monkeypatch.setattr(O, "_try_chat", fake)
        return seen

    def test_runs_the_sample_through_the_task_route(self, gateway_api, model):
        client, db = gateway_api()
        res = client.post(f"{BASE}/tasks/chat/test", json={"input": None})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True and body["error"] is None
        assert body["content"] == "Alpha needs attention."
        assert body["model"] == "openai/gpt-oss-120b" and body["provider"] == "groq"
        assert body["attempts"] == [{"provider": "groq", "model": "openai/gpt-oss-120b", "ok": True,
                                     "ms": 812, "error": None, "skipped": False}]
        assert isinstance(body["ms"], int)
        assert model["messages"] == [{"role": "system", "content": O.SYSTEM_PROMPT},
                                     {"role": "user", "content": G.TASKS["chat"].sample_input}]
        assert model["max_tokens"] == 700 and model["temperature"] == 0.2
        assert model["extract"] is False and model["task"] == "chat" and model["bypass_enabled"] is True
        assert db.writes == []

    def test_uses_the_override_and_the_typed_input(self, gateway_api, model):
        client, _ = gateway_api(tasks=[{"key": "judge", "prompt_version": 3}],
                                prompts=[{"task": "judge", "version": 3, "prompt": "Judge strictly."}])
        client.post(f"{BASE}/tasks/judge/test", json={"input": "  Is 2+2 four?  "})
        assert model["messages"] == [{"role": "system", "content": "Judge strictly."},
                                     {"role": "user", "content": "Is 2+2 four?"}]
        assert model["max_tokens"] == 350 and model["task"] == "judge"

    def test_an_assembled_prompt_is_built_for_the_test(self, gateway_api, model):
        from app.services import studio_analyst
        client, _ = gateway_api()
        client.post(f"{BASE}/tasks/studio_analyze/test", json={})
        assert model["messages"][0]["content"] == studio_analyst._system_prompt()
        client.post(f"{BASE}/tasks/page_build/test", json={"input": "A Q2 summary"})
        assert model["messages"][0]["content"].startswith("You generate complete, self-contained HTML")

    def test_a_refusal_or_a_failed_cascade_is_reported(self, gateway_api, model):
        model["steps"] = [{"provider": "groq", "model": "openai/gpt-oss-120b", "ok": False,
                           "ms": 90, "error": "rate-limited"}]
        model["raise"] = ValueError("All AI models are unavailable right now. "
                                    "Tried: gpt-oss-120b (Groq): rate-limited")
        client, _ = gateway_api()
        body = client.post(f"{BASE}/tasks/chat/test", json={}).json()
        assert body["ok"] is False and body["content"] is None and body["model"] is None
        assert body["provider"] is None
        assert body["error"].startswith("All AI models are unavailable right now.")
        assert body["attempts"] == [{"provider": "groq", "model": "openai/gpt-oss-120b", "ok": False,
                                     "ms": 90, "error": "rate-limited", "skipped": False}]

        model["steps"] = []
        model["raise"] = G.GatewayRefused("Today's AI limit for the workspace has been reached. "
                                          "It resets at midnight IST.")
        body = client.post(f"{BASE}/tasks/chat/test", json={}).json()
        assert body["ok"] is False and body["error"].startswith("Today's AI limit") and body["attempts"] == []

    def test_an_unexpected_error_is_not_leaked(self, gateway_api, model):
        model["raise"] = RuntimeError(f"socket closed while sending Bearer {GROQ_KEY}")
        client, _ = gateway_api()
        res = client.post(f"{BASE}/tasks/chat/test", json={})
        assert res.status_code == 200 and res.json()["ok"] is False
        assert GROQ_KEY not in res.text and "socket" not in res.text

    def test_a_switched_off_task_runs_through_the_real_cascade_and_is_logged(self, gateway_api, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", GROQ_KEY)
        sent = []

        async def post(payload, *, provider, retries=2, **_kw):
            sent.append((provider.key, payload["model"], payload["max_tokens"]))
            request = httpx.Request("POST", G.chat_url(provider))
            if payload["model"] == "openai/gpt-oss-120b":
                return httpx.Response(503, json={"error": {"message": "over capacity"}}, request=request)
            return httpx.Response(200, request=request, json={
                "choices": [{"message": {"content": "Gross margin is 20.8%."}}],
                "usage": {"prompt_tokens": 120, "completion_tokens": 9}})
        monkeypatch.setattr(O, "_post_with_retries", post)
        client, db = gateway_api(tasks=[{"key": "project_analysis", "enabled": False}])
        monkeypatch.setattr(O, "_try_chat", REAL_TRY_CHAT)
        res = client.post(f"{BASE}/tasks/project_analysis/test", json={"input": "Margin?"})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True and body["content"] == "Gross margin is 20.8%."
        assert body["provider"] == "groq" and body["model"] == "openai/gpt-oss-20b"
        assert [(a["model"], a["ok"]) for a in body["attempts"]] == [
            ("openai/gpt-oss-120b", False), ("openai/gpt-oss-20b", True)]
        assert "over capacity" in body["attempts"][0]["error"]
        assert sent == [("groq", "openai/gpt-oss-120b", 700), ("groq", "openai/gpt-oss-20b", 700)]
        assert GROQ_KEY not in res.text

        deadline = time.monotonic() + 2
        while len(db.wrote("INSERT INTO ai_traces")) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        logged = [args for _, args in db.wrote("INSERT INTO ai_traces")]
        assert [(a[11], a[12], a[13]) for a in logged] == [
            ("project_analysis", "groq", "failed"), ("project_analysis", "groq", "ok")]

    def test_input_is_capped_at_4000_characters(self, gateway_api, model):
        client, _ = gateway_api()
        assert client.post(f"{BASE}/tasks/chat/test", json={"input": "x" * 4001}).status_code == 422
        assert "messages" not in model


# ── workspace caps ───────────────────────────────────────────────────────────

class TestGlobal:
    def test_patch_saves_caps_and_returns_the_global_object(self, gateway_api):
        client, db = gateway_api(usage=[{"task": "chat", "provider": "groq", "calls": 3, "tokens": 700}])
        res = client.patch(f"{BASE}/global", json={"daily_call_cap": 400, "daily_token_cap": 2_000_000})
        assert res.status_code == 200, res.text
        assert res.json() == {"daily_call_cap": 400, "daily_token_cap": 2_000_000,
                              "calls_today": 3, "tokens_today": 700}
        (audit,) = db.audits()
        assert audit["event_type"] == "ai_gateway_global_saved"
        assert audit["metadata"]["changes"] == {"daily_call_cap": 400, "daily_token_cap": 2_000_000}
        res = client.patch(f"{BASE}/global", json={"daily_call_cap": None})
        assert res.json()["daily_call_cap"] is None and res.json()["daily_token_cap"] == 2_000_000

    @pytest.mark.parametrize("body", [{"daily_call_cap": 0}, {"daily_token_cap": "5"},
                                      {"daily_call_cap": 1.5}, {"per_user_cap": 3}])
    def test_bad_values_are_422(self, gateway_api, body):
        client, db = gateway_api()
        assert client.patch(f"{BASE}/global", json=body).status_code == 422
        assert db.writes == []


# ── storage not ready ────────────────────────────────────────────────────────

class TestStorageNotReady:
    @pytest.mark.parametrize("method,path,body", [
        ("patch", "/providers/groq", {"enabled": False}),
        ("put", "/providers/groq/key", {"api_key": GROQ_KEY}),
        ("delete", "/providers/groq/key", None),
        ("patch", "/tasks/chat", {"daily_cap": 5}),
        ("put", "/tasks/chat/prompt", {"prompt": "Be brief."}),
        ("patch", "/global", {"daily_call_cap": 10}),
    ])
    def test_writes_answer_503_with_the_storage_message(self, gateway_api, method, path, body):
        client, db = gateway_api(missing=True)
        res = _call(client, method, path, body)
        assert res.status_code == 503 and res.json() == STORAGE_503
        assert db.writes == []
        assert GROQ_KEY not in res.text

    def test_reads_still_work(self, gateway_api):
        client, _ = gateway_api(missing=True)
        assert client.get(BASE).status_code == 200
        body = client.get(f"{BASE}/tasks/chat/prompt").json()
        assert body["current"] == O.SYSTEM_PROMPT and body["history"] == []
        assert client.get(f"{BASE}/tasks/chat/prompt/versions/1").status_code == 404


# ── call log ─────────────────────────────────────────────────────────────────

IST = timezone(timedelta(hours=5, minutes=30))

GROUPS = [
    {"task": "chat", "requests": 5, "answered": 3, "failed": 1, "not_sent": 1, "tokens_in": 1800,
     "tokens_out": 420, "ms_sum": 3200, "ms_count": 4},
    {"task": None, "requests": 2, "answered": 2, "failed": 0, "not_sent": 0, "tokens_in": 100,
     "tokens_out": 50, "ms_sum": 1000, "ms_count": 2},
    {"task": "judge", "requests": 6, "answered": 0, "failed": 0, "not_sent": 6, "tokens_in": 0,
     "tokens_out": 0, "ms_sum": 0, "ms_count": 0},
]
ROW = {"id": 41, "ts": datetime(2026, 10, 15, 5, 30, tzinfo=timezone.utc), "task": "chat",
       "provider": "groq", "model": "openai/gpt-oss-120b", "status": "failed", "http_status": 429,
       "latency_ms": 812, "prompt_tokens": None, "answer_tokens": None, "user_email": "a@b.c",
       "endpoint": "/api/ai/chat/stream", "extra": json.dumps({"ok": False, "error": "rate-limited", "attempt": 2})}


class TestCallLog:
    def test_defaults_to_today_in_ist(self, gateway_api):
        client, db = gateway_api(call_groups=GROUPS, call_rows=[ROW])
        res = client.get(f"{BASE}/calls")
        assert res.status_code == 200, res.text
        (summary_sql, summary_args), (rows_sql, rows_args) = db.log_queries
        start, end = summary_args
        assert start == datetime(2026, 10, 15, tzinfo=IST) and end == datetime(2026, 10, 16, tzinfo=IST)
        assert rows_args == (start, end, 50, 0)
        assert "LIMIT $3 OFFSET $4" in rows_sql and "LEFT JOIN auth_users u ON u.id = t.user_id" in rows_sql

    def test_totals_by_task_and_rows(self, gateway_api):
        client, _ = gateway_api(call_groups=GROUPS, call_rows=[ROW])
        body = client.get(f"{BASE}/calls").json()
        assert body["total"] == 13 and body["limit"] == 50 and body["offset"] == 0
        assert body["totals"] == {"requests": 13, "answered": 5, "failed": 1, "not_sent": 7,
                                  "tokens_in": 1900, "tokens_out": 470, "avg_ms": 700}
        assert [(t["task"], t["label"], t["requests"], t["avg_ms"]) for t in body["by_task"]] == [
            ("judge", "Answer check", 6, None),
            ("chat", "AI assistant chat", 5, 800),
            (None, "No task recorded", 2, 500),
        ]
        assert body["rows"] == [{
            "id": 41, "ts": "2026-10-15T05:30:00+00:00", "task": "chat", "task_label": "AI assistant chat",
            "provider": "groq", "model": "openai/gpt-oss-120b", "status": "failed", "http_status": 429,
            "latency_ms": 812, "prompt_tokens": None, "answer_tokens": None, "user_email": "a@b.c",
            "endpoint": "/api/ai/chat/stream", "error": "rate-limited",
            "why": "Rate-limited by the provider: too many requests or tokens for this minute. "
                   "The next step was tried.",
            "attempt": 2}]

    def test_filters_become_parameters_in_order(self, gateway_api):
        client, db = gateway_api()
        res = client.get(f"{BASE}/calls", params={"from": "2026-10-01", "to": "2026-10-14", "task": "chat",
                                                  "provider": "groq", "status": "failed",
                                                  "limit": 20, "offset": 40})
        assert res.status_code == 200, res.text
        (summary_sql, summary_args), (rows_sql, rows_args) = db.log_queries
        start, end = datetime(2026, 10, 1, tzinfo=IST), datetime(2026, 10, 15, tzinfo=IST)
        assert summary_args == (start, end, "chat", "groq", "failed")
        assert rows_args == (start, end, "chat", "groq", "failed", 20, 40)
        for sql in (summary_sql, rows_sql):
            assert "t.ts >= $1 AND t.ts < $2 AND t.task = $3 AND t.provider = $4" in sql
            assert re.search(r"COALESCE\(t\.status, CASE WHEN t\.extra->>'ok' = 'false' THEN 'failed' "
                             r"ELSE 'ok' END\) = \$5", sql)
        assert "LIMIT $6 OFFSET $7" in rows_sql
        assert res.json()["total"] == 0 and res.json()["rows"] == []

    def test_a_single_day_and_an_open_start(self, gateway_api):
        client, db = gateway_api()
        client.get(f"{BASE}/calls", params={"to": "2026-10-03"})
        assert db.log_queries[0][1] == (datetime(2026, 10, 3, tzinfo=IST), datetime(2026, 10, 4, tzinfo=IST))

    @pytest.mark.parametrize("params", [
        {"from": "2026-10-10", "to": "2026-10-01"},
        {"from": "2026-07-01", "to": "2026-10-15"},
        {"from": "15-10-2026"},
        {"status": "error"},
        {"limit": 500},
        {"limit": 0},
        {"offset": -1},
        {"task": "t" * 41},
    ])
    def test_bad_filters_are_422(self, gateway_api, params):
        client, db = gateway_api()
        assert client.get(f"{BASE}/calls", params=params).status_code == 422
        assert db.log_queries == []

    def test_ninety_two_days_is_the_widest_range(self, gateway_api):
        client, _ = gateway_api()
        ok = client.get(f"{BASE}/calls", params={"from": "2026-07-16", "to": "2026-10-15"})
        assert ok.status_code == 200
        assert client.get(f"{BASE}/calls", params={"from": "2026-07-15", "to": "2026-10-15"}).status_code == 422

    def test_before_the_migration_the_older_rows_still_list(self, gateway_api):
        legacy = {**ROW, "task": None, "provider": None, "status": "ok", "http_status": None,
                  "extra": json.dumps({"ok": True})}
        client, db = gateway_api(missing=True, call_groups=GROUPS[1:2], call_rows=[legacy])
        res = client.get(f"{BASE}/calls")
        assert res.status_code == 200, res.text
        assert res.json()["rows"][0]["status"] == "ok" and res.json()["rows"][0]["task"] is None
        assert all("t.task" not in sql and "t.status" not in sql for sql, _ in db.log_queries)

    def test_detail_adds_request_session_and_extra(self, gateway_api):
        detail = {**ROW, "request_id": "req-9", "session_id": None}
        client, db = gateway_api(call_detail=detail)
        body = client.get(f"{BASE}/calls/41").json()
        assert body["id"] == 41 and body["request_id"] == "req-9" and body["session_id"] is None
        assert body["extra"] == {"ok": False, "error": "rate-limited", "attempt": 2}
        assert body["error"] == "rate-limited" and body["user_email"] == "a@b.c"
        assert db.log_queries[0][1] == (41,)
        assert client.get(f"{BASE}/calls/42").status_code == 404
        assert client.get(f"{BASE}/calls/abc").status_code == 422

    def test_no_database_is_503(self, gateway_api, monkeypatch):
        client, _ = gateway_api()
        monkeypatch.setattr(R, "get_pool", lambda: None)
        assert client.get(f"{BASE}/calls").status_code == 503
        assert client.get(f"{BASE}/calls/1").status_code == 503
