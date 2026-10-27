"""
Shared artifact data without a database: the SDK the renderer injects, the
security properties around it, the brief, and the pure validation helpers.
"""

from __future__ import annotations

import re

import pytest
from fastapi import HTTPException

from app.services import artifact
from app.services import artifact_data as D
from app.services import page_render


class TestSdkInjection:
    def test_every_document_gets_the_sdk_before_author_script(self):
        for src in ("<p>x</p>", "<!DOCTYPE html><html><head></head><body><script>boot()</script></body></html>"):
            out = page_render.build_document(src)
            assert "window.fintrack" in out
            assert out.index("fintrack.db") < out.index("</head>") if "</head>" in out else True
        out = page_render.build_document("<!DOCTYPE html><html><head></head><body><script>boot()</script></body></html>")
        assert out.index("__ft_db") < out.index("boot()")

    def test_the_sdk_never_reaches_the_network_itself(self):
        sdk = page_render.DATA_SDK
        for word in ("fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "localStorage",
                     "document.cookie", "Authorization"):
            assert word not in sdk, word
        # It talks to its parent only, and listens to its parent only.
        assert "parent.postMessage({ type: '__ft_db'" in sdk
        assert "e.source !== window.parent" in sdk
        assert "</script" not in sdk.lower()

    def test_sandbox_and_policy_are_unchanged(self):
        assert "allow-same-origin" not in page_render.PAGE_SANDBOX
        assert page_render.PAGE_SANDBOX == (
            "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads")
        csp = page_render.csp_header()
        assert re.search(r"connect-src ([^;]+)", csp).group(1) == "https: http: data: blob:"
        assert "sandbox allow-scripts" in csp


class TestBrief:
    def test_shared_data_section_is_in_the_rules(self):
        rules = artifact.ARTIFACT_RULES
        assert artifact.SHARED_DATA_RULES in rules
        assert rules.index("SHARED DATA") < rules.index("OUTPUT FORMAT")
        for phrase in ("window.fintrack.db", "subscribe", "scope: 'private'", "increment", "upsert",
                       "db.doc", "files.upload", "Synced", "Offline", "NO network calls"):
            assert phrase in rules, phrase

    def test_revision_note_mentions_the_data_api(self):
        assert "window.fintrack.db" in artifact.REVISION_NOTE
        assert "no network calls" in artifact.REVISION_NOTE


class TestValidation:
    @pytest.mark.parametrize("name", ["todos", "Sign-ups", "a", "x_1", "A" * 40])
    def test_good_collection_names(self, name):
        assert D.collection_name(name) == name

    @pytest.mark.parametrize("name", ["", "1x", "_files", "_doc", "a b", "a/b", "a'b", "A" * 41, "changes",
                                      "settings", "Export", "doc", "files", "count", "upsert", None, 5])
    def test_bad_collection_names(self, name):
        with pytest.raises(HTTPException) as e:
            D.collection_name(name)
        assert e.value.status_code == 422

    def test_encode_caps(self):
        assert D.encode({"a": 1}) == '{"a":1}'
        for bad, code in (([], 422), ("x", 422), ({"x": float("nan")}, 422), ({"x": {1, 2}}, 422),
                          ({"x": "y" * (D.MAX_RECORD_BYTES + 1)}, 413), ({"x": "\x00"}, 422)):
            with pytest.raises(HTTPException) as e:
                D.encode(bad)
            assert e.value.status_code == code

    def test_visitor_hash(self):
        assert D.visitor_hash(None) is None and D.visitor_hash("short") is None
        assert D.visitor_hash("x" * 65) is None and D.visitor_hash("bad id with spaces!!") is None
        h = D.visitor_hash("v" + "a" * 30)
        assert h and len(h) == 40 and "a" * 30 not in h

    def test_settings_defaults_and_validation(self):
        assert D.settings_of({}) == {"access": "link_write", "own_only": False}
        assert D.settings_of('{"data": {"access": "owner", "own_only": true}}') == {"access": "owner", "own_only": True}
        assert D.settings_of({"data": {"access": "everyone", "own_only": "yes"}}) == D.DEFAULT_SETTINGS
        with pytest.raises(HTTPException):
            D.validate_settings({"access": "x"})

    def test_file_kinds(self):
        assert D.file_kind(b"\x89PNG\r\n\x1a\nxxxx") == ("image/png", "png")
        assert D.file_kind(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ("image/webp", "webp")
        for bad in (b"<svg/>", b"<html>", b"MZ", b"PK\x03\x04"):
            with pytest.raises(HTTPException) as e:
                D.file_kind(bad)
            assert e.value.status_code == 415

    def test_where_and_order(self):
        assert D.parse_where('{"done": false}') == {"done": False}
        assert D.parse_where(None) is None
        for bad in ("[1]", '{"a b": 1}', "{", '{"' + "a" * 70 + '": 1}'):
            with pytest.raises(HTTPException):
                D.parse_where(bad)
        assert D.parse_order("score", "1") == ("score", True)
        with pytest.raises(HTTPException):
            D.parse_order("score desc; --", None)

    def test_local_rate_limiter(self):
        D.reset_rate_limits()
        assert [D._local_allow("k", 2, 60) for _ in range(3)] == [True, True, False]
        assert D._local_allow("other", 2, 60)

    def test_actor_rules(self):
        conf_open = {"access": "link_write", "own_only": False}
        conf_own = {"access": "link_write", "own_only": True}
        conf_ro = {"access": "owner", "own_only": False}
        a = D.Actor(page_id="p", is_owner=False, user_id=None, visitor="va")
        row_a = {"created_by_user": None, "created_by_visitor": "va", "scope_owner": ""}
        row_b = {"created_by_user": None, "created_by_visitor": "vb", "scope_owner": ""}
        priv_b = {"created_by_user": None, "created_by_visitor": "vb", "scope_owner": "v:vb"}
        assert a.can_change(conf_open, row_b) and not a.can_change(conf_own, row_b) and a.can_change(conf_own, row_a)
        assert not a.can_change(conf_ro, row_a) and not a.can_add(conf_ro)
        assert not a.can_change(conf_open, priv_b)
        owner = D.Actor(page_id="p", is_owner=True, user_id="u", visitor=None)
        assert owner.can_change(conf_ro, priv_b) and owner.can_add(conf_ro)
        assert a.me(conf_open)["id"] != D.Actor(page_id="q", is_owner=False, user_id=None, visitor="va").me(conf_open)["id"]
