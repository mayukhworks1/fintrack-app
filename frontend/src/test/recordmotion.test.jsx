/**
 * Which rows a poll marks.
 *
 * The value of this hook is entirely in what it refuses to mark. A table
 * where every row animates on every poll reports nothing, because the reader
 * cannot pick the row that is news out of the twenty that are not. So these
 * tests are mostly about silence: the first load, an unchanged poll, and a
 * wholesale re-scope must all leave the table still.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRecordMotion } from '../hooks/useRecordMotion'

const watch = r => String(r.status)
const rowsOf = (...pairs) => pairs.map(([id, status]) => ({ id, status }))

afterEach(() => vi.useRealTimers())

function mount(initial) {
  return renderHook(({ rs }) => useRecordMotion(rs, { watch }), { initialProps: { rs: initial } })
}

describe('useRecordMotion', () => {
  it('marks nothing on first load — everything is new when a page opens', () => {
    const { result } = mount(rowsOf(['a', 'Pending'], ['b', 'Paid']))
    expect(result.current({ id: 'a' })).toBe('')
    expect(result.current({ id: 'b' })).toBe('')
  })

  it('marks a row that arrived', async () => {
    const { result, rerender } = mount(rowsOf(['a', 'Pending']))
    rerender({ rs: rowsOf(['a', 'Pending'], ['b', 'Pending']) })
    await waitFor(() => expect(result.current({ id: 'b' })).toBe('new'))
    // The row that was already there does not move.
    expect(result.current({ id: 'a' })).toBe('')
  })

  it('marks a row whose watched field moved, and only that row', async () => {
    const { result, rerender } = mount(rowsOf(['a', 'Pending'], ['b', 'Pending']))
    rerender({ rs: rowsOf(['a', 'Paid'], ['b', 'Pending']) })
    await waitFor(() => expect(result.current({ id: 'a' })).toBe('changed'))
    expect(result.current({ id: 'b' })).toBe('')
  })

  it('stays silent when a poll brings back identical data', async () => {
    const { result, rerender } = mount(rowsOf(['a', 'Pending']))
    // A new array each time, as a poll produces — identity changes, data does not.
    rerender({ rs: rowsOf(['a', 'Pending']) })
    rerender({ rs: rowsOf(['a', 'Pending']) })
    await Promise.resolve()
    expect(result.current({ id: 'a' })).toBe('')
  })

  it('ignores a wholesale re-scope rather than calling thirty rows news', async () => {
    const { result, rerender } = mount(rowsOf(['a', 'Pending'], ['b', 'Pending']))
    const replaced = Array.from({ length: 30 }, (_, i) => ({ id: `z${i}`, status: 'Pending' }))
    rerender({ rs: replaced })
    await Promise.resolve()
    expect(replaced.filter(r => result.current(r) !== '').length).toBe(0)
  })

  it('still marks a small batch arriving at once', async () => {
    const { result, rerender } = mount(Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, status: 'Pending' })))
    const grown = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, status: 'Pending' })),
      { id: 'new1', status: 'Pending' },
      { id: 'new2', status: 'Pending' },
    ]
    rerender({ rs: grown })
    await waitFor(() => expect(result.current({ id: 'new1' })).toBe('new'))
    expect(result.current({ id: 'new2' })).toBe('new')
  })

  it('lets a marked row go quiet again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, rerender } = renderHook(
      ({ rs }) => useRecordMotion(rs, { watch, hold: 400 }),
      { initialProps: { rs: rowsOf(['a', 'Pending']) } },
    )
    rerender({ rs: rowsOf(['a', 'Paid']) })
    await waitFor(() => expect(result.current({ id: 'a' })).toBe('changed'))
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(result.current({ id: 'a' })).toBe('')
  })
})
