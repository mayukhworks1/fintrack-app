import { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Analytics as VercelAnalytics } from '@vercel/analytics/react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'  // eager — landing route
import Login from './pages/Login'          // eager — auth gate
const AdminDashboard = lazyWithReload(() => import('./pages/AdminDashboard'))
import { useAuth } from './context/AuthContext'

const BANNER_H = 37

function ImpersonationBanner() {
  const { isImpersonating, impersonation, exitImpersonation } = useAuth()
  const navigate = useNavigate()
  const handleExit = useCallback(() => {
    // exitImpersonation clears state synchronously before any awaits,
    // so the banner disappears instantly. Verify + navigate happen right after.
    exitImpersonation().then(() => navigate('/')).catch(() => navigate('/'))
  }, [exitImpersonation, navigate])
  if (!isImpersonating) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      height: BANNER_H,
      background: '#b45309', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', fontSize: 13, fontWeight: 600,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={15} />
        <span>Impersonating <strong>{impersonation?.targetUser?.full_name || impersonation?.targetUser?.email || 'user'}</strong>
          {impersonation?.targetUser?.full_name && impersonation?.targetUser?.email &&
            <span style={{ opacity: 0.75, fontWeight: 400 }}> · {impersonation.targetUser.email}</span>}
        </span>
      </div>
      <button onClick={handleExit}
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: '4px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
        ✕ Exit impersonation
      </button>
    </div>
  )
}

/* Lazy-loaded routes — split into separate chunks for snappier initial paint */
const CHUNK_RELOAD_KEY = 'fintrack:chunk-reload'

function isChunkLoadError(error) {
  const msg = String(error?.message || error || '')
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Failed to load module script') ||
    msg.includes('error loading dynamically imported module')
  )
}

function lazyWithReload(importer) {
  return lazy(async () => {
    try {
      const mod = await importer()
      try { sessionStorage.removeItem(CHUNK_RELOAD_KEY) } catch {}
      return mod
    } catch (error) {
      if (typeof window !== 'undefined' && isChunkLoadError(error)) {
        try {
          const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
          if (!alreadyReloaded) {
            sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
            window.location.reload()
            return new Promise(() => {})
          }
        } catch {}
      }
      throw error
    }
  })
}

const Projects      = lazyWithReload(() => import('./pages/Projects'))
const ProjectDetail = lazyWithReload(() => import('./pages/ProjectDetail'))
const Invoices      = lazyWithReload(() => import('./pages/Invoices'))
const Analytics     = lazyWithReload(() => import('./pages/Analytics'))
const AIAssistant   = lazyWithReload(() => import('./pages/AIAssistant'))
const Report        = lazyWithReload(() => import('./pages/Report'))
const StatusBoard   = lazyWithReload(() => import('./pages/StatusBoard'))
const WebInvoices   = lazyWithReload(() => import('./pages/WebInvoices'))
const TaxLedger     = lazyWithReload(() => import('./pages/TaxLedger'))
const SharedView    = lazyWithReload(() => import('./pages/SharedView'))  // public — no auth
const Profile       = lazyWithReload(() => import('./pages/Profile'))

// Main-app pages to prefetch on idle for editor/viewer sessions only.
// Web/'all' users render WebInvoices exclusively, so prefetching these
// (incl. the ~382KB recharts chunk pulled by Analytics/AIAssistant) would
// be pure wasted bandwidth for them — especially on mobile.
const WARM_IMPORTERS_MAIN = [
  () => import('./pages/Projects'),
  () => import('./pages/Invoices'),
  () => import('./pages/StatusBoard'),
  () => import('./pages/Analytics'),
  () => import('./pages/AIAssistant'),
  () => import('./pages/Report'),
]
// Web/'all' users only ever need the web project workspace.
const WARM_IMPORTERS_WEB = [
  () => import('./pages/TaxLedger'),
]

/* Lightweight chunk-loading fallback */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20" aria-live="polite">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

export default function App() {
  const { status, isWeb, isAll, isAdmin, isViewer, isImpersonating } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (status !== 'authed' || isAdmin) return
    const importers = (isWeb || isAll) ? WARM_IMPORTERS_WEB : WARM_IMPORTERS_MAIN
    const runner = () => {
      for (const load of importers) load().catch(() => {})
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(runner, { timeout: 1200 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(runner, 600)
    return () => window.clearTimeout(t)
  }, [status, isAdmin, isWeb, isAll])

  // ── Public routes — no authentication required ──────────────────────────
  if (location.pathname.startsWith('/view/')) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/view/:token" element={<SharedView />} />
          </Routes>
        </Suspense>
        <VercelAnalytics />
      </ErrorBoundary>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-3)' }} />
      </div>
    )
  }

  if (status !== 'authed') return <Login />

  // Admin role: full PostgreSQL dashboard
  if (isAdmin) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <AdminDashboard />
        </Suspense>
        <VercelAnalytics />
      </ErrorBoundary>
    )
  }

  // Web + All roles: isolated experience — web invoice module (+ project workspace for 'all')
  if (isWeb || isAll) {
    return (
      <ErrorBoundary>
        <ImpersonationBanner />
        {/* Banner is fixed-position; shift only the scrollable content area, not the shell */}
        <div style={isImpersonating ? { '--impersonation-banner-h': `${BANNER_H}px` } : undefined}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/profile" element={<Profile />} />
              <Route path="*" element={<WebInvoices />} />
            </Routes>
          </Suspense>
        </div>
        <VercelAnalytics />
      </ErrorBoundary>
    )
  }

  return (
    <>
      <ImpersonationBanner />
      <Layout style={isImpersonating ? { paddingTop: BANNER_H } : undefined}>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/"             element={<Dashboard />} />
              <Route path="/projects"     element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/invoices"     element={<Invoices />} />
              <Route path="/tax"          element={isViewer ? <ViewerGuard /> : <TaxLedger />} />
              <Route path="/analytics"    element={<Analytics />} />
              <Route path="/ai"           element={isViewer ? <ViewerGuard /> : <AIAssistant />} />
              <Route path="/report"       element={isViewer ? <ViewerGuard /> : <Report />} />
              <Route path="/status"       element={<StatusBoard />} />
              <Route path="/admin"        element={isViewer ? <ViewerGuard /> : <AdminDashboard embedded={true} />} />
              <Route path="/profile"      element={<Profile />} />
              <Route path="*"             element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
      <VercelAnalytics />
    </>
  )
}

function ViewerGuard() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-5xl mb-4">🔒</p>
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Access restricted</p>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>You don't have permission to view this page.</p>
      <Link to="/" className="btn-primary">Go to dashboard</Link>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-7xl font-bold mb-3 tabular-nums" style={{ color: 'var(--text-3)', letterSpacing: '-0.04em' }}>404</p>
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Page not found</p>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>This route doesn't exist.</p>
      <Link to="/" className="btn-primary">Go to dashboard</Link>
    </div>
  )
}
