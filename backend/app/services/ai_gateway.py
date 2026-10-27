"""
AI gateway — which providers, models and fallback chains serve each AI task,
what each may spend, and which prompt a task runs with.

Why this exists
───────────────
Model ids used to be hardcoded in services/openrouter.py and in env vars. Free
model ids come and go every few weeks, and when the hardcoded ones disappeared
every AI feature failed at once, with nothing an administrator could change
short of a redeploy. Everything a superadmin may need to change now lives in
the database and is edited from Admin → AI gateway:

  * providers: any OpenAI-compatible API — the built-in Groq and OpenRouter,
    presets for the major hosted APIs, or a custom base
    URL with extra headers. Keys are stored encrypted and never leave the
    server; a stored key is bound to the host it was saved for;
  * a model catalogue per provider: label, on/off, context window, output and
    per-request token limits, and an optional price per 1M tokens;
  * fallback chains: every task has an ordered chain of provider/model steps
    (per-step timeout, skip-when-over-limit), and a global default chain both
    serves tasks without their own and is appended to every chain as the last
    line of fallback;
  * limits — requests, tokens and estimated spend, per day, week and month —
    for the workspace, each provider, model and task, and each user;
  * a circuit breaker: a provider or model that keeps failing is moved to the
    end of every chain for a few minutes, then tried again.

The database only stores overrides. A missing row means the built-in default,
so an empty table behaves like a fresh install, and a database a migration
has not reached yet (migrations run in a thread and may fail) still serves
every feature: without 0003 on the defaults plus the env keys, without 0008
on the 0003 settings (Groq and OpenRouter, daily caps). Reads never raise;
writes raise StorageNotReady, which the router turns into a 503.

Every "today" starts at midnight IST, every week on Monday, every month on
the 1st.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import ipaddress
import json
import logging
import re
import time
from dataclasses import dataclass, field, replace
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
    env_attr: str | None     # settings attribute holding the fallback key
    env_var: str
    default_timeout_s: int
    note: str = ""           # shown in the "Add provider" picker


# The two providers every install starts with. Their env keys still work,
# sent only to their own hosts.
PROVIDERS: dict[str, ProviderDef] = {
    "groq": ProviderDef("groq", "Groq", "https://api.groq.com/openai/v1",
                        "groq_api_key", "GROQ_API_KEY", 30, "Fast open models, free tier."),
    "openrouter": ProviderDef("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
                              "openrouter_api_key", "OPENROUTER_API_KEY", 45,
                              "Hundreds of models behind one key, free models included."),
}

# What "Add provider" offers. All speak the OpenAI chat-completions shape at
# {base}/chat/completions and list models at {base}/models.
PRESETS: dict[str, ProviderDef] = {
    **PROVIDERS,
    "openai": ProviderDef("openai", "OpenAI", "https://api.openai.com/v1", None, "", 60,
                          "GPT models."),
    "gemini": ProviderDef("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
                          None, "", 60, "Gemini through Google's OpenAI-compatible endpoint."),
    "anthropic": ProviderDef("anthropic", "Anthropic", "https://api.anthropic.com/v1", None, "", 60,
                             "Its models through the OpenAI SDK compatibility layer."),
    "deepseek": ProviderDef("deepseek", "DeepSeek", "https://api.deepseek.com/v1", None, "", 60,
                            "DeepSeek chat and reasoning models."),
    "mistral": ProviderDef("mistral", "Mistral", "https://api.mistral.ai/v1", None, "", 60,
                           "Mistral and Codestral models."),
    "together": ProviderDef("together", "Together AI", "https://api.together.xyz/v1", None, "", 60,
                            "Open models hosted by Together."),
    "fireworks": ProviderDef("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", None, "", 60,
                             "Open models hosted by Fireworks."),
    "cerebras": ProviderDef("cerebras", "Cerebras", "https://api.cerebras.ai/v1", None, "", 30,
                            "Very fast inference of open models."),
    "xai": ProviderDef("xai", "xAI", "https://api.x.ai/v1", None, "", 60, "Grok models."),
}

TIMEOUT_MIN_S, TIMEOUT_MAX_S = 5, 120
CONNECT_TIMEOUT_S = 10.0
TEST_TIMEOUT_S = 15.0
MAX_ROUTE_STEPS = 10
MAX_PROMPT_CHARS = 20_000
MAX_STORED_MODELS = 600
MAX_CATALOG_MODELS = 200          # per provider
MAX_PROVIDERS = 30
MAX_EXTRA_HEADERS = 10
MODEL_ID_RE = re.compile(r"^[A-Za-z0-9._:/@+-]{1,120}$")
PROVIDER_KEY_RE = re.compile(r"^[a-z][a-z0-9-]{1,19}$")

# Upper bounds that keep a cap inside its column (INTEGER / BIGINT / NUMERIC).
_MAX_CALL_CAP = 1_000_000_000
_MAX_TOKEN_CAP = 10 ** 15
_MAX_SPEND_CAP = 10 ** 9
_MAX_MODEL_TOKENS = 100_000_000
_MAX_COST_PER_M = 100_000

STORAGE_NOT_READY = "AI gateway storage is not ready (database migration 0003 has not run)."
STORAGE_NOT_READY_V2 = ("This setting needs database migration 0008 (AI gateway providers, models "
                        "and limits), which has not run yet.")

# Limits: what is counted, over which period, at which level.
PERIODS = ("day", "week", "month")
METRICS = ("requests", "tokens", "spend")
SCOPES = ("global", "provider", "model", "task", "user")
EVERY_USER = "*"                  # a user limit that applies to each user on their own

# Circuit breaker defaults: this many failures in a row benches a provider or
# model for this many minutes.
BREAKER_FAILURES = 3
BREAKER_MINUTES = 5


def model_target(provider: str, model: str) -> str:
    """A model's key in the limits table: provider|model ('|' is in neither)."""
    return f"{provider}|{model}"


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
        default_route=DEFAULT_ROUTE, max_tokens=16000,
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
        key="artifact_plan", label="Artifact plan and questions", module="Pages",
        description="Before an artifact is built, proposes a title, the features to build "
                    "and a few questions to confirm. Falls back to building directly.",
        output="json", personal_data=False, prompt_editable=True,
        default_route=DEFAULT_ROUTE, max_tokens=1200,
        sample_input="make a to do list organiser",
        call_sites=("artifact_plan.plan_artifact (POST /api/pages/ai/plan)",),
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
    models: list[dict] = field(default_factory=list)   # what the provider offers (last test)
    last_test: dict | None = None
    env_var: str = ""
    preset: str | None = None         # the PRESETS entry it was added from; None = custom
    builtin: bool = False             # Groq / OpenRouter
    extra_headers: dict = field(default_factory=dict)
    default_base_url: str = ""
    default_timeout_s: int = 30
    position: int = 0

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.api_key)

    @property
    def host(self) -> str:
        return _host(self.base_url)

    @property
    def flavor(self) -> str:
        """Which vendor extensions the API understands: 'openrouter', 'groq'
        or plain 'openai'. The built-ins keep theirs behind a proxy base URL;
        an added provider is judged by its host, so one pointing at
        openrouter.ai behaves like the built-in."""
        if self.key in PROVIDERS:
            return self.key
        host = self.host
        if host == "openrouter.ai" or host.endswith(".openrouter.ai"):
            return "openrouter"
        if host == "api.groq.com":
            return "groq"
        return "openai"


@dataclass(frozen=True)
class ModelEntry:
    """One model in a provider's catalogue, as the superadmin described it."""
    provider: str
    model: str
    label: str | None = None
    enabled: bool = True
    context_window: int | None = None
    max_output_tokens: int | None = None
    request_token_limit: int | None = None    # prompt + answer tokens one request may carry
    input_cost_per_m: float | None = None      # USD per 1M prompt tokens
    output_cost_per_m: float | None = None     # USD per 1M answer tokens
    vision: bool | None = None

    @property
    def priced(self) -> bool:
        return self.input_cost_per_m is not None or self.output_cost_per_m is not None

    def cost(self, tokens_in: int, tokens_out: int) -> float:
        return ((tokens_in or 0) * (self.input_cost_per_m or 0)
                + (tokens_out or 0) * (self.output_cost_per_m or 0)) / 1_000_000


@dataclass(frozen=True)
class Limit:
    scope: str        # SCOPES
    target: str       # '' (global), provider key, provider|model, task key, '*' or a user id
    period: str       # PERIODS
    metric: str       # METRICS
    cap: float


@dataclass
class TaskState:
    key: str
    enabled: bool = True
    route: list[dict] = field(default_factory=list)
    daily_cap: int | None = None
    prompt_version: int = 0
    prompt_override: str | None = None
    route_custom: bool = False        # a saved route; False = the default chain
    fallback_to_default: bool = True  # the global default chain follows the task's own


@dataclass
class GatewayConfig:
    storage_ok: bool
    providers: dict[str, ProviderState]
    tasks: dict[str, TaskState]
    global_caps: dict
    v2: bool = False                  # migration 0008: provider CRUD, catalogue, limits table
    catalog: dict = field(default_factory=dict)       # (provider, model) -> ModelEntry
    limits: tuple = ()                # Limit, ...
    default_route: list = field(default_factory=list)
    default_route_custom: bool = False
    breaker: dict = field(default_factory=lambda: {"failures": BREAKER_FAILURES, "minutes": BREAKER_MINUTES})
    removed: tuple = ()               # built-in providers the superadmin removed

    def limits_for(self, scope: str, target: str) -> list[Limit]:
        return [lim for lim in self.limits if lim.scope == scope and lim.target == target]

    def entry(self, provider: str, model: str) -> ModelEntry | None:
        return self.catalog.get((provider, model))


@dataclass(frozen=True)
class RouteStep:
    provider: ProviderState
    model: str
    attempt: int             # 1-based position in the order the steps are tried
    timeout_s: int | None = None
    skip_over_limit: bool = True
    fallback: bool = False   # appended from the global default chain
    benched: str | None = None
    entry: ModelEntry | None = None


class GatewayRefused(ValueError):
    """A call refused before any provider was contacted. A ValueError, so every
    router already turns it into a readable 400 or SSE error."""


class StorageNotReady(RuntimeError):
    def __init__(self, message: str = STORAGE_NOT_READY):
        super().__init__(message)


class ProviderTestError(RuntimeError):
    """A model-list request failed. The message is safe to show: it never
    carries the key."""


# ── IST day, week, month ──────────────────────────────────────────────

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> date:
    return _now().astimezone(IST).date()


def day_start(day: date) -> datetime:
    """Midnight IST at the start of `day`."""
    return datetime(day.year, day.month, day.day, tzinfo=IST)


def period_start(period: str, day: date | None = None) -> datetime:
    """Midnight IST at the start of the day, week (Monday) or month holding `day`."""
    day = day or today_ist()
    if period == "week":
        day = day - timedelta(days=day.weekday())
    elif period == "month":
        day = day.replace(day=1)
    return day_start(day)


def period_end(period: str, day: date | None = None) -> datetime:
    day = day or today_ist()
    if period == "day":
        return day_start(day + timedelta(days=1))
    if period == "week":
        return day_start(day - timedelta(days=day.weekday()) + timedelta(days=7))
    first = day.replace(day=1)
    return day_start((first + timedelta(days=32)).replace(day=1))


# ── Key encryption ────────────────────────────────────────────────────

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


def _amount(value: Any) -> float | None:
    """A stored cap or price as a float; None for missing or non-positive."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


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
# With migration 0008: what makes a provider addable and removable.
_SQL_PROVIDERS_V2 = """
    SELECT key, enabled, base_url, api_key_enc, key_hint, key_set_by, key_set_at,
           timeout_s, daily_request_cap, daily_token_cap, models,
           last_test_at, last_test_ok, last_test_ms, last_test_error,
           label, preset, default_base_url, extra_headers, position, deleted
      FROM ai_gateway_providers
"""
_SQL_TASKS = "SELECT key, enabled, route, daily_cap, prompt_version FROM ai_gateway_tasks"
_SQL_TASKS_V2 = ("SELECT key, enabled, route, daily_cap, prompt_version, fallback_to_default "
                 "FROM ai_gateway_tasks")
_SQL_SETTINGS = "SELECT key, value FROM ai_gateway_settings"
_SQL_ACTIVE_PROMPTS = """
    SELECT p.task, p.prompt
      FROM ai_gateway_prompts p
      JOIN ai_gateway_tasks t ON t.key = p.task AND t.prompt_version = p.version
"""
_SQL_MODELS = """
    SELECT provider, model, label, enabled, context_window, max_output_tokens,
           request_token_limit, input_cost_per_m, output_cost_per_m, vision
      FROM ai_gateway_models
"""
_SQL_LIMITS = "SELECT scope, target, period, metric, cap FROM ai_gateway_limits"


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


async def _fetch_either(pool, newer: str, older: str):
    """`newer` (needs migration 0008), else `older` when its columns are missing."""
    try:
        return await pool.fetch(newer)
    except Exception as exc:
        if not _schema_missing(exc):
            raise
    return await pool.fetch(older)


async def _fetch_optional(pool, sql: str):
    """Rows of a table migration 0008 adds, or None before it has run."""
    try:
        return await pool.fetch(sql)
    except Exception as exc:
        if not _schema_missing(exc):
            raise
    return None


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
            await _fetch_either(pool, _SQL_PROVIDERS_V2, _SQL_PROVIDERS),
            await _fetch_either(pool, _SQL_TASKS_V2, _SQL_TASKS),
            await pool.fetch(_SQL_SETTINGS),
            await pool.fetch(_SQL_ACTIVE_PROMPTS),
            await _fetch_optional(pool, _SQL_MODELS),
            await _fetch_optional(pool, _SQL_LIMITS),
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


def _row_get(row: Any, name: str, default: Any = None) -> Any:
    try:
        value = row.get(name, default)
    except (AttributeError, KeyError):
        return default
    return default if value is None else value


def _build_config(storage_ok: bool, provider_rows=(), task_rows=(), setting_rows=(),
                  prompt_rows=(), model_rows=None, limit_rows=None) -> GatewayConfig:
    v2 = limit_rows is not None
    by_provider = {r["key"]: dict(r) for r in provider_rows}
    by_task = {r["key"]: dict(r) for r in task_rows}
    overrides = {r["task"]: r["prompt"] for r in prompt_rows}
    values = {r["key"]: _json(r["value"]) for r in setting_rows}

    providers, removed = _providers_from(by_provider)
    catalog = _catalog_from(model_rows or ())
    default_saved = _stored_route(values.get("default_route"))
    default_route = default_saved or [dict(s) for s in DEFAULT_ROUTE]

    # Limits: the limits table once migration 0008 has run (it copies the old
    # daily caps across); before that the 0003 daily cap columns.
    if v2:
        limits = _limits_from(limit_rows)
    else:
        limits = _legacy_limits(values, by_provider, by_task)

    tasks = {k: _task_state(d, by_task.get(k), overrides.get(k), default_route if default_saved else None)
             for k, d in TASKS.items()}

    def day_cap(scope, target, metric):
        for lim in limits:
            if (lim.scope, lim.target, lim.period, lim.metric) == (scope, target, "day", metric):
                return int(lim.cap)
        return None

    for p in providers.values():
        p.daily_request_cap = day_cap("provider", p.key, "requests")
        p.daily_token_cap = day_cap("provider", p.key, "tokens")
    for t in tasks.values():
        t.daily_cap = day_cap("task", t.key, "requests")

    return GatewayConfig(
        storage_ok=storage_ok,
        providers=providers,
        tasks=tasks,
        global_caps={"daily_call_cap": day_cap("global", "", "requests"),
                     "daily_token_cap": day_cap("global", "", "tokens")},
        v2=v2,
        catalog=catalog,
        limits=tuple(limits),
        default_route=default_route,
        default_route_custom=bool(default_saved),
        breaker=_breaker_settings(values),
        removed=tuple(removed),
    )


def _providers_from(by_provider: dict) -> tuple[dict[str, ProviderState], list[str]]:
    """Built-ins first (unless removed), then added providers, by position."""
    out: list[ProviderState] = []
    removed: list[str] = []
    for index, (key, pdef) in enumerate(PROVIDERS.items()):
        row = by_provider.get(key)
        if row and row.get("deleted"):
            removed.append(key)
            continue
        state = _provider_state(pdef, row)
        state.builtin = True
        state.position = _int_or(row.get("position") if row else None, index)
        out.append(state)
    for key, row in by_provider.items():
        if key in PROVIDERS or row.get("deleted") or not PROVIDER_KEY_RE.match(str(key)):
            continue
        pdef = _custom_def(key, row)
        if pdef is None:
            continue
        state = _provider_state(pdef, row)
        state.position = _int_or(row.get("position"), 1000)
        out.append(state)
    out.sort(key=lambda p: (p.position, not p.builtin, p.key))
    return {p.key: p for p in out}, removed


def _int_or(value: Any, default: int) -> int:
    try:
        return int(value) if value is not None and not isinstance(value, bool) else default
    except (TypeError, ValueError):
        return default


def _custom_def(key: str, row: dict) -> ProviderDef | None:
    """The definition of a provider added from the admin panel, or None when
    its row has no usable base URL (it could never be called)."""
    preset = PRESETS.get(row.get("preset") or "")
    try:
        default_url = validate_base_url(row.get("default_base_url")) or (preset.default_base_url if preset else None)
        base = validate_base_url(row.get("base_url"))
    except ValueError:
        default_url, base = (preset.default_base_url if preset else None), None
    default_url = default_url or base
    if not default_url:
        return None
    label = str(row.get("label") or (preset.label if preset else key))[:60]
    return ProviderDef(key, label, default_url, None, "", preset.default_timeout_s if preset else 60)


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def _stored_base_url(pdef: ProviderDef, value: Any) -> str:
    try:
        return validate_base_url(value) or pdef.default_base_url
    except ValueError:
        return pdef.default_base_url


def _stored_headers(value: Any) -> dict:
    """Extra headers read back: anything that would not pass validation now is dropped."""
    data = _json(value)
    if not isinstance(data, dict):
        return {}
    try:
        return validate_extra_headers(data)
    except ValueError:
        return {k: v for k, v in data.items() if _header_ok(k, v)}


def _provider_state(pdef: ProviderDef, row: dict | None) -> ProviderState:
    row = row or {}
    base_url = _stored_base_url(pdef, row.get("base_url"))
    enc = row.get("api_key_enc")
    stored = usable_key(decrypt_key(enc)) if enc else None
    # The server's env key belongs to the provider's own API. A base URL on
    # another host gets only a key saved for it (saving a new host drops the
    # stored key), so editing the URL can never send the env key elsewhere.
    env = None
    if pdef.env_attr and _host(base_url) == _host(pdef.default_base_url):
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
    label = row.get("label") if isinstance(row.get("label"), str) and row.get("label").strip() else pdef.label
    preset = row.get("preset") if row.get("preset") in PRESETS else (pdef.key if pdef.key in PROVIDERS else None)
    return ProviderState(
        key=pdef.key,
        label=label[:60],
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
        models=models,
        last_test=last_test,
        env_var=pdef.env_var,
        preset=preset,
        builtin=pdef.key in PROVIDERS,
        extra_headers=_stored_headers(row.get("extra_headers")),
        default_base_url=pdef.default_base_url,
        default_timeout_s=pdef.default_timeout_s,
    )


def _catalog_from(rows) -> dict:
    out: dict = {}
    for r in rows:
        provider, model = r["provider"], r["model"]
        if not isinstance(provider, str) or not isinstance(model, str):
            continue
        vision = _row_get(r, "vision")
        out[(provider, model)] = ModelEntry(
            provider=provider, model=model,
            label=_row_get(r, "label"),
            enabled=_row_get(r, "enabled", True) is not False,
            context_window=_cap(_row_get(r, "context_window")),
            max_output_tokens=_cap(_row_get(r, "max_output_tokens")),
            request_token_limit=_cap(_row_get(r, "request_token_limit")),
            input_cost_per_m=_price(_row_get(r, "input_cost_per_m")),
            output_cost_per_m=_price(_row_get(r, "output_cost_per_m")),
            vision=None if vision is None else bool(vision),
        )
    return out


def _price(value: Any) -> float | None:
    """A stored price; 0 is a real price (a free model), unlike a cap."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _limits_from(rows) -> list[Limit]:
    out = []
    for r in rows:
        scope, target, period, metric = r["scope"], r["target"] or "", r["period"], r["metric"]
        cap = _amount(r["cap"])
        if scope in SCOPES and period in PERIODS and metric in METRICS and cap:
            out.append(Limit(scope, str(target), period, metric, cap))
    return _sorted_limits(out)


def _legacy_limits(values: dict, by_provider: dict, by_task: dict) -> list[Limit]:
    """The 0003 daily caps as limits."""
    out = []
    for name, metric in (("daily_call_cap", "requests"), ("daily_token_cap", "tokens")):
        cap = _cap(values.get(name))
        if cap:
            out.append(Limit("global", "", "day", metric, cap))
    for key, row in by_provider.items():
        for name, metric in (("daily_request_cap", "requests"), ("daily_token_cap", "tokens")):
            cap = _cap(row.get(name))
            if cap:
                out.append(Limit("provider", key, "day", metric, cap))
    for key, row in by_task.items():
        cap = _cap(row.get("daily_cap"))
        if cap and key in TASKS:
            out.append(Limit("task", key, "day", "requests", cap))
    return _sorted_limits(out)


def _sorted_limits(limits: list[Limit]) -> list[Limit]:
    return sorted(limits, key=lambda lim: (SCOPES.index(lim.scope), lim.target,
                                           PERIODS.index(lim.period), METRICS.index(lim.metric)))


def _breaker_settings(values: dict) -> dict:
    failures = _cap(values.get("breaker_failures"))
    minutes = values.get("breaker_minutes")
    minutes = BREAKER_MINUTES if minutes is None or isinstance(minutes, bool) else _int_or(minutes, BREAKER_MINUTES)
    return {"failures": min(failures or BREAKER_FAILURES, 100), "minutes": min(max(minutes, 0), 1440)}


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
            out.append(_step_options({"provider": provider, "model": model.strip()}, step))
    return out


def _step_options(out: dict, step: dict) -> dict:
    """Copy a step's options (only those that differ from the default)."""
    timeout = step.get("timeout_s")
    if isinstance(timeout, int) and not isinstance(timeout, bool) and TIMEOUT_MIN_S <= timeout <= TIMEOUT_MAX_S:
        out["timeout_s"] = timeout
    if step.get("skip_over_limit") is False:
        out["skip_over_limit"] = False
    return out


def _task_state(tdef: TaskDef, row: dict | None, override: str | None,
                default_route: list[dict] | None = None) -> TaskState:
    row = row or {}
    try:
        version = int(row.get("prompt_version") or 0)
    except (TypeError, ValueError):
        version = 0
    active = (tdef.prompt_editable and version > 0
              and isinstance(override, str) and bool(override.strip()))
    route = _stored_route(row.get("route"))
    # Without a route of its own a task follows the global default chain once
    # one is saved, else its built-in route.
    fallback = route or [dict(s) for s in (default_route or tdef.default_route)]
    return TaskState(
        key=tdef.key,
        enabled=row.get("enabled") is not False,
        route=fallback,
        prompt_version=version,
        prompt_override=override if active else None,
        route_custom=bool(route),
        fallback_to_default=row.get("fallback_to_default") is not False,
    )



# ── Usage: today, this week, this month ───────────────────────────────

_USAGE_TTL_S = 5.0

# A row counts the provider requests its attempt sent: retries of a 5xx or of
# a connection that never opened live in extra.requests. One read covers the
# month and the week (which may start in the month before); each row says
# which of the three periods it falls in.
_SQL_USAGE = """
    SELECT task, provider, model, user_id::text AS user_id,
           ts >= $2 AS in_day, ts >= $3 AS in_week, ts >= $4 AS in_month,
           SUM(COALESCE((extra->>'requests')::int, 1)) AS calls,
           COALESCE(SUM(COALESCE(prompt_tokens, 0)), 0) AS tokens_in,
           COALESCE(SUM(COALESCE(answer_tokens, 0)), 0) AS tokens_out
      FROM ai_traces
     WHERE ts >= $1
       AND (status IS NULL OR status <> 'not_sent')
     GROUP BY 1, 2, 3, 4, 5, 6, 7
"""


@dataclass
class _Usage:
    """Usage grouped by (period, task, provider, model, user):
    [calls, prompt tokens, answer tokens]."""
    groups: dict = field(default_factory=dict)

    def add(self, periods, task, provider, model, user, calls: int, tokens_in: int, tokens_out: int) -> None:
        for period in periods:
            slot = self.groups.setdefault((period, task, provider, model, user), [0, 0, 0])
            slot[0] += calls
            slot[1] += tokens_in
            slot[2] += tokens_out

    def plus(self, other: "_Usage") -> "_Usage":
        out = _Usage()
        for part in (self, other):
            for key, (c, i, o) in part.groups.items():
                slot = out.groups.setdefault(key, [0, 0, 0])
                slot[0] += c
                slot[1] += i
                slot[2] += o
        return out

    def view(self, period: str, cfg: GatewayConfig | None = None) -> dict:
        """Totals and breakdowns for one period: {"total", "by_task",
        "by_provider", "by_model", "by_user"}, each {"calls", "tokens",
        "spend"}. Spend is estimated from the catalogue's prices; tokens of
        a model without one cost nothing here."""
        catalog = cfg.catalog if cfg is not None else {}
        out = {"total": _tally(), "by_task": {}, "by_provider": {}, "by_model": {}, "by_user": {}}
        for (p, task, provider, model, user), (calls, tin, tout) in self.groups.items():
            if p != period:
                continue
            entry = catalog.get((provider, model)) if provider and model else None
            spend = entry.cost(tin, tout) if entry is not None else 0.0
            for bucket, key in ((None, None), ("by_task", task), ("by_provider", provider),
                                ("by_model", model_target(provider, model) if provider and model else None),
                                ("by_user", user)):
                if bucket is None:
                    slot = out["total"]
                elif not key:
                    continue
                else:
                    slot = out[bucket].setdefault(key, _tally())
                slot["calls"] += calls
                slot["tokens"] += tin + tout
                slot["spend"] += spend
        return out


def _tally() -> dict:
    return {"calls": 0, "tokens": 0, "spend": 0.0}


@dataclass
class _Noted:
    """One attempt counted in-process, until a read of ai_traces includes it."""
    task: str | None
    provider: str | None
    calls: int
    tokens: int
    written_at: float | None = None   # time.monotonic() once its log row was written
    model: str | None = None
    user: str | None = None
    tokens_out: int = 0

    def written(self) -> None:
        self.written_at = time.monotonic()


_usage_day: date | None = None
_usage_base = _Usage()          # usage as last read from ai_traces
_usage_local: list[_Noted] = []  # attempts the last read may not include
_usage_expires = 0.0


def _roll_usage_day(day: date) -> None:
    global _usage_day, _usage_base, _usage_local, _usage_expires
    if day != _usage_day:
        _usage_day, _usage_base, _usage_local, _usage_expires = day, _Usage(), [], 0.0


def note_usage(task: str | None, provider: str | None, tokens: int, ok: bool, *,
               calls: int = 1, model: str | None = None, user: str | None = None,
               tokens_in: int | None = None, tokens_out: int | None = None) -> Callable[[], None]:
    """
    Count an attempt locally until a read of ai_traces includes it.

    The log row is written fire-and-forget and the read is cached for 5 s, so
    without this a burst of calls could sail past a cap before the first of
    them showed up in the count. Failed attempts count as calls as well: the
    provider still served them. `calls` is the number of provider requests
    the attempt sent (retries included). `tokens_in`/`tokens_out` split
    `tokens` for spend; without them every token counts as a prompt token.

    Returns the callback to run once the attempt's log row is written: until
    then no read can be sure to include it, so it stays counted here.
    """
    _roll_usage_day(today_ist())

    def count(value) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    if tokens_in is None and tokens_out is None:
        tin, tout = count(tokens), 0
    else:
        tin, tout = count(tokens_in), count(tokens_out)
    if user is None:
        user = ai_usage.current().user_id
    noted = _Noted(task, provider, max(0, int(calls)), tin, model=model, user=user, tokens_out=tout)
    _usage_local.append(noted)
    return noted.written


def _local_usage() -> _Usage:
    out = _Usage()
    for n in _usage_local:
        out.add(PERIODS, n.task, n.provider, n.model, n.user, n.calls, n.tokens, n.tokens_out)
    return out


async def _current_usage() -> _Usage:
    day = today_ist()
    _roll_usage_day(day)
    if time.monotonic() >= _usage_expires:
        await _single_flight("usage", lambda: _refresh_usage(day))
    if _usage_day != day:
        return _Usage()
    return _usage_base.plus(_local_usage())


async def usage_today() -> dict:
    """Provider calls (ok + failed) and tokens since midnight IST:
    {"calls", "tokens", "by_task": {task: {"calls", "tokens"}}, "by_provider": {...}}."""
    view = (await _current_usage()).view("day")

    def strip(slot: dict) -> dict:
        return {"calls": slot["calls"], "tokens": slot["tokens"]}

    return {"calls": view["total"]["calls"], "tokens": view["total"]["tokens"],
            "by_task": {k: strip(v) for k, v in view["by_task"].items()},
            "by_provider": {k: strip(v) for k, v in view["by_provider"].items()},
            "by_model": {k: strip(v) for k, v in view["by_model"].items()}}


async def usage_views(cfg: GatewayConfig | None = None) -> dict:
    """{period: view} for today, this week and this month (see _Usage.view)."""
    cfg = cfg or await get_config()
    usage = await _current_usage()
    return {period: usage.view(period, cfg) for period in PERIODS}


async def _refresh_usage(day: date) -> bool:
    global _usage_base, _usage_local, _usage_expires
    rows = None
    pool = get_pool()
    started = time.monotonic()
    if pool is not None:
        try:
            since = min(period_start("week", day), period_start("month", day))
            rows = await pool.fetch(_SQL_USAGE, since, period_start("day", day),
                                    period_start("week", day), period_start("month", day))
        except Exception as exc:
            logger.debug("AI gateway usage read failed: %s", exc)
    if _usage_day != day:
        return True
    if rows is not None:
        base = _Usage()
        for r in rows:
            r = dict(r)
            periods = [p for p in PERIODS if r.get(f"in_{p}", True) is not False]
            tin = r.get("tokens_in")
            if tin is None:
                tin = r.get("tokens")
            base.add(periods, r.get("task"), r.get("provider"), r.get("model"), r.get("user_id"),
                     int(r.get("calls") or 0), int(tin or 0), int(r.get("tokens_out") or 0))
        _usage_base = base
        # A row written before the read began is in it. One written since, or
        # not yet (its INSERT is still queued, or failed), stays counted here.
        _usage_local = [n for n in _usage_local if n.written_at is None or n.written_at >= started]
    _usage_expires = time.monotonic() + _USAGE_TTL_S
    return True


# ── Limits ────────────────────────────────────────────────────────────

_PERIOD_WORD = {"day": "daily", "week": "weekly", "month": "monthly"}
_METRIC_WORD = {"requests": "request", "tokens": "token", "spend": "spend"}
_RESETS = {"day": "It resets at midnight IST.",
           "week": "It resets on Monday at midnight IST.",
           "month": "It resets on the 1st at midnight IST."}
_PERIOD_LEAD = {"day": "Today's", "week": "This week's", "month": "This month's"}


def used_of(slot: dict | None, metric: str) -> float:
    if not slot:
        return 0
    return slot.get("spend", 0.0) if metric == "spend" else slot.get("calls" if metric == "requests" else "tokens", 0)


def _slot(views: dict, period: str, scope: str, target: str) -> dict | None:
    view = views.get(period) or {}
    if scope == "global":
        return view.get("total")
    return (view.get(f"by_{scope}") or {}).get(target)


def first_over(limits, views: dict, *, target: str | None = None) -> Limit | None:
    """The first limit in `limits` that its usage has reached. `target`
    replaces each limit's own (a per-user limit '*' is checked against one user)."""
    for lim in limits:
        slot = _slot(views, lim.period, lim.scope, target if target is not None else lim.target)
        if used_of(slot, lim.metric) >= lim.cap:
            return lim
    return None


def limit_reason(lim: Limit) -> str:
    """'weekly token limit reached' — for a skipped step."""
    what = {"provider": "provider", "model": "model"}.get(lim.scope, lim.scope)
    return f"{what} {_PERIOD_WORD[lim.period]} {_METRIC_WORD[lim.metric]} limit reached"


def _limit_message(lim: Limit, who: str) -> str:
    return f"{_PERIOD_LEAD[lim.period]} AI limit for {who} has been reached. {_RESETS[lim.period]}"


def _user_limits(cfg: GatewayConfig, user: str | None) -> list[Limit]:
    if not user:
        return []
    return cfg.limits_for("user", user) + cfg.limits_for("user", EVERY_USER)


def step_block(cfg: GatewayConfig, views: dict | None, provider: str, model: str) -> str | None:
    """Why a provider or model limit stops a step, or None."""
    if views is None:
        return None
    for scope, target in (("provider", provider), ("model", model_target(provider, model))):
        lim = first_over(cfg.limits_for(scope, target), views)
        if lim is not None:
            return limit_reason(lim)
    return None


def _step_limited(cfg: GatewayConfig, provider: str, model: str | None = None) -> bool:
    if cfg.limits_for("provider", provider):
        return True
    return model is not None and bool(cfg.limits_for("model", model_target(provider, model)))


async def step_blocked(provider: str, model: str) -> str | None:
    """Why the provider's or the model's limits stop a step right now, or None."""
    cfg = await get_config()
    if not _step_limited(cfg, provider, model):
        return None
    return step_block(cfg, await usage_views(cfg), provider, model)


# ── Circuit breaker ───────────────────────────────────────────────────
# In-process, per worker: a bench is a short-lived protective measure, and
# each worker learns of a failing provider on its own first few calls.

_breaker: dict[str, dict] = {}


def _clock() -> float:
    return time.time()


def _bench_key(provider: str, model: str | None = None) -> str:
    return f"m:{model_target(provider, model)}" if model is not None else f"p:{provider}"


def breaker_note(provider: str, model: str, *, ok: bool, provider_fault: bool = False,
                 error: str | None = None, cfg: GatewayConfig | None = None) -> None:
    """Count one attempt's outcome. Success clears both the model and its
    provider; a failure counts against the model, and against the provider
    too when the fault is the provider's (network, 5xx, key rejected)."""
    cfg = cfg or _config
    settings_ = cfg.breaker if cfg is not None else {"failures": BREAKER_FAILURES, "minutes": BREAKER_MINUTES}
    if settings_["minutes"] <= 0:
        return
    keys = [_bench_key(provider, model)]
    if ok or provider_fault:
        keys.append(_bench_key(provider))
    now = _clock()
    for key in keys:
        if ok:
            _breaker.pop(key, None)
            continue
        entry = _breaker.setdefault(key, {"failures": 0, "until": 0.0, "since": now, "error": None})
        entry["failures"] += 1
        entry["error"] = (error or "")[:160] or None
        if entry["failures"] >= settings_["failures"]:
            if entry["until"] <= now:
                entry["since"] = now
            entry["until"] = now + settings_["minutes"] * 60


def bench_reason(provider: str, model: str | None = None) -> str | None:
    """Why a provider or model is benched right now, or None. Once the bench
    runs out it is tried again; one more failure benches it again at once."""
    now = _clock()
    for key, what in ((_bench_key(provider), "provider"),
                      (_bench_key(provider, model) if model is not None else None, "model")):
        entry = _breaker.get(key) if key else None
        if entry and entry["until"] > now:
            minutes = max(1, int((entry["until"] - now + 59) // 60))
            return (f"{what} benched for {minutes} more min after "
                    f"{entry['failures']} failures in a row")
    return None


def bench_list() -> list[dict]:
    """Every provider and model on the bench now, soonest back first."""
    now = _clock()
    out = []
    for key, entry in _breaker.items():
        if entry["until"] <= now:
            continue
        kind, _, rest = key.partition(":")
        provider, _, model = rest.partition("|")
        out.append({
            "target": key, "kind": "provider" if kind == "p" else "model",
            "provider": provider, "model": model or None,
            "failures": entry["failures"], "last_error": entry["error"],
            "since": datetime.fromtimestamp(entry["since"], timezone.utc).isoformat(),
            "until": datetime.fromtimestamp(entry["until"], timezone.utc).isoformat(),
        })
    out.sort(key=lambda e: e["until"])
    return out


def reset_bench(target: str | None = None) -> int:
    """Take one provider or model ('p:groq', 'm:groq|model') off the bench,
    or every one. Returns how many were cleared."""
    if target is None:
        n = len(_breaker)
        _breaker.clear()
        return n
    return 1 if _breaker.pop(target, None) is not None else 0


# ── Admission and routing ─────────────────────────────────────────────

_WORKSPACE = "the workspace"


def no_provider_message(task: str) -> str:
    return (f"No AI provider is available for {task_label(task)}. "
            "An administrator can check Admin → AI gateway.")


def refuse(task: str, reason: str) -> NoReturn:
    """Log a not_sent call and raise GatewayRefused with the reason."""
    ai_usage.record_not_sent(task, reason)
    raise GatewayRefused(reason)


def effective_route(cfg: GatewayConfig, task: str) -> list[dict]:
    """The steps `task` tries, in order: its own chain, then the global
    default chain's steps it does not already have (unless switched off)."""
    state = cfg.tasks.get(task)
    own = state.route if state else [dict(s) for s in cfg.default_route]
    out = [dict(s) for s in own]
    if state is None or state.fallback_to_default:
        seen = {(s["provider"], s["model"]) for s in out}
        for s in cfg.default_route:
            if (s["provider"], s["model"]) not in seen:
                seen.add((s["provider"], s["model"]))
                out.append({**s, "fallback": True})
    return out


def _route_of(cfg: GatewayConfig, task: str) -> list[dict]:
    return effective_route(cfg, task)


async def _has_capacity(p: ProviderState, cfg: GatewayConfig | None = None) -> bool:
    cfg = cfg or await get_config()
    limits = cfg.limits_for("provider", p.key)
    if not limits:
        return True
    return first_over(limits, await usage_views(cfg)) is None


async def provider_has_capacity(provider_key: str) -> bool:
    """False once any of the provider's limits is reached."""
    cfg = await get_config()
    p = cfg.providers.get(provider_key)
    return p is not None and await _has_capacity(p, cfg)


def step_problem(cfg: GatewayConfig, p: ProviderState | None, model: str) -> str | None:
    """Why a step can't be sent at all, limits aside."""
    if p is None:
        return "unknown provider"
    if not p.enabled:
        return "provider off"
    if not p.api_key:
        return "no key"
    entry = cfg.entry(p.key, model)
    if entry is not None and not entry.enabled:
        return "model switched off"
    return None


async def admit(task: str, *, bypass_enabled: bool = False) -> None:
    """
    Decide whether a call for `task` may go ahead, before any provider is
    contacted. A refusal is logged as a not_sent row and raised as
    GatewayRefused. Order: task switched off, workspace limits, task limits,
    the user's limits (each day, then week, then month), then whether any step
    of the chain can be tried at all. `bypass_enabled` is for the admin Test
    button only.
    """
    cfg = await get_config()
    label = task_label(task)
    state = cfg.tasks.get(task)
    if state is not None and not state.enabled and not bypass_enabled:
        refuse(task, f"AI for {label} is switched off by the administrator.")

    user = ai_usage.current().user_id
    checks = [(cfg.limits_for("global", ""), _WORKSPACE, None),
              (cfg.limits_for("task", task), label, None),
              (_user_limits(cfg, user), "your account", user)]
    views = None
    if any(limits for limits, _, _ in checks):
        views = await usage_views(cfg)
        for limits, who, target in checks:
            lim = first_over(limits, views, target=target)
            if lim is not None:
                refuse(task, _limit_message(lim, who))

    for step in _route_of(cfg, task):
        p = cfg.providers.get(step["provider"])
        if step_problem(cfg, p, step["model"]) is not None:
            continue
        if step.get("skip_over_limit", True) and _step_limited(cfg, p.key, step["model"]):
            if views is None:
                views = await usage_views(cfg)
            if step_block(cfg, views, p.key, step["model"]):
                continue
        return
    refuse(task, no_provider_message(task))


_VISION_HINTS = ("vision", "scout", "maverick", "gemma-3", "gemma-4", "llava", "-vl", "omni",
                 "gpt-4o", "gpt-4.1", "gemini", "claude", "pixtral", "grok-2-vision")


def _vision_hint(model: str) -> bool:
    low = model.lower()
    return any(h in low for h in _VISION_HINTS)


def is_vision_model(p: ProviderState, model: str, entry: ModelEntry | None = None) -> bool:
    """What the catalogue says, else the provider's model list, else a guess from the id."""
    if entry is not None and entry.vision is not None:
        return entry.vision
    for m in p.models:
        if m.get("id") == model and m.get("vision") is not None:
            return bool(m["vision"])
    return _vision_hint(model)


async def route_specs(task: str, *, vision: bool = False) -> list[RouteStep]:
    """
    The steps to try for `task`, in order. Every step whose provider is known
    is returned, ready or not, so the caller can name the skipped ones in its
    error. With `vision`, steps known to read images go first; the rest still
    follow in their own order. A step on the circuit breaker's bench moves to
    the end: it is still tried when nothing before it answers.
    """
    cfg = await get_config()
    steps = []
    for s in _route_of(cfg, task):
        p = cfg.providers.get(s["provider"])
        if p is None:
            continue
        steps.append((p, s, cfg.entry(p.key, s["model"])))
    if vision:
        steps = ([x for x in steps if is_vision_model(x[0], x[1]["model"], x[2])]
                 + [x for x in steps if not is_vision_model(x[0], x[1]["model"], x[2])])
    benched = {i: bench_reason(p.key, s["model"]) for i, (p, s, _) in enumerate(steps)}
    order = [i for i in range(len(steps)) if not benched[i]] + [i for i in range(len(steps)) if benched[i]]
    out = []
    for attempt, i in enumerate(order, 1):
        p, s, entry = steps[i]
        out.append(RouteStep(provider=p, model=s["model"], attempt=attempt,
                             timeout_s=s.get("timeout_s"), skip_over_limit=s.get("skip_over_limit", True),
                             fallback=bool(s.get("fallback")), benched=benched[i], entry=entry))
    return out


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
_MODELS_API_VERSION = "2023-06-01"


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
    # The provider's extra headers go first, so none of them can replace the
    # key or the content type (validation refuses those names as well).
    headers = dict(p.extra_headers or {})
    headers["Authorization"] = f"Bearer {p.api_key or ''}"
    headers["Content-Type"] = "application/json"
    # HTTP-Referer/X-Title is an OpenRouter attribution convention.
    if p.flavor == "openrouter":
        headers["HTTP-Referer"] = _referer()
        headers["X-Title"] = "FinTrack AI"
    # This host's native endpoints (the model list among them) read the key
    # from x-api-key and want an API version; its OpenAI-compatible chat
    # endpoint takes the bearer.
    if p.host == "api.anthropic.com":
        headers["x-api-key"] = p.api_key or ""
        headers["anthropic-version"] = _MODELS_API_VERSION
    return headers


def timeout_for(p: ProviderState, left: float | None = None) -> httpx.Timeout:
    """The provider's request timeout, cut to `left` seconds when the caller
    has less time than that."""
    read = float(p.timeout_s) if left is None else max(1.0, min(float(p.timeout_s), left))
    return httpx.Timeout(read, connect=min(CONNECT_TIMEOUT_S, read))


def with_step_timeout(p: ProviderState, timeout_s: int | None) -> ProviderState:
    """The provider as one step calls it: its timeout replaced by the step's own."""
    return replace(p, timeout_s=timeout_s) if timeout_s else p


async def provider_key(provider_key: str) -> str | None:
    """The key a ready provider calls with (stored, else env). For embeddings."""
    p = (await get_config()).providers.get(provider_key)
    return p.api_key if p is not None and p.ready else None


async def any_provider_ready() -> bool:
    return any(p.ready for p in (await get_config()).providers.values())


_NON_CHAT = ("whisper", "tts", "playai", "guard", "embed", "orpheus", "moderation", "dall-e",
             "image-gen", "imagen", "transcribe", "audio")


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


def _per_million(value: Any) -> float | None:
    """A per-token price string ('0.0000025') as USD per 1M tokens."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return round(n * 1_000_000, 4) if n >= 0 else None


def parse_models(provider_key: str, payload: Any) -> list[dict]:
    """
    A provider's /models answer as [{"id", "context", "vision", "free"}]
    (plus "max_output", "input_cost_per_m", "output_cost_per_m" and "label"
    where the provider reports them).

    Speech, moderation and embedding models are dropped, as are ids a route
    could not be saved with. `vision` comes from input modalities where the
    provider lists them, else a guess from the id or None. `free` is None for
    a provider without per-model pricing. Free models sort first, then by id.
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
        pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else None
        if provider_key == "openrouter" or pricing is not None:
            pricing = pricing or {}
            free = (mid.endswith(":free") or mid == "openrouter/free"
                    or (_is_zero(pricing.get("prompt")) and _is_zero(pricing.get("completion"))))
        else:
            free = None
        out = {
            "id": mid,
            "context": (_positive_int(item.get("context_length")) or _positive_int(item.get("context_window"))
                        or _positive_int(item.get("max_input_tokens"))),
            "vision": vision,
            "free": free,
        }
        top = item.get("top_provider") if isinstance(item.get("top_provider"), dict) else {}
        max_output = _positive_int(top.get("max_completion_tokens")) or _positive_int(item.get("max_tokens")) \
            or _positive_int(item.get("max_completion_tokens"))
        if max_output:
            out["max_output"] = max_output
        if pricing:
            for src, dst in (("prompt", "input_cost_per_m"), ("completion", "output_cost_per_m")):
                price = _per_million(pricing.get(src))
                if price is not None:
                    out[dst] = price
        label = item.get("name") or item.get("display_name")
        if isinstance(label, str) and label.strip():
            out["label"] = label.strip()[:80]
        found[mid] = out
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
    return parse_models("openrouter" if p.flavor == "openrouter" else p.key, payload)


async def _resolve(host: str) -> list[str]:
    """The addresses `host` resolves to (empty when it does not resolve)."""
    loop = asyncio.get_running_loop()
    try:
        infos = await asyncio.wait_for(loop.getaddrinfo(host, 443, type=0), timeout=3.0)
    except Exception:
        return []
    return sorted({info[4][0] for info in infos})


def _private_address(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])
    except ValueError:
        return True
    return not ip.is_global or ip.is_multicast


def _trusted_host(host: str) -> bool:
    """A preset's own host: known public APIs, not resolved again."""
    return any(host == _host(d.default_base_url) for d in PRESETS.values())


async def check_public_host(url: str) -> None:
    """Refuse a base URL whose host resolves to a private, loopback or
    link-local address: requests to it carry the provider key, and the
    syntax check alone cannot see where a public-looking name points."""
    host = _host(url)
    if not host or _trusted_host(host):
        return
    if any(_private_address(a) for a in await _resolve(host)):
        raise ValueError(f"{host} resolves to a private network address; the base URL must be a public API.")


async def test_provider(provider_key: str, actor_email: str | None) -> dict:
    """
    Check a provider's key by listing its models, and keep the list: the
    model catalogue offers it and route_warnings checks routes against it.
    Not a model call, so it is neither limited nor written to the call log.
    """
    p = (await get_config()).providers.get(provider_key)
    if p is None:
        raise KeyError(provider_key)
    models: list[dict] | None = None
    error: str | None = None
    ms = 0
    if not p.api_key:
        error = missing_key_message(p)
    else:
        started = time.monotonic()
        try:
            await check_public_host(p.base_url)
            models = await list_models(p)
        except ValueError as exc:
            error = str(exc)
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
    if pdef is None or not p.env_var:
        return "No key set"
    if _host(p.base_url) != _host(pdef.default_base_url):
        return f"No key saved for this base URL ({p.env_var} is only sent to {_host(pdef.default_base_url)})"
    return f"No key set ({p.env_var})"


def route_warnings(task_state: TaskState, cfg: GatewayConfig, route: list[dict] | None = None) -> list[dict]:
    """Problems with a chain, per step (0-based index)."""
    out: list[dict] = []
    for i, step in enumerate(task_state.route if route is None else route):
        p = cfg.providers.get(step.get("provider"))
        if p is None:
            out.append({"index": i, "level": "error",
                        "message": f"Unknown provider {step.get('provider')}"})
            continue
        if not p.api_key:
            out.append({"index": i, "level": "error", "message": missing_key_message(p)})
        if not p.enabled:
            out.append({"index": i, "level": "warn", "message": "Provider is off"})
        entry = cfg.entry(p.key, step.get("model"))
        if entry is not None and not entry.enabled:
            out.append({"index": i, "level": "warn", "message": "Model is switched off in the catalogue"})
        if (p.last_test and p.last_test.get("ok") and p.models
                and step.get("model") not in {m["id"] for m in p.models}):
            out.append({"index": i, "level": "error",
                        "message": f"Not offered by {p.label} — calls to it will fail"})
        benched = bench_reason(p.key, step.get("model"))
        if benched:
            out.append({"index": i, "level": "warn", "message": benched[0].upper() + benched[1:]})
    return out


def explain_failure(error: str | None, http_status: int | None = None, status: str | None = None) -> str | None:
    """Why a call failed, in plain words for the call log."""
    if status == "ok" or (not error and not http_status):
        return None
    text = (error or "").lower()
    if status == "not_sent":
        if "switched off" in text:
            return "Not sent: the task is switched off in the AI gateway."
        if "limit" in text:
            return "Not sent: a usage limit was reached. It lifts when the period resets, or when the limit is raised."
        if "no ai provider" in text:
            return "Not sent: no provider in the chain is on with a usable key."
        return "Not sent: the gateway refused the call before contacting a provider."
    if http_status == 401 or "key rejected" in text:
        return "The provider rejected the API key. Set a new key under Providers."
    if http_status in (402, 403) or "quota" in text:
        return "The provider account is out of credit or lacks permission for this model."
    if http_status == 404 or "not found" in text or "does not exist" in text:
        return "The provider doesn't offer this model id. Check the id in the catalogue or the chain."
    if http_status == 413 or "too large" in text or "per-request" in text or "context length" in text:
        return "The request was larger than the model accepts. Set the model's per-request token limit so it is sized first."
    if http_status == 429 or "rate" in text:
        return "Rate-limited by the provider: too many requests or tokens for this minute. The next step was tried."
    if "benched" in text:
        return "Skipped: it failed repeatedly and is on the circuit breaker's bench for a few minutes."
    if "limit reached" in text:
        return "Skipped: its provider or model limit was reached, so the chain moved on."
    if "timeout" in text or "no response" in text or "out of time" in text:
        return "The model took too long to answer, so the chain moved on."
    if "network" in text or "could not reach" in text:
        return "The provider could not be reached (network or DNS)."
    if http_status and http_status >= 500:
        return "The provider had a server error. The next step was tried."
    if "empty" in text or "no extractable" in text or "no usable" in text:
        return "The model answered, but with nothing usable."
    if http_status and 400 <= http_status < 500:
        return "The provider refused the request as invalid for this model."
    return "The attempt failed; see the error for details."



# ── Writes ────────────────────────────────────────────────────────────
# Each helper validates (ValueError on bad input, KeyError on an unknown key),
# writes, then invalidates the cache. A missing table or column, or no
# database at all, raises StorageNotReady.

async def _write(op: Callable[[Any], Awaitable[Any]], message: str = STORAGE_NOT_READY) -> Any:
    pool = get_pool()
    if pool is None:
        raise StorageNotReady(message)
    try:
        result = await op(pool)
    except Exception as exc:
        if _schema_missing(exc):
            raise StorageNotReady(message) from exc
        raise
    invalidate()
    return result


async def _config_v2() -> GatewayConfig:
    """Fresh settings, for a write that needs migration 0008."""
    cfg = await get_config(force=True)
    if not cfg.storage_ok or not cfg.v2:
        raise StorageNotReady(STORAGE_NOT_READY_V2 if cfg.storage_ok else STORAGE_NOT_READY)
    return cfg


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


_HEADER_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,63}")
_HEADER_VALUE_RE = re.compile(r"[\x20-\x7e]{0,500}")
# Extra headers are shown back in the admin panel, so they must never carry
# a secret: names that usually do are refused (the API key has its own,
# encrypted, write-only field). Transport headers are the HTTP client's.
_SECRET_HEADER_RE = re.compile(r"(?i)auth|key|token|secret|cookie|password|session|signature")
_RESERVED_HEADERS = {"host", "content-length", "content-type", "transfer-encoding", "connection", "te",
                     "upgrade", "keep-alive", "expect", "proxy-connection", "http-referer", "x-title",
                     "anthropic-version"}


def _header_ok(name: Any, value: Any) -> bool:
    return (isinstance(name, str) and isinstance(value, str) and bool(_HEADER_NAME_RE.fullmatch(name))
            and bool(_HEADER_VALUE_RE.fullmatch(value)) and not _SECRET_HEADER_RE.search(name)
            and name.lower() not in _RESERVED_HEADERS)


def validate_extra_headers(value: Any) -> dict:
    """Up to 10 extra request headers, as {name: value}. None = none."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("extra_headers must be an object of header names and values.")
    if len(value) > MAX_EXTRA_HEADERS:
        raise ValueError(f"At most {MAX_EXTRA_HEADERS} extra headers.")
    out: dict = {}
    for name, val in value.items():
        if not isinstance(name, str) or not _HEADER_NAME_RE.fullmatch(name):
            raise ValueError("A header name is letters, digits and hyphens, up to 64 characters.")
        if _SECRET_HEADER_RE.search(name):
            raise ValueError(f"Header {name} looks like it carries a secret. Put the API key in the key field, "
                             "which is stored encrypted; extra headers are shown in the admin panel.")
        if name.lower() in _RESERVED_HEADERS:
            raise ValueError(f"Header {name} is set by the gateway itself.")
        if not isinstance(val, str) or not _HEADER_VALUE_RE.fullmatch(val):
            raise ValueError(f"The value of {name} must be printable text of at most 500 characters.")
        if name.lower() in {k.lower() for k in out}:
            raise ValueError(f"Header {name} is listed twice.")
        out[name] = val
    return out


def validate_label(value: Any, name: str = "label", maximum: int = 60) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not text or len(text) > maximum or any(ord(c) < 32 for c in text):
        raise ValueError(f"{name} must be 1 to {maximum} characters of text.")
    return text


def _known_providers() -> set[str]:
    return set(_config.providers) if _config is not None and _config.storage_ok else set(PROVIDERS)


def validate_route(route: Any, known: set[str] | None = None) -> list[dict]:
    known = known if known is not None else _known_providers()
    if not isinstance(route, list) or not 1 <= len(route) <= MAX_ROUTE_STEPS:
        raise ValueError(f"A route needs 1 to {MAX_ROUTE_STEPS} steps.")
    out = []
    seen = set()
    for i, step in enumerate(route, 1):
        if hasattr(step, "model_dump"):
            step = step.model_dump(exclude_none=True)
        if not isinstance(step, dict):
            raise ValueError(f"Step {i} needs a provider and a model.")
        provider, model = step.get("provider"), step.get("model")
        if provider not in known:
            raise ValueError(f"Step {i}: unknown provider {str(provider)[:20]!r}.")
        model = model.strip() if isinstance(model, str) else ""
        if not MODEL_ID_RE.match(model):
            raise ValueError(f"Step {i}: a model id is 1 to 120 letters, digits or . _ : / @ + -")
        if (provider, model) in seen:
            raise ValueError(f"Step {i}: {model} on that provider is already in the chain.")
        seen.add((provider, model))
        timeout = step.get("timeout_s")
        if timeout is not None and (isinstance(timeout, bool) or not isinstance(timeout, int)
                                    or not TIMEOUT_MIN_S <= timeout <= TIMEOUT_MAX_S):
            raise ValueError(f"Step {i}: the timeout must be {TIMEOUT_MIN_S} to {TIMEOUT_MAX_S} seconds.")
        skip = step.get("skip_over_limit", True)
        if not isinstance(skip, bool):
            raise ValueError(f"Step {i}: skip_over_limit must be true or false.")
        out.append(_step_options({"provider": provider, "model": model},
                                 {"timeout_s": timeout, "skip_over_limit": skip}))
    return out


_PROVIDER_FIELDS = ("enabled", "base_url", "timeout_s", "daily_request_cap", "daily_token_cap",
                    "label", "extra_headers")
_TASK_FIELDS = ("enabled", "route", "daily_cap", "fallback_to_default")
_GLOBAL_FIELDS = ("daily_call_cap", "daily_token_cap")


def _timeout_input(t: Any) -> int | None:
    if t is not None and (isinstance(t, bool) or not isinstance(t, int)
                          or not TIMEOUT_MIN_S <= t <= TIMEOUT_MAX_S):
        raise ValueError(f"timeout_s must be {TIMEOUT_MIN_S} to {TIMEOUT_MAX_S} seconds.")
    return t


def validate_provider_patch(patch: dict) -> dict:
    _unknown_fields(patch, _PROVIDER_FIELDS)
    out: dict = {}
    if "enabled" in patch:
        out["enabled"] = _bool_input(patch["enabled"], "enabled")
    if "base_url" in patch:
        out["base_url"] = validate_base_url(patch["base_url"])
    if "timeout_s" in patch:
        out["timeout_s"] = _timeout_input(patch["timeout_s"])
    if "daily_request_cap" in patch:
        out["daily_request_cap"] = _cap_input(patch["daily_request_cap"], "daily_request_cap", _MAX_CALL_CAP)
    if "daily_token_cap" in patch:
        out["daily_token_cap"] = _cap_input(patch["daily_token_cap"], "daily_token_cap", _MAX_TOKEN_CAP)
    if "label" in patch:
        out["label"] = validate_label(patch["label"])
    if "extra_headers" in patch:
        out["extra_headers"] = validate_extra_headers(patch["extra_headers"])
    return out


def validate_task_patch(patch: dict, known: set[str] | None = None) -> dict:
    _unknown_fields(patch, _TASK_FIELDS)
    out: dict = {}
    if "enabled" in patch:
        out["enabled"] = _bool_input(patch["enabled"], "enabled")
    if "route" in patch:
        out["route"] = None if patch["route"] is None else validate_route(patch["route"], known)
    if "daily_cap" in patch:
        out["daily_cap"] = _cap_input(patch["daily_cap"], "daily_cap", _MAX_CALL_CAP)
    if "fallback_to_default" in patch:
        out["fallback_to_default"] = _bool_input(patch["fallback_to_default"], "fallback_to_default")
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


def _pdef_of(p: ProviderState) -> ProviderDef:
    return PROVIDERS.get(p.key) or ProviderDef(p.key, p.label, p.default_base_url, None, "", p.default_timeout_s)


async def _provider(key: str, *, fresh: bool = True) -> tuple[GatewayConfig, ProviderState]:
    cfg = await get_config(force=fresh)
    p = cfg.providers.get(key)
    if p is None:
        raise KeyError(key)
    return cfg, p


async def save_provider(key: str, patch: dict, actor_email: str | None) -> bool:
    """
    Save provider settings. A stored key belongs to the host it was entered
    for: a base URL on another host drops it (with the model list and the last
    test, which described the old host), so the new host needs its own key.
    Returns True when a stored key was dropped.
    """
    values = validate_provider_patch(patch)
    cfg, p = await _provider(key)
    if not values:
        return False
    caps = {m: values.pop(name) for name, m in (("daily_request_cap", "requests"), ("daily_token_cap", "tokens"))
            if name in values}
    if caps and cfg.v2:
        await _set_day_caps("provider", key, caps, actor_email)
    elif caps:
        values.update({("daily_request_cap" if m == "requests" else "daily_token_cap"): v for m, v in caps.items()})
    if ("label" in values or "extra_headers" in values) and not cfg.v2:
        raise StorageNotReady(STORAGE_NOT_READY_V2)
    if "extra_headers" in values:
        values["extra_headers"] = json.dumps(values["extra_headers"])
    if not values:
        return False
    pdef = _pdef_of(p)
    sql = _upsert_sql("ai_gateway_providers", list(values), {"extra_headers": "::jsonb"})
    if "base_url" not in values:
        await _write(lambda pool: pool.execute(sql, key, *values.values(), actor_email))
        return False
    new_url = values["base_url"] or pdef.default_base_url
    new_host = _host(new_url)
    if new_host != p.host:
        await check_public_host(new_url)

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


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    if not slug or not slug[0].isalpha():
        slug = f"p-{slug}".strip("-")
    return slug[:20].rstrip("-")


async def create_provider(spec: dict, actor_email: str | None) -> str:
    """
    Add a provider from a preset or as a custom OpenAI-compatible API.
    Returns its key. A removed built-in comes back when it is added again.
    """
    _unknown_fields(spec, ("preset", "key", "label", "base_url", "extra_headers", "timeout_s",
                           "enabled", "api_key"))
    cfg = await _config_v2()
    preset_name = spec.get("preset")
    preset = None
    if preset_name is not None:
        if preset_name not in PRESETS:
            raise ValueError("Unknown provider preset.")
        preset = PRESETS[preset_name]
    label = validate_label(spec["label"]) if spec.get("label") is not None else (preset.label if preset else None)
    if label is None:
        raise ValueError("A custom provider needs a name.")
    key = spec.get("key")
    if key is None:
        # A second account of the same preset (or a name already taken) gets
        # the next free id: mistral, mistral-2, …
        base = preset.key if preset and (preset.key not in PROVIDERS or preset.key in cfg.removed) else _slug(label)
        key, n = base, 1
        while key in cfg.providers or (key in PROVIDERS and key not in cfg.removed):
            n += 1
            key = f"{base[:17]}-{n}"
    if not isinstance(key, str) or not PROVIDER_KEY_RE.match(key):
        raise ValueError("A provider id is 2 to 20 lowercase letters, digits or hyphens, starting with a letter.")
    if key in cfg.providers:
        raise ValueError(f"A provider with the id {key} already exists. Choose another id.")
    if key in PROVIDERS and preset_name not in (None, key):
        raise ValueError(f"The id {key} belongs to the built-in {PROVIDERS[key].label} provider.")
    if len(cfg.providers) >= MAX_PROVIDERS:
        raise ValueError(f"At most {MAX_PROVIDERS} providers.")
    builtin = PROVIDERS.get(key)
    default_url = (builtin or preset).default_base_url if (builtin or preset) else None
    base_url = validate_base_url(spec.get("base_url")) or default_url
    if not base_url:
        raise ValueError("A custom provider needs its base URL, e.g. https://api.example.com/v1.")
    headers = validate_extra_headers(spec.get("extra_headers"))
    timeout = _timeout_input(spec.get("timeout_s"))
    enabled = _bool_input(spec.get("enabled", True), "enabled")
    api_key = validate_api_key(spec["api_key"]) if spec.get("api_key") else None
    await check_public_host(base_url)
    position = max((p.position for p in cfg.providers.values()), default=0) + 1
    enc, hint = (encrypt_key(api_key), api_key[-4:]) if api_key else (None, None)

    async def op(pool) -> str:
        async with pool.acquire() as conn:
            async with conn.transaction():
                done = await conn.fetchval(
                    """
                    INSERT INTO ai_gateway_providers
                      (key, label, preset, base_url, default_base_url, extra_headers, timeout_s, enabled,
                       position, deleted, api_key_enc, key_hint, key_set_by, key_set_at,
                       models, last_test_at, last_test_ok, last_test_ms, last_test_error,
                       created_by, created_at, updated_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, FALSE, $10, $11,
                            CASE WHEN $10::text IS NULL THEN NULL ELSE $12 END,
                            CASE WHEN $10::text IS NULL THEN NULL ELSE NOW() END,
                            NULL, NULL, NULL, NULL, NULL, $12, NOW(), $12, NOW())
                    ON CONFLICT (key) DO UPDATE SET
                      label = EXCLUDED.label, preset = EXCLUDED.preset, base_url = EXCLUDED.base_url,
                      default_base_url = EXCLUDED.default_base_url, extra_headers = EXCLUDED.extra_headers,
                      timeout_s = EXCLUDED.timeout_s, enabled = EXCLUDED.enabled, position = EXCLUDED.position,
                      deleted = FALSE, api_key_enc = EXCLUDED.api_key_enc, key_hint = EXCLUDED.key_hint,
                      key_set_by = EXCLUDED.key_set_by, key_set_at = EXCLUDED.key_set_at,
                      models = NULL, last_test_at = NULL, last_test_ok = NULL, last_test_ms = NULL,
                      last_test_error = NULL, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                    WHERE ai_gateway_providers.deleted
                    RETURNING key
                    """,
                    key, label, preset.key if preset else None,
                    None if builtin and base_url == builtin.default_base_url else base_url,
                    default_url or base_url, json.dumps(headers), timeout, enabled, position,
                    enc, hint, actor_email,
                )
                if done is None:
                    raise ValueError(f"A provider with the id {key} already exists. Choose another id.")
                return key

    return await _write(op, STORAGE_NOT_READY_V2)


async def delete_provider(key: str, actor_email: str | None) -> list[str]:
    """
    Remove a provider with its key, model catalogue and limits. A built-in is
    marked removed (adding it again brings it back); an added one is deleted.
    Chains that name it keep the step, which is then skipped. Returns the
    tasks whose chain named it.
    """
    cfg = await _config_v2()
    if key not in cfg.providers:
        raise KeyError(key)
    used = [t for t, state in cfg.tasks.items() if any(s["provider"] == key for s in state.route)]

    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                if key in PROVIDERS:
                    await conn.execute(
                        """
                        INSERT INTO ai_gateway_providers (key, deleted, updated_by, updated_at)
                        VALUES ($1, TRUE, $2, NOW())
                        ON CONFLICT (key) DO UPDATE SET deleted = TRUE, updated_by = EXCLUDED.updated_by,
                          updated_at = NOW()
                        """, key, actor_email)
                    await conn.execute(_SQL_FORGET_KEY, key)
                else:
                    await conn.execute("DELETE FROM ai_gateway_providers WHERE key = $1", key)
                await conn.execute("DELETE FROM ai_gateway_models WHERE provider = $1", key)
                await conn.execute(
                    "DELETE FROM ai_gateway_limits WHERE (scope = 'provider' AND target = $1) "
                    "OR (scope = 'model' AND starts_with(target, $1 || '|'))", key)

    await _write(op, STORAGE_NOT_READY_V2)
    reset_bench(_bench_key(key))
    return used


async def set_provider_key(key: str, api_key: str, actor_email: str | None) -> str:
    """Store a key encrypted. Returns its hint (the last 4 characters)."""
    api_key = validate_api_key(api_key)
    await _provider(key, fresh=False)
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
    reset_bench(_bench_key(key))
    return hint


async def clear_provider_key(key: str, actor_email: str | None) -> None:
    await _provider(key, fresh=False)
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


# ── Model catalogue ──

_MODEL_FIELDS = ("label", "enabled", "context_window", "max_output_tokens", "request_token_limit",
                 "input_cost_per_m", "output_cost_per_m", "vision")


def _tokens_input(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= _MAX_MODEL_TOKENS:
        raise ValueError(f"{name} must be a whole number of tokens from 1 to {_MAX_MODEL_TOKENS:,}, or empty.")
    return value


def _cost_input(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= _MAX_COST_PER_M:
        raise ValueError(f"{name} must be a price in USD per 1M tokens from 0 to {_MAX_COST_PER_M:,}, or empty.")
    return round(float(value), 4)


def validate_model_patch(patch: dict) -> dict:
    _unknown_fields(patch, _MODEL_FIELDS)
    out: dict = {}
    if "label" in patch:
        out["label"] = None if patch["label"] in (None, "") else validate_label(patch["label"], "label", 80)
    if "enabled" in patch:
        out["enabled"] = _bool_input(patch["enabled"], "enabled")
    for name in ("context_window", "max_output_tokens", "request_token_limit"):
        if name in patch:
            out[name] = _tokens_input(patch[name], name)
    for name in ("input_cost_per_m", "output_cost_per_m"):
        if name in patch:
            out[name] = _cost_input(patch[name], name)
    if "vision" in patch:
        out["vision"] = None if patch["vision"] is None else _bool_input(patch["vision"], "vision")
    return out


def _model_id(model: Any) -> str:
    model = model.strip() if isinstance(model, str) else ""
    if not MODEL_ID_RE.match(model):
        raise ValueError("A model id is 1 to 120 letters, digits or . _ : / @ + -")
    return model


async def upsert_model(provider: str, model: str, patch: dict, actor_email: str | None) -> None:
    """Add a model to a provider's catalogue, or change it."""
    values = validate_model_patch(patch)
    model = _model_id(model)
    cfg = await _config_v2()
    if provider not in cfg.providers:
        raise KeyError(provider)
    if (provider, model) not in cfg.catalog and \
            sum(1 for (p, _m) in cfg.catalog if p == provider) >= MAX_CATALOG_MODELS:
        raise ValueError(f"At most {MAX_CATALOG_MODELS} models per provider.")
    cols = list(values)
    placeholders = "".join(f", ${i}" for i in range(3, 3 + len(cols)))
    updates = "".join(f"{c} = EXCLUDED.{c}, " for c in cols)
    actor = 3 + len(cols)
    sql = (f"INSERT INTO ai_gateway_models (provider, model{''.join(', ' + c for c in cols)}, updated_by, updated_at) "
           f"VALUES ($1, $2{placeholders}, ${actor}, NOW()) "
           f"ON CONFLICT (provider, model) DO UPDATE SET {updates}"
           f"updated_by = EXCLUDED.updated_by, updated_at = NOW()")
    await _write(lambda pool: pool.execute(sql, provider, model, *values.values(), actor_email),
                 STORAGE_NOT_READY_V2)


async def import_models(provider: str, ids: list, actor_email: str | None) -> int:
    """Add models from the provider's offered list (its last connection
    test), with the context window, vision and prices it reported. Models
    already in the catalogue are left as they are. Returns how many were added."""
    cfg = await _config_v2()
    p = cfg.providers.get(provider)
    if p is None:
        raise KeyError(provider)
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_CATALOG_MODELS:
        raise ValueError(f"Choose 1 to {MAX_CATALOG_MODELS} models.")
    offered = {m["id"]: m for m in p.models}
    wanted = []
    for mid in dict.fromkeys(_model_id(i) for i in ids):
        if (provider, mid) in cfg.catalog:
            continue
        m = offered.get(mid, {})
        wanted.append((mid, m.get("label"), _positive_int(m.get("context")), _positive_int(m.get("max_output")),
                       m.get("input_cost_per_m"), m.get("output_cost_per_m"), m.get("vision")))
    room = MAX_CATALOG_MODELS - sum(1 for (pk, _m) in cfg.catalog if pk == provider)
    if len(wanted) > room:
        raise ValueError(f"At most {MAX_CATALOG_MODELS} models per provider; {room} more fit.")

    async def op(pool) -> int:
        added = 0
        async with pool.acquire() as conn:
            async with conn.transaction():
                for mid, label, ctx, out_max, cin, cout, vision in wanted:
                    status = await conn.execute(
                        """
                        INSERT INTO ai_gateway_models
                          (provider, model, label, context_window, max_output_tokens,
                           input_cost_per_m, output_cost_per_m, vision, updated_by, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                        ON CONFLICT (provider, model) DO NOTHING
                        """,
                        provider, mid, label, ctx, out_max, cin, cout, vision, actor_email)
                    added += 1 if str(status).endswith(" 1") else 0
        return added

    return await _write(op, STORAGE_NOT_READY_V2)


async def delete_model(provider: str, model: str, actor_email: str | None) -> None:
    """Remove a model from the catalogue, with its limits. Chains that name
    it still try it, with nothing known about it."""
    model = _model_id(model)
    cfg = await _config_v2()
    if (provider, model) not in cfg.catalog:
        raise KeyError(model)

    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM ai_gateway_models WHERE provider = $1 AND model = $2",
                                   provider, model)
                await conn.execute("DELETE FROM ai_gateway_limits WHERE scope = 'model' AND target = $1",
                                   model_target(provider, model))

    await _write(op, STORAGE_NOT_READY_V2)


# ── Limits ──

def _limit_cap(metric: str, value: Any) -> float:
    maximum = {"requests": _MAX_CALL_CAP, "tokens": _MAX_TOKEN_CAP, "spend": _MAX_SPEND_CAP}[metric]
    if metric == "spend":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value <= maximum
        if not ok:
            raise ValueError("A spend limit is an amount in USD above 0.")
        return round(float(value), 4)
    if isinstance(value, float) and value.is_integer():
        value = int(value)                   # JSON numbers may arrive as 5.0
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"A {metric} limit must be a whole number of at least 1.")
    return value


_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def validate_limits(scope: Any, target: Any, limits: Any, cfg: GatewayConfig) -> tuple[str, str, list[Limit]]:
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}.")
    target = target if isinstance(target, str) else ""
    if scope == "global":
        target = ""
    elif scope == "provider":
        if target not in cfg.providers:
            raise KeyError(target)
    elif scope == "model":
        provider, sep, model = target.partition("|")
        if not sep or provider not in cfg.providers:
            raise KeyError(target)
        target = model_target(provider, _model_id(model))
    elif scope == "task":
        if target not in TASKS:
            raise KeyError(target)
    elif scope == "user":
        if target != EVERY_USER and not _UUID_RE.fullmatch(target):
            raise ValueError("A user limit applies to every user ('*') or to one user id.")
    if not isinstance(limits, list) or len(limits) > len(PERIODS) * len(METRICS):
        raise ValueError("limits must be a list of {period, metric, cap}.")
    out: dict = {}
    for item in limits:
        if hasattr(item, "model_dump"):
            item = item.model_dump()
        if not isinstance(item, dict) or item.get("period") not in PERIODS or item.get("metric") not in METRICS:
            raise ValueError("Each limit needs a period (day, week, month) and a metric (requests, tokens, spend).")
        if item.get("cap") is None:
            continue
        key = (item["period"], item["metric"])
        if key in out:
            raise ValueError(f"The {item['period']} {item['metric']} limit is listed twice.")
        out[key] = Limit(scope, target, item["period"], item["metric"], _limit_cap(item["metric"], item["cap"]))
    return scope, target, _sorted_limits(list(out.values()))


async def set_limits(scope: str, target: str, limits: list, actor_email: str | None) -> list[Limit]:
    """Replace every limit of one scope and target (an empty list removes them)."""
    cfg = await _config_v2()
    scope, target, rows = validate_limits(scope, target, limits, cfg)

    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM ai_gateway_limits WHERE scope = $1 AND target = $2",
                                   scope, target)
                for lim in rows:
                    await conn.execute(
                        "INSERT INTO ai_gateway_limits (scope, target, period, metric, cap, updated_by, updated_at) "
                        "VALUES ($1, $2, $3, $4, $5, $6, NOW())",
                        scope, target, lim.period, lim.metric, lim.cap, actor_email)

    await _write(op, STORAGE_NOT_READY_V2)
    return rows


async def _set_day_caps(scope: str, target: str, caps: dict, actor_email: str | None) -> None:
    """The 0003-era daily cap fields, written as day limits once 0008 has run."""
    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for metric, cap in caps.items():
                    if cap is None:
                        await conn.execute(
                            "DELETE FROM ai_gateway_limits WHERE scope = $1 AND target = $2 "
                            "AND period = 'day' AND metric = $3", scope, target, metric)
                    else:
                        await conn.execute(
                            """
                            INSERT INTO ai_gateway_limits (scope, target, period, metric, cap, updated_by, updated_at)
                            VALUES ($1, $2, 'day', $3, $4, $5, NOW())
                            ON CONFLICT (scope, target, period, metric) DO UPDATE SET
                              cap = EXCLUDED.cap, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                            """, scope, target, metric, cap, actor_email)

    await _write(op, STORAGE_NOT_READY_V2)


# ── Chains, tasks, breaker ──

async def save_task(key: str, patch: dict, actor_email: str | None) -> None:
    _task_def(key)
    cfg = await get_config(force=True)
    values = validate_task_patch(patch, set(cfg.providers) if cfg.storage_ok else None)
    if not values:
        return
    if "daily_cap" in values and cfg.v2:
        await _set_day_caps("task", key, {"requests": values.pop("daily_cap")}, actor_email)
    if "fallback_to_default" in values and not cfg.v2:
        raise StorageNotReady(STORAGE_NOT_READY_V2)
    if not values:
        return
    if "route" in values and values["route"] is not None:
        values["route"] = json.dumps(values["route"])
    sql = _upsert_sql("ai_gateway_tasks", list(values), {"route": "::jsonb"})
    await _write(lambda pool: pool.execute(sql, key, *values.values(), actor_email))


async def _save_settings(values: dict, actor_email: str | None) -> None:
    """Upsert settings; a None value deletes the setting (back to the default)."""
    async def op(pool) -> None:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for k, v in values.items():
                    if v is None and k in ("default_route",):
                        await conn.execute("DELETE FROM ai_gateway_settings WHERE key = $1", k)
                        continue
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


async def save_default_route(route: Any, actor_email: str | None) -> None:
    """Save the global default chain; None goes back to the built-in one."""
    cfg = await get_config(force=True)
    value = None if route is None else validate_route(route, set(cfg.providers) if cfg.storage_ok else None)
    await _save_settings({"default_route": value}, actor_email)


def validate_breaker_patch(patch: dict) -> dict:
    _unknown_fields(patch, ("failures", "minutes"))
    out = {}
    if "failures" in patch:
        f = patch["failures"]
        if isinstance(f, bool) or not isinstance(f, int) or not 1 <= f <= 100:
            raise ValueError("failures must be a whole number from 1 to 100.")
        out["breaker_failures"] = f
    if "minutes" in patch:
        m = patch["minutes"]
        if isinstance(m, bool) or not isinstance(m, int) or not 0 <= m <= 1440:
            raise ValueError("minutes must be a whole number from 0 (breaker off) to 1440.")
        out["breaker_minutes"] = m
    return out


async def save_breaker(patch: dict, actor_email: str | None) -> dict:
    values = validate_breaker_patch(patch)
    if values:
        await _save_settings(values, actor_email)
    return values


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
    cfg = await get_config(force=True)
    if cfg.v2:
        await _set_day_caps("global", "", {("requests" if k == "daily_call_cap" else "tokens"): v
                                          for k, v in values.items()}, actor_email)
        return
    await _save_settings(values, actor_email)
