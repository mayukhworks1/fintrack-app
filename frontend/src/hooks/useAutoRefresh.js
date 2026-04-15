import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Polls a fetch function every `intervalMs` ms.
 * Returns { data, loading, error, refresh, lastUpdated }.
 */
export function useAutoRefresh(fetchFn, intervalMs = 30_000, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const timer = useRef(null)
  const mounted = useRef(true)

  const run = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const result = await fetchFn()
      if (!mounted.current) return
      setData(result)
      setLastUpdated(new Date())
    } catch (e) {
      if (!mounted.current) return
      setError(e.message || 'Failed to load')
    } finally {
      if (mounted.current) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    mounted.current = true
    run()
    timer.current = setInterval(() => run(true), intervalMs)
    return () => {
      mounted.current = false
      clearInterval(timer.current)
    }
  }, [run, intervalMs])

  const refresh = useCallback(() => run(false), [run])

  return { data, loading, error, refresh, lastUpdated }
}

/** Format "last updated X seconds ago" */
export function useRelativeTime(date) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!date) return
    const tick = () => {
      const secs = Math.floor((Date.now() - date.getTime()) / 1000)
      if (secs < 10) setLabel('just now')
      else if (secs < 60) setLabel(`${secs}s ago`)
      else setLabel(`${Math.floor(secs / 60)}m ago`)
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [date])
  return label
}
