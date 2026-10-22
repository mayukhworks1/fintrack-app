// Extracted from WebInvoices.jsx — nav.
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useAvatarSrc } from '../../hooks/useAvatarSrc'
import { Briefcase, ChevronLeft, ChevronRight, FileText, Globe, HelpCircle, LayoutDashboard, LogOut, Moon, Plus, Receipt, Repeat2, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

export function MobileHeader({ onHelp, onLogout }) {
  const { dark, toggle } = useTheme()
  return (
    <div className="sm:hidden flex-shrink-0 flex items-center justify-between px-3"
      style={{
        height: 'calc(48px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
        background: 'var(--sidebar-bg)',
        borderBottom: '1px solid var(--sidebar-border)',
        zIndex: 10,
      }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
          <Globe size={12} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>TheWorks</p>
          <p className="text-[9px] leading-none" style={{ color: 'var(--text-3)' }}>Web Tracker</p>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button onClick={onHelp} title="Help & Guide"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <HelpCircle size={16} />
        </button>
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          {dark
            ? <Sun size={16} style={{ color: '#facc15' }} />
            : <Moon size={16} style={{ color: '#818cf8' }} />}
        </button>
        <button onClick={onLogout} title="Sign out"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  )
}

/* ── Mobile-only bottom navigation bar ── */

export function MobileBottomNav({ workspace, setWorkspace, isAll, canViewProjects, canViewTax }) {
  const navItems = [
    { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { value: 'invoices',  label: 'Invoices',  icon: FileText },
    { value: 'retainers', label: 'Retainers', icon: Repeat2 },
    ...(canViewProjects ? [{ value: 'projects', label: 'Projects', icon: Briefcase }] : []),
    ...(canViewTax      ? [{ value: 'tax',      label: 'Tax',      icon: Receipt }]   : []),
  ]
  return (
    <nav className="sm:hidden flex-shrink-0 flex items-stretch border-t"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
        /* Push content above iPhone home indicator */
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
      {navItems.map(({ value, label, icon: Icon }) => {
        const active = workspace === value
        return (
          <button key={value} onClick={() => setWorkspace(value)}
            className="relative flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors"
            style={{ color: active ? 'var(--accent)' : 'var(--text-3)', minHeight: 52 }}>
            {active && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                style={{ background: 'var(--accent)' }} />
            )}
            <Icon size={18} style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ── Collapsible app sidebar ── */

export function AppSidebar({ workspace, setWorkspace, isAll, canViewProjects, canViewTax, open, onToggle, onHelp, onNew }) {
  const { logout, user } = useAuth()
  const { dark, toggle } = useTheme()
  const avatarSrc = useAvatarSrc(user?.avatar_url)
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.full_name || user?.email?.split('@')[0] || 'User'
  const displaySub = user?.email || 'Web billing'
  const initials = (displayName || '?')
    .split(' ')
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const navItems = [
    { value: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
    { value: 'invoices',   label: 'Invoices',   icon: FileText },
    { value: 'retainers',  label: 'Retainers',  icon: Repeat2 },
    ...(canViewProjects ? [{ value: 'projects', label: 'Projects',  icon: Briefcase }] : []),
    ...(canViewTax      ? [{ value: 'tax',      label: 'Tax Ledger', icon: Receipt }]  : []),
  ]

  return (
    <aside
      className={`web-runey-sidebar runey-app-sidebar hidden sm:flex flex-col flex-shrink-0 transition-all duration-200 z-20 ${open ? '' : 'is-collapsed'}`}
      style={{
        width: open ? 200 : 76,
        overflow: 'visible',
      }}>

      {/* Brand + toggle */}
      <div className={`runey-sidebar-header ${open ? '' : 'is-collapsed'}`}>
        <div className="runey-brand-link min-w-0 overflow-hidden">
          <span className="runey-brand-mark">
            <Globe size={15} style={{ color: '#111' }} />
          </span>
          {open && (
            <div className="min-w-0">
              <p className="runey-brand-title">TheWorks</p>
              <p className="runey-brand-subtitle">Web Tracker</p>
            </div>
          )}
        </div>
        <button onClick={onToggle} title={open ? 'Collapse' : 'Expand'}
          className="runey-collapse-button">
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {onNew && (
        <div className="runey-quick-action">
          <button
            type="button"
            onClick={() => { setWorkspace('invoices'); onNew() }}
            className={`runey-new-button ${open ? '' : 'is-collapsed'}`}
            title={open ? undefined : 'New invoice'}
            aria-label={open ? undefined : 'New invoice'}
          >
            <Plus size={open ? 15 : 18} />
            {open && <span>New Invoice</span>}
          </button>
        </div>
      )}

      {/* Nav items */}
      <nav className={`runey-nav ${open ? '' : 'is-collapsed'}`}>
        {navItems.map(({ value, label, icon: Icon }) => {
          const active = workspace === value
          return (
            <button key={value} onClick={() => setWorkspace(value)}
              title={!open ? label : undefined}
              className={`runey-nav-link ${open ? '' : 'is-collapsed'} ${active ? 'active' : ''}`}>
              <Icon size={15} className="flex-shrink-0" style={{ flexShrink: 0 }} />
              {open && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer: help + theme + logout */}
      <div className={`runey-sidebar-footer ${open ? '' : 'is-collapsed'}`}>
        {onHelp && (
          <button onClick={onHelp} title="Help & Guide" className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
            <HelpCircle size={14} style={{ flexShrink: 0 }} />
            {open && <span className="text-xs">Help</span>}
          </button>
        )}
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'} className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
          {dark
            ? <Sun size={14} style={{ flexShrink: 0 }} />
            : <Moon size={14} style={{ flexShrink: 0 }} />}
          {open && <span className="text-xs">{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        <button onClick={logout} title="Sign out" className={`runey-nav-link ${open ? '' : 'is-collapsed'}`}>
          <LogOut size={13} style={{ flexShrink: 0 }} />
          {open && <span className="text-xs">Sign out</span>}
        </button>
        <Link
          to="/profile"
          className={`runey-profile ${open ? '' : 'is-collapsed'}`}
          style={{ textDecoration: 'none' }}
          title={!open ? displayName : undefined}
        >
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="runey-profile-avatar object-cover"
            />
          ) : (
            <span className="runey-profile-avatar">{initials}</span>
          )}
          {open && (
            <div className="min-w-0">
              <p>{displayName}</p>
              <span>{displaySub}</span>
            </div>
          )}
        </Link>
      </div>
    </aside>
  )
}

/* ── Main page ── */
