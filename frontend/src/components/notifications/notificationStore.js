// One unread-count poller for the whole app, however many bells are mounted
// (the desktop sidebar, the mobile drawer and the mobile top bar each render
// one). Polls every 60 s while the tab is visible, and catches up at once when
// the tab comes back.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../services/api'

export const POLL_MS = 60_000

let state = { count: 0, items: [], loaded: false, loading: false, ready: true, error: '' }
const listeners = new Set()
let users = 0
let timer = null

function set(patch) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getNotificationState() { return state }

export async function refreshUnread() {
  try {
    const res = await api.notifications.unreadCount()
    set({ count: Number(res?.count) || 0 })
  } catch { /* offline or signed out: keep the last count */ }
}

export async function loadNotifications() {
  set({ loading: true, error: '' })
  try {
    const res = await api.notifications.list({ limit: 30 })
    set({
      items: res?.items || [], count: Number(res?.unread) || 0, ready: res?.ready !== false,
      loaded: true, loading: false,
    })
  } catch (e) {
    set({ loading: false, loaded: true, error: e?.message || 'Could not load notifications' })
  }
}

export async function markNotificationRead(id) {
  const hit = state.items.find(n => n.id === id)
  if (hit && !hit.read) {
    set({ items: state.items.map(n => n.id === id ? { ...n, read: true } : n), count: Math.max(0, state.count - 1) })
  }
  try {
    const res = await api.notifications.markRead(id)
    if (res && typeof res.unread === 'number') set({ count: res.unread })
  } catch { /* the next poll corrects the count */ }
}

export async function markAllNotificationsRead() {
  set({ items: state.items.map(n => ({ ...n, read: true })), count: 0 })
  try {
    const res = await api.notifications.markAllRead()
    if (res && typeof res.unread === 'number') set({ count: res.unread })
  } catch { /* the next poll corrects the count */ }
}

function hidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function stopTimer() { if (timer) { clearInterval(timer); timer = null } }

function startTimer() {
  stopTimer()
  if (hidden()) return
  timer = setInterval(() => { if (!hidden()) refreshUnread() }, POLL_MS)
}

function onVisibility() {
  if (hidden()) { stopTimer(); return }
  refreshUnread()
  startTimer()
}

function retain() {
  users += 1
  if (users === 1) {
    refreshUnread()
    startTimer()
    document.addEventListener('visibilitychange', onVisibility)
  }
}

function release() {
  users = Math.max(0, users - 1)
  if (users === 0) {
    stopTimer()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Live notification state; mounting starts the shared poller. */
export function useNotifications() {
  const snap = useSyncExternalStore(subscribe, getNotificationState, getNotificationState)
  useEffect(() => { retain(); return release }, [])
  return snap
}

/** For tests. */
export function _resetNotificationStore() {
  stopTimer()
  users = 0
  listeners.clear()
  state = { count: 0, items: [], loaded: false, loading: false, ready: true, error: '' }
}
