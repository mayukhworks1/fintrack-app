import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight, Plus, MoreHorizontal, Star, StarOff, Trash2, PenLine,
  Smile, FolderInput, Clock, FilePlus2,
} from 'lucide-react'
import { api } from '../../services/api'
import { buildTree, dropPlacement, ancestorIds } from './treeModel'
import { useTreeDrag } from './useTreeDrag'
import { PageGlyph } from './PageGlyph'
import IconPicker from './IconPicker'
import MovePicker from './MovePicker'
import TrashDialog from './TrashDialog'

const EXPANDED_KEY = 'pages_tree_expanded'

function readExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]')) } catch { return new Set() }
}

const CSS = `
.pt-row { position:relative; display:flex; align-items:center; gap:2px; min-height:30px; border-radius:7px; padding-right:4px; }
.pt-row:hover { background:var(--bg-base); }
.pt-row[data-current="true"] { background:var(--bg-base); }
.pt-row[data-current="true"] .pt-title { font-weight:650; color:var(--text-1); }
.pt-actions { display:flex; gap:1px; opacity:0; transition:opacity .12s; }
.pt-row:hover .pt-actions, .pt-row:focus-within .pt-actions, .pt-actions[data-open="true"] { opacity:1; }
@media (hover:none) { .pt-actions { opacity:1; } }
.pt-icon-btn { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:5px; cursor:pointer; color:var(--text-3); flex-shrink:0; }
.pt-icon-btn:hover { background:var(--border); color:var(--text-1); }
.pt-icon-btn:focus-visible, .pt-title:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.pt-title { all:unset; box-sizing:border-box; flex:1; min-width:0; display:flex; align-items:center; gap:6px; padding:4px 2px; cursor:pointer; font-size:13px; color:var(--text-2); border-radius:5px; }
.pt-title span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pt-section { display:flex; align-items:center; gap:6px; padding:12px 8px 4px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--text-3); }
.pt-menu { position:absolute; right:4px; top:30px; z-index:30; width:200px; padding:5px; border-radius:10px; border:1px solid var(--border); background:var(--card-bg); box-shadow:0 12px 32px rgba(0,0,0,.16); }
.pt-menu button { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:9px; width:100%; padding:7px 10px; border-radius:7px; font-size:13px; cursor:pointer; color:var(--text-1); }
.pt-menu button:hover, .pt-menu button:focus-visible { background:var(--bg-base); }
`

function RowMenu({ node, isFav, onClose, actions }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    setTimeout(() => ref.current?.querySelector('button')?.focus(), 0)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])
  const item = (Icon, label, fn, danger) => (
    <button type="button" role="menuitem" onClick={() => { onClose(); fn(node) }} style={danger ? { color:'var(--fin-negative)' } : undefined}>
      <Icon size={14} strokeWidth={1.9} /> {label}
    </button>
  )
  return (
    <div ref={ref} role="menu" aria-label={`Actions for ${node.title || 'Untitled'}`} className="pt-menu" data-no-drag>
      {item(PenLine, 'Rename', actions.rename)}
      {item(Smile, 'Change icon…', actions.icon)}
      {item(FilePlus2, 'Add sub-page', actions.addChild)}
      {item(FolderInput, 'Move to…', actions.move)}
      {item(isFav ? StarOff : Star, isFav ? 'Remove from favourites' : 'Add to favourites', actions.favourite)}
      <div style={{ height:1, background:'var(--border)', margin:'4px 6px' }} />
      {item(Trash2, 'Move to trash', actions.trash, true)}
    </div>
  )
}

function RenameInput({ initial, onDone }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (save) => { if (done.current) return; done.current = true; onDone(save ? v.trim() : null) }
  return (
    <input autoFocus aria-label="Page name" value={v} onChange={e => setV(e.target.value)} data-no-drag
      onFocus={e => e.target.select()}
      onKeyDown={e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false) }}
      onBlur={() => finish(true)}
      style={{ flex:1, minWidth:0, fontSize:13, padding:'3px 6px', border:'1px solid var(--accent)', borderRadius:6, background:'var(--card-bg)', color:'var(--text-1)', outline:'none' }} />
  )
}

/**
 * The pages sidebar: Favourites, Recent, the nested outline and the Trash.
 *
 * Props: refreshKey (reload when it changes), currentId, onOpen(node),
 * onNewPage(), onCreated(page) after a sub-page is made, onChanged() after
 * anything that changes the flat list, onToast(msg, ok).
 */
export default function PageTreePanel({ refreshKey, currentId, onOpen, onNewPage, onCreated, onChanged, onToast }) {
  const [data, setData] = useState(null)
  const [recent, setRecent] = useState([])
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState(readExpanded)
  const [renaming, setRenaming] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  const [iconFor, setIconFor] = useState(null)
  const [moveFor, setMoveFor] = useState(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [showRecent, setShowRecent] = useState(true)

  const toast = (m, ok = true) => onToast?.(m, ok)
  const fail = (e, fallback) => toast(e?.message || fallback, false)

  const load = useCallback(async () => {
    if (!api.pageTree) return
    try {
      const [t, r] = await Promise.all([api.pageTree.tree(), api.pageTree.recent().catch(() => [])])
      setData(t && Array.isArray(t.pages) ? t : { ready: false, pages: [], favourites: [] })
      setRecent(Array.isArray(r) ? r : [])
      setErr('')
    } catch (e) {
      setErr(e?.message || 'Could not load pages')
    }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  useEffect(() => { try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])) } catch {} }, [expanded])

  const tree = useMemo(() => buildTree(data?.pages || []), [data])
  const ready = data?.ready !== false
  const favs = useMemo(() => new Set(data?.favourites || []), [data])

  // Keep the open page in view: expand the branch it sits in.
  useEffect(() => {
    if (!currentId || !tree.byId.has(currentId)) return
    const up = ancestorIds(tree, currentId)
    if (up.some(id => !expanded.has(id))) setExpanded(prev => new Set([...prev, ...up]))
  }, [currentId, tree]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id, open) => setExpanded(prev => {
    const n = new Set(prev)
    const willOpen = open ?? !n.has(id)
    willOpen ? n.add(id) : n.delete(id)
    return n
  })

  const changed = async (msg) => { await load(); onChanged?.(); if (msg) toast(msg) }

  const actions = {
    rename: (n) => setRenaming(n.id),
    icon: (n) => setIconFor(n),
    move: (n) => setMoveFor(n),
    addChild: async (n) => {
      try {
        const created = await api.pageTree.createChild(n.id, { title: 'Untitled' })
        toggle(n.id, true)
        await changed()
        onCreated?.(created)
      } catch (e) { fail(e, 'Could not add a sub-page') }
    },
    favourite: async (n) => {
      const on = !favs.has(n.id)
      try { await api.pageTree.favourite(n.id, on); await load(); toast(on ? 'Added to favourites' : 'Removed from favourites') }
      catch (e) { fail(e, 'Could not update favourites') }
    },
    trash: async (n) => {
      try { await api.pageTree.trashPage(n.id); await changed(`Moved “${n.title || 'Untitled'}” to the trash`) }
      catch (e) { fail(e, 'Could not move to the trash') }
    },
  }

  const doRename = async (id, title) => {
    setRenaming(null)
    const n = tree.byId.get(id)
    if (!title || !n || title === n.title) return
    setData(d => ({ ...d, pages: d.pages.map(p => p.id === id ? { ...p, title } : p) }))
    try { await api.pages.update(id, { title }); await changed() } catch (e) { fail(e, 'Rename failed'); load() }
  }

  const doIcon = async (icon) => {
    const n = iconFor
    setIconFor(null)
    if (!n) return
    try { await api.pageTree.appearance(n.id, { icon }); await load() } catch (e) { fail(e, 'Could not set the icon') }
  }

  const doMove = async (id, placement) => {
    try {
      await api.pageTree.move(id, placement)
      if (placement.parent_id) toggle(placement.parent_id, true)
      await changed()
    } catch (e) { fail(e, 'Move failed'); load() }
  }

  const { drag, rowProps } = useTreeDrag({
    canDrop: (dragId, overId, zone) => !!dropPlacement(tree, dragId, overId, zone),
    onDrop: (dragId, overId, zone) => {
      const placement = dropPlacement(tree, dragId, overId, zone)
      if (placement) doMove(dragId, placement)
    },
  })

  const renderNode = (n, depth) => {
    const kids = tree.childrenOf(n.id)
    const hasKids = kids.length > 0
    const open = hasKids && expanded.has(n.id)
    const isCurrent = n.id === currentId
    const over = drag && drag.overId === n.id && drag.id !== n.id
    const dropStyle = over && drag.ok
      ? drag.zone === 'inside' ? { background:'var(--bg-base)', boxShadow:'inset 0 0 0 2px var(--accent)' }
        : { boxShadow: `inset 0 ${drag.zone === 'before' ? '2px' : '-2px'} 0 0 var(--accent)` }
      : null
    const label = n.title || 'Untitled'
    return (
      <li key={n.id} role="treeitem" aria-level={depth + 1} aria-expanded={hasKids ? open : undefined} aria-selected={isCurrent}
        aria-label={label} style={{ listStyle:'none' }}>
        <div className="pt-row" data-current={isCurrent} {...rowProps(n.id)}
          style={{ paddingLeft: 4 + depth * 14, opacity: drag?.id === n.id ? 0.45 : 1, ...dropStyle }}>
          <button type="button" className="pt-icon-btn" data-no-drag tabIndex={-1}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`} onClick={() => toggle(n.id)}
            style={{ visibility: hasKids ? 'visible' : 'hidden' }}>
            <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition:'transform .12s' }} />
          </button>
          <button type="button" className="pt-icon-btn" data-no-drag tabIndex={-1} aria-label={`Change icon for ${label}`}
            title="Change icon" onClick={() => setIconFor(n)}>
            <PageGlyph node={n} />
          </button>
          {renaming === n.id ? (
            <RenameInput initial={n.title || ''} onDone={(t) => doRename(n.id, t)} />
          ) : (
            <button type="button" className="pt-title" title={label}
              onClick={() => onOpen?.(n)}
              onDoubleClick={() => setRenaming(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' && hasKids) { e.preventDefault(); toggle(n.id, true) }
                if (e.key === 'ArrowLeft' && hasKids) { e.preventDefault(); toggle(n.id, false) }
                if (e.key === 'F2') { e.preventDefault(); setRenaming(n.id) }
              }}>
              <span>{label}</span>
              {n.is_published && <span aria-label="Published" title="Published" style={{ width:6, height:6, borderRadius:'50%', background:'var(--fin-positive)', flexShrink:0 }} />}
            </button>
          )}
          <div className="pt-actions" data-open={menuFor === n.id} data-no-drag>
            <button type="button" className="pt-icon-btn" aria-label={`Add a sub-page to ${label}`} title="Add sub-page"
              onClick={() => actions.addChild(n)}>
              <Plus size={14} />
            </button>
            <button type="button" className="pt-icon-btn" aria-label={`Page options for ${label}`} aria-haspopup="menu"
              aria-expanded={menuFor === n.id} title="More" onClick={() => setMenuFor(m => m === n.id ? null : n.id)}>
              <MoreHorizontal size={14} />
            </button>
          </div>
          {menuFor === n.id && (
            <RowMenu node={n} isFav={favs.has(n.id)} onClose={() => setMenuFor(null)} actions={actions} />
          )}
        </div>
        {open && (
          <ul role="group" style={{ margin:0, padding:0 }}>
            {kids.map(k => renderNode(k, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const flatRow = (n, keyPrefix, extra) => (
    <li key={`${keyPrefix}-${n.id}`} style={{ listStyle:'none' }}>
      <div className="pt-row" data-current={n.id === currentId} style={{ paddingLeft:8 }}>
        <PageGlyph node={n} />
        <button type="button" className="pt-title" title={n.title || 'Untitled'} onClick={() => onOpen?.(n)}>
          <span>{n.title || 'Untitled'}</span>
        </button>
        {extra}
      </div>
    </li>
  )

  if (!api.pageTree) return null

  const roots = tree.childrenOf(null)
  const favNodes = (data?.favourites || []).map(id => tree.byId.get(id)).filter(Boolean)

  return (
    <nav aria-label="Page tree" style={{ display:'flex', flexDirection:'column', minHeight:0, height:'100%', fontSize:13 }}>
      <style>{CSS}</style>
      <div style={{ flex:1, minHeight:0, overflowY:'auto', padding:'4px 6px 8px' }}>
        {err && <div role="alert" style={{ margin:'8px', fontSize:12, color:'var(--fin-negative)' }}>{err}</div>}

        {favNodes.length > 0 && (
          <section aria-label="Favourites">
            <div className="pt-section"><Star size={11} /> Favourites</div>
            <ul style={{ margin:0, padding:0 }}>
              {favNodes.map(n => flatRow(n, 'fav'))}
            </ul>
          </section>
        )}

        {recent.length > 0 && (
          <section aria-label="Recent">
            <button type="button" className="pt-section" onClick={() => setShowRecent(s => !s)} aria-expanded={showRecent}
              style={{ all:'unset', boxSizing:'border-box', display:'flex', alignItems:'center', gap:6, width:'100%', padding:'12px 8px 4px', fontSize:10.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-3)', cursor:'pointer' }}>
              <Clock size={11} /> Recent
              <ChevronRight size={11} style={{ marginLeft:'auto', transform: showRecent ? 'rotate(90deg)' : 'none' }} />
            </button>
            {showRecent && (
              <ul style={{ margin:0, padding:0 }}>
                {recent.slice(0, 5).map(n => flatRow(n, 'recent'))}
              </ul>
            )}
          </section>
        )}

        <section aria-label="All pages">
          <div className="pt-section" style={{ justifyContent:'space-between' }}>
            <span>Pages</span>
            {onNewPage && (
              <button type="button" className="pt-icon-btn" aria-label="New page" title="New page" onClick={onNewPage}>
                <Plus size={13} />
              </button>
            )}
          </div>
          {!ready && (
            <div style={{ margin:'2px 8px 6px', fontSize:11.5, color:'var(--text-3)' }}>
              Nesting turns on once the database update has run.
            </div>
          )}
          {data === null && !err ? (
            <div style={{ padding:'6px 10px', fontSize:12, color:'var(--text-3)' }}>Loading…</div>
          ) : roots.length === 0 ? (
            <div style={{ padding:'6px 10px', fontSize:12, color:'var(--text-3)' }}>No pages yet.</div>
          ) : (
            <ul role="tree" aria-label="Pages" style={{ margin:0, padding:0 }}>
              {roots.map(n => renderNode(n, 0))}
            </ul>
          )}
        </section>
      </div>

      <div style={{ borderTop:'1px solid var(--border)', padding:6, flexShrink:0 }}>
        <button type="button" onClick={() => setTrashOpen(true)} disabled={!ready}
          style={{ all:'unset', boxSizing:'border-box', display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', borderRadius:7, fontSize:13, color:'var(--text-2)', cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5 }}>
          <Trash2 size={14} /> Trash
        </button>
      </div>

      <IconPicker open={!!iconFor} title={iconFor?.title} current={iconFor?.icon} onPick={doIcon} onClose={() => setIconFor(null)} />
      <MovePicker open={!!moveFor} tree={tree} node={moveFor}
        onPick={(parentId) => { const n = moveFor; setMoveFor(null); if (n) doMove(n.id, { parent_id: parentId }) }}
        onClose={() => setMoveFor(null)} />
      <TrashDialog open={trashOpen} onClose={() => setTrashOpen(false)} onChanged={(msg) => changed(msg)} />
    </nav>
  )
}
