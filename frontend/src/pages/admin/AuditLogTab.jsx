// Extracted from AdminDashboard.jsx — AuditLogTab.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Trash2, X, MapPin, Wifi, ChevronDown, ChevronUp, SlidersHorizontal, Download } from 'lucide-react'
import { api } from '../../services/api'
import { FilterBuilder, applyConditions } from '../../components/FilterBuilder'
import { Empty, Err, FMulti, FPill, FSel, Pager, PurgeModal, Skeleton, deviceIcon, methodBadge, roleBadge, statusBadge } from './ui'
import { countryFlag, ts, fetchAdminAllPages, exportAdminDataset } from './utils'

export function AuditLogTab() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [data, setData]         = useState(null)
  const [fullRows, setFullRows] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [fullLoading, setFullLoading] = useState(false)
  const [error, setError]       = useState(null)
  const [offset, setOffset]     = useState(0)
  const [expanded, setExp]      = useState(null)

  // ── Basic filters ──────────────────────────────────────────────────────────
  const [limit,        setLimit]   = useState(100)
  const [filterRole,   setRole]    = useState([])
  const [filterMethod, setMeth]    = useState([])
  const [filterStatus, setStat]    = useState('')

  // ── Advanced filters ───────────────────────────────────────────────────────
  const [showAdv,        setShowAdv]  = useState(false)
  const [filterIp,       setIp]       = useState('')
  const [filterPath,     setPath]     = useState('')
  const [filterCountry,  setCountry]  = useState('')
  const [filterCity,     setCity]     = useState('')
  const [filterIsp,      setIsp]      = useState('')
  const [filterDevice,   setDevice]   = useState([])
  const [filterBrowser,  setBrowser]  = useState('')
  const [filterOs,       setOs]       = useState('')
  const [filterFrom,     setFrom]     = useState('')
  const [filterTo,       setTo]       = useState('')
  const [statusMin,      setStMin]    = useState('')
  const [statusMax,      setStMax]    = useState('')
  const [filterUserEmail,setUserEmail]= useState('')
  const [statusClass,    setStClass]  = useState('')  // '2xx'|'3xx'|'4xx'|'5xx'|''
  const [errorsOnly,     setErrOnly]  = useState(false)

  // ── Time preset helpers ────────────────────────────────────────────────────
  const applyTimePreset = useCallback((preset) => {
    const now = new Date()
    const fmt = (d) => d.toISOString()
    const presets = {
      '1h':  () => { setFrom(fmt(new Date(now - 3600_000)));     setTo('') },
      '24h': () => { setFrom(fmt(new Date(now - 86400_000)));    setTo('') },
      '7d':  () => { setFrom(fmt(new Date(now - 7*86400_000)));  setTo('') },
      '30d': () => { setFrom(fmt(new Date(now - 30*86400_000))); setTo('') },
      'all': () => { setFrom(''); setTo('') },
    }
    presets[preset]?.()
    setOffset(0); setFullRows(null)
  }, [])

  // ── Client-side advanced filter builder ───────────────────────────────────
  const [filterConditions, setFilterConditions] = useState([])
  const auditConditionFields = useCallback((row) => {
    const userParts = [row?.user_email, row?.user_name, row?.user_id].filter(Boolean)
    return {
      ...row,
      user: userParts.join(' · '),
    }
  }, [])

  // ── Purge ──────────────────────────────────────────────────────────────────
  const [showPurge,  setShowPurge]  = useState(false)
  const [purging,    setPurging]    = useState(false)
  const [purgeRes,   setPurgeRes]   = useState(null)

  // ── Active filter count badge ──────────────────────────────────────────────
  const advCount = [filterIp,filterPath,filterCountry,filterCity,filterIsp,
                    filterBrowser,filterOs,filterFrom,filterTo,statusMin,statusMax].filter(Boolean).length
                 + filterDevice.length

  const basicFilters = [filterStatus]

  const buildAuditParams = useCallback((take, skip) => ({
    limit:        take,
    offset:       skip,
    roles:        filterRole.length   ? filterRole.join(',')   : undefined,
    methods:      filterMethod.length ? filterMethod.join(',') : undefined,
    devices:      filterDevice.length ? filterDevice.join(',') : undefined,
    status:       (!statusClass && !statusMin && !statusMax) ? (filterStatus || undefined) : undefined,
    status_min:   (!statusClass && filterStatus === '') ? (statusMin || undefined) : undefined,
    status_max:   (!statusClass && filterStatus === '') ? (statusMax || undefined) : undefined,
    status_class: statusClass   || undefined,
    errors_only:  errorsOnly    || undefined,
    ip:           filterIp      || undefined,
    path:         filterPath    || undefined,
    country:      filterCountry || undefined,
    city:         filterCity    || undefined,
    isp:          filterIsp     || undefined,
    browser:      filterBrowser || undefined,
    os:           filterOs      || undefined,
    user_email:   filterUserEmail || undefined,
    from_ts:      filterFrom    || undefined,
    to_ts:        filterTo      || undefined,
  }), [filterRole, filterMethod, filterDevice, filterStatus, statusMin, statusMax, statusClass, errorsOnly, filterIp, filterPath, filterCountry, filterCity, filterIsp, filterBrowser, filterOs, filterUserEmail, filterFrom, filterTo])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await api.admin.auditLog(buildAuditParams(limit, offset)))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [buildAuditParams, limit, offset])

  const ensureFullRows = useCallback(async () => {
    if (fullRows) return fullRows
    setFullLoading(true)
    try {
      const full = await fetchAdminAllPages(
        ({ limit: take, offset: skip }) => api.admin.auditLog(buildAuditParams(Math.min(take, 500), skip)),
        { pageSize: 500 }
      )
      setFullRows(full.rows)
      return full.rows
    } finally {
      setFullLoading(false)
    }
  }, [fullRows, buildAuditParams])

  const resetFilters = () => {
    setRole([]); setMeth([]); setStat(''); setIp(''); setPath('')
    setCountry(''); setCity(''); setIsp(''); setDevice([]); setBrowser('')
    setOs(''); setFrom(''); setTo(''); setStMin(''); setStMax('')
    setStClass(''); setErrOnly(false); setUserEmail('')
    setFilterConditions([])
    setFullRows(null)
    setOffset(0)
  }

  useEffect(() => { setOffset(0) }, [filterRole, filterMethod, filterStatus,
    statusMin, statusMax, statusClass, errorsOnly, filterIp, filterPath, filterCountry,
    filterCity, filterIsp, filterDevice, filterBrowser, filterOs,
    filterUserEmail, filterFrom, filterTo, filterConditions, limit])

  useEffect(() => { setFullRows(null) }, [buildAuditParams])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (filterConditions.length > 0) ensureFullRows().catch((e) => setError(e.message || 'Failed to hydrate full dataset'))
  }, [filterConditions, ensureFullRows])

  const sourceRows = filterConditions.length > 0 ? (fullRows || data?.rows || []) : (data?.rows || [])
  const filteredRows = useMemo(
    () => applyConditions(sourceRows, filterConditions, auditConditionFields),
    [sourceRows, filterConditions, auditConditionFields]
  )
  const displayRows = useMemo(
    () => (filterConditions.length > 0 ? filteredRows.slice(offset, offset + limit) : filteredRows),
    [filteredRows, offset, limit, filterConditions]
  )

  async function handleExport(format) {
    const exportRows = applyConditions(await ensureFullRows(), filterConditions, auditConditionFields)
      .map(auditConditionFields)
    const columns = [
      { key: 'ts', label: 'Time' },
      { key: 'user', label: 'User' },
      { key: 'user_email', label: 'User Email' },
      { key: 'user_name', label: 'User Name' },
      { key: 'user_id', label: 'User ID' },
      { key: 'role', label: 'Role' },
      { key: 'method', label: 'Method' },
      { key: 'path', label: 'Path' },
      { key: 'status', label: 'Status' },
      { key: 'duration_ms', label: 'Duration (ms)' },
      { key: 'ip', label: 'IP' },
      { key: 'country', label: 'Country' },
      { key: 'city', label: 'City' },
      { key: 'device', label: 'Device' },
      { key: 'os', label: 'OS' },
      { key: 'browser', label: 'Browser' },
      { key: 'isp', label: 'ISP' },
      { key: 'request_id', label: 'Request ID' },
    ]
    await exportAdminDataset({
      pageKey: 'admin-audit-log',
      title: 'Admin Audit Log',
      format,
      columns,
      rows: exportRows,
      filters: {
        user_email: filterUserEmail,
        role: filterRole,
        method: filterMethod,
        status: filterStatus,
        ip: filterIp,
        path: filterPath,
        country: filterCountry,
        city: filterCity,
        isp: filterIsp,
        device: filterDevice,
        browser: filterBrowser,
        os: filterOs,
        from: filterFrom,
        to: filterTo,
        conditions: filterConditions,
      },
      metadata: { row_count: exportRows.length },
    })
  }

  const doPurge = async ({ days, hours } = {}) => {
    setPurging(true); setPurgeRes(null)
    try {
      const r = await api.admin.purgeAuditLog({ days, hours })
      setPurgeRes(r)
      load()  // Refresh table
    } catch(e) { setPurgeRes({ error: e.message }) }
    finally { setPurging(false) }
  }

  const hasAnyFilter = advCount > 0 || filterRole.length > 0 || filterMethod.length > 0 || basicFilters.some(Boolean) || filterUserEmail || statusClass || errorsOnly || filterFrom || filterTo

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

        {/* Time presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Time:</span>
          {['1h','24h','7d','30d','all'].map(p => (
            <button key={p} onClick={() => applyTimePreset(p)}
              className="text-[11px] px-2 py-0.5 rounded-md border transition-colors"
              style={{
                background: (p === 'all' && !filterFrom && !filterTo) || (filterFrom && p !== 'all') ? 'var(--bg-input)' : 'transparent',
                borderColor: 'var(--border)', color: 'var(--text-2)',
              }}>
              {p === 'all' ? 'All time' : `Last ${p}`}
            </button>
          ))}
          {filterFrom && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>from {new Date(filterFrom).toLocaleString('en-IN', {dateStyle:'short', timeStyle:'short'})}</span>}
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <FMulti label="Role" selected={filterRole} onChange={setRole} width={140}
            opts={[['editor','editor'],['viewer','viewer'],['web','web'],['all','all'],['admin','admin']]} />
          <FMulti label="Method" selected={filterMethod} onChange={setMeth} width={130}
            opts={[['GET','GET'],['POST','POST'],['PATCH','PATCH'],['DELETE','DELETE']]} />
          <FSel label="Status" value={statusClass || filterStatus} onChange={v => {
            if (['2xx','3xx','4xx','5xx'].includes(v)) { setStClass(v); setStat('') }
            else { setStClass(''); setStat(v) }
          }}
            opts={[
              ['','All statuses'],
              ['2xx','2xx Success'],['3xx','3xx Redirect'],['4xx','4xx Client Error'],['5xx','5xx Server Error'],
              ['200','200 OK'],['201','201 Created'],['204','204 No Content'],
              ['400','400 Bad Request'],['401','401 Unauthorized'],['403','403 Forbidden'],
              ['404','404 Not Found'],['422','422 Unprocessable'],['500','500 Internal Error'],
            ]} />
          <FPill label="User email" value={filterUserEmail} onChange={setUserEmail} placeholder="user@…" />
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['50','50'],['100','100'],['200','200'],['500','500'],['1000','1000']]} />
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={errorsOnly} onChange={e => setErrOnly(e.target.checked)} />
            Errors only
          </label>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => { setFullRows(null); load() }} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => handleExport('excel')} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <Download size={11} /> Excel
          </button>
          <button onClick={() => handleExport('pdf')} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <Download size={11} /> PDF
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
              { key: 'user', label: 'User', type: 'text' },
              { key: 'user_email', label: 'User Email', type: 'text' },
              { key: 'user_name', label: 'User Name', type: 'text' },
              { key: 'user_id', label: 'User ID', type: 'text' },
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
              { key: 'duration_ms', label: 'Duration (ms)', type: 'number' },
              { key: 'body_size', label: 'Body Size', type: 'number' },
              { key: 'resp_size', label: 'Response Size', type: 'number' },
              { key: 'request_id', label: 'Request ID', type: 'text' },
              { key: 'referer', label: 'Referer', type: 'text' },
              { key: 'timezone', label: 'Timezone', type: 'text' },
              { key: 'token_hint', label: 'Token Hint', type: 'text' },
              { key: 'ts', label: 'Time', type: 'date' },
            ]}
            records={fullRows || data?.rows || []}
            getFieldValue={auditConditionFields}
            conditions={filterConditions}
            onChange={setFilterConditions}
            label="Add condition filter"
          />
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        {data && (
          <div className="flex gap-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <span><b style={{ color: 'var(--text-1)' }}>{filteredRows.length.toLocaleString()}</b> filtered rows</span>
            <span>{data.total.toLocaleString()} total rows</span>
            {fullLoading && <span>hydrating full dataset…</span>}
            <span>showing {filteredRows.length ? offset + 1 : 0}–{Math.min(offset + displayRows.length, filteredRows.length)}</span>
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {/* Mobile card view */}
          {filteredRows.length === 0 ? <Empty /> : (
            <>
              <div className="md:hidden space-y-1.5">
                {displayRows.map(row => (
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
                  {['Time','User','Role','Method','Path','Status','ms','IP · Location','OS / Browser','ISP · Org','Sizes'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-2)', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map(row => (
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

                        {/* User */}
                        <td className="px-3 py-2 max-w-[160px]">
                          {row.user_email ? (
                            <div>
                              <div className="truncate font-medium" style={{ color: 'var(--text-1)', fontSize: 11 }} title={row.user_email}>{row.user_email}</div>
                              {row.user_name && <div className="truncate" style={{ color: 'var(--text-3)', fontSize: 10 }}>{row.user_name}</div>}
                            </div>
                          ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
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
                          style={{ color: row.duration_ms > 5000 ? '#dc2626' : row.duration_ms > 2000 ? '#f59e0b' : 'var(--text-2)' }}>
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
          <Pager total={filterConditions.length > 0 ? filteredRows.length : (data?.total || 0)} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: Sessions ─────────────────────────────────────────────────────────────

// Session status chip — 4 honest states derived from server-computed session_status
