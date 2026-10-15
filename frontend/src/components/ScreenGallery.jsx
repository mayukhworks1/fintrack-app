/**
 * ScreenGallery — real product screens, captured from the sample workspace
 * the sandbox runs on. A row you can swipe or step through, and a lightbox for
 * a closer look. Every figure in the images is sample data, and says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X, Maximize2 } from 'lucide-react'

const SCREENS = [
  { id: 'dashboard', title: 'Dashboard',     line: 'Portfolio balance, margin and runway on one screen.' },
  { id: 'invoices',  title: 'Invoices',      line: 'Outstanding, collected and overdue, every row traceable.' },
  { id: 'projects',  title: 'Projects',      line: 'Billed, cost, profit and margin per engagement.' },
  { id: 'status',    title: 'Status board',  line: 'Delivery state on the same records as the money.' },
  { id: 'assistant', title: 'AI assistant',  line: 'Plain questions, with the exact query shown.' },
  { id: 'tax',       title: 'Tax ledger',    line: 'GST and TDS split out, reconciled per client.' },
  { id: 'analytics', title: 'Analytics',     line: 'Collection rate, days to collect, cash flow.' },
  { id: 'studio',    title: 'Studio',        line: 'Ask questions of your contracts and SOWs.' },
  { id: 'pages',     title: 'Pages',         line: 'Publish proposals and portals with view analytics.' },
]

const src = (id, small) => `/media/screens/${id}${small ? '-sm' : ''}.webp`

function Lightbox({ index, onClose, onStep }) {
  const s = SCREENS[index]
  const closeRef = useRef(null)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onStep(1)
      else if (e.key === 'ArrowLeft') onStep(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose, onStep])

  const nav = { width: 44, height: 44, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', flexShrink: 0 }
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${s.title} screen`} onClick={onClose}
      className="ft-lightbox"
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(6,9,16,0.86)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1240px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{s.title}</div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>{s.line} <span style={{ opacity: 0.7 }}>· sample data</span></div>
          </div>
          <span style={{ fontSize: 12, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {SCREENS.length}</span>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} style={nav}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" aria-label="Previous screen" onClick={() => onStep(-1)} style={nav} className="hidden sm:flex"><ChevronLeft size={20} /></button>
          <img key={s.id} src={src(s.id)} alt={`FinTrack ${s.title} screen with sample data`}
            className="ft-lightbox-img"
            style={{ width: '100%', minWidth: 0, borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.5)', background: '#fff' }} />
          <button type="button" aria-label="Next screen" onClick={() => onStep(1)} style={nav} className="hidden sm:flex"><ChevronRight size={20} /></button>
        </div>
        <div className="flex sm:hidden" style={{ justifyContent: 'center', gap: 12 }}>
          <button type="button" aria-label="Previous screen" onClick={() => onStep(-1)} style={nav}><ChevronLeft size={20} /></button>
          <button type="button" aria-label="Next screen" onClick={() => onStep(1)} style={nav}><ChevronRight size={20} /></button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function ScreenGallery() {
  const track = useRef(null)
  const [open, setOpen] = useState(null)
  const [edge, setEdge] = useState({ start: true, end: false })

  const update = useCallback(() => {
    const el = track.current
    if (!el) return
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
  }, [])
  useEffect(() => {
    update()
    const el = track.current
    el?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { el?.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [update])

  const scrollBy = (dir) => {
    const el = track.current
    if (!el) return
    const card = el.querySelector('[data-card]')
    const step = card ? card.getBoundingClientRect().width + 16 : el.clientWidth * 0.8
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }
  const step = useCallback((d) => setOpen(i => (i + d + SCREENS.length) % SCREENS.length), [])
  const close = useCallback(() => setOpen(null), [])

  const arrow = (disabled) => ({
    width: 40, height: 40, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-1)',
    opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer', transition: 'opacity .15s',
  })

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-3">
        <button type="button" aria-label="Scroll screens left" onClick={() => scrollBy(-1)} disabled={edge.start} style={arrow(edge.start)}><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Scroll screens right" onClick={() => scrollBy(1)} disabled={edge.end} style={arrow(edge.end)}><ChevronRight size={18} /></button>
      </div>
      <div ref={track} className="ft-gallery" role="list" aria-label="Product screens">
        {SCREENS.map((s, i) => (
          <div key={s.id} role="listitem" data-card className="ft-gallery-card">
            <button type="button" onClick={() => setOpen(i)} className="ft-gallery-shot ft-spot"
              aria-label={`Open ${s.title} screen`}>
              <img src={src(s.id, true)} srcSet={`${src(s.id, true)} 800w, ${src(s.id)} 1600w`}
                sizes="(max-width: 640px) 85vw, 520px" loading="lazy" decoding="async"
                width="800" height="516" alt={`FinTrack ${s.title} screen with sample data`} />
              <span className="ft-gallery-zoom" aria-hidden="true"><Maximize2 size={14} /></span>
            </button>
            <div style={{ padding: '12px 2px 0' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{s.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>{s.line}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>Captured from the sample workspace the sandbox above runs on. Every figure is sample data.</p>
      {open !== null && <Lightbox index={open} onClose={close} onStep={step} />}
    </div>
  )
}
