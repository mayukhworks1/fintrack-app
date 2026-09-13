/**
 * Questions — the long answers, on their own route.
 *
 * These were the bottom of the landing page, where nobody reached them. As a
 * page they are findable, linkable and indexable on their own terms, and the
 * FAQPage structured data now describes a URL that is actually about the
 * questions rather than one that mentions them at the end.
 *
 * A details/summary list, so the answers are in the document whether or not
 * anyone opens them — native disclosure, keyboard-operable for free, and no
 * JavaScript standing between a crawler and the text.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import { Grain } from '../../components/LandingVisuals'
import { PageHead, Closing, Reveal } from '../../components/PublicBits'
import { FAQ, FAQ_GROUPS, FAQ_LD, APP_LD, crumbs, graph } from '../../content/publicContent'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const LD = graph(APP_LD, FAQ_LD, crumbs([{ name: 'Questions', path: '/faq' }]))

export default function Faq() {
  usePageMeta({
    title: 'Questions about FinTrack — answered at length',
    description:
      'What it does, whether the demo is real data, how GST and TDS are handled, whether the AI analyst can invent a figure, running it on your own database, and who can see what.',
    path: '/faq',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <div className="ft-dotgrid" aria-hidden="true" />
        <Grain />
        <PageHead eyebrow="Questions" lines={['Answers,', <em key="e">at length</em>]}>
          The ones people actually ask before they buy — including the two most
          worth asking about anything with an AI in it: can it make a figure up,
          and what happens to our data.
        </PageHead>
      </section>

      {/* Two columns above 900px: a standing index on the left and the
          answers on the right. Thirteen questions in one flat list, centred in
          a 1120px rail, floated in the middle of the page with nothing either
          side of it — grouping them is what turns a list into a document. */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24 ft-faq-layout"
               style={{ maxWidth: 1120 }}>
        <nav className="ft-faq-index" aria-label="Question groups">
          <p className="ft-eyebrow mb-3" style={{ fontSize: '0.6rem' }}>On this page</p>
          <ul className="m-0 p-0 flex flex-col gap-0.5" style={{ listStyle: 'none' }}>
            {FAQ_GROUPS.map(g => (
              <li key={g.name}>
                <a href={`#${slug(g.name)}`}
                   className="ft-faq-jump flex items-baseline justify-between gap-3 rounded-lg px-3 py-2"
                   style={{ textDecoration: 'none' }}>
                  <span className="font-bold" style={{ fontSize: 13, color: 'var(--text-1)' }}>
                    {g.name}
                  </span>
                  <span className="tabular-nums shrink-0" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                    {g.items.length}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {FAQ_GROUPS.map((g, gi) => (
            <Reveal key={g.name} className={gi ? 'mt-12' : ''}>
              <h2 id={slug(g.name)} className="ft-display mb-1 scroll-mt-24"
                  style={{ fontSize: '1.35rem', color: 'var(--text-1)' }}>
                {g.name}
              </h2>
              <hr className="ft-rule mb-2" style={{ marginLeft: 0, maxWidth: 180 }} />
              {g.items.map(({ q, a }, i) => (
                <details key={q} className="ft-faq" open={gi === 0 && i === 0}>
                  <summary>{q}</summary>
                  <div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{a}</p>
                  </div>
                </details>
              ))}
            </Reveal>
          ))}
        </div>
      </section>

      <Closing title="Something not answered here?"
               cta={<Link to="/login" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                       Back to the sandbox <ArrowRight size={15} aria-hidden="true" />
                     </Link>}>
        Access is by invitation — an administrator approves each account, and
        nothing on these public pages is read from a workspace.
      </Closing>
    </PublicLayout>
  )
}
