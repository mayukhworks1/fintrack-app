/**
 * WCAG AA in every palette and mode, computed from the token values in
 * index.css: body text on every surface it sits on, text on accent and
 * danger buttons, semantic tones on their tints, and the sidebar rail.
 */
import { describe, it, expect } from 'vitest'
import { PALETTES, MODES, paletteBlocks, parseColor, over, contrast } from './themeTokens'

const BLOCKS = paletteBlocks()
const AA = 4.5

function ratio(tokens, fg, bg, base = 'card-bg') {
  const resolve = v => parseColor(tokens[v] ?? v)
  const under = resolve(base)
  const b = over(resolve(bg), under)
  const f = over(resolve(fg), b)
  return contrast(f, b)
}

function gradientStops(value) {
  return [...String(value).matchAll(/#[0-9a-f]{6}\b/gi)].map(m => m[0])
}

for (const p of PALETTES) {
  for (const m of MODES) {
    const key = `${p}/${m}`
    const t = BLOCKS[key]?.tokens || {}

    describe(`${key}`, () => {
      const surfaces = ['bg-base', 'bg-layer', 'card-bg', 'bg-input', 'bg-2']

      for (const fg of ['text-1', 'text-2', 'text-3', 'accent-ink']) {
        it(`--${fg} reads at AA on every surface`, () => {
          for (const bg of surfaces) expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA)
        })
      }

      it('semantic tones read at AA on surfaces and on their own tints', () => {
        const pairs = [['fin-positive', 'fin-pos-bg'], ['fin-warning', 'fin-warn-bg'], ['fin-negative', 'fin-neg-bg']]
        for (const [fg, tint] of pairs) {
          for (const bg of [...surfaces, tint]) expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA)
        }
      })

      it('text on the accent button reads at AA, including every gradient stop', () => {
        expect(ratio(t, 'accent-fg', 'accent-btn')).toBeGreaterThanOrEqual(AA)
        expect(ratio(t, 'accent-fg', 'accent-btn-hover')).toBeGreaterThanOrEqual(AA)
        const stops = gradientStops(t['accent-gradient'])
        expect(stops.length).toBeGreaterThan(0)
        for (const s of stops) expect(ratio(t, 'accent-fg', s), `on ${s}`).toBeGreaterThanOrEqual(AA)
      })

      it('text on the danger button and on tooltips reads at AA', () => {
        expect(ratio(t, 'danger-fg', 'danger-btn')).toBeGreaterThanOrEqual(AA)
        expect(ratio(t, 'tooltip-fg', 'tooltip-bg')).toBeGreaterThanOrEqual(AA)
      })

      it('accent ink reads at AA on the accent tint used for selected rows', () => {
        expect(ratio(t, 'accent-ink', 'accent-dim')).toBeGreaterThanOrEqual(AA)
      })

      it('KPI tile icons read on their tiles', () => {
        for (let i = 1; i <= 5; i++) {
          expect(ratio(t, `kpi-${i}-fg`, `kpi-${i}-bg`), `kpi-${i}`).toBeGreaterThanOrEqual(AA)
        }
      })

      it('sidebar rail text reads at AA', () => {
        for (const fg of ['rail-fg', 'rail-fg-2', 'rail-fg-3']) {
          expect(ratio(t, fg, 'rail-bg', 'rail-bg'), fg).toBeGreaterThanOrEqual(AA)
          if (fg !== 'rail-fg-3') expect(ratio(t, fg, 'rail-active', 'rail-bg'), `${fg} on active`).toBeGreaterThanOrEqual(AA)
        }
      })
    })
  }
}

describe('contrast helpers', () => {
  it('match the WCAG reference values', () => {
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5)
    expect(contrast(parseColor('#777777'), parseColor('#ffffff'))).toBeCloseTo(4.48, 2)
  })
})
