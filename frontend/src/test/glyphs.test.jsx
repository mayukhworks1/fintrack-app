/**
 * Every subject has its own drawing, and every drawing resolves.
 *
 * The bug this guards: illustrations were chosen by list position
 * (`CHIP_PEEK[i % 4]`), so eleven modules shared four pictures and a module's
 * mark depended on where it sat in an array. Now they are keyed by subject —
 * which introduces the opposite failure, a key with no entry in the map.
 * `{MAP[key]}` for a missing key renders nothing at all: no error, no warning,
 * a silently empty box. Tests pass, the build passes, and the page ships with
 * a hole in it.
 *
 * So these assert the mapping is total, and that it is injective where the
 * subjects genuinely differ.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MODULES } from '../content/publicContent'
import { NAV } from '../components/MegaNav'
import { FEATURES } from '../pages/Features'
import * as Glyphs from '../components/Glyphs'

const wrap = ui => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('module and page illustrations', () => {
  it('gives all eleven modules a visual, and no two the same', () => {
    const vis = MODULES.map(m => m.visual)
    expect(vis).toHaveLength(11)
    expect(vis.every(Boolean)).toBe(true)
    // The old code dealt four pictures to eleven modules. If that ever comes
    // back, this is what catches it.
    expect(new Set(vis).size).toBe(11)
  })

  it('gives every nav destination its own visual', () => {
    const items = NAV.flatMap(g => g.items)
    const vis = items.map(i => i.visual)
    expect(vis.every(Boolean)).toBe(true)
    expect(new Set(vis).size).toBe(items.length)
  })

  it('gives every feature module its own demo', () => {
    const demos = FEATURES.map(f => f.demo)
    expect(demos).toHaveLength(11)
    expect(new Set(demos).size).toBe(11)
  })

  it('renders every exported glyph without throwing, and draws something', () => {
    for (const [name, Glyph] of Object.entries(Glyphs)) {
      const { container, unmount } = wrap(<Glyph />)
      const svg = container.querySelector('svg')
      expect(svg, `${name} rendered no svg`).toBeTruthy()
      // A frame with nothing in it is the silent-hole failure.
      expect(svg.children.length, `${name} drew nothing`).toBeGreaterThan(0)
      // An illustration must never be announced as data.
      expect(svg.getAttribute('aria-hidden'), `${name} is not aria-hidden`).toBe('true')
      unmount()
    }
  })

  it('prints no invented statistic', () => {
    // The donut said "68%" — 68% of nothing — beside whichever module the
    // modulo landed on. Nothing in this set may assert a figure it cannot
    // stand behind.
    for (const [name, Glyph] of Object.entries(Glyphs)) {
      const { container, unmount } = wrap(<Glyph />)
      const text = container.textContent.trim()
      expect(text, `${name} prints "${text}"`).toBe('')
      unmount()
    }
  })
})
