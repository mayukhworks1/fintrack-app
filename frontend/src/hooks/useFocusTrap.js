import { useEffect, useRef } from 'react'

// Elements that can hold focus. `[tabindex="-1"]` is deliberately excluded:
// it's focusable programmatically but must not be a Tab stop.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(root) {
  if (!root) return []
  const all = Array.from(root.querySelectorAll(FOCUSABLE))
  // offsetParent skips display:none subtrees; the rect check catches
  // visibility:hidden and zero-size elements that offsetParent still reports.
  const visible = all.filter(el => {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  })
  // Fall back to the unfiltered list when the visibility test rejects
  // everything. Layout-less environments (jsdom, and a panel measured mid
  // transition) report zero rects for every node, and an empty list would turn
  // Tab into a dead key — worse than trapping against a slightly stale set.
  return visible.length ? visible : all
}

/**
 * Confines Tab within `ref` while `active`, then restores focus on close.
 *
 * Without this, an open dialog leaves focus on the page behind it: Tab walks
 * through content the user cannot see, and dismissing the dialog drops focus to
 * the top of the document instead of the control that opened it.
 *
 * Focus moves to the first focusable child, or the container itself when the
 * dialog has no controls yet — so focus is never left outside the dialog.
 */
export function useFocusTrap(ref, active) {
  // Captured in a ref so the restore target survives re-renders while open.
  const restoreTo = useRef(null)

  useEffect(() => {
    if (!active) return
    restoreTo.current = document.activeElement

    const node = ref.current
    // Deferred a frame: on open the panel is still mid-transition and children
    // may not be laid out, so measuring focusables immediately finds nothing.
    const raf = requestAnimationFrame(() => {
      const targets = focusableWithin(node)
      if (targets.length) targets[0].focus()
      else node?.focus?.()
    })

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const targets = focusableWithin(ref.current)
      if (!targets.length) {
        // Nothing to cycle through — keep focus in the dialog rather than
        // letting Tab escape to the page behind.
        e.preventDefault()
        return
      }
      const first = targets[0]
      const last  = targets[targets.length - 1]
      const activeEl = document.activeElement

      // Focus sitting outside the dialog (or on the container itself) means the
      // cycle has no anchor — pull it back to whichever end Tab is heading for.
      if (!ref.current?.contains(activeEl) || activeEl === ref.current) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && activeEl === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      // Only restore if the element is still in the document and focusable —
      // it may have been unmounted by the very action that closed the dialog.
      const target = restoreTo.current
      if (target && document.contains(target) && typeof target.focus === 'function') {
        target.focus()
      }
    }
  }, [ref, active])
}

export default useFocusTrap
