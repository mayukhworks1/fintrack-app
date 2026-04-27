import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  TrendingUp, IndianRupee, Percent, CalendarClock, ArrowUpDown,
  Save, Trash2, Image as ImageIcon, Filter, AlertOctagon,
  CalendarDays, User, Tag
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr, formatPct } from '../utils/format'
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
const fmtDateLong = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

/** Parse Teable attachment cell (space-separated "name url" pairs). */
function parseAttachments(cell) {
  if (!cell) return []
  // Teable returns array of objects with name+url, or raw text "name url"
  if (Array.isArray(cell)) {
    return cell.map(a => ({
      name: a.name || a.filename || 'Attachment',
      url:  a.url  || a.presignedUrl || '',
      mime: a.mimeType || '',
    }))
  }
  // Fallback: split on whitespace, even/odd = name/url
  const parts = String(cell).split(/\s+/)
  const result = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) result.push({ name: decodeURIComponent(parts[i].replace(/_x20_/g,' ')), url: parts[i + 1], mime: '' })
  }
  return result
}

const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}
const isPdf = (a) => {
  if (a.mime === 'application/pdf') return true
  return /\.pdf(\?|$)/i.test(a.url) || a.name?.toLowerCase().endsWith('.pdf')
}

/* ── Status meta ─────────────────────────────────────────────────────────── */
const STATUS_META = {
  Paid:      { color: '#4ade80', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.2)',  icon: CheckCircle2 },
  Pending:   { color: '#fbbf24', bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.2)',  icon: Clock },
  Cancelled: { color: '#f87171', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.2)',  icon: XCircle },
}

function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--bg-input)', border: 'var(--glass-border)' }
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color }}>
      {Icon && <Icon size={10} />}{status}
    </span>
  )
}

/* ── KPI card ────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon: Icon, accent, loading }) {
  const color = accent === 'positive' ? '#4ade80' : accent === 'warning' ? '#fbbf24' : accent === 'negative' ? '#f87171' : 'var(--text-1)'
  return (
    <div className="card animate-scale-in">
      <div className="flex items-center justify-between mb-3">
        <p className="section-title">{label}</p>
        {Icon && <Icon size={13} style={{ color: 'var(--text-3)' }} />}
      </div>
      {loading ? (
        <div className="skeleton h-7 w-3/4 mb-2 rounded" />
      ) : (
        <p className="font-bold tabular-nums leading-none"
          style={{ fontSize: 'clamp(1.15rem,3vw,1.6rem)', color, letterSpacing: '-0.025em', wordBreak: 'break-word' }}>
          {value ?? '—'}
        </p>
      )}
      {sub && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

/* ── Attachment ──────────────────────────────────────────────────────────── */
function Attachment({ a, compact = false }) {
  const [imgError, setImgError] = useState(false)
  const img = isImage(a) && !imgError

  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className={`group flex items-center gap-2 rounded-xl overflow-hidden border transition-all
        ${compact ? 'px-2 py-1.5' : 'p-2'}`}
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--glass-border-hi)'; e.currentTarget.style.background = 'var(--glass-bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)';    e.currentTarget.style.background = 'var(--glass-bg)' }}>
      {img ? (
        <img src={a.url} alt={a.name} onError={() => setImgError(true)}
          className="rounded-lg object-cover flex-shrink-0"
          style={{ width: compact ? 28 : 44, height: compact ? 28 : 44 }} />
      ) : (
        <div className="rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ width: compact ? 28 : 44, height: compact ? 28 : 44, background: isPdf(a) ? 'rgba(239,68,68,0.12)' : 'var(--bg-input)' }}>
          {isPdf(a) ? <FileText size={compact ? 13 : 18} style={{ color: '#f87171' }} /> : <ImageIcon size={compact ? 13 : 18} style={{ color: 'var(--text-3)' }} />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
        {!compact && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isPdf(a) ? 'PDF Document' : 'Image'}</p>}
      </div>
      <ExternalLink size={11} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-3)' }} />
    </a>
  )
}

/* ── Invoice detail drawer ───────────────────────────────────────────────── */
function InvoiceDetail({ invoice, onClose, onEdit }) {
  if (!invoice) return null
  const f = invoice.fields || {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const outstanding = Number(f['Outstanding Amount'] || 0)

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full animate-slide-in"
        style={{ width: 'min(100vw, 500px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <p className="font-bold text-sm" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              {f['Invoice Number'] || '—'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {f['Project']} · {f['Category']}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Edit</button>
            <button onClick={onClose} className="btn-icon"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status + speed row */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>{f['Speed']}</span>}
            {f['Milestone'] && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>{f['Milestone']}</span>}
          </div>

          {/* Description */}
          {f['Description'] && (
            <div className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-1.5">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>{f['Description']}</p>
            </div>
          )}

          {/* Amount grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',    f['Amount Raised'],       'var(--text-1)'],
              ['With GST (18%)',   f['Amount with Tax'],     'var(--text-1)'],
              ['Amount Received',  f['Amount Received'],     '#4ade80'],
              ['Outstanding',      f['Outstanding Amount'],  outstanding > 0 ? '#fbbf24' : '#4ade80'],
            ].map(([label, val, color]) => (
              <div key={label} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1">{label}</p>
                <p className="font-bold tabular-nums text-base" style={{ color }}>{fmt(val)}</p>
              </div>
            ))}
          </div>

          {/* Dates + computed */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ['Raised',    f['Raised Date']],
              ['Cleared',   f['Cleared Date']],
              ['Followup',  f['Next followup']],
              ['Days to Clear', f['Days To Clear'] != null ? `${f['Days To Clear']} days` : '—'],
              ['Aging',     f['Agening (Days)']   != null ? `${f['Agening (Days)']} days`  : '—'],
              ['Raised By', f['Raised By'] || '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="label">{label}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
                  {label === 'Raised' || label === 'Cleared' || label === 'Followup' ? fmtDateLong(val) : val}
                </p>
              </div>
            ))}
          </div>

          {/* Remark */}
          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {/* Attachments */}
          {(refs.length > 0 || pdfs.length > 0) && (
            <div>
              <p className="label mb-2.5">Attachments</p>
              <div className="space-y-2">
                {refs.map((a, i) => (
                  <div key={`ref-${i}`}>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Payment Reference</p>
                    <Attachment a={a} />
                  </div>
                ))}
                {pdfs.map((a, i) => (
                  <div key={`pdf-${i}`}>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Invoice PDF</p>
                    <Attachment a={a} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

/* ── Invoice form drawer ─────────────────────────────────────────────────── */
function SelectInput({ value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="input appearance-none pr-7">
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function InvoiceDrawer({ invoice, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(invoice?.id)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState('')

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

  const set = k => v => setForm(f => ({ ...f, [k]: v }))
  const setE = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        amount_raised:   form.amount_raised   !== '' ? Number(form.amount_raised)   : undefined,
        amount_with_tax: form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
        amount_received: form.amount_received !== '' ? Number(form.amount_received) : undefined,
        raised_date:     form.raised_date    ? `${form.raised_date}T00:00:00.000Z`    : undefined,
        cleared_date:    form.cleared_date   ? `${form.cleared_date}T00:00:00.000Z`   : undefined,
        next_followup:   form.next_followup  ? `${form.next_followup}T00:00:00.000Z`  : undefined,
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
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full overflow-hidden animate-slide-in"
        style={{ width: 'min(100vw, 520px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>
            {isEdit ? `Edit · ${invoice.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} className="btn-icon"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice Number"><input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" /></Field>
            <Field label="Status"><SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project"><SelectInput value={form.project} onChange={set('project')} options={PROJECTS} placeholder="Select project…" /></Field>
            <Field label="Category"><SelectInput value={form.category} onChange={set('category')} options={CATEGORIES} placeholder="Select…" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Milestone"><SelectInput value={form.milestone} onChange={set('milestone')} options={MILESTONES} placeholder="Select…" /></Field>
            <Field label="Raised By"><SelectInput value={form.raised_by} onChange={set('raised_by')} options={RAISED_BY} placeholder="Select…" /></Field>
          </div>
          <Field label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></Field>
            <Field label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount Raised (₹)"><input type="number" className="input" value={form.amount_raised} onChange={setE('amount_raised')} placeholder="0" /></Field>
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
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }}>
              <Trash2 size={12} />
              {deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }}>
              <Save size={12} />
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create invoice'}
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
    <tr aria-hidden="true">
      {[80, 100, 90, 80, 100, 90, 90, 70, 60, 50].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="skeleton h-3 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

/* ── Aging badge ─────────────────────────────────────────────────────────── */
function AgingBadge({ days }) {
  if (days == null || days === '') return <span style={{ color: 'var(--text-3)' }}>—</span>
  const d = Number(days)
  const color  = d > 30 ? '#f87171' : d > 14 ? '#fbbf24' : '#4ade80'
  const label  = `${d}d`
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums"
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
      {label}
    </span>
  )
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function Invoices() {
  const [statusFilter,   setStatusFilter]   = useState('')
  const [projectFilter,  setProjectFilter]  = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [search,         setSearch]         = useState('')
  const [showFilters,    setShowFilters]     = useState(false)
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer, setDrawer] = useState(null)  // { mode: 'view'|'edit'|'new', invoice }

  /* ── Data ── */
  const fetchSummary = useCallback(() => api.invoices.summary(), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 8_000)

  const fetchRecords = useCallback(() =>
    api.invoices.list({
      status:   statusFilter  || undefined,
      project:  projectFilter || undefined,
      limit:    500,
      order_by: sortCol,
      order:    sortDir,
    }), [statusFilter, projectFilter, sortCol, sortDir])

  const { data: listData, loading, error, refresh, syncing } = useAutoRefresh(fetchRecords, 8_000)
  const allRecords = listData?.records || []

  /* ── Client-side filter (category, raisedBy, search) ── */
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

  /* ── Overdue (pending + aging > 30 days) ── */
  const overdue = summary?.overdue_invoices || []
  const pendingCount = summary?.by_status?.Pending || 0

  /* ── Drawer helpers ── */
  const openNew    = () => setDrawer({ mode: 'new',  invoice: null })
  const openView   = r  => setDrawer({ mode: 'view', invoice: r   })
  const closeDrawer = () => setDrawer(null)
  const handleSaved   = () => { refresh(); closeDrawer() }
  const handleDeleted = () => { refresh(); closeDrawer() }

  /* ── Sort ── */
  function handleSort(col) {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col }
      setSortDir('desc'); return col
    })
  }

  function SortTh({ col, children, className = '' }) {
    const active = sortCol === col
    return (
      <th onClick={() => handleSort(col)}
        className={`px-4 py-3 text-left cursor-pointer select-none whitespace-nowrap ${className}`}
        style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}>
        <span className="inline-flex items-center gap-1 section-title" style={{ color: 'inherit' }}>
          {children}
          <ArrowUpDown size={10} style={{ opacity: active ? 1 : 0.3 }} />
        </span>
      </th>
    )
  }

  const hasActiveFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || search
  const s = summary

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>
            Invoice Tracking
          </h1>
          <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            <span className="live-dot" />
            <span>Live sync · {allRecords.length} invoice{allRecords.length !== 1 ? 's' : ''}</span>
            {syncing && <span style={{ color: '#fbbf24' }}>· syncing…</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={openNew} className="btn-primary">
            <Plus size={14} />
            <span className="hidden sm:inline">New Invoice</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <section aria-label="Invoice metrics" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard label="Total Raised"    value={fmt(s?.total_raised)}     icon={IndianRupee}  loading={sumLoading && !s} />
        <KpiCard label="With GST"        value={fmt(s?.total_with_tax)}    icon={Receipt}      loading={sumLoading && !s} />
        <KpiCard label="Collected"       value={fmt(s?.total_received)}    icon={TrendingUp}   accent="positive" loading={sumLoading && !s} />
        <KpiCard label="Outstanding"     value={fmt(s?.total_outstanding)} icon={CalendarClock}
          accent={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
          sub={(s?.total_outstanding || 0) > 0 ? `${pendingCount} pending invoice${pendingCount !== 1 ? 's' : ''}` : 'Fully collected'}
          loading={sumLoading && !s} />
        <KpiCard label="Collection Rate"
          value={s ? `${s.collection_rate?.toFixed(1) ?? '0'}%` : '—'}
          icon={Percent}
          accent={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
          loading={sumLoading && !s} />
      </section>

      {/* ── Status filter chips ── */}
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section className="grid grid-cols-3 gap-2.5">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--glass-bg)', border: 'var(--glass-border)' }
            const Icon = m.icon
            const active = statusFilter === status
            return (
              <button key={status}
                onClick={() => setStatusFilter(active ? '' : status)}
                className="card flex items-center gap-3 p-3 transition-all cursor-pointer"
                style={{
                  borderColor: active ? m.color : 'var(--glass-border)',
                  background: active ? m.bg : 'var(--glass-bg)',
                  textAlign: 'left',
                }}
                aria-pressed={active}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${m.color}18` }}>
                  {Icon && <Icon size={15} style={{ color: m.color }} />}
                </div>
                <div>
                  <p className="font-bold text-base tabular-nums leading-tight" style={{ color: m.color }}>{count}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{status}</p>
                </div>
              </button>
            )
          })}
        </section>
      )}

      {/* ── Overdue alert ── */}
      {overdue.length > 0 && (
        <section className="rounded-xl p-4 animate-slide-down" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertOctagon size={14} style={{ color: '#f87171' }} />
            <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
              {overdue.length} Overdue Invoice{overdue.length !== 1 ? 's' : ''} (&gt;30 days)
            </p>
          </div>
          <div className="space-y-2">
            {overdue.map((inv, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                <div>
                  <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums font-medium" style={{ color: '#fbbf24' }}>{fmt(inv.amount)}</span>
                  <AgingBadge days={inv.aging} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Filter bar ── */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, project, category…" className="input pl-8 py-1.5 text-xs" />
          </div>

          {/* Toggle advanced filters */}
          <button onClick={() => setShowFilters(f => !f)}
            className="btn-icon flex items-center gap-1.5 px-3" style={{ fontSize: '0.75rem' }}
            aria-expanded={showFilters}>
            <Filter size={13} />
            <span className="text-xs">Filters</span>
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ background: 'var(--accent)' }} />}
          </button>

          {hasActiveFilters && (
            <button onClick={() => { setStatusFilter(''); setProjectFilter(''); setCategoryFilter(''); setRaisedByFilter(''); setSearch('') }}
              className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
              <X size={11} /> Clear all
            </button>
          )}

          <span className="text-xs ml-auto whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
            {records.length} result{records.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Advanced filter pills */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            <div className="relative">
              <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
                className="input pl-7 pr-7 py-1.5 text-xs" style={{ width: 'auto', minWidth: 130 }}>
                <option value="">All projects</option>
                {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>

            <div className="relative">
              <Tag size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                className="input pl-7 pr-7 py-1.5 text-xs" style={{ width: 'auto', minWidth: 160 }}>
                <option value="">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>

            <div className="relative">
              <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={raisedByFilter} onChange={e => setRaisedByFilter(e.target.value)}
                className="input pl-7 pr-7 py-1.5 text-xs" style={{ width: 'auto', minWidth: 120 }}>
                <option value="">Raised by anyone</option>
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
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          <AlertTriangle size={13} /> {error}
          {error.toLowerCase().includes('not found') && <span style={{ color: 'var(--text-3)' }}> — Backend deploying, auto-retrying every 8 s</span>}
          <button onClick={refresh} className="underline ml-1">retry now</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card overflow-hidden p-0" style={{ borderRadius: 14 }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}>
                <SortTh col="Invoice Number">Invoice #</SortTh>
                <SortTh col="Project">Project</SortTh>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Category</th>
                <SortTh col="Raised Date">Raised</SortTh>
                <SortTh col="Amount Raised">Amount</SortTh>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>GST Total</th>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Received</th>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Outstanding</th>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Status</th>
                <SortTh col="Agening (Days)">Aging</SortTh>
                <th className="px-4 py-3 text-left section-title" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Attach.</th>
              </tr>
            </thead>
            <tbody>
              {loading && !listData
                ? Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={11} className="px-4 py-14 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      No invoices found.{' '}
                      <button onClick={openNew} className="underline" style={{ color: 'var(--accent)' }}>Create one</button>
                    </td></tr>
                  : records.map(r => {
                      const f = r.fields || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      const refs  = parseAttachments(f['Reference'])
                      const pdfs  = parseAttachments(f['Invoice PDF'])
                      const hasFiles = refs.length + pdfs.length > 0
                      const aging = f['Agening (Days)']

                      return (
                        <tr key={r.id}
                          onClick={() => openView(r)}
                          className="cursor-pointer transition-colors"
                          style={{ borderBottom: '1px solid var(--glass-border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-bg)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>

                          <td className="px-4 py-3.5">
                            <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmt(f['Amount Raised'])}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmt(f['Amount with Tax'])}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs tabular-nums font-semibold" style={{ color: '#4ade80' }}>{fmt(f['Amount Received'])}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            {outstanding > 0
                              ? <span className="text-xs tabular-nums font-semibold" style={{ color: '#fbbf24' }}>{fmt(outstanding)}</span>
                              : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusPill status={f['Payment Status']} />
                          </td>
                          <td className="px-4 py-3.5">
                            <AgingBadge days={aging} />
                          </td>
                          <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                            {hasFiles ? (
                              <div className="flex items-center gap-1">
                                {refs.slice(0, 1).map((a, i) => (
                                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                                    title={a.name}
                                    className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center transition-opacity hover:opacity-80"
                                    style={{ border: '1px solid var(--glass-border)' }}
                                    onClick={e => e.stopPropagation()}>
                                    {isImage(a)
                                      ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={ev => { ev.target.style.display='none'; ev.target.nextSibling.style.display='flex' }} />
                                      : null}
                                    <ImageIcon size={11} style={{ color: 'var(--text-3)', display: 'none' }} />
                                  </a>
                                ))}
                                {pdfs.slice(0, 1).map((a, i) => (
                                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                                    title={a.name}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}
                                    onClick={e => e.stopPropagation()}>
                                    <FileText size={11} style={{ color: '#f87171' }} />
                                  </a>
                                ))}
                                {refs.length + pdfs.length > 2 && (
                                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>+{refs.length + pdfs.length - 2}</span>
                                )}
                              </div>
                            ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                        </tr>
                      )
                    })
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drawers ── */}
      {drawer?.mode === 'view' && (
        <InvoiceDetail
          invoice={drawer.invoice}
          onClose={closeDrawer}
          onEdit={() => setDrawer({ mode: 'edit', invoice: drawer.invoice })}
        />
      )}
      {(drawer?.mode === 'new' || drawer?.mode === 'edit') && (
        <InvoiceDrawer
          invoice={drawer.mode === 'edit' ? drawer.invoice : null}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
