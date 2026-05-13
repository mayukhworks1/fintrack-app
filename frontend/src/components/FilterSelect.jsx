/**
 * FilterSelect / FilterMulti
 * ─────────────────────────
 * Portal-based dropdown filters with inline autocomplete search.
 *
 * FilterSelect  — single-value picker
 * FilterMulti   — multi-value picker (checkbox list)
 *
 * Both open upward automatically when they'd overflow the viewport bottom.
 * Keyboard: Escape closes, Arrow keys navigate list, Enter selects.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X, Search, Check } from 'lucide-react'

// ─── helpers ─────────────────────────────────────────────────────────────────
function normalise(options) {
  return options.map(o =>
    o == null           ? { value: '', label: '' }
    : typeof o === 'string' ? { value: o,       label: o }
    : Array.isArray(o)  ? { value: o[0],   label: o[1] ?? o[0] }
    : o                               // already { value, label }
  )
}

const DROP_MAX_H = 228  // px — max height of options list

function useDropPos(btnRef, width) {
  const [pos, setPos] = useState(null)

  const compute = useCallback(() => {
    if (!btnRef.current) return
    const r   = btnRef.current.getBoundingClientRect()
    const w   = Math.max(r.width, width)
    const spaceBelow = window.innerHeight - r.bottom - 8
    const openAbove  = spaceBelow < DROP_MAX_H + 60 && r.top > DROP_MAX_H + 60
    // clamp left so dropdown never goes off-screen right
    const left = Math.min(r.left, window.innerWidth - w - 8)
    setPos({
      top:      openAbove ? null : r.bottom + 4,
      bottom:   openAbove ? window.innerHeight - r.top + 4 : null,
      left:     Math.max(8, left),
      minWidth: w,
    })
  }, [btnRef, width])

  return [pos, compute]
}

// ─── single-value FilterSelect ───────────────────────────────────────────────
export function FilterSelect({
  value,
  onChange,
  options      = [],
  placeholder  = 'All',
  label,            // optional label shown ABOVE the button
  icon: Icon,       // optional leading icon
  width        = 160,
  clearable    = true,
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(-1)   // keyboard-focused option index

  const btnRef    = useRef(null)
  const searchRef = useRef(null)
  const listRef   = useRef(null)
  const dropRef   = useRef(null)
  const [pos, computePos] = useDropPos(btnRef, width)

  const opts     = normalise(options)
  const selected = opts.find(o => o.value === value)
  const filtered = query.trim()
    ? opts.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : opts

  function openDrop() {
    computePos()
    setOpen(true)
    setQuery('')
    setFocus(-1)
    setTimeout(() => searchRef.current?.focus(), 30)
  }
  function closeDrop() { setOpen(false); setQuery(''); setFocus(-1) }
  function pick(v)     { onChange(v); closeDrop() }

  // close on outside click
  useEffect(() => {
    if (!open) return
    const h = e => {
      if (!dropRef.current?.contains(e.target) && !btnRef.current?.contains(e.target))
        closeDrop()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // keyboard nav in search box
  function onSearchKey(e) {
    if (e.key === 'Escape')    { closeDrop(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(f => Math.min(f + 1, filtered.length - 1)); scrollToFocus(focus + 1) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocus(f => Math.max(f - 1, -1)); scrollToFocus(focus - 1) }
    if (e.key === 'Enter' && focus >= 0) pick(filtered[focus]?.value ?? '')
    else if (e.key === 'Enter' && filtered.length === 1) pick(filtered[0].value)
  }

  function scrollToFocus(idx) {
    const el = listRef.current?.children[idx + (clearable ? 1 : 0)]
    el?.scrollIntoView({ block: 'nearest' })
  }

  const hasValue = value !== '' && value != null

  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-wide select-none"
          style={{ color: 'var(--text-3)' }}>
          {label}
        </span>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={open ? closeDrop : openDrop}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all"
        style={{
          background:   hasValue ? 'var(--accent-dim)'  : 'var(--bg-input)',
          border:       `1px solid ${hasValue ? 'var(--accent-soft)' : 'var(--card-border)'}`,
          color:        hasValue ? 'var(--accent)'       : 'var(--text-2)',
          minWidth:     width,
          whiteSpace:   'nowrap',
          boxShadow:    open ? '0 0 0 2px var(--accent-glow)' : 'none',
        }}
      >
        {Icon && (
          <Icon size={11} style={{ color: hasValue ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }} />
        )}
        <span className="truncate flex-1 text-left">
          {selected?.label ?? placeholder}
        </span>
        {hasValue && clearable
          ? <span role="button" aria-label="Clear"
              onClick={e => { e.stopPropagation(); onChange('') }}
              className="flex-shrink-0 rounded-full p-0.5 hover:bg-black/10">
              <X size={10} />
            </span>
          : <ChevronDown size={10} className="flex-shrink-0 opacity-50"
              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        }
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
            maxWidth: 'min(320px, calc(100vw - 16px))',
            zIndex:   9999,
            background:   'var(--card-bg)',
            border:       '1px solid var(--card-border)',
            borderRadius: 12,
            boxShadow:    '0 8px 32px rgba(0,0,0,0.16)',
            overflow:     'hidden',
          }}
        >
          {/* search */}
          <div className="relative" style={{ borderBottom: '1px solid var(--card-border)' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setFocus(-1) }}
              onKeyDown={onSearchKey}
              placeholder="Search…"
              className="w-full pl-8 pr-8 py-2.5 text-xs outline-none bg-transparent"
              style={{ color: 'var(--text-1)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); searchRef.current?.focus() }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center"
                style={{ color: 'var(--text-3)' }}>
                <X size={10} />
              </button>
            )}
          </div>

          {/* options */}
          <div ref={listRef} style={{ maxHeight: DROP_MAX_H, overflowY: 'auto' }}>
            {clearable && (
              <button type="button" onClick={() => pick('')}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                style={{
                  color:      !hasValue ? 'var(--accent)' : 'var(--text-3)',
                  background: !hasValue ? 'var(--accent-dim)' : 'transparent',
                  fontWeight: !hasValue ? 600 : 400,
                }}>
                <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                  {!hasValue && <Check size={9} />}
                </span>
                <span className="italic">{placeholder}</span>
              </button>
            )}
            {filtered.length === 0
              ? <p className="px-3 py-5 text-xs text-center" style={{ color: 'var(--text-3)' }}>No results</p>
              : filtered.map((opt, i) => {
                  const active = opt.value === value
                  const kbd    = i === focus
                  return (
                    <button key={opt.value} type="button" onClick={() => pick(opt.value)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
                      style={{
                        color:      active ? 'var(--accent)'    : 'var(--text-1)',
                        background: kbd    ? 'var(--bg-layer)'  : active ? 'var(--accent-dim)' : 'transparent',
                        fontWeight: active ? 600 : 400,
                      }}
                      onMouseEnter={() => setFocus(i)}
                      onMouseLeave={() => setFocus(-1)}>
                      <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
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
    </div>
  )
}

// ─── multi-value FilterMulti ─────────────────────────────────────────────────
export function FilterMulti({
  selected = [],
  onChange,
  options      = [],
  placeholder  = 'Any',
  label,
  icon: Icon,
  width        = 160,
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(-1)

  const btnRef    = useRef(null)
  const searchRef = useRef(null)
  const listRef   = useRef(null)
  const dropRef   = useRef(null)
  const [pos, computePos] = useDropPos(btnRef, width)

  const opts     = normalise(options)
  const filtered = query.trim()
    ? opts.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : opts

  function openDrop() {
    computePos()
    setOpen(true)
    setQuery('')
    setFocus(-1)
    setTimeout(() => searchRef.current?.focus(), 30)
  }
  function closeDrop() { setOpen(false); setQuery(''); setFocus(-1) }
  function toggle(v) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }

  useEffect(() => {
    if (!open) return
    const h = e => {
      if (!dropRef.current?.contains(e.target) && !btnRef.current?.contains(e.target))
        closeDrop()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function onSearchKey(e) {
    if (e.key === 'Escape')    { closeDrop(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(f => Math.min(f + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocus(f => Math.max(f - 1, 0)) }
    if (e.key === 'Enter' && focus >= 0) toggle(filtered[focus]?.value)
  }

  const hasValue   = selected.length > 0
  const displayLbl = !hasValue ? placeholder
    : selected.length === 1 ? (opts.find(o => o.value === selected[0])?.label ?? selected[0])
    : `${selected.length} selected`

  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-wide select-none"
          style={{ color: 'var(--text-3)' }}>
          {label}
        </span>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={open ? closeDrop : openDrop}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all"
        style={{
          background:   hasValue ? 'var(--accent-dim)'  : 'var(--bg-input)',
          border:       `1px solid ${hasValue ? 'var(--accent-soft)' : 'var(--card-border)'}`,
          color:        hasValue ? 'var(--accent)'       : 'var(--text-2)',
          minWidth:     width,
          whiteSpace:   'nowrap',
          boxShadow:    open ? '0 0 0 2px var(--accent-glow)' : 'none',
        }}
      >
        {Icon && (
          <Icon size={11} style={{ color: hasValue ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }} />
        )}
        <span className="truncate flex-1 text-left">{displayLbl}</span>
        {hasValue
          ? <span role="button" aria-label="Clear all"
              onClick={e => { e.stopPropagation(); onChange([]) }}
              className="flex-shrink-0 rounded-full p-0.5 hover:bg-black/10">
              <X size={10} />
            </span>
          : <ChevronDown size={10} className="flex-shrink-0 opacity-50"
              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        }
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
            maxWidth: 'min(320px, calc(100vw - 16px))',
            zIndex:   9999,
            background:   'var(--card-bg)',
            border:       '1px solid var(--card-border)',
            borderRadius: 12,
            boxShadow:    '0 8px 32px rgba(0,0,0,0.16)',
            overflow:     'hidden',
          }}
        >
          {/* search */}
          <div className="relative" style={{ borderBottom: '1px solid var(--card-border)' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setFocus(-1) }}
              onKeyDown={onSearchKey}
              placeholder="Search…"
              className="w-full pl-8 pr-3 py-2.5 text-xs outline-none bg-transparent"
              style={{ color: 'var(--text-1)' }}
            />
          </div>

          {/* options */}
          <div ref={listRef} style={{ maxHeight: DROP_MAX_H, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <p className="px-3 py-5 text-xs text-center" style={{ color: 'var(--text-3)' }}>No results</p>
              : filtered.map((opt, i) => {
                  const checked = selected.includes(opt.value)
                  const kbd     = i === focus
                  return (
                    <button key={opt.value} type="button" onClick={() => toggle(opt.value)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
                      style={{
                        color:      'var(--text-1)',
                        background: kbd ? 'var(--bg-layer)' : checked ? 'rgba(37,99,235,0.06)' : 'transparent',
                        fontWeight: checked ? 600 : 400,
                      }}
                      onMouseEnter={() => setFocus(i)}
                      onMouseLeave={() => setFocus(-1)}>
                      <span
                        className="w-3.5 h-3.5 flex items-center justify-center rounded flex-shrink-0"
                        style={{
                          background: checked ? 'var(--accent)' : 'transparent',
                          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--card-border)'}`,
                        }}>
                        {checked && <Check size={9} className="text-white" />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  )
                })
            }
          </div>

          {hasValue && (
            <div style={{ borderTop: '1px solid var(--card-border)' }}
              className="flex items-center justify-between px-3 py-2">
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                {selected.length} selected
              </span>
              <button type="button" onClick={() => { onChange([]); closeDrop() }}
                className="text-[11px] font-medium"
                style={{ color: 'var(--accent)' }}>
                Clear all
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
