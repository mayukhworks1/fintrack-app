"""
Mirror sync integrity: what the full-sync reconcile may tombstone, what brings
a tombstoned row back, and the timestamp that stops an older Teable snapshot
from reverting a save the user has just made.

The fake below is a few hundred lines of Postgres: enough of the statements
sync.py issues, with their real semantics (a clock for NOW(), soft deletes,
the conditional tombstone), that run_sync, upsert_record and
reconcile_missing_records run unmodified against it.
"""

import asyncio
import datetime as dt
import json
import re

import pytest

import app.db.attribution as A
import app.db.sync as S

T0 = dt.datetime(2026, 10, 1, 12, 0, tzinfo=dt.timezone.utc)


class FakeMirrorDB:
    def __init__(self):
        self.now = T0
        self.rows: dict[str, dict] = {}
        self.history: list[tuple[str, str]] = []   # (change_type, teable_id)
        self.sync_log: list[tuple[str, str | None]] = []   # (source, error)

    def tick(self, seconds: int = 1) -> None:
        self.now += dt.timedelta(seconds=seconds)

    def seed(self, tid: str, fields: dict, *, deleted: bool = False) -> None:
        self.rows[tid] = {
            "teable_id": tid, "fields": dict(fields), "synced_at": self.now,
            "deleted_at": self.now if deleted else None,
        }
        self.tick()

    def live(self) -> set[str]:
        return {t for t, r in self.rows.items() if r["deleted_at"] is None}

    # ── pool / connection API ────────────────────────────────────────────
    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def fetchval(self, sql, *args):
        assert " ".join(sql.split()) == "SELECT NOW()", sql
        return self.now

    async def fetchrow(self, sql, *args):
        s = " ".join(sql.split())
        m = re.fullmatch(r"SELECT fields::text AS fields(, deleted_at)? FROM \w+ WHERE teable_id = \$1", s)
        if m:
            row = self.rows.get(args[0])
            if row is None:
                return None
            out = {"fields": json.dumps(row["fields"])}
            if m.group(1):
                out["deleted_at"] = row["deleted_at"]
            return out
        if re.fullmatch(
            r"UPDATE \w+ SET synced_at = NOW\(\), deleted_at = NOW\(\) WHERE teable_id = \$1 "
            r"AND deleted_at IS NULL AND synced_at < \$2 RETURNING fields::text AS fields", s,
        ):
            row = self.rows.get(args[0])
            if row is None or row["deleted_at"] is not None or not row["synced_at"] < args[1]:
                return None
            row["synced_at"] = row["deleted_at"] = self.now
            return {"fields": json.dumps(row["fields"])}
        raise AssertionError(f"unexpected fetchrow: {s}")

    async def fetch(self, sql, *args):
        s = " ".join(sql.split())
        m = re.fullmatch(r"SELECT teable_id FROM \w+ WHERE deleted_at IS NULL( AND synced_at < \$1)?", s)
        if m:
            return [
                {"teable_id": t} for t, r in self.rows.items()
                if r["deleted_at"] is None and (not m.group(1) or r["synced_at"] < args[0])
            ]
        raise AssertionError(f"unexpected fetch: {s}")

    async def execute(self, sql, *args):
        s = " ".join(sql.split())
        if s.startswith("INSERT INTO record_history"):
            self.history.append((args[2], args[1]))
            return "INSERT 0 1"
        if s.startswith("INSERT INTO sync_log"):
            self.sync_log.append((args[0], args[6]))
            return "INSERT 0 1"
        m = re.match(r"INSERT INTO \w+ \((.*?)\) VALUES", s)
        if m:
            row = dict(zip([c.strip() for c in m.group(1).split(",")], args))
            row["fields"] = json.loads(row["fields"])
            row["synced_at"] = self.now
            self.rows[row["teable_id"]] = row
            return "INSERT 0 1"
        m = re.fullmatch(r"UPDATE \w+ SET (.*) WHERE teable_id = \$(\d+)", s)
        if m:
            row = self.rows.get(args[int(m.group(2)) - 1])
            if row is None:
                return "UPDATE 0"
            for part in m.group(1).split(", "):
                col, val = (x.strip() for x in part.split("=", 1))
                if val == "NOW()":
                    row[col] = self.now
                elif val == "NULL":
                    row[col] = None
                else:
                    v = args[int(re.match(r"\$(\d+)", val).group(1)) - 1]
                    row[col] = json.loads(v) if col == "fields" else v
            return "UPDATE 1"
        raise AssertionError(f"unexpected execute: {s}")


def _rec(tid: str, lmt: str | None = None, **fields) -> dict:
    rec = {"id": tid, "fields": {"Invoice Number": tid, "Payment Status": "Pending", **fields}}
    if lmt:
        rec["lastModifiedTime"] = lmt
    return rec


def _fields(rec: dict) -> dict:
    return S.fields_with_lmt(rec)


@pytest.fixture
def db(monkeypatch):
    fake = FakeMirrorDB()
    monkeypatch.setattr(S, "get_pool", lambda: fake)

    async def no_actor(tid):
        return A.empty_actor()
    monkeypatch.setattr(A, "pop_attribution", no_actor)

    # One mirrored table — web invoices — and one token, so run_sync has a
    # single task and needs no network.
    monkeypatch.setattr(S.settings, "teable_api_token", "tok")
    monkeypatch.setattr(S.settings, "teable_web_api_token", "")
    monkeypatch.setattr(S.settings, "teable_all_api_token", "")
    for attr in ("teable_table_id", "teable_invoice_table_id",
                 "teable_web_projects_table_id", "teable_status_table_id"):
        monkeypatch.setattr(S.settings, attr, "")
    monkeypatch.setattr(S.settings, "teable_web_invoice_table_id", "tblWEBINV")
    return fake


def _full_sync(monkeypatch, db, snapshot, during_fetch=None):
    """run_sync(full) where Teable returns `snapshot`; `during_fetch` runs while
    the fetch is in flight, i.e. after the pass started and before the upserts."""
    async def fake_fetch(table_id, token):
        db.tick()
        if during_fetch:
            await during_fetch()
        db.tick()
        return list(snapshot), token
    monkeypatch.setattr(S, "_fetch_all_with_token_fallback", fake_fetch)
    asyncio.run(S.run_sync(incremental=False))


async def _write_through(db, rec):
    db.tick()
    return await S.upsert_record(db, "web_invoices", "web_invoices_mirror", rec["id"],
                                 _fields(rec), S._extract_web_invoice)


# ── 1. reconcile tombstones only what the snapshot could have seen ──────────

class TestReconcile:
    def test_a_record_created_after_the_snapshot_survives(self, monkeypatch, db):
        db.seed("recA", _fields(_rec("recA")))

        async def user_creates_w():
            await _write_through(db, _rec("recW", "2026-10-01T12:00:30.000Z"))

        _full_sync(monkeypatch, db, [_rec("recA")], during_fetch=user_creates_w)

        assert db.rows["recW"]["deleted_at"] is None
        assert ("delete", "recW") not in db.history
        assert db.live() == {"recA", "recW"}

    def test_a_record_gone_from_teable_is_tombstoned_with_history(self, monkeypatch, db):
        db.seed("recA", _fields(_rec("recA")))
        db.seed("recB", _fields(_rec("recB")))

        _full_sync(monkeypatch, db, [_rec("recA")])

        assert db.live() == {"recA"}
        assert db.rows["recB"]["deleted_at"] is not None
        assert ("delete", "recB") in db.history
        assert db.sync_log[-1] == ("web_invoices", None)

    def test_a_write_landing_after_the_candidate_query_is_not_tombstoned(self, db):
        db.seed("recA", _fields(_rec("recA")))
        started = db.now
        db.tick()
        db.rows["recA"]["synced_at"] = db.now   # a write-through after the pass began

        deleted = asyncio.run(S.reconcile_missing_records(
            db, "web_invoices", "web_invoices_mirror", [], started_at=started))

        assert deleted == 0 and db.live() == {"recA"} and db.history == []

    def test_conditional_tombstone_writes_no_history_when_the_row_moved(self, db):
        db.seed("recA", _fields(_rec("recA")))
        started = db.now
        db.tick()
        db.rows["recA"]["synced_at"] = db.now
        assert asyncio.run(S._mark_deleted_if_unseen(
            db, "web_invoices", "web_invoices_mirror", "recA", started)) is False
        assert db.history == [] and db.rows["recA"]["deleted_at"] is None

    def test_mark_deleted_on_an_unknown_id_writes_nothing(self, db):
        asyncio.run(S.mark_deleted(db, "web_invoices", "web_invoices_mirror", "recNope"))
        assert db.history == [] and db.rows == {}


class TestReconcileGuard:
    def test_an_empty_fetch_deletes_nothing_and_logs_an_error(self, monkeypatch, db):
        for i in range(3):
            db.seed(f"rec{i}", _fields(_rec(f"rec{i}")))

        _full_sync(monkeypatch, db, [])

        assert db.live() == {"rec0", "rec1", "rec2"}
        assert not [h for h in db.history if h[0] == "delete"]
        source, error = db.sync_log[-1]
        assert source == "web_invoices" and "reconcile skipped" in error

    def test_a_large_shrink_deletes_nothing(self, monkeypatch, db):
        for i in range(40):
            db.seed(f"rec{i:02}", _fields(_rec(f"rec{i:02}")))

        _full_sync(monkeypatch, db, [_rec(f"rec{i:02}") for i in range(10)])

        assert len(db.live()) == 40
        assert "reconcile skipped" in db.sync_log[-1][1]

    def test_ordinary_deletions_still_go_through(self, monkeypatch, db):
        for i in range(40):
            db.seed(f"rec{i:02}", _fields(_rec(f"rec{i:02}")))

        _full_sync(monkeypatch, db, [_rec(f"rec{i:02}") for i in range(35)])

        assert len(db.live()) == 35
        assert db.sync_log[-1][1] is None

    def test_a_small_table_can_lose_most_of_its_rows(self, monkeypatch, db):
        # Below the floor the ratio is not applied: 2 of 3 is a real cleanup.
        for i in range(3):
            db.seed(f"rec{i}", _fields(_rec(f"rec{i}")))
        _full_sync(monkeypatch, db, [_rec("rec0")])
        assert db.live() == {"rec0"}

    @pytest.mark.parametrize("live,fetched,missing,skip", [
        (5, 0, 5, True),
        (0, 0, 0, False),
        (100, 40, 60, True),
        (100, 60, 40, False),
        (12, 1, 11, True),
        (12, 2, 10, False),
    ])
    def test_skip_reason(self, live, fetched, missing, skip):
        assert (S._reconcile_skip_reason(live, fetched, missing) is not None) is skip


# ── 1b. a record that is seen again comes back ───────────────────────────────

class TestRestore:
    def test_an_unchanged_record_seen_again_is_restored(self, monkeypatch, db):
        rec = _rec("recA", "2026-10-01T11:00:00.000Z")
        db.seed("recA", _fields(rec), deleted=True)   # wrongly tombstoned earlier

        _full_sync(monkeypatch, db, [rec])

        assert db.rows["recA"]["deleted_at"] is None
        assert ("restore", "recA") in db.history

    def test_restore_is_counted_so_the_read_caches_are_busted(self, monkeypatch, db):
        rec = _rec("recA")
        db.seed("recA", _fields(rec), deleted=True)
        busted = []

        async def fake_log(pool, source, total, created, updated, unchanged, ms, error, deleted=0):
            busted.append(updated)
        monkeypatch.setattr(S, "_write_sync_log", fake_log)

        _full_sync(monkeypatch, db, [rec])
        assert busted == [1]

    def test_a_webhook_or_write_through_restores_too(self, db):
        rec = _rec("recA")
        db.seed("recA", _fields(rec), deleted=True)
        result = asyncio.run(S.upsert_record(
            db, "web_invoices", "web_invoices_mirror", "recA", _fields(rec), S._extract_web_invoice))
        assert result == "restored" and db.rows["recA"]["deleted_at"] is None

    def test_a_snapshot_older_than_the_tombstone_does_not_resurrect(self, monkeypatch, db):
        rec = _rec("recA")
        db.seed("recA", _fields(rec))

        async def user_deletes_a():
            await S.mark_deleted(db, "web_invoices", "web_invoices_mirror", "recA")

        # Teable answered before the delete, so the snapshot still has recA.
        _full_sync(monkeypatch, db, [rec], during_fetch=user_deletes_a)

        assert db.rows["recA"]["deleted_at"] is not None
        assert ("restore", "recA") not in db.history

    def test_a_live_unchanged_row_is_still_unchanged(self, db):
        rec = _rec("recA")
        db.seed("recA", _fields(rec))
        result = asyncio.run(S.upsert_record(
            db, "web_invoices", "web_invoices_mirror", "recA", _fields(rec), S._extract_web_invoice,
            fetched_at=db.now))
        assert result == "unchanged" and db.history == []


# ── 2. write-throughs carry lastModifiedTime ─────────────────────────────────

class _Resp:
    is_success = True
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _Client:
    def __init__(self, payload):
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def patch(self, url, **kw):
        return _Resp(self.payload)

    async def post(self, url, **kw):
        return _Resp(self.payload)


class TestFieldsWithLmt:
    def test_folds_the_record_level_timestamp(self):
        rec = {"id": "r", "fields": {"A": 1}, "lastModifiedTime": "2026-10-01T00:00:00.000Z"}
        assert S.fields_with_lmt(rec) == {"A": 1, "lastModifiedTime": "2026-10-01T00:00:00.000Z"}
        assert rec["fields"] == {"A": 1}   # not mutated

    @pytest.mark.parametrize("rec,expected", [
        ({"fields": {"A": 1}}, {"A": 1}),
        ({"fields": {}}, {}),
        ({"id": "r"}, None),
        (None, None),
        ({"fields": None, "lastModifiedTime": "x"}, None),
    ])
    def test_degenerate_records(self, rec, expected):
        assert S.fields_with_lmt(rec) == expected


class TestWriteThroughKeepsTheSave:
    SNAPSHOT_LMT = "2026-10-01T12:00:00.000Z"
    SAVE_LMT     = "2026-10-01T12:00:05.000Z"

    def test_full_sync_snapshot_from_before_a_save_does_not_revert_it(self, monkeypatch, db):
        import app.services.web_invoice as WI

        before = _rec("recR", self.SNAPSHOT_LMT, **{"Amount Received": 0})
        db.seed("recR", _fields(before))
        saved = _rec("recR", self.SAVE_LMT, **{"Payment Status": "Paid", "Amount Received": 1000})

        monkeypatch.setattr(WI, "get_pool", lambda: db)
        monkeypatch.setattr(WI, "shared_client", lambda **k: _Client(saved))
        monkeypatch.setattr(WI, "spawn", lambda coro, **k: coro.close())

        async def user_saves_paid():
            db.tick()
            await WI.WebInvoiceService().update_invoice("recR", {"Payment Status": "Paid"})

        # The fetch returned the pre-save state; the user saved while the pass
        # was still working through it.
        _full_sync(monkeypatch, db, [before], during_fetch=user_saves_paid)

        row = db.rows["recR"]
        assert row["fields"]["Payment Status"] == "Paid"
        assert row["fields"]["lastModifiedTime"] == self.SAVE_LMT
        assert row["payment_status"] == "Paid"
        assert [h for h in db.history if h[0] == "update"] == [("update", "recR")]

    def test_web_invoice_create_stores_the_timestamp(self, monkeypatch, db):
        import app.services.web_invoice as WI
        created = _rec("recN", self.SAVE_LMT)
        monkeypatch.setattr(WI, "get_pool", lambda: db)
        monkeypatch.setattr(WI, "shared_client", lambda **k: _Client({"records": [created]}))
        monkeypatch.setattr(WI, "spawn", lambda coro, **k: coro.close())

        asyncio.run(WI.WebInvoiceService().create_invoice({"Invoice Number": "recN"}))
        assert db.rows["recN"]["fields"]["lastModifiedTime"] == self.SAVE_LMT

    @pytest.mark.parametrize("method,payload", [
        ("update_project", {"id": "recP", "fields": {"Project Name": "PMS"}, "lastModifiedTime": SAVE_LMT}),
        ("create_project", {"records": [{"id": "recP", "fields": {"Project Name": "PMS"},
                                         "lastModifiedTime": SAVE_LMT}]}),
    ])
    def test_web_project_write_throughs_carry_it(self, monkeypatch, method, payload):
        import app.services.web_project as WP
        seen = {}

        async def fake_upsert(pool, source, table, tid, fields, extractor):
            seen.update(fields)
        monkeypatch.setattr(WP, "get_pool", lambda: object())
        monkeypatch.setattr(S, "upsert_record", fake_upsert)
        monkeypatch.setattr(WP, "shared_client", lambda **k: _Client(payload))

        svc = WP.WebProjectService()
        if method == "update_project":
            asyncio.run(svc.update_project("recP", {"Project Name": "PMS"}))
        else:
            asyncio.run(svc.create_project({"Project Name": "PMS"}))
        assert seen.get("lastModifiedTime") == self.SAVE_LMT

    def test_status_update_carries_it(self, monkeypatch):
        import app.services.status as ST
        seen = {}

        async def fake_upsert(pool, source, table, tid, fields, extractor):
            seen.update(fields)
        monkeypatch.setattr(ST, "get_pool", lambda: object())
        monkeypatch.setattr("app.db.postgres.get_pool", lambda: object())
        monkeypatch.setattr(S, "upsert_record", fake_upsert)
        monkeypatch.setattr(ST, "shared_client", lambda *a, **k: _Client(
            {"id": "recS", "fields": {"Status": "Completed"}, "lastModifiedTime": self.SAVE_LMT}))

        asyncio.run(ST.StatusService().update_record("recS", {"Status": "Completed"}))
        assert seen == {"Status": "Completed", "lastModifiedTime": self.SAVE_LMT}

    def test_webhook_format_a_carries_it(self):
        from app.routers.webhooks import _parse_payload
        [(rid, fields, event)] = _parse_payload(
            {"id": "recA", "fields": {"X": 1}, "lastModifiedTime": self.SAVE_LMT})
        assert fields == {"X": 1, "lastModifiedTime": self.SAVE_LMT} and event == "upsert"
