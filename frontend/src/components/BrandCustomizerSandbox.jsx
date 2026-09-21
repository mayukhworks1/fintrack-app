import { useState } from 'react'
import {
  Palette, Globe, Check, ArrowRight,
  Sliders, Shield
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import { inr } from './demoData'

const PRESETS = [
  { id: 'classic_blue', name: 'FinTrack Navy', primary: '#2563eb', dim: 'rgba(37, 99, 235, 0.12)', border: 'rgba(37, 99, 235, 0.3)' },
  { id: 'emerald',      name: 'Emerald FinOps', primary: '#059669', dim: 'rgba(5, 150, 105, 0.12)', border: 'rgba(5, 150, 105, 0.3)' },
  { id: 'violet',       name: 'Royal Violet', primary: '#7c3aed', dim: 'rgba(124, 58, 237, 0.12)', border: 'rgba(124, 58, 237, 0.3)' },
  { id: 'amber',        name: 'Warm Amber',   primary: '#d97706', dim: 'rgba(217, 119, 6, 0.12)', border: 'rgba(217, 119, 6, 0.3)' },
]

export default function BrandCustomizerSandbox() {
  const [selectedTheme, setSelectedTheme] = useState('classic_blue')
  const [companyName, setCompanyName] = useState('Acme Studio')
  const [domain, setDomain] = useState('billing.acmestudio.in')
  const [prefix, setPrefix] = useState('ACM-')
  const cardTilt = useTilt({ max: 3 })

  const theme = PRESETS.find(p => p.id === selectedTheme) ?? PRESETS[0]

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
               style={{ background: theme.dim, color: theme.primary, border: '1px solid var(--card-border)' }}>
            <Palette size={13} />
            Live White-Label & Theme Sandbox
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Your brand identity, custom domain, and invoice prefixes
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Preview white-label customer portals with your own domain, theme accents, and custom document taxonomy.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Controls Column */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Theme Presets */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider block mb-2" style={{ color: 'var(--text-3)' }}>
                1. Select Brand Palette Accent
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(p => {
                  const on = p.id === selectedTheme
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedTheme(p.id)}
                      className="flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all"
                      style={{
                        background: on ? p.dim : 'var(--bg-input)',
                        borderColor: on ? p.primary : 'var(--card-border)',
                      }}
                    >
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: p.primary }} />
                      <span className="text-xs font-bold" style={{ color: on ? p.primary : 'var(--text-2)' }}>
                        {p.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Company & Domain Customization */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                  Company Name
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
                  placeholder="e.g. Acme Corporation"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                  Custom CNAME Domain
                </label>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                     style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <Globe size={13} className="text-[var(--text-3)]" />
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full text-xs font-mono font-medium bg-transparent border-0 outline-none"
                    style={{ color: 'var(--text-1)' }}
                    placeholder="e.g. invoices.yourbrand.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                  Invoice Number Prefix
                </label>
                <input
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs font-mono font-bold"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
                  placeholder="e.g. INV- or ACM-"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Live White-Label Mockup */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[var(--text-2)]">
                Live White-Label Portal Preview
              </span>
              <span className="text-[11px] font-mono text-[var(--text-3)] flex items-center gap-1">
                <Globe size={11} style={{ color: theme.primary }} /> https://{domain}
              </span>
            </div>

            {/* Portal Mock Frame */}
            <div
              className="rounded-2xl p-5 border shadow-xl relative overflow-hidden transition-all duration-300"
              style={{
                background: 'var(--card-bg)',
                borderColor: theme.border,
                boxShadow: `0 16px 36px -12px ${theme.dim}`,
              }}
            >
              {/* Top Client Brand Bar */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs text-white shadow"
                       style={{ background: theme.primary }}>
                    {companyName ? companyName[0] : 'A'}
                  </div>
                  <span className="font-extrabold text-sm" style={{ color: 'var(--text-1)' }}>
                    {companyName || 'Your Brand'}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: theme.dim, color: theme.primary }}>
                  SSL Active · Dedicated CNAME
                </span>
              </div>

              {/* Sample Dashboard Mini-View */}
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                <div className="p-3 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                  <span className="text-[10px] text-[var(--text-3)] block font-semibold">Active Invoices</span>
                  <span className="text-base font-extrabold" style={{ color: theme.primary }}>{inr(1840000)}</span>
                </div>
                <div className="p-3 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                  <span className="text-[10px] text-[var(--text-3)] block font-semibold">Custom Tax Model</span>
                  <span className="text-base font-extrabold text-[var(--text-1)]">GST + TDS</span>
                </div>
              </div>

              {/* Sample Branded Invoice Row */}
              <div className="p-3 rounded-xl border flex items-center justify-between text-xs"
                   style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                <div>
                  <span className="font-mono font-bold" style={{ color: theme.primary }}>{prefix}2026-084</span>
                  <span className="text-[11px] text-[var(--text-3)] ml-2">Q3 Technical Retainer</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tabular-nums text-[var(--text-1)]">{inr(450000)}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: theme.dim, color: theme.primary }}>
                    Approved
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  )
}
