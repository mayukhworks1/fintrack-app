/**
 * Motion on the public pages.
 *
 * Two kinds of guard. The first renders the shared building blocks and checks
 * the attributes the CSS keys on. The second scans every public page for
 * `ft-*` classes and asserts each one has a rule in index.css — because
 * `ft-cta-link` shipped on /how-it-works with no CSS behind it at all, and a
 * class with no rule is a motion that silently never happens.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Stagger, Rule, PageHead } from '../components/PublicBits'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'index.css'), 'utf8')

describe('public building blocks', () => {
  it('Stagger keeps list semantics and carries the class the CSS keys on', () => {
    const { container } = render(<Stagger as="ol"><li>a</li><li>b</li></Stagger>)
    const ol = container.querySelector('ol.ft-stagger')
    expect(ol).not.toBeNull()
    expect(ol.querySelectorAll('li').length).toBe(2)
  })

  it('Rule draws from the left when asked', () => {
    const { container } = render(<Rule fromLeft />)
    expect(container.querySelector('hr.ft-rule.ft-rule-grow.from-left')).not.toBeNull()
  })

  it('PageHead stages its eyebrow and lede after the headline lines', () => {
    const { container } = render(<PageHead eyebrow="E" lines={['one', 'two']}>lede</PageHead>)
    expect(container.querySelectorAll('.ft-rise').length).toBe(2)
    expect(container.querySelector('.ft-eyebrow.ft-up')).not.toBeNull()
    expect(container.querySelector('.ft-lede.ft-up').style.getPropertyValue('--d')).toBe('260ms')
  })
})

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('every ft- class used on the public pages has a rule', () => {
  const files = [
    ...walk(join(ROOT, 'pages/public')),
    join(ROOT, 'pages/Landing.jsx'), join(ROOT, 'pages/Features.jsx'), join(ROOT, 'pages/Security.jsx'),
    join(ROOT, 'components/PublicBits.jsx'), join(ROOT, 'components/PublicLayout.jsx'),
  ]
  const used = new Set()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
      for (const token of m[1].split(/\s+/)) if (/^ft-[a-z0-9-]+$/.test(token)) used.add(token)
    }
  }
  it('finds the classes it is guarding', () => {
    expect(used.size).toBeGreaterThan(10)
  })
  for (const cls of [...used].sort()) {
    it(`.${cls} is defined`, () => {
      expect(CSS.includes(`.${cls}`), `${cls} is used in JSX but has no CSS rule`).toBe(true)
    })
  }
})
