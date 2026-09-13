/**
 * The architecture, drawn as what it is: layers.
 *
 * "Every module reads the same rows" is the sentence the whole product rests
 * on, and it is a spatial claim — there is one thing underneath and many
 * things on top of it. A paragraph makes you assemble that picture yourself.
 * This hands it over.
 *
 * Drawn in SVG rather than assembled from CSS 3D transforms. Rotating a div
 * into an isometric plane also rotates the text inside it, and the usual fix —
 * counter-rotating the label back — is a second transform that has to be kept
 * in sync with the first for ever. Here the planes are parallelogram paths and
 * the labels are placed flat beside them, which is both simpler and readable.
 *
 * The one rule this respects: perspective distorts magnitude, so depth is used
 * on structure and never on a quantity. Nothing here is a measurement.
 */
import { useReveal } from '../hooks/useReveal'

/* Isometric projection: x runs right-and-down, y runs left-and-down. Keeping
   the two skews equal and opposite is what stops the planes from looking like
   they are lying at different angles. */
const SKEW_X = 0.56
const W = 190   // plane width along the x axis
const D = 96    // plane depth along the y axis

/** Top face of a plane whose near-left corner sits at (cx, cy). */
function facePath(cx, cy) {
  return [
    `M ${cx} ${cy}`,
    `l ${W} ${-W * SKEW_X * 0.5}`,
    `l ${D} ${D * SKEW_X * 0.5}`,
    `l ${-W} ${W * SKEW_X * 0.5}`,
    'Z',
  ].join(' ')
}

/** The extruded side walls, so a plane reads as a slab rather than a sheet. */
function sidePath(cx, cy, h) {
  return [
    `M ${cx} ${cy}`,
    `l ${D} ${D * SKEW_X * 0.5}`,
    `l 0 ${h}`,
    `l ${-D} ${-D * SKEW_X * 0.5}`,
    'Z',
  ].join(' ')
}

function frontPath(cx, cy, h) {
  return [
    `M ${cx + D} ${cy + D * SKEW_X * 0.5}`,
    `l ${W} ${-W * SKEW_X * 0.5}`,
    `l 0 ${h}`,
    `l ${-W} ${W * SKEW_X * 0.5}`,
    'Z',
  ].join(' ')
}

/* Bottom to top, which is also the order the data moves in. Tints step
   monotonically lighter so the stack reads as ascending even in greyscale. */
export const LAYERS = [
  {
    id: 'base',
    title: 'Your records',
    body: 'The base your team already works in stays the system of record.',
    top: '#0f2f5c', side: '#0a2244', front: '#0d2a51',
  },
  {
    id: 'mirror',
    title: 'Postgres mirror',
    body: 'Kept current by webhooks, a 30-second pass and a full reconciliation.',
    top: '#1d5aa8', side: '#154480', front: '#1a5096',
  },
  {
    id: 'modules',
    title: 'Eleven modules',
    body: 'Receivables, projects, tax, analytics, documents, reports, audit.',
    top: '#3987e5', side: '#2a6cbd', front: '#317ad1',
  },
  {
    id: 'analyst',
    title: 'The analyst',
    body: 'Picks a measure and a grouping. The code compiles the SQL and shows it.',
    top: '#86b6ef', side: '#6b9bd6', front: '#79a9e4',
  },
]

const GAP = 74      // vertical distance between planes
const THICK = 13    // slab thickness

/**
 * The stack on its own, with an optional layer singled out.
 *
 * `active` is an index or null. When set, that slab keeps its colour and lifts
 * clear while the rest fall back and desaturate — which is what lets the
 * scroll story point at one layer without redrawing the diagram.
 */
export function StackDrawing({ active = null, className = '' }) {
  const height = GAP * (LAYERS.length - 1) + D * SKEW_X + THICK + 80
  const originX = 16
  const originY = 46
  return (
    <svg viewBox={`-16 0 ${W + D + 48} ${height}`} aria-hidden="true"
         className={className}
         style={{ width: '100%', maxWidth: 420, display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="ft-spine-2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="100%" stopColor="#4F86FF" />
        </linearGradient>
      </defs>
      {[...LAYERS].reverse().map((layer, ri) => {
        const i = LAYERS.length - 1 - ri
        const y = originY + (LAYERS.length - 1 - i) * GAP
        const on = active === null || active === i
        const lift = active === i ? -10 : 0
        return (
          <g key={layer.id}
             style={{ transform: `translateY(${lift}px)`,
                      opacity: on ? 1 : 0.28,
                      filter: on ? 'none' : 'saturate(0.25)',
                      transition: 'transform 520ms cubic-bezier(0.22,1,0.36,1), opacity 420ms ease, filter 420ms ease' }}>
            <path d={sidePath(originX, y, THICK)} fill={layer.side} />
            <path d={frontPath(originX, y, THICK)} fill={layer.front} />
            <path d={facePath(originX, y)} fill={layer.top} />
            <path d={facePath(originX, y)} fill="none"
                  stroke="rgba(255,255,255,0.22)" strokeWidth="0.8" />
          </g>
        )
      })}
      <line x1={originX - 9} y1={originY + THICK}
            x2={originX - 9} y2={originY + THICK + GAP * (LAYERS.length - 1)}
            stroke="url(#ft-spine-2)" strokeWidth="1.6" opacity="0.5" />
    </svg>
  )
}

export default function LayerStack() {
  const ref = useReveal({ threshold: 0.2 })

  const height = GAP * (LAYERS.length - 1) + D * SKEW_X + THICK + 80
  const originX = 16
  const originY = 46

  return (
    // Sized rather than split in half: an auto-fit pair gave the drawing a
    // 520px cell it did not fill and pushed the labels to the far edge, so the
    // legend read as a separate block instead of as the key to the thing
    // beside it.
    <div ref={ref} className="ft-reveal ft-stack grid gap-6 sm:gap-10 items-center"
         style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), auto))',
                  justifyContent: 'start' }}>
      <svg viewBox={`0 0 ${W + D + 32} ${height}`} aria-hidden="true"
           style={{ width: '100%', maxWidth: 420, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="ft-spine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ADE80" />
            <stop offset="100%" stopColor="#4F86FF" />
          </linearGradient>
        </defs>

        {/* Painted far-to-near so the near slabs overlap the far ones. */}
        {[...LAYERS].reverse().map((layer, ri) => {
          const i = LAYERS.length - 1 - ri
          const y = originY + (LAYERS.length - 1 - i) * GAP
          // Lifts apart on hover — the stack can be taken to pieces rather
          // than only looked at. Higher layers travel further.
          const lift = -(i * 7)
          return (
            <g key={layer.id} className="ft-plane" style={{ ['--lift']: `${lift}px` }}>
              <path d={sidePath(originX, y, THICK)} fill={layer.side} />
              <path d={frontPath(originX, y, THICK)} fill={layer.front} />
              <path d={facePath(originX, y)} fill={layer.top} />
              {/* Hairline along the top edge — an isometric slab with no
                  highlight reads as flat colour, not as a surface. */}
              <path d={facePath(originX, y)} fill="none"
                    stroke="rgba(255,255,255,0.22)" strokeWidth="0.8" />
            </g>
          )
        })}

        {/* The spine runs just outside the left edge of the stack, with light
            climbing it in the direction the data travels — records up into
            the mirror, out to the modules, up to the analyst. Drawn beside
            the slabs rather than across them: a line over an opaque
            isometric face reads as a rendering artefact, not as flow. */}
        <line x1={originX - 9} y1={originY + THICK}
              x2={originX - 9} y2={originY + THICK + GAP * (LAYERS.length - 1)}
              stroke="url(#ft-spine)" strokeWidth="1.6" opacity="0.5" />
        <circle className="ft-spark" cx={originX - 9}
                cy={originY + THICK + GAP * (LAYERS.length - 1)} r="3.4"
                fill="#4ADE80"
                style={{ ['--ft-spark-to']: `${-GAP * (LAYERS.length - 1)}px`,
                         filter: 'drop-shadow(0 0 4px #4ADE80)' }} />
      </svg>

      <ol className="flex flex-col gap-3 m-0 p-0" style={{ listStyle: 'none' }}>
        {[...LAYERS].reverse().map((layer) => (
          <li key={layer.id} className="flex items-start gap-3">
            <span aria-hidden="true" style={{
              width: 11, height: 11, borderRadius: 3, marginTop: 4, flexShrink: 0,
              background: layer.top, boxShadow: `0 0 0 3px color-mix(in srgb, ${layer.top} 18%, transparent)`,
            }} />
            <span className="min-w-0">
              <span className="block font-bold" style={{ fontSize: '0.95rem', color: 'var(--text-1)' }}>
                {layer.title}
              </span>
              <span className="block text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {layer.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
