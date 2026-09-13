/**
 * Made yours — configuration, deployment and extension.
 *
 * "Fully customisable" is the least believable sentence on any product page,
 * because everyone writes it and nobody can check it. This page says who does
 * the work and what it touches, in three tiers, and then hands the visitor a
 * working permission matrix so the first tier is not a claim either.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import PermissionPlayground from '../../components/PermissionPlayground'
import BrandCustomizerSandbox from '../../components/BrandCustomizerSandbox'
import { Grain } from '../../components/LandingVisuals'
import { PageHead, Card, Grid, Closing, Head } from '../../components/PublicBits'
import { PermissionRows, OneBuildTwoHomes, ModuleSlotsIn } from '../../components/SceneDiagrams'
import { SHAPE, APP_LD, crumbs, graph } from '../../content/publicContent'

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
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <div className="ft-dotgrid" aria-hidden="true" />
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
              title="Who does the work, and what it touches">
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
          a card. Pick somebody, change what they reach, and the line underneath
          says what they would actually sign in to.
        </Head>

        <PermissionPlayground />

        <p className="mt-6 mb-14 text-sm leading-relaxed" style={{ color: 'var(--text-2)', maxWidth: 700 }}>
          One thing is deliberately not adjustable: the set of measures the
          analyst may use. Open that up and an answer stops being checkable,
          which is the only thing this product is really selling. New measures
          get added to it on purpose, reviewed, the same way a new module does —
          never inferred at the moment someone asks a question.
        </p>

        <Head n="03" eyebrow="White-label & themes"
              title="Custom brand identities, domains, and invoice numbering">
          Give external clients and internal teams an instance that matches your
          firm's identity. Pick primary color accents, define dedicated CNAME domains,
          and customize your invoice taxonomy.
        </Head>

        <BrandCustomizerSandbox />
      </section>

      <Closing title="Tell us how you work"
               cta={<Link to="/login" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/security" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
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
