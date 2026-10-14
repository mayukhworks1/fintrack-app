/**
 * A code-protected web page reaches the viewer with no source in its JSON
 * (only a render token), and must still be framed rather than reported empty.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../services/api', () => ({
  api: { pages: {
    publicGet: vi.fn(async () => ({ id: '1', slug: 'deck', title: 'Deck', content_type: 'html', content: '',
      render_token: 'tok', metadata: { protect_source: true } })),
    publicLogView: vi.fn(async () => ({})),
  } },
  API_BASE_URL: 'https://api.example',
}))

describe('protected web page', () => {
  it('is framed from its render URL, not shown as empty', async () => {
    // The test DOM would otherwise try to load the framed page over the network.
    if (window.happyDOM?.settings) window.happyDOM.settings.disableIframePageLoading = true
    const PageViewer = (await import('../pages/PageViewer')).default
    render(<MemoryRouter initialEntries={['/p/deck']}><Routes><Route path="/p/:slug" element={<PageViewer />} /></Routes></MemoryRouter>)
    const frame = await screen.findByTitle('Deck')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('src')).toContain('t=tok')
    expect(screen.queryByText(/no content/i)).toBeNull()
  })
})
