import { useRef, useState } from 'react'
import { PropCell, PropDisplay } from './PropertyValue'
import PropertyMenu, { AddPropertyMenu } from './PropertyMenu'
import { aggregate, formatNumber, typeMeta, visibleProps } from './dbModel'

const DEFAULT_W = { title: 260, number: 140, checkbox: 90, date: 150, created_time: 170, last_edited_time: 170 }
const widthOf = (view, p) => view.widths?.[p.id] || p.width || DEFAULT_W[p.type] || 180

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
  const props = visibleProps(schema, view)
  const [liveW, setLiveW] = useState({})
  const [selected, setSelected] = useState(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [dragCol, setDragCol] = useState(null)
  const allIds = rows.map(r => r.id)
  const allSelected = selected.size > 0 && allIds.every(id => selected.has(id))

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

  const tableWidth = props.reduce((s, p) => s + (liveW[p.id] || widthOf(view, p)), 0) + (readOnly ? 0 : 36 + 44)

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
            {!readOnly && <col style={{ width: 36 }} />}
            {props.map(p => <col key={p.id} style={{ width: liveW[p.id] || widthOf(view, p) }} />)}
            {!readOnly && <col style={{ width: 44 }} />}
          </colgroup>
          <thead>
            <tr>
              {!readOnly && (
                <th scope="col" style={{ width: 36 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                    <input type="checkbox" className="fdb-check" aria-label="Select all rows" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))} />
                  </div>
                </th>
              )}
              {props.map(p => (
                <HeaderCell key={p.id} prop={p} view={view} readOnly={readOnly}
                  width={liveW[p.id] || widthOf(view, p)}
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
            {rows.map(row => (
              <tr key={row.id} aria-selected={selected.has(row.id) || undefined}>
                {!readOnly && (
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                      <input type="checkbox" className="fdb-check" aria-label={`Select ${row.title || 'Untitled'}`}
                        checked={selected.has(row.id)}
                        onChange={() => setSelected(s => { const n = new Set(s); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n })} />
                    </div>
                  </td>
                )}
                {props.map(p => (
                  <td key={p.id}>
                    {p.type === 'title' ? (
                      <div className="fdb-titlecell">
                        {row.icon && <span aria-hidden="true" style={{ padding: '6px 0 0 8px' }}>{row.icon}</span>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {readOnly
                            ? <div className="fdb-cell ro" style={{ color: 'var(--db-ink)' }}>
                                {rowHref?.(row) ? <a href={rowHref(row)} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--db-line)' }}>{row.title || 'Untitled'}</a> : <PropDisplay prop={p} row={row} />}
                              </div>
                            : <PropCell prop={p} row={row} onChange={v => onRowChange(row.id, 'title', v)} />}
                        </div>
                        {!readOnly && onOpenRow && (
                          <button type="button" className="fdb-open" style={{ margin: '6px 6px 0 0' }} onClick={() => onOpenRow(row)}
                            aria-label={`Open ${row.title || 'Untitled'}`}>Open</button>
                        )}
                      </div>
                    ) : (
                      <PropCell prop={p} row={row} editable={!readOnly} people={people} onCreateOption={onCreateOption}
                        onChange={v => onRowChange(row.id, p.id, v)} />
                    )}
                  </td>
                ))}
                {!readOnly && <td />}
              </tr>
            ))}
          </tbody>
          <tfoot className="fdb-foot">
            <tr>
              {!readOnly && <td />}
              {props.map((p, i) => <FooterCell key={p.id} prop={p} rows={rows} view={view} readOnly={readOnly} onUpdateView={onUpdateView} isFirst={i === 0} total={total} />)}
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!rows.length && <div className="fdb-empty">{view.filter ? 'No rows match this filter.' : 'No rows yet.'}</div>}
      {!readOnly && <button type="button" className="fdb-add-row" onClick={() => onAddRow()}>+ New row</button>}
      {onLoadMore && rows.length < total && (
        <button type="button" className="fdb-add-row" onClick={onLoadMore}>Load more ({total - rows.length} more)</button>
      )}
    </div>
  )
}
