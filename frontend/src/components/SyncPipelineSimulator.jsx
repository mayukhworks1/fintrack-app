import { useState } from 'react'
import {
  Database, RefreshCw, ArrowRight, Zap, CheckCircle2,
  Server, ShieldCheck, Layers, Maximize2, X, Play, Code2
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

const SAMPLE_PAYLOADS = [
  {
    id: 'pkt_1',
    event: 'invoices.updated',
    record: 'INV-2026-084',
    client: 'Acme Studio',
    amount: '₹4,50,000',
    field: 'payment_status -> Paid',
    sql: 'UPDATE invoices_mirror SET payment_status = $1, paid_on = $2 WHERE id = $3 RETURNING id;',
    latency: '8.4ms',
  },
  {
    id: 'pkt_2',
    event: 'projects.margin_recalc',
    record: 'PROJ-BRAND-09',
    client: 'Starlight Media',
    amount: '₹12,80,000',
    field: 'actual_cost -> ₹7,20,000',
    sql: 'SELECT p.id, p.billed, p.cost, ROUND(((p.billed - p.cost)::numeric / p.billed) * 100) AS margin FROM projects_mirror p WHERE p.id = $1;',
    latency: '11.2ms',
  },
  {
    id: 'pkt_3',
    event: 'tax.tds_withheld',
    record: 'INV-2026-091',
    client: 'Nexus Global',
    amount: '₹8,90,000',
    field: 'tds_rate -> 10% (194J)',
    sql: 'SELECT gross_amount, (gross_amount * 0.18) AS gst, (gross_amount * 0.10) AS tds_withheld FROM invoices_mirror WHERE id = $1;',
    latency: '6.9ms',
  },
]

export default function SyncPipelineSimulator() {
  const [activeIdx, setActiveIdx] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [activeMedia, setActiveMedia] = useState('simulator') // 'simulator' | 'blueprint'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const cardTilt = useTilt({ max: 2.5 })

  const pkt = SAMPLE_PAYLOADS[activeIdx]

  const triggerSync = (idx) => {
    setActiveIdx(idx)
    setIsSyncing(true)
    setTimeout(() => {
      setIsSyncing(false)
    }, 600)
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
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
            Zero-Migration Realtime Pipeline Telemetry
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            How records sync from your source to Postgres and SQL
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Your primary base stays untouched. Changes propagate into the local mirror in under 12ms.
          </p>
        </div>

        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('simulator')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'simulator' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'simulator' ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            Pipeline Simulator
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

      {activeMedia === 'simulator' ? (
        <div className="space-y-6">
          {/* Sample Packet Selector */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl border"
               style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)] mr-2 flex items-center gap-1">
              <Play size={12} className="text-[var(--accent)]" /> Fire Sample Ingest Event:
            </span>
            {SAMPLE_PAYLOADS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => triggerSync(i)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                style={{
                  background: activeIdx === i ? 'var(--accent)' : 'var(--card-bg)',
                  borderColor: activeIdx === i ? 'var(--accent)' : 'var(--card-border)',
                  color: activeIdx === i ? '#fff' : 'var(--text-2)',
                  cursor: 'pointer',
                }}
              >
                {p.event} ({p.record})
              </button>
            ))}
          </div>

          {/* Pipeline Visual Flow */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            {/* Stage 1: Source Base */}
            <div className="p-4 rounded-2xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider">
                    Stage 1 · Source Base
                  </span>
                  <Server size={14} className="text-[var(--accent)]" />
                </div>
                <h4 className="font-extrabold text-sm mb-1 text-[var(--text-1)]">
                  System of Record
                </h4>
                <p className="text-xs text-[var(--text-2)] mb-3">
                  Airtable / CSV / Custom ERP stays the unmutated source of truth.
                </p>
              </div>
              <div className="p-2 rounded-xl border text-[11px] font-mono bg-[var(--card-bg)] border-[var(--card-border)]">
                <span className="text-[var(--text-3)] block">Record: {pkt.record}</span>
                <span className="text-emerald-500 font-bold block">{pkt.field}</span>
              </div>
            </div>

            {/* Stage 2: Postgres Mirror CDC */}
            <div className="p-4 rounded-2xl border flex flex-col justify-between"
                 style={{
                   background: isSyncing ? 'var(--accent-dim)' : 'var(--bg-input)',
                   borderColor: isSyncing ? 'var(--accent)' : 'var(--card-border)',
                   transition: 'all 300ms ease',
                 }}>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider">
                    Stage 2 · Mirror Worker
                  </span>
                  <Database size={14} className="text-[var(--accent)]" />
                </div>
                <h4 className="font-extrabold text-sm mb-1 text-[var(--text-1)]">
                  CDC Ingest Worker
                </h4>
                <p className="text-xs text-[var(--text-2)] mb-3">
                  Microsecond delta ingest with automatic schema sanitization.
                </p>
              </div>
              <div className="p-2 rounded-xl border text-[11px] font-mono bg-[var(--card-bg)] border-[var(--card-border)] flex items-center justify-between">
                <span className="text-[var(--text-3)]">Sync Latency:</span>
                <span className="text-emerald-500 font-bold flex items-center gap-1">
                  <Zap size={11} /> {pkt.latency}
                </span>
              </div>
            </div>

            {/* Stage 3: Deterministic SQL Execution */}
            <div className="p-4 rounded-2xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider">
                    Stage 3 · Query Engine
                  </span>
                  <ShieldCheck size={14} className="text-[var(--ok)]" />
                </div>
                <h4 className="font-extrabold text-sm mb-1 text-[var(--text-1)]">
                  Deterministic SQL
                </h4>
                <p className="text-xs text-[var(--text-2)] mb-3">
                  Session scope injected before compile. Model never writes freeform SQL.
                </p>
              </div>
              <div className="p-2 rounded-xl border text-[11px] font-mono bg-[var(--card-bg)] border-[var(--card-border)] flex items-center justify-between">
                <span className="text-[var(--text-3)]">Audit Status:</span>
                <span className="text-emerald-500 font-bold">100% Attributed</span>
              </div>
            </div>
          </div>

          {/* Compiled SQL Inspector */}
          <div className="p-4 rounded-2xl border" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                <Code2 size={13} className="text-[var(--accent)]" /> Compiled Parameterized SQL Statement
              </span>
              <span className="text-[10px] font-mono text-[var(--text-3)]">
                Target: invoices_mirror (Read-Replica)
              </span>
            </div>
            <pre className="p-3 rounded-xl bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto border border-slate-800">
              <code>{pkt.sql}</code>
            </pre>
          </div>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <LoopVideo src="/media/pomelli_photoshoot-7.mp4" className="max-h-[360px] w-auto object-contain rounded-lg drop-shadow-2xl" />
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
              <span className="text-xs font-bold text-slate-200">Zero-Migration Pipeline & Database Sync Motion Loop</span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <LoopVideo src="/media/pomelli_photoshoot-7.mp4" className="max-h-[78vh] object-contain rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
