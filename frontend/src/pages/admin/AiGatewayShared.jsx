// Formatting, small atoms and route checks shared by the AI gateway panels.
import { cloneElement, isValidElement, useId } from 'react'
import { ArrowRight, AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react'
import { formatIst } from '../../utils/ist'

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export const MAX_ROUTE_STEPS = 10
export const MAX_PROMPT_CHARS = 20000
export const MAX_TEST_INPUT = 4000
export const MODEL_ID_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/

export const OUTPUT_BADGE = {
  json:   ['purple', 'JSON'],
  text:   ['blue', 'Text'],
  stream: ['teal', 'Stream'],
}

export const PERIODS = [['day', 'Today', 'Daily'], ['week', 'This week', 'Weekly'], ['month', 'This month', 'Monthly']]
export const METRICS = [['requests', 'Requests'], ['tokens', 'Tokens'], ['spend', 'Spend (USD)']]
export const PERIOD_LABEL = Object.fromEntries(PERIODS.map(([id, now]) => [id, now]))
export const PERIOD_ADJ = Object.fromEntries(PERIODS.map(([id, , adj]) => [id, adj]))
export const METRIC_LABEL = Object.fromEntries(METRICS)

export const STATUS_BADGE = {
  ok:       ['green', 'Answered'],
  failed:   ['red', 'Failed'],
  not_sent: ['amber', 'Not sent'],
}

// 12,34,567 — Indian digit grouping; '—' for a missing value.
export function num(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  return Number.isFinite(v) ? v.toLocaleString('en-IN') : '—'
}

// "$1.25" — estimated spend; small amounts keep their cents' fractions.
export function usd(n) {
  if (n == null || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`
}

// A limit's value in its own unit.
export function metricValue(metric, v) {
  return metric === 'spend' ? usd(v) : num(v)
}

// 131072 → "131K", 1000000 → "1M": compact token counts for dense rows.
export function compact(n) {
  if (n == null) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v >= 1e6) return `${+(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M`
  if (v >= 1e3) return `${+(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}K`
  return String(v)
}

// '' → null; a number ≥ 0 (decimals allowed) → that number; else NaN.
export function parseAmount(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  return Number(s)
}

// "12 of 100 calls" with a cap, "12 calls" without.
export function usage(used, cap, unit) {
  return cap != null ? `${num(used || 0)} of ${num(cap)} ${unit}` : `${num(used || 0)} ${unit}`
}

// "20 Oct 2026, 6:00 pm IST"
export const istStamp = (iso) => formatIst(iso) || '—'

// "15 Oct, 2:05:12 pm" in IST, for dense tables.
export function istShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

// Today's date in IST as YYYY-MM-DD.
export function istDay(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// YYYY-MM-DD moved by `delta` calendar days.
export function shiftDay(day, delta) {
  const t = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(t)) return day
  return new Date(t + delta * 86400000).toISOString().slice(0, 10)
}

// useId without its colons, so the id also works inside a CSS selector (datalist lookups).
export function useDomId() {
  return `gw${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

// '' → null (no cap), a whole number ≥ 1 → that number, anything else → NaN.
export function parseCap(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (!/^\d+$/.test(s)) return NaN
  const n = Number(s)
  return n >= 1 && Number.isSafeInteger(n) ? n : NaN
}

function hostOf(url) {
  try { return new URL(url).hostname } catch { return '' }
}

// The env key is only sent to the provider's own host (the server enforces it).
export function envKeyApplies(p) {
  return !p.default_base_url || hostOf(p.base_url) === hostOf(p.default_base_url)
}

// Why a provider has no key to call with; the server words it the same way.
export function missingKeyMessage(p) {
  if (p.key_unreadable) return "Stored key can't be read — set it again"
  if (!p.env_var) return 'No key set'
  if (!envKeyApplies(p)) return `No key saved for this base URL (${p.env_var} is only sent to ${hostOf(p.default_base_url)})`
  return `No key set (${p.env_var})`
}

export { hostOf }

export function keyBadge(p) {
  if (p.key_unreadable) return ['red', 'Key unreadable']
  if (p.key_source === 'stored') return ['green', 'Key set']
  if (p.key_source === 'env') return ['blue', 'From env']
  return ['amber', 'No key']
}

// Same checks the server runs for route_warnings, for a route still being edited.
export function localRouteWarnings(route, providers, catalog = []) {
  const byKey = Object.fromEntries((providers || []).map(p => [p.key, p]))
  const out = []
  route.forEach((step, index) => {
    const p = byKey[step.provider]
    if (!p) { out.push({ index, level: 'error', message: `Unknown provider ${step.provider}` }); return }
    if (p.key_source === 'none') out.push({ index, level: 'error', message: missingKeyMessage(p) })
    if (!p.enabled) out.push({ index, level: 'warn', message: 'Provider is off' })
    const model = String(step.model || '').trim()
    const offered = p.last_test?.ok && p.models?.length ? p.models.some(m => m.id === model) : true
    if (model && !offered) out.push({ index, level: 'error', message: `Not offered by ${p.label} — calls to it will fail` })
    const entry = catalog.find(c => c.provider === p.key && c.model === model)
    if (entry && !entry.enabled) out.push({ index, level: 'warn', message: 'Model is switched off in the catalogue' })
    const benched = p.benched || entry?.benched
    if (benched) out.push({ index, level: 'warn', bench: true, message: benched[0].toUpperCase() + benched.slice(1) })
  })
  return out
}

const TONES = {
  info:  { bg: 'var(--accent-dim)',  border: 'var(--accent-soft)',     fg: 'var(--accent)',       icon: Info },
  warn:  { bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', fg: 'var(--fin-warning)',  icon: AlertTriangle },
  error: { bg: 'var(--fin-neg-bg)',  border: 'var(--fin-neg-border)',  fg: 'var(--fin-negative)', icon: XCircle },
  ok:    { bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  fg: 'var(--fin-positive)', icon: CheckCircle2 },
}

export function Notice({ tone = 'info', children, className = '' }) {
  const t = TONES[tone] || TONES.info
  const Icon = t.icon
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${className}`}
      role={tone === 'error' ? 'alert' : undefined}
      style={{ background: t.bg, border: `1px solid ${t.border}`, color: 'var(--text-2)' }}>
      <Icon size={13} className="flex-shrink-0 mt-0.5" style={{ color: t.fg }} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Dot({ tone }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--bad)' : 'var(--text-3)'
  return <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
}

// The ids of a Field's error and hint, for the control's aria-describedby.
export function describedBy(htmlFor, { hint, error } = {}) {
  return [error && `${htmlFor}-error`, hint && `${htmlFor}-hint`].filter(Boolean).join(' ') || undefined
}

// Labelled form control: the label text, the control, then an optional error
// and hint. Both are tied to the control (aria-describedby) when it is the
// direct child with id={htmlFor}; a control wrapped in other markup sets
// aria-describedby itself, from describedBy().
export function Field({ label, hint, error, htmlFor, children, className = '' }) {
  const control = isValidElement(children) && children.props.id === htmlFor
    ? cloneElement(children, {
      'aria-describedby': describedBy(htmlFor, { hint, error }),
      'aria-invalid': error ? true : undefined,
    })
    : children
  return (
    <div className={`space-y-1 min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="label mb-0">{label}</label>
      {control}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-[11px] leading-relaxed" style={{ color: 'var(--fin-negative)' }}>
          {error}
        </p>
      )}
      {hint && <p id={`${htmlFor}-hint`} className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{children}</h3>
      {right}
    </div>
  )
}

function warningStyle(level) {
  return level === 'error'
    ? { background: 'var(--fin-neg-bg)', borderColor: 'var(--fin-neg-border)', color: 'var(--fin-negative)' }
    : { background: 'var(--fin-warn-bg)', borderColor: 'var(--fin-warn-border)', color: 'var(--fin-warning)' }
}

// Provider · model → Provider · model, with each step tinted by its worst warning.
// Steps appended from the global default chain are drawn dashed and marked.
export function RouteChain({ route, warnings = [], labels = {}, label = 'Route' }) {
  if (!route?.length) return <span className="text-xs" style={{ color: 'var(--text-3)' }}>No route</span>
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={label}>
      {route.map((step, i) => {
        const w = step.fallback ? [] : warnings.filter(x => x.index === i)
        const level = w.some(x => x.level === 'error') ? 'error' : w.length ? 'warn' : null
        const base = level ? warningStyle(level) : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-2)' }
        return (
          <li key={`${i}-${step.provider}-${step.model}`} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ArrowRight size={11} aria-hidden="true" style={{ color: 'var(--text-3)' }} />}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] max-w-full min-w-0"
              style={step.fallback ? { ...base, borderStyle: 'dashed', opacity: 0.8 } : base}
              title={step.fallback ? 'From the global default chain' : undefined}>
              <span className="font-semibold whitespace-nowrap">{labels[step.provider] || step.provider}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono truncate">{step.model}</span>
              {step.fallback && <span className="sr-only"> (default chain)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function barTone(pct) {
  if (pct >= 100) return 'var(--fin-negative)'
  if (pct >= 80) return 'var(--fin-warning)'
  return 'var(--accent)'
}

// One limit's usage: "Requests today · 40 of 200", with a bar that turns amber
// at 80% and red once reached.
export function LimitBar({ label, used, cap, metric, compactRow = false }) {
  const pct = cap ? Math.min(100, Math.round((100 * (used || 0)) / cap)) : 0
  const reached = cap && (used || 0) >= cap
  return (
    <div className={compactRow ? 'space-y-0.5' : 'space-y-1'}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span className="tabular-nums whitespace-nowrap" style={{ color: reached ? 'var(--fin-negative)' : 'var(--text-3)' }}>
          {metricValue(metric, used || 0)} of {metricValue(metric, cap)}{reached ? ' · reached' : ''}
        </span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${metricValue(metric, used || 0)} of ${metricValue(metric, cap)}`}
        className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barTone(pct), transition: 'width 200ms ease' }} />
      </div>
    </div>
  )
}

// Every limit of one target as bars, or a quiet "No limits" line.
export function LimitBars({ limits }) {
  if (!limits?.length) return <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>No limits — only the provider's own rate limits apply.</p>
  return (
    <div className="space-y-2">
      {limits.map(l => (
        <LimitBar key={`${l.period}-${l.metric}`} label={`${PERIOD_ADJ[l.period]} ${METRIC_LABEL[l.metric].toLowerCase()}`}
          used={l.used} cap={l.cap} metric={l.metric} />
      ))}
    </div>
  )
}

// A centred "nothing here yet" panel with an optional action.
export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-4 py-8">
      {Icon && (
        <span className="w-10 h-10 rounded-xl flex items-center justify-center" aria-hidden="true"
          style={{ background: 'var(--bg-input)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
          <Icon size={18} />
        </span>
      )}
      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</p>
      {children && <p className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--text-3)' }}>{children}</p>}
      {action}
    </div>
  )
}

export function WarningList({ warnings }) {
  if (!warnings?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {warnings.map((w, i) => (
        <li key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium"
          style={warningStyle(w.level)}>
          <AlertTriangle size={11} aria-hidden="true" />
          <span>Step {w.index + 1}: {w.message}</span>
        </li>
      ))}
    </ul>
  )
}
