"""
WebSocket endpoint for live co-editing of block documents.

    /api/collab/pages/{page_id}

The bearer token travels in the first frame, {"type": "auth", "token": ...},
never in the URL, so it cannot reach an access log or a proxy's. Access is
the same as PUT /api/pages/{id}: the page's owner, or a superadmin, and only
for a page of content_type "doc" that is not in the trash.

The protocol and the rooms live in services/collab.py.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..services import collab, page_doc
from .deps import require_auth

logger = logging.getLogger("fintrack.collab")

router = APIRouter()


async def authenticate(websocket: WebSocket, token: str) -> collab.Identity:
    """The REST API's token check, run against the socket's connection.
    Raises HTTPException like require_auth does."""
    role = await require_auth(websocket, token)  # type: ignore[arg-type]
    st = websocket.state
    auth_role = getattr(st, "auth_role", None) or role
    name = getattr(st, "auth_user_name", None) or getattr(st, "auth_user_email", None) or "Editor"
    return collab.Identity(user_id=getattr(st, "auth_user_id", None), name=str(name)[:60], role=str(auth_role))


def can_edit(identity: collab.Identity, record: collab.PageRecord) -> bool:
    """Same rule as update_page: superadmin, or the page's creator."""
    return identity.role == "superadmin" or (record.created_by is not None and str(record.created_by) == str(identity.user_id))


async def _close(websocket: WebSocket, code: int, reason: str = "") -> None:
    if websocket.application_state == WebSocketState.CONNECTED:
        try:
            await websocket.close(code=code, reason=reason[:120])
        except Exception:
            pass


async def _authorise(websocket: WebSocket, token: str, page_id: str) -> tuple[collab.Identity, collab.PageRecord] | int:
    """Identity and page, or the close code that refuses the socket."""
    try:
        identity = await authenticate(websocket, token)
    except HTTPException as exc:
        return collab.CLOSE_FORBIDDEN if exc.status_code == 403 else collab.CLOSE_UNAUTHORIZED
    try:
        record = await collab.get_hub().store.load(page_id)
    except Exception as exc:
        logger.warning("collab: loading page failed: %s", exc)
        return 1011
    if record is None or record.trashed or record.content_type != page_doc.DOC_TYPE:
        return collab.CLOSE_NOT_FOUND
    if not can_edit(identity, record):
        return collab.CLOSE_FORBIDDEN
    return identity, record


@router.websocket("/api/collab/pages/{page_id}")
async def collab_socket(websocket: WebSocket, page_id: str):
    limits = collab.limits
    try:
        page_id = str(uuid.UUID(page_id))
    except ValueError:
        await websocket.close(code=collab.CLOSE_NOT_FOUND)
        return
    await websocket.accept()

    # 1. The first frame carries the token.
    try:
        first = await asyncio.wait_for(websocket.receive(), timeout=limits.auth_timeout_s)
    except asyncio.TimeoutError:
        await _close(websocket, collab.CLOSE_TIMEOUT, "authentication timed out")
        return
    if first.get("type") == "websocket.disconnect":
        return
    token = None
    text = first.get("text")
    if isinstance(text, str) and len(text) <= 8192:
        try:
            msg = json.loads(text)
            if isinstance(msg, dict) and msg.get("type") == "auth" and isinstance(msg.get("token"), str):
                token = msg["token"]
        except ValueError:
            pass
    if not token:
        await _close(websocket, collab.CLOSE_UNAUTHORIZED, "authentication required")
        return

    result = await _authorise(websocket, token, page_id)
    if isinstance(result, int):
        await _close(websocket, result, "not allowed")
        return
    identity, record = result

    # 2. Join the page's room.
    hub = collab.get_hub()
    client = collab.Client(
        send_bytes=websocket.send_bytes,
        send_text=websocket.send_text,
        close=lambda code, reason: _close(websocket, code, reason),
        identity=identity,
    )
    try:
        room = await hub.join(record, client)
    except collab.RoomFull as exc:
        client.close(collab.CLOSE_FULL, str(exc))
        await client.finish()
        return

    # 3. Relay frames until either side goes.
    try:
        while not client.closed:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            client.last_seen = time.monotonic()
            room.last_active = client.last_seen
            data = message.get("bytes")
            if data is not None:
                if len(data) > limits.max_message_bytes:
                    client.close(collab.CLOSE_MESSAGE_TOO_BIG, "message too large")
                    break
                try:
                    room.handle(client, data)
                except Exception as exc:
                    logger.info("collab: bad frame on page %s: %s", page_id[:8], type(exc).__name__)
                    client.close(collab.CLOSE_BAD_REQUEST, "malformed message")
                    break
                continue
            text = message.get("text")
            if text is None:
                continue
            if len(text) > 4096:
                client.close(collab.CLOSE_MESSAGE_TOO_BIG, "message too large")
                break
            try:
                ctl = json.loads(text)
            except ValueError:
                continue
            if isinstance(ctl, dict) and ctl.get("type") == "ping":
                client.send_json({"type": "pong"})
                # A revoked session or a lost permission ends the session within
                # REAUTH_S, not at the next reconnect.
                if time.monotonic() - client.authed_at > limits.reauth_s:
                    again = await _authorise(websocket, token, page_id)
                    if isinstance(again, int):
                        client.close(again, "access changed")
                        break
                    client.authed_at = time.monotonic()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(room, client)
        await client.finish()
        await _close(websocket, 1000)
