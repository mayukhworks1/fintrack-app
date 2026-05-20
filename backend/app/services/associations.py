from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Optional

from ..db.postgres import get_pool


SOURCE_CONFIG = {
    "status": {"client_field": "Client", "project_field": "Project"},
    "projects": {"client_field": "Client", "project_field": "Project Name"},
    "invoices": {"client_field": None, "project_field": "Project"},
    "web_invoices": {"client_field": None, "project_field": "Project"},
}


def normalize_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = text.replace("&", " and ")
    text = re.sub(r"[\u2010-\u2015/_|]+", " ", text)
    text = re.sub(r"[^\w\s-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_name(value: Any) -> str:
    return str(value or "").strip()


class AssociationService:
    VALID_SOURCES = set(SOURCE_CONFIG.keys())

    def validate_source(self, source_table: str) -> str:
        normalized = str(source_table or "").strip().lower()
        if normalized not in self.VALID_SOURCES:
            raise ValueError(f"Unsupported source_table: {source_table}")
        return normalized

    def extract_names(self, source_table: str, record: dict[str, Any]) -> tuple[str, str]:
        source = self.validate_source(source_table)
        fields = record.get("fields", {}) or {}
        cfg = SOURCE_CONFIG[source]
        client_name = _clean_name(fields.get(cfg["client_field"])) if cfg["client_field"] else ""
        project_name = _clean_name(fields.get(cfg["project_field"])) if cfg["project_field"] else ""
        return client_name, project_name

    async def hydrate_records(self, source_table: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Attach manual association data to each record.
        Auto-linking is intentionally DISABLED — it created noisy incorrect links.
        Only explicit manual links (created via upsert_manual_link) are shown.
        """
        source = self.validate_source(source_table)
        if not records:
            return records
        pool = get_pool()
        if not pool:
            return [self._with_association(record, None) for record in records]

        record_ids = [str(r.get("id") or "").strip() for r in records if r.get("id")]
        if not record_ids:
            return [self._with_association(record, None) for record in records]

        # Auto-linking removed: _auto_link_missing() was creating incorrect links
        # by fuzzy name-matching and running on every list fetch.
        links = await self._load_links(source, record_ids)
        counts = await self._load_related_counts(links.values())

        hydrated = []
        for record in records:
            link = links.get(str(record.get("id") or ""))
            association = None
            if link:
                association = self._serialize_link(link, counts)
            hydrated.append(self._with_association(record, association))
        return hydrated

    async def get_record_association(self, source_table: str, teable_id: str) -> dict[str, Any]:
        source = self.validate_source(source_table)
        teable_id = str(teable_id or "").strip()
        pool = get_pool()
        if not pool:
            return {"association": None}
        links = await self._load_links(source, [teable_id])
        link = links.get(teable_id)
        if not link:
            return {"association": None}
        counts = await self._load_related_counts([link])
        return {"association": self._serialize_link(link, counts)}

    async def search_entities(self, query: str, limit: int = 10) -> dict[str, Any]:
        q = normalize_name(query)
        if not q:
            return {"clients": [], "projects": []}
        pool = get_pool()
        if not pool:
            return {"clients": [], "projects": []}

        pattern = f"%{q}%"
        async with pool.acquire() as conn:
            client_rows = await conn.fetch(
                """
                SELECT id, canonical_name
                FROM client_entities
                WHERE is_active = TRUE AND normalized_name LIKE $1
                ORDER BY canonical_name
                LIMIT $2
                """,
                pattern,
                limit,
            )
            project_rows = await conn.fetch(
                """
                SELECT
                    pe.id,
                    pe.canonical_name,
                    pe.client_entity_id,
                    ce.canonical_name AS client_name
                FROM project_entities pe
                LEFT JOIN client_entities ce ON ce.id = pe.client_entity_id
                WHERE pe.is_active = TRUE AND pe.normalized_name LIKE $1
                ORDER BY pe.canonical_name
                LIMIT $2
                """,
                pattern,
                limit,
            )

        return {
            "clients": [
                {"id": str(row["id"]), "name": row["canonical_name"]}
                for row in client_rows
            ],
            "projects": [
                {
                    "id": str(row["id"]),
                    "name": row["canonical_name"],
                    "client_entity_id": str(row["client_entity_id"]) if row["client_entity_id"] else None,
                    "client_name": row["client_name"],
                }
                for row in project_rows
            ],
        }

    async def upsert_manual_link(
        self,
        source_table: str,
        teable_id: str,
        *,
        client_entity_id: Optional[str] = None,
        project_entity_id: Optional[str] = None,
        client_name: str = "",
        project_name: str = "",
        actor_role: Optional[str] = None,
        actor_ip: Optional[str] = None,
    ) -> dict[str, Any]:
        source = self.validate_source(source_table)
        teable_id = str(teable_id or "").strip()
        if not teable_id:
            raise ValueError("teable_id is required")

        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")

        async with pool.acquire() as conn:
            async with conn.transaction():
                client_id = client_entity_id or None
                project_id = project_entity_id or None

                if client_name and not client_id:
                    client_id = await self._ensure_client_entity(conn, client_name)
                if project_name and not project_id:
                    project_id = await self._ensure_project_entity(conn, project_name, client_id)
                if project_id and not client_id:
                    row = await conn.fetchrow(
                        "SELECT client_entity_id FROM project_entities WHERE id = $1",
                        project_id,
                    )
                    if row and row["client_entity_id"]:
                        client_id = str(row["client_entity_id"])

                await conn.execute(
                    """
                    INSERT INTO record_links (
                        source_table, teable_id, client_entity_id, project_entity_id,
                        link_mode, match_confidence, linked_by_role, linked_by_ip, updated_at
                    )
                    VALUES ($1, $2, $3::uuid, $4::uuid, 'manual', 100, $5, $6, NOW())
                    ON CONFLICT (source_table, teable_id)
                    DO UPDATE SET
                        client_entity_id = EXCLUDED.client_entity_id,
                        project_entity_id = EXCLUDED.project_entity_id,
                        link_mode = 'manual',
                        match_confidence = 100,
                        linked_by_role = EXCLUDED.linked_by_role,
                        linked_by_ip = EXCLUDED.linked_by_ip,
                        updated_at = NOW()
                    """,
                    source,
                    teable_id,
                    client_id,
                    project_id,
                    actor_role,
                    actor_ip,
                )

        return await self.get_record_association(source, teable_id)

    async def unlink_record(self, source_table: str, teable_id: str) -> dict[str, Any]:
        source = self.validate_source(source_table)
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM record_links WHERE source_table = $1 AND teable_id = $2",
                source,
                teable_id,
            )
        return {"ok": True}

    async def bulk_link_by_name(
        self,
        client_name: str,
        project_name: str,
        *,
        actor_role: Optional[str] = None,
        actor_ip: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Given canonical client + project names, find ALL matching records across
        every source table (status, projects, invoices, web_invoices) and link them.

        Matching is done by normalised name against the mirror tables:
          status_mirror.client / status_mirror.project
          projects_mirror.client / projects_mirror.fields->>'Project Name'
          invoices_mirror.project
          web_invoices_mirror.project

        Returns a summary of how many records were linked per table.
        """
        if not client_name.strip() and not project_name.strip():
            raise ValueError("At least client_name or project_name is required")

        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")

        client_norm  = normalize_name(client_name)
        project_norm = normalize_name(project_name)

        async with pool.acquire() as conn:
            async with conn.transaction():
                # 1. Ensure canonical entities exist
                client_id: Optional[str] = None
                project_id: Optional[str] = None
                if client_name.strip():
                    client_id = await self._ensure_client_entity(conn, client_name)
                if project_name.strip():
                    project_id = await self._ensure_project_entity(conn, project_name, client_id)

                # 2. Gather matching teable_ids from each mirror table
                matches: dict[str, list[str]] = {}

                # status_mirror
                rows = await conn.fetch(
                    """
                    SELECT teable_id FROM status_mirror
                    WHERE ($1 = '' OR LOWER(client) LIKE $2)
                      AND ($3 = '' OR LOWER(project) LIKE $4)
                    """,
                    client_norm, f"%{client_norm}%",
                    project_norm, f"%{project_norm}%",
                )
                if rows:
                    matches["status"] = [r["teable_id"] for r in rows]

                # projects_mirror
                rows = await conn.fetch(
                    """
                    SELECT teable_id FROM projects_mirror
                    WHERE ($1 = '' OR LOWER(client) LIKE $2)
                      AND ($3 = '' OR LOWER(fields->>'Project Name') LIKE $4)
                    """,
                    client_norm, f"%{client_norm}%",
                    project_norm, f"%{project_norm}%",
                )
                if rows:
                    matches["projects"] = [r["teable_id"] for r in rows]

                # invoices_mirror (match by project name only — no client field)
                if project_norm:
                    rows = await conn.fetch(
                        """
                        SELECT teable_id FROM invoices_mirror
                        WHERE LOWER(project) LIKE $1
                        """,
                        f"%{project_norm}%",
                    )
                    if rows:
                        matches["invoices"] = [r["teable_id"] for r in rows]

                # web_invoices_mirror
                if project_norm:
                    rows = await conn.fetch(
                        """
                        SELECT teable_id FROM web_invoices_mirror
                        WHERE LOWER(project) LIKE $1
                        """,
                        f"%{project_norm}%",
                    )
                    if rows:
                        matches["web_invoices"] = [r["teable_id"] for r in rows]

                # 3. Upsert record_links for every match
                linked_counts: dict[str, int] = {}
                for src, teable_ids in matches.items():
                    count = 0
                    for tid in teable_ids:
                        await conn.execute(
                            """
                            INSERT INTO record_links (
                                source_table, teable_id,
                                client_entity_id, project_entity_id,
                                link_mode, match_confidence,
                                linked_by_role, linked_by_ip, updated_at
                            )
                            VALUES ($1,$2,$3::uuid,$4::uuid,'manual',100,$5,$6,NOW())
                            ON CONFLICT (source_table, teable_id)
                            DO UPDATE SET
                                client_entity_id  = EXCLUDED.client_entity_id,
                                project_entity_id = EXCLUDED.project_entity_id,
                                link_mode         = 'manual',
                                match_confidence  = 100,
                                linked_by_role    = EXCLUDED.linked_by_role,
                                linked_by_ip      = EXCLUDED.linked_by_ip,
                                updated_at        = NOW()
                            """,
                            src, tid, client_id, project_id,
                            actor_role, actor_ip,
                        )
                        count += 1
                    linked_counts[src] = count

        return {
            "client":  {"id": client_id,  "name": _clean_name(client_name)}  if client_id  else None,
            "project": {"id": project_id, "name": _clean_name(project_name)} if project_id else None,
            "linked_counts": linked_counts,
            "total": sum(linked_counts.values()),
        }

    async def reset_all(self) -> dict[str, Any]:
        """
        Delete ALL association data (record_links, project_entities, client_entities).
        Intended for admin use only. Irreversible — clears ALL manual and auto links.
        """
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL is not available")
        async with pool.acquire() as conn:
            # Delete in FK-safe order
            rl  = await conn.fetchval("DELETE FROM record_links     RETURNING count(*)", column=0)
            pe  = await conn.fetchval("DELETE FROM project_entities RETURNING count(*)", column=0)
            ce  = await conn.fetchval("DELETE FROM client_entities  RETURNING count(*)", column=0)
        import logging
        logging.getLogger("fintrack.services.associations").warning(
            "Association reset: deleted %s record_links, %s project_entities, %s client_entities",
            rl, pe, ce,
        )
        return {
            "ok": True,
            "deleted": {
                "record_links":      rl  or 0,
                "project_entities":  pe  or 0,
                "client_entities":   ce  or 0,
            },
        }

    async def get_stats(self) -> dict[str, Any]:
        """Return current row counts for all association tables."""
        pool = get_pool()
        if not pool:
            return {}
        async with pool.acquire() as conn:
            ce = await conn.fetchval("SELECT COUNT(*) FROM client_entities")
            pe = await conn.fetchval("SELECT COUNT(*) FROM project_entities")
            rl = await conn.fetchval("SELECT COUNT(*) FROM record_links")
            rl_manual = await conn.fetchval(
                "SELECT COUNT(*) FROM record_links WHERE link_mode = 'manual'"
            )
        return {
            "client_entities":  int(ce or 0),
            "project_entities": int(pe or 0),
            "record_links":     int(rl or 0),
            "record_links_manual": int(rl_manual or 0),
        }

    async def _auto_link_missing(self, source_table: str, records: list[dict[str, Any]]) -> None:
        pool = get_pool()
        if not pool or not records:
            return
        record_ids = [str(r.get("id") or "").strip() for r in records if r.get("id")]
        if not record_ids:
            return

        async with pool.acquire() as conn:
            existing_rows = await conn.fetch(
                """
                SELECT teable_id, link_mode
                FROM record_links
                WHERE source_table = $1 AND teable_id = ANY($2::varchar[])
                """,
                source_table,
                record_ids,
            )
            existing_ids = {row["teable_id"] for row in existing_rows}

            for record in records:
                teable_id = str(record.get("id") or "").strip()
                if not teable_id or teable_id in existing_ids:
                    continue
                client_name, project_name = self.extract_names(source_table, record)
                client_norm = normalize_name(client_name)
                project_norm = normalize_name(project_name)
                if not client_norm and not project_norm:
                    continue

                client_entity_id: Optional[str] = None
                project_entity_id: Optional[str] = None
                confidence = 0.0

                if source_table in {"status", "projects"}:
                    if client_norm:
                        client_entity_id = await self._ensure_client_entity(conn, client_name)
                        confidence = 70.0
                    if client_entity_id and project_norm:
                        project_entity_id = await self._ensure_project_entity(conn, project_name, client_entity_id)
                        confidence = 100.0
                else:
                    if project_norm:
                        project_entity_id, client_entity_id = await self._resolve_invoice_project(conn, project_norm)
                        if project_entity_id:
                            confidence = 85.0 if client_entity_id else 60.0

                if not client_entity_id and not project_entity_id:
                    continue

                await conn.execute(
                    """
                    INSERT INTO record_links (
                        source_table, teable_id, client_entity_id, project_entity_id,
                        link_mode, match_confidence, updated_at
                    )
                    VALUES ($1, $2, $3::uuid, $4::uuid, 'auto', $5, NOW())
                    ON CONFLICT (source_table, teable_id)
                    DO NOTHING
                    """,
                    source_table,
                    teable_id,
                    client_entity_id,
                    project_entity_id,
                    confidence,
                )

    async def _resolve_invoice_project(
        self,
        conn,
        project_norm: str,
    ) -> tuple[Optional[str], Optional[str]]:
        rows = await conn.fetch(
            """
            SELECT id, client_entity_id
            FROM project_entities
            WHERE normalized_name = $1 AND is_active = TRUE
            ORDER BY updated_at DESC, created_at DESC
            """,
            project_norm,
        )
        if len(rows) != 1:
            return None, None
        row = rows[0]
        return str(row["id"]), str(row["client_entity_id"]) if row["client_entity_id"] else None

    async def _ensure_client_entity(self, conn, client_name: str) -> str:
        normalized = normalize_name(client_name)
        if not normalized:
            raise ValueError("client_name is required")
        row = await conn.fetchrow(
            """
            INSERT INTO client_entities (canonical_name, normalized_name, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (normalized_name)
            DO UPDATE SET canonical_name = EXCLUDED.canonical_name, updated_at = NOW()
            RETURNING id
            """,
            _clean_name(client_name),
            normalized,
        )
        return str(row["id"])

    async def _ensure_project_entity(self, conn, project_name: str, client_entity_id: Optional[str]) -> str:
        normalized = normalize_name(project_name)
        if not normalized:
            raise ValueError("project_name is required")
        cleaned_name = _clean_name(project_name)
        row = await conn.fetchrow(
            """
            SELECT id
            FROM project_entities
            WHERE client_entity_id IS NOT DISTINCT FROM $1::uuid
              AND normalized_name = $2
            LIMIT 1
            """,
            client_entity_id,
            normalized,
        )
        if row:
            await conn.execute(
                """
                UPDATE project_entities
                SET canonical_name = $2, updated_at = NOW()
                WHERE id = $1
                """,
                row["id"],
                cleaned_name,
            )
            return str(row["id"])

        row = await conn.fetchrow(
            """
            INSERT INTO project_entities (
                client_entity_id, canonical_name, normalized_name, updated_at
            )
            VALUES ($1::uuid, $2, $3, NOW())
            RETURNING id
            """,
            client_entity_id,
            cleaned_name,
            normalized,
        )
        return str(row["id"])

    async def _load_links(self, source_table: str, teable_ids: list[str]) -> dict[str, dict[str, Any]]:
        pool = get_pool()
        if not pool or not teable_ids:
            return {}

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    rl.source_table,
                    rl.teable_id,
                    rl.link_mode,
                    rl.match_confidence,
                    rl.client_entity_id,
                    rl.project_entity_id,
                    ce.canonical_name AS client_name,
                    pe.canonical_name AS project_name,
                    pe.client_entity_id AS project_client_entity_id
                FROM record_links rl
                LEFT JOIN client_entities ce ON ce.id = rl.client_entity_id
                LEFT JOIN project_entities pe ON pe.id = rl.project_entity_id
                WHERE rl.source_table = $1 AND rl.teable_id = ANY($2::varchar[])
                """,
                source_table,
                teable_ids,
            )
        return {row["teable_id"]: dict(row) for row in rows}

    async def _load_related_counts(self, links: Any) -> dict[str, dict[str, int]]:
        pool = get_pool()
        if not pool:
            return {}

        link_rows = list(links)
        project_ids = {str(row["project_entity_id"]) for row in link_rows if row.get("project_entity_id")}
        client_ids = {str(row["client_entity_id"]) for row in link_rows if row.get("client_entity_id")}
        counts: dict[str, dict[str, int]] = {}

        async with pool.acquire() as conn:
            if project_ids:
                rows = await conn.fetch(
                    """
                    SELECT project_entity_id::text AS key, source_table, COUNT(*)::int AS count
                    FROM record_links
                    WHERE project_entity_id = ANY($1::uuid[])
                    GROUP BY project_entity_id, source_table
                    """,
                    list(project_ids),
                )
                grouped: dict[str, dict[str, int]] = defaultdict(dict)
                for row in rows:
                    grouped[row["key"]][row["source_table"]] = row["count"]
                for key, data in grouped.items():
                    data["total"] = sum(data.values())
                    counts[f"project:{key}"] = data

            if client_ids:
                rows = await conn.fetch(
                    """
                    SELECT client_entity_id::text AS key, source_table, COUNT(*)::int AS count
                    FROM record_links
                    WHERE client_entity_id = ANY($1::uuid[])
                    GROUP BY client_entity_id, source_table
                    """,
                    list(client_ids),
                )
                grouped = defaultdict(dict)
                for row in rows:
                    grouped[row["key"]][row["source_table"]] = row["count"]
                for key, data in grouped.items():
                    data["total"] = sum(data.values())
                    counts[f"client:{key}"] = data

        return counts

    def _serialize_link(self, row: dict[str, Any], counts: dict[str, dict[str, int]]) -> dict[str, Any]:
        client_id = str(row["client_entity_id"]) if row.get("client_entity_id") else None
        project_id = str(row["project_entity_id"]) if row.get("project_entity_id") else None
        project_counts = counts.get(f"project:{project_id}", {}) if project_id else {}
        client_counts = counts.get(f"client:{client_id}", {}) if client_id else {}
        return {
            "link_mode": row.get("link_mode"),
            "match_confidence": float(row.get("match_confidence") or 0),
            "client": (
                {"id": client_id, "name": row.get("client_name")}
                if client_id and row.get("client_name")
                else None
            ),
            "project": (
                {"id": project_id, "name": row.get("project_name")}
                if project_id and row.get("project_name")
                else None
            ),
            "related_counts": {
                "project": project_counts,
                "client": client_counts,
            },
        }

    def _with_association(self, record: dict[str, Any], association: Optional[dict[str, Any]]) -> dict[str, Any]:
        out = dict(record)
        out["association"] = association
        return out
