import { BarChart3, Table2, TrendingUp } from 'lucide-react'

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

function sortByMetric(rows, valueKey, direction = 'desc') {
  const mult = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => (numeric(a?.[valueKey]) - numeric(b?.[valueKey])) * mult)
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
            const total = aggregateRows(rows, block.aggregate || 'sum', block.valueKey)
            return (
              <div key={block.id} className="rounded-[24px] p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>{source?.label || 'Source'}</p>
                    <h3 className="text-lg font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{block.title || 'Custom KPI'}</h3>
                  </div>
                  <div className="rounded-2xl p-3" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    <TrendingUp size={18} />
                  </div>
                </div>
                <p className="text-[2rem] font-semibold mt-5 tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}>
                  {formatMetricValue(total, block.valueFormat)}
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                  {rows.length.toLocaleString()} rows · {String(block.aggregate || 'sum').toUpperCase()}
                  {block.valueKey ? ` of ${block.valueLabel || block.valueKey}` : ''}
                </p>
              </div>
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
                value: aggregateRows(bucket, block.aggregate || 'sum', block.valueKey),
                rows: bucket.length,
              }))
              .sort((a, b) => b.value - a.value)
              .slice(0, limit)
            const max = Math.max(...items.map((item) => numeric(item.value)), 1)
            return (
              <div key={block.id} className="rounded-[24px] p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>{source?.label || 'Source'}</p>
                    <h3 className="text-lg font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{block.title || 'Custom breakdown'}</h3>
                  </div>
                  <div className="rounded-2xl p-3" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    <BarChart3 size={18} />
                  </div>
                </div>
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
              </div>
            )
          }

          const columns = Array.isArray(block.columns) ? block.columns : []
          const tableRows = sortByMetric(rows, block.sortKey || columns[0], block.sortDir).slice(0, limit)
          return (
            <div key={block.id} className="rounded-[24px] p-5 lg:col-span-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>{source?.label || 'Source'}</p>
                  <h3 className="text-lg font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{block.title || 'Custom table'}</h3>
                </div>
                <div className="rounded-2xl p-3" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  <Table2 size={18} />
                </div>
              </div>
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
            </div>
          )
        })}
      </div>
    </section>
  )
}
