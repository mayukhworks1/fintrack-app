/**
 * The sandbox's arithmetic.
 *
 * The public demo makes one claim, loudly: every screen reads the same rows,
 * so two figures cannot disagree. That claim is falsifiable in about ten
 * seconds by anyone who adds a column up, and a landing page caught lying
 * about its own demo is worse than a landing page with no demo. So the
 * relationships are asserted here rather than trusted.
 *
 * These are not tests of the product's real metrics — those live in the
 * backend suite against Postgres. These cover the invented ledger the public
 * page computes in the browser.
 */
import { describe, it, expect } from 'vitest'
import {
  INVOICES, AGEING, PROJECT_ROLLUP, TOTALS, QUESTIONS, BANDS,
  ask, bandOf, monthly, open, paid, GST_RATE, TDS_RATE, inr,
} from '../components/demoData'

const sum = (rows, pick) => rows.reduce((t, r) => t + pick(r), 0)

describe('the sandbox ledger', () => {
  it('splits every invoice into exactly one of paid or open', () => {
    expect(open.length + paid.length).toBe(INVOICES.length)
    expect(open.some(i => i.status === 'Paid')).toBe(false)
  })

  it('sums the ageing bands to the outstanding total', () => {
    // The headline figure and the chart under it are the same money. If a
    // band predicate ever drops a row, this is where it shows up.
    expect(sum(AGEING, b => b.value)).toBe(TOTALS.outstanding)
    expect(sum(AGEING, b => b.count)).toBe(open.length)
  })

  it('puts each open invoice in exactly one band', () => {
    const ids = AGEING.flatMap(b => b.rows.map(r => r.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(open.length)
  })

  it('bands on days past due, not days since raised', () => {
    // An invoice inside its terms is not late however old it is — the
    // distinction between a collections list and a list of invoices.
    for (const inv of open) {
      const band = BANDS.find(b => b.id === bandOf(inv))
      expect(inv.daysOverdue).toBeGreaterThanOrEqual(band.min)
      expect(inv.daysOverdue).toBeLessThanOrEqual(band.max)
    }
  })

  it('never counts a paid invoice as outstanding', () => {
    expect(TOTALS.outstanding).toBe(sum(open, i => i.amount))
    for (const inv of paid) expect(bandOf(inv)).toBeNull()
  })

  it('keeps TDS out of the receivable', () => {
    // Tax withheld at source is deducted by the client before they pay. It is
    // reported, never added to what a client still owes — the exact bug that
    // was fixed in the real metrics, kept fixed here too.
    expect(TOTALS.tds).toBe(sum(INVOICES, i => Math.round(i.amount * TDS_RATE)))
    expect(TOTALS.outstanding).toBeLessThan(TOTALS.outstanding + TOTALS.tds)
    expect(TOTALS.outstanding).not.toBe(sum(open, i => i.amount + i.tds))
  })

  it('derives GST from the pre-tax amount', () => {
    for (const i of INVOICES) expect(i.gst).toBe(Math.round(i.amount * GST_RATE))
    expect(TOTALS.gst).toBe(sum(INVOICES, i => i.gst))
  })

  it('derives project margin from the invoices that produced it', () => {
    for (const p of PROJECT_ROLLUP) {
      expect(p.billed).toBe(sum(p.rows, i => i.amount))
      expect(p.profit).toBe(p.billed - p.cost)
      expect(p.margin).toBe(Math.round((p.profit / p.billed) * 100))
    }
  })

  it('assigns every invoice to exactly one project', () => {
    const ids = PROJECT_ROLLUP.flatMap(p => p.rows.map(r => r.id))
    expect(new Set(ids).size).toBe(INVOICES.length)
  })

  it('reports a collection rate between 0 and 100', () => {
    expect(TOTALS.collectionRate).toBeGreaterThan(0)
    expect(TOTALS.collectionRate).toBeLessThanOrEqual(100)
    // Every settled invoice took a positive, finite number of days.
    expect(TOTALS.avgDaysToCollect).toBeGreaterThan(0)
    expect(Number.isFinite(TOTALS.avgDaysToCollect)).toBe(true)
  })
})

describe('the analyst', () => {
  it('answers every preset question without throwing', () => {
    for (const q of QUESTIONS) {
      const r = ask({ measure: q.measure, groupBy: q.groupBy })
      expect(r.rows.length).toBeGreaterThan(0)
      expect(r.sql).toMatch(/^SELECT /)
      for (const row of r.rows) expect(Number.isFinite(row.value)).toBe(true)
    }
  })

  it('returns the answer already sorted, so the bars descend', () => {
    for (const q of QUESTIONS) {
      const { rows } = ask({ measure: q.measure, groupBy: q.groupBy })
      const values = rows.map(r => r.value)
      expect([...values].sort((a, b) => b - a)).toEqual(values)
    }
  })

  it('agrees with the table it claims to be querying', () => {
    // The demo's whole point: the answer and the rows are the same rows.
    const { rows } = ask({ measure: 'outstanding', groupBy: 'client', limit: 99 })
    expect(sum(rows, r => r.value)).toBe(TOTALS.outstanding)

    const byProject = ask({ measure: 'collected', groupBy: 'project', limit: 99 })
    expect(sum(byProject.rows, r => r.value)).toBe(TOTALS.collected)
  })

  it('prints a statement that matches the measure and grouping it ran', () => {
    const r = ask({ measure: 'gst', groupBy: 'category' })
    expect(r.sql).toContain('SUM(gst_amount)')
    expect(r.sql).toContain('GROUP BY work_category')
    // Every answer carries its query — the product's claim, enforced.
    expect(r.sql.trim().length).toBeGreaterThan(40)
  })

  it('averages rather than totals where the measure is an average', () => {
    const { rows } = ask({ measure: 'days', groupBy: 'client', limit: 99 })
    // A sum of day-counts would be far larger than any single invoice's age.
    for (const r of rows) expect(r.value).toBeLessThan(400)
  })
})

describe('presentation', () => {
  it('groups rupees the Indian way', () => {
    // 12,34,567 — not 1,234,567, which reads as a different number at a glance.
    expect(inr(1234567)).toBe('₹12,34,567')
  })

  it('returns a full window of months, oldest first', () => {
    for (const n of [3, 6, 12]) {
      const series = monthly(n)
      expect(series).toHaveLength(n)
      for (const m of series) {
        expect(typeof m.key).toBe('string')
        expect(m.billed).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('holds the dates steady relative to today', () => {
    // Offsets, not fixed stamps: an invoice written to read as overdue still
    // reads that way next year.
    expect(INVOICES.some(i => i.status === 'Overdue')).toBe(true)
    expect(INVOICES.some(i => i.status === 'Sent')).toBe(true)
    expect(INVOICES.some(i => i.status === 'Paid')).toBe(true)
  })
})

describe('the ageing screen has something to show', () => {
  // The bug this locks down: the first draft of the ledger left 61–90 and 90+
  // with no rows, so clicking either band — the whole point of that screen —
  // opened a filtered invoice list that was empty. A demo that looks broken
  // when you use it as intended is worse than one that cannot be used.
  it('puts at least two open invoices in every band', () => {
    for (const band of AGEING) {
      expect(band.count, `band ${band.id} is empty`).toBeGreaterThanOrEqual(2)
      expect(band.value).toBeGreaterThan(0)
    }
  })

  it('offers a full year of activity to the 12-month window', () => {
    // Otherwise the widest analytics view is three bars and a lot of nothing.
    const withActivity = monthly(12).filter(m => m.billed > 0 || m.collected > 0)
    expect(withActivity.length).toBeGreaterThanOrEqual(9)
  })

  it('shows invoices in every status, so each filter chip lands somewhere', () => {
    for (const status of ['Overdue', 'Sent', 'Paid']) {
      expect(INVOICES.filter(i => i.status === status).length).toBeGreaterThanOrEqual(2)
    }
  })
})
