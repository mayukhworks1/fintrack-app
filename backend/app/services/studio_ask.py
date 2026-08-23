"""
Answering questions from the Studio document corpus.

The shape is deliberately a fixed pipeline rather than a model-driven agent
loop:

    retrieve (lexical + vector) → rank → answer with citations → verify

Nothing in this repo uses tool calling, and every model in the cascade is on
OpenRouter's free tier, where multi-step tool loops are both unreliable and
rate-limited. A fixed pipeline gives up some flexibility and buys back
predictable latency, a bounded number of model calls per question, and a path
that can be tested without a model in the loop.

Citations are the point. An answer that cannot name the document and page it
came from is indistinguishable from one the model invented, so retrieval
returns numbered sources and the prompt requires the answer to cite them.
"""

from __future__ import annotations

import logging
import re
import time

from ..db.postgres import get_pool
from . import embeddings
from .openrouter import _try_chat, judge_answer

logger = logging.getLogger("fintrack.studio.ask")

TOP_K = 6
MAX_CONTEXT_CHARS = 14000
MIN_SIMILARITY = 0.25

_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "is",
    "are", "was", "were", "what", "which", "who", "how", "why", "when", "where",
    "does", "do", "did", "can", "should", "would", "about", "from", "this",
    "that", "these", "those", "please", "tell", "show", "give", "any", "all",
}


_HEADLINE_MARK = re.compile(r"</?b>")


def _strip_marks(headline: str) -> str:
    """
    ts_headline wraps matches in <b> tags. The excerpt is rendered as text, so
    the tags would show up literally in a citation.
    """
    return _HEADLINE_MARK.sub("", headline or "").strip()


def _terms(query: str, limit: int = 12) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9'./-]{1,}", (query or "").lower())
    seen: set[str] = set()
    out: list[str] = []
    for word in words:
        if word in _STOPWORDS or len(word) < 3 or word in seen:
            continue
        seen.add(word)
        out.append(word)
        if len(out) >= limit:
            break
    return out


async def _text_search(pool, query: str, document_ids: list[str] | None, limit: int) -> list[dict]:
    """
    Postgres full-text search over the GIN-indexed tsvector.

    This is the primary retrieval path. It replaced a regex hit-count that had
    to read every chunk in the corpus on every question; this is an index lookup
    with proper relevance ranking, stemming and stopword handling behind it.

    `websearch_to_tsquery` is used rather than `plainto_tsquery` because it
    understands quoted phrases and OR the way a person types them, and it never
    raises on odd punctuation — `to_tsquery` does.

    The excerpt comes from `ts_headline`, so a citation shows the sentence that
    actually matched instead of whatever happened to open the chunk.
    """
    try:
        rows = await pool.fetch(
            """
            SELECT c.id, c.document_id, c.page_number, c.content, c.embedding_vec,
                   d.title, d.filename,
                   ts_rank_cd(c.content_tsv, q) AS rank,
                   ts_headline('english', c.content, q,
                               'MaxWords=48, MinWords=20, ShortWord=3, MaxFragments=1') AS headline
              FROM studio_doc_chunks c
              JOIN studio_documents d ON d.id = c.document_id,
                   websearch_to_tsquery('english', $1) AS q
             WHERE d.status = 'ready'
               AND ($2::uuid[] IS NULL OR c.document_id = ANY($2::uuid[]))
               AND c.content_tsv @@ q
             ORDER BY rank DESC
             LIMIT $3
            """,
            query, document_ids, limit,
        )
    except Exception as exc:
        # The tsvector column is created behind an exception guard, so it can be
        # absent on an instance where the DDL failed. Retrieval degrades to
        # keyword matching rather than the feature disappearing.
        logger.debug("studio full-text search unavailable: %s", exc)
        return []
    return [dict(r) | {"method": "lexical", "score": float(r["rank"])} for r in rows]


async def _keyword_fallback(pool, terms: list[str], document_ids: list[str] | None) -> list[dict]:
    """
    Last resort for a question full-text search cannot parse into a query —
    all stopwords, or a bare identifier like an invoice number that the English
    dictionary stems into nothing.
    """
    if not terms:
        return []
    pattern = "|".join(re.escape(t) for t in terms)
    rows = await pool.fetch(
        """
        SELECT c.id, c.document_id, c.page_number, c.content, c.embedding_vec,
               d.title, d.filename
          FROM studio_doc_chunks c
          JOIN studio_documents d ON d.id = c.document_id
         WHERE d.status = 'ready'
           AND ($2::uuid[] IS NULL OR c.document_id = ANY($2::uuid[]))
           AND c.content ~* $1
         LIMIT $3
        """,
        pattern, document_ids, TOP_K * 2,
    )
    return [dict(r) | {"method": "lexical", "score": 0.5} for r in rows]


async def _cosine_rerank(pool, query: str, candidates: list[dict]) -> list[dict]:
    """
    Re-order full-text candidates by semantic similarity.

    pgvector is not available on this deployment, so there is no ANN index to
    search — but cosine over a *bounded* candidate set costs almost nothing.
    Full-text search narrows the corpus to a few dozen rows first, and only
    those are scored, which keeps semantic ranking affordable without the
    extension. Anything that fails here leaves the full-text order intact.
    """
    scored = [c for c in candidates if c.get("embedding_vec")]
    if not scored:
        return candidates

    vec = await embeddings.get_embedding(query)
    if not vec:
        return candidates

    try:
        rows = await pool.fetch(
            """
            SELECT c.id, ft_cosine(c.embedding_vec, $2::float8[]) AS similarity
              FROM studio_doc_chunks c
             WHERE c.id = ANY($1::bigint[])
               AND c.embedding_vec IS NOT NULL
            """,
            [c["id"] for c in scored], vec,
        )
    except Exception as exc:
        logger.debug("studio cosine re-rank failed: %s", exc)
        return candidates

    sims = {r["id"]: float(r["similarity"] or 0) for r in rows}
    for c in candidates:
        if c["id"] in sims:
            c["similarity"] = sims[c["id"]]
            c["method"] = "hybrid"
    # Rank on similarity where we have it, otherwise keep the text rank below it.
    candidates.sort(key=lambda c: (c.get("similarity") is not None, c.get("similarity", 0)), reverse=True)
    return candidates


async def _vector(pool, query: str, document_ids: list[str] | None) -> list[dict]:
    """Semantic neighbours — finds the passage that means the same thing in
    different words, which is exactly what keyword matching misses."""
    if not await embeddings.is_pgvector_available():
        return []
    vec = await embeddings.get_embedding(query)
    if not vec:
        return []
    try:
        rows = await pool.fetch(
            """
            SELECT c.id, c.document_id, c.page_number, c.content, d.title, d.filename,
                   1 - (c.embedding <=> $1::vector) AS similarity
              FROM studio_doc_chunks c
              JOIN studio_documents d ON d.id = c.document_id
             WHERE d.status = 'ready'
               AND c.embedding IS NOT NULL
               AND ($2::uuid[] IS NULL OR c.document_id = ANY($2::uuid[]))
               AND 1 - (c.embedding <=> $1::vector) > $3
             ORDER BY c.embedding <=> $1::vector
             LIMIT $4
            """,
            embeddings._vec_literal(vec), document_ids, MIN_SIMILARITY, TOP_K * 2,
        )
        return [dict(r) | {"method": "vector", "score": float(r["similarity"])} for r in rows]
    except Exception as exc:
        logger.debug("studio vector search failed: %s", exc)
        return []


def _merge(lexical: list[dict], vector: list[dict]) -> list[dict]:
    """
    Merge by chunk id, preferring the vector score when a chunk was found both
    ways — a passage both searches agree on is the strongest signal available,
    so it is marked 'hybrid' and sorted first.
    """
    by_id: dict[int, dict] = {}
    for item in vector:
        by_id[item["id"]] = item
    for item in lexical:
        existing = by_id.get(item["id"])
        if existing:
            existing["method"] = "hybrid"
        else:
            by_id[item["id"]] = item

    ranked = sorted(
        by_id.values(),
        key=lambda c: (c["method"] == "hybrid", c["method"] == "vector", c["score"]),
        reverse=True,
    )
    return ranked[:TOP_K]


# How many full-text hits are handed to the cosine re-ranker. Wide enough that
# the right passage is usually somewhere in the set, narrow enough that scoring
# it costs milliseconds rather than a scan of the corpus.
RERANK_CANDIDATES = 40


async def retrieve(query: str, document_ids: list[str] | None = None) -> list[dict]:
    """
    Full-text search first, then semantic re-ranking of what it found.

    Ordering the two this way is what makes semantic search possible at all
    here: without pgvector there is no index to search vectors with, so the
    candidate set has to be narrowed by something that *is* indexed before
    similarity is computed.
    """
    pool = get_pool()
    if not pool:
        return []

    candidates = await _text_search(pool, query, document_ids, RERANK_CANDIDATES)
    if not candidates:
        candidates = await _keyword_fallback(pool, _terms(query), document_ids)

    # When the extension does exist, its index finds passages full-text search
    # missed entirely, so those are merged in rather than replaced.
    native = await _vector(pool, query, document_ids)
    if native:
        return _merge(candidates[:TOP_K * 2], native)

    ranked = await _cosine_rerank(pool, query, candidates)
    return ranked[:TOP_K]


def build_context(chunks: list[dict]) -> str:
    """Number the sources so the model has something concrete to cite."""
    parts: list[str] = []
    used = 0
    for index, chunk in enumerate(chunks, start=1):
        label = chunk.get("title") or chunk.get("filename") or "Document"
        page = chunk.get("page_number")
        head = f"[{index}] {label}" + (f", page {page}" if page else "")
        body = (chunk.get("content") or "").strip()
        block = f"{head}\n{body}"
        if used + len(block) > MAX_CONTEXT_CHARS:
            break
        parts.append(block)
        used += len(block)
    return "\n\n---\n\n".join(parts)


_SYSTEM = """You answer questions using ONLY the numbered sources provided.

Rules:
- Every factual claim must carry a citation in square brackets naming the source
  number it came from, like [2]. A sentence with no source does not belong.
- If the sources do not contain the answer, say so plainly and name what is
  missing. Never fill a gap from general knowledge — a confident wrong answer
  about someone's contract is worse than no answer.
- Quote exact figures, dates and names as they appear. Do not round or rephrase
  numbers.
- Answer in prose, not bullet-point fragments, unless the question asks for a
  list. Be brief: two or three short paragraphs at most.
- Do not mention "the sources" or "the context" as objects. Write the answer as
  a person would, with the bracketed citations doing that work."""


async def ask(question: str, document_ids: list[str] | None = None) -> dict:
    """
    Answer a question from the corpus.

    Returns {answer, sources, model, verdict, latency_ms, retrieval}.
    """
    question = (question or "").strip()
    if not question:
        raise ValueError("A question is required.")
    if len(question) > 2000:
        raise ValueError("That question is too long — try asking it more directly.")

    started = time.time()
    chunks = await retrieve(question, document_ids)

    if not chunks:
        return {
            "answer": (
                "Nothing in the uploaded documents matches that question. "
                "Either the document covering it has not been added yet, or it is "
                "still being processed."
            ),
            "sources": [],
            "model": "",
            "verdict": "no-sources",
            "latency_ms": int((time.time() - started) * 1000),
            "retrieval": "none",
        }

    context = build_context(chunks)
    result = await _try_chat(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "system", "content": f"SOURCES:\n\n{context}"},
            {"role": "user", "content": question},
        ],
        max_tokens=1200,
        temperature=0.2,
        extract=False,
    )
    answer = (result.get("content") or "").strip()

    # The same judge the AI assistant uses. It costs one extra call and catches
    # the failure that matters here: an answer that reads well but is not in the
    # sources at all.
    verdict = "unverified"
    try:
        checked = await judge_answer(question, answer, context)
        verdict = checked.get("verdict") or "unverified"
        if verdict == "soft-fail" and checked.get("corrected_answer"):
            answer = checked["corrected_answer"].strip()
    except Exception as exc:
        logger.debug("studio judge skipped: %s", exc)

    methods = {c["method"] for c in chunks}
    return {
        "answer": answer,
        "sources": [
            {
                "n": i,
                "document_id": str(c["document_id"]),
                "title": c.get("title") or c.get("filename") or "Document",
                "page": c.get("page_number"),
                "method": c["method"],
                # ts_headline gives the sentence that actually matched. Falling
                # back to the top of the chunk shows whatever happened to open
                # it, which often has nothing to do with the question.
                "excerpt": _strip_marks(c.get("headline") or "") or (c.get("content") or "")[:280],
            }
            for i, c in enumerate(chunks, start=1)
        ],
        "model": result.get("model_short") or result.get("model", ""),
        "verdict": verdict,
        "latency_ms": int((time.time() - started) * 1000),
        "retrieval": "hybrid" if "hybrid" in methods else ("vector" if "vector" in methods else "lexical"),
    }
