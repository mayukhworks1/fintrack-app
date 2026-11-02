/**
 * The Tax Ledger on a phone (≤640px): a summary card (collected share of the
 * paid register, then GST, TDS and the count), Paid / Open / All segments
 * over the register scope, search with the period in a Filters sheet, then
 * grouped lists: the register, the months and the clients. The full tables
 * (drilldowns, reports) stay one tap away in the actions sheet, with share,
 * export and print. Same URL filters and server query as desktop.
 */
import { useState } from 'react'
import { MoreHorizontal, Share2, Link2, RefreshCw, Download, Printer, Table2 } from 'lucide-react'
import {
  HeaderActions, RoundIconButton, SummaryCard, SegmentedControl, SearchFilterBar, AppliedFilters,
  GroupedList, ListRow, SkeletonRows, ShowMoreRow, Sheet, SheetField, ActionSheet,
} from '../../components/mobile/MobileUI'
import { taxSummary, plural } from '../../components/mobile/summary'
import { formatInr } from '../../utils/format'
import { STATUS_META, fmtDate } from '../invoices/utils'

export const TAX_SEGMENTS = [
  { value: 'tax', label: 'Paid' },
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
]

const PERIOD_GROUPS = [
  ['fy', 'Financial year (Apr–Mar)'], ['year', 'Calendar year'], ['half', 'Half-year'], ['quarter', 'Quarter'], ['month', 'Month'],
]

export default function TaxLedgerPhone({
  filters, setFilters, searchInput, setSearch, commitSearch, period, periods, defaultPeriod,
  records, scopeTotal, nextCursor, loadMore, loadingMore, hasData, totals, openSummary, monthlyRows, clientRows,
  error, refresh, loading, canShare, onShare, onLinks, onExport, exporting, onPrint, onFull, taxParts, pageSize,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const custom = filters.period === 'custom'
  const notDefault = custom || (filters.period && filters.period !== defaultPeriod)
  const chips = notDefault ? [{ key: 'period', label: period.label, onClear: () => setFilters({ period: defaultPeriod, from: '', to: '' }) }] : []
  const summary = taxSummary({ totals, periodLabel: period.label })
  const openLine = openSummary.count
    ? `${plural(openSummary.count, 'open invoice')} · ${formatInr(Math.round(openSummary.outstanding))} outstanding`
    : null

  return (
    <div className="m-page">
      <HeaderActions>
        <RoundIconButton icon={MoreHorizontal} label="Tax ledger actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
      </HeaderActions>

      <SummaryCard loading={!hasData} value={summary?.value} ringLabel={summary?.ringLabel} title={summary?.title}
        sentence={summary && openLine ? `${summary.sentence} · ${openLine}` : summary?.sentence} />

      <SegmentedControl label="Register" options={TAX_SEGMENTS} value={filters.scope} onChange={v => setFilters({ scope: v })} />

      <SearchFilterBar
        label="Search the register"
        placeholder="Invoice #, client, project"
        value={searchInput}
        onChange={setSearch}
        onSubmit={commitSearch}
        filterCount={chips.length}
        filtersOpen={filtersOpen}
        onFilters={() => setFiltersOpen(true)}
      />
      <AppliedFilters chips={chips} />

      {error && (
        <div role="alert" className="m-note is-error">
          {error} <button type="button" onClick={refresh} style={{ textDecoration: 'underline', minHeight: 0 }}>Retry</button>
        </div>
      )}

      <GroupedList title={hasData ? `${plural(scopeTotal, 'invoice')} · ${period.label}` : 'Register'} label="Register">
        {!hasData
          ? <SkeletonRows count={5} />
          : records.length === 0
            ? <li className="m-empty"><strong>No invoices</strong>Nothing in this register for {period.label}.</li>
            : records.map(r => {
              const f = r.fields || {}
              const p = taxParts(f)
              const status = f['Payment Status'] || ''
              return (
                <ListRow
                  key={r.id}
                  mono
                  title={f['Invoice Number'] || r.id}
                  meta={[f['Client Name'] || f['Project'], f['Raised Date'] ? fmtDate(f['Raised Date']) : '', p.gstAmt ? `GST ${formatInr(Math.round(p.gstAmt))}` : '', p.tdsAmt ? `TDS ${formatInr(Math.round(p.tdsAmt))}` : '']}
                  value={formatInr(Math.round(p.gross))}
                  dot={STATUS_META[status]?.color || 'var(--text-3)'}
                  dotLabel={status || 'No status'}
                />
              )
            })}
      </GroupedList>
      {hasData && records.length > 0 && (
        <ShowMoreRow shown={records.length} total={scopeTotal} hasMore={!!nextCursor} loading={loadingMore} onMore={loadMore} step={pageSize} />
      )}

      {monthlyRows.length > 0 && (
        <GroupedList title="By month · paid">
          {monthlyRows.map(m => (
            <ListRow key={m.key} title={m.label}
              meta={[plural(m.count, 'invoice'), `GST ${formatInr(Math.round(m.gstAmt || 0))}`, `TDS ${formatInr(Math.round(m.tdsAmt || 0))}`]}
              value={formatInr(Math.round(m.gross || 0))} />
          ))}
        </GroupedList>
      )}

      {clientRows.length > 0 && (
        <GroupedList title="By client · paid" action={clientRows.length > 8 ? <button type="button" onClick={onFull}>All</button> : null}>
          {clientRows.slice(0, 8).map(c => (
            <ListRow key={c.client} title={c.client}
              meta={[plural(c.count, 'invoice'), `GST ${formatInr(Math.round(c.gstAmt || 0))}`, `TDS ${formatInr(Math.round(c.tdsAmt || 0))}`]}
              value={formatInr(Math.round(c.gross || 0))} />
          ))}
        </GroupedList>
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={<button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setFiltersOpen(false)}>Show {plural(scopeTotal, 'invoice')}</button>}
      >
        <SheetField label="Period">
          <select
            aria-label="Period"
            value={custom ? 'custom' : filters.period}
            onChange={e => setFilters(e.target.value === 'custom'
              ? { period: 'custom', from: period.from, to: period.to }
              : { period: e.target.value, from: '', to: '' })}
          >
            {PERIOD_GROUPS.map(([type, label]) => (
              <optgroup key={type} label={label}>
                {periods.filter(p => p.type === type).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </optgroup>
            ))}
            <optgroup label="Custom"><option value="custom">Custom range…</option></optgroup>
          </select>
        </SheetField>
        {custom && (
          <SheetField label="Custom range">
            <div className="m-field-row">
              <input type="date" aria-label="From date" value={filters.from} onChange={e => setFilters({ from: e.target.value })} />
              <input type="date" aria-label="To date" value={filters.to} onChange={e => setFilters({ to: e.target.value })} />
            </div>
          </SheetField>
        )}
      </Sheet>

      <ActionSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Tax Ledger"
        actions={[
          { label: 'Detailed tables', icon: Table2, hint: 'Summary, monthly, clients and reports', onClick: onFull },
          canShare && { label: 'Share this view', icon: Share2, onClick: onShare },
          canShare && { label: 'Shared links', icon: Link2, onClick: onLinks },
          { label: exporting ? 'Exporting…' : 'Export CSV', icon: Download, disabled: exporting, onClick: onExport },
          { label: 'Print', icon: Printer, onClick: onPrint },
          { label: 'Refresh', icon: RefreshCw, disabled: loading, onClick: refresh },
        ]}
      />
    </div>
  )
}
