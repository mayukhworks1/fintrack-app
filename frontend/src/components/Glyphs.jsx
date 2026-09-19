/**
 * One drawing per subject.
 *
 * What was here before: four generic chart doodles — bars, a line, a donut
 * reading 68%, a stack of sheets — dealt out to eleven modules and six pages
 * by array position. Landing picked with `CHIP_PEEK[i % 4]`, so a module's
 * illustration was decided by where it happened to sit in a list. That is why
 * "Features — eleven modules, delivery, receivables, tax, audit" sat beside a
 * donut reading 68%, and "Questions — the ones buyers actually ask" beside a
 * line chart trending up. 68% of what? Questions are not a trend.
 *
 * A picture next to a label is read as a claim about that label. If it cannot
 * make one, it is worse than blank space, because the reader spends a beat
 * trying to reconcile it before giving up.
 *
 * So: every glyph here depicts the thing it is named for, and every call site
 * chooses by meaning. Rules that keep them a set rather than a pile:
 *
 *   One geometry. 120x64, stroke 2, round caps, flat. No perspective — these
 *   sit beside data and perspective distorts magnitude.
 *
 *   One palette. --accent carries the subject, --ok appears only where
 *   something is genuinely affirmative, --text-3 at low opacity is inert
 *   background. Three roles, never decoration for its own sake.
 *
 *   No invented figures. The donut asserted a statistic that did not exist.
 *   Nothing here prints a number it cannot stand behind; where a quantity is
 *   shown it is shown as a proportion, unlabelled.
 *
 * All inline SVG: the CSP names two script origins, so an external animation
 * runtime is blocked, and a hotlinked asset is a broken front door the day its
 * host reorganises. Every glyph is aria-hidden — an illustration must not be
 * announced as data.
 */
import { useReveal } from '../hooks/useReveal'

/* Shared frame. One viewBox so the set shares a baseline and an optical
   weight; height is set by the caller's box, not by the drawing. */
function G({ children, vb = '0 0 120 64' }) {
  const ref = useReveal({ threshold: 0.1 })
  return (
    <svg ref={ref} className="ft-reveal ft-glyph w-full" viewBox={vb} aria-hidden="true"
         style={{ display: 'block', maxHeight: '100%' }}>
      {children}
    </svg>
  )
}

const INERT = { fill: 'var(--text-3)', opacity: 0.22 }
const CARD = { fill: 'var(--card-bg)', stroke: 'var(--card-border)' }

/* ── Receivables ──────────────────────────────────────────────────────────
   Invoice rows with an amount column, one of them overdue. The subject is a
   list you act on, so the drawing is a list with one row asking for action. */
export function GlyphLedger() {
  return (
    <G>
      {[0, 1, 2, 3].map(i => (
        <g key={i}>
          <rect x="6" y={6 + i * 15} width="108" height="11" rx="3" {...CARD} />
          <rect x="11" y={9.5 + i * 15} width={i === 1 ? 30 : 42} height="4" rx="2" {...INERT} />
          <rect x={i === 1 ? 78 : 84} y={9.5 + i * 15} width={i === 1 ? 30 : 24} height="4" rx="2"
                fill={i === 1 ? 'var(--bad)' : 'var(--text-3)'} opacity={i === 1 ? 0.85 : 0.35} />
        </g>
      ))}
    </G>
  )
}

/* ── Projects · Delivery & status ─────────────────────────────────────────
   Three lanes with cards. The one thing a board must show is that work sits
   in states and moves between them, so the lanes carry different counts. */
export function GlyphBoard() {
  const lanes = [2, 3, 1]
  return (
    <G>
      {lanes.map((n, l) => (
        <g key={l}>
          <rect x={6 + l * 38} y="6" width="32" height="52" rx="4" {...INERT} />
          {Array.from({ length: n }, (_, c) => (
            <rect key={c} x={9 + l * 38} y={10 + c * 15} width="26" height="11" rx="3"
                  fill={l === 2 ? 'var(--ok)' : 'var(--accent)'}
                  opacity={l === 2 ? 0.9 : 0.75 - c * 0.16} />
          ))}
        </g>
      ))}
    </G>
  )
}

/* ── Tax ledger ───────────────────────────────────────────────────────────
   The split the site explains in prose four times: what you billed, the GST
   added on top, the TDS the client withholds, and what actually lands. Shown
   as proportions of one bar, because that is what the point is — the number
   you chase is not the number you billed. */
export function GlyphTaxSplit() {
  const seg = [
    { w: 58, fill: 'var(--accent)', o: 0.9 },   // billed
    { w: 18, fill: 'var(--accent)', o: 0.45 },  // GST added
    { w: 14, fill: 'var(--bad)', o: 0.7 },      // TDS withheld
    { w: 18, fill: 'var(--ok)', o: 0.9 },       // lands
  ]
  let x = 6
  return (
    <G>
      {seg.map((s, i) => {
        const el = <rect key={i} x={x} y="20" width={s.w} height="18" rx={i === 0 ? 4 : 0}
                         fill={s.fill} opacity={s.o} />
        x += s.w + 2
        return el
      })}
      {/* the bracket under what actually arrives */}
      <path d="M 98 43 L 98 47 L 114 47 L 114 43" fill="none"
            stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </G>
  )
}

/* ── AI reports & assistant ───────────────────────────────────────────────
   A question, an answer, and underneath it the query that produced the
   answer. The last part is the whole product claim — an answer you can check
   — so it is the part the drawing makes visible. */
export function GlyphAnalyst() {
  return (
    <G>
      <rect x="34" y="6" width="80" height="13" rx="6.5" fill="var(--accent)" opacity="0.9" />
      <rect x="41" y="11" width="52" height="4" rx="2" fill="#fff" opacity="0.75" />
      <rect x="6" y="24" width="88" height="13" rx="6.5" {...CARD} />
      <rect x="13" y="29" width="60" height="4" rx="2" {...INERT} />
      {/* the query, monospace-ish ticks, set apart by a rule */}
      <line x1="6" y1="44" x2="114" y2="44" stroke="var(--card-border)" strokeWidth="1" />
      {[0, 1, 2].map(i => (
        <rect key={i} x={6 + i * 26} y="50" width={i === 2 ? 34 : 22} height="4" rx="2"
              fill="var(--ok)" opacity="0.6" />
      ))}
    </G>
  )
}

/* ── Studio — finance data ────────────────────────────────────────────────
   A table with one column picked out: the point is querying a column of your
   own data, not the table existing. */
export function GlyphTable() {
  return (
    <G>
      <rect x="6" y="6" width="108" height="52" rx="4" {...CARD} />
      <line x1="6" y1="20" x2="114" y2="20" stroke="var(--card-border)" strokeWidth="1" />
      <rect x="62" y="6" width="26" height="52" fill="var(--accent)" opacity="0.14" />
      {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => (
        <rect key={`${r}${c}`} x={12 + c * 26} y={26 + r * 11} width="16" height="4" rx="2"
              fill={c === 2 ? 'var(--accent)' : 'var(--text-3)'} opacity={c === 2 ? 0.85 : 0.25} />
      )))}
    </G>
  )
}

/* ── Projects ─────────────────────────────────────────────────────────────
   Not a board — read the module: billed against cost per project, with a
   health signal. So the drawing is paired bars, and the one whose cost has
   caught its billing is the one you are meant to catch. */
export function GlyphMargin() {
  const rows = [[52, 30], [44, 28], [38, 36]]
  return (
    <G>
      {rows.map(([billed, cost], i) => {
        const tight = billed - cost < 8
        return (
          <g key={i}>
            <rect x="6" y={8 + i * 19} width={billed} height="7" rx="3.5"
                  fill="var(--accent)" opacity="0.85" />
            <rect x="6" y={17 + i * 19} width={cost} height="7" rx="3.5"
                  fill={tight ? 'var(--bad)' : 'var(--text-3)'} opacity={tight ? 0.75 : 0.3} />
            <circle cx="110" cy={16 + i * 19} r="4"
                    fill={tight ? 'var(--bad)' : 'var(--ok)'} opacity="0.9" />
          </g>
        )
      })}
    </G>
  )
}

/* ── Pages · Shared views ─────────────────────────────────────────────────
   One frame, two honest variants, because these are two different claims.
   "stream" is Pages: the generator writing, last line still half-drawn.
   "link"   is Shared views: the same frame published, one band withheld —
   what is shared is a subset, and the subset is the feature. */
export function GlyphShare({ mode = 'link' }) {
  const stream = mode === 'stream'
  return (
    <G>
      <rect x="6" y="10" width={stream ? 108 : 80} height="44" rx="5" {...CARD} />
      <line x1="6" y1="22" x2={stream ? 114 : 86} y2="22"
            stroke="var(--card-border)" strokeWidth="1" />
      <rect x="12" y="28" width="44" height="4" rx="2" fill="var(--accent)" opacity="0.8" />
      <rect x="12" y="37" width={stream ? 88 : 58} height="4" rx="2" {...INERT} />
      {stream ? (
        <>
          {/* the line being written, and the caret at its end */}
          <rect x="12" y="46" width="42" height="4" rx="2" {...INERT} />
          <rect x="57" y="44" width="2" height="8" rx="1" fill="var(--accent)"
                style={{ animation: 'ft-caret 1s steps(1) infinite' }} />
        </>
      ) : (
        <>
          <rect x="12" y="46" width="30" height="4" rx="2" {...INERT} />
          <rect x="92" y="24" width="22" height="16" rx="8" fill="var(--ok)" opacity="0.9" />
          <path d="M 99 32 h 8 M 104 29 l 3 3 l -3 3" fill="none" stroke="#fff"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </G>
  )
}

/* ── Admin & audit ────────────────────────────────────────────────────────
   A log: entries in time order, each stamped. Rows narrow as they recede so
   it reads as a continuing record rather than four items. */
export function GlyphAudit() {
  return (
    <G>
      <line x1="14" y1="8" x2="14" y2="58" stroke="var(--card-border)" strokeWidth="2" />
      {[0, 1, 2, 3].map(i => (
        <g key={i} opacity={1 - i * 0.18}>
          <circle cx="14" cy={12 + i * 14} r="3.5"
                  fill={i === 0 ? 'var(--accent)' : 'var(--text-3)'} />
          <rect x="24" y={10 + i * 14} width={62 - i * 10} height="4" rx="2" {...INERT} />
          <rect x="96" y={10 + i * 14} width="18" height="4" rx="2"
                fill="var(--text-3)" opacity="0.3" />
        </g>
      ))}
    </G>
  )
}

/* ── Overview ─────────────────────────────────────────────────────────────
   The positioning in one drawing: delivery state on top, the money for it
   underneath, joined — because they are the same records, which is the whole
   claim. */
export function GlyphOneRecord() {
  return (
    <G>
      {[0, 1, 2].map(i => (
        <rect key={i} x={6 + i * 38} y="6" width="32" height="14" rx="4"
              fill="var(--accent)" opacity={0.85 - i * 0.2} />
      ))}
      {/* the join */}
      {[0, 1, 2].map(i => (
        <line key={i} x1={22 + i * 38} y1="22" x2={22 + i * 38} y2="34"
              stroke="var(--card-border)" strokeWidth="2" strokeLinecap="round" />
      ))}
      {[0, 1, 2].map(i => (
        <rect key={i} x={6 + i * 38} y="36" width="32" height="14" rx="4"
              fill="var(--ok)" opacity={0.8 - i * 0.18} />
      ))}
      <rect x="6" y="56" width="108" height="3" rx="1.5" {...INERT} />
    </G>
  )
}

/* ── Features ─────────────────────────────────────────────────────────────
   Eleven tiles, because the page is eleven modules. A count the reader can
   verify by looking is worth more than a chart that asserts nothing. */
export function GlyphModules() {
  return (
    <G>
      {Array.from({ length: 11 }, (_, i) => (
        <rect key={i} x={6 + (i % 4) * 28} y={6 + Math.floor(i / 4) * 20}
              width="24" height="16" rx="4"
              fill="var(--accent)" opacity={0.28 + (i % 4) * 0.13 + Math.floor(i / 4) * 0.06} />
      ))}
    </G>
  )
}

/* ── How it works ─────────────────────────────────────────────────────────
   Three layers and the direction data moves through them. Flat slabs, not an
   isometric stack: this is 120px wide and perspective at that size is mush. */
export function GlyphLayers() {
  return (
    <G>
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x={6 + i * 6} y={6 + i * 18} width={96 - i * 12} height="14" rx="4"
                fill="var(--accent)" opacity={0.3 + i * 0.28} />
          {i < 2 && (
            <path d={`M ${54} ${22 + i * 18} l 0 6 m -3 -3 l 3 3 l 3 -3`} fill="none"
                  stroke="var(--text-3)" strokeWidth="1.6" strokeLinecap="round"
                  strokeLinejoin="round" opacity="0.6" />
          )}
        </g>
      ))}
    </G>
  )
}

/* ── Security & access ────────────────────────────────────────────────────
   Who can see what: roles down, resources across, and one cell denied. The
   denial is the point — a permission model that grants everything is not one. */
export function GlyphPermissions() {
  const grid = [[1, 1, 1], [1, 1, 0], [1, 0, 0]]
  return (
    <G>
      {grid.map((row, r) => row.map((on, c) => (
        <g key={`${r}${c}`}>
          <rect x={20 + c * 32} y={6 + r * 19} width="28" height="15" rx="4"
                fill={on ? 'var(--ok)' : 'var(--text-3)'} opacity={on ? 0.2 : 0.12} />
          {on
            ? <path d={`M ${28 + c * 32} ${13.5 + r * 19} l 3 3 l 6 -6`} fill="none"
                    stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            : <path d={`M ${30 + c * 32} ${10.5 + r * 19} l 8 8 m 0 -8 l -8 8`} fill="none"
                    stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />}
        </g>
      )))}
      {[0, 1, 2].map(r => (
        <rect key={r} x="6" y={11 + r * 19} width="9" height="4" rx="2" {...INERT} />
      ))}
    </G>
  )
}

/* ── Made yours ───────────────────────────────────────────────────────────
   Settings you actually move. Two on, one off — a row of switches all in the
   same position is a picture of a decision nobody made. */
export function GlyphSwitches() {
  const on = [true, true, false]
  return (
    <G>
      {on.map((v, i) => (
        <g key={i}>
          <rect x="6" y={11 + i * 18} width="54" height="4" rx="2" {...INERT} />
          <rect x="74" y={6 + i * 18} width="40" height="16" rx="8"
                fill={v ? 'var(--ok)' : 'var(--text-3)'} opacity={v ? 0.9 : 0.22} />
          <circle cx={v ? 106 : 82} cy={14 + i * 18} r="5.5" fill="#fff" />
        </g>
      ))}
    </G>
  )
}

/* ── Questions ────────────────────────────────────────────────────────────
   A list where one is open. The page's promise is "answered at length", so
   the drawing shows an answer having length. */
export function GlyphQA() {
  return (
    <G>
      <rect x="6" y="6" width="108" height="30" rx="5" {...CARD} />
      <rect x="12" y="11" width="46" height="4" rx="2" fill="var(--accent)" opacity="0.85" />
      <rect x="12" y="21" width="94" height="3.5" rx="1.75" {...INERT} />
      <rect x="12" y="28" width="72" height="3.5" rx="1.75" {...INERT} />
      {[0, 1].map(i => (
        <g key={i}>
          <rect x="6" y={40 + i * 12} width="108" height="10" rx="4" {...CARD} />
          <rect x="12" y={43.5 + i * 12} width={i ? 38 : 54} height="3.5" rx="1.75" {...INERT} />
        </g>
      ))}
    </G>
  )
}
