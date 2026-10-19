/**
 * The features hero's right-hand side: three small cards for what shipped
 * most recently, each a link down to the section that shows it working.
 *
 * Rendered only where the hero has a second column (PageHead's aside), so a
 * phone downloads none of it. The cards fan out once as the page opens —
 * a translate and a rotate settling into place — and lift a little when
 * pointed at. The headline beside them is the page's largest paint; these
 * are small, lazy images and never compete with it. Under reduced motion
 * they are simply in place.
 */
import { ArrowDownRight } from 'lucide-react'
import { screen } from '../motion/media'
import { useReveal } from '../../hooks/useReveal'

const CARDS = [
  { id: 'sheet', label: 'Spreadsheet editor', note: 'Formulas, ₹ formats, history',
    alt: 'The spreadsheet editor in Pages with an invoice tracker, sample data' },
  { id: 'link-preview', label: 'Link previews and views', note: 'A card in chat, a count per day',
    alt: 'The preview card chat apps show for a published page, sample data' },
  { id: 'gateway', label: 'AI gateway', note: 'Routes, caps, a call log',
    alt: 'Admin AI gateway: tasks with their provider routes, sample data' },
]

export default function ShippedStack() {
  const ref = useReveal({ threshold: 0.1 })
  return (
    <div ref={ref} className="ft-f-stack">
      <p className="ft-f-kicker" style={{ margin: '0 0 10px 6px' }}>Recently shipped</p>
      <ul className="ft-f-stack-list">
        {CARDS.map((c, i) => {
          const s = screen(c.id)
          return (
            <li key={c.id} className="ft-f-stack-card" style={{ '--i': i }} data-n={i}>
              <a href="#shipped">
                <span className="ft-f-stack-img">
                  {/* Shown 120px wide: a 240px thumbnail covers 2x screens,
                      and the 800px copy stays in the set for anything denser. */}
                  <img src={s.thumb || s.srcSm}
                       srcSet={s.thumb ? `${s.thumb} ${s.thumbW}w, ${s.srcSm} ${s.smW}w` : undefined}
                       sizes={s.thumb ? '120px' : undefined}
                       width={s.smW} height={Math.round((s.smW * s.h) / s.w)}
                       alt={c.alt} loading="lazy" decoding="async" />
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <b className="text-[13px] text-[var(--text-1)]">{c.label}</b>
                  <span className="text-[12px] text-[var(--text-3)]">{c.note}</span>
                </span>
                <ArrowDownRight size={15} aria-hidden="true" className="mr-1.5 text-[var(--accent-ink)]" />
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
