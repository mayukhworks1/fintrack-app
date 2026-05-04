/**
 * Web Projects Tracker — for the 'all' role (All@2026)
 *
 * Exports:
 *   ProjectsWorkspace (named) — embeddable inside WebInvoices as a workspace tab
 *   WebProjects       (default) — standalone full-page app (kept for potential future use)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ArrowLeft, Plus, Edit2, Trash2, X, Check, Loader2, RefreshCw,
  Search, Users, Briefcase, Moon, Sun, LogOut, AlertTriangle, Clock,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { formatInr } from '../utils/format'
import clsx from 'clsx'

// ── Constants ────────────────────────────────────────────────────────────────

const STATUSES       = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled']
const PRIORITIES     = ['Low', 'Medium', 'High', 'Critical']
const RATE_UNITS     = ['Per Month', 'Per Hour', 'Per Day', 'Per Unit', 'Fixed']
const RESOURCE_TYPES = ['Employee', 'Contractor', 'Tool', 'Vendor', 'Other']

const STATUS_COLORS = {
  Active:    { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   text: '#4ade80' },
  Planning:  { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)',  text: '#60a5fa' },
  'On Hold': { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.3)',  text: '#fb923c' },
  Completed: { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', text: '#94a3b8' },
  Cancelled: { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', text: '#f87171' },
}

const PRIORITY_COLORS = {
  Critical: { bg: 'rgba(248,113,113,0.12)', text: '#f87171' },
  High:     { bg: 'rgba(251,146,60,0.12)',  text: '#fb923c' },
  Medium:   { bg: 'rgba(250,204,21,0.12)',  text: '#fbbf24' },
  Low:      { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' },
}

// ── Shared micro-components ───────────────────────────────────────────────────

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS['On Hold']
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {status}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.Low
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text }}>
      {priority}
    </span>
  )
}

function ProgressBar({ value }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0))
  const color = pct >= 100 ? '#4ade80' : pct >= 60 ? '#60a5fa' : pct >= 30 ? '#fb923c' : '#94a3b8'
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>Progress</span>
        <span className="text-xs font-semibold tabular-nums" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="card text-center" style={accent ? { border: `1px solid ${accent}33`, background: `${accent}08` } : {}}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-lg font-bold tabular-nums" style={{ color: accent || 'var(--text-1)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function FormRow({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: 'var(--text-3)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: '#f87171' }}>*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

const inputCls   = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all'
const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }

const TextInput = ({ value, onChange, placeholder, type = 'text', required }) => (
  <input type={type} className={inputCls} style={inputStyle}
    value={value ?? ''} onChange={e => onChange(e.target.value)}
    placeholder={placeholder} required={required} />
)

const NumberInput = ({ value, onChange, placeholder, min, max, step = 'any' }) => (
  <input type="number" min={min} max={max} step={step} className={inputCls} style={inputStyle}
    value={value ?? ''} placeholder={placeholder}
    onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
)

const SelectInput = ({ value, onChange, options, placeholder }) => (
  <select className={inputCls} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
)

const TextareaInput = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea className={inputCls} style={{ ...inputStyle, resize: 'vertical' }}
    value={value ?? ''} onChange={e => onChange(e.target.value)}
    placeholder={placeholder} rows={rows} />
)

// ── Drawer ────────────────────────────────────────────────────────────────────

function Drawer({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div className="relative ml-auto flex flex-col h-full w-full max-w-md shadow-2xl animate-slide-up"
        style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid var(--border)' }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

// ── Project Form ──────────────────────────────────────────────────────────────

function ProjectForm({ initial = {}, onSubmit, loading }) {
  const [d, setD] = useState({
    project_name: '', client: '', status: 'Planning', priority: 'Medium',
    project_lead: '', description: '', est_start: '', est_end: '',
    actual_start: '', actual_end: '', estimated_budget: '', client_charge: '',
    progress_pct: '', tags: '', context_notes: '', risks_blockers: '',
    ...initial,
  })
  const set = k => v => setD(p => ({ ...p, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const p = {}
    if (d.project_name)             p.project_name     = d.project_name
    if (d.client)                   p.client           = d.client
    if (d.status)                   p.status           = d.status
    if (d.priority)                 p.priority         = d.priority
    if (d.project_lead)             p.project_lead     = d.project_lead
    if (d.description)              p.description      = d.description
    if (d.est_start)                p.est_start        = d.est_start
    if (d.est_end)                  p.est_end          = d.est_end
    if (d.actual_start)             p.actual_start     = d.actual_start
    if (d.actual_end)               p.actual_end       = d.actual_end
    if (d.estimated_budget !== '')  p.estimated_budget = Number(d.estimated_budget)
    if (d.client_charge    !== '')  p.client_charge    = Number(d.client_charge)
    if (d.progress_pct     !== '')  p.progress_pct     = Number(d.progress_pct)
    if (d.tags)                     p.tags             = d.tags
    if (d.context_notes)            p.context_notes    = d.context_notes
    if (d.risks_blockers)           p.risks_blockers   = d.risks_blockers
    onSubmit(p)
  }

  return (
    <form onSubmit={handleSubmit} id="project-form" className="space-y-4">
      <FormRow label="Project Name" required>
        <TextInput value={d.project_name} onChange={set('project_name')} placeholder="e.g. Web Portal Redesign" required />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Client">
          <TextInput value={d.client} onChange={set('client')} placeholder="Client name" />
        </FormRow>
        <FormRow label="Project Lead">
          <TextInput value={d.project_lead} onChange={set('project_lead')} placeholder="Name" />
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Status">
          <SelectInput value={d.status} onChange={set('status')} options={STATUSES} />
        </FormRow>
        <FormRow label="Priority">
          <SelectInput value={d.priority} onChange={set('priority')} options={PRIORITIES} />
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Est. Start"><TextInput type="date" value={d.est_start} onChange={set('est_start')} /></FormRow>
        <FormRow label="Est. End"><TextInput type="date" value={d.est_end} onChange={set('est_end')} /></FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Actual Start"><TextInput type="date" value={d.actual_start} onChange={set('actual_start')} /></FormRow>
        <FormRow label="Actual End"><TextInput type="date" value={d.actual_end} onChange={set('actual_end')} /></FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Est. Budget (₹)">
          <NumberInput value={d.estimated_budget} onChange={set('estimated_budget')} placeholder="0" min={0} />
        </FormRow>
        <FormRow label="Client Charge (₹)">
          <NumberInput value={d.client_charge} onChange={set('client_charge')} placeholder="0" min={0} />
        </FormRow>
      </div>
      <FormRow label="Progress %">
        <NumberInput value={d.progress_pct} onChange={set('progress_pct')} placeholder="0" min={0} max={100} step={1} />
      </FormRow>
      <FormRow label="Tags">
        <TextInput value={d.tags} onChange={set('tags')} placeholder="comma-separated tags" />
      </FormRow>
      <FormRow label="Description">
        <TextareaInput value={d.description} onChange={set('description')} placeholder="Brief project overview…" />
      </FormRow>
      <FormRow label="Context & Notes">
        <TextareaInput value={d.context_notes} onChange={set('context_notes')} placeholder="Background, decisions, links…" />
      </FormRow>
      <FormRow label="Risks & Blockers">
        <TextareaInput value={d.risks_blockers} onChange={set('risks_blockers')} placeholder="Known risks or blockers…" />
      </FormRow>
    </form>
  )
}

// ── Resource Form ─────────────────────────────────────────────────────────────

function ResourceForm({ initial = {}, onSubmit, loading }) {
  const [d, setD] = useState({
    resource_name: '', role: '', type_: 'Employee',
    rate: '', rate_unit: 'Per Month', units: '',
    man_hours: '', planned_hours: '',
    billing_rate: '', billable_units: '',
    from_date: '', to_date: '', notes: '',
    ...initial,
  })
  const set = k => v => setD(p => ({ ...p, [k]: v }))

  // Live calculations
  const totalCost    = useMemo(() => (Number(d.rate) || 0) * (Number(d.units) || 0), [d.rate, d.units])
  const totalRevenue = useMemo(() => (Number(d.billing_rate) || 0) * (Number(d.billable_units) || 0), [d.billing_rate, d.billable_units])
  const grossMargin  = totalRevenue - totalCost
  const costPerHour  = d.man_hours ? totalCost / Number(d.man_hours) : null

  const handleSubmit = (e) => {
    e.preventDefault()
    const p = {}
    if (d.resource_name)           p.resource_name   = d.resource_name
    if (d.role)                    p.role             = d.role
    if (d.type_)                   p.type_            = d.type_
    if (d.rate !== '')             p.rate             = Number(d.rate)
    if (d.rate_unit)               p.rate_unit        = d.rate_unit
    if (d.units !== '')            p.units            = Number(d.units)
    if (d.man_hours !== '')        p.man_hours        = Number(d.man_hours)
    if (d.planned_hours !== '')    p.planned_hours    = Number(d.planned_hours)
    if (d.billing_rate !== '')     p.billing_rate     = Number(d.billing_rate)
    if (d.billable_units !== '')   p.billable_units   = Number(d.billable_units)
    if (d.from_date)               p.from_date        = d.from_date
    if (d.to_date)                 p.to_date          = d.to_date
    if (d.notes)                   p.notes            = d.notes
    onSubmit(p)
  }

  return (
    <form onSubmit={handleSubmit} id="resource-form" className="space-y-4">
      <FormRow label="Resource Name" required>
        <TextInput value={d.resource_name} onChange={set('resource_name')} placeholder="e.g. Rahul Sharma" required />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Role">
          <TextInput value={d.role} onChange={set('role')} placeholder="e.g. Frontend Dev" />
        </FormRow>
        <FormRow label="Type">
          <SelectInput value={d.type_} onChange={set('type_')} options={RESOURCE_TYPES} />
        </FormRow>
      </div>

      {/* Cost section */}
      <div className="pt-2 pb-1">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Cost (What you pay)</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Rate (₹)">
              <NumberInput value={d.rate} onChange={set('rate')} placeholder="0" min={0} />
            </FormRow>
            <FormRow label="Rate Unit">
              <SelectInput value={d.rate_unit} onChange={set('rate_unit')} options={RATE_UNITS} />
            </FormRow>
          </div>
          <FormRow label="Units" hint="Months / hours / days depending on Rate Unit">
            <NumberInput value={d.units} onChange={set('units')} placeholder="e.g. 2" min={0} step={0.5} />
          </FormRow>
          {totalCost > 0 && (
            <div className="px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', color: '#fb923c' }}>
              Total cost: <strong>{formatInr(totalCost)}</strong>
              {costPerHour && <span className="ml-2 opacity-70">· ₹{Math.round(costPerHour)}/hr</span>}
            </div>
          )}
        </div>
      </div>

      {/* Man hours section */}
      <div className="pt-2 pb-1">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Man Hours</p>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Actual Hours" hint="Total hours worked">
            <NumberInput value={d.man_hours} onChange={set('man_hours')} placeholder="e.g. 160" min={0} step={0.5} />
          </FormRow>
          <FormRow label="Planned Hours" hint="Originally estimated">
            <NumberInput value={d.planned_hours} onChange={set('planned_hours')} placeholder="e.g. 140" min={0} step={0.5} />
          </FormRow>
        </div>
        {d.man_hours !== '' && d.planned_hours !== '' && (
          <div className="mt-2 px-3 py-2 rounded-xl text-xs" style={{
            background: Number(d.man_hours) > Number(d.planned_hours) ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)',
            border: `1px solid ${Number(d.man_hours) > Number(d.planned_hours) ? 'rgba(248,113,113,0.2)' : 'rgba(34,197,94,0.2)'}`,
            color: Number(d.man_hours) > Number(d.planned_hours) ? '#f87171' : '#4ade80',
          }}>
            Hours variance: {Number(d.man_hours) > Number(d.planned_hours) ? '+' : ''}{Number(d.man_hours) - Number(d.planned_hours)}h
            {Number(d.man_hours) > Number(d.planned_hours) ? ' over estimate' : ' under estimate'}
          </div>
        )}
      </div>

      {/* Revenue section */}
      <div className="pt-2 pb-1">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Revenue (What you charge)</p>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Billing Rate (₹)" hint="Rate charged to client">
            <NumberInput value={d.billing_rate} onChange={set('billing_rate')} placeholder="0" min={0} />
          </FormRow>
          <FormRow label="Billable Units" hint="Units billed to client">
            <NumberInput value={d.billable_units} onChange={set('billable_units')} placeholder="0" min={0} step={0.5} />
          </FormRow>
        </div>
        {totalRevenue > 0 && (
          <div className="mt-2 px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}>
            Revenue: <strong>{formatInr(totalRevenue)}</strong>
            {totalCost > 0 && (
              <span className="ml-2 opacity-80">
                · Margin: <strong style={{ color: grossMargin >= 0 ? '#4ade80' : '#f87171' }}>
                  {formatInr(grossMargin)} ({totalRevenue > 0 ? (grossMargin / totalRevenue * 100).toFixed(1) : 0}%)
                </strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="From Date"><TextInput type="date" value={d.from_date} onChange={set('from_date')} /></FormRow>
        <FormRow label="To Date"><TextInput type="date" value={d.to_date} onChange={set('to_date')} /></FormRow>
      </div>
      <FormRow label="Notes">
        <TextareaInput value={d.notes} onChange={set('notes')} placeholder="Any relevant notes…" rows={2} />
      </FormRow>
    </form>
  )
}

// ── Resource Row ──────────────────────────────────────────────────────────────

function ResourceRow({ resource, onEdit, onDelete }) {
  const f = resource.fields || {}
  const [confirmDelete, setConfirmDelete] = useState(false)
  const totalCost    = Number(f['Total Cost'] || 0)
  const manHours     = Number(f['Man Hours'] || 0)
  const revenue      = Number(f['Revenue Generated'] || 0)
  const margin       = Number(f['Resource Margin %'] || 0)

  return (
    <div className="p-3 rounded-xl transition-all" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
          style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
          {(f['Resource Name'] || '?')[0].toUpperCase()}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>
            {f['Resource Name'] || '—'}
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {[f['Role'], f['Type']].filter(Boolean).join(' · ') || 'No role'}
            {manHours > 0 && <span className="ml-2"><Clock size={9} className="inline mr-0.5" />{manHours}h</span>}
          </p>
        </div>
        {/* Cost / Revenue */}
        <div className="hidden sm:flex flex-col items-end text-right">
          <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
            {totalCost ? formatInr(totalCost) : '—'}
          </p>
          {revenue > 0 ? (
            <p className="text-xs" style={{ color: '#4ade80' }}>
              Rev: {formatInr(revenue)}
              {margin > 0 && <span className="ml-1 opacity-70">({margin.toFixed(1)}%)</span>}
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {f['Rate ₹'] ? `${formatInr(f['Rate ₹'])} × ${f['Units'] || 0} ${f['Rate Unit'] || ''}` : 'No rate'}
            </p>
          )}
        </div>
        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          {confirmDelete ? (
            <>
              <button onClick={() => onDelete(resource.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                <Check size={11} /> Yes
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                <X size={11} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(resource)}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                <Edit2 size={12} />
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ record, onClick }) {
  const f      = record.fields || {}
  const profit = Number(f['Actual Profit'] || 0)
  const margin = Number(f['Profit Margin %'] || 0)
  const charge = Number(f['Client Charge'] || 0)

  return (
    <button onClick={() => onClick(record)}
      className="card text-left w-full transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{ cursor: 'pointer' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-bold text-sm leading-snug flex-1 min-w-0 truncate" style={{ color: 'var(--text-1)' }}>
          {f['Project Name'] || 'Untitled'}
        </h3>
        {f['Priority'] && <PriorityBadge priority={f['Priority']} />}
      </div>
      <div className="flex items-center gap-2 mb-3">
        {f['Client'] && <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{f['Client']}</span>}
        {f['Status'] && <StatusBadge status={f['Status']} />}
      </div>
      {f['Progress %'] != null && <div className="mb-3"><ProgressBar value={f['Progress %']} /></div>}
      <div className="grid grid-cols-2 gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Charge</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
            {charge ? formatInr(charge) : '—'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Profit</p>
          <p className="text-sm font-semibold tabular-nums"
            style={{ color: profit > 0 ? '#4ade80' : profit < 0 ? '#f87171' : 'var(--text-2)' }}>
            {profit ? formatInr(profit) : '—'}
            {margin ? <span className="text-xs ml-1 opacity-70">({margin.toFixed(1)}%)</span> : null}
          </p>
        </div>
      </div>
      {f['Resource Names'] && (
        <p className="text-xs mt-2 truncate" style={{ color: 'var(--text-3)' }}>
          <Users size={10} className="inline mr-1" />
          {Array.isArray(f['Resource Names']) ? f['Resource Names'].join(', ') : f['Resource Names']}
        </p>
      )}
    </button>
  )
}

// ── Project Detail View ───────────────────────────────────────────────────────

function ProjectDetailView({
  project, resources, resourcesLoading,
  onBack, onEditProject, onDeleteProject,
  onAddResource, onEditResource, onDeleteResource, onRefresh,
}) {
  const f          = project.fields || {}
  const profit     = Number(f['Actual Profit'] || 0)
  const margin     = Number(f['Profit Margin %'] || 0)
  const charge     = Number(f['Client Charge'] || 0)
  const budget     = Number(f['Estimated Budget'] || 0)
  const inputCost  = Number(f['Total Input Cost'] || 0)
  const budgetVar  = Number(f['Budget Variance'] || 0)
  const schedVar   = Number(f['Schedule Variance Days'] || 0)
  const totalManHours = useMemo(
    () => resources.reduce((s, r) => s + Number(r.fields?.['Man Hours'] || 0), 0),
    [resources]
  )
  const totalRevenue = useMemo(
    () => resources.reduce((s, r) => s + Number(r.fields?.['Revenue Generated'] || 0), 0),
    [resources]
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white/5"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {f['Project Name'] || 'Untitled'}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            {f['Client'] && <span className="text-sm" style={{ color: 'var(--text-3)' }}>{f['Client']}</span>}
            {f['Status'] && <StatusBadge status={f['Status']} />}
            {f['Priority'] && <PriorityBadge priority={f['Priority']} />}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end flex-shrink-0">
          <button onClick={onRefresh}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            <RefreshCw size={14} />
          </button>
          <button onClick={onEditProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <Edit2 size={13} /> Edit
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button onClick={onDeleteProject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                <Check size={13} /> Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Client Charge"  value={charge ? formatInr(charge) : '—'} />
        <KpiCard label="Total Cost"     value={inputCost ? formatInr(inputCost) : '—'} />
        <KpiCard label="Actual Profit"  value={profit ? formatInr(profit) : '—'}
          accent={profit > 0 ? '#4ade80' : profit < 0 ? '#f87171' : undefined} />
        <KpiCard label="Margin %"
          value={margin ? `${margin.toFixed(1)}%` : '—'}
          accent={margin > 0 ? '#4ade80' : margin < 0 ? '#f87171' : undefined} />
      </div>

      {/* Man hours + Revenue row (shown once resources have data) */}
      {(totalManHours > 0 || totalRevenue > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {totalManHours > 0 && (
            <KpiCard label="Total Man Hours" value={`${totalManHours}h`}
              sub={inputCost > 0 ? `₹${Math.round(inputCost / totalManHours)}/hr cost` : undefined} />
          )}
          {totalRevenue > 0 && (
            <KpiCard label="Total Revenue" value={formatInr(totalRevenue)}
              accent="#4ade80"
              sub={totalManHours > 0 ? `₹${Math.round(totalRevenue / totalManHours)}/hr billed` : undefined} />
          )}
          {f['Schedule Variance Days'] != null && (
            <KpiCard label="Schedule Var."
              value={`${schedVar > 0 ? '+' : ''}${schedVar}d`}
              accent={schedVar > 0 ? '#f87171' : schedVar < 0 ? '#4ade80' : undefined} />
          )}
        </div>
      )}

      {/* Progress */}
      {f['Progress %'] != null && (
        <div className="card"><ProgressBar value={f['Progress %']} /></div>
      )}

      {/* Detail fields */}
      <div className="card">
        <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>Project Details</h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            ['Project Lead',  f['Project Lead']],
            ['Est. Start',    f['Est. Start']   ? new Date(f['Est. Start']).toLocaleDateString('en-IN') : null],
            ['Est. End',      f['Est. End']     ? new Date(f['Est. End']).toLocaleDateString('en-IN') : null],
            ['Actual Start',  f['Actual Start'] ? new Date(f['Actual Start']).toLocaleDateString('en-IN') : null],
            ['Actual End',    f['Actual End']   ? new Date(f['Actual End']).toLocaleDateString('en-IN') : null],
            ['Est. Budget',   budget ? formatInr(budget) : null],
            ['Budget Var.',   budgetVar ? `${budgetVar > 0 ? '+' : ''}${formatInr(budgetVar)}` : null],
            ['Tags',          f['Tags']],
          ].filter(([, v]) => v != null && v !== '').map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wider font-semibold mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</dt>
              <dd className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{value}</dd>
            </div>
          ))}
        </dl>
        {f['Description'] && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <dt className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Description</dt>
            <dd className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{f['Description']}</dd>
          </div>
        )}
        {f['Context & Notes'] && (
          <div className="mt-3">
            <dt className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Context & Notes</dt>
            <dd className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>{f['Context & Notes']}</dd>
          </div>
        )}
        {f['Risks & Blockers'] && (
          <div className="mt-3">
            <dt className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Risks & Blockers</dt>
            <dd className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#fb923c' }}>{f['Risks & Blockers']}</dd>
          </div>
        )}
      </div>

      {/* Resources */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Resources</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {resources.length} resource{resources.length !== 1 ? 's' : ''}
              {totalManHours > 0 && <span> · {totalManHours}h total</span>}
            </p>
          </div>
          <button onClick={onAddResource}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff' }}>
            <Plus size={13} /> Add Resource
          </button>
        </div>
        {resourcesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          </div>
        ) : resources.length === 0 ? (
          <div className="text-center py-8">
            <Users size={28} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-3)' }} />
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No resources yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Add people, tools or vendors contributing to this project</p>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map(r => (
              <ResourceRow key={r.id} resource={r}
                onEdit={onEditResource} onDelete={onDeleteResource} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ProjectsWorkspace — the embeddable component ──────────────────────────────

export function ProjectsWorkspace() {
  const toast = useToast()

  // Navigation
  const [view, setView] = useState('list')  // 'list' | 'detail'
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [selectedProject,   setSelectedProject]   = useState(null)

  // Data
  const [projects,         setProjects]         = useState([])
  const [resources,        setResources]        = useState([])
  const [summary,          setSummary]          = useState(null)
  const [loading,          setLoading]          = useState(true)
  const [detailLoading,    setDetailLoading]    = useState(false)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [error,            setError]            = useState(null)

  // Drawer
  const [drawer,        setDrawer]        = useState(null)
  const [editingRecord, setEditingRecord] = useState(null)
  const [saving,        setSaving]        = useState(false)

  // Deleting
  const [deletingResourceId, setDeletingResourceId] = useState(null)

  // Filters
  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const searchRef = useRef(null)

  // ── Load projects ──────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [pData, sData] = await Promise.all([
        api.webProjects.list(),
        api.webProjects.summary(),
      ])
      setProjects(pData.records || [])
      setSummary(sData)
    } catch (e) {
      setError(e.message)
      toast('Failed to load projects: ' + e.message, 'error')
    } finally { setLoading(false) }
  }, [toast])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Cmd/Ctrl+K → focus search
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Load project detail + resources ───────────────────────────────────
  const loadProjectDetail = useCallback(async (projectId) => {
    setDetailLoading(true); setResourcesLoading(true)
    try {
      const proj = await api.webProjects.get(projectId)
      setSelectedProject(proj)
    } catch (e) { toast('Failed to load project: ' + e.message, 'error') }
    finally { setDetailLoading(false) }
    try {
      const res = await api.webProjects.resources.list(projectId)
      setResources(res.records || [])
    } catch (e) { toast('Failed to load resources: ' + e.message, 'error') }
    finally { setResourcesLoading(false) }
  }, [toast])

  // ── Navigation ─────────────────────────────────────────────────────────
  const openProject = (record) => {
    setSelectedProjectId(record.id)
    setSelectedProject(record)
    setResources([])
    setView('detail')
    loadProjectDetail(record.id)
  }

  const goBack = () => {
    setView('list')
    setSelectedProjectId(null)
    setSelectedProject(null)
    setResources([])
  }

  // ── Filtered list ──────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const q = search.toLowerCase().trim()
    return projects.filter(p => {
      const f = p.fields || {}
      if (statusFilter   && f['Status']   !== statusFilter)   return false
      if (priorityFilter && f['Priority'] !== priorityFilter) return false
      if (q) {
        const n = (f['Project Name'] || '').toLowerCase()
        const c = (f['Client'] || '').toLowerCase()
        if (!n.includes(q) && !c.includes(q)) return false
      }
      return true
    })
  }, [projects, search, statusFilter, priorityFilter])

  // ── CRUD ───────────────────────────────────────────────────────────────
  const handleSaveProject = async (payload) => {
    setSaving(true)
    try {
      if (drawer === 'new-project') {
        const created = await api.webProjects.create(payload)
        toast('Project created!', 'success')
        setDrawer(null)
        await loadProjects()
        openProject(created)
      } else {
        const updated = await api.webProjects.update(selectedProjectId, payload)
        toast('Project updated!', 'success')
        setDrawer(null)
        setSelectedProject(updated)
        await loadProjects()
      }
    } catch (e) { toast('Save failed: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteProject = async () => {
    try {
      await api.webProjects.delete(selectedProjectId)
      toast('Project deleted', 'info')
      goBack()
      await loadProjects()
    } catch (e) { toast('Delete failed: ' + e.message, 'error') }
  }

  const handleSaveResource = async (payload) => {
    setSaving(true)
    try {
      payload.project_id = selectedProjectId
      if (drawer === 'new-resource') {
        await api.webProjects.resources.create(payload)
        toast('Resource added!', 'success')
      } else {
        await api.webProjects.resources.update(editingRecord.id, payload)
        toast('Resource updated!', 'success')
      }
      setDrawer(null); setEditingRecord(null)
      await loadProjectDetail(selectedProjectId)
      await loadProjects()
    } catch (e) { toast('Save failed: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  const handleDeleteResource = async (resourceId) => {
    setDeletingResourceId(resourceId)
    try {
      await api.webProjects.resources.delete(resourceId)
      toast('Resource removed', 'info')
      setResources(prev => prev.filter(r => r.id !== resourceId))
      await loadProjects()
      const proj = await api.webProjects.get(selectedProjectId)
      setSelectedProject(proj)
    } catch (e) { toast('Delete failed: ' + e.message, 'error') }
    finally { setDeletingResourceId(null) }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div className="animate-fade-in space-y-4">
          {/* Summary KPIs */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Total Projects"  value={summary.total_projects}     sub={`${summary.active_projects} active`} />
              <KpiCard label="Total Charge"    value={formatInr(summary.total_client_charge)} />
              <KpiCard label="Total Profit"    value={formatInr(summary.total_actual_profit)}
                accent={summary.total_actual_profit > 0 ? '#4ade80' : summary.total_actual_profit < 0 ? '#f87171' : undefined} />
              <KpiCard label="Avg. Margin"
                value={summary.overall_margin_pct ? `${summary.overall_margin_pct.toFixed(1)}%` : '—'}
                accent={summary.overall_margin_pct > 0 ? '#4ade80' : undefined} />
            </div>
          )}

          {/* Search + filters + New button */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <input ref={searchRef}
                className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                placeholder="Search projects… (⌘K)" value={search} onChange={e => setSearch(e.target.value)} />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center" style={{ color: 'var(--text-3)' }}>
                  <X size={12} />
                </button>
              )}
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
              <option value="">All priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={loadProjects}
              className="w-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
            </button>
            <button onClick={() => setDrawer('new-project')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
              <Plus size={15} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertTriangle size={15} /> {error}
              <button onClick={loadProjects} className="underline ml-1">retry</button>
            </div>
          )}

          {/* Grid */}
          {loading && !projects.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card space-y-3" aria-hidden="true">
                  <div className="skeleton h-5 rounded w-3/4" />
                  <div className="skeleton h-4 rounded w-1/2" />
                  <div className="skeleton h-2 rounded w-full" />
                  <div className="flex gap-2 pt-1">
                    <div className="skeleton h-7 rounded w-1/2" />
                    <div className="skeleton h-7 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase size={28} className="mb-3 opacity-20" style={{ color: 'var(--text-3)' }} />
              <p className="font-semibold" style={{ color: 'var(--text-2)' }}>
                {search || statusFilter || priorityFilter ? 'No projects match' : 'No projects yet'}
              </p>
              <div className="flex gap-2 mt-4">
                {(search || statusFilter || priorityFilter) && (
                  <button onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter('') }}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    Clear filters
                  </button>
                )}
                <button onClick={() => setDrawer('new-project')}
                  className="px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--accent-btn)', color: '#fff' }}>
                  + New Project
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayed.map(r => <ProjectCard key={r.id} record={r} onClick={openProject} />)}
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ── */}
      {view === 'detail' && (
        detailLoading && !selectedProject ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          </div>
        ) : selectedProject ? (
          <ProjectDetailView
            project={selectedProject}
            resources={resources}
            resourcesLoading={resourcesLoading}
            onBack={goBack}
            onRefresh={() => loadProjectDetail(selectedProjectId)}
            onEditProject={() => {
              const f = selectedProject.fields || {}
              setEditingRecord({
                id: selectedProject.id,
                initial: {
                  project_name:     f['Project Name']  || '',
                  client:           f['Client']         || '',
                  status:           f['Status']         || 'Planning',
                  priority:         f['Priority']       || 'Medium',
                  project_lead:     f['Project Lead']   || '',
                  description:      f['Description']    || '',
                  est_start:        f['Est. Start']?.split('T')[0]    || '',
                  est_end:          f['Est. End']?.split('T')[0]      || '',
                  actual_start:     f['Actual Start']?.split('T')[0]  || '',
                  actual_end:       f['Actual End']?.split('T')[0]    || '',
                  estimated_budget: f['Estimated Budget'] != null ? String(f['Estimated Budget']) : '',
                  client_charge:    f['Client Charge']  != null ? String(f['Client Charge'])  : '',
                  progress_pct:     f['Progress %']     != null ? String(f['Progress %'])     : '',
                  tags:             f['Tags']            || '',
                  context_notes:    f['Context & Notes'] || '',
                  risks_blockers:   f['Risks & Blockers'] || '',
                },
              })
              setDrawer('edit-project')
            }}
            onDeleteProject={handleDeleteProject}
            onAddResource={() => { setEditingRecord(null); setDrawer('new-resource') }}
            onEditResource={(resource) => {
              const f = resource.fields || {}
              setEditingRecord({
                id: resource.id,
                initial: {
                  resource_name:  f['Resource Name'] || '',
                  role:           f['Role']          || '',
                  type_:          f['Type']          || 'Employee',
                  rate:           f['Rate ₹']        != null ? String(f['Rate ₹'])        : '',
                  rate_unit:      f['Rate Unit']     || 'Per Month',
                  units:          f['Units']         != null ? String(f['Units'])         : '',
                  man_hours:      f['Man Hours']     != null ? String(f['Man Hours'])     : '',
                  planned_hours:  f['Planned Hours'] != null ? String(f['Planned Hours']) : '',
                  billing_rate:   f['Billing Rate (₹)']  != null ? String(f['Billing Rate (₹)'])  : '',
                  billable_units: f['Billable Units'] != null ? String(f['Billable Units']) : '',
                  from_date:      f['From Date']?.split('T')[0] || '',
                  to_date:        f['To Date']?.split('T')[0]   || '',
                  notes:          f['Notes']         || '',
                },
              })
              setDrawer('edit-resource')
            }}
            onDeleteResource={handleDeleteResource}
          />
        ) : null
      )}

      {/* ── PROJECT DRAWER ── */}
      <Drawer
        open={drawer === 'new-project' || drawer === 'edit-project'}
        onClose={() => { setDrawer(null); setEditingRecord(null) }}
        title={drawer === 'new-project' ? 'New Project' : 'Edit Project'}
        footer={
          <>
            <button onClick={() => { setDrawer(null); setEditingRecord(null) }}
              className="flex-1 py-2 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>Cancel</button>
            <button type="submit" form="project-form" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent-btn)', color: '#fff' }}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : 'Save Project'}
            </button>
          </>
        }
      >
        <ProjectForm initial={editingRecord?.initial || {}} onSubmit={handleSaveProject} loading={saving} />
      </Drawer>

      {/* ── RESOURCE DRAWER ── */}
      <Drawer
        open={drawer === 'new-resource' || drawer === 'edit-resource'}
        onClose={() => { setDrawer(null); setEditingRecord(null) }}
        title={drawer === 'new-resource' ? 'Add Resource' : 'Edit Resource'}
        footer={
          <>
            <button onClick={() => { setDrawer(null); setEditingRecord(null) }}
              className="flex-1 py-2 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>Cancel</button>
            <button type="submit" form="resource-form" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent-btn)', color: '#fff' }}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : drawer === 'new-resource' ? 'Add Resource' : 'Save Resource'}
            </button>
          </>
        }
      >
        <ResourceForm initial={editingRecord?.initial || {}} onSubmit={handleSaveResource} loading={saving} />
      </Drawer>
    </div>
  )
}

// ── WebProjects — standalone shell (for potential future standalone routing) ──

export default function WebProjects() {
  const { logout } = useAuth()
  const { dark, toggle } = useTheme()
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <header className="sticky top-0 z-30 px-4 sm:px-6 py-3 flex items-center gap-3"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-btn)' }}>
            <Briefcase size={14} color="#fff" />
          </div>
          <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>Web Projects</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggle} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={logout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </header>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <ProjectsWorkspace />
      </div>
    </div>
  )
}
