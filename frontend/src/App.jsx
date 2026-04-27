import { Routes, Route } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Analytics from './pages/Analytics'
import AIAssistant from './pages/AIAssistant'
import Report from './pages/Report'
import Invoices from './pages/Invoices'
import Login from './pages/Login'
import { useAuth } from './context/AuthContext'

export default function App() {
  const { status } = useAuth()

  // While verifying a stored token, show a quiet splash
  if (status === 'loading') {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-base)' }}
      >
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-3)' }} />
      </div>
    )
  }

  if (status !== 'authed') {
    return <Login />
  }

  return (
    <Layout>
      <ErrorBoundary>
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/projects"     element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/invoices"     element={<Invoices />} />
          <Route path="/analytics"    element={<Analytics />} />
          <Route path="/ai"           element={<AIAssistant />} />
          <Route path="/report"       element={<Report />} />
          <Route path="*"             element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <p className="text-6xl font-bold mb-3" style={{ color: 'var(--text-3)' }}>404</p>
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Page not found</p>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>
        This route doesn't exist.
      </p>
      <a href="/" className="px-4 py-2 rounded-xl text-sm font-semibold"
        style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff' }}>
        Go home
      </a>
    </div>
  )
}
