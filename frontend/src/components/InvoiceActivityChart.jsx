/**
 * InvoiceActivityChart
 *
 * A pure-SVG chart showing:
 *  - Smooth area curve = cumulative billed over time
 *  - Vertical bars    = individual invoices (height ∝ amount)
 *  - Initials circle  = raised-by person on taller bars
 *  - Date x-axis      = dot per day, label every 2 days
 *
 * Inspired by the project-health timeline aesthetic.
 */
import { useMemo, useRef, useEffect, useState } from 'react'

/* ── helpers ── */
function parseDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
function toDateKey(d) {
  return d.toISOString().slice(0, 10)
}
function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function initials(name = '') {
  return name.trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
}
function shortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur  = pts[i]
    const cx   = (prev.x + cur.x) / 2
    d += ` C${cx},${prev.y} ${cx},${cur.y} ${cur.x},${cur.y}`
  }
  return d
}

/* ── colour by status ── */
function barColor(status, agingDays) {
  if (status === 'Paid')      return { fill: '#22c55e', glow: 'rgba(34,197,94,0.35)' }
  if (status === 'Cancelled') return { fill: '#6b7280', glow: 'rgba(107,114,128,0.2)' }
  // Pending
  const d = Number(agingDays || 0)
  if (d > 30) return { fill: '#fb7185', glow: 'rgba(251,113,133,0.35)' }
  return { fill: '#94a3b8', glow: 'rgba(148,163,184,0.2)' }
}

const AREA_COLOR = '#22c55e'
const AREA_GRADIENT_ID = 'iac-area-grad'
const GLOW_ID = 'iac-area-glow'

// Accepts either:
//   days={60}           → last N days ending today (legacy)
//   from="2024-01-01" to="2024-06-30"  → explicit date range
export default function InvoiceActivityChart({ records = [], days = 60, from, to, className = '' }) {
  const containerRef = useRef(null)
  const [width, setWidth]   = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width || 800)
    })
    ro.observe(el)
    setWidth(el.offsetWidth || 800)
    return () => ro.disconnect()
  }, [])

  /* ── layout constants ── */
  const H         = 210     // total SVG height
  const PAD_TOP   = 36      // room for initials circles
  const PAD_BOT   = 36      // x-axis labels
  const PAD_L     = 8
  const PAD_R     = 16
  const chartH    = H - PAD_TOP - PAD_BOT   // ≈132
  const chartW    = width - PAD_L - PAD_R

  const data = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let start, end
    if (from) {
      start = new Date(from); start.setHours(0,0,0,0)
      end   = to ? new Date(to) : today; end.setHours(0,0,0,0)
    } else {
      end   = today
      start = addDays(today, -(days - 1))
    }

    // Build day → invoices map
    const byDay = {}
    for (const r of records) {
      const f  = r.fields || {}
      const dt = parseDate(f['Raised Date'])
      if (!dt) continue
      const key = toDateKey(dt)
      if (!byDay[key]) byDay[key] = []
      byDay[key].push({
        amount:    Number(f['Amount Raised'] || 0),
        status:    f['Payment Status'] || 'Pending',
        raisedBy:  f['Raised By']      || '',
        invoiceNo: f['Invoice Number'] || '',
        aging:     f['Agening (Days)'] || 0,
      })
    }

    // Build ordered day list
    const allDays = []
    let cum = 0
    // seed cumulative with anything before window
    for (const r of records) {
      const f  = r.fields || {}
      const dt = parseDate(f['Raised Date'])
      if (dt && dt < start) cum += Number(f['Amount Raised'] || 0)
    }
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const key     = toDateKey(d)
      const invoices = byDay[key] || []
      const dayAmt  = invoices.reduce((s, i) => s + i.amount, 0)
      cum += dayAmt
      allDays.push({ date: new Date(d), key, invoices, dayAmt, cum })
    }
    return allDays
  }, [records, days, from, to])

  const maxCum    = Math.max(...data.map(d => d.cum), 1)
  const maxDayAmt = Math.max(...data.map(d => d.dayAmt), 1)

  /* ── coordinate helpers ── */
  const xOf = (i) => PAD_L + (i / (data.length - 1 || 1)) * chartW
  const yOf = (v) => PAD_TOP + chartH - (v / maxCum) * chartH * 0.88

  /* ── area curve ── */
  const areaPoints = data.map((d, i) => ({ x: xOf(i), y: yOf(d.cum) }))
  const linePath   = smoothPath(areaPoints)
  const areaPath   = linePath
    + ` L${xOf(data.length - 1)},${PAD_TOP + chartH}`
    + ` L${xOf(0)},${PAD_TOP + chartH} Z`

  /* ── bar height fn ── */
  const BAR_MIN = 16
  const BAR_MAX = chartH * 0.65
  const barH = (amt) => amt > 0
    ? BAR_MIN + (Math.sqrt(amt / maxDayAmt)) * (BAR_MAX - BAR_MIN)
    : 0

  return (
    <div ref={containerRef} className={`w-full ${className}`} style={{ minHeight: H }}>
      {data.length === 0 ? null : (
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          aria-label="Invoice activity timeline"
          style={{ overflow: 'visible', display: 'block' }}
        >
          <defs>
            {/* Area gradient */}
            <linearGradient id={AREA_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={AREA_COLOR} stopOpacity="0.28" />
              <stop offset="60%"  stopColor={AREA_COLOR} stopOpacity="0.08" />
              <stop offset="100%" stopColor={AREA_COLOR} stopOpacity="0" />
            </linearGradient>
            {/* Glow filter for area line */}
            <filter id={GLOW_ID} x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* ── area fill ── */}
          <path d={areaPath} fill={`url(#${AREA_GRADIENT_ID})`} />

          {/* ── area line ── */}
          <path
            d={linePath}
            fill="none"
            stroke={AREA_COLOR}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${GLOW_ID})`}
          />

          {/* ── event bars ── */}
          {data.map((day, i) => {
            if (!day.invoices.length) return null
            const x   = xOf(i)
            const h   = barH(day.dayAmt)
            const bot = PAD_TOP + chartH
            const top = bot - h

            // merge all invoices on this day into one bar (stack or single colour)
            // use the "worst" status for colour
            const statuses = day.invoices.map(inv => inv.status)
            const dominant = statuses.includes('Pending') ? 'Pending'
              : statuses.includes('Paid') ? 'Paid' : 'Cancelled'
            const aging = Math.max(...day.invoices.map(inv => Number(inv.aging || 0)))
            const { fill, glow } = barColor(dominant, aging)

            // initials: first person on this day
            const name = day.invoices[0].raisedBy
            const ini  = initials(name)

            // show initials only if bar is tall enough
            const showInitials = h > 30

            return (
              <g key={day.key}>
                {/* glow behind bar */}
                <line
                  x1={x} y1={top} x2={x} y2={bot}
                  stroke={glow}
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {/* bar */}
                <line
                  x1={x} y1={top} x2={x} y2={bot}
                  stroke={fill}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                {/* initials circle */}
                {showInitials && (
                  <g>
                    <circle cx={x} cy={top - 11} r="11" fill="#d1d5db" stroke="white" strokeWidth="1.5" />
                    <text
                      x={x} y={top - 11}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="8"
                      fontWeight="700"
                      fill="#374151"
                      fontFamily="Inter, ui-sans-serif, system-ui"
                      letterSpacing="0.02em"
                    >
                      {ini}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* ── x-axis ── */}
          {data.map((day, i) => {
            const x      = xOf(i)
            // Show ~8 labels max: pick interval so we get roughly one per week
            const labelEvery = Math.max(1, Math.round(data.length / 8))
            const isLabel = i % labelEvery === 0 || i === data.length - 1
            const hasInv  = day.invoices.length > 0

            return (
              <g key={`xax-${day.key}`}>
                {/* dot */}
                <circle
                  cx={x}
                  cy={PAD_TOP + chartH + 10}
                  r={hasInv ? 3.5 : 2}
                  fill={hasInv ? 'var(--accent)' : 'var(--card-border, rgba(0,0,0,0.12))'}
                  opacity={hasInv ? 1 : 0.5}
                />
                {/* label every other day */}
                {isLabel && (
                  <text
                    x={x}
                    y={H - 4}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--text-3, #9ca3af)"
                    fontFamily="Inter, ui-sans-serif, system-ui"
                    fontWeight="500"
                  >
                    {shortDate(day.date)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
