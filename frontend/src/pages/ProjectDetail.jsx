import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, Trash2, Sparkles, Loader2, Check, X, RefreshCw } from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import { api } from '../services/api'
import { formatInr, formatPct } from '../utils/format'

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
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

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
  const isNew = id === 'new'

  const [record, setRecord]               = useState(null)
  const [loading, setLoading]             = useState(!isNew)
  const [editing, setEditing]             = useState(isNew)
  const [saving, setSaving]               = useState(false)
  const [analysis, setAnalysis]           = useState('')
  const [analyzing, setAnalyzing]         = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]           = useState(false)

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

  useEffect(() => { loadRecord() }, [loadRecord])

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
              style={{ color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}
              aria-label="Run AI analysis">
              {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {analyzing ? 'Analyzing…' : 'AI Analyze'}
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
        </div>
      )}
    </div>
  )
}
