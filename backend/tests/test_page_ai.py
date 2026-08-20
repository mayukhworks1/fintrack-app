"""
Output cleaning for AI-generated pages.

Everything stripped here is stripped because the app's Content-Security-Policy
blocks it at render time. Leaving it in is not a security hole — the browser
drops it — but it hands the author markup that looks functional in the editor
and silently does nothing once published.
"""

import pytest

from app.services.page_ai import clean_output, strip_unsupported, generate_page


class TestFenceUnwrapping:
    """Models wrap output in markdown fences despite being told not to."""

    def test_strips_html_fence(self):
        out, _ = clean_output("```html\n<!DOCTYPE html><html></html>\n```", "html")
        assert out.startswith("<!DOCTYPE html>")
        assert "```" not in out

    def test_strips_bare_fence(self):
        out, _ = clean_output("```\n<!DOCTYPE html><html></html>\n```", "html")
        assert out.startswith("<!DOCTYPE html>")

    def test_leaves_unfenced_output_alone(self):
        src = "<!DOCTYPE html><html><body><p>x</p></body></html>"
        out, _ = clean_output(src, "html")
        assert out == src

    def test_drops_preamble_before_the_doctype(self):
        out, _ = clean_output(
            "Sure! Here is your landing page:\n\n<!DOCTYPE html><html></html>", "html"
        )
        assert out.startswith("<!DOCTYPE html>")
        assert "Sure!" not in out

    # Regression: fence stripping was anchored to the start of the string, so a
    # model that wrote a sentence of preamble first left its opening fence
    # mid-document and its closing fence trailing the output — which then
    # rendered as a stray ``` at the bottom of the published page.
    def test_strips_fences_around_a_preamble(self):
        out, _ = clean_output(
            "Sure! Here's your page:\n\n```html\n<!DOCTYPE html><html><body>hi</body></html>\n```\n",
            "html",
        )
        assert out.startswith("<!DOCTYPE html>")
        assert "```" not in out
        assert "Sure!" not in out

    def test_markdown_keeps_its_code_blocks(self):
        src = "# Title\n\n```python\nprint(1)\n```\n\nDone."
        out, _ = clean_output(src, "markdown")
        assert "```python" in out
        assert "print(1)" in out

    def test_keeps_markdown_as_written(self):
        out, removed = clean_output("# Title\n\nSome **copy**.", "markdown")
        assert out == "# Title\n\nSome **copy**."
        assert removed == []


class TestStripsWhatTheCSPBlocks:
    def test_removes_script_blocks_and_reports_them(self):
        out, removed = strip_unsupported(
            "<p>a</p><script>alert(1)</script><p>b</p>"
        )
        assert "<script" not in out
        assert "alert(1)" not in out
        assert "<p>a</p>" in out and "<p>b</p>" in out
        assert any("script" in r for r in removed)

    def test_removes_external_script_tags(self):
        out, removed = strip_unsupported('<script src="https://cdn.example/x.js"></script>')
        assert "cdn.example" not in out
        assert removed

    def test_removes_external_stylesheets(self):
        out, removed = strip_unsupported(
            '<link rel="stylesheet" href="https://cdn.example/t.css">'
        )
        assert "cdn.example" not in out
        assert any("stylesheet" in r for r in removed)

    def test_removes_css_imports(self):
        out, removed = strip_unsupported("<style>@import url('https://fonts.x/c.css'); p{}</style>")
        assert "@import" not in out
        assert "p{}" in out

    def test_removes_inline_event_handlers(self):
        out, removed = strip_unsupported('<button onclick="go()">Go</button>')
        assert "onclick" not in out
        assert "Go" in out
        assert any("handler" in r for r in removed)

    # External images and data URIs are explicitly allowed by img-src, so
    # stripping them would remove working content.
    def test_keeps_external_images(self):
        src = '<img src="https://example.com/a.png" alt="A">'
        out, removed = strip_unsupported(src)
        assert out == src
        assert removed == []

    def test_keeps_inline_styles_and_svg(self):
        src = '<style>body{margin:0}</style><svg aria-hidden="true"><circle r="4"/></svg>'
        out, removed = strip_unsupported(src)
        assert out == src
        assert removed == []

    def test_reports_nothing_for_clean_markup(self):
        _, removed = strip_unsupported("<!DOCTYPE html><html><body><h1>Hi</h1></body></html>")
        assert removed == []


@pytest.mark.asyncio
class TestGenerateValidation:
    """Rejected before any model call, so a bad request costs nothing."""

    async def test_rejects_empty_prompt(self):
        with pytest.raises(ValueError, match="prompt is required"):
            await generate_page("   ")

    async def test_rejects_overlong_prompt(self):
        with pytest.raises(ValueError, match="too long"):
            await generate_page("x" * 5000)

    async def test_rejects_unsupported_content_type(self):
        with pytest.raises(ValueError, match="Web Page and Document"):
            await generate_page("a landing page", content_type="csv")

    async def test_rejects_oversized_existing_document(self):
        with pytest.raises(ValueError, match="too large to revise"):
            await generate_page("make it blue", existing="x" * 25000)


class TestTruncationDetection:
    """
    The reported failure: a generated page published as a completely blank
    screen. The model had hit its output ceiling mid-stylesheet, so the document
    carried a valid doctype and head but an unterminated <style> and no <body>.
    The browser reads everything after the open <style> as stylesheet text and
    renders nothing — a silent failure with nothing pointing at the cause.
    """

    # Trimmed from the document the user actually received.
    CUT_OFF_MID_CSS = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Learnify - Online Courses</title>
<style>
:root{--clr-primary:#2563eb}
body{margin:0;background:var(--clr-bg)}
.course-card{
  background:var(--clr-white);
  border-radius:.75rem;
  overflow:hidden;
  box-shadow:var(--clr-shadow);"""

    def test_detects_the_reported_blank_page(self):
        from app.services.page_ai import find_truncation
        reason = find_truncation(self.CUT_OFF_MID_CSS)
        assert reason is not None
        assert "stylesheet" in reason

    def test_detects_a_missing_closing_html(self):
        from app.services.page_ai import find_truncation
        html = "<!DOCTYPE html><html><head><style>p{}</style></head><body><p>hi</p>"
        assert find_truncation(html) is not None

    def test_detects_a_document_with_no_body_at_all(self):
        from app.services.page_ai import find_truncation
        html = "<!DOCTYPE html><html><head><style>p{}</style></head>"
        assert find_truncation(html) is not None

    def test_detects_empty_output(self):
        from app.services.page_ai import find_truncation
        assert find_truncation("   ") is not None

    def test_accepts_a_complete_document(self):
        from app.services.page_ai import find_truncation
        html = ("<!DOCTYPE html><html><head><style>body{margin:0}</style></head>"
                "<body><h1>Hi</h1></body></html>")
        assert find_truncation(html) is None

    def test_accepts_a_complete_document_with_several_style_blocks(self):
        from app.services.page_ai import find_truncation
        html = ("<!DOCTYPE html><html><head><style>a{}</style><style>b{}</style>"
                "</head><body>x</body></html>")
        assert find_truncation(html) is None

    # Fragments are wrapped by the viewer, so they legitimately have no <html>.
    def test_accepts_a_bare_fragment(self):
        from app.services.page_ai import find_truncation
        assert find_truncation("<h1>Just a heading</h1>") is None
