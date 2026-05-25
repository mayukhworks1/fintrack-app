import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp,
  Sun, Moon, WifiOff, Menu, X, LogOut, Receipt,
  ChevronLeft, ChevronRight, ShieldCheck, Activity
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

/* ── Brand icon — matches favicon.svg exactly ── */
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
        <linearGradient id="ft-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#ft-bg)" />
      <rect x="4"    y="22" width="5" height="5"  rx="1.5" fill="white" opacity="0.45" />
      <rect x="13.5" y="16" width="5" height="11" rx="1.5" fill="white" opacity="0.70" />
      <rect x="23"   y="10" width="5" height="17" rx="1.5" fill="white" opacity="0.95" />
      <polyline points="6.5,22 16,16 25.5,10"
        stroke="white" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <circle cx="25.5" cy="10" r="2.5" fill="white" />
    </svg>
  )
}

const nav = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard, end: true },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban },
  { to: '/invoices',  label: 'Invoices',     icon: Receipt },
  { to: '/analytics', label: 'Analytics',    icon: BarChart3 },
  { to: '/ai',        label: 'AI Assistant', icon: MessageSquareText },
  { to: '/report',    label: 'Report',       icon: FileText },
  { to: '/status',    label: 'Status Board', icon: Activity },
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
  const { logout, isEditor } = useAuth()
  const location = useLocation()

  // Close mobile drawer on navigation
  useEffect(() => {
    if (onClose) onClose()
  }, [location.pathname]) // eslint-disable-line

  return (
    <>
      {/* Logo + collapse/close button */}
      <div
        className={`flex items-center px-3 py-4 ${collapsed ? 'justify-center' : 'justify-between'}`}
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Logo — links to dashboard */}
        <Link
          to="/"
          aria-label="FinTrack — go to dashboard"
          className="flex items-center gap-2.5 min-w-0 rounded-lg"
          style={{ textDecoration: 'none' }}
        >
          <BrandIcon size={collapsed ? 28 : 28} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate" style={{ color: 'var(--text-1)' }}>FinTrack</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>AI Finance Manager</p>
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
            className="btn-icon"
            style={{ padding: '0.3rem' }}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        ) : null}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={`flex items-center rounded-md text-[13px] font-medium transition-colors ${
              collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
            }`}
            style={({ isActive }) => isActive
              ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', borderLeft: '2px solid var(--accent)', boxShadow: 'inset 0 0 0 1px rgba(47,91,255,0.06)' }
              : { color: 'var(--text-3)', borderLeft: '2px solid transparent' }
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={15}
                  aria-hidden="true"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }}
                />
                {!collapsed && (
                  <span
                    className="flex-1 truncate font-medium"
                    style={{ color: isActive ? 'var(--nav-active-color)' : 'var(--text-2)' }}
                  >
                    {label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}

        {/* Admin — editor role only */}
        {isEditor && (
          <>
            {!collapsed && (
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}>
                Admin
              </p>
            )}
            {collapsed && <div className="my-1 mx-2" style={{ borderTop: '1px solid var(--border)' }} />}
            <NavLink
              to="/admin"
              title={collapsed ? 'Admin Panel' : undefined}
              aria-label={collapsed ? 'Admin Panel' : undefined}
              className={`flex items-center rounded-md text-[13px] font-medium transition-colors ${
                collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'
              }`}
              style={({ isActive }) => isActive
                ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', borderLeft: '2px solid var(--accent)', boxShadow: 'inset 0 0 0 1px rgba(47,91,255,0.06)' }
                : { color: 'var(--text-3)', borderLeft: '2px solid transparent' }
              }
            >
              {({ isActive }) => (
                <>
                  <ShieldCheck
                    size={15}
                    aria-hidden="true"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }}
                  />
                  {!collapsed && (
                    <span
                      className="flex-1 truncate font-medium"
                      style={{ color: isActive ? 'var(--nav-active-color)' : 'var(--text-2)' }}
                    >
                      Admin Panel
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </>
        )}
      </nav>

      <OfflineBanner collapsed={collapsed} />

      {/* Bottom controls */}
      <div className="p-2" style={{ borderTop: '1px solid var(--border)' }}>
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className={`w-full flex items-center rounded-lg text-sm transition-colors mb-1 ${
            collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
          }`}
          style={{ color: 'var(--text-2)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
        >
          {dark
            ? <Sun  size={14} style={{ color: '#facc15', flexShrink: 0 }} aria-hidden="true" />
            : <Moon size={14} style={{ color: '#818cf8', flexShrink: 0 }} aria-hidden="true" />}
          {!collapsed && (
            <>
              <span className="flex-1 text-[13px]" style={{ color: 'var(--text-2)' }}>
                {dark ? 'Light mode' : 'Dark mode'}
              </span>
              {/* Mini toggle pill */}
              <div
                className="w-8 h-4 rounded-full relative flex-shrink-0 transition-all duration-300"
                style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(37,99,235,0.25)' }}
                aria-hidden="true"
              >
                <div
                  className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-300"
                  style={{
                    background: dark ? 'rgba(255,255,255,0.5)' : '#2563eb',
                    left: dark ? '2px' : 'calc(100% - 14px)',
                  }}
                />
              </div>
            </>
          )}
        </button>

        {/* Sign out */}
        <button
          onClick={logout}
          className={`w-full flex items-center rounded-lg text-xs transition-colors ${
            collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
          }`}
          style={{ color: 'var(--text-3)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label="Sign out"
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
          {!collapsed && <span>Sign out</span>}
        </button>

        {!collapsed && (
          <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-3)' }}>
            Powered by OpenRouter AI
          </p>
        )}
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

  const sidebarW = collapsed ? 56 : 224

  return (
    <div className="main-app-theme flex h-screen overflow-hidden">

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
        className="hidden lg:flex flex-col flex-shrink-0 relative overflow-hidden"
        style={{
          width: sidebarW,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          transition: 'width 0.2s ease',
          boxShadow: '0 0 0 1px rgba(15,23,42,0.01)',
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
        className="lg:hidden fixed top-0 left-0 h-full w-64 z-50 flex flex-col transition-transform duration-300"
        style={{
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
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
