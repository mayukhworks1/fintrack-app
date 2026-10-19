/**
 * The film, and a walkthrough of the same ground for people who would rather
 * read than watch.
 *
 * The film is a recording of the sample workspace. Nothing about it loads
 * until someone presses play: the frame shows a poster (a real frame at 0:13),
 * preload is "none", and the source is picked at that first press — the 720p
 * cut under 1024px or with Save-Data, the 1080p one otherwise. Its length is
 * read from one place, the chapter table's last mark, until the file's own
 * metadata replaces it.
 *
 * The walkthrough is built from demoData, the same rows the sandbox reads, so
 * every figure in it can be found again in the sandbox above. It moves on by
 * itself only through useAutoplay: in view, tab showing, not paused, and never
 * by itself under reduced motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Film, BookOpen,
  ArrowUpRight, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  INVOICES, DELIVERY, LANES, TOTALS, TAX_SUMMARY, AGEING, QUESTIONS,
  open, ask, inr, inrShort,
} from './demoData'
import { VIDEOS } from './motion/media'
import { useAutoplay } from '../hooks/useAutoplay'

const FILM = VIDEOS.film
const INV = INVOICES.find(i => i.id === 'INV-2296')
const TOP = ask({ measure: 'outstanding', groupBy: 'client' }).rows[0]
const BAND_61_90 = AGEING.find(b => b.id === '61-90')

/* Chapter marks are the film's own scene boundaries, measured against the
   cut: each is a point where the recording changes module. Figures are
   computed from demoData, the ledger the recording was made from. */
export const CHAPTERS = [
  {
    id: 1, title: 'The figure, corrected', start: 0, end: 11.7,
    badge: 'TDS kept apart', tab: 'receivables', tabLabel: 'Invoices',
    metric: `${inrShort(TOTALS.tds)} withheld`,
    problem: 'Accounting tools count gross invoices while tax deducted at source never arrives, so the collections list overstates what can be collected.',
    solution: 'TDS is reported as its own figure and kept out of outstanding, so the number being chased is the number owed.',
  },
  {
    id: 2, title: 'Filter to overdue', start: 11.7, end: 14.7,
    badge: 'Totals follow the rows', tab: 'receivables', tabLabel: 'Invoices',
    metric: `${inrShort(TOTALS.overdue)} overdue`,
    problem: 'Filtering a list usually leaves the headline figures behind, so the number on screen stops describing the rows under it.',
    solution: 'Every total is derived from the visible rows, so a filter moves the figures with it.',
  },
  {
    id: 3, title: 'One invoice, opened', start: 14.7, end: 17.3,
    badge: 'Every deduction named', tab: 'receivables', tabLabel: 'Invoices',
    metric: `${inr(INV.amount + INV.gst - INV.tds)} lands`,
    problem: 'An invoice total tells you what was billed, not what arrives: GST belongs to the state and TDS is withheld before the client pays.',
    solution: 'Each deduction is named on the invoice itself, ending on the figure that reaches the bank.',
  },
  {
    id: 4, title: 'Ageing bands', start: 17.3, end: 19.9,
    badge: 'Days past due', tab: 'ageing', tabLabel: 'Ageing',
    metric: `${inr(BAND_61_90.value)} at 61–90 days`,
    problem: 'An ageing chart that is only a chart tells you a band is bad without telling you which invoices are in it.',
    solution: 'Picking a band filters the table underneath, and every total follows it down.',
  },
  {
    id: 5, title: 'Status Board', start: 19.9, end: 23.1,
    badge: 'Delivery on the same row', tab: 'delivery', tabLabel: 'Status Board',
    metric: `${DELIVERY.length} projects on the board`,
    problem: 'Delivery status lives in one tool and the money in another, so nobody can say what the work in progress is worth.',
    solution: 'The board regroups by client in a click and carries the money with the cards.',
  },
  {
    id: 6, title: 'An answer you can check', start: 23.1, end: FILM.seconds,
    badge: 'Shows its working', tab: 'analyst', tabLabel: 'AI Assistant',
    metric: `${inr(TOP.value)} top client`,
    problem: 'An assistant that answers in prose cannot be audited: you cannot tell a reading of the data from an invention.',
    solution: 'The compiled query is shown beside the answer, so the figure can be checked rather than trusted.',
  },
]

/** m:ss, rounded up at the end so a 28.5s cut reads 0:29. */
export const clock = (t, up = false) => {
  const s = Math.max(0, up ? Math.ceil(t) : Math.floor(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const smallScreen = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px)')?.matches
const saveData = () => typeof navigator !== 'undefined' && !!navigator.connection?.saveData

/* ── The walkthrough, from the sample ledger ──────────────────────────── */
const sum = (rows, pick) => rows.reduce((t, r) => t + pick(r), 0)
const byLane = LANES
  .map(lane => ({ lane, cards: DELIVERY.filter(d => d.lane === lane) }))
  .filter(l => l.cards.length)
const ANSWER = ask({ measure: QUESTIONS[0].measure, groupBy: QUESTIONS[0].groupBy })

export const WALKTHROUGH = [
  {
    id: 'receivables', tab: 'receivables', tabLabel: 'Invoices',
    title: 'Invoices, with the tax taken out',
    metric: `${inrShort(TOTALS.outstanding)} outstanding`,
    subMetric: `${inrShort(sum(open, i => i.tds))} TDS on open invoices`,
    explainer: 'Each row carries its pre-tax amount, GST at 18% and TDS at 10%. Outstanding counts the pre-tax figure, so tax withheld is never chased as money owed.',
    preview: {
      type: 'table',
      rows: [...open].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 3).map(i => ({
        id: i.id, client: i.client, amount: inr(i.amount), tds: inr(i.tds), status: i.status,
        age: i.daysOverdue ? `${i.daysOverdue} days over` : 'within terms',
      })),
    },
  },
  {
    id: 'delivery', tab: 'delivery', tabLabel: 'Status Board',
    title: 'Where each project stands, and what it is owed',
    metric: `${DELIVERY.length} projects`,
    subMetric: `${inrShort(sum(DELIVERY, d => d.outstanding))} owed across the board`,
    explainer: 'The board reads the same records as the invoices, so a card can say what its project is owed without anyone joining two systems.',
    preview: {
      type: 'kanban',
      lanes: byLane.slice(0, 3).map(l => ({
        name: l.lane, count: l.cards.length,
        item: `${l.cards[0].project} · ${l.cards[0].client}`,
        note: l.cards[0].outstanding ? `${inr(l.cards[0].outstanding)} owed` : l.cards[0].short,
      })),
    },
  },
  {
    id: 'tax', tab: 'tax', tabLabel: 'Tax Ledger',
    title: 'GST and TDS, kept apart from what is owed',
    metric: `${inrShort(TAX_SUMMARY.gstCollected)} GST`,
    subMetric: `${inrShort(TAX_SUMMARY.tdsCollected)} TDS`,
    explainer: 'GST is collected for the state and TDS is withheld by the client, so neither is counted as money a client still owes.',
    preview: {
      type: 'tax',
      items: [
        { label: 'Taxable value', value: inr(TAX_SUMMARY.taxableValue) },
        { label: 'GST (18%)', value: inr(TAX_SUMMARY.gstCollected), note: 'Held for the state' },
        { label: 'TDS (10%)', value: inr(TAX_SUMMARY.tdsCollected), note: 'Withheld at source' },
        { label: 'Reaches the bank', value: inr(TAX_SUMMARY.netReceivable), note: 'Invoiced less TDS', strong: true },
      ],
    },
  },
  {
    id: 'analyst', tab: 'analyst', tabLabel: 'AI Assistant',
    title: 'An answer with its query beside it',
    metric: 'Measure + grouping',
    subMetric: 'SQL written by code',
    explainer: 'The model picks a measure and a grouping from a fixed set; the application writes the SQL, runs it, and shows it next to the figure.',
    preview: {
      type: 'analyst',
      question: QUESTIONS[0].q,
      sql: ANSWER.sql,
      result: ANSWER.rows.slice(0, 2).map(r => `${r.key}: ${ANSWER.format(r.value)}`).join(' · '),
    },
  },
]

const WALK_MS = 6000

function scrollToSandbox(tabId) {
  const el = document.getElementById('try')
  if (!el) return
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  window.dispatchEvent(tabId
    ? new CustomEvent('ft-switch-tab', { detail: tabId })
    : new CustomEvent('ft-start-tour'))
}

/* ── The film ─────────────────────────────────────────────────────────── */
function FilmPlayer() {
  const videoRef = useRef(null)
  const frameRef = useRef(null)
  const pendingSeek = useRef(null)
  const [src, setSrc] = useState(null)          // chosen at the first press
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(CHAPTERS.at(-1).end)
  const [muted, setMuted] = useState(false)

  const length = clock(duration, true)
  const chapterAt = (t) => CHAPTERS.findIndex(c => t >= c.start && t < c.end)
  const current = CHAPTERS[Math.max(0, chapterAt(time))]

  // Sources arrive with the first press; load them, then play.
  useEffect(() => {
    const v = videoRef.current
    if (!src || !v) return
    v.load?.()
    const p = v.play?.()
    if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false))
  }, [src])

  const start = useCallback((at = null) => {
    const v = videoRef.current
    if (!v) return
    setStarted(true)
    if (!src) {
      pendingSeek.current = at
      setSrc(FILM.mp4Small && (smallScreen() || saveData()) ? FILM.mp4Small : FILM.mp4)
      return
    }
    if (at != null) v.currentTime = at
    const p = v.play?.()
    if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false))
  }, [src])

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (!src || v.paused) start()
    else v.pause?.()
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else frameRef.current?.requestFullscreen?.()
  }

  const seekBar = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * duration
    start(Math.max(0, Math.min(duration - 0.1, t)))
  }

  const onSeekKey = (e) => {
    const v = videoRef.current
    if (!v || !src) return
    if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(duration, v.currentTime + 5) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5) }
  }

  return (
    <div className="ft-h-film">
      <figure ref={frameRef} className="ft-h-film-frame" data-started={started ? '' : undefined}
              data-playing={playing ? '' : undefined}>
        <video
          ref={videoRef}
          className="ft-h-film-video"
          width={FILM.w}
          height={FILM.h}
          poster={FILM.poster}
          preload="none"
          playsInline
          aria-label={`The FinTrack film, ${length}, recorded in the sample workspace: what is outstanding, the TDS already deducted from it, the status board, and an assistant that shows its query.`}
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration)
            if (pendingSeek.current != null) { v.currentTime = pendingSeek.current; pendingSeek.current = null }
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        >
          {src && <source src={src} type="video/mp4" />}
        </video>

        {!started && (
          <div className="ft-h-film-cover">
            {/* Title and play only: the length is in the button, and the
                poster is cut above the film's own captions. */}
            <p className="ft-h-film-title">Delivery and money, one record at a time</p>
            <button type="button" className="ft-h-film-play" onClick={() => start()}>
              <span className="ft-h-film-play-ring" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
              <span>Play the film ({length})</span>
            </button>
          </div>
        )}

        {started && (
          <div className="ft-h-film-bar">
            <div className="ft-h-film-scrub" role="slider" tabIndex={0}
                 aria-label="Position in the film"
                 aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
                 aria-valuetext={`${clock(time)} of ${length}`}
                 onClick={seekBar} onKeyDown={onSeekKey}>
              <span className="ft-h-film-scrub-fill" style={{ transform: `scaleX(${Math.min(1, time / duration)})` }} />
              {CHAPTERS.slice(1).map(c => (
                <span key={c.id} className="ft-h-film-tick" style={{ left: `${(c.start / duration) * 100}%` }} />
              ))}
            </div>
            <div className="ft-h-film-controls">
              <button type="button" onClick={toggle} aria-label={playing ? 'Pause the film' : 'Play the film'}>
                {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
              </button>
              <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              </button>
              <span className="ft-h-film-time">{clock(time)} / {length}</span>
              <span className="ft-h-film-now">{current.title}</span>
              <button type="button" onClick={fullscreen} aria-label="Full screen" className="ml-auto">
                <Maximize2 size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </figure>
      <p className="text-[12.5px] leading-normal text-[var(--text-3)]">The film, {length} · captured from the sample workspace.</p>

      {/* Chapters: the way into the film on a phone, where the frame only
          carries the title and the play button. */}
      <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 m-0 p-0 list-none">
        {CHAPTERS.map(c => {
          const on = started && current.id === c.id
          return (
            <li key={c.id}>
              <button type="button" aria-current={on ? 'step' : undefined}
                      className={`flex flex-col gap-0.5 w-full min-h-[64px] px-3 py-2.5 rounded-xl text-left border cursor-pointer transition-colors hover:border-[var(--accent-soft)] ${
                        on ? 'bg-[var(--accent-dim)] border-[var(--accent)]' : 'bg-[var(--card-bg)] border-[var(--card-border)]'}`}
                      onClick={() => start(c.start)}>
                <span className="font-mono text-[10.5px] font-bold text-[var(--accent-ink)]">{clock(c.start)}</span>
                <span className="text-[12.5px] font-bold text-[var(--text-1)]">{c.title}</span>
                <span className="text-[11px] text-[var(--text-3)]">{c.badge}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="ft-h-film-note">
        <div className="min-w-0">
          <p className="ft-h-film-note-k">
            {current.tabLabel} · <span className="tabular-nums">{current.metric}</span>
          </p>
          <p><strong>The problem.</strong> {current.problem}</p>
          <p><strong>Here.</strong> {current.solution}</p>
        </div>
        <button type="button" className="ft-h-film-try" onClick={() => scrollToSandbox(current.tab)}>
          Try it in the sandbox <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/* ── The walkthrough ──────────────────────────────────────────────────── */
function Walkthrough() {
  const auto = useAutoplay({ threshold: 0.25 })
  const [index, setIndex] = useState(0)
  const [runKey, setRunKey] = useState(0)
  const clockRef = useRef({ start: 0, elapsed: 0 })
  const step = WALKTHROUGH[index]

  const goTo = useCallback((i) => {
    clockRef.current = { start: 0, elapsed: 0 }
    setIndex((i + WALKTHROUGH.length) % WALKTHROUGH.length)
    setRunKey(k => k + 1)
  }, [])

  useEffect(() => {
    if (!auto.running) return
    const c = clockRef.current
    c.start = performance.now()
    const t = setTimeout(() => goTo(index + 1), Math.max(0, WALK_MS - c.elapsed))
    return () => {
      clearTimeout(t)
      c.elapsed = Math.min(WALK_MS, c.elapsed + (performance.now() - c.start))
    }
  }, [auto.running, index, runKey, goTo])

  const p = step.preview
  const box = 'rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]'
  const btn = 'grid place-items-center w-11 h-11 shrink-0 rounded-[10px] border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-2)] cursor-pointer hover:border-[var(--accent)] hover:text-[var(--accent-ink)]'
  return (
    <div ref={auto.ref} className="relative rounded-2xl overflow-hidden border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="relative flex items-center gap-2.5 px-3 py-2.5 border-b border-[var(--card-border)] bg-[var(--bg-input)]">
        <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider text-white bg-[var(--accent-btn)]">
          {index + 1} of {WALKTHROUGH.length}
        </span>
        <span className="flex-1 min-w-0 truncate text-[13px] font-extrabold text-[var(--text-1)]">{step.title}</span>
        <button type="button" className={btn} onClick={auto.toggle}
                aria-label={auto.running ? 'Pause the walkthrough' : 'Play the walkthrough'}>
          {auto.running ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        </button>
        <span className="ft-h-tourbar-track" aria-hidden="true">
          <span key={`${index}-${runKey}`} className="ft-h-tour-fill"
                style={{ animationDuration: `${WALK_MS}ms`, animationPlayState: auto.running ? 'running' : 'paused' }} />
        </span>
      </div>

      <div key={step.id} className="ft-h-walk-body flex flex-col gap-3 p-3.5">
        <div className="flex flex-wrap gap-2 text-xs font-bold tabular-nums">
          <span className="px-2.5 py-1 rounded-lg border border-[var(--accent-soft)] bg-[var(--accent-dim)] text-[var(--accent-ink)]">{step.metric}</span>
          <span className="px-2.5 py-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-input)] text-[var(--text-2)]">{step.subMetric}</span>
        </div>

        <div className="p-3 rounded-xl border border-[var(--card-border)] bg-[var(--bg-input)] overflow-x-auto text-xs text-[var(--text-2)]"
             style={{ minHeight: 150 }}>
          {p.type === 'table' && (
            <table className="ft-h-walk-table w-full">
              <thead><tr><th>Invoice</th><th>Client</th><th>Pre-tax</th><th>TDS</th><th>Status</th></tr></thead>
              <tbody>
                {p.rows.map(r => (
                  <tr key={r.id}>
                    <td className="font-bold">{r.id}</td><td>{r.client}</td>
                    <td className="tabular-nums">{r.amount}</td><td className="tabular-nums">{r.tds}</td>
                    <td>
                      <span className="inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-bold"
                            style={r.status === 'Overdue'
                              ? { background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }
                              : { background: 'var(--accent-dim)', color: 'var(--accent-ink, var(--accent))' }}>
                        {r.status}, {r.age}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.type === 'kanban' && (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))' }}>
              {p.lanes.map(l => (
                <div key={l.name}>
                  <p className="flex justify-between mb-1.5 text-[var(--text-1)]"><strong>{l.name}</strong> <span>{l.count}</span></p>
                  <div className={`${box} px-2.5 py-2 text-[var(--text-1)]`}>
                    <span className="block font-semibold">{l.item}</span>
                    <span className="block tabular-nums mt-0.5 text-[11.5px] text-[var(--text-3)]">{l.note}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {p.type === 'tax' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {p.items.map(it => (
                <div key={it.label} className={`${box} px-2.5 py-2 text-[11px] text-[var(--text-3)]`}>
                  <span className="block">{it.label}</span>
                  <strong className="block tabular-nums my-0.5 text-sm" style={{ color: it.strong ? 'var(--ok)' : 'var(--text-1)' }}>{it.value}</strong>
                  {it.note && <span className="block">{it.note}</span>}
                </div>
              ))}
            </div>
          )}
          {p.type === 'analyst' && (
            <div>
              <p className="font-semibold text-[var(--text-1)]">“{p.question}”</p>
              <pre className={`${box} my-2 p-2.5 text-[11px] leading-relaxed font-mono whitespace-pre overflow-x-auto text-[var(--text-2)]`}>{p.sql}</pre>
              <p className="tabular-nums text-[var(--text-1)]">{p.result}</p>
            </div>
          )}
        </div>

        <div className="ft-h-film-note">
          <p>{step.explainer}</p>
          <button type="button" className="ft-h-film-try" onClick={() => scrollToSandbox(step.tab)}>
            Open {step.tabLabel} <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pt-2 pb-3 overflow-x-auto">
        <button type="button" className={btn} onClick={() => goTo(index - 1)} aria-label="Previous">
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        {WALKTHROUGH.map((st, i) => (
          <button key={st.id} type="button" aria-pressed={i === index} onClick={() => goTo(i)}
                  className={`shrink-0 min-h-[32px] px-2.5 rounded-lg border text-[11.5px] font-bold cursor-pointer ${
                    i === index ? 'bg-[var(--accent-btn)] border-[var(--accent)] text-white'
                                : 'bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-2)]'}`}>
            {st.tabLabel}
          </button>
        ))}
        <button type="button" className={btn} onClick={() => goTo(index + 1)} aria-label="Next">
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export default function ProductFilm() {
  const [mode, setMode] = useState('film')
  const length = clock(CHAPTERS.at(-1).end, true)
  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex self-start gap-1 p-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]"
           role="group" aria-label="Watch or read">
        {[['film', <Film key="i" size={14} aria-hidden="true" />, `Film (${length})`],
          ['walk', <BookOpen key="i" size={14} aria-hidden="true" />, 'Walkthrough']].map(([id, icon, label]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-lg text-[12.5px] font-bold cursor-pointer ${
                    mode === id ? 'bg-[var(--accent-btn)] text-white' : 'text-[var(--text-2)]'}`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {mode === 'film' ? <FilmPlayer /> : <Walkthrough />}

      <p className="text-[12.5px] leading-normal text-[var(--text-3)]">
        Figures computed in your browser from the same sample data the sandbox uses.{' '}
        <button type="button" onClick={() => scrollToSandbox()} className="font-bold underline underline-offset-2 cursor-pointer text-[var(--accent-ink)]">
          Open the sandbox
        </button>
      </p>
    </div>
  )
}
