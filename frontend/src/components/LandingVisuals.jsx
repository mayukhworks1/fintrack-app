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
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useReveal } from '../hooks/useReveal'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useAutoplay } from '../hooks/useAutoplay'

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

/* MiniLine and MiniDonut were here. Both are gone, and the donut is the
   reason: it printed "68%" — 68% of nothing, an invented statistic sitting
   where a reader expects a fact, next to whichever module the modulo landed
   on. MiniLine was the same problem with less nerve: a trend line for
   subjects that have no trend, including "Questions".
   Deleted rather than left unused, because an unused generic chart is a
   thing the next person reaches for when a cell looks empty. Subjects that
   genuinely are a trend keep MiniBars; everything else is drawn for itself
   in Glyphs.jsx. */

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

   It runs on useAutoplay: only while a quarter of it is on screen and the tab
   is showing, at most twice, and then it rests on the finished answer with a
   Replay button. While it runs, the same button pauses it. Under reduced
   motion it starts on the finished state and moves only if Replay is pressed.

   Nothing in it changes size as it plays (the query and the answer hold their
   space and fade in; the bars grow by transform), so it never pushes the page
   around, and the typing writes straight to the DOM instead of re-rendering
   the demo for every character. */
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
const DEMO_CYCLES = 2
const DEMO_HOLD_MS = 5200   // the finished answer stays up this long between runs
const TYPE_MS = 34

export function AnalystDemo() {
  const reduced = useReducedMotion()
  const auto = useAutoplay({ threshold: 0.25 })
  const [done, setDone] = useState(reduced)
  const [stage, setStage] = useState(reduced ? 2 : 0)   // 0 typing · 1 query · 2 answer
  const [run, setRun] = useState(0)
  const qRef = useRef(null)
  const cycles = useRef(0)

  const paintQ = (text) => { if (qRef.current) qRef.current.textContent = text }

  // The finished state: the whole question and the answer.
  useLayoutEffect(() => {
    if (done) { paintQ(DEMO_Q); setStage(2) }
  }, [done])

  // Reduced motion, and nobody asked for a replay: rest on the answer.
  useEffect(() => {
    if (reduced && !auto.running) setDone(true)
  }, [reduced, auto.running])

  useEffect(() => {
    if (!auto.running || done) return
    const timers = []
    const at = (ms, fn) => timers.push(setTimeout(fn, ms))
    const cycle = () => {
      paintQ(''); setStage(0)
      for (let i = 0; i < DEMO_Q.length; i++) at(TYPE_MS * i, () => paintQ(DEMO_Q.slice(0, i + 1)))
      const typed = TYPE_MS * DEMO_Q.length
      at(typed + 260, () => setStage(1))
      at(typed + 1250, () => {
        setStage(2)
        cycles.current += 1
        if (cycles.current >= DEMO_CYCLES) { setDone(true); return }
        at(DEMO_HOLD_MS, cycle)
      })
    }
    cycle()
    return () => timers.forEach(clearTimeout)
  }, [auto.running, done, run])

  const replay = () => {
    cycles.current = 0
    setDone(false)
    setRun(r => r + 1)
    auto.resume()
  }

  const typing = !done && stage === 0
  const btn = {
    width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
    display: 'grid', placeItems: 'center', background: 'transparent',
    border: '1px solid var(--card-border)', color: 'var(--text-2)',
  }

  return (
    <div
      ref={auto.ref}
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
    >
      <div className="flex items-center gap-2 pl-4 pr-1.5"
           style={{ height: 40, borderBottom: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent-btn)' }} />
        <span className="text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>Studio — finance data</span>
        {done ? (
          <button type="button" onClick={replay} aria-label="Replay the demo" className="ml-auto" style={btn}>
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={auto.toggle} aria-label="Pause the demo"
                  aria-pressed={!auto.running} className="ml-auto" style={btn}>
            {auto.running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          </button>
        )}
      </div>

      <div className="p-4 sm:p-5">
        {/* the question */}
        <div className="rounded-xl px-3 py-2.5 mb-3"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', minHeight: 42 }}>
          <span className="text-[13px]" style={{ color: 'var(--text-1)' }}>
            <span ref={qRef} />
            <span className="inline-block align-middle"
                  style={{
                    width: 2, height: 14, marginLeft: 2, background: 'var(--accent-btn)',
                    animation: typing ? 'ft-caret 1s step-end infinite' : 'none',
                    opacity: typing ? 1 : 0,
                  }} />
          </span>
        </div>

        {/* the compiled query — the product's core claim, made visible */}
        <div
          className="rounded-xl overflow-hidden mb-3"
          style={{
            opacity: stage >= 1 ? 1 : 0,
            transform: stage >= 1 ? 'none' : 'translateY(4px)',
            transition: 'opacity 380ms ease, transform 420ms cubic-bezier(0.22,1,0.36,1)',
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
              <span className="flex-1 overflow-hidden" style={{ height: 7, borderRadius: 4, background: 'var(--bg-input)' }}>
                <span style={{
                  display: 'block', height: '100%', width: '100%', borderRadius: 4,
                  background: ['#104281', '#256abf', '#3987e5', '#86b6ef'][i],
                  transformOrigin: '0 50%',
                  transform: `scaleX(${stage >= 2 ? r.v / 100 : 0})`,
                  transition: `transform 760ms cubic-bezier(0.22,1,0.36,1) ${180 + i * 90}ms`,
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
