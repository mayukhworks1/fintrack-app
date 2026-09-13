import { useState } from 'react'
import {
  ShieldCheck, Lock, KeyRound, Zap, CheckCircle2,
  Trash2, RefreshCw, Layers, Maximize2, X, AlertTriangle,
  Fingerprint, Laptop, Smartphone, Monitor
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'

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
  const [lightboxOpen, setLightboxOpen] = useState(false)
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

        <div className="inline-flex p-1 rounded-xl shrink-0 self-start sm:self-auto"
             style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
          <button
            onClick={() => setActiveMedia('sandbox')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: activeMedia === 'sandbox' ? 'var(--card-bg)' : 'transparent',
              color: activeMedia === 'sandbox' ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            Audit Sandbox
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
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Invoice State Change
            </button>
            <button
              onClick={() => triggerEvent('permission')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Revoke Permission
            </button>
            <button
              onClick={() => triggerEvent('query')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-1)' }}
            >
              + Scoped AI SQL Run
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Audit Log Stream (8 cols) */}
            <div className="lg:col-span-8 flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)]">
                  Live Audit Telemetry Stream (SHA-256 Verified)
                </span>
                <span className="text-[11px] font-mono text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Append-Only Log Active
                </span>
              </div>

              <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-base)', borderColor: 'var(--card-border)' }}>
                <div className="divide-y divide-[var(--card-border)]">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 sm:p-3.5 flex flex-col gap-1 transition-all"
                      style={{ animation: 'ft-slide-up 240ms ease-out' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                            style={{
                              background: log.action.includes('REVOK') || log.action.includes('TERMINAT')
                                ? 'var(--bad-dim)'
                                : log.action.includes('QUERY')
                                ? 'var(--accent-dim)'
                                : 'var(--ok-dim)',
                              color: log.action.includes('REVOK') || log.action.includes('TERMINAT')
                                ? 'var(--bad)'
                                : log.action.includes('QUERY')
                                ? 'var(--accent)'
                                : 'var(--ok)',
                            }}
                          >
                            {log.action}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--text-3)]">{log.timestamp}</span>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-3)] hidden sm:inline-block">
                          {log.ip}
                        </span>
                      </div>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
                        {log.detail}
                      </p>
                      <div className="flex items-center gap-2 pt-1 text-[10px] font-mono text-[var(--text-3)]">
                        <span className="truncate">Hash: {log.hash.slice(0, 24)}...</span>
                        <span className="shrink-0 text-emerald-500 font-bold flex items-center gap-0.5">
                          ✓ Verified
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Active Sessions & Server-Side Revocation (4 cols) */}
            <div className="lg:col-span-4 flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] px-1">
                Active Server Sessions
              </span>

              <div className="space-y-2.5">
                {sessions.map((sess) => {
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
                            className="px-2 py-0.5 rounded text-[10px] font-bold border transition-all hover:bg-rose-500/10 text-rose-500 border-rose-500/30"
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
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-4.png"
            alt="3D Security and RBAC Architecture"
            className="max-h-[360px] w-auto object-contain rounded-lg drop-shadow-2xl"
          />
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
              <span className="text-xs font-bold text-slate-200">Security Architecture & Audit Verification 3D Blueprint</span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <img
                src="/media/pomelli_photoshoot-4.png"
                alt="Security Architecture Blueprint"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
