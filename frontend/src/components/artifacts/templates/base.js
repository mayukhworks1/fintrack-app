/**
 * Shared scaffolding for the artifact templates.
 *
 * Each template is still ONE self-contained HTML file once built: these
 * snippets are inlined into every document, not linked. Keeping them here only
 * stops eight copies of the same stylesheet drifting apart.
 */

export const BASE_CSS = `
:root{
  color-scheme: light dark;
  --bg:#f6f7f9; --card:#ffffff; --ink:#14171f; --mute:#5b6372; --line:#dfe3ea;
  --accent:#1f5eff; --accent-ink:#ffffff; --soft:#eef3ff; --ok:#137a43; --warn:#a15c00; --bad:#b42318;
  --radius:12px; --shadow:0 1px 2px rgba(16,24,40,.06),0 4px 14px rgba(16,24,40,.06);
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0f1218; --card:#171b23; --ink:#e8ebf1; --mute:#a3abb9; --line:#2a303c;
    --accent:#7aa2ff; --accent-ink:#0b1020; --soft:#1c2540; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171;
    --shadow:0 1px 2px rgba(0,0,0,.4);
  }
}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none !important}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:16px/1.5 var(--font);-webkit-text-size-adjust:100%}
.wrap{max-width:960px;margin-inline:auto;padding:clamp(14px,3vw,28px)}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:clamp(1.35rem,3.6vw,1.9rem);line-height:1.2;margin:0;letter-spacing:-.01em}
h2{font-size:1.05rem;margin:0 0 10px}
p.lede{margin:4px 0 0;color:var(--mute);font-size:.95rem}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);min-width:0}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;min-width:0}
.row{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr))}
label,.label{font-size:.82rem;font-weight:600;color:var(--mute)}
input,select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;width:100%;min-width:0}
textarea{resize:vertical;font-family:var(--mono);font-size:.85rem;line-height:1.45}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;font-weight:600;border-radius:9px;padding:9px 14px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button:hover{filter:brightness(.97)}
button:disabled{opacity:.55;cursor:not-allowed}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;flex-wrap:wrap}
.seg label{display:flex;align-items:center;gap:6px;padding:7px 12px;cursor:pointer;color:var(--ink);font-weight:500;font-size:.9rem}
.seg input{width:auto;accent-color:var(--accent)}
.seg label:has(input:checked){background:var(--soft)}
.kpis{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.kpi{background:var(--soft);border-radius:10px;padding:10px 12px;min-width:0}
.kpi .k{font-size:.78rem;color:var(--mute);font-weight:600}
.kpi .v{font-size:clamp(1.05rem,2.6vw,1.35rem);font-weight:750;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.big{font-size:clamp(1.5rem,5vw,2.2rem);font-weight:800;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mute{color:var(--mute)} .small{font-size:.82rem}
.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:.78rem;color:var(--mute);background:var(--bg)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:none}
.hint{font-size:.8rem;color:var(--warn);min-height:1em}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
footer.note{margin-top:18px;font-size:.78rem;color:var(--mute)}
`.trim()

/** Helpers every template script starts with. Plain ES2017, no dependencies. */
export const BASE_JS = `
var $ = function(id){ return document.getElementById(id); };
var INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
var INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function inr(n){ return isFinite(n) ? INR.format(n) : '—'; }
function inr0(n){ return isFinite(n) ? INR0.format(n) : '—'; }
function num(v){ var n = parseFloat(String(v == null ? '' : v).replace(/[,\\s₹]/g, '')); return isFinite(n) ? n : NaN; }
var store = {
  get: function(key, fallback){ try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set: function(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  del: function(key){ try { localStorage.removeItem(key); } catch (e) {} }
};
// The clipboard API is often refused inside a sandboxed frame; a selected
// textarea and execCommand still works there. Calls back with true on success.
function copyText(text, cb){
  function legacy(){
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); cb && cb(ok);
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ cb && cb(true); }, legacy);
      return;
    }
  } catch (e) {}
  legacy();
}
`.trim()

/**
 * Wrap a template's body and script into a complete document.
 * `description` becomes the meta description the link preview uses.
 */
export function buildDocument({ title, description, css = '', body, script }) {
  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<style>
${BASE_CSS}
${css.trim()}
</style>
</head>
<body>
${body.trim()}
<script>
${BASE_JS}
${script.trim()}
</script>
</body>
</html>
`
}
