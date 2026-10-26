// Copies of unsaved page edits kept on this device.
//
// Keyed by the page (or, before its first save, by the editor's create
// request id), so a new page never offers some other page's leftovers. A copy
// is removed as soon as the server holds the same thing, and offered back only
// when it is newer than the server copy and actually different from it.
//
// Small copies go to localStorage. A large document would hit its ~5 MB quota
// (and fail silently), so those go to IndexedDB, which has room for them.

import { downloadBlob } from '../../utils/download'

const PREFIX = 'pages_draft_'
const MAX_AGE_MS = 7 * 24 * 3600 * 1000
const LOCAL_MAX_CHARS = 256 * 1024
const DB_NAME = 'fintrack-pages'
const STORE = 'drafts'

export const backupKey = (pageId, requestId) => `${PREFIX}${pageId || `new-${requestId}`}`

// ── IndexedDB, when there is one ──────────────────────────────────────────
let dbPromise = null
function idb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB?.open) { resolve(null); return }
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE) } catch { /* exists */ } }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}
async function idbDo(mode, fn) {
  const db = await idb()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => resolve(undefined)
      tx.onabort = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

function localRemove(key) { try { localStorage.removeItem(key) } catch { /* blocked */ } }

/** Keep a copy. Fire and forget: a failure here must never stop a save. */
export function writeBackup(key, payload) {
  const value = { ...payload, ts: Date.now() }
  let raw = ''
  try { raw = JSON.stringify(value) } catch { return }
  if (raw.length <= LOCAL_MAX_CHARS) {
    try {
      localStorage.setItem(key, raw)
      idbDo('readwrite', s => s.delete(key))
      return
    } catch { /* full: fall through to IndexedDB */ }
  }
  localRemove(key)
  idbDo('readwrite', s => s.put(value, key))
}

function fresh(b) {
  return b && typeof b === 'object' && b.ts > Date.now() - MAX_AGE_MS ? b : null
}

/** The copy under key, or null. */
export async function readBackup(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) { const b = fresh(JSON.parse(raw)); if (b) return b }
  } catch { /* blocked or corrupt */ }
  return fresh(await idbDo('readonly', s => s.get(key))) || null
}

export function clearBackup(key) {
  localRemove(key)
  idbDo('readwrite', s => s.delete(key))
}

/** Move a new page's copy under its real id once the server has made it. */
export async function moveBackup(fromKey, toKey) {
  const b = await readBackup(fromKey)
  clearBackup(fromKey)
  if (b) writeBackup(toKey, b)
}

/** The old single key every new page shared; it offered the wrong draft. */
export function dropLegacyBackup() {
  localRemove(`${PREFIX}new`)
}

/** A backup worth offering for this server copy, or null. */
export async function backupToOffer(page) {
  if (!page?.id) return null
  const b = await readBackup(backupKey(page.id))
  if (!b) return null
  const serverAt = Date.parse(page.updated_at || '') || 0
  if (b.ts <= serverAt) return null
  const differs = (b.content != null && b.content !== (page.content ?? ''))
    || (b.title != null && b.title !== (page.title ?? ''))
  return differs ? b : null
}

const EXT = { doc: 'json', markdown: 'md', html: 'html', artifact: 'html', csv: 'csv', text: 'txt' }
const MIME = { json: 'application/json', md: 'text/markdown', html: 'text/html', csv: 'text/csv', txt: 'text/plain' }

/** Save the editor's current content as a file, for when the server will not take it. */
export function downloadPageCopy({ title, slug, content_type, content }) {
  const ext = EXT[content_type] || 'txt'
  const base = (slug || title || 'page').toString().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'page'
  downloadBlob(new Blob([content || ''], { type: MIME[ext] || 'text/plain' }), `${base}-unsaved-copy.${ext}`)
}
