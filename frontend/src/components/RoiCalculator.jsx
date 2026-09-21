import { useState, useMemo } from 'react'
import {
  Calculator, TrendingUp, Clock, ShieldAlert,
  Layers, ArrowRight, CheckCircle2, Zap, Sparkles,
  ShieldCheck, IndianRupee, Activity, HelpCircle,
} from 'lucide-react'
import { inr, inrShort } from './demoData'

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
    const el = document.getElementById('sandbox') || document.querySelector('.ft-tour')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

        {/* Quick Scale Presets */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl shrink-0"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)] px-2 py-1">
            Presets:
          </span>
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
      </div>

      {/* Main Dual-Pane Simulator Grid */}
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
                Monthly Invoices Reconciled
              </label>
              <span className="font-mono font-extrabold text-sm text-[var(--text-1)]">
                {invoicesPerMonth} / month
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
              <span>10 invoices</span>
              <span>150 invoices</span>
              <span>400 invoices</span>
            </div>
          </div>
        </div>

        {/* Right Column: High-Fidelity Results & Unlocked Capital (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Primary Impact Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Working Capital Unlocked */}
            <div
              className="p-5 rounded-xl border relative overflow-hidden transition-all flex flex-col justify-between"
              style={{
                background: 'var(--card-bg)',
                borderColor: 'var(--accent-soft)',
                boxShadow: '0 8px 24px -8px var(--accent-glow)',
              }}
            >
              <div>
                <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider block mb-1">
                  Working Capital Recovered
                </span>
                <span className="text-2xl sm:text-3xl font-black tabular-nums block" style={{ color: 'var(--accent)' }}>
                  {inr(metrics.capitalAtRisk)}
                </span>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[var(--card-border)] flex items-center justify-between text-xs text-[var(--text-2)]">
                <span className="flex items-center gap-1">
                  <TrendingUp size={13} className="text-[var(--ok)]" />
                  Faster Settlement
                </span>
                <span className="font-bold text-[var(--ok)]">~{metrics.dsoReduction} days earlier</span>
              </div>
            </div>

            {/* Annual Interest Drag Saved */}
            <div
              className="p-5 rounded-xl border relative overflow-hidden transition-all flex flex-col justify-between"
              style={{
                background: 'var(--card-bg)',
                borderColor: 'rgba(16, 185, 129, 0.3)',
                boxShadow: '0 8px 24px -8px rgba(16, 185, 129, 0.12)',
              }}
            >
              <div>
                <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider block mb-1">
                  Annual Interest Drag Saved
                </span>
                <span className="text-2xl sm:text-3xl font-black tabular-nums block text-emerald-500">
                  {inr(metrics.interestDragSaved)}
                </span>
              </div>
              <div className="mt-3 pt-2.5 border-t border-[var(--card-border)] flex items-center justify-between text-xs text-[var(--text-2)]">
                <span className="flex items-center gap-1">
                  <Zap size={13} className="text-emerald-500" />
                  Capital Cost Eliminated
                </span>
                <span className="font-bold text-emerald-500">@{costOfCapital}% p.a.</span>
              </div>
            </div>
          </div>

          {/* Operational Labor & Compliance Secondary Yields */}
          <div className="p-4 sm:p-5 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase text-[var(--text-3)] block mb-1">
                  Finance Team Labor Reclaimed
                </span>
                <span className="text-lg font-extrabold text-[var(--text-1)] block">
                  {metrics.hoursSavedPerYear} hrs / year
                </span>
                <span className="text-[11px] text-[var(--text-2)] block mt-0.5">
                  ({metrics.hoursSavedPerMonth} hrs/mo saved on collections & manual follow-ups)
                </span>
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase text-[var(--text-3)] block mb-1">
                  Statutory Escrow & 26AS Matching
                </span>
                <span className="text-lg font-extrabold text-[var(--ok)] flex items-center gap-1">
                  <ShieldCheck size={18} /> 100% Automated
                </span>
                <span className="text-[11px] text-[var(--text-2)] block mt-0.5">
                  Eliminates TDS withholding leakage and GST quarterly shortfalls
                </span>
              </div>
            </div>

            {/* Visual Capital Unlock Allocation Bridge */}
            <div className="mt-4 pt-3.5 border-t border-[var(--card-border)]">
              <div className="flex justify-between text-[11px] font-semibold mb-2">
                <span className="text-[var(--text-3)]">Capital Recovery Efficiency Breakdown</span>
                <span className="font-mono text-emerald-500 font-bold">96.4% Reclaimed</span>
              </div>
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-800">
                <div className="h-full bg-[var(--accent)]" style={{ width: '68%' }} title="Immediate Cash Flow Recovery" />
                <div className="h-full bg-emerald-500" style={{ width: '20%' }} title="Interest Drag Eliminated" />
                <div className="h-full bg-amber-400" style={{ width: '12%' }} title="Audit Labor Savings" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[10px] text-[var(--text-3)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)]" /> Cash Inflow Unlocked (68%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Capital Drag Avoided (20%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> Audit Hours Reclaimed (12%)
                </span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="p-3.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3"
               style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="text-xs text-[var(--text-2)]">
              Want to see these exact figures computed live across our single-ledger demo?
            </div>
            <button
              onClick={scrollToSandbox}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer shrink-0 transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Explore Sandbox Live <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
