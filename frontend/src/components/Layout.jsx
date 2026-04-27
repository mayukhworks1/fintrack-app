import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp,
  Sun, Moon, WifiOff, Menu, X, LogOut, Receipt
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

function OfflineBanner() {
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
    <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <WifiOff size={12} style={{ color: '#f87171' }} aria-hidden="true" />
      <span className="text-xs" style={{ color: '#f87171' }}>Offline</span>
    </div>
  )
}

function SidebarContent({ onClose }) {
  const { dark, toggle } = useTheme()
  const { logout } = useAuth()
  const location = useLocation()

  // Close drawer on navigation (mobile)
  useEffect(() => {
    if (onClose) onClose()
  }, [location.pathname]) // eslint-disable-line

  return (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-5"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent)' }}>
            <TrendingUp size={15} className="text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>FinTrack</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>AI Finance Manager</p>
          </div>
        </div>
        {/* Close button — only visible on mobile drawer */}
        {onClose && (
          <button onClick={onClose} aria-label="Close navigation"
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-2.5 space-y-0.5" aria-label="Main navigation">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={({ isActive }) => isActive
              ? { background: 'var(--bg-input)', color: 'var(--text-1)' }
              : { color: 'var(--text-2)' }
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={15} aria-hidden="true" style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)' }} />
                <span className="flex-1">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <OfflineBanner />

      {/* Theme toggle */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="flex items-center gap-2">
            {dark ? <Sun size={14} style={{ color: '#facc15' }} aria-hidden="true" />
                  : <Moon size={14} style={{ color: '#818cf8' }} aria-hidden="true" />}
            <span style={{ color: 'var(--text-2)' }}>{dark ? 'Light mode' : 'Dark mode'}</span>
          </span>
          <div className="w-9 h-5 rounded-full relative flex-shrink-0 transition-all duration-300"
            style={{ background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(34,197,94,0.35)' }}>
            <div className="absolute top-1 w-3 h-3 rounded-full transition-all duration-300"
              style={{ background: dark ? 'rgba(255,255,255,0.55)' : '#16a34a', left: dark ? '3px' : 'calc(100% - 15px)', boxShadow: dark ? 'none' : '0 0 6px rgba(34,197,94,0.6)' }} />
          </div>
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs mt-2 transition-all"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label="Sign out"
        >
          <LogOut size={12} aria-hidden="true" />
          <span>Sign out</span>
        </button>
        <p className="text-[10px] text-center mt-2.5" style={{ color: 'var(--text-3)' }}>
          Powered by OpenRouter AI
        </p>
      </div>
    </>
  )
}

export default function Layout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on ESC key
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') setDrawerOpen(false)
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Skip to content (accessibility) ── */}
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: '#22c55e', color: '#fff' }}>
        Skip to content
      </a>

      {/* ── Desktop sidebar (always visible ≥ lg) ── */}
      <aside
        className="hidden lg:flex w-56 flex-col flex-shrink-0 relative"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}
        aria-label="Sidebar"
      >
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer panel ── */}
      <aside
        className="lg:hidden fixed top-0 left-0 h-full w-64 z-50 flex flex-col transition-transform duration-300"
        style={{
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
        aria-label="Mobile navigation"
        aria-hidden={!drawerOpen}
      >
        <SidebarContent onClose={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent)' }}>
              <TrendingUp size={13} className="text-white" aria-hidden="true" />
            </div>
            <span className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>FinTrack</span>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-all"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <Menu size={18} />
          </button>
        </header>

        <main
          id="main-content"
          className="flex-1 overflow-y-auto animate-fade-in"
          style={{ background: 'var(--bg-base)', transition: 'background 0.3s ease' }}
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
