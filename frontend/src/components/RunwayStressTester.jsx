import { useState, useMemo } from 'react'
import {
  TrendingDown, AlertTriangle, ShieldCheck, Clock,
  ArrowRight, Sparkles, Layers, Play, Maximize2, X
} from 'lucide-react'
import { inr, inrShort } from './demoData'
import { useTilt } from '../hooks/useTilt'

export default function RunwayStressTester() {
  const [cashReserve, setCashReserve] = useState(4500000) // ₹45 Lakhs
  const [monthlyBurn, setMonthlyBurn] = useState(650000)  // ₹6.5 Lakhs / mo
  const [delayDays, setDelayDays] = useState(30)         // 30 days overdue delay
  const [activeMedia, setActiveMedia] = useState('tester') // 'tester' | 'blueprint' | 'motion'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const cardTilt = useTilt({ max: 3 })

  // Expected monthly collection under normal terms vs delayed terms
  const baseMonthlyCollection = 850000
  const collectionLagFactor = Math.max(0.1, 1 - (delayDays / 120))
  const actualMonthlyInflow = Math.round(baseMonthlyCollection * collectionLagFactor)
  const netMonthlyCashflow = actualMonthlyInflow - monthlyBurn

  // Calculate runway months
  const runwayMonths = useMemo(() => {
    if (netMonthlyCashflow >= 0) return 36 // Indefinitely sustainable
    const months = cashReserve / Math.abs(netMonthlyCashflow)
    return Math.min(Math.round(months * 10) / 10, 36)
  }, [cashReserve, netMonthlyCashflow])

  const runwayStatus = runwayMonths >= 12 ? 'healthy' : runwayMonths >= 6 ? 'watch' : 'critical'

  // Generate 12-month projection points
  const projection = useMemo(() => {
    const points = []
    let current = cashReserve
    for (let m = 0; m <= 12; m++) {
      points.push({ month: `M+${m}`, value: Math.max(0, current) })
      current += netMonthlyCashflow
    }
    return points
  }, [cashReserve, netMonthlyCashflow])

  const W = 320, H = 100
  const maxVal = Math.max(...projection.map(p => p.value), 5000000)
  const px = (i) => (i / 12) * (W - 20) + 10
  const py = (v) => H - 12 - (v / maxVal) * (H - 24)
  const pathD = projection.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ')

  return (
    <div
      ref={cardTilt}
      className="rounded-3xl p-6 sm:p-8 lg:p-10 transition-all duration-300 relative overflow-hidden ft-glow-border"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--card-border)]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-2"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            <TrendingDown size={13} />
            Cash Runway & Overdue Delay Stress-Tester
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Scenario planning: what happens when clients delay payments?
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Simulate working capital stress by varying client overdue delays and burn rates.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('tester')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'tester' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'tester' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'tester' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            Stress-Tester
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'blueprint' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Layers size={13} />
            3D Analytics
          </button>
          <button
            onClick={() => setActiveMedia('motion')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'motion' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'motion' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'motion' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Play size={13} />
            Motion
          </button>
        </div>
      </div>

      {activeMedia === 'tester' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Controls Column */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Slider 1: Cash Reserve */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Opening Cash Reserve
                </label>
                <span className="font-extrabold text-xs sm:text-sm tabular-nums" style={{ color: 'var(--accent)' }}>
                  {inr(cashReserve)}
                </span>
              </div>
              <input
                type="range"
                min="1000000"
                max="10000000"
                step="500000"
                value={cashReserve}
                onChange={(e) => setCashReserve(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                style={{ background: 'var(--bg-input)' }}
              />
            </div>

            {/* Slider 2: Monthly Burn */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Monthly Team & Ops Burn
                </label>
                <span className="font-extrabold text-xs sm:text-sm tabular-nums" style={{ color: 'var(--bad)' }}>
                  − {inr(monthlyBurn)} / mo
                </span>
              </div>
              <input
                type="range"
                min="200000"
                max="2000000"
                step="50000"
                value={monthlyBurn}
                onChange={(e) => setMonthlyBurn(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[var(--bad)]"
                style={{ background: 'var(--bg-input)' }}
              />
            </div>

            {/* Slider 3: Client Delay */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Client Payment Delay (Overdue)
                </label>
                <span className="font-extrabold text-xs sm:text-sm tabular-nums" style={{ color: delayDays > 45 ? 'var(--bad)' : delayDays > 15 ? 'var(--warn)' : 'var(--ok)' }}>
                  +{delayDays} Days Lag
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="90"
                step="15"
                value={delayDays}
                onChange={(e) => setDelayDays(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-500"
                style={{ background: 'var(--bg-input)' }}
              />
              <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                <span>0 Days (On-Time)</span>
                <span>45 Days</span>
                <span>90 Days (Stalled)</span>
              </div>
            </div>
          </div>

          {/* Visualization Output Column */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* KPI Result Tiles */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl p-3.5 border text-center"
                   style={{
                     background: runwayStatus === 'healthy' ? 'var(--ok-dim)' : runwayStatus === 'watch' ? 'var(--warn-dim)' : 'var(--bad-dim)',
                     borderColor: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)',
                   }}>
                <span className="block text-[10px] font-extrabold uppercase tracking-wider opacity-80"
                      style={{ color: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)' }}>
                  Runway Horizon
                </span>
                <span className="text-xl sm:text-2xl font-extrabold my-1 block tabular-nums"
                      style={{ color: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)' }}>
                  {runwayMonths >= 36 ? '36+ Mos' : `${runwayMonths} Mos`}
                </span>
                <span className="text-[10px] font-semibold"
                      style={{ color: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)' }}>
                  {runwayStatus === 'healthy' ? 'Safe Operating Buffer' : runwayStatus === 'watch' ? 'Caution Required' : 'Critical Cash Risk'}
                </span>
              </div>

              <div className="rounded-2xl p-3.5 border text-center"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                  Net Monthly Cash
                </span>
                <span className="text-lg sm:text-xl font-extrabold my-1 block tabular-nums"
                      style={{ color: netMonthlyCashflow >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                  {netMonthlyCashflow >= 0 ? `+${inrShort(netMonthlyCashflow)}` : `−${inrShort(Math.abs(netMonthlyCashflow))}`}
                </span>
                <span className="text-[10px] text-[var(--text-3)]">
                  Inflow vs burn
                </span>
              </div>

              <div className="rounded-2xl p-3.5 border text-center"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">
                  Overdue Capital
                </span>
                <span className="text-lg sm:text-xl font-extrabold my-1 block text-amber-500 tabular-nums">
                  {inrShort(Math.round(baseMonthlyCollection * (delayDays / 30)))}
                </span>
                <span className="text-[10px] text-[var(--text-3)]">
                  Locked in aging
                </span>
              </div>
            </div>

            {/* 12-Month Projection Curve */}
            <div className="rounded-2xl p-4 sm:p-5 border"
                 style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center text-xs font-bold mb-2" style={{ color: 'var(--text-2)' }}>
                <span>12-Month Projected Working Capital Trajectory</span>
                <span style={{ color: 'var(--accent)' }}>Live D3 Simulation</span>
              </div>

              <div className="w-full h-28 relative">
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block">
                  {/* Grid Lines */}
                  {[0.25, 0.5, 0.75].map(f => (
                    <line key={f} x1="0" y1={H - 12 - f * (H - 24)} x2={W} y2={H - 12 - f * (H - 24)}
                          stroke="var(--card-border)" strokeWidth="0.6" strokeDasharray="3 3" />
                  ))}

                  {/* Curve */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Area fill */}
                  <path
                    d={`${pathD} L ${px(12)},${H - 12} L ${px(0)},${H - 12} Z`}
                    fill={runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)'}
                    opacity="0.1"
                  />
                </svg>
              </div>

              <div className="flex justify-between px-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
                <span>Today</span>
                <span>Month +3</span>
                <span>Month +6</span>
                <span>Month +9</span>
                <span>Month +12</span>
              </div>
            </div>
          </div>
        </div>
      ) : activeMedia === 'blueprint' ? (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-3.png"
            alt="3D Analytics Blueprint"
            className="max-h-[360px] w-auto object-contain rounded-lg drop-shadow-2xl"
          />
          <button
            onClick={() => setLightboxOpen(true)}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900/90 text-white border border-slate-700 hover:border-sky-400 backdrop-blur transition-all"
          >
            <Maximize2 size={13} /> Inspect High-Res
          </button>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden p-4 bg-slate-950 flex items-center justify-center min-h-[380px]">
          <video
            src="/media/pomelli_photoshoot-6.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="max-h-[360px] w-auto object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[92vh] flex flex-col rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">Financial Analytics & Runway 3D Blueprint</span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <img
                src="/media/pomelli_photoshoot-3.png"
                alt="Analytics Blueprint"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
