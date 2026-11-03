/**
 * Invoices on a phone (≤640px): a summary card, the All / Pending / Overdue /
 * Paid segments, search with a Filters sheet, and one grouped list of
 * invoices (number, then client · project · date, then amount and a status
 * dot). Tapping a row opens the same detail drawer as on desktop.
 *
 * The data is the page's own: the same URL filters and the same server query
 * (useInvoiceQuery), so a phone and a desktop looking at one link see the
 * same scope. Everything not on screen here (share, links, export, raise
 * externally, refresh, the retainer workspace) is one tap away in the
 * header's actions sheet.
 */
import { useState } from 'react'
import { MoreHorizontal, ExternalLink, Eye, Download, RefreshCw, CalendarClock, Receipt, AlertTriangle, FileText, SearchX } from 'lucide-react'
import {
  HeaderActions, InlineLargeTitle, RoundIconButton, SummaryCard, SegmentedControl, SearchFilterBar, AppliedFilters,
  GroupedList, ListRow, SkeletonRows, InlineAddRow, ShowMoreRow, Sheet, SheetField, ActionSheet,
} from '../../components/mobile/MobileUI'
import { invoiceSummary } from '../../components/mobile/summary'
import { Avatar, AgingBars, EmptyState, ListSection, Sparkline, invoicePill, sectionRuns } from '../../components/mobile/Visuals'
import InsightCards from '../../components/mobile/InsightCards'
import { FilterBuilder } from '../../components/FilterBuilder'
import { INVOICE_FIELDS, INVOICE_REQUEST_FORM_URL, STATUS_META, STATUSES, effectiveAging, fmt, fmtDate, monthLabel } from './utils'
import { INVOICE_SEGMENTS, invoiceSegmentOf, invoiceSegmentPatch, OVERDUE_DAYS } from './phoneSegments'

const AGING_BANDS = ['0-14d', '15-30d', '31-60d', '60d+']
const SORTS = [
  ['Raised Date', 'Raised date'], ['Amount Raised', 'Amount'], ['Outstanding Amount', 'Outstanding'],
  ['Agening (Days)', 'Aging'], ['Invoice Number', 'Invoice number'], ['Client Name', 'Client'],
  ['Next followup', 'Next follow-up'],
]

/**
 * One invoice as a row: the client's avatar; number; client · project · date;
 * the amount over a status pill (Paid, Pending or Overdue with its age).
 * `amount` formats the trailing figure (web invoices carry their own currency).
 */
export function invoiceRowProps(r, amount = f => fmt(f['Amount Raised'])) {
  const f = r.fields || {}
  const status = f['Payment Status'] || ''
  const aging = status === 'Pending' ? effectiveAging(f) : 0
  const overdue = status === 'Pending' && aging > OVERDUE_DAYS
  const meta = STATUS_META[status]
  const client = f['Client Name'] || f['Client'] || f['Project'] || ''
  return {
    title: f['Invoice Number'] || 'Draft invoice',
    meta: [f['Client Name'], f['Project'], f['Raised Date'] ? fmtDate(f['Raised Date']) : ''],
    value: amount(f),
    dot: overdue ? 'var(--fin-negative)' : meta?.color || 'var(--text-3)',
    dotLabel: overdue ? `${status}, ${aging} days old` : status || 'No status',
    pill: invoicePill(status, aging, OVERDUE_DAYS),
    leading: <Avatar name={client || '?'} />,
    strike: status === 'Cancelled',
  }
}

const monthOf = (value) => {
  const d = value ? new Date(value) : null
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''
}
const sumBands = (aging, keys) => keys.reduce((acc, k) => ({
  count: acc.count + Number(aging?.[k]?.count || 0), amount: acc.amount + Number(aging?.[k]?.amount || 0),
}), { count: 0, amount: 0 })

/**
 * How the list splits into sticky sections, or null for one plain list.
 * Sections follow the list's own order, so they only exist for the raised
 * date sort. Their counts and totals are the scope's (server aggregates), not
 * just the rows loaded so far:
 *   Pending / Overdue segments: "Within 30 days" and "Overdue" (aging bands);
 *   otherwise: "This month", "Last month" and "Earlier" (months raised).
 * `amounts` false leaves the totals out (web invoices mix currencies).
 */
export function invoiceSections({ filters, segment, agg, today = new Date(), amounts = true }) {
  if (!agg || (filters.sort || 'Raised Date') !== 'Raised Date') return null
  const money = (v) => (amounts ? v : undefined)
  if (segment === 'pending' || segment === 'overdue') {
    const due = sumBands(agg.aging, ['0-14d', '15-30d'])
    const late = sumBands(agg.aging, ['31-60d', '60d+'])
    return {
      keyOf: (r) => {
        const f = r.fields || {}
        return f['Payment Status'] === 'Pending' && effectiveAging(f) > OVERDUE_DAYS ? 'overdue' : 'due'
      },
      info: {
        due: { title: `Within ${OVERDUE_DAYS} days`, count: due.count, total: money(due.amount) },
        overdue: { title: 'Overdue', count: late.count, total: money(late.amount) },
      },
    }
  }
  const thisKey = monthOf(today)
  const lastKey = monthOf(new Date(today.getFullYear(), today.getMonth(), 0))
  const month = (k) => (agg.raised_months || []).find(m => m.key === k) || { count: 0, amount: 0 }
  const a = month(thisKey)
  const b = month(lastKey)
  const restCount = Math.max(0, Number(agg.count || 0) - a.count - b.count)
  const restAmount = Number(agg.totals?.amount_raised || 0) - Number(a.amount || 0) - Number(b.amount || 0)
  return {
    keyOf: (r) => {
      const k = monthOf((r.fields || {})['Raised Date'])
      return k === thisKey ? 'this' : k === lastKey ? 'last' : 'earlier'
    },
    info: {
      this: { title: 'This month', count: a.count, total: money(a.amount) },
      last: { title: 'Last month', count: b.count, total: money(b.amount) },
      earlier: { title: 'Earlier', count: restCount, total: money(Math.max(0, restAmount)) },
    },
  }
}

/** A bucket's list link ("/invoices?status=Pending&from=...&to=...") as a filter patch. */
export function bucketPatch(href) {
  const q = new URLSearchParams(String(href || '').split('?')[1] || '')
  return { status: q.get('status') || '', dateField: 'Raised Date', dateFrom: q.get('from') || '', dateTo: q.get('to') || '' }
}

/** The summary card's charts: six months of cash in and pending invoices by age. */
export function InvoiceCharts({ charts, onBucket }) {
  if (!charts) return null
  return (
    <>
      <Sparkline title="Cash in" points={(charts.cash_in || []).map(p => ({ label: p.label, value: p.amount }))} />
      <AgingBars buckets={charts.aging} onSelect={onBucket} />
    </>
  )
}

export default function InvoicesPhone({
  filters, setFilters, searchInput, onSearchInput, commitSearch, clearAll, hasFilters, chips,
  records, scopeTotal, nextCursor, loadMore, loadingMore, hasData, agg, ws, error, errorStatus,
  refresh, loading, syncing, canCreate, openNew, openView, isEditor, onShare, onLinks, exportCsv,
  exporting, allCount, options, workspace, setWorkspace, retainerWorkspace,
  summary: givenSummary, actions: givenActions, amount, label = 'invoices', inlineTitle,
  insights, visual: givenVisual, sectionAmounts = true,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const segment = invoiceSegmentOf(filters)
  // The segment is the status; chips show the rest of what narrows the list.
  const sheetChips = chips.filter(c => c.key !== 'status' && c.key !== 'search' && !(segment === 'overdue' && c.key === 'date'))
  const summary = givenSummary !== undefined
    ? givenSummary
    : invoiceSummary(agg ? { ...agg, overdue_top: hasFilters ? undefined : ws?.overdue_top } : null)
  const set = (key) => (e) => setFilters({ [key]: e.target.value })
  const visual = givenVisual !== undefined
    ? givenVisual
    : insights?.charts ? <InvoiceCharts charts={insights.charts} onBucket={b => setFilters(bucketPatch(b.href))} /> : null
  const sections = hasData && records.length ? invoiceSections({ filters, segment, agg, amounts: sectionAmounts }) : null
  const row = (r) => {
    const p = invoiceRowProps(r, amount)
    return <ListRow key={r.id} {...p} mono onClick={() => openView(r)} ariaLabel={`${p.title}, ${p.pill.label}, ${p.value}`} />
  }

  const actions = givenActions || [
    setWorkspace && (workspace === 'retainers'
      ? { label: 'Invoice list', icon: Receipt, onClick: () => setWorkspace('invoices') }
      : { label: 'Retainer workspace', icon: CalendarClock, hint: 'Raise or pause this month’s retainers', onClick: () => setWorkspace('retainers') }),
    isEditor && { label: 'Share this view', icon: ExternalLink, onClick: onShare },
    isEditor && { label: 'Shared links', icon: Eye, onClick: onLinks },
    { label: 'Raise externally', icon: ExternalLink, hint: 'Opens the invoice request form', onClick: () => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer') },
    { label: exporting ? 'Exporting…' : `Export filtered CSV (${scopeTotal})`, icon: Download, disabled: exporting, onClick: () => exportCsv(true) },
    { label: `Export all CSV (${allCount})`, icon: Download, disabled: exporting, onClick: () => exportCsv(false) },
    { label: 'Refresh', icon: RefreshCw, disabled: loading, onClick: refresh },
  ]

  const denied = errorStatus === 403 || errorStatus === 401
  return (
    <div className="m-page">
      {inlineTitle ? (
        <InlineLargeTitle context={inlineTitle.context} title={inlineTitle.title}>
          <RoundIconButton icon={MoreHorizontal} label="Invoice actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
        </InlineLargeTitle>
      ) : (
        <HeaderActions>
          <RoundIconButton icon={MoreHorizontal} label="Invoice actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
        </HeaderActions>
      )}

      {workspace === 'retainers' && retainerWorkspace ? retainerWorkspace : (
        <>
          <InsightCards cards={insights?.cards} />

          <SummaryCard
            loading={!agg}
            value={summary?.value}
            ringLabel={summary?.ringLabel}
            title={summary?.title}
            sentence={summary?.sentence}
            visual={visual}
          />

          <SegmentedControl
            label="Invoice status"
            options={INVOICE_SEGMENTS}
            value={segment}
            onChange={v => setFilters(invoiceSegmentPatch(v, filters))}
          />

          <SearchFilterBar
            label="Search invoices"
            placeholder="Invoice #, client, project"
            value={searchInput}
            onChange={onSearchInput}
            onSubmit={commitSearch}
            filterCount={sheetChips.length}
            filtersOpen={filtersOpen}
            onFilters={() => setFiltersOpen(true)}
          />
          <AppliedFilters chips={sheetChips} />

          {canCreate && <InlineAddRow label="New invoice" onClick={openNew} />}

          {denied ? (
            <div role="alert" className="m-note is-error">You don’t have permission to view {label}. Ask an administrator for access.</div>
          ) : error ? (
            <div role="alert" className="m-note is-error">
              <AlertTriangle size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              {error} <button type="button" onClick={refresh} style={{ textDecoration: 'underline', minHeight: 0 }}>Retry</button>
            </div>
          ) : null}

          {sections ? (
            <div className="m-sections" role="region" aria-label={`${scopeTotal.toLocaleString('en-IN')} invoice${scopeTotal === 1 ? '' : 's'}`}>
              {sectionRuns(records, sections.keyOf).map((run, i) => {
                const info = sections.info[run.key]
                return (
                  <ListSection key={`${run.key}-${i}`} title={info.title} count={info.count} total={info.total}>
                    {run.rows.map(row)}
                  </ListSection>
                )
              })}
            </div>
          ) : (
            <GroupedList
              title={hasData ? `${scopeTotal.toLocaleString('en-IN')} invoice${scopeTotal === 1 ? '' : 's'}${syncing ? ' · updating' : ''}` : 'Invoices'}
              label="Invoices"
            >
              {!hasData
                ? <SkeletonRows count={6} avatar pill />
                : records.length === 0
                  ? (
                    <EmptyState
                      icon={hasFilters ? SearchX : FileText}
                      title={hasFilters ? 'No invoices match' : 'No invoices yet'}
                      action={hasFilters && <button type="button" onClick={clearAll}>Clear filters</button>}
                    >
                      {hasFilters ? 'Nothing matches the current search and filters.' : 'Create your first invoice to get started.'}
                    </EmptyState>
                  )
                  : records.map(row)}
            </GroupedList>
          )}

          {hasData && records.length > 0 && (
            <ShowMoreRow shown={records.length} total={scopeTotal} hasMore={!!nextCursor} loading={loadingMore} onMore={loadMore} />
          )}
        </>
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => { clearAll(); setFiltersOpen(false) }} disabled={!hasFilters}>Clear all</button>
            <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={() => setFiltersOpen(false)}>
              Show {scopeTotal.toLocaleString('en-IN')} result{scopeTotal === 1 ? '' : 's'}
            </button>
          </div>
        }
      >
        <SheetField label="Billing">
          <SegmentedControl
            label="Billing"
            options={[{ value: 'all', label: 'All' }, { value: 'project', label: 'Projects' }, { value: 'retainer', label: 'Retainers' }]}
            value={filters.billing}
            onChange={v => setFilters({ billing: v })}
          />
        </SheetField>
        <SheetField label="Status">
          <select value={filters.status} onChange={set('status')} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </SheetField>
        {options.clients && (
          <SheetField label="Client">
            <select value={filters.client} onChange={set('client')} aria-label="Client">
              <option value="">All clients</option>
              {options.clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </SheetField>
        )}
        <SheetField label="Project">
          <select value={filters.project} onChange={set('project')} aria-label="Project">
            <option value="">All projects</option>
            {options.projects.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </SheetField>
        <SheetField label="Raised in">
          <select value={filters.month} onChange={set('month')} aria-label="Raised in month">
            <option value="">All months</option>
            {options.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </SheetField>
        <SheetField label="Date range">
          <select value={filters.dateField} onChange={set('dateField')} aria-label="Date field">
            <option value="Raised Date">Raised date</option>
            <option value="Cleared Date">Cleared date</option>
            <option value="Next followup">Next follow-up</option>
          </select>
          <div className="m-field-row">
            <input type="date" aria-label="From date" value={filters.dateFrom} onChange={set('dateFrom')} />
            <input type="date" aria-label="To date" value={filters.dateTo} onChange={set('dateTo')} />
          </div>
        </SheetField>
        <SheetField label="Aging">
          <select value={filters.aging} onChange={set('aging')} aria-label="Aging">
            <option value="">Any age</option>
            {AGING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </SheetField>
        <SheetField label="Category">
          <select value={filters.category} onChange={set('category')} aria-label="Category">
            <option value="">All categories</option>
            {options.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </SheetField>
        {options.raisedBy && (
          <SheetField label="Raised by">
            <select value={filters.raisedBy} onChange={set('raisedBy')} aria-label="Raised by">
              <option value="">Anyone</option>
              {options.raisedBy.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </SheetField>
        )}
        <div>
          {[
            ['overdue', 'Pending or outstanding'],
            ['followupDue', 'Follow-up due'],
            ['hasDocs', 'Has documents'],
          ].map(([key, label]) => (
            <label key={key} className="m-toggle-row">
              <span>{label}</span>
              <input type="checkbox" checked={!!filters[key]} onChange={e => setFilters({ [key]: e.target.checked })} />
            </label>
          ))}
        </div>
        <SheetField label="Sort by">
          <div className="m-field-row">
            <select value={filters.sort} onChange={set('sort')} aria-label="Sort by">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={filters.order} onChange={set('order')} aria-label="Order">
              <option value="desc">Newest / largest first</option>
              <option value="asc">Oldest / smallest first</option>
            </select>
          </div>
        </SheetField>
        <SheetField label="Advanced filters">
          <FilterBuilder
            fields={INVOICE_FIELDS}
            records={records}
            getFieldValue={r => r.fields ?? {}}
            conditions={filters.conditions}
            onChange={v => setFilters({ conditions: v }, { replace: true })}
            label="Add condition"
          />
        </SheetField>
      </Sheet>

      <ActionSheet open={actionsOpen} onClose={() => setActionsOpen(false)} title="Invoices" actions={actions} />
    </div>
  )
}
