/**
 * Admin Dashboard — full PostgreSQL visibility  (v2.3)
 *
 * Modes:
 *   embedded={false}  Full-screen standalone — shown when role === 'admin' logs in
 *   embedded={true}   Inside Layout sidebar  — shown at /admin for role === 'editor'
 *
 * Tabs:
 *   Overview   — live counts, error rates, sync status
 *   Audit Log  — every API request: role/IP/geo/OS/browser/referer/size
 *   Sessions   — login sessions (active-only toggle)
 *   AI Chats   — conversation sessions + messages
 *   Sync Log   — Teable ↔ PostgreSQL sync history
 *   Projects   — PostgreSQL projects mirror
 *   Invoices   — all invoices: main + web (source filter)
 *   History    — field-level change log
 */

import { useState, useEffect, useCallback } from 'react'
import {
  LayoutDashboard, ScrollText, Users, MessageSquareText,
  RefreshCw, Database, FileText, Clock, LogOut,
  TrendingUp, ChevronLeft, ChevronRight, Search,
  Activity, Globe, Monitor, Smartphone, Tablet,
  CheckCircle2, XCircle, AlertCircle, History,
  ShieldAlert, Zap, BarChart2, Link2, Play, MinusCircle,
  Trash2, Filter, X, MapPin, Wifi, ChevronDown, ChevronUp,
  SlidersHorizontal, Calendar, Terminal
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { FilterSelect, FilterMulti } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  if (typeof n === 'number') return n.toLocaleString()
  return String(n)
}

function ts(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return v }
}

function relTime(v) {
  if (!v) return '—'
  try {
    const diff = Date.now() - new Date(v).getTime()
    if (diff < 60000)    return `${Math.round(diff / 1000)}s ago`
    if (diff < 3600000)  return `${Math.round(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
    return `${Math.round(diff / 86400000)}d ago`
  } catch { return v }
}

function Badge({ children, color = 'default' }) {
  const colors = {
    default:  { bg: 'rgba(100,116,139,0.12)', fg: 'var(--text-2)' },
    green:    { bg: 'rgba(22,163,74,0.12)',   fg: '#16a34a' },
    blue:     { bg: 'rgba(37,99,235,0.12)',   fg: '#2563eb' },
    amber:    { bg: 'rgba(217,119,6,0.12)',   fg: '#d97706' },
    red:      { bg: 'rgba(220,38,38,0.12)',   fg: '#dc2626' },
    purple:   { bg: 'rgba(124,58,237,0.12)',  fg: '#7c3aed' },
    indigo:   { bg: 'rgba(99,102,241,0.12)',  fg: '#6366f1' },
    pink:     { bg: 'rgba(219,39,119,0.12)',  fg: '#db2777' },
    teal:     { bg: 'rgba(13,148,136,0.12)',  fg: '#0d9488' },
    orange:   { bg: 'rgba(234,88,12,0.12)',   fg: '#ea580c' },
  }
  const { bg, fg } = colors[color] || colors.default
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: bg, color: fg }}>
      {children}
    </span>
  )
}

function roleBadge(role) {
  const map = { editor: 'blue', viewer: 'indigo', web: 'purple', all: 'pink', admin: 'red' }
  return <Badge color={map[role] || 'default'}>{role || 'anon'}</Badge>
}

function statusBadge(status) {
  if (!status) return <Badge>—</Badge>
  if (status < 300) return <Badge color="green">{status}</Badge>
  if (status < 400) return <Badge color="blue">{status}</Badge>
  if (status < 500) return <Badge color="amber">{status}</Badge>
  return <Badge color="red">{status}</Badge>
}

function methodBadge(method) {
  const map = { GET: 'green', POST: 'blue', PATCH: 'amber', DELETE: 'red', PUT: 'orange' }
  return <Badge color={map[method] || 'default'}>{method}</Badge>
}

function deviceIcon(device) {
  if (device === 'mobile')  return <Smartphone size={11} />
  if (device === 'tablet')  return <Tablet size={11} />
  return <Monitor size={11} />
}

// ── Loading / error / empty states ───────────────────────────────────────────

function Skeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 rounded-lg w-full" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}

function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card skeleton h-20 rounded-xl" style={{ opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  )
}

function Err({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertCircle size={24} style={{ color: 'var(--fin-negative)' }} />
      <p className="text-sm" style={{ color: 'var(--text-2)' }}>{msg || 'Failed to load data'}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs px-3 py-1">Retry</button>
      )}
    </div>
  )
}

function Empty({ label = 'No rows found' }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Database size={22} style={{ color: 'var(--text-3)' }} />
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>{label}</p>
    </div>
  )
}

// ── Generic paginator ─────────────────────────────────────────────────────────

function Pager({ total, limit, offset, onPage }) {
  const page  = Math.floor(offset / limit)
  const pages = Math.ceil(total / limit)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
        {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
      </span>
      <div className="flex gap-1 items-center">
        <button onClick={() => onPage(Math.max(0, offset - limit))} disabled={page === 0}
          className="btn-icon p-1" style={{ opacity: page === 0 ? 0.35 : 1 }}>
          <ChevronLeft size={13} />
        </button>
        <span className="text-xs px-2" style={{ color: 'var(--text-2)' }}>{page + 1}/{pages}</span>
        <button onClick={() => onPage(Math.min((pages - 1) * limit, offset + limit))}
          disabled={page >= pages - 1} className="btn-icon p-1"
          style={{ opacity: page >= pages - 1 ? 0.35 : 1 }}>
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, color, accent }) {
  return (
    <div className="card flex flex-col gap-1 min-w-0" style={accent ? { borderLeft: `3px solid ${accent}` } : {}}>
      <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: color || 'var(--text-1)' }}>{fmt(value)}</p>
      {sub && <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function OverviewTab() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.stats()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <StatSkeleton />
  if (error)   return <Err msg={error} onRetry={load} />
  if (!data)   return null

  const total24h = data.audit_24h || 0
  const err4xx   = data.audit_4xx_24h || 0
  const err5xx   = data.audit_5xx_24h || 0
  const errRate  = total24h > 0 ? (((err4xx + err5xx) / total24h) * 100).toFixed(1) : '0.0'

  return (
    <div className="space-y-6">
      {/* Requests */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          API Traffic
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Total Requests"    value={data.audit_total}
            sub={`${fmt(data.audit_24h)} today`} />
          <StatBox label="Last Hour"         value={data.audit_1h}
            sub={`${fmt(data.audit_24h)} last 24h`} />
          <StatBox label="Unique IPs (24h)"  value={data.unique_ips_24h} />
          <StatBox label="Error Rate (24h)"  value={`${errRate}%`}
            color={parseFloat(errRate) > 5 ? '#dc2626' : '#16a34a'}
            sub={`${err4xx} client · ${err5xx} server errors`} />
        </div>
      </section>

      {/* Requests by role */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Requests by Role
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Editor"   value={data.audit_editor} color="#2563eb" accent="#2563eb" />
          <StatBox label="Web"      value={data.audit_web}    color="#7c3aed" accent="#7c3aed" />
          <StatBox label="All"      value={data.audit_all}    color="#db2777" accent="#db2777" />
          <StatBox label="Viewer"   value={data.audit_viewer} color="#6366f1" accent="#6366f1" />
          <StatBox label="Admin"    value={data.audit_admin}  color="#dc2626" accent="#dc2626" />
          <StatBox label="Anonymous" value={data.audit_anon}  color="var(--text-3)" />
        </div>
      </section>

      {/* Sessions */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Login Sessions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatBox label="Active Sessions"  value={data.sessions_active} color="#16a34a" accent="#16a34a"
            sub={data.sessions_last_active ? `Last: ${relTime(data.sessions_last_active)}` : 'None active'} />
          <StatBox label="Total Sessions"   value={data.sessions_total} />
          <StatBox label="AI Chat Sessions" value={data.chat_sessions_total}
            sub={`${fmt(data.chat_messages_total)} messages`} />
        </div>
      </section>

      {/* Mirror */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Teable Mirror (PostgreSQL)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Projects"         value={data.projects_total}
            sub={data.projects_last_sync ? `Synced ${relTime(data.projects_last_sync)}` : 'Never synced'} />
          <StatBox label="Main Invoices"    value={data.invoices_total}
            sub={data.invoices_last_sync ? `Synced ${relTime(data.invoices_last_sync)}` : 'Never synced'} />
          <StatBox label="Web Invoices"     value={data.web_invoices_total}
            sub={data.web_invoices_last_sync ? `Synced ${relTime(data.web_invoices_last_sync)}` : 'Never synced'} />
          <StatBox label="Change History"   value={data.history_total}
            sub={`${fmt(data.history_24h)} changes today`} />

          {/* Sync status card */}
          <div className="card flex flex-col gap-1 col-span-2 sm:col-span-1">
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Last Sync Run</p>
            <p className="text-sm font-semibold"
              style={{ color: data.last_sync_error ? '#dc2626' : '#16a34a' }}>
              {data.last_sync_at ? relTime(data.last_sync_at) : 'Never'}
            </p>
            {data.last_sync_error
              ? <p className="text-[11px] truncate" style={{ color: '#dc2626' }} title={data.last_sync_error}>
                  ✕ {data.last_sync_error}
                </p>
              : data.last_sync_source
                ? <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Source: {data.last_sync_source}
                  </p>
                : null
            }
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Truth Contract
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="card space-y-2" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div className="flex items-center gap-2">
              <Globe size={14} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Teable is source of truth</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Primary operational state should always match Teable. Any discrepancy should be treated as a sync defect, not a product state.
            </p>
          </div>
          <div className="card space-y-2" style={{ borderLeft: '3px solid #16a34a' }}>
            <div className="flex items-center gap-2">
              <Database size={14} style={{ color: '#16a34a' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>PostgreSQL is mirror and history</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              PG exists for analytics, associations, audit trails, report history, and faster app reads. Mirror freshness is tracked here, not assumed.
            </p>
          </div>
          <div className="card space-y-2" style={{ borderLeft: '3px solid #d97706' }}>
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: '#d97706' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Valkey is cache only</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Cached responses should improve speed only. If a record looks wrong after refresh, use Sync Log and History to diagnose the mirror path.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Mirror Sanity
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['Projects', data.projects_total, data.projects_stale, data.projects_deleted, data.projects_last_sync],
            ['Invoices', data.invoices_total, data.invoices_stale, data.invoices_deleted, data.invoices_last_sync],
            ['Web invoices', data.web_invoices_total, data.web_invoices_stale, data.web_invoices_deleted, data.web_invoices_last_sync],
            ['Status', data.status_total, data.status_stale, data.status_deleted, data.status_last_sync],
          ].map(([label, total, stale, deleted, lastSync]) => (
            <div key={label} className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{label}</p>
                {(Number(stale) || 0) > 0 ? <Badge color="amber">{fmt(stale)} stale</Badge> : <Badge color="green">Fresh</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge color="blue">{fmt(total)} total</Badge>
                <Badge color={(Number(deleted) || 0) > 0 ? 'red' : 'default'}>{fmt(deleted)} deleted</Badge>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {lastSync ? `Last sync ${relTime(lastSync)}` : 'No sync seen yet'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Shared Link Activity
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatBox label="Links Total" value={data.shared_links_total} />
          <StatBox label="Links Active" value={data.shared_links_active} color="#16a34a" accent="#16a34a" />
          <StatBox label="Editable Links" value={data.shared_links_edit} color="#d97706" accent="#d97706" />
          <StatBox label="Opens (24h)" value={data.shared_link_accesses_24h} sub="All shared modules" />
          <StatBox label="Edits (24h)" value={data.shared_link_edits_24h} sub="Public link mutations" color="#2563eb" accent="#2563eb" />
        </div>
      </section>
    </div>
  )
}

// ── Tab: Audit Log ────────────────────────────────────────────────────────────

// ── Country flag emoji from ISO 2-letter code ────────────────────────────────
function countryFlag(code) {
  if (!code || code.length !== 2) return ''
  try {
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E0 - 65 + c.charCodeAt(0)))
  } catch { return '' }
}

// ── Shared form controls ──────────────────────────────────────────────────────
const CTRL_STYLE = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
  borderRadius: 8,
  fontSize: 12,
  padding: '4px 8px',
  outline: 'none',
}

function FLabel({ label, children }) {
  return (
    <label className="flex flex-col gap-0.5 flex-shrink-0">
      <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function FPill({ label, value, onChange, type = 'text', placeholder, width = 130 }) {
  return (
    <FLabel label={label}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''} style={{ ...CTRL_STYLE, width: `min(100%, ${width}px)` }} />
    </FLabel>
  )
}

// FSel — thin adapter so existing call sites keep working (opts is [value,label][] tuple array)
function FSel({ label, value, onChange, opts, width = 130 }) {
  const options = opts.map(([v, l]) => ({ value: v, label: l }))
  return (
    <FLabel label={label}>
      <FilterSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={options[0]?.label ?? 'All'}
        width={width}
        clearable={options[0]?.value === ''}
      />
    </FLabel>
  )
}

// FMulti — thin adapter (opts is [value,label][] tuple array)
function FMulti({ label, selected, onChange, opts, placeholder = 'Any', width = 150 }) {
  const options = opts.map(([v, l]) => ({ value: v, label: l }))
  return (
    <FLabel label={label}>
      <FilterMulti
        selected={selected}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        width={width}
      />
    </FLabel>
  )
}

// ── Shared filter bar wrapper ─────────────────────────────────────────────────
function FilterBar({ children, count, onReset, rightSlot }) {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '10px 12px',
    }} className="space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        {children}
      </div>
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          {rightSlot}
        </div>
        {count > 0 && (
          <button onClick={onReset}
            style={{
              ...CTRL_STYLE, display: 'flex', alignItems: 'center', gap: 4,
              color: 'var(--text-3)', cursor: 'pointer',
            }}>
            <X size={11} /> Clear ({count})
          </button>
        )}
      </div>
    </div>
  )
}

// ── Purge confirmation modal ──────────────────────────────────────────────────
function PurgeModal({ onConfirm, onCancel, purging, result }) {
  // mode: 'hours' | 'days'
  const [mode,       setMode]  = useState('days')
  const [hours,      setHours] = useState(24)
  const [days,       setDays]  = useState(30)

  const hourPresets = [[1,'1 hr'],[6,'6 hrs'],[12,'12 hrs'],[24,'24 hrs']]
  const dayPresets  = [[3,'3 days'],[7,'1 week'],[30,'1 month'],[90,'3 months'],[180,'6 months'],[365,'1 year']]

  const activePreset = mode === 'hours' ? hours : days
  const setActive    = mode === 'hours' ? setHours : setDays

  const handleConfirm = () =>
    onConfirm(mode === 'hours' ? { hours } : { days })

  const label = mode === 'hours'
    ? `${hours} hour${hours !== 1 ? 's' : ''}`
    : `${days} day${days !== 1 ? 's' : ''}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 18, padding: 28, width: '100%', maxWidth: 480,
        boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div style={{ background: 'rgba(220,38,38,0.12)', borderRadius: 10, padding: 8 }}>
            <Trash2 size={18} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h3 style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 16, margin: 0 }}>Purge Audit Log</h3>
            <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>Removes entries older than selected threshold</p>
          </div>
          <button onClick={onCancel} style={{ marginLeft: 'auto', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Safety notice */}
        <div style={{
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 10, padding: '8px 12px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ color: '#92400e', fontSize: 12, fontWeight: 500 }}>
            Always keeps the 200 most-recent rows as a safety floor.
          </span>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', borderRadius: 10, padding: 4, marginBottom: 16 }}>
          {[['hours','By Hours'],['days','By Days']].map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: mode === m ? 'var(--card-bg)' : 'transparent',
              color: mode === m ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}>
              {l}
            </button>
          ))}
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {(mode === 'hours' ? hourPresets : dayPresets).map(([v, l]) => (
            <button key={v} onClick={() => setActive(v)} style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid',
              borderColor: activePreset === v ? '#dc2626' : 'var(--border)',
              background: activePreset === v ? '#dc2626' : 'var(--bg-input)',
              color: activePreset === v ? '#fff' : 'var(--text-2)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s',
            }}>
              {l}
            </button>
          ))}
        </div>

        {/* Custom input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Custom:</span>
          <input type="number" min={mode === 'hours' ? 0.5 : 1} step={mode === 'hours' ? 0.5 : 1}
            max={mode === 'hours' ? 8760 : 3650}
            value={mode === 'hours' ? hours : days}
            onChange={e => {
              const n = parseFloat(e.target.value) || (mode === 'hours' ? 1 : 1)
              mode === 'hours' ? setHours(Math.max(0.5, n)) : setDays(Math.max(1, Math.round(n)))
            }}
            style={{ ...CTRL_STYLE, width: 80, textAlign: 'center' }} />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{mode === 'hours' ? 'hours' : 'days'}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 4 }}>
            → older than <b style={{ color: 'var(--text-2)' }}>{label}</b>
          </span>
        </div>

        {/* Result */}
        {result && (
          <div style={{
            background: result.error ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
            border: `1px solid ${result.error ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'}`,
            color: result.error ? '#dc2626' : '#16a34a',
            borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 16,
          }}>
            {result.error ? `✕ ${result.error}` : `✓ ${result.message || `Deleted ${result.deleted?.toLocaleString()} rows`}`}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            ...CTRL_STYLE, padding: '8px 20px', cursor: 'pointer', fontWeight: 600,
          }}>Cancel</button>
          <button onClick={handleConfirm} disabled={purging} style={{
            padding: '8px 20px', borderRadius: 10, border: 'none', cursor: purging ? 'not-allowed' : 'pointer',
            background: purging ? '#991b1b' : '#dc2626', color: '#fff',
            fontWeight: 700, fontSize: 13, opacity: purging ? 0.7 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {purging
              ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Purging…</>
              : <><Trash2 size={13} /> Delete &gt; {label}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function AuditLogTab() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [offset, setOffset]     = useState(0)
  const [expanded, setExp]      = useState(null)

  // ── Basic filters ──────────────────────────────────────────────────────────
  const [limit,        setLimit]   = useState(100)
  const [filterRole,   setRole]    = useState([])
  const [filterMethod, setMeth]    = useState([])
  const [filterStatus, setStat]    = useState('')

  // ── Advanced filters ───────────────────────────────────────────────────────
  const [showAdv,      setShowAdv] = useState(false)
  const [filterIp,     setIp]      = useState('')
  const [filterPath,   setPath]    = useState('')
  const [filterCountry,setCountry] = useState('')
  const [filterCity,   setCity]    = useState('')
  const [filterIsp,    setIsp]     = useState('')
  const [filterDevice, setDevice]  = useState([])
  const [filterBrowser,setBrowser] = useState('')
  const [filterOs,     setOs]      = useState('')
  const [filterFrom,   setFrom]    = useState('')
  const [filterTo,     setTo]      = useState('')
  const [statusMin,    setStMin]   = useState('')
  const [statusMax,    setStMax]   = useState('')

  // ── Client-side advanced filter builder ───────────────────────────────────
  const [filterConditions, setFilterConditions] = useState([])

  // ── Purge ──────────────────────────────────────────────────────────────────
  const [showPurge,  setShowPurge]  = useState(false)
  const [purging,    setPurging]    = useState(false)
  const [purgeRes,   setPurgeRes]   = useState(null)

  // ── Active filter count badge ──────────────────────────────────────────────
  const advCount = [filterIp,filterPath,filterCountry,filterCity,filterIsp,
                    filterBrowser,filterOs,filterFrom,filterTo,statusMin,statusMax].filter(Boolean).length
                 + filterDevice.length

  const basicFilters = [filterStatus]

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await api.admin.auditLog({
        limit, offset,
        roles:      filterRole.length   ? filterRole.join(',')   : undefined,
        methods:    filterMethod.length ? filterMethod.join(',') : undefined,
        devices:    filterDevice.length ? filterDevice.join(',') : undefined,
        status:     filterStatus  || undefined,
        status_min: statusMin     || undefined,
        status_max: statusMax     || undefined,
        ip:         filterIp      || undefined,
        path:       filterPath    || undefined,
        country:    filterCountry || undefined,
        city:       filterCity    || undefined,
        isp:        filterIsp     || undefined,
        browser:    filterBrowser || undefined,
        os:         filterOs      || undefined,
        from_ts:    filterFrom    || undefined,
        to_ts:      filterTo      || undefined,
      }))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, limit, filterRole, filterMethod, filterStatus,
      statusMin, statusMax, filterIp, filterPath, filterCountry,
      filterCity, filterIsp, filterDevice, filterBrowser, filterOs,
      filterFrom, filterTo])

  const resetFilters = () => {
    setRole([]); setMeth([]); setStat(''); setIp(''); setPath('')
    setCountry(''); setCity(''); setIsp(''); setDevice([]); setBrowser('')
    setOs(''); setFrom(''); setTo(''); setStMin(''); setStMax('')
    setOffset(0)
  }

  useEffect(() => { setOffset(0) }, [filterRole, filterMethod, filterStatus,
    statusMin, statusMax, filterIp, filterPath, filterCountry,
    filterCity, filterIsp, filterDevice, filterBrowser, filterOs,
    filterFrom, filterTo, limit])

  useEffect(() => { load() }, [load])

  const doPurge = async ({ days, hours } = {}) => {
    setPurging(true); setPurgeRes(null)
    try {
      const r = await api.admin.purgeAuditLog({ days, hours })
      setPurgeRes(r)
      load()  // Refresh table
    } catch(e) { setPurgeRes({ error: e.message }) }
    finally { setPurging(false) }
  }

  const hasAnyFilter = advCount > 0 || filterRole.length > 0 || filterMethod.length > 0 || basicFilters.some(Boolean)

  return (
    <div className="space-y-3">
      {showPurge && (
        <PurgeModal
          onConfirm={doPurge}
          onCancel={() => { setShowPurge(false); setPurgeRes(null) }}
          purging={purging}
          result={purgeRes}
        />
      )}

      {/* ── Basic filter bar ─────────────────────────────────────────────── */}
      <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
        <div className="flex flex-wrap gap-2 items-end">
          <FMulti label="Role" selected={filterRole} onChange={setRole} width={140}
            opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
          <FMulti label="Method" selected={filterMethod} onChange={setMeth} width={130}
            opts={[['GET','GET'],['POST','POST'],['PATCH','PATCH'],['DELETE','DELETE']]} />
          <FSel label="Status" value={filterStatus} onChange={setStat}
            opts={[['','All statuses'],['200','200 OK'],['201','201 Created'],['204','204 No Content'],
                   ['400','400 Bad Req'],['401','401 Unauth'],['403','403 Forbidden'],
                   ['404','404 Not Found'],['422','422 Unprocessable'],['500','500 Server Err']]} />
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['50','50'],['100','100'],['200','200'],['500','500'],['1000','1000']]} />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => setShowAdv(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition-colors"
            style={{
              background: showAdv ? 'rgba(99,102,241,0.15)' : 'var(--bg-input)',
              color: showAdv ? '#818cf8' : 'var(--text-2)',
              border: `1px solid ${showAdv ? '#818cf8' : 'var(--border)'}`,
            }}>
            <SlidersHorizontal size={12} />
            Filters
            {advCount > 0 && (
              <span className="rounded-full px-1.5 py-0 text-[10px] font-bold"
                style={{ background: '#6366f1', color: '#fff' }}>
                {advCount}
              </span>
            )}
            {showAdv ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <button onClick={() => setShowPurge(true)}
            className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium"
            style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.25)' }}>
            <Trash2 size={12} /> Purge
          </button>
          {hasAnyFilter && (
            <button onClick={resetFilters}
              className="text-xs px-2 py-1.5 rounded-lg flex items-center gap-1"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {/* ── Advanced filter panel ─────────────────────────────────────── */}
        {showAdv && (
          <div className="pt-2 border-t flex flex-wrap gap-3" style={{ borderColor: 'var(--border)' }}>
            <FPill label="IP address" value={filterIp}      onChange={setIp}      placeholder="192.168…" />
            <FPill label="Path"       value={filterPath}    onChange={setPath}    placeholder="/api/…" />
            <FPill label="Country"    value={filterCountry} onChange={setCountry} placeholder="US · India…" />
            <FPill label="City"       value={filterCity}    onChange={setCity}    placeholder="Mumbai…" />
            <FPill label="ISP / Org"  value={filterIsp}     onChange={setIsp}     placeholder="Airtel…" />
            <FMulti label="Device" selected={filterDevice} onChange={setDevice} width={140}
              opts={[['desktop','🖥 Desktop'],['mobile','📱 Mobile'],['tablet','⬛ Tablet']]} />
            <FPill label="Browser"    value={filterBrowser} onChange={setBrowser} placeholder="Chrome…" />
            <FPill label="OS"         value={filterOs}      onChange={setOs}      placeholder="Windows…" />
            <FPill label="Status ≥"   value={statusMin}     onChange={setStMin}   type="number" placeholder="400" />
            <FPill label="Status ≤"   value={statusMax}     onChange={setStMax}   type="number" placeholder="499" />
            <FPill label="From"       value={filterFrom}    onChange={setFrom}    type="datetime-local" />
            <FPill label="To"         value={filterTo}      onChange={setTo}      type="datetime-local" />
          </div>
        )}

        {/* ── Client-side condition filter builder ─────────────────────── */}
        <div className="pt-1">
          <FilterBuilder
            fields={[
              { key: 'role',    label: 'Role',    type: 'text' },
              { key: 'method',  label: 'Method',  type: 'text' },
              { key: 'path',    label: 'Path',    type: 'text' },
              { key: 'ip',      label: 'IP',      type: 'text' },
              { key: 'country', label: 'Country', type: 'text' },
              { key: 'city',    label: 'City',    type: 'text' },
              { key: 'isp',     label: 'ISP',     type: 'text' },
              { key: 'browser', label: 'Browser', type: 'text' },
              { key: 'os',      label: 'OS',      type: 'text' },
              { key: 'device',  label: 'Device',  type: 'text' },
              { key: 'status',  label: 'Status',  type: 'number' },
            ]}
            records={data?.rows || []}
            getFieldValue={r => r}
            conditions={filterConditions}
            onChange={setFilterConditions}
            label="Add condition filter"
          />
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        {data && (
          <div className="flex gap-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <span><b style={{ color: 'var(--text-1)' }}>{data.total.toLocaleString()}</b> matching rows</span>
            <span>showing {Math.min(offset + 1, data.total)}–{Math.min(offset + limit, data.total)}</span>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {/* Mobile card view */}
          {(() => {
            const filteredRows = applyConditions(data?.rows || [], filterConditions, r => r)
            return filteredRows
          })().length === 0 ? <Empty /> : (
            <>
              <div className="md:hidden space-y-1.5">
                {applyConditions(data?.rows || [], filterConditions, r => r).map(row => (
                  <div key={`m-${row.id}`}>
                    <div
                      className="rounded-xl border cursor-pointer p-3"
                      style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}
                      onClick={() => setExp(expanded === row.id ? null : row.id)}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-wrap gap-1">
                          {roleBadge(row.role)}
                          {methodBadge(row.method)}
                          {statusBadge(row.status)}
                        </div>
                        <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                          {ts(row.ts)}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono truncate mb-1.5" style={{ color: 'var(--text-2)' }}
                        title={row.path}>
                        {row.path}{row.query_params ? '?…' : ''}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {row.ip && <span className="font-mono">{row.ip}</span>}
                        {(row.city || row.country_code) && (
                          <span>{countryFlag(row.country_code)} {[row.city, row.country_code].filter(Boolean).join(', ')}</span>
                        )}
                        {row.duration_ms != null && <span>{row.duration_ms}ms</span>}
                        {row.device && <span>{deviceIcon(row.device)} {row.os || ''}</span>}
                        {row.isp && <span>{row.isp}</span>}
                      </div>
                    </div>
                    {expanded === row.id && (
                      <div className="rounded-xl p-3 text-[11px] space-y-1.5"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', marginTop: 2 }}>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {row.request_id && <span style={{ color: 'var(--text-3)' }}>ReqID: <code style={{ color: 'var(--text-1)' }}>{row.request_id?.slice(0, 12)}…</code></span>}
                          {row.country && <span style={{ color: 'var(--text-3)' }}>Country: <b style={{ color: 'var(--text-1)' }}>{countryFlag(row.country_code)} {row.country}</b></span>}
                          {row.region && <span style={{ color: 'var(--text-3)' }}>Region: <b style={{ color: 'var(--text-1)' }}>{row.region}</b></span>}
                          {row.org && row.org !== row.isp && <span style={{ color: 'var(--text-3)' }}>Org: <b style={{ color: 'var(--text-1)' }}>{row.org}</b></span>}
                          {row.timezone && <span style={{ color: 'var(--text-3)' }}>TZ: <b style={{ color: 'var(--text-1)' }}>{row.timezone}</b></span>}
                          {row.lat != null && row.lon != null && (
                            <a href={`https://www.google.com/maps?q=${row.lat},${row.lon}`}
                              target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              style={{ color: '#6366f1' }}>
                              <MapPin size={9} className="inline mr-0.5" />{Number(row.lat).toFixed(3)}, {Number(row.lon).toFixed(3)} ↗
                            </a>
                          )}
                          {row.browser && <span style={{ color: 'var(--text-3)' }}>Browser: <b style={{ color: 'var(--text-1)' }}>{row.browser}</b></span>}
                          {(row.body_size || row.resp_size) && (
                            <span style={{ color: 'var(--text-3)' }}>Size: {row.body_size ? `↑${row.body_size}B ` : ''}{row.resp_size ? `↓${row.resp_size}B` : ''}</span>
                          )}
                        </div>
                        {row.query_params && <p className="truncate" style={{ color: 'var(--text-3)' }}>Query: <code style={{ color: 'var(--text-1)' }}>{row.query_params}</code></p>}
                        {row.user_agent && <p className="truncate" style={{ color: 'var(--text-3)' }}>UA: {row.user_agent}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Time','Role','Method','Path','Status','ms','IP · Location','OS / Browser','ISP · Org','Sizes'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-2)', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applyConditions(data?.rows || [], filterConditions, r => r).map(row => (
                    <>
                      <tr key={row.id}
                        className="border-b transition-colors cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setExp(expanded === row.id ? null : row.id)}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>

                        {/* Time */}
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                          {ts(row.ts)}
                        </td>

                        {/* Role */}
                        <td className="px-3 py-2">{roleBadge(row.role)}</td>

                        {/* Method */}
                        <td className="px-3 py-2">{methodBadge(row.method)}</td>

                        {/* Path */}
                        <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--text-1)' }} title={row.path}>
                          {row.query_params
                            ? <><span>{row.path}</span><span style={{ color: 'var(--text-3)' }}>?…</span></>
                            : row.path}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>

                        {/* Duration */}
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap"
                          style={{ color: row.duration_ms > 2000 ? '#f59e0b' : row.duration_ms > 5000 ? '#dc2626' : 'var(--text-2)' }}>
                          {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                        </td>

                        {/* IP + Location */}
                        <td className="px-3 py-2" style={{ minWidth: 160 }}>
                          <div className="font-mono text-[10px]" style={{ color: 'var(--text-2)' }}>{row.ip || '—'}</div>
                          {(row.country_code || row.city) && (
                            <div className="flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                              <span>{countryFlag(row.country_code)}</span>
                              <span>{[row.city, row.region, row.country_code].filter(Boolean).join(', ')}</span>
                            </div>
                          )}
                          {(row.lat != null && row.lon != null) && (
                            <a
                              href={`https://www.google.com/maps?q=${row.lat},${row.lon}`}
                              target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-0.5 mt-0.5"
                              style={{ color: '#6366f1', fontSize: 10, textDecoration: 'none' }}>
                              <MapPin size={9} />
                              {Number(row.lat).toFixed(3)}, {Number(row.lon).toFixed(3)}
                            </a>
                          )}
                        </td>

                        {/* OS / Browser / Device */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                            {deviceIcon(row.device)}
                            <span>{row.os || '?'}</span>
                          </div>
                          {row.browser && (
                            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{row.browser}</div>
                          )}
                        </td>

                        {/* ISP / Org */}
                        <td className="px-3 py-2" style={{ maxWidth: 180 }}>
                          {row.isp && (
                            <div className="flex items-center gap-1 truncate" style={{ color: 'var(--text-2)', fontSize: 10 }}>
                              <Wifi size={9} style={{ flexShrink: 0 }} />
                              <span className="truncate" title={row.isp}>{row.isp}</span>
                            </div>
                          )}
                          {row.org && row.org !== row.isp && (
                            <div className="truncate" style={{ color: 'var(--text-3)', fontSize: 10 }} title={row.org}>{row.org}</div>
                          )}
                          {row.timezone && (
                            <div style={{ color: 'var(--text-3)', fontSize: 10 }}>🕐 {row.timezone}</div>
                          )}
                        </td>

                        {/* Sizes */}
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                          {row.body_size ? <div>↑ {row.body_size}B</div> : null}
                          {row.resp_size ? <div>↓ {row.resp_size}B</div> : null}
                          {!row.body_size && !row.resp_size ? '—' : ''}
                        </td>
                      </tr>

                      {/* ── Expanded detail row ─────────────────────────── */}
                      {expanded === row.id && (
                        <tr key={`${row.id}-exp`} style={{ background: 'var(--bg-input)' }}>
                          <td colSpan={10} className="px-4 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
                              {row.request_id && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Request ID: <code style={{ color: 'var(--text-1)' }}>{row.request_id}</code>
                                </span>
                              )}
                              {row.token_hint && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Token: <code style={{ color: 'var(--text-1)' }}>{row.token_hint}…</code>
                                </span>
                              )}
                              {row.country && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Country: <b style={{ color: 'var(--text-1)' }}>{countryFlag(row.country_code)} {row.country}</b>
                                </span>
                              )}
                              {row.region && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Region/State: <b style={{ color: 'var(--text-1)' }}>{row.region}</b>
                                </span>
                              )}
                              {row.isp && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  ISP: <b style={{ color: 'var(--text-1)' }}>{row.isp}</b>
                                </span>
                              )}
                              {row.org && row.org !== row.isp && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Org: <b style={{ color: 'var(--text-1)' }}>{row.org}</b>
                                </span>
                              )}
                              {row.timezone && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Timezone: <b style={{ color: 'var(--text-1)' }}>{row.timezone}</b>
                                </span>
                              )}
                              {(row.lat != null && row.lon != null) && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Coordinates:{' '}
                                  <a href={`https://www.google.com/maps?q=${row.lat},${row.lon}`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#6366f1' }}>
                                    {Number(row.lat).toFixed(4)}, {Number(row.lon).toFixed(4)} ↗
                                  </a>
                                </span>
                              )}
                              {row.query_params && (
                                <span className="col-span-2 truncate" style={{ color: 'var(--text-3)' }}>
                                  Query: <code style={{ color: 'var(--text-1)' }}>{row.query_params}</code>
                                </span>
                              )}
                              {row.referer && (
                                <span className="col-span-2 truncate" style={{ color: 'var(--text-3)' }}>
                                  Referer: <span style={{ color: 'var(--text-1)' }}>{row.referer}</span>
                                </span>
                              )}
                              {row.user_agent && (
                                <span className="col-span-4 truncate" style={{ color: 'var(--text-3)' }}>
                                  User-Agent: <span style={{ color: 'var(--text-1)' }}>{row.user_agent}</span>
                                </span>
                              )}
                              {(row.body_size || row.resp_size) && (
                                <span style={{ color: 'var(--text-3)' }}>
                                  Transfer:{' '}
                                  {row.body_size && <span style={{ color: 'var(--text-1)' }}>↑ {row.body_size}B </span>}
                                  {row.resp_size && <span style={{ color: 'var(--text-1)' }}>↓ {row.resp_size}B</span>}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
              </tbody>
            </table>
          </div>
            </>
          )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sessions ─────────────────────────────────────────────────────────────

// Session status chip — 4 honest states derived from server-computed session_status
function SessionStatusChip({ status }) {
  const cfg = {
    online:     { label: 'Online',      color: '#16a34a', bg: 'rgba(22,163,74,0.10)',   icon: <CheckCircle2 size={11} /> },
    idle:       { label: 'Idle',        color: '#d97706', bg: 'rgba(217,119,6,0.10)',   icon: <Clock size={11} /> },
    logged_out: { label: 'Logged out',  color: 'var(--text-3)', bg: 'var(--bg-input)',  icon: <MinusCircle size={11} /> },
    expired:    { label: 'Expired',     color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   icon: <XCircle size={11} /> },
  }
  const s = cfg[status] || cfg.expired
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}>
      {s.icon}{s.label}
    </span>
  )
}

function SessionsTab() {
  const [data, setData]            = useState(null)
  const [loading, setLoading]      = useState(true)
  const [error, setError]          = useState(null)
  const [offset, setOffset]        = useState(0)
  const [activeOnly, setAO]        = useState(true)
  const [filterRole,   setSRole]   = useState([])
  const [filterStatus, setSStatus] = useState([])
  const [filterCountry,setSCountry]= useState('')
  const [filterDevice, setSDevice] = useState([])
  const [limit, setLimit]          = useState(50)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await api.admin.sessions({
        limit, offset,
        active_only:    activeOnly,
        role:           filterRole[0]    || undefined,
        session_status: filterStatus[0]  || undefined,
        country:        filterCountry    || undefined,
        device:         filterDevice[0]  || undefined,
      }))
    }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, activeOnly, limit, filterRole, filterStatus, filterCountry, filterDevice])

  useEffect(() => { setOffset(0) }, [activeOnly, filterRole, filterStatus, filterCountry, filterDevice, limit])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="rounded-xl border p-3 text-[11px] space-y-1"
        style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
        <p className="font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Session status explained</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { status: 'online',     desc: 'Active in last 30 min' },
            { status: 'idle',       desc: 'Token valid, no recent activity' },
            { status: 'logged_out', desc: 'User explicitly signed out' },
            { status: 'expired',    desc: '7-day token TTL reached' },
          ].map(({ status, desc }) => (
            <div key={status} className="flex items-start gap-1.5">
              <SessionStatusChip status={status} />
              <span style={{ color: 'var(--text-3)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <FilterBar
        count={filterRole.length + filterStatus.length + filterDevice.length + (filterCountry ? 1 : 0)}
        onReset={() => { setSRole([]); setSStatus([]); setSCountry(''); setSDevice([]) }}
        rightSlot={<>
          <button onClick={() => setAO(v => !v)}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors select-none"
            style={{
              background: activeOnly ? 'rgba(22,163,74,0.08)' : 'var(--bg-input)',
              borderColor: activeOnly ? 'rgba(22,163,74,0.3)' : 'var(--border)',
              color: activeOnly ? '#16a34a' : 'var(--text-2)',
            }}>
            {activeOnly
              ? <><CheckCircle2 size={12} /> Active only</>
              : <><XCircle size={12} /> All sessions</>}
          </button>
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['25','25'],['50','50'],['100','100']]} />
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}>
        <FMulti label="Role" selected={filterRole} onChange={setSRole} width={140}
          opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
        <FMulti label="Status" selected={filterStatus} onChange={setSStatus} width={150}
          opts={[['online','🟢 Online'],['idle','🟡 Idle'],['logged_out','⚫ Logged out'],['expired','🔴 Expired']]} />
        <FPill label="Country" value={filterCountry} onChange={setSCountry} placeholder="US · India…" width={130} />
        <FMulti label="Device" selected={filterDevice} onChange={setSDevice} width={140}
          opts={[['desktop','🖥 Desktop'],['mobile','📱 Mobile'],['tablet','⬛ Tablet']]} />
      </FilterBar>
      {data && (
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          {data.total.toLocaleString()} session{data.total !== 1 ? 's' : ''}
        </div>
      )}

      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {(data?.rows || []).length === 0
            ? <Empty label={activeOnly ? 'No active sessions — log in again to create one' : 'No sessions recorded yet'} />
            : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {(data?.rows || []).map(row => (
                    <div key={`m-${row.id}`} className="card p-3"
                      style={{ opacity: row.session_status === 'logged_out' || row.session_status === 'expired' ? 0.6 : 1 }}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-wrap gap-1">
                          {roleBadge(row.role)}
                          <SessionStatusChip status={row.session_status} />
                        </div>
                        <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                          {relTime(row.last_seen_at)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>IP: <span className="font-mono" style={{ color: 'var(--text-2)' }}>{row.ip || '—'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>Device: <span className="flex items-center gap-0.5 inline-flex" style={{ color: 'var(--text-2)' }}>{deviceIcon(row.device)} {row.os || '—'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>Location: <span style={{ color: 'var(--text-2)' }}>{[countryFlag(row.country_code), row.city, row.country].filter(Boolean).join(' ') || '—'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>Requests: <b style={{ color: 'var(--text-1)' }}>{fmt(row.request_count)}</b></span>
                        <span className="col-span-2" style={{ color: 'var(--text-3)' }}>Signed in: <span style={{ color: 'var(--text-2)' }}>{ts(row.created_at)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                        {['Role','Status','IP','Device / OS','Browser','Geo','Logged In','Last Seen','Requests'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                            style={{ color: 'var(--text-2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.rows || []).map(row => (
                        <tr key={row.id} className="border-b transition-colors"
                          style={{
                            borderColor: 'var(--border)',
                            opacity: row.session_status === 'logged_out' || row.session_status === 'expired' ? 0.6 : 1,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td className="px-3 py-2">{roleBadge(row.role)}</td>
                          <td className="px-3 py-2"><SessionStatusChip status={row.session_status} /></td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-2)', fontSize: 11 }}>
                            {row.ip || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            <span className="flex items-center gap-1">{deviceIcon(row.device)}{row.os || '—'}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {row.browser || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {[row.country, row.city].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)' }}>
                            {ts(row.created_at)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {relTime(row.last_seen_at)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                            {fmt(row.request_count)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: AI Chats ─────────────────────────────────────────────────────────────

function ChatsTab() {
  const [list, setList]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [offset, setOffset]       = useState(0)
  const [selected, setSelected]   = useState(null)
  const [msgs, setMsgs]           = useState(null)
  const [msgsLoading, setML]      = useState(false)
  const [filterRole,   setCRole]  = useState([])
  const [filterCountry,setCCountry]= useState('')
  const [limit, setCLimit]        = useState(30)

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    try { setList(await api.admin.chatSessions({
      limit, offset,
      role:    filterRole[0]    || undefined,
      country: filterCountry    || undefined,
    })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, limit, filterRole, filterCountry])

  useEffect(() => { setOffset(0) }, [filterRole, filterCountry, limit])
  useEffect(() => { loadList() }, [loadList])

  const openSession = useCallback(async (id) => {
    setSelected(id); setMsgs(null); setML(true)
    try { setMsgs(await api.admin.chatMessages(id)) }
    catch { setMsgs({ error: true }) }
    finally { setML(false) }
  }, [])

  if (selected) {
    return (
      <div className="space-y-3">
        <button onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs btn-secondary px-3 py-1">
          <ChevronLeft size={12} /> Back to sessions
        </button>
        {msgsLoading ? <Skeleton rows={4} /> : msgs?.error ? <Err msg="Failed to load messages" /> : (
          <div className="space-y-2">
            {(msgs?.messages || []).map(m => (
              <div key={m.id} className={`rounded-xl p-3 ${m.role === 'user' ? 'ml-4 sm:ml-8' : 'mr-4 sm:mr-8'}`}
                style={{ background: m.role === 'user' ? 'var(--bg-input)' : 'rgba(37,99,235,0.06)',
                  border: `1px solid ${m.role === 'user' ? 'var(--border)' : 'rgba(37,99,235,0.15)'}` }}>
                <div className="flex items-center justify-between mb-1">
                  {roleBadge(m.role)}
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    {ts(m.ts)}{m.model ? ` · ${m.model}` : ''}{m.duration_ms ? ` · ${m.duration_ms}ms` : ''}
                    {m.tokens_used ? ` · ${m.tokens_used} tok` : ''}
                  </span>
                </div>
                <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                  {m.content}
                </p>
              </div>
            ))}
            {(msgs?.messages || []).length === 0 && <Empty />}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <FilterBar
        count={filterRole.length + (filterCountry ? 1 : 0)}
        onReset={() => { setCRole([]); setCCountry('') }}
        rightSlot={<>
          <FSel label="Limit" value={String(limit)} onChange={v => setCLimit(Number(v))}
            opts={[['15','15'],['30','30'],['50','50'],['100','100']]} />
          <button onClick={loadList} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}>
        <FMulti label="Role" selected={filterRole} onChange={setCRole} width={140}
          opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
        <FPill label="Country" value={filterCountry} onChange={setCCountry} placeholder="US · India…" width={130} />
      </FilterBar>
      {list && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{list.total} sessions</div>}
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={loadList} /> : (
        <>
          {(list?.rows || []).length === 0
            ? <Empty label="No AI chat sessions yet" />
            : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {(list?.rows || []).map(row => (
                    <div key={`m-${row.id}`} className="card p-3 cursor-pointer"
                      onClick={() => openSession(row.id)}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex flex-wrap gap-1 items-center">
                          {roleBadge(row.role)}
                          <span className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                            {row.msg_count} msg{row.msg_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>{relTime(row.last_at)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>IP: <span className="font-mono" style={{ color: 'var(--text-2)' }}>{row.ip || '—'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>OS: <span style={{ color: 'var(--text-2)' }}>{row.os || '?'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>Location: <span style={{ color: 'var(--text-2)' }}>{[countryFlag(row.country_code), row.city, row.country].filter(Boolean).join(' ') || '—'}</span></span>
                        <span style={{ color: 'var(--text-3)' }}>Started: <span style={{ color: 'var(--text-2)' }}>{ts(row.started_at)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                        {['Role','Msgs','IP','OS / Browser','Country','Started','Last'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(list?.rows || []).map(row => (
                        <tr key={row.id} className="border-b cursor-pointer transition-colors"
                          style={{ borderColor: 'var(--border)' }}
                          onClick={() => openSession(row.id)}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td className="px-3 py-2">{roleBadge(row.role)}</td>
                          <td className="px-3 py-2 tabular-nums text-center font-semibold" style={{ color: 'var(--text-1)' }}>{row.msg_count}</td>
                          <td className="px-3 py-2 font-mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>{row.ip || '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {row.os || '?'}{row.browser ? ` / ${row.browser}` : ''}
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>
                            {[row.country, row.city].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)' }}>
                            {ts(row.started_at)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {relTime(row.last_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          <Pager total={list?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: AI Runs ──────────────────────────────────────────────────────────────

function AiRunsTab() {
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [taskPrefix, setTaskPrefix] = useState('')
  const [filterRole, setFilterRole] = useState([])
  const [filterSource, setFilterSource] = useState('')
  const [limit, setLimit] = useState(30)

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setList(await api.admin.aiGenerations({
        limit, offset,
        task_prefix: taskPrefix || undefined,
        role: filterRole[0] || undefined,
        source: filterSource || undefined,
      }))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [limit, offset, taskPrefix, filterRole, filterSource])

  useEffect(() => { setOffset(0) }, [taskPrefix, filterRole, filterSource, limit])
  useEffect(() => { loadList() }, [loadList])

  const openGeneration = useCallback(async (id) => {
    setSelected(id); setDetail(null); setDetailLoading(true)
    try { setDetail(await api.admin.aiGeneration(id)) }
    catch { setDetail({ error: true }) }
    finally { setDetailLoading(false) }
  }, [])

  if (selected) {
    const gen = detail?.generation
    return (
      <div className="space-y-3">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs btn-secondary px-3 py-1">
          <ChevronLeft size={12} /> Back to AI runs
        </button>
        {detailLoading ? <Skeleton rows={5} /> : detail?.error ? <Err msg="Failed to load AI generation" /> : gen ? (
          <div className="space-y-3">
            <div className="card p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="purple">{gen.task_type}</Badge>
                <Badge color="blue">{gen.response_mode || 'brief'}</Badge>
                {gen.verification?.source && <Badge color="teal">{gen.verification.source}</Badge>}
                {gen.metadata?.planner?.label && <Badge color="indigo">{gen.metadata.planner.label}</Badge>}
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div><span style={{ color: 'var(--text-3)' }}>Created:</span> <span style={{ color: 'var(--text-1)' }}>{ts(gen.created_at)}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Model:</span> <span style={{ color: 'var(--text-1)' }}>{gen.model || '—'}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Role:</span> <span style={{ color: 'var(--text-1)' }}>{gen.role || '—'}</span></div>
                <div><span style={{ color: 'var(--text-3)' }}>Duration:</span> <span style={{ color: 'var(--text-1)' }}>{gen.duration_ms ? `${gen.duration_ms}ms` : '—'}</span></div>
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Prompt</div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{gen.prompt || '—'}</pre>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Output</div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>{gen.output_text || '—'}</pre>
            </div>
          </div>
        ) : <Empty label="No generation detail found" />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <FilterBar
        count={(taskPrefix ? 1 : 0) + filterRole.length + (filterSource ? 1 : 0)}
        onReset={() => { setTaskPrefix(''); setFilterRole([]); setFilterSource('') }}
        rightSlot={<>
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['15','15'],['30','30'],['50','50'],['100','100']]} />
          <button onClick={loadList} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}
      >
        <FPill label="Task" value={taskPrefix} onChange={setTaskPrefix} placeholder="dashboard: / report:" width={160} />
        <FMulti label="Role" selected={filterRole} onChange={setFilterRole} width={140}
          opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
        <FSel label="Source" value={filterSource} onChange={setFilterSource}
          opts={[['','All'],['hybrid-rag','hybrid-rag'],['pg-mirror','pg-mirror'],['teable-live','teable-live']]} />
      </FilterBar>
      {list && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{list.total} AI runs</div>}
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={loadList} /> : (
        <>
          {(list?.rows || []).length === 0
            ? <Empty label="No AI runs yet" />
            : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                      {['Task','Mode','Source','Role','Duration','Created','Prompt'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(list?.rows || []).map(row => (
                      <tr key={row.id} className="border-b cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => openGeneration(row.id)}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span style={{ color: 'var(--text-1)' }}>{row.metadata?.planner?.label || row.task_type}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{row.task_type}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{row.response_mode || '—'}</td>
                        <td className="px-3 py-2">{row.verification?.source ? <Badge color="teal">{row.verification.source}</Badge> : '—'}</td>
                        <td className="px-3 py-2">{roleBadge(row.role)}</td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>{row.duration_ms ? `${row.duration_ms}ms` : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{ts(row.created_at)}</td>
                        <td className="px-3 py-2 max-w-[420px] truncate" style={{ color: 'var(--text-2)' }}>{row.prompt_preview || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <Pager total={list?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sync Log ─────────────────────────────────────────────────────────────

function SyncLogTab() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [offset, setOffset]       = useState(0)
  const [filterSource, setFs]     = useState('')
  const [filterError,  setFErr]   = useState('')   // '' | 'errors_only' | 'success_only'
  const [limit, setSLimit]        = useState(50)
  const [triggering, setTrig]     = useState(false)
  const [trigMsg, setTrigMsg]     = useState(null)
  const [diagnosing, setDiag]     = useState(false)
  const [diagResult, setDiagRes]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.syncLog({
      limit, offset,
      source:    filterSource || undefined,
      has_error: filterError === 'errors_only' ? true : filterError === 'success_only' ? false : undefined,
    })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, limit, filterSource, filterError])

  useEffect(() => { setOffset(0) }, [filterSource, filterError, limit])
  useEffect(() => { load() }, [load])

  const triggerSync = useCallback(async () => {
    setTrig(true); setTrigMsg(null)
    try {
      await api.admin.triggerSync()
      setTrigMsg({ ok: true, text: 'Full sync triggered — results appear in a few seconds' })
      setTimeout(() => { load(); setTrigMsg(null) }, 4000)
    } catch (e) {
      setTrigMsg({ ok: false, text: e.message || 'Trigger failed' })
    } finally {
      setTrig(false)
    }
  }, [load])

  const diagnoseSync = useCallback(async () => {
    setDiag(true); setDiagRes(null)
    try {
      const res = await api.admin.diagnoseSync()
      setDiagRes(res)
    } catch (e) {
      setDiagRes({ error: e.message })
    } finally {
      setDiag(false)
    }
  }, [])

  const sourceColor = { projects: 'blue', invoices: 'purple', web_invoices: 'teal' }

  return (
    <div className="space-y-3">
      <FilterBar
        count={(filterSource ? 1 : 0) + (filterError ? 1 : 0)}
        onReset={() => { setFs(''); setFErr('') }}
        rightSlot={<>
          <FSel label="Limit" value={String(limit)} onChange={v => setSLimit(Number(v))}
            opts={[['25','25'],['50','50'],['100','100'],['200','200']]} />
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}>
        <FSel label="Source" value={filterSource} onChange={setFs} width={140}
          opts={[['','All sources'],['projects','projects'],['invoices','invoices'],['web_invoices','web_invoices']]} />
        <FSel label="Result" value={filterError} onChange={setFErr} width={140}
          opts={[['','All results'],['errors_only','Errors only'],['success_only','Success only']]} />
      </FilterBar>
      {data && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{data.total} runs</div>}

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={triggerSync} disabled={triggering}
          className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          style={{
            background: triggering ? 'var(--bg-input)' : 'rgba(37,99,235,0.08)',
            border: '1px solid rgba(37,99,235,0.25)',
            color: triggering ? 'var(--text-3)' : '#2563eb',
            opacity: triggering ? 0.6 : 1,
          }}>
          <Play size={11} /> {triggering ? 'Triggering…' : 'Trigger Full Sync Now'}
        </button>
        <button onClick={diagnoseSync} disabled={diagnosing}
          className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          style={{
            background: 'rgba(234,179,8,0.08)',
            border: '1px solid rgba(234,179,8,0.3)',
            color: '#b45309',
            opacity: diagnosing ? 0.6 : 1,
          }}>
          🔍 {diagnosing ? 'Testing…' : 'Diagnose Tokens'}
        </button>
      </div>

      {/* Diagnose results panel */}
      {diagResult && !diagResult.error && (
        <div className="rounded-xl border p-3 space-y-2 text-xs"
          style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.04)' }}>
          <div className="font-semibold" style={{ color: '#b45309' }}>
            Token/Table connectivity — {diagResult.configured_tokens} token(s) configured
          </div>
          {Object.entries(diagResult.tables || {}).map(([tname, info]) => (
            <div key={tname} className="rounded-lg p-2 border" style={{ borderColor: 'var(--border)', background: 'var(--bg-layer)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Badge color={sourceColor[tname] || 'default'}>{tname}</Badge>
                <span style={{ color: 'var(--text-3)' }}>{info.table_id || 'not configured'}</span>
                {info.mirror_rows != null && (
                  <span className="ml-auto font-mono" style={{ color: 'var(--text-2)' }}>
                    {info.mirror_rows} rows in mirror
                  </span>
                )}
              </div>
              {info.note && <div style={{ color: 'var(--text-3)' }}>{info.note}</div>}
              {Object.entries(info.token_results || {}).map(([tok, res]) => (
                <div key={tok} className="flex items-center gap-2 pl-2 py-0.5">
                  <span className={res.status === 'ok' ? 'text-green-500' : 'text-red-500'}>
                    {res.status === 'ok' ? '✓' : '✕'}
                  </span>
                  <span style={{ color: 'var(--text-2)' }}>{tok}</span>
                  {res.status === 'ok'
                    ? <span style={{ color: 'var(--text-3)' }}>HTTP {res.http} · {res.total_records} records in Teable</span>
                    : <span className="text-red-400">HTTP {res.http} — {res.detail}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {diagResult?.error && (
        <div className="text-xs px-3 py-2 rounded-lg text-red-500"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
          ✕ Diagnose failed: {diagResult.error}
        </div>
      )}

      {trigMsg && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{
            background: trigMsg.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
            color: trigMsg.ok ? '#16a34a' : '#dc2626',
            border: `1px solid ${trigMsg.ok ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.2)'}`,
          }}>
          {trigMsg.ok ? '✓' : '✕'} {trigMsg.text}
        </div>
      )}
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {(data?.rows || []).length === 0
            ? <Empty label="No sync runs yet — check TEABLE_API_TOKEN is set" />
            : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {(data?.rows || []).map(row => (
                    <div key={`m-${row.id}`} className="card p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge color={sourceColor[row.source] || 'default'}>{row.source}</Badge>
                          {row.error
                            ? <span className="text-[11px] text-red-500">✕ Error</span>
                            : <span className="text-[11px]" style={{ color: '#16a34a' }}>✓ OK</span>}
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ts(row.synced_at)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>Total: <b style={{ color: 'var(--text-1)' }}>{fmt(row.total)}</b></span>
                        <span style={{ color: 'var(--text-3)' }}>Duration: <b style={{ color: 'var(--text-1)' }}>{row.duration_ms != null ? `${row.duration_ms}ms` : '—'}</b></span>
                        <span style={{ color: row.created > 0 ? '#16a34a' : 'var(--text-3)' }}>+{fmt(row.created)} new</span>
                        <span style={{ color: row.updated > 0 ? '#d97706' : 'var(--text-3)' }}>~{fmt(row.updated)} updated</span>
                        <span style={{ color: 'var(--text-3)' }}>{fmt(row.unchanged)} unchanged</span>
                      </div>
                      {row.error && <p className="text-[11px] text-red-500 mt-1.5 line-clamp-2">{row.error}</p>}
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                        {['Time','Source','Total','Created','Updated','Unchanged','ms','Status'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.rows || []).map(row => (
                        <tr key={row.id} className="border-b transition-colors"
                          style={{ borderColor: 'var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                            {ts(row.synced_at)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge color={sourceColor[row.source] || 'default'}>{row.source}</Badge>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right">{fmt(row.total)}</td>
                          <td className="px-3 py-2 tabular-nums text-right font-semibold" style={{ color: row.created > 0 ? '#16a34a' : 'var(--text-3)' }}>{fmt(row.created)}</td>
                          <td className="px-3 py-2 tabular-nums text-right font-semibold" style={{ color: row.updated > 0 ? '#d97706' : 'var(--text-3)' }}>{fmt(row.updated)}</td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-3)' }}>{fmt(row.unchanged)}</td>
                          <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                            {row.duration_ms != null ? row.duration_ms : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {row.error
                              ? <span className="text-[11px] text-red-500 truncate max-w-[160px] block" title={row.error}>✕ {row.error}</span>
                              : <span className="text-[11px]" style={{ color: '#16a34a' }}>✓ OK</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Projects mirror ──────────────────────────────────────────────────────

function ProjectsMirrorTab() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [offset, setOffset]     = useState(0)
  const [q, setQ]               = useState('')
  const [filterStatus, setPStatus]= useState([])
  const [filterName, setPName]  = useState('')
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.mirrorProjects({
      limit, offset,
      client:       q            || undefined,
      project_name: filterName   || undefined,
      status:       filterStatus[0] || undefined,
    })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, q, filterStatus, filterName])

  useEffect(() => { setOffset(0) }, [q, filterStatus, filterName])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <FilterBar
        count={(q ? 1 : 0) + filterStatus.length + (filterName ? 1 : 0)}
        onReset={() => { setQ(''); setPStatus([]); setPName('') }}
        rightSlot={
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        }>
        <FPill label="Client" value={q} onChange={setQ} placeholder="Acme…" width={150} />
        <FPill label="Project" value={filterName} onChange={setPName} placeholder="Project name…" width={160} />
        <FMulti label="Status" selected={filterStatus} onChange={setPStatus} width={140}
          opts={[['Active','Active'],['Completed','Completed'],['On Hold','On Hold'],['Cancelled','Cancelled']]} />
      </FilterBar>
      {data && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{data.total.toLocaleString()} rows</div>}
      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {(data?.rows || []).length === 0
            ? <Empty label="No projects synced yet" />
            : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {(data?.rows || []).map((row, i) => (
                    <div key={row.teable_id || i} className="card p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{row.project_name || '—'}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{row.client || '—'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {row.status && <Badge>{row.status}</Badge>}
                          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ts(row.synced_at)}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>Billed</p>
                          <p className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                            {row.amount_billed != null ? `₹${Number(row.amount_billed).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>Profit</p>
                          <p className="font-semibold tabular-nums"
                            style={{ color: row.actual_profit > 0 ? '#16a34a' : row.actual_profit < 0 ? '#dc2626' : 'var(--text-2)' }}>
                            {row.actual_profit != null ? `₹${Number(row.actual_profit).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>Margin</p>
                          <p className="font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                            {row.profit_pct != null ? `${Number(row.profit_pct).toFixed(1)}%` : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                        {['Synced','Name','Client','Status','Billed','Profit','Profit %','Modified'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.rows || []).map((row, i) => (
                        <tr key={row.teable_id || i} className="border-b transition-colors"
                          style={{ borderColor: 'var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)', fontSize: 11 }}>{ts(row.synced_at)}</td>
                          <td className="px-3 py-2 max-w-[160px] truncate font-medium" style={{ color: 'var(--text-1)' }} title={row.project_name}>{row.project_name || '—'}</td>
                          <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: 'var(--text-2)' }} title={row.client}>{row.client || '—'}</td>
                          <td className="px-3 py-2">{row.status ? <Badge>{row.status}</Badge> : '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                            {row.amount_billed != null ? Number(row.amount_billed).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: row.actual_profit > 0 ? '#16a34a' : row.actual_profit < 0 ? '#dc2626' : 'var(--text-2)' }}>
                            {row.actual_profit != null ? Number(row.actual_profit).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                            {row.profit_pct != null ? `${Number(row.profit_pct).toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)', fontSize: 11 }}>{ts(row.modified_time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: All Invoices (main + web) ────────────────────────────────────────────

function InvoicesTab() {
  const [source, setSource]       = useState('all')   // 'all' | 'main' | 'web'
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [offset, setOffset]       = useState(0)
  const [statusF, setStatF]       = useState('')
  const [filterProject, setFProject] = useState('')
  const [filterNumber,  setFNumber]  = useState('')
  const [filterFrom,    setFFrom]    = useState('')
  const [filterTo,      setFTo]      = useState('')
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = {
      limit, offset,
      payment_status: statusF        || undefined,
      project:        filterProject  || undefined,
      invoice_number: filterNumber   || undefined,
      from_ts:        filterFrom     || undefined,
      to_ts:          filterTo       || undefined,
    }
    try {
      if (source === 'main') {
        const d = await api.admin.mirrorInvoices(p)
        setData({ ...d, rows: d.rows.map(r => ({ ...r, _src: 'main' })) })
      } else if (source === 'web') {
        const d = await api.admin.mirrorWebInvoices(p)
        setData({ ...d, rows: d.rows.map(r => ({ ...r, _src: 'web' })) })
      } else {
        // Fetch both in parallel, merge & sort by raised_date DESC
        const [main, web] = await Promise.all([
          api.admin.mirrorInvoices({ ...p, limit: 500 }).catch(() => ({ rows: [], total: 0 })),
          api.admin.mirrorWebInvoices({ ...p, limit: 500 }).catch(() => ({ rows: [], total: 0 })),
        ])
        const combined = [
          ...main.rows.map(r => ({ ...r, _src: 'main' })),
          ...web.rows.map(r => ({ ...r, _src: 'web' })),
        ].sort((a, b) => {
          if (!a.raised_date && !b.raised_date) return 0
          if (!a.raised_date) return 1
          if (!b.raised_date) return -1
          return b.raised_date.localeCompare(a.raised_date)
        })
        const total = main.total + web.total
        const slice = combined.slice(offset, offset + limit)
        setData({ total, limit, offset, rows: slice })
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [source, offset, statusF, filterProject, filterNumber, filterFrom, filterTo])

  useEffect(() => { setOffset(0) }, [source, statusF, filterProject, filterNumber, filterFrom, filterTo])
  useEffect(() => { load() }, [load])

  const advCount = [statusF, filterProject, filterNumber, filterFrom, filterTo].filter(Boolean).length

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div className="flex gap-2 items-center flex-wrap">
        {['all','main','web'].map(s => (
          <button key={s} onClick={() => setSource(s)}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{
              background: source === s ? 'rgba(37,99,235,0.08)' : 'var(--bg-input)',
              borderColor: source === s ? 'rgba(37,99,235,0.3)' : 'var(--border)',
              color: source === s ? '#2563eb' : 'var(--text-2)',
            }}>
            {s === 'all' ? 'All invoices' : s === 'main' ? 'Main (Teable)' : 'Web invoices'}
          </button>
        ))}
      </div>

      <FilterBar
        count={advCount}
        onReset={() => { setStatF(''); setFProject(''); setFNumber(''); setFFrom(''); setFTo('') }}
        rightSlot={
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        }>
        <FSel label="Status" value={statusF} onChange={setStatF} width={140}
          opts={[['','All statuses'],['Paid','Paid'],['Pending','Pending'],['Partial','Partial'],['Overdue','Overdue']]} />
        <FPill label="Invoice #" value={filterNumber} onChange={setFNumber} placeholder="INV-…" width={120} />
        <FPill label="Project" value={filterProject} onChange={setFProject} placeholder="Project name…" width={150} />
        <FPill label="From" value={filterFrom} onChange={setFFrom} type="date" width={130} />
        <FPill label="To" value={filterTo} onChange={setFTo} type="date" width={130} />
      </FilterBar>
      {data && (
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          {data.total.toLocaleString()} invoices
        </div>
      )}

      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {(data?.rows || []).length === 0
            ? <Empty label="No invoices found — sync may not have run yet" />
            : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {(data?.rows || []).map((row, i) => (
                    <div key={`m-${row._src}-${row.teable_id || i}`} className="card p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-wrap gap-1 items-center">
                          <Badge color={row._src === 'web' ? 'teal' : 'blue'}>{row._src}</Badge>
                          <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>{row.invoice_number || '—'}</span>
                          {row.payment_status && (
                            <Badge color={/paid/i.test(row.payment_status) ? 'green' : /partial/i.test(row.payment_status) ? 'amber' : /over/i.test(row.payment_status) ? 'red' : 'default'}>
                              {row.payment_status}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] flex-shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>{row.raised_date || '—'}</span>
                      </div>
                      <p className="text-xs mb-2 truncate" style={{ color: 'var(--text-2)' }}>{row.project || '—'}{row.category ? ` · ${row.category}` : ''}</p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>Raised</p>
                          <p className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                            {row.amount_raised != null ? `₹${Number(row.amount_raised).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>w/ Tax</p>
                          <p className="font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                            {row.amount_with_tax != null ? `₹${Number(row.amount_with_tax).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--text-3)' }}>Received</p>
                          <p className="font-semibold tabular-nums"
                            style={{ color: row.amount_received > 0 ? '#16a34a' : 'var(--text-3)' }}>
                            {row.amount_received != null ? `₹${Number(row.amount_received).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                        {['Src','Invoice #','Project','Category','Status','Raised','w/ Tax','Received','Date'].map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.rows || []).map((row, i) => (
                        <tr key={`${row._src}-${row.teable_id || i}`} className="border-b transition-colors"
                          style={{ borderColor: 'var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td className="px-3 py-2">
                            <Badge color={row._src === 'web' ? 'teal' : 'blue'}>{row._src}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-1)', fontSize: 11 }}>
                            {row.invoice_number || '—'}
                          </td>
                          <td className="px-3 py-2 max-w-[140px] truncate" style={{ color: 'var(--text-2)' }} title={row.project}>
                            {row.project || '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                            {row.category || '—'}
                          </td>
                          <td className="px-3 py-2">
                            {row.payment_status
                              ? <Badge color={
                                  /paid/i.test(row.payment_status) ? 'green'
                                  : /partial/i.test(row.payment_status) ? 'amber'
                                  : /over/i.test(row.payment_status) ? 'red'
                                  : 'default'
                                }>{row.payment_status}</Badge>
                              : '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                            {row.amount_raised != null ? Number(row.amount_raised).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                            {row.amount_with_tax != null ? Number(row.amount_with_tax).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right"
                            style={{ color: row.amount_received > 0 ? '#16a34a' : 'var(--text-3)' }}>
                            {row.amount_received != null ? Number(row.amount_received).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)', fontSize: 11 }}>
                            {row.raised_date || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Record History ───────────────────────────────────────────────────────

function DetailKV({ k, v, mono = false }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{k}</span>
      <span className={`text-[11px] truncate ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--text-1)' }}>{v}</span>
    </div>
  )
}

function HistoryTab() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const [expanded, setExp]    = useState(null)
  const [filterSrc, setFs]    = useState('')
  const [filterConditions, setFilterConditions] = useState([])
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.recordHistory({ limit, offset, source_table: filterSrc || undefined })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, filterSrc])

  useEffect(() => { setOffset(0) }, [filterSrc])
  useEffect(() => { load() }, [load])

  const sourceColor = { projects: 'blue', invoices: 'purple', web_invoices: 'teal' }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect
          value={filterSrc}
          onChange={setFs}
          options={['projects','invoices','web_invoices']}
          placeholder="All sources"
          width={150}
        />
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
            {data.total.toLocaleString()} changes
          </span>
        )}
      </div>
      {/* Advanced filter builder */}
      <FilterBuilder
        fields={[
          { key: 'change_type',          label: 'Change Type',     type: 'text' },
          { key: 'source_table',         label: 'Source Table',    type: 'text' },
          { key: 'teable_id',            label: 'Record ID',       type: 'text' },
          { key: 'change_source',        label: 'Origin',          type: 'text' },
          { key: 'actor_role',           label: 'Actor Role',      type: 'text' },
          { key: 'actor_country',        label: 'Country',         type: 'text' },
          { key: 'actor_city',           label: 'City',            type: 'text' },
          { key: 'actor_ip',             label: 'IP',              type: 'text' },
          { key: 'actor_device_label',   label: 'Device Label',    type: 'text' },
          { key: 'actor_device_model',   label: 'Device Model',    type: 'text' },
          { key: 'actor_os',             label: 'OS',              type: 'text' },
          { key: 'actor_browser',        label: 'Browser',         type: 'text' },
          { key: 'actor_device',         label: 'Form Factor',     type: 'text' },
          { key: 'actor_gpu',            label: 'GPU',             type: 'text' },
          { key: 'actor_timezone',       label: 'Timezone',        type: 'text' },
        ]}
        records={data?.rows || []}
        getFieldValue={r => r}
        conditions={filterConditions}
        onChange={setFilterConditions}
        label="Add condition filter"
      />
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {applyConditions(data?.rows || [], filterConditions, r => r).length === 0
            ? <Empty label="No change history yet" />
            : (
              <div className="space-y-1">
                {applyConditions(data?.rows || [], filterConditions, r => r).map(row => (
                  <div key={row.id} className="rounded-xl border overflow-hidden"
                    style={{ borderColor: 'var(--border)' }}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                      style={{ background: 'var(--card-bg)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}
                      onClick={() => setExp(expanded === row.id ? null : row.id)}>
                      <Badge color={row.change_type === 'create' ? 'green' : row.change_type === 'delete' ? 'red' : 'amber'}>
                        {row.change_type}
                      </Badge>
                      <Badge color={sourceColor[row.source_table] || 'default'}>{row.source_table}</Badge>
                      {row.actor_role && (
                        <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
                          title={row.actor_device_label || ''}>
                          {row.actor_role} · {row.actor_device_model || row.actor_city || row.actor_country || row.actor_ip || 'system'}
                        </span>
                      )}
                      {row.actor_device_label && (
                        <span className="text-[10px] hidden md:inline-block truncate max-w-[280px]" style={{ color: 'var(--text-3)' }}>
                          {row.actor_device_label}
                        </span>
                      )}
                      <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-2)' }}>
                        {row.teable_id}
                      </span>
                      {row.changed_fields?.length > 0 && (
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {row.changed_fields.slice(0, 3).join(', ')}{row.changed_fields.length > 3 ? ` +${row.changed_fields.length - 3}` : ''}
                        </span>
                      )}
                      <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                        {ts(row.recorded_at)}
                      </span>
                    </button>
                    {expanded === row.id && (
                      <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                        {(row.actor_role || row.change_source === 'sync') && (
                          <div className="rounded-lg p-3 space-y-3"
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                Actor · {row.change_source === 'user' ? 'User mutation' : row.change_source === 'sync' ? 'Background sync' : (row.change_source || 'unknown')}
                              </p>
                              {row.actor_device_label && (
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded"
                                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                  {row.actor_device_label}
                                </span>
                              )}
                            </div>

                            {/* ── WHO ── */}
                            <div>
                              <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Identity</p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[11px]">
                                {row.actor_role && <DetailKV k="Role" v={row.actor_role} />}
                                {row.actor_method && row.actor_path && <DetailKV k="API" v={`${row.actor_method} ${row.actor_path}`} mono />}
                                {row.actor_session_id && <DetailKV k="Session" v={String(row.actor_session_id).slice(0, 8) + '…'} mono />}
                              </div>
                            </div>

                            {/* ── WHERE ── */}
                            {(row.actor_ip || row.actor_country || row.actor_city || row.actor_isp) && (
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Network · Location</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[11px]">
                                  {row.actor_ip && <DetailKV k="IP" v={row.actor_ip} mono />}
                                  {(row.actor_country || row.actor_city) && (
                                    <DetailKV k="Location" v={[row.actor_city, row.actor_region, row.actor_country].filter(Boolean).join(', ')} />
                                  )}
                                  {row.actor_isp && <DetailKV k="ISP" v={row.actor_isp} />}
                                  {row.actor_network && <DetailKV k="Connection" v={row.actor_network} />}
                                  {row.actor_timezone && <DetailKV k="Timezone" v={row.actor_timezone} />}
                                  {row.actor_language && <DetailKV k="Language" v={row.actor_language} />}
                                  {(row.actor_lat != null && row.actor_lon != null) && (
                                    <DetailKV k="Coords" v={
                                      <a href={`https://www.google.com/maps?q=${row.actor_lat},${row.actor_lon}`}
                                         target="_blank" rel="noopener noreferrer"
                                         style={{ color: 'var(--accent)' }}>
                                        {Number(row.actor_lat).toFixed(3)}, {Number(row.actor_lon).toFixed(3)} ↗
                                      </a>
                                    } />
                                  )}
                                </div>
                              </div>
                            )}

                            {/* ── DEVICE ── */}
                            {(row.actor_os || row.actor_browser || row.actor_device || row.actor_device_model || row.actor_gpu) && (
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Device</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[11px]">
                                  {row.actor_device_model && <DetailKV k="Model" v={row.actor_device_model} />}
                                  {row.actor_os && <DetailKV k="OS" v={`${row.actor_os}${row.actor_platform_version ? ' ' + row.actor_platform_version : ''}`} />}
                                  {row.actor_arch && <DetailKV k="Architecture" v={row.actor_arch} mono />}
                                  {row.actor_device && <DetailKV k="Form factor" v={row.actor_device} />}
                                  {row.actor_browser && <DetailKV k="Browser" v={row.actor_browser} />}
                                  {row.actor_cpu_cores != null && <DetailKV k="CPU cores" v={String(row.actor_cpu_cores)} />}
                                  {row.actor_memory_gb != null && <DetailKV k="Memory" v={`${row.actor_memory_gb} GB`} />}
                                  {row.actor_gpu && <DetailKV k="GPU" v={row.actor_gpu} />}
                                  {row.actor_screen && <DetailKV k="Screen" v={row.actor_screen} mono />}
                                </div>
                              </div>
                            )}

                            {row.actor_user_agent && (
                              <p className="text-[10px] font-mono truncate pt-1.5" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--card-border)' }}
                                title={row.actor_user_agent}>
                                UA: {row.actor_user_agent}
                              </p>
                            )}
                          </div>
                        )}
                        {row.changed_fields?.length > 0 && (
                          <div className="rounded-lg p-3 space-y-2 mt-2"
                            style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                              Field changes ({row.changed_fields.length})
                            </p>
                            <div className="space-y-1.5">
                              {row.changed_fields.map(field => {
                                const oldV = row.old_fields?.[field]
                                const newV = row.new_fields?.[field]
                                return (
                                  <div key={field} className="text-[11px] grid grid-cols-[120px_1fr] gap-2 items-start">
                                    <span className="font-mono font-semibold truncate" style={{ color: 'var(--text-2)' }}>{field}</span>
                                    <div className="space-y-0.5">
                                      {oldV != null && (
                                        <div className="flex items-start gap-1.5">
                                          <span className="text-[9px] mt-0.5 font-bold" style={{ color: 'var(--fin-negative)' }}>−</span>
                                          <span className="truncate" style={{ color: 'var(--fin-negative)', background: 'var(--fin-neg-bg)', padding: '1px 6px', borderRadius: 4 }}>
                                            {typeof oldV === 'object' ? JSON.stringify(oldV) : String(oldV)}
                                          </span>
                                        </div>
                                      )}
                                      {newV != null && (
                                        <div className="flex items-start gap-1.5">
                                          <span className="text-[9px] mt-0.5 font-bold" style={{ color: 'var(--fin-positive)' }}>+</span>
                                          <span className="truncate" style={{ color: 'var(--fin-positive)', background: 'var(--fin-pos-bg)', padding: '1px 6px', borderRadius: 4 }}>
                                            {typeof newV === 'object' ? JSON.stringify(newV) : String(newV)}
                                          </span>
                                        </div>
                                      )}
                                      {oldV == null && newV == null && (
                                        <span className="italic" style={{ color: 'var(--text-3)' }}>—</span>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

function SharedLinksTab() {
  const [data, setData] = useState({ views: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [resourceType, setResourceType] = useState('')
  const [selected, setSelected] = useState(null)
  const [accesses, setAccesses] = useState([])
  const [loadingAccesses, setLoadingAccesses] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.admin.sharedLinks({ resource_type: resourceType || undefined }))
    } finally {
      setLoading(false)
    }
  }, [resourceType])

  useEffect(() => { load() }, [load])

  async function toggleAccesses(token) {
    if (selected === token) { setSelected(null); return }
    setSelected(token)
    setLoadingAccesses(true)
    try {
      const res = await api.admin.sharedLinkAccesses(token)
      setAccesses(res.accesses || [])
    } finally {
      setLoadingAccesses(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Shared Links</h2>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Public link inventory with unique viewers and edit events.</p>
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect label="Module" value={resourceType} onChange={setResourceType}>
            <option value="">All modules</option>
            <option value="status">Status</option>
            <option value="projects">Projects</option>
            <option value="invoices">Invoices</option>
          </FilterSelect>
          <button onClick={load} className="btn-ghost text-xs px-3 py-2 flex items-center gap-1.5"><RefreshCw size={12} />Refresh</button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? <Skeleton rows={6} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Title','Module','Access','Viewers','Created','Last Seen','Token','Logs'].map(h => <th key={h} className="tbl-head">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(data.views || []).map(v => (
                  <>
                    <tr key={v.token} className="tbl-row">
                      <td className="tbl-cell font-medium" style={{ color: 'var(--text-1)' }}>{v.title || 'Untitled link'}</td>
                      <td className="tbl-cell"><Badge color="blue">{(v.resource_type || 'status').toUpperCase()}</Badge></td>
                      <td className="tbl-cell"><Badge color={v.access_mode === 'edit' ? 'amber' : 'green'}>{v.access_mode || 'read'}</Badge></td>
                      <td className="tbl-cell">{fmt(v.access_count || 0)}</td>
                      <td className="tbl-cell">{ts(v.created_at)}</td>
                      <td className="tbl-cell">{ts(v.last_accessed_at)}</td>
                      <td className="tbl-cell"><code className="text-[11px]">{v.token}</code></td>
                      <td className="tbl-cell">
                        <button onClick={() => toggleAccesses(v.token)} className="btn-ghost text-xs px-2 py-1">{selected === v.token ? 'Hide' : 'Show'}</button>
                      </td>
                    </tr>
                    {selected === v.token && (
                      <tr key={`${v.token}:logs`}>
                        <td colSpan={8} className="tbl-cell" style={{ background: 'var(--bg-input)' }}>
                          {loadingAccesses ? <Skeleton rows={3} /> : accesses.length === 0 ? (
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>No events yet.</p>
                          ) : (
                            <div className="space-y-2 max-h-72 overflow-y-auto">
                              {accesses.map((a, i) => (
                                <div key={i} className="rounded-xl px-3 py-2 text-xs flex items-start justify-between gap-3"
                                  style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Badge color={a.event_type === 'edit' ? 'amber' : 'green'}>{String(a.event_type || 'view').toUpperCase()}</Badge>
                                      <span className="font-mono">{a.ip || '?'}</span>
                                      {a.country && <span style={{ color: 'var(--text-3)' }}>{[a.city, a.region, a.country].filter(Boolean).join(', ')}</span>}
                                      {a.geo_source && <span style={{ color: 'var(--text-3)' }}>{a.geo_source === 'browser' ? 'GPS' : 'IP Geo'}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap" style={{ color: 'var(--text-3)' }}>
                                      {a.device_label && <span>{a.device_label}</span>}
                                      {a.record_id && <code>{a.record_id}</code>}
                                    </div>
                                  </div>
                                  <span className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>{ts(a.accessed_at)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {!data.views?.length && (
                  <tr><td colSpan={8} className="tbl-cell text-center" style={{ color: 'var(--text-3)' }}>No shared links found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Tab: HF Logs ──────────────────────────────────────────────────────────────

// Strip ANSI escape codes from log text
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '')
}

// Colour-code log lines by severity
function logLineColor(text) {
  const t = text.toUpperCase()
  if (t.includes(' ERROR') || t.includes('[ERROR]') || t.includes('TRACEBACK') || t.includes('EXCEPTION'))
    return '#f87171'   // red
  if (t.includes(' WARNING') || t.includes('[WARNING]') || t.includes('[WARN]'))
    return '#fbbf24'   // amber
  if (t.includes(' INFO') || t.includes('[INFO]'))
    return '#86efac'   // green
  if (t.includes('DEBUG') || t.includes('[DEBUG]'))
    return '#94a3b8'   // slate
  return '#e2e8f0'     // default light
}

function HfLogsTab() {
  const [logType, setLogType]   = useState('run')
  const [lines, setLines]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [lastFetch, setLastFetch] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchLogs = useCallback(async (type = logType) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.admin.getLogs(type, 400)
      setLines(data.lines || [])
      setLastFetch(new Date())
    } catch (e) {
      setError(e?.error || e?.message || 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [logType])

  // Auto-refresh every 20 s when the tab is active and autoRefresh is on
  useEffect(() => {
    fetchLogs(logType)
    if (!autoRefresh) return
    const id = setInterval(() => fetchLogs(logType), 20_000)
    return () => clearInterval(id)
  }, [logType, autoRefresh, fetchLogs])

  // Auto-scroll to bottom when new lines arrive
  const bottomRef = useCallback(node => {
    if (node) node.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="rounded-xl p-3 flex flex-wrap items-center gap-2"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <Terminal size={14} style={{ color: '#dc2626' }} />
        <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
          HF Space Logs
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          Mayukhj24/fintrack-api
        </span>

        {/* Run / Build toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg p-0.5"
          style={{ background: 'var(--bg-input)' }}>
          {['run', 'build'].map(t => (
            <button key={t}
              onClick={() => setLogType(t)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={logType === t
                ? { background: 'rgba(220,38,38,0.15)', color: '#dc2626' }
                : { color: 'var(--text-3)' }}>
              {t === 'run' ? '▶ Runtime' : '🔨 Build'}
            </button>
          ))}
        </div>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            background: autoRefresh ? 'rgba(34,197,94,0.10)' : 'var(--bg-input)',
            color:      autoRefresh ? '#22c55e' : 'var(--text-3)',
          }}>
          <Activity size={11} />
          {autoRefresh ? 'Live' : 'Paused'}
        </button>

        {/* Manual refresh */}
        <button
          onClick={() => fetchLogs(logType)}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
          style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>

        {lastFetch && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {lines.length} lines · fetched {lastFetch.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl p-3 text-xs flex items-start gap-2"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#f87171' }}>
          <XCircle size={13} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Failed to load logs</p>
            <p className="mt-0.5 opacity-80">{error}</p>
            {error.includes('HF_TOKEN') && (
              <p className="mt-1 opacity-70">
                Set <code className="font-mono bg-black/20 px-1 rounded">HF_TOKEN</code> in your HF Space → Settings → Repository secrets.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      {!error && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {/* Terminal header */}
          <div className="flex items-center gap-1.5 px-3 py-2"
            style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            <span className="ml-2 text-[10px] font-mono" style={{ color: '#64748b' }}>
              {logType === 'run' ? 'runtime logs' : 'build logs'} — Mayukhj24/fintrack-api
            </span>
            {loading && (
              <span className="ml-auto text-[10px] font-mono flex items-center gap-1"
                style={{ color: '#22c55e' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                fetching…
              </span>
            )}
          </div>

          {/* Log lines */}
          <div className="overflow-y-auto font-mono text-[11px] leading-relaxed"
            style={{ background: '#0f172a', maxHeight: 560, minHeight: 200 }}>
            {lines.length === 0 && !loading ? (
              <div className="p-4 text-center text-[11px]" style={{ color: '#475569' }}>
                {logType === 'run' ? 'No runtime log lines fetched yet.' : 'No build log lines fetched yet.'}
              </div>
            ) : (
              lines.map((line, i) => {
                const clean = stripAnsi(line.text || '')
                const color = logLineColor(clean)
                return (
                  <div key={i} className="flex gap-2 px-3 py-0.5 hover:bg-white/[0.03]">
                    {line.ts && (
                      <span className="flex-shrink-0 text-[10px] tabular-nums select-none"
                        style={{ color: '#334155', minWidth: 140 }}>
                        {line.ts}
                      </span>
                    )}
                    <span style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {clean}
                    </span>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── AssociationsTab ───────────────────────────────────────────────────────────

function AssociationsTab() {
  const [stats, setStats]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [resetting, setResetting]   = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetResult, setResetResult]   = useState(null)
  const [error, setError]           = useState(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await api.associations.stats()
      setStats(s)
    } catch (e) {
      setError(e.message || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const handleReset = async () => {
    setResetting(true)
    setError(null)
    setResetResult(null)
    try {
      const res = await api.associations.reset()
      setResetResult(res)
      setConfirmReset(false)
      await loadStats()
    } catch (e) {
      setError(e.message || 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="p-4 space-y-5 max-w-3xl">

      {/* Stats cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            Association entity counts
          </h2>
          <button onClick={loadStats} disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {loading && !stats ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
            <RefreshCw size={13} className="animate-spin" /> Loading stats…
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Client entities',     value: stats.client_entities,      color: '#3b82f6' },
              { label: 'Project entities',    value: stats.project_entities,     color: '#8b5cf6' },
              { label: 'Record links (total)',value: stats.record_links,         color: '#10b981' },
              { label: 'Manual links',        value: stats.record_links_manual,  color: '#f59e0b' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-3"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color }}>{fmt(value ?? 0)}</p>
              </div>
            ))}
          </div>
        ) : null}

        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm mt-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
            <AlertCircle size={14} className="flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* How bulk-link works */}
      <div className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-1)' }}>
          How the association system works
        </h3>
        <ul className="space-y-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
          <li>• Use the <strong style={{ color: 'var(--text-2)' }}>🔗 Link</strong> button on any Status, Project or Invoice record to open the link modal.</li>
          <li>• Type a <strong style={{ color: 'var(--text-2)' }}>client name</strong> and/or <strong style={{ color: 'var(--text-2)' }}>project name</strong>, then click <em>Link across all modules</em>.</li>
          <li>• The backend scans all 4 mirror tables and links every matching record in a single operation.</li>
          <li>• All links are <strong style={{ color: 'var(--text-2)' }}>manual (confidence 100)</strong> — no auto-linking runs in the background.</li>
          <li>• Use the search field in the modal to find and reuse existing canonical names.</li>
        </ul>
      </div>

      {/* Reset section */}
      <div className="rounded-xl p-4 space-y-3"
        style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
        <div>
          <h3 className="text-xs font-semibold mb-1" style={{ color: '#f87171' }}>
            Danger zone — reset all associations
          </h3>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Deletes ALL rows from <code>record_links</code>, <code>project_entities</code>, and <code>client_entities</code>.
            This is irreversible. Use only to start fresh after bad auto-links.
          </p>
        </div>

        {resetResult && (
          <div className="rounded-lg px-3 py-2 text-xs"
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981' }}>
            <CheckCircle2 size={12} className="inline mr-1.5" />
            Reset complete — deleted: record_links={resetResult.deleted?.record_links ?? 0}, client_entities={resetResult.deleted?.client_entities ?? 0}, project_entities={resetResult.deleted?.project_entities ?? 0}
          </div>
        )}

        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.18)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.10)'}
          >
            <Trash2 size={11} /> Reset all associations
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: '#f87171' }}>
              Are you sure? This cannot be undone.
            </span>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: '#dc2626', color: '#fff' }}
            >
              {resetting ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
              {resetting ? 'Resetting…' : 'Yes, reset'}
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',      label: 'Overview',      icon: LayoutDashboard  },
  { id: 'audit',         label: 'Audit Log',     icon: ScrollText        },
  { id: 'sessions',      label: 'Sessions',      icon: Users             },
  { id: 'chats',         label: 'AI Chats',      icon: MessageSquareText },
  { id: 'ai-runs',       label: 'AI Runs',       icon: Zap               },
  { id: 'sync',          label: 'Sync Log',      icon: RefreshCw         },
  { id: 'projects',      label: 'Projects',      icon: Database          },
  { id: 'invoices',      label: 'Invoices',      icon: FileText          },
  { id: 'history',       label: 'History',       icon: History           },
  { id: 'shared',        label: 'Shared',        icon: Link2             },
  { id: 'associations',  label: 'Associations',  icon: Link2             },
  { id: 'hflogs',        label: 'HF Logs',       icon: Terminal          },
]

export default function AdminDashboard({ embedded = false }) {
  const { logout } = useAuth()
  const [tab, setTab] = useState('overview')

  const tabBar = (
    <div className={`flex overflow-x-auto gap-0.5 px-2 py-2 ${embedded ? 'rounded-xl border mb-4' : 'sticky top-[49px] z-10'}`}
      style={embedded
        ? { background: 'var(--card-bg)', borderColor: 'var(--border)' }
        : { background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => setTab(id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
          style={tab === id
            ? { background: 'rgba(220,38,38,0.10)', color: '#dc2626' }
            : { color: 'var(--text-3)', background: 'transparent' }}
          onMouseEnter={e => { if (tab !== id) e.currentTarget.style.background = 'var(--bg-input)' }}
          onMouseLeave={e => { if (tab !== id) e.currentTarget.style.background = 'transparent' }}>
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  )

  const content = (
    <>
      {tab === 'overview'     && <OverviewTab />}
      {tab === 'audit'        && <AuditLogTab />}
      {tab === 'sessions'     && <SessionsTab />}
      {tab === 'chats'        && <ChatsTab />}
      {tab === 'ai-runs'      && <AiRunsTab />}
      {tab === 'sync'         && <SyncLogTab />}
      {tab === 'projects'     && <ProjectsMirrorTab />}
      {tab === 'invoices'     && <InvoicesTab />}
      {tab === 'history'      && <HistoryTab />}
      {tab === 'shared'       && <SharedLinksTab />}
      {tab === 'associations' && <AssociationsTab />}
      {tab === 'hflogs'       && <HfLogsTab />}
    </>
  )

  /* ── Embedded inside Layout ── */
  if (embedded) {
    return (
      <div className="p-2 sm:p-4 space-y-4 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(220,38,38,0.10)' }}>
            <Activity size={15} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight" style={{ color: 'var(--text-1)' }}>
              Admin Panel
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              PostgreSQL database dashboard — all requests logged
            </p>
          </div>
        </div>
        {tabBar}
        {content}
      </div>
    )
  }

  /* ── Standalone full-screen (admin role) ── */
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3"
        style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(220,38,38,0.12)' }}>
            <Activity size={14} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>Admin Panel</p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>PostgreSQL Dashboard · All requests logged</p>
          </div>
        </div>
        <button onClick={logout}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-3)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <LogOut size={12} /> Sign out
        </button>
      </header>

      {tabBar}

      <main className="flex-1 p-2 sm:p-4 max-w-[1400px] mx-auto w-full">
        {content}
      </main>
    </div>
  )
}
