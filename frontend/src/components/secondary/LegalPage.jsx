/**
 * The frame the privacy policy and the terms share.
 *
 * Both used to render their own <main> inside the public shell's <main>, and
 * neither set a title, so the tab read "Sign in" and the document had two
 * main landmarks. This is an <article> under the shell's one <main>, with the
 * page's own title and description, and the heading outside any reveal: it
 * is painted in the first frame. So is the text: legal sections do not fade
 * in, since the first paragraph is usually the largest thing on the screen.
 *
 * At 1024px and wider a contents list stands beside the text and follows the
 * section being read; its ink bar is the only motion. Phones get no list:
 * six short sections are quicker to scroll than a menu is to use.
 *
 * The legal text is passed in as written. It is not edited here.
 */
import { Link } from 'react-router-dom'
import { usePageMeta } from '../../hooks/usePageMeta'
import { useActiveStep } from '../../hooks/useActiveStep'
import { useInk } from '../../hooks/useInk'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import PublicLayout from '../PublicLayout'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-legal.css'

const slug = (s) => s.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export default function LegalPage({ meta, title, stamp, sections, links }) {
  usePageMeta(meta)
  const wide = useMediaQuery('(min-width: 1024px)')
  // Read from the top: a band near the top of the screen, so the first
  // section is the one lit when the page opens.
  const { active, stepRef, tracking } = useActiveStep(sections.length, { disabled: !wide, band: '-15% 0px -70% 0px' })
  const ink = useInk(tracking ? active : -1, { axis: 'y' })

  return (
    <PublicLayout>
      <article className="ft-s-legal mx-auto px-4 sm:px-6 py-12 sm:py-16" style={{ maxWidth: 1120 }}>
        <header className="ft-s-legal-head">
          <p className="ft-eyebrow mb-3">Legal</p>
          <h1 className="ft-display">{title}</h1>
          <p className="ft-s-legal-stamp">{stamp}</p>
        </header>

        <div className="ft-s-legal-body">
          {wide && (
            <nav className="ft-s-legal-toc" aria-label="On this page">
              <p className="ft-eyebrow mb-3" style={{ fontSize: '0.6rem' }}>On this page</p>
              <div ref={ink} className="ft-m-ink">
                <ol>
                  {sections.map(({ heading }, i) => {
                    const on = tracking && i === active
                    return (
                      <li key={heading}>
                        <a href={`#${slug(heading)}`} aria-current={on ? 'true' : undefined}
                           data-active={on ? '' : undefined}>
                          {heading.replace(/^\d+\.\s*/, '')}
                        </a>
                      </li>
                    )
                  })}
                </ol>
                <span className="ft-m-ink-bar" aria-hidden="true" />
              </div>
            </nav>
          )}

          <div className="ft-s-legal-text">
            {sections.map(({ heading, body }, i) => (
              <section key={heading} ref={stepRef(i)} id={slug(heading)} aria-labelledby={`${slug(heading)}-h`}>
                <h2 id={`${slug(heading)}-h`}>{heading}</h2>
                <p>{body}</p>
              </section>
            ))}

            <nav className="ft-s-legal-foot" aria-label="Related pages">
              {links.map(({ to, label }) => (
                <Link key={to} to={to}>{label}</Link>
              ))}
            </nav>
          </div>
        </div>
      </article>
    </PublicLayout>
  )
}
