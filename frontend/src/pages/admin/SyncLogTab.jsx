// Extracted from AdminDashboard.jsx — SyncLogTab.
import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Play
} from 'lucide-react'
import { api } from '../../services/api'
import { Badge, Empty, Err, FSel, FilterBar, Pager, Skeleton } from './ui'
import { cacheGet, cacheSet, fmt, ts } from './utils'

export function SyncLogTab() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [offset, setOffset]       = useState(0)
  const [filterSource, setFs]     = useState('')
  const [filterError,  setFErr]   = useState('')   // '' | 'errors_only' | 'success_only'
  const [limit, setSLimit]        = useState(50)
  const [triggering, setTrig]     = useState(false)
  const [agingRefreshing,     setAgingRefreshing]     = useState(false)
  const [durationRefreshing,  setDurationRefreshing]  = useState(false)
  const [trigMsg, setTrigMsg]     = useState(null)
  const [diagnosing, setDiag]     = useState(false)
  const [diagResult, setDiagRes]  = useState(null)
  const [watchdogging, setWatchdog] = useState(false)

  const load = useCallback(async () => {
    const cacheKey = `synclog:${limit}:${offset}:${filterSource}:${filterError}`
    const cached = cacheGet(cacheKey)
    if (cached) { setData(cached); setLoading(false) }
    else setLoading(true)
    setError(null)
    try {
      const fresh = await api.admin.syncLog({
        limit, offset,
        source:    filterSource || undefined,
        has_error: filterError === 'errors_only' ? true : filterError === 'success_only' ? false : undefined,
      })
      cacheSet(cacheKey, fresh)
      setData(fresh)
    } catch (e) { setError(e.message) }
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

  const triggerAgingRefresh = useCallback(async () => {
    setAgingRefreshing(true); setTrigMsg(null)
    try {
      await api.admin.triggerAgingRefresh()
      setTrigMsg({ ok: true, text: 'Invoice aging refresh started — numeric aging values will appear in Teable shortly' })
      setTimeout(() => { load(); setTrigMsg(null) }, 4000)
    } catch (e) {
      setTrigMsg({ ok: false, text: e.message || 'Aging refresh failed' })
    } finally {
      setAgingRefreshing(false)
    }
  }, [load])

  const triggerDurationRefresh = useCallback(async () => {
    setDurationRefreshing(true); setTrigMsg(null)
    try {
      const res = await api.admin.triggerDurationRefresh()
      if (res.error) {
        setTrigMsg({ ok: false, text: `Error: ${res.error} (updated ${res.updated}/${res.total}, ${res.duration_ms}ms)` })
      } else {
        const skipDetail = res.skip_reasons?.length
          ? ' — skips: ' + res.skip_reasons.map(s => `${s.project}: ${s.reason}`).join('; ')
          : ''
        setTrigMsg({ ok: true, text: `Done — updated ${res.updated}/${res.total} projects, skipped ${res.skipped}, errors ${res.errors} (${res.duration_ms}ms)${skipDetail}` })
      }
      setTimeout(() => { load(); setTrigMsg(null) }, 6000)
    } catch (e) {
      setTrigMsg({ ok: false, text: e.message || 'Duration refresh failed' })
    } finally {
      setDurationRefreshing(false)
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

  const triggerWatchdog = useCallback(async () => {
    setWatchdog(true); setTrigMsg(null)
    try {
      const res = await api.admin.watchdog()
      const restarted = res.restarted?.join(', ') || 'none'
      setTrigMsg({ ok: true, text: `Watchdog OK — restarted: ${restarted} | sync=${res.sync_running ? '✓' : '✗'} aging=${res.aging_running ? '✓' : '✗'}` })
      setTimeout(() => { load(); setTrigMsg(null) }, 4000)
    } catch (e) {
      setTrigMsg({ ok: false, text: e.message || 'Watchdog failed' })
    } finally {
      setWatchdog(false)
    }
  }, [load])

  const sourceColor = { projects: 'blue', invoices: 'purple', web_invoices: 'teal', 'projects-duration-refresh': 'violet', 'invoices-aging-refresh': 'green', 'web-invoices-aging-refresh': 'emerald' }

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
        <FSel label="Source" value={filterSource} onChange={setFs} width={220}
          opts={[
            ['','All sources'],
            ['projects','projects'],
            ['invoices','invoices'],
            ['web_invoices','web_invoices'],
            ['projects-duration-refresh','projects-duration-refresh'],
            ['invoices-aging-refresh','invoices-aging-refresh'],
            ['web-invoices-aging-refresh','web-invoices-aging-refresh'],
          ]} />
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
        <button onClick={triggerAgingRefresh} disabled={agingRefreshing}
          className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          style={{
            background: agingRefreshing ? 'var(--bg-input)' : 'rgba(5,150,105,0.08)',
            border: '1px solid rgba(5,150,105,0.25)',
            color: agingRefreshing ? 'var(--text-3)' : '#059669',
            opacity: agingRefreshing ? 0.6 : 1,
          }}>
          <RefreshCw size={11} /> {agingRefreshing ? 'Refreshing…' : 'Refresh Aging'}
        </button>
        <button onClick={triggerDurationRefresh} disabled={durationRefreshing}
          className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          style={{
            background: durationRefreshing ? 'var(--bg-input)' : 'rgba(124,58,237,0.08)',
            border: '1px solid rgba(124,58,237,0.25)',
            color: durationRefreshing ? 'var(--text-3)' : '#7c3aed',
            opacity: durationRefreshing ? 0.6 : 1,
          }}>
          <RefreshCw size={11} /> {durationRefreshing ? 'Refreshing…' : 'Refresh Project Duration'}
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
        <button onClick={triggerWatchdog} disabled={watchdogging}
          className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          title="Check if background workers are alive and restart any dead ones"
          style={{
            background: watchdogging ? 'var(--bg-input)' : 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            color: watchdogging ? 'var(--text-3)' : '#dc2626',
            opacity: watchdogging ? 0.6 : 1,
          }}>
          🐕 {watchdogging ? 'Checking…' : 'Watchdog'}
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
                      {Array.isArray(row.details?.updated_records) && row.details.updated_records.length > 0 && (
                        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-2)' }}>
                          Updated: {row.details.updated_records.slice(0, 3).map(r =>
                            r.project_name
                              ? `${r.project_name} (${r.old_duration}→${r.new_duration}mo)`
                              : (r.invoice_number || r.teable_id)
                          ).join(', ')}
                          {row.details.updated_records.length > 3 ? ` +${row.details.updated_records.length - 3}` : ''}
                        </p>
                      )}
                      {row.details?.errors > 0 && (
                        <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{row.details.errors} patch error{row.details.errors > 1 ? 's' : ''}</p>
                      )}
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
                            {Array.isArray(row.details?.updated_records) && row.details.updated_records.length > 0 && (
                              <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                                {row.details.updated_records.slice(0, 2).map(r =>
                                  r.project_name
                                    ? `${r.project_name} (${r.old_duration}→${r.new_duration}mo)`
                                    : (r.invoice_number || r.teable_id)
                                ).join(', ')}
                                {row.details.updated_records.length > 2 ? ` +${row.details.updated_records.length - 2}` : ''}
                              </p>
                            )}
                            {row.details?.errors > 0 && (
                              <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>{row.details.errors} patch error{row.details.errors > 1 ? 's' : ''}</p>
                            )}
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
