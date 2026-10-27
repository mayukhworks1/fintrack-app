"""
The design system every generated artifact is built on.

A one-line instruction such as "make it look modern" produces the same bare
page every time: the system font, a default blue button, a flat list whose
checkboxes sit a few pixels off their labels. Models are good at structure and
behaviour and poor at inventing taste, so the brief does not ask them to invent
any. It hands over a finished kit instead — tokens for both themes, a typeface,
and styled components with the alignment already solved — and asks the model
to build the app out of it.

Three pieces live here:

  * BASE_CSS — the stylesheet the artifact starts from. Its class names are the
    vocabulary the brief's component rules refer to. The built-in templates in
    the frontend (components/artifacts/templates/*.html) are written on the
    same kit, so a template and a generated app look like they belong together.
  * ICON_SPRITE — a small Lucide-style icon set as <symbol>s, copied in as needed.
  * DIRECTIONS — four looks (clean, warm, pro, playful) that re-tune the kit's
    tokens and typefaces per prompt, so every app is not the same indigo.
"""

from __future__ import annotations

from dataclasses import dataclass

FONT_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{families}&display=swap">'
)

INTER = "family=Inter:wght@400;500;600;700"

BASE_CSS = """:root{
  color-scheme:light dark;
  --font-body:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --font-display:var(--font-body);
  --font-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  --bg:#f6f7f9;--surface:#fff;--surface-2:#f1f3f6;--raised:#fff;
  --border:#e3e6eb;--border-strong:#cfd4dc;
  --text:#14161a;--text-2:#4b5260;--text-3:#737a89;
  --accent:#4f46e5;--accent-hover:#4338ca;--accent-soft:#eef0ff;--accent-text:#4338ca;--on-accent:#fff;
  --success:#15803d;--success-soft:#eafbf0;--warning:#b45309;--warning-soft:#fff6e5;
  --danger:#d92d20;--danger-soft:#fef1f0;
  --r-sm:7px;--r:10px;--r-lg:14px;--r-full:999px;
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--s6:24px;--s8:32px;--s10:40px;
  --shadow-sm:0 1px 2px rgb(16 24 40/.06);
  --shadow:0 1px 2px rgb(16 24 40/.04),0 2px 10px rgb(16 24 40/.05);
  --shadow-lg:0 18px 40px -12px rgb(16 24 40/.25);
  --ring:0 0 0 3px color-mix(in srgb,var(--accent) 26%,transparent);
  --ease:cubic-bezier(.2,.8,.2,1);
  --app-w:760px;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0c0d10;--surface:#15171c;--surface-2:#1c1f26;--raised:#272b35;
  --border:#262a33;--border-strong:#373c48;
  --text:#eceef2;--text-2:#a9afbc;--text-3:#808797;
  --accent:#818cf8;--accent-hover:#a5b4fc;--accent-soft:#1f2040;--accent-text:#b4bcff;--on-accent:#0b0c1a;
  --success:#4ade80;--success-soft:#0f2a1b;--warning:#fbbf24;--warning-soft:#2b2210;
  --danger:#f87171;--danger-soft:#2e1515;
  --shadow-sm:0 1px 2px rgb(0 0 0/.4);
  --shadow:0 1px 2px rgb(0 0 0/.45);
  --shadow-lg:0 20px 48px -12px rgb(0 0 0/.75);
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:400 15px/1.55 var(--font-body);-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;font-family:var(--font-display);line-height:1.25;letter-spacing:-.015em}
h1{font-size:clamp(1.4rem,3.4vw,1.8rem);font-weight:700;letter-spacing:-.025em}
h2{font-size:1.0625rem;font-weight:600}
h3{font-size:.9375rem;font-weight:600}
p{margin:0}
[hidden]{display:none!important}
button,input,select,textarea{font:inherit;color:inherit}
:where(button,a,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.icon{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.icon-sm{width:15px;height:15px}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-2)}.subtle{color:var(--text-3)}.small{font-size:.8125rem}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.app{max-width:var(--app-w);margin-inline:auto;padding:clamp(20px,5vw,48px) clamp(16px,4vw,32px) 72px}
.app-header{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;margin-bottom:var(--s6)}
.subtitle{margin-top:6px;color:var(--text-2);font-size:.9375rem}
.stack{display:flex;flex-direction:column;gap:var(--gap,var(--s4))}
.cluster{display:flex;flex-wrap:wrap;align-items:center;gap:var(--gap,var(--s2))}
.grid{display:grid;gap:var(--s4);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--min,260px)),1fr))}
.spacer{flex:1}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:var(--s5);min-width:0}
.card-flush{padding:0;overflow:hidden}
.card-header{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);margin-bottom:var(--s4)}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);flex-wrap:wrap;padding:var(--s3) var(--s4);border-top:1px solid var(--border);font-size:.8125rem;color:var(--text-2)}
.stats{display:grid;gap:var(--s3);grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:var(--s3) var(--s4);min-width:0}
.stat-label{font-size:.75rem;font-weight:500;color:var(--text-2)}
.stat-value{margin-top:2px;font-size:clamp(1.15rem,3vw,1.5rem);font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 14px;border:1px solid transparent;border-radius:var(--r);font-size:.875rem;font-weight:550;line-height:1;white-space:nowrap;cursor:pointer;user-select:none;transition:background-color .15s var(--ease),border-color .15s var(--ease),color .15s var(--ease),transform .1s var(--ease)}
.btn:active:not(:disabled){transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--accent);color:var(--on-accent);box-shadow:var(--shadow-sm),inset 0 1px 0 rgb(255 255 255/.14)}
.btn-primary:hover:not(:disabled){background:var(--accent-hover)}
.btn-secondary{background:var(--surface);border-color:var(--border-strong);color:var(--text);box-shadow:var(--shadow-sm)}
.btn-secondary:hover:not(:disabled){background:var(--surface-2)}
.btn-ghost{background:transparent;color:var(--text-2)}
.btn-ghost:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover:not(:disabled){filter:brightness(.92)}
.btn-sm{height:30px;padding:0 10px;border-radius:var(--r-sm);font-size:.8125rem}
.btn-icon{width:34px;height:34px;padding:0;border-radius:var(--r-sm);background:transparent;color:var(--text-3)}
.btn-icon:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
.btn-icon.is-danger:hover:not(:disabled){background:var(--danger-soft);color:var(--danger)}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.label{font-size:.8125rem;font-weight:550}
.hint{font-size:.75rem;color:var(--text-3)}
.error-text{font-size:.75rem;color:var(--danger)}
.input,.select,.textarea{width:100%;min-width:0;height:40px;padding:0 12px;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--r);font-size:.9375rem;transition:border-color .15s,box-shadow .15s}
.textarea{height:auto;min-height:88px;padding:10px 12px;line-height:1.5;resize:vertical}
.select{appearance:none;padding-right:36px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23808797' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:16px}
.input::placeholder,.textarea::placeholder{color:var(--text-3)}
.input:hover,.select:hover,.textarea:hover{border-color:var(--text-3)}
.input:focus-visible,.select:focus-visible,.textarea:focus-visible{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.input[aria-invalid=true]{border-color:var(--danger)}
.input-group{position:relative;display:flex;align-items:center;min-width:0}
.input-group>.icon,.input-group>.prefix{position:absolute;left:12px;color:var(--text-3);pointer-events:none}
.input-group>.input{padding-left:36px}
input[type=range]{width:100%;accent-color:var(--accent);cursor:pointer}
.check{appearance:none;display:inline-grid;place-content:center;width:20px;height:20px;margin:0;flex:none;border:1.5px solid var(--border-strong);border-radius:6px;background:var(--surface);cursor:pointer;transition:background-color .15s,border-color .15s}
.check::after{content:"";width:10px;height:5px;border:2px solid var(--on-accent);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg) scale(0);transition:transform .15s var(--ease)}
.check:checked{background:var(--accent);border-color:var(--accent)}
.check:checked::after{transform:translateY(-1px) rotate(-45deg) scale(1)}
.check:hover:not(:checked){border-color:var(--accent)}
.check.round{border-radius:50%}
.switch{appearance:none;position:relative;width:36px;height:20px;margin:0;flex:none;border-radius:var(--r-full);background:var(--border-strong);cursor:pointer;transition:background-color .2s}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0/.3);transition:transform .2s var(--ease)}
.switch:checked{background:var(--accent)}
.switch:checked::after{transform:translateX(16px)}
.seg{display:inline-flex;gap:2px;padding:3px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r)}
.seg button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--text-2);font-size:.8125rem;font-weight:550;cursor:pointer;transition:background-color .15s,color .15s}
.seg button:hover{color:var(--text)}
.seg button[aria-pressed=true]{background:var(--raised);color:var(--text);box-shadow:var(--shadow-sm)}
.list{margin:0;padding:0;list-style:none}
.row{display:flex;align-items:center;gap:var(--s3);min-height:52px;padding:10px var(--s4);border-bottom:1px solid var(--border);transition:background-color .15s}
.row:last-child{border-bottom:0}
.row:hover{background:color-mix(in srgb,var(--surface-2) 60%,transparent)}
.row-main{flex:1;min-width:0}
.row-title{font-weight:500;overflow-wrap:anywhere}
.row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:3px;font-size:.75rem;color:var(--text-3)}
.row-actions{display:flex;align-items:center;gap:2px;transition:opacity .15s}
@media (hover:hover){.row .row-actions{opacity:0}.row:hover .row-actions,.row:focus-within .row-actions{opacity:1}}
.badge{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:var(--r-full);background:var(--surface-2);color:var(--text-2);font-size:.75rem;font-weight:550;white-space:nowrap}
.badge-accent{background:var(--accent-soft);color:var(--accent-text)}
.badge-success{background:var(--success-soft);color:var(--success)}
.badge-warning{background:var(--warning-soft);color:var(--warning)}
.badge-danger{background:var(--danger-soft);color:var(--danger)}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--border-strong);border-radius:var(--r-full);background:var(--surface);font-size:.8125rem;font-weight:500;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}
.chip:hover{border-color:var(--text-3)}
.chip[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-text)}
.table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg)}
.table{width:100%;border-collapse:collapse;font-size:.875rem}
.table th{padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);color:var(--text-2);font-size:.75rem;font-weight:550;text-align:left;white-space:nowrap}
.table td{padding:12px 14px;border-bottom:1px solid var(--border)}
.table tr:last-child td{border-bottom:0}
.table .r{text-align:right;font-variant-numeric:tabular-nums}
.empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 20px;text-align:center;color:var(--text-2)}
.empty-icon{display:grid;place-items:center;width:46px;height:46px;margin-bottom:6px;border-radius:12px;background:var(--accent-soft);color:var(--accent-text)}
.empty h3{color:var(--text)}
.empty p{max-width:34ch;font-size:.875rem}
.toasts{position:fixed;left:50%;bottom:20px;z-index:50;display:flex;flex-direction:column;gap:8px;width:max-content;max-width:calc(100vw - 32px);transform:translateX(-50%)}
.toast{display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:var(--r);background:var(--text);color:var(--bg);box-shadow:var(--shadow-lg);font-size:.875rem;animation:toast-in .2s var(--ease)}
.toast button{height:30px;padding:0 10px;border:0;border-radius:var(--r-sm);background:color-mix(in srgb,currentColor 16%,transparent);color:inherit;font-weight:600;cursor:pointer}
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}}
.skeleton{border-radius:var(--r-sm);background:linear-gradient(90deg,var(--surface-2) 25%,var(--border) 37%,var(--surface-2) 63%);background-size:400% 100%;animation:shimmer 1.4s ease infinite}
@keyframes shimmer{from{background-position:100% 50%}to{background-position:0 50%}}
.progress{height:6px;overflow:hidden;border-radius:var(--r-full);background:var(--surface-2)}
.progress>span{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .3s var(--ease)}
.kbd{padding:1px 6px;border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:5px;background:var(--surface);color:var(--text-2);font:500 .6875rem/1.5 var(--font-mono)}
.divider{height:1px;margin:var(--s4) 0;border:0;background:var(--border)}
@media (max-width:560px){.card:not(.card-flush){padding:var(--s4)}.btn{height:40px}.hide-sm{display:none!important}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}"""


# Lucide-style icons (24×24, 2px stroke). Copy the <svg> into <body> keeping only
# the symbols the app uses, then draw one with
#   <svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>
ICONS: dict[str, str] = {
    "plus": '<path d="M5 12h14M12 5v14"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "x": '<path d="M18 6 6 18M6 6l12 12"/>',
    "pencil": '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>',
    "trash": '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    "undo": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "grip": '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
    "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "flag": '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    "inbox": '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    "wallet": '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    "receipt": '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
    "trending-up": '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    "rotate": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    "copy": '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
}


def icon_sprite(names: list[str] | None = None) -> str:
    """The icon <svg> sprite, with every icon or only the ones named."""
    keys = [n for n in (names or list(ICONS)) if n in ICONS]
    symbols = "".join(
        f'<symbol id="i-{k}" viewBox="0 0 24 24">{ICONS[k]}</symbol>' for k in keys
    )
    return f'<svg width="0" height="0" style="position:absolute" aria-hidden="true">{symbols}</svg>'


ICON_SPRITE = icon_sprite()


# --- directions ---------------------------------------------------------------

@dataclass(frozen=True)
class ArtifactDirection:
    key: str
    label: str
    summary: str      # shown to the person choosing a style
    families: str     # Google Fonts css2 family parameters
    light: str        # token overrides placed after the kit's :root
    dark: str         # token overrides inside the dark media query ("" = none)
    notes: str        # how the look should be applied


DIRECTIONS: list[ArtifactDirection] = [
    ArtifactDirection(
        key="clean",
        label="Clean SaaS",
        summary="Crisp white cards, indigo accent, Inter. Calm and familiar.",
        families=INTER,
        light="",
        dark="",
        notes="Use the kit as it is. White cards on a cool grey ground, one indigo "
              "primary action per view, generous whitespace around the key result.",
    ),
    ArtifactDirection(
        key="warm",
        label="Warm editorial",
        summary="Paper tones, a serif headline and a terracotta accent.",
        families="family=Fraunces:opsz,wght@9..144,600;9..144,700&" + INTER,
        light=("--font-display:'Fraunces',Georgia,serif;--bg:#f8f5f0;--surface:#fffdf9;"
               "--surface-2:#f3eee6;--border:#e9e1d5;--border-strong:#d8cdbd;--text:#1f1a14;"
               "--text-2:#5a5046;--text-3:#857a6d;--accent:#c2410c;--accent-hover:#9a3412;"
               "--accent-soft:#fdeee4;--accent-text:#9a3412;--r:12px;--r-lg:16px;"),
        dark=("--bg:#15120f;--surface:#1e1a16;--surface-2:#27221d;--raised:#332d26;"
              "--border:#332c25;--border-strong:#463d33;--text:#f3ede4;--text-2:#c2b6a6;"
              "--text-3:#958a7c;--accent:#fb923c;--accent-hover:#fdba74;--accent-soft:#3a2516;"
              "--accent-text:#fdba74;--on-accent:#1f1206;"),
        notes="Headings in the serif display face; body stays Inter. Softer, rounder "
              "cards with a little more padding. The accent is used sparingly.",
    ),
    ArtifactDirection(
        key="pro",
        label="Dark pro dashboard",
        summary="Dense, dark-first, mono figures and an emerald accent.",
        families=INTER + "&family=JetBrains+Mono:wght@500;600",
        light=("--font-mono:'JetBrains Mono',ui-monospace,Menlo,monospace;--accent:#059669;"
               "--accent-hover:#047857;--accent-soft:#e7f8f1;--accent-text:#047857;--r:8px;--r-lg:10px;"),
        dark=("--bg:#090b0e;--surface:#111418;--surface-2:#181c22;--raised:#232830;"
              "--border:#1f242c;--border-strong:#2e3540;--accent:#34d399;--accent-hover:#6ee7b7;"
              "--accent-soft:#0d2a21;--accent-text:#6ee7b7;--on-accent:#04150f;"),
        notes="Tighter: 44px rows, 16px card padding, smaller labels. Key figures in "
              "var(--font-mono) with tabular numbers. Prefer tables and stat rows to "
              "big hero cards. Both themes must work; dark is the showcase.",
    ),
    ArtifactDirection(
        key="playful",
        label="Playful",
        summary="Rounded, friendly and bright, with a violet accent.",
        families="family=Plus+Jakarta+Sans:wght@400;500;600;700;800",
        light=("--font-body:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;"
               "--bg:#f7f5ff;--surface-2:#f1edff;--border:#e6e0fa;--border-strong:#d3caf3;"
               "--accent:#7c3aed;--accent-hover:#6d28d9;--accent-soft:#f1eaff;--accent-text:#6d28d9;"
               "--r-sm:10px;--r:14px;--r-lg:20px;"),
        dark=("--bg:#0f0b1a;--surface:#171226;--surface-2:#201a33;--raised:#2c2445;"
              "--border:#2a2340;--border-strong:#3b3159;--accent:#a78bfa;--accent-hover:#c4b5fd;"
              "--accent-soft:#2a1f4d;--accent-text:#c4b5fd;--on-accent:#140b2b;"),
        notes="Big rounded corners, pill buttons (border-radius:var(--r-full)), one "
              "friendly illustration-like empty state, a touch of colour in badges.",
    ),
]

BY_KEY = {d.key: d for d in DIRECTIONS}
DEFAULT_KEY = "clean"

_HINTS: dict[str, tuple[str, ...]] = {
    "pro": ("dashboard", "analytics", "metrics", "monitor", "trading", "portfolio", "stock",
            "dark", "kpi", "pro "),
    "warm": ("journal", "diary", "recipe", "reading", "book", "habit", "gratitude", "notes",
             "wedding", "family", "warm"),
    "playful": ("kids", "game", "quiz", "fun", "party", "playful", "flashcard", "trivia",
                "pomodoro", "birthday"),
}


def pick(brief: str, requested: str | None = None) -> ArtifactDirection:
    """
    The direction for this artifact: the one asked for, else the one the brief
    suggests, else the clean kit — the right default for a finance workspace,
    where a tool should look like it belongs next to the rest of the app.
    """
    if requested and requested in BY_KEY:
        return BY_KEY[requested]
    text = (brief or "").lower()
    best: tuple[int, str] | None = None
    for key, words in _HINTS.items():
        score = sum(1 for w in words if w in text)
        if score and (best is None or score > best[0]):
            best = (score, key)
    return BY_KEY[best[1]] if best else BY_KEY[DEFAULT_KEY]


def style_options() -> list[dict]:
    """The directions as choices for the plan step."""
    return [{"id": d.key, "label": d.label, "description": d.summary} for d in DIRECTIONS]


def scaffold(direction: ArtifactDirection) -> str:
    """The part of the brief that fixes the artifact's look."""
    overrides = ""
    if direction.light:
        overrides += f"\n:root{{{direction.light}}}"
    if direction.dark:
        overrides += f"\n@media (prefers-color-scheme:dark){{:root{{{direction.dark}}}}}"
    override_text = (
        f"Directly after the kit's stylesheet, add these token overrides:{overrides}"
        if overrides else "Use the kit's tokens unchanged."
    )
    return f"""DESIGN DIRECTION — "{direction.label}": {direction.summary}

Put this in <head>, before the <style>:
{FONT_LINKS.format(families=direction.families)}

{override_text}

Character: {direction.notes}"""


# --- the brief ------------------------------------------------------------------

DESIGN_RULES = f"""THE DESIGN SYSTEM — build the app out of this kit. Do not invent a look.
Start the <style> with this stylesheet, then add the app's own rules beneath it
using its tokens (var(--accent), var(--s4), var(--r) …), never raw hex values.
You may leave out component blocks the app does not use; keep every token, the
dark-mode block, the base rules and the reduced-motion rule.

{BASE_CSS}

ICONS — inline SVG only, never emoji and never an icon font. Put this sprite as
the first child of <body>, keeping only the <symbol>s the app uses, and draw an
icon with <svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>.
For an icon the set lacks, write a symbol in the same style (24×24 viewBox,
2px round strokes, no fill):
{ICON_SPRITE}

COMPONENT RULES
- Shell: <main class="app"> → <header class="app-header"> holding an <h1> and a
  <p class="subtitle">, with header actions on the right → content in .card
  sections (or one .card-flush list card). Raise --app-w for wide tools
  (dashboards, CRMs, tables: 1040px); keep 640–760px for lists, forms and
  calculators. A landing or booking page may use full-width bands, each with an
  inner container of max-width var(--app-w) and margin-inline:auto.
- Alignment: rows are flex with align-items:center, so a checkbox, its text and
  the row's actions share one centre line. An input and the button beside it
  have the same height (40px). Icon-only buttons are .btn-icon squares with an
  aria-label and a title. Numbers in tables are right-aligned (.r).
- Spacing: only the scale (4, 8, 12, 16, 20, 24, 32, 40 px via --s1…--s10) and
  gap rather than margins between siblings. 16–20px inside cards, 24–32px
  between sections.
- Hierarchy: one h1; card titles are h2; secondary text var(--text-2), meta
  var(--text-3) at 12–13px; weights 400/500/600/700 only. One primary button
  per view; everything else is secondary or ghost.
- Density: 14–15px body text, 44–52px rows, compact stat tiles (.stats/.stat)
  for headline figures, tables for anything with columns. Finance tools lean
  dense; games, quizzes and landing pages may breathe more.
- Money and numbers: Intl.NumberFormat('en-IN', {{style:'currency',
  currency:'INR'}}) — ₹1,23,456.00, or maximumFractionDigits:0 for whole
  rupees. Large headline values may be compact (₹12.5 L, ₹3.2 Cr) with the full
  value in a title attribute. Always tabular numbers (.num). A negative amount
  carries a minus sign and var(--danger); colour is never the only signal.
  Dates as DD MMM YYYY.
- Colour: the accent marks the primary action, the selection, focus and the one
  key figure. Status colours (.badge-success / -warning / -danger) only for
  status. No gradients on surfaces, no rainbow palettes — unless the request
  asks for a look (glass, gradients, neon, retro, brutalist …): then build that
  look properly, on top of the kit's tokens, spacing and states. A style the
  person asks for always wins over the kit's defaults.
- States — design every one of them:
  - empty: .empty with an .empty-icon, a heading, one helpful line and the
    primary action;
  - loading: .skeleton rows shaped like the content while data loads, never a
    blank card or a bare "Loading…";
  - saving: when the app keeps data, a small quiet indicator in the header
    ("Saving…", then "Synced" with the check icon, or "Offline" / "Not saved"
    in var(--warning) when a save fails), as a .badge with aria-live="polite";
  - error: an inline message next to what failed, with a way to retry;
  - destructive actions are undoable from a .toast.
  Every interactive element also has hover, focus-visible, active and disabled
  styles (the kit provides them).
- Motion: 150–200ms transitions on colour, opacity and transform only, all
  switched off by the kit's prefers-reduced-motion rule.
- DON'T: leave a default browser checkbox, select, button or blue link; use
  the system font alone; use a placeholder as the only label; centre long text;
  stack a shadow on a heavy border; hide row actions on touch screens; shift
  layout on hover; use emoji as icons; let anything scroll sideways at 360px.

CONTENT QUALITY
- First load looks alive: realistic sample data from an Indian context (names
  like Priya, Arjun, Neha; real-looking amounts; dates relative to today),
  4–6 items, seeded only when nothing is stored yet. Where the person's own
  input is the whole point, or the data is shared between people, show a
  helpful empty state instead of fake records.
- Build the features people expect of that kind of app, not a demo of one.
  Whatever the request, think what the best product of its kind does and
  build the core of that. For example:
  - To-do / checklist: add with Enter (input focused on load), complete,
    edit inline (double-click or the edit button; Enter saves, Escape cancels),
    delete with an Undo toast, filter All / Active / Done with counts, items
    left, Clear completed, reorder (drag handle plus Alt+↑/↓), optional due
    date and priority shown as badges, overdue flagged.
  - Calculator / planner: sensible defaults filled in, sliders paired with
    number inputs, results update live, the key result as the hero figure, a
    breakdown table or inline-SVG chart, and Reset.
  - Tracker / log / inventory / habit tracker: add form, list or table with
    search, sort and filters, totals or streaks, a per-category breakdown,
    low-stock or overdue flags, edit and delete with undo.
  - CRM / directory: records with a status pipeline (.seg or columns), search,
    a detail panel, notes and next-action dates.
  - Splitter: people, expenses (payer, amount, split between), each person's
    balance, and settle-up as the fewest payments.
  - Dashboard: a .stats row, one or two inline-SVG charts with labelled axes,
    a table, and a period filter.
  - Booking / sign-up / landing page with a list: a clear hero with what it is
    and the one action, the form with inline validation and a confirmation
    state, slots or capacity shown, and an organiser view of who signed up.
  - Poll: question and options, one vote per person, live result bars with
    percentages and counts, and the person's own choice marked.
  - Form / quiz: inline validation, progress, feedback per answer, and a
    summary or score screen with a way to retry.
  - Game: a start screen, clear rules, score and best score, pause/restart,
    keyboard and touch controls, and a game-over screen.
- Keyboard: Enter submits, Escape cancels or closes, "/" focuses search or the
  main input, Ctrl/Cmd+Z undoes the last delete where there is undo. Show the
  shortcuts once in a quiet footer line with .kbd (hidden on phones, .hide-sm).
- Mobile (≤560px): one column, full-width inputs, 40px+ hit targets, row
  actions always visible, wide tables scroll inside .table-wrap.
- Accessible: every input has a <label for> (a visually hidden .sr-only label
  is fine where the design has none), buttons are <button>, results and toasts
  live in aria-live="polite" regions, contrast 4.5:1.
- Validate input. Never show NaN, Infinity or undefined — show a short hint.
- Include <!DOCTYPE html>, <html lang="en">, <meta charset="utf-8">, a viewport
  meta tag, a specific <title> and a one-sentence <meta name="description">.

LENGTH — a good app here is typically 400–900 lines and you have room for it:
spend it on working features and the kit, not on comments or repeated rules.
Write in order: <head> with the stylesheet, the markup, then the script, then
</body></html>. The file MUST be complete — a file cut off mid-script does
nothing at all. If you are running long, drop a secondary feature, never the
design system and never the closing tags.

SELF-CHECK before you output, and fix anything that fails:
1. On load everything renders and works with no console errors; sample data, a
   loading skeleton or a designed empty state is visible; every button works.
2. Nothing is misaligned: checkbox, text and actions share a centre line in
   every row; inputs and buttons in a row are the same height; columns line up.
3. No default browser styling is left: the font is set and every control uses
   a kit class (.btn, .input, .select, .check, .switch, .seg, .chip).
4. Dark mode is correct: every colour comes from a token, nothing is hard-coded
   white or black, text is readable and borders are visible.
5. At 360px wide nothing overflows or overlaps, and every action is reachable.
6. Every amount is ₹ in en-IN format with tabular numbers; no NaN anywhere."""
