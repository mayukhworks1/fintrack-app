import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Analytics as VercelAnalytics } from '@vercel/analytics/react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'           // eager — landing route
import Login from './pages/Login'                   // eager — auth gate
import AdminDashboard from './pages/AdminDashboard' // eager — admin role
import { useAuth } from './context/AuthContext'

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

const WARM_IMPORTERS = [
  () => import('./pages/Projects'),
  () => import('./pages/Invoices'),
  () => import('./pages/StatusBoard'),
  () => import('./pages/Analytics'),
  () => import('./pages/AIAssistant'),
  () => import('./pages/Report'),
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
  const { status, isWeb, isAll, isAdmin } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (status !== 'authed' || isAdmin) return
    const runner = () => {
      for (const load of WARM_IMPORTERS) load().catch(() => {})
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(runner, { timeout: 1200 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(runner, 600)
    return () => window.clearTimeout(t)
  }, [status, isAdmin])

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
        <AdminDashboard />
        <VercelAnalytics />
      </ErrorBoundary>
    )
  }

  // Web + All roles: isolated experience — web invoice module (+ project workspace for 'all')
  if (isWeb || isAll) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <>
            <WebInvoices />
            <VercelAnalytics />
          </>
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/"             element={<Dashboard />} />
              <Route path="/projects"     element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/invoices"     element={<Invoices />} />
              <Route path="/tax"          element={<TaxLedger />} />
              <Route path="/analytics"    element={<Analytics />} />
              <Route path="/ai"           element={<AIAssistant />} />
              <Route path="/report"       element={<Report />} />
              <Route path="/status"       element={<StatusBoard />} />
              <Route path="/admin"        element={<AdminDashboard embedded={true} />} />
              <Route path="*"             element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
      <VercelAnalytics />
    </>
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
