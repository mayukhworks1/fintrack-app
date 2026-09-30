import { useEffect, useMemo, useRef, useState } from 'react'

const NONE = new Map()

/**
 * Marks the rows a poll actually brought in or altered.
 *
 * Lists in this app are keyed by record id, so React keeps a surviving row's
 * DOM node across a poll. That is what makes targeted motion possible: the
 * rows that did not move can stay perfectly still while the one that did
 * announces itself. A list where everything animates says nothing, because
 * the reader cannot tell the new row from the twenty that were already there.
 *
 * @param records  the rows as rendered, in any order
 * @param id       how to identify a row across polls
 * @param watch    the fields worth noticing a change in — a status, an amount
 * @param hold     how long a mark survives before the row goes quiet again
 * @returns        (record) => 'new' | 'changed' | ''
 */
export function useRecordMotion(records, { id = r => r.id, watch, hold = 1500 } = {}) {
  const previous = useRef(null)
  const [marks, setMarks] = useState(NONE)

  // Recomputed only when the rows themselves change, not on every render.
  const snapshot = useMemo(() => {
    const m = new Map()
    for (const r of records || []) m.set(id(r), watch ? String(watch(r)) : '')
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records])

  useEffect(() => {
    const before = previous.current
    previous.current = snapshot
    // The first load is a baseline. Everything is new when a page opens, and
    // saying so about every row is noise, not news.
    if (!before) return

    const added = []
    const changed = []
    for (const [key, signature] of snapshot) {
      if (!before.has(key)) added.push(key)
      else if (before.get(key) !== signature) changed.push(key)
    }
    if (!added.length && !changed.length) return

    // A wholesale swap is a re-scope — a filter, a sort, a different page —
    // not news about individual rows. Marking two hundred rows "new" because
    // the reader changed a dropdown tells them nothing they did not just do.
    if (added.length > Math.max(6, snapshot.size * 0.4)) return

    const next = new Map()
    for (const key of added)   next.set(key, 'new')
    for (const key of changed) next.set(key, 'changed')
    setMarks(next)
    const timer = setTimeout(() => setMarks(NONE), hold)
    return () => clearTimeout(timer)
  }, [snapshot, hold])

  return useMemo(() => (record) => marks.get(id(record)) || '', [marks, id])
}
