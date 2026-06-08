/**
 * Modal — centred dialog with smooth enter/exit + consistent chrome.
 * On mobile it rises from the bottom (sheet pattern).
 *
 * Usage:
 *   <Modal open={open} onClose={() => setOpen(false)} title="Confirm" width={480}>
 *     <p>Are you sure?</p>
 *   </Modal>
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const DURATION = 220

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 480,
  zIndex = 50,
  hideClose = false,
}) {
  const [mounted, setMounted]  = useState(false)
  const [visible, setVisible]  = useState(false)
  const timerRef               = useRef(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else {
      setVisible(false)
      timerRef.current = setTimeout(() => setMounted(false), DURATION + 30)
    }
    return () => clearTimeout(timerRef.current)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
        style={{
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)',
          opacity: visible ? 1 : 0,
          transition: `opacity ${DURATION}ms cubic-bezier(0.4,0,0.2,1)`,
        }}
      />

      {/* Panel */}
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          /* Full-width + rounded top on mobile, centred card on sm+ */
          width: `min(100%, ${width}px)`,
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: 'var(--card-shadow)',
          transform: visible
            ? 'translateY(0) scale(1)'
            : 'translateY(32px) scale(0.98)',
          opacity: visible ? 1 : 0,
          transition: `transform ${DURATION}ms cubic-bezier(0.34,1.26,0.64,1), opacity ${DURATION}ms ease`,
          willChange: 'transform, opacity',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Drag handle on mobile */}
        <div
          className="sm:hidden flex justify-center pt-3 pb-0 flex-shrink-0"
          aria-hidden="true"
        >
          <div style={{ width: '2.5rem', height: '4px', borderRadius: '99px', background: 'var(--card-border)' }} />
        </div>

        {/* Header */}
        {(title || !hideClose) && (
          <div
            className="flex items-start justify-between gap-3 px-5 py-4 flex-shrink-0"
            style={{ borderBottom: title ? '1px solid var(--card-border)' : 'none' }}
          >
            <div className="min-w-0 flex-1">
              {title && (
                <p
                  className="font-bold text-sm leading-snug"
                  style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}
                >
                  {title}
                </p>
              )}
              {subtitle && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {subtitle}
                </p>
              )}
            </div>
            {!hideClose && (
              <button onClick={onClose} className="btn-icon flex-shrink-0" aria-label="Close">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-4"
            style={{ borderTop: '1px solid var(--card-border)', background: 'var(--bg-input)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
