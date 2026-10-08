/**
 * Admin Dashboard — full PostgreSQL visibility  (v2.3)
 *
 * Modes:
 *   embedded={false}  Full-screen standalone — shown when role === 'admin' logs in
 *   embedded={true}   Inside Layout sidebar  — shown at /admin for role === 'editor'
 *
 * Tabs:
 *   Overview   — live counts, error rates, sync status
 *   Audit Log  — every API request: role/IP/geo/OS/browser/referer/size
 *   Sessions   — login sessions (active-only toggle)
 *   AI Chats   — conversation sessions + messages
 *   Sync Log   — Teable ↔ PostgreSQL sync history
 *   Projects   — PostgreSQL projects mirror
 *   Invoices   — all invoices: main + web (source filter)
 *   History    — field-level change log
 */

import { useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, ScrollText, Users, MessageSquareText, RefreshCw, Database, FileText, LogOut, Activity, History, ShieldAlert, ShieldCheck, Zap, BarChart2, Link2, Terminal, ServerCrash
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AiRunsTab } from './admin/AiRunsTab'
import { AuditLogTab } from './admin/AuditLogTab'
import { AuthUsersTab } from './admin/AuthUsersTab'
import { ChatsTab } from './admin/ChatsTab'
import { DeploymentHealthTab } from './admin/DeploymentHealthTab'
import { HfLogsTab } from './admin/HfLogsTab'
import { HistoryTab } from './admin/HistoryTab'
import { InsightsTab } from './admin/InsightsTab'
import { InvoicesTab } from './admin/InvoicesTab'
import { OverviewTab } from './admin/OverviewTab'
import { PermissionsTab } from './admin/PermissionsTab'
import { ProjectsMirrorTab } from './admin/ProjectsMirrorTab'
import { SessionsTab } from './admin/SessionsTab'
import { SharedLinksTab } from './admin/SharedLinksTab'
import { SyncLogTab } from './admin/SyncLogTab'
import { SubTabBar } from './admin/ui'

const TABS = [
  { id: 'overview',  label: 'Overview',        icon: LayoutDashboard  },
  { id: 'requests',  label: 'Requests',         icon: ScrollText       },
  { id: 'users',       label: 'Users & Sessions', icon: ShieldAlert   },
  { id: 'permissions', label: 'Permissions',      icon: ShieldCheck   },
  { id: 'ai',          label: 'AI',               icon: MessageSquareText},
  { id: 'insights',    label: 'Insights',         icon: BarChart2     },
  { id: 'sync',        label: 'Sync',             icon: RefreshCw     },
  { id: 'projects',    label: 'Projects',         icon: Database      },
  { id: 'invoices',    label: 'Invoices',         icon: FileText      },
  { id: 'history',     label: 'History',          icon: History       },
  { id: 'shared',      label: 'Shared',           icon: Link2         },
  { id: 'hflogs',      label: 'HF Logs',          icon: Terminal      },
  { id: 'deploy',      label: 'System Health',    icon: ServerCrash   },
]

// Sub-tabs for composite tabs
const SUB_TABS = {
  users: [
    { id: 'auth-users', label: 'Users',    icon: ShieldAlert },
    { id: 'sessions',   label: 'Sessions', icon: Users       },
  ],
  ai: [
    { id: 'chats',   label: 'Chats', icon: MessageSquareText },
    { id: 'ai-runs', label: 'Runs',  icon: Zap               },
  ],
}

// Map old tab ids to new for backwards compat with stored URLs
const TAB_ALIAS = {
  'audit': 'requests', 'audit-log': 'requests',
  'auth-users': 'users', 'sessions': 'users',
  'chats': 'ai', 'ai-runs': 'ai',
}

export default function AdminDashboard({ embedded = false }) {
  const { logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const validTabIds = TABS.map(t => t.id)
  const rawTab = searchParams.get('tab') || 'overview'
  // Resolve aliases (old URLs still work)
  const activeTab = validTabIds.includes(rawTab) ? rawTab : (TAB_ALIAS[rawTab] ? TAB_ALIAS[rawTab] : 'overview')
  // Sub-tab state: stored in ?sub= param
  const rawSub  = searchParams.get('sub') || ''
  const activeSub = rawSub || ''

  const setTab = useCallback((id, sub) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', id)
      if (sub) next.set('sub', sub)
      else next.delete('sub')
      return next
    }, { replace: false })
  }, [setSearchParams])

  const setSub = useCallback((sub) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('sub', sub)
      return next
    }, { replace: false })
  }, [setSearchParams])

  // Resolve which sub-tab to show for composite tabs
  const effectiveSub = useMemo(() => {
    const subs = SUB_TABS[activeTab]
    if (!subs) return null
    const valid = subs.map(s => s.id)
    // If URL has a valid sub, use it; also honour old aliases
    if (valid.includes(activeSub)) return activeSub
    if (TAB_ALIAS[rawTab] === activeTab && valid.includes(rawTab)) return rawTab
    return valid[0]
  }, [activeTab, activeSub, rawTab])

  const [historyDrilldown, setHistoryDrilldown] = useState(null)
  const [invoiceDrilldown, setInvoiceDrilldown] = useState(null)

  const openHistoryDrilldown = useCallback((sourceTable, label) => {
    setHistoryDrilldown({ sourceTable, label, conditions: [{ field: 'change_type', op: 'is', value: 'delete' }], token: Date.now() })
    setTab('history')
  }, [setTab])

  const openInvoiceDrilldown = useCallback((source, teableId) => {
    setInvoiceDrilldown({ source: source || 'all', teable_id: teableId, token: Date.now() })
    setTab('invoices')
  }, [setTab])

  const tabBar = (
    <div className={`flex overflow-x-auto gap-0.5 px-2 py-2 ${embedded ? 'rounded-xl border mb-4' : 'sticky top-[49px] z-10'}`}
      style={embedded
        ? { background: 'var(--card-bg)', borderColor: 'var(--border)' }
        : { background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => setTab(id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
          style={activeTab === id
            ? { background: 'rgba(220,38,38,0.10)', color: '#dc2626' }
            : { color: 'var(--text-3)', background: 'transparent' }}
          onMouseEnter={e => { if (activeTab !== id) e.currentTarget.style.background = 'var(--bg-input)' }}
          onMouseLeave={e => { if (activeTab !== id) e.currentTarget.style.background = 'transparent' }}>
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  )

  const content = (
    <>
      {activeTab === 'overview'  && <OverviewTab onOpenHistoryDrilldown={openHistoryDrilldown} />}
      {activeTab === 'requests'  && <AuditLogTab />}
      {activeTab === 'users'     && (
        <>
          <SubTabBar tabs={SUB_TABS.users} active={effectiveSub} onSelect={setSub} />
          {effectiveSub === 'auth-users' && <AuthUsersTab />}
          {effectiveSub === 'sessions'   && <SessionsTab />}
        </>
      )}
      {activeTab === 'ai'        && (
        <>
          <SubTabBar tabs={SUB_TABS.ai} active={effectiveSub} onSelect={setSub} />
          {effectiveSub === 'chats'   && <ChatsTab />}
          {effectiveSub === 'ai-runs' && <AiRunsTab />}
        </>
      )}
      {activeTab === 'insights'  && <InsightsTab />}
      {activeTab === 'sync'      && <SyncLogTab />}
      {activeTab === 'projects'  && <ProjectsMirrorTab />}
      {activeTab === 'invoices'  && <InvoicesTab drilldown={invoiceDrilldown} />}
      {activeTab === 'history'   && <HistoryTab drilldown={historyDrilldown} onOpenRecord={openInvoiceDrilldown} />}
      {activeTab === 'shared'      && <SharedLinksTab />}
      {activeTab === 'hflogs'      && <HfLogsTab />}
      {activeTab === 'deploy'      && <DeploymentHealthTab />}
      {activeTab === 'permissions' && <PermissionsTab searchParams={searchParams} setSearchParams={setSearchParams} />}
    </>
  )

  /* ── Embedded inside Layout ── */
  if (embedded) {
    return (
      <div className="p-2 sm:p-4 space-y-4 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(220,38,38,0.10)' }}>
            <Activity size={15} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight" style={{ color: 'var(--text-1)' }}>
              Admin Panel
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              PostgreSQL database dashboard — all requests logged
            </p>
          </div>
        </div>
        {tabBar}
        {content}
      </div>
    )
  }

  /* ── Standalone full-screen (admin role) ── */
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3"
        style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(220,38,38,0.12)' }}>
            <Activity size={14} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>Admin Panel</p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>PostgreSQL Dashboard · All requests logged</p>
          </div>
        </div>
        <button onClick={logout}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-3)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <LogOut size={12} /> Sign out
        </button>
      </header>

      {tabBar}

      <main className="flex-1 p-2 sm:p-4 max-w-[1400px] mx-auto w-full">
        {content}
      </main>
    </div>
  )
}
