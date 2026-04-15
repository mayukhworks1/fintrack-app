import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, BarChart3,
  MessageSquareText, FileText, TrendingUp, Wifi, WifiOff
} from 'lucide-react'
import clsx from 'clsx'
import { useState, useEffect } from 'react'

const nav = [
  { to: '/',          label: 'Dashboard',    icon: LayoutDashboard,     end: true },
  { to: '/projects',  label: 'Projects',     icon: FolderKanban },
  { to: '/analytics', label: 'Analytics',    icon: BarChart3 },
  { to: '/ai',        label: 'AI Assistant', icon: MessageSquareText },
  { to: '/report',    label: 'Report',       icon: FileText },
]

function OnlineIndicator() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
      <WifiOff size={13} className="text-red-400 flex-shrink-0" />
      <span className="text-xs text-red-400">Offline</span>
    </div>
  )
}

export default function Layout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-56 bg-surface-800 border-r border-surface-700 flex flex-col flex-shrink-0"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-surface-700">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <TrendingUp size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm leading-tight">FinTrack</p>
            <p className="text-xs text-gray-500 truncate">AI Finance Manager</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2.5 space-y-0.5" aria-label="App sections">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-500/20 text-brand-400'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-surface-700'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                  {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-400" aria-hidden="true" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <OnlineIndicator />

        {/* Footer */}
        <div className="p-3 border-t border-surface-700">
          <p className="text-xs text-gray-600 text-center">Powered by OpenRouter AI</p>
        </div>
      </aside>

      {/* Main */}
      <main
        id="main-content"
        className="flex-1 overflow-y-auto bg-surface-900 animate-fade-in"
        tabIndex={-1}
      >
        {children}
      </main>
    </div>
  )
}
