/**
 * Shared artifact data (window.fintrack.db): the parent's validation of every
 * message from a frame, request/response, subscriptions fed by the change
 * feed, the offline write queue, nothing secret reaching the frame, the
 * frame accepting only its own messages, the in-frame SDK end to end (two
 * "visitors" on one store), republish handling, and the owner's Data panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: { pages: { artifactToken: vi.fn().mockResolvedValue({ token: 'embed-tok' }) } },
  API_BASE_URL: '',
  getAuthToken: () => 'secret-session-token',
}))
const confirmMock = vi.fn().mockResolvedValue(true)
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => confirmMock }))

import {
  DataBridge, DataError, HttpBackend, MemoryBackend, validateDbMessage, getVisitorId, MAX_FILE_BYTES,
} from '../components/artifacts/artifactData'
import ArtifactFrame from '../components/artifacts/ArtifactFrame'
import ArtifactDataPanel, { ACCESS_OPTIONS } from '../components/artifacts/ArtifactDataPanel'
import { DATA_SDK } from './artifactSdkSource'

const ID = '11111111-2222-4333-8444-555555555555'
const msg = (op, args, id = 'q1') => ({ type: '__ft_db', id, op, args })
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

afterEach(() => { cleanup(); vi.useRealTimers() })

// ── Validation ───────────────────────────────────────────────────────────

describe('validateDbMessage', () => {
  it('accepts each operation and passes on only the known fields', () => {
    const v = validateDbMessage(msg('add', { collection: 'tasks', data: { title: 'x' }, scope: 'private', extra: 'dropped', token: 'x' }))
    expect(v).toEqual({ op: 'add', args: { collection: 'tasks', scope: 'private', data: { title: 'x' } } })
    expect(validateDbMessage(msg('list', { collection: 'tasks', where: { done: false }, orderBy: 'score', desc: true, limit: 5000 })).args.limit).toBe(1000)
    expect(validateDbMessage(msg('increment', { collection: 'polls', id: ID, field: 'yes' })).args.by).toBe(1)
    expect(validateDbMessage(msg('upsert', { collection: 'stock', key: 'sku-1', data: {} })).args.key).toBe('sku-1')
    expect(validateDbMessage(msg('docSet', { name: 'config', data: { a: 1 }, merge: true })).args.merge).toBe(true)
    expect(validateDbMessage(msg('load', { collection: '_doc' })).args.collection).toBe('_doc')
    expect(validateDbMessage(msg('hello', { anything: 1 }))).toEqual({ op: 'hello', args: {} })
  })

  it.each([
    ['not an object', 'x'],
    ['wrong type', { type: '__ft_other', id: 'q', op: 'hello' }],
    ['no id', { type: '__ft_db', op: 'hello' }],
    ['long id', msg('hello', {}, 'x'.repeat(65))],
    ['unknown op', msg('drop', {})],
    ['prototype op', msg('constructor', {})],
    ['args not an object', msg('add', [1])],
    ['bad collection', msg('add', { collection: '1abc', data: {} })],
    ['reserved collection', msg('add', { collection: 'changes', data: {} })],
    ['internal collection written directly', msg('add', { collection: '_files', data: { path: 'pages/x' } })],
    ['path in collection', msg('list', { collection: '../pages' })],
    ['bad scope', msg('add', { collection: 't', data: {}, scope: 'all' })],
    ['array data', msg('add', { collection: 't', data: [1] })],
    ['non-plain data', msg('add', { collection: 't', data: new Date() })],
    ['bad record id', msg('remove', { collection: 't', id: "1' OR '1'='1" })],
    ['bad field', msg('increment', { collection: 't', id: ID, field: 'a b' })],
    ['NaN by', msg('increment', { collection: 't', id: ID, field: 'n', by: NaN })],
    ['where with too many fields', msg('list', { collection: 't', where: Object.fromEntries([...Array(9)].map((_, i) => [`f${i}`, 1])) })],
    ['oversized args', msg('add', { collection: 't', data: { big: 'x'.repeat(50_000) } })],
    ['empty key', msg('upsert', { collection: 't', key: '', data: {} })],
    ['file that is not a Blob', msg('filesUpload', { file: { size: 1 } })],
    ['file too large', msg('filesUpload', { file: new Blob([new Uint8Array(MAX_FILE_BYTES + 1)], { type: 'image/png' }) })],
    ['file of a refused type', msg('filesUpload', { file: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })],
  ])('refuses %s', (_label, m) => {
    expect(() => validateDbMessage(m)).toThrow(DataError)
  })
})

// ── The bridge ───────────────────────────────────────────────────────────

function fakeBackend(over = {}) {
  return {
    session: vi.fn().mockResolvedValue({ me: { id: 'h', isOwner: false, canAdd: true }, settings: { access: 'link_write' }, cursor: 5, rev: 'r1' }),
    changes: vi.fn(() => new Promise(() => {})),
    add: vi.fn(async (c, a) => ({ id: ID, collection: c, data: a.data, seq: 6 })),
    list: vi.fn(async () => ({ records: [] })),
    ...over,
  }
}

describe('DataBridge', () => {
  it('answers a request with the same id, and a failure with its status', async () => {
    const posted = []
    const backend = fakeBackend({ list: vi.fn().mockRejectedValue(new DataError('Nope', 403)) })
    const b = new DataBridge(backend, { post: m => posted.push(m) })
    await b.handle(msg('add', { collection: 'tasks', data: { t: 1 } }, 'a1'))
    await b.handle(msg('list', { collection: 'tasks' }, 'a2'))
    await b.handle(msg('nope', {}, 'a3'))
    const results = posted.filter(p => p.type === '__ft_db_result')
    expect(results[0]).toEqual({ type: '__ft_db_result', id: 'a1', ok: true, value: { id: ID, collection: 'tasks', data: { t: 1 }, seq: 6 } })
    expect(results[1]).toMatchObject({ id: 'a2', ok: false, error: { message: 'Nope', status: 403 } })
    expect(results[2]).toMatchObject({ id: 'a3', ok: false, error: { status: 400 } })
    expect(backend.add).toHaveBeenCalledWith('tasks', { collection: 'tasks', scope: 'shared', data: { t: 1 } })
    b.stop()
  })

  it('never hands the frame a token or the visitor id', async () => {
    const posted = []
    const b = new DataBridge(new HttpBackend({ mode: 'public', slug: 'todo', token: 'unlock-tok' }, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ me: { id: 'opaque', isOwner: false }, settings: {}, cursor: 1, rev: 'r' }), { status: 200 })),
    }), { post: m => posted.push(m), realtime: false })
    await b.handle(msg('hello', {}))
    const text = JSON.stringify(posted)
    expect(text).not.toContain('secret-session-token')
    expect(text).not.toContain('unlock-tok')
    expect(text).not.toContain(getVisitorId())
    b.stop()
  })

  it('pushes changes from the feed into the frame and reports a republish', async () => {
    const posted = []
    const onRevision = vi.fn()
    let n = 0
    const backend = fakeBackend({
      changes: vi.fn(async () => {
        n++
        if (n === 1) return { changes: [{ id: ID, collection: 'tasks', seq: 9, data: { t: 'x' } }], cursor: 9, rev: 'r1' }
        if (n === 2) return { changes: [], cursor: 9, rev: 'r2' }
        return new Promise(() => {})
      }),
    })
    const b = new DataBridge(backend, { post: m => posted.push(m), onRevision })
    b.start()
    await waitFor(() => expect(onRevision).toHaveBeenCalledWith('r2'))
    expect(posted.find(p => p.kind === 'changes').changes[0].data).toEqual({ t: 'x' })
    expect(backend.changes.mock.calls[0][0]).toBe(5)
    expect(backend.changes.mock.calls[1][0]).toBe(9)
    expect(backend.changes.mock.calls[0][1]).toMatchObject({ wait: 25, rev: 'r1' })
    b.stop()
  })

  it('queues writes while offline and sends them, in order, when back', async () => {
    const posted = []
    let online = false
    const sent = []
    const backend = fakeBackend({
      add: vi.fn(async (c, a) => {
        if (!online) throw Object.assign(new DataError('You appear to be offline.', 0), { network: true })
        sent.push(a.data.n)
        return { id: ID, collection: c, data: a.data, seq: 10 + a.data.n }
      }),
    })
    const b = new DataBridge(backend, { post: m => posted.push(m), realtime: false })
    const p1 = b.handle(msg('add', { collection: 't', data: { n: 1 } }, 'w1'))
    const p2 = b.handle(msg('add', { collection: 't', data: { n: 2 } }, 'w2'))
    await tick(10)
    expect(b.status).toBe('offline')
    expect(b.pendingWrites).toBe(2)
    expect(posted.some(p => p.kind === 'status' && p.status === 'offline')).toBe(true)
    online = true
    b.retryNow()
    await Promise.all([p1, p2])
    expect(sent).toEqual([1, 2])
    expect(b.status).toBe('synced')
    expect(posted.filter(p => p.type === '__ft_db_result').map(p => [p.id, p.ok])).toEqual([['w1', true], ['w2', true]])
    b.stop()
  })

  it('does not retry a write the server refused', async () => {
    const posted = []
    const backend = fakeBackend({ add: vi.fn().mockRejectedValue(new DataError('Only the owner can change the data in this artifact.', 403)) })
    const b = new DataBridge(backend, { post: m => posted.push(m), realtime: false })
    await b.handle(msg('add', { collection: 't', data: {} }))
    expect(backend.add).toHaveBeenCalledTimes(1)
    expect(posted.at(-1)).toMatchObject({ ok: false, error: { status: 403 } })
    expect(b.pendingWrites).toBe(0)
    b.stop()
  })
})

describe('HttpBackend', () => {
  it('sends the visitor id, the unlock token and the session only to the API', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"records":[]}', { status: 200 }))
    const be = new HttpBackend({ mode: 'public', slug: 'todo list', token: 'unlock' }, { fetchImpl })
    await be.list('tasks', { scope: 'shared', where: { done: false }, orderBy: 'createdAt', desc: true, limit: 10 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/public/pages/todo%20list/data/tasks?scope=shared&where=%7B%22done%22%3Afalse%7D&order_by=created_at&desc=1&limit=10')
    expect(init.headers['X-Visitor-Id']).toBe(getVisitorId())
    expect(init.headers['X-Page-Token']).toBe('unlock')
    expect(init.headers.Authorization).toBe('Bearer secret-session-token')
    const owner = new HttpBackend({ mode: 'owner', pageId: ID }, { fetchImpl })
    await owner.add('tasks', { data: { a: 1 }, scope: 'shared' })
    expect(fetchImpl.mock.calls[1][0]).toBe(`/api/pages/${ID}/data/tasks`)
    expect(fetchImpl.mock.calls[1][1].headers['X-Page-Token']).toBeUndefined()
  })

  it('marks no-answer and 5xx as retryable, a 4xx as final', async () => {
    const be = new HttpBackend({ mode: 'public', slug: 's' }, { fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) })
    await expect(be.session()).rejects.toMatchObject({ network: true, status: 0 })
    const be2 = new HttpBackend({ mode: 'public', slug: 's' }, { fetchImpl: vi.fn(async () => new Response('{"detail":"Page has expired"}', { status: 410 })) })
    await expect(be2.session()).rejects.toMatchObject({ network: false, status: 410, message: 'Page has expired' })
  })

  it('keeps one visitor id per browser', () => {
    const a = getVisitorId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(getVisitorId()).toBe(a)
  })
})

// ── The in-frame SDK, end to end over a memory store ─────────────────────

/** Runs the SDK in a fake frame window wired to a bridge, like a real frame. */
function frameWith(backend) {
  const listeners = []
  const parent = { postMessage: (m) => bridge.handle(structuredClone(m)) }
  const win = { addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn) } }
  win.parent = parent
  const bridge = new DataBridge(backend, {
    post: (m) => listeners.forEach(fn => fn({ source: parent, data: structuredClone(m) })),
  })
  new Function('window', 'parent', DATA_SDK)(win, parent)
  return { db: win.fintrack.db, bridge, inject: (data, source = parent) => listeners.forEach(fn => fn({ source, data })) }
}

describe('window.fintrack.db', () => {
  let store, a, b
  beforeEach(() => { store = new MemoryBackend(); a = frameWith(store); b = frameWith(store) })
  afterEach(() => { a.bridge.stop(); b.bridge.stop() })

  it('a task added by one visitor appears for the other, and a delete disappears', async () => {
    await a.db.ready
    const seenByA = []
    a.db.collection('tasks').subscribe(list => seenByA.push(list.map(r => r.data.title)))
    const added = await b.db.collection('tasks').add({ title: 'Buy milk' })
    expect(added.data.title).toBe('Buy milk')
    await waitFor(() => expect(seenByA.at(-1)).toEqual(['Buy milk']))
    await b.db.collection('tasks').remove(added.id)
    await waitFor(() => expect(seenByA.at(-1)).toEqual([]))
    expect(a.db.status).toBe('synced')
  })

  it('applies a write at once, then settles it with the stored record', async () => {
    const tasks = a.db.collection('tasks')
    const lists = []
    tasks.subscribe(list => lists.push(list))
    await tick(5)
    const realAdd = store.add.bind(store)
    store.add = async (...args) => { await tick(30); return realAdd(...args) }
    const p = tasks.add({ title: 'Now' })
    await tick(0)
    expect(lists.at(-1)[0]).toMatchObject({ data: { title: 'Now' }, pending: true })
    const rec = await p
    await waitFor(() => expect(lists.at(-1)).toEqual([expect.objectContaining({ id: rec.id, pending: false })]))
  })

  it('undoes an optimistic write the server refuses', async () => {
    const tasks = a.db.collection('tasks')
    const lists = []
    tasks.subscribe(list => lists.push(list.length))
    await tick(5)
    store.add = vi.fn().mockRejectedValue(new DataError('Only the owner can change the data in this artifact.', 403))
    await expect(tasks.add({ title: 'x' })).rejects.toThrow(/Only the owner/)
    await tick(0)
    expect(lists).toContain(1)
    expect(lists.at(-1)).toBe(0)
  })

  it('queries, counts, increments, upserts and documents', async () => {
    const s = a.db.collection('scores')
    await s.add({ name: 'a', score: 5, team: 'red' })
    await s.add({ name: 'b', score: 9, team: 'blue' })
    const c = await s.add({ name: 'c', score: 7, team: 'red' })
    expect((await s.list({ where: { team: 'red' }, orderBy: 'score', desc: true })).map(r => r.data.name)).toEqual(['c', 'a'])
    expect(await s.count({ team: 'red' })).toBe(2)
    await Promise.all([s.increment(c.id, 'score', 1), s.increment(c.id, 'score', 1)])
    expect((await s.get(c.id)).data.score).toBe(9)
    await s.upsert('k1', { qty: 1 })
    await s.upsert('k1', { price: 5 })
    expect((await s.list({ where: { qty: 1 } }))[0].data).toEqual({ qty: 1, price: 5 })
    const likes = b.db.doc('likes')
    const seen = []
    likes.subscribe(v => seen.push(v))
    await a.db.doc('likes').increment('count')
    await a.db.doc('likes').increment('count')
    await waitFor(() => expect(seen.at(-1)).toEqual({ count: 2 }))
    await a.db.doc('config').set({ theme: 'dark' })
    expect(await b.db.doc('config').get()).toEqual({ theme: 'dark' })
  })

  it('subscribe filters and sorts locally like the server', async () => {
    const t = a.db.collection('t')
    const views = []
    t.subscribe(list => views.push(list.map(r => r.data.n)), { where: { keep: true }, orderBy: 'n', desc: true })
    await t.add({ n: 1, keep: true })
    await t.add({ n: 3, keep: false })
    await t.add({ n: 2, keep: true })
    await waitFor(() => expect(views.at(-1)).toEqual([2, 1]))
  })

  it('ignores messages that do not come from its parent', async () => {
    const t = a.db.collection('x')
    const views = []
    t.subscribe(list => views.push(list.length))
    await tick(5)
    a.inject({ type: '__ft_db_event', kind: 'changes', changes: [{ id: ID, collection: 'x', scope: 'shared', seq: 99, data: {} }] }, { postMessage() {} })
    await tick(5)
    expect(views.at(-1)).toBe(0)
  })

  it('never rolls a record back for a stale or repeated event', async () => {
    const t = a.db.collection('x')
    const views = []
    t.subscribe(list => views.push(list.map(r => r.data.v)))
    await tick(5)
    a.inject({ type: '__ft_db_event', kind: 'changes', changes: [{ id: ID, collection: 'x', scope: 'shared', seq: 50, data: { v: 'new' } }] })
    a.inject({ type: '__ft_db_event', kind: 'changes', changes: [{ id: ID, collection: 'x', scope: 'shared', seq: 40, data: { v: 'old' } }] })
    await tick(5)
    expect(views.at(-1)).toEqual(['new'])
    a.inject({ type: '__ft_db_event', kind: 'changes', changes: [{ id: ID, collection: 'x', scope: 'shared', seq: 60, deleted: true, data: null }] })
    a.inject({ type: '__ft_db_event', kind: 'changes', changes: [{ id: ID, collection: 'x', scope: 'shared', seq: 50, data: { v: 'new' } }] })
    await tick(5)
    expect(views.at(-1)).toEqual([])
  })

  it('keeps private records to their own scope', async () => {
    await a.db.collection('notes', { scope: 'private' }).add({ t: 'mine' })
    expect(await a.db.collection('notes').list()).toEqual([])
    expect((await a.db.collection('notes', { scope: 'private' }).list()).map(r => r.data.t)).toEqual(['mine'])
  })

  it('reports status changes and who I am', async () => {
    const statuses = []
    a.db.onStatus(s => statuses.push(s))
    await a.db.ready
    expect(statuses).toContain('synced')
    expect(await a.db.me()).toMatchObject({ isOwner: true, canAdd: true })
  })

  it('runs on its own page when nothing answers', async () => {
    vi.useFakeTimers()
    const listeners = []
    const parent = { postMessage: () => {} }
    const win = { parent, addEventListener: (t, fn) => listeners.push(fn) }
    new Function('window', 'parent', DATA_SDK)(win, parent)
    const db = win.fintrack.db
    vi.advanceTimersByTime(6100)
    vi.useRealTimers()
    await db.ready
    expect(db.status).toBe('local')
    const r = await db.collection('t').add({ a: 1 })
    expect((await db.collection('t').list()).map(x => x.id)).toEqual([r.id])
  })
})

// ── ArtifactFrame ────────────────────────────────────────────────────────

describe('ArtifactFrame data bridge', () => {
  it('answers only messages from its own frame, and only with "*"', async () => {
    render(<ArtifactFrame src="about:blank" data={{ mode: 'memory' }} />)
    const frame = document.querySelector('iframe')
    const spy = vi.spyOn(frame.contentWindow, 'postMessage')
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: msg('hello', {}, 'stranger'), source: window }))
      await tick(5)
    })
    expect(spy).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: msg('hello', {}, 'mine'), source: frame.contentWindow }))
      await tick(5)
    })
    const reply = spy.mock.calls.find(c => c[0]?.id === 'mine')
    expect(reply[0]).toMatchObject({ type: '__ft_db_result', ok: true })
    expect(reply[1]).toBe('*')
    // The sandbox is untouched.
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('a published artifact uses the public data API for its slug', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    render(<ArtifactFrame slug="todo" token="tk" />)
    fireEvent.load(document.querySelector('iframe'))
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/public/pages/todo/data')
    fetchSpy.mockRestore()
  })
})

// ── Share popover ────────────────────────────────────────────────────────

describe('SharePopover', () => {
  const form = { slug: 'todo', description: '', folder: '', expires_at: '', is_password_protected: false, password: '', protect_source: false }
  const props = { open: true, onClose: () => {}, form, set: () => {}, onSlugEdit: () => {}, shareUrl: 'https://x/p/todo', isPublished: true, canPublish: true }

  it('says when an artifact collects data from visitors', async () => {
    const { default: SharePopover } = await import('../components/pages/SharePopover')
    const { unmount } = render(<SharePopover {...props} collectsData />)
    expect(document.querySelector('[data-collects-data]').textContent).toMatch(/saves what visitors enter/)
    unmount()
    render(<SharePopover {...props} />)
    expect(document.querySelector('[data-collects-data]')).toBeNull()
  })
})

// ── Data panel ───────────────────────────────────────────────────────────

function panelBackend() {
  const rows = [
    { id: ID, collection: 'tasks', data: { title: 'Milk', done: false }, author: 'Visitor abc123', scope: 'shared', updated_at: '2026-10-27T10:00:00Z' },
    { id: '99999999-2222-4333-8444-555555555555', collection: 'tasks', data: { title: 'Note' }, author: 'Visitor def456', scope: 'private', updated_at: '2026-10-27T10:00:00Z' },
  ]
  let conf = { access: 'link_write', own_only: false }
  return {
    session: vi.fn(async () => ({ settings: conf, cursor: 3, collections: [{ name: 'tasks', count: rows.length }] })),
    listAll: vi.fn(async () => ({ records: rows })),
    changes: vi.fn(() => new Promise(() => {})),
    settings: vi.fn(async (next) => { conf = next; return next }),
    remove: vi.fn(async () => ({})),
    filesRemove: vi.fn(),
    clear: vi.fn(async () => ({ ok: true })),
    exportFile: vi.fn(async () => new Blob(['a,b'])),
  }
}

describe('ArtifactDataPanel', () => {
  it('shows collections, records and who added them, with the access options in plain words', async () => {
    const be = panelBackend()
    render(<ArtifactDataPanel pageId={ID} isPublished backend={be} />)
    expect(await screen.findByText('Milk')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /tasks/ }).textContent).toContain('2')
    expect(screen.getByText('Visitor abc123')).toBeTruthy()
    expect(screen.getByText('private')).toBeTruthy()
    for (const o of ACCESS_OPTIONS) expect(screen.getByText(o.label)).toBeTruthy()
    expect(screen.getByLabelText(/Anyone with the link can add and edit/).checked).toBe(true)
    expect(screen.getByText('People can only edit what they added')).toBeTruthy()
  })

  it('changes access, deletes, clears and exports', async () => {
    const be = panelBackend()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    render(<ArtifactDataPanel pageId={ID} isPublished backend={be} />)
    await screen.findByText('Milk')
    await act(async () => { fireEvent.click(screen.getByLabelText(/Only I can change data/)) })
    expect(be.settings).toHaveBeenCalledWith({ access: 'owner', own_only: false })
    await waitFor(() => expect(screen.getByRole('checkbox').disabled).toBe(true))
    await act(async () => { fireEvent.click(screen.getByLabelText(/Anyone with the link can add and edit/)) })
    await act(async () => { fireEvent.click(screen.getByRole('checkbox')) })
    expect(be.settings).toHaveBeenLastCalledWith({ access: 'link_write', own_only: true })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete record Milk' })) })
    expect(be.remove).toHaveBeenCalledWith('tasks', ID)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Clear/ })) })
    expect(confirmMock).toHaveBeenCalled()
    expect(be.clear).toHaveBeenCalledWith('tasks')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /CSV/ })) })
    expect(be.exportFile).toHaveBeenCalledWith('csv', 'tasks')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /JSON/ })) })
    expect(be.exportFile).toHaveBeenCalledWith('json', 'tasks')
  })

  it('refreshes when the change feed reports something', async () => {
    const be = panelBackend()
    let release
    be.changes = vi.fn().mockImplementationOnce(() => new Promise(r => { release = r })).mockImplementation(() => new Promise(() => {}))
    render(<ArtifactDataPanel pageId={ID} backend={be} />)
    await screen.findByText('Milk')
    const before = be.listAll.mock.calls.length
    await act(async () => { release({ changes: [{ id: 'x' }], cursor: 4 }); await tick(5) })
    await waitFor(() => expect(be.listAll.mock.calls.length).toBeGreaterThan(before))
    expect(be.changes.mock.calls[0][1]).toMatchObject({ all: true, wait: 25 })
  })
})
