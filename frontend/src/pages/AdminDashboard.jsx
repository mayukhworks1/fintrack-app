/**
 * Admin Dashboard — full PostgreSQL visibility
 * Accessible with password: Master@2026  (role: admin)
 *
 * Tabs:
 *   Overview   — live counts across every table
 *   Audit Log  — every API request with role/IP/geo/OS/browser
 *   Sessions   — active login sessions
 *   AI Chats   — conversation sessions + messages
 *   Sync Log   — Teable ↔ PostgreSQL sync history
 *   Projects   — PostgreSQL projects mirror
 *   Invoices   — PostgreSQL invoices mirror
 *   History    — field-level change log
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutDashboard, ScrollText, Users, MessageSquareText,
  RefreshCw, Database, FileText, Clock, LogOut,
  TrendingUp, ChevronLeft, ChevronRight, Search,
  Activity, Globe, Monitor, Smartphone, Tablet,
  CheckCircle2, XCircle, AlertCircle, History
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  if (typeof n === 'number') return n.toLocaleString()
  return String(n)
}

function ts(v) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return v }
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
  const map = { editor: 'blue', viewer: 'indigo', web: 'purple', all: 'pink', admin: 'red', null: 'default' }
  return <Badge color={map[role] || 'default'}>{role || 'anon'}</Badge>
}

function statusBadge(status) {
  if (!status) return <Badge>—</Badge>
  if (status < 300) return <Badge color="green">{status}</Badge>
  if (status < 400) return <Badge color="blue">{status}</Badge>
  if (status < 500) return <Badge color="amber">{status}</Badge>
  return <Badge color="red">{status}</Badge>
}

function deviceIcon(device) {
  if (device === 'mobile')  return <Smartphone size={11} />
  if (device === 'tablet')  return <Tablet size={11} />
  return <Monitor size={11} />
}

// ── Loading / error states ────────────────────────────────────────────────────

function Skeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 rounded-lg w-full" style={{ opacity: 1 - i * 0.12 }} />
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
        <button onClick={onRetry} className="btn-secondary text-xs px-3 py-1">
          Retry
        </button>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Database size={22} style={{ color: 'var(--text-3)' }} />
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>No rows found</p>
    </div>
  )
}

// ── Generic paginated table ───────────────────────────────────────────────────

function Pager({ total, limit, offset, onPage }) {
  const page  = Math.floor(offset / limit)
  const pages = Math.ceil(total / limit)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
        {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
      </span>
      <div className="flex gap-1">
        <button onClick={() => onPage(Math.max(0, offset - limit))} disabled={page === 0}
          className="btn-icon p-1" style={{ opacity: page === 0 ? 0.35 : 1 }}>
          <ChevronLeft size={13} />
        </button>
        <span className="text-xs px-2 flex items-center" style={{ color: 'var(--text-2)' }}>
          {page + 1} / {pages}
        </span>
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

function StatBox({ label, value, sub, color = 'var(--text-1)' }) {
  return (
    <div className="card flex flex-col gap-1 min-w-0">
      <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>{fmt(value)}</p>
      {sub && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function OverviewTab() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.stats()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"><Skeleton rows={8} /></div>
  if (error)   return <Err msg={error} onRetry={load} />
  if (!data)   return null

  return (
    <div className="space-y-6">
      {/* Requests */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          API Requests (Audit Log)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Total Requests"    value={data.audit_total}    />
          <StatBox label="Last 24 Hours"     value={data.audit_24h}      sub={`${data.audit_1h ?? '?'} in last hour`} />
          <StatBox label="Unique IPs (24h)"  value={data.unique_ips_24h} />
          <StatBox label="Editor Requests"   value={data.audit_editor}   color="#2563eb" />
          <StatBox label="Viewer Requests"   value={data.audit_viewer}   color="#6366f1" />
          <StatBox label="Web Requests"      value={data.audit_web}      color="#7c3aed" />
          <StatBox label="All Requests"      value={data.audit_all}      color="#db2777" />
          <StatBox label="Anonymous"         value={data.audit_anon}     color="var(--text-3)" />
        </div>
      </section>

      {/* Sessions */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Login Sessions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatBox label="Active Sessions"   value={data.sessions_active}  color="#16a34a"
            sub={data.sessions_last_active ? `Last: ${relTime(data.sessions_last_active)}` : undefined} />
          <StatBox label="Total Sessions"    value={data.sessions_total} />
          <StatBox label="AI Chat Sessions"  value={data.chat_sessions_total}
            sub={`${data.chat_messages_total ?? 0} messages`} />
        </div>
      </section>

      {/* Mirror */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Teable Mirror (PostgreSQL)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Projects"          value={data.projects_total}
            sub={data.projects_last_sync ? `Synced ${relTime(data.projects_last_sync)}` : 'Never synced'} />
          <StatBox label="Invoices"          value={data.invoices_total}
            sub={data.invoices_last_sync ? `Synced ${relTime(data.invoices_last_sync)}` : 'Never synced'} />
          <StatBox label="Change History"    value={data.history_total}
            sub={`${data.history_24h ?? 0} changes in 24h`} />
          <div className="card flex flex-col gap-1">
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Last Sync</p>
            <p className="text-sm font-semibold" style={{ color: data.last_sync_error ? '#dc2626' : '#16a34a' }}>
              {data.last_sync_at ? relTime(data.last_sync_at) : 'Never'}
            </p>
            {data.last_sync_error && (
              <p className="text-[11px] truncate" style={{ color: '#dc2626' }} title={data.last_sync_error}>
                {data.last_sync_error}
              </p>
            )}
            {!data.last_sync_error && data.last_sync_source && (
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{data.last_sync_source}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Tab: Audit Log ────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [offset, setOffset]     = useState(0)
  const [filterRole, setRole]   = useState('')
  const [filterMethod, setMeth] = useState('')
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await api.admin.auditLog({ limit, offset, role: filterRole || undefined, method: filterMethod || undefined }))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, filterRole, filterMethod])

  useEffect(() => { setOffset(0) }, [filterRole, filterMethod])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filterRole} onChange={e => setRole(e.target.value)}
          className="input-field text-xs py-1 px-2" style={{ width: 130 }}>
          <option value="">All roles</option>
          {['editor','viewer','web','all','admin'].map(r => <option key={r}>{r}</option>)}
        </select>
        <select value={filterMethod} onChange={e => setMeth(e.target.value)}
          className="input-field text-xs py-1 px-2" style={{ width: 110 }}>
          <option value="">All methods</option>
          {['GET','POST','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && <span className="text-xs flex items-center" style={{ color: 'var(--text-3)' }}>
          {data.total.toLocaleString()} rows
        </span>}
      </div>

      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Time','Role','Method','Path','Status','Duration','IP','OS','Browser','Country'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).length === 0
                  ? <tr><td colSpan={10}><Empty /></td></tr>
                  : (data?.rows || []).map(row => (
                  <tr key={row.id} className="border-b hover:bg-opacity-50 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-3)' }}>
                      {ts(row.ts)}
                    </td>
                    <td className="px-3 py-2">{roleBadge(row.role)}</td>
                    <td className="px-3 py-2">
                      <Badge color={row.method === 'GET' ? 'green' : row.method === 'POST' ? 'blue' : row.method === 'DELETE' ? 'red' : 'amber'}>
                        {row.method}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate" style={{ color: 'var(--text-1)' }}
                      title={row.path}>{row.path}</td>
                    <td className="px-3 py-2">{statusBadge(row.status)}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-2)', fontSize: 11 }}>
                      {row.ip || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                        {deviceIcon(row.device)}{row.os || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                      {row.browser || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
                      {row.country ? `${row.country}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sessions ─────────────────────────────────────────────────────────────

function SessionsTab() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const [activeOnly, setAO]   = useState(true)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.sessions({ limit, offset, active_only: activeOnly })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, activeOnly])

  useEffect(() => { setOffset(0) }, [activeOnly])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none"
          style={{ color: 'var(--text-2)' }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setAO(e.target.checked)}
            className="rounded" />
          Active sessions only
        </label>
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {data.total.toLocaleString()} sessions
        </span>}
      </div>

      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Role','Status','IP','OS','Browser','Country / City','Logged In','Last Seen','Expires','Requests'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).length === 0
                  ? <tr><td colSpan={10}><Empty /></td></tr>
                  : (data?.rows || []).map(row => (
                  <tr key={row.id} className="border-b transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td className="px-3 py-2">{roleBadge(row.role)}</td>
                    <td className="px-3 py-2">
                      {row.currently_valid
                        ? <span className="flex items-center gap-1 text-[11px]" style={{ color: '#16a34a' }}>
                            <CheckCircle2 size={11} /> Active
                          </span>
                        : <span className="flex items-center gap-1 text-[11px]" style={{ color: '#dc2626' }}>
                            <XCircle size={11} /> Expired
                          </span>}
                    </td>
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
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                      {ts(row.expires_at)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-2)' }}>
                      {fmt(row.request_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: AI Chats ─────────────────────────────────────────────────────────────

function ChatsTab() {
  const [list, setList]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [offset, setOffset]     = useState(0)
  const [selected, setSelected] = useState(null)
  const [msgs, setMsgs]         = useState(null)
  const [msgsLoading, setML]    = useState(false)
  const limit = 30

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    try { setList(await api.admin.chatSessions({ limit, offset })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset])

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
              <div key={m.id} className={`rounded-xl p-3 ${m.role === 'user' ? 'ml-8' : 'mr-8'}`}
                style={{ background: m.role === 'user' ? 'var(--bg-input)' : 'rgba(37,99,235,0.06)',
                  border: `1px solid ${m.role === 'user' ? 'var(--border)' : 'rgba(37,99,235,0.15)'}` }}>
                <div className="flex items-center justify-between mb-1">
                  {roleBadge(m.role)}
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    {ts(m.ts)}{m.model ? ` · ${m.model}` : ''}{m.duration_ms ? ` · ${m.duration_ms}ms` : ''}
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
      <div className="flex gap-2 items-center">
        <button onClick={loadList} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {list && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{list.total} sessions</span>}
      </div>
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={loadList} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Role','Messages','IP','OS','Country','Started','Last Message'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(list?.rows || []).length === 0
                  ? <tr><td colSpan={7}><Empty /></td></tr>
                  : (list?.rows || []).map(row => (
                  <tr key={row.id} className="border-b cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => openSession(row.id)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td className="px-3 py-2">{roleBadge(row.role)}</td>
                    <td className="px-3 py-2 tabular-nums text-center">{row.msg_count}</td>
                    <td className="px-3 py-2 font-mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>{row.ip || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>
                      <span className="flex items-center gap-1">{deviceIcon(row.device)}{row.os || '—'}</span>
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
          <Pager total={list?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sync Log ─────────────────────────────────────────────────────────────

function SyncLogTab() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.syncLog({ limit, offset })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && <span className="text-xs flex items-center" style={{ color: 'var(--text-3)' }}>
          {data.total} runs
        </span>}
      </div>
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Time','Source','Total','Created','Updated','Unchanged','Duration','Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).length === 0
                  ? <tr><td colSpan={8}><Empty /></td></tr>
                  : (data?.rows || []).map(row => (
                  <tr key={row.id} className="border-b transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                      {ts(row.synced_at)}
                    </td>
                    <td className="px-3 py-2"><Badge color={row.source === 'projects' ? 'blue' : 'purple'}>{row.source}</Badge></td>
                    <td className="px-3 py-2 tabular-nums text-right">{fmt(row.total)}</td>
                    <td className="px-3 py-2 tabular-nums text-right" style={{ color: '#16a34a' }}>{fmt(row.created)}</td>
                    <td className="px-3 py-2 tabular-nums text-right" style={{ color: '#d97706' }}>{fmt(row.updated)}</td>
                    <td className="px-3 py-2 tabular-nums text-right" style={{ color: 'var(--text-3)' }}>{fmt(row.unchanged)}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.error
                        ? <span className="text-[11px] text-red-500 truncate max-w-[160px] block" title={row.error}>
                            ✕ {row.error}
                          </span>
                        : <span className="text-[11px]" style={{ color: '#16a34a' }}>✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Mirror table (reusable) ──────────────────────────────────────────────

function MirrorTab({ loader, columns, filterSlot }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await loader({ limit, offset })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset, loader])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {filterSlot}
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {data.total.toLocaleString()} rows
        </span>}
      </div>
      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {columns.map(c => (
                    <th key={c} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-2)' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).length === 0
                  ? <tr><td colSpan={columns.length}><Empty /></td></tr>
                  : (data?.rows || []).map((row, i) => (
                  <tr key={row.teable_id || i} className="border-b transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    {Object.entries(row).filter(([k]) => k !== 'fields').map(([k, v]) => (
                      <td key={k} className="px-3 py-2 max-w-[160px] truncate"
                        style={{ color: 'var(--text-1)' }} title={v != null ? String(v) : undefined}>
                        {v != null ? String(v) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

function ProjectsMirrorTab() {
  return (
    <MirrorTab
      loader={api.admin.mirrorProjects}
      columns={['Teable ID','Synced','Name','Client','Status','Billed','Profit','Profit %','Created','Modified']}
    />
  )
}

function InvoicesMirrorTab() {
  return (
    <MirrorTab
      loader={api.admin.mirrorInvoices}
      columns={['Teable ID','Synced','Invoice #','Project','Category','Status','Raised','With Tax','Received','Date']}
    />
  )
}

// ── Tab: Record History ───────────────────────────────────────────────────────

function HistoryTab() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const [expanded, setExp]    = useState(null)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.recordHistory({ limit, offset })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [offset])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <button onClick={load} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        {data && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{data.total.toLocaleString()} changes</span>}
      </div>
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          <div className="space-y-1">
            {(data?.rows || []).length === 0 ? <Empty /> : (data?.rows || []).map(row => (
              <div key={row.id} className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--border)' }}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                  style={{ background: 'var(--bg-card)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                  onClick={() => setExp(expanded === row.id ? null : row.id)}>
                  <Badge color={row.change_type === 'create' ? 'green' : row.change_type === 'delete' ? 'red' : 'amber'}>
                    {row.change_type}
                  </Badge>
                  <Badge color={row.source_table === 'projects' ? 'blue' : 'purple'}>{row.source_table}</Badge>
                  <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-2)' }}>
                    {row.teable_id}
                  </span>
                  {row.changed_fields?.length > 0 && (
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {row.changed_fields.slice(0, 3).join(', ')}{row.changed_fields.length > 3 ? ` +${row.changed_fields.length - 3}` : ''}
                    </span>
                  )}
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {ts(row.recorded_at)}
                  </span>
                </button>
                {expanded === row.id && (
                  <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                    {row.changed_fields?.length > 0 && (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        Changed: <span style={{ color: 'var(--text-1)' }}>{row.changed_fields.join(', ')}</span>
                      </p>
                    )}
                    {row.new_fields && (
                      <pre className="text-[11px] rounded-lg p-2 overflow-x-auto max-h-40"
                        style={{ background: 'var(--bg-base)', color: 'var(--text-2)', fontFamily: 'monospace' }}>
                        {JSON.stringify(row.new_fields, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
  { id: 'audit',     label: 'Audit Log', icon: ScrollText       },
  { id: 'sessions',  label: 'Sessions',  icon: Users            },
  { id: 'chats',     label: 'AI Chats',  icon: MessageSquareText},
  { id: 'sync',      label: 'Sync Log',  icon: RefreshCw        },
  { id: 'projects',  label: 'Projects',  icon: Database         },
  { id: 'invoices',  label: 'Invoices',  icon: FileText         },
  { id: 'history',   label: 'History',   icon: History          },
]

/**
 * AdminDashboard can run in two modes:
 *
 * embedded={false}  (default)
 *   Full-screen standalone page with its own sticky header + sign-out.
 *   Used when role === 'admin' logs in (no sidebar).
 *
 * embedded={true}
 *   Renders as a regular page inside the existing Layout/sidebar.
 *   Used when role === 'editor' navigates to /admin via the sidebar.
 *   Drops the duplicate header — Layout already provides nav + sign-out.
 */
export default function AdminDashboard({ embedded = false }) {
  const { logout } = useAuth()
  const [tab, setTab] = useState('overview')

  const tabBar = (
    <div className={`flex overflow-x-auto gap-0.5 px-3 py-2 ${embedded ? 'rounded-xl border mb-4' : 'sticky top-[49px] z-10'}`}
      style={embedded
        ? { background: 'var(--bg-card)', borderColor: 'var(--border)' }
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
      {tab === 'overview'  && <OverviewTab />}
      {tab === 'audit'     && <AuditLogTab />}
      {tab === 'sessions'  && <SessionsTab />}
      {tab === 'chats'     && <ChatsTab />}
      {tab === 'sync'      && <SyncLogTab />}
      {tab === 'projects'  && <ProjectsMirrorTab />}
      {tab === 'invoices'  && <InvoicesMirrorTab />}
      {tab === 'history'   && <HistoryTab />}
    </>
  )

  /* ── Embedded inside Layout ── */
  if (embedded) {
    return (
      <div className="p-4 space-y-4 max-w-[1400px] mx-auto w-full">
        {/* Page heading */}
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
              PostgreSQL database dashboard
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
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>PostgreSQL Dashboard</p>
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

      <main className="flex-1 p-4 max-w-[1400px] mx-auto w-full">
        {content}
      </main>
    </div>
  )
}
