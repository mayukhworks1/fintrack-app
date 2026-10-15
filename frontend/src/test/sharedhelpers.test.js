import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadBlob } from '../utils/download'
import { buildRetainerGroups } from '../pages/invoices/shared'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('downloadBlob', () => {
  it('clicks an attached link and revokes the URL only after a delay', () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked.push({ href: this.getAttribute('href'), download: this.download, attached: this.isConnected })
    })
    const blob = new Blob(['a,b'], { type: 'text/csv' })

    downloadBlob(blob, 'export.csv')

    expect(create).toHaveBeenCalledWith(blob)
    expect(clicked).toEqual([{ href: 'blob:file', download: 'export.csv', attached: true }])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith('blob:file')
  })
})

describe('buildRetainerGroups', () => {
  const rec = (id, fields) => ({ id, fields: { Category: 'Development- Retainer', ...fields } })

  it('groups retainer invoices by project and reads the chosen month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const records = [
      rec('a', { Project: 'Acme', 'Raised Date': '2026-10-03', 'Payment Status': 'Cancelled', 'Amount Raised': 1 }),
      rec('b', { Project: 'Acme', 'Raised Date': '2026-10-10', 'Payment Status': 'Paid', 'Amount Raised': 50000 }),
      rec('c', { Project: 'Acme', 'Raised Date': '2026-09-05', 'Payment Status': 'Pending' }),
      rec('d', { Project: 'Other', Category: 'Project', 'Raised Date': '2026-10-01' }),
      rec('e', { Project: '', 'Raised Date': '2026-08-12', 'Payment Status': 'Pending' }),
    ]

    const groups = buildRetainerGroups(records, '2026-10')

    expect(groups.map(g => g.project)).toEqual(['Acme', 'Unnamed Retainer'])
    const acme = groups[0]
    expect(acme.records.map(r => r.id)).toEqual(['b', 'a', 'c'])
    // The re-raised paid invoice wins over the cancelled one for the same month.
    expect(acme.monthRecord.id).toBe('b')
    expect(acme.monthStatus).toBe('Paid')
    expect(acme.amount).toBe(50000)
    expect(acme.currentMonthRaised).toBe(true)
    expect(acme.nextDueMonth).toBe('2026-11')
    expect(acme.timeline.map(t => t.key)).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02',
    ])
    expect(acme.timeline.find(t => t.active).status).toBe('Raised')
    expect(groups[1].monthStatus).toBe('Missing')
  })
})
