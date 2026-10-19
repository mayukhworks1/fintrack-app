/**
 * A full-size view of one image, opened from a Shot with `zoom`.
 *
 *   <Lightbox open={open} onClose={() => setOpen(false)}
 *             src="/media/screens/sheet.webp" width={1600} height={1000} alt="…" caption="…" />
 *
 * Rendered into document.body. Focus is trapped (useDialog), Escape and a
 * click on the backdrop close it, and focus returns to whatever opened it.
 * It opens with a fade and a 0.96 → 1 scale over --m-t-small; under reduced
 * motion it simply appears.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialog } from '../../hooks/useDialog'

export default function Lightbox({ open, onClose, src, width, height, alt = '', caption }) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <LightboxPanel onClose={onClose} src={src} width={width} height={height} alt={alt} caption={caption} />,
    document.body,
  )
}

function LightboxPanel({ onClose, src, width, height, alt, caption }) {
  const dialog = useDialog({ label: alt ? `Enlarged: ${alt}` : 'Enlarged image', onClose })

  // A fixed overlay that scrolls the page behind it reads as broken.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="ft-m-lightbox" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      {/* The dialog role goes on a <div>: ARIA does not allow it on <figure>. */}
      <div className="ft-m-lightbox-panel" {...dialog.panelProps}>
        <button type="button" className="ft-m-lightbox-close" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <figure className="ft-m-lightbox-fig">
          <img src={src} width={width} height={height} alt={alt} decoding="async" />
          {caption && <figcaption className="ft-m-lightbox-cap">{caption}</figcaption>}
        </figure>
      </div>
    </div>
  )
}
