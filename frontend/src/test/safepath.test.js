import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../utils/sanitize'

describe('safeInternalPath', () => {
  it('keeps ordinary app paths', () => {
    expect(safeInternalPath('/invoices?status=Paid')).toBe('/invoices?status=Paid')
    expect(safeInternalPath('/pages/abc#x')).toBe('/pages/abc#x')
  })
  it.each([
    '//evil.com', '/\\evil.com', '/%5Cevil.com', '/%2F%2Fevil.com', '\\\\evil.com',
    'https://evil.com', 'javascript:alert(1)', '/javascript:alert(1)', '/\tevil', '', null, 'invoices',
  ])('rejects %s', (v) => {
    expect(safeInternalPath(v)).toBe('/')
  })
})
