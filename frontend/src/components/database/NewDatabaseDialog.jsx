import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { api } from '../../services/api'
import { DB_CSS } from './dbStyles'

const FALLBACK = [
  { key: 'blank', name: 'Empty database', icon: '🗃️', description: 'A table with a name column.' },
]

/** Pick a template, name the database, create it. onCreated(page) opens it. */
export default function NewDatabaseDialog({ open, onClose, onCreated, parentId }) {
  const [templates, setTemplates] = useState(FALLBACK)
  const [pick, setPick] = useState('blank')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    api.databases.templates().then(t => { if (Array.isArray(t) && t.length) setTemplates(t) }).catch(() => {})
  }, [open])

  const chosen = templates.find(t => t.key === pick) || templates[0]
  const create = async () => {
    setBusy(true); setError('')
    try {
      const page = await api.databases.create({
        title: title.trim() || (pick === 'blank' ? 'Untitled database' : chosen.name),
        template: pick, ...(parentId ? { parent_id: parentId } : {}),
      })
      setTitle(''); setPick('blank')
      onCreated?.(page)
      onClose()
    } catch (e) { setError(e?.message || 'Could not create the database') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New database" subtitle="Rows are pages: open any row to write in it." width={640} zIndex={3000}
      footer={
        <div className="fdb" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="fdb-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="fdb-btn primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create database'}</button>
        </div>
      }>
      <div className="fdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <style>{DB_CSS}</style>
        <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Name
          <input className="fdb-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={chosen?.name || 'Untitled database'}
            onKeyDown={e => { if (e.key === 'Enter') create() }} />
        </label>
        <div role="radiogroup" aria-label="Template" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(180px,100%),1fr))', gap: 8 }}>
          {templates.map(t => (
            <button type="button" role="radio" aria-checked={pick === t.key} key={t.key} onClick={() => setPick(t.key)}
              className="fdb-gcard"
              style={{ padding: 12, gap: 4, borderColor: pick === t.key ? 'var(--db-accent)' : undefined, boxShadow: pick === t.key ? '0 0 0 1px var(--db-accent)' : undefined }}>
              <span style={{ fontSize: 22 }} aria-hidden="true">{t.icon}</span>
              <strong style={{ fontSize: 13.5 }}>{t.name}</strong>
              <span style={{ fontSize: 12, color: 'var(--db-mute)', lineHeight: 1.4 }}>{t.description}</span>
            </button>
          ))}
        </div>
        {error && <div role="alert" style={{ color: 'var(--db-danger)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  )
}
