"""Gemini through Google's OpenAI-compatible endpoint: its model names, and a
thinking budget that leaves room for the answer."""
from app.services import ai_gateway as gw
from app.services.openrouter import ModelSpec, _build_payload


def test_model_list_ids_lose_the_models_prefix():
    payload = {"data": [{"id": "models/gemini-2.5-flash", "object": "model"},
                        {"id": "models/gemini-2.5-pro", "object": "model"},
                        {"id": "models/text-embedding-004", "object": "model"}]}
    ids = [m["id"] for m in gw.parse_models("gemini", payload)]
    assert "gemini-2.5-flash" in ids and "gemini-2.5-pro" in ids
    assert not any(i.startswith("models/") for i in ids)
    assert "text-embedding-004" not in ids


def _payload(model):
    spec = ModelSpec(id=model, provider="gemini", flavor="gemini")
    return _build_payload(spec, [{"role": "user", "content": "hi"}], max_tokens=300)


def test_flash_answers_without_spending_the_budget_on_thinking():
    p = _payload("models/gemini-2.5-flash")
    assert p["model"] == "gemini-2.5-flash"
    assert p["reasoning_effort"] == "none"


def test_pro_thinks_at_the_lowest_level():
    assert _payload("gemini-2.5-pro")["reasoning_effort"] == "low"


def test_older_models_get_no_thinking_field():
    assert "reasoning_effort" not in _payload("gemini-2.0-flash")


def test_a_provider_on_googles_host_speaks_the_gemini_flavour():
    assert "generativelanguage.googleapis.com" in gw.PRESETS["gemini"].default_base_url
    p = gw.ProviderState.__new__(gw.ProviderState)
    object.__setattr__(p, "key", "gemini-2")
    object.__setattr__(p, "base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
    assert p.flavor == "gemini"
