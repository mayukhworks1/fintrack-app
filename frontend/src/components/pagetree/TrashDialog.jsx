import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import { api } from '../../services/api'
import { useConfirm } from '../../context/ConfirmContext'
import { PageGlyph } from './PageGlyph'

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
}

// Trashed pages, each with the sub-pages that went in with it. Restore puts
// the page back where it was (or at the top level if its parent is gone);
// "Delete forever" asks first, because it cannot be undone.
export default function TrashDialog({ open, onClose, onChanged }) {
  const confirm = useConfirm()
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')

  const load = async () => {
    setErr('')
    try { setItems(await api.pageTree.trash()) } catch (e) { setItems([]); setErr(e?.message || 'Could not load the trash') }
  }
  useEffect(() => { if (open) { setItems(null); load() } }, [open])

  const restore = async (it) => {
    setBusy(it.id)
    try {
      await api.pageTree.restore(it.id)
      setItems(prev => prev.filter(x => x.id !== it.id))
      onChanged?.(`Restored “${it.title || 'Untitled'}”`)
    } catch (e) { setErr(e?.message || 'Restore failed') } finally { setBusy(null) }
  }

  const destroy = async (it) => {
    const ok = await confirm({
      title: 'Delete forever',
      message: `Permanently delete “${it.title || 'Untitled'}” and its sub-pages? Their view history goes too. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(it.id)
    try {
      await api.pageTree.deleteForever(it.id)
      setItems(prev => prev.filter(x => x.id !== it.id))
      onChanged?.('Deleted forever')
    } catch (e) { setErr(e?.message || 'Delete failed') } finally { setBusy(null) }
  }

  const btn = { display:'inline-flex', alignItems:'center', gap:5, padding:'5px 9px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border:'1px solid var(--border)', background:'var(--card-bg)', color:'var(--text-1)' }

  return (
    <Modal open={open} onClose={onClose} title="Trash" subtitle="Pages moved to the trash are hidden from lists and their public links." width={480}>
      {err && <div role="alert" style={{ marginBottom:10, fontSize:12.5, color:'var(--fin-negative)' }}>{err}</div>}
      {items === null ? (
        <div style={{ padding:'14px 4px', fontSize:13, color:'var(--text-2)' }}>Loading…</div>
      ) : !items.length ? (
        <div style={{ padding:'24px 4px', fontSize:13, color:'var(--text-2)', textAlign:'center' }}>The trash is empty.</div>
      ) : (
        <ul aria-label="Trashed pages" style={{ listStyle:'none', margin:0, padding:0, maxHeight:380, overflowY:'auto' }}>
          {items.map(it => (
            <li key={it.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 4px', borderBottom:'1px solid var(--border)' }}>
              <PageGlyph node={it} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.title || 'Untitled'}</div>
                <div style={{ fontSize:11, color:'var(--text-3)' }}>Trashed {when(it.deleted_at)}</div>
              </div>
              <button type="button" style={btn} disabled={busy === it.id} onClick={() => restore(it)} aria-label={`Restore ${it.title || 'Untitled'}`}>
                <RotateCcw size={12} /> Restore
              </button>
              <button type="button" style={{ ...btn, color:'var(--fin-negative)' }} disabled={busy === it.id} onClick={() => destroy(it)} aria-label={`Delete ${it.title || 'Untitled'} forever`}>
                <Trash2 size={12} /> Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
