"""A ready provider's models back up every chain, and a request too big for
every model says what to add."""
from types import SimpleNamespace as NS

import pytest

from app.services import ai_gateway as gw
from app.services.openrouter import _Cascade, ModelSpec


def _cfg():
    groq = NS(key="groq", ready=True, preset="groq")
    gemini = NS(key="gemini", ready=True, preset="gemini")
    deepseek = NS(key="deepseek", ready=True, preset="deepseek")
    offline = NS(key="openai", ready=False, preset="openai")
    entry = lambda limit, on=True: NS(enabled=on, request_token_limit=limit, context_window=None)
    return NS(providers={"groq": groq, "gemini": gemini, "deepseek": deepseek, "openai": offline},
              catalog={("groq", "openai/gpt-oss-20b"): entry(8000),
                       ("gemini", "gemini-2.5-pro"): entry(1_000_000),
                       ("gemini", "gemini-2.5-flash"): entry(1_000_000, on=False)}), groq


def test_unrouted_models_of_ready_providers_follow_the_chain():
    cfg, groq = _cfg()
    chain = [(groq, {"provider": "groq", "model": "openai/gpt-oss-120b"}, None)]
    extra = gw._last_resort_steps(cfg, chain)
    names = [(p.key, s["model"]) for p, s, _ in extra]
    assert names[0] == ("gemini", "gemini-2.5-pro")          # biggest limit first
    assert ("gemini", "gemini-2.5-flash") not in names        # switched off stays off
    assert ("deepseek", "deepseek-chat") in names             # empty catalogue: the default model
    assert not any(k == "openai" for k, _ in names)           # no key, not tried
    assert all(s["fallback"] for _p, s, _e in extra)


def test_a_request_too_big_for_every_model_says_what_to_add():
    c = _Cascade("page_build")
    spec = ModelSpec(id="openai/gpt-oss-120b", provider="groq")
    c.errors = ["gpt-oss-120b (Groq): Request too large for model",
                "free (OpenRouter): no response in 45s"]
    c.contacted = True
    with pytest.raises(ValueError, match="too big for every AI model"):
        c.give_up()
