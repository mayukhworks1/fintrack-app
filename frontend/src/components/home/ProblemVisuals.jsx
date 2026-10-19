/**
 * One picture per problem card on the home page, each drawn from the sample
 * ledger and each revealed once, when its card is reached (the card's Reveal
 * carries [data-shown]). They are illustrations of the card's sentence, so
 * they are hidden from assistive tech; the card's text says the same thing.
 *
 *   TotalOpens   the overdue total, and the three largest rows under it
 *   TaxSplit     one sample invoice (INV-2296): billed, GST added, TDS withheld
 *                inside the billed amount, and what lands; its bar is the
 *                tax panel's below, drawn in when the card is reached
 *   QueryShown   a question, the first lines of the SQL the code wrote, and
 *                the answer: the analyst's claim, without the loop
 */
import { INVOICES, TOTALS, ask, inr, inrShort } from '../demoData'
import RollNumber from '../motion/RollNumber'

const OVERDUE = INVOICES.filter(i => i.status === 'Overdue').sort((a, b) => b.amount - a.amount)
const ANSWER = ask({ measure: 'outstanding', groupBy: 'client' })
const INV = INVOICES.find(i => i.id === 'INV-2296') || INVOICES[0]

export function TotalOpens() {
  const top = OVERDUE.slice(0, 3)
  return (
    <div className="ft-h-viz ft-h-total" aria-hidden="true">
      <div className="ft-h-total-head">
        <span>Overdue</span>
        <RollNumber value={TOTALS.overdue} format={inr} className="ft-h-fig" />
      </div>
      <ol className="ft-h-total-rows ft-m-seq">
        {top.map((r, i) => (
          <li key={r.id} style={{ '--i': i + 1 }}>
            <span className="truncate">{r.id} · {r.client}</span>
            <span className="tabular-nums">{inrShort(r.amount)}</span>
          </li>
        ))}
      </ol>
      <span className="ft-h-total-more">+ {OVERDUE.length - top.length} more rows beneath it</span>
    </div>
  )
}

export function TaxSplit() {
  const invoice = INV.amount + INV.gst
  const lands = invoice - INV.tds
  const at = (n) => `${(n / invoice) * 100}%`
  const seg = (x, w, tone, hatch) => (
    <span className={`ft-h-seg${hatch ? ' ft-h-seg-hatch' : ''}`}
          style={{ '--x': at(x), '--w': w / invoice, '--tone': tone }} />
  )
  return (
    <div className="ft-h-viz ft-h-taxviz" aria-hidden="true">
      <div className="ft-h-total-head">
        <span>{INV.id} lands</span>
        <span className="ft-h-fig">{inr(lands)}</span>
      </div>
      {/* The tax panel's bar: the TDS sits inside what was billed. */}
      <span className="ft-h-bar">
        {seg(0, INV.amount - INV.tds, 'var(--accent)')}
        {seg(INV.amount - INV.tds, INV.tds, null, true)}
        {seg(INV.amount, INV.gst, 'var(--text-3)')}
      </span>
      <ol className="ft-h-total-rows ft-m-seq">
        <li style={{ '--i': 1 }}><span>Billed</span><span className="tabular-nums">{inr(INV.amount)}</span></li>
        <li style={{ '--i': 2 }}><span>+ GST 18%</span><span className="tabular-nums">{inr(INV.gst)}</span></li>
        <li style={{ '--i': 3 }}><span>− TDS 10%, withheld</span><span className="tabular-nums">{inr(INV.tds)}</span></li>
      </ol>
    </div>
  )
}

export function QueryShown() {
  const lines = ANSWER.sql.split('\n')
  const top = ANSWER.rows[0]
  return (
    <div className="ft-h-viz ft-h-query" aria-hidden="true">
      <ol className="ft-m-seq">
        <li className="ft-h-query-q" style={{ '--i': 0 }}>Which clients owe the most?</li>
        <li className="ft-h-query-sql" style={{ '--i': 1 }}>
          <span>{lines[0]}</span>
          <span>{lines[1].trim()}</span>
          <span>{(lines.find(l => l.includes('GROUP BY')) || '').trim()}</span>
        </li>
        <li className="ft-h-query-a" style={{ '--i': 2 }}>
          <span className="truncate">{top.key}</span>
          <span className="tabular-nums">{ANSWER.format(top.value)}</span>
        </li>
      </ol>
    </div>
  )
}
