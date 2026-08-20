"""
The document a published page is actually served as.

The bug this covers: author pages were dropped into an iframe's `srcdoc`, and a
srcdoc document inherits the embedder's Content-Security-Policy instead of
carrying its own. Under `script-src 'self'` that blocked every script an author
wrote — which, for the reveal-on-scroll idiom that nearly every landing page
uses, meant the content never became visible and the page published blank.
"""

import re

from app.services import page_render


class TestDocumentAssembly:
    def test_wraps_a_bare_fragment(self):
        out = page_render.build_document("<h1>Hi</h1>")
        assert out.startswith("<!DOCTYPE html>")
        assert "<h1>Hi</h1>" in out
        assert '<meta charset="utf-8">' in out

    def test_keeps_an_author_document_and_injects_into_its_head(self):
        src = "<!DOCTYPE html><html><head><title>Mine</title></head><body><p>B</p></body></html>"
        out = page_render.build_document(src)
        assert "<title>Mine</title>" in out
        assert "<p>B</p>" in out
        assert ":where(html,body){margin:0;padding:0}" in out

    def test_creates_a_head_when_the_author_wrote_html_without_one(self):
        out = page_render.build_document("<html><body><p>No head</p></body></html>")
        assert "<head>" in out
        assert "<p>No head</p>" in out
        assert ":where(html,body){margin:0;padding:0}" in out

    def test_injects_the_reset_before_author_styles(self):
        src = "<!DOCTYPE html><html><head><style>body{margin:40px}</style></head><body>x</body></html>"
        out = page_render.build_document(src)
        assert out.index("margin:0;padding:0") < out.index("body{margin:40px}")

    # The reported bug: published pages showed an inset down both sides. That
    # was the browser's default 8px body margin.
    def test_zeroes_the_body_margin_that_caused_the_side_gaps(self):
        assert ":where(html,body){margin:0;padding:0}" in page_render.build_document("<p>x</p>")

    def test_constrains_media_so_an_image_cannot_force_sideways_scroll(self):
        out = page_render.build_document('<img src="huge.png">')
        assert ":where(img,svg,video,canvas){max-width:100%;height:auto}" in out

    def test_every_element_targeting_reset_rule_has_zero_specificity(self):
        """Author CSS must always win, so nothing that targets an author
        element may carry specificity of its own."""
        selectors = [r.split("{")[0].strip() for r in page_render.VIEWER_RESET.split("}")]
        element_rules = [s for s in selectors if s and not s.startswith(".")]
        assert element_rules
        for sel in element_rules:
            assert ":where(" in sel, f'"{sel}" must be wrapped in :where()'

    def test_only_pads_when_asked(self):
        assert ":where(body){padding:14px}" in page_render.build_document("<p>x</p>", padded=True)
        assert ":where(body){padding:14px}" not in page_render.build_document("<p>x</p>")

    def test_survives_empty_content(self):
        for value in (None, ""):
            assert page_render.build_document(value).startswith("<!DOCTYPE html>")

    def test_runtime_lands_inside_body_for_a_full_document(self):
        out = page_render.build_document(
            "<!DOCTYPE html><html><head></head><body><p>x</p></body></html>"
        )
        assert out.index("data-ft-link") > out.index("<p>x</p>")
        assert out.index("data-ft-link") < out.index("</body>")

    def test_runtime_still_lands_when_body_is_never_closed(self):
        out = page_render.build_document("<!DOCTYPE html><html><head></head><body><p>x</p></html>")
        assert "data-ft-link" in out
        assert out.index("data-ft-link") < out.index("</html>")

    # The prelude repairs the environment author scripts assume, so it is
    # worthless if it runs after them.
    def test_prelude_precedes_author_script(self):
        out = page_render.build_document(
            "<!DOCTYPE html><html><head></head><body><script>init()</script></body></html>"
        )
        assert out.index("memoryStorage") < out.index("init()")

    def test_prelude_shims_storage_and_history(self):
        """An opaque origin throws on localStorage; one unguarded read at the
        top of an author's bundle would otherwise kill the whole page."""
        assert "localStorage" in page_render.VIEWER_PRELUDE
        assert "sessionStorage" in page_render.VIEWER_PRELUDE
        assert "pushState" in page_render.VIEWER_PRELUDE


class TestSandbox:
    # allow-scripts beside allow-same-origin voids the sandbox outright. If the
    # API and the SPA ever share an origin, author script could then read a
    # signed-in visitor's auth token out of localStorage.
    def test_never_combines_allow_scripts_with_allow_same_origin(self):
        assert "allow-scripts" in page_render.PAGE_SANDBOX
        assert "allow-same-origin" not in page_render.PAGE_SANDBOX

    def test_never_allows_navigating_the_embedding_page(self):
        assert "allow-top-navigation" not in page_render.PAGE_SANDBOX

    def test_permits_what_author_pages_legitimately_need(self):
        for flag in ("allow-forms", "allow-popups", "allow-modals"):
            assert flag in page_render.PAGE_SANDBOX


class TestPolicy:
    def test_author_scripts_are_allowed_to_run(self):
        """The whole point. Under the app's own policy they were not."""
        script_src = re.search(r"script-src ([^;]+)", page_render.csp_header()).group(1)
        assert "'unsafe-inline'" in script_src

    def test_web_fonts_and_external_stylesheets_are_allowed(self):
        csp = page_render.csp_header()
        assert "font-src https:" in csp
        assert "'unsafe-inline' https:" in re.search(r"style-src ([^;]+)", csp).group(1)

    def test_names_who_may_frame_the_page(self):
        assert "frame-ancestors" in page_render.csp_header()

    # Pinning this to a configured host list is what would break it: the origin
    # a visitor types (custom domain, apex vs www, a preview deployment) need
    # not be the one the backend was configured with, and a mismatch shows an
    # empty screen rather than a degraded page. Nothing is lost by staying
    # open — the framed document is opaque-origin, so it carries no session and
    # there is nothing to hijack.
    def test_frame_ancestors_does_not_depend_on_deployment_config(self):
        assert "https:" in page_render.frame_ancestors().split()

    def test_frame_ancestors_covers_the_dev_server(self):
        """Vite serves over http, which `https:` does not match."""
        assert "http://localhost:5173" in page_render.frame_ancestors()


class TestHeaders:
    def test_sends_the_policy_and_declines_x_frame_options(self):
        """X-Frame-Options has no origin list, so SAMEORIGIN would block the
        SPA from framing this whenever the API is on another host."""
        headers = page_render.render_headers()
        assert "Content-Security-Policy" in headers
        assert "X-Frame-Options" not in headers

    def test_protected_pages_are_never_cached(self):
        assert "no-store" in page_render.render_headers()["Cache-Control"]
        assert "max-age=60" in page_render.render_headers(cacheable=True)["Cache-Control"]


class TestAgentBridge:
    def test_preview_mode_injects_agent_bridge(self):
        out = page_render.build_document("<p>Hello</p>", preview=True)
        assert "__ft_page_error" in out
        assert "__ft_section_click" in out
        assert "data-agent-section" in out

    def test_standard_render_omits_agent_bridge(self):
        out = page_render.build_document("<p>Hello</p>", preview=False)
        assert "__ft_page_error" not in out
        assert "__ft_section_click" not in out

