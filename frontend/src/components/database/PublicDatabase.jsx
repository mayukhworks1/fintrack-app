import { useMemo, useState } from 'react'
import { DB_CSS } from './dbStyles'
import TableView from './TableView'
import BoardView from './BoardView'
import GalleryView from './GalleryView'
import CalendarView from './CalendarView'
import { viewRows } from './dbModel'
import { API_BASE_URL } from '../../services/api'

const noop = () => {}
// Rows drawn at a time in a table, board or gallery (a calendar shows a month).
const STEP = 100

/**
 * A published database, read-only: its saved views as tabs (the default one
 * first shown), filtered and sorted as saved. A row links to its own page
 * only when that page is published.
 */
export default function PublicDatabase({ page }) {
  const schema = page?.metadata?.database
  const rows = page?.database_rows || []
  const [viewId, setViewId] = useState(schema?.default_view)
  const [limit, setLimit] = useState(STEP)
  const view = schema?.views?.find(v => v.id === viewId) || schema?.views?.[0]
  const shown = useMemo(() => (view ? viewRows(rows, view, schema) : []), [rows, view, schema])
  if (!schema || !view) return <div style={{ color: 'var(--pv-mute)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>This database has no views.</div>

  const rowHref = (r) => (r.slug ? `/p/${encodeURIComponent(r.slug)}` : null)
  const paged = view.type === 'calendar' ? shown : shown.slice(0, limit)
  const common = { schema, view, rows: paged, total: shown.length, readOnly: true, rowHref, onUpdateView: noop, onAddRow: noop, apiBase: API_BASE_URL }

  return (
    <div className="fdb fdb-public" data-testid="public-database">
      <style>{DB_CSS}</style>
      {schema.views.length > 1 && (
        <div className="fdb-bar">
          <div className="fdb-tabs" role="tablist" aria-label="Views">
            {schema.views.map(v => (
              <button key={v.id} type="button" role="tab" className="fdb-tab" aria-selected={v.id === view.id} onClick={() => { setViewId(v.id); setLimit(STEP) }}>{v.name}</button>
            ))}
          </div>
        </div>
      )}
      <div role="tabpanel" aria-label={view.name}>
        {view.type === 'table' && <TableView {...common} />}
        {view.type === 'board' && <BoardView {...common} onMove={noop} />}
        {view.type === 'gallery' && <GalleryView {...common} />}
        {view.type === 'calendar' && <CalendarView {...common} onReschedule={noop} />}
      </div>
      {paged.length < shown.length && (
        <button type="button" className="fdb-add-row" onClick={() => setLimit(l => l + STEP)}>
          Show more ({shown.length - paged.length} more)
        </button>
      )}
    </div>
  )
}
