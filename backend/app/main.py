from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import settings
from .routers import projects, ai
import time

app = FastAPI(
    title="FinTrack API",
    description="AI-powered project finance tracker backed by Teable",
    version="2.0.0",
)

# Allow all origins — HF Space is public, Vercel deploy URL varies
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(ai.router)


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "message": "FinTrack API is running", "version": "2.0.0"}


@app.get("/health", tags=["health"])
async def health():
    return {
        "status": "healthy",
        "teable_configured": bool(settings.teable_api_token),
        "ai_configured": bool(settings.openrouter_api_key),
        "timestamp": time.time(),
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )
