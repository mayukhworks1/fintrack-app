// Saving a database without losing anyone's work: schema writes carry the
// revision they were made against (a 409 means someone else saved first),
// cell edits go out one at a time per cell, and a CSV import keeps one id
// across retries so the server can tell a retry from a second import.
import { cleanFilter } from './dbModel'

export const CONFLICT_MESSAGE = 'Someone else changed this database at the same moment. The latest version is loaded: please make your change again.'

/** The schema as the server takes it: filters without half-typed rules. */
export function forServer(schema) {
  return {
    properties: schema.properties,
    views: schema.views.map(v => ({ ...v, filter: cleanFilter(v.filter, schema) })),
    default_view: schema.default_view,
    row_type: schema.row_type,
  }
}

/**
 * Apply `change(schema) -> schema` and save it against the schema's revision.
 * On 409 the database is fetched again, the change re-applied to the fresh
 * copy and saved once more; a second conflict gives up with CONFLICT_MESSAGE.
 *
 *   databases    api.databases (saveSchema, get)
 *   getBase()    the schema the change starts from (with .revision)
 *   deleted(s)   property ids the change removes, worked out per attempt
 *   onFresh(s)   told about a newer schema fetched after a conflict
 *
 * Resolves to { saved, sent } — the server's schema and what was sent.
 */
export async function saveSchemaChange({ databases, dbId, getBase, change, deleted = () => [], onFresh }) {
  let base = getBase()
  for (let attempt = 0; ; attempt++) {
    const next = change(base)
    try {
      const res = await databases.saveSchema(dbId, {
        ...forServer(next),
        ...(base.revision != null ? { revision: base.revision } : {}),
        deleted: deleted(base, next),
      })
      return { saved: res?.database || null, sent: next }
    } catch (e) {
      if (e?.status !== 409) throw e
      let fresh = null
      try { fresh = (await databases.get(dbId))?.database || null } catch { /* reported below */ }
      if (fresh) onFresh?.(fresh)
      if (attempt >= 1 || !fresh) {
        const err = new Error(CONFLICT_MESSAGE)
        err.status = 409
        err.conflict = true
        throw err
      }
      base = fresh
    }
  }
}

/** Property ids present in `before` and gone from `after`. */
export function removedProps(before, after) {
  const kept = new Set((after?.properties || []).map(p => p.id))
  return (before?.properties || []).map(p => p.id).filter(id => !kept.has(id))
}

/**
 * Per-cell save queue. An edit shows at once (optimistic); the save goes out
 * after `delay` ms of quiet on that cell, one request at a time per cell, and
 * only the latest value is sent. A failed save rolls the cell back to the
 * last value the server accepted and calls onError.
 *
 *   save(rowId, propId, value) -> Promise<row>
 *   apply(rowId, propId, value)       show a value
 *   onSaved(row, pendingForRow)       the server's row; other cells of the
 *                                     same row still waiting are listed
 *   onError(error, rowId, propId)
 */
export function createCellQueue({ save, apply, onSaved, onError, delay = 300 }) {
  const cells = new Map()   // key -> { rowId, propId, confirmed, value, timer, inflight }
  const keyOf = (rowId, propId) => `${rowId}\u0000${propId}`

  const pendingFor = (rowId) => {
    const out = {}
    for (const c of cells.values()) if (c.rowId === rowId && (c.timer || c.inflight)) out[c.propId] = c.value
    return out
  }

  const flush = (c) => {
    clearTimeout(c.timer)
    c.timer = null
    if (c.inflight) return c.inflight   // its completion sends the newer value
    const value = c.value
    c.inflight = Promise.resolve()
      .then(() => save(c.rowId, c.propId, value))
      .then(row => {
        c.confirmed = value
        c.inflight = null
        if (c.value !== value) { flush(c); return }
        const rest = pendingFor(c.rowId)
        delete rest[c.propId]
        cells.delete(keyOf(c.rowId, c.propId))
        onSaved?.(row, rest)
      }, err => {
        c.inflight = null
        if (c.value !== value) { flush(c); return }   // a newer value may still save
        cells.delete(keyOf(c.rowId, c.propId))
        apply(c.rowId, c.propId, c.confirmed)
        onError?.(err, c.rowId, c.propId)
      })
    return c.inflight
  }

  return {
    /** A new value for a cell; `current` is what the cell showed before. */
    change(rowId, propId, value, current) {
      const key = keyOf(rowId, propId)
      let c = cells.get(key)
      if (!c) { c = { rowId, propId, confirmed: current, value, timer: null, inflight: null }; cells.set(key, c) }
      c.value = value
      apply(rowId, propId, value)
      clearTimeout(c.timer)
      c.timer = setTimeout(() => flush(c), delay)
    },
    /** Send everything waiting now (closing the view). */
    flushAll() { return Promise.all([...cells.values()].filter(c => c.timer).map(flush)) },
    pendingFor,
    get size() { return cells.size },
  }
}

/** A fresh id for one CSV import, kept across that import's retries. */
export function newImportId() {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `imp-${rnd}`
}

/** Worth retrying with the same import id: no answer, a timeout or a 5xx. */
export function retryableImportError(e) {
  const s = e?.status
  return s == null || s === 429 || s >= 500
}
