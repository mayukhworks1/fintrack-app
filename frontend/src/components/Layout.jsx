import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp,
  Sun, Moon, WifiOff, Menu, X, LogOut, Receipt,
  ChevronLeft, ChevronRight, ShieldCheck, Activity,
  Plus, Landmark, FileSpreadsheet, Layers
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

/* ── New quick-action button with animated popover ── */
const NEW_OPTIONS = [
  {
    id: 'invoice',
    label: 'Invoice',
    sub: 'Raise & track a client payment',
    icon: Receipt,
    to: '/invoices?new=1',
    accent: '#7d95ff',
    accentBg: 'rgba(125,149,255,0.12)',
    accentBorder: 'rgba(125,149,255,0.22)',
    badge: '↵ Enter',
  },
  {
    id: 'project',
    label: 'Project',
    sub: 'Start a new client engagement',
    icon: Layers,
    to: '/projects/new',
    accent: '#84e254',
    accentBg: 'rgba(132,226,84,0.10)',
    accentBorder: 'rgba(132,226,84,0.20)',
    badge: null,
  },
]

function NewQuickAction({ collapsed }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState('invoice')
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const navigate = useNavigate()
  const { dark } = useTheme()

  const openPopover = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const POPOVER_W = 272
    const POPOVER_H = 190 // approx
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Prefer below the button; fall back to above if not enough room
    let top = rect.bottom + 8
    if (top + POPOVER_H > vh - 12) top = rect.top - POPOVER_H - 8

    // Prefer left-aligned with button; clamp to viewport
    let left = rect.left
    if (left + POPOVER_W > vw - 12) left = vw - POPOVER_W - 12
    if (left < 12) left = 12

    setPopoverPos({ top, left })
    setHovered('invoice')
    setMounted(true)
    requestAnimationFrame(() => requestAnimationFrame(() => { setOpen(true); setVisible(true) }))
  }, [])

  const closePopover = useCallback(() => {
    setVisible(false)
    setOpen(false)
    setTimeout(() => setMounted(false), 240)
  }, [])

  const pick = useCallback((opt) => {
    closePopover()
    navigate(opt.to)
  }, [closePopover, navigate])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { closePopover(); return }
      if (e.key === 'Enter') {
        const opt = NEW_OPTIONS.find(o => o.id === hovered)
        if (opt) pick(opt)
      }
    }
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return
      closePopover()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open, closePopover])

  const bg       = dark ? '#1c2030'                      : '#ffffff'
  const border   = dark ? 'rgba(255,255,255,0.10)'       : 'rgba(15,23,42,0.09)'
  const shadow   = dark ? '0 32px 80px rgba(0,0,0,0.5)' : '0 16px 48px rgba(15,23,42,0.14)'
  const labelClr = dark ? 'rgba(255,255,255,0.32)'       : 'rgba(15,23,42,0.38)'
  const titleClr = dark ? 'rgba(255,255,255,0.92)'       : '#152033'
  const subClr   = dark ? 'rgba(255,255,255,0.35)'       : '#6b7280'
  const iconDim  = dark ? 'rgba(255,255,255,0.38)'       : '#9ca3af'
  const rowHovBg = (opt) => opt.accentBg
  const iconBg   = dark ? 'rgba(255,255,255,0.05)'       : 'rgba(15,23,42,0.04)'
  const iconBdr  = dark ? 'rgba(255,255,255,0.08)'       : 'rgba(15,23,42,0.08)'

  const popover = mounted && createPortal(
    <div
      role="dialog"
      aria-label="Create new"
      style={{
        position: 'fixed',
        top: popoverPos.top,
        left: popoverPos.left,
        zIndex: 99999,
        width: 272,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 20,
        boxShadow: shadow,
        padding: '8px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(-6px)',
        transformOrigin: 'top left',
        transition: 'opacity 0.22s ease, transform 0.22s cubic-bezier(.34,1.56,.64,1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: labelClr, padding: '6px 10px 8px', userSelect: 'none' }}>
        Create new
      </p>

      {NEW_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const isHov = hovered === opt.id
        return (
          <button
            key={opt.id}
            onClick={() => pick(opt)}
            onMouseEnter={() => setHovered(opt.id)}
            onFocus={() => setHovered(opt.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 14,
              border: `1px solid ${isHov ? opt.accentBorder : 'transparent'}`,
              background: isHov ? rowHovBg(opt) : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s, border-color 0.15s, transform 0.15s',
              transform: isHov ? 'translateX(3px)' : 'translateX(0)',
              marginBottom: 2,
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: isHov ? opt.accentBg : iconBg,
              border: `1px solid ${isHov ? opt.accentBorder : iconBdr}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s, border-color 0.15s',
            }}>
              <Icon size={18} style={{ color: isHov ? opt.accent : iconDim, transition: 'color 0.15s' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: isHov ? opt.accent : titleClr, margin: 0, transition: 'color 0.15s' }}>
                {opt.label}
              </p>
              <p style={{ fontSize: 11, color: subClr, margin: '2px 0 0', lineHeight: 1.35 }}>
                {opt.sub}
              </p>
            </div>
            {opt.badge && (
              <span style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
                padding: '3px 7px', borderRadius: 8,
                color: opt.accent, background: opt.accentBg,
                border: `1px solid ${opt.accentBorder}`,
                flexShrink: 0, fontFamily: 'monospace',
              }}>
                {opt.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body
  )

  return (
    <div className="runey-quick-action">
      <button
        ref={btnRef}
        onClick={open ? closePopover : openPopover}
        className={`runey-new-button ${collapsed ? 'is-collapsed' : ''}`}
        title={collapsed ? 'Create new…' : undefined}
        aria-label={collapsed ? 'Create new' : undefined}
        aria-expanded={open}
      >
        <Plus size={collapsed ? 18 : 15}
          style={{ transition: 'transform 0.25s cubic-bezier(.34,1.56,.64,1)', transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }} />
        {!collapsed && <span>New</span>}
      </button>
      {popover}
    </div>
  )
}

/* ── Brand icon — minimal fin/track monogram ── */
function BrandIcon({ size = 28 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="ft-bg" x1="3" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A2140" />
          <stop offset="1" stopColor="#0A0F1E" />
        </linearGradient>
        <linearGradient id="ft-accent" x1="9" y1="7" x2="24" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7D95FF" />
          <stop offset="1" stopColor="#8CE35A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ft-bg)" />
      <path
        d="M10 7.5C10 6.67 10.67 6 11.5 6H22C22.83 6 23.5 6.67 23.5 7.5C23.5 8.33 22.83 9 22 9H13V13H20.25C21.08 13 21.75 13.67 21.75 14.5C21.75 15.33 21.08 16 20.25 16H13V24.5C13 25.33 12.33 26 11.5 26C10.67 26 10 25.33 10 24.5V7.5Z"
        fill="white"
      />
      <path
        d="M17.25 18.5L22.75 13"
        stroke="url(#ft-accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <circle cx="23.25" cy="12.5" r="2.3" fill="url(#ft-accent)" />
    </svg>
  )
}

// roles that can see each nav item
const NAV_ITEMS = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard, end: true,  roles: ['editor','viewer'] },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban,                roles: ['editor','viewer'] },
  { to: '/invoices',  label: 'Invoices',     icon: Receipt,                     roles: ['editor','viewer'] },
  { to: '/tax',       label: 'Tax Ledger',   icon: Landmark,                    roles: ['editor'] },
  { to: '/analytics', label: 'Analytics',    icon: BarChart3,                   roles: ['editor','viewer'] },
  { to: '/ai',        label: 'AI Assistant', icon: MessageSquareText,           roles: ['editor'] },
  { to: '/report',    label: 'Report',       icon: FileText,                    roles: ['editor'] },
  { to: '/status',    label: 'Status Board', icon: Activity,                    roles: ['editor','viewer'] },
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
  const { logout, isEditor, isViewer, role, user } = useAuth()
  const visibleNav = NAV_ITEMS.filter(item => item.roles.includes(role))

  const displayName = user?.full_name || user?.email?.split('@')[0] || 'My Account'
  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : (user?.email || 'U')[0].toUpperCase()
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
            <BrandIcon size={collapsed ? 28 : 28} />
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
          {user?.avatar_url
            ? <img
                src={user.avatar_url}
                alt={displayName}
                className="runey-profile-avatar object-cover"
                onError={e => { e.currentTarget.style.display = 'none' }}
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

export default function Layout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed,  setCollapsed]  = useState(() => {
    try { return localStorage.getItem('ft-sidebar-collapsed') === '1' } catch { return false }
  })

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
    <div className="main-app-theme app-layout-shell flex h-screen overflow-hidden">

      {/* ── Skip to content ── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        Skip to content
      </a>

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
            <BrandIcon size={28} />
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
