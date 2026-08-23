"""
Studio: document ingestion, retrieval ranking and quota accounting.

The pieces covered here are the ones that decide whether an answer can be
trusted — where a chunk was cut, which page it claims to come from, and which
passages reach the model — plus the quota that stops one runaway loop from
exhausting a shared free-tier account.
"""

import pytest

from app.services import studio_docs, studio_ask, studio_usage


class TestFileTypeGate:
    def test_accepts_by_mime(self):
        assert studio_docs.kind_for("x", "application/pdf") == "pdf"
        assert studio_docs.kind_for("x", "text/markdown") == "text"

    def test_falls_back_to_the_extension(self):
        """Browsers send application/octet-stream for plenty of real files."""
        assert studio_docs.kind_for("notes.md", "application/octet-stream") == "text"
        assert studio_docs.kind_for("contract.pdf", "") == "pdf"

    def test_rejects_what_cannot_be_read_as_text(self):
        assert studio_docs.kind_for("photo.png", "image/png") is None
        assert studio_docs.kind_for("archive.zip", "application/zip") is None


class TestExtraction:
    def test_plain_text_is_one_page(self):
        """A .txt file has no pagination; inventing one makes citations lie."""
        pages = studio_docs.extract_pages(b"hello world", "text")
        assert pages == ["hello world"]

    def test_collapses_the_whitespace_extraction_leaves(self):
        pages = studio_docs.extract_pages(b"a    b\n\n\n\n\nc", "text")
        assert pages[0] == "a b\n\nc"

    def test_survives_a_bad_encoding(self):
        pages = studio_docs.extract_pages(b"caf\xe9 terms", "text")
        assert "terms" in pages[0]


class TestChunking:
    def test_keeps_the_page_number_with_every_chunk(self):
        chunks = studio_docs.chunk_pages(["page one text", "page two text"])
        assert [c["page_number"] for c in chunks] == [1, 2]

    def test_skips_blank_pages(self):
        """A scanned separator page must not consume a citation slot."""
        chunks = studio_docs.chunk_pages(["real text", "   ", "\n\n", "more text"])
        assert len(chunks) == 2
        assert [c["page_number"] for c in chunks] == [1, 4]

    def test_splits_a_long_page_with_overlap(self):
        page = "\n\n".join(f"Paragraph {i}. " + ("filler words " * 40) for i in range(20))
        chunks = studio_docs.chunk_pages([page])
        assert len(chunks) > 1
        assert all(c["page_number"] == 1 for c in chunks)
        # Overlap exists so a passage crossing a boundary survives whole in one.
        joined = sum(len(c["content"]) for c in chunks)
        assert joined > len(page)

    def test_prefers_a_paragraph_break_over_a_hard_cut(self):
        """A chunk cut mid-sentence retrieves badly and reads worse when quoted."""
        first = "A" * 3000
        page = first + "\n\n" + ("B" * 3000)
        chunks = studio_docs.chunk_pages([page])
        assert chunks[0]["content"].endswith("A")
        assert not chunks[0]["content"].endswith("B")

    def test_caps_runaway_documents(self):
        huge = "word " * 400_000
        assert len(studio_docs.chunk_pages([huge])) <= studio_docs.MAX_CHUNKS_PER_DOC

    def test_estimates_tokens(self):
        chunks = studio_docs.chunk_pages(["a" * 400])
        assert chunks[0]["token_est"] == 100


class TestRanking:
    """
    A chunk both searches agree on is the strongest signal available, so it must
    outrank one found only by keyword or only by similarity.
    """

    def test_a_chunk_found_both_ways_is_marked_hybrid_and_ranked_first(self):
        lexical = [{"id": 1, "score": 2.0, "method": "lexical"},
                   {"id": 2, "score": 9.0, "method": "lexical"}]
        vector = [{"id": 1, "score": 0.6, "method": "vector"}]
        merged = studio_ask._merge(lexical, vector)
        assert merged[0]["id"] == 1
        assert merged[0]["method"] == "hybrid"

    def test_keeps_results_from_either_search_alone(self):
        merged = studio_ask._merge(
            [{"id": 1, "score": 1.0, "method": "lexical"}],
            [{"id": 2, "score": 0.9, "method": "vector"}],
        )
        assert {c["id"] for c in merged} == {1, 2}

    def test_never_returns_more_than_the_context_budget(self):
        lexical = [{"id": i, "score": float(i), "method": "lexical"} for i in range(30)]
        assert len(studio_ask._merge(lexical, [])) == studio_ask.TOP_K


class TestQueryTerms:
    def test_drops_stopwords_and_short_words(self):
        terms = studio_ask._terms("What are the payment terms in the contract?")
        assert "the" not in terms and "are" not in terms
        assert "payment" in terms and "terms" in terms

    def test_deduplicates(self):
        assert studio_ask._terms("invoice invoice invoice") == ["invoice"]

    def test_empty_question_yields_nothing(self):
        assert studio_ask._terms("") == []


class TestSearchQuery:
    """
    The reported failure: a real question over an uploaded document returned
    "no matching passages". Both websearch_to_tsquery and plainto_tsquery join
    words with AND, so "What are the payment terms in the Britannia agreement?"
    required one chunk to contain payment AND term AND britannia AND agreement.
    Almost no natural question survives that.
    """

    def test_terms_are_ored_not_anded(self):
        q = studio_ask._tsquery_or("What are the payment terms in the Britannia agreement?")
        assert "|" in q
        assert "&" not in q

    def test_keeps_every_content_word(self):
        q = studio_ask._tsquery_or("What are the payment terms in the Britannia agreement?")
        for word in ("payment", "terms", "britannia", "agreement"):
            assert word in q

    def test_strips_punctuation_that_would_break_the_parser(self):
        """to_tsquery parses its input as an expression and raises on stray
        punctuation — an apostrophe would turn a search into a 500."""
        q = studio_ask._tsquery_or("what is the client's year-end date?")
        assert "'" not in q and "-" not in q
        assert "clients" in q and "yearend" in q

    def test_returns_none_when_there_is_nothing_to_search_for(self):
        assert studio_ask._tsquery_or("what is it?") is None
        assert studio_ask._tsquery_or("") is None

    def test_does_not_repeat_a_term(self):
        assert studio_ask._tsquery_or("invoice invoice invoice") == "invoice"


class TestCitationContext:
    def test_numbers_sources_so_the_model_has_something_to_cite(self):
        context = studio_ask.build_context([
            {"title": "MSA", "page_number": 4, "content": "Net 30 days."},
            {"title": "SOW", "page_number": 1, "content": "Phase one scope."},
        ])
        assert "[1] MSA, page 4" in context
        assert "[2] SOW, page 1" in context

    def test_omits_the_page_when_there_isnt_one(self):
        context = studio_ask.build_context([{"title": "Notes", "page_number": None, "content": "x"}])
        assert "[1] Notes" in context
        assert "page" not in context

    def test_stops_at_the_context_budget(self):
        chunks = [{"title": f"D{i}", "page_number": 1, "content": "x" * 5000} for i in range(10)]
        assert len(studio_ask.build_context(chunks)) <= studio_ask.MAX_CONTEXT_CHARS + 200


@pytest.mark.asyncio
class TestAskValidation:
    """Rejected before any model call, so a bad request costs nothing."""

    async def test_rejects_an_empty_question(self):
        with pytest.raises(ValueError, match="question is required"):
            await studio_ask.ask("   ")

    async def test_rejects_an_overlong_question(self):
        with pytest.raises(ValueError, match="too long"):
            await studio_ask.ask("x" * 2500)


@pytest.mark.asyncio
class TestQuota:
    """
    Every model in the cascade is on OpenRouter's free tier, which is limited
    per account rather than per user — so one person's retry loop degrades the
    assistant for everyone.
    """

    async def test_an_anonymous_caller_is_not_metered(self):
        """No user id means no auth_users row to account against."""
        state = await studio_usage.quota_state(None)
        assert state["allowed"] is True
        assert state["limit"] == studio_usage.DAILY_CALL_LIMIT

    async def test_usage_is_zero_without_a_database(self):
        usage = await studio_usage.usage_for(None)
        assert usage == {"calls": 0, "prompt_tokens": 0, "answer_tokens": 0, "avg_latency_ms": 0}

    async def test_breakdown_degrades_to_empty(self):
        assert await studio_usage.breakdown() == []
