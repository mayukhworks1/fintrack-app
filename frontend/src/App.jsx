import { lazy, Suspense, useEffect, useCallback, useMemo } from 'react'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Analytics as VercelAnalytics } from '@vercel/analytics/react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'          // eager — auth gate
import { prefersReducedMotion } from './hooks/useReducedMotion'
// The dashboard is the first screen after sign-in, not the first screen of a
// visit: most cold loads are the public pages and the sign-in form, and they
// were all paying for it in the entry bundle. It is warmed on idle wherever
// signing in is the likely next step (see the effect in App).
const Dashboard = lazyWithReload(() => import('./pages/Dashboard'))
const loadDashboard = () => import('./pages/Dashboard')

// Public marketing routes. Anything not listed here still goes straight to the
// sign-in form, because a deep link into the app is someone reaching for a
// screen, not for marketing. None of them is in the app bundle.
const PUBLIC_IMPORTERS = {
  '/': () => import('./pages/Landing'),
  '/features': () => import('./pages/Features'),
  '/security': () => import('./pages/Security'),
  '/how-it-works': () => import('./pages/public/HowItWorks'),
  '/customise': () => import('./pages/public/Customise'),
  '/faq': () => import('./pages/public/Faq'),
  '/terms': () => import('./pages/public/Terms'),
  '/privacy': () => import('./pages/public/Privacy'),
}
const PUBLIC_ROUTES = Object.fromEntries(
  Object.entries(PUBLIC_IMPORTERS).map(([path, load]) => [path, lazy(load)]),
)
// The public shell (header, menu, footer) is rendered once, here, around
// whichever public page is current, so it persists from page to page.
const PublicLayout = lazy(() => import('./components/PublicLayout'))

// The shell and the page are separate lazy components, and the page only
// renders once the shell has. Starting the page's import alongside the
// shell's keeps the two downloads parallel instead of one after the other.
const warmed = new Set()
function warmPublic(path) {
  if (warmed.has(path) || !PUBLIC_IMPORTERS[path]) return
  warmed.add(path)
  PUBLIC_IMPORTERS[path]().catch(() => warmed.delete(path))
}

/** Run `fn` when the browser is idle; returns a cancel function. */
function whenIdle(fn, timeout = 1200) {
  if (typeof window === 'undefined') return () => {}
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout })
    return () => window.cancelIdleCallback?.(id)
  }
  const t = window.setTimeout(fn, 600)
  return () => window.clearTimeout(t)
}
/**
 * Run `fn` once: on the first key press or pointer press anywhere, or once the
 * page has loaded and `delay` ms more have passed and the browser is idle.
 * Returns a cancel function.
 */
function afterLoadOrIntent(fn, delay = 3000) {
  if (typeof window === 'undefined') return () => {}
  let done = false
  let timer = 0
  let cancelIdle = () => {}
  const INTENT = ['keydown', 'pointerdown']
  const stop = () => {
    window.removeEventListener('load', onLoad)
    INTENT.forEach(t => window.removeEventListener(t, run, true))
    window.clearTimeout(timer)
    cancelIdle()
  }
  function run() {
    if (done) return
    done = true
    stop()
    fn()
  }
  function onLoad() {
    timer = window.setTimeout(() => { cancelIdle = whenIdle(run) }, delay)
  }
  INTENT.forEach(t => window.addEventListener(t, run, { capture: true, passive: true }))
  if (document.readyState === 'complete') onLoad()
  else window.addEventListener('load', onLoad, { once: true })
  return () => { done = true; stop() }
}
const AdminDashboard = lazyWithReload(() => import('./pages/AdminDashboard'))
import { useAuth } from './context/AuthContext'
import { isChunkLoadError } from './utils/chunkError'
import { usePageMeta } from './hooks/usePageMeta'
import { metaForPath, titleFor } from './utils/pageMeta'

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
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 99999,
      height: BANNER_H,
      background: 'rgba(146,64,14,0.92)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', fontSize: 13, fontWeight: 600,
      boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
      borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)',
      minWidth: 320, maxWidth: '90vw', gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={15} />
        <span>Impersonating <strong>{[impersonation?.targetUser?.first_name, impersonation?.targetUser?.last_name].filter(Boolean).join(' ') || impersonation?.targetUser?.full_name || impersonation?.targetUser?.email || 'user'}</strong>
          {(impersonation?.targetUser?.first_name || impersonation?.targetUser?.full_name) && impersonation?.targetUser?.email &&
            <span style={{ opacity: 0.75, fontWeight: 400 }}> · {impersonation.targetUser.email}</span>}
        </span>
      </div>
      <button onClick={handleExit}
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: '4px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
        Exit impersonation
      </button>
    </div>
  )
}

/* Lazy-loaded routes — split into separate chunks for snappier initial paint */
const CHUNK_RELOAD_KEY = 'fintrack:chunk-reload'

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
const PageViewer    = lazyWithReload(() => import('./pages/PageViewer'))  // public — no auth
const PagesManager  = lazyWithReload(() => import('./pages/PagesManager'))
const Studio        = lazyWithReload(() => import('./pages/Studio'))
const Profile       = lazyWithReload(() => import('./pages/Profile'))

// Main-app pages to prefetch on idle for editor/viewer sessions only.
// Web/'all' users render WebInvoices exclusively, so prefetching these
// (incl. the ~382KB recharts chunk pulled by Analytics/AIAssistant) would
// be pure wasted bandwidth for them — especially on mobile.
const WARM_IMPORTERS_MAIN = [
  loadDashboard,
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
  const { status, isWeb, isAll, isAdmin, isViewer } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Baseline title and description for the current route. Pages whose title
  // depends on loaded data override this once that data arrives — the override
  // lands later, and this only re-runs when the path or auth status changes, so
  // it never clobbers them on an unrelated re-render.
  //
  // Auth status is part of the decision because the signed-out app renders
  // Login at whatever path was requested; without this, arriving at /invoices
  // unauthenticated would title the sign-in screen "Invoices".
  const isPublicRoute = location.pathname.startsWith('/view/') || location.pathname.startsWith('/p/')
  const routeMeta = useMemo(() => {
    if (isPublicRoute) return metaForPath(location.pathname)
    if (status === 'loading') return { title: titleFor(null) }
    if (status !== 'authed') {
      return { title: titleFor('Sign in'), description: 'Sign in to your FinTrack workspace.' }
    }
    return metaForPath(location.pathname)
  }, [location.pathname, status, isPublicRoute])
  usePageMeta(routeMeta)

  useEffect(() => {
    if (status !== 'authed' || isAdmin) return
    const importers = (isWeb || isAll) ? WARM_IMPORTERS_WEB : WARM_IMPORTERS_MAIN
    return whenIdle(() => {
      for (const load of importers) load().catch(() => {})
    })
  }, [status, isAdmin, isWeb, isAll])

  // Warm the dashboard while a stored session is being verified: it is the
  // next thing shown, so it starts at the first idle moment.
  useEffect(() => {
    if (status !== 'loading') return
    return whenIdle(() => { loadDashboard().catch(() => {}) })
  }, [status])

  // On the sign-in form it is warmed too, but never in competition with the
  // form's own first paint: on the visitor's first keystroke or press, or a
  // few seconds after the page has finished loading, whichever comes first.
  const onSignIn = status !== 'authed' && status !== 'loading' && !isPublicRoute
    && !PUBLIC_IMPORTERS[location.pathname]
  useEffect(() => {
    if (!onSignIn) return
    return afterLoadOrIntent(() => { loadDashboard().catch(() => {}) })
  }, [onSignIn])

  // Signing in leaves the browser on /login, which is not a route once authed —
  // without this the first thing a successful login shows is Not Found.
  useEffect(() => {
    if (status === 'authed' && location.pathname === '/login') {
      navigate('/', { replace: true })
    }
  }, [status, location.pathname, navigate])

  // Scroll window to top whenever the route pathname changes, ensuring
  // clicking links/buttons never drops the user at the bottom of the next page.
  //
  // A public page's own #anchor is landed on by the public shell once the
  // (lazy) page has mounted; this handles the hash changing on a page that
  // is already showing.
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0)
      if (typeof document !== 'undefined') {
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
      }
    } else {
      let target = null
      try { target = document.getElementById(decodeURIComponent(location.hash.replace(/^#/, ''))) } catch {}
      if (target) {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      }
    }
  }, [location.pathname, location.hash])

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

  if (location.pathname.startsWith('/p/')) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/p/:slug" element={<PageViewer />} />
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

  // Unauthenticated. The root is the public product page; every other path is
  // someone reaching for a specific screen, so it goes straight to the form
  // rather than dropping them on marketing and making them find the way in.
  if (status !== 'authed') {
    const PublicPage = PUBLIC_ROUTES[location.pathname]
    if (PublicPage) {
      warmPublic(location.pathname)
      return (
        <ErrorBoundary>
          {/* One shell for every public page. It keeps the header and footer
              mounted across navigation, holds the page in its own Suspense
              boundary inside <main>, and plays the page enter on client-side
              navigations only. A page's own <PublicLayout> renders just its
              children when it is inside this one. */}
          <Suspense fallback={<div className="main-app-theme login-bg min-h-screen" aria-busy="true" />}>
            <PublicLayout>
              <PublicPage />
            </PublicLayout>
          </Suspense>
          <VercelAnalytics />
        </ErrorBoundary>
      )
    }
    return <Login />
  }

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
        <div>
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
      <Layout>
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
              <Route path="/pages"        element={<PagesManager />} />
              <Route path="/studio"       element={isViewer ? <ViewerGuard /> : <Studio />} />
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
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Access restricted</p>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>You don't have permission to view this page.</p>
      <Link to="/" className="btn-primary">Go to dashboard</Link>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-7xl font-bold mb-3 tabular-nums" style={{ color: 'var(--text-3)', letterSpacing: '-0.02em' }}>404</p>
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Page not found</p>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>This route doesn't exist.</p>
      <Link to="/" className="btn-primary">Go to dashboard</Link>
    </div>
  )
}
