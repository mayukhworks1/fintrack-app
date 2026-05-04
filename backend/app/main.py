"""FinTrack API entrypoint."""
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import projects, ai, auth, invoices, web_invoices
from .routers.web_projects import projects_router as web_projects_router, resources_router as web_resources_router
from .utils.cache import cache

logger = logging.getLogger("fintrack")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("FinTrack API starting (version=%s)", app.version)
    yield
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


# ── Request ID + access log ──────────────────────────────────────────
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
    if request.url.path not in ("/", "/health", "/health/live"):
        logger.info("[%s] %s %s -> %d in %dms",
                    req_id, request.method, request.url.path, response.status_code, duration_ms)
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
    """Full health: config + cache + uptime markers."""
    return {
        "status": "healthy",
        "version": app.version,
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured":     bool(settings.openrouter_api_key),
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
