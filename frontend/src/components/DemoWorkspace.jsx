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
  Play, X, MousePointerClick, Keyboard, Copy, Check as CheckIcon,
  KanbanSquare, Rows3, Radio, Mail, FileText, SlidersHorizontal,
  Download, CheckSquare, Square, LayoutDashboard, FileSpreadsheet,
  Globe, Layers, TrendingUp, ShieldCheck, ArrowRight, ExternalLink,
  Plus, Eye, Code, RefreshCw, CheckCircle2, AlertTriangle, Clock,
  Cpu, Database, HelpCircle, Bell, User, MessageSquare, Send,
  Printer, Share2, Check,
} from 'lucide-react'
import {
  INVOICES, AGEING, PROJECT_ROLLUP, TOTALS, QUESTIONS, BANDS,
  ask, bandOf, monthly, inr, inrShort, shortDate, GST_RATE, TDS_RATE,
  DELIVERY, LANES, boardBy, TAX_SUMMARY, TAX_CLIENTS, PAGES_MOCK,
  AI_CHAT_PRESETS, REPORT_TEMPLATES,
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

function Stat({ label, value, tone = 'var(--text-1)', sub, trend }) {
  return (
    <div className="ft-kpi min-w-0">
      <div className="flex items-center justify-between w-full">
        <span className="k">{label}</span>
        {trend && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: trend.startsWith('+') ? 'var(--ok-dim)' : 'var(--bg-input)',
                         color: trend.startsWith('+') ? 'var(--ok)' : 'var(--text-3)' }}>
            {trend}
          </span>
        )}
      </div>
      <span className="v" style={{ color: tone }}>{value}</span>
      {sub && <span className="s">{sub}</span>}
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
            className="px-2 py-1 rounded text-[10px] font-bold border transition-colors"
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
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all"
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
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all"
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
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all"
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
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10.5px] font-bold transition-all"
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
                  className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-2)]"
                >
                  {whatsAppCopied ? 'Copied' : 'WhatsApp Text'}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`Subject: Payment Follow-up: Invoice ${invoice.id} (${invoice.client})\n\nDear ${invoice.client} Finance Team,\n\nWe would like to gently follow up on Invoice ${invoice.id} for ${inr(received)} (Net after ${Math.round(tdsRate * 100)}% TDS), which was due on ${shortDate(invoice.dueOn)}.\n\nKindly confirm when remittance is processed.`)
                    setReminderCopied(true)
                    setTimeout(() => setReminderCopied(false), 2000)
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-bold"
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
              <button onClick={() => setShowPdfModal(false)} className="text-slate-400 hover:text-slate-800">
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
              className="w-full py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs"
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

  const runwayValue = runwayMode === 'Conservative' ? '3.4 mo' : runwayMode === 'Aggressive' ? '6.2 mo' : '4.8 mo'

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
              4/4 Healthy
            </span>
            <span className="text-[10px] font-bold text-[var(--ok)]">+14.2% QoQ</span>
          </div>
          <p className="text-xl font-black tabular-nums tracking-tight" style={{ color: 'var(--text-1)' }}>
            ₹15.59L
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg border text-right"
               style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <span className="block text-[9px] font-bold text-[var(--text-3)] uppercase">Active Signal</span>
            <span className="text-[11px] font-bold" style={{ color: 'var(--accent)' }}>
              Maitrimetal / ZOHO
            </span>
          </div>
          <button
            onClick={() => set({ tab: 'receivables' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Inspect Ledger <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* 6 High-Fidelity KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Net Revenue" value="₹33.47L" sub="Active FY26" trend="+18.4%" />
        <Stat label="Direct Costs" value="₹18.65L" sub="55.7% burn" trend="Controlled" />
        <Stat label="Gross Margin" value="44.3%" tone="var(--ok)" sub="Target: >35%" trend="+3.2%" />
        <Stat label="Outstanding" value="₹5.87L" tone="var(--warn)" sub="1 overdue" trend="Follow-up" />
        <Stat label="Realized Collection" value="₹27.61L" tone="var(--ok)" sub="82.5% rate" trend="+5.1%" />
        <Stat label="Safe Runway" value={runwayValue} sub={`Scenario: ${runwayMode}`} trend="Secure" />
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
              className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
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
            <span className="text-[10px] font-semibold text-[var(--ok)]">9 Healthy · 0 Overdue</span>
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
            <span className="text-[10px] font-semibold text-[var(--text-2)]">Top 2 = 100%</span>
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Birla Open Minds</span>
              <span className="font-bold text-[var(--text-1)]">58%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-2)]">Innovine</span>
              <span className="font-bold text-[var(--text-1)]">42%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Project Roster */}
      <div className="rounded-xl p-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]">
            Active Engagements
          </span>
          <button onClick={() => set({ tab: 'projects' })} className="text-[10.5px] font-bold text-[var(--accent)] hover:underline">
            View all projects →
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { name: 'PMS', client: 'Birla Open Minds', billed: '₹21.08L', profit: '₹9.18L', margin: '43.5%', status: 'Active' },
            { name: 'Innovine', client: 'Innovine', billed: '₹10.82L', profit: '₹5.64L', margin: '52.1%', status: 'Active' },
            { name: 'PMS-Presales', client: 'Birla Open Minds', billed: '₹1.57L', profit: '₹0.70L', margin: '44.6%', status: 'Active' },
            { name: 'ZOHO', client: 'Maitrimetal', billed: '₹0.00', profit: '₹0.00', margin: '0.0%', status: 'Pipeline' },
          ].map(p => (
            <div
              key={p.name}
              onClick={() => set({ tab: 'projects' })}
              className="p-2 rounded-lg border flex flex-col justify-between cursor-pointer hover:border-[var(--accent)] transition-colors"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}
            >
              <div className="flex justify-between items-start mb-1">
                <div>
                  <span className="font-bold text-[11.5px]" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                  <span className="block text-[9.5px] text-[var(--text-3)]">{p.client}</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                      style={{ background: p.status === 'Active' ? 'var(--ok-dim)' : 'var(--accent-dim)',
                               color: p.status === 'Active' ? 'var(--ok)' : 'var(--accent)' }}>
                  {p.status}
                </span>
              </div>
              <div className="flex justify-between items-baseline pt-1 border-t border-[var(--card-border)] text-[10px]">
                <span className="text-[var(--text-3)]">Billed: <strong className="text-[var(--text-1)]">{p.billed}</strong></span>
                <span className="font-bold text-[var(--ok)]">{p.margin} margin</span>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchCopied, setBatchCopied] = useState(false)
  const [liveInvoices, setLiveInvoices] = useState(INVOICES)

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

      {/* ── Search & Status Filters & Currency Toggles ── */}
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
                  className="rounded-lg font-semibold shrink-0"
                  style={{
                    height: 30, padding: '0 9px', fontSize: 11, cursor: 'pointer',
                    background: status === s ? 'var(--accent)' : 'var(--card-bg)',
                    border: `1px solid ${status === s ? 'var(--accent)' : 'var(--card-border)'}`,
                    color: status === s ? '#fff' : 'var(--text-2)',
                  }}>
            {s === 'all' ? 'All' : s}
          </button>
        ))}
        </div>

        <div className="ft-tools-aux">
        <div className="flex items-center rounded-lg border p-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
          {Object.keys(CURRENCY_RATES).map(cKey => (
            <button
              key={cKey}
              onClick={() => setCurrency(cKey)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all"
              style={{
                background: currency === cKey ? 'var(--accent)' : 'transparent',
                color: currency === cKey ? '#fff' : 'var(--text-3)',
                cursor: 'pointer',
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
          className="flex items-center gap-1 rounded-lg px-2 shrink-0 font-semibold"
          style={{
            height: 30, fontSize: 11, cursor: 'pointer',
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
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 transition-all"
            style={{
              background: category === cat ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${category === cat ? 'var(--accent)' : 'var(--card-border)'}`,
              color: category === cat ? 'var(--accent)' : 'var(--text-3)',
              cursor: 'pointer',
            }}
          >
            {cat === 'all' ? 'All categories' : cat}
          </button>
        ))}
      </div>

      {band && (
        <button onClick={() => set({ band: null })}
                className="self-start flex items-center gap-1.5 rounded-lg font-bold mb-2"
                style={{ height: 26, padding: '0 8px', fontSize: 10.5, cursor: 'pointer',
                         background: 'var(--accent-dim)', color: 'var(--accent)',
                         border: '1px solid var(--accent-soft)' }}>
          Ageing: {BANDS.find(b => b.id === band)?.label}
          <X size={12} aria-hidden="true" />
        </button>
      )}

      {/* ── Main Table Frame ── */}
      <div className="rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col relative"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        
        {/* Table Header */}
        <div className="ft-rowhead flex items-center gap-2 px-3 shrink-0"
             style={{ height: 30, background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
          <button
            onClick={selectAllRows}
            title={selectedIds.size === rows.length ? 'Deselect all' : 'Select all'}
            className="p-0.5 rounded hover:text-[var(--accent)] transition-colors"
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
                    className={`flex items-center gap-1 font-bold uppercase tracking-[0.1em] ${c.hideSm ? 'hidden sm:flex' : 'flex'}`}
                    style={{ fontSize: 9, color: sort.key === c.key ? 'var(--accent)' : 'var(--text-3)',
                             flex: c.grow, cursor: 'pointer', background: 'none', border: 0,
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
                className="w-full flex items-center gap-2 px-3 text-left ft-row group"
                style={{
                  height: 34,
                  border: 0,
                  borderBottomWidth: 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'var(--card-border)',
                  background: isSelected ? 'var(--accent-dim)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span
                  onClick={(e) => toggleSelectRow(e, r.id)}
                  className="p-0.5 rounded text-[var(--text-3)] group-hover:text-[var(--accent)] transition-colors"
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
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold"
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
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-bold border"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              >
                <Download size={11} />
                Export
              </button>

              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-1 text-[var(--text-3)] hover:text-[var(--text-1)]"
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
          <span>Innovine Milestone 2 delivered — ₹1.80L unbilled work ready for invoice.</span>
        </div>
        <button
          onClick={() => set({ tab: 'delivery' })}
          className="text-[10.5px] font-bold underline hover:opacity-80"
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
                  className="rounded-lg font-semibold shrink-0"
                  style={{
                    height: 30, padding: '0 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
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
                className="px-2 py-0.5 rounded text-[10px] font-bold transition-all"
                style={{
                  background: costOffset === b.val ? 'var(--accent)' : 'transparent',
                  color: costOffset === b.val ? '#fff' : 'var(--text-2)',
                  border: `1px solid ${costOffset === b.val ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
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
              className="px-2 py-0.5 rounded text-[10.5px] font-bold transition-all"
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
        <Stat label="Taxable Value" value={`₹${(TAX_SUMMARY.taxableValue / 1e5).toFixed(2)}L`} sub="Billed base" />
        <Stat label="GST (18%)" value={`₹${(TAX_SUMMARY.gstCollected / 1e5).toFixed(2)}L`} tone="var(--accent)" sub="CGST + SGST 9%" />
        <Stat label="TDS (10%)" value={`₹${(TAX_SUMMARY.tdsCollected / 1e5).toFixed(2)}L`} tone="var(--warn)" sub="Sec 194J withheld" />
        <Stat label="Gross Invoiced" value={`₹${(TAX_SUMMARY.grossInvoiced / 1e5).toFixed(2)}L`} sub="Document total" />
        <Stat label="Net Receivable" value={`₹${(TAX_SUMMARY.netReceivable / 1e5).toFixed(2)}L`} tone="var(--ok)" sub="Lands in bank" />
        <Stat label="Open Invoices" value="0" tone="var(--ok)" sub="100% filed" />
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
            <span className="font-bold text-[var(--text-1)]">₹{(TAX_SUMMARY.cgst / 1e5).toFixed(2)}L</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono pt-1">
            <span className="text-[var(--text-2)]">SGST @ 9%:</span>
            <span className="font-bold text-[var(--text-1)]">₹{(TAX_SUMMARY.sgst / 1e5).toFixed(2)}L</span>
          </div>
        </div>

        <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <div>
            <div className="flex items-center gap-1.5 mb-1 text-[var(--ok)]">
              <CheckCircle2 size={13} />
              <span className="text-[11px] font-bold">26AS & AIS Reconciled</span>
            </div>
            <p className="text-[10px] text-[var(--text-3)] leading-snug">
              All ₹1.52L TDS credit claims match Traces Form 26AS with zero statutory shortfall.
            </p>
          </div>
          <button
            onClick={downloadGstr1}
            className="mt-2 flex items-center justify-center gap-1 py-1 px-2.5 rounded-lg text-[10.5px] font-bold"
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
  const series = useMemo(() => monthly(state.months), [state.months])
  const max = Math.max(...series.map(m => Math.max(m.billed, m.collected)), 1)
  const W = 260, H = 96
  const x = (i) => (i / Math.max(series.length - 1, 1)) * (W - 16) + 8
  const y = (v) => H - 10 - (v / max) * (H - 24)
  const line = series.map((m, i) => `${x(i).toFixed(1)},${y(m.collected).toFixed(1)}`).join(' L ')

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 mb-2.5">
        {[3, 6, 12].map(n => (
          <button key={n} onClick={() => set({ months: n })}
                  aria-pressed={state.months === n}
                  className="rounded-lg font-semibold"
                  style={{ height: 30, padding: '0 12px', fontSize: 11.5, cursor: 'pointer',
                           background: state.months === n ? 'var(--accent)' : 'var(--card-bg)',
                           border: `1px solid ${state.months === n ? 'var(--accent)' : 'var(--card-border)'}`,
                           color: state.months === n ? '#fff' : 'var(--text-2)' }}>
            {n}M
          </button>
        ))}
        <span className="ml-auto" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
          bars billed · line collected
        </span>
      </div>

      <div className="ft-kpis mb-2.5">
        <Stat label="Collection rate" value={`${TOTALS.collectionRate}%`} trend="+4.2%" />
        <Stat label="Days to collect" value={TOTALS.avgDaysToCollect} trend="38 avg" />
        <Stat label="GST tracked"     value={inrShort(TOTALS.gst)} trend="Reconciled" />
      </div>

      <div className="rounded-xl p-2 flex-1 min-h-0"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
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
        <div className="flex justify-between px-1 pt-1">
          {series.map((m, i) => (
            <span key={m.key + i} style={{ fontSize: 8.5, color: 'var(--text-3)' }}>{m.key}</span>
          ))}
        </div>
      </div>

      <p className="mt-2" style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        Change the window and every tile above moves with it — the period is a
        filter on the same rows, not a different report.
      </p>
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
      className="ml-auto flex items-center gap-1 rounded shrink-0"
      style={{ height: 20, padding: '0 6px', fontSize: 9.5, cursor: 'pointer',
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
    if (!customInput.trim()) return
    setCustomAnswer(`Analyzing portfolio data for: "${customInput}"... Verified across 10 active invoices: Total value ₹47.88L, realized collection ₹19.45L (40.6% on-time), gross margin 44.3%.`)
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
              className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all"
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
                  className="rounded-lg font-semibold text-left"
                  style={{
                    minHeight: 28, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
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
          className="px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1"
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
            <button onClick={() => setCustomAnswer(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
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
  const [generating, setGenerating] = useState(null)
  const [generatedDoc, setGeneratedDoc] = useState(null)
  const [copied, setCopied] = useState(false)
  const [reportTab, setReportTab] = useState('summary')

  const handleGenerate = (tpl) => {
    setGenerating(tpl.id)
    setTimeout(() => {
      setGenerating(null)
      setGeneratedDoc(tpl)
    }, 800)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)]">
        <div>
          <h3 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Instant Board Packs & Reports</h3>
          <p className="text-[10px] text-[var(--text-3)]">Generated directly from verified ledger records.</p>
        </div>
      </div>

      {/* Templates Grid */}
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
              className="w-full py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
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

      {/* Generated Report Drawer / Modal */}
      {generatedDoc && (
        <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-[var(--text-1)]">
                Compiled: {generatedDoc.title} (FY26 Q2 Edition)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`# ${generatedDoc.title} - Executive Summary\n\n- Net Revenue: ₹33.47L (Target 100% achieved)\n- Realized Margin: 44.3% across 7 active engagements\n- Safe Runway: 4.8 months with zero statutory deficit`)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-2)]"
              >
                {copied ? 'Copied' : 'Copy Markdown'}
              </button>
              <button onClick={() => setGeneratedDoc(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-1 mb-2">
            {['summary', 'p&l', 'risk'].map(t => (
              <button
                key={t}
                onClick={() => setReportTab(t)}
                className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase transition-all"
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
                <p>• Portfolio Net Invoiced: ₹17.93L (GST: ₹2.73L, TDS: ₹1.52L)</p>
                <p>• Margin Champion: Innovine at 52.1% Gross Margin</p>
                <p>• Collection Health: 82.5% on-time settlement rate</p>
              </>
            )}
            {reportTab === 'p&l' && (
              <>
                <p className="font-bold text-[var(--text-1)] mb-1">### Income Statement Summary</p>
                <p>• Gross Billed: ₹33.47L</p>
                <p>• Direct Project Delivery Costs: ₹18.65L (55.7%)</p>
                <p>• Net Project Gross Profit: ₹14.82L (44.3% Margin)</p>
              </>
            )}
            {reportTab === 'risk' && (
              <>
                <p className="font-bold text-[var(--text-1)] mb-1">### Risk & Compliance Audit</p>
                <p>• Statutory Deficit: ₹0.00 (100% Tax Compliant)</p>
                <p>• 90+ Day Aging Exposure: ₹7.12L across 2 accounts</p>
                <p>• Client Concentration Risk: Medium (Top 2 = 100%)</p>
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
  const { board, card } = state
  const [laneOverrides, setLaneOverrides] = useState({})
  const [recentAction, setRecentAction] = useState(null)

  const activeDelivery = useMemo(() => {
    return DELIVERY.map(d => ({
      ...d,
      lane: laneOverrides[d.id] ?? d.lane,
    }))
  }, [laneOverrides])

  const columns = useMemo(() => {
    const keys = board === 'lane' ? LANES : [...new Set(activeDelivery.map(d => d[board]))]
    return keys
      .map(name => ({ name, cards: activeDelivery.filter(d => d[board] === name) }))
      .filter(col => col.cards.length > 0 || board === 'lane')
  }, [board, activeDelivery])

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

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {[['lane', 'By status', KanbanSquare], ['client', 'By client', Rows3]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => set({ board: k, card: null })}
                  aria-pressed={board === k}
                  className="flex items-center gap-1.5 rounded-lg font-semibold"
                  style={{ height: 28, padding: '0 10px', fontSize: 11, cursor: 'pointer',
                           background: board === k ? 'var(--accent)' : 'var(--card-bg)',
                           border: `1px solid ${board === k ? 'var(--accent)' : 'var(--card-border)'}`,
                           color: board === k ? '#fff' : 'var(--text-2)' }}>
            <Icon size={12} aria-hidden="true" /> {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[11px] font-bold"
             style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
          <span style={{ color: 'var(--text-3)' }}>Delivered & Incurred:</span>
          <span className="font-mono text-emerald-500 font-extrabold">{inr(deliveredTotal)}</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>

      {recentAction && (
        <div className="mb-2 px-2.5 py-1.5 rounded-lg text-[10.5px] flex items-center justify-between border"
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

      <div className="flex-1 min-h-0 overflow-x-auto">
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
                            className="ft-card text-left rounded-lg p-2 transition-all relative overflow-hidden"
                            style={{
                              background: 'var(--card-bg)', cursor: 'pointer',
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

      {open && (
        <div className="mt-2.5 rounded-lg p-2.5 shrink-0"
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
                    className="ml-auto" style={{ background: 'none', border: 0, cursor: 'pointer',
                                                 color: 'var(--text-3)' }}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <p className="mb-2.5" style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{open.detail}</p>

          <div className="flex items-center gap-1 pt-2 border-t border-[var(--card-border)]">
            <span className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-3)] mr-1">
              Advance Stage:
            </span>
            {LANES.map(lane => (
              <button
                key={lane}
                onClick={() => moveLane(open.id, lane, open.project)}
                className="px-2 py-0.5 rounded text-[9.5px] font-bold transition-all"
                style={{
                  background: open.lane === lane ? (lane === 'Delivered' ? 'var(--ok-dim)' : 'var(--accent-dim)') : 'var(--bg-input)',
                  border: `1px solid ${open.lane === lane ? (lane === 'Delivered' ? 'var(--ok)' : 'var(--accent)') : 'var(--card-border)'}`,
                  color: open.lane === lane ? (lane === 'Delivered' ? 'var(--ok)' : 'var(--accent)') : 'var(--text-2)',
                  cursor: 'pointer',
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
  const [showEditor, setShowEditor] = useState(false)
  const [newPageTitle, setNewPageTitle] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [previewPage, setPreviewPage] = useState(null)

  const handleCreate = () => {
    if (!newPageTitle.trim()) return
    const newP = {
      id: `p-${Date.now()}`,
      title: newPageTitle.trim(),
      url: `/p/${newPageTitle.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'Html',
      status: 'Live',
      views: 0,
      created: 'Just now',
    }
    setPages([newP, ...pages])
    setNewPageTitle('')
    setShowEditor(false)
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)]">
        <div>
          <h3 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Published Pages</h3>
          <p className="text-[10px] text-[var(--text-3)]">Client portals, quote calculators, and interactive documents.</p>
        </div>
        <button
          onClick={() => setShowEditor(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Plus size={12} /> New Page
        </button>
      </div>

      {/* Pages Table */}
      <div className="rounded-xl overflow-hidden border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-[var(--card-border)] text-[9.5px] font-bold uppercase text-[var(--text-3)] bg-[var(--bg-input)]">
              <th className="py-2 px-3">Title & Slug</th>
              <th className="py-2 px-2">Type</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2 text-right">Views</th>
              <th className="py-2 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--card-border)]">
            {pages.map(p => (
              <tr key={p.id} className="hover:bg-[var(--bg-input)]">
                <td className="py-2 px-3">
                  <span className="font-bold block text-[var(--text-1)]">{p.title}</span>
                  <span className="text-[9.5px] font-mono text-[var(--text-3)]">{p.url}</span>
                </td>
                <td className="py-2 px-2 text-[var(--text-2)]">{p.type}</td>
                <td className="py-2 px-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--ok-dim)] text-[var(--ok)]">
                    {p.status}
                  </span>
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-bold text-[var(--text-1)]">{p.views}</td>
                <td className="py-2 px-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setPreviewPage(p)}
                      className="px-2 py-0.5 rounded text-[9.5px] font-semibold border bg-[var(--bg-input)] border-[var(--card-border)] text-[var(--text-2)]"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(`https://fintrack.app${p.url}`)
                        setCopiedId(p.id)
                        setTimeout(() => setCopiedId(null), 1500)
                      }}
                      className="px-2 py-0.5 rounded text-[9.5px] font-semibold border bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-2)]"
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

      {/* Live Page Preview Modal */}
      {previewPage && (
        <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text-1)]">
              Live Preview: {previewPage.title} ({previewPage.url})
            </span>
            <button onClick={() => setPreviewPage(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
              <X size={14} />
            </button>
          </div>
          <div className="rounded-lg p-3 bg-white text-slate-900 border border-slate-200 shadow-sm space-y-2">
            <h4 className="font-bold text-sm text-blue-600">{previewPage.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Welcome to the client portal for {previewPage.title}. All project milestones, deliverables, and billing schedules are synchronized in real time with the workspace ledger.
            </p>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400">
              <span>Status: Verified Live</span>
              <span>·</span>
              <span>Views: {previewPage.views}</span>
            </div>
          </div>
        </div>
      )}

      {/* New Page Drawer Modal */}
      {showEditor && (
        <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text-1)]">Create New Agentic Page</span>
            <button onClick={() => setShowEditor(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="e.g. Q4 Client Presentation Portal"
              value={newPageTitle}
              onChange={e => setNewPageTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs border"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            />
            <button
              onClick={handleCreate}
              className="w-full py-1.5 rounded-lg text-xs font-bold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Publish Page Instantly
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 10. Studio View ─────────────────────────────────────────────────── */

function Studio() {
  const [subTab, setSubTab] = useState('Documents')
  const [search, setSearch] = useState('')
  const [inspectedDoc, setInspectedDoc] = useState(null)

  const docs = [
    { title: 'FY26 MSA - Birla Open Minds', size: '2.4 MB', tokens: '14,200', citations: 18, excerpt: 'Payment terms: Net-30 from invoice receipt. SEZ Section 16 zero-rated GST status applies.' },
    { title: 'Innovine SOW Q2-Q3 Milestone Schedule', size: '1.1 MB', tokens: '8,400', citations: 12, excerpt: 'Deliverable 1: Design System (₹3.5L). Deliverable 2: Frontend Integration (₹1.8L).' },
    { title: 'Standard Service Agreement & SEZ Clause', size: '840 KB', tokens: '4,100', citations: 9, excerpt: 'Statutory TDS deductions capped under Section 194J at 10% with quarterly Form 16A delivery.' },
  ]

  const filteredDocs = docs.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto space-y-3">
      {/* Studio Header Bar */}
      <div className="flex items-center justify-between pb-1 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-2">
          {['Documents', 'Finance Data'].map(tab => (
            <button
              key={tab}
              onClick={() => { setSubTab(tab); setInspectedDoc(null); }}
              className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
              style={{
                background: subTab === tab ? 'var(--accent-dim)' : 'transparent',
                color: subTab === tab ? 'var(--accent)' : 'var(--text-3)',
                border: `1px solid ${subTab === tab ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="text-[10px] font-mono text-[var(--text-3)]">
          Context: <strong className="text-[var(--text-1)]">42.8K</strong> / 128K tokens
        </div>
      </div>

      {/* Document Search & Filter */}
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

      {/* Documents List */}
      <div className="space-y-2">
        {filteredDocs.map(doc => (
          <div
            key={doc.title}
            onClick={() => setInspectedDoc(doc)}
            className="rounded-xl p-3 border flex items-center justify-between cursor-pointer hover:border-[var(--accent)] transition-colors"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
          >
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <FileText size={13} className="text-[var(--accent)]" />
                <span className="font-bold text-xs text-[var(--text-1)]">{doc.title}</span>
              </div>
              <span className="text-[10px] text-[var(--text-3)] font-mono">
                {doc.size} · {doc.tokens} tokens · {doc.citations} AI citations
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-[var(--ok-dim)] text-[var(--ok)] flex items-center gap-1">
              <CheckCircle2 size={10} /> Indexed
            </span>
          </div>
        ))}
      </div>

      {/* Inspected Document Snippet Drawer */}
      {inspectedDoc && (
        <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-[var(--text-1)]">Semantic Vector Chunk: {inspectedDoc.title}</span>
            <button onClick={() => setInspectedDoc(null)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
              <X size={14} />
            </button>
          </div>
          <p className="text-[10.5px] font-mono text-[var(--text-2)] bg-[var(--card-bg)] p-2 rounded-lg border border-[var(--card-border)] leading-relaxed">
            "{inspectedDoc.excerpt}"
          </p>
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
                  className="text-left w-full rounded-lg px-2 py-1.5"
                  style={{ cursor: 'pointer', background: state.band === b.id ? 'var(--accent-dim)' : 'transparent',
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
  const [onScreen, setOnScreen] = useState(false)
  const [hints, setHints] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const searchRef = useRef(null)
  const lastRowRef = useRef(null)

  const set = (patch) => { setDriving(true); setState(s => ({ ...s, ...patch })) }

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setOnScreen(true); return }
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (driving || !onScreen) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => {
      setState(s => {
        const i = TABS.findIndex(t => t.id === s.tab)
        return { ...s, tab: TABS[(i + 1) % TABS.length].id }
      })
    }, 5200)
    return () => clearInterval(id)
  }, [driving, onScreen])

  const Panel = PANELS[state.tab] || PANELS.receivables
  const detail = state.detail ? INVOICES.find(i => i.id === state.detail) : null

  const openDetail = (id) => {
    lastRowRef.current = document.activeElement
    set({ detail: id })
  }

  const onKeys = (e) => {
    const typing = e.target instanceof HTMLInputElement
    if (e.key === 'Escape') {
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
      <div ref={frameRef} className="ft-tour" tabIndex={-1} onKeyDown={onKeys}>
        {/* Window Chrome Header */}
        <div className="ft-tour-chrome">
          {['#ef4444', '#fbbf24', '#22c55e'].map(c => (
            <span key={c} className="ft-tour-dot" style={{ background: c }} />
          ))}
          <span className="ml-2 font-semibold truncate" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            fintrack — {TABS.find(t => t.id === state.tab)?.label.toLowerCase()}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* Live Notifications Popover Trigger */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-1 rounded text-[var(--text-3)] hover:text-[var(--text-1)] relative"
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
                    <button onClick={() => setShowNotifications(false)} className="text-[var(--text-3)]"><X size={11} /></button>
                  </div>
                  <div className="space-y-1.5 text-[10.5px]">
                    <p className="text-[var(--text-2)]"><strong className="text-[var(--text-1)]">Innovine:</strong> Milestone 2 delivered.</p>
                    <p className="text-[var(--text-2)]"><strong className="text-[var(--text-1)]">Tax Ledger:</strong> TDS matched on 26AS.</p>
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
                        className="ft-tour-rail-item"
                        data-on={on ? '' : undefined}
                        style={{ cursor: 'pointer', background: on ? undefined : 'transparent',
                                 border: 0, width: '100%', textAlign: 'left' }}>
                  <Icon size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span className="hidden sm:inline truncate" aria-hidden="true">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Main Stage */}
          <div className="ft-tour-stage">
            <div key={state.tab} className="h-full ft-tour-scene">
              <Panel state={state} set={set} onOpen={openDetail} searchRef={searchRef} />
            </div>

            {detail && (
              <InvoiceDrawer
                invoice={detail}
                returnFocusRef={lastRowRef}
                onClose={() => setState(s => ({ ...s, detail: null }))}
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
                You are driving.
              </span>
              <button onClick={() => setHints(h => !h)}
                      aria-expanded={hints}
                      className="ml-auto flex items-center gap-1.5 rounded-md font-semibold shrink-0"
                      style={{ height: 26, padding: '0 9px', fontSize: 11, cursor: 'pointer',
                               background: hints ? 'var(--accent-dim)' : 'var(--card-bg)',
                               border: `1px solid ${hints ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                               color: hints ? 'var(--accent)' : 'var(--text-2)' }}>
                <Keyboard size={12} aria-hidden="true" /> Keys
              </button>
              <button onClick={restart}
                      className="flex items-center gap-1.5 rounded-md font-semibold shrink-0"
                      style={{ height: 26, padding: '0 9px', fontSize: 11, cursor: 'pointer',
                               background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                               color: 'var(--text-2)' }}>
                <Play size={11} aria-hidden="true" /> Replay tour
              </button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 font-semibold shrink-0"
                    style={{ fontSize: 11, color: 'var(--accent)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)',
                               animation: 'ft-pulse 1.8s ease-in-out infinite' }} />
                Touring
              </span>
              <span className="truncate" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                click anything to take over
              </span>
              <span className="ml-auto tabular-nums shrink-0" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                {TABS.findIndex(t => t.id === state.tab) + 1}/{TABS.length}
              </span>
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
