// Extracted from AdminDashboard.jsx — ChatsTab.
import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, ChevronLeft
} from 'lucide-react'
import { api } from '../../services/api'
import { Empty, Err, FMulti, FPill, FSel, FilterBar, Pager, Skeleton, roleBadge } from './ui'
import { countryFlag, relTime, ts } from './utils'

export function ChatsTab() {
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
