"""
Regression cover for two production errors found in the admin audit log.

1. Sync failing on every existing projects / status row:
     invalid input for query argument $7: '2026-05-21T11:27:27.718Z'
     (expected a datetime.date or datetime.datetime instance, got 'str')
   The extractors copied fields["lastModifiedTime"] straight into a
   TIMESTAMPTZ column. Before lastModifiedTime was folded into `fields` for
   ordering that key was never present, so the column was always NULL and the
   raw-string assignment never executed. Afterwards it ran on every UPDATE.

2. The only genuine 5xx in 46 days — two POST /api/invoices 500s — were a
   Teable rejection surfacing as a 500 with raw error text. InvoiceService
   wraps httpx.HTTPStatusError in RuntimeError (`from exc`), so the router's
   `except httpx.HTTPError` translation branch could never fire and the
   request fell through to the catch-all 500. The user never saw what to fix.
"""

import datetime

import httpx
import pytest
from fastapi import HTTPException

from app.db.sync import _parse_datetime, _extract_status, _extract_project
import app.routers.invoices as inv


FAILING_VALUE = "2026-05-21T11:27:27.718Z"   # verbatim from the audit log


class TestParseDatetime:
    def test_the_exact_failing_value_becomes_an_aware_datetime(self):
        dt = _parse_datetime(FAILING_VALUE)
        assert isinstance(dt, datetime.datetime)
        assert dt.tzinfo is not None
        assert dt == datetime.datetime(2026, 5, 21, 11, 27, 27, 718000, tzinfo=datetime.timezone.utc)

    @pytest.mark.parametrize("extractor", [_extract_status, _extract_project])
    def test_extractors_emit_the_type_asyncpg_requires(self, extractor):
        # asyncpg accepts datetime.date or datetime.datetime for TIMESTAMPTZ; a
        # str raises "invalid input for query argument".
        value = extractor({"lastModifiedTime": FAILING_VALUE})["modified_time"]
        assert isinstance(value, (datetime.date, datetime.datetime))

    @pytest.mark.parametrize("raw", [None, "", "not-a-timestamp", 12345])
    def test_absent_or_garbage_is_none_not_an_error(self, raw):
        assert _parse_datetime(raw) is None

    def test_naive_input_is_made_utc_aware(self):
        assert _parse_datetime("2026-05-21T11:27:27").tzinfo is not None


def _wrapped(status: int, body, *, json: bool = True) -> RuntimeError:
    """Build the exact exception shape InvoiceService raises."""
    req = httpx.Request("POST", "https://teable.test/api/table/x/record")
    res = httpx.Response(status, request=req, **({"json": body} if json else {"text": body}))
    try:
        res.raise_for_status()
    except httpx.HTTPStatusError as exc:
        try:
            raise RuntimeError(f"Teable {status}: {body}") from exc
        except RuntimeError as e:
            return e
    raise AssertionError("expected a non-2xx status")


def _raised(e: RuntimeError, ctx: str = "creating invoice") -> HTTPException:
    with pytest.raises(HTTPException) as info:
        inv._raise_translated_teable_error(e, ctx)
    return info.value


class TestTranslatedTeableErrors:
    def test_a_teable_400_is_a_400_with_a_translated_message(self):
        h = _raised(_wrapped(400, {"message": "Invalid option 'Foo' for field 'Category'",
                                    "code": "validation_error"}))
        assert h.status_code == 400
        assert not str(h.detail).startswith("Teable 400")        # not the raw wrapper text
        assert "Invalid option 'Foo'" not in str(h.detail)       # translated, not echoed

    def test_a_non_json_body_falls_back_to_text_without_crashing(self):
        h = _raised(_wrapped(422, "<html>not json</html>", json=False))
        assert h.status_code == 422

    def test_a_runtime_error_with_no_teable_cause_stays_a_500(self):
        assert _raised(RuntimeError("pool exploded")).status_code == 500

    def test_both_routes_route_runtime_errors_through_the_helper(self):
        # Guards the wiring, not just the helper: a future refactor that drops
        # the `except RuntimeError` branch would silently reintroduce the 500s.
        import inspect
        src = inspect.getsource(inv)
        assert src.count("_raise_translated_teable_error(e, \"creating invoice\")") == 1
        assert src.count("_raise_translated_teable_error(e, \"updating invoice\")") == 1
