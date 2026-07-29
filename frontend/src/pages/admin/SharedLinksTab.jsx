// Extracted from AdminDashboard.jsx — SharedLinksTab.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import {
  RefreshCw, FileText, Search, Monitor, Link2, MapPin, Eye
} from 'lucide-react'
import { api } from '../../services/api'
import { FilterSelect } from '../../components/FilterSelect'
import { Badge, Skeleton } from './ui'
import { fmt, ts } from './utils'

export function SharedLinksTab() {
  const [data, setData] = useState({ views: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [resourceType, setResourceType] = useState('')
  const [selected, setSelected] = useState(null)
  const [accesses, setAccesses] = useState([])
  const [stats, setStats] = useState(null)
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
    if (selected === token) {
      setSelected(null)
      setAccesses([])
      setStats(null)
      return
    }
    setSelected(token)
    setLoadingAccesses(true)
    try {
      const [res, statRes] = await Promise.all([
        api.admin.sharedLinkAccesses(token),
        api.admin.sharedLinkStats(token),
      ])
      setAccesses(res.accesses || [])
      setStats(statRes || null)
    } finally {
      setLoadingAccesses(false)
    }
  }

  function eventBadgeColor(type) {
    if (type === 'edit') return 'amber'
    if (type === 'attachment_open') return 'purple'
    if (type === 'record_detail') return 'blue'
    return 'green'
  }

  function eventLabel(type) {
    if (type === 'attachment_open') return 'Attachment'
    if (type === 'record_detail') return 'Record detail'
    if (type === 'edit') return 'Edit'
    return 'View'
  }

  function eventIcon(type) {
    if (type === 'attachment_open') return <Link2 size={12} />
    if (type === 'record_detail') return <Search size={12} />
    if (type === 'edit') return <FileText size={12} />
    return <Eye size={12} />
  }

  const selectedView = useMemo(
    () => (data.views || []).find((view) => view.token === selected) || null,
    [data.views, selected],
  )

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

      {/* overflow-clip so the sticky .tbl-head is not defeated by a
          non-scrolling scroll container. */}
      <div className="card p-0 overflow-clip">
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
                  <Fragment key={v.token}>
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
                            <div className="space-y-4">
                              {selectedView && stats && (
                                <div className="space-y-4">
                                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                                    {[
                                      ['Unique viewers', stats.unique_visitors || 0, 'blue'],
                                      ['Page views', stats.page_views || 0, 'green'],
                                      ['Record opens', stats.record_details || 0, 'purple'],
                                      ['Attachment opens', stats.attachment_opens || 0, 'amber'],
                                      ['Edits', stats.edits || 0, selectedView.access_mode === 'edit' ? 'amber' : 'default'],
                                      ['Total events', stats.total_events || 0, 'default'],
                                    ].map(([label, value, color]) => (
                                      <div key={label} className="rounded-2xl p-3"
                                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
                                        <div className="flex items-end justify-between gap-2">
                                          <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{fmt(value)}</p>
                                          <Badge color={color}>{label === 'Edits' ? (selectedView.access_mode || 'read') : 'live'}</Badge>
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                                    <div className="rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                                      <div className="flex items-center justify-between gap-2 mb-3">
                                        <div>
                                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Link investigation</p>
                                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                                            First seen {ts(stats.first_seen)} · Last seen {ts(stats.last_seen)}
                                          </p>
                                        </div>
                                        <Badge color={selectedView.is_dynamic ? 'green' : 'indigo'}>
                                          {selectedView.is_dynamic ? 'Live view' : 'Snapshot'}
                                        </Badge>
                                      </div>
                                      <div className="grid gap-3 md:grid-cols-2">
                                        <div>
                                          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Top locations</p>
                                          <div className="space-y-2">
                                            {(stats.locations || []).slice(0, 5).map((row, index) => (
                                              <div key={`${row.country || 'unknown'}-${row.city || index}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                                                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                                                <div className="min-w-0">
                                                  <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                                                    {[row.city, row.region, row.country].filter(Boolean).join(', ') || 'Unknown'}
                                                  </p>
                                                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{fmt(row.visitors)} visitors · {fmt(row.hits)} hits</p>
                                                </div>
                                                <MapPin size={12} style={{ color: 'var(--text-3)' }} />
                                              </div>
                                            ))}
                                            {!stats.locations?.length && <p className="text-xs" style={{ color: 'var(--text-3)' }}>No geodata recorded yet.</p>}
                                          </div>
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Top devices</p>
                                          <div className="space-y-2">
                                            {(stats.devices || []).slice(0, 5).map((row, index) => (
                                              <div key={`${row.device_type || 'device'}-${row.browser || index}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                                                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                                                <div className="min-w-0">
                                                  <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                                                    {[row.device_type, row.browser, row.os].filter(Boolean).join(' · ') || 'Unknown device'}
                                                  </p>
                                                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{fmt(row.visitors)} unique visitors</p>
                                                </div>
                                                <Monitor size={12} style={{ color: 'var(--text-3)' }} />
                                              </div>
                                            ))}
                                            {!stats.devices?.length && <p className="text-xs" style={{ color: 'var(--text-3)' }}>No device data recorded yet.</p>}
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                                      <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Event timeline</p>
                                      <div className="space-y-2 max-h-72 overflow-y-auto">
                                        {accesses.map((a, i) => (
                                          <div key={`${a.id || a.accessed_at || i}`} className="rounded-xl px-3 py-2.5 text-xs flex items-start justify-between gap-3"
                                            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <Badge color={eventBadgeColor(a.event_type)}>
                                                  <span className="inline-flex items-center gap-1">{eventIcon(a.event_type)}{eventLabel(a.event_type)}</span>
                                                </Badge>
                                                {a.record_id && <code className="text-[11px]">{a.record_id}</code>}
                                                <span className="font-mono">{a.ip || '?'}</span>
                                              </div>
                                              <div className="flex items-center gap-2 mt-1 flex-wrap" style={{ color: 'var(--text-3)' }}>
                                                {a.country && <span>{[a.city, a.region, a.country].filter(Boolean).join(', ')}</span>}
                                                {a.geo_source && <span>{a.geo_source === 'browser' ? 'GPS' : 'IP Geo'}</span>}
                                                {a.device_label && <span>{a.device_label}</span>}
                                                {a.meta?.field && <span>Field: {a.meta.field}</span>}
                                                {a.meta?.file_name && <span>File: {a.meta.file_name}</span>}
                                              </div>
                                            </div>
                                            <span className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>{ts(a.accessed_at)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {!stats && (
                                <div className="space-y-2 max-h-72 overflow-y-auto">
                                  {accesses.map((a, i) => (
                                    <div key={`${a.id || a.accessed_at || i}`} className="rounded-xl px-3 py-2 text-xs flex items-start justify-between gap-3"
                                      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <Badge color={eventBadgeColor(a.event_type)}>{String(a.event_type || 'view').toUpperCase()}</Badge>
                                          <span className="font-mono">{a.ip || '?'}</span>
                                        </div>
                                      </div>
                                      <span className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>{ts(a.accessed_at)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
