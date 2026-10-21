import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Edit2, Trash2, Loader2, Check, X,
  RefreshCw, Receipt, Clock, TrendingUp, DollarSign,
  Users, Calendar, BarChart2, CheckCircle2, AlertCircle, Activity,
} from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import { api, clientCacheBust } from '../services/api'
import { formatInr, formatPct } from '../utils/format'
import { hexToRgba } from '../utils/color'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { plainLabel } from '../utils/plainLabel'

// ── Helpers ────────────────────────────────────────────────────────────────────

// One neutral ink for every client; colour is kept for status.
function clientColor() {
  return 'var(--text-2)'
}

const STATUS_COLORS = {
  'Active':      { bg: 'color-mix(in srgb, var(--fin-positive) 12%, transparent)', color: 'var(--fin-positive)', dot: 'var(--fin-positive)' },
  'Completed':   { bg: 'color-mix(in srgb, var(--accent) 12%, transparent)',  color: 'var(--accent)', dot: 'var(--accent)' },
  'On Hold':     { bg: 'color-mix(in srgb, var(--fin-warning) 12%, transparent)',  color: 'var(--fin-warning)', dot: 'var(--fin-warning)' },
  'Cancelled':   { bg: 'color-mix(in srgb, var(--fin-negative) 12%, transparent)',   color: 'var(--fin-negative)', dot: 'var(--fin-negative)' },
  'In Progress': { bg: 'color-mix(in srgb, var(--accent) 12%, transparent)',  color: 'var(--accent)', dot: 'var(--accent)' },
}
function statusStyle(s) {
  return STATUS_COLORS[s] || { bg: 'var(--bg-input)', color: 'var(--text-3)', dot: 'var(--text-3)' }
}

// ── AI text renderer ───────────────────────────────────────────────────────────

// Escape HTML first, then apply the tiny bold/markdown-strip pass. Without the
// escape, any "<" in the AI output (which can echo Teable-sourced project text)
// would be injected raw via dangerouslySetInnerHTML.
function mdInline(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/[`#*_]/g, '')
}

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
                style={{ background: 'color-mix(in srgb, var(--fin-positive) 12%, transparent)', color: 'var(--fin-positive)' }}>{j + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: mdInline(item) }} />
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
          <span className="text-xs font-bold uppercase tracking-[0.06em]" style={{ color: 'var(--fin-positive)' }}>{label}</span>
          {rest && <span className="text-sm ml-2 leading-relaxed" style={{ color: 'var(--text-2)' }}
            dangerouslySetInnerHTML={{ __html: mdInline(rest) }} />}
        </div>
      )
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: mdInline(line) }} />
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

  const loadRecord = useCallback(async (opts = {}) => {
    if (isNew) return
    setLoading(true)
    try {
      const r = await api.projects.get(id, opts)
      setRecord(r)
    } catch (e) {
      toast('Failed to load project: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [id, isNew, toast])

  useEffect(() => { loadRecord() }, [loadRecord])

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
      columns: ['Client', 'Project', 'Status', 'Short Status', 'Attachments'],
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
            {isNew ? 'New Project' : `Edit ${projectName}`}
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
          background: 'var(--card-bg)',
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
              style={{ color: 'var(--fin-positive)', border: '1px solid color-mix(in srgb, var(--fin-positive) 30%, transparent)', background: 'color-mix(in srgb, var(--fin-positive) 6%, transparent)' }}>
              {analyzing && <Loader2 size={12} className="animate-spin" />}
              {analyzing ? 'Analysing…' : 'AI Analyze'}
            </button>
            {isEditor && (
              <>
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
                  <Edit2 size={12} /> Edit
                </button>
                {deleteConfirm ? (
                  <div className="flex gap-1 items-center">
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--fin-negative) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 30%, transparent)', color: 'var(--fin-negative)' }}>
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
                    style={{ color: 'var(--fin-negative)', border: '1px solid color-mix(in srgb, var(--fin-negative) 20%, transparent)', background: 'var(--card-bg)' }}>
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
                  {plainLabel(projectStatus)}
                </span>
              )}
              {f['Health'] && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                  {plainLabel(f['Health'])}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={openStatusBoard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)', background: 'var(--accent-dim)' }}>
                <Activity size={11} /> View matching status
              </button>
              <button onClick={openInvoicesWorkspace}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
                <Receipt size={11} /> View matching invoices
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

        {/* ── Key metrics ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={DollarSign}  label="Billed so far"  value={f['Amount Billed So far'] ? formatInr(f['Amount Billed So far']) : null} accent="var(--accent)" />
          <StatCard icon={TrendingUp}  label="Actual profit"  value={f['Actual Profit'] ? formatInr(f['Actual Profit']) : null} accent={profitPct > 0 ? 'var(--fin-positive)' : 'var(--fin-negative)'} />
          <StatCard icon={BarChart2}   label="Profit %"       value={profitPct ? formatPct(profitPct, 1) : null} accent={profitPct > 20 ? 'var(--fin-positive)' : profitPct > 0 ? 'var(--fin-warning)' : 'var(--fin-negative)'} />
          <StatCard icon={DollarSign}  label="Target revenue" value={f['Target Revenue'] ? formatInr(f['Target Revenue']) : null} accent="var(--chart-3)" />
        </div>

        {/* ── Project details ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5">

          {/* Project details */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <h2 className="text-xs font-bold uppercase tracking-[0.06em] mb-5 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <BarChart2 size={12} /> Project Details
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Client"          value={f['Client']} />
              <Field label="Project Name"    value={f['Project Name']} />
              <Field label="Status"          value={plainLabel(f['Project Status'])} />
              <Field label="Health"          value={plainLabel(f['Health'])} />
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
                    style={{ color: f['Target Achieved '] ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
                    {f['Target Achieved ']
                      ? <><CheckCircle2 size={13} /> Yes</>
                      : <><AlertCircle size={13} /> No</>}
                  </dd>
                </div>
              )}
            </dl>
          </div>

        </div>

        {/* ── AI analysis loading ────────────────────────────────────────── */}
        {analyzing && (
          <div className="rounded-2xl p-4 flex items-center gap-3 text-sm"
            style={{ border: '1px solid color-mix(in srgb, var(--fin-positive) 20%, transparent)', background: 'color-mix(in srgb, var(--fin-positive) 4%, transparent)', color: 'var(--fin-positive)' }}>
            <Loader2 size={16} className="animate-spin flex-shrink-0" />
            Generating AI analysis for this project…
          </div>
        )}

        {/* ── AI analysis result ─────────────────────────────────────────── */}
        {analysis && !analyzing && (
          <div className="rounded-2xl p-5 animate-fade-in"
            style={{ border: '1px solid color-mix(in srgb, var(--fin-positive) 25%, transparent)', background: 'color-mix(in srgb, var(--fin-positive) 4%, transparent)' }}>
            <h2 className="font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--fin-positive)' }}>
              AI Analysis
            </h2>
            <AiText text={analysis} />
          </div>
        )}
      </div>
    </div>
  )
}
