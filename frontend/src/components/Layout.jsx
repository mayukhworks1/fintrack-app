import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp,
  Sun, Moon, WifiOff
} from 'lucide-react'
import clsx from 'clsx'
import { useState, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'

const nav = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard, end: true },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban },
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
      <WifiOff size={12} style={{ color: '#f87171' }} />
      <span className="text-xs" style={{ color: '#f87171' }}>Offline</span>
    </div>
  )
}

export default function Layout({ children }) {
  const { dark, toggle } = useTheme()

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Sidebar — uses var(--bg-sidebar) so it responds to light/dark */}
      <aside
        className="w-56 flex flex-col flex-shrink-0 relative"
        style={{
          background: 'var(--bg-sidebar)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid var(--border)',
          transition: 'background 0.3s ease, border-color 0.3s ease',
        }}
        aria-label="Main navigation"
      >
        {/* Subtle gradient orb */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div style={{
            position: 'absolute', top: -80, left: -40,
            width: 200, height: 200,
            background: 'radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%)',
          }} />
        </div>

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 relative"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              boxShadow: '0 4px 14px rgba(34,197,94,0.4)',
            }}>
            <TrendingUp size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight" style={{ color: 'var(--text-1)' }}>FinTrack</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>AI Finance Manager</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2.5 space-y-0.5 relative" aria-label="Sections">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={({ isActive }) => isActive
                ? {
                    background: 'linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(34,197,94,0.05) 100%)',
                    border: '1px solid rgba(34,197,94,0.22)',
                    color: '#22c55e',
                  }
                : {
                    color: 'var(--text-2)',
                    border: '1px solid transparent',
                  }
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} aria-hidden="true"
                    style={{ color: isActive ? '#22c55e' : 'var(--text-3)' }} />
                  <span className="flex-1" style={{ color: isActive ? '#22c55e' : 'var(--text-2)' }}>
                    {label}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <OfflineBanner />

        {/* Theme toggle */}
        <div className="p-3 relative" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={toggle}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="flex items-center gap-2">
              {dark
                ? <Sun  size={14} style={{ color: '#facc15' }} />
                : <Moon size={14} style={{ color: '#818cf8' }} />
              }
              <span style={{ color: 'var(--text-2)' }}>{dark ? 'Light mode' : 'Dark mode'}</span>
            </span>

            {/* Animated pill */}
            <div className="w-9 h-5 rounded-full relative flex-shrink-0 transition-all duration-300"
              style={{ background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(34,197,94,0.35)' }}>
              <div className="absolute top-1 w-3 h-3 rounded-full transition-all duration-300"
                style={{
                  background: dark ? 'rgba(255,255,255,0.55)' : '#16a34a',
                  left: dark ? '3px' : 'calc(100% - 15px)',
                  boxShadow: dark ? 'none' : '0 0 6px rgba(34,197,94,0.6)',
                }} />
            </div>
          </button>

          <p className="text-xs text-center mt-2.5" style={{ color: 'var(--text-3)' }}>
            Powered by OpenRouter AI
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main
        id="main-content"
        className="flex-1 overflow-y-auto animate-fade-in"
        style={{ background: 'var(--bg-base)', transition: 'background 0.3s ease' }}
      >
        {children}
      </main>
    </div>
  )
}
