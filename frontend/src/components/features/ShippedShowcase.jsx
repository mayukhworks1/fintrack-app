/**
 * "Recently shipped": the spreadsheet editor, publishing with link previews
 * and view insights, and the AI gateway — told as three steps.
 *
 * Wide screens: the steps scroll on the left and the media for the step
 * being read sits beside them, pinned, crossfading as the reader moves on
 * (useActiveStep decides which, with a rail to show where you are). The
 * media layers that are not showing are display:none, so the video is off
 * screen to its own observer and stays paused, and nothing behind the
 * current picture is laid out or animated.
 *
 * Phones, reduced motion, or no IntersectionObserver: each step simply
 * carries its own media under its text. Nothing is pinned.
 *
 * Loaded lazily, inside a LazyMount that already holds its space.
 */
import { useEffect, useRef, useState } from 'react'
import { Table2, Link2, Route } from 'lucide-react'
import { Head } from '../PublicBits'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useActiveStep } from '../../hooks/useActiveStep'
import InViewVideo from '../motion/InViewVideo'
import Shot from '../motion/Shot'
import StepRail from '../motion/StepRail'
import LinkUnfurl from './LinkUnfurl'
import GatewayRoute from './GatewayRoute'
import ScreenCrop from './ScreenCrop'

const STEPS = [
  {
    icon: Table2, kicker: 'Pages · spreadsheet editor',
    title: 'A spreadsheet that publishes',
    body: 'Pages now edits sheets as well as documents. Type a formula, change an amount, mark an invoice paid, and the totals follow. ₹ number formats, AutoSum, folders, version history and CSV in and out.',
    points: ['Formulas and AutoSum', '₹ number formats', 'Version history'],
  },
  {
    icon: Link2, kicker: 'Pages · publishing',
    title: 'A link with a preview, and a record of who opened it',
    body: 'Publish a page or a sheet on a link, with an optional password, a protection code and an expiry in IST. Chat apps unfurl it into a preview card, and each page keeps its views per day, device and country.',
    points: ['Password, code or expiry', 'Preview card in chat apps', 'Views per day, device, country'],
  },
  {
    icon: Route, kicker: 'Admin · AI gateway',
    title: 'Every AI call through one gateway',
    body: 'Groq and OpenRouter behind one client. Each task has a route tried in order, a daily cap and a versioned prompt, and every call is logged. Keys are stored encrypted on the server, and a superadmin switches each task on or off.',
    points: ['Ordered routes with fallback', 'Daily caps, reset at midnight IST', 'Every call in the log'],
  },
]

function Media({ i, wide }) {
  if (i === 0) {
    return (
      <InViewVideo
        id="sheet-demo"
        name="spreadsheet demo"
        className="ft-f-ship-video"
        label="The spreadsheet editor in Pages, on sample data: a formula is typed, an amount changes and the totals follow."
      />
    )
  }
  if (i === 1) {
    return (
      <div className="ft-f-ship-pub">
        <LinkUnfurl />
        <Shot id="page-insights-charts" chrome="window" zoom
              sizes={wide ? '(min-width: 1024px) 460px, 92vw' : '92vw'}
              alt="Viewer analytics for the Invoice tracker page: totals, views per day, devices and countries, sample data"
              caption="Each page's views per day, device and country. Sample data." />
      </div>
    )
  }
  return (
    <div className="ft-f-ship-gw" style={{ containerType: 'inline-size' }}>
      <ScreenCrop id="gateway-providers" crop={[117, 320, 1366, 400]} zoom
                  sizes={wide ? '(min-width: 1024px) 560px, 92vw' : '92vw'}
                  alt="AI gateway, providers and caps: Groq and OpenRouter, each on with a key, today's requests against their caps, sample data"
                  caption="Admin → AI gateway, providers and caps. Sample data." />
      <GatewayRoute compact />
    </div>
  )
}

export default function ShippedShowcase() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const { active, stepRef, tracking } = useActiveStep(STEPS.length, { disabled: !wide })
  const pinned = wide && tracking

  // The layer leaving stays drawn for the crossfade, then drops out.
  const [leaving, setLeaving] = useState(-1)
  const last = useRef(active)
  useEffect(() => {
    if (last.current === active) return
    setLeaving(last.current)
    last.current = active
    const t = setTimeout(() => setLeaving(-1), 450)
    return () => clearTimeout(t)
  }, [active])

  return (
    <div className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
      <Head eyebrow="Recently shipped" title="Sheets you can publish, and one gateway for the AI">
        The newest work, shown on the screens it shipped in. Everything here is in the app today,
        on the same records as the rest of it.
      </Head>

      <div className={pinned ? 'ft-f-ship is-pinned' : 'ft-f-ship'}>
        <div className="ft-f-ship-steps">
          {pinned && (
            <StepRail count={STEPS.length} active={active} className="ft-f-ship-rail" />
          )}
          <div>
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <article key={s.title} ref={stepRef(i)} className="ft-f-ship-step"
                         data-active={!pinned || active === i ? '' : undefined}>
                  <p className="ft-f-kicker"><Icon size={13} aria-hidden="true" /> {s.kicker}</p>
                  <h3 className="ft-display">{s.title}</h3>
                  <p className="ft-f-ship-body">{s.body}</p>
                  <ul className="ft-f-ship-points">
                    {s.points.map(p => <li key={p}>{p}</li>)}
                  </ul>
                  {!pinned && <div className="ft-f-ship-inline"><Media i={i} wide={wide} /></div>}
                </article>
              )
            })}
          </div>
        </div>

        {pinned && (
          <div className="ft-f-ship-media">
            <div className="ft-f-ship-stage">
              {STEPS.map((s, i) => (
                <div key={s.title} className="ft-f-ship-layer"
                     data-state={i === active ? 'on' : i === leaving ? 'out' : 'off'}
                     aria-hidden={i === active ? undefined : 'true'}>
                  <Media i={i} wide />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
