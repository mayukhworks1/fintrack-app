// Extracted from AdminDashboard.jsx — PermissionsTab.
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../services/api'
import { UserAvatar } from './ui'

const MODULE_ORDER = ['dashboard','invoices','projects','tax','analytics','reports','ai','status','shared','admin','system']
const MODULE_LABELS = {
  dashboard:'Dashboard', invoices:'Invoices', projects:'Projects', tax:'Tax Ledger',
  analytics:'Analytics', reports:'Reports', ai:'AI', status:'Status Board',
  shared:'Shared Views', admin:'Admin', system:'System',
}
const ACTION_COLORS = { view:'#6366f1', create:'#22c55e', edit:'#f59e0b', delete:'#ef4444', payment:'#a855f7' }

export function PermissionsTab({ searchParams, setSearchParams }) {
  const [matrix, setMatrix] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState({})
  const [moduleFilter, setModuleFilter] = useState('all')

  // Get selected user from URL, default to first user
  const selectedUser = searchParams.get('user')

  // Persist user selection to URL
  const setSelectedUser = useCallback((userId) => {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      if (userId) n.set('user', userId)
      else n.delete('user')
      return n
    })
  }, [setSearchParams])

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true)
    setError('')
    try {
      const data = await api.admin.permissionMatrix()
      setMatrix(data)
      // Auto-select first user if none selected
      if (!selectedUser && data.users.length > 0) {
        setSelectedUser(data.users[0].id)
      }
      return data
    } catch (e) {
      if (!opts.silent) setError(e.message || 'Failed to load permissions')
      throw e
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [selectedUser, setSelectedUser])

  useEffect(() => { load() }, [])

  // Is `permId` granted by role default for this user (ignoring any override)?
  // Pass the current matrix snapshot `m` to avoid stale closure inside setMatrix updater.
  function roleDefaultGranted(targetUser, permId, m_) {
    const src = m_ || matrix
    if (!src) return false
    const roleIds = (targetUser?.roles || []).map(r => r.role_id).filter(Boolean)
    return roleIds.some(rid => (src.role_permissions[rid] || []).includes(permId))
  }

  // Apply an override locally — used for instant optimistic UI updates.
  // granted: true | false | null (null = clear override, revert to role default)
  function applyLocalOverride(userId, permId, granted) {
    setMatrix(m => {
      if (!m) return m
      return {
        ...m,
        users: m.users.map(u => {
          if (u.id !== userId) return u
          const nextOverrides = { ...u.overrides }
          if (granted === null) delete nextOverrides[permId]
          else nextOverrides[permId] = granted
          const isGranted = granted === null ? roleDefaultGranted(u, permId, m) : granted
          const nextEffective = new Set(u.effective_permission_ids)
          if (isGranted) nextEffective.add(permId)
          else nextEffective.delete(permId)
          return { ...u, overrides: nextOverrides, effective_permission_ids: [...nextEffective] }
        }),
      }
    })
  }

  async function toggle(userId, permKey, permId, currentlyGranted) {
    const key = `${userId}:${permKey}`
    const nextGranted = !currentlyGranted
    setBusy(b => ({ ...b, [key]: true }))
    applyLocalOverride(userId, permId, nextGranted)   // instant feedback, no full reload
    try {
      await api.admin.setUserPermission(userId, permKey, nextGranted)
      load({ silent: true }).catch(() => {})           // background reconcile, no flash
    } catch (e) {
      applyLocalOverride(userId, permId, currentlyGranted)  // revert on failure
      alert(e.message || 'Failed to update permission')
    } finally {
      setBusy(b => { const n = {...b}; delete n[key]; return n })
    }
  }

  async function clearOverride(userId, permKey, permId, previousGranted) {
    const key = `${userId}:${permKey}`
    setBusy(b => ({ ...b, [key]: true }))
    applyLocalOverride(userId, permId, null)
    try {
      await api.admin.setUserPermission(userId, permKey, null)
      load({ silent: true }).catch(() => {})
    } catch (e) {
      applyLocalOverride(userId, permId, previousGranted)
      alert(e.message || 'Failed to clear override')
    } finally {
      setBusy(b => { const n = {...b}; delete n[key]; return n })
    }
  }

  if (loading) return <div className="p-8 text-center" style={{ color: 'var(--text-3)' }}>Loading permission matrix…</div>
  if (error)   return <div className="p-8 text-center" style={{ color: 'var(--fin-negative)' }}>{error}</div>
  if (!matrix) return null

  const user = matrix.users.find(u => u.id === selectedUser)
  const effectiveSet = new Set(user?.effective_permission_ids || [])
  const overrides = user?.overrides || {}

  // Determine which modules are applicable for this user's role(s).
  // web/web_admin users live in the WebInvoices module — they can never reach
  // AI, Reports, Tax, Analytics, Status, Admin, System, Shared, Projects, or Dashboard
  // via the main app. Showing those permissions in the matrix confuses admins.
  const userRoleKeys = new Set((user?.roles || []).map(r => r.role_key))
  const isWebExperience = userRoleKeys.has('web') || userRoleKeys.has('web_admin')
  const WEB_APPLICABLE_MODULES = new Set(['invoices'])
  const WEB_ADMIN_APPLICABLE_MODULES = new Set(['invoices', 'projects', 'tax'])

  function isModuleApplicable(mk) {
    if (!isWebExperience) return true
    if (userRoleKeys.has('web_admin')) return WEB_ADMIN_APPLICABLE_MODULES.has(mk)
    return WEB_APPLICABLE_MODULES.has(mk)
  }

  const moduleGroups = MODULE_ORDER.reduce((acc, mk) => {
    const perms = matrix.permissions.filter(p => p.module_key === mk && isModuleApplicable(mk))
    if (perms.length > 0) acc.push({ module_key: mk, perms })
    return acc
  }, [])
  // Catch any modules not in MODULE_ORDER
  const knownModules = new Set(MODULE_ORDER)
  matrix.permissions.forEach(p => {
    if (!knownModules.has(p.module_key) && isModuleApplicable(p.module_key)) {
      let g = moduleGroups.find(g => g.module_key === p.module_key)
      if (!g) { g = { module_key: p.module_key, perms: [] }; moduleGroups.push(g) }
      if (!g.perms.find(x => x.id === p.id)) g.perms.push(p)
    }
  })

  const visibleModules = moduleFilter === 'all' ? moduleGroups : moduleGroups.filter(g => g.module_key === moduleFilter)

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>Permission Matrix</h2>
            <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--text-3)' }}>
              Grant or revoke specific permissions per user. Overrides apply on top of role defaults.
            </p>
            <div className="flex flex-wrap gap-3 text-[10px]">
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:28, height:14, borderRadius:7, background:'var(--accent)', flexShrink:0 }} />
                <span style={{ color:'var(--text-2)' }}>Role default (granted)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:28, height:14, borderRadius:7, background:'#22c55e', flexShrink:0 }} />
                <span style={{ color:'var(--text-2)' }}>Override: granted</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:28, height:14, borderRadius:7, background:'#ef4444', flexShrink:0 }} />
                <span style={{ color:'var(--text-2)' }}>Override: denied</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display:'inline-block', width:28, height:14, borderRadius:7, background:'var(--border)', flexShrink:0 }} />
                <span style={{ color:'var(--text-2)' }}>Not granted</span>
              </span>
            </div>
          </div>
          <button onClick={load} className="btn-ghost text-xs">Refresh</button>
        </div>

        {/* User selector */}
        <div className="flex flex-wrap gap-2 mt-3">
          {matrix.users.map(u => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u.id)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={selectedUser === u.id
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
            >
              {u.name || u.email}
              {u.roles.length > 0 && (
                <span className="ml-1.5 opacity-70">({u.roles.map(r => r.role_key).join(', ')})</span>
              )}
            </button>
          ))}
          {matrix.users.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No approved active users found.</p>
          )}
        </div>
      </div>

      {user && (
        <>
          {/* User role + permission summary strip */}
          <div className="card p-3 sm:p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <UserAvatar row={user} size={32} />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{user.name || user.email}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {user.roles.length > 0
                    ? `Role: ${user.roles.map(r => r.role_key).join(', ')}`
                    : 'No role assigned'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                {user.effective_permission_ids?.length || 0} permissions effective
              </span>
              {Object.keys(user.overrides || {}).length > 0 && (
                <span style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                  {Object.keys(user.overrides).length} override{Object.keys(user.overrides).length !== 1 ? 's' : ''}
                </span>
              )}
              {user.roles.length === 0 && (
                <span style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                  ⚠ No role — all permissions will be inherited from overrides only
                </span>
              )}
            </div>
          </div>

          {/* Web experience notice */}
          {isWebExperience && (
            <div className="rounded-xl px-4 py-2.5 text-xs flex items-start gap-2"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--text-2)' }}>
              <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>ℹ</span>
              <span>
                This user has a <strong>{userRoleKeys.has('web_admin') ? 'web_admin' : 'web'}</strong> role — they only access the{' '}
                <strong>Web Billing module</strong> (not the main app). Only relevant permissions are shown.
                Granting AI, Reports, Admin, or other main-app permissions here has no effect.
              </span>
            </div>
          )}

          {/* Module filter */}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setModuleFilter('all')}
              className={moduleFilter === 'all' ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: '0.7rem', padding: '0.25rem 0.65rem' }}>All</button>
            {moduleGroups.map(g => (
              <button key={g.module_key} onClick={() => setModuleFilter(g.module_key)}
                className={moduleFilter === g.module_key ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.65rem' }}>
                {MODULE_LABELS[g.module_key] || g.module_key}
              </button>
            ))}
          </div>

          {/* Permission cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visibleModules.map(({ module_key, perms }) => (
              <div key={module_key} className="card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
                  {MODULE_LABELS[module_key] || module_key}
                </p>
                <div className="space-y-2">
                  {perms.map(perm => {
                    const isGranted = effectiveSet.has(perm.id)
                    const hasOverride = perm.id in overrides
                    const overrideVal = overrides[perm.id]
                    const isRoleDefault = roleDefaultGranted(user, perm.id)
                    const bKey = `${user.id}:${perm.permission_key}`
                    const isBusy = !!busy[bKey]
                    const actionColor = ACTION_COLORS[perm.action_key] || 'var(--accent)'

                    // 3-state toggle color:
                    // override-deny (red) > override-grant (green) > role-default (accent) > not-granted (border)
                    let toggleBg = 'var(--border)'
                    let toggleTitle = 'Click to grant'
                    if (hasOverride && !overrideVal) {
                      toggleBg = '#ef4444'
                      toggleTitle = 'Denied by override — click to grant'
                    } else if (hasOverride && overrideVal) {
                      toggleBg = '#22c55e'
                      toggleTitle = 'Granted by override — click to deny'
                    } else if (isGranted) {
                      toggleBg = 'var(--accent)'
                      toggleTitle = 'Granted by role — click to override-deny'
                    }

                    // Source label shown inline
                    let sourceLabel = ''
                    if (hasOverride && !overrideVal) sourceLabel = 'denied'
                    else if (hasOverride && overrideVal) sourceLabel = 'override'
                    else if (isGranted) sourceLabel = 'role'

                    return (
                      <div key={perm.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                        style={{
                          background: 'var(--bg-input)',
                          border: hasOverride
                            ? `1px solid ${overrideVal ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`
                            : '1px solid var(--border)',
                        }}>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{perm.label}</p>
                          <p className="text-[10px]" style={{ color: actionColor }}>
                            {perm.action_key}
                            {sourceLabel && (
                              <span className="ml-1.5 font-semibold" style={{
                                color: hasOverride && !overrideVal ? '#ef4444' : hasOverride ? '#22c55e' : 'var(--accent)'
                              }}>
                                · {sourceLabel}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {hasOverride && (
                            <button
                              onClick={() => clearOverride(user.id, perm.permission_key, perm.id, overrideVal)}
                              disabled={isBusy}
                              title={`Clear override — revert to role ${isRoleDefault ? 'default (granted)' : 'default (not granted)'}`}
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--border)', color: 'var(--text-3)', opacity: isBusy ? 0.5 : 1 }}>
                              reset
                            </button>
                          )}
                          <button
                            onClick={() => toggle(user.id, perm.permission_key, perm.id, isGranted)}
                            disabled={isBusy}
                            className="relative flex-shrink-0 rounded-full"
                            style={{
                              width: 36, height: 20,
                              background: toggleBg,
                              opacity: isBusy ? 0.6 : 1,
                              cursor: isBusy ? 'wait' : 'pointer',
                              border: 'none',
                              transition: 'background-color 150ms ease, opacity 150ms ease',
                            }}
                            title={toggleTitle}
                          >
                            <span style={{
                              position: 'absolute', top: 2, left: isGranted ? 18 : 2,
                              width: 16, height: 16, borderRadius: '50%',
                              background: '#fff', transition: 'left 0.15s',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main AdminDashboard ───────────────────────────────────────────────────────

// Top-level tabs — grouped by concern
