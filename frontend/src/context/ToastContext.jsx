import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastCtx = createContext(null)

let _id = 0
// How long a dismissed toast stays mounted while it fades out (--motion-exit).
const EXIT_MS = 180

const CONFIGS = {
  success: {
    icon: CheckCircle2,
    accent: 'var(--fin-positive)',
    border: 'color-mix(in srgb, var(--fin-positive) 35%, transparent)',
  },
  error: {
    icon: XCircle,
    accent: 'var(--fin-negative)',
    border: 'color-mix(in srgb, var(--fin-negative) 35%, transparent)',
  },
  warning: {
    icon: AlertTriangle,
    accent: 'var(--fin-warning)',
    border: 'color-mix(in srgb, var(--fin-warning) 35%, transparent)',
  },
  info: {
    icon: Info,
    accent: 'var(--accent)',
    border: 'color-mix(in srgb, var(--accent) 35%, transparent)',
  },
}

function ToastItem({ toast, dismiss }) {
  const cfg = CONFIGS[toast.type] || CONFIGS.info
  const Icon = cfg.icon

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="app-toast flex items-start gap-3 px-4 py-3 rounded-xl text-sm min-w-[260px] max-w-sm"
      data-state={toast.leaving ? 'closed' : 'open'}
      style={{
        // Solid opaque background — never transparent
        background: 'var(--card-bg)',
        border: `1px solid ${cfg.border}`,
        borderLeft: `3px solid ${cfg.accent}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)',
        color: 'var(--text-1)',
      }}
    >
      <Icon size={15} className="flex-shrink-0 mt-0.5" style={{ color: cfg.accent }} />
      <span className="flex-1 leading-snug font-medium" style={{ color: 'var(--text-1)' }}>
        {toast.message}
      </span>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 rounded-md p-0.5 transition-colors"
        style={{ color: 'var(--text-3)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-1)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
      >
        <X size={13} />
      </button>
    </div>
  )
}

// Above every overlay, confirm dialog included (10000), so a message raised
// from inside a full-screen dialog such as the payment-reminder one is seen.
function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 sm:bottom-5 right-4 sm:right-5 z-[10050] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} dismiss={dismiss} />
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    // Mark it leaving so the exit transition runs, then remove it.
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), EXIT_MS)
  }, [])

  const toast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_id
    setToasts(prev => [...prev, { id, message, type }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  // Return the toast fn directly AND attach .showToast so both usage patterns work:
  //   const toast = useToast(); toast('msg', 'success')          ← function call
  //   const { showToast } = useToast(); showToast('msg', 'type') ← destructuring
  const fn = ctx.toast
  fn.showToast = fn
  fn.dismiss = ctx.dismiss
  return fn
}
