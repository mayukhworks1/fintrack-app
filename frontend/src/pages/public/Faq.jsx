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
import { FAQ, FAQ_LD, APP_LD, crumbs, graph } from '../../content/publicContent'

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

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 820 }}>
        <Reveal>
          {FAQ.map(({ q, a }, i) => (
            <details key={q} className="ft-faq" open={i === 0}>
              <summary>{q}</summary>
              <div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{a}</p>
              </div>
            </details>
          ))}
        </Reveal>
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
