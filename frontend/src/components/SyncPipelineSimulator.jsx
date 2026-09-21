import { useState } from 'react'
import {
  Database, RefreshCw, ArrowRight, Zap, CheckCircle2,
  Server, ShieldCheck, Code2, Play, Layers, Sliders, Activity, Check
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

        {/* View Switcher */}
        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('simulator')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            style={{
              background: activeMedia === 'simulator' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'simulator' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'simulator' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Pipeline Simulator
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
            3D Pipeline Flow
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
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
                style={{
                  background: activeIdx === i ? 'var(--accent)' : 'var(--card-bg)',
                  borderColor: activeIdx === i ? 'var(--accent)' : 'var(--card-border)',
                  color: activeIdx === i ? '#fff' : 'var(--text-2)',
                }}
              >
                {p.event} ({p.record})
              </button>
            ))}
          </div>

          {/* 3-Stage Pipeline Diagram */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            {/* Stage 1: Ingest */}
            <div className="p-5 rounded-2xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-3)]">
                    Step 1 · Source Event
                  </span>
                  <Database size={16} className="text-[var(--accent)]" />
                </div>
                <h4 className="font-bold text-sm text-[var(--text-1)] mb-1">
                  Webhook Ingestion
                </h4>
                <p className="text-xs text-[var(--text-2)] mb-3">
                  Changes received from primary data source or native CRM base.
                </p>
              </div>
              <div className="p-2 rounded-xl border text-[11px] font-mono bg-[var(--card-bg)] border-[var(--card-border)] flex items-center justify-between">
                <span className="text-[var(--text-3)]">Payload ID:</span>
                <span className="text-[var(--accent)] font-bold">{pkt.id}</span>
              </div>
            </div>

            {/* Stage 2: Transform & Validate */}
            <div className="p-5 rounded-2xl border flex flex-col justify-between"
                 style={{
                   background: isSyncing ? 'var(--accent-dim)' : 'var(--bg-input)',
                   borderColor: isSyncing ? 'var(--accent)' : 'var(--card-border)',
                   transition: 'all 300ms ease',
                 }}>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-3)]">
                    Step 2 · Transform & Scoping
                  </span>
                  <Zap size={16} className={isSyncing ? 'text-[var(--accent)] animate-pulse' : 'text-amber-500'} />
                </div>
                <h4 className="font-bold text-sm text-[var(--text-1)] mb-1">
                  Schema Mirroring
                </h4>
                <p className="text-xs text-[var(--text-2)] mb-3">
                  Normalizes payloads into strongly-typed relational tuples.
                </p>
              </div>
              <div className="p-2 rounded-xl border text-[11px] font-mono bg-[var(--card-bg)] border-[var(--card-border)] flex items-center justify-between">
                <span className="text-[var(--text-3)]">Transit Latency:</span>
                <span className="text-emerald-500 font-bold">{pkt.latency}</span>
              </div>
            </div>

            {/* Stage 3: Local Postgres Mirror */}
            <div className="p-5 rounded-2xl border flex flex-col justify-between"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-3)]">
                    Step 3 · Local Postgres
                  </span>
                  <Server size={16} className="text-emerald-500" />
                </div>
                <h4 className="font-bold text-sm text-[var(--text-1)] mb-1">
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
            <pre className="p-3 rounded-xl bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto border border-slate-800 m-0">
              <code>{pkt.sql}</code>
            </pre>
          </div>
        </div>
      ) : (
        /* 3D Telemetry Flow Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Pipeline Architecture Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Real-Time Ingestion Architecture
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Zero-migration read replica with sub-12ms sync telemetry
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Your source tables and records stay pristine. Incremental CDC events sync to an encrypted local Postgres read-replica in milliseconds.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  'Zero data migration or schema mutation',
                  'Sub-12ms incremental replication latency',
                  'Row-level transactional consistency',
                  'Dead-letter retry queues with automatic fallback',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Replication Lag</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">&lt; 12ms</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Data Integrity</span>
                  <span className="font-extrabold text-sm text-emerald-500">100% ACID</span>
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
                <LoopVideo src="/media/pomelli_photoshoot-7.mp4" className="w-full h-full object-cover rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
