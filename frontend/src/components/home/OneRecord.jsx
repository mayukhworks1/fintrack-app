/**
 * One sample invoice, and the four places it shows up.
 *
 * The page's claim is that delivery and money sit on one set of records. This
 * draws that for a single row: INV-2296 in the middle, and the invoice list,
 * the status board, the tax ledger and the analyst around it, each showing
 * what it reads from that same row. Every figure comes from demoData; none is
 * typed here.
 *
 * Motion: the five cards rise in order, then the four connectors draw once,
 * and that is all. No loop and no timer. Each satellite is a button that opens
 * its module in the sandbox below (the sandbox listens for `ft-switch-tab`),
 * and pointing at one lights its connector.
 *
 * `variant="chips"` is the same idea as one row of buttons, for widths where
 * the drawing does not fit beside the headline.
 */
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { INVOICES, DELIVERY, ask, inr, shortDate } from '../demoData'
import { useReveal } from '../../hooks/useReveal'

const INV = INVOICES.find(i => i.id === 'INV-2296')
const CARD = DELIVERY.find(d => d.id === INV.projectId)
const ANSWER = ask({ measure: 'outstanding', groupBy: 'client' })
const CLIENT_ROW = ANSWER.rows.find(r => r.key === INV.client)

/** The four places, in reading order. Exported for the tests. */
export const PLACES = [
  {
    key: 'invoices', tab: 'receivables', label: 'Invoices',
    main: `${INV.id} · ${INV.status}`,
    sub: INV.daysOverdue ? `due ${shortDate(INV.dueOn)}, ${INV.daysOverdue} days over` : `due ${shortDate(INV.dueOn)}`,
    at: { x: 0, y: 0 }, end: [90, 100], wire: 'M 170 165 C 170 132, 90 132, 90 100',
  },
  {
    key: 'status', tab: 'delivery', label: 'Status Board',
    main: CARD.lane,
    sub: CARD.short,
    at: { x: 260, y: 0 }, end: [350, 100], wire: 'M 270 165 C 270 132, 350 132, 350 100',
  },
  {
    key: 'tax', tab: 'tax', label: 'Tax Ledger',
    main: `GST ${inr(INV.gst)}`,
    sub: `TDS ${inr(INV.tds)} withheld`,
    at: { x: 0, y: 320 }, end: [90, 320], wire: 'M 170 255 C 170 288, 90 288, 90 320',
  },
  {
    key: 'analyst', tab: 'analyst', label: 'AI Assistant',
    main: INV.client,
    sub: CLIENT_ROW ? `${ANSWER.format(CLIENT_ROW.value)} owed, the most` : 'owes the most',
    code: ANSWER.sql.split('\n')[0],
    at: { x: 260, y: 320 }, end: [350, 320], wire: 'M 270 255 C 270 288, 350 288, 350 320',
  },
]

const W = 440, H = 420
const pc = (v, of) => `${(v / of) * 100}%`

function open(tab) {
  window.dispatchEvent(new CustomEvent('ft-switch-tab', { detail: tab }))
}

export default function OneRecord({ variant = 'diagram' }) {
  const ref = useReveal({ threshold: 0.2 })
  const [hot, setHot] = useState(null)

  if (variant === 'chips') {
    return (
      <div className="ft-h-one-chips" aria-label="One sample record, in four places">
        <span className="ft-h-one-chip-id">{INV.id}</span>
        <ArrowRight size={13} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
        {PLACES.map(p => (
          <button key={p.key} type="button" className="ft-h-one-chip" onClick={() => open(p.tab)}>
            {p.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={ref} className="ft-h-one" data-hot={hot || undefined}>
      <svg className="ft-h-one-wires" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {PLACES.map((p, i) => (
          <path key={p.key} d={p.wire} pathLength="1" data-k={p.key}
                className="ft-h-one-wire ft-m-draw" style={{ '--d': `${420 + i * 90}ms` }} />
        ))}
        {PLACES.map(p => <circle key={p.key} cx={p.end[0]} cy={p.end[1]} r="3.5" className="ft-h-one-end" />)}
      </svg>

      <ol className="ft-h-one-nodes ft-m-seq">
        <li className="ft-h-one-core" style={{ '--i': 0, left: pc(115, W), top: pc(165, H), width: pc(210, W), height: pc(90, H) }}>
          <span className="ft-h-one-k">One sample record</span>
          <span className="ft-h-one-id">{INV.id}</span>
          <span className="ft-h-one-sub">{INV.client} · {INV.project}</span>
          <span className="ft-h-one-amt">{inr(INV.amount)} <span>pre-tax</span></span>
        </li>
        {PLACES.map((p, i) => (
          <li key={p.key} style={{ '--i': i + 1, left: pc(p.at.x, W), top: pc(p.at.y, H), width: pc(180, W), height: pc(100, H) }}>
            <button type="button" className="ft-h-one-node" data-k={p.key}
                    onClick={() => open(p.tab)}
                    onMouseEnter={() => setHot(p.key)} onMouseLeave={() => setHot(h => (h === p.key ? null : h))}
                    onFocus={() => setHot(p.key)} onBlur={() => setHot(h => (h === p.key ? null : h))}>
              <span className="ft-h-one-k">{p.label}</span>
              <span className="ft-h-one-main">{p.main}</span>
              <span className="ft-h-one-sub">{p.sub}</span>
              {p.code && <span className="ft-h-one-mono">{p.code}</span>}
              <span className="sr-only">. Open it in the sandbox</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
