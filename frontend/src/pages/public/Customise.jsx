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
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import { PageHead, Section, Card, Grid, Btn, Closing } from '../../components/PublicBits'
import LazyMount from '../../components/motion/LazyMount'
import { SHAPE, APP_LD, crumbs, graph } from '../../content/publicContent'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-customise.css'

const PermissionPlayground = lazy(() => import('../../components/PermissionPlayground'))

const LD = graph(APP_LD, crumbs([{ name: 'Made yours', path: '/customise' }]))

/* What one environment file changes between the shared deployment and yours. */
const INSTANCE = [
  ['Database', 'Our Postgres', 'Your Postgres, in your private cloud'],
  ['Mail sender', 'Ours', 'Your mail server'],
  ['File storage', 'Ours', 'Your storage target'],
  ['Source base', 'Yours', 'Yours'],
  ['Build', 'The current release', 'The same release, with the same fixes'],
  ['Permissions and audit', 'Roles, overrides, request log', 'Identical'],
]

export default function Customise() {
  usePageMeta({
    title: 'Made yours: configure it, host it yourself, or extend it | FinTrack',
    description:
      'Permissions are records your own team changes. An instance is a container and an environment file, so a dedicated deployment on your own Postgres and private cloud runs the same build. New modules arrive inside the permission matrix and the audit trail.',
    path: '/customise',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      <PageHead eyebrow="Made yours"
                lines={['Shaped to how you work,', <em key="e">with one thing held fixed</em>]}>
        Most of what a finance team wants changed is a setting your own people
        can make. Where it is not, the answer is a dedicated instance or a module
        built for the case, and both stay inside the same build, the same
        permission model and the same audit trail.
      </PageHead>

      <Section flush n="01" eyebrow="Three tiers"
               title="Who does the work, and what it touches"
               lede="In the order a buyer meets them: what you change in the app, what runs on infrastructure you own, and what gets built because your business works differently.">
        <Grid>
          {SHAPE.map(({ kicker, title, body }) => (
            <Card key={title} kicker={kicker} title={title} body={body} />
          ))}
        </Grid>
      </Section>

      <Section n="02" eyebrow="Try the first one" wide
               title="A role carries defaults. One person can differ."
               lede="The permission model at a size that fits on the page. Pick somebody, change what they reach, and the panel shows the query their invoice list would run and the rows it returns.">
        <LazyMount className="ft-s-perm-slot pb-instrument" rootMargin="800px 0px">
          <Suspense fallback={null}><PermissionPlayground /></Suspense>
        </LazyMount>
        <div className="pb-row" style={{ marginTop: 28 }}>
          <p className="pb-body pb-main">
            The one thing held fixed is the set of measures the analyst may use.
            Opening it up would make an answer impossible to check, and being
            checkable is the point. New measures are added on purpose and
            reviewed, the same way a new module is.
          </p>
        </div>
      </Section>

      <Section n="03" eyebrow="Your infrastructure"
               title="A dedicated instance is the same build with one file changed"
               lede="When the shared deployment is not where your data should live, the same build runs on yours. The backend is one container, and every endpoint, table, model, mail server and storage target is read from its environment.">
        <div style={{ overflowX: 'auto' }}>
          <table className="pb-table">
            <thead>
              <tr><th scope="col">Setting</th><th scope="col">Shared</th><th scope="col">Dedicated</th></tr>
            </thead>
            <tbody>
              {INSTANCE.map(([k, a, b]) => (
                <tr key={k}><td>{k}</td><td>{a}</td><td>{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Closing title="Tell us how you work"
               next={<Btn to="/security" quiet>Next: who can see what</Btn>}>
        Access is by invitation, and an administrator approves each account
        before it can see anything.
      </Closing>
    </PublicLayout>
  )
}
