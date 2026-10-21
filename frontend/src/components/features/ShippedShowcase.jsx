/**
 * Recently shipped, on /features#shipped.
 *
 * Three pieces of new work, each with its screen from the app on sample
 * data: the spreadsheet editor (its recording, which plays only when asked
 * or when in view and motion is welcome), the published page's view counts,
 * and the AI gateway's providers. Set like the module sections above it.
 */
import { Section, Plate, Reveal } from '../PublicBits'
import InViewVideo from '../motion/InViewVideo'

const STEPS = [
  {
    kicker: 'Pages, spreadsheet editor',
    title: 'A spreadsheet that publishes',
    body: 'Pages now edits sheets as well as documents. Type a formula, change an amount, mark an invoice paid, and the totals follow. ₹ number formats, AutoSum, folders, version history and CSV in and out.',
  },
  {
    kicker: 'Pages, publishing',
    title: 'A link with a preview, and a record of who opened it',
    body: 'Publish a page or a sheet on a link, with an optional password, a protection code and an expiry in IST. Chat apps unfurl it into a preview card, and each page keeps its views per day, device and country.',
  },
  {
    kicker: 'Admin, AI gateway',
    title: 'Every AI call through one gateway',
    body: 'Groq and OpenRouter behind one client. Each task has a route tried in order, a daily cap and a versioned prompt, and every call is logged. Keys are stored encrypted on the server, and a superadmin switches each task on or off.',
  },
]

function Media({ i }) {
  if (i === 0) {
    return (
      <figure className="pb-plate">
        <div className="pb-plate-frame" style={{ aspectRatio: 'auto' }}>
          <InViewVideo id="sheet-demo" name="spreadsheet demo" className="ft-f-ship-video"
                       label="The spreadsheet editor in Pages, on sample data: a formula is typed, an amount changes and the totals follow." />
        </div>
        <figcaption className="pb-cap">The spreadsheet editor in Pages, recorded on sample data.</figcaption>
      </figure>
    )
  }
  if (i === 1) {
    return (
      <Plate id="page-insights-charts"
             alt="Viewer analytics for the Invoice tracker page: totals, views per day, devices and countries, sample data"
             caption="A published page's views per day, device and country. Sample data." />
    )
  }
  return (
    <Plate id="gateway-providers" crop={[117, 320, 1366, 400]}
           alt="AI gateway, providers and caps: Groq and OpenRouter, each on with a key, today's requests against their caps, sample data"
           caption="Admin, AI gateway: providers and today's usage against their caps. Sample data." />
  )
}

export default function ShippedShowcase() {
  return (
    <Section eyebrow="Recently shipped"
             title="Sheets you can publish, and one gateway for the AI"
             lede="The newest work, shown on the screens it shipped in. All of it is in the app today, on the same records as the rest.">
      <ol className="pb-list pb-list-num">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="pb-n" aria-hidden="true">{i + 1}</span>
            <article>
              <p className="pb-label" style={{ marginBottom: 6 }}>{s.kicker}</p>
              <h3 className="pb-h3s">{s.title}</h3>
              <p className="pb-body" style={{ marginTop: 8 }}>{s.body}</p>
              <Reveal style={{ marginTop: 24, marginBottom: 12 }}><Media i={i} /></Reveal>
            </article>
          </li>
        ))}
      </ol>
    </Section>
  )
}
