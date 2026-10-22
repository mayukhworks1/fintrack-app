/**
 * Reads the palette token sets out of index.css for the theme tests.
 *
 * Each set is introduced by a comment of the form `/* Graphite — light *\/`
 * directly above its rule, which is how index.css lays them out.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

export const PALETTES = ['graphite', 'indigo', 'emerald']
export const MODES = ['light', 'dark']

export function paletteBlocks(css = CSS) {
  const out = {}
  const re = /\/\*\s*(Graphite|Indigo|Emerald)\s+—\s+(light|dark)\s*\*\/\s*([^{]+)\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    const key = `${m[1].toLowerCase()}/${m[2]}`
    const tokens = {}
    for (const d of m[4].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[d[1]] = d[2].trim()
    out[key] = { selector: m[3].trim(), tokens, start: m.index, end: m.index + m[0].length }
  }
  return out
}

// ── Colour maths (WCAG 2.x) ─────────────────────────────────────────────
export function parseColor(value) {
  const s = String(value).trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3) h = [...h].map(c => c + c).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map(Number)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  return null
}

/** Composite a (possibly translucent) colour over an opaque one. */
export function over(fg, bg) {
  const a = fg[3]
  return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1)
}

export function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(a, b) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
