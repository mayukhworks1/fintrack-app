/**
 * Drawer — right-side slide panel with consistent chrome + smooth exit animation.
 *
 * Usage:
 *   <Drawer
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Invoice #INV-001"
 *     subtitle="Project · Category · Milestone"
 *     width={520}
 *     accent            // show the coloured top bar (default true)
 *     footer={<…/>}    // pinned footer row (buttons etc.)
 *     actions={<…/>}   // header-row right-side actions (Edit button etc.)
 *   >
 *     {children}
 *   </Drawer>
 *
 * The component drives open/close via CSS classes so React doesn't unmount
 * the DOM tree until the exit animation is done (avoids flash).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const DURATION = 260 // ms — must match CSS transition duration

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 520,
  accent = true,
  children,
  footer,
  actions,
  zIndex = 50,
}) {
  // ── Visibility state machine ─────────────────────────────────────────────
  // mounted  = DOM node exists
  // visible  = CSS enter class applied (triggers transition)
  const [mounted, setMounted]  = useState(false)
  const [visible, setVisible]  = useState(false)
  const timerRef               = useRef(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Let browser paint the mount first, then trigger the CSS transition
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else {
      setVisible(false)
      timerRef.current = setTimeout(() => setMounted(false), DURATION + 30)
    }
    return () => clearTimeout(timerRef.current)
  }, [open])

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ── Body scroll lock ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 flex"
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
      <aside
        className="relative ml-auto flex flex-col overflow-hidden"
        style={{
          width: `min(100vw, ${width}px)`,
          height: '100%',
          background: 'var(--sidebar-bg)',
          borderLeft: '1px solid var(--glass-border)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${DURATION}ms cubic-bezier(0.4,0,0.2,1)`,
          willChange: 'transform',
          /* Mobile: add bottom safe area */
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Accent bar */}
        {accent && (
          <div
            className="flex-shrink-0"
            style={{
              height: '3px',
              background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-bright) 60%, var(--accent-soft) 100%)',
            }}
          />
        )}

        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--glass-border)' }}
        >
          <div className="min-w-0 flex-1">
            {title && (
              <p
                className="font-bold text-sm leading-snug truncate"
                style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}
              >
                {title}
              </p>
            )}
            {subtitle && (
              <p
                className="text-[11px] mt-0.5 truncate"
                style={{ color: 'var(--text-3)' }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
            <button
              onClick={onClose}
              className="btn-icon"
              aria-label="Close drawer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex-shrink-0 px-5 py-4"
            style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--bg-input)' }}
          >
            {footer}
          </div>
        )}
      </aside>
    </div>,
    document.body
  )
}
