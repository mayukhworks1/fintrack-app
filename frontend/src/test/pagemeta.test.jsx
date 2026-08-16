import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { metaForPath, titleFor } from '../utils/pageMeta'
import { usePageMeta } from '../hooks/usePageMeta'

describe('metaForPath', () => {
  it.each([
    ['/',              'Dashboard'],
    ['/projects',      'Projects'],
    ['/invoices',      'Invoices'],
    ['/tax',           'Tax Ledger'],
    ['/status',        'Status Board'],
    ['/profile',       'Profile'],
  ])('%s → %s', (path, page) => {
    expect(metaForPath(path).title).toBe(titleFor(page))
  })

  it('matches dynamic segments', () => {
    expect(metaForPath('/projects/rec123').title).toBe(titleFor('Project'))
    expect(metaForPath('/view/abc-token').title).toBe(titleFor('Shared view'))
    expect(metaForPath('/p/my-slug').title).toBe(titleFor('Page'))
  })

  it('prefers the more specific pattern over the collection route', () => {
    expect(metaForPath('/projects').title).toBe(titleFor('Projects'))
    expect(metaForPath('/projects/abc').title).toBe(titleFor('Project'))
  })

  it('tolerates a trailing slash', () => {
    expect(metaForPath('/invoices/').title).toBe(titleFor('Invoices'))
  })

  it('falls back to not-found for an unknown route', () => {
    expect(metaForPath('/nope').title).toBe(titleFor('Page not found'))
  })

  it('leads with the page name so a truncated tab stays distinguishable', () => {
    expect(titleFor('Invoices')).toBe('Invoices — FinTrack')
  })

  it('every route carries a description', () => {
    for (const p of ['/', '/projects', '/invoices', '/tax', '/analytics', '/ai', '/report', '/status', '/admin', '/pages', '/profile']) {
      expect(metaForPath(p).description, p).toBeTruthy()
    }
  })
})

function Meta({ title, description }) {
  usePageMeta({ title, description })
  return null
}
const descEl = () => document.head.querySelector('meta[name="description"]')
const ogTitleEl = () => document.head.querySelector('meta[property="og:title"]')

describe('usePageMeta', () => {
  beforeEach(() => {
    cleanup()
    document.head.innerHTML = ''
    document.title = 'FinTrack — AI Project Finance Manager'
    for (const [attr, key, content] of [
      ['name', 'description', 'App level description'],
      ['property', 'og:title', 'App level og title'],
    ]) {
      const el = document.createElement('meta')
      el.setAttribute(attr, key)
      el.setAttribute('content', content)
      document.head.appendChild(el)
    }
  })

  it('sets the title and description', () => {
    render(<Meta title="Invoices — FinTrack" description="Invoice tracker." />)
    expect(document.title).toBe('Invoices — FinTrack')
    expect(descEl().getAttribute('content')).toBe('Invoice tracker.')
  })

  it('mirrors the title into og:title', () => {
    render(<Meta title="Invoices — FinTrack" />)
    expect(ogTitleEl().getAttribute('content')).toBe('Invoices — FinTrack')
  })

  // The bug this replaced: PageViewer deleted these nodes on unmount, so
  // leaving a published page stripped the app's own share metadata.
  it('restores the previous values on unmount instead of deleting the tags', () => {
    const { unmount } = render(<Meta title="Page — FinTrack Pages" description="A shared page." />)
    expect(document.title).toBe('Page — FinTrack Pages')
    unmount()
    expect(document.title).toBe('FinTrack — AI Project Finance Manager')
    expect(descEl()).not.toBeNull()
    expect(descEl().getAttribute('content')).toBe('App level description')
    expect(ogTitleEl()).not.toBeNull()
    expect(ogTitleEl().getAttribute('content')).toBe('App level og title')
  })

  it('does nothing when given neither value', () => {
    render(<Meta />)
    expect(document.title).toBe('FinTrack — AI Project Finance Manager')
    expect(descEl().getAttribute('content')).toBe('App level description')
  })
})
