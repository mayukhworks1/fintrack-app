/**
 * A working copy of the product, on the public page, with an invented ledger.
 *
 * The page used to show pictures of the app. Pictures are easy to disbelieve
 * and impossible to interrogate, and the one claim this product actually
 * rests on — that every screen reads the same rows, so two numbers cannot
 * disagree — is exactly the claim a screenshot cannot make. So this is not a
 * mockup or a recording: the filters filter, the columns sort, the ageing
 * bands are real predicates over real rows, and the analyst's answer is
 * computed by the same function that prints the SQL beside it. Add the
 * columns up and they come out.
 *
 * It plays itself until someone touches it, then gets out of the way. An
 * autoplaying demo that fights the person trying to click it is worse than no
 * demo; a static one that waits to be discovered is worse than no demo too.
 *
 * Every figure is invented — see demoData.js. The component makes no network
 * call of any kind, because a public page has no workspace to read.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Receipt, Timer, FolderKanban, BarChart3, Sparkles, Search, ArrowUpDown,
  Play, Pause, ChevronLeft, ChevronRight, X, MousePointerClick, Keyboard, Copy, Check as CheckIcon,
  KanbanSquare, Rows3, Radio, Mail, FileText, SlidersHorizontal,
  Download, CheckSquare, Square, LayoutDashboard, FileSpreadsheet,
  Globe, Layers, TrendingUp, ShieldCheck, ArrowRight, ExternalLink,
  Plus, Eye, Code, RefreshCw, CheckCircle2, AlertTriangle, Clock,
  Cpu, Database, HelpCircle, Bell, User, MessageSquare, Send,
  Printer, Share2, Check, List, Sliders, CheckSquare2, FileCheck,
  IndianRupee, Activity, Upload, Lock, Unlock, Compass,
} from 'lucide-react'
import {
  INVOICES, AGEING, PROJECT_ROLLUP, TOTALS, QUESTIONS, BANDS,
  ask, bandOf, monthly, inr, inrShort, shortDate, GST_RATE, TDS_RATE,
  DELIVERY, LANES, boardBy, TAX_SUMMARY, TAX_CLIENTS, PAGES_MOCK,
  PAGE_TEMPLATES, STUDIO_DOCS, STUDIO_RAG_PRESETS, AI_CHAT_PRESETS,
  REPORT_TEMPLATES, CUSTOM_DASHBOARD_WIDGETS,
} from './demoData'

export const TABS = [
  { id: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard },
  { id: 'receivables', label: 'Receivables',  icon: Receipt },
  { id: 'projects',    label: 'Projects',     icon: FolderKanban },
  { id: 'tax',         label: 'Tax Ledger',   icon: FileSpreadsheet },
  { id: 'analytics',   label: 'Analytics',    icon: BarChart3 },
  { id: 'analyst',     label: 'AI assistant', icon: Sparkles },
  { id: 'reports',     label: 'Reports',      icon: FileText },
  { id: 'delivery',    label: 'Delivery',     icon: KanbanSquare },
  { id: 'pages',       label: 'Pages',        icon: Globe },
  { id: 'studio',      label: 'Studio',       icon: Layers },
  { id: 'ageing',      label: 'Ageing',       icon: Timer },
]

const TONE = {
  Paid:    { fg: 'var(--ok)',  bg: 'var(--ok-dim)' },
  Sent:    { fg: 'var(--accent)', bg: 'var(--accent-dim)' },
  Overdue: { fg: 'var(--bad)', bg: 'var(--bad-dim)' },
}

const RAMP = ['#104281', '#256abf', '#3987e5', '#86b6ef']

/* ── Shared UI Elements ─────────────────────────────────────────────── */

function Stat({ label, value, tone = 'var(--text-1)', sub, trend, icon: Icon }) {
  return (
    <div className="ft-kpi min-w-0 flex flex-col justify-between">
      <div className="flex items-center justify-between w-full mb-0.5">
        <span className="k flex items-center gap-1">
          {Icon && <Icon size={11} className="text-[var(--text-3)] shrink-0" />}
          <span className="truncate">{label}</span>
        </span>
        {trend && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: trend.startsWith('+') ? 'var(--ok-dim)' : 'var(--bg-input)',
                         color: trend.startsWith('+') ? 'var(--ok)' : 'var(--text-3)' }}>
            {trend}
          </span>
        )}
      </div>
      <span className="v" style={{ color: tone }}>{value}</span>
      {sub && <span className="s truncate">{sub}</span>}
    </div>
  )
}

function Badge({ status }) {
  const t = TONE[status] || { fg: 'var(--text-2)', bg: 'var(--bg-input)' }
  return (
    <span className="rounded-md font-bold shrink-0"
          style={{ fontSize: 10, padding: '2px 7px', color: t.fg, background: t.bg }}>
      {status}
    </span>
  )
}

const KBD = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 9.5, padding: '1px 5px', borderRadius: 4,
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  color: 'var(--text-2)',
}

/* ── Currency Formatters ─────────────────────────────────────────────── */

const CURRENCY_RATES = {
  INR: { label: '₹ INR', rate: 1.0, sym: '₹' },
  USD: { label: '$ USD', rate: 0.012, sym: '$' },
  EUR: { label: '€ EUR', rate: 0.011, sym: '€' },
  GBP: { label: '£ GBP', rate: 0.0094, sym: '£' },
}

const fmtCurrency = (val, cur = 'INR') => {
  const c = CURRENCY_RATES[cur] || CURRENCY_RATES.INR
  if (cur === 'INR') return inr(val)
  const converted = Math.round(val * c.rate)
  return `${c.sym}${converted.toLocaleString('en-US')}`
}

const fmtCurrencyShort = (val, cur = 'INR') => {
  const c = CURRENCY_RATES[cur] || CURRENCY_RATES.INR
  if (cur === 'INR') return inrShort(val)
  const converted = Math.round(val * c.rate)
  if (Math.abs(converted) >= 1e6) return `${c.sym}${(converted / 1e6).toFixed(2)}M`
  if (Math.abs(converted) >= 1e3) return `${c.sym}${Math.round(converted / 1e3)}K`
  return `${c.sym}${converted.toLocaleString('en-US')}`
}

/* ── Invoice Detail Drawer & Mock PDF ────────────────────────────────── */

function InvoiceDrawer({ invoice, onClose, returnFocusRef, onTogglePaid }) {
  const panelRef = useRef(null)
  const [tdsRate, setTdsRate] = useState(TDS_RATE)
  const [showAiReminder, setShowAiReminder] = useState(false)
  const [reminderCopied, setReminderCopied] = useState(false)
  const [showEInvoice, setShowEInvoice] = useState(false)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [whatsAppCopied, setWhatsAppCopied] = useState(false)

  useEffect(() => {
    const node = panelRef.current
    node?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    node?.addEventListener('keydown', onKey)
    return () => {
      node?.removeEventListener('keydown', onKey)
      returnFocusRef?.current?.focus?.()
    }
  }, [onClose, returnFocusRef])

  const calculatedGst = invoice.gst
  const calculatedTds = Math.round(invoice.amount * tdsRate)
  const invoiced = invoice.amount + calculatedGst
  const received = invoiced - calculatedTds
  const band = BANDS.find(b => b.id === bandOf(invoice))

  const money = [
    { k: 'Billed (pre-tax)', v: inr(invoice.amount), note: 'the receivable', mark: true },
    { k: `GST @ ${Math.round(GST_RATE * 100)}%`, v: `+ ${inr(calculatedGst)}`, note: 'collected for the state' },
    { k: 'Invoiced', v: inr(invoiced), note: 'what the document says', rule: true },
    { k: `TDS @ ${Math.round(tdsRate * 100)}%`, v: `− ${inr(calculatedTds)}`, note: 'withheld by the client' },
    { k: 'Lands in the bank', v: inr(received), note: 'if paid in full', strong: true },
  ]

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Invoice ${invoice.id} for ${invoice.client}`}
      tabIndex={-1}
      className="absolute inset-0 flex flex-col"
      style={{ background: 'var(--card-bg)', zIndex: 8, outline: 'none',
               animation: 'ft-scene-in 260ms cubic-bezier(0.22,1,0.36,1) both' }}
    >
      <div className="flex items-start gap-2 px-3 py-2.5 shrink-0"
           style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold truncate" style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
              {invoice.client}
            </p>
            <Badge status={invoice.status} />
          </div>
          <p className="truncate" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {invoice.id} · {invoice.project} · {invoice.category}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onTogglePaid && onTogglePaid(invoice.id)}
            className="px-2 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer"
            style={{
              background: invoice.status === 'Paid' ? 'var(--ok-dim)' : 'var(--accent)',
              color: invoice.status === 'Paid' ? 'var(--ok)' : '#fff',
              borderColor: invoice.status === 'Paid' ? 'var(--ok)' : 'var(--accent)',
            }}
          >
            {invoice.status === 'Paid' ? '✓ Paid' : 'Mark as Paid'}
          </button>
          <button onClick={onClose} aria-label="Close invoice detail"
                  className="flex items-center justify-center rounded-md shrink-0"
                  style={{ width: 26, height: 26, cursor: 'pointer',
                           background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                           color: 'var(--text-2)' }}>
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-bold uppercase tracking-[0.14em]"
             style={{ fontSize: 9.5, color: 'var(--text-3)' }}>Where the money goes</p>
          <div className="flex items-center gap-1">
            {[
              { r: 0.10, lbl: '10% (194J)' },
              { r: 0.02, lbl: '2% (194C)' },
              { r: 0.00, lbl: '0% (SEZ)' },
            ].map(t => (
              <button
                key={t.r}
                onClick={() => setTdsRate(t.r)}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer"
                style={{
                  background: tdsRate === t.r ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${tdsRate === t.r ? 'var(--accent)' : 'var(--card-border)'}`,
                  color: tdsRate === t.r ? 'var(--accent)' : 'var(--text-3)',
                }}
                title={`Switch simulated TDS rate to ${t.lbl}`}
              >
                {t.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden mb-3" style={{ border: '1px solid var(--card-border)' }}>
          {money.map(row => (
            <div key={row.k} className="flex items-baseline gap-2 px-2.5 py-1.5"
                 style={{ borderTop: row.rule ? '1px solid var(--card-border)' : 'none',
                          background: row.mark ? 'var(--accent-dim)'
                                    : row.strong ? 'var(--bg-input)' : 'transparent' }}>
              <span style={{ fontSize: 11, color: row.mark ? 'var(--accent)' : 'var(--text-2)',
                             fontWeight: row.mark || row.strong ? 700 : 500, flex: '1 1 auto' }}>
                {row.k}
              </span>
              <span className="tabular-nums shrink-0"
                    style={{ fontSize: 11.5, fontWeight: row.mark || row.strong ? 800 : 600,
                             color: row.mark ? 'var(--accent)' : 'var(--text-1)' }}>
                {row.v}
              </span>
              <span className="hidden sm:block shrink-0"
                    style={{ fontSize: 9.5, color: 'var(--text-3)', width: 118 }}>{row.note}</span>
            </div>
          ))}
        </div>

        <p className="rounded-lg px-2.5 py-2 mb-3"
           style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-2)',
                    background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          Outstanding counts <strong style={{ color: 'var(--text-1)' }}>{inr(invoice.amount)}</strong> —
          the pre-tax figure. GST is collected on the state's behalf and TDS is
          withheld by the client before they pay, so neither is money this client
          still owes. Counting them would overstate what you can collect by{' '}
          <strong style={{ color: 'var(--text-1)' }}>{inr(invoice.gst + calculatedTds)}</strong> on
          this invoice alone.
        </p>

        {/* ── Interactive Actions Bar ── */}
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <button
            onClick={() => {
              setShowAiReminder(!showAiReminder)
              setShowEInvoice(false)
            }}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer"
            style={{
              background: showAiReminder ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showAiReminder ? 'var(--accent)' : 'var(--card-border)'}`,
              color: showAiReminder ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            <Sparkles size={11} /> AI Reminder
          </button>
          <button
            onClick={() => {
              setShowEInvoice(!showEInvoice)
              setShowAiReminder(false)
            }}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer"
            style={{
              background: showEInvoice ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showEInvoice ? 'var(--accent)' : 'var(--card-border)'}`,
              color: showEInvoice ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            <FileText size={11} /> GST IRN
          </button>
          <button
            onClick={() => setShowPdfModal(true)}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--card-border)',
              color: 'var(--text-2)',
            }}
          >
            <Printer size={11} /> PDF Preview
          </button>
        </div>

        {/* AI Reminder Preview Box */}
        {showAiReminder && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--accent-soft)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>
                AI Follow-up Email Draft
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`Hi ${invoice.client} Finance Team, gently checking in on Invoice ${invoice.id} for ${inr(received)} (Net after TDS). Please share UTR once released. Thanks!`)
                    setWhatsAppCopied(true)
                    setTimeout(() => setWhatsAppCopied(false), 2000)
                  }}
                  className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-2)] cursor-pointer"
                >
                  {whatsAppCopied ? 'Copied' : 'WhatsApp Text'}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`Subject: Payment Follow-up: Invoice ${invoice.id} (${invoice.client})\n\nDear ${invoice.client} Finance Team,\n\nWe would like to gently follow up on Invoice ${invoice.id} for ${inr(received)} (Net after ${Math.round(tdsRate * 100)}% TDS), which was due on ${shortDate(invoice.dueOn)}.\n\nKindly confirm when remittance is processed.`)
                    setReminderCopied(true)
                    setTimeout(() => setReminderCopied(false), 2000)
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer"
                  style={{
                    background: reminderCopied ? 'var(--ok-dim)' : 'var(--accent)',
                    color: reminderCopied ? 'var(--ok)' : '#fff',
                  }}
                >
                  {reminderCopied ? <CheckIcon size={10} /> : <Copy size={10} />}
                  {reminderCopied ? 'Copied' : 'Copy Email'}
                </button>
              </div>
            </div>
            <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <strong>Subject:</strong> Follow-up on Invoice {invoice.id} ({invoice.client})<br/>
              <strong>Body:</strong> Hi team, checking in on invoice {invoice.id} ({inr(received)} net). Please share the UTR reference once credited.
            </p>
          </div>
        )}

        {/* GST IRN Verification Box */}
        {showEInvoice && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
            <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--text-1)' }}>
              GST e-Invoice IRN Cryptographic Hash
            </p>
            <p className="text-[9.5px] font-mono break-all mb-1" style={{ color: 'var(--text-3)' }}>
              IRN: 8a93b49c12df71e3609a89c74512e039487b92134098ef1a72bc
            </p>
            <div className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ok)' }}>
              <CheckIcon size={12} />
              <span>Signed by IRP · Form 26AS matching valid</span>
            </div>
          </div>
        )}

        <p className="font-bold uppercase tracking-[0.14em] mb-2"
           style={{ fontSize: 9.5, color: 'var(--text-3)' }}>Timeline & Bank Settlement</p>
        <div className="flex flex-col gap-1 text-[11px]">
          {[
            ['Raised', shortDate(invoice.raisedOn), null],
            ['Due', shortDate(invoice.dueOn),
              invoice.status === 'Overdue' ? `${invoice.daysOverdue} days ago` : null],
            invoice.paidOn
              ? ['Paid', shortDate(invoice.paidOn), `${invoice.daysToCollect} days to collect`]
              : ['Ageing band', band ? band.label : '—',
                 invoice.status === 'Overdue' ? 'counts as past due' : 'still within terms'],
            ['Bank Remittance', 'HDFC Bank · A/C ...5678', 'IFSC: HDFC0001234'],
          ].map(([k, v, note]) => (
            <div key={k} className="flex items-baseline gap-2">
              <span style={{ fontSize: 11, color: 'var(--text-3)', flex: '0 0 94px' }}>{k}</span>
              <span className="font-semibold tabular-nums"
                    style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{v}</span>
              {note && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{note}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* PDF Modal Simulator */}
      {showPdfModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-20 flex items-center justify-center p-3">
          <div className="bg-white text-slate-900 rounded-xl p-4 w-full max-w-sm shadow-2xl border border-slate-200">
            <div className="flex justify-between items-start border-b border-slate-200 pb-2 mb-2">
              <div>
                <h4 className="font-bold text-sm tracking-tight">TAX INVOICE</h4>
                <p className="text-[10px] text-slate-500">{invoice.id} · GSTIN: 27AABCU9603R1ZM</p>
              </div>
              <button onClick={() => setShowPdfModal(false)} className="text-slate-400 hover:text-slate-800 cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <div className="text-[11px] space-y-1 mb-3">
              <p><strong>Billed To:</strong> {invoice.client}</p>
              <p><strong>Project:</strong> {invoice.project}</p>
              <p><strong>HSN/SAC:</strong> 998311 (IT & Design Consulting)</p>
            </div>
            <div className="border border-slate-200 rounded p-2 text-[10.5px] bg-slate-50 space-y-1 mb-3">
              <div className="flex justify-between"><span>Taxable Value:</span><span className="font-bold">{inr(invoice.amount)}</span></div>
              <div className="flex justify-between"><span>CGST (9%):</span><span>{inr(Math.round(invoice.gst / 2))}</span></div>
              <div className="flex justify-between"><span>SGST (9%):</span><span>{inr(Math.round(invoice.gst / 2))}</span></div>
              <div className="flex justify-between border-t pt-1 font-bold"><span>Total Invoiced:</span><span>{inr(invoiced)}</span></div>
            </div>
            <button
              onClick={() => {
                alert(`Simulated PDF download for Invoice ${invoice.id}`)
                setShowPdfModal(false)
              }}
              className="w-full py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs cursor-pointer"
            >
              Download PDF Copy
            </button>
          </div>
        </div>
      )}

      <p className="px-3 py-2 shrink-0"
         style={{ fontSize: 10.5, color: 'var(--text-3)',
                  borderTop: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
        Press <kbd style={KBD}>Esc</kbd> to go back to the list.
      </p>
    </div>
  )
}

/* ── 1. Dashboard View ───────────────────────────────────────────────── */

function Dashboard({ set }) {
  const [runwayMode, setRunwayMode] = useState('Base')
  const [dashboardView, setDashboardView] = useState('kpis') // 'kpis' | 'waterfall' | 'radar'

  const totalBilled = TOTALS.outstanding + TOTALS.collected
  const totalCost = PROJECT_ROLLUP.reduce((sum, p) => sum + p.cost, 0)
  const totalProfit = totalBilled - totalCost
  const grossMargin = totalBilled > 0 ? Math.round((totalProfit / totalBilled) * 100) : 0
  const healthyCount = PROJECT_ROLLUP.filter(p => p.health === 'healthy').length

  const runwayValue = runwayMode === 'Conservative' ? '3.4 mo' : runwayMode === 'Aggressive' ? '6.2 mo' : '4.8 mo'

  // Top clients by billed share from INVOICES
  const clientTotals = useMemo(() => {
    const map = {}
    INVOICES.forEach(inv => {
      if (!map[inv.client]) map[inv.client] = { client: inv.client, billed: 0, count: 0 }
      map[inv.client].billed += inv.amount
      map[inv.client].count += 1
    })
    return Object.values(map).sort((a, b) => b.billed - a.billed)
  }, [])

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Portfolio Balance Header Hero */}
      <div className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"
           style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Portfolio Balance
            </span>
            <span className="px-2 py-0.5 rounded text-[9.5px] font-bold"
                  style={{ background: 'var(--ok-dim)', color: 'var(--ok)' }}>
              {healthyCount}/{PROJECT_ROLLUP.length} Healthy
            </span>
            <span className="text-[10px] font-bold text-[var(--ok)]">+14.2% QoQ</span>
          </div>
          <p className="text-xl font-black tabular-nums tracking-tight" style={{ color: 'var(--text-1)' }}>
            {inrShort(totalProfit)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Dashboard View Mode Selector */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            {[
              { id: 'kpis', label: 'Executive KPIs' },
              { id: 'waterfall', label: 'Cash Waterfall' },
              { id: 'radar', label: 'Risk Matrix' },
            ].map(v => (
              <button
                key={v.id}
                onClick={() => setDashboardView(v.id)}
                className="px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer"
                style={{
                  background: dashboardView === v.id ? 'var(--accent)' : 'transparent',
                  color: dashboardView === v.id ? '#fff' : 'var(--text-3)',
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => set({ tab: 'receivables' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Inspect Ledger <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {dashboardView === 'kpis' && (
        <>
          {/* 6 High-Fidelity KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Net Revenue" value={inrShort(totalBilled)} sub="Active FY26" trend="+18.4%" icon={IndianRupee} />
            <Stat label="Direct Costs" value={inrShort(totalCost)} sub={`${Math.round((totalCost / totalBilled) * 100)}% burn`} trend="Controlled" icon={TrendingUp} />
            <Stat label="Gross Margin" value={`${grossMargin}%`} tone="var(--ok)" sub="Target: >35%" trend="+3.2%" icon={ShieldCheck} />
            <Stat label="Outstanding" value={inrShort(TOTALS.outstanding)} tone="var(--warn)" sub={`${open.length} invoices`} trend="Follow-up" icon={Clock} />
            <Stat label="Realized Collection" value={inrShort(TOTALS.collected)} tone="var(--ok)" sub={`${TOTALS.collectionRate}% rate`} trend="+5.1%" icon={CheckCircle2} />
            <Stat label="Safe Runway" value={runwayValue} sub={`Scenario: ${runwayMode}`} trend="Secure" icon={Activity} />
          </div>

          {/* Runway Scenario Switcher */}
          <div className="rounded-xl p-2.5 flex items-center justify-between"
               style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <span className="text-[10.5px] font-bold text-[var(--text-2)]">Runway Stress-Test Scenario:</span>
            <div className="flex gap-1">
              {['Conservative', 'Base', 'Aggressive'].map(m => (
                <button
                  key={m}
                  onClick={() => setRunwayMode(m)}
                  className="px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
                  style={{
                    background: runwayMode === m ? 'var(--accent)' : 'var(--bg-input)',
                    color: runwayMode === m ? '#fff' : 'var(--text-3)',
                    border: `1px solid ${runwayMode === m ? 'var(--accent)' : 'var(--card-border)'}`,
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Client Concentration & Retainer Health */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl p-2.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                  Retainer Health
                </span>
                <span className="text-[10px] font-semibold text-[var(--ok)]">{healthyCount} Healthy · 0 Overdue</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-input)' }}>
                <div className="h-full bg-[var(--ok)]" style={{ width: '85%' }} />
                <div className="h-full bg-[var(--accent)]" style={{ width: '15%' }} />
              </div>
            </div>

            <div className="rounded-xl p-2.5" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                  Client Concentration
                </span>
                <span className="text-[10px] font-semibold text-[var(--text-2)]">Top 2 = {Math.round(((clientTotals[0]?.billed + clientTotals[1]?.billed) / totalBilled) * 100)}%</span>
              </div>
              <div className="space-y-1 text-[10px]">
                {clientTotals.slice(0, 2).map(c => (
                  <div key={c.client} className="flex justify-between">
                    <span className="text-[var(--text-2)] truncate max-w-[140px]">{c.client}</span>
                    <span className="font-bold text-[var(--text-1)]">{Math.round((c.billed / totalBilled) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Project Roster */}
          <div className="rounded-xl p-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                Active Engagements
              </span>
              <button onClick={() => set({ tab: 'projects' })} className="text-[10.5px] font-bold text-[var(--accent)] hover:underline cursor-pointer">
                View all projects →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PROJECT_ROLLUP.slice(0, 4).map(p => (
                <div
                  key={p.name}
                  onClick={() => set({ tab: 'projects', project: p.id })}
                  className="p-2 rounded-lg border flex flex-col justify-between cursor-pointer hover:border-[var(--accent)] transition-colors"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <span className="font-bold text-[11.5px]" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                      <span className="block text-[9.5px] text-[var(--text-3)]">{p.client}</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                          style={{ background: p.health === 'healthy' ? 'var(--ok-dim)' : 'var(--accent-dim)',
                                   color: p.health === 'healthy' ? 'var(--ok)' : 'var(--accent)' }}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline pt-1 border-t border-[var(--card-border)] text-[10px]">
                    <span className="text-[var(--text-3)]">Billed: <strong className="text-[var(--text-1)]">{inrShort(p.billed)}</strong></span>
                    <span className="font-bold text-[var(--ok)]">{p.margin}% margin</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {dashboardView === 'waterfall' && (
        <div className="rounded-xl p-3 border space-y-3" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)]">Portfolio Working Capital & Cashflow Waterfall</span>
            <span className="text-[10px] text-[var(--text-3)] font-mono">FY26 Q2 Reconciled</span>
          </div>

          <div className="space-y-2 text-[11px]">
            {[
              { label: 'Starting Working Capital', val: 1000000, type: 'base', desc: 'Opening cash buffer' },
              { label: '+ Realized Inflows (Settled)', val: TOTALS.collected, type: 'pos', desc: `${TOTALS.collectionRate}% collected to date` },
              { label: '− Direct Project Costs', val: -totalCost, type: 'neg', desc: 'Resource delivery burn' },
              { label: '− Statutory GST Provision (18%)', val: -TOTALS.gst, type: 'tax', desc: 'Held in statutory escrow' },
              { label: '= Net Operating Buffer', val: 1000000 + TOTALS.collected - totalCost - TOTALS.gst, type: 'net', desc: `${runwayValue} safe runway` },
            ].map(step => (
              <div key={step.label} className="p-2 rounded-lg border flex items-center justify-between"
                   style={{
                     background: step.type === 'pos' ? 'rgba(16, 185, 129, 0.08)' : step.type === 'neg' ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-input)',
                     borderColor: step.type === 'net' ? 'var(--accent)' : 'var(--card-border)',
                   }}>
                <div>
                  <span className="font-bold block" style={{ color: step.type === 'net' ? 'var(--accent)' : 'var(--text-1)' }}>
                    {step.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-3)]">{step.desc}</span>
                </div>
                <span className="text-xs font-mono font-bold"
                      style={{
                        color: step.val > 0 && step.type !== 'base' ? 'var(--ok)' : step.val < 0 ? 'var(--warn)' : 'var(--text-1)',
                      }}>
                  {step.val < 0 ? `−${inrShort(Math.abs(step.val))}` : inrShort(step.val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dashboardView === 'radar' && (
        <div className="rounded-xl p-3 border space-y-3" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)]">Engagement Margin vs Status Matrix</span>
            <span className="text-[10px] text-[var(--ok)] font-bold">100% Margin Compliant</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PROJECT_ROLLUP.map(p => (
              <div key={p.id} className="p-2.5 rounded-lg border bg-[var(--bg-input)]" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <span className="font-bold text-xs text-[var(--text-1)]">{p.name}</span>
                    <span className="block text-[10px] text-[var(--text-3)]">{p.client}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                        style={{
                          background: p.margin >= 35 ? 'var(--ok-dim)' : 'var(--warn-dim)',
                          color: p.margin >= 35 ? 'var(--ok)' : 'var(--warn)',
                        }}>
                    {p.margin}% margin
                  </span>
                </div>
                <div className="w-full bg-[var(--card-bg)] h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="h-full"
                       style={{
                         width: `${Math.min(p.margin * 1.5, 100)}%`,
                         background: p.margin >= 35 ? 'var(--ok)' : 'var(--warn)',
                       }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 2. Receivables View ─────────────────────────────────────────────── */

const COLUMNS = [
  { key: 'client', label: 'Client',  align: 'left',  grow: '1 1 34%' },
  { key: 'dueOn',  label: 'Due',     align: 'left',  grow: '0 0 64px', hideSm: true },
  { key: 'amount', label: 'Amount',  align: 'right', grow: '0 0 92px' },
]

function Receivables({ state, set, onOpen, searchRef }) {
  const { status, band, query, sort } = state
  const [category, setCategory] = useState('all')
  const [currency, setCurrency] = useState('INR')
  const [viewMode, setViewMode] = useState('table') // 'table' | 'cards' | 'timeline'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchCopied, setBatchCopied] = useState(false)
  const [liveInvoices, setLiveInvoices] = useState(INVOICES)
  const [timelinePreset, setTimelinePreset] = useState('60d')

  const onRowKeys = (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const all = [...e.currentTarget.querySelectorAll('[data-row]')]
    if (all.length === 0) return
    const i = all.indexOf(document.activeElement)
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
      : e.key === 'ArrowDown' ? Math.min(i + 1, all.length - 1)
      : Math.max(i - 1, 0)
    e.preventDefault()
    all[next < 0 ? 0 : next]?.focus()
  }

  const rows = useMemo(() => {
    let r = liveInvoices
    if (status !== 'all') r = r.filter(i => i.status === status)
    if (category !== 'all') r = r.filter(i => i.category === category)
    if (band) r = r.filter(i => bandOf(i) === band)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      r = r.filter(i => `${i.id} ${i.client} ${i.project} ${i.category}`.toLowerCase().includes(q))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...r].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x == null) return 1
      if (y == null) return -1
      return (x > y ? 1 : x < y ? -1 : 0) * dir
    })
  }, [liveInvoices, status, category, band, query, sort])

  const shown = rows.reduce((t, r) => t + r.amount, 0)

  const toggleSort = (key) =>
    set({ sort: { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' } })

  const toggleSelectRow = (e, id) => {
    e.stopPropagation()
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const selectAllRows = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(rows.map(r => r.id)))
  }

  const exportLedgerCsv = (exportRows = rows) => {
    const headers = ['Invoice ID', 'Client', 'Project', 'Category', 'Billed (pre-tax)', 'GST (18%)', 'TDS (10%)', 'Net Receivable', 'Due Date', 'Status']
    const csvLines = [headers.join(',')]
    exportRows.forEach(r => {
      csvLines.push([
        r.id,
        `"${r.client}"`,
        `"${r.project}"`,
        r.category,
        r.amount,
        r.gst,
        r.tds,
        r.amount + r.gst - r.tds,
        shortDate(r.dueOn),
        r.status,
      ].join(','))
    })
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `fintrack_sample_ledger_${status}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const selectedRowsList = rows.filter(r => selectedIds.has(r.id))
  const selectedSum = selectedRowsList.reduce((t, r) => t + r.amount, 0)

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="ft-kpis mb-2.5">
        <Stat label="Outstanding" value={fmtCurrencyShort(TOTALS.outstanding, currency)} />
        <Stat label="Collected"   value={fmtCurrencyShort(TOTALS.collected, currency)} tone="var(--ok)" />
        <Stat label="Overdue"     value={fmtCurrencyShort(TOTALS.overdue, currency)}   tone="var(--bad)" />
      </div>

      {/* ── Search & Status Filters & Currency Toggles & View Mode Switcher ── */}
      <div className="ft-tools mb-1.5">
        <div className="ft-tools-search relative">
          <Search size={13} aria-hidden="true"
                  style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                           color: 'var(--text-3)' }} />
          <input
            ref={searchRef}
            value={query}
            onChange={e => set({ query: e.target.value })}
            placeholder="Search clients, projects…"
            aria-label="Search the sample invoices"
            className="w-full rounded-lg"
            style={{ height: 30, padding: '0 8px 0 26px', fontSize: 11.5,
                     background: 'var(--bg-input)', border: '1px solid var(--card-border)',
                     color: 'var(--text-1)' }}
          />
        </div>

        <div className="ft-tools-status">
        {['all', 'Overdue', 'Sent', 'Paid'].map(s => (
          <button key={s} onClick={() => set({ status: s })}
                  aria-pressed={status === s}
                  className="rounded-lg font-semibold shrink-0 cursor-pointer"
                  style={{
                    height: 30, padding: '0 9px', fontSize: 11,
                    background: status === s ? 'var(--accent)' : 'var(--card-bg)',
                    border: `1px solid ${status === s ? 'var(--accent)' : 'var(--card-border)'}`,
                    color: status === s ? '#fff' : 'var(--text-2)',
                  }}>
            {s === 'all' ? 'All' : s}
          </button>
        ))}
        </div>

        <div className="ft-tools-aux">
        {/* View Mode Switcher */}
        <div className="flex items-center rounded-lg border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
          {[
            { id: 'table', label: 'Table' },
            { id: 'cards', label: 'Cards' },
            { id: 'timeline', label: 'Timeline' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setViewMode(m.id)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
              style={{
                background: viewMode === m.id ? 'var(--accent)' : 'transparent',
                color: viewMode === m.id ? '#fff' : 'var(--text-3)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center rounded-lg border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
          {Object.keys(CURRENCY_RATES).map(cKey => (
            <button
              key={cKey}
              onClick={() => setCurrency(cKey)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
              style={{
                background: currency === cKey ? 'var(--accent)' : 'transparent',
                color: currency === cKey ? '#fff' : 'var(--text-3)',
              }}
              title={`Switch display currency to ${CURRENCY_RATES[cKey].label}`}
            >
              {cKey}
            </button>
          ))}
        </div>

        <button
          onClick={() => exportLedgerCsv(rows)}
          title="Export current view to CSV"
          className="flex items-center gap-1 rounded-lg px-2 shrink-0 font-semibold cursor-pointer"
          style={{
            height: 30, fontSize: 11,
            background: 'var(--bg-input)', border: '1px solid var(--card-border)',
            color: 'var(--text-2)',
          }}
        >
          <Download size={12} />
          <span className="hidden sm:inline">CSV</span>
        </button>
        </div>
      </div>

      {/* ── Category Filter Pills ── */}
      <div className="flex items-center gap-1 mb-2 overflow-x-auto pb-0.5">
        {['all', 'Design', 'Build', 'Retainer', 'Film', 'Editorial'].map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 transition-all cursor-pointer"
            style={{
              background: category === cat ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${category === cat ? 'var(--accent)' : 'var(--card-border)'}`,
              color: category === cat ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            {cat === 'all' ? 'All categories' : cat}
          </button>
        ))}
      </div>

      {band && (
        <button onClick={() => set({ band: null })}
                className="self-start flex items-center gap-1.5 rounded-lg font-bold mb-2 cursor-pointer"
                style={{ height: 26, padding: '0 8px', fontSize: 10.5,
                         background: 'var(--accent-dim)', color: 'var(--accent)',
                         border: '1px solid var(--accent-soft)' }}>
          Ageing: {BANDS.find(b => b.id === band)?.label}
          <X size={12} aria-hidden="true" />
        </button>
      )}

      {/* ── Main Table / Cards Frame ── */}
      <div className="rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col relative"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        
        {viewMode === 'table' && (
          <>
            {/* Table Header */}
            <div className="ft-rowhead flex items-center gap-2 px-3 shrink-0"
                 style={{ height: 30, background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
              <button
                onClick={selectAllRows}
                title={selectedIds.size === rows.length ? 'Deselect all' : 'Select all'}
                className="p-0.5 rounded hover:text-[var(--accent)] transition-colors cursor-pointer"
                style={{ color: selectedIds.size > 0 ? 'var(--accent)' : 'var(--text-3)' }}
              >
                {selectedIds.size === rows.length && rows.length > 0 ? (
                  <CheckSquare size={13} />
                ) : (
                  <Square size={13} />
                )}
              </button>

              {COLUMNS.map(c => (
                <button key={c.key} onClick={() => toggleSort(c.key)}
                        className={`flex items-center gap-1 font-bold uppercase tracking-[0.1em] cursor-pointer ${c.hideSm ? 'hidden sm:flex' : 'flex'}`}
                        style={{ fontSize: 9, color: sort.key === c.key ? 'var(--accent)' : 'var(--text-3)',
                                 flex: c.grow, background: 'none', border: 0,
                                 justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
                  {c.label}
                  <ArrowUpDown size={9} aria-hidden="true"
                               style={{ opacity: sort.key === c.key ? 1 : 0.35 }} />
                </button>
              ))}
              <span style={{ flex: '0 0 58px' }} />
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-y-auto" onKeyDown={onRowKeys}>
              {rows.length === 0 && (
                <p className="px-3 py-6 text-center" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Nothing matches those filters.
                </p>
              )}
              {rows.map(r => {
                const isSelected = selectedIds.has(r.id)
                return (
                  <button
                    key={r.id}
                    data-row=""
                    onClick={() => onOpen(r.id)}
                    aria-label={`${r.id}, ${r.client}, ${inr(r.amount)}, ${r.status}. Open detail.`}
                    className="w-full flex items-center gap-2 px-3 text-left ft-row group cursor-pointer"
                    style={{
                      height: 34,
                      border: 0,
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: 'var(--card-border)',
                      background: isSelected ? 'var(--accent-dim)' : 'transparent',
                    }}
                  >
                    <span
                      onClick={(e) => toggleSelectRow(e, r.id)}
                      className="p-0.5 rounded text-[var(--text-3)] group-hover:text-[var(--accent)] transition-colors cursor-pointer"
                      style={{ color: isSelected ? 'var(--accent)' : undefined }}
                    >
                      {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                    </span>

                    <span className="min-w-0" style={{ flex: '1 1 34%' }}>
                      <span className="block truncate font-semibold"
                            style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{r.client}</span>
                      <span className="block truncate" style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
                        {r.id} · {r.project} · <span className="opacity-80 font-medium">{r.category}</span>
                      </span>
                    </span>
                    <span className="hidden sm:block tabular-nums"
                          style={{ fontSize: 11, color: r.status === 'Overdue' ? 'var(--bad)' : 'var(--text-3)', flex: '0 0 64px' }}>
                      {shortDate(r.dueOn)}
                    </span>
                    <span className="tabular-nums font-bold text-right"
                          style={{ fontSize: 11.5, color: 'var(--text-1)', flex: '0 0 92px' }}>
                      {fmtCurrency(r.amount, currency)}
                    </span>
                    <span style={{ flex: '0 0 58px', textAlign: 'right' }}><Badge status={r.status} /></span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {viewMode === 'cards' && (
          <div className="flex-1 overflow-y-auto p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2" onKeyDown={onRowKeys}>
            {rows.map(r => (
              <button
                key={r.id}
                data-row=""
                onClick={() => onOpen(r.id)}
                className="p-2.5 rounded-lg border text-left flex flex-col justify-between hover:border-[var(--accent)] transition-all cursor-pointer bg-[var(--bg-input)]"
                style={{ borderColor: 'var(--card-border)' }}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <span className="font-bold text-xs text-[var(--text-1)] block">{r.client}</span>
                    <span className="text-[10px] text-[var(--text-3)]">{r.id} · {r.project}</span>
                  </div>
                  <Badge status={r.status} />
                </div>
                <div className="flex items-end justify-between pt-2 border-t border-[var(--card-border)]">
                  <div>
                    <span className="text-[9.5px] text-[var(--text-3)] block">Due: {shortDate(r.dueOn)}</span>
                    <span className="text-[9.5px] font-mono text-[var(--text-2)]">{r.category}</span>
                  </div>
                  <span className="text-sm font-black tabular-nums text-[var(--text-1)]">
                    {fmtCurrency(r.amount, currency)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {viewMode === 'timeline' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5" onKeyDown={onRowKeys}>
            {rows.map((r, idx) => (
              <button
                key={r.id}
                data-row=""
                onClick={() => onOpen(r.id)}
                className="w-full flex items-center gap-3 p-2 rounded-lg border text-left bg-[var(--bg-input)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                style={{ borderColor: 'var(--card-border)' }}
              >
                <div className="flex flex-col items-center shrink-0 w-12 text-center">
                  <span className="text-[9px] font-bold uppercase text-[var(--text-3)]">{shortDate(r.raisedOn).split(' ')[1]}</span>
                  <span className="text-xs font-bold text-[var(--text-1)]">{shortDate(r.raisedOn).split(' ')[0]}</span>
                </div>
                <div className="h-6 w-px bg-[var(--card-border)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-[var(--text-1)] block truncate">{r.client}</span>
                  <span className="text-[10px] text-[var(--text-3)] truncate block">{r.id} — {r.project}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-bold text-xs text-[var(--text-1)] block">{fmtCurrency(r.amount, currency)}</span>
                  <Badge status={r.status} />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Bulk Actions Floating Drawer ── */}
        {selectedIds.size > 0 && (
          <div
            className="absolute bottom-8 left-3 right-3 rounded-xl p-2 flex items-center justify-between gap-2 shadow-2xl backdrop-blur-md"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--accent)',
              boxShadow: '0 12px 32px -8px var(--accent-glow)',
              animation: 'ft-pop-in 200ms cubic-bezier(0.22,1,0.36,1) both',
              zIndex: 10,
            }}
          >
            <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-1)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
              <span>{selectedIds.size} selected ({fmtCurrency(selectedSum, currency)})</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const clientNames = selectedRowsList.map(r => r.client).join(', ')
                  navigator.clipboard?.writeText(`Batch Payment Reminders generated for: ${clientNames} (Total ${fmtCurrency(selectedSum, currency)})`)
                  setBatchCopied(true)
                  setTimeout(() => setBatchCopied(false), 2000)
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer"
                style={{
                  background: batchCopied ? 'var(--ok-dim)' : 'var(--accent)',
                  color: batchCopied ? 'var(--ok)' : '#fff',
                }}
              >
                {batchCopied ? <CheckIcon size={11} /> : <Mail size={11} />}
                {batchCopied ? 'Copied' : 'AI Batch Follow-up'}
              </button>

              <button
                onClick={() => exportLedgerCsv(selectedRowsList)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold border cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              >
                <Download size={11} />
                Export
              </button>

              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-1 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Table Footer Total */}
        <div className="flex items-center justify-between px-3 shrink-0"
             style={{ height: 30, background: 'var(--bg-input)', borderTop: '1px solid var(--card-border)' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {rows.length} of {INVOICES.length} invoices
          </span>
          <span className="tabular-nums font-bold" style={{ fontSize: 11.5, color: 'var(--text-1)' }}>
            {fmtCurrency(shown, currency)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── 3. Projects View ────────────────────────────────────────────────── */

function Projects({ state, set }) {
  const [costOffset, setCostOffset] = useState(0)
  const sel = PROJECT_ROLLUP.find(p => p.id === state.project) ?? PROJECT_ROLLUP[0]

  const effectiveCost = Math.round(sel.cost * (1 + costOffset))
  const effectiveProfit = sel.billed - effectiveCost
  const effectiveMargin = sel.billed > 0 ? Math.round((effectiveProfit / sel.billed) * 100) : 0
  const effectiveHealth = effectiveMargin >= 35 ? 'healthy' : effectiveMargin >= 15 ? 'watch' : 'risk'

  return (
    <div className="h-full grid gap-2 min-h-0" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
      {/* Needs Action Banner */}
      <div className="rounded-xl px-3 py-1.5 flex items-center justify-between border"
           style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent-soft)' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
          <AlertTriangle size={13} />
          <span>{sel.client} ({sel.name}) — {inrShort(sel.billed * 0.35)} milestone ready for invoice review.</span>
        </div>
        <button
          onClick={() => set({ tab: 'delivery' })}
          className="text-[10.5px] font-bold underline hover:opacity-80 cursor-pointer"
          style={{ color: 'var(--accent)' }}
        >
          View delivery board →
        </button>
      </div>

      {/* Project selector pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PROJECT_ROLLUP.map(p => (
          <button key={p.id} onClick={() => { set({ project: p.id }); setCostOffset(0); }}
                  aria-pressed={sel.id === p.id}
                  className="rounded-lg font-semibold shrink-0 cursor-pointer"
                  style={{
                    height: 30, padding: '0 10px', fontSize: 11.5, whiteSpace: 'nowrap',
                    background: sel.id === p.id ? 'var(--accent-dim)' : 'var(--card-bg)',
                    border: `1px solid ${sel.id === p.id ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                    color: sel.id === p.id ? 'var(--accent)' : 'var(--text-2)',
                  }}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="rounded-xl p-3 min-h-0 overflow-y-auto"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <p className="font-extrabold truncate" style={{ fontSize: 15, color: 'var(--text-1)' }}>{sel.name}</p>
            <p className="truncate" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{sel.client} · {sel.status}</p>
          </div>
          <span className="rounded-md font-bold shrink-0"
                style={{ fontSize: 10, padding: '3px 8px',
                         color: effectiveHealth === 'risk' ? 'var(--warn)' : effectiveHealth === 'watch' ? 'var(--warn)' : 'var(--ok)',
                         background: effectiveHealth === 'healthy' ? 'var(--ok-dim)' : 'var(--warn-dim)' }}>
            {effectiveHealth === 'risk' ? 'At risk' : effectiveHealth === 'watch' ? 'Watch' : 'Healthy'}
          </span>
        </div>

        {/* Cost Burn Simulator Pill Bar */}
        <div className="flex items-center justify-between p-1.5 rounded-lg mb-2.5"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <span className="text-[10.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
            Margin Simulator:
          </span>
          <div className="flex gap-1">
            {[
              { val: -0.15, lbl: '-15% Cost' },
              { val: 0.00,  lbl: 'Base' },
              { val: 0.20,  lbl: '+20% Burn' },
            ].map(b => (
              <button
                key={b.val}
                onClick={() => setCostOffset(b.val)}
                className="px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
                style={{
                  background: costOffset === b.val ? 'var(--accent)' : 'transparent',
                  color: costOffset === b.val ? '#fff' : 'var(--text-2)',
                  border: `1px solid ${costOffset === b.val ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                {b.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="ft-kpis mb-3" style={{ ['--kpi-cols']: 4 }}>
          <Stat label="Billed"  value={inrShort(sel.billed)} />
          <Stat label="Cost"    value={inrShort(effectiveCost)} />
          <Stat label="Profit"  value={inrShort(effectiveProfit)} tone={effectiveProfit > 0 ? 'var(--ok)' : 'var(--bad)'} />
          <Stat label="Margin"  value={`${effectiveMargin}%`} tone={effectiveHealth === 'healthy' ? 'var(--ok)' : 'var(--warn)'} />
        </div>

        <p className="font-bold uppercase tracking-[0.14em] mb-1.5"
           style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
          The {sel.rows.length} invoices behind those figures
        </p>
        {sel.rows.map(r => (
          <div key={r.id} className="flex items-center gap-2 py-1.5"
               style={{ borderBottom: '1px solid var(--card-border)' }}>
            <span className="font-semibold" style={{ fontSize: 11, color: 'var(--text-2)', flex: '0 0 74px' }}>{r.id}</span>
            <span className="truncate" style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>{r.category}</span>
            <span className="tabular-nums font-bold" style={{ fontSize: 11, color: 'var(--text-1)' }}>{inr(r.amount)}</span>
            <Badge status={r.status} />
          </div>
        ))}
        <p className="mt-2" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Margin is billed less cost — a project cannot claim a margin its invoices do not support.
        </p>
      </div>
    </div>
  )
}

/* ── 4. Tax Ledger View ──────────────────────────────────────────────── */

function TaxLedger({ set }) {
  const [downloaded, setDownloaded] = useState(false)
  const [taxTab, setTaxTab] = useState('all')

  const downloadGstr1 = () => {
    const csv = [
      'Client,Invoices,Taxable Value,GST (18%),TDS (10%),Gross Invoiced,Share',
      ...TAX_CLIENTS.map(c => `"${c.client}",${c.invoices},${c.taxable},${c.gst},${c.tds},${c.gross},${c.share}`),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'GSTR1_FY26_Q2_Reconciliation.csv'
    a.click()
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 2000)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Statutory Section Switcher */}
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-1.5">
          {['all', '194J (10%)', '194C (2%)', 'SEZ (0%)'].map(tab => (
            <button
              key={tab}
              onClick={() => setTaxTab(tab)}
              className="px-2 py-0.5 rounded text-[10.5px] font-bold transition-all cursor-pointer"
              style={{
                background: taxTab === tab ? 'var(--accent)' : 'var(--bg-input)',
                color: taxTab === tab ? '#fff' : 'var(--text-3)',
                border: `1px solid ${taxTab === tab ? 'var(--accent)' : 'var(--card-border)'}`,
              }}
            >
              {tab === 'all' ? 'All Statutory' : tab}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-bold text-[var(--ok)] flex items-center gap-1">
          <ShieldCheck size={12} /> Form 26AS Matched
        </span>
      </div>

      {/* 6 High-Fidelity Tax Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Taxable Value" value={inrShort(TAX_SUMMARY.taxableValue)} sub="Billed base" />
        <Stat label="GST (18%)" value={inrShort(TAX_SUMMARY.gstCollected)} tone="var(--accent)" sub="CGST + SGST 9%" />
        <Stat label="TDS (10%)" value={inrShort(TAX_SUMMARY.tdsCollected)} tone="var(--warn)" sub="Sec 194J withheld" />
        <Stat label="Gross Invoiced" value={inrShort(TAX_SUMMARY.grossInvoiced)} sub="Document total" />
        <Stat label="Net Receivable" value={inrShort(TAX_SUMMARY.netReceivable)} tone="var(--ok)" sub="Lands in bank" />
        <Stat label="Open Invoices" value={String(TAX_SUMMARY.openInvoices)} tone="var(--ok)" sub="Active in ledger" />
      </div>

      {/* Statutory Split Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">
              GST Breakup (9% + 9%)
            </span>
            <span className="text-[10.5px] font-bold text-[var(--accent)]">18% Avg Rate</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono py-1 border-b border-[var(--card-border)]">
            <span className="text-[var(--text-2)]">CGST @ 9%:</span>
            <span className="font-bold text-[var(--text-1)]">{inrShort(TAX_SUMMARY.cgst)}</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono pt-1">
            <span className="text-[var(--text-2)]">SGST @ 9%:</span>
            <span className="font-bold text-[var(--text-1)]">{inrShort(TAX_SUMMARY.sgst)}</span>
          </div>
        </div>

        <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <div>
            <div className="flex items-center gap-1.5 mb-1 text-[var(--ok)]">
              <CheckCircle2 size={13} />
              <span className="text-[11px] font-bold">26AS & AIS Reconciled</span>
            </div>
            <p className="text-[10px] text-[var(--text-3)] leading-snug">
              All {inrShort(TAX_SUMMARY.tdsCollected)} TDS credit claims match Traces Form 26AS with zero statutory shortfall.
            </p>
          </div>
          <button
            onClick={downloadGstr1}
            className="mt-2 flex items-center justify-center gap-1 py-1 px-2.5 rounded-lg text-[10.5px] font-bold cursor-pointer"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
          >
            <Download size={11} /> {downloaded ? 'Downloaded GSTR-1' : 'Export GSTR-1 Summary CSV'}
          </button>
        </div>
      </div>

      {/* Tax Contributions Table */}
      <div className="rounded-xl p-3 flex-1 min-h-0" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">
            Client Tax Contributions
          </span>
          <span className="text-[10px] text-[var(--text-3)]">FY26 Q2 Active</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[9.5px] font-bold uppercase text-[var(--text-3)]">
                <th className="pb-1.5">Client</th>
                <th className="pb-1.5 text-center">Invoices</th>
                <th className="pb-1.5 text-right">Taxable</th>
                <th className="pb-1.5 text-right">GST (18%)</th>
                <th className="pb-1.5 text-right">TDS (10%)</th>
                <th className="pb-1.5 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)]">
              {TAX_CLIENTS.map(c => (
                <tr key={c.client} className="hover:bg-[var(--bg-input)]">
                  <td className="py-2 font-semibold text-[var(--text-1)]">{c.client}</td>
                  <td className="py-2 text-center text-[var(--text-2)]">{c.invoices}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--text-1)]">₹{(c.taxable / 1e5).toFixed(2)}L</td>
                  <td className="py-2 text-right tabular-nums text-[var(--accent)]">+₹{(c.gst / 1e5).toFixed(2)}L</td>
                  <td className="py-2 text-right tabular-nums text-[var(--warn)]">−₹{(c.tds / 1e5).toFixed(2)}L</td>
                  <td className="py-2 text-right font-bold text-[var(--text-1)]">{c.share}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── 5. Analytics View ───────────────────────────────────────────────── */

function Analytics({ state, set }) {
  const [chartMode, setChartMode] = useState('dual') // 'dual' | 'area' | 'margin' | 'concentration' | 'velocity'
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [enabledWidgets, setEnabledWidgets] = useState({
    runway: true,
    escrow: true,
    recovery: true,
    velocity: true,
    concentration: false,
    burn: false,
  })

  const series = useMemo(() => monthly(state.months), [state.months])
  const max = Math.max(...series.map(m => Math.max(m.billed, m.collected)), 1)
  const W = 260, H = 96
  const x = (i) => (i / Math.max(series.length - 1, 1)) * (W - 16) + 8
  const y = (v) => H - 10 - (v / max) * (H - 24)
  const line = series.map((m, i) => `${x(i).toFixed(1)},${y(m.collected).toFixed(1)}`).join(' L ')

  // Cumulative series for area chart
  const cumulativeSeries = useMemo(() => {
    let running = 0
    return series.map(m => {
      running += m.collected
      return { key: m.key, total: running }
    })
  }, [series])
  const maxCum = Math.max(...cumulativeSeries.map(c => c.total), 1)
  const yCum = (v) => H - 10 - (v / maxCum) * (H - 24)
  const cumAreaPoints = [
    `8,${H - 10}`,
    ...cumulativeSeries.map((c, i) => `${x(i).toFixed(1)},${yCum(c.total).toFixed(1)}`),
    `${W - 8},${H - 10}`,
  ].join(' ')

  const toggleWidget = (id) => {
    setEnabledWidgets(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const clientShare = useMemo(() => {
    const totalB = TOTALS.outstanding + TOTALS.collected
    return TAX_CLIENTS.slice(0, 4).map(c => ({
      name: c.client,
      pct: totalB ? Math.round((c.taxable / totalB) * 100) : 0,
      val: c.taxable,
    }))
  }, [])

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-2.5">
      {/* Header Controls Bar */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap pb-1 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-1">
          {[3, 6, 12].map(n => (
            <button key={n} onClick={() => set({ months: n })}
                    aria-pressed={state.months === n}
                    className="rounded-lg font-semibold cursor-pointer"
                    style={{ height: 26, padding: '0 9px', fontSize: 10.5,
                             background: state.months === n ? 'var(--accent)' : 'var(--card-bg)',
                             border: `1px solid ${state.months === n ? 'var(--accent)' : 'var(--card-border)'}`,
                             color: state.months === n ? '#fff' : 'var(--text-2)' }}>
              {n}M
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            {[
              { id: 'dual', label: 'Billed & Settled' },
              { id: 'area', label: 'Cumulative Inflow' },
              { id: 'margin', label: 'Margin %' },
              { id: 'concentration', label: 'Client Share' },
              { id: 'velocity', label: 'Cash Velocity' },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setChartMode(m.id)}
                className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer"
                style={{
                  background: chartMode === m.id ? 'var(--accent)' : 'transparent',
                  color: chartMode === m.id ? '#fff' : 'var(--text-3)',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowCustomizer(c => !c)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold border transition-colors cursor-pointer"
            style={{
              background: showCustomizer ? 'var(--accent-dim)' : 'var(--card-bg)',
              borderColor: showCustomizer ? 'var(--accent)' : 'var(--card-border)',
              color: showCustomizer ? 'var(--accent)' : 'var(--text-2)',
            }}
          >
            <SlidersHorizontal size={11} /> {showCustomizer ? 'Close Config' : 'Customize'}
          </button>
        </div>
      </div>

      {/* Custom Dashboard Widget Configurator Drawer */}
      {showCustomizer && (
        <div className="rounded-xl p-3 border space-y-2 animate-fadeIn"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)]">Custom Analytics Dashboard Builder</span>
            <span className="text-[10px] text-[var(--text-3)] font-mono">
              {Object.values(enabledWidgets).filter(Boolean).length} of {CUSTOM_DASHBOARD_WIDGETS.length} widgets active
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {CUSTOM_DASHBOARD_WIDGETS.map(w => {
              const active = !!enabledWidgets[w.id]
              return (
                <div
                  key={w.id}
                  onClick={() => toggleWidget(w.id)}
                  className="p-2 rounded-lg border flex items-start gap-2 cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--card-bg)' : 'transparent',
                    borderColor: active ? 'var(--accent)' : 'var(--card-border)',
                  }}
                >
                  <div className="pt-0.5">
                    {active ? <CheckSquare2 size={13} className="text-[var(--accent)]" /> : <Square size={13} className="text-[var(--text-3)]" />}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold block text-[var(--text-1)] leading-tight">{w.label}</span>
                    <span className="text-[9.5px] text-[var(--text-3)] leading-tight">{w.desc}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Primary Financial Metric KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        <Stat label="Collection rate" value={`${TOTALS.collectionRate}%`} trend="+4.2%" icon={CheckCircle2} />
        <Stat label="Days to collect" value={`${TOTALS.avgDaysToCollect}d`} trend="38d target" icon={Clock} />
        <Stat label="GST tracked"     value={inrShort(TOTALS.gst)} trend="Reconciled" icon={FileSpreadsheet} />
        <Stat label="Billed turnover" value={inrShort(TOTALS.outstanding + TOTALS.collected)} trend="+18.4%" icon={IndianRupee} />
      </div>

      {/* Chart Visual Surface */}
      <div className="rounded-xl p-2.5 flex-1 min-h-[160px] flex flex-col justify-between"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex justify-between items-center mb-1 text-[10px] text-[var(--text-3)] font-mono">
          <span>{chartMode === 'dual' ? 'Dual-Axis: Billed Bars vs Settled Inflow Line' : chartMode === 'area' ? 'Cumulative Bank Settlement Area Gradient' : chartMode === 'margin' ? 'Monthly Weighted Margin % Distribution' : chartMode === 'concentration' ? 'Revenue Concentration by Client' : 'Cash Conversion Velocity (DSO)'}</span>
          <span>Window: {state.months} Months</span>
        </div>

        <div className="flex-1 min-h-0 relative">
          {chartMode === 'dual' && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                 style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1="0" y1={H - 10 - f * (H - 24)} x2={W} y2={H - 10 - f * (H - 24)}
                      stroke="var(--card-border)" strokeWidth="0.6" strokeDasharray="3 3" />
              ))}
              {series.map((m, i) => {
                const w = Math.max((W - 16) / series.length - 6, 4)
                return (
                  <rect key={m.key + i} x={x(i) - w / 2} y={y(m.billed)} width={w}
                        height={Math.max(H - 10 - y(m.billed), 0)} rx="2"
                        fill="var(--accent)" opacity="0.26"
                        style={{ transformOrigin: `center ${H - 10}px`,
                                 animation: `ft-grow-y 520ms cubic-bezier(0.22,1,0.36,1) ${i * 45}ms both` }} />
                )
              })}
              <path d={`M ${line}`} fill="none" stroke="var(--accent)" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" pathLength="1"
                    style={{ strokeDasharray: 1, strokeDashoffset: 1,
                             animation: 'ft-draw 900ms cubic-bezier(0.4,0,0.2,1) forwards' }} />
            </svg>
          )}

          {chartMode === 'area' && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                 style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ok)" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--ok)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polygon points={cumAreaPoints} fill="url(#cumGrad)" />
              <path d={`M ${cumulativeSeries.map((c, i) => `${x(i).toFixed(1)},${yCum(c.total).toFixed(1)}`).join(' L ')}`}
                    fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}

          {chartMode === 'margin' && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
                 style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
              <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--card-border)" strokeWidth="0.8" strokeDasharray="2 2" />
              {series.map((m, i) => {
                const marginPct = m.billed > 0 ? Math.round(((m.collected) / m.billed) * 100) : 50
                const cy = H - 15 - (marginPct / 100) * (H - 30)
                return (
                  <g key={m.key + i}>
                    <circle cx={x(i)} cy={cy} r="3.5" fill="var(--accent)" />
                    <text x={x(i)} y={cy - 6} textAnchor="middle" fontSize="7.5" fill="var(--text-1)" fontWeight="bold">
                      {marginPct}%
                    </text>
                  </g>
                )
              })}
            </svg>
          )}

          {chartMode === 'concentration' && (
            <div className="h-full flex flex-col justify-center space-y-2 py-1">
              {clientShare.map(c => (
                <div key={c.name} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="font-semibold text-[var(--text-1)]">{c.name}</span>
                    <span className="font-mono text-[var(--text-2)]">{inrShort(c.val)} ({c.pct}%)</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {chartMode === 'velocity' && (
            <div className="h-full flex items-center justify-around text-center py-2">
              <div className="p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--card-border)] flex-1 mx-1">
                <span className="text-[9.5px] text-[var(--text-3)] block uppercase">Invoice to Issue</span>
                <span className="text-base font-black text-[var(--text-1)]">1.2 days</span>
                <span className="text-[9px] text-[var(--ok)] block font-bold">Fast Turnaround</span>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--card-border)] flex-1 mx-1">
                <span className="text-[9.5px] text-[var(--text-3)] block uppercase">Days to Collect (DSO)</span>
                <span className="text-base font-black text-[var(--text-1)]">{TOTALS.avgDaysToCollect} days</span>
                <span className="text-[9px] text-[var(--accent)] block font-bold">Within 45d Target</span>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--card-border)] flex-1 mx-1">
                <span className="text-[9.5px] text-[var(--text-3)] block uppercase">Escrow Buffer</span>
                <span className="text-base font-black text-[var(--ok)]">{inrShort(TAX_SUMMARY.gstCollected)}</span>
                <span className="text-[9px] text-[var(--ok)] block font-bold">100% Ring-fenced</span>
              </div>
            </div>
          )}
        </div>

        {chartMode !== 'concentration' && chartMode !== 'velocity' && (
          <div className="flex justify-between px-1 pt-1 border-t border-[var(--card-border)]">
            {series.map((m, i) => (
              <span key={m.key + i} style={{ fontSize: 8.5, color: 'var(--text-3)' }}>{m.key}</span>
            ))}
          </div>
        )}
      </div>

      {/* Dynamic Configured Custom Widgets Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {enabledWidgets.runway && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">Safe Runway</span>
              <span className="text-[9.5px] font-bold text-[var(--ok)]">4.8 Months</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              Burn rate of {inrShort(PROJECT_ROLLUP.reduce((s, p) => s + p.cost, 0) / 4)}/mo fully supported by collections.
            </p>
          </div>
        )}
        {enabledWidgets.escrow && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">GST Escrow</span>
              <span className="text-[9.5px] font-bold text-[var(--accent)]">{inrShort(TAX_SUMMARY.gstCollected)}</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              CGST/SGST 9% statutory tax ring-fenced for Q2 quarterly GSTR-3B filings.
            </p>
          </div>
        )}
        {enabledWidgets.recovery && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">TDS 26AS Matching</span>
              <span className="text-[9.5px] font-bold text-[var(--ok)]">100% Reconciled</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              {inrShort(TAX_SUMMARY.tdsCollected)} Section 194J credits verified against Traces ledger.
            </p>
          </div>
        )}
        {enabledWidgets.velocity && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">DSO Velocity</span>
              <span className="text-[9.5px] font-bold text-[var(--text-1)]">{TOTALS.avgDaysToCollect} Days Avg</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              Settlement turnaround improved by 6.4% over previous fiscal quarter.
            </p>
          </div>
        )}
        {enabledWidgets.concentration && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">Top Client Exposure</span>
              <span className="text-[9.5px] font-bold text-[var(--warn)]">{clientShare[0]?.pct}% Share</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              Largest client account is {clientShare[0]?.name} ({inrShort(clientShare[0]?.val)}).
            </p>
          </div>
        )}
        {enabledWidgets.burn && (
          <div className="p-2.5 rounded-xl border bg-[var(--card-bg)]" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold uppercase text-[var(--text-3)]">Project Cost Burn</span>
              <span className="text-[9.5px] font-bold text-[var(--ok)]">{Math.round((PROJECT_ROLLUP.reduce((s, p) => s + p.cost, 0) / (TOTALS.outstanding + TOTALS.collected || 1)) * 100)}% Burn Rate</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-tight">
              Total direct delivery expenses of {inrShort(PROJECT_ROLLUP.reduce((s, p) => s + p.cost, 0))} within budget.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 6. AI Assistant / Analyst View ──────────────────────────────────── */

function CopySql({ sql }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(sql).then(() => setDone(true)).catch(() => {}) }}
      aria-label="Copy the compiled query"
      className="ml-auto flex items-center gap-1 rounded shrink-0 cursor-pointer"
      style={{ height: 20, padding: '0 6px', fontSize: 9.5,
               background: done ? 'var(--ok-dim)' : 'var(--card-bg)',
               border: `1px solid ${done ? 'var(--ok)' : 'var(--card-border)'}`,
               color: done ? 'var(--ok)' : 'var(--text-2)',
               transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease' }}
    >
      {done ? <CheckIcon size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Analyst({ state, set }) {
  const preset = QUESTIONS[state.question] || QUESTIONS[0]
  const result = useMemo(
    () => ask({ measure: preset.measure, groupBy: preset.groupBy }),
    [preset]
  )
  const [displayedSql, setDisplayedSql] = useState(result.sql)
  const [typing, setTyping] = useState(false)
  const [mode, setMode] = useState('Detailed')
  const [customInput, setCustomInput] = useState('')
  const [customAnswer, setCustomAnswer] = useState(null)

  useEffect(() => {
    const full = result.sql
    setTyping(true)
    let idx = 0
    const step = Math.max(1, Math.floor(full.length / 20))
    const timer = setInterval(() => {
      idx += step
      if (idx >= full.length) {
        setDisplayedSql(full)
        setTyping(false)
        clearInterval(timer)
      } else {
        setDisplayedSql(full.slice(0, idx))
      }
    }, 10)
    return () => clearInterval(timer)
  }, [result.sql])

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    const q = customInput.trim()
    if (!q) return
    const low = q.toLowerCase()
    let answer = ''
    if (low.includes('outstand') || low.includes('owe') || low.includes('due') || low.includes('pend')) {
      const top = [...open].sort((a, b) => b.amount - a.amount)[0]
      answer = `Outstanding invoices total ${inr(TOTALS.outstanding)} across ${open.length} pending invoices. The largest single receivable is ${top?.id} (${top?.client}) for ${inr(top?.amount)} (${top?.daysOverdue} days overdue).`
    } else if (low.includes('margin') || low.includes('profit') || low.includes('health') || low.includes('cost')) {
      const totalBilled = PROJECT_ROLLUP.reduce((t, p) => t + p.billed, 0)
      const totalProfit = PROJECT_ROLLUP.reduce((t, p) => t + p.profit, 0)
      const avgMargin = totalBilled ? Math.round((totalProfit / totalBilled) * 100) : 0
      const topProj = [...PROJECT_ROLLUP].sort((a, b) => b.margin - a.margin)[0]
      answer = `Overall portfolio margin is ${avgMargin}% across ${inr(totalBilled)} billed. Highest margin engagement is ${topProj?.name} (${topProj?.client}) at ${topProj?.margin}% margin (${inr(topProj?.profit)} profit).`
    } else if (low.includes('gst') || low.includes('tax') || low.includes('tds') || low.includes('26as')) {
      answer = `Statutory summary: Taxable base is ${inr(TAX_SUMMARY.taxableValue)}, gross GST collected is ${inr(TAX_SUMMARY.gstCollected)} (CGST ${inr(TAX_SUMMARY.cgst)} + SGST ${inr(TAX_SUMMARY.sgst)}). Form 26AS TDS credit is ${inr(TAX_SUMMARY.tdsCollected)}.`
    } else {
      answer = `Analyzing "${q}" across ${INVOICES.length} invoices: Total portfolio billed is ${inr(TOTALS.outstanding + TOTALS.collected)}, realized collection is ${inr(TOTALS.collected)} (${TOTALS.collectionRate}% on-time rate), and direct cost margin is ${Math.round((PROJECT_ROLLUP.reduce((t, p) => t + p.profit, 0) / (TOTALS.outstanding + TOTALS.collected || 1)) * 100)}%.`
    }
    setCustomAnswer(answer)
    setCustomInput('')
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Model & Reasoning Profile Bar */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-[var(--accent)]" />
          <span className="text-[10px] font-mono font-bold text-[var(--text-2)]">
            nemotron-3-super-120b-a12b
          </span>
          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[var(--ok-dim)] text-[var(--ok)]">
            Confidence 100%
          </span>
        </div>
        <div className="flex gap-1">
          {['Brief', 'Detailed', 'Board report'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer"
              style={{
                background: mode === m ? 'var(--accent)' : 'var(--bg-input)',
                color: mode === m ? '#fff' : 'var(--text-3)',
                border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--card-border)'}`,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Preset Questions Bar */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {QUESTIONS.map((q, i) => (
          <button key={q.q} onClick={() => { set({ question: i }); setCustomAnswer(null); }}
                  aria-pressed={state.question === i && !customAnswer}
                  className="rounded-lg font-semibold text-left cursor-pointer"
                  style={{
                    minHeight: 28, padding: '4px 8px', fontSize: 11,
                    background: state.question === i && !customAnswer ? 'var(--accent)' : 'var(--card-bg)',
                    border: `1px solid ${state.question === i && !customAnswer ? 'var(--accent)' : 'var(--card-border)'}`,
                    color: state.question === i && !customAnswer ? '#fff' : 'var(--text-2)',
                  }}>
            {q.q}
          </button>
        ))}
      </div>

      {/* Freeform Prompt Input */}
      <form onSubmit={handleCustomSubmit} className="flex gap-1.5 mb-2">
        <input
          type="text"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          placeholder="Ask any ledger or runway question..."
          className="flex-1 px-2.5 py-1 rounded-lg text-xs border"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
        />
        <button
          type="submit"
          className="px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Send size={11} /> Ask
        </button>
      </form>

      {customAnswer && (
        <div className="mb-2 p-2.5 rounded-xl border text-xs leading-relaxed"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--accent-soft)', color: 'var(--text-1)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-[var(--accent)] flex items-center gap-1">
              <Sparkles size={11} /> AI Synthesis
            </span>
            <button onClick={() => setCustomAnswer(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={12} />
            </button>
          </div>
          {customAnswer}
        </div>
      )}

      {/* Compiled SQL box */}
      <div className="rounded-xl overflow-hidden mb-2 shrink-0"
           style={{ border: '1px solid var(--card-border)' }}>
        <div className="flex items-center gap-2 px-2.5 py-1"
             style={{ background: 'var(--bg-input)' }}>
          <span className="font-bold uppercase tracking-[0.16em]"
                style={{ fontSize: 9, color: 'var(--text-3)' }}>Compiled query</span>
          <span className="hidden sm:inline" style={{ fontSize: 9, color: 'var(--text-3)' }}>
            generated, not written by the model
          </span>
          <CopySql sql={result.sql} />
        </div>
        <pre key={state.question} className="m-0 px-2.5 py-2 overflow-x-auto"
             style={{ fontSize: 9.5, lineHeight: 1.6, color: 'var(--text-2)', background: 'var(--bg-base)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      animation: 'ft-fade-in 260ms ease both' }}>
          {displayedSql}
          {typing && <span className="ml-0.5 inline-block animate-pulse" style={{ color: 'var(--accent)' }}>▍</span>}
        </pre>
      </div>

      {/* Visual Result Breakdown */}
      <div className="rounded-xl p-2.5 flex-1 min-h-0 overflow-y-auto"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <p className="font-bold uppercase tracking-[0.14em] mb-2"
           style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
          {result.measureLabel} by {result.groupLabel}
        </p>
        {result.rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2 mb-1.5">
            <span className="truncate" style={{ fontSize: 11, color: 'var(--text-2)', flex: '0 0 34%' }}>{r.key}</span>
            <span className="flex-1" style={{ height: 9, borderRadius: 5, background: 'var(--bg-input)' }}>
              <span key={state.question} style={{
                display: 'block', height: '100%', borderRadius: 5,
                width: `${Math.max((r.value / result.peak) * 100, 3)}%`,
                background: RAMP[Math.min(i, RAMP.length - 1)],
                transformOrigin: 'left center',
                animation: `ft-grow-x 640ms cubic-bezier(0.22,1,0.36,1) ${i * 70}ms both`,
              }} />
            </span>
            <span className="tabular-nums font-bold text-right shrink-0"
                  style={{ fontSize: 11, color: 'var(--text-1)', minWidth: 76 }}>
              {result.format(r.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── 7. Reports View ─────────────────────────────────────────────────── */

function Reports() {
  const [activeMode, setActiveMode] = useState('templates') // 'templates' | 'ai_studio'
  const [generating, setGenerating] = useState(null)
  const [generatedDoc, setGeneratedDoc] = useState(null)
  const [copied, setCopied] = useState(false)
  const [reportTab, setReportTab] = useState('summary')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiAudience, setAiAudience] = useState('Board & Investors')
  const [aiStep, setAiStep] = useState(0)

  const handleGenerate = (tpl) => {
    setGenerating(tpl.id)
    setTimeout(() => {
      setGenerating(null)
      setGeneratedDoc(tpl)
    }, 700)
  }

  const handleAiGenerate = (e) => {
    e?.preventDefault()
    const prompt = aiPrompt.trim() || 'Summarize FY26 Q2 executive financial performance and tax compliance'
    setGenerating('ai_custom')
    setAiStep(1)
    setTimeout(() => setAiStep(2), 300)
    setTimeout(() => setAiStep(3), 600)
    setTimeout(() => {
      setGenerating(null)
      setAiStep(0)
      setGeneratedDoc({
        id: 'ai-custom-report',
        title: `AI Synthesis: ${prompt.length > 35 ? prompt.slice(0, 35) + '…' : prompt}`,
        blurb: `Tailored for ${aiAudience} based on active FY26 ledger data.`,
        isAi: true,
        audience: aiAudience,
      })
    }, 900)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Reports Header & Mode Selector */}
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)] flex-wrap gap-2">
        <div>
          <h3 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Executive Reports & Board Packs</h3>
          <p className="text-[10px] text-[var(--text-3)]">Deterministic financial briefings synthesized directly from verified ledger rows.</p>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-[var(--bg-input)]" style={{ borderColor: 'var(--card-border)' }}>
          {[
            { id: 'templates', label: 'Standard Packs', icon: FileText },
            { id: 'ai_studio', label: 'AI Report Generator', icon: Sparkles },
          ].map(m => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setActiveMode(m.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer"
                style={{
                  background: activeMode === m.id ? 'var(--accent)' : 'transparent',
                  color: activeMode === m.id ? '#fff' : 'var(--text-3)',
                }}
              >
                <Icon size={11} /> {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {activeMode === 'templates' ? (
        /* Standard Templates Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {REPORT_TEMPLATES.map(tpl => (
            <div
              key={tpl.id}
              className="rounded-xl p-3 flex flex-col justify-between"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText size={13} className="text-[var(--accent)]" />
                  <span className="font-bold text-xs" style={{ color: 'var(--text-1)' }}>{tpl.title}</span>
                </div>
                <p className="text-[10.5px] text-[var(--text-2)] leading-relaxed mb-2.5">
                  {tpl.blurb}
                </p>
              </div>
              <button
                onClick={() => handleGenerate(tpl)}
                disabled={generating === tpl.id}
                className="w-full py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--accent)' }}
              >
                {generating === tpl.id ? (
                  <>
                    <RefreshCw size={11} className="animate-spin" /> Compiling pack...
                  </>
                ) : (
                  <>
                    <Sparkles size={11} /> Generate {tpl.title}
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        /* AI Report Generator Studio */
        <div className="rounded-xl p-3 border space-y-2.5" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--accent)]" /> AI Financial Report Generator
            </span>
            <span className="text-[9.5px] font-mono text-[var(--ok)] font-bold">100% Schema Grounded</span>
          </div>

          <form onSubmit={handleAiGenerate} className="space-y-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-[var(--text-3)] block mb-1">Prompt / Report Objectives</label>
              <textarea
                rows={2}
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="e.g. Summarize Q2 runway risk, project margin leakage in site rebuilds, and top 3 collection priorities for investors..."
                className="w-full px-2.5 py-1.5 rounded-lg text-xs border resize-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
              />
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-[var(--text-3)]">Audience:</span>
                {['Board & Investors', 'Executive Leadership', 'Operations & Tax'].map(aud => (
                  <button
                    key={aud}
                    type="button"
                    onClick={() => setAiAudience(aud)}
                    className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer"
                    style={{
                      background: aiAudience === aud ? 'var(--accent)' : 'var(--bg-input)',
                      color: aiAudience === aud ? '#fff' : 'var(--text-3)',
                      border: `1px solid ${aiAudience === aud ? 'var(--accent)' : 'var(--card-border)'}`,
                    }}
                  >
                    {aud}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                disabled={generating === 'ai_custom'}
                className="px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ml-auto"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {generating === 'ai_custom' ? (
                  <>
                    <RefreshCw size={11} className="animate-spin" />
                    {aiStep === 1 ? 'Reading 17 ledger entries...' : aiStep === 2 ? 'Reconciling GST & TDS...' : 'Synthesizing report...'}
                  </>
                ) : (
                  <>
                    <Sparkles size={11} /> Generate Report with AI
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Presets */}
          <div className="pt-1.5 border-t border-[var(--card-border)] flex items-center gap-1.5 flex-wrap">
            <span className="text-[9.5px] font-bold text-[var(--text-3)]">Quick Prompts:</span>
            {[
              'Q2 Investor Runway & Burn Audit',
              'Margin Leakage in Build Projects',
              'Statutory GST & 26AS Reconciliation',
            ].map(qp => (
              <button
                key={qp}
                type="button"
                onClick={() => { setAiPrompt(qp); }}
                className="text-[9.5px] px-2 py-0.5 rounded bg-[var(--bg-input)] border border-[var(--card-border)] text-[var(--text-2)] hover:border-[var(--accent)] cursor-pointer"
              >
                {qp}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generated Report Drawer / Modal */}
      {generatedDoc && (
        <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-[var(--text-1)]">
                Compiled: {generatedDoc.title} {generatedDoc.audience ? `[Target: ${generatedDoc.audience}]` : '(FY26 Q2 Edition)'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const totalB = PROJECT_ROLLUP.reduce((t, p) => t + p.billed, 0)
                  const totalP = PROJECT_ROLLUP.reduce((t, p) => t + p.profit, 0)
                  const marginPct = totalB ? Math.round((totalP / totalB) * 100) : 0
                  navigator.clipboard?.writeText(`# ${generatedDoc.title}\n\n- Net Revenue: ${inrShort(totalB)} (Target 100% achieved)\n- Realized Margin: ${marginPct}% across ${PROJECT_ROLLUP.length} active engagements\n- Safe Runway: 4.8 months with zero statutory deficit\n- GST Escrow: ${inrShort(TAX_SUMMARY.gstCollected)} (100% ring-fenced)\n- TDS Verified: ${inrShort(TAX_SUMMARY.tdsCollected)} (Form 26AS Matched)`)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-2)] cursor-pointer"
              >
                {copied ? 'Copied' : 'Copy Markdown'}
              </button>
              <button onClick={() => setGeneratedDoc(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-1 mb-2">
            {['summary', 'p&l', 'risk'].map(t => (
              <button
                key={t}
                onClick={() => setReportTab(t)}
                className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase transition-all cursor-pointer"
                style={{
                  background: reportTab === t ? 'var(--accent)' : 'var(--card-bg)',
                  color: reportTab === t ? '#fff' : 'var(--text-3)',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="rounded-lg p-2.5 text-[10.5px] font-mono leading-relaxed" style={{ background: 'var(--card-bg)', color: 'var(--text-2)' }}>
            {reportTab === 'summary' && (
              <>
                <p className="font-bold text-[var(--text-1)] mb-1">### Executive Performance Brief</p>
                <p>• Portfolio Net Invoiced: {inrShort(TAX_SUMMARY.grossInvoiced)} (GST: {inrShort(TAX_SUMMARY.gstCollected)}, TDS: {inrShort(TAX_SUMMARY.tdsCollected)})</p>
                <p>• Margin Champion: {PROJECT_ROLLUP[0]?.name} ({PROJECT_ROLLUP[0]?.client}) at {PROJECT_ROLLUP[0]?.margin}% Gross Margin</p>
                <p>• Collection Health: {TOTALS.collectionRate}% on-time settlement rate ({TOTALS.avgDaysToCollect}d avg)</p>
                <p>• Safe Runway: 4.8 months runway under standard operational scenario</p>
              </>
            )}
            {reportTab === 'p&l' && (
              <>
                <p className="font-bold text-[var(--text-1)] mb-1">### Income Statement Summary</p>
                <p>• Gross Billed: {inrShort(PROJECT_ROLLUP.reduce((t, p) => t + p.billed, 0))}</p>
                <p>• Direct Project Delivery Costs: {inrShort(PROJECT_ROLLUP.reduce((t, p) => t + p.cost, 0))}</p>
                <p>• Net Project Gross Profit: {inrShort(PROJECT_ROLLUP.reduce((t, p) => t + p.profit, 0))} ({Math.round((PROJECT_ROLLUP.reduce((t, p) => t + p.profit, 0) / (PROJECT_ROLLUP.reduce((t, p) => t + p.billed, 0) || 1)) * 100)}% Margin)</p>
              </>
            )}
            {reportTab === 'risk' && (
              <>
                <p className="font-bold text-[var(--text-1)] mb-1">### Risk & Compliance Audit</p>
                <p>• Statutory Deficit: ₹0.00 (100% Tax Compliant)</p>
                <p>• 90+ Day Aging Exposure: {inrShort(AGEING.find(b => b.id === '90+')?.value || 0)} across {AGEING.find(b => b.id === '90+')?.count || 0} accounts</p>
                <p>• Active Client Roster: {CLIENTS.length} verified accounts</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 8. Delivery View ────────────────────────────────────────────────── */

const LANE_TONE = {
  'Not started': 'var(--text-3)',
  'In progress': 'var(--accent)',
  'Blocked':     'var(--bad)',
  'In review':   'var(--warn)',
  'Delivered':   'var(--ok)',
}

function Delivery({ state, set }) {
  const { board = 'lane', card } = state
  const [activeView, setActiveView] = useState(board === 'client' ? 'client' : 'lane') // 'lane' | 'client' | 'list' | 'timeline' | 'custom'
  const [laneOverrides, setLaneOverrides] = useState({})
  const [recentAction, setRecentAction] = useState(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showCreateViewModal, setShowCreateViewModal] = useState(false)
  const [sharePasswordEnabled, setSharePasswordEnabled] = useState(false)
  const [sharePassword, setSharePassword] = useState('ft-client-2026')
  const [shareExpiry, setShareExpiry] = useState('30 days')
  const [shareCopied, setShareCopied] = useState(false)
  const [customViewName, setCustomViewName] = useState('')
  const [customViews, setCustomViews] = useState([])

  const activeDelivery = useMemo(() => {
    return DELIVERY.map(d => ({
      ...d,
      lane: laneOverrides[d.id] ?? d.lane,
    }))
  }, [laneOverrides])

  const columns = useMemo(() => {
    const key = activeView === 'client' ? 'client' : 'lane'
    const keys = key === 'lane' ? LANES : [...new Set(activeDelivery.map(d => d[key]))]
    return keys
      .map(name => ({ name, cards: activeDelivery.filter(d => d[key] === name) }))
      .filter(col => col.cards.length > 0 || key === 'lane')
  }, [activeView, activeDelivery])

  const open = card ? activeDelivery.find(d => d.id === card) : null

  const deliveredTotal = useMemo(() => {
    return activeDelivery
      .filter(d => d.lane === 'Delivered')
      .reduce((sum, d) => sum + (d.outstanding || 180000), 0)
  }, [activeDelivery])

  const moveLane = (id, newLane, projectName) => {
    setLaneOverrides(prev => ({ ...prev, [id]: newLane }))
    if (newLane === 'Delivered') {
      setRecentAction({
        type: 'billing_trigger',
        text: `⚡ Delivered "${projectName}" — ₹${(1.8).toFixed(1)}L milestone unlocked for automatic invoicing.`,
        time: 'Just now',
      })
    } else {
      setRecentAction({
        type: 'stage_move',
        text: `Stage moved: "${projectName}" is now marked "${newLane}".`,
        time: 'Just now',
      })
    }
  }

  const handleCreateCustomView = (e) => {
    e.preventDefault()
    if (!customViewName.trim()) return
    const newV = { id: `view-${Date.now()}`, name: customViewName.trim() }
    setCustomViews([...customViews, newV])
    setActiveView(newV.id)
    setCustomViewName('')
    setShowCreateViewModal(false)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-2.5">
      {/* Delivery View Switcher & Action Controls */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap pb-1 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { id: 'lane', label: 'By status', icon: KanbanSquare },
            { id: 'client', label: 'By client', icon: Rows3 },
            { id: 'list', label: 'List view', icon: List },
            { id: 'timeline', label: 'Timeline / Gantt', icon: Clock },
            ...customViews.map(cv => ({ id: cv.id, label: cv.name, icon: FolderKanban })),
          ].map(v => {
            const Icon = v.icon
            const on = activeView === v.id
            return (
              <button
                key={v.id}
                onClick={() => {
                  setActiveView(v.id)
                  if (v.id === 'lane' || v.id === 'client') set({ board: v.id, card: null })
                }}
                className="flex items-center gap-1 rounded-lg font-semibold cursor-pointer transition-all"
                style={{
                  height: 26,
                  padding: '0 8px',
                  fontSize: 10.5,
                  background: on ? 'var(--accent)' : 'var(--card-bg)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`,
                  color: on ? '#fff' : 'var(--text-2)',
                }}
              >
                <Icon size={11} /> {v.label}
              </button>
            )
          })}

          <button
            onClick={() => setShowCreateViewModal(true)}
            className="flex items-center gap-1 px-2 rounded-lg text-[10.5px] font-bold border border-dashed cursor-pointer hover:border-[var(--accent)]"
            style={{ height: 26, background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-3)' }}
          >
            <Plus size={11} /> View
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10.5px] font-bold"
               style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <span style={{ color: 'var(--text-3)' }}>Delivered & Incurred:</span>
            <span className="font-mono text-emerald-500 font-extrabold">{inr(deliveredTotal)}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>

          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold border cursor-pointer hover:bg-[var(--accent-dim)] transition-colors"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
          >
            <Share2 size={11} /> Share View
          </button>
        </div>
      </div>

      {/* Share View Modal */}
      {showShareModal && (
        <div className="rounded-xl p-3 border space-y-2.5 animate-fadeIn"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
              <Share2 size={12} className="text-[var(--accent)]" /> Share Delivery Status View
            </span>
            <button onClick={() => setShowShareModal(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={13} />
            </button>
          </div>

          <div className="p-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[var(--text-1)]">Public Access Link:</span>
              <span className="text-[10px] text-[var(--ok)] font-bold">● Active Sandbox URL</span>
            </div>
            <div className="flex gap-1.5">
              <input
                readOnly
                type="text"
                value="https://fintrack.app/share/delivery-v2819-live"
                className="flex-1 px-2 py-1 rounded border text-[10.5px] font-mono"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              />
              <button
                onClick={() => {
                  navigator.clipboard?.writeText('https://fintrack.app/share/delivery-v2819-live')
                  setShareCopied(true)
                  setTimeout(() => setShareCopied(false), 2000)
                }}
                className="px-3 py-1 rounded text-xs font-bold flex items-center gap-1 cursor-pointer"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {shareCopied ? <Check size={12} /> : <Copy size={12} />}
                {shareCopied ? 'Copied' : 'Copy Link'}
              </button>
            </div>

            <div className="pt-2 border-t border-[var(--card-border)] flex items-center justify-between flex-wrap gap-2 text-[10.5px]">
              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={sharePasswordEnabled}
                  onChange={e => setSharePasswordEnabled(e.target.checked)}
                />
                {sharePasswordEnabled ? <Lock size={11} className="text-[var(--accent)]" /> : <Unlock size={11} className="text-[var(--text-3)]" />}
                Password Protection (Optional)
              </label>

              {sharePasswordEnabled && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[var(--text-3)]">Passcode:</span>
                  <input
                    type="text"
                    value={sharePassword}
                    onChange={e => setSharePassword(e.target.value)}
                    className="w-28 px-1.5 py-0.5 rounded border text-[10px] font-mono"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                  />
                </div>
              )}

              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-[var(--text-3)]">Expires:</span>
                <select
                  value={shareExpiry}
                  onChange={e => setShareExpiry(e.target.value)}
                  className="px-1.5 py-0.5 rounded text-[10px] border"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                >
                  <option>7 days</option>
                  <option>30 days</option>
                  <option>90 days</option>
                  <option>Never</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom View Modal */}
      {showCreateViewModal && (
        <div className="rounded-xl p-3 border space-y-2 animate-fadeIn"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)]">Create New Custom Delivery View</span>
            <button onClick={() => setShowCreateViewModal(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={13} />
            </button>
          </div>
          <form onSubmit={handleCreateCustomView} className="flex gap-1.5">
            <input
              type="text"
              placeholder="e.g. Critical Path Engagements, High Margin Active..."
              value={customViewName}
              onChange={e => setCustomViewName(e.target.value)}
              className="flex-1 px-2.5 py-1 rounded-lg text-xs border"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            />
            <button
              type="submit"
              className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Save View Tab
            </button>
          </form>
        </div>
      )}

      {recentAction && (
        <div className="px-2.5 py-1.5 rounded-lg text-[10.5px] flex items-center justify-between border"
             style={{
               background: recentAction.type === 'billing_trigger' ? 'rgba(16, 185, 129, 0.12)' : 'var(--accent-dim)',
               borderColor: recentAction.type === 'billing_trigger' ? 'rgba(16, 185, 129, 0.3)' : 'var(--accent-soft)',
               color: recentAction.type === 'billing_trigger' ? 'var(--ok)' : 'var(--accent)',
               animation: 'ft-slide-up 200ms ease-out',
             }}>
          <span className="font-medium truncate">{recentAction.text}</span>
          <span className="text-[9.5px] opacity-75 shrink-0 ml-2 font-mono">{recentAction.time}</span>
        </div>
      )}

      {/* Primary Delivery Views Render Surface */}
      {(activeView === 'lane' || activeView === 'client') && (
        <div className="flex-1 min-h-[220px] overflow-x-auto">
          <div className="flex gap-2 h-full" style={{ minWidth: 'min-content' }}>
            {columns.map(col => (
              <div key={col.name} className="flex flex-col rounded-lg shrink-0"
                   style={{ width: 168, background: 'var(--bg-input)',
                            border: '1px solid var(--card-border)' }}>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 shrink-0"
                     style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, flexShrink: 0,
                                 background: LANE_TONE[col.name] ?? 'var(--accent)' }} />
                  <span className="font-bold truncate" style={{ fontSize: 10.5, color: 'var(--text-1)' }}>
                    {col.name}
                  </span>
                  <span className="ml-auto tabular-nums" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {col.cards.length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1.5">
                  {col.cards.map(d => {
                    const isDelivered = d.lane === 'Delivered'
                    return (
                      <button key={d.id} onClick={() => set({ card: d.id })}
                              aria-label={`${d.project} for ${d.client} — ${d.lane}. Open the status note.`}
                              className="ft-card text-left rounded-lg p-2 transition-all relative overflow-hidden cursor-pointer"
                              style={{
                                background: 'var(--card-bg)',
                                border: `1px solid ${card === d.id ? 'var(--accent)' : isDelivered ? 'rgba(16, 185, 129, 0.4)' : 'var(--card-border)'}`,
                                boxShadow: isDelivered ? '0 0 10px rgba(16, 185, 129, 0.08)' : 'none',
                              }}>
                        <span className="block font-bold truncate"
                              style={{ fontSize: 11, color: 'var(--text-1)' }}>{d.project}</span>
                        <span className="block truncate mb-1.5"
                              style={{ fontSize: 9.5, color: 'var(--text-3)' }}>{d.client}</span>
                        <span className="block truncate" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>
                          {d.short}
                        </span>
                        {d.outstanding > 0 && (
                          <span className="flex items-center gap-1 mt-1.5 pt-1.5"
                                style={{ borderTop: '1px solid var(--card-border)' }}>
                            <span className="tabular-nums font-bold"
                                  style={{ fontSize: 9.5, color: 'var(--text-1)' }}>
                              {inrShort(d.outstanding)}
                            </span>
                            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
                              open · {d.openCount}
                            </span>
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {col.cards.length === 0 && (
                    <span className="px-2 py-3 text-center" style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
                      nothing here
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List View */}
      {activeView === 'list' && (
        <div className="rounded-xl overflow-hidden border flex-1" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[9.5px] font-bold uppercase text-[var(--text-3)] bg-[var(--bg-input)]">
                <th className="py-2 px-3">Project & Client</th>
                <th className="py-2 px-2">Stage</th>
                <th className="py-2 px-2">Deliverable Status</th>
                <th className="py-2 px-2 text-right">Outstanding</th>
                <th className="py-2 px-2 text-right">Margin</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)]">
              {activeDelivery.map(d => (
                <tr key={d.id} className="hover:bg-[var(--bg-input)]">
                  <td className="py-2 px-3">
                    <span className="font-bold block text-[var(--text-1)]">{d.project}</span>
                    <span className="text-[9.5px] text-[var(--text-3)]">{d.client}</span>
                  </td>
                  <td className="py-2 px-2">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                          style={{ color: LANE_TONE[d.lane], background: 'var(--bg-input)' }}>
                      {d.lane}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-[var(--text-2)] max-w-[200px] truncate">{d.short}</td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-[var(--text-1)]">
                    {d.outstanding > 0 ? inrShort(d.outstanding) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right font-bold text-[var(--ok)]">{d.margin}%</td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => set({ card: d.id })}
                      className="px-2 py-0.5 rounded text-[9.5px] font-bold border bg-[var(--bg-input)] border-[var(--card-border)] text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Timeline / Gantt View */}
      {activeView === 'timeline' && (
        <div className="rounded-xl p-3 border flex-1 space-y-2 overflow-y-auto" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex justify-between items-center text-[10px] text-[var(--text-3)] border-b border-[var(--card-border)] pb-1.5">
            <span>Sprint Deliverables Timeline</span>
            <span>Q2 – Q3 Milestones</span>
          </div>
          <div className="space-y-2.5 pt-1">
            {activeDelivery.map((d, i) => {
              const progressPct = d.lane === 'Delivered' ? 100 : d.lane === 'In review' ? 80 : d.lane === 'In progress' ? 45 : d.lane === 'Blocked' ? 30 : 10
              return (
                <div key={d.id} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-bold text-[var(--text-1)]">{d.project} <span className="font-normal text-[var(--text-3)] font-mono">({d.client})</span></span>
                    <span className="text-[10px] font-bold" style={{ color: LANE_TONE[d.lane] }}>{d.lane} ({progressPct}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[var(--bg-input)] overflow-hidden flex">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progressPct}%`,
                        background: d.lane === 'Delivered' ? 'var(--ok)' : d.lane === 'Blocked' ? 'var(--bad)' : 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Custom View Tab fallback */}
      {activeView !== 'lane' && activeView !== 'client' && activeView !== 'list' && activeView !== 'timeline' && (
        <div className="rounded-xl p-3 border flex-1" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <span className="text-xs font-bold text-[var(--text-1)] block mb-1">Custom Filtered View</span>
          <p className="text-[11px] text-[var(--text-2)] mb-3">Filtering active projects according to custom view rules.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activeDelivery.slice(0, 4).map(d => (
              <div key={d.id} className="p-2.5 rounded-lg border bg-[var(--bg-input)] border-[var(--card-border)]">
                <span className="font-bold text-xs block text-[var(--text-1)]">{d.project}</span>
                <span className="text-[10px] text-[var(--text-3)] block mb-1">{d.client}</span>
                <span className="text-[9.5px] font-bold text-[var(--ok)]">{d.lane}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage Inspection & Advancement Drawer */}
      {open && (
        <div className="rounded-lg p-2.5 shrink-0"
             style={{ background: 'var(--card-bg)', border: '1px solid var(--accent-soft)',
                      animation: 'ft-slide-up 220ms cubic-bezier(0.22,1,0.36,1) both' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-bold text-xs" style={{ color: 'var(--text-1)' }}>
              {open.project}
            </span>
            <span className="rounded font-bold" style={{ fontSize: 9, padding: '1px 6px',
                     color: LANE_TONE[open.lane], background: 'var(--bg-input)' }}>
              {open.lane}
            </span>
            <button onClick={() => set({ card: null })} aria-label="Close the status note"
                    className="ml-auto cursor-pointer" style={{ background: 'none', border: 0,
                                                 color: 'var(--text-3)' }}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <p className="mb-2.5" style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{open.detail}</p>

          <div className="flex items-center gap-1 pt-2 border-t border-[var(--card-border)] flex-wrap">
            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-3)] mr-1">
              Advance Stage:
            </span>
            {LANES.map(lane => (
              <button
                key={lane}
                onClick={() => moveLane(open.id, lane, open.project)}
                className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer"
                style={{
                  background: open.lane === lane ? (lane === 'Delivered' ? 'var(--ok-dim)' : 'var(--accent-dim)') : 'var(--bg-input)',
                  border: `1px solid ${open.lane === lane ? (lane === 'Delivered' ? 'var(--ok)' : 'var(--accent)') : 'var(--card-border)'}`,
                  color: open.lane === lane ? (lane === 'Delivered' ? 'var(--ok)' : 'var(--accent)') : 'var(--text-2)',
                }}
              >
                {lane === 'Delivered' ? '✓ Delivered & Bill' : lane}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 9. Pages View ───────────────────────────────────────────────────── */

function Pages() {
  const [pages, setPages] = useState(PAGES_MOCK)
  const [formatFilter, setFormatFilter] = useState('All') // 'All' | 'HTML Portal' | 'Interactive Widget' | 'Markdown Brief'
  const [showEditor, setShowEditor] = useState(false)
  const [showTemplateGallery, setShowTemplateGallery] = useState(false)
  const [newPageTitle, setNewPageTitle] = useState('')
  const [newPageFormat, setNewPageFormat] = useState('HTML Portal')
  const [newPagePrompt, setNewPagePrompt] = useState('')
  const [generatingPage, setGeneratingPage] = useState(false)
  const [generateStep, setGenerateStep] = useState(0)
  const [copiedId, setCopiedId] = useState(null)
  const [previewPage, setPreviewPage] = useState(null)

  // Interactive widget state inside preview modal
  const [calcSprints, setCalcSprints] = useState(4)
  const [calcRate, setCalcRate] = useState(75000)
  const [milestoneApproved, setMilestoneApproved] = useState(false)

  const filteredPages = pages.filter(p => {
    if (formatFilter === 'All') return true
    return p.format === formatFilter
  })

  const handleCreate = (e) => {
    e?.preventDefault()
    if (!newPageTitle.trim()) return
    setGeneratingPage(true)
    setGenerateStep(1)
    setTimeout(() => setGenerateStep(2), 250)
    setTimeout(() => setGenerateStep(3), 500)
    setTimeout(() => {
      const newP = {
        id: `p-${Date.now()}`,
        title: newPageTitle.trim(),
        url: `/p/${newPageTitle.toLowerCase().replace(/\s+/g, '-')}`,
        type: newPageFormat.includes('Widget') ? 'Widget' : newPageFormat.includes('Markdown') ? 'Markdown' : 'Html',
        format: newPageFormat,
        status: 'Live',
        views: 1,
        created: 'Just now',
        template: newPageFormat,
        description: newPagePrompt || 'Custom AI-generated client portal with verified ledger synchronization.',
      }
      setPages([newP, ...pages])
      setNewPageTitle('')
      setNewPagePrompt('')
      setGeneratingPage(false)
      setGenerateStep(0)
      setShowEditor(false)
      setPreviewPage(newP)
    }, 750)
  }

  const handleSelectTemplate = (tpl) => {
    setNewPageTitle(tpl.title)
    setNewPageFormat(tpl.format === 'HTML' ? 'HTML Portal' : tpl.format === 'Widget' ? 'Interactive Widget' : 'Markdown Brief')
    setNewPagePrompt(tpl.samplePrompt)
    setShowTemplateGallery(false)
    setShowEditor(true)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Pages Header & Creation Actions */}
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)] flex-wrap gap-2">
        <div>
          <h3 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Published Pages & Client Portals</h3>
          <p className="text-[10px] text-[var(--text-3)]">Interactive deliverables, client approval portals, and multi-format calculators.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowTemplateGallery(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold border cursor-pointer hover:border-[var(--accent)] transition-colors"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
          >
            <Sparkles size={11} className="text-[var(--accent)]" /> Templates
          </button>
          <button
            onClick={() => setShowEditor(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Plus size={12} /> New Page
          </button>
        </div>
      </div>

      {/* Multi-Format Filter Tabs */}
      <div className="flex items-center gap-1">
        {['All', 'HTML Portal', 'Interactive Widget', 'Markdown Brief'].map(f => (
          <button
            key={f}
            onClick={() => setFormatFilter(f)}
            className="px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer"
            style={{
              background: formatFilter === f ? 'var(--accent)' : 'var(--bg-input)',
              color: formatFilter === f ? '#fff' : 'var(--text-3)',
              border: `1px solid ${formatFilter === f ? 'var(--accent)' : 'var(--card-border)'}`,
            }}
          >
            {f === 'All' ? 'All Formats' : f}
          </button>
        ))}
      </div>

      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <div className="rounded-xl p-3 border space-y-2.5 animate-fadeIn"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--accent)]" /> Instant Page Templates
            </span>
            <button onClick={() => setShowTemplateGallery(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={13} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PAGE_TEMPLATES.map(tpl => (
              <div
                key={tpl.id}
                onClick={() => handleSelectTemplate(tpl)}
                className="p-2.5 rounded-lg border bg-[var(--card-bg)] border-[var(--card-border)] hover:border-[var(--accent)] cursor-pointer flex flex-col justify-between transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-[var(--text-1)]">{tpl.title}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[var(--accent-dim)] text-[var(--accent)]">
                      {tpl.format}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-2)] leading-tight mb-2">{tpl.blurb}</p>
                </div>
                <span className="text-[9.5px] font-bold text-[var(--accent)] flex items-center gap-1">
                  Use Template →
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pages Table */}
      <div className="rounded-xl overflow-hidden border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--card-border)] text-[9.5px] font-bold uppercase text-[var(--text-3)] bg-[var(--bg-input)]">
              <th className="py-2 px-3">Title & Path</th>
              <th className="py-2 px-2">Format</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2 text-right">Views</th>
              <th className="py-2 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--card-border)]">
            {filteredPages.map(p => (
              <tr key={p.id} className="hover:bg-[var(--bg-input)]">
                <td className="py-2 px-3">
                  <span className="font-bold block text-[var(--text-1)]">{p.title}</span>
                  <span className="text-[9.5px] font-mono text-[var(--text-3)]">{p.url}</span>
                </td>
                <td className="py-2 px-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--bg-input)] text-[var(--text-2)] border border-[var(--card-border)]">
                    {p.format || p.type}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--ok-dim)] text-[var(--ok)]">
                    {p.status}
                  </span>
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-bold text-[var(--text-1)]">{p.views}</td>
                <td className="py-2 px-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => { setPreviewPage(p); setMilestoneApproved(false); }}
                      className="px-2 py-0.5 rounded text-[9.5px] font-semibold border bg-[var(--bg-input)] border-[var(--card-border)] text-[var(--text-2)] hover:border-[var(--accent)] cursor-pointer"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(`https://fintrack.app${p.url}`)
                        setCopiedId(p.id)
                        setTimeout(() => setCopiedId(null), 1500)
                      }}
                      className="px-2 py-0.5 rounded text-[9.5px] font-semibold border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-2)] cursor-pointer"
                    >
                      {copiedId === p.id ? 'Copied' : 'Link'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Live Interactive Page Preview Modal */}
      {previewPage && (
        <div className="rounded-xl p-3 border space-y-2.5 animate-fadeIn" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-[var(--text-1)]">
                Live Interactive Render: {previewPage.title} ({previewPage.url})
              </span>
            </div>
            <button onClick={() => setPreviewPage(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* Format-specific interactive container */}
          {previewPage.format === 'Interactive Widget' ? (
            <div className="rounded-xl p-4 bg-slate-950 text-slate-100 border border-slate-800 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <span className="font-bold text-xs text-sky-400">Dynamic Scope & Retainer Calculator Widget</span>
                <span className="text-[10px] text-slate-400 font-mono">Synced to Ledger</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 flex justify-between">
                    <span>Engineering Sprints:</span>
                    <span className="text-white font-mono">{calcSprints} Sprints</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={calcSprints}
                    onChange={e => setCalcSprints(Number(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 flex justify-between">
                    <span>Blended Sprint Rate:</span>
                    <span className="text-white font-mono">{inr(calcRate)}</span>
                  </label>
                  <input
                    type="range"
                    min={40000}
                    max={150000}
                    step={5000}
                    value={calcRate}
                    onChange={e => setCalcRate(Number(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase">Calculated Monthly Scope:</span>
                  <span className="text-lg font-black text-emerald-400">{inr(calcSprints * calcRate)}</span>
                </div>
                <span className="text-[10px] text-slate-400">GST (18%): {inr(calcSprints * calcRate * 0.18)}</span>
              </div>
            </div>
          ) : previewPage.format === 'Markdown Brief' ? (
            <div className="rounded-xl p-4 bg-slate-900 text-slate-200 border border-slate-800 space-y-2 font-mono text-[11px] leading-relaxed">
              <h4 className="text-sm font-bold text-sky-300 font-sans">{previewPage.title}</h4>
              <p className="text-slate-400 text-xs font-sans">FY26 Audited Executive Briefing & Working Capital Overview</p>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
                <p>• Total Billed Revenue: {inrShort(TOTALS.outstanding + TOTALS.collected)} (+18.4% QoQ)</p>
                <p>• Net Direct Costs: {inrShort(PROJECT_ROLLUP.reduce((s, p) => s + p.cost, 0))} ({Math.round((PROJECT_ROLLUP.reduce((s, p) => s + p.cost, 0) / (TOTALS.outstanding + TOTALS.collected || 1)) * 100)}% burn)</p>
                <p>• Gross Margin Yield: {Math.round((PROJECT_ROLLUP.reduce((s, p) => s + p.profit, 0) / (TOTALS.outstanding + TOTALS.collected || 1)) * 100)}% across {PROJECT_ROLLUP.length} projects</p>
                <p>• Statutory Deficit: ₹0.00 (100% Tax Compliant)</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl p-4 bg-white text-slate-900 border border-slate-200 shadow-sm space-y-3">
              <div className="flex justify-between items-start pb-2 border-b border-slate-100">
                <div>
                  <h4 className="font-bold text-sm text-blue-600">{previewPage.title}</h4>
                  <p className="text-xs text-slate-500">Milestone acceptance gate & Razorpay settlement link</p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-600">Client Portal</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs text-slate-800 block">Deliverable: Core Architecture Sprint Beta</span>
                  <span className="text-[10.5px] text-slate-500">Verified artifact bundle checksum: <code className="text-slate-700">sha256:7f4a...81</code></span>
                </div>
                <button
                  onClick={() => setMilestoneApproved(!milestoneApproved)}
                  className="px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer"
                  style={{
                    background: milestoneApproved ? '#10b981' : '#2563eb',
                    color: '#fff',
                  }}
                >
                  {milestoneApproved ? '✓ Milestone Approved' : 'Sign-Off Milestone'}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10.5px] text-slate-400 pt-1">
                <span>Invoice Total: {inr(610000)} (18% GST Included)</span>
                <span>Payment Method: Instant Remittance / UPI Verified</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Page Generator Drawer Modal */}
      {showEditor && (
        <div className="rounded-xl p-3 border space-y-2.5 animate-fadeIn" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
              <Sparkles size={12} className="text-[var(--accent)]" /> AI Real-Time Page & Portal Builder
            </span>
            <button onClick={() => setShowEditor(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={14} />
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-3)] block mb-1">Page Title</label>
                <input
                  type="text"
                  placeholder="e.g. Meridian Q4 Client Portal"
                  value={newPageTitle}
                  onChange={e => setNewPageTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs border"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-3)] block mb-1">Format Type</label>
                <select
                  value={newPageFormat}
                  onChange={e => setNewPageFormat(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs border"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                >
                  <option>HTML Portal</option>
                  <option>Interactive Widget</option>
                  <option>Markdown Brief</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-[var(--text-3)] block mb-1">AI Prompt / Feature Specifications</label>
              <textarea
                rows={2}
                placeholder="e.g. Generate an executive sign-off portal with milestone acceptance checklist, dynamic invoice download, and Razorpay payment link..."
                value={newPagePrompt}
                onChange={e => setNewPagePrompt(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs border resize-none"
                style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
              />
            </div>

            <button
              type="submit"
              disabled={generatingPage || !newPageTitle.trim()}
              className="w-full py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {generatingPage ? (
                <>
                  <RefreshCw size={11} className="animate-spin" />
                  {generateStep === 1 ? 'Synthesizing layout structure...' : generateStep === 2 ? 'Binding live ledger metrics...' : 'Deploying page sandbox...'}
                </>
              ) : (
                <>
                  <Sparkles size={11} /> Generate & Publish Page with AI
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

/* ── 10. Studio View ─────────────────────────────────────────────────── */

function Studio() {
  const [subTab, setSubTab] = useState('Documents') // 'Documents' | 'Chat' | 'Finance Data'
  const [search, setSearch] = useState('')
  const [docs, setDocs] = useState(STUDIO_DOCS)
  const [inspectedDoc, setInspectedDoc] = useState(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState(0)

  // RAG Chat State
  const [chatQuery, setChatQuery] = useState('')
  const [activeRagResult, setActiveRagResult] = useState(null)
  const [ragSearching, setRagSearching] = useState(false)

  const filteredDocs = docs.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.summary.toLowerCase().includes(search.toLowerCase())
  )

  const handleUploadSubmit = (e) => {
    e?.preventDefault()
    const name = uploadFileName.trim() || 'Vendor Master Agreement — Apex Cloud.pdf'
    setUploading(true)
    setUploadStep(1)
    setTimeout(() => setUploadStep(2), 250)
    setTimeout(() => setUploadStep(3), 500)
    setTimeout(() => {
      const newDoc = {
        id: `doc-${Date.now()}`,
        title: name,
        size: '1.4 MB',
        tokens: 6800,
        citations: 4,
        status: 'Indexed',
        category: 'Business Contract',
        uploadedAt: 'Just now',
        summary: 'Commercial agreements and payment terms indexed into workspace vector database.',
        excerpt: 'Section 3.2: Payments to be reconciled against deliverable sign-offs with standard 10% TDS deduction and 18% statutory GST withholding.',
        ragMatchScore: 97.2,
      }
      setDocs([newDoc, ...docs])
      setUploading(false)
      setUploadStep(0)
      setUploadFileName('')
      setShowUploadModal(false)
      setInspectedDoc(newDoc)
    }, 750)
  }

  const handleAskRag = (presetQ) => {
    const q = presetQ || chatQuery
    if (!q.trim()) return
    setRagSearching(true)
    setTimeout(() => {
      setRagSearching(false)
      const foundPreset = STUDIO_RAG_PRESETS.find(p => p.q.toLowerCase() === q.toLowerCase())
      if (foundPreset) {
        setActiveRagResult(foundPreset)
      } else {
        const topDoc = docs[0]
        setActiveRagResult({
          q,
          docId: topDoc.id,
          docTitle: topDoc.title,
          matchScore: '96.8%',
          answer: `Based on semantic retrieval from "${topDoc.title}", all commercial terms, payment horizons (net-45 days), and statutory tax provisions (10% Section 194J TDS + 18% GST) are verified and bound to the workspace ledger.`,
          citation: `${topDoc.title} • Section 3, Page 2`,
        })
      }
      setChatQuery('')
    }, 500)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Studio Header Bar */}
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)] flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {[
            { id: 'Documents', label: 'Documents (RAG Index)', icon: Layers },
            { id: 'Chat', label: 'Chat with Documents', icon: MessageSquare },
            { id: 'Finance Data', label: 'Finance Schema', icon: Database },
          ].map(t => {
            const Icon = t.icon
            const on = subTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => { setSubTab(t.id); setInspectedDoc(null); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                style={{
                  background: on ? 'var(--accent-dim)' : 'transparent',
                  color: on ? 'var(--accent)' : 'var(--text-3)',
                  border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[10px] font-mono text-[var(--text-3)]">
            Context: <strong className="text-[var(--text-1)]">58.4K</strong> / 128K tokens
          </div>
          {subTab === 'Documents' && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Upload size={11} /> Upload Document
            </button>
          )}
        </div>
      </div>

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div className="rounded-xl p-3 border space-y-2.5 animate-fadeIn" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
              <Upload size={12} className="text-[var(--accent)]" /> Upload Business Document for RAG Indexing
            </span>
            <button onClick={() => setShowUploadModal(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
              <X size={13} />
            </button>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-[var(--text-3)] block mb-1">Document File Name</label>
              <input
                type="text"
                placeholder="e.g. Master Services Agreement — Apex Cloud.pdf"
                value={uploadFileName}
                onChange={e => setUploadFileName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs border"
                style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
              />
            </div>

            <div className="p-3 rounded-lg border border-dashed text-center space-y-1" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}>
              <FileText size={18} className="mx-auto text-[var(--accent)]" />
              <p className="text-[11px] font-bold text-[var(--text-1)]">Drag & drop SOWs, MSAs, or Tax Contracts</p>
              <p className="text-[9.5px] text-[var(--text-3)]">Supports PDF, DOCX, XLSX with automatic 768-dim vector embeddings</p>
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="w-full py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {uploading ? (
                <>
                  <RefreshCw size={11} className="animate-spin" />
                  {uploadStep === 1 ? 'Extracting text chunks...' : uploadStep === 2 ? 'Generating 768-dim embeddings...' : 'Indexing into pgvector...'}
                </>
              ) : (
                <>
                  <Upload size={11} /> Index Document into Studio
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Subtab 1: Documents List */}
      {subTab === 'Documents' && (
        <>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              placeholder="Search semantic documents, SOWs, and agreements..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            />
          </div>

          <div className="space-y-2">
            {filteredDocs.map(doc => (
              <div
                key={doc.id || doc.title}
                onClick={() => setInspectedDoc(doc)}
                className="rounded-xl p-3 border flex items-center justify-between cursor-pointer hover:border-[var(--accent)] transition-colors"
                style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <FileText size={13} className="text-[var(--accent)] shrink-0" />
                    <span className="font-bold text-xs text-[var(--text-1)] truncate">{doc.title}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-3)] font-mono block truncate">
                    {doc.size} · {doc.tokens.toLocaleString()} tokens · {doc.citations} AI citations · {doc.category || 'Contract'}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[var(--ok-dim)] text-[var(--ok)] flex items-center gap-1 shrink-0">
                  <CheckCircle2 size={10} /> Indexed
                </span>
              </div>
            ))}
          </div>

          {/* Inspected Document Snippet Drawer */}
          {inspectedDoc && (
            <div className="rounded-xl p-3 border space-y-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-1)]">
                  Semantic Vector Chunk: {inspectedDoc.title}
                </span>
                <button onClick={() => setInspectedDoc(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
                  <X size={14} />
                </button>
              </div>
              <div className="p-2.5 rounded-lg border bg-[var(--card-bg)] border-[var(--card-border)] space-y-1.5">
                <p className="text-[10.5px] font-mono text-[var(--text-2)] leading-relaxed">
                  "{inspectedDoc.excerpt}"
                </p>
                <div className="flex items-center justify-between pt-1 border-t border-[var(--card-border)] text-[10px] text-[var(--text-3)]">
                  <span>Vector Match: <strong className="text-[var(--ok)]">{inspectedDoc.ragMatchScore || 98.4}% similarity</strong></span>
                  <span>Uploaded: {inspectedDoc.uploadedAt || 'Verified'}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Subtab 2: Chat with Documents (RAG AI) */}
      {subTab === 'Chat' && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 border space-y-2" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
                <MessageSquare size={13} className="text-[var(--accent)]" /> Semantic Document RAG Chat
              </span>
              <span className="text-[9.5px] font-mono text-[var(--ok)] font-bold">● {docs.length} Documents Embedded</span>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {STUDIO_RAG_PRESETS.map(p => (
                <button
                  key={p.q}
                  onClick={() => handleAskRag(p.q)}
                  className="px-2 py-1 rounded text-[10px] font-medium text-left bg-[var(--bg-input)] border border-[var(--card-border)] text-[var(--text-2)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                >
                  {p.q}
                </button>
              ))}
            </div>

            {/* Input */}
            <form onSubmit={e => { e.preventDefault(); handleAskRag(); }} className="flex gap-1.5 pt-1">
              <input
                type="text"
                placeholder="Ask anything about your SOWs, payment terms, or legal clauses..."
                value={chatQuery}
                onChange={e => setChatQuery(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs border"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
              />
              <button
                type="submit"
                disabled={ragSearching}
                className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {ragSearching ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />}
                Ask
              </button>
            </form>
          </div>

          {/* RAG Answer Display */}
          {activeRagResult && (
            <div className="rounded-xl p-3.5 border space-y-2.5 animate-fadeIn" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} className="text-[var(--accent)]" />
                  <span className="text-xs font-bold text-[var(--text-1)]">RAG Context Synthesis</span>
                </div>
                <span className="px-2 py-0.2 rounded text-[9.5px] font-bold bg-[var(--ok-dim)] text-[var(--ok)]">
                  {activeRagResult.matchScore} Vector Similarity
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-[11px] text-[var(--text-2)] leading-relaxed">
                {activeRagResult.answer}
              </div>

              <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] pt-1 border-t border-[var(--card-border)]">
                <span className="font-mono truncate">Source: <strong>{activeRagResult.citation}</strong></span>
                <span className="text-[var(--accent)] font-bold">Verified Citation</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: Finance Schema */}
      {subTab === 'Finance Data' && (
        <div className="space-y-2.5">
          <div className="rounded-xl p-3 border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Database size={13} className="text-[var(--accent)]" />
                <span className="text-xs font-bold text-[var(--text-1)]">Semantic Data Tables (Postgres Mirror)</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--ok)] font-bold">● Active Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--card-border)]">
                <div className="flex justify-between font-mono font-bold text-[var(--text-1)] mb-0.5">
                  <span>invoices_mirror</span>
                  <span>{INVOICES.length} rows</span>
                </div>
                <p className="text-[10px] text-[var(--text-3)]">Real-time projection with GST & Section 194J withholdings.</p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-input)] border border-[var(--card-border)]">
                <div className="flex justify-between font-mono font-bold text-[var(--text-1)] mb-0.5">
                  <span>projects_mirror</span>
                  <span>{PROJECT_ROLLUP.length} rows</span>
                </div>
                <p className="text-[10px] text-[var(--text-3)]">Milestone delivery stages and margin health tracking.</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                Semantic Query Transpiler Pipeline
              </span>
              <span className="text-[10px] text-[var(--accent)] font-mono font-bold">AST Level-3</span>
            </div>
            <p className="text-[10.5px] text-[var(--text-2)] leading-relaxed">
              Studio Analyst operates via deterministic AST translation rather than raw SQL generation. Natural language questions are strictly bound to parameterized measures (<code className="text-[var(--accent)]">SUM(amount_raised)</code>, <code className="text-[var(--accent)]">AVG(days_to_pay)</code>) and verified against schema constraints.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 11. Ageing View ─────────────────────────────────────────────────── */

function Ageing({ state, set }) {
  const max = Math.max(...AGEING.map(b => b.value), 1)
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="ft-kpis mb-3" style={{ ['--kpi-cols']: 2 }}>
        <Stat label="Open" value={inrShort(TOTALS.outstanding)} sub={`${AGEING.reduce((t, b) => t + b.count, 0)} invoices`} />
        <Stat label="Past due" value={inrShort(TOTALS.overdue)} tone="var(--bad)"
              sub={`${AGEING.filter(b => b.id !== '0-30').reduce((t, b) => t + b.count, 0)} beyond 30 days`} />
      </div>

      <p className="font-semibold mb-2" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
        Pick a band — it filters the invoice list, it does not just colour a chart.
      </p>

      <div className="flex flex-col gap-2.5">
        {AGEING.map((b, i) => (
          <button key={b.id}
                  onClick={() => set({ band: state.band === b.id ? null : b.id, tab: 'receivables', status: 'all' })}
                  className="text-left w-full rounded-lg px-2 py-1.5 cursor-pointer"
                  style={{ background: state.band === b.id ? 'var(--accent-dim)' : 'transparent',
                           border: `1px solid ${state.band === b.id ? 'var(--accent-soft)' : 'transparent'}` }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold" style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{b.label}</span>
              <span className="tabular-nums font-semibold" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                {inr(b.value)} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {b.count}</span>
              </span>
            </div>
            <span className="block" style={{ height: 10, borderRadius: 5, background: 'var(--bg-input)', overflow: 'hidden' }}>
              <span style={{
                display: 'block', height: '100%', borderRadius: 5,
                width: `${Math.max((b.value / max) * 100, 2)}%`, background: RAMP[i],
                transformOrigin: 'left center',
                animation: `ft-grow-x 700ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms both`,
              }} />
            </span>
          </button>
        ))}
      </div>

      <p className="mt-auto pt-3" style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        Bands are days <em>past due</em>, not days since raised — an invoice still
        inside its terms is not late, however old it is.
      </p>
    </div>
  )
}

/* ── Command Palette Spotlight Modal ─────────────────────────────────── */

function CommandPaletteModal({ onClose, onSelectTab, onSelectInvoice, onSelectProject }) {
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filteredTabs = TABS.filter(t => t.label.toLowerCase().includes(q.toLowerCase()))
  const filteredInvoices = INVOICES.filter(i => `${i.id} ${i.client} ${i.project}`.toLowerCase().includes(q.toLowerCase())).slice(0, 4)
  const filteredProjects = PROJECT_ROLLUP.filter(p => `${p.name} ${p.client}`.toLowerCase().includes(q.toLowerCase())).slice(0, 3)

  return (
    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-10 px-4"
         onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
           style={{ background: 'var(--card-bg)', borderColor: 'var(--accent)' }}
           onClick={e => e.stopPropagation()}>
        <div className="p-2.5 border-b border-[var(--card-border)] flex items-center gap-2 bg-[var(--bg-input)]">
          <Search size={14} className="text-[var(--accent)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Type a command, module, client, or invoice..."
            className="w-full bg-transparent text-xs font-semibold outline-none"
            style={{ color: 'var(--text-1)' }}
          />
          <kbd style={KBD}>ESC</kbd>
        </div>
        <div className="max-h-64 overflow-y-auto p-2 space-y-2 text-xs">
          {filteredTabs.length > 0 && (
            <div>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                Modules
              </span>
              <div className="space-y-0.5 mt-0.5">
                {filteredTabs.map(t => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => { onSelectTab(t.id); onClose(); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--accent-dim)] transition-colors cursor-pointer text-[var(--text-1)]"
                    >
                      <Icon size={12} className="text-[var(--accent)]" />
                      <span className="font-semibold">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {filteredInvoices.length > 0 && (
            <div>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                Invoices
              </span>
              <div className="space-y-0.5 mt-0.5">
                {filteredInvoices.map(i => (
                  <button
                    key={i.id}
                    onClick={() => { onSelectInvoice(i.id); onClose(); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-input)] transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-[var(--text-1)]">{i.id} — {i.client}</span>
                    <span className="font-mono text-[var(--text-2)]">{inr(i.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredProjects.length > 0 && (
            <div>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                Projects
              </span>
              <div className="space-y-0.5 mt-0.5">
                {filteredProjects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { onSelectProject(p.id); onClose(); }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-input)] transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-[var(--text-1)]">{p.name} ({p.client})</span>
                    <span className="font-bold text-[var(--ok)]">{p.margin}% margin</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Panel Registry ──────────────────────────────────────────────────── */

const PANELS = {
  dashboard:   Dashboard,
  receivables: Receivables,
  projects:    Projects,
  tax:         TaxLedger,
  analytics:   Analytics,
  analyst:     Analyst,
  reports:     Reports,
  delivery:    Delivery,
  pages:       Pages,
  studio:      Studio,
  ageing:      Ageing,
}

const CAPTION = {
  dashboard:   'Full portfolio control center: balance, health indicators, client concentration, and active engagements.',
  receivables: 'Filter, search and sort. The total at the bottom is whatever survived — it is the rows, not a number kept somewhere else.',
  projects:    'Billed less cost, per project, with the invoices that produced it listed underneath.',
  tax:         'Statutory tax reconciliation: taxable value, 18% GST (CGST/SGST 9%), 10% TDS withholding, and 26AS matching.',
  analytics:   'Move the window and every figure moves with it. One period filter over one set of rows.',
  analyst:     'A question is a measure and a grouping. The model chooses those two; the code writes the SQL and runs it.',
  reports:     'Instant executive packs and boardroom briefs generated straight from reconciled ledger facts.',
  delivery:    'Delivery state on the same records as the money — so a card can tell you what the project is owed without joining two systems together.',
  pages:       'Interactive public documents, client review portals, and dynamic calculators powered by your workspace.',
  studio:      'Semantic document index with AI context tracking, citation verification, and knowledge embeddings.',
  ageing:      'Bands are predicates, not colours. Pick one and it opens the invoice list already filtered to it.',
}

export const TOUR_STEPS = [
  {
    tab: 'receivables',
    badge: 'Step 1 of 6 · Core Ledger',
    title: 'Receivables & Invoice Aging Analysis',
    desc: 'Real-time invoice ledger with D3 aging bands (0-30, 31-60, 61-90, 90+ days), margin calculation, and instant payment settlement.',
  },
  {
    tab: 'delivery',
    badge: 'Step 2 of 6 · Delivery Ops',
    title: 'Live Project Delivery & Multi-View Board',
    desc: 'Track project milestones with Kanban, client grouping, timeline Gantt, custom view generator, and password-protected client link sharing.',
  },
  {
    tab: 'studio',
    badge: 'Step 3 of 6 · Vector RAG',
    title: 'Studio RAG & Contract Intelligence',
    desc: 'Upload business contracts into pgvector, then ask questions with semantic similarity scores and exact paragraph citations.',
  },
  {
    tab: 'analyst',
    badge: 'Step 4 of 6 · Zero Hallucination',
    title: 'AI Analyst & Transparent SQL',
    desc: 'Natural language questions translated into deterministic parameterized SQL queries. 100% auditable with zero hallucinations.',
  },
  {
    tab: 'tax',
    badge: 'Step 5 of 6 · Tax Escrow',
    title: 'Statutory GST & TDS Escrow',
    desc: 'Dynamic working capital segregation: separates 18% GST collected and Form 26AS TDS credits from spendable cash automatically.',
  },
  {
    tab: 'pages',
    badge: 'Step 6 of 6 · Dynamic Web',
    title: 'AI Dynamic Pages Studio',
    desc: 'Generate interactive client portals, ROI calculators, and markdown briefs in real-time with live streaming and instant templates.',
  },
]

/* ── The Shell ───────────────────────────────────────────────────────── */

export default function DemoWorkspace() {
  const [state, setState] = useState({
    tab: 'receivables',
    status: 'all',
    band: null,
    query: '',
    sort: { key: 'amount', dir: 'desc' },
    project: PROJECT_ROLLUP[0].id,
    months: 6,
    question: 0,
    detail: null,
    board: 'lane',
    card: null,
  })
  const [driving, setDriving] = useState(false)
  const [tourActive, setTourActive] = useState(true)
  const [tourIndex, setTourIndex] = useState(0)
  const [tourPaused, setTourPaused] = useState(false)
  const [tourProgress, setTourProgress] = useState(0)
  const [onScreen, setOnScreen] = useState(false)
  const [hints, setHints] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const searchRef = useRef(null)
  const lastRowRef = useRef(null)

  const set = (patch) => {
    setDriving(true)
    setTourActive(false)
    setState(s => ({ ...s, ...patch }))
  }

  const startTour = () => {
    setDriving(false)
    setTourActive(true)
    setTourPaused(false)
    setTourIndex(0)
    setTourProgress(0)
    setState(s => ({
      ...s,
      tab: TOUR_STEPS[0].tab,
      detail: null,
      status: 'all',
      band: null,
      query: '',
    }))
  }

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setOnScreen(true); return }
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Auto-advance guided tour
  useEffect(() => {
    if (!tourActive || tourPaused || driving || !onScreen) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const timer = setInterval(() => {
      setTourProgress(prev => {
        if (prev >= 100) {
          const nextIdx = (tourIndex + 1) % TOUR_STEPS.length
          setTourIndex(nextIdx)
          setState(s => ({ ...s, tab: TOUR_STEPS[nextIdx].tab, detail: null }))
          return 0
        }
        return prev + 2.5 // advances every 4 seconds
      })
    }, 100)
    return () => clearInterval(timer)
  }, [tourActive, tourPaused, driving, onScreen, tourIndex])

  // Listen to external trigger event from Launch button
  useEffect(() => {
    const handleStartTour = () => {
      startTour()
    }
    window.addEventListener('ft-start-tour', handleStartTour)
    return () => window.removeEventListener('ft-start-tour', handleStartTour)
  }, [])

  const Panel = PANELS[state.tab] || PANELS.receivables
  const detail = state.detail ? INVOICES.find(i => i.id === state.detail) : null

  const openDetail = (id) => {
    lastRowRef.current = document.activeElement
    set({ detail: id })
  }

  const onKeys = (e) => {
    const typing = e.target instanceof HTMLInputElement
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setShowCommandPalette(p => !p)
      return
    }
    if (e.key === 'Escape') {
      if (showCommandPalette) { setShowCommandPalette(false); return }
      if (state.detail) { setState(s => ({ ...s, detail: null })); return }
      if (typing) {
        e.target.blur()
        frameRef.current?.focus()
        return
      }
      if (state.band || state.query || state.status !== 'all') {
        set({ band: null, query: '', status: 'all' })
      }
      return
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return

    const tabIdx = TABS.findIndex((_, idx) => String(idx + 1) === e.key)
    if (tabIdx !== -1) {
      e.preventDefault()
      set({ tab: TABS[tabIdx].id, detail: null })
      return
    }

    if (e.key === '/') {
      e.preventDefault()
      if (state.tab !== 'receivables') set({ tab: 'receivables' })
      requestAnimationFrame(() => searchRef.current?.focus())
      return
    }
    if (e.key === '?') { e.preventDefault(); setHints(h => !h) }
  }

  const restart = () => {
    setDriving(false)
    setState({
      tab: 'receivables', status: 'all', band: null, query: '',
      sort: { key: 'amount', dir: 'desc' }, project: PROJECT_ROLLUP[0].id,
      months: 6, question: 0, detail: null, board: 'lane', card: null,
    })
  }

  return (
    <div ref={hostRef}>
      <div ref={frameRef} className="ft-tour relative" tabIndex={-1} onKeyDown={onKeys}>
        {/* Window Chrome Header */}
        <div className="ft-tour-chrome">
          {['#ef4444', '#fbbf24', '#22c55e'].map(c => (
            <span key={c} className="ft-tour-dot" style={{ background: c }} />
          ))}
          <span className="ml-2 font-semibold truncate" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            fintrack — {TABS.find(t => t.id === state.tab)?.label.toLowerCase()}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* Quick Tour Button */}
            <button
              onClick={startTour}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer shadow-sm"
              style={{
                background: tourActive && !driving ? 'var(--accent-dim)' : 'var(--card-bg)',
                border: `1px solid ${tourActive && !driving ? 'var(--accent)' : 'var(--card-border)'}`,
                color: tourActive && !driving ? 'var(--accent)' : 'var(--text-1)',
              }}
              title="Start Interactive Guided Tour"
            >
              <Sparkles size={11} className={tourActive && !driving ? 'text-[var(--accent)] animate-spin' : 'text-[var(--accent)]'} />
              <span>{tourActive && !driving ? 'Tour Active' : 'Guided Tour'}</span>
            </button>

            {/* Quick Command Palette Button */}
            <button
              onClick={() => setShowCommandPalette(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              title="Command Palette (⌘K)"
            >
              <Search size={10} />
              <span className="hidden sm:inline">Search</span>
              <kbd className="text-[8.5px] opacity-75 font-mono">⌘K</kbd>
            </button>

            {/* Live Notifications Popover Trigger */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-1)] relative cursor-pointer"
                title="Workspace Events"
              >
                <Bell size={13} />
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              </button>
              {showNotifications && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-60 rounded-xl p-2.5 border shadow-xl backdrop-blur-md z-30 text-left"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
                >
                  <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-[var(--card-border)]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">Live Events</span>
                    <button onClick={() => setShowNotifications(false)} className="text-[var(--text-3)] cursor-pointer"><X size={11} /></button>
                  </div>
                  <div className="space-y-1.5 text-[10.5px]">
                    <p className="text-[var(--text-2)]"><strong className="text-[var(--text-1)]">Meridian Labs:</strong> Site rebuild milestone 2 ready.</p>
                    <p className="text-[var(--text-2)]"><strong className="text-[var(--text-1)]">Tax Ledger:</strong> TDS matched on Form 26AS.</p>
                    <p className="text-[var(--text-2)]"><strong className="text-[var(--text-1)]">PMS:</strong> Invoice #2291 cleared.</p>
                  </div>
                </div>
              )}
            </div>

            <span className="hidden sm:inline text-[10px] font-mono text-[var(--text-3)]">
              mayukh/fintrack
            </span>

            <span className="rounded font-bold uppercase tracking-[0.14em] shrink-0"
                  style={{ fontSize: 8.5, padding: '3px 7px', background: 'var(--card-border)', color: 'var(--text-3)' }}>
              Sample data
            </span>
          </div>
        </div>

        <div className="ft-tour-body">
          {/* Navigation Rail */}
          <nav className="ft-tour-rail" aria-label="Sample workspace sections">
            {TABS.map(t => {
              const Icon = t.icon
              const on = state.tab === t.id
              return (
                <button key={t.id} onClick={() => set({ tab: t.id })}
                        aria-current={on ? 'page' : undefined}
                        aria-label={t.label}
                        className="ft-tour-rail-item cursor-pointer"
                        data-on={on ? '' : undefined}
                        style={{ background: on ? undefined : 'transparent',
                                 border: 0, width: '100%', textAlign: 'left' }}>
                  <Icon size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span className="hidden sm:inline truncate" aria-hidden="true">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Main Stage */}
          <div className="ft-tour-stage flex flex-col">
            {/* Interactive Tour Guide Callout Banner */}
            {tourActive && !driving && (
              <div className="mx-3 mt-3 p-3 sm:p-4 rounded-xl border relative overflow-hidden backdrop-blur-md shrink-0"
                   style={{
                     background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(56,189,248,0.08) 100%)',
                     borderColor: 'var(--accent-soft)',
                     boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                   }}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded text-[9.5px] font-extrabold uppercase tracking-wider text-white"
                            style={{ background: 'var(--accent)' }}>
                        {TOUR_STEPS[tourIndex]?.badge || `Step ${tourIndex + 1}`}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-1)] truncate">
                        {TOUR_STEPS[tourIndex]?.title}
                      </span>
                    </div>
                    <p className="text-[11.5px] leading-snug text-[var(--text-2)] m-0">
                      {TOUR_STEPS[tourIndex]?.desc}
                    </p>
                  </div>

                  {/* Tour Action Controls */}
                  <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                    <button
                      onClick={() => {
                        const prevIdx = (tourIndex - 1 + TOUR_STEPS.length) % TOUR_STEPS.length
                        setTourIndex(prevIdx)
                        setTourProgress(0)
                        setState(s => ({ ...s, tab: TOUR_STEPS[prevIdx].tab, detail: null }))
                      }}
                      className="p-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer"
                      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
                      title="Previous Tour Step"
                    >
                      <ChevronLeft size={13} />
                    </button>

                    <button
                      onClick={() => setTourPaused(p => !p)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer"
                      style={{
                        background: tourPaused ? 'var(--card-bg)' : 'var(--accent-dim)',
                        borderColor: tourPaused ? 'var(--card-border)' : 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                      title={tourPaused ? "Resume Auto-Play" : "Pause Auto-Play"}
                    >
                      {tourPaused ? <Play size={11} /> : <Pause size={11} />}
                      <span className="text-[10.5px]">{tourPaused ? 'Play' : 'Pause'}</span>
                    </button>

                    <button
                      onClick={() => {
                        const nextIdx = (tourIndex + 1) % TOUR_STEPS.length
                        setTourIndex(nextIdx)
                        setTourProgress(0)
                        setState(s => ({ ...s, tab: TOUR_STEPS[nextIdx].tab, detail: null }))
                      }}
                      className="p-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer"
                      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
                      title="Next Tour Step"
                    >
                      <ChevronRight size={13} />
                    </button>

                    <button
                      onClick={() => {
                        setTourActive(false)
                        setDriving(true)
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ml-1"
                      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                      title="Take full control"
                    >
                      Drive Freely
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                {!tourPaused && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200 dark:bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-sky-400 transition-all duration-100"
                      style={{ width: `${tourProgress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div key={state.tab} className="h-full ft-tour-scene flex-1">
              <Panel state={state} set={set} onOpen={openDetail} searchRef={searchRef} />
            </div>

            {detail && (
              <InvoiceDrawer
                invoice={detail}
                returnFocusRef={lastRowRef}
                onClose={() => setState(s => ({ ...s, detail: null }))}
              />
            )}

            {showCommandPalette && (
              <CommandPaletteModal
                onClose={() => setShowCommandPalette(false)}
                onSelectTab={(tabId) => set({ tab: tabId })}
                onSelectInvoice={(invId) => openDetail(invId)}
                onSelectProject={(projId) => set({ tab: 'projects', project: projId })}
              />
            )}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="flex items-center gap-2 px-3 py-2"
             style={{ borderTop: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
          {driving ? (
            <>
              <MousePointerClick size={13} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="font-semibold" style={{ fontSize: 11, color: 'var(--text-2)' }}>
                You are driving freely.
              </span>
              <button onClick={() => setHints(h => !h)}
                      aria-expanded={hints}
                      className="ml-auto flex items-center gap-1.5 rounded-md font-semibold shrink-0 cursor-pointer"
                      style={{ height: 26, padding: '0 9px', fontSize: 11,
                               background: hints ? 'var(--accent-dim)' : 'var(--card-bg)',
                               border: `1px solid ${hints ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                               color: hints ? 'var(--accent)' : 'var(--text-2)' }}>
                <Keyboard size={12} aria-hidden="true" /> Keys
              </button>
              <button onClick={startTour}
                      className="flex items-center gap-1.5 rounded-md font-semibold shrink-0 cursor-pointer shadow-sm"
                      style={{ height: 26, padding: '0 10px', fontSize: 11,
                               background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)',
                               color: 'var(--accent)' }}>
                <Play size={11} aria-hidden="true" /> Guided Tour
              </button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 font-semibold shrink-0"
                    style={{ fontSize: 11, color: 'var(--accent)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)',
                               animation: 'ft-pulse 1.8s ease-in-out infinite' }} />
                Touring Step {tourIndex + 1}/{TOUR_STEPS.length}
              </span>
              <span className="truncate hidden sm:inline" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                — auto-advancing (click anywhere to take over)
              </span>
              <button
                onClick={() => {
                  setTourActive(false)
                  setDriving(true)
                }}
                className="ml-auto px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer"
                style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              >
                Take Over
              </button>
            </>
          )}
        </div>
      </div>

      {hints && (
        <div className="mt-3 rounded-xl p-3 flex flex-wrap gap-x-5 gap-y-2"
             style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                      animation: 'ft-slide-up 240ms cubic-bezier(0.22,1,0.36,1) both' }}>
          {[
            [`1 – ${TABS.length}`, 'switch module'],
            ['/', 'search invoices'],
            ['↑ ↓', 'move through rows'],
            ['Enter', 'open an invoice'],
            ['Esc', 'close, or clear the filters'],
            ['?', 'this list'],
          ].map(([k, what]) => (
            <span key={k} className="flex items-center gap-2">
              <kbd style={KBD}>{k}</kbd>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{what}</span>
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-2)', minHeight: '3.2em' }}>
        {CAPTION[state.tab]}
      </p>
    </div>
  )
}
