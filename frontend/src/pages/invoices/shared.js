// Pure helpers shared by the Invoices and WebInvoices pages. Each page's
// utils.js re-exports the ones it uses.
import { formatInr } from '../../utils/format'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'

export const STATUSES = ['Paid', 'Pending', 'Cancelled']

export const monthKey = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const monthLabel = (key) => {
  if (!key) return 'All months'
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export const shiftMonthKey = (key, delta) => {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const shortMonthLabel = (key) => {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

export const invoiceAmountParts = (fields = {}) => {
  const base = Number(fields['Amount Raised'] || 0)
  const gross = Number(fields['Amount with Tax'] || base)
  const received = Number(fields['Amount Received'] || 0)
  const status = String(fields['Payment Status'] || '').trim()
  const isPaid = status === 'Paid'
  const gst = Math.max(0, gross - base)
  const variance = Math.max(0, gross - received)
  return {
    base,
    gross,
    gst,
    received,
    deduction: isPaid ? variance : 0,
    outstanding: isPaid || status === 'Cancelled' ? 0 : variance,
    isPaid,
  }
}

export const isRetainerCategory = (value) => /retainer/i.test(String(value || ''))

export const currentMonthKey = () => monthKey(new Date().toISOString())

export const firstDayIso = (key) => `${key}-01T00:00:00.000Z`

export const INVOICE_REQUEST_FORM_URL = 'https://forms.zohopublic.com/theworks/form/TheWorksInvoiceRequest/formperma/EeBkA0aaMt64sMe9n3mxlKggjA-QmVDmTVwrqMHPGOY'

export function parseIsoDate(value) {
  const d = new Date(value || '')
  return Number.isNaN(d.getTime()) ? null : d
}

export function sortByRaisedDateDesc(records = []) {
  return [...records].sort((a, b) => {
    const da = parseIsoDate(a.fields?.['Raised Date'])?.getTime() || 0
    const db = parseIsoDate(b.fields?.['Raised Date'])?.getTime() || 0
    return db - da
  })
}

export const fmt     = (n) => formatInr(n)

export const fmtDate = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return String(d).slice(0, 10) }
}

export const fmtDateFull = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

export function parseAttachments(cell) {
  if (!cell) return []
  if (Array.isArray(cell)) {
    return cell.map(a => ({
      name: a.name || a.filename || 'Attachment',
      url:  a.url  || a.presignedUrl || '',
      mime: a.mimeType || a.mimetype || '',
      // Teable's small preview, so a 28px row thumbnail doesn't pull the full original
      thumb: a.smThumbnailUrl || a.lgThumbnailUrl || '',
    }))
  }
  const parts = String(cell).split(/\s+/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) out.push({
      name: decodeURIComponent(parts[i].replace(/_x20_/g, ' ')).replace(/_x2D_/g, '-'),
      url:  parts[i + 1],
      mime: '',
    })
  }
  return out
}

export const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}

export const isPdf = (a) =>
  a.mime === 'application/pdf' ||
  /\.pdf(\?|$)/i.test(a.url) ||
  a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ───────────────────────────────────────────────────────── */

export const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
}

export function classifyAgingBand(days) {
  const d = Number(days || 0)
  if (d <= 14) return '0-14d'
  if (d <= 30) return '15-30d'
  if (d <= 60) return '31-60d'
  return '60d+'
}

export function dateOnlyValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

export function endOfMonthIso(key) {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ── Retainers ───────────────────────────────────────────────────────────── */

/** One entry per retainer project: its records, the status of `retainerMonth`,
 *  an eight-month timeline around the current month and the next month due. */
export function buildRetainerGroups(allRecords, retainerMonth) {
  const retainerRecords = allRecords.filter(r => isRetainerCategory(r.fields?.['Category']))
  const grouped = new Map()
  for (const record of retainerRecords) {
    const project = String(record.fields?.['Project'] || '').trim() || 'Unnamed Retainer'
    if (!grouped.has(project)) grouped.set(project, [])
    grouped.get(project).push(record)
  }
  return [...grouped.entries()].map(([project, items]) => {
    const sorted = sortByRaisedDateDesc(items)
    const latestActive = sorted.find(r => r.fields?.['Payment Status'] !== 'Cancelled') || sorted[0]
    // Build recordByMonth preferring active (non-cancelled) records when a month
    // has multiple invoices (e.g. original cancelled + re-raised paid replacement).
    const recordByMonth = {}
    for (const r of sorted) {
      const key = monthKey(r.fields?.['Raised Date'])
      if (!key) continue
      const existing = recordByMonth[key]
      const thisCancelled = r.fields?.['Payment Status'] === 'Cancelled'
      if (!existing || (existing.fields?.['Payment Status'] === 'Cancelled' && !thisCancelled)) {
        recordByMonth[key] = r
      }
    }
    // For the selected month, prefer the active record over a cancelled one
    const monthRecord =
      sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth && r.fields?.['Payment Status'] !== 'Cancelled') ||
      sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth)
    const amount = Number(latestActive?.fields?.['Amount Raised'] || 0)
    const withTax = Number(latestActive?.fields?.['Amount with Tax'] || 0)
    const monthStatus = !monthRecord
      ? 'Missing'
      : monthRecord.fields?.['Payment Status'] === 'Cancelled'
        ? 'Paused'
        : monthRecord.fields?.['Payment Status'] || 'Pending'
    const timelineMonths = Array.from({ length: 8 }, (_, i) => shiftMonthKey(currentMonthKey(), i - 3))
    const timeline = timelineMonths.map((key) => {
      const rec = recordByMonth[key]
      const recStatus = !rec
        ? 'Missing'
        : rec.fields?.['Payment Status'] === 'Cancelled'
          ? 'Paused'
          : rec.fields?.['Payment Status'] === 'Paid'
            ? 'Raised'
            : 'Pending'
      return {
        key,
        label: shortMonthLabel(key),
        fullLabel: monthLabel(key),
        record: rec,
        status: recStatus,
        active: key === retainerMonth,
        current: key === currentMonthKey(),
      }
    })
    const currentTimeline = timeline.find(t => t.current)
    const currentMonthRaised = currentTimeline ? currentTimeline.status !== 'Missing' : false
    let nextDueMonth = currentMonthKey()
    for (let i = 0; i < 12; i++) {
      const key = shiftMonthKey(currentMonthKey(), i)
      const rec = recordByMonth[key]
      const paused = rec?.fields?.['Payment Status'] === 'Cancelled'
      if (!rec || paused) {
        nextDueMonth = paused ? shiftMonthKey(key, 1) : key
        break
      }
      nextDueMonth = shiftMonthKey(key, 1)
    }
    return {
      project,
      records: sorted,
      latestActive,
      recordByMonth,
      monthRecord,
      amount,
      withTax,
      monthStatus,
      timeline,
      currentMonthRaised,
      nextDueMonth,
      raisedBy: latestActive?.fields?.['Raised By'] || '',
      description: latestActive?.fields?.['Description'] || '',
    }
  }).sort((a, b) => a.project.localeCompare(b.project))
}
