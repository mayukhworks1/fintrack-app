import { useRef, useState, useEffect } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize2, RotateCcw,
  Sparkles, CheckCircle2, ShieldCheck, Database, Layers,
  Clock, ArrowRight, Zap, Film
} from 'lucide-react'

const CHAPTERS = [
  { id: 1, title: 'Float Drag & TDS', start: 0, end: 6, tag: '0:00', badge: 'Capital Leakage', metric: '₹32.9L Floating' },
  { id: 2, title: 'Single-Ledger Sync', start: 6, end: 12, tag: '0:06', badge: 'Postgres Mirror', metric: '11 Modules Synced' },
  { id: 3, title: 'Statutory Escrow', start: 12, end: 18, tag: '0:12', badge: '26AS Reconciliation', metric: '100% Tax Matched' },
  { id: 4, title: 'Deterministic SQL', start: 18, end: 24, tag: '0:18', badge: 'Zero Hallucinations', metric: 'Parameterized AST' },
]

export default function ProductFilm() {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(24)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [activeChapter, setActiveChapter] = useState(CHAPTERS[0])
  const [hovered, setHovered] = useState(false)
  const videoRef = useRef(null)

  const activeChapterIndex = CHAPTERS.findIndex(c => currentTime >= c.start && currentTime < c.end)
  const currentChapter = activeChapterIndex !== -1 ? CHAPTERS[activeChapterIndex] : CHAPTERS[0]

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
    setActiveChapter(chap)
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

  const scrollToSandbox = () => {
    const el = document.getElementById('try') || document.querySelector('.ft-tour')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
      window.dispatchEvent(new CustomEvent('ft-start-tour'))
    }
  }

  return (
    <div className="flex flex-col space-y-3">
      {/* Cinematic Stage Wrapper */}
      <figure
        className="relative rounded-2xl overflow-hidden m-0 transition-all duration-300 group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: 'linear-gradient(135deg, #090a0f 0%, #0c121e 100%)',
          border: '1px solid var(--card-border)',
          boxShadow: playing ? '0 16px 48px rgba(37,99,235,0.2)' : 'var(--card-shadow)',
        }}
      >
        <video
          ref={videoRef}
          poster="/media/fintrack-film.jpg"
          preload="none"
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label="A twenty-four second launch film of FinTrack: outstanding receivables, TDS deduction, delivery board, and transparent SQL assistant."
          className="block w-full cursor-pointer"
          style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
          onClick={togglePlay}
        >
          <source src="/media/fintrack-film.webm" type="video/webm" />
          <source src="/media/fintrack-film.mp4" type="video/mp4" />
        </video>

        {/* Dynamic Telemetry HUD Banner (Synced with Video Timeline) */}
        {playing && (
          <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none transition-all duration-300">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md border shadow-lg"
                 style={{ background: 'rgba(15,23,42,0.85)', borderColor: 'rgba(56,189,248,0.3)' }}>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-bold text-white tracking-wide uppercase">
                Act {currentChapter.id}: {currentChapter.title}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {currentChapter.badge}
              </span>
            </div>

            <div className="px-3 py-1 rounded-lg backdrop-blur-md border text-[11px] font-mono font-bold text-white"
                 style={{ background: 'rgba(15,23,42,0.85)', borderColor: 'rgba(255,255,255,0.15)' }}>
              {currentChapter.metric}
            </div>
          </div>
        )}

        {/* Play Overlay Screen when Paused */}
        {!playing && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-300"
            style={{
              background: 'linear-gradient(to top, rgba(9,10,15,0.85) 0%, rgba(9,10,15,0.35) 60%, rgba(9,10,15,0.6) 100%)',
              border: 0,
              color: '#fff',
            }}
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase mb-1"
                 style={{ background: 'rgba(37,99,235,0.25)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8' }}>
              <Film size={12} />
              24-Second Product Launch Film
            </div>

            <span className="flex items-center justify-center rounded-full transition-transform duration-300 hover:scale-110 shadow-2xl"
                  style={{
                    width: 68,
                    height: 68,
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.9), rgba(56,189,248,0.9))',
                    border: '2px solid rgba(255,255,255,0.6)',
                    boxShadow: '0 0 35px rgba(37,99,235,0.6)',
                  }}>
              <Play size={26} aria-hidden="true" style={{ marginLeft: 3 }} fill="#fff" />
            </span>

            <span className="font-bold text-sm sm:text-base tracking-wide mt-1 text-white">
              Watch The Single-Ledger Architecture in Motion
            </span>
            <span className="text-xs text-slate-300 max-w-md text-center px-4 font-medium">
              Zero mockups. Every frame rendered directly from synchronized PostgreSQL rows.
            </span>
          </button>
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
          <div className="relative h-1.5 w-full bg-slate-700/60 rounded-full overflow-hidden cursor-pointer">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-sky-400 transition-all duration-100"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            {/* Chapter Break Dividers */}
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

      {/* Bottom Architectural Caption */}
      <div className="px-4 py-2.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs"
           style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}>
        <p className="m-0 leading-relaxed text-[11.5px]">
          Cut directly from FinTrack. Every figure is dynamically computed from our synchronized sample PostgreSQL ledger — zero mockups, zero hallucinated data.
        </p>
        <button
          onClick={scrollToSandbox}
          className="flex items-center gap-1 font-bold text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
        >
          Explore in Live Sandbox <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}
