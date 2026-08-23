"""
Surgical revision — editing a page instead of re-emitting it.

The behaviour this replaces: "make the hero darker" on an 800-word page sent the
whole document to the model and asked for the whole document back. It was slow
in proportion to the page rather than the request, it rewrote sections nobody
asked about, and on a long page it hit the output ceiling and truncated
mid-file — which publishes as a blank screen.
"""

import pytest

from app.services.page_edit import (
    EditError, apply_edit_blocks, parse_edit_blocks, EDIT_RULES,
)

DOC = """<!DOCTYPE html>
<html>
<head><style>
body { background: var(--clr-bg); color: #111; }
.hero { padding: 4rem 2rem; text-align: center; }
</style></head>
<body>
<section class="hero"><h1>Vishal Sharma</h1></section>
<footer>© 2026</footer>
</body>
</html>"""


def block(search, replace):
    return f"<<<<<<< SEARCH\n{search}\n=======\n{replace}\n>>>>>>> REPLACE"


class TestParsing:
    def test_reads_a_single_block(self):
        blocks = parse_edit_blocks(block("color: #111;", "color: #eee;"))
        assert blocks == [("color: #111;", "color: #eee;")]

    def test_reads_several_blocks(self):
        text = block("a", "b") + "\n\n" + block("c", "d")
        assert len(parse_edit_blocks(text)) == 2

    def test_ignores_prose_around_the_blocks(self):
        """Models narrate what they changed; refusing the edit over a sentence
        of commentary would fail far more often than it helped."""
        text = "Sure — I darkened the hero.\n" + block("a", "b") + "\nLet me know!"
        assert parse_edit_blocks(text) == [("a", "b")]

    def test_tolerates_marker_length_drift(self):
        text = "<<<<<<<<< SEARCH\na\n=========\nb\n>>>>>>>>> REPLACE"
        assert parse_edit_blocks(text) == [("a", "b")]

    def test_allows_an_empty_replacement_for_a_deletion(self):
        assert parse_edit_blocks(block("<footer>x</footer>", "")) == [("<footer>x</footer>", "")]

    def test_drops_an_empty_search(self):
        """An empty search matches everywhere; there is no sane reading of it."""
        assert parse_edit_blocks(block("", "anything")) == []

    def test_returns_nothing_for_a_whole_document_response(self):
        """A model that ignores the format and returns HTML must not be
        mistaken for a successful edit."""
        assert parse_edit_blocks("<!DOCTYPE html><html>...</html>") == []


class TestApplying:
    def test_applies_an_exact_match(self):
        out = apply_edit_blocks(DOC, [("color: #111;", "color: #eee;")])
        assert "color: #eee;" in out["content"]
        assert "color: #111;" not in out["content"]
        assert out["applied"] == 1 and out["failed"] == 0

    def test_leaves_everything_else_byte_for_byte(self):
        """The whole point: what was not asked about does not change."""
        out = apply_edit_blocks(DOC, [("color: #111;", "color: #eee;")])
        assert out["content"].replace("color: #eee;", "color: #111;") == DOC

    def test_applies_several_blocks_in_order(self):
        out = apply_edit_blocks(DOC, [
            ("color: #111;", "color: #eee;"),
            ("<footer>© 2026</footer>", "<footer>© 2027</footer>"),
        ])
        assert out["applied"] == 2
        assert "#eee" in out["content"] and "2027" in out["content"]

    def test_a_stale_block_is_skipped_not_fatal(self):
        """Partial success leaves the author with most of what they asked for
        and a precise account of what was missed."""
        out = apply_edit_blocks(DOC, [
            ("color: #111;", "color: #eee;"),
            ("font-family: Comic Sans;", "font-family: serif;"),
        ])
        assert out["applied"] == 1
        assert out["failed"] == 1
        assert any(d["ok"] is False and "not found" in d["reason"] for d in out["details"])

    def test_all_blocks_failing_is_an_error_worth_surfacing(self):
        with pytest.raises(EditError, match="None of the edits matched"):
            apply_edit_blocks(DOC, [("nothing like this exists", "x")])

    def test_no_blocks_at_all_is_an_error(self):
        with pytest.raises(EditError, match="no edits"):
            apply_edit_blocks(DOC, [])

    def test_tolerates_reindented_search_text(self):
        """A model asked to echo CSS back will sometimes reflow it, and failing
        a correct edit over two spaces is a poor trade."""
        out = apply_edit_blocks(DOC, [
            (".hero    {   padding: 4rem 2rem;    text-align: center;   }",
             ".hero { padding: 6rem 2rem; text-align: left; }"),
        ])
        assert out["applied"] == 1
        assert "padding: 6rem 2rem" in out["content"]

    def test_a_deletion_removes_the_matched_text(self):
        out = apply_edit_blocks(DOC, [("<footer>© 2026</footer>", "")])
        assert "footer" not in out["content"]

    def test_reports_the_size_of_each_change(self):
        out = apply_edit_blocks(DOC, [("color: #111;", "color: #eee;")])
        d = out["details"][0]
        assert d["removed"] == len("color: #111;")
        assert d["added"] == len("color: #eee;")


class TestTheRulesGivenToTheModel:
    def test_the_format_is_specified_exactly(self):
        for marker in ("<<<<<<< SEARCH", "=======", ">>>>>>> REPLACE"):
            assert marker in EDIT_RULES

    def test_it_forbids_returning_the_whole_document(self):
        assert "never return the whole document" in EDIT_RULES

    def test_it_asks_for_small_independent_blocks(self):
        assert "One block per distinct change" in EDIT_RULES
