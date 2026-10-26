"""
Comments on pages, @mentions and the notifications they raise.

  GET    /api/pages/{id}/comments                       threads with replies (?status=open|resolved|all)
  POST   /api/pages/{id}/comments                       start a thread (optional anchor)
  POST   /api/pages/{id}/comments/{thread_id}/replies   reply in a thread
  PATCH  /api/pages/{id}/comments/{comment_id}          edit one's own comment
  DELETE /api/pages/{id}/comments/{comment_id}          delete one's own comment
  POST   /api/pages/{id}/comments/{thread_id}/resolve   resolve a thread
  POST   /api/pages/{id}/comments/{thread_id}/reopen    reopen it
  GET    /api/pages/{id}/mentions?q=                    people who can be mentioned on the page

  GET    /api/notifications                             the caller's notifications (?unread=1)
  GET    /api/notifications/unread-count
  POST   /api/notifications/{id}/read
  POST   /api/notifications/read-all

Who may comment follows who may open the page in the app (routers/pages.py):
its creator and the superadmin. Public viewers have no route here at all.
Everything that writes needs a signed-in account, since a comment has an
author. Before migration 0005 reads answer empty and writes 503.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..db.postgres import get_pool
from ..services import page_comments as C
from ..utils.tasks import spawn
from .deps import require_auth
from .pages import PageId, _can_see_all

logger = logging.getLogger("fintrack.comments")

router = APIRouter()


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

PAGE_SQL = "SELECT id, created_by, title, slug FROM published_pages WHERE id = $1"

_PERSON = (
    "{a}.id AS {p}id, {a}.first_name AS {p}first_name, {a}.last_name AS {p}last_name, "
    "{a}.full_name AS {p}full_name, {a}.email AS {p}email, {a}.avatar_url AS {p}avatar_url"
)

_COMMENT_SELECT = (
    "SELECT c.id, c.page_id, c.thread_id, c.parent_id, c.author_user_id, c.body, c.anchor, "
    "       c.resolved_at, c.created_at, c.edited_at, c.deleted_at, "
    f"      {_PERSON.format(a='a', p='a_')}, {_PERSON.format(a='r', p='r_')} "
    "  FROM page_comments c "
    "  LEFT JOIN auth_users a ON a.id = c.author_user_id "
    "  LEFT JOIN auth_users r ON r.id = c.resolved_by "
)
PAGE_COMMENTS_SQL = _COMMENT_SELECT + " WHERE c.page_id = $1 ORDER BY c.created_at, c.id"
THREAD_COMMENTS_SQL = _COMMENT_SELECT + " WHERE c.thread_id = $1 ORDER BY c.created_at, c.id"

ONE_COMMENT_SQL = (
    "SELECT id, page_id, thread_id, author_user_id, body, deleted_at, resolved_at "
    "FROM page_comments WHERE id = $1"
)
INSERT_COMMENT_SQL = (
    "INSERT INTO page_comments (id, page_id, thread_id, parent_id, author_user_id, body, anchor) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)"
)
EDIT_COMMENT_SQL = "UPDATE page_comments SET body = $2, edited_at = NOW() WHERE id = $1"
DELETE_COMMENT_SQL = "UPDATE page_comments SET deleted_at = NOW(), body = '' WHERE id = $1"
DROP_COMMENT_NOTIFICATIONS_SQL = "DELETE FROM notifications WHERE comment_id = $1"
RESOLVE_SQL = "UPDATE page_comments SET resolved_at = NOW(), resolved_by = $2 WHERE id = $1"
REOPEN_SQL = "UPDATE page_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = $1"
THREAD_AUTHORS_SQL = (
    "SELECT DISTINCT author_user_id FROM page_comments "
    "WHERE thread_id = $1 AND author_user_id IS NOT NULL AND deleted_at IS NULL"
)

# People who can open a page: its creator, and anyone whose primary role (the
# lowest-ranked, as in routers/deps.py) is superadmin. Active accounts only.
_ELIGIBLE = (
    "SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.avatar_url "
    "  FROM auth_users u "
    "  LEFT JOIN LATERAL ( "
    "    SELECT r.role_key FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id "
    "     WHERE ur.user_id = u.id ORDER BY r.rank ASC, ur.assigned_at ASC LIMIT 1 "
    "  ) pr ON TRUE "
    " WHERE u.status = 'active' AND u.disabled_at IS NULL "
    "   AND (u.id = $1::uuid OR pr.role_key = 'superadmin') "
)
MENTION_SEARCH_SQL = _ELIGIBLE + (
    "   AND ($2::text = '' OR u.email ILIKE $3 OR COALESCE(u.full_name, '') ILIKE $3 "
    "        OR CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $3) "
    " ORDER BY COALESCE(NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), ''), u.full_name, u.email) "
    " LIMIT 8"
)
MENTION_IDS_SQL = _ELIGIBLE + "   AND u.id = ANY($2::uuid[])"

INSERT_NOTIFICATION_SQL = (
    "INSERT INTO notifications (user_id, kind, page_id, comment_id, actor_user_id, payload) "
    "VALUES ($1, $2, $3, $4, $5, $6::jsonb)"
)
NOTIFICATIONS_SQL = (
    "SELECT n.id, n.kind, n.page_id, n.comment_id, n.payload, n.read_at, n.created_at, "
    "       p.title AS page_title, p.slug AS page_slug, c.thread_id, "
    f"      {_PERSON.format(a='a', p='a_')} "
    "  FROM notifications n "
    "  LEFT JOIN auth_users a ON a.id = n.actor_user_id "
    "  LEFT JOIN published_pages p ON p.id = n.page_id "
    "  LEFT JOIN page_comments c ON c.id = n.comment_id "
    " WHERE n.user_id = $1 AND ($2::boolean IS FALSE OR n.read_at IS NULL) "
    " ORDER BY n.created_at DESC LIMIT $3"
)
UNREAD_COUNT_SQL = "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL"
MARK_READ_SQL = (
    "UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL"
)
MARK_ALL_READ_SQL = "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL"
MARK_PAGE_READ_SQL = (
    "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND page_id = $2 AND read_at IS NULL"
)


# ---------------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------------

class NewThreadBody(BaseModel):
    body: str
    anchor: dict[str, Any] | None = None


class ReplyBody(BaseModel):
    body: str
    parent_id: str | None = None


class EditBody(BaseModel):
    body: str


class ReadAllBody(BaseModel):
    page_id: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _who(request: Request, role: str) -> tuple[str | None, str]:
    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    return (str(user_id) if user_id else None), auth_role


def _pool():
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    return pool


def _uuid_or_404(value: str, what: str = "Comment") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(404, f"{what} not found")


def _need_user(user_id: str | None) -> str:
    if not user_id:
        raise HTTPException(400, "Comments need a signed-in account")
    return user_id


async def _page(conn, page_id: str, user_id: str | None, auth_role: str) -> Any:
    row = await conn.fetchrow(PAGE_SQL, page_id)
    if not row:
        raise HTTPException(404, "Page not found")
    if not (_can_see_all(auth_role) or (user_id and str(row["created_by"]) == str(user_id))):
        raise HTTPException(403, "Access denied")
    return row


async def _require_ready(conn) -> None:
    if not await C.comments_ready(conn):
        raise HTTPException(503, C.NOT_READY)


def _body_or_422(text: str) -> str:
    body = C.clean_text(text)
    if not body:
        raise HTTPException(422, "A comment cannot be empty")
    return body


async def _eligible_by_id(conn, page: Any, ids: list[str]) -> dict[str, Any]:
    if not ids:
        return {}
    rows = await conn.fetch(MENTION_IDS_SQL, page["created_by"], ids)
    return {str(r["id"]): r for r in rows}


async def _apply_mentions(conn, page: Any, body: str) -> tuple[str, dict[str, Any]]:
    """Body with only valid mention tokens kept, and who they name."""
    people = await _eligible_by_id(conn, page, C.mention_ids(body))
    names = {uid: C.display_name(r) or "someone" for uid, r in people.items()}
    return C.keep_mentions(body, names), people


async def _load_thread(conn, page_id: str, thread_id: str, me: str | None) -> dict:
    rows = await conn.fetch(THREAD_COMMENTS_SQL, thread_id)
    threads = C.group_threads(rows, me)
    if not threads or threads[0]["page_id"] != page_id:
        raise HTTPException(404, "Thread not found")
    return threads[0]


async def _root(conn, page_id: str, thread_id: str) -> Any:
    row = await conn.fetchrow(ONE_COMMENT_SQL, thread_id)
    if not row or str(row["page_id"]) != page_id or str(row["thread_id"]) != str(row["id"]):
        raise HTTPException(404, "Thread not found")
    return row


async def _notify(conn, request: Request, page: Any, comment_id: str, thread_id: str,
                  actor: str, body: str, mentioned: dict[str, Any],
                  reply_to: list[str] | None = None) -> int:
    """Notification rows for mentions (and replies), then the optional
    mention email in the background. Returns how many rows were written."""
    payload = json.dumps({
        "page_title": page["title"] or "",
        "page_slug": page["slug"],
        "thread_id": thread_id,
        "excerpt": C.excerpt(body),
    })
    page_id = str(page["id"])
    rows = [(uid, "mention", page_id, comment_id, actor, payload)
            for uid in mentioned if uid != actor]
    told = {uid for uid in mentioned}
    for uid in reply_to or []:
        if uid != actor and uid not in told:
            told.add(uid)
            rows.append((uid, "reply", page_id, comment_id, actor, payload))
    if rows:
        await conn.executemany(INSERT_NOTIFICATION_SQL, rows)
    recipients = [{"id": uid, "email": r["email"]} for uid, r in mentioned.items() if uid != actor]
    if recipients:
        _queue_mention_email(request, page, thread_id, actor, body, recipients)
    return len(rows)


def _queue_mention_email(request, page, thread_id, actor, body, recipients) -> None:
    try:
        from ..services.emailer import app_origin_from_request, is_email_configured
        if not is_email_configured():
            return
        try:
            origin = app_origin_from_request(request)
        except Exception:
            origin = ""
        link = f"{origin}/pages?page={page['id']}&comments=1&thread={thread_id}" if origin else ""
        actor_name = getattr(request.state, "auth_user_name", None) or "A teammate"
        spawn(C.send_mention_emails(recipients, actor_name, page["title"] or "", body, link),
              name="mention-email")
    except Exception as exc:  # the comment is saved; the email is a bonus
        logger.warning("could not queue mention email: %s", exc)


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

@router.get("/api/pages/{page_id}/comments")
async def list_comments(page_id: PageId, request: Request, status: str = "all",
                        role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        await _page(conn, page_id, user_id, auth_role)
        if not await C.comments_ready(conn):
            return {"ready": False, "threads": [], "counts": {"open": 0, "resolved": 0}}
        rows = await conn.fetch(PAGE_COMMENTS_SQL, page_id)
    threads = C.group_threads(rows, user_id)
    counts = {
        "open": sum(1 for t in threads if not t["resolved_at"]),
        "resolved": sum(1 for t in threads if t["resolved_at"]),
    }
    if status == "open":
        threads = [t for t in threads if not t["resolved_at"]]
    elif status == "resolved":
        threads = [t for t in threads if t["resolved_at"]]
    return {"ready": True, "threads": threads, "counts": counts}


@router.post("/api/pages/{page_id}/comments")
async def create_thread(page_id: PageId, body: NewThreadBody, request: Request,
                        role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    me = _need_user(user_id)
    text = _body_or_422(body.body)
    anchor = C.clean_anchor(body.anchor)
    pool = _pool()
    async with pool.acquire() as conn:
        page = await _page(conn, page_id, user_id, auth_role)
        await _require_ready(conn)
        text, mentioned = await _apply_mentions(conn, page, text)
        cid = str(uuid.uuid4())
        async with conn.transaction():
            await conn.execute(INSERT_COMMENT_SQL, cid, page_id, cid, None, me, text,
                               json.dumps(anchor) if anchor else None)
            await _notify(conn, request, page, cid, cid, me, text, mentioned)
        return await _load_thread(conn, page_id, cid, me)


@router.post("/api/pages/{page_id}/comments/{thread_id}/replies")
async def reply(page_id: PageId, thread_id: str, body: ReplyBody, request: Request,
                role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    me = _need_user(user_id)
    thread_id = _uuid_or_404(thread_id, "Thread")
    text = _body_or_422(body.body)
    pool = _pool()
    async with pool.acquire() as conn:
        page = await _page(conn, page_id, user_id, auth_role)
        await _require_ready(conn)
        root = await _root(conn, page_id, thread_id)
        parent_id = thread_id
        if body.parent_id:
            pid = _uuid_or_404(body.parent_id)
            parent = await conn.fetchrow(ONE_COMMENT_SQL, pid)
            if not parent or str(parent["thread_id"]) != thread_id:
                raise HTTPException(404, "Comment not found")
            parent_id = pid
        text, mentioned = await _apply_mentions(conn, page, text)
        participants = [str(r["author_user_id"]) for r in await conn.fetch(THREAD_AUTHORS_SQL, thread_id)]
        cid = str(uuid.uuid4())
        async with conn.transaction():
            await conn.execute(INSERT_COMMENT_SQL, cid, page_id, thread_id, parent_id, me, text, None)
            if root["resolved_at"] is not None:
                # A new reply means the discussion is live again.
                await conn.execute(REOPEN_SQL, thread_id)
            await _notify(conn, request, page, cid, thread_id, me, text, mentioned, participants)
        thread = await _load_thread(conn, page_id, thread_id, me)
    comment = next((c for c in thread["comments"] if c["id"] == cid), None)
    return {"comment": comment, "thread": thread}


@router.patch("/api/pages/{page_id}/comments/{comment_id}")
async def edit_comment(page_id: PageId, comment_id: str, body: EditBody, request: Request,
                       role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    me = _need_user(user_id)
    comment_id = _uuid_or_404(comment_id)
    text = _body_or_422(body.body)
    pool = _pool()
    async with pool.acquire() as conn:
        page = await _page(conn, page_id, user_id, auth_role)
        await _require_ready(conn)
        row = await conn.fetchrow(ONE_COMMENT_SQL, comment_id)
        if not row or str(row["page_id"]) != page_id or row["deleted_at"] is not None:
            raise HTTPException(404, "Comment not found")
        if str(row["author_user_id"]) != me:
            raise HTTPException(403, "Only the author can edit a comment")
        text, mentioned = await _apply_mentions(conn, page, text)
        already = set(C.mention_ids(row["body"]))
        fresh = {uid: r for uid, r in mentioned.items() if uid not in already}
        async with conn.transaction():
            await conn.execute(EDIT_COMMENT_SQL, comment_id, text)
            if fresh:
                await _notify(conn, request, page, comment_id, str(row["thread_id"]), me, text, fresh)
        return await _load_thread(conn, page_id, str(row["thread_id"]), me)


@router.delete("/api/pages/{page_id}/comments/{comment_id}")
async def delete_comment(page_id: PageId, comment_id: str, request: Request,
                         role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    me = _need_user(user_id)
    comment_id = _uuid_or_404(comment_id)
    pool = _pool()
    async with pool.acquire() as conn:
        await _page(conn, page_id, user_id, auth_role)
        await _require_ready(conn)
        row = await conn.fetchrow(ONE_COMMENT_SQL, comment_id)
        if not row or str(row["page_id"]) != page_id:
            raise HTTPException(404, "Comment not found")
        if row["deleted_at"] is not None:
            return {"ok": True, "deleted": comment_id}
        if str(row["author_user_id"]) != me and not _can_see_all(auth_role):
            raise HTTPException(403, "Only the author can delete a comment")
        async with conn.transaction():
            await conn.execute(DELETE_COMMENT_SQL, comment_id)
            await conn.execute(DROP_COMMENT_NOTIFICATIONS_SQL, comment_id)
    return {"ok": True, "deleted": comment_id, "thread_id": str(row["thread_id"])}


async def _set_resolved(page_id: str, thread_id: str, request: Request, role: str, resolved: bool) -> dict:
    user_id, auth_role = _who(request, role)
    me = _need_user(user_id)
    thread_id = _uuid_or_404(thread_id, "Thread")
    pool = _pool()
    async with pool.acquire() as conn:
        await _page(conn, page_id, user_id, auth_role)
        await _require_ready(conn)
        await _root(conn, page_id, thread_id)
        if resolved:
            await conn.execute(RESOLVE_SQL, thread_id, me)
        else:
            await conn.execute(REOPEN_SQL, thread_id)
        return await _load_thread(conn, page_id, thread_id, me)


@router.post("/api/pages/{page_id}/comments/{thread_id}/resolve")
async def resolve_thread(page_id: PageId, thread_id: str, request: Request,
                         role: str = Depends(require_auth)):
    return await _set_resolved(page_id, thread_id, request, role, True)


@router.post("/api/pages/{page_id}/comments/{thread_id}/reopen")
async def reopen_thread(page_id: PageId, thread_id: str, request: Request,
                        role: str = Depends(require_auth)):
    return await _set_resolved(page_id, thread_id, request, role, False)


@router.get("/api/pages/{page_id}/mentions")
async def mention_search(page_id: PageId, request: Request, q: str = "",
                         role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    q = C.clean_text(q, 80)
    like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    pool = _pool()
    async with pool.acquire() as conn:
        page = await _page(conn, page_id, user_id, auth_role)
        rows = await conn.fetch(MENTION_SEARCH_SQL, page["created_by"], q, like)
    return [
        {"id": str(r["id"]), "name": C.display_name(r) or r["email"], "email": r["email"],
         "avatar_url": r["avatar_url"], "me": bool(user_id and str(r["id"]) == user_id)}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def _notification_dict(r: Any) -> dict:
    payload = C.load_json(r["payload"]) or {}
    return {
        "id": str(r["id"]),
        "kind": r["kind"],
        "page_id": str(r["page_id"]) if r["page_id"] else None,
        "page_title": r["page_title"] if r["page_title"] is not None else payload.get("page_title", ""),
        "page_slug": r["page_slug"] or payload.get("page_slug"),
        "comment_id": str(r["comment_id"]) if r["comment_id"] else None,
        "thread_id": str(r["thread_id"]) if r["thread_id"] else payload.get("thread_id"),
        "excerpt": payload.get("excerpt", ""),
        "actor": C.person(r, "a_"),
        "read": r["read_at"] is not None,
        "read_at": C.iso(r["read_at"]),
        "created_at": C.iso(r["created_at"]),
    }


@router.get("/api/notifications")
async def list_notifications(request: Request, unread: bool = False, limit: int = 30,
                             role: str = Depends(require_auth)):
    user_id, _ = _who(request, role)
    limit = max(1, min(limit, 100))
    pool = get_pool()
    if not user_id or not pool:
        return {"ready": bool(pool), "items": [], "unread": 0}
    async with pool.acquire() as conn:
        if not await C.comments_ready(conn):
            return {"ready": False, "items": [], "unread": 0}
        rows = await conn.fetch(NOTIFICATIONS_SQL, user_id, bool(unread), limit)
        count = await conn.fetchval(UNREAD_COUNT_SQL, user_id)
    return {"ready": True, "items": [_notification_dict(r) for r in rows], "unread": int(count or 0)}


@router.get("/api/notifications/unread-count")
async def unread_count(request: Request, role: str = Depends(require_auth)):
    user_id, _ = _who(request, role)
    pool = get_pool()
    if not user_id or not pool:
        return {"count": 0}
    async with pool.acquire() as conn:
        if not await C.comments_ready(conn):
            return {"count": 0}
        count = await conn.fetchval(UNREAD_COUNT_SQL, user_id)
    return {"count": int(count or 0)}


@router.post("/api/notifications/read-all")
async def mark_all_read(request: Request, body: ReadAllBody | None = None,
                        role: str = Depends(require_auth)):
    user_id, _ = _who(request, role)
    me = _need_user(user_id)
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        if body and body.page_id:
            await conn.execute(MARK_PAGE_READ_SQL, me, _uuid_or_404(body.page_id, "Page"))
        else:
            await conn.execute(MARK_ALL_READ_SQL, me)
        count = await conn.fetchval(UNREAD_COUNT_SQL, me)
    return {"ok": True, "unread": int(count or 0)}


@router.post("/api/notifications/{notification_id}/read")
async def mark_read(notification_id: str, request: Request, role: str = Depends(require_auth)):
    user_id, _ = _who(request, role)
    me = _need_user(user_id)
    nid = _uuid_or_404(notification_id, "Notification")
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        await conn.execute(MARK_READ_SQL, nid, me)
        count = await conn.fetchval(UNREAD_COUNT_SQL, me)
    return {"ok": True, "unread": int(count or 0)}
