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

import json
import re
from typing import Any, AsyncIterator

from . import page_design, page_edit
from .openrouter import (
    _try_chat,
    _stream_post_with_retries,
    _make_headers,
    _ordered_models,
    _short,
    OPENROUTER_API_URL,
)

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

MODERN DESIGN SYSTEM — use these CSS tokens as the foundation:
- Define a :root {} block with custom properties for colours, spacing and
  typography so the whole page's look can change by editing one block.
- Fluid typography: use `clamp(1rem, 2.5vw, 1.25rem)` for body text and
  `clamp(1.75rem, 5vw, 3rem)` for headings — never fixed pixel font sizes.
- Glassmorphism when requested: `background:rgba(255,255,255,.06);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.1);border-radius:1rem`.
- Spacing scale: multiples of 0.25rem (--sp-1:0.25rem through --sp-16:4rem).
- Shadows: `--shadow-sm:0 1px 2px rgba(0,0,0,.05);
  --shadow-md:0 4px 12px rgba(0,0,0,.08);
  --shadow-lg:0 10px 32px rgba(0,0,0,.12)`.
- Transitions: `transition:all .25s cubic-bezier(.4,0,.2,1)`.
- Prefer CSS Grid with `auto-fill, minmax(min(100%, 18rem), 1fr)` for card
  layouts, and `gap` instead of margins between siblings.
- Interactive states: every button and link must have :hover and :focus-visible
  styles. Add `outline:2px solid var(--clr-accent);outline-offset:2px` on
  focus-visible.

REAL MEDIA & ASSETS — ALWAYS supply real, working, high-resolution media assets. NEVER use empty gray boxes, plain text placeholders (e.g. <div>Leadership</div>), or broken placeholder services:
- Real Photography (Unsplash CDN): Use valid Unsplash images with `auto=format&fit=crop&q=80`:
  * Hero / Covers:
    - Business / Leadership / Strategy: `https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1400&q=80`
    - Courses / Education / Workshops: `https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1400&q=80`
    - Tech / Coding / Engineering: `https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1400&q=80`
    - Modern Architecture / Offices: `https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80`
    - Finance / Analytics / Data: `https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1400&q=80`
  * Topic / Course / Card Thumbnails:
    - Leadership / Management: `https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=800&q=80`
    - Strategic Planning / Growth: `https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80`
    - Software Development / AI: `https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=800&q=80`
    - Data Science / Graphs: `https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80`
    - Finance & Accounting: `https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80`
    - UX / Design / Creative: `https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=800&q=80`
    - Public Speaking / Workshop: `https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=800&q=80`
  * Avatars / Headshots:
    - `https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&h=200&q=80`
    - `https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&h=200&q=80`
    - `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80`
    - `https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&h=200&q=80`
    - `https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&h=200&q=80`
- Icons: Use Lucide Icons by adding `<script src="https://unpkg.com/lucide@latest"></script>` and rendering icons with `<i data-lucide="book-open"></i>`, `<i data-lucide="trending-up"></i>`, `<i data-lucide="users"></i>`, `<i data-lucide="award"></i>`, `<i data-lucide="star"></i>`, `<i data-lucide="play"></i>`, `<i data-lucide="check"></i>`, etc., followed by `<script>lucide.createIcons();</script>` before </body>. Or use inline colored SVGs.
- Videos: Use responsive HTML5 video `<video controls autoplay loop muted playsinline poster="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80" style="width:100%;border-radius:1rem;aspect-ratio:16/9;object-fit:cover"><source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" type="video/mp4"></video>` or responsive YouTube embed iframe.
- Always include `loading="lazy"`, `decoding="async"`, `alt="..."`, and responsive styles (`max-width:100%;border-radius:...;object-fit:cover`) on images.

SECTION TAGGING — every top-level container/section in <body> MUST carry
`data-agent-section="<short-id>"` where <short-id> is a lowercase kebab-case
identifier describing the section, e.g. "hero", "features", "pricing", "cta",
"testimonials", "footer". These tags enable the editor to target individual
sections for surgical editing without regenerating the whole page.

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
  - NEVER use width: min-content or max-width: min-content on a section, card
    or block of text. It sizes the box to its narrowest possible width, so a
    paragraph collapses into a one-word-per-line column. To constrain reading
    width use max-width with a ch or rem value plus margin-inline: auto.
  - A full-width section stays at its default block width. Centre its contents
    with an inner wrapper that has max-width and margin-inline: auto — never by
    shrinking the section itself.
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


def _rules_for(content_type: str, brief: str = "", style: str | None = None) -> str:
    """
    The system prompt, with a design direction appended for HTML.

    The direction goes last on purpose. A weak model follows the end of a long
    prompt more reliably than the middle, and the visual identity is the part
    that decides whether the page looks designed or generated.
    """
    base = _rules_for_base(content_type)
    if content_type != "html":
        return base
    direction = page_design.pick(brief, style)
    return f"{base}\n\n{page_design.scaffold(direction)}"


def _rules_for_base(content_type: str) -> str:
    return _MARKDOWN_RULES if content_type == "markdown" else _HTML_RULES


# --- asset enrichment & placeholder sanitizer -----------------------------

_TOPIC_ASSETS = {
    "leadership": "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1000&q=80",
    "management": "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1000&q=80",
    "business": "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=80",
    "strategy": "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1000&q=80",
    "tech": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1000&q=80",
    "code": "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1000&q=80",
    "software": "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1000&q=80",
    "data": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1000&q=80",
    "finance": "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1000&q=80",
    "course": "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1000&q=80",
    "education": "https://images.unsplash.com/photo-1501504905252-473c47e087f8?auto=format&fit=crop&w=1000&q=80",
    "learning": "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1000&q=80",
    "design": "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=1000&q=80",
    "creative": "https://images.unsplash.com/photo-1542744094-3a31f272c490?auto=format&fit=crop&w=1000&q=80",
    "marketing": "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1000&q=80",
    "hero": "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1400&q=80",
    "workspace": "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80",
    "team": "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80",
    "default": "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80",
}

_DUMMY_URL_RE = re.compile(
    r'https?://(?:via\.placeholder\.com|placehold\.co|dummyimage\.com|placeholder\.com)[^"\'\s>]*',
    re.IGNORECASE,
)

# Detects empty gray container placeholders with bare text (like <div ...>Leadership</div>)
_EMPTY_BOX_RE = re.compile(
    r'<div([^>]*\b(?:class|style)\s*=\s*["\'][^"\']*(?:thumbnail|placeholder|course-image|hero-image|card-img|bg-[a-z]+|background:\s*#[0-9a-fA-F]{3,6})[^"\']*["\'][^>]*)>\s*([a-zA-Z0-9\s\-&]{1,40})\s*</div>',
    re.IGNORECASE,
)


def _resolve_topic_image(hint: str) -> str:
    """Match a text hint to a high-quality topical Unsplash image URL."""
    low = hint.lower()
    for key, url in _TOPIC_ASSETS.items():
        if key in low:
            return url
    return _TOPIC_ASSETS["default"]


def enrich_page_assets(html: str) -> str:
    """
    Sanitize dummy placeholders and inject real high-resolution media assets.
    """
    if not html:
        return html

    out = html

    # 1. Replace placeholder service URLs with real Unsplash images
    def _replace_placeholder_url(m):
        raw_url = m.group(0)
        return _resolve_topic_image(raw_url)

    out = _DUMMY_URL_RE.sub(_replace_placeholder_url, out)

    # 2. Upgrade empty text-in-box placeholder divs into rich responsive image cards
    def _upgrade_empty_box(m):
        attrs = m.group(1)
        text_label = m.group(2).strip()
        img_url = _resolve_topic_image(text_label)
        # Wrap image with responsive container
        return (
            f'<div{attrs} style="position:relative;overflow:hidden;min-height:220px;border-radius:inherit;">'
            f'<img src="{img_url}" alt="{text_label}" '
            f'style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;" '
            f'loading="lazy" decoding="async" />'
            f'</div>'
        )

    out = _EMPTY_BOX_RE.sub(_upgrade_empty_box, out)

    # 3. If Lucide icons are used, ensure Lucide script is loaded
    if 'data-lucide=' in out and 'unpkg.com/lucide' not in out:
        lucide_script = (
            '<script src="https://unpkg.com/lucide@latest"></script>'
            '<script>window.addEventListener("DOMContentLoaded",function(){if(window.lucide)lucide.createIcons();});'
            'if(window.lucide)lucide.createIcons();</script>'
        )
        if '</body>' in out:
            out = out.replace('</body>', f'{lucide_script}</body>', 1)
        else:
            out += lucide_script

    return out


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


# `width: min-content` on a text container sizes it to the narrowest possible
# box — measured at 69px for a paragraph that should have been 512px. The viewer
# resets `overflow-wrap: break-word`, so the text then breaks mid-word to fit,
# and the result reads as a deliberate one-word-per-line column rather than as
# the layout failure it is. Models reach for it when asked to make a page
# "responsive"; it is almost never what a block of prose wants.
_MIN_CONTENT_WIDTH = re.compile(
    r"(?<![\w-])(max-width|width)\s*:\s*min-content\s*(?=[;}])", re.IGNORECASE
)


def repair_layout_collapse(html: str) -> tuple[str, int]:
    """
    Neutralise width declarations that collapse a container to nothing.

    Generated output is ours to clean — the same licence under which fences are
    stripped and truncation is caught. `width` becomes `auto` and `max-width`
    becomes `100%`, both of which are what the rule was reaching for. Only
    min-content is touched: `fit-content` is a legitimate way to shrink a button
    to its label, and rewriting it would break working pages.
    """
    def swap(match: re.Match) -> str:
        prop = match.group(1).lower()
        return "max-width: 100%" if prop == "max-width" else "width: auto"

    repaired, count = _MIN_CONTENT_WIDTH.subn(swap, html)
    return repaired, count


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

    # Enrich assets: sanitize placeholder boxes/URLs and ensure real imagery/icons
    text = enrich_page_assets(text)

    text, collapsed = repair_layout_collapse(text)
    warnings = find_fragile_patterns(text)
    if collapsed:
        warnings.append(
            f"{collapsed} width:min-content rule(s) that would have collapsed the "
            "layout — replaced with a full-width equivalent"
        )
    return text, warnings


# --- entry point -----------------------------------------------------------

async def generate_page(
    prompt: str,
    content_type: str = "html",
    existing: str | None = None,
    style: str | None = None,
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

    messages = [{"role": "system", "content": _rules_for(content_type, prompt, style)}]

    if existing and existing.strip():
        # Revising: the document already has a visual identity, and issuing a
        # fresh direction here is how "make the hero darker" comes back as a
        # different site altogether.
        messages[0]["content"] = _rules_for_base(content_type)
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


# --- agentic interview engine -----------------------------------------------

_INTERVIEW_SYSTEM = """You are an intelligent design and document architect. \
The user wants to generate a document or web page from a prompt. \
Analyse their prompt and decide whether it is specific and unambiguous enough to generate immediately, \
or whether it would benefit from 2-3 tailored clarifying questions to produce an outstanding result.

A prompt is SPECIFIC ENOUGH when it already clearly specifies:
1. The exact subject and purpose.
2. The desired tone, layout, or visual styling.
3. The specific sections, components, or content blocks.
If it is already specific and comprehensive, return:
{"needs_interview": false}

If the prompt is brief, open-ended, or ambiguous, generate 2-3 focused questions tailored \
specifically to what the user asked for. Return a JSON object:
{"needs_interview": true, "questions": [...]}

Each question object MUST have:
- "id": a short lowercase kebab-case identifier (e.g. "theme", "layout", "widgets", "tone", "sections")
- "text": a concise, friendly question string
- "type": "single" (for mutually exclusive choices) or "multi" (for multiple selectable items)
- "options": an array of 3-5 high-quality, domain-relevant options

Return ONLY the JSON object. No commentary, no markdown fences."""

_INTERVIEW_EXAMPLES = [
    {
        "prompt": "make me a landing page",
        "response": json.dumps({
            "needs_interview": True,
            "questions": [
                {
                    "id": "theme",
                    "text": "What visual style should the page have?",
                    "type": "single",
                    "options": [
                        "Dark glassmorphic with neon accents",
                        "Clean and modern with soft whites",
                        "Warm editorial with serif typography",
                        "Bold and vibrant with gradients",
                    ],
                },
                {
                    "id": "sections",
                    "text": "Which sections should the page include?",
                    "type": "multi",
                    "options": [
                        "Hero banner with headline",
                        "Features or services grid",
                        "Pricing cards",
                        "Testimonials carousel",
                        "Contact form",
                    ],
                },
            ],
        }),
    },
]


async def analyze_prompt_needs(
    prompt: str,
    content_type: str = "html",
) -> dict:
    """
    Analyse whether a prompt needs clarification before generation.

    Returns {"needs_interview": bool, "questions": [...]} where each question
    has id, text, type ("single"|"multi"), and options.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required.")
    if content_type not in ("html", "markdown"):
        raise ValueError("AI generation supports the Web Page and Document types.")

    # Build few-shot examples into the message list
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _INTERVIEW_SYSTEM},
    ]
    for ex in _INTERVIEW_EXAMPLES:
        messages.append({"role": "user", "content": ex["prompt"]})
        messages.append({"role": "assistant", "content": ex["response"]})

    messages.append({"role": "user", "content": f"Format: {content_type.upper()}\nPrompt: {prompt}"})

    result = await _try_chat(
        messages,
        max_tokens=800,
        temperature=0.3,
        extract=False,
    )

    raw = result.get("content", "").strip()

    # Parse JSON — strip markdown fences if present
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", raw)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # If parsing fails, default to no interview needed
        return {"needs_interview": False, "questions": []}

    if not isinstance(parsed, dict):
        return {"needs_interview": False, "questions": []}

    questions = normalise_questions(parsed.get("questions"))
    return {
        # No usable questions means no interview, whatever the model claimed.
        # Opening a question step with nothing to answer is a dead end.
        "needs_interview": bool(parsed.get("needs_interview", False)) and bool(questions),
        "questions": questions,
    }


# Interview questions go straight into a React component that maps over them and
# over each one's options. Anything malformed therefore crashes the editor
# rather than degrading — which is exactly what happened: a model returned
# `"questions": "none needed"`, a string passed the client's `?.length` check
# because strings have a length, and the card then iterated characters and read
# `.options` off one.
MAX_INTERVIEW_QUESTIONS = 4
MAX_INTERVIEW_OPTIONS = 6


def normalise_questions(raw) -> list[dict]:
    """
    Coerce model output into questions the UI can render, dropping the rest.

    Free models are the only source here and they are inconsistent about shape,
    so this validates rather than trusts. A question that cannot be rendered is
    discarded rather than repaired: a guessed option list would put words in the
    user's mouth and steer the page they get.
    """
    if not isinstance(raw, list):
        return []

    out: list[dict] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue

        # Options are sometimes handed back as a comma-separated string.
        raw_options = item.get("options")
        if isinstance(raw_options, str):
            raw_options = [part.strip() for part in raw_options.split(",")]
        if not isinstance(raw_options, list):
            continue
        options = [str(o).strip() for o in raw_options if str(o).strip()]
        if len(options) < 2:
            # One option is not a choice, and none is not a question.
            continue

        qid = str(item.get("id") or "").strip() or f"q{index + 1}"
        qtype = str(item.get("type") or "single").strip().lower()
        out.append({
            "id": qid[:40],
            "text": text[:300],
            "type": qtype if qtype in ("single", "multi") else "single",
            "options": options[:MAX_INTERVIEW_OPTIONS],
        })
        if len(out) >= MAX_INTERVIEW_QUESTIONS:
            break
    return out


# --- SSE streaming page generator -------------------------------------------

# Tag-agnostic regex to extract data-agent-section identifiers
_SECTION_TAG = re.compile(
    r'<[a-zA-Z0-9]+\b[^>]*\bdata-agent-section\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)


async def stream_generate_page(
    prompt: str,
    content_type: str = "html",
    existing: str | None = None,
    clarifications: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Stream page generation as SSE frames.

    Yields dicts:
      {"type": "thought", "text": "..."} — architectural reasoning
      {"type": "plan", "sections": [...]} — section blueprint
      {"type": "delta", "delta": "..."}  — streamed code tokens
      {"type": "done", "content": "...", "model": "...", "warnings": [...]}
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A prompt is required.")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError(f"Prompt is too long (max {MAX_PROMPT_CHARS} characters).")
    if content_type not in ("html", "markdown"):
        raise ValueError("AI generation supports the Web Page and Document types.")

    # Build the enriched prompt with clarification context
    user_content = prompt
    if clarifications:
        extras = "\n".join(
            f"- {k}: {v}" for k, v in clarifications.items() if v
        )
        if extras:
            user_content = f"{prompt}\n\nDesign preferences:\n{extras}"

    # Revising is a different job from generating, and asking for the whole
    # document back is what made it slow, lossy and prone to truncation. A
    # revision returns search/replace blocks instead — see services/page_edit.py.
    revising = bool(existing and existing.strip())
    base = existing.strip() if revising else ""
    if revising and len(base) > MAX_EXISTING_CHARS:
        raise ValueError(
            "This page is too large to revise with AI. Trim it, or generate a fresh page."
        )

    if revising:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": page_edit.EDIT_RULES},
            {"role": "user", "content": page_edit.revision_context(base, user_content)},
        ]
    else:
        messages = [
            {"role": "system", "content": _rules_for(content_type, prompt)},
            {"role": "user", "content": user_content},
        ]

    # Emit a synthetic thought frame before streaming starts
    yield {
        "type": "thought",
        "text": (f"Editing the page: {prompt[:100]}" if revising
                 else f"Designing {content_type} page: {prompt[:100]}"),
        "mode": "edit" if revising else "create",
    }

    errors: list[str] = []

    for spec in _ordered_models():
        resp = None
        try:
            payload: dict[str, Any] = {
                "model": spec.id,
                "messages": messages,
                "max_tokens": MAX_TOKENS,
                "temperature": TEMPERATURE,
                "stream": True,
            }
            if spec.supports_reasoning_param:
                payload["reasoning"] = {"exclude": True}

            resp = await _stream_post_with_retries(payload)

            if resp.status_code == 401:
                raise ValueError("Invalid OPENROUTER_API_KEY — check your HF Space secrets")
            if resp.status_code == 402:
                raise ValueError("OpenRouter quota exceeded — check free-tier limits")
            if resp.status_code >= 400:
                body = await resp.aread()
                text = body.decode("utf-8", errors="ignore")[:200]
                if resp.status_code in (400, 404, 422, 429) or "model" in text.lower():
                    errors.append(f"{_short(spec.id)}: {text or ('HTTP ' + str(resp.status_code))}")
                    await resp.aclose()
                    continue
                raise ValueError(f"OpenRouter error ({resp.status_code}): {text}")

            full_raw = ""
            plan_emitted = False

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk_data = json.loads(data)
                except json.JSONDecodeError:
                    continue

                delta = (
                    chunk_data.get("choices", [{}])[0]
                    .get("delta", {})
                    .get("content", "")
                ) or ""
                if not delta:
                    continue

                full_raw += delta
                yield {"type": "delta", "delta": delta}

                # Emit a plan frame once we've seen enough sections
                if not plan_emitted and content_type == "html":
                    sections = _SECTION_TAG.findall(full_raw)
                    if len(sections) >= 2:
                        yield {"type": "plan", "sections": sections}
                        plan_emitted = True

            await resp.aclose()

            if revising:
                # The response is a set of edits, not a document. Applying them
                # here means everything the request did not mention survives
                # byte for byte, which is the whole reason for the format.
                blocks = page_edit.parse_edit_blocks(full_raw)
                if not blocks:
                    errors.append(f"{_short(spec.id)}: returned no usable edits")
                    continue
                try:
                    result = page_edit.apply_edit_blocks(base, blocks)
                except page_edit.EditError as exc:
                    errors.append(f"{_short(spec.id)}: {exc}")
                    continue

                content, warnings = clean_output(result["content"], content_type)
                for detail in result["details"]:
                    yield {"type": "edit", **detail}
                if result["failed"]:
                    warnings.append(
                        f"{result['failed']} of {len(blocks)} edits did not match the "
                        "current page and were skipped"
                    )
                yield {
                    "type": "done",
                    "content": content,
                    "model": spec.id,
                    "model_short": _short(spec.id),
                    "warnings": warnings,
                    "edits_applied": result["applied"],
                }
                return

            # Clean the final output using existing infrastructure
            content, warnings = clean_output(full_raw, content_type)
            if not content.strip():
                errors.append(f"{_short(spec.id)}: response had no usable content")
                continue

            if content_type == "html":
                reason = find_truncation(content)
                if reason:
                    warnings.append(f"Page may be incomplete: {reason}")

            # Emit any remaining plan sections discovered at the end
            if not plan_emitted and content_type == "html":
                sections = _SECTION_TAG.findall(content)
                if sections:
                    yield {"type": "plan", "sections": sections}

            yield {
                "type": "done",
                "content": content,
                "model": spec.id,
                "model_short": _short(spec.id),
                "warnings": warnings,
            }
            return

        except (Exception,) as exc:
            if resp is not None:
                try:
                    await resp.aclose()
                except Exception:
                    pass
            if isinstance(exc, ValueError):
                raise
            errors.append(f"{_short(spec.id)}: {str(exc)[:100]}")
            continue

    raise ValueError(
        ("All AI models are unavailable right now. Tried: " + "; ".join(errors))
        if errors else "No models configured."
    )


# --- surgical section editor ------------------------------------------------

_SECTION_EXTRACT = re.compile(
    r'(<section[^>]*\bdata-agent-section\s*=\s*["\']%s["\'][^>]*>)(.*?)(</section>)',
    re.DOTALL | re.IGNORECASE,
)

_SECTION_EDIT_SYSTEM = """You are a surgical HTML component editor. You will receive:
1. The FULL HTML of a complete page (for context only).
2. The EXACT container component/section to edit (identified by data-agent-section attribute).
3. The user's change request.

Return ONLY the revised container element block — complete with its opening and closing
tags and the same data-agent-section attribute. Do NOT return the whole page, do NOT wrap
in markdown fences, do NOT add commentary.

Preserve everything the user did not ask you to change — content, structure, styling, and
classes. Match the existing code style exactly."""


async def edit_page_section(
    full_html: str,
    section_id: str,
    prompt: str,
) -> dict:
    """
    Edit a single element with data-agent-section="..." without touching the rest.

    Returns {"content": full_html_with_patch, "model_short": str, "warnings": [...]}.
    """
    if not full_html or not full_html.strip():
        raise ValueError("No page content to edit.")
    if not section_id:
        raise ValueError("section_id is required.")
    if not (prompt or "").strip():
        raise ValueError("A prompt describing the change is required.")

    # Tag-agnostic pattern matching opening tag, content, and matching closing tag
    pattern = re.compile(
        rf'(<([a-zA-Z0-9]+)[^>]*\bdata-agent-section\s*=\s*["\']'
        + re.escape(section_id)
        + rf'["\'][^>]*>)(.*?)(</\2>)',
        re.DOTALL | re.IGNORECASE,
    )
    match = pattern.search(full_html)
    if not match:
        raise ValueError(
            f'Section "{section_id}" not found in the document. '
            f'Available sections: {", ".join(_SECTION_TAG.findall(full_html)) or "none"}.'
        )

    section_html = match.group(0)

    messages = [
        {"role": "system", "content": _SECTION_EDIT_SYSTEM},
        {
            "role": "system",
            "content": (
                "--- FULL PAGE (context only, do NOT return the whole page) ---\n"
                f"{full_html}\n--- END ---"
            ),
        },
        {
            "role": "user",
            "content": (
                f'Edit the element with data-agent-section="{section_id}":\n\n'
                f"--- CURRENT COMPONENT ---\n{section_html}\n--- END ---\n\n"
                f"Change: {prompt}"
            ),
        },
    ]

    result = await _try_chat(
        messages,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        extract=False,
    )

    new_section = (result.get("content", "")).strip()

    # Clean markdown fences
    new_section = re.sub(r"^```(?:html)?\s*\n?", "", new_section)
    new_section = re.sub(r"\n?```\s*$", "", new_section).strip()

    if not new_section:
        raise ValueError("The model returned an empty component. Try rephrasing.")

    # Verify the returned content is actually an HTML element block
    if not re.match(r"^\s*<[a-zA-Z0-9]+", new_section, re.IGNORECASE):
        raise ValueError("The model did not return a valid element block.")

    # Patch the section back into the full HTML
    patched = full_html[:match.start()] + new_section + full_html[match.end():]

    return {
        "content": patched,
        "model_short": result.get("model_short", ""),
        "warnings": find_fragile_patterns(patched),
    }


# --- script error self-healing -----------------------------------------------

_FIX_ERROR_SYSTEM = """You are a JavaScript debugger for web pages. You receive:
1. The complete HTML document.
2. Runtime error details (message, line, column, stack).

Identify the failing code and return the COMPLETE corrected document. Fix ONLY
the specific error — do not rewrite working code or change styling. If the fix
requires adding null-checks or try/catch guards, do so minimally.

Return only the corrected HTML document. No commentary, no markdown fences."""


async def fix_page_script_error(
    full_html: str,
    error_details: dict,
) -> dict:
    """
    Attempt to fix a runtime JavaScript error in a generated page.

    error_details should contain: message, lineno, colno, stack (all optional
    except message).

    Returns {"content": fixed_html, "model_short": str, "warnings": [...]}.
    """
    if not full_html or not full_html.strip():
        raise ValueError("No page content to fix.")
    if not error_details or not error_details.get("message"):
        raise ValueError("Error details with at least a message are required.")

    error_desc = f"Error: {error_details['message']}"
    if error_details.get("lineno"):
        error_desc += f" (line {error_details['lineno']}"
        if error_details.get("colno"):
            error_desc += f", col {error_details['colno']}"
        error_desc += ")"
    if error_details.get("stack"):
        error_desc += f"\nStack: {error_details['stack'][:500]}"

    messages = [
        {"role": "system", "content": _FIX_ERROR_SYSTEM},
        {
            "role": "user",
            "content": (
                f"--- HTML DOCUMENT ---\n{full_html}\n--- END ---\n\n"
                f"--- RUNTIME ERROR ---\n{error_desc}\n--- END ---\n\n"
                "Fix this error and return the corrected document."
            ),
        },
    ]

    result = await _try_chat(
        messages,
        max_tokens=MAX_TOKENS,
        temperature=0.2,  # Low temperature for precise fixes
        extract=False,
    )

    content, warnings = clean_output(result.get("content", ""), "html")
    if not content.strip():
        raise ValueError("The model returned an empty fix. Try again.")

    reason = find_truncation(content)
    if reason:
        raise ValueError(
            f"The fixed page is incomplete — {reason}. "
            "The error may be too complex to auto-fix."
        )

    return {
        "content": content,
        "model_short": result.get("model_short", ""),
        "warnings": warnings,
    }

