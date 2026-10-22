/**
 * Appearance: which palette, and light / dark / follow the system.
 *
 * Kept outside React so main.jsx can apply it before the first render: the
 * CSP forbids inline scripts, so the module entry is the earliest point we
 * control, and by doing it there the first frame React paints is already in
 * the right colours. ThemeContext reads and writes through the same helpers.
 *
 * Stored as JSON under `fintrack-appearance`. The previous build stored only
 * 'light' | 'dark' under `fintrack-theme`; that is still read once, as the
 * mode, so nobody's choice is lost on upgrade.
 */
export const PALETTES = ['graphite', 'indigo', 'emerald']
export const MODES = ['light', 'dark', 'system']
export const DEFAULT_PREFS = Object.freeze({ palette: 'graphite', mode: 'system' })

export const STORAGE_KEY = 'fintrack-appearance'
export const LEGACY_KEY = 'fintrack-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const SWITCH_MS = 200

function storage() {
  try { return window.localStorage } catch { return null }
}

export function normalizePrefs(raw) {
  const palette = PALETTES.includes(raw?.palette) ? raw.palette : DEFAULT_PREFS.palette
  const mode = MODES.includes(raw?.mode) ? raw.mode : DEFAULT_PREFS.mode
  return { palette, mode }
}

export function readPrefs() {
  const ls = storage()
  if (!ls) return { ...DEFAULT_PREFS }
  try {
    const saved = ls.getItem(STORAGE_KEY)
    if (saved) return normalizePrefs(JSON.parse(saved))
  } catch { /* unreadable: fall through to the legacy value */ }
  try {
    const legacy = ls.getItem(LEGACY_KEY)
    if (legacy === 'dark' || legacy === 'light') return { ...DEFAULT_PREFS, mode: legacy }
  } catch { /* storage blocked */ }
  return { ...DEFAULT_PREFS }
}

export function savePrefs(prefs) {
  const ls = storage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(normalizePrefs(prefs)))
    // The legacy key has been carried forward; leaving it would let it win
    // again if the new key were ever cleared on its own.
    ls.removeItem(LEGACY_KEY)
  } catch { /* quota or privacy mode: the choice lasts for this visit */ }
}

export function darkQuery() {
  try { return window.matchMedia?.(DARK_QUERY) ?? null } catch { return null }
}

export function systemPrefersDark() {
  return !!darkQuery()?.matches
}

export function resolveDark(mode) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemPrefersDark()
}

function prefersReducedMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

let switchTimer = null

/**
 * Put the palette and mode on <html>. With `animate`, colours cross-fade for
 * 200ms (index.css, `html.theme-switching`); reduced motion skips the fade.
 */
export function applyTheme(prefs, { animate = false } = {}) {
  if (typeof document === 'undefined') return
  const { palette, mode } = normalizePrefs(prefs)
  const html = document.documentElement
  const dark = resolveDark(mode)

  if (animate && !prefersReducedMotion()) {
    html.classList.add('theme-switching')
    clearTimeout(switchTimer)
    switchTimer = setTimeout(() => html.classList.remove('theme-switching'), SWITCH_MS + 60)
  }

  html.dataset.palette = palette
  html.dataset.mode = mode
  html.classList.remove('light')
  html.classList.toggle('dark', dark)

  // Browser chrome (mobile address bar, PWA title bar) follows the page.
  try {
    const bg = getComputedStyle(html).getPropertyValue('--bg-base').trim()
    if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg))
  } catch { /* not critical */ }
  return dark
}

/** Apply the saved choice. Called once from main.jsx before React renders. */
export function bootstrapTheme() {
  const prefs = readPrefs()
  applyTheme(prefs)
  return prefs
}
