// The Tax Ledger's figures as the page used to work them out in the browser,
// kept verbatim (taxParts, inPeriod and the memos over every invoice) so the
// server's totals can be checked against them. backend/tests/fixtures/
// tax_ledger_cases.json holds a set of invoices and what this code gives for
// each period; the server's tests compare GET /api/invoices/query with the
// same expectations, and taxledger.test.jsx re-derives them from this file.
import { parseDate } from '../utils/dates'

function dateKey(iso) {
  const d = parseDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function taxParts(fields = {}) {
  const base    = Number(fields['Amount Raised']    || 0)
  const gross   = Number(fields['Amount with Tax']  || base)
  const received = Number(fields['Amount Received'] || 0)
  const status  = String(fields['Payment Status']   || '').trim()
  const isPaid  = status === 'Paid'
  const isCancelled = status === 'Cancelled'
  const gstAmt  = Math.max(0, gross - base)
  const gstPct  = base > 0 ? (gstAmt / base) * 100 : 0
  const tdsAmt  = isPaid && received < gross ? Math.max(0, gross - received) : 0
  const tdsPct  = base > 0 ? (tdsAmt / base) * 100 : 0
  const netReceivable = gross - tdsAmt
  const outstanding = (!isPaid && !isCancelled) ? Math.max(0, gross - received) : 0
  return { base, gross, gstAmt, gstPct, tdsAmt, tdsPct, received, netReceivable, outstanding, status, isPaid, isCancelled }
}

function inPeriod(raisedDate, from, to) {
  if (!raisedDate) return false
  const d = String(raisedDate).slice(0, 10)
  return d >= from && d <= to
}

/** Everything the old page derived for one period, from every invoice. */
export function legacyTaxLedger(allInvoices, period, { invoiceScope = 'tax', search = '' } = {}) {
  const periodInvoices = allInvoices.filter(r => {
    const f = r.fields || {}
    if (f['Payment Status'] === 'Cancelled') return false
    const cur = (f['Currency'] || 'RS').toString().trim().toUpperCase()
    if (cur !== 'RS' && cur !== 'INR') return false
    return inPeriod(f['Raised Date'], period.from, period.to)
  })
  const taxInvoices = periodInvoices.filter(r => taxParts(r.fields).isPaid)
  const openInvoices = periodInvoices.filter(r => {
    const p = taxParts(r.fields)
    return !p.isPaid && !p.isCancelled
  })
  const invoiceScopeRecords = invoiceScope === 'all' ? periodInvoices : invoiceScope === 'open' ? openInvoices : taxInvoices
  const q = search.trim().toLowerCase()
  const filteredInvoices = !q ? invoiceScopeRecords : invoiceScopeRecords.filter(r => {
    const f = r.fields || {}
    return [f['Invoice Number'], f['Project'], f['Client Name'], f['Client'], f['Payment Status']].some(v => String(v || '').toLowerCase().includes(q))
  })

  let taxable = 0, gstAmt = 0, tdsAmt = 0, gross = 0, received = 0, outstanding = 0, count = 0
  for (const r of taxInvoices) {
    const p = taxParts(r.fields)
    taxable += p.base; gstAmt += p.gstAmt; tdsAmt += p.tdsAmt
    gross += p.gross; received += p.received; outstanding += p.outstanding; count++
  }
  const totals = { count, taxable, gstAmt, tdsAmt, gross, received, outstanding }

  let oTaxable = 0, oGross = 0, oReceived = 0, oOutstanding = 0, oldest = 0
  for (const r of openInvoices) {
    const p = taxParts(r.fields)
    oTaxable += p.base; oGross += p.gross; oReceived += p.received; oOutstanding += p.outstanding
    oldest = Math.max(oldest, Number(r.fields?.['Agening (Days)'] || 0))
  }
  const openSummary = { count: openInvoices.length, taxable: oTaxable, gross: oGross, received: oReceived, outstanding: oOutstanding, oldest }

  const monthMap = new Map()
  for (const r of taxInvoices) {
    const key = dateKey(r.fields?.['Raised Date'])
    if (!key) continue
    if (!monthMap.has(key)) monthMap.set(key, [])
    monthMap.get(key).push(r)
  }
  const monthlyRows = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, invoices]) => {
    const t = { key, count: invoices.length, taxable: 0, gstAmt: 0, tdsAmt: 0, gross: 0, received: 0, outstanding: 0 }
    for (const r of invoices) {
      const p = taxParts(r.fields)
      t.taxable += p.base; t.gstAmt += p.gstAmt; t.tdsAmt += p.tdsAmt
      t.gross += p.gross; t.received += p.received; t.outstanding += p.outstanding
    }
    return t
  })

  const clientMap = new Map()
  for (const r of taxInvoices) {
    const f = r.fields || {}
    const client = f['Client Name'] || f['Project'] || 'Unknown'
    if (!clientMap.has(client)) clientMap.set(client, [])
    clientMap.get(client).push(r)
  }
  const clientRows = [...clientMap.entries()].map(([client, invoices]) => {
    const t = { client, count: invoices.length, taxable: 0, gstAmt: 0, tdsAmt: 0, gross: 0, received: 0, outstanding: 0 }
    for (const r of invoices) {
      const p = taxParts(r.fields)
      t.taxable += p.base; t.gstAmt += p.gstAmt; t.tdsAmt += p.tdsAmt
      t.gross += p.gross; t.received += p.received; t.outstanding += p.outstanding
    }
    return t
  }).sort((a, b) => b.gross - a.gross)

  return {
    totals, openSummary, monthlyRows, clientRows,
    scopeIds: invoiceScopeRecords.map(r => r.id).sort(),
    searchIds: filteredInvoices.map(r => r.id).sort(),
  }
}
