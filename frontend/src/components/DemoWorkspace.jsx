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
  Download, CheckSquare, Square,
} from 'lucide-react'
import {
  INVOICES, AGEING, PROJECT_ROLLUP, TOTALS, QUESTIONS, BANDS,
  ask, bandOf, monthly, inr, inrShort, shortDate, GST_RATE, TDS_RATE,
  DELIVERY, LANES, boardBy,
} from './demoData'

export const TABS = [
  { id: 'receivables', label: 'Receivables', icon: Receipt },
  { id: 'ageing',      label: 'Ageing',      icon: Timer },
  { id: 'delivery',    label: 'Delivery',    icon: KanbanSquare },
  { id: 'projects',    label: 'Projects',    icon: FolderKanban },
  { id: 'analytics',   label: 'Analytics',   icon: BarChart3 },
  { id: 'analyst',     label: 'AI analyst',  icon: Sparkles },
]

const TONE = {
  Paid:    { fg: 'var(--ok)',  bg: 'var(--ok-dim)' },
  Sent:    { fg: 'var(--accent)', bg: 'var(--accent-dim)' },
  Overdue: { fg: 'var(--bad)', bg: 'var(--bad-dim)' },
}

// Monotone in lightness with adjacent steps far enough apart to separate,
// and the lightest step still readable against the card.
const RAMP = ['#104281', '#256abf', '#3987e5', '#86b6ef']

/* ── Shared bits ─────────────────────────────────────────────────────── */

/**
 * One figure. A label-left, figure-right row on a phone and a stacked tile
 * from 560px up — see .ft-kpi. Three stacked tiles simply do not fit 390px,
 * and the label is the half that must survive.
 */
function Stat({ label, value, tone = 'var(--text-1)', sub }) {
  return (
    <div className="ft-kpi min-w-0">
      <span className="k">{label}</span>
      <span className="v" style={{ color: tone }}>{value}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  )
}

function Badge({ status }) {
  const t = TONE[status]
  return (
    <span className="rounded-md font-bold shrink-0"
          style={{ fontSize: 10, padding: '2px 7px', color: t.fg, background: t.bg }}>
      {status}
    </span>
  )
}

/* ── Invoice detail ──────────────────────────────────────────────────── */

const KBD = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 9.5, padding: '1px 5px', borderRadius: 4,
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  color: 'var(--text-2)',
}

/**
 * One invoice, opened.
 *
 * This is where the product's least intuitive claim gets shown instead of
 * argued: an invoice carries three different amounts and only one of them is
 * money a client still owes you. The line runs billed → GST added → what was
 * invoiced → TDS withheld by the client → what actually lands, with the
 * receivable marked against the pre-tax figure. Most receivables reports put
 * the tax in the outstanding column, which overstates collectable cash and
 * buries the invoices that are genuinely late.
 *
 * A real dialog: it takes focus on open, Escape closes it, and focus returns
 * to the row that opened it. A drawer you cannot leave by keyboard is a trap.
 */
function InvoiceDrawer({ invoice, onClose, returnFocusRef }) {
  const panelRef = useRef(null)
  const [tdsRate, setTdsRate] = useState(TDS_RATE)
  const [showAiReminder, setShowAiReminder] = useState(false)
  const [reminderCopied, setReminderCopied] = useState(false)
  const [showEInvoice, setShowEInvoice] = useState(false)

  useEffect(() => {
    const node = panelRef.current
    node?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    node?.addEventListener('keydown', onKey)
    return () => {
      node?.removeEventListener('keydown', onKey)
      // Focus goes back to the row, keeping the reading position. Without
      // this it falls to the document and the next Tab restarts from the top.
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
    { k: `GST @ ${Math.round(GST_RATE * 100)}%`, v: `+ ${inr(calculatedGst)}`, note: "collected for the state" },
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
          <p className="font-bold truncate" style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
            {invoice.client}
          </p>
          <p className="truncate" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {invoice.id} · {invoice.project} · {invoice.category}
          </p>
        </div>
        <Badge status={invoice.status} />
        <button onClick={onClose} aria-label="Close invoice detail"
                className="flex items-center justify-center rounded-md shrink-0"
                style={{ width: 26, height: 26, cursor: 'pointer',
                         background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                         color: 'var(--text-2)' }}>
          <X size={13} aria-hidden="true" />
        </button>
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
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => {
              setShowAiReminder(!showAiReminder)
              setShowEInvoice(false)
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: showAiReminder ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showAiReminder ? 'var(--accent)' : 'var(--card-border)'}`,
              color: showAiReminder ? 'var(--accent)' : 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <Sparkles size={12} />
            AI Payment Follow-up
          </button>
          <button
            onClick={() => {
              setShowEInvoice(!showEInvoice)
              setShowAiReminder(false)
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: showEInvoice ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showEInvoice ? 'var(--accent)' : 'var(--card-border)'}`,
              color: showEInvoice ? 'var(--accent)' : 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            <FileText size={12} />
            GST IRN Verification
          </button>
        </div>

        {/* AI Reminder Preview Box */}
        {showAiReminder && (
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--accent-soft)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>
                AI Follow-up Draft
              </span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`Subject: Payment Follow-up: Invoice ${invoice.id} (${invoice.client})\n\nDear ${invoice.client} Finance Team,\n\nWe would like to gently follow up on Invoice ${invoice.id} for ${inr(received)} (Net after ${Math.round(tdsRate * 100)}% TDS), which was due on ${shortDate(invoice.dueOn)}.\n\nKindly confirm when remittance is processed.`)
                  setReminderCopied(true)
                  setTimeout(() => setReminderCopied(false), 2000)
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: reminderCopied ? 'var(--ok-dim)' : 'var(--accent)',
                  color: reminderCopied ? 'var(--ok)' : '#fff',
                }}
              >
                {reminderCopied ? <CheckIcon size={10} /> : <Copy size={10} />}
                {reminderCopied ? 'Copied' : 'Copy Email'}
              </button>
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
           style={{ fontSize: 9.5, color: 'var(--text-3)' }}>Timeline</p>
        <div className="flex flex-col gap-1">
          {[
            ['Raised', shortDate(invoice.raisedOn), null],
            ['Due', shortDate(invoice.dueOn),
              invoice.status === 'Overdue' ? `${invoice.daysOverdue} days ago` : null],
            invoice.paidOn
              ? ['Paid', shortDate(invoice.paidOn), `${invoice.daysToCollect} days to collect`]
              : ['Ageing band', band ? band.label : '—',
                 invoice.status === 'Overdue' ? 'counts as past due' : 'still within terms'],
          ].map(([k, v, note]) => (
            <div key={k} className="flex items-baseline gap-2">
              <span style={{ fontSize: 11, color: 'var(--text-3)', flex: '0 0 84px' }}>{k}</span>
              <span className="font-semibold tabular-nums"
                    style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{v}</span>
              {note && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{note}</span>}
            </div>
          ))}
        </div>
      </div>

      <p className="px-3 py-2 shrink-0"
         style={{ fontSize: 10.5, color: 'var(--text-3)',
                  borderTop: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
        Press <kbd style={KBD}>Esc</kbd> to go back to the list.
      </p>
    </div>
  )
}


/* ── Receivables ─────────────────────────────────────────────────────── */

const COLUMNS = [
  { key: 'client', label: 'Client',  align: 'left',  grow: '1 1 34%' },
  { key: 'dueOn',  label: 'Due',     align: 'left',  grow: '0 0 64px', hideSm: true },
  { key: 'amount', label: 'Amount',  align: 'right', grow: '0 0 92px' },
]

function Receivables({ state, set, onOpen, searchRef }) {
  const { status, band, query, sort } = state
  const [category, setCategory] = useState('all')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchCopied, setBatchCopied] = useState(false)

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
    let r = INVOICES
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
  }, [status, category, band, query, sort])

  // Recomputed from whatever survived the filters — the point being that the
  // total at the bottom is the rows above it, not a figure kept elsewhere.
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
        r.status
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
        <Stat label="Outstanding" value={inrShort(TOTALS.outstanding)} />
        <Stat label="Collected"   value={inrShort(TOTALS.collected)} tone="var(--ok)" />
        <Stat label="Overdue"     value={inrShort(TOTALS.overdue)}   tone="var(--bad)" />
      </div>

      {/* ── Search & Status Filters ── */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 120 }}>
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
        <div className="flex items-center gap-2 px-3 shrink-0"
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
                  {inr(r.amount)}
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
              <span>{selectedIds.size} selected ({inr(selectedSum)})</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const clientNames = selectedRowsList.map(r => r.client).join(', ')
                  navigator.clipboard?.writeText(`Batch Payment Reminders generated for: ${clientNames} (Total ₹${inr(selectedSum)})`)
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
            {inr(shown)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Ageing ──────────────────────────────────────────────────────────── */

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

/* ── Delivery ─────────────────────────────────────────────────────────────
   The half of the product the public site had been leaving out.

   This is not a finance tool with a projects column bolted on. Delivery state
   lives on the same records the money does, which is why each card can carry
   what that project is owed without anybody joining two systems together on a
   Friday afternoon. In the product the board also updates live over an
   event stream — including when somebody edits the underlying table directly
   rather than through the app — and the lanes are a picklist you extend
   rather than an enum somebody has to ship a release to change. */

const LANE_TONE = {
  'Not started': 'var(--text-3)',
  'In progress': 'var(--accent)',
  'Blocked':     'var(--bad)',
  'In review':   'var(--warn)',
  'Delivered':   'var(--ok)',
}

function Delivery({ state, set }) {
  const { board, card } = state
  const columns = useMemo(() => boardBy(board), [board])
  const open = card ? DELIVERY.find(d => d.id === card) : null

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        {[['lane', 'By status', KanbanSquare], ['client', 'By client', Rows3]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => set({ board: k, card: null })}
                  aria-pressed={board === k}
                  className="flex items-center gap-1.5 rounded-lg font-semibold"
                  style={{ height: 30, padding: '0 10px', fontSize: 11.5, cursor: 'pointer',
                           background: board === k ? 'var(--accent)' : 'var(--card-bg)',
                           border: `1px solid ${board === k ? 'var(--accent)' : 'var(--card-border)'}`,
                           color: board === k ? '#fff' : 'var(--text-2)' }}>
            <Icon size={12} aria-hidden="true" /> {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 shrink-0"
              style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
          <Radio size={11} aria-hidden="true" style={{ color: 'var(--ok)' }} />
          live — updates when anyone edits, app or table
        </span>
      </div>

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
                {col.cards.map(d => (
                  <button key={d.id} onClick={() => set({ card: d.id })}
                          aria-label={`${d.project} for ${d.client} — ${d.lane}. Open the status note.`}
                          className="ft-card text-left rounded-lg p-2"
                          style={{ background: 'var(--card-bg)', cursor: 'pointer',
                                   border: `1px solid ${card === d.id ? 'var(--accent)' : 'var(--card-border)'}` }}>
                    <span className="block font-bold truncate"
                          style={{ fontSize: 11, color: 'var(--text-1)' }}>{d.project}</span>
                    <span className="block truncate mb-1.5"
                          style={{ fontSize: 9.5, color: 'var(--text-3)' }}>{d.client}</span>
                    <span className="block truncate" style={{ fontSize: 9.5, color: 'var(--text-2)' }}>
                      {d.short}
                    </span>
                    {d.outstanding > 0 && (
                      /* The join. A delivery board that cannot tell you what
                         the project is owed is half an answer. */
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
                ))}
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
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold" style={{ fontSize: 11, color: 'var(--text-1)' }}>
              {open.project}
            </span>
            <span className="rounded font-bold" style={{ fontSize: 8.5, padding: '1px 5px',
                     color: LANE_TONE[open.lane], background: 'var(--bg-input)' }}>
              {open.lane}
            </span>
            <button onClick={() => set({ card: null })} aria-label="Close the status note"
                    className="ml-auto" style={{ background: 'none', border: 0, cursor: 'pointer',
                                                 color: 'var(--text-3)' }}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <p style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{open.detail}</p>
        </div>
      )}
    </div>
  )
}

/* ── Projects ────────────────────────────────────────────────────────── */

function Projects({ state, set }) {
  const [costOffset, setCostOffset] = useState(0)
  const sel = PROJECT_ROLLUP.find(p => p.id === state.project) ?? PROJECT_ROLLUP[0]

  const effectiveCost = Math.round(sel.cost * (1 + costOffset))
  const effectiveProfit = sel.billed - effectiveCost
  const effectiveMargin = sel.billed > 0 ? Math.round((effectiveProfit / sel.billed) * 100) : 0
  const effectiveHealth = effectiveMargin >= 35 ? 'healthy' : effectiveMargin >= 15 ? 'watch' : 'risk'

  return (
    <div className="h-full grid gap-2 min-h-0" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
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

/* ── Analytics ───────────────────────────────────────────────────────── */

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
        <Stat label="Collection rate" value={`${TOTALS.collectionRate}%`} />
        <Stat label="Days to collect" value={TOTALS.avgDaysToCollect} />
        <Stat label="GST tracked"     value={inrShort(TOTALS.gst)} />
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

/* ── The analyst ─────────────────────────────────────────────────────── */

/**
 * Take the query away with you.
 *
 * The claim is that every answer can be checked. Being able to paste the
 * statement into your own client is the practical form of that, and it is two
 * lines — navigator.clipboard, with the confirmation living on the button so
 * nothing has to move to tell you it worked.
 */
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
  const preset = QUESTIONS[state.question]
  const result = useMemo(
    () => ask({ measure: preset.measure, groupBy: preset.groupBy }),
    [preset]
  )
  const [displayedSql, setDisplayedSql] = useState(result.sql)
  const [typing, setTyping] = useState(false)

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

  return (
    <div className="h-full flex flex-col min-h-0">
      <p className="font-semibold mb-2" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
        Ask something. The statement below is what produced the answer below it.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {QUESTIONS.map((q, i) => (
          <button key={q.q} onClick={() => set({ question: i })}
                  aria-pressed={state.question === i}
                  className="rounded-lg font-semibold text-left"
                  style={{
                    minHeight: 30, padding: '5px 10px', fontSize: 11.5, cursor: 'pointer',
                    background: state.question === i ? 'var(--accent)' : 'var(--card-bg)',
                    border: `1px solid ${state.question === i ? 'var(--accent)' : 'var(--card-border)'}`,
                    color: state.question === i ? '#fff' : 'var(--text-2)',
                  }}>
            {q.q}
          </button>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden mb-2.5 shrink-0"
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

const PANELS = {
  receivables: Receivables,
  delivery: Delivery,
  ageing: Ageing,
  projects: Projects,
  analytics: Analytics,
  analyst: Analyst,
}

/* ── The shell ───────────────────────────────────────────────────────── */

const CAPTION = {
  receivables: 'Filter, search and sort. The total at the bottom is whatever survived — it is the rows, not a number kept somewhere else.',
  ageing:      'Bands are predicates, not colours. Pick one and it opens the invoice list already filtered to it.',
  delivery:    'Delivery state on the same records as the money — so a card can tell you what the project is owed without joining two systems together.',
  projects:    'Billed less cost, per project, with the invoices that produced it listed underneath.',
  analytics:   'Move the window and every figure moves with it. One period filter over one set of rows.',
  analyst:     'A question is a measure and a grouping. The model chooses those two; the code writes the SQL and runs it.',
}

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
  // Autoplay stops for good at the first interaction. A demo that keeps
  // advancing under someone's cursor is actively hostile.
  const [driving, setDriving] = useState(false)
  const [onScreen, setOnScreen] = useState(false)
  const [hints, setHints] = useState(false)
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const searchRef = useRef(null)
  // The row that opened the drawer, so focus can go back to it on close.
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

  const Panel = PANELS[state.tab]
  const detail = state.detail ? INVOICES.find(i => i.id === state.detail) : null

  const openDetail = (id) => {
    lastRowRef.current = document.activeElement
    set({ detail: id })
  }

  /**
   * Shortcuts, scoped to the frame.
   *
   * Bound to the sandbox rather than the window: a landing page that
   * swallows "/" while someone is reading it is hostile, and this is a
   * demo inside a document, not an application that owns the keyboard.
   *
   * Events originating in the search box are left alone except for Escape,
   * or typing a project name containing a digit would change module
   * halfway through the word.
   */
  const onKeys = (e) => {
    const typing = e.target instanceof HTMLInputElement
    if (e.key === 'Escape') {
      if (state.detail) { setState(s => ({ ...s, detail: null })); return }
      if (typing) {
        // Focus goes back to the frame, not to the document. Blurring to
        // <body> left every other shortcut dead until something inside the
        // sandbox was clicked again — so the second Escape, the one meant to
        // clear the filters, did nothing at all.
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

    if (e.key >= '1' && e.key <= String(TABS.length)) {
      e.preventDefault()
      set({ tab: TABS[Number(e.key) - 1].id, detail: null })
      return
    }
    if (e.key === '/') {
      e.preventDefault()
      if (state.tab !== 'receivables') set({ tab: 'receivables' })
      // After the panel has swapped, or there is no input yet to focus.
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
      {/* tabIndex -1 so the frame can hold focus without entering the tab
          order itself; the controls inside are what a Tab lands on. */}
      <div ref={frameRef} className="ft-tour" tabIndex={-1} onKeyDown={onKeys}>
        <div className="ft-tour-chrome">
          {['#ef4444', '#fbbf24', '#22c55e'].map(c => (
            <span key={c} className="ft-tour-dot" style={{ background: c }} />
          ))}
          <span className="ml-2 font-semibold truncate" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            fintrack — {TABS.find(t => t.id === state.tab)?.label.toLowerCase()}
          </span>
          <span className="ml-auto rounded font-bold uppercase tracking-[0.14em] shrink-0"
                style={{ fontSize: 8.5, padding: '3px 7px', background: 'var(--card-border)', color: 'var(--text-3)' }}>
            Sample data
          </span>
        </div>

        <div className="ft-tour-body">
          <nav className="ft-tour-rail" aria-label="Sample workspace sections">
            {TABS.map(t => {
              const Icon = t.icon
              const on = state.tab === t.id
              return (
                // The label was rendered twice — once visible above 640px and
                // once sr-only below it — which is display:none in one
                // direction but only *visually* hidden in the other. So on a
                // wide screen a screen reader announced "Ageing Ageing". One
                // label now, named on the button, correct at every width.
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
            ['1 – 5', 'switch module'],
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
