// ---------------------------------------------------------------------------
// Spreadsheet engine shared by the Pages sheet editor and the public viewer:
// RFC 4180 CSV and clipboard TSV, A1 addresses, an Excel-style formula
// evaluator, number and date formats, and the pure grid edits the editor
// applies (insert, delete, sort, fill). No eval, no dependencies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CSV and clipboard text
// ---------------------------------------------------------------------------

const blankGrid = () => [['', '', ''], ['', '', ''], ['', '', '']]
const CSV_QUOTE = /[",\r\n]|^\s|\s$/

/** Parses CSV (RFC 4180) into rows: unquoted fields trimmed, quoted kept exactly, blank rows kept, trailing empty lines dropped. */
export function parseCSV(text) {
  const s = String(text ?? '').replace(/^﻿/, '')
  const n = s.length
  const rows = []
  let kept = 0
  let i = 0
  while (i < n) {
    const row = []
    let blank = true
    for (;;) {
      while (i < n && (s[i] === ' ' || s[i] === '\t')) i++
      let field = ''
      if (s[i] === '"') {
        blank = false
        let j = i + 1
        for (;;) {
          const q = s.indexOf('"', j)
          if (q < 0) { field += s.slice(j); j = n; break }
          field += s.slice(j, q)
          if (s[q + 1] === '"') { field += '"'; j = q + 2 } else { j = q + 1; break }
        }
        let k = j
        while (k < n && s[k] !== ',' && s[k] !== '\n' && s[k] !== '\r') k++
        field += s.slice(j, k).trim()
        i = k
      } else {
        let k = i
        while (k < n && s[k] !== ',' && s[k] !== '\n' && s[k] !== '\r') k++
        field = s.slice(i, k).trim()
        if (field) blank = false
        i = k
      }
      row.push(field)
      if (s[i] === ',') { blank = false; i++; continue }
      break
    }
    if (s[i] === '\r' && s[i + 1] === '\n') i += 2
    else if (i < n) i++
    if (blank && !rows.length) continue
    rows.push(row)
    if (!blank) kept = rows.length
  }
  rows.length = kept
  return rows
}

function csvField(cell) {
  const s = cell == null ? '' : String(cell)
  return CSV_QUOTE.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialises rows as CSV, quoting fields with commas, quotes, line breaks or edge spaces; blank rows survive a round trip. */
export function toCSV(grid) {
  return (grid || []).map(row => {
    const line = (row || []).map(csvField).join(',')
    return line === '' ? '""' : line
  }).join('\n')
}

/** Parses CSV into a rectangular grid; empty text gives a blank 3×3 grid. */
export function csvToGrid(text) {
  const rows = parseCSV(text)
  if (!rows.length) return blankGrid()
  let cols = 1
  for (const r of rows) if (r.length > cols) cols = r.length
  for (const r of rows) while (r.length < cols) r.push('')
  return rows
}

/** Serialises a grid as CSV (same as toCSV). */
export function gridToCSV(grid) {
  return toCSV(grid)
}

/** Parses a single CSV line into fields (kept for older callers). */
export function parseLine(line) {
  return parseCSV(line)[0] || ['']
}

/** Parses clipboard text from Excel or Google Sheets (tabs, line breaks, quoted multi-line cells) into a rectangular grid. */
export function parseTSV(text) {
  let s = String(text ?? '')
  if (!s) return []
  if (s.endsWith('\r\n')) s = s.slice(0, -2)
  else if (s.endsWith('\n') || s.endsWith('\r')) s = s.slice(0, -1)
  const n = s.length
  const rows = []
  let row = []
  let i = 0
  for (;;) {
    let field
    if (s[i] === '"') {
      let j = i + 1
      let quoted = ''
      for (;;) {
        const q = s.indexOf('"', j)
        if (q < 0) break
        quoted += s.slice(j, q)
        if (s[q + 1] === '"') { quoted += '"'; j = q + 2; continue }
        const next = s[q + 1]
        if (q + 1 >= n || next === '\t' || next === '\n' || next === '\r') { field = quoted; i = q + 1 }
        break
      }
    }
    if (field === undefined) {
      let k = i
      while (k < n && s[k] !== '\t' && s[k] !== '\n' && s[k] !== '\r') k++
      field = s.slice(i, k)
      i = k
    }
    row.push(field)
    if (i >= n) { rows.push(row); break }
    if (s[i] === '\t') { i++; continue }
    rows.push(row)
    row = []
    i += s[i] === '\r' && s[i + 1] === '\n' ? 2 : 1
  }
  let cols = 1
  for (const r of rows) if (r.length > cols) cols = r.length
  for (const r of rows) while (r.length < cols) r.push('')
  return rows
}

/** Serialises a grid as tab-separated clipboard text, quoting cells with tabs, line breaks or a leading quote. */
export function toTSV(grid) {
  return (grid || []).map(row => (row || []).map(cell => {
    const s = cell == null ? '' : String(cell)
    return /[\t\r\n]/.test(s) || s[0] === '"' ? `"${s.replace(/"/g, '""')}"` : s
  }).join('\t')).join('\n')
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** Column letters for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function colName(i) {
  let n = Math.floor(i) + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0-based column index for letters (A → 0, AA → 26), or -1 when they are not letters. */
export function colIndex(name) {
  const s = String(name ?? '').trim().toUpperCase()
  if (!/^[A-Z]+$/.test(s)) return -1
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64)
  return n - 1
}

/** A1-style name for a 0-based row and column: (2, 1) → "B3". */
export function cellName(r, c) {
  return colName(c) + (r + 1)
}

const REF_TEXT = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/

/** Parses "B3", "$B$3" or "B$3" into { r, c, absR, absC } (0-based), or null. */
export function parseRef(str) {
  const m = REF_TEXT.exec(String(str ?? '').trim())
  if (!m) return null
  const r = Number(m[4]) - 1
  if (r < 0) return null
  return { r, c: colIndex(m[2]), absR: m[3] === '$', absC: m[1] === '$' }
}

/** Parses "B2:D9" (or a single cell) into a normalised { r1, c1, r2, c2 }; whole columns/rows ("A:C", "2:4") need size { rows, cols }. */
export function parseRange(str, size) {
  const s = String(str ?? '').trim()
  const parts = s.split(':')
  if (parts.length === 1) {
    const p = parseRef(s)
    return p && { r1: p.r, c1: p.c, r2: p.r, c2: p.c }
  }
  if (parts.length !== 2) return null
  const a = parseRef(parts[0])
  const b = parseRef(parts[1])
  if (a && b) return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }
  if (!size) return null
  const [x, y] = parts.map(p => p.trim().replace(/\$/g, ''))
  if (/^[A-Za-z]{1,3}$/.test(x) && /^[A-Za-z]{1,3}$/.test(y)) {
    const c1 = colIndex(x)
    const c2 = colIndex(y)
    return { r1: 0, c1: Math.min(c1, c2), r2: Math.max(0, size.rows - 1), c2: Math.max(c1, c2) }
  }
  if (/^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) > 0 && Number(y) > 0) {
    const r1 = Number(x) - 1
    const r2 = Number(y) - 1
    return { r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: Math.max(0, size.cols - 1) }
  }
  return null
}

// ---------------------------------------------------------------------------
// Errors, numbers and dates
// ---------------------------------------------------------------------------

class SheetError {
  constructor(code) { this.code = code }
  toString() { return this.code }
}

const E = {
  DIV0: new SheetError('#DIV/0!'),
  REF: new SheetError('#REF!'),
  NAME: new SheetError('#NAME?'),
  VALUE: new SheetError('#VALUE!'),
  NA: new SheetError('#N/A'),
  CIRC: new SheetError('#CIRC!'),
  ERROR: new SheetError('#ERROR!'),
}
const ERROR_BY_CODE = Object.fromEntries(Object.values(E).map(e => [e.code, e]))

/** What each formula error means, for tooltips. */
export const ERROR_HELP = {
  '#DIV/0!': 'Division by zero.',
  '#REF!': 'Refers to a cell that no longer exists.',
  '#NAME?': 'Unknown function or name.',
  '#VALUE!': 'Wrong kind of value, such as text where a number is needed.',
  '#N/A': 'Value not found.',
  '#CIRC!': 'Circular reference: the formula depends on its own result.',
  '#ERROR!': 'The formula could not be read. Check brackets, commas and quotes.',
}

/** True for a formula error value such as "#DIV/0!". */
export function isErrorValue(v) {
  return v instanceof SheetError || (typeof v === 'string' && Object.prototype.hasOwnProperty.call(ERROR_BY_CODE, v))
}

/** True when a raw cell holds a formula (first non-space character is "="). */
export function isFormula(raw) {
  if (typeof raw !== 'string') return false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i)
    if (ch === 61) return true
    if (ch > 32) return false
  }
  return false
}

function formulaStart(raw) {
  return raw.indexOf('=') + 1
}

const PLAIN_NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const UNSIGNED_NUM = /^(?:\d+\.?\d*|\.\d+)$/
const GROUPED_NUM = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d*)?$/
const CURRENCY = /^(?:₹|\$|€|£|rs\.?|inr)\s*/i

/** Number for a value or numeric text ("1,20,000", "₹1,200", "12%", "(500)"), or null when it is not a number. */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s) return null
  if (PLAIN_NUM.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  let neg = false
  let pct = false
  if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1).trim() }
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim() }
  let signed = false
  if (s[0] === '-' || s[0] === '+') { signed = true; if (s[0] === '-') neg = !neg; s = s.slice(1).trim() }
  const cur = CURRENCY.exec(s)
  if (cur) {
    s = s.slice(cur[0].length)
    if (!signed && (s[0] === '-' || s[0] === '+')) { if (s[0] === '-') neg = !neg; s = s.slice(1).trim() }
  }
  let n
  if (UNSIGNED_NUM.test(s)) n = Number(s)
  else if (GROUPED_NUM.test(s)) n = Number(s.replace(/,/g, ''))
  else return null
  if (!Number.isFinite(n)) return null
  if (neg) n = -n
  if (pct) n /= 100
  return n
}

/** True for a finite number or text that toNumber reads as one. */
export function isNumeric(v) {
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && toNumber(v) !== null
}

const DAY_MS = 86400000
const EPOCH = Date.UTC(1899, 11, 30)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MAX_SERIAL = 2958465
const pad2 = n => String(n).padStart(2, '0')

function serialOf(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS)
}
function ymdOf(serial) {
  const t = new Date(EPOCH + Math.floor(serial) * DAY_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
function daysIn(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function addMonths(serial, months, toMonthEnd) {
  const { y, m, d } = ymdOf(serial)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 + 1
  const last = daysIn(ny, nm)
  return serialOf(ny, nm, toMonthEnd ? last : Math.min(d, last))
}
function monthOf(word) {
  const w = word.toLowerCase().replace(/\.$/, '')
  const i = MONTHS.findIndex(m => m.toLowerCase() === w.slice(0, 3))
  if (i < 0) return 0
  return MONTHS_LONG[i].toLowerCase().startsWith(w) || w === 'sept' ? i + 1 : 0
}

const D_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const D_DMY = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/
const D_DMONY = /^(\d{1,2})(?:st|nd|rd|th)?([\s-]+)([A-Za-z]{3,9}\.?),?[\s-]+(\d{4})$/
const D_MONDY = /^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/

function parseDateText(s) {
  if (s.length < 6 || s.length > 40) return null
  let m
  let y
  let mo
  let d
  let frac = 0
  let style
  if ((m = D_ISO.exec(s))) {
    y = +m[1]; mo = +m[2]; d = +m[3]
    if (m[4] !== undefined) {
      if (+m[4] > 23 || +m[5] > 59) return null
      frac = (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400
    }
    style = { kind: 'iso' }
  } else if ((m = D_DMY.exec(s))) {
    d = +m[1]; mo = +m[3]; y = +m[4]
    if (m[4].length === 2) {
      if (m[2] === '.') return null
      y += y < 30 ? 2000 : 1900
    }
    style = { kind: 'dmy', sep: m[2], padD: m[1].length === 2, padM: m[3].length === 2, short: m[4].length === 2 }
  } else if ((m = D_DMONY.exec(s))) {
    d = +m[1]; mo = monthOf(m[3]); y = +m[4]
    const word = m[3].replace(/\.$/, '')
    style = { kind: 'dmony', sep: m[2].includes('-') ? '-' : ' ', padD: m[1].length === 2, long: word.length > 3 && word.toLowerCase() !== 'sept', upper: word === word.toUpperCase() }
  } else if ((m = D_MONDY.exec(s))) {
    mo = monthOf(m[1]); d = +m[2]; y = +m[3]
    style = { kind: 'mondy' }
  } else return null
  if (!mo || mo > 12 || d < 1 || y < 1900 || y > 9999 || d > daysIn(y, mo)) return null
  return { serial: serialOf(y, mo, d) + frac, style }
}

/** Excel serial date (days since 1899-12-30) for a serial number or date text ("2026-10-15", "15/10/2026", "15 Oct 2026"), else null. */
export function dateSerial(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof Date) return isNaN(v) ? null : serialOf(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v !== 'string') return null
  const p = parseDateText(v.trim())
  return p ? p.serial : null
}

/** Formats an Excel serial date as "15 Oct 2026". */
export function formatDate(serial) {
  if (!(serial >= 0 && serial <= MAX_SERIAL)) return general(serial)
  const { y, m, d } = ymdOf(serial)
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`
}

function general(n) {
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return String(n)
  return String(Math.round(n * 1e10) / 1e10)
}

function roundTo(x, digits, mode) {
  const d = Math.trunc(digits) || 0
  const sign = x < 0 ? -1 : 1
  const a = Number(Math.abs(x).toPrecision(15))
  const f = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round
  const s = String(a)
  let r = s.includes('e') ? NaN : Number(f(Number(s + 'e' + d)) + 'e' + -d)
  if (!Number.isFinite(r)) { const p = Math.pow(10, d); r = f(a * p) / p }
  return sign * r
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/** Column formats offered by the editor. */
export const FORMATS = [
  { type: 'auto', label: 'Auto' },
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'inr', label: 'Indian rupee (₹)' },
  { type: 'percent', label: 'Percent' },
  { type: 'date', label: 'Date' },
]
const NUMERIC_FORMATS = new Set(['number', 'inr', 'percent'])
const NUMBER_FORMATS = new Map()

function numberFormat(min, max) {
  const key = min * 10 + max
  let f = NUMBER_FORMATS.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max })
    NUMBER_FORMATS.set(key, f)
  }
  return f
}

function decimalsOf(fmt) {
  const d = fmt && fmt.decimals
  return Number.isFinite(d) ? Math.min(6, Math.max(0, Math.round(d))) : undefined
}

/** Formats a value for a column format { type, decimals }: ₹ and number use Indian grouping, percent shows ×100, date shows "15 Oct 2026"; errors and text pass through. */
export function formatValue(value, fmt) {
  if (value instanceof SheetError) return value.code
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const type = fmt && fmt.type
  if (typeof value === 'string' && isErrorValue(value)) return value
  if (type === 'date') {
    const s = dateSerial(value)
    return s === null ? String(value) : formatDate(s)
  }
  if (!NUMERIC_FORMATS.has(type)) return typeof value === 'number' ? general(value) : String(value)
  const n = toNumber(value)
  if (n === null) return String(value)
  const dec = decimalsOf(fmt)
  if (type === 'inr') {
    const d = dec ?? 2
    const v = roundTo(n, d) || 0
    return (v < 0 ? '-₹' : '₹') + numberFormat(d, d).format(Math.abs(v))
  }
  if (type === 'percent') return numberFormat(dec ?? 0, dec ?? 2).format(roundTo(n * 100, dec ?? 2) || 0) + '%'
  return numberFormat(dec ?? 0, dec ?? 2).format(roundTo(n, dec ?? 2) || 0)
}

// ---------------------------------------------------------------------------
// Formula tokens and parsing
// ---------------------------------------------------------------------------

const RX = {
  str: /"((?:[^"]|"")*)"/y,
  err: /#(?:DIV\/0!|REF!|NAME\?|VALUE!|N\/A|CIRC!|ERROR!)/iy,
  cells: /(\$?)([A-Za-z]{1,3})(\$?)(\d+)\s*:\s*(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w.(])/y,
  cols: /(\$?)([A-Za-z]{1,3})\s*:\s*(\$?)([A-Za-z]{1,3})(?![\w.(])/y,
  rows: /(\$?)(\d+)\s*:\s*(\$?)(\d+)(?![\w.(])/y,
  func: /([A-Za-z_][\w.]*)\s*\(/y,
  ref: /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w.(])/y,
  bool: /(TRUE|FALSE)(?![\w.(])/iy,
  num: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y,
  name: /[A-Za-z_][\w.]*/y,
  op: /<>|<=|>=|[-+*/^&=<>%]/y,
}
const LETTER_KINDS = ['cells', 'cols', 'func', 'ref', 'bool', 'name']
const DOLLAR_KINDS = ['cells', 'cols', 'rows', 'ref']
const DIGIT_KINDS = ['rows', 'num']

function makeToken(kind, m, s, e) {
  switch (kind) {
    case 'str': return { t: 'str', s, e, v: m[1].replace(/""/g, '"') }
    case 'err': return { t: 'err', s, e, v: m[0].toUpperCase() }
    case 'cells': {
      const a = { absC: m[1] === '$', c: colIndex(m[2]), absR: m[3] === '$', r: Number(m[4]) - 1 }
      const b = { absC: m[5] === '$', c: colIndex(m[6]), absR: m[7] === '$', r: Number(m[8]) - 1 }
      return a.r < 0 || b.r < 0 ? null : { t: 'range', kind: 'cells', s, e, a, b }
    }
    case 'cols': return { t: 'range', kind: 'cols', s, e, a: { absC: m[1] === '$', c: colIndex(m[2]) }, b: { absC: m[3] === '$', c: colIndex(m[4]) } }
    case 'rows': {
      const a = { absR: m[1] === '$', r: Number(m[2]) - 1 }
      const b = { absR: m[3] === '$', r: Number(m[4]) - 1 }
      return a.r < 0 || b.r < 0 ? null : { t: 'range', kind: 'rows', s, e, a, b }
    }
    case 'func': return { t: 'func', s, e, v: m[1].toUpperCase() }
    case 'ref': {
      const r = Number(m[4]) - 1
      return r < 0 ? { t: 'name', s, e, v: m[0] } : { t: 'ref', s, e, r, c: colIndex(m[2]), absR: m[3] === '$', absC: m[1] === '$' }
    }
    case 'bool': return { t: 'bool', s, e, v: m[1].toUpperCase() === 'TRUE' }
    case 'num': return { t: 'num', s, e, v: Number(m[0]) }
    case 'name': return { t: 'name', s, e, v: m[0] }
    default: return { t: 'op', s, e, v: m[0] }
  }
}

function tokenize(src, from, lenient) {
  const out = []
  const n = src.length
  let i = from
  outer: while (i < n) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '(' || ch === ')' || ch === ',') { out.push({ t: ch, s: i, e: i + 1 }); i++; continue }
    const kinds = ch === '"' ? ['str']
      : ch === '#' ? ['err']
        : ch === '$' ? DOLLAR_KINDS
          : /[A-Za-z_]/.test(ch) ? LETTER_KINDS
            : /[\d.]/.test(ch) ? DIGIT_KINDS
              : ['op']
    for (const kind of kinds) {
      const re = RX[kind]
      re.lastIndex = i
      const m = re.exec(src)
      if (!m) continue
      const tok = makeToken(kind, m, i, re.lastIndex)
      if (!tok) continue
      out.push(tok)
      i = re.lastIndex
      continue outer
    }
    if (!lenient) throw new SyntaxError('formula')
    if (ch === '"') break
    i++
  }
  return out
}

function rangeBox(t) {
  if (t.kind === 'cols') return { r1: 0, c1: Math.min(t.a.c, t.b.c), r2: Infinity, c2: Math.max(t.a.c, t.b.c) }
  if (t.kind === 'rows') return { r1: Math.min(t.a.r, t.b.r), c1: 0, r2: Math.max(t.a.r, t.b.r), c2: Infinity }
  return { r1: Math.min(t.a.r, t.b.r), c1: Math.min(t.a.c, t.b.c), r2: Math.max(t.a.r, t.b.r), c2: Math.max(t.a.c, t.b.c) }
}

const CMP_OPS = ['=', '<>', '<', '>', '<=', '>=']
const ADD_OPS = ['+', '-']
const MUL_OPS = ['*', '/', '%']
const OPERAND_TOKENS = new Set(['num', 'str', 'bool', 'ref', 'range', 'func', 'name', 'err', '('])
const EMPTY_ARG = Object.freeze({ k: 'empty' })

function buildAst(tokens) {
  let i = 0
  const deps = []
  const fail = () => { throw new SyntaxError('formula') }
  const isOp = (t, ops) => t !== undefined && t.t === 'op' && ops.includes(t.v)
  const binaryLevel = (ops, next) => () => {
    let a = next()
    while (isOp(tokens[i], ops)) {
      const op = tokens[i++].v
      a = { k: 'bin', op, a, b: next() }
    }
    return a
  }
  const primary = () => {
    const tok = tokens[i++]
    if (!tok) fail()
    switch (tok.t) {
      case 'num': case 'str': case 'bool': return { k: 'lit', v: tok.v }
      case 'err': return { k: 'err', v: ERROR_BY_CODE[tok.v] || E.ERROR }
      case 'name': return { k: 'name', v: tok.v }
      case 'ref': { const n = { k: 'ref', r: tok.r, c: tok.c }; deps.push(n); return n }
      case 'range': { const n = { k: 'range', ...rangeBox(tok) }; deps.push(n); return n }
      case '(': {
        const e = comparison()
        if (!tokens[i] || tokens[i].t !== ')') fail()
        i++
        return e
      }
      case 'func': {
        const args = []
        if (tokens[i] && tokens[i].t === ')') { i++ } else {
          for (;;) {
            const t = tokens[i]
            args.push(t && (t.t === ',' || t.t === ')') ? EMPTY_ARG : comparison())
            const sep = tokens[i++]
            if (!sep) fail()
            if (sep.t === ')') break
            if (sep.t !== ',') fail()
          }
        }
        return { k: 'fn', name: tok.v, fn: FNS[tok.v], args }
      }
      default: return fail()
    }
  }
  const unary = () => {
    if (isOp(tokens[i], ['-'])) { i++; return { k: 'neg', a: unary() } }
    if (isOp(tokens[i], ['+'])) { i++; return unary() }
    return primary()
  }
  const postfix = () => {
    let a = unary()
    while (isOp(tokens[i], ['%']) && !(tokens[i + 1] && OPERAND_TOKENS.has(tokens[i + 1].t))) { i++; a = { k: 'pct', a } }
    return a
  }
  const power = binaryLevel(['^'], postfix)
  const multiplicative = binaryLevel(MUL_OPS, power)
  const additive = binaryLevel(ADD_OPS, multiplicative)
  const concat = binaryLevel(['&'], additive)
  const comparison = binaryLevel(CMP_OPS, concat)
  const ast = comparison()
  if (i !== tokens.length) fail()
  return { ast, deps }
}

const PARSED = new Map()
const UNPARSABLE = Object.freeze({ ast: null, deps: null })

function parseFormula(raw) {
  let p = PARSED.get(raw)
  if (p) return p
  try { p = buildAst(tokenize(raw, formulaStart(raw), false)) } catch { p = UNPARSABLE }
  if (PARSED.size >= 20000) PARSED.clear()
  PARSED.set(raw, p)
  return p
}

/** Cell and range references in a formula with their text positions, for colouring them while editing (whole columns/rows use Infinity). */
export function formulaRefs(formula) {
  if (!isFormula(formula)) return []
  return tokenize(formula, formulaStart(formula), true)
    .filter(t => t.t === 'ref' || t.t === 'range')
    .map(t => ({
      start: t.s,
      end: t.e,
      text: formula.slice(t.s, t.e),
      ...(t.t === 'ref' ? { r1: t.r, c1: t.c, r2: t.r, c2: t.c } : rangeBox(t)),
    }))
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function literal(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'boolean') return raw
  const s = String(raw)
  const t = s.trim()
  if (!t) return null
  const n = toNumber(t)
  if (n !== null) return n
  const u = t.toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return s
}

function textLiteral(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw)
  return s.trim() ? s : null
}

function num(v) {
  if (typeof v === 'number') return v
  if (v === null || v === '') return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = toNumber(v)
  if (n !== null) return n
  const d = dateSerial(v)
  if (d !== null) return d
  throw E.VALUE
}

function text(v) {
  if (typeof v === 'string') return v
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return general(v)
}

function truth(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null || v === '') return false
  const u = String(v).trim().toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  throw E.VALUE
}

function serialArg(v) {
  if (typeof v === 'number') return v
  if (v === null) return 0
  if (typeof v === 'string') {
    const d = dateSerial(v)
    if (d !== null) return d
    const n = toNumber(v)
    if (n !== null) return n
  }
  throw E.VALUE
}

function finite(n) {
  if (Number.isFinite(n)) return n
  throw E.VALUE
}

function rank(v) {
  return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2
}

function compare(a, b) {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 1) {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (ra === 2) return (a ? 1 : 0) - (b ? 1 : 0)
  if (Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b))) return 0
  return a < b ? -1 : 1
}

function relate(op, d) {
  switch (op) {
    case '=': return d === 0
    case '<>': return d !== 0
    case '<': return d < 0
    case '>': return d > 0
    case '<=': return d <= 0
    default: return d >= 0
  }
}

function binary(op, a, b) {
  switch (op) {
    case '+': return finite(num(a) + num(b))
    case '-': return finite(num(a) - num(b))
    case '*': return finite(num(a) * num(b))
    case '/': {
      const x = num(a)
      const y = num(b)
      if (y === 0) throw E.DIV0
      return finite(x / y)
    }
    case '%': {
      const x = num(a)
      const y = num(b)
      if (y === 0) throw E.DIV0
      return finite(x % y)
    }
    case '^': {
      const x = num(a)
      const y = num(b)
      if (x === 0 && y < 0) throw E.DIV0
      return finite(Math.pow(x, y))
    }
    case '&': return text(a) + text(b)
    default: {
      let x = a
      let y = b
      if (typeof x === 'string' || typeof y === 'string') {
        const dx = typeof x === 'string' ? dateSerial(x) : null
        const dy = typeof y === 'string' ? dateSerial(y) : null
        if (dx !== null && (typeof y === 'number' || dy !== null)) x = dx
        if (dy !== null && (typeof a === 'number' || dx !== null)) y = dy
      }
      return relate(op, compare(x, y))
    }
  }
}

const ARITH_OPS = new Set(['+', '-', '*', '/', '%', '^'])

// Arithmetic on a cell holding text such as "-", "NA" or "TBD" reads it as 0,
// as sheets saved before this engine always did; text typed into the formula
// itself ("abc"+1) is still #VALUE!.
function loose(node, v) {
  return node.k === 'ref' && typeof v === 'string' && toNumber(v) === null && dateSerial(v) === null ? 0 : v
}

function wildcard(pattern) {
  let s = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1])) {
      s += pattern[++i].replace(/[*?]/, '\\$&')
      continue
    }
    s += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp('^' + s + '$', 'i')
}

function matcher(key, wild) {
  if (typeof key === 'string') {
    if (wild && /[*?~]/.test(key)) {
      const re = wildcard(key)
      return v => typeof v === 'string' && re.test(v)
    }
    const k = key.toLowerCase()
    return v => typeof v === 'string' && v.toLowerCase() === k
  }
  if (typeof key === 'number') return v => typeof v === 'number' && compare(v, key) === 0
  return v => v === key
}

const CRITERIA_OP = /^(<>|<=|>=|=|<|>)/

function criteria(c) {
  if (typeof c === 'number') return v => typeof v === 'number' && compare(v, c) === 0
  if (typeof c === 'boolean') return v => v === c
  const raw = c === null ? '' : String(c)
  const m = CRITERIA_OP.exec(raw)
  const op = m ? m[1] : '='
  const rhs = m ? raw.slice(op.length) : raw
  if (rhs.trim() !== '') {
    const n = toNumber(rhs)
    if (n !== null) {
      return v => {
        const x = typeof v === 'number' ? v : typeof v === 'string' ? toNumber(v) ?? dateSerial(v) : null
        return x === null ? op === '<>' : relate(op, compare(x, n))
      }
    }
    const d = dateSerial(rhs)
    if (d !== null) {
      return v => {
        const x = typeof v === 'number' ? v : typeof v === 'string' ? dateSerial(v) : null
        return x === null ? op === '<>' : relate(op, compare(x, d))
      }
    }
    const u = rhs.trim().toUpperCase()
    if (u === 'TRUE' || u === 'FALSE') {
      const b = u === 'TRUE'
      return v => (op === '=' ? v === b : op === '<>' ? v !== b : false)
    }
  }
  if (op === '=' || op === '<>') {
    let eq
    if (rhs === '') eq = v => v === null || v === ''
    else if (/[*?~]/.test(rhs)) {
      const re = wildcard(rhs)
      eq = v => typeof v === 'string' && re.test(v)
    } else {
      const k = rhs.toLowerCase()
      eq = v => typeof v === 'string' && v.toLowerCase() === k
    }
    return op === '=' ? eq : v => !eq(v)
  }
  const k = rhs.toLowerCase()
  return v => typeof v === 'string' && v !== '' && relate(op, compare(v.toLowerCase(), k))
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

const FNS = Object.create(null)

/** Signature and one-line description for every formula function. */
export const FUNCTION_HELP = {}

function define(name, min, max, sig, desc, run) {
  FNS[name] = { min, max, run }
  FUNCTION_HELP[name] = { sig, desc }
}

const has = (a, i) => a.length > i && a[i].k !== 'empty'
const numArg = (a, i, x, def) => (has(a, i) ? num(x.ev(a[i])) : def)
const dateArg = (a, i, x) => {
  const s = serialArg(x.ev(a[i]))
  if (s < 0 || s > MAX_SERIAL) throw E.VALUE
  return s
}
function areaArg(a, i, x) {
  const ar = a[i] && x.area(a[i])
  if (!ar) throw E.VALUE
  return ar
}
function ok(v) {
  if (v instanceof SheetError) throw v
  return v
}
function attempt(x, node) {
  try { return x.ev(node) } catch (e) {
    if (e instanceof SheetError) return e
    throw e
  }
}

// Numbers in the arguments; with `dates`, date text in a range counts as its
// serial, so MIN and MAX work on a column of typed dates.
function eachNumber(a, x, fn, dates = false) {
  for (const node of a) {
    if (node.k === 'empty') continue
    const ar = x.area(node)
    if (ar) {
      x.scan(ar, v => {
        if (typeof v === 'number') fn(v)
        else if (v instanceof SheetError) throw v
        else if (dates && typeof v === 'string') {
          const d = dateSerial(v)
          if (d !== null) fn(d)
        }
      })
      continue
    }
    const v = x.ev(node)
    if (v !== null) fn(num(v))
  }
}

function eachText(a, x, fn) {
  for (const node of a) {
    if (node.k === 'empty') continue
    const ar = x.area(node)
    if (ar) x.scan(ar, v => fn(text(ok(v))))
    else fn(text(x.ev(node)))
  }
}

function eachLogical(a, x, fn) {
  let seen = 0
  for (const node of a) {
    if (node.k === 'empty') continue
    const ar = x.area(node)
    if (ar) {
      x.scan(ar, v => {
        if (v instanceof SheetError) throw v
        if (typeof v === 'boolean' || typeof v === 'number') { seen++; fn(truth(v)) }
      })
      continue
    }
    seen++
    fn(truth(x.ev(node)))
  }
  if (!seen) throw E.VALUE
}

function vector(ar, x) {
  const h = ar.r2 - ar.r1 + 1
  const w = ar.c2 - ar.c1 + 1
  if (h !== 1 && w !== 1) throw E.NA
  if (w === 1) return { vertical: true, len: h, n: Math.min(h, Math.max(0, x.rows - ar.r1)), get: i => x.cell(ar.r1 + i, ar.c1) }
  return { vertical: false, len: w, n: Math.min(w, Math.max(0, x.cols - ar.c1)), get: i => x.cell(ar.r1, ar.c1 + i) }
}

function exactIndex(get, n, key, wild) {
  const test = matcher(key, wild)
  for (let i = 0; i < n; i++) if (test(get(i))) return i
  return -1
}

function sortedIndex(get, n, key, dir) {
  let hit = -1
  for (let i = 0; i < n; i++) {
    const v = get(i)
    if (v === null || v instanceof SheetError || typeof v !== typeof key) continue
    const d = compare(v, key)
    if (dir > 0 ? d <= 0 : d >= 0) hit = i
    else break
  }
  return hit
}

function nearestIndex(get, n, key, dir) {
  let best = -1
  let bestV
  for (let i = 0; i < n; i++) {
    const v = get(i)
    if (v === null || v instanceof SheetError || typeof v !== typeof key) continue
    const d = compare(v, key)
    if (d === 0) return i
    if ((dir < 0 && d < 0 && (best < 0 || compare(v, bestV) > 0)) || (dir > 0 && d > 0 && (best < 0 || compare(v, bestV) < 0))) {
      best = i
      bestV = v
    }
  }
  return best
}

function conditions(a, x, from, shape) {
  const tests = []
  for (let i = from; i < a.length; i += 2) {
    const ar = areaArg(a, i, x)
    if (shape && (ar.r2 - ar.r1 !== shape.r2 - shape.r1 || ar.c2 - ar.c1 !== shape.c2 - shape.c1)) throw E.VALUE
    tests.push({ ar, test: criteria(x.ev(a[i + 1])) })
  }
  const match = (i, j) => tests.every(({ ar, test }) => test(x.cell(ar.r1 + i, ar.c1 + j)))
  match.areas = tests.map(t => t.ar)
  match.blank = () => tests.every(t => t.test(null))
  return match
}

// Calls fn(i, j) for each offset into a shape (the first area's size) where
// any of the areas lies on the grid, and returns how many offsets were left
// out: at those every area is past the edge of the sheet, so every cell is
// blank.
function eachOffset(x, areas, fn) {
  const first = areas[0]
  const h = first.r2 - first.r1 + 1
  const w = first.c2 - first.c1 + 1
  let hh = 0
  let ww = 0
  for (const ar of areas) {
    hh = Math.max(hh, Math.min(h, x.rows - ar.r1))
    ww = Math.max(ww, Math.min(w, x.cols - ar.c1))
  }
  for (let i = 0; i < hh; i++) for (let j = 0; j < ww; j++) fn(i, j)
  return h * w - Math.max(0, hh) * Math.max(0, ww)
}

function sumIf(x, sr, i, j, acc) {
  const v = x.cell(sr.r1 + i, sr.c1 + j)
  if (v instanceof SheetError) throw v
  if (typeof v === 'number') { acc.s += v; acc.k++ }
}

function textArg(a, i, x) {
  return text(x.ev(a[i]))
}
function countArg(a, i, x, def) {
  const n = Math.trunc(numArg(a, i, x, def))
  if (n < 0) throw E.VALUE
  return n
}

const MANY = 255

define('SUM', 1, MANY, 'SUM(number1, [number2, ...])', 'Adds the numbers.', (a, x) => {
  let s = 0
  eachNumber(a, x, n => { s += n })
  return finite(s)
})
const average = (a, x) => {
  let s = 0
  let k = 0
  eachNumber(a, x, n => { s += n; k++ })
  return k ? s / k : 0
}
define('AVERAGE', 1, MANY, 'AVERAGE(number1, [number2, ...])', 'Average of the numbers.', average)
define('AVG', 1, MANY, 'AVG(number1, [number2, ...])', 'Average of the numbers (same as AVERAGE).', average)
define('MIN', 1, MANY, 'MIN(number1, [number2, ...])', 'Smallest of the numbers (or earliest of the dates).', (a, x) => {
  let m = Infinity
  eachNumber(a, x, n => { if (n < m) m = n }, true)
  return m === Infinity ? 0 : m
})
define('MAX', 1, MANY, 'MAX(number1, [number2, ...])', 'Largest of the numbers (or latest of the dates).', (a, x) => {
  let m = -Infinity
  eachNumber(a, x, n => { if (n > m) m = n }, true)
  return m === -Infinity ? 0 : m
})
define('COUNT', 1, MANY, 'COUNT(value1, [value2, ...])', 'Counts the cells that contain numbers.', (a, x) => {
  let k = 0
  for (const node of a) {
    if (node.k === 'empty') continue
    const ar = x.area(node)
    if (ar) { x.scan(ar, v => { if (typeof v === 'number') k++ }); continue }
    const v = attempt(x, node)
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && toNumber(v) !== null)) k++
  }
  return k
})
define('COUNTA', 1, MANY, 'COUNTA(value1, [value2, ...])', 'Counts the cells that are not empty.', (a, x) => {
  let k = 0
  for (const node of a) {
    if (node.k === 'empty') continue
    const ar = x.area(node)
    if (ar) { x.scan(ar, v => { if (v !== null && v !== '') k++ }); continue }
    const v = attempt(x, node)
    if (v !== null && v !== '') k++
  }
  return k
})
define('COUNTBLANK', 1, 1, 'COUNTBLANK(range)', 'Counts the empty cells in a range.', (a, x) => {
  const ar = areaArg(a, 0, x)
  let filled = 0
  x.scan(ar, v => { if (v !== null && v !== '') filled++ })
  return (ar.r2 - ar.r1 + 1) * (ar.c2 - ar.c1 + 1) - filled
})
define('PRODUCT', 1, MANY, 'PRODUCT(number1, [number2, ...])', 'Multiplies the numbers.', (a, x) => {
  let p = 1
  eachNumber(a, x, n => { p *= n })
  return finite(p)
})
define('MEDIAN', 1, MANY, 'MEDIAN(number1, [number2, ...])', 'Middle value of the numbers.', (a, x) => {
  const list = []
  eachNumber(a, x, n => { list.push(n) })
  if (!list.length) return 0
  list.sort((p, q) => p - q)
  const m = list.length >> 1
  return list.length % 2 ? list[m] : (list[m - 1] + list[m]) / 2
})
define('ROUND', 1, 2, 'ROUND(number, [digits])', 'Rounds to a number of decimal places (half away from zero).', (a, x) => roundTo(numArg(a, 0, x, 0), numArg(a, 1, x, 0)))
define('ROUNDUP', 1, 2, 'ROUNDUP(number, [digits])', 'Rounds away from zero.', (a, x) => roundTo(numArg(a, 0, x, 0), numArg(a, 1, x, 0), 'up'))
define('ROUNDDOWN', 1, 2, 'ROUNDDOWN(number, [digits])', 'Rounds towards zero.', (a, x) => roundTo(numArg(a, 0, x, 0), numArg(a, 1, x, 0), 'down'))
define('INT', 1, 1, 'INT(number)', 'Rounds down to the nearest whole number.', (a, x) => Math.floor(numArg(a, 0, x, 0)))
define('MOD', 2, 2, 'MOD(number, divisor)', 'Remainder after division; takes the sign of the divisor.', (a, x) => {
  const n = numArg(a, 0, x, 0)
  const d = numArg(a, 1, x, 0)
  if (d === 0) throw E.DIV0
  return finite(n - d * Math.floor(n / d))
})
define('ABS', 1, 1, 'ABS(number)', 'Absolute value of a number.', (a, x) => Math.abs(numArg(a, 0, x, 0)))
define('SQRT', 1, 1, 'SQRT(number)', 'Square root of a number.', (a, x) => {
  const n = numArg(a, 0, x, 0)
  if (n < 0) throw E.VALUE
  return Math.sqrt(n)
})
define('POWER', 2, 2, 'POWER(number, power)', 'A number raised to a power.', (a, x) => binary('^', numArg(a, 0, x, 0), numArg(a, 1, x, 0)))

define('IF', 2, 3, 'IF(condition, value_if_true, [value_if_false])', 'Returns one value when the condition is true and another when it is false.', (a, x) => {
  if (truth(x.ev(a[0]))) return x.ev(a[1])
  return a.length > 2 ? x.ev(a[2]) : false
})
define('IFERROR', 2, 2, 'IFERROR(value, value_if_error)', 'Returns the value, or the fallback when the value is an error.', (a, x) => {
  const v = attempt(x, a[0])
  return v instanceof SheetError ? x.ev(a[1]) : v
})
define('AND', 1, MANY, 'AND(logical1, [logical2, ...])', 'TRUE when every condition is true.', (a, x) => {
  let all = true
  eachLogical(a, x, b => { if (!b) all = false })
  return all
})
define('OR', 1, MANY, 'OR(logical1, [logical2, ...])', 'TRUE when any condition is true.', (a, x) => {
  let any = false
  eachLogical(a, x, b => { if (b) any = true })
  return any
})
define('NOT', 1, 1, 'NOT(logical)', 'Reverses TRUE and FALSE.', (a, x) => !truth(x.ev(a[0])))
define('ISBLANK', 1, 1, 'ISBLANK(value)', 'TRUE when the cell is empty.', (a, x) => attempt(x, a[0]) === null)
define('ISNUMBER', 1, 1, 'ISNUMBER(value)', 'TRUE when the value is a number.', (a, x) => typeof attempt(x, a[0]) === 'number')
define('ISTEXT', 1, 1, 'ISTEXT(value)', 'TRUE when the value is text.', (a, x) => typeof attempt(x, a[0]) === 'string')
define('ISERROR', 1, 1, 'ISERROR(value)', 'TRUE when the value is an error.', (a, x) => attempt(x, a[0]) instanceof SheetError)

define('SUMIF', 2, 3, 'SUMIF(range, criteria, [sum_range])', 'Adds the cells that meet a condition.', (a, x) => {
  const ar = areaArg(a, 0, x)
  const test = criteria(x.ev(a[1]))
  const sr = has(a, 2) ? areaArg(a, 2, x) : ar
  const acc = { s: 0, k: 0 }
  eachOffset(x, [ar, sr], (i, j) => { if (test(x.cell(ar.r1 + i, ar.c1 + j))) sumIf(x, sr, i, j, acc) })
  return acc.s
})
define('COUNTIF', 2, 2, 'COUNTIF(range, criteria)', 'Counts the cells that meet a condition, such as ">100", "<>Paid" or "Inv*".', (a, x) => {
  const ar = areaArg(a, 0, x)
  const test = criteria(x.ev(a[1]))
  let k = 0
  const past = eachOffset(x, [ar], (i, j) => { if (test(x.cell(ar.r1 + i, ar.c1 + j))) k++ })
  return past && test(null) ? k + past : k
})
define('AVERAGEIF', 2, 3, 'AVERAGEIF(range, criteria, [average_range])', 'Averages the cells that meet a condition.', (a, x) => {
  const ar = areaArg(a, 0, x)
  const test = criteria(x.ev(a[1]))
  const sr = has(a, 2) ? areaArg(a, 2, x) : ar
  const acc = { s: 0, k: 0 }
  eachOffset(x, [ar, sr], (i, j) => { if (test(x.cell(ar.r1 + i, ar.c1 + j))) sumIf(x, sr, i, j, acc) })
  if (!acc.k) throw E.DIV0
  return acc.s / acc.k
})
define('SUMIFS', 3, MANY, 'SUMIFS(sum_range, range1, criteria1, [range2, criteria2, ...])', 'Adds the cells whose rows meet every condition.', (a, x) => {
  if (a.length % 2 === 0) throw E.VALUE
  const sr = areaArg(a, 0, x)
  const match = conditions(a, x, 1, sr)
  const acc = { s: 0, k: 0 }
  eachOffset(x, [sr, ...match.areas], (i, j) => { if (match(i, j)) sumIf(x, sr, i, j, acc) })
  return acc.s
})
define('COUNTIFS', 2, MANY, 'COUNTIFS(range1, criteria1, [range2, criteria2, ...])', 'Counts the rows that meet every condition.', (a, x) => {
  if (a.length % 2) throw E.VALUE
  const first = areaArg(a, 0, x)
  const match = conditions(a, x, 0, first)
  let k = 0
  const past = eachOffset(x, match.areas, (i, j) => { if (match(i, j)) k++ })
  return past && match.blank() ? k + past : k
})
define('SUMPRODUCT', 1, MANY, 'SUMPRODUCT(range1, [range2, ...])', 'Multiplies matching cells of the ranges and adds the results.', (a, x) => {
  const areas = a.map(node => x.area(node))
  if (areas.some(ar => !ar)) {
    if (areas.some(Boolean)) throw E.VALUE
    return finite(a.reduce((p, node) => p * num(x.ev(node)), 1))
  }
  const h = areas[0].r2 - areas[0].r1 + 1
  const w = areas[0].c2 - areas[0].c1 + 1
  if (areas.some(ar => ar.r2 - ar.r1 + 1 !== h || ar.c2 - ar.c1 + 1 !== w)) throw E.VALUE
  const hh = Math.min(h, ...areas.map(ar => Math.max(0, x.rows - ar.r1)))
  const ww = Math.min(w, ...areas.map(ar => Math.max(0, x.cols - ar.c1)))
  let s = 0
  for (let i = 0; i < hh; i++) {
    for (let j = 0; j < ww; j++) {
      let p = 1
      for (const ar of areas) {
        const v = ok(x.cell(ar.r1 + i, ar.c1 + j))
        p *= typeof v === 'number' ? v : 0
      }
      s += p
    }
  }
  return finite(s)
})

const concat = (a, x) => {
  let s = ''
  eachText(a, x, t => { s += t })
  return s
}
define('CONCAT', 1, MANY, 'CONCAT(text1, [text2, ...])', 'Joins text and ranges into one text.', concat)
define('CONCATENATE', 1, MANY, 'CONCATENATE(text1, [text2, ...])', 'Joins text into one text.', concat)
define('TEXTJOIN', 3, MANY, 'TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])', 'Joins text with a delimiter between each item.', (a, x) => {
  const sep = textArg(a, 0, x)
  const skip = truth(x.ev(a[1]))
  const parts = []
  eachText(a.slice(2), x, t => { if (!skip || t !== '') parts.push(t) })
  return parts.join(sep)
})
define('LEN', 1, 1, 'LEN(text)', 'Number of characters in a text.', (a, x) => textArg(a, 0, x).length)
define('UPPER', 1, 1, 'UPPER(text)', 'Converts text to upper case.', (a, x) => textArg(a, 0, x).toUpperCase())
define('LOWER', 1, 1, 'LOWER(text)', 'Converts text to lower case.', (a, x) => textArg(a, 0, x).toLowerCase())
define('PROPER', 1, 1, 'PROPER(text)', 'Capitalises the first letter of each word.', (a, x) =>
  textArg(a, 0, x).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase()))
define('TRIM', 1, 1, 'TRIM(text)', 'Removes spaces from the ends and repeated spaces inside.', (a, x) => textArg(a, 0, x).trim().replace(/ {2,}/g, ' '))
define('LEFT', 1, 2, 'LEFT(text, [count])', 'First characters of a text.', (a, x) => textArg(a, 0, x).slice(0, countArg(a, 1, x, 1)))
define('RIGHT', 1, 2, 'RIGHT(text, [count])', 'Last characters of a text.', (a, x) => {
  const s = textArg(a, 0, x)
  const n = countArg(a, 1, x, 1)
  return n ? s.slice(-n) : ''
})
define('MID', 3, 3, 'MID(text, start, count)', 'Characters from the middle of a text, starting at position start.', (a, x) => {
  const s = textArg(a, 0, x)
  const start = Math.trunc(numArg(a, 1, x, 0))
  if (start < 1) throw E.VALUE
  return s.substr(start - 1, countArg(a, 2, x, 0))
})

define('VLOOKUP', 3, 4, 'VLOOKUP(value, range, column, [approximate])', 'Finds a value in the first column and returns the cell from another column. Use FALSE for an exact match.', (a, x) => {
  const key = x.ev(a[0])
  const ar = areaArg(a, 1, x)
  const col = Math.trunc(numArg(a, 2, x, 0))
  if (col < 1) throw E.VALUE
  if (col > ar.c2 - ar.c1 + 1) throw E.REF
  if (key === null || key === '') throw E.NA
  const approx = has(a, 3) ? truth(x.ev(a[3])) : true
  const n = Math.min(ar.r2 - ar.r1 + 1, Math.max(0, x.rows - ar.r1))
  const get = i => x.cell(ar.r1 + i, ar.c1)
  const i = approx ? sortedIndex(get, n, key, 1) : exactIndex(get, n, key, true)
  if (i < 0) throw E.NA
  return ok(x.cell(ar.r1 + i, ar.c1 + col - 1))
})
define('XLOOKUP', 3, 5, 'XLOOKUP(value, lookup_range, return_range, [if_not_found], [match_mode])', 'Finds a value and returns the matching item from another range. match_mode: 0 exact, -1 next smaller, 1 next larger, 2 wildcard.', (a, x) => {
  const key = x.ev(a[0])
  const look = vector(areaArg(a, 1, x), x)
  const ret = areaArg(a, 2, x)
  const mode = Math.trunc(numArg(a, 4, x, 0))
  if (![0, -1, 1, 2].includes(mode)) throw E.VALUE
  if ((look.vertical ? ret.r2 - ret.r1 : ret.c2 - ret.c1) + 1 !== look.len) throw E.VALUE
  let i = -1
  if (key !== null && key !== '') {
    i = mode === 0 || mode === 2 ? exactIndex(look.get, look.n, key, mode === 2) : nearestIndex(look.get, look.n, key, mode)
  }
  if (i < 0) {
    if (has(a, 3)) return x.ev(a[3])
    throw E.NA
  }
  return ok(look.vertical ? x.cell(ret.r1 + i, ret.c1) : x.cell(ret.r1, ret.c1 + i))
})
define('INDEX', 2, 3, 'INDEX(range, row, [column])', 'Value at a row and column of a range (1-based).', (a, x) => {
  const ar = areaArg(a, 0, x)
  const h = ar.r2 - ar.r1 + 1
  const w = ar.c2 - ar.c1 + 1
  let r = Math.trunc(numArg(a, 1, x, 0))
  let c = has(a, 2) ? Math.trunc(numArg(a, 2, x, 0)) : null
  if (c === null) {
    if (h === 1 && w > 1) { c = r; r = 1 } else c = 1
  }
  if (r < 1 || c < 1) throw E.VALUE
  if (r > h || c > w) throw E.REF
  return ok(x.cell(ar.r1 + r - 1, ar.c1 + c - 1))
})
define('MATCH', 2, 3, 'MATCH(value, range, [match_type])', 'Position of a value in a range: 0 exact, 1 largest value ≤ it (sorted ascending), -1 smallest value ≥ it (sorted descending).', (a, x) => {
  const key = x.ev(a[0])
  const look = vector(areaArg(a, 1, x), x)
  const type = Math.sign(Math.trunc(numArg(a, 2, x, 1)))
  if (key === null || key === '') throw E.NA
  const i = type === 0 ? exactIndex(look.get, look.n, key, true) : sortedIndex(look.get, look.n, key, type)
  if (i < 0) throw E.NA
  return i + 1
})

function todaySerial() {
  const d = new Date()
  return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
define('TODAY', 0, 0, 'TODAY()', "Today's date.", () => todaySerial())
define('NOW', 0, 0, 'NOW()', 'Current date and time.', () => {
  const d = new Date()
  return todaySerial() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
})
define('DATE', 3, 3, 'DATE(year, month, day)', 'Date from a year, month and day.', (a, x) => {
  let y = Math.trunc(numArg(a, 0, x, 0))
  const m = Math.trunc(numArg(a, 1, x, 0))
  const d = Math.trunc(numArg(a, 2, x, 0))
  if (y >= 0 && y < 1900) y += 1900
  if (y < 1900 || y > 9999) throw E.VALUE
  const s = serialOf(y, m, d)
  if (s < 0 || s > MAX_SERIAL) throw E.VALUE
  return s
})
define('YEAR', 1, 1, 'YEAR(date)', 'Year of a date.', (a, x) => ymdOf(dateArg(a, 0, x)).y)
define('MONTH', 1, 1, 'MONTH(date)', 'Month of a date (1–12).', (a, x) => ymdOf(dateArg(a, 0, x)).m)
define('DAY', 1, 1, 'DAY(date)', 'Day of the month of a date (1–31).', (a, x) => ymdOf(dateArg(a, 0, x)).d)
define('DAYS', 2, 2, 'DAYS(end_date, start_date)', 'Number of days from the start date to the end date.', (a, x) => Math.floor(dateArg(a, 0, x)) - Math.floor(dateArg(a, 1, x)))
define('EDATE', 2, 2, 'EDATE(start_date, months)', 'Same day a number of months before or after a date.', (a, x) => addMonths(dateArg(a, 0, x), Math.trunc(numArg(a, 1, x, 0)), false))
define('EOMONTH', 2, 2, 'EOMONTH(start_date, months)', 'Last day of the month a number of months before or after a date.', (a, x) => addMonths(dateArg(a, 0, x), Math.trunc(numArg(a, 1, x, 0)), true))

/** Sorted names of every supported formula function. */
export const FORMULA_FUNCTIONS = Object.keys(FNS).sort()

const DATE_RESULTS = new Set(['TODAY', 'NOW', 'DATE', 'EDATE', 'EOMONTH'])
const RANGE_AGGREGATES = new Set(['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'PRODUCT', 'MEDIAN'])

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

const IDLE = 0
const COMPUTING = 1
const DONE = 2
const GRAY = 1
const BLACK = 2
const NO_DEPS = []

/**
 * Evaluator over a grid of raw strings: value(r, c) gives number | string |
 * boolean | error code, display(r, c, fmt) the text to show. Values are
 * memoised, so treat the grid as immutable. Options: `textCols`, the columns
 * formatted as Text, whose typed values stay text ("00123" keeps its zeros),
 * and `header`, when the first row is a header row those columns leave alone.
 */
export function createEvaluator(grid, { textCols, header = false } = {}) {
  const g = Array.isArray(grid) ? grid : []
  const rows = g.length
  let cols = 0
  for (let r = 0; r < rows; r++) { const row = g[r]; if (row && row.length > cols) cols = row.length }
  const asText = new Uint8Array(cols)
  if (textCols) for (const c of textCols) if (c >= 0 && c < cols) asText[c] = 1
  const total = rows * cols
  const state = new Uint8Array(total)
  const mark = new Uint8Array(total)
  const isF = new Uint8Array(total)
  const vals = new Array(total)
  for (let r = 0; r < rows; r++) {
    const row = g[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) if (isFormula(row[c])) isF[r * cols + c] = 1
  }

  function rawAt(i) {
    const r = (i / cols) | 0
    return g[r][i - r * cols]
  }

  function area(node) {
    if (node.k === 'ref') return { r1: node.r, c1: node.c, r2: node.r, c2: node.c }
    if (node.k !== 'range') return null
    return {
      r1: node.r1,
      c1: node.c1,
      r2: node.r2 === Infinity ? Math.max(rows - 1, node.r1) : node.r2,
      c2: node.c2 === Infinity ? Math.max(cols - 1, node.c1) : node.c2,
    }
  }

  function scan(ar, fn) {
    const re = Math.min(ar.r2, rows - 1)
    const ce = Math.min(ar.c2, cols - 1)
    for (let r = ar.r1; r <= re; r++) for (let c = ar.c1; c <= ce; c++) fn(cell(r, c))
  }

  function cell(r, c) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null
    const i = r * cols + c
    const st = state[i]
    if (st === DONE) return vals[i]
    if (st === COMPUTING) return E.CIRC
    if (isF[i]) return compute(i)
    const v = asText[c] && !(header && r === 0) ? textLiteral(g[r]?.[c]) : literal(g[r]?.[c])
    vals[i] = v
    state[i] = DONE
    return v
  }

  function ev(node) {
    switch (node.k) {
      case 'lit': return node.v
      case 'ref': return ok(cell(node.r, node.c))
      case 'bin': {
        const a = ev(node.a)
        const b = ev(node.b)
        return ARITH_OPS.has(node.op) ? binary(node.op, loose(node.a, a), loose(node.b, b)) : binary(node.op, a, b)
      }
      case 'fn': {
        const f = node.fn
        if (!f) throw E.NAME
        if (node.args.length < f.min || node.args.length > f.max) throw E.VALUE
        if (node.args.length !== 1 || node.args[0].k !== 'range' || !RANGE_AGGREGATES.has(node.name)) return f.run(node.args, x)
        const ar = area(node.args[0])
        const key = `${node.name}:${ar.r1},${ar.c1},${ar.r2},${ar.c2}`
        let v = aggregates.get(key)
        if (v === undefined) {
          v = f.run(node.args, x)
          aggregates.set(key, v)
        }
        return v
      }
      case 'neg': return 0 - num(loose(node.a, ev(node.a)))
      case 'pct': return num(loose(node.a, ev(node.a))) / 100
      case 'range': {
        const ar = area(node)
        if (ar.r1 === ar.r2 && ar.c1 === ar.c2) return ok(cell(ar.r1, ar.c1))
        throw E.VALUE
      }
      case 'err': throw node.v
      case 'name': throw E.NAME
      default: return null
    }
  }

  const x = { rows, cols, ev, cell, area, scan }
  const aggregates = new Map()
  const doneRanges = new Set()

  function compute(i) {
    state[i] = COMPUTING
    const p = parseFormula(rawAt(i))
    let v
    if (!p.ast) v = E.ERROR
    else {
      try {
        v = ev(p.ast)
        if (v === null) v = 0
        else if (typeof v === 'number' && !Number.isFinite(v)) v = E.VALUE
      } catch (e) {
        v = e instanceof SheetError ? e : E.ERROR
      }
    }
    vals[i] = v
    state[i] = DONE
    return v
  }

  function frame(i) {
    return { i, deps: parseFormula(rawAt(i)).deps || NO_DEPS, d: 0, r: -1, c: 0, c1: 0, re: 0, ce: 0, key: '' }
  }

  function nextDep(f) {
    while (f.d < f.deps.length) {
      const dep = f.deps[f.d]
      if (dep.k === 'ref') {
        f.d++
        if (dep.r < rows && dep.c < cols) {
          const j = dep.r * cols + dep.c
          if (isF[j]) return j
        }
        continue
      }
      if (f.r < 0) {
        f.r = dep.r1
        f.c = f.c1 = dep.c1
        f.re = Math.min(dep.r2, rows - 1)
        f.ce = Math.min(dep.c2, cols - 1)
        f.key = `${f.r},${f.c1},${f.re},${f.ce}`
        if (f.c1 > f.ce || doneRanges.has(f.key)) f.r = f.re + 1
      }
      while (f.r <= f.re) {
        if (f.c > f.ce) { f.r++; f.c = f.c1; continue }
        const j = f.r * cols + f.c
        f.c++
        if (isF[j]) return j
      }
      doneRanges.add(f.key)
      f.r = -1
      f.d++
    }
    return -1
  }

  // Depth-first walk over formula dependencies with an explicit stack, so long
  // chains (running balances) never recurse; each cell is computed once all of
  // its inputs are, and every cell on a dependency cycle becomes #CIRC!.
  function prepare(start) {
    const stack = [frame(start)]
    mark[start] = GRAY
    while (stack.length) {
      const f = stack[stack.length - 1]
      const j = nextDep(f)
      if (j >= 0) {
        if (state[j] === DONE || mark[j] === BLACK) continue
        if (mark[j] === GRAY) {
          for (let k = stack.length - 1; k >= 0; k--) {
            const i = stack[k].i
            vals[i] = E.CIRC
            state[i] = DONE
            if (i === j) break
          }
          continue
        }
        mark[j] = GRAY
        stack.push(frame(j))
        continue
      }
      stack.pop()
      mark[f.i] = BLACK
      if (state[f.i] !== DONE) compute(f.i)
    }
  }

  function top(r, c) {
    if (!(r >= 0 && c >= 0 && r < rows && c < cols)) return null
    const i = r * cols + c
    if (isF[i] && state[i] === IDLE) prepare(i)
    return cell(r, c)
  }

  // A MIN or MAX over cells that hold only dates shows its result as a date.
  const datesOnly = new Map()
  function onlyDates(args) {
    if (!args.length) return false
    let seen = false
    for (const node of args) {
      const ar = area(node)
      if (!ar) return false
      const key = `${ar.r1},${ar.c1},${ar.r2},${ar.c2}`
      let hit = datesOnly.get(key)
      if (hit === undefined) {
        hit = 0
        scan(ar, v => {
          if (hit < 0 || v === null || v === '') return
          hit = typeof v === 'string' && dateSerial(v) !== null ? 1 : -1
        })
        datesOnly.set(key, hit)
      }
      if (hit < 0) return false
      if (hit > 0) seen = true
    }
    return seen
  }

  function dateResult(raw) {
    const p = parseFormula(raw)
    if (!p.ast || p.ast.k !== 'fn') return false
    if (DATE_RESULTS.has(p.ast.name)) return true
    return (p.ast.name === 'MIN' || p.ast.name === 'MAX') && onlyDates(p.ast.args)
  }

  return {
    rows,
    cols,
    value(r, c) {
      const v = top(r, c)
      return v instanceof SheetError ? v.code : v === null ? '' : v
    },
    display(r, c, fmt) {
      const raw = g[r]?.[c]
      const type = fmt && fmt.type
      if (!isFormula(raw)) {
        const s = raw == null ? '' : String(raw)
        if (!NUMERIC_FORMATS.has(type) && type !== 'date') return s
        const v = top(r, c)
        if (typeof v === 'number' || (type === 'date' && typeof v === 'string' && dateSerial(v) !== null)) return formatValue(v, fmt)
        return s
      }
      const v = top(r, c)
      if (v instanceof SheetError) return v.code
      if (typeof v === 'number' && (!type || type === 'auto') && dateResult(raw)) return formatDate(v)
      return formatValue(v, fmt)
    },
  }
}

const EVALUATORS = new WeakMap()

/** Display text for one cell (kept for older callers); the evaluator is cached per grid array. */
export function cellDisplay(grid, r, c) {
  if (!grid || typeof grid !== 'object') return ''
  let ev = EVALUATORS.get(grid)
  if (!ev) {
    ev = createEvaluator(grid)
    EVALUATORS.set(grid, ev)
  }
  return ev.display(r, c)
}

// ---------------------------------------------------------------------------
// Formula rewriting and grid edits
// ---------------------------------------------------------------------------

function refText(p) {
  return (p.absC ? '$' : '') + colName(p.c) + (p.absR ? '$' : '') + (p.r + 1)
}

function rangeText(kind, a, b) {
  if (kind === 'cols') return (a.absC ? '$' : '') + colName(a.c) + ':' + (b.absC ? '$' : '') + colName(b.c)
  if (kind === 'rows') return (a.absR ? '$' : '') + (a.r + 1) + ':' + (b.absR ? '$' : '') + (b.r + 1)
  return refText(a) + ':' + refText(b)
}

function rewrite(formula, fn) {
  if (!isFormula(formula)) return formula
  const tokens = tokenize(formula, formulaStart(formula), true)
  let out = ''
  let last = 0
  for (const t of tokens) {
    if (t.t !== 'ref' && t.t !== 'range') continue
    const rep = fn(t)
    if (rep == null) continue
    out += formula.slice(last, t.s) + rep
    last = t.e
  }
  return last ? out + formula.slice(last) : formula
}

/** Moves the relative parts of every reference in a formula by (dRow, dCol), as copy/paste and fill do; "$" parts stay and refs pushed off the sheet become #REF!. */
export function shiftFormula(formula, dRow, dCol) {
  if (!dRow && !dCol) return formula
  const move = p => ({
    ...p,
    r: p.r === undefined || p.absR ? p.r : p.r + dRow,
    c: p.c === undefined || p.absC ? p.c : p.c + dCol,
  })
  return rewrite(formula, t => {
    if (t.t === 'ref') {
      const p = move(t)
      if (p.r === t.r && p.c === t.c) return null
      return p.r < 0 || p.c < 0 ? '#REF!' : refText(p)
    }
    const a = move(t.a)
    const b = move(t.b)
    if (a.r === t.a.r && a.c === t.a.c && b.r === t.b.r && b.c === t.b.c) return null
    return a.r < 0 || b.r < 0 || a.c < 0 || b.c < 0 ? '#REF!' : rangeText(t.kind, a, b)
  })
}

/**
 * Moves the cells of `src` ({ r1, c1, r2, c2 }) so their top-left corner lands
 * on (r, c), as Excel's cut and paste does: the moved formulas keep their text,
 * every reference in the sheet to a moved cell (and every range wholly inside
 * the moved block) follows it, references to cells the block lands on become
 * #REF!, and the cells left behind are cleared. The grid grows to fit.
 */
export function moveRange(grid, src, r, c) {
  const g = Array.isArray(grid) ? grid : []
  const dr = r - src.r1
  const dc = c - src.c1
  if (!dr && !dc) return g
  const dst = { r1: r, c1: c, r2: src.r2 + dr, c2: src.c2 + dc }
  const inside = (b, y, x) => y >= b.r1 && y <= b.r2 && x >= b.c1 && x <= b.c2
  const move = p => ({ ...p, r: p.r + dr, c: p.c + dc })
  const fix = f => rewrite(f, t => {
    if (t.t === 'ref') {
      if (inside(src, t.r, t.c)) return refText(move(t))
      return inside(dst, t.r, t.c) ? '#REF!' : null
    }
    if (t.kind !== 'cells') return null
    const b = rangeBox(t)
    if (b.r1 < src.r1 || b.r2 > src.r2 || b.c1 < src.c1 || b.c2 > src.c2) return null
    return rangeText('cells', move(t.a), move(t.b))
  })
  const w = Math.max(widthOf(g), dst.c2 + 1)
  const h = Math.max(g.length, dst.r2 + 1)
  const out = []
  for (let y = 0; y < h; y++) {
    const row = new Array(w)
    for (let x = 0; x < w; x++) {
      const v = g[y]?.[x] ?? ''
      row[x] = isFormula(v) ? fix(v) : v
    }
    out.push(row)
  }
  const block = []
  for (let y = src.r1; y <= src.r2; y++) block.push(out[y].slice(src.c1, src.c2 + 1))
  for (let y = src.r1; y <= src.r2; y++) for (let x = src.c1; x <= src.c2; x++) out[y][x] = ''
  block.forEach((line, i) => line.forEach((v, j) => { out[r + i][c + j] = v }))
  return out
}

function remapFormula(formula, axis, point, span) {
  const skipKind = axis === 'r' ? 'cols' : 'rows'
  return rewrite(formula, t => {
    if (t.t === 'ref') {
      const v = point(t[axis])
      if (v === t[axis]) return null
      return v < 0 ? '#REF!' : refText({ ...t, [axis]: v })
    }
    if (t.kind === skipKind) return null
    const lo = Math.min(t.a[axis], t.b[axis])
    const hi = Math.max(t.a[axis], t.b[axis])
    const s = span(lo, hi)
    if (!s) return '#REF!'
    if (s[0] === lo && s[1] === hi) return null
    const [p, q] = t.a[axis] <= t.b[axis] ? [t.a, t.b] : [t.b, t.a]
    return rangeText(t.kind, { ...p, [axis]: s[0] }, { ...q, [axis]: s[1] })
  })
}

function widthOf(grid) {
  let w = 1
  for (const row of grid) if (row && row.length > w) w = row.length
  return w
}

function remapGrid(grid, w, axis, point, span) {
  return grid.map(row => {
    const out = new Array(w)
    for (let c = 0; c < w; c++) {
      const v = row?.[c] ?? ''
      out[c] = isFormula(v) ? remapFormula(v, axis, point, span) : v
    }
    return out
  })
}

const clampIndex = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
const countOf = v => Math.max(0, Math.floor(Number(v) || 0))

/** Inserts count blank rows before row `at`, rewriting every formula so references keep pointing at the same cells. */
export function insertRows(grid, at, count = 1) {
  const src = Array.isArray(grid) ? grid : []
  const w = widthOf(src)
  const pos = clampIndex(at, src.length)
  const k = countOf(count)
  const out = remapGrid(src, w, 'r', r => (r >= pos ? r + k : r), (lo, hi) => [lo >= pos ? lo + k : lo, hi >= pos ? hi + k : hi])
  if (!k) return out
  const blanks = Array.from({ length: k }, () => new Array(w).fill(''))
  out.splice(pos, 0, ...blanks)
  return out
}

/** Deletes count rows from row `at`; references to deleted cells become #REF! and ranges shrink. */
export function deleteRows(grid, at, count = 1) {
  const src = Array.isArray(grid) ? grid : []
  const w = widthOf(src)
  const pos = clampIndex(at, src.length)
  const end = Math.min(src.length, pos + countOf(count))
  const k = end - pos
  const out = remapGrid(src, w, 'r',
    r => (r < pos ? r : r >= end ? r - k : -1),
    (lo, hi) => (lo >= pos && hi < end ? null : [lo < pos ? lo : lo >= end ? lo - k : pos, hi < pos ? hi : hi >= end ? hi - k : pos - 1]))
  out.splice(pos, k)
  return out.length ? out : [new Array(w).fill('')]
}

/** Inserts count blank columns before column `at`, rewriting every formula so references keep pointing at the same cells. */
export function insertCols(grid, at, count = 1) {
  const src = Array.isArray(grid) ? grid : []
  const w = widthOf(src)
  const pos = clampIndex(at, w)
  const k = countOf(count)
  const out = remapGrid(src, w, 'c', c => (c >= pos ? c + k : c), (lo, hi) => [lo >= pos ? lo + k : lo, hi >= pos ? hi + k : hi])
  if (k) for (const row of out) row.splice(pos, 0, ...new Array(k).fill(''))
  return out
}

/** Deletes count columns from column `at`; references to deleted cells become #REF! and ranges shrink. */
export function deleteCols(grid, at, count = 1) {
  const src = Array.isArray(grid) ? grid : []
  const w = widthOf(src)
  const pos = clampIndex(at, w)
  const end = Math.min(w, pos + countOf(count))
  const k = end - pos
  const out = remapGrid(src, w, 'c',
    c => (c < pos ? c : c >= end ? c - k : -1),
    (lo, hi) => (lo >= pos && hi < end ? null : [lo < pos ? lo : lo >= end ? lo - k : pos, hi < pos ? hi : hi >= end ? hi - k : pos - 1]))
  for (const row of out) {
    row.splice(pos, k)
    if (!row.length) row.push('')
  }
  return out.length ? out : [['']]
}

/** Shifts a column-indexed map (metadata.sheet colWidths, colFormats …) after inserting (delta > 0) or deleting (delta < 0) columns at `at`; deleted keys are dropped. */
export function shiftColMeta(map, at, delta) {
  if (!map || typeof map !== 'object' || !delta) return map
  const out = {}
  for (const [key, value] of Object.entries(map)) {
    const i = Number(key)
    if (!Number.isInteger(i)) { out[key] = value; continue }
    if (i < at) out[i] = value
    else if (delta < 0 && i < at - delta) continue
    else out[i + delta] = value
  }
  return out
}

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

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

/**
 * Stable sort of the rows by one column's values (numbers, then text, blanks
 * always last); the header row stays put unless { header: false }, and moved
 * formulas keep pointing at their own row. With `range` ({ r1, c1, r2, c2 })
 * only that block is sorted, its first row being the header row, and cells
 * outside it stay where they are.
 */
export function sortRows(grid, col, asc = true, { header = true, range } = {}) {
  const src = Array.isArray(grid) ? grid : []
  const box = range ? { r1: Math.max(0, range.r1), c1: Math.max(0, range.c1), r2: Math.min(src.length - 1, range.r2), c2: Math.min(widthOf(src) - 1, range.c2) } : null
  const first = box ? box.r1 : 0
  const last = box ? box.r2 : src.length - 1
  const start = header && last >= first ? first + 1 : first
  const ev = createEvaluator(src)
  const items = []
  for (let r = start; r <= last; r++) items.push({ r, k: sortKey(ev.value(r, col)) })
  const dir = asc === false ? -1 : 1
  items.sort((p, q) => {
    const a = p.k
    const b = q.k
    if (a.rank === 9 || b.rank === 9) return (a.rank === 9 ? 1 : 0) - (b.rank === 9 ? 1 : 0) || p.r - q.r
    let d = a.rank - b.rank
    if (!d) d = a.rank === 1 ? COLLATOR.compare(a.v, b.v) : a.v < b.v ? -1 : a.v > b.v ? 1 : 0
    return d * dir || p.r - q.r
  })
  const out = src.map(row => [...(row || [])])
  items.forEach(({ r }, i) => {
    const to = start + i
    if (to === r) return
    const row = src[r] || []
    const move = v => (isFormula(v) ? shiftFormula(v, to - r, 0) : v)
    if (!box) out[to] = row.map(move)
    else for (let c = box.c1; c <= box.c2; c++) out[to][c] = move(row[c] ?? '')
  })
  return out
}

function steady(list) {
  if (list.length < 2) return null
  const step = list[1] - list[0]
  for (let i = 2; i < list.length; i++) {
    if (Math.abs(list[i] - list[i - 1] - step) > 1e-9 * Math.max(1, Math.abs(step))) return null
  }
  return step
}

function fixed(v, dec) {
  return dec ? roundTo(v, dec).toFixed(dec) : general(v)
}

function matchCase(word, sample) {
  if (sample.length > 1 && sample === sample.toUpperCase()) return word.toUpperCase()
  if (sample === sample.toLowerCase()) return word.toLowerCase()
  return word
}

function dateText(serial, style) {
  const { y, m, d } = ymdOf(serial)
  if (style.kind === 'iso') return `${y}-${pad2(m)}-${pad2(d)}`
  if (style.kind === 'dmy') {
    return (style.padD ? pad2(d) : d) + style.sep + (style.padM ? pad2(m) : m) + style.sep + (style.short ? pad2(y % 100) : y)
  }
  if (style.kind === 'dmony') {
    const word = (style.long ? MONTHS_LONG : MONTHS)[m - 1]
    return (style.padD ? pad2(d) : d) + style.sep + (style.upper ? word.toUpperCase() : word) + style.sep + y
  }
  return formatDate(serial)
}

const FILL_LISTS = [MONTHS, MONTHS_LONG, WEEKDAYS, WEEKDAYS_LONG]
const INDIAN_GROUPS = /^\d{1,2}(?:,\d{2})+,\d{3}$/
const WESTERN_GROUPS = /^\d{1,3}(?:,\d{3}){2,}$|^\d{3},\d{3}$/
const GROUPED_FORMATS = new Map()

// How numbers typed as "₹1,000", "1,00,000", "(500)" or "$ 2.50" are written,
// so a filled series looks like the cells it continues; null for plain numbers.
function numberStyle(src) {
  let prefix = ''
  let grouped = false
  let indian = null
  let paren = false
  let pct = false
  let places = null
  for (const raw of src) {
    let t = raw.trim()
    if (t[0] === '(' && t.endsWith(')')) { paren = true; t = t.slice(1, -1).trim() }
    if (t.endsWith('%')) { pct = true; t = t.slice(0, -1).trim() }
    if (t[0] === '-' || t[0] === '+') t = t.slice(1).trim()
    const cur = CURRENCY.exec(t)
    if (cur) {
      prefix = cur[0]
      t = t.slice(cur[0].length)
      if (t[0] === '-' || t[0] === '+') t = t.slice(1).trim()
    }
    const [whole, frac = ''] = t.split('.')
    if (whole.includes(',')) {
      grouped = true
      if (INDIAN_GROUPS.test(whole)) indian = true
      else if (WESTERN_GROUPS.test(whole) && indian === null) indian = false
    }
    places = places === null || places === frac.length ? frac.length : -1
  }
  if (!prefix && !grouped && !paren) return null
  return { prefix, grouped, locale: indian === false ? 'en-US' : 'en-IN', paren, pct, places }
}

function styledNumber(v, st) {
  const x = st.pct ? v * 100 : v
  const d = st.places >= 0 ? st.places : Math.min(6, (/\.(\d+)/.exec(general(x)) || ['', ''])[1].length)
  const key = `${st.locale}:${st.grouped}:${d}`
  let f = GROUPED_FORMATS.get(key)
  if (!f) {
    f = new Intl.NumberFormat(st.locale, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: st.grouped })
    GROUPED_FORMATS.set(key, f)
  }
  const r = roundTo(x, d) || 0
  const body = st.prefix + f.format(Math.abs(r)) + (st.pct ? '%' : '')
  if (r >= 0) return body
  return st.paren ? `(${body})` : `-${body}`
}

function seriesOf(src) {
  const n = src.length
  if (src.some(s => !s.trim() || isFormula(s))) return null
  const nums = src.map(toNumber)
  if (nums.every(v => v !== null)) {
    const step = steady(nums)
    if (step === null) return null
    const last = nums[n - 1]
    const style = numberStyle(src)
    if (style) return k => styledNumber(last + step * k, style)
    const pct = src.every(s => s.trim().endsWith('%'))
    const places = src.map(s => (/\.(\d+)/.exec(s) || ['', ''])[1].length)
    const dec = places.every(d => d === places[0]) ? places[0] : 0
    return k => (pct ? fixed((last + step * k) * 100, dec) + '%' : fixed(last + step * k, dec))
  }
  const dates = src.map(s => parseDateText(s.trim()))
  if (dates.every(Boolean)) {
    const style = dates[n - 1].style
    const serials = dates.map(p => Math.floor(p.serial))
    const last = serials[n - 1]
    if (n === 1) return k => dateText(last + k, style)
    const parts = serials.map(ymdOf)
    const months = steady(parts.map(p => p.y * 12 + p.m))
    const monthEnds = parts.every(p => p.d === daysIn(p.y, p.m))
    if (months && (monthEnds || parts.every(p => p.d === parts[0].d))) return k => dateText(addMonths(last, months * k, monthEnds), style)
    const step = steady(serials)
    return step ? k => dateText(last + step * k, style) : null
  }
  for (const list of FILL_LISTS) {
    const idx = src.map(s => list.findIndex(w => w.toLowerCase() === s.trim().toLowerCase()))
    if (idx.some(i => i < 0)) continue
    const L = list.length
    const unwrapped = [idx[0]]
    for (let i = 1; i < n; i++) unwrapped.push(idx[i] + Math.round((unwrapped[i - 1] - idx[i]) / L) * L)
    const step = n === 1 ? 1 : steady(unwrapped)
    if (!step) return null
    const sample = src[n - 1].trim()
    return k => matchCase(list[(((idx[n - 1] + step * k) % L) + L) % L], sample)
  }
  const parts = src.map(s => /^(.*?)(\d+)$/.exec(s))
  if (parts.every(Boolean) && parts.every(p => p[1] === parts[0][1])) {
    const prefix = parts[0][1]
    const values = parts.map(p => Number(p[2]))
    const step = n === 1 ? 1 : steady(values)
    if (!step) return null
    const digits = parts[n - 1][2]
    const width = digits.length > 1 && digits[0] === '0' ? digits.length : 0
    const quarter = /^(q|qtr|quarter\s*)$/i.test(prefix) && values.every(v => v >= 1 && v <= 4)
    const last = values[n - 1]
    return k => {
      let v = last + step * k
      v = quarter ? ((((v - 1) % 4) + 4) % 4) + 1 : Math.abs(v)
      return prefix + String(v).padStart(width, '0')
    }
  }
  return null
}

/** Values that continue a filled selection: numbers and dates with a constant step, "Item 1"/"Q1" and month or weekday names count on; anything else (and a single number or formula) repeats, cell k taking source k % n. */
export function fillSeries(cells, count) {
  const src = Array.from(cells || [], v => (v == null ? '' : String(v)))
  const len = countOf(count)
  if (!src.length || !len) return []
  const next = seriesOf(src)
  return Array.from({ length: len }, (_, k) => (next ? next(k + 1) : src[k % src.length]))
}
