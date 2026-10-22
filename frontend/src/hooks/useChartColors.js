import { useEffect, useState } from 'react'

/**
 * The active palette's chart colours, as resolved strings.
 *
 * Recharts writes colours into SVG attributes, and a few call sites mix them
 * (hexToRgba, gradient stops), so a `var(--chart-1)` string is not enough.
 * This reads the tokens off <html> and re-reads whenever the palette or mode
 * attributes change, so charts recolour with the rest of the page.
 */
const TOKENS = {
  series: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'],
  grid: '--chart-grid',
  axis: '--chart-axis',
  accent: '--accent',
  positive: '--fin-positive',
  warning: '--fin-warning',
  negative: '--fin-negative',
  text: '--text-1',
  text2: '--text-2',
  muted: '--text-3',
  card: '--card-bg',
  border: '--card-border',
  tooltipBg: '--tooltip-bg',
  tooltipFg: '--tooltip-fg',
}

// Graphite light, for environments with no computed styles (tests, SSR).
const FALLBACK = {
  series: ['#007aff', '#30b0c7', '#5856d6', '#ff9500', '#ff2d55', '#34c759'],
  grid: 'rgba(29,29,31,0.08)', axis: '#6e6e73', accent: '#0071e3',
  positive: '#1e7a37', warning: '#a14d00', negative: '#c4001a',
  text: '#1d1d1f', text2: '#6e6e73', muted: '#6e6e73', card: '#ffffff', border: '#e3e3e8',
  tooltipBg: '#1d1d1f', tooltipFg: '#ffffff',
}

export function readChartColors() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK
  let cs
  try { cs = getComputedStyle(document.documentElement) } catch { return FALLBACK }
  const get = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb
  const out = {}
  for (const [key, token] of Object.entries(TOKENS)) {
    out[key] = Array.isArray(token)
      ? token.map((t, i) => get(t, FALLBACK.series[i]))
      : get(token, FALLBACK[key])
  }
  return out
}

function same(a, b) {
  return Object.keys(a).every(k => (Array.isArray(a[k]) ? a[k].join() === b[k].join() : a[k] === b[k]))
}

export default function useChartColors() {
  const [colors, setColors] = useState(readChartColors)
  useEffect(() => {
    const html = document.documentElement
    const update = () => setColors(prev => {
      const next = readChartColors()
      return same(prev, next) ? prev : next
    })
    update()
    if (typeof MutationObserver === 'undefined') return undefined
    const mo = new MutationObserver(update)
    mo.observe(html, { attributes: true, attributeFilter: ['class', 'data-palette'] })
    return () => mo.disconnect()
  }, [])
  return colors
}
