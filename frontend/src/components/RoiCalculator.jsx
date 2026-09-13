import { useState, useMemo } from 'react'
import {
  Calculator, TrendingUp, Clock, ShieldAlert, Sparkles,
  Layers, Maximize2, X, ArrowRight, CheckCircle2, Zap
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import { inr, inrShort } from './demoData'

export default function RoiCalculator() {
  // Sliders
  const [monthlyRevenue, setMonthlyRevenue] = useState(5000000) // ₹50 Lakhs / mo
  const [daysOverdue, setDaysOverdue] = useState(38) // 38 days average delay
  const [invoicesPerMonth, setInvoicesPerMonth] = useState(65) // 65 invoices / mo

  const [activeMedia, setActiveMedia] = useState('calculator') // 'calculator' | 'blueprint'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const cardTilt = useTilt({ max: 3 })

  // Calculations
  const metrics = useMemo(() => {
    const annualRevenue = monthlyRevenue * 12
    // Overdue capital floating in aged buckets
    const capitalAtRisk = Math.round(monthlyRevenue * (daysOverdue / 30) * 0.55)
    // 12% p.a. cost of capital on overdue float
    const interestDragSaved = Math.round(capitalAtRisk * 0.12)
    // DSO reduction (typically 35-45% faster collection with automated aging bands & follow-ups)
    const dsoReduction = Math.round(daysOverdue * 0.42)
    // Manual reconciliation hours saved per month (approx 45 mins per invoice lifecycle)
    const hoursSavedPerMonth = Math.round(invoicesPerMonth * 0.75)
    const hoursSavedPerYear = hoursSavedPerMonth * 12

    return {
      annualRevenue,
      capitalAtRisk,
      interestDragSaved,
      dsoReduction,
      hoursSavedPerMonth,
      hoursSavedPerYear,
    }
  }, [monthlyRevenue, daysOverdue, invoicesPerMonth])

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
            <Calculator size={13} />
            Interactive ROI & Working Capital Simulator
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Simulate your capital recovery and interest drag savings
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Calculate the exact working capital unlocked when invoice aging, GST/TDS segregation, and follow-ups run automatically.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('calculator')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'calculator' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'calculator' ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            Calculator
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            <Layers size={13} /> 3D View
          </button>
        </div>
      </div>

      {activeMedia === 'calculator' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Monthly Invoicing Volume Slider */}
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Monthly Billed Revenue
                </label>
                <span className="font-mono font-extrabold text-sm" style={{ color: 'var(--accent)' }}>
                  {inrShort(monthlyRevenue)}
                </span>
              </div>
              <input
                type="range"
                min={1000000}
                max={50000000}
                step={500000}
                value={monthlyRevenue}
                onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-3)] mt-1">
                <span>₹10L/mo</span>
                <span>₹2.5Cr/mo</span>
                <span>₹5Cr/mo</span>
              </div>
            </div>

            {/* Payment Delay Days Slider */}
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Average Client Delay (Days)
                </label>
                <span className="font-mono font-extrabold text-sm" style={{ color: daysOverdue > 45 ? 'var(--bad)' : 'var(--warn)' }}>
                  {daysOverdue} days
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={90}
                step={1}
                value={daysOverdue}
                onChange={(e) => setDaysOverdue(Number(e.target.value))}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-3)] mt-1">
                <span>15d (Fast)</span>
                <span>45d (Average)</span>
                <span>90d (High Drag)</span>
              </div>
            </div>

            {/* Invoices per month */}
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Monthly Invoices Reconciled
                </label>
                <span className="font-mono font-extrabold text-sm text-[var(--text-1)]">
                  {invoicesPerMonth} / month
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={300}
                step={5}
                value={invoicesPerMonth}
                onChange={(e) => setInvoicesPerMonth(Number(e.target.value))}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-3)] mt-1">
                <span>10 inv</span>
                <span>150 inv</span>
                <span>300 inv</span>
              </div>
            </div>
          </div>

          {/* Results Column (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Primary Impact Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Working Capital Unlocked */}
              <div
                className="p-5 rounded-2xl border relative overflow-hidden transition-all"
                style={{
                  background: 'var(--card-bg)',
                  borderColor: 'var(--accent-soft)',
                  boxShadow: '0 8px 24px -8px var(--accent-glow)',
                }}
              >
                <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider block mb-1">
                  Working Capital Recovered
                </span>
                <span className="text-2xl sm:text-3xl font-black tabular-nums block" style={{ color: 'var(--accent)' }}>
                  {inr(metrics.capitalAtRisk)}
                </span>
                <span className="text-xs text-[var(--text-2)] mt-1.5 flex items-center gap-1">
                  <TrendingUp size={13} className="text-[var(--ok)]" />
                  ~{metrics.dsoReduction} days faster collection cycle
                </span>
              </div>

              {/* Annual Interest Drag Saved */}
              <div
                className="p-5 rounded-2xl border relative overflow-hidden transition-all"
                style={{
                  background: 'var(--card-bg)',
                  borderColor: 'rgba(16, 185, 129, 0.3)',
                  boxShadow: '0 8px 24px -8px rgba(16, 185, 129, 0.12)',
                }}
              >
                <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider block mb-1">
                  Annual Interest Drag Saved
                </span>
                <span className="text-2xl sm:text-3xl font-black tabular-nums block text-emerald-500">
                  {inr(metrics.interestDragSaved)}
                </span>
                <span className="text-xs text-[var(--text-2)] mt-1.5 flex items-center gap-1">
                  <Zap size={13} className="text-emerald-500" />
                  Eliminates 12% p.a. capital float cost
                </span>
              </div>
            </div>

            {/* Additional Secondary Benefits */}
            <div className="p-4 sm:p-5 rounded-2xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[11px] font-bold text-[var(--text-3)] block mb-1">
                    Finance Team Labor Reclaimed
                  </span>
                  <span className="text-lg font-extrabold text-[var(--text-1)]">
                    {metrics.hoursSavedPerYear} hrs / yr
                  </span>
                  <span className="text-[11px] text-[var(--text-3)] block mt-0.5">
                    ({metrics.hoursSavedPerMonth} hrs/mo saved on manual audits)
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-[var(--text-3)] block mb-1">
                    Statutory Tax Segregation
                  </span>
                  <span className="text-lg font-extrabold text-[var(--text-1)]">
                    100% Automated
                  </span>
                  <span className="text-[11px] text-[var(--text-3)] block mt-0.5">
                    Zero TDS/GST overstatement discrepancies
                  </span>
                </div>
              </div>

              {/* Progress Visual Bar */}
              <div className="mt-4 pt-3 border-t border-[var(--card-border)]">
                <div className="flex justify-between text-[11px] font-semibold mb-1.5">
                  <span className="text-[var(--text-3)]">Collection Velocity Efficiency</span>
                  <span className="font-mono text-emerald-500 font-bold">94.2% Operational Health</span>
                </div>
                <div className="h-2 w-full rounded-full overflow-hidden bg-slate-800">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: '94.2%',
                      background: 'linear-gradient(90deg, var(--accent), #10b981)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-3.png"
            alt="3D Analytics and Runway Architecture"
            className="max-h-[360px] w-auto object-contain rounded-lg drop-shadow-2xl"
          />
          <button
            onClick={() => setLightboxOpen(true)}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900/90 text-white border border-slate-700 hover:border-sky-400 backdrop-blur transition-all"
          >
            <Maximize2 size={13} /> Inspect High-Res
          </button>
        </div>
      )}

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
              <span className="text-xs font-bold text-slate-200">Financial Telemetry & Working Capital 3D Architecture</span>
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
                alt="Architecture Blueprint"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
