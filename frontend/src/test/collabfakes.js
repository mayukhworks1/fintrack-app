// An in-memory stand-in for the /api/collab socket: the same frames the
// server sends (welcome, y-protocols sync and awareness), relayed between the
// fake sockets connected to it.
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'

export class FakeServer {
  constructor({ doc, epoch = 'epoch-1', user = { name: 'Alice Rao', color: '#2383e2' }, refuse = null } = {}) {
    this.doc = doc || new Y.Doc()
    this.epoch = epoch
    this.user = user
    this.refuse = refuse          // close code to answer the auth frame with
    this.sockets = new Set()
    this.received = []
    this.presence = []            // awareness frames, replayed to joiners
    this.doc.on('update', (update, origin) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 0)
      syncProtocol.writeUpdate(enc, update)
      const frame = encoding.toUint8Array(enc)
      for (const s of this.sockets) if (s !== origin && s.authed) s._deliver(frame)
    })
    const server = this
    this.WebSocket = class extends FakeSocket {
      constructor(url) { super(url, server) }
    }
  }

  receive(sock, data) {
    this.received.push(data)
    if (typeof data === 'string') {
      const msg = JSON.parse(data)
      if (msg.type === 'auth') {
        if (this.tooLarge) {
          sock._deliver(JSON.stringify({ type: 'error', code: 'too_large', mode: 'rest', limit: 1500000, message: 'too large' }))
          setTimeout(() => sock._serverClose(4413), 5)
          return
        }
        if (this.refuse) { sock._serverClose(this.refuse); return }
        sock.authed = true
        sock.token = msg.token
        sock._deliver(JSON.stringify({ type: 'welcome', epoch: this.epoch, user: this.user, peers: this.sockets.size - 1 }))
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, 0)
        syncProtocol.writeSyncStep1(enc, this.doc)
        sock._deliver(encoding.toUint8Array(enc))
        for (const frame of this.presence) sock._deliver(frame)
      } else if (msg.type === 'ping') {
        sock._deliver(JSON.stringify({ type: 'pong' }))
      }
      return
    }
    const dec = decoding.createDecoder(new Uint8Array(data))
    const kind = decoding.readVarUint(dec)
    if (kind === 0) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 0)
      syncProtocol.readSyncMessage(dec, enc, this.doc, sock)
      if (encoding.length(enc) > 1) sock._deliver(encoding.toUint8Array(enc))
    } else if (kind === 1) {
      this.presence.push(new Uint8Array(data))
      for (const s of this.sockets) if (s !== sock && s.authed) s._deliver(new Uint8Array(data))
    }
  }

  dropAll(code = 1006) { for (const s of [...this.sockets]) s._serverClose(code) }
}

class FakeSocket {
  constructor(url, server) {
    this.url = url
    this.server = server
    this.readyState = 0
    this.authed = false
    server.sockets.add(this)
    setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.() } }, 0)
  }

  send(data) {
    if (this.readyState !== 1) throw new Error('not open')
    const copy = typeof data === 'string' ? data : new Uint8Array(data).slice()
    setTimeout(() => this.server.receive(this, copy), 0)
  }

  _deliver(data) {
    if (this.readyState !== 1) return
    const payload = typeof data === 'string' ? data : data.slice().buffer
    setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: payload }) }, 0)
  }

  _serverClose(code) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.server.sockets.delete(this)
    setTimeout(() => this.onclose?.({ code }), 0)
  }

  close(code = 1000) { this._serverClose(code) }
}

/** A WebSocket that never connects (blocked by a proxy, server down). */
export class DeadSocket {
  constructor() {
    this.readyState = 0
    setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1006 }) }, 0)
  }
  send() { throw new Error('not open') }
  close() {}
}
