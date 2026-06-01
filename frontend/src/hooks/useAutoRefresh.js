import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Polls a fetch function every `intervalMs` ms.
 *
 * Key design:
 * - Uses a ref to always call the LATEST fetchFn, so changing filters/sort
 *   (which creates a new fetchFn reference) immediately triggers a fresh fetch.
 * - Skips state update if data is unchanged (avoids unnecessary re-renders).
 * - Returns { data, loading, error, refresh, lastUpdated, syncing }.
 */
export function useAutoRefresh(fetchFn, intervalMs = 5_000) {
  const [data,        setData]        = useState(undefined)
  const [loading,     setLoading]     = useState(true)
  const [syncing,     setSyncing]     = useState(false)
  const [error,       setError]       = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const mounted   = useRef(true)
  const lastHash  = useRef(null)
  const timerRef  = useRef(null)
  // Always keep a ref to the latest fetchFn so the stable `run` callback
  // never calls a stale closure.
  const fetchRef  = useRef(fetchFn)

  // Sync ref with the latest fetchFn on every render
  useEffect(() => { fetchRef.current = fetchFn }, [fetchFn])

  // Stable run — never re-created, always reads fetchRef.current
  const run = useCallback(async (silent = false, forceFresh = false) => {
    if (!mounted.current) return
    if (silent) setSyncing(true)
    else        setLoading(true)
    setError(null)
    try {
      const result = await fetchRef.current(forceFresh ? { fresh: true } : {})
      if (!mounted.current) return
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
  }, []) // intentionally empty — stability guaranteed by fetchRef

  // Re-fetch immediately when fetchFn changes (filter / sort change)
  // The initial fetch is also handled here (fetchFn is set on mount).
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return // interval effect handles the first run
    }
    // Filter/sort changed — clear hash cache and fetch fresh data
    lastHash.current = null
    run(false)
  }, [fetchFn, run])

  // Set up polling interval + initial fetch on mount
  useEffect(() => {
    mounted.current = true
    lastHash.current = null
    run(false)
    timerRef.current = setInterval(() => run(true), intervalMs)
    return () => {
      mounted.current = false
      clearInterval(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]) // run is stable; we intentionally omit it to avoid re-mounting interval

  const refresh = useCallback(() => {
    lastHash.current = null
    run(false, true)
  }, [run])

  return { data, loading, error, refresh, lastUpdated, syncing }
}

/** Format last-updated as relative time string. */
export function useRelativeTime(date) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!date) return
    const tick = () => {
      const secs = Math.floor((Date.now() - date.getTime()) / 1000)
      if (secs < 6)       setLabel('just now')
      else if (secs < 60) setLabel(`${secs}s ago`)
      else                setLabel(`${Math.floor(secs / 60)}m ago`)
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [date])
  return label
}
