"""
AI gateway — which provider and model serve each AI task, what a task may
spend today, and which prompt it runs with.

Why this exists
───────────────
Model ids used to be hardcoded in services/openrouter.py and in env vars. Free
model ids come and go every few weeks, and when the hardcoded ones disappeared
every AI feature failed at once, with nothing an administrator could change
short of a redeploy. Everything a superadmin may need to change now lives in
the database and is edited from Admin → AI gateway:

  * providers (Groq and OpenRouter, both OpenAI-compatible): on/off, base URL,
    timeout, daily caps and an API key, stored encrypted;
  * tasks (a fixed registry below — one per AI feature): on/off, an ordered
    route of provider/model steps, a daily cap and a versioned prompt override;
  * workspace-wide daily caps.

The database only stores overrides. A missing row means the built-in default,
so an empty table behaves like a fresh install, and a database the migration
has not reached yet (migrations run in a thread and may fail) still serves
every feature on the defaults plus the env keys. Reads never raise; writes
raise StorageNotReady, which the router turns into a 503.

The day behind every "today" figure and cap starts at midnight IST.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, NoReturn
from urllib.parse import urlsplit

import httpx
from cryptography.fernet import Fernet, MultiFernet

from ..config import settings
from ..db.postgres import get_pool
from ..utils.http import get_http
from . import ai_usage

logger = logging.getLogger("fintrack.ai_gateway")


# ── Providers ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ProviderDef:
    key: str
    label: str
    default_base_url: str
    env_attr: str            # settings attribute holding the fallback key
    env_var: str
    default_timeout_s: int


PROVIDERS: dict[str, ProviderDef] = {
    "groq": ProviderDef("groq", "Groq", "https://api.groq.com/openai/v1",
                        "groq_api_key", "GROQ_API_KEY", 30),
    "openrouter": ProviderDef("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
                              "openrouter_api_key", "OPENROUTER_API_KEY", 45),
}

TIMEOUT_MIN_S, TIMEOUT_MAX_S = 5, 120
CONNECT_TIMEOUT_S = 10.0
TEST_TIMEOUT_S = 15.0
MAX_ROUTE_STEPS = 6
MAX_PROMPT_CHARS = 20_000
MAX_STORED_MODELS = 600
MODEL_ID_RE = re.compile(r"^[A-Za-z0-9._:/@+-]{1,120}$")

# Upper bounds that keep a cap inside its column (INTEGER / BIGINT).
_MAX_CALL_CAP = 1_000_000_000
_MAX_TOKEN_CAP = 10 ** 15

STORAGE_NOT_READY = "AI gateway storage is not ready (database migration 0003 has not run)."


# ── Tasks ─────────────────────────────────────────────────────────────

DEFAULT_ROUTE: tuple[dict, ...] = (
    {"provider": "groq", "model": "openai/gpt-oss-120b"},
    {"provider": "groq", "model": "openai/gpt-oss-20b"},
    {"provider": "openrouter", "model": "openrouter/free"},
)

# Invoices are often photos, so a vision model leads.
INVOICE_ROUTE: tuple[dict, ...] = (
    {"provider": "openrouter", "model": "google/gemma-4-31b-it:free"},
    {"provider": "groq", "model": "openai/gpt-oss-120b"},
    {"provider": "openrouter", "model": "openrouter/free"},
)


@dataclass(frozen=True)
class TaskDef:
    key: str
    label: str
    module: str              # the group the admin UI lists it under
    description: str
    output: str              # "stream" | "text" | "json"
    personal_data: bool
    prompt_editable: bool
    default_route: tuple[dict, ...]
    max_tokens: int          # informational: what the call site asks for
    sample_input: str
    call_sites: tuple[str, ...]
    prompt_note: str = ""


TASKS: dict[str, TaskDef] = {t.key: t for t in (
    TaskDef(
        key="chat", label="AI assistant chat", module="AI assistant",
        description="Answers questions in the AI assistant from the portfolio data, "
                    "streaming the reply as it is written.",
        output="stream", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=1024,
        sample_input="Project Alpha billed ₹12,00,000 against a cost of ₹9,50,000. Project Beta "
                     "billed ₹4,00,000 against a cost of ₹4,60,000. Which project needs attention, and why?",
        call_sites=("openrouter.stream_chat_with_ai (POST /api/ai/chat/stream)",),
        prompt_note="Keep the ===ANSWER=== and ===END=== markers: only the text between them "
                    "reaches the user.",
    ),
    TaskDef(
        key="judge", label="Answer check", module="AI assistant",
        description="Checks an assistant or Studio answer against the data it was given and "
                    "flags claims the data does not support.",
        output="json", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=350,
        sample_input='{"question": "What is Project Alpha\'s margin?", '
                     '"draft_answer": "Project Alpha\'s margin is 20.8% (₹2,50,000 on ₹12,00,000 billed).", '
                     '"context": "Project Alpha: billed ₹12,00,000; cost ₹9,50,000."}',
        call_sites=("openrouter.judge_answer (chat board and summary answers)",
                    "studio_ask.ask (Studio answer check)"),
    ),
    TaskDef(
        key="project_autofill", label="Project autofill", module="Projects",
        description="Fills in the new-project form from a short description written in plain words.",
        output="json", personal_data=False, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=512,
        sample_input="Website redesign for Acme Retail starting 1 April 2026, running six months with "
                     "three developers at a combined ₹4,50,000 a month. Billed ₹30,00,000 in total; "
                     "currently active.",
        call_sites=("openrouter.autofill_project (POST /api/ai/autofill)",),
    ),
    TaskDef(
        key="project_analysis", label="Project analysis", module="Projects",
        description="Writes a health summary, risks and recommendations for one project.",
        output="text", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=1024,
        sample_input="Client: Acme Retail\nProject: Website redesign\nStart: 2026-04-01\n"
                     "Duration: 6 months\nResources: 3\nMonthly salary cost: ₹4,50,000\n"
                     "Amount billed: ₹30,00,000\nStatus: Active",
        call_sites=("openrouter.analyze_project (POST /api/ai/analyze)",),
        prompt_note="Starts as the AI assistant chat prompt; an override here changes project "
                    "analysis only.",
    ),
    TaskDef(
        key="status_briefing", label="Status briefing report", module="Reports",
        description="Writes the status briefing report from the latest project status updates.",
        output="text", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=2000,
        sample_input="Acme Retail · Website redesign: design signed off; development 40% done; launch "
                     "at risk by two weeks because content is late.\nNorthwind · Data migration: "
                     "completed on schedule; client sign-off pending.",
        call_sites=("openrouter.generate_status_briefing (GET /api/ai/status-briefing)",),
    ),
    TaskDef(
        key="status_update", label="Status board update", module="Status board",
        description="Drafts a status board update for the selected projects.",
        output="text", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=1500,
        sample_input="Acme Retail · Website redesign. Latest note: content still awaited from the "
                     "client; developers moved to the checkout flow in the meantime.",
        call_sites=("openrouter.ai_status_update (POST /api/status/ai-update)",),
    ),
    TaskDef(
        key="invoice_parse", label="Read an invoice into fields", module="Invoices",
        description="Reads an uploaded invoice, PDF or photo, and fills in the invoice fields.",
        output="json", personal_data=True, prompt_editable=True,
        default_route=INVOICE_ROUTE, max_tokens=700,
        sample_input="TAX INVOICE\nInvoice No: WM/26-27/049\nInvoice date: 12-10-2026\n"
                     "Bill to: Acme Retail Pvt Ltd\nDescription: Website redesign, milestone 2\n"
                     "Amount: ₹2,50,000.00\nIGST 18%: ₹45,000.00\nTotal: ₹2,95,000.00\n"
                     "Due date: 11-11-2026",
        call_sites=("openrouter.parse_invoice_document (POST /api/invoices/parse)",
                    "openrouter.parse_invoice_document (POST /api/web-invoices/parse)"),
    ),
    TaskDef(
        key="page_build", label="Build and revise pages", module="Pages",
        description="Builds new pages and revises existing ones, including section edits and "
                    "script fixes.",
        output="stream", personal_data=False, prompt_editable=False,
        default_route=DEFAULT_ROUTE, max_tokens=8000,
        sample_input="A one-page summary of Q2 delivery for the leadership team: three headline "
                     "numbers, a short timeline and the risks for Q3.",
        call_sites=("page_ai.generate_page (POST /api/pages/ai-generate)",
                    "page_ai.stream_generate_page (POST /api/pages/ai/stream)",
                    "page_ai.edit_page_section (POST /api/pages/ai/section-edit)",
                    "page_ai.fix_page_script_error (POST /api/pages/ai/fix-error)"),
        prompt_note="Assembled for each request from the page design rules, the design scaffold "
                    "and, when revising, the live page, so it cannot be edited here.",
    ),
    TaskDef(
        key="page_interview", label="Page clarifying questions", module="Pages",
        description="Decides whether a page request needs clarifying questions first, and "
                    "writes them.",
        output="json", personal_data=False, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=800,
        sample_input="Make a page for our clients.",
        call_sites=("page_ai.analyze_prompt_needs (POST /api/pages/ai/interview)",),
    ),
    TaskDef(
        key="studio_ask", label="Studio: answer from documents", module="Studio",
        description="Answers questions in Studio from the uploaded documents, with numbered "
                    "citations.",
        output="text", personal_data=True, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=1200,
        sample_input="SOURCES:\n[1] Master services agreement, clause 7.2: Either party may "
                     "terminate with 60 days' written notice.\n[2] Statement of work, section 4: "
                     "Invoices are payable within 30 days of receipt.\n\nQUESTION: What are the "
                     "payment terms and the notice period?",
        call_sites=("studio_ask.ask (POST /api/studio/ask)",),
    ),
    TaskDef(
        key="studio_analyze", label="Studio: data analyst", module="Studio",
        description="Turns a data question in Studio into a query on the live data and explains "
                    "the result.",
        output="json", personal_data=True, prompt_editable=False,
        default_route=DEFAULT_ROUTE, max_tokens=500,
        sample_input="Which five clients billed the most in 2026, and how much did each bill?",
        call_sites=("studio_analyst.analyze (POST /api/studio/analyze)",),
        prompt_note="Built for each question from the live data schema the analyst may query, "
                    "so it cannot be edited here.",
    ),
)}


# ── State ─────────────────────────────────────────────────────────────

@dataclass
class ProviderState:
    key: str
    label: str
    base_url: str
    enabled: bool = True
    api_key: str | None = field(default=None, repr=False)
    key_source: str = "none"          # "stored" | "env" | "none"
    key_hint: str | None = None
    key_set_by: str | None = None
    key_set_at: str | None = None     # ISO 8601
    key_unreadable: bool = False
    timeout_s: int = 30
    daily_request_cap: int | None = None
    daily_token_cap: int | None = None
    models: list[dict] = field(default_factory=list)
    last_test: dict | None = None
    env_var: str = ""

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.api_key)


@dataclass
class TaskState:
    key: str
    enabled: bool = True
    route: list[dict] = field(default_factory=list)
    daily_cap: int | None = None
    prompt_version: int = 0
    prompt_override: str | None = None
    route_custom: bool = False        # a saved route; False = the built-in default


@dataclass
class GatewayConfig:
    storage_ok: bool
    providers: dict[str, ProviderState]
    tasks: dict[str, TaskState]
    global_caps: dict


@dataclass(frozen=True)
class RouteStep:
    provider: ProviderState
    model: str
    attempt: int             # 1-based position in the order the steps are tried


class GatewayRefused(ValueError):
    """A call refused before any provider was contacted. A ValueError, so every
    router already turns it into a readable 400 or SSE error."""


class StorageNotReady(RuntimeError):
    def __init__(self, message: str = STORAGE_NOT_READY):
        super().__init__(message)


class ProviderTestError(RuntimeError):
    """A model-list request failed. The message is safe to show: it never
    carries the key."""


# ── IST day ───────────────────────────────────────────────────────────

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> date:
    return _now().astimezone(IST).date()


def day_start(day: date) -> datetime:
    """Midnight IST at the start of `day`."""
    return datetime(day.year, day.month, day.day, tzinfo=IST)


# ── Key encryption ────────────────────────────────────────────────────

def _fernet_for(secret: str | None) -> Fernet:
    digest = hashlib.sha256(b"fintrack-ai-gateway:v1:" + (secret or "").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _fernet() -> MultiFernet:
    """Encrypts under AI_GATEWAY_SECRET when it is set, else APP_SECRET, and
    decrypts under either: keys saved before AI_GATEWAY_SECRET was introduced
    stay readable for as long as APP_SECRET is unchanged."""
    secrets = [settings.app_secret]
    dedicated = getattr(settings, "ai_gateway_secret", None)
    if (dedicated or "").strip():
        secrets.insert(0, dedicated)
    return MultiFernet([_fernet_for(s) for s in dict.fromkeys(secrets)])


def encrypt_key(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_key(token: str) -> str | None:
    """The stored key, or None when it cannot be read — the secret it was
    encrypted under has changed, or the value is not a token at all."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        return None


# A key goes into an HTTP header: printable ASCII only. Anything else (a
# control character, a stray non-ASCII letter) makes the HTTP library refuse
# the header, and its error message quotes the header, key included.
_HEADER_SAFE_RE = re.compile(r"[\x21-\x7e]+")
_KEY_RE = re.compile(r"[\x21-\x7e]{8,400}")


def usable_key(value: Any) -> str | None:
    """`value` when it can be sent in a header, else None."""
    return value if isinstance(value, str) and _HEADER_SAFE_RE.fullmatch(value) else None


_BEARER_RE = re.compile(r"(?i)bearer\s+\S+")


def redact(text: str, p: ProviderState | None = None) -> str:
    """`text` with the provider's key, and any bearer token, masked — for
    error text that may quote a request."""
    if p is not None and p.api_key:
        text = text.replace(p.api_key, "****")
    return _BEARER_RE.sub("Bearer ****", text)


# ── Small helpers ─────────────────────────────────────────────────────

def _json(value: Any) -> Any:
    """JSONB arrives as text: the pool registers no codec for it."""
    if isinstance(value, (str, bytes)):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _cap(value: Any) -> int | None:
    """A stored cap: a positive int, else no cap."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 1 else None


def _schema_missing(exc: Exception) -> bool:
    return (getattr(exc, "sqlstate", None) in ("42P01", "42703")
            or type(exc).__name__ in ("UndefinedTableError", "UndefinedColumnError"))


def task_label(task: str) -> str:
    tdef = TASKS.get(task)
    return tdef.label if tdef else task


def _provider_def(key: str) -> ProviderDef:
    if key not in PROVIDERS:
        raise KeyError(key)
    return PROVIDERS[key]


def _task_def(key: str) -> TaskDef:
    if key not in TASKS:
        raise KeyError(key)
    return TASKS[key]


_inflight: dict[str, asyncio.Future] = {}


async def _single_flight(name: str, loader: Callable[[], Awaitable[Any]], *, join: bool = True) -> Any:
    """Run `loader` once for every caller that arrives while it is running, so
    a burst of requests on a cold cache sends one query, not one each."""
    loop = asyncio.get_running_loop()
    pending = _inflight.get(name)
    if join and pending is not None and pending.get_loop() is loop:
        shared = await asyncio.shield(pending)
        if shared is not None:
            return shared
    fut: asyncio.Future = loop.create_future()
    _inflight[name] = fut
    try:
        result = await loader()
    except BaseException:
        fut.set_result(None)      # waiters load for themselves
        raise
    else:
        fut.set_result(result)
        return result
    finally:
        if _inflight.get(name) is fut:
            del _inflight[name]


# ── Config loading ────────────────────────────────────────────────────

_CONFIG_TTL_S = 30.0
# A failed read is usually the migration not having run, or a database blip;
# neither should pin what it fell back to for long.
_FALLBACK_TTL_S = 5.0

_config: GatewayConfig | None = None
_config_expires = 0.0
_generation = 0
_read_failing = False

_SQL_PROVIDERS = """
    SELECT key, enabled, base_url, api_key_enc, key_hint, key_set_by, key_set_at,
           timeout_s, daily_request_cap, daily_token_cap, models,
           last_test_at, last_test_ok, last_test_ms, last_test_error
      FROM ai_gateway_providers
"""
_SQL_TASKS = "SELECT key, enabled, route, daily_cap, prompt_version FROM ai_gateway_tasks"
_SQL_SETTINGS = "SELECT key, value FROM ai_gateway_settings"
_SQL_ACTIVE_PROMPTS = """
    SELECT p.task, p.prompt
      FROM ai_gateway_prompts p
      JOIN ai_gateway_tasks t ON t.key = p.task AND t.prompt_version = p.version
"""


async def get_config(force: bool = False) -> GatewayConfig:
    """The current gateway settings. Cached for 30 s; never raises."""
    if not force and _config is not None and time.monotonic() < _config_expires:
        return _config
    return await _single_flight("config", _reload_config, join=not force)


def invalidate() -> None:
    """Drop the cached settings. Called after every write."""
    global _config_expires, _generation
    _generation += 1
    _config_expires = 0.0


async def _reload_config() -> GatewayConfig:
    global _config, _config_expires
    generation = _generation
    cfg, fresh = await _load_config()
    # A write that landed while this read ran may not be in it: keep it out of
    # the cache so the next caller reads again.
    if generation == _generation:
        _config = cfg
        _config_expires = time.monotonic() + (_CONFIG_TTL_S if fresh else _FALLBACK_TTL_S)
    elif _config is None:
        _config = cfg
    return cfg


async def _load_config() -> tuple[GatewayConfig, bool]:
    """
    The settings, and whether they were just read from the database.

    Only a database the migration has not reached (or none at all) serves the
    built-in defaults. Any other failed read — a dropped connection, a pool or
    statement timeout — keeps the last settings read successfully: falling
    back to the defaults there would switch back on the tasks a superadmin
    turned off, lift every cap and lose the keys stored only in the database.
    """
    global _read_failing
    pool = get_pool()
    if pool is None:
        return _build_config(False), False
    try:
        cfg = _build_config(
            True,
            await pool.fetch(_SQL_PROVIDERS),
            await pool.fetch(_SQL_TASKS),
            await pool.fetch(_SQL_SETTINGS),
            await pool.fetch(_SQL_ACTIVE_PROMPTS),
        )
    except Exception as exc:
        last_good = _config if _config is not None and _config.storage_ok else None
        keep = last_good is not None and not _schema_missing(exc)
        if not _read_failing:
            logger.warning("AI gateway settings unreadable, %s: %s: %s",
                           "keeping the last ones read" if keep else "serving built-in defaults",
                           type(exc).__name__, str(exc)[:200])
        _read_failing = True
        return (last_good if keep else _build_config(False)), False
    _read_failing = False
    return cfg, True


def _build_config(storage_ok: bool, provider_rows=(), task_rows=(), setting_rows=(),
                  prompt_rows=()) -> GatewayConfig:
    by_provider = {r["key"]: dict(r) for r in provider_rows}
    by_task = {r["key"]: dict(r) for r in task_rows}
    overrides = {r["task"]: r["prompt"] for r in prompt_rows}
    values = {r["key"]: _json(r["value"]) for r in setting_rows}
    return GatewayConfig(
        storage_ok=storage_ok,
        providers={k: _provider_state(d, by_provider.get(k)) for k, d in PROVIDERS.items()},
        tasks={k: _task_state(d, by_task.get(k), overrides.get(k)) for k, d in TASKS.items()},
        global_caps={"daily_call_cap": _cap(values.get("daily_call_cap")),
                     "daily_token_cap": _cap(values.get("daily_token_cap"))},
    )


def _host(url: str) -> str:
    try:
        return urlsplit(url).hostname or ""
    except ValueError:
        return ""


def _stored_base_url(pdef: ProviderDef, value: Any) -> str:
    try:
        return validate_base_url(value) or pdef.default_base_url
    except ValueError:
        return pdef.default_base_url


def _provider_state(pdef: ProviderDef, row: dict | None) -> ProviderState:
    row = row or {}
    base_url = _stored_base_url(pdef, row.get("base_url"))
    enc = row.get("api_key_enc")
    stored = usable_key(decrypt_key(enc)) if enc else None
    # The server's env key belongs to the provider's own API. A base URL on
    # another host gets only a key saved for it (saving a new host drops the
    # stored key), so editing the URL can never send the env key elsewhere.
    env = None
    if _host(base_url) == _host(pdef.default_base_url):
        env = usable_key((getattr(settings, pdef.env_attr, None) or "").strip())
    models = [m for m in (_json(row.get("models")) or [])
              if isinstance(m, dict) and isinstance(m.get("id"), str)]
    last_test = None
    if row.get("last_test_at") is not None:
        ok = bool(row.get("last_test_ok"))
        last_test = {"at": _iso(row["last_test_at"]), "ok": ok, "ms": row.get("last_test_ms"),
                     "error": row.get("last_test_error"), "model_count": len(models) if ok else 0}
    try:
        timeout = int(row.get("timeout_s") or pdef.default_timeout_s)
    except (TypeError, ValueError):
        timeout = pdef.default_timeout_s
    return ProviderState(
        key=pdef.key,
        label=pdef.label,
        base_url=base_url,
        enabled=row.get("enabled") is not False,
        api_key=stored or env,
        key_source="stored" if stored else ("env" if env else "none"),
        # The hint, setter and date describe the stored key whenever there is
        # one, readable or not; without one, the hint names the env key.
        key_hint=row.get("key_hint") if enc else (env[-4:] if env else None),
        key_set_by=row.get("key_set_by") if enc else None,
        key_set_at=_iso(row.get("key_set_at")) if enc else None,
        key_unreadable=bool(enc) and stored is None,
        timeout_s=min(max(timeout, TIMEOUT_MIN_S), TIMEOUT_MAX_S),
        daily_request_cap=_cap(row.get("daily_request_cap")),
        daily_token_cap=_cap(row.get("daily_token_cap")),
        models=models,
        last_test=last_test,
        env_var=pdef.env_var,
    )


def _stored_route(value: Any) -> list[dict]:
    """A route read back from the database. Lenient: an unknown provider is
    kept so route_warnings can point at it; an unusable step is dropped."""
    steps = _json(value)
    if not isinstance(steps, list):
        return []
    out = []
    for step in steps[:MAX_ROUTE_STEPS]:
        if not isinstance(step, dict):
            continue
        provider, model = step.get("provider"), step.get("model")
        if isinstance(provider, str) and isinstance(model, str) and model.strip():
            out.append({"provider": provider, "model": model.strip()})
    return out


def _task_state(tdef: TaskDef, row: dict | None, override: str | None) -> TaskState:
    row = row or {}
    try:
        version = int(row.get("prompt_version") or 0)
    except (TypeError, ValueError):
        version = 0
    active = (tdef.prompt_editable and version > 0
              and isinstance(override, str) and bool(override.strip()))
    route = _stored_route(row.get("route"))
    return TaskState(
        key=tdef.key,
        enabled=row.get("enabled") is not False,
        route=route or [dict(s) for s in tdef.default_route],
        daily_cap=_cap(row.get("daily_cap")),
        prompt_version=version,
        prompt_override=override if active else None,
        route_custom=bool(route),
    )


# ── Usage today ───────────────────────────────────────────────────────

_USAGE_TTL_S = 5.0

# A row counts the provider requests its attempt sent: retries of a 5xx or of
# a connection that never opened live in extra.requests.
_SQL_USAGE = """
    SELECT task, provider, SUM(COALESCE((extra->>'requests')::int, 1)) AS calls,
           COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(answer_tokens, 0)), 0) AS tokens
      FROM ai_traces
     WHERE ts >= $1
       AND (status IS NULL OR status <> 'not_sent')
     GROUP BY task, provider
"""


@dataclass
class _Usage:
    calls: int = 0
    tokens: int = 0
    by_task: dict = field(default_factory=dict)
    by_provider: dict = field(default_factory=dict)

    def add(self, task: str | None, provider: str | None, calls: int, tokens: int) -> None:
        self.calls += calls
        self.tokens += tokens
        for bucket, key in ((self.by_task, task), (self.by_provider, provider)):
            if key:
                slot = bucket.setdefault(key, {"calls": 0, "tokens": 0})
                slot["calls"] += calls
                slot["tokens"] += tokens

    def plus(self, other: "_Usage") -> "_Usage":
        out = _Usage()
        for part in (self, other):
            out.calls += part.calls
            out.tokens += part.tokens
            for mine, theirs in ((out.by_task, part.by_task), (out.by_provider, part.by_provider)):
                for key, slot in theirs.items():
                    acc = mine.setdefault(key, {"calls": 0, "tokens": 0})
                    acc["calls"] += slot["calls"]
                    acc["tokens"] += slot["tokens"]
        return out

    def as_dict(self) -> dict:
        return {"calls": self.calls, "tokens": self.tokens,
                "by_task": self.by_task, "by_provider": self.by_provider}


@dataclass
class _Noted:
    """One attempt counted in-process, until a read of ai_traces includes it."""
    task: str | None
    provider: str | None
    calls: int
    tokens: int
    written_at: float | None = None   # time.monotonic() once its log row was written

    def written(self) -> None:
        self.written_at = time.monotonic()


_usage_day: date | None = None
_usage_base = _Usage()          # today's figures as last read from ai_traces
_usage_local: list[_Noted] = []  # attempts the last read may not include
_usage_expires = 0.0


def _roll_usage_day(day: date) -> None:
    global _usage_day, _usage_base, _usage_local, _usage_expires
    if day != _usage_day:
        _usage_day, _usage_base, _usage_local, _usage_expires = day, _Usage(), [], 0.0


def note_usage(task: str | None, provider: str | None, tokens: int, ok: bool, *,
               calls: int = 1) -> Callable[[], None]:
    """
    Count an attempt locally until a read of ai_traces includes it.

    The log row is written fire-and-forget and the read is cached for 5 s, so
    without this a burst of calls could sail past a cap before the first of
    them showed up in the count. Failed attempts count as calls as well: the
    provider still served them. `calls` is the number of provider requests
    the attempt sent (retries included).

    Returns the callback to run once the attempt's log row is written: until
    then no read can be sure to include it, so it stays counted here.
    """
    _roll_usage_day(today_ist())
    try:
        spent = max(0, int(tokens or 0))
    except (TypeError, ValueError):
        spent = 0
    noted = _Noted(task, provider, max(0, int(calls)), spent)
    _usage_local.append(noted)
    return noted.written


def _local_usage() -> _Usage:
    out = _Usage()
    for n in _usage_local:
        out.add(n.task, n.provider, n.calls, n.tokens)
    return out


async def usage_today() -> dict:
    """Provider calls (ok + failed) and tokens since midnight IST:
    {"calls", "tokens", "by_task": {task: {"calls", "tokens"}}, "by_provider": {...}}."""
    day = today_ist()
    _roll_usage_day(day)
    if time.monotonic() >= _usage_expires:
        await _single_flight("usage", lambda: _refresh_usage(day))
    if _usage_day != day:
        return _Usage().as_dict()
    return _usage_base.plus(_local_usage()).as_dict()


async def _refresh_usage(day: date) -> bool:
    global _usage_base, _usage_local, _usage_expires
    rows = None
    pool = get_pool()
    started = time.monotonic()
    if pool is not None:
        try:
            rows = await pool.fetch(_SQL_USAGE, day_start(day))
        except Exception as exc:
            logger.debug("AI gateway usage read failed: %s", exc)
    if _usage_day != day:
        return True
    if rows is not None:
        base = _Usage()
        for r in rows:
            base.add(r["task"], r["provider"], int(r["calls"] or 0), int(r["tokens"] or 0))
        _usage_base = base
        # A row written before the read began is in it. One written since, or
        # not yet (its INSERT is still queued, or failed), stays counted here.
        _usage_local = [n for n in _usage_local if n.written_at is None or n.written_at >= started]
    _usage_expires = time.monotonic() + _USAGE_TTL_S
    return True


# ── Admission and routing ─────────────────────────────────────────────

_WORKSPACE_LIMIT = "Today's AI limit for the workspace has been reached. It resets at midnight IST."


def no_provider_message(task: str) -> str:
    return (f"No AI provider is available for {task_label(task)}. "
            "An administrator can check Admin → AI gateway.")


def refuse(task: str, reason: str) -> NoReturn:
    """Log a not_sent call and raise GatewayRefused with the reason."""
    ai_usage.record_not_sent(task, reason)
    raise GatewayRefused(reason)


def _route_of(cfg: GatewayConfig, task: str) -> list[dict]:
    state = cfg.tasks.get(task)
    return state.route if state else [dict(s) for s in DEFAULT_ROUTE]


async def _has_capacity(p: ProviderState) -> bool:
    if p.daily_request_cap is None and p.daily_token_cap is None:
        return True
    spent = (await usage_today())["by_provider"].get(p.key, {})
    if p.daily_request_cap is not None and spent.get("calls", 0) >= p.daily_request_cap:
        return False
    if p.daily_token_cap is not None and spent.get("tokens", 0) >= p.daily_token_cap:
        return False
    return True


async def provider_has_capacity(provider_key: str) -> bool:
    """False once the provider's daily request or token cap is reached."""
    p = (await get_config()).providers.get(provider_key)
    return p is not None and await _has_capacity(p)


async def admit(task: str, *, bypass_enabled: bool = False) -> None:
    """
    Decide whether a call for `task` may go ahead, before any provider is
    contacted. A refusal is logged as a not_sent row and raised as
    GatewayRefused. Order: task switched off, workspace call cap, workspace
    token cap, task cap, then whether any step of the route can be tried at
    all. `bypass_enabled` is for the admin Test button only.
    """
    cfg = await get_config()
    label = task_label(task)
    state = cfg.tasks.get(task)
    if state is not None and not state.enabled and not bypass_enabled:
        refuse(task, f"AI for {label} is switched off by the administrator.")

    call_cap = cfg.global_caps.get("daily_call_cap")
    token_cap = cfg.global_caps.get("daily_token_cap")
    task_cap = state.daily_cap if state else None
    if call_cap or token_cap or task_cap:
        usage = await usage_today()
        if call_cap and usage["calls"] >= call_cap:
            refuse(task, _WORKSPACE_LIMIT)
        if token_cap and usage["tokens"] >= token_cap:
            refuse(task, _WORKSPACE_LIMIT)
        if task_cap and usage["by_task"].get(task, {}).get("calls", 0) >= task_cap:
            refuse(task, f"Today's AI limit for {label} has been reached. It resets at midnight IST.")

    for step in _route_of(cfg, task):
        p = cfg.providers.get(step["provider"])
        if p is not None and p.ready and await _has_capacity(p):
            return
    refuse(task, no_provider_message(task))


_VISION_HINTS = ("vision", "scout", "maverick", "gemma-3", "gemma-4", "llava", "-vl", "omni")


def _vision_hint(model: str) -> bool:
    low = model.lower()
    return any(h in low for h in _VISION_HINTS)


def is_vision_model(p: ProviderState, model: str) -> bool:
    """What the provider's stored model list says, else a guess from the id."""
    for m in p.models:
        if m.get("id") == model and m.get("vision") is not None:
            return bool(m["vision"])
    return _vision_hint(model)


async def route_specs(task: str, *, vision: bool = False) -> list[RouteStep]:
    """
    The steps to try for `task`, in order. Every step whose provider is known
    is returned, ready or not, so the caller can name the skipped ones in its
    error. With `vision`, steps known to read images go first; the rest still
    follow in their own order.
    """
    cfg = await get_config()
    steps = [(cfg.providers[s["provider"]], s["model"])
             for s in _route_of(cfg, task) if s["provider"] in cfg.providers]
    if vision:
        steps = ([s for s in steps if is_vision_model(*s)]
                 + [s for s in steps if not is_vision_model(*s)])
    return [RouteStep(provider=p, model=m, attempt=i) for i, (p, m) in enumerate(steps, 1)]


def system_prompt(task: str, default: str, cfg: GatewayConfig | None = None) -> str:
    """
    The prompt override for an editable task, else `default`. Synchronous: it
    reads the most recently loaded settings, which the call site's own
    admit()/route_specs() has just refreshed.
    """
    cfg = cfg or _config
    tdef = TASKS.get(task)
    if cfg is None or tdef is None or not tdef.prompt_editable:
        return default
    state = cfg.tasks.get(task)
    return state.prompt_override if state and state.prompt_override else default


# ── Talking to a provider ─────────────────────────────────────────────

# OpenRouter attributes calls to the site named in HTTP-Referer. The production
# domain stands in when FRONTEND_URL names no origin (unset, or "*").
_PRODUCTION_ORIGIN = "https://twfintracker.worksmayukh.space"


def _referer() -> str:
    for origin in (settings.frontend_url or "").split(","):
        origin = origin.strip().rstrip("/")
        if origin.startswith(("https://", "http://")):
            return origin
    return _PRODUCTION_ORIGIN


def chat_url(p: ProviderState) -> str:
    return f"{p.base_url}/chat/completions"


def models_url(p: ProviderState) -> str:
    return f"{p.base_url}/models"


def headers_for(p: ProviderState) -> dict:
    # Groq gets the bearer token only; HTTP-Referer/X-Title is an OpenRouter
    # attribution convention.
    headers = {"Authorization": f"Bearer {p.api_key or ''}", "Content-Type": "application/json"}
    if p.key == "openrouter":
        headers["HTTP-Referer"] = _referer()
        headers["X-Title"] = "FinTrack AI"
    return headers


def timeout_for(p: ProviderState, left: float | None = None) -> httpx.Timeout:
    """The provider's request timeout, cut to `left` seconds when the caller
    has less time than that."""
    read = float(p.timeout_s) if left is None else max(1.0, min(float(p.timeout_s), left))
    return httpx.Timeout(read, connect=min(CONNECT_TIMEOUT_S, read))


async def provider_key(provider_key: str) -> str | None:
    """The key a ready provider calls with (stored, else env). For embeddings."""
    p = (await get_config()).providers.get(provider_key)
    return p.api_key if p is not None and p.ready else None


async def any_provider_ready() -> bool:
    return any(p.ready for p in (await get_config()).providers.values())


_NON_CHAT = ("whisper", "tts", "playai", "guard", "embed", "orpheus")


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _is_zero(value: Any) -> bool:
    try:
        return float(value) == 0
    except (TypeError, ValueError):
        return False


def parse_models(provider_key: str, payload: Any) -> list[dict]:
    """
    A provider's /models answer as [{"id", "context", "vision", "free"}].

    Speech, moderation and embedding models are dropped, as are ids a route
    could not be saved with. `vision` comes from OpenRouter's input
    modalities; Groq reports none, so it is guessed from the id or left None.
    `free` is None for Groq, which has no per-model pricing. Free models sort
    first, then by id.
    """
    items = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    found: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        mid = item.get("id")
        if not isinstance(mid, str) or not MODEL_ID_RE.match(mid) or mid in found:
            continue
        if any(word in mid.lower() for word in _NON_CHAT) or item.get("active") is False:
            continue
        arch = item.get("architecture")
        modalities = arch.get("input_modalities") if isinstance(arch, dict) else None
        if isinstance(modalities, list):
            vision = "image" in modalities
        else:
            vision = True if _vision_hint(mid) else None
        if provider_key == "groq":
            free = None
        else:
            pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
            free = (mid.endswith(":free") or mid == "openrouter/free"
                    or (_is_zero(pricing.get("prompt")) and _is_zero(pricing.get("completion"))))
        found[mid] = {
            "id": mid,
            "context": _positive_int(item.get("context_length")) or _positive_int(item.get("context_window")),
            "vision": vision,
            "free": free,
        }
    ordered = sorted(found.values(), key=lambda m: (m["free"] is not True, m["id"]))
    return ordered[:MAX_STORED_MODELS]


async def list_models(p: ProviderState) -> list[dict]:
    """GET {base}/models with the provider's key. Raises ProviderTestError."""
    try:
        r = await get_http().get(models_url(p), headers=headers_for(p),
                                 timeout=httpx.Timeout(TEST_TIMEOUT_S, connect=CONNECT_TIMEOUT_S))
    except Exception:
        raise ProviderTestError(f"Could not reach {p.label}") from None
    if r.status_code in (401, 403):
        raise ProviderTestError(f"Key rejected by {p.label}")
    if not 200 <= r.status_code < 300:
        raise ProviderTestError(f"{p.label} answered HTTP {r.status_code}")
    try:
        payload = r.json()
    except ValueError:
        raise ProviderTestError(f"{p.label} answered without a model list") from None
    return parse_models(p.key, payload)


async def test_provider(provider_key: str, actor_email: str | None) -> dict:
    """
    Check a provider's key by listing its models, and keep the list: the route
    editor offers it and route_warnings checks routes against it. Not a model
    call, so it is neither capped nor written to the call log.
    """
    _provider_def(provider_key)
    p = (await get_config()).providers[provider_key]
    models: list[dict] | None = None
    error: str | None = None
    ms = 0
    if not p.api_key:
        error = missing_key_message(p)
    else:
        started = time.monotonic()
        try:
            models = await list_models(p)
        except ProviderTestError as exc:
            error = str(exc)
        ms = int((time.monotonic() - started) * 1000)
    ok = error is None
    await _save_test(provider_key, ok, ms, error, models)
    logger.info("AI gateway: %s connection test by %s: %s", p.label, actor_email or "unknown",
                "ok" if ok else error)
    return {"ok": ok, "ms": ms, "model_count": len(models or []), "error": error}


async def _save_test(key: str, ok: bool, ms: int, error: str | None, models: list[dict] | None) -> None:
    pool = get_pool()
    if pool is None:
        return
    try:
        # A failed test keeps the last good model list.
        await pool.execute(
            """
            INSERT INTO ai_gateway_providers
              (key, last_test_at, last_test_ok, last_test_ms, last_test_error, models)
            VALUES ($1, NOW(), $2, $3, $4, $5::jsonb)
            ON CONFLICT (key) DO UPDATE SET
              last_test_at = NOW(), last_test_ok = EXCLUDED.last_test_ok,
              last_test_ms = EXCLUDED.last_test_ms, last_test_error = EXCLUDED.last_test_error,
              models = COALESCE(EXCLUDED.models, ai_gateway_providers.models)
            """,
            key, ok, ms, error, json.dumps(models) if models is not None else None,
        )
    except Exception as exc:
        logger.debug("AI gateway test result not saved: %s", exc)
        return
    invalidate()


def missing_key_message(p: ProviderState) -> str:
    """Why a provider has no key to call with."""
    if p.key_unreadable:
        return "Stored key can't be read — set it again"
    pdef = PROVIDERS.get(p.key)
    if pdef is not None and _host(p.base_url) != _host(pdef.default_base_url):
        return f"No key saved for this base URL ({p.env_var} is only sent to {_host(pdef.default_base_url)})"
    return f"No key set ({p.env_var})"


def route_warnings(task_state: TaskState, cfg: GatewayConfig) -> list[dict]:
    """Problems with a task's route, per step (0-based index)."""
    out: list[dict] = []
    for i, step in enumerate(task_state.route):
        p = cfg.providers.get(step.get("provider"))
        if p is None:
            out.append({"index": i, "level": "error",
                        "message": f"Unknown provider {step.get('provider')}"})
            continue
        if not p.api_key:
            out.append({"index": i, "level": "error", "message": missing_key_message(p)})
        if not p.enabled:
            out.append({"index": i, "level": "warn", "message": "Provider is off"})
        if (p.last_test and p.last_test.get("ok") and p.models
                and step.get("model") not in {m["id"] for m in p.models}):
            out.append({"index": i, "level": "error",
                        "message": f"Not offered by {p.label} — calls to it will fail"})
    return out


# ── Writes ────────────────────────────────────────────────────────────
# Each helper validates (ValueError on bad input, KeyError on an unknown key),
# writes, then invalidates the cache. A missing table or column, or no
# database at all, raises StorageNotReady.

async def _write(op: Callable[[Any], Awaitable[Any]]) -> Any:
    pool = get_pool()
    if pool is None:
        raise StorageNotReady()
    try:
        result = await op(pool)
    except Exception as exc:
        if _schema_missing(exc):
            raise StorageNotReady() from exc
        raise
    invalidate()
    return result


def _upsert_sql(table: str, columns: list[str], casts: dict[str, str] | None = None) -> str:
    """INSERT … ON CONFLICT (key) DO UPDATE for the given (whitelisted) columns."""
    casts = casts or {}
    placeholders = ", ".join(f"${i}{casts.get(c, '')}" for i, c in enumerate(columns, 2))
    updates = "".join(f"{c} = EXCLUDED.{c}, " for c in columns)
    actor = len(columns) + 2
    return (f"INSERT INTO {table} (key, {', '.join(columns)}, updated_by, updated_at) "
            f"VALUES ($1, {placeholders}, ${actor}, NOW()) "
            f"ON CONFLICT (key) DO UPDATE SET {updates}"
            f"updated_by = EXCLUDED.updated_by, updated_at = NOW()")


def _bool_input(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be true or false.")
    return value


def _cap_input(value: Any, name: str, maximum: int) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be a whole number of at least 1, or empty for no cap.")
    return value


def _unknown_fields(patch: dict, allowed: tuple[str, ...]) -> None:
    if not isinstance(patch, dict):
        raise ValueError("Expected an object of settings.")
    extra = sorted(set(patch) - set(allowed))
    if extra:
        raise ValueError(f"Unknown setting: {extra[0]}")


# https://host[:443][/path] — nothing that could carry credentials or reach
# past the path: no user info, query, fragment or other port.
_BASE_URL_RE = re.compile(r"https://([A-Za-z0-9.-]+)(?::443)?((?:/[A-Za-z0-9._~-]+)*)")
_PUBLIC_HOST_RE = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")
# Names that only resolve inside a network.
_PRIVATE_TLDS = {"localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "arpa"}


def validate_base_url(value: Any) -> str | None:
    """
    An https:// base URL on a public host name, without a trailing slash;
    None/blank = the default. IP addresses and internal names (localhost,
    *.local, *.internal, single-label hosts) are refused: requests to it carry
    the provider key.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    url = value.strip().rstrip("/") if isinstance(value, str) else ""
    m = _BASE_URL_RE.fullmatch(url) if len(url) <= 200 else None
    host = m.group(1).lower() if m else ""
    if not _PUBLIC_HOST_RE.fullmatch(host) or host.rsplit(".", 1)[-1] in _PRIVATE_TLDS:
        raise ValueError("base_url must be an https:// address on a public host name (no IP address, "
                         "port, user name, query or fragment) of at most 200 characters.")
    return url


def validate_api_key(value: Any) -> str:
    key = value.strip() if isinstance(value, str) else ""
    if not _KEY_RE.fullmatch(key):
        raise ValueError("An API key is 8 to 400 characters with no spaces or control characters.")
    return key


def validate_route(route: Any) -> list[dict]:
    if not isinstance(route, list) or not 1 <= len(route) <= MAX_ROUTE_STEPS:
        raise ValueError(f"A route needs 1 to {MAX_ROUTE_STEPS} steps.")
    out = []
    for i, step in enumerate(route, 1):
        if hasattr(step, "model_dump"):
            step = step.model_dump()
        if not isinstance(step, dict):
            raise ValueError(f"Step {i} needs a provider and a model.")
        provider, model = step.get("provider"), step.get("model")
        if provider not in PROVIDERS:
            raise ValueError(f"Step {i}: unknown provider {str(provider)[:20]!r}.")
        model = model.strip() if isinstance(model, str) else ""
        if not MODEL_ID_RE.match(model):
            raise ValueError(f"Step {i}: a model id is 1 to 120 letters, digits or . _ : / @ + -")
        out.append({"provider": provider, "model": model})
    return out


_PROVIDER_FIELDS = ("enabled", "base_url", "timeout_s", "daily_request_cap", "daily_token_cap")
_TASK_FIELDS = ("enabled", "route", "daily_cap")
_GLOBAL_FIELDS = ("daily_call_cap", "daily_token_cap")


def validate_provider_patch(patch: dict) -> dict:
    _unknown_fields(patch, _PROVIDER_FIELDS)
    out: dict = {}
    if "enabled" in patch:
        out["enabled"] = _bool_input(patch["enabled"], "enabled")
    if "base_url" in patch:
        out["base_url"] = validate_base_url(patch["base_url"])
    if "timeout_s" in patch:
        t = patch["timeout_s"]
        if t is not None and (isinstance(t, bool) or not isinstance(t, int)
                              or not TIMEOUT_MIN_S <= t <= TIMEOUT_MAX_S):
            raise ValueError(f"timeout_s must be {TIMEOUT_MIN_S} to {TIMEOUT_MAX_S} seconds.")
        out["timeout_s"] = t
    if "daily_request_cap" in patch:
        out["daily_request_cap"] = _cap_input(patch["daily_request_cap"], "daily_request_cap", _MAX_CALL_CAP)
    if "daily_token_cap" in patch:
        out["daily_token_cap"] = _cap_input(patch["daily_token_cap"], "daily_token_cap", _MAX_TOKEN_CAP)
    return out


def validate_task_patch(patch: dict) -> dict:
    _unknown_fields(patch, _TASK_FIELDS)
    out: dict = {}
    if "enabled" in patch:
        out["enabled"] = _bool_input(patch["enabled"], "enabled")
    if "route" in patch:
        out["route"] = None if patch["route"] is None else validate_route(patch["route"])
    if "daily_cap" in patch:
        out["daily_cap"] = _cap_input(patch["daily_cap"], "daily_cap", _MAX_CALL_CAP)
    return out


def validate_global_patch(patch: dict) -> dict:
    _unknown_fields(patch, _GLOBAL_FIELDS)
    return {k: _cap_input(patch[k], k, _MAX_TOKEN_CAP if k == "daily_token_cap" else _MAX_CALL_CAP)
            for k in _GLOBAL_FIELDS if k in patch}


_SQL_FORGET_KEY = """
    UPDATE ai_gateway_providers
       SET api_key_enc = NULL, key_hint = NULL, key_set_by = NULL, key_set_at = NULL,
           models = NULL, last_test_at = NULL, last_test_ok = NULL, last_test_ms = NULL,
           last_test_error = NULL
     WHERE key = $1
"""


async def save_provider(key: str, patch: dict, actor_email: str | None) -> bool:
    """
    Save provider settings. A stored key belongs to the host it was entered
    for: a base URL on another host drops it (with the model list and the last
    test, which described the old host), so the new host needs its own key.
    Returns True when a stored key was dropped.
    """
    pdef = _provider_def(key)
    values = validate_provider_patch(patch)
    if not values:
        return False
    sql = _upsert_sql("ai_gateway_providers", list(values))
    if "base_url" not in values:
        await _write(lambda pool: pool.execute(sql, key, *values.values(), actor_email))
        return False
    new_host = _host(values["base_url"] or pdef.default_base_url)

    async def op(pool) -> bool:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT base_url, api_key_enc IS NOT NULL AS has_key "
                    "FROM ai_gateway_providers WHERE key = $1 FOR UPDATE", key)
                await conn.execute(sql, key, *values.values(), actor_email)
                old_host = _host(_stored_base_url(pdef, row["base_url"] if row else None))
                if old_host == new_host:
                    return False
                await conn.execute(_SQL_FORGET_KEY, key)
                return bool(row and row["has_key"])

    return await _write(op)


async def set_provider_key(key: str, api_key: str, actor_email: str | None) -> str:
    """Store a key encrypted. Returns its hint (the last 4 characters)."""
    _provider_def(key)
    api_key = validate_api_key(api_key)
    hint = api_key[-4:]
    enc = encrypt_key(api_key)
    # A new key may see a different model list: the last test no longer holds.
    await _write(lambda pool: pool.execute(
        """
        INSERT INTO ai_gateway_providers
          (key, api_key_enc, key_hint, key_set_by, key_set_at, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), $4, NOW())
        ON CONFLICT (key) DO UPDATE SET
          api_key_enc = EXCLUDED.api_key_enc, key_hint = EXCLUDED.key_hint,
          key_set_by = EXCLUDED.key_set_by, key_set_at = NOW(),
          last_test_at = NULL, last_test_ok = NULL, last_test_ms = NULL, last_test_error = NULL,
          updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """,
        key, enc, hint, actor_email,
    ))
    return hint


async def clear_provider_key(key: str, actor_email: str | None) -> None:
    _provider_def(key)
    await _write(lambda pool: pool.execute(
        """
        UPDATE ai_gateway_providers
           SET api_key_enc = NULL, key_hint = NULL, key_set_by = NULL, key_set_at = NULL,
               last_test_at = NULL, last_test_ok = NULL, last_test_ms = NULL, last_test_error = NULL,
               updated_by = $2, updated_at = NOW()
         WHERE key = $1
        """,
        key, actor_email,
    ))


async def save_task(key: str, patch: dict, actor_email: str | None) -> None:
    _task_def(key)
    values = validate_task_patch(patch)
    if not values:
        return
    if "route" in values and values["route"] is not None:
        values["route"] = json.dumps(values["route"])
    sql = _upsert_sql("ai_gateway_tasks", list(values), {"route": "::jsonb"})
    await _write(lambda pool: pool.execute(sql, key, *values.values(), actor_email))


async def save_prompt(task: str, prompt: str | None, actor_email: str | None) -> int:
    """
    Save a prompt override as the task's next version and make it active.
    None or blank saves a version meaning "back to the built-in prompt".
    Returns the new version number.
    """
    tdef = _task_def(task)
    if not tdef.prompt_editable:
        raise ValueError(f"The prompt for {tdef.label} is built from live data and cannot be edited.")
    if prompt is not None and not isinstance(prompt, str):
        raise ValueError("prompt must be text, or null for the built-in prompt.")
    text = prompt if prompt and prompt.strip() else None
    if text is not None and len(text) > MAX_PROMPT_CHARS:
        raise ValueError(f"A prompt can be at most {MAX_PROMPT_CHARS:,} characters.")

    async def op(pool) -> int:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO ai_gateway_tasks (key, updated_by) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
                    task, actor_email)
                # The row lock serialises two saves of the same task, so they
                # cannot both claim the same version number.
                await conn.fetchval("SELECT prompt_version FROM ai_gateway_tasks WHERE key = $1 FOR UPDATE", task)
                version = await conn.fetchval(
                    "SELECT COALESCE(MAX(version), 0) + 1 FROM ai_gateway_prompts WHERE task = $1", task)
                await conn.execute(
                    "INSERT INTO ai_gateway_prompts (task, version, prompt, created_by) VALUES ($1, $2, $3, $4)",
                    task, version, text, actor_email)
                await conn.execute(
                    "UPDATE ai_gateway_tasks SET prompt_version = $2, updated_by = $3, updated_at = NOW() "
                    "WHERE key = $1",
                    task, version, actor_email)
                return int(version)

    return await _write(op)


async def prompt_history(task: str) -> list[dict]:
    """Saved versions, newest first (at most 50). Empty when storage is not ready."""
    pool = get_pool()
    if pool is None:
        return []
    try:
        rows = await pool.fetch(
            """
            SELECT version, created_at, created_by, prompt IS NULL AS reverted,
                   COALESCE(length(prompt), 0) AS chars
              FROM ai_gateway_prompts
             WHERE task = $1
             ORDER BY version DESC
             LIMIT 50
            """,
            task,
        )
    except Exception as exc:
        logger.debug("AI gateway prompt history unreadable: %s", exc)
        return []
    return [{"version": int(r["version"]), "created_at": _iso(r["created_at"]),
             "created_by": r["created_by"], "reverted": bool(r["reverted"]),
             "chars": int(r["chars"] or 0)} for r in rows]


async def prompt_version(task: str, version: int) -> dict | None:
    """One saved version; `prompt` None means it switched back to built-in."""
    pool = get_pool()
    if pool is None:
        return None
    try:
        row = await pool.fetchrow(
            "SELECT version, prompt, created_at, created_by FROM ai_gateway_prompts "
            "WHERE task = $1 AND version = $2",
            task, version,
        )
    except Exception as exc:
        logger.debug("AI gateway prompt version unreadable: %s", exc)
        return None
    if row is None:
        return None
    return {"version": int(row["version"]), "prompt": row["prompt"],
            "created_at": _iso(row["created_at"]), "created_by": row["created_by"]}


async def save_global(patch: dict, actor_email: str | None) -> None:
    values = validate_global_patch(patch)
    if not values:
        return

    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for k, v in values.items():
                    await conn.execute(
                        """
                        INSERT INTO ai_gateway_settings (key, value, updated_by, updated_at)
                        VALUES ($1, $2::jsonb, $3, NOW())
                        ON CONFLICT (key) DO UPDATE SET
                          value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                        """,
                        k, json.dumps(v), actor_email,
                    )

    await _write(op)
