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
from .routers import projects, ai, auth, invoices, web_invoices
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache
from .db import postgres, valkey as vk
from .db.sync import sync_loop
from .db.audit import log_request

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_sync_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _sync_task
    logger.info("FinTrack API starting (version=%s)", app.version)

    # ── Boot DB connections ──────────────────────────────────────────────
    await postgres.init_pool()
    if settings.valkey_url:
        await vk.init_client(settings.valkey_url)

    # ── Start background Teable → PostgreSQL sync ────────────────────────
    if postgres.get_pool() and settings.teable_api_token:
        _sync_task = asyncio.create_task(sync_loop(), name="teable-sync")
        logger.info("Background Teable sync task started")

    yield

    # ── Graceful shutdown ────────────────────────────────────────────────
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
    version="2.1.0",
    lifespan=lifespan,
)

# CORS — HF Space is public, frontend deploy URL varies (Cloudflare/Vercel).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(invoices.router)
app.include_router(ai.router)
app.include_router(web_invoices.router)
app.include_router(web_projects_router)
app.include_router(web_resources_router)


# ── Request ID + access log + audit ──────────────────────────────────────────
_SKIP_AUDIT_PATHS = {"/", "/health", "/health/live"}


def _get_client_ip(request: Request) -> str:
    """Extract real client IP respecting common proxy headers."""
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else ""


def _token_hint(request: Request) -> Optional[str]:
    """First 16 chars of the Bearer token (for log correlation only)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        return tok[:16] if tok else None
    return None


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.request_id = req_id
    started = time.time()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("[%s] %s %s — unhandled exception",
                         req_id, request.method, request.url.path)
        raise
    duration_ms = int((time.time() - started) * 1000)
    response.headers["X-Request-ID"] = req_id
    response.headers["X-Response-Time-Ms"] = str(duration_ms)

    path = request.url.path
    if path not in _SKIP_AUDIT_PATHS:
        logger.info("[%s] %s %s -> %d in %dms",
                    req_id, request.method, path, response.status_code, duration_ms)
        # Fire-and-forget audit — never blocks the response
        asyncio.create_task(log_request(
            role=getattr(request.state, "role", None),
            token_hint=_token_hint(request),
            method=request.method,
            path=path,
            status=response.status_code,
            duration_ms=duration_ms,
            request_id=req_id,
            ip=_get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        ))

    return response


# ── Health endpoints ─────────────────────────────────────────────────
@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": "fintrack-api", "version": app.version}


@app.get("/health/live", tags=["health"])
async def liveness():
    """Cheap liveness probe — 200 if the process can answer."""
    return {"status": "alive"}


@app.get("/health", tags=["health"])
async def health():
    """Full health: config + cache + DB status + uptime markers."""
    pg_ok  = postgres.get_pool() is not None
    vk_ok  = vk.get_client() is not None
    return {
        "status": "healthy",
        "version": app.version,
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured":     bool(settings.openrouter_api_key),
        "postgres":          "connected" if pg_ok else "unavailable",
        "valkey":            "connected" if vk_ok else "unavailable",
        "sync_running":      _sync_task is not None and not _sync_task.done(),
        "cache":             cache.stats(),
        "timestamp":         time.time(),
    }


# ── Unified error envelope ───────────────────────────────────────────
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Turn HTTPException into a consistent JSON envelope."""
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
    """Catch-all — log full trace, return safe envelope to client."""
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
