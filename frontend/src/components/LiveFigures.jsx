/**
 * Motion for data that changes while you are looking at it.
 *
 * Six pages poll every few seconds through useAutoRefresh, so figures in this
 * app genuinely move under the reader. Until now they snapped: revenue went
 * from one number to another with no event, and nothing on the screen said
 * anything had happened. These two pieces exist to answer "what just changed?"
 *
 * The rule both of them follow is that motion here is informational, not
 * decorative. Nothing animates on mount — rolling every figure each time a
 * page opens would delay reading the real number and would signal a change
 * that did not happen. They move only when a value actually moves.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A figure that travels to its new value instead of snapping to it.
 *
 * The text is owned by the ref rather than by React children. If React held
 * it, every poll would paint the destination value first and the roll would
 * then jump backwards to its start — a visible flash of the answer before the
 * animation that is supposed to deliver it.
 */
export function LiveValue({ value, format = String, duration = 620, className, style, as: Tag = 'span' }) {
  const ref       = useRef(null)
  const previous  = useRef(null)
  const frame     = useRef(0)
  const settle    = useRef(0)
  // Held in a ref so an inline `format` arrow — which is a new function on
  // every render — cannot restart an animation that is still running.
  const formatRef = useRef(format)
  formatRef.current = format

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt  = formatRef.current
    const to   = Number.isFinite(value) ? value : null
    const from = previous.current
    previous.current = to

    // Not a number we can travel between, the first paint, or no actual
    // change: show it and stop.
    if (to === null || from === null || from === to || prefersReduced()) {
      el.textContent = fmt(value)
      return
    }

    // Rupee totals are whole numbers, and formatInr renders paise whenever a
    // fraction is present. Rounding intermediates to the precision of the
    // endpoints stops the figure growing and shedding decimals as it travels.
    const whole = Number.isInteger(from) && Number.isInteger(to)
    const quantise = n => (whole ? Math.round(n) : Math.round(n * 100) / 100)

    el.classList.add('ft-live-land')
    clearTimeout(settle.current)
    settle.current = setTimeout(() => el.classList.remove('ft-live-land'), 760)

    const t0 = performance.now()
    cancelAnimationFrame(frame.current)
    const step = now => {
      const p = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      el.textContent = fmt(quantise(from + (to - from) * eased))
      if (p < 1) frame.current = requestAnimationFrame(step)
      else el.textContent = fmt(to)
    }
    frame.current = requestAnimationFrame(step)
  }, [value, duration])

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    clearTimeout(settle.current)
  }, [])

  return <Tag ref={ref} className={className} style={style} />
}

/**
 * The live indicator.
 *
 * It used to pulse on every poll, which meant it pulsed every five seconds
 * forever and told you only that the client was still running. It now marks
 * the thing worth marking: a poll that actually brought something back.
 */
export function LiveDot({ changeCount = 0, loading = false, size = 6 }) {
  const seen = useRef(changeCount)
  const [pinging, setPinging] = useState(false)

  useEffect(() => {
    if (changeCount === seen.current) return
    seen.current = changeCount
    if (prefersReduced()) return
    setPinging(true)
    const id = setTimeout(() => setPinging(false), 1150)
    return () => clearTimeout(id)
  }, [changeCount])

  const colour = loading ? 'var(--fin-warning)' : 'var(--fin-positive)'
  return (
    <span className="ft-live-dot" style={{ width: size, height: size }} aria-hidden="true">
      {pinging && <span className="ft-live-ping" style={{ background: colour }} />}
      <span className="ft-live-core" style={{ background: colour }} />
    </span>
  )
}
