/**
 * Holds a block of reserved size until it is near the viewport, then mounts
 * its children.
 *
 *   const ProductFilm = lazy(() => import('../components/ProductFilm'))
 *   <LazyMount minHeight={620} id="film">
 *     <Suspense fallback={null}><ProductFilm /></Suspense>
 *   </LazyMount>
 *
 * The wrapper keeps `minHeight` (or `aspectRatio`) for its whole life, so the
 * space is there before, during and after the chunk loads and nothing below
 * it moves. Measure the real height at each breakpoint and pass that.
 *
 * With no IntersectionObserver it mounts at once, so old browsers and tests
 * see the content. (happy-dom has an IntersectionObserver that never fires:
 * stub it in a test that needs what is inside.) Other props — `id`,
 * `className`, `style`, aria — go on the wrapper, so an anchor target exists
 * before the content does.
 */
import { useEffect, useRef, useState } from 'react'

export default function LazyMount({
  children, minHeight, aspectRatio, rootMargin = '600px 0px',
  className = '', style, ...rest
}) {
  const ref = useRef(null)
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (mounted) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setMounted(true); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); setMounted(true) }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [mounted, rootMargin])

  return (
    <div
      ref={ref}
      className={`${mounted ? '' : 'ft-m-placeholder '}${className}`.trim() || undefined}
      data-mounted={mounted ? '' : undefined}
      style={{ minHeight, aspectRatio, ...style }}
      {...rest}
    >
      {mounted ? children : null}
    </div>
  )
}
