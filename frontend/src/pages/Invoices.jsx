import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

import { useSearchParams } from 'react-router-dom'
import { Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle, CheckCircle2, Search, ExternalLink, FileText, ArrowUpDown, Filter, CalendarDays, User, Tag, Eye, IndianRupee, TrendingUp, Percent, CalendarClock, RotateCcw, Paperclip, Download, Columns3 } from 'lucide-react'
import { api } from '../services/api'
import { LiveValue, LiveDot } from '../components/LiveFigures'
import { useRecordMotion } from '../hooks/useRecordMotion'
import { prefersReducedMotion } from '../hooks/useReducedMotion'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder } from '../components/FilterBuilder'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import clsx from 'clsx'
import { downloadBlob } from '../utils/download'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip } from '../components/ExecutiveUI'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'

// ── Extracted modules ─────────────────────────────────────────────────────
import { InvoiceDetail } from './invoices/InvoiceDetail'
import { InvoiceDrawer } from './invoices/InvoiceDrawer'
import { OverdueAlert } from './invoices/OverdueAlert'
import { InvoiceTableRow } from './invoices/InvoiceTableRow'
import { AgingBadge, MonthStatusPill, RaisedByBadge, ResizableHead, SkeletonRow, StatusPill } from './invoices/ui'
import { DEFAULT_INVOICE_COLUMN_VISIBILITY, DEFAULT_INVOICE_COLUMN_WIDTHS, INVOICE_COLUMNS, INVOICE_COLUMN_VISIBILITY_STORAGE_KEY, normalizeColumnVisibility, INVOICE_FIELDS, INVOICE_REQUEST_FORM_URL, INVOICE_SHARED_HIGHLIGHTABLE_COLUMNS, INVOICE_SHARE_COLUMNS, STATUS_META, buildRetainerGroups, currentMonthKey, effectiveAging, endOfMonthIso, firstDayIso, fmt, fmtDate, monthLabel, parseAttachments, projectInitials, shiftMonthKey, shortMonthLabel } from './invoices/utils'
import { activeConditions as activeRules, invoiceQueryParams, useInvoiceFilters, useInvoiceQuery } from './invoices/useInvoiceQuery'
import { tint } from '../utils/color'

const AGING_BAND_KEYS = ['0-14d', '15-30d', '31-60d', '60d+']
const CHART_PRESETS = [
  { key: '30d',  label: '30d',     days: 30 },
  { key: '60d',  label: '60d',     days: 60 },
  { key: '3m',   label: '3 mo',    days: 90 },
  { key: '6m',   label: '6 mo',    days: 180 },
  { key: '1y',   label: '1 yr',    days: 365 },
  { key: 'custom', label: 'Custom', days: null },
]

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Counts how often `value` changed after it first arrived (for LiveDot). */
function useChangeCount(value) {
  const key = value == null ? null : JSON.stringify(value)
  const seen = useRef(key)
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (key == null) return
    if (seen.current != null && seen.current !== key) setCount(n => n + 1)
    seen.current = key
  }, [key])
  return count
}

/* ── RaisedByBadge ──────────────────────────────────────────────────────── */
export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isEditor, hasPerm } = useAuth()
  // Granular permission flags — these override the coarse isEditor check for email-auth users
  const canCreate  = isEditor && hasPerm('module.invoices.create')
  const canEdit    = isEditor && hasPerm('module.invoices.edit')
  const canPayment = isEditor && hasPerm('module.invoices.payment')
  const toast = useToast()
  // Search, filters, sort and the number of loaded pages live in the URL, so
  // a link reopens the same view and back / forward step through changes.
  const { filters, pages, setFilters, setPages, searchInput, setSearchInput, commitSearch, clearAll } = useInvoiceFilters()
  const {
    status: statusFilter, project: projectFilter, client: clientFilter, category: categoryFilter,
    raisedBy: raisedByFilter, billing: billingFilter, month: monthFilter, aging: agingBandFilter,
    dateField: dateFieldFilter, dateFrom, dateTo, overdue: overdueOnly, hasDocs: hasDocsOnly,
    followupDue: followupDueOnly, conditions: filterConditions, sort: sortCol, order: sortDir,
  } = filters
  const search = filters.q
  const {
    setStatusFilter, setProjectFilter, setClientFilter, setCategoryFilter, setRaisedByFilter,
    setBillingFilter, setMonthFilter, setAgingBandFilter, setDateFieldFilter, setDateFrom, setDateTo,
    setOverdueOnly, setHasDocsOnly, setFollowupDueOnly, setFilterConditions,
  } = useMemo(() => {
    const make = (key, opts) => (value) => setFilters(prev => ({
      [key]: typeof value === 'function' ? value(prev[key]) : value,
    }), opts)
    return {
      setStatusFilter: make('status'), setProjectFilter: make('project'), setClientFilter: make('client'),
      setCategoryFilter: make('category'), setRaisedByFilter: make('raisedBy'), setBillingFilter: make('billing'),
      setMonthFilter: make('month'), setAgingBandFilter: make('aging'), setDateFieldFilter: make('dateField'),
      setDateFrom: make('dateFrom'), setDateTo: make('dateTo'), setOverdueOnly: make('overdue'),
      setHasDocsOnly: make('hasDocs'), setFollowupDueOnly: make('followupDue'),
      // Rules are edited a keystroke at a time; one history entry, not one per key.
      setFilterConditions: make('conditions', { replace: true }),
    }
  }, [setFilters])
  const [workspace,       setWorkspace]       = useState('invoices')
  const [selectedRetainer,setSelectedRetainer]= useState('')
  const [retainerMonth,   setRetainerMonth]   = useState(currentMonthKey())
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [showFilters,    setShowFilters]    = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exporting,      setExporting]      = useState(false)
  const [avatarMap,      setAvatarMap]      = useState({})
  const [drawer, setDrawer] = useState(null)
  const [previewDocs, setPreviewDocs] = useState(null)
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const [columnWidths, setColumnWidths] = useState(DEFAULT_INVOICE_COLUMN_WIDTHS)
  const [columnVisibility, setColumnVisibility] = useState(() => {
    // Restore the user's column choice; a corrupt or stale entry falls back to
    // defaults rather than leaving the table in a broken state.
    try {
      return normalizeColumnVisibility(
        JSON.parse(localStorage.getItem(INVOICE_COLUMN_VISIBILITY_STORAGE_KEY) || 'null'),
      )
    } catch {
      return DEFAULT_INVOICE_COLUMN_VISIBILITY
    }
  })
  const [showColumnMenu, setShowColumnMenu] = useState(false)
  const [tableDensity, setTableDensity] = useState('comfortable')
  const [hoveredRow,   setHoveredRow]   = useState(null)
  const [chartPreset, setChartPreset] = useState('60d')
  const [chartFrom,   setChartFrom]   = useState('')
  const [chartTo,     setChartTo]     = useState('')
  const [balanceMonths, setBalanceMonths] = useState(3)
  const resizeRef    = useRef(null)
  const hoverTimerRef = useRef(null)
  const filterBarRef = useRef(null)
  const resultsRef   = useRef(null)
  const typedSearch  = useRef(false)

  /* ── The list, its totals and the workspace's, from the server ──
   * One request per scope: the page of rows, the totals of everything the
   * search and filters match, and the same totals for the whole workspace
   * (the "of all" hints, the status chips and the month / project widgets). */
  const {
    records, total: scopeTotal, nextCursor, aggregates: agg, workspace: ws, hasData,
    loading, refreshing: syncing, loadingMore, error, errorStatus, loadMore, refresh,
    patchRecord, removeRecord,
  } = useInvoiceQuery(filters, { pages, onPagesChange: setPages })
  const allCount = ws?.count ?? 0
  const workspaceChanges = useChangeCount(ws ? [ws.raised, ws.collected, ws.outstanding, ws.count] : null)

  // Searching moves the reader to the results, under the sticky bar.
  const scrollToResults = useCallback(() => {
    const el = resultsRef.current
    if (!el) return
    const scroller = el.closest('#main-content')
    const bar = filterBarRef.current?.getBoundingClientRect().height || 0
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
    if (scroller) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - bar - 12
      scroller.scrollTo?.({ top: Math.max(0, top), behavior })
    } else {
      const top = el.getBoundingClientRect().top + window.scrollY - bar - 12
      window.scrollTo?.({ top: Math.max(0, top), behavior })
    }
  }, [])
  useEffect(() => {
    if (!typedSearch.current) return
    typedSearch.current = false
    if (search) scrollToResults()
  }, [search, scrollToResults])
  const onSearchInput = useCallback((value) => {
    typedSearch.current = true
    setSearchInput(value)
  }, [setSearchInput])

  useEffect(() => { api.webInvoices.avatarMap().then(setAvatarMap).catch(() => {}) }, [])

  /* ── Live project names from Projects table ──────────────────────────────
   * Merges names from actual invoices (already loaded) with names from the
   * Projects module so brand-new projects appear in the dropdown immediately,
   * even before any invoice is raised for them.  Refreshes every 30 s so
   * projects added by another session also show up without a page reload.   */
  const [liveProjectNames, setLiveProjectNames] = useState([])
  useEffect(() => {
    let cancelled = false
    async function fetchProjectNames() {
      try {
        const list = await api.projects.names({ fresh: true })
        if (cancelled) return
        const names = (list || []).map(p => p.name).filter(Boolean)
        setLiveProjectNames(names)
      } catch { /* non-fatal — invoice-derived list is still shown */ }
    }
    fetchProjectNames()
    const t = setInterval(fetchProjectNames, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  /* ── Picklists from Teable schema (Project, Client Name, Category, etc.) ── */
  const [invoicePicklists, setInvoicePicklists] = useState({})
  useEffect(() => {
    api.invoices.picklists().then(setInvoicePicklists).catch(() => {})
  }, [])

  /* ── Dynamic filter/form options — prefer Teable schema, supplement from the workspace ── */
  const facets = ws?.facets
  const projectOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Project'] || []
    return [...new Set([...fromSchema, ...(facets?.projects || []), ...liveProjectNames])].sort()
  }, [invoicePicklists, facets, liveProjectNames])

  const clientNameOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Client Name'] || []
    return [...new Set([...fromSchema, ...(facets?.clients || [])])].sort()
  }, [invoicePicklists, facets])

  const categoryOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Category'] || []
    return [...new Set([...fromSchema, ...(facets?.categories || [])])].sort()
  }, [invoicePicklists, facets])

  const milestoneOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Milestone'] || []
    return [...new Set([...fromSchema, ...(facets?.milestones || [])])].sort()
  }, [invoicePicklists, facets])

  const raisedByOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Raised By'] || []
    return [...new Set([...fromSchema, ...(facets?.raised_by || [])])].sort()
  }, [invoicePicklists, facets])

  // Bundle for InvoiceDrawer
  const formOptions = useMemo(() => ({
    projects:    projectOptions,
    clientNames: clientNameOptions,
    categories:  categoryOptions,
    milestones:  milestoneOptions,
    raisedBy:    raisedByOptions,
  }), [projectOptions, clientNameOptions, categoryOptions, milestoneOptions, raisedByOptions])

  const monthOptions = useMemo(() => facets?.months || [], [facets])

  const retainerMonthOptions = useMemo(() => (
    [...new Set([currentMonthKey(), ...monthOptions])].sort().reverse()
  ), [monthOptions])

  /* ── Retainer records: fetched when the Retainers workspace is open ── */
  const [retainerRecords, setRetainerRecords] = useState([])
  const loadRetainers = useCallback(async () => {
    try {
      const res = await api.invoices.query({ billing: 'retainer', limit: 200, aggregates: '0' })
      if (res?.data?.records) setRetainerRecords(res.data.records)
    } catch { /* the workspace shows its empty state */ }
  }, [])
  useEffect(() => {
    if (workspace === 'retainers') loadRetainers()
  }, [workspace, loadRetainers])

  const retainerGroups = useMemo(
    () => buildRetainerGroups(retainerRecords, retainerMonth),
    [retainerRecords, retainerMonth],
  )

  useEffect(() => {
    if (!retainerGroups.length) { setSelectedRetainer(''); return }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null

  /* ── Activity chart: the range's own invoices, plus what came before it ── */
  const chartWindow = useMemo(() => {
    const preset = CHART_PRESETS.find(p => p.key === chartPreset) || CHART_PRESETS[1]
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (chartPreset === 'custom') {
      if (!chartFrom) return null
      const start = new Date(chartFrom); start.setHours(0, 0, 0, 0)
      return { start, to: chartTo || '' }
    }
    const start = new Date(today); start.setDate(start.getDate() - ((preset.days || 60) - 1))
    return { start, to: '' }
  }, [chartPreset, chartFrom, chartTo])
  const [chartData, setChartData] = useState({ records: [], baseline: undefined })
  useEffect(() => {
    if (!allCount || !chartWindow) return undefined
    let cancelled = false
    // A day early: "Raised Date" is a UTC day on the server and a local one here.
    const from = new Date(chartWindow.start); from.setDate(from.getDate() - 1)
    api.invoices.query({ date_from: isoDay(from), limit: 200, tz: -new Date().getTimezoneOffset() })
      .then((res) => {
        const d = res?.data
        if (cancelled || !d) return
        // Everything raised before the range: all dated invoices, less those
        // from the day before the range on, plus the ones of that extra day.
        const allDated = (ws?.raised_months || []).reduce((sum, m) => sum + (m.amount || 0), 0)
        const early = d.records.reduce((sum, r) => {
          const raised = new Date(r.fields?.['Raised Date'] || '')
          return !Number.isNaN(raised.getTime()) && raised < chartWindow.start ? sum + Number(r.fields?.['Amount Raised'] || 0) : sum
        }, 0)
        setChartData({ records: d.records, baseline: allDated - (d.aggregates?.totals?.amount_raised || 0) + early })
      })
      .catch(() => {})
    return () => { cancelled = true }
    // Refetched when the range changes or the workspace's totals move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartWindow, allCount, workspaceChanges])

  // Which rows a poll brought in or altered. Watching the money and the status
  // rather than the whole record: a row is news when it arrives, when it gets
  // paid, or when the figure on it moves — not when some unrelated field is
  // touched upstream.
  const rowMotion = useRecordMotion(records, {
    watch: r => `${r.fields?.['Payment Status'] || ''}|${r.fields?.['Outstanding Amount'] || ''}|${r.fields?.['Amount'] || ''}`,
  })

  const agingBuckets = useMemo(() => Object.fromEntries(AGING_BAND_KEYS.map(band => [
    band, { count: agg?.aging?.[band]?.count || 0, amount: agg?.aging?.[band]?.amount || 0 },
  ])), [agg])
  const overdue = useMemo(() => ws?.overdue_top || [], [ws])
  // The alert reads client, category, follow-up… from full records; the
  // server sends those fields with each overdue entry.
  const overdueRecords = useMemo(() => overdue.map(inv => ({
    id: inv.id,
    fields: {
      'Invoice Number': inv.invoice_no, 'Client Name': inv.client, 'Category': inv.category,
      'Milestone': inv.milestone, 'Outstanding Amount': inv.outstanding,
      'Next followup': inv.followup, 'Raised Date': inv.raised_date,
    },
  })), [overdue])
  const activeConditions = activeRules(filterConditions)
  const hasFilters = statusFilter || projectFilter || clientFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0

  const clearAllFilters = clearAll
  const clearSearch = useCallback(() => {
    setSearchInput('')
    setFilters({ q: '' })
  }, [setFilters, setSearchInput])

  const activeFilterChips = useMemo(() => {
    const chips = []
    if (search) chips.push({ key: 'search', label: `Search: ${search}`, onClear: clearSearch })
    if (statusFilter) chips.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => setStatusFilter('') })
    if (projectFilter) chips.push({ key: 'project', label: `Project: ${projectFilter}`, onClear: () => setProjectFilter('') })
    if (clientFilter) chips.push({ key: 'client', label: `Client: ${clientFilter}`, onClear: () => setClientFilter('') })
    if (categoryFilter) chips.push({ key: 'category', label: `Category: ${categoryFilter}`, onClear: () => setCategoryFilter('') })
    if (raisedByFilter) chips.push({ key: 'raised_by', label: `Owner: ${raisedByFilter}`, onClear: () => setRaisedByFilter('') })
    if (billingFilter !== 'all') chips.push({ key: 'billing', label: `Billing: ${billingFilter === 'retainer' ? 'Retainers' : 'Projects'}`, onClear: () => setBillingFilter('all') })
    if (monthFilter) chips.push({ key: 'month', label: `Raised: ${monthLabel(monthFilter)}`, onClear: () => setMonthFilter('') })
    if (dateFrom || dateTo) chips.push({ key: 'date', label: `${dateFieldFilter}: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`, onClear: () => setFilters({ dateFrom: '', dateTo: '', dateField: 'Raised Date' }) })
    if (agingBandFilter) chips.push({ key: 'aging', label: `Aging: ${agingBandFilter}`, onClear: () => setAgingBandFilter('') })
    if (overdueOnly) chips.push({ key: 'overdue', label: 'Open collections', onClear: () => setOverdueOnly(false) })
    if (hasDocsOnly) chips.push({ key: 'docs', label: 'Has documents', onClear: () => setHasDocsOnly(false) })
    if (followupDueOnly) chips.push({ key: 'followup', label: 'Follow-up due', onClear: () => setFollowupDueOnly(false) })
    if (activeConditions.length) chips.push({ key: 'advanced', label: `${activeConditions.length} advanced rule${activeConditions.length !== 1 ? 's' : ''}`, onClear: () => setFilters({ conditions: [] }) })
    return chips
  }, [
    activeConditions.length,
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clearSearch,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    search,
    setAgingBandFilter, setBillingFilter, setCategoryFilter, setClientFilter, setFilters, setFollowupDueOnly,
    setHasDocsOnly, setMonthFilter, setOverdueOnly, setProjectFilter, setRaisedByFilter, setStatusFilter,
    statusFilter,
  ])

  // Project snapshot: the filtered scope's projects, each with its workspace
  // figure for the "of all" hint.
  const workspaceProjects = useMemo(
    () => new Map((ws?.by_project || []).map(p => [p.project, p])),
    [ws],
  )
  const projectSummaryCards = useMemo(
    () => (agg?.by_project || []).slice(0, 8).map(metrics => ({ project: metrics.project, metrics })),
    [agg],
  )
  const raisedTimeline = useMemo(() => (agg?.raised_months || []).slice(0, 6), [agg])
  const clearedTimeline = useMemo(() => (agg?.cleared_months || []).slice(0, 6), [agg])
  const lastThreeMonthBalance = useMemo(() => {
    const current = currentMonthKey()
    const keys = Array.from({ length: balanceMonths }, (_, i) => shiftMonthKey(current, -(balanceMonths - 1 - i)))
    // Workspace months (not the filtered scope) so this widget always shows
    // complete monthly totals regardless of any filter on the table view.
    const byMonth = new Map((ws?.raised_months || []).map(m => [m.key, m]))
    return keys.map((key, index) => {
      const m = byMonth.get(key) || {}
      const base = m.base || 0
      const gross = m.gross || 0
      const received = m.received || 0
      const previous = index > 0 ? keys[index - 1] : ''
      const previousGross = previous ? byMonth.get(previous)?.gross || 0 : 0
      const change = previous && previousGross
        ? ((gross - previousGross) / Math.abs(previousGross)) * 100
        : null
      const collectionRate = gross > 0 ? Math.min(100, Math.max(0, (received / gross) * 100)) : 0
      return {
        key, label: shortMonthLabel(key), base, gross, gst: m.gst || 0, received,
        deduction: m.deduction || 0, outstanding: m.outstanding || 0, invoiceCount: m.count || 0,
        collectionRate, change,
      }
    })
  }, [ws, balanceMonths])
  const maxMonthlyBalanceMagnitude = useMemo(
    () => Math.max(1, ...lastThreeMonthBalance.map((entry) => entry.gross)),
    [lastThreeMonthBalance]
  )
  // All-time project totals, whatever filter is active on the table.
  const recentProjectCards = useMemo(() => (ws?.recent_projects || []).map(p => ({
    project: p.project, base: p.base, gross: p.gross, gst: p.parts_gst, received: p.parts_received,
    deduction: p.deduction, outstanding: p.open, count: p.count, progress: p.progress,
  })), [ws])
  const followupsDueCount = agg?.followups_due || 0
  const missingDocsCount = agg?.missing_docs || 0
  const pendingCount = agg?.pending_count || 0
  const currentScopeOutstanding = agg?.open_amount || 0
  const applyMonthDrilldown = useCallback((field, key) => {
    setFilters({
      dateField: field,
      dateFrom: `${key}-01`,
      dateTo: endOfMonthIso(key),
      month: field === 'Raised Date' ? key : '',
    })
  }, [setFilters])
  const shareTitle = useMemo(() => {
    const parts = ['Invoices']
    if (projectFilter) parts.push(projectFilter)
    if (clientFilter) parts.push(clientFilter)
    if (statusFilter) parts.push(statusFilter)
    if (categoryFilter) parts.push(categoryFilter)
    if (!projectFilter && !clientFilter && !statusFilter && !categoryFilter) parts.push('Current View')
    return parts.join(' · ')
  }, [projectFilter, clientFilter, statusFilter, categoryFilter])

  const sharedViewConfig = useMemo(() => ({
    type: 'list',
    filterClient: clientFilter || '',
    filterProject: projectFilter || '',
    filterCategory: categoryFilter || '',
    filterStatus: statusFilter || '',
    raisedByFilter: raisedByFilter || '',
    billingFilter,
    monthFilter: monthFilter || '',
    dateFieldFilter,
    dateFrom: dateFrom || '',
    dateTo: dateTo || '',
    agingBandFilter: agingBandFilter || '',
    overdueOnly,
    hasDocsOnly,
    followupDueOnly,
    search: typeof search === 'string' ? search.trim() : '',
    // Advanced FilterBuilder rules narrow `records` too; a live link re-applies them server-side.
    filterConditions,
    columns: INVOICE_SHARE_COLUMNS,
    highlightColumns: ['Agening (Days)', 'Raised Date', 'Outstanding Amount'],
  }), [
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    filterConditions,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    search,
    statusFilter,
  ])

  async function createRetainerMonth(group, mode) {
    if (!group?.latestActive) {
      toast('No existing retainer template found for this project', 'warning')
      return
    }
    const isPause = mode === 'pause'
    const monthName = monthLabel(retainerMonth)
    const pauseReason = isPause
      ? window.prompt(`Why is ${group.project} paused for ${monthName}?`, '')
      : null
    if (isPause && pauseReason == null) return
    const key = `${mode}:${group.project}:${retainerMonth}`
    setRetainerActionBusy(key)
    try {
      const base = group.latestActive.fields || {}
      const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
        description: isPause
          ? `Retainer paused for ${monthName}`
          : `Recurring retainer invoice for ${monthName}. Update invoice number before sharing.`,
        milestone: base['Milestone'] || null,
        raised_by: base['Raised By'] || null,
        raised_date: firstDayIso(retainerMonth),
        // A pause carries no amount. The API rejects 0 (an invoice amount must
        // be positive) and both fields are optional, so leave them out.
        amount_raised: isPause ? undefined : Number(base['Amount Raised'] || 0),
        amount_with_tax: isPause ? undefined : Number(base['Amount with Tax'] || 0),
        amount_received: isPause ? 0 : undefined,
        payment_status: isPause ? 'Cancelled' : 'Pending',
        remark: isPause
          ? `Paused for ${monthName}. Reason: ${(pauseReason || 'Not specified').trim()}`
          : `Recurring retainer for ${monthName}. Invoice number to be updated.`,
      }
      await api.invoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
      loadRetainers()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
    setDrawer({
      mode: 'new',
      invoice: null,
      prefill: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
        description: `Retainer invoice recorded for ${label}`,
        milestone: base['Milestone'] || '',
        raised_by: base['Raised By'] || '',
        raised_date: `${monthKeyValue}-01`,
        cleared_date: '',
        amount_raised: base['Amount Raised'] ?? '',
        amount_with_tax: base['Amount with Tax'] ?? '',
        amount_received: '',
        payment_status: 'Pending',
        remark: `Invoice already raised via Zoho form for ${label}. Enter invoice number and final details here.`,
        next_followup: '',
      },
    })
  }

  /* ── Helpers ── */
  const openNew     = () => setDrawer({ mode: 'new',  invoice: null })
  const openView    = useCallback(r => setDrawer({ mode: 'view', invoice: r }), [])
  const openEdit    = useCallback(r => setDrawer({ mode: 'edit', invoice: r }), [])
  const openPreview = useCallback((docs, index) => setPreviewDocs({ docs, index }), [])

  // The server writes the CSV: every invoice in scope, not just the rows loaded
  // here. It also neutralises formula-looking text (=, +, -, @ …).
  async function exportCsv(useFiltered) {
    setShowExportMenu(false)
    setExporting(true)
    try {
      const params = useFiltered
        ? invoiceQueryParams(filters)
        : { sort: sortCol !== 'Raised Date' ? sortCol : undefined, order: sortDir !== 'desc' ? sortDir : undefined }
      const { blob, filename } = await api.invoices.exportCsv(params)
      downloadBlob(blob, filename || `invoices_${useFiltered ? 'filtered_' : ''}${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      toast(e.message || 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  // Open new drawer when navigated here with ?new=1 (works even if already on /invoices)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawer({ mode: 'new', invoice: null })
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps
  const openRecordPayment = useCallback(r => setDrawer({
    mode: 'payment',
    invoice: r,
    prefill: {
      payment_status: 'Paid',
      amount_received: r?.fields?.['Amount Raised'] ?? '',
      cleared_date: new Date().toISOString().slice(0, 10),
      reference: Array.isArray(r?.fields?.['Reference']) ? r.fields['Reference'] : [],
      remark: r?.fields?.['Remark'] || '',
    },
  }), [])
  const closeDrawer = () => setDrawer(null)
  const handleSaved = (savedRecord) => {
    patchRecord(savedRecord)
    refresh()
    if (workspace === 'retainers') loadRetainers()
    closeDrawer()
  }
  const handleDeleted = (deletedId) => {
    if (deletedId) removeRecord(deletedId)
    refresh()
    if (workspace === 'retainers') loadRetainers()
    closeDrawer()
  }
  // The overdue list carries ids; the row may not be among those loaded.
  const openInvoiceById = useCallback(async (id) => {
    const loaded = records.find(r => r.id === id)
    if (loaded) { openView(loaded); return }
    try {
      const rec = await api.invoices.get(id)
      if (rec?.id) openView(rec)
    } catch (e) {
      toast(e.message || 'Could not open that invoice', 'error')
    }
  }, [records, openView, toast])

  // Hovering a row: the detail opens after a short pause and closes after a
  // shorter one, so moving across rows does not flicker.
  const onRowEnter = useCallback((id) => {
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoveredRow(id), 250)
  }, [])
  const onRowLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoveredRow(null), 150)
  }, [])
  useEffect(() => () => clearTimeout(hoverTimerRef.current), [])

  useEffect(() => () => {
    if (resizeRef.current?.stop) resizeRef.current.stop()
  }, [])

  const startColumnResize = useCallback((key, event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key] || DEFAULT_INVOICE_COLUMN_WIDTHS[key] || 120
    const minWidth = key === 'project' ? 220 : key === 'actions' ? 120 : 90
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX))
      setColumnWidths((prev) => ({ ...prev, [key]: nextWidth }))
    }
    const stop = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      resizeRef.current = null
    }
    resizeRef.current = { stop }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
  }, [columnWidths])

  // Sorted on the server, over the whole scope.
  function handleSort(col) {
    if (sortCol === col) setFilters({ order: sortDir === 'asc' ? 'desc' : 'asc' })
    else setFilters({ sort: col, order: 'desc' })
  }

  // Persist the column choice so it survives a reload. Storage being
  // unavailable (private mode, quota) must not break the table.
  useEffect(() => {
    try {
      localStorage.setItem(INVOICE_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility))
    } catch { /* non-fatal — the choice just won't outlive this session */ }
  }, [columnVisibility])

  const visibleColumnCount = INVOICE_COLUMNS.filter(c => columnVisibility[c.key]).length

  // Totals for the money columns across the whole filtered view — every record
  // the current filters produced, not just the 50 on screen. A total that only
  // covered the visible page would silently change as you paged.
  //
  // Outstanding is clamped at zero per row to match its cell, which renders an
  // em dash for anything not positive; the column total therefore equals the sum
  // of the figures actually shown. Amounts are summed as rendered, i.e. in INR —
  // this table formats every row through formatInr regardless of the record's
  // Currency field, so the total inherits that same assumption.
  // The server adds these up over the whole scope, loaded or not.
  const columnTotals = useMemo(() => ({
    amountRaised:   agg?.totals?.amount_raised   || 0,
    amountReceived: agg?.totals?.amount_received || 0,
    amountWithTax:  agg?.totals?.amount_with_tax || 0,
    outstanding:    agg?.totals?.outstanding     || 0,
    outstandingRaw: agg?.totals?.outstanding_raw || 0,
  }), [agg])

  function toggleColumn(key) {
    const col = INVOICE_COLUMNS.find(c => c.key === key)
    if (!col || col.locked) return
    setColumnVisibility(v => ({ ...v, [key]: !v[key] }))
  }

  // Width of the visible columns only, so hiding columns actually reclaims
  // horizontal space instead of leaving the table stretched to its old size.
  const visibleTableMinWidth = INVOICE_COLUMNS
    .filter(c => columnVisibility[c.key])
    .reduce((sum, c) => sum + (columnWidths[c.key] || DEFAULT_INVOICE_COLUMN_WIDTHS[c.key] || 120), 0)

  // Nothing matches: offer the way out instead of a dead end.
  const statusLikeOnly = !projectFilter && !clientFilter && !categoryFilter && !raisedByFilter && billingFilter === 'all'
    && !monthFilter && !dateFrom && !dateTo && !hasDocsOnly && activeConditions.length === 0
  const otherFilters = hasFilters && (statusFilter || overdueOnly || agingBandFilter || followupDueOnly || !statusLikeOnly)
  const emptyState = hasFilters ? (
    <EmptyState
      icon={<Search size={22} />}
      title="No invoices match"
      subtitle={search
        ? `Nothing matches “${search}” with the current filters.`
        : 'Nothing matches the current filters.'}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={clearAllFilters} className="btn-primary"><X size={13} />{otherFilters || !search ? 'Clear filters' : 'Clear search'}</button>
          {search && otherFilters && (
            <button
              onClick={() => setFilters(statusLikeOnly
                ? { status: '', overdue: false, aging: '', followupDue: false }
                : Object.fromEntries(['status', 'project', 'client', 'category', 'raisedBy', 'month', 'aging', 'dateFrom', 'dateTo', 'conditions']
                    .map(k => [k, k === 'conditions' ? [] : '']).concat([['billing', 'all'], ['overdue', false], ['hasDocs', false], ['followupDue', false]])))}
              className="btn-ghost"
            >
              <Search size={13} />{statusLikeOnly ? 'Search all statuses' : 'Search all invoices'}
            </button>
          )}
        </div>
      }
      compact
    />
  ) : (
    <EmptyState
      icon={<Receipt size={22} />}
      title="No invoices found"
      subtitle="Create your first invoice to get started."
      action={canCreate && <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
      compact
    />
  )

  // Show more: the next page of this scope. A button, not infinite scroll, so
  // the totals row and the drawers below stay reachable and the count is clear.
  const showMore = (
    <div className="invoice-show-more" aria-live="polite">
      <span>Showing {records.length.toLocaleString('en-IN')} of {scopeTotal.toLocaleString('en-IN')}</span>
      {nextCursor && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost"
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
          {loadingMore ? <RefreshCw size={12} className="animate-spin" /> : <ChevronDown size={12} />}
          {loadingMore ? 'Loading…' : `Show ${Math.min(50, scopeTotal - records.length)} more`}
        </button>
      )}
    </div>
  )

  // Inline sort-label used inside <th className="tbl-head">.
  // Labelled via aria-label rather than title: a native tooltip here renders on
  // top of the first data rows and hides the very values being sorted. The sort
  // direction is already conveyed visually by the arrow rotation and accent colour.
  function SortLabel({ col, children }) {
    const active = sortCol === col
    const asc    = sortDir === 'asc'
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center gap-1 cursor-pointer select-none section-title whitespace-nowrap group/sort"
        aria-label={active ? (asc ? 'Sorted ascending — click for descending' : 'Sorted descending — click for ascending') : `Sort by ${col}`}
        style={{ color: active ? 'var(--accent)' : 'var(--text-3)', background: 'none', border: 'none', padding: 0 }}>
        {children}
        <ArrowUpDown size={10} style={{
          opacity: active ? 1 : 0.3,
          color: active ? 'var(--accent)' : undefined,
          transform: active && asc ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }} className="group-hover/sort:opacity-80" />
      </button>
    )
  }

  return (
    <ExecutiveShell className="invoice-workspace">

      <ExecutiveHero
        eyebrow="Receivables Command Deck"
        title="Invoices"
        description="Operate collections, aging, retainer billing, and project context from a denser finance workspace."
        icon={Receipt}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ExecutiveChip accent>{allCount} live invoice{allCount !== 1 ? 's' : ''}</ExecutiveChip>
            <ExecutiveChip>{syncing ? 'syncing…' : 'mirror-fast · Teable-backed'}</ExecutiveChip>
            {hasFilters && <ExecutiveChip>{scopeTotal} in current scope</ExecutiveChip>}
          </div>
        }
        actions={
          <>
            {isEditor && workspace === 'invoices' && (
              <>
                <button onClick={() => setShareModal(true)} className="btn-ghost"><ExternalLink size={14} />Share View</button>
                <button onClick={() => setManageModal(true)} className="btn-ghost"><Eye size={14} />Links</button>
              </>
            )}
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} />Raise Externally
            </button>
            <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-ghost">
              <RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />Refresh
            </button>
            <div className="relative">
              <button onClick={() => setShowExportMenu(m => !m)} disabled={exporting} className="btn-ghost" title="Download invoices as CSV">
                <Download size={14} />{exporting ? 'Exporting…' : 'Export CSV'}<ChevronDown size={11} />
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg border py-1 min-w-[190px]"
                    style={{ background: 'var(--surface-1)', borderColor: 'var(--border-soft)' }}>
                    <button onClick={() => exportCsv(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                      <Download size={13} />Filtered ({scopeTotal})
                    </button>
                    <button onClick={() => exportCsv(false)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                      <Download size={13} />All records ({allCount})
                    </button>
                  </div>
                </>
              )}
            </div>
            {canCreate && (
              <button onClick={openNew} className="btn-primary"><Plus size={14} />New Invoice</button>
            )}
          </>
        }
      >
        {/* The cards follow the search and filters; while either narrows the
            view, a quiet line under each gives the workspace figure. */}
        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard label="Total raised" value={!agg ? '—' : <LiveValue value={agg.raised} format={fmt} />} icon={IndianRupee}>
            {hasFilters && ws && <p className="invoice-kpi-of-all">of {fmt(ws.raised)} across all {allCount}</p>}
          </ExecutiveStatCard>
          <ExecutiveStatCard label="Incl. GST" value={!agg ? '—' : <LiveValue value={agg.with_tax} format={fmt} />} icon={Receipt}>
            {hasFilters && ws && <p className="invoice-kpi-of-all">of {fmt(ws.with_tax)} across all {allCount}</p>}
          </ExecutiveStatCard>
          <ExecutiveStatCard label="Collected" value={!agg ? '—' : <LiveValue value={agg.collected} format={fmt} />} sub={agg ? `${agg.paid_count || 0} paid invoices` : ''} accent="positive" icon={TrendingUp}>
            {hasFilters && ws && <p className="invoice-kpi-of-all">of {fmt(ws.collected)} across all {allCount}</p>}
          </ExecutiveStatCard>
          <ExecutiveStatCard label="Outstanding" value={!agg ? '—' : <LiveValue value={agg.outstanding} format={fmt} />} sub={`${agg?.pending_count || 0} pending invoices`} accent={(agg?.outstanding || 0) > 0 ? 'warning' : 'positive'} icon={CalendarClock}>
            {hasFilters && ws && <p className="invoice-kpi-of-all">of {fmt(ws.outstanding)} across all {allCount}</p>}
          </ExecutiveStatCard>
          <ExecutiveStatCard
            label={<span className="inline-flex items-center gap-1.5">Collection rate <LiveDot changeCount={workspaceChanges} loading={!agg} size={5} /></span>}
            value={agg ? <LiveValue value={agg.collection_rate ?? 0} format={v => `${v.toFixed(1)}%`} /> : '—'}
            sub={agg ? `${agg.active_count || 0} active invoices in scope` : ''}
            accent={(agg?.collection_rate || 0) >= 90 ? 'positive' : (agg?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
            icon={Percent}
          >
            {hasFilters && ws && <p className="invoice-kpi-of-all">{(ws.collection_rate ?? 0).toFixed(1)}% across all {allCount}</p>}
          </ExecutiveStatCard>
        </ExecutiveStatGrid>
      </ExecutiveHero>

      {/* ── Search and filters: one compact bar that stays in view ── */}
      {workspace === 'invoices' && (
        <div ref={filterBarRef} className="invoice-sticky-filters" role="search" aria-label="Search and filter invoices">
          <ExecutiveFilterBar className="executive-filter-bar-toolbar">
            <div className="executive-search relative flex-1 min-w-[140px] sm:min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <input value={searchInput} onChange={e => onSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitSearch()
                    scrollToResults()
                  }
                }}
                aria-label="Search invoices"
                placeholder="Search invoice #, client, project, remark…"
                className="input pl-8 py-1.5 text-xs"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-1)' }} />
            </div>
            <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
              className={clsx('btn-icon flex items-center justify-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
              style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
              <Filter size={13} />
              <span className="text-xs">Filters</span>
              {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
            </button>
            {hasFilters && (
              <button onClick={clearAllFilters}
                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                <X size={11} />Clear
              </button>
            )}
            <span aria-live="polite" className="inline-flex items-center">
              <ExecutiveChip accent>
                {!hasData ? 'Loading…' : `${scopeTotal.toLocaleString('en-IN')} result${scopeTotal !== 1 ? 's' : ''}`}
                {syncing && hasData && <RefreshCw size={10} className="animate-spin" aria-hidden="true" />}
              </ExecutiveChip>
            </span>
          </ExecutiveFilterBar>

          {activeFilterChips.length > 0 && (
            <div className="invoice-active-filters" aria-label="Active invoice filters">
              {activeFilterChips.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onClear}
                  className="invoice-filter-chip"
                  title={`Remove ${chip.label}`}
                >
                  <span>{chip.label}</span>
                  <X size={11} />
                </button>
              ))}
            </div>
          )}

          {showFilters && (
            <div className="filter-expanded-panel flex flex-wrap gap-2 animate-slide-down">
              {/* Billing type */}
              <div className="inline-flex items-center p-0.5 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                {[['all','All'],['project','Projects'],['retainer','Retainers']].map(([v, l]) => (
                  <button key={v} onClick={() => setBillingFilter(v)}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={billingFilter === v
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    {l}
                  </button>
                ))}
              </div>
              <FilterSelect
                value={clientFilter}
                onChange={setClientFilter}
                options={clientNameOptions}
                placeholder="All clients"
                icon={User}
                width={150}
              />
              <FilterSelect
                value={projectFilter}
                onChange={setProjectFilter}
                options={projectOptions}
                placeholder="All projects"
                icon={User}
                width={150}
              />
              <FilterSelect
                value={monthFilter}
                onChange={setMonthFilter}
                options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
                placeholder="All months"
                icon={CalendarDays}
                width={150}
              />
              <FilterSelect
                value={dateFieldFilter}
                onChange={setDateFieldFilter}
                options={[
                  { value: 'Raised Date', label: 'Raised Date' },
                  { value: 'Cleared Date', label: 'Cleared Date' },
                  { value: 'Next followup', label: 'Next Follow-up' },
                ]}
                placeholder="Date field"
                icon={CalendarDays}
                width={160}
                clearable={false}
              />
              <div className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
                <input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
              </div>
              <FilterSelect
                value={agingBandFilter}
                onChange={setAgingBandFilter}
                options={AGING_BAND_KEYS.map(bucket => ({ value: bucket, label: bucket }))}
                placeholder="All aging"
                icon={CalendarClock}
                width={135}
              />
              <FilterSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categoryOptions}
                placeholder="All categories"
                icon={Tag}
                width={155}
              />
              <FilterSelect
                value={raisedByFilter}
                onChange={setRaisedByFilter}
                options={raisedByOptions}
                placeholder="Anyone"
                icon={User}
                width={135}
              />
              <button
                onClick={() => setOverdueOnly(v => !v)}
                className="btn-ghost"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.375rem 0.625rem',
                  color: overdueOnly ? 'var(--fin-negative)' : 'var(--text-2)',
                  borderColor: overdueOnly ? 'var(--fin-neg-border)' : 'var(--card-border)',
                  background: overdueOnly ? 'var(--fin-neg-bg)' : 'var(--card-bg)',
                }}>
                Pending / Outstanding
              </button>
              <button
                onClick={() => setFollowupDueOnly(v => !v)}
                className="btn-ghost"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.375rem 0.625rem',
                  color: followupDueOnly ? 'var(--fin-warning)' : 'var(--text-2)',
                  borderColor: followupDueOnly ? 'var(--fin-warn-border)' : 'var(--card-border)',
                  background: followupDueOnly ? 'var(--fin-warn-bg)' : 'var(--card-bg)',
                }}>
                Follow-up due
              </button>
              <button
                onClick={() => setHasDocsOnly(v => !v)}
                className="btn-ghost"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.375rem 0.625rem',
                  color: hasDocsOnly ? 'var(--accent)' : 'var(--text-2)',
                  borderColor: hasDocsOnly ? 'var(--accent-soft)' : 'var(--card-border)',
                  background: hasDocsOnly ? 'var(--accent-dim)' : 'var(--card-bg)',
                }}>
                Has docs
              </button>
              {/* Divider */}
              <div className="w-full" style={{ borderTop: '1px solid var(--glass-border)', margin: '0.25rem 0' }} />
              {/* Advanced filter builder — applied on the server */}
              <div className="w-full">
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                  Advanced filters
                </p>
                <FilterBuilder
                  fields={INVOICE_FIELDS}
                  records={records}
                  getFieldValue={r => r.fields ?? {}}
                  conditions={filterConditions}
                  onChange={setFilterConditions}
                  label="Add condition"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Invoice activity chart ── */}
      {allCount > 0 && (() => {
        const activePreset = CHART_PRESETS.find(p => p.key === chartPreset) || CHART_PRESETS[1]
        const chartFromProp = chartPreset === 'custom' ? chartFrom : undefined
        const chartToProp   = chartPreset === 'custom' ? chartTo   : undefined
        const chartDaysProp = chartPreset === 'custom' ? 60 : (activePreset.days || 60)
        const labelText = chartPreset === 'custom' && chartFrom
          ? `${chartFrom}${chartTo ? ' → ' + chartTo : ''}`
          : `last ${activePreset.label}`
        return (
          <div className="card overflow-hidden" style={{ padding: 0 }}>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
                  Invoice activity · {labelText}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Cumulative billing · bar height = amount ·&nbsp;
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--fin-positive)' }} />paid&nbsp;
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--fin-negative)' }} />overdue&nbsp;
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--text-3)' }} />pending
                  </span>
                </p>
              </div>
              {/* ── Date range controls ── */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Preset chips */}
                <div className="inline-flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  {CHART_PRESETS.map(p => (
                    <button key={p.key}
                      onClick={() => setChartPreset(p.key)}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                      style={chartPreset === p.key
                        ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                        : { color: 'var(--text-3)' }}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {/* Custom date inputs */}
                {chartPreset === 'custom' && (
                  <div className="flex items-center gap-1.5">
                    <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
                      className="text-[11px] px-2 py-1 rounded-md"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none' }} />
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>→</span>
                    <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)}
                      className="text-[11px] px-2 py-1 rounded-md"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none' }} />
                  </div>
                )}
              </div>
            </div>
            <InvoiceActivityChart
              records={chartData.records}
              baseline={chartData.baseline}
              days={chartDaysProp}
              from={chartFromProp}
              to={chartToProp}
              className="px-2 pb-1"
              avatarMap={avatarMap}
              onInvoiceClick={id => {
                const rec = chartData.records.find(r => r.id === id)
                if (rec) setDrawer({ mode: 'view', invoice: rec })
              }}
            />
          </div>
        )
      })()}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_340px] gap-4">
        <ExecutivePanel
          title="Workspace controls"
          subtitle="Switch billing mode, tighten the scope, and keep the current receivables picture focused on real collections work."
        >
          <ExecutiveFilterBar className="mb-3">
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[['invoices', 'Invoices'], ['retainers', 'Retainers']].map(([value, label]) => (
                <button key={value} onClick={() => setWorkspace(value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={workspace === value
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setFilters({ followupDue: true, overdue: false, aging: '' })
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: followupDueOnly ? 'var(--accent)' : undefined }}
            >
              <CalendarDays size={12} />Follow-ups due
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setFilters({ overdue: true, followupDue: false, aging: '31-60d' })
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: overdueOnly || agingBandFilter ? 'var(--accent)' : undefined }}
            >
              <AlertTriangle size={12} />Collections pressure
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setHasDocsOnly(true)
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: hasDocsOnly ? 'var(--accent)' : undefined }}
            >
              <FileText size={12} />Docs attached
            </button>
          </ExecutiveFilterBar>
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="label">Open in scope</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(currentScopeOutstanding)}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{pendingCount} pending invoices currently visible</p>
              </div>
              <div>
                <p className="label">Follow-up load</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: followupsDueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{followupsDueCount}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Due today or already overdue</p>
              </div>
              <div>
                <p className="label">Missing proof/docs</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: missingDocsCount ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{missingDocsCount}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Invoices without PDF or payment reference</p>
              </div>
            </div>
          </div>
        </ExecutivePanel>

        <ExecutivePanel title="Aging buckets" subtitle="Pending invoice exposure by age — click to filter.">
          <div className="space-y-2">
            {Object.entries(agingBuckets).map(([label, { count, amount }]) => {
              const active = agingBandFilter === label
              const isWarning = label === '31-60d'
              const isDanger  = label === '60d+'
              const accentColor = active
                ? 'var(--accent)'
                : isDanger  ? 'var(--fin-negative)'
                : isWarning ? 'var(--fin-warning)'
                : 'var(--text-2)'
              const bg = active
                ? 'var(--accent-dim)'
                : isDanger  ? 'color-mix(in srgb, var(--fin-negative) 6%, transparent)'
                : isWarning ? 'color-mix(in srgb, var(--fin-warning) 6%, transparent)'
                : 'var(--bg-input)'
              const border = active
                ? 'var(--accent)'
                : isDanger  ? 'color-mix(in srgb, var(--fin-negative) 20%, transparent)'
                : isWarning ? 'color-mix(in srgb, var(--fin-warning) 20%, transparent)'
                : 'var(--card-border)'
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAgingBandFilter(active ? '' : label)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                  style={{ background: bg, border: `1px solid ${border}` }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold" style={{ color: accentColor }}>{label}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {count === 0 ? 'No pending invoices' : `${count} invoice${count !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold tabular-nums" style={{ color: count === 0 ? 'var(--text-3)' : accentColor }}>
                      {count === 0 ? '—' : fmt(amount)}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExecutivePanel
          title="Raised by month"
          subtitle="Click a month to drill the workspace into invoices raised in that exact month-year."
          action={<ExecutiveChip accent>{raisedTimeline.length} month{raisedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {raisedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No raised-date distribution is available in the current scope.
              </div>
            ) : raisedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Raised Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} raised invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>

        <ExecutivePanel
          title="Cleared by month"
          subtitle="Click a month to isolate invoices cleared in that month-year and inspect actual collections."
          action={<ExecutiveChip accent>{clearedTimeline.length} month{clearedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {clearedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No cleared-date distribution is available in the current scope.
              </div>
            ) : clearedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Cleared Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} cleared invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>
      </div>

      {workspace === 'invoices' && (
        <div className="invoice-runey-widgets">
          <section className="invoice-runey-card invoice-month-balance-card" aria-label="Last N months invoice balance">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div>
                <h2>Last {balanceMonths} Month{balanceMonths !== 1 ? 's' : ''}</h2>
                <p>GST-aware receivables</p>
              </div>
              <div className="inline-flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', alignSelf: 'flex-start', flexShrink: 0 }}>
                {[3, 6, 12].map(n => (
                  <button key={n} type="button"
                    onClick={() => setBalanceMonths(n)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={balanceMonths === n
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    {n} mo
                  </button>
                ))}
              </div>
            </div>
            <div className="invoice-month-bars">
              {lastThreeMonthBalance.map((entry) => {
                const height = Math.max(12, Math.round((entry.gross / maxMonthlyBalanceMagnitude) * 112))
                const isSettled = entry.outstanding <= 0 && entry.gross > 0
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="invoice-month-bar-item"
                    onClick={() => applyMonthDrilldown('Raised Date', entry.key)}
                    title={`Filter raised invoices for ${monthLabel(entry.key)}`}
                  >
                    <span className="invoice-month-bar-wrap" aria-hidden="true">
                      <span
                        className={clsx('invoice-month-bar', isSettled ? 'is-positive' : 'is-negative')}
                        style={{
                          height: `${height}px`,
                          width: entry.invoiceCount > 1 ? '4.8rem' : '3.6rem',
                        }}
                      />
                    </span>
                    <span className="invoice-month-label">{entry.label}</span>
                    <strong className="invoice-month-value">{entry.gross === 0 ? '-' : fmt(entry.gross)}</strong>
                    <small className="invoice-month-subvalue">
                      {entry.received > 0 ? `${fmt(entry.received)} received` : `${fmt(entry.base)} raised`}
                    </small>
                    <span className="invoice-month-mini-grid">
                      <span>GST {fmt(entry.gst)}</span>
                      <span>Open {fmt(entry.outstanding)}</span>
                      <span>TDS {fmt(entry.deduction)}</span>
                    </span>
                    <em className={clsx('invoice-month-change', entry.change == null ? 'is-neutral' : entry.change >= 0 ? 'is-up' : 'is-down')}>
                      {entry.change == null ? `${entry.collectionRate.toFixed(0)}% collected` : `${entry.change >= 0 ? 'up' : 'down'} ${Math.abs(entry.change).toFixed(0)}%`}
                    </em>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="invoice-runey-card invoice-recent-projects-card" aria-label="Recent invoice projects">
            <div className="invoice-runey-card-head">
              <div>
                <h2>Recent Projects</h2>
                <p>Active invoice pressure</p>
              </div>
              {projectFilter && (
                <button
                  type="button"
                  onClick={() => setProjectFilter('')}
                >
                  View all -&gt;
                </button>
              )}
            </div>
            <div className="invoice-recent-project-list">
              {recentProjectCards.length === 0 ? (
                <p className="invoice-runey-empty">No project invoice movement in this scope.</p>
              ) : recentProjectCards.map((entry) => {
                const active = projectFilter === entry.project
                return (
                  <button
                    key={entry.project}
                    type="button"
                    className={clsx('invoice-recent-project-row', active && 'is-active')}
                    onClick={() => {
                      setProjectFilter(active ? '' : entry.project)
                    }}
                  >
                    <span className="invoice-project-avatar">{projectInitials(entry.project)}</span>
                    <span className="invoice-project-meta">
                      <strong>{entry.project}</strong>
                      <small>{entry.count} invoice{entry.count === 1 ? '' : 's'} | {fmt(entry.outstanding)} open | {fmt(entry.deduction)} TDS</small>
                    </span>
                    <span className="invoice-project-progress" aria-hidden="true">
                      <span style={{ width: `${entry.progress}%` }} />
                    </span>
                    <span className="invoice-project-amount">{fmt(entry.gross)}</span>
                    <span className="invoice-project-percent">{entry.progress}%</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {/* ── Status chips — click to filter, shows count + total amount ── */}
      {ws?.by_status && Object.keys(ws.by_status).length > 0 && (
        <section className="status-card-grid">
          {Object.entries(ws.by_status).map(([status, { count, amount }]) => {
            const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
            const Icon = m.icon
            const active = statusFilter === status
            return (
              <button key={status}
                onClick={() => {
                  setStatusFilter(active ? '' : status)
                }}
                className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                style={{
                  borderColor: active ? m.color : 'var(--card-border)',
                  background: active ? `${tint(m.color, 0.06)}` : 'var(--card-bg)',
                  boxShadow: active ? `0 0 0 2px ${tint(m.color, 0.19)}, var(--card-shadow)` : 'var(--card-shadow)',
                }}
                aria-pressed={active}>
                {/* Icon tile */}
                <div className="kpi-icon flex-shrink-0"
                  style={{ background: `${tint(m.color, 0.09)}` }}>
                  {Icon && <Icon size={18} style={{ color: m.color }} />}
                </div>
                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                  <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                  {amount != null && (
                    <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>
                      {fmt(amount)}
                    </p>
                  )}
                </div>
                {/* Active indicator */}
                {active && (
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                )}
              </button>
            )
          })}
        </section>
      )}

      {/* ── Overdue alert ── */}
      {overdue.length > 0 && <OverdueAlert overdue={overdue} allRecords={overdueRecords} onViewAll={() => setOverdueOnly(true)} onOpenInvoice={(invNo) => { const hit = overdue.find(inv => inv.invoice_no === invNo); if (hit) openInvoiceById(hit.id) }} />}

      {/* ── Retainer Workspace ── */}
      {workspace === 'retainers' && (
        <section className="card space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                {' '}
                <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once raised, store the final invoice number and details here.
              </p>
            </div>
            <div className="relative">
              <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
              <select value={retainerMonth} onChange={e => setRetainerMonth(e.target.value)}
                className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 170, paddingRight: '1.5rem' }}>
                {retainerMonthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            </div>
          </div>

          {retainerGroups.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No retainer templates found</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Create a normal invoice and set the category to a retainer category first.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-4">
              <div className="space-y-3">
                {retainerGroups.map(group => (
                  <button key={group.project} type="button"
                    onClick={() => setSelectedRetainer(group.project)}
                    className="w-full text-left rounded-xl p-4 transition-all"
                    style={{
                      background: selectedRetainer === group.project ? 'var(--accent-dim)' : 'var(--bg-layer)',
                      border: `1px solid ${selectedRetainer === group.project ? 'var(--accent)' : 'var(--card-border)'}`,
                      boxShadow: selectedRetainer === group.project ? '0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent)' : 'none',
                    }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {fmt(group.amount)} template · next due {monthLabel(group.nextDueMonth)}
                        </p>
                      </div>
                      <MonthStatusPill status={group.monthStatus} active={selectedRetainer === group.project} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div>
                        <p className="label">Current month</p>
                        <p className="text-xs font-medium" style={{ color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)' }}>
                          {group.currentMonthRaised ? 'Raised / planned' : 'Missing'}
                        </p>
                      </div>
                      <div>
                        <p className="label">Raised by</p>
                        <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {selectedRetainerGroup && (() => {
                const group = selectedRetainerGroup
                const monthRec = group.monthRecord?.fields || null
                const missing = !monthRec
                const busyPause = retainerActionBusy === `pause:${group.project}:${retainerMonth}`
                return (
                  <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                          Template amount {fmt(group.amount)}{group.withTax ? ` · GST total ${fmt(group.withTax)}` : ''} · Next due {monthLabel(group.nextDueMonth)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <MonthStatusPill status={group.monthStatus} active />
                        <span className="text-xs px-2 py-1 rounded-full"
                          style={{
                            background: group.currentMonthRaised ? 'var(--fin-pos-bg)' : 'var(--fin-warn-bg)',
                            color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)',
                            border: `1px solid ${group.currentMonthRaised ? 'var(--fin-pos-border)' : 'var(--fin-warn-border)'}`,
                          }}>
                          {group.currentMonthRaised ? 'Current month covered' : 'Current month not raised'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        ['Tracking month', monthLabel(retainerMonth)],
                        ['Month invoice #', monthRec?.['Invoice Number'] || 'Pending update'],
                        ['Raised by', group.raisedBy || '—'],
                        ['Month remark', monthRec?.['Remark'] || '—'],
                      ].map(([lbl, val]) => (
                        <div key={lbl} className="card p-3">
                          <p className="label">{lbl}</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{val}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="label mb-2">Month Timeline</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                        {group.timeline.map(item => (
                          <button key={item.key} type="button"
                            onClick={() => setRetainerMonth(item.key)}
                            className="min-w-0 rounded-xl p-3 text-left transition-all min-h-[72px]"
                            style={{
                              background: item.current ? 'var(--accent-dim)' : 'var(--bg-base)',
                              border: `1px solid ${item.active ? 'var(--accent)' : 'var(--card-border)'}`,
                              boxShadow: item.active ? '0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                            }}>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <p className="text-[11px] font-semibold" style={{ color: item.current ? 'var(--accent)' : 'var(--text-2)' }}>
                                {item.label}
                              </p>
                              {item.current && <span className="text-[9px] font-bold" style={{ color: 'var(--accent)' }}>NOW</span>}
                            </div>
                            <MonthStatusPill status={item.status} active={item.active} />
                            <p className="text-[10px] mt-2 truncate" style={{ color: 'var(--text-3)' }}>
                              {item.record?.fields?.['Invoice Number'] || 'No record'}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="label mb-2">Monthly Records</p>
                      <div className="space-y-2">
                        {group.timeline.map(item => {
                          const rec = item.record
                          const f = rec?.fields || {}
                          const key = `${item.key}-${group.project}`
                          return (
                            <div key={key} className="rounded-xl p-3 flex items-center justify-between gap-3"
                              style={{
                                background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                              }}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                  <MonthStatusPill status={item.status} active={item.active} />
                                </div>
                                <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                  {rec
                                    ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                    : 'No record created for this month yet'}
                                </p>
                              </div>
                              <div className="flex gap-2 flex-shrink-0 flex-wrap">
                                {rec ? (
                                  <button onClick={() => openView(rec)}
                                    className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                    View
                                  </button>
                                ) : item.key === retainerMonth ? (
                                  <>
                                    <button onClick={() => openInvoiceRequestForm(group, item.key)}
                                      className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      Open request form
                                    </button>
                                    <button onClick={() => openRetainerRecordForm(group, item.key)}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      Record raised invoice
                                    </button>
                                    <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                                      {busyPause ? 'Pausing…' : 'Pause month'}
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => setRetainerMonth(item.key)}
                                    className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                    Track month
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {group.description && (
                      <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)', border: '1px solid var(--card-border)' }}>
                        <p className="label">Template Note</p>
                        <p className="text-sm" style={{ color: 'var(--text-2)' }}>{group.description}</p>
                      </div>
                    )}

                    {missing && (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                          className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                          Open invoice request form
                        </button>
                        <button onClick={() => openRetainerRecordForm(group, retainerMonth)}
                          className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                          Record already raised invoice
                        </button>
                        <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                          className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                          {busyPause ? 'Pausing…' : 'Pause month'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </section>
      )}

      {workspace === 'invoices' && (
      <>
      {/* ── Project Snapshot ── */}
      {projectSummaryCards.length > 0 && (
        <ExecutivePanel title="Project billing" subtitle="Project cards behave as filters and surface raised, received, and open value at a glance.">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Click any project card to filter the invoice list.</p>
            </div>
            {projectFilter && (
              <button onClick={() => setProjectFilter('')}
                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                <X size={11} />Clear project filter
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {projectSummaryCards.map(({ project, metrics }) => {
              const active = projectFilter === project
              return (
                <button key={project} type="button"
                  onClick={() => setProjectFilter(active ? '' : project)}
                  className="rounded-xl p-4 text-left transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: active ? '0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--shadow-sm)',
                  }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                    </div>
                    {active && <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 mt-4">
                    <div>
                      <p className="label">Raised</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(metrics.raised)}</p>
                    </div>
                    <div>
                      <p className="label">Received</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(metrics.received)}</p>
                    </div>
                    <div>
                      <p className="label">Open</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(metrics.outstanding)}</p>
                    </div>
                  </div>
                  {hasFilters && workspaceProjects.get(project) && (
                    <p className="invoice-kpi-of-all mt-2">
                      of {fmt(workspaceProjects.get(project).raised)} raised across all {workspaceProjects.get(project).count}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      )}

      {/* ── Current scope: what the search and filters match, all of it ── */}
      <section ref={resultsRef} className="executive-panel invoice-results-anchor" aria-label="Current invoice scope">
        <div className="invoice-scope-strip">
          <div>
            <span>Scope</span>
            <strong>{scopeTotal.toLocaleString('en-IN')}</strong>
            <small>of {allCount.toLocaleString('en-IN')} invoices</small>
          </div>
          <div>
            <span>Open</span>
            <strong style={{ color: currentScopeOutstanding ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmt(currentScopeOutstanding)}</strong>
            <small>{pendingCount} pending</small>
          </div>
          <div>
            <span>Due follow-up</span>
            <strong style={{ color: followupsDueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{followupsDueCount}</strong>
            <small>today or overdue</small>
          </div>
          <div>
            <span>Missing docs</span>
            <strong style={{ color: missingDocsCount ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{missingDocsCount}</strong>
            <small>needs proof</small>
          </div>
        </div>
      </section>

      {/* ── Error ── */}
      {(errorStatus === 403 || errorStatus === 401) ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl text-center"
          style={{ background: 'color-mix(in srgb, var(--fin-negative) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 15%, transparent)' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'color-mix(in srgb, var(--fin-negative) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={22} style={{ color: 'var(--fin-negative)' }} />
          </div>
          <div>
            <div className="font-semibold text-sm mb-1" style={{ color: 'var(--fin-negative)' }}>Access Restricted</div>
            <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
              You don't have permission to view invoices.<br />
              Please contact your administrator to request access.
            </div>
            <button onClick={refresh} className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--fin-negative) 15%, transparent)', color: 'var(--fin-negative)', border: 'none', cursor: 'pointer', transition: 'background-color 150ms' }}
              onMouseEnter={e => e.target.style.background = 'color-mix(in srgb, var(--fin-negative) 22%, transparent)'}
              onMouseLeave={e => e.target.style.background = 'color-mix(in srgb, var(--fin-negative) 15%, transparent)'}>
              Refresh
            </button>
          </div>
        </div>
      ) : error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
          style={{ background: 'color-mix(in srgb, var(--fin-negative) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 18%, transparent)', color: 'var(--fin-negative)' }}>
          <AlertTriangle size={13} className="shrink-0" />
          {error}
          {/not found/i.test(error) && <span style={{ color: 'var(--text-3)' }}>— backend is deploying, auto-retrying</span>}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── Mobile card list (sm-down) ── */}
      <div className="invoice-mobile-stack md:hidden">
        {/* Same view totals as the desktop tfoot. The mobile stack has no table
            to hang a footer off, so they lead the list instead — otherwise a
            phone user would have to scroll the entire view to add anything up. */}
        {hasData && records.length > 0 && (
          <div className="card" style={{ padding: '0.85rem 1rem' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                View total
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                {scopeTotal.toLocaleString('en-IN')} {scopeTotal === 1 ? 'invoice' : 'invoices'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {[
                { label: 'Amount',    value: columnTotals.amountRaised,   color: 'var(--text-1)' },
                { label: 'GST Total', value: columnTotals.amountWithTax,  color: 'var(--text-2)' },
                { label: 'Received',  value: columnTotals.amountReceived, color: 'var(--fin-positive)' },
                { label: 'Outstanding', value: columnTotals.outstanding,  color: 'var(--fin-warning)' },
              ].map(({ label, value, color }) => (
                <div key={label} className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color }}>{fmt(value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {!hasData
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="skeleton h-3 w-2/5 mb-3 rounded" />
                <div className="skeleton h-5 w-3/5 rounded" />
              </div>
            ))
          : records.length === 0
            ? emptyState
            : records.map(r => {
                const f = r.fields || {}
                const outstanding = Number(f['Outstanding Amount'] || 0)
                const refs = parseAttachments(f['Reference'])
                const pdfs = parseAttachments(f['Invoice PDF'])
                const allFiles = [...refs, ...pdfs]
                const isPending = f['Payment Status'] === 'Pending'
                return (
                  <article
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openView(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openView(r)
                      }
                    }}
                    className="invoice-mobile-card w-full text-left animate-slide-up">
                    {/* Top: invoice # + status */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>
                          Invoice
                        </p>
                        <p className="font-mono text-[13px] font-bold truncate mt-1" style={{ color: 'var(--text-1)' }}>
                          {f['Invoice Number'] || '—'}
                        </p>
                        <p className="text-[11px] truncate mt-1" style={{ color: 'var(--text-3)' }}>
                          {f['Project'] || '—'} {f['Category'] ? `· ${f['Category']}` : ''}
                        </p>
                      </div>
                      <StatusPill status={f['Payment Status']} />
                    </div>
                    {f['Raised By'] && (
                      <div className="invoice-mobile-meta mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>
                          <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={12} />
                        </span>
                        {f['Milestone'] && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>{f['Milestone']}</span>}
                      </div>
                    )}
                    {/* Middle: amounts */}
                    <div className="invoice-mobile-summary my-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Amount</p>
                        <p className="font-bold tabular-nums text-base mt-1" style={{ color: 'var(--text-1)' }}>
                          {fmt(f['Amount Raised'])}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                        <p className="font-bold tabular-nums text-sm mt-1" style={{ color: outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                          {outstanding > 0 ? fmt(outstanding) : 'Clear'}
                        </p>
                      </div>
                    </div>
                    {/* Bottom: meta */}
                    <div className="invoice-mobile-foot">
                      <span className="tabular-nums">{fmtDate(f['Raised Date'])}</span>
                      <div className="invoice-mobile-foot-right">
                        {f['Next followup'] && (
                          <span className="flex items-center gap-0.5 tabular-nums" style={{ color: 'var(--fin-warning)' }}>
                            <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                          </span>
                        )}
                        {allFiles.length > 0 && (
                          <span className="flex items-center gap-0.5"><FileText size={10} />{allFiles.length}</span>
                        )}
                        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                      </div>
                    </div>
                    <div className="invoice-mobile-actions" onClick={e => e.stopPropagation()}>
                      {canPayment && isPending && (
                        <button type="button" onClick={() => openRecordPayment(r)} className="btn-primary">
                          <CheckCircle2 size={13} />Record payment
                        </button>
                      )}
                      {allFiles.length > 0 && (
                        <button type="button" onClick={() => setPreviewDocs({ docs: allFiles, index: 0 })} className="btn-ghost">
                          <Paperclip size={13} />Files ({allFiles.length})
                        </button>
                      )}
                      <button type="button" onClick={() => openView(r)} className="btn-ghost">
                        <Eye size={13} />Details
                      </button>
                    </div>
                  </article>
                )
              })
        }
        {hasData && records.length > 0 && showMore}
      </div>

      {/* ── Desktop table (md+) ── */}
      {tableDensity === 'compact' && (
        <style>{`.invoice-density-compact .tbl-cell{padding:0.28rem 0.75rem!important;font-size:0.75rem!important;line-height:1.3!important}.invoice-density-compact .tbl-head{padding:0.3rem 0.75rem!important;font-size:0.6rem!important}`}</style>
      )}
      <div
        className={clsx('data-table-shell hidden md:block', tableDensity === 'compact' ? 'is-compact invoice-density-compact' : '')}
      >
        <div className="invoice-table-toolbar">
          <div>
            <p>{scopeTotal.toLocaleString('en-IN')} invoices in view</p>
            {/* Only worth a second line when a filter is actually narrowing the
                set — otherwise it just repeats the count above it. */}
            <span>{
              syncing               ? 'Refreshing mirror data...'
              : scopeTotal < allCount
                                    ? `Filtered from ${allCount.toLocaleString('en-IN')} invoices`
                                    : 'Showing full current scope'
            }</span>
          </div>
          <div className="invoice-table-controls">
            <div className="invoice-density-toggle" role="group" aria-label="Table density">
              {[
                { mode: 'comfortable', label: 'Comfort', icon: (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="3" rx="1" fill="currentColor" opacity="0.4"/><rect x="1" y="6" width="12" height="3" rx="1" fill="currentColor" opacity="0.7"/><rect x="1" y="10" width="12" height="3" rx="1" fill="currentColor"/></svg>
                )},
                { mode: 'compact', label: 'Compact', icon: (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1.5" width="12" height="2" rx="0.8" fill="currentColor" opacity="0.4"/><rect x="1" y="4.5" width="12" height="2" rx="0.8" fill="currentColor" opacity="0.6"/><rect x="1" y="7.5" width="12" height="2" rx="0.8" fill="currentColor" opacity="0.8"/><rect x="1" y="10.5" width="12" height="2" rx="0.8" fill="currentColor"/></svg>
                )},
              ].map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTableDensity(mode)}
                  aria-pressed={tableDensity === mode}
                  className={tableDensity === mode ? 'active' : ''}
                  title={label}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColumnMenu(m => !m)}
                aria-expanded={showColumnMenu}
                aria-haspopup="true"
                className="btn-ghost"
                style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem' }}
              >
                <Columns3 size={12} />Columns
                <span className="tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {visibleColumnCount}/{INVOICE_COLUMNS.length}
                </span>
              </button>
              {showColumnMenu && (
                <>
                  {/* Click-away layer — closes without trapping focus */}
                  <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setShowColumnMenu(false)} />
                  <div
                    className="absolute right-0 mt-1 card"
                    style={{ zIndex: 41, minWidth: 210, padding: '0.4rem', maxHeight: 340, overflowY: 'auto' }}
                  >
                    {INVOICE_COLUMNS.map(({ key, label, locked }) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                        style={{
                          fontSize: '0.75rem',
                          cursor: locked ? 'not-allowed' : 'pointer',
                          opacity: locked ? 0.5 : 1,
                          color: 'var(--text-1)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!columnVisibility[key]}
                          disabled={locked}
                          onChange={() => toggleColumn(key)}
                        />
                        {label}
                      </label>
                    ))}
                    <div style={{ borderTop: '1px solid var(--card-border)', margin: '0.35rem 0' }} />
                    <button
                      type="button"
                      onClick={() => setColumnVisibility(DEFAULT_INVOICE_COLUMN_VISIBILITY)}
                      className="btn-ghost w-full"
                      style={{ fontSize: '0.72rem', padding: '0.35rem 0.5rem', justifyContent: 'flex-start' }}
                    >
                      <RotateCcw size={11} />Reset columns
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setColumnWidths(DEFAULT_INVOICE_COLUMN_WIDTHS)}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem' }}
            >
              <RotateCcw size={12} />Reset widths
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: visibleTableMinWidth, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="tbl-head" style={{ width: columnWidths.row }}>
                  <ResizableHead width={columnWidths.row} onResizeStart={(e) => startColumnResize('row', e)}>#</ResizableHead>
                </th>
                {columnVisibility.invoice_number && (
                  <th className="tbl-head" style={{ width: columnWidths.invoice_number }}>
                  <ResizableHead width={columnWidths.invoice_number} onResizeStart={(e) => startColumnResize('invoice_number', e)}><SortLabel col="Invoice Number">Invoice #</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.payment_status && (
                  <th className="tbl-head" style={{ width: columnWidths.payment_status }}>
                  <ResizableHead width={columnWidths.payment_status} onResizeStart={(e) => startColumnResize('payment_status', e)}><SortLabel col="Payment Status">Status</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.amount_raised && (
                  <th className="tbl-head" style={{ width: columnWidths.amount_raised, textAlign: 'right' }}>
                  <ResizableHead width={columnWidths.amount_raised} onResizeStart={(e) => startColumnResize('amount_raised', e)} align="right"><SortLabel col="Amount Raised">Amount</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.aging && (
                  <th className="tbl-head" style={{ width: columnWidths.aging }}>
                  <ResizableHead width={columnWidths.aging} onResizeStart={(e) => startColumnResize('aging', e)}><SortLabel col="Agening (Days)">Aging</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.client_name && (
                  <th className="tbl-head" style={{ width: columnWidths.client_name }}>
                  <ResizableHead width={columnWidths.client_name} onResizeStart={(e) => startColumnResize('client_name', e)}><SortLabel col="Client Name">Client</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.project && (
                  <th className="tbl-head" style={{ width: columnWidths.project }}>
                  <ResizableHead width={columnWidths.project} onResizeStart={(e) => startColumnResize('project', e)}><SortLabel col="Project">Project</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.raised_date && (
                  <th className="tbl-head" style={{ width: columnWidths.raised_date }}>
                  <ResizableHead width={columnWidths.raised_date} onResizeStart={(e) => startColumnResize('raised_date', e)}><SortLabel col="Raised Date">Raised</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.outstanding_amount && (
                  <th className="tbl-head" style={{ width: columnWidths.outstanding_amount, textAlign: 'right' }}>
                  <ResizableHead width={columnWidths.outstanding_amount} onResizeStart={(e) => startColumnResize('outstanding_amount', e)} align="right"><SortLabel col="Outstanding Amount">Outstanding</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.amount_received && (
                  <th className="tbl-head" style={{ width: columnWidths.amount_received, textAlign: 'right' }}>
                  <ResizableHead width={columnWidths.amount_received} onResizeStart={(e) => startColumnResize('amount_received', e)} align="right"><SortLabel col="Amount Received">Received</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.amount_with_tax && (
                  <th className="tbl-head" style={{ width: columnWidths.amount_with_tax, textAlign: 'right' }}>
                  <ResizableHead width={columnWidths.amount_with_tax} onResizeStart={(e) => startColumnResize('amount_with_tax', e)} align="right"><SortLabel col="Amount with Tax">GST Total</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.category && (
                  <th className="tbl-head" style={{ width: columnWidths.category }}>
                  <ResizableHead width={columnWidths.category} onResizeStart={(e) => startColumnResize('category', e)}><SortLabel col="Category">Category</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.milestone && (
                  <th className="tbl-head" style={{ width: columnWidths.milestone }}>
                  <ResizableHead width={columnWidths.milestone} onResizeStart={(e) => startColumnResize('milestone', e)}><SortLabel col="Milestone">Milestone</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.raised_by && (
                  <th className="tbl-head" style={{ width: columnWidths.raised_by }}>
                  <ResizableHead width={columnWidths.raised_by} onResizeStart={(e) => startColumnResize('raised_by', e)}><SortLabel col="Raised By">Raised By</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.next_followup && (
                  <th className="tbl-head" style={{ width: columnWidths.next_followup }}>
                  <ResizableHead width={columnWidths.next_followup} onResizeStart={(e) => startColumnResize('next_followup', e)}><SortLabel col="Next followup">Next Followup</SortLabel></ResizableHead>
                </th>
                )}
                {columnVisibility.docs && (
                  <th className="tbl-head" style={{ width: columnWidths.docs }}>
                  <ResizableHead width={columnWidths.docs} onResizeStart={(e) => startColumnResize('docs', e)}>Docs</ResizableHead>
                </th>
                )}
                <th className="tbl-head" style={{ width: columnWidths.actions }}>
                  <ResizableHead width={columnWidths.actions} onResizeStart={(e) => startColumnResize('actions', e)}>Actions</ResizableHead>
                </th>
              </tr>
            </thead>
            <tbody>
              {!hasData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={visibleColumnCount}>{emptyState}</td></tr>
                  : records.map((r, index) => (
                      <InvoiceTableRow
                        key={r.id}
                        r={r}
                        index={index}
                        isHovered={hoveredRow === r.id}
                        motion={rowMotion(r)}
                        columnVisibility={columnVisibility}
                        columnWidths={columnWidths}
                        visibleColumnCount={visibleColumnCount}
                        avatarMap={avatarMap}
                        canPayment={canPayment}
                        canEdit={canEdit}
                        onOpen={openView}
                        onPay={openRecordPayment}
                        onEdit={openEdit}
                        onPreview={openPreview}
                        onEnter={onRowEnter}
                        onLeave={onRowLeave}
                      />
                    ))
              }
            </tbody>

            {/* Totals for the money columns across the whole filtered view.
                Hidden while the skeleton is up or the view is empty — a row of
                zeros reads as real data. Every cell repeats the same
                columnVisibility guard as the header so the counts stay aligned
                whatever is toggled off. */}
            {hasData && records.length > 0 && (
              <tfoot>
                <tr className="invoice-total-row">
                  <td className="tbl-cell" style={{ width: columnWidths.row }}>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Total</span>
                  </td>
                  {columnVisibility.invoice_number && (
                    <td className="tbl-cell" style={{ width: columnWidths.invoice_number }}>
                      <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                        {scopeTotal.toLocaleString('en-IN')} {scopeTotal === 1 ? 'invoice' : 'invoices'}
                      </span>
                    </td>
                  )}
                  {columnVisibility.payment_status && <td className="tbl-cell" style={{ width: columnWidths.payment_status }} />}
                  {columnVisibility.amount_raised && (
                    <td className="tbl-cell" style={{ width: columnWidths.amount_raised, textAlign: 'right' }}>
                      <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>{fmt(columnTotals.amountRaised)}</span>
                    </td>
                  )}
                  {columnVisibility.aging && <td className="tbl-cell" style={{ width: columnWidths.aging }} />}
                  {columnVisibility.client_name && <td className="tbl-cell" style={{ width: columnWidths.client_name }} />}
                  {columnVisibility.project && <td className="tbl-cell" style={{ width: columnWidths.project }} />}
                  {columnVisibility.raised_date && <td className="tbl-cell" style={{ width: columnWidths.raised_date }} />}
                  {columnVisibility.outstanding_amount && (
                    <td className="tbl-cell" style={{ width: columnWidths.outstanding_amount, textAlign: 'right' }}>
                      {columnTotals.outstanding > 0
                        ? <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--fin-warning)' }}>{fmt(columnTotals.outstanding)}</span>
                        : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                  )}
                  {columnVisibility.amount_received && (
                    <td className="tbl-cell" style={{ width: columnWidths.amount_received, textAlign: 'right' }}>
                      <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--fin-positive)' }}>{fmt(columnTotals.amountReceived)}</span>
                    </td>
                  )}
                  {columnVisibility.amount_with_tax && (
                    <td className="tbl-cell" style={{ width: columnWidths.amount_with_tax, textAlign: 'right' }}>
                      <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--text-2)' }}>{fmt(columnTotals.amountWithTax)}</span>
                    </td>
                  )}
                  {columnVisibility.category && <td className="tbl-cell" style={{ width: columnWidths.category }} />}
                  {columnVisibility.milestone && <td className="tbl-cell" style={{ width: columnWidths.milestone }} />}
                  {columnVisibility.raised_by && <td className="tbl-cell" style={{ width: columnWidths.raised_by }} />}
                  {columnVisibility.next_followup && <td className="tbl-cell" style={{ width: columnWidths.next_followup }} />}
                  {columnVisibility.docs && <td className="tbl-cell" style={{ width: columnWidths.docs }} />}
                  <td className="tbl-cell" style={{ width: columnWidths.actions }} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {/* ── Show more: the next page of the same scope (keyset cursor) ── */}
        {hasData && records.length > 0 && showMore}

        {/* ── Totals row — sum of ALL currently filtered invoices (not just the loaded rows) ── */}
        {hasData && scopeTotal > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-b-xl text-xs font-medium"
            style={{ background: 'var(--bg-input)', borderTop: '1px solid var(--card-border)' }}>
            <span style={{ color: 'var(--text-3)' }}>{scopeTotal.toLocaleString('en-IN')} invoice{scopeTotal !== 1 ? 's' : ''} in view</span>
            <div className="flex flex-wrap gap-4">
              <span>Raised <strong style={{ color: 'var(--text-1)' }}>{fmt(columnTotals.amountRaised)}</strong></span>
              <span>Incl. GST <strong style={{ color: 'var(--text-1)' }}>{fmt(columnTotals.amountWithTax)}</strong></span>
              <span>Collected <strong style={{ color: 'var(--fin-positive)' }}>{fmt(columnTotals.amountReceived)}</strong></span>
              <span>Outstanding <strong style={{ color: columnTotals.outstandingRaw > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmt(columnTotals.outstandingRaw)}</strong></span>
            </div>
          </div>
        )}
      </div>

      </>
      )}

      {/* ── Drawers — always rendered so exit animations play ── */}
      <InvoiceDetail
        open={drawer?.mode === 'view'}
        invoice={drawer?.mode === 'view' ? drawer.invoice : null}
        onClose={closeDrawer}
        onEdit={canEdit ? () => setDrawer({ mode: 'edit', invoice: drawer?.invoice }) : null}
        onRecordPayment={canPayment ? () => openRecordPayment(drawer?.invoice) : null}
        isEditor={isEditor}
        canPayment={canPayment}
        onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })}
        avatarMap={avatarMap}
      />
      {(canCreate || canEdit || canPayment) && (
        <InvoiceDrawer
          open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
          invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
          prefill={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.prefill : null}
          paymentOnly={drawer?.mode === 'payment'}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          options={formOptions}
        />
      )}
      {isEditor && shareModal && (
        <ShareLinkModal
          resourceType="invoices"
          selectedRecords={records}
          title={shareTitle}
          recordLabel="invoice"
          highlightableColumns={INVOICE_SHARED_HIGHLIGHTABLE_COLUMNS}
          enableLiveMode
          viewConfig={sharedViewConfig}
          onClose={() => setShareModal(false)}
        />
      )}
      {isEditor && manageModal && (
        <ManageSharedLinksModal
          resourceType="invoices"
          recordLabel="invoice"
          currentViewConfig={sharedViewConfig}
          visibleRecords={records}
          highlightableColumns={INVOICE_SHARED_HIGHLIGHTABLE_COLUMNS}
          onClose={() => setManageModal(false)}
        />
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
    </ExecutiveShell>
  )
}
