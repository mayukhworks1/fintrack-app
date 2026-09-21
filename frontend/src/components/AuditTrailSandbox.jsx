import { useState } from 'react'
import {
  ShieldCheck, Lock, KeyRound, Zap, CheckCircle2,
  Trash2, RefreshCw, AlertTriangle, Layers, Sliders, Activity, Check,
  Fingerprint, Laptop, Smartphone, Monitor
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

const INITIAL_LOGS = [
  {
    id: 'evt_9841',
    timestamp: '14:22:08 UTC',
    action: 'INVOICE_STATUS_CHANGE',
    actor: 'superadmin@fintrack.internal',
    detail: 'Marked ACM-2026-084 status -> Paid (₹4,50,000)',
    ip: '103.21.244.0 (Bengaluru, IN)',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    verified: true,
  },
  {
    id: 'evt_9840',
    timestamp: '14:18:32 UTC',
    action: 'ROLE_OVERRIDE_GRANT',
    actor: 'admin@acmestudio.in',
    detail: 'Granted studio.ask permission override to user_42',
    ip: '49.207.210.18 (Mumbai, IN)',
    hash: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    verified: true,
  },
  {
    id: 'evt_9839',
    timestamp: '14:02:11 UTC',
    action: 'AI_QUERY_EXECUTE',
    actor: 'analyst@fintrack.internal',
    detail: 'Executed compiled SQL: SUM(amount_raised) GROUP BY client',
    ip: '14.139.22.10 (Delhi, IN)',
    hash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    verified: true,
  },
]

const INITIAL_SESSIONS = [
  { id: 'sess_1', device: 'MacBook Pro 16"', browser: 'Chrome 128 · macOS', ip: '103.21.244.0 (Bengaluru)', active: true, current: true, icon: Laptop },
  { id: 'sess_2', device: 'iPhone 16 Pro', browser: 'Safari Mobile · iOS 18', ip: '49.207.210.18 (Mumbai)', active: true, current: false, icon: Smartphone },
  { id: 'sess_3', device: 'Dell XPS Workstation', browser: 'Firefox 130 · Linux', ip: '14.139.22.10 (Delhi)', active: true, current: false, icon: Monitor },
]

export default function AuditTrailSandbox() {
  const [logs, setLogs] = useState(INITIAL_LOGS)
  const [sessions, setSessions] = useState(INITIAL_SESSIONS)
  const [activeMedia, setActiveMedia] = useState('sandbox') // 'sandbox' | 'blueprint'
  const cardTilt = useTilt({ max: 2.5 })

  const triggerEvent = (type) => {
    const time = new Date().toISOString().split('T')[1].slice(0, 8) + ' UTC'
    const randHex = Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10)

    let newEvent = {}
    if (type === 'invoice') {
      newEvent = {
        id: `evt_${Math.floor(Math.random() * 9000 + 1000)}`,
        timestamp: time,
        action: 'INVOICE_STATUS_CHANGE',
        actor: 'finance_lead@fintrack.app',
        detail: `Updated GST ledger reconciliation for INV-${Math.floor(Math.random() * 800 + 100)}`,
        ip: '103.21.244.0 (Bengaluru, IN)',
        hash: `${randHex}7785afee48bb34ca495991b7852b855`,
        verified: true,
      }
    } else if (type === 'permission') {
      newEvent = {
        id: `evt_${Math.floor(Math.random() * 9000 + 1000)}`,
        timestamp: time,
        action: 'PERMISSION_REVOCATION',
        actor: 'superadmin@fintrack.internal',
        detail: 'Revoked publish_pages permission on user_19',
        ip: '49.207.210.18 (Mumbai, IN)',
        hash: `${randHex}8c6976e5b5410415bde908bd4dee15df`,
        verified: true,
      }
    } else if (type === 'query') {
      newEvent = {
        id: `evt_${Math.floor(Math.random() * 9000 + 1000)}`,
        timestamp: time,
        action: 'AI_QUERY_EXECUTE',
        actor: 'analyst@fintrack.internal',
        detail: 'Scoped SQL executed against mirror: SUM(gst) WHERE status = Paid',
        ip: '14.139.22.10 (Delhi, IN)',
        hash: `${randHex}e3b0c44298fc1c149afbf4c8996fb924`,
        verified: true,
      }
    }

    setLogs(prev => [newEvent, ...prev.slice(0, 5)])
  }

  const revokeSession = (id) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, active: false } : s))
    const time = new Date().toISOString().split('T')[1].slice(0, 8) + ' UTC'
    const newEvent = {
      id: `evt_${Math.floor(Math.random() * 9000 + 1000)}`,
      timestamp: time,
      action: 'SESSION_TERMINATED',
      actor: 'security_worker@fintrack.internal',
      detail: `Server-side session ${id} revoked with immediate token invalidation`,
      ip: '127.0.0.1 (Internal Gateway)',
      hash: `${Math.random().toString(16).substring(2, 12)}...98fc1c149afbf4c8`,
      verified: true,
    }
    setLogs(prev => [newEvent, ...prev.slice(0, 5)])
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
            <Fingerprint size={13} />
            Live Tamper-Proof Audit & Session Sandbox
          </div>
          <h3 className="ft-display text-xl sm:text-2xl" style={{ color: 'var(--text-1)' }}>
            Cryptographic audit trail and instant session invalidation
          </h3>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            Every state mutation is hashed, attributed to an authenticated session, and verified in real time.
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
              color: activeMedia === 'sandbox' ? 'var(--accent)' : 'var(--text-3)',
              boxShadow: activeMedia === 'sandbox' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Sliders size={13} />
            Audit Sandbox
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
            3D Security Architecture
          </button>
        </div>
      </div>

      {activeMedia === 'sandbox' ? (
        <div className="space-y-6">
          {/* Action Trigger Toolbar */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl border"
               style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)] mr-2 flex items-center gap-1">
              <Zap size={12} className="text-[var(--accent)]" /> Trigger Simulated Action:
            </span>
            <button
              onClick={() => triggerEvent('invoice')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Invoice State Change
            </button>
            <button
              onClick={() => triggerEvent('permission')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Role Override
            </button>
            <button
              onClick={() => triggerEvent('query')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Scoped AI Query
            </button>
          </div>

          {/* Dual Panel: Live Logs vs Device Sessions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Tamper-Proof Cryptographic Log Stream (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-500" /> Immutable Event Hash Chain
                </span>
                <span className="text-[10px] font-mono text-[var(--text-3)]">
                  SHA-256 Digest
                </span>
              </div>

              <div className="space-y-2">
                {logs.map(log => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl border transition-all"
                    style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-xs text-[var(--accent)]">
                        {log.action}
                      </span>
                      <span className="text-[10.5px] font-mono text-[var(--text-3)]">
                        {log.timestamp}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-[var(--text-1)] mb-2">
                      {log.detail}
                    </p>

                    <div className="flex items-center justify-between text-[10px] font-mono pt-2 border-t border-[var(--card-border)] text-[var(--text-3)]">
                      <span className="truncate max-w-[200px]">{log.actor}</span>
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 size={11} /> Hash Verified
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Active Sessions & Instant Invalidation (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] flex items-center gap-1.5">
                  <KeyRound size={13} className="text-[var(--accent)]" /> Active Sessions
                </span>
                <span className="text-[10px] text-emerald-500 font-bold">
                  Instant Revocation
                </span>
              </div>

              <div className="space-y-2.5">
                {sessions.map(sess => {
                  const Icon = sess.icon
                  return (
                    <div
                      key={sess.id}
                      className="p-3.5 rounded-2xl border flex flex-col gap-2 transition-all"
                      style={{
                        background: sess.active ? 'var(--card-bg)' : 'var(--bg-input)',
                        borderColor: sess.active ? 'var(--card-border)' : 'var(--card-border)',
                        opacity: sess.active ? 1 : 0.55,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon size={16} className={sess.active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'} />
                          <div>
                            <span className="text-xs font-bold block" style={{ color: 'var(--text-1)' }}>
                              {sess.device} {sess.current && <span className="text-[10px] text-emerald-500 font-bold">(This device)</span>}
                            </span>
                            <span className="text-[10px] text-[var(--text-3)]">{sess.browser}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-[var(--card-border)]">
                        <span className="text-[10px] font-mono text-[var(--text-3)]">{sess.ip}</span>
                        {sess.active && !sess.current ? (
                          <button
                            onClick={() => revokeSession(sess.id)}
                            className="px-2 py-0.5 rounded text-[10px] font-bold border transition-all hover:bg-rose-500/10 text-rose-500 border-rose-500/30 cursor-pointer"
                          >
                            Revoke Now
                          </button>
                        ) : sess.current ? (
                          <span className="text-[10px] text-emerald-500 font-bold">Active</span>
                        ) : (
                          <span className="text-[10px] text-rose-500 font-bold">Revoked</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* 3D Security Architecture Dual-Pane Presentation */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Audit Specs */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            <div className="mb-4">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider mb-2.5"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--card-border)' }}>
                <Activity size={12} />
                Cryptographic Audit Architecture
              </div>
              <h4 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                Immutable SHA-256 state change ledger & instant session kill switch
              </h4>
              <p className="text-xs sm:text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                Every financial update, permission modification, and AI query is chained with cryptographic hash signatures and verified in real time.
              </p>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 p-0 list-none">
                {[
                  'Cryptographic SHA-256 hash chaining',
                  'Client IP, device, and timing telemetry',
                  'Instant token revocation via Redis blacklist',
                  'Exportable SOC-2 & ISO-27001 audit logs',
                ].map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Hashing Overhead</span>
                  <span className="font-extrabold text-sm text-[var(--accent)]">&lt; 0.2ms</span>
                </div>
                <div className="rounded-xl px-3.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[10px] text-[var(--text-3)] font-medium">Session Invalidation</span>
                  <span className="font-extrabold text-sm text-rose-500">Immediate</span>
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
