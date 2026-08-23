"""
Design directions for generated pages.

Why a registry instead of asking for "a beautiful, modern page"
──────────────────────────────────────────────────────────────
Every model in the cascade is on a free tier, and a weak model given an
open-ended aesthetic brief produces the same page every time: Inter, a
purple-to-blue gradient hero, rounded cards with an accent rail, everything
centred. That is not a prompt-wording problem — it is what "make it look good"
regresses to when the model has no specific ground to stand on.

So the model is not asked to invent a visual identity. It is handed one: a
complete token block with real typefaces, a real palette for both themes, and a
spacing and radius scale, and asked to build the page with those tokens. It
spends its capability on structure and copy, which it is good at, instead of on
taste, which it is not.

Each direction below is a deliberate pairing rather than a theme name. The
palettes avoid the cluster of looks that generated pages default to, and every
one carries a dark variant, because the viewer's theme is not ours to choose.
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Direction:
    key: str
    label: str
    summary: str          # shown to the author in the picker
    fonts_href: str       # Google Fonts, which the renderer's CSP allows
    tokens: str           # the :root block the model must build against
    notes: str            # layout character, in the model's terms


_BASE_SCALE = """
  --sp-1:.25rem; --sp-2:.5rem; --sp-3:.75rem; --sp-4:1rem; --sp-6:1.5rem;
  --sp-8:2rem; --sp-12:3rem; --sp-16:4rem; --sp-24:6rem;
  --measure:68ch;"""


DIRECTIONS: list[Direction] = [
    Direction(
        key="editorial",
        label="Editorial",
        summary="Magazine feel — a high-contrast serif headline against clean sans copy.",
        fonts_href=("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700"
                    "&family=Inter+Tight:wght@400;500;600&display=swap"),
        tokens=f"""
  --font-display:'Fraunces',Georgia,'Times New Roman',serif;
  --font-body:'Inter Tight',system-ui,-apple-system,sans-serif;
  --ground:#fbfaf7; --surface:#ffffff; --ink:#1a1714; --ink-2:#554d45;
  --muted:#8a7f74; --rule:#e6e0d8; --accent:#9a3412; --accent-ink:#ffffff;
  --radius:.5rem; --shadow:0 1px 2px rgba(26,23,20,.06),0 8px 24px rgba(26,23,20,.06);{_BASE_SCALE}""",
        notes=("Generous line height, wide margins, a rule under each section heading. "
               "Headlines large and tightly tracked; body text never wider than --measure."),
    ),
    Direction(
        key="technical",
        label="Technical",
        summary="Precise and data-forward — monospace accents, tight grid, restrained colour.",
        fonts_href=("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700"
                    "&family=IBM+Plex+Mono:wght@400;500&display=swap"),
        tokens=f"""
  --font-display:'IBM Plex Sans',system-ui,sans-serif;
  --font-body:'IBM Plex Sans',system-ui,sans-serif;
  --font-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
  --ground:#f4f6f8; --surface:#ffffff; --ink:#10151c; --ink-2:#39434f;
  --muted:#69737f; --rule:#dde3ea; --accent:#0f766e; --accent-ink:#ffffff;
  --radius:.25rem; --shadow:0 1px 2px rgba(16,21,28,.06);{_BASE_SCALE}""",
        notes=("Small uppercase labels in mono with letter-spacing. Hairline rules, "
               "tabular figures for any number, tight consistent gaps. Minimal shadow."),
    ),
    Direction(
        key="warm",
        label="Warm minimal",
        summary="Calm and roomy — soft neutrals, one muted accent, lots of air.",
        fonts_href=("https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700"
                    "&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"),
        tokens=f"""
  --font-display:'Outfit',system-ui,sans-serif;
  --font-body:'Source Serif 4',Georgia,serif;
  --ground:#f7f5f2; --surface:#ffffff; --ink:#232020; --ink-2:#4f4846;
  --muted:#857c78; --rule:#e8e3dd; --accent:#4a6741; --accent-ink:#ffffff;
  --radius:1rem; --shadow:0 2px 4px rgba(35,32,32,.04),0 12px 32px rgba(35,32,32,.06);{_BASE_SCALE}""",
        notes=("Large padding, soft radii, plenty of vertical rhythm between sections. "
               "Serif body at a comfortable size; the accent appears rarely and deliberately."),
    ),
    Direction(
        key="nightfall",
        label="Nightfall",
        summary="Dark by design — deep ground, luminous accent, high contrast type.",
        fonts_href=("https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700"
                    "&family=Inter:wght@400;500;600&display=swap"),
        tokens=f"""
  --font-display:'Sora',system-ui,sans-serif;
  --font-body:'Inter',system-ui,-apple-system,sans-serif;
  --ground:#0b0f14; --surface:#141a22; --ink:#e8edf3; --ink-2:#aab6c4;
  --muted:#7b8797; --rule:#232c38; --accent:#5eead4; --accent-ink:#062024;
  --radius:.75rem; --shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.35);{_BASE_SCALE}""",
        notes=("Committed dark page — do not emit a light variant for this one. "
               "Accent used for one element per section at most, never for body text."),
    ),
    Direction(
        key="press",
        label="Press",
        summary="Bold and structural — heavy grotesque, flat blocks, strong dividers.",
        fonts_href=("https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800"
                    "&family=Archivo:wght@400;500&display=swap"),
        tokens=f"""
  --font-display:'Archivo',Helvetica,Arial,sans-serif;
  --font-body:'Archivo',Helvetica,Arial,sans-serif;
  --ground:#ffffff; --surface:#f2f2f0; --ink:#111111; --ink-2:#3d3d3d;
  --muted:#6e6e6e; --rule:#111111; --accent:#1d4ed8; --accent-ink:#ffffff;
  --radius:0; --shadow:none;{_BASE_SCALE}""",
        notes=("Square corners, 2px black rules, flat colour blocks and no shadows. "
               "Very large tightly-tracked headlines; the structure is the decoration."),
    ),
]

BY_KEY = {d.key: d for d in DIRECTIONS}

# Keywords that make a direction the obvious choice for a given brief. Matched
# before falling back to a rotation, so "a dark developer portfolio" reliably
# gets the dark direction rather than a coin toss.
_HINTS: dict[str, tuple[str, ...]] = {
    "nightfall": ("dark", "night", "neon", "developer", "saas", "crypto", "gaming"),
    "technical": ("technical", "data", "dashboard", "api", "engineering", "analytics",
                  "documentation", "report", "finance"),
    "editorial": ("editorial", "magazine", "blog", "article", "story", "journal", "essay"),
    "warm":      ("wellness", "coach", "consultant", "therapy", "studio", "craft",
                  "organic", "calm", "minimal"),
    "press":     ("bold", "agency", "portfolio", "brutal", "poster", "launch", "event"),
}


def pick(brief: str, requested: str | None = None) -> Direction:
    """
    Choose a direction for this page.

    An explicit choice always wins — the author asked. Otherwise the brief is
    matched on keywords, and anything unmatched is rotated at random rather than
    defaulted, so a person generating several pages does not receive five
    variations of the same look.
    """
    if requested and requested in BY_KEY:
        return BY_KEY[requested]

    text = (brief or "").lower()
    best: tuple[int, str] | None = None
    for key, words in _HINTS.items():
        score = sum(1 for w in words if w in text)
        if score and (best is None or score > best[0]):
            best = (score, key)
    if best:
        return BY_KEY[best[1]]
    return random.choice(DIRECTIONS)


def scaffold(direction: Direction) -> str:
    """The block of prompt that hands the model its visual identity."""
    return f"""DESIGN DIRECTION — "{direction.label}". Build the page with these tokens.
Do not invent a different palette or different typefaces.

Put this in <head>:
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{direction.fonts_href}">

Start the stylesheet with exactly this token block, then style everything with
var(--token) — never a raw hex value in a rule:

:root {{{direction.tokens}
}}

body {{ background:var(--ground); color:var(--ink); font-family:var(--font-body); }}

Character: {direction.notes}"""


def catalogue() -> list[dict]:
    """The directions, for the editor's picker."""
    return [{"key": d.key, "label": d.label, "summary": d.summary} for d in DIRECTIONS]
