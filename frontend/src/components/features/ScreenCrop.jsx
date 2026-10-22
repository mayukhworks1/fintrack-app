/**
 * One region of a captured screen, framed like a window.
 *
 *   <ScreenCrop id="projects" crop={[248, 378, 1327, 564]}
 *               alt="A project card: billed, cost, profit and margin, sample data"
 *               caption="From the sample workspace. Sample data."
 *               spots={[{ x: 1513, y: 411, label: 'Health', body: '…' }]} />
 *
 * Shot shows a whole capture. A whole 1600px capture shrunk into a 600px
 * panel is mostly sidebar and title bar at a size nobody can read, so this
 * shows the part that is the point: `crop` is [x, y, width, height] in the
 * full image's pixels, the frame takes that ratio, and the image is
 * positioned inside it. Width and height stay on the <img>, so the space is
 * reserved before the file arrives. Spots are in the same pixels and are
 * dropped when the crop leaves them out.
 *
 * `zoom` opens the whole capture in the Lightbox. Leave it off where the
 * rest of the capture shows something the page should not be showing.
 */
import { useEffect, useId, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { screen } from '../motion/media'
import Lightbox from '../motion/Lightbox'
import { useReveal } from '../../hooks/useReveal'

/* The image is wider than its frame by the crop factor, so its `sizes`
   must be too, or the browser picks the small file for a big image. */
function scaleSizes(sizes, k) {
  return sizes.replace(/(\d+(?:\.\d+)?)(px|vw)/g, (_, n, u) => `${Math.round(Number(n) * k)}${u}`)
}

export default function ScreenCrop({
  id, crop, alt, caption, spots = [], zoom = false, chrome = 'window',
  sizes = '(min-width: 1024px) 620px, 92vw', className = '', style,
}) {
  const s = screen(id)
  const [x, y, w, h] = crop || [0, 0, s.w, s.h]
  const ref = useReveal({ threshold: 0.3 })
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
  const Tag = caption ? 'figure' : 'div'
  const k = s.w / w

  return (
    <Tag ref={ref} className={`ft-m-shot ft-f-crop ${className}`.trim()}
         data-chrome={chrome === 'window' ? 'window' : undefined} style={style}>
      <div className="ft-m-shot-frame">
        {chrome === 'window' && <span className="ft-m-shot-bar" aria-hidden="true" />}
        <div className="ft-f-crop-media" style={{ aspectRatio: `${w} / ${h}` }}>
          <img
            src={s.srcSm}
            srcSet={`${s.srcSm} ${s.smW}w, ${s.src} ${s.w}w`}
            sizes={scaleSizes(sizes, k)}
            width={s.w}
            height={s.h}
            alt={alt}
            loading="lazy"
            decoding="async"
            style={{ width: `${k * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
          />
          {zoom && (
            <button type="button" className="ft-m-shot-zoom" onClick={() => setZoomed(true)}
                    aria-label={`Enlarge: ${alt}`}>
              <span className="ft-m-shot-zoom-badge" aria-hidden="true"><Maximize2 size={14} /></span>
            </button>
          )}
          {spots.map((spot, i) => {
            const left = (spot.x - x) / w, top = (spot.y - y) / h
            if (left < 0.02 || left > 0.98 || top < 0.02 || top > 0.98) return null
            const open = openSpot === i
            const calloutId = `${uid}-spot-${i}`
            return (
              <span key={i} className="ft-m-spot-wrap" data-side={spot.side || 'right'}
                    style={{ '--sx': `${left * 100}%`, '--sy': `${top * 100}%` }}
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
                  <span className="ft-m-spot-dot ft-m-pulse-once" style={{ '--d': `${300 + i * 160}ms` }} />
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
      {zoom && (
        <Lightbox open={zoomed} onClose={() => setZoomed(false)}
                  src={s.src} width={s.w} height={s.h} alt={alt} caption={caption} />
      )}
    </Tag>
  )
}
