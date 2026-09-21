import { useState, useMemo } from 'react'
import {
  Calculator, TrendingUp, Clock, ShieldAlert,
  Layers, ArrowRight, CheckCircle2, Zap, Sparkles,
  ShieldCheck, IndianRupee, Activity, HelpCircle, Sliders, Check
} from 'lucide-react'
import { inr, inrShort } from './demoData'
import LoopVideo from './LoopVideo'

const PRESETS = [
  { label: 'Boutique (₹15L)', revenue: 1500000, delay: 28, costOfCap: 12, invoices: 25 },
  { label: 'Studio (₹50L)', revenue: 5000000, delay: 38, costOfCap: 12, invoices: 65 },
  { label: 'Scale-Up (₹1.5Cr)', revenue: 15000000, delay: 45, costOfCap: 12, invoices: 140 },
  { label: 'Enterprise (₹5Cr)', revenue: 50000000, delay: 60, costOfCap: 14, invoices: 320 },
]

export default function RoiCalculator() {
  // Sliders
  const [monthlyRevenue, setMonthlyRevenue] = useState(5000000) // ₹50 Lakhs / mo
  const [daysOverdue, setDaysOverdue] = useState(38) // 38 days average delay
  const [costOfCapital, setCostOfCapital] = useState(12) // 12% p.a. cost of capital
  const [invoicesPerMonth, setInvoicesPerMonth] = useState(65) // 65 invoices / mo
  const [activePreset, setActivePreset] = useState('Studio (₹50L)')
  const [activeMedia, setActiveMedia] = useState('calculator') // 'calculator' | 'blueprint'

  // Calculations
  const metrics = useMemo(() => {
    const annualRevenue = monthlyRevenue * 12
    // Overdue capital floating in aged buckets (weighted exposure)
    const capitalAtRisk = Math.round(monthlyRevenue * (daysOverdue / 30) * 0.52)
    // Cost of capital saved per year on overdue float
    const interestDragSaved = Math.round(capitalAtRisk * (costOfCapital / 100))
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
  }, [monthlyRevenue, daysOverdue, costOfCapital, invoicesPerMonth])

  const applyPreset = (preset) => {
    setMonthlyRevenue(preset.revenue)
    setDaysOverdue(preset.delay)
    setCostOfCapital(preset.costOfCap)
    setInvoicesPerMonth(preset.invoices)
    setActivePreset(preset.label)
  }

  const scrollToSandbox = () => {
    const el = document.getElementById('try') || document.querySelector('.ft-tour')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
      window.dispatchEvent(new CustomEvent('ft-start-tour'))
    }
  }

  return (
    <div
      className="rounded-2xl p-6 sm:p-8 lg:p-10 transition-all duration-300 relative overflow-hidden"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--card-border)]">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold mb-2"
               style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
            <Calculator size={13} />
            Interactive ROI & Working Capital Simulator
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Simulate your capital recovery and interest drag savings
          </h3>
          <p className="text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Calculate the exact working capital unlocked when invoice aging, GST/TDS segregation, and follow-ups run automatically.
          </p>
        </div>

        {/* View Switcher & Presets */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex p-1 rounded-xl"
               style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
            <button
              onClick={() => setActiveMedia('calculator')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
              style={{
                background: activeMedia === 'calculator' ? 'var(--card-bg)' : 'transparent',
                color: activeMedia === 'calculator' ? 'var(--accent)' : 'var(--text-3)',
                boxShadow: activeMedia === 'calculator' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <Sliders size={13} />
              Simulator
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
              3D Capital Model
            </button>
          </div>

          {activeMedia === 'calculator' && (
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl shrink-0"
                 style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {PRESETS.map(p => {
                const on = activePreset === p.label && monthlyRevenue === p.revenue && daysOverdue === p.delay
                return (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                    style={{
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {activeMedia === 'calculator' ? (
        /* Main Dual-Pane Simulator Grid */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Interactive Parametric Controls (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Monthly Invoicing Volume Slider */}
            <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <IndianRupee size={12} className="text-[var(--accent)]" />
                  Monthly Billed Invoicing
                </label>
                <span className="font-mono font-extrabold text-sm text-[var(--accent)]">
                  {inrShort(monthlyRevenue)}
                </span>
              </div>
              <input
                type="range"
                min={500000}
                max={50000000}
                step={500000}
                value={monthlyRevenue}
                onChange={(e) => { setMonthlyRevenue(Number(e.target.value)); setActivePreset(''); }}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[9.5px] font-mono text-[var(--text-3)] mt-1">
                <span>₹5L/mo</span>
                <span>₹2.5Cr/mo</span>
                <span>₹5Cr/mo</span>
              </div>
            </div>

            {/* Payment Delay Days Slider */}
            <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <Clock size={12} className="text-[var(--warn)]" />
                  Average Payment Lag (DSO)
                </label>
                <span className="font-mono font-extrabold text-sm"
                      style={{ color: daysOverdue > 50 ? 'var(--bad)' : daysOverdue > 30 ? 'var(--warn)' : 'var(--ok)' }}>
                  {daysOverdue} days
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={90}
                step={1}
                value={daysOverdue}
                onChange={(e) => { setDaysOverdue(Number(e.target.value)); setActivePreset(''); }}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[9.5px] font-mono text-[var(--text-3)] mt-1">
                <span className="text-[var(--ok)]">10d (Fast)</span>
                <span className="text-[var(--warn)]">38d (Industry Avg)</span>
                <span className="text-[var(--bad)]">90d (Severe Drag)</span>
              </div>
            </div>

            {/* Cost of Working Capital Overdraft */}
            <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <Zap size={12} className="text-emerald-500" />
                  Credit Line / Overdraft Cost
                </label>
                <span className="font-mono font-extrabold text-sm text-[var(--text-1)]">
                  {costOfCapital}% p.a.
                </span>
              </div>
              <input
                type="range"
                min={8}
                max={20}
                step={0.5}
                value={costOfCapital}
                onChange={(e) => { setCostOfCapital(Number(e.target.value)); setActivePreset(''); }}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[9.5px] font-mono text-[var(--text-3)] mt-1">
                <span>8% Bank OD</span>
                <span>12% Standard NBFC</span>
                <span>20% High Yield</span>
              </div>
            </div>

            {/* Invoices per month */}
            <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <Activity size={12} className="text-[var(--accent)]" />
                  Invoices Processed Per Month
                </label>
                <span className="font-mono font-extrabold text-sm text-[var(--text-1)]">
                  {invoicesPerMonth} inv/mo
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={400}
                step={5}
                value={invoicesPerMonth}
                onChange={(e) => { setInvoicesPerMonth(Number(e.target.value)); setActivePreset(''); }}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[9.5px] font-mono text-[var(--text-3)] mt-1">
                <span>10 inv</span>
                <span>200 inv</span>
                <span>400 inv</span>
              </div>
            </div>
          </div>

          {/* Right Column: High-Impact ROI Visual Results (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Hero Summary Card: Capital Unlocked */}
            <div className="rounded-2xl p-6 border relative overflow-hidden"
                 style={{
                   background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(16,185,129,0.08) 100%)',
                   borderColor: 'var(--accent)',
                   boxShadow: '0 8px 32px rgba(37,99,235,0.15)',
                 }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
                  <Sparkles size={14} /> Total Working Capital Unlocked
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                  Annual Impact
                </span>
              </div>

              <div className="flex items-baseline gap-2 my-2">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-[var(--text-1)]">
                  {inr(metrics.capitalAtRisk)}
                </span>
                <span className="text-xs font-semibold text-[var(--text-2)]">
                  immediate cashflow recovery
                </span>
              </div>

              <p className="text-xs text-[var(--text-2)] leading-relaxed m-0">
                Recovered through automated invoice tracking, scheduled WhatsApp reminders, and systematic GST/TDS segregation.
              </p>
            </div>

            {/* Sub-Metrics Grid: 3 Metric Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Tile 1: Interest Drag Avoided */}
              <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Interest Drag Avoided
                </span>
                <span className="text-xl font-extrabold font-mono text-emerald-500 block">
                  {inrShort(metrics.interestDragSaved)}
                </span>
                <span className="text-[10.5px] text-[var(--text-3)] block mt-0.5">
                  Saved annually @ {costOfCapital}% APR
                </span>
              </div>

              {/* Tile 2: DSO Speedup */}
              <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Cash Velocity (DSO)
                </span>
                <span className="text-xl font-extrabold font-mono text-[var(--accent)] block">
                  -{metrics.dsoReduction} Days
                </span>
                <span className="text-[10.5px] text-[var(--text-3)] block mt-0.5">
                  Accelerated collections
                </span>
              </div>

              {/* Tile 3: Operations Labor Reclaimed */}
              <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Labor Hours Reclaimed
                </span>
                <span className="text-xl font-extrabold font-mono text-[var(--text-1)] block">
                  {metrics.hoursSavedPerYear} hrs/yr
                </span>
                <span className="text-[10.5px] text-[var(--text-3)] block mt-0.5">
                  ≈ {metrics.hoursSavedPerMonth} hrs/mo reconciliation
                </span>
              </div>
            </div>

            {/* Reconciled Tax Escrow Callout */}
            <div className="p-4 rounded-xl border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-500" />
                  Statutory GST (18%) & TDS (10%) Automated Escrow
                </span>
                <span className="text-xs font-mono font-bold text-[var(--accent)]">
                  {inrShort(Math.round(monthlyRevenue * 0.18))} GST / mo
                </span>
              </div>
              <p className="text-xs text-[var(--text-2)] m-0 leading-relaxed">
                Separated cleanly in the tax ledger so statutory obligations never deplete operational payroll reserves.
              </p>
            </div>

            {/* Action Row */}
            <div className="p-3.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="text-xs text-[var(--text-2)]">
                Want to see these exact figures computed live across our single-ledger demo?
              </div>
              <button
                onClick={scrollToSandbox}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer shrink-0 transition-all"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Launch Guided Tour <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* 3D Capital Model Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: ROI Model Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Capital Velocity Modeling
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Working capital unlock & interest drag reduction mathematics
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                By collapsing invoice aging and segregating tax liabilities at inception, agencies recover 35-45% of stalled receivables without credit line expansion.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  'DSO reduction from 45d to < 28d',
                  '12% APR overdraft interest eliminated',
                  'Automated Form 26AS TDS matching',
                  'Zero spreadsheet reconciliation drag',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Avg Capital Reclaimed</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">₹26 Lakhs</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Reconciliation ROI</span>
                  <span className="font-extrabold text-sm text-emerald-500">14.8x Payback</span>
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
                <LoopVideo src="/media/pomelli_photoshoot-5.mp4" className="w-full h-full object-cover rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
