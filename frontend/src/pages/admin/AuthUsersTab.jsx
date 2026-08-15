// Extracted from AdminDashboard.jsx — AuthUsersTab.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RefreshCw, Clock, Trash2, X, Download, UserPlus, Mail, Save, SendHorizontal, KeyRound, Eye, Lock } from 'lucide-react'
import { api } from '../../services/api'
import { useConfirm } from '../../context/ConfirmContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { AuthStatusBadge, Badge, EditableName, Empty, Err, FMulti, FPill, FSel, FilterBar, Pager, Skeleton, UserAvatar } from './ui'
import { relTime, ts } from './utils'
import { useDialog } from '../../hooks/useDialog'

function displayName(user) {
  const fn = (user?.first_name || '').trim()
  const ln = (user?.last_name  || '').trim()
  if (fn && fn === ln) return fn
  return [fn, ln].filter(Boolean).join(' ') || user?.full_name || ''
}

export function SetPasswordModal({ userId, userEmail, onClose, toast }) {
  const dialog = useDialog({ label: 'Set a new password', onClose })
  // Named askConfirm, not confirm: `confirm` is already the password
  // confirmation field in this component.
  const askConfirm = useConfirm()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const canSubmit = password.length >= 10 && password === confirm

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    if (!(await askConfirm({
      title: 'Set a new password',
      message: `Set a new password for ${userEmail}? Their active sessions will be revoked immediately.`,
      confirmLabel: 'Set password',
    }))) return
    setBusy(true)
    try {
      const res = await api.admin.setUserPassword(userId, password)
      toast(`Password set for ${userEmail}. ${res.sessions_revoked} session(s) revoked.`, 'success')
      onClose()
    } catch (err) {
      toast(err.message || 'Failed to set password', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div {...dialog.panelProps} className="rounded-2xl p-6 w-full max-w-sm space-y-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Set password</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{userEmail}</p>
          </div>
          <button aria-label="Close" onClick={onClose} style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: 'var(--text-2)' }}>New password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 10 characters"
                className="input w-full pr-10"
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--text-3)' }}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: 'var(--text-2)' }}>Confirm password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              className="input w-full"
              autoComplete="new-password"
            />
            {confirm && password !== confirm && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--error)' }}>Passwords do not match</p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 text-xs">Cancel</button>
            <button type="submit" disabled={!canSubmit || busy} className="btn-primary flex-1 text-xs">
              {busy ? 'Setting…' : 'Set password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function AuthUsersTab() {
  const confirm = useConfirm()
  const toast = useToast()
  const { authRole, startImpersonation } = useAuth()
  const navigate = useNavigate()
  const isSuperAdmin = authRole === 'superadmin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [setPasswordUserId, setSetPasswordUserId] = useState(null)
  const [data, setData] = useState(null)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [statusFilter, setStatusFilter] = useState([])
  const [roleFilter, setRoleFilter] = useState([])
  const [timelineUserId, setTimelineUserId] = useState(null)
  const [search, setSearch] = useState('')
  const [roleByUser, setRoleByUser] = useState({})
  const [actingId, setActingId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [decisionHandled, setDecisionHandled] = useState(false)
  const [smtpTo, setSmtpTo] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [newUser, setNewUser] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role_key: 'user',
    status: 'active',
    send_invite: true,
  })
  const targetUserId = searchParams.get('user') || ''
  const requestedDecision = ['approve', 'reject'].includes(searchParams.get('decision')) ? searchParams.get('decision') : ''

  const roleOpts = useMemo(
    () => roles.map(r => [r.role_key, `${r.label || r.role_key}`]),
    [roles],
  )

  const loadRoles = useCallback(async () => {
    const res = await api.admin.authRoles()
    setRoles(res.roles || [])
  }, [])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await api.admin.authUsers({
        user_id: targetUserId || undefined,
        limit,
        offset,
        status: statusFilter[0] || undefined,
        role_key: roleFilter[0] || undefined,
        search: search || undefined,
      })
      setData(res)
      setRoleByUser(prev => {
        const next = { ...prev }
        for (const row of res.rows || []) {
          if (!next[row.id]) next[row.id] = row.roles?.[0] || 'user'
        }
        return next
      })
    } catch (e) {
      setError(e.message)
    } finally {
      if (silent) setRefreshing(false)
      else setLoading(false)
    }
  }, [limit, offset, statusFilter, roleFilter, search, targetUserId])

  useEffect(() => { loadRoles().catch(e => setError(e.message)) }, [loadRoles])
  useEffect(() => { setOffset(0) }, [limit, statusFilter, roleFilter, search, targetUserId])
  useEffect(() => { load() }, [load])

  const act = useCallback(async (row, action) => {
    const role_key = roleByUser[row.id] || row.roles?.[0] || 'user'
    // Each guarded action gets its own copy; the dialog is only raised for the
    // action actually being taken.
    const prompts = {
      reject:  { title: 'Reject user',   confirmLabel: 'Reject',  message: `Reject ${row.email}? They will not be able to sign in.` },
      disable: { title: 'Disable user',  confirmLabel: 'Disable', message: `Disable ${row.email} and revoke their active sessions?` },
      revoke:  { title: 'Revoke sessions', confirmLabel: 'Revoke', message: `Revoke active sessions for ${row.email}?` },
      role:    { title: 'Change role',   confirmLabel: 'Change role', tone: 'default',
                 message: `Change ${row.email} role to ${role_key}? Their active sessions will be revoked so the new role applies safely.` },
    }
    if (prompts[action] && !(await confirm(prompts[action]))) return
    setActingId(`${row.id}:${action}`)
    try {
      if (action === 'approve') await api.admin.approveAuthUser(row.id, { role_key })
      else if (action === 'reject') await api.admin.rejectAuthUser(row.id, { reason: 'Rejected from admin auth users tab' })
      else if (action === 'disable') await api.admin.disableAuthUser(row.id, { reason: 'Disabled from admin auth users tab' })
      else if (action === 'reactivate') await api.admin.reactivateAuthUser(row.id, { role_key })
      else if (action === 'role') await api.admin.updateAuthUserRole(row.id, { role_key, reason: 'Role changed from admin auth users tab', revoke_sessions: true })
      else if (action === 'revoke') await api.admin.revokeAuthUserSessions(row.id)
      toast('User updated successfully', 'success')
      await load({ silent: true })
    } catch (e) {
      toast(e.message || 'Auth action failed', 'error')
    } finally {
      setActingId('')
    }
  }, [load, roleByUser])

  useEffect(() => {
    if (!requestedDecision || !targetUserId || decisionHandled || !data?.rows?.length) return
    const row = data.rows.find(r => r.id === targetUserId)
    if (!row) return
    setDecisionHandled(true)
    // Remove ?decision from URL first so a page refresh doesn't re-trigger,
    // then execute — act() sets its own error state if the API call fails.
    const next = new URLSearchParams(searchParams)
    next.delete('decision')
    setSearchParams(next, { replace: true })
    act(row, requestedDecision)
  }, [act, data, decisionHandled, requestedDecision, searchParams, setSearchParams, targetUserId])

  const createUser = useCallback(async (e) => {
    e?.preventDefault()
    if (!newUser.email.trim()) return
    setActingId('create-user')
    try {
      const res = await api.admin.createAuthUser({
        ...newUser,
        email: newUser.email.trim(),
        first_name: newUser.first_name.trim() || undefined,
        last_name: newUser.last_name.trim() || undefined,
      })
      toast(res.message || 'User created successfully', 'success')
      setNewUser({ email: '', first_name: '', last_name: '', role_key: 'user', status: 'active', send_invite: true })
      setShowCreate(false)
      await load({ silent: true })
    } catch (e) {
      toast(e.message || 'User creation failed', 'error')
    } finally {
      setActingId('')
    }
  }, [load, newUser])

  const testSmtp = useCallback(async () => {
    setActingId('smtp-test')
    try {
      const res = await api.admin.testSmtp({ to: smtpTo.trim() || undefined })
      toast(res.message || 'SMTP test passed', 'success')
    } catch (e) {
      toast(e.message || 'SMTP test failed', 'error')
    } finally {
      setActingId('')
    }
  }, [smtpTo])

  const deleteUser = useCallback(async (row) => {
    const isActive = row.status === 'active'
    const msg = isActive
      ? `Delete ACTIVE user ${row.email}? This will immediately revoke their sessions and cannot be undone.`
      : `Permanently delete ${row.email}? This cannot be undone.`
    if (!(await confirm({
      title: isActive ? 'Delete active user' : 'Delete user',
      message: msg,
      confirmLabel: 'Delete user',
    }))) return
    setActingId(`${row.id}:delete`)
    try {
      await api.admin.deleteAuthUser(row.id, isActive)
      toast(`User ${row.email} deleted`, 'success')
      await load({ silent: true })
    } catch (e) {
      toast(e.message || 'Delete failed', 'error')
    } finally {
      setActingId('')
    }
  }, [load])

  const updateTeableEmail = useCallback(async (row, teableEmail) => {
    setActingId(`${row.id}:teable`)
    try {
      await api.admin.setTeableEmail(row.id, { teable_email: teableEmail || null })
      await load({ silent: true })
    } catch (e) {
      toast(e.message || 'Teable email update failed', 'error')
    } finally {
      setActingId('')
    }
  }, [load])

  const resendInvite = useCallback(async (row) => {
    if (!(await confirm({
      title: 'Resend invite',
      message: `Resend the invite email to ${row.email}?`,
      confirmLabel: 'Resend invite',
      tone: 'default',
    }))) return
    setActingId(`${row.id}:invite`)
    try {
      const res = await api.admin.resendInvite(row.id)
      if (res.delivery?.sent) toast(`Invite sent to ${row.email}`, 'success')
      else toast(`Invite failed: ${res.delivery?.reason || res.delivery?.detail || 'unknown'}`, 'error')
    } catch (e) { toast(e.message || 'Resend failed', 'error') }
    finally { setActingId('') }
  }, [])

  const forcePasswordReset = useCallback(async (row) => {
    if (!(await confirm({
      title: 'Force password reset',
      message: `Force a password reset for ${row.email}? This will revoke all their active sessions.`,
      confirmLabel: 'Force reset',
    }))) return
    setActingId(`${row.id}:forcereset`)
    try {
      const res = await api.admin.forcePasswordReset(row.id)
      if (res.delivery?.sent) toast(`Reset email sent. ${res.sessions_revoked} session(s) revoked.`, 'success')
      else toast(`Sessions revoked but email failed: ${res.delivery?.reason || ''}`, 'warning')
    } catch (e) { toast(e.message || 'Force reset failed', 'error') }
    finally { setActingId('') }
  }, [])

  const impersonate = useCallback(async (row) => {
    if (!(await confirm({
      title: 'Impersonate user',
      message: `Impersonate ${row.email}? You will be signed in as this user for up to 2 hours. A banner will appear so you can exit at any time.`,
      confirmLabel: 'Impersonate',
    }))) return
    setActingId(`${row.id}:impersonate`)
    try {
      const res = await api.admin.impersonate(row.id)
      await startImpersonation(res.token, res.user)
      navigate('/')
    } catch (e) { toast(e.message || 'Impersonation failed', 'error') }
    finally { setActingId('') }
  }, [startImpersonation])

  const updateName = useCallback(async (row, name) => {
    setActingId(`${row.id}:name`)
    try {
      const parts = (name || '').trim().split(' ')
      await api.admin.updateAuthUserName(row.id, { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') || '' })
      await load({ silent: true })
    } catch (e) {
      toast(e.message || 'Name update failed', 'error')
    } finally {
      setActingId('')
    }
  }, [load])

  const renderActions = (row) => {
    const busy = (name) => actingId === `${row.id}:${name}`
    const rowBusy = Boolean(actingId) && actingId.startsWith(`${row.id}:`)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={roleByUser[row.id] || row.roles?.[0] || 'user'}
          onChange={e => setRoleByUser(prev => ({ ...prev, [row.id]: e.target.value }))}
          disabled={rowBusy}
          className="text-[11px] px-2 py-1 rounded-lg border outline-none"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-1)' }}>
          {(roleOpts.length ? roleOpts : [['user', 'User'], ['viewer', 'Viewer']]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {row.status === 'active' && (roleByUser[row.id] || row.roles?.[0] || 'user') !== (row.roles?.[0] || 'user') && (
          <button onClick={() => act(row, 'role')} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
            style={{ color: '#2563eb', borderColor: 'rgba(37,99,235,0.28)', background: 'rgba(37,99,235,0.08)' }}>
            <Save size={11} /> {busy('role') ? 'Saving…' : 'Save role'}
          </button>
        )}
        {row.status !== 'active' && (
          <button onClick={() => act(row, row.status === 'pending_approval' ? 'approve' : 'reactivate')} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border"
            style={{ color: '#16a34a', borderColor: 'rgba(22,163,74,0.28)', background: 'rgba(22,163,74,0.08)' }}>
            {busy('approve') || busy('reactivate') ? 'Working…' : row.status === 'pending_approval' ? 'Approve' : 'Reactivate'}
          </button>
        )}
        {row.status === 'pending_approval' && (
          <button onClick={() => act(row, 'reject')} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border"
            style={{ color: '#dc2626', borderColor: 'rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)' }}>
            {busy('reject') ? 'Working…' : 'Reject'}
          </button>
        )}
        {row.status === 'active' && (
          <button onClick={() => act(row, 'disable')} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border"
            style={{ color: '#dc2626', borderColor: 'rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)' }}>
            {busy('disable') ? 'Working…' : 'Disable'}
          </button>
        )}
        {/* Invite actions — available for active/pending users */}
        {(row.status === 'active' || row.status === 'pending_approval') && (
          <button onClick={() => resendInvite(row)} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
            style={{ color: '#2563eb', borderColor: 'rgba(37,99,235,0.28)', background: 'rgba(37,99,235,0.08)' }}>
            <SendHorizontal size={11} /> {busy('invite') ? 'Sending…' : 'Resend invite'}
          </button>
        )}
        {row.status === 'active' && (
          <button onClick={() => forcePasswordReset(row)} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
            style={{ color: '#d97706', borderColor: 'rgba(217,119,6,0.28)', background: 'rgba(217,119,6,0.08)' }}>
            <KeyRound size={11} /> {busy('forcereset') ? 'Working…' : 'Force reset'}
          </button>
        )}
        <button onClick={() => setTimelineUserId(row.id)} disabled={rowBusy}
          className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
          style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
          <Clock size={11} /> Timeline
        </button>
        <button onClick={() => deleteUser(row)} disabled={rowBusy}
          className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
          style={{ color: '#dc2626', borderColor: 'rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)' }}>
          <Trash2 size={11} /> {busy('delete') ? 'Deleting…' : 'Delete'}
        </button>
        {row.active_session_count > 0 && (
          <button onClick={() => act(row, 'revoke')} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border"
            style={{ color: '#d97706', borderColor: 'rgba(217,119,6,0.28)', background: 'rgba(217,119,6,0.08)' }}>
            {busy('revoke') ? 'Revoking…' : 'Revoke sessions'}
          </button>
        )}
        {isSuperAdmin && row.status === 'active' && (
          <button onClick={() => impersonate(row)} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
            style={{ color: '#7c3aed', borderColor: 'rgba(124,58,237,0.28)', background: 'rgba(124,58,237,0.08)' }}>
            <Eye size={11} /> {busy('impersonate') ? 'Starting…' : 'Impersonate'}
          </button>
        )}
        {isSuperAdmin && row.status === 'active' && (
          <button onClick={() => setSetPasswordUserId(row.id)} disabled={rowBusy}
            className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
            style={{ color: '#0369a1', borderColor: 'rgba(3,105,161,0.28)', background: 'rgba(3,105,161,0.08)' }}>
            <Lock size={11} /> Set password
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {timelineUserId && (
        <UserTimelineDrawer userId={timelineUserId} onClose={() => setTimelineUserId(null)} />
      )}
      {setPasswordUserId && (
        <SetPasswordModal
          userId={setPasswordUserId}
          userEmail={data?.rows?.find(r => r.id === setPasswordUserId)?.email || ''}
          onClose={() => setSetPasswordUserId(null)}
          toast={toast}
        />
      )}
      <div className="rounded-xl border p-3 text-[11px]"
        style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Auth control plane</p>
            <p style={{ color: 'var(--text-3)' }}>
              Create, invite, approve, change roles, map Teable Raised By aliases, revoke sessions, and trace each user through auth_events plus request audit logs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowCreate(v => !v)} className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
              <UserPlus size={12} /> {showCreate ? 'Close create' : 'Create / invite user'}
            </button>
            <input
              value={smtpTo}
              onChange={e => setSmtpTo(e.target.value)}
              placeholder="email test recipient"
              className="input text-xs px-3 py-1.5 rounded-lg w-44"
            />
            <button onClick={testSmtp} disabled={actingId === 'smtp-test'} className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
              <Mail size={12} /> {actingId === 'smtp-test' ? 'Sending…' : 'Test email'}
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createUser} className="rounded-xl border p-3 grid grid-cols-1 md:grid-cols-[1.2fr_1fr_180px_170px_auto] gap-2 items-end"
          style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
            Email
            <input value={newUser.email} onChange={e => setNewUser(v => ({ ...v, email: e.target.value }))} className="input mt-1 px-3 py-2 rounded-lg text-sm" placeholder="name@company.com" type="email" required />
          </label>
          <div style={{ display:'flex', gap:6 }}>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] flex-1" style={{ color: 'var(--text-3)' }}>
              First name
              <input value={newUser.first_name} onChange={e => setNewUser(v => ({ ...v, first_name: e.target.value }))} className="input mt-1 px-3 py-2 rounded-lg text-sm" placeholder="First" />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] flex-1" style={{ color: 'var(--text-3)' }}>
              Last name
              <input value={newUser.last_name} onChange={e => setNewUser(v => ({ ...v, last_name: e.target.value }))} className="input mt-1 px-3 py-2 rounded-lg text-sm" placeholder="Last" />
            </label>
          </div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
            Role
            <select value={newUser.role_key} onChange={e => setNewUser(v => ({ ...v, role_key: e.target.value }))} className="input mt-1 px-3 py-2 rounded-lg text-sm">
              {(roleOpts.length ? roleOpts : [['user', 'User'], ['viewer', 'Viewer']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
            Status
            <select value={newUser.status} onChange={e => setNewUser(v => ({ ...v, status: e.target.value }))} className="input mt-1 px-3 py-2 rounded-lg text-sm">
              <option value="active">Active + invite</option>
              <option value="pending_approval">Pending approval</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-2)' }}>
              <input type="checkbox" checked={newUser.send_invite} onChange={e => setNewUser(v => ({ ...v, send_invite: e.target.checked }))} />
              Send email
            </label>
            <button type="submit" disabled={actingId === 'create-user'} className="btn-primary text-xs px-3 py-2">
              {actingId === 'create-user' ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      )}

      <FilterBar
        count={statusFilter.length + roleFilter.length + (search ? 1 : 0)}
        onReset={() => { setStatusFilter([]); setRoleFilter([]); setSearch('') }}
        rightSlot={<>
          <FSel label="Limit" value={String(limit)} onChange={v => setLimit(Number(v))}
            opts={[['25','25'],['50','50'],['100','100']]} />
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </>}>
        <FMulti label="Status" selected={statusFilter} onChange={setStatusFilter} width={180}
          opts={[
            ['pending_approval', 'Pending approval'],
            ['active', 'Active'],
            ['disabled', 'Disabled'],
            ['rejected', 'Rejected'],
          ]} />
        <FMulti label="Role" selected={roleFilter} onChange={setRoleFilter} width={170}
          opts={roleOpts} />
          <FPill label="Search" value={search} onChange={setSearch} placeholder="email or name…" width={220} />
      </FilterBar>

      {targetUserId && (
        <div className="rounded-xl border p-3 text-xs flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'rgba(37,99,235,0.24)', background: 'rgba(37,99,235,0.07)' }}>
          <span style={{ color: 'var(--text-2)' }}>
            Reviewing user from email action link. Clear this focus to return to all users.
          </span>
          <button
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('user'); next.delete('decision')
              setSearchParams(next, { replace: true })
            }}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            Show all users
          </button>
        </div>
      )}

      {data && (
        <div className="text-xs flex flex-wrap gap-2" style={{ color: 'var(--text-3)' }}>
          <span>{data.total.toLocaleString()} user{data.total !== 1 ? 's' : ''}</span>
          {refreshing && <span>Refreshing…</span>}
        </div>
      )}

      {loading ? <Skeleton rows={6} /> : error ? <Err msg={error} onRetry={load} /> : (
        <>
          {(data?.rows || []).length === 0 ? <Empty label="No auth users match these filters" /> : (
            <>
              <div className="md:hidden space-y-2">
                {(data?.rows || []).map(row => (
                  <div key={`auth-m-${row.id}`} className="card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate" style={{ color: 'var(--text-1)' }}>{row.email}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{displayName(row) || 'No name'} · joined {relTime(row.created_at)}</p>
                      </div>
                      <AuthStatusBadge status={row.status} />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(row.roles || []).length ? row.roles.map(r => <Badge key={r} color="indigo">{r}</Badge>) : <Badge>No role</Badge>}
                      <Badge color={row.active_session_count > 0 ? 'green' : 'default'}>{row.active_session_count || 0} active sessions</Badge>
                      <Badge color="blue">{row.audit_request_count || 0} requests</Badge>
                      <Badge color="purple">{row.auth_event_count || 0} auth events</Badge>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Last request {relTime(row.last_request_at)} · Last auth event {relTime(row.last_event_at)}
                    </p>
                    {renderActions(row)}
                  </div>
                ))}
              </div>
              <div className="hidden md:grid gap-3">
                {(data?.rows || []).map(row => (
                  <div
                    key={row.id}
                    className="rounded-2xl border p-4 transition-all"
                    style={{
                      borderColor: row.id === targetUserId ? 'rgba(37,99,235,0.55)' : 'var(--border)',
                      background: 'linear-gradient(135deg, var(--card-bg), var(--bg-soft))',
                      boxShadow: row.id === targetUserId ? '0 18px 50px rgba(37,99,235,0.18)' : 'var(--shadow-soft)',
                    }}
                  >
                    <div className="grid grid-cols-[minmax(260px,1.2fr)_minmax(220px,0.9fr)_minmax(360px,1.1fr)] gap-4 items-start">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-start gap-3">
                          <UserAvatar row={row} />
                          <div className="min-w-0">
                            <p className="font-semibold truncate" style={{ color: 'var(--text-1)' }}>{row.email}</p>
                            <EditableName
                              value={displayName(row)}
                              saving={actingId === `${row.id}:name`}
                              onSave={name => updateName(row, name)}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <AuthStatusBadge status={row.status} />
                          {(row.roles || []).length ? row.roles.map(r => <Badge key={r} color="indigo">{r}</Badge>) : <Badge>No role</Badge>}
                        </div>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Created {ts(row.created_at)} · Last seen {relTime(row.last_seen_at)}
                        </p>
                      </div>

                      <div className="rounded-xl border p-3 min-w-0" style={{ borderColor: 'var(--border)', background: 'var(--glass-bg)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-1" style={{ color: 'var(--text-3)' }}>
                          Teable Raised By alias
                        </p>
                        <EditableName
                          value={row.teable_email || ''}
                          saving={actingId === `${row.id}:teable`}
                          onSave={v => updateTeableEmail(row, v)}
                          placeholder={`e.g. ${row.email?.split('@')[0] || 'faizan'}`}
                          emptyLabel="Uses login email unless alias is set"
                        />
                        <p className="text-[10px] mt-2" style={{ color: 'var(--text-3)' }}>
                          Use this when Teable stores Raised By as a name/alias like “faizan” instead of the login email.
                        </p>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>Sessions</p>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{row.active_session_count || 0} active · {row.session_count || 0} total</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>Audit</p>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{row.audit_request_count || 0} req · {row.auth_event_count || 0} events</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2" style={{ borderColor: 'var(--border)', background: 'var(--glass-bg)' }}>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>Controls</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Last request {relTime(row.last_request_at)}</span>
                        </div>
                        {renderActions(row)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <Pager total={data?.total || 0} limit={limit} offset={offset} onPage={setOffset} />
        </>
      )}
    </div>
  )
}

// ── Tab: AI Chats ─────────────────────────────────────────────────────────────

export function UserTimelineDrawer({ userId, onClose }) {
  const dialog = useDialog({ label: 'User activity', onClose })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return
    setLoading(true); setError(null)
    api.admin.userTimeline(userId).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [userId])

  const EVENT_COLORS = {
    password_login:            'green',
    email_login:               'green',
    password_register_pending: 'amber',
    admin_invite_resent:       'blue',
    admin_user_approved:       'green',
    admin_user_rejected:       'red',
    admin_user_disabled:       'red',
    admin_user_deleted:        'red',
    admin_force_password_reset:'amber',
    admin_user_role_updated:   'indigo',
    admin_user_teable_email_set:'purple',
    admin_user_sessions_revoked:'amber',
    password_reset_requested:  'amber',
    password_reset_completed:  'green',
    login_failed:              'red',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end overlay-safe"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div {...dialog.panelProps} className="h-full w-full max-w-xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-base)', borderLeft: '1px solid var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
          <div className="flex items-center gap-3 min-w-0">
            {data?.user && <UserAvatar row={data.user} size={44} />}
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>
                {data?.user?.email || 'User Timeline'}
              </p>
              {displayName(data?.user) && (
                <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{displayName(data?.user)}</p>
              )}
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1.5 rounded-lg hover:bg-red-50" style={{ color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Stats strip + export */}
        {data && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b text-xs flex-shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
            <div className="flex gap-4 flex-wrap">
              <span style={{ color: 'var(--text-3)' }}><b style={{ color: 'var(--text-1)' }}>{data.timeline?.length}</b> events</span>
              <span style={{ color: 'var(--text-3)' }}><b style={{ color: 'var(--text-1)' }}>{data.sessions?.length}</b> sessions</span>
              <span style={{ color: 'var(--text-3)' }}><b style={{ color: 'var(--text-1)' }}>{data.audit_request_count?.toLocaleString()}</b> API requests</span>
              {data.user?.teable_email && (
                <span style={{ color: '#7c3aed' }}>Teable: {data.user.teable_email}</span>
              )}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <a href={api.admin.userTimelineExportUrl(userId, 'csv')}
                download
                className="text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1"
                style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--card-bg)', textDecoration: 'none' }}>
                <Download size={10} /> CSV
              </a>
              <a href={api.admin.userTimelineExportUrl(userId, 'json')}
                download
                className="text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1"
                style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--card-bg)', textDecoration: 'none' }}>
                <Download size={10} /> JSON
              </a>
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <Skeleton rows={6} />}
          {error && <Err msg={error} onRetry={() => {}} />}
          {data && data.timeline.length === 0 && <Empty label="No events recorded yet" />}
          {data && data.timeline.map(ev => (
            <div key={ev.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: EVENT_COLORS[ev.event_type] === 'green' ? '#16a34a'
                    : EVENT_COLORS[ev.event_type] === 'red' ? '#dc2626'
                    : EVENT_COLORS[ev.event_type] === 'amber' ? '#d97706'
                    : EVENT_COLORS[ev.event_type] === 'blue' ? '#2563eb'
                    : EVENT_COLORS[ev.event_type] === 'purple' ? '#7c3aed'
                    : '#6366f1' }} />
                <div className="flex-1 w-px my-1" style={{ background: 'var(--border)' }} />
              </div>
              <div className="pb-2 min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Badge color={EVENT_COLORS[ev.event_type] || 'default'}>
                    {ev.event_type.replaceAll('_', ' ')}
                  </Badge>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                    {ts(ev.created_at)}
                  </span>
                </div>
                {ev.actor_email && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    by {ev.actor_name || ev.actor_email}
                  </p>
                )}
                {ev.ip && (
                  <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ev.ip}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Permissions Tab ───────────────────────────────────────────────────────────
