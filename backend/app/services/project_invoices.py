"""
Project ↔ Invoice association service.

Tables used
-----------
project_invoices      — live soft-deletable link table (UNIQUE per pair)
project_invoice_log   — append-only audit; every link/unlink action

Valkey caching
--------------
proj_inv:{project_teable_id}  TTL 120 s   per-project linked invoice list
inv_picklist:{source}         TTL  60 s   full picklist (no filters applied)
Both are busted immediately after any write.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from ..db.postgres import get_pool
from ..db import valkey as vk

logger = logging.getLogger("fintrack.services.project_invoices")

# ── Valkey key prefixes ────────────────────────────────────────────────────
_KEY_PROJ_INV = "proj_inv"     # proj_inv:{project_teable_id}
_KEY_PICKLIST = "inv_picklist" # inv_picklist:{source}
_TTL_PROJ_INV = 120            # seconds
_TTL_PICKLIST = 60             # seconds

_VALID_SOURCES = {"invoices", "web_invoices"}


def _coerce_source(s: str | None) -> str:
    return s if s in _VALID_SOURCES else "invoices"


def _row_to_dict(row) -> dict[str, Any]:
    """asyncpg Record → plain dict with ISO-formatted dates."""
    d = dict(row)
    for k, v in d.items():
        if hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


class ProjectInvoiceService:

    # ── READ ──────────────────────────────────────────────────────────────

    async def get_linked_invoices(
        self, project_teable_id: str
    ) -> list[dict[str, Any]]:
        """
        Return all active invoice associations for a project, enriched with
        invoice details from the appropriate mirror table.
        """
        cache_key = f"{_KEY_PROJ_INV}:{project_teable_id}"
        cached = await vk.cache_get(cache_key)
        if cached is not None:
            return cached

        pool = get_pool()
        if not pool:
            return []

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    pi.id::text                                           AS link_id,
                    pi.invoice_teable_id,
                    pi.invoice_source,
                    pi.linked_at,
                    pi.linked_by_role,
                    pi.note,
                    COALESCE(im.invoice_number, wim.invoice_number)      AS invoice_number,
                    COALESCE(im.project,        wim.project)             AS project_name,
                    COALESCE(im.payment_status, wim.payment_status)      AS payment_status,
                    COALESCE(im.amount_raised,  wim.amount_raised)       AS amount_raised,
                    COALESCE(im.amount_with_tax, wim.amount_with_tax)    AS amount_with_tax,
                    COALESCE(im.amount_received, wim.amount_received)    AS amount_received,
                    COALESCE(im.raised_date,    wim.raised_date)         AS raised_date,
                    COALESCE(im.cleared_date,   wim.cleared_date)        AS cleared_date
                FROM project_invoices pi
                LEFT JOIN invoices_mirror im
                    ON pi.invoice_source = 'invoices'
                    AND pi.invoice_teable_id = im.teable_id
                LEFT JOIN web_invoices_mirror wim
                    ON pi.invoice_source = 'web_invoices'
                    AND pi.invoice_teable_id = wim.teable_id
                WHERE pi.project_teable_id = $1
                  AND pi.is_active = TRUE
                ORDER BY pi.linked_at DESC
                """,
                project_teable_id,
            )

        result = [_row_to_dict(r) for r in rows]
        await vk.cache_set(cache_key, result, _TTL_PROJ_INV)
        return result

    async def get_invoice_picklist(
        self,
        source: str = "invoices",
        q: str = "",
        exclude_ids: list[str] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Return a lightweight invoice list for picklist dropdowns.
        If no filters (q/exclude), result is cached in Valkey for TTL_PICKLIST.
        """
        source = _coerce_source(source)
        table = "invoices_mirror" if source == "invoices" else "web_invoices_mirror"
        q = (q or "").strip()
        exclude_ids = [x for x in (exclude_ids or []) if x]

        # Only cache the unfiltered full list
        if not q and not exclude_ids:
            cache_key = f"{_KEY_PICKLIST}:{source}"
            cached = await vk.cache_get(cache_key)
            if cached is not None:
                return cached

        pool = get_pool()
        if not pool:
            return []

        # Build parameterised query dynamically
        params: list[Any] = [limit]
        clauses: list[str] = []

        if q:
            params.append(f"%{q.lower()}%")
            qi = len(params)
            clauses.append(
                f"(LOWER(invoice_number) LIKE ${qi} OR LOWER(project) LIKE ${qi})"
            )
        if exclude_ids:
            params.append(exclude_ids)
            clauses.append(f"teable_id <> ALL(${len(params)}::varchar[])")

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT
                    teable_id,
                    invoice_number,
                    project        AS project_name,
                    payment_status,
                    amount_raised,
                    amount_with_tax,
                    raised_date
                FROM {table}
                {where}
                ORDER BY raised_date DESC NULLS LAST
                LIMIT $1
                """,
                *params,
            )

        result = [_row_to_dict(r) for r in rows]
        if not q and not exclude_ids:
            await vk.cache_set(f"{_KEY_PICKLIST}:{source}", result, _TTL_PICKLIST)
        return result

    async def get_project_invoice_log(
        self, project_teable_id: str, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Return append-only audit log for a project's invoice associations."""
        pool = get_pool()
        if not pool:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id, action_at, action,
                    invoice_teable_id, invoice_source,
                    project_name, invoice_number,
                    invoice_amount, payment_status,
                    actor_role, actor_ip, note
                FROM project_invoice_log
                WHERE project_teable_id = $1
                ORDER BY action_at DESC
                LIMIT $2
                """,
                project_teable_id,
                limit,
            )
        return [_row_to_dict(r) for r in rows]

    # ── WRITE ─────────────────────────────────────────────────────────────

    async def link_invoice(
        self,
        project_teable_id: str,
        invoice_teable_id: str,
        invoice_source: str = "invoices",
        actor_role: Optional[str] = None,
        actor_ip: Optional[str] = None,
        note: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """
        Link an invoice to a project.
        Idempotent — re-activates the row if it was previously soft-deleted.
        Appends to project_invoice_log unconditionally.
        Returns the updated linked invoice list.
        """
        project_teable_id = project_teable_id.strip()
        invoice_teable_id = invoice_teable_id.strip()
        invoice_source = _coerce_source(invoice_source)

        if not project_teable_id or not invoice_teable_id:
            raise ValueError("project_teable_id and invoice_teable_id are required")

        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")

        snapshot = await self._fetch_snapshot(pool, invoice_teable_id, invoice_source)

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO project_invoices (
                        project_teable_id, invoice_teable_id, invoice_source,
                        is_active, linked_by_role, linked_by_ip, linked_at, note
                    )
                    VALUES ($1, $2, $3, TRUE, $4, $5, NOW(), $6)
                    ON CONFLICT (project_teable_id, invoice_teable_id)
                    DO UPDATE SET
                        is_active        = TRUE,
                        linked_by_role   = EXCLUDED.linked_by_role,
                        linked_by_ip     = EXCLUDED.linked_by_ip,
                        linked_at        = NOW(),
                        unlinked_at      = NULL,
                        unlinked_by_role = NULL,
                        note             = EXCLUDED.note
                    """,
                    project_teable_id, invoice_teable_id, invoice_source,
                    actor_role, actor_ip, note,
                )

                await conn.execute(
                    """
                    INSERT INTO project_invoice_log (
                        action, project_teable_id, invoice_teable_id, invoice_source,
                        project_name, invoice_number, invoice_amount, payment_status,
                        actor_role, actor_ip, note
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    """,
                    "linked",
                    project_teable_id, invoice_teable_id, invoice_source,
                    snapshot.get("project_name"),
                    snapshot.get("invoice_number"),
                    snapshot.get("amount_raised"),
                    snapshot.get("payment_status"),
                    actor_role, actor_ip, note,
                )

        logger.info(
            "Invoice linked — project=%s invoice=%s source=%s actor=%s inv=%s",
            project_teable_id, invoice_teable_id, invoice_source, actor_role,
            snapshot.get("invoice_number", "?"),
        )
        await self._bust_cache(project_teable_id, invoice_source)
        return await self.get_linked_invoices(project_teable_id)

    async def unlink_invoice(
        self,
        project_teable_id: str,
        invoice_teable_id: str,
        actor_role: Optional[str] = None,
        actor_ip: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Soft-delete the association and append an 'unlinked' entry to the log.
        Raises ValueError if the association does not exist / is already inactive.
        """
        project_teable_id = project_teable_id.strip()
        invoice_teable_id = invoice_teable_id.strip()

        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")

        # Grab the source + snapshot before the delete
        async with pool.acquire() as conn:
            link_row = await conn.fetchrow(
                """
                SELECT invoice_source FROM project_invoices
                WHERE project_teable_id = $1 AND invoice_teable_id = $2
                """,
                project_teable_id, invoice_teable_id,
            )

        if not link_row:
            raise ValueError("Invoice association not found")

        invoice_source = link_row["invoice_source"]
        snapshot = await self._fetch_snapshot(pool, invoice_teable_id, invoice_source)

        async with pool.acquire() as conn:
            async with conn.transaction():
                updated = await conn.fetchval(
                    """
                    UPDATE project_invoices
                    SET
                        is_active        = FALSE,
                        unlinked_at      = NOW(),
                        unlinked_by_role = $3
                    WHERE project_teable_id = $1
                      AND invoice_teable_id = $2
                      AND is_active = TRUE
                    RETURNING id
                    """,
                    project_teable_id, invoice_teable_id, actor_role,
                )
                if updated is None:
                    raise ValueError("Association already removed")

                await conn.execute(
                    """
                    INSERT INTO project_invoice_log (
                        action, project_teable_id, invoice_teable_id, invoice_source,
                        project_name, invoice_number, invoice_amount, payment_status,
                        actor_role, actor_ip
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    """,
                    "unlinked",
                    project_teable_id, invoice_teable_id, invoice_source,
                    snapshot.get("project_name"),
                    snapshot.get("invoice_number"),
                    snapshot.get("amount_raised"),
                    snapshot.get("payment_status"),
                    actor_role, actor_ip,
                )

        logger.info(
            "Invoice unlinked — project=%s invoice=%s actor=%s inv=%s",
            project_teable_id, invoice_teable_id, actor_role,
            snapshot.get("invoice_number", "?"),
        )
        await self._bust_cache(project_teable_id, invoice_source)
        return {"ok": True}

    # ── Private helpers ───────────────────────────────────────────────────

    async def _fetch_snapshot(
        self, pool, invoice_teable_id: str, invoice_source: str
    ) -> dict[str, Any]:
        """Fetch a lightweight snapshot of the invoice for the audit log."""
        table = (
            "invoices_mirror" if invoice_source == "invoices" else "web_invoices_mirror"
        )
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    f"""
                    SELECT
                        invoice_number,
                        project       AS project_name,
                        amount_raised,
                        payment_status
                    FROM {table}
                    WHERE teable_id = $1
                    """,
                    invoice_teable_id,
                )
            return dict(row) if row else {}
        except Exception as exc:
            logger.debug("Snapshot fetch failed for %s: %s", invoice_teable_id, exc)
            return {}

    async def _bust_cache(self, project_teable_id: str, invoice_source: str) -> None:
        await vk.cache_bust(f"{_KEY_PROJ_INV}:{project_teable_id}")
        await vk.cache_bust(f"{_KEY_PICKLIST}:{invoice_source}")
