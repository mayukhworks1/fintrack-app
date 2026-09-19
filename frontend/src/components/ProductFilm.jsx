/**
 * The product film.
 *
 * Twenty-four seconds cut from the product itself — the figures come from the
 * same demoData.js ledger the sandbox runs on, and the frames are screenshots
 * of the real interface rather than mockups.
 *
 * Why it does not autoplay. The file is 2-4MB, and this page already plays
 * several looping clips; a fourth that starts on its own costs a phone user
 * real money for something they did not ask for. `preload="none"` means the
 * bytes are not fetched at all until someone presses play — the poster is
 * 84KB and carries the whole idea on its own, which is the point of choosing
 * a poster frame rather than letting the encoder pick black.
 *
 * It also means no motion starts without consent, so there is nothing here
 * for prefers-reduced-motion to suppress.
 */
import { useRef, useState } from 'react'
import { Play } from 'lucide-react'

export default function ProductFilm() {
  const [playing, setPlaying] = useState(false)
  const ref = useRef(null)

  const start = () => {
    setPlaying(true)
    // The element exists already; setting state only swaps the overlay.
    const v = ref.current
    if (v) { v.play?.() }
  }

  return (
    <figure className="relative rounded-2xl overflow-hidden m-0"
            style={{ background: '#090a09', border: '1px solid var(--card-border)' }}>
      <video
        ref={ref}
        poster="/media/fintrack-film.jpg"
        preload="none"
        playsInline
        controls={playing}
        onEnded={() => setPlaying(false)}
        aria-label="A twenty-four second film of FinTrack: outstanding receivables, the TDS already deducted from them, the delivery board, and the analyst showing the query behind its answer."
        className="block w-full"
        style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
      >
        {/* WebM first: half the bytes of the mp4 (2.2MB against 4.2MB) and the
            browser takes the first source it can decode. The mp4 stays as the
            universal fallback — Safari does not decode VP9 on every version
            still in use, and a product film that plays everywhere but on the
            iPhone is not a product film. */}
        <source src="/media/fintrack-film.webm" type="video/webm" />
        <source src="/media/fintrack-film.mp4" type="video/mp4" />
      </video>

      {!playing && (
        <button
          onClick={start}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ background: 'linear-gradient(to top, rgba(9,10,9,0.55), rgba(9,10,9,0.06))',
                   border: 0, cursor: 'pointer', color: '#fff' }}
        >
          <span className="flex items-center justify-center rounded-full"
                style={{ width: 62, height: 62, background: 'rgba(255,255,255,0.14)',
                         backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.3)' }}>
            <Play size={22} aria-hidden="true" style={{ marginLeft: 3 }} fill="#fff" />
          </span>
          <span className="font-semibold" style={{ fontSize: 13, letterSpacing: '0.01em' }}>
            Watch the 24-second film
          </span>
        </button>
      )}

      <figcaption className="px-4 py-3 text-xs"
                  style={{ color: 'var(--text-3)', borderTop: '1px solid var(--card-border)',
                           background: 'var(--card-bg)' }}>
        Cut from the product. Every figure is computed from the same sample ledger
        the sandbox above runs on — nothing in it is a mockup, and nothing in it is
        anyone&rsquo;s real data.
      </figcaption>
    </figure>
  )
}
