/**
 * The app's half of window.fintrack.db: the bridge between an artifact's
 * sandboxed frame and its shared data.
 *
 * The frame has an opaque origin, no session and (by design) no business
 * talking to the API. Its SDK (backend/app/services/artifact_db_sdk.js) posts
 * { type: '__ft_db', id, op, args } to this window; ArtifactFrame checks the
 * message came from its own frame's window and hands it here. Every message is
 * validated (validateDbMessage) before anything is called, the answer goes
 * back as { type: '__ft_db_result', id, ok, value | error }, and changes made
 * anywhere are pushed in as { type: '__ft_db_event', kind: 'changes' }.
 *
 * Nothing secret ever crosses into the frame: the sign-in token and the
 * visitor id are only sent to the API, from here.
 *
 * Backends:
 *   HttpBackend('public')  a published artifact (/p/<slug>, document embeds),
 *                          as a visitor, or as yourself when signed in
 *   HttpBackend('owner')   by page id, for its owner: the editor preview
 *   MemoryBackend          in memory only: a draft with no page yet, and the
 *                          live build preview, which must never write real data
 *
 * Realtime is a long-poll on /changes (the API answers as soon as anything
 * changes, or after 25 s), which survives proxies that buffer event streams.
 * Writes go through a queue: while the network is down they wait and are
 * retried in order, so nothing typed offline is lost while the tab is open.
 */
import { API_BASE_URL, getAuthToken } from '../../services/api'

export const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const RESERVED = new Set(['changes', 'settings', 'export', 'stream', 'me', 'summary', 'doc', 'files', 'count', 'query', 'upsert'])
export const MAX_ARGS_CHARS = 40_000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const FILE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
const MAX_IN_FLIGHT = 200
const LONG_POLL_S = 25
const VISITOR_KEY = 'ft-visitor-id'

const WRITE_OPS = new Set(['add', 'update', 'remove', 'increment', 'upsert', 'docSet', 'docIncrement', 'filesRemove'])

export class DataError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

// ── Visitor id ────────────────────────────────────────────────────────────

/** A random id for this browser, kept in the app's storage, never the frame's. */
export function getVisitorId() {
  try {
    const have = localStorage.getItem(VISITOR_KEY)
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have
  } catch { /* storage unavailable */ }
  const bytes = new Uint8Array(18)
  try { crypto.getRandomValues(bytes) } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256) }
  const id = 'v' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  try { localStorage.setItem(VISITOR_KEY, id) } catch { /* this visit only */ }
  return id
}

// ── Message validation ───────────────────────────────────────────────────

function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype }
function size(v) { try { return JSON.stringify(v ?? null).length } catch { return Infinity } }

function collectionName(v) {
  if (typeof v !== 'string' || !COLLECTION_RE.test(v) || RESERVED.has(v.toLowerCase())) {
    throw new DataError('Collection names start with a letter and use only letters, digits, - and _ (at most 40 characters).', 422)
  }
  return v
}
function anyCollection(v) {
  if (v === '_doc' || v === '_files') return v
  return collectionName(v)
}
function scopeName(v) {
  if (v == null || v === 'shared') return 'shared'
  if (v === 'private') return 'private'
  throw new DataError('scope must be "shared" or "private"', 422)
}
function recordId(v) {
  if (typeof v !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(v)) throw new DataError('That record does not exist (it may have been deleted).', 404)
  return v
}
function dataObject(v, what = 'A record') {
  if (!isPlain(v)) throw new DataError(`${what} must be a plain object.`, 422)
  return v
}
function fieldName(v) {
  if (typeof v !== 'string' || !FIELD_RE.test(v)) throw new DataError('Field names use letters, digits and _.', 422)
  return v
}
function where(v) {
  if (v == null) return undefined
  if (!isPlain(v) || Object.keys(v).length > 8) throw new DataError('where must be an object of up to 8 fields.', 422)
  Object.keys(v).forEach(fieldName)
  return v
}
function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(`${what} must be a number.`, 422)
  return v
}
function optVersion(v) {
  if (v == null) return undefined
  if (!Number.isInteger(v) || v < 0) throw new DataError('version must be a whole number.', 422)
  return v
}
function keyName(v) {
  if (typeof v !== 'string' || !v.length || v.length > 120) throw new DataError('A key is text of 1 to 120 characters.', 422)
  return v
}

/**
 * The op and its cleaned arguments, or a DataError. Only these ops exist and
 * only these fields are passed on; anything else in the message is dropped.
 */
export function validateDbMessage(d) {
  if (!isPlain(d) || d.type !== '__ft_db') throw new DataError('Not a data request.', 400)
  if (typeof d.id !== 'string' || !d.id || d.id.length > 64) throw new DataError('Bad request id.', 400)
  if (typeof d.op !== 'string') throw new DataError('Unknown operation.', 400)
  const a = d.args == null ? {} : d.args
  if (!isPlain(a)) throw new DataError('Bad arguments.', 400)
  const file = a.file
  if (d.op !== 'filesUpload' && size(a) > MAX_ARGS_CHARS) throw new DataError('This request is too large.', 413)
  switch (d.op) {
    case 'hello': return { op: 'hello', args: {} }
    case 'load': return { op: 'load', args: { collection: anyCollection(a.collection), scope: scopeName(a.scope) } }
    case 'list': {
      const limit = a.limit == null ? undefined : Math.max(1, Math.min(1000, Math.floor(finite(a.limit, 'limit'))))
      const orderBy = a.orderBy == null ? undefined : (['createdAt', 'updatedAt'].includes(a.orderBy) ? a.orderBy : fieldName(a.orderBy))
      return { op: 'list', args: { collection: collectionName(a.collection), scope: scopeName(a.scope), where: where(a.where), orderBy, desc: !!a.desc, limit } }
    }
    case 'get': return { op: 'get', args: { collection: collectionName(a.collection), id: recordId(a.id) } }
    case 'count': return { op: 'count', args: { collection: collectionName(a.collection), scope: scopeName(a.scope), where: where(a.where) } }
    case 'add': return { op: 'add', args: { collection: collectionName(a.collection), scope: scopeName(a.scope), data: dataObject(a.data) } }
    case 'update': return { op: 'update', args: { collection: collectionName(a.collection), id: recordId(a.id), data: dataObject(a.data, 'A change'), version: optVersion(a.version), replace: a.replace === true } }
    case 'remove': return { op: 'remove', args: { collection: collectionName(a.collection), id: recordId(a.id) } }
    case 'increment': return { op: 'increment', args: { collection: collectionName(a.collection), id: recordId(a.id), field: fieldName(a.field), by: finite(a.by ?? 1, 'by') } }
    case 'upsert': return { op: 'upsert', args: { collection: collectionName(a.collection), scope: scopeName(a.scope), key: keyName(a.key), data: dataObject(a.data), replace: a.replace === true, version: optVersion(a.version) } }
    case 'docGet': return { op: 'docGet', args: { name: collectionName(a.name), scope: scopeName(a.scope) } }
    case 'docSet': return { op: 'docSet', args: { name: collectionName(a.name), scope: scopeName(a.scope), data: dataObject(a.data), merge: a.merge === true, version: optVersion(a.version) } }
    case 'docIncrement': return { op: 'docIncrement', args: { name: collectionName(a.name), scope: scopeName(a.scope), field: fieldName(a.field), by: finite(a.by ?? 1, 'by') } }
    case 'filesList': return { op: 'filesList', args: { scope: scopeName(a.scope) } }
    case 'filesRemove': return { op: 'filesRemove', args: { id: recordId(a.id) } }
    case 'filesUpload': {
      if (typeof Blob === 'undefined' || !(file instanceof Blob)) throw new DataError('upload(file) needs a File or Blob.', 422)
      if (!file.size) throw new DataError('The file is empty.', 400)
      if (file.size > MAX_FILE_BYTES) throw new DataError('Files can be at most 5 MB.', 413)
      if (file.type && !FILE_TYPES.includes(file.type)) throw new DataError('Only images (PNG, JPEG, GIF, WebP) and PDFs can be uploaded.', 415)
      const name = typeof a.name === 'string' ? a.name.slice(0, 120) : 'file'
      return { op: 'filesUpload', args: { file, name, scope: scopeName(a.scope) } }
    }
    default: throw new DataError('Unknown operation.', 400)
  }
}

// ── HTTP backend ─────────────────────────────────────────────────────────

function absolute(url) {
  if (!url || /^https?:/i.test(url)) return url
  const base = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '')
  return base + url
}

function withAbsoluteUrl(rec) {
  if (rec && rec.collection === '_files' && rec.data && rec.data.url) rec.data = { ...rec.data, url: absolute(rec.data.url) }
  return rec
}

export class HttpBackend {
  /** desc: { mode: 'public', slug, token } | { mode: 'owner', pageId } */
  constructor(desc, { fetchImpl } = {}) {
    this.desc = desc
    this.fetch = fetchImpl || ((...a) => fetch(...a))
    this.base = desc.mode === 'owner'
      ? `${API_BASE_URL}/api/pages/${encodeURIComponent(desc.pageId)}/data`
      : `${API_BASE_URL}/api/public/pages/${encodeURIComponent(desc.slug)}/data`
  }

  headers(extra = {}) {
    const h = { 'X-Visitor-Id': getVisitorId(), ...extra }
    let token = ''
    try { token = getAuthToken() } catch { /* not signed in */ }
    if (token) h.Authorization = `Bearer ${token}`
    if (this.desc.mode === 'public' && this.desc.token) h['X-Page-Token'] = this.desc.token
    return h
  }

  async req(method, path, { body, query, signal, raw, headers } = {}) {
    const qs = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`).join('&') : ''
    const init = { method, signal, cache: 'no-store', headers: this.headers(headers) }
    if (raw !== undefined) init.body = raw
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
    let res
    try {
      res = await this.fetch(`${this.base}${path}${qs ? `?${qs}` : ''}`, init)
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      const err = new DataError('You appear to be offline.', 0)
      err.network = true
      throw err
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = typeof data?.detail === 'string' ? data.detail : (data?.error?.message || `Request failed (${res.status})`)
      const err = new DataError(msg, res.status)
      err.network = res.status >= 500 || res.status === 429
      throw err
    }
    return data
  }

  session() { return this.req('GET', '') }
  changes(since, { wait = 0, rev, all, signal } = {}) { return this.req('GET', '/changes', { query: { since, wait, rev, all: all ? 1 : undefined }, signal }) }
  async load(collection, scope) {
    if (collection === '_doc') return this.req('GET', '/doc', { query: { scope } })
    if (collection === '_files') return this.req('GET', '/files', { query: { scope } })
    let since = 0, records = [], guard = 0
    for (;;) {
      const res = await this.req('GET', `/${collection}`, { query: { since, limit: 1000, scope } })
      records = records.concat(res.records || [])
      since = res.cursor
      if (!res.has_more || ++guard > 10) return { records }
    }
  }
  list(c, { scope, where: w, orderBy, desc, limit }) {
    const order = orderBy === 'createdAt' ? 'created_at' : orderBy === 'updatedAt' ? 'updated_at' : orderBy
    return this.req('GET', `/${c}`, { query: { scope, where: w, order_by: order, desc: desc ? 1 : undefined, limit } })
  }
  get(c, id) { return this.req('GET', `/${c}/${id}`) }
  count(c, { scope, where: w }) { return this.req('GET', `/${c}/count`, { query: { scope, where: w } }) }
  add(c, { scope, data }) { return this.req('POST', `/${c}`, { body: { data, scope } }) }
  update(c, id, { data, version, replace }) { return this.req('PATCH', `/${c}/${id}`, { body: { data, version, replace } }) }
  remove(c, id) { return this.req('DELETE', `/${c}/${id}`) }
  increment(c, id, { field, by }) { return this.req('POST', `/${c}/${id}/increment`, { body: { field, by } }) }
  upsert(c, body) { return this.req('POST', `/${c}/upsert`, { body }) }
  docGet(name, scope) { return this.req('GET', `/doc/${name}`, { query: { scope } }) }
  docSet(name, body) { return this.req('PUT', `/doc/${name}`, { body }) }
  docIncrement(name, body) { return this.req('POST', `/doc/${name}/increment`, { body }) }
  async filesList(scope) {
    const res = await this.req('GET', '/files', { query: { scope } })
    return { ...res, records: (res.records || []).map(withAbsoluteUrl) }
  }
  async filesUpload(file, name, scope) {
    const rec = await this.req('POST', '/files', { raw: file, query: { scope }, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) } })
    return withAbsoluteUrl(rec)
  }
  filesRemove(id) { return this.req('DELETE', `/files/${id}`) }
  // Owner tools (the Data panel).
  settings(conf) { return conf ? this.req('PUT', '/settings', { body: conf }) : this.req('GET', '/settings') }
  clear(c) { return this.req('DELETE', `/${c}`) }
  listAll(c) { return this.req('GET', `/${c}`, { query: { scope: 'all', limit: 1000 } }) }
  exportUrl(format, c) { return `${this.base}/export?format=${format}${c ? `&collection=${encodeURIComponent(c)}` : ''}` }
  async exportFile(format, c) {
    const res = await this.fetch(this.exportUrl(format, c), { headers: this.headers() })
    if (!res.ok) throw new DataError(`Export failed (${res.status})`, res.status)
    return res.blob()
  }
}

// ── Memory backend (sandbox) ─────────────────────────────────────────────

function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID() } catch { /* fall through */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
}
function sortKey(v) { return v == null ? [5, ''] : typeof v === 'string' ? [1, v] : typeof v === 'number' ? [2, v] : typeof v === 'boolean' ? [3, v] : [4, JSON.stringify(v)] }
function cmpVal(a, b) { const x = sortKey(a), y = sortKey(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) }
function matches(data, w) { return !w || Object.entries(w).every(([k, v]) => JSON.stringify(data?.[k]) === JSON.stringify(v)) }
const readFileAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result); r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

/**
 * The same operations as the API, kept in memory and forgotten with the tab.
 * Used where writing real data would be wrong: the live build preview, and a
 * new artifact that has no page yet.
 */
export class MemoryBackend {
  constructor() { this.rows = new Map(); this.seq = 0; this.waiters = new Set(); this.me = 'v:me' }
  _pub(r) {
    const { owner, ...rest } = r
    return { ...rest, scope: owner ? 'private' : 'shared', mine: true, ...(r.deleted_at ? { deleted: true, data: null } : {}) }
  }
  _wake() { for (const w of this.waiters) w(); this.waiters.clear() }
  _live(c, scope) { return [...this.rows.values()].filter(r => r.collection === c && !r.deleted_at && (scope === 'private' ? r.owner : !r.owner)) }
  _write(r) { r.seq = ++this.seq; r.updated_at = new Date().toISOString(); this.rows.set(r.id, r); this._wake(); return this._pub(r) }
  _find(id) { const r = this.rows.get(id); if (!r || r.deleted_at) throw new DataError('That record does not exist (it may have been deleted).', 404); return r }
  _byKey(c, scope, key) { return this._live(c, scope).find(r => r.key === key) }
  _insert(c, scope, data, key) {
    if ([...this.rows.values()].filter(r => !r.deleted_at).length >= 5000) throw new DataError('This artifact is full.', 409)
    const now = new Date().toISOString()
    return this._write({ id: uuid(), collection: c, data: { ...data }, owner: scope === 'private' ? this.me : '', key, created_at: now, version: 1 })
  }
  async session() { return { me: { id: 'preview', isOwner: true, canAdd: true, canEditOthers: true, signedIn: false }, settings: { access: 'link_write', own_only: false }, cursor: this.seq, rev: null, sandbox: true } }
  async changes(since, { wait = 0, signal } = {}) {
    const pick = () => [...this.rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq).map(r => this._pub(r))
    let out = pick()
    if (!out.length && wait > 0) {
      await new Promise(resolve => {
        const t = setTimeout(done, wait * 1000)
        function done() { clearTimeout(t); resolve() }
        this.waiters.add(done)
        signal?.addEventListener('abort', done)
      })
      out = pick()
    }
    return { changes: out, cursor: Math.max(since, this.seq), has_more: false }
  }
  async load(c, scope) { return { records: this._live(c, scope).map(r => this._pub(r)) } }
  async list(c, { scope, where: w, orderBy, desc, limit }) {
    let rows = this._live(c, scope).filter(r => matches(r.data, w))
    const f = orderBy === 'createdAt' || !orderBy ? null : orderBy === 'updatedAt' ? '__u' : orderBy
    rows.sort((a, b) => {
      let x
      if (!f) x = cmpVal(a.created_at, b.created_at)
      else if (f === '__u') x = cmpVal(a.updated_at, b.updated_at)
      else { const p = a.data?.[f], q = b.data?.[f]; if (p == null && q != null) return 1; if (q == null && p != null) return -1; x = cmpVal(p, q) }
      return (x || a.seq - b.seq) * (desc ? -1 : 1)
    })
    if (limit) rows = rows.slice(0, limit)
    return { records: rows.map(r => this._pub(r)), cursor: this.seq, has_more: false }
  }
  async get(c, id) { const r = this._find(id); if (r.collection !== c) throw new DataError('Not found', 404); return this._pub(r) }
  async count(c, { scope, where: w }) { return { count: this._live(c, scope).filter(r => matches(r.data, w)).length } }
  async add(c, { scope, data }) { return this._insert(c, scope, data) }
  async update(c, id, { data, version, replace }) {
    const r = this._find(id)
    if (version != null && version !== r.version) throw new DataError('This record was changed by someone else. Reload and try again.', 409)
    r.data = replace ? { ...data } : { ...r.data, ...data }; r.version++
    return this._write(r)
  }
  async remove(c, id) { const r = this._find(id); r.deleted_at = new Date().toISOString(); r.version++; return this._write(r) }
  async increment(c, id, { field, by }) {
    const r = this._find(id)
    const cur = r.data[field] ?? 0
    if (typeof cur !== 'number') throw new DataError(`"${field}" is not a number, so it cannot be incremented.`, 409)
    r.data = { ...r.data, [field]: cur + by }; r.version++
    return this._write(r)
  }
  async upsert(c, { scope, key, data, replace }) {
    const r = this._byKey(c, scope, key)
    if (!r) return this._insert(c, scope, data, key)
    r.data = replace ? { ...data } : { ...r.data, ...data }; r.version++
    return this._write(r)
  }
  async docGet(name, scope) { const r = this._byKey('_doc', scope, name); return { record: r ? this._pub(r) : null } }
  async docSet(name, { scope, data, merge }) { return this.upsert('_doc', { scope, key: name, data, replace: !merge }) }
  async docIncrement(name, { scope, field, by }) {
    const r = this._byKey('_doc', scope, name)
    if (!r) return this._insert('_doc', scope, { [field]: by }, name)
    return this.increment('_doc', r.id, { field, by })
  }
  async filesList(scope) { return { records: this._live('_files', scope).map(r => this._pub(r)) } }
  async filesUpload(file, name, scope) {
    const url = await readFileAsDataUrl(file)
    return this._insert('_files', scope, { url, name, type: file.type, size: file.size })
  }
  async filesRemove(id) { return this.remove('_files', id) }
}

// ── The bridge ───────────────────────────────────────────────────────────

const RETRY_MAX_MS = 15_000

/**
 * One artifact frame's data connection.
 *   post(message)   sends a message into the frame
 *   onRevision(rev) the published artifact itself changed (public mode)
 */
export class DataBridge {
  constructor(backend, { post, onRevision, onStatus, autoStart = false, realtime = true } = {}) {
    this.backend = backend
    this.post = post || (() => {})
    this.onRevision = onRevision
    this.onStatusCb = onStatus
    this.realtime = realtime
    this.queue = []
    this.inFlight = 0
    this.status = 'connecting'
    this.offline = false
    this.cursor = null
    this.rev = undefined
    this.running = false
    this.stopped = false
    this.session = null
    this._onOnline = () => { this.retryNow() }
    if (typeof window !== 'undefined') window.addEventListener('online', this._onOnline)
    if (autoStart) this.start()
  }

  stop() {
    this.stopped = true
    this.running = false
    this.abort?.abort()
    clearTimeout(this.retryTimer)
    clearTimeout(this.loopTimer)
    if (typeof window !== 'undefined') window.removeEventListener('online', this._onOnline)
  }

  setStatus() {
    const next = this.offline ? 'offline' : this.queue.length ? 'syncing' : 'synced'
    if (next === this.status) return
    this.status = next
    this.post({ type: '__ft_db_event', kind: 'status', status: next })
    this.onStatusCb?.(next, this.queue.length)
  }

  get pendingWrites() { return this.queue.length }

  async ensureSession() {
    if (this.session) return this.session
    if (!this._sessionP) {
      this._sessionP = this.backend.session().then(s => {
        this.session = s
        if (this.cursor == null) this.cursor = s.cursor || 0
        if (this.rev === undefined) this.rev = s.rev ?? null
        this.offline = false
        return s
      }).finally(() => { this._sessionP = null })
    }
    return this._sessionP
  }

  /** Start the realtime loop (idempotent). */
  start() {
    if (this.running || this.stopped || !this.realtime) return
    this.running = true
    this.loop()
  }

  async loop() {
    let delay = 1000
    while (this.running && !this.stopped) {
      try {
        await this.ensureSession()
        this.abort = new AbortController()
        const res = await this.backend.changes(this.cursor, { wait: LONG_POLL_S, rev: this.rev || undefined, signal: this.abort.signal })
        if (this.stopped) return
        if (this.offline) { this.offline = false; this.setStatus() }
        delay = 1000
        if (res.reset) {
          this.cursor = res.cursor
          this.post({ type: '__ft_db_event', kind: 'reset' })
        } else {
          if (res.changes?.length) this.post({ type: '__ft_db_event', kind: 'changes', changes: res.changes.map(withAbsoluteUrl) })
          this.cursor = res.cursor
        }
        if (res.rev !== undefined && this.rev !== undefined && res.rev !== this.rev && res.rev != null) {
          this.rev = res.rev
          this.onRevision?.(res.rev)
        }
      } catch (e) {
        if (this.stopped || e?.name === 'AbortError') return
        if (e?.status && !e.network) {
          // A real answer (the page was unpublished, expired, locked, or the
          // data store is not ready): look again much later, quietly.
          delay = 30_000
        } else {
          this.offline = true
          this.setStatus()
          delay = Math.min(RETRY_MAX_MS, delay * 2)
        }
        await new Promise(r => { this.loopTimer = setTimeout(r, delay); this._wakeLoop = r })
      }
    }
  }

  retryNow() {
    clearTimeout(this.retryTimer)
    this._wakeLoop?.()
    this.flush()
  }

  /** Handle a message from the frame. Resolves once the answer is posted. */
  async handle(message) {
    let id = null
    try {
      id = typeof message?.id === 'string' && message.id.length <= 64 ? message.id : null
      if (this.inFlight >= MAX_IN_FLIGHT) throw new DataError('Too many requests at once.', 429)
      const { op, args } = validateDbMessage(message)
      this.inFlight++
      try {
        const value = await this.run(op, args)
        this.reply(id, true, value)
      } finally { this.inFlight-- }
    } catch (e) {
      if (id) this.reply(id, false, { message: e?.message || 'The request failed', status: e?.status ?? 0 })
    }
  }

  reply(id, ok, payload) {
    this.post(ok ? { type: '__ft_db_result', id, ok: true, value: payload } : { type: '__ft_db_result', id, ok: false, error: payload })
  }

  async run(op, a) {
    const b = this.backend
    if (op === 'hello') {
      this.start()
      try {
        const s = await this.ensureSession()
        return { me: s.me, settings: s.settings, limits: s.limits, sandbox: !!s.sandbox, status: this.offline ? 'offline' : this.queue.length ? 'syncing' : 'synced' }
      } catch (e) {
        if (e?.network) { this.offline = true; this.setStatus(); return { me: null, status: 'offline' } }
        throw e
      }
    }
    if (WRITE_OPS.has(op)) return this.enqueue(() => this.write(op, a))
    switch (op) {
      case 'load': {
        const res = await b.load(a.collection, a.scope)
        return { records: (res.records || []).map(withAbsoluteUrl) }
      }
      case 'list': return b.list(a.collection, a)
      case 'get': return b.get(a.collection, a.id)
      case 'count': return b.count(a.collection, a)
      case 'docGet': return b.docGet(a.name, a.scope)
      case 'filesList': return b.filesList(a.scope)
      case 'filesUpload': {
        const rec = await b.filesUpload(a.file, a.name, a.scope)
        this.post({ type: '__ft_db_event', kind: 'changes', changes: [rec] })
        return rec
      }
      default: throw new DataError('Unknown operation.', 400)
    }
  }

  write(op, a) {
    const b = this.backend
    switch (op) {
      case 'add': return b.add(a.collection, a)
      case 'update': return b.update(a.collection, a.id, a)
      case 'remove': return b.remove(a.collection, a.id)
      case 'increment': return b.increment(a.collection, a.id, a)
      case 'upsert': return b.upsert(a.collection, a)
      case 'docSet': return b.docSet(a.name, a)
      case 'docIncrement': return b.docIncrement(a.name, a)
      case 'filesRemove': return b.filesRemove(a.id)
      default: throw new DataError('Unknown operation.', 400)
    }
  }

  /** Writes run one at a time, in order; a network failure keeps the write
   *  at the head of the queue and retries it, an answer settles it. */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, tries: 0 })
      this.setStatus()
      this.flush()
    })
  }

  async flush() {
    if (this.flushing || this.stopped) return
    this.flushing = true
    try {
      while (this.queue.length && !this.stopped) {
        const job = this.queue[0]
        try {
          const value = await job.fn()
          this.queue.shift()
          if (this.offline) this.offline = false
          job.resolve(value)
          this.setStatus()
        } catch (e) {
          if (e?.network && e.status === 429 && job.tries < 5) {
            job.tries++
            this.retryTimer = setTimeout(() => this.flush(), 3000 * job.tries)
            return
          }
          if (e?.network && e.status !== 429 && (e.status === 0 || job.tries < 8)) {
            // No answer, or the server is struggling: keep it and try again.
            this.offline = true
            this.setStatus()
            job.tries++
            const wait = Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.min(job.tries, 4))
            this.retryTimer = setTimeout(() => this.flush(), wait)
            return
          }
          this.queue.shift()
          job.reject(e)
          this.setStatus()
        }
      }
    } finally {
      this.flushing = false
    }
  }
}

/** The backend for a frame: real data for a page, memory for a sandbox. */
export function backendFor(desc) {
  if (!desc || desc.mode === 'memory') return new MemoryBackend()
  if (desc.mode === 'owner' && desc.pageId) return new HttpBackend(desc)
  if (desc.mode === 'public' && desc.slug) return new HttpBackend(desc)
  return new MemoryBackend()
}

/** A stable string for a data descriptor (the bridge is kept while it holds). */
export function descKey(desc) {
  if (!desc) return 'memory'
  return desc.mode === 'owner' ? `owner:${desc.pageId}` : desc.mode === 'public' ? `public:${desc.slug}:${desc.token || ''}` : 'memory'
}
