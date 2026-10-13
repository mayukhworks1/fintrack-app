/**
 * LoginShowcase — the panel beside the sign-in form on wide screens: what the
 * product is, in three lines, and its real screens (sample data) turning over.
 * Hidden on phones, where the form is the whole job.
 */
import { useEffect, useState } from 'react'
import { ReceiptText, Scale, Code2 } from 'lucide-react'
import BrandMark from './BrandMark'

const SLIDES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'invoices',  label: 'Invoices' },
  { id: 'assistant', label: 'AI assistant' },
  { id: 'status',    label: 'Status board' },
  { id: 'tax',       label: 'Tax ledger' },
]

const POINTS = [
  { icon: ReceiptText, text: 'Every total opens to the invoices underneath it.' },
  { icon: Scale,       text: 'GST and TDS kept apart from what clients actually owe.' },
  { icon: Code2,       text: 'Questions answered with the exact query shown.' },
]

export default function LoginShowcase() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setI(n => (n + 1) % SLIDES.length)
    }, 4200)
    return () => clearInterval(t)
  }, [])

  return (
    <aside aria-label="About FinTrack" className="ft-showcase hidden lg:flex">
      <div className="ft-showcase-glow" aria-hidden="true" />
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-center gap-2.5 mb-8">
          <BrandMark size={30} />
          <span className="ft-wordmark" style={{ color: '#fff', fontSize: '1.25rem' }}>FinTrack</span>
        </div>
        <h2 className="ft-display" style={{ color: '#fff', fontSize: 'clamp(1.7rem, 2.6vw, 2.3rem)', lineHeight: 1.12, margin: 0 }}>
          The delivery and the money,<br />
          <em style={{ color: '#9db8ff' }}>on one set of records.</em>
        </h2>
        <ul className="mt-6 flex flex-col gap-3" style={{ listStyle: 'none', padding: 0 }}>
          {POINTS.map(({ icon: Icon, text }, k) => (
            <li key={text} className="ft-showcase-point flex items-start gap-3" style={{ animationDelay: `${200 + k * 110}ms` }}>
              <span className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(157,184,255,0.14)', color: '#b9ccff' }}>
                <Icon size={15} />
              </span>
              <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14.5, lineHeight: 1.5, paddingTop: 3 }}>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mt-10" style={{ zIndex: 1 }}>
        <div className="ft-showcase-frame">
          {SLIDES.map((s, k) => (
            <img key={s.id} src={`/media/screens/${s.id}-sm.webp`} alt={k === i ? `FinTrack ${s.label} screen, sample data` : ''}
                 aria-hidden={k !== i} decoding="async" loading={k === 0 ? 'eager' : 'lazy'}
                 className="ft-showcase-slide" data-on={k === i ? '' : undefined} />
          ))}
        </div>
        <div className="flex items-center justify-between mt-4">
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12.5 }}>{SLIDES[i].label} <span style={{ opacity: 0.6 }}>· sample data</span></span>
          <div className="flex gap-1.5" role="tablist" aria-label="Screens">
            {SLIDES.map((s, k) => (
              <button key={s.id} type="button" role="tab" aria-selected={k === i} aria-label={s.label}
                onClick={() => setI(k)} className="ft-showcase-dot" data-on={k === i ? '' : undefined} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
