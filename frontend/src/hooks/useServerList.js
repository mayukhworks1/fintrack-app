// A server-side list kept in the URL: the shared machinery behind the
// Invoices, Web Invoices, Projects and Tax Ledger pages. Each page describes
// its filters (createListFilters) and its endpoint (createListQuery); this
// file owns the fetching so no page can ask twice for the same thing:
//   * the search is debounced (SEARCH_DEBOUNCE_MS) before it reaches the URL;
//   * a request whose answer is no longer wanted is aborted;
//   * identical requests in flight share one fetch (StrictMode's mount, unmount,
//     mount included: the abort waits a tick, and the second mount joins);
//   * the previous answer stays on screen until the next one arrives;
//   * a poll sends the ETag it holds, so an unchanged answer is a bodiless 304.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const SEARCH_DEBOUNCE_MS = 250
export const LIST_POLL_MS = 30_000
export const MAX_LIST_ROWS = 200

/**
 * A page's filters, read from and written to the URL.
 *
 * spec: { defaults, keys: { filter: urlParam }, booleans: [filter], json: [filter],
 *         normalize?(filters), prefix?, pageSize, maxRows? }
 * `prefix` namespaces every parameter, for a list embedded in another page.
 */
export function createListFilters(spec) {
  const prefix = spec.prefix || ''
  const keys = Object.fromEntries(Object.entries(spec.keys).map(([k, p]) => [k, prefix + p]))
  const booleans = new Set(spec.booleans || [])
  const json = new Set(spec.json || [])
  const pageParam = `${prefix}page`
  const maxPages = Math.max(1, Math.floor((spec.maxRows || MAX_LIST_ROWS) / spec.pageSize))

  function read(searchParams) {
    const out = { ...spec.defaults }
    for (const [key, param] of Object.entries(keys)) {
      const raw = searchParams.get(param)
      if (raw == null) continue
      if (booleans.has(key)) out[key] = raw === '1' || raw === 'true'
      else if (json.has(key)) {
        try {
          const list = JSON.parse(raw)
          out[key] = Array.isArray(list) ? list.filter(c => c && typeof c === 'object') : []
        } catch {
          out[key] = []
        }
      } else out[key] = raw
    }
    return spec.normalize ? spec.normalize(out) : out
  }

  function write(searchParams, patch) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'page') {
        if (value && Number(value) > 1) next.set(pageParam, String(value))
        else next.delete(pageParam)
        continue
      }
      const param = keys[key]
      if (!param) continue
      const fallback = spec.defaults[key]
      if (json.has(key)) {
        if (Array.isArray(value) && value.length) next.set(param, JSON.stringify(value))
        else next.delete(param)
      } else if (booleans.has(key)) {
        if (value) next.set(param, '1')
        else next.delete(param)
      } else if (value == null || value === '' || value === fallback) {
        next.delete(param)
      } else {
        next.set(param, String(value))
      }
    }
    // Anything that changes the scope or its order starts again from page one.
    if (!('page' in patch)) next.delete(pageParam)
    return next
  }

  /**
   * The filters, kept in the URL. Discrete changes add a history entry, so
   * back and forward step through them; typing in the search box replaces the
   * entry once the debounce settles.
   */
  function useFilters({ debounceMs = SEARCH_DEBOUNCE_MS, searchKey = 'q', keep = ['sort', 'order'] } = {}) {
    const [searchParams, setSearchParams] = useSearchParams()
    const raw = searchParams.toString()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const filters = useMemo(() => read(searchParams), [raw])
    const pages = Math.max(1, Math.min(maxPages, Number(searchParams.get(pageParam)) || 1))

    // Several changes in one handler must build on each other, not on the
    // render's copy of the URL.
    const latest = useRef(searchParams)
    latest.current = searchParams
    const setFilters = useCallback((patch, { replace = false } = {}) => {
      const base = latest.current
      const resolved = typeof patch === 'function' ? patch(read(base)) : patch
      const next = write(base, resolved)
      if (next.toString() === base.toString()) return
      latest.current = next
      setSearchParams(next, { replace })
    }, [setSearchParams])

    const setPages = useCallback((n) => setFilters({ page: n }, { replace: true }), [setFilters])

    // The search box: what is typed now, and what has settled into the URL.
    const urlSearch = filters[searchKey] || ''
    const [searchInput, setSearchInput] = useState(urlSearch)
    const committed = useRef(urlSearch)
    useEffect(() => {
      // A URL change from outside (back, forward, a link): show its search.
      if (urlSearch !== committed.current) {
        committed.current = urlSearch
        setSearchInput(urlSearch)
      }
    }, [urlSearch])
    useEffect(() => {
      const next = searchInput.trim()
      if (next === committed.current) return undefined
      const t = setTimeout(() => {
        committed.current = next
        setFilters({ [searchKey]: next }, { replace: true })
      }, debounceMs)
      return () => clearTimeout(t)
    }, [searchInput, debounceMs, setFilters, searchKey])

    // Enter: search now, without waiting for the debounce.
    const commitSearch = useCallback(() => {
      const next = searchInput.trim()
      committed.current = next
      setFilters({ [searchKey]: next }, { replace: true })
    }, [searchInput, setFilters, searchKey])

    const clearAll = useCallback(() => {
      committed.current = ''
      setSearchInput('')
      setFilters(Object.fromEntries(Object.keys(keys)
        .filter(k => !keep.includes(k))
        .map(k => [k, spec.defaults[k]])))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setFilters])

    return { filters, pages, setFilters, setPages, searchInput, setSearchInput, commitSearch, clearAll }
  }

  return { read, write, useFilters, keys, maxPages, defaults: spec.defaults }
}

// ── Shared in-flight requests ──────────────────────────────────────────────

const inflight = new Map()   // path -> { promise, controller, refs, abortTimer }
const held = new Map()       // path -> { etag, data } of the last full answer
const CANCELLED = Symbol('cancelled')

function paramsOf(path) {
  return Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''))
}

/** The request's identity: its URL, the same for the same parameters. */
export function listPath(endpoint, params = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v != null && v !== '' && v !== false && q.set(k, v === true ? '1' : String(v)))
  return `${endpoint}?${q}`
}

function acquire(path, fetcher) {
  let entry = inflight.get(path)
  if (entry) {
    entry.refs += 1
    clearTimeout(entry.abortTimer)
    return entry
  }
  const controller = new AbortController()
  entry = { refs: 1, controller, abortTimer: null, promise: null, done: false }
  const known = held.get(path)
  entry.promise = fetcher(paramsOf(path), { etag: known?.etag, signal: controller.signal })
    .then((res) => {
      if (res?.notModified && known) return known.data
      if (res?.etag) held.set(path, { etag: res.etag, data: res.data })
      if (held.size > 60) held.delete(held.keys().next().value)
      return res.data
    })
    .finally(() => {
      entry.done = true
      if (inflight.get(path) === entry) inflight.delete(path)
    })
  inflight.set(path, entry)
  return entry
}

function release(path, entry) {
  entry.refs -= 1
  if (entry.refs > 0 || entry.done) return
  // Wait a tick: a remount (StrictMode, a quick re-render) joins instead of
  // starting the same request again.
  clearTimeout(entry.abortTimer)
  entry.abortTimer = setTimeout(() => {
    if (entry.refs > 0 || entry.done) return
    entry.controller.abort()
    if (inflight.get(path) === entry) inflight.delete(path)
  }, 0)
}

/** Forget every shared request and held ETag (tests; signing out). */
export function resetServerListCache() {
  for (const entry of inflight.values()) entry.controller.abort()
  inflight.clear()
  held.clear()
}

function mergeById(first, rest) {
  const seen = new Set(first.map(r => r.id))
  return [...first, ...rest.filter(r => !seen.has(r.id))]
}

/**
 * A list endpoint: `fetcher(params, { etag, signal })` answers
 * { data } | { notModified } like api.*.query. Returns
 *   subscribe(params) -> { promise, cancel }: join (or start) the shared
 *     request; `promise` resolves to the data, or to CANCELLED once cancelled;
 *   useList(params, opts): the page's data for those parameters.
 */
export function createListQuery({ endpoint, fetcher, label = 'records' }) {
  function subscribe(params) {
    const path = listPath(endpoint, params)
    const entry = acquire(path, (p, o) => fetcher()(p, o))
    let released = false
    const letGo = () => {
      if (released) return
      released = true
      release(path, entry)
    }
    let cancel
    const cancelled = new Promise((resolve) => { cancel = () => { letGo(); resolve(CANCELLED) } })
    const promise = Promise.race([entry.promise, cancelled]).finally(letGo)
    return { promise, cancel }
  }

  /** One shared request, no hook state: a widget's side query. */
  async function fetchOnce(params) {
    const data = await subscribe(params).promise
    return data === CANCELLED ? null : data
  }

  /**
   * { records, total, nextCursor, aggregates, workspace, loading, refreshing,
   *   loadingMore, error, errorStatus, loadMore, refresh, patchRecord, removeRecord }
   * for `base` (the query parameters, without paging).
   */
  function useList(base, {
    pages = 1, onPagesChange, pageSize = 50, maxRows = MAX_LIST_ROWS, pollMs = LIST_POLL_MS, enabled = true,
  } = {}) {
    // Keyed by content, so a re-render (or the URL's page counter moving)
    // never looks like a new scope.
    const key = JSON.stringify(base)
    const params0 = useMemo(() => JSON.parse(key), [key])
    const [state, setState] = useState({ data: null, key: null })
    const [refreshing, setRefreshing] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState(null)
    const generation = useRef(0)
    const active = useRef(null)
    const lastFetchAt = useRef(0)
    const stateRef = useRef(state)
    stateRef.current = state
    const pagesRef = useRef(pages)
    pagesRef.current = pages
    const keyRef = useRef(key)
    keyRef.current = key

    const run = useCallback(async ({ silent = false } = {}) => {
      const gen = ++generation.current
      const loaded = stateRef.current.key === key ? stateRef.current.data?.records?.length || 0 : 0
      const want = Math.min(maxRows, Math.max(pageSize * pagesRef.current, loaded, pageSize))
      // More rows are on screen than one request may return: refresh the top
      // `want` and keep the rest as they are.
      const capped = loaded > want
      const params = { ...params0, limit: want }
      if (!silent) setRefreshing(true)
      // Join the new request before letting go of the old one, so a repeat of
      // the same request keeps its fetch.
      const sub = subscribe(params)
      active.current?.cancel()
      active.current = sub
      try {
        const data = await sub.promise
        if (data === CANCELLED || gen !== generation.current) return
        if (!Array.isArray(data?.records)) throw new Error(`Unexpected ${label} list response`)
        lastFetchAt.current = Date.now()
        setError(null)
        setState((prev) => {
          const kept = capped && prev.key === key && data.next_cursor
            ? mergeById(data.records, prev.data.records.slice(data.records.length)) : data.records
          return {
            key,
            data: {
              ...data,
              records: kept,
              nextCursor: kept === data.records ? data.next_cursor : prev.data.nextCursor,
            },
          }
        })
      } catch (e) {
        if (e?.name === 'AbortError' || gen !== generation.current) return
        setError({ message: e?.message || `Failed to load ${label}`, status: e?.status || null })
      } finally {
        if (active.current === sub) active.current = null
        if (gen === generation.current) setRefreshing(false)
      }
    }, [params0, key, pageSize, maxRows])

    // A new scope (or the first mount): fetch it, keeping the old rows visible.
    // Leaving the scope lets go of its request, which is then aborted.
    useEffect(() => {
      if (!enabled) return undefined
      run()
      return () => {
        generation.current += 1
        active.current?.cancel()
        active.current = null
      }
    }, [run, enabled])

    // Poll while the tab is visible; catch up on return if the copy is old.
    useEffect(() => {
      if (!enabled || !pollMs) return undefined
      const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const timer = setInterval(() => { if (!hidden()) run({ silent: true }) }, pollMs)
      const onVisible = () => {
        if (!hidden() && Date.now() - lastFetchAt.current >= pollMs) run({ silent: true })
      }
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }, [run, pollMs, enabled])

    const data = state.data
    const loadMore = useCallback(async () => {
      const cursor = stateRef.current.data?.nextCursor
      if (!cursor || loadingMore) return
      setLoadingMore(true)
      try {
        const more = await subscribe({ ...params0, limit: pageSize, cursor, aggregates: '0' }).promise
        if (more === CANCELLED || keyRef.current !== key) return
        setState((prev) => prev.key !== key ? prev : {
          key,
          data: { ...prev.data, records: mergeById(prev.data.records, more.records), nextCursor: more.next_cursor },
        })
        onPagesChange?.(Math.min(Math.floor(maxRows / pageSize), pagesRef.current + 1))
      } catch (e) {
        if (e?.name !== 'AbortError') setError({ message: e?.message || `Failed to load more ${label}`, status: e?.status || null })
      } finally {
        setLoadingMore(false)
      }
    }, [params0, key, pageSize, maxRows, loadingMore, onPagesChange])

    const refresh = useCallback(() => run(), [run])

    // A saved or deleted record shows at once; the next answer confirms it.
    const patchRecord = useCallback((record) => {
      if (!record?.id) return
      setState((prev) => {
        if (!prev.data) return prev
        const idx = prev.data.records.findIndex(r => r.id === record.id)
        const records = idx >= 0
          ? prev.data.records.map(r => (r.id === record.id ? record : r))
          : [record, ...prev.data.records]
        return { ...prev, data: { ...prev.data, records } }
      })
    }, [])
    const removeRecord = useCallback((id) => {
      setState((prev) => !prev.data ? prev : {
        ...prev, data: { ...prev.data, records: prev.data.records.filter(r => r.id !== id) },
      })
    }, [])

    return {
      records: data?.records || [],
      total: data?.total ?? 0,
      nextCursor: data?.nextCursor || null,
      aggregates: data?.aggregates || null,
      workspace: data?.workspace || null,
      source: data?.source || null,
      hasData: !!data,
      // Stale-while-revalidate: `loading` only before the first answer.
      loading: !data && !error,
      refreshing,
      stale: !!data && state.key !== key,
      loadingMore,
      error: error?.message || null,
      errorStatus: error?.status || null,
      loadMore,
      refresh,
      patchRecord,
      removeRecord,
    }
  }

  return { subscribe, fetchOnce, useList }
}

/** Counts how often `value` changed after it first arrived (for LiveDot). */
export function useChangeCount(value) {
  const key = value == null ? null : JSON.stringify(value)
  const seen = useRef(key)
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (key == null) return
    if (seen.current != null && seen.current !== key) setCount(n => n + 1)
    seen.current = key
  }, [key])
  return count
}
