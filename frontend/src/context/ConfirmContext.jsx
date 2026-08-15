import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import Modal from '../components/Modal'

/**
 * Promise-based confirmation, replacing native window.confirm().
 *
 * The API is shaped so migrating a call site is a mechanical edit that keeps
 * the original control flow intact:
 *
 *   if (!window.confirm('Delete this?')) return
 *   if (!(await confirm({ message: 'Delete this?' }))) return
 *
 * Two call styles, because one of them has to survive a popup blocker:
 *
 *   await confirm({ ... })                  → resolves true/false
 *   confirm({ ..., onConfirm: () => ... })  → runs onConfirm synchronously
 *                                             inside the button's click handler
 *
 * The second exists for actions that must stay inside the user gesture —
 * window.open() after an await has lost it and gets blocked.
 */
const ConfirmCtx = createContext(null)

const TONES = {
  danger:  { icon: AlertTriangle, accent: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)',  border: 'var(--fin-neg-border)' },
  default: { icon: HelpCircle,    accent: 'var(--accent)',       bg: 'var(--accent-dim)',  border: 'var(--accent-soft)' },
}

const EMPTY = {
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  tone: 'danger',
  onConfirm: null,
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)   // null = closed
  // Held in a ref rather than state: settling the promise must not depend on a
  // re-render having happened, and the resolver must survive the close
  // animation without being recreated.
  const resolverRef = useRef(null)

  const confirm = useCallback((opts = {}) => {
    // A string argument keeps the shape close to window.confirm('…').
    const cfg = typeof opts === 'string' ? { message: opts } : opts
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setState({ ...EMPTY, ...cfg })
    })
  }, [])

  // Settle once and only once. Closing by backdrop, Escape or Cancel all land
  // here with false, so a dismissed dialog can never leave the caller awaiting
  // a promise that never resolves.
  const settle = useCallback((result) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState(null)
    if (resolve) resolve(result)
  }, [])

  const handleConfirm = useCallback(() => {
    // Runs inside the click handler, so anything the caller needs to do while
    // the user gesture is still live (window.open) happens before we settle.
    if (state?.onConfirm) {
      try {
        state.onConfirm()
      } catch (err) {
        // A throwing callback must not strand the promise.
        console.error('[confirm] onConfirm threw:', err)
      }
    }
    settle(true)
  }, [state, settle])

  const tone = TONES[state?.tone] || TONES.danger
  const Icon = tone.icon

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={state !== null}
        onClose={() => settle(false)}
        title={state?.title}
        width={440}
        /* Above Drawer/overlay z-indexes so a confirmation raised from inside
           another dialog is not painted behind it. */
        zIndex={120}
        footer={
          <>
            <button className="btn-ghost" onClick={() => settle(false)}>
              {state?.cancelLabel || 'Cancel'}
            </button>
            <button
              className="btn-primary"
              onClick={handleConfirm}
              style={state?.tone === 'danger'
                ? { background: 'var(--fin-negative)', borderColor: 'var(--fin-negative)' }
                : undefined}
            >
              {state?.confirmLabel || 'Confirm'}
            </button>
          </>
        }
      >
        <div className="flex gap-3">
          <span
            className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.accent }}
            aria-hidden="true"
          >
            <Icon size={17} />
          </span>
          <p className="text-sm leading-relaxed pt-1.5" style={{ color: 'var(--text-2)' }}>
            {state?.message}
          </p>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
