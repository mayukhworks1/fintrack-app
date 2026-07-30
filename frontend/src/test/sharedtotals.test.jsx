import { describe, it, expect } from 'vitest'
import { computeColumnTotals, summableValue, SUMMABLE_COLS } from '../pages/SharedView.jsx'

const INV_COLS = ['Invoice Number','Client Name','Payment Status','Amount Raised','Amount with Tax','Amount Received','Outstanding Amount','Agening (Days)','Raised Date']

// Rows shaped like the shared view in the report
const rows = [
  { fields: { 'Invoice Number':'WM/26-27/168', 'Payment Status':'Pending', 'Amount Raised':160000, 'Amount with Tax':188800, 'Amount Received':0,      'Outstanding Amount':172800 } },
  { fields: { 'Invoice Number':'WM/26-27/102', 'Payment Status':'Paid',    'Amount Raised':160000, 'Amount with Tax':188800, 'Amount Received':172800, 'Outstanding Amount':0 } },
  { fields: { 'Invoice Number':'WM/26-27/009', 'Payment Status':'Pending', 'Amount Raised':216000, 'Amount with Tax':254880, 'Amount Received':0,      'Outstanding Amount':233280 } },
]

describe('shared view column totals', () => {
  it('sums each currency column across the whole view', () => {
    const t = computeColumnTotals(rows, INV_COLS, 'invoices')
    expect(t['Amount Raised']).toBe(536000)
    expect(t['Amount with Tax']).toBe(632480)
    expect(t['Amount Received']).toBe(172800)
    expect(t['Outstanding Amount']).toBe(406080)
  })

  it('produces no total for non-currency columns', () => {
    const t = computeColumnTotals(rows, INV_COLS, 'invoices')
    for (const col of ['Invoice Number','Client Name','Payment Status','Agening (Days)','Raised Date'])
      expect(t[col]).toBeUndefined()
  })

  it('never totals a rate — TDS % is a percentage, not an amount', () => {
    expect(SUMMABLE_COLS.has('TDS %')).toBe(false)
    expect(summableValue('TDS %', { 'TDS %': 10 }, 'tax-ledger')).toBeNull()
    expect(computeColumnTotals(rows, ['TDS %'], 'tax-ledger')['TDS %']).toBeUndefined()
  })

  it('never totals a day count', () => {
    expect(SUMMABLE_COLS.has('Agening (Days)')).toBe(false)
  })

  it('only computes totals for columns actually in the view', () => {
    const t = computeColumnTotals(rows, ['Amount Raised'], 'invoices')
    expect(Object.keys(t)).toEqual(['Amount Raised'])
  })

  it('uses tax-ledger derivations, not the raw field, for that resource type', () => {
    // Paid, received < gross => tds = gross - received; outstanding = 0
    const f = { 'Payment Status':'Paid', 'Amount Raised':100000, 'Amount with Tax':118000, 'Amount Received':108000 }
    expect(summableValue('GST Amount', f, 'tax-ledger')).toBe(18000)     // gross - base
    expect(summableValue('TDS Amount', f, 'tax-ledger')).toBe(10000)     // gross - received
    expect(summableValue('Outstanding Amount', f, 'tax-ledger')).toBe(0) // paid
    // same field read raw for a non-tax view
    expect(summableValue('Outstanding Amount', { 'Outstanding Amount': 5 }, 'invoices')).toBe(5)
  })

  it('treats missing, null, empty and string values safely', () => {
    const t = computeColumnTotals([
      { fields: { 'Amount Raised': null } },
      { fields: {} },
      { fields: { 'Amount Raised': '' } },
      { fields: { 'Amount Raised': '160000' } },   // Teable returns numerics as strings
    ], ['Amount Raised'], 'invoices')
    expect(t['Amount Raised']).toBe(160000)
    expect(Number.isNaN(t['Amount Raised'])).toBe(false)
  })

  it('is zero for an empty view rather than NaN', () => {
    expect(computeColumnTotals([], ['Amount Raised'], 'invoices')['Amount Raised']).toBe(0)
  })

  it('handles a records array with a missing fields object', () => {
    expect(computeColumnTotals([{}], ['Amount Raised'], 'invoices')['Amount Raised']).toBe(0)
  })
})
