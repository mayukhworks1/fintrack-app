import { BarChart3, PieChart as PieChartIcon, Table2, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend,
} from 'recharts'

const DONUT_COLORS = ['#4b67ff', '#16915f', '#ca7f14', '#d85f58', '#7c3aed', '#0891b2', '#6b7280']

function formatMetricValue(value, format = 'auto') {
  if (value == null || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  if (format === 'currency') return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  if (format === 'percent') return `${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function numeric(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function aggregateRows(rows, aggregate, valueKey) {
  if (aggregate === 'count') return rows.length
  const values = rows.map((row) => numeric(row?.[valueKey]))
  if (!values.length) return 0
  if (aggregate === 'avg') return values.reduce((sum, value) => sum + value, 0) / values.length
  if (aggregate === 'min') return Math.min(...values)
  if (aggregate === 'max') return Math.max(...values)
  return values.reduce((sum, value) => sum + value, 0)
}

function computeBlockValue(rows, block) {
  if (block.formulaMode !== 'formula') {
    return aggregateRows(rows, block.aggregate || 'sum', block.valueKey)
  }
  const numerator = aggregateRows(rows, block.numeratorAggregate || 'sum', block.numeratorKey)
  const denominator = aggregateRows(rows, block.denominatorAggregate || 'sum', block.denominatorKey)
  if (block.formulaOp === 'sum') return numerator + denominator
  if (block.formulaOp === 'difference') return numerator - denominator
  if (denominator === 0) return 0
  if (block.formulaOp === 'ratio') return numerator / denominator
  return (numerator / denominator) * 100
}

function sortByMetric(rows, valueKey, direction = 'desc') {
  const mult = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => (numeric(a?.[valueKey]) - numeric(b?.[valueKey])) * mult)
}

function spanClass(span) {
  if (span === 'full') return 'lg:col-span-2'
  if (span === 'compact') return ''
  return 'lg:col-span-1'
}

function BlockShell({ title, sourceLabel, icon, children, className = '' }) {
  return (
    <div className={`rounded-[24px] p-5 ${className}`} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>{sourceLabel || 'Source'}</p>
          <h3 className="text-lg font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{title}</h3>
        </div>
        <div className="rounded-2xl p-3" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          {icon}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function CustomInsightBlocks({ blocks = [], sourceOptions = [], sourceRowsByKey = {} }) {
  if (!blocks.length) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Custom boards</p>
          <h2 className="text-xl font-semibold mt-1" style={{ color: 'var(--text-1)' }}>Your own metrics and views</h2>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>{blocks.length} active block{blocks.length === 1 ? '' : 's'}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {blocks.map((block) => {
          const source = sourceOptions.find((item) => item.key === block.sourceKey)
          const rows = sourceRowsByKey[block.sourceKey] || source?.getRows?.() || []
          const limit = Math.max(1, Number(block.limit || 8))

          if (block.type === 'kpi') {
            const total = computeBlockValue(rows, block)
            return (
              <BlockShell
                key={block.id}
                title={block.title || 'Custom KPI'}
                sourceLabel={source?.label}
                icon={<TrendingUp size={18} />}
                className={spanClass(block.span)}
              >
                <p className="text-[2rem] font-semibold mt-5 tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}>
                  {formatMetricValue(total, block.valueFormat || (block.formulaMode === 'formula' && block.formulaOp === 'ratio_percent' ? 'percent' : 'auto'))}
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                  {rows.length.toLocaleString()} rows · {block.formulaMode === 'formula'
                    ? `${block.formulaOp.replace('_', ' ')}`
                    : `${String(block.aggregate || 'sum').toUpperCase()}${block.valueKey ? ` of ${block.valueLabel || block.valueKey}` : ''}`}
                </p>
              </BlockShell>
            )
          }

          if (block.type === 'breakdown') {
            const grouped = new Map()
            for (const row of rows) {
              const key = row?.[block.groupKey] == null || row?.[block.groupKey] === '' ? 'Unspecified' : String(row[block.groupKey])
              const bucket = grouped.get(key) || []
              bucket.push(row)
              grouped.set(key, bucket)
            }
            const items = [...grouped.entries()]
              .map(([label, bucket]) => ({
                label,
                value: computeBlockValue(bucket, block),
                rows: bucket.length,
              }))
              .sort((a, b) => b.value - a.value)
              .slice(0, limit)
            const max = Math.max(...items.map((item) => numeric(item.value)), 1)
            return (
              <BlockShell
                key={block.id}
                title={block.title || 'Custom breakdown'}
                sourceLabel={source?.label}
                icon={block.visual === 'donut' ? <PieChartIcon size={18} /> : <BarChart3 size={18} />}
                className={spanClass(block.span)}
              >
                {block.visual === 'donut' ? (
                  <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] items-center">
                    <div style={{ width: '100%', height: 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={items} dataKey="value" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2}>
                            {items.map((item, index) => <Cell key={item.label} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v) => formatMetricValue(v, block.valueFormat)} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3">
                      {items.map((item, index) => (
                        <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                            <span className="truncate" style={{ color: 'var(--text-1)' }}>{item.label}</span>
                          </div>
                          <span className="tabular-nums font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>
                            {formatMetricValue(item.value, block.valueFormat)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : block.visual === 'list' ? (
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate" style={{ color: 'var(--text-1)' }}>{item.label}</span>
                          <span className="tabular-nums font-semibold flex-shrink-0" style={{ color: 'var(--text-2)' }}>
                            {formatMetricValue(item.value, block.valueFormat)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(numeric(item.value) / max) * 100}%`, background: 'var(--accent)' }} />
                        </div>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{item.rows} rows</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 11 }} hide={items.length > 8} />
                        <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
                        <Tooltip formatter={(v) => formatMetricValue(v, block.valueFormat)} />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--accent)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </BlockShell>
            )
          }

          const columns = Array.isArray(block.columns) ? block.columns : []
          const tableRows = sortByMetric(rows, block.sortKey || columns[0]?.key, block.sortDir).slice(0, limit)
          return (
            <BlockShell
              key={block.id}
              title={block.title || 'Custom table'}
              sourceLabel={source?.label}
              icon={<Table2 size={18} />}
              className={block.span === 'compact' ? 'lg:col-span-1' : 'lg:col-span-2'}
            >
              <div className="overflow-auto rounded-2xl" style={{ border: '1px solid var(--card-border)' }}>
                <table className="min-w-full text-sm">
                  <thead style={{ background: 'var(--bg-input)' }}>
                    <tr>
                      {columns.map((column) => (
                        <th key={column.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, idx) => (
                      <tr key={`${block.id}-${idx}`} style={{ borderTop: '1px solid var(--card-border)' }}>
                        {columns.map((column) => (
                          <td key={column.key} className="px-4 py-3 align-top" style={{ color: 'var(--text-2)' }}>
                            {formatMetricValue(row?.[column.key], column.format || block.valueFormat)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlockShell>
          )
        })}
      </div>
    </section>
  )
}
