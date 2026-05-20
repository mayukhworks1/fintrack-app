import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastCtx = createContext(null)

let _id = 0

const CONFIGS = {
  success: {
    icon: CheckCircle2,
    accent: '#22c55e',
    border: 'rgba(34,197,94,0.35)',
  },
  error: {
    icon: XCircle,
    accent: '#ef4444',
    border: 'rgba(239,68,68,0.35)',
  },
  warning: {
    icon: AlertTriangle,
    accent: '#f59e0b',
    border: 'rgba(245,158,11,0.35)',
  },
  info: {
    icon: Info,
    accent: '#3b82f6',
    border: 'rgba(59,130,246,0.35)',
  },
}

function ToastItem({ toast, dismiss }) {
  const cfg = CONFIGS[toast.type] || CONFIGS.info
  const Icon = cfg.icon

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm min-w-[260px] max-w-sm animate-slide-in"
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

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 sm:bottom-5 right-4 sm:right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none"
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
    setToasts(prev => prev.filter(t => t.id !== id))
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
  return ctx.toast
}
