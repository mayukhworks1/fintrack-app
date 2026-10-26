import { useRef, useState } from 'react'
import { safeUrl } from '../../utils/sanitize'
import { Chip, Popover } from './ui'
import {
  COMPUTED, formatDate, formatNumber, formatStamp, optionOf, rawValue,
} from './dbModel'

export function parseNumberInput(s) {
  const t = String(s ?? '').replace(/[₹,%\s]/g, '').replace(/^rs\.?/i, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function linkHref(v) {
  const s = String(v || '').trim()
  if (!/^(https?:|mailto:)/i.test(s)) return null
  return safeUrl(s)
}

/** Read-only rendering of a value. */
export function PropDisplay({ prop, row, compact }) {
  const v = rawValue(row, prop)
  switch (prop.type) {
    case 'title': return <span style={{ fontWeight: 600 }}>{v || <span style={{ color: 'var(--db-mute)', fontWeight: 400 }}>Untitled</span>}</span>
    case 'number': return <span>{formatNumber(v, prop.format)}</span>
    case 'date': return <span>{formatDate(v)}</span>
    case 'created_time': case 'last_edited_time': return <span>{formatStamp(v)}</span>
    case 'select': return <Chip option={optionOf(prop, v)} />
    case 'multi_select': return (
      <span className="fdb-chips">{(Array.isArray(v) ? v : []).map(id => <Chip key={id} option={optionOf(prop, id)} />)}</span>
    )
    case 'checkbox': return <span aria-label={v ? 'Checked' : 'Not checked'}>{v ? '☑' : (compact ? '' : '☐')}</span>
    case 'url': {
      const href = linkHref(v)
      if (!v) return null
      return href
        ? <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--db-accent)', textDecoration: 'underline', textUnderlineOffset: 2, overflowWrap: 'anywhere' }}>{String(v).replace(/^https?:\/\//, '')}</a>
        : <span>{String(v)}</span>
    }
    default: return <span>{v == null ? '' : String(v)}</span>
  }
}

function OptionPicker({ prop, value, onChange, onCreateOption, onClose }) {
  const [q, setQ] = useState('')
  const multi = prop.type === 'multi_select'
  const selected = multi ? (Array.isArray(value) ? value : []) : (value ? [value] : [])
  const opts = (prop.options || []).filter(o => o.name.toLowerCase().includes(q.trim().toLowerCase()))
  const exact = (prop.options || []).some(o => o.name.toLowerCase() === q.trim().toLowerCase())
  const pick = (id) => {
    if (multi) onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
    else { onChange(selected[0] === id ? null : id); onClose() }
  }
  const create = async () => {
    const name = q.trim()
    if (!name || exact || !onCreateOption) return
    const id = await onCreateOption(prop, name)
    if (id) { setQ(''); pick(id) }
  }
  return (
    <Popover onClose={onClose} label={`Choose ${prop.name}`}>
      {selected.length > 0 && (
        <div className="fdb-chips" style={{ padding: '2px 4px 8px' }}>
          {selected.map(id => <Chip key={id} option={optionOf(prop, id)} onRemove={() => pick(id)} />)}
        </div>
      )}
      <input className="fdb-input" value={q} onChange={e => setQ(e.target.value)} placeholder={onCreateOption ? 'Search or create an option' : 'Search options'}
        aria-label="Search options"
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (opts.length === 1 && !(!exact && q.trim() && onCreateOption)) pick(opts[0].id); else create() }
        }} />
      <div role="listbox" aria-label={prop.name} aria-multiselectable={multi || undefined} style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>
        {opts.map(o => (
          <button type="button" key={o.id} role="option" aria-selected={selected.includes(o.id)} className="fdb-item" onClick={() => pick(o.id)}>
            <span className="g">{selected.includes(o.id) ? '✓' : ''}</span><Chip option={o} />
          </button>
        ))}
        {q.trim() && !exact && onCreateOption && (
          <button type="button" className="fdb-item" onClick={create}>
            <span className="g">+</span>Create <strong>{q.trim()}</strong>
          </button>
        )}
        {!opts.length && !q.trim() && <div className="fdb-count">No options yet. Type to create one.</div>}
      </div>
    </Popover>
  )
}

/**
 * A value that can be edited in place: table cells and the row page's
 * properties panel. onChange(value) is called with the new stored value
 * (title edits too, with the text).
 */
export function PropCell({ prop, row, editable = true, onChange, onCreateOption, people = [], numeric }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const doneRef = useRef(false)
  const v = rawValue(row, prop)
  const ro = !editable || COMPUTED.has(prop.type)
  const cls = `fdb-cell${numeric || prop.type === 'number' ? ' num' : ''}${ro ? ' ro' : ''}`

  if (prop.type === 'checkbox') {
    return (
      <div className={cls} style={{ cursor: ro ? 'default' : 'pointer' }}>
        <input type="checkbox" className="fdb-check" checked={v === true} disabled={ro}
          aria-label={`${prop.name}${row.title ? ` for ${row.title}` : ''}`}
          onChange={e => onChange?.(e.target.checked)} />
      </div>
    )
  }

  const start = () => {
    if (ro) return
    doneRef.current = false
    setDraft(v ?? '')
    setEditing(true)
  }
  const commit = (value) => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    let next = value
    if (prop.type === 'number') {
      next = parseNumberInput(value)
      if (next === undefined) return
    } else if (prop.type !== 'date') {
      next = String(value ?? '')
      if (prop.type !== 'title') next = next.trim() === '' ? null : next
    } else if (!next) next = null
    if ((next ?? null) !== (v ?? null)) onChange?.(next)
  }

  if (editing && (prop.type === 'select' || prop.type === 'multi_select')) {
    return (
      <div className={cls} style={{ position: 'relative', overflow: 'visible' }}>
        <PropDisplay prop={prop} row={row} />
        <OptionPicker prop={prop} value={v} onCreateOption={onCreateOption}
          onChange={(nv) => onChange?.(Array.isArray(nv) && nv.length === 0 ? null : nv)}
          onClose={() => setEditing(false)} />
      </div>
    )
  }

  if (editing) {
    const type = prop.type === 'date' ? 'date' : prop.type === 'url' ? 'url' : 'text'
    const listId = prop.type === 'person' && people.length ? `fdb-people-${prop.id}` : undefined
    return (
      <div className={cls}>
        <input autoFocus type={type} value={type === 'date' ? String(draft || '').slice(0, 10) : draft} list={listId}
          inputMode={prop.type === 'number' ? 'decimal' : undefined}
          aria-label={prop.name}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value) }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); doneRef.current = true; setEditing(false) }
          }} />
        {listId && <datalist id={listId}>{people.map(p => <option key={p.name} value={p.name} />)}</datalist>}
      </div>
    )
  }

  return (
    <div className={cls} role={ro ? undefined : 'button'} tabIndex={ro ? undefined : 0}
      aria-label={ro ? undefined : `Edit ${prop.name}`}
      onClick={start}
      onKeyDown={e => { if (!ro && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); start() } }}>
      <PropDisplay prop={prop} row={row} compact />
    </div>
  )
}
