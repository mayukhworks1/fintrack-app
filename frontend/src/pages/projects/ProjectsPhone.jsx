/**
 * Projects on a phone (≤640px): a summary card (share of projects on track),
 * All / Active / Completed / On hold segments over the status filter, search
 * with a Filters sheet (status, client, sort) and one grouped list. A row is
 * the project, then client · status · margin, then billed and a health dot;
 * tapping opens the project. Same URL filters and server query as desktop.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, ExternalLink, Eye, RefreshCw } from 'lucide-react'
import {
  HeaderActions, RoundIconButton, SummaryCard, SegmentedControl, SearchFilterBar, AppliedFilters,
  GroupedList, ListRow, SkeletonRows, InlineAddRow, ShowMoreRow, Sheet, SheetField, ActionSheet,
} from '../../components/mobile/MobileUI'
import { projectSummary } from '../../components/mobile/summary'
import { formatInr, formatPct } from '../../utils/format'

export const PROJECT_SEGMENTS = [
  { value: '', label: 'All' },
  { value: '🟢 Active', label: 'Active' },
  { value: '✅ Completed', label: 'Done' },
  { value: '⏸️ On Hold', label: 'On hold' },
]

/** A status without its leading emoji: "🟢 Active" reads "Active". */
export const plainStatus = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

/** One project as a row: name; client · status · margin; billed and a health dot. */
export function projectRowProps(r) {
  const f = r.fields || {}
  const profit = Number(f['Profit percentage'])
  const health = f['Health'] || ''
  const negative = Number.isFinite(profit) && profit < 0
  const tone = negative || health === 'Critical' || health.includes('🔴')
    ? 'var(--fin-negative)'
    : health === 'At Risk'
      ? 'var(--fin-warning)'
      : health ? 'var(--fin-positive)' : 'var(--text-3)'
  return {
    title: f['Project Name'] || 'Untitled project',
    meta: [f['Client'], plainStatus(f['Project Status']), Number.isFinite(profit) && f['Profit percentage'] != null ? `${formatPct(profit, 1)} margin` : ''],
    value: formatInr(f['Amount Billed So far'] || 0),
    dot: tone,
    dotLabel: negative ? 'Negative margin' : health || 'Health not tracked',
  }
}

const SORTS = [
  ['Amount Billed So far', 'Highest billed'],
  ['Profit percentage', 'Profit %'],
  ['Target Revenue', 'Target revenue'],
]

export default function ProjectsPhone({
  filters, setFilters, searchInput, setSearchInput, commitSearch, clearAll, hasFilters,
  records, total, nextCursor, loadMore, loadingMore, hasData, ws, agg, error, refresh, refreshing,
  isEditor, statusOptions, clientOptions, onShare, onLinks, pageSize,
}) {
  const navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const segment = PROJECT_SEGMENTS.some(s => s.value === filters.status) ? filters.status : null
  const chips = [
    segment == null && filters.status && { key: 'status', label: `Status: ${plainStatus(filters.status)}`, onClear: () => setFilters({ status: '' }) },
    filters.client && { key: 'client', label: `Client: ${filters.client}`, onClear: () => setFilters({ client: '' }) },
  ].filter(Boolean)
  // The card follows the search and filters, like the desktop's cards.
  const summary = projectSummary(hasFilters && agg ? agg : ws)

  return (
    <div className="m-page">
      <HeaderActions>
        <RoundIconButton icon={MoreHorizontal} label="Project actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
      </HeaderActions>

      <SummaryCard loading={!ws} value={summary?.value} ringLabel={summary?.ringLabel} title={summary?.title} sentence={summary?.sentence} />

      <SegmentedControl label="Project status" options={PROJECT_SEGMENTS} value={segment} onChange={v => setFilters({ status: v })} />

      <SearchFilterBar
        label="Search projects"
        placeholder="Project or client"
        value={searchInput}
        onChange={v => { setSearchInput(v); setFilters({ q: v.trim() }, { replace: true }) }}
        onSubmit={commitSearch}
        filterCount={chips.length}
        filtersOpen={filtersOpen}
        onFilters={() => setFiltersOpen(true)}
      />
      <AppliedFilters chips={chips} />

      {isEditor && <InlineAddRow label="New project" onClick={() => navigate('/projects/new')} />}

      {error && (
        <div role="alert" className="m-note is-error">
          {error} <button type="button" onClick={refresh} style={{ textDecoration: 'underline', minHeight: 0 }}>Retry</button>
        </div>
      )}

      <GroupedList title={hasData ? `${total.toLocaleString('en-IN')} project${total === 1 ? '' : 's'}` : 'Projects'} label="Projects">
        {!hasData
          ? <SkeletonRows count={6} />
          : records.length === 0
            ? (
              <li className="m-empty">
                <strong>{hasFilters ? 'No projects match' : 'No projects yet'}</strong>
                {hasFilters ? 'Nothing matches the current search and filters.' : 'Create a project to start tracking it.'}
                {hasFilters && <div><button type="button" onClick={clearAll}>Clear filters</button></div>}
              </li>
            )
            : records.map(r => {
              const row = projectRowProps(r)
              return <ListRow key={r.id} {...row} onClick={() => navigate(`/projects/${r.id}`)} ariaLabel={`${row.title}, ${row.dotLabel}, ${row.value} billed`} />
            })}
      </GroupedList>

      {hasData && records.length > 0 && (
        <ShowMoreRow shown={records.length} total={total} hasMore={!!nextCursor} loading={loadingMore} onMore={loadMore} step={pageSize} />
      )}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => { clearAll(); setFiltersOpen(false) }} disabled={!hasFilters}>Clear all</button>
            <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={() => setFiltersOpen(false)}>
              Show {total.toLocaleString('en-IN')} result{total === 1 ? '' : 's'}
            </button>
          </div>
        }
      >
        <SheetField label="Status">
          <select value={filters.status} onChange={e => setFilters({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </SheetField>
        <SheetField label="Client">
          <select value={filters.client} onChange={e => setFilters({ client: e.target.value })} aria-label="Client">
            <option value="">All clients</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </SheetField>
        <SheetField label="Sort by">
          <select value={filters.sort} onChange={e => setFilters({ sort: e.target.value })} aria-label="Sort by">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </SheetField>
      </Sheet>

      <ActionSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Projects"
        actions={[
          isEditor && { label: 'Share this view', icon: ExternalLink, onClick: onShare },
          isEditor && { label: 'Shared links', icon: Eye, onClick: onLinks },
          { label: 'Refresh', icon: RefreshCw, disabled: refreshing, onClick: refresh },
        ]}
      />
    </div>
  )
}
