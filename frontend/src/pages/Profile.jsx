import { useState, useEffect, useCallback, useRef } from 'react'
import {
  User, Mail, Shield, Calendar, Clock, Key, Check, AlertCircle,
  Pencil, X, Phone, Briefcase, Building2, MapPin, Globe2,
  Unlink, LogOut, RefreshCw, Info,
  Camera, Trash2,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useAvatarSrc } from '../hooks/useAvatarSrc'
import { useToast } from '../context/ToastContext'
import { ts } from '../utils/dates'
import AppearancePicker from '../components/AppearancePicker'

function Avatar({ name, email, avatarUrl, size = 56 }) {
  const src = useAvatarSrc(avatarUrl)
  const initials = name
    ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (email || '?')[0].toUpperCase()
  if (src) {
    return (
      <img
        src={src}
        alt={name || email || 'Avatar'}
        className="rounded-full flex-shrink-0 object-cover"
        style={{ width: size, height: size, boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 25%, transparent)' }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0 select-none"
      style={{
        width: size, height: size,
        background: 'var(--avatar-gradient)',
        color: 'var(--accent-fg)',
        fontSize: size * 0.35,
        letterSpacing: '0.02em',
        boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)',
      }}
    >
      {initials}
    </div>
  )
}

const ROLE_STYLE = {
  superadmin: { label: 'Super Admin', bg: 'color-mix(in srgb, var(--fin-negative) 10%, transparent)',   fg: 'var(--fin-negative)' },
  admin:      { label: 'Admin',       bg: 'color-mix(in srgb, var(--fin-negative) 10%, transparent)',   fg: 'var(--fin-negative)' },
  editor:     { label: 'Editor',      bg: 'color-mix(in srgb, var(--accent) 12%, transparent)',  fg: 'var(--accent)' },
  viewer:     { label: 'Viewer',      bg: 'color-mix(in srgb, var(--text-3) 12%, transparent)', fg: 'var(--text-2)' },
  user:       { label: 'User',        bg: 'color-mix(in srgb, var(--fin-positive) 10%, transparent)',   fg: 'var(--fin-positive)' },
  web:        { label: 'Web Invoice User', bg: 'var(--kpi-3-bg)', fg: 'var(--kpi-3-fg)' },
  all:        { label: 'Workspace User',   bg: 'var(--kpi-5-bg)', fg: 'var(--kpi-5-fg)' },
}
function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] || { label: role || 'Unknown', bg: 'color-mix(in srgb, var(--text-3) 12%, transparent)', fg: 'var(--text-2)' }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  )
}

function Card({ children, className = '', style = {} }) {
  return (
    <div className={`rounded-2xl border p-5 ${className}`}
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest mb-3"
      style={{ color: 'var(--text-3)' }}>{children}</p>
  )
}

function InfoRow({ icon: Icon, label, value, mono = false, accent = false }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0"
      style={{ borderColor: 'var(--border)' }}>
      <Icon size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
      <span className="text-xs w-28 flex-shrink-0 pt-px" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`text-sm flex-1 break-all ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: accent ? 'var(--accent)' : value ? 'var(--text-1)' : 'var(--text-3)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────────── */
export default function Profile() {
  const { logout, updateUser } = useAuth()
  const toast = useToast()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Profile editing
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', job_title: '', department: '', company: '', location: '', timezone: '' })
  const [saving, setSaving] = useState(false)

  // Password
  const [showPw, setShowPw] = useState(false)
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)

  // Avatar upload
  const avatarInputRef = useRef(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Only image files allowed', 'error'); return
    }
    if (file.size > 4 * 1024 * 1024) {
      toast('Image must be under 4 MB', 'error'); return
    }
    setAvatarUploading(true)
    try {
      const res = await api.auth.uploadAvatar(file)
      setProfile(p => ({ ...p, avatar_url: res.avatar_url }))
      updateUser({ avatar_url: res.avatar_url })
      toast('Profile picture updated', 'success')
    } catch (err) {
      toast(err.message || 'Upload failed', 'error')
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }

  const handleAvatarDelete = async () => {
    setAvatarUploading(true)
    try {
      await api.auth.deleteAvatar()
      setProfile(p => ({ ...p, avatar_url: null }))
      updateUser({ avatar_url: null })
      toast('Profile picture removed', 'success')
    } catch (err) {
      toast(err.message || 'Failed to remove', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await api.auth.getProfile()
      setProfile(data)
      setForm({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        phone: data.phone || '',
        job_title: data.job_title || '',
        department: data.department || '',
        company: data.company || '',
        location: data.location || '',
        timezone: data.timezone || '',
      })
    } catch (e) {
      setError(e.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({
    first_name: profile?.first_name || '', last_name: profile?.last_name || '', phone: profile?.phone || '',
    job_title: profile?.job_title || '', department: profile?.department || '',
    company: profile?.company || '', location: profile?.location || '',
    timezone: profile?.timezone || '',
  })

  const saveProfile = async () => {
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, String(v || '').trim() || null])
      )
      const res = await api.auth.updateProfile(payload)
      setProfile(p => ({ ...p, ...res }))
      setEditing(false)
      toast('Profile updated successfully', 'success')
    } catch (e) {
      toast(e.message || 'Failed to update', 'error')
    } finally {
      setSaving(false)
    }
  }

  const changePw = async (e) => {
    e.preventDefault()
    if (pw.newPw !== pw.confirm) { toast('Passwords do not match', 'error'); return }
    if (pw.newPw.length < 8) { toast('Minimum 8 characters', 'error'); return }
    setPwSaving(true)
    try {
      const res = await api.auth.changePassword({ current_password: pw.current, new_password: pw.newPw })
      toast(res.message || 'Password changed successfully', 'success')
      setPw({ current: '', newPw: '', confirm: '' })
      setShowPw(false)
    } catch (e) {
      toast(e.message || 'Failed to change password', 'error')
    } finally {
      setPwSaving(false)
    }
  }

  /* ── Loading / error states ── */
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px] gap-2"
        style={{ color: 'var(--text-3)' }}>
        <RefreshCw size={14} className="animate-spin" />
        <span className="text-sm">Loading profile…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ borderColor: 'color-mix(in srgb, var(--fin-negative) 25%, transparent)', background: 'color-mix(in srgb, var(--fin-negative) 5%, transparent)' }}>
          <AlertCircle size={16} style={{ color: 'var(--fin-negative)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--fin-negative)' }}>Could not load profile</p>
            <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-3)' }}>{error}</p>
            <button onClick={load} className="text-xs px-2.5 py-1 rounded-lg border inline-flex items-center gap-1.5"
              style={{ borderColor: 'color-mix(in srgb, var(--fin-negative) 30%, transparent)', color: 'var(--fin-negative)' }}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.full_name || profile?.email?.split('@')[0] || 'User'
  const googleIdentity = (profile?.identities || []).find(i => i.provider === 'google')
  const zohoIdentity   = (profile?.identities || []).find(i => i.provider === 'zoho')
  const hasPassword = Boolean(profile?.password_changed_at || profile?.email)

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-4">

      {/* ── Hero header ── */}
      <Card className="flex items-center gap-4">
        {/* Avatar with upload overlay */}
        <div className="relative flex-shrink-0 group" style={{ width: 64, height: 64 }}>
          {/* Spinning progress ring while uploading */}
          {avatarUploading && (
            <svg className="absolute inset-0 animate-spin" width="64" height="64" viewBox="0 0 64 64"
              style={{ zIndex: 10 }}>
              <circle cx="32" cy="32" r="30" fill="none" strokeWidth="3"
                stroke="color-mix(in srgb, var(--accent) 20%, transparent)" />
              <circle cx="32" cy="32" r="30" fill="none" strokeWidth="3"
                stroke="var(--accent)" strokeLinecap="round"
                strokeDasharray="48 140" />
            </svg>
          )}
          <Avatar name={[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.full_name} email={profile?.email} avatarUrl={profile?.avatar_url} size={64} />
          {/* Hover/upload overlay */}
          <button
            onClick={() => !avatarUploading && avatarInputRef.current?.click()}
            disabled={avatarUploading}
            className={`absolute inset-0 rounded-full flex items-center justify-center transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            style={{ background: avatarUploading ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.5)', cursor: avatarUploading ? 'wait' : 'pointer' }}
            title={avatarUploading ? 'Uploading…' : 'Change photo'}
          >
            {avatarUploading
              ? <span className="text-[10px] font-semibold" style={{ color: '#fff' }}>…</span>
              : <Camera size={16} style={{ color: '#fff' }} />
            }
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              {displayName}
            </h1>
            <RoleBadge role={profile?.role} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>{profile?.email}</p>
          {profile?.job_title && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              {profile.job_title}{profile?.company ? ` · ${profile.company}` : ''}
            </p>
          )}
          {/* Avatar action row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button
              onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors"
              style={{ color: 'var(--accent)', borderColor: 'var(--accent)', background: 'var(--accent-dim, color-mix(in srgb, var(--accent) 8%, transparent))', opacity: avatarUploading ? 0.7 : 1 }}
            >
              {avatarUploading
                ? <><RefreshCw size={10} className="animate-spin" /> Uploading…</>
                : <><Camera size={10} /> {profile?.avatar_url ? 'Change photo' : 'Add photo'}</>
              }
            </button>
            {profile?.avatar_url && (
              <button
                onClick={handleAvatarDelete}
                disabled={avatarUploading}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors"
                style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}
              >
                <Trash2 size={10} /> Remove
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Account details ── */}
      <Card>
        <SectionLabel>Account Details</SectionLabel>
        <InfoRow icon={Mail}     label="Email"            value={profile?.email} />
        <InfoRow icon={Shield}   label="Role"             value={profile?.role} />
        <InfoRow icon={Calendar} label="Joined"           value={ts(profile?.created_at)} />
        <InfoRow icon={Clock}    label="Last active"      value={ts(profile?.last_seen_at)} />
        {profile?.approved_at && (
          <InfoRow icon={Check}  label="Approved"         value={ts(profile.approved_at)} accent />
        )}
        <div className="flex items-start gap-3 py-2.5 border-b last:border-0"
          style={{ borderColor: 'var(--border)' }}>
          <User size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
          <span className="text-xs w-28 flex-shrink-0 pt-px" style={{ color: 'var(--text-3)' }}>Sessions</span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            {profile?.active_sessions ?? 0} active
            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              ({profile?.total_sessions ?? 0} total)
            </span>
          </span>
        </div>
      </Card>

      {/* ── Connected accounts ── */}
      <Card>
        <SectionLabel>Connected Accounts</SectionLabel>

        {/* Google */}
        <div className="flex items-center gap-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
            style={{ background: 'white', color: 'var(--accent)', border: '1px solid rgba(148,163,184,0.4)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            G
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Google</p>
            {googleIdentity
              ? <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {googleIdentity.email} · last used {ts(googleIdentity.last_seen_at)}
                </p>
              : <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Not connected</p>
            }
          </div>
          {googleIdentity
            ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--fin-positive) 10%, transparent)', color: 'var(--fin-positive)' }}>
                <Check size={10} /> Connected
              </span>
            : <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--text-3) 10%, transparent)', color: 'var(--text-3)' }}>
                <Unlink size={10} /> Not linked
              </span>
          }
        </div>

        {/* Zoho */}
        <div className="flex items-center gap-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
            style={{ background: 'var(--danger-btn)', color: 'var(--danger-fg)', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
            Z
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Zoho</p>
            {zohoIdentity
              ? <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {zohoIdentity.email} · last used {ts(zohoIdentity.last_seen_at)}
                </p>
              : <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Not connected</p>
            }
          </div>
          {zohoIdentity
            ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--fin-positive) 10%, transparent)', color: 'var(--fin-positive)' }}>
                <Check size={10} /> Connected
              </span>
            : <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--text-3) 10%, transparent)', color: 'var(--text-3)' }}>
                <Unlink size={10} /> Not linked
              </span>
          }
        </div>

        {/* Email / password auth */}
        <div className="flex items-center gap-3 py-3">
          <Mail size={16} className="flex-shrink-0" style={{ color: 'var(--text-3)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Email & Password</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {hasPassword
                ? `Password ${profile?.password_changed_at ? `last changed ${ts(profile.password_changed_at)}` : 'set'}`
                : 'No password set'
              }
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: hasPassword ? 'color-mix(in srgb, var(--fin-positive) 10%, transparent)' : 'color-mix(in srgb, var(--text-3) 10%, transparent)', color: hasPassword ? 'var(--fin-positive)' : 'var(--text-3)' }}>
            {hasPassword ? <><Check size={10} /> Active</> : <><Unlink size={10} /> None</>}
          </span>
        </div>

        {/* Teable email note */}
        {profile?.teable_email && profile.teable_email !== profile.email && (
          <div className="mt-1 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs"
            style={{ background: 'color-mix(in srgb, var(--accent) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)' }}>
            <Info size={12} className="flex-shrink-0 mt-px" style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-2)' }}>
              Your Teable "Raised By" identity is <strong>{profile.teable_email}</strong> — invoices matching this email are linked to your account.
            </span>
          </div>
        )}
      </Card>

      {/* ── Profile details ── */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <SectionLabel>Profile Details</SectionLabel>
          </div>
          {!editing && (
            <button
              onClick={() => { resetForm(); setEditing(true) }}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
              style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--bg-input)' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['first_name',  'First name',   'Mayukh',            User],
                ['last_name',   'Last name',    'Jain',              User],
                ['phone',       'Phone',        '+91 98765 43210',   Phone],
                ['job_title',   'Role / title', 'Finance Executive', Briefcase],
                ['department',  'Department',   'Accounts',          Building2],
                ['company',     'Company',      'TheWorks',          Building2],
                ['location',    'Location',     'Mumbai, India',     MapPin],
                ['timezone',    'Timezone',     'Asia/Kolkata',      Globe2],
              ].map(([key, label, placeholder, Icon]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium flex items-center gap-1"
                    style={{ color: 'var(--text-3)' }}>
                    <Icon size={10} /> {label}
                  </span>
                  <input
                    value={form[key] || ''}
                    onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))}
                    className="input px-3 py-2 rounded-xl text-sm"
                    placeholder={placeholder}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={saveProfile} disabled={saving}
                className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                <Check size={12} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button onClick={() => { setEditing(false); resetForm() }}
                className="text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
                style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow icon={User}      label="First name"  value={profile?.first_name} />
            <InfoRow icon={User}      label="Last name"   value={profile?.last_name} />
            <InfoRow icon={Phone}     label="Phone"       value={profile?.phone} />
            <InfoRow icon={Briefcase} label="Title"       value={profile?.job_title} />
            <InfoRow icon={Building2} label="Department"  value={profile?.department} />
            <InfoRow icon={Building2} label="Company"     value={profile?.company} />
            <InfoRow icon={MapPin}    label="Location"    value={profile?.location} />
            <InfoRow icon={Globe2}    label="Timezone"    value={profile?.timezone} />
          </div>
        )}
      </Card>

      {/* ── Appearance ── */}
      <Card>
        <SectionLabel>Appearance</SectionLabel>
        <AppearancePicker />
      </Card>

      {/* ── Security: password ── */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <SectionLabel>Security</SectionLabel>
          <button
            onClick={() => { setShowPw(v => !v); setPw({ current: '', newPw: '', confirm: '' }) }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
            style={{ color: 'var(--text-2)', borderColor: 'var(--border)', background: 'var(--bg-input)' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <Key size={11} /> {showPw ? 'Cancel' : 'Change password'}
          </button>
        </div>

        {!showPw && (
          <div className="flex items-center gap-3 py-2">
            <Key size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--text-3)' }}>Password</span>
            <span className="text-sm tracking-[0.3em]" style={{ color: 'var(--text-3)' }}>••••••••</span>
          </div>
        )}

        {showPw && (
          <form onSubmit={changePw} className="space-y-3 mt-1">
            {[
              ['current',  'Current password',     'current-password'],
              ['newPw',    'New password',          'new-password'],
              ['confirm',  'Confirm new password',  'new-password'],
            ].map(([field, label, autocomplete]) => (
              <div key={field}>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>{label}</label>
                <input
                  type="password"
                  value={pw[field]}
                  onChange={e => setPw(p => ({ ...p, [field]: e.target.value }))}
                  className="input w-full px-3 py-2 rounded-xl text-sm"
                  placeholder={field === 'newPw' ? 'At least 8 characters' : ''}
                  autoComplete={autocomplete}
                  required
                />
              </div>
            ))}
            <button type="submit" disabled={pwSaving}
              className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
              <Key size={12} /> {pwSaving ? 'Changing…' : 'Change password'}
            </button>
          </form>
        )}
      </Card>

      {/* ── Sign out ── */}
      <Card style={{ borderColor: 'color-mix(in srgb, var(--fin-negative) 18%, transparent)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--fin-negative)' }}>Sign out</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Ends your current session and returns you to the login screen.
            </p>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all flex-shrink-0"
            style={{ color: 'var(--fin-negative)', borderColor: 'color-mix(in srgb, var(--fin-negative) 30%, transparent)', background: 'color-mix(in srgb, var(--fin-negative) 6%, transparent)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--fin-negative) 12%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--fin-negative) 6%, transparent)' }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </Card>

    </div>
  )
}
