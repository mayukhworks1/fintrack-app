/**
 * Whether an element is on screen.
 *
 *   const [ref, inView] = useInView({ threshold: 0.25 })
 *   <div ref={ref}>…</div>
 *
 * The ref is a callback ref that also carries `.current`, so it can be passed
 * as `ref={ref}` and read as `ref.current`. Where there is no
 * IntersectionObserver the element counts as in view, so content that waits
 * for it still arrives. With `once`, it stops watching after the first time.
 */
import { useEffect, useMemo, useState } from 'react'

/** A callback ref that also exposes `.current`, and re-renders when the node changes. */
export function useNodeRef() {
  const [node, setNode] = useState(null)
  const ref = useMemo(() => {
    const fn = (el) => { fn.current = el; setNode(el) }
    fn.current = null
    return fn
  }, [])
  return [ref, node]
}

/** True when an entry shows at least `threshold` of the element, or fills that share of the viewport. */
export function entryVisible(entry, threshold) {
  if (!entry || !entry.isIntersecting) return false
  if (typeof entry.intersectionRatio !== 'number') return true
  if (entry.intersectionRatio >= threshold - 0.001) return true
  // An element taller than the viewport can never show `threshold` of
  // itself; count it as visible once it fills that share of the screen.
  const root = entry.rootBounds
  return !!(root && root.height && entry.intersectionRect &&
    entry.intersectionRect.height >= root.height * threshold)
}

export function thresholdsFor(threshold) {
  return [...new Set([0, threshold / 2, threshold, (threshold + 1) / 2, 1])]
}

export function useInView({ threshold = 0, rootMargin = '0px', once = false } = {}) {
  const [ref, node] = useNodeRef()
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      const visible = entryVisible(entry, threshold)
      setInView(visible)
      if (visible && once) io.disconnect()
    }, { threshold: thresholdsFor(threshold), rootMargin })
    io.observe(node)
    return () => io.disconnect()
  }, [node, threshold, rootMargin, once])

  return [ref, inView]
}
