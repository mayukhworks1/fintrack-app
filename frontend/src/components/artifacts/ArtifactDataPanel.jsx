/**
 * The owner's view of an artifact's shared data: what it has collected, who
 * may change it, and the tools to tidy it up. Everything is shown, including
 * each visitor's private records, because the owner moderates all of it.
 *
 * It listens to the same change feed the artifact does, so a task added on
 * the published page shows up here within a moment.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, RotateCw, Trash2 } from 'lucide-react'
import { useConfirm } from '../../context/ConfirmContext'
import { HttpBackend } from './artifactData'

const btn = { border: '1px solid var(--border)', borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--text-1)', minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }
const btnQuiet = { ...btn, background: 'transparent', border: '1px solid transparent', color: 'var(--text-2)', padding: '4px 8px', minHeight: 28 }
const sectionTitle = { margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }
const hint = { margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }
const th = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--bg-base)', position: 'sticky', top: 0 }
const td = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text-1)', borderBottom: '1px solid var(--border)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'top' }

export const ACCESS_OPTIONS = [
  { value: 'owner', label: 'Only I can change data', help: 'Visitors see the data but cannot add or change anything.' },
  { value: 'link_read', label: 'Anyone with the link can view', help: 'A read-only page: what you add is what everyone sees.' },
  { value: 'link_write', label: 'Anyone with the link can add and edit', help: 'Visitors add, change and delete records, like a shared list.' },
]

export function collectionLabel(name) {
  if (name === '_doc') return 'Documents'
  if (name === '_files') return 'Files'
  return name
}

function cell(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ArtifactDataPanel({ pageId, isPublished = false, isMobile = false, backend: given }) {
  const confirm = useConfirm()
  const backend = useMemo(() => given || new HttpBackend({ mode: 'owner', pageId }), [given, pageId])
  const [session, setSession] = useState(null)
  const [active, setActive] = useState(null)
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const activeRef = useRef(active)
  activeRef.current = active

  const refresh = useCallback(async () => {
    try {
      const s = await backend.session()
      setSession(s)
      setError('')
      const names = (s.collections || []).map(c => c.name)
      const current = activeRef.current && names.includes(activeRef.current) ? activeRef.current : names[0] || null
      setActive(current)
      if (current) {
        const res = await backend.listAll(current)
        if (activeRef.current === current || activeRef.current == null) setRecords(res.records || [])
      } else setRecords([])
    } catch (e) {
      setError(e?.status === 503 ? 'Shared data is being set up. Try again in a minute.' : (e?.message || 'Could not load the data.'))
    }
  }, [backend])

  useEffect(() => { refresh() }, [refresh])

  // Live: the change feed, everyone's records included.
  useEffect(() => {
    let stop = false
    let cursor = null
    const ctl = { abort: null }
    const run = async () => {
      let delay = 1000
      while (!stop) {
        try {
          if (cursor == null) cursor = (await backend.session()).cursor || 0
          ctl.abort = new AbortController()
          const res = await backend.changes(cursor, { wait: 25, all: true, signal: ctl.abort.signal })
          if (stop) return
          cursor = res.cursor
          delay = 1000
          if (res.changes?.length || res.reset) refresh()
        } catch (e) {
          if (stop || e?.name === 'AbortError') return
          await new Promise(r => setTimeout(r, delay))
          delay = Math.min(15_000, delay * 2)
        }
      }
    }
    run()
    return () => { stop = true; ctl.abort?.abort() }
  }, [backend, refresh])

  const pick = async (name) => {
    setActive(name)
    activeRef.current = name
    try { setRecords((await backend.listAll(name)).records || []) } catch (e) { setError(e?.message || 'Could not load the data.') }
  }

  const saveAccess = async (next) => {
    const before = session?.settings
    setBusy('settings'); setNote('')
    // Shown at once; put back if the save fails.
    setSession(s => ({ ...(s || {}), settings: next }))
    try {
      const conf = await backend.settings(next)
      setSession(s => ({ ...(s || {}), settings: conf }))
      setNote('Saved.')
    } catch (e) {
      setSession(s => ({ ...(s || {}), settings: before }))
      setError(e?.message || 'Could not save the setting.')
    } finally { setBusy('') }
  }

  const removeOne = async (r) => {
    const coll = r.collection === '_files' ? null : r.collection
    try {
      if (coll) await backend.remove(coll, r.id)
      else await backend.filesRemove(r.id)
      setRecords(list => list.filter(x => x.id !== r.id))
      refresh()
    } catch (e) { setError(e?.message || 'Could not delete it.') }
  }

  const clearAll = async () => {
    if (!active) return
    const ok = await confirm({
      title: `Delete everything in ${collectionLabel(active)}?`,
      message: 'Every record in this collection is deleted for everyone. This cannot be undone. Export it first if you may need it.',
      confirmLabel: 'Delete all',
    })
    if (!ok) return
    setBusy('clear')
    try { await backend.clear(active); await refresh() } catch (e) { setError(e?.message || 'Could not clear it.') } finally { setBusy('') }
  }

  const exportAs = async (format) => {
    setBusy(format)
    try { await download(await backend.exportFile(format, active), `${active ? collectionLabel(active).toLowerCase() : 'data'}.${format}`) }
    catch (e) { setError(e?.message || 'Could not export.') } finally { setBusy('') }
  }

  const conf = session?.settings || { access: 'link_write', own_only: false }
  const collections = session?.collections || []
  const columns = useMemo(() => {
    const keys = []
    for (const r of records) for (const k of Object.keys(r.data || {})) if (!keys.includes(k) && k !== 'path') keys.push(k)
    return keys.slice(0, isMobile ? 3 : 6)
  }, [records, isMobile])
  const total = collections.reduce((n, c) => n + c.count, 0)

  return (
    <div data-artifact-data="" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? 14 : '18px 22px', display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--card-bg)' }}>
      {error && (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--fin-neg-border, var(--border))', background: 'var(--fin-neg-bg, var(--bg-base))', fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" style={btnQuiet} onClick={() => { setError(''); refresh() }}><RotateCw size={13} aria-hidden="true" /> Retry</button>
        </div>
      )}

      <section aria-labelledby="ad-access">
        <h3 id="ad-access" style={sectionTitle}>Who can change the data</h3>
        <p style={{ ...hint, marginBottom: 10 }}>
          {isPublished ? 'Applies to everyone who opens the link, straight away.' : 'Applies once you publish. Until then only you can open it.'}
        </p>
        <div role="radiogroup" aria-labelledby="ad-access" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ACCESS_OPTIONS.map(o => (
            <label key={o.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, border: `1px solid ${conf.access === o.value ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', background: conf.access === o.value ? 'var(--bg-base)' : 'transparent' }}>
              <input type="radio" name="ad-access" value={o.value} checked={conf.access === o.value} disabled={busy === 'settings'}
                onChange={() => saveAccess({ ...conf, access: o.value })} style={{ marginTop: 3 }} />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{o.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)' }}>{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13, color: conf.access === 'link_write' ? 'var(--text-1)' : 'var(--text-3, var(--text-2))', cursor: conf.access === 'link_write' ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={!!conf.own_only} disabled={conf.access !== 'link_write' || busy === 'settings'}
            onChange={e => saveAccess({ ...conf, own_only: e.target.checked })} />
          People can only edit what they added
        </label>
        {note && <div role="status" style={{ ...hint, marginTop: 6 }}>{note}</div>}
      </section>

      <section aria-labelledby="ad-data" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 id="ad-data" style={{ ...sectionTitle, margin: 0, flex: 1 }}>
            Collected data <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>· {total.toLocaleString('en-IN')} record{total === 1 ? '' : 's'}</span>
          </h3>
          <span aria-hidden="true" title="Updates live" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-2)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: error ? 'var(--fin-warning)' : 'var(--fin-positive)' }} /> Live
          </span>
          <button type="button" style={btn} disabled={!active || !!busy} onClick={() => exportAs('csv')}><Download size={13} aria-hidden="true" /> CSV</button>
          <button type="button" style={btn} disabled={!active || !!busy} onClick={() => exportAs('json')}><Download size={13} aria-hidden="true" /> JSON</button>
          <button type="button" style={btn} disabled={!active || !!busy || !records.length} onClick={clearAll}><Trash2 size={13} aria-hidden="true" /> Clear</button>
        </div>

        {collections.length === 0 ? (
          <p style={{ ...hint, padding: '18px 0' }}>
            Nothing collected yet. When the artifact saves data (with <code>window.fintrack.db</code>), it shows up here as it arrives.
          </p>
        ) : (
          <>
            <div role="tablist" aria-label="Collections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {collections.map(c => (
                <button key={c.name} type="button" role="tab" aria-selected={active === c.name} onClick={() => pick(c.name)}
                  style={{ ...btn, minHeight: 30, borderRadius: 99, background: active === c.name ? 'var(--accent-btn)' : 'var(--card-bg)', color: active === c.name ? 'var(--accent-fg)' : 'var(--text-1)', border: active === c.name ? '1px solid transparent' : '1px solid var(--border)' }}>
                  {collectionLabel(c.name)} <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                </button>
              ))}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10, maxHeight: 420 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {columns.map(k => <th key={k} scope="col" style={th}>{k}</th>)}
                    <th scope="col" style={th}>Added by</th>
                    <th scope="col" style={th}>Updated</th>
                    <th scope="col" style={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} data-record-id={r.id}>
                      {columns.map(k => <td key={k} style={td} title={cell(r.data?.[k])}>{cell(r.data?.[k])}</td>)}
                      <td style={{ ...td, color: 'var(--text-2)' }}>
                        {r.author || 'Visitor'}
                        {r.scope === 'private' && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>private</span>}
                      </td>
                      <td style={{ ...td, color: 'var(--text-2)' }}>{when(r.updated_at)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button type="button" style={btnQuiet} aria-label={`Delete record ${columns[0] ? cell(r.data?.[columns[0]]) : r.id}`} onClick={() => removeOne(r)}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!records.length && (
                    <tr><td colSpan={columns.length + 3} style={{ ...td, color: 'var(--text-2)', textAlign: 'center' }}>No records in this collection.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
