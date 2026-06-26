import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../services/api'

// ---------------------------------------------------------------------------
// Markdown — proper multi-pass renderer
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw) return ''
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Fenced code blocks first
  s = s.replace(/```(\w*)\n([\s\S]*?)```/gm, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `\x02PRE${lang ? ` data-lang="${lang}"` : ''}>${escaped.trimEnd()}\x03\n`
  })

  const blocks = s.split(/\n{2,}/)
  const out = blocks.map(block => {
    const t = block.trim()
    if (!t) return ''
    if (t.startsWith('\x02PRE')) {
      return t.replace(/\x02PRE([^>]*)>([\s\S]*?)\x03/, (_, attrs, code) =>
        `<pre class="code-block"${attrs}><code>${code}</code></pre>`)
    }
    if (/^#{1,6} /.test(t)) {
      return t.replace(/^(#{1,6}) (.+)$/, (_, h, text) => `<h${h.length}>${inline(text)}</h${h.length}>`)
    }
    if (t.startsWith('> ')) {
      return `<blockquote>${inline(t.replace(/^> /gm, ''))}</blockquote>`
    }
    if (/^[-*_]{3,}$/.test(t)) return '<hr>'

    // Table
    const lines = t.split('\n')
    if (lines.length >= 2 && lines[0].includes('|') && /^\|?[\s|:-]+\|/.test(lines[1])) {
      const heads = lines[0].split('|').map(c => c.trim()).filter(Boolean)
      const body = lines.slice(2).filter(l => l.includes('|'))
      return `<table><thead><tr>${heads.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.split('|').map(c => c.trim()).filter(Boolean).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`
    }

    // Unordered list
    if (/^[\-*+] /.test(t)) {
      const items = t.split('\n').filter(l => /^[\-*+] /.test(l))
      return `<ul>${items.map(l => `<li>${inline(l.replace(/^[\-*+] /, ''))}</li>`).join('')}</ul>`
    }
    // Ordered list
    if (/^\d+\. /.test(t)) {
      const items = t.split('\n').filter(l => /^\d+\. /.test(l))
      return `<ol>${items.map(l => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`
    }

    return `<p>${inline(t.replace(/\n/g, '<br>'))}</p>`
  })
  return out.filter(Boolean).join('\n')
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
}

const MD_CSS = `
.md{color:#1e293b;line-height:1.8;font-size:16px}
.md h1,.md h2,.md h3,.md h4{margin:1.4em 0 .5em;line-height:1.25;font-weight:700;color:#0f172a}
.md h1{font-size:1.9em;border-bottom:2px solid #e2e8f0;padding-bottom:.3em}
.md h2{font-size:1.5em;border-bottom:1px solid #e2e8f0;padding-bottom:.2em}
.md h3{font-size:1.2em}
.md p{margin:.8em 0}
.md a{color:#2563eb;text-decoration:underline}.md a:hover{color:#1d4ed8}
.md strong{font-weight:700}.md em{font-style:italic}.md del{text-decoration:line-through;opacity:.7}
.md ul,.md ol{padding-left:1.6em;margin:.8em 0}
.md li{margin:.3em 0}
.md blockquote{border-left:4px solid #94a3b8;margin:1em 0;padding:.5em 1.2em;background:#f1f5f9;color:#475569;border-radius:0 6px 6px 0}
.md code{background:#f1f5f9;padding:.15em .4em;border-radius:4px;font-family:ui-monospace,monospace;font-size:.875em;color:#be185d}
.md pre.code-block{background:#1e293b;color:#e2e8f0;border-radius:10px;padding:1.1em 1.4em;overflow-x:auto;margin:1.2em 0}
.md pre.code-block code{background:none;padding:0;color:inherit;font-size:.875em}
.md hr{border:none;border-top:2px solid #e2e8f0;margin:2em 0}
.md img{max-width:100%;height:auto;border-radius:8px;margin:.5em 0}
.md table{width:100%;border-collapse:collapse;margin:1em 0;font-size:.95em;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.md th{background:#f8fafc;font-weight:600;padding:9px 14px;border:1px solid #e2e8f0;text-align:left;color:#374151}
.md td{padding:8px 14px;border:1px solid #e2e8f0}
.md tr:nth-child(even) td{background:#f9fafb}
`

// ---------------------------------------------------------------------------
// CSV — handles quoted fields
// ---------------------------------------------------------------------------
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] }
  const parseLine = (line) => {
    const result = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (line[i] === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += line[i]
    }
    result.push(cur.trim())
    return result
  }
  const lines = text.trim().split('\n').filter(Boolean)
  if (!lines.length) return { headers: [], rows: [] }
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) }
}

function CSVTable({ text }) {
  const { headers, rows } = parseCSV(text)
  if (!headers.length) return <p style={{ color: '#9ca3af' }}>Empty CSV.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} style={{ border: '1px solid #e2e8f0', padding: '9px 14px', background: '#f8fafc', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? '#f9fafb' : '#fff' }}>
              {row.map((cell, ci) => <td key={ci} style={{ border: '1px solid #e2e8f0', padding: '8px 14px' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>{rows.length} row{rows.length !== 1 ? 's' : ''} · {headers.length} column{headers.length !== 1 ? 's' : ''}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HTML frame — auto-resizing
// ---------------------------------------------------------------------------
function HTMLFrame({ content }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(500)

  const wrap = (html) => {
    if (/^\s*<!DOCTYPE/i.test(html) || /^\s*<html/i.test(html)) return html
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#1e293b}</style></head><body>${html}</body></html>`
  }

  const handleLoad = () => {
    try {
      const doc = ref.current?.contentDocument
      if (doc) {
        const h = Math.max(300, doc.documentElement.scrollHeight || doc.body?.scrollHeight || 500)
        setHeight(h + 32)
      }
    } catch {}
  }

  return (
    <iframe
      ref={ref}
      srcDoc={wrap(content)}
      onLoad={handleLoad}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
      title="Page content"
    />
  )
}

// ---------------------------------------------------------------------------
// Password prompt
// ---------------------------------------------------------------------------
function PasswordPrompt({ title, onSubmit, error, loading }) {
  const [pw, setPw] = useState('')
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '44px 40px', maxWidth: 380, width: '100%', boxShadow: '0 4px 32px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>🔒</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 700, color: '#111827' }}>{title || 'Protected Page'}</h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#6b7280' }}>Enter the password to view this page.</p>
        <form onSubmit={e => { e.preventDefault(); if (pw) onSubmit(pw) }}>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" autoFocus
            style={{ display: 'block', width: '100%', padding: '11px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', outline: 'none' }} />
          {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <button type="submit" disabled={loading || !pw}
            style={{ width: '100%', padding: '11px 0', background: loading ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading || !pw ? 'default' : 'pointer' }}>
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content renderer
// ---------------------------------------------------------------------------
function PageContent({ page }) {
  const { content_type, content } = page
  if (!content) return <div style={{ color: '#9ca3af', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>This page has no content.</div>
  if (content_type === 'html') return <HTMLFrame content={content} />
  if (content_type === 'csv') return <CSVTable text={content} />
  if (content_type === 'text') {
    return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.7, color: '#1e293b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px', margin: 0, fontFamily: 'ui-monospace,monospace' }}>{content}</pre>
  }
  return (
    <>
      <style>{MD_CSS}</style>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function ViewerShell({ title, publishedAt, description, contentType, children }) {
  useEffect(() => {
    document.title = title ? `${title} — FinTrack Pages` : 'FinTrack Pages'
    return () => { document.title = 'FinTrack' }
  }, [title])

  const isFullWidth = contentType === 'html'

  return (
    <div style={{ minHeight: '100vh', background: isFullWidth ? '#fff' : '#f8fafc', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color: '#111827' }}>
      {isFullWidth ? (
        <>{children}</>
      ) : (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '52px 24px 80px' }}>
          {title && (
            <header style={{ marginBottom: 40 }}>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, lineHeight: 1.2, color: '#0f172a', letterSpacing: '-0.02em' }}>{title}</h1>
              {publishedAt && <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8' }}>Published {new Date(publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>}
              {description && <p style={{ marginTop: 10, fontSize: 15, color: '#64748b', lineHeight: 1.65 }}>{description}</p>}
              <hr style={{ marginTop: 28, border: 'none', borderTop: '1px solid #e2e8f0' }} />
            </header>
          )}
          <main>{children}</main>
          <footer style={{ marginTop: 72, paddingTop: 20, borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Powered by FinTrack</span>
          </footer>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function PageViewer() {
  const { slug } = useParams()
  const [state, setState] = useState('loading')
  const [page, setPage] = useState(null)
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const viewLogged = useRef(false)

  useEffect(() => {
    if (!slug) { setState('notfound'); return }
    setState('loading'); setPage(null)
    api.pages.publicGet(slug)
      .then(data => {
        if (!data || data.detail || data.error) { setState('notfound'); return }
        if (data.requires_password) { setPage(data); setState('requires_password'); return }
        setPage(data); setState('loaded')
      })
      .catch(() => setState('notfound'))
  }, [slug])

  useEffect(() => {
    if (state !== 'loaded' || viewLogged.current) return
    viewLogged.current = true
    api.pages.publicLogView(slug, { referer: document.referrer }).catch(() => {})
  }, [state, slug])

  const handlePasswordSubmit = (password) => {
    setPwError(''); setPwLoading(true)
    api.pages.publicVerify(slug, password)
      .then(data => {
        if (data?.detail) { setPwError('Incorrect password.'); return }
        setPage(data); setState('loaded')
      })
      .catch(() => setPwError('Something went wrong.'))
      .finally(() => setPwLoading(false))
  }

  if (state === 'loading') return (
    <ViewerShell>
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin .7s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</div>
      </div>
    </ViewerShell>
  )

  if (state === 'notfound') return (
    <ViewerShell>
      <div style={{ textAlign: 'center', padding: '100px 20px' }}>
        <div style={{ fontSize: 80, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>404</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#374151', margin: '16px 0 8px' }}>Page not found</h2>
        <p style={{ color: '#9ca3af', fontSize: 15, margin: 0 }}>This page doesn't exist or has been unpublished.</p>
      </div>
    </ViewerShell>
  )

  if (state === 'requires_password') return (
    <ViewerShell title={page?.title}>
      <PasswordPrompt title={page?.title} onSubmit={handlePasswordSubmit} error={pwError} loading={pwLoading} />
    </ViewerShell>
  )

  return (
    <ViewerShell title={page?.title} publishedAt={page?.published_at} description={page?.metadata?.description} contentType={page?.content_type}>
      <PageContent page={page} />
    </ViewerShell>
  )
}
