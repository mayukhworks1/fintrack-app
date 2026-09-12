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
