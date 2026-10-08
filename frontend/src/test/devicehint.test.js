/**
 * The device hint must never hold a request behind geolocation.
 *
 * It used to await navigator.geolocation.getCurrentPosition (high accuracy,
 * 3.5 s timeout) inside the collector the API client awaited before its first
 * request — so every page load held /verify and the page's own data behind a
 * GPS fix or the permission prompt. Geo now arrives in the background and is
 * folded into the hint for the requests that follow.
 */
import { describe, it, expect, vi } from 'vitest'

function decode(b64) { return JSON.parse(decodeURIComponent(escape(atob(b64)))) }

describe('device hint', () => {
  it('resolves without waiting for geolocation, then picks the fix up later', async () => {
    vi.resetModules()
    let deliver = null
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (ok) => { deliver = ok } },   // never answers on its own
      configurable: true,
    })
    const mod = await import('../utils/deviceInfo')

    const t0 = performance.now()
    const hint = await mod.getDeviceHintHeader()
    expect(performance.now() - t0).toBeLessThan(500)
    expect(typeof hint).toBe('string')
    expect(decode(hint).browserGeo).toBeNull()
    expect(typeof deliver).toBe('function')                 // asked, in the background

    deliver({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 20 } })
    expect(decode(mod.currentDeviceHint()).browserGeo).toEqual({ lat: 12.9716, lon: 77.5946, accuracyM: 20 })
    expect(decode(await mod.getDeviceHintHeader()).browserGeo).not.toBeNull()
  })

  it('is empty, not a wait, before the first collection completes', async () => {
    vi.resetModules()
    const mod = await import('../utils/deviceInfo')
    expect(mod.currentDeviceHint()).toBe('')
  })
})
