import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Guards the first-paint budget.
 *
 * Naming recharts / d3 in manualChunks put ~115 KB (gz) of charting on every
 * cold load: a manual chunk that shares a dependency with the entry (recharts
 * needs react, which lives in react-vendor) becomes a *static* import of the
 * entry so Rollup can guarantee load order, and Vite then modulepreloads it —
 * even though every importer is behind a lazy route. No source grep can see
 * that edge; only the build output can. These assertions read the config and,
 * when a build is present, the manifest Rollup wrote.
 */
const root = resolve(__dirname, '../..')

/** Manifest keys the chunk loads statically, transitively. */
function staticClosure(m, chunk, seen = new Set()) {
  for (const k of chunk.imports || []) {
    if (seen.has(k) || !m[k]) continue
    seen.add(k)
    staticClosure(m, m[k], seen)
  }
  return seen
}

/** Manifest keys reachable from the chunk through at least one dynamic import. */
function dynamicReach(m, entry) {
  const reached = new Set()
  const queue = [entry]
  const visited = new Set()
  while (queue.length) {
    const c = queue.shift()
    if (visited.has(c)) continue
    visited.add(c)
    for (const k of c.dynamicImports || []) {
      if (!m[k]) continue
      reached.add(k)
      for (const s of staticClosure(m, m[k])) reached.add(s)
      queue.push(m[k])
    }
    for (const k of c.imports || []) if (m[k]) queue.push(m[k])
  }
  return reached
}

describe('first-paint budget', () => {
  it('manualChunks never names a chart library', () => {
    const cfg = readFileSync(resolve(root, 'vite.config.js'), 'utf8')
    // Match only the *return* statements that assign a chunk name; the
    // explanatory comment above them legitimately mentions both libraries.
    const returns = [...cfg.matchAll(/return\s+'([^']+)'/g)].map(m => m[1])
    expect(returns.some(n => /chart|recharts|d3/i.test(n))).toBe(false)
  })

  it('the built entry statically imports no chart chunk', () => {
    const manifestPath = resolve(root, 'dist/.vite/manifest.json')
    if (!existsSync(manifestPath)) return   // no build in this environment — config test above still applies
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const entry = Object.values(m).find(v => v.isEntry)
    expect(entry).toBeTruthy()
    // Everything first paint downloads: the entry's static imports, followed
    // all the way down, since a chunk the entry imports pulls its own in too.
    const offenders = [...staticClosure(m, entry)].map(k => m[k].file).filter(f => /chart|recharts/i.test(f))
    expect(offenders).toEqual([])
  })

  // The dashboard is lazy now, so its insight blocks sit one dynamic import
  // further from the entry. What matters is unchanged: they are never in what
  // first paint downloads, and they are still reachable by dynamic import.
  it('CustomInsightBlocks is reached only by dynamic import', () => {
    const manifestPath = resolve(root, 'dist/.vite/manifest.json')
    if (!existsSync(manifestPath)) return
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const entry = Object.values(m).find(v => v.isEntry)
    const isStatic = [...staticClosure(m, entry)].some(k => /CustomInsightBlocks/.test(m[k].file))
    const isDynamic = [...dynamicReach(m, entry)].some(k => /CustomInsightBlocks/.test(m[k].file))
    expect(isStatic).toBe(false)
    expect(isDynamic).toBe(true)
  })
})
