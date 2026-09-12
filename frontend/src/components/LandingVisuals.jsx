/**
 * Illustration and motion pieces for the public page.
 *
 * All inline SVG and CSS. The app's CSP names two script origins, so an
 * external animation runtime is blocked outright; and a hotlinked asset is a
 * broken front door the day its host reorganises. Authored marks cost nothing
 * per render, cannot be taken down, and scale to any size without a second
 * file.
 *
 * Nothing here reads a workspace. Every figure is invented and every block
 * that shows one is aria-hidden, so a screen reader cannot announce an
 * illustration as data.
 */
import { useEffect, useRef, useState } from 'react'
import { useReveal } from '../hooks/useReveal'

/* ── Texture ──────────────────────────────────────────────────────────────
   Fractal-noise grain. A flat gradient reads as cheap at large sizes; a few
   percent of noise over it is what stops the banding and gives the surface
   something to catch. */
export function Grain({ opacity = 0.045 }) {
  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full" aria-hidden="true"
         style={{ mixBlendMode: 'overlay', opacity }}>
      <filter id="ft-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#ft-grain)" />
    </svg>
  )
}

/* The brand mark used to be redrawn here — a rounded accent-blue tile with
   three ascending vertical bars — while the app, the favicon and the touch
   icon all used the navy tile with the chart-bar "F" in src/components/
   BrandMark.jsx. Two marks for one product, and the public page was showing
   the wrong one. Import that component; do not draw a second logo. */

/* ── Mini visualisations ──────────────────────────────────────────────────
   One per bento cell. Small enough to read at a glance, specific enough that
   the cell says what the module does without a screenshot. */

export function MiniBars({ values = [38, 62, 44, 80, 56, 95], tone = 'var(--accent)' }) {
  const ref = useReveal()
  return (
    <svg ref={ref} className="ft-reveal w-full" viewBox="0 0 120 46" aria-hidden="true"
         preserveAspectRatio="none" style={{ height: 52, display: 'block' }}>
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * 20 + 3} y={46 - (v / 100) * 42} width="12" rx="3"
          height={(v / 100) * 42}
          fill={tone}
          opacity={0.35 + (i / values.length) * 0.65}
          style={{
            transformOrigin: 'center bottom',
            animation: `ft-bar-rise 700ms cubic-bezier(0.22,1,0.36,1) ${i * 70}ms both`,
          }}
        />
      ))}
    </svg>
  )
}

export function MiniLine({ points = [30, 44, 38, 58, 52, 72, 66, 88] }) {
  const ref = useReveal()
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 118 + 1},${44 - (p / 100) * 38}`)
    .join(' L ')
  return (
    <svg ref={ref} className="ft-reveal w-full" viewBox="0 0 120 46" aria-hidden="true"
         preserveAspectRatio="none" style={{ height: 52, display: 'block' }}>
      <defs>
        <linearGradient id="ft-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${d} L 119,46 L 1,46 Z`} fill="url(#ft-line-fill)" />
      <path
        d={`M ${d}`} fill="none" stroke="var(--accent)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
        pathLength="1"
        style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: 'ft-draw 1400ms ease forwards 160ms' }}
      />
    </svg>
  )
}

export function MiniDonut({ pct = 68 }) {
  const ref = useReveal()
  const C = 2 * Math.PI * 17
  return (
    <svg ref={ref} className="ft-reveal" viewBox="0 0 46 46" width="72" height="72" aria-hidden="true">
      <circle cx="23" cy="23" r="17" fill="none" stroke="var(--bg-input)" strokeWidth="6" />
      <circle
        cx="23" cy="23" r="17" fill="none" stroke="var(--accent)" strokeWidth="6"
        strokeLinecap="round" transform="rotate(-90 23 23)"
        style={{
          strokeDasharray: C,
          strokeDashoffset: C,
          animation: `ft-donut 1200ms cubic-bezier(0.22,1,0.36,1) 200ms forwards`,
          ['--ft-donut-to']: C * (1 - pct / 100),
        }}
      />
      <text x="23" y="26" textAnchor="middle" fontSize="10" fontWeight="800"
            fill="var(--text-1)">{pct}%</text>
    </svg>
  )
}

/* Stacked document sheets — the Studio documents cell. */
export function MiniDocs() {
  const ref = useReveal()
  return (
    <svg ref={ref} className="ft-reveal" viewBox="0 0 90 52" width="110" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <g key={i} style={{ animation: `ft-sheet 620ms cubic-bezier(0.22,1,0.36,1) ${i * 110}ms both` }}>
          <rect x={6 + i * 11} y={6 + i * 5} width="46" height="38" rx="5"
                fill="var(--card-bg)" stroke="var(--card-border)" />
          {[0, 1, 2].map(l => (
            <rect key={l} x={12 + i * 11} y={13 + i * 5 + l * 7} rx="1.5"
                  width={l === 2 ? 20 : 32} height="3"
                  fill="var(--text-3)" opacity={0.3} />
          ))}
        </g>
      ))}
      {/* the citation marker */}
      <circle cx="72" cy="40" r="9" fill="var(--accent)" />
      <text x="72" y="44" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">1</text>
    </svg>
  )
}

/* ── The analyst demo ─────────────────────────────────────────────────────
   Types a question, shows the compiled query, then the answer. It is the one
   thing on this page that demonstrates rather than describes — and since the
   product's whole claim is "it shows you what it ran", a still screenshot
   would undersell it.

   Restarts on a loop, pauses while off-screen so a background tab is not
   animating, and is skipped entirely under reduced motion, where the finished
   state is shown instead. */
const DEMO_Q = 'Which clients have the most outstanding?'
const DEMO_SQL = `SELECT client,
       SUM(amount_raised) AS value
  FROM invoices_mirror
 WHERE deleted_at IS NULL
   AND payment_status IS DISTINCT FROM 'Paid'
 GROUP BY client
 ORDER BY value DESC`
const DEMO_ROWS = [
  { name: 'Ravensbourne', v: 100 },
  { name: 'Halcyon Group', v: 68 },
  { name: 'Meridian Labs', v: 41 },
  { name: 'Orchard & Co', v: 24 },
]

export function AnalystDemo() {
  const [typed, setTyped] = useState('')
  const [stage, setStage] = useState(0)   // 0 typing · 1 query · 2 answer
  const hostRef = useRef(null)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // Without an observer there is nothing to start the loop, and constructing
    // one that does not exist throws during render — which takes the whole
    // page down, not just this panel. Show the finished state instead.
    if (reduced.current || typeof IntersectionObserver === 'undefined') {
      setTyped(DEMO_Q); setStage(2); return
    }

    let timers = []
    let running = false

    const cycle = () => {
      timers.forEach(clearTimeout); timers = []
      setTyped(''); setStage(0)
      // Typing, then a beat on the query, then the answer, then round again.
      DEMO_Q.split('').forEach((_, i) => {
        timers.push(setTimeout(() => setTyped(DEMO_Q.slice(0, i + 1)), 34 * i))
      })
      const typeDone = 34 * DEMO_Q.length
      timers.push(setTimeout(() => setStage(1), typeDone + 260))
      timers.push(setTimeout(() => setStage(2), typeDone + 1250))
      timers.push(setTimeout(cycle, typeDone + 7200))
    }

    // Only animate while actually on screen.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) { running = true; cycle() }
      else if (!e.isIntersecting && running) {
        running = false
        timers.forEach(clearTimeout); timers = []
      }
    }, { threshold: 0.25 })
    if (hostRef.current) io.observe(hostRef.current)

    return () => { io.disconnect(); timers.forEach(clearTimeout) }
  }, [])

  return (
    <div
      ref={hostRef}
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
    >
      <div className="flex items-center gap-2 px-4"
           style={{ height: 40, borderBottom: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>Studio — finance data</span>
      </div>

      <div className="p-4 sm:p-5">
        {/* the question */}
        <div className="rounded-xl px-3 py-2.5 mb-3"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <span className="text-[13px]" style={{ color: 'var(--text-1)' }}>
            {typed}
            <span className="inline-block align-middle"
                  style={{
                    width: 2, height: 14, marginLeft: 2, background: 'var(--accent)',
                    animation: 'ft-caret 1s step-end infinite',
                    opacity: stage === 0 ? 1 : 0,
                  }} />
          </span>
        </div>

        {/* the compiled query — the product's core claim, made visible */}
        <div
          className="rounded-xl overflow-hidden mb-3"
          style={{
            maxHeight: stage >= 1 ? 190 : 0,
            opacity: stage >= 1 ? 1 : 0,
            transition: 'max-height 520ms cubic-bezier(0.22,1,0.36,1), opacity 380ms ease',
          }}
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5"
               style={{ background: 'var(--bg-input)' }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--text-3)' }}>Compiled query</span>
          </div>
          <pre className="m-0 px-3 py-2.5 overflow-x-auto text-[10.5px] leading-[1.6]"
               style={{ color: 'var(--text-2)', background: 'var(--bg-base)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {DEMO_SQL}
          </pre>
        </div>

        {/* the answer */}
        <div style={{
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 ? 'none' : 'translateY(6px)',
          transition: 'opacity 420ms ease 60ms, transform 420ms ease 60ms',
        }}>
          {DEMO_ROWS.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[11px] shrink-0" style={{ width: 92, color: 'var(--text-2)' }}>
                {r.name}
              </span>
              <span className="flex-1" style={{ height: 7, borderRadius: 4, background: 'var(--bg-input)' }}>
                <span style={{
                  display: 'block', height: '100%', borderRadius: 4,
                  background: ['#104281', '#256abf', '#3987e5', '#86b6ef'][i],
                  width: stage >= 2 ? `${r.v}%` : 0,
                  transition: `width 760ms cubic-bezier(0.22,1,0.36,1) ${180 + i * 90}ms`,
                }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Count-up ─────────────────────────────────────────────────────────────
   Counts once when reached. Static under reduced motion — a number that
   animates is the least important thing on the page to insist upon. */
export function CountUp({ to, suffix = '', duration = 1200 }) {
  const [n, setN] = useState(0)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setN(to)
    // No observer means the count would sit at 0 forever. A stat band reading
    // "0 Modules" is a worse outcome than no animation at all, so the number
    // is correct first and animated only when it can be.
    if (typeof IntersectionObserver === 'undefined') return setN(to)

    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / duration)
        // ease-out cubic — fast start, settles rather than stopping dead
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to, duration])

  return <span ref={ref} className="tabular-nums">{n}{suffix}</span>
}
