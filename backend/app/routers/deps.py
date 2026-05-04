"""
Shared FastAPI dependencies for auth + role checks.

Usage:
    from .deps import require_auth, require_editor

    @router.get("/something")
    async def read_something(role: str = Depends(require_auth)):
        ...

    @router.post("/something")
    async def create_something(role: str = Depends(require_editor)):
        ...
"""
from fastapi import Depends, Header, HTTPException
from .auth import verify_token


def _get_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    return authorization.split(" ", 1)[1].strip()


def require_auth(token: str = Depends(_get_token)) -> str:
    """Accepts any valid token (editor or viewer). Returns the role."""
    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return role


def require_editor(role: str = Depends(require_auth)) -> str:
    """Requires a valid editor token. Raises 403 for viewer/web tokens."""
    if role != "editor":
        raise HTTPException(
            status_code=403,
            detail="This action requires editor access",
        )
    return role


def require_web(role: str = Depends(require_auth)) -> str:
    """Requires a web token. Only the web role can access web invoice routes."""
    if role != "web":
        raise HTTPException(
            status_code=403,
            detail="Access restricted to web invoice module",
        )
    return role


def require_all(role: str = Depends(require_auth)) -> str:
    """Requires an 'all' token. Only the all role can access web project tracker routes."""
    if role != "all":
        raise HTTPException(
            status_code=403,
            detail="Access restricted to web project tracker module",
        )
    return role
