import { CardFields } from './BoardView'

const PRESETS = {
  sunrise: 'linear-gradient(135deg,#fde68a,#f97316)',
  ocean: 'linear-gradient(135deg,#93c5fd,#2563eb)',
  forest: 'linear-gradient(135deg,#86efac,#15803d)',
  dusk: 'linear-gradient(135deg,#c4b5fd,#7c3aed)',
  slate: 'linear-gradient(135deg,#cbd5e1,#475569)',
  rose: 'linear-gradient(135deg,#fbcfe8,#db2777)',
}

/** The CSS background for a page cover: an https image, an uploaded asset or a preset. */
export function coverBackground(cover, apiBase = '') {
  if (!cover) return null
  if (cover.startsWith('preset:')) return PRESETS[cover.slice(7)] || PRESETS.slate
  const url = cover.startsWith('/api/') ? `${apiBase}${cover}` : cover
  if (!/^https:\/\//.test(url) && !url.startsWith('/api/')) return null
  return `url("${url.replace(/["\\\n\r]/g, '')}")`
}

export default function GalleryView({ schema, view, rows, readOnly, onOpenRow, onAddRow, rowHref, apiBase }) {
  const showCover = view.cover !== 'none'
  return (
    <div>
      <div className="fdb-gallery" role="list">
        {rows.map(row => {
          const bg = showCover ? coverBackground(row.cover, apiBase) : null
          const inner = (
            <>
              {showCover && (
                <div className="fdb-gcover" style={bg ? { backgroundImage: bg.startsWith('url(') ? bg : undefined, background: bg.startsWith('url(') ? undefined : bg } : undefined} aria-hidden="true">
                  {!bg && (row.icon || <span style={{ fontSize: 28, color: 'var(--db-mute)' }}>▤</span>)}
                </div>
              )}
              <div className="fdb-gbody">
                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {(!showCover || bg) && row.icon && <span aria-hidden="true" style={{ marginRight: 6 }}>{row.icon}</span>}
                  {row.title || 'Untitled'}
                </div>
                <CardFields schema={schema} view={view} row={row} />
              </div>
            </>
          )
          const href = rowHref?.(row)
          return (
            <div role="listitem" key={row.id} style={{ display: 'flex', minWidth: 0 }}>
              {readOnly
                ? (href ? <a className="fdb-gcard" href={href} style={{ textDecoration: 'none', flex: 1 }}>{inner}</a>
                  : <div className="fdb-gcard" style={{ cursor: 'default', flex: 1 }}>{inner}</div>)
                : <button type="button" className="fdb-gcard" style={{ flex: 1 }} onClick={() => onOpenRow?.(row)}>{inner}</button>}
            </div>
          )
        })}
      </div>
      {!rows.length && <div className="fdb-empty">No rows to show.</div>}
      {!readOnly && <button type="button" className="fdb-add-row" onClick={() => onAddRow()}>+ New</button>}
    </div>
  )
}
