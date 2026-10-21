/**
 * How it works — the mechanism, on its own page.
 *
 * This was the middle third of a landing page that had reached seventeen
 * screens on a phone. It is the part a technical buyer reads closely and
 * everyone else skips, which is exactly the argument for giving it a route:
 * the people who want it can be sent straight here, and the people who do not
 * are no longer scrolling past it to reach the price of admission.
 *
 * Every moving part here moves once and shows a step being taken: the sync
 * cadence draws itself, the three steps join up, a sample record crosses into
 * the mirror, the stack lights the layer being read, and the analyst's work is
 * handed from stage to stage. Nothing loops.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import LazyMount from '../../components/motion/LazyMount'
import { PageHead, Section, Plate, Reveal, Btn, Closing } from '../../components/PublicBits'
import { STEPS, APP_LD, crumbs, graph } from '../../content/publicContent'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-hiw.css'

const SyncPipelineSimulator = lazy(() => import('../../components/SyncPipelineSimulator'))

const LD = graph(APP_LD, crumbs([{ name: 'How it works', path: '/how-it-works' }]))

/* How the mirror stays current, as the code schedules it. */
const CADENCE = [
  ['Webhook', 'On every change in the base', 'The changed record, within seconds'],
  ['Incremental pass', 'Every 30 s', 'The 200 most recently modified records in each table'],
  ['Full reconciliation', 'Every 5 min', 'Every record, so a missed webhook cannot linger'],
]

/* What happens between a question and the figure. */
const ANSWER = [
  ['You ask', 'A question in plain words, such as “What is outstanding by client?”'],
  ['The model picks two things', 'A measure and a grouping, each from a closed list. That is its entire output.'],
  ['The application writes the SQL', 'It compiles a parameterised statement from those two values, with your account’s row scope built in, and runs it.'],
  ['You get both', 'The figure, and the statement that produced it, side by side.'],
]

export default function HowItWorks() {
  usePageMeta({
    title: 'How FinTrack works: nothing to migrate, and every answer checkable',
    description:
      'Your records stay in the base you already use; a Postgres mirror keeps lists instant. The analyst picks a measure and a grouping from a fixed list and the application compiles the SQL, so every figure arrives with the query that produced it.',
    path: '/how-it-works',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      <PageHead eyebrow="How it works"
                lines={['Nothing to migrate,', <em key="e">and nothing to take on faith</em>]}>
        Asking a finance team to move its records somewhere new on day one is
        the fastest way to lose it. FinTrack sits on top of what the team
        already keeps, and shows its working on everything it derives.
      </PageHead>

      <Section flush n="01" eyebrow="The shape of it"
               title="Three steps, and one set of rows underneath"
               lede="Records stay where they are, a mirror makes them fast, and questions are compiled to SQL. The rest of the product follows from those three.">
        <ol className="pb-list pb-list-num">
          {STEPS.map(({ title, body }, i) => (
            <li key={title}>
              <span className="pb-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className="pb-h3s">{title}</h3>
                <p className="pb-body" style={{ marginTop: 8 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="02" eyebrow="The mirror"
               title="How a change in your base reaches the mirror"
               lede="Three routes keep the mirror current, and the base always wins. Lists filter and sort against the mirror, so a screen of invoices opens at once.">
        <div style={{ overflowX: 'auto' }}>
          <table className="pb-table">
            <thead><tr><th scope="col">Route</th><th scope="col">When</th><th scope="col">What it carries</th></tr></thead>
            <tbody>
              {CADENCE.map(([a, b, c]) => <tr key={a}><td>{a}</td><td className="pb-num">{b}</td><td>{c}</td></tr>)}
            </tbody>
          </table>
        </div>
        <Reveal style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
          <LazyMount className="ft-s-sim-slot pb-instrument">
            <Suspense fallback={null}><SyncPipelineSimulator /></Suspense>
          </LazyMount>
        </Reveal>
      </Section>

      <Section id="trust" n="03" eyebrow="Why you can trust the answer"
               title="The model stops two steps before the number"
               lede="The model’s entire output is two values, each chosen from a closed list. There is no route from a sentence to arbitrary SQL, which is also why the analyst cannot be talked into reading rows your account may not see.">
        <ol className="pb-list pb-list-num">
          {ANSWER.map(([title, body], i) => (
            <li key={title}>
              <span className="pb-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className="pb-h3">{title}</h3>
                <p className="pb-body" style={{ marginTop: 4 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Reveal style={{ marginTop: 'clamp(40px, 5vw, 64px)' }}>
          <Plate id="assistant" fig={1} crop={[246, 125, 1330, 600]}
                 alt="The assistant: a question, the compiled SQL query and the answer as bars by client, sample data"
                 caption="The assistant in the sample workspace. Sample data."
                 notes={[
                   { x: 700, y: 262, label: 'Compiled query', body: 'Written by the application from a measure and a grouping.' },
                   { x: 1100, y: 563, label: 'The answer', body: 'Outstanding by client, from the query above.' },
                 ]} />
        </Reveal>
        <p className="pb-body" style={{ marginTop: 32 }}>
          The four mechanisms behind this are set out on the{' '}
          <Link to="/security" className="pb-link">security page</Link>.
        </p>
      </Section>

      <Closing title="Walk it yourself in the sandbox"
               cta={<Btn to="/#try">Open the sandbox</Btn>}
               next={<Btn to="/customise" quiet>Next: what you can change</Btn>}>
        The same records, filters and compiled queries, on sample data in your
        browser. No account needed; signing in is by invitation.
      </Closing>
    </PublicLayout>
  )
}
