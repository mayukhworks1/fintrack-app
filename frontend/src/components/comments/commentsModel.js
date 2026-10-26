// Pure helpers for page comments: mention tokens, IST relative times, and the
// window events the comments panel and the block editor talk through.
//
// A mention is stored as the token "@[Display Name](<user uuid>)". The
// composer shows "@Display Name" while typing and converts on submit.

export const MENTION_RE = /@\[([^[\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)/g

/** Body -> [{ type:'text', text } | { type:'mention', name, id }] */
export function parseBody(body) {
  const out = []
  const s = String(body || '')
  let last = 0
  for (const m of s.matchAll(MENTION_RE)) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) })
    out.push({ type: 'mention', name: m[1], id: m[2] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) })
  return out
}

/** Stored body -> what the composer shows, plus the mentions it carries. */
export function tokensToDraft(body) {
  const mentions = []
  const text = String(body || '').replace(MENTION_RE, (_, name, id) => {
    if (!mentions.some(m => m.id === id)) mentions.push({ name, id })
    return `@${name}`
  })
  return { text, mentions }
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Composer text + picked mentions -> stored body. Only "@Name" still present
 *  in the text becomes a token; longer names first so "Ann Lee" wins over "Ann". */
export function draftToTokens(text, mentions = []) {
  let out = String(text || '')
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length)
  for (const m of sorted) {
    const safe = m.name.replace(/[[\]()\n]/g, '').trim()
    if (!safe) continue
    const re = new RegExp(`(^|[^\\w\\]])@${escapeRegExp(m.name)}(?![\\w])`, 'g')
    out = out.replace(re, (_, pre) => `${pre}@[${safe}](${m.id})`)
  }
  return out
}

/** The "@query" being typed just before the caret, or null. */
export function mentionQueryAt(text, caret) {
  const before = String(text || '').slice(0, caret)
  const m = before.match(/(^|\s)@([^\s@[\]()]{0,30})$/)
  if (!m) return null
  return { query: m[2], start: before.length - m[2].length - 1, end: caret }
}

/** Replace the "@query" at [start, end) with "@Name ". Returns { text, caret }. */
export function insertMention(text, at, name) {
  const s = String(text || '')
  const insert = `@${name} `
  return { text: s.slice(0, at.start) + insert + s.slice(at.end), caret: at.start + insert.length }
}

const IST = 'Asia/Kolkata'

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", then "12 Oct" (IST). */
export function relativeIst(iso, now = Date.now()) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const m = Math.floor((now - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  const sameYear = new Date(t).getUTCFullYear() === new Date(now).getUTCFullYear()
  return new Date(t).toLocaleDateString('en-IN', {
    timeZone: IST, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Full timestamp for a tooltip: "26 Oct 2026, 3:04 pm IST". */
export function fullIst(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleString('en-IN', {
    timeZone: IST, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' IST'
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// ---------------------------------------------------------------------------
// Events between the panel, the bell and the block editor
// ---------------------------------------------------------------------------

/** Fired with { pageId, threadId, anchor } when "Go to" is pressed on an
 *  anchored thread. The block editor listens and scrolls/selects the range. */
export const COMMENT_GOTO_EVENT = 'fintrack:comment-goto'
/** Fired with { pageId, threadId? } to open the comments panel. */
export const COMMENTS_OPEN_EVENT = 'fintrack:comments-open'

export function emitCommentGoTo(detail) {
  window.dispatchEvent(new CustomEvent(COMMENT_GOTO_EVENT, { detail }))
}

export function onCommentGoTo(handler) {
  const fn = (e) => handler(e.detail)
  window.addEventListener(COMMENT_GOTO_EVENT, fn)
  return () => window.removeEventListener(COMMENT_GOTO_EVENT, fn)
}

// An open request can arrive before the page's panel is mounted (a click on a
// notification navigates first). It waits here until the panel claims it.
let pendingOpen = null

export function openCommentsPanel(pageId, threadId = null) {
  pendingOpen = { pageId, threadId, at: Date.now() }
  window.dispatchEvent(new CustomEvent(COMMENTS_OPEN_EVENT, { detail: { pageId, threadId } }))
}

export function claimPendingOpen(pageId) {
  if (!pendingOpen || pendingOpen.pageId !== pageId) return null
  if (Date.now() - pendingOpen.at > 60_000) { pendingOpen = null; return null }
  const hit = pendingOpen
  pendingOpen = null
  return hit
}

// The page whose comments are on screen, so an anchor button rendered by the
// editor need not be told which page it is on.
let activePageId = null
export function setActiveCommentsPage(id) { activePageId = id || null }
export function getActiveCommentsPage() { return activePageId }
