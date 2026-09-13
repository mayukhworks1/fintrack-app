/**
 * The furniture every public page is built from.
 *
 * Six pages need to look like one site, and the way that fails is by each
 * page growing its own heading sizes and its own reveal timings until the
 * rhythm is different on every route. One set of parts, imported everywhere.
 */
import { useReveal } from '../hooks/useReveal'

/** Wraps a block so it animates in the first time it is scrolled to. */
export function Reveal({ children, delay = 0, className = '', ...rest }) {
  const ref = useReveal()
  return (
    <div ref={ref} className={`ft-reveal ${className}`}
         style={{ transitionDelay: `${delay}ms` }} {...rest}>
      {children}
    </div>
  )
}

/**
 * A block that carries [data-shown] without a transform of its own, for
 * headlines whose lines rise out of their own masks. A block sliding up while
 * the lines inside it also slide up is two motions over the same pixels.
 */
export function Rising({ children, ...rest }) {
  const ref = useReveal({ threshold: 0.02 })
  return <div ref={ref} {...rest}>{children}</div>
}

/**
 * A page opening: eyebrow, serif headline that rises line by line, lede.
 *
 * `lines` takes the headline pre-split, because only the author knows where
 * it should break — an automatic split lands mid-clause and reads worse than
 * no split at all.
 */
export function PageHead({ eyebrow, lines, children, size = 'clamp(2rem, 5.6vw, 3.2rem)' }) {
  return (
    <Rising className="relative mx-auto px-4 sm:px-6 pt-10 pb-8 sm:pt-14"
            style={{ maxWidth: 1120, zIndex: 1 }}>
      <p className="ft-eyebrow mb-3">{eyebrow}</p>
      <h1 className="ft-display mb-4" style={{ fontSize: size, lineHeight: 1.08 }}>
        {lines.map((line, i) => (
          <span key={i} className="ft-rise">
            <span style={{ transitionDelay: `${i * 110}ms` }}>{line}</span>
          </span>
        ))}
      </h1>
      {children && <p className="ft-lede">{children}</p>}
    </Rising>
  )
}

/**
 * A section opening. The numeral hangs in the left margin above 1024px, the
 * way a chapter opening carries one, and falls inline beside the eyebrow
 * below that, where there is no margin to hang anything in.
 */
export function Head({ n, eyebrow, title, children, className = '' }) {
  return (
    <Reveal className={`relative mb-9 ${className}`} style={{ maxWidth: 700 }}>
      <div className="ft-marginal mb-3">
        {n && <span className="n" aria-hidden="true">{n}</span>}
        <p className="ft-eyebrow">{eyebrow}</p>
      </div>
      <h2 className="ft-display mb-4"
          style={{ fontSize: 'clamp(1.7rem, 4.4vw, 2.6rem)', lineHeight: 1.14 }}>
        {title}
      </h2>
      {children && <p className="ft-lede">{children}</p>}
    </Reveal>
  )
}

/** A card in a row of them. One shape, so a grid of three reads as a set. */
export function Card({ icon: Icon, kicker, title, body, delay = 0, children }) {
  return (
    <Reveal delay={delay} className="rounded-2xl p-5 sm:p-6 h-full"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      {(Icon || kicker) && (
        <div className="flex items-center gap-2.5 mb-2.5">
          {Icon && <Icon size={18} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />}
          {kicker && <span className="ft-eyebrow" style={{ fontSize: '0.62rem' }}>{kicker}</span>}
        </div>
      )}
      <h3 className="ft-display mb-2" style={{ fontSize: '1.14rem', color: 'var(--text-1)' }}>
        {title}
      </h3>
      {body && <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>}
      {children}
    </Reveal>
  )
}

/** Auto-fitting grid. `min` is the narrowest a cell may get before it wraps. */
export function Grid({ min = 300, children, className = '', ...rest }) {
  return (
    <div className={`grid gap-5 sm:gap-6 ${className}`}
         style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
         {...rest}>
      {children}
    </div>
  )
}

/**
 * The closing call to action, and the way on to the next page.
 *
 * Every public page ends with one. Splitting a long page into six only helps
 * if each one hands you somewhere to go next; six pages that all dead-end are
 * six bounces rather than one.
 */
export function Closing({ title, children, cta, to, next }) {
  return (
    <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
      <Reveal className="ft-shine rounded-3xl px-6 py-12 sm:px-12 sm:py-14 text-center"
              style={{ background: 'linear-gradient(135deg, var(--accent-btn), var(--accent-bright))',
                       color: '#fff' }}>
        <h2 className="ft-display mb-3"
            style={{ fontSize: 'clamp(1.5rem, 4.2vw, 2.4rem)', lineHeight: 1.14 }}>
          {title}
        </h2>
        <p className="mx-auto mb-7" style={{ fontSize: '1rem', lineHeight: 1.6, opacity: 0.92, maxWidth: 480 }}>
          {children}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {cta}
          {next}
        </div>
      </Reveal>
    </section>
  )
}
