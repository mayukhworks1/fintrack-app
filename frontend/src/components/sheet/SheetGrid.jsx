// The virtualised cell grid. Only the rows and columns in view (plus a small
// margin) are rendered; the column letters, row numbers and frozen rows and
// columns stay put with position: sticky, so scrolling is the browser's own.
// Selection, find matches and the ranges of the formula being edited are
// painted on the cells themselves, which keeps them right inside frozen panes.
import { memo } from 'react'
import { colName, isFormula, isErrorValue, dateSerial, ERROR_HELP } from '../../utils/sheet'
import { HEAD_H } from './editorModel'

const NONE = []
const EMPTY_ROW = []
export const REF_COLORS = ['#3b82f6', '#ef4444', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899']
const REF_TINTS = ['rgba(59,130,246,0.12)', 'rgba(239,68,68,0.12)', 'rgba(139,92,246,0.12)', 'rgba(16,185,129,0.12)', 'rgba(245,158,11,0.14)', 'rgba(236,72,153,0.12)']

function alignOf(m, c, isHead, v, text, type, err) {
  const set = m.colAlign[c]
  if (set === 'left' || set === 'center' || set === 'right') return set
  if (isHead) return 'left'
  if (err || typeof v === 'boolean') return 'center'
  if (type === 'text') return 'left'
  if (typeof v === 'number') return 'right'
  if (type === 'date' && typeof v === 'string' && text !== v && dateSerial(v) !== null) return 'right'
  return 'left'
}

const SheetRow = memo(function SheetRow({
  r, y, h, row, ev, m, lay, c0, c1, flow, edgeRow,
  selA, selB, selTop, selBottom, multi, activeC, handleC,
  prevA, prevB, prevTop, prevBottom, refs, findCols, findCur, rowHL,
}) {
  const isHead = m.header && r === 0
  const cells = []
  const cell = (c) => {
    const raw = row[c]
    const fmt = isHead ? undefined : m.colFormats[c]
    const type = fmt && fmt.type
    const text = ev.display(r, c, fmt)
    const v = ev.value(r, c)
    const err = isFormula(raw) && isErrorValue(v)
    const w = lay.colLeft[c + 1] - lay.colLeft[c]
    const style = { width: w, textAlign: alignOf(m, c, isHead, v, text, type, err) }
    let cls = 'ft-sheet-cell'
    if (isHead) cls += ' is-head'
    if (typeof v === 'number') cls += ' is-num'
    if (err) cls += ' is-err'
    if (m.wrap[c]) cls += ' is-wrap'
    if (c < lay.fc) {
      style.position = 'sticky'
      style.left = lay.rowNumW + lay.colLeft[c]
      style.zIndex = 2
      if (c === lay.fc - 1) cls += ' is-fc-edge'
    }
    const inSel = c >= selA && c <= selB
    const shadows = []
    let tint = ''
    if (inSel && multi) {
      if (selTop) shadows.push('inset 0 1px 0 var(--accent)')
      if (selBottom) shadows.push('inset 0 -1px 0 var(--accent)')
      if (c === selA) shadows.push('inset 1px 0 0 var(--accent)')
      if (c === selB) shadows.push('inset -1px 0 0 var(--accent)')
      if (c !== activeC) tint = 'var(--ft-sheet-sel)'
    }
    if (c >= prevA && c <= prevB) {
      const line = 'var(--text-3)'
      if (prevTop) shadows.push(`inset 0 1px 0 ${line}`)
      if (prevBottom) shadows.push(`inset 0 -1px 0 ${line}`)
      if (c === prevA) shadows.push(`inset 1px 0 0 ${line}`)
      if (c === prevB) shadows.push(`inset -1px 0 0 ${line}`)
    }
    for (let i = 0; i < refs.length; i++) {
      const b = refs[i]
      if (c < b.c1 || c > b.c2 || r < b.r1 || r > b.r2) continue
      const color = REF_COLORS[b.i % REF_COLORS.length]
      if (r === b.r1) shadows.push(`inset 0 2px 0 ${color}`)
      if (r === b.r2) shadows.push(`inset 0 -2px 0 ${color}`)
      if (c === b.c1) shadows.push(`inset 2px 0 0 ${color}`)
      if (c === b.c2) shadows.push(`inset -2px 0 0 ${color}`)
      tint = REF_TINTS[b.i % REF_TINTS.length]
    }
    if (findCols.length && findCols.includes(c)) {
      tint = 'var(--ft-sheet-find)'
      if (c === findCur) cls += ' is-found'
    }
    if (shadows.length) style.boxShadow = shadows.join(',')
    if (tint) style.backgroundImage = `linear-gradient(${tint},${tint})`
    const active = c === activeC
    if (active) cls += ' is-active'
    const fill = c === handleC
    if (fill) cls += ' has-fill'
    cells.push(
      <div key={c} role="gridcell" aria-colindex={c + 2} aria-selected={inSel || active}
        data-k="cell" data-r={r} data-c={c} className={cls} style={style}
        title={err ? `${v}: ${ERROR_HELP[v] || ''}` : undefined}>
        <span className="ft-sheet-txt">{text}</span>
        {fill && <span data-k="fill" className="ft-sheet-fill" aria-hidden="true" />}
      </div>
    )
  }
  for (let c = 0; c < lay.fc; c++) cell(c)
  const gap = lay.colLeft[c0] - lay.colLeft[lay.fc]
  if (gap > 0) cells.push(<div key="gap" style={{ width: gap, flex: '0 0 auto' }} aria-hidden="true" />)
  for (let c = c0; c <= c1; c++) cell(c)
  return (
    <div role="row" aria-rowindex={r + 2} className={'ft-sheet-row' + (flow ? ' is-flow' : '') + (edgeRow ? ' is-fr-edge' : '')}
      style={{ top: flow ? undefined : y, height: h, width: lay.totalW }}>
      <div role="rowheader" aria-colindex={1} data-k="row" data-r={r} className={'ft-sheet-rn' + (rowHL === 2 ? ' is-full' : rowHL ? ' is-hl' : '')}
        style={{ width: lay.rowNumW }}>{r + 1}</div>
      {cells}
    </div>
  )
})

const HeaderRow = memo(function HeaderRow({ lay, c0, c1, hlA, hlB, full, liveC, allSel }) {
  const out = []
  const head = (c) => {
    const style = { width: lay.colLeft[c + 1] - lay.colLeft[c] }
    if (c < lay.fc) { style.position = 'sticky'; style.left = lay.rowNumW + lay.colLeft[c]; style.zIndex = 2 }
    const hl = c >= hlA && c <= hlB
    out.push(
      <div key={c} role="columnheader" aria-colindex={c + 2} data-k="col" data-c={c}
        className={'ft-sheet-ch' + (hl ? (full ? ' is-full' : ' is-hl') : '') + (c === lay.fc - 1 ? ' is-fc-edge' : '')} style={style}>
        {colName(c)}
        <span data-k="resize" data-c={c} className={'ft-sheet-grip' + (liveC === c ? ' is-live' : '')} aria-hidden="true" />
      </div>
    )
  }
  for (let c = 0; c < lay.fc; c++) head(c)
  const gap = lay.colLeft[c0] - lay.colLeft[lay.fc]
  if (gap > 0) out.push(<div key="gap" style={{ width: gap, flex: '0 0 auto' }} aria-hidden="true" />)
  for (let c = c0; c <= c1; c++) head(c)
  return (
    <div role="row" aria-rowindex={1} className="ft-sheet-hrow" style={{ height: HEAD_H, width: lay.totalW }}>
      <div role="columnheader" aria-colindex={1} data-k="corner" className={'ft-sheet-corner' + (allSel ? ' is-full' : '')}
        style={{ width: lay.rowNumW }} title="Select all"><span className="sr-only">Select all</span></div>
      {out}
    </div>
  )
})

/**
 * Renders the grid. `sel` is the selection range plus the active cell,
 * `preview` the fill-handle target, `refs` the boxes of the formula being
 * edited, `found` a Map of row → matching columns, `cut` the range waiting
 * to be moved. `lay` covers the data plus the blank margin past it.
 */
export default function SheetGrid({
  grid, ev, m, lay, win, rg, active, multi, showHandle, preview, refs, found, findCur, cut,
  scrollRef, onScroll, handlers, liveC, footer, children, label,
}) {
  const rows = lay.rows
  const cols = lay.cols
  const fullCols = rg.r1 === 0 && rg.r2 >= rows - 1
  const fullRows = rg.c1 === 0 && rg.c2 >= cols - 1
  const rowProps = (r) => {
    const inRows = r >= rg.r1 && r <= rg.r2
    const p = {
      r, h: lay.rowH(r), row: grid[r] || EMPTY_ROW, ev, m, lay, c0: win.c0, c1: win.c1,
      selA: inRows ? rg.c1 : -1, selB: inRows ? rg.c2 : -2,
      selTop: inRows && r === rg.r1, selBottom: inRows && r === rg.r2, multi,
      activeC: r === active.r ? active.c : -1,
      handleC: showHandle && r === rg.r2 ? rg.c2 : -1,
      prevA: -1, prevB: -2, prevTop: false, prevBottom: false,
      refs: NONE, findCols: (found && found.get(r)) || NONE, findCur: findCur && findCur[0] === r ? findCur[1] : -1,
      rowHL: inRows ? (fullRows ? 2 : 1) : 0,
      edgeRow: r === lay.fr - 1,
    }
    if (preview && r >= preview.r1 && r <= preview.r2) {
      p.prevA = preview.c1; p.prevB = preview.c2; p.prevTop = r === preview.r1; p.prevBottom = r === preview.r2
    }
    if (refs.length && refs.some(b => r >= b.r1 && r <= b.r2)) p.refs = refs
    return p
  }
  const frozen = []
  for (let r = 0; r < lay.fr; r++) frozen.push(<SheetRow key={r} {...rowProps(r)} flow />)
  const body = []
  for (let r = win.r0; r <= win.r1; r++) body.push(<SheetRow key={r} {...rowProps(r)} y={HEAD_H + lay.rowY(r)} />)
  // The grid role sits on an element holding only rows; the cell editor and
  // the footer button are its siblings. It spans the whole sheet so the
  // sticky header rows have room to stick.
  return (
    <div ref={scrollRef} className="ft-sheet-scroll" onScroll={onScroll} {...handlers}>
      <div className="ft-sheet-sizer" style={{ width: lay.totalW, height: HEAD_H + lay.totalH + lay.footH }}>
        <div role="grid" aria-label={label} aria-rowcount={rows + 1} aria-colcount={cols + 1} aria-multiselectable="true"
          className="ft-sheet-cells" style={{ width: lay.totalW, height: HEAD_H + lay.totalH }}>
          <div role="rowgroup" className="ft-sheet-top" style={{ width: lay.totalW }}>
            <HeaderRow lay={lay} c0={win.c0} c1={win.c1} hlA={rg.c1} hlB={rg.c2} full={fullCols} liveC={liveC}
              allSel={fullCols && fullRows} />
            {frozen}
          </div>
          <div role="rowgroup">{body}</div>
        </div>
        {cut && (
          <div className="ft-sheet-cut" aria-hidden="true" style={{
            left: lay.rowNumW + lay.colLeft[cut.c1] - 2, top: HEAD_H + lay.rowY(cut.r1) - 2,
            width: lay.colLeft[Math.min(cut.c2, cols - 1) + 1] - lay.colLeft[cut.c1] + 3,
            height: lay.rowY(Math.min(cut.r2, rows - 1)) + lay.rowH(Math.min(cut.r2, rows - 1)) - lay.rowY(cut.r1) + 3,
          }} />
        )}
        {children}
        {footer && <div className="ft-sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}
