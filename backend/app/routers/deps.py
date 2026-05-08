"""
Shared FastAPI dependencies for auth + role checks.

KEY FIX: require_auth now writes role AND token_hint to request.state
so the audit middleware (which runs after the response) can pick them
up correctly.  Previously role was always None in audit_log.

Usage:
    from .deps import require_auth, require_editor

    @router.get("/something")
    async def read_something(role: str = Depends(require_auth)):
        ...

    @router.post("/something")
    async def create_something(role: str = Depends(require_editor)):
        ...
"""
from fastapi import Depends, Header, HTTPException, Request
from .auth import verify_token


def _get_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    return authorization.split(" ", 1)[1].strip()


def require_auth(request: Request, token: str = Depends(_get_token)) -> str:
    """
    Accepts any valid token (editor / viewer / web / all / admin).
    Stores role + token_hint on request.state for the audit middleware.
    Returns the role string.
    """
    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    # Store on state so audit middleware can read them after the response
    request.state.role       = role
    request.state.token_hint = token[:16]
    return role


def require_editor(role: str = Depends(require_auth)) -> str:
    """Requires editor role. Raises 403 for all other roles."""
    if role != "editor":
        raise HTTPException(status_code=403, detail="This action requires editor access")
    return role


def require_web(role: str = Depends(require_auth)) -> str:
    """Requires web role (web invoice module)."""
    if role != "web":
        raise HTTPException(status_code=403, detail="Access restricted to web invoice module")
    return role


def require_web_access(role: str = Depends(require_auth)) -> str:
    """Accepts 'web' OR 'all' — both can access the web invoice module."""
    if role not in ("web", "all"):
        raise HTTPException(status_code=403, detail="Access restricted to web module")
    return role


def require_all(role: str = Depends(require_auth)) -> str:
    """Requires 'all' role (web project tracker)."""
    if role != "all":
        raise HTTPException(status_code=403, detail="Access restricted to web project tracker module")
    return role


def require_admin(role: str = Depends(require_auth)) -> str:
    """
    Requires 'admin' OR 'editor' role — both get full PostgreSQL dashboard access.
    'editor' is the master/owner role in the regular app.
    'admin' is obtained via the dedicated Master@2026 password.
    """
    if role not in ("admin", "editor"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return role
