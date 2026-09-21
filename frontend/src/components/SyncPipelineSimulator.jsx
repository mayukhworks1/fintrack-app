import { useState } from 'react'
import {
  Database, RefreshCw, ArrowRight, Zap, CheckCircle2,
  Server, ShieldCheck, Code2, Play
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'

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
      </div>

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
    </div>
  )
}
