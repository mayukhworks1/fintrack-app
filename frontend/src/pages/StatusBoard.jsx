/**
 * Status Board v3
 *
 * • Status Dashboard — live stat strip with per-status counts + click-to-filter
 * • Three view modes: Card (grouped by client) | List (configurable columns) | Board (Kanban DnD)
 * • Kanban drag-and-drop — drag cards between status columns, updates Teable instantly
 * • Detail Panel — slide-in right panel with full record details (eye button)
 * • Saved Views — name, save, switch, delete views (localStorage)
 * • URL-encoded view config — shareable internal links (?v=BASE64)
 * • Multi-select + AI Update + External Share (existing)
 * • Mobile-first responsive throughout
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

import { Activity, Plus, X, Check, ChevronDown, ChevronUp, RefreshCw, Search, AlertCircle, Loader2, ClipboardList, Sparkles, Share2, Link2, LayoutGrid, List, Columns, Bookmark, SlidersHorizontal, GripVertical } from 'lucide-react'
import { api, clientCacheBust, getAuthToken, API_BASE_URL } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'

import EmptyState from '../components/EmptyState'

// ── Extracted modules ─────────────────────────────────────────────────────
import { AIUpdateModal, AppearancePanel, ColumnSelector, ConfirmModal, ManageSharesModal, SavedViewsMenu, ShareModal, StatusModal } from './statusboard/StatusModals'
import { DetailPanel, KanbanColumn, ListViewRow, StatusCard, StatusDashboard } from './statusboard/StatusViews'
import { BOARD_GROUP_OPTIONS, CARD_GROUP_OPTIONS, CARD_GROUP_SORT_OPTIONS, CARD_RECORD_SORT_OPTIONS, DEFAULT_COLUMNS, EXECUTIVE_VARS_DARK, EXECUTIVE_VARS_LIGHT, LIST_COLUMN_META, STATUS_FILTER_FIELDS, STATUS_OPTIONS_FALLBACK, clientColor, encodeViewConfig, getListLayout, getViewConfigFromUrl, hexToRgba, resolveTheme, sanitizeAttachmentsForSave, statusStyle } from './statusboard/utils'

// ── Status config ─────────────────────────────────────────────────────────────
// Fallback only — real options are fetched dynamically from the picklist API
// and merged at runtime in the component. This array is never shown on its own.
export default function StatusBoard() {
  const { isEditor } = useAuth()
  const { showToast } = useToast()
  const { dark } = useTheme()

  // ── Core data ──────────────────────────────────────────────────────────────
  const [records,     setRecords]     = useState([])
  const [statusPicklists, setStatusPicklists] = useState({})
  const [statusScopeOptions, setStatusScopeOptions] = useState({ clients: [], projects: [], projects_by_client: {} })
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  // ── View config (persisted in URL) ────────────────────────────────────────
  const initConfig = getViewConfigFromUrl() || {
    type: 'card',
    filterClient: '',
    filterStatus: '',
    search: '',
    columns: DEFAULT_COLUMNS,
    boardGroupBy: 'Status',
    cardGroupBy: 'Client',
    cardGroupSort: 'count-desc',
    cardRecordSort: 'project-asc',
    advancedConditions: [],
    theme: 'cobalt',
    density: 'comfortable',
    showDashboard: true,
    showClientAccents: true,
  }
  const [viewType,      setViewType]      = useState(initConfig.type || 'card')
  const [filterClient,  setFilterClient]  = useState(initConfig.filterClient || '')
  const [filterStatus,  setFilterStatus]  = useState(initConfig.filterStatus || '')
  const [search,        setSearch]        = useState(initConfig.search || '')
  const [listColumns,   setListColumns]   = useState(initConfig.columns || DEFAULT_COLUMNS)
  const [boardGroupBy,  setBoardGroupBy]  = useState(initConfig.boardGroupBy || 'Status')
  const [cardGroupBy,   setCardGroupBy]   = useState(initConfig.cardGroupBy || 'Client')
  const [cardGroupSort, setCardGroupSort] = useState(initConfig.cardGroupSort || 'count-desc')
  const [cardRecordSort, setCardRecordSort] = useState(initConfig.cardRecordSort || 'project-asc')
  const [advancedConditions, setAdvancedConditions] = useState(initConfig.advancedConditions || [])
  const [themeId,       setThemeId]       = useState(initConfig.theme || 'cobalt')
  const [density,       setDensity]       = useState(initConfig.density || 'comfortable')
  const [showDashboard, setShowDashboard] = useState(initConfig.showDashboard !== false)
  const [showClientAccents, setShowClientAccents] = useState(initConfig.showClientAccents !== false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [allExpanded,   setAllExpanded]   = useState(false)  // global expand/collapse for cards
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [modal,         setModal]         = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [deletingId,    setDeletingId]    = useState(null)
  const [updatingIds,   setUpdatingIds]   = useState(new Set())  // kanban DnD in-flight
  const [detailRecord,      setDetailRecord]      = useState(null)
  const [aiModal,           setAiModal]           = useState(false)
  const [shareModal,    setShareModal]    = useState(false)
  const [manageModal,   setManageModal]   = useState(false)
  const [showViews,     setShowViews]     = useState(false)
  const [showCols,      setShowCols]      = useState(false)
  const [showSettings,  setShowSettings]  = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [shareViewModal, setShareViewModal] = useState(false)
  const [draggedId, setDraggedId] = useState('')
  const [pendingStatusById, setPendingStatusById] = useState({})
  const [confirmDialog, setConfirmDialog] = useState(null) // { message, onConfirm, confirmLabel? }

  const statusOptions = useMemo(() => {
    const dynamic = statusPicklists?.Status?.options || []
    const merged = [...new Set([...dynamic, ...STATUS_OPTIONS_FALLBACK])]
    return merged.length ? merged : STATUS_OPTIONS_FALLBACK
  }, [statusPicklists])
  const recordsForView = useMemo(
    () => records.map(r => {
      const pendingStatus = pendingStatusById[r.id]
      return pendingStatus ? { ...r, fields: { ...r.fields, Status: pendingStatus } } : r
    }),
    [records, pendingStatusById]
  )
  const listLayout = useMemo(() => getListLayout(listColumns, isEditor), [listColumns, isEditor])

  // ── Persist view config to URL on any change ──────────────────────────────
  useEffect(() => {
    const cfg = {
      type: viewType,
      filterClient,
      filterStatus,
      search,
      columns: listColumns,
      boardGroupBy,
      cardGroupBy,
      cardGroupSort,
      cardRecordSort,
      advancedConditions,
      theme: themeId,
      density,
      showDashboard,
      showClientAccents,
    }
    const encoded = encodeViewConfig(cfg)
    const url = new URL(window.location.href)
    url.searchParams.set('v', encoded)
    window.history.replaceState({}, '', url.toString())
  }, [viewType, filterClient, filterStatus, search, listColumns, boardGroupBy, cardGroupBy, cardGroupSort, cardRecordSort, advancedConditions, themeId, density, showDashboard, showClientAccents])

  // ── Load data ─────────────────────────────────────────────────────────────
  // silent=true → background refresh; no spinner, no error banner reset
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) { setLoading(true); setError(null) }
    try {
      const res = await api.status.list()
      setRecords(res.records || [])
      if (!silent) setPendingStatusById({})
      api.status.picklists.get()
        .then(picklists => setStatusPicklists(picklists || {}))
        .catch(() => {})
      api.status.options()
        .then((opts) => setStatusScopeOptions(opts || { clients: [], projects: [], projects_by_client: {} }))
        .catch(() => {})
    }
    catch (e) { if (!silent) setError(e.message || 'Failed to load') }
    finally { if (!silent) setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // ── Real-time SSE sync (zero-latency push from backend) ───────────────────
  // Backend fires a "changed" event whenever any status record is mutated —
  // whether the mutation came through this app OR directly in Teable.
  // On event we bust the local cache then silently reload so the UI updates
  // without any spinner / flash.
  useEffect(() => {
    const token = getAuthToken()
    if (!token) return

    let es = null
    let retryTimer = null
    let retryDelay = 3000  // start at 3 s, cap at 30 s
    let alive = true

    // IMPORTANT: use API_BASE_URL (absolute) because EventSource doesn't
    // go through the request() helper.  In production, VITE_API_URL is set
    // to the HuggingFace Space URL so we must prepend it explicitly.
    const streamUrl = `${API_BASE_URL}/api/status/stream?token=${encodeURIComponent(token)}`

    function silentReload() {
      // Bust both client-side 45 s cache AND ensure backend Valkey is bypassed
      // by appending a unique timestamp so the cache key never matches.
      clientCacheBust('/api/status')
      load({ silent: true })
    }

    function connect() {
      if (!alive) return
      try {
        es = new EventSource(streamUrl)

        es.addEventListener('connected', () => {
          retryDelay = 3000  // reset backoff on successful connection
        })

        es.addEventListener('changed', () => {
          silentReload()
        })

        es.onerror = () => {
          es?.close()
          es = null
          if (!alive) return
          // Reconnect with exponential backoff (3 s → 6 s → 12 s … max 30 s)
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30000)
            connect()
          }, retryDelay)
        }
      } catch {
        // EventSource not supported or network error — fall through to polling only
      }
    }

    connect()

    // Fallback polling — 30 s intervals in case SSE is blocked by proxy/CDN.
    // Also acts as a catch-all for missed events.
    const pollTimer = setInterval(silentReload, 30000)

    return () => {
      alive = false
      es?.close()
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
    }
  }, [load])  // load is stable (useCallback with no deps)

  // ── Derived / filtered data ───────────────────────────────────────────────
  const baseFiltered = recordsForView.filter(r => {
    const f = r.fields || {}
    if (filterClient && f['Client'] !== filterClient) return false
    if (filterStatus && (f['Status'] || 'Not started') !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = [f['Client'], f['Project'], f['Short Status'], f['Current Status (Detailed)'], f['Status']].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const filtered = useMemo(
    () => applyConditions(baseFiltered, advancedConditions, r => r.fields || {}),
    [baseFiltered, advancedConditions]
  )
  const cardGroups = useMemo(() => {
    const groups = new Map()
    for (const record of filtered) {
      const rawValue = record.fields?.[cardGroupBy]
      const key = rawValue || (cardGroupBy === 'Status' ? 'Not started' : 'Unknown')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(record)
    }

    const sortRecords = (records) => {
      const items = [...records]
      items.sort((a, b) => {
        const af = a.fields || {}
        const bf = b.fields || {}
        switch (cardRecordSort) {
          case 'project-desc':
            return String(bf['Project'] || '').localeCompare(String(af['Project'] || ''))
          case 'modified-desc':
            return new Date(bf.lastModifiedTime || 0).getTime() - new Date(af.lastModifiedTime || 0).getTime()
          case 'modified-asc':
            return new Date(af.lastModifiedTime || 0).getTime() - new Date(bf.lastModifiedTime || 0).getTime()
          case 'status-asc':
            return String(af['Status'] || 'Not started').localeCompare(String(bf['Status'] || 'Not started'))
          case 'project-asc':
          default:
            return String(af['Project'] || '').localeCompare(String(bf['Project'] || ''))
        }
      })
      return items
    }

    const shaped = [...groups.entries()].map(([key, records]) => ({
      key,
      records: sortRecords(records),
      count: records.length,
    }))

    shaped.sort((a, b) => {
      switch (cardGroupSort) {
        case 'count-asc':
          return a.count - b.count || String(a.key).localeCompare(String(b.key))
        case 'name-desc':
          return String(b.key).localeCompare(String(a.key))
        case 'name-asc':
          return String(a.key).localeCompare(String(b.key))
        case 'count-desc':
        default:
          return b.count - a.count || String(a.key).localeCompare(String(b.key))
      }
    })

    return shaped
  }, [filtered, cardGroupBy, cardGroupSort, cardRecordSort])
  const allClients = [...new Set(recordsForView.map(r => r.fields?.['Client']).filter(Boolean))].sort()
  const boardColumnKeys = useMemo(() => {
    const ordered = boardGroupBy === 'Status' ? statusOptions : [...new Set(filtered.map(r => r.fields?.[boardGroupBy] || 'Unassigned'))].sort((a, b) => String(a).localeCompare(String(b)))
    return ordered.length ? ordered : ['Unassigned']
  }, [boardGroupBy, filtered, statusOptions])
  const selectedRecords = recordsForView.filter(r => selectedIds.has(r.id))
  const hasSelection = selectedIds.size > 0
  const theme = resolveTheme(themeId)
  const compact = density === 'compact'
  const boardIsDraggable = boardGroupBy === 'Status'
  const statusCounts = useMemo(
    () => statusOptions.map(status => ({
      status,
      count: recordsForView.filter(r => (r.fields?.['Status'] || 'Not started') === status).length,
    })),
    [recordsForView, statusOptions]
  )
  const topStatusSignal = useMemo(() => {
    const activeCounts = statusCounts.filter(item => item.count > 0)
    if (!activeCounts.length) return null
    return [...activeCounts].sort((a, b) => b.count - a.count)[0]
  }, [statusCounts])
  const executiveVars = dark ? EXECUTIVE_VARS_DARK : EXECUTIVE_VARS_LIGHT
  const boardVars = useMemo(() => ({
    ...executiveVars,
    '--accent': theme.accent,
    '--accent-dim': theme.accentDim,
    '--accent-soft': theme.accentSoft,
  }), [theme, executiveVars])

  function toggleSelect(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll() { setSelectedIds(new Set(filtered.map(r => r.id))) }
  function clearSelection() { setSelectedIds(new Set()) }
  // Toggling one card expands/collapses ALL cards simultaneously
  function toggleExpandAll() { setAllExpanded(v => !v) }

  // ── Share view — opens modal with all visible records + current view config ─
  function shareViewUrl() {
    if (filtered.length === 0) { showToast('No records visible to share.', 'error'); return }
    setShareViewModal(true)
  }

  // ── Load saved view ───────────────────────────────────────────────────────
  function loadSavedView(cfg) {
    if (cfg.type)         setViewType(cfg.type)
    if (cfg.filterClient !== undefined) setFilterClient(cfg.filterClient)
    if (cfg.filterStatus !== undefined) setFilterStatus(cfg.filterStatus)
    if (cfg.search !== undefined)       setSearch(cfg.search)
    if (cfg.columns !== undefined)      setListColumns(cfg.columns)
    if (cfg.boardGroupBy !== undefined) setBoardGroupBy(cfg.boardGroupBy)
    if (cfg.cardGroupBy !== undefined) setCardGroupBy(cfg.cardGroupBy)
    if (cfg.cardGroupSort !== undefined) setCardGroupSort(cfg.cardGroupSort)
    if (cfg.cardRecordSort !== undefined) setCardRecordSort(cfg.cardRecordSort)
    if (cfg.advancedConditions !== undefined) setAdvancedConditions(cfg.advancedConditions)
    if (cfg.theme)        setThemeId(cfg.theme)
    if (cfg.density)      setDensity(cfg.density)
    if (cfg.showDashboard !== undefined) setShowDashboard(cfg.showDashboard !== false)
    if (cfg.showClientAccents !== undefined) setShowClientAccents(cfg.showClientAccents !== false)
    clearSelection()
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function handleCreate(form) {
    setSaving(true)
    try {
      const { attachments, ...payload } = form
      const created = await api.status.create(payload)
      if (created?.id) {
        setRecords((current) => [created, ...current.filter((item) => item.id !== created.id)])
      }
      clientCacheBust('/api/status')
      showToast('Created. Any active shared status links will reflect it automatically.', 'success')
      setModal(null)
    }
    catch (e) { showToast(e.message || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  async function handleEdit(form) {
    if (!modal?.id) return
    setSaving(true)
    try {
      const { attachments, ...rest } = form
      const sanitized = sanitizeAttachmentsForSave(attachments)
      // Teable rejects Attachments:[] — only include the field when there are actual items
      const payload = sanitized.length > 0 ? { ...rest, attachments: sanitized } : rest
      const updated = await api.status.update(modal.id, payload)
      if (updated?.id || updated?.fields) {
        setRecords((current) => current.map((record) => {
          if (record.id !== modal.id) return record
          return updated?.fields ? { ...record, ...updated, fields: { ...(record.fields || {}), ...updated.fields } } : record
        }))
      }
      clientCacheBust('/api/status')
      showToast('Saved. Any active shared status links will use the latest Teable data.', 'success')
      setModal(null)
    }
    catch (e) { showToast(e.message || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  async function handleDelete(record) {
    setConfirmDialog({
      message: `Delete status update for "${record.fields?.['Project']}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setDeletingId(record.id)
        if (detailRecord?.id === record.id) setDetailRecord(null)
        try {
          await api.status.delete(record.id); showToast('Deleted', 'success')
          setRecords(rs => rs.filter(r => r.id !== record.id))
          setSelectedIds(s => { const n = new Set(s); n.delete(record.id); return n })
        } catch (e) { showToast(e.message || 'Failed', 'error') }
        finally { setDeletingId(null) }
      },
    })
  }

  // ── Kanban drag-and-drop ──────────────────────────────────────────────────
  async function handleKanbanDrop(toStatus, e) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setDraggedId('')
    if (!id) return
    const record = recordsForView.find(r => r.id === id)
    const fromStatus = record?.fields?.['Status'] || 'Not started'
    if (fromStatus === toStatus) return

    setPendingStatusById(prev => ({ ...prev, [id]: toStatus }))
    setUpdatingIds(s => { const n = new Set(s); n.add(id); return n })

    try {
      const updated = await api.status.update(id, { status: toStatus })
      setRecords(rs => rs.map(r => {
        if (r.id !== id) return r
        if (updated && updated.fields) return { ...r, ...updated, fields: updated.fields }
        return { ...r, fields: { ...r.fields, Status: toStatus } }
      }))
      showToast(`Moved to ${toStatus}`, 'success')
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error')
    } finally {
      setPendingStatusById(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setUpdatingIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  // ── Current view config (for saved views) ────────────────────────────────
  const currentConfig = {
    type: viewType,
    filterClient,
    filterStatus,
    search,
    columns: listColumns,
    boardGroupBy,
    cardGroupBy,
    cardGroupSort,
    cardRecordSort,
    advancedConditions,
    theme: themeId,
    density,
    showDashboard,
    showClientAccents,
    allExpanded,   // ← include card expansion state so shared view matches
  }

  async function addStatusOption(option) {
    const trimmed = option.trim()
    if (!trimmed) return
    try {
      const res = await api.status.picklists.add('Status', trimmed)
      setStatusPicklists(prev => ({ ...prev, Status: { ...(prev.Status || {}), options: res.options || [] } }))
      showToast('Status option added', 'success')
    } catch (e) {
      showToast(e.message || 'Failed to add option', 'error')
      throw e
    }
  }

  return (
    <div className="relative min-h-screen" style={boardVars}>
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4 pb-28">

        {/* ── Page header ── */}
        <div
          className="rounded-[30px] border p-4 sm:p-5 space-y-5"
          style={{
            background: dark
              ? 'radial-gradient(circle at top left, rgba(125,149,255,0.14), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)'
              : 'radial-gradient(circle at top left, rgba(75,103,255,0.10), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,249,255,0.94) 100%)',
            borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
            boxShadow: dark ? '0 24px 60px rgba(0,0,0,0.26)' : '0 24px 60px rgba(15,23,42,0.08)',
          }}
        >
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-[18px] flex items-center justify-center flex-shrink-0"
                style={{ background: dark ? 'rgba(125,149,255,0.16)' : 'rgba(75,103,255,0.10)', border: dark ? '1px solid rgba(125,149,255,0.24)' : '1px solid rgba(75,103,255,0.14)', boxShadow: dark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.8)' }}>
                <Activity size={19} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: 'var(--accent)' }}>
                  Portfolio command board
                </p>
                <h1 className="text-[32px] sm:text-[36px] font-semibold leading-[0.95] tracking-[-0.04em]" style={{ color: 'var(--text-1)' }}>
                  Status Board
                </h1>
                <p className="text-sm mt-3 leading-6 max-w-2xl" style={{ color: 'var(--text-3)' }}>
                  {loading
                    ? 'Loading current status distribution and project signals…'
                    : error
                      ? 'Status sync unavailable right now'
                      : `Track delivery momentum, blockers, and client-facing project movement across ${records.length} projects and ${allClients.length} clients.`}
                  {hasSelection ? <span className="ml-2 font-semibold" style={{ color: 'var(--accent)' }}>· {selectedIds.size} selected</span> : null}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <div className="flex items-center rounded-2xl overflow-hidden shrink-0" style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                  {[
                    { id: 'card',  Icon: LayoutGrid, label: 'Card' },
                    { id: 'list',  Icon: List,        label: 'List' },
                    { id: 'board', Icon: Columns,     label: 'Board' },
                  ].map(({ id, Icon, label }) => (
                    <button key={id} onClick={() => setViewType(id)} title={`${label} view`}
                      className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold transition-all min-h-[40px]"
                      style={{ color: viewType === id ? 'var(--accent)' : 'var(--text-3)', background: viewType === id ? 'var(--accent-dim)' : 'transparent' }}>
                      <Icon size={13} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {viewType === 'list' && (
                  <div className="relative">
                    <button onClick={() => { setShowCols(s => !s); setShowViews(false); setShowSettings(false) }}
                      className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                      <SlidersHorizontal size={12} /> Columns ({listColumns.length})
                    </button>
                    {showCols && <ColumnSelector columns={listColumns} onChange={setListColumns} onClose={() => setShowCols(false)} />}
                  </div>
                )}

                <div className="relative">
                  <button onClick={() => { setShowViews(s => !s); setShowCols(false); setShowSettings(false) }}
                    className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <Bookmark size={12} /> Views
                  </button>
                  {showViews && <SavedViewsMenu currentConfig={currentConfig} onLoad={loadSavedView} onClose={() => setShowViews(false)} />}
                </div>

                <div className="relative">
                  <button onClick={() => { setShowSettings(s => !s); setShowViews(false); setShowCols(false) }}
                    className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <SlidersHorizontal size={12} /> Customize
                  </button>
                  {showSettings && (
                    <AppearancePanel
                      themeId={themeId}
                      density={density}
                      showDashboard={showDashboard}
                      showClientAccents={showClientAccents}
                      statusOptions={statusOptions}
                      canManageStatuses={isEditor}
                      onThemeChange={setThemeId}
                      onDensityChange={setDensity}
                      onToggleDashboard={() => setShowDashboard(v => !v)}
                      onToggleClientAccents={() => setShowClientAccents(v => !v)}
                      onAddStatusOption={isEditor ? addStatusOption : null}
                      onClose={() => setShowSettings(false)}
                    />
                  )}
                </div>
              </div>

              {(viewType === 'board' || viewType === 'card') && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 w-full xl:w-auto">
                  {viewType === 'board' && (
                    <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[180px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Group by</span>
                      <select
                        className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                        value={boardGroupBy}
                        onChange={e => setBoardGroupBy(e.target.value)}
                        style={{ color: 'var(--text-1)' }}
                      >
                        {BOARD_GROUP_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {viewType === 'card' && (
                    <>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[180px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Group</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardGroupBy}
                          onChange={e => setCardGroupBy(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_GROUP_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[210px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Order</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardGroupSort}
                          onChange={e => setCardGroupSort(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_GROUP_SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[190px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Cards</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardRecordSort}
                          onChange={e => setCardRecordSort(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_RECORD_SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={toggleExpandAll}
                        className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[170px] justify-between"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                        title={allExpanded ? 'Collapse all cards' : 'Expand all cards'}
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>
                          Details
                        </span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {allExpanded ? 'Collapse all' : 'Expand all'}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <button onClick={shareViewUrl}
                  className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]"
                  title="Generate a public share link for the current view">
                  <Share2 size={12} />
                  <span>Share View</span>
                </button>

                {isEditor && (
                  <button onClick={() => setManageModal(true)} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <Link2 size={12} /> <span>Links</span>
                  </button>
                )}

                <button onClick={load} disabled={loading} className="btn-ghost px-3 py-2 min-h-[40px]" title="Refresh">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
                {isEditor && (
                  <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm px-4 py-2 min-h-[40px]">
                    <Plus size={13} /> <span>Add Status</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {!loading && !error && records.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>All tracked</p>
                <p className="text-2xl font-semibold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{records.length}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{allClients.length} distinct clients</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Visible now</p>
                <p className="text-2xl font-semibold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{filtered.length}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{advancedConditions.length ? `${advancedConditions.length} advanced rule${advancedConditions.length !== 1 ? 's' : ''}` : 'No advanced rules'}</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(132,226,84,0.08)' : 'rgba(22,145,95,0.08)', border: dark ? '1px solid rgba(132,226,84,0.12)' : '1px solid rgba(22,145,95,0.12)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Main signal</p>
                <p className="text-lg font-semibold mt-2" style={{ color: 'var(--fin-positive)' }}>{topStatusSignal?.status || 'No active statuses'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{topStatusSignal ? `${topStatusSignal.count} project${topStatusSignal.count === 1 ? '' : 's'} currently in this state` : 'Waiting for live status records'}</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Board mode</p>
                <p className="text-lg font-semibold mt-2" style={{ color: 'var(--text-1)' }}>
                  {viewType === 'card' ? 'Client cards' : viewType === 'list' ? 'Operational list' : 'Kanban board'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  {viewType === 'card'
                    ? `${cardGroupBy} grouping · ${cardRecordSort.replace('-', ' ')}`
                    : viewType === 'list'
                      ? `${listColumns.length} visible column${listColumns.length === 1 ? '' : 's'}`
                      : `${boardGroupBy} grouping${boardIsDraggable ? ' · drag enabled' : ' · drag disabled'}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Status Dashboard ── */}
        {!loading && records.length > 0 && showDashboard && (
          <StatusDashboard records={records} statusOptions={statusOptions} filterStatus={filterStatus} onFilterStatus={setFilterStatus} />
        )}

        {/* ── Filter bar ── */}
        <div className="rounded-[24px] p-3 sm:p-4" style={{ background: dark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.78)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input type="text" className="input-field w-full pl-8 text-sm"
              placeholder="Search projects, clients, status…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input-field text-sm sm:w-36" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
            <option value="">All clients</option>
            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setShowAdvancedFilters(v => !v)}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap"
          >
            <SlidersHorizontal size={12} />
            {showAdvancedFilters ? 'Hide advanced' : 'Advanced filters'}
          </button>
          {/* Select all (card/list views) */}
          {filtered.length > 0 && isEditor && viewType !== 'board' && (
            <button
              onClick={hasSelection && selectedIds.size === filtered.length ? clearSelection : selectAll}
              className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap">
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center"
                style={{ background: hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--bg-input)', border: `1.5px solid ${hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--border)'}` }}>
                {hasSelection && selectedIds.size === filtered.length && <Check size={9} color="#fff" strokeWidth={3} />}
              </div>
              {hasSelection && selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
          Search by project, client, headline, or detail. Use advanced filters when you need a narrower operational slice.
        </p>
        </div>

        {showAdvancedFilters && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <FilterBuilder
              fields={STATUS_FILTER_FIELDS}
              records={records}
              getFieldValue={r => r.fields || {}}
              conditions={advancedConditions}
              onChange={setAdvancedConditions}
            />
          </div>
        )}

        {/* ── Active filter chips ── */}
        {Boolean(filterClient || filterStatus || search || advancedConditions.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Filters:</span>
            {filterClient && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                Client: {filterClient}
                <button onClick={() => setFilterClient('')} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            {filterStatus && (() => { const sc = statusStyle(filterStatus); return (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                {filterStatus}
                <button onClick={() => setFilterStatus('')} style={{ color: sc.color }}><X size={10} /></button>
              </span>
            )})()}
            {search && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                "{search}"
                <button onClick={() => setSearch('')} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            {advancedConditions.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {advancedConditions.length} advanced rule{advancedConditions.length !== 1 ? 's' : ''}
                <button onClick={() => setAdvancedConditions([])} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            <button onClick={() => { setFilterClient(''); setFilterStatus(''); setSearch(''); setAdvancedConditions([]) }}
              className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              Clear all
            </button>
          </div>
        )}

        {viewType === 'list' && !loading && !error && filtered.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>Visible columns</span>
            {listLayout.active.map(col => (
              <span key={col} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {LIST_COLUMN_META[col]?.label || col}
              </span>
            ))}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <div className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
            <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Failed to load</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
              <button onClick={load} className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}>Retry</button>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && records.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={24} />}
            title="No status updates yet"
            subtitle="Add live project status entries to track what's happening across the portfolio."
            action={isEditor && (
              <button className="btn-primary" onClick={() => setModal('new')}>
                <Plus size={13} />Add first status
              </button>
            )}
          />
        )}

        {/* ── No results ── */}
        {!loading && !error && records.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title="No entries match your filter"
            subtitle="Try adjusting your search, client, or status filters."
            action={
              <button onClick={() => { setSearch(''); setFilterClient(''); setFilterStatus('') }} className="btn-ghost">
                Clear filters
              </button>
            }
            compact
          />
        )}

        {/* ══ CARD VIEW ══ */}
        {!loading && !error && filtered.length > 0 && viewType === 'card' && (
          <div className="space-y-6">
            {cardGroups.map(({ key, records: recs, count }) => {
              const clrHex = cardGroupBy === 'Client' ? clientColor(key) : statusStyle(key).color
              const groupStyle = cardGroupBy === 'Status'
                ? statusStyle(key)
                : { bg: hexToRgba(clrHex, 0.1), border: hexToRgba(clrHex, 0.3), color: clrHex, dot: clrHex }
              const groupSel = recs.filter(r => selectedIds.has(r.id)).length
              return (
                <section key={key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                        style={{ background: groupStyle.bg, border: `1px solid ${groupStyle.border}`, color: groupStyle.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: groupStyle.dot }} />
                        {key}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {count} project{count !== 1 ? 's' : ''}
                        {groupSel > 0 && <span className="ml-1 font-semibold" style={{ color: clrHex }}>· {groupSel} selected</span>}
                      </span>
                    </div>
                    {isEditor && recs.length > 1 && (
                      <button
                        onClick={() => {
                          const allGroupSel = recs.every(r => selectedIds.has(r.id))
                          setSelectedIds(s => { const n = new Set(s); recs.forEach(r => allGroupSel ? n.delete(r.id) : n.add(r.id)); return n })
                        }}
                        className="text-[11px] font-medium px-2 py-0.5 rounded-lg"
                        style={{ color: 'var(--text-3)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        {recs.every(r => selectedIds.has(r.id)) ? 'Deselect group' : 'Select group'}
                      </button>
                    )}
                  </div>
                  <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${compact ? 'gap-2' : 'gap-3'}`}>
                    {recs.map(r => (
                      <StatusCard
                        key={r.id}
                        record={r}
                        isEditor={isEditor}
                        onEdit={() => setModal(r)}
                        onDelete={() => handleDelete(r)}
                        onDetail={setDetailRecord}
                        selected={selectedIds.has(r.id)}
                        onSelect={toggleSelect}
                        expanded={allExpanded}
                        onToggle={toggleExpandAll}
                        deleting={deletingId === r.id}
                        compact={compact}
                        showClientAccents={showClientAccents}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {/* ══ LIST VIEW ══ */}
        {!loading && !error && filtered.length > 0 && viewType === 'list' && (
          <div className="rounded-[24px] overflow-hidden" style={{ border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)', background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.94)', boxShadow: dark ? '0 18px 40px rgba(0,0,0,0.24)' : '0 18px 40px rgba(15,23,42,0.08)' }}>
            <div className="overflow-x-auto">
              <div className="min-w-full">
                <div className="grid gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ gridTemplateColumns: listLayout.gridTemplateColumns, minWidth: listLayout.minWidth, background: 'linear-gradient(180deg, rgba(248,250,252,0.98), rgba(241,245,249,0.98))', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                  <span />
                  {listLayout.active.map(col => (
                    <span key={col} className="min-w-0 truncate">{LIST_COLUMN_META[col]?.label || col}</span>
                  ))}
                  <span className="text-right">Actions</span>
                </div>
                {filtered.map((r, i) => (
                  <ListViewRow
                    key={r.id}
                    record={r}
                    idx={i}
                    isEditor={isEditor}
                    onEdit={() => setModal(r)}
                    onDelete={() => handleDelete(r)}
                    onDetail={setDetailRecord}
                    selected={selectedIds.has(r.id)}
                    onSelect={toggleSelect}
                    columns={listColumns}
                    deleting={deletingId === r.id}
                    compact={compact}
                    showClientAccents={showClientAccents}
                    layout={listLayout}
                  />
                ))}
              </div>
            </div>
            {/* Summary row */}
            <div className="px-3 py-2 text-xs flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--bg-input)', borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}>
              <span>{filtered.length} records</span>
              {filterClient && <span>Client: <strong style={{ color: 'var(--text-2)' }}>{filterClient}</strong></span>}
              {filterStatus && (() => { const sc = statusStyle(filterStatus); return <span style={{ color: sc.color }}>● {filterStatus}</span> })()}
            </div>
          </div>
        )}

        {/* ══ BOARD VIEW (Kanban + DnD) ══ */}
        {!loading && !error && viewType === 'board' && (
          <div>
            {isEditor && !boardIsDraggable && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs font-medium"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#d97706' }}>
                <GripVertical size={12} />
                Grouped by <strong>{boardGroupBy}</strong> — drag &amp; drop is disabled. Switch "Group by" to <strong>Status</strong> to move cards between columns.
              </div>
            )}
            {isEditor && boardIsDraggable && (
              <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                <GripVertical size={12} /> Drag cards between columns to update their status
              </p>
            )}
            <div className="overflow-x-auto -mx-4 px-4 pb-4">
              <div className="flex gap-3" style={{ minWidth: `${boardColumnKeys.length * 240}px` }}>
                {boardColumnKeys.map(columnKey => {
                  const recs = filtered.filter(r => (r.fields?.[boardGroupBy] || (boardGroupBy === 'Status' ? 'Not started' : 'Unassigned')) === columnKey)
                  return (
                    <KanbanColumn
                      key={columnKey}
                      statusKey={columnKey}
                      statusLabel={columnKey}
                      records={recs}
                      isEditor={isEditor}
                      onEdit={r => setModal(r)}
                      onDetail={setDetailRecord}
                        selectedIds={selectedIds}
                      onSelect={toggleSelect}
                      onDrop={handleKanbanDrop}
                      updatingIds={updatingIds}
                      onDragStart={setDraggedId}
                      onDragEnd={() => setDraggedId('')}
                      draggedId={draggedId}
                      compact={compact}
                      showClientAccents={showClientAccents}
                      draggable={boardIsDraggable}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating action bar ── */}
      {hasSelection && isEditor && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ width: 'calc(100% - 2rem)', maxWidth: '560px' }}>
          <div className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(15,23,42,0.2), 0 0 0 1px rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--accent)', color: '#fff', fontSize: '11px', fontWeight: 700 }}>
                {selectedIds.size}
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                project{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAiModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}>
                <Sparkles size={13} /> <span className="hidden sm:inline">AI Update</span>
              </button>
              <button onClick={() => setShareModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ background: 'rgba(14,165,233,0.12)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.25)' }}>
                <Share2 size={13} /> <span className="hidden sm:inline">Share</span>
              </button>
              <button aria-label="Clear selection" onClick={clearSelection} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
                <X size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {detailRecord && (
        <DetailPanel
          record={detailRecord}
          onClose={() => setDetailRecord(null)}
          onEdit={() => { setModal(detailRecord); setDetailRecord(null) }}
          onDelete={() => { handleDelete(detailRecord); setDetailRecord(null) }}
          isEditor={isEditor}
        />
      )}

      {/* ── Close dropdowns on outside click ── */}
      {(showViews || showCols || showSettings) && (
        <div className="fixed inset-0 z-20" onClick={() => { setShowViews(false); setShowCols(false); setShowSettings(false) }} />
      )}

      {/* ── Modals ── */}
      {modal && (
        <StatusModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={modal === 'new' ? handleCreate : handleEdit}
          saving={saving}
          allRecords={records}
          statusOptions={statusOptions}
          onAddStatusOption={isEditor ? addStatusOption : null}
          options={statusScopeOptions}
        />
      )}
      {aiModal && (
        <AIUpdateModal selectedRecords={selectedRecords} onClose={() => setAiModal(false)} onShare={() => setShareModal(true)} />
      )}
      {shareModal && (
        <ShareModal selectedRecords={selectedRecords} onClose={() => setShareModal(false)} />
      )}
      {shareViewModal && (
        <ShareModal
          selectedRecords={filtered}
          viewConfig={currentConfig}
          title={`Status Update · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          isViewShare
          onClose={() => setShareViewModal(false)}
        />
      )}
        {manageModal && (
        <ManageSharesModal
          onClose={() => setManageModal(false)}
          currentConfig={currentConfig}
          visibleCount={filtered.length}
          visibleRecords={filtered}
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel || 'Delete'}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}
