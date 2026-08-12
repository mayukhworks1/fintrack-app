import { describe, it, expect } from 'vitest'

// Mirrors the currencyTotals reducer in WebInvoices.jsx
function currencyTotals(records) {
  const by = new Map()
  for (const r of records) {
    const f = r.fields || {}
    const cur = f['Currency'] || 'RS'
    const t = by.get(cur) || { currency: cur, count: 0, raised: 0, withTax: 0, received: 0, outstanding: 0 }
    t.count += 1
    t.raised += Number(f['Amount Raised'] || 0)
    t.withTax += Number(f['Amount with Tax'] || 0)
    t.received += Number(f['Amount Received'] || 0)
    t.outstanding += Math.max(0, Number(f['Outstanding Amount'] || 0))
    by.set(cur, t)
  }
  return [...by.values()].sort((a, b) => b.count - a.count)
}

describe('web invoice totals are currency-aware', () => {
  it('keeps a single-currency view as one line', () => {
    const t = currencyTotals([
      { fields: { 'Currency':'RS', 'Amount Raised':100, 'Amount Received':50 } },
      { fields: { 'Currency':'RS', 'Amount Raised':200, 'Amount Received':0 } },
    ])
    expect(t).toHaveLength(1)
    expect(t[0].currency).toBe('RS')
    expect(t[0].raised).toBe(300)
  })

  it('never adds rupees to dollars — the bug in the old footer', () => {
    const t = currencyTotals([
      { fields: { 'Currency':'RS',  'Amount Raised':100000 } },
      { fields: { 'Currency':'USD', 'Amount Raised':1000 } },
    ])
    expect(t).toHaveLength(2)
    const rs  = t.find(x => x.currency === 'RS')
    const usd = t.find(x => x.currency === 'USD')
    expect(rs.raised).toBe(100000)
    expect(usd.raised).toBe(1000)
    // the old code produced a single 101000 labelled as rupees
    expect(t.some(x => x.raised === 101000)).toBe(false)
  })

  it('defaults a missing Currency to RS rather than a separate bucket', () => {
    const t = currencyTotals([
      { fields: { 'Amount Raised':10 } },
      { fields: { 'Currency':'RS', 'Amount Raised':5 } },
    ])
    expect(t).toHaveLength(1)
    expect(t[0].raised).toBe(15)
  })

  it('orders by record count so the dominant currency leads', () => {
    const t = currencyTotals([
      { fields: { 'Currency':'USD', 'Amount Raised':1 } },
      { fields: { 'Currency':'RS',  'Amount Raised':1 } },
      { fields: { 'Currency':'RS',  'Amount Raised':1 } },
    ])
    expect(t[0].currency).toBe('RS')
  })

  it('clamps negative outstanding, matching the em dash in the cell', () => {
    const t = currencyTotals([
      { fields: { 'Currency':'RS', 'Outstanding Amount':500 } },
      { fields: { 'Currency':'RS', 'Outstanding Amount':-200 } },
    ])
    expect(t[0].outstanding).toBe(500)
  })

  it('handles null/empty/string amounts and an empty view', () => {
    expect(currencyTotals([])).toEqual([])
    const t = currencyTotals([{ fields: { 'Currency':'RS', 'Amount Raised':'160000' } }, { fields: { 'Currency':'RS', 'Amount Raised':null } }])
    expect(t[0].raised).toBe(160000)
  })
})
