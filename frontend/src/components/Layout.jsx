import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp,
  Sun, Moon, WifiOff, Menu, X, LogOut, Receipt,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard, end: true },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban },
  { to: '/invoices',  label: 'Invoices',     icon: Receipt },
  { to: '/analytics', label: 'Analytics',    icon: BarChart3 },
  { to: '/ai',        label: 'AI Assistant', icon: MessageSquareText },
  { to: '/report',    label: 'Report',       icon: FileText },
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
    <div className={`mx-2 mb-2 flex items-center gap-2 px-2 py-2 rounded-lg ${collapsed ? 'justify-center' : ''}`}
      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
      <WifiOff size={12} style={{ color: '#f87171', flexShrink: 0 }} aria-hidden="true" />
      {!collapsed && <span className="text-xs" style={{ color: '#f87171' }}>Offline</span>}
    </div>
  )
}

function SidebarContent({ onClose, collapsed, onToggleCollapse }) {
  const { dark, toggle } = useTheme()
  const { logout } = useAuth()
  const location = useLocation()

  // Close mobile drawer on navigation
  useEffect(() => {
    if (onClose) onClose()
  }, [location.pathname]) // eslint-disable-line

  return (
    <>
      {/* Logo + collapse button */}
      <div className={`flex items-center px-3 py-4 ${collapsed ? 'justify-center' : 'justify-between'}`}
        style={{ borderBottom: '1px solid var(--border)' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-btn)' }}>
              <TrendingUp size={13} className="text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate" style={{ color: 'var(--text-1)' }}>FinTrack</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>AI Finance Manager</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent-btn)' }}>
            <TrendingUp size={13} className="text-white" aria-hidden="true" />
          </div>
        )}
        {/* Close button mobile / collapse button desktop */}
        {onClose ? (
          <button onClick={onClose} aria-label="Close navigation"
            className="lg:hidden btn-icon" style={{ padding: '0.3rem' }}>
            <X size={14} />
          </button>
        ) : onToggleCollapse ? (
          <button onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="btn-icon" style={{ padding: '0.3rem' }}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        ) : null}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            title={collapsed ? label : undefined}
            className={`flex items-center rounded-md text-[13px] font-medium transition-colors ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}
            style={({ isActive }) => isActive
              ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-color)', borderLeft: '2px solid var(--accent)' }
              : { color: 'var(--text-3)', borderLeft: '2px solid transparent' }
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={15} aria-hidden="true"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }} />
                {!collapsed && (
                  <span className="flex-1 truncate font-medium"
                    style={{ color: isActive ? 'var(--nav-active-color)' : 'var(--text-2)' }}>
                    {label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <OfflineBanner collapsed={collapsed} />

      {/* Bottom controls */}
      <div className="p-2" style={{ borderTop: '1px solid var(--border)' }}>
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className={`w-full flex items-center rounded-lg text-sm transition-colors mb-1 ${collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'}`}
          style={{ color: 'var(--text-2)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
        >
          {dark
            ? <Sun size={14} style={{ color: '#facc15', flexShrink: 0 }} aria-hidden="true" />
            : <Moon size={14} style={{ color: '#818cf8', flexShrink: 0 }} aria-hidden="true" />}
          {!collapsed && (
            <>
              <span className="flex-1 text-[13px]" style={{ color: 'var(--text-2)' }}>{dark ? 'Light mode' : 'Dark mode'}</span>
              {/* Mini toggle pill */}
              <div className="w-8 h-4 rounded-full relative flex-shrink-0 transition-all duration-300"
                style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(37,99,235,0.25)' }}>
                <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-300"
                  style={{ background: dark ? 'rgba(255,255,255,0.5)' : '#2563eb', left: dark ? '2px' : 'calc(100% - 14px)' }} />
              </div>
            </>
          )}
        </button>

        {/* Sign out */}
        <button
          onClick={logout}
          className={`w-full flex items-center rounded-lg text-xs transition-colors ${collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'}`}
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
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [collapsed,   setCollapsed]   = useState(() => {
    try { return localStorage.getItem('ft-sidebar-collapsed') === '1' } catch { return false }
  })

  const toggleCollapse = useCallback(() => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('ft-sidebar-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  // Close drawer on ESC
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
    <div className="flex h-screen overflow-hidden">

      {/* ── Skip to content ── */}
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: 'var(--accent)', color: '#fff' }}>
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
        }}
        aria-label="Sidebar"
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* ── Mobile drawer overlay (for theme/signout overflow) ── */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 animate-fade-in"
          style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer panel ── */}
      <aside
        className="lg:hidden fixed top-0 left-0 h-full w-64 z-50 flex flex-col transition-transform duration-300"
        style={{
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          boxShadow: drawerOpen ? '4px 0 24px rgba(0,0,0,0.12)' : 'none',
        }}
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
      >
        <SidebarContent collapsed={false} onClose={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile top bar — clean, sticky, no clutter */}
        <header className="lg:hidden flex items-center justify-between px-4 py-2.5 flex-shrink-0 sticky top-0 z-30"
          style={{
            background: 'var(--sidebar-bg)',
            borderBottom: '1px solid var(--sidebar-border)',
            backdropFilter: 'blur(12px)',
          }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open settings menu"
            className="flex items-center gap-2 -ml-0.5 p-1 rounded-xl">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
              <TrendingUp size={13} className="text-white" aria-hidden="true" />
            </div>
            <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>FinTrack</span>
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            className="btn-icon"
            style={{ padding: '0.375rem' }}>
            <Menu size={15} />
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

        {/* ── Mobile bottom navigation — primary items, sticky bottom ── */}
        <MobileBottomNav />
      </div>
    </div>
  )
}

/* ── Mobile bottom nav — 5 primary destinations, hidden on lg+ ── */
function MobileBottomNav() {
  const primary = [
    { to: '/',          label: 'Home',     icon: LayoutDashboard, end: true },
    { to: '/projects',  label: 'Projects', icon: FolderKanban },
    { to: '/invoices',  label: 'Invoices', icon: Receipt },
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
        boxShadow: '0 -4px 16px rgba(15,23,42,0.04)',
      }}
    >
      {primary.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors relative"
          style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text-3)' })}
          aria-label={label}
        >
          {({ isActive }) => (
            <>
              {/* Top accent bar on active */}
              {isActive && (
                <span aria-hidden="true"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full"
                  style={{ background: 'var(--accent)' }} />
              )}
              {/* Icon with subtle pill bg when active */}
              <span className="flex items-center justify-center rounded-xl transition-all duration-200"
                style={{
                  width: 40, height: 28,
                  background: isActive ? 'var(--nav-active-bg)' : 'transparent',
                }}>
                <Icon size={18} aria-hidden="true" strokeWidth={isActive ? 2.5 : 1.8} />
              </span>
              <span className={`text-[10px] tracking-tight transition-all ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
