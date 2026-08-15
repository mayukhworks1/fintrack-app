import { useRef, useEffect } from 'react'
import { useFocusTrap } from './useFocusTrap'

/**
 * Dialog behaviour and semantics for hand-rolled overlays.
 *
 * Several screens render their own `fixed inset-0` panel rather than using
 * <Modal>, because their chrome and layout differ too much to swap wholesale.
 * They still need what a dialog needs: Tab confined to the panel, Escape to
 * dismiss, and the role/aria pair that makes a screen reader announce a dialog
 * has opened instead of silently reading the page behind it.
 *
 * Spread the returned props onto the panel element:
 *
 *   const dialog = useDialog({ label: 'Edit status', onClose })
 *   <div className="fixed inset-0 …">
 *     <div className="panel" {...dialog.panelProps}>…</div>
 *   </div>
 *
 * onClose is optional — pass it only when Escape should dismiss. Panels whose
 * close is guarded (unsaved changes, a running request) should leave it off and
 * keep their own handler.
 */
export function useDialog({ label, onClose, active = true } = {}) {
  const panelRef = useRef(null)

  useFocusTrap(panelRef, active)

  useEffect(() => {
    if (!active || !onClose) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onClose])

  // The panel carries the role rather than the backdrop wrapper: aria-modal
  // tells assistive tech to ignore everything outside this node, so it has to
  // sit on the element that actually contains the dialog content.
  return {
    panelRef,
    panelProps: {
      ref: panelRef,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': label,
      tabIndex: -1,
    },
  }
}
