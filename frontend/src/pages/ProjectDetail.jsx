import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, Trash2, Sparkles, Loader2, Check, X } from 'lucide-react'
import ProjectForm from '../components/ProjectForm'
import { api } from '../services/api'

function Field({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-white font-medium mt-0.5">{String(value)}</p>
    </div>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [editing, setEditing] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [analysis, setAnalysis] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    if (isNew) return
    api.projects.get(id).then(setRecord).finally(() => setLoading(false))
  }, [id])

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (isNew) {
        const created = await api.projects.create(payload)
        navigate(`/projects/${created.id}`, { replace: true })
      } else {
        const updated = await api.projects.update(id, payload)
        setRecord(updated)
        setEditing(false)
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await api.projects.delete(id)
      navigate('/projects', { replace: true })
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalysis('')
    try {
      const { analysis: a } = await api.ai.analyze(id)
      setAnalysis(a)
    } catch (e) {
      setAnalysis('Analysis failed: ' + e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const f = record?.fields || {}

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/projects')} className="p-2 rounded-lg hover:bg-surface-700 transition-colors">
          <ArrowLeft size={18} className="text-gray-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{isNew ? 'New Project' : (f['Project Name'] || 'Project')}</h1>
          {!isNew && <p className="text-sm text-gray-500">{f['Client']} · {record?.id}</p>}
        </div>
        {!isNew && !editing && (
          <div className="flex gap-2">
            <button onClick={handleAnalyze} disabled={analyzing} className="btn-ghost flex items-center gap-2 text-sm">
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              AI Analyze
            </button>
            <button onClick={() => setEditing(true)} className="btn-ghost flex items-center gap-2 text-sm">
              <Edit2 size={14} /> Edit
            </button>
            {deleteConfirm ? (
              <div className="flex gap-1">
                <button onClick={handleDelete} className="btn-danger flex items-center gap-1 text-sm px-3">
                  <Check size={14} /> Confirm
                </button>
                <button onClick={() => setDeleteConfirm(false)} className="btn-ghost px-2">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(true)} className="btn-ghost text-red-400 hover:bg-red-500/10 flex items-center gap-2 text-sm">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="card">
          <h2 className="font-semibold text-white mb-4">{isNew ? 'Create Project' : 'Edit Project'}</h2>
          <ProjectForm
            initial={isNew ? {} : {
              client: f['Client'] || '',
              project_name: f['Project Name'] || '',
              project_start_date: f['Project Start Date']?.split('T')[0] || '',
              duration_months: f['Duration (Months)'] || '',
              resource_count: f['Resource Count'] || '',
              combined_monthly_salary: f['Combined monthly salary of all the resources'] || '',
              amount_billed: f['Amount Billed So far'] || '',
              project_status: f['Project Status'] || '',
              resource_contribution_pct: f['Resource contribution percentage'] || '',
            }}
            onSubmit={handleSave}
            onCancel={isNew ? () => navigate('/projects') : () => setEditing(false)}
            loading={saving}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Key metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Amount Billed', value: `₹${Number(f['Amount Billed So far'] || 0).toLocaleString('en-IN')}` },
              { label: 'Actual Profit', value: `₹${Number(f['Actual Profit'] || 0).toLocaleString('en-IN')}` },
              { label: 'Profit %', value: `${Number(f['Profit percentage'] || 0).toFixed(1)}%` },
              { label: 'Target Revenue', value: `₹${Number(f['Target Revenue'] || 0).toLocaleString('en-IN')}` },
            ].map(({ label, value }) => (
              <div key={label} className="card text-center">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-lg font-bold text-white mt-1">{value}</p>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="card">
            <h2 className="font-semibold text-white mb-4">Project Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <Field label="Client" value={f['Client']} />
              <Field label="Project Name" value={f['Project Name']} />
              <Field label="Status" value={f['Project Status']} />
              <Field label="Health" value={f['Health']} />
              <Field label="Start Date" value={f['Project Start Date'] ? new Date(f['Project Start Date']).toLocaleDateString('en-IN') : null} />
              <Field label="Duration" value={f['Duration (Months)'] ? `${f['Duration (Months)']} months` : null} />
              <Field label="Resources" value={f['Resource Count']} />
              <Field label="Monthly Salary" value={f['Combined monthly salary of all the resources'] ? `₹${Number(f['Combined monthly salary of all the resources']).toLocaleString('en-IN')}` : null} />
              <Field label="Overhead Cost" value={f['Total Overhead Cost'] ? `₹${Number(f['Total Overhead Cost']).toLocaleString('en-IN')}` : null} />
              <Field label="Input Cost So Far" value={f['Input cost so far'] ? `₹${Number(f['Input cost so far']).toLocaleString('en-IN')}` : null} />
              <Field label="Target Achieved" value={f['Target Achieved '] ? 'Yes ✅' : 'No ❌'} />
              <Field label="Contribution %" value={f['Resource contribution percentage'] ? `${f['Resource contribution percentage']}%` : null} />
              <Field label="Revenue per Resource" value={f['Revenue per Resource'] ? `₹${Number(f['Revenue per Resource']).toLocaleString('en-IN')}` : null} />
            </div>
          </div>

          {/* AI Analysis */}
          {analysis && (
            <div className="card border-brand-500/30 bg-brand-500/5">
              <h2 className="font-semibold text-brand-400 mb-3 flex items-center gap-2">
                <Sparkles size={16} /> AI Analysis
              </h2>
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{analysis}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
