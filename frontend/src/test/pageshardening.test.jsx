/**
 * The Pages module's robustness: the save queue (one save in flight, latest
 * wins, conflicts held, idempotent create retries), friendly errors, the
 * /pages/:id route, conflict handling in the editor, the quick switcher and
 * trash with Undo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { createPageSaver } from '../components/pages/pageSaver'
import { errorKind, friendlyError } from '../components/pages/pageErrors'
import { matchPages } from '../components/pages/QuickSwitcher'

const { state } = vi.hoisted(() => ({ state: { pages: [], full: {}, calls: [], updateImpl: null, contextImpl: null } }))

vi.mock('../services/api', () => {
  const rec = (name, fn) => vi.fn(async (...args) => { state.calls.push([name, ...args]); return fn(...args) })
  return {
    api: {
      pages: {
        list: vi.fn(async () => state.pages),
        get: rec('get', (id) => ({ ...state.full[id] })),
        context: rec('context', (id) => (state.contextImpl ? state.contextImpl(id) : { page: { ...state.full[id] }, breadcrumbs: [], children: [], row_context: null })),
        update: rec('update', (id, body) => (state.updateImpl ? state.updateImpl(id, body) : { ...state.full[id], ...body, updated_at: `t-${state.calls.length}` })),
        create: rec('create', (body) => ({ id: 'n1', ...body, updated_at: 't-new' })),
        publish: rec('publish', (id, on) => ({ ...state.full[id], is_published: on, updated_at: 't-pub' })),
        delete: rec('delete', (id) => ({ ok: true, trashed: [id, 'kid'] })),
        slugCheck: vi.fn(async () => ({ available: true, suggestions: [] })),
        versions: vi.fn(async () => ({ items: [] })),
        preview: vi.fn(async () => ({ token: 't' })),
      },
      pageTree: {
        tree: vi.fn(async () => ({ ready: true, pages: [], favourites: [] })),
        recent: vi.fn(async () => []),
        trash: vi.fn(async () => []),
        restore: rec('restore', () => ({ ok: true })),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ status: 'authed', role: 'editor', authRole: 'user', user: { email: 'm@example.com' }, hasPerm: () => false }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

const PAGE = { id: 'p1', slug: 'plan', title: 'Plan', content_type: 'markdown', content: '# Plan', is_published: false, view_count: 0, metadata: {}, updated_at: 't0' }
const OTHER = { id: 'b2', slug: 'beta-deck', title: 'Beta deck', content_type: 'markdown', content: 'x', is_published: true, view_count: 2, metadata: {}, updated_at: 't0' }

beforeEach(() => {
  state.pages = [PAGE, OTHER].map(({ content, ...p }) => p)
  state.full = { p1: { ...PAGE }, b2: { ...OTHER } }
  state.calls = []
  state.updateImpl = null
  state.contextImpl = null
  try { localStorage.clear() } catch { /* not available */ }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = () => new Promise(r => setTimeout(r, 0))
const err = (status, message) => Object.assign(new Error(message), { status })

describe('save queue', () => {
  it('keeps one save in flight and sends only the latest change after it', async () => {
    const first = deferred()
    const update = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (id, body) => ({ id, ...body, updated_at: 't2' }))
    const saver = createPageSaver({ id: 'p1', baseUpdatedAt: 't0', update })
    saver.schedule({ payload: { title: 'A' } })
    saver.schedule({ payload: { title: 'B' } })
    saver.schedule({ payload: { title: 'C' } })
    expect(update).toHaveBeenCalledTimes(1)
    first.resolve({ id: 'p1', updated_at: 't1' })
    expect(await saver.flush()).toBe(true)
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0][1]).toEqual({ title: 'A', base_updated_at: 't0' })
    // The latest change wins, sent against the copy the first save made.
    expect(update.mock.calls[1][1]).toEqual({ title: 'C', base_updated_at: 't1' })
  })

  it('holds a change on a 409 conflict until the editor decides', async () => {
    const onConflict = vi.fn()
    const update = vi.fn()
      .mockRejectedValueOnce(err(409, 'This page was changed since you opened it.'))
      .mockImplementation(async (id, body) => ({ id, ...body, updated_at: 't9' }))
    const saver = createPageSaver({ id: 'p1', baseUpdatedAt: 't0', update, onConflict })
    saver.schedule({ payload: { title: 'Mine' } })
    expect(await saver.flush()).toBe(false)
    expect(onConflict).toHaveBeenCalled()
    expect(saver.blocked).toBe('conflict')
    saver.schedule({ payload: { title: 'Mine 2' } })
    await flush()
    expect(update).toHaveBeenCalledTimes(1)
    saver.resolveConflict('mine', 't5')
    expect(await saver.flush()).toBe(true)
    expect(update).toHaveBeenLastCalledWith('p1', { title: 'Mine 2', base_updated_at: 't5' })
  })

  it('drops the held change when the server copy is loaded instead', async () => {
    const update = vi.fn().mockRejectedValueOnce(err(409, "{'code': 'conflict'}"))
    const saver = createPageSaver({ id: 'p1', baseUpdatedAt: 't0', update })
    saver.schedule({ payload: { title: 'Mine' } })
    await saver.flush()
    saver.resolveConflict('theirs', 't7')
    expect(await saver.flush()).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(saver.base).toBe('t7')
  })

  it('retries a create that got no answer with the same request id', async () => {
    vi.useFakeTimers()
    try {
      const create = vi.fn()
        .mockRejectedValueOnce(new Error('Request timed out — check your connection'))
        .mockImplementation(async (body) => ({ id: 'n1', ...body, updated_at: 't1' }))
      const onSaved = vi.fn()
      const statuses = []
      const saver = createPageSaver({ create, onSaved, onStatus: s => statuses.push(s.state), requestId: 'req-12345678' })
      saver.schedule({ payload: { title: 'New' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(statuses).toContain('retrying')
      await vi.advanceTimersByTimeAsync(2000)
      expect(create).toHaveBeenCalledTimes(2)
      expect(create.mock.calls[0][0].client_request_id).toBe('req-12345678')
      expect(create.mock.calls[1][0].client_request_id).toBe('req-12345678')
      expect(saver.id).toBe('n1')
      expect(onSaved).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('stops on a trashed page and on a refusal that another try will not change', async () => {
    const trashed = createPageSaver({ id: 'p1', update: vi.fn().mockRejectedValue(err(409, 'This page is in the trash — restore it to edit.')) })
    trashed.schedule({ payload: { title: 'x' } })
    await trashed.flush()
    expect(trashed.blocked).toBe('trashed')

    const statuses = []
    const big = createPageSaver({ id: 'p1', update: vi.fn().mockRejectedValue(err(413, 'too large')), onStatus: s => statuses.push(s.state) })
    big.schedule({ payload: { content: 'x' } })
    expect(await big.flush()).toBe(false)
    expect(statuses.at(-1)).toBe('error')
  })
})

describe('error messages', () => {
  it('names what happened in plain words', () => {
    expect(errorKind(new Error('Failed to fetch'))).toBe('offline')
    expect(errorKind(err(409, 'This page was changed since you opened it.'))).toBe('conflict')
    expect(errorKind(err(409, 'This page is in the trash — restore it to edit.'))).toBe('trashed')
    expect(errorKind(err(409, 'Someone is editing this page live'))).toBe('live')
    expect(friendlyError(err(413, 'x'))).toMatch(/too large/)
    expect(friendlyError(err(500, 'relation "page_versions" does not exist'))).not.toMatch(/relation/)
    expect(friendlyError(err(422, "column x does not exist"), 'load')).toBe('Could not load this page.')
  })

  it('matches titles word by word for the switcher', () => {
    const list = [{ id: 1, title: 'Q3 board pack', updated_at: '2026-01-01' }, { id: 2, title: 'Board minutes', updated_at: '2026-02-01' }, { id: 3, title: 'Other' }]
    expect(matchPages(list, 'board').map(p => p.id)).toEqual([2, 1])
    expect(matchPages(list, 'pack q3').map(p => p.id)).toEqual([1])
    expect(matchPages(list, '').map(p => p.id)).toEqual([2, 1, 3])
  })
})

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname}</output>
}
async function mount(path = '/pages') {
  const PagesManager = (await import('../pages/PagesManager')).default
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/pages/*" element={<><PagesManager /><Where /></>} /></Routes>
    </MemoryRouter>,
  )
}
const where = () => screen.getByTestId('where').textContent

describe('/pages/:id', () => {
  it('opens a deep link with one request and closes back to the list', async () => {
    await mount('/pages/p1')
    expect(await screen.findByDisplayValue('Plan')).toBeInTheDocument()
    expect(state.calls.filter(c => c[0] === 'context')).toEqual([['context', 'p1']])
    expect(state.calls.some(c => c[0] === 'get')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    await waitFor(() => expect(where()).toBe('/pages'))
    expect(await screen.findByRole('button', { name: 'Plan' })).toBeInTheDocument()
  })

  it('opening from the list puts the page in the address bar', async () => {
    await mount('/pages')
    fireEvent.click(await screen.findByRole('button', { name: 'Beta deck' }))
    await waitFor(() => expect(where()).toBe('/pages/b2'))
    expect(await screen.findByDisplayValue('Beta deck')).toBeInTheDocument()
  })

  it('never opens an editable page when loading it fails', async () => {
    state.contextImpl = () => { throw err(503, 'Service unavailable') }
    await mount('/pages/p1')
    expect(await screen.findByText('This page could not be opened')).toBeInTheDocument()
    expect(screen.queryByLabelText('Page title')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Page content' })).toBeNull()
    state.contextImpl = null
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByDisplayValue('Plan')).toBeInTheDocument()
    expect(state.calls.some(c => c[0] === 'update')).toBe(false)
  })

  it('sends base_updated_at and offers a way out of a conflict', async () => {
    let n = 0
    state.updateImpl = (id, body) => {
      n += 1
      if (n === 1) throw Object.assign(new Error('This page was changed since you opened it.'), { status: 409, code: 'conflict' })
      return { ...state.full[id], ...body, updated_at: 't-saved' }
    }
    await mount('/pages/p1')
    const title = await screen.findByDisplayValue('Plan')
    fireEvent.change(title, { target: { value: 'Plan v2' } })
    expect(await screen.findByText(/Someone else saved this page/, {}, { timeout: 4000 })).toBeInTheDocument()
    const first = state.calls.find(c => c[0] === 'update')
    expect(first[2]).toMatchObject({ title: 'Plan v2', base_updated_at: 't0' })

    state.full.p1 = { ...state.full.p1, updated_at: 't-theirs' }
    fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }))
    await waitFor(() => expect(state.calls.filter(c => c[0] === 'update')).toHaveLength(2))
    expect(state.calls.filter(c => c[0] === 'update')[1][2]).toMatchObject({ title: 'Plan v2', base_updated_at: 't-theirs' })
    await waitFor(() => expect(screen.queryByText(/Someone else saved this page/)).toBeNull())
  })

  it('publishes without leaving the editor', async () => {
    await mount('/pages/p1')
    await screen.findByDisplayValue('Plan')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(state.calls).toContainEqual(['publish', 'p1', true]))
    expect(await screen.findByText(/^Published ·/)).toBeInTheDocument()
    expect(where()).toBe('/pages/p1')
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()
  })
})

describe('keyboard and trash', () => {
  it('Ctrl+K opens the switcher and Enter opens the page', async () => {
    await mount('/pages')
    await screen.findByRole('button', { name: 'Beta deck' })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const dlg = await screen.findByRole('dialog', { name: 'Go to page' })
    fireEvent.change(within(dlg).getByRole('combobox'), { target: { value: 'bet' } })
    expect(within(dlg).getAllByRole('option')[0].textContent).toMatch(/Beta deck/)
    fireEvent.keyDown(within(dlg).getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(where()).toBe('/pages/b2'))
  })

  it('Ctrl+Alt+N starts a new document', async () => {
    await mount('/pages')
    await screen.findByRole('button', { name: 'Beta deck' })
    fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })
    await waitFor(() => expect(where()).toBe('/pages/new'))
  })

  it('moves to the trash at once and offers Undo', async () => {
    await mount('/pages')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Beta deck' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }))
    await waitFor(() => expect(state.calls).toContainEqual(['delete', 'b2']))
    expect(await screen.findByText(/Moved “Beta deck” and 1 sub-page to the trash/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Beta deck' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    await waitFor(() => expect(state.calls).toContainEqual(['restore', 'b2']))
  })

  it('shows a retry card, not an empty state, when the list fails', async () => {
    const { api } = await import('../services/api')
    api.pages.list.mockRejectedValueOnce(err(503, 'Service unavailable'))
    await mount('/pages')
    expect(await screen.findByText('Pages could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('No pages yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByRole('button', { name: 'Beta deck' })).toBeInTheDocument()
  })
})

afterEach(() => { vi.useRealTimers() })
