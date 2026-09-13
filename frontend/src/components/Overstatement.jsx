/**
 * What counting the tax costs you, at your own numbers.
 *
 * The site states the TDS point four times in prose and it lands every time as
 * a technicality. It is not a technicality — it is the difference between a
 * collections list you can act on and one that sends people chasing money
 * nobody owes. A sentence cannot make that land. A number the reader chose
 * can.
 *
 * So: drag your own monthly billing and watch the gap open. Everything is
 * computed live from the two rates, nothing is fetched, and the arithmetic is
 * the same arithmetic the sandbox and the invoice drawer use — GST is added on
 * top and collected for the state, TDS is withheld by the client before they
 * pay, and the receivable is the pre-tax figure underneath both.
 *
 * The slider is a real range input. A custom-drawn one would need keyboard
 * handling, ARIA and touch geometry rebuilt from nothing to end up where the
 * native control already is.
 */
import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { GST_RATE, TDS_RATE, inr } from './demoData'
import { Reveal } from './PublicBits'

const STOPS = [200000, 500000, 1000000, 2500000, 5000000, 10000000]

/** Compact Indian notation — ₹25L reads faster than ₹25,00,000 on a handle. */
const short = (n) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`
  : `₹${Math.round(n / 1000)}K`

export default function Overstatement() {
  // Indexed rather than continuous: a linear slider over two orders of
  // magnitude spends most of its travel in a range nobody is in.
  const [i, setI] = useState(2)
  const billed = STOPS[i]

  const gst = Math.round(billed * GST_RATE)
  const tds = Math.round(billed * TDS_RATE)
  const overstated = gst + tds
  const naive = billed + gst          // what a report that counts the tax shows
  const pct = Math.round((overstated / billed) * 100)

  const bar = (value, of, tone) => ({
    width: `${Math.max((value / of) * 100, 2)}%`,
    background: tone,
    transition: 'width 420ms cubic-bezier(0.22,1,0.36,1)',
  })

  return (
    <Reveal className="rounded-2xl overflow-hidden"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap"
           style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
        <TrendingUp size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} />
        <span className="font-bold" style={{ fontSize: 12, color: 'var(--text-1)' }}>
          What counting the tax would cost you
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>drag your monthly billing</span>
      </div>

      <div className="p-4 sm:p-6">
        <label className="block mb-5">
          <span className="flex items-baseline justify-between mb-2">
            <span className="font-bold uppercase tracking-[0.14em]"
                  style={{ fontSize: 9.5, color: 'var(--text-3)' }}>
              Billed per month, pre-tax
            </span>
            <span className="ft-display tabular-nums"
                  style={{ fontSize: 'clamp(1.3rem, 3.4vw, 1.9rem)', color: 'var(--accent)' }}>
              {inr(billed)}
            </span>
          </span>
          <input
            type="range"
            className="ft-range"
            min={0} max={STOPS.length - 1} step={1}
            value={i}
            onChange={e => setI(Number(e.target.value))}
            aria-label="Monthly billing, pre-tax"
            aria-valuetext={inr(billed)}
          />
          <span className="flex justify-between mt-1.5" aria-hidden="true">
            {STOPS.map((s, n) => (
              <span key={s} style={{ fontSize: 10, color: n === i ? 'var(--accent)' : 'var(--text-3)',
                                     fontWeight: n === i ? 700 : 500 }}>
                {short(s)}
              </span>
            ))}
          </span>
        </label>

        <div className="flex flex-col gap-3 mb-5">
          {[
            ['A report that counts the tax', naive, 'var(--bad)',
             `${inr(billed)} + ${inr(gst)} GST`],
            ['What is actually collectable', billed, 'var(--ok)',
             'the pre-tax figure — the receivable'],
          ].map(([label, value, tone, note]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="font-semibold" style={{ fontSize: 12, color: 'var(--text-1)' }}>{label}</span>
                <span className="tabular-nums font-extrabold shrink-0"
                      style={{ fontSize: 14, color: tone }}>{inr(value)}</span>
              </div>
              <span className="block" style={{ height: 10, borderRadius: 5, background: 'var(--bg-input)' }}>
                <span style={{ display: 'block', height: '100%', borderRadius: 5,
                               ...bar(value, naive, tone) }} />
              </span>
              <span className="block mt-1" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{note}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl px-4 py-3"
             style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
            At {inr(billed)} a month you would be chasing{' '}
            <strong className="tabular-nums" style={{ color: 'var(--accent)' }}>{inr(overstated)}</strong>{' '}
            that nobody owes you — {pct}% over, every month. {inr(gst)} of it is
            GST you collected for the state, and {inr(tds)} is TDS your client
            withheld before paying. Neither is money a client still has.
          </p>
        </div>
      </div>
    </Reveal>
  )
}
