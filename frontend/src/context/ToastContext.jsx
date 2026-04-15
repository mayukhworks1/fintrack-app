import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import clsx from 'clsx'

const ToastCtx = createContext(null)

let _id = 0

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
}

const STYLES = {
  success: 'border-green-500/40 bg-green-500/10 text-green-400',
  error:   'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
  info:    'border-brand-500/40 bg-brand-500/10 text-brand-400',
}

const BORDER_COLORS = {
  success: 'rgba(34,197,94,0.4)',
  error:   'rgba(239,68,68,0.4)',
  warning: 'rgba(234,179,8,0.4)',
  info:    'rgba(34,197,94,0.35)',
}
const BG_COLORS = {
  success: 'rgba(34,197,94,0.1)',
  error:   'rgba(239,68,68,0.1)',
  warning: 'rgba(234,179,8,0.1)',
  info:    'rgba(34,197,94,0.08)',
}
const TEXT_COLORS = {
  success: '#4ade80',
  error:   '#f87171',
  warning: '#facc15',
  info:    '#4ade80',
}

function ToastItem({ toast, dismiss }) {
  const Icon = ICONS[toast.type] || Info
  const type = toast.type || 'info'
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 px-4 py-3 rounded-xl shadow-xl text-sm animate-slide-in min-w-64 max-w-sm"
      style={{
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        background: BG_COLORS[type],
        border: `1px solid ${BORDER_COLORS[type]}`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.4)`,
      }}
    >
      <Icon size={16} className="flex-shrink-0 mt-0.5" style={{ color: TEXT_COLORS[type] }} />
      <span className="flex-1 leading-snug" style={{ color: 'var(--text-1)' }}>{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 transition-colors"
        style={{ color: 'var(--text-3)' }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null
  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end"
    >
      {toasts.map(t => <ToastItem key={t.id} toast={t} dismiss={dismiss} />)}
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
