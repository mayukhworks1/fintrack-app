import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Link2, Loader2, Search, X } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'

export default function AssociationLinkModal({
  sourceTable,
  record,
  onClose,
  onSaved,
}) {
  const toast = useToast()
  const fields = record?.fields || {}
  const [clientName, setClientName] = useState(record?.association?.client?.name || fields['Client'] || '')
  const [projectName, setProjectName] = useState(record?.association?.project?.name || fields['Project'] || fields['Project Name'] || '')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ clients: [], projects: [] })
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  const initialProject = useMemo(() => fields['Project'] || fields['Project Name'] || 'Record', [fields])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) {
      setResults({ clients: [], projects: [] })
      return
    }
    setSearching(true)
    api.associations.search(trimmed, 8)
      .then((res) => { if (!cancelled) setResults(res || { clients: [], projects: [] }) })
      .catch(() => { if (!cancelled) setResults({ clients: [], projects: [] }) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [query])

  async function handleSave() {
    if (!record?.id) return
    if (!projectName.trim() && !clientName.trim()) {
      toast('Add at least a client or project association', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await api.associations.link({
        source_table: sourceTable,
        teable_id: record.id,
        client_name: clientName.trim(),
        project_name: projectName.trim(),
      })
      toast('Association saved', 'success')
      onSaved?.(res?.association || null)
      onClose()
    } catch (e) {
      toast(e.message || 'Failed to save association', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlink() {
    if (!record?.id) return
    setSaving(true)
    try {
      await api.associations.unlink(sourceTable, record.id)
      toast('Association removed', 'info')
      onSaved?.(null)
      onClose()
    } catch (e) {
      toast(e.message || 'Failed to remove association', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.62)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-[26px] overflow-hidden"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(15,23,42,0.22)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-start justify-between gap-4"
          style={{ borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, var(--accent-dim), rgba(255,255,255,0.96))' }}>
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold mb-2"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--accent-soft)', color: 'var(--accent)' }}>
              <Link2 size={11} />
              Canonical association
            </div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Link {initialProject}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              This creates the shared client/project identity used across Status, Projects, and Invoices.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon p-2" style={{ color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Canonical Client</label>
              <input
                className="input"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="Innovine"
              />
            </div>
            <div>
              <label className="label">Canonical Project</label>
              <input
                className="input"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="PMS - Phase 1.1"
              />
            </div>
          </div>

          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <label className="label mb-2">Search existing associations</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input
                className="input pl-8"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search canonical clients or projects…"
              />
              {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--text-3)' }} />}
            </div>
            {(results.clients.length > 0 || results.projects.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>Clients</p>
                  <div className="space-y-2">
                    {results.clients.map(client => (
                      <button key={client.id} type="button"
                        onClick={() => setClientName(client.name)}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                        {client.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>Projects</p>
                  <div className="space-y-2">
                    {results.projects.map(project => (
                      <button key={project.id} type="button"
                        onClick={() => {
                          setProjectName(project.name)
                          if (project.client_name) setClientName(project.client_name)
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                        <span className="block" style={{ color: 'var(--text-1)' }}>{project.name}</span>
                        {project.client_name && <span className="block mt-0.5" style={{ color: 'var(--text-3)' }}>{project.client_name}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl p-3 text-xs"
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
            <div className="flex items-start gap-2">
              <Briefcase size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
              <p>
                Use the same canonical names everywhere. Once linked, related invoices, projects, and status updates will surface together across the app.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleUnlink}
            disabled={saving}
            className="btn-ghost text-xs"
            style={{ color: 'var(--fin-negative)', borderColor: 'var(--fin-neg-border)' }}>
            Remove link
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              Save association
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
