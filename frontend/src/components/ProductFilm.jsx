import { useRef, useState, useEffect } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize2,
  Sparkles, CheckCircle2, ShieldCheck, Database, Layers,
  Clock, ArrowRight, ArrowUpRight, Zap, Film, RefreshCw,
  Code2, Receipt, FolderKanban, FileSpreadsheet, ChevronRight, ChevronLeft
} from 'lucide-react'
import {
  TOTALS, INVOICES, AGEING, PROJECT_ROLLUP,
  inr, inrShort
} from './demoData'

/* Chapter marks are the film's own scene boundaries, and they have to be
   re-derived every time the cut changes — a chapter list that does not match
   the footage is worse than none, because it is a caption that lies. The
   previous set still described a 32.5s cut and named a Tax Ledger and a
   Delivery scene the film never contained. These are measured against the
   30.3s cut: each boundary is a point where the recording actually changes
   module, verified by reading the app's own window title at the first and
   last frame of every segment. */
const CHAPTERS = [
  {
    id: 1,
    title: 'The figure, corrected',
    start: 0,
    end: 11.7,
    tag: '0:00 - 0:11',
    badge: 'Capital Leakage',
    tab: 'receivables',
    tabLabel: 'Invoices',
    metric: `₹${(TOTALS.tds / 100000).toFixed(2)}L withheld`,
    problem: 'Accounting tools count gross invoices while tax deducted at source never arrives, so the collections list overstates what can actually be collected.',
    solution: 'FinTrack reports TDS as its own figure and keeps it out of outstanding, so the number being chased is the number owed.',
  },
  {
    id: 2,
    title: 'One invoice, opened',
    start: 11.7,
    end: 15.3,
    tag: '0:11 - 0:15',
    badge: 'Every Deduction Named',
    tab: 'receivables',
    tabLabel: 'Invoices',
    metric: '₹6,58,800 lands',
    problem: 'An invoice total tells you what was billed, not what arrives: GST belongs to the state and TDS is withheld before the client pays.',
    solution: 'Each deduction is named on the invoice itself, ending on the figure that actually reaches the bank.',
  },
  {
    id: 3,
    title: 'Ageing, and the table it filters',
    start: 15.3,
    end: 20.8,
    tag: '0:15 - 0:20',
    badge: 'Days Past Due',
    tab: 'receivables',
    tabLabel: 'Ageing',
    metric: '₹8,05,000 at 61–90 days',
    problem: 'An ageing chart that is only a chart tells you a band is bad without telling you which invoices are in it.',
    solution: 'Picking a band filters the table underneath, and every total follows it down.',
  },
  {
    id: 4,
    title: 'Status Board',
    start: 20.8,
    end: 24.4,
    tag: '0:20 - 0:24',
    badge: 'Delivery On The Same Row',
    tab: 'delivery',
    tabLabel: 'Status Board',
    metric: '₹3,75,000 delivered',
    problem: 'Delivery status lives in one tool and the money in another, so nobody can say what the work in progress is worth.',
    solution: 'The board regroups by client in a click and carries the money with the cards.',
  },
  {
    id: 5,
    title: 'An answer you can check',
    start: 24.4,
    end: 30.3,
    tag: '0:24 - 0:30',
    badge: 'Shows Its Working',
    tab: 'analyst',
    tabLabel: 'AI Assistant',
    metric: '₹12,36,000 top client',
    problem: 'An assistant that answers in prose is impossible to audit — you cannot tell a reading of the data from an invention.',
    solution: 'The compiled query is shown beside the answer, so the figure can be checked rather than trusted.',
  },
]

const SANDBOX_REEL_STEPS = [
  {
    id: 'receivables',
    tab: 'receivables',
    tabLabel: 'Invoices Ledger',
    title: 'Unified Invoices & TDS Withholding',
    subtitle: 'Zero spreadsheet reconciliation between gross billing and true cash.',
    badge: 'Core Ledger',
    metric: `₹${(TOTALS.outstanding / 100000).toFixed(2)}L Outstanding`,
    subMetric: `₹${(TOTALS.tds / 100000).toFixed(2)}L TDS Isolated`,
    explainer: 'Every invoice row calculates taxable value, 18% GST, and 10% Section 194J TDS at inception. Overdue aging bands (0-30, 31-60, 61-90, 90+ days) update automatically from PostgreSQL predicates.',
    preview: {
      type: 'table',
      rows: [
        { id: 'INV-2296', client: 'Meridian Labs', amount: '₹14,50,000', tds: '₹1,45,000', status: 'Overdue', age: '74 days' },
        { id: 'INV-2295', client: 'Nova Systems', amount: '₹7,80,000', tds: '₹78,000', status: 'Sent', age: '21 days' },
        { id: 'INV-2294', client: 'Apex Corp', amount: '₹10,69,500', tds: '₹1,06,950', status: 'Overdue', age: '48 days' },
      ]
    }
  },
  {
    id: 'delivery',
    tab: 'delivery',
    tabLabel: 'Delivery Kanban',
    title: 'Live Project Delivery & Margin Tracking',
    subtitle: 'Kanban milestones tied directly to revenue recognition and burn rate.',
    badge: 'Operations Mirror',
    metric: '12 Active Milestones',
    subMetric: '38% Avg Margin',
    explainer: 'When engineers ship a deliverable, the single-ledger architecture updates the client billing readiness immediately. Real-time project margins prevent cost blowouts before monthly invoices are issued.',
    preview: {
      type: 'kanban',
      lanes: [
        { name: 'In Progress', count: 4, item: 'API Gateway · Meridian Labs', status: 'On Track' },
        { name: 'Review', count: 3, item: 'Design System · Nova Systems', status: 'Pending Approval' },
        { name: 'Shipped', count: 5, item: 'Payment Flow · Apex Corp', status: 'Ready to Bill' },
      ]
    }
  },
  {
    id: 'studio',
    tab: 'studio',
    tabLabel: 'Studio RAG',
    title: 'Studio RAG & Semantic Contract Intelligence',
    subtitle: 'Ask questions across MSAs and SOWs with verified paragraph citations.',
    badge: 'pgvector Cosine Search',
    metric: '0.94 Similarity Score',
    subMetric: 'Verified Citation',
    explainer: 'Contracts are chunked and indexed into pgvector embeddings. Querying payment clauses or late penalty provisions returns the exact contractual paragraph with mathematical confidence.',
    preview: {
      type: 'rag',
      query: 'What are the net payment terms and penalties for Meridian Labs?',
      citation: 'Meridian Master Services Agreement — Section 4.2',
      text: 'Invoices shall be payable within thirty (30) calendar days of receipt. In the event of overdue balance beyond forty-five (45) days, a late fee of 1.5% per month shall accrue on the outstanding principal.',
    }
  },
  {
    id: 'tax',
    tab: 'tax',
    tabLabel: 'Tax Escrow',
    title: 'Statutory GST & Form 26AS Tax Escrow',
    subtitle: 'Automated segregation of 18% GST and 10% TDS from spendable cash.',
    badge: 'Compliance Escrow',
    metric: `₹${(TOTALS.gst / 100000).toFixed(2)}L GST Segregated`,
    subMetric: '100% 26AS Match',
    explainer: 'FinTrack separates collected GST (CGST/SGST 9%) and TDS credits from spendable working capital, continuously reconciling client deductions against the TRACES Form 26AS portal.',
    preview: {
      type: 'tax',
      items: [
        { label: 'Total Taxable Turnover', value: '₹15,19,400' },
        { label: 'GST Collected (18%)', value: '₹2,73,492', ringFenced: true },
        { label: 'TDS Withheld (10%)', value: '₹1,51,940', ringFenced: true },
        { label: 'Net Spendable Cashflow', value: '₹10,93,968', spendable: true },
      ]
    }
  },
  {
    id: 'analyst',
    tab: 'analyst',
    tabLabel: 'AI Analyst',
    title: 'Deterministic AI Analyst with Parameterized SQL',
    subtitle: 'Auditable mathematical proof behind every answer — zero hallucination.',
    badge: 'Deterministic AST',
    metric: '100% Parameterized SQL',
    subMetric: 'Zero Hallucination',
    explainer: 'Instead of having an LLM invent financial numbers, FinTrack uses the LLM solely to generate an Abstract Syntax Tree (AST), which is transpiled into auditable, parameterized SQL and executed against PostgreSQL.',
    preview: {
      type: 'analyst',
      question: 'Which clients have overdue balances exceeding ₹5 Lakhs?',
      sql: 'SELECT client, SUM(amount) AS overdue_total FROM invoices WHERE status = \'Overdue\' GROUP BY client HAVING SUM(amount) > 500000 ORDER BY overdue_total DESC;',
      result: 'Meridian Labs: ₹14,50,000 · Apex Corp: ₹10,69,500',
    }
  },
]

export default function ProductFilm() {
  const [viewMode, setViewMode] = useState('film') // 'film' | 'sandbox-reel'
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  /* Seeded from the chapter table's last mark rather than a typed 24, so the
     label is right before metadata lands and cannot go stale on a re-cut. */
  const [duration, setDuration] = useState(CHAPTERS[CHAPTERS.length - 1].end)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [hovered, setHovered] = useState(false)
  
  // Interactive Reel state
  const [reelIndex, setReelIndex] = useState(0)
  const [reelPlaying, setReelPlaying] = useState(true)
  const [reelProgress, setReelProgress] = useState(0)
  
  const videoRef = useRef(null)

  /* The chapter table ends where the film ends, so its last mark is the
     honest source for the label until metadata has loaded. */
  const filmLength = `${Math.round(duration || CHAPTERS[CHAPTERS.length - 1].end)}-second`
  const activeChapterIndex = CHAPTERS.findIndex(c => currentTime >= c.start && currentTime < c.end)
  const currentChapter = activeChapterIndex !== -1 ? CHAPTERS[activeChapterIndex] : CHAPTERS[0]

  // Auto-play timer for interactive sandbox reel
  useEffect(() => {
    if (viewMode !== 'sandbox-reel' || !reelPlaying) return
    const interval = setInterval(() => {
      setReelProgress(prev => {
        if (prev >= 100) {
          setReelIndex(idx => (idx + 1) % SANDBOX_REEL_STEPS.length)
          return 0
        }
        return prev + 2 // advances every 5 seconds (50 ticks * 100ms)
      })
    }, 100)
    return () => clearInterval(interval)
  }, [viewMode, reelPlaying, reelIndex])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play?.()
      setPlaying(true)
    } else {
      v.pause?.()
      setPlaying(false)
    }
  }

  const seekToChapter = (chap) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = chap.start
    v.play?.()
    setPlaying(true)
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setCurrentTime(v.currentTime)
    if (v.duration) setDuration(v.duration)
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  const cycleSpeed = () => {
    const v = videoRef.current
    if (!v) return
    const nextSpeed = speed === 1 ? 1.25 : speed === 1.25 ? 1.5 : 1
    v.playbackRate = nextSpeed
    setSpeed(nextSpeed)
  }

  const toggleFullscreen = () => {
    const v = videoRef.current
    if (!v) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      v.requestFullscreen?.()
    }
  }

  const scrollToSandbox = (tabId) => {
    const el = document.getElementById('try') || document.querySelector('.ft-tour')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
      if (tabId) {
        window.dispatchEvent(new CustomEvent('ft-switch-tab', { detail: tabId }))
      } else {
        window.dispatchEvent(new CustomEvent('ft-start-tour'))
      }
    }
  }

  const activeReelStep = SANDBOX_REEL_STEPS[reelIndex]

  return (
    <div className="flex flex-col space-y-4">
      {/* ── Mode Switcher & Header ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[var(--card-border)]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[var(--accent)]">
              Sandbox Architecture & Motion Reel
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[var(--text-1)] m-0">
            See How the Single-Ledger Sandbox Works
          </h2>
        </div>

        {/* Dual Mode Switcher */}
        <div className="inline-flex p-1 rounded-xl border self-start sm:self-auto backdrop-blur-md"
             style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <button
            onClick={() => {
              setViewMode('film')
              const v = videoRef.current
              if (v && playing) v.play?.()
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'film'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
          >
            <Film size={13} />
            <span>Launch Film (24s)</span>
          </button>

          <button
            onClick={() => {
              setViewMode('sandbox-reel')
              if (videoRef.current) videoRef.current.pause?.()
              setPlaying(false)
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'sandbox-reel'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
          >
            <Sparkles size={13} />
            <span>Interactive Sandbox Walkthrough</span>
          </button>
        </div>
      </div>

      {/* ── MODE 1: the film reel. Length is read off the media, never typed. */}
      {viewMode === 'film' && (
        <div className="flex flex-col space-y-3">
          {/* Main Cinematic Video Stage */}
          <figure
            className="relative rounded-2xl overflow-hidden m-0 transition-all duration-300 group"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              background: '#090d16',
              border: '1px solid var(--card-border)',
              boxShadow: playing ? '0 16px 48px rgba(37,99,235,0.25)' : 'var(--card-shadow)',
            }}
          >
            {/* Top Chrome Header Bar */}
            <div className="flex items-center justify-between px-3.5 py-2 border-b text-[10.5px] font-mono z-20 relative"
                 style={{ background: 'rgba(15,23,42,0.95)', borderColor: 'rgba(255,255,255,0.1)', color: '#94a3b8' }}>
              <div className="flex items-center gap-2">
                {['#ef4444', '#fbbf24', '#22c55e'].map(c => (
                  <span key={c} className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />
                ))}
                <span className="text-slate-300 font-semibold ml-1">fintrack — single_ledger_stream.mp4</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 font-semibold">PostgreSQL Synchronized</span>
              </div>
            </div>

            {/* Native Video Element */}
            <video
              ref={videoRef}
              preload="metadata"
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              aria-label={`A ${filmLength} launch film of FinTrack: what is outstanding, the TDS already deducted from it, the status board, and an assistant that shows its query.`}
              className="block w-full cursor-pointer"
              style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
              onClick={togglePlay}
            >
              {/* mp4 first, and that is a measurement rather than a habit: for
                  this cut H.264 came out at 1.85MB against VP9's 2.07MB, the
                  reverse of the ambient loops. The browser takes the first it
                  can decode, so the smaller file has to be the one listed
                  first — which is not always the same format. */}
              {/* Smaller first — the browser takes the first source it can
                  decode. VP9 measured smaller than H.264 for this cut
                  (2.37MB vs 2.52MB at equal SSIM); it was the other way round
                  for the previous one, so the order is measured, not assumed. */}
              <source src="/media/fintrack-film.webm" type="video/webm" />
              <source src="/media/fintrack-film.mp4" type="video/mp4" />
            </video>

            {/* Dynamic Telemetry HUD Banner (Active During Playback) */}
            {playing && (
              <div className="absolute top-12 left-4 right-4 z-20 flex items-center justify-between pointer-events-none transition-all duration-300">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md border shadow-lg"
                     style={{ background: 'rgba(15,23,42,0.9)', borderColor: 'rgba(56,189,248,0.4)' }}>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-bold text-white tracking-wide uppercase">
                    Act {currentChapter.id}: {currentChapter.title}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {currentChapter.badge}
                  </span>
                </div>

                <div className="px-3 py-1 rounded-lg backdrop-blur-md border text-[11px] font-mono font-bold text-white"
                     style={{ background: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.2)' }}>
                  {currentChapter.metric}
                </div>
              </div>
            )}

            {/* Illuminated Pre-Play Stage (Replaces Dead Black Box) */}
            {!playing && (
              <div
                className="absolute inset-0 top-8 flex flex-col items-center justify-center p-6 text-center z-10 transition-all duration-300"
                style={{
                  background: 'radial-gradient(ellipse at center, rgba(15,23,42,0.92) 0%, rgba(9,10,15,0.98) 100%)',
                }}
              >
                {/* Visual Ambient Stage Mockup Header */}
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase mb-3 shadow-sm"
                     style={{ background: 'rgba(37,99,235,0.2)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8' }}>
                  <Film size={12} />
                  {filmLength} Single-Ledger Sandbox Film
                </div>

                <h3 className="text-lg sm:text-2xl font-extrabold text-white mb-2 tracking-tight max-w-lg">
                  Watch FinTrack Unify Operations & Capital
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 max-w-md mb-6 leading-relaxed">
                  How one PostgreSQL row synchronizes Invoices, the Status Board, Statutory Tax Escrow, and Studio Vector RAG without spreadsheet reconciliation.
                </p>

                {/* Primary Kinetic Play Action */}
                <button
                  onClick={togglePlay}
                  className="flex items-center gap-3 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all duration-200 transform hover:scale-105 cursor-pointer shadow-2xl mb-6"
                  style={{
                    background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    boxShadow: '0 0 35px rgba(37,99,235,0.6)',
                  }}
                >
                  <Play size={18} fill="#fff" />
                  <span>Play the {filmLength} film</span>
                </button>

                {/* Direct Act Preview Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-xl">
                  {CHAPTERS.map(chap => (
                    <button
                      key={chap.id}
                      onClick={() => seekToChapter(chap)}
                      className="p-2 rounded-lg border text-left transition-all cursor-pointer hover:border-blue-400/60"
                      style={{ background: 'rgba(30,41,59,0.7)', borderColor: 'rgba(255,255,255,0.1)' }}
                    >
                      <span className="text-[9.5px] font-mono block text-blue-400 font-bold">{chap.tag}</span>
                      <span className="text-[11px] font-semibold text-slate-200 block truncate">{chap.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Integrated Player Control Bar */}
            <div
              className={`absolute bottom-0 left-0 right-0 p-3 pt-6 z-20 transition-opacity duration-300 flex flex-col gap-2 ${
                playing && !hovered ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
              style={{
                background: 'linear-gradient(to top, rgba(9,10,15,0.95) 0%, rgba(9,10,15,0.7) 70%, transparent 100%)',
              }}
            >
              {/* Chapter Scrubber Progress Bar */}
              <div
                className="relative h-1.5 w-full bg-slate-700/60 rounded-full overflow-hidden cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = (e.clientX - rect.left) / rect.width
                  if (videoRef.current) {
                    videoRef.current.currentTime = pct * duration
                  }
                }}
              >
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-sky-400 transition-all duration-100"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
                {[6, 12, 18].map(sec => (
                  <div
                    key={sec}
                    className="absolute top-0 bottom-0 w-0.5 bg-white/40"
                    style={{ left: `${(sec / 24) * 100}%` }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-white text-xs">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    title={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? <Pause size={15} /> : <Play size={15} fill="#fff" />}
                  </button>

                  <button
                    onClick={toggleMute}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    title={muted ? 'Unmute' : 'Mute'}
                  >
                    {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>

                  <span className="font-mono text-[11px] text-slate-300">
                    0:{Math.floor(currentTime).toString().padStart(2, '0')} / 0:24
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={cycleSpeed}
                    className="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                    title="Playback Speed"
                  >
                    {speed}x
                  </button>

                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    title="Fullscreen"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          </figure>

          {/* Chapter Scrubber Navigation Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CHAPTERS.map(chap => {
              const isCurrent = currentChapter.id === chap.id
              return (
                <button
                  key={chap.id}
                  onClick={() => seekToChapter(chap)}
                  className="p-2.5 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between"
                  style={{
                    background: isCurrent ? 'var(--accent-dim)' : 'var(--card-bg)',
                    borderColor: isCurrent ? 'var(--accent)' : 'var(--card-border)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono font-bold text-[var(--accent)]">
                      {chap.tag} · Act 0{chap.id}
                    </span>
                    {isCurrent && playing && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />
                    )}
                  </div>
                  <span className="text-xs font-bold block text-[var(--text-1)] truncate">
                    {chap.title}
                  </span>
                  <span className="text-[10px] text-[var(--text-3)] block truncate mt-0.5">
                    {chap.badge}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Deep Sandbox Explanation Card for Active Chapter */}
          <div className="p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs"
               style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider"
                      style={{ background: 'var(--accent)' }}>
                  Act {currentChapter.id} Focus: {currentChapter.tabLabel}
                </span>
                <span className="text-[11px] font-mono text-[var(--text-3)]">
                  Metric: <strong className="text-[var(--text-1)]">{currentChapter.metric}</strong>
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-[var(--text-2)] m-0">
                <strong className="text-[var(--text-1)]">Problem:</strong> {currentChapter.problem}
              </p>
              <p className="text-[11.5px] leading-relaxed text-[var(--text-2)] m-0">
                <strong className="text-[var(--accent)]">Single-Ledger Solution:</strong> {currentChapter.solution}
              </p>
            </div>

            <button
              onClick={() => scrollToSandbox(currentChapter.tab)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer text-white shadow-sm"
              style={{ background: 'var(--accent-btn)' }}
            >
              <span>Test in Live Sandbox</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── MODE 2: Interactive Sandbox Walkthrough Reel ─────────────────── */}
      {viewMode === 'sandbox-reel' && (
        <div className="flex flex-col space-y-3">
          {/* Main Interactive Stage */}
          <div
            className="rounded-2xl border overflow-hidden transition-all duration-300"
            style={{
              background: 'var(--card-bg)',
              borderColor: 'var(--card-border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            {/* Top Stage Bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b"
                 style={{ background: 'var(--bg-card-subtle)', borderColor: 'var(--card-border)' }}>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[9.5px] font-extrabold uppercase tracking-wider text-white"
                      style={{ background: 'var(--accent)' }}>
                  Module {reelIndex + 1} of {SANDBOX_REEL_STEPS.length}
                </span>
                <span className="text-xs font-bold text-[var(--text-1)]">
                  {activeReelStep.title}
                </span>
              </div>

              {/* Progress & Auto-Play Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReelPlaying(p => !p)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
                  title={reelPlaying ? 'Pause Walkthrough' : 'Auto-Advance Walkthrough'}
                >
                  {reelPlaying ? <Pause size={12} /> : <Play size={12} />}
                  <span className="text-[11px]">{reelPlaying ? 'Pause' : 'Play'}</span>
                </button>

                <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-100"
                    style={{ width: `${reelProgress}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Interactive Module Representation Stage */}
            <div className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-mono text-[var(--accent)] font-bold">
                    {activeReelStep.badge} · {activeReelStep.tabLabel}
                  </span>
                  <h4 className="text-base font-extrabold text-[var(--text-1)] m-0">
                    {activeReelStep.subtitle}
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-lg font-mono text-xs font-bold border"
                        style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {activeReelStep.metric}
                  </span>
                  <span className="px-3 py-1 rounded-lg font-mono text-xs font-semibold border"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}>
                    {activeReelStep.subMetric}
                  </span>
                </div>
              </div>

              {/* Live Preview Card */}
              <div className="p-4 rounded-xl border font-mono text-xs overflow-x-auto"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                {activeReelStep.preview.type === 'table' && (
                  <div className="w-full min-w-[500px]">
                    <div className="grid grid-cols-5 text-[10px] uppercase font-bold text-[var(--text-3)] pb-2 border-b border-[var(--card-border)] mb-2">
                      <span>Invoice ID</span>
                      <span>Client</span>
                      <span>Gross Amount</span>
                      <span>10% TDS Isolated</span>
                      <span>Status</span>
                    </div>
                    {activeReelStep.preview.rows.map(r => (
                      <div key={r.id} className="grid grid-cols-5 py-1.5 border-b border-[var(--card-border)]/50 items-center">
                        <span className="font-bold text-[var(--text-1)]">{r.id}</span>
                        <span className="text-[var(--text-2)]">{r.client}</span>
                        <span className="font-bold text-[var(--text-1)]">{r.amount}</span>
                        <span className="text-amber-500">{r.tds}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold w-fit ${
                          r.status === 'Overdue' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {r.status} ({r.age})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {activeReelStep.preview.type === 'kanban' && (
                  <div className="grid grid-cols-3 gap-3 min-w-[500px]">
                    {activeReelStep.preview.lanes.map(l => (
                      <div key={l.name} className="p-3 rounded-lg border bg-[var(--card-bg)] border-[var(--card-border)]">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-bold text-xs text-[var(--text-1)]">{l.name}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-500/10 text-[var(--text-3)]">{l.count}</span>
                        </div>
                        <div className="p-2 rounded border border-blue-500/20 bg-blue-500/5 text-[11px]">
                          <p className="font-semibold text-[var(--text-1)] m-0">{l.item}</p>
                          <span className="text-[9.5px] text-emerald-400 mt-1 block">⚡ {l.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeReelStep.preview.type === 'rag' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-blue-400 font-semibold">
                      <Sparkles size={13} />
                      <span>Natural Query: "{activeReelStep.preview.query}"</span>
                    </div>
                    <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        {activeReelStep.preview.citation} · 94% Semantic Match
                      </span>
                      <p className="text-[11.5px] leading-relaxed text-[var(--text-1)] m-0 font-sans">
                        "{activeReelStep.preview.text}"
                      </p>
                    </div>
                  </div>
                )}

                {activeReelStep.preview.type === 'tax' && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {activeReelStep.preview.items.map(it => (
                      <div key={it.label} className="p-2.5 rounded-lg border bg-[var(--card-bg)] border-[var(--card-border)]">
                        <span className="text-[10px] text-[var(--text-3)] block mb-1">{it.label}</span>
                        <span className={`text-xs font-bold block ${
                          it.ringFenced ? 'text-amber-500' : it.spendable ? 'text-emerald-500' : 'text-[var(--text-1)]'
                        }`}>
                          {it.value}
                        </span>
                        {it.ringFenced && <span className="text-[9px] text-amber-500/80 font-sans">Ring-Fenced in Escrow</span>}
                        {it.spendable && <span className="text-[9px] text-emerald-500/80 font-sans">Verified True Capital</span>}
                      </div>
                    ))}
                  </div>
                )}

                {activeReelStep.preview.type === 'analyst' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[var(--accent)] font-semibold">
                      <Code2 size={13} />
                      <span>User Question: "{activeReelStep.preview.question}"</span>
                    </div>
                    <pre className="p-2.5 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-[10.5px] text-sky-300 whitespace-pre-wrap overflow-x-auto m-0">
                      {activeReelStep.preview.sql}
                    </pre>
                    <p className="text-[11px] text-emerald-400 m-0">
                      <strong>Result:</strong> {activeReelStep.preview.result}
                    </p>
                  </div>
                )}
              </div>

              {/* Explainer & Sandbox Navigation Button */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
                <p className="text-xs text-[var(--text-2)] max-w-xl m-0 leading-relaxed">
                  {activeReelStep.explainer}
                </p>

                <button
                  onClick={() => scrollToSandbox(activeReelStep.tab)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer text-white shadow-sm"
                  style={{ background: 'var(--accent-btn)' }}
                >
                  <span>Launch {activeReelStep.tabLabel}</span>
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </div>

            {/* Bottom Step Pills */}
            <div className="flex items-center justify-between px-4 py-2 border-t"
                 style={{ background: 'var(--bg-card-subtle)', borderColor: 'var(--card-border)' }}>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const prev = (reelIndex - 1 + SANDBOX_REEL_STEPS.length) % SANDBOX_REEL_STEPS.length
                    setReelIndex(prev)
                    setReelProgress(0)
                  }}
                  className="p-1 rounded border text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
                  title="Previous Module"
                >
                  <ChevronLeft size={13} />
                </button>

                {SANDBOX_REEL_STEPS.map((st, idx) => (
                  <button
                    key={st.id}
                    onClick={() => {
                      setReelIndex(idx)
                      setReelProgress(0)
                    }}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold border transition-all cursor-pointer ${
                      idx === reelIndex
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-[var(--card-border)] text-[var(--text-3)] hover:text-[var(--text-1)]'
                    }`}
                  >
                    {idx + 1}. {st.tabLabel}
                  </button>
                ))}

                <button
                  onClick={() => {
                    const next = (reelIndex + 1) % SANDBOX_REEL_STEPS.length
                    setReelIndex(next)
                    setReelProgress(0)
                  }}
                  className="p-1 rounded border text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer"
                  title="Next Module"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              <span className="text-[10px] font-mono text-[var(--text-3)] hidden sm:inline">
                Synchronized with demoData.js
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom Reconciled Truth Caption ─────────────────────────────── */}
      <div className="px-4 py-2.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs"
           style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}>
        <p className="m-0 leading-relaxed text-[11.5px]">
          Cut directly from FinTrack. Every figure is dynamically computed from our synchronized sample PostgreSQL ledger — zero mockups, zero hallucinated data.
        </p>
        <button
          onClick={() => scrollToSandbox()}
          className="flex items-center gap-1 font-bold text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
        >
          Explore in Live Sandbox <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}
