import { useState } from 'react'
import { Landmark, ArrowRight, ShieldCheck, RefreshCw, Layers, Sliders, Activity, Check } from 'lucide-react'
import { inr, inrShort } from './demoData'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

export default function TaxFlowSimulator() {
  const [billed, setBilled] = useState(2500000) // ₹25 Lakhs
  const [gstRate, setGstRate] = useState(0.18)   // 18%
  const [tdsRate, setTdsRate] = useState(0.10)   // 10%
  const [clientType, setClientType] = useState('domestic_tech') // domestic_tech | contractor | sez_export
  const [activeMedia, setActiveMedia] = useState('flow') // 'flow' | 'blueprint'
  const cardTilt = useTilt({ max: 3 })

  const gstAmount = Math.round(billed * gstRate)
  const invoicedTotal = billed + gstAmount
  const tdsAmount = Math.round(billed * tdsRate)
  const bankReceived = invoicedTotal - tdsAmount
  const safeReserve = billed - Math.round(billed * 0.45) // simulated project burn 45%

  const handleClientType = (type) => {
    setClientType(type)
    if (type === 'domestic_tech') {
      setGstRate(0.18)
      setTdsRate(0.10)
    } else if (type === 'contractor') {
      setGstRate(0.18)
      setTdsRate(0.02)
    } else if (type === 'sez_export') {
      setGstRate(0.00)
      setTdsRate(0.00)
    }
  }

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
            <Landmark size={13} />
            Real-Time Working Capital & Tax Engine
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Simulate monthly cashflow vs statutory escrow
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Adjust billing volume and tax categories to watch cash, GST liabilities, and Form 26AS TDS credits segregate dynamically.
          </p>
        </div>

        {/* View Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('flow')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'flow' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'flow' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'flow' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Interactive Flow
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
            3D Architecture
          </button>
        </div>
      </div>

      {activeMedia === 'flow' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Controls Column */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* Client Mix Presets */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                Client Billing Category
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'domestic_tech', label: 'Tech & Services', sub: '18% GST · 10% TDS' },
                  { id: 'contractor',    label: 'Works / Vendor',  sub: '18% GST · 2% TDS' },
                  { id: 'sez_export',    label: 'SEZ / Export',    sub: '0% Zero-Rated' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleClientType(p.id)}
                    className="p-2.5 rounded-xl text-left transition-all cursor-pointer"
                    style={{
                      background: clientType === p.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                      border: `1px solid ${clientType === p.id ? 'var(--accent)' : 'var(--card-border)'}`,
                      color: clientType === p.id ? 'var(--accent)' : 'var(--text-2)',
                    }}
                  >
                    <div className="font-bold text-xs">{p.label}</div>
                    <div className="text-[10px] mt-0.5 opacity-80">{p.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Monthly Billed Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Monthly Billed (Pre-Tax)
                </label>
                <span className="font-extrabold text-sm tabular-nums" style={{ color: 'var(--accent)' }}>
                  {inr(billed)}
                </span>
              </div>
              <input
                type="range"
                min={500000}
                max={10000000}
                step={250000}
                value={billed}
                onChange={(e) => setBilled(Number(e.target.value))}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono mt-1" style={{ color: 'var(--text-3)' }}>
                <span>₹5 Lakhs</span>
                <span>₹50 Lakhs</span>
                <span>₹1 Crore</span>
              </div>
            </div>

            {/* Statutory Parameters Readout */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block" style={{ color: 'var(--text-3)' }}>
                  Gross Invoiced (With GST)
                </span>
                <span className="font-extrabold text-sm tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {inr(invoicedTotal)}
                </span>
              </div>
              <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block" style={{ color: 'var(--text-3)' }}>
                  TDS Withheld (194J)
                </span>
                <span className="font-extrabold text-sm tabular-nums text-amber-500">
                  {inr(tdsAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Visualization Column */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {/* Live Allocation Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Card 1: Bank Cash */}
              <div className="rounded-2xl p-4 border"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--accent-soft)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-[var(--accent)]">
                  1. Net Cash to Bank
                </span>
                <span className="text-xl font-extrabold my-1 block tabular-nums text-[var(--text-1)]">
                  {inrShort(bankReceived)}
                </span>
                <span className="text-[10.5px] text-[var(--text-3)]">
                  Post-TDS Net Inflow
                </span>
              </div>

              {/* Card 2: GST Escrow */}
              <div className="rounded-2xl p-4 border"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-rose-500">
                  2. GST Escrow (Liabilities)
                </span>
                <span className="text-xl font-extrabold my-1 block tabular-nums text-rose-500">
                  {inrShort(gstAmount)}
                </span>
                <span className="text-[10.5px] text-[var(--text-3)]">
                  Reserved for 20th Filing
                </span>
              </div>

              {/* Card 3: Safe Runway */}
              <div className="rounded-2xl p-4 border"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--ok-dim)' }}>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-emerald-500">
                  3. Safe Spendable Capital
                </span>
                <span className="text-xl font-extrabold my-1 block tabular-nums text-emerald-500">
                  {inrShort(safeReserve)}
                </span>
                <span className="text-[10.5px] text-[var(--accent)]">
                  Net usable liquidity
                </span>
              </div>
            </div>

            {/* Kinetic Progress / Segregation Flow */}
            <div className="rounded-2xl p-4 sm:p-5 border"
                 style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between text-xs font-bold mb-2" style={{ color: 'var(--text-2)' }}>
                <span>Real-Time Capital Split Breakdown</span>
                <span style={{ color: 'var(--accent)' }}>100% Reconciled</span>
              </div>

              {/* Stacked Multi-Bar Visual */}
              <div className="w-full h-7 rounded-xl overflow-hidden flex gap-0.5 bg-slate-200 dark:bg-slate-800 p-0.5">
                <div
                  style={{
                    width: `${(bankReceived / invoicedTotal) * 100}%`,
                    background: 'linear-gradient(90deg, #2563eb, #38bdf8)',
                    transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                  className="h-full rounded-l-lg flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                  title={`Net Cash: ${inr(bankReceived)}`}
                >
                  Bank ({Math.round((bankReceived / invoicedTotal) * 100)}%)
                </div>
                {gstAmount > 0 && (
                  <div
                    style={{
                      width: `${(gstAmount / invoicedTotal) * 100}%`,
                      background: '#ef4444',
                      transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                    className="h-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                    title={`GST Escrow: ${inr(gstAmount)}`}
                  >
                    GST ({Math.round((gstAmount / invoicedTotal) * 100)}%)
                  </div>
                )}
                {tdsAmount > 0 && (
                  <div
                    style={{
                      width: `${(tdsAmount / invoicedTotal) * 100}%`,
                      background: '#f59e0b',
                      transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                    className="h-full rounded-r-lg flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                    title={`TDS Credit: ${inr(tdsAmount)}`}
                  >
                    TDS
                  </div>
                )}
              </div>

              {/* Legend Badges */}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                  <span>Net Cash in Bank ({inrShort(bankReceived)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span>GST Liability ({inrShort(gstAmount)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>TDS 26AS Asset ({inrShort(tdsAmount)})</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* 3D Tax Architecture Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Tax Engine Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Tax Ledger Engine
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Automated statutory tax escrow & real-time 26AS reconciliation
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Keeps collected GST liabilities isolated from operating balances, and tracks Form 26AS TDS withholding automatically.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  '18% CGST/SGST split automation',
                  'Section 194J/194C TDS certificate audit',
                  'Filing schedule alerts for 20th of month',
                  'Zero mixing of tax float with OPEX',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Reconciliation</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">100% Automated</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Tax Drift</span>
                  <span className="font-extrabold text-sm text-emerald-500">₹0.00</span>
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
