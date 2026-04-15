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

function ToastItem({ toast, dismiss }) {
  const Icon = ICONS[toast.type] || Info
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={clsx(
        'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm',
        'animate-slide-in backdrop-blur-sm min-w-64 max-w-sm',
        'bg-surface-800',
        STYLES[toast.type]
      )}
    >
      <Icon size={16} className="flex-shrink-0 mt-0.5" />
      <span className="flex-1 text-gray-200 leading-snug">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
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
