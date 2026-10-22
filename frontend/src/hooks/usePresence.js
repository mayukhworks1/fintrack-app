/**
 * Keeps a closing element mounted until its CSS exit transition has run.
 *
 *   const ref = useRef(null)
 *   const [mounted, state] = usePresence(open, ref)
 *   {mounted && <div ref={ref} data-state={state} inert={state === 'closed' ? '' : undefined}>…</div>}
 *
 * state is 'open' or 'closed'. The element's CSS owns the motion: it
 * transitions between the two data-state values, and @starting-style gives
 * the enter its first frame. Because these are transitions rather than
 * keyframes, reopening mid-exit (or closing mid-enter) reverses from the
 * value on screen instead of jumping to a start state.
 *
 * The element unmounts once its own transitions have finished. Where there
 * are none to wait for (no Web Animations API, a zero duration, or a test
 * environment), it unmounts at once.
 */
import { useEffect, useState } from 'react'

export function usePresence(open, ref) {
  const [mounted, setMounted] = useState(open)
  // Derived during render, so the opening frame already has the element.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    let cancelled = false
    const el = ref.current
    // getAnimations() flushes style first, so the exit transition that the
    // data-state change just started is already in the list.
    const running = el?.getAnimations?.().filter(a => a.transitionProperty) ?? []
    if (!running.length) { setMounted(false); return }
    Promise.all(running.map(a => a.finished))
      .then(() => { if (!cancelled) setMounted(false) })
      // A transition replaced mid-flight (the menu reopened) rejects; the
      // element stays, which is what reopening wants.
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, mounted, ref])

  return [mounted, open ? 'open' : 'closed']
}
