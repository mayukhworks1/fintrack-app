/**
 * Phone building blocks (≤640px): the large-title header's action slot, the
 * summary card with its progress ring, the segmented control, grouped inset
 * lists, the inline "add" row and the action sheet.
 *
 * Every page that uses these renders them only while usePhone() is true, so
 * tablet and desktop never see them. Colours come from the palette tokens
 * (accent, card, text levels); the styles live in styles/app-mobile.css,
 * inside the phone media query.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ChevronDown, RefreshCw, Search, X, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import Modal from '../Modal'
import { prefersReducedMotion, useReducedMotion } from '../../hooks/useReducedMotion'
import { RowSkeletons, StatusPill } from './Visuals'

/** The phone breakpoint: the same 640px edge the rest of the app uses. */
export const PHONE_QUERY = '(max-width: 640px)'

/** True on a phone-sized viewport. */
export function usePhone() {
  return useMediaQuery(PHONE_QUERY)
}

/**
 * The on-screen keyboard, read from the visual viewport. iOS (Safari and
 * Chrome, both WebKit) lays the keyboard over the page instead of resizing
 * it, so anything pinned to the bottom would float mid-screen or hide the
 * field being typed in. While the keyboard is up, <html> carries `kb-open`
 * (the tab bars hide) and --kb-inset holds its height.
 */
export const KEYBOARD_MIN_PX = 120

export function keyboardInset(win = window) {
  const vv = win.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop))
}

export function useKeyboardWatch(enabled = true) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || !vv) return undefined
    const root = document.documentElement
    const update = () => {
      const inset = keyboardInset()
      root.style.setProperty('--kb-inset', `${inset}px`)
      root.classList.toggle('kb-open', inset > KEYBOARD_MIN_PX)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.classList.remove('kb-open')
      root.style.removeProperty('--kb-inset')
    }
  }, [enabled])
}

/**
 * Parts of a row's second line, joined the way the reference does: " · ".
 * Empty parts are dropped, and so is a part that repeats the one before it
 * (a client and a project of the same name read once).
 */
export function joinMeta(parts) {
  return (parts || [])
    .map(p => (typeof p === 'string' ? p.trim() : p))
    .filter(p => p !== '' && p != null && p !== false && p !== '—')
    .filter((p, i, all) => i === 0 || String(p).toLowerCase() !== String(all[i - 1]).toLowerCase())
    .join(' · ')
}

/* ── Header action slot ──────────────────────────────────────────────────
 * The layout's large-title header owns a slot for the page's own icon
 * actions (add, filters, more). A page fills it with <HeaderActions>. */
// Outside the app layout (the web module has its own shell) there is no
// header, so the actions sit at the top of the page instead.
export const HeaderSlotContext = createContext('inline')

export function HeaderActions({ children }) {
  const slot = useContext(HeaderSlotContext)
  if (slot === 'inline') return <div className="m-inline-actions">{children}</div>
  if (!slot) return null
  return createPortal(children, slot)
}

/**
 * The large title inside a page, for shells without the app header (the web
 * module): a quiet context line over a big bold title, actions on the right.
 */
export function InlineLargeTitle({ context, title, children }) {
  return (
    <div className="m-inline-title">
      <div className="m-titlebar-text">
        {context && <p className="m-titlebar-context">{context}</p>}
        <h1 className="m-titlebar-title">{title}</h1>
      </div>
      {children && <div className="m-titlebar-actions">{children}</div>}
    </div>
  )
}

/** A small round icon button for the header (and for card corners). */
export function RoundIconButton({ icon: Icon, label, onClick, badge = false, active = false, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx('m-round-btn', active && 'is-active')}
      {...rest}
    >
      <Icon size={18} aria-hidden="true" />
      {badge && <span className="m-round-dot" aria-hidden="true" />}
    </button>
  )
}

/* ── Summary card ────────────────────────────────────────────────────────── */

/**
 * A ring that fills to `value` percent (0–100), the percentage in its middle.
 * It sweeps up from empty when it first has a value; with reduced motion it
 * is drawn at its value straight away.
 */
export function ProgressRing({ value, size = 56, stroke = 5, label }) {
  const v = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? v : 0)
  useEffect(() => {
    if (reduced) { setShown(v); return undefined }
    // One frame at the old value, then the target, so the CSS transition runs.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
    const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout
    const id = raf(() => setShown(v))
    return () => cancel(id)
  }, [v, reduced])
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span className="m-ring" style={{ width: size, height: size }} role="img" aria-label={label || `${Math.round(v)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="m-ring-track" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="m-ring-fill"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="m-ring-value" aria-hidden="true">{Math.round(v)}%</span>
    </span>
  )
}

/**
 * One card: a ring and a plain-language sentence, in place of KPI tiles.
 * `title` is the short headline ("80% collected"), `sentence` the line under it.
 * `visual` (mini charts) sits full width under them.
 */
export function SummaryCard({ value, ringLabel, title, sentence, loading = false, children, visual }) {
  return (
    <section className="m-summary" aria-label="Summary" aria-busy={loading || undefined}>
      <ProgressRing value={loading ? 0 : value} label={ringLabel} />
      <div className="m-summary-text">
        <p className="m-summary-title">{loading ? 'Loading…' : title}</p>
        {sentence && !loading && <p className="m-summary-sentence">{sentence}</p>}
      </div>
      {children}
      {visual && !loading && <div className="m-summary-visual">{visual}</div>}
    </section>
  )
}

/* ── Segmented control ───────────────────────────────────────────────────── */

/**
 * 2–4 options for the primary split. A radio group: arrow keys move the
 * choice, only the chosen option is a Tab stop. `value` may match no option
 * (a mix of filters the segments do not describe); then none is chosen.
 */
export function SegmentedControl({ label, options, value, onChange }) {
  const refs = useRef([])
  const current = options.findIndex(o => o.value === value)
  const move = (i) => {
    const next = (i + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div className="m-segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = i === current
        return (
          <button
            key={o.value}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1}
            className={clsx('m-segment', on && 'is-on')}
            onClick={() => onChange(o.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) }
            }}
          >
            {o.label}
            {o.count != null && <span className="sr-only">, {o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ── Grouped, inset, rounded lists ─────────────────────────────────────── */

export function GroupedList({ title, action, children, label }) {
  const id = useId()
  return (
    <section className="m-group" aria-labelledby={title ? id : undefined} aria-label={title ? undefined : label}>
      {(title || action) && (
        <div className="m-group-head">
          {title && <h2 id={id}>{title}</h2>}
          {action}
        </div>
      )}
      <ul className="m-group-list" role="list">{children}</ul>
    </section>
  )
}

/**
 * A row: an optional leading control, a one-line title, one quiet line of
 * metadata and a small trailing value or status dot. Tapping it opens the
 * row's detail; details never live in the row.
 */
export function ListRow({
  title, meta, value, valueTone, dot, dotLabel, leading, onClick, href, ariaLabel,
  strike = false, mono = false, className, accessory, pill,
}) {
  const metaText = Array.isArray(meta) ? joinMeta(meta) : meta
  const body = (
    <>
      {leading && <span className="m-row-lead">{leading}</span>}
      <span className="m-row-text">
        <span className={clsx('m-row-title', strike && 'is-done', mono && 'is-mono')}>{title}</span>
        {metaText && <span className="m-row-meta">{metaText}</span>}
      </span>
      {(value != null || dot || pill) && (
        <span className={clsx('m-row-trail', pill && 'is-stacked')}>
          {value != null && <span className="m-row-value" style={valueTone ? { color: valueTone } : undefined}>{value}</span>}
          {pill && <StatusPill tone={pill.tone} label={pill.label}>{pill.text}</StatusPill>}
          {dot && !pill && (
            <span className="m-row-dot" style={{ background: dot }} role={dotLabel ? 'img' : undefined}
              aria-label={dotLabel} aria-hidden={dotLabel ? undefined : 'true'} />
          )}
        </span>
      )}
    </>
  )
  return (
    <li className={clsx('m-row-item', accessory && 'has-accessory', className)}>
      {href
        ? <a className="m-row" href={href} aria-label={ariaLabel}>{body}</a>
        : onClick
          ? <button type="button" className="m-row" onClick={onClick} aria-label={ariaLabel}>{body}</button>
          : <div className="m-row is-static">{body}</div>}
      {accessory}
    </li>
  )
}

/** Placeholder rows while the first answer is on its way, shaped like the rows. */
export function SkeletonRows({ count = 5, avatar = false, pill = false }) {
  return <RowSkeletons count={count} avatar={avatar} pill={pill} />
}

/** The primary create action, as a row in the content: "+ New invoice". */
export function InlineAddRow({ label, onClick, disabled = false }) {
  return (
    <div className="m-add">
      <button type="button" className="m-add-row" onClick={onClick} disabled={disabled}>
        <span className="m-add-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.5} /></span>
        <span>{label}</span>
      </button>
    </div>
  )
}

/** "Showing 50 of 120" and the button for the next page. */
export function ShowMoreRow({ shown, total, onMore, loading = false, hasMore = false, step = 50 }) {
  return (
    <div className="m-more" aria-live="polite">
      <span>Showing {Number(shown).toLocaleString('en-IN')} of {Number(total).toLocaleString('en-IN')}</span>
      {hasMore && (
        <button type="button" className="m-more-btn" onClick={onMore} disabled={loading}>
          {loading ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {loading ? 'Loading…' : `Show ${Math.min(step, Math.max(0, total - shown))} more`}
        </button>
      )}
    </div>
  )
}

/**
 * Search and the Filters button: the secondary filters live in a sheet, so
 * the bar stays one line at any phone width.
 */
export function SearchFilterBar({ value, onChange, onSubmit, label, placeholder, filterCount = 0, onFilters, filtersOpen = false }) {
  return (
    <div className="m-toolbar" role="search" aria-label={label}>
      <div className="m-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit?.() } }}
          aria-label={label}
          placeholder={placeholder}
          enterKeyHint="search"
        />
        {value && (
          <button type="button" className="m-search-clear" onClick={() => onChange('')} aria-label="Clear search">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {onFilters && (
        <button
          type="button"
          className={clsx('m-filter-btn', filterCount > 0 && 'is-active')}
          onClick={onFilters}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          aria-label={filterCount ? `Filters, ${filterCount} applied` : 'Filters'}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>Filters</span>
          {filterCount > 0 && <span className="m-filter-count" aria-hidden="true">{filterCount}</span>}
        </button>
      )}
    </div>
  )
}

/** The filters in force, each one tap to remove. chips: [{ key, label, onClear }] */
export function AppliedFilters({ chips }) {
  if (!chips?.length) return null
  return (
    <div className="m-applied" aria-label="Applied filters">
      {chips.map(c => (
        <button key={c.key} type="button" onClick={c.onClear} aria-label={`Remove ${c.label}`}>
          <span>{c.label}</span><X size={13} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/* ── Sheets ───────────────────────────────────────────────────────────── */

/** A bottom sheet (Modal rises from the bottom on a phone). */
export function Sheet({ open, onClose, title, children, footer }) {
  // A field focused low in the sheet is brought into view once the keyboard
  // has risen (it takes ~250ms on iOS), rather than left under it.
  const onFocus = (e) => {
    const el = e.target
    if (!el?.matches?.('input, select, textarea')) return
    setTimeout(() => el.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 300)
  }
  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} width={560}>
      <div className="m-sheet-body" onFocus={onFocus}>{children}</div>
    </Modal>
  )
}

/**
 * The page's secondary actions (share, export, refresh…) as a list of rows.
 * actions: [{ label, icon, onClick, disabled, hint, tone }]; falsy entries are skipped.
 */
export function ActionSheet({ open, onClose, title = 'Actions', actions }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="m-group-list m-action-list" role="list">
        {actions.filter(Boolean).map(a => {
          const Icon = a.icon
          return (
            <li key={a.label} className="m-row-item">
              <button
                type="button"
                className="m-row"
                disabled={a.disabled}
                onClick={() => { if (!a.keepOpen) onClose(); a.onClick() }}
              >
                {Icon && <span className="m-row-lead m-action-icon" style={a.tone ? { color: a.tone } : undefined}><Icon size={17} aria-hidden="true" /></span>}
                <span className="m-row-text">
                  <span className="m-row-title">{a.label}</span>
                  {a.hint && <span className="m-row-meta">{a.hint}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

/** A labelled field inside the Filters sheet. */
export function SheetField({ label, children }) {
  return (
    <div className="m-field">
      <span className="m-field-label">{label}</span>
      {children}
    </div>
  )
}
