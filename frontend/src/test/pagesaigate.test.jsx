/**
 * The Pages editor offers the AI composer only to people allowed to use it.
 *
 * Page generation now sits behind module.ai.use on the server, the same
 * permission the AI Assistant needs. Without a matching guard here, a user
 * without it would be shown "Agent Studio", type a brief, and get a bare
 * "Missing permission" error back — so the composer is hidden instead, the way
 * the sidebar already hides the AI Assistant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { auth } = vi.hoisted(() => ({ auth: { granted: new Set() } }))

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok([]),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 't', expires_in: 900 }),
      },
    },
    API_BASE_URL: '',
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'viewer', authRole: 'user', user: { email: 'maker@example.com' },
    hasPerm: (key) => auth.granted.has(key),
  }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
  auth.granted = new Set()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

async function openNewPage() {
  const PagesManager = (await import('../pages/PagesManager')).default
  render(<MemoryRouter><PagesManager /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /New Page/ }))
  // The editor is open once its title field is on screen.
  await screen.findAllByPlaceholderText('Page title…')
}

describe('Pages editor AI composer', () => {
  it('is hidden from a user without module.ai.use', async () => {
    await openNewPage()
    expect(screen.queryByRole('button', { name: /Agent Studio/ })).toBeNull()
  })

  it('is offered once the permission is granted', async () => {
    auth.granted.add('module.ai.use')
    await openNewPage()
    expect(screen.getByRole('button', { name: /Agent Studio/ })).toBeInTheDocument()
  })
})
