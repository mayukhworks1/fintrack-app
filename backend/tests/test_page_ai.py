"""
Output cleaning for AI-generated pages.

Published pages are served as their own document, so script, external CSS and
web fonts all work and nothing needs stripping. What is left is unwrapping the
model's formatting, and naming the two things that still publish badly: a
relative file path with no directory to resolve against, and content that stays
hidden until a script reveals it.
"""

import pytest

from app.services.page_ai import clean_output, find_fragile_patterns, generate_page


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


class TestNothingWorkingIsRemoved:
    """
    These all used to be stripped, back when the page inherited the app's CSP.
    They work now, and deleting them would delete the page's behaviour.
    """

    def test_keeps_script(self):
        src = "<p>a</p><script>init()</script>"
        out, _ = clean_output(src, "html")
        assert out == src

    def test_keeps_external_stylesheets_and_web_fonts(self):
        src = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces">'
        out, _ = clean_output(src, "html")
        assert out == src

    def test_keeps_inline_event_handlers(self):
        src = '<button onclick="go()">Go</button>'
        out, _ = clean_output(src, "html")
        assert out == src

    def test_keeps_external_images_and_inline_svg(self):
        src = '<img src="https://example.com/a.png" alt="A"><svg><circle r="4"/></svg>'
        out, warnings = clean_output(src, "html")
        assert out == src
        assert warnings == []


class TestWarnsAboutWhatPublishesBadly:
    def test_flags_a_relative_file_path(self):
        """There is no directory beside a published page, so it can only 404."""
        warnings = find_fragile_patterns('<img src="tw-logo-black.png" alt="Logo">')
        assert any("relative" in w for w in warnings)
        assert any("tw-logo-black.png" in w for w in warnings)

    def test_accepts_every_url_form_that_does_resolve(self):
        assert find_fragile_patterns(
            '<img src="https://x.test/a.png"><img src="/api/public/pages/asset/b.png">'
            '<img src="data:image/gif;base64,R0lGOD"><a href="#top">t</a>'
            '<a href="mailto:a@b.test">m</a>'
        ) == []

    # The exact shape that published a working page as a blank screen.
    def test_flags_content_hidden_until_a_script_reveals_it(self):
        warnings = find_fragile_patterns(
            "<style>.rv{opacity:0;transform:translateY(22px)}.rv.in{opacity:1;transform:none}</style>"
            "<section class='rv'>Everything</section>"
        )
        assert any("hidden until script" in w for w in warnings)

    def test_leaves_a_hidden_class_alone_when_css_can_reveal_it(self):
        """A hover or checkbox reveal needs no script, so it is not fragile."""
        assert find_fragile_patterns(
            "<style>.tip{opacity:0}.card:hover .tip{opacity:1}</style>"
        ) == []

    def test_says_nothing_about_a_healthy_document(self):
        _, warnings = clean_output(
            "<!DOCTYPE html><html><body><h1>Hi</h1>"
            '<img src="https://x.test/a.png" alt="a"></body></html>',
            "html",
        )
        assert warnings == []


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
