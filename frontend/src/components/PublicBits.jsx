/**
 * The parts every public page is built from.
 *
 * The site is set like a printed report: a twelve-column grid with a margin
 * column for running heads, Fraunces for display type, the system face for
 * reading, hairline rules, and real screens as numbered plates. One set of
 * parts keeps nine pages on one rhythm. Styles: styles/public-site.css.
 */
import { Link } from 'react-router-dom'
import { useReveal } from '../hooks/useReveal'
import { screen as shotOf } from './motion/media'

/** Fades a block in the first time it is reached. The site's one entrance. */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div', style, ...rest }) {
  const ref = useReveal()
  return (
    <Tag ref={ref} className={`ft-reveal ${className}`.trim()}
         style={delay ? { transitionDelay: `${delay}ms`, ...style } : style} {...rest}>
      {children}
    </Tag>
  )
}

/** Kept for pages that mark a block as reached without moving it. */
export function Rising({ children, ...rest }) {
  const ref = useReveal({ threshold: 0.02 })
  return <div ref={ref} {...rest}>{children}</div>
}

export function Stagger({ as: Tag = 'div', children, className = '', ...rest }) {
  return <Tag className={className} {...rest}>{children}</Tag>
}

/** A plain hairline. */
export function Rule({ className = '', style }) {
  return <hr className={className} style={{ border: 0, borderTop: '1px solid var(--card-border)', margin: 0, ...style }} />
}

/**
 * A page opening. `eyebrow` is the running head in the margin column,
 * `lines` the headline (pre-split where the author wants it to break),
 * `children` the lede, `actions` an optional row of buttons.
 * Visible in the first frame: the opening never waits on an animation.
 */
export function PageHead({ eyebrow, lines, children, actions, aside }) {
  return (
    <div className="pb-wrap pb-open">
      <div className="pb-row">
        <div className="pb-margin"><p className="pb-label">{eyebrow}</p></div>
        <div className="pb-main">
          <h1 className="pb-display">
            {lines.map((line, i) => (
              <span key={i}>{line}{i < lines.length - 1 ? ' ' : ''}</span>
            ))}
          </h1>
          {children && <p className="pb-lede">{children}</p>}
          {actions && <div className="pb-actions">{actions}</div>}
          {aside && <div style={{ marginTop: 40 }}>{aside}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * A section: running head in the margin, headline and lede in the main
 * column, then the body. `n` numbers the section in the running head.
 */
export function Section({ n, eyebrow, title, lede, children, id, flush = false, wide = false, className = '' }) {
  return (
    <section id={id} className={`pb-section${flush ? ' pb-flush' : ''} ${className}`.trim()}>
      <div className="pb-wrap">
        <div className="pb-row">
          <div className="pb-margin">
            {(n || eyebrow) && (
              <p className="pb-label">{n && <span className="pb-n">{n}</span>}{eyebrow}</p>
            )}
          </div>
          <div className="pb-main">
            {title && (
              <Reveal style={{ maxWidth: '40em' }}>
                <h2 className="pb-h2">{title}</h2>
                {lede && <p className="pb-lede" style={{ marginTop: 18 }}>{lede}</p>}
              </Reveal>
            )}
            {!wide && children && <div style={{ marginTop: title ? 'clamp(32px, 4vw, 56px)' : 0 }}>{children}</div>}
          </div>
          {wide && children && <div style={{ marginTop: 'clamp(32px, 4vw, 56px)' }}>{children}</div>}
        </div>
      </div>
    </section>
  )
}

/** A section heading on its own, for pages that lay out their own body. */
export function Head({ n, eyebrow, title, children, className = '' }) {
  return (
    <Reveal className={className} style={{ maxWidth: '40em', marginBottom: 'clamp(28px, 4vw, 48px)' }}>
      {(n || eyebrow) && <p className="pb-label">{n && <span className="pb-n">{n}</span>}{eyebrow}</p>}
      <h2 className="pb-h2">{title}</h2>
      {children && <p className="pb-lede" style={{ marginTop: 18 }}>{children}</p>}
    </Reveal>
  )
}

/** One item in a ruled list: a title and a paragraph. No box, no icon. */
export function Card({ kicker, title, body, children }) {
  return (
    <li>
      {kicker && <p className="pb-label" style={{ marginBottom: 6 }}>{kicker}</p>}
      <h3 className="pb-h3">{title}</h3>
      {body && <p className="pb-body" style={{ marginTop: 6 }}>{body}</p>}
      {children}
    </li>
  )
}

/** Items in columns, each under a hairline. */
export function Grid({ children, className = '', ...rest }) {
  return <ul className={`pb-list pb-cols ${className}`.trim()} {...rest}>{children}</ul>
}

/**
 * A real capture of the product, cropped to the part that matters, with
 * numbered marks on the screen and the notes that go with them below.
 * `crop` is [x, y, width, height] in the capture's pixels.
 */
export function Plate({ id, crop, alt, caption, fig, notes = [], eager = false, sizes = '(min-width: 1200px) 900px, 92vw' }) {
  const s = shotOf(id)
  const [x, y, w, h] = crop || [0, 0, s.w, s.h]
  const k = s.w / w
  const scaled = sizes.replace(/(\d+(?:\.\d+)?)(px|vw)/g, (_, v, u) => `${Math.round(Number(v) * k)}${u}`)
  const marks = notes
    .map((n, i) => ({ ...n, i, left: (n.x - x) / w, top: (n.y - y) / h }))
    .filter(n => n.x == null || (n.left > 0.02 && n.left < 0.98 && n.top > 0.02 && n.top < 0.98))
  return (
    <figure className="pb-plate">
      <div className="pb-plate-frame" style={{ aspectRatio: `${w} / ${h}` }}>
        <img src={s.srcSm} srcSet={`${s.srcSm} ${s.smW}w, ${s.src} ${s.w}w`} sizes={scaled}
             width={s.w} height={s.h} alt={alt}
             loading={eager ? 'eager' : 'lazy'} decoding="async"
             style={{ width: `${k * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }} />
        {marks.filter(m => m.x != null).map((m, j) => (
          <span key={m.i} className="pb-mark" aria-hidden="true"
                style={{ left: `${m.left * 100}%`, top: `${m.top * 100}%` }}>{j + 1}</span>
        ))}
      </div>
      {marks.length > 0 && (
        <ol className="pb-notes" aria-label="Notes on this screen">
          {marks.map((m, j) => (
            <li key={m.i}>
              <span aria-hidden="true">{j + 1}</span>
              <span><b>{m.label}.</b> {m.body}</span>
            </li>
          ))}
        </ol>
      )}
      {caption && <figcaption className="pb-cap">{fig && <b>Fig. {fig}</b>}{caption}</figcaption>}
    </figure>
  )
}

/** The primary and the quiet button, as links. */
export function Btn({ to, href, children, quiet = false, small = false, ...rest }) {
  const cls = `pb-btn ${quiet ? 'pb-btn-quiet' : 'pb-btn-primary'}${small ? ' pb-btn-sm' : ''}`
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>
  return <Link to={to} className={cls} {...rest}>{children}</Link>
}

/**
 * The close of every page: a plain statement, the way in, and the next page.
 * `cta` and `next` may be elements; if omitted, sign-in is the action.
 */
export function Closing({ title, children, cta, next }) {
  return (
    <section className="pb-section">
      <div className="pb-wrap">
        <div className="pb-row">
          <div className="pb-margin"><p className="pb-label">Next</p></div>
          <Reveal className="pb-main">
            <h2 className="pb-h2" style={{ maxWidth: '18em' }}>{title}</h2>
            {children && <p className="pb-lede" style={{ marginTop: 16 }}>{children}</p>}
            <div className="pb-actions" style={{ marginTop: 28 }}>
              {cta || <Btn to="/login">Sign in</Btn>}
              {next}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
