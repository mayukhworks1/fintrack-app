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

export async function loadComments(pageId) {
  if (!pageId) return
  if (inflight.has(pageId)) return inflight.get(pageId)
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
    .catch(e => set(pageId, { loading: false, loaded: true, error: e?.message || 'Could not load comments' }))
    .finally(() => inflight.delete(pageId))
  inflight.set(pageId, p)
  return p
}

/** For tests. */
export function _resetCommentsStore() { entries.clear(); listeners.clear(); inflight.clear() }

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
    reload: () => loadComments(pageId),
    /** Start a thread. anchor: { block_id, from, to, quote } or null for page level. */
    create: async (body, anchor = null) => {
      const thread = await api.comments.create(pageId, { body, ...(anchor ? { anchor } : {}) })
      upsertThread(pageId, thread)
      return thread
    },
    reply: async (threadId, body) => {
      const res = await api.comments.reply(pageId, threadId, { body })
      upsertThread(pageId, res?.thread)
      return res?.comment
    },
    edit: async (commentId, body) => {
      const thread = await api.comments.edit(pageId, commentId, body)
      upsertThread(pageId, thread)
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
      return res
    },
    resolve: async (threadId) => upsertThread(pageId, await api.comments.resolve(pageId, threadId)),
    reopen: async (threadId) => upsertThread(pageId, await api.comments.reopen(pageId, threadId)),
    searchMentions: (q) => api.comments.mentions(pageId, q),
  }), [pageId])

  return { ...state, ...actions }
}

export default useComments
