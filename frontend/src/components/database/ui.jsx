import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { chipStyle } from './dbModel'

/**
 * A popover anchored to its parent element and drawn in a portal, so a
 * scrolling table or board does not clip it. Closes on an outside press or
 * Escape, and hands focus back to where it came from.
 */
export function Popover({ onClose, children, align = 'left', label, style, className = '' }) {
  const ref = useRef(null)
  const anchorRef = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const place = () => {
      const host = anchorRef.current?.parentElement
      if (!host) return
      const r = host.getBoundingClientRect()
      const vw = window.innerWidth || document.documentElement.clientWidth || 1024
      const vh = window.innerHeight || document.documentElement.clientHeight || 768
      const w = ref.current?.offsetWidth || 260
      const h = ref.current?.offsetHeight || 200
      let left = align === 'right' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, vw - w - 8))
      let top = r.bottom + 4
      if (top + h > vh - 8 && r.top - h - 4 > 8) top = r.top - h - 4
      setPos({ top, left })
    }
    place()
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(place) : null
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      if (raf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [align])

  useEffect(() => {
    const prev = document.activeElement
    const down = (e) => {
      const host = anchorRef.current?.parentElement
      if (ref.current?.contains(e.target) || host?.contains(e.target)) return
      onClose?.()
    }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    const first = ref.current?.querySelector('input,select,textarea,button')
    first?.focus?.({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pop = (
    <div className="fdb" style={{ position: 'static' }}>
      <div ref={ref} role="dialog" aria-label={label} className={`fdb-pop ${className}`}
        style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, ...style }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
  return (
    <>
      <span ref={anchorRef} hidden />
      {typeof document !== 'undefined' ? createPortal(pop, document.body) : pop}
    </>
  )
}

export function Chip({ option, onRemove }) {
  if (!option) return null
  return (
    <span className="fdb-chip" style={chipStyle(option.color)}>
      {option.name}
      {onRemove && (
        <button type="button" aria-label={`Remove ${option.name}`} onClick={onRemove}
          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', lineHeight: 1 }}>×</button>
      )}
    </span>
  )
}
