/**
 * Receivables by age.
 *
 * The panel this replaces was titled "Receivables heat map" and rendered a list
 * of four counts — no map, no heat, and no sense of how much money sat in each
 * band. A count also answers the wrong question: ten small invoices at 90 days
 * matter less than one large one, and the old panel could not tell you which
 * you had.
 *
 * Form: the job is comparing magnitude across an ordered set of bands, so this
 * is a bar chart on one axis with a single-hue ordinal ramp — darker means
 * older. Horizontal, because the value labels sit at the end of each bar where
 * they are read without a second pass.
 *
 * The bars are deliberately flat while the card around them tilts. Perspective
 * shortens whatever is further away, so a bar drawn in 3D reads as a smaller
 * number than an identical bar at the front — the one place in this interface
 * where depth would actively lie.
 *
 * The ramp steps are taken from the validated ordinal scale: on a light surface
 * the lightest step must still clear 2:1 against it, which rules out the pale
 * tints that would otherwise look natural at the "fresh" end.
 */
import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useTilt } from '../hooks/useTilt'

// Ordinal ramp, light→dark with age. Validated against both surfaces:
// monotone lightness, adjacent ΔL ≥ 0.06, single hue, light end ≥ 2:1.
const RAMP_LIGHT = ['#86b6ef', '#3987e5', '#256abf', '#104281']
const RAMP_DARK  = ['#184f95', '#256abf', '#3987e5', '#86b6ef']

function money(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`
  if (Math.abs(v) >= 1000) return `₹${Math.round(v / 1000)}k`
  return `₹${Math.round(v)}`
}

function exact(n) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export default function AgingRunway({
  buckets = [],
  selected = '',
  onSelect,
  dark = false,
  title = 'Receivables by age',
  eyebrow = 'Aging buckets',
}) {
  const tilt = useTilt({ max: 5 })
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const ramp = dark ? RAMP_DARK : RAMP_LIGHT

  const rows = useMemo(() => {
    const list = (buckets || []).map((b, i) => ({
      label: b.label ?? '',
      count: Number(b.count) || 0,
      amount: Number(b.amount) || 0,
      color: ramp[Math.min(i, ramp.length - 1)],
    }))
    const total = list.reduce((sum, b) => sum + b.amount, 0)
    // Scale to the largest bar, not the total: against the total a small band
    // becomes a sliver with no readable length.
    const peak = Math.max(...list.map(b => b.amount), 1)
    return list.map(b => ({
      ...b,
      pct: total > 0 ? (b.amount / total) * 100 : 0,
      width: (b.amount / peak) * 100,
    }))
  }, [buckets, ramp])

  const total = rows.reduce((sum, b) => sum + b.amount, 0)
  const overdue = rows.slice(2).reduce((sum, b) => sum + b.amount, 0)

  if (!rows.length) return null

  return (
    <div
      ref={tilt}
      className="tilt tilt-sheen rounded-[26px] p-4 sm:p-5"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]"
             style={{ color: 'var(--text-3)' }}>{eyebrow}</p>
          <h2 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>{title}</h2>
        </div>
        <ShieldAlert size={18} style={{ color: 'var(--fin-warning)' }} aria-hidden="true" />
      </div>

      {/* The headline the old panel never gave: how much is actually old. */}
      <p className="text-[12px] mb-4" style={{ color: 'var(--text-2)' }}>
        <span className="font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
          {money(overdue)}
        </span>{' '}
        past 60 days, of {money(total)} outstanding
      </p>

      <div className="flex flex-col gap-[2px]" role="list">
        {rows.map((row, i) => {
          const isSelected = selected === row.label
          const isHover = hover === row.label
          return (
            <button
              key={row.label || i}
              type="button"
              role="listitem"
              onClick={() => onSelect?.(isSelected ? '' : row.label)}
              onPointerEnter={() => setHover(row.label)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(row.label)}
              onBlur={() => setHover(null)}
              aria-pressed={isSelected}
              aria-label={`${row.label}: ${exact(row.amount)} across ${row.count} invoice${row.count === 1 ? '' : 's'}`}
              className="group w-full text-left rounded-lg px-2 py-2"
              style={{
                background: isSelected ? 'var(--row-selected)' : 'transparent',
                outline: isSelected ? '1px solid var(--accent-soft)' : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {row.label}
                </span>
                {/* Direct label — the value is read off the bar, not a tooltip. */}
                <span className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {money(row.amount)}
                </span>
              </div>

              {/* Track + fill. The track is the recessive element; the fill
                  carries the ramp step and a 4px end radius. */}
              <div
                className="relative w-full overflow-hidden"
                style={{ height: 10, borderRadius: 4, background: 'var(--bg-input)' }}
              >
                <div
                  style={{
                    width: `${Math.max(row.width, row.amount > 0 ? 2 : 0)}%`,
                    height: '100%',
                    borderRadius: 4,
                    background: row.color,
                    transition: 'width 420ms cubic-bezier(0.22, 1, 0.36, 1), filter 160ms ease',
                    filter: isHover || isSelected ? 'brightness(1.08)' : 'none',
                  }}
                />
              </div>

              <div className="flex items-baseline justify-between gap-3 mt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {row.count} invoice{row.count === 1 ? '' : 's'}
                </span>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {row.pct.toFixed(0)}% of outstanding
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Every figure is already on screen, so the table is a precision view
          rather than the only way to reach the numbers. */}
      <button
        type="button"
        onClick={() => setShowTable(v => !v)}
        className="mt-3 text-[11px] font-semibold"
        style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        aria-expanded={showTable}
      >
        {showTable ? 'Hide exact figures' : 'Show exact figures'}
      </button>

      {showTable && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <caption className="sr-only">Outstanding receivables by age band</caption>
            <thead>
              <tr style={{ color: 'var(--text-3)' }}>
                <th scope="col" className="text-left font-semibold py-1">Band</th>
                <th scope="col" className="text-right font-semibold py-1">Invoices</th>
                <th scope="col" className="text-right font-semibold py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.label || i} style={{ borderTop: '1px solid var(--card-border)' }}>
                  <th scope="row" className="text-left font-medium py-1"
                      style={{ color: 'var(--text-1)' }}>{row.label}</th>
                  <td className="text-right tabular-nums py-1" style={{ color: 'var(--text-2)' }}>{row.count}</td>
                  <td className="text-right tabular-nums py-1" style={{ color: 'var(--text-2)' }}>{exact(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
