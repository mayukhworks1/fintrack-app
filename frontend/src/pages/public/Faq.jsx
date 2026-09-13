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
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Search, X, Sparkles, Filter } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import { Grain } from '../../components/LandingVisuals'
import { PageHead, Closing, Reveal } from '../../components/PublicBits'
import { FAQ, FAQ_GROUPS, FAQ_LD, APP_LD, crumbs, graph } from '../../content/publicContent'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const LD = graph(APP_LD, FAQ_LD, crumbs([{ name: 'Questions', path: '/faq' }]))

const QUICK_PROMPTS = [
  'Can the AI invent figures?',
  'GST & TDS withholding',
  'Self-hosting & Postgres',
  'Role-based access & RBAC',
  'Audit trail & history',
]

export default function Faq() {
  const [query, setQuery] = useState('')

  usePageMeta({
    title: 'Questions about FinTrack — answered at length',
    description:
      'What it does, whether the demo is real data, how GST and TDS are handled, whether the AI analyst can invent a figure, running it on your own database, and who can see what.',
    path: '/faq',
    jsonLd: LD,
  })

  // Filter groups and items based on search query
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQ_GROUPS

    return FAQ_GROUPS.map(g => {
      const items = g.items.filter(item =>
        item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
      )
      return { ...g, items }
    }).filter(g => g.items.length > 0)
  }, [query])

  const totalMatches = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.items.length, 0)
  }, [filteredGroups])

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

      {/* Semantic Search & Quick Topic Chips */}
      <section className="mx-auto px-4 sm:px-6 pt-2 pb-8" style={{ maxWidth: 1120 }}>
        <div className="p-4 sm:p-6 rounded-2xl border transition-all"
             style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search questions or keywords (e.g. AI hallucinations, GST, self-hosting, RBAC)..."
                className="w-full pl-10 pr-9 py-2.5 rounded-xl text-sm font-medium outline-none transition-all"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--card-border)',
                  color: 'var(--text-1)',
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {query && (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 self-start sm:self-center"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} found
              </span>
            )}
          </div>

          {/* Prompt chips */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1">
              <Sparkles size={11} className="text-[var(--accent)]" /> Quick lookups:
            </span>
            {QUICK_PROMPTS.map(p => (
              <button
                key={p}
                onClick={() => setQuery(p === query ? '' : p.toLowerCase().split(' ')[0])}
                className="px-2.5 py-1 rounded-lg text-xs font-medium border transition-all"
                style={{
                  background: 'var(--bg-input)',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Two columns above 900px: a standing index on the left and the answers on the right. */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24 ft-faq-layout"
               style={{ maxWidth: 1120 }}>
        <nav className="ft-faq-index" aria-label="Question groups">
          <p className="ft-eyebrow mb-3" style={{ fontSize: '0.6rem' }}>On this page</p>
          <ul className="m-0 p-0 flex flex-col gap-0.5" style={{ listStyle: 'none' }}>
            {filteredGroups.map(g => (
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
          {filteredGroups.length === 0 ? (
            <div className="p-8 rounded-2xl border text-center"
                 style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <p className="font-bold text-base mb-1" style={{ color: 'var(--text-1)' }}>
                No matching questions found
              </p>
              <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
                We couldn't find any questions matching "{query}".
              </p>
              <button
                onClick={() => setQuery('')}
                className="px-4 py-2 rounded-xl text-xs font-bold"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Clear Search Filter
              </button>
            </div>
          ) : (
            filteredGroups.map((g, gi) => (
              <Reveal key={g.name} className={gi ? 'mt-12' : ''}>
                <h2 id={slug(g.name)} className="ft-display mb-1 scroll-mt-24"
                    style={{ fontSize: '1.35rem', color: 'var(--text-1)' }}>
                  {g.name}
                </h2>
                <hr className="ft-rule mb-2" style={{ marginLeft: 0, maxWidth: 180 }} />
                {g.items.map(({ q, a }, i) => (
                  <details key={q} className="ft-faq" open={Boolean(query) || (gi === 0 && i === 0)}>
                    <summary>{q}</summary>
                    <div>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{a}</p>
                    </div>
                  </details>
                ))}
              </Reveal>
            ))
          )}
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
