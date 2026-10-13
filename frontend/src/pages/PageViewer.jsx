import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { api, API_BASE_URL } from '../services/api'
import { csvToGrid, cellDisplay } from '../utils/sheet'
import { escapeAttr, safeUrl } from '../utils/sanitize'
import { toCsv } from '../utils/csv'
import { usePageMeta } from '../hooks/usePageMeta'
import { pageRenderUrl, PAGE_SANDBOX } from '../utils/pageHtml'

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

// ---------------------------------------------------------------------------
// Theme: one set of colours for light, one for dark, picked by the visitor's
// device. Web pages (HTML) keep whatever colours their author wrote.
// ---------------------------------------------------------------------------
const PV_THEME = `
:root{--pv-bg:#f8fafc;--pv-card:#ffffff;--pv-ink:#0f172a;--pv-text:#374151;--pv-mute:#64748b;--pv-line:#e2e8f0;--pv-subtle:#f1f5f9;--pv-accent-soft:#eff6ff;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--pv-bg:#0b0e14;--pv-card:#131822;--pv-ink:#f1f5f9;--pv-text:#cbd5e1;--pv-mute:#8b95a7;--pv-line:#252c39;--pv-subtle:#1a2030;--pv-accent-soft:#16233f;color-scheme:dark}
.md mark{background:#854d0e;color:#fef9c3}.md code{color:#f9a8d4}}
body{background:var(--pv-bg)}
@keyframes pv-spin{to{transform:rotate(360deg)}}
@keyframes pv-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.pv-skel{background:linear-gradient(90deg,var(--pv-subtle) 0%,var(--pv-line) 50%,var(--pv-subtle) 100%);background-size:800px 100%;animation:pv-shimmer 1.3s linear infinite;border-radius:8px}
@media (prefers-reduced-motion: reduce){.pv-skel{animation:none}}
`

function BrandMark({ size = 22 }) {
  return <img src="/favicon.svg" alt="" width={size} height={size} style={{ borderRadius: 6, display: 'block' }} />
}

// The screens a visitor sees instead of the page itself: password, expired,
// not found. Same frame for all three so the brand reads the same everywhere.
function BrandScreen({ icon, title, message, docTitle, children }) {
  usePageMeta({ title: docTitle || title })
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: 'radial-gradient(1200px 600px at 50% -10%, var(--pv-accent-soft), var(--pv-bg) 60%)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--pv-card)', border: '1px solid var(--pv-line)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(15,23,42,0.12)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#2563eb,#7c3aed)' }} />
        <div style={{ padding: '36px 32px 32px', textAlign: 'center' }}>
          <div aria-hidden="true" style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pv-accent-soft)', color: '#2563eb' }}>
            {icon}
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, lineHeight: 1.25, color: 'var(--pv-ink)', letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{title}</h1>
          {message && <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'var(--pv-mute)' }}>{message}</p>}
          {children}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22, fontSize: 12.5, color: 'var(--pv-mute)' }}>
        <BrandMark size={18} /> Shared securely with <strong style={{ color: 'var(--pv-text)', fontWeight: 700 }}>FinTrack Pages</strong>
      </div>
    </div>
  )
}

const Svg = ({ children }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const LockIcon = () => <Svg><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>
const ClockIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
const SearchIcon = () => <Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>

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
.md{color:var(--pv-ink);line-height:1.85;font-size:clamp(15px,2.5vw,17px);font-family:var(--font-sans)}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{font-weight:800;color:var(--pv-ink);line-height:1.2;margin:1.6em 0 .5em}
.md h1{font-size:clamp(24px,4vw,38px);border-bottom:2px solid var(--pv-line);padding-bottom:.35em}
.md h2{font-size:clamp(20px,3vw,28px);border-bottom:1px solid var(--pv-line);padding-bottom:.25em}
.md h3{font-size:clamp(16px,2.5vw,22px)}
.md h4{font-size:1.1em}
.md p{margin:.85em 0}
.md a{color:#2563eb;text-decoration:underline;text-underline-offset:2px}.md a:hover{color:#1d4ed8}
.md strong{font-weight:700}.md em{font-style:italic}.md del{text-decoration:line-through;opacity:.6}
.md mark{background:#fef08a;padding:.05em .2em;border-radius:2px}
.md ul,.md ol{padding-left:1.6em;margin:.8em 0}
.md li{margin:.35em 0}
.md blockquote{border-left:4px solid var(--pv-mute);margin:1.2em 0;padding:.6em 1.2em;background:var(--pv-subtle);color:var(--pv-text);border-radius:0 8px 8px 0;font-style:italic}
.md code{background:var(--pv-subtle);padding:.15em .4em;border-radius:4px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.875em;color:#be185d}
.md pre.code-block{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:1.2em 1.6em;overflow-x:auto;margin:1.4em 0;position:relative}
.md pre.code-block::before{content:attr(data-lang);position:absolute;top:8px;right:12px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-family:ui-monospace,monospace}
.md pre.code-block code{background:none;padding:0;color:inherit;font-size:.875em;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.md hr{border:none;border-top:2px solid var(--pv-line);margin:2.5em 0}
.md img{max-width:100%;height:auto;border-radius:10px;margin:.8em 0;display:block}
.md table{width:100%;border-collapse:collapse;margin:1.2em 0;font-size:.95em;border-radius:8px;overflow:hidden;border:1px solid var(--pv-line)}
.md th{background:var(--pv-subtle);font-weight:700;padding:10px 14px;border:1px solid var(--pv-line);text-align:left;color:var(--pv-text)}
.md td{padding:9px 14px;border:1px solid var(--pv-line)}
.md tr.even td{background:var(--pv-subtle)}
.md ul.checklist{list-style:none;padding-left:.5em}
.md ul.checklist li{display:flex;gap:8px;align-items:flex-start;padding:.2em 0}
.md ul.checklist li::before{content:"☐";font-size:1.1em;flex-shrink:0;margin-top:.05em}
.md ul.checklist li.done::before{content:"☑";color:#10b981}
.md ul.checklist li.done{text-decoration:line-through;color:var(--pv-mute)}
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

  if (!text) return <p style={{ color: 'var(--pv-mute)' }}>Empty.</p>
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
          style={{ padding:'6px 12px', border:'1px solid var(--pv-line)', borderRadius:8, fontSize:13, outline:'none', minWidth:160 }} />
        <span style={{ fontSize:12, color:'var(--pv-mute)' }}>{rows.length} of {totalRows} rows</span>
        {sortCol!==null&&<button onClick={()=>setSortCol(null)} style={{ fontSize:12, color:'var(--pv-mute)', background:'none', border:'1px solid var(--pv-line)', borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>Clear sort</button>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <thead>
            <tr>{headers.map((h, i) => (
              <th key={i} onClick={()=>{ if(sortCol===i)setSortAsc(a=>!a); else{setSortCol(i);setSortAsc(true)} }}
                style={{ border: '1px solid var(--pv-line)', padding: '10px 14px', background: 'var(--pv-subtle)', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap', cursor:'pointer', userSelect:'none', color:'var(--pv-text)' }}>
                {h}{sortCol===i?<span style={{ marginLeft:4, fontSize:11 }}>{sortAsc?'↑':'↓'}</span>:<span style={{ marginLeft:4, fontSize:11, opacity:.3 }}>↕</span>}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? 'var(--pv-subtle)' : 'var(--pv-card)' }}>
                {row.map((cell, ci) => <td key={ci} style={{ border: '1px solid var(--pv-line)', padding: '9px 14px' }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:8, fontSize:12, color:'var(--pv-mute)' }}>
        {rows.length} row{rows.length!==1?'s':''} · {headers.length} column{headers.length!==1?'s':''}
        {' '}· <button onClick={()=>{const csv=toCsv([headers,...rows]);const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='data.csv';a.click()}} style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontSize:12, padding:0, textDecoration:'underline' }}>Download CSV ↓</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HTML — author content in an isolated frame
// ---------------------------------------------------------------------------
function HTMLPage({ slug, token, title }) {
  // The frame fills the viewport and does its own scrolling, rather than being
  // grown to the height of its content. Growing it made the outer page scroll
  // instead, which means the framed document's viewport never moves — so
  // position:sticky headers never stick, 100vh sections are as tall as the
  // whole document, and anything driven by scroll position never fires. Given
  // its own viewport the page behaves exactly as it would standing alone.
  return (
    <iframe
      title={title || 'Published page'}
      src={pageRenderUrl(slug, token)}
      sandbox={PAGE_SANDBOX}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
      }}
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
    <div style={{ position:'fixed', top:0, left:0, right:0, height:3, zIndex:9999, background:'var(--pv-line)' }}>
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
      <div style={{ background:'var(--pv-card)', border:'1px solid var(--pv-line)', borderRadius:12, padding:'16px', fontSize:13 }}>
        <button onClick={()=>setOpen(o=>!o)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:700, fontSize:13, color:'var(--pv-ink)', marginBottom:open?12:0 }}>
          <span>Contents</span>
          <span style={{ fontSize:12, color:'var(--pv-mute)' }}>{open?'▲':'▼'}</span>
        </button>
        {open && (
          <ul style={{ listStyle:'none', margin:0, padding:0 }}>
            {items.map((item,i)=>(
              <li key={i} style={{ paddingLeft:(item.level-1)*12 }}>
                <a href={`#${item.id}`} onClick={e=>{e.preventDefault();document.getElementById(item.id)?.scrollIntoView({behavior:'smooth',block:'start'})}}
                  style={{ display:'block', padding:'4px 6px', borderRadius:6, fontSize:12, color:active===item.id?'#2563eb':'var(--pv-text)', background:active===item.id?'var(--pv-accent-soft)':'transparent', textDecoration:'none', fontWeight:active===item.id?600:400, lineHeight:1.4, marginBottom:2 }}>
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
  const [show, setShow] = useState(false)
  return (
    <BrandScreen icon={<LockIcon />} title={title || 'Protected page'} message="This page is password protected. Enter the password you were given to open it.">
      <form onSubmit={e => { e.preventDefault(); if (pw) onSubmit(pw) }} style={{ marginTop: 24, textAlign: 'left' }}>
        <label htmlFor="pv-pw" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--pv-text)', marginBottom: 6 }}>Password</label>
        <div style={{ position: 'relative' }}>
          <input id="pv-pw" type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="current-password"
            aria-invalid={!!error} aria-describedby={error ? 'pv-pw-err' : undefined}
            style={{ display: 'block', width: '100%', padding: '12px 64px 12px 14px', border: `1px solid ${error ? '#ef4444' : 'var(--pv-line)'}`, borderRadius: 10, fontSize: 15, boxSizing: 'border-box', outline: 'none', background: 'var(--pv-subtle)', color: 'var(--pv-ink)' }} />
          <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--pv-mute)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 8px' }}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {error && <div id="pv-pw-err" role="alert" style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{error}</div>}
        <button type="submit" disabled={loading || !pw}
          style={{ width: '100%', marginTop: 14, padding: '12px 0', background: 'linear-gradient(90deg,#2563eb,#4f46e5)', opacity: loading || !pw ? 0.6 : 1, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading || !pw ? 'default' : 'pointer' }}>
          {loading ? 'Checking…' : 'Open page'}
        </button>
      </form>
    </BrandScreen>
  )
}

// ---------------------------------------------------------------------------
// Page content renderer
// ---------------------------------------------------------------------------
function PageContent({ page, slug }) {
  const { content_type, content } = page
  if (!content) return <div style={{ color: 'var(--pv-mute)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>This page has no content.</div>
  if (content_type === 'html') return <HTMLPage slug={slug} token={page.render_token} title={page.title} />
  if (content_type === 'csv') return <CSVTable text={content} />
  if (content_type === 'text') {
    return (
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.7, color: 'var(--pv-ink)', background: 'var(--pv-subtle)', border: '1px solid var(--pv-line)', borderRadius: 10, padding: '20px 24px', margin: 0, fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace' }}>
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
        <div style={{ position:'fixed', bottom:76, right:24, zIndex:1000, background:'var(--pv-ink)', color:'var(--pv-subtle)', padding:'8px 14px', borderRadius:8, fontSize:13, fontWeight:500, boxShadow:'0 4px 12px rgba(0,0,0,0.25)' }}>
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

  // Title and description go through the shared hook, which restores the
  // previous values instead of deleting the nodes. The old version removed
  // og:title/og:description/og:url outright on unmount, taking the app's own
  // share metadata with them until the next full reload.
  //
  // HTML pages get a title too. A framed document's own <title> cannot reach
  // the tab, so without this a published landing page sat under whatever the
  // app last set. It takes the page's title unadorned — a marketing page has
  // no business advertising the tool that published it.
  usePageMeta({
    title: title ? (isHtml ? title : `${title} — FinTrack Pages`) : undefined,
    description: title ? (description || `${title} — shared via FinTrack Pages`) : undefined,
  })

  // og:url and og:type are specific to a published page and have no equivalent
  // in the shared hook, so they are managed here — restoring, not removing.
  useEffect(() => {
    if (!title || isHtml) return
    const prev = {}
    const set = (prop, val) => {
      let el = document.head.querySelector(`meta[property="${prop}"]`)
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el) }
      prev[prop] = el.getAttribute('content')
      el.setAttribute('content', val)
    }
    set('og:url', window.location.href)
    set('og:type', 'article')
    return () => {
      for (const [prop, val] of Object.entries(prev)) {
        const el = document.head.querySelector(`meta[property="${prop}"]`)
        if (el && val !== null) el.setAttribute('content', val)
      }
    }
  }, [title, isHtml])

  if (isHtml) {
    return <>{children}</>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--pv-bg)', fontFamily: 'var(--font-sans)', color: 'var(--pv-ink)' }}>
      <ReadingProgress />
      <div style={{ maxWidth: showTOC ? 1060 : 820, margin: '0 auto', padding: '52px 24px 80px', display:'flex', gap:48, alignItems:'flex-start' }}>
        {/* Main content */}
        <div style={{ flex:1, minWidth:0 }}>
          {title && (
            <header style={{ marginBottom: 36 }}>
              <h1 style={{ margin: 0, fontSize: 'clamp(24px,5vw,40px)', fontWeight: 900, lineHeight: 1.15, color: 'var(--pv-ink)', letterSpacing: '-0.03em' }}>{title}</h1>
              <div style={{ display:'flex', gap:16, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
                {publishedAt && <span style={{ fontSize: 13, color: 'var(--pv-mute)' }}>Published {new Date(publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>}
                {contentType==='markdown' && wordCount>0 && <span style={{ fontSize:13, color:'var(--pv-mute)' }}>{readMins} min read · {wordCount.toLocaleString()} words</span>}
              </div>
              {description && <p style={{ marginTop: 14, fontSize: 16, color: 'var(--pv-mute)', lineHeight: 1.7 }}>{description}</p>}
              <hr style={{ marginTop: 28, border: 'none', borderTop: '1px solid var(--pv-line)' }} />
            </header>
          )}
          <main>{children}</main>
          <footer style={{ marginTop: 72, paddingTop: 20, borderTop: '1px solid var(--pv-line)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <span style={{ fontSize: 12, color: 'var(--pv-mute)' }}>Powered by FinTrack Pages</span>
            <button onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}
              style={{ fontSize:12, color:'var(--pv-mute)', background:'none', border:'1px solid var(--pv-line)', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
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
        if (data?.expired) { setState('expired'); return }
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

  // A page open on someone's screen closes at its expiry time too, not only
  // on the next load.
  useEffect(() => {
    if (state !== 'loaded' || !page?.expires_at) return
    const ms = new Date(page.expires_at).getTime() - Date.now()
    if (!(ms > 0)) { setState('expired'); return }
    // setTimeout caps at ~24.8 days; a later expiry is caught on reload.
    if (ms > 2_000_000_000) return
    const t = setTimeout(() => setState('expired'), ms)
    return () => clearTimeout(t)
  }, [state, page?.expires_at])

  // Code protection for documents and sheets, which render here rather than in
  // the framed document (that one carries its own guard).
  useEffect(() => {
    if (state !== 'loaded' || !page?.metadata?.protect_source || page.content_type === 'html') return
    const menu = (e) => e.preventDefault()
    const keys = (e) => {
      const k = (e.key || '').toLowerCase(), m = e.ctrlKey || e.metaKey
      if (k === 'f12' || (m && (k === 'u' || k === 's')) || (m && e.shiftKey && 'ijc'.includes(k))) e.preventDefault()
    }
    document.addEventListener('contextmenu', menu, true)
    document.addEventListener('keydown', keys, true)
    return () => { document.removeEventListener('contextmenu', menu, true); document.removeEventListener('keydown', keys, true) }
  }, [state, page?.metadata?.protect_source, page?.content_type])

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
    <>
      <style>{PV_THEME}</style>
      <div aria-busy="true" aria-label="Loading page" style={{ minHeight: '100vh', background: 'var(--pv-bg)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '64px 24px' }}>
          <div className="pv-skel" style={{ height: 40, width: '62%', marginBottom: 16 }} />
          <div className="pv-skel" style={{ height: 14, width: '30%', marginBottom: 40 }} />
          {[96, 88, 92, 70, 84, 60].map((w, i) => <div key={i} className="pv-skel" style={{ height: 14, width: `${w}%`, marginBottom: 14 }} />)}
        </div>
      </div>
    </>
  )

  if (state === 'notfound') return (
    <><style>{PV_THEME}</style>
      <BrandScreen icon={<SearchIcon />} title="Page not found" message="This page doesn't exist, or it has been unpublished. Check the link, or ask the person who shared it." />
    </>
  )

  if (state === 'expired') return (
    <><style>{PV_THEME}</style>
      <BrandScreen icon={<ClockIcon />} title="This link has expired" message="The person who shared this page set it to stop working after a certain time. Ask them for a new link." />
    </>
  )

  if (state === 'requires_password') return (
    <><style>{PV_THEME}</style>
      <PasswordPrompt title={page?.title} onSubmit={handlePasswordSubmit} error={pwError} loading={pwLoading} />
    </>
  )

  const isHtml = page?.content_type === 'html'

  return (
    <>{!isHtml && <style>{PV_THEME}</style>}
    <ViewerShell
      title={page?.title}
      publishedAt={page?.published_at}
      description={page?.metadata?.description}
      isHtml={isHtml}
      contentType={page?.content_type}
      content={page?.content}
    >
      <PageContent page={page} slug={slug} />
    </ViewerShell>
    </>
  )
}
