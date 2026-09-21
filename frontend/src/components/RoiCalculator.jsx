import { useState, useMemo } from 'react'
import {
  Calculator, TrendingUp, Clock, ShieldAlert,
  Layers, ArrowRight, CheckCircle2, Zap, Sparkles,
  ShieldCheck, IndianRupee, Activity, HelpCircle, Sliders, Check, Copy, Share2
} from 'lucide-react'
import { inr, inrShort } from './demoData'

const PRESETS = [
  { label: 'Boutique', revenue: 1500000, delay: 28, costOfCap: 12, invoices: 25, tag: '₹15L/mo' },
  { label: 'Studio', revenue: 5000000, delay: 38, costOfCap: 12, invoices: 65, tag: '₹50L/mo' },
  { label: 'Scale-Up', revenue: 15000000, delay: 45, costOfCap: 13.5, invoices: 140, tag: '₹1.5Cr/mo' },
  { label: 'Enterprise', revenue: 50000000, delay: 60, costOfCap: 14, invoices: 320, tag: '₹5Cr/mo' },
]

export default function RoiCalculator() {
  // Sliders
  const [monthlyRevenue, setMonthlyRevenue] = useState(5000000) // ₹50 Lakhs / mo
  const [daysOverdue, setDaysOverdue] = useState(38) // 38 days average delay
  const [costOfCapital, setCostOfCapital] = useState(12) // 12% p.a. cost of capital
  const [invoicesPerMonth, setInvoicesPerMonth] = useState(65) // 65 invoices / mo
  const [activePreset, setActivePreset] = useState('Studio')
  const [copied, setCopied] = useState(false)

  // Calculations
  const metrics = useMemo(() => {
    const annualRevenue = monthlyRevenue * 12
    // Trapped capital floating in overdue & delayed buckets
    const capitalAtRisk = Math.round(monthlyRevenue * (daysOverdue / 30) * 0.52)
    // Cost of capital saved per year on overdue float
    const interestDragSaved = Math.round(capitalAtRisk * (costOfCapital / 100))
    // DSO reduction (typically 35-45% faster collection with automated aging bands & follow-ups)
    const dsoReduction = Math.round(daysOverdue * 0.42)
    const newDso = Math.max(14, daysOverdue - dsoReduction)
    // Manual reconciliation hours saved per month (approx 45 mins per invoice lifecycle)
    const hoursSavedPerMonth = Math.round(invoicesPerMonth * 0.75)
    const hoursSavedPerYear = hoursSavedPerMonth * 12
    const laborValueSaved = hoursSavedPerYear * 1200 // ₹1,200/hr finance operations labor benchmark
    const totalAnnualValue = interestDragSaved + laborValueSaved

    const gstEscrow = Math.round(monthlyRevenue * 0.18)
    const tdsCredit = Math.round(monthlyRevenue * 0.10)

    return {
      annualRevenue,
      capitalAtRisk,
      interestDragSaved,
      dsoReduction,
      newDso,
      hoursSavedPerMonth,
      hoursSavedPerYear,
      laborValueSaved,
      totalAnnualValue,
      gstEscrow,
      tdsCredit,
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

  const handleCopySummary = () => {
    const text = `FinTrack ROI Simulation: For ${inrShort(monthlyRevenue)}/mo turnover, FinTrack unlocks ${inr(metrics.capitalAtRisk)} in floating capital, saves ${inr(metrics.interestDragSaved)}/yr in overdraft interest (@ ${costOfCapital}% APR), and cuts DSO by ${metrics.dsoReduction} days.`
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
      {/* Header & Industry Presets */}
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

        {/* Industry Presets */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl shrink-0"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          {PRESETS.map(p => {
            const on = activePreset === p.label && monthlyRevenue === p.revenue && daysOverdue === p.delay
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
                style={{
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? '#fff' : 'var(--text-2)',
                }}
              >
                <span>{p.label}</span>
                <span className={`text-[10px] font-mono ${on ? 'opacity-90' : 'text-[var(--text-3)]'}`}>
                  {p.tag}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Dual-Pane Simulator Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive Parametric Sliders (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
              <Sliders size={13} className="text-[var(--accent)]" />
              Operational Parameters
            </span>
            <span className="text-[10.5px] text-[var(--accent)] font-semibold">
              Live Interactive
            </span>
          </div>

          {/* Monthly Invoicing Volume Slider */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                <IndianRupee size={12} className="text-[var(--accent)]" />
                Monthly Billed Turnover
              </label>
              <span className="font-mono font-extrabold text-sm text-[var(--accent)]">
                {inr(monthlyRevenue)}/mo
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
              <span>₹5L</span>
              <span>₹2.5Cr</span>
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
              <span className="text-[var(--ok)]">10d (Target)</span>
              <span className="text-[var(--warn)]">38d (Industry Avg)</span>
              <span className="text-[var(--bad)]">90d (Severe Float Drag)</span>
            </div>
          </div>

          {/* Cost of Working Capital Overdraft */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                <Zap size={12} className="text-emerald-500" />
                Overdraft / Credit Line APR
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
                {invoicesPerMonth} invoices/mo
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

        {/* Right Column: Financial Results & Waterfall Impact (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Hero Summary Card: Capital Unlocked */}
          <div className="rounded-2xl p-6 border relative overflow-hidden"
               style={{
                 background: 'linear-gradient(135deg, rgba(37,99,235,0.14) 0%, rgba(16,185,129,0.10) 100%)',
                 borderColor: 'var(--accent)',
                 boxShadow: '0 8px 32px rgba(37,99,235,0.15)',
               }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
                <Sparkles size={14} /> Total Working Capital Unlocked
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 size={11} /> Immediate Liquidity Reclaimed
              </span>
            </div>

            <div className="flex items-baseline gap-2 my-2 flex-wrap">
              <span className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-[var(--text-1)]">
                {inr(metrics.capitalAtRisk)}
              </span>
              <span className="text-xs font-semibold text-[var(--text-2)]">
                reclaimed from aging receivables
              </span>
            </div>

            {/* Before vs After Visual Float Bar */}
            <div className="mt-4 pt-3 border-t border-[var(--card-border)] space-y-2">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-[var(--text-3)]">Collection Velocity Horizon:</span>
                <span className="text-[var(--accent)] font-bold">
                  {daysOverdue}d → {metrics.newDso}d (-{metrics.dsoReduction} days)
                </span>
              </div>
              <div className="h-2.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.round((metrics.newDso / daysOverdue) * 100)}%` }}
                  title="Accelerated Collection Horizon"
                />
                <div
                  className="h-full bg-amber-500/50 transition-all duration-300"
                  style={{ width: `${Math.round((metrics.dsoReduction / daysOverdue) * 100)}%` }}
                  title="Days Eliminated with FinTrack"
                />
              </div>
              <div className="flex justify-between text-[9.5px] font-mono text-[var(--text-3)]">
                <span>FinTrack: {metrics.newDso} days</span>
                <span className="text-emerald-500 font-bold">{Math.round((metrics.dsoReduction / daysOverdue) * 100)}% Faster Cash Velocity</span>
                <span>Prior: {daysOverdue} days</span>
              </div>
            </div>
          </div>

          {/* Sub-Metrics 3-Tile Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Tile 1: Interest Drag Avoided */}
            <div className="p-4 rounded-xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Interest Drag Avoided
                </span>
                <span className="text-xl font-extrabold font-mono text-emerald-500 block">
                  {inrShort(metrics.interestDragSaved)}
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-3)] block mt-1 pt-1 border-t border-[var(--card-border)]">
                Saved annually @ {costOfCapital}% APR
              </span>
            </div>

            {/* Tile 2: DSO Speedup */}
            <div className="p-4 rounded-xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Cash Velocity (DSO)
                </span>
                <span className="text-xl font-extrabold font-mono text-[var(--accent)] block">
                  -{metrics.dsoReduction} Days
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-3)] block mt-1 pt-1 border-t border-[var(--card-border)]">
                From {daysOverdue}d down to {metrics.newDso}d
              </span>
            </div>

            {/* Tile 3: Operations Labor Reclaimed */}
            <div className="p-4 rounded-xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-3)] block mb-1">
                  Finance Hours Saved
                </span>
                <span className="text-xl font-extrabold font-mono text-[var(--text-1)] block">
                  {metrics.hoursSavedPerYear} hrs/yr
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-3)] block mt-1 pt-1 border-t border-[var(--card-border)]">
                ≈ {metrics.hoursSavedPerMonth} hrs/mo reconciliation
              </span>
            </div>
          </div>

          {/* Reconciled Tax Escrow Callout */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="flex justify-between items-center mb-1.5 flex-wrap gap-2">
              <span className="text-xs font-bold text-[var(--text-1)] flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-500" />
                Automatic Statutory GST & TDS Escrow Ring-Fencing
              </span>
              <div className="flex items-center gap-2 text-xs font-mono font-bold">
                <span className="text-[var(--accent)]">{inrShort(metrics.gstEscrow)} GST/mo</span>
                <span className="text-[var(--text-3)]">·</span>
                <span className="text-amber-500">{inrShort(metrics.tdsCredit)} TDS/mo</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-2)] m-0 leading-relaxed">
              Separated cleanly in the unified tax ledger upon invoice creation so statutory liabilities never deplete your operational payroll reserves.
            </p>
          </div>

          {/* Action Row */}
          <div className="p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3"
               style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer hover:bg-[var(--card-bg)] transition-colors"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)', color: 'var(--text-2)' }}
              >
                {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                {copied ? 'Summary Copied' : 'Copy ROI Summary'}
              </button>
            </div>

            <button
              onClick={scrollToSandbox}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all shadow-sm w-full sm:w-auto justify-center"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Test in Interactive Sandbox <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
