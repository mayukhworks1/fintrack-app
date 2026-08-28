"""
Groq as a second AI provider.

Every OpenRouter model in the cascade is on a free tier rate-limited per
ACCOUNT, so a busy hour exhausts all of them together and every AI feature in
the app fails at once. Groq is an independent provider with its own key and its
own quota, tried once OpenRouter is spent.

These tests exercise the thing that makes the fallback real rather than
decorative: a 401 or 402 from OpenRouter used to `raise` and abort the cascade,
so a dead key would have stopped the run before Groq was ever reached.
"""

import asyncio
import json

import pytest

from app.config import settings
from app.services import openrouter as orr


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or json.dumps(self._payload)

    def json(self):
        return self._payload


def ok_body(content="hello"):
    return {"choices": [{"message": {"content": content}}],
            "usage": {"total_tokens": 10}}


class FakeClient:
    """Records every call and replays a scripted response per host."""

    def __init__(self, by_host):
        self.by_host = by_host
        self.calls = []          # (url, model, headers)

    async def post(self, url, headers=None, json=None, **kw):
        self.calls.append((url, (json or {}).get("model"), headers or {}))
        host = "groq" if "groq.com" in url else "openrouter"
        result = self.by_host[host]
        return result(json) if callable(result) else result


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "or-test-key")
    monkeypatch.setattr(settings, "groq_api_key", "gsk-test-key")
    monkeypatch.setattr(settings, "groq_models", "llama-3.3-70b-versatile")
    monkeypatch.setattr(settings, "openrouter_model", "meta-llama/llama-4-scout:free")


def run_chat(monkeypatch, by_host):
    client = FakeClient(by_host)
    monkeypatch.setattr(orr, "_client", lambda: client)
    monkeypatch.setattr(orr.asyncio, "sleep", lambda *_a, **_k: asyncio.sleep(0))
    result = asyncio.run(orr._try_chat([{"role": "user", "content": "hi"}], extract=False))
    return result, client


class TestFailover:
    def test_openrouter_answers_and_groq_is_never_touched(self, keys, monkeypatch):
        """The paid-for-nothing path stays the default; Groq quota is not spent."""
        result, client = run_chat(monkeypatch, {
            "openrouter": FakeResponse(200, ok_body("from openrouter")),
            "groq": FakeResponse(200, ok_body("from groq")),
        })
        assert result["content"] == "from openrouter"
        assert all("groq.com" not in url for url, _, _ in client.calls)

    def test_a_dead_openrouter_key_falls_through_to_groq(self, keys, monkeypatch):
        """
        401 used to raise, which ended the run. If that were still true the
        fallback could never fire — this is the regression that matters most.
        """
        result, client = run_chat(monkeypatch, {
            "openrouter": FakeResponse(401, {"error": {"message": "no"}}),
            "groq": FakeResponse(200, ok_body("from groq")),
        })
        assert result["content"] == "from groq"
        assert result["model"] == "llama-3.3-70b-versatile"

    def test_an_exhausted_openrouter_quota_falls_through_to_groq(self, keys, monkeypatch):
        result, _ = run_chat(monkeypatch, {
            "openrouter": FakeResponse(402, {"error": {"message": "quota"}}),
            "groq": FakeResponse(200, ok_body("from groq")),
        })
        assert result["content"] == "from groq"

    def test_every_openrouter_model_rate_limited_falls_through_to_groq(self, keys, monkeypatch):
        """The common real failure: 429 across the whole free tier."""
        result, _ = run_chat(monkeypatch, {
            "openrouter": FakeResponse(429, {"error": {"message": "rate"}}),
            "groq": FakeResponse(200, ok_body("from groq")),
        })
        assert result["content"] == "from groq"

    def test_a_dead_key_is_tried_once_not_once_per_model(self, keys, monkeypatch):
        """
        401 condemns the key, not the model. Re-asking twelve times would add
        twelve round trips to every request during an outage.
        """
        _, client = run_chat(monkeypatch, {
            "openrouter": FakeResponse(401, {"error": {"message": "no"}}),
            "groq": FakeResponse(200, ok_body("ok")),
        })
        or_calls = [c for c in client.calls if "groq.com" not in c[0]]
        assert len(or_calls) == 1

    def test_both_providers_down_reports_both(self, keys, monkeypatch):
        client = FakeClient({
            "openrouter": FakeResponse(401, {"error": {"message": "no"}}),
            "groq": FakeResponse(401, {"error": {"message": "no"}}),
        })
        monkeypatch.setattr(orr, "_client", lambda: client)
        with pytest.raises(ValueError) as exc:
            asyncio.run(orr._try_chat([{"role": "user", "content": "hi"}], extract=False))
        message = str(exc.value)
        assert "OpenRouter" in message and "Groq" in message


class TestRequestShape:
    def test_groq_is_called_on_its_own_host_with_its_own_key(self, keys, monkeypatch):
        _, client = run_chat(monkeypatch, {
            "openrouter": FakeResponse(401, {"error": {"message": "no"}}),
            "groq": FakeResponse(200, ok_body("ok")),
        })
        url, model, headers = next(c for c in client.calls if "groq.com" in c[0])
        assert url == "https://api.groq.com/openai/v1/chat/completions"
        assert headers["Authorization"] == "Bearer gsk-test-key"
        assert model == "llama-3.3-70b-versatile"

    def test_the_openrouter_only_reasoning_field_is_not_sent_to_groq(self, keys, monkeypatch):
        """Groq validates its body strictly and rejects unknown fields, so
        leaking OpenRouter's `reasoning` extension would fail every call."""
        spec = next(m for m in orr.MODELS if m.supports_reasoning_param)
        groq_spec = orr._groq_models()[0]
        assert "reasoning" in orr._build_payload(spec, [], max_tokens=8)
        assert "reasoning" not in orr._build_payload(groq_spec, [], max_tokens=8)

    def test_openrouter_keeps_its_attribution_headers(self, keys):
        headers = orr._make_headers("openrouter")
        assert headers["HTTP-Referer"].startswith("https://")
        assert headers["X-Title"] == "FinTrack AI"


class TestConfiguration:
    def test_groq_is_absent_from_the_cascade_when_unconfigured(self, monkeypatch):
        """No key must mean no Groq entries at all — otherwise every request
        would end by failing against models it cannot authenticate to."""
        monkeypatch.setattr(settings, "openrouter_api_key", "or")
        monkeypatch.setattr(settings, "groq_api_key", None)
        assert all(m.provider == "openrouter" for m in orr._ordered_models())

    def test_groq_leads_when_it_is_the_only_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "openrouter_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", "gsk")
        monkeypatch.setattr(settings, "groq_models", "llama-3.3-70b-versatile")
        models = orr._ordered_models()
        assert models and all(m.provider == "groq" for m in models)

    def test_groq_is_the_tail_not_the_head_when_both_are_set(self, keys):
        providers = [m.provider for m in orr._ordered_models()]
        assert providers[0] == "openrouter"
        assert providers[-1] == "groq"

    def test_no_provider_at_all_is_a_clear_error(self, monkeypatch):
        monkeypatch.setattr(settings, "openrouter_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)
        with pytest.raises(ValueError) as exc:
            asyncio.run(orr._try_chat([{"role": "user", "content": "hi"}]))
        assert "OPENROUTER_API_KEY" in str(exc.value)

    def test_model_ids_come_from_settings_so_a_dead_model_needs_no_redeploy(self, monkeypatch):
        monkeypatch.setattr(settings, "groq_api_key", "gsk")
        monkeypatch.setattr(settings, "groq_models", " a-model , b-model ,, ")
        assert [m.id for m in orr._groq_models()] == ["a-model", "b-model"]
