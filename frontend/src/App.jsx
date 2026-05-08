import { lazy, Suspense } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Analytics as VercelAnalytics } from '@vercel/analytics/react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'           // eager — landing route
import Login from './pages/Login'                   // eager — auth gate
import AdminDashboard from './pages/AdminDashboard' // eager — admin role
import { useAuth } from './context/AuthContext'

/* Lazy-loaded routes — split into separate chunks for snappier initial paint */
const Projects      = lazy(() => import('./pages/Projects'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Invoices      = lazy(() => import('./pages/Invoices'))
const Analytics     = lazy(() => import('./pages/Analytics'))
const AIAssistant   = lazy(() => import('./pages/AIAssistant'))
const Report        = lazy(() => import('./pages/Report'))
const WebInvoices   = lazy(() => import('./pages/WebInvoices'))

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
              <Route path="/analytics"    element={<Analytics />} />
              <Route path="/ai"           element={<AIAssistant />} />
              <Route path="/report"       element={<Report />} />
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
