/**
 * An interactive preview of the receivables aging view.
 *
 * Illustrative, not real: the figures are invented, and the whole block is
 * marked aria-hidden by its caller so a screen reader does not announce them
 * as someone's receivables.
 *
 * It is interactive rather than a picture because the thing worth showing is
 * what the module *does* — pick a band, the total and the breakdown follow.
 * A screenshot cannot demonstrate that.
 */
import { useState } from 'react'

const BANDS = [
  { label: '0-30d',  amount: 100000, count: 3, tone: '#86b6ef' },
  { label: '31-60d', amount:  50000, count: 1, tone: '#3987e5' },
  { label: '61-90d', amount: 250000, count: 2, tone: '#256abf' },
  { label: '90d+',   amount: 600000, count: 4, tone: '#104281' },
]
const TOTAL = BANDS.reduce((s, b) => s + b.amount, 0)
const inr = n => `₹${n.toLocaleString('en-IN')}`

export default function AgingPreview() {
  const [sel, setSel] = useState(null)
  const shown = sel === null ? TOTAL : BANDS[sel].amount
  const peak = Math.max(...BANDS.map(b => b.amount))

  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-3)' }}>
            {sel === null ? 'Total outstanding' : `Outstanding · ${BANDS[sel].label}`}
          </p>
          <p className="font-extrabold tabular-nums"
             style={{ fontSize: 'clamp(1.4rem, 4vw, 2rem)', letterSpacing: '-0.02em',
                      color: 'var(--text-1)', transition: 'color 200ms ease' }}>
            {inr(shown)}
          </p>
        </div>
        {sel !== null && (
          <button onClick={() => setSel(null)}
                  className="text-[11px] font-semibold rounded-lg"
                  style={{ minHeight: 32, padding: '0 10px', color: 'var(--accent)',
                           background: 'var(--accent-dim)', border: 'none', cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {BANDS.map((b, i) => {
          const on = sel === i
          const dim = sel !== null && !on
          const pct = Math.round((b.amount / TOTAL) * 100)
          return (
            <button
              key={b.label}
              onClick={() => setSel(on ? null : i)}
              className="w-full text-left rounded-lg px-2.5 py-2"
              style={{
                background: on ? 'var(--row-selected)' : 'var(--bg-input)',
                border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
                opacity: dim ? 0.45 : 1,
                transition: 'all 200ms ease',
              }}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {b.label} <span className="font-normal text-[11px]" style={{ color: 'var(--text-3)' }}>({pct}%)</span>
                </span>
                <span className="text-[12px] font-bold tabular-nums" style={{ color: on ? 'var(--accent)' : 'var(--text-1)' }}>
                  {inr(b.amount)}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--card-border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, background: b.tone,
                  width: `${(b.amount / peak) * 100}%`,
                  transition: 'width 620ms cubic-bezier(0.22,1,0.36,1), filter 200ms ease',
                  filter: on ? 'brightness(1.15)' : 'none',
                }} />
              </div>
              <div className="flex items-center justify-between mt-1 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                <span>{b.count} invoice{b.count === 1 ? '' : 's'}</span>
                {i === 3 && <span style={{ color: 'var(--bad)', fontWeight: 600 }}>High collection priority</span>}
                {i === 0 && <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Within normal terms</span>}
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-[10px] mt-3" style={{ color: 'var(--text-3)' }}>
        Illustrative figures — click any aging band to isolate its risk profile.
      </p>
    </div>
  )
}
