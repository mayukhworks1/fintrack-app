"""FinTrack API entrypoint."""
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import projects, ai, auth, invoices, web_invoices, webhooks
from .routers import admin
from .routers import insights as insights_router
from .routers import status as status_router
from .routers import shared_views as shared_views_router
from .routers import storage as storage_router
from .routers import reports as reports_router
from .routers import pages as pages_router
from .routers import studio as studio_router
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache
from .db import postgres, valkey as vk, migrate
from .db.postgres import get_init_error
from .db.sync import sync_loop
from .db.audit import enqueue_audit, init_audit_queue, audit_worker, touch_session
from .services.invoice_aging import invoice_aging_refresh_loop
from .services.project_duration import project_duration_refresh_loop
from .services import alerts, scanner_trap
from .routers.deps import require_auth, require_admin
from .utils.uploads import UploadSizeLimitMiddleware

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_sync_task:       Optional[asyncio.Task] = None
_audit_task:      Optional[asyncio.Task] = None
_aging_refresh_task: Optional[asyncio.Task] = None
_embed_task:      Optional[asyncio.Task] = None
# Declared here, not left as a lifespan local: as a local the duration task was
# invisible to /health, never cancelled at shutdown, and could not be watched.
_duration_refresh_task: Optional[asyncio.Task] = None
_alert_task:      Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _sync_task, _audit_task, _aging_refresh_task, _embed_task, _duration_refresh_task, _alert_task
    logger.info("FinTrack API starting (version=%s)", app.version)

    # ── LangChain / LangSmith observability ─────────────────────────────────
    if settings.langchain_tracing_v2 and settings.langchain_api_key:
        import os
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"]     = settings.langchain_api_key
        os.environ["LANGCHAIN_PROJECT"]     = settings.langchain_project
        logger.info("LangSmith tracing enabled (project=%s)", settings.langchain_project)

    # ── Security self-checks ─────────────────────────────────────────────────
    from .config import is_dev_env, using_insecure_app_secret
    if using_insecure_app_secret():
        # app_secret is the HMAC key for every session token, and the token
        # payload carries the role — so a known key means anyone can mint
        # superadmin. The default is published in a public repo.
        #
        # This refuses to boot rather than logging and serving. The old
        # behaviour left a fully bypassable deployment running behind a log
        # line, which is the one failure here nobody would notice. Every other
        # missing secret in this block already fails closed; this one was the
        # outlier.
        if is_dev_env():
            logger.warning(
                "APP_SECRET is the public dev default. Allowed because APP_ENV=%s, "
                "but tokens signed now are forgeable by anyone with the repo.",
                settings.app_env,
            )
        else:
            raise RuntimeError(
                "SECURITY: refusing to start — APP_SECRET is still the public dev "
                "default, so session tokens for any role (superadmin included) can "
                "be forged by anyone who reads the repo. Set a strong APP_SECRET in "
                "the deployment secrets (`openssl rand -base64 48`) and restart. "
                "For local development set APP_ENV=development instead."
            )
    if not settings.app_admin_password:
        logger.warning("APP_ADMIN_PASSWORD is not set — legacy admin-password login is disabled (fail-closed).")
    if not settings.teable_webhook_secret:
        if settings.webhook_allow_unsigned:
            logger.warning(
                "SECURITY: TEABLE_WEBHOOK_SECRET is not set and WEBHOOK_ALLOW_UNSIGNED=true — "
                "/api/webhooks/teable accepts UNAUTHENTICATED writes into the PG mirrors. "
                "This is intended for local development only. Set the secret in production."
            )
        else:
            logger.warning(
                "TEABLE_WEBHOOK_SECRET is not set — /api/webhooks/teable is FAILING CLOSED "
                "(instant webhook sync disabled). The 30 s incremental + 5 min full sync keep "
                "the mirror fresh. Set the secret and add the same X-Webhook-Secret header in "
                "every Teable Automation to re-enable instant sync."
            )

    # ── Critical env-var validation ───────────────────────────────────────────
    missing_critical = []
    if not settings.teable_api_token:
        missing_critical.append("TEABLE_API_TOKEN")
    if not settings.app_password:
        missing_critical.append("APP_PASSWORD")
    if missing_critical:
        logger.error(
            "STARTUP: Missing critical env vars: %s — core features will fail at runtime. "
            "Set these in HF Space secrets or your .env file.",
            ", ".join(missing_critical),
        )

    # Shared pooled HTTP client — keeps Teable/upstream connections alive so
    # requests stop paying a TCP + TLS handshake each.
    from .utils.http import init_http, close_http
    await init_http()

    await postgres.init_pool()
    # Retry once after 5 s — Aiven / cold-start connections occasionally
    # time out on the first attempt but succeed immediately on the second.
    if postgres.get_pool() is None and settings.postgres_url:
        logger.warning("PG init failed on first attempt — retrying in 5 s …")
        await asyncio.sleep(5)
        await postgres.init_pool()
        if postgres.get_pool() is None:
            logger.error("PG init failed on retry too — admin features unavailable. Error: %s", postgres.get_init_error())
        else:
            logger.info("PG connected on retry")

    if settings.valkey_url:
        await vk.init_client(settings.valkey_url)
        # Bans issued before the last restart come back into memory here,
        # once; the per-request check never leaves the process.
        try:
            _restored = await scanner_trap.load_bans_from_valkey()
            if _restored:
                logger.info("scanner trap: %d ban(s) restored from Valkey", _restored)
        except Exception as exc:
            logger.debug("scanner trap: ban restore skipped (%s)", exc)

    # Keep every pooled connection warm. Without this, asyncpg let idle
    # connections expire and the next request paid a full TLS + SCRAM
    # handshake to a database ~210 ms away — about a second — before its
    # query ran. That was the p90 of nearly every endpoint in the audit log.
    postgres.start_keepalive()

    # ── Async audit log queue ────────────────────────────────────────────
    # Must be started before any requests arrive so middleware can enqueue.
    init_audit_queue()
    _audit_task = asyncio.create_task(audit_worker(), name="audit-worker")
    logger.info("Async audit log worker started")

    # ── Teable → PG background sync ──────────────────────────────────────
    if postgres.get_pool() and (settings.teable_api_token or settings.teable_web_api_token):
        _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
        logger.info("Background Teable sync task started")
        _aging_refresh_task = asyncio.create_task(invoice_aging_refresh_loop(), name="invoice-aging-refresh")
        logger.info("Background invoice aging refresh task started")
        _duration_refresh_task = asyncio.create_task(project_duration_refresh_loop(), name="project-duration-refresh")
        logger.info("Background project duration refresh task started")

    # ── Background embedding task (pgvector RAG) ─────────────────────────────
    if postgres.get_pool() and settings.openrouter_api_key:
        async def _embed_loop():
            from .services.embeddings import embed_all_records_bg, is_pgvector_available
            if not await is_pgvector_available():
                logger.info("pgvector not available — embedding loop skipped")
                return
            logger.info("Starting background embedding task")
            while True:
                try:
                    await embed_all_records_bg()
                except Exception as exc:
                    logger.warning("embed_all_records_bg error: %s", exc)
                await asyncio.sleep(600)   # re-embed new/changed records every 10 min
        _embed_task = asyncio.create_task(_embed_loop(), name="embedding-bg")
        logger.info("Background embedding task started")

    # ── Pages: move inline base64 images saved before this build into assets
    if postgres.get_pool() and settings.hf_token and settings.hf_dataset_repo:
        from .utils.tasks import spawn as _spawn
        _spawn(pages_router.sweep_inline_images_once(), name="pages-inline-sweep")

    # ── Alerting ─────────────────────────────────────────────────────────
    # Started unconditionally: the monitor decides for itself whether it has
    # anywhere to send to, and exits with one log line if not. It reads the
    # task handles through a provider so alerts.py never imports main.
    alerts.register_tasks(lambda: {
        "sync":      _sync_task,
        "aging":     _aging_refresh_task,
        "duration":  _duration_refresh_task,
        "embedding": _embed_task,
    })
    _alert_task = asyncio.create_task(alerts.alert_monitor_loop(), name="alert-monitor")

    yield

    # ── Graceful shutdown ─────────────────────────────────────────────────
    # 1. Flush the audit queue before cancelling the worker so no events are lost.
    from .db.audit import _audit_queue as _aq
    if _aq is not None:
        try:
            await asyncio.wait_for(_aq.join(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Audit queue did not drain within 5 s — some events may be lost")

    for task in (_sync_task, _audit_task, _aging_refresh_task, _embed_task, _duration_refresh_task, _alert_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    await postgres.stop_keepalive()
    await postgres.close_pool()
    await vk.close_client()
    await close_http()
    logger.info("FinTrack API shutting down — cache stats: %s", cache.stats())


app = FastAPI(
    title="FinTrack API",
    description="AI-powered project finance tracker backed by Teable",
    version=settings.app_version,
    lifespan=lifespan,
)

# Refuse an oversized multipart upload before its body is spooled. Added before
# every other middleware, so it sits innermost: inside CORS, so its 413 still
# carries the CORS headers, and inside the request-ID middleware.
app.add_middleware(UploadSizeLimitMiddleware)

# Localhost origins allowed when FRONTEND_URL is not configured (dev default).
_DEV_CORS_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",  # Vite dev server
    "http://localhost:3000", "http://127.0.0.1:3000",  # common alt dev port
    "http://localhost:4173", "http://127.0.0.1:4173",  # vite preview
]


def _cors_origins() -> list[str]:
    """
    Restrict CORS to the configured frontend origin(s). FRONTEND_URL may be a
    comma-separated list. If FRONTEND_URL is explicitly set, only those exact
    origins are allowed.

    Fail-closed default: when FRONTEND_URL is unset/"*" we restrict to localhost
    dev origins rather than "*". Set CORS_ALLOW_ALL=true to opt back into "*"
    (e.g. a throwaway environment). Production must set FRONTEND_URL.
    """
    raw = (settings.frontend_url or "").strip()
    if raw and raw != "*":
        origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        logger.info("CORS: restricting to %s", origins)
        return origins
    if settings.cors_allow_all:
        logger.warning("CORS: CORS_ALLOW_ALL=true — allowing all origins (*). Do not use in production.")
        return ["*"]
    logger.warning(
        "CORS: FRONTEND_URL not set — defaulting to localhost dev origins only. "
        "Set FRONTEND_URL to your frontend origin in production (or CORS_ALLOW_ALL=true to allow all)."
    )
    return list(_DEV_CORS_ORIGINS)


# Compress responses. Every JSON body — the Dashboard's 400-invoice list, the
# project mirror, audit pages — went over the wire uncompressed; there is no
# proxy in front of the HF Space to do it. minimum_size keeps tiny responses
# (health checks, auth verify) uncompressed, where gzip costs more than it saves.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Response-Time-Ms"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(invoices.router)
app.include_router(ai.router)
app.include_router(web_invoices.router)
app.include_router(web_projects_router)
app.include_router(web_resources_router)
app.include_router(webhooks.router)
app.include_router(admin.router)
app.include_router(insights_router.router)
app.include_router(status_router.router)
app.include_router(shared_views_router.router)
app.include_router(storage_router.router)
app.include_router(reports_router.router)
app.include_router(pages_router.router)
app.include_router(studio_router.router)


# ── Paths to skip audit (cheap probes — no value logging them) ──────────────
_SKIP_AUDIT_PATHS = {"/", "/health", "/health/live"}

# Query-string keys whose values must never be persisted to the audit log.
# Tokens (SSE EventSource passes ?token=), passwords, and reset tokens are all
# secrets that would otherwise sit in plaintext in audit_log / DB backups.
_SENSITIVE_QUERY_KEYS = {"token", "pw", "password", "secret", "reset_token", "api_key", "apikey"}


def _redact_query(raw_query: str) -> str | None:
    """Return the query string with sensitive values masked, capped at 500 chars."""
    if not raw_query:
        return None
    try:
        from urllib.parse import parse_qsl, urlencode
        pairs = parse_qsl(raw_query, keep_blank_values=True)
        redacted = [
            (k, "[REDACTED]" if k.lower() in _SENSITIVE_QUERY_KEYS else v)
            for k, v in pairs
        ]
        out = urlencode(redacted)
    except Exception:
        out = raw_query
    return out[:500] or None


def _get_client_ip(request: Request) -> str:
    """Real client IP — respects Cloudflare / nginx proxy headers."""
    for header in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Request ID + audit middleware ────────────────────────────────────────────
@app.middleware("http")
async def request_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.request_id = req_id
    # Pre-initialise so the audit task always has something to read
    request.state.role        = None
    request.state.token_hint  = None

    started = time.time()
    try:
        # Scanner trap, before routing. Substitutes the response rather than
        # returning early so everything below — timing headers, the audit
        # enqueue, the 5xx counter — still runs for these requests.
        _trap_hit = None
        if settings.scanner_trap_enabled:
            _ip = _get_client_ip(request)
            _path = request.url.path
            if scanner_trap.is_banned(_ip):
                scanner_trap.note_blocked()
                _trap_hit = JSONResponse({"detail": "Forbidden"}, status_code=403)
            elif scanner_trap.is_probe(_path):
                await scanner_trap.record_probe(_ip)
                _trap_hit = JSONResponse({"detail": "Not Found"}, status_code=404)
        response = _trap_hit if _trap_hit is not None else await call_next(request)
    except Exception:
        logger.exception("[%s] %s %s — unhandled exception",
                         req_id, request.method, request.url.path)
        # This path never reaches the status check below — the exception is
        # re-raised and FastAPI builds the 500 outside this middleware — so
        # count it here or the error-rate alert misses every crash.
        alerts.record_server_error()
        raise

    duration_ms = int((time.time() - started) * 1000)
    if response.status_code >= 500:
        alerts.record_server_error()
    response.headers["X-Request-ID"]        = req_id
    response.headers["X-Response-Time-Ms"]  = str(duration_ms)

    path = request.url.path
    if path not in _SKIP_AUDIT_PATHS:
        logger.info("[%s] %s %s %s -> %d (%dms)",
                    req_id,
                    getattr(request.state, "role", None) or "anon",
                    request.method, path,
                    response.status_code, duration_ms)

        # role and token_hint are set by require_auth in deps.py *before*
        # the route handler returns, so they're available here.
        role       = getattr(request.state, "role",       None)
        token_hint = getattr(request.state, "token_hint", None)
        ip         = _get_client_ip(request)

        # Non-blocking enqueue — audit_worker batches + inserts asynchronously.
        # enqueue_audit() is synchronous (just queue.put_nowait) so no await needed.
        auth_extra = {
            "auth_user_id":    getattr(request.state, "auth_user_id",    None),
            "auth_user_email": getattr(request.state, "auth_user_email", None),
            "auth_user_name":  getattr(request.state, "auth_user_name",  None),
            "auth_role":       getattr(request.state, "auth_role",       None),
            "auth_session_id": getattr(request.state, "auth_session_id", None),
            "is_email_auth":   bool(getattr(request.state, "is_email_auth", False)),
        }
        enqueue_audit(
            role=role,
            token_hint=token_hint,
            method=request.method,
            path=path,
            status=response.status_code,
            duration_ms=duration_ms,
            request_id=req_id,
            ip=ip,
            user_agent=request.headers.get("user-agent", ""),
            referer=(request.headers.get("referer") or request.headers.get("origin") or "")[:500] or None,
            body_size=int(request.headers.get("content-length") or 0) or None,
            query_params=_redact_query(str(request.url.query)),
            resp_size=int(response.headers.get("content-length") or 0) or None,
            client_hint=request.headers.get("x-client-hint", ""),
            extra={k: v for k, v in auth_extra.items() if v not in (None, "")},
        )

        # Keep login_sessions.last_seen_at fresh (rate-limited in touch_session)
        if token_hint:
            from .utils.tasks import spawn
            spawn(touch_session(token_hint), name="touch-session")

    return response


# ── Health endpoints ─────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": "fintrack-api", "version": app.version}


@app.get("/health/live", tags=["health"])
async def liveness():
    return {"status": "alive"}


@app.get("/health", tags=["health"])
async def health():
    pg_ok = postgres.get_pool() is not None
    vk_ok = vk.get_client() is not None
    pg_err = get_init_error()

    # Round-trip times to the two stores, measured here so the number that
    # explains most of this app's latency is visible without a profiler. All
    # three probes run concurrently; /health costs one round trip, not three.
    async def _pg_rtt() -> int:
        t0 = time.perf_counter()
        await asyncio.wait_for(postgres.get_pool().fetchval("SELECT 1"), timeout=5.0)  # type: ignore[union-attr]
        return int((time.perf_counter() - t0) * 1000)

    async def _vk_rtt() -> int:
        t0 = time.perf_counter()
        await asyncio.wait_for(vk.get_client().ping(), timeout=5.0)  # type: ignore[union-attr]
        return int((time.perf_counter() - t0) * 1000)

    async def _last_sync():
        row = await postgres.get_pool().fetchrow(  # type: ignore[union-attr]
            """
            SELECT source, synced_at, total, created, updated, unchanged, duration_ms, error
            FROM sync_log
            ORDER BY synced_at DESC
            LIMIT 1
            """
        )
        if not row:
            return None
        meta = dict(row)
        if hasattr(meta.get("synced_at"), "isoformat"):
            meta["synced_at"] = meta["synced_at"].isoformat()
        return meta

    async def _none():
        return None

    pg_rtt, vk_rtt, sync_meta = await asyncio.gather(
        _pg_rtt() if pg_ok else _none(),
        _vk_rtt() if vk_ok else _none(),
        _last_sync() if pg_ok else _none(),
        return_exceptions=True,
    )
    pg_rtt_ms = pg_rtt if isinstance(pg_rtt, int) else None
    vk_rtt_ms = vk_rtt if isinstance(vk_rtt, int) else None
    if isinstance(sync_meta, BaseException):
        sync_meta = None
    from .services.embeddings import _pgvector_ok as _pgv
    return {
        "status":            "healthy",
        "version":           app.version,
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured":     bool(settings.openrouter_api_key),
        "storage_configured": bool(settings.hf_token and settings.hf_dataset_repo),
        "postgres":          "connected" if pg_ok else "unavailable",
        "postgres_error":    pg_err,
        "pg_rtt_ms":         pg_rtt_ms,
        "pool":              postgres.pool_stats(),
        "valkey":            "connected" if vk_ok else "unavailable",
        "valkey_rtt_ms":     vk_rtt_ms,
        "pgvector":          "available" if _pgv else ("unavailable" if _pgv is False else "unchecked"),
        "sync_running":      _sync_task is not None and not _sync_task.done(),
        "aging_running":     _aging_refresh_task is not None and not _aging_refresh_task.done(),
        "embed_running":     _embed_task is not None and not _embed_task.done(),
        "duration_running":  _duration_refresh_task is not None and not _duration_refresh_task.done(),
        "alerting":          alerts.state(),
        "scanner_trap":      scanner_trap.state(),
        "migrations":        migrate.state(),
        "langsmith_tracing": settings.langchain_tracing_v2 and bool(settings.langchain_api_key),
        "last_sync":         sync_meta,
        "cache":             cache.stats(),
        "timestamp":         time.time(),
    }


@app.get("/api/smtp-test", tags=["health"])
async def smtp_test(pw: str = "", to: str = ""):
    """Email diagnostic — pass ?pw=<admin_password>&to=<your_email> to send a real test."""
    import hmac as _hmac
    from .services.emailer import is_email_configured, send_email
    # Fail closed if no admin password is configured, and use a constant-time compare.
    if not settings.app_admin_password or not _hmac.compare_digest(pw, settings.app_admin_password):
        raise HTTPException(status_code=403, detail="Wrong password")
    cfg = {
        "configured": is_email_configured(),
        "brevo_key_set": bool(settings.brevoapikey),
        "from_email": settings.smtp_from_email or settings.smtp_username,
    }
    if not to:
        return {"config": cfg, "hint": "Add &to=youremail@example.com to send a real test"}
    result = await send_email(to, "FinTrack email test", "This is a test email from FinTrack.")
    return {"result": result, "config": cfg}



@app.post("/api/admin/alerts/test", tags=["health"])
async def alerts_test(_: str = Depends(require_admin)):
    """Send a real test alert through every configured channel.

    Alerting you cannot verify is not alerting: set ALERT_WEBHOOK_URL and/or
    ALERT_EMAIL_TO, call this, and confirm the message arrived.
    """
    result = await alerts.send_test_alert()
    if not result["configured"]:
        result["hint"] = "Set ALERT_WEBHOOK_URL and/or ALERT_EMAIL_TO, then restart."
    return result


@app.post("/api/admin/watchdog", tags=["health"])
async def watchdog_restart(_: str = Depends(require_admin)):
    """Restart any dead background tasks (sync, aging). Safe to call anytime."""
    global _sync_task, _aging_refresh_task, _duration_refresh_task, _alert_task
    restarted = []
    if (_sync_task is None or _sync_task.done()) and (settings.teable_api_token or settings.teable_web_api_token):
        from .db.sync import sync_loop
        _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
        restarted.append("sync")
        logger.info("watchdog: sync task restarted")
    if _aging_refresh_task is None or _aging_refresh_task.done():
        from .services.invoice_aging import invoice_aging_refresh_loop
        _aging_refresh_task = asyncio.create_task(invoice_aging_refresh_loop(), name="invoice-aging-refresh")
        restarted.append("aging")
        logger.info("watchdog: aging task restarted")
    if (_duration_refresh_task is None or _duration_refresh_task.done()) and postgres.get_pool():
        _duration_refresh_task = asyncio.create_task(project_duration_refresh_loop(), name="project-duration-refresh")
        restarted.append("duration")
        logger.info("watchdog: duration task restarted")
    if _alert_task is None or _alert_task.done():
        _alert_task = asyncio.create_task(alerts.alert_monitor_loop(), name="alert-monitor")
        restarted.append("alerts")
        logger.info("watchdog: alert monitor restarted")
    return {
        "status": "ok",
        "restarted": restarted,
        "duration_running": _duration_refresh_task is not None and not _duration_refresh_task.done(),
        "alert_running": _alert_task is not None and not _alert_task.done(),
        "sync_running": _sync_task is not None and not _sync_task.done(),
        "aging_running": _aging_refresh_task is not None and not _aging_refresh_task.done(),
    }


@app.post("/api/admin/pg-reconnect", tags=["health"])
async def pg_reconnect(_: str = Depends(require_admin)):
    """Force a PostgreSQL reconnection attempt (useful after transient failures)."""
    if postgres.get_pool() is not None:
        return {"status": "already_connected"}
    await postgres.init_pool()
    pool = postgres.get_pool()
    if pool:
        # Start sync task if it isn't running
        global _sync_task, _aging_refresh_task
        if (_sync_task is None or _sync_task.done()) and (settings.teable_api_token or settings.teable_web_api_token):
            from .db.sync import sync_loop
            _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
            logger.info("Background sync task restarted after PG reconnect")
        if _aging_refresh_task is None or _aging_refresh_task.done():
            from .services.invoice_aging import invoice_aging_refresh_loop
            _aging_refresh_task = asyncio.create_task(invoice_aging_refresh_loop(), name="invoice-aging-refresh")
            logger.info("Background aging refresh task restarted after PG reconnect")
        return {"status": "connected"}
    return JSONResponse(
        status_code=503,
        content={"status": "failed", "error": get_init_error()},
    )


# ── Unified error envelope ───────────────────────────────────────────────────
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code":       exc.status_code,
                "type":       "HTTPException",
                "message":    str(exc.detail) if exc.detail else "Request failed",
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", None)
    logger.exception("[%s] Unhandled exception in %s %s",
                     req_id, request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code":       500,
                "type":       type(exc).__name__,
                "message":    str(exc) or "Internal server error",
                "request_id": req_id,
            }
        },
    )
