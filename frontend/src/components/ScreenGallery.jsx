/**
 * ScreenGallery — real product screens, captured from the sample workspace
 * the sandbox runs on, grouped by the job they do.
 *
 * Pick a group and the row crossfades to its screens while the indicator
 * slides under the group's name. Each card is a Shot: lazy, sized from
 * media.js (the first captures are 1600×1031, the newer ones 1600×1000),
 * dimmed a touch in the dark theme, and opened full size on a click. On a
 * phone a card is a 4:3 crop of its screen that enlarges on a tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Shot from './motion/Shot'
import { useInk } from '../hooks/useInk'

export const SCREENS = {
  dashboard:  { title: 'Dashboard',          line: 'Portfolio balance, margin, collections and what is overdue.', focus: '24% 20%' },
  invoices:   { title: 'Invoices',           line: 'Outstanding, collected and overdue, every row traceable.', focus: '30% 24%' },
  tax:        { title: 'Tax ledger',         line: 'GST and TDS split out, per client and month.', focus: '30% 24%' },
  analytics:  { title: 'Analytics',          line: 'Collection rate, days to collect, cash flow.', focus: '30% 24%' },
  projects:   { title: 'Projects',           line: 'Billed, cost, profit and margin per engagement.', focus: '30% 24%' },
  status:     { title: 'Status board',       line: 'Delivery state on the same records as the money.', focus: '30% 24%' },
  pages:      { title: 'Pages',              line: 'Pages and spreadsheets in folders, published on a link.', focus: '30% 24%' },
  sheet:      { title: 'Spreadsheet editor', line: 'Formulas, ₹ formats and totals that follow the rows.', focus: '28% 30%' },
  'sheet-public': { title: 'Published sheet', line: 'What a client sees on the link: searchable, with a CSV download.', focus: '30% 30%' },
  'page-insights-charts': { title: 'Page views', line: 'Views per day, devices and countries for one page.', focus: '50% 50%' },
  assistant:  { title: 'AI assistant',       line: 'Plain questions, with the exact query shown.', focus: '40% 30%' },
  studio:     { title: 'Studio',             line: 'Ask questions of your contracts and SOWs.', focus: '40% 30%' },
  gateway:    { title: 'AI gateway',         line: 'Each AI task’s route of providers, its cap and its calls today.', focus: '45% 45%' },
}

export const GROUPS = [
  { id: 'money',        label: 'Money',        screens: ['dashboard', 'invoices', 'tax', 'analytics'] },
  { id: 'delivery',     label: 'Delivery',     screens: ['projects', 'status'] },
  { id: 'publish',      label: 'Publish',      screens: ['pages', 'sheet', 'sheet-public', 'page-insights-charts'] },
  { id: 'intelligence', label: 'Intelligence', screens: ['assistant', 'studio', 'gateway'] },
]

export default function ScreenGallery() {
  const [g, setG] = useState(0)
  const group = GROUPS[g]
  const inkRef = useInk(g)
  const track = useRef(null)
  const [edge, setEdge] = useState({ start: true, end: false })

  const update = useCallback(() => {
    const el = track.current
    if (!el) return
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
  }, [])
  useEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = 0
    update()
    el?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { el?.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [update, g])

  const scrollBy = (dir) => {
    const el = track.current
    if (!el) return
    const card = el.querySelector('[data-card]')
    const step = card ? card.getBoundingClientRect().width + 16 : el.clientWidth * 0.8
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    el.scrollBy({ left: dir * step, behavior: reduced ? 'auto' : 'smooth' })
  }

  const onTabKey = (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = (g + d + GROUPS.length) % GROUPS.length
    setG(next)
    e.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  const arrow = (disabled) => ({
    width: 40, height: 40, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-1)',
    opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer', transition: 'opacity .15s',
  })

  return (
    <div className="ft-h-gallery">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div ref={inkRef} className="ft-h-seg-tabs ft-m-ink" role="tablist" aria-label="Screens by group">
          {GROUPS.map((x, i) => (
            <button key={x.id} type="button" role="tab" id={`ft-h-gtab-${x.id}`}
                    aria-selected={i === g} aria-controls="ft-h-gpanel" tabIndex={i === g ? 0 : -1}
                    onClick={() => setG(i)} onKeyDown={onTabKey}>
              {x.label} <span className="ft-h-seg-n">{x.screens.length}</span>
            </button>
          ))}
          <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
        </div>
        <div className="ft-h-gallery-arrows flex items-center gap-2">
          <button type="button" aria-label="Scroll screens left" onClick={() => scrollBy(-1)} disabled={edge.start} style={arrow(edge.start)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" aria-label="Scroll screens right" onClick={() => scrollBy(1)} disabled={edge.end} style={arrow(edge.end)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      </div>

      <div id="ft-h-gpanel" role="tabpanel" aria-labelledby={`ft-h-gtab-${group.id}`}>
        <div key={group.id} ref={track} className="ft-gallery ft-h-fade" role="list" aria-label={`${group.label} screens`}>
          {group.screens.map(id => {
            const s = SCREENS[id]
            return (
              <div key={id} role="listitem" data-card className="ft-gallery-card">
                <Shot id={id} zoom focus={s.focus}
                      alt={`FinTrack ${s.title} screen with sample data`}
                      sizes="(max-width: 640px) 85vw, 520px" />
                <div style={{ padding: '12px 2px 0' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>{s.line}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>Captured from the sample workspace the sandbox above runs on. Every figure is sample data.</p>
    </div>
  )
}
