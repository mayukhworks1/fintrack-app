import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Download, GripVertical, LayoutDashboard, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../services/api'

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-5xl rounded-[28px] card max-h-[88vh] overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--card-border)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{title}</h2>
            {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost"><X size={14} /></button>
        </div>
        <div className="p-5 overflow-auto max-h-[calc(88vh-72px)]">
          {children}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ title, children, action }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function InsightWorkbench({
  pageKey,
  pageLabel,
  widgetCatalog = [],
  defaultWidgetIds = [],
  factoryWidgetIds = [],
  sourceOptions = [],
  currentFilters = {},
  onApplyWidgets,
  onApplyCustomBlocks,
}) {
  const activeDashboardStorageKey = `fintrack:insight-dashboard:${pageKey}`
  const [showDashboards, setShowDashboards] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [dashboardConfigs, setDashboardConfigs] = useState([])
  const [reportConfigs, setReportConfigs] = useState([])
  const [loadingDashboards, setLoadingDashboards] = useState(false)
  const [loadingReports, setLoadingReports] = useState(false)
  const [dashboardTitle, setDashboardTitle] = useState(`${pageLabel} custom board`)
  const [selectedWidgets, setSelectedWidgets] = useState(defaultWidgetIds)
  const [editingDashboardId, setEditingDashboardId] = useState('')
  const [editingReportId, setEditingReportId] = useState('')

  const [sourceKey, setSourceKey] = useState(sourceOptions[0]?.key || '')
  const [exportFormat, setExportFormat] = useState('excel')
  const [exportTitle, setExportTitle] = useState(`${pageLabel} report`)
  const [selectedColumns, setSelectedColumns] = useState(sourceOptions[0]?.defaultColumns || [])
  const [exporting, setExporting] = useState(false)
  const [savingReport, setSavingReport] = useState(false)
  const [sourceRowsByKey, setSourceRowsByKey] = useState({})
  const [sourceLoadingKey, setSourceLoadingKey] = useState('')
  const [customBlocks, setCustomBlocks] = useState([])
  const [editingBlockId, setEditingBlockId] = useState('')
  const [blockType, setBlockType] = useState('kpi')
  const [blockTitle, setBlockTitle] = useState('Custom KPI')
  const [blockSourceKey, setBlockSourceKey] = useState(sourceOptions[0]?.key || '')
  const [blockAggregate, setBlockAggregate] = useState('sum')
  const [blockValueKey, setBlockValueKey] = useState('')
  const [blockValueFormat, setBlockValueFormat] = useState('auto')
  const [blockGroupKey, setBlockGroupKey] = useState('')
  const [blockColumns, setBlockColumns] = useState([])
  const [blockSortKey, setBlockSortKey] = useState('')
  const [blockSortDir, setBlockSortDir] = useState('desc')
  const [blockLimit, setBlockLimit] = useState(8)
  const [blockVisual, setBlockVisual] = useState('bars')
  const [blockSpan, setBlockSpan] = useState('wide')
  const [blockFormulaMode, setBlockFormulaMode] = useState('field')
  const [blockNumeratorKey, setBlockNumeratorKey] = useState('')
  const [blockNumeratorAggregate, setBlockNumeratorAggregate] = useState('sum')
  const [blockDenominatorKey, setBlockDenominatorKey] = useState('')
  const [blockDenominatorAggregate, setBlockDenominatorAggregate] = useState('sum')
  const [blockFormulaOp, setBlockFormulaOp] = useState('ratio_percent')
  const [draggingBlockId, setDraggingBlockId] = useState('')
  const [dashboardHydrated, setDashboardHydrated] = useState(false)

  const baselineWidgetIds = factoryWidgetIds.length ? factoryWidgetIds : defaultWidgetIds

  useEffect(() => {
    setSelectedWidgets(defaultWidgetIds)
  }, [defaultWidgetIds.join('|')])

  const ensureSourceRows = useCallback(async (key) => {
    const source = sourceOptions.find((item) => item.key === key)
    if (!source) return []
    if (sourceRowsByKey[key]) return sourceRowsByKey[key]
    if (!source.loadRows) {
      const fallbackRows = source.getRows ? source.getRows() : []
      setSourceRowsByKey((curr) => ({ ...curr, [key]: fallbackRows }))
      return fallbackRows
    }
    setSourceLoadingKey(key)
    try {
      const rows = await source.loadRows()
      setSourceRowsByKey((curr) => ({ ...curr, [key]: rows || [] }))
      return rows || []
    } finally {
      setSourceLoadingKey('')
    }
  }, [sourceOptions, sourceRowsByKey])

  useEffect(() => {
    if ((showDashboards || showExport) && sourceKey) ensureSourceRows(sourceKey)
  }, [showDashboards, showExport, sourceKey, ensureSourceRows])

  async function loadDashboardConfigs() {
    setLoadingDashboards(true)
    try {
      const res = await api.insights.listConfigs({ page_key: pageKey, config_kind: 'dashboard' })
      setDashboardConfigs(res.configs || [])
    } finally {
      setLoadingDashboards(false)
    }
  }

  useEffect(() => {
    if (showDashboards) loadDashboardConfigs()
  }, [showDashboards])

  async function loadReportConfigs() {
    setLoadingReports(true)
    try {
      const res = await api.insights.listConfigs({ page_key: pageKey, config_kind: 'report' })
      setReportConfigs(res.configs || [])
    } finally {
      setLoadingReports(false)
    }
  }

  useEffect(() => {
    if (showExport) loadReportConfigs()
  }, [showExport])

  const currentSource = useMemo(
    () => sourceOptions.find(item => item.key === sourceKey) || sourceOptions[0] || null,
    [sourceKey, sourceOptions]
  )

  const currentRows = useMemo(
    () => sourceRowsByKey[sourceKey] || (currentSource?.getRows ? currentSource.getRows() : []),
    [sourceRowsByKey, sourceKey, currentSource]
  )

  const exportableColumns = currentSource?.columns || []
  const previewColumns = exportableColumns.filter(col => selectedColumns.includes(col.key))
  const previewRows = useMemo(
    () => currentRows.slice(0, 8).map((row) => previewColumns.map((column) => row[column.key] ?? '')),
    [currentRows, previewColumns]
  )

  function applyWidgetSelection(nextWidgetIds) {
    setSelectedWidgets(nextWidgetIds)
    onApplyWidgets?.(nextWidgetIds)
  }

  function applyCustomBlockSelection(nextBlocks) {
    setCustomBlocks(nextBlocks)
    onApplyCustomBlocks?.(nextBlocks, sourceRowsByKey)
  }

  function resetDashboardBuilder() {
    setEditingDashboardId('')
    setDashboardTitle(`${pageLabel} custom board`)
    applyWidgetSelection(baselineWidgetIds)
    setEditingBlockId('')
    setBlockType('kpi')
    setBlockTitle('Custom KPI')
    setBlockSourceKey(sourceOptions[0]?.key || '')
    setBlockAggregate('sum')
    setBlockValueKey('')
    setBlockValueFormat('auto')
    setBlockGroupKey('')
    setBlockColumns([])
    setBlockSortKey('')
    setBlockSortDir('desc')
    setBlockLimit(8)
    applyCustomBlockSelection([])
  }

  function resetReportBuilder() {
    const source = sourceOptions[0] || null
    setEditingReportId('')
    setExportTitle(`${pageLabel} report`)
    setExportFormat('excel')
    setSourceKey(source?.key || '')
    setSelectedColumns(source?.defaultColumns || source?.columns?.map((col) => col.key) || [])
    if (source?.key) ensureSourceRows(source.key)
  }

  function handleSourceChange(nextSourceKey) {
    const source = sourceOptions.find((item) => item.key === nextSourceKey) || sourceOptions[0] || null
    setSourceKey(nextSourceKey)
    setSelectedColumns(source?.defaultColumns || source?.columns?.map((col) => col.key) || [])
    if (nextSourceKey) ensureSourceRows(nextSourceKey)
  }

  async function saveDashboard() {
    const payload = {
      page_key: pageKey,
      config_kind: 'dashboard',
      title: dashboardTitle,
      is_active: true,
      config: {
        widgetIds: selectedWidgets,
        customBlocks,
      },
    }
    const saved = editingDashboardId
      ? await api.insights.updateConfig(editingDashboardId, payload)
      : await api.insights.createConfig(payload)
    if (saved?.id) {
      setEditingDashboardId(saved.id)
      try { localStorage.setItem(activeDashboardStorageKey, saved.id) } catch {}
    }
    await loadDashboardConfigs()
    onApplyWidgets?.(selectedWidgets)
  }

  async function deleteConfig(id, kind) {
    await api.insights.deleteConfig(id)
    if (kind === 'dashboard') {
      if (editingDashboardId === id) {
        resetDashboardBuilder()
        try { localStorage.removeItem(activeDashboardStorageKey) } catch {}
      }
      await loadDashboardConfigs()
      return
    }
    if (editingReportId === id) resetReportBuilder()
    await loadReportConfigs()
  }

  function applyDashboardConfig(config) {
    const widgetIds = config?.config?.widgetIds || []
    applyWidgetSelection(widgetIds)
    applyCustomBlockSelection(config?.config?.customBlocks || [])
    setDashboardTitle(config.title || `${pageLabel} custom board`)
    setEditingDashboardId(config.id)
    try { localStorage.setItem(activeDashboardStorageKey, config.id) } catch {}
  }

  function applyReportConfig(config) {
    const nextSourceKey = config?.config?.sourceKey || sourceOptions[0]?.key || ''
    const source = sourceOptions.find((item) => item.key === nextSourceKey) || sourceOptions[0]
    setEditingReportId(config.id)
    setExportTitle(config.title || `${pageLabel} report`)
    setExportFormat(config?.config?.exportFormat || 'excel')
    setSourceKey(nextSourceKey)
    setSelectedColumns(
      config?.config?.selectedColumns?.length
        ? config.config.selectedColumns
        : source?.defaultColumns || source?.columns?.map((col) => col.key) || []
    )
  }

  useEffect(() => {
    let cancelled = false
    async function hydrateActiveDashboard() {
      try {
        const res = await api.insights.listConfigs({ page_key: pageKey, config_kind: 'dashboard' })
        if (cancelled) return
        const configs = res.configs || []
        setDashboardConfigs(configs)
        let savedId = ''
        try { savedId = localStorage.getItem(activeDashboardStorageKey) || '' } catch {}
        const target = configs.find((config) => config.id === savedId) || configs[0]
        if (target) {
          applyWidgetSelection(target?.config?.widgetIds || [])
          applyCustomBlockSelection(target?.config?.customBlocks || [])
          setDashboardTitle(target.title || `${pageLabel} custom board`)
          setEditingDashboardId(target.id)
        }
      } finally {
        if (!cancelled) setDashboardHydrated(true)
      }
    }
    hydrateActiveDashboard()
    return () => { cancelled = true }
  // intentionally keyed only to page identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  async function saveReportPreset() {
    if (!currentSource || !selectedColumns.length) return
    setSavingReport(true)
    try {
      const payload = {
        page_key: pageKey,
        config_kind: 'report',
        title: exportTitle,
        is_active: true,
        config: {
          sourceKey: currentSource.key,
          exportFormat,
          selectedColumns,
        },
      }
      if (editingReportId) await api.insights.updateConfig(editingReportId, payload)
      else await api.insights.createConfig(payload)
      await loadReportConfigs()
    } finally {
      setSavingReport(false)
    }
  }

  async function runExport() {
    if (!currentSource) return
    const exportRows = await ensureSourceRows(currentSource.key)
    const selectedColumnDefs = exportableColumns.filter(col => selectedColumns.includes(col.key))
    const rows = exportRows.map((row) => selectedColumns.map((key) => row[key] ?? ''))
    const summaryCards = selectedColumnDefs.slice(0, 4).map((column) => {
      const values = exportRows.map((row) => row?.[column.key])
      const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      const numeric = nums.length >= Math.max(2, Math.ceil(values.length * 0.35))
      if (numeric) {
        const total = nums.reduce((sum, value) => sum + value, 0)
        return {
          label: column.label,
          value: column.format === 'currency' || /amount|profit|revenue|billed|received|outstanding|cost|raised/i.test(column.key)
            ? `₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
            : total.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
        }
      }
      return {
        label: column.label,
        value: `${new Set(values.filter(Boolean).map((value) => String(value))).size.toLocaleString('en-IN')} distinct`,
      }
    })
    setExporting(true)
    try {
      const res = await api.insights.export({
        page_key: pageKey,
        source_key: currentSource.key,
        title: exportTitle,
        export_format: exportFormat,
        columns: selectedColumnDefs.map(col => col.label),
        rows,
        filters: currentFilters,
        config_id: editingReportId || null,
        metadata: {
          page_label: pageLabel,
          source_label: currentSource.label,
          export_scope: 'full-source',
          selected_columns: selectedColumnDefs.map((col) => col.label).join(', '),
          filters_summary: Object.entries(currentFilters || {}).filter(([, value]) => value != null && value !== '' && value !== false).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No active filters',
          summary_cards: summaryCards,
        },
      })
      downloadFile(res.blob, res.filename || `${exportTitle}.${exportFormat === 'pdf' ? 'pdf' : 'xls'}`)
      setShowExport(false)
    } finally {
      setExporting(false)
    }
  }

  const blockSource = useMemo(
    () => sourceOptions.find((item) => item.key === blockSourceKey) || sourceOptions[0] || null,
    [blockSourceKey, sourceOptions]
  )
  const blockFields = blockSource?.columns || []
  const numericBlockFields = blockFields.filter((field) => {
    const rows = sourceRowsByKey[blockSourceKey] || blockSource?.getRows?.() || []
    return rows.some((row) => {
      const n = Number(row?.[field.key])
      return Number.isFinite(n)
    })
  })

  function resetBlockEditor() {
    setEditingBlockId('')
    setBlockType('kpi')
    setBlockTitle('Custom KPI')
    setBlockSourceKey(sourceOptions[0]?.key || '')
    setBlockAggregate('sum')
    setBlockValueKey('')
    setBlockValueFormat('auto')
    setBlockGroupKey('')
    setBlockColumns([])
    setBlockSortKey('')
    setBlockSortDir('desc')
    setBlockLimit(8)
    setBlockVisual('bars')
    setBlockSpan('wide')
    setBlockFormulaMode('field')
    setBlockNumeratorKey('')
    setBlockNumeratorAggregate('sum')
    setBlockDenominatorKey('')
    setBlockDenominatorAggregate('sum')
    setBlockFormulaOp('ratio_percent')
  }

  function editBlock(block) {
    setEditingBlockId(block.id)
    setBlockType(block.type || 'kpi')
    setBlockTitle(block.title || 'Custom KPI')
    setBlockSourceKey(block.sourceKey || sourceOptions[0]?.key || '')
    setBlockAggregate(block.aggregate || 'sum')
    setBlockValueKey(block.valueKey || '')
    setBlockValueFormat(block.valueFormat || 'auto')
    setBlockGroupKey(block.groupKey || '')
    setBlockColumns(block.columns || [])
    setBlockSortKey(block.sortKey || '')
    setBlockSortDir(block.sortDir || 'desc')
    setBlockLimit(block.limit || 8)
    setBlockVisual(block.visual || 'bars')
    setBlockSpan(block.span || 'wide')
    setBlockFormulaMode(block.formulaMode || 'field')
    setBlockNumeratorKey(block.numeratorKey || '')
    setBlockNumeratorAggregate(block.numeratorAggregate || 'sum')
    setBlockDenominatorKey(block.denominatorKey || '')
    setBlockDenominatorAggregate(block.denominatorAggregate || 'sum')
    setBlockFormulaOp(block.formulaOp || 'ratio_percent')
    if (block.sourceKey) ensureSourceRows(block.sourceKey)
  }

  function upsertBlock() {
    const source = sourceOptions.find((item) => item.key === blockSourceKey) || sourceOptions[0]
    if (!source) return
    const nextBlock = {
      id: editingBlockId || `blk_${Date.now()}`,
      type: blockType,
      title: blockTitle,
      sourceKey: source.key,
      aggregate: blockAggregate,
      valueKey: blockValueKey,
      valueLabel: source.columns?.find((item) => item.key === blockValueKey)?.label || blockValueKey,
      valueFormat: blockValueFormat,
      groupKey: blockGroupKey,
      columns: blockColumns,
      sortKey: blockSortKey,
      sortDir: blockSortDir,
      limit: Number(blockLimit || 8),
      visual: blockVisual,
      span: blockSpan,
      formulaMode: blockFormulaMode,
      numeratorKey: blockNumeratorKey,
      numeratorAggregate: blockNumeratorAggregate,
      denominatorKey: blockDenominatorKey,
      denominatorAggregate: blockDenominatorAggregate,
      formulaOp: blockFormulaOp,
    }
    const nextBlocks = editingBlockId
      ? customBlocks.map((item) => item.id === editingBlockId ? nextBlock : item)
      : [...customBlocks, nextBlock]
    applyCustomBlockSelection(nextBlocks)
    resetBlockEditor()
  }

  function removeBlock(id) {
    applyCustomBlockSelection(customBlocks.filter((item) => item.id !== id))
    if (editingBlockId === id) resetBlockEditor()
  }

  function reorderBlocks(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return
    const next = [...customBlocks]
    const fromIndex = next.findIndex((item) => item.id === fromId)
    const toIndex = next.findIndex((item) => item.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    applyCustomBlockSelection(next)
  }

  function moveBlock(id, delta) {
    const idx = customBlocks.findIndex((item) => item.id === id)
    const nextIdx = idx + delta
    if (idx < 0 || nextIdx < 0 || nextIdx >= customBlocks.length) return
    const next = [...customBlocks]
    const [moved] = next.splice(idx, 1)
    next.splice(nextIdx, 0, moved)
    applyCustomBlockSelection(next)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowDashboards(true)} className="btn-ghost">
          <LayoutDashboard size={14} />Custom dashboards
        </button>
        <button onClick={() => setShowExport(true)} className="btn-ghost">
          <Download size={14} />Export reports
        </button>
      </div>

      {showDashboards && (
        <ModalShell
          title={`${pageLabel} dashboards`}
          subtitle="Save widget selections as reusable custom dashboard presets."
          onClose={() => setShowDashboards(false)}
        >
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <SectionCard
              title="Saved presets"
              action={<button onClick={resetDashboardBuilder} className="btn-ghost text-xs"><Plus size={12} />New</button>}
            >
              <div className="space-y-2">
                {loadingDashboards ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
                ) : dashboardConfigs.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>No saved dashboards yet.</p>
                ) : dashboardConfigs.map(config => (
                  <div key={config.id} className="rounded-xl p-3" style={{ border: '1px solid var(--card-border)', background: editingDashboardId === config.id ? 'var(--accent-dim)' : 'var(--card-bg)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="text-left flex-1" onClick={() => applyDashboardConfig(config)}>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{config.title}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{(config.config?.widgetIds || []).length} widgets</p>
                      </button>
                      <button onClick={() => deleteConfig(config.id, 'dashboard')} className="btn-ghost text-xs"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Preset builder"
              action={<button onClick={saveDashboard} className="btn-primary text-xs"><Save size={12} />Save preset</button>}
            >
              <div className="space-y-4">
                <div>
                  <label className="label">Preset title</label>
                  <input className="input" value={dashboardTitle} onChange={e => setDashboardTitle(e.target.value)} />
                </div>
                <div>
                  <p className="label mb-2">Widgets</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {widgetCatalog.map(widget => {
                      const active = selectedWidgets.includes(widget.id)
                      return (
                      <button
                          key={widget.id}
                          type="button"
                          onClick={() => {
                            const next = active ? selectedWidgets.filter(id => id !== widget.id) : [...selectedWidgets, widget.id]
                            applyWidgetSelection(next)
                          }}
                          className="rounded-xl p-3 text-left transition-all"
                          style={{
                            background: active ? 'var(--accent-dim)' : 'var(--card-bg)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                          }}
                        >
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{widget.label}</p>
                          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{widget.description}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="pt-4" style={{ borderTop: '1px solid var(--card-border)' }}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Custom blocks</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Build your own KPI, grouped breakdown, or custom table from full source rows.</p>
                    </div>
                    <button onClick={resetBlockEditor} className="btn-ghost text-xs"><Plus size={12} />New block</button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_320px]">
                    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label">Block title</label>
                          <input className="input" value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} />
                        </div>
                        <div>
                          <label className="label">Block type</label>
                          <select className="input" value={blockType} onChange={(e) => setBlockType(e.target.value)}>
                            <option value="kpi">KPI</option>
                            <option value="breakdown">Breakdown</option>
                            <option value="table">Table</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Source</label>
                          <select className="input" value={blockSourceKey} onChange={(e) => { setBlockSourceKey(e.target.value); ensureSourceRows(e.target.value) }}>
                            {sourceOptions.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
                          </select>
                        </div>
                          <div>
                            <label className="label">Block width</label>
                            <select className="input" value={blockSpan} onChange={(e) => setBlockSpan(e.target.value)}>
                              <option value="compact">Compact</option>
                              <option value="wide">Wide</option>
                              <option value="full">Full width</option>
                            </select>
                          </div>
                          <div>
                            <label className="label">Rows</label>
                            <div className="input flex items-center justify-between">
                              <span>{(sourceRowsByKey[blockSourceKey] || blockSource?.getRows?.() || []).length} rows loaded</span>
                              {sourceLoadingKey === blockSourceKey && <span style={{ color: 'var(--text-3)' }}>loading…</span>}
                            </div>
                          </div>

                        {blockType !== 'table' && (
                          <>
                            <div>
                              <label className="label">Aggregate</label>
                              <select className="input" value={blockAggregate} onChange={(e) => setBlockAggregate(e.target.value)}>
                                <option value="sum">Sum</option>
                                <option value="count">Count</option>
                                <option value="avg">Average</option>
                                <option value="min">Min</option>
                                <option value="max">Max</option>
                              </select>
                            </div>
                            <div>
                              <label className="label">Value format</label>
                              <select className="input" value={blockValueFormat} onChange={(e) => setBlockValueFormat(e.target.value)}>
                                <option value="auto">Auto</option>
                                <option value="currency">Currency</option>
                                <option value="number">Number</option>
                                <option value="percent">Percent</option>
                              </select>
                            </div>
                            <div>
                              <label className="label">Measure mode</label>
                              <select className="input" value={blockFormulaMode} onChange={(e) => setBlockFormulaMode(e.target.value)}>
                                <option value="field">Single field</option>
                                <option value="formula">Computed formula</option>
                              </select>
                            </div>
                            {blockFormulaMode === 'field' && blockAggregate !== 'count' && (
                              <div className="sm:col-span-2">
                                <label className="label">Value field</label>
                                <select className="input" value={blockValueKey} onChange={(e) => setBlockValueKey(e.target.value)}>
                                  <option value="">Choose numeric field</option>
                                  {numericBlockFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                                </select>
                              </div>
                            )}
                            {blockFormulaMode === 'formula' && (
                              <>
                                <div>
                                  <label className="label">Formula</label>
                                  <select className="input" value={blockFormulaOp} onChange={(e) => setBlockFormulaOp(e.target.value)}>
                                    <option value="ratio_percent">Numerator / Denominator %</option>
                                    <option value="ratio">Numerator / Denominator</option>
                                    <option value="difference">Numerator - Denominator</option>
                                    <option value="sum">Numerator + Denominator</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="label">Numerator aggregate</label>
                                  <select className="input" value={blockNumeratorAggregate} onChange={(e) => setBlockNumeratorAggregate(e.target.value)}>
                                    <option value="sum">Sum</option>
                                    <option value="count">Count</option>
                                    <option value="avg">Average</option>
                                    <option value="min">Min</option>
                                    <option value="max">Max</option>
                                  </select>
                                </div>
                                {blockNumeratorAggregate !== 'count' && (
                                  <div>
                                    <label className="label">Numerator field</label>
                                    <select className="input" value={blockNumeratorKey} onChange={(e) => setBlockNumeratorKey(e.target.value)}>
                                      <option value="">Choose numeric field</option>
                                      {numericBlockFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                                    </select>
                                  </div>
                                )}
                                <div>
                                  <label className="label">Denominator aggregate</label>
                                  <select className="input" value={blockDenominatorAggregate} onChange={(e) => setBlockDenominatorAggregate(e.target.value)}>
                                    <option value="sum">Sum</option>
                                    <option value="count">Count</option>
                                    <option value="avg">Average</option>
                                    <option value="min">Min</option>
                                    <option value="max">Max</option>
                                  </select>
                                </div>
                                {blockDenominatorAggregate !== 'count' && (
                                  <div className="sm:col-span-2">
                                    <label className="label">Denominator field</label>
                                    <select className="input" value={blockDenominatorKey} onChange={(e) => setBlockDenominatorKey(e.target.value)}>
                                      <option value="">Choose numeric field</option>
                                      {numericBlockFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                                    </select>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}

                        {blockType === 'breakdown' && (
                          <>
                            <div>
                              <label className="label">Group by</label>
                              <select className="input" value={blockGroupKey} onChange={(e) => setBlockGroupKey(e.target.value)}>
                                <option value="">Choose dimension</option>
                                {blockFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="label">Top rows</label>
                              <input className="input" type="number" min="3" max="20" value={blockLimit} onChange={(e) => setBlockLimit(e.target.value)} />
                            </div>
                            <div>
                              <label className="label">Visual</label>
                              <select className="input" value={blockVisual} onChange={(e) => setBlockVisual(e.target.value)}>
                                <option value="bars">Bars</option>
                                <option value="donut">Donut</option>
                                <option value="pie">Pie</option>
                                <option value="line">Line graph</option>
                                <option value="area">Area graph</option>
                                <option value="list">List</option>
                              </select>
                            </div>
                          </>
                        )}

                        {blockType === 'table' && (
                          <>
                            <div>
                              <label className="label">Sort field</label>
                              <select className="input" value={blockSortKey} onChange={(e) => setBlockSortKey(e.target.value)}>
                                <option value="">Choose field</option>
                                {blockFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="label">Sort direction</label>
                              <select className="input" value={blockSortDir} onChange={(e) => setBlockSortDir(e.target.value)}>
                                <option value="desc">Descending</option>
                                <option value="asc">Ascending</option>
                              </select>
                            </div>
                            <div>
                              <label className="label">Row limit</label>
                              <input className="input" type="number" min="3" max="25" value={blockLimit} onChange={(e) => setBlockLimit(e.target.value)} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="label">Visible columns</label>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {blockFields.map((field) => {
                                  const active = blockColumns.some((col) => col.key === field.key)
                                  return (
                                    <button
                                      key={field.key}
                                      type="button"
                                      onClick={() => setBlockColumns((curr) => active ? curr.filter((col) => col.key !== field.key) : [...curr, { key: field.key, label: field.label }])}
                                      className="rounded-xl px-3 py-2 text-left transition-all"
                                      style={{
                                        background: active ? 'var(--accent-dim)' : 'var(--card-bg)',
                                        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                                      }}
                                    >
                                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{field.label}</p>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-4">
                        <button
                          onClick={upsertBlock}
                          className="btn-primary text-xs"
                          disabled={
                            blockType !== 'table' && (
                              (blockFormulaMode === 'field' && blockAggregate !== 'count' && !blockValueKey) ||
                              (blockFormulaMode === 'formula' && (
                                (blockNumeratorAggregate !== 'count' && !blockNumeratorKey) ||
                                (blockDenominatorAggregate !== 'count' && !blockDenominatorKey)
                              ))
                            )
                          }
                        >
                          <Save size={12} />{editingBlockId ? 'Update block' : 'Add block'}
                        </button>
                        <button onClick={resetBlockEditor} className="btn-ghost text-xs">
                          <X size={12} />Reset editor
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {customBlocks.length === 0 ? (
                        <div className="rounded-2xl p-4 text-sm" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                          No custom blocks yet. Add KPI, grouped breakdown, or table blocks and they will apply live to the page.
                        </div>
                      ) : customBlocks.map((block) => (
                        <div
                          key={block.id}
                          className="rounded-2xl p-3"
                          draggable
                          onDragStart={() => setDraggingBlockId(block.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            reorderBlocks(draggingBlockId, block.id)
                            setDraggingBlockId('')
                          }}
                          onDragEnd={() => setDraggingBlockId('')}
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button className="text-left flex-1" onClick={() => editBlock(block)}>
                              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{block.title}</p>
                              <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                                {block.type} · {block.sourceKey} · {block.span || 'wide'} · {block.type === 'table' ? (block.columns?.length || 0) + ' columns' : block.formulaMode === 'formula' ? `formula (${block.formulaOp})` : String(block.aggregate || 'sum').toUpperCase()}
                              </p>
                            </button>
                            <div className="flex items-center gap-1">
                              <span className="btn-ghost text-xs cursor-grab" title="Drag to reorder"><GripVertical size={12} /></span>
                              <button onClick={() => moveBlock(block.id, -1)} className="btn-ghost text-xs" title="Move up"><ArrowUp size={12} /></button>
                              <button onClick={() => moveBlock(block.id, 1)} className="btn-ghost text-xs" title="Move down"><ArrowDown size={12} /></button>
                              <button onClick={() => removeBlock(block.id)} className="btn-ghost text-xs"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </ModalShell>
      )}

      {showExport && (
        <ModalShell
          title={`${pageLabel} export builder`}
          subtitle="Build reusable report presets from the full dataset, preview the dataset, and export polished Excel or PDF reports."
          onClose={() => setShowExport(false)}
        >
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <SectionCard
              title="Saved report presets"
              action={<button onClick={resetReportBuilder} className="btn-ghost text-xs"><Plus size={12} />New</button>}
            >
              <div className="space-y-2 mb-4">
                {loadingReports ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
                ) : reportConfigs.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>No saved report presets yet.</p>
                ) : reportConfigs.map(config => (
                  <div key={config.id} className="rounded-xl p-3" style={{ border: '1px solid var(--card-border)', background: editingReportId === config.id ? 'var(--accent-dim)' : 'var(--card-bg)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="text-left flex-1" onClick={() => applyReportConfig(config)}>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{config.title}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                          {(config.config?.sourceKey || 'source')} · {(config.config?.selectedColumns || []).length} columns · {(config.config?.exportFormat || 'excel').toUpperCase()}
                        </p>
                      </button>
                      <button onClick={() => deleteConfig(config.id, 'report')} className="btn-ghost text-xs"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="label">Report title</label>
                  <input className="input" value={exportTitle} onChange={e => setExportTitle(e.target.value)} />
                </div>
                <div>
                  <label className="label">Source</label>
                  <select className="input" value={sourceKey} onChange={e => handleSourceChange(e.target.value)}>
                    {sourceOptions.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Format</label>
                  <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                    {['excel', 'pdf'].map(fmt => (
                      <button
                        key={fmt}
                        onClick={() => setExportFormat(fmt)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={exportFormat === fmt ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-3)' }}
                      >
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={saveReportPreset} disabled={savingReport || !selectedColumns.length} className="btn-ghost text-xs">
                    <Save size={12} />{savingReport ? 'Saving…' : 'Save preset'}
                  </button>
                  <button onClick={runExport} disabled={exporting || !selectedColumns.length} className="btn-primary text-xs">
                    <Download size={12} />{exporting ? 'Preparing…' : 'Download'}
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Columns and preview" action={<BarChart3 size={14} style={{ color: 'var(--accent)' }} />}>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <button
                  onClick={() => setSelectedColumns(exportableColumns.map((column) => column.key))}
                  className="btn-ghost text-xs"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedColumns([])}
                  className="btn-ghost text-xs"
                >
                  Clear
                </button>
                <button
                  onClick={() => setSelectedColumns(currentSource?.defaultColumns || exportableColumns.map((column) => column.key))}
                  className="btn-ghost text-xs"
                >
                  Reset defaults
                </button>
                <div className="ml-auto rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-2)' }}>
                  {currentRows.length} rows · {selectedColumns.length} columns {sourceLoadingKey === sourceKey ? '· loading…' : ''}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {exportableColumns.map(column => {
                  const active = selectedColumns.includes(column.key)
                  return (
                    <button
                      key={column.key}
                      type="button"
                      onClick={() => setSelectedColumns(curr => active ? curr.filter(key => key !== column.key) : [...curr, column.key])}
                      className="rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--card-bg)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                      }}
                    >
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{column.label}</p>
                    </button>
                  )
                })}
              </div>

              <div className="mt-5 rounded-2xl overflow-hidden" style={{ border: '1px solid var(--card-border)' }}>
                <div className="px-4 py-3" style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Preview</p>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead style={{ background: 'var(--bg-layer)' }}>
                      <tr>
                        {previewColumns.map((column) => (
                          <th key={column.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.length === 0 ? (
                        <tr>
                          <td colSpan={Math.max(previewColumns.length, 1)} className="px-4 py-6 text-sm" style={{ color: 'var(--text-3)' }}>
                            Nothing to preview yet. Pick a source and at least one column.
                          </td>
                        </tr>
                      ) : previewRows.map((row, index) => (
                        <tr key={index} style={{ borderTop: '1px solid var(--card-border)' }}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="px-4 py-3 align-top" style={{ color: 'var(--text-2)' }}>
                              {String(cell ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </SectionCard>
          </div>
        </ModalShell>
      )}
    </>
  )
}
