/**
 * Live co-editing: the socket provider speaks the sync / awareness protocol,
 * two documents converge through it, a dead socket leaves the ordinary editor
 * and autosave in charge, and the header shows who is editing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import * as Y from 'yjs'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { CollabProvider, collabUrl, CLOSE } from '../components/blocks/collab/provider'
import { PresenceBar } from '../components/blocks/collab/PresenceBar'
import { canonicalDoc, sameDoc, peersOf, initials } from '../components/blocks/collab/presence'
import CollabDoc from '../components/blocks/collab/CollabDoc'
import { FakeServer, DeadSocket } from './collabfakes'
import fixture from './collab-fixture.json'

vi.mock('../services/api', () => ({ api: { pages: {} }, API_BASE_URL: 'https://api.example', getAuthToken: () => 'tok-123' }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})
afterEach(() => cleanup())

const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** A server document seeded the way the backend seeds a room. */
function seededServer(opts = {}) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, fromB64(fixture.pythonUpdate))
  return new FakeServer({ doc, ...opts })
}

function provider(server, extra = {}) {
  const doc = new Y.Doc()
  const p = new CollabProvider({ url: 'wss://api.example/api/collab/pages/p1', doc, getToken: () => 'tok-123', WebSocketImpl: server.WebSocket, ...extra })
  return { doc, p }
}

const synced = (p) => new Promise(res => { if (p.synced) res(); else p.on('synced', ok => ok && res()) })
const text = (doc) => JSON.stringify(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')))

describe('server-seeded documents', () => {
  it('the Python seeding reads back as the same document in the editor library', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, fromB64(fixture.pythonUpdate))
    expect(canonicalDoc(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')))).toBe(canonicalDoc(fixture.doc))
  })
})

describe('CollabProvider', () => {
  it('authenticates in the first frame, never in the URL', async () => {
    const server = seededServer()
    const { p } = provider(server)
    await synced(p)
    expect(typeof server.received[0]).toBe('string')
    expect(JSON.parse(server.received[0])).toEqual({ type: 'auth', token: 'tok-123' })
    expect([...server.sockets][0].url).not.toMatch(/tok-123/)
    expect(collabUrl('abc', 'https://api.example')).toBe('wss://api.example/api/collab/pages/abc')
    expect(collabUrl('abc', 'http://localhost:8765/')).toBe('ws://localhost:8765/api/collab/pages/abc')
    p.destroy()
  })

  it('handles sync messages: receives the server state and reports synced', async () => {
    const server = seededServer()
    const { doc, p } = provider(server)
    const statuses = []
    p.on('status', ({ status }) => statuses.push(status))
    await synced(p)
    expect(p.epoch).toBe('epoch-1')
    expect(p.user).toEqual({ name: 'Alice Rao', color: '#2383e2' })
    expect(statuses).toEqual(['connected'])
    expect(text(doc)).toBe(text(server.doc))
    p.destroy()
  })

  it('two editors converge through the server', async () => {
    const server = seededServer()
    const a = provider(server)
    const b = provider(server)
    await Promise.all([synced(a.p), synced(b.p)])
    const firstText = (doc) => doc.getXmlFragment('default').get(0).get(0)
    firstText(a.doc).insert(0, 'A: ')
    firstText(b.doc).insert(firstText(b.doc).length, '!')
    await waitFor(() => expect(text(a.doc)).toBe(text(b.doc)))
    expect(firstText(a.doc).toString()).toBe('A: Q4 plan!')
    expect(text(server.doc)).toBe(text(a.doc))
    a.p.destroy(); b.p.destroy()
  })

  it('relays presence and drops remote carets when the socket goes', async () => {
    const server = seededServer()
    const a = provider(server)
    const b = provider(server)
    await Promise.all([synced(a.p), synced(b.p)])
    a.p.awareness.setLocalStateField('user', { name: 'Alice Rao', color: '#2383e2' })
    await waitFor(() => expect(peersOf(b.p.awareness, b.doc.clientID)).toEqual([
      { clientId: a.doc.clientID, name: 'Alice Rao', color: '#2383e2' },
    ]))
    b.p.disconnect()
    await waitFor(() => expect(peersOf(b.p.awareness, b.doc.clientID)).toEqual([]))
    a.p.destroy(); b.p.destroy()
  })

  it('queues edits made offline and merges them on reconnect to the same epoch', async () => {
    const server = seededServer()
    const { doc, p } = provider(server, { maxBackoffMs: 20 })
    await synced(p)
    server.dropAll()
    await waitFor(() => expect(p.status).not.toBe('connected'))
    doc.getXmlFragment('default').get(0).get(0).insert(0, 'offline ')
    expect(p.unsynced).toBe(true)
    await waitFor(() => expect(p.synced).toBe(true))
    await waitFor(() => expect(text(server.doc)).toBe(text(doc)))
    expect(p.unsynced).toBe(false)
    p.destroy()
  })

  it('stops and reports a rebuilt server document instead of merging into it', async () => {
    const server = seededServer()
    const { p } = provider(server, { maxBackoffMs: 20 })
    await synced(p)
    const stale = vi.fn()
    p.on('stale', stale)
    server.epoch = 'epoch-2'
    server.dropAll(CLOSE.RESET)
    await waitFor(() => expect(stale).toHaveBeenCalledWith('epoch-2'))
    expect(p.synced).toBe(false)
    p.destroy()
  })

  it('gives up on refused access', async () => {
    const server = seededServer({ refuse: CLOSE.FORBIDDEN })
    const { p } = provider(server)
    const fatal = await new Promise(res => p.on('fatal', res))
    expect(fatal).toBe(CLOSE.FORBIDDEN)
    expect(p.shouldConnect).toBe(false)
    p.destroy()
  })
})

describe('presence UI', () => {
  it('shows the connection state and the people editing', () => {
    render(<PresenceBar mode="live" peers={[
      { clientId: 1, name: 'Bob Iyer', color: '#d9730d' },
      { clientId: 2, name: 'Chitra', color: '#0f7b6c' },
    ]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Live')
    expect(screen.getByLabelText('Bob Iyer')).toHaveTextContent('BI')
    expect(screen.getByLabelText('Bob Iyer')).toHaveAttribute('title', 'Bob Iyer is editing')
    expect(screen.getByLabelText('2 other people editing')).toBeInTheDocument()
  })

  it('says when saving has fallen back', () => {
    const { rerender } = render(<PresenceBar mode="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
    rerender(<PresenceBar mode="offline" />)
    expect(screen.getByRole('status')).toHaveTextContent('Offline — saving normally')
    rerender(<PresenceBar mode="off" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('helpers', () => {
    expect(initials('ann')).toBe('A')
    expect(sameDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph' }] },
      '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"x"}]}]}')).toBe(true)
  })
})

describe('CollabDoc', () => {
  const VALUE = JSON.stringify(fixture.doc)

  it('falls back to the ordinary editor and autosave when the socket fails', async () => {
    const modes = []
    const onChange = vi.fn()
    let editor = null
    render(<CollabDoc pageId="p1" value={VALUE} onChange={onChange} isContentSaved={() => true}
      onModeChange={(m) => modes.push(m)} onReady={e => { editor = e }}
      providerOptions={{ WebSocketImpl: DeadSocket }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Offline — saving normally'))
    expect(modes).toContain('offline')
    expect(modes).not.toContain('live')
    // The editor still edits and reports changes: autosave carries on.
    await waitFor(() => expect(editor).not.toBeNull())
    act(() => { editor.commands.insertContentAt(1, 'typed ') })
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)[0]).toContain('typed Q4 plan')
  })

  it('goes live with the server copy and shows other editors', async () => {
    const server = seededServer()
    const other = provider(server)
    await synced(other.p)
    other.p.awareness.setLocalStateField('user', { name: 'Bob Iyer', color: '#d9730d' })
    const modes = []
    let editor = null
    const onChange = vi.fn()
    render(<CollabDoc pageId="p1" value={VALUE} onChange={onChange} isContentSaved={() => true}
      onModeChange={(m) => modes.push(m)} onReady={e => { editor = e }}
      providerOptions={{ WebSocketImpl: server.WebSocket }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Live'))
    expect(modes).toContain('live')
    await waitFor(() => expect(screen.getByLabelText('Bob Iyer')).toBeInTheDocument())
    // A remote edit arrives in this editor...
    other.doc.getXmlFragment('default').get(0).get(0).insert(0, 'Remote ')
    await waitFor(() => expect(editor.getText()).toContain('Remote Q4 plan'))
    // ...and a local one reaches the other side.
    act(() => { editor.commands.insertContentAt(1, 'Local ') })
    await waitFor(() => expect(other.doc.getXmlFragment('default').get(0).get(0).toString()).toBe('Local Remote Q4 plan'))
    other.p.destroy()
  })

  it('a stale local copy never overwrites the shared document when going live', async () => {
    const server = seededServer()
    const before = text(server.doc)
    const stale = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stale copy' }] }] })
    let editor = null
    const onChange = vi.fn()
    // The page last saved this copy, so nothing typed is at risk: the server's
    // newer copy wins.
    render(<CollabDoc pageId="p1" value={stale} onChange={onChange} isContentSaved={() => true}
      onReady={e => { editor = e }} providerOptions={{ WebSocketImpl: server.WebSocket }} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Live'))
    await waitFor(() => expect(editor.getText()).toContain('Q4 plan'))
    await new Promise(r => setTimeout(r, 50))
    expect(editor.getText()).not.toContain('stale copy')
    expect(text(server.doc)).toBe(before)
  })

  it('without a saved page id there is no live session', () => {
    render(<CollabDoc pageId={null} value={VALUE} onChange={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
