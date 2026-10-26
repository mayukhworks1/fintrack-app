import { useMemo, useRef, useState } from 'react'
import Modal from '../Modal'
import { parseCSV } from '../../utils/sheet'
import { api } from '../../services/api'
import { COMPUTED, PROP_TYPES } from './dbModel'
import { newImportId, retryableImportError } from './dbSync'

const NEW_TYPES = PROP_TYPES.filter(t => !COMPUTED.has(t.type))
const MAX_BYTES = 2_000_000

/** Guess a mapping: a column named like a property goes to it, the first
 *  unmatched column becomes the title, the rest become new text properties. */
export function suggestMapping(header, schema) {
  const byName = new Map(schema.properties.filter(p => !COMPUTED.has(p.type)).map(p => [p.name.trim().toLowerCase(), p]))
  const used = new Set()
  const out = header.map((h) => {
    const p = byName.get(String(h || '').trim().toLowerCase())
    if (p && !used.has(p.id)) { used.add(p.id); return p.id }
    return null
  })
  if (!used.has('title')) {
    const i = out.findIndex(v => v == null)
    if (i >= 0) { out[i] = 'title'; used.add('title') }
  }
  return out.map(v => v ?? 'new:text')
}

export default function CsvImportDialog({ open, onClose, dbId, schema, onImported }) {
  const [text, setText] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One id per import: kept while the same CSV and mapping are retried (a
  // timeout, a dropped connection), so the server never adds the rows twice.
  const importRef = useRef(null)   // { id, key }

  const grid = useMemo(() => (text ? parseCSV(text).filter(r => r.some(c => String(c).trim())) : []), [text])
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0)
  const header = hasHeader ? (grid[0] || []) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  const body = hasHeader ? grid.slice(1) : grid

  const load = (t) => {
    setError('')
    setText(t)
    const g = parseCSV(t).filter(r => r.some(c => String(c).trim()))
    const w = g.reduce((m, r) => Math.max(m, r.length), 0)
    const h = hasHeader ? (g[0] || []) : Array.from({ length: w }, (_, i) => `Column ${i + 1}`)
    setMapping(suggestMapping(Array.from({ length: w }, (_, i) => h[i] || `Column ${i + 1}`), schema))
  }

  const onFile = async (file) => {
    if (!file) return
    if (file.size > MAX_BYTES) { setError('The file is larger than 2 MB.'); return }
    load(await file.text())
  }

  const submit = async () => {
    setBusy(true); setError('')
    const map = mapping.map((m, column) => {
      if (m === 'skip') return null
      if (m.startsWith('new:')) return { column, new_type: m.slice(4), name: header[column] || `Column ${column + 1}` }
      return { column, prop: m }
    }).filter(Boolean)
    const key = JSON.stringify([text, map, hasHeader])
    if (!importRef.current || importRef.current.key !== key) importRef.current = { id: newImportId(), key }
    const body = { csv: text, mapping: map, has_header: hasHeader, import_id: importRef.current.id }
    try {
      let res
      try {
        res = await api.databases.importCsv(dbId, body)
      } catch (e) {
        // No answer is not a "no": ask again with the same id once.
        if (!retryableImportError(e)) throw e
        res = await api.databases.importCsv(dbId, body)
      }
      importRef.current = null
      onImported?.(res)
      setText(''); setMapping([])
      onClose()
    } catch (e) {
      setError(retryableImportError(e)
        ? `${e?.message || 'Import failed'}. Press Import again: rows already added will not be added twice.`
        : (e?.message || 'Import failed'))
    } finally { setBusy(false) }
  }

  const targets = schema.properties.filter(p => !COMPUTED.has(p.type))
  const titleTaken = mapping.filter(m => m === 'title').length

  return (
    <Modal open={open} onClose={onClose} title="Import CSV" subtitle="Each row of the file becomes a row of this database." width={640} zIndex={3000}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }} className="fdb">
          <button type="button" className="fdb-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="fdb-btn primary" disabled={!body.length || busy || !mapping.some(m => m !== 'skip')} onClick={submit}>
            {busy ? 'Importing…' : `Import ${body.length} ${body.length === 1 ? 'row' : 'rows'}`}
          </button>
        </div>
      }>
      <div className="fdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="fdb-btn" style={{ alignSelf: 'flex-start', border: '1px solid var(--db-line)' }}>
          Choose a .csv file
          <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => onFile(e.target.files?.[0])} />
        </label>
        <textarea className="fdb-input" rows={text ? 3 : 5} placeholder="…or paste CSV here" value={text}
          aria-label="CSV text" onChange={e => load(e.target.value)} style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12 }} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" className="fdb-check" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />
          First row is a header
        </label>
        {width > 0 && (
          <div className="fdb-scroll">
            <table className="fdb-table" style={{ width: '100%' }}>
              <thead><tr><th style={{ padding: 8 }}>Column</th><th style={{ padding: 8 }}>Import into</th><th style={{ padding: 8 }}>Sample</th></tr></thead>
              <tbody>
                {Array.from({ length: width }, (_, i) => (
                  <tr key={i}>
                    <td><div className="fdb-cell ro" style={{ color: 'var(--db-ink)' }}>{header[i] || `Column ${i + 1}`}</div></td>
                    <td style={{ padding: 4 }}>
                      <select className="fdb-select" aria-label={`Import ${header[i] || `column ${i + 1}`} into`} value={mapping[i] || 'skip'}
                        onChange={e => setMapping(m => { const n = [...m]; n[i] = e.target.value; return n })}>
                        <option value="skip">Skip this column</option>
                        <optgroup label="Existing properties">
                          {targets.map(p => <option key={p.id} value={p.id}>{p.name}{p.type === 'title' ? ' (title)' : ''}</option>)}
                        </optgroup>
                        <optgroup label="New property">
                          {NEW_TYPES.map(t => <option key={t.type} value={`new:${t.type}`}>New {t.label.toLowerCase()} property</option>)}
                        </optgroup>
                      </select>
                    </td>
                    <td><div className="fdb-cell ro">{body.slice(0, 2).map(r => r[i]).filter(Boolean).join(' · ')}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {titleTaken > 1 && <div role="alert" style={{ color: 'var(--db-danger)', fontSize: 13 }}>Only one column can be the title.</div>}
        {error && <div role="alert" style={{ color: 'var(--db-danger)', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  )
}
