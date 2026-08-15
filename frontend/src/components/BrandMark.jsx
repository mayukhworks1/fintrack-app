import { useId } from 'react'

/**
 * FinTrack brand mark.
 *
 * The letterform is an "F" whose arms double as the bars of a horizontal chart —
 * longest on top, so reading bottom-to-top is growth. The top bar carries the
 * brand blue → positive green gradient; that pairing is the same one the UI uses
 * for accent and for money in the black, so the mark is built from the product's
 * own palette rather than a decoration bolted on top.
 *
 * Two surface variants, because the app has both light and near-black chrome:
 *   tile  — letterform on its rounded navy tile. Light surfaces, favicon, app icon.
 *   glyph — letterform alone. The desktop sidebar is #171717 in every theme, so a
 *           dark tile would sink into it; the reversed mark is what reads there.
 *
 * Gradient ids are per-instance. The mark renders more than once per page (sidebar
 * + mobile header), and duplicate SVG ids make later instances silently inherit the
 * first one's fills.
 */
export default function BrandMark({ size = 28, variant = 'tile', className, style }) {
  // useId() emits colons; strip them so the value is safe inside url(#…).
  const uid = useId().replace(/:/g, '')
  const bgId = `ft-bg-${uid}`
  const accentId = `ft-ac-${uid}`
  const isTile = variant === 'tile'

  // Letterform bbox is x[9, 24.4] y[6, 26] — centred at (16.7, 16). Without the
  // tile there is no padding to spend, so scale it up about the frame centre.
  const letter = (
    <>
      <rect x="9" y="6" width="3.3" height="20" rx="1.65" fill="#fff" />
      <rect x="9" y="6" width="15.4" height="3.3" rx="1.65" fill={`url(#${accentId})`} />
      <rect x="9" y="13.6" width="10.2" height="3.3" rx="1.65" fill="#fff" opacity=".9" />
    </>
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {isTile && (
          <linearGradient id={bgId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1E2848" />
            <stop offset="1" stopColor="#080C18" />
          </linearGradient>
        )}
        <linearGradient id={accentId} x1="9" y1="7.6" x2="24.4" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4F86FF" />
          <stop offset="1" stopColor="#4ADE80" />
        </linearGradient>
      </defs>

      {isTile ? (
        <>
          <rect width="32" height="32" rx="9" fill={`url(#${bgId})`} />
          {/* Inner light ring — keeps the tile's edge defined on dark chrome too. */}
          <rect
            x="0.6" y="0.6" width="30.8" height="30.8" rx="8.5"
            fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.2"
          />
          {letter}
        </>
      ) : (
        <g transform="translate(16 16) scale(1.4) translate(-16.7 -16)">{letter}</g>
      )}
    </svg>
  )
}
