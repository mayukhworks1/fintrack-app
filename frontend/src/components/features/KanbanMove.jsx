/**
 * Delivery & status: the status board, with one change arriving.
 *
 * Lanes are LANES and the cards are the first six of DELIVERY, each with
 * what its project is still owed: the board and the receivables are the
 * same records. Once, when the board is first reached, one card moves to
 * another lane the way a colleague's edit arrives on a live board, and
 * the live dot pings. FLIP: the card is measured where it was and where it
 * lands, and only its transform is animated. Under reduced motion nothing
 * moves; the board is shown as it stands.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DELIVERY, LANES, inrShort } from '../demoData'
import { useInView } from '../../hooks/useInView'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { LiveDot } from '../LiveFigures'

const CARDS = DELIVERY.slice(0, 6)
// Annual report's copy comes back from the editor: In progress → In review.
const MOVER = CARDS.find(c => c.id === 'p5') || CARDS.find(c => c.lane === 'In progress')
const TO = 'In review'
const DOTS = ['var(--text-3)', 'var(--accent)', 'var(--bad)', 'var(--warn)', 'var(--ok)']

export default function KanbanMove() {
  const reduced = useReducedMotion()
  const [ref, seen] = useInView({ threshold: 0.5, once: true })
  const [moved, setMoved] = useState(false)
  // The board's height before the move, held through it: the card leaves the
  // tallest lane, and without this the board (and everything under it in the
  // panel) would shrink and jump the moment it moved.
  const [hold, setHold] = useState(0)
  const card = useRef(null)
  const board = useRef(null)
  const before = useRef(null)

  useEffect(() => {
    if (!seen || reduced || moved || !MOVER) return
    const t = setTimeout(() => {
      before.current = card.current?.getBoundingClientRect() || null
      setHold(board.current?.getBoundingClientRect().height || 0)
      setMoved(true)
    }, 600)
    return () => clearTimeout(t)
  }, [seen, reduced, moved])

  // FLIP: start the card where it was, then let it travel to where it is.
  useLayoutEffect(() => {
    const el = card.current, a = before.current
    if (!moved || !el || !a) return
    before.current = null
    const b = el.getBoundingClientRect()
    const dx = a.left - b.left, dy = a.top - b.top
    if (!dx && !dy) return
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px)`
    el.getBoundingClientRect()
    requestAnimationFrame(() => {
      el.style.transition = 'transform 700ms var(--m-ease-inout), box-shadow 700ms ease'
      el.style.transform = ''
    })
  }, [moved])

  const laneOf = (c) => (moved && c.id === MOVER?.id ? TO : c.lane)

  return (
    <div ref={ref} className="ft-f-demo">
      <div className="flex items-center gap-2 mb-3">
        <LiveDot changeCount={moved ? 1 : 0} size={7} />
        <p className="ft-f-kicker" style={{ margin: 0 }}>Status board · by status</p>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--text-3)' }} aria-live="polite">
          {moved && MOVER ? `${MOVER.project} moved to ${TO}` : 'Live'}
        </span>
      </div>
      {/* On a phone the lanes scroll sideways; focusable, so the keyboard can. */}
      <div ref={board} className="ft-f-board" style={hold ? { minHeight: hold } : undefined}
           tabIndex={0} role="region" aria-label="Status board lanes">
        {LANES.map(lane => {
          const cards = CARDS.filter(c => laneOf(c) === lane)
          return (
            <div key={lane} className="ft-f-lane" role="group" aria-label={`${lane}, ${cards.length}`}>
              <p className="flex items-center gap-1.5 mb-2 text-[11.5px] font-bold text-[var(--text-1)]">
                <span className="ft-f-lane-dot" style={{ background: DOTS[LANES.indexOf(lane)] }} />{lane}
                <span className="ml-auto font-semibold text-[var(--text-3)]">{cards.length}</span>
              </p>
              {cards.length === 0 && <p className="my-3 text-[11px] text-center text-[var(--text-3)]">nothing here</p>}
              {cards.map(c => (
                <article key={c.id} ref={c.id === MOVER?.id ? card : undefined}
                         className="ft-f-card" data-moved={moved && c.id === MOVER?.id ? '' : undefined}>
                  <b className="text-[12px] text-[var(--text-1)]">{c.project}</b>
                  <span className="text-[10.5px] leading-snug text-[var(--text-3)]">{c.client}</span>
                  <span className="text-[10.5px] leading-snug text-[var(--text-3)]">{c.short}</span>
                  {c.outstanding > 0 && <small>{inrShort(c.outstanding)} open · {c.openCount}</small>}
                </article>
              ))}
            </div>
          )
        })}
      </div>
      <p className="ft-f-foot">Sample data. Each card carries what its project is still owed, from the same invoices.</p>
    </div>
  )
}
