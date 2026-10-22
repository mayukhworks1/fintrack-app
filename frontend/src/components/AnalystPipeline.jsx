/**
 * What happens between the question and the answer.
 *
 * This is the product's one load-bearing claim and the page was asserting it
 * in prose: the model never writes SQL, it picks a measure and a grouping from
 * a fixed list and the application compiles the statement. Written down, that
 * is a promise, and every finance tool makes promises. Drawn as four stages
 * with the work visibly passing between them, it is a mechanism — you can see
 * where the model's authority stops.
 *
 * The middle stage is the whole argument. The model's entire output is two
 * values from two closed sets. There is no path from a sentence to arbitrary
 * SQL, which is also why it cannot be talked into reading rows the signed-in
 * account may not see: scoping is applied when the statement is built, below
 * the point where anything the model said still matters.
 *
 * Motion is one shared 8-second loop — same duration everywhere, different
 * delays — so the four stages cannot drift out of phase. Under reduced motion
 * they simply all sit lit; the sequence is in the order and the numbers, not
 * only in the animation.
 *
 * The figures are from the sandbox's invented ledger, so the answer shown here
 * is the same one the analyst panel above produces for the same question.
 */
import { MessageSquare, SlidersHorizontal, Code2, BarChart3 } from 'lucide-react'
import { useReveal } from '../hooks/useReveal'
import { ask, inrShort } from './demoData'

// The same question the sandbox opens on, run through the same function, so
// the two never disagree about what this ledger says.
const RESULT = ask({ measure: 'outstanding', groupBy: 'client', limit: 3 })

const STAGES = [
  {
    id: 'ask',
    icon: MessageSquare,
    label: 'You ask',
    note: 'Plain words. No query language, no builder, no saved report to find first.',
    render: () => (
      <p className="rounded-lg px-2.5 py-2" style={{
        fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-1)',
        background: 'var(--bg-input)', border: '1px solid var(--card-border)',
      }}>
        “Which clients owe the most right now?”
      </p>
    ),
  },
  {
    id: 'plan',
    icon: SlidersHorizontal,
    label: 'The model picks two things',
    note: 'A measure and a grouping, each from a closed list. That is the whole of its output.',
    render: () => (
      <div className="flex flex-col gap-1.5">
        {[['measure', 'outstanding'], ['group by', 'client']].map(([k, v]) => (
          <span key={k} className="flex items-center justify-between rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{k}</span>
            <span className="font-bold" style={{ fontSize: 11, color: 'var(--accent)' }}>{v}</span>
          </span>
        ))}
      </div>
    ),
  },
  {
    id: 'compile',
    icon: Code2,
    label: 'The code writes the SQL',
    note: 'Assembled by the application, with row scoping applied from your session as it is built.',
    render: () => (
      <pre className="m-0 rounded-lg px-2.5 py-2 overflow-x-auto" style={{
        fontSize: 9.5, lineHeight: 1.55, color: 'var(--text-2)',
        background: 'var(--bg-base)', border: '1px solid var(--card-border)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
{`SELECT client,
       SUM(amount_raised)
  FROM invoices_mirror
 GROUP BY client`}
      </pre>
    ),
  },
  {
    id: 'answer',
    icon: BarChart3,
    label: 'You get both',
    note: 'The answer and the statement that produced it, together, every time.',
    render: () => (
      <div className="flex flex-col gap-1.5">
        {RESULT.rows.map((r, i) => (
          <span key={r.key} className="flex items-center gap-2">
            <span className="truncate" style={{ fontSize: 10, color: 'var(--text-3)', flex: '0 0 46%' }}>
              {r.key.split(' ')[0]}
            </span>
            <span className="flex-1" style={{ height: 6, borderRadius: 3, background: 'var(--bg-input)' }}>
              <span style={{
                display: 'block', height: '100%', borderRadius: 3,
                width: `${Math.max((r.value / RESULT.peak) * 100, 4)}%`,
                background: ['#104281', '#256abf', '#3987e5'][i],
              }} />
            </span>
            <span className="tabular-nums font-bold" style={{ fontSize: 10, color: 'var(--text-1)' }}>
              {inrShort(r.value)}
            </span>
          </span>
        ))}
      </div>
    ),
  },
]

export default function AnalystPipeline() {
  const ref = useReveal({ threshold: 0.15 })

  return (
    <div ref={ref} className="ft-reveal ft-pipe">
      {STAGES.map((stage, i) => {
        const Icon = stage.icon
        const last = i === STAGES.length - 1
        return (
          <div key={stage.id} className="ft-pipe-node"
               data-run=""
               // One duration, four delays. Independently-timed animations
               // would look aligned on the first pass and be visibly out of
               // step a minute later.
               style={{ animationDelay: `${i * 2}s` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center rounded-md shrink-0"
                    style={{ width: 24, height: 24, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Icon size={13} aria-hidden="true" />
              </span>
              <span className="font-bold" style={{ fontSize: 12, color: 'var(--text-1)' }}>
                {i + 1}. {stage.label}
              </span>
            </div>

            {stage.render()}

            <p className="mt-2" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>
              {stage.note}
            </p>

            {!last && (
              <span className="ft-pipe-link" aria-hidden="true">
                <span className="ft-pipe-spark" style={{ animationDelay: `${i * 2 + 0.35}s` }} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
