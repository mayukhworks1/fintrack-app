/**
 * Projects: billed, cost and margin per project, on the sandbox ledger.
 *
 * PROJECT_ROLLUP derives billed from the invoices and margin from billed
 * less cost, so nothing here is typed in: Site rebuild reads ₹18,21,000
 * billed and a 76% margin because its four invoices and its cost say so —
 * the same figures the projects capture shows.
 *
 * Each bar is the project's billing against the largest, split into cost
 * and profit. They grow once when first reached; picking a project rolls
 * the four figures above to it.
 */
import { useState } from 'react'
import { PROJECT_ROLLUP, inr } from '../demoData'
import { useReveal } from '../../hooks/useReveal'
import RollNumber from '../motion/RollNumber'

const MAX = Math.max(...PROJECT_ROLLUP.map(p => p.billed))
const HEALTH = { healthy: 'Healthy', watch: 'Watch', risk: 'At risk' }
const pct = (n) => `${Math.round(n)}%`
const COST = 'color-mix(in srgb, var(--text-3) 38%, transparent)'

export default function ProjectMargins() {
  const [sel, setSel] = useState(() => Math.max(0, PROJECT_ROLLUP.findIndex(p => p.id === 'p3')))
  const ref = useReveal({ threshold: 0.25 })
  const p = PROJECT_ROLLUP[sel]

  return (
    <div ref={ref} className="ft-f-demo ft-f-grow">
      <div className="flex items-start justify-between gap-2.5 mb-2.5">
        <div className="min-w-0">
          <p className="ft-f-kicker">{p.client}</p>
          <p className="m-0 text-[18px] font-extrabold text-[var(--text-1)]">{p.name}</p>
        </div>
        <span className="ft-f-tag" data-tone={p.health === 'healthy' ? 'ok' : p.health === 'risk' ? 'bad' : 'warn'}>
          {HEALTH[p.health]}
        </span>
      </div>
      <dl className="ft-f-kpis">
        <div><dt>Billed</dt><dd><RollNumber value={p.billed} format={inr} align="start" /></dd></div>
        <div><dt>Cost</dt><dd><RollNumber value={p.cost} format={inr} align="start" /></dd></div>
        <div><dt>Profit</dt><dd><RollNumber value={p.profit} format={inr} align="start" /></dd></div>
        <div><dt>Margin</dt><dd><RollNumber value={p.margin} format={pct} align="start" /></dd></div>
      </dl>

      <div className="flex flex-col gap-1" role="group" aria-label="Projects">
        {PROJECT_ROLLUP.map((r, i) => {
          const on = i === sel
          const costShare = r.billed ? Math.min(1, r.cost / r.billed) : 1
          return (
            <button key={r.id} type="button" aria-pressed={on} onClick={() => setSel(i)} className="ft-f-pm-row">
              <span className="flex flex-col min-w-0 leading-tight">
                <b className="text-[12.5px] text-[var(--text-1)]">{r.name}</b>
                <span className="text-[10.5px] text-[var(--text-3)] truncate">{r.client}</span>
              </span>
              <span className="ft-f-track" style={{ height: 10, background: 'transparent' }}>
                <span className="ft-f-bar" style={{ '--s': r.billed / MAX, '--i': i, borderRadius: 3 }}>
                  <span style={{ flex: `${costShare} 0 0`, background: COST }} />
                  <span style={{ flex: `${1 - costShare} 0 0`, background: 'var(--accent-btn)' }} />
                </span>
              </span>
              <span className="text-[12.5px] font-extrabold text-[var(--text-1)] text-right tabular-nums">{r.margin}%</span>
            </button>
          )
        })}
      </div>
      <p className="ft-f-foot">
        <span className="ft-f-key" data-k="cost" /> cost <span className="ft-f-key" data-k="profit" /> profit ·
        sample data; margin is billed less cost, so a project cannot claim a margin its invoices do not support.
      </p>
    </div>
  )
}
