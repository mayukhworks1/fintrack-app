/**
 * Security: how access actually works.
 *
 * The claim that data is private, with the mechanism beside it so it can be
 * checked: the four checks every request passes, the seeded permission
 * matrix, the four mechanisms behind an answer, what is public, and the
 * admin panel's own request log and session list on sample data.
 */
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import { PageHead, Section, Btn, Closing, Card, Grid } from '../components/PublicBits'
import AuditTrailSandbox from '../components/AuditTrailSandbox'
import PermissionMatrix from '../components/features/PermissionMatrix'
import { SECURITY, TRUST } from '../content/publicContent'
import '../styles/public-security.css'

/* The path every request takes through the server, in order. */
const PATH = [
  ['Session', 'The session row behind the token is looked up on every request. A revoked or expired session is refused with a 401.'],
  ['Permission', 'Role defaults, then this person’s own grants and revocations.'],
  ['Row scope', 'The account’s scope is compiled into the SQL itself. Nothing is filtered out after the fact.'],
  ['Response', 'Only what the three checks allowed.'],
  ['Audit', 'Queued as the response leaves and written by a background worker, so recording never slows the request.'],
]

export default function Security() {
  usePageMeta({
    title: 'Security & access | FinTrack',
    description: 'Roles, per-person permission overrides, row scoping applied when the query is built, and a full audit trail.',
  })

  return (
    <PublicLayout>
      <PageHead eyebrow="Security & access"
                lines={['Who can see what,', <em key="em">and how it is enforced</em>]}>
        Access is by invitation, and an administrator approves every account.
        Every request then passes the same checks, in the same order.
      </PageHead>

      <Section flush n="01" eyebrow="The request path" title="Five steps, on every request">
        <ol className="pb-list pb-list-num">
          {PATH.map(([title, body], i) => (
            <li key={title}>
              <span className="pb-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className="pb-h3">{title}</h3>
                <p className="pb-body" style={{ marginTop: 4 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="02" eyebrow="Permissions" wide
               title="The permission model, as it is seeded"
               lede="Pick a role to see what it reaches by default. Any single cell can then be granted or revoked for one person.">
        <div className="pb-instrument"><PermissionMatrix /></div>
      </Section>

      <Section id="mechanisms" n="03" eyebrow="Why you can trust the answer"
               title="Four mechanisms behind every figure"
               lede="Plenty of tools promise not to make things up. These are the places where that promise is a piece of code.">
        <Grid>
          {TRUST.map(({ title, body }) => <Card key={title} title={title} body={body} />)}
        </Grid>
      </Section>

      <Section id="privacy" n="04" eyebrow="What is public"
               title="This page is public. Your data is not."
               lede="These pages describe the product. They make no API call, and every figure on them is sample data computed in your browser.">
        <Grid>
          {SECURITY.map(({ title, body }) => <Card key={title} title={title} body={body} />)}
        </Grid>
      </Section>

      <Section n="05" eyebrow="Audit and sessions" wide
               title="Every request recorded, every session revocable"
               lede="Sessions are rows on the server and every request looks its own up, so revoking one refuses the very next request. Try it below, on sample data.">
        <div className="pb-instrument"><AuditTrailSandbox /></div>
      </Section>

      <Closing title="Request access" next={<Btn to="/faq" quiet>Read the questions</Btn>}>
        Sign in with email, Google or Zoho. An administrator approves the account
        before it can see anything.
      </Closing>
    </PublicLayout>
  )
}
