/**
 * Whether the visitor has asked for less motion.
 *
 * Live: it follows the setting if it changes while the page is open. Where
 * matchMedia does not exist the answer is "reduce", because the safe default
 * for something that moves on its own is not to.
 */
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** One-off read, for code outside React. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try { return !!window.matchMedia(QUERY)?.matches } catch { return true }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mql
    try { mql = window.matchMedia(QUERY) } catch { return }
    if (!mql) return
    const sync = () => setReduced(!!mql.matches)
    sync()
    if (mql.addEventListener) mql.addEventListener('change', sync)
    else mql.addListener?.(sync)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', sync)
      else mql.removeListener?.(sync)
    }
  }, [])

  return reduced
}
