"""
AI page generation for the Pages module.

Generated markup is published at /p/<slug>, where it is served as its own
document by services/page_render.py and framed sandboxed. It therefore runs
under that renderer's policy, not the app's: scripts, external stylesheets and
web fonts all work. The constraints that remain are the ones the sandbox
genuinely imposes — no persistent storage, no relative URLs — plus the ones
that decide whether a page reads well on a phone.
"""

from __future__ import annotations

import re

from .openrouter import _try_chat

# A full landing page with its own stylesheet runs longer than first assumed —
# 4200 truncated real output mid-CSS, which produced a document with an
# unterminated <style> and no <body> at all. A browser then reads the rest of
# the file as stylesheet text and renders nothing, so the author got a blank
# page with no error. Raised, with a structural truncation check behind it for
# the models in the cascade whose own output ceiling is lower than this.
MAX_TOKENS = 8000

# Enough freedom for varied layout, low enough to keep the markup well-formed.
TEMPERATURE = 0.6

MAX_PROMPT_CHARS = 4000
MAX_EXISTING_CHARS = 24000


_HTML_RULES = """You generate complete, self-contained HTML documents.

THE ENVIRONMENT — the page is served as its own document and displayed in a
sandboxed iframe. Inline <script>, <style>, external stylesheets, Google Fonts
and https images all work normally. What does NOT work:
- NO relative URLs to files. src="logo.png" or href="style.css" has nothing to
  resolve against and 404s. Every external reference must be an absolute https
  URL or a data: URI. Prefer inline <svg> for icons, logos, charts and
  decorative shapes — it always renders and never 404s. Use <img> only when a
  photograph is genuinely needed.
- NO persistent storage. localStorage and sessionStorage are backed by memory
  and are empty on every visit, so never make first paint depend on a stored
  value. A theme toggle is fine; a page that stays blank until a saved
  preference is read is not.
- NO server. Forms cannot be submitted anywhere useful — handle them in
  JavaScript and show a confirmation in the page.

JAVASCRIPT — allowed and encouraged, in a single <script> before </body>, with
one rule that matters more than any other: NEVER let content start hidden
unless the script that reveals it cannot fail. Reveal-on-scroll built as
`.rv{opacity:0}` + `.rv.in{opacity:1}` leaves the entire page blank if anything
above it throws. Either animate from a visible state, or pair the hidden state
with a <noscript> override. Guard every getElementById result before using it.

QUALITY BAR:
- Output a complete document: <!DOCTYPE html> through </html>.
- Mobile-first and responsive. It must read well at 390px with no sideways
  scrolling. Specifically:
  - In grid templates use minmax(0, 1fr), never minmax(150px, 1fr). A pixel
    minimum cannot shrink below itself, so on a narrow screen the track stays
    wide and the row overflows the viewport.
  - Give flex and grid children min-width: 0 when they hold text or numbers,
    otherwise long unbroken content refuses to shrink.
  - Large display numbers (currency totals like Rs 48,21,750) are wide. Size
    them with clamp() so they scale down on small screens rather than forcing
    their container open.
  - No fixed pixel widths on layout containers; use max-width with a
    percentage, or flex/grid.
- Do not rely on the browser's default body margin — set your own spacing
  explicitly. The viewer resets body margin to zero.
- Semantic HTML: header, nav, main, section, footer, h1-h6 in order.
- Every <img> needs meaningful alt text. Decorative inline SVG needs
  aria-hidden="true".
- Body text at least 16px with a contrast ratio of 4.5:1 or better.
- Include a <title> and a <meta name="viewport" content="width=device-width,
  initial-scale=1">.
- Write real, specific copy for the subject. Never lorem ipsum, never
  bracketed placeholders like [Company Name].
- Keep the stylesheet economical. Group selectors that share declarations, use
  shorthand properties, and do not restate the same rule for several elements.
  A document that runs past the output limit is cut off mid-file and renders as
  a blank page, so finishing the document matters more than styling every
  detail.

OUTPUT FORMAT:
Return only the HTML document. No commentary before or after, no markdown code
fences, no explanation of what you built."""

_MARKDOWN_RULES = """You generate well-structured Markdown documents.

- Return only Markdown. No commentary, no code fences wrapping the whole document.
- Open with a single H1, then a short introductory paragraph.
- Use headings, lists and tables to give the document structure.
- Write real, specific copy for the subject. Never lorem ipsum, never bracketed
  placeholders.
- Keep any embedded HTML minimal; it is rendered through a restricted renderer."""


def _rules_for(content_type: str) -> str:
    return _MARKDOWN_RULES if content_type == "markdown" else _HTML_RULES


# --- output cleaning -------------------------------------------------------

_FENCE_OPEN = re.compile(r"^\s*```[a-zA-Z]*\s*\n", re.MULTILINE)
_FENCE_CLOSE = re.compile(r"\n\s*```\s*$")
_FENCE_ANY = re.compile(r"^[ \t]*```[a-zA-Z]*[ \t]*$", re.MULTILINE)

# A src/href that is neither absolute, root-relative, a data/blob URI, a
# fragment nor a protocol handler. There is no directory beside a published
# page for it to resolve against, so it can only 404.
_RELATIVE_ASSET = re.compile(
    r"""\s(?:src|href)\s*=\s*["'](?!https?:|//|/|data:|blob:|#|mailto:|tel:)([^"']+)["']""",
    re.IGNORECASE,
)

# The reveal-on-scroll idiom: a class whose base rule hides the element and
# whose compound rule (.rv.in) restores it. CSS cannot add that second class —
# only script can — so if the script does not run, or throws before it reaches
# this, the content is hidden permanently.
_HIDDEN_RULE = re.compile(
    r"(?<![\w.-])(\.[\w-]+)\s*(?:,[^{]*)?\{[^}]*?(?:opacity\s*:\s*0(?!\.)|visibility\s*:\s*hidden)",
    re.IGNORECASE,
)


def find_fragile_patterns(html: str) -> list[str]:
    """
    Name the things that publish badly, without touching the document.

    Nothing here is invalid HTML, and none of it can be fixed by deleting it —
    stripping a hidden-until-scrolled class would strip the animation the author
    asked for. So this reports rather than edits, and the editor shows it beside
    the generated page.
    """
    warnings: list[str] = []

    relative = {m.group(1) for m in _RELATIVE_ASSET.finditer(html)}
    if relative:
        sample = ", ".join(sorted(relative)[:3])
        warnings.append(
            f"{len(relative)} relative file path(s) that will not resolve ({sample})"
        )

    hidden = {m.group(1) for m in _HIDDEN_RULE.finditer(html)}
    revealed = {c for c in hidden if re.search(re.escape(c) + r"\.[\w-]+\s*[,{]", html)}
    if revealed:
        warnings.append(
            f"content hidden until script runs ({', '.join(sorted(revealed)[:3])})"
        )

    return warnings


def find_truncation(html: str) -> str | None:
    """
    Return why the document looks unfinished, or None if it looks complete.

    The model can stop mid-file when it reaches its output ceiling. The result
    still looks plausible — it opens with a valid doctype and head — but a
    <style> that never closes makes the browser treat everything after it as
    stylesheet text, so the page renders completely blank. That is far worse
    than an error, because nothing points at the cause.
    """
    if not html.strip():
        return "the model returned nothing"

    low = html.lower()

    # An unbalanced <style> is the specific failure that renders blank.
    if low.count("<style") != low.count("</style>"):
        return "the stylesheet was cut off before it finished"

    # A document that opened <html> but never closed it stopped early.
    if "<html" in low and "</html>" not in low:
        return "the document was cut off before the closing </html>"
    if "<body" in low and "</body>" not in low:
        return "the document was cut off before the closing </body>"

    # A full document with no body at all never got that far.
    if "<html" in low and "<body" not in low:
        return "the document was cut off before the page content began"

    return None


def clean_output(raw: str, content_type: str) -> tuple[str, list[str]]:
    """Unwrap the model's formatting, then report anything that publishes badly."""
    text = (raw or "").strip()

    if content_type == "markdown":
        # Only unwrap when the whole document is fenced. A bare ``` line is
        # legitimate inside Markdown — it opens a code block — so they cannot be
        # stripped indiscriminately here.
        if text.startswith("```"):
            text = _FENCE_OPEN.sub("", text, count=1)
            text = _FENCE_CLOSE.sub("", text).strip()
        return text, []

    # In HTML a standalone ``` line is never legitimate, so every fence goes
    # regardless of position. Anchoring on the start of the string missed the
    # common case: a model that writes a sentence of preamble first leaves the
    # opening fence mid-document and the closing fence trailing the output.
    text = _FENCE_ANY.sub("", text).strip()

    # Occasionally a sentence of preamble survives before the document starts.
    # Take the EARLIEST of the two markers: looping over them in order and
    # truncating at the first with index > 0 threw away a leading <!DOCTYPE,
    # because <html> always follows it at a positive offset.
    lowered = text.lower()
    found = [i for i in (lowered.find("<!doctype"), lowered.find("<html")) if i != -1]
    if found and min(found) > 0:
        text = text[min(found):]

    return text, find_fragile_patterns(text)


# --- entry point -----------------------------------------------------------

async def generate_page(
    prompt: str,
    content_type: str = "html",
    existing: str | None = None,
) -> dict:
    """
    Generate or revise a page.

    With `existing`, the model revises that document in place rather than
    starting over — which is what makes iterating on a design possible instead
    of regenerating something unrelated on every prompt.

    Returns {content, model, model_short, warnings}.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError(f"Prompt is too long (max {MAX_PROMPT_CHARS} characters).")
    if content_type not in ("html", "markdown"):
        raise ValueError("AI generation supports the Web Page and Document types.")

    messages = [{"role": "system", "content": _rules_for(content_type)}]

    if existing and existing.strip():
        base = existing.strip()
        if len(base) > MAX_EXISTING_CHARS:
            raise ValueError(
                "This page is too large to revise with AI. Trim it, or generate a fresh page."
            )
        messages.append({
            "role": "system",
            "content": (
                "The user has an existing document, below. Apply their request to it and "
                "return the COMPLETE revised document. Preserve everything they did not "
                "ask you to change — content, structure and styling alike.\n\n"
                f"--- CURRENT DOCUMENT ---\n{base}\n--- END ---"
            ),
        })

    messages.append({"role": "user", "content": prompt})

    result = await _try_chat(
        messages,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        # extract=False: the answer-extraction heuristics are tuned for chat
        # prose and would mangle a markup document.
        extract=False,
    )

    content, warnings = clean_output(result.get("content", ""), content_type)
    if not content.strip():
        raise ValueError("The model returned an empty document. Try rephrasing the prompt.")

    if content_type == "html":
        # Better to refuse than to hand back markup that publishes as a blank page.
        reason = find_truncation(content)
        if reason:
            raise ValueError(
                f"The generated page is incomplete — {reason}. "
                "Ask for a simpler page, or describe one section at a time and "
                "build it up with follow-up prompts."
            )

    return {
        "content": content,
        "model": result.get("model", ""),
        "model_short": result.get("model_short", ""),
        "warnings": warnings,
    }
