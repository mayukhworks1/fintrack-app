/**
 * Pointer-tracked 3D tilt for cards and tiles.
 *
 * Depth belongs on chrome, not on data. A bar seen in perspective is shorter
 * than one at the front carrying the same value, so tilting a chart makes it
 * lie; tilting the card the chart sits in costs the reader nothing and is what
 * makes an interface feel physical rather than printed.
 *
 * The hook writes four custom properties on the element and lets CSS do the
 * rest, so a single class controls how the effect looks everywhere:
 *
 *   --tilt-x / --tilt-y   rotation in degrees, driven by pointer position
 *   --tilt-mx / --tilt-my  pointer position in %, for the specular sheen
 *
 * It is deliberately inert in three cases. Touch devices have no hover, so a
 * tilt there would either never fire or fire stuck on tap. `prefers-reduced-
 * motion` is a stated accessibility need, not a preference to weigh. And both
 * are re-checked live, because a user can plug in a mouse or change the setting
 * without reloading the page.
 */
import { useEffect, useRef } from 'react'

const REDUCED = '(prefers-reduced-motion: reduce)'
const FINE_POINTER = '(hover: hover) and (pointer: fine)'

export function useTilt({ max = 7, enabled = true } = {}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    if (typeof window === 'undefined' || !window.matchMedia) return

    const reduce = window.matchMedia(REDUCED)
    const fine = window.matchMedia(FINE_POINTER)

    let frame = 0
    let next = null

    const active = () => fine.matches && !reduce.matches

    const clear = () => {
      el.style.removeProperty('--tilt-x')
      el.style.removeProperty('--tilt-y')
      el.style.removeProperty('--tilt-mx')
      el.style.removeProperty('--tilt-my')
      el.removeAttribute('data-tilting')
    }

    // Reads happen in the event, writes in the frame — measuring the rect on
    // every pointermove would force layout on a path that fires at pointer rate.
    const paint = () => {
      frame = 0
      if (!next) return
      const { px, py } = next
      el.style.setProperty('--tilt-x', `${(0.5 - py) * 2 * max}deg`)
      el.style.setProperty('--tilt-y', `${(px - 0.5) * 2 * max}deg`)
      el.style.setProperty('--tilt-mx', `${px * 100}%`)
      el.style.setProperty('--tilt-my', `${py * 100}%`)
    }

    const onMove = (event) => {
      if (!active()) return
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      next = {
        px: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        py: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      }
      el.setAttribute('data-tilting', '')
      if (!frame) frame = requestAnimationFrame(paint)
    }

    const onLeave = () => {
      next = null
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      clear()
    }

    // A setting can change mid-session; drop any tilt already applied when it does.
    const onPreferenceChange = () => { if (!active()) onLeave() }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    // A tile can be scrolled out from under a stationary pointer, which fires no
    // leave event and would strand the tilt mid-rotation.
    el.addEventListener('pointercancel', onLeave)
    reduce.addEventListener?.('change', onPreferenceChange)
    fine.addEventListener?.('change', onPreferenceChange)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointercancel', onLeave)
      reduce.removeEventListener?.('change', onPreferenceChange)
      fine.removeEventListener?.('change', onPreferenceChange)
      clear()
    }
  }, [max, enabled])

  return ref
}

export default useTilt
