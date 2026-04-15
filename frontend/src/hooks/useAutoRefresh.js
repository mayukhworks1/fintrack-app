import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Polls a fetch function every `intervalMs` ms (default 5s = near real-time).
 * Skips update if serialized data is unchanged (avoids unnecessary re-renders).
 * Returns { data, loading, error, refresh, lastUpdated, syncing }.
 */
export function useAutoRefresh(fetchFn, intervalMs = 5_000, deps = []) {
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [syncing, setSyncing]       = useState(false)
  const [error, setError]           = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const timer      = useRef(null)
  const mounted    = useRef(true)
  const lastHash   = useRef(null)

  const run = useCallback(async (silent = false) => {
    if (!mounted.current) return
    if (silent) setSyncing(true)
    else setLoading(true)
    setError(null)
    try {
      const result = await fetchFn()
      if (!mounted.current) return
      // Only update state if data actually changed
      const hash = JSON.stringify(result)
      if (hash !== lastHash.current) {
        lastHash.current = hash
        setData(result)
      }
      setLastUpdated(new Date())
    } catch (e) {
      if (!mounted.current) return
      setError(e.message || 'Failed to load')
    } finally {
      if (mounted.current) {
        setLoading(false)
        setSyncing(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    mounted.current = true
    lastHash.current = null
    run(false)
    timer.current = setInterval(() => run(true), intervalMs)
    return () => {
      mounted.current = false
      clearInterval(timer.current)
    }
  }, [run, intervalMs])

  const refresh = useCallback(() => run(false), [run])

  return { data, loading, error, refresh, lastUpdated, syncing }
}

/** Format last-updated label */
export function useRelativeTime(date) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!date) return
    const tick = () => {
      const secs = Math.floor((Date.now() - date.getTime()) / 1000)
      if (secs < 6)  setLabel('just now')
      else if (secs < 60) setLabel(`${secs}s ago`)
      else setLabel(`${Math.floor(secs / 60)}m ago`)
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [date])
  return label
}
