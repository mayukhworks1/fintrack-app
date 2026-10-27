"""
The shared-data API behind window.fintrack.db (see services/artifact_data.py).

Two doors to the same records:

  /api/public/pages/{slug}/data/...   a published artifact, for anyone who can
                                      open it: the same checks as the page and
                                      its render URL (published, not in the
                                      trash, not expired, and the unlock token
                                      from /verify when it has a password).
  /api/pages/{page_id}/data/...       the owner (creator or superadmin), signed
                                      in, published or not: the editor preview
                                      and the Data panel use these, and only
                                      here are clear, export and settings.

Under either door:

  GET    ""                              me, settings, cursor, rev
  GET    /changes?since=&wait=&rev=      everything after a cursor, deletes
                                         included; waits up to `wait` seconds
                                         (long-poll) for the first change
  GET    /doc                            every document (db.doc) in a scope
  GET    /doc/{name}   PUT /doc/{name}   one keyed record
  POST   /doc/{name}/increment
  GET    /files  POST /files  DELETE /files/{id}
  GET    /{collection}?where=&order_by=&desc=&limit=&since=&scope=
  GET    /{collection}/count?where=&scope=
  POST   /{collection}                   add
  POST   /{collection}/upsert            write by key
  GET    /{collection}/{id}  PATCH /{collection}/{id}  DELETE /{collection}/{id}
  POST   /{collection}/{id}/increment

Visitors are identified by X-Visitor-Id, a random id the app keeps in its own
storage (never the frame's); a signed-in user acts as themselves. Bodies are
JSON objects only, read with a size cap before parsing.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..db.postgres import get_pool
from ..services import artifact
from ..services import artifact_data as D
from ..services import page_tree
from ..utils.client_ip import client_ip
from ..utils.csv_safe import csv_safe_row
from ..utils.tasks import spawn
from . import pages as P
from .deps import require_auth

logger = logging.getLogger("fintrack.artifact_data")

router = APIRouter()

NO_STORE = {"Cache-Control": "no-store"}
FILE_PREFIX = "pages/artifact-data/"


def _json(body: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers=NO_STORE)


def _pool():
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    return pool


class Ctx:
    """A resolved request: which page, who is asking, and the page's settings."""

    def __init__(self, page_id: str, actor: D.Actor, conf: dict, rev_sql: str, rev: str | None,
                 public: bool, ip: str):
        self.page_id = page_id
        self.actor = actor
        self.conf = conf
        self.rev_sql = rev_sql
        self.rev = rev
        self.public = public
        self.ip = ip


async def _optional_user(request: Request) -> tuple[str | None, str | None]:
    """A signed-in user on a public route acts as themselves; any problem with
    the token makes them an anonymous visitor, never an error."""
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None, None
    try:
        role = await require_auth(request, auth.split(" ", 1)[1].strip())
    except HTTPException:
        return None, None
    except Exception as exc:  # the auth lookup itself failed: read as a visitor
        logger.debug("optional auth failed: %s", exc)
        return None, None
    return getattr(request.state, "auth_user_id", None), getattr(request.state, "auth_role", None) or role


async def _rev_sql(conn) -> str:
    return "COALESCE(published_at_rev, published_at)" if await page_tree.perf_ready(conn) else "published_at"


async def public_ctx(request: Request, slug: str) -> Ctx:
    pool = _pool()
    async with pool.acquire() as conn:
        await D.require_ready(conn)
        tree = await page_tree.tree_ready(conn)
        perf = await page_tree.perf_ready(conn)
        cols = ("id, slug, content_type, is_published, is_password_protected, expires_at, created_by, "
                "metadata, published_at" + (", deleted_at" if tree else "")
                + (", published_content_type, published_at_rev" if perf else ""))
        row = await conn.fetchrow(f"SELECT {cols} FROM published_pages WHERE slug = $1", slug)
        rev_sql = await _rev_sql(conn)
    P.check_public_access(row, slug=slug, token=request.headers.get("x-page-token"), unlock=True)
    ctype = (page_tree.field(row, "published_content_type") or row["content_type"])
    if not artifact.is_rendered(ctype):
        raise HTTPException(404, "Page not found")
    user_id, role = await _optional_user(request)
    page_id = str(row["id"])
    actor = D.Actor(page_id=page_id, is_owner=bool(user_id) and P._owns_page(row, user_id, role or ""),
                    user_id=user_id, visitor=D.visitor_hash(request.headers.get("x-visitor-id")))
    rev = page_tree.field(row, "published_at_rev") or row["published_at"]
    settings = D.settings_of(row["metadata"])
    if ctype != artifact.CONTENT_TYPE:
        # A Web Page is served by the same renderer, but only an artifact takes
        # data from visitors: anywhere else the store is read-only to them.
        settings = {**settings, "access": "owner"}
    return Ctx(page_id, actor, settings, rev_sql, D._iso(rev), True, client_ip(request))


async def owner_ctx(request: Request, page_id: str, role: str) -> Ctx:
    pool = _pool()
    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    async with pool.acquire() as conn:
        await D.require_ready(conn)
        row = await conn.fetchrow(
            "SELECT id, created_by, content_type, metadata FROM published_pages WHERE id = $1", page_id)
        rev_sql = await _rev_sql(conn)
    if not row:
        raise HTTPException(404, "Page not found")
    if not P._owns_page(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    if not artifact.is_rendered(row["content_type"]):
        raise HTTPException(400, "Only artifacts keep shared data.")
    actor = D.Actor(page_id=page_id, is_owner=True, user_id=user_id,
                    visitor=D.visitor_hash(request.headers.get("x-visitor-id")))
    return Ctx(page_id, actor, D.settings_of(row["metadata"]), rev_sql, None, False, client_ip(request))


async def _body(request: Request) -> dict:
    return D.parse_body(await request.body())


async def _writing(ctx: Ctx, *, files: bool = False) -> None:
    """Every write: a public one needs an identity and passes the rate limits."""
    if not ctx.public:
        return
    who = ctx.actor.identity
    if not who:
        raise HTTPException(400, "A visitor id is required to change data. Reload the page and try again.")
    await D.check_write_rate(ctx.page_id, who, ctx.ip, files=files)


def _record_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError):
        raise HTTPException(404, "That record does not exist (it may have been deleted).")


def _scope(value: Any, ctx: Ctx, *, allow_all: bool = False) -> str:
    if allow_all and value == "all":
        if not ctx.actor.is_owner:
            raise HTTPException(403, "Only the owner can see everyone's data.")
        return "all"
    return D.scope_of(value)


def _done(ctx: Ctx, record: dict) -> JSONResponse:
    D.notify(ctx.page_id)
    record.pop("_before", None)
    return _json(record)


# ---------------------------------------------------------------------------
# Handlers shared by both doors
# ---------------------------------------------------------------------------


async def h_session(ctx: Ctx) -> JSONResponse:
    async with _pool().acquire() as conn:
        cursor = await D.cursor_of(conn, ctx.page_id)
        out = {"me": ctx.actor.me(ctx.conf), "settings": ctx.conf, "cursor": cursor, "rev": ctx.rev,
               "limits": {"records": D.MAX_RECORDS_PER_PAGE, "record_bytes": D.MAX_RECORD_BYTES,
                          "collections": D.MAX_COLLECTIONS, "file_bytes": D.MAX_FILE_BYTES}}
        if not ctx.public:
            out["collections"] = await D.summary(conn, ctx.page_id)
    return _json(out)


async def h_changes(ctx: Ctx, request: Request) -> JSONResponse:
    q = request.query_params
    since = D.finite_int(q.get("since"), 0)
    wait = min(float(D.finite_int(q.get("wait"), 0)), D.MAX_WAIT_S)
    scope = "all" if (q.get("all") in ("1", "true") and ctx.actor.is_owner) else "visible"
    res = await D.wait_for_changes(_pool(), ctx.page_id, ctx.actor, since, wait, rev_sql=ctx.rev_sql,
                                   known_rev=q.get("rev") or None, scope=scope)
    if not ctx.public:
        res.pop("rev", None)
    return _json(res)


async def h_list(ctx: Ctx, request: Request, collection: str) -> JSONResponse:
    D.collection_name(collection)
    q = request.query_params
    scope = _scope(q.get("scope"), ctx, allow_all=True)
    order_by, desc = D.parse_order(q.get("order_by"), q.get("desc"))
    since = D.finite_int(q.get("since"))
    async with _pool().acquire() as conn:
        res = await D.list_records(conn, ctx.page_id, collection, ctx.actor, scope=scope, since=since,
                                   limit=D.finite_int(q.get("limit")), where=D.parse_where(q.get("where")),
                                   order_by=order_by, desc=desc, with_author=not ctx.public)
    return _json(res)


async def h_count(ctx: Ctx, request: Request, collection: str) -> JSONResponse:
    D.collection_name(collection)
    q = request.query_params
    async with _pool().acquire() as conn:
        n = await D.count_records(conn, ctx.page_id, collection, ctx.actor,
                                  scope=_scope(q.get("scope"), ctx, allow_all=True),
                                  where=D.parse_where(q.get("where")))
    return _json({"count": n})


async def h_add(ctx: Ctx, request: Request, collection: str) -> JSONResponse:
    D.collection_name(collection)
    body = await _body(request)
    await _writing(ctx)
    async with _pool().acquire() as conn:
        rec = await D.add_record(conn, ctx.page_id, collection, body.get("data"), ctx.actor, ctx.conf,
                                 scope=D.scope_of(body.get("scope")))
    return _done(ctx, rec)


async def h_upsert(ctx: Ctx, request: Request, collection: str) -> JSONResponse:
    D.collection_name(collection)
    body = await _body(request)
    key = D.record_key(body.get("key"))
    await _writing(ctx)
    async with _pool().acquire() as conn:
        rec = await D.upsert_record(conn, ctx.page_id, collection, key, body.get("data"), ctx.actor, ctx.conf,
                                    scope=D.scope_of(body.get("scope")), replace=body.get("replace") is True,
                                    if_version=_version(body))
    return _done(ctx, rec)


def _version(body: dict) -> int | None:
    v = body.get("version")
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        raise HTTPException(422, "version must be a whole number")
    return v


async def h_get(ctx: Ctx, collection: str, record_id: str) -> JSONResponse:
    D.collection_name(collection)
    async with _pool().acquire() as conn:
        rec = await D.get_record(conn, ctx.page_id, collection, ctx.actor, record_id=_record_id(record_id))
    if not rec:
        raise HTTPException(404, "That record does not exist (it may have been deleted).")
    return _json(rec)


async def h_patch(ctx: Ctx, request: Request, collection: str, record_id: str) -> JSONResponse:
    D.collection_name(collection)
    rid = _record_id(record_id)
    body = await _body(request)
    await _writing(ctx)
    async with _pool().acquire() as conn:
        rec = await D.update_record(conn, ctx.page_id, collection, rid, body.get("data"), ctx.actor, ctx.conf,
                                    if_version=_version(body), replace=body.get("replace") is True)
    return _done(ctx, rec)


async def h_increment(ctx: Ctx, request: Request, collection: str, *, record_id: str | None = None,
                      key: str | None = None) -> JSONResponse:
    body = await _body(request)
    await _writing(ctx)
    by = body.get("by", 1)
    async with _pool().acquire() as conn:
        rec = await D.increment(conn, ctx.page_id, collection, ctx.actor, ctx.conf, body.get("field"), by,
                                record_id=record_id, key=key, scope=D.scope_of(body.get("scope")))
    return _done(ctx, rec)


async def h_delete(ctx: Ctx, collection: str, record_id: str) -> JSONResponse:
    rid = _record_id(record_id)
    await _writing(ctx)
    async with _pool().acquire() as conn:
        rec = await D.delete_record(conn, ctx.page_id, collection, ctx.actor, ctx.conf, record_id=rid)
    if collection == D.FILES_COLLECTION:
        _remove_files(ctx.page_id, [rec.get("_before") or {}])
    return _done(ctx, rec)


async def h_doc_get(ctx: Ctx, request: Request, name: str) -> JSONResponse:
    D.doc_name(name)
    async with _pool().acquire() as conn:
        rec = await D.get_record(conn, ctx.page_id, D.DOC_COLLECTION, ctx.actor, key=name,
                                 scope=D.scope_of(request.query_params.get("scope")))
    return _json({"record": rec})


async def h_doc_list(ctx: Ctx, request: Request) -> JSONResponse:
    scope = _scope(request.query_params.get("scope"), ctx, allow_all=True)
    async with _pool().acquire() as conn:
        res = await D.list_records(conn, ctx.page_id, D.DOC_COLLECTION, ctx.actor, scope=scope,
                                   limit=D.MAX_LIST_LIMIT, with_author=not ctx.public)
    return _json(res)


async def h_doc_put(ctx: Ctx, request: Request, name: str) -> JSONResponse:
    D.doc_name(name)
    body = await _body(request)
    await _writing(ctx)
    async with _pool().acquire() as conn:
        rec = await D.upsert_record(conn, ctx.page_id, D.DOC_COLLECTION, name, body.get("data"), ctx.actor,
                                    ctx.conf, scope=D.scope_of(body.get("scope")),
                                    replace=body.get("merge") is not True, if_version=_version(body))
    return _done(ctx, rec)


async def h_doc_increment(ctx: Ctx, request: Request, name: str) -> JSONResponse:
    D.doc_name(name)
    return await h_increment(ctx, request, D.DOC_COLLECTION, key=name)


async def h_files_list(ctx: Ctx, request: Request) -> JSONResponse:
    scope = _scope(request.query_params.get("scope"), ctx, allow_all=True)
    async with _pool().acquire() as conn:
        res = await D.list_records(conn, ctx.page_id, D.FILES_COLLECTION, ctx.actor, scope=scope,
                                   with_author=not ctx.public)
    for r in res["records"]:
        (r.get("data") or {}).pop("path", None)
    return _json(res)


async def h_files_upload(ctx: Ctx, request: Request) -> JSONResponse:
    from ..services import storage

    scope = D.scope_of(request.query_params.get("scope"))
    if not ctx.actor.can_add(ctx.conf):
        raise D.forbidden(ctx.conf)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > D.MAX_FILE_BYTES:
        raise HTTPException(413, "Files can be at most 5 MB.")
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > D.MAX_FILE_BYTES:
            raise HTTPException(413, "Files can be at most 5 MB.")
    if not buf:
        raise HTTPException(400, "The file is empty.")
    mime, ext = D.file_kind(bytes(buf))
    await _writing(ctx, files=True)
    raw_name = (request.headers.get("x-file-name") or "file")[:200]
    try:
        from urllib.parse import unquote
        raw_name = unquote(raw_name)
    except Exception:
        pass
    name = "".join(ch for ch in raw_name if ch.isprintable())[:120] or "file"
    path = f"{FILE_PREFIX}{ctx.page_id}/{secrets.token_hex(12)}.{ext}"
    data = {"url": f"/api/public/pages/asset/{path}", "name": name, "type": mime, "size": len(buf), "path": path}
    # The record first: it is what enforces the caps, and a record whose
    # upload then fails is removed again.
    async with _pool().acquire() as conn:
        rec = await D.add_record(conn, ctx.page_id, D.FILES_COLLECTION, data, ctx.actor, ctx.conf, scope=scope)
        try:
            await storage.upload_bytes(bytes(buf), path, content_type=mime)
        except Exception as exc:
            logger.warning("artifact file upload failed: %s", exc)
            owner = D.Actor(page_id=ctx.page_id, is_owner=True, user_id=None, visitor=None)
            await D.delete_record(conn, ctx.page_id, D.FILES_COLLECTION, owner, ctx.conf, record_id=rec["id"])
            raise HTTPException(502, "The file could not be stored. Try again.")
    (rec.get("data") or {}).pop("path", None)
    return _done(ctx, rec)


def _remove_files(page_id: str, datas: list[dict]) -> None:
    from ..services import storage

    prefix = f"{FILE_PREFIX}{page_id}/"
    paths = [d.get("path") for d in datas if isinstance(d, dict)]
    paths = [p for p in paths if isinstance(p, str) and p.startswith(prefix) and ".." not in p]
    for p in paths:
        spawn(storage.delete_path(p), name="artifact-file-delete")


# ---------------------------------------------------------------------------
# Public door
# ---------------------------------------------------------------------------

PUB = "/api/public/pages/{slug}/data"


@router.get(PUB)
async def pub_session(slug: str, request: Request):
    return await h_session(await public_ctx(request, slug))


@router.get(PUB + "/changes")
async def pub_changes(slug: str, request: Request):
    return await h_changes(await public_ctx(request, slug), request)


@router.get(PUB + "/doc")
async def pub_doc_list(slug: str, request: Request):
    return await h_doc_list(await public_ctx(request, slug), request)


@router.get(PUB + "/doc/{name}")
async def pub_doc_get(slug: str, name: str, request: Request):
    return await h_doc_get(await public_ctx(request, slug), request, name)


@router.put(PUB + "/doc/{name}")
async def pub_doc_put(slug: str, name: str, request: Request):
    return await h_doc_put(await public_ctx(request, slug), request, name)


@router.post(PUB + "/doc/{name}/increment")
async def pub_doc_inc(slug: str, name: str, request: Request):
    return await h_doc_increment(await public_ctx(request, slug), request, name)


@router.get(PUB + "/files")
async def pub_files(slug: str, request: Request):
    return await h_files_list(await public_ctx(request, slug), request)


@router.post(PUB + "/files")
async def pub_files_upload(slug: str, request: Request):
    return await h_files_upload(await public_ctx(request, slug), request)


@router.delete(PUB + "/files/{record_id}")
async def pub_files_delete(slug: str, record_id: str, request: Request):
    return await h_delete(await public_ctx(request, slug), D.FILES_COLLECTION, record_id)


@router.get(PUB + "/{collection}")
async def pub_list(slug: str, collection: str, request: Request):
    return await h_list(await public_ctx(request, slug), request, collection)


@router.get(PUB + "/{collection}/count")
async def pub_count(slug: str, collection: str, request: Request):
    return await h_count(await public_ctx(request, slug), request, collection)


@router.post(PUB + "/{collection}")
async def pub_add(slug: str, collection: str, request: Request):
    return await h_add(await public_ctx(request, slug), request, collection)


@router.post(PUB + "/{collection}/upsert")
async def pub_upsert(slug: str, collection: str, request: Request):
    return await h_upsert(await public_ctx(request, slug), request, collection)


@router.get(PUB + "/{collection}/{record_id}")
async def pub_get(slug: str, collection: str, record_id: str, request: Request):
    return await h_get(await public_ctx(request, slug), collection, record_id)


@router.patch(PUB + "/{collection}/{record_id}")
async def pub_patch(slug: str, collection: str, record_id: str, request: Request):
    return await h_patch(await public_ctx(request, slug), request, collection, record_id)


@router.post(PUB + "/{collection}/{record_id}/increment")
async def pub_increment(slug: str, collection: str, record_id: str, request: Request):
    D.collection_name(collection)
    return await h_increment(await public_ctx(request, slug), request, collection, record_id=_record_id(record_id))


@router.delete(PUB + "/{collection}/{record_id}")
async def pub_delete(slug: str, collection: str, record_id: str, request: Request):
    D.collection_name(collection)
    return await h_delete(await public_ctx(request, slug), collection, record_id)


# ---------------------------------------------------------------------------
# Owner door
# ---------------------------------------------------------------------------

OWN = "/api/pages/{page_id}/data"


@router.get(OWN)
async def own_session(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    return await h_session(await owner_ctx(request, page_id, role))


@router.get(OWN + "/changes")
async def own_changes(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    return await h_changes(await owner_ctx(request, page_id, role), request)


@router.get(OWN + "/settings")
async def own_settings(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    ctx = await owner_ctx(request, page_id, role)
    return _json(ctx.conf)


@router.put(OWN + "/settings")
async def own_settings_put(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    ctx = await owner_ctx(request, page_id, role)
    conf = D.validate_settings(await _body(request))
    # updated_at is left alone on purpose: the editor's next save checks it,
    # and a settings change is not an edit to the page it should conflict with.
    async with _pool().acquire() as conn:
        await conn.execute(
            "UPDATE published_pages SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{data}', $2::jsonb, true) "
            "WHERE id = $1",
            ctx.page_id, json.dumps(conf))
    D.notify(ctx.page_id)
    return _json(conf)


@router.get(OWN + "/export")
async def own_export(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    ctx = await owner_ctx(request, page_id, role)
    q = request.query_params
    fmt = (q.get("format") or "json").lower()
    if fmt not in ("json", "csv"):
        raise HTTPException(422, "format must be csv or json")
    collection = q.get("collection") or None
    if collection and collection not in (D.DOC_COLLECTION, D.FILES_COLLECTION):
        D.collection_name(collection)
    async with _pool().acquire() as conn:
        rows = await D.export_rows(conn, ctx.page_id, collection)
    records = [D.record_dict(r, ctx.actor, with_author=True) for r in rows]
    for r in records:
        r.pop("mine", None)
        if r["collection"] == D.FILES_COLLECTION:
            (r.get("data") or {}).pop("path", None)
    stem = f"artifact-data-{(collection or 'all').strip('_')}"
    if fmt == "json":
        return Response(json.dumps(records, ensure_ascii=False, indent=2), media_type="application/json",
                        headers={**NO_STORE, "Content-Disposition": f'attachment; filename="{stem}.json"'})
    fields: list[str] = []
    for r in records:
        for k in (r.get("data") or {}):
            if k not in fields:
                fields.append(k)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["collection", "id", "created_at", "updated_at", "author", "scope", *fields])
    for r in records:
        data = r.get("data") or {}
        cells = [v if isinstance(v, (str, int, float)) and not isinstance(v, bool) else
                 ("" if v is None else json.dumps(v, ensure_ascii=False)) for v in (data.get(f) for f in fields)]
        w.writerow(csv_safe_row([r["collection"], r["id"], r["created_at"], r["updated_at"], r.get("author", ""),
                                 r["scope"], *cells]))
    return Response("﻿" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={**NO_STORE, "Content-Disposition": f'attachment; filename="{stem}.csv"'})


@router.get(OWN + "/doc")
async def own_doc_list(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    return await h_doc_list(await owner_ctx(request, page_id, role), request)


@router.get(OWN + "/doc/{name}")
async def own_doc_get(page_id: P.PageId, name: str, request: Request, role: str = Depends(require_auth)):
    return await h_doc_get(await owner_ctx(request, page_id, role), request, name)


@router.put(OWN + "/doc/{name}")
async def own_doc_put(page_id: P.PageId, name: str, request: Request, role: str = Depends(require_auth)):
    return await h_doc_put(await owner_ctx(request, page_id, role), request, name)


@router.post(OWN + "/doc/{name}/increment")
async def own_doc_inc(page_id: P.PageId, name: str, request: Request, role: str = Depends(require_auth)):
    return await h_doc_increment(await owner_ctx(request, page_id, role), request, name)


@router.get(OWN + "/files")
async def own_files(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    return await h_files_list(await owner_ctx(request, page_id, role), request)


@router.post(OWN + "/files")
async def own_files_upload(page_id: P.PageId, request: Request, role: str = Depends(require_auth)):
    return await h_files_upload(await owner_ctx(request, page_id, role), request)


@router.delete(OWN + "/files/{record_id}")
async def own_files_delete(page_id: P.PageId, record_id: str, request: Request, role: str = Depends(require_auth)):
    return await h_delete(await owner_ctx(request, page_id, role), D.FILES_COLLECTION, record_id)


def _owner_collection(name: str) -> str:
    """The owner's moderation views also reach the internal collections."""
    if name in (D.DOC_COLLECTION, D.FILES_COLLECTION):
        return name
    return D.collection_name(name)


@router.get(OWN + "/{collection}")
async def own_list(page_id: P.PageId, collection: str, request: Request, role: str = Depends(require_auth)):
    ctx = await owner_ctx(request, page_id, role)
    if collection in (D.DOC_COLLECTION, D.FILES_COLLECTION):
        q = request.query_params
        async with _pool().acquire() as conn:
            res = await D.list_records(conn, ctx.page_id, collection, ctx.actor,
                                       scope=_scope(q.get("scope"), ctx, allow_all=True),
                                       limit=D.finite_int(q.get("limit")), with_author=True)
        for r in res["records"]:
            (r.get("data") or {}).pop("path", None)
        return _json(res)
    return await h_list(ctx, request, collection)


@router.delete(OWN + "/{collection}")
async def own_clear(page_id: P.PageId, collection: str, request: Request, role: str = Depends(require_auth)):
    ctx = await owner_ctx(request, page_id, role)
    name = _owner_collection(collection)
    async with _pool().acquire() as conn:
        datas = await D.clear_collection(conn, ctx.page_id, name)
    if name == D.FILES_COLLECTION:
        _remove_files(ctx.page_id, datas)
    D.notify(ctx.page_id)
    return _json({"ok": True, "deleted": len(datas)})


@router.get(OWN + "/{collection}/count")
async def own_count(page_id: P.PageId, collection: str, request: Request, role: str = Depends(require_auth)):
    return await h_count(await owner_ctx(request, page_id, role), request, collection)


@router.post(OWN + "/{collection}")
async def own_add(page_id: P.PageId, collection: str, request: Request, role: str = Depends(require_auth)):
    return await h_add(await owner_ctx(request, page_id, role), request, collection)


@router.post(OWN + "/{collection}/upsert")
async def own_upsert(page_id: P.PageId, collection: str, request: Request, role: str = Depends(require_auth)):
    return await h_upsert(await owner_ctx(request, page_id, role), request, collection)


@router.get(OWN + "/{collection}/{record_id}")
async def own_get(page_id: P.PageId, collection: str, record_id: str, request: Request,
                  role: str = Depends(require_auth)):
    return await h_get(await owner_ctx(request, page_id, role), collection, record_id)


@router.patch(OWN + "/{collection}/{record_id}")
async def own_patch(page_id: P.PageId, collection: str, record_id: str, request: Request,
                    role: str = Depends(require_auth)):
    return await h_patch(await owner_ctx(request, page_id, role), request, collection, record_id)


@router.post(OWN + "/{collection}/{record_id}/increment")
async def own_increment(page_id: P.PageId, collection: str, record_id: str, request: Request,
                        role: str = Depends(require_auth)):
    D.collection_name(collection)
    return await h_increment(await owner_ctx(request, page_id, role), request, collection,
                             record_id=_record_id(record_id))


@router.delete(OWN + "/{collection}/{record_id}")
async def own_delete(page_id: P.PageId, collection: str, record_id: str, request: Request,
                     role: str = Depends(require_auth)):
    return await h_delete(await owner_ctx(request, page_id, role), _owner_collection(collection), record_id)
