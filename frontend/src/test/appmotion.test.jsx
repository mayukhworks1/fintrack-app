/**
 * Motion and width on the signed-in side.
 *
 * Every route arrives through one keyed wrapper; a page's sections cascade;
 * the first rows of a table arrive in sequence; the public container is
 * fluid rather than a 1120px column. Pinned by the classes the CSS keys on.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExecutiveShell } from '../components/ExecutiveUI'
import EmptyState from '../components/EmptyState'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'index.css'), 'utf8')

describe('signed-in motion', () => {
  it('the executive shell cascades its sections', () => {
    const { container } = render(<ExecutiveShell><section>a</section><section>b</section></ExecutiveShell>)
    expect(container.firstChild.classList.contains('ft-cascade')).toBe(true)
  })
  it('an empty state pops its mark', () => {
    const { container } = render(<EmptyState icon={<span>i</span>} title="Nothing here" />)
    expect(container.querySelector('.ft-empty-icon')).not.toBeNull()
  })
  it('the layout keys every route through one wrapper', () => {
    const src = readFileSync(join(ROOT, 'components/Layout.jsx'), 'utf8')
    expect(src).toMatch(/key=\{location\.pathname\} className="ft-route ft-page h-full"/)
  })
  it('table cascades never override a row a poll has flagged', () => {
    expect(CSS).toMatch(/tbody > tr:nth-child\(-n\+14\):not\(\.ft-row-new\):not\(\.ft-row-changed\)/)
  })
  it('entrances use fill-mode backwards so hovers and tilts keep their transform', () => {
    for (const sel of ['.ft-cascade > * {', '.ft-stagger-in > * {', '.ft-login-enter > * {']) {
      const i = CSS.indexOf(sel); expect(i).toBeGreaterThan(0)
      expect(CSS.slice(i, i + 160)).toMatch(/backwards/)
    }
  })
})

describe('site width', () => {
  it('no public page is pinned to the old 1120px column', () => {
    for (const f of ['pages/Landing.jsx', 'pages/Features.jsx', 'pages/Security.jsx',
                     'components/PublicBits.jsx', 'components/PublicLayout.jsx',
                     'pages/public/HowItWorks.jsx', 'pages/public/Customise.jsx', 'pages/public/Faq.jsx']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toMatch(/maxWidth:\s*1120/)
    }
  })
  it('the fluid container fills the viewport with a proportional gutter', () => {
    expect(CSS).toMatch(/\.ft-wrap \{[^}]*max-width: var\(--site-w, none\)/)
    expect(CSS).toMatch(/--site-gutter: clamp\(16px, 3\.5vw, 64px\)/)
  })
})
