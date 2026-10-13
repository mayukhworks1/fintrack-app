/**
 * A Web Page can be filled straight from a .html file on disk: the file's code
 * replaces the editor content and its <title> fills an empty page title.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok([]),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 't', expires_in: 900 }),
        create: ok({ id: 'p1' }),
        update: ok({ id: 'p1' }),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'viewer', authRole: 'user', user: { email: 'maker@example.com' },
    hasPerm: () => false,
  }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

describe('Pages editor HTML file upload', () => {
  it('loads a .html file into a Web Page', async () => {
    const PagesManager = (await import('../pages/PagesManager')).default
    render(<MemoryRouter><PagesManager /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /New Page/ }))
    await screen.findAllByPlaceholderText('Page title…')
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'html' } })

    const html = '<!doctype html><html><head><title>Logo Directions</title></head><body><b>the works</b></body></html>'
    const file = new File([html], 'logos.html', { type: 'text/html' })
    const input = document.querySelector('input[type="file"][accept*=".html"]')
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getAllByDisplayValue('Logo Directions').length).toBeGreaterThan(0))
    expect(document.querySelector('textarea').value).toBe(html)
  })
})
