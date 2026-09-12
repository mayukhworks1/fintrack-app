/**
 * Reveal an element the first time it is scrolled into view.
 *
 * Sets `data-shown` on the node, which the `.ft-reveal` class in index.css
 * releases. Doing it with an attribute rather than React state means the
 * transition is pure CSS and the component never re-renders on scroll.
 *
 * Reveals once and then disconnects: an element that re-hides when scrolled
 * past and re-animates on the way back is a distraction, not an effect.
 *
 * Under `prefers-reduced-motion` the element is shown immediately and no
 * observer is created — the content still has to arrive, it just does not
 * travel to get there.
 */
import { useEffect, useRef } from 'react'

export function useReveal({ threshold = 0.12, rootMargin = '0px 0px -8% 0px' } = {}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const show = () => el.setAttribute('data-shown', '')

    // No IntersectionObserver (or motion is unwelcome) — show it and stop.
    if (typeof IntersectionObserver === 'undefined') return show()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return show()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show()
            observer.disconnect()
          }
        }
      },
      { threshold, rootMargin }
    )
    observer.observe(el)

    // An element already past the viewport when mounted may never fire an
    // entry — deep-linking to #features would otherwise leave everything above
    // it permanently invisible.
    const settle = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) show()
    }, 220)

    return () => { clearTimeout(settle); observer.disconnect() }
  }, [threshold, rootMargin])

  return ref
}

export default useReveal
