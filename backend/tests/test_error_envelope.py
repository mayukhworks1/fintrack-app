"""The error envelope keeps structured details readable by the client."""
import asyncio
import json
from types import SimpleNamespace

from fastapi import HTTPException

from app.main import http_exception_handler


def _call(exc):
    req = SimpleNamespace(state=SimpleNamespace(request_id="r1"))
    res = asyncio.run(http_exception_handler(req, exc))
    return res, json.loads(res.body)


def test_dict_detail_travels_as_json():
    res, body = _call(HTTPException(409, {"code": "conflict", "message": "Changed", "current": {"id": "p1"}}))
    assert res.status_code == 409
    assert body["error"]["message"] == "Changed"
    assert body["error"]["detail"]["code"] == "conflict"
    assert body["error"]["detail"]["current"] == {"id": "p1"}


def test_string_detail_and_headers_are_kept():
    res, body = _call(HTTPException(429, "Slow down", headers={"Retry-After": "5"}))
    assert body["error"]["message"] == "Slow down"
    assert "detail" not in body["error"]
    assert res.headers["Retry-After"] == "5"
