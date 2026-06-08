/**
 * Tax Ledger — GST & TDS tracking module
 *
 * Features:
 * • Period selector: Monthly / Quarterly / Half-year / Full-year / Financial-year (Apr–Mar) / Custom
 * • Summary strip: Total taxable value · GST collected · TDS deducted · Net receivable
 * • Month-by-month GST register table (GSTR-1 style)
 * • Client-wise GST + TDS breakdown with percentage validation
 * • Invoice-level drilldown with tax line items
 * • Export: CSV + print-ready PDF layout
 */

import { useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  FileText, Download, Printer, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Info, Calendar, Filter,
  TrendingUp, TrendingDown, Percent, IndianRupee,
  ReceiptText, Building2, RefreshCw, Search, X, Share2, Link2,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'

// ── Constants ────────────────────────────────────────────────────────────────
const GST_RATE   = 0.18   // 18%
const TDS_RATE   = 0.10   // 10%
const FMT_INR    = (n) => `${Number(n || 0) < 0 ? '-' : ''}₹${Math.abs(Math.round(n || 0)).toLocaleString('en-IN')}`
const FMT_PCT    = (n) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`)
const PCT_OK     = (pct, expected, tol = 1.5) => Math.abs(pct - expected) <= tol

// ── Date helpers ─────────────────────────────────────────────────────────────
const today      = new Date()
const thisYear   = today.getFullYear()
const thisMonth  = today.getMonth()   // 0-indexed

function isoToDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
function dateKey(iso) {
  const d = isoToDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function shortMonth(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
function fyLabel(y) { return `FY ${y}-${String(y + 1).slice(-2)}` }

// Financial year start: April 1
function fyStartYear(date = today) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
}

// Generate period options
function buildPeriods() {
  const periods = []
  // Monthly: last 12 months
  for (let i = 0; i < 12; i++) {
    const d = new Date(thisYear, thisMonth - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    periods.push({ type: 'month', key, label, from: `${key}-01`, to: lastDay(key) })
  }
  // Quarters: last 4
  for (let i = 0; i < 4; i++) {
    const q = Math.floor(thisMonth / 3) - i
    const adjQ = ((q % 4) + 4) % 4
    const adjY = thisYear + Math.floor((Math.floor(thisMonth / 3) - i) / 4) * (Math.floor(thisMonth / 3) - i < 0 ? 1 : 0)
    const qStartMonth = adjQ * 3
    const qY = (qStartMonth > thisMonth && i === 0) ? thisYear - 1 : thisYear - Math.floor(i / 4)
    // simpler: compute from offset
    const totalQ = Math.floor(thisMonth / 3) + thisYear * 4 - i
    const qm = totalQ % 4, qy = Math.floor(totalQ / 4)
    const from = `${qy}-${String(qm * 3 + 1).padStart(2, '0')}-01`
    const toKey = `${qy}-${String(qm * 3 + 3).padStart(2, '0')}`
    const to = lastDay(toKey)
    const qLabel = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'][qm]
    periods.push({ type: 'quarter', key: `Q${totalQ}`, label: `${qLabel} ${qy}`, from, to })
  }
  // Half-years
  const h1 = thisMonth < 6
  periods.push({ type: 'half', key: `H1-${thisYear}`, label: `H1 Jan–Jun ${thisYear}`, from: `${thisYear}-01-01`, to: `${thisYear}-06-30` })
  periods.push({ type: 'half', key: `H2-${thisYear}`, label: `H2 Jul–Dec ${thisYear}`, from: `${thisYear}-07-01`, to: `${thisYear}-12-31` })
  // Calendar years
  periods.push({ type: 'year', key: `CY-${thisYear}`,     label: `${thisYear} (full year)`,     from: `${thisYear}-01-01`,     to: `${thisYear}-12-31` })
  periods.push({ type: 'year', key: `CY-${thisYear - 1}`, label: `${thisYear - 1} (full year)`, from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` })
  // Financial years
  for (let fy = fyStartYear(); fy >= fyStartYear() - 2; fy--) {
    periods.push({ type: 'fy', key: `FY-${fy}`, label: fyLabel(fy), from: `${fy}-04-01`, to: `${fy + 1}-03-31` })
  }
  return periods
}
function lastDay(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`
}
const PERIODS = buildPeriods()

// ── Tax computation ───────────────────────────────────────────────────────────
function taxParts(fields = {}) {
  const base    = Number(fields['Amount Raised']    || 0)
  const gross   = Number(fields['Amount with Tax']  || base)
  const received = Number(fields['Amount Received'] || 0)
  const status  = String(fields['Payment Status']   || '').trim()
  const isPaid  = status === 'Paid'
  const isCancelled = status === 'Cancelled'

  // GST = gross - base. If no 'Amount with Tax' given, try to infer from base
  const gstAmt  = Math.max(0, gross - base)
  const gstPct  = base > 0 ? (gstAmt / base) * 100 : 0
  // TDS: Outstanding = gross - received when pending. TDS is the difference
  // between gross and (received + any outstanding kept by client).
  // Best proxy: if paid, tds = gross - received when received < gross
  const tdsAmt  = isPaid && received < gross ? Math.max(0, gross - received) : 0
  const tdsPct  = base > 0 ? (tdsAmt / base) * 100 : 0

  // Taxable base (pre-GST)
  const taxable = base
  // Net receivable after TDS
  const netReceivable = gross - tdsAmt
  // Outstanding (unpaid invoices only)
  const outstanding = (!isPaid && !isCancelled) ? Math.max(0, gross - received) : 0

  return { base, gross, gstAmt, gstPct, tdsAmt, tdsPct, received, netReceivable, outstanding, status, isPaid, isCancelled }
}

function inPeriod(raisedDate, from, to) {
  if (!raisedDate) return false
  const d = String(raisedDate).slice(0, 10)
  return d >= from && d <= to
}

// ── Formatting ────────────────────────────────────────────────────────────────
const VAR_GOOD = { color: '#10b981' }
const VAR_WARN = { color: '#f59e0b' }
const VAR_BAD  = { color: '#ef4444' }
function taxStatus(gstPct) {
  if (gstPct === 0) return { label: 'No GST', style: VAR_WARN, icon: Info }
  if (PCT_OK(gstPct, 18)) return { label: '18% ✓', style: VAR_GOOD, icon: CheckCircle2 }
  if (PCT_OK(gstPct, 12)) return { label: '12%', style: VAR_WARN, icon: Info }
  if (PCT_OK(gstPct, 5))  return { label: '5%',  style: VAR_WARN, icon: Info }
  return { label: `${FMT_PCT(gstPct)}`, style: VAR_BAD, icon: AlertCircle }
}

// ── Export helpers ────────────────────────────────────────────────────────────
function exportCSV(rows, filename) {
  const cols = ['Invoice No', 'Date', 'Project', 'Client', 'Taxable Value', 'GST Amount', 'GST %', 'Gross', 'TDS Amount', 'TDS %', 'Received', 'Status']
  const lines = [cols.join(',')]
  for (const r of rows) {
    lines.push([
      `"${r.invoiceNo}"`, `"${r.date}"`, `"${r.project}"`, `"${r.client}"`,
      r.base, r.gstAmt, FMT_PCT(r.gstPct).replace('%',''), r.gross,
      r.tdsAmt, FMT_PCT(r.tdsPct).replace('%',''), r.received, `"${r.status}"`,
    ].join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Components ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = false, warn = false }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{
      background: 'var(--card-bg)',
      border: `1px solid ${warn ? 'rgba(245,158,11,0.3)' : accent ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`,
    }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: warn ? '#f59e0b' : accent ? 'var(--accent)' : 'var(--text-1)' }}>{value}</p>
      {sub && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function SectionHead({ title, sub, children }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div>
        <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TaxLedger() {
  const { isEditor } = useAuth()
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(PERIODS.find(p => p.type === 'fy')?.key || PERIODS[0].key)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [useCustom,  setUseCustom]  = useState(false)
  const [search, setSearch] = useState('')
  const [expandedClients, setExpandedClients] = useState(new Set())
  const [expandedMonths, setExpandedMonths] = useState(new Set())
  const [activeTab, setActiveTab] = useState('summary') // summary | monthly | clients | invoices
  const [invoiceScope, setInvoiceScope] = useState('tax')
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const printRef = useRef(null)

  const fetchInvoices = useCallback((opts = {}) =>
    api.invoices.list({ limit: 1000, order_by: 'Raised Date', order: 'desc', ...opts }),
  [])
  const { data: listData, loading, refresh } = useAutoRefresh(fetchInvoices, 15_000)
  const allInvoices = listData?.records || []

  // Active period
  const period = useMemo(() => {
    if (useCustom && customFrom && customTo) {
      return { type: 'custom', label: `${customFrom} → ${customTo}`, from: customFrom, to: customTo }
    }
    return PERIODS.find(p => p.key === selectedPeriodKey) || PERIODS[0]
  }, [selectedPeriodKey, useCustom, customFrom, customTo])

  // Period invoices by Raised Date. Tax calculations below use paid invoices only.
  // GST/TDS only applies to INR/RS invoices — exclude foreign-currency records.
  const periodInvoices = useMemo(() =>
    allInvoices.filter(r => {
      const f = r.fields || {}
      if (f['Payment Status'] === 'Cancelled') return false
      const cur = (f['Currency'] || 'RS').toString().trim().toUpperCase()
      if (cur !== 'RS' && cur !== 'INR') return false
      return inPeriod(f['Raised Date'], period.from, period.to)
    }),
  [allInvoices, period])

  const taxInvoices = useMemo(
    () => periodInvoices.filter(r => taxParts(r.fields).isPaid),
    [periodInvoices]
  )

  const openInvoices = useMemo(
    () => periodInvoices.filter(r => {
      const p = taxParts(r.fields)
      return !p.isPaid && !p.isCancelled
    }),
    [periodInvoices]
  )

  const invoiceScopeRecords = useMemo(() => {
    if (invoiceScope === 'all') return periodInvoices
    if (invoiceScope === 'open') return openInvoices
    return taxInvoices
  }, [invoiceScope, openInvoices, periodInvoices, taxInvoices])

  // Search-filtered for drilldown
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoiceScopeRecords
    return invoiceScopeRecords.filter(r => {
      const f = r.fields || {}
      return [f['Invoice Number'], f['Project'], f['Client Name'], f['Client'], f['Payment Status']].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [invoiceScopeRecords, search])

  // Aggregate totals
  const totals = useMemo(() => {
    let taxable = 0, gstAmt = 0, tdsAmt = 0, gross = 0, received = 0, outstanding = 0, count = 0
    for (const r of taxInvoices) {
      const p = taxParts(r.fields)
      taxable     += p.base
      gstAmt      += p.gstAmt
      tdsAmt      += p.tdsAmt
      gross       += p.gross
      received    += p.received
      outstanding += p.outstanding
      count++
    }
    const effectiveGstPct = taxable > 0 ? (gstAmt / taxable) * 100 : 0
    const effectiveTdsPct = taxable > 0 ? (tdsAmt / taxable) * 100 : 0
    const netReceivable   = gross - tdsAmt
    const collectionRate  = gross > 0 ? (received / gross) * 100 : 0
    return { taxable, gstAmt, tdsAmt, gross, received, outstanding, netReceivable, effectiveGstPct, effectiveTdsPct, collectionRate, count }
  }, [taxInvoices])

  const openSummary = useMemo(() => {
    let taxable = 0, gross = 0, received = 0, outstanding = 0
    let oldest = 0
    for (const r of openInvoices) {
      const p = taxParts(r.fields)
      taxable += p.base
      gross += p.gross
      received += p.received
      outstanding += p.outstanding
      oldest = Math.max(oldest, Number(r.fields?.['Agening (Days)'] || 0))
    }
    return { count: openInvoices.length, taxable, gross, received, outstanding, oldest }
  }, [openInvoices])

  // Month-by-month breakdown
  const monthlyRows = useMemo(() => {
    const map = new Map()
    for (const r of taxInvoices) {
      const f   = r.fields || {}
      const key = dateKey(f['Raised Date'])
      if (!key) continue
      if (!map.has(key)) map.set(key, { key, label: shortMonth(key), invoices: [] })
      map.get(key).invoices.push(r)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, row]) => {
        let taxable = 0, gstAmt = 0, tdsAmt = 0, gross = 0, received = 0, outstanding = 0
        for (const r of row.invoices) {
          const p = taxParts(r.fields)
          taxable += p.base; gstAmt += p.gstAmt; tdsAmt += p.tdsAmt
          gross += p.gross; received += p.received; outstanding += p.outstanding
        }
        return { ...row, taxable, gstAmt, tdsAmt, gross, received, outstanding, count: row.invoices.length }
      })
  }, [taxInvoices])

  // Client-wise breakdown
  const clientRows = useMemo(() => {
    const map = new Map()
    for (const r of taxInvoices) {
      const f      = r.fields || {}
      const client = f['Client Name'] || f['Project'] || 'Unknown'
      if (!map.has(client)) map.set(client, { client, invoices: [] })
      map.get(client).invoices.push(r)
    }
    return [...map.values()].map(row => {
      let taxable = 0, gstAmt = 0, tdsAmt = 0, gross = 0, received = 0, outstanding = 0
      for (const r of row.invoices) {
        const p = taxParts(r.fields)
        taxable += p.base; gstAmt += p.gstAmt; tdsAmt += p.tdsAmt
        gross += p.gross; received += p.received; outstanding += p.outstanding
      }
      const gstPct = taxable > 0 ? (gstAmt / taxable) * 100 : 0
      const tdsPct = taxable > 0 ? (tdsAmt / taxable) * 100 : 0
      return { ...row, taxable, gstAmt, tdsAmt, gross, received, outstanding, gstPct, tdsPct, count: row.invoices.length }
    }).sort((a, b) => b.gross - a.gross)
  }, [taxInvoices])

  // CSV export rows
  const csvRows = useMemo(() =>
    filteredInvoices.map(r => {
      const f = r.fields || {}
      const p = taxParts(f)
      return {
        invoiceNo: f['Invoice Number'] || r.id,
        date:      String(f['Raised Date'] || '').slice(0, 10),
        project:   f['Project'] || '',
        client:    f['Client Name'] || f['Project'] || '',
        ...p,
      }
    }),
  [filteredInvoices])

  const sharedViewConfig = useMemo(() => ({
    type: 'list',
    periodLabel: period.label,
    periodFrom: period.from,
    periodTo: period.to,
    invoiceScope,
    search,
    filterClient: '',
    filterProject: '',
    filterStatus: '',
    columns: [
      'Invoice Number',
      'Client Name',
      'Project',
      'Payment Status',
      'Amount Raised',
      'Amount with Tax',
      'GST Amount',
      'TDS Amount',
      'TDS %',
      'Amount Received',
      'Outstanding Amount',
      'Raised Date',
      'Cleared Date',
    ],
    theme: 'amber',
    density: 'compact',
    showDashboard: true,
  }), [invoiceScope, period.from, period.label, period.to, search])

  const shareTitle = useMemo(
    () => `Tax Ledger · ${period.label} · ${invoiceScope === 'tax' ? 'Paid tax register' : invoiceScope === 'open' ? 'Open invoices' : 'All invoices'}`,
    [invoiceScope, period.label]
  )

  function handleExport() {
    exportCSV(csvRows, `tax-ledger-${period.label.replace(/[^a-z0-9]/gi, '-')}.csv`)
  }

  function handlePrint() { window.print() }

  function toggleClient(c) {
    setExpandedClients(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })
  }
  function toggleMonth(k) {
    setExpandedMonths(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  const TABS = [
    { id: 'summary',  label: 'Summary'  },
    { id: 'monthly',  label: 'Monthly'  },
    { id: 'clients',  label: 'By Client' },
    { id: 'reports',  label: 'Reports' },
    { id: 'invoices', label: 'All Invoices' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-24 space-y-5" ref={printRef}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
              <ReceiptText size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Tax Ledger</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>GST collection · TDS deducted · Tax filing register</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isEditor && (
              <>
                <button onClick={() => setShareModal(true)} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2">
                  <Share2 size={12} /> Share View
                </button>
                <button onClick={() => setManageModal(true)} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2">
                  <Link2 size={12} /> Links
                </button>
              </>
            )}
            <button onClick={refresh} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={handleExport} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2">
              <Download size={12} /> Export CSV
            </button>
            <button onClick={handlePrint} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2">
              <Printer size={12} /> Print
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="mt-4 flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Period</label>
            <select
              value={useCustom ? 'custom' : selectedPeriodKey}
              onChange={e => { if (e.target.value === 'custom') setUseCustom(true); else { setUseCustom(false); setSelectedPeriodKey(e.target.value) } }}
              className="input text-xs h-9 pr-8 min-w-[220px]"
            >
              {/* Financial Years */}
              <optgroup label="Financial Year (Apr–Mar)">
                {PERIODS.filter(p => p.type === 'fy').map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Calendar Year">
                {PERIODS.filter(p => p.type === 'year').map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Half-year">
                {PERIODS.filter(p => p.type === 'half').map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Quarter">
                {PERIODS.filter(p => p.type === 'quarter').map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Month">
                {PERIODS.filter(p => p.type === 'month').map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
              <optgroup label="Custom">
                <option value="custom">Custom range…</option>
              </optgroup>
            </select>
          </div>
          {useCustom && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input text-xs h-9" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input text-xs h-9" />
              </div>
              <button onClick={() => setUseCustom(false)} className="btn-ghost text-xs h-9 px-3">
                <X size={12} />
              </button>
            </>
          )}
          <div className="ml-auto text-xs" style={{ color: 'var(--text-3)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{totals.count}</span> paid tax invoice{totals.count !== 1 ? 's' : ''} · <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{openSummary.count}</span> open · <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{period.label}</span>
          </div>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Taxable Value"   value={FMT_INR(totals.taxable)}     sub="Pre-GST base" />
        <StatCard label="GST Collected Total" value={FMT_INR(totals.gstAmt)}  sub={`Paid only · Avg ${FMT_PCT(totals.effectiveGstPct)} on base`} accent />
        <StatCard label="TDS Collected Total" value={FMT_INR(totals.tdsAmt)}  sub={`Paid only · Avg ${FMT_PCT(totals.effectiveTdsPct)} on taxable`} warn={totals.tdsAmt > 0} />
        <StatCard label="Gross Invoiced"  value={FMT_INR(totals.gross)}       sub={`${totals.count} paid invoices`} />
        <StatCard label="Net Receivable"  value={FMT_INR(totals.netReceivable)} sub="Gross minus TDS" />
        <StatCard label="Open Invoices"   value={FMT_INR(openSummary.outstanding)} sub={`${openSummary.count} pending · excluded from GST/TDS`} warn={openSummary.count > 0} />
      </div>

      {/* ── GST / TDS health bar ───────────────────────────────────────────── */}
      <div className="rounded-xl p-4 grid sm:grid-cols-2 gap-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>GST Collection Rate</p>
            <span className="text-xs font-bold tabular-nums" style={PCT_OK(totals.effectiveGstPct, 18) ? VAR_GOOD : VAR_WARN}>
              {FMT_PCT(totals.effectiveGstPct)} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>avg</span>
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, totals.effectiveGstPct / 18 * 100)}%`, background: PCT_OK(totals.effectiveGstPct, 18) ? '#10b981' : '#f59e0b' }} />
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>Expected 18% · Standard GST rate</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>TDS Deduction Rate</p>
            <span className="text-xs font-bold tabular-nums" style={PCT_OK(totals.effectiveTdsPct, 10, 2) ? VAR_WARN : totals.effectiveTdsPct === 0 ? { color: 'var(--text-3)' } : VAR_BAD}>
              {FMT_PCT(totals.effectiveTdsPct)} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>avg</span>
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, totals.effectiveTdsPct / 10 * 100)}%`, background: '#f59e0b' }} />
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>Expected TDS is computed on taxable value / Amount Raised when GST is separately shown.</p>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px"
            style={{
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-3)',
              borderBottomColor: activeTab === t.id ? 'var(--accent)' : 'transparent',
              background: 'transparent',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Summary tab ────────────────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {/* Filing reference */}
          <div className="rounded-xl p-4" style={{ background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)' }}>
            <p className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent)' }}>GST Filing Reference — {period.label}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { l: 'Total Taxable Turnover',   v: FMT_INR(totals.taxable)     },
                { l: 'CGST (9%)',                v: FMT_INR(totals.gstAmt / 2)  },
                { l: 'SGST (9%)',                v: FMT_INR(totals.gstAmt / 2)  },
                { l: 'Total GST (18%)',          v: FMT_INR(totals.gstAmt),  bold: true },
              ].map(({ l, v, bold }) => (
                <div key={l}>
                  <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{l}</p>
                  <p className={`text-sm tabular-nums ${bold ? 'font-bold' : 'font-semibold'}`} style={{ color: bold ? 'var(--accent)' : 'var(--text-1)' }}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* TDS reference */}
          {totals.tdsAmt > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <p className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: '#d97706' }}>TDS Reference — {period.label}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { l: 'Gross Amount Billed',  v: FMT_INR(totals.gross)           },
                  { l: 'TDS Deducted',          v: FMT_INR(totals.tdsAmt), bold: true },
                  { l: 'Net Amount Received',  v: FMT_INR(totals.received)        },
                  { l: 'Balance Outstanding',  v: FMT_INR(totals.outstanding)     },
                ].map(({ l, v, bold }) => (
                  <div key={l}>
                    <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{l}</p>
                    <p className={`text-sm tabular-nums ${bold ? 'font-bold' : 'font-semibold'}`} style={{ color: bold ? '#d97706' : 'var(--text-1)' }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top clients */}
          <SectionHead title="Top Clients by Tax Contribution" />
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Client', 'Invoices', 'Taxable', 'GST Collected', 'TDS Deducted', 'Gross', '% of Total GST'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientRows.slice(0, 8).map((row, i) => (
                  <tr key={row.client} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-input)' }}>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--text-1)' }}>{row.client}</td>
                    <td className="px-4 py-2.5 tabular-nums text-center" style={{ color: 'var(--text-3)' }}>{row.count}</td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{FMT_INR(row.taxable)}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt)}</td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: row.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{row.tdsAmt > 0 ? FMT_INR(row.tdsAmt) : '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.gross)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                      {totals.gstAmt > 0 ? `${Math.round(row.gstAmt / totals.gstAmt * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-input)' }}>
                  <td className="px-4 py-2.5 font-bold text-xs uppercase" style={{ color: 'var(--text-2)' }}>Total</td>
                  <td className="px-4 py-2.5 tabular-nums text-center font-bold" style={{ color: 'var(--text-1)' }}>{totals.count}</td>
                  <td className="px-4 py-2.5 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.taxable)}</td>
                  <td className="px-4 py-2.5 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt)}</td>
                  <td className="px-4 py-2.5 tabular-nums font-bold" style={{ color: '#f59e0b' }}>{totals.tdsAmt > 0 ? FMT_INR(totals.tdsAmt) : '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.gross)}</td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: 'var(--text-1)' }}>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Monthly tab ────────────────────────────────────────────────────── */}
      {activeTab === 'monthly' && (
        <div className="space-y-3">
          <SectionHead title="Month-by-Month GST Register" sub="GSTR-1 style — sorted chronologically" />
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Month', 'Invoices', 'Taxable Value', 'CGST (9%)', 'SGST (9%)', 'Total GST', 'TDS', 'Gross', 'Collected', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row, i) => (
                  <>
                    <tr key={row.key}
                      onClick={() => toggleMonth(row.key)}
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: expandedMonths.has(row.key) ? 'none' : '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-input)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-input)'}
                    >
                      <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{row.label}</td>
                      <td className="px-3 py-2.5 tabular-nums text-center" style={{ color: 'var(--text-3)' }}>{row.count}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{FMT_INR(row.taxable)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt / 2)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt / 2)}</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: row.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{row.tdsAmt > 0 ? FMT_INR(row.tdsAmt) : '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.gross)}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: row.outstanding > 0 ? '#f59e0b' : 'var(--text-2)' }}>{FMT_INR(row.received)}</td>
                      <td className="px-3 py-2.5 text-right" style={{ color: 'var(--text-3)' }}>
                        {expandedMonths.has(row.key) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </td>
                    </tr>
                    {expandedMonths.has(row.key) && row.invoices.map(r => {
                      const f = r.fields || {}
                      const p = taxParts(f)
                      const ts = taxStatus(p.gstPct)
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)' }}>
                          <td className="pl-6 pr-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{String(f['Raised Date'] || '').slice(0, 10)}</td>
                          <td className="px-3 py-2 text-xs" colSpan={1} style={{ color: 'var(--text-2)' }}>{f['Invoice Number'] || '—'}</td>
                          <td className="px-3 py-2 text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{FMT_INR(p.base)}</td>
                          <td className="px-3 py-2 text-xs tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt / 2)}</td>
                          <td className="px-3 py-2 text-xs tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt / 2)}</td>
                          <td className="px-3 py-2 text-xs tabular-nums font-semibold flex items-center gap-1" style={{ ...ts.style }}>
                            {FMT_INR(p.gstAmt)} <span className="text-[10px]">{ts.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs tabular-nums" style={{ color: p.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{p.tdsAmt > 0 ? FMT_INR(p.tdsAmt) : '—'}</td>
                          <td className="px-3 py-2 text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{FMT_INR(p.gross)}</td>
                          <td className="px-3 py-2 text-xs tabular-nums" style={{ color: p.outstanding > 0 ? '#f59e0b' : 'var(--text-2)' }}>{FMT_INR(p.received)}</td>
                          <td className="px-3 py-2 text-xs text-right" style={{ color: 'var(--text-3)' }}>{p.status}</td>
                        </tr>
                      )
                    })}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-input)' }}>
                  <td className="px-3 py-2.5 font-bold text-xs uppercase" style={{ color: 'var(--text-2)' }}>Total</td>
                  <td className="px-3 py-2.5 text-center font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{totals.count}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.taxable)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt / 2)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt / 2)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: '#f59e0b' }}>{totals.tdsAmt > 0 ? FMT_INR(totals.tdsAmt) : '—'}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.gross)}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.received)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── By client tab ──────────────────────────────────────────────────── */}
      {activeTab === 'clients' && (
        <div className="space-y-3">
          <SectionHead title="Client-wise GST & TDS Breakdown" sub="Click a client to see invoice detail" />
          <div className="space-y-2">
            {clientRows.map(row => {
              const open = expandedClients.has(row.client)
              const gstOk = PCT_OK(row.gstPct, 18)
              const tdsOk = row.tdsAmt === 0 || PCT_OK(row.tdsPct, 10, 2)
              return (
                <div key={row.client} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {/* Client header row */}
                  <button
                    onClick={() => toggleClient(row.client)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                    style={{ background: 'var(--card-bg)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                      style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--accent)' }}>
                      {row.client.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{row.client}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{row.count} invoice{row.count !== 1 ? 's' : ''}</p>
                    </div>
                    {/* Tax health badges */}
                    <div className="hidden sm:flex items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: gstOk ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: gstOk ? '#10b981' : '#d97706' }}>
                        GST {FMT_PCT(row.gstPct)}
                      </span>
                      {row.tdsAmt > 0 && (
                        <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706' }}>
                          TDS {FMT_PCT(row.tdsPct)}
                        </span>
                      )}
                    </div>
                    {/* Amounts */}
                    <div className="hidden md:grid grid-cols-4 gap-6 text-right text-xs min-w-[360px]">
                      <div><p style={{ color: 'var(--text-3)' }}>Taxable</p><p className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.taxable)}</p></div>
                      <div><p style={{ color: 'var(--text-3)' }}>GST</p><p className="font-bold tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt)}</p></div>
                      <div><p style={{ color: 'var(--text-3)' }}>TDS</p><p className="font-semibold tabular-nums" style={{ color: row.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{row.tdsAmt > 0 ? FMT_INR(row.tdsAmt) : '—'}</p></div>
                      <div><p style={{ color: 'var(--text-3)' }}>Gross</p><p className="font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.gross)}</p></div>
                    </div>
                    <div className="ml-2 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </button>

                  {/* Invoice drilldown */}
                  {open && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: 'var(--bg-input)' }}>
                            {['Invoice No', 'Date', 'Project', 'Taxable', 'GST', 'GST %', 'TDS', 'Gross', 'Received', 'Status'].map(h => (
                              <th key={h} className="text-left px-3 py-2 font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-3)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {row.invoices.map((r, j) => {
                            const f = r.fields || {}
                            const p = taxParts(f)
                            const ts = taxStatus(p.gstPct)
                            return (
                              <tr key={r.id} style={{ borderTop: '1px solid var(--border)', background: j % 2 ? 'var(--bg-input)' : 'transparent' }}>
                                <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-2)' }}>{f['Invoice Number'] || '—'}</td>
                                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{String(f['Raised Date'] || '').slice(0, 10)}</td>
                                <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: 'var(--text-2)' }}>{f['Project'] || '—'}</td>
                                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{FMT_INR(p.base)}</td>
                                <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt)}</td>
                                <td className="px-3 py-2 font-semibold" style={ts.style}>{ts.label}</td>
                                <td className="px-3 py-2 tabular-nums" style={{ color: p.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{p.tdsAmt > 0 ? FMT_INR(p.tdsAmt) : '—'}</td>
                                <td className="px-3 py-2 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(p.gross)}</td>
                                <td className="px-3 py-2 tabular-nums" style={{ color: p.outstanding > 0 ? '#f59e0b' : 'var(--text-2)' }}>{FMT_INR(p.received)}</td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{
                                    background: p.isPaid ? 'rgba(16,185,129,0.1)' : p.isCancelled ? 'rgba(148,163,184,0.1)' : 'rgba(245,158,11,0.1)',
                                    color: p.isPaid ? '#10b981' : p.isCancelled ? '#94a3b8' : '#d97706',
                                  }}>{p.status || 'Unknown'}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-input)' }}>
                            <td className="px-3 py-2 font-bold text-[10px] uppercase" style={{ color: 'var(--text-2)' }} colSpan={3}>Subtotal</td>
                            <td className="px-3 py-2 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.taxable)}</td>
                            <td className="px-3 py-2 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(row.gstAmt)}</td>
                            <td className="px-3 py-2 font-bold" style={{ color: gstOk ? '#10b981' : '#d97706' }}>{FMT_PCT(row.gstPct)}</td>
                            <td className="px-3 py-2 tabular-nums font-bold" style={{ color: '#f59e0b' }}>{row.tdsAmt > 0 ? FMT_INR(row.tdsAmt) : '—'}</td>
                            <td className="px-3 py-2 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.gross)}</td>
                            <td className="px-3 py-2 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(row.received)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
            {clientRows.length === 0 && (
              <div className="text-center py-12" style={{ color: 'var(--text-3)' }}>
                <ReceiptText size={32} className="mx-auto mb-2 opacity-30" />
                <p>No invoices in this period</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reports tab ───────────────────────────────────────────────────── */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <SectionHead
            title="Accounts Filing Pack"
            sub="Paid invoices only for GST/TDS; open invoices are shown as receivable controls and excluded from filing totals."
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>GST collected</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt)}</p>
              <div className="space-y-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <div className="flex justify-between"><span>Taxable turnover</span><strong>{FMT_INR(totals.taxable)}</strong></div>
                <div className="flex justify-between"><span>CGST 9%</span><strong>{FMT_INR(totals.gstAmt / 2)}</strong></div>
                <div className="flex justify-between"><span>SGST 9%</span><strong>{FMT_INR(totals.gstAmt / 2)}</strong></div>
                <div className="flex justify-between"><span>Paid invoice count</span><strong>{totals.count}</strong></div>
              </div>
            </div>

            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#d97706' }}>TDS collected / deducted</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: '#d97706' }}>{FMT_INR(totals.tdsAmt)}</p>
              <div className="space-y-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <div className="flex justify-between"><span>Gross billed</span><strong>{FMT_INR(totals.gross)}</strong></div>
                <div className="flex justify-between"><span>Net received</span><strong>{FMT_INR(totals.received)}</strong></div>
                <div className="flex justify-between"><span>Effective TDS %</span><strong>{FMT_PCT(totals.effectiveTdsPct)}</strong></div>
                <div className="flex justify-between"><span>Expected TDS @10%</span><strong>{FMT_INR(totals.taxable * TDS_RATE)}</strong></div>
              </div>
            </div>

            <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#d97706' }}>Open invoices control</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: '#d97706' }}>{FMT_INR(openSummary.outstanding)}</p>
              <div className="space-y-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <div className="flex justify-between"><span>Open invoice count</span><strong>{openSummary.count}</strong></div>
                <div className="flex justify-between"><span>Open taxable base</span><strong>{FMT_INR(openSummary.taxable)}</strong></div>
                <div className="flex justify-between"><span>Open gross amount</span><strong>{FMT_INR(openSummary.gross)}</strong></div>
                <div className="flex justify-between"><span>Oldest aging</span><strong>{openSummary.oldest || 0} days</strong></div>
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Filing checklist</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" style={{ color: 'var(--text-2)' }}>
              {[
                'Match GST collected with paid/cleared invoice register before GSTR filing.',
                'Reconcile TDS deducted with Form 26AS/AIS before ITR filing.',
                'Keep open invoices outside GST/TDS collected cards until payment is recorded.',
                'Use All Invoices scope to audit pending records, but use Tax Register scope for filing totals.',
              ].map(item => (
                <div key={item} className="flex gap-2 rounded-lg p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                  <CheckCircle2 size={14} style={{ color: '#10b981', marginTop: 2 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── All invoices tab ───────────────────────────────────────────────── */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          <SectionHead title="Invoice-level Tax Register" sub={`${filteredInvoices.length} of ${invoiceScopeRecords.length} invoices · tax totals stay paid-only`}>
            <div className="flex items-center gap-2 flex-wrap">
            <select
              value={invoiceScope}
              onChange={e => setInvoiceScope(e.target.value)}
              className="input text-xs h-8 min-w-[180px]"
            >
              <option value="tax">Tax register only</option>
              <option value="open">Open invoices only</option>
              <option value="all">All invoices</option>
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices…"
                className="input text-xs pl-8 h-8 w-52" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} style={{ color: 'var(--text-3)' }} /></button>}
            </div>
            </div>
          </SectionHead>

          <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Invoice No', 'Raised Date', 'Client', 'Project', 'Taxable', 'CGST 9%', 'SGST 9%', 'Total GST', 'GST %', 'TDS Amount', 'TDS %', 'Gross', 'Received', 'Outstanding', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((r, i) => {
                  const f = r.fields || {}
                  const p = taxParts(f)
                  const ts = taxStatus(p.gstPct)
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg-input)' : 'transparent' }}>
                      <td className="px-3 py-2 font-mono font-semibold" style={{ color: 'var(--accent)' }}>{f['Invoice Number'] || '—'}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-3)' }}>{String(f['Raised Date'] || '').slice(0, 10)}</td>
                      <td className="px-3 py-2 max-w-[100px] truncate" style={{ color: 'var(--text-2)' }}>{f['Client Name'] || f['Client'] || '—'}</td>
                      <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: 'var(--text-2)' }}>{f['Project'] || '—'}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{FMT_INR(p.base)}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt / 2)}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt / 2)}</td>
                      <td className="px-3 py-2 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(p.gstAmt)}</td>
                      <td className="px-3 py-2 font-bold" style={ts.style}>{ts.label}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: p.tdsAmt > 0 ? '#f59e0b' : 'var(--text-3)' }}>{p.tdsAmt > 0 ? FMT_INR(p.tdsAmt) : '—'}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: p.tdsAmt > 0 ? '#d97706' : 'var(--text-3)' }}>{p.tdsAmt > 0 ? FMT_PCT(p.tdsPct) : '—'}</td>
                      <td className="px-3 py-2 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(p.gross)}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{FMT_INR(p.received)}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: p.outstanding > 0 ? '#f59e0b' : 'var(--text-3)' }}>{p.outstanding > 0 ? FMT_INR(p.outstanding) : '—'}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{
                          background: p.isPaid ? 'rgba(16,185,129,0.1)' : p.isCancelled ? 'rgba(148,163,184,0.1)' : 'rgba(245,158,11,0.1)',
                          color: p.isPaid ? '#10b981' : p.isCancelled ? '#94a3b8' : '#d97706',
                        }}>{p.status || '—'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-input)' }}>
                  <td className="px-3 py-2.5 font-bold text-[10px] uppercase" colSpan={4} style={{ color: 'var(--text-2)' }}>Total ({filteredInvoices.length})</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.taxable)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt / 2)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt / 2)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: '#10b981' }}>{FMT_INR(totals.gstAmt)}</td>
                  <td className="px-3 py-2.5 font-bold" style={{ color: PCT_OK(totals.effectiveGstPct, 18) ? '#10b981' : '#d97706' }}>{FMT_PCT(totals.effectiveGstPct)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: '#f59e0b' }}>{totals.tdsAmt > 0 ? FMT_INR(totals.tdsAmt) : '—'}</td>
                  <td className="px-3 py-2.5 font-bold" style={{ color: '#d97706' }}>{totals.tdsAmt > 0 ? FMT_PCT(totals.effectiveTdsPct) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.gross)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{FMT_INR(totals.received)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-bold" style={{ color: totals.outstanding > 0 ? '#f59e0b' : 'var(--text-2)' }}>{totals.outstanding > 0 ? FMT_INR(totals.outstanding) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body > *:not(#root) { display: none; }
          .runey-app-sidebar, .runey-collapse-button, nav, header { display: none !important; }
          button { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {isEditor && shareModal && createPortal(
        <ShareLinkModal
          resourceType="tax-ledger"
          selectedRecords={filteredInvoices}
          title={shareTitle}
          recordLabel="invoice"
          enableLiveMode
          allowEdit={false}
          viewConfig={sharedViewConfig}
          onClose={() => setShareModal(false)}
        />,
        document.body
      )}
      {isEditor && manageModal && createPortal(
        <ManageSharedLinksModal
          resourceType="tax-ledger"
          recordLabel="invoice"
          currentViewConfig={sharedViewConfig}
          visibleRecords={filteredInvoices}
          onClose={() => setManageModal(false)}
        />,
        document.body
      )}
    </div>
  )
}
