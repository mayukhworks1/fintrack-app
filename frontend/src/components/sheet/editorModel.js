// Pure helpers behind the sheet editor: the formatting saved in
// metadata.sheet, selection ranges, keyboard jumps, formula tidying and the
// autocomplete/point-mode rules. Nothing here touches React or the DOM.
import {
  FORMULA_FUNCTIONS, FUNCTION_HELP, isFormula, shiftFormula, fillSeries, cellName,
} from '../../utils/sheet'

export const ROW_H = 30
export const HEAD_H = 26
export const DEFAULT_COL_W = 120
export const MIN_COL_W = 48
export const MAX_COL_W = 800

const COL_MAPS = ['colWidths', 'colFormats', 'colAlign', 'wrap']
const plainObject = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const count = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d)

/**
 * Rows and columns the editor shows: the data plus blank cells past it, as
 * Excel and Sheets always have. Only cells that are written grow the grid
 * that is saved; `extra` is more blank rows the user asked to see.
 */
export function viewSize(rows, cols, extra = 0) {
  return { rows: Math.max(rows + 50, 100) + extra, cols: Math.max(cols + 5, 26) }
}

export const clampWidth = w => Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(Number(w) || DEFAULT_COL_W)))

/** metadata.sheet with every default filled in. */
export function readMeta(meta) {
  const m = plainObject(meta)
  const header = m.header !== false
  return {
    header,
    freezeRows: count(m.freezeRows, header ? 1 : 0),
    freezeCols: count(m.freezeCols, 0),
    colWidths: plainObject(m.colWidths),
    colFormats: plainObject(m.colFormats),
    colAlign: plainObject(m.colAlign),
    wrap: plainObject(m.wrap),
  }
}

/** A new metadata.sheet with `patch` applied; empty column maps are dropped. */
export function patchMeta(meta, patch) {
  const next = { ...plainObject(meta), ...patch, v: 1 }
  for (const k of COL_MAPS) if (next[k] && !Object.keys(next[k]).length) delete next[k]
  return next
}

/** Sets (or, for undefined, removes) one value for every column from c1 to c2 in a column map. */
export function setCols(map, c1, c2, value) {
  const out = { ...plainObject(map) }
  for (let c = c1; c <= c2; c++) {
    if (value === undefined) delete out[c]
    else out[c] = value
  }
  return out
}

/** Shifts every column map after inserting (delta > 0) or deleting (delta < 0) columns at `at`. */
export function shiftMetaCols(meta, at, delta, shiftColMeta) {
  if (!meta) return meta
  const patch = {}
  for (const k of COL_MAPS) if (meta[k]) patch[k] = shiftColMeta(meta[k], at, delta)
  const m = readMeta(meta)
  if (meta.freezeCols !== undefined && m.freezeCols > at) {
    patch.freezeCols = Math.max(at, m.freezeCols + delta)
  }
  return patchMeta(meta, patch)
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Selection: the anchor (ar, ac) and the opposite corner (fr, fc) of the
 * range. The active cell is the anchor unless Enter/Tab has walked it through
 * the range, in which case it is `act` ([r, c]).
 */
export const cellSel = (r, c) => ({ ar: r, ac: c, fr: r, fc: c })

export const activeOf = sel => (sel.act ? { r: sel.act[0], c: sel.act[1] } : { r: sel.ar, c: sel.ac })

export function rangeOf(sel) {
  return {
    r1: Math.min(sel.ar, sel.fr), c1: Math.min(sel.ac, sel.fc),
    r2: Math.max(sel.ar, sel.fr), c2: Math.max(sel.ac, sel.fc),
  }
}

export function clampSel(sel, rows, cols) {
  const r = v => Math.max(0, Math.min(rows - 1, v))
  const c = v => Math.max(0, Math.min(cols - 1, v))
  const out = { ar: r(sel.ar), ac: c(sel.ac), fr: r(sel.fr), fc: c(sel.fc) }
  if (sel.act) out.act = [r(sel.act[0]), c(sel.act[1])]
  return out
}

export function rangeName(rg) {
  const a = cellName(rg.r1, rg.c1)
  return rg.r1 === rg.r2 && rg.c1 === rg.c2 ? a : `${a}:${cellName(rg.r2, rg.c2)}`
}

const filled = (grid, r, c) => {
  const v = grid[r]?.[c]
  return v != null && String(v).trim() !== ''
}

/** Ctrl+arrow: the end of the current block of data, the start of the next one, or the sheet edge (rows × cols). */
export function jumpEdge(grid, r, c, dr, dc, rows = grid.length, cols = grid[0]?.length || 0) {
  const inside = (y, x) => y >= 0 && x >= 0 && y < rows && x < cols
  let y = r + dr
  let x = c + dc
  if (!inside(y, x)) return [r, c]
  if (filled(grid, r, c) && filled(grid, y, x)) {
    while (inside(y + dr, x + dc) && filled(grid, y + dr, x + dc)) { y += dr; x += dc }
    return [y, x]
  }
  while (inside(y, x) && !filled(grid, y, x)) { y += dr; x += dc }
  if (!inside(y, x)) return [y - dr, x - dc]
  return [y, x]
}

/** Bottom-right corner of the cells that hold anything (Ctrl+End). */
export function lastUsed(grid) {
  let lr = 0
  let lc = 0
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] != null) { if (r > lr) lr = r; if (c > lc) lc = c }
    }
  }
  return [lr, lc]
}

export function isBlankGrid(grid) {
  for (const row of grid) for (const v of row) if (v !== '' && v != null) return false
  return true
}

/** The grid grown (never shrunk) to at least rows × cols. */
export function ensureSize(grid, rows, cols) {
  const w = Math.max(grid[0]?.length || 0, cols)
  const out = grid.map(row => (row.length < w ? [...row, ...new Array(w - row.length).fill('')] : row))
  while (out.length < rows) out.push(new Array(w).fill(''))
  return out
}

/** Writes a block of values with its top-left corner at (r, c), growing the grid when it runs past an edge. */
export function writeBlock(grid, r, c, block) {
  const h = block.length
  const w = Math.max(0, ...block.map(row => row.length))
  const out = ensureSize(grid, r + h, c + w)
  for (let i = 0; i < h; i++) {
    const row = out[r + i] === grid[r + i] ? [...out[r + i]] : out[r + i]
    for (let j = 0; j < w; j++) row[c + j] = block[i][j] ?? ''
    out[r + i] = row
  }
  return out
}

/** Sets every cell in a range to the value produced by fn(r, c). */
export function mapRange(grid, rg, fn) {
  return grid.map((row, r) => {
    if (r < rg.r1 || r > rg.r2) return row
    const next = [...row]
    for (let c = rg.c1; c <= Math.min(rg.c2, row.length - 1); c++) next[c] = fn(r, c)
    return next
  })
}

/** Raw values of a range as rows ('' past the edge of the grid). */
export function blockOf(grid, rg) {
  const out = []
  for (let r = rg.r1; r <= rg.r2; r++) {
    const row = grid[r] || []
    const line = []
    for (let c = rg.c1; c <= rg.c2; c++) line.push(row[c] ?? '')
    out.push(line)
  }
  return out
}

/** Moves formulas in a copied block by the distance between where it came from and where it lands. */
export function shiftBlock(block, dRow, dCol) {
  if (!dRow && !dCol) return block
  return block.map(row => row.map(v => (isFormula(v) ? shiftFormula(v, dRow, dCol) : v)))
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

/**
 * Extends the selection `rg` to the cell (tr, tc) like dragging Excel's fill
 * handle: numbers, dates and "Item 1" style text continue as a series, other
 * values repeat, and copied formulas have their relative references moved.
 * The target lies outside the range on one axis only. Returns the new grid
 * and the filled range, or null when there is nothing to fill.
 */
export function fillTo(grid, rg, tr, tc) {
  const down = tr > rg.r2
  const up = tr < rg.r1
  const right = tc > rg.c2
  const left = tc < rg.c1
  if (down || up) {
    const n = down ? tr - rg.r2 : rg.r1 - tr
    const out = grid.map(row => row)
    for (let c = rg.c1; c <= rg.c2; c++) {
      const srcRows = []
      for (let r = rg.r1; r <= rg.r2; r++) srcRows.push(r)
      if (up) srcRows.reverse()
      const values = fillSeries(srcRows.map(r => grid[r][c]), n)
      for (let k = 0; k < n; k++) {
        const t = down ? rg.r2 + 1 + k : rg.r1 - 1 - k
        const s = srcRows[k % srcRows.length]
        let v = values[k]
        if (isFormula(v)) v = shiftFormula(v, t - s, 0)
        if (out[t] === grid[t]) out[t] = [...grid[t]]
        out[t][c] = v
      }
    }
    return { grid: out, range: down ? { ...rg, r2: tr } : { ...rg, r1: tr } }
  }
  if (left || right) {
    const n = right ? tc - rg.c2 : rg.c1 - tc
    const out = grid.map(row => row)
    for (let r = rg.r1; r <= rg.r2; r++) {
      const srcCols = []
      for (let c = rg.c1; c <= rg.c2; c++) srcCols.push(c)
      if (left) srcCols.reverse()
      const values = fillSeries(srcCols.map(c => grid[r][c]), n)
      const row = [...grid[r]]
      for (let k = 0; k < n; k++) {
        const t = right ? rg.c2 + 1 + k : rg.c1 - 1 - k
        const s = srcCols[k % srcCols.length]
        let v = values[k]
        if (isFormula(v)) v = shiftFormula(v, 0, t - s)
        row[t] = v
      }
      out[r] = row
    }
    return { grid: out, range: right ? { ...rg, c2: tc } : { ...rg, c1: tc } }
  }
  return null
}

/** Ctrl+D / Ctrl+R: copies the first row (or column) of the range over the rest, or the cell above (left of) a one-row range. */
export function fillCopy(grid, rg, dir) {
  const vertical = dir === 'down'
  const single = vertical ? rg.r1 === rg.r2 : rg.c1 === rg.c2
  if (single && (vertical ? rg.r1 === 0 : rg.c1 === 0)) return null
  const src = vertical ? (single ? rg.r1 - 1 : rg.r1) : (single ? rg.c1 - 1 : rg.c1)
  return mapRange(grid, rg, (r, c) => {
    if (vertical ? r === src : c === src) return grid[r][c]
    const v = vertical ? grid[src][c] : grid[r][src]
    return isFormula(v) ? shiftFormula(v, vertical ? r - src : 0, vertical ? 0 : c - src) : v
  })
}

/** Rows (or columns) the fill handle's double-click fills to: the end of the data in the neighbouring column. */
export function autoFillEnd(grid, rg) {
  const rows = grid.length
  const probe = c => {
    if (c < 0 || c >= (grid[0]?.length || 0) || !filled(grid, rg.r2 + 1, c)) return -1
    let r = rg.r2 + 1
    while (r + 1 < rows && filled(grid, r + 1, c)) r++
    return r
  }
  let end = Math.max(probe(rg.c1 - 1), probe(rg.c2 + 1))
  if (end < 0) return -1
  for (let r = rg.r2 + 1; r <= end; r++) {
    for (let c = rg.c1; c <= rg.c2; c++) if (filled(grid, r, c)) { end = r - 1; break }
    if (end < r) break
  }
  return end > rg.r2 ? end : -1
}

// ---------------------------------------------------------------------------
// AutoSum
// ---------------------------------------------------------------------------

/**
 * The numbers above (or else left of) a cell, as a range, or null: blank
 * cells next to the cell are stepped over and included, as Excel does when a
 * spacer row sits between the data and its total.
 */
export function autoSumRange(ev, r, c) {
  const isNum = (y, x) => typeof ev.value(y, x) === 'number'
  const blank = (y, x) => ev.value(y, x) === ''
  let y = r - 1
  while (y >= 0 && blank(y, c)) y--
  const top = y
  while (y >= 0 && isNum(y, c)) y--
  if (y < top) return { r1: y + 1, c1: c, r2: r - 1, c2: c }
  let x = c - 1
  while (x >= 0 && blank(r, x)) x--
  const right = x
  while (x >= 0 && isNum(r, x)) x--
  if (x < right) return { r1: r, c1: x + 1, r2: r, c2: c - 1 }
  return null
}

const PLAIN_ENTRY = /^[+-]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$|^[+-]?\.\d+$/

/**
 * A number typed into a Percent column: whole numbers such as 15 mean 15%,
 * as in Excel; values between -1 and 1, formulas and text are kept as typed.
 */
export function percentEntry(text) {
  const t = String(text ?? '').trim()
  if (!PLAIN_ENTRY.test(t)) return text
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) && Math.abs(n) >= 1 ? `${t}%` : text
}

// ---------------------------------------------------------------------------
// Formula text while editing
// ---------------------------------------------------------------------------

const REF_WORD = /^\$?[A-Za-z]{1,3}\$?\d+$/
const COL_WORD = /^\$?[A-Za-z]{1,3}$/

/** Upper-cases function names and references and closes any brackets left open, as Excel does on Enter. */
export function tidyFormula(text) {
  if (!isFormula(text)) return text
  let out = ''
  let depth = 0
  let i = 0
  const n = text.length
  const start = text.indexOf('=') + 1
  out = text.slice(0, start)
  i = start
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      for (;;) {
        const q = text.indexOf('"', j)
        if (q < 0) { j = n; break }
        if (text[q + 1] === '"') { j = q + 2; continue }
        j = q + 1
        break
      }
      out += text.slice(i, j)
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < n && /[\w.$]/.test(text[j])) j++
      const word = text.slice(i, j)
      let k = j
      while (k < n && text[k] === ' ') k++
      let p = out.length - 1
      while (p >= 0 && out[p] === ' ') p--
      const call = text[k] === '('
      const ranged = text[k] === ':' || out[p] === ':'
      const upper = call || REF_WORD.test(word) || (ranged && COL_WORD.test(word)) || /^(true|false)$/i.test(word)
      out += upper ? word.toUpperCase() : word
      i = j
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    out += ch
    i++
  }
  return depth ? out + ')'.repeat(depth) : out
}

function inString(text, upto) {
  let quotes = 0
  for (let i = 0; i < upto; i++) if (text[i] === '"') quotes++
  return quotes % 2 === 1
}

const POINT_AFTER = new Set(['=', '(', ',', '+', '-', '*', '/', '^', '&', '<', '>'])

/** True when a cell reference may be inserted at `caret` by clicking or with the arrow keys. */
export function canPoint(text, caret) {
  if (!isFormula(text) || inString(text, caret)) return false
  let p = caret - 1
  while (p >= 0 && text[p] === ' ') p--
  if (p < 0 || !POINT_AFTER.has(text[p])) return false
  let q = caret
  while (q < text.length && text[q] === ' ') q++
  return q >= text.length || /[),+\-*/^&<>=]/.test(text[q])
}

/** The partly typed function name before the caret and the functions it could be, or null. */
export function fnFragment(text, caret) {
  if (!isFormula(text) || inString(text, caret)) return null
  let s = caret
  while (s > 0 && /[A-Za-z0-9_.]/.test(text[s - 1])) s--
  const frag = text.slice(s, caret)
  if (!frag || !/^[A-Za-z]/.test(frag)) return null
  if (caret < text.length && /[A-Za-z0-9_.(]/.test(text[caret])) return null
  let p = s - 1
  while (p >= 0 && text[p] === ' ') p--
  if (p < 0 || !POINT_AFTER.has(text[p])) return null
  const up = frag.toUpperCase()
  const matches = FORMULA_FUNCTIONS.filter(name => name.startsWith(up))
  if (!matches.length || (matches.length === 1 && matches[0] === up && REF_WORD.test(frag))) return null
  return { start: s, end: caret, frag, matches: matches.slice(0, 8) }
}

/** The innermost function call the caret is inside and which argument it is on, or null. */
export function fnContext(text, caret) {
  if (!isFormula(text)) return null
  const stack = []
  let i = text.indexOf('=') + 1
  while (i < caret) {
    const ch = text[i]
    if (ch === '"') {
      const q = text.indexOf('"', i + 1)
      if (q < 0 || q >= caret) return null
      i = q + 1
      continue
    }
    if (ch === '(') {
      let p = i - 1
      while (p >= 0 && text[p] === ' ') p--
      let s = p + 1
      while (s > 0 && /[A-Za-z0-9_.]/.test(text[s - 1])) s--
      stack.push({ name: text.slice(s, p + 1).toUpperCase(), arg: 0 })
    } else if (ch === ')') stack.pop()
    else if (ch === ',' && stack.length) stack[stack.length - 1].arg++
    i++
  }
  for (let k = stack.length - 1; k >= 0; k--) if (FUNCTION_HELP[stack[k].name]) return stack[k]
  return null
}

/** Splits "SUMIF(range, criteria, [sum_range])" into its name and argument labels. */
export function splitSignature(sig) {
  const open = sig.indexOf('(')
  const inner = sig.slice(open + 1, sig.lastIndexOf(')'))
  const args = []
  let depth = 0
  let from = 0
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '[') depth++
    else if (inner[i] === ']') depth--
    else if (inner[i] === ',' && !depth) { args.push(inner.slice(from, i).trim()); from = i + 1 }
  }
  if (inner.trim()) args.push(inner.slice(from).trim())
  return { name: sig.slice(0, open), args }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

/** Sum, count of numbers and count of non-empty cells over a range. */
export function rangeStats(ev, rg) {
  let sum = 0
  let nums = 0
  let filledCount = 0
  for (let r = rg.r1; r <= rg.r2; r++) {
    for (let c = rg.c1; c <= rg.c2; c++) {
      const v = ev.value(r, c)
      if (v === '' || v === null || v === undefined) continue
      filledCount++
      if (typeof v === 'number') { sum += v; nums++ }
    }
  }
  return { sum, nums, count: filledCount }
}

/** Decimal places currently shown for a value (for the decimals −/+ buttons). */
export function shownDecimals(display) {
  const m = /\.(\d+)/.exec(String(display || '').replace(/[^\d.]/g, ''))
  return m ? m[1].length : 0
}

