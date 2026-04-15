import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, Trash2, Sparkles, Loader2, Check, X, RefreshCw } from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

function Field({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</dt>
      <dd className="text-sm text-white font-medium mt-0.5">{String(value)}</dd>
    </div>
  )
}

function MetricCard({ label, value, highlight }) {
  return (
    <div className={clsx('card text-center', highlight && 'border-brand-500/30 bg-brand-500/5')}>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={clsx('text-xl font-bold mt-1', highlight ? 'text-brand-400' : 'text-white')}>{value}</p>
    </div>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isNew = id === 'new'

  const [record, setRecord]           = useState(null)
  const [loading, setLoading]         = useState(!isNew)
  const [editing, setEditing]         = useState(isNew)
  const [saving, setSaving]           = useState(false)
  const [analysis, setAnalysis]       = useState('')
  const [analyzing, setAnalyzing]     = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting]       = useState(false)

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
      <Loader2 size={28} className="animate-spin text-brand-400" />
    </div>
  )

  const f = record?.fields || {}
  const profitPct = Number(f['Profit percentage'] || 0)
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5 animate-fade-in">
      {/* Breadcrumb / header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/projects')}
          aria-label="Back to projects"
          className="btn-icon"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">
            {isNew ? 'New Project' : (f['Project Name'] || 'Project')}
          </h1>
          {!isNew && (
            <p className="text-sm text-gray-500 truncate">{f['Client']} · {record?.id}</p>
          )}
        </div>
        {!isNew && !editing && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={loadRecord}
              aria-label="Refresh project data"
              className="btn-icon"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="btn-ghost flex items-center gap-2 text-sm"
              aria-label="Run AI analysis"
            >
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {analyzing ? 'Analyzing…' : 'AI Analyze'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="btn-ghost flex items-center gap-2 text-sm"
            >
              <Edit2 size={14} /> Edit
            </button>
            {deleteConfirm ? (
              <div className="flex gap-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger flex items-center gap-1.5 text-sm px-3"
                  aria-label="Confirm delete"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Confirm
                </button>
                <button onClick={() => setDeleteConfirm(false)} className="btn-icon" aria-label="Cancel delete">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="btn-ghost text-red-400 hover:bg-red-500/10 flex items-center gap-2 text-sm"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Edit / Create form */}
      {editing ? (
        <div className="card">
          <h2 className="font-semibold text-white mb-4">{isNew ? 'Create Project' : 'Edit Project'}</h2>
          <ProjectForm
            initial={isNew ? {} : {
              client:                   f['Client'] || '',
              project_name:             f['Project Name'] || '',
              project_start_date:       f['Project Start Date']?.split('T')[0] || '',
              duration_months:          String(f['Duration (Months)'] || ''),
              resource_count:           String(f['Resource Count'] || ''),
              combined_monthly_salary:  String(f['Combined monthly salary of all the resources'] || ''),
              amount_billed:            String(f['Amount Billed So far'] || ''),
              project_status:           f['Project Status'] || '',
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
            <MetricCard label="Amount Billed"   value={fmt(f['Amount Billed So far'])} />
            <MetricCard label="Actual Profit"   value={fmt(f['Actual Profit'])} />
            <MetricCard label="Profit %"        value={`${profitPct.toFixed(1)}%`} highlight={profitPct > 0} />
            <MetricCard label="Target Revenue"  value={fmt(f['Target Revenue'])} />
          </div>

          {/* Detail fields */}
          <div className="card">
            <h2 className="section-title mb-5">Project Details</h2>
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

          {/* AI Analysis */}
          {analyzing && (
            <div className="card border-brand-500/20 bg-brand-500/5 flex items-center gap-3 text-brand-400 text-sm">
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              Generating AI analysis…
            </div>
          )}
          {analysis && !analyzing && (
            <div className="card border-brand-500/30 bg-brand-500/5 animate-fade-in">
              <h2 className="font-semibold text-brand-400 mb-3 flex items-center gap-2">
                <Sparkles size={16} aria-hidden="true" /> AI Analysis
              </h2>
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{analysis}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
