import { useMemo, useRef, useEffect, useState } from 'react'

function fmtL(n) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}k`
  return `₹${Math.round(n)}`
}

function shiftMonth(dateObj, delta) {
  const d = new Date(dateObj)
  d.setDate(1)
  d.setMonth(d.getMonth() + delta)
  return d
}

function monthKey(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i]
    const cx = (p.x + c.x) / 2
    d += ` C${cx},${p.y} ${cx},${c.y} ${c.x},${c.y}`
  }
  return d
}

const PRESETS = [
  { key: '3mo',   label: '3 mo',  months: 3  },
  { key: '6mo',   label: '6 mo',  months: 6  },
  { key: '12mo',  label: '12 mo', months: 12 },
  { key: 'custom',label: 'Custom',months: null },
]

// records: array of Teable invoice records (fields['Raised Date'], fields['Amount Raised/with Tax'], fields['Amount Received'])
export default function MonthlyCollectionsChart({ records = [], className = '' }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(800)
  const [preset, setPreset] = useState('12mo')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [tooltipXY, setTooltipXY] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width || 800))
    ro.observe(el)
    setWidth(el.offsetWidth || 800)
    return () => ro.disconnect()
  }, [])

  const months = useMemo(() => {
    const now = new Date(); now.setDate(1); now.setHours(0, 0, 0, 0)
    let startD, endD

    if (preset === 'custom' && customFrom) {
      startD = new Date(customFrom); startD.setDate(1)
      endD = customTo ? new Date(customTo) : now
      endD = new Date(endD); endD.setDate(1)
    } else {
      const n = PRESETS.find(p => p.key === preset)?.months || 12
      startD = shiftMonth(now, -(n - 1))
      endD = now
    }

    // Build ordered month keys in range
    const keys = []
    const cur = new Date(startD)
    while (cur <= endD) {
      keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
      cur.setMonth(cur.getMonth() + 1)
    }

    // Aggregate records by month key
    const agg = {}
    for (const r of records) {
      const f = r.fields || {}
      const mk = monthKey(f['Raised Date'])
      if (!mk || !keys.includes(mk)) continue
      if (!agg[mk]) agg[mk] = { raised: 0, received: 0, count: 0 }
      agg[mk].raised   += Number(f['Amount with Tax'] || f['Amount Raised'] || 0)
      agg[mk].received += Number(f['Amount Received'] || 0)
      agg[mk].count    += 1
    }

    return keys.map(mk => {
      const [y, m] = mk.split('-').map(Number)
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      return { mk, label, raised: agg[mk]?.raised || 0, received: agg[mk]?.received || 0, count: agg[mk]?.count || 0 }
    })
  }, [records, preset, customFrom, customTo])

  // % change vs previous month
  const lastMonth  = months[months.length - 1]
  const prevMonth  = months[months.length - 2]
  const pctChange  = prevMonth && prevMonth.raised > 0
    ? ((lastMonth?.raised - prevMonth.raised) / prevMonth.raised) * 100
    : null

  // SVG layout
  const H = 200, PAD_T = 36, PAD_B = 32, PAD_L = 48, PAD_R = 16
  const chartH = H - PAD_T - PAD_B
  const chartW = Math.max(0, width - PAD_L - PAD_R)

  const maxVal = Math.max(1, ...months.map(m => Math.max(m.raised, m.received)))
  const nTicks = 4
  const ticks = Array.from({ length: nTicks + 1 }, (_, i) => maxVal * (1 - i / nTicks))

  const barW = months.length > 1 ? Math.max(8, (chartW / months.length) * 0.6) : chartW * 0.3
  const step = months.length > 1 ? chartW / (months.length - 1) : chartW

  function xFor(i) {
    return months.length > 1 ? PAD_L + i * step : PAD_L + chartW / 2
  }
  function yFor(v) {
    return PAD_T + chartH - (v / maxVal) * chartH
  }

  const linePts = months.map((m, i) => ({ x: xFor(i), y: yFor(m.received) }))

  // gradient id must be unique per instance
  const gradId = 'mcbar'
  const areaId = 'mcarea'

  return (
    <div className={className}>
      {/* Header + presets */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Cash Flow</p>
          <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>Monthly raised (bars) vs collected (line)</h2>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              style={{
                fontSize: '0.7rem', padding: '0.25rem 0.6rem', borderRadius: 6,
                background: preset === p.key ? 'var(--accent)' : 'transparent',
                color: preset === p.key ? '#fff' : 'var(--text-3)',
                border: preset === p.key ? 'none' : '1px solid var(--border)',
                fontWeight: preset === p.key ? 600 : 400,
                cursor: 'pointer',
              }}
            >{p.label}</button>
          ))}
          {preset === 'custom' && (
            <span className="flex items-center gap-1 ml-1">
              <input
                type="month"
                value={customFrom.slice(0, 7)}
                onChange={e => setCustomFrom(e.target.value + '-01')}
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)' }}
              />
              <span style={{ color: 'var(--text-3)', fontSize: '0.7rem' }}>→</span>
              <input
                type="month"
                value={customTo.slice(0, 7)}
                onChange={e => setCustomTo(e.target.value + '-01')}
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-1)' }}
              />
            </span>
          )}
          {pctChange !== null && (
            <span style={{
              marginLeft: 4, fontSize: '0.68rem', padding: '0.2rem 0.55rem', borderRadius: 20,
              background: pctChange >= 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              color: pctChange >= 0 ? '#16a34a' : '#dc2626',
              fontWeight: 600,
            }}>
              {pctChange >= 0 ? '↗' : '↘'} {Math.abs(pctChange).toFixed(0)}% vs last month
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{ position: 'relative' }}>
        {months.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', padding: '2rem 0' }}>No data in selected range.</p>
        ) : (
          <svg
            width={width}
            height={H}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Y-axis ticks */}
            {ticks.map((v, i) => {
              const y = PAD_T + (i / nTicks) * chartH
              return (
                <g key={i}>
                  <line x1={PAD_L - 4} y1={y} x2={PAD_L + chartW} y2={y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,4" />
                  <text x={PAD_L - 7} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-3)">{fmtL(v)}</text>
                </g>
              )
            })}

            {/* Bars (Raised) */}
            {months.map((m, i) => {
              const x = xFor(i)
              const bh = (m.raised / maxVal) * chartH
              const isHov = hoverIdx === i
              return (
                <rect
                  key={m.mk}
                  x={x - barW / 2}
                  y={PAD_T + chartH - bh}
                  width={barW}
                  height={bh}
                  rx={4}
                  fill={`url(#${gradId})`}
                  opacity={isHov ? 1 : 0.75}
                  style={{ transition: 'opacity 0.15s' }}
                  onMouseEnter={e => { setHoverIdx(i); setTooltipXY({ x: e.clientX, y: e.clientY }) }}
                  onMouseMove={e => setTooltipXY({ x: e.clientX, y: e.clientY })}
                />
              )
            })}

            {/* Area under collected line */}
            {linePts.length > 1 && (
              <path
                d={`${smoothPath(linePts)} L${linePts[linePts.length - 1].x},${PAD_T + chartH} L${linePts[0].x},${PAD_T + chartH} Z`}
                fill={`url(#${areaId})`}
              />
            )}

            {/* Collected line */}
            {linePts.length > 1 && (
              <path d={smoothPath(linePts)} fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinejoin="round" />
            )}

            {/* Line dots */}
            {linePts.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={hoverIdx === i ? 5 : 3.5}
                fill="#22c55e"
                stroke="#fff"
                strokeWidth={1.5}
                style={{ transition: 'r 0.1s' }}
                onMouseEnter={e => { setHoverIdx(i); setTooltipXY({ x: e.clientX, y: e.clientY }) }}
                onMouseMove={e => setTooltipXY({ x: e.clientX, y: e.clientY })}
              />
            ))}

            {/* X-axis labels */}
            {months.map((m, i) => (
              <text
                key={m.mk}
                x={xFor(i)}
                y={H - 6}
                textAnchor="middle"
                fontSize={9}
                fill={hoverIdx === i ? 'var(--accent)' : 'var(--text-3)'}
              >{m.label}</text>
            ))}

            {/* Baseline */}
            <line x1={PAD_L} y1={PAD_T + chartH} x2={PAD_L + chartW} y2={PAD_T + chartH} stroke="var(--border)" strokeWidth={1} />
          </svg>
        )}

        {/* Tooltip */}
        {hoverIdx !== null && months[hoverIdx] && (() => {
          const m = months[hoverIdx]
          const cr = m.raised > 0 ? Math.min(100, (m.received / m.raised) * 100) : 0
          return (
            <div style={{
              position: 'fixed', left: tooltipXY.x + 14, top: tooltipXY.y - 10,
              background: 'var(--surface-2, #1e293b)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '8px 12px', pointerEvents: 'none', zIndex: 9999,
              fontSize: '0.75rem', minWidth: 140,
              boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            }}>
              <p style={{ fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>{m.label}</p>
              <p style={{ color: '#818cf8' }}>Raised: <strong>{fmtL(m.raised)}</strong></p>
              <p style={{ color: '#22c55e' }}>Received: <strong>{fmtL(m.received)}</strong></p>
              <p style={{ color: 'var(--text-3)', marginTop: 2 }}>{m.count} invoice{m.count !== 1 ? 's' : ''} · {cr.toFixed(0)}% collected</p>
            </div>
          )
        })()}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: '0.72rem', color: 'var(--text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 10, borderRadius: 2, background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'inline-block' }} />
          Raised
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="18" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#22c55e" strokeWidth="2.5" /><circle cx="9" cy="5" r="3" fill="#22c55e" /></svg>
          Collected
        </span>
      </div>
    </div>
  )
}
