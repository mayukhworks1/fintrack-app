import { useState, useRef, useEffect } from 'react'
import {
  Sparkles, Play, Pause, Maximize2, Layers,
  Receipt, FolderKanban, ShieldCheck, ChevronRight, Check, X,
  Compass, Eye
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import { Reveal } from './PublicBits'

const SHOWCASE_TABS = [
  {
    id: 'blueprint',
    label: '3D Tax & Ledger Blueprint',
    badge: 'Core Architecture',
    icon: Receipt,
    headline: 'Exploded 3D view of the single-ledger architecture',
    description:
      'Where legacy ERPs require two fragmented databases reconciled every quarter, FinTrack binds operational delivery milestones directly with GST, TDS, and real-time receivables.',
    image: '/media/pomelli_photoshoot-1.png',
    video: '/media/pomelli_photoshoot-5.mp4',
    hasVideo: true,
    callouts: [
      { top: '22%', left: '18%', label: 'Closed SQL Compiler', detail: 'Guaranteed 0% LLM hallucinations by mapping plain-text requests to parameterized SQL.' },
      { top: '38%', left: '72%', label: 'GST / TDS Auto-Split', detail: 'Tax withheld at source is isolated from collectible cash to prevent runway overstatement.' },
      { top: '65%', left: '26%', label: 'Incremental Mirror', detail: 'Zero-latency sync with upstream bases and sub-30s change-capture pipeline.' },
      { top: '78%', left: '68%', label: 'Delivery Margin Engine', detail: 'Billed amount vs actual burn computed per deliverable in real-time.' },
    ],
    stats: [
      { label: 'Reconciliation Drift', val: '0.00%' },
      { label: 'Audit Trail Depth', val: '100%' },
      { label: 'Latency', val: '< 30ms' },
    ],
  },
  {
    id: 'analyst',
    label: 'AI Analyst & Intelligence',
    badge: 'Verified Engine',
    icon: Sparkles,
    headline: 'Autonomous financial intelligence with visible SQL proofs',
    description:
      'Every natural language question compiles down into verifiable Postgres queries. The AI never writes loose SQL — it selects fixed schema dimensions and compiles exact AST nodes.',
    image: '/media/pomelli_photoshoot-2.png',
    video: '/media/pomelli_photoshoot-5.mp4',
    hasVideo: true,
    callouts: [
      { top: '28%', left: '30%', label: 'Natural Language Ingest', detail: 'Understands executive financial intent without exposing schema internals.' },
      { top: '55%', left: '65%', label: 'Dynamic Aggregation', detail: 'Client aging, overdue bands, and project margins aggregated on the fly.' },
    ],
    stats: [
      { label: 'Query Accuracy', val: '100%' },
      { label: 'AST Verification', val: 'Strict' },
      { label: 'Daily AI Quota', val: 'Role-based' },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery & Status Kanban',
    badge: 'Live Operations',
    icon: FolderKanban,
    headline: 'Project delivery and cashflow unified in one visual board',
    description:
      'Engineers update task milestones; finance sees invoice readiness immediately. No more chasing project leads for billing confirmations or discovery surprises.',
    image: '/media/pomelli_photoshoot-3.png',
    video: '/media/pomelli_photoshoot-6.mp4',
    hasVideo: true,
    callouts: [
      { top: '24%', left: '60%', label: 'Live SSE Streaming', detail: 'Instant reactive updates across team members without manual browser refresh.' },
      { top: '60%', left: '25%', label: 'Health Status Tagging', detail: 'Critical, at-risk, and on-track status tied to milestone burndowns.' },
    ],
    stats: [
      { label: 'Board Refresh', val: 'Live SSE' },
      { label: 'Custom Columns', val: 'Unlimited' },
      { label: 'Audit Logging', val: 'Instant' },
    ],
  },
  {
    id: 'security',
    label: 'Granular Access & Audit',
    badge: 'Enterprise Security',
    icon: ShieldCheck,
    headline: 'Row-level permissions, sandboxed views & live audit trails',
    description:
      'Every query is scoped by the caller’s cryptographically verified role before execution. External clients see only the exact filtered subset intended for them.',
    image: '/media/pomelli_photoshoot-4.png',
    video: '/media/pomelli_photoshoot-7.mp4',
    hasVideo: true,
    callouts: [
      { top: '32%', left: '42%', label: 'Cryptographic RBAC', detail: '8 distinct roles with granular per-action overrides and MFA enforcement.' },
      { top: '68%', left: '55%', label: 'Asynchronous Audit', detail: 'Zero-overhead telemetry logging user agents, IPs, paths, and durations.' },
    ],
    stats: [
      { label: 'Roles Matrix', val: '8 Built-in' },
      { label: 'Token Expiry', val: 'Configurable' },
      { label: 'Data Sandbox', val: 'Isolated' },
    ],
  },
]

export default function ProductMediaShowcase() {
  const [activeTab, setActiveTab] = useState(0)
  const [mode, setMode] = useState('image') // 'image' | 'video'
  const [isPlaying, setIsPlaying] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [activeCallout, setActiveCallout] = useState(null)
  const videoRef = useRef(null)
  const showcaseTilt = useTilt({ max: 3.5 })

  const current = SHOWCASE_TABS[activeTab]

  useEffect(() => {
    setActiveCallout(null)
    setMode('image')
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [activeTab])

  const toggleVideoPlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  return (
    <div className="w-full">
      {/* ── Tabs Selector ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
        {SHOWCASE_TABS.map((tab, idx) => {
          const Icon = tab.icon
          const isActive = idx === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(idx)}
              className="group relative flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all duration-200"
              style={{
                background: isActive ? 'var(--accent-dim)' : 'var(--card-bg)',
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--card-border)'}`,
                color: isActive ? 'var(--accent)' : 'var(--text-2)',
                boxShadow: isActive ? '0 4px 16px var(--accent-glow)' : 'none',
              }}
            >
              <Icon size={16} className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-3)] group-hover:text-[var(--text-1)]'} />
              <span>{tab.label}</span>
              {isActive && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── Main Interactive Stage ────────────────────────────────────── */}
      <div
        ref={showcaseTilt}
        className="relative rounded-3xl overflow-hidden p-4 sm:p-7 transition-all duration-300 ft-glow-border"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.12), var(--card-shadow)',
        }}
      >
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-5 mb-5 border-b border-[var(--card-border)]">
          <div className="flex items-center gap-2.5">
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {current.badge}
            </span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Interactive 3D Visualizer
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            {current.hasVideo && (
              <div
                className="inline-flex p-1 rounded-xl"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}
              >
                <button
                  onClick={() => setMode('image')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: mode === 'image' ? 'var(--card-bg)' : 'transparent',
                    color: mode === 'image' ? 'var(--accent)' : 'var(--text-3)',
                    boxShadow: mode === 'image' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <Layers size={13} />
                  3D Blueprint
                </button>
                <button
                  onClick={() => setMode('video')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: mode === 'video' ? 'var(--card-bg)' : 'transparent',
                    color: mode === 'video' ? 'var(--accent)' : 'var(--text-3)',
                    boxShadow: mode === 'video' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <Play size={13} />
                  Motion Loop
                </button>
              </div>
            )}

            <button
              onClick={() => setLightboxOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold hover:border-[var(--accent)] transition-colors"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--card-border)',
                color: 'var(--text-2)',
              }}
              title="Inspect Full High-Res Blueprint"
            >
              <Maximize2 size={13} />
              <span className="hidden sm:inline">Inspect High-Res</span>
            </button>
          </div>
        </div>

        {/* Middle: Visual Display Canvas */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-950 flex items-center justify-center min-h-[320px] sm:min-h-[460px] lg:min-h-[520px] border border-slate-800/80 shadow-inner group">
          {/* Ambient radial glow background */}
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              background: 'radial-gradient(circle at 50% 40%, rgba(37, 99, 235, 0.35), transparent 70%)',
            }}
          />

          {mode === 'image' ? (
            <div className="relative w-full h-full flex items-center justify-center p-2 sm:p-6 select-none">
              <img
                src={current.image}
                alt={current.headline}
                className="w-full max-h-[560px] object-contain drop-shadow-2xl transition-transform duration-500 group-hover:scale-[1.015]"
                loading="eager"
              />

              {/* Interactive Callout Markers */}
              {current.callouts.map((c, i) => {
                const isCalloutActive = activeCallout === i
                return (
                  <div
                    key={c.label}
                    className="absolute z-20"
                    style={{ top: c.top, left: c.left }}
                  >
                    <button
                      onClick={() => setActiveCallout(isCalloutActive ? null : i)}
                      onMouseEnter={() => setActiveCallout(i)}
                      className="relative flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full shadow-lg transition-transform duration-300 hover:scale-125 focus:outline-none"
                      style={{
                        background: 'linear-gradient(135deg, var(--accent), #38bdf8)',
                        color: '#fff',
                        border: '2px solid rgba(255, 255, 255, 0.9)',
                      }}
                      aria-label={`View callout: ${c.label}`}
                    >
                      <span className="absolute inset-0 rounded-full animate-ping opacity-40 bg-sky-400" />
                      <Compass size={14} className="relative z-10" />
                    </button>

                    {/* Popover Card */}
                    {isCalloutActive && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 w-56 sm:w-64 p-3.5 rounded-xl shadow-2xl z-30 pointer-events-auto backdrop-blur-md"
                        style={{
                          background: 'rgba(15, 23, 42, 0.92)',
                          border: '1px solid rgba(56, 189, 248, 0.4)',
                          color: '#fff',
                          animation: 'ft-pop-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-extrabold text-sky-400 uppercase tracking-wider">
                            {c.label}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveCallout(null) }}
                            className="text-slate-400 hover:text-white"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed font-normal">
                          {c.detail}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="absolute bottom-4 left-4 sm:left-6 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur border border-slate-700/60 text-slate-300 text-[11px]">
                <Eye size={13} className="text-sky-400" />
                <span>Hover or tap glowing markers to reveal architectural components</span>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center p-2 sm:p-4">
              <video
                ref={videoRef}
                src={current.video}
                autoPlay
                loop
                muted
                playsInline
                className="w-full max-h-[560px] object-contain rounded-xl shadow-2xl"
              />
              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                <button
                  onClick={toggleVideoPlay}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-900/90 hover:bg-slate-800 text-white border border-slate-700/80 shadow-lg backdrop-blur transition-all"
                  aria-label={isPlaying ? 'Pause video' : 'Play video'}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Specs & Key Value Proposition */}
        <div className="mt-6 pt-5 border-t border-[var(--card-border)] grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-8">
            <h3 className="ft-display text-lg sm:text-xl mb-2" style={{ color: 'var(--text-1)' }}>
              {current.headline}
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {current.description}
            </p>
          </div>

          <div className="lg:col-span-4 grid grid-cols-3 gap-2.5 sm:gap-3">
            {current.stats.map(s => (
              <div
                key={s.label}
                className="rounded-xl p-3 text-center"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}
              >
                <div className="font-extrabold text-sm sm:text-base" style={{ color: 'var(--accent)' }}>
                  {s.val}
                </div>
                <div className="text-[10px] sm:text-[11px] font-medium mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── High-Res Lightbox Modal ────────────────────────────────────── */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-slate-950/90 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[92vh] flex flex-col rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="text-xs font-bold text-slate-200">
                  {current.label} — High Fidelity Isometric Blueprint
                </span>
              </div>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close high-res lightbox"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-auto flex items-center justify-center bg-slate-950/60">
              <img
                src={current.image}
                alt={current.headline}
                className="max-w-full max-h-[76vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
