// Extracted from AdminDashboard.jsx — InvoicesTab.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../services/api'
import { Badge, Empty, Err, FPill, FSel, FilterBar, Pager, Skeleton } from './ui'

export function InvoicesTab({ drilldown = null }) {
  const [source, setSource]       = useState('all')   // 'all' | 'main' | 'web'
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [offset, setOffset]       = useState(0)
  const [statusF, setStatF]       = useState('')
  const [filterProject, setFProject] = useState('')
  const [filterNumber,  setFNumber]  = useState('')
  const [filterRecordId, setFRecordId] = useState('')
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
      teable_id:      filterRecordId || undefined,
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
  }, [source, offset, statusF, filterProject, filterNumber, filterRecordId, filterFrom, filterTo])

  useEffect(() => { setOffset(0) }, [source, statusF, filterProject, filterNumber, filterRecordId, filterFrom, filterTo])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!drilldown?.teable_id) return
    setSource(drilldown.source || 'all')
    setFRecordId(drilldown.teable_id)
    setOffset(0)
  }, [drilldown])

  const advCount = [statusF, filterProject, filterNumber, filterRecordId, filterFrom, filterTo].filter(Boolean).length

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
        onReset={() => { setStatF(''); setFProject(''); setFNumber(''); setFRecordId(''); setFFrom(''); setFTo('') }}
        rightSlot={
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        }>
        <FSel label="Status" value={statusF} onChange={setStatF} width={140}
          opts={[['','All statuses'],['Paid','Paid'],['Pending','Pending'],['Partial','Partial'],['Overdue','Overdue']]} />
        <FPill label="Record ID" value={filterRecordId} onChange={setFRecordId} placeholder="rec…" width={150} />
        <FPill label="Invoice #" value={filterNumber} onChange={setFNumber} placeholder="INV-…" width={120} />
        <FPill label="Project" value={filterProject} onChange={setFProject} placeholder="Project name…" width={150} />
        <FPill label="From" value={filterFrom} onChange={setFFrom} type="date" width={130} />
        <FPill label="To" value={filterTo} onChange={setFTo} type="date" width={130} />
      </FilterBar>
      {drilldown?.teable_id && (
        <div className="rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-2)' }}>
          Focused on record <span className="font-mono" style={{ color: 'var(--text-1)' }}>{drilldown.teable_id}</span>.
        </div>
      )}
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
