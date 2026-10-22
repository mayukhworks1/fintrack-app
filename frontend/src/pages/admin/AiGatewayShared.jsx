// Formatting, small atoms and route checks shared by the AI gateway panels.
import { cloneElement, isValidElement, useId } from 'react'
import { ArrowRight, AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react'
import { formatIst } from '../../utils/ist'

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export const MAX_ROUTE_STEPS = 6
export const MAX_PROMPT_CHARS = 20000
export const MAX_TEST_INPUT = 4000
export const MODEL_ID_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/

export const OUTPUT_BADGE = {
  json:   ['purple', 'JSON'],
  text:   ['blue', 'Text'],
  stream: ['teal', 'Stream'],
}

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
  if (!envKeyApplies(p)) return `No key saved for this base URL (${p.env_var} is only sent to ${hostOf(p.default_base_url)})`
  return `No key set (${p.env_var})`
}

export function keyBadge(p) {
  if (p.key_unreadable) return ['red', 'Key unreadable']
  if (p.key_source === 'stored') return ['green', 'Key set']
  if (p.key_source === 'env') return ['blue', 'From env']
  return ['amber', 'No key']
}

// Same checks the server runs for route_warnings, for a route still being edited.
export function localRouteWarnings(route, providers) {
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
export function RouteChain({ route, warnings = [], labels = {} }) {
  if (!route?.length) return <span className="text-xs" style={{ color: 'var(--text-3)' }}>No route</span>
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Route">
      {route.map((step, i) => {
        const w = warnings.filter(x => x.index === i)
        const level = w.some(x => x.level === 'error') ? 'error' : w.length ? 'warn' : null
        return (
          <li key={`${i}-${step.provider}-${step.model}`} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ArrowRight size={11} aria-hidden="true" style={{ color: 'var(--text-3)' }} />}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] max-w-full min-w-0"
              style={level ? warningStyle(level) : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
              <span className="font-semibold whitespace-nowrap">{labels[step.provider] || step.provider}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono truncate">{step.model}</span>
            </span>
          </li>
        )
      })}
    </ol>
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
