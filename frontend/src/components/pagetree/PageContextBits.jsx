import { useEffect, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { api } from '../../services/api'
import { PageGlyph } from './PageGlyph'

// Breadcrumbs for the editor: where this page sits in the tree. `crumbs`
// (from the page's context) saves a request; `inline` draws them in the
// editor's top bar, where the current page's title always shows. Above the
// editor (not inline) nothing is shown for a top-level page.
export function PageBreadcrumbs({ pageId, crumbs: given, title, onOpen, inline = false }) {
  const [fetched, setFetched] = useState([])
  useEffect(() => {
    let live = true
    setFetched([])
    if (pageId && !given && api.pageTree) {
      api.pageTree.breadcrumbs(pageId).then(c => { if (live && Array.isArray(c)) setFetched(c) }).catch(() => {})
    }
    return () => { live = false }
  }, [pageId, given])
  const crumbs = given || fetched
  if (!crumbs.length && !inline) return null
  const style = inline
    ? { display:'flex', alignItems:'center', gap:2, fontSize:13, color:'var(--text-2)', overflow:'hidden', whiteSpace:'nowrap', minWidth:0 }
    : { display:'flex', alignItems:'center', gap:2, padding:'6px 20px', fontSize:12, color:'var(--text-2)', borderBottom:'1px solid var(--border)', overflowX:'auto', whiteSpace:'nowrap', flexShrink:0 }
  return (
    <nav aria-label="Breadcrumb" style={style}>
      {crumbs.map(c => (
        <span key={c.id} style={{ display:'inline-flex', alignItems:'center', gap:2, minWidth:0, flexShrink: inline ? 1 : 0 }}>
          <button type="button" onClick={() => onOpen?.(c)}
            style={{ all:'unset', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4, padding:'2px 5px', borderRadius:5, color:'var(--text-2)', overflow:'hidden', textOverflow:'ellipsis', maxWidth:180 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-base)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            {c.icon && <span aria-hidden="true">{c.icon}</span>}{c.title || 'Untitled'}
          </button>
          <ChevronRight size={12} aria-hidden="true" style={{ color:'var(--text-3)', flexShrink:0 }} />
        </span>
      ))}
      <span aria-current="page" style={{ padding:'2px 5px', color:'var(--text-1)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>{title || (pageId ? 'Untitled' : 'New page')}</span>
    </nav>
  )
}

// The page's direct sub-pages, under the editor, with a quick way to add one.
// `initial` (the context's children) saves a request.
export function SubPagesList({ pageId, initial, onOpen, onAdd }) {
  const [kids, setKids] = useState(Array.isArray(initial) ? initial : null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let live = true
    if (Array.isArray(initial)) { setKids(initial); return }
    setKids(null)
    if (pageId && api.pageTree) {
      api.pageTree.children(pageId).then(k => { if (live) setKids(Array.isArray(k) ? k : []) }).catch(() => { if (live) setKids([]) })
    }
    return () => { live = false }
  }, [pageId, initial])
  if (!pageId || !api.pageTree || kids === null) return null
  return (
    <section aria-label="Sub-pages" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderTop:'1px solid var(--border)', background:'var(--card-bg)', flexShrink:0, overflowX:'auto' }}>
      <span style={{ fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-3)', marginRight:4, whiteSpace:'nowrap' }}>
        Sub-pages{kids.length ? ` · ${kids.length}` : ''}
      </span>
      {kids.map(k => (
        <button key={k.id} type="button" onClick={() => onOpen?.(k)} title={k.title || 'Untitled'}
          style={{ display:'inline-flex', alignItems:'center', gap:5, maxWidth:200, padding:'4px 9px', borderRadius:999, border:'1px solid var(--border)', background:'var(--bg-base)', color:'var(--text-1)', fontSize:12, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}>
          <PageGlyph node={k} size={12} />
          <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{k.title || 'Untitled'}</span>
        </button>
      ))}
      {onAdd && (
        <button type="button" disabled={adding}
          onClick={async () => { if (adding) return; setAdding(true); try { await onAdd(pageId) } finally { setAdding(false) } }}
          style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 9px', borderRadius:999, border:'1px dashed var(--border)', background:'transparent', color:'var(--text-2)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
          <Plus size={12} /> Add sub-page
        </button>
      )}
    </section>
  )
}
