import '@testing-library/jest-dom'

// No test talks to a real server: a socket opened by a component under test
// (the live document editor) fails at once, as if the network were down.
// Tests that exercise sockets pass their own implementation.
globalThis.WebSocket = class OfflineWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1006 }) }, 0)
  }
  send() { throw new Error('offline') }
  close() {}
}
