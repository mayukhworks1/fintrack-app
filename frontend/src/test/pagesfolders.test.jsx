/**
 * Folders, search and duplicate on the Pages list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { calls } = vi.hoisted(() => ({ calls: { create: [], update: [] } }))

const PAGES = [
  { id: 'a', slug: 'acme-proposal', title: 'Acme proposal', content_type: 'html', is_published: true, view_count: 3, metadata: { folder: 'Clients' } },
  { id: 'b', slug: 'beta-deck', title: 'Beta deck', content_type: 'html', is_published: false, view_count: 0, metadata: { folder: 'Clients', description: 'pitch for globex' } },
  { id: 'c', slug: 'team-notes', title: 'Team notes', content_type: 'markdown', is_published: true, view_count: 1, metadata: {},
    expires_at: '2000-01-01T00:00:00Z' },
]

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok(PAGES),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 't', expires_in: 900 }),
        get: vi.fn(async (id) => ({ ...PAGES.find(p => p.id === id), content: '<p>x</p>' })),
        create: vi.fn(async (body) => { calls.create.push(body); return { id: 'new', ...body, is_published: false } }),
        update: vi.fn(async (id, body) => { calls.update.push([id, body]); return { ...PAGES.find(p => p.id === id), ...body } }),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ status: 'authed', role: 'viewer', authRole: 'user', user: { email: 'm@example.com' }, hasPerm: () => false }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
  calls.create = []; calls.update = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

async function mount() {
  const PagesManager = (await import('../pages/PagesManager')).default
  render(<MemoryRouter><PagesManager /></MemoryRouter>)
  await screen.findByText('Acme proposal')
}
const rows = () => screen.getAllByRole('row').slice(1).map(r => r.textContent)

describe('Pages folders and search', () => {
  it('filters by folder and by pages with no folder', async () => {
    await mount()
    const group = screen.getByRole('group', { name: 'Folders' })
    fireEvent.click(within(group).getByRole('button', { name: /Clients/ }))
    expect(rows().join('|')).toMatch(/Acme proposal.*Beta deck/)
    expect(rows().join('|')).not.toMatch(/Team notes/)
    fireEvent.click(within(group).getByRole('button', { name: /No folder/ }))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatch(/Team notes/)
  })

  it('searches descriptions and folder names, word by word', async () => {
    await mount()
    fireEvent.change(screen.getByPlaceholderText(/Search title/), { target: { value: 'globex pitch' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatch(/Beta deck/)
  })

  it('shows expired pages under the Expired tab', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatch(/Team notes.*Expired/)
  })

  it('moves a page to a folder from the list', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Team notes' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to folder/ }))
    fireEvent.change(await screen.findByLabelText('Folder name'), { target: { value: 'Internal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.update).toHaveLength(1))
    expect(calls.update[0]).toEqual(['c', { metadata: { folder: 'Internal' } }])
  })
})

describe('Duplicate', () => {
  it('creates an unpublished copy and opens it in the editor', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Acme proposal' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate as draft/ }))
    await waitFor(() => expect(calls.create).toHaveLength(1))
    const body = calls.create[0]
    expect(body.title).toBe('Acme proposal (Copy)')
    expect(body.metadata.folder).toBe('Clients')
    expect(body.slug).not.toBe('acme-proposal')
    expect(body).not.toHaveProperty('expires_at')
    expect(await screen.findByDisplayValue('Acme proposal (Copy)')).toBeInTheDocument()
  })
})

describe('Editor settings', () => {
  it('saves folder, expiry in IST and protection, keeping other settings', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Beta deck' }))
    await screen.findByDisplayValue('Beta deck')
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'Prospects' } })
    fireEvent.change(screen.getByLabelText('Link expires (IST)'), { target: { value: '2030-01-15T18:00' } })
    fireEvent.click(screen.getByLabelText(/Protect code/))
    expect(screen.getByText(/15 Jan 2030.*IST/)).toBeInTheDocument()

    await waitFor(() => expect(calls.update.length).toBeGreaterThan(0), { timeout: 4000 })
    const [id, body] = calls.update.at(-1)
    expect(id).toBe('b')
    expect(body.expires_at).toBe('2030-01-15T18:00:00+05:30')
    expect(body.metadata).toMatchObject({ folder: 'Prospects', protect_source: true, description: 'pitch for globex' })
  })
})

describe('List layout', () => {
  it('sorts by name and by views', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Sort pages'), { target: { value: 'title' } })
    expect(rows().map(r => r.match(/^(Acme proposal|Beta deck|Team notes)/)?.[1])).toEqual(['Acme proposal', 'Beta deck', 'Team notes'])
    fireEvent.change(screen.getByLabelText('Sort pages'), { target: { value: 'views' } })
    expect(rows()[0]).toMatch(/^Acme proposal/)
    expect(rows()[2]).toMatch(/^Beta deck/)
  })

  it('keeps rare actions in a menu that closes on Escape', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Beta deck' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Publish' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"/" focuses search', async () => {
    await mount()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(screen.getByLabelText('Search pages'))
  })
})
