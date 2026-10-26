// useComments(pageId): one shared, live copy of a page's comment threads.
//
// Every caller for the same page (the toggle's count, the panel, an anchor
// button inside the block editor) reads the same store entry, so a thread
// created from the editor shows up in the panel without a second fetch.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { api } from '../../services/api'

const EMPTY = Object.freeze({
  threads: [], counts: { open: 0, resolved: 0 }, ready: true, loading: false, loaded: false, error: '',
})

const entries = new Map()     // pageId -> state
const listeners = new Map()   // pageId -> Set<fn>
const inflight = new Map()    // pageId -> Promise

function get(pageId) { return (pageId && entries.get(pageId)) || EMPTY }

function set(pageId, patch) {
  const next = { ...get(pageId), ...(typeof patch === 'function' ? patch(get(pageId)) : patch) }
  entries.set(pageId, next)
  for (const fn of listeners.get(pageId) || []) fn()
}

function subscribe(pageId, fn) {
  if (!pageId) return () => {}
  if (!listeners.has(pageId)) listeners.set(pageId, new Set())
  listeners.get(pageId).add(fn)
  return () => listeners.get(pageId)?.delete(fn)
}

function countsOf(threads) {
  return {
    open: threads.filter(t => !t.resolved_at).length,
    resolved: threads.filter(t => t.resolved_at).length,
  }
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => String(b.last_activity_at || b.created_at || '')
    .localeCompare(String(a.last_activity_at || a.created_at || '')))
}

function upsertThread(pageId, thread) {
  if (!thread?.id) return
  set(pageId, s => {
    const rest = s.threads.filter(t => t.id !== thread.id)
    const live = (thread.comments || []).some(c => !c.deleted)
    const threads = sortThreads(live ? [thread, ...rest] : rest)
    return { threads, counts: countsOf(threads) }
  })
}

const again = new Set()        // pageIds to load once more after the one in flight
const refreshTimers = new Map()

export async function loadComments(pageId, { force = false } = {}) {
  if (!pageId) return
  if (inflight.has(pageId)) {
    // A load that started before a change cannot include it: run once more.
    if (force) again.add(pageId)
    return inflight.get(pageId)
  }
  set(pageId, { loading: true, error: '' })
  // Through a promise so a missing or throwing client lands in .catch.
  const p = Promise.resolve().then(() => api.comments.list(pageId))
    .then(res => {
      const threads = sortThreads(res?.threads || [])
      set(pageId, {
        threads, counts: res?.counts || countsOf(threads),
        ready: res?.ready !== false, loading: false, loaded: true, error: '',
      })
    })
    // A background refresh that fails keeps what is on screen.
    .catch(e => set(pageId, s => ({ loading: false, loaded: true, error: s.loaded && s.threads.length ? '' : (e?.message || 'Could not load comments') })))
    .finally(() => {
      inflight.delete(pageId)
      if (again.delete(pageId)) loadComments(pageId)
    })
  inflight.set(pageId, p)
  return p
}

/** Settle the local copy with the server's shortly after a change (other
 *  people's replies, server-side counts), without waiting for a poll. */
export function refreshCommentsSoon(pageId, ms = 400) {
  if (!pageId) return
  clearTimeout(refreshTimers.get(pageId))
  refreshTimers.set(pageId, setTimeout(() => { refreshTimers.delete(pageId); loadComments(pageId, { force: true }) }, ms))
}

/** For tests. */
export function _resetCommentsStore() {
  entries.clear(); listeners.clear(); inflight.clear(); again.clear()
  for (const t of refreshTimers.values()) clearTimeout(t)
  refreshTimers.clear()
}

export function useComments(pageId) {
  const state = useSyncExternalStore(
    useCallback(fn => subscribe(pageId, fn), [pageId]),
    () => get(pageId),
    () => get(pageId),
  )

  useEffect(() => {
    if (pageId && !get(pageId).loaded) loadComments(pageId)
  }, [pageId])

  const actions = useMemo(() => ({
    reload: () => loadComments(pageId, { force: true }),
    /** Start a thread. anchor: { block_id, from, to, quote } or null for page level. */
    create: async (body, anchor = null) => {
      const thread = await api.comments.create(pageId, { body, ...(anchor ? { anchor } : {}) })
      upsertThread(pageId, thread)
      refreshCommentsSoon(pageId)
      return thread
    },
    reply: async (threadId, body) => {
      const res = await api.comments.reply(pageId, threadId, { body })
      upsertThread(pageId, res?.thread)
      refreshCommentsSoon(pageId)
      return res?.comment
    },
    edit: async (commentId, body) => {
      const thread = await api.comments.edit(pageId, commentId, body)
      upsertThread(pageId, thread)
      refreshCommentsSoon(pageId)
      return thread
    },
    remove: async (commentId) => {
      const res = await api.comments.remove(pageId, commentId)
      // A deleted comment is soft-deleted on the server; reflect it locally
      // and let the next load settle the thread's shape.
      set(pageId, s => {
        const threads = s.threads
          .map(t => ({ ...t, comments: t.comments.map(c => c.id === commentId ? { ...c, deleted: true, body: '' } : c) }))
          .filter(t => t.comments.some(c => !c.deleted))
        return { threads, counts: countsOf(threads) }
      })
      refreshCommentsSoon(pageId)
      return res
    },
    resolve: async (threadId) => {
      upsertThread(pageId, await api.comments.resolve(pageId, threadId))
      refreshCommentsSoon(pageId)
    },
    reopen: async (threadId) => {
      upsertThread(pageId, await api.comments.reopen(pageId, threadId))
      refreshCommentsSoon(pageId)
    },
    searchMentions: (q) => api.comments.mentions(pageId, q),
  }), [pageId])

  // `actions` keeps one identity per page, for memoised children.
  return { ...state, ...actions, actions }
}

export default useComments
