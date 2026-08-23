// Extracted from AdminDashboard.jsx — shared presentational atoms.
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw, Database, Clock, ChevronLeft, ChevronRight, Monitor, Smartphone, Tablet, CheckCircle2, XCircle, AlertCircle, MinusCircle, Trash2, X
} from 'lucide-react'
import { api } from '../../services/api'
import { FilterSelect, FilterMulti } from '../../components/FilterSelect'
import { useAvatarSrc } from '../../hooks/useAvatarSrc'
import { fmt } from './utils'
import { useDialog } from '../../hooks/useDialog'

export function Badge({ children, color = 'default' }) {
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

export function roleBadge(role) {
  const map = { editor: 'blue', viewer: 'indigo', web: 'purple', all: 'pink', admin: 'red' }
  return <Badge color={map[role] || 'default'}>{role || 'anon'}</Badge>
}

export function UserAvatar({ row, size = 40 }) {
  const displayName = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.full_name || ''
  const initials = displayName ? displayName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : (row.email || '?').slice(0, 2).toUpperCase()
  const avatarSrc = useAvatarSrc(row.avatar_url)
  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt={displayName || row.email || 'User avatar'}
        className="rounded-2xl object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-2xl flex items-center justify-center text-xs font-black shrink-0"
      style={{ width: size, height: size, background: 'rgba(99,102,241,0.14)', color: '#6366f1' }}
    >
      {initials}
    </div>
  )
}

export function EditableName({ value, saving, onSave, placeholder = '', emptyLabel = 'No name — click to set' }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus
          value={val}
          placeholder={placeholder}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(val); setEditing(false) }
            if (e.key === 'Escape') { setVal(value); setEditing(false) }
          }}
          className="text-[11px] px-1.5 py-0.5 rounded border outline-none"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-1)', width: 160 }}
        />
        <button onClick={() => { onSave(val); setEditing(false) }}
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>✓</button>
        <button onClick={() => { setVal(value); setEditing(false) }}
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-input)', color: 'var(--text-3)' }}>✕</button>
      </span>
    )
  }
  return (
    <span
      className="text-[11px] cursor-pointer hover:underline"
      style={{ color: 'var(--text-3)' }}
      onClick={() => { setVal(value); setEditing(true) }}
      title="Click to edit"
    >
      {saving ? 'Saving…' : (value || <em style={{ opacity: 0.55 }}>{emptyLabel}</em>)}
    </span>
  )
}

export function statusBadge(status) {
  if (!status) return <Badge>—</Badge>
  if (status < 300) return <Badge color="green">{status}</Badge>
  if (status < 400) return <Badge color="blue">{status}</Badge>
  if (status < 500) return <Badge color="amber">{status}</Badge>
  return <Badge color="red">{status}</Badge>
}

export function methodBadge(method) {
  const map = { GET: 'green', POST: 'blue', PATCH: 'amber', DELETE: 'red', PUT: 'orange' }
  return <Badge color={map[method] || 'default'}>{method}</Badge>
}

export function deviceIcon(device) {
  if (device === 'mobile')  return <Smartphone size={11} />
  if (device === 'tablet')  return <Tablet size={11} />
  return <Monitor size={11} />
}

// ── Loading / error / empty states ───────────────────────────────────────────

export function Skeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 rounded-lg w-full" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}

export function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card skeleton h-20 rounded-xl" style={{ opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  )
}

export function Err({ msg, onRetry }) {
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

export function Empty({ label = 'No rows found' }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Database size={22} style={{ color: 'var(--text-3)' }} />
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>{label}</p>
    </div>
  )
}

// ── Generic paginator ─────────────────────────────────────────────────────────

export function Pager({ total, limit, offset, onPage }) {
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

export function StatBox({ label, value, sub, color, accent }) {
  return (
    <div className="card flex flex-col gap-1 min-w-0" style={accent ? { borderLeft: `3px solid ${accent}` } : {}}>
      <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: color || 'var(--text-1)' }}>{fmt(value)}</p>
      {sub && <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

export function HealthEvidenceCard({ label, item }) {
  const ok = Boolean(item?.ok)
  return (
    <div className="card min-w-0 space-y-2" style={{ borderLeft: `3px solid ${ok ? '#16a34a' : '#dc2626'}` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{label}</p>
        <Badge color={ok ? 'green' : 'red'}>{ok ? 'OK' : 'Check'}</Badge>
      </div>
      <p className="text-[11px] leading-relaxed min-h-[32px]" style={{ color: 'var(--text-3)' }} title={item?.detail || ''}>
        {item?.detail || 'No live detail returned'}
      </p>

      {label === 'Sync Freshness' && item?.stale_sources?.length > 0 && (
        <p className="text-[11px]" style={{ color: '#d97706' }}>Stale mirrors: {item.stale_sources.join(', ')}</p>
      )}

      {label === 'Teable' && item?.tables && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(item.tables).map(([name, table]) => (
            <Badge key={name} color={table?.ok ? 'green' : 'red'}>{name}</Badge>
          ))}
        </div>
      )}

      {label === 'Environment' && item?.checks && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {Object.entries(item.checks).map(([name, value]) => (
              <Badge key={name} color={value ? 'green' : 'red'}>{name}</Badge>
            ))}
          </div>
          {item.missing?.length > 0 && (
            <div className="rounded-lg p-2" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.18)' }}>
              <p className="text-[11px] font-semibold mb-1" style={{ color: '#dc2626' }}>Action needed in production secrets</p>
              {item.missing.map(name => (
                <p key={name} className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  <code style={{ color: '#dc2626' }}>{name}</code>: {item.guidance?.[name] || 'Set this value in the deployment environment.'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DeploymentChecklist() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (opts = {}) => {
    setLoading(true); setError(null)
    try { setData(await api.admin.deploymentHealth({ fresh: true, timeout: 18000, ...opts })) }
    catch (e) {
      if (e?.name === 'AbortError') return
      setError(e.message || 'Deployment health failed')
    }
    finally { if (!opts.signal?.aborted) setLoading(false) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  const checks = useMemo(() => {
    if (!data) return []
    return [
      ['PostgreSQL', data.postgres],
      ['Teable', data.teable],
      ['Valkey', data.valkey],
      ['Email', data.email],
      ['OpenRouter', data.openrouter],
      ['Auth Sessions', data.auth_sessions],
      ['Cron Jobs', data.cron_jobs],
      ['Sync Freshness', data.sync_freshness],
      ['Failed Webhooks', data.failed_webhooks],
      ['Environment', data.env],
    ]
  }, [data])

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Production Health
          </h3>
          {data?.deployment && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              Version {data.deployment.version || '—'} · commit {data.deployment.commit || 'unknown'} · {data.deployment.hf_space_id || 'space unknown'}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && !data ? <StatSkeleton /> : error ? <Err msg={error} onRetry={load} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {checks.map(([label, item]) => <HealthEvidenceCard key={label} label={label} item={item} />)}
        </div>
      )}
    </section>
  )
}

export function FLabel({ label, children }) {
  return (
    <label className="flex flex-col gap-0.5 flex-shrink-0">
      <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

export function FPill({ label, value, onChange, type = 'text', placeholder, width = 130 }) {
  return (
    <FLabel label={label}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''} style={{ ...CTRL_STYLE, width: `min(100%, ${width}px)` }} />
    </FLabel>
  )
}

// FSel — thin adapter so existing call sites keep working (opts is [value,label][] tuple array)

export function FSel({ label, value, onChange, opts, width = 130 }) {
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

export function FMulti({ label, selected, onChange, opts, placeholder = 'Any', width = 150 }) {
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

export function FilterBar({ children, count, onReset, rightSlot }) {
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

export function PurgeModal({ onConfirm, onCancel, purging, result }) {
  // onCancel, not onClose: this component names its dismiss prop differently
  // from the other dialogs, and passing the wrong identifier here is not a
  // silent no-op — `onClose` is undeclared, so referencing it throws a
  // ReferenceError that takes the whole admin tab down.
  const dialog = useDialog({ label: 'Purge records', onClose: onCancel })
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
      <div {...dialog.panelProps} style={{
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
          <button aria-label="Cancel" onClick={onCancel} style={{ marginLeft: 'auto', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
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

export function DetailKV({ k, v, mono = false }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{k}</span>
      <span className={`text-[11px] truncate ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--text-1)' }}>{v}</span>
    </div>
  )
}

export function AuthStatusBadge({ status }) {
  const color = status === 'active' ? 'green'
    : status === 'pending_approval' ? 'amber'
    : status === 'disabled' || status === 'rejected' ? 'red'
    : 'default'
  const label = status === 'pending_approval' ? 'pending approval' : (status || 'unknown').replaceAll('_', ' ')
  return <Badge color={color}>{label}</Badge>
}

export function SessionStatusChip({ status }) {
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

export function SubTabBar({ tabs, active, onSelect }) {
  return (
    <div className="flex gap-1 mb-3 p-1 rounded-xl w-fit"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => onSelect(id)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
          style={active === id
            ? { background: 'var(--card-bg)', color: 'var(--text-1)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
            : { color: 'var(--text-3)', background: 'transparent' }}>
          <Icon size={11} />{label}
        </button>
      ))}
    </div>
  )
}

const CTRL_STYLE = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
  borderRadius: 8,
  fontSize: 12,
  padding: '4px 8px',
  outline: 'none',
}
