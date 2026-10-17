// Excel-style editor for Pages spreadsheets. The sheet is stored as CSV in
// page.content and its formatting in page.metadata.sheet; this component owns
// the grid while it is open and reports every change through onChange(csv)
// and onMetaChange(meta).
//
// Select mode and edit mode work as in Excel: typing replaces the active
// cell, Enter/F2/double-click edit it in place, Esc cancels, Enter and Tab
// commit and move. One hidden textarea sits on the active cell the whole
// time, so typing, IME input and the system clipboard all arrive through a
// real editable element; it only becomes visible while a cell is edited.
import { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react'
import {
  Scissors, Copy, ClipboardPaste, BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart,
  BetweenVerticalEnd, Trash2, Eraser, ArrowDownAZ, ArrowDownZA, ChevronUp, ChevronDown, X, Search, MoveHorizontal,
  ChevronsLeftRight,
} from 'lucide-react'
import {
  csvToGrid, toCSV, parseTSV, toTSV, parseRange, createEvaluator, formulaRefs, isFormula, cellName, colName,
  insertRows, deleteRows, insertCols, deleteCols, shiftColMeta, sortRows, shiftFormula, formatValue, moveRange,
} from '../../utils/sheet'
import { toCsv } from '../../utils/csv'
import { downloadBlob } from '../../utils/download'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import SheetGrid from './SheetGrid'
import SheetToolbar, { shortcut } from './SheetToolbar'
import { SheetMenu, FormulaPopup } from './SheetMenu'
import { useSheetHistory } from './useSheetHistory'
import * as M from './editorModel'

const { ROW_H, HEAD_H } = M
const OVERSCAN_ROWS = 6
const OVERSCAN_COLS = 2
const FOOT_H = 44
const LINE_H = 17
const LINE_H_PHONE = 20
const NONE = []
const MAX_IMPORT = 5_000_000

// Cells copied from a sheet in this tab: when the clipboard still holds the
// same text, a paste uses the raw cells so formulas come across (shifted).
// A cut also remembers its range and the editor it came from, so pasting it
// there moves the cells as Excel does.
let clipStore = null
const sameText = (a, b) => a.replace(/\r\n?/g, '\n').replace(/\n$/, '') === b.replace(/\r\n?/g, '\n').replace(/\n$/, '')

let measureCtx
function textWidth(text, font) {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d') || null } catch { measureCtx = null }
  }
  if (!measureCtx) return String(text).length * 7.2
  measureCtx.font = font
  return measureCtx.measureText(String(text)).width
}

function buildLayout(grid, m, liveW, ev, view, font, size) {
  const { rows, cols } = size
  const dataRows = grid.length
  const colLeft = new Float64Array(cols + 1)
  for (let c = 0; c < cols; c++) {
    const w = liveW && liveW.c === c ? liveW.w : M.clampWidth(m.colWidths[c] ?? M.DEFAULT_COL_W)
    colLeft[c + 1] = colLeft[c] + w
  }
  const wrapCols = Object.keys(m.wrap).map(Number).filter(c => m.wrap[c] && c < cols)
  let rowTop = null
  if (wrapCols.length) {
    rowTop = new Float64Array(rows + 1)
    for (let r = 0; r < rows; r++) {
      let lines = 1
      for (const c of wrapCols) {
        if (r >= dataRows || !grid[r][c]) continue
        const text = ev.display(r, c, m.header && r === 0 ? undefined : m.colFormats[c])
        const avail = Math.max(24, colLeft[c + 1] - colLeft[c] - 18)
        let n = 0
        for (const part of String(text).split('\n')) n += Math.max(1, Math.ceil(textWidth(part, font) / avail))
        if (n > lines) lines = n
      }
      rowTop[r + 1] = rowTop[r] + (lines > 1 ? Math.min(lines, 12) * LINE_H + 12 : ROW_H)
    }
  }
  const rowY = rowTop ? r => rowTop[r] : r => r * ROW_H
  const rowH = rowTop ? r => rowTop[r + 1] - rowTop[r] : () => ROW_H
  const findRow = (y) => {
    if (y <= 0) return 0
    if (!rowTop) return Math.min(rows - 1, Math.floor(y / ROW_H))
    let lo = 0
    let hi = rows - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (rowTop[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const findCol = (x) => {
    if (x <= 0) return 0
    let lo = 0
    let hi = cols - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (colLeft[mid] <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const rowNumW = Math.max(44, 20 + 8 * String(rows).length)
  let fr = Math.min(m.freezeRows, rows - 1)
  let fc = Math.min(m.freezeCols, cols - 1)
  if (view.h) while (fr > 0 && rowY(fr) > (view.h - HEAD_H) * 0.6) fr--
  if (view.w) while (fc > 0 && colLeft[fc] > (view.w - rowNumW) * 0.6) fc--
  return {
    rows, cols, colLeft, rowY, rowH, findRow, findCol, rowNumW,
    fr: Math.max(0, fr), fc: Math.max(0, fc),
    frozenH: rowY(Math.max(0, fr)), frozenW: colLeft[Math.max(0, fc)],
    totalH: rowY(rows), totalW: rowNumW + colLeft[cols], footH: FOOT_H,
  }
}

function windowOf(L, top, left, w, h) {
  const vh = h || 800
  const vw = w || 1200
  const r0 = Math.max(L.fr, L.findRow(top + L.frozenH) - OVERSCAN_ROWS)
  const r1 = Math.min(L.rows - 1, L.findRow(top + vh - HEAD_H) + OVERSCAN_ROWS)
  const c0 = Math.max(L.fc, L.findCol(left + L.frozenW) - OVERSCAN_COLS)
  const c1 = Math.min(L.cols - 1, L.findCol(left + vw - L.rowNumW) + OVERSCAN_COLS)
  return { r0, r1, c0, c1 }
}
const sameWin = (a, b) => a.r0 === b.r0 && a.r1 === b.r1 && a.c0 === b.c0 && a.c1 === b.c1

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (!value) { setV(value); return undefined }
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const safeFileName = s => (String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'sheet')
const plural = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const SMALL_STAT = new Intl.NumberFormat('en-IN', { maximumSignificantDigits: 4 })
const textColsOf = m => Object.keys(m.colFormats).filter(c => m.colFormats[c]?.type === 'text').map(Number)
const evalOptions = m => ({ textCols: textColsOf(m), header: m.header })
const evalKey = m => `${m.header}|${textColsOf(m).join(',')}`

// A shared column format for the status bar, or null when the columns differ.
function sharedFormat(m, c1, c2) {
  const f = m.colFormats[c1]
  if (!f || !f.type || f.type === 'auto' || f.type === 'text') return null
  for (let c = c1 + 1; c <= c2; c++) {
    const g = m.colFormats[c]
    if (!g || g.type !== f.type || (g.decimals ?? null) !== (f.decimals ?? null)) return null
  }
  return f
}
function statText(v, fmt) {
  if (fmt) return formatValue(v, fmt)
  if (v === 0 || Math.abs(v) >= 1) return formatValue(v, { type: 'number' })
  return SMALL_STAT.format(v)
}

/**
 * Props: value (CSV), onChange(csv), meta (metadata.sheet, may be undefined),
 * onMetaChange(meta), height (CSS height; fills its flex parent by default),
 * fileName (used for Download CSV).
 */
export default function SheetEditor({ value, onChange, meta, onMetaChange, height, fileName }) {
  const [grid, setGrid] = useState(() => csvToGrid(value))
  const [rawMeta, setRawMeta] = useState(meta)
  const [sel, setSel] = useState(() => M.cellSel(0, 0))
  const [edit, setEdit] = useState(null)
  const [caret, setCaret] = useState(0)
  const [point, setPoint] = useState(null)
  const [acIndex, setAcIndex] = useState(0)
  const [acOff, setAcOff] = useState(false)
  const [menu, setMenu] = useState(null)
  const [findQ, setFindQ] = useState(null)
  const [findIdx, setFindIdx] = useState(0)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [view, setView] = useState({ w: 0, h: 0 })
  const [liveW, setLiveW] = useState(null)
  const [preview, setPreview] = useState(null)
  const [pending, setPending] = useState(null)
  const [flash, setFlash] = useState('')
  const [nameDraft, setNameDraft] = useState(null)
  const [announce, setAnnounce] = useState('')
  const [extraRows, setExtraRows] = useState(0)
  const [cutBox, setCutBox] = useState(null)
  const [widthEdit, setWidthEdit] = useState(null)
  const isPhone = useMediaQuery('(max-width: 640px)')
  const history = useSheetHistory(200)

  const rootRef = useRef(null)
  const scrollRef = useRef(null)
  const taRef = useRef(null)
  const fxRef = useRef(null)
  const findRef = useRef(null)
  const lastCsv = useRef(value)
  const lastMeta = useRef(meta)
  const cb = useRef({})
  cb.current = { onChange, onMetaChange }
  const dragRef = useRef(null)
  const pointerType = useRef('mouse')
  const scrollReq = useRef(false)
  const caretReq = useRef(null)
  const fontRef = useRef('13px system-ui, sans-serif')
  const flashTimer = useRef(0)
  const rafRef = useRef(0)
  const tabStart = useRef(null)
  const keyboardUse = useRef(false)
  const self = useRef({})

  const m = useMemo(() => M.readMeta(rawMeta), [rawMeta])
  const evKey = evalKey(m)
  const ev = useMemo(() => createEvaluator(grid, evalOptions(m)), [grid, evKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = grid.length
  const cols = grid[0].length
  const size = useMemo(() => M.viewSize(rows, cols, extraRows), [rows, cols, extraRows])
  const layout = useMemo(() => buildLayout(grid, m, liveW, ev, view, fontRef.current, size), [grid, m, liveW, ev, view, size])
  const win = useMemo(() => windowOf(layout, scroll.top, scroll.left, view.w, view.h), [layout, scroll, view])
  const rg = M.rangeOf(sel)
  const active = M.activeOf(sel)

  const st = useRef({})
  st.current = { grid, meta: rawMeta, m, sel, edit, ev, evGrid: grid, evKey, layout, point, scroll, view, menu, extra: extraRows, cut: cutBox }

  const getEv = () => {
    const cur = st.current
    const key = evalKey(cur.m)
    if (cur.evGrid !== cur.grid || cur.evKey !== key) {
      cur.ev = createEvaluator(cur.grid, evalOptions(cur.m))
      cur.evGrid = cur.grid
      cur.evKey = key
    }
    return cur.ev
  }
  // The rows and columns shown for a grid: the data plus the blank margin.
  const sizeOf = g => M.viewSize(g.length, g[0].length, st.current.extra)

  const showFlash = useCallback((text) => {
    setFlash(text)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 2600)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // ── State changes ────────────────────────────────────────────────────────
  const setSelNow = (next) => {
    st.current.sel = next
    setSel(next)
  }

  const cancelCut = () => {
    if (!st.current.cut) return
    st.current.cut = null
    setCutBox(null)
    if (clipStore?.cut && clipStore.owner === self) clipStore = null
  }

  const apply = (next, record = true) => {
    const cur = st.current
    const g = next.grid || cur.grid
    const mt = Object.prototype.hasOwnProperty.call(next, 'meta') ? next.meta : cur.meta
    if (record) history.record({ grid: cur.grid, meta: cur.meta, sel: cur.sel })
    const vz = sizeOf(g)
    const s = M.clampSel(next.sel || cur.sel, vz.rows, vz.cols)
    if (g !== cur.grid) {
      cancelCut()
      setGrid(g)
      const csv = toCSV(g)
      lastCsv.current = csv
      cb.current.onChange?.(csv)
    }
    if (mt !== cur.meta) {
      setRawMeta(mt)
      lastMeta.current = mt
      cb.current.onMetaChange?.(mt)
    }
    setSel(s)
    st.current = { ...st.current, grid: g, meta: mt, m: mt === cur.meta ? cur.m : M.readMeta(mt), sel: s }
  }

  const patchMeta = (patch) => apply({ meta: M.patchMeta(st.current.meta, patch) })

  // A new value or meta from outside (template, restored version, the full
  // page arriving after the drawer opened) replaces the grid. It is an undo
  // step unless the sheet was still blank and untouched.
  useEffect(() => {
    const vChanged = value !== lastCsv.current
    const mChanged = meta !== lastMeta.current
    if (!vChanged && !mChanged) return
    const cur = st.current
    if (!(history.pristine() && M.isBlankGrid(cur.grid))) history.record({ grid: cur.grid, meta: cur.meta, sel: cur.sel })
    lastCsv.current = value
    lastMeta.current = meta
    const g = vChanged ? csvToGrid(value) : cur.grid
    if (vChanged) cancelCut()
    setEdit(null)
    setPoint(null)
    setGrid(g)
    setRawMeta(meta)
    const vz = sizeOf(g)
    setSel(s => M.clampSel(s, vz.rows, vz.cols))
  }, [value, meta]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Focus, measuring, scrolling ──────────────────────────────────────────
  const focusGrid = useCallback(() => {
    const el = pointerType.current === 'touch' ? rootRef.current : taRef.current
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return undefined
    try { fontRef.current = `13px ${getComputedStyle(rootRef.current).fontFamily || 'system-ui, sans-serif'}` } catch { /* keep default */ }
    const measure = () => setView(v => (v.w === sc.clientWidth && v.h === sc.clientHeight ? v : { w: sc.clientWidth, h: sc.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const sc = scrollRef.current
      if (!sc) return
      const cur = st.current
      const L = cur.layout
      const top = sc.scrollTop
      const left = sc.scrollLeft
      const frozenEdit = cur.edit && (cur.edit.r < L.fr || cur.edit.c < L.fc)
      const a = windowOf(L, top, left, cur.view.w, cur.view.h)
      const b = windowOf(L, cur.scroll.top, cur.scroll.left, cur.view.w, cur.view.h)
      if (frozenEdit || !sameWin(a, b)) setScroll({ top, left })
      if (cur.menu?.fromGrid) setMenu(null)
    })
  }, [])

  // Keeps the cell the keyboard just moved to in view (below the frozen rows
  // and right of the frozen columns), and renders the rows it scrolls to
  // before the frame is painted. Moving into a frozen row or column scrolls
  // the rest of the sheet back to its start, as Excel does; editing a frozen
  // cell leaves the scroll alone.
  useLayoutEffect(() => {
    const why = scrollReq.current
    if (!why) return
    scrollReq.current = false
    const sc = scrollRef.current
    if (!sc) return
    const L = layout
    const t = edit ? { r: edit.r, c: edit.c } : sel.act ? active : { r: sel.fr, c: sel.fc }
    const vh = sc.clientHeight || view.h
    const vw = sc.clientWidth || view.w
    if (vh && t.r < L.fr && why !== 'edit') sc.scrollTop = 0
    if (vw && t.c < L.fc && why !== 'edit') sc.scrollLeft = 0
    if (vh && t.r >= L.fr) {
      const top = L.rowY(t.r)
      const bottom = top + L.rowH(t.r)
      if (top < sc.scrollTop + L.frozenH) sc.scrollTop = top - L.frozenH
      else if (bottom > sc.scrollTop + vh - HEAD_H) sc.scrollTop = bottom - (vh - HEAD_H)
    }
    if (vw && t.c >= L.fc) {
      const left = L.colLeft[t.c]
      const right = L.colLeft[t.c + 1]
      if (left < sc.scrollLeft + L.frozenW) sc.scrollLeft = left - L.frozenW
      else if (right > sc.scrollLeft + vw - L.rowNumW) sc.scrollLeft = Math.min(left - L.frozenW, right - (vw - L.rowNumW))
    }
    if (sc.scrollTop !== scroll.top || sc.scrollLeft !== scroll.left) setScroll({ top: sc.scrollTop, left: sc.scrollLeft })
  })

  // While editing, keep focus and the caret where the last action put them.
  useLayoutEffect(() => {
    if (!edit) return
    const el = edit.src === 'bar' ? fxRef.current : taRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (caretReq.current != null) {
      const p = Math.min(caretReq.current, el.value.length)
      el.setSelectionRange(p, p)
      caretReq.current = null
    }
  })


  // ── Editing ──────────────────────────────────────────────────────────────
  const beginEdit = (text, mode, src = 'cell') => {
    const cur = st.current
    const a = M.activeOf(cur.sel)
    const raw = cur.grid[a.r]?.[a.c] ?? ''
    const t = text ?? raw
    const e = { r: a.r, c: a.c, text: t, mode, src, orig: raw }
    st.current.edit = e
    st.current.point = null
    setEdit(e)
    setPoint(null)
    setAcOff(false)
    setAcIndex(0)
    setCaret(t.length)
    if (src === 'cell') caretReq.current = t.length
    scrollReq.current = 'edit'
    setMenu(null)
  }

  const setEditText = (text, pos, nextPoint = null) => {
    const e = { ...st.current.edit, text }
    st.current.edit = e
    st.current.point = nextPoint
    setEdit(e)
    setPoint(nextPoint)
    setCaret(pos)
    if (!nextPoint) setAcOff(false)
  }

  const cancelEdit = () => {
    st.current.edit = null
    st.current.point = null
    setEdit(null)
    setPoint(null)
    focusGrid()
  }

  // Moves the active cell; inside a multi-cell selection Enter and Tab walk
  // through it (wrapping) instead of collapsing it, as Excel does.
  const stepSel = (s, dr, dc, g) => {
    const r0 = M.rangeOf(s)
    const a = M.activeOf(s)
    const { rows: rowsN, cols: colsN } = sizeOf(g)
    if (r0.r1 !== r0.r2 || r0.c1 !== r0.c2) {
      let r = a.r
      let c = a.c
      if (dc) {
        c += dc
        if (c > r0.c2) { c = r0.c1; r = r + 1 > r0.r2 ? r0.r1 : r + 1 }
        else if (c < r0.c1) { c = r0.c2; r = r - 1 < r0.r1 ? r0.r2 : r - 1 }
      } else {
        r += dr
        if (r > r0.r2) { r = r0.r1; c = c + 1 > r0.c2 ? r0.c1 : c + 1 }
        else if (r < r0.r1) { r = r0.r2; c = c - 1 < r0.c1 ? r0.c2 : c - 1 }
      }
      return { ...s, act: [r, c] }
    }
    return M.cellSel(Math.max(0, Math.min(rowsN - 1, a.r + dr)), Math.max(0, Math.min(colsN - 1, a.c + dc)))
  }

  // A number typed into a Percent column means that many percent (15 → 15%).
  const entryFor = (text, r, c) => (fmtAt(r, c)?.type === 'percent' ? M.percentEntry(text) : text)

  // how: 'walk' moves through a multi-cell selection (Enter, Tab), 'collapse'
  // moves a single cell (arrow keys), 'all' writes the entry into every
  // selected cell (Ctrl+Enter). `to` names the cell to move to instead.
  const commitEdit = (dr = 0, dc = 0, how = 'walk', to = null) => {
    const cur = st.current
    const e = cur.edit
    if (!e) return false
    const text = M.tidyFormula(e.text)
    st.current.edit = null
    st.current.point = null
    setEdit(null)
    setPoint(null)
    let g = cur.grid
    const r0 = M.rangeOf(cur.sel)
    if (how === 'all' && (r0.r1 !== r0.r2 || r0.c1 !== r0.c2)) {
      g = M.mapRange(M.ensureSize(g, r0.r2 + 1, r0.c2 + 1), r0,
        (y, x) => (isFormula(text) ? shiftFormula(text, y - e.r, x - e.c) : entryFor(text, y, x)))
    } else {
      const entry = entryFor(text, e.r, e.c)
      if (entry !== (g[e.r]?.[e.c] ?? '')) g = M.writeBlock(g, e.r, e.c, [[entry]])
    }
    let nextSel = cur.sel
    const vz = sizeOf(g)
    if (to) {
      nextSel = M.cellSel(Math.min(vz.rows - 1, to.r), Math.min(vz.cols - 1, to.c))
    } else if (how === 'collapse') {
      nextSel = M.cellSel(Math.max(0, Math.min(vz.rows - 1, e.r + dr)), Math.max(0, Math.min(vz.cols - 1, e.c + dc)))
    } else if (dr || dc) nextSel = stepSel(cur.sel, dr, dc, g)
    if (g !== cur.grid) apply({ grid: g, sel: nextSel })
    else setSelNow(nextSel)
    scrollReq.current = true
    return true
  }

  const editEl = () => (st.current.edit?.src === 'bar' ? fxRef.current : taRef.current)
  const caretNow = () => {
    const el = editEl()
    return el ? el.selectionStart ?? 0 : st.current.edit?.text.length ?? 0
  }

  const canPointNow = () => {
    const e = st.current.edit
    if (!e || !isFormula(e.text)) return false
    const pos = caretNow()
    const p = st.current.point
    return (p && pos === p.end) || M.canPoint(e.text, pos)
  }

  // Point mode: clicking, dragging or arrowing while a formula waits for an
  // argument writes that cell or range into the formula at the caret.
  const pointAt = (r, c, extend) => {
    const cur = st.current
    const e = cur.edit
    if (!e) return
    const p = cur.point
    const pos = caretNow()
    let start = pos
    let end = pos
    let ar = r
    let ac = c
    if (p && pos === p.end) {
      start = p.start
      end = p.end
      if (extend) { ar = p.ar; ac = p.ac }
    }
    const box = { r1: Math.min(ar, r), c1: Math.min(ac, c), r2: Math.max(ar, r), c2: Math.max(ac, c) }
    const ref = M.rangeName(box)
    const text = e.text.slice(0, start) + ref + e.text.slice(end)
    const np = { start, end: start + ref.length, ar, ac, fr: r, fc: c }
    caretReq.current = np.end
    setEditText(text, np.end, np)
  }

  const fragment = edit && !acOff ? M.fnFragment(edit.text, caret) : null
  const hint = edit && !fragment && isFormula(edit.text) ? M.fnContext(edit.text, caret) : null

  const pickFunction = (name) => {
    const e = st.current.edit
    if (!e) return
    const info = M.fnFragment(e.text, caretNow())
    if (!info) return
    const text = e.text.slice(0, info.start) + name + '(' + e.text.slice(info.end)
    const pos = info.start + name.length + 1
    caretReq.current = pos
    setEditText(text, pos)
    setAcIndex(0)
  }

  const refBoxes = useMemo(() => {
    if (!edit || !isFormula(edit.text)) return NONE
    return formulaRefs(edit.text)
      .map((b, i) => ({ i, r1: b.r1, c1: b.c1, r2: Math.min(b.r2, size.rows - 1), c2: Math.min(b.c2, size.cols - 1) }))
      .filter(b => b.r1 < size.rows && b.c1 < size.cols)
  }, [edit, size])

  // ── Selection helpers ────────────────────────────────────────────────────
  // Whole columns and rows run to the end of the blank margin, so they cover
  // everything shown; `wholeCols`/`wholeRows` tell a range that does.
  const wholeCols = (r0, g = st.current.grid) => r0.r1 === 0 && r0.r2 >= sizeOf(g).rows - 1
  const wholeRows = (r0, g = st.current.grid) => r0.c1 === 0 && r0.c2 >= sizeOf(g).cols - 1
  const selectCell = (r, c, extend) => {
    const s = st.current.sel
    tabStart.current = null
    setSelNow(extend ? { ar: s.ar, ac: s.ac, fr: r, fc: c } : M.cellSel(r, c))
  }
  const selectCols = (c1, c2) => { tabStart.current = null; setSelNow({ ar: 0, ac: c1, fr: sizeOf(st.current.grid).rows - 1, fc: c2 }) }
  const selectRows = (r1, r2) => { tabStart.current = null; setSelNow({ ar: r1, ac: 0, fr: r2, fc: sizeOf(st.current.grid).cols - 1 }) }
  const selectAll = () => {
    const vz = sizeOf(st.current.grid)
    tabStart.current = null
    setSelNow({ ar: 0, ac: 0, fr: vz.rows - 1, fc: vz.cols - 1 })
  }

  const moveSel = (dr, dc, extend, jump) => {
    const cur = st.current
    const g = cur.grid
    const s = cur.sel
    const vz = sizeOf(g)
    const from = extend ? { r: s.fr, c: s.fc } : M.activeOf(s)
    let r
    let c
    if (jump) [r, c] = M.jumpEdge(g, from.r, from.c, dr, dc, vz.rows, vz.cols)
    else {
      r = Math.max(0, Math.min(vz.rows - 1, from.r + dr))
      c = Math.max(0, Math.min(vz.cols - 1, from.c + dc))
    }
    tabStart.current = null
    setSelNow(extend ? { ar: s.ar, ac: s.ac, fr: r, fc: c } : M.cellSel(r, c))
    scrollReq.current = true
  }

  const fmtAt = (r, c) => {
    const mm = st.current.m
    return mm.header && r === 0 ? undefined : mm.colFormats[c]
  }

  // ── Clipboard ────────────────────────────────────────────────────────────
  // Ctrl+X only marks the cells (with a dashed border, as Excel does); they
  // move when the cut is pasted, and Esc or any edit cancels it.
  const copySelection = (cut) => {
    const cur = st.current
    const sel0 = M.rangeOf(cur.sel)
    const g = cur.grid
    const r0 = { ...sel0, r2: Math.min(sel0.r2, Math.max(sel0.r1, g.length - 1)), c2: Math.min(sel0.c2, Math.max(sel0.c1, g[0].length - 1)) }
    const evNow = getEv()
    const block = []
    for (let r = r0.r1; r <= r0.r2; r++) {
      const line = []
      for (let c = r0.c1; c <= r0.c2; c++) line.push(evNow.display(r, c, fmtAt(r, c)))
      block.push(line)
    }
    const text = toTSV(block)
    clipStore = { text, cells: M.blockOf(g, r0), r: r0.r1, c: r0.c1, cut, range: r0, owner: self }
    st.current.cut = cut ? r0 : null
    setCutBox(cut ? r0 : null)
    showFlash(cut ? `Cut ${M.rangeName(r0)}: paste to move it, Esc to cancel` : `Copied ${M.rangeName(r0)}`)
    return text
  }

  // Pastes a cut from this sheet: the cells move and every formula that
  // pointed at them follows, all as one undo step. A second paste copies.
  const pasteCut = (clip) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const src = clip.range
    const h = src.r2 - src.r1 + 1
    const w = src.c2 - src.c1 + 1
    const g = moveRange(cur.grid, src, r0.r1, r0.c1)
    const dst = { r1: r0.r1, c1: r0.c1, r2: r0.r1 + h - 1, c2: r0.c1 + w - 1 }
    clipStore = { ...clip, cells: M.blockOf(g, dst), r: dst.r1, c: dst.c1, cut: false, range: dst }
    cancelCut()
    apply({ grid: g, sel: { ar: dst.r1, ac: dst.c1, fr: dst.r2, fc: dst.c2 } })
    scrollReq.current = true
    showFlash(`Moved ${M.rangeName(src)} to ${M.rangeName(dst)}`)
  }

  const pasteText = (text) => {
    if (!text) return
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const internal = clipStore && sameText(clipStore.text, text) ? clipStore : null
    if (internal && internal.cut && internal.owner === self && cur.cut) { pasteCut(internal); return }
    const base = internal ? internal.cells : parseTSV(text)
    if (!base.length) return
    const bh = base.length
    const bw = base[0].length
    const blockAt = (r, c) => (internal && !internal.cut ? M.shiftBlock(base, r - internal.r, c - internal.c) : base)
    let g = cur.grid
    let out
    const sh = r0.r2 - r0.r1 + 1
    const sw = r0.c2 - r0.c1 + 1
    if ((sh > bh || sw > bw) && sh % bh === 0 && sw % bw === 0) {
      for (let r = r0.r1; r <= r0.r2; r += bh) for (let c = r0.c1; c <= r0.c2; c += bw) g = M.writeBlock(g, r, c, blockAt(r, c))
      out = r0
    } else {
      g = M.writeBlock(g, r0.r1, r0.c1, blockAt(r0.r1, r0.c1))
      out = { r1: r0.r1, c1: r0.c1, r2: r0.r1 + bh - 1, c2: r0.c1 + bw - 1 }
    }
    const grew = g.length > cur.grid.length || g[0].length > cur.grid[0].length
    apply({ grid: g, sel: { ar: out.r1, ac: out.c1, fr: out.r2, fc: out.c2 } })
    scrollReq.current = true
    if (grew) showFlash(`Sheet grew to ${plural(g.length, 'row', 'rows')} × ${plural(g[0].length, 'column', 'columns')} to fit the paste`)
  }

  const isGridTarget = t => t === taRef.current || t === rootRef.current || t === scrollRef.current

  const onCopy = (e) => {
    if (!isGridTarget(e.target) || st.current.edit) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', copySelection(false))
  }
  const onCut = (e) => {
    if (!isGridTarget(e.target) || st.current.edit) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', copySelection(true))
  }
  const onPaste = (e) => {
    if (!isGridTarget(e.target) || st.current.edit) return
    e.preventDefault()
    pasteText(e.clipboardData?.getData('text/plain') || '')
  }

  const clipboardAction = (kind) => {
    const ta = taRef.current
    let ok = false
    if (ta && pointerType.current !== 'touch') {
      ta.focus({ preventScroll: true })
      ta.value = ' '
      ta.select()
      try { ok = document.execCommand(kind) } catch { ok = false }
      ta.value = ''
    }
    if (!ok) {
      const text = copySelection(kind === 'cut')
      navigator.clipboard?.writeText?.(text).catch(() => {})
    }
  }

  const pasteFromMenu = () => {
    const ask = () => showFlash(`Press ${shortcut('Mod+V')} to paste`)
    if (!navigator.clipboard?.readText) { ask(); return }
    navigator.clipboard.readText().then(t => (t ? pasteText(t) : ask()), ask)
  }

  // ── Sheet actions ────────────────────────────────────────────────────────
  const clearRange = () => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const g = cur.grid
    let any = false
    for (let r = r0.r1; r <= Math.min(r0.r2, g.length - 1) && !any; r++) {
      for (let c = r0.c1; c <= r0.c2; c++) if ((g[r][c] ?? '') !== '') { any = true; break }
    }
    if (any) apply({ grid: M.mapRange(g, r0, () => '') })
  }

  // Inserting or deleting inside the blank margin past the data changes
  // nothing, so it is not an undo step either.
  const insertRowsAct = (below) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const whole = wholeCols(r0)
    const n = whole ? 1 : r0.r2 - r0.r1 + 1
    const a = M.activeOf(cur.sel)
    const at = below ? (whole ? a.r + 1 : r0.r2 + 1) : (whole ? a.r : r0.r1)
    if (at >= cur.grid.length) return
    const g = insertRows(cur.grid, at, n)
    apply({ grid: g, sel: { ar: at, ac: r0.c1, fr: at + n - 1, fc: r0.c2 } })
    scrollReq.current = true
  }

  const insertColsAct = (right) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const whole = wholeRows(r0)
    const n = whole ? 1 : r0.c2 - r0.c1 + 1
    const a = M.activeOf(cur.sel)
    const at = right ? (whole ? a.c + 1 : r0.c2 + 1) : (whole ? a.c : r0.c1)
    if (at >= cur.grid[0].length) return
    const g = insertCols(cur.grid, at, n)
    const mt = cur.meta ? M.shiftMetaCols(cur.meta, at, n, shiftColMeta) : cur.meta
    apply({ grid: g, meta: mt, sel: { ar: r0.r1, ac: at, fr: r0.r2, fc: at + n - 1 } })
    scrollReq.current = true
  }

  const deleteRowsAct = () => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    if (r0.r1 >= cur.grid.length) return
    const r2 = Math.min(r0.r2, cur.grid.length - 1)
    const g = deleteRows(cur.grid, r0.r1, r2 - r0.r1 + 1)
    apply({ grid: g, sel: M.cellSel(Math.min(r0.r1, g.length - 1), M.activeOf(cur.sel).c) })
    showFlash(r0.r1 === r2 ? `Deleted row ${r0.r1 + 1}` : `Deleted rows ${r0.r1 + 1}–${r2 + 1}`)
  }

  const deleteColsAct = () => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    if (r0.c1 >= cur.grid[0].length) return
    const c2 = Math.min(r0.c2, cur.grid[0].length - 1)
    const n = c2 - r0.c1 + 1
    const g = deleteCols(cur.grid, r0.c1, n)
    const mt = cur.meta ? M.shiftMetaCols(cur.meta, r0.c1, -n, shiftColMeta) : cur.meta
    apply({ grid: g, meta: mt, sel: M.cellSel(M.activeOf(cur.sel).r, Math.min(r0.c1, g[0].length - 1)) })
    showFlash(n === 1 ? `Deleted column ${colName(r0.c1)}` : `Deleted columns ${colName(r0.c1)}–${colName(c2)}`)
  }

  // A selection of several rows sorts just that block, as Excel does (its
  // first row is the header row only when it is the sheet's header row); a
  // single cell or whole columns sort the whole sheet.
  const sortAct = (asc) => {
    const cur = st.current
    const a = M.activeOf(cur.sel)
    const r0 = M.rangeOf(cur.sel)
    const dir = asc ? 'A → Z' : 'Z → A'
    if (r0.r2 > r0.r1 && !wholeCols(r0)) {
      const box = { r1: r0.r1, c1: r0.c1, r2: Math.min(r0.r2, cur.grid.length - 1), c2: Math.min(r0.c2, cur.grid[0].length - 1) }
      const header = box.r1 === 0 && cur.m.header
      if (box.r2 - box.r1 < (header ? 2 : 1) || box.c1 > box.c2) return
      apply({ grid: sortRows(cur.grid, a.c, asc, { header, range: box }) })
      const body = header ? { ...box, r1: box.r1 + 1 } : box
      showFlash(`Sorted ${M.rangeName(body)} by column ${colName(a.c)}, ${dir}`)
      return
    }
    apply({ grid: sortRows(cur.grid, a.c, asc, { header: cur.m.header }) })
    showFlash(`Sorted by column ${colName(a.c)}, ${dir}${cur.m.header ? ' (header row kept on top)' : ''}`)
  }

  const fillCopyAct = (dir) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    let base = cur.grid
    if (r0.r2 >= base.length || r0.c2 >= base[0].length) {
      const vertical = dir === 'down'
      const single = vertical ? r0.r1 === r0.r2 : r0.c1 === r0.c2
      const src = vertical ? M.blockOf(base, { ...r0, r1: single ? r0.r1 - 1 : r0.r1, r2: single ? r0.r1 - 1 : r0.r1 })
        : M.blockOf(base, { ...r0, c1: single ? r0.c1 - 1 : r0.c1, c2: single ? r0.c1 - 1 : r0.c1 })
      if (!src.some(line => line.some(v => v !== ''))) return
      base = M.ensureSize(base, r0.r2 + 1, r0.c2 + 1)
    }
    const g = M.fillCopy(base, r0, dir)
    if (g) apply({ grid: g })
  }

  const fillAuto = () => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const end = M.autoFillEnd(cur.grid, r0)
    if (end < 0) return
    const res = M.fillTo(cur.grid, r0, end, r0.c2)
    if (res) apply({ grid: res.grid, sel: { ...cur.sel, ar: r0.r1, ac: r0.c1, fr: end, fc: r0.c2, act: null } })
  }

  const colsOfSel = () => M.rangeOf(st.current.sel)

  const formatAct = (type) => {
    const cur = st.current
    const r0 = colsOfSel()
    const prev = cur.m.colFormats[M.activeOf(cur.sel).c] || {}
    const keepDec = prev.decimals != null && (type === 'number' || type === 'inr' || type === 'percent')
    const val = type === 'auto' ? undefined : keepDec ? { type, decimals: prev.decimals } : { type }
    patchMeta({ colFormats: M.setCols(cur.m.colFormats, r0.c1, r0.c2, val) })
  }

  const decimalsAct = (delta) => {
    const cur = st.current
    const r0 = colsOfSel()
    const a = M.activeOf(cur.sel)
    const f = cur.m.colFormats[a.c] || {}
    const numeric = f.type === 'number' || f.type === 'inr' || f.type === 'percent'
    const shown = M.shownDecimals(getEv().display(a.r, a.c, fmtAt(a.r, a.c)))
    const base = Number.isFinite(f.decimals) ? f.decimals : f.type === 'inr' ? 2 : shown
    const next = Math.max(0, Math.min(6, base + delta))
    patchMeta({ colFormats: M.setCols(cur.m.colFormats, r0.c1, r0.c2, { type: numeric ? f.type : 'number', decimals: next }) })
  }

  const alignAct = (al) => {
    const cur = st.current
    const r0 = colsOfSel()
    const now = cur.m.colAlign[M.activeOf(cur.sel).c]
    patchMeta({ colAlign: M.setCols(cur.m.colAlign, r0.c1, r0.c2, now === al ? undefined : al) })
  }

  const wrapAct = () => {
    const cur = st.current
    const r0 = colsOfSel()
    const on = !cur.m.wrap[M.activeOf(cur.sel).c]
    patchMeta({ wrap: M.setCols(cur.m.wrap, r0.c1, r0.c2, on ? true : undefined) })
  }

  const headerAct = () => {
    const on = !st.current.m.header
    patchMeta({ header: on })
    showFlash(on ? 'First row is the header row' : 'First row is data')
  }

  const setFreeze = (r, c) => patchMeta({ freezeRows: r, freezeCols: c })

  const fitWidth = (c) => {
    const cur = st.current
    const evNow = getEv()
    const font = fontRef.current
    let w = textWidth(colName(c), font)
    const n = Math.min(cur.grid.length, 3000)
    for (let r = 0; r < n; r++) {
      if ((cur.grid[r][c] ?? '') === '') continue
      const text = evNow.display(r, c, fmtAt(r, c))
      let tw = 0
      for (const part of String(text).split('\n')) tw = Math.max(tw, textWidth(part, font))
      if (cur.m.header && r === 0) tw *= 1.08
      if (tw > w) w = tw
    }
    return M.clampWidth(w + 22)
  }
  const autoFit = (c) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const all = wholeCols(r0) && c >= r0.c1 && c <= r0.c2
    patchMeta({ colWidths: M.setCols(cur.m.colWidths, all ? r0.c1 : c, all ? r0.c2 : c, fitWidth(c)) })
  }

  // Column width from the keyboard, a menu or the toolbar (the header's
  // drag grip needs a mouse).
  const widthCols = () => {
    const r0 = M.rangeOf(st.current.sel)
    return { c1: r0.c1, c2: r0.c2 }
  }
  const setWidth = (c1, c2, w) => {
    patchMeta({ colWidths: M.setCols(st.current.m.colWidths, c1, c2, M.clampWidth(w)) })
  }
  const nudgeWidth = (delta) => {
    const { c1, c2 } = widthCols()
    const L = st.current.layout
    const c = M.activeOf(st.current.sel).c
    setWidth(c1, c2, L.colLeft[c + 1] - L.colLeft[c] + delta)
  }
  const fitCols = () => {
    const { c1, c2 } = widthCols()
    let map = st.current.m.colWidths
    for (let c = c1; c <= c2; c++) map = M.setCols(map, c, c, fitWidth(c))
    patchMeta({ colWidths: map })
  }
  const widthFocus = useRef(false)
  const openWidth = () => {
    const { c1, c2 } = widthCols()
    const L = st.current.layout
    const c = M.activeOf(st.current.sel).c
    widthFocus.current = true
    setWidthEdit({ c1, c2, value: String(Math.round(L.colLeft[c + 1] - L.colLeft[c])) })
  }
  const applyWidth = () => {
    const we = widthEdit
    const n = Number(we?.value)
    if (!we || !Number.isFinite(n)) return
    setWidth(we.c1, we.c2, n)
    setWidthEdit(null)
    focusGrid()
  }

  const autoSumAct = () => {
    const cur = st.current
    const evNow = getEv()
    let r0 = M.rangeOf(cur.sel)
    if (r0.r1 === r0.r2 && r0.c1 === r0.c2) {
      const box = M.autoSumRange(evNow, r0.r1, r0.c1)
      if (!box) {
        beginEdit('=SUM()', 'enter')
        caretReq.current = 5
        setCaret(5)
        return
      }
      const name = M.rangeName(box)
      const text = `=SUM(${name})`
      beginEdit(text, 'enter')
      const np = { start: 5, end: 5 + name.length, ar: box.r1, ac: box.c1, fr: box.r2, fc: box.c2 }
      st.current.point = np
      setPoint(np)
      caretReq.current = np.end
      setCaret(np.end)
      return
    }
    let g = cur.grid
    let mt = cur.meta
    let out
    // A selection running into the blank margin ends at its last data.
    let r2 = Math.min(r0.r2, g.length - 1)
    while (r2 > r0.r1 && !g[r2].slice(r0.c1, r0.c2 + 1).some(v => v !== '')) r2--
    let c2 = Math.min(r0.c2, g[0].length - 1)
    while (c2 > r0.c1 && !g.slice(r0.r1, r2 + 1).some(row => (row[c2] ?? '') !== '')) c2--
    if (r0.r1 >= g.length || r0.c1 >= g[0].length) return
    if (r0.r2 >= g.length || r0.c2 >= g[0].length) r0 = { ...r0, r2, c2 }
    if (r0.r1 !== r0.r2) {
      const r = r0.r2 + 1
      if (r < g.length && g[r].slice(r0.c1, r0.c2 + 1).some(v => v !== '')) g = insertRows(g, r, 1)
      const sums = []
      for (let c = r0.c1; c <= r0.c2; c++) sums.push(`=SUM(${M.rangeName({ r1: r0.r1, c1: c, r2: r0.r2, c2: c })})`)
      g = M.writeBlock(g, r, r0.c1, [sums])
      out = { ar: r, ac: r0.c1, fr: r, fc: r0.c2 }
    } else {
      const c = r0.c2 + 1
      if (c < g[0].length && (g[r0.r1]?.[c] ?? '') !== '') {
        g = insertCols(g, c, 1)
        if (mt) mt = M.shiftMetaCols(mt, c, 1, shiftColMeta)
      }
      g = M.writeBlock(g, r0.r1, c, [[`=SUM(${M.rangeName(r0)})`]])
      out = M.cellSel(r0.r1, c)
    }
    apply({ grid: g, meta: mt, sel: out })
    scrollReq.current = true
  }

  const findFocus = useRef(false)
  const openFind = () => {
    findFocus.current = true
    setFindQ(q => q ?? '')
  }
  useLayoutEffect(() => {
    if (!findFocus.current || !findRef.current) return
    findFocus.current = false
    findRef.current.focus()
    findRef.current.select()
  })
  const closeFind = () => {
    setFindQ(null)
    focusGrid()
  }

  const replaceWith = (g) => {
    const cur = st.current
    const mt = cur.meta ? M.patchMeta(cur.meta, { colWidths: {}, colFormats: {}, colAlign: {}, wrap: {} }) : cur.meta
    apply({ grid: g, meta: mt, sel: M.cellSel(0, 0) })
    setPending(null)
    scrollReq.current = true
    focusGrid()
    showFlash(`Imported ${plural(g.length, 'row', 'rows')} × ${plural(g[0].length, 'column', 'columns')}`)
  }

  const importFile = (file) => {
    if (file.size > MAX_IMPORT) { showFlash('That file is larger than 5 MB.'); return }
    const read = file.text ? file.text() : new Response(file).text()
    read.then((text) => {
      const tsv = /\.tsv$/i.test(file.name) || (!text.includes(',') && text.includes('\t'))
      const g = tsv ? parseTSV(text) : csvToGrid(text)
      if (!g.length || M.isBlankGrid(g)) { showFlash('That file has no data.'); return }
      if (M.isBlankGrid(st.current.grid)) replaceWith(g)
      else setPending({ grid: g, name: file.name })
    }, () => showFlash('That file could not be read.'))
  }

  const download = () => {
    const cur = st.current
    const evNow = getEv()
    const out = cur.grid.map((row, r) => row.map((_, c) => {
      const f = fmtAt(r, c)
      return evNow.display(r, c, f && f.type === 'date' ? f : undefined)
    }))
    downloadBlob(new Blob(['﻿' + toCsv(out)], { type: 'text/csv;charset=utf-8' }), `${safeFileName(fileName)}.csv`)
  }

  const undo = () => {
    if (st.current.edit) { cancelEdit(); return }
    const cur = st.current
    const prev = history.undo({ grid: cur.grid, meta: cur.meta, sel: cur.sel })
    if (prev) { apply(prev, false); scrollReq.current = true; setFlash('') } else showFlash('Nothing to undo')
  }
  const redo = () => {
    if (st.current.edit) return
    const cur = st.current
    const next = history.redo({ grid: cur.grid, meta: cur.meta, sel: cur.sel })
    if (next) { apply(next, false); scrollReq.current = true; setFlash('') }
  }

  // ── Menus ────────────────────────────────────────────────────────────────
  const menuItems = (kind) => {
    const r0 = M.rangeOf(st.current.sel)
    const g = st.current.grid
    const lastR = Math.max(r0.r1, Math.min(r0.r2, g.length - 1))
    const lastC = Math.max(r0.c1, Math.min(r0.c2, g[0].length - 1))
    const nr = lastR - r0.r1 + 1
    const nc = lastC - r0.c1 + 1
    const rowCount = wholeCols(r0) ? 1 : r0.r2 - r0.r1 + 1
    const colCount = wholeRows(r0) ? 1 : r0.c2 - r0.c1 + 1
    const clip = [
      { label: 'Cut', icon: Scissors, shortcut: shortcut('Mod+X'), onSelect: () => clipboardAction('cut') },
      { label: 'Copy', icon: Copy, shortcut: shortcut('Mod+C'), onSelect: () => clipboardAction('copy') },
      { label: 'Paste', icon: ClipboardPaste, shortcut: shortcut('Mod+V'), onSelect: pasteFromMenu },
    ]
    const rowItems = [
      { label: rowCount > 1 ? `Insert ${rowCount} rows above` : 'Insert row above', icon: BetweenHorizontalStart, onSelect: () => insertRowsAct(false) },
      { label: rowCount > 1 ? `Insert ${rowCount} rows below` : 'Insert row below', icon: BetweenHorizontalEnd, onSelect: () => insertRowsAct(true) },
      { label: nr > 1 ? `Delete rows ${r0.r1 + 1}–${lastR + 1}` : `Delete row ${r0.r1 + 1}`, icon: Trash2, onSelect: deleteRowsAct },
    ]
    const colItems = [
      { label: colCount > 1 ? `Insert ${colCount} columns left` : 'Insert column left', icon: BetweenVerticalStart, onSelect: () => insertColsAct(false) },
      { label: colCount > 1 ? `Insert ${colCount} columns right` : 'Insert column right', icon: BetweenVerticalEnd, onSelect: () => insertColsAct(true) },
      { label: nc > 1 ? `Delete columns ${colName(r0.c1)}–${colName(lastC)}` : `Delete column ${colName(r0.c1)}`, icon: Trash2, onSelect: deleteColsAct },
    ]
    const widthItems = [
      'sep',
      { label: r0.c2 > r0.c1 ? 'Fit columns to contents' : 'Fit column to contents', icon: ChevronsLeftRight, onSelect: fitCols },
      { label: 'Column width…', icon: MoveHorizontal, onSelect: openWidth },
    ]
    const tail = [
      'sep',
      { label: 'Clear contents', icon: Eraser, shortcut: 'Del', onSelect: clearRange },
      'sep',
      { label: 'Sort A → Z', icon: ArrowDownAZ, onSelect: () => sortAct(true) },
      { label: 'Sort Z → A', icon: ArrowDownZA, onSelect: () => sortAct(false) },
    ]
    if (kind === 'row') return [...clip, 'sep', ...rowItems, 'sep', { label: 'Clear contents', icon: Eraser, shortcut: 'Del', onSelect: clearRange }]
    if (kind === 'col') return [...clip, 'sep', ...colItems, ...widthItems, ...tail]
    return [...clip, 'sep', ...rowItems, 'sep', ...colItems, ...tail]
  }

  // A menu opened from a toolbar button with the keyboard hands focus back to
  // that button when it closes; one opened from the grid returns to the grid.
  const closeMenu = useCallback(() => {
    const opener = st.current.menu?.opener
    setMenu(null)
    if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    else focusGrid()
  }, [focusGrid])

  const openMenuAtCell = () => {
    const cur = st.current
    const a = M.activeOf(cur.sel)
    const sc = scrollRef.current
    const L = cur.layout
    const rect = sc ? sc.getBoundingClientRect() : { left: 0, top: 0 }
    let x = L.rowNumW + L.colLeft[a.c] + (L.colLeft[a.c + 1] - L.colLeft[a.c]) / 2
    let y = HEAD_H + L.rowY(a.r) + L.rowH(a.r)
    if (a.c >= L.fc) x -= sc?.scrollLeft || 0
    if (a.r >= L.fr) y -= sc?.scrollTop || 0
    setMenu({ x: rect.left + x, y: rect.top + y, items: menuItems('cell'), label: 'Cell actions', fromGrid: true, keyboard: true })
  }

  const freezeMenu = (anchor, keyboard) => {
    const cur = st.current
    const a = M.activeOf(cur.sel)
    const { fr, fc } = { fr: cur.m.freezeRows, fc: cur.m.freezeCols }
    const custom = !(fr === 0 && fc === 0) && !(fr === 1 && fc === 0) && !(fr === 1 && fc === 1)
    const rect = anchor.getBoundingClientRect()
    setMenu({
      x: rect.left, y: rect.bottom + 4, label: 'Freeze', keyboard, kind: 'freeze', opener: keyboard ? anchor : null,
      items: [
        { label: 'No frozen rows or columns', checked: fr === 0 && fc === 0, onSelect: () => setFreeze(0, 0) },
        { label: 'Freeze first row', checked: fr === 1 && fc === 0, onSelect: () => setFreeze(1, 0) },
        { label: 'Freeze first row and column', checked: fr === 1 && fc === 1, onSelect: () => setFreeze(1, 1) },
        {
          label: a.r || a.c ? `Freeze above and left of ${cellName(a.r, a.c)}` : 'Freeze above and left of the active cell',
          checked: custom, disabled: !a.r && !a.c, onSelect: () => setFreeze(a.r, a.c),
        },
      ],
    })
  }

  const moreMenu = (anchor, keyboard) => {
    const rect = anchor.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 4, items: menuItems('cell'), label: 'Cell actions', keyboard, kind: 'more', opener: keyboard ? anchor : null })
  }

  // ── Find ─────────────────────────────────────────────────────────────────
  const findText = useDebounced(findQ, 120)
  const matches = useMemo(() => {
    if (!findText) return null
    const q = findText.toLowerCase()
    const out = []
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '') continue
        const text = ev.display(r, c, m.header && r === 0 ? undefined : m.colFormats[c])
        if (String(text).toLowerCase().includes(q)) out.push([r, c])
      }
    }
    return out
  }, [findText, grid, ev, m])
  const found = useMemo(() => {
    if (!matches) return null
    const map = new Map()
    for (const [r, c] of matches) {
      const list = map.get(r)
      if (list) list.push(c)
      else map.set(r, [c])
    }
    return map
  }, [matches])

  const goToMatch = (list, i) => {
    if (!list || !list.length) return
    const k = ((i % list.length) + list.length) % list.length
    tabStart.current = null
    setFindIdx(k)
    setSelNow(M.cellSel(list[k][0], list[k][1]))
    scrollReq.current = true
  }

  const lastFind = useRef(null)
  useEffect(() => {
    if (lastFind.current === findText) return
    lastFind.current = findText
    if (!matches || !matches.length) { setFindIdx(0); return }
    const a = M.activeOf(st.current.sel)
    let i = matches.findIndex(([r, c]) => r > a.r || (r === a.r && c >= a.c))
    if (i < 0) i = 0
    goToMatch(matches, i)
  }, [matches]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ─────────────────────────────────────────────────────────────
  // Typing a row with Tab and ending it with Enter goes to the next row's
  // first column of that run, as in Excel; tabStart remembers that column.
  const noteTab = (c, back, single) => {
    if (!single) { tabStart.current = null; return }
    if (back) { if (tabStart.current != null && c - 1 < tabStart.current) tabStart.current = null }
    else if (tabStart.current == null) tabStart.current = c
  }

  const selectKey = (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const lower = k.length === 1 ? k.toLowerCase() : k
    const pageRows = Math.max(1, Math.floor(((st.current.view.h || 600) - HEAD_H - st.current.layout.frozenH) / ROW_H) - 1)
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[k] && e.altKey && e.shiftKey && !mod && arrows[k][1]) {
      e.preventDefault()
      nudgeWidth(arrows[k][1] * 8)
      return
    }
    if (arrows[k] && !e.altKey) {
      e.preventDefault()
      moveSel(arrows[k][0], arrows[k][1], e.shiftKey, mod)
      return
    }
    if (e.altKey && (k === '=' || (e.code === 'Equal' && !e.shiftKey))) { e.preventDefault(); autoSumAct(); return }
    if (mod) {
      if (lower === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (lower === 'y') { e.preventDefault(); redo() }
      else if (lower === 'a') { e.preventDefault(); selectAll() }
      else if (lower === 'd') { e.preventDefault(); fillCopyAct('down') }
      else if (lower === 'r') { e.preventDefault(); fillCopyAct('right') }
      else if (lower === 'f') { e.preventDefault(); openFind() }
      else if (k === ' ') { e.preventDefault(); const r0 = M.rangeOf(st.current.sel); selectCols(r0.c1, r0.c2) }
      else if (k === 'Home') {
        e.preventDefault()
        const { fr, fc } = st.current.layout
        setSelNow(e.shiftKey ? { ...st.current.sel, fr, fc, act: null } : M.cellSel(fr, fc))
        scrollReq.current = true
      }
      else if (k === 'End') {
        e.preventDefault()
        const [r, c] = M.lastUsed(st.current.grid)
        setSelNow(e.shiftKey ? { ...st.current.sel, fr: r, fc: c, act: null } : M.cellSel(r, c))
        scrollReq.current = true
      } else if (lower === 'c' || lower === 'x' || lower === 'v') {
        const ta = taRef.current
        if (ta && document.activeElement === ta && lower !== 'v') { ta.value = ' '; ta.select() }
      }
      return
    }
    switch (k) {
      case 'Tab': {
        const s0 = st.current.sel
        const r0 = M.rangeOf(s0)
        const a = M.activeOf(s0)
        const single = r0.r1 === r0.r2 && r0.c1 === r0.c2
        // At the edge of the sheet Tab leaves the grid for the next control.
        if (single && (e.shiftKey ? a.c === 0 : a.c >= sizeOf(st.current.grid).cols - 1)) { tabStart.current = null; return }
        e.preventDefault()
        noteTab(a.c, e.shiftKey, single)
        setSelNow(stepSel(s0, 0, e.shiftKey ? -1 : 1, st.current.grid))
        scrollReq.current = true
        return
      }
      case 'Enter':
        e.preventDefault()
        if (e.shiftKey) { tabStart.current = null; setSelNow(stepSel(st.current.sel, -1, 0, st.current.grid)); scrollReq.current = true }
        else if (tabStart.current != null) {
          const a = M.activeOf(st.current.sel)
          const vz = sizeOf(st.current.grid)
          setSelNow(M.cellSel(Math.min(vz.rows - 1, a.r + 1), tabStart.current))
          tabStart.current = null
          scrollReq.current = true
        } else beginEdit(undefined, 'edit')
        return
      case 'F2':
        e.preventDefault()
        beginEdit(undefined, 'edit')
        return
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        clearRange()
        return
      case 'Home':
        e.preventDefault()
        moveSel(0, -st.current.layout.cols, e.shiftKey, false)
        return
      case 'End': {
        e.preventDefault()
        const s0 = st.current.sel
        const from = e.shiftKey ? s0.fc : M.activeOf(s0).c
        moveSel(0, Math.max(0, st.current.grid[0].length - 1) - from, e.shiftKey, false)
        return
      }
      case 'PageDown':
      case 'PageUp':
        e.preventDefault()
        moveSel(k === 'PageDown' ? pageRows : -pageRows, 0, e.shiftKey, false)
        return
      case 'Escape':
        e.preventDefault()
        if (findQ !== null) closeFind()
        else if (st.current.cut) { cancelCut(); setFlash('') }
        else {
          // Esc is the way out of the grid for the keyboard: to the toolbar.
          setFlash('')
          rootRef.current?.querySelector('.ft-sheet-bar button:not(:disabled), .ft-sheet-bar select')?.focus()
        }
        return
      case 'ContextMenu':
        e.preventDefault()
        openMenuAtCell()
        return
      case 'F10':
        if (e.shiftKey) { e.preventDefault(); openMenuAtCell() }
        return
      case ' ':
        if (e.shiftKey) { e.preventDefault(); const r0 = M.rangeOf(st.current.sel); selectRows(r0.r1, r0.r2) }
        return
      default:
    }
    if (k.length === 1 && !e.altKey && document.activeElement !== taRef.current) {
      // Focus is on the grid itself (after a tap): start editing with this key.
      e.preventDefault()
      beginEdit(k, 'enter')
    }
  }

  const editKey = (e) => {
    const cur = st.current
    const ed = cur.edit
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    const info = !acOff ? M.fnFragment(ed.text, caretNow()) : null
    if (info) {
      const n = info.matches.length
      if (k === 'ArrowDown') { e.preventDefault(); setAcIndex(i => (i + 1) % n); return }
      if (k === 'ArrowUp') { e.preventDefault(); setAcIndex(i => (i - 1 + n) % n); return }
      if ((k === 'Enter' && !e.altKey && !mod) || k === 'Tab') {
        e.preventDefault()
        pickFunction(info.matches[Math.min(acIndex, n - 1)])
        return
      }
      if (k === 'Escape') { e.preventDefault(); setAcOff(true); return }
    }
    switch (k) {
      case 'Enter':
        e.preventDefault()
        if (e.altKey) {
          const el = editEl()
          const s = el ? el.selectionStart : ed.text.length
          const t = el ? el.selectionEnd : s
          caretReq.current = s + 1
          setEditText(ed.text.slice(0, s) + '\n' + ed.text.slice(t), s + 1)
          return
        }
        if (mod) commitEdit(0, 0, 'all')
        else if (!e.shiftKey && tabStart.current != null) commitEdit(0, 0, 'walk', { r: ed.r + 1, c: tabStart.current })
        else commitEdit(e.shiftKey ? -1 : 1, 0)
        tabStart.current = null
        focusGrid()
        return
      case 'Tab': {
        // In the formula bar Tab moves on to the next control, like any other
        // field; leaving the bar commits the entry.
        if (ed.src === 'bar') return
        e.preventDefault()
        const r0 = M.rangeOf(cur.sel)
        noteTab(ed.c, e.shiftKey, r0.r1 === r0.r2 && r0.c1 === r0.c2)
        commitEdit(0, e.shiftKey ? -1 : 1)
        focusGrid()
        return
      }
      case 'Escape':
        e.preventDefault()
        cancelEdit()
        return
      case 'F2':
        e.preventDefault()
        st.current.edit = { ...ed, mode: ed.mode === 'enter' ? 'edit' : 'enter' }
        setEdit(st.current.edit)
        return
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (ed.mode !== 'enter' || e.altKey || mod) return
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k]
        if (isFormula(ed.text)) {
          if (!canPointNow()) return
          e.preventDefault()
          const p = cur.point
          const from = p ? { r: p.fr, c: p.fc } : { r: ed.r, c: ed.c }
          const vz = sizeOf(cur.grid)
          const r = Math.max(0, Math.min(vz.rows - 1, from.r + d[0]))
          const c = Math.max(0, Math.min(vz.cols - 1, from.c + d[1]))
          pointAt(r, c, e.shiftKey && !!p)
          return
        }
        e.preventDefault()
        tabStart.current = null
        commitEdit(d[0], d[1], 'collapse')
        focusGrid()
        return
      }
      default:
    }
  }

  const onKeyDown = (e) => {
    const t = e.target
    const inCell = t === taRef.current
    const inBar = t === fxRef.current
    if (!inCell && !inBar && t !== rootRef.current && t !== scrollRef.current) return
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    if (st.current.edit) { editKey(e); return }
    if (inBar) return
    selectKey(e)
  }

  // ── Typing into the hidden cell editor ───────────────────────────────────
  const onCellInput = (e) => {
    const text = e.target.value
    const pos = e.target.selectionStart ?? text.length
    if (!st.current.edit) {
      const cur = st.current
      const a = M.activeOf(cur.sel)
      const ed = { r: a.r, c: a.c, text, mode: 'enter', src: 'cell', orig: cur.grid[a.r]?.[a.c] ?? '' }
      st.current.edit = ed
      setEdit(ed)
      setPoint(null)
      setAcOff(false)
      setAcIndex(0)
      setCaret(pos)
      scrollReq.current = 'edit'
      setMenu(null)
      return
    }
    setEditText(text, pos)
    setAcIndex(0)
  }

  const onCompositionStart = () => {
    if (!st.current.edit) beginEdit('', 'enter')
  }

  // Focus leaving for anything but the other edit box commits the entry, as a
  // click elsewhere does in Excel; switching windows does not.
  const onEditorBlur = (e) => {
    const to = e.relatedTarget
    if (!st.current.edit) return
    if (to && (to === taRef.current || to === fxRef.current)) return
    if (to && to.closest?.('.ft-sheet-ac, .ft-sheet-menu')) return
    if (!to && typeof document.hasFocus === 'function' && !document.hasFocus()) return
    commitEdit()
  }

  const trackCaret = (e) => {
    if (st.current.edit) setCaret(e.target.selectionStart ?? 0)
  }

  // ── Pointer: select, drag, fill, resize, point ───────────────────────────
  const hitAt = (x, y, target) => {
    const el = target && target.closest ? target.closest('[data-k]') : null
    if (el && scrollRef.current?.contains(el)) {
      if (el.dataset.k === 'cell') return { r: +el.dataset.r, c: +el.dataset.c }
    }
    const sc = scrollRef.current
    const L = st.current.layout
    const rect = sc.getBoundingClientRect()
    let cx = x - rect.left - L.rowNumW
    let cy = y - rect.top - HEAD_H
    if (cx >= L.frozenW) cx += sc.scrollLeft
    if (cy >= L.frozenH) cy += sc.scrollTop
    const hit = { r: L.findRow(Math.max(0, cy)), c: L.findCol(Math.max(0, cx)) }
    if (el && el.dataset.k === 'col') hit.c = +el.dataset.c
    if (el && el.dataset.k === 'row') hit.r = +el.dataset.r
    return hit
  }

  const dragMove = (x, y, target) => {
    const d = dragRef.current
    if (!d) return
    d.x = x
    d.y = y
    if (d.k === 'resize') {
      const w = M.clampWidth(d.w + x - d.x0)
      if (w !== d.live) { d.live = w; setLiveW({ c: d.c, w }) }
      return
    }
    const hit = hitAt(x, y, target)
    const cur = st.current
    if (d.k === 'cells') {
      const s = cur.sel
      if (s.fr !== hit.r || s.fc !== hit.c) setSelNow({ ar: s.ar, ac: s.ac, fr: hit.r, fc: hit.c })
    } else if (d.k === 'cols') {
      const s = cur.sel
      if (s.fc !== hit.c) setSelNow({ ar: 0, ac: d.c, fr: sizeOf(cur.grid).rows - 1, fc: hit.c })
    } else if (d.k === 'rows') {
      const s = cur.sel
      if (s.fr !== hit.r) setSelNow({ ar: d.r, ac: 0, fr: hit.r, fc: sizeOf(cur.grid).cols - 1 })
    } else if (d.k === 'point') {
      const p = cur.point
      if (p && (p.fr !== hit.r || p.fc !== hit.c)) pointAt(hit.r, hit.c, true)
    } else if (d.k === 'fill') {
      const r0 = M.rangeOf(cur.sel)
      const down = hit.r - r0.r2
      const up = r0.r1 - hit.r
      const right = hit.c - r0.c2
      const left = r0.c1 - hit.c
      const best = Math.max(down, up, right, left)
      let t = null
      if (best > 0) {
        if (best === down) t = { r: hit.r, c: r0.c2, box: { ...r0, r2: hit.r } }
        else if (best === up) t = { r: hit.r, c: r0.c1, box: { ...r0, r1: hit.r } }
        else if (best === right) t = { r: r0.r2, c: hit.c, box: { ...r0, c2: hit.c } }
        else t = { r: r0.r1, c: hit.c, box: { ...r0, c1: hit.c } }
      }
      d.target = t
      setPreview(t ? t.box : null)
    }
  }

  const endDrag = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    cancelAnimationFrame(d.raf)
    window.removeEventListener('pointermove', d.onMove)
    window.removeEventListener('pointerup', d.onUp)
    window.removeEventListener('pointercancel', d.onUp)
    const cur = st.current
    if (d.k === 'resize') {
      setLiveW(null)
      if (d.live && d.live !== d.w) {
        const r0 = M.rangeOf(cur.sel)
        const all = wholeCols(r0) && d.c >= r0.c1 && d.c <= r0.c2
        patchMeta({ colWidths: M.setCols(cur.m.colWidths, all ? r0.c1 : d.c, all ? r0.c2 : d.c, d.live) })
      }
    } else if (d.k === 'fill') {
      setPreview(null)
      if (d.target) {
        const r0 = M.rangeOf(cur.sel)
        const box = d.target.box
        const res = M.fillTo(M.ensureSize(cur.grid, box.r2 + 1, box.c2 + 1), r0, d.target.r, d.target.c)
        if (res) apply({ grid: res.grid, sel: { ar: res.range.r1, ac: res.range.c1, fr: res.range.r2, fc: res.range.c2 } })
      }
    }
    focusGrid()
  }

  const startDrag = (d, x, y) => {
    d.x = x
    d.y = y
    d.onMove = ev2 => dragMove(ev2.clientX, ev2.clientY, ev2.target)
    d.onUp = () => endDrag()
    dragRef.current = d
    window.addEventListener('pointermove', d.onMove)
    window.addEventListener('pointerup', d.onUp)
    window.addEventListener('pointercancel', d.onUp)
    const tick = () => {
      const cur = dragRef.current
      if (cur !== d) return
      const sc = scrollRef.current
      if (sc && d.k !== 'resize') {
        const rect = sc.getBoundingClientRect()
        const L = st.current.layout
        let dy = 0
        let dx = 0
        if (d.k !== 'cols') {
          if (d.y > rect.bottom - 8) dy = Math.min(48, (d.y - rect.bottom + 8) / 2)
          else if (d.y < rect.top + HEAD_H && sc.scrollTop > 0) dy = -Math.min(48, (rect.top + HEAD_H - d.y) / 2)
        }
        if (d.k !== 'rows') {
          if (d.x > rect.right - 8) dx = Math.min(48, (d.x - rect.right + 8) / 2)
          else if (d.x < rect.left + L.rowNumW && sc.scrollLeft > 0) dx = -Math.min(48, (rect.left + L.rowNumW - d.x) / 2)
        }
        if (dy || dx) {
          sc.scrollTop += dy
          sc.scrollLeft += dx
          dragMove(d.x, d.y, null)
        }
      }
      d.raf = requestAnimationFrame(tick)
    }
    d.raf = requestAnimationFrame(tick)
  }

  const contextSelect = (el) => {
    const cur = st.current
    const r0 = M.rangeOf(cur.sel)
    const k = el.dataset.k
    if (k === 'cell') {
      const r = +el.dataset.r
      const c = +el.dataset.c
      if (r < r0.r1 || r > r0.r2 || c < r0.c1 || c > r0.c2) setSelNow(M.cellSel(r, c))
    } else if (k === 'col') {
      const c = +el.dataset.c
      if (!(wholeCols(r0) && c >= r0.c1 && c <= r0.c2)) selectCols(c, c)
    } else if (k === 'row') {
      const r = +el.dataset.r
      if (!(wholeRows(r0) && r >= r0.r1 && r <= r0.r2)) selectRows(r, r)
    }
  }

  // A press on the scroller's own scrollbars is left alone.
  const onScrollbar = (e) => {
    const sc = scrollRef.current
    return e.target === sc && (e.nativeEvent.offsetX >= sc.clientWidth || e.nativeEvent.offsetY >= sc.clientHeight)
  }

  const onPointerDown = (e) => {
    pointerType.current = e.pointerType || 'mouse'
    if (onScrollbar(e)) return
    const t = e.target
    if (t === taRef.current) return
    const el = t.closest?.('[data-k]')
    if (!el || !scrollRef.current?.contains(el)) {
      if (scrollRef.current?.contains(t) && e.button === 0 && e.pointerType !== 'touch') {
        if (st.current.edit) commitEdit()
        focusGrid()
      }
      return
    }
    const k = el.dataset.k
    const cur = st.current
    if (k === 'more') return
    if (k === 'fill' || k === 'resize') {
      if (e.button !== 0) return
      e.stopPropagation()
      if (cur.edit) commitEdit()
      if (k === 'resize') {
        const c = +el.dataset.c
        const w = cur.layout.colLeft[c + 1] - cur.layout.colLeft[c]
        startDrag({ k, c, w, x0: e.clientX, live: w }, e.clientX, e.clientY)
      } else startDrag({ k }, e.clientX, e.clientY)
      return
    }
    if (e.pointerType === 'touch') return
    if (e.button === 2) {
      if (cur.edit) commitEdit()
      contextSelect(el)
      return
    }
    if (e.button !== 0) return
    if (k === 'cell') {
      const r = +el.dataset.r
      const c = +el.dataset.c
      if (cur.edit) {
        if (canPointNow()) {
          pointAt(r, c, e.shiftKey && !!cur.point)
          startDrag({ k: 'point' }, e.clientX, e.clientY)
          return
        }
        if (cur.edit.r === r && cur.edit.c === c) return
        commitEdit()
      }
      selectCell(r, c, e.shiftKey)
      startDrag({ k: 'cells' }, e.clientX, e.clientY)
    } else if (k === 'col') {
      if (cur.edit) commitEdit()
      const c = +el.dataset.c
      if (e.shiftKey) selectCols(cur.sel.ac, c)
      else selectCols(c, c)
      startDrag({ k: 'cols', c: e.shiftKey ? cur.sel.ac : c }, e.clientX, e.clientY)
    } else if (k === 'row') {
      if (cur.edit) commitEdit()
      const r = +el.dataset.r
      if (e.shiftKey) selectRows(cur.sel.ar, r)
      else selectRows(r, r)
      startDrag({ k: 'rows', r: e.shiftKey ? cur.sel.ar : r }, e.clientX, e.clientY)
    } else if (k === 'corner') {
      if (cur.edit) commitEdit()
      selectAll()
    }
    focusGrid()
  }

  const onMouseDown = (e) => {
    if (e.target === taRef.current && st.current.edit) return
    const el = e.target.closest?.('[data-k]')
    if (el?.dataset.k === 'more' || onScrollbar(e)) return
    if (scrollRef.current?.contains(e.target)) e.preventDefault()
  }

  const onClick = (e) => {
    if (pointerType.current !== 'touch') return
    const el = e.target.closest?.('[data-k]')
    if (!el || !scrollRef.current?.contains(el)) return
    const k = el.dataset.k
    const cur = st.current
    if (k === 'cell') {
      const r = +el.dataset.r
      const c = +el.dataset.c
      if (cur.edit) {
        if (canPointNow()) { pointAt(r, c, false); return }
        if (cur.edit.r === r && cur.edit.c === c) return
        commitEdit()
      }
      const a = M.activeOf(cur.sel)
      const r0 = M.rangeOf(cur.sel)
      if (!cur.edit && a.r === r && a.c === c && r0.r1 === r0.r2 && r0.c1 === r0.c2) {
        taRef.current?.focus({ preventScroll: true })
        beginEdit(undefined, 'edit')
        return
      }
      selectCell(r, c, false)
      rootRef.current?.focus({ preventScroll: true })
    } else if (k === 'col') { if (cur.edit) commitEdit(); selectCols(+el.dataset.c, +el.dataset.c) }
    else if (k === 'row') { if (cur.edit) commitEdit(); selectRows(+el.dataset.r, +el.dataset.r) }
    else if (k === 'corner') { if (cur.edit) commitEdit(); selectAll() }
  }

  const onDoubleClick = (e) => {
    const el = e.target.closest?.('[data-k]')
    if (!el || !scrollRef.current?.contains(el)) return
    const k = el.dataset.k
    if (k === 'cell' && !st.current.edit) beginEdit(undefined, 'edit')
    else if (k === 'resize') autoFit(+el.dataset.c)
    else if (k === 'fill') fillAuto()
  }

  const onContextMenu = (e) => {
    if (e.target === taRef.current && st.current.edit) return
    const el = e.target.closest?.('[data-k]')
    if (!el || !scrollRef.current?.contains(el)) return
    e.preventDefault()
    if (st.current.edit) commitEdit()
    if (pointerType.current === 'touch') contextSelect(el)
    const k = el.dataset.k
    const kind = k === 'col' ? 'col' : k === 'row' ? 'row' : 'cell'
    setMenu({ x: e.clientX, y: e.clientY, items: menuItems(kind), label: kind === 'col' ? 'Column actions' : kind === 'row' ? 'Row actions' : 'Cell actions', fromGrid: true })
  }

  // ── Toolbar wiring ───────────────────────────────────────────────────────
  const fns = useRef({})
  // A toolbar control used from the keyboard keeps focus, so the next one is
  // a Tab away; a click sends focus back to the grid for typing.
  const run = fn => (...args) => {
    if (st.current.edit) commitEdit()
    fn(...args)
    const fromBar = keyboardUse.current && rootRef.current?.querySelector('.ft-sheet-bar')?.contains(document.activeElement)
    if (!st.current.edit && !fromBar) focusGrid()
  }
  fns.current = {
    undo: run(undo), redo: run(redo),
    insertRows: run(insertRowsAct), insertCols: run(insertColsAct),
    deleteRows: run(deleteRowsAct), deleteCols: run(deleteColsAct),
    sort: run(sortAct), format: run(formatAct), decimals: run(decimalsAct),
    align: run(alignAct), wrap: run(wrapAct), header: run(headerAct),
    freezeMenu: (el, keyboard) => { if (st.current.edit) commitEdit(); freezeMenu(el, keyboard) },
    moreMenu: (el, keyboard) => { if (st.current.edit) commitEdit(); moreMenu(el, keyboard) },
    autoSum: run(autoSumAct),
    find: () => { if (st.current.edit) commitEdit(); openFind() },
    width: () => { if (st.current.edit) commitEdit(); openWidth() },
    importFile: run(importFile), download: run(download),
  }
  const act = useMemo(() => {
    const out = {}
    for (const name of Object.keys(fns.current)) out[name] = (...a) => fns.current[name](...a)
    return out
  }, [])

  const colFmt = m.colFormats[active.c]
  const menuFor = menu?.kind || null
  const toolbarState = useMemo(() => ({
    canUndo: history.canUndo, canRedo: history.canRedo,
    format: colFmt, align: m.colAlign[active.c], wrap: !!m.wrap[active.c], header: m.header,
    multiRows: rg.r2 > rg.r1, multiCols: rg.c2 > rg.c1, menuFor,
  }), [history.canUndo, history.canRedo, colFmt, m, active.c, rg.r1, rg.r2, rg.c1, rg.c2, menuFor])

  // ── Name box ─────────────────────────────────────────────────────────────
  const goTo = (text) => {
    const box = parseRange(text, size)
    if (!box || box.r1 < 0 || box.c1 < 0) { showFlash('Enter a cell such as B3 or a range such as B2:D9'); return false }
    const r1 = Math.min(box.r1, size.rows - 1)
    const c1 = Math.min(box.c1, size.cols - 1)
    tabStart.current = null
    setSelNow({ ar: r1, ac: c1, fr: Math.min(box.r2, size.rows - 1), fc: Math.min(box.c2, size.cols - 1) })
    scrollReq.current = true
    return true
  }

  // ── Derived view state ───────────────────────────────────────────────────
  const multi = rg.r1 !== rg.r2 || rg.c1 !== rg.c2
  const stats = useMemo(() => (multi ? M.rangeStats(ev, rg) : null), [ev, multi, rg.r1, rg.r2, rg.c1, rg.c2]) // eslint-disable-line react-hooks/exhaustive-deps
  const statFmt = sharedFormat(m, rg.c1, rg.c2)
  const findCur = matches && matches.length ? matches[Math.min(findIdx, matches.length - 1)] : null

  // Tells screen readers where the selection is: the active cell and its
  // value, or the range with its sum while Shift+arrows extend it.
  useEffect(() => {
    const t = setTimeout(() => {
      if (multi) {
        const n = (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1)
        const sum = stats && stats.nums > 0 ? `, sum ${statText(stats.sum, statFmt)}` : ''
        setAnnounce(`${M.rangeName(rg)} selected, ${n.toLocaleString('en-IN')} cells${sum}`)
        return
      }
      const raw = grid[active.r]?.[active.c] ?? ''
      const shown = ev.display(active.r, active.c, m.header && active.r === 0 ? undefined : m.colFormats[active.c])
      setAnnounce(`${cellName(active.r, active.c)}, ${raw === '' ? 'blank' : shown}${isFormula(raw) ? `, formula ${raw}` : ''}`)
    }, 120)
    return () => clearTimeout(t)
  }, [active.r, active.c, ev, m, grid, multi, rg.r1, rg.r2, rg.c1, rg.c2, stats, statFmt]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!widthFocus.current) return
    widthFocus.current = false
    const el = rootRef.current?.querySelector('.ft-sheet-widthin')
    if (el) { el.focus(); el.select() }
  })

  const L = layout
  const ec = edit ? { r: edit.r, c: edit.c } : active
  let ex = L.rowNumW + L.colLeft[ec.c]
  let ey = HEAD_H + L.rowY(ec.r)
  const frozenCell = ec.r < L.fr || ec.c < L.fc
  if (ec.c < L.fc) ex += scroll.left
  if (ec.r < L.fr) ey += scroll.top
  const cw = L.colLeft[ec.c + 1] - L.colLeft[ec.c]
  const ch = L.rowH(ec.r)
  const edStyle = { left: ex, top: ey, width: cw, height: ch }
  if (edit) {
    // The editor grows to the right with its text but never past the visible
    // edge of the grid (that would widen the sheet and scroll it); from
    // there it wraps and grows downwards, as Excel's does.
    const lineH = isPhone ? LINE_H_PHONE : LINE_H
    const font = isPhone ? fontRef.current.replace(/^13px/, '16px') : fontRef.current
    const lines = edit.text.split('\n')
    const left = scrollRef.current ? scrollRef.current.scrollLeft : scroll.left
    const maxW = view.w ? Math.max(cw, left + view.w - ex - 2) : Infinity
    let wrapCol = !!m.wrap[ec.c]
    let width = cw
    if (!wrapCol) {
      let longest = 0
      for (const part of lines) longest = Math.max(longest, textWidth(part, font))
      width = Math.max(cw, Math.min(Math.max(cw, 520), longest + 26))
      if (width > maxW) { width = maxW; wrapCol = true }
    }
    let n = lines.length
    if (wrapCol) {
      n = 0
      for (const part of lines) n += Math.max(1, Math.ceil(textWidth(part, font) / Math.max(24, width - 18)))
    }
    edStyle.width = width
    edStyle.height = Math.max(ch, Math.min(n, 12) * lineH + 12)
    edStyle.zIndex = frozenCell ? 7 : 4
    edStyle.whiteSpace = wrapCol ? 'pre-wrap' : 'pre'
  }

  const fxValue = edit ? edit.text : grid[active.r]?.[active.c] ?? ''
  const nameValue = nameDraft ?? (edit ? cellName(edit.r, edit.c) : M.rangeName(rg))
  const showHandle = !edit && !isPhone

  return (
    <div ref={rootRef} className="ft-sheet" tabIndex={-1} style={{ height: height || '100%' }}
      onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}
      onKeyDownCapture={() => { keyboardUse.current = true }} onPointerDownCapture={() => { keyboardUse.current = false }}>
      <SheetToolbar state={toolbarState} act={act} />

      <div className="ft-sheet-fx">
        <input className="ft-sheet-name" aria-label="Cell reference" value={nameValue} spellCheck={false}
          onFocus={e => { setNameDraft(e.target.value); e.target.select() }}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={() => setNameDraft(null)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (goTo(e.target.value)) { setNameDraft(null); focusGrid() } }
            else if (e.key === 'Escape') { e.preventDefault(); setNameDraft(null); focusGrid() }
          }} />
        <span className="ft-sheet-fxlabel" aria-hidden="true">fx</span>
        <textarea ref={fxRef} className="ft-sheet-fxin" aria-label="Cell contents" value={fxValue} spellCheck={false}
          rows={Math.min(4, fxValue.split('\n').length)} wrap="off" autoComplete="off"
          placeholder={edit ? '' : 'Type a value, or a formula such as =SUM(B2:B9)'}
          onFocus={() => {
            const ed = st.current.edit
            if (!ed) beginEdit(undefined, 'edit', 'bar')
            else if (ed.src !== 'bar') { st.current.edit = { ...ed, src: 'bar', mode: 'edit' }; setEdit(st.current.edit) }
          }}
          onChange={e => { if (st.current.edit) { setEditText(e.target.value, e.target.selectionStart ?? 0); setAcIndex(0) } }}
          onSelect={trackCaret} onBlur={onEditorBlur} />
      </div>

      {pending && (
        <div className="ft-sheet-strip" role="alert">
          <span>Replace the whole sheet with <b>{pending.name}</b> ({plural(pending.grid.length, 'row', 'rows')} × {plural(pending.grid[0].length, 'column', 'columns')})? You can undo this.</span>
          <button type="button" className="ft-sheet-btn is-primary" onClick={() => replaceWith(pending.grid)}>Replace</button>
          <button type="button" className="ft-sheet-btn" onClick={() => { setPending(null); focusGrid() }}>Cancel</button>
        </div>
      )}

      {widthEdit && (
        <div className="ft-sheet-strip" role="group" aria-label="Column width">
          <label htmlFor="ft-sheet-widthin">
            Width of {widthEdit.c1 === widthEdit.c2 ? `column ${colName(widthEdit.c1)}` : `columns ${colName(widthEdit.c1)}–${colName(widthEdit.c2)}`}
          </label>
          <input id="ft-sheet-widthin" className="ft-sheet-findin ft-sheet-widthin" type="number" inputMode="numeric"
            min={M.MIN_COL_W} max={M.MAX_COL_W} step={8} value={widthEdit.value}
            onChange={e => setWidthEdit(w => ({ ...w, value: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyWidth() }
              else if (e.key === 'Escape') { e.preventDefault(); setWidthEdit(null); focusGrid() }
            }} />
          <span>px ({M.MIN_COL_W}–{M.MAX_COL_W})</span>
          <button type="button" className="ft-sheet-btn is-primary" onClick={applyWidth}>Apply</button>
          <button type="button" className="ft-sheet-btn" onClick={() => { setWidthEdit(null); focusGrid() }}>Cancel</button>
        </div>
      )}

      {findQ !== null && (
        <div className="ft-sheet-strip ft-sheet-find" role="search">
          <Search size={14} aria-hidden="true" />
          <input ref={findRef} className="ft-sheet-findin" aria-label="Find in sheet" placeholder="Find in sheet" value={findQ}
            onChange={e => setFindQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); goToMatch(matches, findIdx + (e.shiftKey ? -1 : 1)) }
              else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
              else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.currentTarget.select() }
            }} />
          <span className="ft-sheet-findcount" aria-live="polite">
            {!findText ? '' : matches && matches.length ? `${Math.min(findIdx, matches.length - 1) + 1} of ${matches.length}` : 'No matches'}
          </span>
          <button type="button" className="ft-sheet-tb" aria-label="Previous match" title="Previous match (Shift+Enter)"
            disabled={!matches?.length} onClick={() => goToMatch(matches, findIdx - 1)}><ChevronUp size={16} /></button>
          <button type="button" className="ft-sheet-tb" aria-label="Next match" title="Next match (Enter)"
            disabled={!matches?.length} onClick={() => goToMatch(matches, findIdx + 1)}><ChevronDown size={16} /></button>
          <button type="button" className="ft-sheet-tb" aria-label="Close find" title="Close (Esc)" onClick={closeFind}><X size={16} /></button>
        </div>
      )}

      <SheetGrid
        grid={grid} ev={ev} m={m} lay={layout} win={win} rg={rg} active={active} multi={multi}
        showHandle={showHandle} preview={preview} refs={refBoxes} found={found} findCur={findCur} cut={cutBox}
        scrollRef={scrollRef} onScroll={onScroll} liveC={liveW ? liveW.c : -1} label="Sheet"
        handlers={{ onPointerDown, onMouseDown, onClick, onDoubleClick, onContextMenu }}
        footer={(
          <button type="button" data-k="more" className="ft-sheet-more"
            onClick={() => { if (st.current.edit) commitEdit(); setExtraRows(n => n + 100) }}>
            + Show 100 more rows
          </button>
        )}>
        <textarea ref={taRef} className={'ft-sheet-input' + (edit ? '' : ' is-idle')} style={edStyle}
          aria-label={edit ? `Editing ${cellName(edit.r, edit.c)}` : `Cell ${cellName(active.r, active.c)}`}
          aria-autocomplete="list" aria-controls={fragment ? 'ft-sheet-ac-list' : undefined}
          aria-activedescendant={fragment ? `ft-sheet-ac-${fragment.matches[Math.min(acIndex, fragment.matches.length - 1)]}` : undefined}
          value={edit ? edit.text : ''} rows={1} wrap="off" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          onChange={onCellInput} onSelect={trackCaret} onBlur={onEditorBlur} onCompositionStart={onCompositionStart}
          onFocus={() => {
            const ed = st.current.edit
            if (ed && ed.src === 'bar') { st.current.edit = { ...ed, src: 'cell' }; setEdit(st.current.edit) }
          }} />
      </SheetGrid>

      <div className="ft-sheet-status">
        <span>{plural(rows, 'row', 'rows')} × {plural(cols, 'column', 'columns')}</span>
        {stats && stats.count > 0 && (
          <span className="ft-sheet-stats" aria-label="Selection summary">
            {stats.nums > 0 && <span>Sum <b>{statText(stats.sum, statFmt)}</b></span>}
            {stats.nums > 0 && <span>Average <b>{statText(stats.sum / stats.nums, statFmt)}</b></span>}
            <span>Count <b>{stats.count.toLocaleString('en-IN')}</b></span>
          </span>
        )}
        {flash ? <span className="ft-sheet-flash" aria-hidden="true">{flash}</span>
          : !isPhone && <span className="ft-sheet-hint">Type to replace · Enter or F2 to edit · {shortcut('Mod+C')} / {shortcut('Mod+V')} · Right-click for more · Esc to leave the grid</span>}
      </div>
      <div className="sr-only" aria-live="polite">{announce}</div>
      <div className="sr-only" role="status" aria-live="polite">{flash}</div>

      {edit && (fragment || hint) && (
        <FormulaPopup anchor={edit.src === 'bar' ? fxRef.current : taRef.current} suggest={fragment} index={acIndex} hint={hint}
          onPick={pickFunction} onHover={setAcIndex} />
      )}
      {menu && <SheetMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={closeMenu} focusFirst={!!menu.keyboard} />}
    </div>
  )
}
