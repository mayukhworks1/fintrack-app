import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { api } from '../services/api'

const CLIENTS = ['Birla Open Minds', 'Maitrimetal', 'BG']
const PROJECTS = ['ZOHO', 'Pms', 'Innovine']
const STATUSES = ['🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']

const empty = {
  client: '', project_name: '', project_start_date: '', duration_months: '',
  resource_count: '', combined_monthly_salary: '', amount_billed: '',
  project_status: '', resource_contribution_pct: '',
}

export default function ProjectForm({ initial = {}, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({ ...empty, ...initial })
  const [aiDesc, setAiDesc] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAIFill = async () => {
    if (!aiDesc.trim()) return
    setAiLoading(true)
    try {
      const { fields } = await api.ai.autofill(aiDesc)
      setForm((f) => ({
        ...f,
        ...(fields.client && { client: fields.client }),
        ...(fields.project_name && { project_name: fields.project_name }),
        ...(fields.project_start_date && { project_start_date: fields.project_start_date?.split('T')[0] }),
        ...(fields.duration_months && { duration_months: String(fields.duration_months) }),
        ...(fields.resource_count != null && { resource_count: String(fields.resource_count) }),
        ...(fields.combined_monthly_salary != null && { combined_monthly_salary: String(fields.combined_monthly_salary) }),
        ...(fields.amount_billed != null && { amount_billed: String(fields.amount_billed) }),
        ...(fields.project_status && { project_status: fields.project_status }),
        ...(fields.resource_contribution_pct != null && { resource_contribution_pct: String(fields.resource_contribution_pct) }),
      }))
    } catch (e) {
      alert('AI autofill failed: ' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {}
    if (form.client) payload.client = form.client
    if (form.project_name) payload.project_name = form.project_name
    if (form.project_start_date) payload.project_start_date = new Date(form.project_start_date).toISOString()
    if (form.duration_months) payload.duration_months = form.duration_months
    if (form.resource_count) payload.resource_count = parseInt(form.resource_count)
    if (form.combined_monthly_salary) payload.combined_monthly_salary = parseFloat(form.combined_monthly_salary)
    if (form.amount_billed) payload.amount_billed = parseFloat(form.amount_billed)
    if (form.project_status) payload.project_status = form.project_status
    if (form.resource_contribution_pct) payload.resource_contribution_pct = parseFloat(form.resource_contribution_pct)
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* AI Autofill */}
      <div className="card border-brand-500/30 bg-brand-500/5">
        <p className="text-sm font-medium text-brand-400 mb-2 flex items-center gap-2">
          <Sparkles size={14} /> AI Autofill
        </p>
        <div className="flex gap-2">
          <input
            className="input text-sm flex-1"
            placeholder="Describe the project... e.g. 'Birla ZOHO project starting June, 3 resources, 6 months'"
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAIFill())}
          />
          <button type="button" onClick={handleAIFill} disabled={aiLoading} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Fill
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Client *</label>
          <select className="input" value={form.client} onChange={set('client')} required>
            <option value="">Select client</option>
            {CLIENTS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Project Name *</label>
          <select className="input" value={form.project_name} onChange={set('project_name')} required>
            <option value="">Select project</option>
            {PROJECTS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Start Date</label>
          <input type="date" className="input" value={form.project_start_date} onChange={set('project_start_date')} />
        </div>
        <div>
          <label className="label">Duration (Months)</label>
          <input type="number" className="input" placeholder="e.g. 6" value={form.duration_months} onChange={set('duration_months')} min="1" />
        </div>
        <div>
          <label className="label">Resource Count</label>
          <input type="number" className="input" placeholder="e.g. 3" value={form.resource_count} onChange={set('resource_count')} min="1" />
        </div>
        <div>
          <label className="label">Combined Monthly Salary (₹)</label>
          <input type="number" className="input" placeholder="e.g. 150000" value={form.combined_monthly_salary} onChange={set('combined_monthly_salary')} min="0" />
        </div>
        <div>
          <label className="label">Amount Billed So Far (₹)</label>
          <input type="number" className="input" placeholder="e.g. 500000" value={form.amount_billed} onChange={set('amount_billed')} min="0" />
        </div>
        <div>
          <label className="label">Project Status</label>
          <select className="input" value={form.project_status} onChange={set('project_status')}>
            <option value="">Select status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Resource Contribution %</label>
          <input type="number" className="input" placeholder="e.g. 80" value={form.resource_contribution_pct} onChange={set('resource_contribution_pct')} min="0" max="100" />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Save Project
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>}
      </div>
    </form>
  )
}
