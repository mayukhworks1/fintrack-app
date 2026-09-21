import { useState, useMemo } from 'react'
import {
  TrendingDown, AlertTriangle, ShieldCheck, Clock,
  ArrowRight, Layers, Sliders, Activity, Check
} from 'lucide-react'
import { inr, inrShort } from './demoData'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

export default function RunwayStressTester() {
  const [cashReserve, setCashReserve] = useState(4500000) // ₹45 Lakhs
  const [monthlyBurn, setMonthlyBurn] = useState(650000)  // ₹6.5 Lakhs / mo
  const [delayDays, setDelayDays] = useState(30)         // 30 days overdue delay
  const [activeMedia, setActiveMedia] = useState('tester') // 'tester' | 'blueprint'
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
      className="rounded-xl p-6 sm:p-8 lg:p-10 transition-all duration-300 relative overflow-hidden"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--card-border)]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold mb-2"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
            <TrendingDown size={13} />
            Cash Runway & Stress-Testing Simulator
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Scenario planning: what happens when clients delay payments?
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Simulate working capital stress by varying client overdue delays and burn rates.
          </p>
        </div>

        {/* View Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('tester')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'tester' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'tester' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'tester' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Stress-Tester
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'blueprint' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Layers size={13} />
            3D Cash Model
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
                  Monthly Operating Burn
                </label>
                <span className="font-extrabold text-xs sm:text-sm tabular-nums text-rose-500">
                  {inr(monthlyBurn)}/mo
                </span>
              </div>
              <input
                type="range"
                min="200000"
                max="2000000"
                step="50000"
                value={monthlyBurn}
                onChange={(e) => setMonthlyBurn(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-rose-500"
                style={{ background: 'var(--bg-input)' }}
              />
            </div>

            {/* Slider 3: Delay Days */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Average Client Delay Window
                </label>
                <span className="font-extrabold text-xs sm:text-sm tabular-nums text-amber-500">
                  +{delayDays} days overdue
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="90"
                step="5"
                value={delayDays}
                onChange={(e) => setDelayDays(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-500"
                style={{ background: 'var(--bg-input)' }}
              />
            </div>
          </div>

          {/* Visualization Column */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* KPI Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl p-4 border"
                   style={{
                     background: 'var(--bg-input)',
                     borderColor: runwayStatus === 'healthy' ? 'var(--ok-dim)' : runwayStatus === 'watch' ? 'var(--warn-dim)' : 'var(--bad-dim)',
                   }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block" style={{ color: 'var(--text-3)' }}>
                  Remaining Runway
                </span>
                <span className="text-2xl font-extrabold my-1 block tabular-nums"
                      style={{ color: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)' }}>
                  {runwayMonths >= 36 ? '36+ mos' : `${runwayMonths} mos`}
                </span>
                <span className="text-[10px] font-semibold"
                      style={{ color: runwayStatus === 'healthy' ? 'var(--ok)' : runwayStatus === 'watch' ? 'var(--warn)' : 'var(--bad)' }}>
                  {runwayStatus === 'healthy' ? 'Low Risk' : runwayStatus === 'watch' ? 'Moderate Drag' : 'Critical Cash Risk'}
                </span>
              </div>

              <div className="rounded-2xl p-4 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block" style={{ color: 'var(--text-3)' }}>
                  Net Cashflow
                </span>
                <span className="text-lg sm:text-xl font-extrabold my-1 block tabular-nums"
                      style={{ color: netMonthlyCashflow >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                  {netMonthlyCashflow >= 0 ? `+${inrShort(netMonthlyCashflow)}` : `-${inrShort(Math.abs(netMonthlyCashflow))}`}
                </span>
                <span className="text-[10px] text-[var(--text-3)]">
                  Per month
                </span>
              </div>

              <div className="rounded-2xl p-4 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block" style={{ color: 'var(--text-3)' }}>
                  Delayed Inflow
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
      ) : (
        /* 3D Runway Simulation Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Stress Model Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Liquidity Stress Engine
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Monte Carlo cash runway forecasting & overdue shock models
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Simulate delayed client settlements and see how overdue invoice aging directly impacts payroll, contractor burn, and statutory cash safety.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  '12-month forward predictive liquidity curve',
                  'Client-specific historical payment lag weighting',
                  'Automated burn rate containment threshold alerts',
                  'Instant scenario export for leadership & investors',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Model Precision</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">Invoice-Level</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Shock Buffer</span>
                  <span className="font-extrabold text-sm text-emerald-500">Dynamic Escrow</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Framed 3D Render Loop */}
          <div className="lg:col-span-6 flex items-center justify-center">
            <div className="w-full max-w-[380px] sm:max-w-[420px] rounded-2xl overflow-hidden p-3 transition-all duration-300 relative"
                 style={{
                   background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.95))',
                   border: '1px solid rgba(255,255,255,0.1)',
                   boxShadow: '0 12px 35px rgba(37,99,235,0.15)',
                 }}>
              <div className="relative rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center aspect-[4/3]">
                <LoopVideo src="/media/pomelli_photoshoot-6.mp4" className="w-full h-full object-cover rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
