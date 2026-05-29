import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, LayoutDashboard, Plus, Save, Trash2, X } from 'lucide-react'
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
}) {
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

  const baselineWidgetIds = factoryWidgetIds.length ? factoryWidgetIds : defaultWidgetIds

  useEffect(() => {
    setSelectedWidgets(defaultWidgetIds)
  }, [defaultWidgetIds.join('|')])

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
    () => (currentSource?.getRows ? currentSource.getRows() : []),
    [currentSource]
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

  function resetDashboardBuilder() {
    setEditingDashboardId('')
    setDashboardTitle(`${pageLabel} custom board`)
    applyWidgetSelection(baselineWidgetIds)
  }

  function resetReportBuilder() {
    const source = sourceOptions[0] || null
    setEditingReportId('')
    setExportTitle(`${pageLabel} report`)
    setExportFormat('excel')
    setSourceKey(source?.key || '')
    setSelectedColumns(source?.defaultColumns || source?.columns?.map((col) => col.key) || [])
  }

  function handleSourceChange(nextSourceKey) {
    const source = sourceOptions.find((item) => item.key === nextSourceKey) || sourceOptions[0] || null
    setSourceKey(nextSourceKey)
    setSelectedColumns(source?.defaultColumns || source?.columns?.map((col) => col.key) || [])
  }

  async function saveDashboard() {
    const payload = {
      page_key: pageKey,
      config_kind: 'dashboard',
      title: dashboardTitle,
      is_active: true,
      config: {
        widgetIds: selectedWidgets,
      },
    }
    if (editingDashboardId) await api.insights.updateConfig(editingDashboardId, payload)
    else await api.insights.createConfig(payload)
    await loadDashboardConfigs()
    onApplyWidgets?.(selectedWidgets)
  }

  async function deleteConfig(id, kind) {
    await api.insights.deleteConfig(id)
    if (kind === 'dashboard') {
      if (editingDashboardId === id) resetDashboardBuilder()
      await loadDashboardConfigs()
      return
    }
    if (editingReportId === id) resetReportBuilder()
    await loadReportConfigs()
  }

  function applyDashboardConfig(config) {
    const widgetIds = config?.config?.widgetIds || []
    applyWidgetSelection(widgetIds)
    setDashboardTitle(config.title || `${pageLabel} custom board`)
    setEditingDashboardId(config.id)
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
    const rows = currentRows.map((row) =>
      selectedColumns.map((key) => row[key] ?? '')
    )
    setExporting(true)
    try {
      const res = await api.insights.export({
        page_key: pageKey,
        source_key: currentSource.key,
        title: exportTitle,
        export_format: exportFormat,
        columns: exportableColumns.filter(col => selectedColumns.includes(col.key)).map(col => col.label),
        rows,
        filters: currentFilters,
        config_id: editingReportId || null,
        metadata: {
          widget_ids: selectedWidgets,
          page_label: pageLabel,
        },
      })
      downloadFile(res.blob, res.filename || `${exportTitle}.${exportFormat === 'pdf' ? 'pdf' : 'xls'}`)
      setShowExport(false)
    } finally {
      setExporting(false)
    }
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
              </div>
            </SectionCard>
          </div>
        </ModalShell>
      )}

      {showExport && (
        <ModalShell
          title={`${pageLabel} export builder`}
          subtitle="Build reusable report presets, preview the dataset, and export polished Excel or PDF reports."
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
                  {currentRows.length} rows · {selectedColumns.length} columns
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
