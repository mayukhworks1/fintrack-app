"""
The AI gateway's circuit breaker, and requests sized to the model up front.

  * a model that fails three times in a row is benched: moved to the end of
    every chain, so the healthy steps go first; a provider whose fault it is
    (network, 5xx, a refused key) is benched as a whole;
  * the bench runs out on its own and one success clears it; a benched step
    is still tried when nothing before it answers, so the breaker can never
    turn a degraded service into no service;
  * a model whose catalogue entry gives a per-request token limit gets a
    request that fits: a smaller answer budget, the compact page brief, or
    the next step when even the prompt is too large — before anything is
    sent, rather than after a 413.

Runs on the in-memory fakes of test_ai_fallback (no database).
"""

import pytest

from app.services import ai_gateway as G
from app.services import openrouter as orr
from app.services import page_ai
from tests.test_ai_fallback import (  # noqa: F401  (fixtures)
    FakeResponse, FakeStream, chat, client, collect, db, delta, error_body, ok_body, run, sse,
)


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 1_000_000.0}
    monkeypatch.setattr(G, "_clock", lambda: now["t"])
    return now


def order(task="chat"):
    return [(m.provider, m.id) for m in run(orr._ordered_models(task))]


DEFAULT = [("groq", "openai/gpt-oss-120b"), ("groq", "openai/gpt-oss-20b"), ("openrouter", "openrouter/free")]


class TestBreaker:
    def test_three_failures_in_a_row_bench_a_model_and_its_steps_go_last(self, db, client, clock):
        client({"openai/gpt-oss-120b": FakeResponse(400, error_body("model is decommissioned")),
                "groq": FakeResponse(200, ok_body("from 20b"))})
        for _ in range(3):
            assert chat()["model"] == "openai/gpt-oss-20b"
        assert order() == [DEFAULT[1], DEFAULT[2], DEFAULT[0]]
        (bench,) = G.bench_list()
        assert bench["kind"] == "model" and bench["model"] == "openai/gpt-oss-120b" and bench["failures"] == 3
        assert "model is decommissioned" in bench["last_error"]
        # The provider itself is fine: its other model kept answering.
        assert G.bench_reason("groq") is None

    def test_the_bench_runs_out_and_a_success_clears_it(self, db, client, clock):
        fake = client({"openai/gpt-oss-120b": [FakeResponse(400, error_body("x"))] * 3
                       + [FakeResponse(200, ok_body("recovered"))],
                       "groq": FakeResponse(200, ok_body("from 20b"))})
        for _ in range(3):
            chat()
        assert order()[-1] == DEFAULT[0]
        clock["t"] += 5 * 60 + 1                     # the default bench is five minutes
        assert order() == DEFAULT
        assert chat()["content"] == "recovered"
        assert G.bench_list() == [] and "m:groq|openai/gpt-oss-120b" not in G._breaker
        assert fake.calls[-1].model == "openai/gpt-oss-120b"

    def test_one_more_failure_after_the_bench_benches_it_again_at_once(self, db, client, clock):
        client({"openai/gpt-oss-120b": FakeResponse(400, error_body("x")),
                "groq": FakeResponse(200, ok_body("ok"))})
        for _ in range(3):
            chat()
        clock["t"] += 301
        chat()
        assert G.bench_reason("groq", "openai/gpt-oss-120b")

    def test_a_provider_fault_benches_the_whole_provider(self, db, client, clock):
        client({"groq": FakeResponse(503, error_body("overloaded")),
                "openrouter": FakeResponse(200, ok_body("from openrouter"))})
        for _ in range(2):
            assert chat()["provider"] == "openrouter"
        assert G.bench_reason("groq", "openai/gpt-oss-20b").startswith("provider benched")
        assert order() == [DEFAULT[2], DEFAULT[0], DEFAULT[1]]

    def test_a_benched_step_is_still_tried_when_nothing_else_answers(self, db, client, clock):
        fake = client({"groq": FakeResponse(401, error_body("bad key")),
                       "openrouter": [FakeResponse(500, error_body("down"))] * 9 + [FakeResponse(200, ok_body("late"))]})
        for _ in range(3):
            with pytest.raises(ValueError):
                chat()
        assert G.bench_reason("openrouter") and G.bench_reason("groq")
        attempts = []
        assert chat(attempts=attempts)["content"] == "late"
        assert all(a["benched"] for a in attempts)
        # The answer took openrouter off the bench.
        assert G.bench_reason("openrouter") is None

    def test_rate_limits_count_against_the_model_not_the_provider(self, db, client, clock):
        client({"groq": FakeResponse(429, error_body("slow down")),
                "openrouter": FakeResponse(200, ok_body("ok"))})
        for _ in range(3):
            chat()
        assert G.bench_reason("groq") is None
        assert G.bench_reason("groq", "openai/gpt-oss-120b")

    def test_a_zero_minute_bench_switches_the_breaker_off(self, db, client, clock, monkeypatch):
        cfg = run(G.get_config())
        monkeypatch.setitem(cfg.breaker, "minutes", 0)
        client({"openai/gpt-oss-120b": FakeResponse(400, error_body("x")),
                "groq": FakeResponse(200, ok_body("ok"))})
        for _ in range(4):
            chat()
        assert G.bench_list() == [] and order() == DEFAULT

    def test_a_reset_takes_it_off_the_bench(self, db, client, clock):
        client({"openai/gpt-oss-120b": FakeResponse(400, error_body("x")),
                "groq": FakeResponse(200, ok_body("ok"))})
        for _ in range(3):
            chat()
        assert G.reset_bench("m:groq|openai/gpt-oss-120b") == 1
        assert order() == DEFAULT


def _with_entry(provider, model, **kw):
    cfg = run(G.get_config())
    cfg.catalog[(provider, model)] = G.ModelEntry(provider, model, **kw)
    return cfg


class TestRequestSizing:
    def test_the_answer_budget_is_cut_to_the_models_limits(self):
        spec = orr.ModelSpec("m", max_output=600)
        assert orr.fit_budget(spec, [{"role": "user", "content": "hi"}], 1024) == 600
        spec = orr.ModelSpec("m", request_limit=1000)
        msgs = [{"role": "user", "content": "x" * 2000}]          # ~500 tokens
        assert 300 <= orr.fit_budget(spec, msgs, 1024) < 500
        assert orr.fit_budget(spec, [{"role": "user", "content": "x" * 3600}], 1024) is None

    def test_a_prompt_too_large_for_a_step_moves_on_without_sending_it(self, db, client):
        _with_entry("groq", "openai/gpt-oss-120b", request_token_limit=600)
        fake = client({"groq": FakeResponse(200, ok_body("small enough"))})
        attempts = []
        result = run(orr._try_chat([{"role": "user", "content": "y" * 4000}], max_tokens=200,
                                   extract=False, attempts=attempts))
        assert result["model"] == "openai/gpt-oss-20b"
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-20b"]
        assert attempts[0]["skipped"] and "per-request token limit" in attempts[0]["error"]

    def test_max_tokens_follows_the_catalogue(self, db, client):
        _with_entry("groq", "openai/gpt-oss-120b", max_output_tokens=300)
        fake = client({"groq": FakeResponse(200, ok_body("ok"))})
        run(orr._try_chat([{"role": "user", "content": "hi"}], max_tokens=1024, extract=False))
        assert fake.calls[0].payload["max_tokens"] == 300

    def test_a_page_build_sends_the_compact_brief_first_when_the_limit_is_known(self, db, client):
        """The 413 path still exists, but a model whose limit is in the
        catalogue never needs it: the first request already fits."""
        _with_entry("groq", "openai/gpt-oss-120b", request_token_limit=8000)
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        sent = []

        def answer(payload):
            sent.append(payload)
            return FakeStream(200, sse(delta(html)))

        client({"openai/gpt-oss-120b": answer})
        frames = collect(page_ai.stream_generate_page("A shared to-do list", content_type="artifact"))
        assert frames[-1]["type"] == "done" and frames[-1]["model"] == "openai/gpt-oss-120b"
        assert len(sent) == 1
        first = sent[0]
        assert first["messages"][0]["content"].startswith("You build one self-contained")
        prompt_chars = sum(len(m["content"]) for m in first["messages"])
        assert 2500 <= first["max_tokens"] and prompt_chars / 3.3 + first["max_tokens"] < 8000
        assert any(f["type"] == "status" and "at most 8,000 tokens" in f["text"] for f in frames)

    def test_a_model_too_small_for_any_brief_is_skipped(self, db, client):
        _with_entry("groq", "openai/gpt-oss-120b", request_token_limit=1500)
        html = "<!DOCTYPE html><html><body><main>Hi</main></body></html>"
        fake = client({"openai/gpt-oss-20b": FakeStream(200, sse(delta(html)))})
        frames = collect(page_ai.stream_generate_page("A shared to-do list", content_type="artifact"))
        assert frames[-1]["model"] == "openai/gpt-oss-20b"
        assert [c.model for c in fake.calls] == ["openai/gpt-oss-20b"]


class TestPlainWords:
    @pytest.mark.parametrize("error,status,kind,needle", [
        ("key rejected (HTTP 401)", 401, "failed", "rejected the API key"),
        ("rate-limited", 429, "failed", "Rate-limited"),
        ("timeout/network", None, "failed", "too long"),
        ("Request too large", 413, "failed", "larger than the model accepts"),
        ("The model `x` does not exist", 404, "failed", "doesn't offer this model"),
        ("upstream", 502, "failed", "server error"),
        ("This week's AI limit for the workspace has been reached.", None, "not_sent", "usage limit"),
        ("AI for chat is switched off by the administrator.", None, "not_sent", "switched off"),
    ])
    def test_why_a_call_failed(self, error, status, kind, needle):
        assert needle in G.explain_failure(error, status, kind)

    def test_an_answered_call_needs_no_explanation(self):
        assert G.explain_failure(None, 200, "ok") is None
