/**
 * Every palette × mode defines the full token set.
 *
 * The app reads ~100 colour tokens. A token missing from one set does not
 * error: the browser falls back to the inherited (Graphite) value, so one
 * palette quietly shows another's colour, or a dark surface picks up a light
 * one. These assertions read index.css and fail on any gap.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CSS, SRC, PALETTES, MODES, paletteBlocks } from './themeTokens'

const BLOCKS = paletteBlocks()

// The tokens the app was built on, plus the ones the palettes introduced.
const REQUIRED = [
  'bg-base', 'bg-layer', 'bg-2', 'bg-input', 'card-bg', 'card-border', 'border', 'border-strong', 'border-focus',
  'text-1', 'text-2', 'text-3',
  'accent', 'accent-dim', 'accent-soft', 'accent-glow', 'accent-ink', 'accent-btn', 'accent-btn-hover',
  'accent-bright', 'accent-fg', 'accent-gradient',
  'fin-positive', 'fin-pos-bg', 'fin-pos-border', 'fin-warning', 'fin-warn-bg', 'fin-warn-border',
  'fin-negative', 'fin-neg-bg', 'fin-neg-border', 'ok', 'bad', 'warn', 'danger-btn', 'danger-fg',
  'card-shadow', 'card-shadow-hover', 'shadow-sm', 'shadow-popover', 'btn-shadow', 'btn-shadow-hover', 'glow',
  'focus-ring', 'focus-color', 'selection-bg', 'selection-fg', 'scrollbar-thumb', 'scrollbar-thumb-hover',
  'sidebar-bg', 'sidebar-border', 'nav-active-bg',
  'rail-bg', 'rail-surface', 'rail-border', 'rail-fg', 'rail-fg-2', 'rail-fg-3', 'rail-hover', 'rail-active',
  'rail-raise', 'rail-raise-hover', 'rail-gutter', 'rail-shadow',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-grid', 'chart-axis',
  'row-selected', 'row-hover', 'table-row-even', 'table-row-odd', 'table-row-hover', 'table-row-shadow',
  'skeleton-base', 'skeleton-shine', 'glass-bg', 'glass-bg-hover', 'glass-border', 'glass-border-hi', 'blur',
  'kpi-1-bg', 'kpi-1-fg', 'kpi-2-bg', 'kpi-2-fg', 'kpi-3-bg', 'kpi-3-fg', 'kpi-4-bg', 'kpi-4-fg', 'kpi-5-bg', 'kpi-5-fg',
  'scrim', 'tooltip-bg', 'tooltip-fg', 'hero-wash',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'test') walk(p, out) }
    else if (/\.(jsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('palette token sets in index.css', () => {
  it('has all six palette × mode sets', () => {
    const keys = PALETTES.flatMap(p => MODES.map(m => `${p}/${m}`))
    expect(Object.keys(BLOCKS).sort()).toEqual(keys.sort())
  })

  it('keys each set on html[data-palette] and html.dark, with Graphite as the default', () => {
    for (const p of PALETTES) {
      expect(BLOCKS[`${p}/light`].selector).toContain(`html[data-palette="${p}"]`)
      expect(BLOCKS[`${p}/dark`].selector).toContain(`html.dark[data-palette="${p}"]`)
    }
    expect(BLOCKS['graphite/light'].selector).toMatch(/^:root\b/)
    expect(BLOCKS['graphite/dark'].selector).toMatch(/^html\.dark,/)
  })

  it('defines every required token in every set', () => {
    const missing = []
    for (const [key, { tokens }] of Object.entries(BLOCKS)) {
      for (const t of REQUIRED) if (!(t in tokens) || !tokens[t]) missing.push(`${key}: --${t}`)
    }
    expect(missing).toEqual([])
  })

  it('defines the same tokens in every set, so none falls through to another palette', () => {
    const ref = Object.keys(BLOCKS['graphite/light'].tokens).sort()
    for (const [key, { tokens }] of Object.entries(BLOCKS)) {
      expect(Object.keys(tokens).sort(), key).toEqual(ref)
    }
  })

  it('declares palette tokens nowhere else in the stylesheets', () => {
    const paletteTokens = new Set(Object.keys(BLOCKS['graphite/light'].tokens))
    // Blank the palette sets out of index.css, then look for stray declarations.
    let rest = CSS
    for (const b of Object.values(BLOCKS).sort((a, z) => z.start - a.start)) {
      rest = rest.slice(0, b.start) + rest.slice(b.end)
    }
    const styles = join(SRC, 'styles')
    const others = readdirSync(styles).filter(n => n.endsWith('.css')).map(n => readFileSync(join(styles, n), 'utf8'))
    const stray = []
    for (const text of [rest, ...others]) {
      for (const m of text.matchAll(/(?:^|[\s{;])--([\w-]+)\s*:/g)) if (paletteTokens.has(m[1])) stray.push(m[1])
    }
    expect(stray).toEqual([])
  })

  it('leaves no var() without a definition somewhere (or a fallback)', () => {
    const files = walk(SRC).map(f => readFileSync(f, 'utf8'))
    const all = files.join('\n')
    const defined = new Set([
      ...[...all.matchAll(/(?:^|[^\w-])(--[\w-]+)\s*:/g)].map(m => m[1]),
      ...[...all.matchAll(/['"`](--[\w-]+)['"`]/g)].map(m => m[1]),
    ])
    const undefinedVars = new Set()
    for (const m of all.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
      if (m[2] === ')' && !defined.has(m[1])) undefinedVars.add(m[1])
    }
    expect([...undefinedVars]).toEqual([])
  })
})
