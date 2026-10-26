import { memo, useMemo, useRef, useState } from 'react'
import { PropCell, PropDisplay } from './PropertyValue'
import PropertyMenu, { AddPropertyMenu } from './PropertyMenu'
import { aggregate, formatNumber, typeMeta, visibleProps } from './dbModel'
import { useMediaQuery } from '../../hooks/useMediaQuery'

const DEFAULT_W = { title: 260, number: 140, checkbox: 90, date: 150, created_time: 170, last_edited_time: 170 }
// On a phone the title and the next column or two fit the screen.
const NARROW_W = { title: 168, number: 104, checkbox: 64, date: 112, created_time: 128, last_edited_time: 128 }
const widthOf = (view, p, narrow) => (narrow
  ? Math.min(view.widths?.[p.id] || 9999, NARROW_W[p.type] || 132)
  : view.widths?.[p.id] || p.width || DEFAULT_W[p.type] || 180)
// Rows are drawn this many at a time; a large table does not lay out
// thousands of rows to show the first screenful.
export const RENDER_STEP = 200

/** One body row. Memoised: an edit re-renders only the row it changed. */
const TableRow = memo(function TableRow({ row, cols, readOnly, selectable, selected, people, h, rowHref }) {
  return (
    <tr aria-selected={selected || undefined}>
      {selectable && (
        <td>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <input type="checkbox" className="fdb-check" aria-label={`Select ${row.title || 'Untitled'}`}
              checked={selected} onChange={() => h.toggle(row.id)} />
          </div>
        </td>
      )}
      {cols.map(p => (
        <td key={p.id}>
          {p.type === 'title' ? (
            <div className="fdb-titlecell">
              {row.icon && <span aria-hidden="true" style={{ padding: '6px 0 0 8px' }}>{row.icon}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                {readOnly
                  ? <div className="fdb-cell ro" style={{ color: 'var(--db-ink)' }}>
                      {rowHref?.(row) ? <a href={rowHref(row)} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--db-line)' }}>{row.title || 'Untitled'}</a> : <PropDisplay prop={p} row={row} />}
                    </div>
                  : <PropCell prop={p} row={row} onChange={v => h.change(row.id, 'title', v)} />}
              </div>
              {!readOnly && h.canOpen && (
                <button type="button" className="fdb-open" style={{ margin: '6px 6px 0 0' }} onClick={() => h.open(row)}
                  aria-label={`Open ${row.title || 'Untitled'}`}>{h.narrow ? '↗' : 'Open'}</button>
              )}
            </div>
          ) : (
            <PropCell prop={p} row={row} editable={!readOnly} people={people} onCreateOption={h.createOption}
              onChange={v => h.change(row.id, p.id, v)} />
          )}
        </td>
      ))}
      {!readOnly && <td />}
    </tr>
  )
})

function HeaderCell({ prop, view, width, readOnly, onResize, onResizeEnd, menuProps, dragProps }) {
  const [open, setOpen] = useState(false)
  const startRef = useRef(null)
  const meta = typeMeta(prop.type)
  return (
    <th style={{ width }} scope="col" aria-sort={(() => {
      const s = (view.sort || []).find(x => x.prop === prop.id)
      return s ? (s.dir === 'asc' ? 'ascending' : 'descending') : undefined
    })()} {...dragProps}>
      <div style={{ position: 'relative' }}>
        <button type="button" className="fdb-th" disabled={readOnly} aria-haspopup={readOnly ? undefined : 'dialog'}
          aria-expanded={open} onClick={() => setOpen(o => !o)} style={{ cursor: readOnly ? 'default' : 'pointer' }}>
          <span aria-hidden="true" style={{ color: 'var(--db-mute)', fontSize: 12 }}>{meta.glyph}</span>
          <span className="n">{prop.name}</span>
        </button>
        {open && !readOnly && <PropertyMenu prop={prop} {...menuProps} onClose={() => setOpen(false)} />}
        {!readOnly && (
          <span className="fdb-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${prop.name}`}
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                const w = Math.max(60, Math.min(800, width + (e.key === 'ArrowRight' ? 16 : -16)))
                onResize(w); onResizeEnd(w)
              }
            }}
            onPointerDown={e => {
              e.preventDefault(); e.stopPropagation()
              startRef.current = { x: e.clientX, w: width }
              e.currentTarget.setPointerCapture?.(e.pointerId)
              e.currentTarget.classList.add('on')
            }}
            onPointerMove={e => {
              if (!startRef.current) return
              onResize(Math.max(60, Math.min(800, startRef.current.w + e.clientX - startRef.current.x)))
            }}
            onPointerUp={e => {
              if (!startRef.current) return
              const w = Math.max(60, Math.min(800, startRef.current.w + e.clientX - startRef.current.x))
              startRef.current = null
              e.currentTarget.classList.remove('on')
              onResizeEnd(w)
            }} />
        )}
      </div>
    </th>
  )
}

function FooterCell({ prop, rows, view, readOnly, onUpdateView, isFirst, total }) {
  if (isFirst) {
    return <td><div className="fdb-cell ro" style={{ minHeight: 30 }}>{total} {total === 1 ? 'row' : 'rows'}{rows.length < total ? ` (${rows.length} loaded)` : ''}</div></td>
  }
  if (prop.type !== 'number') return <td />
  const kind = view.footer?.[prop.id]
  const next = kind === 'sum' ? 'avg' : kind === 'avg' ? null : 'sum'
  const value = kind ? aggregate(rows, prop, kind) : null
  return (
    <td>
      <button type="button" className="fdb-cell num" disabled={readOnly}
        aria-label={kind ? `${kind === 'sum' ? 'Sum' : 'Average'} of ${prop.name}: ${formatNumber(value ?? 0, prop.format)}` : `Calculate ${prop.name}`}
        style={{ width: '100%', border: 'none', background: 'none', textAlign: 'right', cursor: readOnly ? 'default' : 'pointer', color: 'inherit' }}
        onClick={() => {
          const footer = { ...(view.footer || {}) }
          if (next) footer[prop.id] = next; else delete footer[prop.id]
          onUpdateView({ footer })
        }}>
        {kind ? <><span style={{ marginRight: 6 }}>{kind === 'sum' ? 'Sum' : 'Avg'}</span><strong style={{ color: 'var(--db-ink)' }}>{value == null ? '—' : formatNumber(value, prop.format)}</strong></> : (readOnly ? '' : 'Calculate')}
      </button>
    </td>
  )
}

export default function TableView({
  schema, view, rows, total = rows.length, readOnly, people,
  onUpdateView, onUpdateProp, onDeleteProp, onAddProp, onRowChange, onAddRow, onOpenRow,
  onCreateOption, onDeleteRows, onLoadMore, onSortBy, onFilterBy, rowHref,
}) {
  const props = useMemo(() => visibleProps(schema, view), [schema, view])
  const narrow = useMediaQuery('(max-width: 640px)')
  const selectable = !readOnly && !narrow
  const [liveW, setLiveW] = useState({})
  const [selected, setSelected] = useState(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [dragCol, setDragCol] = useState(null)
  const [limit, setLimit] = useState(RENDER_STEP)
  const allIds = rows.map(r => r.id)
  const allSelected = selected.size > 0 && allIds.every(id => selected.has(id))
  const shown = rows.length > limit ? rows.slice(0, limit) : rows

  // Stable handlers for the memoised rows; they call the latest props.
  const latest = useRef({})
  latest.current = { onRowChange, onOpenRow, onCreateOption }
  const handlers = useMemo(() => ({
    change: (id, prop, v) => latest.current.onRowChange?.(id, prop, v),
    open: (row) => latest.current.onOpenRow?.(row),
    createOption: (prop, name) => latest.current.onCreateOption?.(prop, name),
    toggle: (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }),
  }), [])
  const h = useMemo(() => ({ ...handlers, canOpen: !!onOpenRow, narrow }), [handlers, onOpenRow, narrow])

  const move = (propId, dir) => {
    const order = props.map(p => p.id)
    const i = order.indexOf(propId), j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    onUpdateView({ order })
  }
  const dropCol = (targetId) => {
    if (!dragCol || dragCol === targetId) return
    const order = props.map(p => p.id).filter(id => id !== dragCol)
    order.splice(order.indexOf(targetId), 0, dragCol)
    onUpdateView({ order })
    setDragCol(null)
  }

  const tableWidth = props.reduce((s, p) => s + (liveW[p.id] || widthOf(view, p, narrow)), 0) + (readOnly ? 0 : 44) + (selectable ? 36 : 0)

  return (
    <div>
      {!readOnly && selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }} role="status">
          <span style={{ fontSize: 13, color: 'var(--db-text)' }}>{selected.size} selected</span>
          <button type="button" className="fdb-btn danger" onClick={() => { onDeleteRows?.([...selected]); setSelected(new Set()) }}>Delete</button>
          <button type="button" className="fdb-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <div className="fdb-scroll">
        <table className="fdb-table" style={{ width: tableWidth }} aria-rowcount={total + 1}>
          <colgroup>
            {selectable && <col style={{ width: 36 }} />}
            {props.map(p => <col key={p.id} style={{ width: liveW[p.id] || widthOf(view, p, narrow) }} />)}
            {!readOnly && <col style={{ width: 44 }} />}
          </colgroup>
          <thead>
            <tr>
              {selectable && (
                <th scope="col" style={{ width: 36 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                    <input type="checkbox" className="fdb-check" aria-label="Select all rows" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))} />
                  </div>
                </th>
              )}
              {props.map(p => (
                <HeaderCell key={p.id} prop={p} view={view} readOnly={readOnly}
                  width={liveW[p.id] || widthOf(view, p, narrow)}
                  onResize={w => setLiveW(m => ({ ...m, [p.id]: w }))}
                  onResizeEnd={w => { setLiveW(m => { const n = { ...m }; delete n[p.id]; return n }); onUpdateView({ widths: { ...(view.widths || {}), [p.id]: Math.round(w) } }) }}
                  dragProps={readOnly ? {} : {
                    draggable: true,
                    onDragStart: e => { setDragCol(p.id); e.dataTransfer?.setData?.('text/plain', p.id) },
                    onDragOver: e => { if (dragCol) e.preventDefault() },
                    onDrop: e => { e.preventDefault(); dropCol(p.id) },
                    onDragEnd: () => setDragCol(null),
                  }}
                  menuProps={{
                    onUpdate: onUpdateProp,
                    onDelete: () => onDeleteProp(p.id),
                    onHide: () => onUpdateView({ hidden: [...(view.hidden || []), p.id] }),
                    onMove: dir => move(p.id, dir),
                    onSort: dir => onSortBy?.(p.id, dir),
                    onFilter: onFilterBy ? () => onFilterBy(p.id) : undefined,
                  }} />
              ))}
              {!readOnly && (
                <th scope="col" style={{ width: 44 }}>
                  <div style={{ position: 'relative' }}>
                    <button type="button" className="fdb-th" aria-label="Add a property" aria-expanded={addOpen}
                      onClick={() => setAddOpen(o => !o)} style={{ justifyContent: 'center' }}>+</button>
                    {addOpen && <AddPropertyMenu onAdd={onAddProp} onClose={() => setAddOpen(false)} />}
                  </div>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <TableRow key={row.id} row={row} cols={props} readOnly={readOnly} selectable={selectable}
                selected={selected.has(row.id)} people={people} h={h} rowHref={rowHref} />
            ))}
          </tbody>
          <tfoot className="fdb-foot">
            <tr>
              {selectable && <td />}
              {props.map((p, i) => <FooterCell key={p.id} prop={p} rows={rows} view={view} readOnly={readOnly} onUpdateView={onUpdateView} isFirst={i === 0} total={total} />)}
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!rows.length && <div className="fdb-empty">{view.filter ? 'No rows match this filter.' : 'No rows yet.'}</div>}
      {!readOnly && <button type="button" className="fdb-add-row" onClick={() => onAddRow()}>+ New row</button>}
      {rows.length > shown.length ? (
        <button type="button" className="fdb-add-row" onClick={() => setLimit(l => l + RENDER_STEP)}>
          Show more rows ({Math.max(total, rows.length) - shown.length} more)
        </button>
      ) : onLoadMore && rows.length < total && (
        <button type="button" className="fdb-add-row" onClick={() => { setLimit(l => Math.max(l, rows.length + RENDER_STEP)); onLoadMore() }}>Load more ({total - rows.length} more)</button>
      )}
    </div>
  )
}
