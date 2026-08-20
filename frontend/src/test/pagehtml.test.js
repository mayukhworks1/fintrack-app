import { describe, it, expect, vi } from 'vitest'

vi.mock('../services/api', () => ({ API_BASE_URL: 'https://api.test' }))

const { PAGE_SANDBOX, pageRenderUrl, previewRenderUrl } = await import('../utils/pageHtml')

describe('PAGE_SANDBOX', () => {
  // The regression this guards against: the published viewer once shipped
  // "allow-scripts ... allow-same-origin", which voids the sandbox. The framed
  // document's own CSP is permissive now, so this attribute is the only thing
  // keeping author script away from the app — including a signed-in visitor's
  // auth token in localStorage.
  it('never combines allow-scripts with allow-same-origin', () => {
    expect(PAGE_SANDBOX).toContain('allow-scripts')
    expect(PAGE_SANDBOX).not.toContain('allow-same-origin')
  })

  it('never lets a framed page navigate the tab it sits in', () => {
    expect(PAGE_SANDBOX).not.toContain('allow-top-navigation')
  })

  it('permits the things author pages legitimately need', () => {
    expect(PAGE_SANDBOX).toContain('allow-popups')
    expect(PAGE_SANDBOX).toContain('allow-forms')
    expect(PAGE_SANDBOX).toContain('allow-modals')
  })
})

describe('render URLs', () => {
  // The page must be framed by URL, not by srcdoc: a srcdoc document inherits
  // the app's CSP, which blocks every script the author wrote.
  it('points at the API, not the app origin', () => {
    expect(pageRenderUrl('my-page')).toBe('https://api.test/api/public/pages/my-page/render')
  })

  it('carries the unlock token for a protected page', () => {
    expect(pageRenderUrl('secret', 'abc.def')).toContain('?t=abc.def')
  })

  it('omits the token parameter entirely when there is none', () => {
    expect(pageRenderUrl('open')).not.toContain('?')
  })

  it('escapes a slug so it cannot break out of the path', () => {
    expect(pageRenderUrl('a/b?c')).toBe('https://api.test/api/public/pages/a%2Fb%3Fc/render')
  })

  it('builds a preview URL from a token', () => {
    expect(previewRenderUrl('tok123')).toBe('https://api.test/api/public/pages/preview/tok123')
  })
})
