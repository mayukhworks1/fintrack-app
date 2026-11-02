// The one-sentence summaries the phone layouts show beside their ring:
// "80% collected" over "₹4,85,600 outstanding · 3 pending, oldest 48 days".
// Amounts keep their exact digits (utils/format: no lakh / crore shorthand).
import { formatInr, formatPct } from '../../utils/format'
import { joinMeta } from './MobileUI'

export const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-IN')} ${Number(n) === 1 ? one : many}`

const pct = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

/**
 * Receivables: the collection rate for the ring, then what is still owed.
 * `ws` is an invoice query's workspace (or aggregates): collection_rate,
 * outstanding, pending_count and, when present, overdue_top (oldest first).
 */
export function invoiceSummary(ws) {
  if (!ws) return null
  const rate = pct(ws.collection_rate)
  const pending = Number(ws.pending_count || 0)
  const oldest = Math.round(Number(ws.overdue_top?.[0]?.aging || 0))
  const owed = Number(ws.outstanding || 0)
  let sentence
  if (!pending && owed <= 0) sentence = 'Nothing outstanding · every invoice is settled'
  else {
    sentence = joinMeta([
      `${formatInr(owed)} outstanding`,
      `${pending} pending${oldest > 0 ? `, oldest ${plural(oldest, 'day')}` : ''}`,
    ])
  }
  return {
    value: rate,
    title: `${formatPct(rate, 1)} collected`,
    ringLabel: `Collection rate ${formatPct(rate, 1)}`,
    sentence,
  }
}

/** Projects: the share on track for the ring, then billing, margin and load. */
export function projectSummary(ws) {
  if (!ws) return null
  const count = Number(ws.count || 0)
  const needs = Math.min(count, Number(ws.needs_action || 0))
  const onTrack = count - needs
  const share = count ? (onTrack / count) * 100 : 0
  return {
    value: share,
    title: count ? `${onTrack} of ${count} on track` : 'No projects yet',
    ringLabel: `${formatPct(share, 0)} of projects on track`,
    sentence: count ? joinMeta([
      `${formatInr(ws.total_billed)} billed`,
      `${formatPct(ws.margin ?? 0, 1)} margin`,
      needs ? `${needs} need${needs === 1 ? 's' : ''} action` : 'none need action',
    ]) : 'Create a project to start tracking it',
  }
}

/** Tax Ledger: collected share of the paid register, then GST, TDS and count. */
export function taxSummary({ totals, periodLabel }) {
  if (!totals) return null
  const rate = pct(totals.collectionRate)
  return {
    value: rate,
    title: `${formatPct(rate, 1)} collected`,
    ringLabel: `Collection rate ${formatPct(rate, 1)}`,
    sentence: joinMeta([
      `GST ${formatInr(Math.round(totals.gstAmt || 0))}`,
      `TDS ${formatInr(Math.round(totals.tdsAmt || 0))}`,
      `${plural(totals.count, 'paid invoice')}${periodLabel ? ` in ${periodLabel}` : ''}`,
    ]),
  }
}

/** Pages: published share, then drafts and pages with unpublished edits. */
export function pagesSummary(pages) {
  const list = pages || []
  const total = list.length
  const published = list.filter(p => p.is_published).length
  const pendingEdits = list.filter(p => p.is_published && p.has_unpublished_changes).length
  const drafts = total - published
  const share = total ? (published / total) * 100 : 0
  return {
    value: share,
    title: total ? `${published} of ${total} published` : 'No pages yet',
    ringLabel: `${formatPct(share, 0)} of pages published`,
    sentence: total ? joinMeta([
      plural(drafts, 'draft'),
      pendingEdits ? `${pendingEdits} with unpublished edits` : 'all live pages up to date',
    ]) : 'Create a page to share with clients',
  }
}
