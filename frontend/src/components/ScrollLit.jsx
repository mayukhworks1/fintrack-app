/**
 * One sentence that lights word by word as it crosses the viewport.
 *
 * Used once per site, on the claim everything else rests on. The effect works
 * because it is rare — a page where every paragraph does this is a page you
 * have to wait to read, which is the opposite of the point.
 *
 * Scroll-linked in CSS where the browser supports it, so there is no listener
 * and nothing on the main thread. Where it is not supported the words simply
 * arrive lit, which is the right amount of missing for an emphasis effect:
 * the sentence still reads, it just does not perform.
 */
import { useReveal } from '../hooks/useReveal'

export default function ScrollLit({ children, className = '', style }) {
  const ref = useReveal({ threshold: 0.1 })
  const words = String(children).split(' ')
  return (
    <p ref={ref} className={`ft-reveal ft-lit ${className}`} style={style}>
      {words.map((w, i) => (
        <span key={i} className="ft-lit-w"
              style={{ ['--i']: i, ['--n']: words.length }}>
          {w}{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
}
