/**
 * Web Projects Tracker — for the 'all' role (All@2026)
 *
 * Exports:
 *   ProjectsWorkspace (named) — embeddable inside WebInvoices as a workspace tab
 *   WebProjects       (default) — standalone full-page app (kept for potential future use)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, Plus, Edit2, Trash2, X, Check, Loader2, RefreshCw,
  Search, Users, Briefcase, Moon, Sun, LogOut, AlertTriangle, Clock,
  TrendingUp, TrendingDown, IndianRupee, Calendar, Tag, FileText,
  ChevronRight, Receipt, CheckCircle2, XCircle, AlertOctagon, Filter,
} from 'lucide-react'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { formatInr } from '../utils/format'
import clsx from 'clsx'
import { useDialog } from '../hooks/useDialog'

// ── Constants ────────────────────────────────────────────────────────────────

// ⚠️  These must exactly match the Teable single-select options
const STATUSES       = ['Planning', 'In Progress', 'On Hold', 'Blocked', 'Completed', 'Cancelled']
const PRIORITIES     = ['Low', 'Medium', 'High', 'Critical']

/* ── Field definitions for advanced filter builder ────────────────────────── */
const PROJECT_FIELDS = [
  { key: 'Project Name',  label: 'Project Name', type: 'text' },
  { key: 'Client',        label: 'Client',        type: 'text' },
  { key: 'Status',        label: 'Status',        type: 'text' },
  { key: 'Priority',      label: 'Priority',      type: 'text' },
  { key: 'Project Lead',  label: 'Project Lead',  type: 'text' },
  { key: 'Tags',          label: 'Tags',          type: 'text' },
  { key: 'Description',   label: 'Description',   type: 'text' },
  { key: 'Client Charge', label: 'Client Charge', type: 'number' },
  { key: 'Actual Profit', label: 'Actual Profit', type: 'number' },
  { key: 'Est. Start Date',   label: 'Start Date',   type: 'date' },
  { key: 'Est. End Date',     label: 'End Date',     type: 'date' },
]
const RATE_UNITS     = ['Per Hour', 'Per Day', 'Per Month', 'Fixed (Total)']
const RESOURCE_TYPES = ['Employee', 'Freelancer', 'Contractor', 'Tool/Software', 'Cloud Infra']
// Client and lead options are fetched live from the invoices picklist API — not hardcoded here
const TAG_OPTIONS    = ['ERP', 'CRM', 'Dashboard', 'Mobile', 'API', 'Automation', 'Internal']

const STATUS_COLORS = {
  'In Progress': { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   text: '#4ade80' },
  Planning:      { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)',  text: '#60a5fa' },
  'On Hold':     { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.3)',  text: '#fb923c' },
  Blocked:       { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', text: '#f87171' },
  Completed:     { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', text: '#94a3b8' },
  Cancelled:     { bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', text: '#64748b' },
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

// ── Safe field value renderer (prevents React error #31 on {id,title} link fields) ──
function safeStr(v) {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    const parts = v.map(x => (x && typeof x === 'object' ? (x.title || x.name || x.value || '') : String(x))).filter(Boolean)
    return parts.join(', ') || null
  }
  if (typeof v === 'object') return v.title || v.name || v.value || JSON.stringify(v)
  return String(v)
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

// Project select with id→name mapping
const ProjectSelect = ({ value, onChange, projectNames, placeholder = '— Select project —' }) => (
  <select className={inputCls} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {projectNames.map(p => <option key={p.id} value={p.id}>{p.name}{p.client ? ` (${p.client})` : ''}</option>)}
  </select>
)

const TextareaInput = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea className={inputCls} style={{ ...inputStyle, resize: 'vertical' }}
    value={value ?? ''} onChange={e => onChange(e.target.value)}
    placeholder={placeholder} rows={rows} />
)

// Combo = free-text input with optional datalist suggestions
function ComboInput({ id, value, onChange, placeholder, suggestions = [], required }) {
  const listId = id ? `${id}-list` : undefined
  return (
    <div className="relative">
      <input type="text" id={id} list={listId} className={inputCls} style={inputStyle}
        value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required} autoComplete="off" />
      {suggestions.length > 0 && listId && (
        <datalist id={listId}>
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      {Icon && <Icon size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{children}</p>
      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
    </div>
  )
}

// ── Simple Drawer (non-project, e.g. resource) ────────────────────────────────

function Drawer({ open, onClose, title, children, footer }) {
  const dialog = useDialog({ label: title, onClose, active: open })
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
      <div {...dialog.panelProps} className="relative ml-auto flex flex-col h-full w-full max-w-md shadow-2xl"
        style={{ background: 'var(--card-bg)', borderLeft: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>{title}</h2>
          <button aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 flex gap-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Project Drawer (polished, portal-based) ───────────────────────────────────

function ProjectDrawer({ open, onClose, initial = {}, onSubmit, onDelete, saving, isEdit }) {
  const dialog = useDialog({ label: 'Project', onClose, active: open })
  const [d, setD] = useState({
    project_name: '', client: '', status: 'Planning', priority: 'Medium',
    project_lead: '', description: '', est_start: '', est_end: '',
    actual_start: '', actual_end: '', estimated_budget: '', client_charge: '',
    progress_pct: 0, tags: '', context_notes: '', risks_blockers: '',
  })
  const [confirmDel,       setConfirmDel]       = useState(false)
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [leadSuggestions,   setLeadSuggestions]   = useState([])
  const set = k => v => setD(p => ({ ...p, [k]: v }))

  // Reset form when drawer opens; fetch live suggestions from invoice picklists
  useEffect(() => {
    if (open) {
      setD({
        project_name: '', client: '', status: 'Planning', priority: 'Medium',
        project_lead: '', description: '', est_start: '', est_end: '',
        actual_start: '', actual_end: '', estimated_budget: '', client_charge: '',
        progress_pct: 0, tags: '', context_notes: '', risks_blockers: '',
        ...initial,
      })
      setConfirmDel(false)
      setClientSuggestions([])
      setLeadSuggestions([])
      // Fetch distinct client names from actual invoice records (most accurate)
      api.webInvoices.clientNames().then(names => {
        if (Array.isArray(names) && names.length) setClientSuggestions(names)
      }).catch(() => {})
      // Fetch lead options from invoices picklist schema
      api.webInvoices.picklists.get().then(pl => {
        if (pl?.['Raised By']?.options?.length) setLeadSuggestions(pl['Raised By'].options)
      }).catch(() => {})
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  // Live calculations
  const budget = Number(d.estimated_budget) || 0
  const charge = Number(d.client_charge) || 0
  const profit = charge - budget
  const marginPct = charge > 0 ? (profit / charge * 100) : 0
  const pct = Math.min(100, Math.max(0, Number(d.progress_pct) || 0))
  const pctColor = pct >= 100 ? '#4ade80' : pct >= 60 ? '#60a5fa' : pct >= 30 ? '#fb923c' : '#94a3b8'

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
    p.progress_pct = pct
    if (d.tags)                     p.tags             = d.tags
    if (d.context_notes)            p.context_notes    = d.context_notes
    if (d.risks_blockers)           p.risks_blockers   = d.risks_blockers
    onSubmit(p)
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <div {...dialog.panelProps} className="relative ml-auto flex flex-col h-full shadow-2xl"
        style={{ width: 'min(calc(100vw - 1rem), 480px)', background: 'var(--card-bg)', borderLeft: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.25)' }}>
              <Briefcase size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>
                {isEdit ? 'Edit Project' : 'New Project'}
              </p>
              {d.project_name && (
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{d.project_name}</p>
              )}
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form id="project-form" onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-5 space-y-6"
          style={{ background: 'var(--card-bg)' }}>

          {/* ── Identity ── */}
          <div>
            <SectionLabel icon={Briefcase}>Project Identity</SectionLabel>
            <div className="space-y-3">
              <FormRow label="Project Name" required>
                <TextInput value={d.project_name} onChange={set('project_name')}
                  placeholder="e.g. Web Portal Redesign" required />
              </FormRow>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Client">
                  <ComboInput id="proj-client" value={d.client} onChange={set('client')}
                    placeholder="Select or type" suggestions={clientSuggestions} />
                </FormRow>
                <FormRow label="Project Lead">
                  <ComboInput id="proj-lead" value={d.project_lead} onChange={set('project_lead')}
                    placeholder="e.g. Mayukh" suggestions={leadSuggestions} />
                </FormRow>
              </div>
              <FormRow label="Tags" hint="Pick any that apply">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {TAG_OPTIONS.map(tag => {
                    const tagStr = Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || '')
                    const cur = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : []
                    const selected = cur.includes(tag)
                    return (
                      <button key={tag} type="button"
                        onClick={() => {
                          const next = selected ? cur.filter(t => t !== tag) : [...cur, tag]
                          set('tags')(next.join(', '))
                        }}
                        className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                        style={{
                          background: selected ? 'var(--accent-dim)' : 'var(--bg-input)',
                          color: selected ? 'var(--accent)' : 'var(--text-3)',
                          border: `1px solid ${selected ? 'var(--accent-soft)' : 'var(--border)'}`,
                        }}>
                        {tag}
                      </button>
                    )
                  })}
                </div>
                {d.tags && (
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                    Selected: {d.tags}
                  </p>
                )}
              </FormRow>
            </div>
          </div>

          {/* ── Status & Progress ── */}
          <div>
            <SectionLabel icon={Check}>Status & Progress</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Status">
                  <SelectInput value={d.status} onChange={set('status')} options={STATUSES} />
                </FormRow>
                <FormRow label="Priority">
                  <SelectInput value={d.priority} onChange={set('priority')} options={PRIORITIES} />
                </FormRow>
              </div>
              <FormRow label={`Progress — ${pct}%`}>
                <div className="space-y-2">
                  <input type="range" min={0} max={100} step={1} value={pct}
                    onChange={e => set('progress_pct')(Number(e.target.value))}
                    className="w-full accent-blue-500"
                    style={{ accentColor: pctColor }} />
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: pctColor }} />
                  </div>
                </div>
              </FormRow>
            </div>
          </div>

          {/* ── Timeline ── */}
          <div>
            <SectionLabel icon={Calendar}>Timeline</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Est. Start">
                  <TextInput type="date" value={d.est_start} onChange={set('est_start')} />
                </FormRow>
                <FormRow label="Est. End">
                  <TextInput type="date" value={d.est_end} onChange={set('est_end')} />
                </FormRow>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Actual Start">
                  <TextInput type="date" value={d.actual_start} onChange={set('actual_start')} />
                </FormRow>
                <FormRow label="Actual End">
                  <TextInput type="date" value={d.actual_end} onChange={set('actual_end')} />
                </FormRow>
              </div>
            </div>
          </div>

          {/* ── Financials ── */}
          <div>
            <SectionLabel icon={IndianRupee}>Financials</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Est. Budget (₹)">
                  <NumberInput value={d.estimated_budget} onChange={set('estimated_budget')} placeholder="0" min={0} />
                </FormRow>
                <FormRow label="Client Charge (₹)">
                  <NumberInput value={d.client_charge} onChange={set('client_charge')} placeholder="0" min={0} />
                </FormRow>
              </div>
              {(charge > 0 || budget > 0) && (
                <div className="px-3 py-2.5 rounded-xl text-sm flex items-center gap-2"
                  style={{
                    background: profit >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
                    border: `1px solid ${profit >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.2)'}`,
                    color: profit >= 0 ? '#4ade80' : '#f87171',
                  }}>
                  {profit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  <span>
                    Projected profit: <strong>{formatInr(profit)}</strong>
                    {charge > 0 && <span className="ml-2 opacity-80">· {marginPct.toFixed(1)}% margin</span>}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Context ── */}
          <div>
            <SectionLabel icon={FileText}>Context</SectionLabel>
            <div className="space-y-3">
              <FormRow label="Description">
                <TextareaInput value={d.description} onChange={set('description')}
                  placeholder="Brief project overview and goals…" rows={3} />
              </FormRow>
              <FormRow label="Context & Notes">
                <TextareaInput value={d.context_notes} onChange={set('context_notes')}
                  placeholder="Background, key decisions, reference links…" rows={3} />
              </FormRow>
              <FormRow label="Risks & Blockers">
                <TextareaInput value={d.risks_blockers} onChange={set('risks_blockers')}
                  placeholder="Known risks, dependencies, or blockers…" rows={2} />
              </FormRow>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center gap-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          {isEdit && onDelete ? (
            <button type="button"
              onClick={() => confirmDel ? onDelete() : setConfirmDel(true)}
              onBlur={() => setConfirmDel(false)}
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{
                background: confirmDel ? 'rgba(239,68,68,0.12)' : 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171',
              }}>
              <Trash2 size={13} className="inline mr-1" />
              {confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              Cancel
            </button>
            <button type="submit" form="project-form" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Resource Drawer (polished portal, same style as ProjectDrawer) ─────────────

function ResourceDrawer({ open, onClose, initial = {}, onSubmit, onDelete, saving, isEdit, projectNames = [] }) {
  const dialog = useDialog({ label: 'Resource', onClose, active: open })
  const EMPTY = {
    resource_name: '', role: '', type_: 'Employee',
    rate: '', rate_unit: 'Per Month', units: '',
    man_hours: '', planned_hours: '',
    billing_rate: '', billable_units: '',
    from_date: '', to_date: '', notes: '',
    project_id: '',
  }
  const [d, setD] = useState(EMPTY)
  const [confirmDel, setConfirmDel] = useState(false)
  const set = k => v => setD(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (open) {
      setD({ ...EMPTY, ...initial })
      setConfirmDel(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  // Live calculations
  const totalCost    = (Number(d.rate) || 0) * (Number(d.units) || 0)
  const totalRevenue = (Number(d.billing_rate) || 0) * (Number(d.billable_units) || 0)
  const grossMargin  = totalRevenue - totalCost
  const costPerHour  = d.man_hours ? totalCost / Number(d.man_hours) : null
  const hoursOver    = d.man_hours !== '' && d.planned_hours !== ''
    ? Number(d.man_hours) - Number(d.planned_hours) : null

  const handleSubmit = (e) => {
    e.preventDefault()
    const p = {}
    if (d.resource_name)         p.resource_name   = d.resource_name
    if (d.role)                  p.role             = d.role
    if (d.type_)                 p.type_            = d.type_
    if (d.rate !== '')           p.rate             = Number(d.rate)
    if (d.rate_unit)             p.rate_unit        = d.rate_unit
    if (d.units !== '')          p.units            = Number(d.units)
    if (d.man_hours !== '')      p.man_hours        = Number(d.man_hours)
    if (d.planned_hours !== '')  p.planned_hours    = Number(d.planned_hours)
    if (d.billing_rate !== '')   p.billing_rate     = Number(d.billing_rate)
    if (d.billable_units !== '') p.billable_units   = Number(d.billable_units)
    if (d.from_date)             p.from_date        = d.from_date
    if (d.to_date)               p.to_date          = d.to_date
    if (d.notes)                 p.notes            = d.notes
    if (d.project_id)            p.project_id       = d.project_id
    onSubmit(p)
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} />
      <div {...dialog.panelProps} className="relative ml-auto flex flex-col h-full shadow-2xl"
        style={{ width: 'min(calc(100vw - 1rem), 480px)', background: 'var(--card-bg)', borderLeft: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.25)' }}>
              <Users size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>
                {isEdit ? 'Edit Resource' : 'Add Resource'}
              </p>
              {d.resource_name && (
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{d.resource_name}</p>
              )}
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form id="resource-form" onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-5 space-y-6"
          style={{ background: 'var(--card-bg)' }}>

          {/* ── Identity ── */}
          <div>
            <SectionLabel icon={Users}>Resource Identity</SectionLabel>
            <div className="space-y-3">
              <FormRow label="Resource Name" required>
                <TextInput value={d.resource_name} onChange={set('resource_name')}
                  placeholder="e.g. Rahul Sharma" required />
              </FormRow>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Role">
                  <TextInput value={d.role} onChange={set('role')} placeholder="e.g. Frontend Dev" />
                </FormRow>
                <FormRow label="Type">
                  <SelectInput value={d.type_} onChange={set('type_')} options={RESOURCE_TYPES} />
                </FormRow>
              </div>
              {projectNames.length > 0 && (
                <FormRow label="Project">
                  <ProjectSelect value={d.project_id} onChange={set('project_id')} projectNames={projectNames} />
                </FormRow>
              )}
            </div>
          </div>

          {/* ── Cost ── */}
          <div>
            <SectionLabel icon={IndianRupee}>Cost <span className="normal-case font-normal">(what you pay)</span></SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Rate (₹)">
                  <NumberInput value={d.rate} onChange={set('rate')} placeholder="0" min={0} />
                </FormRow>
                <FormRow label="Rate Unit">
                  <SelectInput value={d.rate_unit} onChange={set('rate_unit')} options={RATE_UNITS} />
                </FormRow>
              </div>
              <FormRow label="Units" hint="Months / hours / days — depends on Rate Unit">
                <NumberInput value={d.units} onChange={set('units')} placeholder="e.g. 2" min={0} step={0.5} />
              </FormRow>
              {totalCost > 0 && (
                <div className="px-3 py-2.5 rounded-xl text-sm flex items-center gap-2"
                  style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', color: '#fb923c' }}>
                  <IndianRupee size={13} />
                  <span>Total cost: <strong>{formatInr(totalCost)}</strong>
                    {costPerHour && <span className="ml-2 opacity-70">· ₹{Math.round(costPerHour)}/hr</span>}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Man Hours ── */}
          <div>
            <SectionLabel icon={Clock}>Man Hours</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Actual Hours" hint="Total worked">
                  <NumberInput value={d.man_hours} onChange={set('man_hours')} placeholder="e.g. 160" min={0} step={0.5} />
                </FormRow>
                <FormRow label="Planned Hours" hint="Original estimate">
                  <NumberInput value={d.planned_hours} onChange={set('planned_hours')} placeholder="e.g. 140" min={0} step={0.5} />
                </FormRow>
              </div>
              {hoursOver !== null && (
                <div className="px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{
                  background: hoursOver > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)',
                  border: `1px solid ${hoursOver > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  color: hoursOver > 0 ? '#f87171' : '#4ade80',
                }}>
                  {hoursOver > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  <span>
                    {hoursOver > 0 ? `+${hoursOver}h over estimate` : hoursOver < 0 ? `${hoursOver}h under estimate` : 'On track'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Revenue ── */}
          <div>
            <SectionLabel icon={TrendingUp}>Revenue <span className="normal-case font-normal">(what you charge)</span></SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Billing Rate (₹)" hint="Rate charged to client">
                  <NumberInput value={d.billing_rate} onChange={set('billing_rate')} placeholder="0" min={0} />
                </FormRow>
                <FormRow label="Billable Units" hint="Units billed">
                  <NumberInput value={d.billable_units} onChange={set('billable_units')} placeholder="0" min={0} step={0.5} />
                </FormRow>
              </div>
              {(totalRevenue > 0 || totalCost > 0) && (totalRevenue > 0) && (
                <div className="px-3 py-2.5 rounded-xl text-sm flex items-center gap-2"
                  style={{
                    background: grossMargin >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
                    border: `1px solid ${grossMargin >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.2)'}`,
                    color: grossMargin >= 0 ? '#4ade80' : '#f87171',
                  }}>
                  {grossMargin >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  <span>Revenue: <strong>{formatInr(totalRevenue)}</strong>
                    {totalCost > 0 && <span className="ml-2 opacity-80">
                      · Margin: <strong>{formatInr(grossMargin)} ({totalRevenue > 0 ? (grossMargin / totalRevenue * 100).toFixed(1) : 0}%)</strong>
                    </span>}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Dates & Notes ── */}
          <div>
            <SectionLabel icon={Calendar}>Dates &amp; Notes</SectionLabel>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="From Date">
                  <TextInput type="date" value={d.from_date} onChange={set('from_date')} />
                </FormRow>
                <FormRow label="To Date">
                  <TextInput type="date" value={d.to_date} onChange={set('to_date')} />
                </FormRow>
              </div>
              <FormRow label="Notes">
                <TextareaInput value={d.notes} onChange={set('notes')} placeholder="Any relevant notes…" rows={2} />
              </FormRow>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center gap-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          {isEdit && onDelete ? (
            <button type="button"
              onClick={() => confirmDel ? onDelete() : setConfirmDel(true)}
              onBlur={() => setConfirmDel(false)}
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{
                background: confirmDel ? 'rgba(239,68,68,0.12)' : 'transparent',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171',
              }}>
              <Trash2 size={13} className="inline mr-1" />
              {confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              Cancel
            </button>
            <button type="submit" form="resource-form" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Resource'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
              {f['Rate (₹)'] ? `${formatInr(f['Rate (₹)'])} × ${f['Units'] || 0} ${f['Rate Unit'] || ''}` : 'No rate'}
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
  const progressVal = f['Progress (%)'] ?? f['Progress %'] ?? f['Progress'] ?? null

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
      {progressVal != null && <div className="mb-3"><ProgressBar value={progressVal} /></div>}
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
      {safeStr(f['Resource Names']) && (
        <p className="text-xs mt-2 truncate" style={{ color: 'var(--text-3)' }}>
          <Users size={10} className="inline mr-1" />
          {safeStr(f['Resource Names'])}
        </p>
      )}
    </button>
  )
}

// ── Project Detail View ───────────────────────────────────────────────────────

function ProjectDetailView({
  project, resources, resourcesLoading,
  linkedInvoices, invoicesLoading,
  onBack, onEditProject, onDeleteProject,
  onAddResource, onEditResource, onDeleteResource, onRefresh, onManageResources,
}) {
  const f            = project.fields || {}
  const profit       = Number(f['Actual Profit'] || 0)
  const margin       = Number(f['Profit Margin %'] || 0)
  const charge       = Number(f['Client Charge'] || 0)
  const budget       = Number(f['Estimated Budget'] || 0)
  const inputCost    = Number(f['Total Input Cost'] || 0)
  const budgetVar    = Number(f['Budget Variance'] || 0)
  const budgetVarPct = Number(f['Budget Variance %'] || 0)
  const schedVar     = Number(f['Schedule Variance (Days)'] || 0)
  // Use rollup fields from the project record (more reliable than summing local resources array)
  const totalManHours   = Number(f['Total Man Hours']    || 0)
  const totalPlannedHrs = Number(f['Total Planned Hours']|| 0)
  const hoursVariance   = Number(f['Hours Variance']     || 0)
  const totalRevenue    = Number(f['Total Revenue Generated'] || 0)
  const resourceCount   = Number(f['Resource Count']     || 0)
  const effCostPerHr    = Number(f['Effective Cost Per Hour']         || 0)
  const effBillPerHr    = Number(f['Effective Billing Rate Per Hour'] || 0)
  // Progress — try multiple field name variants since Teable may use different casing
  const progressVal = f['Progress (%)'] ?? f['Progress %'] ?? f['Progress'] ?? null
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack}
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
          <button aria-label="Refresh" onClick={onRefresh}
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

      {/* KPI row — Financial */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Client Charge" value={charge ? formatInr(charge) : '—'} />
        <KpiCard label="Total Cost"    value={inputCost ? formatInr(inputCost) : '—'} />
        <KpiCard label="Actual Profit" value={profit ? formatInr(profit) : '—'}
          accent={profit > 0 ? '#4ade80' : profit < 0 ? '#f87171' : undefined} />
        <KpiCard label="Margin %"
          value={margin ? `${margin.toFixed(1)}%` : '—'}
          accent={margin > 0 ? '#4ade80' : margin < 0 ? '#f87171' : undefined} />
      </div>

      {/* Progress bar */}
      {progressVal != null && (
        <div className="card"><ProgressBar value={progressVal} /></div>
      )}

      {/* KPI row — Hours & Revenue tracking */}
      {(totalManHours > 0 || totalRevenue > 0 || totalPlannedHrs > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {totalManHours > 0 && (
            <KpiCard label="Man Hours (Actual)" value={`${totalManHours}h`}
              sub={effCostPerHr > 0 ? `₹${Math.round(effCostPerHr)}/hr cost` : undefined} />
          )}
          {totalPlannedHrs > 0 && (
            <KpiCard label="Planned Hours" value={`${totalPlannedHrs}h`}
              sub={totalManHours > 0 ? `${hoursVariance >= 0 ? '+' : ''}${hoursVariance}h variance` : undefined}
              accent={hoursVariance > 0 ? '#f87171' : hoursVariance < 0 ? '#4ade80' : undefined} />
          )}
          {totalRevenue > 0 && (
            <KpiCard label="Revenue Generated" value={formatInr(totalRevenue)}
              accent="#4ade80"
              sub={effBillPerHr > 0 ? `₹${Math.round(effBillPerHr)}/hr billed` : undefined} />
          )}
          {f['Schedule Variance (Days)'] != null && schedVar !== 0 && (
            <KpiCard label="Schedule Var."
              value={`${schedVar > 0 ? '+' : ''}${schedVar}d`}
              sub={schedVar > 0 ? 'Behind schedule' : 'Ahead of schedule'}
              accent={schedVar > 0 ? '#f87171' : '#4ade80'} />
          )}
        </div>
      )}

      {/* Detail fields */}
      <div className="card">
        <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>Project Details</h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            ['Project Lead',  safeStr(f['Project Lead'])],
            ['Est. Start',    f['Est. Start Date']   ? new Date(f['Est. Start Date']).toLocaleDateString('en-IN') : null],
            ['Est. End',      f['Est. End Date']     ? new Date(f['Est. End Date']).toLocaleDateString('en-IN') : null],
            ['Actual Start',  f['Actual Start Date'] ? new Date(f['Actual Start Date']).toLocaleDateString('en-IN') : null],
            ['Actual End',    f['Actual End Date']   ? new Date(f['Actual End Date']).toLocaleDateString('en-IN') : null],
            ['Est. Budget',   budget ? formatInr(budget) : null],
            ['Budget Var.',   budgetVar ? `${budgetVar > 0 ? '+' : ''}${formatInr(budgetVar)}` : null],
            ['Tags',          safeStr(f['Tags'])],
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
          <div className="flex gap-2">
            <button onClick={onManageResources}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              <Users size={13} /> Assign
            </button>
            <button onClick={onAddResource}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--accent-btn)', color: '#fff' }}>
              <Plus size={13} /> New
            </button>
          </div>
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

      {/* ── Matching Invoices ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              <Receipt size={11} className="inline mr-1.5" />Matching Invoices
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              Invoices matching this project name
            </p>
          </div>
          {linkedInvoices.length > 0 && (() => {
            const totalRaised  = linkedInvoices.reduce((s, r) => s + Number(r.fields?.['Amount Raised'] || 0), 0)
            const totalRcvd    = linkedInvoices.reduce((s, r) => s + Number(r.fields?.['Amount Received'] || 0), 0)
            const outstanding  = totalRaised - totalRcvd
            return (
              <div className="flex gap-3 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Raised</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{formatInr(totalRaised)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Collected</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: '#4ade80' }}>{formatInr(totalRcvd)}</p>
                </div>
                {outstanding > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Open</p>
                    <p className="text-sm font-bold tabular-nums" style={{ color: '#fb923c' }}>{formatInr(outstanding)}</p>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
        {invoicesLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          </div>
        ) : linkedInvoices.length === 0 ? (
          <div className="text-center py-6">
            <Receipt size={24} className="mx-auto mb-2 opacity-20" style={{ color: 'var(--text-3)' }} />
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No invoices linked yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Add invoices with project name <strong>"{f['Project Name']}"</strong> to see them here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {linkedInvoices.map(inv => {
              const fi = inv.fields || {}
              const raised = Number(fi['Amount Raised'] || 0)
              const rcvd   = Number(fi['Amount Received'] || 0)
              const open   = raised - rcvd
              const status = fi['Payment Status'] || fi['Status'] || '—'
              const statusColor = status === 'Paid' ? '#4ade80' : status === 'Pending' ? '#fb923c' : '#94a3b8'
              const StatusIcon  = status === 'Paid' ? CheckCircle2 : status === 'Cancelled' ? XCircle : AlertOctagon
              return (
                <div key={inv.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                  <StatusIcon size={14} style={{ color: statusColor, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {fi['Invoice Number'] || fi['Invoice No'] || inv.id.slice(0, 8)}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                      {fi['Category'] || '—'}
                      {fi['Raised Date'] && ` · ${new Date(fi['Raised Date']).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{formatInr(raised)}</p>
                    {open > 0 && (
                      <p className="text-[10px] tabular-nums" style={{ color: '#fb923c' }}>₹{(open/1000).toFixed(0)}k open</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Resource Assignment Panel ─────────────────────────────────────────────────
// Shows all system resources; user can toggle which ones are assigned to a project

function ResourceAssignPanel({ open, onClose, projectId, assignedIds = [], allResources = [], onAssign, onUnassign }) {
  const dialog = useDialog({ label: 'Assign resources', onClose, active: open })
  const [toggling, setToggling] = useState({}) // resourceId → boolean (loading)
  const [localAssigned, setLocalAssigned] = useState(new Set(assignedIds))

  useEffect(() => {
    if (open) setLocalAssigned(new Set(assignedIds))
  }, [open, assignedIds])

  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const toggle = async (resource) => {
    const rid = resource.id
    const isAssigned = localAssigned.has(rid)
    setToggling(t => ({ ...t, [rid]: true }))
    // Optimistic update
    setLocalAssigned(prev => {
      const next = new Set(prev)
      if (isAssigned) next.delete(rid)
      else next.add(rid)
      return next
    })
    try {
      if (isAssigned) await onUnassign(rid)
      else await onAssign(rid)
    } catch {
      // Revert optimistic update on error
      setLocalAssigned(prev => {
        const next = new Set(prev)
        if (isAssigned) next.add(rid)
        else next.delete(rid)
        return next
      })
    } finally {
      setToggling(t => ({ ...t, [rid]: false }))
    }
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div {...dialog.panelProps} className="relative flex flex-col rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh]"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--sidebar-bg)', borderRadius: '1rem 1rem 0 0' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-btn)' }}>
              <Users size={14} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>Assign Resources</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {localAssigned.size} assigned · toggle to add or remove
              </p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allResources.length === 0 ? (
            <div className="text-center py-8">
              <Users size={24} className="mx-auto mb-2 opacity-20" style={{ color: 'var(--text-3)' }} />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No resources in the system yet</p>
            </div>
          ) : (
            allResources.map(r => {
              const f = r.fields || {}
              const assigned = localAssigned.has(r.id)
              const loading  = toggling[r.id]
              return (
                <button key={r.id} onClick={() => toggle(r)} disabled={loading}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: assigned ? 'var(--accent-dim)' : 'var(--bg-input)',
                    border: `1px solid ${assigned ? 'var(--accent-soft)' : 'var(--border)'}`,
                    opacity: loading ? 0.6 : 1,
                  }}>
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                    style={{ background: assigned ? 'rgba(79,70,229,0.2)' : 'rgba(59,130,246,0.12)', color: assigned ? 'var(--accent)' : '#60a5fa' }}>
                    {(f['Resource Name'] || '?')[0].toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{f['Resource Name'] || '—'}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                      {[f['Role'], f['Type']].filter(Boolean).join(' · ') || 'No role'}
                    </p>
                  </div>
                  {/* Checkbox */}
                  <div className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: assigned ? 'var(--accent-btn)' : 'transparent', border: `2px solid ${assigned ? 'var(--accent-btn)' : 'var(--border)'}` }}>
                    {loading ? <Loader2 size={11} className="animate-spin text-white" /> : assigned ? <Check size={11} className="text-white" /> : null}
                  </div>
                </button>
              )
            })
          )}
        </div>
        {/* Footer */}
        <div className="px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--sidebar-bg)', borderRadius: '0 0 1rem 1rem' }}>
          <button onClick={onClose}
            className="w-full py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff' }}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
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
  const [projectNames,     setProjectNames]     = useState([])   // [{id, name, client}]
  const [resources,        setResources]        = useState([])
  const [linkedInvoices,   setLinkedInvoices]   = useState([])
  const [invoicesLoading,  setInvoicesLoading]  = useState(false)
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

  // Resource assignment panel
  const [assignPanelOpen,  setAssignPanelOpen]  = useState(false)
  const [allSystemResources, setAllSystemResources] = useState([])

  // Filters
  const [search,           setSearch]           = useState('')
  const [statusFilter,     setStatusFilter]     = useState('')
  const [priorityFilter,   setPriorityFilter]   = useState('')
  const [filterConditions, setFilterConditions] = useState([])
  const searchRef = useRef(null)

  // ── Load projects ──────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [pData, sData, names] = await Promise.all([
        api.webProjects.list(),
        api.webProjects.summary(),
        api.webProjects.names().catch(() => []),
      ])
      setProjects(pData.records || [])
      setSummary(sData)
      setProjectNames(Array.isArray(names) ? names : [])
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

  // ── Load project detail + resources + linked invoices ────────────────
  const loadProjectDetail = useCallback(async (projectId, projectName) => {
    setDetailLoading(true); setResourcesLoading(true); setInvoicesLoading(true)
    // Project record
    try {
      const proj = await api.webProjects.get(projectId)
      setSelectedProject(proj)
    } catch (e) { toast('Failed to load project: ' + e.message, 'error') }
    finally { setDetailLoading(false) }
    // Resources
    try {
      const res = await api.webProjects.resources.list(projectId)
      setResources(res.records || [])
    } catch (e) { toast('Failed to load resources: ' + e.message, 'error') }
    finally { setResourcesLoading(false) }
    // Load all system resources for the assignment panel
    try {
      const allRes = await api.webProjects.resources.listAll()
      setAllSystemResources(allRes.records || [])
    } catch { /* non-critical */ }
    // Linked invoices (by project name match)
    if (projectName) {
      try {
        const inv = await api.webInvoices.list({ project: projectName, limit: 100 })
        setLinkedInvoices(inv.records || [])
      } catch { setLinkedInvoices([]) }
      finally { setInvoicesLoading(false) }
    } else { setInvoicesLoading(false) }
  }, [toast])

  // ── Navigation ─────────────────────────────────────────────────────────
  const openProject = (record) => {
    const name = record.fields?.['Project Name'] || ''
    setSelectedProjectId(record.id)
    setSelectedProject(record)
    setResources([])
    setLinkedInvoices([])
    setView('detail')
    loadProjectDetail(record.id, name)
  }

  const goBack = () => {
    setView('list')
    setSelectedProjectId(null)
    setSelectedProject(null)
    setResources([])
    setLinkedInvoices([])
  }

  // ── Filtered list ──────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const q = search.toLowerCase().trim()
    const base = projects.filter(p => {
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
    return applyConditions(base, filterConditions, p => p.fields ?? {})
  }, [projects, search, statusFilter, priorityFilter, filterConditions])

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

  const handleAssignResource = async (resourceId) => {
    await api.webProjects.resources.assign(resourceId, selectedProjectId)
    const res = await api.webProjects.resources.list(selectedProjectId)
    setResources(res.records || [])
    const proj = await api.webProjects.get(selectedProjectId)
    setSelectedProject(proj)
  }

  const handleUnassignResource = async (resourceId) => {
    await api.webProjects.resources.unassign(resourceId, selectedProjectId)
    const res = await api.webProjects.resources.list(selectedProjectId)
    setResources(res.records || [])
    const proj = await api.webProjects.get(selectedProjectId)
    setSelectedProject(proj)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div className="animate-fade-in space-y-4">
          {/* Summary KPIs */}
          {summary && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Projects"  value={summary.total_projects}     sub={`${summary.active_projects} active`} />
                <KpiCard label="Total Charge"    value={formatInr(summary.total_client_charge)} />
                <KpiCard label="Total Profit"    value={formatInr(summary.total_actual_profit)}
                  accent={summary.total_actual_profit > 0 ? '#4ade80' : summary.total_actual_profit < 0 ? '#f87171' : undefined} />
                <KpiCard label="Avg. Margin"
                  value={summary.overall_margin_pct ? `${summary.overall_margin_pct.toFixed(1)}%` : '—'}
                  accent={summary.overall_margin_pct > 0 ? '#4ade80' : undefined} />
              </div>
              {(summary.total_man_hours > 0 || summary.total_revenue_generated > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {summary.total_man_hours > 0 && (
                    <KpiCard label="Total Man Hours" value={`${summary.total_man_hours}h`}
                      sub={summary.total_input_cost > 0 ? `₹${Math.round(summary.total_input_cost / summary.total_man_hours)}/hr cost` : undefined} />
                  )}
                  {summary.total_revenue_generated > 0 && (
                    <KpiCard label="Total Revenue" value={formatInr(summary.total_revenue_generated)}
                      accent="#4ade80"
                      sub={summary.total_man_hours > 0 ? `₹${Math.round(summary.total_revenue_generated / summary.total_man_hours)}/hr billed` : undefined} />
                  )}
                  {summary.total_man_hours > 0 && summary.total_planned_hours > 0 && (
                    <KpiCard label="Hours Variance"
                      value={`${summary.hours_variance >= 0 ? '+' : ''}${summary.hours_variance}h`}
                      accent={summary.hours_variance >= 0 ? '#4ade80' : '#f87171'}
                      sub={`${summary.total_planned_hours}h planned`} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search + filters + New button */}
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[120px] sm:min-w-[160px]">
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
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUSES}
                placeholder="All statuses"
                icon={Filter}
                width={145}
              />
              <FilterSelect
                value={priorityFilter}
                onChange={setPriorityFilter}
                options={PRIORITIES}
                placeholder="All priorities"
                icon={Tag}
                width={145}
              />
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
            {/* Advanced filter builder */}
            <FilterBuilder
              fields={PROJECT_FIELDS}
              records={projects}
              getFieldValue={p => p.fields ?? {}}
              conditions={filterConditions}
              onChange={setFilterConditions}
              label="Add filter"
            />
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
                {(search || statusFilter || priorityFilter || filterConditions.length > 0) && (
                  <button onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setFilterConditions([]) }}
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
          <>
          <ProjectDetailView
            project={selectedProject}
            resources={resources}
            resourcesLoading={resourcesLoading}
            linkedInvoices={linkedInvoices}
            invoicesLoading={invoicesLoading}
            onBack={goBack}
            onRefresh={() => loadProjectDetail(selectedProjectId, selectedProject?.fields?.['Project Name'])}
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
                  est_start:        f['Est. Start Date']?.split('T')[0]    || '',
                  est_end:          f['Est. End Date']?.split('T')[0]      || '',
                  actual_start:     f['Actual Start Date']?.split('T')[0]  || '',
                  actual_end:       f['Actual End Date']?.split('T')[0]    || '',
                  estimated_budget: f['Estimated Budget'] != null ? String(f['Estimated Budget']) : '',
                  client_charge:    f['Client Charge']  != null ? String(f['Client Charge'])  : '',
                  progress_pct:     f['Progress (%)']     != null ? String(f['Progress (%)'])     : '',
                  tags:             Array.isArray(f['Tags']) ? f['Tags'].join(', ') : (f['Tags'] || ''),
                  context_notes:    f['Context & Notes'] || '',
                  risks_blockers:   f['Risks & Blockers'] || '',
                },
              })
              setDrawer('edit-project')
            }}
            onDeleteProject={handleDeleteProject}
            onAddResource={() => { setEditingRecord({ initial: { project_id: selectedProjectId } }); setDrawer('new-resource') }}
            onEditResource={(resource) => {
              const f = resource.fields || {}
              setEditingRecord({
                id: resource.id,
                initial: {
                  resource_name:  f['Resource Name'] || '',
                  role:           f['Role']          || '',
                  type_:          f['Type']          || 'Employee',
                  rate:           f['Rate (₹)']        != null ? String(f['Rate (₹)'])        : '',
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
            onManageResources={() => setAssignPanelOpen(true)}
          />
          <ResourceAssignPanel
            open={assignPanelOpen}
            onClose={() => setAssignPanelOpen(false)}
            projectId={selectedProjectId}
            assignedIds={resources.map(r => r.id)}
            allResources={allSystemResources}
            onAssign={handleAssignResource}
            onUnassign={handleUnassignResource}
          />
          </>
        ) : null
      )}

      {/* ── PROJECT DRAWER (polished portal) ── */}
      <ProjectDrawer
        open={drawer === 'new-project' || drawer === 'edit-project'}
        onClose={() => { setDrawer(null); setEditingRecord(null) }}
        initial={editingRecord?.initial || {}}
        onSubmit={handleSaveProject}
        onDelete={drawer === 'edit-project' ? handleDeleteProject : undefined}
        saving={saving}
        isEdit={drawer === 'edit-project'}
      />

      {/* ── RESOURCE DRAWER ── */}
      <ResourceDrawer
        open={drawer === 'new-resource' || drawer === 'edit-resource'}
        onClose={() => { setDrawer(null); setEditingRecord(null) }}
        initial={editingRecord?.initial || {}}
        onSubmit={handleSaveResource}
        onDelete={drawer === 'edit-resource' ? () => handleDeleteResource(editingRecord?.id) : undefined}
        saving={saving}
        isEdit={drawer === 'edit-resource'}
        projectNames={projectNames}
      />
    </div>
  )
}

// ── AllResourcesView — global resources table (named export) ─────────────────

export function AllResourcesView() {
  const toast = useToast()
  const [resources,    setResources]    = useState([])
  const [projectNames, setProjectNames] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [search,       setSearch]       = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')
  const [drawer,       setDrawer]       = useState(null)  // null | 'new' | 'edit'
  const [editingRec,   setEditingRec]   = useState(null)
  const [saving,       setSaving]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [data, names] = await Promise.all([
        api.webProjects.resources.listAll(),
        api.webProjects.names().catch(() => []),
      ])
      setResources(data.records || [])
      setProjectNames(Array.isArray(names) ? names : [])
    } catch (e) {
      setError(e.message)
      toast('Failed to load resources: ' + e.message, 'error')
    } finally { setLoading(false) }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleSave = async (payload) => {
    setSaving(true)
    try {
      if (drawer === 'new') {
        await api.webProjects.resources.create(payload)
        toast('Resource added!', 'success')
      } else {
        await api.webProjects.resources.update(editingRec.id, payload)
        toast('Resource updated!', 'success')
      }
      setDrawer(null); setEditingRec(null)
      await load()
    } catch (e) { toast('Save failed: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!editingRec) return
    try {
      await api.webProjects.resources.delete(editingRec.id)
      toast('Resource removed', 'info')
      setDrawer(null); setEditingRec(null)
      await load()
    } catch (e) { toast('Delete failed: ' + e.message, 'error') }
  }

  const displayed = useMemo(() => {
    const q = search.toLowerCase().trim()
    return resources.filter(r => {
      const f = r.fields || {}
      if (typeFilter && f['Type'] !== typeFilter) return false
      if (q) {
        const name    = (f['Resource Name'] || '').toLowerCase()
        const role    = (f['Role'] || '').toLowerCase()
        const project = Array.isArray(f['Project'])
          ? f['Project'].map(p => (p.title || '')).join(' ').toLowerCase()
          : (f['Project'] || '').toString().toLowerCase()
        if (!name.includes(q) && !role.includes(q) && !project.includes(q)) return false
      }
      return true
    })
  }, [resources, search, typeFilter])

  // Aggregate KPIs
  const totalCost    = useMemo(() => displayed.reduce((s, r) => s + Number(r.fields?.['Total Cost'] || 0), 0), [displayed])
  const totalRevenue = useMemo(() => displayed.reduce((s, r) => s + Number(r.fields?.['Revenue Generated'] || 0), 0), [displayed])
  const totalHours   = useMemo(() => displayed.reduce((s, r) => s + Number(r.fields?.['Man Hours'] || 0), 0), [displayed])

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>All Resources</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            {loading ? 'Loading…' : `${resources.length} resource${resources.length !== 1 ? 's' : ''} across all projects`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setEditingRec(null); setDrawer('new') }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
            <Plus size={14} /><span className="hidden sm:inline">Add Resource</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      {!loading && resources.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard label="Total Cost"    value={formatInr(totalCost)} />
          <KpiCard label="Total Revenue" value={formatInr(totalRevenue)} accent={totalRevenue > 0 ? '#4ade80' : undefined} />
          <KpiCard label="Total Hours"   value={totalHours > 0 ? `${totalHours}h` : '—'} />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[120px] sm:min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
          <input className="w-full rounded-xl pl-8 pr-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            placeholder="Search by name, role or project…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
          <option value="">All types</option>
          {RESOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          <AlertTriangle size={15} /> {error}
          <button onClick={load} className="underline ml-1">retry</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-3" aria-hidden="true">
              <div className="skeleton w-9 h-9 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2"><div className="skeleton h-4 rounded w-1/3" /><div className="skeleton h-3 rounded w-1/4" /></div>
              <div className="skeleton h-4 rounded w-20" />
            </div>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users size={28} className="mb-3 opacity-20" style={{ color: 'var(--text-3)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-2)' }}>
            {search || typeFilter ? 'No resources match filters' : 'No resources yet'}
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>Click "Add Resource" above to get started</p>
        </div>
      ) : (
        <>
        {/* Mobile cards for resources */}
        <div className="md:hidden space-y-2">
          {displayed.map(r => {
            const f = r.fields || {}
            const projLabel = Array.isArray(f['Project'])
              ? f['Project'].map(p => p.title || p.value || '').filter(Boolean).join(', ')
              : f['Project'] || '—'
            const cost    = Number(f['Total Cost'] || 0)
            const hours   = Number(f['Man Hours'] || 0)
            const revenue = Number(f['Revenue Generated'] || 0)
            const margin  = Number(f['Resource Margin %'] || 0)
            const linkedProjId = Array.isArray(f['Project']) && f['Project'][0]?.id
            return (
              <div key={r.id} className="card p-3">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                    style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
                    {(f['Resource Name'] || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{f['Resource Name'] || '—'}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {f['Role'] || '—'}{f['Type'] ? ` · ${f['Type']}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingRec({
                        id: r.id,
                        initial: {
                          resource_name:  f['Resource Name'] || '',
                          role:           f['Role']          || '',
                          type_:          f['Type']          || 'Employee',
                          rate:           f['Rate (₹)']      != null ? String(f['Rate (₹)'])      : '',
                          rate_unit:      f['Rate Unit']     || 'Per Month',
                          units:          f['Units']         != null ? String(f['Units'])         : '',
                          man_hours:      f['Man Hours']     != null ? String(f['Man Hours'])     : '',
                          planned_hours:  f['Planned Hours'] != null ? String(f['Planned Hours']) : '',
                          billing_rate:   f['Billing Rate (₹)'] != null ? String(f['Billing Rate (₹)']) : '',
                          billable_units: f['Billable Units'] != null ? String(f['Billable Units']) : '',
                          from_date:      f['From Date']?.split('T')[0] || '',
                          to_date:        f['To Date']?.split('T')[0]   || '',
                          notes:          f['Notes']         || '',
                          project_id:     linkedProjId || '',
                        },
                      })
                      setDrawer('edit')
                    }}
                    className="btn-ghost flex items-center gap-1 flex-shrink-0"
                    style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}>
                    <Edit2 size={11} /> Edit
                  </button>
                </div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
                  Project: <span style={{ color: 'var(--text-2)' }}>{projLabel}</span>
                </p>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <p style={{ color: 'var(--text-3)' }}>Cost</p>
                    <p className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{cost ? formatInr(cost) : '—'}</p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-3)' }}>Hours</p>
                    <p className="font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{hours > 0 ? `${hours}h` : '—'}</p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-3)' }}>Revenue</p>
                    <p className="font-semibold tabular-nums" style={{ color: revenue > 0 ? '#4ade80' : 'var(--text-3)' }}>
                      {revenue > 0 ? formatInr(revenue) : '—'}
                    </p>
                    {margin > 0 && <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{margin.toFixed(1)}%</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Resource', 'Project', 'Role / Type', 'Cost', 'Hours', 'Revenue', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(r => {
                  const f = r.fields || {}
                  const projLabel = Array.isArray(f['Project'])
                    ? f['Project'].map(p => p.title || p.value || '').filter(Boolean).join(', ')
                    : f['Project'] || '—'
                  const cost    = Number(f['Total Cost'] || 0)
                  const hours   = Number(f['Man Hours'] || 0)
                  const revenue = Number(f['Revenue Generated'] || 0)
                  const margin  = Number(f['Resource Margin %'] || 0)
                  const linkedProjId = Array.isArray(f['Project']) && f['Project'][0]?.id
                  return (
                    <tr key={r.id} className="tbl-row" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="tbl-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                            style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
                            {(f['Resource Name'] || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{f['Resource Name'] || '—'}</p>
                            {f['Rate (₹)'] && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{formatInr(f['Rate (₹)'])}/{f['Rate Unit'] || 'unit'}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="tbl-cell">
                        <p className="text-xs" style={{ color: 'var(--text-2)' }}>{projLabel}</p>
                      </td>
                      <td className="tbl-cell">
                        <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Role'] || '—'}</p>
                        {f['Type'] && <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--bg-input)', color: 'var(--text-3)' }}>{f['Type']}</span>}
                      </td>
                      <td className="tbl-cell">
                        <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                          {cost ? formatInr(cost) : '—'}
                        </p>
                      </td>
                      <td className="tbl-cell">
                        <p className="text-sm tabular-nums" style={{ color: 'var(--text-2)' }}>
                          {hours > 0 ? `${hours}h` : '—'}
                        </p>
                      </td>
                      <td className="tbl-cell">
                        {revenue > 0 ? (
                          <div>
                            <p className="text-sm font-semibold tabular-nums" style={{ color: '#4ade80' }}>{formatInr(revenue)}</p>
                            {margin > 0 && <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{margin.toFixed(1)}% margin</p>}
                          </div>
                        ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                      <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setEditingRec({
                              id: r.id,
                              initial: {
                                resource_name:  f['Resource Name'] || '',
                                role:           f['Role']          || '',
                                type_:          f['Type']          || 'Employee',
                                rate:           f['Rate (₹)']      != null ? String(f['Rate (₹)'])      : '',
                                rate_unit:      f['Rate Unit']     || 'Per Month',
                                units:          f['Units']         != null ? String(f['Units'])         : '',
                                man_hours:      f['Man Hours']     != null ? String(f['Man Hours'])     : '',
                                planned_hours:  f['Planned Hours'] != null ? String(f['Planned Hours']) : '',
                                billing_rate:   f['Billing Rate (₹)'] != null ? String(f['Billing Rate (₹)']) : '',
                                billable_units: f['Billable Units'] != null ? String(f['Billable Units']) : '',
                                from_date:      f['From Date']?.split('T')[0] || '',
                                to_date:        f['To Date']?.split('T')[0]   || '',
                                notes:          f['Notes']         || '',
                                project_id:     linkedProjId || '',
                              },
                            })
                            setDrawer('edit')
                          }}
                          className="btn-ghost flex items-center gap-1.5"
                          style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}>
                          <Edit2 size={11} /><span className="text-[11px] font-semibold">Edit</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Resource Drawer */}
      <ResourceDrawer
        open={drawer === 'new' || drawer === 'edit'}
        onClose={() => { setDrawer(null); setEditingRec(null) }}
        initial={editingRec?.initial || {}}
        onSubmit={handleSave}
        onDelete={drawer === 'edit' ? handleDelete : undefined}
        saving={saving}
        isEdit={drawer === 'edit'}
        projectNames={projectNames}
      />
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
        style={{ background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-btn)' }}>
            <Briefcase size={14} color="#fff" />
          </div>
          <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>Web Projects</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggle}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
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
