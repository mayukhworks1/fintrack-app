/**
 * A real sample figure that counts up the first time it is scrolled to, and
 * rolls when it changes.
 *
 *   <RollNumber value={TOTALS.overdue} format={inr} />
 *
 * Only for figures that come from demoData, from a captured screen, or from a
 * fact about the product (a count of modules or roles). Never for an
 * invented outcome.
 *
 * Two elements: the visible figure, a span whose text is owned by a ref so
 * React never paints the answer and then jumps back to the start of the
 * roll; and a visually hidden span beside it. While the visible figure is
 * anywhere but its final value (waiting to count up, or rolling), the visible
 * span is aria-hidden and the hidden one holds format(value), so assistive
 * technology and anything reading the text only ever get the real figure.
 * At rest the hidden span is empty and the visible one is read as usual.
 *
 * It shows format(value) at first paint. It only counts up from `from` when
 * motion is allowed and IntersectionObserver exists, and the observer's first
 * report says the figure is below the viewport; it then counts up once 40%
 * of it is visible. Nothing is measured synchronously: the observer reports
 * position without forcing a layout, so a block of figures mounting together
 * costs no layout of its own. A figure on screen at mount, or under reduced
 * motion, never animates. Later changes of `value` roll from the figure shown
 * to the new one over 620ms.
 *
 * It reserves the width of the final figure (min-width in ch, inline-block,
 * aligned by `align`), so the count never pushes text around it.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../../hooks/useReducedMotion'

const defaultFormat = (n) => (Number.isFinite(n) ? n.toLocaleString('en-IN') : String(n ?? ''))
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const ALIGN = { end: 'right', start: 'left', center: 'center' }
const CHANGE_MS = 620

/** Below the viewport, from an observer entry (no layout read of our own).
 *  A box with no size has not been laid out yet (a section the browser is
 *  skipping until it nears the screen): that is off screen too. */
function entryBelow(e) {
  const r = e?.boundingClientRect
  if (r && !r.width && !r.height) return true
  const top = r?.top
  if (typeof top !== 'number') return false
  const vh = e.rootBounds?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0)
  return top >= (vh || 0)
}

export default function RollNumber({
  value, format = defaultFormat, from = 0, duration = 1200,
  align = 'end', className = '', style,
}) {
  const ref = useRef(null)
  const srRef = useRef(null)
  const fmt = useRef(format)
  fmt.current = format
  const target = useRef(null)    // the value the figure is heading for
  const shown = useRef(null)     // the number currently on screen
  const frame = useRef(0)
  const waiting = useRef(null)   // observer holding the first count-up

  // The visible figure and what assistive technology reads. While the two
  // differ, the visible one is hidden from it and the real figure is spoken.
  const sync = () => {
    const el = ref.current
    const sr = srRef.current
    if (!el || !sr) return
    const moving = target.current !== null && shown.current !== target.current
    const spoken = moving ? fmt.current(target.current) : ''
    // Written only when they change: this runs on every frame of a roll.
    if (moving !== el.hasAttribute('aria-hidden')) {
      if (moving) el.setAttribute('aria-hidden', 'true')
      else el.removeAttribute('aria-hidden')
    }
    if (sr.textContent !== spoken) sr.textContent = spoken
  }

  const paint = (n) => {
    shown.current = n
    if (ref.current) ref.current.textContent = fmt.current(n)
    sync()
  }

  const roll = (a, b, ms) => {
    cancelAnimationFrame(frame.current)
    const whole = Number.isInteger(a) && Number.isInteger(b)
    const q = (n) => (whole ? Math.round(n) : Math.round(n * 100) / 100)
    const t0 = performance.now()
    const step = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / ms))
      if (p >= 1) { paint(b); return }
      paint(q(a + (b - a) * easeOut(p)))
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const to = Number.isFinite(value) ? value : null
    const first = target.current === null && shown.current === null
    target.current = to

    if (to === null) {
      cancelAnimationFrame(frame.current)
      shown.current = null
      el.textContent = fmt.current(value)
      sync()
      return
    }

    if (first) {
      paint(to)
      const canWait = typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion()
      if (!canWait || !Number.isFinite(from) || from === to) return
      // The observer's first report says where the figure is. On screen (or
      // above it) it stays as it is; below the viewport it drops to `from`,
      // out of sight, and counts up once 40% of it has been scrolled to.
      let decided = false
      const io = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1]
        if (!e) return
        if (!decided) {
          decided = true
          if (!e.isIntersecting && entryBelow(e) && !prefersReducedMotion()) {
            paint(from)
            return
          }
          io.disconnect()
          waiting.current = null
          return
        }
        if (!e.isIntersecting) return
        if (typeof e.intersectionRatio === 'number' && e.intersectionRatio < 0.39) return
        io.disconnect()
        waiting.current = null
        if (prefersReducedMotion()) paint(target.current)
        else roll(shown.current, target.current, duration)
      }, { threshold: [0, 0.4] })
      io.observe(el)
      waiting.current = io
      return
    }

    // Still waiting to be revealed: the count-up will head for the new value.
    if (waiting.current) {
      if (shown.current !== to && shown.current === from) sync()
      else if (shown.current !== from) paint(to)
      return
    }
    if (shown.current === to) { paint(to); return }
    if (prefersReducedMotion() || shown.current === null) { cancelAnimationFrame(frame.current); paint(to); return }
    roll(shown.current, to, CHANGE_MS)
    // `format` is read through a ref so an inline arrow cannot restart a roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Reset on unmount, so a remount (StrictMode runs one in development)
  // starts again from a clean first paint instead of a half-finished one.
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    waiting.current?.disconnect()
    waiting.current = null
    target.current = null
    shown.current = null
  }, [])

  const width = String(format(value)).length
  return (
    <>
      <span
        ref={ref}
        className={`ft-m-roll tabular-nums ${className}`.trim()}
        style={{ minWidth: `${width}ch`, textAlign: ALIGN[align] || 'right', ...style }}
      />
      <span ref={srRef} className="sr-only" />
    </>
  )
}
