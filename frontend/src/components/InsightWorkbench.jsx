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
  sourceOptions = [],
  currentFilters = {},
  onApplyWidgets,
}) {
  const [showDashboards, setShowDashboards] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [configs, setConfigs] = useState([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [dashboardTitle, setDashboardTitle] = useState(`${pageLabel} custom board`)
  const [selectedWidgets, setSelectedWidgets] = useState(defaultWidgetIds)
  const [editingId, setEditingId] = useState('')

  const [sourceKey, setSourceKey] = useState(sourceOptions[0]?.key || '')
  const [exportFormat, setExportFormat] = useState('excel')
  const [exportTitle, setExportTitle] = useState(`${pageLabel} report`)
  const [selectedColumns, setSelectedColumns] = useState(sourceOptions[0]?.defaultColumns || [])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setSelectedWidgets(defaultWidgetIds)
  }, [defaultWidgetIds.join('|')])

  useEffect(() => {
    const source = sourceOptions.find(item => item.key === sourceKey) || sourceOptions[0]
    if (source) setSelectedColumns(source.defaultColumns || source.columns.map(col => col.key))
  }, [sourceKey, sourceOptions])

  async function loadConfigs() {
    setLoadingConfigs(true)
    try {
      const res = await api.insights.listConfigs({ page_key: pageKey, config_kind: 'dashboard' })
      setConfigs(res.configs || [])
    } finally {
      setLoadingConfigs(false)
    }
  }

  useEffect(() => {
    if (showDashboards) loadConfigs()
  }, [showDashboards])

  const currentSource = useMemo(
    () => sourceOptions.find(item => item.key === sourceKey) || sourceOptions[0] || null,
    [sourceKey, sourceOptions]
  )

  const currentRows = useMemo(
    () => (currentSource?.getRows ? currentSource.getRows() : []),
    [currentSource]
  )

  const exportableColumns = currentSource?.columns || []

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
    if (editingId) await api.insights.updateConfig(editingId, payload)
    else await api.insights.createConfig(payload)
    await loadConfigs()
    onApplyWidgets?.(selectedWidgets)
  }

  async function deleteDashboard(id) {
    await api.insights.deleteConfig(id)
    if (editingId === id) setEditingId('')
    await loadConfigs()
  }

  function applyConfig(config) {
    const widgetIds = config?.config?.widgetIds || []
    setSelectedWidgets(widgetIds)
    setDashboardTitle(config.title || `${pageLabel} custom board`)
    setEditingId(config.id)
    onApplyWidgets?.(widgetIds)
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
        config_id: editingId || null,
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
              action={<button onClick={() => { setEditingId(''); setDashboardTitle(`${pageLabel} custom board`); setSelectedWidgets(defaultWidgetIds) }} className="btn-ghost text-xs"><Plus size={12} />New</button>}
            >
              <div className="space-y-2">
                {loadingConfigs ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
                ) : configs.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>No saved dashboards yet.</p>
                ) : configs.map(config => (
                  <div key={config.id} className="rounded-xl p-3" style={{ border: '1px solid var(--card-border)', background: editingId === config.id ? 'var(--accent-dim)' : 'var(--card-bg)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="text-left flex-1" onClick={() => applyConfig(config)}>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{config.title}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{(config.config?.widgetIds || []).length} widgets</p>
                      </button>
                      <button onClick={() => deleteDashboard(config.id)} className="btn-ghost text-xs"><Trash2 size={12} /></button>
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
                          onClick={() => setSelectedWidgets(curr => active ? curr.filter(id => id !== widget.id) : [...curr, widget.id])}
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
          subtitle="Pick the source, choose exact columns, and export to Excel or PDF with full audit trail."
          onClose={() => setShowExport(false)}
        >
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <SectionCard title="Report settings" action={<BarChart3 size={14} style={{ color: 'var(--accent)' }} />}>
              <div className="space-y-4">
                <div>
                  <label className="label">Report title</label>
                  <input className="input" value={exportTitle} onChange={e => setExportTitle(e.target.value)} />
                </div>
                <div>
                  <label className="label">Source</label>
                  <select className="input" value={sourceKey} onChange={e => setSourceKey(e.target.value)}>
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
                <button onClick={runExport} disabled={exporting || !selectedColumns.length} className="btn-primary">
                  <Download size={14} />{exporting ? 'Preparing…' : 'Download export'}
                </button>
              </div>
            </SectionCard>

            <SectionCard title="Columns">
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
              <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  {currentRows.length} rows · {selectedColumns.length} columns selected
                </p>
              </div>
            </SectionCard>
          </div>
        </ModalShell>
      )}
    </>
  )
}
