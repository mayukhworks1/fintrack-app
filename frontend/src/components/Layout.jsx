import { NavLink, Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText,
  Sun, Moon, WifiOff, Menu, X, LogOut, Receipt,
  ChevronLeft, ChevronRight, ShieldCheck, Activity,
  Plus, Landmark, FileSpreadsheet, Layers, Globe
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { useAvatarSrc } from '../hooks/useAvatarSrc'
import BrandMark from './BrandMark'

/* ── New Invoice quick-action button ── */
function NewQuickAction({ collapsed }) {
  const navigate = useNavigate()
  return (
    <div className="runey-quick-action">
      <button
        onClick={() => navigate('/invoices?new=1')}
        className={`runey-new-button ${collapsed ? 'is-collapsed' : ''}`}
        title={collapsed ? 'New Invoice' : undefined}
        aria-label="New Invoice"
      >
        <Plus size={collapsed ? 18 : 15} />
        {!collapsed && <span>New Invoice</span>}
      </button>
    </div>
  )
}

// roles that can see each nav item; perm = permission key required (null = always show)
const NAV_ITEMS = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard, end: true,  roles: ['editor','viewer'], perm: 'module.dashboard.view' },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban,                roles: ['editor','viewer'], perm: 'module.projects.view' },
  { to: '/invoices',  label: 'Invoices',     icon: Receipt,                     roles: ['editor','viewer'], perm: 'module.invoices.view' },
  { to: '/tax',       label: 'Tax Ledger',   icon: Landmark,                    roles: ['editor'],          perm: 'module.tax.view' },
  { to: '/analytics', label: 'Analytics',    icon: BarChart3,                   roles: ['editor','viewer'], perm: 'module.analytics.view' },
  { to: '/ai',        label: 'AI Assistant', icon: MessageSquareText,           roles: ['editor'],          perm: 'module.ai.use' },
  { to: '/report',    label: 'Report',       icon: FileText,                    roles: ['editor'],          perm: 'module.reports.view' },
  { to: '/status',    label: 'Status Board', icon: Activity,                    roles: ['editor','viewer'], perm: 'module.status.view' },
  { to: '/pages',     label: 'Pages',        icon: Globe,                       roles: ['editor','viewer'], perm: null },
]

function OfflineBanner({ collapsed }) {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-2 mb-2 flex items-center gap-2 px-2 py-2 rounded-lg ${collapsed ? 'justify-center' : ''}`}
      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
    >
      <WifiOff size={12} style={{ color: '#f87171', flexShrink: 0 }} aria-hidden="true" />
      {!collapsed && <span className="text-xs" style={{ color: '#f87171' }}>You're offline</span>}
    </div>
  )
}

function SidebarContent({ onClose, collapsed, onToggleCollapse }) {
  const { dark, toggle } = useTheme()
  const { logout, isEditor, isViewer, role, user, hasPerm } = useAuth()
  // Filter by role first; then split into accessible vs permission-restricted
  const roleNav = NAV_ITEMS.filter(item => item.roles.includes(role))
  const visibleNav = roleNav.filter(item => !item.perm || hasPerm(item.perm))
  const restrictedNav = roleNav.filter(item => item.perm && !hasPerm(item.perm))

  const fullDisplayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.full_name || ''
  const displayName = fullDisplayName || user?.email?.split('@')[0] || 'My Account'
  const initials = fullDisplayName
    ? fullDisplayName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (user?.email || 'U')[0].toUpperCase()
  const avatarSrc = useAvatarSrc(user?.avatar_url)
  const location = useLocation()

  // Close mobile drawer on navigation
  useEffect(() => {
    if (onClose) onClose()
  }, [location.pathname]) // eslint-disable-line

  return (
    <>
      {/* Logo + collapse/close button */}
      <div
        className={`runey-sidebar-header ${collapsed ? 'is-collapsed' : ''}`}
      >
        {/* Logo — links to dashboard */}
        <Link
          to="/"
          aria-label="FinTrack — go to dashboard"
          className="runey-brand-link"
          style={{ textDecoration: 'none' }}
        >
          <span className="runey-brand-mark">
            {/* Sidebar is #171717 in every theme — the reversed mark reads there. */}
            <BrandMark size={30} variant="glyph" />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="runey-brand-title">FinTrack</p>
              <p className="runey-brand-subtitle">AI Finance Manager</p>
            </div>
          )}
        </Link>

        {/* Close button (mobile) / Collapse button (desktop) */}
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close navigation menu"
            className="lg:hidden btn-icon"
            style={{ padding: '0.3rem' }}
          >
            <X size={14} />
          </button>
        ) : onToggleCollapse ? (
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="runey-collapse-button"
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        ) : null}
      </div>

      {/* Only editors can create things */}
      {isEditor && <NewQuickAction collapsed={collapsed} />}

      {/* Nav links */}
      <nav className={`runey-nav ${collapsed ? 'is-collapsed' : ''}`} aria-label="Main navigation">
        {visibleNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) => `runey-nav-link ${collapsed ? 'is-collapsed' : ''} ${isActive ? 'active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={15}
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                />
                {!collapsed && (
                  <span className="flex-1 truncate font-medium">{label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Permission-restricted nav items — shown dimmed with tooltip */}
        {restrictedNav.length > 0 && restrictedNav.map(({ to, label, icon: Icon }) => (
          <div
            key={to}
            title={`${label} — not available with your current permissions`}
            aria-label={`${label} — access restricted`}
            className={`runey-nav-link ${collapsed ? 'is-collapsed' : ''}`}
            style={{ opacity: 0.38, cursor: 'not-allowed', pointerEvents: 'auto' }}
          >
            <Icon size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span className="flex-1 truncate font-medium">{label}</span>
            )}
            {!collapsed && (
              <span style={{ fontSize: '0.6rem', color: 'var(--text-3)', flexShrink: 0 }}>No access</span>
            )}
          </div>
        ))}

        {/* Admin — editor role only */}
        {isEditor && (
          <>
            {!collapsed && (
              <p className="runey-nav-section">
                Admin
              </p>
            )}
            {collapsed && <div className="runey-nav-divider" />}
            <NavLink
              to="/admin"
              title={collapsed ? 'Admin Panel' : undefined}
              aria-label={collapsed ? 'Admin Panel' : undefined}
              className={({ isActive }) => `runey-nav-link ${collapsed ? 'is-collapsed' : ''} ${isActive ? 'active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <ShieldCheck
                    size={15}
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  />
                  {!collapsed && (
                    <span className="flex-1 truncate font-medium">Admin Panel</span>
                  )}
                </>
              )}
            </NavLink>
          </>
        )}
      </nav>

      <OfflineBanner collapsed={collapsed} />

      {/* Bottom controls */}
      <div className={`runey-sidebar-footer ${collapsed ? 'is-collapsed' : ''}`}>
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className={`runey-nav-link ${collapsed ? 'is-collapsed' : ''}`}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
        >
          {dark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          {!collapsed && (
            <>
              <span className="flex-1 truncate font-medium">
                {dark ? 'Light mode' : 'Dark mode'}
              </span>
            </>
          )}
        </button>

        <button
          onClick={logout}
          className={`runey-nav-link ${collapsed ? 'is-collapsed' : ''}`}
          aria-label="Sign out"
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={15} aria-hidden="true" />
          {!collapsed && <span className="flex-1 truncate font-medium">Sign out</span>}
        </button>

        <Link
          to="/profile"
          className={`runey-profile ${collapsed ? 'is-collapsed' : ''}`}
          style={{ textDecoration: 'none' }}
          title={collapsed ? displayName : undefined}
        >
          {avatarSrc
            ? <img
                src={avatarSrc}
                alt={displayName}
                className="runey-profile-avatar object-cover"
              />
            : <span className="runey-profile-avatar" style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', fontSize: 11, fontWeight: 700,
              }}>{initials}</span>
          }
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate">{displayName}</p>
              <span className="truncate">{user?.email ? user.email : 'Workspace owner'}</span>
            </div>
          )}
        </Link>
      </div>
    </>
  )
}

export default function Layout({ children, style }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed,  setCollapsed]  = useState(() => {
    try { return localStorage.getItem('ft-sidebar-collapsed') === '1' } catch { return false }
  })
  const location = useLocation()
  const mainRef  = useRef(null)
  const scrollKey = `ft-scroll:${location.pathname}`

  // Save scroll position before navigating away
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const save = () => {
      try { sessionStorage.setItem(`ft-scroll:${location.pathname}`, String(el.scrollTop)) } catch {}
    }
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [location.pathname])

  // Restore scroll position when route changes
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    try {
      const saved = sessionStorage.getItem(scrollKey)
      el.scrollTop = saved ? parseInt(saved, 10) : 0
    } catch {
      el.scrollTop = 0
    }
  }, [location.pathname, scrollKey])

  const toggleCollapse = useCallback(() => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('ft-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  // Escape closes drawer
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') setDrawerOpen(false)
  }, [])
  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Lock body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const sidebarW = collapsed ? 76 : 200

  return (
    <div className="main-app-theme app-layout-shell flex h-screen overflow-hidden" style={style}>

      {/* ── Skip to content ── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        Skip to content
      </a>

      {/* ── Main area (sidebar + content) ── */}
      <div className="flex flex-1 overflow-hidden">

      {/* ── Desktop sidebar ── */}
      <aside
        className={`runey-app-sidebar hidden lg:flex flex-col flex-shrink-0 relative overflow-hidden ${collapsed ? 'is-collapsed' : ''}`}
        style={{
          width: sidebarW,
          transition: 'width 0.2s ease',
        }}
        aria-label="Sidebar navigation"
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 animate-fade-in"
          style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer panel ── */}
      <aside
        id="mobile-nav-drawer"
        className="runey-app-sidebar lg:hidden fixed top-0 left-0 h-full w-64 z-50 flex flex-col transition-transform duration-300"
        style={{
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          boxShadow: drawerOpen ? '8px 0 28px rgba(15,23,42,0.10)' : 'none',
        }}
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
        aria-modal={drawerOpen}
        role="dialog"
      >
        <SidebarContent collapsed={false} onClose={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ── Mobile top bar ── */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-2.5 flex-shrink-0 sticky top-0 z-30"
          style={{
            background: 'var(--sidebar-bg)',
            borderBottom: '1px solid var(--sidebar-border)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
          }}
        >
          {/* Logo — tapping navigates home */}
          <Link
            to="/"
            aria-label="FinTrack — go to dashboard"
            className="flex items-center gap-2 -ml-0.5 p-1 rounded-xl"
            style={{ textDecoration: 'none' }}
          >
            <BrandMark size={28} />
            <span
              className="font-bold text-sm tracking-tight"
              style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}
            >
              FinTrack
            </span>
          </Link>

          {/* Hamburger — opens drawer only */}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            className="btn-icon"
            style={{ padding: '0.375rem' }}
          >
            <Menu size={16} aria-hidden="true" />
          </button>
        </header>

        <main
          ref={mainRef}
          id="main-content"
          className="flex-1 overflow-y-auto animate-fade-in pb-16 lg:pb-0"
          style={{ background: 'var(--bg-base)' }}
          tabIndex={-1}
        >
          {children}
        </main>

        {/* ── Mobile bottom navigation ── */}
        <MobileBottomNav />
      </div>

      </div>{/* end main area */}
    </div>
  )
}

/* ── Mobile bottom nav — 6 primary destinations ── */
function MobileBottomNav() {
  const primary = [
    { to: '/',          label: 'Home',     icon: LayoutDashboard,   end: true },
    { to: '/projects',  label: 'Projects', icon: FolderKanban },
    { to: '/invoices',  label: 'Invoices', icon: Receipt },
    { to: '/status',    label: 'Status',   icon: Activity },
    { to: '/analytics', label: 'Stats',    icon: BarChart3 },
    { to: '/ai',        label: 'AI',       icon: MessageSquareText },
  ]

  return (
    <nav
      aria-label="Primary navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around"
      style={{
        background: 'var(--sidebar-bg)',
        borderTop: '1px solid var(--sidebar-border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -6px 24px rgba(15,23,42,0.05)',
      }}
    >
      {primary.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors relative min-w-0"
          style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text-3)' })}
          aria-label={label}
        >
          {({ isActive }) => (
            <>
              {/* Top accent bar on active */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-0.5 rounded-b-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
              {/* Icon with subtle pill bg when active */}
              <span
                className="flex items-center justify-center rounded-xl transition-all duration-200"
                style={{
                  width: 36, height: 26,
                  background: isActive ? 'var(--nav-active-bg)' : 'transparent',
                }}
                aria-hidden="true"
              >
                <Icon size={17} strokeWidth={isActive ? 2.5 : 1.8} />
              </span>
              <span className={`text-[9px] tracking-tight transition-all leading-none ${
                isActive ? 'font-semibold' : 'font-medium'
              }`}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
