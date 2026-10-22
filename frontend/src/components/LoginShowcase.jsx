/**
 * LoginShowcase — the panel beside the sign-in form on wide screens: what the
 * product is, in a few lines, and its real screens (sample data) turning over.
 *
 * It is not rendered at all below 1024px. It used to be hidden there with
 * CSS, which still downloaded its first screen on every phone for a panel
 * nobody could see.
 *
 * Each screen points at one thing: a ring is drawn round a real region of
 * the capture, a caption says what it is, and the image eases slowly towards
 * it for the five seconds the screen is up. Only the current and the next
 * screen have an <img>, so the panel costs two images, not six.
 *
 * The turning-over runs on useAutoplay: only while the panel is on screen and
 * the tab is visible, never under reduced motion unless the visitor presses
 * play, and always with a pause button. Dots and arrows work either way.
 */
import { useEffect, useState } from 'react'
import { ReceiptText, Scale, Code2, Globe, Pause, Play, ChevronLeft, ChevronRight } from 'lucide-react'
import BrandMark from './BrandMark'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useAutoplay } from '../hooks/useAutoplay'
import { screen } from './motion/media'

const SLIDE_MS = 5000
const FRAME = 1072 / 691   // the frame's aspect ratio (.ft-showcase-frame)

/* ring: [left, top, width, height] in percent of the full capture, measured
   on the 1600px files. */
const SLIDES = [
  { id: 'dashboard', label: 'Dashboard', ring: [15.5, 35.1, 27.0, 12.6],
    note: '₹33.0L outstanding, across 10 open invoices' },
  { id: 'invoices', label: 'Invoices', ring: [71.2, 7.9, 27.3, 11.0],
    note: '₹23.7L overdue, from the rows below it' },
  { id: 'projects', label: 'Projects', ring: [15.5, 64.0, 81.8, 22.5],
    note: 'A margin, with the 4 invoices it comes from' },
  { id: 'status', label: 'Status board', ring: [49.0, 19.0, 14.3, 14.3],
    note: 'Blocked, with ₹12.4L still open on it' },
  { id: 'sheet', label: 'Pages', ring: [27.1, 37.6, 22.5, 15.0],
    note: 'A sheet with formulas and ₹ formats' },
  { id: 'page-insights-charts', label: 'Page views', ring: [1.9, 48.0, 96.3, 24.6],
    note: 'Views per day, device and country for a published page' },
]

const POINTS = [
  { icon: ReceiptText, text: 'Every total opens to the invoices underneath it.' },
  { icon: Scale,       text: 'GST and TDS kept apart from what clients actually owe.' },
  { icon: Code2,       text: 'Questions answered with the exact query shown.' },
  { icon: Globe,       text: 'Publish a sheet on a link, and see when and where it was opened.' },
]

/** Where the ring lands in the frame, given object-fit: cover from the top left. */
function ringIn(slide) {
  const s = screen(slide.id)
  const a = s.w / s.h
  const [x, y, w, h] = slide.ring
  const kx = a > FRAME ? a / FRAME : 1
  const ky = a < FRAME ? FRAME / a : 1
  const left = x * kx, top = y * ky
  return {
    left: `${left}%`, top: `${top}%`,
    width: `${Math.min(w * kx, 99 - left)}%`, height: `${Math.min(h * ky, 99 - top)}%`,
    origin: `${left + (w * kx) / 2}% ${top + (h * ky) / 2}%`,
  }
}

function Showcase() {
  const [i, setI] = useState(0)
  const [prev, setPrev] = useState(null)
  const { ref, running, toggle } = useAutoplay({ threshold: 0.25 })
  const n = SLIDES.length
  const go = (k) => { setPrev(i); setI(((k % n) + n) % n) }

  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => { setPrev(i); setI((i + 1) % n) }, SLIDE_MS)
    return () => clearTimeout(t)
  }, [running, i, n])

  const next = (i + 1) % n
  const shown = [prev, i, next].filter((k, idx, all) => k !== null && all.indexOf(k) === idx)

  return (
    <aside ref={ref} aria-label="About FinTrack" className="ft-showcase flex" data-running={running ? '' : undefined}>
      <div className="ft-showcase-glow" aria-hidden="true" />
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-center gap-2.5 mb-8">
          <BrandMark size={30} />
          <span className="ft-wordmark" style={{ color: '#fff', fontSize: '1.25rem' }}>FinTrack</span>
        </div>
        <h2 className="ft-display" style={{ color: '#fff', fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)', lineHeight: 1.12, margin: 0 }}>
          Your projects, invoices and tax,<br />
          <em style={{ color: 'color-mix(in srgb, var(--accent-bright) 55%, #fff)' }}>where you left them.</em>
        </h2>
        <ul className="mt-6 flex flex-col gap-3" style={{ listStyle: 'none', padding: 0 }}>
          {POINTS.map(({ icon: Icon, text }, k) => (
            <li key={text} className="ft-showcase-point flex items-start gap-3" style={{ animationDelay: `${200 + k * 110}ms` }}>
              <span className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 8, background: 'color-mix(in srgb, var(--accent-bright) 18%, transparent)', color: 'color-mix(in srgb, var(--accent-bright) 40%, #fff)' }}>
                <Icon size={15} aria-hidden="true" />
              </span>
              <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14.5, lineHeight: 1.5, paddingTop: 3 }}>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mt-10" style={{ zIndex: 1 }}>
        <div className="ft-showcase-frame">
          {shown.map(k => {
            const s = SLIDES[k]
            const m = screen(s.id)
            const r = ringIn(s)
            const on = k === i
            return (
              <div key={s.id} className="ft-showcase-slide ft-s-slide" data-on={on ? '' : undefined}
                   aria-hidden={on ? undefined : 'true'}>
                <img src={m.srcSm} srcSet={`${m.srcSm} ${m.smW}w, ${m.src} ${m.w}w`} sizes="520px"
                     width={m.w} height={m.h} decoding="async"
                     loading={k === 0 ? 'eager' : 'lazy'} fetchpriority={k === 0 && prev === null ? 'high' : undefined}
                     alt={on ? `FinTrack ${s.label} screen, sample data` : ''}
                     style={{ transformOrigin: r.origin }} />
                {on && (
                  <span key={`r${i}`} aria-hidden="true">
                    <span className="ft-s-dimmer" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
                    <span className="ft-s-ring" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="ft-s-show-bar">
          <p className="ft-s-show-cap" aria-live={running ? 'off' : 'polite'}>
            <b>{SLIDES[i].label}</b> {SLIDES[i].note} <span>· sample data</span>
          </p>
          <div className="ft-s-show-ctl">
            <button type="button" onClick={() => go(i - 1)} aria-label="Previous screen"><ChevronLeft size={16} aria-hidden="true" /></button>
            <div className="ft-s-dots" role="group" aria-label="Screens">
              {SLIDES.map((s, k) => (
                <button key={s.id} type="button" className="ft-s-dot" aria-label={s.label} aria-pressed={k === i}
                        onClick={() => go(k)}>
                  <span className="ft-showcase-dot" data-on={k === i ? '' : undefined} />
                </button>
              ))}
            </div>
            <button type="button" onClick={() => go(i + 1)} aria-label="Next screen"><ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" onClick={toggle} aria-label={running ? 'Pause the screens' : 'Play the screens'}>
              {running ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default function LoginShowcase() {
  const wide = useMediaQuery('(min-width: 1024px)')
  return wide ? <Showcase /> : null
}
