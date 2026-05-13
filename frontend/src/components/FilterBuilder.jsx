/**
 * FilterBuilder / applyConditions
 * ──────────────────────────────────────────────────────────────────────────────
 * Advanced per-field condition builder with operator selection and smart value
 * inputs. Derives unique values for autocomplete from actual record data.
 *
 * Exports
 *   FilterBuilder        — React component (the UI)
 *   applyConditions      — pure utility: (records, conditions, getFieldValue) → filtered
 *
 * Field definition format
 *   { key: string, label: string, type: 'text' | 'number' | 'date' }
 *
 * Condition format
 *   { id: string, field: string, op: string, value: string }
 *
 * Usage
 *   const [conds, setConds] = useState([])
 *   <FilterBuilder
 *     fields={MY_FIELDS}
 *     records={allRecords}
 *     getFieldValue={r => r.fields ?? r}
 *     conditions={conds}
 *     onChange={setConds}
 *   />
 *   const filtered = useMemo(
 *     () => applyConditions(baseRecords, conds, r => r.fields ?? r),
 *     [baseRecords, conds]
 *   )
 */

import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { Filter, Plus, X, ChevronDown, Search, Check, SlidersHorizontal } from 'lucide-react'

// ─── Operator tables ──────────────────────────────────────────────────────────

const TEXT_OPS = [
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is',           label: 'is' },
  { value: 'is_not',       label: 'is not' },
  { value: 'starts_with',  label: 'starts with' },
  { value: 'ends_with',    label: 'ends with' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const NUM_OPS = [
  { value: 'eq',           label: '= equals' },
  { value: 'neq',          label: '≠ not equals' },
  { value: 'gt',           label: '> greater than' },
  { value: 'gte',          label: '≥ at least' },
  { value: 'lt',           label: '< less than' },
  { value: 'lte',          label: '≤ at most' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const DATE_OPS = [
  { value: 'date_is',      label: 'is' },
  { value: 'date_is_not',  label: 'is not' },
  { value: 'date_before',  label: 'is before' },
  { value: 'date_after',   label: 'is after' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])
const EXACT_OPS    = new Set(['is', 'is_not'])   // use dropdown with unique values

function opsForType(type) {
  if (type === 'number') return NUM_OPS
  if (type === 'date')   return DATE_OPS
  return TEXT_OPS
}

function defaultOpForType(type) {
  if (type === 'number') return 'eq'
  if (type === 'date')   return 'date_is'
  return 'contains'
}

// ─── Core filter logic ────────────────────────────────────────────────────────

function matchCondition(rawVal, op, condValue) {
  const fv = String(rawVal ?? '').trim()
  const cv = String(condValue ?? '').trim()
  switch (op) {
    case 'is':           return fv.toLowerCase() === cv.toLowerCase()
    case 'is_not':       return fv.toLowerCase() !== cv.toLowerCase()
    case 'contains':     return fv.toLowerCase().includes(cv.toLowerCase())
    case 'not_contains': return !fv.toLowerCase().includes(cv.toLowerCase())
    case 'starts_with':  return fv.toLowerCase().startsWith(cv.toLowerCase())
    case 'ends_with':    return fv.toLowerCase().endsWith(cv.toLowerCase())
    case 'is_empty':     return fv === ''
    case 'is_not_empty': return fv !== ''
    case 'eq':           return Number(fv) === Number(cv)
    case 'neq':          return Number(fv) !== Number(cv)
    case 'gt':           return Number(fv) > Number(cv)
    case 'gte':          return Number(fv) >= Number(cv)
    case 'lt':           return Number(fv) < Number(cv)
    case 'lte':          return Number(fv) <= Number(cv)
    case 'date_is':      return fv.slice(0, 10) === cv
    case 'date_is_not':  return fv.slice(0, 10) !== cv
    case 'date_before':  return cv !== '' && fv.slice(0, 10) < cv
    case 'date_after':   return cv !== '' && fv.slice(0, 10) > cv
    default:             return true
  }
}

export function applyConditions(records, conditions, getFieldValue) {
  if (!conditions || !conditions.length) return records
  // Skip incomplete conditions (no field, no op, or missing value on non-trivial ops)
  const active = conditions.filter(c =>
    c.field && c.op && (NO_VALUE_OPS.has(c.op) || (c.value ?? '') !== '')
  )
  if (!active.length) return records
  return records.filter(rec => {
    const fields = getFieldValue(rec)
    return active.every(c => matchCondition(fields[c.field], c.op, c.value))
  })
}

// ─── Portal dropdown (reused for operator & value pickers) ───────────────────

const DROP_MAX_H = 224

function useDropPos(btnRef, minW = 160) {
  const [pos, setPos] = useState(null)
  const compute = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const w = Math.max(r.width, minW)
    const spaceBelow = window.innerHeight - r.bottom - 8
    const openAbove  = spaceBelow < DROP_MAX_H + 60 && r.top > DROP_MAX_H + 60
    const left = Math.min(r.left, window.innerWidth - w - 8)
    setPos({
      top:    openAbove ? null : r.bottom + 4,
      bottom: openAbove ? window.innerHeight - r.top + 4 : null,
      left:   Math.max(8, left),
      minWidth: w,
    })
  }, [btnRef, minW])
  return [pos, compute]
}

/**
 * Compact portal dropdown used inside condition rows.
 * options: [{ value, label }]
 */
function PortalSelect({ value, onChange, options, placeholder = 'Select…', minW = 140, searchable = false }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const btnRef  = useRef(null)
  const dropRef = useRef(null)
  const inpRef  = useRef(null)
  const [pos, computePos] = useDropPos(btnRef, minW)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  function open_() {
    computePos(); setOpen(true); setQuery('')
    if (searchable) setTimeout(() => inpRef.current?.focus(), 30)
  }
  function close_() { setOpen(false); setQuery('') }
  function pick(v)  { onChange(v); close_() }

  useEffect(() => {
    if (!open) return
    const h = e => {
      if (!dropRef.current?.contains(e.target) && !btnRef.current?.contains(e.target))
        close_()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const hasVal = value !== '' && value != null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={open ? close_ : open_}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all flex-shrink-0 whitespace-nowrap"
        style={{
          background: hasVal ? 'var(--accent-dim)' : 'var(--bg-input)',
          border: `1px solid ${hasVal ? 'var(--accent-soft)' : 'var(--card-border)'}`,
          color: hasVal ? 'var(--accent)' : 'var(--text-2)',
          minWidth: minW,
          boxShadow: open ? '0 0 0 2px var(--accent-glow)' : 'none',
        }}
      >
        <span className="truncate flex-1 text-left">{selected?.label ?? placeholder}</span>
        <ChevronDown size={10} className="flex-shrink-0 opacity-50"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed',
            top:      pos.top    ?? 'auto',
            bottom:   pos.bottom ?? 'auto',
            left:     pos.left,
            minWidth: pos.minWidth,
            maxWidth: 'min(280px, calc(100vw - 16px))',
            zIndex:   10001,
            background:   'var(--card-bg)',
            border:       '1px solid var(--card-border)',
            borderRadius: 10,
            boxShadow:    '0 8px 32px rgba(0,0,0,0.18)',
            overflow:     'hidden',
          }}
        >
          {searchable && (
            <div className="relative" style={{ borderBottom: '1px solid var(--card-border)' }}>
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }} />
              <input
                ref={inpRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') close_() }}
                placeholder="Search…"
                className="w-full pl-7 pr-2 py-2 text-xs outline-none bg-transparent"
                style={{ color: 'var(--text-1)' }}
              />
            </div>
          )}
          <div style={{ maxHeight: DROP_MAX_H, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <p className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-3)' }}>No results</p>
              : filtered.map(opt => {
                  const active = opt.value === value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => pick(opt.value)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[var(--bg-layer)]"
                      style={{
                        color:      active ? 'var(--accent)' : 'var(--text-1)',
                        background: active ? 'var(--accent-dim)' : 'transparent',
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      <span className="w-3 flex-shrink-0">
                        {active && <Check size={9} style={{ color: 'var(--accent)' }} />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  )
                })
            }
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Value input sub-component ────────────────────────────────────────────────

/**
 * Smart value input:
 *   - is / is_not (text) → searchable dropdown with unique values
 *   - contains / starts_with etc. → text input with autocomplete suggestions
 *   - number ops → number input
 *   - date ops → date input
 *   - is_empty / is_not_empty → nothing
 */
function ValueInput({ fieldDef, op, value, onChange, suggestions = [] }) {
  const [showSugg, setShowSugg] = useState(false)
  const [query, setQuery]       = useState(value)
  const wrapRef = useRef(null)

  // sync outer value → local query
  useEffect(() => { setQuery(value) }, [value])

  // close suggestions on outside click
  useEffect(() => {
    if (!showSugg) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setShowSugg(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showSugg])

  if (!fieldDef || NO_VALUE_OPS.has(op)) return null

  const type = fieldDef.type || 'text'

  // Number input
  if (type === 'number') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Value…"
        className="input text-xs py-1.5 px-2.5 rounded-lg min-w-0"
        style={{ width: 110, background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}
      />
    )
  }

  // Date input
  if (type === 'date') {
    return (
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input text-xs py-1.5 px-2.5 rounded-lg min-w-0"
        style={{ width: 140, background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
      />
    )
  }

  // Text — is / is_not → dropdown with unique values
  if (EXACT_OPS.has(op)) {
    const opts = suggestions.map(s => ({ value: s, label: s }))
    return (
      <PortalSelect
        value={value}
        onChange={onChange}
        options={opts}
        placeholder="Pick a value…"
        minW={160}
        searchable
      />
    )
  }

  // Text — partial match ops → text input with autocomplete suggestions
  const filteredSugg = query.trim()
    ? suggestions.filter(s => s.toLowerCase().includes(query.toLowerCase()) && s.toLowerCase() !== query.toLowerCase())
    : []

  return (
    <div ref={wrapRef} className="relative min-w-0" style={{ flex: 1 }}>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setShowSugg(true) }}
        onFocus={() => setShowSugg(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setShowSugg(false) } }}
        placeholder="Type a value…"
        className="input text-xs py-1.5 px-2.5 rounded-lg w-full"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
      />
      {showSugg && filteredSugg.length > 0 && createPortal(
        <SuggestionList
          items={filteredSugg}
          anchorRef={wrapRef}
          onPick={v => { onChange(v); setQuery(v); setShowSugg(false) }}
          onClose={() => setShowSugg(false)}
        />,
        document.body
      )}
    </div>
  )
}

function SuggestionList({ items, anchorRef, onPick, onClose }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({})

  useEffect(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const w = Math.max(r.width, 180)
    const spaceBelow = window.innerHeight - r.bottom - 8
    const openAbove  = spaceBelow < 200 && r.top > 200
    setStyle({
      position: 'fixed',
      top:    openAbove ? undefined : r.bottom + 4,
      bottom: openAbove ? window.innerHeight - r.top + 4 : undefined,
      left:   Math.min(r.left, window.innerWidth - w - 8),
      minWidth: w,
      maxWidth: 'min(300px, calc(100vw - 16px))',
      maxHeight: 200,
      overflowY: 'auto',
      zIndex: 10001,
      background:   'var(--card-bg)',
      border:       '1px solid var(--card-border)',
      borderRadius: 10,
      boxShadow:    '0 8px 32px rgba(0,0,0,0.18)',
    })
  }, [anchorRef])

  useEffect(() => {
    const h = e => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  return createPortal(
    <div ref={ref} style={style}>
      {items.slice(0, 12).map(item => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className="w-full flex items-center px-3 py-2 text-xs text-left transition-colors hover:bg-[var(--bg-layer)]"
          style={{ color: 'var(--text-1)' }}
        >
          <span className="truncate">{item}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

// ─── Condition row ────────────────────────────────────────────────────────────

function ConditionRow({ condition, fields, uniqueValues, onChange, onRemove }) {
  const fieldDef = fields.find(f => f.key === condition.field)
  const ops      = fieldDef ? opsForType(fieldDef.type) : TEXT_OPS
  const suggs    = (fieldDef && uniqueValues[fieldDef.key]) || []

  function setField(key) {
    const def = fields.find(f => f.key === key)
    onChange({ ...condition, field: key, op: defaultOpForType(def?.type), value: '' })
  }
  function setOp(op) {
    onChange({ ...condition, op, value: '' })
  }
  function setValue(value) {
    onChange({ ...condition, value })
  }

  const fieldOpts = fields.map(f => ({ value: f.key, label: f.label }))
  const opOpts    = ops

  return (
    <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
      {/* Field selector */}
      <PortalSelect
        value={condition.field}
        onChange={setField}
        options={fieldOpts}
        placeholder="Choose field…"
        minW={130}
      />

      {/* Operator selector */}
      <PortalSelect
        value={condition.op}
        onChange={setOp}
        options={opOpts}
        placeholder="…"
        minW={140}
      />

      {/* Value input */}
      {condition.field && !NO_VALUE_OPS.has(condition.op) && (
        <ValueInput
          fieldDef={fieldDef}
          op={condition.op}
          value={condition.value}
          onChange={setValue}
          suggestions={suggs}
        />
      )}
      {condition.field && NO_VALUE_OPS.has(condition.op) && (
        <span className="text-xs italic" style={{ color: 'var(--text-3)' }}>no value needed</span>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-[var(--fin-neg-bg)]"
        style={{ color: 'var(--text-3)' }}
        title="Remove filter"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Main FilterBuilder ───────────────────────────────────────────────────────

let _idCounter = 0
function uid() { return `fb_${++_idCounter}_${Math.random().toString(36).slice(2, 6)}` }

export function FilterBuilder({
  fields       = [],
  records      = [],
  getFieldValue,
  conditions   = [],
  onChange,
  label        = 'Add filter',
}) {
  const [open, setOpen] = useState(false)

  // Derive unique values per field from records
  const uniqueValues = useMemo(() => {
    const map = {}
    for (const field of fields) {
      const vals = new Set()
      for (const rec of records) {
        const v = getFieldValue ? getFieldValue(rec)?.[field.key] : rec[field.key]
        if (v != null && v !== '') vals.add(String(v))
      }
      map[field.key] = [...vals].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }
    return map
  }, [fields, records, getFieldValue])

  function addCondition() {
    const first = fields[0]
    onChange([
      ...conditions,
      { id: uid(), field: first?.key ?? '', op: defaultOpForType(first?.type), value: '' },
    ])
  }

  function removeCondition(id) {
    onChange(conditions.filter(c => c.id !== id))
  }

  function updateCondition(id, updated) {
    onChange(conditions.map(c => c.id === id ? updated : c))
  }

  function clearAll() {
    onChange([])
  }

  // Active = conditions that are fully filled in
  const activeCount = conditions.filter(c =>
    c.field && c.op && (NO_VALUE_OPS.has(c.op) || (c.value ?? '') !== '')
  ).length

  return (
    <div className="flex flex-col gap-2">
      {/* Trigger row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all"
          style={{
            background:  activeCount > 0 ? 'var(--accent-dim)' : 'var(--bg-input)',
            border:      `1px solid ${activeCount > 0 ? 'var(--accent-soft)' : 'var(--card-border)'}`,
            color:       activeCount > 0 ? 'var(--accent)' : 'var(--text-2)',
            boxShadow:   open ? '0 0 0 2px var(--accent-glow)' : 'none',
          }}
        >
          <SlidersHorizontal size={12} style={{ flexShrink: 0 }} />
          <span>{activeCount > 0 ? `Filters (${activeCount})` : label}</span>
          <ChevronDown size={10} className="opacity-50"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-xs rounded-lg px-2 py-1.5 transition-colors"
            style={{ color: 'var(--text-3)', background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}
          >
            <X size={10} />
            <span>Clear filters</span>
          </button>
        )}
      </div>

      {/* Condition rows */}
      {open && (
        <div
          className="flex flex-col gap-2.5 p-3 rounded-xl animate-slide-down"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
        >
          {conditions.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              No filters yet — click <strong>+ Add filter</strong> to begin.
            </p>
          )}

          {conditions.map(cond => (
            <ConditionRow
              key={cond.id}
              condition={cond}
              fields={fields}
              uniqueValues={uniqueValues}
              onChange={updated => updateCondition(cond.id, updated)}
              onRemove={() => removeCondition(cond.id)}
            />
          ))}

          <button
            type="button"
            onClick={addCondition}
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 w-fit transition-all"
            style={{
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            <Plus size={12} />
            Add filter
          </button>
        </div>
      )}
    </div>
  )
}
