/**
 * New in FinTrack: what Pages and the AI gateway look like, captured from the
 * sample workspace.
 *
 * The lead is a short recording of the spreadsheet editor (it plays only while
 * half of it is on screen, never by itself under reduced motion, and has a
 * pause button). Around it: a published page with the real link-preview card
 * a chat app shows for it, the view charts for that page, and the gateway's
 * task list. Every image is lazy and sized from media.js, and the band is
 * mounted only as it nears the viewport (see Landing).
 */
import { Link } from 'react-router-dom'
import { ArrowRight, Share2, BarChart3, Route } from 'lucide-react'
import InViewVideo from '../motion/InViewVideo'
import Shot from '../motion/Shot'
import ScreenCrop from '../features/ScreenCrop'
import { useMediaQuery } from '../../hooks/useMediaQuery'

export default function ShippedBand() {
  // Under 640px the two cards are a row that scrolls sideways; it takes
  // focus there so it can be scrolled from the keyboard. Wider, it is not a
  // scroller (on desktop not even a box), so it is not a tab stop.
  const phone = useMediaQuery('(max-width: 639px)')
  return (
    <div className="ft-h-shipped">
      <div className="ft-h-shipped-lead">
        <InViewVideo
          id="sheet-demo"
          name="spreadsheet recording"
          className="ft-h-shipped-video"
          label="Pages now has a spreadsheet editor: type a formula, change an amount, mark one paid — totals follow. Sample data."
        />
      </div>

      <div className="ft-h-shipped-cards"
           {...(phone ? { tabIndex: 0, role: 'region', 'aria-label': 'New in FinTrack, scrolls sideways' } : {})}>
        <article className="ft-h-shipped-card ft-h-card-pub">
          <h3><Share2 size={15} aria-hidden="true" /> Publish it.</h3>
          <div className="ft-h-shipped-stack">
            <Shot id="sheet-public" chrome="window"
                  alt="A spreadsheet published as a page: an invoice tracker with GST and days outstanding, sample data"
                  sizes="(min-width: 1024px) 420px, 85vw" />
            <Shot id="link-preview" chrome="none" className="ft-h-preview"
                  alt="The link preview a chat app shows for that page: its title, description and address"
                  sizes="(min-width: 1024px) 200px, 40vw" />
          </div>
          <p>Publish on a link with a password, protection code or expiry; chat apps show this preview. Sample data.</p>
        </article>

        <article className="ft-h-shipped-card ft-h-card-ins">
          <h3><BarChart3 size={15} aria-hidden="true" /> See who opened it.</h3>
          {/* Wipes in from the left once it is reached: a cover that scales
              away, so the image's own visibility is never in question. */}
          <Shot id="page-insights-charts" chrome="window" className="ft-h-wipe-box"
                alt="View charts for one published page: views per day, devices and countries, sample data"
                sizes="(min-width: 1024px) 420px, 85vw" />
          <p>Views per day, devices and countries for each page. Sample data.</p>
        </article>
      </div>

      <div className="ft-h-shipped-gw">
        {/* Two tasks from the gateway's list at near full size, rather than
            the whole 1600px screen shrunk until nothing on it can be read. */}
        <ScreenCrop id="gateway" crop={[117, 512, 660, 212]} zoom
                    alt="Two AI tasks in the gateway, the assistant chat and the answer check, each with its route of providers and models tried in order, sample data"
                    sizes="(min-width: 1024px) 620px, 100vw" />
        <div className="ft-h-shipped-gw-copy">
          <h3><Route size={15} aria-hidden="true" /> AI gateway</h3>
          <p>
            Groq and OpenRouter behind one gateway: each task has a route tried
            in order, daily caps and a versioned prompt; every call is logged.
            Keys stay on the server. Sample data.
          </p>
          <Link to="/features#shipped" className="ft-h-more">
            Everything that shipped <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
