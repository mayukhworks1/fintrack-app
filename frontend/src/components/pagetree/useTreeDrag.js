import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 5 // px of travel before a press becomes a drag

// Drag to reorder or nest, with plain pointer events. A row is a drop target
// in three bands: the top quarter drops before it, the bottom quarter after
// it, and the middle inside it. Touch is left to scroll the list; on a phone
// the "Move to…" picker does the same job.
export function useTreeDrag({ canDrop, onDrop }) {
  const [drag, setDrag] = useState(null) // { id, overId, zone, ok }
  const handlers = useRef({ canDrop, onDrop })
  handlers.current = { canDrop, onDrop }

  // One stable set of listeners for the life of the component, so the ones
  // removed are always the ones that were added.
  const engine = useRef(null)
  if (!engine.current) {
    const s = { press: null, drag: null, suppress: false }
    const update = (next) => { s.drag = next; setDrag(next) }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
      document.body.style.userSelect = ''
      s.press = null
      update(null)
    }
    function move(e) {
      const p = s.press
      if (!p) return
      if (!p.active) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return
        p.active = true
        document.body.style.userSelect = 'none'
      }
      const el = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('[data-tree-row]')
      if (!el) { update({ id: p.id, overId: null, zone: null, ok: false }); return }
      const overId = el.getAttribute('data-tree-row')
      const r = el.getBoundingClientRect()
      const rel = r.height ? (e.clientY - r.top) / r.height : 0.5
      const zone = rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'inside'
      update({ id: p.id, overId, zone, ok: !!handlers.current.canDrop(p.id, overId, zone) })
    }
    function up() {
      const p = s.press
      const d = s.drag
      if (p?.active) {
        s.suppress = true
        setTimeout(() => { s.suppress = false }, 0)
        if (d?.ok) handlers.current.onDrop(d.id, d.overId, d.zone)
      }
      stop()
    }
    function key(e) { if (e.key === 'Escape') stop() }
    const start = (id, e) => {
      s.press = { id, x: e.clientX, y: e.clientY, active: false }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('keydown', key)
    }
    engine.current = { s, start, stop }
  }

  useEffect(() => engine.current.stop, [])

  const rowProps = (id) => ({
    'data-tree-row': id,
    onPointerDown: (e) => {
      if (e.button !== 0 || e.pointerType === 'touch') return
      if (e.target.closest?.('[data-no-drag]')) return
      engine.current.start(id, e)
    },
    onClickCapture: (e) => {
      if (engine.current.s.suppress) { e.preventDefault(); e.stopPropagation() }
    },
  })

  return { drag, rowProps }
}
