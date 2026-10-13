import { describe, it, expect } from 'vitest'
import { toIstInput, fromIstInput, formatIst, countdown, expiryPreset } from '../utils/ist'

describe('IST expiry helpers', () => {
  it('shows a UTC instant as IST wall-clock time', () => {
    expect(toIstInput('2026-10-20T12:30:00Z')).toBe('2026-10-20T18:00')
  })

  it('reads typed time as IST, whatever the browser timezone', () => {
    const iso = fromIstInput('2026-10-20T18:00')
    expect(iso).toBe('2026-10-20T18:00:00+05:30')
    expect(new Date(iso).toISOString()).toBe('2026-10-20T12:30:00.000Z')
    expect(toIstInput(iso)).toBe('2026-10-20T18:00')
  })

  it('crosses midnight correctly', () => {
    expect(toIstInput('2026-10-20T20:00:00Z')).toBe('2026-10-21T01:30')
  })

  it('clears to an empty value', () => {
    expect(fromIstInput('')).toBe('')
    expect(toIstInput('')).toBe('')
  })

  it('labels the time in IST', () => {
    expect(formatIst('2026-10-20T12:30:00Z')).toMatch(/20 Oct 2026.*6:00\s?pm IST/i)
  })

  it('counts down and then says expired', () => {
    const now = Date.parse('2026-10-20T00:00:00Z')
    expect(countdown('2026-10-22T04:00:00Z', now)).toBe('2d 4h left')
    expect(countdown('2026-10-20T03:12:00Z', now)).toBe('3h 12m left')
    expect(countdown('2026-10-20T00:45:00Z', now)).toBe('45m left')
    expect(countdown('2026-10-19T23:00:00Z', now)).toBe('Expired')
  })

  it('"tonight" means 11:59 pm IST on the IST date, even late in the UTC day', () => {
    // 20:00 UTC on the 20th is already 01:30 on the 21st in India.
    expect(expiryPreset('eod', Date.parse('2026-10-20T20:00:00Z'))).toBe('2026-10-21T23:59:00+05:30')
    expect(expiryPreset('7d', Date.parse('2026-10-20T00:00:00Z'))).toBe('2026-10-27T00:00:00.000Z')
  })
})
