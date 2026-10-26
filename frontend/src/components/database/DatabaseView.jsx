import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../services/api'
import { downloadBlob } from '../../utils/download'
import { useConfirm } from '../../context/ConfirmContext'
import { useToast } from '../../context/ToastContext'
import { DB_CSS } from './dbStyles'
import { Popover } from './ui'
import TableView from './TableView'
import BoardView from './BoardView'
import GalleryView from './GalleryView'
import CalendarView from './CalendarView'
import CsvImportDialog from './CsvImportDialog'
import RowPeek, { rowIsBlank } from './RowPeek'
import { FilterMenu, PropertiesMenu, SortMenu, newRule } from './ViewMenus'
import {
  COLORS, VIEW_TYPES, applyUpdates, cleanFilter, groupRows, makeView, moveCard, newId,
  presetFromFilter, propsById, rescheduled, rawValue, sortRows, uniqueName,
} from './dbModel'
import { createCellQueue, removedProps, saveSchemaChange } from './dbSync'

const PAGE = { table: 100, board: 500, gallery: 200, calendar: 500 }
const VIEW_SAVE_MS = 600

const viewKey = (id) => `fdb_view_${id}`
const remembered = (id) => { try { return localStorage.getItem(viewKey(id)) } catch { return null } }
const remember = (id, v) => { try { localStorage.setItem(viewKey(id), v) } catch {} }

// Toasts when the app provides them (tests and embeds may not).
function useSafeToast() {
  try { return useToast() } catch { return null }
}

/** A view as the server takes it: without half-typed filter rules. */
function viewForServer(view, schema) {
  return { ...view, filter: cleanFilter(view.filter, schema) }
}

/** The server's schema, keeping local views that have edits not yet saved
 *  and half-typed filter rules the server never saw. */
function mergeServer(server, local, pendingViews) {
  if (!local) return server
  const localById = new Map((local.views || []).map(v => [v.id, v]))
  const views = server.views.map(v => {
    const mine = localById.get(v.id)
    if (!mine) return v
    if (pendingViews.has(v.id)) return mine
    const same = JSON.stringify(cleanFilter(mine.filter, server) ?? null) === JSON.stringify(v.filter ?? null)
    return same ? { ...v, filter: mine.filter } : v
  })
  // A view added here whose save is still on its way.
  for (const v of local.views || []) if (pendingViews.has(v.id) && !views.some(x => x.id === v.id)) views.push(v)
  return { ...server, views }
}

const queryKeyOf = (view, schema, search) => (view && schema
  ? JSON.stringify({ id: view.id, t: view.type, f: cleanFilter(view.filter, schema), s: view.sort || [], q: search.trim() })
  : null)

function ViewTab({ view, active, isDefault, onSelect, onRename, onDuplicate, onDelete, onDefault, canDelete, readOnly }) {
  const [menu, setMenu] = useState(false)
  const [name, setName] = useState(view.name)
  useEffect(() => setName(view.name), [view.name])
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" role="tab" className="fdb-tab" aria-selected={active}
        onClick={() => (active && !readOnly ? setMenu(m => !m) : onSelect())}
        aria-haspopup={active && !readOnly ? 'dialog' : undefined}>
        <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--db-mute)' }}>{{ table: '▦', board: '▥', gallery: '▤', calendar: '▧' }[view.type]}</span>
        {view.name}
      </button>
      {menu && (
        <Popover onClose={() => setMenu(false)} label={`View ${view.name}`}>
          <input className="fdb-input" value={name} aria-label="View name" onChange={e => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name.trim() !== view.name) onRename(name.trim()) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) onRename(name.trim()); setMenu(false) } }} />
          <div className="fdb-sep" />
          {!isDefault && <button type="button" className="fdb-item" onClick={() => { onDefault(); setMenu(false) }}><span className="g">★</span>Make default view</button>}
          <button type="button" className="fdb-item" onClick={() => { onDuplicate(); setMenu(false) }}><span className="g">⧉</span>Duplicate view</button>
          {canDelete && <button type="button" className="fdb-item" style={{ color: 'var(--db-danger)' }} onClick={() => { onDelete(); setMenu(false) }}><span className="g">🗑</span>Delete view</button>}
        </Popover>
      )}
    </span>
  )
}

/**
 * The database editor: view tabs, toolbar and the active view. Opening a row
 * shows it in a side panel over the database; "Open as page" there hands it
 * to onOpenRow for the full page editor.
 *
 * Saving: property changes go through PUT /schema with the revision they were
 * made against (a conflict re-applies the change to the fresh schema once);
 * view tweaks go through PUT /views/{id}, so they never rewrite properties;
 * cell edits are optimistic, debounced and sent one at a time per cell.
 */
export default function DatabaseView({ pageId, onOpenRow, isMobile }) {
  const confirm = useConfirm()
  const toast = useSafeToast()
  const [schema, setSchema] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [viewId, setViewId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [people, setPeople] = useState([])
  const [menu, setMenu] = useState(null) // 'filter' | 'sort' | 'props' | 'add-view' | 'more'
  const [importOpen, setImportOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [peek, setPeek] = useState(null) // { id, created }
  const schemaRef = useRef(null)
  const rowsRef = useRef([])
  rowsRef.current = rows
  const chain = useRef(Promise.resolve())
  const viewTimers = useRef(new Map())     // viewId -> timer of a view save waiting
  const pendingViews = useRef(new Set())   // views with local edits not yet saved
  const queryId = useRef(0)
  const loadedKey = useRef(null)

  const say = useCallback((msg) => { setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? '' : n)), 3500) }, [])
  const fail = useCallback((msg) => {
    if (toast) toast(msg, 'error')
    else say(msg)
  }, [toast, say])

  const adopt = useCallback((server) => {
    if (!server) return
    const next = mergeServer(server, schemaRef.current, pendingViews.current)
    schemaRef.current = next
    setSchema(next)
  }, [])

  /** Every schema or view write, one after another, so each carries the
   *  revision the previous one produced. */
  const enqueue = useCallback((task) => {
    const p = chain.current.then(task)
    chain.current = p.catch(() => {})
    return p
  }, [])

  // ── Load: the database and the first rows in one request ────────────────
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    loadedKey.current = null
    const pick = remembered(pageId)
    const show = (db, query) => {
      const s = db.database
      schemaRef.current = s
      setSchema(s)
      setIsPublished(!!db.is_published)
      const vid = s.views.some(v => v.id === pick) ? pick : s.default_view
      setViewId(vid)
      if (query) {
        const v = s.views.find(x => x.id === vid) || s.views[0]
        setRows(query.rows || [])
        setTotal(query.total ?? (query.rows || []).length)
        setLoading(false)
        // Views that show more rows at once (a board) fetch the rest.
        const got = (query.rows || []).length
        const needsMore = (PAGE[v.type] || 100) > got && (query.total || 0) > got
        if (!needsMore) loadedKey.current = queryKeyOf(v, s, '')
      }
    }
    const opening = typeof api.databases.open === 'function'
      ? api.databases.open(pageId, { viewId: pick || undefined })
          .catch(e => (pick && e?.status && e.status < 500 ? api.databases.open(pageId) : Promise.reject(e)))
          .then(db => ({ db, query: db.query || null }))
      : api.databases.get(pageId).then(db => ({ db, query: null }))
    opening.then(({ db, query }) => { if (alive) show(db, query) })
      .catch(e => { if (alive) { setError(e?.message || 'Could not open this database'); setLoading(false) } })
    api.databases.people().then(p => { if (alive && Array.isArray(p)) setPeople(p) }).catch(() => {})
    const timers = viewTimers.current
    return () => { alive = false; for (const t of timers.values()) clearTimeout(t); timers.clear() }
  }, [pageId])

  const view = useMemo(() => schema?.views.find(v => v.id === viewId) || schema?.views[0] || null, [schema, viewId])
  const queryKey = useMemo(() => queryKeyOf(view, schema, search), [view, schema, search])

  const runQuery = useCallback(async (offset = 0) => {
    const s = schemaRef.current
    const v = s?.views.find(x => x.id === viewId) || s?.views[0]
    if (!v) return
    const my = ++queryId.current
    try {
      const res = await api.databases.query(pageId, {
        filter: cleanFilter(v.filter, s), sort: v.sort || [], limit: PAGE[v.type] || 100, offset,
        search: search.trim() || undefined,
      })
      if (my !== queryId.current) return
      setRows(r => (offset ? [...r, ...res.rows] : res.rows))
      setTotal(res.total)
      setError('')
    } catch (e) {
      if (my === queryId.current) setError(e?.message || 'Could not load rows')
    } finally {
      if (my === queryId.current) setLoading(false)
    }
  }, [pageId, viewId, search])

  useEffect(() => {
    if (!queryKey) return undefined
    if (loadedKey.current === queryKey) return undefined   // the opening request brought these
    loadedKey.current = null
    const t = setTimeout(() => runQuery(0), 200)
    return () => clearTimeout(t)
  }, [queryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Schema: properties ──────────────────────────────────────────────────
  /** A property change, `change(schema) -> schema`, saved now against the
   *  schema's revision; the server's copy (converted values, options made
   *  for retyped columns) comes back. Resolves to the saved schema or null. */
  const commitSchema = useCallback(async (change, { requery = false } = {}) => {
    const local = change(schemaRef.current)
    schemaRef.current = local
    setSchema(local)
    try {
      const { saved } = await enqueue(() => saveSchemaChange({
        databases: api.databases, dbId: pageId,
        getBase: () => schemaRef.current,
        change: (base) => (base === local ? local : change(base)),
        deleted: (base, next) => removedProps(base, next),
        onFresh: (fresh) => { pendingViews.current.clear(); schemaRef.current = fresh; setSchema(fresh) },
      }))
      if (saved) adopt(saved)
      if (requery) runQuery(0)
      return saved
    } catch (e) {
      fail(e?.message || 'Could not save the change')
      if (!e?.conflict) api.databases.get(pageId).then(db => { schemaRef.current = db.database; setSchema(db.database) }).catch(() => {})
      return null
    }
  }, [enqueue, pageId, adopt, runQuery, fail])

  // ── Schema: views (one view per request) ────────────────────────────────
  const saveViewNow = useCallback((id, { makeDefault = false } = {}) => {
    clearTimeout(viewTimers.current.get(id))
    viewTimers.current.delete(id)
    return enqueue(async () => {
      const s = schemaRef.current
      const v = s?.views.find(x => x.id === id)
      if (!v) { pendingViews.current.delete(id); return null }
      const sent = JSON.stringify(v)
      try {
        const res = await api.databases.saveView(pageId, id, { view: viewForServer(v, s), ...(makeDefault ? { make_default: true } : {}) })
        // Still pending only if it changed again while this was on its way.
        const now = schemaRef.current?.views.find(x => x.id === id)
        if (!now || JSON.stringify(now) === sent) pendingViews.current.delete(id)
        adopt(res?.database)
        return res
      } catch (e) {
        pendingViews.current.delete(id)
        fail(e?.message || 'Could not save the view')
        return null
      }
    })
  }, [enqueue, pageId, adopt, fail])

  const editView = useCallback((id, patch, { makeDefault = false } = {}) => {
    const s = schemaRef.current
    const next = {
      ...s,
      views: s.views.map(v => (v.id === id ? { ...v, ...patch } : v)),
      ...(makeDefault ? { default_view: id } : {}),
    }
    schemaRef.current = next
    setSchema(next)
    pendingViews.current.add(id)
    clearTimeout(viewTimers.current.get(id))
    if (makeDefault) return saveViewNow(id, { makeDefault })
    viewTimers.current.set(id, setTimeout(() => saveViewNow(id), VIEW_SAVE_MS))
    return null
  }, [saveViewNow])

  const updateView = (patch) => editView(view.id, patch)

  function selectView(id) { setViewId(id); remember(pageId, id); setMenu(null); setLoading(true) }

  const addViewOf = async (v) => {
    const s = schemaRef.current
    schemaRef.current = { ...s, views: [...s.views, v] }
    setSchema(schemaRef.current)
    pendingViews.current.add(v.id)
    selectView(v.id)
    await saveViewNow(v.id)
  }
  const addView = (type) => addViewOf(makeView(type, schemaRef.current))
  const removeView = async (id) => {
    const s = schemaRef.current
    const views = s.views.filter(x => x.id !== id)
    if (!views.length) return
    clearTimeout(viewTimers.current.get(id))
    pendingViews.current.delete(id)
    schemaRef.current = { ...s, views, default_view: s.default_view === id ? views[0].id : s.default_view }
    setSchema(schemaRef.current)
    if (view?.id === id) selectView(views[0].id)
    try {
      const res = await enqueue(() => api.databases.deleteView(pageId, id))
      adopt(res?.database)
    } catch (e) {
      fail(e?.message || 'Could not delete the view')
      api.databases.get(pageId).then(db => adopt(db.database)).catch(() => {})
    }
  }

  const updateProp = (prop) => {
    const old = schemaRef.current.properties.find(p => p.id === prop.id)
    const retyped = old && old.type !== prop.type
    const lostOptions = old?.options && (old.options || []).some(o => !(prop.options || []).some(x => x.id === o.id))
    commitSchema(base => ({ ...base, properties: base.properties.map(p => (p.id === prop.id ? prop : p)) }), { requery: retyped || lostOptions })
  }
  const addProp = (prop) => {
    commitSchema(base => ({ ...base, properties: [...base.properties, { ...prop, name: uniqueName(base, prop.name) }] }))
  }
  const deleteProp = async (id) => {
    const prop = schemaRef.current.properties.find(p => p.id === id)
    const ok = await confirm({ title: 'Delete property', message: `Delete "${prop?.name}" and its values in every row?`, confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    commitSchema(base => ({
      ...base,
      properties: base.properties.filter(p => p.id !== id),
      views: base.views.map(v => ({
        ...v,
        hidden: (v.hidden || []).filter(x => x !== id), order: (v.order || []).filter(x => x !== id),
        sort: (v.sort || []).filter(x => x.prop !== id),
        card_props: v.card_props && v.card_props.filter(x => x !== id),
        group_by: v.group_by === id ? null : v.group_by, date_prop: v.date_prop === id ? null : v.date_prop,
        filter: v.filter ? { ...v.filter, rules: v.filter.rules.filter(r => r.prop !== id) } : v.filter,
      })),
    }), { requery: true })
  }
  const createOption = async (prop, name) => {
    const count = (schemaRef.current.properties.find(p => p.id === prop.id)?.options || []).length
    const opt = { id: newId('o'), name, color: COLORS[count % COLORS.length] }
    const saved = await commitSchema(base => ({
      ...base,
      properties: base.properties.map(p => (p.id === prop.id && !(p.options || []).some(o => o.id === opt.id)
        ? { ...p, options: [...(p.options || []), opt] } : p)),
    }))
    return saved ? opt.id : null
  }
  const addGroupProp = () => {
    const id = newId('p')
    const vid = view.id
    commitSchema(base => ({
      ...base,
      properties: [...base.properties, { id, name: uniqueName(base, 'Status'), type: 'select', options: [
        { id: `${id}a`, name: 'To do', color: 'gray' }, { id: `${id}b`, name: 'Doing', color: 'blue' }, { id: `${id}c`, name: 'Done', color: 'green' },
      ] }],
      views: base.views.map(v => (v.id === vid ? { ...v, group_by: id } : v)),
    }))
  }

  // ── Rows ────────────────────────────────────────────────────────────────
  const cells = useMemo(() => createCellQueue({
    save: (rowId, propId, value) => api.databases.updateRow(pageId, rowId, propId === 'title' ? { title: value ?? '' } : { props: { [propId]: value } }),
    apply: (rowId, propId, value) => setRows(rs => applyUpdates(rs, [propId === 'title' ? { id: rowId, title: value ?? '' } : { id: rowId, props: { [propId]: value } }])),
    onSaved: (row, pending) => {
      if (!row?.id) return
      // The server's row, with this tab's edits to other cells still on top.
      const keep = Object.entries(pending)
      setRows(rs => rs.map(r => {
        if (r.id !== row.id) return r
        let next = row
        for (const [k, v] of keep) next = applyUpdates([next], [k === 'title' ? { id: row.id, title: v ?? '' } : { id: row.id, props: { [k]: v } }])[0]
        return next
      }))
    },
    onError: (e) => fail(e?.message ? `Not saved: ${e.message}` : 'That change was not saved'),
  }), [pageId, fail])
  useEffect(() => () => { cells.flushAll() }, [cells])

  const changeCell = useCallback((rowId, propId, value) => {
    const row = rowsRef.current.find(r => r.id === rowId)
    const current = row ? (propId === 'title' ? row.title || '' : (row.props?.[propId] ?? null)) : null
    cells.change(rowId, propId, value, current)
  }, [cells])

  const addRow = async (preset = {}) => {
    const s = schemaRef.current
    const props = { ...presetFromFilter(cleanFilter(view.filter, s), s), ...preset }
    for (const k of Object.keys(props)) if (props[k] == null) delete props[k]
    try {
      const row = await api.databases.createRow(pageId, { title: '', props })
      setRows(rs => [...rs, row])
      setTotal(t => t + 1)
      // Board, gallery and calendar open the new row beside the database.
      if (view.type !== 'table') setPeek({ id: row.id, created: true, start: row.props || {} })
      return row
    } catch (e) { fail(e?.message || 'Could not add a row'); return null }
  }

  const removeRows = useCallback(async (ids, { quiet = false } = {}) => {
    try {
      await api.databases.deleteRows(pageId, ids)
      setRows(rs => rs.filter(r => !ids.includes(r.id)))
      setTotal(t => Math.max(0, t - ids.length))
      if (!quiet) say(`${ids.length} ${ids.length === 1 ? 'row' : 'rows'} moved to the trash`)
      return true
    } catch (e) { if (!quiet) fail(e?.message || 'Could not delete'); return false }
  }, [pageId, say, fail])

  const deleteRows = async (ids) => {
    const ok = await confirm({ title: 'Delete rows', message: `Move ${ids.length} ${ids.length === 1 ? 'row' : 'rows'} to the trash? They can be restored from there.`, confirmLabel: 'Move to trash', tone: 'danger' })
    if (!ok) return
    removeRows(ids)
  }

  const openRow = useCallback((row) => { if (row?.id) setPeek({ id: row.id, created: false }) }, [])
  const closePeek = useCallback(({ bodyEmpty } = {}) => {
    const p = peek
    setPeek(null)
    if (!p?.created || !bodyEmpty) return
    // A new row closed untitled and empty is not kept.
    const row = rowsRef.current.find(r => r.id === p.id)
    const pending = cells.pendingFor(p.id)
    if (row && rowIsBlank(row, schemaRef.current, p.start) && !Object.keys(pending).length) removeRows([p.id], { quiet: true })
  }, [peek, removeRows, cells])

  const props = useMemo(() => propsById(schema), [schema])
  const shownRows = useMemo(() => (view ? sortRows(rows, view.sort, props) : rows), [rows, view, props])

  const moveOnBoard = async (cardId, key, index) => {
    const groupProp = props[view.group_by]
    const columns = groupRows(shownRows, groupProp)
    const updates = moveCard(columns, cardId, key, index, groupProp.id)
    if (!updates.length) return
    const before = rows
    setRows(rs => applyUpdates(rs, updates))
    try {
      const res = await api.databases.bulkUpdate(pageId, updates)
      const byId = new Map((res.rows || []).map(r => [r.id, r]))
      setRows(rs => rs.map(r => byId.get(r.id) || r))
    } catch (e) {
      setRows(before)
      fail(e?.message || 'Could not move the card')
    }
  }

  const reschedule = (rowId, day) => {
    const row = rows.find(r => r.id === rowId)
    const prop = props[view.date_prop]
    if (!row || !prop) return
    const next = rescheduled(rawValue(row, prop), day)
    if (next !== rawValue(row, prop)) changeCell(rowId, prop.id, next)
  }

  const exportCsv = async () => {
    setMenu(null)
    try {
      const { blob, filename } = await api.databases.exportCsv(pageId)
      downloadBlob(blob, filename || 'database.csv')
    } catch (e) { fail(e?.message || 'Export failed') }
  }
  const publishRows = async (published) => {
    setMenu(null)
    try {
      const res = await api.databases.publishRows(pageId, published)
      setRows(rs => rs.map(r => ({ ...r, is_published: published })))
      say(`${res.updated} ${res.updated === 1 ? 'row' : 'rows'} ${published ? 'published' : 'unpublished'}`)
    } catch (e) { fail(e?.message || 'Could not change the rows') }
  }

  if (error && !schema) return <div className="fdb"><style>{DB_CSS}</style><div className="fdb-empty" role="alert">{error}</div></div>
  if (!schema || !view) {
    return (
      <div className="fdb" aria-busy="true"><style>{DB_CSS}</style>
        <div className="fdb-empty">Loading database…</div>
      </div>
    )
  }

  const filterCount = cleanFilter(view.filter, schema)?.rules.length || 0
  const common = {
    schema, view, rows: shownRows, total, people,
    onUpdateView: updateView, onOpenRow: openRow, onAddRow: addRow,
  }
  const peekRow = peek ? rows.find(r => r.id === peek.id) : null

  return (
    <div className="fdb" data-testid="database-view">
      <style>{DB_CSS}</style>
      <div className="fdb-bar">
        <div className="fdb-tabs" role="tablist" aria-label="Views">
          {schema.views.map(v => (
            <ViewTab key={v.id} view={v} active={v.id === view.id} isDefault={v.id === schema.default_view}
              canDelete={schema.views.length > 1}
              onSelect={() => selectView(v.id)}
              onRename={name => editView(v.id, { name })}
              onDefault={() => editView(v.id, {}, { makeDefault: true })}
              onDuplicate={() => addViewOf({ ...JSON.parse(JSON.stringify(v)), id: newId('v'), name: `${v.name} copy` })}
              onDelete={() => removeView(v.id)} />
          ))}
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button type="button" className="fdb-tab" aria-label="Add a view" aria-expanded={menu === 'add-view'} onClick={() => setMenu(m => (m === 'add-view' ? null : 'add-view'))}>+</button>
            {menu === 'add-view' && (
              <Popover onClose={() => setMenu(null)} label="Add a view">
                <h4>New view</h4>
                {VIEW_TYPES.map(t => <button type="button" key={t.type} className="fdb-item" onClick={() => { setMenu(null); addView(t.type) }}>{t.label}</button>)}
              </Popover>
            )}
          </span>
        </div>
        <div className="fdb-tools">
          <span style={{ position: 'relative' }}>
            <button type="button" className={`fdb-btn${filterCount ? ' on' : ''}`} aria-expanded={menu === 'filter'}
              onClick={() => {
                if (!view.filter?.rules?.length && menu !== 'filter') updateView({ filter: { op: 'and', rules: [newRule(schema.properties)] } })
                setMenu(m => (m === 'filter' ? null : 'filter'))
              }}>
              Filter{filterCount ? ` · ${filterCount}` : ''}
            </button>
            {menu === 'filter' && (
              <FilterMenu filter={view.filter} schema={schema} onChange={filter => updateView({ filter })}
                onClose={() => { setMenu(null); if (!cleanFilter(view.filter, schema)) updateView({ filter: null }) }} />
            )}
          </span>
          <span style={{ position: 'relative' }}>
            <button type="button" className={`fdb-btn${view.sort?.length ? ' on' : ''}`} aria-expanded={menu === 'sort'} onClick={() => setMenu(m => (m === 'sort' ? null : 'sort'))}>
              Sort{view.sort?.length ? ` · ${view.sort.length}` : ''}
            </button>
            {menu === 'sort' && <SortMenu sort={view.sort || []} schema={schema} onChange={sort => updateView({ sort })} onClose={() => setMenu(null)} />}
          </span>
          <span style={{ position: 'relative' }}>
            <button type="button" className="fdb-btn" aria-expanded={menu === 'props'} onClick={() => setMenu(m => (m === 'props' ? null : 'props'))}>Properties</button>
            {menu === 'props' && <PropertiesMenu view={view} schema={schema} onChange={updateView} onClose={() => setMenu(null)} />}
          </span>
          {view.type === 'board' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--db-mute)' }}>
              Group by
              <select className="fdb-select" style={{ width: 'auto', minHeight: 28, padding: '2px 4px' }} value={view.group_by || ''} onChange={e => updateView({ group_by: e.target.value || null })}>
                {schema.properties.filter(p => p.type === 'select').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                {!schema.properties.some(p => p.type === 'select') && <option value="">—</option>}
              </select>
            </label>
          )}
          {view.type === 'calendar' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--db-mute)' }}>
              By
              <select className="fdb-select" style={{ width: 'auto', minHeight: 28, padding: '2px 4px' }} value={view.date_prop || ''} onChange={e => updateView({ date_prop: e.target.value || null })}>
                {schema.properties.filter(p => ['date', 'created_time', 'last_edited_time'].includes(p.type)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <input className="fdb-input" type="search" placeholder="Search" aria-label="Search rows" value={search}
            onChange={e => setSearch(e.target.value)} style={{ width: isMobile ? 110 : 150, minHeight: 30 }} />
          <span style={{ position: 'relative' }}>
            <button type="button" className="fdb-btn" aria-label="More database actions" aria-expanded={menu === 'more'} onClick={() => setMenu(m => (m === 'more' ? null : 'more'))}>⋯</button>
            {menu === 'more' && (
              <Popover onClose={() => setMenu(null)} label="Database actions" align="right">
                <button type="button" className="fdb-item" onClick={() => { setMenu(null); setImportOpen(true) }}><span className="g">⇪</span>Import CSV…</button>
                <button type="button" className="fdb-item" onClick={exportCsv}><span className="g">⇩</span>Export CSV</button>
                <div className="fdb-sep" />
                <button type="button" className="fdb-item" onClick={() => publishRows(true)}><span className="g">◎</span>Publish every row page</button>
                <button type="button" className="fdb-item" onClick={() => publishRows(false)}><span className="g">○</span>Unpublish every row page</button>
                {!isPublished && <div className="fdb-count">Publish the database itself from the page menu to share it.</div>}
              </Popover>
            )}
          </span>
          <button type="button" className="fdb-btn primary" onClick={() => addRow()}>New</button>
        </div>
      </div>

      {notice && <div role="status" className="fdb-count" style={{ color: 'var(--db-text)' }}>{notice}</div>}
      {error && <div role="alert" className="fdb-count" style={{ color: 'var(--db-danger)' }}>{error}</div>}

      <div aria-busy={loading || undefined} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
        {view.type === 'table' && (
          <TableView {...common}
            onUpdateProp={updateProp} onDeleteProp={deleteProp} onAddProp={addProp}
            onRowChange={changeCell} onCreateOption={createOption} onDeleteRows={deleteRows}
            onLoadMore={() => runQuery(rows.length)}
            onSortBy={(prop, dir) => updateView({ sort: [{ prop, dir }] })}
            onFilterBy={(prop) => {
              const p = props[prop]
              updateView({ filter: { op: 'and', rules: [...(view.filter?.rules || []), { ...newRule([p]) }] } })
              setMenu('filter')
            }} />
        )}
        {view.type === 'board' && <BoardView {...common} onMove={moveOnBoard} onAddGroupProp={addGroupProp} />}
        {view.type === 'gallery' && <GalleryView {...common} />}
        {view.type === 'calendar' && <CalendarView {...common} onReschedule={reschedule} />}
      </div>

      {peek && peekRow && (
        <RowPeek key={peek.id} row={peekRow} schema={schema} people={people} isMobile={isMobile}
          onChange={changeCell} onCreateOption={createOption} onClose={closePeek}
          onOpenPage={onOpenRow ? (row) => { cells.flushAll(); onOpenRow(row) } : undefined} />
      )}

      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} dbId={pageId} schema={schema}
        onImported={res => {
          if (res?.database) adopt(res.database)
          say(res?.duplicate ? `Already imported: ${res?.created ?? 0} rows` : `${res?.created ?? 0} rows imported`)
          runQuery(0)
        }} />
    </div>
  )
}
