// Data for the Invoices page: the URL holds the search, filters, sort and how
// many pages are loaded; GET /api/invoices/query answers one page plus the
// totals of the filtered scope and of the whole workspace.
//
// One hook owns the fetching so the page cannot ask twice for the same thing:
//   * the search is debounced (SEARCH_DEBOUNCE_MS) before it reaches the URL;
//   * a request whose answer is no longer wanted is aborted;
//   * identical requests in flight share one fetch (StrictMode's mount, unmount,
//     mount included: the abort waits a tick, and the second mount joins);
//   * the previous answer stays on screen until the next one arrives;
//   * a poll sends the ETag it holds, so an unchanged answer is a bodiless 304.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../services/api'

export const INVOICE_PAGE_SIZE = 50
export const MAX_INVOICE_PAGE = 200
export const SEARCH_DEBOUNCE_MS = 250
export const INVOICE_POLL_MS = 30_000

export const DEFAULT_INVOICE_FILTERS = Object.freeze({
  q: '', status: '', project: '', client: '', category: '', raisedBy: '',
  billing: 'all', month: '', aging: '', dateField: 'Raised Date', dateFrom: '', dateTo: '',
  overdue: false, hasDocs: false, followupDue: false, conditions: [],
  sort: 'Raised Date', order: 'desc',
})

// filter -> URL parameter
const URL_KEY = {
  q: 'q', status: 'status', project: 'project', client: 'client', category: 'category',
  raisedBy: 'raised_by', billing: 'billing', month: 'month', aging: 'aging',
  dateField: 'date_field', dateFrom: 'from', dateTo: 'to',
  overdue: 'overdue', hasDocs: 'docs', followupDue: 'followup', conditions: 'adv',
  sort: 'sort', order: 'order',
}
const BOOLEAN = new Set(['overdue', 'hasDocs', 'followupDue'])

function parseConditions(raw) {
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter(c => c && typeof c === 'object') : []
  } catch {
    return []
  }
}

/** The filters a URL describes, defaults filled in. */
export function readInvoiceFilters(searchParams) {
  const out = { ...DEFAULT_INVOICE_FILTERS }
  for (const [key, param] of Object.entries(URL_KEY)) {
    const raw = searchParams.get(param)
    if (raw == null) continue
    if (BOOLEAN.has(key)) out[key] = raw === '1' || raw === 'true'
    else if (key === 'conditions') out[key] = parseConditions(raw)
    else out[key] = raw
  }
  if (!['asc', 'desc'].includes(out.order)) out.order = 'desc'
  if (!['all', 'project', 'retainer'].includes(out.billing)) out.billing = 'all'
  return out
}

/** `searchParams` with `patch` applied; defaults are left out of the URL. */
export function writeInvoiceFilters(searchParams, patch) {
  const next = new URLSearchParams(searchParams)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'page') {
      if (value && Number(value) > 1) next.set('page', String(value))
      else next.delete('page')
      continue
    }
    const param = URL_KEY[key]
    if (!param) continue
    const fallback = DEFAULT_INVOICE_FILTERS[key]
    if (key === 'conditions') {
      if (Array.isArray(value) && value.length) next.set(param, JSON.stringify(value))
      else next.delete(param)
    } else if (BOOLEAN.has(key)) {
      if (value) next.set(param, '1')
      else next.delete(param)
    } else if (value == null || value === '' || value === fallback) {
      next.delete(param)
    } else {
      next.set(param, String(value))
    }
  }
  // Anything that changes the scope or its order starts again from page one.
  if (!('page' in patch)) next.delete('page')
  return next
}

/** Rules FilterBuilder would apply (incomplete rows are skipped there too). */
export function activeConditions(conditions = []) {
  return conditions.filter(c => c?.field && c?.op && (
    (c.value !== '' && c.value != null) || ['is_empty', 'is_not_empty'].includes(c.op)))
}

/** Query parameters for GET /api/invoices/query (and /export). */
export function invoiceQueryParams(filters, tz = -new Date().getTimezoneOffset()) {
  const conditions = activeConditions(filters.conditions)
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status || undefined,
    project: filters.project || undefined,
    client: filters.client || undefined,
    category: filters.category || undefined,
    raised_by: filters.raisedBy || undefined,
    billing: filters.billing && filters.billing !== 'all' ? filters.billing : undefined,
    month: filters.month || undefined,
    aging: filters.aging || undefined,
    date_field: (filters.dateFrom || filters.dateTo) && filters.dateField !== 'Raised Date' ? filters.dateField : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    overdue: filters.overdue || undefined,
    has_docs: filters.hasDocs || undefined,
    followup_due: filters.followupDue || undefined,
    conditions: conditions.length ? JSON.stringify(conditions.map(({ field, op, value }) => ({ field, op, value }))) : undefined,
    sort: filters.sort && filters.sort !== 'Raised Date' ? filters.sort : undefined,
    order: filters.order && filters.order !== 'desc' ? filters.order : undefined,
    tz: tz || undefined,
  }
}

/**
 * The page's filters, kept in the URL. Discrete changes add a history entry,
 * so back and forward step through them; typing in the search box replaces
 * the entry once the debounce settles.
 */
export function useInvoiceFilters({ debounceMs = SEARCH_DEBOUNCE_MS } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.toString()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => readInvoiceFilters(searchParams), [raw])
  const pages = Math.max(1, Math.min(MAX_INVOICE_PAGE / INVOICE_PAGE_SIZE, Number(searchParams.get('page')) || 1))

  // Several changes in one handler must build on each other, not on the
  // render's copy of the URL.
  const latest = useRef(searchParams)
  latest.current = searchParams
  const setFilters = useCallback((patch, { replace = false } = {}) => {
    const base = latest.current
    const resolved = typeof patch === 'function' ? patch(readInvoiceFilters(base)) : patch
    const next = writeInvoiceFilters(base, resolved)
    if (next.toString() === base.toString()) return
    latest.current = next
    setSearchParams(next, { replace })
  }, [setSearchParams])

  const setPages = useCallback((n) => setFilters({ page: n }, { replace: true }), [setFilters])

  // The search box: what is typed now, and what has settled into the URL.
  const [searchInput, setSearchInput] = useState(filters.q)
  const committed = useRef(filters.q)
  useEffect(() => {
    // A URL change from outside (back, forward, a link): show its search.
    if (filters.q !== committed.current) {
      committed.current = filters.q
      setSearchInput(filters.q)
    }
  }, [filters.q])
  useEffect(() => {
    const next = searchInput.trim()
    if (next === committed.current) return undefined
    const t = setTimeout(() => {
      committed.current = next
      setFilters({ q: next }, { replace: true })
    }, debounceMs)
    return () => clearTimeout(t)
  }, [searchInput, debounceMs, setFilters])

  // Enter: search now, without waiting for the debounce.
  const commitSearch = useCallback(() => {
    const next = searchInput.trim()
    committed.current = next
    setFilters({ q: next }, { replace: true })
  }, [searchInput, setFilters])

  const clearAll = useCallback(() => {
    committed.current = ''
    setSearchInput('')
    setFilters(Object.fromEntries(Object.keys(URL_KEY)
      .filter(k => k !== 'sort' && k !== 'order')
      .map(k => [k, DEFAULT_INVOICE_FILTERS[k]])))
  }, [setFilters])

  return { filters, pages, setFilters, setPages, searchInput, setSearchInput, commitSearch, clearAll }
}

// ── Shared in-flight requests ──────────────────────────────────────────────

const inflight = new Map()   // path -> { promise, controller, refs, abortTimer }
const held = new Map()       // path -> { etag, data } of the last full answer

function acquire(path) {
  let entry = inflight.get(path)
  if (entry) {
    entry.refs += 1
    clearTimeout(entry.abortTimer)
    return entry
  }
  const controller = new AbortController()
  entry = { refs: 1, controller, abortTimer: null, promise: null, done: false }
  const known = held.get(path)
  entry.promise = api.invoices.query(paramsOf(path), { etag: known?.etag, signal: controller.signal })
    .then((res) => {
      if (res?.notModified && known) return known.data
      if (res?.etag) held.set(path, { etag: res.etag, data: res.data })
      if (held.size > 40) held.delete(held.keys().next().value)
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

/** The request's identity: its URL, the same for the same parameters. */
function queryPath(params = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v != null && v !== '' && v !== false && q.set(k, v === true ? '1' : String(v)))
  return `/api/invoices/query?${q}`
}

function paramsOf(path) {
  return Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''))
}

const CANCELLED = Symbol('cancelled')

/**
 * Join (or start) the shared request for `params`. `promise` resolves to the
 * data, or to CANCELLED once `cancel()` is called; cancelling lets go of the
 * request, which is aborted when nobody else is waiting for it.
 */
function subscribe(params) {
  const path = queryPath(params)
  const entry = acquire(path)
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

/** For tests: forget shared requests and held ETags. */
export function resetInvoiceQueryCache() {
  for (const entry of inflight.values()) entry.controller.abort()
  inflight.clear()
  held.clear()
}

function mergeById(first, rest) {
  const seen = new Set(first.map(r => r.id))
  return [...first, ...rest.filter(r => !seen.has(r.id))]
}

/**
 * The page's data for `filters`: { records, total, nextCursor, aggregates,
 * workspace, loading, refreshing, loadingMore, error, errorStatus, loadMore,
 * refresh, patchRecord, removeRecord }.
 */
export function useInvoiceQuery(filters, {
  pages = 1, onPagesChange, pageSize = INVOICE_PAGE_SIZE, pollMs = INVOICE_POLL_MS, enabled = true,
} = {}) {
  // Keyed by content, so a re-render (or the URL's page counter moving)
  // never looks like a new scope.
  const key = JSON.stringify(invoiceQueryParams(filters))
  const base = useMemo(() => JSON.parse(key), [key])
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
    const want = Math.min(MAX_INVOICE_PAGE, Math.max(pageSize * pagesRef.current, loaded, pageSize))
    // More rows are on screen than one request may return: refresh the top
    // `want` and keep the rest as they are.
    const capped = loaded > want
    const params = { ...base, limit: want }
    if (!silent) setRefreshing(true)
    // Join the new request before letting go of the old one, so a repeat of
    // the same request keeps its fetch.
    const sub = subscribe(params)
    active.current?.cancel()
    active.current = sub
    try {
      const data = await sub.promise
      if (data === CANCELLED || gen !== generation.current) return
      if (!Array.isArray(data?.records)) throw new Error('Unexpected invoice list response')
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
      setError({ message: e?.message || 'Failed to load invoices', status: e?.status || null })
    } finally {
      if (active.current === sub) active.current = null
      if (gen === generation.current) setRefreshing(false)
    }
  }, [base, key, pageSize])

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
      const more = await subscribe({ ...base, limit: pageSize, cursor, aggregates: '0' }).promise
      if (more === CANCELLED || keyRef.current !== key) return
      setState((prev) => prev.key !== key ? prev : {
        key,
        data: { ...prev.data, records: mergeById(prev.data.records, more.records), nextCursor: more.next_cursor },
      })
      onPagesChange?.(Math.min(MAX_INVOICE_PAGE / pageSize, pagesRef.current + 1))
    } catch (e) {
      if (e?.name !== 'AbortError') setError({ message: e?.message || 'Failed to load more invoices', status: e?.status || null })
    } finally {
      setLoadingMore(false)
    }
  }, [base, key, pageSize, loadingMore, onPagesChange])

  const refresh = useCallback(() => run(), [run])

  // A saved or deleted invoice shows at once; the next answer confirms it.
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
