import { useState, useEffect, useCallback } from 'react'
import { User, Mail, Shield, Calendar, Clock, Key, Check, AlertCircle, Pencil, X } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'

function Avatar({ name, email, size = 48 }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (email || '?')[0].toUpperCase()
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: '#fff',
        fontSize: size * 0.35,
        letterSpacing: '0.02em',
      }}
    >
      {initials}
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
      <Icon size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{value || '—'}</span>
    </div>
  )
}

function ts(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return v }
}

function roleBadge(role) {
  const map = {
    superadmin: { label: 'Super Admin', bg: 'rgba(220,38,38,0.10)', fg: '#dc2626' },
    admin:      { label: 'Admin',       bg: 'rgba(220,38,38,0.10)', fg: '#dc2626' },
    editor:     { label: 'Editor',      bg: 'rgba(99,102,241,0.12)', fg: '#6366f1' },
    viewer:     { label: 'Viewer',      bg: 'rgba(100,116,139,0.12)', fg: 'var(--text-2)' },
    user:       { label: 'User',        bg: 'rgba(22,163,74,0.10)', fg: '#16a34a' },
  }
  const s = map[role] || { label: role || 'Unknown', bg: 'rgba(100,116,139,0.12)', fg: 'var(--text-2)' }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  )
}

export default function Profile() {
  const { user: ctxUser, logout } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Name editing
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState(null)

  // Password change
  const [showPwForm, setShowPwForm] = useState(false)
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await api.auth.getProfile()
      setProfile(data)
      setNameVal(data.full_name || '')
    } catch (e) {
      setError(e.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveName = async () => {
    setNameSaving(true); setNameMsg(null)
    try {
      const res = await api.auth.updateProfile({ full_name: nameVal.trim() || null })
      setProfile(p => ({ ...p, full_name: res.full_name }))
      setEditingName(false)
      setNameMsg({ ok: true, text: 'Name updated' })
    } catch (e) {
      setNameMsg({ ok: false, text: e.message || 'Failed to update name' })
    } finally {
      setNameSaving(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (pw.newPw !== pw.confirm) { setPwMsg({ ok: false, text: 'Passwords do not match' }); return }
    if (pw.newPw.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters' }); return }
    setPwSaving(true); setPwMsg(null)
    try {
      const res = await api.auth.changePassword({ current_password: pw.current, new_password: pw.newPw })
      setPwMsg({ ok: true, text: res.message || 'Password changed successfully' })
      setPw({ current: '', newPw: '', confirm: '' })
      setShowPwForm(false)
    } catch (e) {
      setPwMsg({ ok: false, text: e.message || 'Failed to change password' })
    } finally {
      setPwSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-sm" style={{ color: 'var(--text-3)' }}>Loading profile…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ borderColor: 'rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.05)' }}>
          <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: '#dc2626' }}>Could not load profile</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'User'

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-5">

      {/* Header card */}
      <div className="rounded-2xl border p-5 flex items-center gap-4"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <Avatar name={profile?.full_name} email={profile?.email} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-1)' }}>{displayName}</h1>
            {roleBadge(profile?.role)}
          </div>
          <p className="text-sm truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{profile?.email}</p>
        </div>
      </div>

      {/* Account details */}
      <div className="rounded-2xl border p-4" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Account Details</p>
        <InfoRow icon={Mail}     label="Email"       value={profile?.email} />
        <InfoRow icon={Shield}   label="Role"        value={profile?.role} />
        <InfoRow icon={Calendar} label="Joined"      value={ts(profile?.created_at)} />
        <InfoRow icon={Clock}    label="Last active" value={ts(profile?.last_seen_at)} />
        <div className="flex items-center gap-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <User size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--text-3)' }}>Sessions</span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            {profile?.active_sessions ?? '—'} active
          </span>
        </div>
      </div>

      {/* Display name */}
      <div className="rounded-2xl border p-4" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Display Name</p>
          {!editingName && (
            <button onClick={() => { setEditingName(true); setNameMsg(null) }}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border"
              style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>
        {editingName ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              className="input w-full px-3 py-2 rounded-lg text-sm"
              placeholder="Your full name"
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
            />
            <div className="flex items-center gap-2">
              <button onClick={saveName} disabled={nameSaving}
                className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                <Check size={12} /> {nameSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEditingName(false); setNameVal(profile?.full_name || '') }}
                className="text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-1)' }}>
            {profile?.full_name || <span style={{ color: 'var(--text-3)' }}>No display name set</span>}
          </p>
        )}
        {nameMsg && (
          <p className="text-xs mt-2 flex items-center gap-1.5"
            style={{ color: nameMsg.ok ? '#16a34a' : '#dc2626' }}>
            {nameMsg.ok ? <Check size={11} /> : <AlertCircle size={11} />}
            {nameMsg.text}
          </p>
        )}
      </div>

      {/* Change password */}
      <div className="rounded-2xl border p-4" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Password</p>
          <button onClick={() => { setShowPwForm(v => !v); setPwMsg(null); setPw({ current: '', newPw: '', confirm: '' }) }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border"
            style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
            <Key size={11} /> {showPwForm ? 'Cancel' : 'Change password'}
          </button>
        </div>

        {showPwForm ? (
          <form onSubmit={changePassword} className="space-y-2.5">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Current password</label>
              <input type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))}
                className="input w-full px-3 py-2 rounded-lg text-sm" placeholder="Current password" required />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>New password</label>
              <input type="password" value={pw.newPw} onChange={e => setPw(p => ({ ...p, newPw: e.target.value }))}
                className="input w-full px-3 py-2 rounded-lg text-sm" placeholder="At least 8 characters" required />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Confirm new password</label>
              <input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
                className="input w-full px-3 py-2 rounded-lg text-sm" placeholder="Repeat new password" required />
            </div>
            <button type="submit" disabled={pwSaving}
              className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
              <Key size={12} /> {pwSaving ? 'Changing…' : 'Change password'}
            </button>
          </form>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>••••••••</p>
        )}

        {pwMsg && (
          <p className="text-xs mt-2 flex items-center gap-1.5"
            style={{ color: pwMsg.ok ? '#16a34a' : '#dc2626' }}>
            {pwMsg.ok ? <Check size={11} /> : <AlertCircle size={11} />}
            {pwMsg.text}
          </p>
        )}
      </div>

      {/* Danger zone */}
      <div className="rounded-2xl border p-4"
        style={{ background: 'var(--card-bg)', borderColor: 'rgba(220,38,38,0.2)' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#dc2626' }}>Sign Out</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
          This will end your current session and return you to the login screen.
        </p>
        <button onClick={logout}
          className="text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
          style={{ color: '#dc2626', borderColor: 'rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.06)' }}>
          Sign out
        </button>
      </div>

    </div>
  )
}
