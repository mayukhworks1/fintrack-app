import { useMemo, useState } from 'react'
import { CornerLeftUp } from 'lucide-react'
import Modal from '../Modal'
import { descendantIds, flatten } from './treeModel'
import { PageGlyph } from './PageGlyph'

// The keyboard (and touch) way to do what dragging does: pick the page this
// one should live under, or the top level. The page itself and its own
// sub-pages are not offered, so a cycle cannot be chosen.
export default function MovePicker({ open, tree, node, onPick, onClose }) {
  const [q, setQ] = useState('')
  const options = useMemo(() => {
    if (!tree || !node) return []
    const banned = descendantIds(tree, node.id)
    banned.add(node.id)
    return flatten(tree).filter(({ node: n }) => !banned.has(n.id))
  }, [tree, node])
  const needle = q.trim().toLowerCase()
  const shown = needle ? options.filter(o => (o.node.title || 'untitled').toLowerCase().includes(needle)) : options
  const currentParent = node?.parent_id || null

  const row = (key, label, depth, onClick, opts = {}) => (
    <li key={key}>
      <button type="button" onClick={onClick} disabled={opts.disabled} aria-label={opts.aria || label}
        style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', paddingLeft:10 + depth * 16,
          border:'none', borderRadius:8, background:'transparent', color:'var(--text-1)', fontSize:13, textAlign:'left',
          cursor: opts.disabled ? 'default' : 'pointer', opacity: opts.disabled ? 0.5 : 1 }}
        onMouseEnter={e => { if (!opts.disabled) e.currentTarget.style.background = 'var(--bg-base)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
        {opts.icon}
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
        {opts.disabled && <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text-3)' }}>current</span>}
      </button>
    </li>
  )

  return (
    <Modal open={open} onClose={onClose} title="Move to…" subtitle={node?.title || 'Untitled'} width={420}>
      <input autoFocus aria-label="Search pages to move into" placeholder="Search pages…" value={q} onChange={e => setQ(e.target.value)}
        style={{ display:'block', width:'100%', boxSizing:'border-box', padding:'8px 10px', marginBottom:8, border:'1px solid var(--border)', borderRadius:9, background:'var(--card-bg)', color:'var(--text-1)', fontSize:13 }} />
      <ul aria-label="Destinations" style={{ listStyle:'none', margin:0, padding:0, maxHeight:340, overflowY:'auto' }}>
        {!needle && row('__top', 'Top level', 0, () => onPick(null), {
          aria: 'Move to the top level', disabled: currentParent === null,
          icon: <CornerLeftUp size={14} style={{ color:'var(--text-3)', flexShrink:0 }} />,
        })}
        {shown.map(({ node: n, depth }) => row(n.id, n.title || 'Untitled', needle ? 0 : depth, () => onPick(n.id), {
          aria: `Move into ${n.title || 'Untitled'}`, disabled: n.id === currentParent,
          icon: <PageGlyph node={n} />,
        }))}
        {!shown.length && needle && <li style={{ padding:'10px', fontSize:13, color:'var(--text-2)' }}>No pages match.</li>}
      </ul>
    </Modal>
  )
}
