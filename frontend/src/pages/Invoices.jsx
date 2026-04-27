import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  TrendingUp, IndianRupee, Percent, CalendarClock, ArrowUpDown,
  Save, Trash2, Eye
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr, formatPct } from '../utils/format'
import clsx from 'clsx'

/* ── helpers ────────────────────────────────────────────────────────────── */
function fmt(n)  { return formatInr(n) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return d }
}

const STATUS_META = {
  Paid:      { color: '#4ade80', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.18)',  icon: CheckCircle2, label: 'Paid' },
  Pending:   { color: '#fbbf24', bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.18)',  icon: Clock,        label: 'Pending' },
  Cancelled: { color: '#f87171', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.18)',  icon: XCircle,      label: 'Cancelled' },
}

function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--bg-input)', border: 'var(--border)', label: status }
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
      style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color }}>
      {Icon && <Icon size={10} />}{m.label}
    </span>
  )
}

/* ── KPI summary card ────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon: Icon, accent }) {
  const color = accent === 'positive' ? '#22c55e' : accent === 'warning' ? '#fbbf24' : accent === 'negative' ? '#f87171' : 'var(--text-1)'
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.06em' }}>{label}</p>
        {Icon && <Icon size={13} style={{ color: 'var(--text-3)' }} />}
      </div>
      <p className="font-semibold tabular-nums leading-none" style={{ fontSize: 'clamp(1.15rem, 3vw, 1.5rem)', color, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
        {value}
      </p>
      {sub && <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

/* ── Skeleton row ────────────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <tr aria-hidden="true">
      {[60, 90, 80, 120, 80, 90, 80, 70, 60].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-3.5 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

/* ── Invoice form (drawer) ───────────────────────────────────────────────── */
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

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="relative">
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="input appearance-none pr-8"
        style={{ background: 'var(--bg-input)' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

function InvoiceDrawer({ invoice, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(invoice?.id)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  // Prefill from existing invoice on open
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
      raised_date:     f['Raised Date']     ? f['Raised Date'].slice(0,10) : '',
      cleared_date:    f['Cleared Date']    ? f['Cleared Date'].slice(0,10) : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      next_followup:   f['Next followup']   ? f['Next followup'].slice(0,10) : '',
    })
  }, [invoice])

  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }))
  const numericSet = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        amount_raised:    form.amount_raised    !== '' ? Number(form.amount_raised)    : undefined,
        amount_with_tax:  form.amount_with_tax  !== '' ? Number(form.amount_with_tax)  : undefined,
        amount_received:  form.amount_received  !== '' ? Number(form.amount_received)  : undefined,
        raised_date:      form.raised_date      ? `${form.raised_date}T00:00:00.000Z`  : undefined,
        cleared_date:     form.cleared_date     ? `${form.cleared_date}T00:00:00.000Z` : undefined,
        next_followup:    form.next_followup    ? `${form.next_followup}T00:00:00.000Z`: undefined,
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
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await api.invoices.delete(invoice.id)
      onDeleted()
    } catch (e) {
      setError(e.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <aside
        className="relative ml-auto flex flex-col h-full overflow-hidden"
        style={{ width: 'min(100vw, 520px)', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
            {isEdit ? `Edit ${invoice.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} className="btn-icon"><X size={14} /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={e => set('invoice_number')(e.target.value)} placeholder="WM/25-26/001" />
            </Field>
            <Field label="Payment Status">
              <Select value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Select value={form.project} onChange={set('project')} options={PROJECTS} placeholder="Select project…" />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={set('category')} options={CATEGORIES} placeholder="Select category…" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Milestone">
              <Select value={form.milestone} onChange={set('milestone')} options={MILESTONES} placeholder="Select…" />
            </Field>
            <Field label="Raised By">
              <Select value={form.raised_by} onChange={set('raised_by')} options={RAISED_BY} placeholder="Select…" />
            </Field>
          </div>

          <Field label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => set('description')(e.target.value)} placeholder="Brief description of this invoice" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Raised Date">
              <input type="date" className="input" value={form.raised_date} onChange={e => set('raised_date')(e.target.value)} />
            </Field>
            <Field label="Cleared Date">
              <input type="date" className="input" value={form.cleared_date} onChange={e => set('cleared_date')(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount Raised (₹)">
              <input type="number" className="input" value={form.amount_raised} onChange={numericSet('amount_raised')} placeholder="0" />
            </Field>
            <Field label="With GST (₹)">
              <input type="number" className="input" value={form.amount_with_tax} onChange={numericSet('amount_with_tax')} placeholder="0" />
            </Field>
            <Field label="Received (₹)">
              <input type="number" className="input" value={form.amount_received} onChange={numericSet('amount_received')} placeholder="0" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Next Followup">
              <input type="date" className="input" value={form.next_followup} onChange={e => set('next_followup')(e.target.value)} />
            </Field>
          </div>

          <Field label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={e => set('remark')(e.target.value)} placeholder="Optional notes" />
          </Field>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          {isEdit ? (
            <button
              onClick={handleDelete} disabled={deleting}
              className={clsx('btn-danger text-xs py-2 px-3', confirmDelete && 'opacity-100')}
              style={{ fontSize: '0.75rem' }}>
              {deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete?' : <><Trash2 size={12} className="inline mr-1" />Delete</>}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-xs py-2 px-3" style={{ fontSize: '0.75rem' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-3" style={{ fontSize: '0.75rem' }}>
              <Save size={12} aria-hidden="true" />
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ── Invoice detail view (read-only) ─────────────────────────────────────── */
function InvoiceDetail({ invoice, onClose, onEdit }) {
  if (!invoice) return null
  const f = invoice.fields || {}

  const files = (arr) => {
    if (!arr) return []
    return arr.map(item => {
      const parts = typeof item === 'string' ? item.split(' ') : []
      return { name: parts[0] || 'File', url: parts[1] || '' }
    })
  }
  const refs   = files(f['Reference'])
  const pdfs   = files(f['Invoice PDF'])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full overflow-hidden"
        style={{ width: 'min(100vw, 480px)', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{f['Project']} · {f['Category']}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="btn-ghost text-xs py-1.5 px-3" style={{ fontSize: '0.75rem' }}>Edit</button>
            <button onClick={onClose} className="btn-icon"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status + speed */}
          <div className="flex items-center gap-3">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{f['Speed']}</span>}
          </div>

          {/* Description */}
          {f['Description'] && (
            <div>
              <p className="label">Description</p>
              <p className="text-sm" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{f['Description']}</p>
            </div>
          )}

          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Amount Raised', f['Amount Raised'],    'var(--text-1)'],
              ['With GST',      f['Amount with Tax'],  'var(--text-1)'],
              ['Received',      f['Amount Received'],  '#4ade80'],
              ['Outstanding',   f['Outstanding Amount'], Number(f['Outstanding Amount'] || 0) > 0 ? '#fbbf24' : '#4ade80'],
            ].map(([l, v, c]) => (
              <div key={l} className="card p-3">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)', letterSpacing: '0.06em' }}>{l}</p>
                <p className="font-semibold tabular-nums text-base" style={{ color: c }}>{fmt(v)}</p>
              </div>
            ))}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Raised', f['Raised Date']],
              ['Cleared', f['Cleared Date']],
              ['Followup', f['Next followup']],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="label">{l}</p>
                <p className="text-sm" style={{ color: 'var(--text-1)' }}>{fmtDate(v)}</p>
              </div>
            ))}
          </div>

          {/* Computed fields */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Days to Clear', f['Days To Clear'] != null ? `${f['Days To Clear']} days` : '—'],
              ['Aging', f['Agening (Days)'] != null ? `${f['Agening (Days)']} days` : '—'],
              ['Raised By', f['Raised By'] || '—'],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="label">{l}</p>
                <p className="text-sm" style={{ color: 'var(--text-1)' }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Milestone */}
          {f['Milestone'] && (
            <div>
              <p className="label">Milestone</p>
              <p className="text-sm" style={{ color: 'var(--text-1)' }}>{f['Milestone']}</p>
            </div>
          )}

          {/* Remark */}
          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {/* Attachments */}
          {(refs.length > 0 || pdfs.length > 0) && (
            <div className="space-y-2">
              <p className="label">Attachments</p>
              {[...refs.map(r => ({ ...r, type: 'Payment Ref' })), ...pdfs.map(r => ({ ...r, type: 'Invoice PDF' }))].map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}>
                  <FileText size={12} />
                  <span className="flex-1 truncate">{a.type}: {a.name}</span>
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function Invoices() {
  const [statusFilter, setStatusFilter]   = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [search, setSearch]               = useState('')
  const [drawer, setDrawer]               = useState(null)  // null | { mode: 'view'|'edit'|'new', invoice: obj|null }
  const [sortCol, setSortCol]             = useState('Raised Date')
  const [sortDir, setSortDir]             = useState('desc')
  const searchRef = useRef(null)

  // ── Fetch summary ────────────────────────────────────────────────────────
  const fetchSummary = useCallback(() => api.invoices.summary(), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 15_000)

  // ── Fetch records (react to filter changes) ──────────────────────────────
  const fetchRecords = useCallback(() =>
    api.invoices.list({
      status:   statusFilter || undefined,
      project:  projectFilter || undefined,
      limit:    500,
      order_by: sortCol,
      order:    sortDir,
    }), [statusFilter, projectFilter, sortCol, sortDir])

  const { data: listData, loading, error, refresh } = useAutoRefresh(fetchRecords, 15_000)
  const records = listData?.records || []

  // ── Client-side search filter ────────────────────────────────────────────
  const filtered = search.trim()
    ? records.filter(r => {
        const f   = r.fields || {}
        const q   = search.toLowerCase()
        return (
          (f['Invoice Number'] || '').toLowerCase().includes(q) ||
          (f['Project']        || '').toLowerCase().includes(q) ||
          (f['Description']    || '').toLowerCase().includes(q) ||
          (f['Category']       || '').toLowerCase().includes(q)
        )
      })
    : records

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function openNew()         { setDrawer({ mode: 'new',  invoice: null }) }
  function openView(inv)     { setDrawer({ mode: 'view', invoice: inv  }) }
  function openEdit(inv)     { setDrawer({ mode: 'edit', invoice: inv  }) }
  function closeDrawer()     { setDrawer(null) }
  function handleSaved()     { refresh(); closeDrawer() }
  function handleDeleted()   { refresh(); closeDrawer() }

  // ── Stat pills (pending count from summary) ──────────────────────────────
  const s = summary

  const STATUS_FILTERS = ['', 'Paid', 'Pending', 'Cancelled']

  function SortTh({ col, children }) {
    const active = sortCol === col
    return (
      <th onClick={() => handleSort(col)}
        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none"
        style={{ color: active ? 'var(--text-1)' : 'var(--text-3)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
        <span className="inline-flex items-center gap-1">
          {children}
          <ArrowUpDown size={11} style={{ opacity: active ? 1 : 0.35 }} />
        </span>
      </th>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Invoice Tracking</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>Live sync · {records.length} invoices</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
            <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={openNew} className="btn-primary">
            <Plus size={14} /> <span className="hidden sm:inline">New Invoice</span><span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <section aria-label="Invoice metrics" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <KpiCard label="Total Raised"   value={fmt(s?.total_raised)}      icon={IndianRupee} />
        <KpiCard label="With GST"       value={fmt(s?.total_with_tax)}     icon={Receipt} />
        <KpiCard label="Total Received" value={fmt(s?.total_received)}     icon={TrendingUp}  accent="positive" />
        <KpiCard label="Outstanding"    value={fmt(s?.total_outstanding)}  icon={CalendarClock}
          accent={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
          sub={(s?.total_outstanding || 0) > 0 ? `${s?.by_status?.Pending || 0} pending` : 'All clear'} />
        <KpiCard label="Collection Rate" value={s ? `${s.collection_rate?.toFixed(1)}%` : '—'} icon={Percent}
          accent={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'} />
      </section>

      {/* ── Status breakdown row ── */}
      {s?.by_status && (
        <section className="grid grid-cols-3 gap-3">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--bg-input)', border: 'var(--border)' }
            return (
              <button key={status}
                onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
                className="card p-3 text-center transition-all"
                style={{
                  cursor: 'pointer',
                  borderColor: statusFilter === status ? m.color : 'var(--border)',
                  background: statusFilter === status ? m.bg : 'var(--bg-card)',
                }}
                aria-pressed={statusFilter === status}>
                <p className="text-2xl font-bold tabular-nums" style={{ color: m.color }}>{count}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{status}</p>
              </button>
            )
          })}
        </section>
      )}

      {/* ── Filter + search bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Project filter */}
        <div className="relative">
          <select
            value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
            className="input py-1.5 pr-8 text-xs" style={{ width: 'auto' }}>
            <option value="">All projects</option>
            {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoices…" className="input pl-8 py-1.5 text-xs" />
        </div>

        {/* Clear filters */}
        {(statusFilter || projectFilter || search) && (
          <button onClick={() => { setStatusFilter(''); setProjectFilter(''); setSearch('') }}
            className="btn-ghost text-xs py-1.5 px-2.5" style={{ fontSize: '0.75rem' }}>
            <X size={11} className="inline mr-1" />Clear
          </button>
        )}

        <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-lg text-xs"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          <AlertTriangle size={13} /> {error} · <button onClick={refresh} className="underline">retry</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 860 }}>
            <thead style={{ borderBottom: '1px solid var(--border)' }}>
              <tr style={{ background: 'var(--bg-input)' }}>
                <SortTh col="Invoice Number">Invoice #</SortTh>
                <SortTh col="Project">Project</SortTh>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>Category</th>
                <SortTh col="Raised Date">Raised</SortTh>
                <SortTh col="Amount Raised">Amount</SortTh>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>GST Total</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>Received</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>Outstanding</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)', letterSpacing: '0.05em' }}>Speed</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && !listData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : filtered.length === 0
                  ? <tr><td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      No invoices found.{' '}
                      <button onClick={openNew} className="underline" style={{ color: 'var(--accent)' }}>Create one</button>
                    </td></tr>
                  : filtered.map(r => {
                      const f = r.fields || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      return (
                        <tr key={r.id}
                          onClick={() => openView(r)}
                          className="cursor-pointer transition-colors"
                          style={{ borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>

                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-medium" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums font-medium" style={{ color: 'var(--text-1)' }}>{fmt(f['Amount Raised'])}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmt(f['Amount with Tax'])}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums font-medium" style={{ color: '#4ade80' }}>{fmt(f['Amount Received'])}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs tabular-nums font-semibold"
                              style={{ color: outstanding > 0 ? '#fbbf24' : 'var(--text-3)' }}>
                              {outstanding > 0 ? fmt(outstanding) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill status={f['Payment Status']} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs" style={{ color: 'var(--text-3)' }}>{f['Speed'] || '—'}</span>
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <button onClick={() => openEdit(r)} className="btn-icon" style={{ padding: '0.25rem' }} aria-label="Edit">
                              <Eye size={13} />
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
