/**
 * The sandbox dataset.
 *
 * One invented ledger, and every figure the public demo shows is *computed*
 * from it. That is deliberate and it is the whole point: the product's claim
 * is that a number on a dashboard and a number in a report cannot disagree
 * because they read the same rows. A demo that hardcodes a different total
 * into each panel quietly asserts the opposite, and anyone who adds the
 * columns up finds it out.
 *
 * So: ageing bands sum to outstanding, the tax ledger's net is gross less
 * GST, project margin is billed less cost, and the analyst's answers are run
 * over the same array the table is showing. Change a row here and every
 * surface moves together.
 *
 * Nothing in it is real. The clients are invented, the projects are invented,
 * and no part of this file touches the API — a public page has no workspace
 * to read.
 *
 * Dates are offsets from today rather than fixed stamps, so an invoice that
 * is meant to read as 47 days overdue still reads that way next year.
 */

const DAY = 86400000

/** Midnight today, so band edges do not shift with the clock during a visit. */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const TODAY = startOfToday()

const at = (offsetDays) => new Date(TODAY.getTime() + offsetDays * DAY)

export const GST_RATE = 0.18
/** Section 194J — professional services. Withheld by the client, not owed. */
export const TDS_RATE = 0.10

/* ── Clients ─────────────────────────────────────────────────────────── */
export const CLIENTS = [
  'Ravensbourne Studio',
  'Halcyon Group',
  'Meridian Labs',
  'Orchard & Co',
  'Ashgrove Partners',
  'Bellwether Foods',
]

/* ── Projects ────────────────────────────────────────────────────────────
   `cost` is what the work took to deliver. Billed comes from the invoices,
   so margin is derived rather than stated — a project cannot claim a margin
   its invoices do not support. */
export const PROJECTS = [
  { id: 'p1', name: 'Brand system',    client: 'Ravensbourne Studio', cost: 278000, status: 'Active' },
  { id: 'p2', name: 'Q3 retainer',     client: 'Halcyon Group',       cost: 196000, status: 'Active' },
  { id: 'p3', name: 'Site rebuild',    client: 'Meridian Labs',       cost: 439000, status: 'Active' },
  { id: 'p4', name: 'Packaging',       client: 'Orchard & Co',        cost: 121000, status: 'Delivered' },
  { id: 'p5', name: 'Annual report',   client: 'Ashgrove Partners',   cost: 218000, status: 'Active' },
  { id: 'p6', name: 'Campaign films',  client: 'Bellwether Foods',    cost: 352000, status: 'Active' },
  { id: 'p7', name: 'Design audit',    client: 'Meridian Labs',       cost: 64000,  status: 'Delivered' },
]

/* ── Invoices ────────────────────────────────────────────────────────────
   `amount` is pre-tax, which is the figure the rest of the app treats as the
   receivable. `paid` is days ago, or null for an open invoice. */
/*
 * Offsets are chosen, not sprinkled. Two properties have to hold or the demo
 * reads as broken rather than as data:
 *
 *   Every ageing band has rows in it. The first draft left 61–90 and 90+
 *   empty, so clicking either — the one interaction the ageing screen exists
 *   to offer — opened a filtered list with nothing in it.
 *
 *   Settled invoices reach back about ten months, so the 12-month analytics
 *   window is a chart rather than three bars and a lot of white space.
 *
 * `raised + terms` is the due date; anything still open past it is that many
 * days overdue, which is what puts it in a band. The band each open invoice
 * lands in is noted beside it and asserted in demodata.test.js.
 */
const RAW = [
  // Settled — spread back across the year so the trend has something to draw.
  { n: 2264, p: 'p1', raised: -310, terms: 30, paid: -280, cat: 'Design' },
  { n: 2278, p: 'p2', raised: -265, terms: 15, paid: -252, cat: 'Retainer' },
  { n: 2283, p: 'p2', raised: -218, terms: 15, paid: -205, cat: 'Retainer' },
  { n: 2291, p: 'p3', raised: -186, terms: 45, paid: -148, cat: 'Build' },
  { n: 2301, p: 'p4', raised: -152, terms: 30, paid: -119, cat: 'Design' },
  { n: 2322, p: 'p6', raised: -104, terms: 45, paid: -85,  cat: 'Film' },
  { n: 2336, p: 'p7', raised: -57,  terms: 15, paid: -49,  cat: 'Design' },

  // Open — two or more in every band.
  { n: 2271, p: 'p1', raised: -142, terms: 30, paid: null, cat: 'Design',    amount: 480000 }, // 90+
  { n: 2314, p: 'p5', raised: -133, terms: 30, paid: null, cat: 'Editorial', amount: 232500 }, // 90+
  { n: 2296, p: 'p3', raised: -119, terms: 45, paid: null, cat: 'Build',     amount: 610000 }, // 61–90
  { n: 2308, p: 'p4', raised: -105, terms: 30, paid: null, cat: 'Design',    amount: 195000 }, // 61–90
  { n: 2327, p: 'p6', raised: -96,  terms: 45, paid: null, cat: 'Film',      amount: 415000 }, // 31–60
  { n: 2344, p: 'p3', raised: -85,  terms: 45, paid: null, cat: 'Build',     amount: 286000 }, // 31–60
  { n: 2319, p: 'p5', raised: -42,  terms: 30, paid: null, cat: 'Editorial', amount: 148000 }, // 0–30
  { n: 2340, p: 'p3', raised: -15,  terms: 45, paid: null, cat: 'Build',     amount: 340000 }, // within terms
  { n: 2289, p: 'p2', raised: -8,   terms: 15, paid: null, cat: 'Retainer',  amount: 325000 }, // within terms
  { n: 2331, p: 'p6', raised: -6,   terms: 45, paid: null, cat: 'Film',      amount: 268000 }, // within terms
]

// Paid invoices carry a settled amount; open ones carry the figure above.
const SETTLED = {
  2264: 520000, 2278: 210000, 2283: 210000, 2291: 585000,
  2301: 168000, 2322: 390000, 2336: 96000,
}

export const INVOICES = RAW.map(r => {
  const project = PROJECTS.find(p => p.id === r.p)
  const amount = r.amount ?? SETTLED[r.n]
  const raisedOn = at(r.raised)
  const dueOn = at(r.raised + r.terms)
  const paidOn = r.paid == null ? null : at(r.paid)
  const overdue = !paidOn && dueOn < TODAY
  return {
    id: `INV-${r.n}`,
    client: project.client,
    projectId: project.id,
    project: project.name,
    category: r.cat,
    amount,
    gst: Math.round(amount * GST_RATE),
    tds: Math.round(amount * TDS_RATE),
    raisedOn,
    dueOn,
    paidOn,
    status: paidOn ? 'Paid' : overdue ? 'Overdue' : 'Sent',
    // Only meaningful once settled; used for days-to-collect.
    daysToCollect: paidOn ? Math.round((paidOn - raisedOn) / DAY) : null,
    daysOverdue: overdue ? Math.round((TODAY - dueOn) / DAY) : 0,
  }
})

/* ── Ageing ──────────────────────────────────────────────────────────────
   Bands are on days past due, not days since raised. An invoice inside its
   terms is not late, however old it is — the distinction is the difference
   between a collections list and a list of invoices. */
export const BANDS = [
  { id: '0-30',  label: '0–30 days',  min: 0,  max: 30 },
  { id: '31-60', label: '31–60 days', min: 31, max: 60 },
  { id: '61-90', label: '61–90 days', min: 61, max: 90 },
  { id: '90+',   label: '90+ days',   min: 91, max: Infinity },
]

export const bandOf = (inv) =>
  inv.status === 'Paid' ? null
    : BANDS.find(b => inv.daysOverdue >= b.min && inv.daysOverdue <= b.max)?.id ?? '0-30'

/* ── Aggregates ──────────────────────────────────────────────────────── */
const sum = (rows, pick) => rows.reduce((t, r) => t + pick(r), 0)

export const open = INVOICES.filter(i => i.status !== 'Paid')
export const paid = INVOICES.filter(i => i.status === 'Paid')

export const TOTALS = {
  outstanding: sum(open, i => i.amount),
  collected:   sum(paid, i => i.amount),
  overdue:     sum(INVOICES.filter(i => i.status === 'Overdue'), i => i.amount),
  gst:         sum(INVOICES, i => i.gst),
  // Withheld at source: reported, never counted as money a client still owes.
  tds:         sum(INVOICES, i => i.tds),
  get collectionRate() {
    const billed = this.outstanding + this.collected
    return billed ? Math.round((this.collected / billed) * 100) : 0
  },
  get avgDaysToCollect() {
    const settled = paid.filter(i => i.daysToCollect != null)
    return settled.length ? Math.round(sum(settled, i => i.daysToCollect) / settled.length) : 0
  },
}

export const AGEING = BANDS.map(b => {
  const rows = open.filter(i => bandOf(i) === b.id)
  return { ...b, rows, value: sum(rows, i => i.amount), count: rows.length }
})

export const PROJECT_ROLLUP = PROJECTS.map(p => {
  const rows = INVOICES.filter(i => i.projectId === p.id)
  const billed = sum(rows, i => i.amount)
  const profit = billed - p.cost
  const margin = billed ? Math.round((profit / billed) * 100) : 0
  return {
    ...p, rows, billed, profit, margin,
    // The threshold the app itself uses to flag a job worth looking at.
    health: margin < 10 ? 'risk' : margin < 25 ? 'watch' : 'healthy',
  }
}).sort((a, b) => b.billed - a.billed)

/** Monthly series, oldest first, over the window the caller asks for. */
export function monthly(months = 6) {
  const out = []
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - k, 1)
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const inWindow = (t) => t && t >= d && t < next
    const raised = INVOICES.filter(i => inWindow(i.raisedOn))
    const settled = INVOICES.filter(i => inWindow(i.paidOn))
    out.push({
      key: d.toLocaleDateString('en-IN', { month: 'short' }),
      billed: sum(raised, i => i.amount),
      gst: sum(raised, i => i.gst),
      collected: sum(settled, i => i.amount),
    })
  }
  return out
}

/* ── Formatting ──────────────────────────────────────────────────────────
   Indian grouping — 12,34,567 rather than 1,234,567. The app is used in
   rupees and a western grouping reads as a different number at a glance. */
export const inr = (n) =>
  '₹' + Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })

/** Compact, for tiles where the full figure will not fit. */
export const inrShort = (n) => {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (Math.abs(n) >= 1e3) return `₹${Math.round(n / 1e3)}K`
  return inr(n)
}

export const shortDate = (d) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'

/* ── The analyst ─────────────────────────────────────────────────────────
   A question is a measure and a grouping, nothing more. The model's job in
   the real product is to choose those two; the code writes the statement and
   runs it. That is why the demo can show the SQL next to the answer and have
   them agree — the same selection produces both. */
export const MEASURES = {
  outstanding: {
    label: 'Outstanding',
    sql: 'SUM(amount_raised)',
    where: "payment_status IS DISTINCT FROM 'Paid'\n   AND payment_status IS DISTINCT FROM 'Cancelled'",
    rows: () => open,
    pick: (i) => i.amount,
    fmt: inr,
  },
  collected: {
    label: 'Collected',
    sql: 'SUM(amount_received)',
    where: "payment_status = 'Paid'",
    rows: () => paid,
    pick: (i) => i.amount,
    fmt: inr,
  },
  gst: {
    label: 'GST',
    sql: 'SUM(gst_amount)',
    where: 'deleted_at IS NULL',
    rows: () => INVOICES,
    pick: (i) => i.gst,
    fmt: inr,
  },
  days: {
    label: 'Average days to collect',
    sql: 'AVG(paid_on - raised_on)',
    where: "payment_status = 'Paid'",
    rows: () => paid.filter(i => i.daysToCollect != null),
    pick: (i) => i.daysToCollect,
    average: true,
    fmt: (n) => `${Math.round(n)} days`,
  },
}

export const GROUPINGS = {
  client:   { label: 'client',   column: 'client',           of: (i) => i.client },
  project:  { label: 'project',  column: 'project_name',     of: (i) => i.project },
  category: { label: 'category', column: 'work_category',    of: (i) => i.category },
}

/**
 * Run a question over the ledger.
 *
 * Returns the rows *and* the statement that produced them, because the answer
 * on its own is the thing the product refuses to give you.
 */
export function ask({ measure, groupBy, limit = 5 }) {
  const m = MEASURES[measure]
  const g = GROUPINGS[groupBy]

  const buckets = new Map()
  for (const row of m.rows()) {
    const key = g.of(row)
    const b = buckets.get(key) ?? { key, total: 0, n: 0 }
    b.total += m.pick(row)
    b.n += 1
    buckets.set(key, b)
  }

  const rows = [...buckets.values()]
    .map(b => ({ key: b.key, value: m.average ? b.total / b.n : b.total, n: b.n }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

  const peak = rows.length ? rows[0].value : 1

  const sql =
    `SELECT ${g.column},\n` +
    `       ${m.sql} AS value\n` +
    `  FROM invoices_mirror\n` +
    ` WHERE ${m.where}\n` +
    ` GROUP BY ${g.column}\n` +
    ` ORDER BY value DESC\n` +
    ` LIMIT ${limit}`

  return { rows, sql, peak, format: m.fmt, measureLabel: m.label, groupLabel: g.label }
}

/** The preset questions offered in the sandbox. */
export const QUESTIONS = [
  { q: 'Which clients owe the most right now?',      measure: 'outstanding', groupBy: 'client' },
  { q: 'Who is slowest to pay?',                     measure: 'days',        groupBy: 'client' },
  { q: 'Which projects have collected the most?',    measure: 'collected',   groupBy: 'project' },
  { q: 'How much GST by work category?',             measure: 'gst',         groupBy: 'category' },
]

/* ── Delivery status ─────────────────────────────────────────────────────
   The product is not only a finance tracker, and the public site had been
   describing it as one. Every project also carries a delivery state, a short
   status and a longer note — the same records the money side reads, which is
   the whole point: the board and the receivables list are two views of one
   project, not two systems somebody has to reconcile on a Friday.

   Lanes are the picklist the real board uses. It is extendable in the
   product, so this is a starting set rather than an enum. */
export const LANES = ['Not started', 'In progress', 'Blocked', 'In review', 'Delivered']

const STATUS_NOTES = {
  p1: ['In review', 'Third round with the client',
       'Identity system signed off; applying it across the templates. Waiting on their legal read of the usage terms before we ship the guidelines.'],
  p2: ['In progress', 'August retainer running',
       'Two of four deliverables out. Nothing blocking — next check-in Thursday.'],
  p3: ['Blocked', 'Waiting on their API keys',
       'Front end is done to the staging cut. Cannot integrate payments until their team issues sandbox credentials; chased twice this week.'],
  p4: ['Delivered', 'Shipped and invoiced',
       'Final artwork delivered to the printer. Invoice raised; nothing outstanding on our side.'],
  p5: ['In progress', 'Copy with the editor',
       'Data pulled and charts drafted. Editorial pass runs to the end of the month, design follows.'],
  p6: ['In progress', 'Shooting next week',
       'Scripts approved, crew booked, two locations confirmed. Third location still being negotiated.'],
  p7: ['Delivered', 'Closed out',
       'Audit delivered with the recommendations deck. Client has asked about a follow-on engagement.'],
}

export const DELIVERY = PROJECT_ROLLUP.map(p => {
  const [lane, short, detail] = STATUS_NOTES[p.id]
  const openRows = p.rows.filter(r => r.status !== 'Paid')
  return {
    id: p.id,
    project: p.name,
    client: p.client,
    lane,
    short,
    detail,
    // The join that matters: what this project is owed, on its own card.
    outstanding: openRows.reduce((t, r) => t + r.amount, 0),
    openCount: openRows.length,
    margin: p.margin,
    health: p.health,
  }
})

/** The board, grouped the way the real one groups. */
export const boardBy = (key) => {
  const keys = key === 'lane' ? LANES : [...new Set(DELIVERY.map(d => d[key]))]
  return keys
    .map(name => ({ name, cards: DELIVERY.filter(d => d[key] === name) }))
    .filter(col => col.cards.length > 0 || key === 'lane')
}

/* ── Enriched Institutional Modules Mock Data ──────────────────────────── */

export const TAX_SUMMARY = {
  get taxableValue() { return sum(INVOICES, i => i.amount) },
  get gstCollected() { return sum(INVOICES, i => i.gst) },
  get tdsCollected() { return sum(INVOICES, i => i.tds) },
  get grossInvoiced() { return this.taxableValue + this.gstCollected },
  get netReceivable() { return this.taxableValue + this.gstCollected - this.tdsCollected },
  get openInvoices() { return open.length },
  gstRateAvg: '18% avg',
  tdsRateAvg: '10% avg',
  get cgst() { return Math.round(this.gstCollected / 2) },
  get sgst() { return Math.round(this.gstCollected / 2) },
}

export const TAX_CLIENTS = CLIENTS.map(client => {
  const invs = INVOICES.filter(i => i.client === client)
  const taxable = sum(invs, i => i.amount)
  const gst = sum(invs, i => i.gst)
  const tds = sum(invs, i => i.tds)
  const totalBilled = sum(INVOICES, i => i.amount)
  const share = totalBilled > 0 ? `${Math.round((taxable / totalBilled) * 100)}%` : '0%'
  return {
    client,
    invoices: invs.length,
    taxable,
    gst,
    tds,
    gross: taxable + gst,
    share,
  }
}).filter(c => c.invoices > 0).sort((a, b) => b.taxable - a.taxable)

export const PAGES_MOCK = [
  {
    id: 'p-1',
    title: 'Meridian Client Portal',
    url: '/p/meridian-portal',
    type: 'Html',
    format: 'HTML Portal',
    status: 'Live',
    views: 48,
    created: '24 Aug 2026',
    template: 'Client Portal',
    description: 'Executive milestone approvals, payment gateway embed, and real-time deliverables ledger.',
  },
  {
    id: 'p-2',
    title: 'Halcyon Retainer Calculator',
    url: '/p/retainer-calculator',
    type: 'Widget',
    format: 'Interactive Widget',
    status: 'Live',
    views: 124,
    created: '31 Jul 2026',
    template: 'Retainer Calculator',
    description: 'Dynamic team scope slider, sprint velocity estimator, and blended rate calculator.',
  },
  {
    id: 'p-3',
    title: 'Ashgrove Annual Report Deck',
    url: '/p/ashgrove-deck',
    type: 'Markdown',
    format: 'Markdown Brief',
    status: 'Live',
    views: 186,
    created: '9 Jul 2026',
    template: 'Executive Deck',
    description: 'FY26 audited financial review, P&L breakdown, and revenue growth trajectory.',
  },
  {
    id: 'p-4',
    title: 'Bellwether Delivery Spec',
    url: '/p/bellwether-spec',
    type: 'Html',
    format: 'HTML Portal',
    status: 'Live',
    views: 32,
    created: '14 Jun 2026',
    template: 'Milestone Acceptance',
    description: 'Video campaign sign-off milestones with digital signature capture and invoice triggers.',
  },
]

export const PAGE_TEMPLATES = [
  {
    id: 'tpl-portal',
    title: 'Client Approval & Payment Portal',
    format: 'HTML',
    icon: 'Globe',
    blurb: 'Milestone acceptance gates, live invoice status, and integrated Razorpay settlement link.',
    samplePrompt: 'Create a client review portal for Meridian Labs with sprint sign-offs and payment button',
  },
  {
    id: 'tpl-calculator',
    title: 'Interactive Retainer & Scope Calculator',
    format: 'Widget',
    icon: 'Sliders',
    blurb: 'Real-time pricing sliders, engineering hours estimator, and instant SOW scope builder.',
    samplePrompt: 'Build an interactive retainer calculator with sprint velocity and margin estimation',
  },
  {
    id: 'tpl-brief',
    title: 'Executive Financial Brief & Risk Radar',
    format: 'Markdown',
    icon: 'FileText',
    blurb: 'Structured markdown report with KPI tables, statutory escrow audit, and revenue trends.',
    samplePrompt: 'Draft an executive board brief summarizing Q2 margin leakage and tax compliance',
  },
  {
    id: 'tpl-acceptance',
    title: 'Milestone Acceptance & Sign-off Deck',
    format: 'HTML',
    icon: 'FileCheck',
    blurb: 'Deliverable checklist with cryptographic hash audit and instant billing webhook trigger.',
    samplePrompt: 'Generate a deliverable acceptance spec with digital sign-off and milestone triggers',
  },
]

export const STUDIO_DOCS = [
  {
    id: 'doc-1',
    title: 'FY26 Master Services Agreement — Meridian Labs',
    size: '2.4 MB',
    tokens: 14200,
    citations: 18,
    status: 'Indexed',
    category: 'MSA / Contract',
    uploadedAt: '12 Aug 2026',
    summary: 'Governing agreement for engineering and cloud architecture. Includes 45-day payment terms, 10% TDS withholding under 194J, and IP assignment clauses.',
    excerpt: 'Clause 8.2 (Payment Terms): Client shall remit invoice settlements within 45 calendar days of receipt. All professional fees are subject to 10% TDS deduction under Section 194J of the Indian Income Tax Act. GST at the prevailing 18% statutory rate applies to all invoice line items.',
    ragMatchScore: 98.4,
  },
  {
    id: 'doc-2',
    title: 'Halcyon Group SOW Q2-Q3 Milestone Schedule',
    size: '1.1 MB',
    tokens: 8400,
    citations: 12,
    status: 'Indexed',
    category: 'Statement of Work',
    uploadedAt: '28 Jul 2026',
    summary: 'Milestone deliverables schedule for marketing automation and design retainer. Defines bi-weekly review gates and net-15 payment cycles.',
    excerpt: 'Section 4.1 (Milestone Deliverables): Monthly retainer of ₹3.25L covering sprint cycles Alpha through Delta. Payment due 15 days from milestone sign-off. Delayed deliverables incur zero penalty unless critical path is obstructed.',
    ragMatchScore: 96.1,
  },
  {
    id: 'doc-3',
    title: 'Ravensbourne Studio Service Agreement & SEZ Clause',
    size: '840 KB',
    tokens: 4100,
    citations: 9,
    status: 'Indexed',
    category: 'Legal / Tax',
    uploadedAt: '19 Jun 2026',
    summary: 'Standard service agreement with export/SEZ zero-rating provisions and confidential IP assignment.',
    excerpt: 'Annexure B (Statutory Tax Provisions): Standard 18% GST applies on domestic deliverables. Where client provides valid SEZ Unit authorization or LUT under Section 16 of IGST Act, zero-rated export invoicing shall be applied.',
    ragMatchScore: 94.7,
  },
  {
    id: 'doc-4',
    title: 'Bellwether Foods Campaign SOW & Commercial Terms',
    size: '1.8 MB',
    tokens: 11200,
    citations: 15,
    status: 'Indexed',
    category: 'Production SOW',
    uploadedAt: '04 Sep 2026',
    summary: 'Video campaign production schedule, crew day-rates, licensing terms, and 45-day milestone settlement structure.',
    excerpt: 'Clause 5.3 (Production Invoicing): Pre-production advance (40%) raised upon script lock. Remaining 60% invoiced in two equal milestone tranches upon final color-graded master delivery.',
    ragMatchScore: 92.5,
  },
]

export const STUDIO_RAG_PRESETS = [
  {
    q: 'What are the payment terms and TDS clauses for Meridian Labs?',
    docId: 'doc-1',
    docTitle: 'FY26 MSA — Meridian Labs',
    matchScore: '98.4%',
    answer: 'According to Clause 8.2 of the Meridian Labs MSA, payments are net-45 days from invoice issuance. Professional fees are subject to 10% TDS deduction under Section 194J, with an 18% statutory GST surcharge.',
    citation: 'Clause 8.2 (Payment Terms), Page 6',
  },
  {
    q: 'What is the retainer cadence and review cycle for Halcyon Group?',
    docId: 'doc-2',
    docTitle: 'Halcyon Group SOW Q2-Q3',
    matchScore: '96.1%',
    answer: 'Section 4.1 specifies a monthly retainer of ₹3.25L with net-15 payment terms following bi-weekly sprint milestone sign-offs.',
    citation: 'Section 4.1 (Milestone Deliverables), Page 3',
  },
  {
    q: 'How does the SEZ tax exemption work for Ravensbourne Studio?',
    docId: 'doc-3',
    docTitle: 'Ravensbourne Studio Service Agreement',
    matchScore: '94.7%',
    answer: 'Annexure B allows zero-rated GST invoicing provided a valid SEZ Unit authorization certificate or Letter of Undertaking (LUT) under Section 16 of the IGST Act is on file.',
    citation: 'Annexure B (Statutory Tax Provisions), Page 9',
  },
  {
    q: 'What are the milestone payment tranches for Bellwether Foods?',
    docId: 'doc-4',
    docTitle: 'Bellwether Foods Campaign SOW',
    matchScore: '92.5%',
    answer: 'Clause 5.3 establishes a 40% pre-production advance upon script approval, followed by two 30% milestone tranches upon rough cut and final master delivery.',
    citation: 'Clause 5.3 (Production Invoicing), Page 4',
  },
]

export const AI_CHAT_PRESETS = [
  {
    q: 'What are current outstanding ?',
    get a() {
      const top = [...open].sort((a, b) => b.amount - a.amount)[0]
      return `Outstanding invoices total ${inr(TOTALS.outstanding)} across ${open.length} pending invoices. The largest single receivable is ${top?.id} (${top?.client}) for ${inr(top?.amount)} (${top?.daysOverdue} days overdue).`
    },
    tag: 'Portfolio Q&A',
    model: 'nemotron-3-super-120b-a12b',
    confidence: 'Verified 100%',
  },
  {
    q: 'Check project margins across portfolio',
    get a() {
      const totalBilled = sum(PROJECT_ROLLUP, p => p.billed)
      const totalProfit = sum(PROJECT_ROLLUP, p => p.profit)
      const avgMargin = totalBilled ? Math.round((totalProfit / totalBilled) * 100) : 0
      const topProj = [...PROJECT_ROLLUP].sort((a, b) => b.margin - a.margin)[0]
      return `Overall portfolio margin is ${avgMargin}% across ${inr(totalBilled)} billed. Highest margin project is ${topProj?.name} (${topProj?.client}) at ${topProj?.margin}% margin (${inr(topProj?.profit)} profit).`
    },
    tag: 'Margin Analysis',
    model: 'deterministic-sql-transpiler',
    confidence: 'Exact 100%',
  },
  {
    q: 'Summarize GST liabilities for Q2',
    get a() {
      return `FY26 Q2 taxable turnover is ${inr(sum(INVOICES, i => i.amount))} with ${inr(sum(INVOICES, i => i.gst))} in gross GST collected (CGST ${inr(Math.round(sum(INVOICES, i => i.gst)/2))} + SGST ${inr(Math.round(sum(INVOICES, i => i.gst)/2))}). TDS credit claims total ${inr(sum(INVOICES, i => i.tds))} with Form 26AS matching 100%.`
    },
    tag: 'Tax Compliance',
    model: 'tax-ledger-ast',
    confidence: 'Reconciled',
  },
]

export const REPORT_TEMPLATES = [
  { id: 'board', title: 'Board Pack', blurb: 'Full executive pack across revenue, risk, and delivery.' },
  { id: 'founder', title: 'Founder Weekly', blurb: 'Cash, pressure points, and leadership-ready weekly summary.' },
  { id: 'collections', title: 'Collections', blurb: 'Pending invoices, aging pressure, and receivables follow-up.' },
  { id: 'health', title: 'Project Health', blurb: 'Margin pressure, delivery health, and projects needing review.' },
  { id: 'billing', title: 'Client Billing', blurb: 'Top billed clients and portfolio concentration.' },
]

export const CUSTOM_DASHBOARD_WIDGETS = [
  { id: 'runway', label: 'Safe Runway Forecast', desc: 'Predictive cash runway based on burn rate and collections.', defaultEnabled: true },
  { id: 'escrow', label: 'GST Statutory Escrow', desc: 'Working capital ring-fenced for quarterly GST payouts.', defaultEnabled: true },
  { id: 'recovery', label: 'TDS 26AS Matching', desc: 'Tax withheld credit tracking against Form 26AS filings.', defaultEnabled: true },
  { id: 'velocity', label: 'DSO Collection Velocity', desc: 'Average turnaround days from invoice issue to bank settlement.', defaultEnabled: false },
  { id: 'concentration', label: 'Client Exposure Matrix', desc: 'Revenue concentration index across top 3 client accounts.', defaultEnabled: false },
  { id: 'burn', label: 'Project Delivery Burn', desc: 'Real-time project cost burn vs contract margins.', defaultEnabled: false },
]


