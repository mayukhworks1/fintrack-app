import { useState } from 'react'
import { Popover } from './ui'
import { COLORS, NUMBER_FORMATS, PROP_TYPES, chipStyle, newId, typeMeta } from './dbModel'

function OptionsEditor({ prop, onUpdate }) {
  const opts = prop.options || []
  const [name, setName] = useState('')
  const set = (next) => onUpdate({ ...prop, options: next })
  const add = () => {
    const n = name.trim()
    if (!n || opts.some(o => o.name.toLowerCase() === n.toLowerCase())) return
    set([...opts, { id: newId('o'), name: n, color: COLORS[opts.length % COLORS.length] }])
    setName('')
  }
  return (
    <div>
      <h4>Options</h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
        {opts.map((o, i) => (
          <li key={o.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input className="fdb-input" defaultValue={o.name} aria-label={`Option ${i + 1} name`}
              style={{ ...chipStyle(o.color), border: 'none', flex: 1, minWidth: 0 }}
              onBlur={e => {
                const n = e.target.value.trim()
                if (n && n !== o.name && !opts.some(x => x.id !== o.id && x.name.toLowerCase() === n.toLowerCase())) set(opts.map(x => x.id === o.id ? { ...x, name: n } : x))
                else e.target.value = o.name
              }} />
            <select className="fdb-select" value={o.color} aria-label={`Colour of ${o.name}`} style={{ width: 92 }}
              onChange={e => set(opts.map(x => x.id === o.id ? { ...x, color: e.target.value } : x))}>
              {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="fdb-btn danger" aria-label={`Delete option ${o.name}`} onClick={() => set(opts.filter(x => x.id !== o.id))}>×</button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <input className="fdb-input" value={name} onChange={e => setName(e.target.value)} placeholder="New option"
          aria-label="New option name" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="fdb-btn" onClick={add}>Add</button>
      </div>
    </div>
  )
}

/** Edit one property: name, type, format, options, plus view actions. */
export default function PropertyMenu({ prop, onUpdate, onDelete, onHide, onMove, onSort, onFilter, onClose, align }) {
  const [name, setName] = useState(prop.name)
  const isTitle = prop.type === 'title'
  const saveName = () => { const n = name.trim(); if (n && n !== prop.name) onUpdate({ ...prop, name: n }); else setName(prop.name) }
  return (
    <Popover onClose={() => { saveName(); onClose() }} label={`Property ${prop.name}`} align={align} style={{ width: 300 }}>
      <input className="fdb-input" value={name} onChange={e => setName(e.target.value)} aria-label="Property name"
        onBlur={saveName} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveName(); onClose() } }} />
      {!isTitle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13 }}>
          <span style={{ width: 54, color: 'var(--db-mute)' }}>Type</span>
          <select className="fdb-select" value={prop.type} aria-label="Property type"
            onChange={e => {
              const type = e.target.value
              const next = { id: prop.id, name: prop.name, type }
              if (type === 'select' || type === 'multi_select') next.options = prop.options || []
              if (type === 'number') next.format = prop.format || 'plain'
              onUpdate(next)
            }}>
            {PROP_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
      )}
      {prop.type === 'number' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13 }}>
          <span style={{ width: 54, color: 'var(--db-mute)' }}>Format</span>
          <select className="fdb-select" value={prop.format || 'plain'} aria-label="Number format"
            onChange={e => onUpdate({ ...prop, format: e.target.value })}>
            {NUMBER_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      )}
      {(prop.type === 'select' || prop.type === 'multi_select') && <div style={{ marginTop: 8 }}><OptionsEditor prop={prop} onUpdate={onUpdate} /></div>}
      <div className="fdb-sep" />
      {onSort && <>
        <button type="button" className="fdb-item" onClick={() => { onSort('asc'); onClose() }}><span className="g">↑</span>Sort ascending</button>
        <button type="button" className="fdb-item" onClick={() => { onSort('desc'); onClose() }}><span className="g">↓</span>Sort descending</button>
      </>}
      {onFilter && <button type="button" className="fdb-item" onClick={() => { onFilter(); onClose() }}><span className="g">⚲</span>Filter by this</button>}
      {onMove && <>
        <button type="button" className="fdb-item" onClick={() => onMove(-1)}><span className="g">←</span>Move left</button>
        <button type="button" className="fdb-item" onClick={() => onMove(1)}><span className="g">→</span>Move right</button>
      </>}
      {!isTitle && onHide && <button type="button" className="fdb-item" onClick={() => { onHide(); onClose() }}><span className="g">◌</span>Hide in this view</button>}
      {!isTitle && onDelete && <button type="button" className="fdb-item" style={{ color: 'var(--db-danger)' }} onClick={() => { onDelete(); onClose() }}><span className="g">🗑</span>Delete property</button>}
    </Popover>
  )
}

/** Name + type for a new property. */
export function AddPropertyMenu({ onAdd, onClose, align = 'right' }) {
  const [name, setName] = useState('')
  const add = (type) => {
    const label = typeMeta(type).label
    onAdd({ id: newId('p'), name: name.trim() || label, type, ...(type === 'number' ? { format: 'plain' } : {}), ...(type === 'select' || type === 'multi_select' ? { options: [] } : {}) })
    onClose()
  }
  return (
    <Popover onClose={onClose} label="New property" align={align} style={{ width: 240 }}>
      <input className="fdb-input" value={name} onChange={e => setName(e.target.value)} placeholder="Property name" aria-label="Property name" />
      <h4 style={{ marginTop: 10 }}>Type</h4>
      <div role="menu" style={{ maxHeight: 300, overflowY: 'auto' }}>
        {PROP_TYPES.map(t => (
          <button type="button" role="menuitem" key={t.type} className="fdb-item" onClick={() => add(t.type)}>
            <span className="g">{t.glyph}</span>{t.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
