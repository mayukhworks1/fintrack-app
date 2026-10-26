import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import { DB_CSS } from './dbStyles'
import { PropCell } from './PropertyValue'
import { COLORS, applyUpdates, newId, typeMeta } from './dbModel'

/**
 * Above a row page's content in the page editor: the row's property values,
 * edited in place. Renders nothing for a page that is not a database row.
 */
export default function RowPropertiesPanel({ pageId, onOpenDatabase }) {
  const [ctx, setCtx] = useState(null) // { database:{id,title,icon,database}, row }
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setCtx(null)
    if (!pageId || typeof api.databases?.rowContext !== 'function') return undefined
    Promise.resolve().then(() => api.databases.rowContext(pageId)).then(res => {
      if (!alive || !res?.database) return
      setCtx(res)
      api.databases.people().then(p => { if (alive && Array.isArray(p)) setPeople(p) }).catch(() => {})
    }).catch(() => {})
    return () => { alive = false }
  }, [pageId])

  if (!ctx?.database) return null
  const { database: db, row } = ctx
  const schema = db.database

  const change = async (propId, value) => {
    setCtx(c => ({ ...c, row: applyUpdates([c.row], [{ id: row.id, props: { [propId]: value } }])[0] }))
    try {
      const saved = await api.databases.updateRow(db.id, row.id, { props: { [propId]: value } })
      setCtx(c => ({ ...c, row: saved }))
      setError('')
    } catch (e) { setError(e?.message || 'Could not save') }
  }
  const createOption = async (prop, name) => {
    const opt = { id: newId('o'), name, color: COLORS[(prop.options || []).length % COLORS.length] }
    const next = { ...schema, properties: schema.properties.map(p => (p.id === prop.id ? { ...p, options: [...(p.options || []), opt] } : p)) }
    try {
      const res = await api.databases.saveSchema(db.id, next)
      setCtx(c => ({ ...c, database: { ...c.database, database: res.database } }))
      return opt.id
    } catch (e) { setError(e?.message || 'Could not add the option'); return null }
  }

  return (
    <section className="fdb" aria-label="Properties">
      <style>{DB_CSS}</style>
      <div style={{ fontSize: 12.5, color: 'var(--db-mute)', marginBottom: 4 }}>
        In{' '}
        {onOpenDatabase
          ? <button type="button" className="fdb-btn" style={{ padding: '0 4px', minHeight: 0 }} onClick={() => onOpenDatabase({ id: db.id, title: db.title })}>{db.icon ? `${db.icon} ` : ''}{db.title || 'Untitled database'}</button>
          : <strong>{db.title}</strong>}
      </div>
      <div className="fdb-props">
        {schema.properties.filter(p => p.type !== 'title').map(p => (
          <div key={p.id} style={{ display: 'contents' }}>
            <div className="k"><span aria-hidden="true">{typeMeta(p.type).glyph}</span><span>{p.name}</span></div>
            <div className="v">
              <PropCell prop={p} row={row} people={people} onCreateOption={createOption} onChange={v => change(p.id, v)} />
            </div>
          </div>
        ))}
      </div>
      {error && <div role="alert" className="fdb-count" style={{ color: 'var(--db-danger)' }}>{error}</div>}
    </section>
  )
}
