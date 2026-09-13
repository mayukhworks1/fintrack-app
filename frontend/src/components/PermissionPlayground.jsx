import { useState } from 'react'
import {
  Receipt, FolderKanban, BarChart3, Landmark, FileSearch, Sparkles,
  FileText, Globe, Activity, Share2, ShieldCheck, RotateCcw, Check,
  Lock, Eye, EyeOff, Layers, Play, Maximize2, X
} from 'lucide-react'
import { useReveal } from '../hooks/useReveal'
import { inr } from './demoData'

const MODULES = [
  { key: 'receivables', label: 'Receivables', icon: Receipt },
  { key: 'projects',    label: 'Projects',    icon: FolderKanban },
  { key: 'analytics',   label: 'Analytics',   icon: BarChart3 },
  { key: 'tax',         label: 'Tax ledger',  icon: Landmark },
  { key: 'documents',   label: 'Documents',   icon: FileSearch },
  { key: 'analyst',     label: 'AI analyst',  icon: Sparkles },
  { key: 'reports',     label: 'Reports',     icon: FileText },
  { key: 'pages',       label: 'Pages',       icon: Globe },
  { key: 'status',      label: 'Status board', icon: Activity },
  { key: 'shared',      label: 'Shared links', icon: Share2 },
  { key: 'admin',       label: 'Admin & audit', icon: ShieldCheck },
]

const ROLES = [
  {
    id: 'viewer', person: 'Rhea', title: 'Client services',
    description: 'Read-only access to customer receivables and project status.',
    grants: ['receivables', 'projects', 'status', 'shared'],
    maskCost: true,
  },
  {
    id: 'analyst', person: 'Dev', title: 'Finance analyst',
    description: 'Full query access to ledger, tax compliance and period reports.',
    grants: ['receivables', 'projects', 'analytics', 'tax', 'documents', 'analyst', 'reports', 'status', 'shared'],
    maskCost: false,
  },
  {
    id: 'admin', person: 'Priya', title: 'Administrator',
    description: 'Complete workspace authority and user permission management.',
    grants: MODULES.map(m => m.key),
    maskCost: false,
  },
]

const SAMPLE_DATA = [
  { id: 'INV-2296', client: 'Meridian Labs', project: 'Site rebuild', amount: 610000, cost: 439000, status: 'Overdue' },
  { id: 'INV-2271', client: 'Ravensbourne Studio', project: 'Brand system', amount: 480000, cost: 278000, status: 'Overdue' },
  { id: 'INV-2322', client: 'Bellwether Foods', project: 'Campaign films', amount: 390000, cost: 352000, status: 'Paid' },
]

export default function PermissionPlayground() {
  const ref = useReveal({ threshold: 0.15 })
  const [roleId, setRoleId] = useState('viewer')
  const [overrides, setOverrides] = useState({})
  const [activeMedia, setActiveMedia] = useState('matrix') // 'matrix' | 'blueprint' | 'motion'
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const role = ROLES.find(r => r.id === roleId)
  const roleOverrides = overrides[roleId] ?? {}

  const allowed = (key) =>
    key in roleOverrides ? roleOverrides[key] : role.grants.includes(key)
  const isOverride = (key) =>
    key in roleOverrides && roleOverrides[key] !== role.grants.includes(key)

  const toggle = (key) =>
    setOverrides(o => ({ ...o, [roleId]: { ...(o[roleId] ?? {}), [key]: !allowed(key) } }))

  const reset = () => setOverrides(o => ({ ...o, [roleId]: {} }))

  const visibleCount = MODULES.filter(m => allowed(m.key)).length
  const overrideCount = MODULES.filter(m => isOverride(m.key)).length

  return (
    <div ref={ref} className="ft-reveal rounded-3xl overflow-hidden border transition-all"
         style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 flex-wrap border-b"
           style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--accent)]" />
          <span className="font-bold text-xs sm:text-sm" style={{ color: 'var(--text-1)' }}>
            Cryptographic RBAC & Query-Level Scoping Sandbox
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-xl"
               style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <button
              onClick={() => setActiveMedia('matrix')}
              className="px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{
                background: activeMedia === 'matrix' ? 'var(--accent-dim)' : 'transparent',
                color: activeMedia === 'matrix' ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              Matrix
            </button>
            <button
              onClick={() => setActiveMedia('blueprint')}
              className="px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{
                background: activeMedia === 'blueprint' ? 'var(--accent-dim)' : 'transparent',
                color: activeMedia === 'blueprint' ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              3D View
            </button>
            <button
              onClick={() => setActiveMedia('motion')}
              className="px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{
                background: activeMedia === 'motion' ? 'var(--accent-dim)' : 'transparent',
                color: activeMedia === 'motion' ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              Motion
            </button>
          </div>

          {overrideCount > 0 && (
            <button onClick={reset}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-2)' }}>
              <RotateCcw size={11} />
              Reset defaults
            </button>
          )}
        </div>
      </div>

      {activeMedia === 'matrix' ? (
        <div className="p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Role Selector */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              1. Select Assigned Role
            </label>
            <div className="flex flex-col gap-2">
              {ROLES.map(r => {
                const on = r.id === roleId
                return (
                  <button
                    key={r.id}
                    onClick={() => setRoleId(r.id)}
                    className="flex items-start gap-3 p-3.5 rounded-2xl text-left transition-all"
                    style={{
                      background: on ? 'var(--accent-dim)' : 'var(--bg-input)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`,
                    }}
                  >
                    <span className="flex items-center justify-center rounded-xl font-extrabold text-xs w-8 h-8 shrink-0 mt-0.5"
                          style={{
                            background: on ? 'var(--accent)' : 'var(--card-bg)',
                            color: on ? '#fff' : 'var(--text-2)',
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`,
                          }}>
                      {r.person[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs sm:text-sm" style={{ color: on ? 'var(--accent)' : 'var(--text-1)' }}>
                          {r.person}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
                          {r.title}
                        </span>
                      </div>
                      <p className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>
                        {r.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Cryptographic Query Enforcement Info */}
            <div className="rounded-2xl p-4 border mt-2"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <span className="block text-[10.5px] font-extrabold uppercase tracking-wider text-[var(--accent)] mb-1">
                Active SQL Scoping Predicate
              </span>
              <pre className="text-[10px] font-mono leading-relaxed p-2.5 rounded-lg bg-slate-950 text-slate-200 overflow-x-auto m-0">
                {`SELECT * FROM invoices_mirror\nWHERE workspace_id = $1\n  AND (role_scope <= '${roleId}' OR user_id = $2);`}
              </pre>
            </div>
          </div>

          {/* Right Column: Interactive Permission Checkbox Matrix & Live Masked Data */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  2. Granular Module Overrides ({visibleCount} of {MODULES.length} Granted)
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MODULES.map(m => {
                  const Icon = m.icon
                  const hasAccess = allowed(m.key)
                  const overridden = isOverride(m.key)
                  return (
                    <button
                      key={m.key}
                      onClick={() => toggle(m.key)}
                      className="flex items-center justify-between p-2.5 rounded-xl border text-left transition-all"
                      style={{
                        background: hasAccess ? 'var(--card-bg)' : 'var(--bg-input)',
                        borderColor: overridden ? 'var(--warn)' : hasAccess ? 'var(--accent-soft)' : 'var(--card-border)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon size={14} className={hasAccess ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'} />
                        <span className="text-xs font-semibold truncate" style={{ color: hasAccess ? 'var(--text-1)' : 'var(--text-3)' }}>
                          {m.label}
                        </span>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${hasAccess ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Live Data Visibility Preview */}
            <div className="rounded-2xl p-4 border"
                 style={{ background: 'var(--bg-input)', borderColor: 'var(--card-border)' }}>
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                  Live Mock Table View as {role.person} ({role.title})
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  {allowed('receivables') ? 'Table Accessible' : 'Access Restricted'}
                </span>
              </div>

              {allowed('receivables') ? (
                <div className="space-y-1.5">
                  {SAMPLE_DATA.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-2 rounded-lg text-xs"
                         style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                      <div>
                        <span className="font-bold text-[var(--text-1)]">{r.client}</span>
                        <span className="text-[11px] text-[var(--text-3)] ml-2">{r.id}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold tabular-nums text-[var(--text-1)]">{inr(r.amount)}</span>
                        {allowed('projects') && !role.maskCost ? (
                          <span className="text-[10px] text-emerald-500 font-semibold tabular-nums">Margin {Math.round(((r.amount - r.cost)/r.amount)*100)}%</span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-[var(--text-3)] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            <Lock size={9} /> Cost Masked
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-xs font-medium text-[var(--text-3)] bg-slate-100 dark:bg-slate-900 rounded-xl">
                  <Lock size={20} className="mx-auto mb-2 opacity-50" />
                  Access to financial ledger is locked for this role.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : activeMedia === 'blueprint' ? (
        <div className="relative rounded-2xl overflow-hidden p-6 bg-slate-950 flex flex-col items-center justify-center min-h-[380px]">
          <img
            src="/media/pomelli_photoshoot-4.png"
            alt="3D Security Architecture"
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
            src="/media/pomelli_photoshoot-7.mp4"
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
              <span className="text-xs font-bold text-slate-200">Security Architecture & RBAC 3D Blueprint</span>
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
                alt="Security Architecture"
                className="max-h-[78vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
