"""
Artifact quality: the design system in the brief, the output budget, and the
plan step that asks before building (POST /api/pages/ai/plan).
"""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import app.main as M
import app.routers.ai as A
import app.routers.deps as D
import app.services.ai_usage as U
from app.routers.auth import make_token
from app.services import ai_gateway as G
from app.services import artifact, artifact_design, artifact_plan, page_ai


# --- the brief -------------------------------------------------------------------

class TestDesignBrief:
    def test_the_brief_carries_the_kit_stylesheet_and_icons(self):
        rules = artifact.ARTIFACT_RULES
        assert artifact_design.BASE_CSS in rules
        assert artifact_design.ICON_SPRITE in rules
        for cls in (".app-header", ".btn-primary", ".btn-ghost", ".btn-danger", ".btn-icon",
                    ".check", ".switch", ".seg", ".row", ".badge", ".chip", ".table",
                    ".empty", ".toast", ".skeleton"):
            assert cls in artifact_design.BASE_CSS, cls

    def test_the_kit_has_tokens_for_both_themes_and_respects_reduced_motion(self):
        css = artifact_design.BASE_CSS
        assert "--accent:" in css and "--radius" not in css  # one radius scale: --r-*
        assert "@media (prefers-color-scheme:dark)" in css
        assert "prefers-reduced-motion:reduce" in css
        assert "'Inter'" in css and "system-ui" in css

    def test_old_decoration_trade_off_is_gone(self):
        rules = artifact.ARTIFACT_RULES
        assert "finishing the file matters more than decoration" not in rules
        # ... but finishing the file still matters.
        assert "MUST be complete" in rules

    def test_brief_covers_patterns_content_and_self_check(self):
        rules = artifact.ARTIFACT_RULES
        for phrase in ("COMPONENT RULES", "CONTENT QUALITY", "SELF-CHECK", "tabular",
                       "Undo toast", "All / Active / Done", "Keyboard", "Mobile",
                       "Synced", ".skeleton rows", "Booking", "Poll", "Game"):
            assert phrase in rules, phrase
        # The self-check is the last thing before the output format.
        assert rules.index("SELF-CHECK") > rules.index("CONTENT QUALITY")
        assert rules.index("SELF-CHECK") < rules.index("OUTPUT FORMAT")

    def test_built_in_kit_templates_use_the_same_stylesheet(self):
        from pathlib import Path
        folder = Path(__file__).resolve().parents[2] / "frontend/src/components/artifacts/templates"
        pages = sorted(folder.glob("*.html"))
        if not pages:
            pytest.skip("frontend not checked out next to the backend")
        for page in pages:
            text = page.read_text()
            assert artifact_design.BASE_CSS in text, f"{page.name} has drifted from the kit"
            assert "https://fonts.googleapis.com/css2?" in text

    def test_icons_are_inline_svg_symbols(self):
        sprite = artifact_design.icon_sprite(["plus", "trash", "nope"])
        assert sprite.count("<symbol") == 2 and 'id="i-plus"' in sprite and 'id="i-trash"' in sprite

    @pytest.mark.parametrize("prompt,key", [
        ("a to do list organiser", "clean"),
        ("a dark analytics dashboard for my portfolio", "pro"),
        ("a recipe journal", "warm"),
        ("a quiz game for kids", "playful"),
    ])
    def test_direction_is_picked_per_prompt(self, prompt, key):
        assert artifact_design.pick(prompt).key == key
        assert f'"{artifact_design.BY_KEY[key].label}"' in page_ai._rules_for("artifact", prompt)

    def test_an_explicit_style_wins(self):
        rules = page_ai._rules_for("artifact", "a to do list", "playful")
        assert 'DESIGN DIRECTION — "Playful"' in rules
        assert "Plus+Jakarta+Sans" in rules

    def test_web_pages_keep_their_own_directions(self):
        rules = page_ai._rules_for("html", "an editorial blog")
        assert artifact_design.BASE_CSS not in rules


class TestBudget:
    def test_artifacts_get_a_bigger_output_budget(self):
        assert page_ai.max_tokens_for("artifact") == page_ai.ARTIFACT_MAX_TOKENS >= 14000
        assert page_ai.max_tokens_for("html") == page_ai.MAX_TOKENS
        assert G.TASKS["page_build"].max_tokens == page_ai.ARTIFACT_MAX_TOKENS

    def test_stream_requests_the_artifact_budget_and_style(self, monkeypatch):
        seen = {}

        async def admit(task, **kw):
            return None

        async def ordered(task):
            return []

        class Cascade:
            def __init__(self, task): pass
            def give_up(self): raise ValueError("no models")

        monkeypatch.setattr(page_ai.gateway, "admit", admit)
        monkeypatch.setattr(page_ai, "_ordered_models", ordered)
        monkeypatch.setattr(page_ai, "_Cascade", Cascade)
        real = page_ai._rules_for

        def spy(content_type, brief="", style=None):
            seen["style"] = style
            return real(content_type, brief, style)
        monkeypatch.setattr(page_ai, "_rules_for", spy)

        async def go():
            async for _ in page_ai.stream_generate_page("todo", content_type="artifact", style="warm"):
                pass
        with pytest.raises(ValueError):
            asyncio.run(go())
        assert seen["style"] == "warm"


# --- plan: parsing and repair --------------------------------------------------------

GOOD = {
    "title": "Task Organiser",
    "summary": "Plan your day.",
    "features": ["Add with Enter", "Filter All / Active / Done", "Undo delete", "Due dates", "Add with Enter"],
    "questions": [
        {"id": "data-sharing", "question": "Should everyone with the link see the same data?",
         "options": ["Yes", "No"], "multi": False, "default": "No"},
        {"id": "style", "question": "Style?", "options": ["Dark", "Light"]},
        {"id": "extras", "question": "Extras?", "options": ["Due dates", "Priorities", "Tags"],
         "multi": True, "default": ["Priorities", "Nope"]},
        {"id": "bad", "question": "One option", "options": ["Only"]},
    ],
}


class TestPlanParsing:
    def test_fenced_json_with_prose_and_trailing_commas(self):
        raw = 'Sure! Here is the plan:\n```json\n{"title": "X", "features": ["a", "b", "c",],}\n```'
        assert artifact_plan.parse_plan_json(raw) == {"title": "X", "features": ["a", "b", "c"]}

    def test_smart_quotes_are_straightened(self):
        raw = '{“title”: “X”}'
        assert artifact_plan.parse_plan_json(raw) == {"title": "X"}

    def test_a_cut_off_answer_is_closed(self):
        raw = '{"title": "X", "features": ["one", "two", "thr'
        parsed = artifact_plan.parse_plan_json(raw)
        assert parsed["title"] == "X" and parsed["features"][:2] == ["one", "two"]

    def test_garbage_is_none(self):
        assert artifact_plan.parse_plan_json("I can't help with that") is None
        assert artifact_plan.parse_plan_json("[1, 2]") is None

    def test_normalise_cleans_the_plan(self):
        plan = artifact_plan.normalise_plan(GOOD, "make a to do list")
        assert plan["fallback"] is False
        assert plan["features"] == ["Add with Enter", "Filter All / Active / Done", "Undo delete", "Due dates"]
        ids = [q["id"] for q in plan["questions"]]
        assert ids == ["data-sharing", "extras"]          # style and one-option questions dropped
        assert plan["questions"][0]["default"] == "No"
        assert plan["questions"][1]["default"] == ["Priorities"]   # unknown default dropped
        assert [s["id"] for s in plan["style_options"]] == [d.key for d in artifact_design.DIRECTIONS]
        assert plan["style_default"] == "clean"

    def test_a_bad_single_default_falls_back_to_the_first_option(self):
        q = artifact_plan._questions([{"question": "Who?", "options": "Me, Team", "default": "Clients"}])
        assert q[0]["options"] == ["Me", "Team"] and q[0]["default"] == "Me" and q[0]["id"] == "who"

    def test_too_little_to_show_is_none(self):
        assert artifact_plan.normalise_plan({"features": ["one"]}, "x") is None
        assert artifact_plan.normalise_plan({"title": "x", "questions": "none"}, "x") is None


class TestPlanCalls:
    def _chat(self, monkeypatch, content=None, exc=None, delay=0.0):
        calls = []

        async def fake(messages, **kw):
            calls.append(kw)
            if delay:
                await asyncio.sleep(delay)
            if exc:
                raise exc
            return {"content": content, "model": "m", "model_short": "m"}

        async def prompt_for(task, default):
            return default
        monkeypatch.setattr(artifact_plan, "_try_chat", fake)
        monkeypatch.setattr(artifact_plan, "_prompt_for", prompt_for)
        return calls

    def test_a_good_answer_becomes_a_plan_on_the_light_task(self, monkeypatch):
        calls = self._chat(monkeypatch, json.dumps(GOOD))
        plan = asyncio.run(artifact_plan.plan_artifact("make a to do list"))
        assert plan["title"] == "Task Organiser" and not plan["fallback"]
        assert calls[0]["task"] == "artifact_plan"
        assert calls[0]["max_tokens"] <= 1500 and calls[0]["budget_s"] <= 15

    def test_unparseable_answer_falls_back(self, monkeypatch):
        self._chat(monkeypatch, "no json here")
        assert asyncio.run(artifact_plan.plan_artifact("x")) == {"fallback": True, "reason": "unparseable"}

    def test_model_failure_falls_back(self, monkeypatch):
        self._chat(monkeypatch, exc=ValueError("every model failed"))
        assert asyncio.run(artifact_plan.plan_artifact("x"))["fallback"] is True

    def test_slow_model_times_out_and_falls_back(self, monkeypatch):
        self._chat(monkeypatch, json.dumps(GOOD), delay=0.5)
        monkeypatch.setattr(artifact_plan, "TIMEOUT_S", 0.05)
        assert asyncio.run(artifact_plan.plan_artifact("x")) == {"fallback": True, "reason": "timeout"}

    def test_bad_requests_are_refused(self):
        with pytest.raises(ValueError, match="prompt is required"):
            asyncio.run(artifact_plan.plan_artifact("  "))
        with pytest.raises(ValueError, match="artifacts only"):
            asyncio.run(artifact_plan.plan_artifact("x", content_type="html"))

    def test_the_task_is_registered_and_its_prompt_editable(self):
        tdef = G.TASKS["artifact_plan"]
        assert tdef.output == "json" and tdef.prompt_editable and tdef.max_tokens <= 1500
        for phrase in ("data-sharing", "who-edits", "Never ask about visual style"):
            assert phrase in artifact_plan.PLAN_SYSTEM


# --- plan over HTTP: auth and quota ----------------------------------------------------

@pytest.fixture
def client():
    return TestClient(M.app)


@pytest.fixture
def quota(monkeypatch):
    state = {"allowed": True}

    async def quota_state(user_id, role=None):
        return {"allowed": state["allowed"], "used": 0, "limit": 200, "metered": True}

    async def rate_check(key, limit=60, window_sec=60, bucket="ratelimit"):
        return state["allowed"], 0

    monkeypatch.setattr(U, "quota_state", quota_state)
    monkeypatch.setattr(A, "rate_check", rate_check)
    return state


@pytest.fixture
def model(monkeypatch):
    calls = []

    async def fake(messages, **kw):
        calls.append(kw["task"])
        return {"content": "```json\n" + json.dumps(GOOD) + "\n```", "model": "m", "model_short": "m"}

    async def prompt_for(task, default):
        return default
    monkeypatch.setattr(artifact_plan, "_try_chat", fake)
    monkeypatch.setattr(artifact_plan, "_prompt_for", prompt_for)
    return calls


def _post(client, role="editor", body=None):
    return client.post("/api/pages/ai/plan", headers={"Authorization": f"Bearer {make_token(role)}"},
                       json=body or {"prompt": "make a to do list organiser", "content_type": "artifact"})


class TestPlanEndpoint:
    def test_returns_the_plan(self, client, quota, model):
        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == "Task Organiser" and body["fallback"] is False
        assert body["questions"][0]["id"] == "data-sharing"
        assert model == ["artifact_plan"]

    def test_needs_a_sign_in(self, client, quota, model):
        r = client.post("/api/pages/ai/plan", json={"prompt": "x"})
        assert r.status_code == 401
        assert model == []

    def test_a_spent_allowance_is_refused(self, client, quota, model):
        quota["allowed"] = False
        r = _post(client)
        assert r.status_code == 429
        assert model == []

    def test_needs_module_ai_use(self, client, quota, model, monkeypatch):
        async def attach(request, token_hint, **_kw):
            request.state.is_email_auth = True
            request.state.auth_user_id = "00000000-0000-0000-0000-0000000000aa"
            request.state.auth_user_email = "maker@example.com"
            request.state.auth_role = "user"
            return {"user_id": request.state.auth_user_id}

        async def perms(user_id, *, fresh=False):
            return set()
        monkeypatch.setattr(D, "_attach_auth_session", attach)
        monkeypatch.setattr(D, "get_effective_permissions", perms)
        r = _post(client, role="viewer")
        assert r.status_code == 403
        assert model == []

    def test_an_empty_prompt_is_a_400(self, client, quota, model):
        r = _post(client, body={"prompt": " ", "content_type": "artifact"})
        assert r.status_code == 400
