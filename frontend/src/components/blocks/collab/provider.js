// A small y-websocket compatible provider for /api/collab/pages/{id}.
//
// Binary frames are the standard y-protocols sync / awareness messages; text
// frames carry control JSON. The bearer token goes in the first frame, never
// in the URL, so it cannot end up in a proxy or server access log.
//
// Events (lib0 Observable):
//   status   'connecting' | 'connected' | 'disconnected'
//   synced   true once the server's state has been applied
//   stale    the server rebuilt its document (new epoch); this provider stops
//            and the owner decides how to re-sync (see CollabDoc)
//   fatal    (code) access refused / page gone / too large: no more retries
//   saved    (isoTime) the server wrote the document to the page
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Observable } from 'lib0/observable'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1
export const MSG_QUERY_AWARENESS = 3

export const CLOSE = {
  UNAUTHORIZED: 4401, FORBIDDEN: 4403, NOT_FOUND: 4404, TIMEOUT: 4408,
  RESET: 4409, TOO_LARGE: 4413, FULL: 4429, MESSAGE_TOO_BIG: 1009,
}
const FATAL = new Set([CLOSE.UNAUTHORIZED, CLOSE.FORBIDDEN, CLOSE.NOT_FOUND, CLOSE.TOO_LARGE, CLOSE.MESSAGE_TOO_BIG])

const OPEN = 1

export class CollabProvider extends Observable {
  /**
   * @param {object} o
   * @param {string} o.url                 ws(s)://…/api/collab/pages/{id}
   * @param {import('yjs').Doc} o.doc
   * @param {() => string} o.getToken
   * @param {typeof WebSocket} [o.WebSocketImpl]
   * @param {boolean} [o.connect=true]
   * @param {number} [o.pingMs=20000]      heartbeat
   * @param {number} [o.deadMs=45000]      no frame for this long = dead socket
   * @param {number} [o.maxBackoffMs=30000]
   */
  constructor({ url, doc, getToken, WebSocketImpl, connect = true, pingMs = 20000, deadMs = 45000, maxBackoffMs = 30000 }) {
    super()
    this.url = url
    this.doc = doc
    this.getToken = getToken
    this.WebSocketImpl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null)
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.pingMs = pingMs
    this.deadMs = deadMs
    this.maxBackoffMs = maxBackoffMs
    this.ws = null
    this.status = 'disconnected'
    this.synced = false
    this.epoch = null
    this.user = null
    this.welcomed = false
    this.unsynced = false        // local edits the server has not been sent
    this.stale = false
    this.fatal = null
    this.attempts = 0
    this.lastFrameAt = 0
    this.shouldConnect = false
    this._retry = null
    this._ping = null

    this._onDocUpdate = (update, origin) => {
      if (origin === this) return
      if (this.ws && this.ws.readyState === OPEN && this.welcomed) {
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.writeUpdate(enc, update)
        this.ws.send(encoding.toUint8Array(enc))
      } else {
        this.unsynced = true
      }
    }
    this._onAwareness = ({ added, updated, removed }, origin) => {
      if (origin !== 'local') return
      const changed = added.concat(updated, removed)
      this._sendAwareness(changed)
    }
    this._onOnline = () => { if (this.shouldConnect && this.status === 'disconnected') { this.attempts = 0; this._open() } }
    this._onHide = () => {
      awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    }
    doc.on('update', this._onDocUpdate)
    this.awareness.on('update', this._onAwareness)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this._onOnline)
      window.addEventListener('pagehide', this._onHide)
    }
    if (connect) this.connect()
  }

  connect() {
    if (this.stale || this.fatal) return
    this.shouldConnect = true
    if (!this.ws) this._open()
  }

  disconnect() {
    this.shouldConnect = false
    clearTimeout(this._retry)
    this._retry = null
    if (this.ws) {
      try { this.ws.close(1000) } catch { /* already closing */ }
    }
  }

  destroy() {
    this.disconnect()
    this._onHide()
    this._teardown()
    this.doc.off('update', this._onDocUpdate)
    this.awareness.off('update', this._onAwareness)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this._onOnline)
      window.removeEventListener('pagehide', this._onHide)
    }
    this.awareness.destroy()
    super.destroy()
  }

  _setStatus(status) {
    if (this.status === status) return
    this.status = status
    this.emit('status', [{ status }])
  }

  _open() {
    if (!this.WebSocketImpl) { this._fail(0); return }
    this._setStatus('connecting')
    let ws
    try {
      ws = new this.WebSocketImpl(this.url)
    } catch {
      this._scheduleRetry()
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.welcomed = false
    this.synced = false
    ws.onopen = () => {
      this.lastFrameAt = Date.now()
      ws.send(JSON.stringify({ type: 'auth', token: this.getToken() || '' }))
      clearInterval(this._ping)
      this._ping = setInterval(() => this._heartbeat(), this.pingMs)
    }
    ws.onmessage = (ev) => {
      this.lastFrameAt = Date.now()
      if (typeof ev.data === 'string') this._onControl(ev.data)
      else this._onBinary(new Uint8Array(ev.data))
    }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = (ev) => this._onClose(ev?.code ?? 1006)
  }

  _heartbeat() {
    const ws = this.ws
    if (!ws || ws.readyState !== OPEN) return
    if (Date.now() - this.lastFrameAt > this.deadMs) {
      // Half-open socket (sleeping laptop, dropped proxy): start over.
      try { ws.close(4000) } catch { /* noop */ }
      this._onClose(1006)
      return
    }
    ws.send(JSON.stringify({ type: 'ping' }))
  }

  _onControl(text) {
    let msg
    try { msg = JSON.parse(text) } catch { return }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'welcome') {
      if (this.epoch && msg.epoch !== this.epoch) {
        // The server's document was rebuilt from the page; merging this
        // document into it would duplicate everything.
        this.stale = true
        this.shouldConnect = false
        try { this.ws.close(1000) } catch { /* noop */ }
        this.emit('stale', [msg.epoch])
        return
      }
      this.epoch = msg.epoch
      this.user = msg.user || null
      this.welcomed = true
      this.attempts = 0
      this._setStatus('connected')
      this.emit('welcome', [msg])
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.ws.send(encoding.toUint8Array(enc))
      if (this.awareness.getLocalState() !== null) this._sendAwareness([this.doc.clientID])
    } else if (msg.type === 'saved') {
      this.emit('saved', [msg.at])
    } else if (msg.type === 'error') {
      this.emit('error', [msg])
    }
  }

  _onBinary(buf) {
    const dec = decoding.createDecoder(buf)
    const enc = encoding.createEncoder()
    const kind = decoding.readVarUint(dec)
    if (kind === MSG_SYNC) {
      encoding.writeVarUint(enc, MSG_SYNC)
      const t = syncProtocol.readSyncMessage(dec, enc, this.doc, this)
      if (t === syncProtocol.messageYjsSyncStep1) {
        // Our reply carries every local change the server lacks.
        this.unsynced = false
      }
      if (t === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true
        this.emit('synced', [true])
      }
    } else if (kind === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this)
    } else if (kind === MSG_QUERY_AWARENESS) {
      this._sendAwareness(Array.from(this.awareness.getStates().keys()))
    }
    if (encoding.length(enc) > 1 && this.ws?.readyState === OPEN) this.ws.send(encoding.toUint8Array(enc))
  }

  _sendAwareness(clients) {
    if (!this.ws || this.ws.readyState !== OPEN || !this.welcomed) return
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients))
    this.ws.send(encoding.toUint8Array(enc))
  }

  _teardown() {
    clearInterval(this._ping)
    this._ping = null
    const ws = this.ws
    if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null }
    this.ws = null
    this.welcomed = false
    // Remote carets vanish with the connection.
    const others = Array.from(this.awareness.getStates().keys()).filter(id => id !== this.doc.clientID)
    if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
  }

  _onClose(code) {
    if (!this.ws) return
    this._teardown()
    const wasSynced = this.synced
    this.synced = false
    this._setStatus('disconnected')
    if (wasSynced) this.emit('synced', [false])
    if (FATAL.has(code)) { this._fail(code); return }
    if (this.stale || !this.shouldConnect) return
    this._scheduleRetry(code)
  }

  _fail(code) {
    this.fatal = code || 'unsupported'
    this.shouldConnect = false
    this._setStatus('disconnected')
    this.emit('fatal', [this.fatal])
  }

  _scheduleRetry(code) {
    clearTimeout(this._retry)
    const n = this.attempts++
    let delay = code === CLOSE.RESET ? 100 : Math.min(this.maxBackoffMs, 500 * 2 ** n)
    if (code === CLOSE.FULL) delay = Math.max(delay, 15000)
    delay += Math.floor(Math.random() * 250)
    this._retry = setTimeout(() => { this._retry = null; if (this.shouldConnect && !this.ws) this._open() }, delay)
  }
}

/** ws(s):// URL of a page's room, on the API's origin. */
export function collabUrl(pageId, base) {
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  return `${origin.replace(/\/+$/, '').replace(/^http/i, 'ws')}/api/collab/pages/${encodeURIComponent(pageId)}`
}
