/**
 * Artifacts, as someone who is not a developer uses them: the start screen
 * offers suggestions and templates, building shows progress and can be
 * cancelled, a failure says what happened and offers Try again, a change that
 * replaces the code can be undone, the preview opens full screen as a proper
 * dialog, and an artifact embedded in a document loads gracefully.
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

const { sse, calls } = vi.hoisted(() => ({ sse: { scripts: [] }, calls: { n: 0 } }))

// Each stream call takes the next script: a list of frames, or 'hang' for a
// stream that only ends when its request is cancelled.
vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        preview: ok({ token: 'tok', expires_in: 900 }),
        artifactToken: ok({ token: 'embed-tok', expires_in: 3600 }),
        publicGet: vi.fn(),
        aiStream: vi.fn().mockImplementation(async (_body, { signal } = {}) => {
          const script = sse.scripts[calls.n++] ?? sse.scripts.at(-1)
          if (script === 'hang') {
            return { body: { getReader: () => ({ read: () => new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
            }) }) } }
          }
          if (script instanceof Error) throw script
          const bytes = new TextEncoder().encode(script.map(f => `data: ${JSON.stringify(f)}\n\n`).join(''))
          let sent = false
          return { body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) }) } }
        }),
        aiFixError: ok({ content: '' }),
      },
      pageLinks: { tree: vi.fn() },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

import { api } from '../services/api'
import { PAGE_SANDBOX } from '../utils/pageHtml'
import ArtifactStudio, { PROMPT_SUGGESTIONS } from '../components/artifacts/ArtifactStudio'
import ArtifactFrame, { fitHeight } from '../components/artifacts/ArtifactFrame'
import { resolvePageEmbed, resolveEmbed, EMBED_SANDBOX } from '../components/blocks/embeds'
import BlockViewer from '../components/blocks/BlockViewer'
import PagePicker from '../components/blocks/PagePicker'

const A = '<!DOCTYPE html><html><head><title>GST Calculator</title></head><body><h1>v1</h1></body></html>'
const B = '<!DOCTYPE html><html><head><title>GST Calculator</title></head><body><h1>v2 with reset</h1></body></html>'

beforeEach(() => {
  sse.scripts = []
  calls.n = 0
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
afterEach(() => { cleanup(); vi.useRealTimers() })

/** The studio with its content held in state, the way the page editor holds it. */
function Studio({ initial = '', onChangeSpy, ...props }) {
  const [content, setContent] = useState(initial)
  return (
    <ArtifactStudio content={content} title="GST Calculator" canUseAi
      onChange={(v) => { onChangeSpy?.(v); setContent(v) }} {...props} />
  )
}

describe('the start screen', () => {
  it('fills the request from a suggestion and builds with Ctrl+Enter', async () => {
    sse.scripts = [[{ type: 'done', content: A, model_short: 'm', warnings: [] }]]
    const onChangeSpy = vi.fn()
    render(<Studio onChangeSpy={onChangeSpy} />)
    expect(screen.getByRole('heading', { name: 'Create an artifact' })).toBeTruthy()
    const box = screen.getByLabelText('Describe the artifact')
    expect(box.getAttribute('aria-describedby')).toContain('art-describe-hint')

    fireEvent.click(screen.getByRole('button', { name: `Suggestion: ${PROMPT_SUGGESTIONS[1].label}` }))
    expect(box.value).toBe(PROMPT_SUGGESTIONS[1].prompt)

    await act(async () => { fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true }) })
    await waitFor(() => expect(onChangeSpy).toHaveBeenCalledWith(A))
    expect(api.pages.aiStream.mock.calls[0][0]).toMatchObject({ prompt: PROMPT_SUGGESTIONS[1].prompt, content_type: 'artifact' })
  })

  it('keeps paste-your-own-HTML out of the way, behind a disclosure', () => {
    render(<Studio />)
    const summary = screen.getByText('Have your own HTML? Paste or upload it')
    expect(summary.closest('details').open).toBe(false)
  })
})

describe('building', () => {
  it('announces progress in a live region and can be cancelled', async () => {
    sse.scripts = ['hang']
    const onChangeSpy = vi.fn()
    render(<Studio onChangeSpy={onChangeSpy} />)
    fireEvent.change(screen.getByLabelText('Describe the artifact'), { target: { value: 'a SIP planner' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Build artifact' })) })

    expect(screen.getByRole('status').textContent).toMatch(/Building your artifact/)
    expect(document.querySelector('[data-artifact-progress]')).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Stopped\. Nothing was changed\./))
    expect(onChangeSpy).not.toHaveBeenCalled()
    // Back on the start screen, with the request still there to try again.
    expect(screen.getByLabelText('Describe the artifact').value).toBe('a SIP planner')
  })

  it('says what went wrong and retries the same request with Try again', async () => {
    sse.scripts = [
      [{ type: 'error', message: 'The model timed out.' }],
      [{ type: 'done', content: A, model_short: 'm', warnings: [] }],
    ]
    const onChangeSpy = vi.fn()
    render(<Studio onChangeSpy={onChangeSpy} />)
    fireEvent.change(screen.getByLabelText('Describe the artifact'), { target: { value: 'a GST calculator' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Build artifact' })) })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Couldn't build that/)
    expect(alert.textContent).toMatch(/Your request is kept/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(onChangeSpy).toHaveBeenCalledWith(A))
    expect(api.pages.aiStream).toHaveBeenCalledTimes(2)
    expect(api.pages.aiStream.mock.calls[1][0].prompt).toBe('a GST calculator')
  })

  it('offers no retry when building is switched off for the workspace', async () => {
    const off = Object.assign(new Error('Set GROQ_API_KEY to turn building on.'), { status: 503 })
    sse.scripts = [off]
    render(<Studio />)
    fireEvent.change(screen.getByLabelText('Describe the artifact'), { target: { value: 'x' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Build artifact' })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Ask an admin/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

describe('changing a built artifact', () => {
  it('can undo a change that replaced the code, and redo it', async () => {
    sse.scripts = [[{ type: 'done', content: B, model_short: 'm', warnings: [] }]]
    const onChangeSpy = vi.fn()
    render(<Studio initial={A} onChangeSpy={onChangeSpy} />)
    const box = screen.getByLabelText('Describe a change')
    fireEvent.change(box, { target: { value: 'add a reset button' } })
    await act(async () => { fireEvent.submit(box.closest('form')) })
    await waitFor(() => expect(onChangeSpy).toHaveBeenLastCalledWith(B))
    expect(api.pages.aiStream.mock.calls[0][0]).toMatchObject({ existing: A })
    expect(screen.getByRole('status').textContent).toMatch(/Your changes are in/)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onChangeSpy).toHaveBeenLastCalledWith(A)
    expect(screen.getByRole('status').textContent).toMatch(/Restored the previous version/)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(onChangeSpy).toHaveBeenLastCalledWith(B)
  })

  it('offers follow-up ideas that fill the change box without running it', async () => {
    sse.scripts = [[{ type: 'done', content: B, model_short: 'm', warnings: [] }]]
    render(<Studio initial={A} />)
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'tweak' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make changes' })) })
    fireEvent.click(await screen.findByRole('button', { name: 'Add a reset button' }))
    expect(screen.getByLabelText('Describe a change').value).toBe('Add a reset button')
    expect(api.pages.aiStream).toHaveBeenCalledTimes(1)
  })

  it('Escape clears the change box', () => {
    render(<Studio initial={A} />)
    const box = screen.getByLabelText('Describe a change')
    fireEvent.change(box, { target: { value: 'oops' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
  })
})

describe('the workspace', () => {
  it('opens on the preview, with named layout toggles and a titled, sandboxed frame', async () => {
    render(<Studio initial={A} />)
    const group = screen.getByRole('group', { name: 'Layout' })
    const pressed = [...group.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')])
    expect(pressed).toEqual([['Preview', 'true'], ['Split', 'false'], ['Code', 'false']])
    await waitFor(() => expect(document.querySelector('iframe[data-artifact-frame]')).not.toBeNull(), { timeout: 3000 })
    const frame = document.querySelector('iframe[data-artifact-frame]')
    expect(frame.getAttribute('title')).toBe('Preview of GST Calculator')
    expect(frame.getAttribute('sandbox')).toBe(PAGE_SANDBOX)
    // Icon-only controls carry names.
    expect(screen.getByRole('button', { name: 'Reload preview' })).toBeTruthy()
    // A calm note about the sandbox rather than a warning.
    expect(screen.getByText(/Runs in a private sandbox/)).toBeTruthy()
  })

  it('opens the preview full screen as a modal dialog; Escape closes it and focus returns', async () => {
    render(<Studio initial={A} />)
    const opener = await screen.findByRole('button', { name: 'Open full screen' })
    await waitFor(() => expect(opener.disabled).toBe(false), { timeout: 3000 })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'GST Calculator, full screen' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exit full screen' })))
    expect(dialog.querySelector('iframe').getAttribute('sandbox')).toBe(PAGE_SANDBOX)

    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('also closes on Escape pressed inside the artifact, but not on a stranger’s message', async () => {
    render(<Studio initial={A} />)
    const opener = await screen.findByRole('button', { name: 'Open full screen' })
    await waitFor(() => expect(opener.disabled).toBe(false), { timeout: 3000 })
    fireEvent.click(opener)
    const frame = screen.getByRole('dialog').querySelector('iframe')
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_escape' }, source: window })) })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    if (frame.contentWindow) {
      act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_escape' }, source: frame.contentWindow })) })
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('copies the public link when published, and offers to get one when not', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onCopied = vi.fn()
    const { unmount } = render(<Studio initial={A} isPublished shareUrl="https://app.example/p/gst" onCopied={onCopied} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })) })
    expect(writeText).toHaveBeenCalledWith('https://app.example/p/gst')
    expect(onCopied).toHaveBeenCalled()
    unmount()

    const onShare = vi.fn()
    render(<Studio initial={A} onShare={onShare} />)
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Get a link' }))
    expect(onShare).toHaveBeenCalled()
  })
})

describe('ArtifactFrame loading and sizing', () => {
  it('fits a reported height, but leaves a frame-filling (100vh) document alone', () => {
    expect(fitHeight({ height: 640, viewport: 480 })).toBe(640)
    expect(fitHeight({ height: 300, viewport: 480 })).toBe(300)
    expect(fitHeight({ height: 480, viewport: 480 })).toBeNull()
    expect(fitHeight({ height: 5000, viewport: 480 }, 160, 900)).toBe(900)
    expect(fitHeight({ height: 20, viewport: 480 }, 160, 900)).toBe(160)
    expect(fitHeight({ height: 'x' })).toBeNull()
  })

  it('shows a skeleton until the frame loads, and follows only its own frame’s size', () => {
    render(<ArtifactFrame slug="gst" autoHeight height={420} />)
    const frame = document.querySelector('iframe')
    expect(document.querySelector('[data-artifact-skeleton]')).not.toBeNull()
    expect(document.querySelector('[data-artifact-box]').getAttribute('aria-busy')).toBe('true')

    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_frame_size', height: 700, viewport: 420 }, source: window })) })
    expect(frame.style.height).toBe('420px')
    if (frame.contentWindow) {
      act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: '__ft_frame_size', height: 700, viewport: 420 }, source: frame.contentWindow })) })
      expect(frame.style.height).toBe('700px')
      expect(document.querySelector('[data-artifact-skeleton]')).toBeNull()
    }
  })

  it('offers Try again and a new-tab link when the frame never loads', () => {
    vi.useFakeTimers()
    render(<ArtifactFrame slug="gst" loadTimeout={5000} openHref="/p/gst" />)
    expect(document.querySelector('[data-artifact-fallback]')).toBeNull()
    act(() => { vi.advanceTimersByTime(5001) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/taking longer than usual/)
    expect(screen.getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe('/p/gst')
    const before = document.querySelector('iframe')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(document.querySelector('[data-artifact-fallback]')).toBeNull()
    expect(document.querySelector('iframe')).not.toBe(before)
  })

  it('lets a failed token request be retried', async () => {
    api.pages.artifactToken.mockRejectedValueOnce(new Error('Network down'))
    render(<ArtifactFrame pageId="abc" />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Network down/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull())
    expect(api.pages.artifactToken).toHaveBeenCalledTimes(2)
  })
})

describe('artifacts inside a document', () => {
  it('recognises this site’s page links, and only those', () => {
    expect(resolvePageEmbed('/p/gst-calc')).toMatchObject({ provider: 'page', slug: 'gst-calc', path: '/p/gst-calc' })
    expect(resolvePageEmbed(`${window.location.origin}/p/gst-calc?x=1`)).toMatchObject({ slug: 'gst-calc' })
    expect(resolvePageEmbed('https://elsewhere.example/p/gst-calc')).toBeNull()
    expect(resolvePageEmbed('/p/../admin')).toBeNull()
    expect(resolvePageEmbed('//evil.example/p/x')).toBeNull()
    // Third-party providers are untouched.
    expect(resolveEmbed('/p/gst-calc')).toBeNull()
  })

  const docWith = (url) => JSON.stringify({ type: 'doc', content: [{ type: 'embed', attrs: { url } }] })

  it('frames a published artifact under the page sandbox, never the third-party one', async () => {
    api.pages.publicGet.mockResolvedValue({ id: 'p1', slug: 'gst-calc', title: 'GST calculator', content_type: 'artifact' })
    render(<BlockViewer content={docWith('/p/gst-calc')} variant="public" />)
    await waitFor(() => expect(document.querySelector('iframe[data-artifact-frame]')).not.toBeNull())
    const frame = document.querySelector('iframe[data-artifact-frame]')
    expect(frame.getAttribute('sandbox')).toBe(PAGE_SANDBOX)
    expect(frame.getAttribute('sandbox')).not.toBe(EMBED_SANDBOX)
    expect(frame.getAttribute('src')).toBe('/api/public/pages/gst-calc/render')
    expect(frame.getAttribute('title')).toBe('GST calculator (artifact)')
    expect(screen.getByRole('link', { name: /Open full screen/ }).getAttribute('href')).toBe('/p/gst-calc')
  })

  it('explains an unpublished artifact instead of framing an error', async () => {
    api.pages.publicGet.mockResolvedValue({ detail: 'Page not found' })
    render(<BlockViewer content={docWith('/p/draft-calc')} variant="public" />)
    expect(await screen.findByText(/isn’t available right now/)).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('offers Try again when the lookup fails', async () => {
    api.pages.publicGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'p1', title: 'GST', content_type: 'artifact' })
    render(<BlockViewer content={docWith('/p/gst-calc')} variant="public" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('iframe[data-artifact-frame]')).not.toBeNull())
  })

  it('the artifact picker lists only artifacts, and works from the keyboard', async () => {
    api.pageLinks.tree.mockResolvedValue({ pages: [
      { id: '1', title: 'Board memo', slug: 'board-memo', content_type: 'doc', is_published: true },
      { id: '2', title: 'GST calculator', slug: 'gst-calc', content_type: 'artifact', is_published: true },
      { id: '3', title: 'Runway', slug: 'runway', content_type: 'artifact', is_published: false },
    ] })
    const editor = { view: { coordsAtPos: () => ({ left: 10, bottom: 10 }) }, state: { selection: { from: 0 } }, commands: { focus: vi.fn() } }
    const onPick = vi.fn(), onClose = vi.fn()
    render(<PagePicker editor={editor} kind="artifact" onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Insert an artifact' })).toBeTruthy()
    const options = await screen.findAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['GST calculator', 'RunwayNot published yet: readers see it once it is'])
    const search = screen.getByLabelText('Search artifacts')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: 'runway' }))
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
