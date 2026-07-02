// Extracted from AdminDashboard.jsx — ProjectsMirrorTab.
import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw
} from 'lucide-react'
import { api } from '../../services/api'
import { Badge, Empty, Err, FMulti, FPill, FilterBar, Pager, Skeleton } from './ui'
import { ts } from './utils'

export function ProjectsMirrorTab() {
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
