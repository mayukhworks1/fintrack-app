import { describe, it, expect } from 'vitest'
import { buildInvoiceScalarPayload, normalizeInvoiceFormForCompare, EMPTY_FORM } from '../pages/invoices/utils.js'

const changed = (a, b) =>
  JSON.stringify(normalizeInvoiceFormForCompare(a)) !== JSON.stringify(normalizeInvoiceFormForCompare(b))

const base = { ...EMPTY_FORM, invoice_number: 'WM/26-27/168', reference: [], invoice_pdf: [] }
const file = (token, name) => ({ token, name, url: `https://sign/${Math.random()}` })

describe('invoice form change detection', () => {
  it('detects removing an attachment — previously reported "no changes"', () => {
    const before = { ...base, reference: [file('t1','a.pdf'), file('t2','b.pdf')] }
    const after  = { ...base, reference: [file('t1','a.pdf')] }
    expect(changed(before, after)).toBe(true)
  })

  it('detects adding an attachment', () => {
    expect(changed(base, { ...base, invoice_pdf: [file('t9','inv.pdf')] })).toBe(true)
  })

  it('detects removing the last attachment', () => {
    expect(changed({ ...base, reference: [file('t1','a.pdf')] }, base)).toBe(true)
  })

  it('ignores a rotated presigned url on an otherwise untouched form', () => {
    const a = { ...base, reference: [{ token:'t1', name:'a.pdf', url:'https://sign/OLD' }] }
    const b = { ...base, reference: [{ token:'t1', name:'a.pdf', url:'https://sign/NEW' }] }
    expect(changed(a, b)).toBe(false)
  })

  it('still detects scalar edits (no regression)', () => {
    expect(changed(base, { ...base, remark: 'updated' })).toBe(true)
    expect(changed(base, { ...base })).toBe(false)
  })
})

describe('invoice payload', () => {
  it('sends attachment arrays on edit so a removal actually persists', () => {
    const p = buildInvoiceScalarPayload({ ...base, reference: [file('t1','a.pdf')] }, { isEdit: true })
    expect(p.reference).toHaveLength(1)
    expect(p).toHaveProperty('invoice_pdf')
  })

  it('omits attachment arrays on create, where files are uploaded after the draft exists', () => {
    const p = buildInvoiceScalarPayload(base, { isEdit: false })
    expect(p).not.toHaveProperty('reference')
    expect(p).not.toHaveProperty('invoice_pdf')
  })

  it('keeps existing scalar and date behaviour unchanged', () => {
    const p = buildInvoiceScalarPayload({ ...base, raised_date: '2026-07-01', cleared_date: '' }, { isEdit: true })
    expect(p.raised_date).toBe('2026-07-01T00:00:00.000Z')
    expect(p.cleared_date).toBeNull()          // explicit clear on edit
    expect(p.invoice_number).toBe('WM/26-27/168')
  })

  it('paymentOnly still clears next_followup', () => {
    expect(buildInvoiceScalarPayload(base, { isEdit: true, paymentOnly: true }).next_followup).toBeNull()
  })
})
