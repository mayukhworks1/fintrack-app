/**
 * A published page's link, pasted into a chat, and the preview card that
 * chat apps show for it.
 *
 * The bubble is deliberately nobody's app: no chrome, no logo, no name. The
 * card is real — it is the image the backend renders for the sample
 * "Invoice tracker" page (page_share.render_card_png), which is what a chat
 * app fetches when it unfurls the link. It unfolds once under the URL when
 * first reached: a clip from the top and a 12px rise. Under reduced motion
 * it is simply there.
 */
import { screen } from '../motion/media'
import { useReveal } from '../../hooks/useReveal'

const CARD = screen('link-preview')

export default function LinkUnfurl({ className = '' }) {
  const ref = useReveal({ threshold: 0.4 })
  return (
    <div ref={ref} className={`ft-f-chat ${className}`.trim()}>
      <div className="ft-f-bubble">
        <span className="block px-1 pb-2 text-[12px] text-[var(--accent-ink)] underline break-all">twfintracker.worksmayukh.space/p/invoice-tracker</span>
        <div className="ft-f-unfurl">
          <img
            src={CARD.srcSm}
            srcSet={`${CARD.srcSm} ${CARD.smW}w, ${CARD.src} ${CARD.w}w`}
            sizes="(min-width: 1024px) 320px, 78vw"
            width={CARD.w}
            height={CARD.h}
            alt="Link preview card for a published page called Invoice tracker: open invoices with GST and days outstanding, sample data"
            loading="lazy"
            decoding="async"
          />
          <span className="block px-2 py-1.5 text-[10.5px] text-[var(--text-3)]">twfintracker.worksmayukh.space</span>
        </div>
      </div>
    </div>
  )
}
