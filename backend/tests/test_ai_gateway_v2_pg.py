"""
The AI gateway's providers, model catalogue and limits against a real Postgres.

Migration 0008 lets the superadmin add any OpenAI-compatible provider, keep a
model catalogue and set day/week/month limits at every level. What has to
hold:

  * the migration carries the 0003 daily caps into the limits table, and a
    database it has not reached keeps serving the 0003 settings while the new
    writes answer 503;
  * a provider's base URL is https on a public host (no IP, port, user name,
    internal name, or a name that resolves to a private address), extra
    headers cannot smuggle a secret or replace the key, a stored key is
    bound to its host and never comes back out — not in a response, an error
    or an audit row;
  * limits count requests, tokens and estimated spend over today, this week
    (from Monday) and this month (from the 1st), IST, for the workspace, a
    provider, a model, a task and each user;
  * a step over its provider's or model's limit is skipped and the chain
    falls back instead of failing.

Skipped without PostgreSQL.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import FastAPI

import app.routers.ai_gateway as R
import app.routers.deps as D
from app.services import ai_gateway as G
from app.services import ai_usage
from app.services import openrouter as orr
from tests import pg_harness

NOW = datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)      # Thursday, 11:30 IST
TODAY = datetime(2026, 10, 15, 5, 0, tzinfo=timezone.utc)
THIS_WEEK = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)   # Tuesday
THIS_MONTH = datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc)   # the week before
LAST_MONTH = datetime(2026, 9, 28, 6, 0, tzinfo=timezone.utc)
BASE = "/api/admin/ai-gateway"
OPENAI_KEY = "sk-proj-AbCdEf0123456789xyzQ7rT"
CUSTOM_KEY = "ck-live-9f8e7d6c5b4a3210W1x2"
USER_A = "00000000-0000-0000-0000-0000000000a1"
USER_B = "00000000-0000-0000-0000-0000000000b2"


def _reset(monkeypatch):
    for name, value in (("_config", None), ("_config_expires", 0.0), ("_generation", 0),
                        ("_inflight", {}), ("_usage_day", None), ("_usage_base", G._Usage()),
                        ("_usage_local", []), ("_usage_expires", 0.0), ("_read_failing", False)):
        monkeypatch.setattr(G, name, value)
    monkeypatch.setattr(G, "_now", lambda: NOW)
    monkeypatch.setattr(G.settings, "groq_api_key", "gsk-env-key-0000")
    monkeypatch.setattr(G.settings, "openrouter_api_key", "or-env-key-0000")
    monkeypatch.setattr(G.settings, "ai_gateway_secret", None)
    monkeypatch.setattr(G.settings, "app_secret", "gateway-test-secret")
    ai_usage.bind()

    async def public(host):
        return ["93.184.216.34"]
    monkeypatch.setattr(G, "_resolve", public)


def _install(env, monkeypatch):
    getter = lambda: env._pool  # noqa: E731
    for module in (G, ai_usage, R):
        monkeypatch.setattr(module, "get_pool", getter)
    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[D.require_superadmin] = lambda: "superadmin"
    env.app = app
    return env


@pytest.fixture
def gwpg(pg, monkeypatch):
    _reset(monkeypatch)
    return _install(pg, monkeypatch)


def call(env, fn):
    """Run `await fn(client, pool)` against the gateway router."""
    async def main(pool):
        transport = httpx.ASGITransport(app=env.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            out = await fn(c, pool)
        for _ in range(5):                  # let the fire-and-forget log writes land
            await asyncio.sleep(0.01)
        return out
    return env.run(main)


def svc(env, fn):
    """Run `await fn()` with the database pool installed."""
    async def main(pool):
        out = await fn()
        for _ in range(5):
            await asyncio.sleep(0.01)
        return out
    return env.run(main)


def trace(env, ts, *, provider="groq", model="openai/gpt-oss-120b", task="chat", calls=1,
          tokens_in=0, tokens_out=0, status="ok", user=None):
    for _ in range(calls):
        env.sql("INSERT INTO ai_traces (ts, model, provider, task, status, prompt_tokens, answer_tokens, "
                "user_id, extra) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::jsonb)",
                ts, model, provider, task, status, tokens_in, tokens_out, user,
                json.dumps({"ok": status == "ok"}))
    G._usage_expires = 0.0              # the 5 s usage cache would not see them yet


# ── migration ────────────────────────────────────────────────────────────────

MIGRATION = pg_harness.BACKEND / "migrations/versions/0008_ai_gateway_v2.py"


class TestMigration:
    def test_the_daily_caps_are_carried_into_the_limits_table(self, pg_upto):
        env = pg_upto("0007_artifact_records")
        env.sql("INSERT INTO ai_gateway_providers (key, daily_request_cap, daily_token_cap) VALUES ('groq', 50, 9000)")
        env.sql("INSERT INTO ai_gateway_tasks (key, daily_cap) VALUES ('chat', 20)")
        env.sql("INSERT INTO ai_gateway_settings (key, value) VALUES ('daily_call_cap', '100'::jsonb), "
                "('daily_token_cap', '\"oops\"'::jsonb)")
        for sql in pg_harness.migration_statements(MIGRATION):
            env.execute(sql)
        limits = {(r["scope"], r["target"], r["period"], r["metric"]): float(r["cap"])
                  for r in env.sql("SELECT * FROM ai_gateway_limits")}
        assert limits == {("provider", "groq", "day", "requests"): 50, ("provider", "groq", "day", "tokens"): 9000,
                          ("task", "chat", "day", "requests"): 20, ("global", "", "day", "requests"): 100}
        rows = {r["key"]: r for r in env.sql("SELECT key, label, preset, position FROM ai_gateway_providers")}
        assert rows["groq"]["label"] == "Groq" and rows["openrouter"]["preset"] == "openrouter"

    def test_upgrade_downgrade_upgrade(self, pg_upto):
        env = pg_upto("0007_artifact_records")
        up = pg_harness.migration_statements(MIGRATION)
        down = pg_harness.migration_statements(MIGRATION, "downgrade")
        exists = lambda: env.sql("SELECT to_regclass('ai_gateway_limits') IS NOT NULL AS t")[0]["t"]  # noqa: E731
        for sql in up:
            env.execute(sql)
        env.sql("INSERT INTO ai_gateway_providers (key, label, base_url) VALUES ('acme', 'Acme', 'https://api.acme.ai/v1')")
        for sql in down:
            env.execute(sql)
        assert not exists()
        assert [r["key"] for r in env.sql("SELECT key FROM ai_gateway_providers ORDER BY key")] == ["groq", "openrouter"]
        for sql in up:
            env.execute(sql)
        assert exists()


class TestBeforeTheMigration:
    """A database at 0007: the 0003 settings serve, the new writes are 503."""

    @pytest.fixture
    def old(self, pg_upto, monkeypatch):
        _reset(monkeypatch)
        env = _install(pg_upto("0007_artifact_records"), monkeypatch)
        env.sql("INSERT INTO ai_gateway_providers (key, daily_request_cap) VALUES ('groq', 2)")
        return env

    def test_the_0003_caps_still_apply(self, old):
        trace(old, TODAY, calls=2)
        cfg = svc(old, lambda: G.get_config())
        assert cfg.storage_ok and not cfg.v2
        assert cfg.limits_for("provider", "groq") == [G.Limit("provider", "groq", "day", "requests", 2)]
        assert svc(old, lambda: G.provider_has_capacity("groq")) is False
        assert svc(old, lambda: G.provider_has_capacity("openrouter")) is True

    def test_the_new_writes_answer_503_and_the_state_still_reads(self, old):
        async def go(c, pool):
            state = await c.get(BASE)
            added = await c.post(f"{BASE}/providers", json={"preset": "openai", "api_key": OPENAI_KEY})
            limits = await c.put(f"{BASE}/limits", json={"scope": "global", "limits": [
                {"period": "week", "metric": "requests", "cap": 5}]})
            # The 0003 shape still saves.
            capped = await c.patch(f"{BASE}/providers/groq", json={"daily_request_cap": 7})
            return state, added, limits, capped
        state, added, limits, capped = call(old, go)
        assert state.status_code == 200 and state.json()["v2"] is False
        assert added.status_code == 503 and "0008" in added.json()["detail"]
        assert OPENAI_KEY not in added.text
        assert limits.status_code == 503
        assert capped.status_code == 200 and capped.json()["daily_request_cap"] == 7


# ── providers ────────────────────────────────────────────────────────────────

class TestProviders:
    def test_a_preset_is_added_with_its_key_which_never_comes_back(self, gwpg):
        async def go(c, pool):
            added = await c.post(f"{BASE}/providers", json={"preset": "openai", "api_key": OPENAI_KEY})
            state = await c.get(BASE)
            return added, state
        added, state = call(gwpg, go)
        assert added.status_code == 200, added.text
        body = added.json()
        assert body["key"] == "openai" and body["base_url"] == "https://api.openai.com/v1"
        assert body["key_source"] == "stored" and body["key_hint"] == OPENAI_KEY[-4:]
        assert OPENAI_KEY not in added.text and OPENAI_KEY not in state.text
        stored = gwpg.sql("SELECT api_key_enc FROM ai_gateway_providers WHERE key = 'openai'")[0]["api_key_enc"]
        assert OPENAI_KEY not in stored and G.decrypt_key(stored) == OPENAI_KEY
        audits = gwpg.sql("SELECT event_type, metadata::text AS m FROM auth_events")
        assert [a["event_type"] for a in audits] == ["ai_gateway_provider_added"]
        assert OPENAI_KEY not in audits[0]["m"] and OPENAI_KEY[-4:] in audits[0]["m"]
        assert [p["key"] for p in state.json()["providers"]] == ["groq", "openrouter", "openai"]

    def test_a_custom_provider_with_extra_headers(self, gwpg):
        async def go(c, pool):
            return await c.post(f"{BASE}/providers", json={
                "label": "Acme LLM", "base_url": "https://llm.acme.ai/v1/", "api_key": CUSTOM_KEY,
                "extra_headers": {"X-Acme-Org": "fintrack", "OpenAI-Project": "proj_1"}})
        r = call(gwpg, go)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["key"] == "acme-llm" and p["preset"] is None and p["base_url"] == "https://llm.acme.ai/v1"
        assert p["extra_headers"] == {"X-Acme-Org": "fintrack", "OpenAI-Project": "proj_1"}
        state = svc(gwpg, lambda: G.get_config()).providers["acme-llm"]
        headers = G.headers_for(state)
        assert headers["Authorization"] == f"Bearer {CUSTOM_KEY}" and headers["X-Acme-Org"] == "fintrack"
        assert "HTTP-Referer" not in headers

    @pytest.mark.parametrize("url", [
        "http://llm.acme.ai/v1", "https://10.0.0.5/v1", "https://[::1]/v1", "https://localhost/v1",
        "https://llm.internal/v1", "https://llm.acme.ai:8443/v1", "https://user:pw@llm.acme.ai/v1",
        "https://llm.acme.ai/v1?x=1", "https://llm.acme.ai/v1#f", "https://metadata/v1",
        "https://169.254.169.254/latest", "ftp://llm.acme.ai",
    ])
    def test_a_base_url_that_could_reach_inside_the_network_is_refused(self, gwpg, url):
        r = call(gwpg, lambda c, pool: c.post(f"{BASE}/providers", json={
            "label": "Sneaky", "base_url": url, "api_key": CUSTOM_KEY}))
        assert r.status_code == 422
        assert CUSTOM_KEY not in r.text
        assert gwpg.sql("SELECT COUNT(*) AS n FROM ai_gateway_providers WHERE key = 'sneaky'")[0]["n"] == 0

    def test_a_public_name_that_resolves_to_a_private_address_is_refused(self, gwpg, monkeypatch):
        async def rebinding(host):
            return ["127.0.0.1"] if host == "evil.example.com" else ["93.184.216.34"]
        monkeypatch.setattr(G, "_resolve", rebinding)

        async def go(c, pool):
            added = await c.post(f"{BASE}/providers", json={
                "label": "Evil", "base_url": "https://evil.example.com/v1", "api_key": CUSTOM_KEY})
            moved = await c.patch(f"{BASE}/providers/groq", json={"base_url": "https://evil.example.com/v1"})
            return added, moved
        added, moved = call(gwpg, go)
        assert added.status_code == 422 and "private network" in added.json()["detail"]
        assert moved.status_code == 422 and CUSTOM_KEY not in added.text

    @pytest.mark.parametrize("headers", [
        {"Authorization": "Bearer x"}, {"X-Api-Key": "abc"}, {"api-key": "abc"}, {"X-Auth-Token": "t"},
        {"Cookie": "a=b"}, {"Host": "evil.com"}, {"Content-Type": "text/plain"}, {"X-Secret": "s"},
        {"Bad Header": "v"}, {"X-Ok": "line\r\nInjected: 1"}, {f"X-H{i}": "v" for i in range(11)},
    ])
    def test_extra_headers_cannot_carry_a_secret_or_replace_the_key(self, gwpg, headers):
        r = call(gwpg, lambda c, pool: c.post(f"{BASE}/providers", json={
            "label": "Acme", "base_url": "https://llm.acme.ai/v1", "extra_headers": headers}))
        assert r.status_code == 422, r.text

    def test_a_new_host_drops_the_stored_key_and_never_gets_an_env_key(self, gwpg):
        async def go(c, pool):
            await c.post(f"{BASE}/providers", json={"label": "Acme", "base_url": "https://llm.acme.ai/v1",
                                                   "api_key": CUSTOM_KEY})
            same_host = await c.patch(f"{BASE}/providers/acme", json={"base_url": "https://llm.acme.ai/v2"})
            new_host = await c.patch(f"{BASE}/providers/acme", json={"base_url": "https://api.groq.com/openai/v1"})
            return same_host, new_host
        same_host, new_host = call(gwpg, go)
        assert same_host.json()["key_source"] == "stored"
        # On Groq's own host, an added provider still gets no GROQ_API_KEY.
        assert new_host.json()["key_source"] == "none" and new_host.json()["key_hint"] is None
        assert gwpg.sql("SELECT api_key_enc FROM ai_gateway_providers WHERE key = 'acme'")[0]["api_key_enc"] is None

    def test_ids_are_unique_and_validated(self, gwpg):
        async def go(c, pool):
            first = await c.post(f"{BASE}/providers", json={"preset": "mistral"})
            again = await c.post(f"{BASE}/providers", json={"preset": "mistral", "key": "mistral"})
            second = await c.post(f"{BASE}/providers", json={"preset": "mistral"})
            bad = await c.post(f"{BASE}/providers", json={"preset": "mistral", "key": "Bad Id!"})
            taken = await c.post(f"{BASE}/providers", json={"preset": "openai", "key": "groq"})
            unknown = await c.post(f"{BASE}/providers", json={"preset": "nope"})
            return first, again, second, bad, taken, unknown
        first, again, second, bad, taken, unknown = call(gwpg, go)
        assert first.json()["key"] == "mistral"
        assert again.status_code == 422
        # A second account of the same preset gets its own id.
        assert second.status_code == 200 and second.json()["key"] == "mistral-2"
        assert bad.status_code == 422 and taken.status_code == 422 and unknown.status_code == 422

    def test_removing_providers(self, gwpg):
        async def go(c, pool):
            await c.post(f"{BASE}/providers", json={"label": "Acme", "base_url": "https://llm.acme.ai/v1",
                                                   "api_key": CUSTOM_KEY})
            await c.put(f"{BASE}/models", json={"provider": "acme", "model": "acme-1", "context_window": 8000})
            await c.put(f"{BASE}/limits", json={"scope": "model", "target": "acme|acme-1",
                                                "limits": [{"period": "day", "metric": "requests", "cap": 3}]})
            await c.put(f"{BASE}/limits", json={"scope": "provider", "target": "acme",
                                                "limits": [{"period": "week", "metric": "tokens", "cap": 3000}]})
            gone = await c.delete(f"{BASE}/providers/acme")
            groq_gone = await c.delete(f"{BASE}/providers/groq")
            state = (await c.get(BASE)).json()
            back = await c.post(f"{BASE}/providers", json={"preset": "groq"})
            return gone, groq_gone, state, back
        gone, groq_gone, state, back = call(gwpg, go)
        assert gone.status_code == 200 and groq_gone.status_code == 200
        assert gwpg.sql("SELECT COUNT(*) AS n FROM ai_gateway_models")[0]["n"] == 0
        assert gwpg.sql("SELECT COUNT(*) AS n FROM ai_gateway_limits")[0]["n"] == 0
        assert [p["key"] for p in state["providers"]] == ["openrouter"]
        assert state["removed_builtins"] == ["groq"]
        assert groq_gone.json()["used_by"]            # the built-in chains named it
        # Added again it is back, with the env key on its own host.
        assert back.status_code == 200 and back.json()["key_source"] == "env"

    def test_fetching_the_model_list(self, gwpg, monkeypatch):
        class Http:
            async def get(self, url, headers=None, timeout=None):
                assert url == "https://api.openai.com/v1/models"
                return httpx.Response(200, json={"data": [{"id": "gpt-4.1-mini"}, {"id": "text-embedding-3-small"},
                                                          {"id": "gpt-4.1"}]})
        monkeypatch.setattr(G, "get_http", lambda: Http())

        async def go(c, pool):
            await c.post(f"{BASE}/providers", json={"preset": "openai", "api_key": OPENAI_KEY})
            fetched = await c.post(f"{BASE}/providers/openai/models/fetch")
            imported = await c.post(f"{BASE}/models/import", json={"provider": "openai", "models": ["gpt-4.1"]})
            again = await c.post(f"{BASE}/providers/openai/models/fetch")
            return fetched, imported, again
        fetched, imported, again = call(gwpg, go)
        assert fetched.json()["ok"] is True
        assert [m["id"] for m in fetched.json()["models"]] == ["gpt-4.1", "gpt-4.1-mini"]
        assert imported.json()["added"] == 1
        assert {m["id"]: m["in_catalog"] for m in again.json()["models"]} == {"gpt-4.1": True, "gpt-4.1-mini": False}
        assert OPENAI_KEY not in fetched.text


# ── model catalogue ──────────────────────────────────────────────────────────

class TestCatalogue:
    def test_add_change_and_remove_a_model(self, gwpg):
        async def go(c, pool):
            ok = await c.put(f"{BASE}/models", json={
                "provider": "groq", "model": "openai/gpt-oss-120b", "label": "GPT-OSS 120B",
                "context_window": 131072, "max_output_tokens": 32768, "request_token_limit": 8000,
                "input_cost_per_m": 0.15, "output_cost_per_m": 0.6})
            off = await c.put(f"{BASE}/models", json={"provider": "groq", "model": "openai/gpt-oss-120b",
                                                     "enabled": False})
            bad = await c.put(f"{BASE}/models", json={"provider": "groq", "model": "x", "context_window": -1})
            unknown = await c.put(f"{BASE}/models", json={"provider": "nope", "model": "x"})
            state = (await c.get(BASE)).json()
            removed = await c.delete(f"{BASE}/models", params={"provider": "groq", "model": "openai/gpt-oss-120b"})
            return ok, off, bad, unknown, state, removed
        ok, off, bad, unknown, state, removed = call(gwpg, go)
        assert ok.status_code == 200 and off.status_code == 200
        assert bad.status_code == 422 and unknown.status_code == 404
        (entry,) = state["catalog"]
        assert entry["label"] == "GPT-OSS 120B" and entry["enabled"] is False
        assert entry["request_token_limit"] == 8000 and entry["input_cost_per_m"] == 0.15
        assert "chat" in entry["used_by"]
        chat = next(t for t in state["tasks"] if t["key"] == "chat")
        assert any("switched off" in w["message"] for w in chat["route_warnings"])
        assert removed.status_code == 200
        assert gwpg.sql("SELECT COUNT(*) AS n FROM ai_gateway_models")[0]["n"] == 0


# ── limits ───────────────────────────────────────────────────────────────────

def set_limits(env, scope, target, *limits):
    return call(env, lambda c, pool: c.put(f"{BASE}/limits", json={
        "scope": scope, "target": target,
        "limits": [{"period": p, "metric": m, "cap": cap} for p, m, cap in limits]}))


class TestLimits:
    @pytest.fixture
    def usage(self, gwpg):
        """Groq: 1 call last month (outside), 2 earlier this month, 3 earlier
        this week, 4 today."""
        trace(gwpg, LAST_MONTH, calls=1, tokens_in=1000)
        trace(gwpg, THIS_MONTH, calls=2, tokens_in=100, tokens_out=100)
        trace(gwpg, THIS_WEEK, calls=3, tokens_in=100, tokens_out=100)
        trace(gwpg, TODAY, calls=4, tokens_in=100, tokens_out=100)
        trace(gwpg, TODAY, calls=1, status="not_sent")          # never reached a provider
        return gwpg

    def test_each_period_counts_its_own_calls(self, usage):
        views = svc(usage, lambda: G.usage_views())
        assert [views[p]["by_provider"]["groq"]["calls"] for p in G.PERIODS] == [4, 7, 9]
        assert [views[p]["by_provider"]["groq"]["tokens"] for p in G.PERIODS] == [800, 1400, 1800]

    @pytest.mark.parametrize("period,cap,blocked", [
        ("day", 4, True), ("day", 5, False), ("week", 7, True), ("week", 8, False),
        ("month", 9, True), ("month", 10, False),
    ])
    def test_a_provider_request_limit_per_period(self, usage, period, cap, blocked):
        assert set_limits(usage, "provider", "groq", (period, "requests", cap)).status_code == 200
        reason = svc(usage, lambda: G.step_blocked("groq", "openai/gpt-oss-120b"))
        assert (reason == f"provider {G._PERIOD_WORD[period]} request limit reached") is blocked
        assert (reason is None) is not blocked

    @pytest.mark.parametrize("period,cap,blocked", [
        ("day", 800, True), ("week", 1401, False), ("month", 1800, True)])
    def test_a_model_token_limit_per_period(self, usage, period, cap, blocked):
        set_limits(usage, "model", "groq|openai/gpt-oss-120b", (period, "tokens", cap))
        reason = svc(usage, lambda: G.step_blocked("groq", "openai/gpt-oss-120b"))
        assert (reason == f"model {G._PERIOD_WORD[period]} token limit reached") is blocked
        assert svc(usage, lambda: G.step_blocked("groq", "openai/gpt-oss-20b")) is None

    def test_spend_is_estimated_from_the_catalogue_prices(self, usage):
        call(usage, lambda c, pool: c.put(f"{BASE}/models", json={
            "provider": "groq", "model": "openai/gpt-oss-120b",
            "input_cost_per_m": 1000.0, "output_cost_per_m": 2000.0}))
        views = svc(usage, lambda: G.usage_views())
        # Today: 400 in, 400 out → 0.4 + 0.8 = 1.2 USD; the month: 900/900 → 2.7.
        assert round(views["day"]["total"]["spend"], 4) == 1.2
        assert round(views["month"]["by_provider"]["groq"]["spend"], 4) == 2.7
        set_limits(usage, "global", "", ("month", "spend", 2.5))
        msg = svc(usage, lambda: _refusal("chat"))
        assert msg == "This month's AI limit for the workspace has been reached. It resets on the 1st at midnight IST."

    def test_workspace_task_and_user_limits_refuse_with_the_period(self, usage):
        set_limits(usage, "task", "chat", ("week", "requests", 7))
        assert svc(usage, lambda: _refusal("chat")) == (
            "This week's AI limit for AI assistant chat has been reached. It resets on Monday at midnight IST.")
        assert svc(usage, lambda: _refusal("judge")) is None
        set_limits(usage, "task", "chat")                             # removed
        trace(usage, TODAY, calls=2, user=USER_A)
        set_limits(usage, "user", "*", ("day", "requests", 2))
        assert svc(usage, lambda: _refusal("chat", user=USER_A)) == (
            "Today's AI limit for your account has been reached. It resets at midnight IST.")
        assert svc(usage, lambda: _refusal("chat", user=USER_B)) is None

    def test_the_state_shows_usage_against_each_limit(self, usage):
        set_limits(usage, "provider", "groq", ("day", "requests", 5), ("week", "requests", 7))
        state = call(usage, lambda c, pool: c.get(BASE)).json()
        (group,) = [g for g in state["limits"] if g["scope"] == "provider"]
        assert group["label"] == "Groq"
        assert [(lim["period"], lim["used"], lim["pct"]) for lim in group["limits"]] == [("day", 4, 80), ("week", 7, 100)]
        levels = {a["level"] for a in state["alerts"]}
        assert "error" in levels and "warn" in levels
        assert state["usage"]["week"]["by_provider"]["groq"]["calls"] == 7

    @pytest.mark.parametrize("body", [
        {"scope": "planet", "limits": []},
        {"scope": "global", "limits": [{"period": "year", "metric": "requests", "cap": 1}]},
        {"scope": "global", "limits": [{"period": "day", "metric": "requests", "cap": 0}]},
        {"scope": "global", "limits": [{"period": "day", "metric": "requests", "cap": 1.5}]},
        {"scope": "global", "limits": [{"period": "day", "metric": "spend", "cap": -1}]},
        {"scope": "global", "limits": [{"period": "day", "metric": "requests", "cap": 1},
                                       {"period": "day", "metric": "requests", "cap": 2}]},
        {"scope": "user", "target": "bob", "limits": []},
    ])
    def test_bad_limits_are_422(self, gwpg, body):
        assert call(gwpg, lambda c, pool: c.put(f"{BASE}/limits", json=body)).status_code == 422

    def test_unknown_targets_are_404(self, gwpg):
        for body in ({"scope": "provider", "target": "nope"}, {"scope": "task", "target": "nope"},
                     {"scope": "model", "target": "nope|m"}):
            assert call(gwpg, lambda c, pool: c.put(f"{BASE}/limits", json={**body, "limits": []})).status_code == 404


async def _refusal(task, user=None):
    ai_usage.bind(user_id=user)
    try:
        await G.admit(task)
        return None
    except G.GatewayRefused as exc:
        return str(exc)
    finally:
        ai_usage.bind()


# ── fallback past a limit ────────────────────────────────────────────────────

def ok_body(content="hello"):
    return {"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}


class Replay:
    def __init__(self, by_provider):
        self.by_provider = by_provider
        self.calls = []

    async def post(self, url, headers=None, json=None, timeout=None, **kw):
        provider = "groq" if "groq.com" in url else "openrouter"
        self.calls.append((provider, json["model"]))
        status, body = self.by_provider[provider]
        return httpx.Response(status, json=body)


class TestFallbackPastALimit:
    def test_a_provider_over_its_weekly_limit_is_skipped_for_the_next(self, gwpg, monkeypatch):
        trace(gwpg, THIS_WEEK, calls=3)
        set_limits(gwpg, "provider", "groq", ("week", "requests", 3))
        fake = Replay({"groq": (200, ok_body("groq")), "openrouter": (200, ok_body("from openrouter"))})
        monkeypatch.setattr(orr, "_client", lambda: fake)
        attempts = []
        result = svc(gwpg, lambda: orr._try_chat([{"role": "user", "content": "hi"}], extract=False,
                                                 attempts=attempts))
        assert result["content"] == "from openrouter"
        assert fake.calls == [("openrouter", "openrouter/free")]
        assert [(a["model"], a["error"]) for a in attempts if a["skipped"]] == [
            ("openai/gpt-oss-120b", "provider weekly request limit reached"),
            ("openai/gpt-oss-20b", "provider weekly request limit reached")]

    def test_a_step_set_to_run_over_the_limit_is_still_tried(self, gwpg, monkeypatch):
        trace(gwpg, TODAY, calls=1)
        set_limits(gwpg, "provider", "groq", ("day", "requests", 1))
        call(gwpg, lambda c, pool: c.patch(f"{BASE}/tasks/chat", json={"route": [
            {"provider": "groq", "model": "openai/gpt-oss-120b", "skip_over_limit": False, "timeout_s": 9}]}))
        fake = Replay({"groq": (200, ok_body("groq anyway")), "openrouter": (200, ok_body("no"))})
        monkeypatch.setattr(orr, "_client", lambda: fake)
        result = svc(gwpg, lambda: orr._try_chat([{"role": "user", "content": "hi"}], extract=False))
        assert result["content"] == "groq anyway"

    def test_every_step_over_its_limit_is_refused_not_sent(self, gwpg, monkeypatch):
        trace(gwpg, TODAY, calls=1, provider="openrouter", model="openrouter/free")
        trace(gwpg, TODAY, calls=1)
        set_limits(gwpg, "provider", "groq", ("day", "requests", 1))
        set_limits(gwpg, "provider", "openrouter", ("day", "requests", 1))
        with pytest.raises(G.GatewayRefused, match="No AI provider is available"):
            svc(gwpg, lambda: orr._try_chat([{"role": "user", "content": "hi"}], extract=False))


# ── chains ───────────────────────────────────────────────────────────────────

class TestChains:
    def test_the_global_default_chain_serves_tasks_without_their_own_and_follows_the_rest(self, gwpg):
        async def go(c, pool):
            await c.post(f"{BASE}/providers", json={"label": "Acme", "base_url": "https://llm.acme.ai/v1",
                                                   "api_key": CUSTOM_KEY})
            saved = await c.put(f"{BASE}/routing/default", json={"route": [
                {"provider": "acme", "model": "acme-large"}, {"provider": "groq", "model": "openai/gpt-oss-20b"}]})
            own = await c.patch(f"{BASE}/tasks/judge", json={"route": [
                {"provider": "openrouter", "model": "openrouter/free"}]})
            alone = await c.patch(f"{BASE}/tasks/studio_ask", json={
                "route": [{"provider": "groq", "model": "openai/gpt-oss-120b"}], "fallback_to_default": False})
            dup = await c.put(f"{BASE}/routing/default", json={"route": [
                {"provider": "groq", "model": "m"}, {"provider": "groq", "model": "m"}]})
            unknown = await c.put(f"{BASE}/routing/default", json={"route": [{"provider": "zz", "model": "m"}]})
            return saved, own, alone, dup, unknown
        saved, own, alone, dup, unknown = call(gwpg, go)
        assert saved.status_code == 200 and own.status_code == 200 and alone.status_code == 200
        assert dup.status_code == 422 and unknown.status_code == 422
        cfg = svc(gwpg, lambda: G.get_config(force=True))
        steps = lambda t: [(s["provider"], s["model"]) for s in G.effective_route(cfg, t)]  # noqa: E731
        assert steps("chat") == [("acme", "acme-large"), ("groq", "openai/gpt-oss-20b")]
        assert steps("judge") == [("openrouter", "openrouter/free"), ("acme", "acme-large"),
                                  ("groq", "openai/gpt-oss-20b")]
        assert steps("studio_ask") == [("groq", "openai/gpt-oss-120b")]
        assert cfg.tasks["studio_ask"].route == [{"provider": "groq", "model": "openai/gpt-oss-120b"}]
        reset = call(gwpg, lambda c, pool: c.put(f"{BASE}/routing/default", json={"route": None}))
        assert reset.json()["default_route_custom"] is False

    def test_every_task_has_at_least_the_default_chain(self, gwpg):
        cfg = svc(gwpg, lambda: G.get_config())
        default = {(s["provider"], s["model"]) for s in cfg.default_route}
        for task in G.TASKS:
            assert default <= {(s["provider"], s["model"]) for s in G.effective_route(cfg, task)}, task
