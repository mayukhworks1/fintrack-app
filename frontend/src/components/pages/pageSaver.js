// The save queue behind the page editor.
//
// One request is in flight at a time, and the latest change wins: anything
// scheduled while a save is running replaces whatever was waiting, and goes
// out when that save returns. Nothing about it is tied to a component, so a
// save started before the editor closes still finishes after it.
//
// - Creating: the first save of a new page is a POST carrying one
//   client_request_id for the life of the editor. A retry after a timeout
//   (when the first POST may well have landed) returns the same page instead
//   of making a second one.
// - Updating: every PUT carries base_updated_at, the updated_at of the copy
//   this editor holds. When someone else saved since, the server answers 409
//   conflict and nothing is written; the queue holds the change until the
//   editor decides (resolveConflict).
// - Failing: no answer or a 5xx is retried with backoff for as long as there
//   is something to save. Other refusals (too large, no permission) stop
//   until the next change.

import { errorKind, isRetryable } from './pageErrors'

export const RETRY_DELAYS = [1500, 4000, 10000, 20000, 30000]
const LIVE_RETRY_MS = 4000
// After the editor has closed, an unreachable server is not tried forever.
const DETACHED_MAX_FAILURES = 8

export function newRequestId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* not available */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * create(payload) and update(id, payload) are the API calls. Callbacks:
 *   onSaved(saved, job)   after each successful write
 *   onStatus({ state, failures, error, retryIn })
 *     state: 'saving' | 'saved' | 'retrying' | 'waiting' | 'conflict' | 'trashed' | 'error'
 *   onConflict(error)     a 409 conflict; call resolveConflict to go on
 */
export function createPageSaver({
  id = null, baseUpdatedAt = null, requestId = newRequestId(),
  create, update, onSaved, onStatus, onConflict,
  delays = RETRY_DELAYS, liveRetryMs = LIVE_RETRY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
} = {}) {
  const st = {
    id, base: baseUpdatedAt || null, inFlight: null, pending: null,
    failures: 0, timer: null, blocked: null, detached: false, lastError: null, refused: false,
  }
  let waiters = []
  const cb = { onSaved, onStatus, onConflict }

  const report = (state, extra = {}) => { try { cb.onStatus?.({ state, failures: st.failures, ...extra }) } catch { /* listener gone */ } }
  const idle = () => !st.inFlight && !st.timer && (!st.pending || !!st.blocked)
  const settle = () => {
    if (!idle()) return
    const ws = waiters
    waiters = []
    const ok = !st.pending && !st.blocked && !st.refused
    ws.forEach(w => w(ok))
  }

  async function run() {
    if (st.timer) { clearTimer(st.timer); st.timer = null }
    if (st.inFlight || st.blocked) { settle(); return }
    const job = st.pending
    st.pending = null
    if (!job) { settle(); return }
    st.inFlight = job
    report('saving')
    try {
      let saved
      if (!st.id) {
        saved = await create({ ...job.payload, client_request_id: requestId })
        if (!saved || !saved.id) {
          const e = new Error(saved?.detail || saved?.error?.message || 'Save failed')
          e.status = 500
          throw e
        }
        st.id = saved.id
      } else {
        const body = { ...job.payload }
        if (st.base && job.useBase !== false) body.base_updated_at = st.base
        saved = await update(st.id, body)
      }
      if (saved?.updated_at) st.base = saved.updated_at
      st.failures = 0
      st.lastError = null
      st.refused = false
      st.inFlight = null
      try { cb.onSaved?.(saved, job) } catch { /* listener gone */ }
      if (st.pending) { run(); return }
      report('saved')
      settle()
    } catch (e) {
      st.inFlight = null
      st.lastError = e
      // A newer change replaces this one; otherwise this one is still owed.
      if (!st.pending) st.pending = job
      const kind = errorKind(e)
      if (kind === 'conflict') {
        st.blocked = 'conflict'
        report('conflict', { error: e })
        try { cb.onConflict?.(e) } catch { /* listener gone */ }
        settle()
        return
      }
      if (kind === 'trashed') {
        st.blocked = 'trashed'
        report('trashed', { error: e })
        settle()
        return
      }
      if (kind === 'live' || kind === 'creating') {
        st.timer = setTimer(() => { st.timer = null; run() }, liveRetryMs)
        report('waiting', { error: e, retryIn: liveRetryMs })
        return
      }
      if (isRetryable(e) && !(st.detached && st.failures >= DETACHED_MAX_FAILURES)) {
        st.failures += 1
        const wait = delays[Math.min(st.failures - 1, delays.length - 1)]
        st.timer = setTimer(() => { st.timer = null; run() }, wait)
        report('retrying', { error: e, retryIn: wait })
        return
      }
      // Refused for a reason another try will not change: drop it. The next
      // edit schedules a fresh save.
      st.pending = null
      st.refused = true
      report('error', { error: e })
      settle()
    }
  }

  return {
    get id() { return st.id },
    get base() { return st.base },
    get requestId() { return requestId },
    get blocked() { return st.blocked },
    get busy() { return !idle() },
    get failures() { return st.failures },
    get lastError() { return st.lastError },
    /** Replace the callbacks (the editor re-renders; the queue lives on). */
    listen(next) { Object.assign(cb, next) },
    /** Queue { payload, snap, useBase }; the latest queued job wins. */
    schedule(job) {
      st.pending = job
      if (st.blocked || st.inFlight || st.timer) return
      run()
    },
    /** Send anything waiting now (skipping a backoff), and resolve true once
     *  everything is saved, false when something is blocked or refused. */
    flush() {
      return new Promise(resolve => {
        waiters.push(resolve)
        if (st.timer && !st.inFlight) run()
        else settle()
      })
    },
    retryNow() { if (!st.inFlight && st.pending && !st.blocked) run() },
    /** The server copy's updated_at, after a write made elsewhere (publish,
     *  restore) or a reload. */
    setBase(updatedAt) { if (updatedAt) st.base = updatedAt },
    /** 'mine': save the held change over the copy whose updated_at is given.
     *  'theirs': drop the held change; the editor reloads the server copy. */
    resolveConflict(mode, currentUpdatedAt) {
      if (currentUpdatedAt) st.base = currentUpdatedAt
      st.blocked = null
      if (mode === 'theirs') { st.pending = null; settle(); return }
      run()
    },
    /** Drop anything waiting (a restore replaces the content wholesale). */
    cancelPending() {
      st.pending = null
      if (st.timer) { clearTimer(st.timer); st.timer = null }
      settle()
    },
    /** The editor closed: keep saving, but give up on a dead connection. */
    detach() { st.detached = true; cb.onStatus = null; cb.onConflict = null },
  }
}
