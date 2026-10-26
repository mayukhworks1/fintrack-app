import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'
import { api } from '../../services/api'

/** The page a link points at: its public address, which also opens it. */
export const pageHref = (p) => (p?.slug ? `/p/${encodeURIComponent(p.slug)}` : null)

/**
 * "Link to page": a search box over the page outline, anchored at the caret.
 * onPick(page) inserts the link; Escape or a press outside closes it.
 */
export default function PagePicker({ editor, excludeId, onPick, onClose }) {
  const [pages, setPages] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => api.pageLinks.tree())
      .then(res => { if (alive) setPages((res?.pages || []).filter(p => p.id !== excludeId)) })
      .catch(e => { if (alive) setError(e?.message || 'Could not load pages') })
    return () => { alive = false }
  }, [excludeId])

  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [onClose])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (pages || []).filter(p => !s || (p.title || 'Untitled').toLowerCase().includes(s)).slice(0, 30)
  }, [pages, q])
  useEffect(() => setActive(0), [q])

  const pos = useMemo(() => {
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.from)
      const w = Math.min(320, window.innerWidth - 16)
      return { left: Math.max(8, Math.min(c.left, window.innerWidth - w - 8)), top: c.bottom + 6, width: w }
    } catch { return { left: 16, top: 80, width: 300 } }
  }, [editor])

  const pick = (p) => { if (p) onPick(p) }

  return createPortal(
    <div ref={ref} className="ft-pop ft-page-picker" role="dialog" aria-label="Link to page"
      style={{ position: 'fixed', zIndex: 2600, ...pos }}>
      <input autoFocus className="ft-page-picker-input" placeholder="Search pages…" aria-label="Search pages" value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]) }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus() }
        }} />
      <div role="listbox" aria-label="Pages" className="ft-slash-list" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {error ? <div className="ft-slash-empty">{error}</div>
          : !pages ? <div className="ft-slash-empty">Loading pages…</div>
          : !shown.length ? <div className="ft-slash-empty">No pages match</div>
          : shown.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === active} data-active={i === active}
              className="ft-slash-item" onMouseDown={e => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => pick(p)}>
              <span className="ft-slash-icon">{p.icon ? <span aria-hidden="true">{p.icon}</span> : <FileText size={16} strokeWidth={1.75} />}</span>
              <span className="ft-slash-text"><span className="ft-slash-title">{p.title || 'Untitled'}</span>
                {!p.is_published && <span className="ft-slash-desc">Not published yet: the link works once it is</span>}</span>
            </button>
          ))}
      </div>
    </div>,
    document.body,
  )
}
