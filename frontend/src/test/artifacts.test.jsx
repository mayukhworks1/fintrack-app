/**
 * Artifacts: interactive mini-apps kept as pages (content_type "artifact").
 *
 * Covers the create flow from a template, the sandboxed preview frame, the
 * Refine prompt going through the page builder with the artifact brief, the
 * ArtifactFrame embedding contract, and that every template boots.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { auth, sse } = vi.hoisted(() => ({ auth: { granted: new Set() }, sse: { frames: [] } }))

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok([]),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 'tok', expires_in: 900 }),
        create: vi.fn().mockImplementation(async (d) => ({ id: 'p1', ...d })),
        update: vi.fn().mockImplementation(async (id, d) => ({ id, ...d })),
        artifactToken: ok({ token: 'embed-tok', expires_in: 3600 }),
        aiStream: vi.fn().mockImplementation(async () => {
          const text = sse.frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('')
          const bytes = new TextEncoder().encode(text)
          let sent = false
          return { body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) }) } }
        }),
        aiFixError: ok({ content: '' }),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'editor', authRole: 'user', user: { email: 'maker@example.com' },
    hasPerm: (key) => auth.granted.has(key),
  }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

import { api } from '../services/api'
import { PAGE_SANDBOX } from '../utils/pageHtml'
import { ARTIFACT_TEMPLATES } from '../components/artifacts/templates'
import ArtifactFrame, { readArtifactStore } from '../components/artifacts/ArtifactFrame'

beforeEach(() => {
  auth.granted = new Set()
  sse.frames = []
  vi.clearAllMocks()
  try { localStorage.clear() } catch { /* not available */ }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

async function openNewArtifact() {
  const PagesManager = (await import('../pages/PagesManager')).default
  render(<MemoryRouter><PagesManager /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /New artifact/ }))
  await screen.findAllByPlaceholderText('Page title…')
}

const GST = ARTIFACT_TEMPLATES.find(t => t.id === 'gst-calculator')

describe('Artifact templates', () => {
  it('ships eight complete single-file apps', () => {
    expect(ARTIFACT_TEMPLATES).toHaveLength(8)
    const ids = new Set(ARTIFACT_TEMPLATES.map(t => t.id))
    expect(ids.size).toBe(8)
    for (const t of ARTIFACT_TEMPLATES) {
      expect(t.html.startsWith('<!DOCTYPE html>')).toBe(true)
      expect(t.html).toMatch(/<title>[^<]+<\/title>/)
      expect(t.html).toMatch(/<meta name="description" content="[^"]+">/)
      expect(t.html).toContain('prefers-color-scheme: dark')
      // No network: nothing fetched, nothing loaded from elsewhere.
      expect(t.html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script src|<link[^>]+href="http/)
      expect(t.html).toContain("'en-IN'")
    }
  })

  it.each(ARTIFACT_TEMPLATES.map(t => [t.id, t]))('%s boots without a script error', (_id, t) => {
    const doc = new DOMParser().parseFromString(t.html, 'text/html')
    const script = doc.querySelector('script').textContent
    doc.querySelectorAll('script').forEach(s => s.remove())
    document.body.innerHTML = doc.body.innerHTML
    expect(() => new Function(script)()).not.toThrow()
    // Every result region starts filled in rather than blank or NaN.
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/)
    document.body.innerHTML = ''
  })

  it('GST calculator splits 18% within a state into CGST and SGST', () => {
    const doc = new DOMParser().parseFromString(GST.html, 'text/html')
    const script = doc.querySelector('script').textContent
    doc.querySelectorAll('script').forEach(s => s.remove())
    document.body.innerHTML = doc.body.innerHTML
    new Function(script)()
    const rate = document.getElementById('rate')
    rate.value = '18'
    rate.dispatchEvent(new Event('input'))
    expect(document.getElementById('total').textContent).toContain('11,800')
    expect(document.getElementById('split').textContent).toMatch(/CGST @ 9%.*900/)
    document.body.innerHTML = ''
  })
})

describe('Artifact editor', () => {
  it('a template creates an artifact page', async () => {
    await openNewArtifact()
    fireEvent.click(await screen.findByRole('button', { name: 'Use template: GST calculator' }))

    // The template's <title> names the page, and auto-save creates it.
    await waitFor(() => expect(screen.getAllByDisplayValue('GST Calculator').length).toBeGreaterThan(0))
    await waitFor(() => expect(api.pages.create).toHaveBeenCalled(), { timeout: 4000 })
    const payload = api.pages.create.mock.calls[0][0]
    expect(payload.content_type).toBe('artifact')
    expect(payload.title).toBe('GST Calculator')
    expect(payload.content).toBe(GST.html)
  })

  it('previews through the sandboxed render frame, beside the code', async () => {
    await openNewArtifact()
    fireEvent.click(await screen.findByRole('button', { name: 'Use template: EMI / loan calculator' }))
    expect(await screen.findByLabelText('Artifact code')).toBeTruthy()

    await waitFor(() => expect(document.querySelector('iframe[data-artifact-frame]')).not.toBeNull(), { timeout: 3000 })
    const frame = document.querySelector('iframe[data-artifact-frame]')
    expect(frame.getAttribute('sandbox')).toBe(PAGE_SANDBOX)
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('src')).toBe('/api/public/pages/preview/tok')
    expect(api.pages.preview).toHaveBeenCalledWith(ARTIFACT_TEMPLATES.find(t => t.id === 'emi-calculator').html)
  })

  it('Refine sends the artifact to the page builder with the artifact brief', async () => {
    auth.granted = new Set(['module.ai.use'])
    const revised = GST.html.replace('GST Calculator</h1>', 'GST Calculator (refined)</h1>')
    sse.frames = [
      { type: 'thought', text: 'Editing the page: add a reset', mode: 'edit' },
      { type: 'edit', ok: true, search: 'x', removed: 1, added: 1 },
      { type: 'done', content: revised, model_short: 'm', warnings: [] },
    ]
    await openNewArtifact()
    fireEvent.click(await screen.findByRole('button', { name: 'Use template: GST calculator' }))
    const box = await screen.findByLabelText('Refine the artifact')
    fireEvent.change(box, { target: { value: 'add a reset button' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refine' })) })

    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalled())
    const [body] = api.pages.aiStream.mock.calls[0]
    expect(body).toMatchObject({ prompt: 'add a reset button', content_type: 'artifact', existing: GST.html })
    await waitFor(() => expect(screen.getByLabelText('Artifact code').value).toBe(revised))
  })

  it('a prompt builds a new artifact through the stream', async () => {
    auth.granted = new Set(['module.ai.use'])
    const built = '<!DOCTYPE html><html><head><title>SIP Planner</title></head><body>ok</body></html>'
    sse.frames = [{ type: 'delta', delta: built }, { type: 'done', content: built, model_short: 'm', warnings: [] }]
    await openNewArtifact()
    fireEvent.change(await screen.findByLabelText('Describe the artifact'), { target: { value: 'a SIP planner' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Build artifact/ })) })
    await waitFor(() => expect(screen.getByLabelText('Artifact code').value).toBe(built))
    expect(api.pages.aiStream.mock.calls[0][0]).toMatchObject({ prompt: 'a SIP planner', content_type: 'artifact' })
    expect(api.pages.aiStream.mock.calls[0][0].existing).toBeUndefined()
    expect(screen.getAllByDisplayValue('SIP Planner').length).toBeGreaterThan(0)
  })

  it('hides the AI prompts without module.ai.use but keeps templates and paste', async () => {
    await openNewArtifact()
    expect(screen.queryByLabelText('Describe the artifact')).toBeNull()
    expect(screen.getByLabelText('Paste HTML')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Paste HTML'), { target: { value: '<h1>Mine</h1>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this HTML' }))
    expect((await screen.findByLabelText('Artifact code')).value).toBe('<h1>Mine</h1>')
    expect(screen.queryByLabelText('Refine the artifact')).toBeNull()
  })
})

describe('ArtifactFrame', () => {
  it('frames a published artifact by slug, sandboxed', () => {
    render(<ArtifactFrame slug="gst" height={300} />)
    const f = document.querySelector('iframe')
    expect(f.getAttribute('src')).toBe('/api/public/pages/gst/render')
    expect(f.getAttribute('sandbox')).toBe(PAGE_SANDBOX)
    expect(f.style.height).toBe('300px')
  })

  it('frames by page id, minting an embed token when none is given', async () => {
    render(<ArtifactFrame pageId="11111111-1111-1111-1111-111111111111" />)
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    expect(api.pages.artifactToken).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    expect(document.querySelector('iframe').getAttribute('src'))
      .toBe('/api/public/pages/by-id/11111111-1111-1111-1111-111111111111/render?t=embed-tok')
  })

  it('uses a given token without minting one', () => {
    render(<ArtifactFrame pageId="abc" token="given" />)
    expect(api.pages.artifactToken).not.toHaveBeenCalled()
    expect(document.querySelector('iframe').getAttribute('src')).toContain('/by-id/abc/render?t=given')
  })

  it('seeds saved state through the frame name and saves what the frame reports', () => {
    localStorage.setItem('ft_artifact_store:slug:gst', JSON.stringify({ a: '1' }))
    render(<ArtifactFrame slug="gst" />)
    const f = document.querySelector('iframe')
    expect(f.getAttribute('name')).toBe('__ftstore:{"a":"1"}')
    if (f.contentWindow) {
      // Only the frame's own window may write.
      window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_artifact_store', data: { a: 'x' } }, source: window }))
      expect(readArtifactStore('slug:gst')).toEqual({ a: '1' })
      window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_artifact_store', data: { a: '2', b: '3' } }, source: f.contentWindow }))
      expect(readArtifactStore('slug:gst')).toEqual({ a: '2', b: '3' })
    }
  })
})
