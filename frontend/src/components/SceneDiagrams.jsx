/**
 * A drawing per claim.
 *
 * The pages built during the split were three paragraphs in a row with an icon
 * on top — correct, and visually indistinguishable from every other SaaS page
 * ever made. An icon says "this is a section". A diagram says what the section
 * means, and it is the difference between a page you read and a page you skim
 * past.
 *
 * Each of these draws the mechanism it sits beside rather than decorating it:
 * permissions really are rows that toggle, an instance really is one build
 * with a different environment, a module really does slot into an existing
 * rail. Nothing here is a quantity, so nothing here is a chart — these are
 * pictures of structure, which is the only thing perspective and abstraction
 * are safe on.
 *
 * All inline SVG. The CSP names no image origin, an authored mark takes the
 * visitor's theme, and none of it costs a request.
 */
import { useReveal } from '../hooks/useReveal'

const ACCENT = 'var(--accent)'
const LINE = 'var(--card-border)'
const DIM = 'var(--text-3)'

/** Wraps a drawing so its strokes and fills animate the first time it is seen. */
function Frame({ children, viewBox = '0 0 200 104', label }) {
  const ref = useReveal({ threshold: 0.3 })
  return (
    <div ref={ref} className="ft-reveal ft-draw-host rounded-xl mb-4 overflow-hidden"
         style={{ background: 'var(--bg-input)', border: `1px solid ${LINE}` }}>
      <svg viewBox={viewBox} role="img" aria-label={label}
           style={{ width: '100%', display: 'block' }}>
        {children}
      </svg>
    </div>
  )
}

/* ── Configured, not commissioned ─────────────────────────────────────────
   Three permission rows; the middle one is switched on as you watch. That is
   literally what the admin screen does — a row, a toggle, and a person who
   now reaches one more module than their role gives them. */
export function PermissionRows() {
  const rows = [0, 1, 2]
  return (
    <Frame label="Three permission rows, one of them switching on">
      {rows.map(i => {
        const y = 20 + i * 26
        const on = i === 1
        return (
          <g key={i}>
            <rect x="14" y={y} width="172" height="20" rx="6"
                  fill="var(--card-bg)" stroke={on ? ACCENT : LINE} strokeWidth="1" />
            <rect x="22" y={y + 7} width={i === 0 ? 52 : i === 1 ? 40 : 62} height="6" rx="3"
                  fill={DIM} opacity="0.45" />
            {/* the switch */}
            <rect x="152" y={y + 5} width="26" height="10" rx="5"
                  fill={on ? ACCENT : LINE}
                  style={on ? { animation: 'ft-switch-on 2.6s ease-in-out infinite' } : undefined} />
            <circle cx={on ? 172 : 158} cy={y + 10} r="4" fill="var(--card-bg)"
                    style={on ? { animation: 'ft-switch-knob 2.6s ease-in-out infinite' } : undefined} />
          </g>
        )
      })}
      <text x="14" y="12" fontSize="7" fontWeight="700" fill={DIM}
            letterSpacing="0.14em">PER PERSON</text>
    </Frame>
  )
}

/* ── Your database, your cloud ────────────────────────────────────────────
   One build, two environments. The point the card makes in words is that the
   second box is not a fork — so the two are drawn identical, and only the
   label under them differs. */
export function OneBuildTwoHomes() {
  const box = (x, title, sub, lit) => (
    <g>
      <rect x={x} y="30" width="70" height="42" rx="8"
            fill="var(--card-bg)" stroke={lit ? ACCENT : LINE} strokeWidth={lit ? 1.4 : 1} />
      {[0, 1, 2].map(i => (
        <rect key={i} x={x + 10} y={38 + i * 9} width={i === 2 ? 28 : 50} height="4.5" rx="2.25"
              fill={lit ? ACCENT : DIM} opacity={lit ? 0.55 : 0.35} />
      ))}
      <text x={x + 35} y="86" fontSize="7.5" fontWeight="700" textAnchor="middle"
            fill="var(--text-2)">{title}</text>
      <text x={x + 35} y="96" fontSize="6.5" textAnchor="middle" fill={DIM}>{sub}</text>
    </g>
  )
  return (
    <Frame label="The same build running in two places">
      <text x="100" y="14" fontSize="7" fontWeight="700" textAnchor="middle" fill={DIM}
            letterSpacing="0.14em">ONE BUILD</text>
      {box(22, 'Shared', 'our cloud', false)}
      {box(108, 'Dedicated', 'your cloud', true)}
      {/* the environment file that is the only difference */}
      <path d="M 92 51 L 108 51" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="3 3"
            className="ft-dash" />
      <circle cx="100" cy="51" r="6.5" fill="var(--bg-input)" stroke={ACCENT} strokeWidth="1" />
      <text x="100" y="53.5" fontSize="6" fontWeight="800" textAnchor="middle" fill={ACCENT}>env</text>
    </Frame>
  )
}

/* ── New modules for your case ────────────────────────────────────────────
   A rail of modules with one arriving into it. The whole claim is that it
   lands *inside* the existing structure rather than beside it, so the new
   one is drawn in the same rail, in the same shape, one slot along. */
export function ModuleSlotsIn() {
  return (
    <Frame label="A new module arriving into the existing rail">
      <rect x="12" y="18" width="52" height="72" rx="8" fill="var(--card-bg)" stroke={LINE} />
      {[0, 1, 2, 3].map(i => (
        <g key={i}>
          <rect x="19" y={26 + i * 14} width="38" height="10" rx="4"
                fill={DIM} opacity="0.2" />
          <circle cx="25" cy={31 + i * 14} r="2.4" fill={DIM} opacity="0.5" />
        </g>
      ))}
      {/* the arrival */}
      <g style={{ animation: 'ft-slot-in 3.2s cubic-bezier(0.22,1,0.36,1) infinite' }}>
        <rect x="19" y="82" width="38" height="10" rx="4" fill={ACCENT} opacity="0.18" />
        <circle cx="25" cy="87" r="2.4" fill={ACCENT} />
        <rect x="31" y="85" width="22" height="4" rx="2" fill={ACCENT} opacity="0.7" />
      </g>
      <path d="M 96 54 L 72 54" stroke={ACCENT} strokeWidth="1.3" className="ft-dash" />
      <path d="M 76 50 L 71 54 L 76 58" fill="none" stroke={ACCENT} strokeWidth="1.3"
            strokeLinecap="round" strokeLinejoin="round" />
      <g>
        <rect x="100" y="34" width="86" height="40" rx="8"
              fill="var(--card-bg)" stroke={ACCENT} strokeWidth="1.2" />
        <text x="143" y="49" fontSize="7.5" fontWeight="800" textAnchor="middle" fill={ACCENT}>
          Your module
        </text>
        <text x="143" y="60" fontSize="6.5" textAnchor="middle" fill={DIM}>in the permission</text>
        <text x="143" y="68" fontSize="6.5" textAnchor="middle" fill={DIM}>matrix on day one</text>
      </g>
    </Frame>
  )
}

/* ── Nothing to migrate ───────────────────────────────────────────────────
   Your base stays put and the mirror is fed from it. Drawn one-way on
   purpose: the arrow that matters is the one that says nothing moves out. */
export function StaysPut() {
  return (
    <Frame label="Your records stay where they are; a mirror is fed from them">
      <g>
        <rect x="16" y="30" width="64" height="44" rx="8"
              fill="var(--card-bg)" stroke={ACCENT} strokeWidth="1.3" />
        <ellipse cx="48" cy="40" rx="20" ry="6" fill="none" stroke={ACCENT} strokeWidth="1.2" />
        <path d="M 28 40 v 22 a 20 6 0 0 0 40 0 v -22" fill="none" stroke={ACCENT} strokeWidth="1.2" />
        <text x="48" y="88" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="var(--text-2)">
          Your base
        </text>
        <text x="48" y="97" fontSize="6.5" textAnchor="middle" fill={DIM}>system of record</text>
      </g>
      {/* one direction, repeatedly */}
      <path d="M 86 52 L 116 52" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="4 4"
            className="ft-dash" />
      <circle r="2.6" fill="#4ADE80" className="ft-runner">
        <animateMotion dur="2.4s" repeatCount="indefinite" path="M 86 52 L 116 52" />
      </circle>
      <g>
        <rect x="122" y="30" width="62" height="44" rx="8"
              fill="var(--card-bg)" stroke={LINE} />
        {[0, 1, 2, 3].map(i => (
          <rect key={i} x={130} y={38 + i * 9} width={i % 2 ? 30 : 46} height="4.5" rx="2.25"
                fill={DIM} opacity="0.35" />
        ))}
        <text x="153" y="88" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="var(--text-2)">
          Postgres mirror
        </text>
        <text x="153" y="97" fontSize="6.5" textAnchor="middle" fill={DIM}>read-fast copy</text>
      </g>
    </Frame>
  )
}

/* ── Cited answers ────────────────────────────────────────────────────────
   A claim with a numbered marker, and the page it points at. The product's
   document answer, in one picture. */
export function CitedAnswer() {
  return (
    <Frame label="An answer with a numbered citation pointing at its source page">
      <rect x="14" y="20" width="92" height="66" rx="8" fill="var(--card-bg)" stroke={LINE} />
      {[0, 1, 2].map(i => (
        <rect key={i} x="22" y={30 + i * 11} width={i === 2 ? 48 : 76} height="5" rx="2.5"
              fill={DIM} opacity="0.34" />
      ))}
      <g style={{ animation: 'ft-pop-cite 3s ease-in-out infinite' }}>
        <circle cx="80" cy="67" r="7.5" fill={ACCENT} />
        <text x="80" y="70" fontSize="8" fontWeight="800" textAnchor="middle" fill="#fff">1</text>
      </g>
      <path d="M 90 67 Q 108 67 116 50" fill="none" stroke={ACCENT} strokeWidth="1.2"
            strokeDasharray="3 3" className="ft-dash" />
      <g>
        <rect x="120" y="24" width="62" height="56" rx="6"
              fill="var(--card-bg)" stroke={ACCENT} strokeWidth="1.2" />
        <rect x="127" y="40" width="48" height="5" rx="2.5" fill={ACCENT} opacity="0.5" />
        <rect x="127" y="49" width="36" height="5" rx="2.5" fill={DIM} opacity="0.3" />
        <text x="151" y="34" fontSize="6.5" fontWeight="700" textAnchor="middle" fill={DIM}>
          page 4
        </text>
      </g>
    </Frame>
  )
}

export const DIAGRAMS = {
  permissions: PermissionRows,
  build: OneBuildTwoHomes,
  module: ModuleSlotsIn,
  staysput: StaysPut,
  cited: CitedAnswer,
}
