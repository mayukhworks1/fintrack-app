/**
 * A sliding indicator under (or beside) the active item of a row or column.
 *
 *   const inkRef = useInk(activeIndex)                 // or useInk(i, { axis: 'y' })
 *   <div ref={inkRef} className="ft-m-ink" role="tablist">
 *     {tabs.map(t => <button role="tab" aria-selected={…}>…</button>)}
 *     <span className="ft-m-ink-bar" aria-hidden="true" />
 *   </div>
 *
 * It measures the active child — [aria-selected="true"], [aria-pressed="true"]
 * or [data-active] — and writes --ink-x, --ink-y, --ink-w and --ink-h (px)
 * plus --ink-sx / --ink-sy (unitless scale against a 100px bar) on the
 * container, and data-axis="x|y". The bar moves by transform only; under
 * reduced motion it jumps. Re-measures on resize (ResizeObserver, with a
 * window resize listener as fallback) and once web fonts have loaded. In a
 * row that scrolls sideways the bar scrolls with the items, so it needs no
 * scroll listener. Returns a callback ref that also carries `.current`.
 */
import { useCallback, useEffect, useLayoutEffect } from 'react'
import { useNodeRef } from './useInView'

const ACTIVE = '[aria-selected="true"], [aria-pressed="true"], [data-active]'

export function useInk(activeIndex, { axis = 'x' } = {}) {
  const [ref, node] = useNodeRef()

  const measure = useCallback(() => {
    const box = ref.current
    if (!box) return
    box.setAttribute('data-axis', axis === 'y' ? 'y' : 'x')
    const el = [...box.querySelectorAll(ACTIVE)].find(n => !n.classList.contains('ft-m-ink-bar'))
    if (!el) { box.removeAttribute('data-ink'); return }
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const x = r.left - b.left + box.scrollLeft
    const y = r.top - b.top + box.scrollTop
    const s = box.style
    s.setProperty('--ink-x', `${x}px`)
    s.setProperty('--ink-y', `${y}px`)
    s.setProperty('--ink-w', `${r.width}px`)
    s.setProperty('--ink-h', `${r.height}px`)
    s.setProperty('--ink-sx', String(r.width / 100))
    s.setProperty('--ink-sy', String(r.height / 100))
    if (!box.hasAttribute('data-ink')) {
      box.setAttribute('data-ink', '')
      // The bar appears in place on the first measure and only slides from
      // then on; data-ink-ready is what switches its transition on.
      requestAnimationFrame(() => box.setAttribute('data-ink-ready', ''))
    }
  }, [ref, axis])

  // Before paint, so the bar is never seen under the previous item first.
  useLayoutEffect(() => { measure() }, [measure, node, activeIndex])

  useEffect(() => {
    if (!node) return
    let frame = 0
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(later)
      ro.observe(node)
    }
    window.addEventListener('resize', later)
    // Web fonts change item widths after first paint.
    document.fonts?.ready?.then?.(later).catch?.(() => {})
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [node, measure])

  return ref
}
