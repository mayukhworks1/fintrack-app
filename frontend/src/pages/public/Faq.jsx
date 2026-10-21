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
 * JavaScript standing between a crawler and the text. Opening one eases the
 * answer open where the browser can animate to an automatic height, and
 * simply opens it where it cannot.
 *
 * Search marks what it matched in the questions and the answers, topics
 * narrow the list, and the index beside it follows the group being read.
 */
import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import { useInk } from '../../hooks/useInk'
import { useActiveStep } from '../../hooks/useActiveStep'
import PublicLayout from '../../components/PublicLayout'
import RollNumber from '../../components/motion/RollNumber'
import { PageHead, Closing, Reveal, Btn } from '../../components/PublicBits'
import { FAQ, FAQ_GROUPS, FAQ_LD, APP_LD, crumbs, graph } from '../../content/publicContent'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-faq.css'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const LD = graph(APP_LD, FAQ_LD, crumbs([{ name: 'Questions', path: '/faq' }]))

/* Each topic is a set of words; a question belongs to it when its question
   or its answer contains one of them. */
const TOPICS = [
  { id: 'ai', label: 'The AI analyst', words: ['analyst', 'model', 'sql', 'gateway', 'providers', 'invent'] },
  { id: 'tax', label: 'GST and TDS', words: ['gst', 'tds', 'tax', 'withh', 'filing'] },
  { id: 'host', label: 'Your own cloud', words: ['own database', 'own cloud', 'postgres', 'container', 'instance', 'build a module'] },
  { id: 'access', label: 'Who sees what', words: ['permission', 'role', 'invitation', 'approve', 'see what'] },
  { id: 'share', label: 'Sharing with clients', words: ['share', 'publish', 'link', 'password', 'expire'] },
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text with every match of `q` wrapped in a mark. Plain text when there is no query. */
function marked(text, q) {
  if (!q) return text
  const parts = text.split(new RegExp(`(${escape(q)})`, 'ig'))
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="ft-s-hit">{p}</mark> : p))
}

const whole = (n) => String(Math.round(n))

export default function Faq() {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState(null)

  usePageMeta({
    title: 'Questions about FinTrack, answered at length',
    description:
      'What it does, whether the demo is real data, how GST and TDS are handled, whether the AI analyst can invent a figure, running it on your own database, and who can see what.',
    path: '/faq',
    jsonLd: LD,
  })

  const q = query.trim()
  const groups = useMemo(() => {
    const needle = q.toLowerCase()
    const t = TOPICS.find(x => x.id === topic)
    return FAQ_GROUPS.map(g => ({
      ...g,
      items: g.items.filter(({ q: question, a }) => {
        const text = `${question} ${a}`.toLowerCase()
        if (needle && !text.includes(needle)) return false
        if (t && !t.words.some(w => text.includes(w))) return false
        return true
      }),
    })).filter(g => g.items.length > 0)
  }, [q, topic])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const filtered = Boolean(q || topic)
  const reset = () => { setQuery(''); setTopic(null) }

  const topicIndex = TOPICS.findIndex(t => t.id === topic)
  const chipInk = useInk(topicIndex)

  const { active, stepRef, tracking } = useActiveStep(groups.length)
  const activeName = tracking ? groups[active]?.name : null
  const indexInk = useInk(FAQ_GROUPS.findIndex(g => g.name === activeName), { axis: 'y' })

  return (
    <PublicLayout>
      <PageHead eyebrow="Questions" lines={['Answers,', <em key="e">at length</em>]}>
        The ones people ask before they buy, including the two worth asking of
        anything with a language model in it: can it make a figure up, and what
        happens to our data.
      </PageHead>

      <section className="pb-wrap" style={{ paddingBottom: 32 }}>
        <Reveal className="ft-s-finder">
          <div className="ft-s-search">
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                   aria-label="Search the questions and answers"
                   placeholder="Search, e.g. GST or permissions" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="ft-s-finder-row">
            <div ref={chipInk} className="ft-m-ink ft-s-chips" role="group" aria-label="Topics">
              {TOPICS.map(t => (
                <button key={t.id} type="button" aria-pressed={t.id === topic}
                        onClick={() => setTopic(t.id === topic ? null : t.id)}>
                  {t.label}
                </button>
              ))}
              <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
            </div>
            <span className="sr-only" role="status">{filtered ? `${total} of ${FAQ.length} questions match` : ''}</span>
            <p className="ft-s-count">
              {filtered ? (
                <>
                  <span><RollNumber value={total} format={whole} align="end" /> of {FAQ.length} questions</span>
                  <button type="button" onClick={reset} className="ft-s-reset">
                    Reset
                  </button>
                </>
              ) : `${FAQ.length} questions`}
            </p>
          </div>
        </Reveal>
      </section>

      {/* Two columns above 900px: a standing index on the left and the answers on the right. */}
      <section className="pb-wrap ft-faq-layout ft-s-faq" style={{ paddingBottom: 'clamp(56px, 8vw, 112px)' }}>
        <nav className="ft-faq-index" aria-label="Question groups">
          <p className="pb-label">On this page</p>
          <div ref={indexInk} className="ft-m-ink ft-s-index">
          <ul>
            {FAQ_GROUPS.map(g => {
              const n = groups.find(x => x.name === g.name)?.items.length || 0
              const on = g.name === activeName
              return (
                <li key={g.name}>
                  {n ? (
                    <a href={`#${slug(g.name)}`} className="ft-faq-jump" aria-current={on ? 'true' : undefined}
                       data-active={on ? '' : undefined}>
                      <span>{g.name}</span>
                      <span className="tabular-nums">{n}</span>
                    </a>
                  ) : (
                    <span className="ft-s-index-off"><span>{g.name}</span><span className="tabular-nums">0</span></span>
                  )}
                </li>
              )
            })}
          </ul>
          <span className="ft-m-ink-bar" aria-hidden="true" />
          </div>
        </nav>

        <div className="min-w-0">
          {groups.length === 0 ? (
            <div className="ft-s-empty">
              <p><b>No question matches that.</b></p>
              <p>Try a shorter word, or clear the topic.</p>
              <button type="button" onClick={reset}>
                Reset filters
              </button>
            </div>
          ) : (
            groups.map((g, gi) => (
              <div key={g.name} ref={stepRef(gi)} className={gi ? 'mt-12' : ''}>
                <Reveal>
                  <h2 id={slug(g.name)} className="pb-h3s scroll-mt-24" style={{ marginBottom: 12 }}>
                    {g.name}
                  </h2>
                  {g.items.map(({ q: question, a }, i) => (
                    <details key={question} className="ft-faq" open={filtered || (gi === 0 && i === 0)}>
                      <summary><span>{marked(question, q)}</span></summary>
                      <div>
                        <p className="pb-body">{marked(a, q)}</p>
                      </div>
                    </details>
                  ))}
                </Reveal>
              </div>
            ))
          )}
        </div>
      </section>

      <Closing title="Something not answered here?"
               next={<Btn to="/" quiet>Back to the sandbox</Btn>}>
        Access is by invitation. An administrator approves each account, and
        nothing on these public pages is read from a workspace.
      </Closing>
    </PublicLayout>
  )
}
