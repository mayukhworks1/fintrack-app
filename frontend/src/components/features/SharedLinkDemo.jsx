/**
 * Shared views: what a read-only link carries, and what it reports back.
 *
 * There is no capture of the shared-view analytics drawer, so this does not
 * draw one. The glyph is the idea (a view published with one band
 * withheld), and the list beside it is what the feature records, from the
 * module's own description. No figures.
 */
import { Link2, Eye, MousePointerClick, Paperclip, MapPin, History, Highlighter, Ban } from 'lucide-react'
import { GlyphShare } from '../Glyphs'
import { useReveal } from '../../hooks/useReveal'

const SENDS = [
  { icon: Link2, text: 'A read-only link with your filters baked in' },
  { icon: Highlighter, text: 'The columns you want read first, highlighted' },
  { icon: Ban, text: 'Revocable at any time' },
]
const RECORDS = [
  { icon: Eye, text: 'Unique viewers and page views' },
  { icon: MousePointerClick, text: 'Which records were opened' },
  { icon: Paperclip, text: 'Which attachments were opened' },
  { icon: MapPin, text: 'Location and device' },
  { icon: History, text: 'A timeline of what happened' },
]

export default function SharedLinkDemo() {
  const ref = useReveal({ threshold: 0.25 })
  return (
    <div ref={ref} className="ft-f-demo ft-f-share">
      <div className="ft-f-share-art" aria-hidden="true"><GlyphShare mode="link" /></div>
      <div className="ft-f-share-cols">
        <div>
          <p className="ft-f-kicker">What the client gets</p>
          <ul className="ft-f-ticks ft-m-seq">
            {SENDS.map(({ icon: Icon, text }, i) => (
              <li key={text} style={{ '--i': i }}><Icon size={14} aria-hidden="true" className="shrink-0 mt-px text-[var(--accent-ink)]" />{text}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="ft-f-kicker">What you see afterwards</p>
          <ul className="ft-f-ticks ft-m-seq">
            {RECORDS.map(({ icon: Icon, text }, i) => (
              <li key={text} style={{ '--i': i + 2 }}><Icon size={14} aria-hidden="true" className="shrink-0 mt-px text-[var(--accent-ink)]" />{text}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
