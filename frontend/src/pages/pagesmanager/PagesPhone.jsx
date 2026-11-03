/**
 * The Pages list on a phone (≤640px): a summary card (share published, and
 * live / live with edits / drafts / expired as one split bar), All /
 * Live / Drafts / Expired segments, search with folder and sort in a Filters
 * sheet, an inline "New page" row and one grouped list. A row is the page's
 * type icon, its title, then folder · status · last edit · views, and a status
 * dot. Tapping opens the page; its "⋯" opens the page's actions (publish,
 * share, copy link, analytics, duplicate, move, trash) as a sheet.
 */
import { useState } from 'react'
import { MoreHorizontal, Puzzle, Database, Trash2, Search, ExternalLink, Share2, Link2, BarChart2, Copy, FolderInput, Globe, EyeOff, FileText, SearchX } from 'lucide-react'
import {
  HeaderActions, RoundIconButton, SummaryCard, SegmentedControl, SearchFilterBar, AppliedFilters,
  GroupedList, ListRow, InlineAddRow, Sheet, SheetField, ActionSheet, SkeletonRows,
} from '../../components/mobile/MobileUI'
import { pagesSummary, plural } from '../../components/mobile/summary'
import { EmptyState, ShareBar } from '../../components/mobile/Visuals'

export const PAGE_SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Live' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'expired', label: 'Expired' },
]

/** The pages by status, for the summary card's split bar. */
export function pageStatusParts(pages, isExpired = () => false) {
  const n = { live: 0, edits: 0, drafts: 0, expired: 0 }
  for (const p of pages || []) {
    if (isExpired(p)) n.expired++
    else if (p.is_published && p.has_unpublished_changes) n.edits++
    else if (p.is_published) n.live++
    else n.drafts++
  }
  return [
    { key: 'live', label: 'Live', value: n.live, tone: 'var(--fin-positive)' },
    { key: 'edits', label: 'Unpublished edits', value: n.edits, tone: 'var(--fin-warning)' },
    { key: 'drafts', label: 'Drafts', value: n.drafts, tone: 'var(--border-strong)' },
    { key: 'expired', label: 'Expired', value: n.expired, tone: 'var(--fin-negative)' },
  ]
}

/** A page's status as a dot colour and a word, the same rule as the desktop pill. */
export function pageStatus(page, expired) {
  if (expired) return { label: 'Expired', dot: 'var(--fin-negative)' }
  if (page.is_published && page.has_unpublished_changes) return { label: 'Live, unpublished edits', dot: 'var(--fin-warning)' }
  if (page.is_published) return { label: 'Live', dot: 'var(--fin-positive)' }
  return { label: 'Draft', dot: 'var(--text-3)' }
}

export default function PagesPhone({
  pages, visible, filtered, loading, error, onRetry, search, setSearch, filterTab, setFilterTab,
  folderFilter, setFolderFilter, folderCounts, unfiledCount, unfiled, sortBy, setSortBy, clearFilters,
  onOpen, onNew, onNewArtifact, onNewDatabase, onTrashOpen, onSwitcher, onPublish, onShare, onAnalytics,
  onDelete, onClone, onMove, onCopied, isExpired, typeIcon, relTime, onShowMore,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [rowPage, setRowPage] = useState(null)
  const chips = [
    folderFilter && { key: 'folder', label: folderFilter === unfiled ? 'No folder' : `Folder: ${folderFilter}`, onClear: () => setFolderFilter('') },
  ].filter(Boolean)
  const summary = pagesSummary(pages)

  const copyLink = (page) => {
    navigator.clipboard?.writeText(`${window.location.origin}/p/${page.slug}`).then(() => onCopied?.()).catch(() => {})
  }
  const rowActions = rowPage ? [
    { label: 'Open', icon: ExternalLink, onClick: () => onOpen(rowPage) },
    { label: rowPage.is_published ? 'Unpublish' : 'Publish', icon: rowPage.is_published ? EyeOff : Globe, onClick: () => onPublish(rowPage) },
    { label: 'Share and settings', icon: Share2, onClick: () => onShare(rowPage) },
    rowPage.is_published && { label: 'Copy public link', icon: Link2, onClick: () => copyLink(rowPage) },
    { label: 'Analytics', icon: BarChart2, onClick: () => onAnalytics(rowPage) },
    { label: 'Duplicate', icon: Copy, onClick: () => onClone(rowPage) },
    { label: 'Move to folder', icon: FolderInput, onClick: () => onMove(rowPage) },
    { label: 'Move to trash', icon: Trash2, tone: 'var(--fin-negative)', onClick: () => onDelete(rowPage) },
  ] : []

  return (
    <div className="m-page">
      <HeaderActions>
        <RoundIconButton icon={MoreHorizontal} label="Page actions" onClick={() => setActionsOpen(true)} aria-haspopup="dialog" />
      </HeaderActions>

      <SummaryCard loading={loading} value={summary.value} ringLabel={summary.ringLabel} title={summary.title} sentence={summary.sentence}
        visual={pages.length ? <ShareBar title="Status" parts={pageStatusParts(pages, isExpired)} /> : null} />

      <SegmentedControl label="Page status" options={PAGE_SEGMENTS} value={filterTab} onChange={setFilterTab} />

      <SearchFilterBar
        label="Search pages"
        placeholder="Title, link or folder"
        value={search}
        onChange={setSearch}
        filterCount={chips.length}
        filtersOpen={filtersOpen}
        onFilters={() => setFiltersOpen(true)}
      />
      <AppliedFilters chips={chips} />

      <InlineAddRow label="New page" onClick={onNew} />

      {error && !pages.length ? (
        <div role="alert" className="m-note is-error">
          Pages could not be loaded. <button type="button" onClick={onRetry} style={{ textDecoration: 'underline', minHeight: 0 }}>Retry</button>
        </div>
      ) : (
        <GroupedList title={loading ? 'Pages' : plural(filtered.length, 'page')} label="Pages">
          {loading
            ? <SkeletonRows count={4} avatar />
            : !filtered.length
              ? (
                <EmptyState
                  icon={pages.length ? SearchX : FileText}
                  title={pages.length ? 'No pages match' : 'No pages yet'}
                  action={pages.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}
                >
                  {pages.length ? 'Try other words or clear the filters.' : 'Create a doc, database or web page and share it by link.'}
                </EmptyState>
              )
              : visible.map(page => {
                const Icon = typeIcon(page)
                const status = pageStatus(page, isExpired(page))
                const views = page.view_count || 0
                return (
                  <ListRow
                    key={page.id}
                    leading={<span className="m-page-icon" aria-hidden="true">{page.icon || <Icon size={18} />}</span>}
                    title={page.title || 'Untitled'}
                    meta={[page.metadata?.folder, status.label, relTime(page.updated_at || page.created_at), views ? plural(views, 'view') : '']}
                    dot={status.dot}
                    onClick={() => onOpen(page)}
                    accessory={
                      <button type="button" className="m-row-more" onClick={() => setRowPage(page)}
                        aria-label={`Actions for ${page.title || 'page'}`} aria-haspopup="dialog">
                        <MoreHorizontal size={18} aria-hidden="true" />
                      </button>
                    }
                  />
                )
              })}
        </GroupedList>
      )}

      {!loading && filtered.length > visible.length && (
        <div className="m-more">
          <span>Showing {visible.length.toLocaleString('en-IN')} of {filtered.length.toLocaleString('en-IN')}</span>
          <button type="button" className="m-more-btn" onClick={onShowMore}>Show more</button>
        </div>
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters"
        footer={<button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setFiltersOpen(false)}>Show {plural(filtered.length, 'page')}</button>}>
        <SheetField label="Folder">
          <select value={folderFilter} onChange={e => setFolderFilter(e.target.value)} aria-label="Folder">
            <option value="">All folders ({pages.length})</option>
            {folderCounts.map(([f, n]) => <option key={f} value={f}>{f} ({n})</option>)}
            <option value={unfiled}>No folder ({unfiledCount})</option>
          </select>
        </SheetField>
        <SheetField label="Sort by">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort pages">
            <option value="updated">Recently edited</option>
            <option value="created">Newest first</option>
            <option value="views">Most viewed</option>
            <option value="title">Name A–Z</option>
          </select>
        </SheetField>
      </Sheet>

      <ActionSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Pages"
        actions={[
          { label: 'New artifact', icon: Puzzle, onClick: onNewArtifact },
          { label: 'New database', icon: Database, onClick: onNewDatabase },
          { label: 'Go to a page', icon: Search, onClick: onSwitcher },
          { label: 'Trash', icon: Trash2, onClick: onTrashOpen },
        ]}
      />
      <ActionSheet open={!!rowPage} onClose={() => setRowPage(null)} title={rowPage?.title || 'Page'} actions={rowActions} />
    </div>
  )
}
