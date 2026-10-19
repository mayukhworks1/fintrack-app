/**
 * What counting the tax does to a receivables figure, at your own numbers.
 *
 * Drag a monthly billing figure (pre-tax) and the invoice opens into its
 * parts. Everything is computed live from the two rates in demoData, nothing
 * is fetched, and the arithmetic is the invoice drawer's:
 *
 *   invoice total        B × (1 + GST)        what the document says
 *   withheld at source   B × TDS              the client pays it to the state
 *   cash the client pays B × (1 + GST − TDS)
 *   GST, for the state   B × GST
 *   yours                B × (1 − TDS)
 *
 * So a report that shows the invoice total as outstanding overstates the cash
 * coming by the TDS, and the money that is yours by the GST and the TDS.
 *
 * The slider is a real range input: a custom one would need keyboard
 * handling, ARIA and touch geometry rebuilt from nothing to end up where the
 * native control already is. The bars move by transform only, the billed
 * figure rolls, and the figures are set in Outfit rather than Fraunces, so the
 * ₹ sign does not pull in a second display font file.
 */
import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { GST_RATE, TDS_RATE, inr } from './demoData'
import { useReveal } from '../hooks/useReveal'
import RollNumber from './motion/RollNumber'

const STOPS = [200000, 500000, 1000000, 2500000, 5000000, 10000000]

/** Compact Indian notation: ₹25L reads faster than ₹25,00,000 on a tick. */
const short = (n) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`
  : `₹${Math.round(n / 1000)}K`

/** Every figure the panel shows, from the pre-tax billing. Exported for the tests. */
export function split(billed) {
  const gst = Math.round(billed * GST_RATE)
  const tds = Math.round(billed * TDS_RATE)
  return {
    billed,
    gst,
    tds,
    invoice: billed + gst,          // B × (1 + GST)
    cash: billed + gst - tds,       // B × (1 + GST − TDS)
    yours: billed - tds,            // B × (1 − TDS)
  }
}

const pct = (n, of) => `${(n / of) * 100}%`

/** One segment of a bar: placed and sized by transform, so it can move. */
function Seg({ x, w, tone, label, hatch = false }) {
  return (
    <span className={`ft-h-seg${hatch ? ' ft-h-seg-hatch' : ''}`}
          style={{ '--x': x, '--w': w, '--tone': tone }}
          title={label} />
  )
}

export default function Overstatement() {
  // Indexed rather than continuous: a linear slider over two orders of
  // magnitude spends most of its travel in a range nobody is in.
  const [i, setI] = useState(2)
  const f = split(STOPS[i])
  const ref = useReveal({ threshold: 0.3 })

  // Both bars are drawn against the invoice total.
  const of = f.invoice
  const scale = (n) => String(n / of)

  return (
    <div ref={ref} className="ft-h-over ft-reveal rounded-2xl overflow-hidden"
         style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap"
           style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
        <TrendingUp size={14} aria-hidden="true" style={{ color: 'var(--accent-ink, var(--accent))' }} />
        <span className="font-bold" style={{ fontSize: 12, color: 'var(--text-1)' }}>
          What one invoice is made of
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          drag your monthly billing · GST {Math.round(GST_RATE * 100)}%, TDS {Math.round(TDS_RATE * 100)}%
        </span>
      </div>

      <div className="p-4 sm:p-6">
        <label className="block mb-6">
          <span className="flex items-baseline justify-between mb-2 gap-3">
            <span className="font-bold uppercase tracking-[0.14em]"
                  style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
              Billed per month, pre-tax
            </span>
            <span className="ft-h-fig" style={{ fontSize: 'clamp(1.3rem, 3.4vw, 1.9rem)', color: 'var(--accent-ink, var(--accent))' }}>
              <RollNumber value={f.billed} format={inr} />
            </span>
          </span>
          <input
            type="range"
            className="ft-range"
            min={0} max={STOPS.length - 1} step={1}
            value={i}
            onChange={e => setI(Number(e.target.value))}
            aria-label="Monthly billing, pre-tax"
            aria-valuetext={inr(f.billed)}
          />
          <span className="flex justify-between mt-1.5" aria-hidden="true">
            {STOPS.map((s, n) => (
              <span key={s} style={{ fontSize: 10, color: n === i ? 'var(--accent-ink, var(--accent))' : 'var(--text-3)',
                                     fontWeight: n === i ? 700 : 500 }}>
                {short(s)}
              </span>
            ))}
          </span>
        </label>

        <div className="ft-h-bars" aria-hidden="true">
          <div className="ft-h-bar-row">
            <span className="ft-h-bar-label">Invoice</span>
            <span className="ft-h-bar">
              {/* receivable (pre-tax), with the TDS inside it, then the GST */}
              <Seg x="0%" w={scale(f.billed - f.tds)} tone="var(--accent)" label="Receivable, less TDS" />
              <Seg x={pct(f.billed - f.tds, of)} w={scale(f.tds)} tone="var(--warn)" hatch label="TDS withheld" />
              <Seg x={pct(f.billed, of)} w={scale(f.gst)} tone="var(--text-3)" label="GST" />
            </span>
          </div>
          <div className="ft-h-bar-row">
            <span className="ft-h-bar-label">Yours</span>
            <span className="ft-h-bar">
              <Seg x="0%" w={scale(f.yours)} tone="var(--ok)" label="Yours" />
            </span>
          </div>
          <div className="ft-h-bar-key">
            <span><i style={{ background: 'var(--accent-btn)' }} />receivable</span>
            <span><i className="ft-h-key-hatch" />TDS, inside it</span>
            <span><i style={{ background: 'var(--text-3)' }} />GST</span>
            <span><i style={{ background: 'var(--ok)' }} />yours</span>
          </div>
        </div>

        <dl className="ft-h-split">
          {[
            ['Invoice total', f.invoice, 'what the document says', 'var(--text-1)'],
            ['Withheld at source (TDS)', f.tds, 'the client pays it to the state', 'var(--warn)'],
            ['Cash the client pays', f.cash, 'invoice total less TDS', 'var(--text-1)'],
            ['GST, held for the state', f.gst, 'collected, not earned', 'var(--text-2)'],
            ['Yours', f.yours, 'pre-tax billing less TDS', 'var(--ok)'],
          ].map(([k, v, note, tone]) => (
            <div key={k} className="ft-h-split-row">
              <dt>
                <span className="block font-semibold" style={{ fontSize: 12.5, color: 'var(--text-1)' }}>{k}</span>
                <span className="block" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{note}</span>
              </dt>
              <dd className="ft-h-fig" style={{ color: tone }}>{inr(v)}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-xl px-4 py-3 mt-5"
             style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
            A report that shows <strong className="tabular-nums" style={{ color: 'var(--text-1)' }}>{inr(f.invoice)}</strong>{' '}
            outstanding overstates the cash coming by{' '}
            <strong className="tabular-nums" style={{ color: 'var(--accent-ink, var(--accent))' }}>{inr(f.tds)}</strong>{' '}
            (TDS withheld at source), and the money that is yours by{' '}
            <strong className="tabular-nums" style={{ color: 'var(--accent-ink, var(--accent))' }}>{inr(f.invoice - f.yours)}</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}
