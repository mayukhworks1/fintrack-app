import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'

const CLIENTS  = ['Birla Open Minds', 'Maitrimetal', 'BG']
const PROJECTS = ['ZOHO', 'Pms', 'Innovine']
const STATUSES = ['🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']

const empty = {
  client: '', project_name: '', project_start_date: '', duration_months: '',
  resource_count: '', combined_monthly_salary: '', amount_billed: '',
  project_status: '', resource_contribution_pct: '',
}

function FormField({ label, required, children, hint }) {
  return (
    <div>
      <label className="label">
        {label}{required && <span className="text-red-400 ml-1" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

export default function ProjectForm({ initial = {}, onSubmit, onCancel, loading }) {
  const [form, setForm]       = useState({ ...empty, ...initial })
  const [aiDesc, setAiDesc]   = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const toast = useToast()

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAIFill = async () => {
    if (!aiDesc.trim()) { toast('Enter a project description first', 'warning'); return }
    setAiLoading(true)
    try {
      const { fields } = await api.ai.autofill(aiDesc)
      if (!fields || !Object.keys(fields).length) {
        toast('AI could not extract fields — try a more detailed description', 'warning')
        return
      }
      setForm((f) => ({
        ...f,
        ...(fields.client              && { client: fields.client }),
        ...(fields.project_name        && { project_name: fields.project_name }),
        ...(fields.project_start_date  && { project_start_date: fields.project_start_date?.split('T')[0] }),
        ...(fields.duration_months     && { duration_months: String(fields.duration_months) }),
        ...(fields.resource_count      != null && { resource_count: String(fields.resource_count) }),
        ...(fields.combined_monthly_salary != null && { combined_monthly_salary: String(fields.combined_monthly_salary) }),
        ...(fields.amount_billed       != null && { amount_billed: String(fields.amount_billed) }),
        ...(fields.project_status      && { project_status: fields.project_status }),
        ...(fields.resource_contribution_pct != null && { resource_contribution_pct: String(fields.resource_contribution_pct) }),
      }))
      toast('Fields filled by AI — review before saving', 'success')
    } catch (e) {
      toast('AI autofill failed: ' + e.message, 'error')
    } finally {
      setAiLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {}
    if (form.client)                    payload.client = form.client
    if (form.project_name)              payload.project_name = form.project_name
    if (form.project_start_date)        payload.project_start_date = new Date(form.project_start_date).toISOString()
    if (form.duration_months)           payload.duration_months = form.duration_months
    if (form.resource_count)            payload.resource_count = parseInt(form.resource_count)
    if (form.combined_monthly_salary)   payload.combined_monthly_salary = parseFloat(form.combined_monthly_salary)
    if (form.amount_billed)             payload.amount_billed = parseFloat(form.amount_billed)
    if (form.project_status)            payload.project_status = form.project_status
    if (form.resource_contribution_pct) payload.resource_contribution_pct = parseFloat(form.resource_contribution_pct)
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-label="Project form">
      {/* AI Autofill */}
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
        <p className="text-sm font-medium text-brand-400 mb-2.5 flex items-center gap-2">
          <Sparkles size={14} aria-hidden="true" /> AI Autofill
          <span className="text-xs text-gray-500 font-normal">— describe the project and AI will fill the fields</span>
        </p>
        <div className="flex gap-2">
          <input
            className="input text-sm flex-1"
            placeholder="e.g. Birla ZOHO project starting June, 3 resources, 6 months, ₹2L billed"
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAIFill())}
            aria-label="Describe project for AI autofill"
            disabled={aiLoading}
          />
          <button
            type="button"
            onClick={handleAIFill}
            disabled={aiLoading || !aiDesc.trim()}
            className="btn-primary flex items-center gap-2 whitespace-nowrap px-3"
            aria-label="Fill form with AI"
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {aiLoading ? 'Filling…' : 'Fill'}
          </button>
        </div>
      </div>

      {/* Form fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Client" required>
          <select className="input" value={form.client} onChange={set('client')} required aria-required="true">
            <option value="">Select client</option>
            {CLIENTS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </FormField>

        <FormField label="Project Name" required>
          <select className="input" value={form.project_name} onChange={set('project_name')} required aria-required="true">
            <option value="">Select project</option>
            {PROJECTS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </FormField>

        <FormField label="Start Date">
          <input type="date" className="input" value={form.project_start_date} onChange={set('project_start_date')} aria-label="Project start date" />
        </FormField>

        <FormField label="Duration (Months)">
          <input type="number" className="input" placeholder="e.g. 6" value={form.duration_months} onChange={set('duration_months')} min="1" aria-label="Duration in months" />
        </FormField>

        <FormField label="Resource Count">
          <input type="number" className="input" placeholder="e.g. 3" value={form.resource_count} onChange={set('resource_count')} min="1" aria-label="Number of resources" />
        </FormField>

        <FormField label="Combined Monthly Salary (₹)">
          <input type="number" className="input" placeholder="e.g. 150000" value={form.combined_monthly_salary} onChange={set('combined_monthly_salary')} min="0" aria-label="Combined monthly salary in rupees" />
        </FormField>

        <FormField label="Amount Billed So Far (₹)">
          <input type="number" className="input" placeholder="e.g. 500000" value={form.amount_billed} onChange={set('amount_billed')} min="0" aria-label="Amount billed so far in rupees" />
        </FormField>

        <FormField label="Project Status">
          <select className="input" value={form.project_status} onChange={set('project_status')} aria-label="Project status">
            <option value="">Select status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </FormField>

        <FormField label="Resource Contribution %" hint="0–100">
          <input
            type="number" className="input" placeholder="e.g. 80"
            value={form.resource_contribution_pct} onChange={set('resource_contribution_pct')}
            min="0" max="100" step="0.1"
            aria-label="Resource contribution percentage"
          />
        </FormField>
      </div>

      <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {loading ? 'Saving…' : 'Save Project'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost" disabled={loading}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
