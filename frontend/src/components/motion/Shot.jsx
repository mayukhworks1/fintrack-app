/**
 * A framed product screenshot.
 *
 *   <Shot id="sheet" alt="Spreadsheet editor with an invoice tracker, sample data"
 *         sizes="(min-width: 1024px) 640px, 100vw" caption="… Sample data."
 *         spots={[{ x: '62%', y: '18%', label: 'Formula bar', side: 'right' }]} zoom />
 *
 * Props
 *   id        key in media.js SCREENS (the only source of src, width, height)
 *   alt       required; say "sample data" when the screen shows figures
 *   sizes     for the srcset (800w small copy + full-size capture)
 *   priority  eager + fetchpriority="high". One per page at most, above the fold only
 *   chrome    'window' (three dots and a title bar, drawn in CSS) | 'none'
 *   focus     object-position, e.g. "30% 20%". On phones (< 640px) the frame
 *             becomes a fixed 4:3 crop at this point, and a tap enlarges it
 *   ratio     e.g. "16/7": fixed frame ratio at every width, object-fit cover,
 *             positioned by `focus`
 *   zoom      a click or tap opens the full image in a Lightbox
 *   caption   figcaption text (the root becomes a <figure>)
 *   spots     hotspots in percent of the full image: { x, y, label, body?, side? }
 *             side: 'right' (default) | 'left' | 'top' | 'bottom'. A 12px dot in
 *             a 44px button; the callout shows on hover, focus or tap, Escape
 *             closes it. Each dot pulses once when the shot is revealed.
 *             Spots are re-projected through a crop, and hidden where the crop
 *             cuts them off.
 *
 * Lazy by default (loading="lazy", decoding="async"); the frame reserves the
 * image's ratio so nothing moves when it arrives. These are light-theme
 * captures, so the dark theme dims them a little (full brightness on hover,
 * focus and in the lightbox).
 */
import { useEffect, useId, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { screen } from './media'
import Lightbox from './Lightbox'
import { useReveal } from '../../hooks/useReveal'
import { useMediaQuery } from '../../hooks/useMediaQuery'

const KEYWORD = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }

function pct(v, fallback = 50) {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (s in KEYWORD) return KEYWORD[s]
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

function parseFocus(focus) {
  const [a, b] = String(focus || '50% 50%').trim().split(/\s+/)
  return [pct(a) / 100, pct(b ?? a) / 100]
}

function parseRatio(ratio) {
  if (typeof ratio === 'number') return ratio
  const [a, b] = String(ratio).split('/').map(Number)
  return b ? a / b : a
}

/* Where a point of the full image lands inside a frame of ratio `fr` showing
   the image with object-fit: cover at object-position (fx, fy). Percent of
   the frame; `out` when the crop cuts it off. */
function project(x, y, w, h, fr, fx, fy) {
  const Fw = 1, Fh = 1 / fr
  const s = Math.max(Fw / w, Fh / h)
  const W = w * s, H = h * s
  const px = (Fw - W) * fx + x * W
  const py = (Fh - H) * fy + y * H
  const out = px < 0.02 || px > 0.98 || py < 0.02 * Fh || py > 0.98 * Fh
  return { left: `${(px / Fw) * 100}%`, top: `${(py / Fh) * 100}%`, out }
}

export default function Shot({
  id, alt, sizes = '(min-width: 1024px) 640px, 100vw', priority = false,
  chrome = 'window', focus, ratio, zoom = false, caption, spots = [],
  className = '', style,
}) {
  const s = screen(id)
  const revealRef = useReveal({ threshold: 0.3 })
  const phone = useMediaQuery('(max-width: 639px)')
  const [openSpot, setOpenSpot] = useState(-1)
  // An open callout, however it was opened, closes on Escape from anywhere:
  // one opened by hovering has no focus to take a key press.
  useEffect(() => {
    if (openSpot < 0) return
    const onKey = (e) => { if (e.key === 'Escape') setOpenSpot(-1) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openSpot])
  const [zoomed, setZoomed] = useState(false)
  const uid = useId()

  const crop = !ratio && !!focus          // a 4:3 crop on phones only
  const [fx, fy] = parseFocus(focus)
  const fr = ratio ? parseRatio(ratio) : s.w / s.h
  const zoomable = zoom || (crop && phone)
  const Tag = caption ? 'figure' : 'div'

  const mediaStyle = {
    '--shot-ar': ratio ? String(ratio).replace('/', ' / ') : `${s.w} / ${s.h}`,
    '--shot-pos': focus || '50% 50%',
  }

  return (
    <Tag
      ref={revealRef}
      className={`ft-m-shot ${className}`.trim()}
      data-chrome={chrome === 'window' ? 'window' : undefined}
      data-crop={crop ? '' : undefined}
      style={style}
    >
      <div className="ft-m-shot-frame">
        {chrome === 'window' && <span className="ft-m-shot-bar" aria-hidden="true" />}
        <div className="ft-m-shot-media" style={mediaStyle}>
          <img
            src={s.srcSm}
            srcSet={`${s.srcSm} ${s.smW}w, ${s.src} ${s.w}w`}
            sizes={sizes}
            width={s.w}
            height={s.h}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchpriority={priority ? 'high' : undefined}
          />
          {zoomable && (
            <button type="button" className="ft-m-shot-zoom" onClick={() => setZoomed(true)}
                    aria-label={`Enlarge: ${alt}`}>
              <span className="ft-m-shot-zoom-badge" aria-hidden="true"><Maximize2 size={14} /></span>
            </button>
          )}
          {spots.map((spot, i) => {
            const x = pct(spot.x) / 100, y = pct(spot.y) / 100
            const desk = ratio ? project(x, y, s.w, s.h, fr, fx, fy) : { left: `${x * 100}%`, top: `${y * 100}%`, out: false }
            const mob = crop ? project(x, y, s.w, s.h, 4 / 3, fx, fy) : desk
            const open = openSpot === i
            const calloutId = `${uid}-spot-${i}`
            return (
              <span key={i} className="ft-m-spot-wrap"
                    data-side={spot.side || 'right'}
                    data-out={desk.out ? '' : undefined}
                    data-out-m={mob.out ? '' : undefined}
                    style={{ '--sx': desk.left, '--sy': desk.top, '--sx-m': mob.left, '--sy-m': mob.top }}
                    onMouseEnter={() => setOpenSpot(i)}
                    onMouseLeave={() => setOpenSpot(o => (o === i ? -1 : o))}>
                <button
                  type="button"
                  className="ft-m-spot"
                  aria-label={spot.label}
                  aria-expanded={open}
                  aria-describedby={open && spot.body ? calloutId : undefined}
                  onFocus={() => setOpenSpot(i)}
                  onBlur={() => setOpenSpot(o => (o === i ? -1 : o))}
                  onClick={() => setOpenSpot(i)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpenSpot(-1) } }}
                >
                  <span className="ft-m-spot-dot ft-m-pulse-once" style={{ '--d': `${i * 120}ms` }} />
                </button>
                {open && (
                  <span id={calloutId} role="tooltip" className="ft-m-callout">
                    <strong>{spot.label}</strong>
                    {spot.body && <span>{spot.body}</span>}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>
      {caption && <figcaption className="ft-m-shot-cap">{caption}</figcaption>}
      {zoomable && (
        <Lightbox open={zoomed} onClose={() => setZoomed(false)}
                  src={s.src} width={s.w} height={s.h} alt={alt} caption={caption} />
      )}
    </Tag>
  )
}
