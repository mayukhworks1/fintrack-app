import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, CalendarDays, User, Tag, ArrowRight, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'

/* ── Constants ──────────────────────────────────────────────────────────── */
const PROJECTS   = ['Innovine', 'PMS', 'Maitrimetal Workspace migration']
const CATEGORIES = ['BUG Fixing', 'Development- Retainer', 'Phase 1.1', 'Phase 1.2', 'Change Request', 'ZOHO', 'Overtime', 'Phase 1.3']
const MILESTONES = ['Advance', 'Prehandover', 'Post go Live', 'Bug Fix']
const RAISED_BY  = ['Mayukh', 'Hardik']
const STATUSES   = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
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
      mime: a.mimeType || '',
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
function AgingBadge({ days }) {
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
function AttachThumb({ a, size = 28 }) {
  const [err, setErr] = useState(false)
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      title={a.name}
      className="flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center border transition-opacity hover:opacity-75"
      style={{ width: size, height: size, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.08)' : 'var(--glass-bg)' }}
      onClick={e => e.stopPropagation()}>
      {isImage(a) && !err
        ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : isPdf(a)
          ? <FileText size={Math.round(size * 0.45)} style={{ color: '#f87171' }} />
          : <ImageIcon size={Math.round(size * 0.45)} style={{ color: 'var(--text-3)' }} />
      }
    </a>
  )
}

/* ── Full Attachment card ────────────────────────────────────────────────── */
function AttachCard({ a }) {
  const [err, setErr] = useState(false)
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className="group flex items-center gap-3 p-2.5 rounded-xl border transition-all"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.borderColor = 'var(--glass-border-hi)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass-bg)';       e.currentTarget.style.borderColor = 'var(--glass-border)' }}>
      <div className="rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
        style={{ width: 44, height: 44, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.10)' : 'var(--bg-input)' }}>
        {isImage(a) && !err
          ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
          : isPdf(a)
            ? <FileText size={20} style={{ color: '#f87171' }} />
            : <ImageIcon size={20} style={{ color: 'var(--text-3)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isPdf(a) ? 'PDF Document' : 'Image'} · click to open</p>
      </div>
      <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-2)' }} />
    </a>
  )
}

/* ── KPI card — horizontal layout with colored icon tile ──────────────────── */
const KPI_TILE_PALETTE = [
  { bg: '#fef3c7', fg: '#d97706' },  // amber
  { bg: '#dbeafe', fg: '#2563eb' },  // blue
  { bg: '#dcfce7', fg: '#16a34a' },  // green
  { bg: '#fce7f3', fg: '#db2777' },  // pink
  { bg: '#ede9fe', fg: '#7c3aed' },  // violet
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
        <div className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: 40, height: 40, background: palette.bg, color: palette.fg }}>
          <Icon size={18} aria-hidden="true" />
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
function InvoiceDetail({ invoice, onClose, onEdit, isEditor }) {
  if (!invoice) return null
  const f = invoice.fields || {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const outstanding = Number(f['Outstanding Amount'] || 0)

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full animate-slide-in"
        style={{ width: 'min(100vw,500px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

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

          {/* Amount grid */}
          <div className="grid grid-cols-2 gap-2.5">
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
          <div className="grid grid-cols-3 gap-3">
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
                  <div className="space-y-2">{refs.map((a, i) => <AttachCard key={i} a={a} />)}</div>
                </div>
              )}
              {pdfs.length > 0 && (
                <div>
                  <p className="label mb-2">Invoice PDF{pdfs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{pdfs.map((a, i) => <AttachCard key={i} a={a} />)}</div>
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

function InvoiceDrawer({ invoice, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(invoice?.id)
  const [form,       setForm]      = useState(EMPTY_FORM)
  const [saving,     setSaving]    = useState(false)
  const [deleting,   setDeleting]  = useState(false)
  const [confirmDel, setConfirmDel]= useState(false)
  const [error,      setError]     = useState('')

  useEffect(() => {
    if (!invoice) { setForm(EMPTY_FORM); return }
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
  }, [invoice])

  const set  = k => v   => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev  => setForm(f => ({ ...f, [k]: ev.target.value }))

  async function handleSave() {
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

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full overflow-hidden animate-slide-in"
        style={{ width: 'min(100vw,520px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>
            {isEdit ? `Edit · ${invoice.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </Field>
            <Field label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <SelectInput value={form.project} onChange={set('project')} options={PROJECTS} placeholder="Select project…" />
            </Field>
            <Field label="Category">
              <SelectInput value={form.category} onChange={set('category')} options={CATEGORIES} placeholder="Select…" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Milestone">
              <SelectInput value={form.milestone} onChange={set('milestone')} options={MILESTONES} placeholder="Select…" />
            </Field>
            <Field label="Raised By">
              <SelectInput value={form.raised_by} onChange={set('raised_by')} options={RAISED_BY} placeholder="Select…" />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></Field>
            <Field label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Raised (₹)"><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></Field>
            <Field label="With GST (₹)"><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></Field>
            <Field label="Received (₹)"><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></Field>
          </div>
          <Field label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </Field>
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
      {[80, 100, 90, 80, 100, 90, 90, 72, 72, 48, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell">
          <div className="skeleton h-3 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function Invoices() {
  const { isEditor } = useAuth()
  const [statusFilter,   setStatusFilter]   = useState('')
  const [projectFilter,  setProjectFilter]  = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [search,         setSearch]         = useState('')
  const [showFilters,    setShowFilters]    = useState(false)
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer, setDrawer] = useState(null)

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

  /* ── Client-side filter (category, raisedBy, freetext) ── */
  const records = allRecords.filter(r => {
    const f = r.fields || {}
    if (categoryFilter && f['Category'] !== categoryFilter) return false
    if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
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

  const s = summary
  const overdue = s?.overdue_invoices || []
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || search

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
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center gap-1 cursor-pointer select-none section-title"
        style={{ color: active ? 'var(--text-2)' : 'var(--text-3)', background: 'none', border: 'none', padding: 0 }}>
        {children}<ArrowUpDown size={10} style={{ opacity: active ? 0.9 : 0.25 }} />
      </button>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>
            Invoice Tracking
          </h1>
          <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            <span className="live-dot" />
            <span>Live sync · {allRecords.length} invoice{allRecords.length !== 1 ? 's' : ''}</span>
            {syncing && <span style={{ color: 'var(--fin-warning)' }}>· syncing…</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {isEditor && (
            <button onClick={openNew} className="btn-primary">
              <Plus size={14} />
              <span className="hidden sm:inline">New Invoice</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Invoice metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard tone={0} label="Total Raised" value={sumLoading && !s ? null : fmt(s?.total_raised)}    icon={IndianRupee} />
        <KpiCard tone={1} label="Incl. GST"    value={sumLoading && !s ? null : fmt(s?.total_with_tax)}  icon={Receipt} />
        <KpiCard tone={2} label="Collected"    value={sumLoading && !s ? null : fmt(s?.total_received)}  icon={TrendingUp} semantic="positive" />
        <KpiCard tone={3} label="Outstanding"
          value={sumLoading && !s ? null : fmt(s?.total_outstanding)}
          icon={CalendarClock}
          semantic={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
          sub={(s?.total_outstanding || 0) > 0
            ? `${s?.by_status?.Pending || 0} pending`
            : 'Fully collected'} />
        <KpiCard tone={4} label="Collection Rate"
          value={sumLoading && !s ? null : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
          icon={Percent}
          semantic={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'} />
      </section>

      {/* ── Status chips — click to filter, shows count + total amount ── */}
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
            const Icon = m.icon
            const active = statusFilter === status
            const amount = s?.by_status_amounts?.[status]
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
              {overdue.length} Overdue — pending more than 30 days
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
                  <AgingBadge days={inv.aging} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Filter bar ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, project, description…"
              className="input pl-8 py-1.5 text-xs" />
          </div>
          <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
            className={clsx('btn-icon flex items-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
            style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
            <Filter size={13} />
            <span className="text-xs">Filters</span>
            {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
          </button>
          {hasFilters && (
            <button onClick={() => { setStatusFilter(''); setProjectFilter(''); setCategoryFilter(''); setRaisedByFilter(''); setSearch('') }}
              className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
              <X size={11} />Clear
            </button>
          )}
          <span className="text-xs whitespace-nowrap ml-auto" style={{ color: 'var(--text-3)' }}>
            {records.length} result{records.length !== 1 ? 's' : ''}
          </span>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            {/* Project — server-side */}
            <div className="relative">
              <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
                className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 140, paddingRight: '1.5rem' }}>
                <option value="">All projects</option>
                {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>
            {/* Category — client-side */}
            <div className="relative">
              <Tag size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 160, paddingRight: '1.5rem' }}>
                <option value="">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>
            {/* Raised By — client-side */}
            <div className="relative">
              <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={raisedByFilter} onChange={e => setRaisedByFilter(e.target.value)}
                className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 130, paddingRight: '1.5rem' }}>
                <option value="">Anyone</option>
                {RAISED_BY.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>
          </div>
        )}
      </div>

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
      <div className="md:hidden space-y-2.5">
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
                    className="card-hover w-full text-left animate-slide-up"
                    style={{ padding: '0.875rem 1rem' }}>
                    {/* Top: invoice # + status */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                          {f['Invoice Number'] || '—'}
                        </p>
                        <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {f['Project'] || '—'} {f['Category'] ? `· ${f['Category']}` : ''}
                        </p>
                      </div>
                      <StatusPill status={f['Payment Status']} />
                    </div>
                    {/* Middle: amounts */}
                    <div className="flex items-end justify-between gap-3 mb-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Amount</p>
                        <p className="font-bold tabular-nums text-base" style={{ color: 'var(--text-1)' }}>
                          {fmt(f['Amount Raised'])}
                        </p>
                      </div>
                      {outstanding > 0 && (
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                          <p className="font-bold tabular-nums text-sm" style={{ color: 'var(--fin-warning)' }}>
                            {fmt(outstanding)}
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Bottom: meta */}
                    <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
                      <span className="tabular-nums">{fmtDate(f['Raised Date'])}</span>
                      <div className="flex items-center gap-2">
                        {allFiles.length > 0 && (
                          <span className="flex items-center gap-0.5"><FileText size={10} />{allFiles.length}</span>
                        )}
                        <AgingBadge days={f['Agening (Days)']} />
                      </div>
                    </div>
                  </button>
                )
              })
        }
      </div>

      {/* ── Desktop table (md+) ── */}
      <div className="hidden md:block card p-0 overflow-hidden" style={{ borderRadius: 14 }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th className="tbl-head"><SortLabel col="Invoice Number">Invoice #</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Project">Project</SortLabel></th>
                <th className="tbl-head">Category</th>
                <th className="tbl-head"><SortLabel col="Raised Date">Raised</SortLabel></th>
                <th className="tbl-head"><SortLabel col="Amount Raised">Amount</SortLabel></th>
                <th className="tbl-head">GST Total</th>
                <th className="tbl-head">Received</th>
                <th className="tbl-head">Outstanding</th>
                <th className="tbl-head">Status</th>
                <th className="tbl-head"><SortLabel col="Agening (Days)">Aging</SortLabel></th>
                <th className="tbl-head">Docs</th>
                <th className="tbl-head" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {loading && !listData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={12} className="px-4 py-14 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      No invoices found.{' '}
                      <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline">Create one</button>
                    </td></tr>
                  : records.map(r => {
                      const f = r.fields || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      const refs = parseAttachments(f['Reference'])
                      const pdfs = parseAttachments(f['Invoice PDF'])
                      const allFiles = [...refs, ...pdfs]

                      return (
                        <tr key={r.id} className="tbl-row" style={{ cursor: 'pointer' }}
                          onClick={() => openView(r)}>

                          <td className="tbl-cell">
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || '—'}
                            </span>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span>
                          </td>
                          <td className="tbl-cell">
                            <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span>
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
                            <AgingBadge days={f['Agening (Days)']} />
                          </td>

                          {/* Attachment thumbs */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                            {allFiles.length > 0 ? (
                              <div className="flex items-center gap-1">
                                {allFiles.slice(0, 2).map((a, i) => (
                                  <AttachThumb key={i} a={a} size={28} />
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

      {/* ── Drawers — rendered via portal to escape overflow/transform stacking contexts ── */}
      {drawer?.mode === 'view' && createPortal(
        <InvoiceDetail
          invoice={drawer.invoice}
          onClose={closeDrawer}
          onEdit={() => isEditor && setDrawer({ mode: 'edit', invoice: drawer.invoice })}
          isEditor={isEditor}
        />,
        document.body
      )}
      {isEditor && (drawer?.mode === 'new' || drawer?.mode === 'edit') && createPortal(
        <InvoiceDrawer
          invoice={drawer.mode === 'edit' ? drawer.invoice : null}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />,
        document.body
      )}
    </div>
  )
}
