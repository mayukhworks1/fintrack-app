/**
 * The cost tracker template: its pure logic (CSV parsing, FY totals,
 * recurrence, the forecast, aging), booted the way the template boot test
 * boots every template, and the owner-only first-run seed from the status CSV.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ARTIFACT_TEMPLATES } from '../components/artifacts/templates'
import { DATA_SDK } from './artifactSdkSource'

const T = ARTIFACT_TEMPLATES.find(t => t.id === 'cost-tracker')
const STATUS_CSV = readFileSync(resolve(process.cwd(), 'src/test/fixtures/current-status.csv'), 'utf8')
const TODAY = '2026-11-16'

function boot(db) {
  const doc = new DOMParser().parseFromString(T.html, 'text/html')
  const script = doc.querySelector('script').textContent
  doc.querySelectorAll('script').forEach(s => s.remove())
  document.body.innerHTML = doc.body.innerHTML
  delete window.fintrack
  delete window.CostTrackerCore
  if (db) window.fintrack = { db }
  else new Function(DATA_SDK)()
  new Function(script)()
  return window.CostTrackerCore
}

// A small in-memory db with the SDK's shape, to see what the template writes.
function fakeDb({ owner, canAdd = true, projects = [] } = {}) {
  const writes = []
  const subs = {}
  const store = { projects: projects.map((d, i) => ({ id: `p${i}`, data: d })), invoices: [], costs: [] }
  const collection = (name) => ({
    subscribe(cb) { (subs[name] = subs[name] || []).push(cb); setTimeout(() => cb(store[name] || []), 0); return () => {} },
    upsert(key, data) { writes.push([name, key, data]); return Promise.resolve({ id: key, data }) },
    add(data) { writes.push([name, null, data]); return Promise.resolve({ id: 'x', data }) },
    update() { return Promise.resolve({}) },
    remove() { return Promise.resolve() },
  })
  return {
    writes,
    collection,
    doc: () => ({
      subscribe(cb) { setTimeout(() => cb(null), 0); return () => {} },
      set(d) { writes.push(['settings', null, d]); return Promise.resolve(d) },
      update() { return Promise.resolve({}) },
    }),
    me: () => Promise.resolve({ id: 'u', isOwner: owner, canAdd }),
    onStatus(cb) { cb('synced') },
  }
}

const settle = () => new Promise(r => setTimeout(r, 30))
let C

beforeAll(() => {
  window.matchMedia = window.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  C = boot()
})
afterEach(() => { document.body.innerHTML = '' })

describe('Cost tracker: CSV', () => {
  it('parses the status CSV: BOM, quoted commas, ** marks, all seven projects', () => {
    const { headers, rows } = C.csvObjects(STATUS_CSV)
    expect(headers[0]).toBe('Client')
    expect(C.csvKind(headers)).toBe('status')
    const projects = C.statusImport(rows)
    expect(projects).toHaveLength(7)
    expect(projects.map(p => p.client)).toEqual(['Birla Open Minds', 'Birla Open Minds', 'The Works (Inhouse)', 'The Works (Inhouse)', 'Birla Open Minds', 'Jacarti', 'The Works (Inhouse)'])
    const crm = projects[4]
    expect(crm.detail).toContain('A ₹20,000 implementation advance has been agreed')
    expect(crm.detail).not.toContain('**')
    expect(projects[2].guessType).toBe('non-billable')
    expect(projects[2].guessPaused).toBe(true)
    // The import keys match the seed, so re-importing updates instead of duplicating.
    expect(projects.map(p => p.key).sort()).toEqual(C.SEED.projects.map(p => p.key).sort())
  })

  it('reads a generic costs CSV and round-trips through export quoting', () => {
    const csv = 'Date,Project,Category,Amount,Recurring,Status,Notes\n05/11/2026,Innovine,Hosting,"₹1,200",yes,paid,"VPS, monthly"\n,,,,,,\n2026-12-01,Unknown thing,AI credits,1.5 L,no,planned,\n'
    const parsed = C.csvObjects(csv)
    expect(C.csvKind(parsed.headers)).toBe('costs')
    const { costs, skipped } = C.costImport(parsed.rows, [{ key: 'birla-open-minds--innovine', name: 'Innovine' }])
    expect(skipped).toBe(0)
    expect(costs[0]).toMatchObject({ date: '2026-11-05', projectKey: 'birla-open-minds--innovine', category: 'Hosting', amount: 1200, recurring: true, status: 'paid', notes: 'VPS, monthly' })
    expect(costs[1]).toMatchObject({ amount: 150000, status: 'planned', projectKey: '', notes: 'Project: Unknown thing' })
    const out = C.toCSV([['a', 'b,c', 'say "hi"']])
    expect(out).toBe('a,"b,c","say ""hi"""\r\n')
    expect(C.parseCSV(out)).toEqual([['a', 'b,c', 'say "hi"']])
  })

  it('reads Indian amounts and dates, and leaves blanks empty', () => {
    expect(C.parseAmount('₹40,000')).toBe(40000)
    expect(C.parseAmount('Rs. 1,20,000')).toBe(120000)
    expect(C.parseAmount('2.5 Cr')).toBe(25000000)
    expect(C.parseAmount('(2,000)')).toBe(-2000)
    expect(C.parseAmount('')).toBeNull()
    expect(C.parseAmount('tbd')).toBeNull()
    expect(C.parseDate('15 September 2026')).toBe('2026-09-15')
    expect(C.parseDate('05/10/2026')).toBe('2026-10-05')
    expect(C.parseDate('31/02/2026')).toBeNull()
    expect(C.fmtDate('2026-09-15')).toBe('15 Sep 2026')
  })
})

describe('Cost tracker: money over time', () => {
  const seed = () => ({ projects: C.SEED.projects.map(C.project), invoices: C.SEED.invoices.map(C.invoice), costs: C.SEED.costs.map(C.cost) })

  it('knows the April–March financial year', () => {
    expect(C.fyStart('2026-11-16')).toBe(2026)
    expect(C.fyStart('2027-03-31')).toBe(2026)
    expect(C.fyStart('2027-04-01')).toBe(2027)
    expect(C.fyLabel(2026)).toBe('FY 2026–27')
    expect(C.fyMonths(2026)[0]).toBe('2026-04')
    expect(C.fyMonths(2026)[11]).toBe('2027-03')
  })

  it('projects recurring costs forward month by month until their end', () => {
    const costs = [
      { amount: 1000, date: '2026-10-10', recurring: true, status: 'paid', category: 'Hosting' },
      { amount: 500, date: '2026-11-02', recurring: true, until: '2027-01', status: 'paid', category: 'Tools & subscriptions' },
      { amount: 9000, date: '2026-12-01', recurring: false, status: 'planned', category: 'Contractor' },
    ]
    const m = C.monthlyCosts(costs, ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'], '2026-11')
    expect(m['2026-09'].total).toBe(0)
    expect(m['2026-10']).toMatchObject({ actual: 1000, planned: 0 })
    expect(m['2026-11']).toMatchObject({ actual: 1500, total: 1500 })
    expect(m['2026-12']).toMatchObject({ planned: 10500, actual: 0 })
    expect(m['2027-02'].total).toBe(1000)
  })

  it('seeded FY totals: only known amounts count, the rest is flagged', () => {
    const tot = C.fyTotals(seed(), 2026, TODAY, 30)
    expect(tot.billed).toBe(40000)           // the ₹40,000 deployment; other invoices have no amount yet
    expect(tot.received).toBe(0)
    expect(tot.outstanding).toBe(40000)
    expect(tot.costs.total).toBe(0)
    expect(tot.mrr).toBe(0)
    expect(tot.mrrMissing).toBe(1)           // Innovine's retainer amount
    expect(tot.missingInvoices).toBe(7)
    expect(tot.missingCosts).toBe(3)
    expect(tot.marginPct).toBe(1)
  })

  it('PMS final invoice is 62 days overdue on 16 Nov 2026 and sits in 61–90', () => {
    const d = seed()
    const pms = d.invoices.find(i => i.label === 'Final invoice')
    expect(C.daysOverdue(pms, TODAY, 30)).toBe(62)
    const aging = C.aging(d.invoices, TODAY, 30)
    expect(aging.find(b => b.key === '61-90')).toMatchObject({ count: 1, missing: 1, amount: 0 })
    const stats = C.projectStats(d.projects[0], d.invoices, d.costs, TODAY, 30)
    expect(stats.flags).toEqual(expect.arrayContaining(['overdue', 'paused', 'need']))
    expect(stats.maxDays).toBe(62)
  })

  it('retainers bill in advance after the last invoiced month', () => {
    const p = C.project({ key: 'k', type: 'retainer', retainerStart: '2026-10', retainerMonthly: 50000, billingDay: 5 })
    const invoices = [C.invoice({ projectKey: 'k', kind: 'retainer', date: '2026-11-05', status: 'sent' })]
    const r = C.retainerProjection(p, invoices, '2026-11', '2027-02')
    expect(r.map(x => x.ym)).toEqual(['2026-12', '2027-01', '2027-02'])
    expect(r[0]).toMatchObject({ amount: 50000, date: '2026-12-05' })
    expect(C.retainerProjection({ ...p, paused: true }, invoices, '2026-11', '2027-02')).toEqual([])
  })

  it('forecast: expected vs conservative collections, recurring costs, cash balance and budget', () => {
    const data = {
      projects: [C.project({ key: 'r', type: 'retainer', retainerStart: '2026-11', retainerMonthly: 50000, billingDay: 5 })],
      invoices: [
        C.invoice({ projectKey: 'r', kind: 'retainer', date: '2026-11-05', amount: 50000, status: 'sent' }),
        C.invoice({ projectKey: 'x', date: '2026-07-01', due: '2026-07-01', amount: 30000, status: 'sent' }),
        C.invoice({ projectKey: 'x', date: '2027-01-10', amount: 80000, status: 'planned' }),
        C.invoice({ projectKey: 'x', date: '', amount: 20000, status: 'planned' }),
      ],
      costs: [C.cost({ date: '2026-11-01', amount: 10000, recurring: true, status: 'paid', category: 'Team hours' })],
    }
    const exp = C.forecast(data, { today: TODAY, months: 12, scenario: 'expected', termsDays: 30, openingCash: 100000, monthlyBudget: 12000 })
    const nov = exp.rows[0], dec = exp.rows[1], feb = exp.rows[3]
    expect(nov.ym).toBe('2026-11')
    expect(nov.invoices).toBe(30000)            // the overdue one, expected this month
    expect(dec.invoices).toBe(50000)            // Nov retainer invoice due 5 Dec
    expect(dec.retainers).toBe(0)               // Dec bill (5 Dec) is collected 30 days later, in Jan
    expect(exp.rows[2].retainers).toBe(50000)
    expect(feb.invoices).toBe(80000)            // planned 10 Jan + 30 days
    expect(nov.outflow).toBe(10000)
    expect(exp.rows[11].outflow).toBe(10000)    // recurring all year
    expect(nov.balance).toBe(100000 + 30000 - 10000)
    expect(nov.variance).toBe(2000)
    expect(exp.missing.dates).toBe(1)           // the undated planned invoice
    const con = C.forecast(data, { today: TODAY, months: 12, scenario: 'conservative', delayMonths: 2, termsDays: 30, openingCash: 100000 })
    expect(con.rows[0].invoices).toBe(0)
    expect(con.missing.atRiskCount).toBe(1)     // > 90 days overdue is left out
    expect(con.rows[3].invoices).toBe(50000)    // Dec collection two months later
    expect(con.totals.inflow).toBeLessThan(exp.totals.inflow)
  })
})

describe('Cost tracker: first run', () => {
  it('the owner seeds the seven projects (with only the stated amounts) when the data is empty', async () => {
    const db = fakeDb({ owner: true })
    boot(db)
    await settle()
    const projects = db.writes.filter(w => w[0] === 'projects')
    expect(projects).toHaveLength(7)
    const inv = db.writes.filter(w => w[0] === 'invoices').map(w => w[2])
    expect(inv.find(i => i.label === 'One-time deployment').amount).toBe(40000)
    expect(inv.find(i => i.label === 'Implementation advance').amount).toBe(20000)
    expect(inv.filter(i => i.amount != null)).toHaveLength(2)
    const bigin = projects.map(w => w[2]).find(p => p.name === 'ZOHO BIGIN')
    expect(bigin.licenceCount).toBe(3)
    expect(bigin.licencePrice).toBeUndefined()
    expect(db.writes.find(w => w[0] === 'settings')[2].seeded).toBe(true)
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('a visitor who may not add data never seeds', async () => {
    const db = fakeDb({ owner: false, canAdd: false })
    boot(db)
    await settle()
    expect(db.writes).toEqual([])
  })

  it('a visitor who may add data seeds an empty tracker, by fixed keys', async () => {
    const db = fakeDb({ owner: false, canAdd: true })
    boot(db)
    await settle()
    const projects = db.writes.filter(([c]) => c === 'projects')
    expect(projects.length).toBe(7)
    expect(projects.every(([, key]) => typeof key === 'string' && key)).toBe(true)
  })

  it('existing data is never overwritten by the seed', async () => {
    const db = fakeDb({ owner: true, projects: [{ key: 'a--b', client: 'A', name: 'B' }] })
    boot(db)
    await settle()
    expect(db.writes).toEqual([])
  })
})
