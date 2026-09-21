import { useState } from 'react'
import {
  Palette, Globe, Check, ArrowRight,
  Sliders, Shield, Layers, Activity, Sparkles
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import { inr } from './demoData'
import LoopVideo from './LoopVideo'

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
  const [activeMedia, setActiveMedia] = useState('sandbox') // 'sandbox' | 'blueprint'
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

        {/* View Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('sandbox')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'sandbox' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'sandbox' ? theme.primary : 'var(--text-3)',
              boxShadow: activeMedia === 'sandbox' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Live Themer
          </button>
          <button
            onClick={() => setActiveMedia('blueprint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'blueprint' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'blueprint' ? theme.primary : 'var(--text-3)',
              boxShadow: activeMedia === 'blueprint' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Layers size={13} />
            3D Architecture
          </button>
        </div>
      </div>

      {activeMedia === 'sandbox' ? (
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
                      className="flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer"
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
                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold outline-none"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
                  placeholder="e.g. Acme Studio"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                  Custom CNAME Domain
                </label>
                <div className="flex items-center rounded-xl overflow-hidden border"
                     style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
                  <span className="px-3 text-xs font-mono text-[var(--text-3)]">https://</span>
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="flex-1 py-2 pr-3 text-xs font-mono font-semibold bg-transparent outline-none"
                    style={{ color: 'var(--text-1)' }}
                    placeholder="billing.domain.com"
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
                  className="w-28 rounded-xl px-3 py-2 text-xs font-mono font-bold uppercase outline-none"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }}
                  placeholder="ACM-"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Live White-Labeled Client Portal Preview */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl p-5 sm:p-6 border transition-all"
                 style={{
                   background: 'var(--card-bg)',
                   borderColor: theme.border,
                   boxShadow: `0 8px 30px ${theme.dim}`,
                 }}>
              {/* Fake Browser Top Bar */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--card-border)]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: theme.primary }} />
                  <span className="font-extrabold text-sm" style={{ color: 'var(--text-1)' }}>
                    {companyName || 'Your Brand'}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold"
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
      ) : (
        /* 3D Architecture Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Architecture Specs & Highlights */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: theme.dim, color: theme.primary, border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Multi-Tenant Architecture
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                White-label proxy routing & isolated tenant stylesheets
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Client instances run on isolated subdomain ingress controllers with automated SSL certificate provisioning and CSS token injection.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  'Automated Let’s Encrypt TLS renewal',
                  'Client-scoped CSS custom properties',
                  'Custom invoice prefixes & PDF stamps',
                  'Dedicated asset CDN & logo hosting',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5" style={{ color: theme.primary }} />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Proxy Overhead</span>
                  <span className="font-extrabold text-sm" style={{ color: theme.primary }}>&lt; 15ms</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">SSL Provisioning</span>
                  <span className="font-extrabold text-sm" style={{ color: 'var(--ok)' }}>Instant SNI</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: 3D Render Loop */}
          <div className="lg:col-span-6 flex items-center justify-center">
            <div className="w-full max-w-[380px] sm:max-w-[420px] rounded-2xl overflow-hidden p-3 transition-all duration-300 relative"
                 style={{
                   background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.95))',
                   border: '1px solid rgba(255,255,255,0.1)',
                   boxShadow: `0 12px 35px ${theme.dim}`,
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
