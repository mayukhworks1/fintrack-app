import { describe, it, expect } from 'vitest'
import {
  buildPageDocument,
  PAGE_SANDBOX,
  PAGE_MESSAGE_CHANNEL,
  VIEWER_RESET,
} from '../utils/pageHtml'

describe('PAGE_SANDBOX', () => {
  // The regression this guards against: the published viewer shipped
  // "allow-scripts ... allow-same-origin", which voids the sandbox. Published
  // pages are served from the app's own origin, so author script could then
  // read a signed-in visitor's auth token out of localStorage.
  it('never combines allow-scripts with allow-same-origin', () => {
    expect(PAGE_SANDBOX).toContain('allow-scripts')
    expect(PAGE_SANDBOX).not.toContain('allow-same-origin')
  })

  it('still permits the things author pages legitimately need', () => {
    expect(PAGE_SANDBOX).toContain('allow-popups')
    expect(PAGE_SANDBOX).toContain('allow-forms')
  })
})

describe('buildPageDocument', () => {
  it('wraps a bare fragment in a full document', () => {
    const out = buildPageDocument('<h1>Hi</h1>')
    expect(out).toMatch(/^<!DOCTYPE html>/)
    expect(out).toContain('<h1>Hi</h1>')
    expect(out).toContain('<meta charset="utf-8">')
  })

  it('keeps an author document intact and injects into its head', () => {
    const src = '<!DOCTYPE html><html><head><title>Mine</title></head><body><p>Body</p></body></html>'
    const out = buildPageDocument(src)
    expect(out).toContain('<title>Mine</title>')
    expect(out).toContain('<p>Body</p>')
    expect(out).toContain(VIEWER_RESET.split('\n')[0])
  })

  it('creates a head when the author wrote <html> without one', () => {
    const out = buildPageDocument('<html><body><p>No head</p></body></html>')
    expect(out).toContain('<head>')
    expect(out).toContain(VIEWER_RESET.split('\n')[0])
    expect(out).toContain('<p>No head</p>')
  })

  // Author styles must win. The reset is injected at the top of <head> and every
  // rule is wrapped in :where(), which has zero specificity.
  it('injects the reset before author styles', () => {
    const src = '<!DOCTYPE html><html><head><style>body{margin:40px}</style></head><body>x</body></html>'
    const out = buildPageDocument(src)
    expect(out.indexOf('margin:0')).toBeLessThan(out.indexOf('body{margin:40px}'))
  })

  // Parsed by rule, not by line: the .__ft-img-failed helper spans several
  // lines, and it is a class we own rather than part of the reset — its
  // specificity is intentional. Every rule that targets author elements must
  // stay at zero specificity so author CSS always wins.
  it('gives every element-targeting reset rule zero specificity', () => {
    const selectors = VIEWER_RESET.split('}')
      .map((rule) => rule.split('{')[0].trim())
      .filter(Boolean)
    const elementRules = selectors.filter((sel) => !sel.startsWith('.'))
    expect(elementRules.length).toBeGreaterThan(0)
    for (const sel of elementRules) {
      expect(sel, `"${sel}" must be wrapped in :where()`).toContain(':where(')
    }
  })

  // The reported bug: published pages showed an inset down both sides, which was
  // the browser's default 8px body margin.
  it('zeroes the default body margin that caused the side gaps', () => {
    expect(buildPageDocument('<p>x</p>')).toContain(':where(html,body){margin:0;padding:0}')
  })

  it('constrains media so an oversized image cannot force sideways scroll', () => {
    const out = buildPageDocument('<img src="huge.png">')
    expect(out).toContain(':where(img,svg,video,canvas){max-width:100%;height:auto}')
  })

  it('injects the runtime and its message channel', () => {
    const out = buildPageDocument('<p>x</p>')
    expect(out).toContain('<script>')
    expect(out).toContain(PAGE_MESSAGE_CHANNEL)
  })

  it('adds the runtime inside body for a full author document', () => {
    const out = buildPageDocument('<!DOCTYPE html><html><head></head><body><p>x</p></body></html>')
    expect(out).toContain(PAGE_MESSAGE_CHANNEL)
    expect(out.indexOf(PAGE_MESSAGE_CHANNEL)).toBeGreaterThan(out.indexOf('<p>x</p>'))
  })

  it('forces links out to a new tab via <base>', () => {
    expect(buildPageDocument('<a href="/x">x</a>')).toContain('<base target="_blank">')
  })

  it('only pads bare fragments when asked, never a full document', () => {
    expect(buildPageDocument('<p>x</p>', { padded: true })).toContain(':where(body){padding:14px}')
    expect(buildPageDocument('<p>x</p>')).not.toContain(':where(body){padding:14px}')
  })

  it.each([null, undefined, ''])('survives %p content', (v) => {
    expect(() => buildPageDocument(v)).not.toThrow()
    expect(buildPageDocument(v)).toMatch(/^<!DOCTYPE html>/)
  })
})
