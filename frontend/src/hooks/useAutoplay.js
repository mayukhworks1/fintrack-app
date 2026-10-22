/**
 * The gate for anything on the public pages that moves on its own: the
 * sandbox tour, the film's walkthrough, the login slides, the hero and
 * diagram loops, and every video.
 *
 *   const { ref, running, reduced, userPaused, pause, resume, toggle } = useAutoplay({ threshold: 0.25 })
 *   <section ref={ref}>… advance only while `running` …
 *     <button aria-pressed={!running} onClick={toggle}>Pause tour</button>
 *
 * running = enabled && inView(threshold) && tab visible && !userPaused
 *           && (autoplay allowed || the visitor pressed play)
 * where "autoplay allowed" means no reduced-motion preference and no Save-Data.
 *
 * Under reduced motion or Save-Data `running` never turns true by itself.
 * It turns true only after the visitor asks — resume() or toggle() — which
 * is the "press Play" the reduced-motion rules allow. Even then it still
 * stops while the element is off screen or the tab is hidden.
 *
 * Pressing pause wins over everything until the visitor resumes.
 * The ref is a callback ref that also carries `.current`.
 */
import { useCallback, useEffect, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'
import { useNodeRef, entryVisible, thresholdsFor } from './useInView'

const saveDataOn = () =>
  typeof navigator !== 'undefined' && !!navigator.connection?.saveData

const pageVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

export function useAutoplay({ threshold = 0.25, enabled = true } = {}) {
  const reduced = useReducedMotion()
  const [ref, node] = useNodeRef()
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  const [visible, setVisible] = useState(pageVisible)
  const [saveData] = useState(saveDataOn)
  const [userPaused, setUserPaused] = useState(false)
  const [userStarted, setUserStarted] = useState(false)

  useEffect(() => {
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      setInView(entryVisible(entries[entries.length - 1], threshold))
    }, { threshold: thresholdsFor(threshold) })
    io.observe(node)
    return () => io.disconnect()
  }, [node, threshold])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => setVisible(pageVisible())
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  const allowed = !reduced && !saveData
  const running = !!(enabled && inView && visible && !userPaused && (allowed || userStarted))

  const pause = useCallback(() => { setUserPaused(true); setUserStarted(false) }, [])
  const resume = useCallback(() => { setUserPaused(false); setUserStarted(true) }, [])
  const toggle = useCallback(() => {
    if (running) pause()
    else resume()
  }, [running, pause, resume])

  return { ref, running, reduced, userPaused, pause, resume, toggle, inView, autoplay: allowed }
}
