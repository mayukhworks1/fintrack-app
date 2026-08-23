/**
 * Renders an analyst result: the prose, the chart, the numbers, and the SQL.
 *
 * The SQL is shown on purpose. An answer about money that cannot be checked is
 * not much better than a guess, and the compiled statement is the only complete
 * account of what was actually asked — including the row-scope predicate the
 * server appended, which is the part a reader most needs to be able to see.
 */
import { useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react'

// Categorical series. Distinct in hue rather than lightness so they stay
// separable on both themes and for the most common colour-vision deficiencies.
const SERIES = ['#2563eb', '#0d9488', '#a16207', '#7c3aed', '#be185d', '#4d7c0f']

function fmt(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  if (unit === 'currency') {
    // Indian grouping, matching how the rest of the app writes money.
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (unit === 'percent') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`
  if (unit === 'days') return `${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })} days`
  return n.toLocaleString('en-IN')
}

function compact(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (unit === 'percent') return `${n}%`
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(1)}L`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

export default function DataAnswer({ turn }) {
  const [showSql, setShowSql] = useState(false)
  const rows = turn.rows || []
  const dimKey = (turn.columns || []).find(c => c !== 'value')
  const unit = turn.unit || 'number'

  // No dimension means one number. A chart of a single bar communicates less
  // than the number itself, so it is shown as a figure.
  const single = rows.length === 1 && !dimKey

  const axis = { fontSize: 11, fill: 'var(--text-2)' }
  const tooltip = {
    contentStyle: {
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, fontSize: 12, color: 'var(--text-1)',
    },
    formatter: (v) => [fmt(v, unit), turn.metric_label || 'Value'],
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
        {turn.answer}
      </div>

      {single && (
        <div style={{ padding: '6px 0' }}>
          <div style={{
            fontSize: 'clamp(28px, 7vw, 40px)', fontWeight: 800, letterSpacing: '-0.02em',
            color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
          }}>
            {fmt(rows[0].value, unit)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            {turn.metric_label} · {turn.dataset_label}
          </div>
        </div>
      )}

      {!single && rows.length > 0 && turn.chart !== 'table' && (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            {turn.chart === 'line' ? (
              <LineChart data={rows} margin={{ top: 6, right: 10, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey={dimKey} tick={axis} tickLine={false} axisLine={false} />
                <YAxis tick={axis} tickLine={false} axisLine={false}
                       tickFormatter={v => compact(v, unit)} width={54} />
                <Tooltip {...tooltip} />
                <Line type="monotone" dataKey="value" stroke={SERIES[0]} strokeWidth={2}
                      dot={{ r: 2 }} activeDot={{ r: 4 }} />
              </LineChart>
            ) : turn.chart === 'pie' ? (
              <PieChart>
                <Pie data={rows} dataKey="value" nameKey={dimKey}
                     innerRadius={52} outerRadius={92} paddingAngle={2}>
                  {rows.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                </Pie>
                <Tooltip {...tooltip} />
              </PieChart>
            ) : (
              <BarChart data={rows} margin={{ top: 6, right: 10, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey={dimKey} tick={axis} tickLine={false} axisLine={false}
                       interval={0} angle={rows.length > 6 ? -35 : 0}
                       textAnchor={rows.length > 6 ? 'end' : 'middle'}
                       height={rows.length > 6 ? 62 : 26} />
                <YAxis tick={axis} tickLine={false} axisLine={false}
                       tickFormatter={v => compact(v, unit)} width={54} />
                <Tooltip {...tooltip} />
                <Bar dataKey="value" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {!single && rows.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 260 }}>
            <thead>
              <tr>
                {(turn.columns || []).map(col => (
                  <th key={col} style={{
                    textAlign: col === 'value' ? 'right' : 'left', padding: '8px 12px',
                    borderBottom: '1px solid var(--border)', color: 'var(--text-2)',
                    fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {col === 'value' ? turn.metric_label : (turn.dimension_labels?.[0] || col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {(turn.columns || []).map(col => (
                    <td key={col} style={{
                      padding: '7px 12px', borderBottom: '1px solid var(--border)',
                      color: 'var(--text-1)',
                      textAlign: col === 'value' ? 'right' : 'left',
                      fontVariantNumeric: col === 'value' ? 'tabular-nums' : 'normal',
                    }}>
                      {col === 'value' ? fmt(row[col], unit) : String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        fontSize: 11, color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: 10,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Table2 size={12} aria-hidden="true" /> {turn.dataset_label}
        </span>
        {turn.period && turn.period !== 'all_time' && (
          <span>{turn.period.replace(/_/g, ' ')}</span>
        )}
        <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        {/* Named explicitly: a scoped user should know the figure is theirs
            alone, not the company's, before they quote it to anyone. */}
        {turn.scoped && <span style={{ color: '#b45309' }}>your records only</span>}
        {turn.model && <span>{turn.model}</span>}
        {turn.latency_ms != null && <span>{(turn.latency_ms / 1000).toFixed(1)}s</span>}
        {turn.sql && (
          <button
            onClick={() => setShowSql(v => !v)}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: 11, fontWeight: 600, padding: 0,
            }}
          >
            {showSql ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            Show query
          </button>
        )}
      </div>

      {showSql && (
        <pre style={{
          margin: 0, padding: '12px 14px', background: 'var(--bg-base)',
          border: '1px solid var(--border)', borderRadius: 8,
          fontSize: 11, lineHeight: 1.6, overflowX: 'auto',
          color: 'var(--text-2)', fontFamily: 'ui-monospace, Menlo, monospace',
        }}>{turn.sql}</pre>
      )}
    </div>
  )
}
