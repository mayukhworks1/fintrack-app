import { useRef, useReducer, useCallback, useMemo } from 'react'

/**
 * Undo/redo for the sheet editor. Each entry is a snapshot of { grid, meta,
 * sel } taken before a change; grids are never mutated in place, so a
 * snapshot is just references and costs nothing to keep.
 */
export function useSheetHistory(limit = 200) {
  const past = useRef([])
  const future = useRef([])
  const [version, bump] = useReducer(x => x + 1, 0)

  const record = useCallback((snapshot) => {
    past.current.push(snapshot)
    if (past.current.length > limit) past.current.shift()
    future.current = []
    bump()
  }, [limit])

  const undo = useCallback((current) => {
    const prev = past.current.pop()
    if (!prev) return null
    future.current.push(current)
    bump()
    return prev
  }, [])

  const redo = useCallback((current) => {
    const next = future.current.pop()
    if (!next) return null
    past.current.push(current)
    bump()
    return next
  }, [])

  return useMemo(() => ({
    record,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    pristine: () => !past.current.length && !future.current.length,
  }), [record, undo, redo, version]) // eslint-disable-line react-hooks/exhaustive-deps
}
