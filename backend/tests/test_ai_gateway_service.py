"""
The AI gateway service: who may call which model, today, with what key.

Model ids, keys, caps and prompts moved out of code and env vars into tables a
superadmin edits. What has to hold regardless:

  * a stored key is encrypted, and one that can no longer be decrypted is
    reported rather than sent;
  * stored keys win over env keys, env keys still work on their own;
  * a database the migration has not reached serves the built-in defaults
    instead of failing every AI feature;
  * refusals happen in a fixed order, with readable messages, and leave a
    not_sent row in the call log;
  * "today" is the IST day.

Everything runs against an in-memory fake of the gateway tables and ai_traces,
answering by SQL shape, as the other database tests here do.
"""

import asyncio
import base64
import hashlib
import json
import logging
from datetime import date, datetime, timezone

import httpx
import pytest
from cryptography.fernet import Fernet

from app.services import ai_gateway as G
from app.services import ai_usage

NOW = datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)      # 11:30 IST

TRACE_COLUMNS = ("endpoint", "model", "retrieval", "latency_ms", "prompt_tokens", "answer_tokens",
                 "session_id", "request_id", "query_snippet", "user_id", "extra",
                 "task", "provider", "status", "http_status")
PROVIDER_COLUMNS = ("key", "enabled", "base_url", "api_key_enc", "key_hint", "key_set_by", "key_set_at",
                    "timeout_s", "daily_request_cap", "daily_token_cap", "models",
                    "last_test_at", "last_test_ok", "last_test_ms", "last_test_error")


class UndefinedTableError(Exception):
    sqlstate = "42P01"


class UndefinedColumnError(Exception):
    sqlstate = "42703"


class _Ctx:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *exc):
        return False


class GatewayDB:
    """The gateway tables and ai_traces in memory. `missing=True` is a
    database migration 0003 never reached: no gateway tables, and ai_traces
    without the new columns."""

    def __init__(self, *, providers=(), tasks=(), settings=None, prompts=(), usage=(), missing=False):
        self.providers = {p["key"]: dict(p) for p in providers}
        self.tasks = {t["key"]: {"enabled": True, "route": None, "daily_cap": None,
                                 "prompt_version": 0, **t} for t in tasks}
        self.settings = dict(settings or {})
        self.prompts = [dict(p) for p in prompts]
        self.usage = [dict(u) for u in usage]
        self.missing = missing
        self.config_reads = 0
        self.usage_args = []
        self.executed = []

    def _check(self, sql):
        if not self.missing:
            return
        if "ai_gateway_" in sql:
            raise UndefinedTableError('relation "ai_gateway_providers" does not exist')
        if "ai_traces" in sql and "status" in sql:
            raise UndefinedColumnError('column "status" does not exist')

    async def fetch(self, sql, *args):
        await asyncio.sleep(0)
        self._check(sql)
        if "FROM ai_traces" in sql:
            self.usage_args.append(args)
            return [dict(u) for u in self.usage]
        if "JOIN ai_gateway_tasks" in sql:
            return [{"task": p["task"], "prompt": p["prompt"]} for p in self.prompts
                    if self.tasks.get(p["task"], {}).get("prompt_version") == p["version"]]
        if "FROM ai_gateway_prompts" in sql:
            (task,) = args
            rows = sorted((p for p in self.prompts if p["task"] == task), key=lambda p: -p["version"])
            return [{"version": p["version"], "created_at": p.get("created_at"),
                     "created_by": p.get("created_by"), "reverted": p["prompt"] is None,
                     "chars": len(p["prompt"] or "")} for p in rows][:50]
        if "FROM ai_gateway_providers" in sql:
            self.config_reads += 1
            return [{c: p.get(c) for c in PROVIDER_COLUMNS} for p in self.providers.values()]
        if "FROM ai_gateway_tasks" in sql:
            return [{**t, "route": None if t["route"] is None else json.dumps(t["route"])}
                    for t in self.tasks.values()]
        if "FROM ai_gateway_settings" in sql:
            return [{"key": k, "value": json.dumps(v)} for k, v in self.settings.items()]
        raise AssertionError(f"unexpected query: {sql}")

    async def fetchrow(self, sql, *args):
        self._check(sql)
        if "FROM ai_gateway_providers WHERE key = $1 FOR UPDATE" in sql:
            row = self.providers.get(args[0])
            return None if row is None else {"base_url": row.get("base_url"),
                                             "has_key": row.get("api_key_enc") is not None}
        assert "FROM ai_gateway_prompts" in sql, sql
        task, version = args
        for p in self.prompts:
            if p["task"] == task and p["version"] == version:
                return {"version": p["version"], "prompt": p["prompt"],
                        "created_at": p.get("created_at"), "created_by": p.get("created_by")}
        return None

    async def fetchval(self, sql, *args):
        self._check(sql)
        (task,) = args
        if "FOR UPDATE" in sql:
            return self.tasks[task]["prompt_version"]
        if "MAX(version)" in sql:
            return max((p["version"] for p in self.prompts if p["task"] == task), default=0) + 1
        raise AssertionError(f"unexpected query: {sql}")

    async def execute(self, sql, *args):
        self._check(sql)
        self.executed.append((sql, args))
        if sql.startswith("INSERT INTO ai_gateway_tasks (key, updated_by)"):
            self.tasks.setdefault(args[0], {"key": args[0], "enabled": True, "route": None,
                                            "daily_cap": None, "prompt_version": 0})
        elif sql.startswith("INSERT INTO ai_gateway_prompts"):
            task, version, prompt, by = args
            self.prompts.append({"task": task, "version": version, "prompt": prompt, "created_by": by,
                                 "created_at": NOW})
        elif sql.startswith("UPDATE ai_gateway_tasks SET prompt_version"):
            self.tasks[args[0]]["prompt_version"] = args[1]
        elif "UPDATE ai_gateway_providers" in sql and "api_key_enc = NULL" in sql:
            self.providers.get(args[0], {}).update(api_key_enc=None, key_hint=None, models=None)
        return "OK"

    def acquire(self):
        return _Ctx(self)

    def transaction(self):
        return _Ctx(None)

    def traces(self):
        return [dict(zip(TRACE_COLUMNS, args)) for sql, args in self.executed if "INSERT INTO ai_traces" in sql]


@pytest.fixture
def gw(monkeypatch):
    """Fresh gateway state; returns a function that installs a fake database."""
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
    monkeypatch.setattr(G.settings, "app_secret", "gateway-test-secret")
    ai_usage.bind()

    def install(db):
        monkeypatch.setattr(G, "get_pool", lambda: db)
        monkeypatch.setattr(ai_usage, "get_pool", lambda: db)
        return db

    return install


def keyed(*keys):
    """Provider rows holding a stored key each."""
    return [{"key": k, "api_key_enc": G.encrypt_key(f"{k}-stored-key-{k[:2]}12"),
             "key_hint": f"{k[:2]}12"} for k in keys]


def config():
    return asyncio.run(G.get_config())


def refused(task, **kw):
    """Run admit(); return the refusal message, or None when admitted."""
    async def go():
        try:
            await G.admit(task, **kw)
            message = None
        except G.GatewayRefused as exc:
            message = str(exc)
        await asyncio.sleep(0)       # let the fire-and-forget log write land
        return message
    return asyncio.run(go())


# ── encryption ───────────────────────────────────────────────────────────────

class TestEncryption:
    def test_round_trip(self, gw):
        token = G.encrypt_key("gsk_live_abcdefgh1234")
        assert "abcdefgh" not in token
        assert G.decrypt_key(token) == "gsk_live_abcdefgh1234"

    def test_the_key_is_derived_from_app_secret_as_specified(self, gw):
        derived = base64.urlsafe_b64encode(
            hashlib.sha256(b"fintrack-ai-gateway:v1:gateway-test-secret").digest())
        assert Fernet(derived).decrypt(G.encrypt_key("sk-or-1234").encode()) == b"sk-or-1234"

    def test_ai_gateway_secret_takes_precedence_over_app_secret(self, gw, monkeypatch):
        monkeypatch.setattr(G.settings, "ai_gateway_secret", "dedicated-secret")
        token = G.encrypt_key("sk-or-1234")
        monkeypatch.setattr(G.settings, "ai_gateway_secret", None)
        assert G.decrypt_key(token) is None
        monkeypatch.setattr(G.settings, "ai_gateway_secret", "dedicated-secret")
        monkeypatch.setattr(G.settings, "app_secret", "rotated")
        assert G.decrypt_key(token) == "sk-or-1234"

    def test_keys_saved_before_ai_gateway_secret_was_set_stay_readable(self, gw, monkeypatch):
        """Setting AI_GATEWAY_SECRET, as the docs advise, must not lock out the
        keys already saved under APP_SECRET."""
        old = G.encrypt_key("sk-or-saved-before")
        monkeypatch.setattr(G.settings, "ai_gateway_secret", "dedicated-secret")
        assert G.decrypt_key(old) == "sk-or-saved-before"
        new = G.encrypt_key("sk-or-saved-after")
        monkeypatch.setattr(G.settings, "app_secret", "rotated")
        assert G.decrypt_key(new) == "sk-or-saved-after"     # new saves use the dedicated secret
        assert G.decrypt_key(old) is None

    @pytest.mark.parametrize("garbage", ["", "not-a-token", "gAAAAA" + "x" * 80])
    def test_garbage_reads_as_none(self, gw, garbage):
        assert G.decrypt_key(garbage) is None

    def test_a_key_encrypted_under_a_rotated_secret_is_unreadable_not_sent(self, gw, monkeypatch):
        gw(GatewayDB(providers=keyed("groq")))
        monkeypatch.setattr(G.settings, "app_secret", "rotated-secret")
        groq = config().providers["groq"]
        assert groq.key_unreadable is True
        assert groq.api_key is None and groq.key_source == "none" and groq.ready is False

    def test_an_unreadable_stored_key_still_falls_back_to_env(self, gw, monkeypatch):
        gw(GatewayDB(providers=keyed("groq")))
        monkeypatch.setattr(G.settings, "app_secret", "rotated-secret")
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-from-env-9876")
        groq = config().providers["groq"]
        assert groq.key_unreadable is True
        assert groq.key_source == "env" and groq.api_key == "gsk-from-env-9876" and groq.ready

    def test_set_key_stores_ciphertext_and_a_hint_only(self, gw):
        db = gw(GatewayDB())
        hint = asyncio.run(G.set_provider_key("openrouter", "  sk-or-v1-secretvalue-WXYZ \n", "a@b.c"))
        assert hint == "WXYZ"
        sql, args = db.executed[-1]
        assert "sk-or-v1-secretvalue-WXYZ" not in repr(args)
        assert G.decrypt_key(args[1]) == "sk-or-v1-secretvalue-WXYZ"
        assert args[2] == "WXYZ" and args[3] == "a@b.c"
        assert "last_test_ok = NULL" in sql

    @pytest.mark.parametrize("bad", ["short", "has space inside-key", "x" * 401, None, 12345678,
                                     "gsk_THISISTHESECRETKEY\x00", "gsk_tab\tinside_key", "gsk_clé_accentuée"])
    def test_set_key_rejects_malformed_keys(self, gw, bad):
        db = gw(GatewayDB())
        with pytest.raises(ValueError) as exc:
            asyncio.run(G.set_provider_key("groq", bad, "a@b.c"))
        assert "THISISTHESECRETKEY" not in str(exc.value)
        assert db.executed == []

    def test_a_key_that_cannot_go_in_a_header_is_not_used(self, gw, monkeypatch):
        """Sending it would fail in the HTTP library with an error that quotes
        the header, key included."""
        gw(GatewayDB(providers=[{"key": "groq", "api_key_enc": G.encrypt_key("gsk_stored_with_nul\x00"),
                                 "key_hint": "nul"}]))
        monkeypatch.setattr(G.settings, "openrouter_api_key", "sk-or-env\x00key")
        cfg = config()
        assert cfg.providers["groq"].api_key is None and cfg.providers["groq"].key_unreadable is True
        assert cfg.providers["openrouter"].api_key is None
        assert cfg.providers["openrouter"].key_source == "none"


# ── key resolution ───────────────────────────────────────────────────────────

class TestKeyResolution:
    def test_a_stored_key_beats_the_env_key(self, gw, monkeypatch):
        gw(GatewayDB(providers=keyed("groq")))
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-from-env-9876")
        groq = config().providers["groq"]
        assert groq.key_source == "stored"
        assert groq.api_key == "groq-stored-key-gr12" and groq.key_hint == "gr12"

    def test_the_env_key_is_used_when_nothing_is_stored(self, gw, monkeypatch):
        gw(GatewayDB())
        monkeypatch.setattr(G.settings, "openrouter_api_key", "sk-or-env-5678")
        p = config().providers["openrouter"]
        assert p.key_source == "env" and p.api_key == "sk-or-env-5678" and p.key_hint == "5678"
        assert p.ready

    def test_the_env_key_is_never_sent_to_another_host(self, gw, monkeypatch):
        gw(GatewayDB(providers=[{"key": "groq", "base_url": "https://attacker.example/v1"},
                                {"key": "openrouter", "base_url": "https://openrouter.ai/api/v2"}]))
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-from-env-9876")
        monkeypatch.setattr(G.settings, "openrouter_api_key", "sk-or-env-5678")
        cfg = config()
        groq = cfg.providers["groq"]
        assert groq.base_url == "https://attacker.example/v1"
        assert groq.api_key is None and groq.key_source == "none" and not groq.ready
        # Another path on the provider's own host keeps the env key.
        assert cfg.providers["openrouter"].api_key == "sk-or-env-5678"

    def test_a_stored_base_url_that_fails_validation_is_not_used(self, gw):
        gw(GatewayDB(providers=[{"key": "groq", "base_url": "https://user:pw@127.0.0.1:6379"}]))
        assert config().providers["groq"].base_url == "https://api.groq.com/openai/v1"

    def test_redact_masks_the_key_and_any_bearer_token(self, gw):
        gw(GatewayDB(providers=keyed("groq")))
        groq = config().providers["groq"]
        text = G.redact("Illegal header value b'Bearer groq-stored-key-gr12\\x00'; key groq-stored-key-gr12", groq)
        assert "groq-stored-key" not in text and "Bearer ****" in text

    def test_no_key_anywhere_is_none_and_not_ready(self, gw):
        gw(GatewayDB())
        p = config().providers["groq"]
        assert p.key_source == "none" and p.api_key is None and p.key_hint is None
        assert not p.ready

    def test_a_provider_switched_off_is_not_ready_even_with_a_key(self, gw):
        gw(GatewayDB(providers=[{**keyed("groq")[0], "enabled": False}]))
        p = config().providers["groq"]
        assert p.api_key and not p.ready

    def test_the_key_never_appears_in_repr(self, gw):
        gw(GatewayDB(providers=keyed("groq")))
        assert "groq-stored-key" not in repr(config().providers["groq"])

    def test_provider_key_and_readiness_helpers(self, gw, monkeypatch):
        gw(GatewayDB())
        assert asyncio.run(G.any_provider_ready()) is False
        assert asyncio.run(G.provider_key("openrouter")) is None
        monkeypatch.setattr(G.settings, "openrouter_api_key", "sk-or-env-5678")
        G.invalidate()
        assert asyncio.run(G.any_provider_ready()) is True
        assert asyncio.run(G.provider_key("openrouter")) == "sk-or-env-5678"

    def test_headers_and_urls_follow_the_provider(self, gw):
        gw(GatewayDB(providers=[*keyed("groq", "openrouter")]))
        cfg = config()
        groq, orr = cfg.providers["groq"], cfg.providers["openrouter"]
        assert G.chat_url(groq) == "https://api.groq.com/openai/v1/chat/completions"
        assert G.chat_url(orr) == "https://openrouter.ai/api/v1/chat/completions"
        assert G.headers_for(groq) == {"Authorization": "Bearer groq-stored-key-gr12",
                                       "Content-Type": "application/json"}
        h = G.headers_for(orr)
        assert h["X-Title"] == "FinTrack AI" and h["HTTP-Referer"].startswith("https://")
        assert G.timeout_for(groq).read == 30 and G.timeout_for(orr).read == 45
        assert G.timeout_for(groq).connect == 10
        # With less time left than the timeout, the request gets only that.
        assert G.timeout_for(orr, 12.5).read == 12.5 and G.timeout_for(orr, 12.5).connect == 10
        assert G.timeout_for(orr, 4).connect == 4 and G.timeout_for(orr, -3).read == 1


# ── storage that is not there yet ────────────────────────────────────────────

class TestDefaultsWithoutStorage:
    def test_missing_tables_serve_the_built_in_defaults_and_env_keys(self, gw, monkeypatch):
        gw(GatewayDB(missing=True))
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-from-env-9876")
        cfg = config()
        assert cfg.storage_ok is False
        assert cfg.providers["groq"].ready and cfg.providers["groq"].key_source == "env"
        assert cfg.global_caps == {"daily_call_cap": None, "daily_token_cap": None}
        assert all(t.enabled and t.daily_cap is None and t.prompt_override is None
                   for t in cfg.tasks.values())
        assert cfg.tasks["chat"].route == list(G.DEFAULT_ROUTE)
        assert cfg.tasks["invoice_parse"].route[0] == {"provider": "openrouter",
                                                       "model": "google/gemma-4-31b-it:free"}

    def test_no_database_at_all_is_the_same(self, gw, monkeypatch):
        monkeypatch.setattr(G, "get_pool", lambda: None)
        cfg = config()
        assert cfg.storage_ok is False and set(cfg.tasks) == set(G.TASKS)

    def test_an_unexpected_database_error_never_raises(self, gw):
        class Broken(GatewayDB):
            async def fetch(self, sql, *args):
                raise ConnectionResetError("gone")
        gw(Broken())
        assert config().storage_ok is False

    def test_a_database_blip_keeps_the_last_settings_read(self, gw):
        """Falling back to the defaults here would switch back on what a
        superadmin switched off, lift every cap and lose the stored keys."""
        class Flaky(GatewayDB):
            down = False

            async def fetch(self, sql, *args):
                if self.down and "ai_gateway_" in sql:
                    raise ConnectionResetError("connection lost")
                return await super().fetch(sql, *args)

        db = gw(Flaky(providers=keyed("groq"), tasks=[{"key": "invoice_parse", "enabled": False}],
                      settings={"daily_call_cap": 10}))
        assert config().storage_ok is True
        db.down = True
        cfg = asyncio.run(G.get_config(force=True))
        assert cfg.storage_ok is True
        assert cfg.providers["groq"].api_key == "groq-stored-key-gr12" and cfg.providers["groq"].ready
        assert cfg.tasks["invoice_parse"].enabled is False
        assert cfg.global_caps["daily_call_cap"] == 10
        assert refused("invoice_parse") == ("AI for Read an invoice into fields is switched off "
                                            "by the administrator.")
        # Kept only briefly: the next caller reads again.
        assert G._config_expires - __import__("time").monotonic() <= G._FALLBACK_TTL_S
        db.down = False
        db.tasks["invoice_parse"]["enabled"] = True
        G._config_expires = 0.0
        assert config().tasks["invoice_parse"].enabled is True

    def test_missing_tables_after_a_good_read_still_serve_the_defaults(self, gw):
        db = gw(GatewayDB(tasks=[{"key": "chat", "enabled": False}]))
        assert config().tasks["chat"].enabled is False
        db.missing = True
        cfg = asyncio.run(G.get_config(force=True))
        assert cfg.storage_ok is False and cfg.tasks["chat"].enabled is True

    def test_features_still_run_on_the_defaults(self, gw, monkeypatch):
        gw(GatewayDB(missing=True))
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk-from-env-9876")
        assert refused("chat") is None
        steps = asyncio.run(G.route_specs("chat"))
        assert [(s.provider.key, s.model) for s in steps][0] == ("groq", "openai/gpt-oss-120b")

    @pytest.mark.parametrize("write", [
        lambda: G.save_task("chat", {"enabled": False}, "a@b.c"),
        lambda: G.save_provider("groq", {"timeout_s": 20}, "a@b.c"),
        lambda: G.set_provider_key("groq", "gsk-12345678", "a@b.c"),
        lambda: G.save_prompt("chat", "Be brief.", "a@b.c"),
        lambda: G.save_global({"daily_call_cap": 10}, "a@b.c"),
    ])
    def test_writes_say_storage_is_not_ready(self, gw, write):
        gw(GatewayDB(missing=True))
        with pytest.raises(G.StorageNotReady) as exc:
            asyncio.run(write())
        assert str(exc.value) == "AI gateway storage is not ready (database migration 0003 has not run)."

    def test_reads_of_prompt_history_degrade_to_empty(self, gw):
        gw(GatewayDB(missing=True))
        assert asyncio.run(G.prompt_history("chat")) == []
        assert asyncio.run(G.prompt_version("chat", 1)) is None


class TestConfigCache:
    def test_reads_are_cached_and_a_write_invalidates(self, gw):
        db = gw(GatewayDB())
        config()
        config()
        assert db.config_reads == 1
        asyncio.run(G.save_task("chat", {"daily_cap": 5}, "a@b.c"))
        config()
        assert db.config_reads == 2

    def test_a_cold_burst_reads_once(self, gw):
        db = gw(GatewayDB())

        async def burst():
            return await asyncio.gather(*(G.get_config() for _ in range(8)))

        results = asyncio.run(burst())
        assert db.config_reads == 1
        assert all(r is results[0] for r in results)

    def test_force_reads_again(self, gw):
        db = gw(GatewayDB())
        config()
        asyncio.run(G.get_config(force=True))
        assert db.config_reads == 2

    def test_stored_overrides_are_applied(self, gw):
        gw(GatewayDB(
            providers=[{"key": "groq", "enabled": False, "base_url": "https://gw.example/v1/",
                        "timeout_s": 500, "daily_request_cap": 40, "daily_token_cap": 0}],
            tasks=[{"key": "judge", "enabled": False, "daily_cap": 3,
                    "route": [{"provider": "openrouter", "model": "openrouter/free"}]}],
            settings={"daily_call_cap": 100, "daily_token_cap": None},
        ))
        cfg = config()
        groq = cfg.providers["groq"]
        assert groq.enabled is False and groq.base_url == "https://gw.example/v1"
        assert groq.timeout_s == 120                      # clamped to the allowed range
        assert groq.daily_request_cap == 40 and groq.daily_token_cap is None
        judge = cfg.tasks["judge"]
        assert judge.enabled is False and judge.daily_cap == 3
        assert judge.route == [{"provider": "openrouter", "model": "openrouter/free"}]
        assert cfg.global_caps == {"daily_call_cap": 100, "daily_token_cap": None}


# ── admission ────────────────────────────────────────────────────────────────

def usage_rows(**by_task):
    """ai_traces aggregate rows: task=(provider, calls, tokens)."""
    return [{"task": t, "provider": p, "calls": c, "tokens": tok} for t, (p, c, tok) in by_task.items()]


class TestAdmit:
    def test_a_refusal_is_a_value_error(self):
        assert issubclass(G.GatewayRefused, ValueError)

    def test_a_ready_task_under_every_cap_is_admitted_silently(self, gw):
        db = gw(GatewayDB(providers=keyed("groq"), settings={"daily_call_cap": 50},
                          usage=usage_rows(chat=("groq", 10, 1000))))
        assert refused("chat") is None
        assert db.traces() == []

    def test_a_switched_off_task_is_refused_and_logged_not_sent(self, gw):
        db = gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "enabled": False}]))
        assert refused("chat") == "AI for AI assistant chat is switched off by the administrator."
        (row,) = db.traces()
        assert row["status"] == "not_sent" and row["task"] == "chat"
        assert row["provider"] is None and row["model"] is None and row["latency_ms"] == 0
        assert json.loads(row["extra"]) == {
            "ok": False, "error": "AI for AI assistant chat is switched off by the administrator."}

    def test_the_admin_test_button_bypasses_the_switch(self, gw):
        gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "enabled": False}]))
        assert refused("chat", bypass_enabled=True) is None

    def test_the_switch_is_checked_before_any_cap(self, gw):
        gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "enabled": False, "daily_cap": 1}],
                     settings={"daily_call_cap": 1}, usage=usage_rows(chat=("groq", 5, 0))))
        assert "switched off" in refused("chat")

    def test_the_workspace_call_cap(self, gw):
        db = gw(GatewayDB(providers=keyed("groq"), settings={"daily_call_cap": 10},
                          usage=usage_rows(chat=("groq", 6, 0), judge=("groq", 4, 0))))
        assert refused("judge") == ("Today's AI limit for the workspace has been reached. "
                                    "It resets at midnight IST.")
        assert db.traces()[0]["status"] == "not_sent"

    def test_the_workspace_token_cap(self, gw):
        gw(GatewayDB(providers=keyed("groq"), settings={"daily_token_cap": 5000},
                     usage=usage_rows(chat=("groq", 2, 5000))))
        assert refused("chat") == ("Today's AI limit for the workspace has been reached. "
                                   "It resets at midnight IST.")

    def test_the_workspace_cap_is_checked_before_the_task_cap(self, gw):
        gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "daily_cap": 2}],
                     settings={"daily_call_cap": 3}, usage=usage_rows(chat=("groq", 3, 0))))
        assert "for the workspace" in refused("chat")

    def test_the_task_cap_stops_only_that_task(self, gw):
        gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "daily_cap": 3}],
                     usage=usage_rows(chat=("groq", 3, 0))))
        assert refused("chat") == ("Today's AI limit for AI assistant chat has been reached. "
                                   "It resets at midnight IST.")
        assert refused("judge") is None

    def test_no_provider_ready_is_refused_and_logged(self, gw):
        db = gw(GatewayDB())
        assert refused("invoice_parse") == ("No AI provider is available for Read an invoice into "
                                            "fields. An administrator can check Admin → AI gateway.")
        (row,) = db.traces()
        assert row["status"] == "not_sent" and row["task"] == "invoice_parse"

    def test_every_route_provider_at_its_cap_is_no_provider(self, gw):
        db = gw(GatewayDB(
            providers=[{**keyed("groq")[0], "daily_request_cap": 5},
                       {**keyed("openrouter")[0], "daily_token_cap": 1000}],
            usage=[{"task": "chat", "provider": "groq", "calls": 5, "tokens": 10},
                   {"task": "chat", "provider": "openrouter", "calls": 1, "tokens": 1000}],
        ))
        assert refused("chat").startswith("No AI provider is available for AI assistant chat.")
        assert db.traces()[0]["status"] == "not_sent"

    def test_one_provider_at_its_cap_leaves_the_other(self, gw):
        gw(GatewayDB(providers=[{**keyed("groq")[0], "daily_request_cap": 5}, *keyed("openrouter")],
                     usage=usage_rows(chat=("groq", 5, 0))))
        assert refused("chat") is None
        assert asyncio.run(G.provider_has_capacity("groq")) is False
        assert asyncio.run(G.provider_has_capacity("openrouter")) is True

    def test_a_disabled_provider_is_skipped_like_a_missing_key(self, gw):
        gw(GatewayDB(providers=[{**keyed("groq")[0], "enabled": False}],
                     tasks=[{"key": "chat", "route": [{"provider": "groq", "model": "openai/gpt-oss-20b"}]}]))
        assert refused("chat").startswith("No AI provider is available")

    def test_local_increments_count_before_the_log_catches_up(self, gw):
        gw(GatewayDB(providers=keyed("groq"), tasks=[{"key": "chat", "daily_cap": 2}],
                     usage=usage_rows(chat=("groq", 1, 0))))
        assert refused("chat") is None
        G.note_usage("chat", "groq", 120, ok=False)
        assert refused("chat").startswith("Today's AI limit for AI assistant chat")

    def test_usage_is_not_read_when_nothing_is_capped(self, gw):
        db = gw(GatewayDB(providers=keyed("groq")))
        refused("chat")
        assert db.usage_args == []


class TestUsageToday:
    def test_rows_and_local_increments_add_up(self, gw):
        gw(GatewayDB(usage=[{"task": "chat", "provider": "groq", "calls": 3, "tokens": 900},
                            {"task": "judge", "provider": "openrouter", "calls": 1, "tokens": 100},
                            {"task": None, "provider": None, "calls": 2, "tokens": 50}]))
        first = asyncio.run(G.usage_today())
        G.note_usage("chat", "groq", 300, ok=True)
        usage = asyncio.run(G.usage_today())
        assert first["calls"] == 6
        assert usage["calls"] == 7 and usage["tokens"] == 1350
        assert usage["by_task"]["chat"] == {"calls": 4, "tokens": 1200}
        assert usage["by_provider"]["openrouter"] == {"calls": 1, "tokens": 100}

    def test_the_query_ignores_not_sent_rows(self, gw):
        assert "status <> 'not_sent'" in G._SQL_USAGE

    def test_a_failed_read_keeps_local_counts(self, gw):
        gw(GatewayDB(missing=True))
        G.note_usage("chat", "groq", 10, ok=True)
        assert asyncio.run(G.usage_today())["calls"] == 1

    def test_the_query_counts_the_requests_an_attempt_sent(self, gw):
        assert "extra->>'requests'" in G._SQL_USAGE
        gw(GatewayDB(missing=True))
        G.note_usage("chat", "groq", 0, ok=False, calls=3)
        assert asyncio.run(G.usage_today())["by_provider"]["groq"]["calls"] == 3

    def test_attempts_whose_row_has_not_landed_still_count_after_a_read(self, gw):
        """The log row is written in the background, so a read can run before
        it lands. Dropping the local count then would let a burst pass a cap."""
        class SlowLog(GatewayDB):
            rows = 0

            async def fetch(self, sql, *args):
                if "FROM ai_traces" in sql:
                    return [{"task": "chat", "provider": "groq", "calls": self.rows, "tokens": 0}] \
                        if self.rows else []
                return await super().fetch(sql, *args)

        db = gw(SlowLog(providers=[{**keyed("groq")[0], "daily_request_cap": 2}]))

        async def go():
            pending = [G.note_usage("chat", "groq", 0, ok=False) for _ in range(2)]
            G._usage_expires = 0.0                       # the 5 s cache has run out
            assert await G.provider_has_capacity("groq") is False
            assert (await G.usage_today())["by_provider"]["groq"]["calls"] == 2
            # The rows land; a read after that counts them once, not twice.
            db.rows = 2
            for written in pending:
                written()
            await asyncio.sleep(0.01)
            G._usage_expires = 0.0
            return await G.usage_today()

        assert asyncio.run(go())["by_provider"]["groq"]["calls"] == 2


# ── routes ───────────────────────────────────────────────────────────────────

class TestRouteSpecs:
    def test_steps_come_in_route_order_with_attempt_numbers(self, gw):
        gw(GatewayDB(providers=keyed("groq")))
        steps = asyncio.run(G.route_specs("chat"))
        assert [(s.provider.key, s.model, s.attempt) for s in steps] == [
            ("groq", "openai/gpt-oss-120b", 1), ("groq", "openai/gpt-oss-20b", 2),
            ("openrouter", "openrouter/free", 3)]
        assert steps[2].provider.ready is False        # returned anyway, for the error list

    def test_vision_puts_image_capable_models_first_and_keeps_the_rest(self, gw):
        route = [{"provider": "groq", "model": "openai/gpt-oss-120b"},
                 {"provider": "openrouter", "model": "google/gemma-4-31b-it:free"},
                 {"provider": "openrouter", "model": "openrouter/free"},
                 {"provider": "groq", "model": "meta-llama/llama-4-scout-17b-16e-instruct"}]
        gw(GatewayDB(providers=keyed("groq", "openrouter"),
                     tasks=[{"key": "invoice_parse", "route": route}]))
        plain = asyncio.run(G.route_specs("invoice_parse"))
        vision = asyncio.run(G.route_specs("invoice_parse", vision=True))
        assert [s.model for s in plain] == [s["model"] for s in route]
        assert [s.model for s in vision] == [
            "google/gemma-4-31b-it:free", "meta-llama/llama-4-scout-17b-16e-instruct",
            "openai/gpt-oss-120b", "openrouter/free"]
        assert [s.attempt for s in vision] == [1, 2, 3, 4]

    def test_the_stored_model_list_outranks_the_id_hints(self, gw):
        route = [{"provider": "groq", "model": "openai/gpt-oss-120b"},
                 {"provider": "openrouter", "model": "google/gemma-4-31b-it:free"},
                 {"provider": "openrouter", "model": "openrouter/free"}]
        models = [{"id": "openrouter/free", "context": 200000, "vision": True, "free": True},
                  {"id": "google/gemma-4-31b-it:free", "context": 262144, "vision": False, "free": True}]
        gw(GatewayDB(providers=[{**keyed("openrouter")[0], "models": json.dumps(models)}],
                     tasks=[{"key": "invoice_parse", "route": route}]))
        vision = asyncio.run(G.route_specs("invoice_parse", vision=True))
        assert [s.model for s in vision] == ["openrouter/free", "openai/gpt-oss-120b",
                                             "google/gemma-4-31b-it:free"]

    def test_a_stored_step_with_an_unknown_provider_is_skipped(self, gw):
        gw(GatewayDB(tasks=[{"key": "chat", "route": [{"provider": "acme", "model": "m"},
                                                      {"provider": "groq", "model": "openai/gpt-oss-20b"}]}]))
        steps = asyncio.run(G.route_specs("chat"))
        assert [(s.provider.key, s.attempt) for s in steps] == [("groq", 1)]


class TestSystemPrompt:
    def _db(self, task, prompts, version):
        return GatewayDB(tasks=[{"key": task, "prompt_version": version}],
                         prompts=[{"task": task, "version": v, "prompt": p} for v, p in prompts])

    def test_the_active_override_replaces_the_default(self, gw):
        gw(self._db("chat", [(1, "Old."), (2, "Answer like a CFO.")], 2))
        cfg = config()
        assert G.system_prompt("chat", "DEFAULT") == "Answer like a CFO."
        assert G.system_prompt("chat", "DEFAULT", cfg) == "Answer like a CFO."
        assert G.system_prompt("judge", "JUDGE DEFAULT") == "JUDGE DEFAULT"

    def test_a_reverted_version_means_the_built_in_prompt(self, gw):
        gw(self._db("chat", [(1, "Answer like a CFO."), (2, None)], 2))
        config()
        assert G.system_prompt("chat", "DEFAULT") == "DEFAULT"

    def test_a_task_whose_prompt_is_built_from_live_data_ignores_overrides(self, gw):
        gw(self._db("page_build", [(1, "Ignore the design rules.")], 1))
        config()
        assert G.system_prompt("page_build", "RULES") == "RULES"

    def test_before_any_load_the_default_is_used(self, gw):
        assert G.system_prompt("chat", "DEFAULT") == "DEFAULT"


class TestPromptVersions:
    def test_saving_creates_the_next_version_and_activates_it(self, gw):
        db = gw(GatewayDB())
        assert asyncio.run(G.save_prompt("judge", "Be strict.", "a@b.c")) == 1
        assert asyncio.run(G.save_prompt("judge", "Be stricter.", "a@b.c")) == 2
        assert db.tasks["judge"]["prompt_version"] == 2
        assert G.system_prompt("judge", "D", config()) == "Be stricter."

    def test_null_or_blank_goes_back_to_built_in_as_a_new_version(self, gw):
        db = gw(GatewayDB())
        asyncio.run(G.save_prompt("chat", "Custom.", "a@b.c"))
        assert asyncio.run(G.save_prompt("chat", "   ", "b@c.d")) == 2
        assert G.system_prompt("chat", "D", config()) == "D"
        history = asyncio.run(G.prompt_history("chat"))
        assert [(h["version"], h["reverted"], h["chars"], h["created_by"]) for h in history] == [
            (2, True, 0, "b@c.d"), (1, False, 7, "a@b.c")]
        assert history[0]["created_at"] == NOW.isoformat()
        assert asyncio.run(G.prompt_version("chat", 1))["prompt"] == "Custom."
        assert asyncio.run(G.prompt_version("chat", 2))["prompt"] is None
        assert asyncio.run(G.prompt_version("chat", 9)) is None
        assert db.tasks["chat"]["prompt_version"] == 2

    def test_view_only_tasks_refuse_overrides(self, gw):
        gw(GatewayDB())
        for task in ("page_build", "studio_analyze"):
            with pytest.raises(ValueError):
                asyncio.run(G.save_prompt(task, "x", "a@b.c"))

    def test_the_length_limit(self, gw):
        gw(GatewayDB())
        with pytest.raises(ValueError):
            asyncio.run(G.save_prompt("chat", "x" * 20_001, "a@b.c"))
        assert asyncio.run(G.save_prompt("chat", "x" * 20_000, "a@b.c")) == 1


# ── writes ───────────────────────────────────────────────────────────────────

class TestWrites:
    def test_save_task_writes_only_the_given_fields(self, gw):
        db = gw(GatewayDB())
        route = [{"provider": "openrouter", "model": " openrouter/free "}]
        asyncio.run(G.save_task("chat", {"route": route, "daily_cap": None}, "a@b.c"))
        sql, args = db.executed[-1]
        assert "INSERT INTO ai_gateway_tasks (key, route, daily_cap, updated_by, updated_at)" in sql
        assert "$2::jsonb" in sql and "enabled" not in sql
        assert args == ("chat", json.dumps([{"provider": "openrouter", "model": "openrouter/free"}]),
                        None, "a@b.c")

    def test_save_provider_normalises_the_base_url(self, gw):
        db = gw(GatewayDB())
        asyncio.run(G.save_provider("groq", {"base_url": "https://proxy.example/v1/", "enabled": False},
                                    "a@b.c"))
        (args,) = [a for sql, a in db.executed if sql.startswith("INSERT INTO ai_gateway_providers")]
        assert args == ("groq", False, "https://proxy.example/v1", "a@b.c")

    def test_a_new_host_drops_the_stored_key_and_the_same_host_keeps_it(self, gw):
        db = gw(GatewayDB(providers=keyed("groq")))
        assert asyncio.run(G.save_provider("groq", {"base_url": "https://api.groq.com/openai/v2"},
                                           "a@b.c")) is False
        assert db.providers["groq"]["api_key_enc"] is not None
        assert asyncio.run(G.save_provider("groq", {"base_url": "https://proxy.example/v1"},
                                           "a@b.c")) is True
        assert db.providers["groq"]["api_key_enc"] is None
        forget = [sql for sql, _ in db.executed if sql.lstrip().startswith("UPDATE ai_gateway_providers")]
        assert len(forget) == 1 and "models = NULL" in forget[0]
        # Settings that leave the URL alone never touch the key.
        db.executed.clear()
        asyncio.run(G.save_provider("groq", {"timeout_s": 20}, "a@b.c"))
        assert [sql.split("(")[0].strip() for sql, _ in db.executed] == ["INSERT INTO ai_gateway_providers"]

    def test_save_global_stores_json_values(self, gw):
        db = gw(GatewayDB())
        asyncio.run(G.save_global({"daily_call_cap": 500, "daily_token_cap": None}, "a@b.c"))
        assert [a for _, a in db.executed] == [("daily_call_cap", "500", "a@b.c"),
                                              ("daily_token_cap", "null", "a@b.c")]

    def test_unknown_keys_are_lookup_errors(self, gw):
        gw(GatewayDB())
        with pytest.raises(KeyError):
            asyncio.run(G.save_provider("openai", {"enabled": True}, "a@b.c"))
        with pytest.raises(KeyError):
            asyncio.run(G.save_task("nope", {"enabled": True}, "a@b.c"))

    @pytest.mark.parametrize("route", [
        [],
        [{"provider": "groq", "model": "m"}] * 7,
        [{"provider": "openai", "model": "gpt-4o"}],
        [{"provider": "groq", "model": ""}],
        [{"provider": "groq", "model": "bad model"}],
        [{"provider": "groq", "model": "a" * 121}],
        [{"provider": "groq", "model": "~openai/gpt-latest"}],
        ["groq/openai/gpt-oss-120b"],
        "groq",
    ])
    def test_bad_routes_are_rejected(self, route):
        with pytest.raises(ValueError):
            G.validate_route(route)

    @pytest.mark.parametrize("patch", [
        {"timeout_s": 4}, {"timeout_s": 121}, {"timeout_s": True}, {"timeout_s": "30"},
        {"daily_request_cap": 0}, {"daily_token_cap": -5}, {"daily_request_cap": 1.5},
        {"base_url": "http://api.groq.com/openai/v1"}, {"base_url": "https://"},
        {"base_url": "https://" + "a" * 200}, {"base_url": "https://a b.example"},
        {"enabled": "yes"}, {"api_key": "x"},
        # Shapes that would carry the key somewhere it should not go.
        {"base_url": "https://user:sk-secret@proxy.example"}, {"base_url": "https://127.0.0.1:6379"},
        {"base_url": "https://169.254.169.254/latest"}, {"base_url": "https://[::1]/v1"},
        {"base_url": "https://localhost/v1"}, {"base_url": "https://internal/x#"},
        {"base_url": "https://internal.svc/admin/secret#"}, {"base_url": "https://h.example/x?a="},
        {"base_url": "https://metadata.google.internal"}, {"base_url": "https://printer.local/v1"},
        {"base_url": "https://api.groq.com:8443/openai/v1"}, {"base_url": "https://evil.example\\@good.example"},
    ])
    def test_bad_provider_settings_are_rejected(self, patch):
        with pytest.raises(ValueError):
            G.validate_provider_patch(patch)

    @pytest.mark.parametrize("url", ["https://api.groq.com/openai/v1", "https://openrouter.ai/api/v1/",
                                     "https://gateway.ai.cloudflare.com/v1/acct-1/gw/openai",
                                     "https://api.groq.com:443/openai/v1"])
    def test_ordinary_base_urls_pass(self, url):
        assert G.validate_base_url(url) == url.rstrip("/")

    def test_good_provider_settings_pass(self):
        assert G.validate_provider_patch({"timeout_s": 5, "daily_request_cap": None,
                                          "daily_token_cap": 2_000_000, "base_url": ""}) == {
            "timeout_s": 5, "daily_request_cap": None, "daily_token_cap": 2_000_000, "base_url": None}

    @pytest.mark.parametrize("patch", [{"daily_call_cap": 0}, {"daily_token_cap": "9"}, {"other": 1}])
    def test_bad_global_caps_are_rejected(self, patch):
        with pytest.raises(ValueError):
            G.validate_global_patch(patch)


# ── route warnings ───────────────────────────────────────────────────────────

class TestRouteWarnings:
    def _cfg(self, gw, providers, route):
        gw(GatewayDB(providers=providers, tasks=[{"key": "chat", "route": route}]))
        cfg = config()
        return G.route_warnings(cfg.tasks["chat"], cfg)

    def test_a_clean_route_has_none(self, gw):
        assert self._cfg(gw, keyed("groq", "openrouter"), list(G.DEFAULT_ROUTE)) == []

    def test_a_provider_without_a_key(self, gw):
        assert self._cfg(gw, keyed("groq"), [{"provider": "openrouter", "model": "openrouter/free"}]) == [
            {"index": 0, "level": "error", "message": "No key set (OPENROUTER_API_KEY)"}]

    def test_an_unreadable_key_says_so(self, gw, monkeypatch):
        providers = keyed("groq")
        monkeypatch.setattr(G.settings, "app_secret", "rotated")
        warnings = self._cfg(gw, providers, [{"provider": "groq", "model": "openai/gpt-oss-20b"}])
        assert warnings == [{"index": 0, "level": "error",
                             "message": "Stored key can't be read — set it again"}]

    def test_a_provider_switched_off_is_a_warning(self, gw):
        warnings = self._cfg(gw, [{**keyed("groq")[0], "enabled": False}],
                             [{"provider": "groq", "model": "openai/gpt-oss-20b"}])
        assert warnings == [{"index": 0, "level": "warn", "message": "Provider is off"}]

    def test_a_model_the_provider_does_not_offer(self, gw):
        models = json.dumps([{"id": "openai/gpt-oss-120b", "context": 131072, "vision": None, "free": None}])
        provider = {**keyed("groq")[0], "models": models, "last_test_at": NOW, "last_test_ok": True}
        warnings = self._cfg(gw, [provider], [{"provider": "groq", "model": "openai/gpt-oss-120b"},
                                              {"provider": "groq", "model": "llama-3.3-70b-versatile"}])
        assert warnings == [{"index": 1, "level": "error",
                             "message": "Not offered by Groq — calls to it will fail"}]

    def test_a_failed_last_test_does_not_condemn_models(self, gw):
        models = json.dumps([{"id": "openai/gpt-oss-120b", "context": None, "vision": None, "free": None}])
        provider = {**keyed("groq")[0], "models": models, "last_test_at": NOW, "last_test_ok": False}
        assert self._cfg(gw, [provider], [{"provider": "groq", "model": "something-else"}]) == []

    def test_an_unknown_provider_is_an_error(self, gw):
        warnings = self._cfg(gw, keyed("groq"), [{"provider": "acme", "model": "m"}])
        assert warnings == [{"index": 0, "level": "error", "message": "Unknown provider acme"}]


# ── model lists and the connection test ──────────────────────────────────────

OPENROUTER_MODELS = {"data": [
    {"id": "openai/gpt-oss-120b", "context_length": 131072,
     "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
     "pricing": {"prompt": "0.00000015", "completion": "0.0000006"}},
    {"id": "openrouter/free", "context_length": 200000,
     "architecture": {"input_modalities": ["text", "image"]},
     "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "google/gemma-4-31b-it:free", "context_length": 262144,
     "architecture": {"input_modalities": ["image", "text", "video"]},
     "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "acme/zero-priced", "context_length": 8192,
     "architecture": {"input_modalities": ["text"]}, "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "meta-llama/llama-guard-4-12b", "context_length": 163840,
     "architecture": {"input_modalities": ["text", "image"]}, "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "openai/text-embedding-3-small", "pricing": {"prompt": "0.00000002", "completion": "0"}},
    {"id": "~openai/gpt-luna-latest", "context_length": 400000,
     "architecture": {"input_modalities": ["text"]}, "pricing": {"prompt": "0.000001", "completion": "0.000004"}},
    {"id": "openai/gpt-oss-120b", "context_length": 1},
]}

GROQ_MODELS = {"object": "list", "data": [
    {"id": "openai/gpt-oss-120b", "object": "model", "owned_by": "OpenAI", "active": True,
     "context_window": 131072, "max_completion_tokens": 65536},
    {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "object": "model", "active": True,
     "context_window": 131072},
    {"id": "groq/compound", "object": "model", "active": True, "context_window": 131072},
    {"id": "whisper-large-v3", "object": "model", "active": True, "context_window": 448},
    {"id": "playai-tts", "object": "model", "active": True, "context_window": 8192},
    {"id": "canopylabs/orpheus-v1-english", "object": "model", "active": True},
    {"id": "meta-llama/llama-guard-4-12b", "object": "model", "active": True, "context_window": 131072},
    {"id": "openai/gpt-oss-20b", "object": "model", "active": False, "context_window": 131072},
]}


class TestModelLists:
    def test_an_openrouter_list(self):
        assert G.parse_models("openrouter", OPENROUTER_MODELS) == [
            {"id": "acme/zero-priced", "context": 8192, "vision": False, "free": True},
            {"id": "google/gemma-4-31b-it:free", "context": 262144, "vision": True, "free": True},
            {"id": "openrouter/free", "context": 200000, "vision": True, "free": True},
            {"id": "openai/gpt-oss-120b", "context": 131072, "vision": False, "free": False},
        ]

    def test_a_groq_list(self):
        assert G.parse_models("groq", GROQ_MODELS) == [
            {"id": "groq/compound", "context": 131072, "vision": None, "free": None},
            {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "context": 131072, "vision": True,
             "free": None},
            {"id": "openai/gpt-oss-120b", "context": 131072, "vision": None, "free": None},
        ]

    def test_at_most_600_are_kept(self):
        payload = {"data": [{"id": f"acme/model-{i:04d}"} for i in range(700)]}
        models = G.parse_models("groq", payload)
        assert len(models) == 600 and models[0]["id"] == "acme/model-0000"

    @pytest.mark.parametrize("payload", [None, {}, {"data": "x"}, "text", 42])
    def test_odd_payloads_parse_to_nothing(self, payload):
        assert G.parse_models("openrouter", payload) == []


class FakeResponse:
    def __init__(self, status_code, payload=None, raw=None):
        self.status_code = status_code
        self._payload = payload
        self._raw = raw

    def json(self):
        if self._raw is not None:
            raise ValueError("not json")
        return self._payload


class FakeHttp:
    def __init__(self, result):
        self.result = result
        self.calls = []

    async def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class TestConnectionTest:
    def _run(self, gw, monkeypatch, result, provider="groq", providers=None):
        db = gw(GatewayDB(providers=keyed("groq", "openrouter") if providers is None else providers))
        http = FakeHttp(result)
        monkeypatch.setattr(G, "get_http", lambda: http)
        out = asyncio.run(G.test_provider(provider, "admin@example.com"))
        return out, db, http

    def test_a_good_key_lists_and_stores_the_models(self, gw, monkeypatch, caplog):
        caplog.set_level(logging.INFO, logger="fintrack.ai_gateway")
        out, db, http = self._run(gw, monkeypatch, FakeResponse(200, OPENROUTER_MODELS), "openrouter")
        assert out["ok"] is True and out["error"] is None and out["model_count"] == 4
        (call,) = http.calls
        assert call["url"] == "https://openrouter.ai/api/v1/models"
        assert call["headers"]["Authorization"] == "Bearer openrouter-stored-key-op12"
        assert call["timeout"].read == 15
        sql, args = db.executed[-1]
        assert "INSERT INTO ai_gateway_providers" in sql
        assert args[0] == "openrouter" and args[1] is True and args[3] is None
        assert [m["id"] for m in json.loads(args[4])][:2] == ["acme/zero-priced", "google/gemma-4-31b-it:free"]
        assert "stored-key" not in caplog.text

    @pytest.mark.parametrize("result,error", [
        (FakeResponse(401, {}), "Key rejected by Groq"),
        (FakeResponse(403, {}), "Key rejected by Groq"),
        (FakeResponse(500, {}), "Groq answered HTTP 500"),
        (FakeResponse(404, {}), "Groq answered HTTP 404"),
        (httpx.ReadTimeout("timed out"), "Could not reach Groq"),
        (httpx.ConnectError("refused"), "Could not reach Groq"),
        (FakeResponse(200, raw="<html>"), "Groq answered without a model list"),
    ])
    def test_failures_are_readable_and_keep_the_old_list(self, gw, monkeypatch, result, error):
        out, db, _ = self._run(gw, monkeypatch, result)
        assert out == {"ok": False, "ms": out["ms"], "model_count": 0, "error": error}
        _, args = db.executed[-1]
        assert args[1] is False and args[3] == error and args[4] is None
        assert "stored-key" not in error

    def test_no_key_is_reported_without_a_request(self, gw, monkeypatch):
        out, _, http = self._run(gw, monkeypatch, FakeResponse(200, GROQ_MODELS), providers=[])
        assert out == {"ok": False, "ms": 0, "model_count": 0, "error": "No key set (GROQ_API_KEY)"}
        assert http.calls == []

    def test_the_result_shows_up_in_the_config(self, gw, monkeypatch):
        class Remembering(GatewayDB):
            async def execute(self, sql, *args):
                await super().execute(sql, *args)
                if "last_test_ok" in sql and args[0] in self.providers:
                    row = self.providers[args[0]]
                    row.update(last_test_at=NOW, last_test_ok=args[1], last_test_ms=args[2],
                               last_test_error=args[3])
                    if args[4] is not None:
                        row["models"] = args[4]

        db = gw(Remembering(providers=keyed("groq")))
        monkeypatch.setattr(G, "get_http", lambda: FakeHttp(FakeResponse(200, GROQ_MODELS)))
        config()
        asyncio.run(G.test_provider("groq", None))
        groq = config().providers["groq"]
        assert db.config_reads == 2                     # the test invalidated the cache
        assert groq.last_test["ok"] is True and groq.last_test["model_count"] == 3
        assert groq.last_test["at"] == NOW.isoformat()
        assert [m["id"] for m in groq.models][0] == "groq/compound"


# ── the IST day ──────────────────────────────────────────────────────────────

class TestIstDay:
    @pytest.mark.parametrize("utc,day", [
        (datetime(2026, 10, 14, 18, 29, 59, tzinfo=timezone.utc), date(2026, 10, 14)),
        (datetime(2026, 10, 14, 18, 30, 0, tzinfo=timezone.utc), date(2026, 10, 15)),
        (datetime(2026, 10, 15, 18, 29, 59, tzinfo=timezone.utc), date(2026, 10, 15)),
    ])
    def test_the_day_turns_at_midnight_ist(self, gw, monkeypatch, utc, day):
        monkeypatch.setattr(G, "_now", lambda: utc)
        assert G.today_ist() == day

    def test_day_start_is_ist_midnight(self):
        assert G.day_start(date(2026, 10, 15)) == datetime(2026, 10, 14, 18, 30, tzinfo=timezone.utc)

    def test_usage_is_counted_from_ist_midnight(self, gw):
        db = gw(GatewayDB())
        asyncio.run(G.usage_today())
        assert db.usage_args == [(datetime(2026, 10, 14, 18, 30, tzinfo=timezone.utc),)]

    def test_local_counts_reset_when_the_day_turns(self, gw, monkeypatch):
        gw(GatewayDB())
        monkeypatch.setattr(G, "_now", lambda: datetime(2026, 10, 15, 18, 29, tzinfo=timezone.utc))
        assert asyncio.run(G.usage_today())["calls"] == 0
        G.note_usage("chat", "groq", 50, ok=True)
        assert asyncio.run(G.usage_today())["calls"] == 1
        monkeypatch.setattr(G, "_now", lambda: datetime(2026, 10, 15, 18, 31, tzinfo=timezone.utc))
        assert asyncio.run(G.usage_today())["calls"] == 0


# ── ai_usage: the call log ───────────────────────────────────────────────────

class TracePool:
    def __init__(self, *, new_columns=True):
        self.new_columns = new_columns
        self.executed = []
        self.queries = []

    async def execute(self, sql, *args):
        if not self.new_columns and "status" in sql:
            raise UndefinedColumnError('column "task" of relation "ai_traces" does not exist')
        self.executed.append((sql, args))

    async def fetchrow(self, sql, *args):
        self.queries.append(sql)
        if not self.new_columns and "status" in sql:
            raise UndefinedColumnError('column "status" does not exist')
        return {"calls": 4, "prompt_tokens": 10, "answer_tokens": 5, "avg_latency_ms": 300, "failed": 1}


def _record(pool, monkeypatch, fn):
    monkeypatch.setattr(ai_usage, "get_pool", lambda: pool)
    ai_usage.bind(user_id="00000000-0000-0000-0000-000000000001", endpoint="/api/ai/chat/stream")

    async def go():
        fn()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(go())
    ai_usage.bind()


class TestCallLog:
    def test_a_metered_attempt_carries_task_provider_status_and_attempt(self, monkeypatch):
        pool = TracePool()
        _record(pool, monkeypatch, lambda: ai_usage.record(
            "openai/gpt-oss-120b", 812, {"prompt_tokens": 900, "completion_tokens": 210},
            task="chat", provider="groq", http_status=200, attempt=2))
        (sql, args), = pool.executed
        row = dict(zip(TRACE_COLUMNS, args))
        assert row["task"] == "chat" and row["provider"] == "groq"
        assert row["status"] == "ok" and row["http_status"] == 200
        assert row["prompt_tokens"] == 900 and row["answer_tokens"] == 210
        assert json.loads(row["extra"]) == {"ok": True, "attempt": 2}
        assert row["endpoint"] == "/api/ai/chat/stream"

    def test_a_failed_attempt_defaults_its_status_from_ok(self, monkeypatch):
        pool = TracePool()
        _record(pool, monkeypatch, lambda: ai_usage.record(
            "openrouter/free", 90, ok=False, error="rate-limited", provider="openrouter", http_status=429))
        row = dict(zip(TRACE_COLUMNS, pool.executed[0][1]))
        assert row["status"] == "failed" and row["http_status"] == 429
        assert json.loads(row["extra"]) == {"ok": False, "error": "rate-limited"}

    def test_old_columns_are_used_when_the_migration_has_not_run(self, monkeypatch):
        pool = TracePool(new_columns=False)
        _record(pool, monkeypatch, lambda: ai_usage.record("openai/gpt-oss-20b", 50, task="judge"))
        (sql, args), = pool.executed
        assert "status" not in sql and len(args) == 11
        assert args[1] == "openai/gpt-oss-20b"

    def test_record_not_sent(self, monkeypatch):
        pool = TracePool()
        _record(pool, monkeypatch, lambda: ai_usage.record_not_sent("chat", "AI for chat is off."))
        row = dict(zip(TRACE_COLUMNS, pool.executed[0][1]))
        assert row["status"] == "not_sent" and row["task"] == "chat"
        assert row["model"] is None and row["provider"] is None and row["latency_ms"] == 0
        assert json.loads(row["extra"]) == {"ok": False, "error": "AI for chat is off."}

    def test_a_refusal_is_not_written_in_the_old_shape(self, monkeypatch):
        """Without a status column it would read as a failed call and count
        against the user's quota."""
        pool = TracePool(new_columns=False)
        _record(pool, monkeypatch, lambda: ai_usage.record_not_sent("chat", "off"))
        assert pool.executed == []

    def test_the_user_quota_ignores_refusals(self, monkeypatch):
        pool = TracePool()
        monkeypatch.setattr(ai_usage, "get_pool", lambda: pool)
        usage = asyncio.run(ai_usage.usage_for("00000000-0000-0000-0000-000000000001"))
        assert usage["calls"] == 4
        assert "status IS NULL OR status <> 'not_sent'" in pool.queries[0]

    def test_the_user_quota_still_counts_before_the_migration(self, monkeypatch):
        pool = TracePool(new_columns=False)
        monkeypatch.setattr(ai_usage, "get_pool", lambda: pool)
        usage = asyncio.run(ai_usage.usage_for("00000000-0000-0000-0000-000000000001"))
        assert usage["calls"] == 4 and len(pool.queries) == 2
        assert "not_sent" not in pool.queries[1]
