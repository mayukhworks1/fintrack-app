// Extracted from AdminDashboard.jsx — SessionsTab.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import { Empty, Err, FMulti, FPill, FSel, FilterBar, Pager, SessionStatusChip, Skeleton, deviceIcon, roleBadge } from './ui'
import { countryFlag, fmt, relTime, ts } from './utils'

export function SessionsTab() {
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
  const [purging, setPurging]      = useState(false)
  const [purgeMsg, setPurgeMsg]    = useState(null)

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

  const purgeInactiveSessions = useCallback(async () => {
    if (!window.confirm('Delete inactive/expired sessions older than 30 days? The 100 most recent sessions are always kept.')) return
    setPurging(true); setPurgeMsg(null)
    try {
      const res = await api.admin.purgeSessions({ days: 30 })
      setPurgeMsg(res.message || `Deleted ${res.deleted || 0} old sessions`)
      await load()
    } catch (e) {
      setPurgeMsg(e.message || 'Failed to purge sessions')
    } finally {
      setPurging(false)
    }
  }, [load])

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
          <button onClick={purgeInactiveSessions} disabled={purging}
            className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
            style={{
              borderColor: 'rgba(220,38,38,0.25)',
              color: '#dc2626',
              background: 'rgba(220,38,38,0.06)',
              opacity: purging ? 0.65 : 1,
            }}>
            {purging ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
            {purging ? 'Purging…' : 'Purge inactive'}
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
        <div className="text-xs flex flex-wrap items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <span>{data.total.toLocaleString()} session{data.total !== 1 ? 's' : ''}</span>
          {purgeMsg && <span style={{ color: purgeMsg.includes('Failed') ? '#dc2626' : '#16a34a' }}>{purgeMsg}</span>}
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
