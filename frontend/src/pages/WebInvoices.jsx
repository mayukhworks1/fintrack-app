import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import Drawer from '../components/Drawer'
import {
  Globe, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, User, Tag, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock, Receipt,
  Sun, Moon, LogOut, Check, Loader2, Upload, Paperclip,
  ChevronLeft, ChevronRight, Briefcase, Repeat2,
  Users, HelpCircle, Mail, BookOpen, X as XIcon,
  LayoutDashboard, Activity, ArrowRight, ShieldAlert,
  Download, Sparkles, BarChart3, WifiOff, Printer
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { ProjectsWorkspace } from './WebProjects'
import TaxLedger from './TaxLedger'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { useAvatarSrc } from '../hooks/useAvatarSrc'
import clsx from 'clsx'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'
import MonthlyCollectionsChart from '../components/MonthlyCollectionsChart'

/* ── Constants ── */
// All picklist options are loaded live from Teable — no hardcoded fallbacks
const DEFAULT_PICKLISTS = {
  Project:     [],
  Category:    [],
  Milestone:   [],
  'Raised By': [],
}
const STATUSES = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
  currency: 'RS',
}

const WEB_INVOICE_SCALAR_FORM_KEYS = [
  'invoice_number',
  'project',
  'category',
  'description',
  'milestone',
  'raised_by',
  'raised_date',
  'cleared_date',
  'amount_raised',
  'amount_with_tax',
  'amount_received',
  'payment_status',
  'remark',
  'next_followup',
  'currency',
]

const normalizeWebInvoiceScalarForm = (form) => WEB_INVOICE_SCALAR_FORM_KEYS.reduce((acc, key) => {
  const value = form?.[key]
  acc[key] = value == null ? '' : String(value).trim()
  return acc
}, {})

// Currency helpers
const CURRENCY_SYMBOLS = { RS: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' }
function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || (code ? `${code} ` : '₹')
}
function fmtCurrency(n, currency) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  const sym = currencySymbol(currency || 'RS')
  const formatted = Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${sym}${formatted}`
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

const invoiceAmountParts = (fields = {}) => {
  const base = Number(fields['Amount Raised'] || 0)
  const gross = Number(fields['Amount with Tax'] || base)
  const received = Number(fields['Amount Received'] || 0)
  const status = String(fields['Payment Status'] || '').trim()
  const isPaid = status === 'Paid'
  const gst = Math.max(0, gross - base)
  const variance = Math.max(0, gross - received)
  return {
    base, gross, gst, received,
    deduction: isPaid ? variance : 0,
    outstanding: isPaid || status === 'Cancelled' ? 0 : variance,
    isPaid,
  }
}
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

function getRetainerCategoryOption(options = []) {
  return options.find(isRetainerCategory) || 'Development- Retainer'
}

function getProjectCategoryOption(options = [], current = '') {
  if (current && !isRetainerCategory(current)) return current
  const explicit = options.find(o => /^project$/i.test(String(o || '').trim()))
  if (explicit) return explicit
  return options.find(o => !isRetainerCategory(o)) || ''
}

const buildWebInvoiceScalarPayload = (form, { isEdit = false, paymentOnly = false } = {}) => ({
  invoice_number:   form.invoice_number,
  project:          form.project,
  category:         form.category,
  description:      form.description,
  milestone:        form.milestone,
  raised_by:        form.raised_by,
  payment_status:   form.payment_status,
  remark:           form.remark,
  currency:         form.currency,
  amount_raised:    form.amount_raised !== '' ? Number(form.amount_raised) : undefined,
  amount_with_tax:  form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
  amount_received:  form.amount_received !== '' ? Number(form.amount_received) : undefined,
  raised_date:      form.raised_date ? `${form.raised_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  cleared_date:     form.cleared_date ? `${form.cleared_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  next_followup:    paymentOnly
    ? null
    : form.next_followup ? `${form.next_followup}T00:00:00.000Z` : (isEdit ? null : undefined),
  // Always include attachment arrays so removals (empty list) are persisted to Teable.
  reference:        Array.isArray(form.reference)   ? form.reference   : [],
  invoice_pdf:      Array.isArray(form.invoice_pdf) ? form.invoice_pdf : [],
})

function parseIsoDate(value) {
  const d = new Date(value || '')
  return Number.isNaN(d.getTime()) ? null : d
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

function sortByRaisedDateDesc(records = []) {
  return [...records].sort((a, b) => {
    const da = parseIsoDate(a.fields?.['Raised Date'])?.getTime() || 0
    const db = parseIsoDate(b.fields?.['Raised Date'])?.getTime() || 0
    return db - da
  })
}

// Shows profile pic + email for a "Raised By" value. avatarMap = {email: {avatar_url, name}}
function RaisedByBadge({ email, avatarMap = {}, size = 16, className = '' }) {
  const entry = avatarMap[email?.toLowerCase()] || {}
  const resolvedSrc = useAvatarSrc(entry.avatar_url || null)
  if (!email) return null
  const label = entry.name || email
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt=""
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-dim)', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', fontSize: size * 0.5, color: 'var(--accent)', fontWeight: 600,
        }}>
          {label[0].toUpperCase()}
        </span>
      )}
      <span style={{ fontSize: '0.75em' }}>{label}</span>
    </span>
  )
}

function MonthStatusPill({ status, active }) {
  const map = {
    Raised:   { bg: 'var(--fin-pos-bg)',  fg: 'var(--fin-positive)', border: 'var(--fin-pos-border)' },
    Pending:  { bg: 'var(--fin-warn-bg)', fg: 'var(--fin-warning)',  border: 'var(--fin-warn-border)' },
    Paused:   { bg: 'var(--fin-neg-bg)',  fg: 'var(--fin-negative)', border: 'var(--fin-neg-border)' },
    Missing:  { bg: 'var(--accent-dim)',  fg: 'var(--accent)',       border: 'var(--accent-soft)' },
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

const KPI_PALETTE = [
  { bg: 'var(--kpi-1-bg)', fg: 'var(--kpi-1-fg)' },
  { bg: 'var(--kpi-2-bg)', fg: 'var(--kpi-2-fg)' },
  { bg: 'var(--kpi-3-bg)', fg: 'var(--kpi-3-fg)' },
  { bg: 'var(--kpi-4-bg)', fg: 'var(--kpi-4-fg)' },
  { bg: 'var(--kpi-5-bg)', fg: 'var(--kpi-5-fg)' },
]

/* ── Helpers ── */
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
    return cell.map(a => ({ name: a.name || a.filename || 'Attachment', url: a.url || a.presignedUrl || '', mime: a.mimeType || a.mimetype || '' }))
  }
  const parts = String(cell).split(/\s+/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) out.push({ name: decodeURIComponent(parts[i].replace(/_x20_/g, ' ')).replace(/_x2D_/g, '-'), url: parts[i + 1], mime: '' })
  }
  return out
}

const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}
const isPdf = (a) => a.mime === 'application/pdf' || /\.pdf(\?|$)/i.test(a.url) || a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ── */
const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
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

function AgingBadge({ days, status }) {
  // Only show aging for Pending invoices — Paid/Cancelled don't need it
  if (status && status !== 'Pending') return <span style={{ color: 'var(--text-3)' }}>—</span>
  const d = Number(days)
  if (!d && d !== 0) return <span style={{ color: 'var(--text-3)' }}>—</span>
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

function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
  const palette = KPI_PALETTE[tone % KPI_PALETTE.length]
  const color = semantic === 'positive' ? 'var(--fin-positive)' : semantic === 'warning' ? 'var(--fin-warning)' : semantic === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3 animate-scale-in hover:shadow-md transition-shadow">
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

function DashboardMetric({ label, value, sub, icon: Icon, tone, accent, compact = false, iconSlot = true }) {
  const display = value == null ? '—' : String(value)
  const currencyMatch = display.match(/^([^\d-]+)([\d,.\-]+)$/)
  return (
    <div
      className="rounded-2xl p-4 transition-shadow min-w-0"
      style={{
        background: tone,
        border: '1px solid color-mix(in srgb, var(--card-border) 78%, transparent)',
        boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>{label}</p>
          {currencyMatch ? (
            <div
              className="mt-2 inline-flex items-end gap-1 font-bold tracking-tight min-w-0"
              style={{ color: accent || 'var(--text-1)' }}>
              <span
                className="flex-shrink-0"
                style={{
                  fontSize: compact ? '0.95rem' : '1.05rem',
                  lineHeight: 1,
                  transform: 'translateY(-1px)',
                }}>
                {currencyMatch[1]}
              </span>
              <span
                className="tabular-nums min-w-0"
                style={{
                  fontSize: compact ? 'clamp(1rem, 1.2vw, 1.35rem)' : 'clamp(1.45rem, 1.95vw, 2.05rem)',
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                }}>
                {currencyMatch[2]}
              </span>
            </div>
          ) : (
            <p
              className="mt-2 font-bold tracking-tight leading-none tabular-nums"
              style={{
                color: accent || 'var(--text-1)',
                fontSize: compact ? 'clamp(1rem, 1.2vw, 1.35rem)' : 'clamp(1.15rem, 1.7vw, 1.9rem)',
                whiteSpace: 'nowrap',
              }}>
              {display}
            </p>
          )}
          {sub && <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{sub}</p>}
        </div>
        {iconSlot && Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-2xl"
            style={{
              width: compact ? 40 : 48,
              height: compact ? 40 : 48,
              background: 'rgba(255,255,255,0.78)',
              color: accent || 'var(--accent)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
            }}>
            <Icon size={compact ? 18 : 21} />
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardSignal({ eyebrow, title, body, icon: Icon, tone = 'var(--bg-layer)', accent = 'var(--accent)' }) {
  return (
    <div
      className="rounded-2xl p-4 min-w-0"
      style={{
        background: tone,
        border: '1px solid color-mix(in srgb, var(--card-border) 82%, transparent)',
        boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>{eyebrow}</p>
          <p className="mt-2 text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{title}</p>
          {body && <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>}
        </div>
        {Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-2xl"
            style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.76)', color: accent }}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  )
}

function SelectInput({ value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="input appearance-none" style={{ paddingRight: '1.75rem', width: 'auto' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

/**
 * ProjectInput — free-text input with datalist autocomplete.
 * Works even when the options list is empty (user can always type).
 * Used for the Project field which is a plain text field in Teable,
 * not a single-select — so PicklistSelect (which renders a <select>)
 * shows blank when options haven't loaded yet.
 */
function ProjectInput({ value, onChange, options = [], placeholder = 'Type or select project…' }) {
  const listId = 'wb-project-datalist'
  return (
    <div className="relative">
      <input
        type="text"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-full"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

/* Picklist select with inline "add new option" for Teable-backed fields */
function PicklistSelect({
  fieldName,
  value,
  onChange,
  options,
  onOptionsUpdate,
  placeholder = 'Select…',
  canAddOptions = true,
  onPermissionError,
}) {
  const [adding, setAdding]   = useState(false)
  const [newVal, setNewVal]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [addErr, setAddErr]   = useState('')
  const inputRef              = useRef(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  async function handleAdd(e) {
    e.preventDefault()
    const trimmed = newVal.trim()
    if (!trimmed) return
    setSaving(true); setAddErr('')
    try {
      const res = await api.webInvoices.picklists.add(fieldName, trimmed)
      onOptionsUpdate(fieldName, res.options)
      onChange(trimmed)
      setAdding(false); setNewVal('')
    } catch (err) {
      const msg = err.message || 'Failed to add'
      setAddErr(msg)
      if (/cannot change dropdown schema|required.*field\/schema edit permission/i.test(msg)) {
        onPermissionError?.(msg)
        setAdding(false)
        setNewVal('')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!canAddOptions) {
    return (
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <select value={value} onChange={e => onChange(e.target.value)}
            className="input appearance-none w-full" style={{ paddingRight: '1.75rem' }}>
            <option value="">{placeholder}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
        </div>
        <button type="button" disabled className="btn-icon flex-shrink-0 opacity-50 cursor-not-allowed"
          title={`New ${fieldName} options must be added in Teable because this token cannot edit schema`}
          aria-label={`Add ${fieldName} disabled`}>
          <Plus size={12} />
        </button>
      </div>
    )
  }

  if (adding) {
    return (
      <div className="space-y-1">
        <form onSubmit={handleAdd} className="flex gap-1">
          <input ref={inputRef}
            className="input flex-1 text-xs" style={{ height: 32 }}
            value={newVal} onChange={e => setNewVal(e.target.value)}
            placeholder={`New ${fieldName.toLowerCase()}…`}
            disabled={saving} />
          <button type="submit" disabled={saving || !newVal.trim()} className="btn-primary flex-shrink-0"
            style={{ padding: '0 0.5rem', height: 32 }} aria-label="Confirm add">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewVal(''); setAddErr('') }}
            className="btn-icon flex-shrink-0" style={{ height: 32, width: 32 }} aria-label="Cancel">
            <X size={11} />
          </button>
        </form>
        {addErr && <p className="text-[10px]" style={{ color: '#f87171' }}>{addErr}</p>}
      </div>
    )
  }

  return (
    <div className="flex gap-1.5">
      <div className="relative flex-1">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="input appearance-none w-full" style={{ paddingRight: '1.75rem' }}>
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
      </div>
      <button type="button" onClick={() => setAdding(true)} className="btn-icon flex-shrink-0"
        title={`Add new ${fieldName} (requires Teable field-edit permission)`} aria-label={`Add new ${fieldName}`}>
        <Plus size={12} />
      </button>
    </div>
  )
}

/* ── Attachment upload field (for Reference + Invoice PDF in form drawer) ── */
function AttachmentUploadField({ label, fieldKey, value, onChange, recordId, ensureRecord }) {
  const [uploading,  setUploading]  = useState(false)
  const [uploadErr,  setUploadErr]  = useState('')
  const [dragOver,   setDragOver]   = useState(false)
  const fileInputRef = useRef(null)
  const attachments  = Array.isArray(value) ? value : []
  const fieldNameMap = { invoice_pdf: 'Invoice PDF', reference: 'Reference' }

  async function processFiles(files) {
    if (!files?.length) return
    setUploading(true); setUploadErr('')
    try {
      const resolvedRecordId = recordId || await ensureRecord?.()
      if (!resolvedRecordId) throw new Error('Could not prepare invoice record for upload')
      let latest = attachments
      for (const file of files) {
        const result = await api.webInvoices.upload(resolvedRecordId, fieldNameMap[fieldKey], file)
        latest = result?.attachments || latest
      }
      onChange(latest)
    } catch (e) {
      setUploadErr(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  function removeAt(i) {
    onChange(attachments.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Paperclip size={10} style={{ color: 'var(--text-3)' }} />{label}
      </label>

      {/* Existing / just-uploaded files */}
      {attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {attachments.map((a, i) => {
            const norm = { name: a.name || a.filename || 'Attachment', url: a.url || a.presignedUrl || '', mime: a.mimeType || '' }
            return (
              <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {isPdf(norm)
                  ? <FileText size={13} className="flex-shrink-0" style={{ color: '#f87171' }} />
                  : isImage(norm)
                    ? <ImageIcon size={13} className="flex-shrink-0" style={{ color: '#60a5fa' }} />
                    : <Paperclip size={13} className="flex-shrink-0" style={{ color: 'var(--text-3)' }} />}
                <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-2)' }}>{norm.name}</span>
                {norm.url && (
                  <a href={norm.url} target="_blank" rel="noopener noreferrer" title="Open"
                    className="flex-shrink-0 btn-icon" style={{ width: 22, height: 22 }}
                    onClick={e => e.stopPropagation()}>
                    <ExternalLink size={10} />
                  </a>
                )}
                <button type="button" onClick={() => removeAt(i)} className="flex-shrink-0 btn-icon"
                  style={{ width: 22, height: 22 }} aria-label="Remove attachment">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Drop zone / upload button */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer transition-all py-4 select-none"
        style={{
          borderColor: dragOver ? 'var(--accent)' : 'var(--glass-border)',
          background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--glass-bg)',
          opacity: uploading ? 0.7 : 1,
        }}
        aria-label={`Upload ${label}`}>
        {uploading
          ? <><Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Uploading…</span></>
          : <><Upload size={16} style={{ color: 'var(--text-3)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {recordId ? 'Click or drag to upload · PDF, images' : 'Click to save draft and upload · PDF, images'}
              </span></>}
        <input ref={fileInputRef} type="file" multiple className="hidden"
          id={`upload-${fieldKey}`}
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={e => processFiles(Array.from(e.target.files || []))} />
      </div>

      {uploadErr && (
        <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#f87171' }}>
          <AlertTriangle size={10} />{uploadErr}
        </p>
      )}
    </div>
  )
}

/* ── Detail panel ── */
function InvoiceDetail({ open, invoice, onClose, onEdit, onRecordPayment, isEditor, onPreview, avatarMap = {} }) {
  const f = (open && invoice) ? (invoice.fields || {}) : {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const cur = f['Currency'] || 'RS'

  const actions = open && invoice ? (
    <>
      {isEditor && f['Payment Status'] === 'Pending' && (
        <button onClick={onRecordPayment} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          <CheckCircle2 size={12} />Record Payment
        </button>
      )}
      <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Edit</button>
    </>
  ) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <span>{f['Invoice Number'] || '—'}</span>
          {open && invoice && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
              {currencySymbol(cur)}{cur}
            </span>
          )}
        </div>
      }
      subtitle={[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
      width={500}
      accent={false}
      actions={actions}
      footer={
        <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
      }
    >
      <div className="p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                {f['Speed']}
              </span>
            )}
            {f['Raised By'] && (
              <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
              </span>
            )}
          </div>

          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{f['Description']}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],      'var(--text-1)'],
              ['With GST',        f['Amount with Tax'],    'var(--text-1)'],
              ['Received',        f['Amount Received'],    'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'], outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmtCurrency(val, cur)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Raised',        fmtDateFull(f['Raised Date'])],
              ['Cleared',       fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']   != null ? `${f['Days To Clear']} days`   : '—'],
              ['Aging',         f['Agening (Days)']  != null ? `${f['Agening (Days)']} days`  : '—'],
              ['Milestone',     f['Milestone']       || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

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
    </Drawer>
  )
}

/* ── Form drawer ── */
function FieldRow({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function InvoiceDrawer({
  open,
  invoice,
  draft,
  paymentOnly = false,
  onClose,
  onSaved,
  onDeleted,
  picklists,
  onOptionsUpdate,
  canEditPicklists,
  onPicklistPermissionError,
}) {
  const { userEmail, authRole, isEmailAuth, hasPerm } = useAuth()
  const isEdit = Boolean(invoice?.id)
  const ownerLocked = Boolean(isEmailAuth && userEmail && !['superadmin', 'admin', 'manager', 'finance', 'web_admin'].includes(authRole))
  const canDelete = hasPerm('module.invoices.delete')
  const canCreate = hasPerm('module.invoices.create')
  const canEditInvoice = hasPerm('module.invoices.edit')
  const canPayment = hasPerm('module.invoices.payment')
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error,      setError]      = useState('')
  const [workingRecordId, setWorkingRecordId] = useState(invoice?.id || null)
  const [categoryLocked, setCategoryLocked] = useState(false)
  const [parsing,      setParsing]      = useState(false)
  const [parseError,   setParseError]   = useState('')
  const [parseNote,    setParseNote]    = useState('')
  const [parseApplied, setParseApplied] = useState([])
  const parseFileRef = useRef(null)
  const paidSelected = form.payment_status === 'Paid'
  const hasPaymentAttempt = form.payment_status === 'Paid' || String(form.amount_received).trim() || form.cleared_date
  const hasFormChanges = useMemo(
    () => JSON.stringify(normalizeWebInvoiceScalarForm(form)) !== JSON.stringify(normalizeWebInvoiceScalarForm(initialForm)),
    [form, initialForm]
  )
  const retainerSelected = isRetainerCategory(form.category)
  const retainerCategoryOption = getRetainerCategoryOption(picklists?.Category || [])
  const projectCategoryOption = getProjectCategoryOption(picklists?.Category || [], form.category)
  const currentRecordId = invoice?.id || workingRecordId

  useEffect(() => {
    const ownerPatch = ownerLocked ? { raised_by: userEmail } : {}
    if (!invoice && !draft) {
      const next = { ...EMPTY_FORM, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    if (!invoice && draft) {
      const next = {
        ...EMPTY_FORM,
        ...draft,
        ...ownerPatch,
      }
      setForm(next)
      setInitialForm(next)
      return
    }
    const f = invoice.fields || {}
    const next = {
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
      category:        f['Category']        || '',
      description:     f['Description']     || '',
      milestone:       f['Milestone']       || '',
      raised_by:       ownerLocked ? userEmail : (f['Raised By'] || ''),
      raised_date:     f['Raised Date']   ? String(f['Raised Date']).slice(0, 10)   : '',
      cleared_date:    f['Cleared Date']  ? String(f['Cleared Date']).slice(0, 10)  : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      currency:        f['Currency']        || 'RS',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      reference:       Array.isArray(f['Reference'])   ? f['Reference']   : [],
      invoice_pdf:     Array.isArray(f['Invoice PDF']) ? f['Invoice PDF'] : [],
      ...(draft || {}),
    }
    setForm(next)
    setInitialForm(next)
  }, [invoice, draft, ownerLocked, userEmail])

  useEffect(() => {
    setWorkingRecordId(invoice?.id || null)
    setCategoryLocked(Boolean(invoice?.id))
  }, [invoice?.id])

  const set  = k => v  => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev => setForm(f => ({ ...f, [k]: ev.target.value }))
  const setCategoryValue = (next) => {
    setCategoryLocked(true)
    setForm(f => ({ ...f, category: next }))
  }
  const setRetainerMode = (enabled, { force = true } = {}) => {
    const nextCategory = enabled ? retainerCategoryOption : getProjectCategoryOption(picklists?.Category || [], form.category)
    if (!force && categoryLocked) return
    setForm(f => ({
      ...f,
      category: nextCategory,
    }))
    if (force) setCategoryLocked(false)
  }

  useEffect(() => {
    if (!invoice?.id && draft?.category == null) {
      setRetainerMode(retainerSelected, { force: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retainerCategoryOption, projectCategoryOption, retainerSelected, invoice?.id, draft?.category])

  async function persistDraftRecord() {
    if (currentRecordId) return currentRecordId
    const paidDraftIncomplete = form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date)
    const payload = {
      ...buildWebInvoiceScalarPayload(form),
      payment_status:  paidDraftIncomplete ? 'Pending' : form.payment_status,
      remark: paidDraftIncomplete
        ? [form.remark, 'Draft created for attachment upload. Complete paid details before final save.'].filter(Boolean).join(' ')
        : form.remark,
    }
    const created = await api.webInvoices.create(payload)
    const createdId = created?.id
    if (!createdId) throw new Error('Invoice draft was created but no record id was returned')
    setWorkingRecordId(createdId)
    return createdId
  }

  async function handleSave() {
    if (isEdit && !paymentOnly && !hasFormChanges) {
      setError('')
      return
    }
    if (hasPaymentAttempt && form.payment_status !== 'Paid') {
      setError('Payment Status must be Paid when recording received amount or cleared date')
      return
    }
    if (hasPaymentAttempt && !String(form.amount_received).trim()) {
      setError('Amount received is required when status is Paid')
      return
    }
    if (hasPaymentAttempt && !form.cleared_date) {
      setError('Cleared date is required when status is Paid')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = buildWebInvoiceScalarPayload(form, { isEdit, paymentOnly })
      const saved = currentRecordId
        ? await api.webInvoices.update(currentRecordId, payload)
        : await api.webInvoices.create(payload)
      setInitialForm(form)
      onSaved(saved)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true)
    try { await api.webInvoices.delete(invoice.id); onDeleted(invoice.id) }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  async function handleParse(file) {
    if (!file) return
    setParsing(true); setParseError(''); setParseNote(''); setParseApplied([])
    try {
      const { fields } = await api.webInvoices.parse(file)
      const next = { ...form }
      const applied = []
      const MAP = {
        invoice_number: 'Invoice Number', project: 'Project', category: 'Category',
        description: 'Description', milestone: 'Milestone', raised_by: 'Raised By',
        raised_date: 'Raised Date', amount_raised: 'Amount Raised',
        amount_with_tax: 'Amount with Tax',
      }
      let filled = 0
      for (const [formKey, label] of Object.entries(MAP)) {
        const val = fields[formKey] ?? fields[label]
        if (val == null || val === '') continue
        const isEmpty = !next[formKey] || next[formKey] === ''
        const normalised = formKey.endsWith('_date') ? String(val).slice(0, 10) : val
        next[formKey] = String(normalised)
        applied.push({ key: formKey, label, value: String(normalised) })
        if (isEmpty) filled++
      }
      setForm(next)
      setParseApplied(applied)
      setParseNote(`AI filled ${filled} field${filled !== 1 ? 's' : ''} — please review`)
    } catch (e) {
      const msg = e.status === 400 ? e.message
                : e.status === 413 ? 'File too large (max 10 MB)'
                : e.message || 'AI parse failed — try a clearer image or PDF'
      setParseError(msg)
    } finally {
      setParsing(false)
      if (parseFileRef.current) parseFileRef.current.value = ''
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={paymentOnly
        ? `Record Payment · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}`
        : isEdit ? `Edit · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
      width={520}
      accent
      footer={
        <div className="flex items-center justify-between gap-3">
          {isEdit && canDelete ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            {(() => {
              const needsCreatePerm = !isEdit && !canCreate
              const needsEditPerm   = isEdit && !paymentOnly && !canEditInvoice
              const needsPayPerm    = isEdit && paymentOnly && !canPayment
              if (needsCreatePerm || needsEditPerm || needsPayPerm) {
                return (
                  <button disabled className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: 0.5 }}
                    title="You don't have permission to perform this action">
                    No permission
                  </button>
                )
              }
              const noChanges = !saving && isEdit && !paymentOnly && !hasFormChanges
              return (
                <button
                  onClick={handleSave}
                  disabled={noChanges || saving}
                  className={noChanges ? 'btn-ghost' : 'btn-primary'}
                  style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: noChanges ? 0.62 : 1 }}
                  title={noChanges ? 'No form changes to save' : undefined}
                >
                  <Save size={12} />{saving ? 'Saving…' : noChanges ? 'No changes' : paymentOnly ? 'Record payment' : currentRecordId ? 'Save changes' : 'Create invoice'}
                </button>
              )
            })()}
          </div>
        </div>
      }
    >
      <div className="p-5 space-y-3.5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </FieldRow>
            <FieldRow label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Currency">
              <PicklistSelect
                fieldName="Currency"
                value={form.currency}
                onChange={set('currency')}
                options={picklists?.Currency || ['RS', 'USD']}
                onOptionsUpdate={onOptionsUpdate}
                placeholder="Select currency…"
                canAddOptions={canEditPicklists}
                onPermissionError={onPicklistPermissionError}
              />
            </FieldRow>
            <div />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Project">
              <PicklistSelect fieldName="Project" value={form.project} onChange={set('project')}
                options={picklists?.Project || []} onOptionsUpdate={onOptionsUpdate}
                placeholder="Select project…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Category">
              <PicklistSelect fieldName="Category" value={form.category} onChange={setCategoryValue}
                options={picklists?.Category || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
          </div>

          <div>
            <label className="label">Billing Type</label>
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <button
                type="button"
                onClick={() => setRetainerMode(false)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={!retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Project
              </button>
              <button
                type="button"
                onClick={() => setRetainerMode(true)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Retainer
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Milestone">
              <PicklistSelect fieldName="Milestone" value={form.milestone} onChange={set('milestone')}
                options={picklists?.Milestone || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Raised By">
              {ownerLocked ? (
                <div className="input flex items-center gap-2" style={{ color: 'var(--text-1)', background: 'var(--bg-input)' }}>
                  <Mail size={13} style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{userEmail}</span>
                </div>
              ) : (
                <PicklistSelect fieldName="Raised By" value={form.raised_by} onChange={set('raised_by')}
                  options={picklists?.['Raised By'] || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                  canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
              )}
            </FieldRow>
          </div>
          <FieldRow label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </FieldRow>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></FieldRow>
            <FieldRow label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FieldRow label={`Raised (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></FieldRow>
            <FieldRow label={`With GST (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></FieldRow>
            <FieldRow label={`Received (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></FieldRow>
          </div>
          <FieldRow label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </FieldRow>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
              <span>Paid invoices must include <strong>Amount Received</strong> and <strong>Cleared Date</strong>. Attach a payment reference screenshot before closing the entry.</span>
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode uses the existing table only. Put the retainer/client name in `Project`. The latest retainer row becomes the monthly template, invoice number can be filled later by the account manager, and paused months are stored as zero-value cancelled records with a reason.
            </div>
          )}

          {/* AI parse */}
          {!paymentOnly && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-layer)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} style={{ color: 'var(--accent)' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>AI autofill from PDF / image</span>
                </div>
                <label className={`btn-ghost cursor-pointer ${parsing ? 'opacity-50 pointer-events-none' : ''}`} style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>
                  {parsing ? <><Loader2 size={12} className="animate-spin" />Parsing…</> : <><Upload size={12} />Upload & fill</>}
                  <input ref={parseFileRef} type="file" accept="image/*,.pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleParse(f) }} />
                </label>
              </div>
              {parseError && <p className="text-xs" style={{ color: 'var(--fin-negative)' }}>{parseError}</p>}
              {parseNote && <p className="text-xs" style={{ color: 'var(--fin-positive)' }}>{parseNote}</p>}
              {parseApplied.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {parseApplied.map(a => (
                    <span key={a.key} className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                      {a.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AttachmentUploadField
              label="Invoice PDF"
              fieldKey="invoice_pdf"
              value={form.invoice_pdf}
              onChange={v => setForm(f => ({ ...f, invoice_pdf: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
            <AttachmentUploadField
              label="Payment Reference"
              fieldKey="reference"
              value={form.reference}
              onChange={v => setForm(f => ({ ...f, reference: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
          </div>
      </div>
    </Drawer>
  )
}

function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="tbl-row">
      {[80, 100, 90, 72, 72, 80, 100, 90, 90, 72, 72, 48, 64, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell"><div className="skeleton h-3 rounded" style={{ width: w }} /></td>
      ))}
    </tr>
  )
}

/* ── Help Modal ── */
const HELP_CONTACT = 'Mayukh@theworks.in'

function HelpModal({ open, onClose }) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-btn)' }}>
              <BookOpen size={14} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>App Guide</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>How to use TheWorks Web Tracker</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Overview */}
          <section className="rounded-xl p-4" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
            <h3 className="font-bold text-sm mb-1.5 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <Globe size={14} /> TheWorks Web Tracker
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Your all-in-one billing and project management hub. Start in the new <strong style={{ color: 'var(--text-1)' }}>Dashboard</strong> for a live billing command view, then move into <strong style={{ color: 'var(--text-1)' }}>Invoices</strong>, <strong style={{ color: 'var(--text-1)' }}>Retainers</strong>, and <strong style={{ color: 'var(--text-1)' }}>Projects</strong> (admin only) as needed. Everything stays synced live to Teable.
            </p>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Invoices */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FileText size={14} style={{ color: 'var(--accent)' }} /> Invoices
            </h3>
            <div className="space-y-2">
              {[
                ['Raise Externally', 'Opens the Zoho invoice request form for official client-facing invoices. Always raise through Zoho for formal billing.'],
                ['New Invoice', 'Records an invoice directly in the tracker — use this for internal entries, bulk import, or pre-raising before Zoho.'],
                ['Filters & Search', 'Filter by project, month, category, raised by, or billing type (Project vs Retainer). The search bar matches invoice number, project, description, category, and milestone.'],
                ['Status', 'Mark as Pending, Paid, or Cancelled. Invoices unpaid for more than 30 days appear as overdue at the top of the list.'],
                ['Paid Invoice Rule', 'When marking an invoice Paid, Amount Received and Cleared Date are mandatory. Attach a payment screenshot to the Reference field.'],
                ['Attachments', 'Drag & drop or click to attach Invoice PDFs and Payment References. Files upload directly to Teable — no size limit from the app side.'],
                ['Project Snapshot', 'The project cards at the top show raised/collected/outstanding per client. Click any card to filter the list to that project instantly.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Retainers */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Repeat2 size={14} style={{ color: 'var(--accent)' }} /> Retainers
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Retainer?', 'A recurring monthly billing arrangement. The Project field holds the client name. All retainer entries use a "Retainer" category type.'],
                ['Record a month', 'Navigate to the target month using the arrow buttons, then click Record Invoice. The form pre-fills from last month\'s entry — update only what changed.'],
                ['Pause a month', 'If billing is skipped, click Pause Month to record a zero-value Cancelled entry. This keeps the retainer history clean and shows a "Paused" pill in the timeline.'],
                ['Invoice number', 'You can leave this blank initially. Once the Zoho invoice is formally raised, the account manager updates the number here.'],
                ['Timeline view', 'Each retainer shows a month-by-month status strip — green (Paid), orange (Pending), grey (Paused), dashed (not yet raised). Click any month cell to jump to that entry.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Projects */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Briefcase size={14} style={{ color: 'var(--accent)' }} /> Projects
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['Create a project', 'Click + New Project. Fill in name, client, status, priority, timeline, and budget. The profit preview updates live as you type amounts.'],
                ['Project cards', 'Each card shows live status badge, priority, progress bar, client charge, and estimated profit. Click to open the full project detail view.'],
                ['Project detail', 'Full KPI breakdown — total cost, profit, margin %, man hours vs planned, and revenue. Also shows all resources assigned and matching invoices.'],
                ['Matching invoices', 'Invoices whose Project field exactly matches the project name are automatically listed with totals. Project name spelling must match precisely.'],
                ['Progress %', 'Use the slider in the edit form to update completion. This syncs directly to Teable and reflects on the project card.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Resources */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Users size={14} style={{ color: 'var(--accent)' }} /> Resources
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Resource?', 'Any person, tool, or vendor working on a project — Employee, Freelancer, Contractor, Tool/Software, or Cloud Infra.'],
                ['Add to a project', 'Open a project → click Add Resource or assign an existing one via the Assign Resources button. A resource can belong to multiple projects.'],
                ['Rate & cost', 'Set rate (₹), rate unit (Per Hour / Per Day / Per Month / Fixed), and units. Total cost is computed automatically in Teable.'],
                ['Man Hours', 'Log actual vs. planned hours. Teable computes the variance — red means over budget, green means under.'],
                ['Revenue tracking', 'Set a billing rate and billable units to track what you charge vs. what the resource costs. Gross margin is calculated automatically.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Tips */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              💡 Quick Tips
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {[
                ['Auto-sync', 'Invoice data refreshes every 10 seconds automatically — no manual refresh needed.'],
                ['Exact project names', 'Invoice ↔ Project linking is case-sensitive. "Riese Moto" ≠ "riese moto".'],
                ['Overdue alert', 'Pending invoices older than 30 days appear highlighted in red at the top.'],
                ['Follow-up filter', 'Use "Follow-up due" filter to surface invoices whose Next Followup date is today or past.'],
                ['Dropdown options', 'All dropdowns (Project, Category, Milestone, Raised By) pull live from Teable. Use the + button to add new options without leaving the form.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-2.5 items-start p-2.5 rounded-lg text-xs" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                  <Check size={11} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--fin-positive)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}:</strong> {desc}</p>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer — contact */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Question or found a bug?</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>We'll get back to you within a day.</p>
          </div>
          <a href={`mailto:${HELP_CONTACT}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff', textDecoration: 'none', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
            <Mail size={14} /> Contact us
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Mobile-only top header bar ── */
function MobileHeader({ onHelp, onLogout }) {
  const { dark, toggle } = useTheme()
  return (
    <div className="sm:hidden flex-shrink-0 flex items-center justify-between px-3"
      style={{
        height: 'calc(48px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
        background: 'var(--sidebar-bg)',
        borderBottom: '1px solid var(--sidebar-border)',
        zIndex: 10,
      }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
          <Globe size={12} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>TheWorks</p>
          <p className="text-[9px] leading-none" style={{ color: 'var(--text-3)' }}>Web Tracker</p>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button onClick={onHelp} title="Help & Guide"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <HelpCircle size={16} />
        </button>
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          {dark
            ? <Sun size={16} style={{ color: '#facc15' }} />
            : <Moon size={16} style={{ color: '#818cf8' }} />}
        </button>
        <button onClick={onLogout} title="Sign out"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  )
}

/* ── Mobile-only bottom navigation bar ── */
function MobileBottomNav({ workspace, setWorkspace, isAll }) {
  const navItems = [
    { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { value: 'invoices',  label: 'Invoices',  icon: FileText },
    { value: 'retainers', label: 'Retainers', icon: Repeat2 },
    ...(isAll ? [
      { value: 'projects', label: 'Projects', icon: Briefcase },
      { value: 'tax', label: 'Tax', icon: Receipt },
    ] : []),
  ]
  return (
    <nav className="sm:hidden flex-shrink-0 flex items-stretch border-t"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
        /* Push content above iPhone home indicator */
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
      {navItems.map(({ value, label, icon: Icon }) => {
        const active = workspace === value
        return (
          <button key={value} onClick={() => setWorkspace(value)}
            className="relative flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors"
            style={{ color: active ? 'var(--accent)' : 'var(--text-3)', minHeight: 52 }}>
            {active && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                style={{ background: 'var(--accent)' }} />
            )}
            <Icon size={18} style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ── Collapsible app sidebar ── */
function AppSidebar({ workspace, setWorkspace, isAll, open, onToggle, onHelp, onNew }) {
  const { logout, user } = useAuth()
  const { dark, toggle } = useTheme()
  const avatarSrc = useAvatarSrc(user?.avatar_url)
  const displayName = user?.full_name || user?.email?.split('@')[0] || 'User'
  const displaySub = user?.email || 'Web billing'
  const initials = (displayName || '?')
    .split(' ')
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const navItems = [
    { value: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
    { value: 'invoices',   label: 'Invoices',   icon: FileText },
    { value: 'retainers',  label: 'Retainers',  icon: Repeat2 },
    ...(isAll ? [
      { value: 'projects',  label: 'Projects',  icon: Briefcase },
      { value: 'tax',       label: 'Tax Ledger', icon: Receipt },
    ] : []),
  ]

  return (
    <aside
      className={`web-runey-sidebar runey-app-sidebar hidden sm:flex flex-col flex-shrink-0 transition-all duration-200 z-20 ${open ? '' : 'is-collapsed'}`}
      style={{
        width: open ? 200 : 76,
        overflow: 'visible',
      }}>

      {/* Brand + toggle */}
      <div className={`runey-sidebar-header ${open ? '' : 'is-collapsed'}`}>
        <div className="runey-brand-link min-w-0 overflow-hidden">
          <span className="runey-brand-mark">
            <Globe size={15} style={{ color: '#111' }} />
          </span>
          {open && (
            <div className="min-w-0">
              <p className="runey-brand-title">TheWorks</p>
              <p className="runey-brand-subtitle">Web Tracker</p>
            </div>
          )}
        </div>
        <button onClick={onToggle} title={open ? 'Collapse' : 'Expand'}
          className="runey-collapse-button">
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {onNew && (
        <div className="runey-quick-action">
          <button
            type="button"
            onClick={() => { setWorkspace('invoices'); onNew() }}
            className={`runey-new-button ${open ? '' : 'is-collapsed'}`}
            title={open ? undefined : 'New invoice'}
            aria-label={open ? undefined : 'New invoice'}
          >
            <Plus size={open ? 15 : 18} />
            {open && <span>New Invoice</span>}
          </button>
        </div>
      )}

      {/* Nav items */}
      <nav className={`runey-nav ${open ? '' : 'is-collapsed'}`}>
        {navItems.map(({ value, label, icon: Icon }) => {
          const active = workspace === value
          return (
            <button key={value} onClick={() => setWorkspace(value)}
              title={!open ? label : undefined}
              className={`runey-nav-link ${open ? '' : 'is-collapsed'} ${active ? 'active' : ''}`}>
              <Icon size={15} className="flex-shrink-0" style={{ flexShrink: 0 }} />
              {open && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer: help + theme + logout */}
      <div className={`runey-sidebar-footer ${open ? '' : 'is-collapsed'}`}>
        {onHelp && (
          <button onClick={onHelp} title="Help & Guide" className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
            <HelpCircle size={14} style={{ flexShrink: 0 }} />
            {open && <span className="text-xs">Help</span>}
          </button>
        )}
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'} className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
          {dark
            ? <Sun size={14} style={{ flexShrink: 0 }} />
            : <Moon size={14} style={{ flexShrink: 0 }} />}
          {open && <span className="text-xs">{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        <button onClick={logout} title="Sign out" className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
          <LogOut size={13} style={{ flexShrink: 0 }} />
          {open && <span className="text-xs">Sign out</span>}
        </button>
        <Link
          to="/profile"
          className={`runey-profile ${open ? '' : 'is-collapsed'}`}
          style={{ textDecoration: 'none' }}
          title={!open ? displayName : undefined}
        >
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="runey-profile-avatar object-cover"
            />
          ) : (
            <span className="runey-profile-avatar">{initials}</span>
          )}
          {open && (
            <div className="min-w-0">
              <p>{displayName}</p>
              <span>{displaySub}</span>
            </div>
          )}
        </Link>
      </div>
    </aside>
  )
}

/* ── Main page ── */
export default function WebInvoices() {
  const toast = useToast()
  const { isAll, logout, hasPerm } = useAuth()
  const canCreateInvoice = hasPerm('module.invoices.create')
  const { dark } = useTheme()
  const [searchParams, setSearchParams] = useSearchParams()

  // URL-synced filters — bookmark-able and shareable
  const initialWorkspace = searchParams.get('tab') || 'dashboard'
  const initialStatus    = searchParams.get('status') || ''
  const initialProject   = searchParams.get('project') || ''
  const initialSearch    = searchParams.get('q') || ''

  const updateUrlParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [sidebarOpen,    setSidebarOpen]    = useState(true)
  const [helpOpen,       setHelpOpen]       = useState(false)
  const [workspace,      setWorkspace]      = useState(initialWorkspace)
  const [selectedRetainer, setSelectedRetainer] = useState('')

  // ── Invoice-workspace-only filters ────────────────────────────────────────
  // These ONLY apply inside the 'invoices' workspace. Dashboard, retainers,
  // and projects are completely isolated — they never read these values.
  const [statusFilter,   setStatusFilter]   = useState(initialStatus)
  const [projectFilter,  setProjectFilter]  = useState(initialProject)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [billingFilter,  setBillingFilter]  = useState('all')
  const [monthFilter,    setMonthFilter]    = useState('')
  const [agingBandFilter,setAgingBandFilter]= useState('')
  const [dateFieldFilter,setDateFieldFilter]= useState('Raised Date')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [retainerMonth,  setRetainerMonth]  = useState(currentMonthKey())
  const [search,         setSearch]         = useState(initialSearch)
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [hasDocsOnly,    setHasDocsOnly]    = useState(false)
  const [followupDueOnly,setFollowupDueOnly]= useState(false)
  const [showFilters,    setShowFilters]    = useState(true)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [filterConditions, setFilterConditions] = useState([])
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')

  // switchWorkspace: clears invoice-list filters when moving AWAY from invoices
  // so switching back starts fresh, and drilldowns from dashboard explicitly set what they need.
  const switchWorkspace = useCallback((next) => {
    if (next !== 'invoices') {
      setStatusFilter(''); setProjectFilter(''); setCategoryFilter('')
      setRaisedByFilter(''); setBillingFilter('all'); setMonthFilter('')
      setAgingBandFilter(''); setDateFrom(''); setDateTo(''); setSearch('')
      setOverdueOnly(false); setHasDocsOnly(false); setFollowupDueOnly(false)
      setFilterConditions([]); setSortCol('Raised Date'); setSortDir('desc')
    }
    setWorkspace(next)
  }, [])
  const [drawer,         setDrawer]         = useState(null)
  const [drawerKey,      setDrawerKey]      = useState(0)
  const [picklists,      setPicklists]      = useState(DEFAULT_PICKLISTS)
  const [canEditPicklists, setCanEditPicklists] = useState(true)
  const [picklistPermissionMsg, setPicklistPermissionMsg] = useState('')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [previewDocs, setPreviewDocs] = useState(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    // Load ALL picklist fields (Project, Category, Milestone, Raised By, Currency)
    // directly from Teable field schema — same source as Currency, no detours.
    api.webInvoices.picklists.get()
      .then(data => {
        setPicklists(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, v.options])
          ),
        }))
      })
      .catch(() => {})
  }, [])

  function handleOptionsUpdate(fieldName, newOptions) {
    setPicklists(prev => ({ ...prev, [fieldName]: newOptions }))
  }

  function handlePicklistPermissionError(message) {
    setCanEditPicklists(false)
    setPicklistPermissionMsg(message)
  }

  const [agingBuckets,  setAgingBuckets]  = useState(null)
  // GST summary computed client-side from allRecords — no extra API call needed
  const [avatarMap,     setAvatarMap]     = useState({})
  const [hoveredRow,    setHoveredRow]    = useState(null)
  const [gstMonths,     setGstMonths]     = useState(3)
  const [chartPreset,   setChartPreset]   = useState('60d')
  const [chartFrom,     setChartFrom]     = useState('')
  const [chartTo,       setChartTo]       = useState('')
  const [balanceMonths, setBalanceMonths] = useState(3)
  const hoverTimerRef = useRef(null)

  // Only persist the active tab in the URL — filter state is session-only
  // (persisting filters caused stale filters to bleed across workspaces on reload)
  useEffect(() => { updateUrlParam('tab', workspace === 'dashboard' ? '' : workspace) }, [workspace])

  useEffect(() => {
    api.webInvoices.agingBuckets().then(setAgingBuckets).catch(() => {})
  }, [])

  useEffect(() => {
    api.webInvoices.avatarMap().then(setAvatarMap).catch(() => {})
  }, [])


  const fetchSummary = useCallback((opts = {}) => api.webInvoices.summary(opts), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 10_000)

  const fetchRecords = useCallback((opts = {}) =>
    api.webInvoices.list({
      // overdueOnly is purely a client-side filter — never pass status='Pending'
      // server-side or it silently drops invoices with Outstanding > 0 but non-Pending status.
      status:   statusFilter || undefined,
      project:  projectFilter || undefined,
      limit:    500,
      order_by: sortCol,
      order:    sortDir,
      ...opts,
    }), [statusFilter, projectFilter, sortCol, sortDir])

  const { data: listData, loading, error, errorStatus, refresh, syncing } = useAutoRefresh(fetchRecords, 10_000)
  const isStaleData = listData?._stale === true
  const serverRecords = listData?.records || []
  const [recordsState, setRecordsState] = useState([])
  useEffect(() => {
    setRecordsState(serverRecords)
  }, [serverRecords])
  const allRecords = recordsState


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

  const todayIso = new Date().toISOString().slice(0, 10)

  // Compute effective aging — prefer Teable's computed field, fallback to days since Raised Date
  function effectiveAging(f) {
    const teableVal = f['Agening (Days)']
    if (teableVal != null && teableVal !== '') return Number(teableVal)
    const raised = parseIsoDate(f['Raised Date'])
    if (!raised) return 0
    return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
  }

  const baseRecords = allRecords.filter(r => {
    const f = r.fields || {}
    const retainer = isRetainerCategory(f['Category'])
    if (billingFilter === 'retainer' && !retainer) return false
    if (billingFilter === 'project' && retainer) return false
    if (categoryFilter && f['Category'] !== categoryFilter) return false
    if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
    if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
    if (dateFrom || dateTo) {
      const candidate = dateOnlyValue(f[dateFieldFilter])
      if (!candidate) return false
      if (dateFrom && candidate < dateFrom) return false
      if (dateTo && candidate > dateTo) return false
    }
    // "Overdue only" = Pending status OR has an outstanding balance
    if (overdueOnly && !(f['Payment Status'] === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
    if (followupDueOnly) {
      const raw = f['Next followup']
      if (!raw) return false
      if (String(raw).slice(0, 10) > todayIso) return false
    }
    if (hasDocsOnly) {
      const refs = parseAttachments(f['Reference'])
      const pdfs = parseAttachments(f['Invoice PDF'])
      if (refs.length + pdfs.length === 0) return false
    }
    if (agingBandFilter) {
      if (f['Payment Status'] !== 'Pending') return false
      if (classifyAgingBand(effectiveAging(f)) !== agingBandFilter) return false
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase()
      return (
        (f['Invoice Number'] || '').toLowerCase().includes(q) ||
        (f['Project']        || '').toLowerCase().includes(q) ||
        (f['Description']    || '').toLowerCase().includes(q) ||
        (f['Category']       || '').toLowerCase().includes(q) ||
        (f['Milestone']      || '').toLowerCase().includes(q)
      )
    }
    return true
  })
  const records = applyConditions(baseRecords, filterConditions, r => r.fields ?? {})

  const s        = summary
  const overdue  = s?.overdue_invoices || []
  const activeConditions = filterConditions.filter(c => c.field && c.op && (c.value !== '' || ['is_empty','is_not_empty'].includes(c.op)))
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0
  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      // Sort by total invoice count (universal — not RS-only raised)
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [s])

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
    if (!retainerGroups.length) {
      setSelectedRetainer('')
      return
    }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null
  const dashboardStyles = useMemo(() => (
    dark
      ? {
          shell: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(17,24,39,0.96) 58%, rgba(20,38,33,0.92) 100%)',
          panel: 'rgba(15,23,42,0.76)',
          panelSoft: 'rgba(30,41,59,0.68)',
          accentPanel: 'rgba(15,118,110,0.16)',
          warnPanel: 'rgba(120,53,15,0.18)',
          line: 'rgba(148,163,184,0.16)',
          glow: '0 30px 60px rgba(2,6,23,0.34)',
        }
      : {
          shell: 'linear-gradient(135deg, rgba(238,244,255,0.96) 0%, rgba(255,255,255,0.98) 52%, rgba(237,248,241,0.98) 100%)',
          panel: 'rgba(255,255,255,0.92)',
          panelSoft: 'rgba(248,250,252,0.92)',
          accentPanel: 'rgba(16,185,129,0.08)',
          warnPanel: 'rgba(245,158,11,0.10)',
          line: 'rgba(148,163,184,0.18)',
          glow: '0 28px 60px rgba(15,23,42,0.08)',
        }
  ), [dark])

  const visibleClientCount = useMemo(() => (
    new Set(records.map(r => String(r.fields?.['Project'] || '').trim()).filter(Boolean)).size
  ), [records])

  const upcomingFollowups = useMemo(() => (
    [...records]
      .filter(r => r.fields?.['Next followup'])
      .sort((a, b) => {
        const da = parseIsoDate(a.fields?.['Next followup'])?.getTime() || 0
        const db = parseIsoDate(b.fields?.['Next followup'])?.getTime() || 0
        return da - db
      })
      .slice(0, 5)
  ), [records])

  const latestInvoices = useMemo(() => sortByRaisedDateDesc(records).slice(0, 6), [records])
  const topOutstandingProject = useMemo(() => {
    return projectSummaryCards
      .slice()
      .sort((a, b) => {
        const aOut = Object.values(a.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        const bOut = Object.values(b.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        return bOut - aOut
      })[0] || null
  }, [projectSummaryCards])

  const dashboardStatusRows = useMemo(() => {
    const byStatus = s?.by_status || {}
    const total = Object.values(byStatus).reduce((sum, count) => sum + Number(count || 0), 0) || 1
    return Object.entries(byStatus)
      .map(([status, count]) => {
        const meta = STATUS_META[status] || {}
        return {
          status,
          count,
          pct: Math.round((Number(count || 0) / total) * 100),
          color: meta.color || 'var(--accent)',
        }
      })
      .sort((a, b) => Number(b.count) - Number(a.count))
  }, [s])
  // Dashboard overview widgets always use the full unfiltered set so search/status
  // filters active in the invoice list view don't blank out the dashboard.
  const raisedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of allRecords) {
      const key = monthKey(record.fields?.['Raised Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [allRecords])
  const clearedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of allRecords) {
      const key = monthKey(record.fields?.['Cleared Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Received'] || record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [allRecords])
  const dashboardAgingBuckets = useMemo(() => {
    const buckets = { '0-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 }
    for (const record of allRecords) {
      const f = record.fields || {}
      if (f['Payment Status'] !== 'Pending') continue
      buckets[classifyAgingBand(effectiveAging(f))] += 1
    }
    return buckets
  }, [allRecords])
  const applyDashboardMonthDrilldown = useCallback((field, key) => {
    setDateFieldFilter(field)
    setDateFrom(`${key}-01`)
    setDateTo(endOfMonthIso(key))
    setMonthFilter(field === 'Raised Date' ? key : '')
    switchWorkspace('invoices')
  }, [])

  const lastThreeMonthBalance = useMemo(() => {
    const current = currentMonthKey()
    const keys = Array.from({ length: balanceMonths }, (_, i) => shiftMonthKey(current, -(balanceMonths - 1 - i)))
    return keys.map((key, index) => {
      let base = 0, gross = 0, gst = 0, received = 0, deduction = 0, outstanding = 0, invoiceCount = 0
      for (const record of allRecords) {
        const fields = record.fields || {}
        if (monthKey(fields['Raised Date']) === key) {
          const parts = invoiceAmountParts(fields)
          base += parts.base; gross += parts.gross; gst += parts.gst
          received += parts.received; deduction += parts.deduction
          outstanding += parts.outstanding; invoiceCount += 1
        }
      }
      const previous = index > 0 ? keys[index - 1] : ''
      let previousGross = 0
      if (previous) {
        for (const record of allRecords) {
          const fields = record.fields || {}
          if (monthKey(fields['Raised Date']) === previous) previousGross += invoiceAmountParts(fields).gross
        }
      }
      const change = previous && previousGross ? ((gross - previousGross) / Math.abs(previousGross)) * 100 : null
      const collectionRate = gross > 0 ? Math.min(100, Math.max(0, (received / gross) * 100)) : 0
      return { key, label: shortMonthLabel(key), base, gross, gst, received, deduction, outstanding, invoiceCount, collectionRate, change }
    })
  }, [allRecords, balanceMonths])

  const maxMonthlyBalanceMagnitude = useMemo(
    () => Math.max(1, ...lastThreeMonthBalance.map(e => e.gross)),
    [lastThreeMonthBalance]
  )

  // GST summary computed from already-loaded allRecords — instant, no extra API call
  const gstSummary = useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now.getFullYear(), now.getMonth() - gstMonths + 1, 1)
    const months = {}
    const totals = { base: 0, gst: 0, gross: 0, received: 0, outstanding: 0, count: 0 }
    for (const r of allRecords) {
      const f = r.fields || {}
      const rd = f['Raised Date'] ? new Date(f['Raised Date']) : null
      if (!rd || isNaN(rd) || rd < cutoff) continue
      const base        = Number(f['Amount Raised'] || 0)
      const gross       = Number(f['Amount with Tax'] || base)
      const received    = Number(f['Amount Received'] || 0)
      const outstanding = Number(f['Outstanding Amount'] || Math.max(0, gross - received))
      const gst         = Math.max(0, gross - base)
      const mk = `${rd.getFullYear()}-${String(rd.getMonth() + 1).padStart(2, '0')}`
      if (!months[mk]) {
        const label = rd.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        months[mk] = { month: mk, label, base: 0, gst: 0, gross: 0, received: 0, outstanding: 0, count: 0, paid_count: 0, pending_count: 0 }
      }
      months[mk].base += base; months[mk].gst += gst; months[mk].gross += gross
      months[mk].received += received; months[mk].outstanding += outstanding; months[mk].count += 1
      if (f['Payment Status'] === 'Paid') months[mk].paid_count += 1; else months[mk].pending_count += 1
      totals.base += base; totals.gst += gst; totals.gross += gross
      totals.received += received; totals.outstanding += outstanding; totals.count += 1
    }
    return { months: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)), totals }
  }, [allRecords, gstMonths])

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
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
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
          : `Recurring retainer for ${monthName}. Invoice number to be updated by account manager.`,
      }
      await api.webInvoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    const label = monthLabel(monthKeyValue)
    const confirmed = window.confirm(
      `Open the external invoice request form for ${group.project} (${label})?`
    )
    if (!confirmed) return
    window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    setDrawer({
      mode: 'new',
      invoice: null,
      draft: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
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
        reference: [],
        invoice_pdf: [],
      },
    })
  }

  const openNew     = ()  => { setDrawerKey(k => k + 1); setDrawer({ mode: 'new',  invoice: null, draft: null }) }
  const openView    = r   => { setDrawerKey(k => k + 1); setDrawer({ mode: 'view', invoice: r   }) }

  function handlePrintInvoices() {
    const INR = (n) => n != null ? '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
    const printRows = records.map(r => {
      const f = r.fields || {}
      return {
        no: f['Invoice Number'] || '—',
        date: String(f['Raised Date'] || '').slice(0, 10),
        project: f['Project'] || '—',
        category: f['Category'] || '—',
        status: f['Payment Status'] || '—',
        raised: f['Amount Raised'],
        withTax: f['Amount with Tax'],
        received: f['Amount Received'],
        outstanding: f['Outstanding Amount'],
      }
    })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Invoices</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,sans-serif;font-size:10px;color:#111;padding:16px}
      h1{font-size:15px;font-weight:700;margin-bottom:2px}
      .sub{font-size:8.5px;color:#6b7280;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th{background:#f3f4f6;font-weight:600;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em;padding:3px 5px;border:1px solid #e5e7eb;white-space:nowrap;text-align:right}
      th.l{text-align:left}
      td{padding:3px 5px;border:1px solid #e5e7eb;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px}
      td.l{text-align:left}
      tr:nth-child(even) td{background:#f9fafb}
      .green{color:#059669}.red{color:#dc2626}
      @page{margin:1cm;size:A4 landscape}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>Invoices</h1>
    <p class="sub">Generated ${new Date().toLocaleString('en-IN')} · ${printRows.length} invoice${printRows.length !== 1 ? 's' : ''}</p>
    <table>
      <colgroup>
        <col style="width:11%"><col style="width:7%"><col style="width:18%"><col style="width:9%"><col style="width:8%">
        <col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:11%">
      </colgroup>
      <thead><tr>
        <th class="l">Invoice #</th><th class="l">Date</th><th class="l">Project</th><th class="l">Category</th><th class="l">Status</th>
        <th>Amount</th><th>With GST</th><th>Received</th><th>O/S</th>
      </tr></thead>
      <tbody>${printRows.map(r => `<tr>
        <td class="l">${r.no}</td><td class="l">${r.date}</td><td class="l">${r.project}</td><td class="l">${r.category}</td><td class="l">${r.status}</td>
        <td>${INR(r.raised)}</td><td>${INR(r.withTax)}</td><td class="green">${INR(r.received)}</td><td class="${Number(r.outstanding) > 0 ? 'red' : ''}">${INR(r.outstanding)}</td>
      </tr>`).join('')}</tbody>
    </table>
    </body></html>`
    const w = window.open('', '_blank', 'width=1200,height=860')
    w.document.write(html)
    w.document.close()
    w.onload = () => { w.focus(); w.print(); w.onafterprint = () => w.close() }
  }

  function exportCsv(useFiltered) {
    const CSV_FIELDS = [
      'Invoice Number', 'Raised Date', 'Project', 'Category', 'Payment Status',
      'Raised By', 'Milestone', 'Currency', 'Amount Raised', 'Amount with Tax',
      'Amount Received', 'Outstanding Amount', 'Cleared Date', 'Remark',
    ]
    const escape = (v) => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const data = useFiltered ? records : allRecords
    const header = CSV_FIELDS.join(',')
    const body = data.map(r => {
      const f = r.fields || {}
      return CSV_FIELDS.map(k => escape(f[k])).join(',')
    }).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices_${useFiltered ? 'filtered_' : ''}${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  // Auto-open new invoice drawer when navigated with ?new=1 (e.g. from sidebar button)
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('new'); return n }, { replace: true })
    setWorkspace('invoices')
    openNew()
  }, []) // eslint-disable-line
  const openRecordPayment = r => {
    setDrawerKey(k => k + 1)
    setDrawer({
      mode: 'payment',
      invoice: r,
      draft: {
        payment_status: 'Paid',
        amount_received: r?.fields?.['Amount Raised'] ?? '',
        cleared_date: new Date().toISOString().slice(0, 10),
        reference: Array.isArray(r?.fields?.['Reference']) ? r.fields['Reference'] : [],
        remark: r?.fields?.['Remark'] || '',
      },
    })
  }
  const closeDrawer = () => setDrawer(null)
  const handleSaved = (savedRecord) => {
    if (savedRecord?.id) {
      setRecordsState((prev) => {
        const idx = prev.findIndex((row) => row.id === savedRecord.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = savedRecord
          return next
        }
        return [savedRecord, ...prev]
      })
    }
    refresh()
    closeDrawer()
  }
  const handleDeleted = (deletedId) => {
    if (deletedId) setRecordsState((prev) => prev.filter((row) => row.id !== deletedId))
    refresh()
    closeDrawer()
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

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
    <div className="app-shell web-invoices-shell flex overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* ── Sidebar — desktop only ── */}
      <AppSidebar
        workspace={workspace}
        setWorkspace={switchWorkspace}
        isAll={isAll}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
        onHelp={() => setHelpOpen(true)}
        onNew={canCreateInvoice ? openNew : null}
      />

      {/* ── Content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Mobile top header — hidden sm+ */}
      <MobileHeader onHelp={() => setHelpOpen(true)} onLogout={logout} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-5 animate-fade-in">

          {/* ── Invoices header ── */}
          {workspace === 'dashboard' && (
          <section
            className="rounded-[28px] p-4 sm:p-5 lg:p-6 space-y-4"
            style={{
              background: dashboardStyles.shell,
              border: `1px solid ${dashboardStyles.line}`,
              boxShadow: dashboardStyles.glow,
            }}>
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="flex items-center justify-center rounded-[22px] flex-shrink-0"
                    style={{
                      width: 46,
                      height: 46,
                      background: dark ? 'rgba(79,70,229,0.16)' : 'rgba(99,102,241,0.12)',
                      border: `1px solid ${dashboardStyles.line}`,
                    }}>
                    <LayoutDashboard size={20} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: dark ? 'rgba(191,219,254,0.78)' : 'var(--accent)' }}>
                      Billing Command Deck
                    </p>
                    <h1 className="text-[1.9rem] sm:text-[2.2rem] lg:text-[2.45rem] font-bold tracking-tight mt-0.5 leading-none" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                      Billing Dashboard
                    </h1>
                  </div>
                </div>
                <p className="max-w-xl text-sm leading-relaxed" style={{ color: dark ? 'rgba(226,232,240,0.82)' : 'var(--text-2)' }}>
                  Cash movement, overdue pressure, retainers, and project billing signals in one live Teable-backed workspace.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 w-full xl:w-auto">
                <button onClick={() => switchWorkspace('invoices')} className="btn-ghost justify-center whitespace-nowrap">
                  <FileText size={14} />Open invoices
                </button>
                <button onClick={() => switchWorkspace('retainers')} className="btn-ghost justify-center whitespace-nowrap">
                  <Repeat2 size={14} />Retainers
                </button>
                {isAll && (
                  <button onClick={() => switchWorkspace('projects')} className="btn-ghost justify-center whitespace-nowrap">
                    <Briefcase size={14} />Projects
                  </button>
                )}
                <button onClick={refresh} disabled={loading} className="btn-ghost justify-center whitespace-nowrap">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
                </button>
                <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-primary justify-center whitespace-nowrap">
                  <ExternalLink size={14} />Raise externally
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.9fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="grid grid-cols-2 2xl:grid-cols-4 gap-3">
                  <DashboardMetric
                    label="Total raised"
                    value={sumLoading && !s ? '—' : fmt(s?.total_raised)}
                    sub={`${allRecords.length} invoices across all workspaces`}
                    icon={null}
                    iconSlot={false}
                    tone={dark ? 'rgba(30,41,59,0.68)' : 'rgba(255,255,255,0.92)'}
                    accent={dark ? '#f8fafc' : 'var(--text-1)'}
                  />
                  <DashboardMetric
                    label="Collected"
                    value={sumLoading && !s ? '—' : fmt(s?.total_received)}
                    sub={`${(s?.collection_rate ?? 0).toFixed(1)}% collection rate`}
                    icon={TrendingUp}
                    tone={dashboardStyles.accentPanel}
                    accent="var(--fin-positive)"
                    compact
                  />
                  <DashboardMetric
                    label="Outstanding"
                    value={sumLoading && !s ? '—' : fmt(s?.total_outstanding)}
                    sub={`${overdue.length} invoice${overdue.length === 1 ? '' : 's'} beyond 30 days`}
                    icon={AlertOctagon}
                    tone={dashboardStyles.warnPanel}
                    accent={Number(s?.total_outstanding || 0) > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'}
                    compact
                  />
                  <DashboardMetric
                    label="Retainer coverage"
                    value={`${retainerGroups.length}`}
                    sub={`${selectedRetainerGroup?.currentMonthRaised ? 'Current month covered' : 'Review current month gaps'}`}
                    icon={Repeat2}
                    tone={dark ? 'rgba(15,23,42,0.55)' : 'rgba(247,250,255,0.94)'}
                    accent={dark ? '#c4b5fd' : '#4f46e5'}
                    compact
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <DashboardSignal
                  eyebrow="Main signal"
                  title={topOutstandingProject ? topOutstandingProject.project : 'No project pressure'}
                  body={topOutstandingProject
                    ? `${fmt(Object.values(topOutstandingProject.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))} currently open across ${topOutstandingProject.metrics?.count || 0} invoices.`
                    : 'No outstanding balance is currently visible in the filtered portfolio.'}
                  icon={Activity}
                  tone={dashboardStyles.accentPanel}
                  accent="var(--fin-positive)"
                />
                <DashboardSignal
                  eyebrow="Visible scope"
                  title={`${records.length} live invoices · ${visibleClientCount} projects`}
                  body={hasFilters ? 'Dashboard is currently respecting active invoice filters.' : 'No extra filters applied. This is your full live billing picture.'}
                  icon={Users}
                  tone={dashboardStyles.panelSoft}
                  accent="var(--accent)"
                />
              </div>
            </div>

            {/* ── Aging Buckets ── */}
            {agingBuckets && (
            <div className="rounded-[26px] p-4 sm:p-5 space-y-3" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Receivables aging</p>
                  <h2 className="text-lg font-bold mt-0.5" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Pending invoice age</h2>
                </div>
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{agingBuckets.total_pending} pending</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { key: '0_30',  label: '0–30 days',  color: 'var(--fin-positive)' },
                  { key: '30_60', label: '30–60 days', color: 'var(--fin-warning)' },
                  { key: '60_90', label: '60–90 days', color: '#f97316' },
                  { key: '90+',   label: '90+ days',   color: 'var(--fin-negative)' },
                ].map(({ key, label, color }) => {
                  const b = agingBuckets.buckets.find(x => x.label.replace('–','-') === label.replace('–','-')) || agingBuckets.buckets.find((_, i) => ['0_30','30_60','60_90','90+'][i] === key) || { count: 0, amount: 0 }
                  const pct = agingBuckets.total_outstanding > 0 ? (b.amount / agingBuckets.total_outstanding) * 100 : 0
                  return (
                    <div key={key} className="rounded-2xl p-3" style={{ background: 'var(--bg-layer)', border: `1px solid var(--card-border)` }}>
                      <p className="text-[11px] font-semibold mb-1.5" style={{ color }}>{label}</p>
                      <p className="text-lg font-bold tabular-nums leading-none mb-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{b.count}</p>
                      <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>₹{(b.amount/100000).toFixed(1)}L</p>
                      <div className="mt-2 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            )}

            {/* ── Invoice Activity Chart ── */}
            {allRecords.length > 0 && (() => {
              const CHART_PRESETS = [
                { key: '30d',    label: '30d',   days: 30 },
                { key: '60d',    label: '60d',   days: 60 },
                { key: '3m',     label: '3 mo',  days: 90 },
                { key: '6m',     label: '6 mo',  days: 180 },
                { key: '1y',     label: '1 yr',  days: 365 },
                { key: 'custom', label: 'Custom',days: null },
              ]
              const activePreset = CHART_PRESETS.find(p => p.key === chartPreset) || CHART_PRESETS[1]
              const chartFromProp = chartPreset === 'custom' ? chartFrom : undefined
              const chartToProp   = chartPreset === 'custom' ? chartTo   : undefined
              const chartDaysProp = chartPreset === 'custom' ? 60 : (activePreset.days || 60)
              const labelText = chartPreset === 'custom' && chartFrom
                ? `${chartFrom}${chartTo ? ' → ' + chartTo : ''}`
                : `last ${activePreset.label}`
              return (
                <div className="rounded-[26px] overflow-hidden" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}`, padding: 0 }}>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Invoice activity</p>
                      <h2 className="text-lg font-bold mt-0.5" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Billing activity · {labelText}</h2>
                      <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                        Bar height = amount ·&nbsp;
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />paid&nbsp;
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#fb7185' }} />overdue&nbsp;
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />pending
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                        {CHART_PRESETS.map(p => (
                          <button key={p.key}
                            onClick={() => setChartPreset(p.key)}
                            className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                            style={chartPreset === p.key
                              ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                              : { color: 'var(--text-3)' }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                      {chartPreset === 'custom' && (
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
                            className="text-[11px] px-2 py-1 rounded-md"
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none' }} />
                          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>→</span>
                          <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)}
                            className="text-[11px] px-2 py-1 rounded-md"
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none' }} />
                        </div>
                      )}
                    </div>
                  </div>
                  <InvoiceActivityChart
                    records={allRecords}
                    days={chartDaysProp}
                    from={chartFromProp}
                    to={chartToProp}
                    className="px-2 pb-1"
                    avatarMap={avatarMap}
                    onInvoiceClick={id => {
                      const rec = allRecords.find(r => r.id === id)
                      if (rec) openView(rec)
                    }}
                  />
                </div>
              )
            })()}

            {/* ── Monthly Receivables + Recent Projects (side by side) ── */}
            {allRecords.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
              {/* Left: compact pill widget */}
              <div className="rounded-[26px] p-4 sm:p-5 flex flex-col" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-2 mb-4 flex-shrink-0">
                  <div>
                    <h2 className="text-base font-bold" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Last {balanceMonths} Months</h2>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Receivables at a glance</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {[3, 6, 12].map(m => (
                      <button key={m} onClick={() => setBalanceMonths(m)}
                        className={balanceMonths === m ? 'btn-primary' : 'btn-ghost'}
                        style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem' }}>{m} mo</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lastThreeMonthBalance.length}, 1fr)`, gap: '0.75rem', flex: 1 }}>
                  {lastThreeMonthBalance.map((entry, idx) => {
                    const collPct = entry.gross > 0 ? Math.min(100, (entry.received / entry.gross) * 100) : 0
                    const barH = maxMonthlyBalanceMagnitude > 0 ? Math.max(0.1, entry.gross / maxMonthlyBalanceMagnitude) : 0.1
                    const barColor = collPct >= 80
                      ? 'linear-gradient(180deg,#4ade80,#16a34a)'
                      : collPct >= 50
                      ? 'linear-gradient(180deg,#fbbf24,#d97706)'
                      : 'linear-gradient(180deg,#f87171,#dc2626)'
                    const badgeLabel = entry.change !== null
                      ? (entry.change >= 0 ? `up ${entry.change.toFixed(0)}%` : `down ${Math.abs(entry.change).toFixed(0)}%`)
                      : `${collPct.toFixed(0)}% collected`
                    const badgeColor = entry.change !== null
                      ? (entry.change >= 0 ? { bg: 'rgba(34,197,94,0.18)', text: '#4ade80' } : { bg: 'rgba(239,68,68,0.2)', text: '#f87171' })
                      : { bg: 'rgba(100,100,120,0.22)', text: dark ? '#94a3b8' : '#64748b' }
                    const fmtAmt = (v) => v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${Math.round(v)}`
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => applyDashboardMonthDrilldown('Raised Date', entry.key)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                      >
                        {/* Pill */}
                        <div style={{ width: '100%', flex: 1, maxHeight: 220, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                          <div style={{
                            width: '60%', height: `${barH * 100}%`, minHeight: 18,
                            background: barColor, borderRadius: 32,
                            transition: 'height 0.4s ease',
                            boxShadow: `0 3px 14px ${collPct >= 80 ? 'rgba(74,222,128,0.28)' : collPct >= 50 ? 'rgba(251,191,36,0.28)' : 'rgba(248,113,113,0.28)'}`,
                          }} />
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', margin: '7px 0 3px' }}>{entry.label}</p>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: dark ? '#f8fafc' : 'var(--text-1)', marginBottom: 2 }}>{fmtAmt(entry.gross)}</p>
                        <p style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 6 }}>{fmtAmt(entry.received)} rcvd</p>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-3)' }}>
                            <span>Open</span><span style={{ fontWeight: 600, color: entry.outstanding > 0 ? '#f87171' : '#4ade80' }}>{fmtAmt(entry.outstanding)}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: 999, background: badgeColor.bg, color: badgeColor.text }}>{badgeLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Right: Recent Projects */}
              {projectSummaryCards.length > 0 && (
                <div className="rounded-[26px] p-4 sm:p-5" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="mb-4">
                    <h2 className="text-base font-bold" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Recent Projects</h2>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Active invoice pressure</p>
                  </div>
                  <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 360 }}>
                    {projectSummaryCards.slice(0, 5).map(({ project, metrics }) => {
                      const raised = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.raised || 0), 0)
                      const received = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.received || 0), 0)
                      const open = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.outstanding || 0), 0)
                      const collPct = raised > 0 ? Math.min(100, (received / raised) * 100) : 0
                      const fmtAmt = (v) => v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${Math.round(v)}`
                      return (
                        <button
                          key={project}
                          type="button"
                          onClick={() => { setProjectFilter(project); switchWorkspace('invoices') }}
                          className="w-full text-left rounded-2xl px-4 py-3 transition-all"
                          style={{ background: dark ? 'rgba(15,23,42,0.5)' : 'rgba(248,250,252,0.9)', border: `1px solid ${dashboardStyles.line}`, cursor: 'pointer' }}
                        >
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                                {project[0]?.toUpperCase()}
                              </span>
                              <span className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{project}</span>
                            </div>
                            <span className="text-xs font-bold tabular-nums" style={{ color: dark ? '#f8fafc' : 'var(--text-1)', flexShrink: 0 }}>{fmtAmt(raised)}</span>
                          </div>
                          <div className="flex items-center gap-1 mb-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }}>
                              <div className="h-full rounded-full" style={{ width: `${collPct}%`, background: collPct >= 80 ? '#4ade80' : collPct >= 50 ? '#fbbf24' : '#f87171' }} />
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: collPct >= 80 ? '#4ade80' : collPct >= 50 ? '#d97706' : '#f87171' }}>{collPct.toFixed(0)}%</span>
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            {metrics?.count || 0} invoices · <span style={{ color: '#f87171' }}>₹{(open/1000).toFixed(0)}k open</span>
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Monthly Collections Chart (bars=raised, line=collected) ── */}
            {allRecords.length > 0 && (
              <div className="rounded-[26px] p-4 sm:p-5" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <MonthlyCollectionsChart records={allRecords} />
              </div>
            )}


            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_320px] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Raised timeline</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Raised by month-year</h2>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Click to filter</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {raisedTimeline.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No raised-date distribution available in the current scope.</p>
                  ) : raisedTimeline.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => applyDashboardMonthDrilldown('Raised Date', entry.key)}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={{ background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)', border: `1px solid ${dashboardStyles.line}` }}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>{monthLabel(entry.key)}</p>
                      <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{fmt(entry.amount)}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} raised invoice{entry.count !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Cleared timeline</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Cleared by month-year</h2>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Click to filter</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {clearedTimeline.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No cleared-date distribution available in the current scope.</p>
                  ) : clearedTimeline.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => applyDashboardMonthDrilldown('Cleared Date', entry.key)}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={{ background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)', border: `1px solid ${dashboardStyles.line}` }}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>{monthLabel(entry.key)}</p>
                      <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: 'var(--fin-positive)' }}>{fmt(entry.amount)}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} cleared invoice{entry.count !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Aging buckets</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Receivables heat map</h2>
                  </div>
                  <ShieldAlert size={18} style={{ color: 'var(--fin-warning)' }} />
                </div>
                <div className="space-y-2">
                  {Object.entries(dashboardAgingBuckets).map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setAgingBandFilter(agingBandFilter === label ? '' : label); switchWorkspace('invoices') }}
                      className="w-full flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left"
                      style={{ background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)', border: `1px solid ${dashboardStyles.line}` }}
                    >
                      <div>
                        <p className="text-xs font-semibold" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{label}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Pending invoices</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums" style={{ color: label === '60d+' ? 'var(--fin-negative)' : label === '31-60d' ? 'var(--fin-warning)' : dark ? '#f8fafc' : 'var(--text-1)' }}>
                        {value}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Status distribution</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Collection pulse</h2>
                  </div>
                  <button onClick={() => switchWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}>
                    Open invoice table <ArrowRight size={12} />
                  </button>
                </div>
                <div className="space-y-3">
                  {dashboardStatusRows.map(row => (
                    <div key={row.status} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                          <span className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{row.status}</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {row.count} · {row.pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(51,65,85,0.85)' : 'rgba(226,232,240,0.85)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${row.pct}%`, background: row.color }} />
                      </div>
                    </div>
                  ))}
                </div>

                {projectSummaryCards.length > 0 && (
                  <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${dashboardStyles.line}` }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>Project pulse</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>Highest invoice-bearing projects in the current scope.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                      {projectSummaryCards.slice(0, 4).map(({ project, metrics }) => (
                        <button
                          key={project}
                          type="button"
                          onClick={() => { setProjectFilter(project); switchWorkspace('invoices') }}
                          className="rounded-2xl p-4 text-left transition-all"
                          style={{
                            background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.85)',
                            border: `1px solid ${dashboardStyles.line}`,
                          }}>
                          <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{project}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{metrics?.count || 0} invoices · click to filter</p>
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Raised</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.raised || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Collected</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-positive)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.received || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Open</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-warning)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-1 gap-4">
                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Attention queue</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Upcoming follow-ups</h2>
                    </div>
                    <ShieldAlert size={18} style={{ color: 'var(--fin-warning)' }} />
                  </div>
                  <div className="space-y-2">
                    {upcomingFollowups.length === 0
                      ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No follow-up dates are set in the current scope.</p>
                      : upcomingFollowups.map(record => {
                          const f = record.fields || {}
                          return (
                            <button
                              key={record.id}
                              type="button"
                              onClick={() => { switchWorkspace('invoices'); openView(record) }}
                              className="w-full text-left rounded-2xl p-3 transition-all"
                              style={{
                                background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                                border: `1px solid ${dashboardStyles.line}`,
                              }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                                    {f['Project'] || 'Unnamed project'}
                                  </p>
                                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                    {f['Invoice Number'] || 'Invoice number pending'} · {f['Raised By'] || 'Unassigned'}
                                  </p>
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--fin-warning)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                  </div>
                </div>

                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Retainer desk</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Coverage snapshot</h2>
                    </div>
                    <button onClick={() => switchWorkspace('retainers')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                      Open retainers
                    </button>
                  </div>
                  <div className="space-y-2">
                    {retainerGroups.slice(0, 4).map(group => (
                      <button
                        key={group.project}
                        type="button"
                        onClick={() => { setSelectedRetainer(group.project); switchWorkspace('retainers') }}
                        className="w-full rounded-2xl p-3 text-left"
                        style={{
                          background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{group.project}</p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {fmt(group.amount)} · next due {monthLabel(group.nextDueMonth)}
                            </p>
                          </div>
                          <MonthStatusPill status={group.monthStatus} />
                        </div>
                      </button>
                    ))}
                    {retainerGroups.length === 0 && (
                      <p className="text-sm" style={{ color: 'var(--text-3)' }}>No retainer templates available yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Latest movement</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Newest invoices</h2>
                  </div>
                  <button onClick={() => switchWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                    Open all
                  </button>
                </div>
                <div className="space-y-2">
                  {latestInvoices.map(record => {
                    const f = record.fields || {}
                    const cur = f['Currency'] || 'RS'
                    return (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => { switchWorkspace('invoices'); openView(record) }}
                        className="w-full rounded-2xl p-3 text-left transition-all"
                        style={{
                          background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                              {f['Project'] || 'Unnamed project'}
                            </p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {f['Invoice Number'] || 'Invoice number pending'} · {f['Category'] || 'Uncategorised'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold tabular-nums" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</p>
                            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{fmtDate(f['Raised Date'])}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {latestInvoices.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No invoices available yet.</p>
                  )}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Operating notes</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>How to use this desk</h2>
                  </div>
                  <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="space-y-3">
                  {[
                    ['Invoices', 'Track pending, overdue, and fully collected billing records with live filters and file previews.'],
                    ['Retainers', 'Raise externally in Zoho, then record the final invoice details internally for month-by-month continuity.'],
                    ['Projects', isAll ? 'Open the admin project workspace for project health, cashflow, and invoice context.' : 'Project workspace is only available to admin access.'],
                  ].map(([title, body]) => (
                    <div
                      key={title}
                      className="rounded-2xl p-3"
                      style={{
                        background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                        border: `1px solid ${dashboardStyles.line}`,
                      }}>
                      <p className="text-sm font-semibold" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{title}</p>
                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          {workspace === 'invoices' && (
          <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Invoices</h1>
              <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                <span className="live-dot" />
                <span>Live sync · {allRecords.length} invoice{allRecords.length !== 1 ? 's' : ''}</span>
                {syncing && <span style={{ color: 'var(--fin-warning)' }}>· syncing…</span>}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
              <div className="relative">
                <button onClick={() => setShowExportMenu(m => !m)} className="btn-ghost">
                  <Download size={14} />
                  <span className="hidden sm:inline">Export CSV</span>
                  <ChevronDown size={11} />
                </button>
                {showExportMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg border py-1 min-w-[180px]"
                      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-soft)' }}>
                      <button onClick={() => exportCsv(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                        <Download size={13} />
                        <span>Filtered ({records.length})</span>
                      </button>
                      <button onClick={() => exportCsv(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                        <Download size={13} />
                        <span>All records ({allRecords.length})</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={handlePrintInvoices} className="btn-ghost" title="Print invoice list">
                <Printer size={14} />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
                <ExternalLink size={14} />
                <span className="hidden sm:inline">Raise Externally</span>
                <span className="sm:hidden">Raise</span>
              </button>
              <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              {canCreateInvoice && (
                <button onClick={openNew} className="btn-primary">
                  <Plus size={14} />
                  <span>New Invoice</span>
                </button>
              )}
            </div>
          </div>
          {isStaleData && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)', color: 'var(--fin-warning)' }}>
              <WifiOff size={14} />
              <span>Live data unavailable — showing cached records. Some changes may not appear.</span>
            </div>
          )}
          </>
          )}

          {/* ── Retainers header ── */}
          {workspace === 'retainers' && (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Retainers</h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Monthly retainer invoices — use the Zoho form to raise externally.
              </p>
            </div>
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} /><span className="hidden sm:inline">Raise Externally</span>
            </button>
          </div>
          )}

          {/* ── (Projects workspace has its own header inside ProjectsWorkspace) ── */}


          {/* Invoice KPIs, status chips, overdue — only on invoices / retainers tabs */}
          {(workspace === 'invoices' || workspace === 'retainers') && (
            <>
              {/* ── RS Primary KPIs ── */}
              <section aria-label="Invoice metrics (₹)" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                <KpiCard tone={0} label="Total Raised (₹)"   value={sumLoading && !s ? null : fmt(s?.total_raised)}    icon={IndianRupee} />
                <KpiCard tone={1} label="Incl. GST (₹)"      value={sumLoading && !s ? null : fmt(s?.total_with_tax)}  icon={Receipt} />
                <KpiCard tone={2} label="Collected (₹)"      value={sumLoading && !s ? null : fmt(s?.total_received)}  icon={TrendingUp} semantic="positive" />
                <KpiCard tone={3} label="Outstanding (₹)"
                  value={sumLoading && !s ? null : fmt(s?.total_outstanding)}
                  icon={CalendarClock}
                  semantic={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
                  sub={(s?.total_outstanding || 0) > 0 ? `${s?.by_currency?.RS?.pending_count || s?.by_status?.Pending || 0} pending` : 'Fully collected'} />
                <KpiCard tone={4} label="Collection Rate (₹)"
                  value={sumLoading && !s ? null : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
                  icon={Percent}
                  semantic={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'} />
              </section>

              {/* ── Foreign Currency KPI rows (auto-appear when non-RS invoices exist) ── */}
              {s?.by_currency && Object.entries(s.by_currency)
                .filter(([cur]) => cur !== 'RS')
                .map(([cur, data]) => (
                  <section key={cur} aria-label={`Invoice metrics (${cur})`}
                    className="rounded-2xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                    <div className="col-span-full flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-btn)', color: '#fff' }}>{cur}</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{cur} Invoices — {data.count} total</span>
                    </div>
                    {[
                      { label: 'Raised',      val: data.raised,      tone: 0 },
                      { label: 'Incl. Tax',   val: data.with_tax,    tone: 1 },
                      { label: 'Collected',   val: data.received,    tone: 2, semantic: 'positive' },
                      { label: 'Outstanding', val: data.outstanding, tone: 3, semantic: data.outstanding > 0 ? 'warning' : 'positive',
                        sub: data.pending_count > 0 ? `${data.pending_count} pending` : 'Fully collected' },
                    ].map(({ label, val, tone, semantic, sub }) => (
                      <KpiCard key={label} tone={tone} label={`${label} (${currencySymbol(cur)})`}
                        value={fmtCurrency(val, cur)} semantic={semantic} sub={sub} />
                    ))}
                  </section>
                ))}

              {/* ── Status chips ── */}
              {s?.by_status && Object.keys(s.by_status).length > 0 && (
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(s.by_status).map(([status, count]) => {
                    const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
                    const Icon = m.icon
                    const active = statusFilter === status
                    // Show RS amount for this status from by_currency
                    const rsAmt = (() => {
                      if (!s?.by_currency?.RS) return null
                      if (status === 'Paid') return s.by_currency.RS.received
                      if (status === 'Pending') return s.by_currency.RS.outstanding
                      return null
                    })()
                    return (
                      <button key={status}
                        onClick={() => setStatusFilter(active ? '' : status)}
                        className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                        style={{
                          borderColor: active ? m.color : 'var(--card-border)',
                          background: active ? `${m.color}10` : 'var(--card-bg)',
                          boxShadow: active ? `0 0 0 2px ${m.color}30, var(--card-shadow)` : 'var(--card-shadow)',
                        }}
                        aria-pressed={active}>
                        <div className="kpi-icon flex-shrink-0" style={{ background: `${m.color}18` }}>
                          {Icon && <Icon size={18} style={{ color: m.color }} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                          <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                          {rsAmt != null && (
                            <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>{fmt(rsAmt)}</p>
                          )}
                        </div>
                        {active && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />}
                      </button>
                    )
                  })}
                </section>
              )}

              {/* ── Overdue alert (currency-aware amounts) ── */}
              {overdue.length > 0 && (
                <section className="rounded-2xl p-4 animate-slide-down"
                  style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertOctagon size={14} style={{ color: '#f87171' }} />
                    <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
                      {overdue.length} Overdue — pending more than 30 days
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {overdue.map((inv, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg flex-wrap"
                        style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.10)' }}>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                          <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                          {inv.currency && inv.currency !== 'RS' && (
                            <span className="text-[10px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{inv.currency}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>
                            {fmtCurrency(inv.amount, inv.currency || 'RS')}
                          </span>
                          <AgingBadge days={inv.aging} status="Pending" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {workspace === 'projects' && isAll && (
            <section>
              <ProjectsWorkspace />
            </section>
          )}

          {workspace === 'tax' && isAll && (
            <section>
              <TaxLedger source="web" />
            </section>
          )}

          {workspace === 'retainers' && (
            <section className="card space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                    <span> </span>
                    <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once it has been raised, store the final invoice number and details here.
                  </p>
                </div>
                <div className="relative">
                  <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={retainerMonth} onChange={e => setRetainerMonth(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none w-full" style={{ minWidth: 'min(100%, 170px)', paddingRight: '1.5rem' }}>
                    {retainerMonthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
              </div>

              {retainerGroups.length === 0 ? (
                <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No retainer templates found</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Create a normal invoice and set the category to your retainer category first.
                  </p>
                </div>
              ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="space-y-3">
                  {retainerGroups.map(group => (
                    <button
                      key={group.project}
                      type="button"
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="card p-3">
                          <p className="label">Tracking month</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthLabel(retainerMonth)}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month invoice #</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthRec?.['Invoice Number'] || 'Pending update'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Raised by</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month remark</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{monthRec?.['Remark'] || '—'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="label mb-2">Month Timeline</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                          {group.timeline.map(item => (
                            <button
                              key={item.key}
                              type="button"
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
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="label mb-0">Monthly Records</p>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            Bold month cards with direct record access
                          </span>
                        </div>
                        <div className="space-y-2">
                          {group.timeline.map(item => {
                            const rec = item.record
                            const f = rec?.fields || {}
                            const key = `${item.key}-${group.project}`
                            return (
                              <div key={key} className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                                style={{
                                  background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                  border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                                }}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                    <MonthStatusPill status={item.status} active={item.active} />
                                  </div>
                                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                                    {rec
                                      ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                      : 'No record created for this month yet'}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-wrap flex-shrink-0">
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
                        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
                          <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                            className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                            <ExternalLink size={12} />Open invoice request form
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

          {workspace === 'invoices' && projectSummaryCards.length > 0 && (
            <section className="card space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Click any project card to filter the invoice list.
                  </p>
                </div>
                {projectFilter && (
                  <button
                    onClick={() => setProjectFilter('')}
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                    <X size={11} />Clear project filter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {projectSummaryCards.map(({ project, metrics }) => {
                  const active = projectFilter === project
                  // Currencies used by this project, RS first
                  const currencies = (metrics.currencies || []).slice().sort((a, b) => a === 'RS' ? -1 : b === 'RS' ? 1 : 0)
                  const byCur = metrics.by_currency || {}
                  const hasMultiCur = currencies.length > 1 || (currencies.length === 1 && currencies[0] !== 'RS')
                  return (
                    <button
                      key={project}
                      type="button"
                      onClick={() => setProjectFilter(active ? '' : project)}
                      className="rounded-xl p-4 text-left transition-all"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                        boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.10)' : 'var(--shadow-sm)',
                      }}>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                            {hasMultiCur && currencies.filter(c => c !== 'RS').map(c => (
                              <span key={c} className="text-[10px] font-bold px-1 py-0.5 rounded"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                        {active && <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />}
                      </div>

                      {/* Per-currency amount rows */}
                      <div className="mt-3 space-y-2">
                        {currencies.length === 0 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                            {['Raised','Received','Open'].map(lbl => (
                              <div key={lbl}><p className="label">{lbl}</p><p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>—</p></div>
                            ))}
                          </div>
                        ) : currencies.map((cur) => {
                          const d = byCur[cur] || { raised: 0, received: 0, outstanding: 0 }
                          return (
                            <div key={cur}>
                              {hasMultiCur && (
                                <p className="text-[10px] font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                  {cur} {currencySymbol(cur)}
                                </p>
                              )}
                              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                                <div>
                                  <p className="label">Raised</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmtCurrency(d.raised, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Received</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(d.received, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Open</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: d.outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>
                                    {fmtCurrency(d.outstanding, cur)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Filter bar + invoice table — only on invoices / retainers tabs */}
          {(workspace === 'invoices' || workspace === 'retainers') && <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Invoice Filters</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {records.length} result{records.length !== 1 ? 's' : ''}
                </p>
              </div>
              {/* Billing type filter pills */}
              <div className="inline-flex items-center p-0.5 rounded-lg flex-shrink-0" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[140px] sm:min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search invoice #, project, description…"
                  className="input pl-8 py-1.5 text-xs" />
              </div>
              <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
                className={clsx('btn-icon flex items-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
                style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
                <Filter size={13} /><span className="text-xs">Filters</span>
                {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
              </button>
              {monthFilter && (
                <button onClick={() => setMonthFilter('')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                  {monthLabel(monthFilter)}<X size={10} />
                </button>
              )}
              {hasFilters && (
                <button onClick={() => {
                  setStatusFilter('')
                  setProjectFilter('')
                  setCategoryFilter('')
                  setRaisedByFilter('')
                  setBillingFilter('all')
                  setMonthFilter('')
                  setAgingBandFilter('')
                  setDateFieldFilter('Raised Date')
                  setDateFrom('')
                  setDateTo('')
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
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>
                <FilterSelect
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={picklists.Project || []}
                  placeholder="All projects"
                  icon={User}
                  width={150}
                />
                <FilterSelect
                  value={monthFilter}
                  onChange={setMonthFilter}
                  options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
                  placeholder="All months"
                  icon={CalendarClock}
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
                  icon={CalendarClock}
                  width={160}
                  clearable={false}
                />
                <div className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
                </div>
                <FilterSelect
                  value={agingBandFilter}
                  onChange={setAgingBandFilter}
                  options={['0-14d', '15-30d', '31-60d', '60d+']}
                  placeholder="All aging"
                  icon={AlertOctagon}
                  width={135}
                />
                <FilterSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={picklists.Category || []}
                  placeholder="All categories"
                  icon={Tag}
                  width={155}
                />
                <FilterSelect
                  value={raisedByFilter}
                  onChange={setRaisedByFilter}
                  options={picklists['Raised By'] || []}
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
                <div className="w-full" style={{ borderTop: '1px solid var(--card-border)', margin: '0.25rem 0' }} />
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
          </div>}

          {(workspace === 'invoices' || workspace === 'retainers') && <>
          {/* Error */}
          {(errorStatus === 403 || errorStatus === 401) ? (
            <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl text-center"
              style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(248,113,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={22} style={{ color: '#f87171' }} />
              </div>
              <div>
                <div className="font-semibold text-sm mb-1" style={{ color: '#f87171' }}>Access Restricted</div>
                <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                  You don't have permission to view web invoices.<br />
                  Please contact your administrator to request access.
                </div>
                <button onClick={refresh} className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: 'none', cursor: 'pointer', transition: 'background-color 150ms' }}
                  onMouseEnter={e => e.target.style.background = 'rgba(248,113,113,0.22)'}
                  onMouseLeave={e => e.target.style.background = 'rgba(248,113,113,0.15)'}>
                  Refresh
                </button>
              </div>
            </div>
          ) : error && (
            <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
              <AlertTriangle size={13} className="shrink-0" />{error}
              <button onClick={refresh} className="underline ml-1">retry</button>
            </div>
          )}

          {picklistPermissionMsg && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              <span>{picklistPermissionMsg}</span>
            </div>
          )}

          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {loading && !listData
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="card animate-pulse p-3.5">
                    <div className="flex justify-between mb-2.5">
                      <div className="skeleton h-3 w-2/5 rounded" />
                      <div className="skeleton h-5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton h-3 w-3/5 mb-3 rounded" />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                    </div>
                    <div className="flex justify-between mt-2.5">
                      <div className="skeleton h-3 w-1/4 rounded" />
                      <div className="skeleton h-3 w-1/5 rounded" />
                    </div>
                  </div>
                ))
              : records.length === 0
                ? <EmptyState
                    icon={<Receipt size={22} />}
                    title="No invoices found"
                    subtitle="Try adjusting your filters, or create a new invoice to get started."
                    action={<button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
                    compact
                  />
                : records.map(r => {
                    const f = r.fields || {}
                    const cur = f['Currency'] || 'RS'
                    const raised = Number(f['Amount Raised'] || 0)
                    const received = Number(f['Amount Received'] || 0)
                    const outstanding = Number(f['Outstanding Amount'] || 0)
                    const refs = parseAttachments(f['Reference'])
                    const pdfs = parseAttachments(f['Invoice PDF'])
                    const allFiles = [...refs, ...pdfs]
                    const aging = effectiveAging(f)
                    return (
                      <button key={r.id} onClick={() => openView(r)}
                        className="card-hover w-full text-left"
                        style={{ padding: '0.875rem 1rem' }}>

                        {/* Row 1: Invoice # + currency badge + status */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || <span style={{ color: 'var(--text-3)' }}>No number</span>}
                            </span>
                            {cur !== 'RS' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {cur}
                              </span>
                            )}
                          </div>
                          <StatusPill status={f['Payment Status']} />
                        </div>

                        {/* Row 2: Project · Category */}
                        <p className="text-[11px] truncate mb-2.5" style={{ color: 'var(--text-3)' }}>
                          <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{f['Project'] || '—'}</span>
                          {f['Category'] ? <span> · {f['Category']}</span> : null}
                          {f['Milestone'] ? <span> · {f['Milestone']}</span> : null}
                        </p>

                        {/* Row 3: Amounts — always show Raised; show Received if > 0; Outstanding in warning */}
                        <div className="grid gap-2 mb-2.5"
                          style={{ gridTemplateColumns: received > 0 && outstanding > 0 ? 'repeat(3,1fr)' : received > 0 || outstanding > 0 ? 'repeat(2,1fr)' : '1fr' }}>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Raised</p>
                            <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
                              {fmtCurrency(raised, cur)}
                            </p>
                          </div>
                          {received > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Received</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-positive)' }}>
                                {fmtCurrency(received, cur)}
                              </p>
                            </div>
                          )}
                          {outstanding > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-warning)' }}>
                                {fmtCurrency(outstanding, cur)}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Row 4: Meta bar — date, raised by, followup, files, aging */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {fmtDate(f['Raised Date'])}
                            </span>
                            {f['Raised By'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={13} />
                              </span>
                            )}
                            {f['Next followup'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] flex-shrink-0"
                                style={{ color: 'var(--fin-warning)' }}>
                                <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {allFiles.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                                <FileText size={10} />{allFiles.length}
                              </span>
                            )}
                            {aging > 0 && <AgingBadge days={aging} status={f['Payment Status']} />}
                          </div>
                        </div>
                      </button>
                    )
                  })
            }
          </div>

          {/* Desktop table */}
          <div className="hidden md:block card p-0 overflow-hidden" style={{ borderRadius: 14 }}>
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
                      : records.map((r, rowIndex) => {
                          const f = r.fields || {}
                          const outstanding = Number(f['Outstanding Amount'] || 0)
                          const refs = parseAttachments(f['Reference'])
                          const pdfs = parseAttachments(f['Invoice PDF'])
                          const allFiles = [...refs, ...pdfs]
                          const cur = f['Currency'] || 'RS'
                          const isHovered = hoveredRow === r.id
                          const statusMeta = STATUS_META[f['Payment Status']] || {}
                          const accentColor = statusMeta.color || 'var(--accent)'

                          const handleRowEnter = () => {
                            clearTimeout(hoverTimerRef.current)
                            hoverTimerRef.current = setTimeout(() => setHoveredRow(r.id), 250)
                          }
                          const handleRowLeave = () => {
                            clearTimeout(hoverTimerRef.current)
                            hoverTimerRef.current = setTimeout(() => setHoveredRow(null), 150)
                          }

                          return (
                            <Fragment key={r.id}>
                            <tr
                              className="tbl-row"
                              style={{
                                cursor: 'pointer',
                                background: isHovered ? 'var(--table-row-hover)' : rowIndex % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)',
                                borderLeft: isHovered ? `3px solid ${accentColor}` : '3px solid transparent',
                                boxShadow: isHovered ? 'var(--table-row-shadow)' : 'none',
                                transition: 'background-color 250ms cubic-bezier(0.4,0,0.2,1), border-color 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms cubic-bezier(0.4,0,0.2,1)',
                              }}
                              onClick={() => openView(r)}
                              onMouseEnter={handleRowEnter}
                              onMouseLeave={handleRowLeave}>
                              <td className="tbl-cell">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</span>
                                  {cur !== 'RS' && (
                                    <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{cur}</span>
                                  )}
                                </div>
                              </td>
                              <td className="tbl-cell"><span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Milestone'] || '—'}</span></td>
                              <td className="tbl-cell">
                                {f['Raised By']
                                  ? <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                      <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtCurrency(f['Amount with Tax'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(f['Amount Received'], cur)}</span></td>
                              <td className="tbl-cell">
                                {outstanding > 0
                                  ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmtCurrency(outstanding, cur)}</span>
                                  : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><StatusPill status={f['Payment Status']} /></td>
                              <td className="tbl-cell"><AgingBadge days={effectiveAging(f)} status={f['Payment Status']} /></td>
                              <td className="tbl-cell">
                                {f['Next followup']
                                  ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                      {fmtDate(f['Next followup'])}
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                {allFiles.length > 0 ? (
                                  <div className="flex items-center gap-1">
                                    {allFiles.slice(0, 2).map((a, i) => <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />)}
                                    {allFiles.length > 2 && <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>+{allFiles.length - 2}</span>}
                                  </div>
                                ) : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                  {f['Payment Status'] === 'Pending' && (
                                    <button
                                      type="button"
                                      onClick={() => openRecordPayment(r)}
                                      className="btn-primary"
                                      style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem' }}
                                    >
                                      <CheckCircle2 size={12} /><span className="text-[11px] font-semibold">Pay</span>
                                    </button>
                                  )}
                                  <button onClick={() => openView(r)}
                                    className="btn-ghost flex items-center gap-1.5"
                                    style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}>
                                    <Eye size={12} /><span className="text-[11px] font-semibold">View</span>
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* ── Hover-expand detail row ── */}
                            <tr
                              style={{ background: 'transparent' }}
                              onMouseEnter={handleRowEnter}
                              onMouseLeave={handleRowLeave}>
                              <td colSpan={15} style={{ padding: 0, border: 'none' }}>
                                <div style={{
                                  maxHeight: isHovered ? 320 : 0,
                                  overflow: 'hidden',
                                  transition: 'max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1)',
                                  opacity: isHovered ? 1 : 0,
                                }}>
                                  <div
                                    onClick={() => openView(r)}
                                    style={{
                                      cursor: 'pointer',
                                      margin: '0 0 4px 0',
                                      background: 'var(--glass-bg)',
                                      borderLeft: `3px solid ${accentColor}`,
                                      borderTop: '1px solid var(--glass-border)',
                                      borderBottom: '1px solid var(--glass-border)',
                                    }}>

                                    {/* Section 1: Metrics strip */}
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                                      padding: '10px 20px 10px 18px',
                                      borderBottom: '1px solid var(--glass-border)',
                                      background: `linear-gradient(90deg, ${accentColor}08 0%, transparent 60%)`,
                                    }}>
                                      <StatusPill status={f['Payment Status']} />
                                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', fontFamily: 'monospace', marginLeft: 2 }}>
                                        {f['Invoice Number'] || ''}
                                      </span>
                                      {cur !== 'RS' && (
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)' }}>{cur}</span>
                                      )}
                                      <span style={{ width: 1, height: 16, background: 'var(--glass-border)', margin: '0 6px' }} />
                                      {[
                                        { label: 'Raised', value: fmtCurrency(f['Amount Raised'], cur), color: 'var(--text-1)' },
                                        { label: 'Incl. GST', value: fmtCurrency(f['Amount with Tax'], cur), color: 'var(--text-2)' },
                                        { label: 'Received', value: fmtCurrency(f['Amount Received'], cur), color: 'var(--fin-positive)' },
                                        outstanding > 0 ? { label: 'Outstanding', value: fmtCurrency(outstanding, cur), color: 'var(--fin-warning)' } : null,
                                      ].filter(Boolean).map((chip, ci) => (
                                        <span key={chip.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                                          {ci > 0 && <span style={{ color: 'var(--text-3)', fontSize: 10 }}>·</span>}
                                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>{chip.label}</span>
                                          <span style={{ fontSize: 12, color: chip.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{chip.value}</span>
                                        </span>
                                      ))}
                                      <span style={{ marginLeft: 'auto' }}>
                                        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                                      </span>
                                    </div>

                                    {/* Section 2: Two-column body */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

                                      {/* Left: entity fields */}
                                      <div style={{
                                        display: 'flex', flexDirection: 'column', gap: 10,
                                        padding: '12px 20px 12px 18px',
                                        borderRight: '1px solid var(--glass-border)',
                                      }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                                          {[
                                            { label: 'Project', value: f['Project'] },
                                            { label: 'Category', value: f['Category'] },
                                            { label: 'Milestone', value: f['Milestone'] },
                                          ].filter(x => x.value).map(x => (
                                            <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{x.label}</span>
                                              <span style={{ fontSize: 12, color: x.label === 'Project' ? 'var(--text-1)' : 'var(--text-2)', fontWeight: x.label === 'Project' ? 600 : 400, lineHeight: 1.4 }}>{x.value}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {f['Raised By'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised By</span>
                                            <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={18} />
                                          </div>
                                        )}
                                      </div>

                                      {/* Right: text + dates */}
                                      <div style={{
                                        display: 'flex', flexDirection: 'column', gap: 8,
                                        padding: '12px 20px',
                                      }}>
                                        {f['Description'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Description']}</span>
                                          </div>
                                        )}
                                        {f['Remark'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Remark</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Remark']}</span>
                                          </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 'auto' }}>
                                          {f['Raised Date'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised</span>
                                              <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Raised Date'])}</span>
                                            </div>
                                          )}
                                          {f['Cleared Date'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cleared</span>
                                              <span style={{ fontSize: 11, color: 'var(--fin-positive)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Cleared Date'])}</span>
                                            </div>
                                          )}
                                          {f['Next followup'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next Followup</span>
                                              <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>{fmtDate(f['Next followup'])}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Section 3: Footer — attachments + actions */}
                                    <div
                                      onClick={e => e.stopPropagation()}
                                      style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '8px 20px 8px 18px',
                                        borderTop: '1px solid var(--glass-border)',
                                        background: 'var(--bg-input)',
                                        gap: 12,
                                      }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {allFiles.length > 0 ? (
                                          <>
                                            {allFiles.slice(0, 5).map((a, i) => (
                                              <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />
                                            ))}
                                            {allFiles.length > 5 && (
                                              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>+{allFiles.length - 5} more</span>
                                            )}
                                          </>
                                        ) : (
                                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No attachments</span>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {f['Payment Status'] === 'Pending' && (
                                          <button
                                            onClick={() => openRecordPayment(r)}
                                            className="btn-ghost flex items-center gap-1.5"
                                            style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--fin-positive)', borderColor: 'rgba(34,197,94,0.35)' }}>
                                            <CheckCircle2 size={11} />
                                            <span style={{ fontSize: 11, fontWeight: 600 }}>Record Payment</span>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => openView(r)}
                                          className="btn-ghost flex items-center gap-1.5"
                                          style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.35)' }}>
                                          <Eye size={11} />
                                          <span style={{ fontSize: 11, fontWeight: 600 }}>View Details</span>
                                        </button>
                                      </div>
                                    </div>

                                  </div>
                                </div>
                              </td>
                            </tr>
                            </Fragment>
                          )
                        })
                  }
                </tbody>
                {records.length > 0 && (() => {
                  const tot = records.reduce((acc, r) => {
                    const f = r.fields || {}
                    acc.raised      += Number(f['Amount Raised']      || 0)
                    acc.withTax     += Number(f['Amount with Tax']    || 0)
                    acc.received    += Number(f['Amount Received']    || 0)
                    acc.outstanding += Number(f['Outstanding Amount'] || 0)
                    return acc
                  }, { raised: 0, withTax: 0, received: 0, outstanding: 0 })
                  const fmtTot = n => fmtCurrency(n, 'RS')
                  return (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-layer)' }}>
                        <td colSpan={6} className="tbl-cell font-semibold text-xs" style={{ color: 'var(--text-2)' }}>
                          Totals · {records.length} invoice{records.length !== 1 ? 's' : ''}
                        </td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--text-1)' }}>{fmtTot(tot.raised)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--text-1)' }}>{fmtTot(tot.withTax)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--fin-positive)' }}>{fmtTot(tot.received)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: tot.outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmtTot(tot.outstanding)}</td>
                        <td colSpan={5} />
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>
          </div>
          </>}

        </div>
      </main>
      {/* Mobile bottom nav — hidden sm+ */}
      <MobileBottomNav workspace={workspace} setWorkspace={setWorkspace} isAll={isAll} />

      {/* Drawers — always rendered so exit animations play */}
      <InvoiceDetail
        key={`detail-${drawerKey}`}
        open={drawer?.mode === 'view'}
        invoice={drawer?.mode === 'view' ? drawer.invoice : null}
        onClose={closeDrawer}
        onEdit={() => { setDrawerKey(k => k + 1); setDrawer({ mode: 'edit', invoice: drawer?.invoice }) }}
        onRecordPayment={() => {
          if (drawer?.invoice) openRecordPayment(drawer.invoice)
        }}
        isEditor={true}
        onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })}
        avatarMap={avatarMap}
      />
      <InvoiceDrawer
        key={`form-${drawerKey}`}
        open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
        invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
        draft={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.draft : null}
        paymentOnly={drawer?.mode === 'payment'}
        onClose={closeDrawer}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        picklists={picklists}
        onOptionsUpdate={handleOptionsUpdate}
        canEditPicklists={canEditPicklists}
        onPicklistPermissionError={handlePicklistPermissionError}
      />
      {helpOpen && createPortal(
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />,
        document.body
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
      </div>
    </div>
  )
}
