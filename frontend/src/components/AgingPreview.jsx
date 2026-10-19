/**
 * The receivables aging view, working, on the sandbox ledger.
 *
 * Every figure is read from demoData: the four bands are AGEING, their
 * values sum to TOTALS.outstanding, and picking a band lists the invoices
 * that are actually in it. The point of showing it working rather than as a
 * picture is what the module does: pick a band and the total and the rows
 * follow.
 *
 * Motion: the bars grow from the left the first time the block is reached
 * (transform only), the total rolls when a band is picked, and the rows
 * arrive in order. Under reduced motion all of it is simply there.
 */
import { useState } from 'react'
import { AGEING, TOTALS, open, inr, shortDate } from './demoData'
import { useReveal } from '../hooks/useReveal'
import RollNumber from './motion/RollNumber'

const TONES = ['#86b6ef', '#3987e5', '#256abf', '#104281']
const PEAK = Math.max(...AGEING.map(b => b.value))
const OLDEST = [...open].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 3)

export default function AgingPreview() {
  const [sel, setSel] = useState(null)
  const ref = useReveal({ threshold: 0.25 })
  const band = sel === null ? null : AGEING[sel]
  const shown = band ? band.value : TOTALS.outstanding

  return (
    <div ref={ref} className="ft-f-demo ft-f-grow">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <p className="ft-f-kicker">{band ? `Outstanding · ${band.label}` : 'Total outstanding'}</p>
          <p className="ft-f-big"><RollNumber value={shown} format={inr} align="start" /></p>
        </div>
        <button type="button" onClick={() => setSel(null)} className="ft-f-ghost"
                style={{ visibility: band ? 'visible' : 'hidden' }} tabIndex={band ? 0 : -1}>
          Show all bands
        </button>
      </div>

      <div className="flex flex-col gap-1.5" role="group" aria-label="Ageing bands">
        {AGEING.map((b, i) => {
          const on = sel === i
          const share = Math.round((b.value / TOTALS.outstanding) * 100)
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(on ? null : i)}
              className="ft-f-band"
              data-dim={sel !== null && !on ? '' : undefined}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {b.label}
                  <span className="font-medium text-[11px] ml-1.5" style={{ color: 'var(--text-3)' }}>
                    {b.count} invoice{b.count === 1 ? '' : 's'} · {share}%
                  </span>
                </span>
                <span className="text-[12.5px] font-bold tabular-nums" style={{ color: on ? 'var(--accent-ink, var(--accent))' : 'var(--text-1)' }}>
                  {inr(b.value)}
                </span>
              </span>
              <span className="ft-f-track">
                <span className="ft-f-bar" style={{ '--s': b.value / PEAK, '--i': i, background: TONES[i] }} />
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4" aria-live="polite">
        <p className="ft-f-kicker" style={{ margin: '0 0 4px' }}>{band ? `In ${band.label}` : 'Most overdue'}</p>
        <ul key={band ? band.id : 'all'} className="ft-f-rowlist">
          {(band ? band.rows.slice(0, 3) : OLDEST).map((r, i) => (
            <li key={r.id} style={{ '--i': i }}>
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{r.id}</span>
              <span className="truncate" style={{ color: 'var(--text-2)' }}>{r.client}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-3)' }}>
                {r.daysOverdue ? `${r.daysOverdue}d overdue` : `due ${shortDate(r.dueOn)}`}
              </span>
              <span className="font-bold tabular-nums text-right" style={{ color: 'var(--text-1)' }}>{inr(r.amount)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="ft-f-foot">Sample data: the same ledger the sandbox on the overview runs on.</p>
    </div>
  )
}
