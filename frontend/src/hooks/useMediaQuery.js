import { useState, useEffect } from 'react'

/**
 * Subscribe to a CSS media query.
 * Returns true while the query matches.
 *
 *   const isMobile = useMediaQuery('(max-width: 1023px)')
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = e => setMatches(e.matches)
    setMatches(mql.matches)
    // Modern API; older Safari falls back to addListener
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else                      mql.addListener(handler)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else                         mql.removeListener(handler)
    }
  }, [query])

  return matches
}

/** Convenience: true on viewports below the lg breakpoint (1024px). */
export const useIsMobile = () => useMediaQuery('(max-width: 1023px)')
