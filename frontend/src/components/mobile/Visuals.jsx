/**
 * The phone layout's small visuals (≤640px): mini charts for the summary
 * cards, client avatars, status pills, sticky list sections, row-shaped
 * skeletons and empty states.
 *
 * Charts are inline SVG, a few dozen elements each: no chart library on the
 * phone path. Every chart is one role="img" with a one-line aria-label, and
 * its figures are also in a visually hidden list, so a screen reader can read
 * the numbers rather than a shape. Colours are the palette tokens only
 * (accent, chart-1…6, fin-*), so every theme and dark mode carry over.
 */
import { useId } from 'react'
import clsx from 'clsx'
import { formatInr } from '../../utils/format'

/* ── Formatting ───────────────────────────────────────────────────────── */

const inr = (n) => formatInr(Math.round(Number(n) || 0))
const count = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-IN')} ${Number(n) === 1 ? one : many}`

/* ── Sparkline ────────────────────────────────────────────────────────── */

/**
 * A trend line over a few points: points [{ label, value }]. The last point
 * is marked; `format` writes a value for the hidden list and the summary.
 */
export function Sparkline({ points, title, format = inr, height = 40 }) {
  const id = useId()
  const list = (points || []).filter(p => p && Number.isFinite(Number(p.value)))
  if (list.length < 2) return null
  const w = 100
  const values = list.map(p => Number(p.value))
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pad = 4
  const x = (i) => (i / (list.length - 1)) * w
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${w},${height} L0,${height} Z`
  const last = values[values.length - 1]
  const first = values[0]
  const trend = last > first ? 'up' : last < first ? 'down' : 'flat'
  const summary = `${title}: ${format(last)} in ${list[list.length - 1].label}, ${trend} from ${format(first)} in ${list[0].label}`
  return (
    <figure className="m-chart m-spark">
      <figcaption className="m-chart-cap">
        <span>{title}</span>
        <span className="m-chart-figure"><span className="m-chart-when">{list[list.length - 1].label}</span> {format(last)}</span>
      </figcaption>
      <div className="m-spark-plot" style={{ height }}>
        <svg role="img" aria-label={summary} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none"
          width="100%" height={height} className="m-spark-svg" aria-describedby={id}>
          <path d={area} className="m-spark-area" />
          <path d={line} className="m-spark-line" vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        <span className="m-spark-dot" aria-hidden="true" style={{ top: `${(y(last) / height) * 100}%` }} />
      </div>
      <div className="m-chart-axis" aria-hidden="true">
        {list.map((p, i) => <span key={p.label + i}>{p.label}</span>)}
      </div>
      <ul id={id} className="sr-only">
        {list.map((p, i) => <li key={p.label + i}>{p.label}: {format(p.value)}</li>)}
      </ul>
    </figure>
  )
}

/* ── Aging bars ───────────────────────────────────────────────────────── */

/**
 * Pending invoices by age: buckets [{ key, label, count, amount, href }].
 * Each bar is a button; tapping it calls onSelect(bucket) (the list filtered
 * to that age). Bar heights follow the amount; the hot buckets warm up.
 */
const BUCKET_TONE = ['var(--accent)', 'var(--fin-warning)', 'var(--fin-negative)', 'var(--fin-negative)']

export function AgingBars({ buckets, onSelect, title = 'Pending by age (days)' }) {
  const list = buckets || []
  if (!list.length) return null
  const max = Math.max(...list.map(b => Number(b.amount) || 0), 1)
  const total = list.reduce((s, b) => s + (Number(b.count) || 0), 0)
  return (
    <div className="m-chart m-aging" role="group" aria-label={`${title}: ${count(total, 'pending invoice')}`}>
      <p className="m-chart-cap"><span>{title}</span></p>
      <div className="m-aging-row">
        {list.map((b, i) => {
          const amount = Number(b.amount) || 0
          const pct = amount > 0 ? Math.max(8, (amount / max) * 100) : 0
          return (
            <button
              key={b.key}
              type="button"
              className="m-aging-bar"
              disabled={!b.count}
              onClick={() => onSelect?.(b)}
              aria-label={`${b.label} days: ${count(b.count, 'invoice')}, ${inr(amount)}${b.count ? '. Show them' : ''}`}
            >
              <span className="m-aging-track" aria-hidden="true">
                <span className="m-aging-fill" style={{ height: `${pct}%`, background: BUCKET_TONE[i] || 'var(--accent)' }} />
              </span>
              <span className="m-aging-label" aria-hidden="true">{b.label}</span>
              <span className="m-aging-count" aria-hidden="true">{Number(b.count || 0).toLocaleString('en-IN')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Column bars (a few months) ───────────────────────────────────────── */

/** Small columns over a few periods: bars [{ label, value }]. */
export function MiniBars({ bars, title, format = inr, height = 44 }) {
  const id = useId()
  const list = (bars || []).filter(b => b && Number.isFinite(Number(b.value)))
  if (!list.length) return null
  const max = Math.max(...list.map(b => Number(b.value)), 1)
  const last = list[list.length - 1]
  return (
    <figure className="m-chart m-bars">
      <figcaption className="m-chart-cap">
        <span>{title}</span>
        <span className="m-chart-figure"><span className="m-chart-when">{last.label}</span> {format(last.value)}</span>
      </figcaption>
      <div role="img" aria-label={`${title}: ${list.map(b => `${b.label} ${format(b.value)}`).join(', ')}`}
        aria-describedby={id} className="m-bars-row" style={{ height }}>
        {list.map((b, i) => (
          <span key={b.label + i} className={clsx('m-bars-col', i === list.length - 1 && 'is-last')}
            style={{ height: `${Number(b.value) > 0 ? Math.max(6, (Number(b.value) / max) * 100) : 2}%` }} />
        ))}
      </div>
      <div className="m-chart-axis" aria-hidden="true">
        {list.map((b, i) => <span key={b.label + i}>{b.label}</span>)}
      </div>
      <ul id={id} className="sr-only">
        {list.map((b, i) => <li key={b.label + i}>{b.label}: {format(b.value)}</li>)}
      </ul>
    </figure>
  )
}

/* ── Share bar ────────────────────────────────────────────────────────── */

/** One bar split into parts: parts [{ key, label, value, tone }], with a legend. */
export function ShareBar({ parts, title }) {
  const list = (parts || []).filter(p => Number(p.value) > 0)
  const total = list.reduce((s, p) => s + Number(p.value), 0)
  if (!total) return null
  const summary = `${title}: ${list.map(p => `${p.label} ${p.value}`).join(', ')}`
  return (
    <div className="m-chart m-share">
      <p className="m-chart-cap"><span>{title}</span></p>
      <div className="m-share-bar" role="img" aria-label={summary}>
        {list.map(p => (
          <span key={p.key} style={{ flexGrow: Number(p.value), background: p.tone }} />
        ))}
      </div>
      <ul className="m-share-legend">
        {list.map(p => (
          <li key={p.key}>
            <span className="m-share-swatch" style={{ background: p.tone }} aria-hidden="true" />
            {p.label} <strong>{Number(p.value).toLocaleString('en-IN')}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Avatars ──────────────────────────────────────────────────────────── */

export const AVATAR_TONES = 6

/** A stable palette slot (1–6) for a name: the same client is always the same colour. */
export function avatarSlot(name) {
  const key = String(name || '').trim().toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % AVATAR_TONES) + 1
}

/** Up to two initials: "Birla Open Minds" -> "BO", "innovine" -> "IN". */
export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Initials on the client's palette colour. Decorative: the name is in the row. */
export function Avatar({ name, size = 32 }) {
  const known = !!String(name || '').replace(/[^\p{L}\p{N}]/gu, '')
  const slot = known ? avatarSlot(name) : 0
  return (
    <span className="m-avatar" aria-hidden="true" data-slot={slot}
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.4),
        background: known ? `var(--chart-${slot})` : 'var(--bg-2)', color: known ? undefined : 'var(--text-3)',
      }}>
      {initials(name)}
    </span>
  )
}

/* ── Status pills ─────────────────────────────────────────────────────── */

/** A small coloured word: tone positive | warning | negative | neutral. */
export function StatusPill({ tone = 'neutral', children, label }) {
  if (!label || label === children) return <span className={clsx('m-pill', `is-${tone}`)}>{children}</span>
  return (
    <span className={clsx('m-pill', `is-${tone}`)}>
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * An invoice's pill: Paid; Pending with its age; Overdue (pending past
 * `overdueDays`) with its age; Cancelled. { tone, text, label }
 */
export function invoicePill(status, aging, overdueDays = 30) {
  const days = Math.max(0, Math.round(Number(aging) || 0))
  if (status === 'Paid') return { tone: 'positive', text: 'Paid', label: 'Paid' }
  if (status === 'Pending') {
    return days > overdueDays
      ? { tone: 'negative', text: `Overdue · ${days}d`, label: `Overdue, ${count(days, 'day')}` }
      : { tone: 'warning', text: `Pending · ${days}d`, label: `Pending, ${count(days, 'day')}` }
  }
  if (status === 'Cancelled') return { tone: 'neutral', text: 'Cancelled', label: 'Cancelled' }
  return { tone: 'neutral', text: status || 'No status', label: status || 'No status' }
}

/* ── Sticky sections ──────────────────────────────────────────────────── */

/**
 * A titled run of rows whose header sticks under the large title while its
 * rows scroll: "Overdue · 3 · ₹3,45,600". `count` and `total` are the whole
 * section's (from the server's totals), not just the rows loaded so far.
 */
export function ListSection({ title, count: n, total, children }) {
  const id = useId()
  const parts = [title, n != null ? Number(n).toLocaleString('en-IN') : null, total != null ? inr(total) : null].filter(p => p != null)
  return (
    <section className="m-section" aria-labelledby={id}>
      <h3 id={id} className="m-section-head">
        {parts.map((p, i) => (
          <span key={i} className={i === 0 ? 'm-section-title' : 'm-section-figure'}>{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>
        ))}
      </h3>
      <ul className="m-group-list" role="list">{children}</ul>
    </section>
  )
}

/**
 * Rows split into consecutive runs by `keyOf(row)`, in list order (a section
 * never repeats or reorders the list). Returns [{ key, rows }].
 */
export function sectionRuns(rows, keyOf) {
  const out = []
  for (const r of rows || []) {
    const key = keyOf(r)
    const last = out[out.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else out.push({ key, rows: [r] })
  }
  return out
}

/* ── Skeletons and empty states ───────────────────────────────────────── */

/** Placeholder rows shaped like the real ones: an avatar, two lines, a value and a pill. */
export function RowSkeletons({ count: n = 5, avatar = true, pill = true }) {
  return Array.from({ length: n }).map((_, i) => (
    <li key={i} className="m-row-item" aria-hidden="true">
      <div className="m-row is-static">
        {avatar && <span className="m-row-lead"><span className="skeleton m-skel-avatar" /></span>}
        <span className="m-row-text">
          <span className="skeleton m-skel-line" style={{ width: `${62 - (i % 3) * 9}%` }} />
          <span className="skeleton m-skel-line is-meta" style={{ width: `${44 - (i % 2) * 8}%` }} />
        </span>
        <span className="m-row-trail is-stacked">
          <span className="skeleton m-skel-value" />
          {pill && <span className="skeleton m-skel-pill" />}
        </span>
      </div>
    </li>
  ))
}

/* ── Series helpers ───────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The last `n` calendar months ending with `today`'s, oldest first, each
 * valued from `rows` ([{ key: 'YYYY-MM', ... }]) by `valueOf`; a month with
 * no row is 0. [{ key, label, value }]
 */
export function monthSeries(rows, valueOf, n = 6, today = new Date()) {
  const byKey = new Map((rows || []).map(r => [r.key, r]))
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (n - 1 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const row = byKey.get(key)
    return { key, label: MONTHS[d.getMonth()], value: row ? Number(valueOf(row)) || 0 : 0 }
  })
}

/** An empty list: an icon in a soft circle, a line in bold, a sentence and an optional action. */
export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <li className="m-empty">
      {Icon && <span className="m-empty-icon" aria-hidden="true"><Icon size={22} /></span>}
      <strong>{title}</strong>
      {children}
      {action && <div>{action}</div>}
    </li>
  )
}
