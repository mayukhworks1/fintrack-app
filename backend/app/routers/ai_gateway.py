"""
Admin → AI gateway: providers, models, fallback chains, limits, prompts and
the call log.

Superadmin only: every route depends on require_superadmin, which also refuses
the legacy admin password. Keys go in as JSON bodies and never come back out —
responses and audit rows carry only the last four characters (key_hint).

Endpoints (prefix /api/admin/ai-gateway)
─────────
GET    ""                                  — everything below, with usage and alerts
POST   /providers                          — add a provider (preset or custom)
PATCH  /providers/{key}                    — on/off, name, base URL, headers, timeout
DELETE /providers/{key}                    — remove a provider
PUT    /providers/{key}/key                — store a key (encrypted)
DELETE /providers/{key}/key                — remove the stored key
POST   /providers/{key}/test               — list the provider's models with its key
POST   /providers/{key}/models/fetch       — the same, answering with the model list
POST   /providers/test-all
PUT    /models                             — add or change a catalogue model
POST   /models/import                      — add models from a provider's list
DELETE /models?provider=&model=            — remove a catalogue model
GET    /models/stats                       — success rate and latency per model
PUT    /routing/default                    — the global default chain (null = built-in)
PATCH  /breaker                            — circuit breaker settings
POST   /breaker/reset                      — take one (or every) provider/model off the bench
PUT    /limits                             — every limit of one scope and target
PATCH  /tasks/{key}                        — on/off, chain, default-chain fallback
GET    /tasks/{key}/prompt                 — built-in, current and version history
GET    /tasks/{key}/prompt/versions/{v}
PUT    /tasks/{key}/prompt                 — save a new version (null = built-in)
POST   /tasks/{key}/test                   — one real call through the task's chain
PATCH  /global                             — workspace daily caps (0003 shape)
GET    /calls                              — the call log, by IST day
GET    /calls/{id}

Every write is audited in auth_events. A database the gateway migration has
not reached still serves every read on the built-in defaults; writes answer
503 until it has. Provider CRUD, the model catalogue and the limits table
need migration 0008 as well; before it the 0003 settings keep serving.
"""

import asyncio
import functools
import json
import logging
import time
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from ..db.postgres import get_pool
from ..services import ai_gateway as gw
from ..services import openrouter
from .admin import _no_db, _write_auth_admin_event
from .ai import _ai_quota
from .deps import require_superadmin

logger = logging.getLogger("fintrack.ai_gateway.admin")
router = APIRouter(prefix="/api/admin/ai-gateway", tags=["ai-gateway"])

MAX_TEST_TOKENS = 700
MAX_LOG_DAYS = 92


# ── Bodies ────────────────────────────────────────────────────────────────────

class _Patch(BaseModel):
    # Unknown fields are refused by name, not by Pydantic: its errors echo the
    # rejected value, and a key pasted into the wrong form must not come back.
    model_config = ConfigDict(extra="allow")

    def changes(self) -> dict:
        if self.model_extra:
            raise HTTPException(status_code=422, detail=f"Unknown setting: {sorted(self.model_extra)[0]}")
        return self.model_dump(exclude_unset=True)


class ProviderPatch(_Patch):
    enabled: Optional[StrictBool] = None
    base_url: Optional[StrictStr] = None
    timeout_s: Optional[StrictInt] = Field(default=None, ge=gw.TIMEOUT_MIN_S, le=gw.TIMEOUT_MAX_S)
    daily_request_cap: Optional[StrictInt] = Field(default=None, ge=1)
    daily_token_cap: Optional[StrictInt] = Field(default=None, ge=1)
    label: Optional[StrictStr] = None
    extra_headers: Optional[dict[str, StrictStr]] = None


class RouteStepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: StrictStr
    model: StrictStr
    timeout_s: Optional[StrictInt] = None
    skip_over_limit: Optional[StrictBool] = None


class TaskPatch(_Patch):
    enabled: Optional[StrictBool] = None
    route: Optional[list[RouteStepBody]] = None
    daily_cap: Optional[StrictInt] = Field(default=None, ge=1)
    fallback_to_default: Optional[StrictBool] = None


class DefaultRouteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route: Optional[list[RouteStepBody]] = Field(...)


class ModelBody(_Patch):
    provider: StrictStr
    model: StrictStr
    label: Optional[StrictStr] = None
    enabled: Optional[StrictBool] = None
    context_window: Optional[StrictInt] = None
    max_output_tokens: Optional[StrictInt] = None
    request_token_limit: Optional[StrictInt] = None
    input_cost_per_m: Optional[float] = None
    output_cost_per_m: Optional[float] = None
    vision: Optional[StrictBool] = None


class ImportModelsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: StrictStr
    models: list[StrictStr] = Field(..., min_length=1, max_length=gw.MAX_CATALOG_MODELS)


class LimitItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: StrictStr
    metric: StrictStr
    cap: Optional[float] = None


class LimitsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: StrictStr
    target: StrictStr = ""
    limits: list[LimitItem] = Field(default_factory=list, max_length=9)


class BreakerPatch(_Patch):
    failures: Optional[StrictInt] = None
    minutes: Optional[StrictInt] = None


class BenchResetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: Optional[StrictStr] = Field(default=None, max_length=200)


class GlobalPatch(_Patch):
    daily_call_cap: Optional[StrictInt] = Field(default=None, ge=1)
    daily_token_cap: Optional[StrictInt] = Field(default=None, ge=1)


class PromptBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: Optional[StrictStr] = Field(...)


class TaskTestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: Optional[StrictStr] = Field(default=None, max_length=4000)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _gateway_errors(handler):
    """Map the gateway's write errors: a bad value → 422, tables the migration
    has not created yet → 503 with the storage message."""
    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        try:
            return await handler(*args, **kwargs)
        except gw.StorageNotReady as exc:
            return JSONResponse(status_code=503, content={"detail": str(exc) or gw.STORAGE_NOT_READY})
        except KeyError:
            raise HTTPException(status_code=404, detail="Not found") from None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    return wrapper


async def _provider_def(key: str) -> gw.ProviderState:
    p = (await gw.get_config()).providers.get(key)
    if p is None:
        raise HTTPException(status_code=404, detail="Unknown AI provider")
    return p


def _task_def(key: str) -> gw.TaskDef:
    if key not in gw.TASKS:
        raise HTTPException(status_code=404, detail="Unknown AI task")
    return gw.TASKS[key]


def _actor(request: Request) -> str | None:
    return getattr(request.state, "auth_user_email", None)


async def _audit(request: Request, event_type: str, metadata: dict) -> None:
    """
    One auth_events row per change, written once the change has committed.
    The gateway's write helpers own their connection, so the row cannot share
    their transaction; a failure here is logged and does not undo the change.
    Metadata never holds a key — only its hint.
    """
    pool = get_pool()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await _write_auth_admin_event(
                conn, request,
                event_type=event_type,
                actor_role="superadmin",
                target_user_id=None,
                email=_actor(request),
                status="ok",
                metadata=metadata,
            )
    except Exception as exc:
        logger.warning("AI gateway audit row %s not written: %s", event_type, type(exc).__name__)


def _usage_slot(bucket: dict, key: str) -> dict:
    slot = bucket.get(key) or {}
    return {"calls": int(slot.get("calls", 0)), "tokens": int(slot.get("tokens", 0))}


def _provider_out(p: gw.ProviderState, cfg: gw.GatewayConfig, usage: dict) -> dict:
    used_by: dict[str, list[str]] = {}
    for task_key, state in cfg.tasks.items():
        for step in state.route:
            if step.get("provider") == p.key:
                tasks = used_by.setdefault(step["model"], [])
                if task_key not in tasks:
                    tasks.append(task_key)
    in_default = sorted({s["model"] for s in cfg.default_route if s["provider"] == p.key})
    spent = _usage_slot(usage["by_provider"], p.key)
    return {
        "key": p.key,
        "label": p.label,
        "base_url": p.base_url,
        "default_base_url": p.default_base_url,
        "preset": p.preset,
        "builtin": p.builtin,
        "flavor": p.flavor,
        "extra_headers": dict(p.extra_headers),
        "in_default_route": in_default,
        "benched": gw.bench_reason(p.key),
        "catalog_count": sum(1 for (pk, _m) in cfg.catalog if pk == p.key),
        "enabled": p.enabled,
        "key_source": p.key_source,
        "key_hint": p.key_hint,
        "key_set_by": p.key_set_by,
        "key_set_at": p.key_set_at,
        "key_unreadable": p.key_unreadable,
        "env_var": p.env_var,
        "timeout_s": p.timeout_s,
        "default_timeout_s": p.default_timeout_s,
        "daily_request_cap": p.daily_request_cap,
        "daily_token_cap": p.daily_token_cap,
        "requests_today": spent["calls"],
        "tokens_today": spent["tokens"],
        "ready": p.ready,
        "last_test": dict(p.last_test) if p.last_test else None,
        "models": [dict(m) for m in p.models],
        "used_by": used_by,
    }


def _task_out(tdef: gw.TaskDef, cfg: gw.GatewayConfig, usage: dict) -> dict:
    state = cfg.tasks[tdef.key]
    spent = _usage_slot(usage["by_task"], tdef.key)
    return {
        "key": tdef.key,
        "label": tdef.label,
        "module": tdef.module,
        "description": tdef.description,
        "output": tdef.output,
        "personal_data": tdef.personal_data,
        "enabled": state.enabled,
        "route": [dict(s) for s in state.route],
        "route_custom": state.route_custom,
        "default_route": [dict(s) for s in (cfg.default_route if cfg.default_route_custom
                                            else tdef.default_route)],
        "fallback_to_default": state.fallback_to_default,
        "effective_route": gw.effective_route(cfg, tdef.key),
        "daily_cap": state.daily_cap,
        "calls_today": spent["calls"],
        "tokens_today": spent["tokens"],
        "prompt": {"editable": tdef.prompt_editable, "version": state.prompt_version,
                   "overridden": state.prompt_override is not None},
        "route_warnings": gw.route_warnings(state, cfg),
    }


def _global_out(cfg: gw.GatewayConfig, usage: dict) -> dict:
    return {
        "daily_call_cap": cfg.global_caps.get("daily_call_cap"),
        "daily_token_cap": cfg.global_caps.get("daily_token_cap"),
        "calls_today": int(usage["calls"]),
        "tokens_today": int(usage["tokens"]),
    }


async def _current(fresh: bool = False) -> tuple[gw.GatewayConfig, dict]:
    # After a write, a fresh read: a load already in flight may predate it.
    return await gw.get_config(force=fresh), await gw.usage_today()


async def _provider_response(key: str) -> dict:
    cfg, usage = await _current(fresh=True)
    return _provider_out(cfg.providers[key], cfg, usage)


async def _task_response(key: str) -> dict:
    cfg, usage = await _current(fresh=True)
    return _task_out(gw.TASKS[key], cfg, usage)


# ── Prompts ───────────────────────────────────────────────────────────────────

def _built_in_prompt(task: str) -> str:
    """The prompt an editable task runs with when no override is active — the
    same default each call site hands to the gateway."""
    from ..services import artifact_plan, page_ai, studio_ask
    return {
        "chat": openrouter.SYSTEM_PROMPT,
        "judge": openrouter._JUDGE_SYSTEM,
        "project_autofill": openrouter._AUTOFILL_SYSTEM,
        "project_analysis": openrouter.SYSTEM_PROMPT,
        "status_briefing": openrouter._STATUS_BRIEFING_SYSTEM,
        "status_update": openrouter._AI_UPDATE_SYSTEM,
        "invoice_parse": openrouter._INVOICE_EXTRACT_SYSTEM,
        "page_interview": page_ai._INTERVIEW_SYSTEM,
        "artifact_plan": artifact_plan.PLAN_SYSTEM,
        "studio_ask": studio_ask._SYSTEM,
    }[task]


def _page_build_parts() -> list[tuple[str, str]]:
    from ..services import artifact, page_ai, page_edit
    return [
        ("New web page (a design direction — palette and typefaces — is appended per request)",
         page_ai._HTML_RULES),
        ("New document", page_ai._MARKDOWN_RULES),
        ("New artifact (a design direction is appended per request; up to "
         f"{page_ai.ARTIFACT_MAX_TOKENS} output tokens)", artifact.ARTIFACT_RULES),
        ("Revising a page (the live page is sent with it)", page_edit.EDIT_RULES),
        ("Editing one section", page_ai._SECTION_EDIT_SYSTEM),
        ("Fixing a script error", page_ai._FIX_ERROR_SYSTEM),
    ]


def _studio_analyze_parts() -> list[tuple[str, str]]:
    from ..services import studio_analyst
    return [
        ("Turning the question into a query (rebuilt from the live data schema)",
         studio_analyst._system_prompt()),
        ("Explaining the result", studio_analyst._EXPLAIN),
    ]


# Tasks whose prompt is assembled per request: the fixed rules it is built from.
_ASSEMBLED_PROMPTS = {"page_build": _page_build_parts, "studio_analyze": _studio_analyze_parts}


def _assembled_prompt(task: str) -> str:
    parts = _ASSEMBLED_PROMPTS[task]() if task in _ASSEMBLED_PROMPTS else []
    return gw.TASKS[task].prompt_note + "".join(f"\n\n── {title} ──\n{text.strip()}" for title, text in parts)


async def _prompt_state(task: str, fresh: bool = False) -> dict:
    tdef = gw.TASKS[task]
    if not tdef.prompt_editable:
        text = _assembled_prompt(task)
        return {"editable": False, "default": text, "current": text, "version": 0,
                "overridden": False, "history": []}
    cfg = await gw.get_config(force=fresh)
    state = cfg.tasks[task]
    default = _built_in_prompt(task)
    return {
        "editable": True,
        "default": default,
        "current": state.prompt_override if state.prompt_override is not None else default,
        "version": state.prompt_version,
        "overridden": state.prompt_override is not None,
        "history": await gw.prompt_history(task),
    }


def _test_system_prompt(task: str, text: str, cfg: gw.GatewayConfig) -> str:
    if task == "page_build":
        from ..services import page_ai
        return page_ai._rules_for("html", text)
    if task == "studio_analyze":
        from ..services import studio_analyst
        return studio_analyst._system_prompt()
    return gw.system_prompt(task, _built_in_prompt(task), cfg)


# ── State ─────────────────────────────────────────────────────────────────────

def _label_of(cfg: gw.GatewayConfig, scope: str, target: str) -> str:
    if scope == "global":
        return "Workspace"
    if scope == "provider":
        p = cfg.providers.get(target)
        return p.label if p else target
    if scope == "model":
        provider, _, model = target.partition("|")
        entry = cfg.entry(provider, model)
        p = cfg.providers.get(provider)
        return f"{(p.label if p else provider)} · {(entry.label if entry and entry.label else model)}"
    if scope == "task":
        return gw.task_label(target)
    return "Each user" if target == gw.EVERY_USER else f"User {target[:8]}"


def _limit_rows(cfg: gw.GatewayConfig, views: dict) -> list[dict]:
    """Every limit with what it has used this period, grouped by target."""
    groups: dict[tuple, dict] = {}
    for lim in cfg.limits:
        group = groups.setdefault((lim.scope, lim.target), {
            "scope": lim.scope, "target": lim.target, "label": _label_of(cfg, lim.scope, lim.target),
            "limits": []})
        if lim.scope == "user" and lim.target == gw.EVERY_USER:
            # A limit for each user: the heaviest user this period is what is near it.
            users = (views.get(lim.period) or {}).get("by_user") or {}
            used = max((gw.used_of(slot, lim.metric) for slot in users.values()), default=0)
        else:
            used = gw.used_of(gw._slot(views, lim.period, lim.scope, lim.target), lim.metric)
        group["limits"].append({
            "period": lim.period, "metric": lim.metric, "cap": lim.cap,
            "used": round(used, 4) if lim.metric == "spend" else int(used),
            "pct": min(999, round(100 * used / lim.cap)) if lim.cap else 0,
            "resets_at": gw.period_end(lim.period).isoformat(),
        })
    return list(groups.values())


def _usage_out(views: dict) -> dict:
    """Usage per period without the per-user breakdown (only its size)."""
    out = {}
    for period, view in views.items():
        out[period] = {
            "total": _rounded(view["total"]),
            "by_task": {k: _rounded(v) for k, v in view["by_task"].items()},
            "by_provider": {k: _rounded(v) for k, v in view["by_provider"].items()},
            "by_model": {k: _rounded(v) for k, v in view["by_model"].items()},
            "users": len(view["by_user"]),
        }
    return out


def _rounded(slot: dict) -> dict:
    return {"calls": int(slot["calls"]), "tokens": int(slot["tokens"]), "spend": round(slot["spend"], 4)}


def _catalog_out(cfg: gw.GatewayConfig, views: dict) -> list[dict]:
    out = []
    for p in cfg.providers.values():
        offered = {m["id"]: m for m in p.models}
        for (provider, model), e in cfg.catalog.items():
            if provider != p.key:
                continue
            tasks = [t for t, state in cfg.tasks.items() if any(
                s["provider"] == provider and s["model"] == model for s in state.route)]
            out.append({
                "provider": provider, "model": model, "label": e.label, "enabled": e.enabled,
                "context_window": e.context_window, "max_output_tokens": e.max_output_tokens,
                "request_token_limit": e.request_token_limit,
                "input_cost_per_m": e.input_cost_per_m, "output_cost_per_m": e.output_cost_per_m,
                "vision": e.vision,
                "offered": (model in offered) if p.last_test and p.last_test.get("ok") and offered else None,
                "used_by": tasks,
                "in_default_route": any(s["provider"] == provider and s["model"] == model
                                        for s in cfg.default_route),
                "benched": gw.bench_reason(provider, model),
                "usage": {period: _rounded((views[period]["by_model"]).get(gw.model_target(provider, model))
                                           or gw._tally()) for period in gw.PERIODS},
            })
    return out


def _alerts(cfg: gw.GatewayConfig, limits: list[dict], benched: list[dict]) -> list[dict]:
    out: list[dict] = []
    if not cfg.storage_ok:
        out.append({"level": "warn", "message": "The gateway's tables are missing (migration 0003 has not run): "
                                                "AI runs on the built-in chains and env keys, read-only."})
    elif not cfg.v2:
        out.append({"level": "info", "message": "Migration 0008 has not run yet: adding providers, the model "
                                                "catalogue and weekly or monthly limits are read-only until it does."})
    if not any(p.ready for p in cfg.providers.values()):
        out.append({"level": "error", "message": "No provider is on with a usable key, so AI features can't answer."})
    for group in limits:
        for lim in group["limits"]:
            word = {"day": "Today's", "week": "This week's", "month": "This month's"}[lim["period"]]
            if lim["pct"] >= 100:
                out.append({"level": "error", "message": f"{group['label']}: {word.lower()} {lim['metric']} limit "
                                                         f"is reached ({lim['pct']}%)."})
            elif lim["pct"] >= 80:
                out.append({"level": "warn", "message": f"{group['label']}: {lim['pct']}% of {word.lower()} "
                                                        f"{lim['metric']} limit used."})
    for b in benched:
        p = cfg.providers.get(b["provider"])
        name = (p.label if p else b["provider"]) + (f" · {b['model']}" if b["model"] else "")
        out.append({"level": "warn", "message": f"{name} is benched after {b['failures']} failures in a row; "
                                                "it is tried last until the bench runs out."})
    used = {s["provider"] for state in cfg.tasks.values() for s in state.route} | \
        {s["provider"] for s in cfg.default_route}
    for key in sorted(used):
        p = cfg.providers.get(key)
        if p is None:
            out.append({"level": "warn", "message": f"A chain names the provider {key}, which no longer exists; "
                                                    "those steps are skipped."})
        elif p.enabled and not p.api_key:
            out.append({"level": "warn", "message": f"{p.label} is in a chain but has no key; its steps are skipped."})
    return out


def _presets_out() -> list[dict]:
    return [{"key": d.key, "label": d.label, "base_url": d.default_base_url, "note": d.note,
             "timeout_s": d.default_timeout_s, "builtin": d.key in gw.PROVIDERS}
            for d in gw.PRESETS.values()]


@router.get("")
async def gateway_state(_role: str = Depends(require_superadmin)):
    cfg, usage = await _current()
    views = await gw.usage_views(cfg)
    limits = _limit_rows(cfg, views)
    benched = gw.bench_list()
    default_state = gw.TaskState(key="", route=cfg.default_route)
    return {
        "storage_ok": cfg.storage_ok,
        "v2": cfg.v2,
        "day": gw.today_ist().isoformat(),
        "periods": {p: {"start": gw.period_start(p).isoformat(), "end": gw.period_end(p).isoformat()}
                    for p in gw.PERIODS},
        "global": _global_out(cfg, usage),
        "providers": [_provider_out(p, cfg, usage) for p in cfg.providers.values()],
        "removed_builtins": list(cfg.removed),
        "presets": _presets_out(),
        "tasks": [_task_out(t, cfg, usage) for t in gw.TASKS.values()],
        "catalog": _catalog_out(cfg, views),
        "default_route": [dict(s) for s in cfg.default_route],
        "default_route_custom": cfg.default_route_custom,
        "builtin_default_route": [dict(s) for s in gw.DEFAULT_ROUTE],
        "default_route_warnings": gw.route_warnings(default_state, cfg),
        "breaker": {**cfg.breaker, "benched": benched},
        "limits": limits,
        "usage": _usage_out(views),
        "alerts": _alerts(cfg, limits, benched),
        "max_route_steps": gw.MAX_ROUTE_STEPS,
    }


# ── Providers ─────────────────────────────────────────────────────────────────

@router.patch("/providers/{key}")
@_gateway_errors
async def save_provider(key: str, body: ProviderPatch, request: Request,
                        _role: str = Depends(require_superadmin)):
    await _provider_def(key)
    values = gw.validate_provider_patch(body.changes())
    if values:
        key_removed = await gw.save_provider(key, values, _actor(request))
        metadata = {"provider": key, "changes": values}
        if key_removed:
            metadata["key_removed"] = True
        await _audit(request, "ai_gateway_provider_saved", metadata)
    return await _provider_response(key)


@router.put("/providers/{key}/key")
@_gateway_errors
async def set_provider_key(key: str, request: Request, payload: Any = Body(default=None),
                           _role: str = Depends(require_superadmin)):
    # The body is read untyped on purpose: a Pydantic validation error would
    # echo the rejected input, which here is the key.
    await _provider_def(key)
    api_key = gw.validate_api_key(payload.get("api_key") if isinstance(payload, dict) else None)
    hint = await gw.set_provider_key(key, api_key, _actor(request))
    await _audit(request, "ai_gateway_key_set", {"provider": key, "key_hint": hint})
    return await _provider_response(key)


@router.delete("/providers/{key}/key")
@_gateway_errors
async def remove_provider_key(key: str, request: Request, _role: str = Depends(require_superadmin)):
    before = await _provider_def(key)
    # Without a stored key the hint names the env key, which stays.
    removed_hint = before.key_hint if before.key_source == "stored" or before.key_unreadable else None
    await gw.clear_provider_key(key, _actor(request))
    await _audit(request, "ai_gateway_key_removed", {"provider": key, "key_hint": removed_hint})
    return await _provider_response(key)


@router.post("/providers/test-all")
async def test_all_providers(request: Request, _role: str = Depends(require_superadmin)):
    keys = list((await gw.get_config()).providers)
    results = await asyncio.gather(*(gw.test_provider(k, _actor(request)) for k in keys))
    cfg, usage = await _current(fresh=True)
    return {"results": {k: {**r, "provider": _provider_out(cfg.providers[k], cfg, usage)}
                        for k, r in zip(keys, results)}}


@router.post("/providers/{key}/test")
async def test_provider(key: str, request: Request, _role: str = Depends(require_superadmin)):
    await _provider_def(key)
    result = await gw.test_provider(key, _actor(request))
    return {**result, "provider": await _provider_response(key)}


@router.post("/providers/{key}/models/fetch")
async def fetch_provider_models(key: str, request: Request, _role: str = Depends(require_superadmin)):
    """Ask the provider for its model list (a connection test) and answer
    with it, each model marked when it is already in the catalogue."""
    await _provider_def(key)
    result = await gw.test_provider(key, _actor(request))
    cfg = await gw.get_config(force=True)
    p = cfg.providers[key]
    return {**result, "models": [{**m, "in_catalog": (key, m["id"]) in cfg.catalog} for m in p.models]}


@router.post("/providers")
@_gateway_errors
async def create_provider(request: Request, payload: Any = Body(default=None),
                          _role: str = Depends(require_superadmin)):
    # Untyped for the same reason as the key route: the body may hold a key,
    # and a validation error must never echo it.
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Expected an object describing the provider.")
    key = await gw.create_provider(payload, _actor(request))
    p = (await gw.get_config(force=True)).providers[key]
    await _audit(request, "ai_gateway_provider_added", {
        "provider": key, "preset": p.preset, "base_url": p.base_url,
        "key_hint": p.key_hint if p.key_source == "stored" else None})
    return await _provider_response(key)


@router.delete("/providers/{key}")
@_gateway_errors
async def delete_provider(key: str, request: Request, _role: str = Depends(require_superadmin)):
    p = await _provider_def(key)
    used = await gw.delete_provider(key, _actor(request))
    await _audit(request, "ai_gateway_provider_removed", {
        "provider": key, "label": p.label, "builtin": p.builtin, "used_by": used})
    return {"ok": True, "provider": key, "used_by": used}


# ── Model catalogue ───────────────────────────────────────────────────────────

@router.put("/models")
@_gateway_errors
async def save_model(body: ModelBody, request: Request, _role: str = Depends(require_superadmin)):
    changes = body.changes()
    provider, model = changes.pop("provider"), changes.pop("model")
    await _provider_def(provider)
    await gw.upsert_model(provider, model, changes, _actor(request))
    await _audit(request, "ai_gateway_model_saved", {"provider": provider, "model": model, "changes": changes})
    return {"ok": True}


@router.post("/models/import")
@_gateway_errors
async def import_models(body: ImportModelsBody, request: Request, _role: str = Depends(require_superadmin)):
    await _provider_def(body.provider)
    added = await gw.import_models(body.provider, body.models, _actor(request))
    await _audit(request, "ai_gateway_models_imported", {"provider": body.provider, "added": added})
    return {"ok": True, "added": added}


@router.delete("/models")
@_gateway_errors
async def delete_model(request: Request, provider: str = Query(..., max_length=20),
                       model: str = Query(..., max_length=120), _role: str = Depends(require_superadmin)):
    await gw.delete_model(provider, model, _actor(request))
    await _audit(request, "ai_gateway_model_removed", {"provider": provider, "model": model})
    return {"ok": True}


_STATS_SQL = """
    SELECT t.provider, t.model,
           COUNT(*) AS requests,
           COUNT(*) FILTER (WHERE t.status = 'ok') AS ok,
           COUNT(*) FILTER (WHERE t.status = 'failed') AS failed,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY t.latency_ms) FILTER (WHERE t.status = 'ok') AS p50_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms) FILTER (WHERE t.status = 'ok') AS p95_ms,
           COALESCE(SUM(t.prompt_tokens), 0) AS tokens_in,
           COALESCE(SUM(t.answer_tokens), 0) AS tokens_out,
           (ARRAY_AGG(t.extra->>'error' ORDER BY t.ts DESC) FILTER (WHERE t.status = 'failed'))[1] AS last_error,
           (ARRAY_AGG(t.http_status ORDER BY t.ts DESC) FILTER (WHERE t.status = 'failed'))[1] AS last_status,
           MAX(t.ts) AS last_at
      FROM ai_traces t
     WHERE t.ts >= $1 AND t.model IS NOT NULL AND t.status IN ('ok', 'failed')
     GROUP BY t.provider, t.model
     ORDER BY COUNT(*) DESC
     LIMIT 200
"""


@router.get("/models/stats")
async def model_stats(days: int = Query(7, ge=1, le=MAX_LOG_DAYS), _role: str = Depends(require_superadmin)):
    """Per model over the last `days` IST days: requests, success rate, median
    and p95 latency of answered calls, tokens, estimated spend and the most
    recent failure in plain words."""
    pool = get_pool()
    if pool is None:
        return _no_db()
    cfg = await gw.get_config()
    start = gw.day_start(gw.today_ist() - timedelta(days=days - 1))
    try:
        rows = await pool.fetch(_STATS_SQL, start)
    except Exception as exc:
        if not gw._schema_missing(exc):
            raise
        rows = []
    out = []
    for r in rows:
        requests = _int(r["requests"])
        entry = cfg.entry(r["provider"], r["model"]) if r["provider"] else None
        tin, tout = _int(r["tokens_in"]), _int(r["tokens_out"])
        out.append({
            "provider": r["provider"], "model": r["model"],
            "label": entry.label if entry else None,
            "requests": requests, "ok": _int(r["ok"]), "failed": _int(r["failed"]),
            "success_rate": round(_int(r["ok"]) / requests, 4) if requests else None,
            "p50_ms": round(r["p50_ms"]) if r["p50_ms"] is not None else None,
            "p95_ms": round(r["p95_ms"]) if r["p95_ms"] is not None else None,
            "tokens_in": tin, "tokens_out": tout,
            "spend": round(entry.cost(tin, tout), 4) if entry and entry.priced else None,
            "last_error": r["last_error"],
            "why": gw.explain_failure(r["last_error"], r["last_status"], "failed") if r["last_error"] else None,
            "last_at": _iso(r["last_at"]),
            "benched": gw.bench_reason(r["provider"], r["model"]) if r["provider"] else None,
        })
    return {"days": days, "models": out}


# ── Routing, breaker, limits ──────────────────────────────────────────────────

@router.put("/routing/default")
@_gateway_errors
async def save_default_route(body: DefaultRouteBody, request: Request, _role: str = Depends(require_superadmin)):
    route = None if body.route is None else [s.model_dump(exclude_none=True) for s in body.route]
    await gw.save_default_route(route, _actor(request))
    cfg = await gw.get_config(force=True)
    await _audit(request, "ai_gateway_default_route_saved", {"route": cfg.default_route if route else None})
    return {"default_route": cfg.default_route, "default_route_custom": cfg.default_route_custom,
            "default_route_warnings": gw.route_warnings(gw.TaskState(key="", route=cfg.default_route), cfg)}


@router.patch("/breaker")
@_gateway_errors
async def save_breaker(body: BreakerPatch, request: Request, _role: str = Depends(require_superadmin)):
    values = await gw.save_breaker(body.changes(), _actor(request))
    if values:
        await _audit(request, "ai_gateway_breaker_saved", {"changes": values})
    cfg = await gw.get_config(force=True)
    return {**cfg.breaker, "benched": gw.bench_list()}


@router.post("/breaker/reset")
async def reset_breaker(body: BenchResetBody, request: Request, _role: str = Depends(require_superadmin)):
    cleared = gw.reset_bench(body.target)
    await _audit(request, "ai_gateway_bench_reset", {"target": body.target or "all", "cleared": cleared})
    return {"cleared": cleared, "benched": gw.bench_list()}


@router.put("/limits")
@_gateway_errors
async def save_limits(body: LimitsBody, request: Request, _role: str = Depends(require_superadmin)):
    rows = await gw.set_limits(body.scope, body.target, [i.model_dump() for i in body.limits], _actor(request))
    await _audit(request, "ai_gateway_limits_saved", {
        "scope": body.scope, "target": body.target,
        "limits": [{"period": r.period, "metric": r.metric, "cap": r.cap} for r in rows]})
    cfg = await gw.get_config(force=True)
    return {"limits": _limit_rows(cfg, await gw.usage_views(cfg))}


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.patch("/tasks/{key}")
@_gateway_errors
async def save_task(key: str, body: TaskPatch, request: Request,
                    _role: str = Depends(require_superadmin)):
    _task_def(key)
    cfg = await gw.get_config()
    values = gw.validate_task_patch(body.changes(), set(cfg.providers) if cfg.storage_ok else None)
    if values:
        await gw.save_task(key, values, _actor(request))
        await _audit(request, "ai_gateway_task_saved", {"task": key, "changes": values})
    return await _task_response(key)


@router.get("/tasks/{key}/prompt")
async def task_prompt(key: str, _role: str = Depends(require_superadmin)):
    _task_def(key)
    return await _prompt_state(key)


@router.get("/tasks/{key}/prompt/versions/{version}")
async def task_prompt_version(key: str, version: int, _role: str = Depends(require_superadmin)):
    _task_def(key)
    found = await gw.prompt_version(key, version) if version >= 1 else None
    if found is None:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    return found


@router.put("/tasks/{key}/prompt")
@_gateway_errors
async def save_task_prompt(key: str, body: PromptBody, request: Request,
                           _role: str = Depends(require_superadmin)):
    tdef = _task_def(key)
    if not tdef.prompt_editable:
        raise HTTPException(status_code=400,
                            detail=f"The prompt for {tdef.label} is assembled per request and cannot be edited.")
    text = body.prompt if body.prompt and body.prompt.strip() else None
    version = await gw.save_prompt(key, text, _actor(request))
    await _audit(request, "ai_gateway_prompt_saved", {
        "task": key, "version": version, "reverted": text is None, "chars": len(text or ""),
    })
    return await _prompt_state(key, fresh=True)


@router.post("/tasks/{key}/test")
async def test_task(
    key: str,
    body: TaskTestBody,
    _role: str = Depends(require_superadmin),
    _quota: None = Depends(_ai_quota),
):
    """
    One real call through the task's route with its current prompt. Runs even
    when the task is switched off, but within every cap, and is logged under
    the task like any other call.
    """
    tdef = _task_def(key)
    text = (body.input or "").strip() or tdef.sample_input
    cfg = await gw.get_config()
    messages = [
        {"role": "system", "content": _test_system_prompt(key, text, cfg)},
        {"role": "user", "content": text},
    ]
    started = time.monotonic()
    result: dict | None = None
    error: str | None = None
    attempts: list[dict] = []          # filled in by the cascade, step by step
    try:
        result = await openrouter._try_chat(
            messages, max_tokens=min(tdef.max_tokens, MAX_TEST_TOKENS), temperature=0.2,
            extract=False, task=key, bypass_enabled=True, attempts=attempts,
        )
    except ValueError as exc:
        # A refusal (caps, no provider) or every model failing: both are
        # readable messages meant for the person who ran the test.
        error = str(exc)
    except Exception as exc:
        logger.warning("AI gateway test of %s failed: %s", key, type(exc).__name__)
        error = "The test call failed unexpectedly."
    return {
        "ok": result is not None,
        "content": result.get("content") if result else None,
        "model": result.get("model") if result else None,
        "provider": result.get("provider") if result else None,
        "ms": int((time.monotonic() - started) * 1000),
        "attempts": [{**{k: a.get(k) for k in ("provider", "model", "ok", "ms", "error")},
                      "skipped": bool(a.get("skipped"))} for a in attempts],
        "error": error,
    }


# ── Workspace caps ────────────────────────────────────────────────────────────

@router.patch("/global")
@_gateway_errors
async def save_global(body: GlobalPatch, request: Request, _role: str = Depends(require_superadmin)):
    values = gw.validate_global_patch(body.changes())
    if values:
        await gw.save_global(values, _actor(request))
        await _audit(request, "ai_gateway_global_saved", {"changes": values})
    cfg, usage = await _current(fresh=True)
    return _global_out(cfg, usage)


# ── Call log ──────────────────────────────────────────────────────────────────

# Columns migration 0003 added to ai_traces. Before it has run they read as
# NULL, so the log still lists the older rows.
_LOG_COLUMNS = {"task": "t.task", "provider": "t.provider", "status": "t.status",
                "http_status": "t.http_status"}
_LEGACY_LOG_COLUMNS = {"task": "NULL::varchar", "provider": "NULL::varchar",
                       "status": "NULL::varchar", "http_status": "NULL::smallint"}


def _status_sql(cols: dict) -> str:
    # Rows written before the status column existed are ok or failed by extra.
    return f"COALESCE({cols['status']}, CASE WHEN t.extra->>'ok' = 'false' THEN 'failed' ELSE 'ok' END)"


def _log_filters(cols: dict, start, end, task, provider, status, model=None,
                 min_ms=None, max_ms=None) -> tuple[str, list]:
    where = ["t.ts >= $1", "t.ts < $2"]
    params: list = [start, end]
    for expr, value in ((cols["task"], task), (cols["provider"], provider), (_status_sql(cols), status),
                        ("t.model", model)):
        if value:
            params.append(value)
            where.append(f"{expr} = ${len(params)}")
    for op, value in ((">=", min_ms), ("<=", max_ms)):
        if value is not None:
            params.append(value)
            where.append(f"t.latency_ms {op} ${len(params)}")
    return "WHERE " + " AND ".join(where), params


def _log_summary_sql(cols: dict, where: str) -> str:
    status = _status_sql(cols)
    return f"""
        SELECT {cols['task']} AS task,
               COUNT(*) AS requests,
               COUNT(*) FILTER (WHERE {status} = 'ok') AS answered,
               COUNT(*) FILTER (WHERE {status} = 'failed') AS failed,
               COUNT(*) FILTER (WHERE {status} = 'not_sent') AS not_sent,
               COALESCE(SUM(t.prompt_tokens), 0) AS tokens_in,
               COALESCE(SUM(t.answer_tokens), 0) AS tokens_out,
               COALESCE(SUM(t.latency_ms) FILTER (WHERE {status} <> 'not_sent'), 0) AS ms_sum,
               COUNT(t.latency_ms) FILTER (WHERE {status} <> 'not_sent') AS ms_count
          FROM ai_traces t
          {where}
         GROUP BY 1
    """


def _log_rows_sql(cols: dict, where: str, n_params: int) -> str:
    return f"""
        SELECT t.id, t.ts, {cols['task']} AS task, {cols['provider']} AS provider, t.model,
               {_status_sql(cols)} AS status, {cols['http_status']} AS http_status,
               t.latency_ms, t.prompt_tokens, t.answer_tokens, u.email AS user_email,
               t.endpoint, t.extra
          FROM ai_traces t
          LEFT JOIN auth_users u ON u.id = t.user_id
          {where}
         ORDER BY t.ts DESC, t.id DESC
         LIMIT ${n_params + 1} OFFSET ${n_params + 2}
    """


def _log_detail_sql(cols: dict) -> str:
    return f"""
        SELECT t.id, t.ts, {cols['task']} AS task, {cols['provider']} AS provider, t.model,
               {_status_sql(cols)} AS status, {cols['http_status']} AS http_status,
               t.latency_ms, t.prompt_tokens, t.answer_tokens, u.email AS user_email,
               t.endpoint, t.extra, t.request_id, t.session_id
          FROM ai_traces t
          LEFT JOIN auth_users u ON u.id = t.user_id
         WHERE t.id = $1
    """


async def _log_query(run):
    """Run a call-log read, falling back to the pre-0003 columns."""
    try:
        return await run(_LOG_COLUMNS)
    except Exception as exc:
        if not gw._schema_missing(exc):
            raise
        return await run(_LEGACY_LOG_COLUMNS)


def _extra(value: Any) -> dict:
    if isinstance(value, (str, bytes)):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def _int(value: Any) -> int:
    return int(value or 0)


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _summary(row: dict) -> dict:
    count = _int(row.get("ms_count"))
    return {
        "requests": _int(row.get("requests")),
        "answered": _int(row.get("answered")),
        "failed": _int(row.get("failed")),
        "not_sent": _int(row.get("not_sent")),
        "tokens_in": _int(row.get("tokens_in")),
        "tokens_out": _int(row.get("tokens_out")),
        "avg_ms": round(_int(row.get("ms_sum")) / count) if count else None,
    }


def _call_out(r) -> dict:
    extra = _extra(r["extra"])
    ts = r["ts"]
    return {
        "id": r["id"],
        "ts": ts.isoformat() if hasattr(ts, "isoformat") else ts,
        "task": r["task"],
        "task_label": gw.task_label(r["task"]) if r["task"] else None,
        "provider": r["provider"],
        "model": r["model"],
        "status": r["status"],
        "http_status": r["http_status"],
        "latency_ms": r["latency_ms"],
        "prompt_tokens": r["prompt_tokens"],
        "answer_tokens": r["answer_tokens"],
        "user_email": r["user_email"],
        "endpoint": r["endpoint"] or None,
        "error": extra.get("error") or None,
        "why": gw.explain_failure(extra.get("error"), r["http_status"], r["status"]),
        "attempt": extra.get("attempt"),
    }


@router.get("/calls")
async def list_calls(
    from_day: Optional[date] = Query(default=None, alias="from"),
    to_day: Optional[date] = Query(default=None, alias="to"),
    task: Optional[str] = Query(default=None, max_length=40),
    provider: Optional[str] = Query(default=None, max_length=20),
    status: Optional[str] = Query(default=None, pattern="^(ok|failed|not_sent)$"),
    model: Optional[str] = Query(default=None, max_length=120),
    min_ms: Optional[int] = Query(default=None, ge=0, le=10_000_000),
    max_ms: Optional[int] = Query(default=None, ge=0, le=10_000_000),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _role: str = Depends(require_superadmin),
):
    """
    The call log between two IST days, inclusive. `to` defaults to today and
    `from` to `to`. Totals and the per-task breakdown use the same filters as
    the rows.
    """
    to_day = to_day or gw.today_ist()
    from_day = from_day or to_day
    if from_day > to_day:
        raise HTTPException(status_code=422, detail="'from' must not be after 'to'.")
    if (to_day - from_day).days + 1 > MAX_LOG_DAYS:
        raise HTTPException(status_code=422, detail=f"Choose a range of at most {MAX_LOG_DAYS} days.")
    pool = get_pool()
    if pool is None:
        return _no_db()

    start, end = gw.day_start(from_day), gw.day_start(to_day + timedelta(days=1))

    async def run(cols):
        where, params = _log_filters(cols, start, end, task, provider, status, model, min_ms, max_ms)
        groups = await pool.fetch(_log_summary_sql(cols, where), *params)
        rows = await pool.fetch(_log_rows_sql(cols, where, len(params)), *params, limit, offset)
        return groups, rows

    groups, rows = await _log_query(run)
    groups = [dict(g) for g in groups]
    totals = _summary({k: sum(_int(g.get(k)) for g in groups) for k in
                       ("requests", "answered", "failed", "not_sent", "tokens_in", "tokens_out",
                        "ms_sum", "ms_count")})
    by_task = [{"task": g["task"], "label": gw.task_label(g["task"]) if g["task"] else "No task recorded",
                **_summary(g)} for g in groups]
    by_task.sort(key=lambda t: (-t["requests"], t["task"] is None, t["task"] or ""))
    return {
        "total": totals["requests"],
        "limit": limit,
        "offset": offset,
        "totals": totals,
        "by_task": by_task,
        "rows": [_call_out(r) for r in rows],
    }


@router.get("/calls/{call_id}")
async def call_detail(call_id: int, _role: str = Depends(require_superadmin)):
    pool = get_pool()
    if pool is None:
        return _no_db()
    row = await _log_query(lambda cols: pool.fetchrow(_log_detail_sql(cols), call_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Call not found")
    return {**_call_out(row), "request_id": row["request_id"], "session_id": row["session_id"],
            "extra": _extra(row["extra"])}
