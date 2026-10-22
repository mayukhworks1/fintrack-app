/**
 * Animation names and classes resolve to exactly one rule.
 *
 * Two ways motion has gone wrong here without any error. A second
 * `@keyframes ft-pop-in`, written for a centred toast, silently replaced the
 * first and left the demo's bulk-action bar and the contract inspector's clause
 * card shifted left by half their width; a second `ft-row-in` swapped the
 * sandbox rows' vertical arrival for a sideways one. And `animate-fadeIn` was
 * used on eight demo panels that never animated, because the class is
 * `animate-fade-in`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'index.css'), 'utf8')

function keyframes(name) {
  const out = []
  const re = new RegExp(`@keyframes\\s+${name}\\s*\\{`, 'g')
  for (const m of CSS.matchAll(re)) {
    let depth = 0
    let i = m.index + m[0].length - 1
    const start = i
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}' && --depth === 0) break
    }
    out.push(CSS.slice(start, i + 1))
  }
  return out
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('keyframes in index.css', () => {
  it('defines every name once', () => {
    const names = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1])
    const twice = names.filter((n, i) => names.indexOf(n) !== i)
    expect(twice).toEqual([])
  })

  it('ft-pop-in scales in place, without a horizontal shift', () => {
    const [body] = keyframes('ft-pop-in')
    expect(body).toMatch(/scale\(0\.92\)/)
    expect(body).not.toMatch(/translate\(-50%/)
  })

  it('ft-row-in brings rows up from below, as its comment describes', () => {
    const [body] = keyframes('ft-row-in')
    expect(body).toMatch(/translateY\(7px\)/)
    expect(body).not.toMatch(/translateX/)
  })
})

describe('animate-* classes used in the source', () => {
  // Tailwind's own animation utilities; everything else must come from index.css.
  const BUILT_IN = new Set(['animate-spin', 'animate-ping', 'animate-pulse', 'animate-bounce'])
  const used = new Set()
  for (const f of walk(ROOT)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\banimate-[A-Za-z0-9-]+/g)) used.add(m[0])
  }

  it('finds the classes it is guarding', () => {
    expect(used.has('animate-fade-in')).toBe(true)
  })

  for (const cls of [...used].filter(c => !BUILT_IN.has(c)).sort()) {
    it(`.${cls} has a rule`, () => {
      expect(new RegExp(`\\.${cls}\\s*\\{`).test(CSS), `${cls} is used but index.css has no rule for it`).toBe(true)
    })
  }
})
