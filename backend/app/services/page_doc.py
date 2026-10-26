"""
Block documents ("doc" pages).

A doc page stores its content as the editor's JSON (TipTap / ProseMirror
document JSON). The public viewer renders that JSON itself, read-only, through
the same schema the editor uses, so the server never turns it into HTML. What
the server does need is text: word counts for version history, and a
description for link previews when the author has not written one.
"""

from __future__ import annotations

import json
import re
from typing import Any

DOC_TYPE = "doc"

# Nodes whose text reads as a line of its own.
_BLOCKS = {
    "paragraph", "heading", "blockquote", "codeBlock", "listItem", "taskItem",
    "callout", "details", "detailsSummary", "detailsContent", "tableRow",
    "image", "embed", "horizontalRule",
}

# A document deeper than this is not something the editor produces.
_MAX_DEPTH = 64


class InvalidDoc(ValueError):
    """Content declared as a block document is not one."""


def parse_doc(content: str | None) -> dict | None:
    """The document in `content`, or None when it is empty or not a document."""
    if not content or not content.strip():
        return None
    try:
        doc = json.loads(content)
    except (ValueError, TypeError):
        return None
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        return None
    return doc


def validate_doc(content: str | None) -> None:
    """Raise InvalidDoc unless `content` is empty or a well-formed document."""
    if not content or not content.strip():
        return
    doc = parse_doc(content)
    if doc is None:
        raise InvalidDoc("A document page's content must be block document JSON.")

    def walk(node: Any, depth: int) -> None:
        if depth > _MAX_DEPTH:
            raise InvalidDoc("The document is nested too deeply.")
        if not isinstance(node, dict) or not isinstance(node.get("type"), str):
            raise InvalidDoc("Every block must be an object with a type.")
        if "text" in node and not isinstance(node["text"], str):
            raise InvalidDoc("Text must be a string.")
        children = node.get("content")
        if children is None:
            return
        if not isinstance(children, list):
            raise InvalidDoc("Block content must be a list.")
        for child in children:
            walk(child, depth + 1)

    walk(doc, 0)


def doc_text(content: str | None) -> str:
    """Plain text of a document: one line per block, table cells tab-separated."""
    doc = parse_doc(content)
    if doc is None:
        return ""
    out: list[str] = []

    def end_line() -> None:
        if out and not out[-1].endswith("\n"):
            out.append("\n")

    def walk(node: Any, depth: int = 0) -> None:
        if not isinstance(node, dict) or depth > _MAX_DEPTH:
            return
        kind = node.get("type")
        if kind == "text":
            out.append(str(node.get("text") or ""))
            return
        if kind == "hardBreak":
            out.append("\n")
            return
        if kind == "image":
            alt = (node.get("attrs") or {}).get("alt")
            if isinstance(alt, str) and alt:
                out.append(alt)
        if kind == "tableRow":
            end_line()
            cells = []
            for cell in node.get("content") or []:
                inner = doc_text(json.dumps({"type": "doc", "content": (cell or {}).get("content") or []}))
                cells.append(re.sub(r"\s+", " ", inner).strip())
            out.append("\t".join(cells))
            out.append("\n")
            return
        for child in node.get("content") or []:
            walk(child, depth + 1)
        if kind in _BLOCKS:
            end_line()

    walk(doc)
    text = "".join(out)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def doc_excerpt(content: str | None, limit: int = 180) -> str:
    """The opening text of a document, cut at a word boundary."""
    text = re.sub(r"\s+", " ", doc_text(content)).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-") + "…"


def word_count(content: str | None, content_type: str | None) -> int:
    """Words in a page's content; a document counts its text, not its JSON."""
    if content_type == DOC_TYPE:
        text = doc_text(content)
    else:
        text = content or ""
    return len(text.split()) if text else 0
