import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, CalendarDays, User, Tag, ArrowRight, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock, Briefcase, RotateCcw,
  Sparkles, Upload, Loader2
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import AssociationLinkModal from '../components/AssociationLinkModal'
import clsx from 'clsx'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip, ExecutiveMetricList } from '../components/ExecutiveUI'

/* ── Constants ──────────────────────────────────────────────────────────── */
// Dropdown options are derived live from invoice records — no hardcoded fallbacks
const STATUSES = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
}

const monthKey = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (key) => {
  if (!key) return 'All months'
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

const shiftMonthKey = (key, delta) => {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const shortMonthLabel = (key) => {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

const isRetainerCategory = (value) => /retainer/i.test(String(value || ''))
const currentMonthKey = () => monthKey(new Date().toISOString())
const firstDayIso = (key) => `${key}-01T00:00:00.000Z`

const INVOICE_REQUEST_FORM_URL = 'https://forms.zohopublic.com/theworks/form/TheWorksInvoiceRequest/formperma/EeBkA0aaMt64sMe9n3mxlKggjA-QmVDmTVwrqMHPGOY'

/* ── Field definitions for advanced filter builder ────────────────────────── */
const INVOICE_FIELDS = [
  { key: 'Project',          label: 'Project',         type: 'text' },
  { key: 'Category',         label: 'Category',        type: 'text' },
  { key: 'Milestone',        label: 'Milestone',       type: 'text' },
  { key: 'Raised By',        label: 'Raised By',       type: 'text' },
  { key: 'Payment Status',   label: 'Status',          type: 'text' },
  { key: 'Invoice Number',   label: 'Invoice #',       type: 'text' },
  { key: 'Description',      label: 'Description',     type: 'text' },
  { key: 'Remark',           label: 'Remark',          type: 'text' },
  { key: 'Amount Raised',    label: 'Amount Raised',   type: 'number' },
  { key: 'Amount with Tax',  label: 'Amount w/ Tax',   type: 'number' },
  { key: 'Amount Received',  label: 'Amount Received', type: 'number' },
  { key: 'Raised Date',      label: 'Raised Date',     type: 'date' },
  { key: 'Next followup',    label: 'Next Follow-up',  type: 'date' },
  { key: 'Cleared Date',     label: 'Cleared Date',    type: 'date' },
]

function parseIsoDate(value) {
  const d = new Date(value || '')
  return Number.isNaN(d.getTime()) ? null : d
}

function sortByRaisedDateDesc(records = []) {
  return [...records].sort((a, b) => {
    const da = parseIsoDate(a.fields?.['Raised Date'])?.getTime() || 0
    const db = parseIsoDate(b.fields?.['Raised Date'])?.getTime() || 0
    return db - da
  })
}

function MonthStatusPill({ status, active }) {
  const map = {
    Raised:  { bg: 'var(--fin-pos-bg)',  fg: 'var(--fin-positive)', border: 'var(--fin-pos-border)' },
    Pending: { bg: 'var(--fin-warn-bg)', fg: 'var(--fin-warning)',  border: 'var(--fin-warn-border)' },
    Paused:  { bg: 'var(--fin-neg-bg)',  fg: 'var(--fin-negative)', border: 'var(--fin-neg-border)' },
    Missing: { bg: 'var(--accent-dim)',  fg: 'var(--accent)',       border: 'var(--accent-soft)' },
  }
  const m = map[status] || map.Missing
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        background: m.bg,
        color: m.fg,
        border: `1px solid ${m.border}`,
        boxShadow: active ? `0 0 0 2px ${m.border}` : 'none',
      }}>
      {status}
    </span>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const fmt     = (n) => formatInr(n)
const fmtDate = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return String(d).slice(0, 10) }
}
const fmtDateFull = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

function parseAttachments(cell) {
  if (!cell) return []
  if (Array.isArray(cell)) {
    return cell.map(a => ({
      name: a.name || a.filename || 'Attachment',
      url:  a.url  || a.presignedUrl || '',
      mime: a.mimeType || a.mimetype || '',
    }))
  }
  const parts = String(cell).split(/\s+/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) out.push({
      name: decodeURIComponent(parts[i].replace(/_x20_/g, ' ')).replace(/_x2D_/g, '-'),
      url:  parts[i + 1],
      mime: '',
    })
  }
  return out
}

const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}
const isPdf = (a) =>
  a.mime === 'application/pdf' ||
  /\.pdf(\?|$)/i.test(a.url) ||
  a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ───────────────────────────────────────────────────────── */
const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
}

function classifyAgingBand(days) {
  const d = Number(days || 0)
  if (d <= 14) return '0-14d'
  if (d <= 30) return '15-30d'
  if (d <= 60) return '31-60d'
  return '60d+'
}

function dateOnlyValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function endOfMonthIso(key) {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--glass-bg)', border: 'var(--glass-border)' }
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}{status}
    </span>
  )
}

/* ── Aging badge ─────────────────────────────────────────────────────────── */
// Aging fallback: use Teable formula when available, else compute from Raised Date
function effectiveAging(f) {
  const teableVal = f['Agening (Days)']
  if (teableVal != null && teableVal !== '' && Number(teableVal) > 0) return Number(teableVal)
  const raised = parseIsoDate(f['Raised Date'])
  if (!raised) return 0
  return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
}

function AgingBadge({ days, status }) {
  // Only relevant for Pending invoices
  if (status && status !== 'Pending') return <span style={{ color: 'var(--text-3)' }}>—</span>
  if (days == null || days === '') return <span style={{ color: 'var(--text-3)' }}>—</span>
  const d = Number(days)
  const color = d > 30 ? 'var(--fin-negative)' : d > 14 ? 'var(--fin-warning)' : 'var(--fin-positive)'
  const bg    = d > 30 ? 'var(--fin-neg-bg)'   : d > 14 ? 'var(--fin-warn-bg)' : 'var(--fin-pos-bg)'
  const bdr   = d > 30 ? 'var(--fin-neg-border)': d > 14 ? 'var(--fin-warn-border)': 'var(--fin-pos-border)'
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums"
      style={{ background: bg, color, border: `1px solid ${bdr}` }}>
      {d}d
    </span>
  )
}

/* ── Attachment thumbnail ────────────────────────────────────────────────── */
function AttachThumb({ a, size = 28, onPreview }) {
  const [err, setErr] = useState(false)
  const inner = isImage(a) && !err
    ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
    : isPdf(a)
      ? <FileText size={Math.round(size * 0.45)} style={{ color: '#f87171' }} />
      : <ImageIcon size={Math.round(size * 0.45)} style={{ color: 'var(--text-3)' }} />
  const sharedStyle = { width: size, height: size, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.08)' : 'var(--glass-bg)' }
  const sharedClass = 'flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center border transition-opacity hover:opacity-75'
  if (onPreview) {
    return (
      <button type="button" title={a.name} className={sharedClass} style={sharedStyle}
        onClick={e => { e.stopPropagation(); onPreview() }}>
        {inner}
      </button>
    )
  }
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}
      className={sharedClass} style={sharedStyle}
      onClick={e => e.stopPropagation()}>
      {inner}
    </a>
  )
}

/* ── Full Attachment card ────────────────────────────────────────────────── */
function AttachCard({ a, onPreview }) {
  const [err, setErr] = useState(false)
  const thumb = (
    <div className="rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{ width: 44, height: 44, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.10)' : 'var(--bg-input)' }}>
      {isImage(a) && !err
        ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : isPdf(a)
          ? <FileText size={20} style={{ color: '#f87171' }} />
          : <ImageIcon size={20} style={{ color: 'var(--text-3)' }} />}
    </div>
  )
  const content = (
    <>
      {thumb}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isPdf(a) ? 'PDF Document' : 'Image'} · click to preview</p>
      </div>
      <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-2)' }} />
    </>
  )
  const sharedProps = {
    className: 'group flex items-center gap-3 p-2.5 rounded-xl border transition-all w-full text-left',
    style: { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' },
    onMouseEnter: e => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.borderColor = 'var(--glass-border-hi)' },
    onMouseLeave: e => { e.currentTarget.style.background = 'var(--glass-bg)';       e.currentTarget.style.borderColor = 'var(--glass-border)' },
  }
  if (onPreview) {
    return <button type="button" {...sharedProps} onClick={onPreview}>{content}</button>
  }
  return <a href={a.url} target="_blank" rel="noopener noreferrer" {...sharedProps}>{content}</a>
}

/* ── KPI card — horizontal layout with colored icon tile ──────────────────── */
const KPI_TILE_PALETTE = [
  { bg: 'var(--kpi-1-bg)', fg: 'var(--kpi-1-fg)' },
  { bg: 'var(--kpi-2-bg)', fg: 'var(--kpi-2-fg)' },
  { bg: 'var(--kpi-3-bg)', fg: 'var(--kpi-3-fg)' },
  { bg: 'var(--kpi-4-bg)', fg: 'var(--kpi-4-fg)' },
  { bg: 'var(--kpi-5-bg)', fg: 'var(--kpi-5-fg)' },
]
function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
  const palette = KPI_TILE_PALETTE[tone % KPI_TILE_PALETTE.length]
  const color =
    semantic === 'positive' ? 'var(--fin-positive)' :
    semantic === 'warning'  ? 'var(--fin-warning)'  :
    semantic === 'negative' ? 'var(--fin-negative)' :
    'var(--text-1)'
  return (
    <div className="card flex items-center gap-3 animate-scale-in">
      {Icon && (
        <div className="flex items-center justify-center flex-shrink-0"
          style={{ width: 38, height: 38, borderRadius: 8, background: palette.bg, color: palette.fg }}>
          <Icon size={17} aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="display-num tabular-nums break-words leading-tight"
          style={{ color, fontSize: 'clamp(0.95rem, 2.4vw, 1.35rem)', wordBreak: 'break-word' }}>
          {value ?? '—'}
        </p>
        <p className="text-[11px] mt-1 leading-tight" style={{ color: 'var(--text-3)' }}>{label}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
    </div>
  )
}

/* ── Select wrapper ──────────────────────────────────────────────────────── */
function SelectInput({ value, onChange, options, placeholder = 'Select…', compact = false }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`input appearance-none ${compact ? 'py-1.5 text-xs' : ''}`}
        style={{ paddingRight: '1.75rem', width: 'auto' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

/* ── Invoice detail drawer ───────────────────────────────────────────────── */
function InvoiceDetail({ invoice, onClose, onEdit, onLink, isEditor, onPreview }) {
  if (!invoice) return null
  const navigate = useNavigate()
  const f = invoice.fields || {}
  const assoc = invoice.association
  const related = assoc?.related_counts?.project || {}
  const insight = assoc?.insights?.project
  const signal = insight?.signal
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const openProjects = () => {
    const params = new URLSearchParams()
    if (assoc?.client?.name) params.set('client', assoc.client.name)
    if (assoc?.project?.name) params.set('q', assoc.project.name)
    navigate(`/projects?${params.toString()}`)
  }
  const openStatus = () => {
    const cfg = {
      type: 'card',
      filterClient: assoc?.client?.name || '',
      filterStatus: '',
      search: assoc?.project?.name || f['Project'] || '',
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

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full animate-slide-in"
        style={{ width: 'min(calc(100vw - 1rem), 500px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 gap-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              {f['Invoice Number'] || '—'}
            </p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isEditor && (
              <button onClick={onLink} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                Link
              </button>
            )}
            {isEditor && (
              <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                Edit
              </button>
            )}
            <button onClick={onClose} className="btn-icon" aria-label="Close"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status row */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                {f['Speed']}
              </span>
            )}
            {f['Raised By'] && (
              <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                <User size={9} />{f['Raised By']}
              </span>
            )}
          </div>

          {/* Description */}
          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                {f['Description']}
              </p>
            </div>
          )}

          {assoc?.project?.name && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Briefcase size={13} style={{ color: 'var(--accent)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Linked portfolio association</p>
              </div>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-2)' }}>
                <p><strong style={{ color: 'var(--text-1)' }}>Project:</strong> {assoc.project.name}</p>
                {assoc.client?.name && <p><strong style={{ color: 'var(--text-1)' }}>Client:</strong> {assoc.client.name}</p>}
                <p>{related.projects || 0} project record{(related.projects || 0) !== 1 ? 's' : ''} · {related.status || 0} status update{(related.status || 0) !== 1 ? 's' : ''} · {related.invoices || 0} invoice{(related.invoices || 0) !== 1 ? 's' : ''}</p>
                {signal?.detail && (
                  <p><strong style={{ color: 'var(--text-1)' }}>{signal.title}:</strong> {signal.detail}</p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={openProjects} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>
                  Open projects
                </button>
                <button onClick={openStatus} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>
                  Open status board
                </button>
              </div>
            </div>
          )}

          {/* Amount grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],       'var(--text-1)'],
              ['With GST (18%)',  f['Amount with Tax'],     'var(--text-1)'],
              ['Received',        f['Amount Received'],     'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'],  outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmt(val)}</p>
              </div>
            ))}
          </div>

          {/* Dates + computed */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Raised',      fmtDateFull(f['Raised Date'])],
              ['Cleared',     fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']    != null ? `${f['Days To Clear']} days`    : '—'],
              ['Aging',         f['Agening (Days)']   != null ? `${f['Agening (Days)']} days`   : '—'],
              ['Milestone',     f['Milestone']        || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Remark */}
          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {/* Attachments */}
          {(refs.length > 0 || pdfs.length > 0) && (
            <div className="space-y-3">
              {refs.length > 0 && (
                <div>
                  <p className="label mb-2">Payment Reference{refs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{refs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, i) : undefined} />)}</div>
                </div>
              )}
              {pdfs.length > 0 && (
                <div>
                  <p className="label mb-2">Invoice PDF{pdfs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{pdfs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, refs.length + i) : undefined} />)}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
        </div>
      </aside>
    </div>
  )
}

/* ── Invoice form drawer ─────────────────────────────────────────────────── */
function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function InvoiceDrawer({ invoice, prefill, onClose, onSaved, onDeleted, options = {} }) {
  const isEdit = Boolean(invoice?.id)
  const [form,       setForm]      = useState(EMPTY_FORM)
  const [saving,     setSaving]    = useState(false)
  const [deleting,   setDeleting]  = useState(false)
  const [confirmDel, setConfirmDel]= useState(false)
  const [error,      setError]     = useState('')
  const [parsing,    setParsing]   = useState(false)
  const [parseNote,  setParseNote] = useState('')   // "Filled N fields" banner text
  const [parseError, setParseError]= useState('')
  const parseFileRef = useRef(null)
  const paidSelected = form.payment_status === 'Paid'
  const projectOptions  = options.projects  || []
  const categoryOptions = options.categories || []
  const milestoneOptions= options.milestones || []
  const raisedByOptions = options.raisedBy  || []
  const retainerCategoryOption = categoryOptions.find(c => /retainer/i.test(c)) || 'Development- Retainer'
  const retainerSelected = isRetainerCategory(form.category)

  useEffect(() => {
    if (!invoice && !prefill) { setForm(EMPTY_FORM); return }
    if (!invoice && prefill) {
      setForm({ ...EMPTY_FORM, ...prefill })
      return
    }
    const f = invoice.fields || {}
    setForm({
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
      category:        f['Category']        || '',
      description:     f['Description']     || '',
      milestone:       f['Milestone']       || '',
      raised_by:       f['Raised By']       || '',
      raised_date:     f['Raised Date']   ? String(f['Raised Date']).slice(0, 10)   : '',
      cleared_date:    f['Cleared Date']  ? String(f['Cleared Date']).slice(0, 10)  : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
    })
  }, [invoice, prefill])

  const set  = k => v   => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev  => setForm(f => ({ ...f, [k]: ev.target.value }))

  async function handleSave() {
    if (paidSelected && !String(form.amount_received).trim()) {
      setError('Amount received is required when status is Paid')
      return
    }
    if (paidSelected && !form.cleared_date) {
      setError('Cleared date is required when status is Paid')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        amount_raised:   form.amount_raised   !== '' ? Number(form.amount_raised)   : undefined,
        amount_with_tax: form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
        amount_received: form.amount_received !== '' ? Number(form.amount_received) : undefined,
        raised_date:     form.raised_date     ? `${form.raised_date}T00:00:00.000Z`   : undefined,
        cleared_date:    form.cleared_date    ? `${form.cleared_date}T00:00:00.000Z`  : undefined,
        next_followup:   form.next_followup   ? `${form.next_followup}T00:00:00.000Z` : undefined,
      }
      if (isEdit) await api.invoices.update(invoice.id, payload)
      else        await api.invoices.create(payload)
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true)
    try { await api.invoices.delete(invoice.id); onDeleted() }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  async function handleParseFile(file) {
    if (!file) return
    setParsing(true); setParseError(''); setParseNote('')
    try {
      const { fields } = await api.invoices.parse(file)
      if (!fields || Object.keys(fields).length === 0) {
        setParseError('AI could not extract any fields from this document. Please fill manually.')
        return
      }
      // Map returned fields onto the form — only overwrite blank fields (preserve user edits)
      const FIELD_MAP = {
        invoice_number:  'invoice_number',
        project:         'project',
        description:     'description',
        raised_date:     'raised_date',
        cleared_date:    'cleared_date',
        amount_raised:   'amount_raised',
        amount_with_tax: 'amount_with_tax',
        amount_received: 'amount_received',
        payment_status:  'payment_status',
        milestone:       'milestone',
        raised_by:       'raised_by',
        remark:          'remark',
      }
      let filled = 0
      setForm(prev => {
        const next = { ...prev }
        for (const [aiKey, formKey] of Object.entries(FIELD_MAP)) {
          const val = fields[aiKey]
          if (val == null || val === '') continue
          // Only overwrite if the current field is blank / default
          const cur = prev[formKey]
          const isEmpty = cur === '' || cur === null || cur === undefined ||
                          cur === 'Pending'  // default status — safe to overwrite
          if (formKey === 'payment_status' || isEmpty) {
            // Normalise dates — strip time portion
            const normalised = (formKey.endsWith('_date') && typeof val === 'string')
              ? val.slice(0, 10)
              : val
            next[formKey] = String(normalised)
            if (isEmpty) filled++
          }
        }
        return next
      })
      // Use a small delay so `filled` captures the final count
      setTimeout(() => {
        setParseNote(`AI filled ${filled} field${filled !== 1 ? 's' : ''} — please review and correct`)
      }, 50)
    } catch (e) {
      const status = e.status
      const msg = status === 400 ? e.message               // our explicit error (bad file, unreadable PDF, etc.)
               : status === 413 ? 'File too large (max 10 MB)'
               : status === 403 ? 'Not authorized to use this feature'
               : e.message && !e.message.startsWith('[') ? e.message
               : 'AI parse failed — try a clearer image or a text-based PDF'
      setParseError(msg)
    } finally {
      setParsing(false)
      if (parseFileRef.current) parseFileRef.current.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full overflow-hidden animate-slide-in"
        style={{ width: 'min(calc(100vw - 1rem), 520px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>
            {isEdit ? `Edit · ${invoice.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">

          {/* ── AI Invoice Scanner ── */}
          <div>
            <input
              ref={parseFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={e => handleParseFile(e.target.files?.[0])}
            />
            {parsing ? (
              <div className="flex items-center justify-center gap-2.5 p-4 rounded-xl"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                <Loader2 size={15} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  AI is reading your invoice…
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => parseFileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 border-dashed transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ borderColor: 'var(--accent-soft)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Sparkles size={14} />
                <span className="text-xs font-semibold">Scan Invoice with AI</span>
                <Upload size={12} className="opacity-60" />
                <span className="text-[11px] opacity-60">PDF · PNG · JPG</span>
              </button>
            )}
            {parseNote && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
                <CheckCircle2 size={12} className="flex-shrink-0" />
                {parseNote}
              </div>
            )}
            {parseError && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
                <AlertTriangle size={12} className="flex-shrink-0" />
                {parseError}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </Field>
            <Field label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Project">
              <SelectInput value={form.project} onChange={set('project')} options={projectOptions} placeholder="Select project…" />
            </Field>
            <Field label="Category">
              <SelectInput value={form.category} onChange={set('category')} options={categoryOptions} placeholder="Select…" />
            </Field>
          </div>
          <div>
            <label className="label">Billing Type</label>
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, category: categoryOptions.find(c => !isRetainerCategory(c)) || '' }))}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={!retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Project
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, category: retainerCategoryOption }))}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Retainer
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Milestone">
              <SelectInput value={form.milestone} onChange={set('milestone')} options={milestoneOptions} placeholder="Select…" />
            </Field>
            <Field label="Raised By">
              <SelectInput value={form.raised_by} onChange={set('raised_by')} options={raisedByOptions} placeholder="Select…" />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></Field>
            <Field label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Raised (₹)"><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></Field>
            <Field label="With GST (₹)"><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></Field>
            <Field label="Received (₹)"><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></Field>
          </div>
          <Field label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </Field>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              Paid invoices must include Amount Received and Cleared Date. It is also recommended to attach a payment reference screenshot before closing the entry.
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode — put the retainer/client name in Project. The latest retainer row becomes the monthly template; invoice number can be filled later.
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          {isEdit ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Save size={12} />{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ── Skeleton row ─────────────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="tbl-row">
      {[80, 100, 90, 72, 72, 80, 100, 90, 90, 72, 72, 48, 64, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell">
          <div className="skeleton h-3 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isEditor } = useAuth()
  const toast = useToast()
  const initialStatus = searchParams.get('status') || ''
  const initialProject = searchParams.get('project') || ''
  const initialQuery = searchParams.get('q') || ''
  const [workspace,       setWorkspace]       = useState('invoices')
  const [selectedRetainer,setSelectedRetainer]= useState('')
  const [retainerMonth,   setRetainerMonth]   = useState(currentMonthKey())
  const [billingFilter,   setBillingFilter]   = useState('all')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [statusFilter,   setStatusFilter]   = useState(initialStatus)
  const [projectFilter,  setProjectFilter]  = useState(initialProject)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [monthFilter,    setMonthFilter]    = useState('')
  const [agingBandFilter,setAgingBandFilter]= useState('')
  const [dateFieldFilter,setDateFieldFilter]= useState('Raised Date')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [search,         setSearch]         = useState(initialQuery)
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [hasDocsOnly,    setHasDocsOnly]    = useState(false)
  const [followupDueOnly,setFollowupDueOnly]= useState(false)
  const [showFilters,    setShowFilters]    = useState(false)
  const [filterConditions, setFilterConditions] = useState([])
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer, setDrawer] = useState(null)
  const [previewDocs, setPreviewDocs] = useState(null)
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const [associationRecord, setAssociationRecord] = useState(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => { setStatusFilter(searchParams.get('status') || '') }, [searchParams])
  useEffect(() => { setProjectFilter(searchParams.get('project') || '') }, [searchParams])
  useEffect(() => { setSearch(searchParams.get('q') || '') }, [searchParams])

  const updateFilterParam = useCallback((key, value) => {
    const next = new URLSearchParams(searchParams)
    const current = searchParams.get(key) || ''
    const target = value || ''
    if (current === target) return
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    updateFilterParam('q', deferredSearch.trim())
  }, [deferredSearch, updateFilterParam])

  /* ── Fetch summary ── */
  const fetchSummary = useCallback(() => api.invoices.summary(), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 10_000)

  /* ── Fetch records — refetches when server-side filters/sort change ── */
  const fetchRecords = useCallback(() =>
    api.invoices.list({
      status:   statusFilter  || undefined,
      project:  projectFilter || undefined,
      limit:    500,
      order_by: sortCol,
      order:    sortDir,
    }), [statusFilter, projectFilter, sortCol, sortDir])

  const { data: listData, loading, error, refresh, syncing } = useAutoRefresh(fetchRecords, 10_000)
  const allRecords = listData?.records || []

  /* ── Dynamic filter/form options derived from actual records ── */
  const projectOptions = useMemo(() => (
    [...new Set(allRecords.map(r => r.fields?.['Project']).filter(Boolean))].sort()
  ), [allRecords])

  const categoryOptions = useMemo(() => (
    [...new Set(allRecords.map(r => r.fields?.['Category']).filter(Boolean))].sort()
  ), [allRecords])

  const milestoneOptions = useMemo(() => (
    [...new Set(allRecords.map(r => r.fields?.['Milestone']).filter(Boolean))].sort()
  ), [allRecords])

  const raisedByOptions = useMemo(() => (
    [...new Set(allRecords.map(r => r.fields?.['Raised By']).filter(Boolean))].sort()
  ), [allRecords])

  // Bundle for InvoiceDrawer
  const formOptions = useMemo(() => ({
    projects:   projectOptions,
    categories: categoryOptions,
    milestones: milestoneOptions,
    raisedBy:   raisedByOptions,
  }), [projectOptions, categoryOptions, milestoneOptions, raisedByOptions])

  /* ── Client-side filter (category, raisedBy, freetext) ── */
  const monthOptions = useMemo(() => (
    [...new Set(
      allRecords
        .map(r => monthKey(r.fields?.['Raised Date']))
        .filter(Boolean)
    )].sort().reverse()
  ), [allRecords])

  const retainerMonthOptions = useMemo(() => (
    [...new Set([currentMonthKey(), ...monthOptions])].sort().reverse()
  ), [monthOptions])

  const retainerGroups = useMemo(() => {
    const retainerRecords = allRecords.filter(r => isRetainerCategory(r.fields?.['Category']))
    const grouped = new Map()
    for (const record of retainerRecords) {
      const project = String(record.fields?.['Project'] || '').trim() || 'Unnamed Retainer'
      if (!grouped.has(project)) grouped.set(project, [])
      grouped.get(project).push(record)
    }
    return [...grouped.entries()].map(([project, items]) => {
      const sorted = sortByRaisedDateDesc(items)
      const latestActive = sorted.find(r => r.fields?.['Payment Status'] !== 'Cancelled') || sorted[0]
      // Build recordByMonth preferring active (non-cancelled) records when a month
      // has multiple invoices (e.g. original cancelled + re-raised paid replacement).
      const recordByMonth = {}
      for (const r of sorted) {
        const key = monthKey(r.fields?.['Raised Date'])
        if (!key) continue
        const existing = recordByMonth[key]
        const thisCancelled = r.fields?.['Payment Status'] === 'Cancelled'
        if (!existing || (existing.fields?.['Payment Status'] === 'Cancelled' && !thisCancelled)) {
          recordByMonth[key] = r
        }
      }
      // For the selected month, prefer the active record over a cancelled one
      const monthRecord =
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth && r.fields?.['Payment Status'] !== 'Cancelled') ||
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth)
      const amount = Number(latestActive?.fields?.['Amount Raised'] || 0)
      const withTax = Number(latestActive?.fields?.['Amount with Tax'] || 0)
      const monthStatus = !monthRecord
        ? 'Missing'
        : monthRecord.fields?.['Payment Status'] === 'Cancelled'
          ? 'Paused'
          : monthRecord.fields?.['Payment Status'] || 'Pending'
      const timelineMonths = Array.from({ length: 8 }, (_, i) => shiftMonthKey(currentMonthKey(), i - 3))
      const timeline = timelineMonths.map((key) => {
        const rec = recordByMonth[key]
        const recStatus = !rec
          ? 'Missing'
          : rec.fields?.['Payment Status'] === 'Cancelled'
            ? 'Paused'
            : rec.fields?.['Payment Status'] === 'Paid'
              ? 'Raised'
              : 'Pending'
        return {
          key,
          label: shortMonthLabel(key),
          fullLabel: monthLabel(key),
          record: rec,
          status: recStatus,
          active: key === retainerMonth,
          current: key === currentMonthKey(),
        }
      })
      const currentTimeline = timeline.find(t => t.current)
      const currentMonthRaised = currentTimeline ? currentTimeline.status !== 'Missing' : false
      let nextDueMonth = currentMonthKey()
      for (let i = 0; i < 12; i++) {
        const key = shiftMonthKey(currentMonthKey(), i)
        const rec = recordByMonth[key]
        const paused = rec?.fields?.['Payment Status'] === 'Cancelled'
        if (!rec || paused) {
          nextDueMonth = paused ? shiftMonthKey(key, 1) : key
          break
        }
        nextDueMonth = shiftMonthKey(key, 1)
      }
      return {
        project,
        records: sorted,
        latestActive,
        recordByMonth,
        monthRecord,
        amount,
        withTax,
        monthStatus,
        timeline,
        currentMonthRaised,
        nextDueMonth,
        raisedBy: latestActive?.fields?.['Raised By'] || '',
        description: latestActive?.fields?.['Description'] || '',
      }
    }).sort((a, b) => a.project.localeCompare(b.project))
  }, [allRecords, retainerMonth])

  useEffect(() => {
    if (!retainerGroups.length) { setSelectedRetainer(''); return }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null

  const todayIso = new Date().toISOString().slice(0, 10)

  const scopedRecords = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return allRecords.filter((r) => {
      const f = r.fields || {}
      if (billingFilter === 'retainer' && !isRetainerCategory(f['Category'])) return false
      if (billingFilter === 'project' && isRetainerCategory(f['Category'])) return false
      if (categoryFilter && f['Category'] !== categoryFilter) return false
      if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
      if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
      if (dateFrom || dateTo) {
        const candidate = dateOnlyValue(f[dateFieldFilter])
        if (!candidate) return false
        if (dateFrom && candidate < dateFrom) return false
        if (dateTo && candidate > dateTo) return false
      }
      if (overdueOnly && !(f['Payment Status'] === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
      if (followupDueOnly) {
        const raw = f['Next followup']
        if (!raw) return false
        const nextFollowup = String(raw).slice(0, 10)
        if (nextFollowup > todayIso) return false
      }
      if (hasDocsOnly) {
        const refs = parseAttachments(f['Reference'])
        const pdfs = parseAttachments(f['Invoice PDF'])
        if (refs.length + pdfs.length === 0) return false
      }
      if (agingBandFilter) {
        if (f['Payment Status'] !== 'Pending') return false
        const band = classifyAgingBand(effectiveAging(f))
        if (band !== agingBandFilter) return false
      }
      if (!q) return true
      return (
        (f['Invoice Number'] || '').toLowerCase().includes(q) ||
        (f['Project']        || '').toLowerCase().includes(q) ||
        (f['Description']    || '').toLowerCase().includes(q) ||
        (f['Category']       || '').toLowerCase().includes(q) ||
        (f['Milestone']      || '').toLowerCase().includes(q)
      )
    })
  }, [
    allRecords,
    agingBandFilter,
    billingFilter,
    categoryFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    deferredSearch,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    raisedByFilter,
    todayIso,
  ])

  const records = useMemo(
    () => applyConditions(scopedRecords, filterConditions, r => r.fields ?? {}),
    [filterConditions, scopedRecords]
  )

  const s = summary
  const overdue = s?.overdue_invoices || []
  const agingBuckets = useMemo(() => {
    const buckets = { '0-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 }
    for (const r of scopedRecords) {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Pending') continue
      buckets[classifyAgingBand(effectiveAging(f))] += 1
    }
    return buckets
  }, [scopedRecords])
  const actionQueue = useMemo(() => {
    return [...records]
      .map((record) => {
        const f = record.fields || {}
        const outstandingAmount = Number(f['Outstanding Amount'] || 0)
        const agingDays = effectiveAging(f)
        const followupRaw = f['Next followup'] ? String(f['Next followup']).slice(0, 10) : ''
        const hasDueFollowup = Boolean(followupRaw) && followupRaw <= todayIso
        let priority = 0
        let title = ''
        let note = ''
        if (f['Payment Status'] === 'Pending' && agingDays > 30) {
          priority = agingDays > 60 ? 5 : 4
          title = agingDays > 60 ? 'Critical overdue collection' : 'Overdue collection'
          note = `${agingDays} days aging · ${fmt(outstandingAmount)} still open`
        } else if (hasDueFollowup) {
          priority = followupRaw < todayIso ? 3 : 2
          title = followupRaw < todayIso ? 'Follow-up overdue' : 'Follow-up due today'
          note = `${f['Project'] || f['Invoice Number'] || 'Invoice'} needs owner follow-up`
        } else if (f['Payment Status'] === 'Pending' && outstandingAmount > 0) {
          priority = 1
          title = 'Open receivable'
          note = `${fmt(outstandingAmount)} awaiting collection`
        } else {
          return null
        }
        return { record, priority, title, note, agingDays, outstandingAmount }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return b.outstandingAmount - a.outstandingAmount
      })
      .slice(0, 5)
  }, [records, todayIso])
  const activeConditions = filterConditions.filter(c => c.field && c.op && (c.value !== '' || ['is_empty','is_not_empty'].includes(c.op)))
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0

  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [s])
  const raisedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Raised Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const clearedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Cleared Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Received'] || record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const followupsDueCount = useMemo(
    () => records.filter((r) => {
      const raw = r.fields?.['Next followup']
      return raw && String(raw).slice(0, 10) <= todayIso
    }).length,
    [records, todayIso]
  )
  const missingDocsCount = useMemo(
    () => records.filter((r) => parseAttachments(r.fields?.['Reference']).length + parseAttachments(r.fields?.['Invoice PDF']).length === 0).length,
    [records]
  )
  const pendingCount = s?.by_status?.Pending || 0
  const currentScopeOutstanding = useMemo(
    () => records.reduce((sum, r) => sum + Number(r.fields?.['Outstanding Amount'] || 0), 0),
    [records]
  )
  const applyMonthDrilldown = useCallback((field, key) => {
    setDateFieldFilter(field)
    setDateFrom(`${key}-01`)
    setDateTo(endOfMonthIso(key))
    setMonthFilter(field === 'Raised Date' ? key : '')
  }, [])

  async function createRetainerMonth(group, mode) {
    if (!group?.latestActive) {
      toast('No existing retainer template found for this project', 'warning')
      return
    }
    const isPause = mode === 'pause'
    const monthName = monthLabel(retainerMonth)
    const pauseReason = isPause
      ? window.prompt(`Why is ${group.project} paused for ${monthName}?`, '')
      : null
    if (isPause && pauseReason == null) return
    const key = `${mode}:${group.project}:${retainerMonth}`
    setRetainerActionBusy(key)
    try {
      const base = group.latestActive.fields || {}
      const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
        description: isPause
          ? `Retainer paused for ${monthName}`
          : `Recurring retainer invoice for ${monthName}. Update invoice number before sharing.`,
        milestone: base['Milestone'] || null,
        raised_by: base['Raised By'] || null,
        raised_date: firstDayIso(retainerMonth),
        amount_raised: isPause ? 0 : Number(base['Amount Raised'] || 0),
        amount_with_tax: isPause ? 0 : Number(base['Amount with Tax'] || 0),
        amount_received: isPause ? 0 : undefined,
        payment_status: isPause ? 'Cancelled' : 'Pending',
        remark: isPause
          ? `Paused for ${monthName}. Reason: ${(pauseReason || 'Not specified').trim()}`
          : `Recurring retainer for ${monthName}. Invoice number to be updated.`,
      }
      await api.invoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
    setDrawer({
      mode: 'new',
      invoice: null,
      prefill: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
        description: `Retainer invoice recorded for ${label}`,
        milestone: base['Milestone'] || '',
        raised_by: base['Raised By'] || '',
        raised_date: `${monthKeyValue}-01`,
        cleared_date: '',
        amount_raised: base['Amount Raised'] ?? '',
        amount_with_tax: base['Amount with Tax'] ?? '',
        amount_received: '',
        payment_status: 'Pending',
        remark: `Invoice already raised via Zoho form for ${label}. Enter invoice number and final details here.`,
        next_followup: '',
      },
    })
  }

  /* ── Helpers ── */
  const openNew     = () => setDrawer({ mode: 'new',  invoice: null })
  const openView    = r  => setDrawer({ mode: 'view', invoice: r   })
  const closeDrawer = () => setDrawer(null)
  const handleSaved   = () => { refresh(); closeDrawer() }
  const handleDeleted = () => { refresh(); closeDrawer() }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // Inline sort-label used inside <th className="tbl-head">
  function SortLabel({ col, children }) {
    const active = sortCol === col
    const asc    = sortDir === 'asc'
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center gap-1 cursor-pointer select-none section-title whitespace-nowrap group/sort"
        title={active ? (asc ? 'Sorted ascending — click for descending' : 'Sorted descending — click for ascending') : `Sort by ${col}`}
        style={{ color: active ? 'var(--accent)' : 'var(--text-3)', background: 'none', border: 'none', padding: 0 }}>
        {children}
        <ArrowUpDown size={10} style={{
          opacity: active ? 1 : 0.3,
          color: active ? 'var(--accent)' : undefined,
          transform: active && asc ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }} className="group-hover/sort:opacity-80" />
      </button>
    )
  }

  return (
    <ExecutiveShell>

      <ExecutiveHero
        eyebrow="Receivables Command Deck"
        title="Invoices"
        description="Operate collections, aging, retainer billing, and linked project context from a denser finance workspace."
        icon={Receipt}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ExecutiveChip accent>{allRecords.length} live invoice{allRecords.length !== 1 ? 's' : ''}</ExecutiveChip>
            <ExecutiveChip>{syncing ? 'syncing…' : 'mirror-fast · Teable-backed'}</ExecutiveChip>
            {hasFilters && <ExecutiveChip>{records.length} in current scope</ExecutiveChip>}
          </div>
        }
        actions={
          <>
            {isEditor && workspace === 'invoices' && (
              <>
                <button onClick={() => setShareModal(true)} className="btn-ghost"><ExternalLink size={14} />Share View</button>
                <button onClick={() => setManageModal(true)} className="btn-ghost"><Eye size={14} />Links</button>
              </>
            )}
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} />Raise Externally
            </button>
            <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-ghost">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
            </button>
            {isEditor && (
              <button onClick={openNew} className="btn-primary"><Plus size={14} />New Invoice</button>
            )}
          </>
        }
      >
        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard label="Total raised" value={sumLoading && !s ? '—' : fmt(s?.total_raised)} icon={IndianRupee} />
          <ExecutiveStatCard label="Collected" value={sumLoading && !s ? '—' : fmt(s?.total_received)} sub={s ? `${(s.collection_rate ?? 0).toFixed(1)}% collection rate` : ''} accent="positive" icon={TrendingUp} />
          <ExecutiveStatCard label="Outstanding" value={sumLoading && !s ? '—' : fmt(s?.total_outstanding)} sub={`${s?.by_status?.Pending || 0} pending invoices`} accent={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'} icon={CalendarClock} />
          <ExecutiveStatCard
            label="Action today"
            value={actionQueue.length}
            sub={actionQueue[0]
              ? `${actionQueue[0].title} · ${actionQueue[0].record.fields?.['Project'] || actionQueue[0].record.fields?.['Invoice Number'] || 'Invoice'}`
              : 'No urgent collections or follow-ups right now'}
            accent={actionQueue.length ? 'warning' : 'positive'}
            icon={AlertOctagon}
          />
        </ExecutiveStatGrid>
      </ExecutiveHero>

      <section aria-label="Invoice metrics" className="workspace-kpi-grid">
        <KpiCard tone={0} label="Total Raised" value={sumLoading && !s ? null : fmt(s?.total_raised)} icon={IndianRupee} />
        <KpiCard tone={1} label="Incl. GST" value={sumLoading && !s ? null : fmt(s?.total_with_tax)} icon={Receipt} />
        <KpiCard tone={2} label="Collected" value={sumLoading && !s ? null : fmt(s?.total_received)} icon={TrendingUp} semantic="positive" />
        <KpiCard
          tone={3}
          label="Outstanding"
          value={sumLoading && !s ? null : fmt(s?.total_outstanding)}
          icon={CalendarClock}
          semantic={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
          sub={(s?.total_outstanding || 0) > 0 ? `${s?.by_status?.Pending || 0} pending` : 'Fully collected'}
        />
        <KpiCard
          tone={4}
          label="Collection Rate"
          value={sumLoading && !s ? null : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
          icon={Percent}
          semantic={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
        />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_340px] gap-4">
        <ExecutivePanel
          title="Workspace controls"
          subtitle="Switch billing mode, jump into high-pressure queues, and keep the current scope focused on actual collections work."
        >
          <ExecutiveFilterBar className="mb-3">
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[['invoices', 'Invoices'], ['retainers', 'Retainers']].map(([value, label]) => (
                <button key={value} onClick={() => setWorkspace(value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={workspace === value
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setFollowupDueOnly(true)
                setOverdueOnly(false)
                setAgingBandFilter('')
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: followupDueOnly ? 'var(--accent)' : undefined }}
            >
              <CalendarDays size={12} />Follow-ups due
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setOverdueOnly(true)
                setFollowupDueOnly(false)
                setAgingBandFilter('31-60d')
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: overdueOnly || agingBandFilter ? 'var(--accent)' : undefined }}
            >
              <AlertTriangle size={12} />Collections pressure
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setHasDocsOnly(true)
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: hasDocsOnly ? 'var(--accent)' : undefined }}
            >
              <FileText size={12} />Docs attached
            </button>
          </ExecutiveFilterBar>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="label">Open in scope</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(currentScopeOutstanding)}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{pendingCount} pending invoices currently visible</p>
                </div>
                <div>
                  <p className="label">Follow-up load</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: followupsDueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{followupsDueCount}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Due today or already overdue</p>
                </div>
                <div>
                  <p className="label">Missing proof/docs</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: missingDocsCount ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{missingDocsCount}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Invoices without PDF or payment reference</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="label">Immediate action queue</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Concrete follow-up items, not a generic count.</p>
                </div>
                <ExecutiveChip accent>{actionQueue.length} live</ExecutiveChip>
              </div>
              <div className="space-y-2">
                {actionQueue.length === 0 ? (
                  <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                    Nothing critical in the current scope. Use filters to inspect a tighter invoice segment.
                  </div>
                ) : actionQueue.slice(0, 3).map((item) => (
                  <div key={item.record.id} className="rounded-xl px-3 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{item.title}</p>
                        <p className="text-[11px] truncate mt-1" style={{ color: 'var(--text-3)' }}>
                          {item.record.fields?.['Invoice Number'] || 'Invoice'} · {item.record.fields?.['Project'] || 'Unassigned project'}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--fin-warning)' }}>
                        {fmt(item.outstandingAmount)}
                      </span>
                    </div>
                    <p className="text-[11px] mt-2" style={{ color: 'var(--text-2)' }}>{item.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ExecutivePanel>

        <ExecutivePanel title="Aging buckets" subtitle="Quick receivables heat map for the current invoice scope.">
          <div className="space-y-2">
            {Object.entries(agingBuckets).map(([label, value]) => {
              const active = agingBandFilter === label
              const accent = label === '60d+' ? 'negative' : label === '31-60d' ? 'warning' : undefined
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAgingBandFilter(active ? '' : label)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-input)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.08)' : 'none',
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{label}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Pending invoices</p>
                  </div>
                  <span className={clsx('text-sm font-bold tabular-nums', accent === 'warning' && 'executive-stat-warning', accent === 'negative' && 'executive-stat-negative')} style={{ color: accent ? undefined : 'var(--text-1)' }}>
                    {value}
                  </span>
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExecutivePanel
          title="Raised by month"
          subtitle="Click a month to drill the workspace into invoices raised in that exact month-year."
          action={<ExecutiveChip accent>{raisedTimeline.length} month{raisedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {raisedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No raised-date distribution is available in the current scope.
              </div>
            ) : raisedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Raised Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} raised invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>

        <ExecutivePanel
          title="Cleared by month"
          subtitle="Click a month to isolate invoices cleared in that month-year and inspect actual collections."
          action={<ExecutiveChip accent>{clearedTimeline.length} month{clearedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {clearedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No cleared-date distribution is available in the current scope.
              </div>
            ) : clearedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Cleared Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} cleared invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>
      </div>

      {/* ── Status chips — click to filter, shows count + total amount ── */}
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section className="status-card-grid">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
            const Icon = m.icon
            const active = statusFilter === status
            const amount = s?.by_status_amounts?.[status]
            return (
              <button key={status}
                onClick={() => {
                  const next = active ? '' : status
                  setStatusFilter(next)
                  updateFilterParam('status', next)
                }}
                className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                style={{
                  borderColor: active ? m.color : 'var(--card-border)',
                  background: active ? `${m.color}10` : 'var(--card-bg)',
                  boxShadow: active ? `0 0 0 2px ${m.color}30, var(--card-shadow)` : 'var(--card-shadow)',
                }}
                aria-pressed={active}>
                {/* Icon tile */}
                <div className="kpi-icon flex-shrink-0"
                  style={{ background: `${m.color}18` }}>
                  {Icon && <Icon size={18} style={{ color: m.color }} />}
                </div>
                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                  <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                  {amount != null && (
                    <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>
                      {fmt(amount)}
                    </p>
                  )}
                </div>
                {/* Active indicator */}
                {active && (
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                )}
              </button>
            )
          })}
        </section>
      )}

      {/* ── Overdue alert ── */}
      {overdue.length > 0 && (
        <section className="rounded-2xl p-4 animate-slide-down"
          style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertOctagon size={14} style={{ color: '#f87171' }} />
            <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
              {overdue.length} Pending Invoice{overdue.length !== 1 ? 's' : ''} Awaiting Collection
            </p>
          </div>
          <div className="space-y-1.5">
            {overdue.map((inv, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg"
                style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.10)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(inv.amount)}</span>
                  <AgingBadge days={inv.aging} status="Pending" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Retainer Workspace ── */}
      {workspace === 'retainers' && (
        <section className="card space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                {' '}
                <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once raised, store the final invoice number and details here.
              </p>
            </div>
            <div className="relative">
              <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={retainerMonth} onChange={e => setRetainerMonth(e.target.value)}
                className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 170, paddingRight: '1.5rem' }}>
                {retainerMonthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>
          </div>

          {retainerGroups.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No retainer templates found</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Create a normal invoice and set the category to a retainer category first.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-4">
              <div className="space-y-3">
                {retainerGroups.map(group => (
                  <button key={group.project} type="button"
                    onClick={() => setSelectedRetainer(group.project)}
                    className="w-full text-left rounded-xl p-4 transition-all"
                    style={{
                      background: selectedRetainer === group.project ? 'var(--accent-dim)' : 'var(--bg-layer)',
                      border: `1px solid ${selectedRetainer === group.project ? 'var(--accent)' : 'var(--card-border)'}`,
                      boxShadow: selectedRetainer === group.project ? '0 0 0 2px rgba(37,99,235,0.10)' : 'none',
                    }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {fmt(group.amount)} template · next due {monthLabel(group.nextDueMonth)}
                        </p>
                      </div>
                      <MonthStatusPill status={group.monthStatus} active={selectedRetainer === group.project} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div>
                        <p className="label">Current month</p>
                        <p className="text-xs font-medium" style={{ color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)' }}>
                          {group.currentMonthRaised ? 'Raised / planned' : 'Missing'}
                        </p>
                      </div>
                      <div>
                        <p className="label">Raised by</p>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {selectedRetainerGroup && (() => {
                const group = selectedRetainerGroup
                const monthRec = group.monthRecord?.fields || null
                const missing = !monthRec
                const busyCreate = retainerActionBusy === `create:${group.project}:${retainerMonth}`
                const busyPause = retainerActionBusy === `pause:${group.project}:${retainerMonth}`
                return (
                  <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                          Template amount {fmt(group.amount)}{group.withTax ? ` · GST total ${fmt(group.withTax)}` : ''} · Next due {monthLabel(group.nextDueMonth)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <MonthStatusPill status={group.monthStatus} active />
                        <span className="text-xs px-2 py-1 rounded-full"
                          style={{
                            background: group.currentMonthRaised ? 'var(--fin-pos-bg)' : 'var(--fin-warn-bg)',
                            color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)',
                            border: `1px solid ${group.currentMonthRaised ? 'var(--fin-pos-border)' : 'var(--fin-warn-border)'}`,
                          }}>
                          {group.currentMonthRaised ? 'Current month covered' : 'Current month not raised'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        ['Tracking month', monthLabel(retainerMonth)],
                        ['Month invoice #', monthRec?.['Invoice Number'] || 'Pending update'],
                        ['Raised by', group.raisedBy || '—'],
                        ['Month remark', monthRec?.['Remark'] || '—'],
                      ].map(([lbl, val]) => (
                        <div key={lbl} className="card p-3">
                          <p className="label">{lbl}</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{val}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="label mb-2">Month Timeline</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                        {group.timeline.map(item => (
                          <button key={item.key} type="button"
                            onClick={() => setRetainerMonth(item.key)}
                            className="min-w-0 rounded-xl p-3 text-left transition-all min-h-[72px]"
                            style={{
                              background: item.current ? 'var(--accent-dim)' : 'var(--bg-base)',
                              border: `1px solid ${item.active ? 'var(--accent)' : 'var(--card-border)'}`,
                              boxShadow: item.active ? '0 0 0 2px rgba(37,99,235,0.12)' : 'none',
                            }}>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <p className="text-[11px] font-semibold" style={{ color: item.current ? 'var(--accent)' : 'var(--text-2)' }}>
                                {item.label}
                              </p>
                              {item.current && <span className="text-[9px] font-bold" style={{ color: 'var(--accent)' }}>NOW</span>}
                            </div>
                            <MonthStatusPill status={item.status} active={item.active} />
                            <p className="text-[10px] mt-2 truncate" style={{ color: 'var(--text-3)' }}>
                              {item.record?.fields?.['Invoice Number'] || 'No record'}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="label mb-2">Monthly Records</p>
                      <div className="space-y-2">
                        {group.timeline.map(item => {
                          const rec = item.record
                          const f = rec?.fields || {}
                          const key = `${item.key}-${group.project}`
                          return (
                            <div key={key} className="rounded-xl p-3 flex items-center justify-between gap-3"
                              style={{
                                background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                              }}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                  <MonthStatusPill status={item.status} active={item.active} />
                                </div>
                                <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                  {rec
                                    ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                    : 'No record created for this month yet'}
                                </p>
                              </div>
                              <div className="flex gap-2 flex-shrink-0 flex-wrap">
                                {rec ? (
                                  <button onClick={() => openView(rec)}
                                    className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                    View
                                  </button>
                                ) : item.key === retainerMonth ? (
                                  <>
                                    <button onClick={() => openInvoiceRequestForm(group, item.key)}
                                      className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      Open request form
                                    </button>
                                    <button onClick={() => openRetainerRecordForm(group, item.key)}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      Record raised invoice
                                    </button>
                                    <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                                      {busyPause ? 'Pausing…' : 'Pause month'}
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => setRetainerMonth(item.key)}
                                    className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                    Track month
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {group.description && (
                      <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)', border: '1px solid var(--card-border)' }}>
                        <p className="label">Template Note</p>
                        <p className="text-sm" style={{ color: 'var(--text-2)' }}>{group.description}</p>
                      </div>
                    )}

                    {missing && (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                          className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                          Open invoice request form
                        </button>
                        <button onClick={() => openRetainerRecordForm(group, retainerMonth)}
                          className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                          Record already raised invoice
                        </button>
                        <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                          className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                          {busyPause ? 'Pausing…' : 'Pause month'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </section>
      )}

      {workspace === 'invoices' && (
      <>
      {/* ── Project Snapshot ── */}
      {projectSummaryCards.length > 0 && (
        <ExecutivePanel title="Project-linked billing" subtitle="Project cards behave as filters and surface raised, received, and open value at a glance.">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Click any project card to filter the invoice list.</p>
            </div>
            {projectFilter && (
              <button onClick={() => { setProjectFilter(''); updateFilterParam('project', '') }}
                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                <X size={11} />Clear project filter
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {projectSummaryCards.map(({ project, metrics }) => {
              const active = projectFilter === project
              return (
                <button key={project} type="button"
                  onClick={() => {
                    const next = active ? '' : project
                    setProjectFilter(next)
                    updateFilterParam('project', next)
                  }}
                  className="rounded-xl p-4 text-left transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.10)' : 'var(--shadow-sm)',
                  }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                    </div>
                    {active && <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 mt-4">
                    <div>
                      <p className="label">Raised</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(metrics.raised)}</p>
                    </div>
                    <div>
                      <p className="label">Received</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(metrics.received)}</p>
                    </div>
                    <div>
                      <p className="label">Open</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(metrics.outstanding)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      )}

      {/* ── Filter bar ── */}
      <ExecutivePanel title="Filters and search" subtitle="Owner, overdue band, month, category, docs, and advanced rules follow one unified filter pattern.">
        <div className="space-y-2">
        <ExecutiveFilterBar className="executive-filter-bar-toolbar">
          <div className="executive-search relative flex-1 min-w-[140px] sm:min-w-[220px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={e => {
              setSearch(e.target.value)
            }}
              placeholder="Search invoice #, project, description…"
              className="input pl-8 py-1.5 text-xs"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-1)' }} />
          </div>
          <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
            className={clsx('btn-icon flex items-center justify-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
            style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
            <Filter size={13} />
            <span className="text-xs">Filters</span>
            {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
          </button>
          {hasFilters && (
            <button onClick={() => {
              setStatusFilter('')
              updateFilterParam('status', '')
              setProjectFilter('')
              updateFilterParam('project', '')
              setCategoryFilter('')
              setRaisedByFilter('')
              setMonthFilter('')
              setDateFieldFilter('Raised Date')
              setDateFrom('')
              setDateTo('')
              setAgingBandFilter('')
              setBillingFilter('all')
              setOverdueOnly(false)
              setHasDocsOnly(false)
              setFollowupDueOnly(false)
              setSearch('')
              setFilterConditions([])
            }}
              className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
              <X size={11} />Clear
            </button>
          )}
          <ExecutiveChip accent>{records.length} result{records.length !== 1 ? 's' : ''}</ExecutiveChip>
        </ExecutiveFilterBar>

        {showFilters && (
          <div className="filter-expanded-panel flex flex-wrap gap-2 animate-slide-down">
            {/* Billing type */}
            <div className="inline-flex items-center p-0.5 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[['all','All'],['project','Projects'],['retainer','Retainers']].map(([v, l]) => (
                <button key={v} onClick={() => setBillingFilter(v)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={billingFilter === v
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {l}
                </button>
              ))}
            </div>
            {/* Project — server-side */}
            <FilterSelect
              value={projectFilter}
              onChange={(value) => {
                setProjectFilter(value)
                updateFilterParam('project', value)
              }}
              options={projectOptions}
              placeholder="All projects"
              icon={User}
              width={150}
            />
            <FilterSelect
              value={monthFilter}
              onChange={setMonthFilter}
              options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
              placeholder="All months"
              icon={CalendarDays}
              width={150}
            />
            <FilterSelect
              value={dateFieldFilter}
              onChange={setDateFieldFilter}
              options={[
                { value: 'Raised Date', label: 'Raised Date' },
                { value: 'Cleared Date', label: 'Cleared Date' },
                { value: 'Next followup', label: 'Next Follow-up' },
              ]}
              placeholder="Date field"
              icon={CalendarDays}
              width={160}
              clearable={false}
            />
            <div className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
            </div>
            <FilterSelect
              value={agingBandFilter}
              onChange={setAgingBandFilter}
              options={Object.keys(agingBuckets).map(bucket => ({ value: bucket, label: bucket }))}
              placeholder="All aging"
              icon={CalendarClock}
              width={135}
            />
            {/* Category — client-side */}
            <FilterSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              placeholder="All categories"
              icon={Tag}
              width={155}
            />
            {/* Raised By — client-side */}
            <FilterSelect
              value={raisedByFilter}
              onChange={setRaisedByFilter}
              options={raisedByOptions}
              placeholder="Anyone"
              icon={User}
              width={135}
            />
            <button
              onClick={() => setOverdueOnly(v => !v)}
              className="btn-ghost"
              style={{
                fontSize: '0.75rem',
                padding: '0.375rem 0.625rem',
                color: overdueOnly ? 'var(--fin-negative)' : 'var(--text-2)',
                borderColor: overdueOnly ? 'var(--fin-neg-border)' : 'var(--card-border)',
                background: overdueOnly ? 'var(--fin-neg-bg)' : 'var(--card-bg)',
              }}>
              Pending / Outstanding
            </button>
            <button
              onClick={() => setFollowupDueOnly(v => !v)}
              className="btn-ghost"
              style={{
                fontSize: '0.75rem',
                padding: '0.375rem 0.625rem',
                color: followupDueOnly ? 'var(--fin-warning)' : 'var(--text-2)',
                borderColor: followupDueOnly ? 'var(--fin-warn-border)' : 'var(--card-border)',
                background: followupDueOnly ? 'var(--fin-warn-bg)' : 'var(--card-bg)',
              }}>
              Follow-up due
            </button>
            <button
              onClick={() => setHasDocsOnly(v => !v)}
              className="btn-ghost"
              style={{
                fontSize: '0.75rem',
                padding: '0.375rem 0.625rem',
                color: hasDocsOnly ? 'var(--accent)' : 'var(--text-2)',
                borderColor: hasDocsOnly ? 'var(--accent-soft)' : 'var(--card-border)',
                background: hasDocsOnly ? 'var(--accent-dim)' : 'var(--card-bg)',
              }}>
              Has docs
            </button>
            {/* Divider */}
            <div className="w-full" style={{ borderTop: '1px solid var(--glass-border)', margin: '0.25rem 0' }} />
            {/* Advanced filter builder */}
            <div className="w-full">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Advanced filters
              </p>
              <FilterBuilder
                fields={INVOICE_FIELDS}
                records={allRecords}
                getFieldValue={r => r.fields ?? {}}
                conditions={filterConditions}
                onChange={setFilterConditions}
                label="Add condition"
              />
            </div>
          </div>
        )}
      </div>
      </ExecutivePanel>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
          style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
          <AlertTriangle size={13} className="shrink-0" />
          {error}
          {/not found/i.test(error) && <span style={{ color: 'var(--text-3)' }}>— backend is deploying, auto-retrying</span>}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── Mobile card list (sm-down) ── */}
      <div className="invoice-mobile-stack md:hidden">
        {loading && !listData
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="skeleton h-3 w-2/5 mb-3 rounded" />
                <div className="skeleton h-5 w-3/5 rounded" />
              </div>
            ))
          : records.length === 0
            ? <div className="card text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                No invoices found.{' '}
                <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline font-medium">Create one</button>
              </div>
            : records.map(r => {
                const f = r.fields || {}
                const outstanding = Number(f['Outstanding Amount'] || 0)
                const refs = parseAttachments(f['Reference'])
                const pdfs = parseAttachments(f['Invoice PDF'])
                const allFiles = [...refs, ...pdfs]
                return (
                  <button key={r.id} onClick={() => openView(r)}
                    className="invoice-mobile-card w-full text-left animate-slide-up">
                    {/* Top: invoice # + status */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>
                          Invoice
                        </p>
                        <p className="font-mono text-[13px] font-bold truncate mt-1" style={{ color: 'var(--text-1)' }}>
                          {f['Invoice Number'] || '—'}
                        </p>
                        <p className="text-[11px] truncate mt-1" style={{ color: 'var(--text-3)' }}>
                          {f['Project'] || '—'} {f['Category'] ? `· ${f['Category']}` : ''}
                        </p>
                      </div>
                      <StatusPill status={f['Payment Status']} />
                    </div>
                    {f['Raised By'] && (
                      <div className="invoice-mobile-meta mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>
                          <User size={8} />{f['Raised By']}
                        </span>
                        {f['Milestone'] && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>{f['Milestone']}</span>}
                      </div>
                    )}
                    {/* Middle: amounts */}
                    <div className="invoice-mobile-summary my-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Amount</p>
                        <p className="font-bold tabular-nums text-base mt-1" style={{ color: 'var(--text-1)' }}>
                          {fmt(f['Amount Raised'])}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                        <p className="font-bold tabular-nums text-sm mt-1" style={{ color: outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                          {outstanding > 0 ? fmt(outstanding) : 'Clear'}
                        </p>
                      </div>
                    </div>
                    {/* Bottom: meta */}
                    <div className="invoice-mobile-foot">
                      <span className="tabular-nums">{fmtDate(f['Raised Date'])}</span>
                      <div className="invoice-mobile-foot-right">
                        {f['Next followup'] && (
                          <span className="flex items-center gap-0.5 tabular-nums" style={{ color: 'var(--fin-warning)' }}>
                            <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                          </span>
                        )}
                        {allFiles.length > 0 && (
                          <span className="flex items-center gap-0.5"><FileText size={10} />{allFiles.length}</span>
                        )}
                        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                      </div>
                    </div>
                  </button>
                )
              })
        }
      </div>

      {/* ── Desktop table (md+) ── */}
      <div className="data-table-shell hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th className="tbl-head"><SortLabel col="Invoice Number">Invoice #</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Project">Project</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Category">Category</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Milestone">Milestone</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Raised By">Raised By</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Raised Date">Raised</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Amount Raised">Amount</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Amount with Tax">GST Total</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Amount Received">Received</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Outstanding Amount">Outstanding</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Payment Status">Status</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Agening (Days)">Aging</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Next followup">Next Followup</SortLabel></th>
                <th className="tbl-head">Docs</th>
                <th className="tbl-head" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {loading && !listData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={15} className="px-4 py-14 text-center" style={{ color: 'var(--text-3)' }}>
                      <div className="flex flex-col items-center gap-2">
                        <Receipt size={28} style={{ opacity: 0.3 }} />
                        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No invoices found</p>
                        <p className="text-xs">Adjust your filters or{' '}
                          <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline">create one</button>
                        </p>
                      </div>
                    </td></tr>
                  : records.map(r => {
                      const f = r.fields || {}
                      const assoc = r.association
                      const related = assoc?.related_counts?.project || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      const refs = parseAttachments(f['Reference'])
                      const pdfs = parseAttachments(f['Invoice PDF'])
                      const allFiles = [...refs, ...pdfs]

                      return (
                        <tr key={r.id} className="tbl-row" style={{ cursor: 'pointer' }}
                          onClick={() => openView(r)}
                          onMouseEnter={e => e.currentTarget.style.borderLeft = '2px solid var(--accent)'}
                          onMouseLeave={e => e.currentTarget.style.borderLeft = ''}>

                          <td className="tbl-cell">
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || '—'}
                            </span>
                          </td>
                          <td className="tbl-cell">
                            <div className="min-w-0">
                              <span className="text-xs font-medium block truncate" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span>
                              {assoc?.project?.name && (
                                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                  <Briefcase size={9} />
                                  {related.status || 0} status · {related.projects || 0} project
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span>
                          </td>
                          <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Milestone'] || '—'}</span></td>
                          <td className="tbl-cell">
                            {f['Raised By']
                              ? <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                  <User size={9} />{f['Raised By']}
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          <td className="tbl-cell">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>
                              {fmt(f['Amount Raised'])}
                            </span>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
                              {fmt(f['Amount with Tax'])}
                            </span>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>
                              {fmt(f['Amount Received'])}
                            </span>
                          </td>
                          <td className="tbl-cell">
                            {outstanding > 0
                              ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</span>
                              : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          <td className="tbl-cell">
                            <StatusPill status={f['Payment Status']} />
                          </td>
                          <td className="tbl-cell">
                            <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                          </td>
                          <td className="tbl-cell">
                            {f['Next followup']
                              ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>

                          {/* Attachment thumbs */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                            {allFiles.length > 0 ? (
                              <div className="flex items-center gap-1">
                                {allFiles.slice(0, 2).map((a, i) => (
                                  <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />
                                ))}
                                {allFiles.length > 2 && (
                                  <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>
                                    +{allFiles.length - 2}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
                            )}
                          </td>

                          {/* View action */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => openView(r)}
                              className="btn-ghost flex items-center gap-1.5"
                              style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}
                              aria-label={`View ${f['Invoice Number']}`}>
                              <Eye size={12} />
                              <span className="text-[11px] font-semibold">View</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })
              }
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}

      {/* ── Drawers — rendered via portal to escape overflow/transform stacking contexts ── */}
      {drawer?.mode === 'view' && createPortal(
        <InvoiceDetail
          invoice={drawer.invoice}
          onClose={closeDrawer}
          onLink={() => { setAssociationRecord(drawer.invoice); closeDrawer() }}
          onEdit={() => isEditor && setDrawer({ mode: 'edit', invoice: drawer.invoice })}
          isEditor={isEditor}
          onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })}
        />,
        document.body
      )}
      {associationRecord && createPortal(
        <AssociationLinkModal
          sourceTable="invoices"
          record={associationRecord}
          onClose={() => setAssociationRecord(null)}
          onSaved={() => { setAssociationRecord(null); refresh() }}
        />,
        document.body
      )}
      {isEditor && (drawer?.mode === 'new' || drawer?.mode === 'edit') && createPortal(
        <InvoiceDrawer
          invoice={drawer.mode === 'edit' ? drawer.invoice : null}
          prefill={drawer.mode === 'new' ? drawer.prefill : null}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          options={formOptions}
        />,
        document.body
      )}
      {isEditor && shareModal && (
        <ShareLinkModal
          resourceType="invoices"
          selectedRecords={records}
          title={`Invoices · ${statusFilter || projectFilter || 'Current View'}`}
          recordLabel="invoice"
          enableLiveMode
          viewConfig={{
            type: 'list',
            filterProject: projectFilter || '',
            filterCategory: categoryFilter || '',
            filterStatus: statusFilter || '',
            search,
            columns: ['Invoice Number', 'Project', 'Category', 'Payment Status', 'Amount Raised', 'Amount Received', 'Raised Date', 'Next followup', 'Remark'],
          }}
          onClose={() => setShareModal(false)}
        />
      )}
      {isEditor && manageModal && (
        <ManageSharedLinksModal
          resourceType="invoices"
          recordLabel="invoice"
          currentViewConfig={{
            type: 'list',
            filterProject: projectFilter || '',
            filterCategory: categoryFilter || '',
            filterStatus: statusFilter || '',
            search,
            columns: ['Invoice Number', 'Project', 'Category', 'Payment Status', 'Amount Raised', 'Amount Received', 'Raised Date', 'Next followup', 'Remark'],
          }}
          visibleRecords={records}
          onClose={() => setManageModal(false)}
        />
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
    </ExecutiveShell>
  )
}
