// Pure helpers for databases: property types, value formatting, client-side
// filtering and sorting (the public viewer and optimistic edits), board moves
// and the calendar grid. Kept free of React so they are easy to test.
//
// Shapes (see backend/app/services/databases.py):
//   schema = { properties:[{id,name,type,options?,format?}], views:[…], default_view, row_type }
//   row    = { id, title, icon, cover, slug, position, created_at, updated_at, props:{[propId]: value} }

export const PROP_TYPES = [
  { type: 'text', label: 'Text', glyph: '¶' },
  { type: 'number', label: 'Number', glyph: '#' },
  { type: 'select', label: 'Select', glyph: '◉' },
  { type: 'multi_select', label: 'Multi-select', glyph: '☰' },
  { type: 'date', label: 'Date', glyph: '▦' },
  { type: 'person', label: 'Person', glyph: '☺' },
  { type: 'checkbox', label: 'Checkbox', glyph: '☑' },
  { type: 'url', label: 'URL', glyph: '↗' },
  { type: 'created_time', label: 'Created time', glyph: '◷' },
  { type: 'last_edited_time', label: 'Last edited time', glyph: '◶' },
]
export const TITLE_TYPE = { type: 'title', label: 'Title', glyph: 'Aa' }
export const typeMeta = (t) => (t === 'title' ? TITLE_TYPE : PROP_TYPES.find(p => p.type === t) || PROP_TYPES[0])
export const COMPUTED = new Set(['created_time', 'last_edited_time'])
export const isComputed = (p) => COMPUTED.has(p?.type)

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
export const NUMBER_FORMATS = [
  { value: 'plain', label: 'Number' },
  { value: 'inr', label: 'Rupee (₹)' },
  { value: 'percent', label: 'Percent' },
]

export const VIEW_TYPES = [
  { type: 'table', label: 'Table' },
  { type: 'board', label: 'Board' },
  { type: 'gallery', label: 'Gallery' },
  { type: 'calendar', label: 'Calendar' },
]

export const OPERATORS = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'ends_with', 'empty', 'not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  date: ['eq', 'before', 'after', 'on_or_before', 'on_or_after', 'empty', 'not_empty'],
  select: ['eq', 'neq', 'empty', 'not_empty'],
  multi_select: ['contains', 'not_contains', 'empty', 'not_empty'],
  checkbox: ['eq'],
}
const OP_FAMILY = {
  title: 'text', text: 'text', url: 'text', person: 'text', number: 'number', date: 'date',
  created_time: 'date', last_edited_time: 'date', select: 'select', multi_select: 'multi_select', checkbox: 'checkbox',
}
export const operatorsFor = (type) => OPERATORS[OP_FAMILY[type] || 'text']
export const OP_LABELS = {
  contains: 'contains', not_contains: 'does not contain', eq: 'is', neq: 'is not',
  starts_with: 'starts with', ends_with: 'ends with', empty: 'is empty', not_empty: 'is not empty',
  gt: '>', gte: '≥', lt: '<', lte: '≤', before: 'is before', after: 'is after',
  on_or_before: 'is on or before', on_or_after: 'is on or after',
}
export const VALUELESS = new Set(['empty', 'not_empty'])

let _seq = 0
export function newId(prefix = 'p') {
  _seq = (_seq + 1) % 1e6
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36).slice(-4)}${rnd}${_seq}`.slice(0, 24)
}

// ── Values ────────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const PLAIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 })

export function formatNumber(n, format) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  if (format === 'inr') return INR.format(n)
  if (format === 'percent') return `${PLAIN.format(n)}%`
  return PLAIN.format(n)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatDate(s) {
  if (!s || typeof s !== 'string') return ''
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return s
  const base = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
  return m[4] ? `${base}, ${m[4]}:${m[5]}` : base
}

/** An ISO timestamp as YYYY-MM-DD in India time (what the server filters on). */
export function istDay(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return new Date(t.getTime() + 330 * 60000).toISOString().slice(0, 10)
}
export function formatStamp(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const ist = new Date(t.getTime() + 330 * 60000).toISOString()
  return formatDate(`${ist.slice(0, 10)}T${ist.slice(11, 16)}`)
}

/** The raw value of a property on a row (title and times included). */
export function rawValue(row, prop) {
  if (!row || !prop) return null
  if (prop.type === 'title') return row.title || ''
  if (prop.type === 'created_time') return row.created_at || null
  if (prop.type === 'last_edited_time') return row.updated_at || null
  const v = row.props?.[prop.id]
  return v === undefined ? null : v
}

export const optionOf = (prop, id) => (prop?.options || []).find(o => o.id === id) || null

/** A value as display text (search, CSV, card titles). */
export function valueText(row, prop) {
  const v = rawValue(row, prop)
  switch (prop?.type) {
    case 'number': return formatNumber(v, prop.format)
    case 'date': return formatDate(v)
    case 'created_time': case 'last_edited_time': return formatStamp(v)
    case 'select': return optionOf(prop, v)?.name || ''
    case 'multi_select': return (Array.isArray(v) ? v : []).map(id => optionOf(prop, id)?.name).filter(Boolean).join(', ')
    case 'checkbox': return v === true ? 'Yes' : 'No'
    default: return v == null ? '' : String(v)
  }
}

export function isEmptyValue(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

// ── Filtering and sorting (mirrors the server's SQL) ──────────────────────

function compareKey(row, prop) {
  const v = rawValue(row, prop)
  switch (prop.type) {
    case 'number': return typeof v === 'number' ? v : null
    case 'date': return v ? String(v) : null
    case 'created_time': case 'last_edited_time': return v ? new Date(v).getTime() : null
    case 'select': { const i = (prop.options || []).findIndex(o => o.id === v); return i < 0 ? null : i }
    case 'multi_select': { const first = Array.isArray(v) ? v[0] : null; const i = (prop.options || []).findIndex(o => o.id === first); return i < 0 ? null : i }
    case 'checkbox': return v === true ? 1 : 0
    default: return v ? String(v).toLowerCase() : null
  }
}

function ruleMatches(row, rule, props) {
  if (rule.rules) return filterMatches(row, rule, props)
  const prop = props[rule.prop]
  if (!prop) return true
  const fam = OP_FAMILY[prop.type] || 'text'
  const cmp = rule.cmp
  const value = rule.value
  const v = rawValue(row, prop)
  if (fam === 'text') {
    const s = (v == null ? '' : String(v)).toLowerCase()
    const q = (value == null ? '' : String(value)).toLowerCase()
    switch (cmp) {
      case 'empty': return s === ''
      case 'not_empty': return s !== ''
      case 'eq': return s === q
      case 'neq': return s !== q
      case 'contains': return s.includes(q)
      case 'not_contains': return !s.includes(q)
      case 'starts_with': return s.startsWith(q)
      case 'ends_with': return s.endsWith(q)
      default: return true
    }
  }
  if (fam === 'number') {
    const n = typeof v === 'number' ? v : null
    const q = Number(value)
    switch (cmp) {
      case 'empty': return n == null
      case 'not_empty': return n != null
      case 'eq': return n != null && n === q
      case 'neq': return n == null || n !== q
      case 'gt': return n != null && n > q
      case 'gte': return n != null && n >= q
      case 'lt': return n != null && n < q
      case 'lte': return n != null && n <= q
      default: return true
    }
  }
  if (fam === 'date') {
    const d = COMPUTED.has(prop.type) ? istDay(v) : (v ? String(v).slice(0, 10) : '')
    const q = String(value || '').slice(0, 10)
    switch (cmp) {
      case 'empty': return d === ''
      case 'not_empty': return d !== ''
      case 'eq': return d !== '' && d === q
      case 'before': return d !== '' && d < q
      case 'after': return d !== '' && d > q
      case 'on_or_before': return d !== '' && d <= q
      case 'on_or_after': return d !== '' && d >= q
      default: return true
    }
  }
  if (fam === 'select') {
    switch (cmp) {
      case 'empty': return isEmptyValue(v)
      case 'not_empty': return !isEmptyValue(v)
      case 'eq': return v === value
      case 'neq': return v !== value
      default: return true
    }
  }
  if (fam === 'multi_select') {
    const arr = Array.isArray(v) ? v : []
    switch (cmp) {
      case 'empty': return arr.length === 0
      case 'not_empty': return arr.length > 0
      case 'contains': return arr.includes(value)
      case 'not_contains': return !arr.includes(value)
      default: return true
    }
  }
  if (fam === 'checkbox') return (v === true) === (value === true || value === 'true')
  return true
}

export function filterMatches(row, filter, props) {
  if (!filter || !filter.rules?.length) return true
  const results = filter.rules.map(r => ruleMatches(row, r, props))
  return filter.op === 'or' ? results.some(Boolean) : results.every(Boolean)
}

const byPosition = (a, b) => {
  const pa = a.position ?? Infinity, pb = b.position ?? Infinity
  if (pa !== pb) return pa < pb ? -1 : 1
  return String(a.created_at || '').localeCompare(String(b.created_at || ''))
}

export function sortRows(rows, sort = [], props = {}) {
  const keys = (sort || []).filter(s => props[s.prop])
  return [...rows].sort((a, b) => {
    for (const s of keys) {
      const prop = props[s.prop]
      const ka = compareKey(a, prop), kb = compareKey(b, prop)
      if (ka === kb) continue
      if (ka == null) return 1       // empty last, either direction
      if (kb == null) return -1
      const c = ka < kb ? -1 : 1
      return s.dir === 'desc' ? -c : c
    }
    return byPosition(a, b)
  })
}

export const propsById = (schema) => Object.fromEntries((schema?.properties || []).map(p => [p.id, p]))

/** Rows a view shows, filtered and sorted on the client. */
export function viewRows(rows, view, schema) {
  const props = propsById(schema)
  return sortRows(rows.filter(r => filterMatches(r, view?.filter, props)), view?.sort, props)
}

// ── Views ─────────────────────────────────────────────────────────────────

/** Properties in the order a view shows them (title first unless moved). */
export function orderedProps(schema, view) {
  const all = schema?.properties || []
  const order = view?.order || []
  const ranked = order.map(id => all.find(p => p.id === id)).filter(Boolean)
  for (const p of all) if (!ranked.includes(p)) ranked.push(p)
  return ranked
}
export function visibleProps(schema, view) {
  const hidden = new Set(view?.hidden || [])
  return orderedProps(schema, view).filter(p => p.type === 'title' || !hidden.has(p.id))
}

export function makeView(type, schema, name) {
  const first = (t) => (schema?.properties || []).find(p => p.type === t)?.id || null
  const v = { id: newId('v'), name: name || VIEW_TYPES.find(x => x.type === type)?.label || 'View', type, filter: null, sort: [], hidden: [], order: [], widths: {} }
  if (type === 'board') v.group_by = first('select')
  if (type === 'calendar') v.date_prop = first('date')
  if (type !== 'table') v.card_props = []
  if (type === 'gallery') v.cover = 'cover'
  return v
}

/** Sum / average of a number column over the given rows. */
export function aggregate(rows, prop, kind) {
  const nums = rows.map(r => rawValue(r, prop)).filter(v => typeof v === 'number' && Number.isFinite(v))
  if (kind === 'count') return rows.filter(r => !isEmptyValue(rawValue(r, prop))).length
  if (!nums.length) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return kind === 'avg' ? sum / nums.length : sum
}

// ── Board ─────────────────────────────────────────────────────────────────

export const NO_GROUP = '__none__'

/** [{ key, option|null, rows }] — one column per option, plus "No value". */
export function groupRows(rows, prop) {
  const opts = prop?.options || []
  const cols = opts.map(o => ({ key: o.id, option: o, rows: [] }))
  const none = { key: NO_GROUP, option: null, rows: [] }
  const index = new Map(cols.map(c => [c.key, c]))
  for (const r of rows) {
    const v = r.props?.[prop?.id]
    ;(index.get(v) || none).rows.push(r)
  }
  return [none, ...cols]
}

/** A position strictly between two neighbours (null = no neighbour). */
export function positionBetween(before, after) {
  if (before == null && after == null) return 1024
  if (before == null) return after - 1024
  if (after == null) return before + 1024
  return (before + after) / 2
}

/**
 * Moving card `cardId` into column `toKey` at `toIndex` (counted without the
 * card). Returns the bulk-update list for the server: the card's new group
 * and position, plus renumbered neighbours when the gap is too small.
 */
export function moveCard(columns, cardId, toKey, toIndex, groupProp) {
  const card = columns.flatMap(c => c.rows).find(r => r.id === cardId)
  const target = columns.find(c => c.key === toKey)
  if (!card || !target) return []
  const siblings = target.rows.filter(r => r.id !== cardId)
  const at = Math.max(0, Math.min(toIndex ?? siblings.length, siblings.length))
  const before = at > 0 ? siblings[at - 1].position : null
  const after = at < siblings.length ? siblings[at].position : null
  let pos = positionBetween(before ?? null, after ?? null)
  const updates = []
  const tight = before != null && after != null && !(before < pos && pos < after && after - before > 1e-6)
  const props = {}
  const newGroup = toKey === NO_GROUP ? null : toKey
  if ((card.props?.[groupProp] ?? null) !== newGroup) props[groupProp] = newGroup
  if (tight || siblings.some(s => s.position == null)) {
    // Renumber the whole column with the card in its place.
    const ordered = [...siblings]
    ordered.splice(at, 0, card)
    ordered.forEach((r, i) => {
      const p = (i + 1) * 1024
      if (r.id === cardId) pos = p
      else if (r.position !== p) updates.push({ id: r.id, position: p })
    })
  }
  updates.unshift({ id: cardId, position: pos, ...(Object.keys(props).length ? { props } : {}) })
  return updates
}

/** Apply bulk updates to local rows (optimistic). */
export function applyUpdates(rows, updates) {
  const byId = new Map(updates.map(u => [u.id, u]))
  return rows.map(r => {
    const u = byId.get(r.id)
    if (!u) return r
    const next = { ...r }
    if (u.position != null) next.position = u.position
    if (u.title != null) next.title = u.title
    if (u.props) {
      const props = { ...(r.props || {}) }
      for (const [k, v] of Object.entries(u.props)) { if (v == null) delete props[k]; else props[k] = v }
      next.props = props
    }
    return next
  })
}

// ── Calendar ──────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Six weeks of days (Monday first) covering the month of `year`/`month0`. */
export function monthGrid(year, month0) {
  const first = new Date(year, month0, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month0, 1 - offset)
  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    days.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === month0 })
  }
  return days
}

/** The day a row sits on in a calendar laid out by `prop`. */
export function rowDay(row, prop) {
  const v = rawValue(row, prop)
  if (!v) return ''
  return COMPUTED.has(prop.type) ? istDay(v) : String(v).slice(0, 10)
}

/** Moving a dated value to another day keeps its time of day. */
export function rescheduled(value, day) {
  if (typeof value === 'string' && value.length > 10) return `${day}${value.slice(10)}`
  return day
}

// ── Colours (light / dark pairs come from CSS variables) ──────────────────
export const chipStyle = (color) => ({
  background: `var(--db-c-${COLORS.includes(color) ? color : 'gray'}-bg)`,
  color: `var(--db-c-${COLORS.includes(color) ? color : 'gray'}-fg)`,
})

// ── Sending a view to the server ──────────────────────────────────────────

function ruleIsComplete(rule, props) {
  const prop = props[rule.prop]
  if (!prop || !operatorsFor(prop.type).includes(rule.cmp)) return false
  if (VALUELESS.has(rule.cmp)) return true
  const v = rule.value
  switch (OP_FAMILY[prop.type]) {
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(String(v || ''))
    case 'select': case 'multi_select': return (prop.options || []).some(o => o.id === v)
    case 'checkbox': return typeof v === 'boolean'
    // An empty text rule is still being typed: it filters nothing yet.
    default: return v != null && String(v).trim() !== '' && String(v).length <= 500
  }
}

/** The filter without rules that are still being typed (the server would refuse them). */
export function cleanFilter(filter, schema) {
  if (!filter?.rules?.length) return null
  const props = propsById(schema)
  const rules = filter.rules.map(r => (r.rules ? cleanFilter(r, schema) : (ruleIsComplete(r, props) ? r : null))).filter(Boolean)
  return rules.length ? { op: filter.op === 'or' ? 'or' : 'and', rules } : null
}

/** Values a new row should start with so it shows up in a filtered view. */
export function presetFromFilter(filter, schema) {
  const out = {}
  if (!filter || filter.op !== 'and') return out
  const props = propsById(schema)
  for (const r of filter.rules || []) {
    const p = props[r.prop]
    if (!p || r.rules || p.type === 'title' || COMPUTED.has(p.type)) continue
    if (r.cmp === 'eq' && ['select', 'checkbox', 'text', 'person', 'number', 'date', 'url'].includes(p.type)) out[p.id] = r.value
    if (r.cmp === 'contains' && p.type === 'multi_select') out[p.id] = [...(out[p.id] || []), r.value]
  }
  return out
}

/** A property name not yet used in the schema ("Text", "Text 2", …). */
export function uniqueName(schema, name) {
  const taken = new Set((schema?.properties || []).map(p => p.name.toLowerCase()))
  let n = name, i = 2
  while (taken.has(n.toLowerCase())) n = `${name} ${i++}`
  return n
}
