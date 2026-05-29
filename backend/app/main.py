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
from .routers import associations as associations_router
from .routers import status as status_router
from .routers import shared_views as shared_views_router
from .routers import project_invoices as project_invoices_router
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache
from .db import postgres, valkey as vk
from .db.postgres import get_init_error
from .db.sync import sync_loop
from .db.audit import enqueue_audit, init_audit_queue, audit_worker, touch_session
from .routers.deps import require_auth

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_sync_task:  Optional[asyncio.Task] = None
_audit_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _sync_task, _audit_task
    logger.info("FinTrack API starting (version=%s)", app.version)

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

    yield

    # ── Graceful shutdown ─────────────────────────────────────────────────
    for task in (_sync_task, _audit_task):
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
    version="2.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(associations_router.router)
app.include_router(status_router.router)
app.include_router(shared_views_router.router)
app.include_router(project_invoices_router.router)


# ── Paths to skip audit (cheap probes — no value logging them) ──────────────
_SKIP_AUDIT_PATHS = {"/", "/health", "/health/live"}


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
            query_params=str(request.url.query)[:500] or None,
            resp_size=int(response.headers.get("content-length") or 0) or None,
            client_hint=request.headers.get("x-client-hint", ""),
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
    return {
        "status":        "healthy",
        "version":       app.version,
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured":     bool(settings.openrouter_api_key),
        "postgres":      "connected" if pg_ok else "unavailable",
        "postgres_error": pg_err,
        "valkey":        "connected" if vk_ok else "unavailable",
        "sync_running":  _sync_task is not None and not _sync_task.done(),
        "last_sync":     sync_meta,
        "cache":         cache.stats(),
        "timestamp":     time.time(),
    }


@app.post("/api/admin/pg-reconnect", tags=["health"])
async def pg_reconnect(_: str = Depends(require_auth)):
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
