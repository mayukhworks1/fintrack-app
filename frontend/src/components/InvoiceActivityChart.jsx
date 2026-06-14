import { useMemo, useRef, useEffect, useState, useCallback } from 'react'

/* ── helpers ── */
function parseDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
function toDateKey(d) { return d.toISOString().slice(0, 10) }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function initials(name = '') {
  return name.trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
}
function shortDate(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function longDate(d)  { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
function fmtInr(n)    { return '₹' + Number(n).toLocaleString('en-IN') }

function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i]
    const cx = (prev.x + cur.x) / 2
    d += ` C${cx},${prev.y} ${cx},${cur.y} ${cur.x},${cur.y}`
  }
  return d
}

function statusMeta(status, agingDays) {
  if (status === 'Paid')      return { fill: '#16a34a', light: '#bbf7d0', label: 'Paid',      dot: '#22c55e' }
  if (status === 'Cancelled') return { fill: '#6b7280', light: '#e5e7eb', label: 'Cancelled', dot: '#9ca3af' }
  const d = Number(agingDays || 0)
  if (d > 30) return { fill: '#e11d48', light: '#fecdd3', label: 'Overdue',  dot: '#fb7185' }
  return       { fill: '#475569', light: '#cbd5e1', label: 'Pending',  dot: '#94a3b8' }
}

const AREA_COLOR = '#22c55e'
const UID = 'iac2'

// Accepts either:
//   days={60}          → last N days ending today
//   from="…" to="…"   → explicit date range
export default function InvoiceActivityChart({ records = [], days = 60, from, to, className = '' }) {
  const containerRef = useRef(null)
  const svgRef       = useRef(null)
  const [width,      setWidth]   = useState(800)
  const [hoverIdx,   setHoverIdx] = useState(null)   // day index
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width || 800))
    ro.observe(el)
    setWidth(el.offsetWidth || 800)
    return () => ro.disconnect()
  }, [])

  /* ── layout ── */
  const H       = 240
  const PAD_TOP = 44
  const PAD_BOT = 34
  const PAD_L   = 12
  const PAD_R   = 12
  const chartH  = H - PAD_TOP - PAD_BOT
  const chartW  = width - PAD_L - PAD_R

  /* ── data ── */
  const data = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    let start, end
    if (from) {
      start = new Date(from); start.setHours(0,0,0,0)
      end   = to ? new Date(to) : today; end.setHours(0,0,0,0)
    } else {
      end   = today
      start = addDays(today, -(days - 1))
    }
    const byDay = {}
    for (const r of records) {
      const f = r.fields || {}
      const dt = parseDate(f['Raised Date'])
      if (!dt) continue
      const key = toDateKey(dt)
      if (!byDay[key]) byDay[key] = []
      byDay[key].push({
        amount:    Number(f['Amount Raised'] || 0),
        status:    f['Payment Status'] || 'Pending',
        raisedBy:  f['Raised By']      || '',
        invoiceNo: f['Invoice Number'] || f['Invoice No'] || '',
        project:   f['Project Name']   || f['Project']   || '',
        client:    f['Client']         || '',
        aging:     Number(f['Agening (Days)'] || 0),
      })
    }
    let cum = 0
    for (const r of records) {
      const f = r.fields || {}
      const dt = parseDate(f['Raised Date'])
      if (dt && dt < start) cum += Number(f['Amount Raised'] || 0)
    }
    const allDays = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const key      = toDateKey(d)
      const invoices = byDay[key] || []
      const dayAmt   = invoices.reduce((s, i) => s + i.amount, 0)
      cum += dayAmt
      allDays.push({ date: new Date(d), key, invoices, dayAmt, cum })
    }
    return allDays
  }, [records, days, from, to])

  const maxCum    = Math.max(...data.map(d => d.cum),    1)
  const maxDayAmt = Math.max(...data.map(d => d.dayAmt), 1)

  const xOf = useCallback((i) => PAD_L + (i / (data.length - 1 || 1)) * chartW, [PAD_L, chartW, data.length])
  const yOf = (v) => PAD_TOP + chartH - (v / maxCum) * chartH * 0.82

  /* ── area ── */
  const areaPoints = data.map((d, i) => ({ x: xOf(i), y: yOf(d.cum) }))
  const linePath   = smoothPath(areaPoints)
  const areaPath   = linePath + ` L${xOf(data.length - 1)},${PAD_TOP + chartH} L${xOf(0)},${PAD_TOP + chartH} Z`

  /* ── bar height ── */
  const BAR_MIN = 14, BAR_MAX = chartH * 0.72
  const barH = (amt) => amt > 0 ? BAR_MIN + Math.sqrt(amt / maxDayAmt) * (BAR_MAX - BAR_MIN) : 0

  /* ── mouse tracking ── */
  const handleMouseMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg || !data.length) return
    const rect = svg.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    // find closest day by x
    let best = 0, bestDist = Infinity
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(xOf(i) - mx)
      if (dist < bestDist) { bestDist = dist; best = i }
    }
    setHoverIdx(best)
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [data, xOf])

  const handleMouseLeave = () => setHoverIdx(null)

  const hoverDay = hoverIdx != null ? data[hoverIdx] : null
  const labelEvery = Math.max(1, Math.round(data.length / 9))

  /* ── tooltip placement ── */
  const TOOLTIP_W = 220
  const tipX = tooltipPos.x + TOOLTIP_W + 16 > width
    ? tooltipPos.x - TOOLTIP_W - 12
    : tooltipPos.x + 12

  if (!data.length) return null

  return (
    <div ref={containerRef} className={`w-full relative select-none ${className}`} style={{ minHeight: H }}>
      <svg
        ref={svgRef}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        aria-label="Invoice activity timeline"
        style={{ overflow: 'visible', display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={`${UID}-grad`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={AREA_COLOR} stopOpacity="0.22" />
            <stop offset="65%"  stopColor={AREA_COLOR} stopOpacity="0.05" />
            <stop offset="100%" stopColor={AREA_COLOR} stopOpacity="0"    />
          </linearGradient>
          <filter id={`${UID}-glow`} x="-30%" y="-80%" width="160%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id={`${UID}-bardrop`} x="-50%" y="-20%" width="200%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <clipPath id={`${UID}-clip`}>
            <rect x={PAD_L} y={PAD_TOP} width={chartW} height={chartH} />
          </clipPath>
        </defs>

        {/* ── subtle y-grid ── */}
        {[0.25, 0.5, 0.75, 1].map(t => {
          const y = yOf(maxCum * t)
          return (
            <line key={t}
              x1={PAD_L} y1={y} x2={PAD_L + chartW} y2={y}
              stroke="var(--card-border, rgba(0,0,0,0.06))"
              strokeWidth="1" strokeDasharray="4 6"
            />
          )
        })}

        {/* ── area fill + line ── */}
        <g clipPath={`url(#${UID}-clip)`}>
          <path d={areaPath} fill={`url(#${UID}-grad)`} />
        </g>
        <path d={linePath} fill="none" stroke={AREA_COLOR} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" filter={`url(#${UID}-glow)`} />

        {/* ── event bars ── */}
        {data.map((day, i) => {
          if (!day.invoices.length) return null
          const x      = xOf(i)
          const h      = barH(day.dayAmt)
          const bot    = PAD_TOP + chartH
          const top    = bot - h
          const isHov  = hoverIdx === i
          const statuses = day.invoices.map(inv => inv.status)
          const dominant = statuses.includes('Pending') ? 'Pending'
            : statuses.includes('Paid') ? 'Paid' : 'Cancelled'
          const aging  = Math.max(...day.invoices.map(inv => inv.aging))
          const meta   = statusMeta(dominant, aging)
          const barW   = isHov ? 8 : 5
          const rx     = barW / 2

          return (
            <g key={day.key} filter={isHov ? `url(#${UID}-bardrop)` : undefined}>
              {/* glow halo */}
              <rect
                x={x - barW / 2 - 3} y={top - 2} width={barW + 6} height={h + 2}
                rx={rx + 2}
                fill={meta.dot}
                opacity={isHov ? 0.18 : 0.10}
              />
              {/* bar body */}
              <rect
                x={x - barW / 2} y={top} width={barW} height={h}
                rx={rx} ry={rx}
                fill={meta.dot}
                opacity={isHov ? 1 : 0.85}
              />
              {/* cap highlight */}
              <rect
                x={x - barW / 2 + 1} y={top} width={barW - 2} height={Math.min(6, h)}
                rx={rx - 0.5}
                fill="white" opacity={isHov ? 0.30 : 0.18}
              />
              {/* initials badge */}
              {h > 32 && (
                <g>
                  <circle
                    cx={x} cy={top - 13} r={isHov ? 13 : 11}
                    fill={meta.fill}
                    stroke="white" strokeWidth="1.5"
                  />
                  <text x={x} y={top - 13}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={isHov ? "8.5" : "7.5"} fontWeight="700"
                    fill="white"
                    fontFamily="Inter, ui-sans-serif, system-ui"
                  >
                    {initials(day.invoices[0].raisedBy)}
                  </text>
                  {/* count badge */}
                  {day.invoices.length > 1 && (
                    <g>
                      <circle cx={x + 9} cy={top - 22} r="7" fill={meta.dot} stroke="white" strokeWidth="1.2" />
                      <text x={x + 9} y={top - 22}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize="6.5" fontWeight="800" fill="white"
                        fontFamily="Inter, ui-sans-serif, system-ui"
                      >{day.invoices.length}</text>
                    </g>
                  )}
                </g>
              )}
            </g>
          )
        })}

        {/* ── crosshair on hover ── */}
        {hoverDay && (() => {
          const x   = xOf(hoverIdx)
          const bot = PAD_TOP + chartH
          const cy  = yOf(hoverDay.cum)
          return (
            <g pointerEvents="none">
              {/* vertical guide */}
              <line x1={x} y1={PAD_TOP} x2={x} y2={bot}
                stroke="var(--accent, #6366f1)" strokeWidth="1"
                strokeDasharray="3 4" opacity="0.5" />
              {/* dot on curve */}
              <circle cx={x} cy={cy} r="5"
                fill="white" stroke={AREA_COLOR} strokeWidth="2.5" />
              <circle cx={x} cy={cy} r="2.5" fill={AREA_COLOR} />
              {/* cumulative label */}
              <rect x={x - 38} y={PAD_TOP - 20} width={76} height={16} rx="6"
                fill="var(--accent, #6366f1)" opacity="0.9" />
              <text x={x} y={PAD_TOP - 12}
                textAnchor="middle" dominantBaseline="central"
                fontSize="9" fontWeight="700" fill="white"
                fontFamily="Inter, ui-sans-serif, system-ui"
              >{fmtInr(hoverDay.cum)} total</text>
            </g>
          )
        })()}

        {/* ── x-axis ── */}
        {data.map((day, i) => {
          const x      = xOf(i)
          const isLabel = i % labelEvery === 0 || i === data.length - 1
          const hasInv  = day.invoices.length > 0
          const isHov   = hoverIdx === i
          return (
            <g key={`x-${day.key}`}>
              <circle
                cx={x} cy={PAD_TOP + chartH + 9}
                r={isHov ? 4 : hasInv ? 3.5 : 2}
                fill={isHov ? 'var(--accent)' : hasInv ? AREA_COLOR : 'var(--card-border, rgba(0,0,0,0.15))'}
                opacity={hasInv || isHov ? 1 : 0.45}
              />
              {(isLabel || isHov) && (
                <text x={x} y={H - 3}
                  textAnchor="middle"
                  fontSize={isHov ? "9.5" : "9"}
                  fontWeight={isHov ? "700" : "500"}
                  fill={isHov ? 'var(--accent)' : 'var(--text-3, #9ca3af)'}
                  fontFamily="Inter, ui-sans-serif, system-ui"
                >{shortDate(day.date)}</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* ── Tooltip ── */}
      {hoverDay && (
        <div
          pointerEvents="none"
          style={{
            position:  'absolute',
            top:       Math.max(4, tooltipPos.y - 20),
            left:      tipX,
            width:     TOOLTIP_W,
            background: 'var(--card-bg)',
            border:     '1px solid var(--card-border)',
            borderRadius: 12,
            boxShadow:  '0 8px 32px rgba(0,0,0,0.14)',
            padding:    '10px 12px',
            zIndex:     40,
            pointerEvents: 'none',
          }}
        >
          {/* date + cumulative */}
          <div style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
              {longDate(hoverDay.date)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Cumulative total: <strong style={{ color: 'var(--text-1)' }}>{fmtInr(hoverDay.cum)}</strong>
            </p>
          </div>

          {hoverDay.invoices.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>No invoices on this day</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {hoverDay.invoices.map((inv, ii) => {
                const meta = statusMeta(inv.status, inv.aging)
                return (
                  <div key={ii} style={{
                    background: 'var(--bg-input)',
                    border: `1px solid ${meta.light}`,
                    borderRadius: 8,
                    padding: '7px 9px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>
                        {inv.invoiceNo || `Invoice #${ii + 1}`}
                      </span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700,
                        color: meta.fill,
                        background: meta.light,
                        borderRadius: 20,
                        padding: '2px 7px',
                      }}>{meta.label}</span>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 800, color: meta.dot, marginBottom: 2 }}>{fmtInr(inv.amount)}</p>
                    {inv.project && <p style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {inv.project}</p>}
                    {inv.client  && <p style={{ fontSize: 10, color: 'var(--text-3)' }}>👤 {inv.client}</p>}
                    {inv.raisedBy && <p style={{ fontSize: 10, color: 'var(--text-3)' }}>✍️ {inv.raisedBy}</p>}
                    {inv.aging > 0 && inv.status !== 'Paid' && (
                      <p style={{ fontSize: 10, color: meta.fill, fontWeight: 600, marginTop: 2 }}>⏱ {inv.aging}d aging</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
