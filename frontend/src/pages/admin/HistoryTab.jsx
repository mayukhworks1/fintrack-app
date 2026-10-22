// Extracted from AdminDashboard.jsx — HistoryTab.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Download } from 'lucide-react'
import { api } from '../../services/api'
import { FilterSelect } from '../../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../../components/FilterBuilder'
import { Badge, DetailKV, Empty, Err, Pager, Skeleton } from './ui'
import { ts, fetchAdminAllPages, exportAdminDataset } from './utils'

export function HistoryTab({ drilldown = null, onOpenRecord = null }) {
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [fullRows, setFullRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fullLoading, setFullLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const [expanded, setExp]    = useState(null)
  const [filterSrc, setFs]    = useState('')
  const [filterConditions, setFilterConditions] = useState([])
  const limit = 50

  const buildHistoryParams = useCallback((take, skip) => ({
    limit: Math.min(take, 500),
    offset: skip,
    source_table: filterSrc || undefined,
  }), [filterSrc])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await api.admin.recordHistory(buildHistoryParams(limit, offset)))
    }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [buildHistoryParams, limit, offset])

  const ensureFullRows = useCallback(async () => {
    if (fullRows) return fullRows
    setFullLoading(true)
    try {
      const full = await fetchAdminAllPages(
        ({ limit: take, offset: skip }) => api.admin.recordHistory(buildHistoryParams(take, skip)),
        { pageSize: 500 }
      )
      setFullRows(full.rows)
      return full.rows
    } finally {
      setFullLoading(false)
    }
  }, [fullRows, buildHistoryParams])

  useEffect(() => { setOffset(0) }, [filterSrc, filterConditions])
  useEffect(() => { setFullRows(null) }, [buildHistoryParams])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (filterConditions.length > 0) ensureFullRows().catch((e) => setError(e.message || 'Failed to hydrate full dataset'))
  }, [filterConditions, ensureFullRows])

  useEffect(() => {
    if (!drilldown) return
    setFs(drilldown.sourceTable || '')
    setFilterConditions(drilldown.conditions || [])
    setOffset(0)
    setExp(null)
    setFullRows(null)
  }, [drilldown])

  const sourceColor = { projects: 'blue', invoices: 'purple', web_invoices: 'teal', status: 'orange' }
  const sourceRows = filterConditions.length > 0 ? (fullRows || data?.rows || []) : (data?.rows || [])
  const filteredRows = useMemo(
    () => applyConditions(sourceRows, filterConditions, r => r),
    [sourceRows, filterConditions]
  )
  const displayRows = useMemo(
    () => (filterConditions.length > 0 ? filteredRows.slice(offset, offset + limit) : filteredRows),
    [filteredRows, offset, limit, filterConditions]
  )

  async function handleExport(format) {
    const exportRows = applyConditions(await ensureFullRows(), filterConditions, r => r)
    const columns = [
      { key: 'recorded_at', label: 'Recorded At' },
      { key: 'source_table', label: 'Source Table' },
      { key: 'teable_id', label: 'Record ID' },
      { key: 'change_type', label: 'Change Type' },
      { key: 'change_source', label: 'Origin' },
      { key: 'actor_role', label: 'Actor Role' },
      { key: 'actor_country', label: 'Country' },
      { key: 'actor_city', label: 'City' },
      { key: 'actor_ip', label: 'IP' },
      { key: 'actor_device_label', label: 'Device Label' },
      { key: 'actor_browser', label: 'Browser' },
      { key: 'actor_os', label: 'OS' },
      { key: 'changed_fields', label: 'Changed Fields' },
    ]
    await exportAdminDataset({
      pageKey: 'admin-history',
      title: 'Admin Change History',
      format,
      columns,
      rows: exportRows.map((row) => ({
        ...row,
        changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields.join(', ') : row.changed_fields,
      })),
      filters: {
        source_table: filterSrc,
        conditions: filterConditions,
      },
      metadata: { row_count: exportRows.length },
    })
  }

  const handleOpenRecord = useCallback((row) => {
    if (row.navigate_kind === 'app' && row.navigate_target) {
      navigate(row.navigate_target)
      return
    }
    if (row.navigate_kind === 'admin-invoices' && row.navigate_target && onOpenRecord) {
      try {
        const target = JSON.parse(row.navigate_target)
        onOpenRecord(target.source, target.teable_id)
      } catch {}
    }
  }, [navigate, onOpenRecord])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect
          value={filterSrc}
          onChange={setFs}
          options={['projects','invoices','web_invoices','status']}
          placeholder="All sources"
          width={150}
        />
        <button onClick={() => { setFullRows(null); load() }} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <RefreshCw size={11} /> Refresh
        </button>
        <button onClick={() => handleExport('excel')} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <Download size={11} /> Excel
        </button>
        <button onClick={() => handleExport('pdf')} className="btn-secondary text-xs px-3 py-1 flex items-center gap-1">
          <Download size={11} /> PDF
        </button>
        {data && (
          <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
            {filteredRows.length.toLocaleString()} / {data.total.toLocaleString()} changes
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
          { key: 'recorded_at',          label: 'Recorded At',     type: 'date' },
        ]}
        records={fullRows || data?.rows || []}
        getFieldValue={r => r}
        conditions={filterConditions}
        onChange={setFilterConditions}
        label="Add condition filter"
      />
      {drilldown?.sourceTable && (
        <div className="rounded-xl border px-3 py-2 flex flex-wrap items-center gap-2"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
          <Badge color="red">Delete drilldown</Badge>
          <span className="text-xs" style={{ color: 'var(--text-2)' }}>
            Showing attributed delete history for <span className="font-semibold">{drilldown.label || drilldown.sourceTable}</span>.
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Expand a row to inspect session, IP, device, browser, OS, location, and full mutation details.
          </span>
        </div>
      )}
      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {fullLoading && (
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>Hydrating full history for condition filters…</div>
          )}
          {filteredRows.length === 0
            ? <Empty label="No change history yet" />
            : (
              <div className="space-y-1">
                {displayRows.map(row => (
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
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {row.record_label || row.teable_id}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                          {[row.record_subtitle, row.teable_id].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {row.changed_fields?.length > 0 && (
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {row.changed_fields.slice(0, 3).join(', ')}{row.changed_fields.length > 3 ? ` +${row.changed_fields.length - 3}` : ''}
                        </span>
                      )}
                      {row.navigate_kind && row.navigate_target && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenRecord(row) }}
                          className="text-[11px] px-2 py-1 rounded-lg border transition-colors"
                          style={{ borderColor: 'var(--border)', color: 'var(--accent)', background: 'var(--bg-input)' }}>
                          Open
                        </button>
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
          <Pager total={filterConditions.length > 0 ? filteredRows.length : (data?.total || 0)} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}
