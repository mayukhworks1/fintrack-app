import { useRef, useState } from 'react'
import { Chip, Popover } from './ui'
import { PropDisplay } from './PropertyValue'
import { NO_GROUP, groupRows, isEmptyValue, propsById, rawValue } from './dbModel'

export function CardFields({ schema, view, row }) {
  const props = propsById(schema)
  const shown = (view.card_props || []).map(id => props[id]).filter(p => p && p.id !== view.group_by)
  const filled = shown.filter(p => p.type === 'checkbox' || p.type.endsWith('_time') || !isEmptyValue(rawValue(row, p)))
  if (!filled.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {filled.map(p => (
        <div key={p.id} className="m" title={p.name}>
          {p.type === 'checkbox' && <span style={{ color: 'var(--db-mute)' }}>{p.name}</span>}
          <PropDisplay prop={p} row={row} />
        </div>
      ))}
    </div>
  )
}

function CardMoveMenu({ columns, current, onPick, onClose }) {
  return (
    <Popover onClose={onClose} label="Move card" align="right">
      <h4>Move to</h4>
      {columns.map(c => (
        <button type="button" key={c.key} className="fdb-item" disabled={c.key === current} onClick={() => { onPick(c.key); onClose() }}>
          {c.option ? <Chip option={c.option} /> : <span>No value</span>}
        </button>
      ))}
    </Popover>
  )
}

/**
 * Columns per option of the view's select property. Cards are dragged
 * between and within columns; onMove(cardId, columnKey, index) is the single
 * handler for every way of moving (drag, or the card's "Move to" menu).
 */
export default function BoardView({ schema, view, rows, readOnly, onMove, onAddRow, onOpenRow, rowHref, onUpdateView, onAddGroupProp }) {
  const props = propsById(schema)
  const groupProp = props[view.group_by]
  const dragRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const [drop, setDrop] = useState(null) // { key, index }
  const [menuFor, setMenuFor] = useState(null)

  if (!groupProp) {
    const selects = schema.properties.filter(p => p.type === 'select')
    return (
      <div className="fdb-empty">
        <p style={{ margin: '0 0 10px' }}>A board groups cards by a select property.</p>
        {!readOnly && (selects.length
          ? <select className="fdb-select" style={{ maxWidth: 240 }} aria-label="Group by" value="" onChange={e => onUpdateView({ group_by: e.target.value })}>
              <option value="" disabled>Group by…</option>
              {selects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          : <button type="button" className="fdb-btn primary" onClick={onAddGroupProp}>Add a Status property</button>)}
      </div>
    )
  }

  const columns = groupRows(rows, groupProp)
  const visible = columns.filter(c => c.key !== NO_GROUP || c.rows.length || dragId)

  const endDrag = () => { dragRef.current = null; setDragId(null); setDrop(null) }
  const doDrop = (key, index) => {
    const id = dragRef.current
    endDrag()
    if (id) onMove(id, key, index)
  }
  const overCard = (e, col, i) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect?.()
    const after = r && e.clientY > r.top + r.height / 2
    const without = col.rows.filter(x => x.id !== dragRef.current)
    const target = col.rows[i]
    let index = without.findIndex(x => x.id === target.id)
    if (index < 0) index = without.length
    else if (after) index += 1
    setDrop({ key: col.key, index })
  }

  return (
    <div className="fdb-board" role="list" aria-label={`Board by ${groupProp.name}`}>
      {visible.map(col => {
        const isDrop = drop?.key === col.key
        const without = col.rows.filter(x => x.id !== dragId)
        return (
          <section key={col.key} className={`fdb-col${isDrop ? ' drop' : ''}`} role="listitem"
            aria-label={col.option ? col.option.name : `No ${groupProp.name}`}
            onDragOver={e => { if (!dragRef.current) return; e.preventDefault(); if (!isDrop || drop.index == null) setDrop({ key: col.key, index: without.length }) }}
            onDrop={e => { e.preventDefault(); doDrop(col.key, drop?.key === col.key ? drop.index : without.length) }}>
            <div className="fdb-col-h">
              {col.option ? <Chip option={col.option} /> : <span>No {groupProp.name}</span>}
              <span>{col.rows.length}</span>
            </div>
            {col.rows.map((row, i) => {
              const at = without.findIndex(x => x.id === row.id)
              const showLine = isDrop && dragId && dragId !== row.id && drop.index === at
              const href = rowHref?.(row)
              const body = (
                <>
                  <div className="t">{row.icon && <span aria-hidden="true" style={{ marginRight: 6 }}>{row.icon}</span>}{row.title || 'Untitled'}</div>
                  <CardFields schema={schema} view={view} row={row} />
                </>
              )
              return (
                <div key={row.id} style={{ position: 'relative' }}>
                  {showLine && <div className="fdb-dropline" aria-hidden="true" />}
                  {readOnly ? (
                    href ? <a className="fdb-card" href={href} style={{ textDecoration: 'none', cursor: 'pointer' }}>{body}</a>
                      : <div className="fdb-card" style={{ cursor: 'default' }}>{body}</div>
                  ) : (
                    <div className={`fdb-card${dragId === row.id ? ' dragging' : ''}`} draggable role="button" tabIndex={0}
                      aria-label={`${row.title || 'Untitled'}. Drag to move, or press Enter to open.`}
                      data-card-id={row.id}
                      onDragStart={e => { dragRef.current = row.id; setDragId(row.id); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.id) } catch {} }}
                      onDragEnd={endDrag}
                      onDragOver={e => overCard(e, col, i)}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); doDrop(col.key, drop?.key === col.key ? drop.index : at) }}
                      onClick={() => onOpenRow?.(row)}
                      onKeyDown={e => { if (e.key === 'Enter') onOpenRow?.(row) }}>
                      {body}
                      <span style={{ position: 'absolute', top: 4, right: 4 }}>
                        <button type="button" className="fdb-btn" aria-label={`Move ${row.title || 'Untitled'} to another column`}
                          style={{ padding: '0 6px', minHeight: 22, fontSize: 12 }}
                          onClick={e => { e.stopPropagation(); setMenuFor(m => (m === row.id ? null : row.id)) }}>⋯</button>
                        {menuFor === row.id && (
                          <CardMoveMenu columns={columns} current={col.key}
                            onPick={key => onMove(row.id, key, columns.find(c => c.key === key).rows.length)}
                            onClose={() => setMenuFor(null)} />
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
            {isDrop && dragId && drop.index >= without.length && <div className="fdb-dropline" aria-hidden="true" />}
            {!readOnly && (
              <button type="button" className="fdb-add-row" style={{ padding: '6px 4px' }}
                onClick={() => onAddRow({ [groupProp.id]: col.key === NO_GROUP ? null : col.key })}>+ New</button>
            )}
          </section>
        )
      })}
    </div>
  )
}
