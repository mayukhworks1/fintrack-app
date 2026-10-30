import { useState, useCallback, useRef, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Plus, X, ChevronDown, AlertTriangle, CheckCircle2, Search, ExternalLink, FileText, ArrowUpDown, Filter, AlertOctagon, User, Tag, Eye, IndianRupee, TrendingUp, Percent, CalendarClock, Receipt, Briefcase, Repeat2, Users, BookOpen, LayoutDashboard, Activity, ArrowRight, ShieldAlert, Download, WifiOff, Printer } from 'lucide-react'
import { api } from '../services/api'
import AgingRunway from '../components/AgingRunway'
import { useChangeCount } from '../hooks/useServerList'
import { LiveValue, LiveDot } from '../components/LiveFigures'
import { useRecordMotion } from '../hooks/useRecordMotion'

import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { ProjectsWorkspace } from './WebProjects'
import TaxLedger from './TaxLedger'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder } from '../components/FilterBuilder'
import { activeConditions as activeRules, invoiceQueryParams, useInvoiceFilters, useWebInvoiceQuery, webInvoiceList } from './invoices/useInvoiceQuery'

import clsx from 'clsx'
import { downloadBlob } from '../utils/download'
import { escapeHtml } from '../utils/sanitize'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'
import MonthlyCollectionsChart from '../components/MonthlyCollectionsChart'
// ── Extracted modules ─────────────────────────────────────────────────────
import { HelpModal } from './webinvoices/HelpModal'
import { InvoiceDetail } from './webinvoices/InvoiceDetail'
import { InvoiceDrawer } from './webinvoices/InvoiceDrawer'
import { AppSidebar, MobileBottomNav, MobileHeader } from './webinvoices/nav'
import { AgingBadge, AttachThumb, DashboardMetric, DashboardSignal, KpiCard, MonthStatusPill, RaisedByBadge, SkeletonRow, StatusPill } from './webinvoices/ui'
import { DEFAULT_PICKLISTS, INVOICE_FIELDS, INVOICE_REQUEST_FORM_URL, STATUS_META, buildRetainerGroups, classifyAgingBand, currencySymbol, currentMonthKey, dateOnlyValue, endOfMonthIso, firstDayIso, fmt, fmtCurrency, fmtDate, getRetainerCategoryOption, invoiceAmountParts, isRetainerCategory, monthKey, monthLabel, parseAttachments, parseIsoDate, shiftMonthKey, shortMonthLabel, sortByRaisedDateDesc } from './webinvoices/utils'
import { useConfirm } from '../context/ConfirmContext'
import { tint } from '../utils/color'

/* ── Constants ── */
// All picklist options are loaded live from Teable — no hardcoded fallbacks
const CHART_PRESET_DAYS = { '30d': 30, '60d': 60, '3m': 90, '6m': 180, '1y': 365, custom: null }
const PRINT_MAX_ROWS = 2000
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** GET /api/web-invoices/query totals in the shape the old /summary had:
 *  RS-primary figures, counts by status, per-currency and per-project maps. */
function webSummary(x) {
  if (!x) return null
  const rs = x.by_currency?.RS
  return {
    total_raised: rs?.raised || 0,
    total_with_tax: rs?.with_tax || 0,
    total_gst: rs?.gst || 0,
    total_tds: rs?.tds || 0,
    total_received: rs?.received || 0,
    total_outstanding: rs?.outstanding || 0,
    collection_rate: rs?.collection_rate || 0,
    total_invoices: x.count || 0,
    active_invoices: x.active_count || 0,
    overdue_count: x.overdue_count || 0,
    by_status: Object.fromEntries(Object.entries(x.by_status || {}).map(([k, v]) => [k, v.count])),
    by_currency: x.by_currency || {},
    by_project: Object.fromEntries((x.by_project || []).map(p => [p.project, p])),
  }
}

export default function WebInvoices() {
  const confirm = useConfirm()
  const toast = useToast()
  const { isAll, logout, hasPerm } = useAuth()
  const canCreateInvoice  = hasPerm('module.invoices.create')
  const canEditInvoice    = hasPerm('module.invoices.edit')
  const canPayInvoice     = hasPerm('module.invoices.payment')
  // Projects and Tax tabs are shown for web_admin (isAll) OR if the user has been granted
  // the permission explicitly via the Permission Matrix — this lets web-role users access
  // these sections without needing to be promoted to web_admin.
  const canViewProjects   = isAll || hasPerm('module.projects.view')
  const canViewTax        = isAll || hasPerm('module.tax.view')
  const { dark } = useTheme()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialWorkspace = searchParams.get('tab') || 'dashboard'

  const updateUrlParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [sidebarOpen,    setSidebarOpen]    = useState(true)
  const [helpOpen,       setHelpOpen]       = useState(false)
  const [workspace,      setWorkspace]      = useState(initialWorkspace)
  const [selectedRetainer, setSelectedRetainer] = useState('')

  // ── Invoice-workspace-only filters ────────────────────────────────────────
  // These ONLY apply inside the 'invoices' workspace. Dashboard, retainers,
  // and projects are completely isolated — they never read these values.
  // Search, filters, sort and loaded pages live in the URL while the
  // invoices workspace is open, so a link reopens the same view.
  const { filters, pages, setFilters, setPages, searchInput, setSearchInput, commitSearch, clearAll } = useInvoiceFilters()
  const {
    status: statusFilter, project: projectFilter, category: categoryFilter, raisedBy: raisedByFilter,
    billing: billingFilter, month: monthFilter, aging: agingBandFilter, dateField: dateFieldFilter,
    dateFrom, dateTo, overdue: overdueOnly, hasDocs: hasDocsOnly, followupDue: followupDueOnly,
    conditions: filterConditions, sort: sortCol, order: sortDir,
  } = filters
  const search = filters.q
  const {
    setStatusFilter, setProjectFilter, setCategoryFilter, setRaisedByFilter, setBillingFilter, setMonthFilter,
    setAgingBandFilter, setDateFieldFilter, setDateFrom, setDateTo, setOverdueOnly, setHasDocsOnly,
    setFollowupDueOnly, setFilterConditions,
  } = useMemo(() => {
    const make = (key, opts) => (value) => setFilters(prev => ({
      [key]: typeof value === 'function' ? value(prev[key]) : value,
    }), opts)
    return {
      setStatusFilter: make('status'), setProjectFilter: make('project'), setCategoryFilter: make('category'),
      setRaisedByFilter: make('raisedBy'), setBillingFilter: make('billing'), setMonthFilter: make('month'),
      setAgingBandFilter: make('aging'), setDateFieldFilter: make('dateField'), setDateFrom: make('dateFrom'),
      setDateTo: make('dateTo'), setOverdueOnly: make('overdue'), setHasDocsOnly: make('hasDocs'),
      setFollowupDueOnly: make('followupDue'),
      // Rules are edited a keystroke at a time; one history entry, not one per key.
      setFilterConditions: make('conditions', { replace: true }),
    }
  }, [setFilters])
  const setSearch = useCallback((q) => { setSearchInput(q); setFilters({ q: q.trim() }, { replace: true }) }, [setFilters, setSearchInput])
  const [retainerMonth,  setRetainerMonth]  = useState(currentMonthKey())
  // Open by default, except on a phone, where the bar stays in view and an
  // open panel would cover the list.
  const [showFilters,    setShowFilters]    = useState(() => {
    try { return !window.matchMedia('(max-width: 640px)').matches } catch { return true }
  })
  const [showExportMenu, setShowExportMenu] = useState(false)

  // switchWorkspace: clears invoice-list filters when moving AWAY from invoices
  // so switching back starts fresh, and drilldowns from dashboard explicitly set what they need.
  const switchWorkspace = useCallback((next) => {
    if (next !== 'invoices') {
      clearAll()
      setFilters({ sort: 'Raised Date', order: 'desc' })
    }
    setWorkspace(next)
  }, [clearAll, setFilters])
  const [drawer,         setDrawer]         = useState(null)
  const [drawerKey,      setDrawerKey]      = useState(0)
  const [picklists,      setPicklists]      = useState(DEFAULT_PICKLISTS)
  const [canEditPicklists, setCanEditPicklists] = useState(true)
  const [picklistPermissionMsg, setPicklistPermissionMsg] = useState('')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [previewDocs, setPreviewDocs] = useState(null)

  useEffect(() => {
    // Load ALL picklist fields (Project, Category, Milestone, Raised By, Currency)
    // directly from Teable field schema — same source as Currency, no detours.
    api.webInvoices.picklists.get()
      .then(data => {
        setPicklists(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, v.options])
          ),
        }))
      })
      .catch(() => {})
  }, [])

  function handleOptionsUpdate(fieldName, newOptions) {
    setPicklists(prev => ({ ...prev, [fieldName]: newOptions }))
  }

  function handlePicklistPermissionError(message) {
    setCanEditPicklists(false)
    setPicklistPermissionMsg(message)
  }

  const [agingBuckets,  setAgingBuckets]  = useState(null)
  const [avatarMap,     setAvatarMap]     = useState({})
  const [hoveredRow,    setHoveredRow]    = useState(null)
  const [chartPreset,   setChartPreset]   = useState('60d')
  const [chartFrom,     setChartFrom]     = useState('')
  const [chartTo,       setChartTo]       = useState('')
  const [balanceMonths, setBalanceMonths] = useState(3)
  const hoverTimerRef = useRef(null)

  // Only the active tab is written by the page itself; the invoice filters
  // are cleared whenever the invoices workspace is left.
  useEffect(() => { updateUrlParam('tab', workspace === 'dashboard' ? '' : workspace) }, [workspace])

  useEffect(() => {
    api.webInvoices.agingBuckets().then(setAgingBuckets).catch(() => {})
  }, [])

  useEffect(() => {
    api.webInvoices.avatarMap().then(setAvatarMap).catch(() => {})
  }, [])

  /* ── The list, its totals and the workspace's, from the server ──
   * One request per scope: a page of rows, the totals of everything the
   * search and filters match (`agg`) and of every invoice the user may see
   * (`ws`), each per currency. The projects and tax workspaces do not need it. */
  const listWanted = workspace === 'dashboard' || workspace === 'invoices' || workspace === 'retainers'
  const {
    records, total: scopeTotal, nextCursor, aggregates: agg, workspace: ws, hasData,
    loading: firstLoad, refreshing: syncing, loadingMore, error, errorStatus, loadMore, refresh: refreshList,
    patchRecord, removeRecord,
  } = useWebInvoiceQuery(filters, { pages, onPagesChange: setPages, enabled: listWanted })
  const loading = syncing
  const listData = hasData ? true : null
  const isStaleData = !!error && hasData
  const summaryChanges = useChangeCount(ws ? [ws.raised, ws.collected, ws.outstanding, ws.count] : null)
  const sumLoading = !hasData
  const allCount = ws?.count ?? 0

  const monthOptions = useMemo(() => ws?.facets?.months || [], [ws])

  // Compute effective aging — only meaningful for Pending invoices
  function effectiveAging(f) {
    if (f['Payment Status'] && f['Payment Status'] !== 'Pending') return 0
    const teableVal = f['Agening (Days)']
    if (teableVal != null && teableVal !== '') return Number(teableVal)
    const raised = parseIsoDate(f['Raised Date'])
    if (!raised) return 0
    return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
  }

  const retainerMonthOptions = useMemo(() => (
    [...new Set([currentMonthKey(), ...monthOptions])].sort().reverse()
  ), [monthOptions])

  // Which rows a poll brought in or altered.
  const rowMotion = useRecordMotion(records, {
    watch: r => `${r.fields?.['Payment Status'] || ''}|${r.fields?.['Outstanding Amount'] || ''}|${r.fields?.['Amount'] || ''}`,
  })

  // Totals for the money columns, grouped by currency. Unlike the main invoice
  // table — which formats everything as INR — this module renders each row in
  // its own Currency, so a single summed figure across a mixed view would be
  // meaningless. Grouping keeps it honest: one currency gives one line, a mixed
  // view lists each. Outstanding is clamped per row to match its cell, which
  // shows an em dash for anything not positive. The server sums the whole
  // filtered scope, not just the rows loaded.
  const currencyTotals = useMemo(() => Object.entries(agg?.by_currency || {}).map(([cur, t]) => ({
    currency: cur, count: t.count, raised: t.totals?.amount_raised || 0, withTax: t.totals?.amount_with_tax || 0,
    received: t.totals?.amount_received || 0, outstanding: t.totals?.outstanding || 0,
  })).sort((a, b) => b.count - a.count), [agg])

  // The cards follow the search and filters (`sc`); `s` is every invoice.
  const s        = useMemo(() => webSummary(ws), [ws])
  const sc       = useMemo(() => webSummary(agg), [agg])
  const overdue  = useMemo(() => (ws?.overdue_top || []).filter(inv => inv.aging > 30), [ws])
  const overdueCount = s?.overdue_count || 0
  const activeConditions = activeRules(filterConditions)
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0
  // Under each card while the view is narrowed: the figure for every invoice.
  const ofAll = (value) => (hasFilters && s && value != null ? `of ${fmt(value)} across all ${allCount}` : null)

  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(sc?.by_project || {})
      // Sort by total invoice count (universal — not RS-only raised)
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [sc])

  /* ── Retainer records: fetched for the dashboard and the Retainers workspace ── */
  const [retainerRecords, setRetainerRecords] = useState([])
  const loadRetainers = useCallback(async () => {
    try {
      const data = await webInvoiceList.fetchOnce({ billing: 'retainer', limit: 200, aggregates: '0' })
      if (data?.records) setRetainerRecords(data.records)
    } catch { /* the workspace shows its empty state */ }
  }, [])
  useEffect(() => {
    if (workspace === 'retainers' || workspace === 'dashboard') loadRetainers()
  }, [workspace, loadRetainers, summaryChanges])

  const retainerGroups = useMemo(
    () => buildRetainerGroups(retainerRecords, retainerMonth),
    [retainerRecords, retainerMonth],
  )

  useEffect(() => {
    if (!retainerGroups.length) {
      setSelectedRetainer('')
      return
    }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null
  // Surfaces for the billing dashboard, drawn from the palette so they follow
  // both the palette and the mode.
  const dashboardStyles = useMemo(() => ({
    shell: 'radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 9%, transparent), transparent 40%), radial-gradient(circle at bottom right, color-mix(in srgb, var(--fin-positive) 6%, transparent), transparent 40%), var(--card-bg)',
    panel: 'var(--card-bg)',
    panelSoft: 'var(--bg-input)',
    accentPanel: 'var(--fin-pos-bg)',
    warnPanel: 'var(--fin-warn-bg)',
    line: 'var(--card-border)',
    glow: 'var(--card-shadow)',
  }), [])

  const visibleClientCount = agg?.project_count || 0

  /* ── Dashboard: the next follow-ups, oldest first, across every invoice ── */
  const [upcomingFollowups, setUpcomingFollowups] = useState([])
  useEffect(() => {
    if (workspace !== 'dashboard') return undefined
    let cancelled = false
    webInvoiceList.fetchOnce({ sort: 'Next followup', order: 'asc', limit: 5, aggregates: '0' })
      .then((data) => {
        if (!cancelled && data) setUpcomingFollowups((data.records || []).filter(r => r.fields?.['Next followup']))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspace, summaryChanges])

  // The list's own order is newest raised first, so its first rows are the latest.
  const latestInvoices = useMemo(() => sortByRaisedDateDesc(records).slice(0, 6), [records])
  const topOutstandingProject = useMemo(() => {
    return projectSummaryCards
      .slice()
      .sort((a, b) => {
        const aOut = Object.values(a.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        const bOut = Object.values(b.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        return bOut - aOut
      })[0] || null
  }, [projectSummaryCards])

  const dashboardStatusRows = useMemo(() => {
    const byStatus = s?.by_status || {}
    const total = Object.values(byStatus).reduce((sum, count) => sum + Number(count || 0), 0) || 1
    return Object.entries(byStatus)
      .map(([status, count]) => {
        const meta = STATUS_META[status] || {}
        return {
          status,
          count,
          pct: Math.round((Number(count || 0) / total) * 100),
          color: meta.color || 'var(--accent)',
        }
      })
      .sort((a, b) => Number(b.count) - Number(a.count))
  }, [s])
  // Dashboard overview widgets always use the full unfiltered set so search/status
  // filters active in the invoice list view don't blank out the dashboard.
  const raisedTimeline = useMemo(() => (ws?.raised_months || []).slice(0, 6), [ws])
  const clearedTimeline = useMemo(() => (ws?.cleared_months || []).slice(0, 6), [ws])
  // Counts AND amounts. The panel used to show counts alone, which answers the
  // wrong question: ten small invoices at 90 days matter less than one large
  // one, and a count cannot tell you which you have.
  //
  // Amount is Amount Raised, matching how the rest of the app defines
  // outstanding for an unpaid invoice (_compute_summary adds `raised` for any
  // non-Paid, non-Cancelled row). Deriving it from with-tax minus received here
  // would repeat the mistake that makes Studio's outstanding disagree with the
  // dashboard — it counts TDS on paid invoices as money still owed.
  //
  // Band keys are unchanged: agingBandFilter matches on these exact labels.
  const dashboardAgingBuckets = useMemo(() => Object.fromEntries(
    ['0-14d', '15-30d', '31-60d', '60d+'].map(band => [band, {
      count: ws?.aging?.[band]?.count || 0, amount: ws?.aging?.[band]?.amount || 0,
    }]),
  ), [ws])

  const agingRunwayRows = useMemo(
    () => Object.entries(dashboardAgingBuckets).map(([label, v]) => ({ label, ...v })),
    [dashboardAgingBuckets]
  )
  const applyDashboardMonthDrilldown = useCallback((field, key) => {
    setFilters({
      dateField: field,
      dateFrom: `${key}-01`,
      dateTo: endOfMonthIso(key),
      month: field === 'Raised Date' ? key : '',
    })
    setWorkspace('invoices')
  }, [setFilters])

  const lastThreeMonthBalance = useMemo(() => {
    const current = currentMonthKey()
    const keys = Array.from({ length: balanceMonths }, (_, i) => shiftMonthKey(current, -(balanceMonths - 1 - i)))
    const byMonth = new Map((ws?.raised_months || []).map(m => [m.key, m]))
    return keys.map((key, index) => {
      const m = byMonth.get(key) || {}
      const gross = m.gross || 0
      const received = m.received || 0
      const previous = index > 0 ? keys[index - 1] : ''
      const previousGross = previous ? byMonth.get(previous)?.gross || 0 : 0
      const change = previous && previousGross ? ((gross - previousGross) / Math.abs(previousGross)) * 100 : null
      const collectionRate = gross > 0 ? Math.min(100, Math.max(0, (received / gross) * 100)) : 0
      return {
        key, label: shortMonthLabel(key), base: m.base || 0, gross, gst: m.gst || 0, received,
        deduction: m.deduction || 0, outstanding: m.outstanding || 0, invoiceCount: m.count || 0, collectionRate, change,
      }
    })
  }, [ws, balanceMonths])

  const maxMonthlyBalanceMagnitude = useMemo(
    () => Math.max(1, ...lastThreeMonthBalance.map(e => e.gross)),
    [lastThreeMonthBalance]
  )

  /* ── Activity chart: the range's own invoices, plus what came before it ── */
  const chartWindow = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (chartPreset === 'custom') {
      if (!chartFrom) return null
      const start = new Date(chartFrom); start.setHours(0, 0, 0, 0)
      return { start }
    }
    const start = new Date(today); start.setDate(start.getDate() - ((CHART_PRESET_DAYS[chartPreset] || 60) - 1))
    return { start }
  }, [chartPreset, chartFrom])
  const [chartData, setChartData] = useState({ records: [], baseline: undefined })
  useEffect(() => {
    if (workspace !== 'dashboard' || !allCount || !chartWindow) return undefined
    let cancelled = false
    // A day early: "Raised Date" is a UTC day on the server and a local one here.
    const from = new Date(chartWindow.start); from.setDate(from.getDate() - 1)
    webInvoiceList.fetchOnce({ date_from: isoDay(from), limit: 200, tz: -new Date().getTimezoneOffset() || undefined })
      .then((d) => {
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
  }, [chartWindow, allCount, summaryChanges, workspace])

  const refresh = useCallback(() => {
    refreshList()
    if (workspace === 'retainers' || workspace === 'dashboard') loadRetainers()
  }, [refreshList, loadRetainers, workspace])

  async function createRetainerMonth(group, mode) {
    if (!canCreateInvoice) return
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
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
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
          : `Recurring retainer for ${monthName}. Invoice number to be updated by account manager.`,
      }
      await api.webInvoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    const label = monthLabel(monthKeyValue)
    // onConfirm rather than awaiting the promise: window.open() has to run
    // inside the click handler while the user gesture is still live, and a
    // popup opened after an await is blocked.
    confirm({
      title: 'Open invoice request form',
      message: `Open the external invoice request form for ${group.project} (${label})? It opens in a new tab.`,
      confirmLabel: 'Open form',
      tone: 'default',
      onConfirm: () => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer'),
    })
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    if (!canCreateInvoice) return
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    setDrawer({
      mode: 'new',
      invoice: null,
      draft: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
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
        reference: [],
        invoice_pdf: [],
      },
    })
  }

  const openNew     = ()  => { if (!canCreateInvoice) return; setDrawerKey(k => k + 1); setDrawer({ mode: 'new',  invoice: null, draft: null }) }
  const openView    = r   => { setDrawerKey(k => k + 1); setDrawer({ mode: 'view', invoice: r   }) }

  // Print the whole filtered list: the pages not yet on screen are fetched first.
  async function handlePrintInvoices() {
    // Opened inside the click, while the gesture still allows a popup.
    const w = window.open('', '_blank', 'width=1200,height=860')
    if (!w) return
    let rows = [...records]
    let cursor = nextCursor
    while (cursor && rows.length < PRINT_MAX_ROWS) {
      const more = await webInvoiceList.fetchOnce({ ...invoiceQueryParams(filters), cursor, limit: 200, aggregates: '0' })
      if (!more) break
      rows = rows.concat(more.records || [])
      cursor = more.next_cursor
    }
    const INR = (n) => n != null ? '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
    const printRows = rows.map(r => {
      const f = r.fields || {}
      return {
        no: f['Invoice Number'] || '—',
        date: String(f['Raised Date'] || '').slice(0, 10),
        project: f['Project'] || '—',
        category: f['Category'] || '—',
        status: f['Payment Status'] || '—',
        raised: f['Amount Raised'],
        withTax: f['Amount with Tax'],
        received: f['Amount Received'],
        outstanding: f['Outstanding Amount'],
      }
    })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Invoices</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,sans-serif;font-size:10px;color:#111;padding:16px}
      h1{font-size:15px;font-weight:700;margin-bottom:2px}
      .sub{font-size:8.5px;color:#6b7280;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th{background:#f3f4f6;font-weight:600;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em;padding:3px 5px;border:1px solid #e5e7eb;white-space:nowrap;text-align:right}
      th.l{text-align:left}
      td{padding:3px 5px;border:1px solid #e5e7eb;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px}
      td.l{text-align:left}
      tr:nth-child(even) td{background:#f9fafb}
      .green{color:#059669}.red{color:#dc2626}
      @page{margin:1cm;size:A4 landscape}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>Invoices</h1>
    <p class="sub">Generated ${new Date().toLocaleString('en-IN')} · ${printRows.length} invoice${printRows.length !== 1 ? 's' : ''}${cursor ? ` (first ${printRows.length} of ${scopeTotal}; export CSV for all of them)` : ''}</p>
    <table>
      <colgroup>
        <col style="width:11%"><col style="width:7%"><col style="width:18%"><col style="width:9%"><col style="width:8%">
        <col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:11%">
      </colgroup>
      <thead><tr>
        <th class="l">Invoice #</th><th class="l">Date</th><th class="l">Project</th><th class="l">Category</th><th class="l">Status</th>
        <th>Amount</th><th>With GST</th><th>Received</th><th>O/S</th>
      </tr></thead>
      <tbody>${printRows.map(r => `<tr>
        <td class="l">${escapeHtml(r.no)}</td><td class="l">${escapeHtml(r.date)}</td><td class="l">${escapeHtml(r.project)}</td><td class="l">${escapeHtml(r.category)}</td><td class="l">${escapeHtml(r.status)}</td>
        <td>${INR(r.raised)}</td><td>${INR(r.withTax)}</td><td class="green">${INR(r.received)}</td><td class="${Number(r.outstanding) > 0 ? 'red' : ''}">${INR(r.outstanding)}</td>
      </tr>`).join('')}</tbody>
    </table>
    </body></html>`
    w.document.write(html)
    w.document.close()
    w.onload = () => { w.focus(); w.print(); w.onafterprint = () => w.close() }
  }

  // The whole filtered scope (or every invoice), built on the server and
  // streamed, whatever the list has loaded.
  async function exportCsv(useFiltered) {
    setShowExportMenu(false)
    try {
      const params = useFiltered ? invoiceQueryParams(filters) : {}
      const { blob, filename } = await api.webInvoices.exportCsv(params)
      downloadBlob(blob, filename || `invoices_${useFiltered ? 'filtered_' : ''}${new Date().toISOString().slice(0,10)}.csv`)
    } catch (e) {
      toast(e?.message || 'Export failed', 'error')
    }
  }

  // Auto-open new invoice drawer when navigated with ?new=1 (e.g. from sidebar button)
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('new'); return n }, { replace: true })
    setWorkspace('invoices')
    openNew()
  }, []) // eslint-disable-line
  const openRecordPayment = r => {
    if (!canPayInvoice) return
    setDrawerKey(k => k + 1)
    setDrawer({
      mode: 'payment',
      invoice: r,
      draft: {
        payment_status: 'Paid',
        amount_received: r?.fields?.['Amount Raised'] ?? '',
        cleared_date: new Date().toISOString().slice(0, 10),
        reference: Array.isArray(r?.fields?.['Reference']) ? r.fields['Reference'] : [],
        remark: r?.fields?.['Remark'] || '',
      },
    })
  }
  const closeDrawer = () => setDrawer(null)
  // A save or delete shows at once; the refresh confirms it (writes go
  // through to the mirror the list reads).
  const handleSaved = (savedRecord) => {
    if (savedRecord?.id) patchRecord(savedRecord)
    refresh()
    closeDrawer()
  }
  const handleDeleted = (deletedId) => {
    if (deletedId) removeRecord(deletedId)
    refresh()
    closeDrawer()
  }

  // Show more: the next page of this scope. A button, not infinite scroll, so
  // the totals row stays reachable and the count is clear.
  const showMore = hasData && records.length > 0 && (
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

  function handleSort(col) {
    if (sortCol === col) setFilters({ order: sortDir === 'asc' ? 'desc' : 'asc' })
    else setFilters({ sort: col, order: 'desc' })
  }

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
    <div className="app-shell web-invoices-shell flex overflow-hidden" style={{ background: 'var(--bg-base)', marginTop: 'var(--impersonation-banner-h, 0px)', height: 'calc(100vh - var(--impersonation-banner-h, 0px))' }}>
      {/* ── Sidebar — desktop only ── */}
      <AppSidebar
        workspace={workspace}
        setWorkspace={switchWorkspace}
        isAll={isAll}
        canViewProjects={canViewProjects}
        canViewTax={canViewTax}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
        onHelp={() => setHelpOpen(true)}
        onNew={canCreateInvoice ? openNew : null}
      />

      {/* ── Content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Mobile top header — hidden sm+ */}
      <MobileHeader onHelp={() => setHelpOpen(true)} onLogout={logout} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-5 animate-fade-in">

          {/* ── Invoices header ── */}
          {workspace === 'dashboard' && (
          <section
            className="rounded-[28px] p-4 sm:p-5 lg:p-6 space-y-4"
            style={{
              background: dashboardStyles.shell,
              border: `1px solid ${dashboardStyles.line}`,
              boxShadow: dashboardStyles.glow,
            }}>
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="flex items-center justify-center rounded-[22px] flex-shrink-0"
                    style={{
                      width: 46,
                      height: 46,
                      background: 'var(--accent-dim)',
                      border: `1px solid ${dashboardStyles.line}`,
                    }}>
                    <LayoutDashboard size={20} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: 'var(--accent-ink)' }}>
                      Billing Command Deck
                    </p>
                    <h1 className="text-[1.9rem] sm:text-[2.2rem] lg:text-[2.45rem] font-bold tracking-tight mt-0.5 leading-none" style={{ color: 'var(--text-1)' }}>
                      Billing Dashboard
                    </h1>
                  </div>
                </div>
                <p className="max-w-xl text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  Cash movement, overdue pressure, retainers, and project billing signals in one live Teable-backed workspace.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 w-full xl:w-auto">
                <button onClick={() => switchWorkspace('invoices')} className="btn-ghost justify-center whitespace-nowrap">
                  <FileText size={14} />Open invoices
                </button>
                <button onClick={() => switchWorkspace('retainers')} className="btn-ghost justify-center whitespace-nowrap">
                  <Repeat2 size={14} />Retainers
                </button>
                {canViewProjects && (
                  <button onClick={() => switchWorkspace('projects')} className="btn-ghost justify-center whitespace-nowrap">
                    <Briefcase size={14} />Projects
                  </button>
                )}
                <button onClick={refresh} disabled={loading} className="btn-ghost justify-center whitespace-nowrap">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
                </button>
                <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-primary justify-center whitespace-nowrap">
                  <ExternalLink size={14} />Raise externally
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.9fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="grid grid-cols-2 2xl:grid-cols-4 gap-3">
                  <DashboardMetric
                    label={<span className="inline-flex items-center gap-1.5">Total raised <LiveDot changeCount={summaryChanges} loading={sumLoading && !s} size={5} /></span>}
                    value={sumLoading && !s ? '—' : undefined}
                    amount={sumLoading && !s ? undefined : Number(s?.total_raised)}
                    format={fmt}
                    sub={`${allCount} invoices across all workspaces`}
                    icon={null}
                    iconSlot={false}
                    tone={'var(--glass-bg)'}
                    accent={'var(--text-1)'}
                  />
                  <DashboardMetric
                    label="Collected"
                    value={sumLoading && !s ? '—' : undefined}
                    amount={sumLoading && !s ? undefined : Number(s?.total_received)}
                    format={fmt}
                    sub={`${(s?.collection_rate ?? 0).toFixed(1)}% collection rate`}
                    icon={TrendingUp}
                    tone={dashboardStyles.accentPanel}
                    accent="var(--fin-positive)"
                    compact
                  />
                  <DashboardMetric
                    label="Outstanding"
                    value={sumLoading && !s ? '—' : undefined}
                    amount={sumLoading && !s ? undefined : Number(s?.total_outstanding)}
                    format={fmt}
                    sub={`${overdueCount} invoice${overdueCount === 1 ? '' : 's'} beyond 30 days`}
                    icon={AlertOctagon}
                    tone={dashboardStyles.warnPanel}
                    accent={Number(s?.total_outstanding || 0) > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'}
                    compact
                  />
                  <DashboardMetric
                    label="Retainer coverage"
                    value={`${retainerGroups.length}`}
                    sub={`${selectedRetainerGroup?.currentMonthRaised ? 'Current month covered' : 'Review current month gaps'}`}
                    icon={Repeat2}
                    tone={'var(--glass-bg)'}
                    accent={'var(--chart-3)'}
                    compact
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <DashboardSignal
                  eyebrow="Main signal"
                  title={topOutstandingProject ? topOutstandingProject.project : 'No project pressure'}
                  body={topOutstandingProject
                    ? `${fmt(Object.values(topOutstandingProject.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))} currently open across ${topOutstandingProject.metrics?.count || 0} invoices.`
                    : 'No outstanding balance is currently visible in the filtered portfolio.'}
                  icon={Activity}
                  tone={dashboardStyles.accentPanel}
                  accent="var(--fin-positive)"
                />
                <DashboardSignal
                  eyebrow="Visible scope"
                  title={`${scopeTotal} live invoices · ${visibleClientCount} projects`}
                  body={hasFilters ? 'Dashboard is currently respecting active invoice filters.' : 'No extra filters applied. This is your full live billing picture.'}
                  icon={Users}
                  tone={dashboardStyles.panelSoft}
                  accent="var(--accent)"
                />
              </div>
            </div>

            {/* ── Aging Buckets ── */}
            {agingBuckets && (
            <div className="rounded-[26px] p-4 sm:p-5 space-y-3" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Receivables aging</p>
                  <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>Pending invoice age</h2>
                </div>
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{agingBuckets.total_pending} pending</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { key: '0_30',  label: '0–30 days',  color: 'var(--fin-positive)' },
                  { key: '30_60', label: '30–60 days', color: 'var(--fin-warning)' },
                  { key: '60_90', label: '60–90 days', color: 'var(--fin-warning)' },
                  { key: '90+',   label: '90+ days',   color: 'var(--fin-negative)' },
                ].map(({ key, label, color }) => {
                  const b = agingBuckets.buckets.find(x => x.label.replace('–','-') === label.replace('–','-')) || agingBuckets.buckets.find((_, i) => ['0_30','30_60','60_90','90+'][i] === key) || { count: 0, amount: 0 }
                  const pct = agingBuckets.total_outstanding > 0 ? (b.amount / agingBuckets.total_outstanding) * 100 : 0
                  return (
                    <div key={key} className="rounded-2xl p-3" style={{ background: 'var(--bg-layer)', border: `1px solid var(--card-border)` }}>
                      <p className="text-[11px] font-semibold mb-1.5" style={{ color }}>{label}</p>
                      <p className="text-lg font-bold tabular-nums leading-none mb-1" style={{ color: 'var(--text-1)' }}>{b.count}</p>
                      <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>₹{(b.amount/100000).toFixed(1)}L</p>
                      <div className="mt-2 h-1 rounded-full" style={{ background: 'var(--border)' }}>
                        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            )}

            {/* ── Invoice Activity Chart ── */}
            {allCount > 0 && (() => {
              const CHART_PRESETS = [
                { key: '30d',    label: '30d',   days: 30 },
                { key: '60d',    label: '60d',   days: 60 },
                { key: '3m',     label: '3 mo',  days: 90 },
                { key: '6m',     label: '6 mo',  days: 180 },
                { key: '1y',     label: '1 yr',  days: 365 },
                { key: 'custom', label: 'Custom',days: null },
              ]
              const activePreset = CHART_PRESETS.find(p => p.key === chartPreset) || CHART_PRESETS[1]
              const chartFromProp = chartPreset === 'custom' ? chartFrom : undefined
              const chartToProp   = chartPreset === 'custom' ? chartTo   : undefined
              const chartDaysProp = chartPreset === 'custom' ? 60 : (activePreset.days || 60)
              const labelText = chartPreset === 'custom' && chartFrom
                ? `${chartFrom}${chartTo ? ' → ' + chartTo : ''}`
                : `last ${activePreset.label}`
              return (
                <div className="rounded-[26px] overflow-hidden" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}`, padding: 0 }}>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Invoice activity</p>
                      <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>Billing activity · {labelText}</h2>
                      <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                        Bar height = amount ·&nbsp;
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--fin-positive)' }} />paid&nbsp;
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--fin-negative)' }} />overdue&nbsp;
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--text-3)' }} />pending
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                      if (rec) openView(rec)
                    }}
                  />
                </div>
              )
            })()}

            {/* ── Monthly Receivables + Recent Projects (side by side) ── */}
            {allCount > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
              {/* Left: compact pill widget */}
              <div className="rounded-[26px] p-4 sm:p-5 flex flex-col" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-2 mb-4 flex-shrink-0">
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>Last {balanceMonths} Months</h2>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Receivables at a glance</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {[3, 6, 12].map(m => (
                      <button key={m} onClick={() => setBalanceMonths(m)}
                        className={balanceMonths === m ? 'btn-primary' : 'btn-ghost'}
                        style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem' }}>{m} mo</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lastThreeMonthBalance.length}, 1fr)`, gap: '0.75rem', flex: 1 }}>
                  {lastThreeMonthBalance.map((entry, idx) => {
                    const collPct = entry.gross > 0 ? Math.min(100, (entry.received / entry.gross) * 100) : 0
                    const barH = maxMonthlyBalanceMagnitude > 0 ? Math.max(0.1, entry.gross / maxMonthlyBalanceMagnitude) : 0.1
                    const barColor = collPct >= 80
                      ? 'linear-gradient(180deg,var(--fin-positive),var(--fin-positive))'
                      : collPct >= 50
                      ? 'linear-gradient(180deg,var(--fin-warning),var(--fin-warning))'
                      : 'linear-gradient(180deg,var(--fin-negative),var(--fin-negative))'
                    const badgeLabel = entry.change !== null
                      ? (entry.change >= 0 ? `up ${entry.change.toFixed(0)}%` : `down ${Math.abs(entry.change).toFixed(0)}%`)
                      : `${collPct.toFixed(0)}% collected`
                    const badgeColor = entry.change !== null
                      ? (entry.change >= 0 ? { bg: 'color-mix(in srgb, var(--fin-positive) 18%, transparent)', text: 'var(--fin-positive)' } : { bg: 'color-mix(in srgb, var(--fin-negative) 20%, transparent)', text: 'var(--fin-negative)' })
                      : { bg: 'color-mix(in srgb, var(--text-3) 22%, transparent)', text: 'var(--text-3)' }
                    const fmtAmt = (v) => v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${Math.round(v)}`
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => applyDashboardMonthDrilldown('Raised Date', entry.key)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                      >
                        {/* Pill */}
                        <div style={{ width: '100%', flex: 1, maxHeight: 220, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                          <div style={{
                            width: '60%', height: `${barH * 100}%`, minHeight: 18,
                            background: barColor, borderRadius: 32,
                            transition: 'height 0.4s ease',
                            boxShadow: `0 3px 14px ${collPct >= 80 ? 'color-mix(in srgb, var(--fin-positive) 28%, transparent)' : collPct >= 50 ? 'color-mix(in srgb, var(--fin-warning) 28%, transparent)' : 'color-mix(in srgb, var(--fin-negative) 28%, transparent)'}`,
                          }} />
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', margin: '7px 0 3px' }}>{entry.label}</p>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-1)', marginBottom: 2 }}>{fmtAmt(entry.gross)}</p>
                        <p style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 6 }}>{fmtAmt(entry.received)} rcvd</p>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-3)' }}>
                            <span>Open</span><span style={{ fontWeight: 600, color: entry.outstanding > 0 ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{fmtAmt(entry.outstanding)}</span>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.22rem 0.6rem', borderRadius: 999, background: badgeColor.bg, color: badgeColor.text }}>{badgeLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Right: Recent Projects */}
              {projectSummaryCards.length > 0 && (
                <div className="rounded-[26px] p-4 sm:p-5" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="mb-4">
                    <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>Recent Projects</h2>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Active invoice pressure</p>
                  </div>
                  <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 360 }}>
                    {projectSummaryCards.slice(0, 5).map(({ project, metrics }) => {
                      const raised = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.raised || 0), 0)
                      const received = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.received || 0), 0)
                      const open = Object.values(metrics?.by_currency || {}).reduce((s, c) => s + Number(c?.outstanding || 0), 0)
                      const collPct = raised > 0 ? Math.min(100, (received / raised) * 100) : 0
                      const fmtAmt = (v) => v >= 100000 ? `₹${(v/100000).toFixed(2)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${Math.round(v)}`
                      return (
                        <button
                          key={project}
                          type="button"
                          onClick={() => { setProjectFilter(project); switchWorkspace('invoices') }}
                          className="w-full text-left rounded-2xl px-4 py-3 transition-all"
                          style={{ background: 'var(--glass-bg)', border: `1px solid ${dashboardStyles.line}`, cursor: 'pointer' }}
                        >
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                                {project[0]?.toUpperCase()}
                              </span>
                              <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</span>
                            </div>
                            <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-1)', flexShrink: 0 }}>{fmtAmt(raised)}</span>
                          </div>
                          <div className="flex items-center gap-1 mb-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                              <div className="h-full rounded-full" style={{ width: `${collPct}%`, background: collPct >= 80 ? 'var(--fin-positive)' : collPct >= 50 ? 'var(--fin-warning)' : 'var(--fin-negative)' }} />
                            </div>
                            <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: collPct >= 80 ? 'var(--fin-positive)' : collPct >= 50 ? 'var(--fin-warning)' : 'var(--fin-negative)' }}>{collPct.toFixed(0)}%</span>
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            {metrics?.count || 0} invoices · <span style={{ color: 'var(--fin-negative)' }}>₹{(open/1000).toFixed(0)}k open</span>
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Monthly Collections Chart (bars=raised, line=collected) ── */}
            {allCount > 0 && (
              <div className="rounded-[26px] p-4 sm:p-5" style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <MonthlyCollectionsChart months={ws?.raised_months || []} />
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_320px] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Raised timeline</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Raised by month-year</h2>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Click to filter</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {raisedTimeline.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No raised-date distribution available in the current scope.</p>
                  ) : raisedTimeline.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => applyDashboardMonthDrilldown('Raised Date', entry.key)}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={{ background: 'var(--glass-bg)', border: `1px solid ${dashboardStyles.line}` }}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>{monthLabel(entry.key)}</p>
                      <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: 'var(--text-1)' }}>{fmt(entry.amount)}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} raised invoice{entry.count !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Cleared timeline</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Cleared by month-year</h2>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Click to filter</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {clearedTimeline.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No cleared-date distribution available in the current scope.</p>
                  ) : clearedTimeline.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => applyDashboardMonthDrilldown('Cleared Date', entry.key)}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={{ background: 'var(--glass-bg)', border: `1px solid ${dashboardStyles.line}` }}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>{monthLabel(entry.key)}</p>
                      <p className="text-sm font-semibold tabular-nums mt-2" style={{ color: 'var(--fin-positive)' }}>{fmt(entry.amount)}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} cleared invoice{entry.count !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              </div>

              <AgingRunway
                buckets={agingRunwayRows}
                selected={agingBandFilter}
                dark={dark}
                onSelect={(label) => {
                  setAgingBandFilter(label)
                  if (label) switchWorkspace('invoices')
                }}
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Status distribution</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Collection pulse</h2>
                  </div>
                  <button onClick={() => switchWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}>
                    Open invoice table <ArrowRight size={12} />
                  </button>
                </div>
                <div className="space-y-3">
                  {dashboardStatusRows.map(row => (
                    <div key={row.status} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{row.status}</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {row.count} · {row.pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-2)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${row.pct}%`, background: row.color }} />
                      </div>
                    </div>
                  ))}
                </div>

                {projectSummaryCards.length > 0 && (
                  <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${dashboardStyles.line}` }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>Project pulse</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>Highest invoice-bearing projects in the current scope.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                      {projectSummaryCards.slice(0, 4).map(({ project, metrics }) => (
                        <button
                          key={project}
                          type="button"
                          onClick={() => { setProjectFilter(project); switchWorkspace('invoices') }}
                          className="rounded-2xl p-4 text-left transition-all"
                          style={{
                            background: 'var(--glass-bg)',
                            border: `1px solid ${dashboardStyles.line}`,
                          }}>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{metrics?.count || 0} invoices · click to filter</p>
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Raised</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--text-1)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.raised || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Collected</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-positive)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.received || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Open</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-warning)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-1 gap-4">
                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Attention queue</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Upcoming follow-ups</h2>
                    </div>
                    <ShieldAlert size={18} style={{ color: 'var(--fin-warning)' }} />
                  </div>
                  <div className="space-y-2">
                    {upcomingFollowups.length === 0
                      ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No follow-up dates are set in the current scope.</p>
                      : upcomingFollowups.map(record => {
                          const f = record.fields || {}
                          return (
                            <button
                              key={record.id}
                              type="button"
                              onClick={() => { switchWorkspace('invoices'); openView(record) }}
                              className="w-full text-left rounded-2xl p-3 transition-all"
                              style={{
                                background: 'var(--glass-bg)',
                                border: `1px solid ${dashboardStyles.line}`,
                              }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                                    {f['Project'] || 'Unnamed project'}
                                  </p>
                                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                    {f['Invoice Number'] || 'Invoice number pending'} · {f['Raised By'] || 'Unassigned'}
                                  </p>
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--fin-warning)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                  </div>
                </div>

                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Retainer desk</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Coverage snapshot</h2>
                    </div>
                    <button onClick={() => switchWorkspace('retainers')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                      Open retainers
                    </button>
                  </div>
                  <div className="space-y-2">
                    {retainerGroups.slice(0, 4).map(group => (
                      <button
                        key={group.project}
                        type="button"
                        onClick={() => { setSelectedRetainer(group.project); switchWorkspace('retainers') }}
                        className="w-full rounded-2xl p-3 text-left"
                        style={{
                          background: 'var(--glass-bg)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {fmt(group.amount)} · next due {monthLabel(group.nextDueMonth)}
                            </p>
                          </div>
                          <MonthStatusPill status={group.monthStatus} />
                        </div>
                      </button>
                    ))}
                    {retainerGroups.length === 0 && (
                      <p className="text-sm" style={{ color: 'var(--text-3)' }}>No retainer templates available yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Latest movement</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>Newest invoices</h2>
                  </div>
                  <button onClick={() => switchWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                    Open all
                  </button>
                </div>
                <div className="space-y-2">
                  {latestInvoices.map(record => {
                    const f = record.fields || {}
                    const cur = f['Currency'] || 'RS'
                    return (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => { switchWorkspace('invoices'); openView(record) }}
                        className="w-full rounded-2xl p-3 text-left transition-all"
                        style={{
                          background: 'var(--glass-bg)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {f['Project'] || 'Unnamed project'}
                            </p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {f['Invoice Number'] || 'Invoice number pending'} · {f['Category'] || 'Uncategorised'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</p>
                            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{fmtDate(f['Raised Date'])}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {latestInvoices.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No invoices available yet.</p>
                  )}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Operating notes</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>How to use this desk</h2>
                  </div>
                  <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="space-y-3">
                  {[
                    ['Invoices', 'Track pending, overdue, and fully collected billing records with live filters and file previews.'],
                    ['Retainers', 'Raise externally in Zoho, then record the final invoice details internally for month-by-month continuity.'],
                    ['Projects', canViewProjects ? 'Open the project workspace for project health, cashflow, and invoice context.' : 'Project workspace access not granted for your account.'],
                  ].map(([title, body]) => (
                    <div
                      key={title}
                      className="rounded-2xl p-3"
                      style={{
                        background: 'var(--glass-bg)',
                        border: `1px solid ${dashboardStyles.line}`,
                      }}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</p>
                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          {workspace === 'invoices' && (
          <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Invoices</h1>
              <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                <span className="live-dot" />
                <span>Live sync · {allCount} invoice{allCount !== 1 ? 's' : ''}</span>
                {syncing && <span style={{ color: 'var(--fin-warning)' }}>· syncing…</span>}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
              <div className="relative">
                <button onClick={() => setShowExportMenu(m => !m)} className="btn-ghost">
                  <Download size={14} />
                  <span className="hidden sm:inline">Export CSV</span>
                  <ChevronDown size={11} />
                </button>
                {showExportMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg border py-1 min-w-[180px]"
                      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-soft)' }}>
                      <button onClick={() => exportCsv(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                        <Download size={13} />
                        <span>Filtered ({scopeTotal})</span>
                      </button>
                      <button onClick={() => exportCsv(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                        <Download size={13} />
                        <span>All records ({allCount})</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={handlePrintInvoices} className="btn-ghost" title="Print invoice list">
                <Printer size={14} />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
                <ExternalLink size={14} />
                <span className="hidden sm:inline">Raise Externally</span>
                <span className="sm:hidden">Raise</span>
              </button>
              <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              {canCreateInvoice && (
                <button onClick={openNew} className="btn-primary">
                  <Plus size={14} />
                  <span>New Invoice</span>
                </button>
              )}
            </div>
          </div>
          {isStaleData && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm" style={{ background: 'color-mix(in srgb, var(--fin-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-warning) 30%, transparent)', color: 'var(--fin-warning)' }}>
              <WifiOff size={14} />
              <span>Live data unavailable — showing the last records loaded. Some changes may not appear.</span>
            </div>
          )}
          </>
          )}

          {/* ── Retainers header ── */}
          {workspace === 'retainers' && (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Retainers</h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Monthly retainer invoices — use the Zoho form to raise externally.
              </p>
            </div>
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} /><span className="hidden sm:inline">Raise Externally</span>
            </button>
          </div>
          )}

          {/* ── (Projects workspace has its own header inside ProjectsWorkspace) ── */}

          {/* Invoice KPIs, status chips, overdue — only on invoices / retainers tabs */}
          {(workspace === 'invoices' || workspace === 'retainers') && (
            <>
              {/* ── RS Primary KPIs ── */}
              <section aria-label="Invoice metrics (₹)" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                <KpiCard tone={0} label="Total Raised (₹)"   value={sumLoading && !sc ? null : <LiveValue value={sc?.total_raised} format={fmt} />}    icon={IndianRupee} ofAll={ofAll(s?.total_raised)} />
                <KpiCard tone={1} label="Incl. GST (₹)"      value={sumLoading && !sc ? null : <LiveValue value={sc?.total_with_tax} format={fmt} />}  icon={Receipt} ofAll={ofAll(s?.total_with_tax)} />
                <KpiCard tone={2} label="Collected (₹)"      value={sumLoading && !sc ? null : <LiveValue value={sc?.total_received} format={fmt} />}  icon={TrendingUp} semantic="positive" ofAll={ofAll(s?.total_received)} />
                <KpiCard tone={3} label="Outstanding (₹)"
                  value={sumLoading && !sc ? null : <LiveValue value={sc?.total_outstanding} format={fmt} />}
                  icon={CalendarClock}
                  semantic={(sc?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
                  sub={(sc?.total_outstanding || 0) > 0 ? `${sc?.by_currency?.RS?.pending_count || sc?.by_status?.Pending || 0} pending` : 'Fully collected'}
                  ofAll={ofAll(s?.total_outstanding)} />
                <KpiCard tone={4} label="Collection Rate (₹)"
                  value={sumLoading && !sc ? null : sc ? `${(sc.collection_rate ?? 0).toFixed(1)}%` : '—'}
                  icon={Percent}
                  semantic={(sc?.collection_rate || 0) >= 90 ? 'positive' : (sc?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
                  ofAll={hasFilters && s ? `${(s.collection_rate ?? 0).toFixed(1)}% across all ${allCount}` : null} />
              </section>

              {/* ── Foreign Currency KPI rows (auto-appear when non-RS invoices exist) ── */}
              {sc?.by_currency && Object.entries(sc.by_currency)
                .filter(([cur]) => cur !== 'RS')
                .map(([cur, data]) => (
                  <section key={cur} aria-label={`Invoice metrics (${cur})`}
                    className="rounded-2xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                    <div className="col-span-full flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-btn)', color: 'var(--accent-fg)' }}>{cur}</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{cur} Invoices — {data.count} total</span>
                    </div>
                    {[
                      { label: 'Raised',      val: data.raised,      tone: 0 },
                      { label: 'Incl. Tax',   val: data.with_tax,    tone: 1 },
                      { label: 'Collected',   val: data.received,    tone: 2, semantic: 'positive' },
                      { label: 'Outstanding', val: data.outstanding, tone: 3, semantic: data.outstanding > 0 ? 'warning' : 'positive',
                        sub: data.pending_count > 0 ? `${data.pending_count} pending` : 'Fully collected' },
                    ].map(({ label, val, tone, semantic, sub }) => (
                      <KpiCard key={label} tone={tone} label={`${label} (${currencySymbol(cur)})`}
                        value={fmtCurrency(val, cur)} semantic={semantic} sub={sub} />
                    ))}
                  </section>
                ))}

              {/* ── Status chips ── */}
              {sc?.by_status && Object.keys(sc.by_status).length > 0 && (
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(sc.by_status).map(([status, count]) => {
                    const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
                    const Icon = m.icon
                    const active = statusFilter === status
                    // Show RS amount for this status from by_currency
                    const rsAmt = (() => {
                      if (!sc?.by_currency?.RS) return null
                      if (status === 'Paid') return sc.by_currency.RS.received
                      if (status === 'Pending') return sc.by_currency.RS.outstanding
                      return null
                    })()
                    return (
                      <button key={status}
                        onClick={() => setStatusFilter(active ? '' : status)}
                        className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                        style={{
                          borderColor: active ? m.color : 'var(--card-border)',
                          background: active ? `${tint(m.color, 0.06)}` : 'var(--card-bg)',
                          boxShadow: active ? `0 0 0 2px ${tint(m.color, 0.19)}, var(--card-shadow)` : 'var(--card-shadow)',
                        }}
                        aria-pressed={active}>
                        <div className="kpi-icon flex-shrink-0" style={{ background: `${tint(m.color, 0.09)}` }}>
                          {Icon && <Icon size={18} style={{ color: m.color }} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                          <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                          {rsAmt != null && (
                            <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>{fmt(rsAmt)}</p>
                          )}
                        </div>
                        {active && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />}
                      </button>
                    )
                  })}
                </section>
              )}

              {/* ── Overdue alert (currency-aware amounts) ── */}
              {overdue.length > 0 && (
                <section className="rounded-2xl p-4 animate-slide-down"
                  style={{ background: 'color-mix(in srgb, var(--fin-negative) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 16%, transparent)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertOctagon size={14} style={{ color: 'var(--fin-negative)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--fin-negative)' }}>
                      {overdueCount} Overdue — pending more than 30 days
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {overdue.map((inv, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg flex-wrap"
                        style={{ background: 'color-mix(in srgb, var(--fin-negative) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 10%, transparent)' }}>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                          <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                          {inv.currency && inv.currency !== 'RS' && (
                            <span className="text-[10px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{inv.currency}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>
                            {fmtCurrency(inv.amount, inv.currency || 'RS')}
                          </span>
                          <AgingBadge days={inv.aging} status="Pending" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {workspace === 'projects' && canViewProjects && (
            <section>
              <ProjectsWorkspace />
            </section>
          )}

          {workspace === 'tax' && canViewTax && (
            <section>
              <TaxLedger source="web" />
            </section>
          )}

          {workspace === 'retainers' && (
            <section className="card space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                    <span> </span>
                    <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once it has been raised, store the final invoice number and details here.
                  </p>
                </div>
                <div className="relative">
                  <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={retainerMonth} onChange={e => setRetainerMonth(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none w-full" style={{ minWidth: 'min(100%, 170px)', paddingRight: '1.5rem' }}>
                    {retainerMonthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
              </div>

              {retainerGroups.length === 0 ? (
                <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No retainer templates found</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Create a normal invoice and set the category to your retainer category first.
                  </p>
                </div>
              ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="space-y-3">
                  {retainerGroups.map(group => (
                    <button
                      key={group.project}
                      type="button"
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="card p-3">
                          <p className="label">Tracking month</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthLabel(retainerMonth)}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month invoice #</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthRec?.['Invoice Number'] || 'Pending update'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Raised by</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month remark</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{monthRec?.['Remark'] || '—'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="label mb-2">Month Timeline</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                          {group.timeline.map(item => (
                            <button
                              key={item.key}
                              type="button"
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
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="label mb-0">Monthly Records</p>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            Bold month cards with direct record access
                          </span>
                        </div>
                        <div className="space-y-2">
                          {group.timeline.map(item => {
                            const rec = item.record
                            const f = rec?.fields || {}
                            const key = `${item.key}-${group.project}`
                            return (
                              <div key={key} className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                                style={{
                                  background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                  border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                                }}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                    <MonthStatusPill status={item.status} active={item.active} />
                                  </div>
                                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                                    {rec
                                      ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                      : 'No record created for this month yet'}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-wrap flex-shrink-0">
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
                                      {canCreateInvoice && (
                                        <>
                                          <button onClick={() => openRetainerRecordForm(group, item.key)}
                                            className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                            Record raised invoice
                                          </button>
                                          <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                                            className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                                            {busyPause ? 'Pausing…' : 'Pause month'}
                                          </button>
                                        </>
                                      )}
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
                        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
                          <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                            className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                            <ExternalLink size={12} />Open invoice request form
                          </button>
                          {canCreateInvoice && (
                            <>
                              <button onClick={() => openRetainerRecordForm(group, retainerMonth)}
                                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                Record already raised invoice
                              </button>
                              <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                                {busyPause ? 'Pausing…' : 'Pause month'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
              )}
            </section>
          )}

          {workspace === 'invoices' && projectSummaryCards.length > 0 && (
            <section className="card space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Click any project card to filter the invoice list.
                  </p>
                </div>
                {projectFilter && (
                  <button
                    onClick={() => setProjectFilter('')}
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                    <X size={11} />Clear project filter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {projectSummaryCards.map(({ project, metrics }) => {
                  const active = projectFilter === project
                  // Currencies used by this project, RS first
                  const currencies = (metrics.currencies || []).slice().sort((a, b) => a === 'RS' ? -1 : b === 'RS' ? 1 : 0)
                  const byCur = metrics.by_currency || {}
                  const hasMultiCur = currencies.length > 1 || (currencies.length === 1 && currencies[0] !== 'RS')
                  return (
                    <button
                      key={project}
                      type="button"
                      onClick={() => setProjectFilter(active ? '' : project)}
                      className="rounded-xl p-4 text-left transition-all"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                        boxShadow: active ? '0 0 0 2px color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--shadow-sm)',
                      }}>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                            {hasMultiCur && currencies.filter(c => c !== 'RS').map(c => (
                              <span key={c} className="text-[10px] font-bold px-1 py-0.5 rounded"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                        {active && <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />}
                      </div>

                      {/* Per-currency amount rows */}
                      <div className="mt-3 space-y-2">
                        {currencies.length === 0 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                            {['Raised','Received','Open'].map(lbl => (
                              <div key={lbl}><p className="label">{lbl}</p><p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>—</p></div>
                            ))}
                          </div>
                        ) : currencies.map((cur) => {
                          const d = byCur[cur] || { raised: 0, received: 0, outstanding: 0 }
                          return (
                            <div key={cur}>
                              {hasMultiCur && (
                                <p className="text-[10px] font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                  {cur} {currencySymbol(cur)}
                                </p>
                              )}
                              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                                <div>
                                  <p className="label">Raised</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmtCurrency(d.raised, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Received</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(d.received, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Open</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: d.outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>
                                    {fmtCurrency(d.outstanding, cur)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Filter bar + invoice table — only on invoices / retainers tabs.
              The bar stays at the top of the page while the table scrolls. */}
          {(workspace === 'invoices' || workspace === 'retainers') && <div className="invoice-sticky-filters" role="search" aria-label="Search and filter invoices"><div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Invoice Filters</h2>
                <p className="text-xs mt-0.5 inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }} aria-live="polite">
                  {!hasData ? 'Loading…' : `${scopeTotal.toLocaleString('en-IN')} result${scopeTotal !== 1 ? 's' : ''}`}
                  {syncing && hasData && <RefreshCw size={10} className="animate-spin" aria-hidden="true" />}
                </p>
              </div>
              {/* Billing type filter pills */}
              <div className="inline-flex items-center p-0.5 rounded-lg flex-shrink-0" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[140px] sm:min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitSearch() } }}
                  aria-label="Search invoices"
                  placeholder="Search invoice #, project, description…"
                  className="input pl-8 py-1.5 text-xs" />
              </div>
              <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
                className={clsx('btn-icon flex items-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
                style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
                <Filter size={13} /><span className="text-xs">Filters</span>
                {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
              </button>
              {monthFilter && (
                <button onClick={() => setMonthFilter('')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                  {monthLabel(monthFilter)}<X size={10} />
                </button>
              )}
              {hasFilters && (
                <button onClick={clearAll}
                  className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                  <X size={11} />Clear
                </button>
              )}
            </div>

            {showFilters && (
              <div className="filter-expanded-panel flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>
                <FilterSelect
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={picklists.Project || []}
                  placeholder="All projects"
                  icon={User}
                  width={150}
                />
                <FilterSelect
                  value={monthFilter}
                  onChange={setMonthFilter}
                  options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
                  placeholder="All months"
                  icon={CalendarClock}
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
                  icon={CalendarClock}
                  width={160}
                  clearable={false}
                />
                <div className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
                </div>
                <FilterSelect
                  value={agingBandFilter}
                  onChange={setAgingBandFilter}
                  options={['0-14d', '15-30d', '31-60d', '60d+']}
                  placeholder="All aging"
                  icon={AlertOctagon}
                  width={135}
                />
                <FilterSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={picklists.Category || []}
                  placeholder="All categories"
                  icon={Tag}
                  width={155}
                />
                <FilterSelect
                  value={raisedByFilter}
                  onChange={setRaisedByFilter}
                  options={picklists['Raised By'] || []}
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
                <div className="w-full" style={{ borderTop: '1px solid var(--card-border)', margin: '0.25rem 0' }} />
                {/* Advanced filter builder */}
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
          </div></div>}

          {(workspace === 'invoices' || workspace === 'retainers') && <>
          {/* Error */}
          {(errorStatus === 403 || errorStatus === 401) ? (
            <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl text-center"
              style={{ background: 'color-mix(in srgb, var(--fin-negative) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-negative) 15%, transparent)' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'color-mix(in srgb, var(--fin-negative) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={22} style={{ color: 'var(--fin-negative)' }} />
              </div>
              <div>
                <div className="font-semibold text-sm mb-1" style={{ color: 'var(--fin-negative)' }}>Access Restricted</div>
                <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                  You don't have permission to view web invoices.<br />
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
              <AlertTriangle size={13} className="shrink-0" />{error}
              <button onClick={refresh} className="underline ml-1">retry</button>
            </div>
          )}

          {picklistPermissionMsg && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              <span>{picklistPermissionMsg}</span>
            </div>
          )}

          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {loading && !listData
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="card animate-pulse p-3.5">
                    <div className="flex justify-between mb-2.5">
                      <div className="skeleton h-3 w-2/5 rounded" />
                      <div className="skeleton h-5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton h-3 w-3/5 mb-3 rounded" />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                    </div>
                    <div className="flex justify-between mt-2.5">
                      <div className="skeleton h-3 w-1/4 rounded" />
                      <div className="skeleton h-3 w-1/5 rounded" />
                    </div>
                  </div>
                ))
              : records.length === 0
                ? <EmptyState
                    icon={<Receipt size={22} />}
                    title={hasFilters ? 'No invoices match' : 'No invoices found'}
                    subtitle={hasFilters ? 'Nothing matches this search and these filters.' : 'Try adjusting your filters, or create a new invoice to get started.'}
                    action={hasFilters
                      ? <button onClick={clearAll} className="btn-ghost"><X size={13} />Clear filters</button>
                      : canCreateInvoice ? <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button> : null}
                    compact
                  />
                : records.map(r => {
                    const f = r.fields || {}
                    const cur = f['Currency'] || 'RS'
                    const raised = Number(f['Amount Raised'] || 0)
                    const received = Number(f['Amount Received'] || 0)
                    const outstanding = Number(f['Outstanding Amount'] || 0)
                    const refs = parseAttachments(f['Reference'])
                    const pdfs = parseAttachments(f['Invoice PDF'])
                    const allFiles = [...refs, ...pdfs]
                    const aging = effectiveAging(f)
                    return (
                      <button key={r.id} onClick={() => openView(r)}
                        className="card-hover w-full text-left"
                        style={{ padding: '0.875rem 1rem' }}>

                        {/* Row 1: Invoice # + currency badge + status */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || <span style={{ color: 'var(--text-3)' }}>No number</span>}
                            </span>
                            {cur !== 'RS' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {cur}
                              </span>
                            )}
                          </div>
                          <StatusPill status={f['Payment Status']} />
                        </div>

                        {/* Row 2: Project · Category */}
                        <p className="text-[11px] truncate mb-2.5" style={{ color: 'var(--text-3)' }}>
                          <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{f['Project'] || '—'}</span>
                          {f['Category'] ? <span> · {f['Category']}</span> : null}
                          {f['Milestone'] ? <span> · {f['Milestone']}</span> : null}
                        </p>

                        {/* Row 3: Amounts — always show Raised; show Received if > 0; Outstanding in warning */}
                        <div className="grid gap-2 mb-2.5"
                          style={{ gridTemplateColumns: received > 0 && outstanding > 0 ? 'repeat(3,1fr)' : received > 0 || outstanding > 0 ? 'repeat(2,1fr)' : '1fr' }}>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Raised</p>
                            <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
                              {fmtCurrency(raised, cur)}
                            </p>
                          </div>
                          {received > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Received</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-positive)' }}>
                                {fmtCurrency(received, cur)}
                              </p>
                            </div>
                          )}
                          {outstanding > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-warning)' }}>
                                {fmtCurrency(outstanding, cur)}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Row 4: Meta bar — date, raised by, followup, files, aging */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {fmtDate(f['Raised Date'])}
                            </span>
                            {f['Raised By'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={13} />
                              </span>
                            )}
                            {f['Next followup'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] flex-shrink-0"
                                style={{ color: 'var(--fin-warning)' }}>
                                <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {allFiles.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                                <FileText size={10} />{allFiles.length}
                              </span>
                            )}
                            {aging > 0 && <AgingBadge days={aging} status={f['Payment Status']} />}
                          </div>
                        </div>
                      </button>
                    )
                  })
            }
            {showMore && <div className="invoice-mobile-stack">{showMore}</div>}
          </div>

          {/* Desktop table */}
          {/* overflow-clip, not -hidden: `hidden` would make this a scroll
              container and silently defeat the sticky table header. */}
          <div className="hidden md:block card p-0 overflow-clip" style={{ borderRadius: 14 }}>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 1200 }}>
                <thead>
                  <tr>
                    <th className="tbl-head"><SortLabel col="Invoice Number">Invoice #</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Project">Project</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Category">Category</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Milestone">Milestone</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Raised By">Raised By</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Raised Date">Raised</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount Raised">Amount</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount with Tax">GST Total</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount Received">Received</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Outstanding Amount">Outstanding</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Payment Status">Status</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Agening (Days)">Aging</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Next followup">Next Followup</SortLabel></th>
                    <th className="tbl-head">Docs</th>
                    <th className="tbl-head" style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {loading && !listData
                    ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                    : records.length === 0
                      ? <tr><td colSpan={15} className="px-4 py-14 text-center" style={{ color: 'var(--text-3)' }}>
                          <div className="flex flex-col items-center gap-2">
                            <Receipt size={28} style={{ opacity: 0.3 }} />
                            <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{hasFilters ? 'No invoices match' : 'No invoices found'}</p>
                            <p className="text-xs">
                              {hasFilters
                                ? <button onClick={clearAll} style={{ color: 'var(--accent)' }} className="underline">Clear the search and filters</button>
                                : <>Adjust your filters or{' '}
                                  {canCreateInvoice && (
                                    <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline">create one</button>
                                  )}</>}
                            </p>
                          </div>
                        </td></tr>
                      : records.map((r, rowIndex) => {
                          const f = r.fields || {}
                          const outstanding = Number(f['Outstanding Amount'] || 0)
                          const refs = parseAttachments(f['Reference'])
                          const pdfs = parseAttachments(f['Invoice PDF'])
                          const allFiles = [...refs, ...pdfs]
                          const cur = f['Currency'] || 'RS'
                          const isHovered = hoveredRow === r.id
                          const statusMeta = STATUS_META[f['Payment Status']] || {}
                          const accentColor = statusMeta.color || 'var(--accent)'

                          const handleRowEnter = () => {
                            clearTimeout(hoverTimerRef.current)
                            hoverTimerRef.current = setTimeout(() => setHoveredRow(r.id), 250)
                          }
                          const handleRowLeave = () => {
                            clearTimeout(hoverTimerRef.current)
                            hoverTimerRef.current = setTimeout(() => setHoveredRow(null), 150)
                          }

                          return (
                            <Fragment key={r.id}>
                            <tr
                              className={clsx('tbl-row', rowMotion(r) && `ft-row-${rowMotion(r)}`)}
                              style={{
                                cursor: 'pointer',
                                background: isHovered ? 'var(--table-row-hover)' : rowIndex % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)',
                                borderLeft: isHovered ? `3px solid ${accentColor}` : '3px solid transparent',
                                boxShadow: isHovered ? 'var(--table-row-shadow)' : 'none',
                                transition: 'background-color 250ms cubic-bezier(0.4,0,0.2,1), border-color 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms cubic-bezier(0.4,0,0.2,1)',
                              }}
                              onClick={() => openView(r)}
                              onMouseEnter={handleRowEnter}
                              onMouseLeave={handleRowLeave}>
                              <td className="tbl-cell">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</span>
                                  {cur !== 'RS' && (
                                    <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{cur}</span>
                                  )}
                                </div>
                              </td>
                              <td className="tbl-cell"><span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Milestone'] || '—'}</span></td>
                              <td className="tbl-cell">
                                {f['Raised By']
                                  ? <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                      <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtCurrency(f['Amount with Tax'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(f['Amount Received'], cur)}</span></td>
                              <td className="tbl-cell">
                                {outstanding > 0
                                  ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmtCurrency(outstanding, cur)}</span>
                                  : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><StatusPill status={f['Payment Status']} /></td>
                              <td className="tbl-cell"><AgingBadge days={effectiveAging(f)} status={f['Payment Status']} /></td>
                              <td className="tbl-cell">
                                {f['Next followup']
                                  ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                      {fmtDate(f['Next followup'])}
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                {allFiles.length > 0 ? (
                                  <div className="flex items-center gap-1">
                                    {allFiles.slice(0, 2).map((a, i) => <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />)}
                                    {allFiles.length > 2 && <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>+{allFiles.length - 2}</span>}
                                  </div>
                                ) : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-2">
                                  {f['Payment Status'] === 'Pending' && canPayInvoice && (
                                    <button
                                      type="button"
                                      onClick={() => openRecordPayment(r)}
                                      className="btn-primary"
                                      style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem' }}
                                    >
                                      <CheckCircle2 size={12} /><span className="text-[11px] font-semibold">Pay</span>
                                    </button>
                                  )}
                                  <button onClick={() => openView(r)}
                                    className="btn-ghost flex items-center gap-1.5"
                                    style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
                                    <Eye size={12} /><span className="text-[11px] font-semibold">View</span>
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* ── Hover-expand detail row ── */}
                            <tr
                              style={{ background: 'transparent' }}
                              onMouseEnter={handleRowEnter}
                              onMouseLeave={handleRowLeave}>
                              <td colSpan={15} style={{ padding: 0, border: 'none' }}>
                                <div style={{
                                  maxHeight: isHovered ? 320 : 0,
                                  overflow: 'hidden',
                                  transition: 'max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1)',
                                  opacity: isHovered ? 1 : 0,
                                }}>
                                  <div
                                    onClick={() => openView(r)}
                                    style={{
                                      cursor: 'pointer',
                                      margin: '0 0 4px 0',
                                      background: 'var(--glass-bg)',
                                      borderLeft: `3px solid ${accentColor}`,
                                      borderTop: '1px solid var(--glass-border)',
                                      borderBottom: '1px solid var(--glass-border)',
                                    }}>

                                    {/* Section 1: Metrics strip */}
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                                      padding: '10px 20px 10px 18px',
                                      borderBottom: '1px solid var(--glass-border)',
                                      background: `linear-gradient(90deg, ${tint(accentColor, 0.03)} 0%, transparent 60%)`,
                                    }}>
                                      <StatusPill status={f['Payment Status']} />
                                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', fontFamily: 'monospace', marginLeft: 2 }}>
                                        {f['Invoice Number'] || ''}
                                      </span>
                                      {cur !== 'RS' && (
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)' }}>{cur}</span>
                                      )}
                                      <span style={{ width: 1, height: 16, background: 'var(--glass-border)', margin: '0 6px' }} />
                                      {[
                                        { label: 'Raised', value: fmtCurrency(f['Amount Raised'], cur), color: 'var(--text-1)' },
                                        { label: 'Incl. GST', value: fmtCurrency(f['Amount with Tax'], cur), color: 'var(--text-2)' },
                                        { label: 'Received', value: fmtCurrency(f['Amount Received'], cur), color: 'var(--fin-positive)' },
                                        outstanding > 0 ? { label: 'Outstanding', value: fmtCurrency(outstanding, cur), color: 'var(--fin-warning)' } : null,
                                      ].filter(Boolean).map((chip, ci) => (
                                        <span key={chip.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                                          {ci > 0 && <span style={{ color: 'var(--text-3)', fontSize: 10 }}>·</span>}
                                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>{chip.label}</span>
                                          <span style={{ fontSize: 12, color: chip.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{chip.value}</span>
                                        </span>
                                      ))}
                                      <span style={{ marginLeft: 'auto' }}>
                                        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                                      </span>
                                    </div>

                                    {/* Section 2: Two-column body */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

                                      {/* Left: entity fields */}
                                      <div style={{
                                        display: 'flex', flexDirection: 'column', gap: 10,
                                        padding: '12px 20px 12px 18px',
                                        borderRight: '1px solid var(--glass-border)',
                                      }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                                          {[
                                            { label: 'Project', value: f['Project'] },
                                            { label: 'Category', value: f['Category'] },
                                            { label: 'Milestone', value: f['Milestone'] },
                                          ].filter(x => x.value).map(x => (
                                            <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{x.label}</span>
                                              <span style={{ fontSize: 12, color: x.label === 'Project' ? 'var(--text-1)' : 'var(--text-2)', fontWeight: x.label === 'Project' ? 600 : 400, lineHeight: 1.4 }}>{x.value}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {f['Raised By'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised By</span>
                                            <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={18} />
                                          </div>
                                        )}
                                      </div>

                                      {/* Right: text + dates */}
                                      <div style={{
                                        display: 'flex', flexDirection: 'column', gap: 8,
                                        padding: '12px 20px',
                                      }}>
                                        {f['Description'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Description']}</span>
                                          </div>
                                        )}
                                        {f['Remark'] && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Remark</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Remark']}</span>
                                          </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 'auto' }}>
                                          {f['Raised Date'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised</span>
                                              <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Raised Date'])}</span>
                                            </div>
                                          )}
                                          {f['Cleared Date'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cleared</span>
                                              <span style={{ fontSize: 11, color: 'var(--fin-positive)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Cleared Date'])}</span>
                                            </div>
                                          )}
                                          {f['Next followup'] && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                              <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next Followup</span>
                                              <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>{fmtDate(f['Next followup'])}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Section 3: Footer — attachments + actions */}
                                    <div
                                      onClick={e => e.stopPropagation()}
                                      style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '8px 20px 8px 18px',
                                        borderTop: '1px solid var(--glass-border)',
                                        background: 'var(--bg-input)',
                                        gap: 12,
                                      }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {allFiles.length > 0 ? (
                                          <>
                                            {allFiles.slice(0, 5).map((a, i) => (
                                              <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />
                                            ))}
                                            {allFiles.length > 5 && (
                                              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>+{allFiles.length - 5} more</span>
                                            )}
                                          </>
                                        ) : (
                                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No attachments</span>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {f['Payment Status'] === 'Pending' && canPayInvoice && (
                                          <button
                                            onClick={() => openRecordPayment(r)}
                                            className="btn-ghost flex items-center gap-1.5"
                                            style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--fin-positive)', borderColor: 'color-mix(in srgb, var(--fin-positive) 35%, transparent)' }}>
                                            <CheckCircle2 size={11} />
                                            <span style={{ fontSize: 11, fontWeight: 600 }}>Record Payment</span>
                                          </button>
                                        )}
                                        <button
                                          onClick={() => openView(r)}
                                          className="btn-ghost flex items-center gap-1.5"
                                          style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}>
                                          <Eye size={11} />
                                          <span style={{ fontSize: 11, fontWeight: 600 }}>View Details</span>
                                        </button>
                                      </div>
                                    </div>

                                  </div>
                                </div>
                              </td>
                            </tr>
                            </Fragment>
                          )
                        })
                  }
                </tbody>
                {/* One totals row per currency. Rows render in their own
                    Currency, so a single figure across a mixed view added
                    rupees to dollars and then labelled the result in rupees.
                    A single-currency view — the normal case — still shows one
                    line, now with the right symbol. */}
                {currencyTotals.length > 0 && (
                  <tfoot>
                    {currencyTotals.map((t, i) => (
                      <tr key={t.currency}
                        style={{
                          borderTop: i === 0 ? '2px solid var(--border)' : '1px solid var(--border)',
                          background: 'var(--bg-layer)',
                        }}>
                        <td colSpan={6} className="tbl-cell font-semibold text-xs" style={{ color: 'var(--text-2)' }}>
                          Totals{currencyTotals.length > 1 ? ` · ${t.currency}` : ''} · {t.count} invoice{t.count !== 1 ? 's' : ''}
                        </td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--text-1)' }}>{fmtCurrency(t.raised, t.currency)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--text-1)' }}>{fmtCurrency(t.withTax, t.currency)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(t.received, t.currency)}</td>
                        <td className="tbl-cell font-bold tabular-nums text-xs" style={{ color: t.outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmtCurrency(t.outstanding, t.currency)}</td>
                        <td colSpan={5} />
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
            {showMore}
          </div>
          </>}

        </div>
      </main>
      {/* Mobile bottom nav — hidden sm+ */}
      <MobileBottomNav workspace={workspace} setWorkspace={setWorkspace} isAll={isAll} canViewProjects={canViewProjects} canViewTax={canViewTax} />

      {/* Drawers — always rendered so exit animations play */}
      <InvoiceDetail
        key={`detail-${drawerKey}`}
        open={drawer?.mode === 'view'}
        invoice={drawer?.mode === 'view' ? drawer.invoice : null}
        onClose={closeDrawer}
        onEdit={canEditInvoice ? () => { setDrawerKey(k => k + 1); setDrawer({ mode: 'edit', invoice: drawer?.invoice }) } : null}
        onRecordPayment={canPayInvoice ? () => { if (drawer?.invoice) openRecordPayment(drawer.invoice) } : null}
        isEditor={true}
        onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })}
        avatarMap={avatarMap}
      />
      <InvoiceDrawer
        key={`form-${drawerKey}`}
        open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
        invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
        draft={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.draft : null}
        paymentOnly={drawer?.mode === 'payment'}
        onClose={closeDrawer}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        picklists={picklists}
        onOptionsUpdate={handleOptionsUpdate}
        canEditPicklists={canEditPicklists}
        onPicklistPermissionError={handlePicklistPermissionError}
      />
      {helpOpen && createPortal(
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />,
        document.body
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
      </div>
    </div>
  )
}
