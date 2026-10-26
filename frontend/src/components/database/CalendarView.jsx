import { useMemo, useRef, useState } from 'react'
import { COMPUTED, monthGrid, propsById, rowDay, ymd } from './dbModel'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_SHOWN = 3

function initialMonth(rows, prop) {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() }
}

/**
 * A month grid laid out by a date property. Entries can be dragged to
 * another day (onReschedule(rowId, 'YYYY-MM-DD')); a day's + adds a row on it.
 */
export default function CalendarView({ schema, view, rows, readOnly, onReschedule, onAddRow, onOpenRow, rowHref, onUpdateView, initial }) {
  const props = propsById(schema)
  const prop = props[view.date_prop]
  const [{ y, m }, setMonth] = useState(() => initial || initialMonth(rows, prop))
  const [expanded, setExpanded] = useState(null)
  const [overDay, setOverDay] = useState(null)
  const dragRef = useRef(null)
  const today = ymd(new Date())
  const days = useMemo(() => monthGrid(y, m), [y, m])

  const byDay = useMemo(() => {
    const map = new Map()
    if (!prop) return map
    for (const r of rows) {
      const d = rowDay(r, prop)
      if (!d) continue
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(r)
    }
    return map
  }, [rows, prop])

  if (!prop) {
    const dated = schema.properties.filter(p => p.type === 'date' || COMPUTED.has(p.type))
    return (
      <div className="fdb-empty">
        <p style={{ margin: '0 0 10px' }}>A calendar lays rows out by a date property.</p>
        {!readOnly && dated.length > 0 && (
          <select className="fdb-select" style={{ maxWidth: 240 }} aria-label="Show by" value="" onChange={e => onUpdateView({ date_prop: e.target.value })}>
            <option value="" disabled>Show by…</option>
            {dated.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
    )
  }

  const movable = !readOnly && !COMPUTED.has(prop.type)
  const undated = rows.filter(r => !rowDay(r, prop)).length
  const shift = (n) => setMonth(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, flex: '1 1 auto' }} aria-live="polite">{MONTHS[m]} {y}</h3>
        <button type="button" className="fdb-btn" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <button type="button" className="fdb-btn" onClick={() => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() }) }}>Today</button>
        <button type="button" className="fdb-btn" aria-label="Next month" onClick={() => shift(1)}>›</button>
      </div>
      <div className="fdb-cal" role="grid" aria-label={`${MONTHS[m]} ${y} by ${prop.name}`}>
        <div role="row" style={{ display: 'contents' }}>
          {DAYS.map(d => <div key={d} role="columnheader" className="fdb-cal-h">{d}</div>)}
        </div>
        {Array.from({ length: 6 }, (_, w) => (
          <div role="row" key={w} style={{ display: 'contents' }}>
            {days.slice(w * 7, w * 7 + 7).map(day => {
              const items = byDay.get(day.date) || []
              const open = expanded === day.date
              const shown = open ? items : items.slice(0, MAX_SHOWN)
              return (
                <div key={day.date} role="gridcell" aria-label={`${day.date}${items.length ? `, ${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : ''}`}
                  data-day={day.date}
                  className={`fdb-day${day.inMonth ? '' : ' out'}${day.date === today ? ' today' : ''}${overDay === day.date ? ' drop' : ''}`}
                  onDragOver={e => { if (dragRef.current) { e.preventDefault(); setOverDay(day.date) } }}
                  onDragLeave={() => setOverDay(d => (d === day.date ? null : d))}
                  onDrop={e => {
                    e.preventDefault()
                    const id = dragRef.current
                    dragRef.current = null
                    setOverDay(null)
                    if (id) onReschedule(id, day.date)
                  }}>
                  {!readOnly && !COMPUTED.has(prop.type) && (
                    <button type="button" className="add" aria-label={`Add on ${day.date}`} onClick={() => onAddRow({ [prop.id]: day.date })}>+</button>
                  )}
                  <span className="d">{day.day}</span>
                  {shown.map(r => {
                    const href = rowHref?.(r)
                    const label = <>{r.icon && <span aria-hidden="true" style={{ marginRight: 4 }}>{r.icon}</span>}{r.title || 'Untitled'}</>
                    if (readOnly) {
                      return href
                        ? <a key={r.id} className="fdb-ev" href={href} style={{ textDecoration: 'none', cursor: 'pointer', display: 'block' }}>{label}</a>
                        : <div key={r.id} className="fdb-ev" style={{ cursor: 'default' }}>{label}</div>
                    }
                    return (
                      <button type="button" key={r.id} className="fdb-ev" draggable={movable} data-row-id={r.id}
                        title={r.title || 'Untitled'}
                        onDragStart={e => { dragRef.current = r.id; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id) } catch {} }}
                        onDragEnd={() => { dragRef.current = null; setOverDay(null) }}
                        onClick={() => onOpenRow?.(r)}>{label}</button>
                    )
                  })}
                  {items.length > MAX_SHOWN && (
                    <button type="button" className="fdb-btn" style={{ fontSize: 11.5, padding: '0 4px', minHeight: 20 }}
                      onClick={() => setExpanded(open ? null : day.date)}>
                      {open ? 'Show less' : `+${items.length - MAX_SHOWN} more`}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {undated > 0 && <div className="fdb-count">{undated} {undated === 1 ? 'row has' : 'rows have'} no {prop.name.toLowerCase()}.</div>}
    </div>
  )
}
