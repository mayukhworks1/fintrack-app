"""
Surgical edits — revising a page by changing parts of it, not re-emitting it.

The problem with whole-document revision
────────────────────────────────────────
"Make the hero darker" on an 800-word page currently sends the entire document
to the model and asks for the entire document back. Three things go wrong, and
all of them were visible in practice:

- It is slow and expensive in a way that scales with the page rather than with
  the request. A one-line change costs a full regeneration.
- The model rewrites parts nobody asked about. Copy drifts, sections are
  dropped, a working layout is replaced by a different working layout.
- Output ceilings truncate long pages mid-file, which publishes as a blank
  screen — the failure that MAX_TOKENS and find_truncation already exist to
  catch.

The format
──────────
The model returns search/replace blocks rather than a diff:

    <<<<<<< SEARCH
    background: var(--clr-bg);
    =======
    background: #0b0f14;
    >>>>>>> REPLACE

Unified diffs are the obvious alternative and are the wrong choice for weak
models: they require correct line numbers and exact context counts, and a model
that miscounts produces a patch that cannot be applied at all. A search/replace
block carries its own context and is verified by matching, so a wrong block
fails loudly and in isolation while its neighbours still apply.
"""

from __future__ import annotations

import re

# Deliberately the Aider/Bolt marker syntax. Models have seen it far more often
# than anything invented here, which measurably improves how reliably they
# produce well-formed blocks.
_BLOCK = re.compile(
    r"<{5,9}\s*SEARCH\s*\n(.*?)\n?={5,9}\s*\n(.*?)\n?>{5,9}\s*REPLACE",
    re.DOTALL,
)

MAX_BLOCKS = 20


class EditError(ValueError):
    """The edit could not be applied to the document."""


def parse_edit_blocks(text: str) -> list[tuple[str, str]]:
    """
    Pull search/replace pairs out of the model's response.

    Prose around the blocks is ignored rather than rejected — models narrate
    what they changed, and refusing an otherwise-valid edit over a sentence of
    commentary would fail far more often than it helped.
    """
    blocks: list[tuple[str, str]] = []
    for match in _BLOCK.finditer(text or ""):
        search, replace = match.group(1), match.group(2)
        if not search.strip():
            # An empty search would match everywhere; there is no sane
            # interpretation of it.
            continue
        blocks.append((search, replace))
        if len(blocks) >= MAX_BLOCKS:
            break
    return blocks


def _normalise(text: str) -> str:
    """Collapse the whitespace a model reflows when it echoes source back."""
    return re.sub(r"\s+", " ", text).strip()


def _find_forgiving(document: str, search: str) -> tuple[int, int] | None:
    """
    Locate `search` in `document`, tolerating reflowed whitespace.

    An exact match is tried first and is what almost always hits. The fallback
    exists because a model asked to echo a block of CSS back will sometimes
    re-indent it, and failing an otherwise-correct edit over two spaces would be
    a poor trade.
    """
    index = document.find(search)
    if index != -1:
        return index, index + len(search)

    needle = _normalise(search)
    if not needle:
        return None

    # Walk candidate windows anchored on the first non-trivial token, so the
    # scan stays proportional to the number of plausible starts rather than to
    # the length of the document squared.
    first = needle.split(" ")[0]
    if len(first) < 3:
        return None

    start = 0
    while True:
        anchor = document.find(first, start)
        if anchor == -1:
            return None
        # A window generous enough to absorb added indentation.
        window_end = min(len(document), anchor + len(search) * 2 + 80)
        if _normalise(document[anchor:window_end]).startswith(needle):
            # Tighten the end back to the shortest window that still matches.
            for end in range(anchor + len(needle), window_end + 1):
                if _normalise(document[anchor:end]) == needle:
                    return anchor, end
            return anchor, window_end
        start = anchor + 1


def apply_edit_blocks(document: str, blocks: list[tuple[str, str]]) -> dict:
    """
    Apply blocks in order, reporting each one's fate.

    Returns {content, applied, failed, details}. A block that does not match is
    skipped rather than aborting the rest: partial success leaves the author
    with most of what they asked for and a precise account of what was missed,
    which beats discarding a good edit because one block was stale.
    """
    if not blocks:
        raise EditError("The model returned no edits to apply.")

    content = document
    applied = 0
    details: list[dict] = []

    for search, replace in blocks:
        span = _find_forgiving(content, search)
        if span is None:
            details.append({
                "ok": False,
                "search": search[:120],
                "reason": "not found in the page",
            })
            continue
        start, end = span
        content = content[:start] + replace + content[end:]
        applied += 1
        details.append({
            "ok": True,
            "search": search[:120],
            "replace": replace[:120],
            "removed": end - start,
            "added": len(replace),
        })

    if applied == 0:
        raise EditError(
            "None of the edits matched the current page. It may have changed "
            "since the model read it — try the request again."
        )

    return {
        "content": content,
        "applied": applied,
        "failed": len(blocks) - applied,
        "details": details,
    }


EDIT_RULES = """You edit an existing HTML document by returning ONLY
search/replace blocks. You never return the whole document.

Format — exactly this, repeated for each change:

<<<<<<< SEARCH
(text copied EXACTLY from the current document, including indentation)
=======
(the replacement text)
>>>>>>> REPLACE

Rules that decide whether the edit can be applied at all:
- The SEARCH text must be copied character for character from the document
  shown to you. Do not reformat it, re-indent it, or fix its style.
- Include just enough surrounding text to make the SEARCH unique. Two or three
  lines is usually right. A single common line like `}` will match the wrong
  place.
- One block per distinct change. Several small blocks are far better than one
  large one, because a block that fails takes only its own change down.
- Change only what was asked for. Leave copy, structure and styling that the
  request did not mention exactly as they are.
- If the change needs new markup, SEARCH for the element it goes next to and
  include that element in the REPLACE along with the addition.

Write nothing outside the blocks except, at most, one short sentence saying what
you changed."""


def revision_context(document: str, request: str) -> str:
    """The message that shows the model the document it is editing."""
    return (
        "Here is the current document. Edit it with search/replace blocks.\n\n"
        f"--- CURRENT DOCUMENT ---\n{document}\n--- END DOCUMENT ---\n\n"
        f"Requested change: {request}"
    )
