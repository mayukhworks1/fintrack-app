import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue, Fragment } from 'react'

import { useSearchParams } from 'react-router-dom'
import { Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle, CheckCircle2, Search, ExternalLink, FileText, ArrowUpDown, Save, Filter, CalendarDays, User, Tag, Eye, IndianRupee, TrendingUp, Percent, CalendarClock, RotateCcw, Paperclip, Download, Columns3 } from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import clsx from 'clsx'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip } from '../components/ExecutiveUI'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'

// ── Extracted modules ─────────────────────────────────────────────────────
import { InvoiceDetail } from './invoices/InvoiceDetail'
import { InvoiceDrawer } from './invoices/InvoiceDrawer'
import { OverdueAlert } from './invoices/OverdueAlert'
import { AgingBadge, AttachThumb, MonthStatusPill, RaisedByBadge, ResizableHead, SkeletonRow, StatusPill } from './invoices/ui'
import { DEFAULT_INVOICE_COLUMN_VISIBILITY, DEFAULT_INVOICE_COLUMN_WIDTHS, INVOICE_COLUMNS, INVOICE_COLUMN_VISIBILITY_STORAGE_KEY, normalizeColumnVisibility, INVOICE_FIELDS, INVOICE_REQUEST_FORM_URL, INVOICE_SHARED_HIGHLIGHTABLE_COLUMNS, INVOICE_SHARE_COLUMNS, STATUS_META, classifyAgingBand, currentMonthKey, dateOnlyValue, effectiveAging, endOfMonthIso, firstDayIso, fmt, fmtDate, invoiceAmountParts, isRetainerCategory, monthKey, monthLabel, parseAttachments, projectInitials, shiftMonthKey, shortMonthLabel, sortByRaisedDateDesc } from './invoices/utils'

/* ── RaisedByBadge ──────────────────────────────────────────────────────── */
export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isEditor, hasPerm } = useAuth()
  // Granular permission flags — these override the coarse isEditor check for email-auth users
  const canCreate  = isEditor && hasPerm('module.invoices.create')
  const canEdit    = isEditor && hasPerm('module.invoices.edit')
  const canDelete  = isEditor && hasPerm('module.invoices.delete')
  const canPayment = isEditor && hasPerm('module.invoices.payment')
  const toast = useToast()
  const initialStatus = searchParams.get('status') || ''
  const initialProject = searchParams.get('project') || ''
  const initialClient = searchParams.get('client') || ''
  const initialQuery = searchParams.get('q') || ''
  const [workspace,       setWorkspace]       = useState('invoices')
  const [selectedRetainer,setSelectedRetainer]= useState('')
  const [retainerMonth,   setRetainerMonth]   = useState(currentMonthKey())
  const [billingFilter,   setBillingFilter]   = useState('all')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [statusFilter,   setStatusFilter]   = useState(initialStatus)
  const [projectFilter,  setProjectFilter]  = useState(initialProject)
  const [clientFilter,   setClientFilter]   = useState(initialClient)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [monthFilter,    setMonthFilter]    = useState('')
  const [agingBandFilter,setAgingBandFilter]= useState('')
  const [dateFieldFilter,setDateFieldFilter]= useState('Raised Date')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [search,         setSearch]         = useState(initialQuery)
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [hasDocsOnly,    setHasDocsOnly]    = useState(false)
  const [followupDueOnly,setFollowupDueOnly]= useState(false)
  const [showFilters,    setShowFilters]    = useState(false)
  const [filterConditions, setFilterConditions] = useState([])
  const [tablePage,      setTablePage]      = useState(0)
  const TABLE_PAGE_SIZE = 50
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [showExportMenu, setShowExportMenu] = useState(false)
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
  const deferredSearch = useDeferredValue(search)
  const resizeRef    = useRef(null)
  const hoverTimerRef = useRef(null)

  useEffect(() => { setStatusFilter(searchParams.get('status') || '') }, [searchParams])
  useEffect(() => { setProjectFilter(searchParams.get('project') || '') }, [searchParams])
  useEffect(() => { setClientFilter(searchParams.get('client') || '') }, [searchParams])
  useEffect(() => { setSearch(searchParams.get('q') || '') }, [searchParams])

  const updateFilterParam = useCallback((key, value) => {
    const next = new URLSearchParams(searchParams)
    const current = searchParams.get(key) || ''
    const target = value || ''
    if (current === target) return
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    updateFilterParam('q', deferredSearch.trim())
  }, [deferredSearch, updateFilterParam])

  /* ── Fetch summary ── */
  const fetchSummary = useCallback((opts = {}) => api.invoices.summary(opts), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 10_000)

  /* ── Fetch ALL records from Teable (no server-side status/project filter) ──
   * Filtering by status/project happens client-side in scopedRecords so that
   * dashboard widgets (Last 3 Months, Recent Projects) always use the full
   * dataset and don't show ₹0 for months that have paid/non-matching invoices. */
  const fetchRecords = useCallback((opts = {}) =>
    api.invoices.list({
      limit:    1000,
      order_by: sortCol,
      order:    sortDir,
      ...opts,
    }), [sortCol, sortDir])

  const { data: listData, loading, error, errorStatus, refresh, syncing } = useAutoRefresh(fetchRecords, 10_000)
  const [recordsState, setRecordsState] = useState([])
  const isStaleData = listData?._stale === true
  useEffect(() => {
    setRecordsState(listData?.records || [])
  }, [listData?.records])
  const allRecords = recordsState

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

  /* ── Dynamic filter/form options — prefer Teable schema, supplement from records ── */
  const projectOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Project'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Project']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords, ...liveProjectNames])].sort()
  }, [invoicePicklists, allRecords, liveProjectNames])

  const clientNameOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Client Name'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Client Name']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const categoryOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Category'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Category']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const milestoneOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Milestone'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Milestone']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const raisedByOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Raised By'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Raised By']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  // Bundle for InvoiceDrawer
  const formOptions = useMemo(() => ({
    projects:    projectOptions,
    clientNames: clientNameOptions,
    categories:  categoryOptions,
    milestones:  milestoneOptions,
    raisedBy:    raisedByOptions,
  }), [projectOptions, clientNameOptions, categoryOptions, milestoneOptions, raisedByOptions])

  /* ── Client-side filter (category, raisedBy, freetext) ── */
  const monthOptions = useMemo(() => (
    [...new Set(
      allRecords
        .map(r => monthKey(r.fields?.['Raised Date']))
        .filter(Boolean)
    )].sort().reverse()
  ), [allRecords])

  const retainerMonthOptions = useMemo(() => (
    [...new Set([currentMonthKey(), ...monthOptions])].sort().reverse()
  ), [monthOptions])

  const retainerGroups = useMemo(() => {
    const retainerRecords = allRecords.filter(r => isRetainerCategory(r.fields?.['Category']))
    const grouped = new Map()
    for (const record of retainerRecords) {
      const project = String(record.fields?.['Project'] || '').trim() || 'Unnamed Retainer'
      if (!grouped.has(project)) grouped.set(project, [])
      grouped.get(project).push(record)
    }
    return [...grouped.entries()].map(([project, items]) => {
      const sorted = sortByRaisedDateDesc(items)
      const latestActive = sorted.find(r => r.fields?.['Payment Status'] !== 'Cancelled') || sorted[0]
      // Build recordByMonth preferring active (non-cancelled) records when a month
      // has multiple invoices (e.g. original cancelled + re-raised paid replacement).
      const recordByMonth = {}
      for (const r of sorted) {
        const key = monthKey(r.fields?.['Raised Date'])
        if (!key) continue
        const existing = recordByMonth[key]
        const thisCancelled = r.fields?.['Payment Status'] === 'Cancelled'
        if (!existing || (existing.fields?.['Payment Status'] === 'Cancelled' && !thisCancelled)) {
          recordByMonth[key] = r
        }
      }
      // For the selected month, prefer the active record over a cancelled one
      const monthRecord =
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth && r.fields?.['Payment Status'] !== 'Cancelled') ||
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth)
      const amount = Number(latestActive?.fields?.['Amount Raised'] || 0)
      const withTax = Number(latestActive?.fields?.['Amount with Tax'] || 0)
      const monthStatus = !monthRecord
        ? 'Missing'
        : monthRecord.fields?.['Payment Status'] === 'Cancelled'
          ? 'Paused'
          : monthRecord.fields?.['Payment Status'] || 'Pending'
      const timelineMonths = Array.from({ length: 8 }, (_, i) => shiftMonthKey(currentMonthKey(), i - 3))
      const timeline = timelineMonths.map((key) => {
        const rec = recordByMonth[key]
        const recStatus = !rec
          ? 'Missing'
          : rec.fields?.['Payment Status'] === 'Cancelled'
            ? 'Paused'
            : rec.fields?.['Payment Status'] === 'Paid'
              ? 'Raised'
              : 'Pending'
        return {
          key,
          label: shortMonthLabel(key),
          fullLabel: monthLabel(key),
          record: rec,
          status: recStatus,
          active: key === retainerMonth,
          current: key === currentMonthKey(),
        }
      })
      const currentTimeline = timeline.find(t => t.current)
      const currentMonthRaised = currentTimeline ? currentTimeline.status !== 'Missing' : false
      let nextDueMonth = currentMonthKey()
      for (let i = 0; i < 12; i++) {
        const key = shiftMonthKey(currentMonthKey(), i)
        const rec = recordByMonth[key]
        const paused = rec?.fields?.['Payment Status'] === 'Cancelled'
        if (!rec || paused) {
          nextDueMonth = paused ? shiftMonthKey(key, 1) : key
          break
        }
        nextDueMonth = shiftMonthKey(key, 1)
      }
      return {
        project,
        records: sorted,
        latestActive,
        recordByMonth,
        monthRecord,
        amount,
        withTax,
        monthStatus,
        timeline,
        currentMonthRaised,
        nextDueMonth,
        raisedBy: latestActive?.fields?.['Raised By'] || '',
        description: latestActive?.fields?.['Description'] || '',
      }
    }).sort((a, b) => a.project.localeCompare(b.project))
  }, [allRecords, retainerMonth])

  useEffect(() => {
    if (!retainerGroups.length) { setSelectedRetainer(''); return }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null

  const todayIso = new Date().toISOString().slice(0, 10)

  const scopedRecords = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return allRecords.filter((r) => {
      const f = r.fields || {}
      // Server-side filters moved client-side (API now fetches all records)
      if (statusFilter && f['Payment Status'] !== statusFilter) return false
      if (projectFilter && f['Project'] !== projectFilter) return false
      if (clientFilter && (f['Client Name'] || f['Client']) !== clientFilter) return false
      if (billingFilter === 'retainer' && !isRetainerCategory(f['Category'])) return false
      if (billingFilter === 'project' && isRetainerCategory(f['Category'])) return false
      if (categoryFilter && f['Category'] !== categoryFilter) return false
      if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
      if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
      if (dateFrom || dateTo) {
        const candidate = dateOnlyValue(f[dateFieldFilter])
        if (!candidate) return false
        if (dateFrom && candidate < dateFrom) return false
        if (dateTo && candidate > dateTo) return false
      }
      if (overdueOnly && !(f['Payment Status'] === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
      if (followupDueOnly) {
        const raw = f['Next followup']
        if (!raw) return false
        const nextFollowup = String(raw).slice(0, 10)
        if (nextFollowup > todayIso) return false
      }
      if (hasDocsOnly) {
        const refs = parseAttachments(f['Reference'])
        const pdfs = parseAttachments(f['Invoice PDF'])
        if (refs.length + pdfs.length === 0) return false
      }
      if (agingBandFilter) {
        if (f['Payment Status'] !== 'Pending') return false
        const band = classifyAgingBand(effectiveAging(f))
        if (band !== agingBandFilter) return false
      }
      if (!q) return true
      return (
        (f['Invoice Number'] || '').toLowerCase().includes(q) ||
        (f['Client Name']    || '').toLowerCase().includes(q) ||
        (f['Client']         || '').toLowerCase().includes(q) ||
        (f['Project']        || '').toLowerCase().includes(q) ||
        (f['Description']    || '').toLowerCase().includes(q) ||
        (f['Category']       || '').toLowerCase().includes(q) ||
        (f['Milestone']      || '').toLowerCase().includes(q)
      )
    })
  }, [
    allRecords,
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    deferredSearch,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    statusFilter,
    todayIso,
  ])

  const records = useMemo(
    () => applyConditions(scopedRecords, filterConditions, r => r.fields ?? {}),
    [filterConditions, scopedRecords]
  )
  // Reset to page 0 whenever the filtered set changes
  useEffect(() => { setTablePage(0) }, [records])

  const s = summary
  const agingBuckets = useMemo(() => {
    const buckets = {
      '0-14d':  { count: 0, amount: 0 },
      '15-30d': { count: 0, amount: 0 },
      '31-60d': { count: 0, amount: 0 },
      '60d+':   { count: 0, amount: 0 },
    }
    for (const r of scopedRecords) {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Pending') continue
      const band = classifyAgingBand(effectiveAging(f))
      buckets[band].count += 1
      buckets[band].amount += Number(f['Amount Raised'] || 0)
    }
    return buckets
  }, [scopedRecords])
  const overdue = s?.overdue_invoices || []
  const activeConditions = filterConditions.filter(c => c.field && c.op && (c.value !== '' || ['is_empty','is_not_empty'].includes(c.op)))
  const hasFilters = statusFilter || projectFilter || clientFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0

  const clearAllFilters = useCallback(() => {
    setStatusFilter('')
    updateFilterParam('status', '')
    setProjectFilter('')
    updateFilterParam('project', '')
    setClientFilter('')
    updateFilterParam('client', '')
    setCategoryFilter('')
    setRaisedByFilter('')
    setMonthFilter('')
    setDateFieldFilter('Raised Date')
    setDateFrom('')
    setDateTo('')
    setAgingBandFilter('')
    setBillingFilter('all')
    setOverdueOnly(false)
    setHasDocsOnly(false)
    setFollowupDueOnly(false)
    setSearch('')
    setFilterConditions([])
  }, [updateFilterParam])

  const activeFilterChips = useMemo(() => {
    const chips = []
    if (search) chips.push({ key: 'search', label: `Search: ${search}`, onClear: () => setSearch('') })
    if (statusFilter) chips.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => { setStatusFilter(''); updateFilterParam('status', '') } })
    if (projectFilter) chips.push({ key: 'project', label: `Project: ${projectFilter}`, onClear: () => { setProjectFilter(''); updateFilterParam('project', '') } })
    if (clientFilter) chips.push({ key: 'client', label: `Client: ${clientFilter}`, onClear: () => { setClientFilter(''); updateFilterParam('client', '') } })
    if (categoryFilter) chips.push({ key: 'category', label: `Category: ${categoryFilter}`, onClear: () => setCategoryFilter('') })
    if (raisedByFilter) chips.push({ key: 'raised_by', label: `Owner: ${raisedByFilter}`, onClear: () => setRaisedByFilter('') })
    if (billingFilter !== 'all') chips.push({ key: 'billing', label: `Billing: ${billingFilter === 'retainer' ? 'Retainers' : 'Projects'}`, onClear: () => setBillingFilter('all') })
    if (monthFilter) chips.push({ key: 'month', label: `Raised: ${monthLabel(monthFilter)}`, onClear: () => setMonthFilter('') })
    if (dateFrom || dateTo) chips.push({ key: 'date', label: `${dateFieldFilter}: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`, onClear: () => { setDateFrom(''); setDateTo(''); setDateFieldFilter('Raised Date') } })
    if (agingBandFilter) chips.push({ key: 'aging', label: `Aging: ${agingBandFilter}`, onClear: () => setAgingBandFilter('') })
    if (overdueOnly) chips.push({ key: 'overdue', label: 'Open collections', onClear: () => setOverdueOnly(false) })
    if (hasDocsOnly) chips.push({ key: 'docs', label: 'Has documents', onClear: () => setHasDocsOnly(false) })
    if (followupDueOnly) chips.push({ key: 'followup', label: 'Follow-up due', onClear: () => setFollowupDueOnly(false) })
    if (activeConditions.length) chips.push({ key: 'advanced', label: `${activeConditions.length} advanced rule${activeConditions.length !== 1 ? 's' : ''}`, onClear: () => setFilterConditions([]) })
    return chips
  }, [
    activeConditions.length,
    agingBandFilter,
    billingFilter,
    categoryFilter,
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
    statusFilter,
    updateFilterParam,
  ])

  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [s])
  const raisedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Raised Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const clearedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Cleared Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Received'] || record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const lastThreeMonthBalance = useMemo(() => {
    const current = currentMonthKey()
    const keys = Array.from({ length: balanceMonths }, (_, i) => shiftMonthKey(current, -(balanceMonths - 1 - i)))
    // Use allRecords (not scopedRecords) so this widget always shows complete
    // monthly totals regardless of any status/project/category filter the user
    // has active on the table view.
    return keys.map((key, index) => {
      let base = 0
      let gross = 0
      let gst = 0
      let received = 0
      let deduction = 0
      let outstanding = 0
      let invoiceCount = 0
      for (const record of allRecords) {
        const fields = record.fields || {}
        if (monthKey(fields['Raised Date']) === key) {
          const parts = invoiceAmountParts(fields)
          base += parts.base
          gross += parts.gross
          gst += parts.gst
          received += parts.received
          deduction += parts.deduction
          outstanding += parts.outstanding
          invoiceCount += 1
        }
      }
      const previous = index > 0 ? keys[index - 1] : ''
      let previousGross = 0
      if (previous) {
        for (const record of allRecords) {
          const fields = record.fields || {}
          if (monthKey(fields['Raised Date']) === previous) previousGross += invoiceAmountParts(fields).gross
        }
      }
      const change = previous && previousGross
        ? ((gross - previousGross) / Math.abs(previousGross)) * 100
        : null
      const collectionRate = gross > 0 ? Math.min(100, Math.max(0, (received / gross) * 100)) : 0
      return { key, label: shortMonthLabel(key), base, gross, gst, received, deduction, outstanding, invoiceCount, collectionRate, change }
    })
  }, [allRecords, balanceMonths])
  const maxMonthlyBalanceMagnitude = useMemo(
    () => Math.max(1, ...lastThreeMonthBalance.map((entry) => entry.gross)),
    [lastThreeMonthBalance]
  )
  const recentProjectCards = useMemo(() => {
    // Use allRecords so "Recent Projects" always shows all-time project totals
    // regardless of any status/date/category filter active on the table.
    const buckets = new Map()
    for (const record of allRecords) {
      const fields = record.fields || {}
      const project = fields.Project || 'Unassigned'
      const current = buckets.get(project) || { project, base: 0, gross: 0, gst: 0, received: 0, deduction: 0, outstanding: 0, count: 0 }
      const parts = invoiceAmountParts(fields)
      current.base += parts.base
      current.gross += parts.gross
      current.gst += parts.gst
      current.received += parts.received
      current.deduction += parts.deduction
      current.outstanding += parts.outstanding
      current.count += 1
      buckets.set(project, current)
    }
    return [...buckets.values()]
      .map((entry) => ({
        ...entry,
        progress: entry.gross > 0 ? Math.max(0, Math.min(100, Math.round((entry.received / entry.gross) * 100))) : 0,
      }))
      .sort((a, b) => (b.outstanding - a.outstanding) || (b.gross - a.gross))
      .slice(0, 4)
  }, [allRecords])
  const followupsDueCount = useMemo(
    () => records.filter((r) => {
      const raw = r.fields?.['Next followup']
      return raw && String(raw).slice(0, 10) <= todayIso
    }).length,
    [records, todayIso]
  )
  const missingDocsCount = useMemo(
    () => records.filter((r) => parseAttachments(r.fields?.['Reference']).length + parseAttachments(r.fields?.['Invoice PDF']).length === 0).length,
    [records]
  )
  const pendingCount = s?.by_status?.Pending || 0
  const currentScopeOutstanding = useMemo(
    () => records.reduce((sum, r) => sum + Number(r.fields?.['Outstanding Amount'] || 0), 0),
    [records]
  )
  const applyMonthDrilldown = useCallback((field, key) => {
    setDateFieldFilter(field)
    setDateFrom(`${key}-01`)
    setDateTo(endOfMonthIso(key))
    setMonthFilter(field === 'Raised Date' ? key : '')
  }, [])

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
        amount_raised: isPause ? 0 : Number(base['Amount Raised'] || 0),
        amount_with_tax: isPause ? 0 : Number(base['Amount with Tax'] || 0),
        amount_received: isPause ? 0 : undefined,
        payment_status: isPause ? 'Cancelled' : 'Pending',
        remark: isPause
          ? `Paused for ${monthName}. Reason: ${(pauseReason || 'Not specified').trim()}`
          : `Recurring retainer for ${monthName}. Invoice number to be updated.`,
      }
      await api.invoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
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
  const openView    = r  => setDrawer({ mode: 'view', invoice: r   })

  function exportCsv(useFiltered) {
    const CSV_FIELDS = [
      'Invoice Number', 'Raised Date', 'Project', 'Client', 'Category', 'Payment Status',
      'Raised By', 'Milestone', 'Currency', 'Amount Raised', 'Amount with Tax',
      'Amount Received', 'Outstanding Amount', 'Cleared Date', 'Remark',
    ]
    const escape = (v) => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const data = useFiltered ? records : allRecords
    const header = CSV_FIELDS.join(',')
    const body = data.map(r => {
      const f = r.fields || {}
      return CSV_FIELDS.map(k => escape(f[k])).join(',')
    }).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices_${useFiltered ? 'filtered_' : ''}${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
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
  const openRecordPayment = r => setDrawer({
    mode: 'payment',
    invoice: r,
    prefill: {
      payment_status: 'Paid',
      amount_received: r?.fields?.['Amount Raised'] ?? '',
      cleared_date: new Date().toISOString().slice(0, 10),
      reference: Array.isArray(r?.fields?.['Reference']) ? r.fields['Reference'] : [],
      remark: r?.fields?.['Remark'] || '',
    },
  })
  const closeDrawer = () => setDrawer(null)
  const handleSaved = (savedRecord) => {
    if (savedRecord?.id) {
      setRecordsState((prev) => {
        const idx = prev.findIndex((row) => row.id === savedRecord.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = savedRecord
          return next
        }
        return [savedRecord, ...prev]
      })
    }
    refresh()
    closeDrawer()
  }
  const handleDeleted = (deletedId) => {
    if (deletedId) setRecordsState((prev) => prev.filter((row) => row.id !== deletedId))
    refresh()
    closeDrawer()
  }

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

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // Persist the column choice so it survives a reload. Storage being
  // unavailable (private mode, quota) must not break the table.
  useEffect(() => {
    try {
      localStorage.setItem(INVOICE_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility))
    } catch { /* non-fatal — the choice just won't outlive this session */ }
  }, [columnVisibility])

  const visibleColumnCount = INVOICE_COLUMNS.filter(c => columnVisibility[c.key]).length

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
            <ExecutiveChip accent>{allRecords.length} live invoice{allRecords.length !== 1 ? 's' : ''}</ExecutiveChip>
            <ExecutiveChip>{syncing ? 'syncing…' : 'mirror-fast · Teable-backed'}</ExecutiveChip>
            {hasFilters && <ExecutiveChip>{records.length} in current scope</ExecutiveChip>}
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
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
            </button>
            <div className="relative">
              <button onClick={() => setShowExportMenu(m => !m)} className="btn-ghost" title="Download invoices as CSV">
                <Download size={14} />Export CSV<ChevronDown size={11} />
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-lg border py-1 min-w-[190px]"
                    style={{ background: 'var(--surface-1)', borderColor: 'var(--border-soft)' }}>
                    <button onClick={() => exportCsv(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                      <Download size={13} />Filtered ({records.length})
                    </button>
                    <button onClick={() => exportCsv(false)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-2)] text-left">
                      <Download size={13} />All records ({allRecords.length})
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
        {/* Stale data banner — shown when Teable is unreachable and PG mirror is served */}
        {isStaleData && (
          <div className="flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#92400e' }}>
            <AlertTriangle size={14} style={{ color: '#ca8a04', flexShrink: 0 }} />
            <span><strong>Live data unavailable.</strong> Showing cached data from the local mirror — figures may be a few minutes behind. <button onClick={refresh} className="underline font-medium ml-1" style={{ color: '#92400e' }}>Try refreshing</button></span>
          </div>
        )}

        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard label="Total raised" value={sumLoading && !s ? '—' : fmt(s?.total_raised)} icon={IndianRupee} />
          <ExecutiveStatCard label="Incl. GST" value={sumLoading && !s ? '—' : fmt(s?.total_with_tax)} icon={Receipt} />
          <ExecutiveStatCard label="Collected" value={sumLoading && !s ? '—' : fmt(s?.total_received)} sub={s ? `${s?.by_status?.Paid || 0} paid invoices` : ''} accent="positive" icon={TrendingUp} />
          <ExecutiveStatCard label="Outstanding" value={sumLoading && !s ? '—' : fmt(s?.total_outstanding)} sub={`${s?.by_status?.Pending || 0} pending invoices`} accent={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'} icon={CalendarClock} />
          <ExecutiveStatCard
            label="Collection rate"
            value={sumLoading && !s ? '—' : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
            sub={s ? `${s?.active_invoices || 0} active invoices in scope` : ''}
            accent={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
            icon={Percent}
          />
        </ExecutiveStatGrid>
      </ExecutiveHero>

      {/* ── Invoice activity chart ── */}
      {allRecords.length > 0 && (() => {
        const PRESETS = [
          { key: '30d',  label: '30d',     days: 30 },
          { key: '60d',  label: '60d',     days: 60 },
          { key: '3m',   label: '3 mo',    days: 90 },
          { key: '6m',   label: '6 mo',    days: 180 },
          { key: '1y',   label: '1 yr',    days: 365 },
          { key: 'custom', label: 'Custom', days: null },
        ]
        const activePreset = PRESETS.find(p => p.key === chartPreset) || PRESETS[1]
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
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />paid&nbsp;
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#fb7185' }} />overdue&nbsp;
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />pending
                  </span>
                </p>
              </div>
              {/* ── Date range controls ── */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Preset chips */}
                <div className="inline-flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  {PRESETS.map(p => (
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
              records={allRecords}
              days={chartDaysProp}
              from={chartFromProp}
              to={chartToProp}
              className="px-2 pb-1"
              avatarMap={avatarMap}
              onInvoiceClick={id => {
                const rec = allRecords.find(r => r.id === id)
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
                setFollowupDueOnly(true)
                setOverdueOnly(false)
                setAgingBandFilter('')
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: followupDueOnly ? 'var(--accent)' : undefined }}
            >
              <CalendarDays size={12} />Follow-ups due
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setOverdueOnly(true)
                setFollowupDueOnly(false)
                setAgingBandFilter('31-60d')
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
                : isDanger  ? 'rgba(216,95,88,0.06)'
                : isWarning ? 'rgba(202,127,20,0.06)'
                : 'var(--bg-input)'
              const border = active
                ? 'var(--accent)'
                : isDanger  ? 'rgba(216,95,88,0.20)'
                : isWarning ? 'rgba(202,127,20,0.20)'
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
                  onClick={() => { setProjectFilter(''); updateFilterParam('project', '') }}
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
                      const next = active ? '' : entry.project
                      setProjectFilter(next)
                      updateFilterParam('project', next)
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
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section className="status-card-grid">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
            const Icon = m.icon
            const active = statusFilter === status
            const amount = s?.by_status_amounts?.[status]
            return (
              <button key={status}
                onClick={() => {
                  const next = active ? '' : status
                  setStatusFilter(next)
                  updateFilterParam('status', next)
                }}
                className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                style={{
                  borderColor: active ? m.color : 'var(--card-border)',
                  background: active ? `${m.color}10` : 'var(--card-bg)',
                  boxShadow: active ? `0 0 0 2px ${m.color}30, var(--card-shadow)` : 'var(--card-shadow)',
                }}
                aria-pressed={active}>
                {/* Icon tile */}
                <div className="kpi-icon flex-shrink-0"
                  style={{ background: `${m.color}18` }}>
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
      {overdue.length > 0 && <OverdueAlert overdue={overdue} allRecords={allRecords} onViewAll={() => setOverdueOnly(true)} onOpenInvoice={(invNo) => { const rec = allRecords.find(r => (r.fields?.['Invoice Number'] || r['Invoice Number']) === invNo); if (rec) openView(rec) }} />}

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
                      boxShadow: selectedRetainer === group.project ? '0 0 0 2px rgba(37,99,235,0.10)' : 'none',
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
                const busyCreate = retainerActionBusy === `create:${group.project}:${retainerMonth}`
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
                              boxShadow: item.active ? '0 0 0 2px rgba(37,99,235,0.12)' : 'none',
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
              <button onClick={() => { setProjectFilter(''); updateFilterParam('project', '') }}
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
                  onClick={() => {
                    const next = active ? '' : project
                    setProjectFilter(next)
                    updateFilterParam('project', next)
                  }}
                  className="rounded-xl p-4 text-left transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.10)' : 'var(--shadow-sm)',
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
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      )}

      {/* ── Filter bar ── */}
      <ExecutivePanel title="Filters and search" subtitle="Owner, overdue band, month, category, docs, and advanced rules follow one unified filter pattern.">
        <div className="space-y-2">
        <ExecutiveFilterBar className="executive-filter-bar-toolbar">
          <div className="executive-search relative flex-1 min-w-[140px] sm:min-w-[220px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={e => {
              setSearch(e.target.value)
            }}
              placeholder="Search invoice #, project, description…"
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
          <ExecutiveChip accent>{records.length} result{records.length !== 1 ? 's' : ''}</ExecutiveChip>
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

        <div className="invoice-scope-strip" aria-label="Current invoice scope">
          <div>
            <span>Scope</span>
            <strong>{records.length}</strong>
            <small>of {allRecords.length} invoices</small>
          </div>
          <div>
            <span>Open</span>
            <strong style={{ color: currentScopeOutstanding ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmt(currentScopeOutstanding)}</strong>
            <small>{records.filter(r => r.fields?.['Payment Status'] === 'Pending').length} pending</small>
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
            {/* Project — server-side */}
            <FilterSelect
              value={clientFilter}
              onChange={(value) => {
                setClientFilter(value)
                updateFilterParam('client', value)
              }}
              options={clientNameOptions}
              placeholder="All clients"
              icon={User}
              width={150}
            />
            <FilterSelect
              value={projectFilter}
              onChange={(value) => {
                setProjectFilter(value)
                updateFilterParam('project', value)
              }}
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
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
            </div>
            <FilterSelect
              value={agingBandFilter}
              onChange={setAgingBandFilter}
              options={Object.keys(agingBuckets).map(bucket => ({ value: bucket, label: bucket }))}
              placeholder="All aging"
              icon={CalendarClock}
              width={135}
            />
            {/* Category — client-side */}
            <FilterSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              placeholder="All categories"
              icon={Tag}
              width={155}
            />
            {/* Raised By — client-side */}
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
            {/* Advanced filter builder */}
            <div className="w-full">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Advanced filters
              </p>
              <FilterBuilder
                fields={INVOICE_FIELDS}
                records={allRecords}
                getFieldValue={r => r.fields ?? {}}
                conditions={filterConditions}
                onChange={setFilterConditions}
                label="Add condition"
              />
            </div>
          </div>
        )}
      </div>
      </ExecutivePanel>

      {/* ── Error ── */}
      {(errorStatus === 403 || errorStatus === 401) ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl text-center"
          style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(248,113,113,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={22} style={{ color: '#f87171' }} />
          </div>
          <div>
            <div className="font-semibold text-sm mb-1" style={{ color: '#f87171' }}>Access Restricted</div>
            <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
              You don't have permission to view invoices.<br />
              Please contact your administrator to request access.
            </div>
            <button onClick={refresh} className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: 'none', cursor: 'pointer', transition: 'background-color 150ms' }}
              onMouseEnter={e => e.target.style.background = 'rgba(248,113,113,0.22)'}
              onMouseLeave={e => e.target.style.background = 'rgba(248,113,113,0.15)'}>
              Refresh
            </button>
          </div>
        </div>
      ) : error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
          style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
          <AlertTriangle size={13} className="shrink-0" />
          {error}
          {/not found/i.test(error) && <span style={{ color: 'var(--text-3)' }}>— backend is deploying, auto-retrying</span>}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── Mobile card list (sm-down) ── */}
      <div className="invoice-mobile-stack md:hidden">
        {loading && !listData
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="skeleton h-3 w-2/5 mb-3 rounded" />
                <div className="skeleton h-5 w-3/5 rounded" />
              </div>
            ))
          : records.length === 0
            ? <EmptyState
                icon={<Receipt size={22} />}
                title="No invoices found"
                subtitle="Adjust your filters or create your first invoice to get started."
                action={canCreate && <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
                compact
              />
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
            <p>{records.length} invoices in view</p>
            {/* Only worth a second line when a filter is actually narrowing the
                set — otherwise it just repeats the count above it. */}
            <span>{
              syncing               ? 'Refreshing mirror data...'
              : records.length < allRecords.length
                                    ? `Filtered from ${allRecords.length} loaded invoices`
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
              {loading && !listData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={visibleColumnCount}>
                      <EmptyState
                        icon={<Receipt size={22} />}
                        title="No invoices found"
                        subtitle="Adjust your filters or create your first invoice."
                        action={canCreate && <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
                        compact
                      />
                    </td></tr>
                  : records.slice(tablePage * TABLE_PAGE_SIZE, (tablePage + 1) * TABLE_PAGE_SIZE).map((r, rowIndex) => {
                      const globalIndex = tablePage * TABLE_PAGE_SIZE + rowIndex
                      const f = r.fields || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      const refs = parseAttachments(f['Reference'])
                      const pdfs = parseAttachments(f['Invoice PDF'])
                      const allFiles = [...refs, ...pdfs]
                      const isHovered = hoveredRow === r.id
                      const statusMeta = STATUS_META[f['Payment Status']] || {}
                      const accentColor = statusMeta.color || 'var(--accent)'
                      // Client and Project frequently hold the same name (a
                      // retainer billed under the client's own name). Repeating
                      // it in adjacent columns is noise, so the Project cell
                      // shows only the description in that case.
                      const clientLabel = f['Client Name'] || f['Client'] || ''
                      const projectLabel = f['Project'] || ''
                      const projectSameAsClient =
                        !!clientLabel && !!projectLabel &&
                        clientLabel.trim().toLowerCase() === projectLabel.trim().toLowerCase()

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
                          className="tbl-row"
                          style={{
                            cursor: 'pointer',
                            background: isHovered ? 'var(--table-row-hover)' : globalIndex % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)',
                            borderLeft: isHovered ? `3px solid ${accentColor}` : '3px solid transparent',
                            boxShadow: isHovered ? 'var(--table-row-shadow)' : 'none',
                            transition: 'background-color 250ms cubic-bezier(0.4,0,0.2,1), border-color 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms cubic-bezier(0.4,0,0.2,1)',
                          }}
                          onClick={() => openView(r)}
                          onMouseEnter={handleRowEnter}
                          onMouseLeave={handleRowLeave}>

                          <td className="tbl-cell" style={{ width: columnWidths.row }}>
                            <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {globalIndex + 1}
                            </span>
                          </td>

                          {columnVisibility.invoice_number && (
                            <td className="tbl-cell" style={{ width: columnWidths.invoice_number }}>
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || '—'}
                            </span>
                          </td>
                          )}
                          {columnVisibility.payment_status && (
                            <td className="tbl-cell" style={{ width: columnWidths.payment_status }}>
                            <StatusPill status={f['Payment Status']} />
                          </td>
                          )}
                          {columnVisibility.amount_raised && (
                            <td className="tbl-cell" style={{ width: columnWidths.amount_raised, textAlign: 'right' }}>
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>
                              {fmt(f['Amount Raised'])}
                            </span>
                          </td>
                          )}
                          {columnVisibility.aging && (
                            <td className="tbl-cell" style={{ width: columnWidths.aging }}>
                            <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                          </td>
                          )}
                          {columnVisibility.client_name && (
                            <td className="tbl-cell align-top" style={{ width: columnWidths.client_name }}>
                            <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Client Name'] || f['Client'] || '—'}</span>
                          </td>
                          )}
                          {columnVisibility.project && (
                            <td className="tbl-cell align-top" style={{ width: columnWidths.project }}>
                            <div className="min-w-0">
                              {/* Suppressed only when the Client column is on
                                  screen to show it — otherwise the name would
                                  disappear from the row entirely. */}
                              {!(projectSameAsClient && columnVisibility.client_name) && (
                                <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{projectLabel || '—'}</span>
                              )}
                              {f['Description'] && (
                                <span className="block text-[11px] mt-1" style={{ color: 'var(--text-3)', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.5 }}>
                                  {f['Description']}
                                </span>
                              )}
                              {/* A row with neither a name nor a description
                                  still needs a placeholder to read as empty. */}
                              {projectSameAsClient && columnVisibility.client_name && !f['Description'] && (
                                <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
                              )}
                            </div>
                          </td>
                          )}
                          {columnVisibility.raised_date && (
                            <td className="tbl-cell" style={{ width: columnWidths.raised_date }}>
                            <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
                          </td>
                          )}
                          {columnVisibility.outstanding_amount && (
                            <td className="tbl-cell" style={{ width: columnWidths.outstanding_amount, textAlign: 'right' }}>
                            {outstanding > 0
                              ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</span>
                              : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          )}
                          {columnVisibility.amount_received && (
                            <td className="tbl-cell" style={{ width: columnWidths.amount_received, textAlign: 'right' }}>
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>
                              {fmt(f['Amount Received'])}
                            </span>
                          </td>
                          )}
                          {columnVisibility.amount_with_tax && (
                            <td className="tbl-cell" style={{ width: columnWidths.amount_with_tax, textAlign: 'right' }}>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
                              {fmt(f['Amount with Tax'])}
                            </span>
                          </td>
                          )}
                          {columnVisibility.category && (
                            <td className="tbl-cell" style={{ width: columnWidths.category }}>
                            <span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Category'] || '—'}</span>
                          </td>
                          )}
                          {columnVisibility.milestone && (
                            <td className="tbl-cell" style={{ width: columnWidths.milestone }}><span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Milestone'] || '—'}</span></td>
                          )}
                          {columnVisibility.raised_by && (
                            <td className="tbl-cell min-w-0" style={{ width: columnWidths.raised_by, overflow: 'hidden' }}>
                            {f['Raised By']
                              ? <span className="inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" title={f['Raised By']} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                  <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          )}
                          {columnVisibility.next_followup && (
                            <td className="tbl-cell" style={{ width: columnWidths.next_followup }}>
                            {f['Next followup']
                              ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          )}

                          {/* Attachment thumbs */}
                          {columnVisibility.docs && (
                          <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.docs }}>
                            {allFiles.length > 0 ? (
                              <div className="flex items-center gap-1">
                                {allFiles.slice(0, 2).map((a, i) => (
                                  <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />
                                ))}
                                {allFiles.length > 2 && (
                                  <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>
                                    +{allFiles.length - 2}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
                            )}
                          </td>
                          )}

                          {/* View action */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.actions }}>
                            <div className="flex flex-wrap gap-2">
                              {canPayment && f["Payment Status"] === "Pending" && (
                                <button
                                  onClick={() => openRecordPayment(r)}
                                  className="btn-ghost flex items-center gap-1.5"
                                  style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--fin-positive)', borderColor: 'rgba(34,197,94,0.3)' }}
                                  aria-label={`Record payment for ${f['Invoice Number']}`}>
                                  <CheckCircle2 size={12} />
                                  <span className="text-[11px] font-semibold">Pay</span>
                                </button>
                              )}
                              <button
                                onClick={() => openView(r)}
                                className="btn-ghost flex items-center gap-1.5"
                                style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}
                                aria-label={`View ${f['Invoice Number']}`}>
                                <Eye size={12} />
                                <span className="text-[11px] font-semibold">View</span>
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* ── Hover-expand detail row ── */}
                        <tr
                          style={{ background: 'transparent' }}
                          onMouseEnter={handleRowEnter}
                          onMouseLeave={handleRowLeave}>
                          <td colSpan={visibleColumnCount} style={{ padding: 0, border: 'none' }}>
                            <div style={{
                              maxHeight: isHovered ? 320 : 0,
                              overflow: 'hidden',
                              transition: `max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1)`,
                              opacity: isHovered ? 1 : 0,
                            }}>
                              {/* card */}
                              <div
                                onClick={() => openView(r)}
                                style={{
                                  cursor: 'pointer',
                                  margin: '0 0 4px 0',
                                  background: 'var(--glass-bg)',
                                  borderLeft: `3px solid ${accentColor}`,
                                  borderTop: `1px solid var(--glass-border)`,
                                  borderBottom: `1px solid var(--glass-border)`,
                                }}>

                                {/* ── Section 1: Metrics strip ── */}
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                                  padding: '10px 20px 10px 18px',
                                  borderBottom: '1px solid var(--glass-border)',
                                  background: `linear-gradient(90deg, ${accentColor}08 0%, transparent 60%)`,
                                }}>
                                  <StatusPill status={f['Payment Status']} />
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', fontFamily: 'monospace', marginLeft: 2 }}>
                                    {f['Invoice Number'] || ''}
                                  </span>
                                  <span style={{ width: 1, height: 16, background: 'var(--glass-border)', margin: '0 6px' }} />
                                  {[
                                    { label: 'Raised', value: fmt(f['Amount Raised']), color: 'var(--text-1)' },
                                    { label: 'Incl. GST', value: fmt(f['Amount with Tax']), color: 'var(--text-2)' },
                                    { label: 'Received', value: fmt(f['Amount Received']), color: 'var(--fin-positive)' },
                                    outstanding > 0 ? { label: 'Outstanding', value: fmt(outstanding), color: 'var(--fin-warning)' } : null,
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

                                {/* ── Section 2: Two-column body ── */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

                                  {/* Left: entity fields */}
                                  <div style={{
                                    display: 'flex', flexDirection: 'column', gap: 10,
                                    padding: '12px 20px 12px 18px',
                                    borderRight: '1px solid var(--glass-border)',
                                  }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                                      {[
                                        { label: 'Client', value: f['Client Name'] || f['Client'] },
                                        { label: 'Project', value: f['Project'] },
                                        { label: 'Category', value: f['Category'] },
                                        { label: 'Milestone', value: f['Milestone'] },
                                      ].filter(x => x.value).map(x => (
                                        <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
                                          <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{x.label}</span>
                                          <span style={{ fontSize: 12, color: x.label === 'Client' || x.label === 'Project' ? 'var(--text-1)' : 'var(--text-2)', fontWeight: x.label === 'Client' || x.label === 'Project' ? 600 : 400, lineHeight: 1.4 }}>{x.value}</span>
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

                                {/* ── Section 3: Footer — attachments + actions ── */}
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
                                    {canPayment && f["Payment Status"] === "Pending" && (
                                      <button
                                        onClick={() => openRecordPayment(r)}
                                        className="btn-ghost flex items-center gap-1.5"
                                        style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--fin-positive)', borderColor: 'rgba(34,197,94,0.35)' }}>
                                        <CheckCircle2 size={11} />
                                        <span style={{ fontSize: 11, fontWeight: 600 }}>Record Payment</span>
                                      </button>
                                    )}
                                    {canEdit && (
                                      <button
                                        onClick={() => setDrawer({ mode: 'edit', invoice: r })}
                                        className="btn-ghost flex items-center gap-1.5"
                                        style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--text-2)', borderColor: 'var(--glass-border)' }}>
                                        <Save size={11} />
                                        <span style={{ fontSize: 11, fontWeight: 600 }}>Edit</span>
                                      </button>
                                    )}
                                    <button
                                      onClick={() => openView(r)}
                                      className="btn-ghost flex items-center gap-1.5"
                                      style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.35)' }}>
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
          </table>
        </div>
        {/* ── Table pagination ── */}
        {records.length > TABLE_PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs"
            style={{ borderColor: 'var(--card-border)', background: 'var(--bg-input)' }}>
            <span style={{ color: 'var(--text-3)' }}>
              {tablePage * TABLE_PAGE_SIZE + 1}–{Math.min((tablePage + 1) * TABLE_PAGE_SIZE, records.length)} of {records.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTablePage(p => Math.max(0, p - 1))}
                disabled={tablePage === 0}
                className="btn-icon p-1 text-xs"
                style={{ opacity: tablePage === 0 ? 0.35 : 1 }}
                aria-label="Previous page"
              >‹</button>
              {Array.from({ length: Math.ceil(records.length / TABLE_PAGE_SIZE) }, (_, i) => i)
                .filter(i => Math.abs(i - tablePage) <= 2)
                .map(i => (
                  <button key={i} onClick={() => setTablePage(i)}
                    className={i === tablePage ? 'btn-primary' : 'btn-ghost'}
                    style={{ minWidth: 28, padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}>
                    {i + 1}
                  </button>
                ))}
              <button
                onClick={() => setTablePage(p => Math.min(Math.ceil(records.length / TABLE_PAGE_SIZE) - 1, p + 1))}
                disabled={(tablePage + 1) * TABLE_PAGE_SIZE >= records.length}
                className="btn-icon p-1 text-xs"
                style={{ opacity: (tablePage + 1) * TABLE_PAGE_SIZE >= records.length ? 0.35 : 1 }}
                aria-label="Next page"
              >›</button>
            </div>
          </div>
        )}

        {/* ── Totals row — sum of ALL currently filtered invoices (not just current page) ── */}
        {records.length > 0 && (() => {
          const totalRaised    = records.reduce((s, r) => s + Number(r.fields?.['Amount Raised']    || 0), 0)
          const totalWithTax   = records.reduce((s, r) => s + Number(r.fields?.['Amount with Tax']  || 0), 0)
          const totalReceived  = records.reduce((s, r) => s + Number(r.fields?.['Amount Received']  || 0), 0)
          const totalOutstanding = records.reduce((s, r) => s + Number(r.fields?.['Outstanding Amount'] || 0), 0)
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-b-xl text-xs font-medium"
              style={{ background: 'var(--bg-input)', borderTop: '1px solid var(--card-border)' }}>
              <span style={{ color: 'var(--text-3)' }}>{records.length} invoice{records.length !== 1 ? 's' : ''} in view</span>
              <div className="flex flex-wrap gap-4">
                <span>Raised <strong style={{ color: 'var(--text-1)' }}>{fmt(totalRaised)}</strong></span>
                <span>Incl. GST <strong style={{ color: 'var(--text-1)' }}>{fmt(totalWithTax)}</strong></span>
                <span>Collected <strong style={{ color: 'var(--fin-positive, #16a34a)' }}>{fmt(totalReceived)}</strong></span>
                <span>Outstanding <strong style={{ color: totalOutstanding > 0 ? 'var(--fin-warning, #ca8a04)' : 'var(--fin-positive, #16a34a)' }}>{fmt(totalOutstanding)}</strong></span>
              </div>
            </div>
          )
        })()}
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
