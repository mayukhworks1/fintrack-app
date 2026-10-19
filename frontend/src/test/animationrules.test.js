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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Every stylesheet the app ships: index.css and each file under src/styles.
// Keyframe names are global, so a duplicate in two different files breaks
// motion exactly as a duplicate in one file does.
const STYLES = join(ROOT, 'styles')
const FILES = [
  ['index.css', readFileSync(join(ROOT, 'index.css'), 'utf8')],
  ...(existsSync(STYLES)
    ? readdirSync(STYLES).filter(n => n.endsWith('.css')).sort()
        .map(n => [`styles/${n}`, readFileSync(join(STYLES, n), 'utf8')])
    : []),
]
const CSS = FILES.map(([, text]) => text).join('\n')

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

describe('keyframes across every stylesheet', () => {
  it('reads index.css and the files under src/styles', () => {
    expect(FILES[0][0]).toBe('index.css')
    expect(FILES.some(([name]) => name === 'styles/motion.css')).toBe(true)
  })

  it('defines every name once, across all files', () => {
    const names = []
    for (const [file, text] of FILES) {
      for (const m of text.matchAll(/@keyframes\s+([\w-]+)/g)) names.push(`${m[1]} (${file})`)
    }
    const bare = names.map(n => n.split(' ')[0])
    const twice = names.filter((n, i) => bare.indexOf(bare[i]) !== i)
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
      expect(new RegExp(`\\.${cls}\\s*\\{`).test(CSS), `${cls} is used but no stylesheet has a rule for it`).toBe(true)
    })
  }
})
