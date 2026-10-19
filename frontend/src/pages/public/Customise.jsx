/**
 * Made yours — configuration, deployment and extension.
 *
 * "Fully customisable" is the least believable sentence on any product page,
 * because everyone writes it and nobody can check it. This page says who does
 * the work and what it touches, in three tiers, then hands the visitor a
 * working permission matrix so the first tier is not a claim either, and
 * draws the second: a dedicated instance is the same build with a different
 * environment file.
 *
 * The playground is the heaviest thing on the page and sits well below the
 * fold, so its code is fetched only as it approaches; the space it will take
 * is held from the start, so nothing under it moves when it arrives.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import { Grain } from '../../components/LandingVisuals'
import { PageHead, Card, Grid, Closing, Head } from '../../components/PublicBits'
import { PermissionRows, OneBuildTwoHomes, ModuleSlotsIn } from '../../components/SceneDiagrams'
import LazyMount from '../../components/motion/LazyMount'
import DedicatedInstance from '../../components/secondary/DedicatedInstance'
import { SHAPE, APP_LD, crumbs, graph } from '../../content/publicContent'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-customise.css'

const PermissionPlayground = lazy(() => import('../../components/PermissionPlayground'))

const LD = graph(APP_LD, crumbs([{ name: 'Made yours', path: '/customise' }]))

export default function Customise() {
  usePageMeta({
    title: 'Made yours — configure it, host it yourself, or extend it | FinTrack',
    description:
      'Permissions are records you change, not code. An instance is a container and an environment file, so a dedicated deployment on your own Postgres and your own private cloud is a configuration of the same build. New modules arrive inside the permission matrix and the audit trail.',
    path: '/customise',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <Grain />
        <PageHead eyebrow="Made yours"
                  lines={['Shaped to how you work —', <em key="e">except the one thing that must not move</em>]}
                  size="clamp(1.85rem, 5vw, 3rem)">
          Most of what a finance team wants changed is a setting here rather
          than a request to us. Where it genuinely is not, the answer is a
          dedicated instance or a module built for the case — both of which stay
          inside the same build, the same permission model and the same audit
          trail.
        </PageHead>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120 }}>
        <Head n="01" eyebrow="Three tiers"
              title="Who does the work, and what it touches" className="mt-12 sm:mt-20">
          In the order a buyer meets them: what you change in the app without
          telling anyone, what runs on infrastructure you own, and what gets
          built because your business does something ours does not.
        </Head>

        <Grid className="mb-14">
          {SHAPE.map(({ icon, kicker, title, body }, i) => (
            <Card key={title} icon={icon} kicker={kicker} title={title} body={body}
                  visual={[PermissionRows, OneBuildTwoHomes, ModuleSlotsIn][i]}
                  delay={Math.min(i, 3) * 70} />
          ))}
        </Grid>

        <Head n="02" eyebrow="Try the first one"
              title="A role carries defaults. One person can differ.">
          This is the real shape of the permission model, small enough to fit in
          a card. Pick somebody, change what they reach, and the panel underneath
          shows the query their invoice list would run and the rows it returns.
        </Head>

        <LazyMount className="ft-s-perm-slot" rootMargin="800px 0px">
          <Suspense fallback={null}><PermissionPlayground /></Suspense>
        </LazyMount>

        <p className="mt-6 mb-14 text-sm leading-relaxed" style={{ color: 'var(--text-2)', maxWidth: 700 }}>
          One thing is deliberately not adjustable: the set of measures the
          analyst may use. Open that up and an answer stops being checkable,
          which is the only thing this product is really selling. New measures
          get added to it on purpose, reviewed, the same way a new module does —
          never inferred at the moment someone asks a question.
        </p>

        <Head n="03" eyebrow="Your infrastructure"
              title="A dedicated instance is a configuration, not a fork">
          When the shared deployment is not where your data should live, the
          same build runs on yours. What changes is one environment file.
        </Head>

        <DedicatedInstance />
      </section>

      <Closing title="Tell us how you work"
               cta={<Link to="/login" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/security" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                       Next: who can see what <ArrowRight size={15} aria-hidden="true" />
                     </Link>}>
        Access is by invitation, and an administrator approves each account
        before it can see anything.
      </Closing>
    </PublicLayout>
  )
}
