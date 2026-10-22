/**
 * Analytics: billed against collected, month by month, on the sandbox ledger.
 *
 * monthly() buckets the same invoices every other demo reads, so the
 * collection rate and days to collect above the chart are TOTALS' own
 * (40% and 22 days on the sample ledger, as the analytics capture shows).
 * Changing the window regrows the bars and rolls the window's totals; the
 * bars grow by scaleY, never by height.
 */
import { useMemo, useState } from 'react'
import { TOTALS, monthly, inr, inrShort } from '../demoData'
import { useReveal } from '../../hooks/useReveal'
import { useInk } from '../../hooks/useInk'
import RollNumber from '../motion/RollNumber'

const WINDOWS = [3, 6, 12]
const sum = (rows, k) => rows.reduce((t, r) => t + r[k], 0)

export default function AnalyticsTrend() {
  const [win, setWin] = useState(6)
  const ref = useReveal({ threshold: 0.25 })
  const ink = useInk(WINDOWS.indexOf(win))
  const rows = useMemo(() => monthly(win), [win])
  const peak = Math.max(1, ...rows.map(r => Math.max(r.billed, r.collected)))

  return (
    <div ref={ref} className="ft-f-demo ft-f-grow">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="ft-f-kicker" style={{ margin: 0 }}>Billed and collected, by month</p>
        <div ref={ink} className="ft-m-ink ft-f-seg" role="group" aria-label="Window">
          {WINDOWS.map(w => (
            <button key={w} type="button" aria-pressed={w === win} onClick={() => setWin(w)}>{w}M</button>
          ))}
          <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
        </div>
      </div>

      <dl className="ft-f-kpis">
        <div><dt>Collection rate</dt><dd><RollNumber value={TOTALS.collectionRate} format={n => `${Math.round(n)}%`} align="start" /></dd></div>
        <div><dt>Days to collect</dt><dd><RollNumber value={TOTALS.avgDaysToCollect} format={n => `${Math.round(n)} d`} align="start" /></dd></div>
        <div><dt>Billed · {win}M</dt><dd><RollNumber value={sum(rows, 'billed')} format={inrShort} align="start" /></dd></div>
        <div><dt>Collected · {win}M</dt><dd><RollNumber value={sum(rows, 'collected')} format={inrShort} align="start" /></dd></div>
      </dl>

      <div key={win} className="ft-f-chart" data-n={rows.length}
           role="img" aria-label={`Sample data: billed and collected for each of the last ${win} months`}>
        {rows.map((r, i) => (
          <div key={r.key + i} className="flex-1 flex flex-col items-center h-full min-w-0">
            <div className="flex-1 w-full flex items-end justify-center gap-0.5">
              <span className="ft-f-vbar" data-k="billed" title={`${r.key} billed ${inr(r.billed)}`}
                    style={{ '--s': r.billed / peak, '--i': Math.min(i, 11) }} />
              <span className="ft-f-vbar" data-k="collected" title={`${r.key} collected ${inr(r.collected)}`}
                    style={{ '--s': r.collected / peak, '--i': Math.min(i, 11) }} />
            </div>
            <span className="ft-f-col-label">{r.key}</span>
          </div>
        ))}
      </div>
      <p className="ft-f-foot">
        <span className="ft-f-key" data-k="billed" /> billed <span className="ft-f-key" data-k="collected" /> collected ·
        sample data; every bar opens to its invoices in the app.
      </p>
    </div>
  )
}
