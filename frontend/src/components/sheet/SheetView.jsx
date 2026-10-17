// Read-only spreadsheet for published pages and version previews. Formulas are
// computed, the column formats saved with the sheet (metadata.sheet) are
// applied, and a reader can search, sort and download the rows. Only the rows
// in view are rendered (with fixed-height rows), or a page of a hundred when
// cells wrap; values are computed only for rows that are shown, searched or
// sorted.
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react'
import { csvToGrid, createEvaluator, colName, dateSerial, isErrorValue, ERROR_HELP } from '../../utils/sheet'
import { toCsv } from '../../utils/csv'
import { downloadBlob } from '../../utils/download'
import { useMediaQuery } from '../../hooks/useMediaQuery'

const PAGE_SIZE = 100
const MEASURE_ROWS = 200
const OVERSCAN = 20
const FALLBACK_VIEW_H = 800
const BLANK = 0
const TEXT = 1
const NUM = 2
const BOOL = 3
const ERR = 4

const SIZES = {
  full: { font: 14, pad: 12, min: 64, max: 360 },
  narrow: { font: 13, pad: 10, min: 56, max: 300 },
  compact: { font: 12.5, pad: 9, min: 56, max: 280 },
}

// The viewer is drawn with its own --sv-* tokens so the same markup works on a
// published page (the --pv-* palette) and inside the app (the app palette).
const THEMES = {
  app: {
    '--sv-bg': 'var(--card-bg)',
    '--sv-head': 'var(--bg-base)',
    '--sv-line': 'var(--border)',
    '--sv-ink': 'var(--text-1)',
    '--sv-text': 'var(--text-2)',
    '--sv-mute': 'var(--text-3)',
    '--sv-accent': 'var(--accent)',
    '--sv-input': 'var(--bg-input)',
    '--sv-err': 'var(--fin-negative)',
  },
  public: {
    '--sv-bg': 'var(--pv-card)',
    '--sv-head': 'var(--pv-subtle)',
    '--sv-line': 'var(--pv-line)',
    '--sv-ink': 'var(--pv-ink)',
    '--sv-text': 'var(--pv-text)',
    '--sv-mute': 'var(--pv-mute)',
    '--sv-accent': '#2563eb',
    '--sv-input': 'var(--pv-card)',
  },
}

const CSS = `
.ft-sv{--sv-zebra:color-mix(in srgb,var(--sv-head) 55%,var(--sv-bg));--sv-hover:color-mix(in srgb,var(--sv-accent) 7%,var(--sv-bg));color:var(--sv-ink);font-size:14px;min-width:0}
.ft-sv-public{--sv-err:#b42318}
@media (prefers-color-scheme:dark){.ft-sv-public{--sv-err:#f29b94}}
.ft-sv-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:10px}
.ft-sv-search{display:flex;align-items:center;gap:6px;flex:0 1 280px;min-width:180px;height:34px;padding:0 4px 0 10px;border:1px solid var(--sv-line);border-radius:8px;background:var(--sv-input);color:var(--sv-mute);box-sizing:border-box}
.ft-sv-search:focus-within{border-color:var(--sv-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--sv-accent) 18%,transparent)}
.ft-sv-search input{flex:1;min-width:0;height:100%;padding:0;border:0;outline:0;background:transparent;color:var(--sv-ink);font:inherit;font-size:13.5px}
.ft-sv-search input::placeholder{color:var(--sv-mute)}
.ft-sv-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.ft-sv-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:none;color:var(--sv-mute);cursor:pointer}
.ft-sv-x:hover{color:var(--sv-ink);background:var(--sv-head)}
.ft-sv-count{font-size:12.5px;color:var(--sv-mute);white-space:nowrap}
.ft-sv-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--sv-line);border-radius:7px;background:var(--sv-bg);color:var(--sv-text);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.ft-sv-btn:hover{border-color:var(--sv-accent);color:var(--sv-accent)}
.ft-sv-btn:focus-visible,.ft-sv-x:focus-visible{outline:2px solid var(--sv-accent);outline-offset:1px}
.ft-sv-dl{margin-left:auto}
.ft-sv-box{overflow:auto;border:1px solid var(--sv-line);border-radius:10px;background:var(--sv-bg);overscroll-behavior-x:contain}
.ft-sv table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%;font-variant-numeric:tabular-nums}
.ft-sv th,.ft-sv td{padding:8px 12px;border-right:1px solid var(--sv-line);border-bottom:1px solid var(--sv-line);background:var(--sv-bg);color:var(--sv-ink);text-align:left;vertical-align:top;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.45}
.ft-sv tr>:last-child{border-right:0}
.ft-sv tbody tr:last-child>td{border-bottom:0}
.ft-sv tbody tr.ft-sv-z>td{background:var(--sv-zebra)}
.ft-sv tbody tr.ft-sv-gap>td{padding:0;border:0;background:none}
@media (hover:hover){.ft-sv tbody tr:hover>td{background:var(--sv-hover)}}
.ft-sv thead th,.ft-sv thead td{background:var(--sv-head)}
.ft-sv th{font-weight:700}
.ft-sv-pin{position:sticky;z-index:2}
.ft-sv-fz{position:sticky;z-index:1}
.ft-sv .ft-sv-pin.ft-sv-fz{z-index:3}
.ft-sv-box[data-sx] .ft-sv-edge{box-shadow:6px 0 6px -6px rgba(15,23,42,.3)}
.ft-sv .ft-sv-r{text-align:right}
.ft-sv .ft-sv-c{text-align:center}
.ft-sv .ft-sv-wrap{white-space:pre-wrap;overflow-wrap:anywhere;text-overflow:clip}
.ft-sv .ft-sv-err{color:var(--sv-err);font-weight:500;cursor:help}
.ft-sv-why{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (hover:none),(max-width:640px){.ft-sv td{white-space:pre-wrap;overflow-wrap:anywhere;text-overflow:clip}.ft-sv-why{position:static;display:block;width:auto;height:auto;overflow:visible;clip:auto;white-space:normal;font-size:11.5px;font-weight:400;color:var(--sv-mute)}}
.ft-sv .ft-sv-letters th{font-size:11.5px;font-weight:600;color:var(--sv-mute);text-align:center}
.ft-sv th.ft-sv-sh{padding:0}
.ft-sv-sort{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:8px 12px;border:0;background:none;color:inherit;font:inherit;font-weight:inherit;line-height:inherit;text-align:inherit;cursor:pointer}
.ft-sv-sort>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ft-sv-sort>svg{flex:none;opacity:.35}
.ft-sv-sort:hover>svg{opacity:.7}
.ft-sv-sort:focus-visible{outline:2px solid var(--sv-accent);outline-offset:-2px;border-radius:3px}
.ft-sv .ft-sv-letters .ft-sv-sort{padding:4px 8px}
.ft-sv .ft-sv-r .ft-sv-sort{flex-direction:row-reverse}
.ft-sv .ft-sv-c .ft-sv-sort{justify-content:center}
.ft-sv th[aria-sort=ascending] .ft-sv-sort>svg,.ft-sv th[aria-sort=descending] .ft-sv-sort>svg{opacity:1;color:var(--sv-accent)}
.ft-sv-ghost{color:var(--sv-mute);font-weight:500}
.ft-sv mark{background:color-mix(in srgb,#facc15 42%,transparent);color:inherit;border-radius:2px}
.ft-sv .ft-sv-none td{padding:22px 12px;overflow:visible;color:var(--sv-mute);white-space:normal}
.ft-sv-none span{position:sticky;left:12px;display:inline-block}
.ft-sv-more{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--sv-mute)}
.ft-sv-btn:disabled{opacity:.45;cursor:default;border-color:var(--sv-line);color:var(--sv-text)}
.ft-sv-empty{margin:0;padding:24px 0;text-align:center;font-size:14px;color:var(--sv-mute)}
.ft-sv-compact{font-size:12.5px}
.ft-sv-compact th,.ft-sv-compact td,.ft-sv-compact .ft-sv-sort{padding:5px 9px}
.ft-sv-compact .ft-sv-bar{margin-bottom:8px}
.ft-sv-compact .ft-sv-search{height:30px;flex-basis:220px}
.ft-sv-compact .ft-sv-btn{height:28px}
@media (max-width:640px){.ft-sv-full{font-size:13px}.ft-sv-full th,.ft-sv-full td,.ft-sv-full .ft-sv-sort{padding:7px 10px}.ft-sv-full .ft-sv-search{flex:1 1 100%}.ft-sv .ft-sv-search{height:44px}.ft-sv .ft-sv-x{width:36px;height:36px;min-height:0}}
`

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function rowsLabel(n) {
  return `${n.toLocaleString('en-IN')} row${n === 1 ? '' : 's'}`
}

function intIn(v, lo, hi, fallback) {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback
}

function kindOf(v, fmt) {
  if (v === '' || v === null || v === undefined) return BLANK
  if (typeof v === 'number') return NUM
  if (typeof v === 'boolean') return BOOL
  if (isErrorValue(v)) return ERR
  if (fmt && fmt.type === 'date' && dateSerial(v) !== null) return NUM
  return TEXT
}

// Same order as the editor's sort: numbers and dates, then text (natural
// order), then TRUE/FALSE, then errors; blanks always last.
function sortKey(v) {
  if (v === '' || v === null || v === undefined) return { rank: 9 }
  if (typeof v === 'number') return { rank: 0, v }
  if (typeof v === 'boolean') return { rank: 2, v: v ? 1 : 0 }
  if (isErrorValue(v)) return { rank: 3, v }
  const s = String(v)
  if (!s.trim()) return { rank: 9 }
  const d = dateSerial(s)
  return d === null ? { rank: 1, v: s } : { rank: 0, v: d }
}

let measureCtx
function textWidth(s, font, size) {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d') || null } catch { measureCtx = null }
  }
  if (!measureCtx) return s.length * size * 0.56
  measureCtx.font = font
  return measureCtx.measureText(s.replace(/\d/g, '0')).width * 1.04 + 2
}

function fontFamily() {
  try { return getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif' } catch { return 'system-ui, sans-serif' }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(s, re) {
  if (!re || !s) return s
  const parts = s.split(re)
  if (parts.length === 1) return s
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
}

function fileName(title) {
  const base = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${base || 'sheet'}.csv`
}

function buildSheet(text, meta) {
  const grid = csvToGrid(text || '')
  const m = meta && typeof meta === 'object' ? meta : {}
  const header = m.header !== false
  const textCols = Object.keys(m.colFormats || {}).filter(c => m.colFormats[c]?.type === 'text').map(Number)
  const ev = createEvaluator(grid, { textCols, header })
  let rows = 0
  let cols = 0
  grid.forEach((row, r) => {
    for (let c = row.length - 1; c >= 0; c--) {
      if (String(row[c] ?? '').trim()) {
        rows = r + 1
        if (c >= cols) cols = c + 1
        break
      }
    }
  })
  const freezeRows = intIn(m.freezeRows, 0, rows, header ? 1 : 0)
  const freezeCols = intIn(m.freezeCols, 0, Math.max(0, cols - 1), 0)
  // Only the header row stays out of search and sort; other frozen rows are
  // data, which stick to the top only while the rows are in sheet order.
  const dataStart = header && rows ? 1 : 0
  const frozenData = Math.max(0, Math.min(rows, freezeRows) - dataStart)
  const fmts = []
  const aligns = []
  const wraps = []
  const widths = []
  for (let c = 0; c < cols; c++) {
    const f = m.colFormats?.[c]
    fmts.push(f && typeof f === 'object' ? f : undefined)
    const a = m.colAlign?.[c]
    aligns.push(a === 'left' || a === 'center' || a === 'right' ? a : null)
    wraps.push(!!m.wrap?.[c])
    const w = Number(m.colWidths?.[c])
    widths.push(Number.isFinite(w) && w > 0 ? Math.min(800, Math.max(48, Math.round(w))) : 0)
  }

  const cache = new Array(rows)
  const texts = new Array(rows)
  const row = r => {
    let x = cache[r]
    if (!x) {
      const s = new Array(cols)
      const k = new Array(cols)
      const head = header && r === 0
      for (let c = 0; c < cols; c++) {
        const fmt = head ? undefined : fmts[c]
        const v = ev.value(r, c)
        k[c] = kindOf(v, fmt)
        s[c] = k[c] === BLANK ? '' : ev.display(r, c, fmt)
      }
      x = cache[r] = { s, k }
    }
    return x
  }
  const rowText = r => {
    if (texts[r] === undefined) texts[r] = row(r).s.join('\n').toLowerCase()
    return texts[r]
  }
  const exportRow = r => {
    const out = new Array(cols)
    for (let c = 0; c < cols; c++) {
      const f = header && r === 0 ? undefined : fmts[c]
      out[c] = ev.display(r, c, f && (f.type === 'date' || f.type === 'text') ? f : undefined)
    }
    return out
  }

  return { ev, rows, cols, header, freezeRows, freezeCols, dataStart, frozenData, fmts, aligns, wraps, widths, row, rowText, exportRow }
}

function layoutOf(sheet, size, narrow) {
  const family = fontFamily()
  const plain = `${size.font}px ${family}`
  const bold = `700 ${size.font}px ${family}`
  const { rows, cols, header } = sheet
  const end = Math.min(rows, sheet.dataStart + MEASURE_ROWS)
  const widths = []
  const numeric = []
  for (let c = 0; c < cols; c++) {
    let nums = 0
    let others = 0
    let w = header ? textWidth(sheet.row(0).s[c] || colName(c), bold, size.font) + 20 : 36
    for (let r = header ? 1 : 0; r < end; r++) {
      const x = sheet.row(r)
      const k = x.k[c]
      if (k === NUM) nums++
      else if (k !== BLANK) others++
      if (sheet.widths[c] || k === BLANK || w >= size.max) continue
      const s = x.s[c]
      w = Math.max(w, s.length * size.font * 0.3 > size.max ? size.max : textWidth(s.replace(/\s+/g, ' '), plain, size.font))
    }
    numeric.push(nums > others)
    let width = sheet.widths[c] || Math.min(sheet.wraps[c] ? Math.min(size.max, 280) : size.max, Math.max(size.min, Math.ceil(w + size.pad * 2 + 2)))
    if (narrow && c < sheet.freezeCols) width = Math.min(width, 160)
    widths.push(width)
  }
  return { widths, numeric }
}

export default function SheetView({ text, meta, compact = false, protect = false, title, theme = 'app' }) {
  const narrow = useMediaQuery('(max-width: 640px)')
  const touchOrNarrow = useMediaQuery('(hover: none), (max-width: 640px)')
  const sheet = useMemo(() => buildSheet(text, meta), [text, meta])
  const size = compact ? SIZES.compact : narrow ? SIZES.narrow : SIZES.full
  const [fontEpoch, setFontEpoch] = useState(0)
  const layout = useMemo(() => layoutOf(sheet, size, narrow), [sheet, size, narrow, fontEpoch])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(null)
  const [page, setPage] = useState(0)
  const [tops, setTops] = useState([0])
  const [vp, setVp] = useState({ top: 0, h: 0 })
  const [rowH, setRowH] = useState(0)
  const [headH, setHeadH] = useState(0)
  const boxRef = useRef(null)
  const headRef = useRef(null)
  const bodyRef = useRef(null)
  const rafRef = useRef(0)

  const { rows, cols, header, freezeRows, freezeCols, dataStart, frozenData } = sheet
  const q = query.trim().toLowerCase()
  const total = Math.max(0, rows - dataStart)
  // Rows wrap on touch screens and in wrapped columns, so their heights
  // differ; those sheets show a page at a time instead of a scrolling window.
  const paged = touchOrNarrow || sheet.wraps.some(Boolean)

  const matched = useMemo(() => {
    const out = []
    for (let r = sheet.dataStart; r < sheet.rows; r++) if (!q || sheet.rowText(r).includes(q)) out.push(r)
    return out
  }, [sheet, q])

  const order = useMemo(() => {
    if (!sort || sort.col >= sheet.cols) return matched
    const keys = new Map()
    for (const r of matched) keys.set(r, sortKey(sheet.ev.value(r, sort.col)))
    const dir = sort.dir
    return [...matched].sort((p, r) => {
      const a = keys.get(p)
      const b = keys.get(r)
      if (a.rank === 9 || b.rank === 9) return (a.rank === 9 ? 1 : 0) - (b.rank === 9 ? 1 : 0) || p - r
      let d = a.rank - b.rank
      if (!d) d = a.rank === 1 ? COLLATOR.compare(a.v, b.v) : a.v < b.v ? -1 : a.v > b.v ? 1 : 0
      return d * dir || p - r
    })
  }, [matched, sort, sheet])

  const pinnedData = !q && !sort ? frozenData : 0
  const bodyOrder = pinnedData ? order.slice(pinnedData) : order

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0
    setPage(0)
    setVp(v => (v.top ? { ...v, top: 0 } : v))
  }, [q, sort])

  // Column widths are measured with the page font; measure again when a font finishes loading.
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : null
    if (!fonts || !fonts.addEventListener) return
    const bump = () => setFontEpoch(e => e + 1)
    fonts.addEventListener('loadingdone', bump)
    return () => fonts.removeEventListener('loadingdone', bump)
  }, [])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // Frozen rows below the first stick under the rows above them, so their
  // offsets come from the rendered heights; the body rows' height and the
  // header's are measured for the scrolling window.
  useLayoutEffect(() => {
    const trs = headRef.current?.rows
    if (trs && trs.length > 1) {
      const next = []
      let y = 0
      for (const tr of trs) { next.push(y); y += tr.getBoundingClientRect().height }
      setTops(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
    }
    const hh = headRef.current ? headRef.current.getBoundingClientRect().height : 0
    if (hh && Math.abs(hh - headH) > 0.5) setHeadH(hh)
    const real = bodyRef.current ? bodyRef.current.querySelectorAll('tr[data-r]') : []
    if (real.length > 1) {
      const a = real[0].getBoundingClientRect()
      const b = real[real.length - 1].getBoundingClientRect()
      const h = (b.bottom - a.top) / real.length
      if (h > 0 && Math.abs(h - rowH) > 0.05) setRowH(h)
    }
    const box = boxRef.current
    if (box && box.clientHeight && box.clientHeight !== vp.h) setVp(v => ({ ...v, h: box.clientHeight }))
  })

  if (!rows || !cols) {
    return (
      <div className={`ft-sv ft-sv-${theme}`} style={THEMES[theme] || THEMES.app}>
        <style>{CSS}</style>
        <p className="ft-sv-empty">This sheet is empty.</p>
      </div>
    )
  }

  const { widths, numeric } = layout
  const lefts = []
  for (let c = 0, x = 0; c < freezeCols; c++) { lefts.push(x); x += widths[c] }
  const tableWidth = widths.reduce((a, b) => a + b, 0)
  const re = q ? new RegExp(`(${escapeRe(query.trim())})`, 'gi') : null

  // The rows to render: a page, or the window in view plus a margin.
  const pages = Math.max(1, Math.ceil(bodyOrder.length / PAGE_SIZE))
  const pageNow = Math.min(page, pages - 1)
  const h = rowH || size.font * 1.45 + size.pad * 1.4
  let from = 0
  let to = bodyOrder.length
  if (paged) {
    from = pageNow * PAGE_SIZE
    to = Math.min(bodyOrder.length, from + PAGE_SIZE)
  } else {
    from = Math.max(0, Math.floor((vp.top - headH) / h) - OVERSCAN)
    to = Math.min(bodyOrder.length, from + Math.ceil((vp.h || FALLBACK_VIEW_H) / h) + OVERSCAN * 2)
  }
  const gapTop = paged ? 0 : from * h
  const gapBottom = paged ? 0 : (bodyOrder.length - to) * h

  const alignClass = (c, kind) => {
    const a = sheet.aligns[c] || (sheet.fmts[c]?.type === 'text' ? 'left' : kind === NUM ? 'right' : kind === BOOL || kind === ERR ? 'center' : 'left')
    return a === 'right' ? ' ft-sv-r' : a === 'center' ? ' ft-sv-c' : ''
  }
  const headAlign = c => alignClass(c, numeric[c] ? NUM : TEXT)
  const frozen = (c, cls, style) => {
    if (c >= freezeCols) return [cls, style]
    return [`${cls} ft-sv-fz${c === freezeCols - 1 ? ' ft-sv-edge' : ''}`, { ...style, left: lefts[c] }]
  }
  const sortState = c => (sort && sort.col === c ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none')
  const cycle = c => {
    setSort(s => (!s || s.col !== c ? { col: c, dir: 1 } : s.dir > 0 ? { col: c, dir: -1 } : null))
  }
  const sortButton = (c, label) => {
    const state = sortState(c)
    const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown
    const name = typeof label === 'string' && label ? label : `column ${colName(c)}`
    return (
      <button type="button" className="ft-sv-sort" onClick={() => cycle(c)} title={`Sort by ${name}`}>
        <span>{label}</span>
        <Icon size={13} aria-hidden="true" />
      </button>
    )
  }

  const cellProps = (r, c, s, k, cls, style) => {
    const wrap = sheet.wraps[c]
    let tip
    if (k === ERR) tip = ERROR_HELP[s]
    else if (!wrap && s.length * size.font * 0.55 > widths[c] - size.pad * 2) tip = s
    const [className, st] = frozen(c, `${cls}${alignClass(c, k)}${wrap ? ' ft-sv-wrap' : ''}${k === ERR ? ' ft-sv-err' : ''}`, style)
    return { className: className.trim() || undefined, style: st, title: tip }
  }
  // An error's meaning is in the cell for screen readers and touch screens,
  // which have no tooltip.
  const cellText = (s, k) => (k === ERR && ERROR_HELP[s]
    ? <>{s}<span className="ft-sv-why"> ({ERROR_HELP[s]})</span></>
    : re ? highlight(s, re) : s)

  const headRows = []
  if (!header) {
    headRows.push(
      <tr key="letters" aria-rowindex={1} className="ft-sv-letters">
        {Array.from({ length: cols }, (_, c) => {
          const [className, style] = frozen(c, 'ft-sv-pin ft-sv-sh ft-sv-c', { top: tops[0] || 0 })
          return <th key={c} scope="col" aria-sort={sortState(c)} className={className} style={style}>{sortButton(c, colName(c))}</th>
        })}
      </tr>,
    )
  }
  if (header) {
    const stick = freezeRows >= 1
    const style = stick ? { top: tops[headRows.length] || 0 } : undefined
    headRows.push(
      <tr key={0} aria-rowindex={headRows.length + 1}>
        {sheet.row(0).s.map((s, c) => {
          const [className, st] = frozen(c, `${stick ? 'ft-sv-pin' : ''} ft-sv-sh${headAlign(c)}${sheet.wraps[c] ? ' ft-sv-wrap' : ''}`, style)
          return (
            <th key={c} scope="col" aria-sort={sortState(c)} className={className.trim() || undefined} style={st}>
              {sortButton(c, s || <span className="ft-sv-ghost">{colName(c)}</span>)}
            </th>
          )
        })}
      </tr>,
    )
  }
  for (let i = 0; i < pinnedData; i++) {
    const r = order[i]
    const style = { top: tops[headRows.length] || 0 }
    const x = sheet.row(r)
    headRows.push(
      <tr key={r} aria-rowindex={headRows.length + 1}>
        {x.s.map((s, c) => <td key={c} {...cellProps(r, c, s, x.k[c], 'ft-sv-pin', style)}>{cellText(s, x.k[c])}</td>)}
      </tr>,
    )
  }

  const download = () => {
    const out = []
    if (header) out.push(sheet.exportRow(0))
    for (const r of order) out.push(sheet.exportRow(r))
    downloadBlob(new Blob([toCsv(out)], { type: 'text/csv;charset=utf-8' }), fileName(title))
  }

  const onScroll = (e) => {
    const box = e.currentTarget
    if (freezeCols) box.toggleAttribute('data-sx', box.scrollLeft > 0)
    if (paged || rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setVp(v => (v.top === box.scrollTop && v.h === box.clientHeight ? v : { top: box.scrollTop, h: box.clientHeight }))
    })
  }

  const onSearch = e => setQuery(e.target.value)

  const goPage = (n) => {
    setPage(n)
    if (boxRef.current) boxRef.current.scrollTop = 0
  }

  const headCount = headRows.length
  const bodyRows = []
  if (gapTop > 0) bodyRows.push(<tr key="gap-top" className="ft-sv-gap" aria-hidden="true"><td colSpan={cols} style={{ height: gapTop }} /></tr>)
  for (let i = from; i < to; i++) {
    const r = bodyOrder[i]
    const x = sheet.row(r)
    bodyRows.push(
      <tr key={r} data-r={r} aria-rowindex={headCount + i + 1} className={i % 2 ? 'ft-sv-z' : undefined}>
        {x.s.map((s, c) => <td key={c} {...cellProps(r, c, s, x.k[c], '')}>{cellText(s, x.k[c])}</td>)}
      </tr>,
    )
  }
  if (gapBottom > 0) bodyRows.push(<tr key="gap-bottom" className="ft-sv-gap" aria-hidden="true"><td colSpan={cols} style={{ height: gapBottom }} /></tr>)

  return (
    <div className={`ft-sv ft-sv-${theme} ft-sv-${compact ? 'compact' : 'full'}`} style={THEMES[theme] || THEMES.app}>
      <style>{CSS}</style>
      <div className="ft-sv-bar">
        <label className="ft-sv-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={onSearch}
            onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') } }}
            placeholder="Search rows"
            aria-label="Search rows"
            enterKeyHint="search"
          />
          {query && (
            <button type="button" className="ft-sv-x" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </label>
        <span className="ft-sv-count" role="status" aria-live="polite">
          {q ? `${matched.length.toLocaleString('en-IN')} of ${rowsLabel(total)}` : rowsLabel(total)}
        </span>
        {sort && <button type="button" className="ft-sv-btn" onClick={() => setSort(null)}>Clear sort</button>}
        {!protect && (
          <button type="button" className="ft-sv-btn ft-sv-dl" onClick={download} aria-label="Download CSV">
            <Download size={14} aria-hidden="true" />
            {compact ? 'CSV' : 'Download CSV'}
          </button>
        )}
      </div>
      <div ref={boxRef} className="ft-sv-box" style={{ maxHeight: compact ? 'min(65vh, 560px)' : '75vh' }} onScroll={onScroll}>
        <table aria-label={title || 'Spreadsheet'} aria-rowcount={headCount + bodyOrder.length} style={{ width: tableWidth }}>
          <colgroup>{widths.map((w, c) => <col key={c} style={{ width: w }} />)}</colgroup>
          <thead ref={headRef}>{headRows}</thead>
          <tbody ref={bodyRef}>
            {bodyRows}
            {!order.length && (
              <tr className="ft-sv-none">
                <td colSpan={cols}><span>{q ? `No rows match “${query.trim()}”.` : 'No rows yet.'}</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paged && pages > 1 && (
        <nav className="ft-sv-more" aria-label="Rows">
          <span>Rows {(from + pinnedData + 1).toLocaleString('en-IN')}–{(to + pinnedData).toLocaleString('en-IN')} of {(bodyOrder.length + pinnedData).toLocaleString('en-IN')}</span>
          <button type="button" className="ft-sv-btn" onClick={() => goPage(pageNow - 1)} disabled={pageNow === 0}>
            <ChevronLeft size={14} aria-hidden="true" />Previous
          </button>
          <button type="button" className="ft-sv-btn" onClick={() => goPage(pageNow + 1)} disabled={pageNow >= pages - 1}>
            Next<ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  )
}
