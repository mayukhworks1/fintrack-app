import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { readPrefs, savePrefs, applyTheme, STORAGE_KEY, LEGACY_KEY } from '../theme/themeStore'
import { ThemeProvider, useTheme } from '../context/ThemeContext'
import AppearancePicker from '../components/AppearancePicker'

function mockSystemDark(initial) {
  const listeners = new Set()
  const mq = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  window.matchMedia = vi.fn((q) => (q.includes('prefers-color-scheme') ? mq : { matches: false, addEventListener() {}, removeEventListener() {} }))
  return (dark) => { mq.matches = dark; listeners.forEach(fn => fn({ matches: dark })) }
}

beforeEach(() => {
  localStorage.clear()
  const html = document.documentElement
  html.className = ''
  delete html.dataset.palette
  delete html.dataset.mode
  mockSystemDark(false)
})

describe('themeStore', () => {
  it('defaults to Graphite following the system', () => {
    expect(readPrefs()).toEqual({ palette: 'graphite', mode: 'system' })
  })

  it('carries the old light/dark value forward as the mode', () => {
    localStorage.setItem(LEGACY_KEY, 'dark')
    expect(readPrefs()).toEqual({ palette: 'graphite', mode: 'dark' })
  })

  it('prefers the new key and drops the legacy one once saved', () => {
    localStorage.setItem(LEGACY_KEY, 'dark')
    savePrefs({ palette: 'emerald', mode: 'light' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ palette: 'emerald', mode: 'light' })
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(readPrefs()).toEqual({ palette: 'emerald', mode: 'light' })
  })

  it('ignores unknown values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette: 'neon', mode: 'sepia' }))
    expect(readPrefs()).toEqual({ palette: 'graphite', mode: 'system' })
  })

  it('puts the palette and the resolved mode on <html>', () => {
    applyTheme({ palette: 'indigo', mode: 'dark' })
    const html = document.documentElement
    expect(html.dataset.palette).toBe('indigo')
    expect(html.dataset.mode).toBe('dark')
    expect(html.classList.contains('dark')).toBe(true)
    applyTheme({ palette: 'indigo', mode: 'light' })
    expect(html.classList.contains('dark')).toBe(false)
  })

  it('cross-fades only during a switch, and not at all with reduced motion', () => {
    vi.useFakeTimers()
    const html = document.documentElement
    applyTheme({ palette: 'graphite', mode: 'light' }, { animate: true })
    expect(html.classList.contains('theme-switching')).toBe(true)
    vi.advanceTimersByTime(400)
    expect(html.classList.contains('theme-switching')).toBe(false)

    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    applyTheme({ palette: 'graphite', mode: 'light' }, { animate: true })
    expect(html.classList.contains('theme-switching')).toBe(false)
    vi.useRealTimers()
  })
})

function Probe() {
  const t = useTheme()
  return (
    <div>
      <span data-testid="state">{`${t.palette}/${t.mode}/${t.dark ? 'dark' : 'light'}`}</span>
      <button onClick={t.toggle}>toggle</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  it('follows the system live while in system mode', () => {
    const setSystem = mockSystemDark(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('state').textContent).toBe('graphite/system/light')
    act(() => setSystem(true))
    expect(screen.getByTestId('state').textContent).toBe('graphite/system/dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('keeps the sun/moon toggle working: it flips light and dark', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state').textContent).toBe('graphite/dark/dark')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).mode).toBe('dark')
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state').textContent).toBe('graphite/light/light')
  })
})

describe('AppearancePicker', () => {
  it('is two radio groups, and picking a palette or mode applies it', () => {
    render(<ThemeProvider><AppearancePicker /><Probe /></ThemeProvider>)
    const groups = screen.getAllByRole('radiogroup')
    expect(groups).toHaveLength(2)
    const indigo = screen.getByRole('radio', { name: /Indigo/ })
    expect(indigo).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(indigo)
    expect(indigo).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.dataset.palette).toBe('indigo')
    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }))
    expect(screen.getByTestId('state').textContent).toBe('indigo/dark/dark')
  })

  it('moves the selection with the arrow keys and keeps one tab stop per group', () => {
    render(<ThemeProvider><AppearancePicker /><Probe /></ThemeProvider>)
    const graphite = screen.getByRole('radio', { name: /Graphite/ })
    expect(graphite).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: /Emerald/ })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(graphite, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: /Indigo/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('radio', { name: /Indigo/ }), { key: 'ArrowLeft' })
    expect(graphite).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(graphite, { key: 'End' })
    expect(screen.getByRole('radio', { name: /Emerald/ })).toHaveAttribute('aria-checked', 'true')
  })
})
