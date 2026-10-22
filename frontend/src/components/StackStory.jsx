/**
 * The architecture, told by scrolling through it.
 *
 * The rest of the site reveals: a block fades in once when it is reached and
 * then sits still for ever. That is motion triggered by scroll, not motion
 * driven by it, and the difference is the whole reason a page can feel inert
 * however much of it animates on entry.
 *
 * Here the diagram is pinned and the scroll position chooses what it shows.
 * Reading the four paragraphs walks you up the stack one slab at a time —
 * records, mirror, modules, analyst — which is the order the data actually
 * moves in, and the picture stays in front of you the whole way rather than
 * scrolling off the moment the text starts explaining it.
 *
 * Degrades on purpose, in two directions:
 *
 *   Below 1024px there is no room for a pinned column beside a reading
 *   column, so the diagram sits once at the top and the paragraphs run under
 *   it as an ordinary list. A sticky element in a single-column layout just
 *   covers the text it is meant to illustrate.
 *
 *   Under reduced motion nothing is pinned and every layer is lit. The
 *   sequence is in the numbering and the order, not only in the movement.
 */
import { useEffect, useRef, useState } from 'react'
import { LAYERS, StackDrawing } from './LayerStack'

export default function StackStory() {
  const [active, setActive] = useState(0)
  const [reduced, setReduced] = useState(false)
  const stepRefs = useRef([])

  useEffect(() => {
    setReduced(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') return
    const nodes = stepRefs.current.filter(Boolean)
    if (!nodes.length) return

    // A narrow band across the middle of the viewport: whichever step is
    // crossing it is the one being read. Watching for "mostly visible"
    // instead leaves two steps qualifying at once on a tall screen, and the
    // diagram flickers between them.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = nodes.indexOf(e.target)
            if (i >= 0) setActive(i)
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    )
    nodes.forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [reduced])

  return (
    <div className="ft-story">
      <div className="ft-story-pin">
        <StackDrawing active={reduced ? null : active} />
        {/* The legend is the key to the drawing, so it moves with it. */}
        <ol className="hidden lg:flex flex-col gap-1 mt-4 m-0 p-0" style={{ listStyle: 'none' }}>
          {LAYERS.map((l, i) => {
            const on = reduced || i === active
            return (
              <li key={l.id} className="flex items-center gap-2.5">
                <span aria-hidden="true" style={{
                  width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                  background: l.top,
                  opacity: on ? 1 : 0.3,
                  transition: 'opacity 320ms ease, box-shadow 320ms ease',
                  boxShadow: on ? `0 0 0 3px color-mix(in srgb, ${l.top} 20%, transparent)` : 'none',
                }} />
                <span style={{
                  fontSize: 12.5, fontWeight: on ? 700 : 500,
                  color: on ? 'var(--text-1)' : 'var(--text-3)',
                  transition: 'color 320ms ease',
                }}>
                  {l.title}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <ol className="ft-story-steps m-0 p-0" style={{ listStyle: 'none' }}>
        {LAYERS.map((l, i) => {
          const on = reduced || i === active
          return (
            <li key={l.id}
                ref={el => (stepRefs.current[i] = el)}
                className="ft-story-step"
                data-on={on ? '' : undefined}>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="tabular-nums font-bold shrink-0"
                      style={{ fontSize: 12, color: on ? 'var(--accent)' : 'var(--text-3)',
                               transition: 'color 320ms ease' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="ft-display" style={{ fontSize: '1.35rem', color: 'var(--text-1)' }}>
                  {l.title}
                </h3>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {STORY[i]}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* Longer than the legend line each layer carries in the diagram — the legend
   has to fit beside a drawing, this has a column to itself. */
const STORY = [
  'The base your team already works in stays the system of record. FinTrack reads and writes it directly, so there is no migration to schedule, no export to reconcile, and no second place for someone to update instead. That last one is the failure mode of every finance tool that asks you to import first.',
  'A Postgres mirror is kept current by webhooks, a thirty-second incremental pass and a periodic full reconciliation. Lists filter and sort against the mirror rather than the source, which is why a screen of six hundred invoices is instant instead of a round trip per view.',
  'Every module reads that one mirror — receivables, projects, tax, analytics, documents, reports, status, shared links and the audit trail. This is the whole reason a figure on the dashboard and a figure in a report cannot disagree: there is no second copy for them to disagree about.',
  'The analyst sits on top and is the most constrained thing in the stack. It picks a measure and a grouping from a closed list; the application compiles the statement, applies your row scoping as it builds it, runs it, and shows it to you next to the answer.',
]
