"""
Inline base64 images leave page content on save.

One shared page in production was 1.4 MB, 1.36 MB of it fifteen images
embedded as base64. These pin: every image becomes an asset in ONE storage
commit; identical payloads share one asset; an undecodable payload is left
exactly as it was; an upload failure leaves the whole content untouched; and
the boot-time sweep rewrites a page only when its content has not changed.
"""

import asyncio
import base64

import pytest

import app.routers.pages as P
import app.services.storage as S

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40).decode()
JPG = base64.b64encode(b"\xff\xd8\xff" + b"\x01" * 40).decode()


@pytest.fixture
def uploads(monkeypatch):
    calls = []
    async def upload_many(files):
        calls.append(files)
        return [f"/api/storage/file/{p}" for _, p, _ in files]
    monkeypatch.setattr(S, "upload_many", upload_many)
    return calls


class TestExternalise:
    def test_every_image_becomes_an_asset_in_one_commit(self, uploads):
        html = f'<img src="data:image/png;base64,{PNG}"><img src="data:image/jpeg;base64,{JPG}">'
        out, moved = asyncio.run(P.externalise_inline_images(html))
        assert moved == 2 and len(uploads) == 1 and len(uploads[0]) == 2
        assert "base64" not in out
        assert out.count("/api/public/pages/asset/pages/") == 2
        paths = [p for _, p, _ in uploads[0]]
        assert paths[0].endswith(".png") and paths[1].endswith(".jpg")
        assert uploads[0][0][0].startswith(b"\x89PNG")          # decoded bytes went up

    def test_identical_payloads_share_one_asset(self, uploads):
        html = f'<img src="data:image/png;base64,{PNG}"> ... <img src="data:image/png;base64,{PNG}">'
        out, moved = asyncio.run(P.externalise_inline_images(html))
        assert moved == 1 and len(uploads[0]) == 1
        urls = {u for u in out.split('"') if u.startswith("/api/public/pages/asset/")}
        assert len(urls) == 1 and out.count(next(iter(urls))) == 2

    def test_wrapped_payload_is_decoded_and_replaced_whole(self, uploads):
        wrapped = PNG[:20] + "\n" + PNG[20:]
        html = f'<img src="data:image/png;base64,{wrapped}">'
        out, moved = asyncio.run(P.externalise_inline_images(html))
        assert moved == 1 and "\n" not in out and 'src="/api/public/pages/asset/' in out

    def test_undecodable_payload_is_left_exactly_as_it_was(self, uploads):
        html = '<img src="data:image/png;base64,not*valid*base64">'
        out, moved = asyncio.run(P.externalise_inline_images(html))
        assert (out, moved) == (html, 0) and uploads == []

    def test_an_upload_failure_leaves_the_content_untouched(self, monkeypatch):
        async def boom(files): raise RuntimeError("hub down")
        monkeypatch.setattr(S, "upload_many", boom)
        html = f'<img src="data:image/png;base64,{PNG}">'
        assert asyncio.run(P.externalise_inline_images(html)) == (html, 0)

    @pytest.mark.parametrize("content", [None, "", "<p>no images</p>", "<img src='/api/public/pages/asset/pages/x.png'>"])
    def test_content_without_inline_images_is_returned_as_is(self, uploads, content):
        assert asyncio.run(P.externalise_inline_images(content)) == (content, 0)
        assert uploads == []

    def test_an_oversized_image_stays_inline(self, uploads, monkeypatch):
        monkeypatch.setattr(S, "MAX_PAGE_FILE_BYTES", 10)
        html = f'<img src="data:image/png;base64,{PNG}">'
        assert asyncio.run(P.externalise_inline_images(html)) == (html, 0)


class TestSweep:
    def _pool(self, rows, update_status):
        class Pool:
            def __init__(self): self.updates = []
            async def fetch(self, sql, *a): return rows
            async def execute(self, sql, *a):
                self.updates.append(a); return update_status
        return Pool()

    def test_rewrites_only_when_content_is_unchanged(self, uploads, monkeypatch):
        html = f'<img src="data:image/png;base64,{PNG}">'
        pool = self._pool([{"id": "p1", "content": html}], "UPDATE 1")
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        out = asyncio.run(P.sweep_inline_images_once(delay_s=0))
        assert out == {"pages": 1, "images": 1}
        new_content, page_id, old_content = pool.updates[0]
        assert page_id == "p1" and old_content == html and "base64" not in new_content

    def test_a_page_edited_meanwhile_is_not_counted(self, uploads, monkeypatch):
        html = f'<img src="data:image/png;base64,{PNG}">'
        pool = self._pool([{"id": "p1", "content": html}], "UPDATE 0")   # compare-and-set missed
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        assert asyncio.run(P.sweep_inline_images_once(delay_s=0)) == {"pages": 0, "images": 0}

    def test_no_pool_is_a_no_op(self, monkeypatch):
        monkeypatch.setattr(P, "get_pool", lambda: None)
        assert asyncio.run(P.sweep_inline_images_once(delay_s=0)) == {"pages": 0, "images": 0}
