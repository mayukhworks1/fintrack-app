/**
 * The tilt hook's guards.
 *
 * The effect itself is decorative, but the conditions under which it must NOT
 * run are not: a stated reduced-motion preference is an accessibility need, and
 * a touch device has no hover, so a tilt there either never fires or sticks on
 * tap. Both are re-checked live, because a user can plug in a mouse or change
 * the setting without reloading.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useTilt } from '../hooks/useTilt'

let queries = {}

function setMedia({ reduced = false, fine = true }) {
  queries = { reduced, fine }
  setMedia._mqls = []
  window.matchMedia = vi.fn((q) => {
    const listeners = new Set()
    const mql = {
      matches: q.includes('reduce') ? queries.reduced : queries.fine,
      media: q,
      addEventListener: (_e, fn) => listeners.add(fn),
      removeEventListener: (_e, fn) => listeners.delete(fn),
      _fire: () => listeners.forEach(fn => fn()),
    }
    setMedia._mqls.push(mql)
    return mql
  })
}

function Probe({ max = 7 }) {
  const ref = useTilt({ max })
  return <div ref={ref} data-testid="tile" />
}

function move(el, x, y) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 })
  const ev = new Event('pointermove', { bubbles: true })
  Object.assign(ev, { clientX: x, clientY: y })
  el.dispatchEvent(ev)
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('useTilt', () => {
  it('tilts under a fine pointer with motion allowed', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    expect(el.style.getPropertyValue('--tilt-x')).not.toBe('')
    expect(el.style.getPropertyValue('--tilt-y')).not.toBe('')
    expect(el.hasAttribute('data-tilting')).toBe(true)
  })

  it('writes nothing when reduced motion is requested', () => {
    setMedia({ reduced: true, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    expect(el.style.getPropertyValue('--tilt-x')).toBe('')
    expect(el.hasAttribute('data-tilting')).toBe(false)
  })

  it('writes nothing on a coarse pointer', () => {
    setMedia({ reduced: false, fine: false })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    expect(el.style.getPropertyValue('--tilt-x')).toBe('')
  })

  it('stays within the configured maximum', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe max={7} />)
    const el = getByTestId('tile')
    move(el, 0, 0)
    expect(Math.abs(parseFloat(el.style.getPropertyValue('--tilt-x')))).toBeLessThanOrEqual(7.001)
    expect(Math.abs(parseFloat(el.style.getPropertyValue('--tilt-y')))).toBeLessThanOrEqual(7.001)
  })

  it('centres to no rotation', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 100, 50)
    expect(parseFloat(el.style.getPropertyValue('--tilt-x'))).toBeCloseTo(0, 5)
    expect(parseFloat(el.style.getPropertyValue('--tilt-y'))).toBeCloseTo(0, 5)
  })

  it('resets when the pointer leaves', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    el.dispatchEvent(new Event('pointerleave', { bubbles: true }))
    expect(el.style.getPropertyValue('--tilt-x')).toBe('')
    expect(el.hasAttribute('data-tilting')).toBe(false)
  })

  // A tile can scroll out from under a stationary pointer, which fires no
  // leave event — without this the tilt stays stuck mid-rotation.
  it('resets on pointercancel', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    el.dispatchEvent(new Event('pointercancel', { bubbles: true }))
    expect(el.style.getPropertyValue('--tilt-x')).toBe('')
  })

  it('drops an applied tilt when reduced motion is switched on mid-session', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId } = render(<Probe />)
    const el = getByTestId('tile')
    move(el, 200, 0)
    expect(el.style.getPropertyValue('--tilt-x')).not.toBe('')

    queries.reduced = true
    setMedia._mqls.forEach(m => {
      if (m.media.includes('reduce')) m.matches = true
      m._fire()
    })
    expect(el.style.getPropertyValue('--tilt-x')).toBe('')
  })

  it('cleans up its listeners on unmount', () => {
    setMedia({ reduced: false, fine: true })
    const { getByTestId, unmount } = render(<Probe />)
    const el = getByTestId('tile')
    const spy = vi.spyOn(el, 'removeEventListener')
    unmount()
    expect(spy.mock.calls.map(c => c[0])).toEqual(
      expect.arrayContaining(['pointermove', 'pointerleave', 'pointercancel'])
    )
  })
})
