import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus } from 'lucide-react'
import { PageGlyph } from '../pagetree/PageGlyph'

// Ctrl/Cmd+K: jump to any page by its title. Arrow keys move, Enter opens,
// Escape closes. With nothing typed it lists the most recently edited pages.

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Pages whose title holds every word typed, best matches first. */
export function matchPages(pages, query, limit = 30) {
  const q = norm(query).trim()
  const list = (pages || []).filter(p => p && p.id)
  const at = (p) => Date.parse(p.updated_at || p.created_at || '') || 0
  if (!q) return [...list].sort((a, b) => at(b) - at(a)).slice(0, limit)
  const words = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const p of list) {
    const t = norm(p.title || 'Untitled')
    if (!words.every(w => t.includes(w))) continue
    const score = t === q ? 0 : t.startsWith(q) ? 1 : t.split(/[^a-z0-9]+/).some(w => w.startsWith(words[0])) ? 2 : 3
    scored.push([score, -at(p), p])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return scored.slice(0, limit).map(s => s[2])
}

export default function QuickSwitcher({ open, pages, onOpen, onCreate, onClose }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const results = useMemo(() => (open ? matchPages(pages, q) : []), [open, pages, q])

  useEffect(() => {
    if (!open) return
    setQ(''); setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  if (!open || typeof document === 'undefined') return null
  const total = results.length + (onCreate && q.trim() ? 1 : 0)
  const choose = (i) => {
    if (i < results.length) { onOpen(results[i]); onClose() }
    else if (onCreate && q.trim()) { onCreate(q.trim()); onClose() }
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (total ? (a + 1) % total : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (total ? (a - 1 + total) % total : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }

  return createPortal(
    <div onMouseDown={onClose} style={{ position:'fixed', inset:0, zIndex:3000, background:'rgba(0,0,0,0.4)', display:'flex', justifyContent:'center', alignItems:'flex-start', padding:'12vh 16px 16px' }}>
      <div role="dialog" aria-label="Go to page" aria-modal="true" onMouseDown={e => e.stopPropagation()} className="app-pop"
        style={{ width:'100%', maxWidth:560, background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:14, boxShadow:'0 24px 64px rgba(0,0,0,0.3)', overflow:'hidden', display:'flex', flexDirection:'column', maxHeight:'70vh' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
          <Search size={15} style={{ color:'var(--text-3)', flexShrink:0 }} />
          <input ref={inputRef} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded="true" aria-controls="ft-qs-list" aria-label="Search pages by title"
            aria-activedescendant={total ? `ft-qs-${active}` : undefined}
            placeholder="Go to a page…"
            style={{ flex:1, minWidth:0, border:'none', outline:'none', background:'transparent', color:'var(--text-1)', fontSize:15 }} />
          <kbd style={{ fontSize:10, color:'var(--text-3)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 5px', fontFamily:'inherit' }}>Esc</kbd>
        </div>
        <ul id="ft-qs-list" ref={listRef} role="listbox" aria-label="Pages" style={{ listStyle:'none', margin:0, padding:6, overflowY:'auto' }}>
          {!q.trim() && results.length > 0 && (
            <li role="presentation" style={{ padding:'4px 10px', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-3)' }}>Recently edited</li>
          )}
          {results.map((p, i) => (
            <li key={p.id} id={`ft-qs-${i}`} data-idx={i} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px', borderRadius:8, cursor:'pointer', background: i === active ? 'var(--card-bg)' : 'transparent', color:'var(--text-1)', fontSize:13.5 }}>
              <PageGlyph node={p} />
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title || 'Untitled'}</span>
            </li>
          ))}
          {q.trim() && !results.length && (
            <li role="presentation" style={{ padding:'10px', fontSize:13, color:'var(--text-2)' }}>No page is called that.</li>
          )}
          {onCreate && q.trim() && (
            <li id={`ft-qs-${results.length}`} data-idx={results.length} role="option" aria-selected={active === results.length}
              onMouseEnter={() => setActive(results.length)} onClick={() => choose(results.length)}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px', borderRadius:8, cursor:'pointer', background: active === results.length ? 'var(--card-bg)' : 'transparent', color:'var(--text-2)', fontSize:13.5 }}>
              <Plus size={14} /> New page “{q.trim()}”
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
