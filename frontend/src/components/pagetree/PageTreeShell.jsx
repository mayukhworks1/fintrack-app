import { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, ListTree } from 'lucide-react'
import Drawer from '../Drawer'
import PageTreePanel from './PageTreePanel'

const OPEN_KEY = 'pages_tree_open'

// Lays the page tree beside the Pages screen: a collapsible left panel on a
// desktop, a drawer behind a button on a phone. Everything the panel needs is
// passed straight through. `fill` makes the column a full-height frame for
// the page editor instead of a scrolling list. Ctrl/Cmd+\ shows or hides it.
export default function PageTreeShell({ isMobile, children, fill = false, ...panel }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } })
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch {} }, [open])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key !== '\\' && e.code !== 'Backslash') return
      e.preventDefault()
      if (isMobile) setDrawer(d => !d)
      else setOpen(o => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobile])

  if (isMobile) {
    const close = (fn) => fn && ((...a) => { setDrawer(false); return fn(...a) })
    return (
      <div style={fill ? { height:'100%', display:'flex', flexDirection:'column' } : undefined}>
        {!fill && (
          <div style={{ padding:'12px 16px 0' }}>
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open page tree"
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:9, border:'1px solid var(--border)', background:'var(--card-bg)', color:'var(--text-1)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              <ListTree size={14} /> Page tree
            </button>
          </div>
        )}
        {fill ? <div style={{ flex:1, minHeight:0 }}>{children}</div> : children}
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Pages" width={320} accent={false}>
          <div style={{ height:'100%', padding:'4px 4px 0' }}>
            <PageTreePanel {...panel} onOpen={close(panel.onOpen)} onNewPage={close(panel.onNewPage)}
              onCreated={close(panel.onCreated)} onDuplicate={close(panel.onDuplicate)} />
          </div>
        </Drawer>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', alignItems:'flex-start', minHeight:'100%', ...(fill ? { height:'100%' } : {}) }}>
      {open ? (
        <aside aria-label="Page tree panel"
          style={{ width:264, flexShrink:0, position:'sticky', top:0, height: fill ? '100%' : '100vh', display:'flex', flexDirection:'column', borderRight:'1px solid var(--border)', background:'var(--card-bg)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 10px 4px 14px' }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--text-1)' }}>Workspace</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Hide page tree" title="Hide page tree (Ctrl+\)"
              style={{ all:'unset', cursor:'pointer', display:'inline-flex', padding:4, borderRadius:6, color:'var(--text-3)' }}>
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div style={{ flex:1, minHeight:0 }}>
            <PageTreePanel {...panel} />
          </div>
        </aside>
      ) : (
        <div style={{ position:'sticky', top:0, padding: fill ? '10px 0 0 8px' : '18px 0 0 10px', flexShrink:0 }}>
          <button type="button" onClick={() => setOpen(true)} aria-label="Show page tree" title="Show page tree (Ctrl+\)"
            style={{ all:'unset', cursor:'pointer', display:'inline-flex', padding:6, borderRadius:8, border:'1px solid var(--border)', background:'var(--card-bg)', color:'var(--text-2)' }}>
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}
      <div style={{ flex:1, minWidth:0, ...(fill ? { height:'100%' } : {}) }}>{children}</div>
    </div>
  )
}
