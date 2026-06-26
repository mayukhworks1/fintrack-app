"""FinTrack API entrypoint."""
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
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
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache
from .db import postgres, valkey as vk
from .db.postgres import get_init_error
from .db.sync import sync_loop
from .db.audit import enqueue_audit, init_audit_queue, audit_worker, touch_session
from .services.invoice_aging import invoice_aging_refresh_loop
from .services.project_duration import project_duration_refresh_loop
from .routers.deps import require_auth, require_admin

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_sync_task:       Optional[asyncio.Task] = None
_audit_task:      Optional[asyncio.Task] = None
_aging_refresh_task: Optional[asyncio.Task] = None
_embed_task:      Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _sync_task, _audit_task, _aging_refresh_task, _embed_task
    logger.info("FinTrack API starting (version=%s)", app.version)

    # ── LangChain / LangSmith observability ─────────────────────────────────
    if settings.langchain_tracing_v2 and settings.langchain_api_key:
        import os
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"]     = settings.langchain_api_key
        os.environ["LANGCHAIN_PROJECT"]     = settings.langchain_project
        logger.info("LangSmith tracing enabled (project=%s)", settings.langchain_project)

    # ── Security self-checks ─────────────────────────────────────────────────
    from .config import DEV_APP_SECRET
    if settings.app_secret == DEV_APP_SECRET:
        logger.error(
            "SECURITY: APP_SECRET is still the public dev default. Anyone can forge "
            "tokens for any role. Set a strong APP_SECRET in the deployment secrets "
            "(e.g. `openssl rand -base64 48`) and restart."
        )
    if not settings.app_admin_password:
        logger.warning("APP_ADMIN_PASSWORD is not set — legacy admin-password login is disabled (fail-closed).")
    if not settings.teable_webhook_secret:
        logger.warning(
            "SECURITY: TEABLE_WEBHOOK_SECRET is not set — /api/webhooks/teable accepts "
            "unauthenticated writes into the PG mirrors. Set it and add the same value as "
            "the X-Webhook-Secret header in every Teable Automation."
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

    yield

    # ── Graceful shutdown ─────────────────────────────────────────────────
    # 1. Flush the audit queue before cancelling the worker so no events are lost.
    from .db.audit import _audit_queue as _aq
    if _aq is not None:
        try:
            await asyncio.wait_for(_aq.join(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Audit queue did not drain within 5 s — some events may be lost")

    for task in (_sync_task, _audit_task, _aging_refresh_task, _embed_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    await postgres.close_pool()
    await vk.close_client()
    logger.info("FinTrack API shutting down — cache stats: %s", cache.stats())


app = FastAPI(
    title="FinTrack API",
    description="AI-powered project finance tracker backed by Teable",
    version=settings.app_version,
    lifespan=lifespan,
)

def _cors_origins() -> list[str]:
    """
    Restrict CORS to the configured frontend origin(s). FRONTEND_URL may be a
    comma-separated list. Falls back to "*" ONLY when nothing is configured (local dev).
    If FRONTEND_URL is explicitly set, only those exact origins are allowed.
    """
    raw = (settings.frontend_url or "").strip()
    if not raw or raw == "*":
        logger.warning("CORS: FRONTEND_URL not set — allowing all origins (*). Set FRONTEND_URL in production.")
        return ["*"]
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    logger.info("CORS: restricting to %s", origins)
    return origins


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
        response = await call_next(request)
    except Exception:
        logger.exception("[%s] %s %s — unhandled exception",
                         req_id, request.method, request.url.path)
        raise

    duration_ms = int((time.time() - started) * 1000)
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
            asyncio.create_task(touch_session(token_hint))

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
    sync_meta = None
    if pg_ok:
        try:
            sync_meta = await postgres.get_pool().fetchrow(  # type: ignore[union-attr]
                """
                SELECT source, synced_at, total, created, updated, unchanged, duration_ms, error
                FROM sync_log
                ORDER BY synced_at DESC
                LIMIT 1
                """
            )
            if sync_meta:
                sync_meta = dict(sync_meta)
                if hasattr(sync_meta.get("synced_at"), "isoformat"):
                    sync_meta["synced_at"] = sync_meta["synced_at"].isoformat()
        except Exception:
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
        "valkey":            "connected" if vk_ok else "unavailable",
        "pgvector":          "available" if _pgv else ("unavailable" if _pgv is False else "unchecked"),
        "sync_running":      _sync_task is not None and not _sync_task.done(),
        "embed_running":     _embed_task is not None and not _embed_task.done(),
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



@app.post("/api/admin/pg-reconnect", tags=["health"])
async def pg_reconnect(_: str = Depends(require_admin)):
    """Force a PostgreSQL reconnection attempt (useful after transient failures)."""
    if postgres.get_pool() is not None:
        return {"status": "already_connected"}
    await postgres.init_pool()
    pool = postgres.get_pool()
    if pool:
        # Start sync task if it isn't running
        global _sync_task
        if (_sync_task is None or _sync_task.done()) and (settings.teable_api_token or settings.teable_web_api_token):
            from .db.sync import sync_loop
            _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
            logger.info("Background sync task restarted after PG reconnect")
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
