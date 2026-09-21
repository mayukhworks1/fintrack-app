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
import { ArrowRight, Search, X, Filter, Sparkles, Check, RotateCcw } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import { Grain } from '../../components/LandingVisuals'
import { PageHead, Closing, Reveal } from '../../components/PublicBits'
import { FAQ, FAQ_GROUPS, FAQ_LD, APP_LD, crumbs, graph } from '../../content/publicContent'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const LD = graph(APP_LD, FAQ_LD, crumbs([{ name: 'Questions', path: '/faq' }]))

const TOPIC_FILTERS = [
  {
    id: 'ai',
    label: 'AI & Verification',
    keywords: ['ai', 'invent', 'figure', 'hallucin', 'model', 'sql', 'analyst', 'documents', 'citations', 'retrieval'],
  },
  {
    id: 'tax',
    label: 'GST & TDS Withholding',
    keywords: ['gst', 'tds', 'tax', 'withhold', 'filing', 'ledger', 'statutory', 'form 16a'],
  },
  {
    id: 'infra',
    label: 'Self-Hosting & Postgres',
    keywords: ['host', 'postgres', 'cloud', 'database', 'container', 'deployment', 'custom build'],
  },
  {
    id: 'rbac',
    label: 'RBAC & Access Control',
    keywords: ['role', 'permission', 'access', 'scope', 'see what', 'invitation', 'account', 'admin'],
  },
  {
    id: 'share',
    label: 'Client Sharing & Portals',
    keywords: ['share', 'client', 'link', 'password', 'expire', 'viewer', 'read-only', 'portal'],
  },
]

export default function Faq() {
  const [query, setQuery] = useState('')
  const [activeTopic, setActiveTopic] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState('all')

  usePageMeta({
    title: 'Questions about FinTrack — answered at length',
    description:
      'What it does, whether the demo is real data, how GST and TDS are handled, whether the AI analyst can invent a figure, running it on your own database, and who can see what.',
    path: '/faq',
    jsonLd: LD,
  })

  // Filter groups and items based on search query, topic filter, and selected group
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const activeTopicObj = TOPIC_FILTERS.find(t => t.id === activeTopic)

    return FAQ_GROUPS.map(g => {
      // If a specific group is selected, skip others
      if (selectedGroup !== 'all' && g.name !== selectedGroup) {
        return { ...g, items: [] }
      }

      const items = g.items.filter(item => {
        const qText = item.q.toLowerCase()
        const aText = item.a.toLowerCase()

        // Text query match
        if (q && !qText.includes(q) && !aText.includes(q)) {
          return false
        }

        // Topic filter match
        if (activeTopicObj) {
          const matchesKeyword = activeTopicObj.keywords.some(kw =>
            qText.includes(kw) || aText.includes(kw)
          )
          if (!matchesKeyword) return false
        }

        return true
      })

      return { ...g, items }
    }).filter(g => g.items.length > 0)
  }, [query, activeTopic, selectedGroup])

  const totalMatches = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.items.length, 0)
  }, [filteredGroups])

  const isFiltered = Boolean(query.trim() || activeTopic || selectedGroup !== 'all')

  const resetAllFilters = () => {
    setQuery('')
    setActiveTopic(null)
    setSelectedGroup('all')
  }

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
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

            {isFiltered && (
              <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} found
                </span>
                <button
                  onClick={resetAllFilters}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                  style={{
                    background: 'var(--bg-input)',
                    borderColor: 'var(--card-border)',
                    color: 'var(--text-2)',
                  }}
                  title="Reset all filters"
                >
                  <RotateCcw size={12} />
                  Reset
                </button>
              </div>
            )}
          </div>

          {/* Prompt topic filter chips */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1 mr-1">
              <Filter size={11} className="text-[var(--accent)]" /> Topics:
            </span>

            {TOPIC_FILTERS.map(t => {
              const isSelected = activeTopic === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTopic(isSelected ? null : t.id)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5"
                  style={{
                    background: isSelected ? 'var(--accent-dim)' : 'var(--bg-input)',
                    borderColor: isSelected ? 'var(--accent)' : 'var(--card-border)',
                    color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                    cursor: 'pointer',
                  }}
                >
                  {isSelected && <Check size={12} className="text-[var(--accent)]" />}
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Two columns above 900px: a standing index on the left and the answers on the right. */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24 ft-faq-layout"
               style={{ maxWidth: 1120 }}>
        <nav className="ft-faq-index" aria-label="Question groups">
          <p className="ft-eyebrow mb-3" style={{ fontSize: '0.6rem' }}>On this page</p>
          <ul className="m-0 p-0 flex flex-col gap-1" style={{ listStyle: 'none' }}>
            <li>
              <button
                onClick={() => setSelectedGroup('all')}
                className="w-full text-left ft-faq-jump flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 transition-all border-none bg-transparent cursor-pointer"
                style={{
                  background: selectedGroup === 'all' ? 'var(--accent-dim)' : 'transparent',
                }}
              >
                <span className="font-bold" style={{ fontSize: 13, color: selectedGroup === 'all' ? 'var(--accent)' : 'var(--text-1)' }}>
                  All Sections
                </span>
                <span className="tabular-nums shrink-0" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  {FAQ.length}
                </span>
              </button>
            </li>

            {FAQ_GROUPS.map(g => {
              const matchCount = filteredGroups.find(fg => fg.name === g.name)?.items.length || 0
              const isSelected = selectedGroup === g.name
              return (
                <li key={g.name}>
                  <button
                    onClick={() => setSelectedGroup(isSelected ? 'all' : g.name)}
                    className="w-full text-left ft-faq-jump flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 transition-all border-none bg-transparent cursor-pointer"
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'transparent',
                    }}
                  >
                    <span className="font-bold" style={{ fontSize: 13, color: isSelected ? 'var(--accent)' : 'var(--text-1)' }}>
                      {g.name}
                    </span>
                    <span className="tabular-nums shrink-0" style={{ fontSize: 11.5, color: isFiltered ? 'var(--accent)' : 'var(--text-3)' }}>
                      {isFiltered ? matchCount : g.items.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {filteredGroups.length === 0 ? (
            <div className="p-8 sm:p-12 rounded-2xl border text-center"
                 style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <p className="font-bold text-base mb-1" style={{ color: 'var(--text-1)' }}>
                No matching questions found
              </p>
              <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
                We couldn't find any questions matching your current filters.
              </p>
              <button
                onClick={resetAllFilters}
                className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Clear All Filters
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
                  <details key={q} className="ft-faq" open={isFiltered || (gi === 0 && i === 0)}>
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
