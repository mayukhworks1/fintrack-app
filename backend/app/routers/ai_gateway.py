"""
Admin → AI gateway: providers, tasks, prompts, caps and the call log.

Superadmin only: every route depends on require_superadmin, which also refuses
the legacy admin password. Keys go in as JSON bodies and never come back out —
responses and audit rows carry only the last four characters (key_hint).

Endpoints (prefix /api/admin/ai-gateway)
─────────
GET    ""                                  — providers, tasks and today's usage
PATCH  /providers/{key}                    — on/off, base URL, timeout, caps
PUT    /providers/{key}/key                — store a key (encrypted)
DELETE /providers/{key}/key                — remove the stored key
POST   /providers/{key}/test               — list the provider's models with its key
POST   /providers/test-all
PATCH  /tasks/{key}                        — on/off, route, daily cap
GET    /tasks/{key}/prompt                 — built-in, current and version history
GET    /tasks/{key}/prompt/versions/{v}
PUT    /tasks/{key}/prompt                 — save a new version (null = built-in)
POST   /tasks/{key}/test                   — one real call through the task's route
PATCH  /global                             — workspace daily caps
GET    /calls                              — the call log, by IST day
GET    /calls/{id}

Every write is audited in auth_events. A database the gateway migration has
not reached still serves every read on the built-in defaults; writes answer
503 until it has.
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


class RouteStepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: StrictStr
    model: StrictStr


class TaskPatch(_Patch):
    enabled: Optional[StrictBool] = None
    route: Optional[list[RouteStepBody]] = None
    daily_cap: Optional[StrictInt] = Field(default=None, ge=1)


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
        except gw.StorageNotReady:
            return JSONResponse(status_code=503, content={"detail": gw.STORAGE_NOT_READY})
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    return wrapper


def _provider_def(key: str) -> gw.ProviderDef:
    if key not in gw.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown AI provider")
    return gw.PROVIDERS[key]


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
    spent = _usage_slot(usage["by_provider"], p.key)
    return {
        "key": p.key,
        "label": p.label,
        "base_url": p.base_url,
        "default_base_url": gw.PROVIDERS[p.key].default_base_url,
        "enabled": p.enabled,
        "key_source": p.key_source,
        "key_hint": p.key_hint,
        "key_set_by": p.key_set_by,
        "key_set_at": p.key_set_at,
        "key_unreadable": p.key_unreadable,
        "env_var": p.env_var,
        "timeout_s": p.timeout_s,
        "default_timeout_s": gw.PROVIDERS[p.key].default_timeout_s,
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
        "default_route": [dict(s) for s in tdef.default_route],
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
    from ..services import page_ai, studio_ask
    return {
        "chat": openrouter.SYSTEM_PROMPT,
        "judge": openrouter._JUDGE_SYSTEM,
        "project_autofill": openrouter._AUTOFILL_SYSTEM,
        "project_analysis": openrouter.SYSTEM_PROMPT,
        "status_briefing": openrouter._STATUS_BRIEFING_SYSTEM,
        "status_update": openrouter._AI_UPDATE_SYSTEM,
        "invoice_parse": openrouter._INVOICE_EXTRACT_SYSTEM,
        "page_interview": page_ai._INTERVIEW_SYSTEM,
        "studio_ask": studio_ask._SYSTEM,
    }[task]


def _page_build_parts() -> list[tuple[str, str]]:
    from ..services import page_ai, page_edit
    return [
        ("New web page (a design direction — palette and typefaces — is appended per request)",
         page_ai._HTML_RULES),
        ("New document", page_ai._MARKDOWN_RULES),
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

@router.get("")
async def gateway_state(_role: str = Depends(require_superadmin)):
    cfg, usage = await _current()
    return {
        "storage_ok": cfg.storage_ok,
        "day": gw.today_ist().isoformat(),
        "global": _global_out(cfg, usage),
        "providers": [_provider_out(cfg.providers[k], cfg, usage) for k in gw.PROVIDERS],
        "tasks": [_task_out(t, cfg, usage) for t in gw.TASKS.values()],
    }


# ── Providers ─────────────────────────────────────────────────────────────────

@router.patch("/providers/{key}")
@_gateway_errors
async def save_provider(key: str, body: ProviderPatch, request: Request,
                        _role: str = Depends(require_superadmin)):
    _provider_def(key)
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
    _provider_def(key)
    api_key = gw.validate_api_key(payload.get("api_key") if isinstance(payload, dict) else None)
    hint = await gw.set_provider_key(key, api_key, _actor(request))
    await _audit(request, "ai_gateway_key_set", {"provider": key, "key_hint": hint})
    return await _provider_response(key)


@router.delete("/providers/{key}/key")
@_gateway_errors
async def remove_provider_key(key: str, request: Request, _role: str = Depends(require_superadmin)):
    _provider_def(key)
    before = (await gw.get_config()).providers[key]
    # Without a stored key the hint names the env key, which stays.
    removed_hint = before.key_hint if before.key_source == "stored" or before.key_unreadable else None
    await gw.clear_provider_key(key, _actor(request))
    await _audit(request, "ai_gateway_key_removed", {"provider": key, "key_hint": removed_hint})
    return await _provider_response(key)


@router.post("/providers/test-all")
async def test_all_providers(request: Request, _role: str = Depends(require_superadmin)):
    keys = list(gw.PROVIDERS)
    results = await asyncio.gather(*(gw.test_provider(k, _actor(request)) for k in keys))
    cfg, usage = await _current(fresh=True)
    return {"results": {k: {**r, "provider": _provider_out(cfg.providers[k], cfg, usage)}
                        for k, r in zip(keys, results)}}


@router.post("/providers/{key}/test")
async def test_provider(key: str, request: Request, _role: str = Depends(require_superadmin)):
    _provider_def(key)
    result = await gw.test_provider(key, _actor(request))
    return {**result, "provider": await _provider_response(key)}


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.patch("/tasks/{key}")
@_gateway_errors
async def save_task(key: str, body: TaskPatch, request: Request,
                    _role: str = Depends(require_superadmin)):
    _task_def(key)
    values = gw.validate_task_patch(body.changes())
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


def _log_filters(cols: dict, start, end, task, provider, status) -> tuple[str, list]:
    where = ["t.ts >= $1", "t.ts < $2"]
    params: list = [start, end]
    for expr, value in ((cols["task"], task), (cols["provider"], provider), (_status_sql(cols), status)):
        if value:
            params.append(value)
            where.append(f"{expr} = ${len(params)}")
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
        "attempt": extra.get("attempt"),
    }


@router.get("/calls")
async def list_calls(
    from_day: Optional[date] = Query(default=None, alias="from"),
    to_day: Optional[date] = Query(default=None, alias="to"),
    task: Optional[str] = Query(default=None, max_length=40),
    provider: Optional[str] = Query(default=None, max_length=20),
    status: Optional[str] = Query(default=None, pattern="^(ok|failed|not_sent)$"),
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
        where, params = _log_filters(cols, start, end, task, provider, status)
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
