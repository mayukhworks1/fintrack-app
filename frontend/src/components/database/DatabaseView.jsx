import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../services/api'
import { downloadBlob } from '../../utils/download'
import { useConfirm } from '../../context/ConfirmContext'
import { DB_CSS } from './dbStyles'
import { Popover } from './ui'
import TableView from './TableView'
import BoardView from './BoardView'
import GalleryView from './GalleryView'
import CalendarView from './CalendarView'
import CsvImportDialog from './CsvImportDialog'
import { FilterMenu, PropertiesMenu, SortMenu, newRule } from './ViewMenus'
import {
  COLORS, VIEW_TYPES, applyUpdates, cleanFilter, groupRows, makeView, moveCard, newId,
  presetFromFilter, propsById, rescheduled, rawValue, sortRows, uniqueName,
} from './dbModel'

const PAGE = { table: 100, board: 500, gallery: 200, calendar: 500 }

const viewKey = (id) => `fdb_view_${id}`
const remembered = (id) => { try { return localStorage.getItem(viewKey(id)) } catch { return null } }
const remember = (id, v) => { try { localStorage.setItem(viewKey(id), v) } catch {} }

/** The schema as the server takes it: filters without half-typed rules. */
function forServer(schema) {
  return {
    properties: schema.properties,
    views: schema.views.map(v => ({ ...v, filter: cleanFilter(v.filter, schema) })),
    default_view: schema.default_view,
    row_type: schema.row_type,
  }
}

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
 * The database editor: view tabs, toolbar and the active view. Rows are
 * pages; opening one hands it to onOpenRow so it opens in the page editor.
 */
export default function DatabaseView({ pageId, onOpenRow, isMobile }) {
  const confirm = useConfirm()
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
  const schemaRef = useRef(null)
  const saveTimer = useRef(null)
  const chain = useRef(Promise.resolve())
  const queryId = useRef(0)

  const say = useCallback((msg) => { setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? '' : n)), 3500) }, [])

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setLoading(true)
    api.databases.get(pageId).then(db => {
      if (!alive) return
      const s = db.database
      schemaRef.current = s
      setSchema(s)
      setIsPublished(!!db.is_published)
      const pick = remembered(pageId)
      setViewId(s.views.some(v => v.id === pick) ? pick : s.default_view)
    }).catch(e => { if (alive) { setError(e?.message || 'Could not open this database'); setLoading(false) } })
    api.databases.people().then(p => { if (alive && Array.isArray(p)) setPeople(p) }).catch(() => {})
    return () => { alive = false; clearTimeout(saveTimer.current) }
  }, [pageId])

  const view = useMemo(() => schema?.views.find(v => v.id === viewId) || schema?.views[0] || null, [schema, viewId])
  const queryKey = useMemo(() => (view && schema
    ? JSON.stringify({ id: view.id, t: view.type, f: cleanFilter(view.filter, schema), s: view.sort || [], q: search.trim() })
    : null), [view, schema, search])

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
    if (!queryKey) return
    const t = setTimeout(() => runQuery(0), 200)
    return () => clearTimeout(t)
  }, [queryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Schema ──────────────────────────────────────────────────────────────
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current)
    const snapshot = schemaRef.current
    const p = chain.current.then(() => api.databases.saveSchema(pageId, forServer(snapshot)))
    chain.current = p.catch(() => {})
    return p
  }, [pageId])

  /** View-only changes: saved after a pause, the local copy stays as typed. */
  const commitLater = useCallback((next) => {
    schemaRef.current = next
    setSchema(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { persist().catch(e => say(e?.message || 'Could not save the view')) }, 600)
  }, [persist, say])

  /** Property changes: saved now; the server's copy (converted values,
   *  options made for retyped columns) comes back. */
  const commitNow = useCallback(async (next, { requery = false } = {}) => {
    schemaRef.current = next
    setSchema(next)
    try {
      const res = await persist()
      if (res?.database && schemaRef.current === next) {
        // Keep half-typed filters the server dropped.
        const merged = { ...res.database, views: res.database.views.map(v => ({ ...v, filter: next.views.find(x => x.id === v.id)?.filter ?? v.filter })) }
        schemaRef.current = merged
        setSchema(merged)
      }
      if (requery) runQuery(0)
      return res?.database
    } catch (e) {
      say(e?.message || 'Could not save the change')
      api.databases.get(pageId).then(db => { schemaRef.current = db.database; setSchema(db.database) }).catch(() => {})
      return null
    }
  }, [persist, runQuery, say, pageId])

  const updateView = (patch) => {
    const s = schemaRef.current
    commitLater({ ...s, views: s.views.map(v => (v.id === view.id ? { ...v, ...patch } : v)) })
  }
  const updateProp = (prop) => {
    const s = schemaRef.current
    const old = s.properties.find(p => p.id === prop.id)
    const retyped = old && old.type !== prop.type
    const lostOptions = old?.options && (old.options || []).some(o => !(prop.options || []).some(x => x.id === o.id))
    commitNow({ ...s, properties: s.properties.map(p => (p.id === prop.id ? prop : p)) }, { requery: retyped || lostOptions })
  }
  const addProp = (prop) => {
    const s = schemaRef.current
    const p = { ...prop, name: uniqueName(s, prop.name) }
    commitNow({ ...s, properties: [...s.properties, p] })
  }
  const deleteProp = async (id) => {
    const s = schemaRef.current
    const prop = s.properties.find(p => p.id === id)
    const ok = await confirm({ title: 'Delete property', message: `Delete "${prop?.name}" and its values in every row?`, confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    commitNow({
      ...s,
      properties: s.properties.filter(p => p.id !== id),
      views: s.views.map(v => ({
        ...v,
        hidden: (v.hidden || []).filter(x => x !== id), order: (v.order || []).filter(x => x !== id),
        sort: (v.sort || []).filter(x => x.prop !== id),
        card_props: v.card_props && v.card_props.filter(x => x !== id),
        group_by: v.group_by === id ? null : v.group_by, date_prop: v.date_prop === id ? null : v.date_prop,
        filter: v.filter ? { ...v.filter, rules: v.filter.rules.filter(r => r.prop !== id) } : v.filter,
      })),
    }, { requery: true })
  }
  const createOption = async (prop, name) => {
    const s = schemaRef.current
    const cur = s.properties.find(p => p.id === prop.id)
    const opt = { id: newId('o'), name, color: COLORS[(cur.options || []).length % COLORS.length] }
    const saved = await commitNow({ ...s, properties: s.properties.map(p => (p.id === prop.id ? { ...p, options: [...(p.options || []), opt] } : p)) })
    return saved ? opt.id : null
  }
  const addGroupProp = () => {
    const s = schemaRef.current
    const id = newId('p')
    const prop = { id, name: uniqueName(s, 'Status'), type: 'select', options: [
      { id: newId('o'), name: 'To do', color: 'gray' }, { id: newId('o'), name: 'Doing', color: 'blue' }, { id: newId('o'), name: 'Done', color: 'green' },
    ] }
    commitNow({ ...s, properties: [...s.properties, prop], views: s.views.map(v => (v.id === view.id ? { ...v, group_by: id } : v)) })
  }

  // ── Views ───────────────────────────────────────────────────────────────
  const selectView = (id) => { setViewId(id); remember(pageId, id); setMenu(null); setLoading(true) }
  const addView = (type) => {
    const s = schemaRef.current
    const v = makeView(type, s)
    commitNow({ ...s, views: [...s.views, v] }).then(() => selectView(v.id))
  }

  // ── Rows ────────────────────────────────────────────────────────────────
  const replaceRow = (row) => setRows(rs => rs.map(r => (r.id === row.id ? row : r)))

  const changeCell = async (rowId, propId, value) => {
    const patch = propId === 'title' ? { title: value ?? '' } : { props: { [propId]: value } }
    setRows(rs => applyUpdates(rs, [{ id: rowId, ...patch }]))
    try {
      replaceRow(await api.databases.updateRow(pageId, rowId, patch))
    } catch (e) {
      say(e?.message || 'Could not save that value')
      runQuery(0)
    }
  }

  const addRow = async (preset = {}) => {
    const s = schemaRef.current
    const props = { ...presetFromFilter(cleanFilter(view.filter, s), s), ...preset }
    for (const k of Object.keys(props)) if (props[k] == null) delete props[k]
    try {
      const row = await api.databases.createRow(pageId, { title: '', props })
      setRows(rs => [...rs, row])
      setTotal(t => t + 1)
      if (view.type !== 'table') onOpenRow?.(row)
      return row
    } catch (e) { say(e?.message || 'Could not add a row'); return null }
  }

  const deleteRows = async (ids) => {
    const ok = await confirm({ title: 'Delete rows', message: `Move ${ids.length} ${ids.length === 1 ? 'row' : 'rows'} to the trash? They can be restored from there.`, confirmLabel: 'Move to trash', tone: 'danger' })
    if (!ok) return
    try {
      await api.databases.deleteRows(pageId, ids)
      setRows(rs => rs.filter(r => !ids.includes(r.id)))
      setTotal(t => Math.max(0, t - ids.length))
      say(`${ids.length} ${ids.length === 1 ? 'row' : 'rows'} moved to the trash`)
    } catch (e) { say(e?.message || 'Could not delete') }
  }

  const props = useMemo(() => propsById(schema), [schema])
  const shownRows = useMemo(() => (view ? sortRows(rows, view.sort, props) : rows), [rows, view, props])

  const moveOnBoard = async (cardId, key, index) => {
    const groupProp = props[view.group_by]
    const columns = groupRows(shownRows, groupProp)
    const updates = moveCard(columns, cardId, key, index, groupProp.id)
    if (!updates.length) return
    setRows(rs => applyUpdates(rs, updates))
    try {
      const res = await api.databases.bulkUpdate(pageId, updates)
      const byId = new Map((res.rows || []).map(r => [r.id, r]))
      setRows(rs => rs.map(r => byId.get(r.id) || r))
    } catch (e) { say(e?.message || 'Could not move the card'); runQuery(0) }
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
    } catch (e) { say(e?.message || 'Export failed') }
  }
  const publishRows = async (published) => {
    setMenu(null)
    try {
      const res = await api.databases.publishRows(pageId, published)
      setRows(rs => rs.map(r => ({ ...r, is_published: published })))
      say(`${res.updated} ${res.updated === 1 ? 'row' : 'rows'} ${published ? 'published' : 'unpublished'}`)
    } catch (e) { say(e?.message || 'Could not change the rows') }
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
    onUpdateView: updateView, onOpenRow, onAddRow: addRow,
  }

  return (
    <div className="fdb" data-testid="database-view">
      <style>{DB_CSS}</style>
      <div className="fdb-bar">
        <div className="fdb-tabs" role="tablist" aria-label="Views">
          {schema.views.map(v => (
            <ViewTab key={v.id} view={v} active={v.id === view.id} isDefault={v.id === schema.default_view}
              canDelete={schema.views.length > 1}
              onSelect={() => selectView(v.id)}
              onRename={name => commitLater({ ...schemaRef.current, views: schemaRef.current.views.map(x => (x.id === v.id ? { ...x, name } : x)) })}
              onDefault={() => commitLater({ ...schemaRef.current, default_view: v.id })}
              onDuplicate={() => {
                const s = schemaRef.current
                const copy = { ...JSON.parse(JSON.stringify(v)), id: newId('v'), name: `${v.name} copy` }
                commitNow({ ...s, views: [...s.views, copy] }).then(() => selectView(copy.id))
              }}
              onDelete={() => {
                const s = schemaRef.current
                const views = s.views.filter(x => x.id !== v.id)
                commitNow({ ...s, views, default_view: s.default_view === v.id ? views[0].id : s.default_view })
                selectView(views[0].id)
              }} />
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

      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} dbId={pageId} schema={schema}
        onImported={res => {
          if (res?.database) { schemaRef.current = res.database; setSchema(res.database) }
          say(`${res?.created ?? 0} rows imported`)
          runQuery(0)
        }} />
    </div>
  )
}
