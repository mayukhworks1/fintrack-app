import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, Trash2, Sparkles, Loader2, Check, X, RefreshCw, Link2, Receipt, Unlink, Clock } from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import AssociationLinkModal from '../components/AssociationLinkModal'
import InvoicePicklist from '../components/InvoicePicklist'
import { api } from '../services/api'
import { formatInr, formatPct } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

// Shared clean AI text renderer (no ugly markdown symbols)
function AiText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }
    if (/^\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={i} className="space-y-1.5 my-2 ml-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>{j + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/[`#*_]/g,'') }} />
            </li>
          ))}
        </ol>
      )
      continue
    }
    if (/^[A-Z][A-Za-z\s]{1,30}:\s?/.test(line)) {
      const ci = line.indexOf(':')
      const label = line.slice(0, ci)
      const rest  = line.slice(ci + 1).trim()
      elements.push(
        <div key={i} className="mt-3 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#22c55e' }}>{label}</span>
          {rest && <span className="text-sm ml-2 leading-relaxed" style={{ color: 'var(--text-2)' }}
            dangerouslySetInnerHTML={{ __html: rest.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />}
        </div>
      )
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />
      )
    }
    i++
  }
  return <div className="space-y-1.5">{elements}</div>
}

function Field({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</dt>
      <dd className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{String(value)}</dd>
    </div>
  )
}

function MetricCard({ label, value, highlight }) {
  return (
    <div className="card text-center"
      style={highlight ? { border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.05)' } : {}}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-xl font-bold tabular-nums" style={{ color: highlight ? '#4ade80' : 'var(--text-1)' }}>{value}</p>
    </div>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { isEditor } = useAuth()
  const isNew = id === 'new'

  // Viewers cannot create new projects — redirect them away
  useEffect(() => {
    if (isNew && !isEditor) navigate('/projects', { replace: true })
  }, [isNew, isEditor, navigate])

  const [record, setRecord]               = useState(null)
  const [loading, setLoading]             = useState(!isNew)
  const [editing, setEditing]             = useState(isNew)
  const [saving, setSaving]               = useState(false)
  const [analysis, setAnalysis]           = useState('')
  const [analyzing, setAnalyzing]         = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [showAssociationModal, setShowAssociationModal] = useState(false)
  const [showPicklist,         setShowPicklist]         = useState(false)
  const [linkedInvoices,       setLinkedInvoices]       = useState([])
  const [loadingInvoices,      setLoadingInvoices]      = useState(false)
  const [unlinkingId,          setUnlinkingId]          = useState(null)

  const loadRecord = useCallback(async () => {
    if (isNew) return
    setLoading(true)
    try {
      const r = await api.projects.get(id)
      setRecord(r)
    } catch (e) {
      toast('Failed to load project: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [id, isNew, toast])

  const loadLinkedInvoices = useCallback(async () => {
    if (isNew || !id) return
    setLoadingInvoices(true)
    try {
      const res = await api.projectInvoices.list(id)
      setLinkedInvoices(res.invoices || [])
    } catch { /* non-fatal */ }
    finally { setLoadingInvoices(false) }
  }, [id, isNew])

  const handleLinkInvoice = async (invoiceTId, source) => {
    await api.projectInvoices.link(id, invoiceTId, source)
    toast('Invoice linked!', 'success')
    await loadLinkedInvoices()
  }

  const handleUnlinkInvoice = async (invoiceId) => {
    setUnlinkingId(invoiceId)
    try {
      await api.projectInvoices.unlink(id, invoiceId)
      setLinkedInvoices(prev => prev.filter(i => i.invoice_teable_id !== invoiceId))
      toast('Invoice unlinked', 'info')
    } catch (e) {
      toast('Unlink failed: ' + e.message, 'error')
    } finally {
      setUnlinkingId(null)
    }
  }

  useEffect(() => { loadRecord() }, [loadRecord])
  useEffect(() => { loadLinkedInvoices() }, [loadLinkedInvoices])

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (isNew) {
        const created = await api.projects.create(payload)
        toast('Project created!', 'success')
        navigate(`/projects/${created.id}`, { replace: true })
      } else {
        const updated = await api.projects.update(id, payload)
        setRecord(updated)
        setEditing(false)
        toast('Project updated!', 'success')
      }
    } catch (e) {
      toast('Save failed: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.projects.delete(id)
      toast('Project deleted', 'info')
      navigate('/projects', { replace: true })
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error')
      setDeleting(false)
      setDeleteConfirm(false)
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalysis('')
    try {
      const { analysis: a } = await api.ai.analyze(id)
      setAnalysis(a)
      toast('Analysis ready', 'success')
    } catch (e) {
      toast('AI analysis failed: ' + e.message, 'error')
      setAnalysis('')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full" aria-label="Loading project">
      <Loader2 size={28} className="animate-spin" style={{ color: '#4ade80' }} />
    </div>
  )

  const f = record?.fields || {}
  const assoc = record?.association
  const related = assoc?.related_counts?.project || {}
  const profitPct = Number(f['Profit percentage'] || 0)
  const fmt = (n) => formatInr(n)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/projects')} aria-label="Back to projects"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white/5"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {isNew ? 'New Project' : (f['Project Name'] || 'Project')}
          </h1>
          {!isNew && (
            <p className="text-sm truncate" style={{ color: 'var(--text-3)' }}>
              {f['Client']} · <span className="font-mono text-xs">{record?.id}</span>
            </p>
          )}
        </div>
        {!isNew && !editing && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={loadRecord} aria-label="Refresh project data"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/5"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
              <RefreshCw size={14} />
            </button>
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-white/5 disabled:opacity-50"
              style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
              aria-label="Run AI analysis">
              {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {analyzing ? 'Analyzing…' : 'AI Analyze'}
            </button>
            {isEditor && (
              <>
                <button onClick={() => setShowAssociationModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-white/5"
                  style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                  Link
                </button>
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-white/5"
                  style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  <Edit2 size={13} /> Edit
                </button>
                {deleteConfirm ? (
                  <div className="flex gap-1">
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                      style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                      aria-label="Confirm delete">
                      {deleting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Confirm
                    </button>
                    <button onClick={() => setDeleteConfirm(false)} aria-label="Cancel delete"
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/5"
                      style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:bg-red-500/10"
                    style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Form (edit/new) */}
      {editing ? (
        <div className="card">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--text-1)' }}>
            {isNew ? 'Create Project' : 'Edit Project'}
          </h2>
          <ProjectForm
            initial={isNew ? {} : {
              client:                    f['Client'] || '',
              project_name:              f['Project Name'] || '',
              project_start_date:        f['Project Start Date']?.split('T')[0] || '',
              duration_months:           String(f['Duration (Months)'] || ''),
              resource_count:            String(f['Resource Count'] || ''),
              combined_monthly_salary:   String(f['Combined monthly salary of all the resources'] || ''),
              amount_billed:             String(f['Amount Billed So far'] || ''),
              project_status:            f['Project Status'] || '',
              resource_contribution_pct: String(f['Resource contribution percentage'] || ''),
            }}
            onSubmit={handleSave}
            onCancel={isNew ? () => navigate('/projects') : () => setEditing(false)}
            loading={saving}
          />
        </div>
      ) : (
        <div className="space-y-4">

          {assoc?.project?.name && (
            <div className="card">
              <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>
                Linked Portfolio Association
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Canonical client</p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{assoc.client?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Canonical project</p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{assoc.project?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Connected records</p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                    {related.status || 0} status · {related.invoices || 0} invoice{(related.invoices || 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Key metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Key financial metrics">
            <MetricCard label="Amount Billed"  value={fmt(f['Amount Billed So far'])} />
            <MetricCard label="Actual Profit"  value={fmt(f['Actual Profit'])} />
            <MetricCard label="Profit %"       value={formatPct(profitPct, 2)} highlight={profitPct > 0} />
            <MetricCard label="Target Revenue" value={fmt(f['Target Revenue'])} />
          </div>

          {/* Detail fields */}
          <div className="card">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-5" style={{ color: 'var(--text-3)' }}>
              Project Details
            </h2>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Client"          value={f['Client']} />
              <Field label="Project Name"    value={f['Project Name']} />
              <Field label="Status"          value={f['Project Status']} />
              <Field label="Health"          value={f['Health']} />
              <Field label="Start Date"      value={f['Project Start Date'] ? new Date(f['Project Start Date']).toLocaleDateString('en-IN') : null} />
              <Field label="Duration"        value={f['Duration (Months)'] ? `${f['Duration (Months)']} months` : null} />
              <Field label="Resources"       value={f['Resource Count']} />
              <Field label="Monthly Salary"  value={f['Combined monthly salary of all the resources'] ? fmt(f['Combined monthly salary of all the resources']) : null} />
              <Field label="Overhead Cost"   value={f['Total Overhead Cost']  ? fmt(f['Total Overhead Cost'])  : null} />
              <Field label="Input Cost"      value={f['Input cost so far']    ? fmt(f['Input cost so far'])    : null} />
              <Field label="Target Achieved" value={f['Target Achieved '] != null ? (f['Target Achieved '] ? 'Yes ✅' : 'No ❌') : null} />
              <Field label="Contribution %"  value={f['Resource contribution percentage'] ? `${f['Resource contribution percentage']}%` : null} />
              <Field label="Rev / Resource"  value={f['Revenue per Resource']  ? fmt(f['Revenue per Resource'])  : null} />
            </dl>
          </div>

          {/* AI Analysis loading state */}
          {analyzing && (
            <div className="card flex items-center gap-3 text-sm animate-pulse"
              style={{ border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.05)', color: '#4ade80' }}>
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              Generating AI analysis of this project…
            </div>
          )}

          {/* AI Analysis result */}
          {analysis && !analyzing && (
            <div className="card animate-fade-in"
              style={{ border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.04)' }}>
              <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: '#4ade80' }}>
                <Sparkles size={15} aria-hidden="true" /> AI Analysis
              </h2>
              <AiText text={analysis} />
            </div>
          )}

          {/* ── Linked Invoices ─────────────────────────────────────────── */}
          {!isNew && (
            <LinkedInvoicesPanel
              invoices={linkedInvoices}
              loading={loadingInvoices}
              unlinkingId={unlinkingId}
              canEdit={isEditor}
              onOpenPicklist={() => setShowPicklist(true)}
              onUnlink={handleUnlinkInvoice}
            />
          )}
        </div>
      )}

      {showAssociationModal && record && (
        <AssociationLinkModal
          sourceTable="projects"
          record={record}
          onClose={() => setShowAssociationModal(false)}
          onSaved={() => { setShowAssociationModal(false); loadRecord() }}
        />
      )}

      {showPicklist && (
        <InvoicePicklist
          projectId={id}
          projectName={record?.fields?.['Project Name']}
          linkedIds={linkedInvoices.map(i => i.invoice_teable_id)}
          onLink={handleLinkInvoice}
          onClose={() => setShowPicklist(false)}
        />
      )}
    </div>
  )
}

/* ── Linked Invoices panel ─────────────────────────────────────────────── */
const INV_STATUS_COLORS = {
  'Paid':           { bg: 'rgba(16,185,129,0.1)',  color: '#10b981' },
  'Received':       { bg: 'rgba(16,185,129,0.1)',  color: '#10b981' },
  'Partially Paid': { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' },
  'Pending':        { bg: 'rgba(249,115,22,0.1)',  color: '#f97316' },
  'Overdue':        { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' },
  'Raised':         { bg: 'rgba(99,102,241,0.1)',  color: '#6366f1' },
}

function LinkedInvoicesPanel({ invoices, loading, unlinkingId, canEdit, onOpenPicklist, onUnlink }) {
  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <Receipt size={13} aria-hidden="true" />
          Linked Invoices
          {invoices.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent)' }}>
              {invoices.length}
            </span>
          )}
        </h2>
        {canEdit && (
          <button
            onClick={onOpenPicklist}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.2)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.18)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(37,99,235,0.1)'}
          >
            <Link2 size={11} /> Link Invoice
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4" style={{ color: 'var(--text-3)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {!loading && invoices.length === 0 && (
        <div className="flex flex-col items-center py-6 gap-2">
          <Receipt size={24} style={{ color: 'var(--text-3)', opacity: 0.35 }} />
          <p className="text-sm text-center" style={{ color: 'var(--text-3)' }}>
            No invoices linked yet
            {canEdit && <span className="block text-xs mt-0.5 opacity-70">Click "Link Invoice" to associate invoices with this project</span>}
          </p>
        </div>
      )}

      {!loading && invoices.length > 0 && (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const sc = INV_STATUS_COLORS[inv.payment_status] || { bg: 'var(--bg-input)', color: 'var(--text-3)' }
            const isUnlinking = unlinkingId === inv.invoice_teable_id
            return (
              <div
                key={inv.invoice_teable_id}
                className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                style={{ background: 'var(--bg-input)', opacity: isUnlinking ? 0.5 : 1 }}
              >
                {/* Status dot */}
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc.color }} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                      {inv.invoice_number || '—'}
                    </span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                      style={{ background: sc.bg, color: sc.color }}>
                      {inv.payment_status || '—'}
                    </span>
                    {inv.invoice_source === 'web_invoices' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                        Web
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {inv.raised_date && (
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                        <Clock size={10} />
                        {new Date(inv.raised_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {inv.linked_by_role && (
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        · Linked by {inv.linked_by_role}
                      </span>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right flex-shrink-0 mr-1">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {inv.amount_raised != null ? formatInr(inv.amount_raised) : '—'}
                  </p>
                  {inv.amount_received != null && inv.amount_received > 0 && (
                    <p className="text-[10px]" style={{ color: '#10b981' }}>
                      Rcvd {formatInr(inv.amount_received)}
                    </p>
                  )}
                </div>

                {/* Unlink */}
                {canEdit && (
                  <button
                    onClick={() => onUnlink(inv.invoice_teable_id)}
                    disabled={isUnlinking}
                    className="btn-icon flex-shrink-0"
                    style={{ padding: '0.3rem', color: 'var(--text-3)' }}
                    aria-label={`Unlink ${inv.invoice_number}`}
                  >
                    {isUnlinking
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Unlink size={12} />}
                  </button>
                )}
              </div>
            )
          })}

          {/* Summary row */}
          {invoices.length > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                Total across {invoices.length} invoices
              </span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {formatInr(invoices.reduce((sum, i) => sum + (i.amount_raised || 0), 0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
