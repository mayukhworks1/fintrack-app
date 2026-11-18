"""
The sign-in key generation ("token epoch") behind Admin → Sign out everyone.

Login tokens are signed with APP_SECRET, and from generation 1 on with
APP_SECRET plus the generation number (routers/auth.py _sign). Raising the
generation makes every existing token fail its signature check, the shared
role-password tokens included, without changing APP_SECRET. Generation 0 signs
exactly as before, so nothing changes until the switch is first used.

The value lives in Postgres (security_state) so it survives restarts, and is
read into memory at startup and every REFRESH_S seconds, so a worker that did
not handle the request catches up quickly.
"""
from __future__ import annotations

import asyncio
import logging

from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.security")

REFRESH_S = 30
_epoch = 0

GET_SQL = "SELECT value FROM security_state WHERE key = 'token_epoch'"
BUMP_SQL = (
    "INSERT INTO security_state (key, value, updated_by) VALUES ('token_epoch', '1', $1) "
    "ON CONFLICT (key) DO UPDATE SET value = (security_state.value::int + 1)::text, "
    "updated_at = NOW(), updated_by = $1 RETURNING value"
)
REVOKE_ALL_SQL = "UPDATE auth_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL"


def token_epoch() -> int:
    return _epoch


async def load_epoch(pool=None) -> int:
    """Read the generation from the database; keeps the last value on error."""
    global _epoch
    pool = pool or get_pool()
    if not pool:
        return _epoch
    try:
        async with pool.acquire() as conn:
            raw = await conn.fetchval(GET_SQL)
        _epoch = int(raw or 0)
    except Exception as exc:  # noqa: BLE001 - table may not exist before the migration
        logger.debug("token epoch not loaded: %s", exc)
    return _epoch


async def sign_out_everyone(actor: str, pool=None) -> dict:
    """Invalidate every login token and session. Returns the new generation."""
    global _epoch
    pool = pool or get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            raw = await conn.fetchval(BUMP_SQL, actor[:200])
            status = await conn.execute(REVOKE_ALL_SQL)
    _epoch = int(raw)
    try:
        revoked = int(str(status).split()[-1])
    except (ValueError, IndexError):
        revoked = 0
    logger.warning("SECURITY: sign out everyone by %s (generation %s, %s sessions revoked)", actor, _epoch, revoked)
    return {"generation": _epoch, "sessions_revoked": revoked}


async def refresh_loop() -> None:
    while True:
        await load_epoch()
        await asyncio.sleep(REFRESH_S)
