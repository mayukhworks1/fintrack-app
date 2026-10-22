/**
 * One AI task's route through the gateway, tried in order.
 *
 * Every label is read off the Admin → AI gateway capture (gateway.webp): the
 * task "AI assistant chat" with its three steps, "Prompt v2", and the
 * gateway's "229 of 2,000" calls today. The figures are the sample
 * workspace's, and say so.
 *
 * What it shows is the mechanism in the capture's own words: "each task
 * tries its route in order and moves to the next step when a model fails or
 * its provider is unavailable". Once, when it is first scrolled to, the first
 * step is tried and does not answer, a dot crosses to the second, and the
 * second answers. Then it rests. Under reduced motion it shows that end
 * state from the start, with nothing moving.
 */
import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useInView } from '../../hooks/useInView'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import RollNumber from '../motion/RollNumber'

const ROUTE = [
  { provider: 'Groq', model: 'openai/gpt-oss-120b' },
  { provider: 'Groq', model: 'openai/gpt-oss-20b' },
  { provider: 'OpenRouter', model: 'openrouter/free' },
]
const CALLS = 229, CAP = 2000
const fmt = (n) => Math.round(n).toLocaleString('en-IN')

// 0 idle · 1 trying step 1 · 2 step 1 unavailable, crossing · 3 step 2 answered
const END = 3

export default function GatewayRoute({ compact = false }) {
  const reduced = useReducedMotion()
  const [ref, seen] = useInView({ threshold: 0.45, once: true })
  const [phase, setPhase] = useState(reduced ? END : 0)

  useEffect(() => {
    if (reduced) { setPhase(END); return }
    if (!seen) return
    const t = [
      setTimeout(() => setPhase(1), 250),
      setTimeout(() => setPhase(2), 1050),
      setTimeout(() => setPhase(3), 1750),
    ]
    return () => t.forEach(clearTimeout)
  }, [seen, reduced])

  const state = (i) => {
    if (i === 0) return phase === 1 ? 'trying' : phase >= 2 ? 'skipped' : 'idle'
    if (i === 1) return phase >= 3 ? 'answered' : phase === 2 ? 'trying' : 'idle'
    return 'idle'
  }

  return (
    <div ref={ref} className={`ft-f-gw${compact ? ' is-compact' : ''}`} data-shown={seen || reduced ? '' : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[14px] font-extrabold text-[var(--text-1)]">AI assistant chat</span>
        <span className="ft-f-tag" data-tone="ok">On</span>
        <span className="ft-f-tag">Stream</span>
        <span className="ml-auto text-[11.5px] text-[var(--text-3)]">Prompt v2</span>
      </div>

      <ol className="ft-f-gw-route" aria-label="Route, tried in order">
        {ROUTE.map((step, i) => {
          const st = state(i)
          return (
            <li key={step.model} className="ft-f-gw-step" data-state={st}>
              {i > 0 && (
                <span className="ft-f-gw-link" aria-hidden="true"
                      data-run={i === 1 && phase >= 2 ? '' : undefined} />
              )}
              <span className="ft-f-gw-pill">
                <span className="ft-f-gw-n" aria-hidden="true">
                  {st === 'skipped' ? <X size={11} /> : st === 'answered' ? <Check size={11} /> : i + 1}
                </span>
                <span>
                  <b className="block text-[12px] text-[var(--text-1)]">{step.provider}</b>
                  <code className="text-[11.5px] text-[var(--text-2)] break-all">{step.model}</code>
                </span>
              </span>
              <span className="sr-only">
                {st === 'skipped' ? ' — did not answer, moved on' : st === 'answered' ? ' — answered' : ''}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="mt-3 mb-0 text-[12.5px] leading-snug text-[var(--text-2)]" style={{ minHeight: 40 }} aria-live="polite">
        {phase >= 3
          ? 'Step 1 did not answer, so the call moved to step 2, which did. Both attempts are in the call log.'
          : 'Each task tries its route in order and moves on when a model fails or its provider is unavailable.'}
      </p>

      {!compact && (
        <div className="ft-f-gw-cap">
          <div className="flex justify-between gap-2.5 text-[12.5px] font-bold text-[var(--text-1)]">
            <span>Gateway calls today</span>
            <span><RollNumber value={CALLS} format={fmt} /> of {fmt(CAP)}</span>
          </div>
          <span className="ft-f-meter" aria-hidden="true">
            <span className="ft-f-meter-fill" style={{ '--s': CALLS / CAP }} />
          </span>
          <span className="text-[11px] text-[var(--text-3)]">Sample figures from the gateway screen. The day resets at midnight IST.</span>
        </div>
      )}
    </div>
  )
}
