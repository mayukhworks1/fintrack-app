"""
Page comments: text cleaning, mention tokens, anchors, readiness and the
mention email.

Migration 0005 adds page_comments and notifications. Migrations run in a
thread at boot and may not have reached the database yet, so the routers ask
`comments_ready` first: reads answer empty, writes answer 503 with a reason.

Bodies are plain text. A mention is the token "@[Display Name](<user uuid>)";
the server keeps a token only when the id belongs to someone who can open the
page, and turns any other into plain "@Display Name" text.
"""

from __future__ import annotations

import html
import json
import logging
import re
import time
import uuid
from datetime import datetime
from typing import Any, Iterable

logger = logging.getLogger("fintrack.page_comments")

NOT_READY = "Comments are not ready yet (database migration 0005 has not run)."

MAX_BODY = 5000
MAX_QUOTE = 500
MAX_MENTIONS = 20

_RETRY_S = 30.0
_ready: bool | None = None
_ready_checked_at = 0.0

READY_SQL = (
    "SELECT to_regclass('page_comments') IS NOT NULL "
    "AND to_regclass('notifications') IS NOT NULL"
)


def reset_ready_cache() -> None:
    global _ready, _ready_checked_at
    _ready, _ready_checked_at = None, 0.0


async def comments_ready(conn) -> bool:
    """True once migration 0005's tables exist. Never raises."""
    global _ready, _ready_checked_at
    if _ready:
        return True
    if _ready is False and time.monotonic() - _ready_checked_at < _RETRY_S:
        return False
    try:
        ok = bool(await conn.fetchval(READY_SQL))
    except Exception as exc:
        logger.debug("comments readiness check failed: %s", exc)
        ok = False
    _ready, _ready_checked_at = ok, time.monotonic()
    return ok


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

MENTION_RE = re.compile(r"@\[([^\[\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)")
_TAG_RE = re.compile(r"</?[A-Za-z!][^<>]*>")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")


def clean_text(text: str | None, limit: int = MAX_BODY) -> str:
    """Plain text only: no markup, no control characters, bounded length."""
    s = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    s = _CTRL_RE.sub("", s)
    # Strip anything shaped like an HTML tag. Lone "<" or ">" (a < b) survive;
    # the client renders text, never markup, so they are harmless.
    prev = None
    while prev != s:
        prev, s = s, _TAG_RE.sub("", s)
    s = re.sub(r"\n{4,}", "\n\n\n", s)
    s = "\n".join(line.rstrip() for line in s.split("\n")).strip()
    return s[:limit]


def mention_ids(body: str) -> list[str]:
    """Distinct user ids named by mention tokens, in order of appearance."""
    out: list[str] = []
    for m in MENTION_RE.finditer(body or ""):
        try:
            uid = str(uuid.UUID(m.group(2)))
        except ValueError:
            continue
        if uid not in out:
            out.append(uid)
    return out[:MAX_MENTIONS]


def keep_mentions(body: str, allowed: dict[str, str]) -> str:
    """Keep tokens for allowed ids (with the server's name for them); turn the
    rest into plain "@Name" text."""
    def swap(m: re.Match) -> str:
        try:
            uid = str(uuid.UUID(m.group(2)))
        except ValueError:
            uid = ""
        label = m.group(1).strip() or "someone"
        if uid in allowed:
            name = _token_safe(allowed[uid] or label)
            return f"@[{name}]({uid})"
        return f"@{label}"
    return MENTION_RE.sub(swap, body or "")


def _token_safe(name: str) -> str:
    return re.sub(r"[\[\]\(\)\n]", "", name).strip()[:80] or "someone"


def plain(body: str) -> str:
    """Body with mention tokens shown as "@Name" (excerpts, email)."""
    return MENTION_RE.sub(lambda m: "@" + m.group(1), body or "")


def excerpt(body: str, n: int = 140) -> str:
    s = re.sub(r"\s+", " ", plain(body)).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ---------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------

_BLOCK_ID_RE = re.compile(r"^[A-Za-z0-9_:.\-]{1,100}$")


def clean_anchor(raw: Any) -> dict | None:
    """{block_id, from, to, quote} with every field optional; None if empty."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    bid = raw.get("block_id")
    if isinstance(bid, str) and _BLOCK_ID_RE.match(bid):
        out["block_id"] = bid
    for key in ("from", "to"):
        v = raw.get(key)
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)) and 0 <= v < 10_000_000:
            out[key] = int(v)
    if "from" in out and "to" in out and out["to"] < out["from"]:
        out["from"], out["to"] = out["to"], out["from"]
    quote = raw.get("quote")
    if isinstance(quote, str):
        q = clean_text(quote, MAX_QUOTE)
        if q:
            out["quote"] = q
    return out or None


def load_json(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------

def iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def display_name(row: Any, prefix: str = "") -> str | None:
    def get(k):
        try:
            return row[prefix + k]
        except (KeyError, IndexError, TypeError):
            return None
    first, last = get("first_name"), get("last_name")
    joined = " ".join(x for x in (first, last) if x and str(x).strip()).strip()
    return joined or get("full_name") or get("email") or None


def person(row: Any, prefix: str) -> dict | None:
    try:
        uid = row[prefix + "id"]
    except (KeyError, IndexError, TypeError):
        uid = None
    if uid is None:
        return None
    try:
        avatar = row[prefix + "avatar_url"]
    except (KeyError, IndexError, TypeError):
        avatar = None
    return {"id": str(uid), "name": display_name(row, prefix) or "Someone", "avatar_url": avatar}


def comment_dict(row: Any, me: str | None) -> dict:
    deleted = row["deleted_at"] is not None
    author = person(row, "a_")
    return {
        "id": str(row["id"]),
        "thread_id": str(row["thread_id"]),
        "parent_id": str(row["parent_id"]) if row["parent_id"] else None,
        "author": author,
        "body": "" if deleted else row["body"],
        "created_at": iso(row["created_at"]),
        "edited_at": iso(row["edited_at"]),
        "deleted": deleted,
        "mine": bool(me and author and author["id"] == str(me)),
    }


def group_threads(rows: Iterable[Any], me: str | None) -> list[dict]:
    """Rows ordered by created_at -> threads, newest activity first. A thread
    with nothing left but deleted comments is dropped."""
    threads: dict[str, dict] = {}
    for r in rows:
        tid = str(r["thread_id"])
        if str(r["id"]) == tid:
            threads[tid] = {
                "id": tid,
                "page_id": str(r["page_id"]),
                "anchor": load_json(r["anchor"]),
                "resolved_at": iso(r["resolved_at"]),
                "resolved_by": person(r, "r_"),
                "created_at": iso(r["created_at"]),
                "comments": [],
                "_last": r["created_at"],
            }
    for r in rows:
        t = threads.get(str(r["thread_id"]))
        if t is None:
            continue
        t["comments"].append(comment_dict(r, me))
        if r["created_at"] and (t["_last"] is None or r["created_at"] > t["_last"]):
            t["_last"] = r["created_at"]
    out = []
    for t in threads.values():
        if all(c["deleted"] for c in t["comments"]):
            continue
        t["reply_count"] = max(0, len(t["comments"]) - 1)
        t["last_activity_at"] = iso(t.pop("_last"))
        out.append(t)
    out.sort(key=lambda t: str(t["last_activity_at"] or ""), reverse=True)
    return out


# ---------------------------------------------------------------------------
# Mention email: optional, rate-limited, never on the request path
# ---------------------------------------------------------------------------

MAIL_WINDOW_S = 600   # at most one mention email per person per 10 minutes
_mail_sent: dict[str, float] = {}


async def _may_mail(user_id: str) -> bool:
    now = time.monotonic()
    for k in [k for k, t in _mail_sent.items() if now - t > MAIL_WINDOW_S]:
        _mail_sent.pop(k, None)
    if user_id in _mail_sent:
        return False
    try:
        from ..db.valkey import set_nx
        if not await set_nx(f"mention_mail:{user_id}", "1", ttl=MAIL_WINDOW_S):
            return False
    except Exception:
        pass
    _mail_sent[user_id] = now
    return True


async def send_mention_emails(recipients: list[dict], actor_name: str, page_title: str,
                              body: str, link: str) -> int:
    """Email each mentioned person, at most once per window. Returns the count
    sent. Swallows every error: this runs in the background."""
    sent = 0
    try:
        from .emailer import email_wrap_html, is_email_configured, send_email
        if not is_email_configured():
            return 0
        text_excerpt = excerpt(body, 400)
        for r in recipients:
            email = r.get("email")
            if not email or not await _may_mail(str(r["id"])):
                continue
            title = page_title or "Untitled"
            subject = f"{actor_name} mentioned you on {title}"
            text = f"{actor_name} mentioned you on \"{title}\":\n\n{text_excerpt}\n\nOpen: {link}\n"
            inner = (
                f"<p style=\"margin:0 0 12px\"><strong>{html.escape(actor_name)}</strong> mentioned you on "
                f"<strong>{html.escape(title)}</strong>.</p>"
                f"<blockquote style=\"margin:0 0 18px;padding:10px 14px;border-left:3px solid #6366f1;"
                f"background:#f8fafc;color:#334155\">{html.escape(text_excerpt)}</blockquote>"
                + (f"<p style=\"margin:0\"><a href=\"{html.escape(link, quote=True)}\" "
                   f"style=\"color:#4f46e5;font-weight:600\">Open the comment</a></p>" if link else "")
            )
            res = await send_email(email, subject, text, email_wrap_html(subject, text_excerpt[:120], inner, email))
            if res.get("sent"):
                sent += 1
    except Exception as exc:
        logger.warning("mention email failed: %s", exc)
    return sent
