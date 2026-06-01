import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Edit2, Trash2, Sparkles, Loader2, Check, X,
  RefreshCw, Receipt, Unlink, Clock, TrendingUp, DollarSign,
  Users, Calendar, BarChart2, CheckCircle2, AlertCircle, Activity,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import InvoicePicklist from '../components/InvoicePicklist'
import { api, clientCacheBust } from '../services/api'
import { formatInr, formatPct } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

// ── Helpers ────────────────────────────────────────────────────────────────────

function clientColor(name = '') {
  const PALETTE = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6','#f97316']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

const STATUS_COLORS = {
  'Active':      { bg: 'rgba(16,185,129,0.12)', color: '#10b981', dot: '#10b981' },
  'Completed':   { bg: 'rgba(99,102,241,0.12)',  color: '#818cf8', dot: '#6366f1' },
  'On Hold':     { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', dot: '#f59e0b' },
  'Cancelled':   { bg: 'rgba(239,68,68,0.12)',   color: '#f87171', dot: '#ef4444' },
  'In Progress': { bg: 'rgba(59,130,246,0.12)',  color: '#60a5fa', dot: '#3b82f6' },
}
function statusStyle(s) {
  return STATUS_COLORS[s] || { bg: 'var(--bg-input)', color: 'var(--text-3)', dot: '#94a3b8' }
}

const INV_STATUS = {
  'Paid':           '#10b981',
  'Received':       '#10b981',
  'Partially Paid': '#f59e0b',
  'Pending':        '#f97316',
  'Overdue':        '#ef4444',
  'Raised':         '#6366f1',
  'Cancelled':      '#94a3b8',
}

// ── AI text renderer ───────────────────────────────────────────────────────────

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

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-2xl p-4"
      style={{
        background: accent ? hexToRgba(accent, 0.06) : 'var(--card-bg)',
        border: `1px solid ${accent ? hexToRgba(accent, 0.2) : 'var(--border)'}`,
      }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: accent ? hexToRgba(accent, 0.12) : 'var(--bg-input)' }}>
          <Icon size={13} style={{ color: accent || 'var(--text-3)' }} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</p>
      </div>
      <p className="text-xl font-bold tabular-nums leading-none" style={{ color: accent || 'var(--text-1)' }}>
        {value ?? '—'}
      </p>
    </div>
  )
}

// ── Field ──────────────────────────────────────────────────────────────────────

function Field({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-3)' }}>{label}</dt>
      <dd className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{String(value)}</dd>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { isEditor } = useAuth()
  const isNew = id === 'new'

  useEffect(() => {
    if (isNew && !isEditor) navigate('/projects', { replace: true })
  }, [isNew, isEditor, navigate])

  const [record,          setRecord]          = useState(null)
  const [loading,         setLoading]         = useState(!isNew)
  const [editing,         setEditing]         = useState(isNew)
  const [saving,          setSaving]          = useState(false)
  const [analysis,        setAnalysis]        = useState('')
  const [analyzing,       setAnalyzing]       = useState(false)
  const [deleteConfirm,   setDeleteConfirm]   = useState(false)
  const [deleting,        setDeleting]        = useState(false)
  const [showPicklist,    setShowPicklist]     = useState(false)
  const [linkedInvoices,  setLinkedInvoices]  = useState([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [unlinkingId,     setUnlinkingId]     = useState(null)
  const [invExpanded,     setInvExpanded]     = useState(false)  // section collapsed by default
  const [expandedInvId,   setExpandedInvId]   = useState(null)  // which invoice row is expanded

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

  // Raw link — no toast, no reload (bulk handler does both after all complete)
  const handleLinkInvoice = async (invoiceTId, source) => {
    await api.projectInvoices.link(id, invoiceTId, source)
  }

  const handleBulkLinkDone = async (linked, failed) => {
    await loadLinkedInvoices()
    setInvExpanded(true) // auto-expand so user sees the newly linked invoices
    if (failed > 0)
      toast(`${linked} linked, ${failed} failed`, 'warning')
    else
      toast(`${linked} invoice${linked !== 1 ? 's' : ''} linked!`, 'success')
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
        clientCacheBust('/api/projects')
        toast('Project created!', 'success')
        navigate(`/projects/${created.id}`, { replace: true })
      } else {
        const updated = await api.projects.update(id, payload)
        clientCacheBust('/api/projects')
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
      clientCacheBust('/api/projects')
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
      toast('AI analysis ready', 'success')
    } catch (e) {
      toast('AI analysis failed: ' + e.message, 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading project…</p>
      </div>
    )
  }

  const f = record?.fields || {}
  const assoc = record?.association
  const insight = assoc?.insights?.project
  const invoiceInsight = insight?.invoice_summary || {}
  const statusInsight = insight?.status_summary || {}
  const signal = insight?.signal
  const profitPct  = Number(f['Profit percentage'] || 0)
  const clientName = f['Client'] || ''
  const projectName = f['Project Name'] || 'Untitled Project'
  const projectStatus = f['Project Status'] || ''
  const clrHex = clientColor(clientName)
  const sc = statusStyle(projectStatus)
  const openStatusBoard = () => {
    const cfg = {
      type: 'card',
      filterClient: clientName || '',
      filterStatus: '',
      search: projectName || '',
      columns: ['Client', 'Project', 'Status', 'Short Status'],
      boardGroupBy: 'Status',
      cardGroupBy: 'Client',
      cardGroupSort: 'count-desc',
      cardRecordSort: 'project-asc',
      advancedConditions: [],
      theme: 'cobalt',
      density: 'comfortable',
      showDashboard: true,
      showClientAccents: true,
    }
    navigate(`/status?v=${encodeURIComponent(btoa(JSON.stringify(cfg)))}`)
  }
  const openInvoicesWorkspace = () => {
    const params = new URLSearchParams()
    if (projectName) params.set('project', projectName)
    navigate(`/invoices?${params.toString()}`)
  }

  // ── New / Edit form ────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5 animate-fade-in">
        {/* Back header */}
        <div className="flex items-center gap-3">
          <button onClick={() => isNew ? navigate('/projects') : setEditing(false)}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}
            aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
            {isNew ? 'New Project' : `Edit — ${projectName}`}
          </h1>
        </div>
        <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
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
      </div>
    )
  }

  // ── View ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in">

      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 pt-5 pb-6"
        style={{
          background: `linear-gradient(135deg, ${hexToRgba(clrHex, 0.10)} 0%, var(--card-bg) 60%)`,
          borderBottom: '1px solid var(--border)',
        }}>
        {/* Breadcrumb row */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <button onClick={() => navigate('/projects')}
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 transition-all"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
            <ArrowLeft size={13} /> All Projects
          </button>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button onClick={loadRecord} aria-label="Refresh"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
              <RefreshCw size={13} />
            </button>
            <button onClick={handleAnalyze} disabled={analyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
              style={{ color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)' }}>
              {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {analyzing ? 'Analysing…' : 'AI Analyze'}
            </button>
            {isEditor && (
              <>
                <button onClick={() => setShowPicklist(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
                  <Receipt size={12} /> Link Invoice
                </button>
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
                  <Edit2 size={12} /> Edit
                </button>
                {deleteConfirm ? (
                  <div className="flex gap-1 items-center">
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                      {deleting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Confirm delete
                    </button>
                    <button onClick={() => setDeleteConfirm(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', background: 'var(--card-bg)' }}>
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Project identity */}
        <div className="flex items-start gap-4">
          {/* Colour avatar */}
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-lg font-black"
            style={{ background: hexToRgba(clrHex, 0.18), color: clrHex, border: `1px solid ${hexToRgba(clrHex, 0.28)}` }}>
            {(clientName[0] || 'P').toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            {/* Client chip + status */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
                style={{ background: hexToRgba(clrHex, 0.12), color: clrHex, border: `1px solid ${hexToRgba(clrHex, 0.25)}` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: clrHex }} />
                {clientName || 'Unknown client'}
              </span>
              {projectStatus && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.bg}` }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                  {projectStatus}
                </span>
              )}
              {f['Health'] && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  {f['Health'] === 'Good' ? '🟢' : f['Health'] === 'At Risk' ? '🟡' : '🔴'} {f['Health']}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black leading-tight mb-2" style={{ color: 'var(--text-1)' }}>
              {projectName}
            </h1>

            {/* Meta row */}
            <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: 'var(--text-3)' }}>
              {f['Project Start Date'] && (
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(f['Project Start Date']).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
              {f['Duration (Months)'] && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {f['Duration (Months)']} months
                </span>
              )}
              {f['Resource Count'] && (
                <span className="flex items-center gap-1">
                  <Users size={11} />
                  {f['Resource Count']} resource{f['Resource Count'] !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {assoc?.project?.name && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={openStatusBoard}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)', background: 'var(--accent-dim)' }}>
                  <Activity size={11} /> View linked status
                </button>
                <button onClick={openInvoicesWorkspace}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
                  <Receipt size={11} /> View linked invoices
                </button>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--accent)' }}>
                  {assoc?.related_counts?.project?.status || 0} status · {assoc?.related_counts?.project?.invoices || 0} invoice
                </span>
                {signal?.title && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{
                      background: signal.severity === 'danger' ? 'var(--fin-neg-bg)' : signal.severity === 'warning' ? 'var(--fin-warn-bg)' : 'var(--fin-pos-bg)',
                      border: `1px solid ${signal.severity === 'danger' ? 'var(--fin-neg-border)' : signal.severity === 'warning' ? 'var(--fin-warn-border)' : 'var(--fin-pos-border)'}`,
                      color: signal.severity === 'danger' ? 'var(--fin-negative)' : signal.severity === 'warning' ? 'var(--fin-warning)' : 'var(--fin-positive)',
                    }}>
                    {signal.title}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

        {/* ── Key metrics ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={DollarSign}  label="Billed so far"  value={f['Amount Billed So far'] ? formatInr(f['Amount Billed So far']) : null} accent="#3b82f6" />
          <StatCard icon={TrendingUp}  label="Actual profit"  value={f['Actual Profit'] ? formatInr(f['Actual Profit']) : null} accent={profitPct > 0 ? '#22c55e' : '#ef4444'} />
          <StatCard icon={BarChart2}   label="Profit %"       value={profitPct ? formatPct(profitPct, 1) : null} accent={profitPct > 20 ? '#22c55e' : profitPct > 0 ? '#f59e0b' : '#ef4444'} />
          <StatCard icon={DollarSign}  label="Target revenue" value={f['Target Revenue'] ? formatInr(f['Target Revenue']) : null} accent="#8b5cf6" />
        </div>

        {/* ── Two-column: Details + Invoices ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-5">

          {/* Project details */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <h2 className="text-xs font-bold uppercase tracking-widest mb-5 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <BarChart2 size={12} /> Project Details
            </h2>
            {signal?.detail && (
              <div className="rounded-xl p-3 mb-5"
                style={{
                  background: signal.severity === 'danger' ? 'var(--fin-neg-bg)' : signal.severity === 'warning' ? 'var(--fin-warn-bg)' : 'var(--accent-dim)',
                  border: `1px solid ${signal.severity === 'danger' ? 'var(--fin-neg-border)' : signal.severity === 'warning' ? 'var(--fin-warn-border)' : 'var(--accent-soft)'}`,
                }}>
                <p className="text-xs font-semibold mb-1"
                  style={{ color: signal.severity === 'danger' ? 'var(--fin-negative)' : signal.severity === 'warning' ? 'var(--fin-warning)' : 'var(--accent)' }}>
                  Linked operational signal
                </p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{signal.detail}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-2)' }}>
                  <span>{Number(invoiceInsight.pending_count || 0)} pending invoice</span>
                  <span>{formatInr(invoiceInsight.outstanding_total || 0)} open</span>
                  <span>{Number(statusInsight.blocked_count || 0)} blocked status</span>
                </div>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Client"          value={f['Client']} />
              <Field label="Project Name"    value={f['Project Name']} />
              <Field label="Status"          value={f['Project Status']} />
              <Field label="Health"          value={f['Health']} />
              <Field label="Start Date"      value={f['Project Start Date'] ? new Date(f['Project Start Date']).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null} />
              <Field label="Duration"        value={f['Duration (Months)'] ? `${f['Duration (Months)']} months` : null} />
              <Field label="Resources"       value={f['Resource Count']} />
              <Field label="Monthly Salary"  value={f['Combined monthly salary of all the resources'] ? formatInr(f['Combined monthly salary of all the resources']) : null} />
              <Field label="Overhead Cost"   value={f['Total Overhead Cost'] ? formatInr(f['Total Overhead Cost']) : null} />
              <Field label="Input Cost"      value={f['Input cost so far'] ? formatInr(f['Input cost so far']) : null} />
              <Field label="Contribution %"  value={f['Resource contribution percentage'] ? `${f['Resource contribution percentage']}%` : null} />
              <Field label="Rev / Resource"  value={f['Revenue per Resource'] ? formatInr(f['Revenue per Resource']) : null} />
              {f['Target Achieved '] != null && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Target Achieved</dt>
                  <dd className="flex items-center gap-1.5 text-sm font-semibold"
                    style={{ color: f['Target Achieved '] ? '#22c55e' : '#f87171' }}>
                    {f['Target Achieved ']
                      ? <><CheckCircle2 size={13} /> Yes</>
                      : <><AlertCircle size={13} /> No</>}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Linked Invoices — collapsible, collapsed by default */}
          <div className="rounded-2xl overflow-hidden flex flex-col"
            style={{ border: '2px solid rgba(37,99,235,0.2)', background: 'var(--card-bg)' }}>

            {/* Section header — click left side to expand/collapse */}
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ background: 'rgba(37,99,235,0.06)', borderBottom: invExpanded ? '1px solid rgba(37,99,235,0.12)' : 'none' }}>
              <button
                onClick={() => setInvExpanded(v => !v)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Receipt size={14} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>Linked Invoices</p>
                {linkedInvoices.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ background: 'var(--accent-btn)', color: '#fff' }}>
                    {linkedInvoices.length}
                  </span>
                )}
                {invExpanded
                  ? <ChevronUp size={13} style={{ color: 'var(--accent)', marginLeft: 2 }} />
                  : <ChevronDown size={13} style={{ color: 'var(--accent)', marginLeft: 2 }} />}
              </button>
              {isEditor && (
                <button onClick={() => setShowPicklist(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                  <Receipt size={11} />
                  {linkedInvoices.length > 0 ? 'Add' : 'Link'}
                </button>
              )}
            </div>

            {/* Invoice list body — only when expanded */}
            {invExpanded && <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ maxHeight: 420 }}>
              {loadingInvoices && (
                <div className="flex items-center gap-2 py-4 justify-center" style={{ color: 'var(--text-3)' }}>
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-sm">Loading…</span>
                </div>
              )}

              {!loadingInvoices && linkedInvoices.length === 0 && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <Receipt size={32} style={{ color: 'rgba(37,99,235,0.2)' }} />
                  <p className="text-sm font-medium text-center" style={{ color: 'var(--text-3)' }}>
                    No invoices linked yet
                  </p>
                  {isEditor && (
                    <button onClick={() => setShowPicklist(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold"
                      style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.2)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.18)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(37,99,235,0.1)'}>
                      <Receipt size={12} /> Link invoices to this project
                    </button>
                  )}
                </div>
              )}

              {!loadingInvoices && linkedInvoices.map((inv) => {
                const statusColor   = INV_STATUS[inv.payment_status] || 'var(--text-3)'
                const isUnlinking   = unlinkingId === inv.invoice_teable_id
                const isRowExpanded = expandedInvId === inv.invoice_teable_id
                return (
                  <div key={inv.invoice_teable_id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: 'var(--bg-input)',
                      border: `1px solid ${isRowExpanded ? 'rgba(37,99,235,0.3)' : 'var(--border)'}`,
                      opacity: isUnlinking ? 0.5 : 1,
                    }}>
                    {/* Row summary — click to toggle details */}
                    <button
                      onClick={() => setExpandedInvId(isRowExpanded ? null : inv.invoice_teable_id)}
                      className="w-full flex items-center gap-2.5 p-3 text-left"
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                            {inv.invoice_number || '—'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: `${statusColor}20`, color: statusColor }}>
                            {inv.payment_status || '—'}
                          </span>
                          {inv.invoice_source === 'web_invoices' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>Web</span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--text-1)' }}>
                        {inv.amount_raised != null ? formatInr(inv.amount_raised) : '—'}
                      </span>
                      {isRowExpanded
                        ? <ChevronUp size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                        : <ChevronDown size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
                    </button>
                    {/* Expanded detail panel */}
                    {isRowExpanded && (
                      <div className="px-3 pb-3 pt-0 space-y-1.5"
                        style={{ borderTop: '1px solid var(--border)' }}>
                        {inv.raised_date && (
                          <div className="flex justify-between text-xs">
                            <span style={{ color: 'var(--text-3)' }}>Date</span>
                            <span style={{ color: 'var(--text-2)' }}>
                              {new Date(inv.raised_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                        )}
                        {inv.amount_with_tax != null && inv.amount_with_tax !== inv.amount_raised && (
                          <div className="flex justify-between text-xs">
                            <span style={{ color: 'var(--text-3)' }}>With Tax</span>
                            <span className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                              {formatInr(inv.amount_with_tax)}
                            </span>
                          </div>
                        )}
                        {inv.amount_received != null && inv.amount_received > 0 && (
                          <div className="flex justify-between text-xs">
                            <span style={{ color: 'var(--text-3)' }}>Received</span>
                            <span className="font-semibold tabular-nums" style={{ color: '#10b981' }}>
                              {formatInr(inv.amount_received)}
                            </span>
                          </div>
                        )}
                        {isEditor && (
                          <button onClick={() => handleUnlinkInvoice(inv.invoice_teable_id)}
                            disabled={isUnlinking}
                            className="flex items-center gap-1 mt-1 text-[11px] font-semibold"
                            style={{ color: '#ef4444', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                            {isUnlinking ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />}
                            Unlink invoice
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>}

            {/* Invoice total — only when expanded */}
            {invExpanded && linkedInvoices.length > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
                style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                  Total ({linkedInvoices.length} invoices)
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {formatInr(linkedInvoices.reduce((s, i) => s + (i.amount_raised || 0), 0))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── AI analysis loading ────────────────────────────────────────── */}
        {analyzing && (
          <div className="rounded-2xl p-4 flex items-center gap-3 text-sm"
            style={{ border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.04)', color: '#4ade80' }}>
            <Loader2 size={16} className="animate-spin flex-shrink-0" />
            Generating AI analysis for this project…
          </div>
        )}

        {/* ── AI analysis result ─────────────────────────────────────────── */}
        {analysis && !analyzing && (
          <div className="rounded-2xl p-5 animate-fade-in"
            style={{ border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.04)' }}>
            <h2 className="font-bold mb-3 flex items-center gap-2" style={{ color: '#4ade80' }}>
              <Sparkles size={15} /> AI Analysis
            </h2>
            <AiText text={analysis} />
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showPicklist && (
        <InvoicePicklist
          projectId={id}
          projectName={record?.fields?.['Project Name']}
          linkedIds={linkedInvoices.map(i => i.invoice_teable_id)}
          onLink={handleLinkInvoice}
          onBulkDone={handleBulkLinkDone}
          onClose={() => setShowPicklist(false)}
        />
      )}
    </div>
  )
}
