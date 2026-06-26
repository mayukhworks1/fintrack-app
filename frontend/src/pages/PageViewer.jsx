import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function renderMarkdown(md) {
  if (!md) return ''
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  html = html
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul\/]|<blockquote)(.+)$/gm, (_, line) => `<p>${line}</p>`)
  return html
}

// ---------------------------------------------------------------------------
// CSV table
// ---------------------------------------------------------------------------
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] }
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()))
  return { headers, rows }
}

function CSVTable({ text }) {
  const { headers, rows } = parseCSV(text)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ border: '1px solid #e5e7eb', padding: '8px 12px', background: '#f9fafb', textAlign: 'left', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f9fafb' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: '1px solid #e5e7eb', padding: '8px 12px' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Password prompt
// ---------------------------------------------------------------------------
function PasswordPrompt({ title, onSubmit, error }) {
  const [pw, setPw] = useState('')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh',
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 12, padding: '36px 40px', maxWidth: 380, width: '100%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#111' }}>{title || 'Protected Page'}</h2>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6b7280' }}>This page is password protected.</p>
        <form onSubmit={e => { e.preventDefault(); onSubmit(pw) }}>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Enter password"
            autoFocus
            style={{
              display: 'block', width: '100%', padding: '10px 14px',
              border: '1px solid #d1d5db', borderRadius: 8,
              fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <button type="submit" style={{
            width: '100%', padding: '10px 0', background: '#3b82f6', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Unlock
          </button>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main viewer
// ---------------------------------------------------------------------------
export default function PageViewer() {
  const { slug } = useParams()
  const [state, setState] = useState('loading') // loading | requires_password | loaded | notfound | error
  const [page, setPage] = useState(null)
  const [pwError, setPwError] = useState('')
  const viewLogged = useRef(false)

  useEffect(() => {
    if (!slug) return
    api.pages.publicGet(slug).then(data => {
      if (data?.detail || data?.error) {
        setState('notfound')
        return
      }
      if (data?.requires_password) {
        setPage(data)
        setState('requires_password')
        return
      }
      setPage(data)
      setState('loaded')
    }).catch(() => setState('notfound'))
  }, [slug])

  // Log view once after content loads
  useEffect(() => {
    if (state !== 'loaded' || viewLogged.current) return
    viewLogged.current = true
    api.pages.publicLogView(slug, { referer: document.referrer }).catch(() => {})
  }, [state, slug])

  const handlePasswordSubmit = (password) => {
    setPwError('')
    api.pages.publicVerify(slug, password).then(data => {
      if (data?.detail === 'Incorrect password' || data?.detail) {
        setPwError('Incorrect password. Please try again.')
        return
      }
      setPage(data)
      setState('loaded')
    }).catch(() => setPwError('Something went wrong. Please try again.'))
  }

  // ------------------------------------------------------------------
  // States
  // ------------------------------------------------------------------
  if (state === 'loading') {
    return (
      <ViewerShell>
        <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af', fontSize: 15 }}>Loading…</div>
      </ViewerShell>
    )
  }

  if (state === 'notfound') {
    return (
      <ViewerShell>
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>404</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 8px' }}>Page not found</h2>
          <p style={{ color: '#6b7280', fontSize: 15 }}>This page doesn't exist or has been unpublished.</p>
        </div>
      </ViewerShell>
    )
  }

  if (state === 'requires_password') {
    return (
      <ViewerShell title={page?.title}>
        <PasswordPrompt title={page?.title} onSubmit={handlePasswordSubmit} error={pwError} />
      </ViewerShell>
    )
  }

  if (state === 'error') {
    return (
      <ViewerShell>
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#ef4444' }}>An error occurred loading this page.</div>
      </ViewerShell>
    )
  }

  // Loaded
  return (
    <ViewerShell title={page?.title} publishedAt={page?.published_at} description={page?.metadata?.description}>
      <PageContent page={page} />
    </ViewerShell>
  )
}

// ---------------------------------------------------------------------------
// Shell layout
// ---------------------------------------------------------------------------
function ViewerShell({ title, publishedAt, description, children }) {
  // Inject meta tags
  useEffect(() => {
    if (title) document.title = title + ' — FinTrack'
    return () => { document.title = 'FinTrack' }
  }, [title])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#111',
    }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px 80px' }}>
        {title && (
          <header style={{ marginBottom: 32 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, lineHeight: 1.3, color: '#0f172a' }}>{title}</h1>
            {publishedAt && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>
                Published {new Date(publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            )}
            {description && <p style={{ marginTop: 10, fontSize: 15, color: '#475569' }}>{description}</p>}
            <hr style={{ marginTop: 24, border: 'none', borderTop: '1px solid #e2e8f0' }} />
          </header>
        )}
        <main>{children}</main>
        <footer style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
          <a
            href="/"
            style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none' }}
          >
            Powered by FinTrack
          </a>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content renderer
// ---------------------------------------------------------------------------
function PageContent({ page }) {
  const { content_type, content } = page

  if (!content) return <div style={{ color: '#9ca3af', fontSize: 14 }}>No content.</div>

  if (content_type === 'markdown') {
    return (
      <div
        style={{
          lineHeight: 1.75,
          fontSize: 16,
          color: '#1e293b',
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    )
  }

  if (content_type === 'html') {
    return (
      <iframe
        srcDoc={content}
        style={{ width: '100%', minHeight: 480, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
        sandbox="allow-scripts allow-same-origin"
        title="Page content"
      />
    )
  }

  if (content_type === 'csv') {
    return <CSVTable text={content} />
  }

  // plain text
  return (
    <pre style={{
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontSize: 14, lineHeight: 1.7, color: '#1e293b',
      background: '#f8fafc', border: '1px solid #e5e7eb',
      borderRadius: 8, padding: '16px 20px', margin: 0,
    }}>
      {content}
    </pre>
  )
}
