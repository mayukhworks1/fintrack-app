/**
 * Projects on a phone (≤640px): insight cards (projects at a loss or at
 * risk), a summary card (share of projects on track, and the portfolio's
 * health as one split bar),
 * All / Active / Completed / On hold segments over the status filter, search
 * with a Filters sheet (status, client, sort) and one grouped list. A row is
 * the client's avatar, the project, then client · status · margin, then
 * billed over a health pill;
 * tapping opens the project. Same URL filters and server query as desktop.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, ExternalLink, Eye, RefreshCw, FolderKanban, SearchX } from 'lucide-react'
import {
  HeaderActions, RoundIconButton, SummaryCard, SegmentedControl, SearchFilterBar, AppliedFilters,
  GroupedList, ListRow, SkeletonRows, InlineAddRow, ShowMoreRow, Sheet, SheetField, ActionSheet,
} from '../../components/mobile/MobileUI'
import { projectSummary } from '../../components/mobile/summary'
import { formatInr, formatPct } from '../../utils/format'
import { Avatar, EmptyState, ShareBar } from '../../components/mobile/Visuals'
import InsightCards, { useInsights } from '../../components/mobile/InsightCards'

export const PROJECT_SEGMENTS = [
  { value: '', label: 'All' },
  { value: '🟢 Active', label: 'Active' },
  { value: '✅ Completed', label: 'Done' },
  { value: '⏸️ On Hold', label: 'On hold' },
]

/** A status without its leading emoji: "🟢 Active" reads "Active". */
export const plainStatus = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

/** One project as a row: avatar; name; client · status · margin; billed over a health pill. */
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
    leading: <Avatar name={f['Client'] || f['Project Name'] || '?'} />,
    pill: negative
      ? { tone: 'negative', text: 'Loss', label: 'Negative margin' }
      : health === 'Critical' || health.includes('🔴')
        ? { tone: 'negative', text: plainStatus(health) || 'Critical', label: health }
        : health === 'At Risk'
          ? { tone: 'warning', text: 'At risk', label: 'At Risk' }
          : health
            ? { tone: 'positive', text: plainStatus(health), label: health }
            : { tone: 'neutral', text: 'Untracked', label: 'Health not tracked' },
  }
}

/** The portfolio's health as one split bar: on track, at risk, critical, untracked. */
export function healthParts(byHealth) {
  const h = byHealth || {}
  let ok = 0, risk = 0, critical = 0, none = 0
  for (const [k, n] of Object.entries(h)) {
    const v = Number(n) || 0
    if (k === 'Unknown' || !k) none += v
    else if (k === 'At Risk') risk += v
    else if (k === 'Critical' || k.includes('🔴')) critical += v
    else ok += v
  }
  return [
    { key: 'ok', label: 'Healthy', value: ok, tone: 'var(--fin-positive)' },
    { key: 'risk', label: 'At risk', value: risk, tone: 'var(--fin-warning)' },
    { key: 'critical', label: 'Critical', value: critical, tone: 'var(--fin-negative)' },
    { key: 'none', label: 'Untracked', value: none, tone: 'var(--border-strong)' },
  ]
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
  const { data: insights } = useInsights('projects')
  const scopeTotals = hasFilters && agg ? agg : ws

  return (
    <div className="m-page">
      <HeaderActions>
        <RoundIconButton icon={MoreHorizontal} label="Project actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
      </HeaderActions>

      <InsightCards cards={insights?.cards} />

      <SummaryCard loading={!ws} value={summary?.value} ringLabel={summary?.ringLabel} title={summary?.title} sentence={summary?.sentence}
        visual={scopeTotals?.count ? <ShareBar title="Health" parts={healthParts(scopeTotals.by_health)} /> : null} />

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
          ? <SkeletonRows count={6} avatar pill />
          : records.length === 0
            ? (
              <EmptyState
                icon={hasFilters ? SearchX : FolderKanban}
                title={hasFilters ? 'No projects match' : 'No projects yet'}
                action={hasFilters && <button type="button" onClick={clearAll}>Clear filters</button>}
              >
                {hasFilters ? 'Nothing matches the current search and filters.' : 'Create a project to start tracking it.'}
              </EmptyState>
            )
            : records.map(r => {
              const row = projectRowProps(r)
              return <ListRow key={r.id} {...row} onClick={() => navigate(`/projects/${r.id}`)} ariaLabel={`${row.title}, ${row.pill.label}, ${row.value} billed`} />
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
