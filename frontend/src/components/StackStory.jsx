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
 * moves in. Under the drawing, each layer shows one piece of itself as it
 * becomes the one being read: three rows from the sample ledger, the mirror's
 * 30-second pass, the modules that read it, and the first lines of a
 * statement the analyst's choice compiles to. A rail beside it says where
 * you are.
 *
 * Degrades on purpose, in two directions:
 *
 *   Below 1024px there is no room for a pinned column beside a reading
 *   column, so the diagram sits once at the top and the paragraphs run under
 *   it as an ordinary list. A sticky element in a single-column layout just
 *   covers the text it is meant to illustrate.
 *
 *   Under reduced motion nothing is pinned and every layer is lit, and each
 *   layer's inset sits in its own paragraph instead of swapping under the
 *   drawing. The sequence is in the numbering and the order, not only in the
 *   movement.
 */
import { useEffect, useRef } from 'react'
import { LAYERS, StackDrawing } from './LayerStack'
import { useActiveStep } from '../hooks/useActiveStep'
import StepRail from './motion/StepRail'
import { MODULES } from '../content/publicContent'
import { INVOICES, inr, ask } from './demoData'

const ROWS = ['INV-2296', 'INV-2271', 'INV-2327']
  .map(id => INVOICES.find(i => i.id === id)).filter(Boolean)
const SQL = ask({ measure: 'outstanding', groupBy: 'client', limit: 3 }).sql.split('\n').slice(0, 2)

function Inset({ i }) {
  if (i === 0) {
    return (
      <>
        <span className="ft-s-inset-cap">Three rows of the sample ledger</span>
        <ul className="ft-s-inset-rows">
          {ROWS.map(r => (
            <li key={r.id}>
              <span>{r.id}</span>
              <span>{r.client}</span>
              <b className="tabular-nums">{inr(r.amount)}</b>
            </li>
          ))}
        </ul>
      </>
    )
  }
  if (i === 1) {
    return (
      <div className="ft-s-inset-ring">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="27" className="ft-s-ring-track" />
          <circle cx="32" cy="32" r="27" pathLength="1" className="ft-s-ring-arc ft-m-draw" />
        </svg>
        <span>
          <b>every 30 s</b>
          an incremental pass, between the webhooks and the 5-minute full pass
        </span>
      </div>
    )
  }
  if (i === 2) {
    return (
      <>
        <span className="ft-s-inset-cap">{MODULES.length} modules, one mirror</span>
        <ul className="ft-s-inset-mods ft-m-seq">
          {MODULES.map(({ icon: Icon, title }, k) => (
            <li key={title} title={title} style={{ '--i': Math.min(k, 7) }}>
              <Icon size={15} aria-hidden="true" />
              <span className="sr-only">{title}</span>
            </li>
          ))}
        </ul>
      </>
    )
  }
  return (
    <>
      <span className="ft-s-inset-cap">The statement it compiles to, first two lines</span>
      <pre className="ft-s-inset-sql"><code>{SQL.join('\n')}</code></pre>
    </>
  )
}

export default function StackStory() {
  const { active, stepRef, tracking } = useActiveStep(LAYERS.length)
  const insets = useRef([])

  // An inset draws once: the first time its layer is read it gets
  // [data-shown], and it keeps it, so scrolling back does not replay it.
  useEffect(() => {
    if (!tracking) return
    insets.current[active]?.setAttribute('data-shown', '')
  }, [active, tracking])

  return (
    <div className="ft-story ft-s-story" data-tracking={tracking ? '' : undefined}>
      <div className="ft-story-pin">
        <StackDrawing active={tracking ? active : null} />
        {tracking && (
          <div className="ft-s-insets" aria-hidden="true">
            {LAYERS.map((l, i) => (
              <div key={l.id} ref={el => (insets.current[i] = el)} className="ft-s-inset"
                   data-on={i === active ? '' : undefined}>
                <Inset i={i} />
              </div>
            ))}
          </div>
        )}
        <StepRail count={LAYERS.length} active={active} labels={LAYERS.map(l => l.title)}
                  className="ft-s-story-rail" />
      </div>

      <ol className="ft-story-steps m-0 p-0" style={{ listStyle: 'none' }}>
        {LAYERS.map((l, i) => {
          const on = !tracking || i === active
          return (
            <li key={l.id} ref={stepRef(i)} className="ft-story-step" data-on={on ? '' : undefined}>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="ft-s-story-n tabular-nums font-bold shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="ft-display" style={{ fontSize: '1.35rem', color: 'var(--text-1)' }}>
                  {l.title}
                </h3>
              </div>
              <p className="text-sm leading-relaxed">{STORY[i]}</p>
              {!tracking && <div className="ft-s-inset ft-s-inset-flat" data-shown=""><Inset i={i} /></div>}
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
  'The analyst sits on top and is the most constrained thing in the stack. It picks a measure and a grouping from a closed list; the application compiles the statement, applies your row scoping as it builds it, runs it, and shows it to you next to the answer. Every model call goes through one gateway, where each task has an ordered route of providers, a daily cap and a versioned prompt, and every call is logged.',
]
