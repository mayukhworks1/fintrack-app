/**
 * Which step of a story is being read.
 *
 *   const { active, stepRef, tracking } = useActiveStep(3)
 *   {steps.map((s, i) => <article ref={stepRef(i)} data-active={active === i || !tracking ? '' : undefined}>)}
 *
 * A narrow band across the viewport decides it: whichever step is crossing
 * the band is the one being read. Watching for "mostly visible" instead lets
 * two steps qualify at once on a tall screen and the media flickers between
 * them. The band defaults to the middle tenth of the screen; a list read from
 * the top (a table of contents) passes a band nearer the top.
 *
 * A jump — Page Down, End, a link to an anchor — can carry a step across the
 * band between two frames, and the observer never sees it cross. So when
 * scrolling settles the step is decided again from positions: the last step
 * whose top has passed the band's reading line, or the first step when none
 * has.
 *
 * With `disabled`, under reduced motion, or with no IntersectionObserver,
 * `active` stays 0 and `tracking` is false: render every step as lit.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

/** The reading line of a band such as '-45% 0px -45% 0px', as a share of the viewport. */
function readingLine(band) {
  const parts = String(band).trim().split(/\s+/)
  const pct = (v) => (typeof v === 'string' && v.endsWith('%') ? -parseFloat(v) / 100 : 0)
  const top = pct(parts[0])
  const bottom = pct(parts[2] ?? parts[0])
  const line = (top + (1 - bottom)) / 2
  return Number.isFinite(line) && line > 0 && line < 1 ? line : 0.5
}

export function useActiveStep(count, { band = '-45% 0px -45% 0px', disabled = false } = {}) {
  const reduced = useReducedMotion()
  const [active, setActive] = useState(0)
  const nodes = useRef([])
  const makers = useRef(new Map())
  const [version, setVersion] = useState(0)

  // Stable per index, so a re-render does not detach and re-attach refs.
  const stepRef = useCallback((i) => {
    if (!makers.current.has(i)) {
      makers.current.set(i, (el) => {
        if (nodes.current[i] === el) return
        nodes.current[i] = el
        setVersion(v => v + 1)
      })
    }
    return makers.current.get(i)
  }, [])

  const tracking = !disabled && !reduced && typeof IntersectionObserver !== 'undefined'

  useEffect(() => {
    if (!tracking) { setActive(0); return }
    const list = nodes.current.slice(0, count).filter(Boolean)
    if (!list.length) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const i = nodes.current.indexOf(e.target)
        if (i >= 0 && i < count) setActive(i)
      }
    }, { rootMargin: band, threshold: 0 })
    list.forEach(n => io.observe(n))

    // Settle from positions once scrolling stops.
    const line = readingLine(band)
    const settle = () => {
      const steps = nodes.current.slice(0, count)
      const y = (window.innerHeight || 0) * line
      let at = 0
      steps.forEach((n, i) => { if (n && n.getBoundingClientRect().top <= y) at = i })
      setActive(at)
    }
    const hasEnd = 'onscrollend' in window
    let timer = 0
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(settle, 140) }
    if (hasEnd) window.addEventListener('scrollend', settle, { passive: true })
    else window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      clearTimeout(timer)
      if (hasEnd) window.removeEventListener('scrollend', settle)
      else window.removeEventListener('scroll', onScroll)
    }
  }, [tracking, count, band, version])

  return { active: tracking ? Math.min(active, Math.max(0, count - 1)) : 0, stepRef, tracking }
}
