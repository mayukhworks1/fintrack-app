"""
The AI call path: routes from the gateway, failover between providers, and
the call log.

Model ids used to be hardcoded here and in env vars, and when the free ids
disappeared every AI feature failed at once. Each call now names its task and
walks that task's route from Admin → AI gateway (services/ai_gateway.py),
falling back to the built-in routes when nothing is saved.

What these tests pin:

  * with nothing saved, the built-in routes run — Groq's gpt-oss first — on the
    env keys;
  * a dead key on one provider skips the rest of that provider and falls
    through to the other, instead of aborting the run (a 401 used to raise and
    stop the cascade before the fallback was ever reached);
  * every attempt that reaches a provider is logged — 401, 429, other 4xx,
    an unreadable body, streaming answers with their token counts — and a
    call refused before any provider is contacted is logged as not_sent;
  * a switched-off task is a readable 400 or SSE error, not a 500;
  * a prompt saved in the gateway replaces the built-in one;
  * invoice photos go to models known to read images first.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.main as M
import app.routers.ai as A
from app.routers.auth import make_token
from app.services import ai_gateway as G
from app.services import ai_usage
from app.services import embeddings
from app.services import openrouter as orr
from app.services import page_ai

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

TRACE_COLUMNS = ("endpoint", "model", "retrieval", "latency_ms", "prompt_tokens", "answer_tokens",
                 "session_id", "request_id", "query_snippet", "user_id", "extra",
                 "task", "provider", "status", "http_status")

_real_sleep = asyncio.sleep


# ── fakes ────────────────────────────────────────────────────────────────────

class UndefinedTable(Exception):
    sqlstate = "42P01"


class FakeDB:
    """
    The gateway tables as overrides, and ai_traces, in memory. Empty means a
    fresh install: every task on its built-in route.
    """

    def __init__(self):
        self.tasks: dict[str, dict] = {}       # key -> enabled / route / daily_cap / prompt_version
        self.providers: dict[str, dict] = {}   # key -> any ai_gateway_providers columns
        self.prompts: dict[str, str] = {}      # task -> active override
        self.traces: list[dict] = []

    async def fetch(self, sql, *args):
        if "ai_gateway_models" in sql or "ai_gateway_limits" in sql:
            # Migration 0008 has not run on this fake: the 0003 settings serve.
            raise UndefinedTable('relation "ai_gateway_limits" does not exist')
        if "FROM ai_traces" in sql:
            by: dict = {}
            for t in self.traces:
                if t["status"] == "not_sent":
                    continue
                slot = by.setdefault((t["task"], t["provider"]), {"calls": 0, "tokens": 0})
                slot["calls"] += t["extra"].get("requests", 1)
                slot["tokens"] += (t["prompt_tokens"] or 0) + (t["answer_tokens"] or 0)
            return [{"task": k[0], "provider": k[1], **v} for k, v in by.items()]
        if "JOIN ai_gateway_tasks" in sql:
            return [{"task": k, "prompt": v} for k, v in self.prompts.items()]
        if "FROM ai_gateway_providers" in sql:
            return [{"key": k, **v} for k, v in self.providers.items()]
        if "FROM ai_gateway_tasks" in sql:
            rows = []
            for k in set(self.tasks) | set(self.prompts):
                v = self.tasks.get(k, {})
                rows.append({"key": k, "enabled": v.get("enabled", True),
                             "route": json.dumps(v["route"]) if v.get("route") else None,
                             "daily_cap": v.get("daily_cap"),
                             "prompt_version": 1 if k in self.prompts else 0})
            return rows
        if "FROM ai_gateway_settings" in sql:
            return []
        raise AssertionError(f"unexpected query: {sql}")

    async def execute(self, sql, *args):
        if "INSERT INTO ai_traces" in sql:
            row = dict(zip(TRACE_COLUMNS, args))
            row["extra"] = json.loads(row["extra"])
            self.traces.append(row)
            return "INSERT 0 1"
        raise AssertionError(f"unexpected write: {sql}")


class FakeResponse:
    def __init__(self, status_code, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text if text is not None else json.dumps(self._payload)

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeStream:
    def __init__(self, status_code, lines=(), body=b"", then_raise=None):
        self.status_code = status_code
        self.lines = list(lines)
        self.body = body
        self.then_raise = then_raise
        self.closed = False

    async def aiter_lines(self):
        for line in self.lines:
            yield line
        if self.then_raise is not None:
            raise self.then_raise

    async def aread(self):
        return self.body

    async def aclose(self):
        self.closed = True


def sse(*chunks, done=True):
    lines = [f"data: {json.dumps(c)}" for c in chunks]
    return lines + (["data: [DONE]"] if done else [])


def delta(text):
    return {"choices": [{"index": 0, "delta": {"content": text}}]}


class FakeClient:
    """
    Replays a scripted answer per model id, else per provider ("groq" /
    "openrouter"). A list is consumed in order, its last entry repeating.
    """

    def __init__(self, script):
        self.script = script
        self.calls = []

    def _answer(self, call):
        for key in (call.model, call.provider):
            if key in self.script:
                answer = self.script[key]
                if isinstance(answer, list):
                    answer = answer.pop(0) if len(answer) > 1 else answer[0]
                return answer(call.payload) if callable(answer) else answer
        raise AssertionError(f"unscripted call to {call.provider} {call.model}")

    @staticmethod
    def _call(url, headers, payload, timeout):
        return SimpleNamespace(url=url, headers=headers or {}, payload=payload or {}, timeout=timeout,
                               model=(payload or {}).get("model"),
                               provider="groq" if "groq.com" in url else "openrouter")

    async def post(self, url, headers=None, json=None, timeout=None, **kw):
        call = self._call(url, headers, json, timeout)
        self.calls.append(call)
        return self._answer(call)

    def build_request(self, method, url, headers=None, json=None, timeout=None, **kw):
        return self._call(url, headers, json, timeout)

    async def send(self, request, stream=False):
        self.calls.append(request)
        return self._answer(request)


def ok_body(content="hello", usage=None):
    return {"choices": [{"message": {"content": content}}],
            "usage": usage or {"prompt_tokens": 7, "completion_tokens": 3}}


def error_body(message):
    return {"error": {"message": message}}


@pytest.fixture
def db(monkeypatch):
    """Fresh gateway state over an empty fake database, both env keys set."""
    for name, value in (("_config", None), ("_config_expires", 0.0), ("_generation", 0),
                        ("_inflight", {}), ("_usage_day", None), ("_usage_base", G._Usage()),
                        ("_usage_local", []), ("_usage_expires", 0.0), ("_read_failing", False)):
        monkeypatch.setattr(G, name, value)
    monkeypatch.setattr(G.settings, "openrouter_api_key", "or-test-key")
    monkeypatch.setattr(G.settings, "groq_api_key", "gsk-test-key")
    monkeypatch.setattr(G.settings, "ai_gateway_secret", None)
    monkeypatch.setattr(orr.asyncio, "sleep", lambda *_a, **_k: _real_sleep(0))
    ai_usage.bind()
    fake = FakeDB()
    monkeypatch.setattr(G, "get_pool", lambda: fake)
    monkeypatch.setattr(ai_usage, "get_pool", lambda: fake)
    return fake


@pytest.fixture
def client(monkeypatch):
    def install(script):
        fake = FakeClient(script)
        monkeypatch.setattr(orr, "_client", lambda: fake)
        return fake
    return install


async def _settle():
    """Let the fire-and-forget log writes land."""
    for _ in range(3):
        await _real_sleep(0)


def run(coro):
    async def go():
        try:
            return await coro
        finally:
            await _settle()
    return asyncio.run(go())


def chat(**kw):
    return run(orr._try_chat([{"role": "user", "content": "hi"}], extract=False, **kw))


def collect(agen):
    async def go():
        frames = []
        try:
            async for frame in agen:
                frames.append(frame)
        finally:
            await _settle()
        return frames
    return asyncio.run(go())


# ── built-in routes ──────────────────────────────────────────────────────────

class TestDefaultRoutes:
    def test_an_empty_gateway_runs_the_built_in_route_groq_gpt_oss_first(self, db, client):
        fake = client({"groq": FakeResponse(200, ok_body("from groq"))})
        result = chat()
        assert result["content"] == "from groq"
        assert result["model"] == "openai/gpt-oss-120b"
        assert result["provider"] == "groq"
        assert [(c.url, c.model) for c in fake.calls] == [(GROQ_URL, "openai/gpt-oss-120b")]

    def test_every_task_but_invoices_shares_the_default_route(self, db):
        def ids(task, **kw):
            return [(m.provider, m.id) for m in run(orr._ordered_models(task, **kw))]
        default = [("groq", "openai/gpt-oss-120b"), ("groq", "openai/gpt-oss-20b"),
                   ("openrouter", "openrouter/free")]
        for task in G.TASKS:
            if task != "invoice_parse":
                assert ids(task) == default, task
        # Its own route, then the default chain's step it does not already have.
        assert ids("invoice_parse") == [("openrouter", "google/gemma-4-31b-it:free"),
                                        ("groq", "openai/gpt-oss-120b"),
                                        ("openrouter", "openrouter/free"),
                                        ("groq", "openai/gpt-oss-20b")]

    def test_the_built_in_route_also_serves_a_database_the_migration_never_reached(self, db, client, monkeypatch):
        async def missing(*_a, **_k):
            raise RuntimeError('relation "ai_gateway_providers" does not exist')
        monkeypatch.setattr(db, "fetch", missing)
        fake = client({"groq": FakeResponse(200, ok_body("still works"))})
        assert chat()["content"] == "still works"
        assert fake.calls[0].model == "openai/gpt-oss-120b"

    def test_a_saved_route_replaces_the_built_in_one_without_a_redeploy(self, db, client):
        db.tasks["chat"] = {"route": [{"provider": "openrouter", "model": "acme/new-model:free"}]}
        fake = client({"openrouter": FakeResponse(200, ok_body("new"))})
        assert chat()["model"] == "acme/new-model:free"
        assert [c.url for c in fake.calls] == [OPENROUTER_URL]


# ── failover ─────────────────────────────────────────────────────────────────

class TestFailover:
    def test_the_first_step_answers_and_later_ones_are_never_touched(self, db, client):
        fake = client({"groq": FakeResponse(200, ok_body("first")),
                       "openrouter": FakeResponse(200, ok_body("never"))})
        assert chat()["content"] == "first"
        assert len(fake.calls) == 1

    def test_a_dead_groq_key_falls_through_to_openrouter(self, db, client):
        """
        401 used to raise, which ended the run. If that were still true the
        fallback could never fire — this is the regression that matters most.
        """
        client({"groq": FakeResponse(401, error_body("Invalid API Key")),
                "openrouter": FakeResponse(200, ok_body("from openrouter"))})
        result = chat()
        assert result["content"] == "from openrouter"
        assert result["model"] == "openrouter/free"
        # A bare "free" would name nothing in the chat UI.
        assert result["model_short"] == "openrouter/free"

    def test_an_exhausted_quota_falls_through(self, db, client):
        client({"groq": FakeResponse(402, error_body("quota")),
                "openrouter": FakeResponse(200, ok_body("from openrouter"))})
        assert chat()["content"] == "from openrouter"

    def test_every_groq_model_rate_limited_falls_through(self, db, client):
        """The common real failure: 429 across a whole free tier."""
        fake = client({"groq": FakeResponse(429, error_body("rate")),
                       "openrouter": FakeResponse(200, ok_body("from openrouter"))})
        assert chat()["content"] == "from openrouter"
        # One back-off retry per rate-limited model, then the next model.
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-120b"] * 2 + ["openai/gpt-oss-20b"] * 2 \
            + ["openrouter/free"]

    def test_a_dead_key_is_tried_once_not_once_per_model(self, db, client):
        """401 condemns the key, not the model: both Groq steps share it."""
        fake = client({"groq": FakeResponse(401, error_body("no")),
                       "openrouter": FakeResponse(200, ok_body("ok"))})
        chat()
        assert [c.provider for c in fake.calls] == ["groq", "openrouter"]

    def test_both_providers_down_reports_both(self, db, client):
        client({"groq": FakeResponse(401, error_body("no")),
                "openrouter": FakeResponse(401, error_body("no"))})
        with pytest.raises(ValueError) as exc:
            chat()
        message = str(exc.value)
        assert message.startswith("All AI models are unavailable right now. Tried: ")
        assert "gpt-oss-120b (Groq): key rejected" in message
        assert "openrouter/free (OpenRouter): key rejected" in message
        assert not isinstance(exc.value, G.GatewayRefused)

    def test_a_200_that_is_not_json_moves_on_instead_of_aborting(self, db, client):
        """r.json() raised JSONDecodeError, a ValueError, which the cascade
        re-raised — so one proxy error page stopped the whole run."""
        client({"openai/gpt-oss-120b": FakeResponse(200, text="<html>Bad gateway</html>"),
                "openai/gpt-oss-20b": FakeResponse(200, ok_body("second"))})
        assert chat()["content"] == "second"

    @pytest.mark.parametrize("bad", [
        FakeResponse(200, error_body("upstream overloaded")),
        FakeResponse(200, {"choices": [{"message": {"content": "   "}}]}),
        FakeResponse(200, {"choices": []}),
    ])
    def test_an_error_body_or_an_empty_answer_moves_on(self, db, client, bad):
        client({"openai/gpt-oss-120b": bad, "openai/gpt-oss-20b": FakeResponse(200, ok_body("second"))})
        assert chat()["content"] == "second"


# ── providers that cannot be tried ───────────────────────────────────────────

class TestSkippedProviders:
    def test_a_provider_without_a_key_is_skipped_without_a_request_or_a_log_row(self, db, client, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", None)
        fake = client({"openrouter": FakeResponse(200, ok_body("from openrouter"))})
        assert chat()["content"] == "from openrouter"
        assert [c.provider for c in fake.calls] == ["openrouter"]
        assert [(t["provider"], t["status"]) for t in db.traces] == [("openrouter", "ok")]

    def test_a_switched_off_provider_is_skipped(self, db, client):
        db.providers["groq"] = {"enabled": False}
        fake = client({"openrouter": FakeResponse(200, ok_body("ok"))})
        chat()
        assert [c.provider for c in fake.calls] == ["openrouter"]

    def test_no_provider_at_all_is_a_readable_refusal_logged_as_not_sent(self, db, client, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", None)
        monkeypatch.setattr(G.settings, "openrouter_api_key", None)
        fake = client({})
        with pytest.raises(G.GatewayRefused) as exc:
            chat()
        assert str(exc.value) == ("No AI provider is available for AI assistant chat. "
                                  "An administrator can check Admin → AI gateway.")
        assert fake.calls == []
        assert [(t["task"], t["status"], t["provider"], t["model"]) for t in db.traces] == \
            [("chat", "not_sent", None, None)]

    def test_skipped_steps_are_named_in_the_attempts(self, db, client, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", None)
        client({"openrouter": FakeResponse(200, ok_body("ok"))})
        attempts = []
        chat(attempts=attempts)
        assert [(a["provider"], a["model"], a["ok"], a["error"], a["skipped"]) for a in attempts] == [
            ("groq", "openai/gpt-oss-120b", False, "no key", True),
            ("groq", "openai/gpt-oss-20b", False, "no key", True),
            ("openrouter", "openrouter/free", True, None, False),
        ]
        assert all(isinstance(a["ms"], int) for a in attempts)

    def test_steps_behind_a_rejected_key_are_listed_as_skipped(self, db, client):
        client({"groq": FakeResponse(401, error_body("Invalid API Key")),
                "openrouter": FakeResponse(200, ok_body("ok"))})
        attempts = []
        chat(attempts=attempts)
        assert [(a["model"], a["ok"], a["skipped"]) for a in attempts] == [
            ("openai/gpt-oss-120b", False, False),
            ("openai/gpt-oss-20b", False, True),
            ("openrouter/free", True, False),
        ]
        assert attempts[1]["error"] == "skipped: key rejected on an earlier step"


# ── the request ──────────────────────────────────────────────────────────────

class TestRequestShape:
    def test_groq_is_called_on_its_own_host_with_its_own_key_and_timeout(self, db, client):
        fake = client({"groq": FakeResponse(200, ok_body())})
        chat()
        call = fake.calls[0]
        assert call.url == GROQ_URL
        assert call.headers["Authorization"] == "Bearer gsk-test-key"
        assert "HTTP-Referer" not in call.headers and "X-Title" not in call.headers
        assert call.timeout.read == 30 and call.timeout.connect == 10

    def test_a_stored_key_and_base_url_win_over_the_env(self, db, client):
        db.providers["openrouter"] = {"api_key_enc": G.encrypt_key("sk-or-stored-1234"), "key_hint": "1234",
                                      "base_url": "https://gateway.example/api/v1", "timeout_s": 60}
        db.tasks["chat"] = {"route": [{"provider": "openrouter", "model": "acme/m:free"}]}
        fake = client({"openrouter": FakeResponse(200, ok_body())})
        chat()
        call = fake.calls[0]
        assert call.url == "https://gateway.example/api/v1/chat/completions"
        assert call.headers["Authorization"] == "Bearer sk-or-stored-1234"
        assert call.headers["X-Title"] == "FinTrack AI"
        assert call.timeout.read == 60

    def test_the_openrouter_only_reasoning_field_is_not_sent_to_groq(self, db, client):
        """Groq validates its body strictly and rejects unknown fields, so
        leaking OpenRouter's `reasoning` extension would fail every call."""
        fake = client({"groq": FakeResponse(401, error_body("no")),
                       "openrouter": FakeResponse(200, ok_body())})
        chat()
        groq, openrouter = fake.calls
        assert "reasoning" not in groq.payload
        assert openrouter.payload["reasoning"] == {"exclude": True}
        assert "reasoning_effort" not in openrouter.payload

    def test_gpt_oss_on_groq_reasons_at_low_effort(self, db, client):
        """Its reasoning counts against max_tokens; at the default effort the
        judge's 350 tokens can run out before the answer starts."""
        fake = client({"groq": FakeResponse(200, ok_body())})
        chat(max_tokens=350)
        assert fake.calls[0].payload["reasoning_effort"] == "low"
        assert fake.calls[0].payload["max_tokens"] == 350

    def test_reasoning_effort_is_only_sent_to_models_that_take_it(self, db, client):
        db.tasks["chat"] = {"route": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}]}
        fake = client({"groq": FakeResponse(200, ok_body())})
        chat()
        assert "reasoning_effort" not in fake.calls[0].payload

    def test_a_refused_optional_field_is_dropped_and_the_step_retried(self, db, client):
        """If a provider ever stops accepting reasoning_effort, the model must
        still answer instead of every call on it failing."""
        refused = FakeResponse(400, error_body("property 'reasoning_effort' is unsupported"))
        fake = client({"groq": [refused, FakeResponse(200, ok_body("fine"))]})
        assert chat()["content"] == "fine"
        first, second = fake.calls
        assert first.payload["reasoning_effort"] == "low"
        assert "reasoning_effort" not in second.payload
        assert second.payload["model"] == first.payload["model"]
        assert [(t["status"], t["http_status"]) for t in db.traces] == [("ok", 200)]

    def test_an_unrelated_400_is_not_retried(self, db, client):
        fake = client({"groq": FakeResponse(400, error_body("context length exceeded")),
                       "openrouter": FakeResponse(200, ok_body("from openrouter"))})
        assert chat()["content"] == "from openrouter"
        assert [c.provider for c in fake.calls] == ["groq", "groq", "openrouter"]

    def test_openrouter_keeps_its_attribution_headers(self, db):
        headers = G.headers_for(run(G.get_config()).providers["openrouter"])
        assert headers["HTTP-Referer"].startswith("https://")
        assert headers["X-Title"] == "FinTrack AI"

    @pytest.mark.parametrize("frontend_url,referer", [
        ("https://app.example, https://www.app.example", "https://app.example"),
        ("https://app.example/", "https://app.example"),
        ("*", "https://twfintracker.worksmayukh.space"),
        ("", "https://twfintracker.worksmayukh.space"),
    ])
    def test_the_referer_is_the_live_frontend(self, db, monkeypatch, frontend_url, referer):
        """It used to name a retired preview deployment."""
        monkeypatch.setattr(G.settings, "frontend_url", frontend_url)
        provider = run(G.get_config()).providers["openrouter"]
        assert G.headers_for(provider)["HTTP-Referer"] == referer

    def test_the_judge_skips_models_that_leak_reasoning(self, db, client):
        db.tasks["judge"] = {"route": [{"provider": "openrouter", "model": "nvidia/nemotron-nano-9b-v2:free"},
                                       {"provider": "groq", "model": "openai/gpt-oss-20b"}]}
        fake = client({"groq": FakeResponse(200, ok_body('{"verdict": "pass", "confidence": "high"}'))})
        verdict = run(orr.judge_answer("q", "a", "ctx"))
        assert verdict["verdict"] == "pass"
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-20b"]
        assert db.traces[0]["task"] == "judge"


# ── the call log ─────────────────────────────────────────────────────────────

class TestMetering:
    def test_every_failed_attempt_is_a_failed_row_with_its_http_status(self, db, client):
        db.tasks["chat"] = {"route": [
            {"provider": "groq", "model": "g-dead"},
            {"provider": "groq", "model": "g-skipped"},
            {"provider": "openrouter", "model": "o-limited"},
            {"provider": "openrouter", "model": "o-bad-request"},
            {"provider": "openrouter", "model": "o-not-json"},
            {"provider": "openrouter", "model": "o-good"},
        ]}
        client({
            "g-dead": FakeResponse(401, error_body("Invalid API Key")),
            "o-limited": FakeResponse(429, error_body("Rate limit exceeded")),
            "o-bad-request": FakeResponse(400, error_body("model not found")),
            "o-not-json": FakeResponse(200, text="upstream timed out"),
            "o-good": FakeResponse(200, ok_body("finally", {"prompt_tokens": 11, "completion_tokens": 4})),
        })
        assert chat()["content"] == "finally"
        rows = [(t["model"], t["provider"], t["status"], t["http_status"], t["extra"].get("attempt"))
                for t in db.traces]
        assert rows == [
            ("g-dead", "groq", "failed", 401, 1),
            ("o-limited", "openrouter", "failed", 429, 3),
            ("o-bad-request", "openrouter", "failed", 400, 4),
            ("o-not-json", "openrouter", "failed", 200, 5),
            ("o-good", "openrouter", "ok", 200, 6),
        ]
        assert all(t["task"] == "chat" for t in db.traces)
        assert db.traces[1]["extra"]["error"] == "rate-limited"
        assert db.traces[2]["extra"]["error"] == "model not found"
        assert (db.traces[-1]["prompt_tokens"], db.traces[-1]["answer_tokens"]) == (11, 4)

    def test_timeouts_are_failed_rows_too(self, db, client):
        import httpx

        def boom(_payload):
            raise httpx.ReadTimeout("slow")
        client({"openai/gpt-oss-120b": boom, "openai/gpt-oss-20b": FakeResponse(200, ok_body())})
        chat()
        assert [(t["model"], t["status"], t["extra"].get("error")) for t in db.traces][0] == \
            ("openai/gpt-oss-120b", "failed", "timeout/network")

    def test_attempts_count_toward_today_at_once(self, db, client):
        """The log write is fire-and-forget and the usage read is cached, so
        a burst must not be able to sail past a cap in between. A 5xx is
        retried twice, and the provider counted all three requests."""
        client({"openai/gpt-oss-120b": FakeResponse(500, error_body("down")),
                "openai/gpt-oss-20b": FakeResponse(200, ok_body("ok", {"prompt_tokens": 5, "completion_tokens": 5}))})
        chat()
        assert [t["extra"].get("requests") for t in db.traces] == [3, None]
        usage = run(G.usage_today())
        assert usage["by_task"]["chat"] == {"calls": 4, "tokens": 10}
        assert usage["by_provider"]["groq"]["calls"] == 4

    def test_a_provider_at_its_request_cap_is_skipped(self, db, client):
        db.providers["groq"] = {"daily_request_cap": 1}
        fake = client({"openai/gpt-oss-120b": FakeResponse(503, error_body("busy")),
                       "openrouter": FakeResponse(200, ok_body("ok"))})
        attempts = []
        chat(attempts=attempts)
        assert [c.model for c in fake.calls if c.provider == "groq"] == ["openai/gpt-oss-120b"] * 3
        assert ("openai/gpt-oss-20b", "provider daily request limit reached") in \
            [(a["model"], a["error"]) for a in attempts]

    def test_a_429_retry_that_times_out_is_not_logged_as_429(self, db, client):
        import httpx

        def timed_out(_payload):
            raise httpx.ReadTimeout("slow")
        client({"openai/gpt-oss-120b": [FakeResponse(429, error_body("rate")), timed_out],
                "openai/gpt-oss-20b": FakeResponse(200, ok_body())})
        chat()
        first = db.traces[0]
        assert (first["status"], first["http_status"], first["extra"]["error"]) == \
            ("failed", None, "timeout/network")
        assert first["extra"]["requests"] == 2


# ── retries, timeouts and the route's time budget ────────────────────────────

class TestRetriesAndBudget:
    def test_a_read_timeout_fails_the_step_without_running_the_model_again(self, db, client):
        """A slow model asked three times was three times the wait before the
        next step, well past the browser's 90 s."""
        import httpx

        def slow(_payload):
            raise httpx.ReadTimeout("slow")
        fake = client({"openai/gpt-oss-120b": slow, "openai/gpt-oss-20b": FakeResponse(200, ok_body("next"))})
        assert chat()["content"] == "next"
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
        assert "requests" not in db.traces[0]["extra"]

    def test_a_connection_that_never_opened_is_retried(self, db, client):
        import httpx

        def refused(_payload):
            raise httpx.ConnectError("refused")
        fake = client({"openai/gpt-oss-120b": [refused, FakeResponse(200, ok_body("second try"))]})
        assert chat()["content"] == "second try"
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-120b"] * 2
        assert [t["status"] for t in db.traces] == ["ok"]
        assert "requests" not in db.traces[0]["extra"]      # the refused one never reached Groq

    def test_steps_that_would_start_too_late_are_skipped(self, db, client, monkeypatch):
        import time
        import httpx
        monkeypatch.setattr(orr, "_MIN_STEP_S", 0.05)

        def slow(_payload):
            time.sleep(0.25)
            raise httpx.ReadTimeout("slow")
        fake = client({"groq": slow, "openrouter": FakeResponse(200, ok_body("never"))})
        attempts = []
        with pytest.raises(ValueError) as exc:
            chat(attempts=attempts, budget_s=0.2)
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-120b"]
        assert fake.calls[0].timeout.read <= 0.2 + 1           # cut to the time left (1 s floor)
        assert [(a["model"], a["skipped"], a["error"]) for a in attempts] == [
            ("openai/gpt-oss-120b", False, "timeout/network"),
            ("openai/gpt-oss-20b", True, "not tried: out of time"),
            ("openrouter/free", True, "not tried: out of time"),
        ]
        assert "out of time" in str(exc.value)
        assert [t["model"] for t in db.traces] == ["openai/gpt-oss-120b"]

    def test_the_default_budget_fits_inside_the_browser_timeout(self):
        assert orr.ROUTE_BUDGET_S + orr._MIN_STEP_S <= 90
        assert page_ai.ROUTE_BUDGET_S + orr._MIN_STEP_S <= 120


# ── keys never leak through error text ───────────────────────────────────────

def _quoting_the_key(key):
    """What h11 raises for a header it refuses: the header, key included."""
    import httpx

    def boom(_payload):
        raise httpx.LocalProtocolError(f"Illegal header value b'Bearer {key}\\x00'")
    return boom


class TestNoKeyInErrors:
    def test_a_transport_error_quoting_the_key_is_masked(self, db, client):
        client({"groq": _quoting_the_key("gsk-test-key"), "openrouter": _quoting_the_key("or-test-key")})
        attempts = []
        with pytest.raises(ValueError) as exc:
            chat(attempts=attempts)
        message = str(exc.value)
        assert "Bearer ****" in message
        for key in ("gsk-test-key", "or-test-key"):
            assert key not in message
            assert all(key not in (a["error"] or "") for a in attempts)
            assert all(key not in t["extra"].get("error", "") for t in db.traces)

    def test_the_streaming_chat_masks_it_too(self, db, client):
        client({"groq": _quoting_the_key("gsk-test-key"), "openrouter": _quoting_the_key("or-test-key")})
        with pytest.raises(ValueError) as exc:
            stream_chat()
        assert "gsk-test-key" not in str(exc.value) and "or-test-key" not in str(exc.value)
        assert all("test-key" not in t["extra"].get("error", "") for t in db.traces)

    def test_the_page_stream_masks_it_too(self, db, client):
        client({"groq": _quoting_the_key("gsk-test-key"), "openrouter": _quoting_the_key("or-test-key")})
        with pytest.raises(ValueError) as exc:
            collect(page_ai.stream_generate_page("A bakery landing page"))
        assert "gsk-test-key" not in str(exc.value) and "or-test-key" not in str(exc.value)

    def test_a_key_that_cannot_go_in_a_header_is_not_used_at_all(self, db, client, monkeypatch):
        monkeypatch.setattr(G.settings, "groq_api_key", "gsk_THISISTHESECRETKEY\x00")
        fake = client({"openrouter": FakeResponse(200, ok_body("from openrouter"))})
        attempts = []
        assert chat(attempts=attempts)["content"] == "from openrouter"
        assert [c.provider for c in fake.calls] == ["openrouter"]
        assert attempts[0]["error"] == "no key"


# ── admission ────────────────────────────────────────────────────────────────

SWITCHED_OFF = "AI for {} is switched off by the administrator."


class TestSwitchedOffTasks:
    def test_the_call_is_refused_before_any_provider_and_logged(self, db, client):
        db.tasks["project_autofill"] = {"enabled": False}
        fake = client({})
        with pytest.raises(ValueError) as exc:
            run(orr.autofill_project("Website redesign for Acme"))
        assert isinstance(exc.value, G.GatewayRefused)
        assert str(exc.value) == SWITCHED_OFF.format("Project autofill")
        assert fake.calls == []
        assert [(t["task"], t["status"]) for t in db.traces] == [("project_autofill", "not_sent")]

    def test_the_admin_test_button_bypasses_the_switch(self, db, client):
        db.tasks["chat"] = {"enabled": False}
        client({"groq": FakeResponse(200, ok_body("tested"))})
        assert chat(bypass_enabled=True)["content"] == "tested"

    def test_other_tasks_keep_running(self, db, client):
        db.tasks["project_autofill"] = {"enabled": False}
        client({"groq": FakeResponse(200, ok_body("ok"))})
        assert chat()["content"] == "ok"


@pytest.fixture
def http(db, client, monkeypatch):
    """The real app over HTTP with an editor token, quota and IP limits open."""
    async def allow(*_a, **_k):
        return True, 100

    async def no_context():
        return "Project Alpha billed ₹12,00,000."

    monkeypatch.setattr(A, "rate_check", allow)
    monkeypatch.setattr(A, "_build_context_teable", no_context)
    test_client = TestClient(M.app)
    test_client.headers["Authorization"] = f"Bearer {make_token('editor')}"
    return test_client


def sse_frames(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


class TestReadableRefusalsOverHttp:
    def test_autofill_is_a_400_with_the_reason(self, db, http):
        db.tasks["project_autofill"] = {"enabled": False}
        r = http.post("/api/ai/autofill", json={"description": "Website redesign"})
        assert r.status_code == 400, r.text
        assert SWITCHED_OFF.format("Project autofill") in r.text

    def test_chat_is_an_sse_error_frame_with_the_reason(self, db, http, client):
        db.tasks["chat"] = {"enabled": False}
        fake = client({})
        r = http.post("/api/ai/chat/stream", json={"message": "hello there"})
        assert r.status_code == 200
        frames = sse_frames(r)
        assert frames[-1] == {"type": "error", "error": SWITCHED_OFF.format("AI assistant chat")}
        assert fake.calls == []

    def test_page_streaming_is_an_sse_error_frame_and_nothing_else(self, db, http, client):
        db.tasks["page_build"] = {"enabled": False}
        client({})
        r = http.post("/api/pages/ai/stream", json={"prompt": "A bakery landing page"})
        assert sse_frames(r) == [{"type": "error", "message": SWITCHED_OFF.format("Build and revise pages")}]


# ── streaming ────────────────────────────────────────────────────────────────

def stream_chat(**kw):
    return collect(orr.stream_chat_with_ai("How is Alpha doing?", [], "ctx", **kw))


class TestStreamingChat:
    def test_usage_from_an_empty_choices_final_chunk_is_metered_and_reported(self, db, client):
        """OpenAI-style usage arrives last with `choices: []`; indexing [0]
        into it raised, and the cascade moved on after the answer had streamed."""
        lines = sse(delta("===ANSWER===Alpha is "), delta("on track.===END==="),
                    {"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 30}})
        fake = client({"groq": FakeStream(200, lines)})
        frames = stream_chat()
        done = frames[-1]
        assert done["type"] == "done"
        assert done["content"] == "Alpha is on track."
        assert done["tokens_used"] == 150
        assert "".join(f["delta"] for f in frames if f["type"] == "delta") == "Alpha is on track."
        assert len(fake.calls) == 1
        assert fake.calls[0].payload["stream"] is True
        assert fake.calls[0].payload["stream_options"] == {"include_usage": True}
        assert [(t["task"], t["status"], t["prompt_tokens"], t["answer_tokens"], t["http_status"])
                for t in db.traces] == [("chat", "ok", 120, 30, 200)]

    def test_a_refused_stream_options_field_is_dropped_and_the_stream_reopened(self, db, client):
        refused = FakeStream(400, body=json.dumps(error_body("Unknown field: stream_options")).encode())
        lines = sse(delta("===ANSWER===Fine.===END==="))
        fake = client({"groq": [refused, FakeStream(200, lines)]})
        assert stream_chat()[-1]["content"] == "Fine."
        assert refused.closed
        assert "stream_options" in fake.calls[0].payload
        assert "stream_options" not in fake.calls[1].payload
        assert fake.calls[1].payload["stream"] is True

    def test_groq_usage_under_x_groq_is_read(self, db, client):
        lines = sse(delta("===ANSWER===Fine.===END==="),
                    {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                     "x_groq": {"id": "req_1", "usage": {"prompt_tokens": 40, "completion_tokens": 2}}})
        client({"groq": FakeStream(200, lines)})
        assert stream_chat()[-1]["tokens_used"] == 42
        assert (db.traces[0]["prompt_tokens"], db.traces[0]["answer_tokens"]) == (40, 2)

    def test_a_connection_lost_after_the_end_marker_keeps_the_answer(self, db, client):
        """The stream is read past ===END=== for the usage chunk; losing the
        connection there must not fail an answer that already arrived whole."""
        import httpx
        lines = sse(delta("===ANSWER===Alpha is fine.===END==="), done=False)
        client({"groq": FakeStream(200, lines, then_raise=httpx.RemoteProtocolError("peer closed")),
                "openrouter": FakeStream(200, sse(delta("===ANSWER===Never.===END===")))})
        frames = stream_chat()
        assert frames[-1]["content"] == "Alpha is fine."
        assert frames[-1]["model"] == "openai/gpt-oss-120b"
        assert [t["status"] for t in db.traces] == ["ok"]

    def test_a_connection_lost_before_the_end_marker_fails_over(self, db, client):
        import httpx
        lines = sse(delta("===ANSWER===Alpha is"), done=False)
        client({"openai/gpt-oss-120b": FakeStream(200, lines, then_raise=httpx.ReadTimeout("slow")),
                "openai/gpt-oss-20b": FakeStream(200, sse(delta("===ANSWER===Second.===END===")))})
        assert stream_chat()[-1]["content"] == "Second."
        assert [(t["status"], t["extra"].get("error")) for t in db.traces] == \
            [("failed", "timeout/network"), ("ok", None)]

    def test_text_after_the_end_marker_is_not_waited_on_for_long(self, db, client, monkeypatch):
        monkeypatch.setattr(orr, "_USAGE_GRACE_S", -1)
        lines = sse(delta("===ANSWER===Done.===END==="), delta(" and then some rambling"),
                    {"choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1}})
        client({"groq": FakeStream(200, lines)})
        done = stream_chat()[-1]
        assert done["content"] == "Done."
        assert done["tokens_used"] is None

    def test_no_usage_reported_is_none_not_zero(self, db, client):
        client({"groq": FakeStream(200, sse(delta("===ANSWER===Fine.===END===")))})
        assert stream_chat()[-1]["tokens_used"] is None

    def test_failed_stream_attempts_are_metered_and_the_next_model_answers(self, db, client):
        client({
            "openai/gpt-oss-120b": FakeStream(429, body=b'{"error": {"message": "Rate limit reached"}}'),
            "openai/gpt-oss-20b": FakeStream(200, sse()),
            "openrouter": FakeStream(200, sse(delta("===ANSWER===From OpenRouter.===END==="))),
        })
        frames = stream_chat()
        assert frames[-1]["model"] == "openrouter/free"
        assert [(t["model"], t["status"], t["http_status"], t["extra"].get("error")) for t in db.traces] == [
            ("openai/gpt-oss-120b", "failed", 429, "Rate limit reached"),
            ("openai/gpt-oss-20b", "failed", 200, "response had no extractable answer"),
            ("openrouter/free", "ok", 200, None),
        ]

    def test_an_error_chunk_mid_stream_fails_that_model(self, db, client):
        client({"openai/gpt-oss-120b": FakeStream(200, sse({"error": {"message": "overloaded"}})),
                "openai/gpt-oss-20b": FakeStream(200, sse(delta("===ANSWER===Second.===END===")))})
        assert stream_chat()[-1]["content"] == "Second."
        assert db.traces[0]["extra"]["error"] == "overloaded"

    def test_every_stream_failing_names_every_model(self, db, client):
        client({"groq": FakeStream(401, body=b"{}"), "openrouter": FakeStream(500, body=b"down")})
        with pytest.raises(ValueError) as exc:
            stream_chat()
        assert "gpt-oss-120b (Groq): key rejected" in str(exc.value)
        assert "openrouter/free (OpenRouter): down" in str(exc.value)


class TestStreamingPages:
    def test_a_page_stream_is_metered_with_its_tokens(self, db, client):
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        client({"groq": FakeStream(200, sse(delta(html[:20]), delta(html[20:]),
                                            {"choices": [], "usage": {"prompt_tokens": 900, "completion_tokens": 80}}))})
        frames = collect(page_ai.stream_generate_page("A bakery landing page"))
        assert frames[-1]["type"] == "done" and frames[-1]["content"].startswith("<!DOCTYPE html>")
        assert [(t["task"], t["status"], t["prompt_tokens"], t["answer_tokens"]) for t in db.traces] == \
            [("page_build", "ok", 900, 80)]

    def test_a_page_stream_fails_over_and_logs_the_failure(self, db, client):
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        client({"openai/gpt-oss-120b": FakeStream(400, body=b'{"error": {"message": "context too long"}}'),
                "openai/gpt-oss-20b": FakeStream(200, sse(delta(html)))})
        frames = collect(page_ai.stream_generate_page("A bakery landing page"))
        assert frames[-1]["model"] == "openai/gpt-oss-20b"
        assert [(t["status"], t["http_status"]) for t in db.traces] == [("failed", 400), ("ok", 200)]


    def test_a_page_stream_passes_on_reasoning_and_says_which_model_is_working(self, db, client):
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        think = {"choices": [{"index": 0, "delta": {"reasoning": "Plan the task list first. " * 10}}]}
        client({"groq": FakeStream(200, sse(think, delta(html)))})
        frames = collect(page_ai.stream_generate_page("A to-do list", content_type="artifact"))
        kinds = [f["type"] for f in frames]
        assert "reasoning" in kinds and kinds.index("reasoning") < kinds.index("delta")
        assert "".join(f["delta"] for f in frames if f["type"] == "reasoning").startswith("Plan the task list")
        status = [f["text"] for f in frames if f["type"] == "status"]
        assert status[0].startswith("Sent your request to") and any("writing the code" in t for t in status)
        assert frames[-1]["type"] == "done"

    def test_a_silent_model_is_dropped_after_the_first_token_deadline(self, db, client, monkeypatch):
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"

        class Silent(FakeStream):
            async def aiter_lines(self):
                yield ": keep-alive"
                await asyncio.sleep(5)
                yield "data: [DONE]"

        monkeypatch.setattr(page_ai, "FIRST_TOKEN_S", 0.2)
        client({"openai/gpt-oss-120b": Silent(200),
                "openai/gpt-oss-20b": FakeStream(200, sse(delta(html)))})
        frames = collect(page_ai.stream_generate_page("A bakery landing page"))
        assert frames[-1]["model"] == "openai/gpt-oss-20b"
        assert any(f["type"] == "status" and "Switching to" in f["text"] for f in frames)
        assert db.traces[0]["status"] == "failed"

    def test_a_too_large_artifact_request_is_resent_with_the_compact_brief(self, db, client):
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        refusal = (b'{"error":{"message":"Request too large for model openai/gpt-oss-120b on tokens per '
                   b'minute (TPM): Limit 8000, Requested 23511, please reduce your message size"}}')
        sent = []

        def answer(payload):
            sent.append(payload)
            return FakeStream(413, body=refusal) if len(sent) == 1 else FakeStream(200, sse(delta(html)))

        client({"openai/gpt-oss-120b": answer})
        frames = collect(page_ai.stream_generate_page("A shared to-do list", content_type="artifact"))
        assert frames[-1]["type"] == "done" and frames[-1]["model"] == "openai/gpt-oss-120b"
        retry = sent[1]
        assert retry["messages"][0]["content"].startswith("You build one self-contained")
        prompt_chars = sum(len(m["content"]) for m in retry["messages"])
        assert 2500 <= retry["max_tokens"] and prompt_chars / 3.3 + retry["max_tokens"] < 8000
        assert any(f["type"] == "status" and "shorter brief" in f["text"] for f in frames)

class TestChatRouter:
    def test_tokens_used_reaches_the_done_frame(self, db, http, client):
        client({"groq": FakeStream(200, sse(delta("===ANSWER===Alpha is fine.===END==="),
                                            {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}))})
        frames = sse_frames(http.post("/api/ai/chat/stream", json={"message": "hello there"}))
        assert frames[-1]["type"] == "done"
        assert frames[-1]["tokens_used"] == 15

    def test_a_failing_answer_check_leaves_the_streamed_answer_standing(self, db, http, client, monkeypatch):
        """The judge ran outside any try, so its failure turned a delivered
        answer into an error frame."""
        async def broken_judge(*_a, **_k):
            raise ValueError("All AI models are unavailable right now. Tried: judge models")
        monkeypatch.setattr(A, "judge_answer", broken_judge)
        client({"groq": FakeStream(200, sse(delta("===ANSWER===Alpha is fine.===END===")))})
        frames = sse_frames(http.post("/api/ai/chat/stream",
                                      json={"message": "hello there", "response_mode": "board"}))
        assert [f["type"] for f in frames if f["type"] in ("done", "error")] == ["done"]
        done = frames[-1]
        assert done["content"] == "Alpha is fine."
        assert done["verification"]["confidence"] == "unverified"
        assert done["verification"]["issues"]


# ── prompts ──────────────────────────────────────────────────────────────────

class TestPromptOverrides:
    def test_a_saved_prompt_replaces_the_built_in_one(self, db, client):
        db.prompts["project_autofill"] = "Return the project fields as JSON. House rules apply."
        fake = client({"groq": FakeResponse(200, ok_body('===ANSWER==={"client": "Acme"}===END==='))})
        assert run(orr.autofill_project("Website redesign for Acme")) == {"client": "Acme"}
        system = fake.calls[0].payload["messages"][0]
        assert system == {"role": "system", "content": "Return the project fields as JSON. House rules apply."}

    def test_the_chat_prompt_override_is_used_for_streaming(self, db, client):
        db.prompts["chat"] = f"Answer briefly. {orr.ANSWER_OPEN} … {orr.ANSWER_CLOSE}"
        fake = client({"groq": FakeStream(200, sse(delta("===ANSWER===Ok.===END===")))})
        stream_chat()
        assert fake.calls[0].payload["messages"][0]["content"].startswith("Answer briefly.")

    def test_without_an_override_the_built_in_prompt_runs(self, db, client):
        fake = client({"groq": FakeResponse(200, ok_body("Health Summary: fine"))})
        run(orr.analyze_project({"Client": "Acme"}))
        assert fake.calls[0].payload["messages"][0]["content"] == orr.SYSTEM_PROMPT

    def test_an_override_for_one_task_leaves_the_others_alone(self, db, client):
        db.prompts["chat"] = "Chat only."
        fake = client({"groq": FakeResponse(200, ok_body("Health Summary: fine"))})
        run(orr.analyze_project({"Client": "Acme"}))
        assert fake.calls[0].payload["messages"][0]["content"] == orr.SYSTEM_PROMPT


# ── invoices ─────────────────────────────────────────────────────────────────

INVOICE_ROUTE = [
    {"provider": "groq", "model": "openai/gpt-oss-120b"},
    {"provider": "openrouter", "model": "acme/reader-large:free"},
    {"provider": "openrouter", "model": "openrouter/free"},
]


class TestInvoiceVision:
    @pytest.fixture
    def invoices(self, db, client):
        db.tasks["invoice_parse"] = {"route": INVOICE_ROUTE}
        # Nothing in this id says it reads images; the provider's model list does.
        db.providers["openrouter"] = {"models": json.dumps([
            {"id": "acme/reader-large:free", "context": 131072, "vision": True, "free": True},
            {"id": "openrouter/free", "context": 200000, "vision": False, "free": True},
        ])}
        return client({
            "groq": FakeResponse(200, ok_body('===ANSWER==={"invoice_number": "WM/26-27/049"}===END===')),
            "openrouter": FakeResponse(200, ok_body('===ANSWER==={"invoice_number": "WM/26-27/049"}===END===')),
        })

    def test_an_image_goes_to_a_model_known_to_read_images_first(self, invoices):
        out = run(orr.parse_invoice_document(b"\x89PNG fake", "invoice.png", "image/png"))
        assert out["invoice_number"] == "WM/26-27/049"
        assert [c.model for c in invoices.calls] == ["acme/reader-large:free"]
        content = invoices.calls[0].payload["messages"][1]["content"]
        assert content[1]["type"] == "image_url"

    def test_the_other_steps_still_follow_for_an_image(self, invoices, db):
        invoices.script["openrouter"] = FakeResponse(503, error_body("busy"))
        run(orr.parse_invoice_document(b"\x89PNG fake", "invoice.png", "image/png"))
        assert [c.model for c in invoices.calls if c.provider == "groq"] == ["openai/gpt-oss-120b"]
        assert [t["extra"]["attempt"] for t in db.traces] == [1, 2]

    def test_a_pdf_keeps_the_route_order(self, invoices, monkeypatch):
        monkeypatch.setattr(orr, "_extract_pdf_text", lambda _content: "TAX INVOICE # WM/26-27/049")
        run(orr.parse_invoice_document(b"%PDF-1.4", "invoice.pdf", "application/pdf"))
        assert [c.model for c in invoices.calls] == ["openai/gpt-oss-120b"]

    def test_parsing_works_with_only_a_groq_key(self, invoices, monkeypatch):
        """It used to refuse outright without OPENROUTER_API_KEY."""
        monkeypatch.setattr(G.settings, "openrouter_api_key", None)
        monkeypatch.setattr(orr, "_extract_pdf_text", lambda _content: "TAX INVOICE # WM/26-27/049")
        out = run(orr.parse_invoice_document(b"%PDF-1.4", "invoice.pdf", "application/pdf"))
        assert out["invoice_number"] == "WM/26-27/049"
        assert {c.provider for c in invoices.calls} == {"groq"}


# ── embeddings ───────────────────────────────────────────────────────────────

class TestEmbeddings:
    """Groq has no embeddings endpoint, so they stay on OpenRouter — with
    the key and base URL the gateway resolves, not the env var alone."""

    @pytest.fixture
    def posted(self, monkeypatch):
        calls = []

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, headers=None, json=None, **kw):
                calls.append(SimpleNamespace(url=url, headers=headers or {}, body=json or {}))
                return FakeResponse(200, {"data": [{"embedding": [0.25, 0.5]}]})

        monkeypatch.setattr(embeddings, "shared_client", lambda **k: Client())
        return calls

    def test_a_key_saved_in_the_gateway_is_used(self, db, posted, monkeypatch):
        monkeypatch.setattr(G.settings, "openrouter_api_key", None)
        db.providers["openrouter"] = {"api_key_enc": G.encrypt_key("sk-or-stored-5678"),
                                      "base_url": "https://gateway.example/api/v1"}
        assert run(embeddings.get_embedding("hello")) == [0.25, 0.5]
        (call,) = posted
        assert call.url == "https://gateway.example/api/v1/embeddings"
        assert call.headers["Authorization"] == "Bearer sk-or-stored-5678"
        assert call.body["model"] == "openai/text-embedding-3-small"

    def test_the_env_key_still_works_on_its_own(self, db, posted):
        assert run(embeddings.get_embedding("hello")) == [0.25, 0.5]
        assert posted[0].url == "https://openrouter.ai/api/v1/embeddings"
        assert posted[0].headers["Authorization"] == "Bearer or-test-key"

    def test_a_switched_off_openrouter_asks_for_nothing(self, db, posted):
        db.providers["openrouter"] = {"enabled": False}
        assert run(embeddings.get_embedding("hello")) is None
        assert posted == []
