import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { api, API_BASE_URL } from '../services/api'
import { csvToGrid, cellDisplay } from '../utils/sheet'
import { escapeAttr, safeUrl } from '../utils/sanitize'

// Page asset/storage URLs are backend-relative (/api/...). The published page
// is served from a DIFFERENT origin than the backend, so a relative src 404s.
// Rewrite any backend-relative /api/ URL to the absolute backend URL. Works for
// both old (relative) and new (already-absolute) content.
function absAsset(url) {
  if (!url) return url
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/api/')) return `${API_BASE_URL}${url}`
  return url
}
function rewriteAssetUrls(html) {
  if (!API_BASE_URL || !html) return html
  // src="/api/..." or href="/api/..." (single or double quoted)
  return html.replace(/(\s(?:src|href)=)(["'])(\/api\/[^"']+)\2/gi,
    (_, attr, q, path) => `${attr}${q}${API_BASE_URL}${path}${q}`)
}

// ---------------------------------------------------------------------------
// Markdown renderer — full featured
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw) return ''
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Neutralise raw HTML up front: escaping "<" means no user markup can become a
  // live tag or <script>. Markdown structural chars (>, |, #, *, backtick) stay
  // intact so parsing still works — every tag emitted below is our own. URLs and
  // alt text are additionally attribute-escaped + scheme-checked in inline().
  s = s.replace(/</g, '&lt;')
  s = s.replace(/```(\w*)\n([\s\S]*?)```/gm, (_, lang, code) =>
    `\x02PRE${lang ? ` data-lang="${lang}"` : ''}>${code.trimEnd()}\x03\n`)
  // Isolate headings and horizontal rules onto their own blocks so a heading
  // line that is followed (without a blank line) by an image/paragraph still
  // renders correctly instead of falling through as raw text.
  s = s.replace(/^(#{1,6} .+)$/gm, '\n\n$1\n\n')
  s = s.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '\n\n$1$1$1\n\n')
  const blocks = s.split(/\n{2,}/)
  const out = blocks.map(block => {
    const t = block.trim()
    if (!t) return ''
    if (t.startsWith('\x02PRE')) {
      return t.replace(/\x02PRE([^>]*)>([\s\S]*?)\x03/, (_, attrs, code) =>
        `<pre class="code-block"${attrs}><code>${code}</code></pre>`)
    }
    if (/^#{1,6} /.test(t)) {
      return t.replace(/^(#{1,6}) (.+)$/, (_, h, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').slice(0,50)
        return `<h${h.length} id="h-${id}">${inline(text)}</h${h.length}>`
      })
    }
    if (t.startsWith('> ')) return `<blockquote>${inline(t.replace(/^> /gm, ''))}</blockquote>`
    if (/^[-*_]{3,}$/.test(t)) return '<hr>'
    // Table
    const lines = t.split('\n')
    if (lines.length >= 2 && lines[0].includes('|') && /^\|?[\s|:-]+\|/.test(lines[1])) {
      const heads = lines[0].split('|').map(c => c.trim()).filter(Boolean)
      const body = lines.slice(2).filter(l => l.includes('|'))
      return `<table><thead><tr>${heads.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r, ri) => `<tr class="${ri%2?'even':''}"><td>${r.split('|').map(c=>c.trim()).filter(Boolean).map(c=>inline(c)).join('</td><td>')}</td></tr>`).join('')
      }</tbody></table>`
    }
    if (/^[\-*+] /.test(t)) {
      const items = t.split('\n').filter(l => /^[\-*+] /.test(l))
      return `<ul>${items.map(l => `<li>${inline(l.replace(/^[\-*+] /, ''))}</li>`).join('')}</ul>`
    }
    if (/^\d+\. /.test(t)) {
      const items = t.split('\n').filter(l => /^\d+\. /.test(l))
      return `<ol>${items.map(l => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`
    }
    // Checkbox list
    if (/^- \[[ xX]\] /.test(t)) {
      return `<ul class="checklist">${t.split('\n').filter(l=>/^- \[/.test(l)).map(l => {
        const done = /^- \[[xX]\]/.test(l)
        return `<li class="${done?'done':''}">${inline(l.replace(/^- \[[ xX]\] /,''))}</li>`
      }).join('')}</ul>`
    }
    return `<p>${inline(t.replace(/\n/g, '<br>'))}</p>`
  })
  return out.filter(Boolean).join('\n')
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${escapeAttr(safeUrl(absAsset(url)))}" alt="${escapeAttr(alt)}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => `<a href="${escapeAttr(safeUrl(absAsset(url)))}" target="_blank" rel="noopener noreferrer">${txt}</a>`)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
}

const MD_CSS = `
.md{color:#1e293b;line-height:1.85;font-size:clamp(15px,2.5vw,17px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{font-weight:800;color:#0f172a;line-height:1.2;margin:1.6em 0 .5em}
.md h1{font-size:clamp(24px,4vw,38px);border-bottom:2px solid #e2e8f0;padding-bottom:.35em}
.md h2{font-size:clamp(20px,3vw,28px);border-bottom:1px solid #e2e8f0;padding-bottom:.25em}
.md h3{font-size:clamp(16px,2.5vw,22px)}
.md h4{font-size:1.1em}
.md p{margin:.85em 0}
.md a{color:#2563eb;text-decoration:underline;text-underline-offset:2px}.md a:hover{color:#1d4ed8}
.md strong{font-weight:700}.md em{font-style:italic}.md del{text-decoration:line-through;opacity:.6}
.md mark{background:#fef08a;padding:.05em .2em;border-radius:2px}
.md ul,.md ol{padding-left:1.6em;margin:.8em 0}
.md li{margin:.35em 0}
.md blockquote{border-left:4px solid #94a3b8;margin:1.2em 0;padding:.6em 1.2em;background:#f1f5f9;color:#475569;border-radius:0 8px 8px 0;font-style:italic}
.md code{background:#f1f5f9;padding:.15em .4em;border-radius:4px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.875em;color:#be185d}
.md pre.code-block{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:1.2em 1.6em;overflow-x:auto;margin:1.4em 0;position:relative}
.md pre.code-block::before{content:attr(data-lang);position:absolute;top:8px;right:12px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-family:ui-monospace,monospace}
.md pre.code-block code{background:none;padding:0;color:inherit;font-size:.875em;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.md hr{border:none;border-top:2px solid #e2e8f0;margin:2.5em 0}
.md img{max-width:100%;height:auto;border-radius:10px;margin:.8em 0;display:block}
.md table{width:100%;border-collapse:collapse;margin:1.2em 0;font-size:.95em;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}
.md th{background:#f8fafc;font-weight:700;padding:10px 14px;border:1px solid #e2e8f0;text-align:left;color:#374151}
.md td{padding:9px 14px;border:1px solid #e2e8f0}
.md tr.even td{background:#f9fafb}
.md ul.checklist{list-style:none;padding-left:.5em}
.md ul.checklist li{display:flex;gap:8px;align-items:flex-start;padding:.2em 0}
.md ul.checklist li::before{content:"☐";font-size:1.1em;flex-shrink:0;margin-top:.05em}
.md ul.checklist li.done::before{content:"☑";color:#10b981}
.md ul.checklist li.done{text-decoration:line-through;color:#9ca3af}
`

// ---------------------------------------------------------------------------
// CSV table
// ---------------------------------------------------------------------------
function CSVTable({ text }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [filter, setFilter] = useState('')

  // Build the grid once, then compute display values (evaluating any =formulas
  // against absolute cell positions). Sorting/filtering operates on results.
  const disp = useMemo(() => {
    if (!text) return []
    const grid = csvToGrid(text)
    return grid.map((row, r) => row.map((_, c) => { const v = cellDisplay(grid, r, c); return v == null ? '' : String(v) }))
  }, [text])

  if (!text) return <p style={{ color: '#9ca3af' }}>Empty.</p>
  const totalRows = Math.max(disp.length - 1, 0)
  const headers = disp[0] || []
  let rows = disp.slice(1)

  if (filter) rows = rows.filter(r => r.some(c => c.toLowerCase().includes(filter.toLowerCase())))
  if (sortCol !== null) {
    rows = [...rows].sort((a,b)=>{
      const av=a[sortCol]||''; const bv=b[sortCol]||''
      const n = parseFloat(av)-parseFloat(bv)
      if (!isNaN(n)) return sortAsc?n:-n
      return sortAsc?av.localeCompare(bv):bv.localeCompare(av)
    })
  }

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter rows…"
          style={{ padding:'6px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none', minWidth:160 }} />
        <span style={{ fontSize:12, color:'#94a3b8' }}>{rows.length} of {totalRows} rows</span>
        {sortCol!==null&&<button onClick={()=>setSortCol(null)} style={{ fontSize:12, color:'#94a3b8', background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>Clear sort</button>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <thead>
            <tr>{headers.map((h, i) => (
              <th key={i} onClick={()=>{ if(sortCol===i)setSortAsc(a=>!a); else{setSortCol(i);setSortAsc(true)} }}
                style={{ border: '1px solid #e2e8f0', padding: '10px 14px', background: '#f8fafc', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap', cursor:'pointer', userSelect:'none', color:'#374151' }}>
                {h}{sortCol===i?<span style={{ marginLeft:4, fontSize:11 }}>{sortAsc?'↑':'↓'}</span>:<span style={{ marginLeft:4, fontSize:11, opacity:.3 }}>↕</span>}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? '#f9fafb' : '#fff' }}>
                {row.map((cell, ci) => <td key={ci} style={{ border: '1px solid #e2e8f0', padding: '9px 14px' }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:8, fontSize:12, color:'#94a3b8' }}>
        {rows.length} row{rows.length!==1?'s':''} · {headers.length} column{headers.length!==1?'s':''}
        {' '}· <button onClick={()=>{const csv=[headers.join(','),...rows.map(r=>r.join(','))].join('\n');const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='data.csv';a.click()}} style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontSize:12, padding:0, textDecoration:'underline' }}>Download CSV ↓</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HTML — replaces the entire browser document
// ---------------------------------------------------------------------------
function HTMLPage({ content }) {
  // User-authored HTML is rendered inside a sandboxed iframe. The sandbox omits
  // `allow-same-origin`, so even if the page contains <script> it runs in an
  // opaque origin and cannot read the parent's cookies, localStorage, or auth
  // token. Previously this used document.write() into the top document, which
  // executed arbitrary author script against the real origin (full XSS).
  // Inject anchor-navigation shim so #id links work inside the sandboxed iframe
  // without needing allow-same-origin (which would expose parent auth context).
  const anchorShim = `<script>document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;var id=a.getAttribute('href').slice(1);if(!id)return;var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});}});</script>`
  const raw = /^\s*<!DOCTYPE|^\s*<html/i.test(content)
    ? content.replace(/<\/head>/i, anchorShim + '</head>')
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${anchorShim}</head><body>${content}</body></html>`
  const html = rewriteAssetUrls(raw)
  return (
    <iframe
      title="Published page"
      srcDoc={html}
      sandbox="allow-scripts allow-popups allow-forms"
      style={{ width: '100%', minHeight: '100vh', border: 'none', display: 'block' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Reading progress bar
// ---------------------------------------------------------------------------
function ReadingProgress() {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const update = () => {
      const el = document.documentElement
      const scrolled = el.scrollTop || document.body.scrollTop
      const total = el.scrollHeight - el.clientHeight
      setPct(total > 0 ? Math.min(100, (scrolled / total) * 100) : 0)
    }
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, height:3, zIndex:9999, background:'#e2e8f0' }}>
      <div style={{ height:'100%', background:'linear-gradient(90deg,#2563eb,#7c3aed)', width:`${pct}%`, transition:'width .1s' }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table of Contents (parsed from markdown headings)
// ---------------------------------------------------------------------------
function extractTOC(content) {
  if (!content) return []
  const headings = []
  const lines = content.split('\n')
  for (const line of lines) {
    const m = line.match(/^(#{1,3}) (.+)$/)
    if (m) {
      const level = m[1].length
      const text = m[2].replace(/\*\*|__|\*|_|`/g, '').trim()
      const id = 'h-' + text.toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').slice(0,50)
      headings.push({ level, text, id })
    }
  }
  return headings
}

function TableOfContents({ items }) {
  const [open, setOpen] = useState(true)
  const [active, setActive] = useState('')

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) { if (e.isIntersecting) setActive(e.target.id) }
    }, { rootMargin:'-20% 0px -60% 0px' })
    const headings = document.querySelectorAll('.md h1, .md h2, .md h3')
    headings.forEach(h => obs.observe(h))
    return () => obs.disconnect()
  }, [items])

  if (!items.length) return null

  return (
    <div style={{ position:'sticky', top:24, alignSelf:'flex-start', width:220, flexShrink:0 }}>
      <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'16px', fontSize:13 }}>
        <button onClick={()=>setOpen(o=>!o)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:700, fontSize:13, color:'#0f172a', marginBottom:open?12:0 }}>
          <span>Contents</span>
          <span style={{ fontSize:12, color:'#94a3b8' }}>{open?'▲':'▼'}</span>
        </button>
        {open && (
          <ul style={{ listStyle:'none', margin:0, padding:0 }}>
            {items.map((item,i)=>(
              <li key={i} style={{ paddingLeft:(item.level-1)*12 }}>
                <a href={`#${item.id}`} onClick={e=>{e.preventDefault();document.getElementById(item.id)?.scrollIntoView({behavior:'smooth',block:'start'})}}
                  style={{ display:'block', padding:'4px 6px', borderRadius:6, fontSize:12, color:active===item.id?'#2563eb':'#475569', background:active===item.id?'#eff6ff':'transparent', textDecoration:'none', fontWeight:active===item.id?600:400, lineHeight:1.4, marginBottom:2 }}>
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Password prompt
// ---------------------------------------------------------------------------
function PasswordPrompt({ title, onSubmit, error, loading }) {
  const [pw, setPw] = useState('')
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '44px 40px', maxWidth: 380, width: '100%', boxShadow: '0 4px 32px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>🔒</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 800, color: '#111827' }}>{title || 'Protected Page'}</h2>
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
// Page content renderer
// ---------------------------------------------------------------------------
function PageContent({ page }) {
  const { content_type, content } = page
  if (!content) return <div style={{ color: '#9ca3af', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>This page has no content.</div>
  if (content_type === 'html') return <HTMLPage content={content} />
  if (content_type === 'csv') return <CSVTable text={content} />
  if (content_type === 'text') {
    return (
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.7, color: '#1e293b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', margin: 0, fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace' }}>
        {content}
      </pre>
    )
  }
  return (
    <>
      <style>{MD_CSS}</style>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Floating Share button
// ---------------------------------------------------------------------------
function FloatingShare() {
  const [toast, setToast] = useState('')
  const copy = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setToast('Link copied!')
      setTimeout(() => setToast(''), 2500)
    })
  }
  return (
    <>
      <button onClick={copy} title="Share this page"
        style={{ position:'fixed', bottom:24, right:24, zIndex:999, background:'#2563eb', color:'#fff', border:'none', borderRadius:50, padding:'11px 18px', fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 16px rgba(37,99,235,0.4)', display:'flex', alignItems:'center', gap:6 }}>
        ↗ Share
      </button>
      {toast && (
        <div style={{ position:'fixed', bottom:76, right:24, zIndex:1000, background:'#1e293b', color:'#f8fafc', padding:'8px 14px', borderRadius:8, fontSize:13, fontWeight:500, boxShadow:'0 4px 12px rgba(0,0,0,0.25)' }}>
          {toast}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function ViewerShell({ title, publishedAt, description, isHtml, contentType, content, children }) {
  const toc = contentType === 'markdown' ? extractTOC(content || '') : []
  const showTOC = toc.length >= 3
  const wordCount = content ? content.trim().split(/\s+/).filter(Boolean).length : 0
  const readMins = Math.max(1, Math.round(wordCount / 200))

  useEffect(() => {
    document.title = title ? `${title} — FinTrack Pages` : 'FinTrack Pages'
    return () => { document.title = 'FinTrack' }
  }, [title])

  // Inject OG / Twitter meta for non-HTML pages
  useEffect(() => {
    if (!title || isHtml) return
    const set = (prop, val, attr = 'property') => {
      const sel = attr === 'name' ? `meta[name="${prop}"]` : `meta[property="${prop}"]`
      let el = document.head.querySelector(sel)
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, prop); document.head.appendChild(el) }
      el.setAttribute('content', val)
    }
    const url = window.location.href
    const desc = description || `${title} — shared via FinTrack Pages`
    set('og:title', title); set('og:description', desc); set('og:url', url); set('og:type', 'article')
    set('twitter:card', 'summary', 'name'); set('twitter:title', title, 'name'); set('twitter:description', desc, 'name')
    return () => {
      ['og:title','og:description','og:url','og:type'].forEach(p => document.head.querySelector(`meta[property="${p}"]`)?.remove())
      ;['twitter:card','twitter:title','twitter:description'].forEach(p => document.head.querySelector(`meta[name="${p}"]`)?.remove())
    }
  }, [title, description, isHtml])

  if (isHtml) {
    return <>{children}</>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color: '#111827' }}>
      <ReadingProgress />
      <div style={{ maxWidth: showTOC ? 1060 : 820, margin: '0 auto', padding: '52px 24px 80px', display:'flex', gap:48, alignItems:'flex-start' }}>
        {/* Main content */}
        <div style={{ flex:1, minWidth:0 }}>
          {title && (
            <header style={{ marginBottom: 36 }}>
              <h1 style={{ margin: 0, fontSize: 'clamp(24px,5vw,40px)', fontWeight: 900, lineHeight: 1.15, color: '#0f172a', letterSpacing: '-0.03em' }}>{title}</h1>
              <div style={{ display:'flex', gap:16, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
                {publishedAt && <span style={{ fontSize: 13, color: '#94a3b8' }}>Published {new Date(publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>}
                {contentType==='markdown' && wordCount>0 && <span style={{ fontSize:13, color:'#94a3b8' }}>{readMins} min read · {wordCount.toLocaleString()} words</span>}
              </div>
              {description && <p style={{ marginTop: 14, fontSize: 16, color: '#64748b', lineHeight: 1.7 }}>{description}</p>}
              <hr style={{ marginTop: 28, border: 'none', borderTop: '1px solid #e2e8f0' }} />
            </header>
          )}
          <main>{children}</main>
          <footer style={{ marginTop: 72, paddingTop: 20, borderTop: '1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Powered by FinTrack Pages</span>
            <button onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}
              style={{ fontSize:12, color:'#94a3b8', background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
              ↑ Back to top
            </button>
          </footer>
        </div>
        {/* Table of Contents sidebar */}
        {showTOC && <TableOfContents items={toc} />}
      </div>
      <FloatingShare />
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

  const pwKey = `fp_pw_${slug}`
  const getSavedPw = () => { try { return sessionStorage.getItem(pwKey) } catch { return null } }

  useEffect(() => {
    if (!slug) { setState('notfound'); return }
    setState('loading'); setPage(null)
    api.pages.publicGet(slug)
      .then(data => {
        if (!data || data.detail || data.error) { setState('notfound'); return }
        if (data.requires_password) {
          // If this tab already unlocked the page this session, re-verify
          // silently so the visitor isn't asked again on every refresh.
          const saved = getSavedPw()
          if (saved) {
            api.pages.publicVerify(slug, saved)
              .then(v => {
                if (v && v.id && !v.error && !v.detail) { setPage(v); setState('loaded') }
                else { try { sessionStorage.removeItem(pwKey) } catch {} ; setPage(data); setState('requires_password') }
              })
              .catch(() => { setPage(data); setState('requires_password') })
            return
          }
          setPage(data); setState('requires_password'); return
        }
        setPage(data); setState('loaded')
      })
      .catch(() => setState('notfound'))
  }, [slug])

  useEffect(() => {
    if (state !== 'loaded' || viewLogged.current) return
    viewLogged.current = true
    const nav = navigator
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection
    const params = new URLSearchParams(window.location.search)
    const payload = {
      referer:            document.referrer || '',
      screen_width:       window.screen.width,
      screen_height:      window.screen.height,
      viewport_width:     window.innerWidth,
      viewport_height:    window.innerHeight,
      color_depth:        window.screen.colorDepth,
      pixel_ratio:        window.devicePixelRatio,
      language:           nav.language,
      languages:          Array.from(nav.languages || []),
      timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform:           nav.platform || nav.userAgentData?.platform || '',
      touch_support:      navigator.maxTouchPoints > 0,
      cookie_enabled:     nav.cookieEnabled,
      do_not_track:       nav.doNotTrack || '',
      connection_type:    conn?.effectiveType || conn?.type || '',
      connection_downlink:conn?.downlink || null,
      page_url:           window.location.href,
      utm_source:         params.get('utm_source') || '',
      utm_medium:         params.get('utm_medium') || '',
      utm_campaign:       params.get('utm_campaign') || '',
    }

    // GPS — only if the tab ALREADY has location permission granted. We never
    // prompt the visitor: we check the Permissions API first and only read the
    // position when state === 'granted'. Falls back to IP geo otherwise.
    const send = (extra) => api.pages.publicLogView(slug, { ...payload, ...extra }).catch(() => {})
    const tryGps = () => {
      if (!navigator.geolocation) return send({})
      navigator.geolocation.getCurrentPosition(
        pos => send({
          gps_lat:      pos.coords.latitude,
          gps_lon:      pos.coords.longitude,
          gps_accuracy: pos.coords.accuracy,
        }),
        () => send({}),                              // denied / error → IP only
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
      )
    }
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' })
        .then(p => { if (p.state === 'granted') tryGps(); else send({}) })
        .catch(() => send({}))
    } else {
      send({})
    }
  }, [state, slug])

  const handlePasswordSubmit = (password) => {
    setPwError(''); setPwLoading(true)
    api.pages.publicVerify(slug, password)
      .then(data => {
        if (!data || data.detail || data.error || !data.id) {
          // data.error may be an object {code,type,message,...} — never render it raw
          const msg = data?.detail
            || data?.error?.message
            || (typeof data?.error === 'string' ? data.error : '')
            || 'Incorrect password. Please try again.'
          setPwError(msg)
          return
        }
        try { sessionStorage.setItem(pwKey, password) } catch {}
        setPage(data); setState('loaded')
      })
      .catch(() => setPwError('Something went wrong. Please try again.'))
      .finally(() => setPwLoading(false))
  }

  if (state === 'loading') return (
    <ViewerShell isHtml={false}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'80vh', flexDirection:'column', gap:16 }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading…</div>
      </div>
    </ViewerShell>
  )

  if (state === 'notfound') return (
    <ViewerShell isHtml={false}>
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div style={{ fontSize: 80, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>404</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#374151', margin: '16px 0 8px' }}>Page not found</h2>
        <p style={{ color: '#9ca3af', fontSize: 15, margin: 0 }}>This page doesn't exist or has been unpublished.</p>
      </div>
    </ViewerShell>
  )

  if (state === 'requires_password') return (
    <ViewerShell title={page?.title} isHtml={false}>
      <PasswordPrompt title={page?.title} onSubmit={handlePasswordSubmit} error={pwError} loading={pwLoading} />
    </ViewerShell>
  )

  const isHtml = page?.content_type === 'html'

  return (
    <ViewerShell
      title={page?.title}
      publishedAt={page?.published_at}
      description={page?.metadata?.description}
      isHtml={isHtml}
      contentType={page?.content_type}
      content={page?.content}
    >
      <PageContent page={page} />
    </ViewerShell>
  )
}
