"""FinTrack API entrypoint."""
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import projects, ai, auth, invoices, web_invoices, webhooks
from .routers import admin
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache
from .db import postgres, valkey as vk
from .db.sync import sync_loop
from .db.audit import log_request, touch_session

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_sync_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _sync_task
    logger.info("FinTrack API starting (version=%s)", app.version)

    await postgres.init_pool()
    if settings.valkey_url:
        await vk.init_client(settings.valkey_url)

    if postgres.get_pool() and settings.teable_api_token:
        _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
        logger.info("Background Teable sync task started")

    yield

    if _sync_task and not _sync_task.done():
        _sync_task.cancel()
        try:
            await _sync_task
        except asyncio.CancelledError:
            pass

    await postgres.close_pool()
    await vk.close_client()
    logger.info("FinTrack API shutting down — cache stats: %s", cache.stats())


app = FastAPI(
    title="FinTrack API",
    description="AI-powered project finance tracker backed by Teable",
    version="2.2.0",
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

        # Fire-and-forget — never blocks the response
        asyncio.create_task(log_request(
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
        ))

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
    return {
        "status":        "healthy",
        "version":       app.version,
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured":     bool(settings.openrouter_api_key),
        "postgres":      "connected" if pg_ok else "unavailable",
        "valkey":        "connected" if vk_ok else "unavailable",
        "sync_running":  _sync_task is not None and not _sync_task.done(),
        "cache":         cache.stats(),
        "timestamp":     time.time(),
    }


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
