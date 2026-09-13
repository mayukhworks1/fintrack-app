import { useState } from 'react'
import { Landmark, ArrowRight, ShieldCheck, Sparkles, RefreshCw, Layers, Play, Pause, Maximize2, X } from 'lucide-react'
import { inr, inrShort } from './demoData'
import { useTilt } from '../hooks/useTilt'

export default function TaxFlowSimulator() {
  const [billed, setBilled] = useState(2500000) // ₹25 Lakhs
  const [gstRate, setGstRate] = useState(0.18)   // 18%
  const [tdsRate, setTdsRate] = useState(0.10)   // 10%
  const [clientType, setClientType] = useState('domestic_tech') // domestic_tech | contractor | sez_export
  const [activeMedia, setActiveMedia] = useState('flow') // 'flow' | 'blueprint' | 'motion'
  const [lightboxOpen, setLightboxOpen] = useState(false)
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
            <Sparkles size={13} />
            Real-Time Working Capital & Tax Engine
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Simulate monthly cashflow vs statutory escrow
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Adjust billing volume and tax categories to watch cash, GST liabilities, and Form 26AS TDS credits segregate dynamically.
          </p>
        </div>

        {/* Media Perspective Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('flow')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'flow' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'flow' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'flow' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            Interactive Flow
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
            3D Ledger
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
                    className="p-2.5 rounded-xl text-left transition-all"
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
                min="500000"
                max="10000000"
                step="250000"
                value={billed}
                onChange={(e) => setBilled(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                style={{ background: 'var(--bg-input)' }}
              />
              <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                <span>₹5 Lakhs</span>
                <span>₹50 Lakhs</span>
                <span>₹1.0 Crore</span>
              </div>
            </div>

            {/* Statutory Key Rules */}
            <div className="rounded-xl p-3.5 flex flex-col gap-2"
                 style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <ShieldCheck size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span>
                  <strong>GST Escrow:</strong> ₹{inr(gstAmount)} must be remitted by the 20th. Never mix with working capital.
                </span>
              </div>
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <Landmark size={15} className="text-sky-500 shrink-0 mt-0.5" />
                <span>
                  <strong>TDS Form 26AS:</strong> ₹{inr(tdsAmount)} withheld by client. Matched automatically in FinTrack tax ledger.
                </span>
              </div>
            </div>
          </div>

          {/* Visual Dynamic Flow Canvas */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Card 1: Gross Invoiced */}
              <div className="rounded-2xl p-4 flex flex-col justify-between border"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <span className="text-[11px] font-bold text-[var(--text-3)] uppercase">Gross Invoiced</span>
                <span className="text-xl font-extrabold my-2 text-[var(--text-1)] tabular-nums">
                  {inr(invoicedTotal)}
                </span>
                <span className="text-[10.5px] text-[var(--text-3)]">
                  Billed + {Math.round(gstRate * 100)}% GST
                </span>
              </div>

              {/* Card 2: Tax Escrow Hold */}
              <div className="rounded-2xl p-4 flex flex-col justify-between border"
                   style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                <span className="text-[11px] font-bold text-red-500 uppercase">GST State Escrow</span>
                <span className="text-xl font-extrabold my-2 text-red-500 tabular-nums">
                  − {inr(gstAmount)}
                </span>
                <span className="text-[10.5px] text-red-500/80">
                  Must remit before filing
                </span>
              </div>

              {/* Card 3: Net Operating Cash */}
              <div className="rounded-2xl p-4 flex flex-col justify-between border"
                   style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent-soft)' }}>
                <span className="text-[11px] font-bold text-[var(--accent)] uppercase">Lands In Bank</span>
                <span className="text-xl font-extrabold my-2 text-[var(--accent)] tabular-nums">
                  {inr(bankReceived)}
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
      ) : activeMedia === 'blueprint' ? (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-1.png"
            alt="3D Single-Ledger Blueprint"
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
            src="/media/pomelli_photoshoot-5.mp4"
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
              <span className="text-xs font-bold text-slate-200">Tax Ledger & Working Capital 3D Architecture</span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <img
                src="/media/pomelli_photoshoot-1.png"
                alt="Tax Architecture"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
