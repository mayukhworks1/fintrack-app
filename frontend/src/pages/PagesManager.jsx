import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useConfirm } from '../context/ConfirmContext'
import { useAuth } from '../context/AuthContext'
import { previewRenderUrl, PAGE_SANDBOX } from '../utils/pageHtml'
import StreamingDraft from '../components/StreamingDraft'
import { toIstInput, fromIstInput, formatIst, countdown, msUntil, expiryPreset } from '../utils/ist'
import { api, API_BASE_URL } from '../services/api'
import { parseCSV, toCSV } from '../utils/sheet'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { escapeAttr, safeUrl } from '../utils/sanitize'
import { csvCell } from '../utils/csv'
import { downloadBlob } from '../utils/download'
import AgentInterviewCard from '../components/AgentInterviewCard'
import ArtifactStudio from '../components/artifacts/ArtifactStudio'
import RowPropertiesPanel from '../components/database/RowPropertiesPanel'
import NewDatabaseDialog from '../components/database/NewDatabaseDialog'
const DatabaseView = lazy(() => import('../components/database/DatabaseView'))
import {
  FileText, Globe, Table2, Type, Eye, Plus, Copy, Share2, Trash2,
  PenLine, Search, BarChart2, Lock, CheckCircle2, FileCode2,
  Download, RefreshCw, X, Link2, ExternalLink,
  Layers, Folder, FolderInput, ShieldCheck, Timer,
  MoreHorizontal, EyeOff, Check, ArrowUpDown, Hash, Maximize2, Minimize2, Blocks, Puzzle, Database,
} from 'lucide-react'
import Modal from '../components/Modal'
import SkeletonList from '../components/SkeletonList'
import SheetView from '../components/sheet/SheetView'
import SheetEditor from '../components/sheet/SheetEditor'
import { tint } from '../utils/color'
import { parseDoc, serializeDoc, docWordCount, docTemplates, markdownToDoc, plainTextToDoc, docToMarkdown } from '../components/blocks'

// The block editor and its read-only renderer carry the whole editor runtime,
// so they load only when a block document is actually opened.
// CollabDoc wraps the editor: live co-editing when the server is reachable,
// ordinary autosave otherwise.
const CollabDoc = lazy(() => import('../components/blocks/collab/CollabDoc'))
const BlockViewer = lazy(() => import('../components/blocks/BlockViewer'))
import PageTreeShell from '../components/pagetree/PageTreeShell'
import { PageBreadcrumbs, SubPagesList } from '../components/pagetree/PageContextBits'
import CommentsToggle from '../components/comments/CommentsToggle'
import { openCommentsPanel } from '../components/comments/commentsModel'
import { useLocation, useNavigate } from 'react-router-dom'

// Asset URLs from the upload endpoint are backend-relative (/api/...). The
// published viewer lives on a different origin, so embed the ABSOLUTE backend
// URL or images 404 against the frontend domain.
function absUrl(u) {
  if (!u) return u
  if (/^https?:\/\//.test(u)) return u
  return `${API_BASE_URL}${u}`
}

// ---------------------------------------------------------------------------
// Overlay portal
// ---------------------------------------------------------------------------
// Full-screen overlays have to leave <main> to actually be full-screen.
//
// The app shell runs a fade-in animation on <main>, and an element with a
// running animation on opacity forms a stacking context. The mobile top bar is
// a sibling of <main>, sticky at z-index 30. Once <main> is its own stacking
// context, everything inside it — however high its z-index climbs — is painted
// as a single unit BELOW that bar. That is why the page editor opened with the
// FinTrack header still sitting on top of it, stealing the first band of a
// phone screen and leaving the panel unable to reach the top of the viewport.
//
// Rendering into <body> puts the overlay in the root stacking context, where
// its z-index means what it says. It also guarantees position:fixed is measured
// against the viewport rather than an ancestor.
function Overlay({ children }) {
  if (typeof document === 'undefined') return children
  return createPortal(children, document.body)
}

// ---------------------------------------------------------------------------
// Mobile hook
// ---------------------------------------------------------------------------
// Deliberately 767px, not the 1023px lg breakpoint the rest of the app treats
// as mobile: this module switches to cards at the md breakpoint, so tablets
// keep the table. Expressed through the shared useMediaQuery primitive so the
// resize plumbing is not duplicated — matchMedia also tracks orientation
// changes a resize listener can miss.
const useIsMobile = () => useMediaQuery('(max-width: 767px)')

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw) return ''
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Escape "<" so no user markup becomes a live tag/<script>; markdown
  // structural chars stay intact. URLs/alt are attribute-escaped in inl().
  s = s.replace(/</g, '&lt;')
  s = s.replace(/```(\w*)\n([\s\S]*?)```/gm, (_, lang, code) =>
    `\x02PRE${lang ? ` data-lang="${lang}"` : ''}>${code.trimEnd()}\x03\n`)
  // Isolate headings + horizontal rules so a heading line followed (without a
  // blank line) by an image/paragraph still renders instead of staying raw.
  s = s.replace(/^(#{1,6} .+)$/gm, '\n\n$1\n\n')
  s = s.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '\n\n$1$1$1\n\n')
  return s.split(/\n{2,}/).map(block => {
    const t = block.trim(); if (!t) return ''
    if (t.startsWith('\x02PRE')) return t.replace(/\x02PRE([^>]*)>([\s\S]*?)\x03/, (_, a, c) =>
      `<pre style="background:#1e293b;color:#e2e8f0;padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:13px"${a}><code>${c}</code></pre>`)
    if (/^#{1,6} /.test(t)) return t.replace(/^(#{1,6}) (.+)$/, (_, h, tx) => `<h${h.length} style="margin:.8em 0 .3em;font-weight:700">${inl(tx)}</h${h.length}>`)
    if (t.startsWith('> ')) return `<blockquote style="border-left:3px solid #94a3b8;margin:.6em 0;padding:.3em .8em;background:#f1f5f9;color:#475569">${inl(t.replace(/^> /gm, ''))}</blockquote>`
    if (/^[-*_]{3,}$/.test(t)) return '<hr style="border:none;border-top:1px solid #e2e8f0;margin:1em 0">'
    // Table
    const lines = t.split('\n')
    if (lines.length >= 2 && lines[0].includes('|') && /^\|?[\s|:-]+\|/.test(lines[1])) {
      const heads = lines[0].split('|').map(c => c.trim()).filter(Boolean)
      const body = lines.slice(2).filter(l => l.includes('|'))
      return `<table style="border-collapse:collapse;width:100%;margin:1em 0;font-size:.95em"><thead><tr>${heads.map(c => `<th style="border:1px solid #e2e8f0;padding:8px 12px;background:#f8fafc;font-weight:600;text-align:left">${inl(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r, ri) => `<tr style="background:${ri%2?'#f9fafb':'#fff'}">${r.split('|').map(c=>c.trim()).filter(Boolean).map(c=>`<td style="border:1px solid #e2e8f0;padding:8px 12px">${inl(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`
    }
    if (/^[\-*+] /.test(t)) return `<ul style="padding-left:1.4em;margin:.5em 0">${t.split('\n').filter(l=>/^[\-*+] /.test(l)).map(l=>`<li>${inl(l.replace(/^[\-*+] /,''))}</li>`).join('')}</ul>`
    if (/^\d+\. /.test(t)) return `<ol style="padding-left:1.4em;margin:.5em 0">${t.split('\n').filter(l=>/^\d+\. /.test(l)).map(l=>`<li>${inl(l.replace(/^\d+\. /,''))}</li>`).join('')}</ol>`
    // Checkbox list
    if (/^- \[[ x]\] /.test(t)) return `<ul style="padding-left:1.4em;margin:.5em 0;list-style:none">${t.split('\n').filter(l=>/^- \[/.test(l)).map(l=>{
      const checked = l.startsWith('- [x] ')
      return `<li style="display:flex;gap:6px;align-items:flex-start"><span style="font-size:16px">${checked?'☑':'☐'}</span><span style="${checked?'text-decoration:line-through;color:#9ca3af':''}">${inl(l.replace(/^- \[[ x]\] /,''))}</span></li>`
    }).join('')}</ul>`
    return `<p style="margin:.6em 0;line-height:1.75">${inl(t.replace(/\n/g,'<br>'))}</p>`
  }).filter(Boolean).join('\n')
}
function inl(s) {
  return s
    .replace(/`([^`]+)`/g,'<code style="background:#f1f5f9;padding:.1em .35em;border-radius:3px;font-size:.875em;color:#be185d">$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,url)=>`<img src="${escapeAttr(safeUrl(absUrl(url)))}" alt="${escapeAttr(alt)}" style="max-width:100%;border-radius:6px">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,txt,url)=>`<a href="${escapeAttr(safeUrl(absUrl(url)))}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">${txt}</a>`)
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<del style="opacity:.6">$1</del>')
    .replace(/==(.+?)==/g,'<mark style="background:#fef08a;padding:.05em .2em;border-radius:2px">$1</mark>')
}

// CSV parse helpers + formula engine live in ../utils/sheet (shared with PageViewer)

// ---------------------------------------------------------------------------
// Content preview components
// ---------------------------------------------------------------------------
function CSVPreview({ text, meta }) {
  return <div style={{ padding:12 }}><SheetView text={text} meta={meta} compact /></div>
}
// Fills its pane rather than sitting in a 300px window. Now that a preview is
// the real page — scripts, fonts, full-height sections and all — a fixed strip
// showed too little of it to judge anything.
function HTMLPreview({ content, height = '100%' }) {
  const [url, setUrl]   = useState('')
  const [err, setErr]   = useState('')

  // The preview goes through the same renderer as the published page, so what
  // the author sees here is what a visitor gets — scripts, fonts and all.
  // Parking the content behind a token is what makes that possible: a public
  // endpoint that rendered any HTML posted at it would be a reflected-XSS hole
  // on the API origin, so only an authenticated author can put content there.
  //
  // Debounced, because this runs on every keystroke in the editor.
  useEffect(() => {
    if (!content) { setUrl(''); setErr(''); return }
    let cancelled = false
    const timer = setTimeout(() => {
      api.pages.preview(content)
        .then(res => {
          if (cancelled) return
          if (res?.token) { setUrl(previewRenderUrl(res.token)); setErr('') }
          else setErr('Preview is unavailable right now.')
        })
        .catch(() => { if (!cancelled) setErr('Preview is unavailable right now.') })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [content])

  if (err) return <div style={{ padding:20, fontSize:12, color:'var(--fin-warning)', textAlign:'center' }}>{err}</div>
  if (!url) return <div style={{ padding:20, fontSize:12, color:'var(--text-2)', textAlign:'center' }}>Rendering preview…</div>
  return (
    <iframe
      src={url}
      style={{ width:'100%', height, minHeight:320, border:'none', display:'block', background:'#fff' }}
      sandbox={PAGE_SANDBOX}
      title="preview"
    />
  )
}
function ContentPreview({ contentType, content, meta }) {
  if (!content) return <div style={{ color:'var(--text-2)', fontSize:13, padding:'20px', textAlign:'center' }}>No content yet.</div>
  if (contentType === 'html' || contentType === 'artifact') return <HTMLPreview content={content} />
  if (contentType === 'csv') return <CSVPreview text={content} meta={meta} />
  if (contentType === 'text') return <pre style={{ margin:0, padding:12, fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.6 }}>{content}</pre>
  if (contentType === 'doc') return (
    <div style={{ maxWidth:720, margin:'0 auto', padding:'24px 20px' }}>
      <Suspense fallback={<div style={{ padding:20, fontSize:12, color:'var(--text-2)', textAlign:'center' }}>Loading…</div>}>
        <BlockViewer content={content} />
      </Suspense>
    </div>
  )
  return (
    <div style={{ padding:'12px 16px', lineHeight:1.75, fontSize:14, color:'var(--text-1)', fontFamily:'-apple-system,sans-serif' }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
  )
}

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g,'').replace(/[\s_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'page'
}

// ---------------------------------------------------------------------------
// Type icon helper
// ---------------------------------------------------------------------------
function TypeIcon({ type, size = 15 }) {
  const props = { size, strokeWidth: 1.75 }
  if (type === 'html')        return <FileCode2 {...props} />
  if (type === 'artifact')    return <Puzzle {...props} />
  if (type === 'database')    return <Database {...props} />
  if (type === 'csv' || type === 'spreadsheet') return <Table2 {...props} />
  if (type === 'text')        return <Type {...props} />
  if (type === 'markdown')    return <Hash {...props} />
  return <FileText {...props} />  // block document
}

// ---------------------------------------------------------------------------
// Flag emoji
// ---------------------------------------------------------------------------
function flagEmoji(code) {
  if (!code || code.length < 2) return ''
  try { return code.slice(0,2).toUpperCase().split('').map(c=>String.fromCodePoint(0x1F1E6+c.charCodeAt(0)-65)).join('') } catch { return '' }
}

// ---------------------------------------------------------------------------
// Export analytics CSV
// ---------------------------------------------------------------------------
function exportAnalyticsCSV(items, pageTitle) {
  const headers = ['Time','IP','LocationSource','GPS_Lat','GPS_Lon','GPS_Accuracy_m','GPS_City','GPS_Country','Country','CountryCode','Region','City','ZIP','Lat','Lon','ISP','Org','AS','Platform','TouchScreen','Screen','Viewport','PixelRatio','ColorDepth','Language','Timezone','Browser','ConnectionType','Downlink','Referer','PageURL','UTM_Source','UTM_Medium','UTM_Campaign']
  const fmtB = (ua) => {
    if (!ua) return ''
    const m = /iPhone|iPad/i.test(ua)?'iPhone/iPad':/Android/i.test(ua)?'Android':''
    const b = /EdgA?\/|Edg\//i.test(ua)?'Edge':/OPR\//i.test(ua)?'Opera':/SamsungBrowser/i.test(ua)?'Samsung':/Chrome/i.test(ua)?'Chrome':/Firefox/i.test(ua)?'Firefox':/Safari/i.test(ua)?'Safari':''
    return [m,b].filter(Boolean).join(' ')
  }
  // Referer, page URL and UTM values are whatever a visitor sent: csvCell
  // neutralises formula-looking text as well as quoting.
  const esc = csvCell
  const rows = items.map(v => {
    const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const gps=v.metadata?.gps||{}; const loc=v.metadata?.location||{}
    return [v.viewed_at?new Date(v.viewed_at).toISOString():'',v.viewer_ip,loc.source||(gps.lat?'gps':'ip'),gps.lat,gps.lon,gps.accuracy,gps.city,gps.country,v.country,geo.country_code,geo.region||v.region,v.city,geo.zip,geo.lat,geo.lon,v.isp,geo.org,geo.as,cli.platform,cli.touch_support!=null?(cli.touch_support?'Yes':'No'):'',cli.screen_width?`${cli.screen_width}x${cli.screen_height}`:'',cli.viewport_width?`${cli.viewport_width}x${cli.viewport_height}`:'',cli.pixel_ratio,cli.color_depth,cli.language,cli.timezone||geo.timezone,fmtB(v.user_agent),cli.connection_type,cli.connection_downlink,v.referer,cli.page_url,cli.utm_source,cli.utm_medium,cli.utm_campaign].map(esc).join(',')
  })
  const csv=[headers.join(','),...rows].join('\n')
  downloadBlob(new Blob([csv],{type:'text/csv'}), `analytics-${pageTitle||'page'}-${new Date().toISOString().slice(0,10)}.csv`)
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
// One breakdown (devices, countries) as horizontal bars. Module level so a
// hover on the daily chart does not remount it.
function InsightBarList({ title, rows, card, head }) {
  const m = Math.max(...rows.map(r => r.views), 1)
  return (
    <div style={card}>
      <div style={head}>{title}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {rows.map(r => (
          <div key={r.name} style={{ display:'grid', gridTemplateColumns:'minmax(70px,120px) 1fr auto', alignItems:'center', gap:10, fontSize:12.5 }}>
            <span style={{ color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</span>
            <span style={{ height:8, background:'var(--bg-base)', borderRadius:4, overflow:'hidden' }}>
              <span style={{ display:'block', height:'100%', width:`${Math.max(2, r.views / m * 100)}%`, background:'var(--accent)', borderRadius:4 }} />
            </span>
            <span style={{ color:'var(--text-2)', fontVariantNumeric:'tabular-nums', minWidth:28, textAlign:'right' }}>{r.views.toLocaleString('en-IN')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Insights over every view of a page: a few headline numbers, views per day
// for the last 30 days, and where and on what people opened it. One hue
// throughout: every chart here is a magnitude, none is an identity.
function PageInsights({ pageId, reloadKey, isMobile }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(false)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    let alive = true
    setErr(false)
    api.pages.insights(pageId).then(r => { if (alive) setD(r) }).catch(() => { if (alive) setErr(true) })
    return () => { alive = false }
  }, [pageId, reloadKey])

  if (err) return null
  if (!d) return <div style={{ marginBottom:18 }}><SkeletonList rows={2} compact label="Loading insights" /></div>
  if (!d.total) return null

  // 30 IST calendar days, oldest first, zero-filled.
  const IST = 5.5 * 3600e3
  const today = new Date(Date.now() + IST)
  const days = Array.from({ length: 30 }, (_, i) => {
    const x = new Date(today); x.setUTCDate(x.getUTCDate() - (29 - i))
    return x.toISOString().slice(0, 10)
  })
  const byDay = Object.fromEntries((d.daily || []).map(r => [r.day, r.views]))
  const vals = days.map(k => byDay[k] || 0)
  const max = Math.max(...vals, 1)
  const label = (k) => new Date(k + 'T00:00:00Z').toLocaleDateString('en-IN', { day:'numeric', month:'short', timeZone:'UTC' })
  const delta = d.last7 - d.prev7
  const top = d.countries?.find(c => c.name !== 'Unknown')

  const card = { background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:isMobile?'12px 14px':'14px 16px' }
  const h = { fontSize:11, fontWeight:700, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }
  const tiles = [
    { k:'Total views', v:d.total.toLocaleString('en-IN') },
    { k:'Unique visitors', v:d.unique.toLocaleString('en-IN'), sub:'by network address' },
    { k:'Last 7 days', v:d.last7.toLocaleString('en-IN'), sub: d.prev7 || d.last7 ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs previous 7 days` : 'no views yet' },
    { k:'Top country', v: top ? top.name : '—', sub: top ? `${top.views.toLocaleString('en-IN')} views` : '' },
  ]

  return (
    <section aria-label="Page insights" style={{ marginBottom:20, display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${isMobile?2:4},1fr)`, gap:10 }}>
        {tiles.map(t => (
          <div key={t.k} style={card}>
            <div style={{ fontSize:11, color:'var(--text-2)', fontWeight:600 }}>{t.k}</div>
            <div style={{ fontSize:22, fontWeight:800, color:'var(--text-1)', marginTop:4, fontVariantNumeric:'tabular-nums', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.v}</div>
            {t.sub && <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ ...h, display:'flex', justifyContent:'space-between' }}>
          <span>Views per day · last 30 days (IST)</span>
          <span aria-live="polite" style={{ textTransform:'none', letterSpacing:0, color:'var(--text-1)', fontWeight:600 }}>
            {hover != null ? `${label(days[hover])}: ${vals[hover]} view${vals[hover] === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        <div style={{ position:'relative', height:120, display:'flex', alignItems:'flex-end', gap:2, borderBottom:'1px solid var(--border)' }}
          onMouseLeave={() => setHover(null)}>
          {[0.5, 1].map(f => (
            <div key={f} aria-hidden="true" style={{ position:'absolute', left:0, right:0, bottom:`${f * 100}%`, borderTop:'1px dashed var(--border)', opacity:0.6 }} />
          ))}
          <span aria-hidden="true" style={{ position:'absolute', right:0, top:-2, fontSize:10, color:'var(--text-3)', background:'var(--card-bg)', paddingLeft:4 }}>{max}</span>
          {vals.map((v, i) => (
            <button key={days[i]} type="button" aria-label={`${label(days[i])}: ${v} view${v === 1 ? '' : 's'}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              style={{ all:'unset', flex:1, height:'100%', display:'flex', alignItems:'flex-end', cursor:'default', position:'relative' }}>
              <span style={{ display:'block', width:'100%', height: v ? `${Math.max(3, v / max * 100)}%` : 2, background: v ? 'var(--accent)' : 'var(--border)', borderRadius:'4px 4px 0 0', opacity: hover == null || hover === i ? 1 : 0.45, transition:'opacity .12s' }} />
            </button>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, color:'var(--text-3)', marginTop:5 }}>
          <span>{label(days[0])}</span><span>{label(days[15])}</span><span>Today</span>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:10 }}>
        <InsightBarList title="Devices" rows={d.devices || []} card={card} head={h} />
        <InsightBarList title="Countries" rows={d.countries || []} card={card} head={h} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Detail grid
// ---------------------------------------------------------------------------
function DetailGrid({ geo, cli, v, isMobile }) {
  const gps = v.metadata?.gps || null
  const loc = v.metadata?.location || null
  const mapLat = gps?.lat ?? geo.lat
  const mapLon = gps?.lon ?? geo.lon
  const rows = [
    {section:'Network',label:'IP Address',value:v.viewer_ip},{section:'Network',label:'ISP',value:v.isp},{section:'Network',label:'Organisation',value:geo.org},{section:'Network',label:'AS Number',value:geo.as},{section:'Network',label:'Connection Type',value:cli.connection_type},{section:'Network',label:'Downlink',value:cli.connection_downlink!=null?`${cli.connection_downlink} Mbps`:null},
    // Resolved location — tells you whether this came from precise GPS or IP
    {section:'Location',label:'Source',value:loc?.source?(loc.source==='gps'?'🛰️ GPS (precise)':loc.source==='ip'?'🌐 IP (approximate)':loc.source):(gps?'🛰️ GPS (precise)':'🌐 IP (approximate)')},
    ...(gps?[
      {section:'Location',label:'GPS Latitude',value:gps.lat!=null?String(gps.lat):null},
      {section:'Location',label:'GPS Longitude',value:gps.lon!=null?String(gps.lon):null},
      {section:'Location',label:'GPS Accuracy',value:gps.accuracy!=null?`±${Math.round(gps.accuracy)} m`:null},
      {section:'Location',label:'City',value:gps.city||loc?.city},
      {section:'Location',label:'Region',value:gps.region||loc?.region},
      {section:'Location',label:'Country',value:gps.country?`${flagEmoji(gps.country_code||gps.country)} ${gps.country}`:null},
      {section:'Location',label:'ZIP',value:gps.zip},
      {section:'Location',label:'Address',value:gps.display_name},
    ]:[]),
    {section:'Location (IP)',label:'Country',value:geo.country?`${flagEmoji(geo.country_code||geo.country)} ${geo.country}`:null},{section:'Location (IP)',label:'Country Code',value:geo.country_code},{section:'Location (IP)',label:'Region',value:geo.region},{section:'Location (IP)',label:'City',value:geo.city},{section:'Location (IP)',label:'ZIP',value:geo.zip},{section:'Location (IP)',label:'Latitude',value:geo.lat!=null?String(geo.lat):null},{section:'Location (IP)',label:'Longitude',value:geo.lon!=null?String(geo.lon):null},{section:'Location (IP)',label:'Timezone',value:geo.timezone},
    {section:'Device',label:'Platform',value:cli.platform},{section:'Device',label:'Touch Screen',value:cli.touch_support!=null?(cli.touch_support?'Yes':'No'):null},{section:'Device',label:'Screen',value:cli.screen_width?`${cli.screen_width}×${cli.screen_height}`:null},{section:'Device',label:'Viewport',value:cli.viewport_width?`${cli.viewport_width}×${cli.viewport_height}`:null},{section:'Device',label:'Pixel Ratio',value:cli.pixel_ratio!=null?`${cli.pixel_ratio}x`:null},{section:'Device',label:'Color Depth',value:cli.color_depth!=null?`${cli.color_depth}-bit`:null},{section:'Device',label:'Language',value:cli.language},{section:'Device',label:'All Languages',value:cli.languages?.join(', ')},{section:'Device',label:'Browser TZ',value:cli.timezone},{section:'Device',label:'Cookies',value:cli.cookie_enabled!=null?(cli.cookie_enabled?'Yes':'No'):null},{section:'Device',label:'User Agent',value:v.user_agent},
    {section:'Visit',label:'Time',value:v.viewed_at?new Date(v.viewed_at).toLocaleString():null},{section:'Visit',label:'Page URL',value:cli.page_url},{section:'Visit',label:'Referer',value:v.referer},{section:'Visit',label:'UTM Source',value:cli.utm_source},{section:'Visit',label:'UTM Medium',value:cli.utm_medium},{section:'Visit',label:'UTM Campaign',value:cli.utm_campaign},
  ].filter(r=>r.value)
  const sections=[...new Set(rows.map(r=>r.section))]
  return (
    <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'repeat(auto-fit,minmax(240px,1fr))', gap:16 }}>
      {sections.map(sec=>(
        <div key={sec}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--accent)', marginBottom:8 }}>{sec}</div>
          {rows.filter(r=>r.section===sec).map(r=>(
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'3px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
              <span style={{ color:'var(--text-2)', whiteSpace:'nowrap', flexShrink:0 }}>{r.label}</span>
              <span style={{ color:'var(--text-1)', fontFamily:r.label==='User Agent'||r.label==='IP Address'?'monospace':'inherit', fontSize:r.label==='User Agent'?10:12, textAlign:'right', wordBreak:'break-all' }}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
      {mapLat&&mapLon&&(
        <div>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--accent)', marginBottom:8 }}>Map {gps?'(GPS — precise)':'(IP — approximate)'}</div>
          <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:6, wordBreak:'break-all', fontFamily:'monospace' }}>{`https://www.openstreetmap.org/?mlat=${mapLat}&mlon=${mapLon}&zoom=${gps?16:14}`}</div>
          <a href={`https://www.openstreetmap.org/?mlat=${mapLat}&mlon=${mapLon}&zoom=${gps?16:14}`} target="_blank" rel="noopener noreferrer"
            style={{ display:'inline-block', fontSize:12, color:'var(--accent)', textDecoration:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 10px' }}>
            📍 {Number(mapLat).toFixed(4)}, {Number(mapLon).toFixed(4)} — Open in map ↗
          </a>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analytics Drawer
// ---------------------------------------------------------------------------
function AnalyticsDrawer({ page, onClose }) {
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(100)
  const [expandedRow, setExpandedRow] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // filters
  const [filterCountry, setFilterCountry] = useState('')
  const [filterDevice, setFilterDevice] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  const fmtBrowser = (ua) => {
    if (!ua) return '—'
    const m=/iPhone|iPad/i.test(ua)?'iPhone/iPad':/Android/i.test(ua)?'Android':''
    const b=/EdgA?\/|Edg\//i.test(ua)?'Edge':/OPR\//i.test(ua)?'Opera':/SamsungBrowser/i.test(ua)?'Samsung':/Chrome/i.test(ua)?'Chrome':/Firefox/i.test(ua)?'Firefox':/Safari/i.test(ua)?'Safari':''
    return [m,b].filter(Boolean).join(' · ')||ua.slice(0,28)
  }
  const fmtRef = (ref) => { if (!ref) return '—'; try { return new URL(ref).hostname } catch { return ref.slice(0,30) } }

  const [insightsKey, setInsightsKey] = useState(0)
  const reload = () => {
    if (!page) return
    setInsightsKey(k => k + 1)
    setLoading(true)
    api.pages.analytics(page.id, {limit, offset:0})
      .then(d=>{ setData(d); setSelected(new Set()) }).catch(()=>setData({items:[],total:0})).finally(()=>setLoading(false))
  }

  const handleDeleteView = async (e, viewId) => {
    e.stopPropagation()
    if (!(await confirm({
      title: 'Delete view record',
      message: 'Delete this view record? This cannot be undone.',
      confirmLabel: 'Delete',
    }))) return
    setDeletingId(viewId)
    try {
      await api.pages.deleteView(page.id, viewId)
      setData(prev=>({...prev,total:prev.total-1,items:prev.items.filter(v=>v.id!==viewId)}))
      setSelected(prev=>{ const n=new Set(prev); n.delete(viewId); return n })
      if (expandedRow===viewId) setExpandedRow(null)
    } catch {} finally { setDeletingId(null) }
  }

  const handleBulkDelete = async () => {
    if (!selected.size) return
    if (!(await confirm({
      title: 'Delete view records',
      message: `Delete ${selected.size} selected view record${selected.size>1?'s':''}? This cannot be undone.`,
      confirmLabel: 'Delete',
    }))) return
    setBulkDeleting(true)
    const ids=[...selected]
    try {
      await Promise.all(ids.map(id=>api.pages.deleteView(page.id, id)))
      setData(prev=>({...prev,total:prev.total-ids.length,items:prev.items.filter(v=>!ids.includes(v.id))}))
      setSelected(new Set())
    } catch {} finally { setBulkDeleting(false) }
  }

  useEffect(() => { reload() }, [page?.id, limit])

  // client-side filtering
  const filtered = (data?.items||[]).filter(v => {
    const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}
    if (filterCountry && (geo.country_code||v.country||'').toLowerCase() !== filterCountry.toLowerCase()) return false
    if (filterDevice==='mobile' && cli.touch_support!==true) return false
    if (filterDevice==='desktop' && cli.touch_support!==false) return false
    if (filterDateFrom && new Date(v.viewed_at)<new Date(filterDateFrom)) return false
    if (filterDateTo && new Date(v.viewed_at)>new Date(filterDateTo+'T23:59:59')) return false
    if (filterSearch) {
      const q=filterSearch.toLowerCase()
      if (![v.viewer_ip,v.country,v.city,v.isp,v.referer,fmtBrowser(v.user_agent)].some(s=>s?.toLowerCase().includes(q))) return false
    }
    return true
  })

  const allCountries = [...new Set((data?.items||[]).map(v=>(v.metadata?.geo?.country_code||v.country)).filter(Boolean))].sort()
  const allSelected = filtered.length>0 && filtered.every(v=>selected.has(v.id))
  const toggleAll = () => {
    if (allSelected) setSelected(prev=>{ const n=new Set(prev); filtered.forEach(v=>n.delete(v.id)); return n })
    else setSelected(prev=>{ const n=new Set(prev); filtered.forEach(v=>n.add(v.id)); return n })
  }

  const hasFilters = filterCountry||filterDevice||filterDateFrom||filterDateTo||filterSearch
  const clearFilters = () => { setFilterCountry(''); setFilterDevice(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterSearch('') }

  if (!page) return null
  const cols=['','Time','IP Address','Location','ISP / Network','Device','Browser','Screen','Timezone','Language','Referer','']

  const inputStyle = { background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:7, padding:'5px 10px', fontSize:12, color:'var(--text-1)', outline:'none' }

  return (
    <Overlay>
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width:isMobile?'100vw':'96vw', maxWidth:1300, height:'100%', background:'var(--bg-base)', overflowY:'auto', boxShadow:'-4px 0 40px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:isMobile?'16px':'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:isMobile?15:17, fontWeight:700 }}>Viewer Analytics</div>
            <div style={{ fontSize:13, color:'var(--text-2)' }}>{page.title}</div>
            <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug}</a>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
            <button onClick={reload} style={{ ...btnSecondary, fontSize:11, padding:'5px 10px', display:'inline-flex', alignItems:'center', gap:5, borderRadius:8 }}>
              <RefreshCw size={12} strokeWidth={2} /> Refresh
            </button>
            {data?.items?.length>0 && (
              <button onClick={()=>exportAnalyticsCSV(filtered.length?filtered:data.items, page.title)} style={{ ...btnSecondary, fontSize:11, padding:'5px 10px', display:'inline-flex', alignItems:'center', gap:5, borderRadius:8 }}>
                <Download size={12} strokeWidth={2} /> Export CSV
              </button>
            )}
            <button aria-label="Close" onClick={onClose} style={{ ...btnGhost, padding:'6px 8px', borderRadius:8, display:'inline-flex', alignItems:'center', color:'var(--text-3)' }}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {data && (
          <div style={{ padding:isMobile?'12px 16px':'14px 24px', borderBottom:'1px solid var(--border)', display:'flex', gap:isMobile?16:28, flexWrap:'wrap', flexShrink:0, background:'var(--card-bg)', overflowX:'auto' }}>
            <Stat label="Total Views" value={data.total} />
            <Stat label="Filtered" value={filtered.length} />
            <Stat label="Unique IPs" value={new Set(filtered.map(v=>v.viewer_ip).filter(Boolean)).size} />
            <Stat label="Countries" value={new Set(filtered.map(v=>v.country).filter(Boolean)).size} />
            {!isMobile&&<Stat label="Timezones" value={new Set(filtered.map(v=>v.metadata?.client?.timezone).filter(Boolean)).size} />}
            <Stat label="Mobile" value={filtered.filter(v=>v.metadata?.client?.touch_support===true).length} />
            <Stat label="Desktop" value={filtered.filter(v=>v.metadata?.client?.touch_support===false).length} />
          </div>
        )}

        {/* Filters row */}
        {data?.items?.length>0 && (
          <div style={{ padding:'10px 24px', borderBottom:'1px solid var(--border)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', flexShrink:0, background:'var(--bg-base)' }}>
            <input placeholder="Search IP, location, ISP…" value={filterSearch} onChange={e=>setFilterSearch(e.target.value)} style={{ ...inputStyle, width:200 }} />
            <select value={filterCountry} onChange={e=>setFilterCountry(e.target.value)} style={inputStyle}>
              <option value="">All countries</option>
              {allCountries.map(c=><option key={c} value={c}>{flagEmoji(c)} {c}</option>)}
            </select>
            <select value={filterDevice} onChange={e=>setFilterDevice(e.target.value)} style={inputStyle}>
              <option value="">All devices</option>
              <option value="desktop">🖥 Desktop</option>
              <option value="mobile">📱 Mobile</option>
            </select>
            <input type="date" value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)} style={inputStyle} title="From date" />
            <input type="date" value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)} style={inputStyle} title="To date" />
            {hasFilters && <button onClick={clearFilters} style={{ ...btnGhost, fontSize:11, padding:'5px 10px', color:'var(--text-2)', display:'inline-flex', alignItems:'center', gap:4, borderRadius:7 }}><X size={11} /> Clear</button>}
            {selected.size>0 && (
              <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:12, color:'var(--text-2)', fontWeight:600 }}>{selected.size} selected</span>
                <button onClick={handleBulkDelete} disabled={bulkDeleting} style={{ background:'var(--fin-neg-bg)', color:'var(--fin-negative)', border:'1px solid var(--fin-neg-border)', borderRadius:7, padding:'5px 12px', fontSize:12, fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5 }}>
                  <Trash2 size={12} strokeWidth={2} />{bulkDeleting?'Deleting…':'Delete selected'}
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ flex:1, padding:isMobile?'12px 16px':'16px 24px', overflow:'auto' }}>
          <PageInsights pageId={page.id} reloadKey={insightsKey} isMobile={isMobile} />
          {loading ? (
            <SkeletonList rows={6} label="Loading views" />
          ) : !data?.items?.length ? (
            <div style={{ color:'var(--text-2)', fontSize:14, padding:'60px 0', textAlign:'center' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>👁</div>No views yet.
            </div>
          ) : (
            <>
              <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:12 }}>
                Showing <strong>{filtered.length}</strong> of <strong>{data.total}</strong> views
                {hasFilters&&<span style={{ color:'var(--accent)' }}> (filtered)</span>}
                {' '}&mdash; <span style={{ color:'var(--accent)' }}>click row for full detail</span>
              </div>
              {filtered.length===0 ? (
                <div style={{ color:'var(--text-2)', fontSize:13, padding:'40px 0', textAlign:'center' }}>No results match your filters.</div>
              ) : isMobile ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {filtered.map(v=>{
                    const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const exp=expandedRow===v.id; const sel=selected.has(v.id)
                    return (
                      <div key={v.id} style={{ background:'var(--card-bg)', border:`1px solid ${exp?'var(--accent)':sel?'var(--accent-soft)':'var(--border)'}`, borderRadius:10, overflow:'hidden' }}>
                        <div onClick={()=>setExpandedRow(exp?null:v.id)} style={{ padding:'12px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                            <input type="checkbox" checked={sel} onClick={e=>e.stopPropagation()} onChange={()=>setSelected(prev=>{ const n=new Set(prev); sel?n.delete(v.id):n.add(v.id); return n })} style={{ marginTop:2 }} />
                            <div>
                              <div style={{ fontSize:12, fontWeight:600 }}>{v.country?<>{flagEmoji(geo.country_code||v.country)} {v.city||v.country}</>:v.viewer_ip||'—'}</div>
                              <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>{new Date(v.viewed_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
                              <div style={{ fontSize:11, color:'var(--text-2)' }}>{cli.touch_support===true?'📱 ':cli.touch_support===false?'🖥️ ':''}{fmtBrowser(v.user_agent)}</div>
                            </div>
                          </div>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <button onClick={e=>handleDeleteView(e,v.id)} disabled={deletingId===v.id} style={{ background:'var(--fin-neg-bg)', color:'var(--fin-negative)', border:'1px solid var(--fin-neg-border)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>{deletingId===v.id?'…':'Del'}</button>
                            <span style={{ color:'var(--text-2)', fontSize:14 }}>{exp?'▲':'▼'}</span>
                          </div>
                        </div>
                        {exp&&<div style={{ padding:'12px 14px', borderTop:'1px solid var(--border)' }}><DetailGrid geo={geo} cli={cli} v={v} isMobile={true} /></div>}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'2px solid var(--border)', background:'var(--card-bg)', position:'sticky', top:0, zIndex:2 }}>
                        <th style={{ padding:'9px 12px' }}>
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all visible" />
                        </th>
                        {cols.slice(1).map(h=><th key={h} style={{ padding:'9px 12px', textAlign:'left', color:'var(--text-2)', fontWeight:700, whiteSpace:'nowrap', fontSize:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((v,i)=>{
                        const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const exp=expandedRow===v.id; const sel=selected.has(v.id)
                        return [
                          <tr key={v.id} onClick={()=>setExpandedRow(exp?null:v.id)} style={{ borderBottom:exp?'none':'1px solid var(--border)', background:sel?'var(--accent-dim)':exp?'var(--card-bg)':i%2?'var(--card-bg)':'var(--bg-base)', cursor:'pointer' }}>
                            <td style={{ padding:'9px 12px' }} onClick={e=>e.stopPropagation()}>
                              <input type="checkbox" checked={sel} onChange={()=>setSelected(prev=>{ const n=new Set(prev); sel?n.delete(v.id):n.add(v.id); return n })} />
                            </td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }}>{new Date(v.viewed_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11 }}>{v.viewer_ip||'—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap' }}>{v.country?<>{flagEmoji(geo.country_code||v.country)} {v.city?`${v.city}, `:''}{geo.country_code||v.country}</>:'—'}</td>
                            <td style={{ padding:'9px 12px', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }} title={v.isp}>{v.isp||'—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap' }}>{cli.touch_support===true?'📱 ':cli.touch_support===false?'🖥️ ':''}{cli.platform||'—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap' }} title={v.user_agent}>{fmtBrowser(v.user_agent)}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }}>{cli.screen_width?`${cli.screen_width}×${cli.screen_height}`:''}{cli.pixel_ratio>1?<span style={{ color:'var(--accent)', fontSize:10 }}> @{cli.pixel_ratio}x</span>:''}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis' }}>{cli.timezone||geo.timezone||'—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap' }}>{cli.language||'—'}</td>
                            <td style={{ padding:'9px 12px', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }} title={v.referer}>{fmtRef(v.referer)}</td>
                            <td style={{ padding:'9px 8px' }} onClick={e=>e.stopPropagation()}>
                              <button onClick={e=>handleDeleteView(e,v.id)} disabled={deletingId===v.id} style={{ background:'var(--fin-neg-bg)', color:'var(--fin-negative)', border:'1px solid var(--fin-neg-border)', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>{deletingId===v.id?'…':'Delete'}</button>
                            </td>
                          </tr>,
                          exp&&<tr key={`${v.id}-exp`} style={{ background:'var(--card-bg)', borderBottom:'2px solid var(--accent)' }}>
                            <td colSpan={12} style={{ padding:'20px 24px' }}><DetailGrid geo={geo} cli={cli} v={v} isMobile={false} /></td>
                          </tr>
                        ]
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total>limit&&<button onClick={()=>setLimit(l=>l+100)} style={{ ...btnSecondary, marginTop:16, fontSize:12 }}>Load more ({data.total-limit} remaining)</button>}
            </>
          )}
        </div>
      </div>
    </div>
    </Overlay>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ flexShrink:0 }}>
      <div style={{ fontSize:20, fontWeight:800, color:'var(--text-1)', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:10, color:'var(--text-2)', marginTop:3, textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:600 }}>{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share Modal
// ---------------------------------------------------------------------------
function ShareModal({ page, onClose, onCopy }) {
  const url = `${window.location.origin}/p/${page.slug}`
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}&margin=10&color=1e293b`
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(url).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); onCopy?.() }) }
  return (
    <Overlay>
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg-base)', borderRadius:16, padding:28, maxWidth:420, width:'100%', boxShadow:'0 16px 64px rgba(0,0,0,0.25)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>Share Page</div>
          <button aria-label="Close" onClick={onClose} style={{ ...btnGhost, padding:'6px 8px', borderRadius:8, display:'inline-flex', alignItems:'center', color:'var(--text-3)' }}><X size={16} strokeWidth={2} /></button>
        </div>
        <div style={{ textAlign:'center', marginBottom:20 }}>
          <img src={qr} alt="QR code" width={180} height={180} style={{ borderRadius:12, border:'1px solid var(--border)' }} />
          <div style={{ fontSize:12, color:'var(--text-2)', marginTop:8 }}>Scan to open on mobile</div>
        </div>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:12, display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ flex:1, fontSize:12, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{url}</span>
          <button onClick={copy} style={{ ...btnPrimary, padding:'5px 12px', fontSize:12, whiteSpace:'nowrap' }}>{copied?'✓ Copied!':'Copy'}</button>
        </div>
        <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer"
          style={{ display:'block', textAlign:'center', fontSize:13, color:'var(--accent)', textDecoration:'none', padding:'8px', border:'1px solid var(--border)', borderRadius:8 }}>
          Open page ↗
        </a>
        <div style={{ marginTop:12, display:'flex', gap:8, justifyContent:'center' }}>
          {[
            { label:'Twitter / X', href:`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(page.title||'Check this out')}` },
            { label:'WhatsApp', href:`https://wa.me/?text=${encodeURIComponent(`${page.title||''} ${url}`)}` },
            { label:'Email', href:`mailto:?subject=${encodeURIComponent(page.title||'Shared page')}&body=${encodeURIComponent(url)}` },
          ].map(s=>(
            <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:11, color:'var(--accent)', textDecoration:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 10px', fontWeight:600 }}>
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
// Spreadsheet templates are built as rows, so formulas holding commas and
// quotes are quoted correctly, and their dates sit around today. `sheet` is
// the formatting (metadata.sheet) the picker applies with the content.
const isoDay = (offset) => {
  const d = new Date(Date.now() + offset * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const INR = { type:'inr', decimals:0 }
const sheetTemplate = (name, icon, rows, sheet) => ({
  name, icon, content: toCSV(rows), sheet: sheet ? { v:1, header:true, freezeRows:1, ...sheet } : undefined,
})
const SHEET_TEMPLATES = [
  sheetTemplate('Blank', '📄', [
    ['Column A','Column B','Column C','Column D','Column E','Column F'],
    ...Array.from({ length:20 }, () => ['','','','','','']),
  ]),
  sheetTemplate('Budget vs actual', '💰', [
    ['Category','Budget','Actual','Difference','Variance %','Notes'],
    ...[['Rent',45000,45000,''],['Salaries',350000,362000,'Two contractors this quarter'],['Software',18000,21500,''],
      ['Marketing',60000,48000,''],['Travel',25000,31200,'Client visits'],['Utilities',12000,10850,''],['Office supplies',8000,6400,'']]
      .map(([cat, budget, actual, note], i) => [cat, String(budget), String(actual), `=B${i+2}-C${i+2}`, `=IF(B${i+2}=0,0,D${i+2}/B${i+2})`, note]),
    ['Total','=SUM(B2:B8)','=SUM(C2:C8)','=B9-C9','=IF(B9=0,0,D9/B9)',''],
  ], { colWidths:{ 0:160, 5:220 }, colFormats:{ 1:INR, 2:INR, 3:INR, 4:{ type:'percent', decimals:1 } } }),
  sheetTemplate('Invoice tracker', '🧾', [
    ['Client','Invoice #','Date','Amount','GST 18%','Total','Status','Days outstanding'],
    ...[['Acme Traders',-64,120000,'Paid'],['Northwind Foods',-41,86500,'Paid'],['Globex Retail',-27,240000,'Sent'],
      ['Initech Labs',-12,54000,'Sent'],['Umbrella Health',-3,175000,'Draft']]
      .map(([client, offset, amount, status], i) => {
        const r = i + 2
        return [client, `INV-${String(i+1).padStart(3,'0')}`, isoDay(offset), String(amount), `=D${r}*18%`, `=D${r}+E${r}`, status,
          `=IF(G${r}="Paid","",DAYS(TODAY(),C${r}))`]
      }),
    ['Total','','','=SUM(D2:D6)','=SUM(E2:E6)','=SUM(F2:F6)','',''],
    ['Outstanding','','','','','=SUMIF(G2:G6,"<>Paid",F2:F6)','',''],
  ], { colWidths:{ 0:170, 1:100, 7:140 }, colFormats:{ 2:{ type:'date' }, 3:INR, 4:INR, 5:INR, 7:{ type:'number', decimals:0 } }, colAlign:{ 6:'center' } }),
  sheetTemplate('Project P&L', '📈', [
    ['Project','Client','Revenue','Direct cost','Overheads','Profit','Margin'],
    ...[['Website rebuild','Acme Traders',450000,210000,45000],['Mobile app','Northwind Foods',820000,515000,82000],
      ['Brand refresh','Globex Retail',260000,98000,26000],['Data migration','Initech Labs',380000,240000,38000]]
      .map(([project, client, revenue, cost, overheads], i) => {
        const r = i + 2
        return [project, client, String(revenue), String(cost), String(overheads), `=C${r}-D${r}-E${r}`, `=IF(C${r}=0,0,F${r}/C${r})`]
      }),
    ['Total','','=SUM(C2:C5)','=SUM(D2:D5)','=SUM(E2:E5)','=SUM(F2:F5)','=IF(C6=0,0,F6/C6)'],
  ], { colWidths:{ 0:160, 1:150 }, colFormats:{ 2:INR, 3:INR, 4:INR, 5:INR, 6:{ type:'percent', decimals:1 } } }),
  sheetTemplate('Inventory', '📦', [
    ['SKU','Item','Category','In stock','Reorder at','Unit cost','Stock value','Status'],
    ...[['Printer paper A4','Office',120,50,240],['Toner cartridge','Office',6,10,3400],['Laptop stand','Equipment',14,5,1850],
      ['USB-C hub','Equipment',3,8,2200],['Notebook','Stationery',240,100,85],['Whiteboard markers','Stationery',18,24,60]]
      .map(([item, category, stock, reorder, cost], i) => {
        const r = i + 2
        return [`SKU-${String(i+1).padStart(3,'0')}`, item, category, String(stock), String(reorder), String(cost), `=D${r}*F${r}`,
          `=IF(D${r}<=E${r},"Reorder","OK")`]
      }),
    ['Total','','','=SUM(D2:D7)','','','=SUM(G2:G7)','=COUNTIF(H2:H7,"Reorder")&" to reorder"'],
  ], { colWidths:{ 1:170 }, colFormats:{ 5:INR, 6:INR }, colAlign:{ 7:'center' } }),
  sheetTemplate('Task list', '✅', [
    ['Task','Owner','Priority','Status','Start','Due','Days left'],
    ...[['Draft proposal','Asha','High','Done',-14,-4],['Client review','Rahul','High','In progress',-3,4],
      ['Design mockups','Meera','Medium','In progress',-1,9],['Build first release','Vikram','High','Not started',5,26],
      ['Launch checklist','Asha','Low','Not started',20,33]]
      .map(([task, owner, priority, status, start, due], i) => {
        const r = i + 2
        return [task, owner, priority, status, isoDay(start), isoDay(due), `=IF(D${r}="Done","",DAYS(F${r},TODAY()))`]
      }),
    ['Open tasks','','','=COUNTIF(D2:D6,"<>Done")','','',''],
  ], { colWidths:{ 0:200 }, colFormats:{ 4:{ type:'date' }, 5:{ type:'date' }, 6:{ type:'number', decimals:0 } }, colAlign:{ 2:'center', 3:'center' } }),
]

// A new spreadsheet starts as the Blank template: a header row over twenty
// empty rows of six columns.
const BLANK_SHEET = SHEET_TEMPLATES[0]

const TEMPLATES = {
  doc: docTemplates(),
  markdown: [
    {
      name: 'Blank', icon: '📄',
      content: '',
    },
    {
      name: 'Article', icon: '📰',
      content: `# Article Title\n\n> A compelling one-line summary of your article.\n\n## Introduction\n\nWrite your opening paragraph here. Hook the reader with an interesting fact or question.\n\n## Main Section\n\nDevelop your ideas here. You can use **bold**, *italic*, or \`inline code\`.\n\n### Sub-section\n\nBreak down complex topics into smaller sections.\n\n## Conclusion\n\nSummarize your key points and leave the reader with a clear takeaway.\n\n---\n\n*Published by Author Name*`,
    },
    {
      name: 'Meeting Notes', icon: '📋',
      content: `# Meeting Notes\n\n**Date:** ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}\n**Time:** \n**Location / Link:** \n**Attendees:** \n\n---\n\n## Agenda\n\n1. \n2. \n3. \n\n## Discussion\n\n### Topic 1\n\n\n\n### Topic 2\n\n\n\n## Action Items\n\n- [ ] Task — Owner — Due date\n- [ ] Task — Owner — Due date\n- [ ] Task — Owner — Due date\n\n## Next Meeting\n\n**Date:** \n**Topics:** `,
    },
    {
      name: 'Resume / CV', icon: '👤',
      content: `# Your Name\n\n📧 email@example.com · 📞 +1 (555) 000-0000 · 🌐 yourwebsite.com · 📍 City, Country\n\n---\n\n## Summary\n\nA brief professional summary (2-3 sentences) about your expertise and goals.\n\n## Experience\n\n### Job Title — Company Name\n*Month Year – Present · City, Country*\n\n- Key achievement or responsibility\n- Key achievement or responsibility\n- Key achievement or responsibility\n\n### Previous Job Title — Company Name\n*Month Year – Month Year · City, Country*\n\n- Key achievement\n- Key achievement\n\n## Education\n\n### Degree — University Name\n*Year – Year*\n\n## Skills\n\n**Technical:** Skill 1, Skill 2, Skill 3\n**Tools:** Tool 1, Tool 2, Tool 3\n**Languages:** English (Native), Other (Level)\n\n## Projects\n\n### Project Name\n[View project](https://example.com) — Brief description of the project and your role.\n\n---\n\n*References available upon request*`,
    },
    {
      name: 'Invoice', icon: '🧾',
      content: `# Invoice\n\n| | |\n|---|---|\n| **Invoice #** | INV-001 |\n| **Date** | ${new Date().toLocaleDateString()} |\n| **Due Date** | ${new Date(Date.now()+30*864e5).toLocaleDateString()} |\n| **Status** | 🟡 Pending |\n\n---\n\n## From\n\n**Your Name / Company**\nyour@email.com\nAddress Line 1\nCity, State, ZIP\n\n## Bill To\n\n**Client Name / Company**\nclient@email.com\nClient Address\n\n---\n\n## Services\n\n| Description | Qty | Rate | Amount |\n|---|---|---|---|\n| Service or product description | 1 | $1,000.00 | $1,000.00 |\n| Service or product description | 2 | $500.00 | $1,000.00 |\n\n---\n\n| | |\n|---|---|\n| **Subtotal** | $2,000.00 |\n| **Tax (0%)** | $0.00 |\n| **Total Due** | **$2,000.00** |\n\n---\n\n## Payment Details\n\n**Bank:** Bank Name\n**Account:** 0000 0000\n**Reference:** INV-001\n\n*Thank you for your business!*`,
    },
    {
      name: 'Product Spec', icon: '📐',
      content: `# Product / Feature Specification\n\n**Version:** 1.0 · **Status:** Draft · **Owner:** Your Name\n\n---\n\n## Overview\n\nOne paragraph describing what this product/feature does and why it exists.\n\n## Problem Statement\n\nWhat problem are we solving? Who has this problem?\n\n## Goals\n\n- Primary goal\n- Secondary goal\n\n## Non-Goals\n\n- What this does NOT do\n\n## User Stories\n\n> As a **[user type]**, I want to **[action]** so that **[benefit]**.\n\n## Requirements\n\n### Functional\n\n- [ ] Requirement 1\n- [ ] Requirement 2\n\n### Non-Functional\n\n- Performance: \n- Security: \n- Accessibility: \n\n## Design\n\n*Attach design links here*\n\n## Open Questions\n\n1. Question?\n\n## Timeline\n\n| Milestone | Date |\n|---|---|\n| Design complete | |\n| Dev complete | |\n| Launch | |`,
    },
  ],
  html: [
    {
      name: 'Blank', icon: '📄',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>My Page</title>\n  <style>\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n    body { font-family: -apple-system, sans-serif; color: #1e293b; background: #f8fafc; padding: 40px 24px; }\n  </style>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>`,
    },
    {
      name: 'Landing Page', icon: '🚀',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Landing Page</title>\n  <style>\n    *{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff}.hero{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:80px 24px;text-align:center}.hero h1{font-size:clamp(28px,5vw,52px);font-weight:800;margin-bottom:16px;line-height:1.15}.hero p{font-size:clamp(14px,2vw,18px);opacity:.9;max-width:540px;margin:0 auto 32px}.btn{display:inline-block;background:#fff;color:#667eea;font-weight:700;padding:14px 32px;border-radius:50px;text-decoration:none;font-size:16px;transition:transform .15s}.btn:hover{transform:translateY(-2px)}.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:32px;padding:64px 24px;max-width:1000px;margin:0 auto}.feature{text-align:center;padding:32px 24px}.feature .icon{font-size:40px;margin-bottom:16px}.feature h3{font-size:20px;font-weight:700;margin-bottom:8px}.feature p{color:#64748b;line-height:1.6}.footer{background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;padding:32px;font-size:13px;color:#94a3b8}\n  </style>\n</head>\n<body>\n  <section class="hero">\n    <h1>Your Amazing Product</h1>\n    <p>A short description of what makes your product special and why people should care about it.</p>\n    <a href="#" class="btn">Get Started Free →</a>\n  </section>\n  <section class="features">\n    <div class="feature"><div class="icon">⚡</div><h3>Fast</h3><p>Blazing fast performance that keeps your users happy and engaged at all times.</p></div>\n    <div class="feature"><div class="icon">🔒</div><h3>Secure</h3><p>Enterprise-grade security built in from day one. Your data is always protected.</p></div>\n    <div class="feature"><div class="icon">🎯</div><h3>Simple</h3><p>Intuitive interface that anyone can use without reading a manual.</p></div>\n  </section>\n  <footer class="footer">© ${new Date().getFullYear()} Your Company · All rights reserved</footer>\n</body>\n</html>`,
    },
    {
      name: 'Bio / Profile', icon: '👤',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Profile</title>\n  <style>\n    *{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#fff;border-radius:20px;box-shadow:0 4px 40px rgba(0,0,0,0.1);max-width:480px;width:100%;overflow:hidden}.cover{height:120px;background:linear-gradient(135deg,#667eea,#764ba2)}.content{padding:0 28px 32px;text-align:center}.avatar{width:96px;height:96px;border-radius:50%;border:4px solid #fff;background:#e2e8f0;margin:-48px auto 16px;display:flex;align-items:center;justify-content:center;font-size:40px;overflow:hidden}.name{font-size:24px;font-weight:800;color:#0f172a;margin-bottom:4px}.handle{color:#64748b;font-size:14px;margin-bottom:12px}.bio{color:#475569;line-height:1.6;font-size:14px;margin-bottom:24px}.links{display:flex;flex-direction:column;gap:10px}.link{display:block;padding:12px 20px;border:1px solid #e2e8f0;border-radius:12px;text-decoration:none;font-weight:600;color:#1e293b;font-size:14px;transition:background .15s}.link:hover{background:#f8fafc}.badge{display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:50px;padding:6px 14px;font-size:12px;color:#64748b;margin-bottom:20px}\n  </style>\n</head>\n<body>\n  <div class="card">\n    <div class="cover"></div>\n    <div class="content">\n      <div class="avatar">😊</div>\n      <div class="name">Your Name</div>\n      <div class="handle">@username</div>\n      <div class="badge">🌍 City, Country</div>\n      <div class="bio">Designer, developer & creator. I build things for the web and occasionally write about it. Always curious, always learning.</div>\n      <div class="links">\n        <a class="link" href="#">🌐 Personal Website</a>\n        <a class="link" href="#">🐦 Twitter / X</a>\n        <a class="link" href="#">💼 LinkedIn</a>\n        <a class="link" href="#">📧 Send me an email</a>\n      </div>\n    </div>\n  </div>\n</body>\n</html>`,
    },
  ],
  csv: SHEET_TEMPLATES,
  text: [
    { name: 'Blank', icon: '📄', content: '' },
    { name: 'Changelog', icon: '📝', content: `CHANGELOG\n=========\n\nv2.0.0 — ${new Date().toLocaleDateString()}\n  ADDED: New feature description\n  CHANGED: Updated behavior description  \n  FIXED: Bug fix description\n  REMOVED: Deprecated feature\n\nv1.1.0 — Previous Date\n  ADDED: Feature\n  FIXED: Bug\n\nv1.0.0 — Initial Release\n  ADDED: Initial version` },
  ],
}

// ---------------------------------------------------------------------------
// Markdown Toolbar (Word-like)
// ---------------------------------------------------------------------------
// Upload an image/file to HF storage and insert a reference at the cursor.
// `format(res)` turns the upload result into the snippet for the content type.
function AssetButton({ textareaRef, value, onChange, format, label = '📎 Attach' }) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const res = await api.pages.uploadAsset(file)
      if (res?.error || res?.detail) throw new Error(res.error || res.detail)
      const snippet = format(res)
      const ta = textareaRef.current
      const start = ta ? ta.selectionStart : value.length
      const nv = value.slice(0, start) + snippet + value.slice(start)
      onChange(nv)
      setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + snippet.length, start + snippet.length) } }, 0)
    } catch (err) {
      alert('Upload failed: ' + (err?.message || err))
    } finally { setBusy(false) }
  }
  return (
    <>
      <input ref={inputRef} type="file" onChange={onFile} style={{ display:'none' }}
        accept="image/*,application/pdf,.csv,.txt,.md,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,video/mp4,audio/mpeg" />
      <button type="button" title="Upload & insert an image or file" disabled={busy}
        onMouseDown={e=>{ e.preventDefault(); if(!busy) inputRef.current?.click() }}
        style={{ background:'transparent', border:'none', borderRadius:5, padding:'4px 7px', fontSize:12, cursor:busy?'wait':'pointer', color:'var(--text-1)', userSelect:'none', whiteSpace:'nowrap' }}
        onMouseEnter={e=>e.target.style.background='var(--border)'}
        onMouseLeave={e=>e.target.style.background='transparent'}>
        {busy ? '⏳ Uploading…' : label}
      </button>
    </>
  )
}

// Load a whole .html file from disk into the editor, replacing the content.
// Read in the browser — nothing is uploaded until the page is saved.
function ImportHtmlButton({ value, onChange, onTitle, label = '📄 Upload HTML file' }) {
  const confirm = useConfirm()
  const inputRef = useRef(null)
  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      if ((value || '').trim() && !(await confirm({
        title: 'Replace page content',
        message: `Replace the current content with "${file.name}"?`,
        confirmLabel: 'Replace',
      }))) return
      onChange(text)
      const t = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
      onTitle?.(t || file.name.replace(/\.html?$/i, ''))
    } catch (err) {
      alert('Could not read file: ' + (err?.message || err))
    }
  }
  return (
    <>
      <input ref={inputRef} type="file" onChange={onFile} style={{ display:'none' }} accept=".html,.htm,text/html" />
      <button type="button" title="Load a .html file from your computer"
        onMouseDown={e=>{ e.preventDefault(); inputRef.current?.click() }}
        style={{ background:'transparent', border:'none', borderRadius:5, padding:'4px 7px', fontSize:12, cursor:'pointer', color:'var(--text-1)', userSelect:'none', whiteSpace:'nowrap' }}
        onMouseEnter={e=>e.target.style.background='var(--border)'}
        onMouseLeave={e=>e.target.style.background='transparent'}>
        {label}
      </button>
    </>
  )
}

// Lists uploaded attachments referenced in the content with a delete action.
function AttachmentsBar({ content, onChange }) {
  const confirm = useConfirm()
  const [deleting, setDeleting] = useState(null)
  const assets = useMemo(() => extractAssets(content), [content])
  if (!assets.length) return null
  const remove = async (a) => {
    if (!(await confirm({
      title: 'Remove attachment',
      message: `Remove "${a.name}"? This deletes the file from storage and its reference from the page.`,
      confirmLabel: 'Remove',
    }))) return
    setDeleting(a.path)
    onChange(removeAssetRef(content, a.path))      // remove reference immediately
    try { await api.pages.deleteAsset(a.path) } catch { /* best-effort; reference already gone */ }
    setDeleting(null)
  }
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', padding:'8px 12px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)', alignItems:'center', flexShrink:0 }}>
      <span style={{ fontSize:11, fontWeight:600, color:'var(--text-2)', marginRight:4 }}>📎 {assets.length} attachment{assets.length!==1?'s':''}</span>
      {assets.map(a=>(
        <div key={a.path} style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 6px 3px 4px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-base)' }}>
          {a.isImg
            ? <img src={a.url} alt="" style={{ width:24, height:24, objectFit:'cover', borderRadius:4 }} />
            : <span style={{ fontSize:14 }}>📄</span>}
          <span style={{ fontSize:11, color:'var(--text-1)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={a.name}>{a.name}</span>
          <button type="button" title="Delete attachment" disabled={deleting===a.path}
            onClick={()=>remove(a)}
            style={{ border:'none', background:'transparent', color:'var(--fin-negative)', cursor:'pointer', fontSize:13, lineHeight:1, padding:'0 2px' }}>
            {deleting===a.path ? '…' : '✕'}
          </button>
        </div>
      ))}
    </div>
  )
}

// Format an uploaded asset into markdown or HTML markup
function formatAssetMd(res) {
  const url = absUrl(res.url)
  return res.is_image ? `![${res.filename||'image'}](${url})` : `[📎 ${res.filename||'file'}](${url})`
}
function formatAssetHtml(res) {
  const url = absUrl(res.url)
  return res.is_image
    ? `<img src="${url}" alt="${res.filename||''}" style="max-width:100%;height:auto" />`
    : `<a href="${url}" target="_blank" rel="noopener">📎 ${res.filename||'Download file'}</a>`
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Find every uploaded page asset referenced in the content (relative or absolute)
function extractAssets(content) {
  if (!content) return []
  const re = /\/api\/public\/pages\/asset\/([^\s)"'<>]+)/g
  const seen = new Set(); const out = []
  let m
  while ((m = re.exec(content))) {
    const path = m[1].split('?')[0].split('#')[0]
    if (seen.has(path)) continue
    seen.add(path)
    const name = decodeURIComponent(path.split('/').pop() || path)
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
    out.push({ path, name, isImg, url: absUrl(`/api/public/pages/asset/${path}`) })
  }
  return out
}

// Remove every reference to an asset path from content (md image/link, html img/a, bare url)
function removeAssetRef(content, path) {
  const enc = escapeRegex(path)
  const urlPat = `[^\\s)"'<>]*\\/api\\/public\\/pages\\/asset\\/${enc}`
  let c = content
  c = c.replace(new RegExp(`!?\\[[^\\]]*\\]\\(\\s*${urlPat}\\s*\\)`, 'g'), '')        // markdown image/link
  c = c.replace(new RegExp(`<img[^>]*src=["']${urlPat}["'][^>]*>`, 'gi'), '')          // html <img>
  c = c.replace(new RegExp(`<a[^>]*href=["']${urlPat}["'][^>]*>[\\s\\S]*?<\\/a>`, 'gi'), '') // html <a>…</a>
  c = c.replace(new RegExp(urlPat, 'g'), '')                                            // any bare url
  return c
}

function MarkdownToolbar({ textareaRef, value, onChange, isMobile }) {
  const wrap = (before, after, placeholder = 'text') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart; const end = ta.selectionEnd
    const sel = value.slice(start, end) || placeholder
    const newVal = value.slice(0, start) + before + sel + after + value.slice(end)
    onChange(newVal)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + sel.length) }, 0)
  }
  const prefix = (pre, placeholder = 'text') => {
    const ta = textareaRef.current; if (!ta) return
    const start = ta.selectionStart; const end = ta.selectionEnd
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end); const le = lineEnd === -1 ? value.length : lineEnd
    const line = value.slice(lineStart, le)
    const stripped = line.replace(/^#+\s|^[-*+]\s|^\d+\.\s|^>\s/, '')
    const newLine = pre + stripped
    const newVal = value.slice(0, lineStart) + newLine + value.slice(le)
    onChange(newVal)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(lineStart + newLine.length, lineStart + newLine.length) }, 0)
  }
  const insertAt = (text) => {
    const ta = textareaRef.current; if (!ta) return
    const start = ta.selectionStart
    const newVal = value.slice(0, start) + text + value.slice(start)
    onChange(newVal)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length) }, 0)
  }

  const tools = [
    { groups: [
      { tip:'Bold (Ctrl+B)', label:<b>B</b>, action:()=>wrap('**','**') },
      { tip:'Italic (Ctrl+I)', label:<i>I</i>, action:()=>wrap('*','*') },
      { tip:'Strikethrough', label:<del>S</del>, action:()=>wrap('~~','~~') },
      { tip:'Highlight', label:'🖊', action:()=>wrap('==','==') },
      { tip:'Inline Code', label:'`c`', action:()=>wrap('`','`','code'), mono:true },
    ]},
    { groups: [
      { tip:'Heading 1', label:'H1', action:()=>prefix('# '), bold:true },
      { tip:'Heading 2', label:'H2', action:()=>prefix('## '), bold:true },
      { tip:'Heading 3', label:'H3', action:()=>prefix('### '), bold:true },
    ]},
    { groups: [
      { tip:'Bullet List', label:'• —', action:()=>prefix('- ') },
      { tip:'Numbered List', label:'1.', action:()=>prefix('1. ') },
      { tip:'Checklist', label:'☐', action:()=>prefix('- [ ] ') },
      { tip:'Blockquote', label:'❝', action:()=>prefix('> ') },
    ]},
    { groups: [
      { tip:'Link', label:'🔗', action:()=>wrap('[','](https://)','link text') },
      { tip:'Image by URL (or use 📎 to upload)', label:'🖼', action:()=>insertAt('\n\n![description](https://paste-image-url-here)\n\n') },
      { tip:'Code Block', label:'```', action:()=>wrap('```\n','```','code here'), mono:true },
      { tip:'Table', label:'⊞', action:()=>insertAt('\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n') },
      { tip:'Divider', label:'—', action:()=>insertAt('\n---\n') },
    ]},
  ]

  return (
    // On a phone the wrapped version became three stacked rows — 125px of
    // toolbar above a 286px editor. One row that scrolls sideways keeps every
    // tool reachable and costs a third of the height.
    <div style={{ display:'flex', gap:1, padding:'6px 8px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)',
                  flexWrap:isMobile?'nowrap':'wrap', overflowX:isMobile?'auto':'visible', scrollbarWidth:'none',
                  alignItems:'center', flexShrink:0 }}>
      {tools.map((group, gi) => (
        <div key={gi} style={{ display:'flex', gap:1, marginRight:8, flexShrink:0 }}>
          {group.groups.map(t => (
            <button key={t.tip} title={t.tip} onMouseDown={e=>{ e.preventDefault(); t.action() }}
              style={{ background:'transparent', border:'none', borderRadius:5, padding:'4px 7px', fontSize:t.mono?12:13, cursor:'pointer', color:'var(--text-1)', fontWeight:t.bold?700:400, fontFamily:t.mono?'monospace':'inherit', lineHeight:1.3, transition:'background .1s', userSelect:'none' }}
              onMouseEnter={e=>e.target.style.background='var(--border)'}
              onMouseLeave={e=>e.target.style.background='transparent'}>
              {t.label}
            </button>
          ))}
          {gi < tools.length-1 && <div style={{ width:1, background:'var(--border)', margin:'2px 4px' }} />}
        </div>
      ))}
      <div style={{ width:1, background:'var(--border)', margin:'2px 4px', flexShrink:0 }} />
      <span style={{ flexShrink:0 }}>
        <AssetButton textareaRef={textareaRef} value={value} onChange={onChange} format={formatAssetMd} label={isMobile ? '📎 Image' : '📎 Image / File'} />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Word count / reading time
// ---------------------------------------------------------------------------
function docStats(content, contentType) {
  if (!content) return { words:0, chars:0, readTime:'< 1 min', lines:0 }
  const chars = content.length
  if (contentType === 'csv') {
    const rows = parseCSV(content)
    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0)
    return { words:0, chars, readTime:'—', lines:rows.length, label:`${rows.length.toLocaleString()} rows × ${cols} columns` }
  }
  if (contentType === 'doc') {
    const words = docWordCount(content)
    const mins = Math.max(1, Math.round(words / 200))
    return { words, chars, lines:0, readTime:`${mins} min read`, label:`${words.toLocaleString()} words` }
  }
  const words = content.trim().split(/\s+/).filter(Boolean).length
  const lines = content.split('\n').length
  const mins = Math.max(1, Math.round(words / 200))
  return { words, chars, lines, readTime:`${mins} min read`, label:`${words.toLocaleString()} words` }
}

// ---------------------------------------------------------------------------
// Templates picker
// ---------------------------------------------------------------------------
function TemplatePicker({ contentType, onSelect }) {
  const list = TEMPLATES[contentType] || TEMPLATES.markdown
  return (
    <div style={{ display:'flex', gap:8, padding:'8px 12px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)', overflowX:'auto', flexShrink:0 }}>
      <span style={{ fontSize:11, color:'var(--text-2)', fontWeight:600, whiteSpace:'nowrap', alignSelf:'center' }}>Templates:</span>
      {list.map(t=>(
        <button key={t.name} onClick={()=>onSelect(t)} style={{ ...btnTiny, whiteSpace:'nowrap', fontSize:11, padding:'4px 10px', flexShrink:0 }}>
          {t.icon} {t.name}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Version History Panel
// ---------------------------------------------------------------------------
function VersionHistoryPanel({ pageId, currentContent, currentContentType, onRestore }) {
  const confirm = useConfirm()
  const [versions, setVersions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [previewVer, setPreviewVer] = useState(null) // { id, title, content, content_type, version_num, saved_at }
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!pageId) { setLoading(false); setVersions([]); return }
    setLoading(true)
    api.pages.versions(pageId)
      .then(r => { setVersions(r.items || []); setLoading(false) })
      .catch(() => { setVersions([]); setLoading(false) })
  }, [pageId])

  const loadPreview = async (ver) => {
    if (previewVer?.id === ver.id) { setPreviewVer(null); return }
    setPreviewLoading(ver.id)
    try {
      const full = await api.pages.getVersion(pageId, ver.id)
      setPreviewVer(full)
    } catch { setPreviewVer(null) }
    setPreviewLoading(null)
  }

  const handleRestore = async (ver) => {
    if (!(await confirm({
      title: `Restore version ${ver.version_num}`,
      message: `Restore to the version saved ${new Date(ver.saved_at).toLocaleString()}? Your current content is saved as a new version first, so nothing is lost.`,
      confirmLabel: 'Restore',
      tone: 'default',
    }))) return
    setRestoring(ver.id)
    try {
      // The server restores the content but not the sheet's formatting, so a
      // spreadsheet's column formats are written back from the version too
      // (they are what its preview showed, and they match its columns).
      let full = previewVer?.id === ver.id ? previewVer : null
      if (!full && ver.content_type === 'csv') full = await api.pages.getVersion(pageId, ver.id).catch(() => null)
      const r = await api.pages.restoreVersion(pageId, ver.id)
      if (r.ok && r.page) {
        let restored = r.page
        const versionSheet = full ? full.metadata?.sheet : r.page.metadata?.sheet
        if (restored.content_type === 'csv' && JSON.stringify(versionSheet ?? null) !== JSON.stringify(restored.metadata?.sheet ?? null)) {
          const metadata = { ...(restored.metadata || {}), sheet: versionSheet }
          if (!versionSheet) delete metadata.sheet
          const updated = await api.pages.update(pageId, { metadata }).catch(() => null)
          if (updated?.id) restored = updated
        }
        setToast('✓ Restored! Reloading editor…')
        setTimeout(() => { onRestore(restored, versionSheet); setToast('') }, 1500)
        // Refresh version list
        const fresh = await api.pages.versions(pageId)
        setVersions(fresh.items || [])
      }
    } catch { setToast('⚠ Restore failed') }
    setRestoring(null)
  }

  const fmtTime = (ts) => {
    if (!ts) return '—'
    const d = new Date(ts)
    const now = new Date()
    const diff = Math.floor((now - d) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
  }

  if (!pageId) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, color:'var(--text-2)', fontSize:13 }}>
      <div style={{ fontSize:32 }}>🕐</div>
      <div style={{ fontWeight:600 }}>Save the page first to enable version history</div>
      <div style={{ fontSize:12 }}>Every edit auto-saves to the cloud — versions are captured every 5 minutes</div>
    </div>
  )

  return (
    <div style={{ flex:1, overflow:'hidden', display:'flex', gap:0 }}>
      {/* Version list (left) */}
      <div style={{ width:previewVer ? 260 : '100%', minWidth:220, borderRight:'1px solid var(--border)', overflowY:'auto', flexShrink:0 }}>
        {toast && (
          <div style={{ padding:'10px 16px', background:'var(--fin-pos-bg)', color:'var(--fin-positive)', fontSize:12, fontWeight:600, borderBottom:'1px solid var(--border)' }}>{toast}</div>
        )}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Version History</span>
          <button onClick={()=>{ setLoading(true); api.pages.versions(pageId).then(r=>{setVersions(r.items||[]);setLoading(false)}).catch(()=>setLoading(false)) }}
            style={{ fontSize:12, color:'var(--accent)', border:'none', background:'none', cursor:'pointer', padding:'2px 4px' }}>↻</button>
        </div>
        {loading ? (
          <div style={{ padding:'12px 16px' }}><SkeletonList rows={4} compact label="Loading history" /></div>
        ) : !versions?.length ? (
          <div style={{ padding:'24px 16px', fontSize:13, color:'var(--text-2)', textAlign:'center' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
            No versions yet. Versions are captured automatically every 5 minutes while editing.
          </div>
        ) : (
          <div>
            {/* Current state indicator */}
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', background:'var(--fin-pos-bg)' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--fin-positive)' }}>● Current version</div>
              <div style={{ fontSize:11, color:'var(--fin-positive)', marginTop:2 }}>
                {currentContent ? `${currentContent.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words` : '—'}
              </div>
            </div>
            {versions.map(ver => {
              const isSelected = previewVer?.id === ver.id
              const isRestoring = restoring === ver.id
              return (
                <div key={ver.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 14px', background:isSelected?'var(--card-bg)':'transparent', cursor:'pointer' }}
                  onClick={() => loadPreview(ver)}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--accent)', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'1px 6px', flexShrink:0 }}>
                      v{ver.version_num}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-1)', fontWeight:isSelected?700:400, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {ver.title || 'Untitled'}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>
                    {fmtTime(ver.saved_at)}
                    {ver.word_count > 0 && ` · ${ver.word_count.toLocaleString()} words`}
                    {ver.note && <span style={{ color:'var(--chart-3)' }}> · {ver.note}</span>}
                  </div>
                  {ver.saved_by_name && <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>by {ver.saved_by_name}</div>}
                  {isSelected && (
                    <button
                      onClick={e=>{ e.stopPropagation(); handleRestore(ver) }}
                      disabled={isRestoring}
                      style={{ marginTop:8, width:'100%', padding:'5px 10px', fontSize:12, fontWeight:600, border:'1px solid var(--accent)', borderRadius:6, background:'var(--accent-btn)', color:'var(--accent-fg)', cursor:'pointer', opacity:isRestoring?0.6:1 }}>
                      {isRestoring ? 'Restoring…' : '↩ Restore this version'}
                    </button>
                  )}
                  {previewLoading === ver.id && (
                    <div style={{ fontSize:11, color:'var(--text-2)', marginTop:4 }}>Loading preview…</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Preview pane (right) */}
      {previewVer && (
        <div style={{ flex:1, overflow:'auto', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, background:'var(--card-bg)', flexShrink:0 }}>
            <span style={{ fontSize:12, fontWeight:700 }}>Preview: v{previewVer.version_num}</span>
            <span style={{ fontSize:11, color:'var(--text-2)' }}>{previewVer.title}</span>
            <span style={{ fontSize:11, color:'var(--text-2)', marginLeft:'auto' }}>{new Date(previewVer.saved_at).toLocaleString()}</span>
            <button onClick={()=>setPreviewVer(null)} style={{ fontSize:18, border:'none', background:'none', cursor:'pointer', color:'var(--text-2)', lineHeight:1 }}>×</button>
          </div>
          <div style={{ flex:1, overflow:'auto', background:previewVer.content_type === 'csv' ? 'var(--bg-base)' : previewVer.content_type === 'doc' ? 'var(--card-bg)' : '#fff', padding:'20px 24px' }}>
            <ContentPreview contentType={previewVer.content_type} content={previewVer.content} meta={previewVer.metadata?.sheet} />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page Drawer — Advanced editor
// ---------------------------------------------------------------------------
const CONTENT_TYPES = [
  { value:'doc',         label:'📝 Document',    hint:'Block editor — type / for commands' },
  { value:'markdown',    label:'#️⃣ Markdown (classic)', hint:'Rich text written as Markdown' },
  { value:'html',        label:'🌐 Web Page',     hint:'HTML / CSS / JS' },
  { value:'artifact',    label:'🧩 Artifact',     hint:'Interactive mini-app: calculator, form, dashboard' },
  { value:'csv',         label:'📊 Spreadsheet',  hint:'Editable grid / table' },
  { value:'text',        label:'📄 Plain Text',   hint:'Plain text / code' },
]

// Prompt-driven page generation.
//
// Published pages are served as their own document, so the model may use
// JavaScript, external stylesheets and web fonts freely. What it cannot use is
// a relative file path or persistent storage, and `warnings` reports anything
// of that kind in the result rather than letting the author find out after
// publishing.
const AI_EXAMPLES = {
  html: [
    'A one-page Q3 client update with a hero, three KPI cards and a delivery timeline',
    'A pricing page for a web design retainer with three tiers and an FAQ',
    'A project proposal page with scope, milestones and a payment schedule table',
  ],
  markdown: [
    'A monthly delivery status report with sections per project',
    'A scope-of-work document for a website redesign engagement',
    'An onboarding checklist for a new client',
  ],
}

function AiComposer({ contentType, content, onApply, isMobile }) {
  const confirm = useConfirm()
  const [open, setOpen]               = useState(false)
  const [prompt, setPrompt]           = useState('')
  const [busy, setBusy]               = useState(false)
  const [elapsed, setElapsed]         = useState(0)
  const [err, setErr]                 = useState('')
  const [note, setNote]               = useState(null)
  const [refine, setRefine]           = useState(true)

  // ── Agent Studio additions ──────────────────────────────────────────
  const [mode, setMode]               = useState('idle') // idle | interviewing | streaming | section-edit | error-fix
  const [interview, setInterview]     = useState(null)   // {questions: [...]}
  const [streamDraft, setStreamDraft] = useState('')     // live-streamed HTML
  const [thought, setThought]         = useState('')     // thought frame text
  const [plan, setPlan]               = useState(null)    // plan frame {sections: [...]}
  const [edits, setEdits]             = useState([])      // applied edit frames
  const [streamMode, setStreamMode]   = useState('create') // 'create' | 'edit'
  const [pageError, setPageError]     = useState(null)    // {message, lineno, ...}
  const [sectionEdit, setSectionEdit] = useState(null)    // {sectionId, prompt}
  const abortRef                      = useRef(null)

  const hasContent = (content || '').trim().length > 0
  const examples = AI_EXAMPLES[contentType] || AI_EXAMPLES.html

  // Elapsed time counter
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Listen for postMessage from the preview iframe (error capture + section click)
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === '__ft_page_error') {
        setPageError({
          message: e.data.message || 'Unknown error',
          lineno: e.data.lineno || 0,
          colno: e.data.colno || 0,
          stack: e.data.stack || '',
        })
      }
      if (e.data.type === '__ft_section_click' && e.data.sectionId) {
        setSectionEdit({ sectionId: e.data.sectionId, prompt: '' })
        setMode('section-edit')
        setOpen(true)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ── Interview flow ──────────────────────────────────────────────────
  const runInterview = async () => {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true); setErr(''); setNote(null); setInterview(null)
    try {
      const res = await api.pages.aiInterview({ prompt: p, content_type: contentType })
      if (res.needs_interview && res.questions?.length) {
        setInterview(res)
        setMode('interviewing')
      } else {
        // Prompt is specific enough — go straight to streaming
        await runStream(p, null)
        return
      }
    } catch (e) {
      setErr(e.message || 'Interview analysis failed.')
    } finally {
      setBusy(false)
    }
  }

  // ── SSE streaming generation ────────────────────────────────────────
  const runStream = async (promptText, clarifications) => {
    const p = (promptText || prompt).trim()
    if (!p) return
    // Replacing is destructive and there is no undo beyond version history.
    if (hasContent && !refine) {
      const ok = await confirm({
        title: 'Replace this page?',
        message: 'The current content will be replaced by the generated page. Your last saved version stays in history.',
        confirmLabel: 'Replace',
      })
      if (!ok) return
    }
    setBusy(true); setErr(''); setNote(null); setStreamDraft(''); setThought(''); setPlan(null); setEdits([])
    setMode('streaming'); setInterview(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await api.pages.aiStream({
        prompt: p,
        content_type: contentType,
        existing: (refine && hasContent) ? content : undefined,
        clarifications: clarifications || undefined,
      }, { signal: controller.signal })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let doneFrame = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE lines from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep the incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue
          try {
            const frame = JSON.parse(data)
            if (frame.type === 'thought') {
              setThought(frame.text || '')
              if (frame.mode) setStreamMode(frame.mode)
            } else if (frame.type === 'edit') {
              // A revision reports each change it applied, so the author sees
              // what was touched rather than a wall of regenerated markup.
              setEdits(e => [...e, frame])
            } else if (frame.type === 'plan') {
              setPlan(frame)
            } else if (frame.type === 'delta') {
              fullContent += frame.delta
              setStreamDraft(fullContent)
            } else if (frame.type === 'done') {
              doneFrame = frame
            } else if (frame.type === 'error') {
              throw new Error(frame.message || 'Generation failed')
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr
          }
        }
      }

      if (doneFrame) {
        onApply(doneFrame.content)
        setNote({
          model: doneFrame.model_short || doneFrame.model || '',
          warnings: doneFrame.warnings || [],
        })
        setPrompt('')
      } else if (fullContent.trim()) {
        // No done frame but we have content — use what we streamed
        onApply(fullContent)
        setNote({ model: '', warnings: ['Stream ended without a final frame'] })
        setPrompt('')
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setErr(e.message || 'Generation failed. Try again, or rephrase the prompt.')
      }
    } finally {
      setBusy(false)
      setMode('idle')
      abortRef.current = null
    }
  }

  // ── Classic non-streaming generation (fallback) ─────────────────────
  const runClassic = async () => {
    const p = prompt.trim()
    if (!p || busy) return
    if (hasContent && !refine) {
      const ok = await confirm({
        title: 'Replace this page?',
        message: 'The current content will be replaced by the generated page. Your last saved version stays in history.',
        confirmLabel: 'Replace',
      })
      if (!ok) return
    }
    setBusy(true); setErr(''); setNote(null)
    try {
      const res = await api.pages.aiGenerate({
        prompt: p,
        content_type: contentType,
        existing: (refine && hasContent) ? content : undefined,
      })
      onApply(res.content)
      setNote({ model: res.model, warnings: res.warnings || [] })
      setPrompt('')
    } catch (e) {
      setErr(e.message || 'Generation failed. Try again, or rephrase the prompt.')
    } finally {
      setBusy(false)
    }
  }

  // ── Section surgery ─────────────────────────────────────────────────
  const runSectionEdit = async () => {
    if (!sectionEdit?.sectionId || !sectionEdit?.prompt?.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const res = await api.pages.aiSectionEdit({
        content: content,
        section_id: sectionEdit.sectionId,
        prompt: sectionEdit.prompt,
      })
      onApply(res.content)
      setNote({
        model: res.model_short || '',
        warnings: res.warnings || [],
      })
      setSectionEdit(null)
      setMode('idle')
    } catch (e) {
      setErr(e.message || 'Section edit failed.')
    } finally {
      setBusy(false)
    }
  }

  // ── Error self-healing ──────────────────────────────────────────────
  const runFixError = async () => {
    if (!pageError || busy) return
    setBusy(true); setErr(''); setMode('error-fix')
    try {
      const res = await api.pages.aiFixError({
        content: content,
        error: pageError,
      })
      onApply(res.content)
      setNote({
        model: res.model_short || '',
        warnings: res.warnings || [],
      })
      setPageError(null)
      setMode('idle')
    } catch (e) {
      setErr(e.message || 'Auto-fix failed.')
    } finally {
      setBusy(false)
    }
  }

  // ── Cancel streaming ────────────────────────────────────────────────
  const cancel = () => {
    if (abortRef.current) abortRef.current.abort()
    setBusy(false)
    setMode('idle')
  }

  // Main run handler — uses interview + streaming by default
  const run = () => runInterview()

  if (!open) {
    return (
      <div style={{ padding:'6px 8px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
        <button onClick={()=>setOpen(true)} style={{ ...btnGhost, fontSize:12, display:'inline-flex', alignItems:'center', gap:6 }}>
          ✨ Agent Studio
        </button>
        {/* The strapline wraps to a second line on a phone, doubling the height
            of a row that exists only to hold one button. */}
        {!isMobile && (
          <span style={{ fontSize:11, color:'var(--text-2)', marginLeft:8 }}>
            AI-powered page design with live streaming, interviews and section editing
          </span>
        )}

        {/* Self-healing error banner — visible even when the studio is collapsed */}
        {pageError && (
          <div style={{ marginTop:4, padding:'6px 10px', background:'var(--fin-neg-bg)', border:'1px solid var(--fin-neg-border)', borderRadius:'var(--radius, 8px)', display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
            <span style={{ color:'var(--fin-negative)' }}>⚠ Runtime error: {pageError.message.slice(0, 80)}</span>
            <button onClick={runFixError} disabled={busy}
              style={{ ...btnPrimary, padding:'3px 10px', fontSize:11, background:'var(--danger-btn)', color:'var(--danger-fg)', marginLeft:'auto', flexShrink:0 }}>
              🔧 Auto-Fix
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding:isMobile?'10px 12px':'10px 14px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:12, fontWeight:700 }}>✨ Agent Studio</span>
        {mode === 'streaming' && (
          <span style={{ fontSize:11, color:'var(--accent)', fontWeight:600 }}>
            ● Live streaming
          </span>
        )}
        <button onClick={()=>setOpen(false)} style={{ ...btnGhost, fontSize:11, padding:'2px 8px', marginLeft:'auto' }}>Hide</button>
      </div>

      {/* ── Section Edit Mode ──────────────────────────────────────────── */}
      {mode === 'section-edit' && sectionEdit && (
        <div style={{ padding:'10px 12px', background:'color-mix(in srgb, var(--accent) 6%, transparent)', borderRadius:'var(--radius, 8px)', border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:8 }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--text-1)' }}>
            ✏️ Editing section: <code style={{ background:'var(--bg-base)', padding:'1px 6px', borderRadius:4, fontSize:11 }}>{sectionEdit.sectionId}</code>
          </span>
          <textarea
            value={sectionEdit.prompt}
            onChange={e => setSectionEdit(prev => ({ ...prev, prompt: e.target.value }))}
            onKeyDown={e => { if ((e.metaKey||e.ctrlKey) && e.key === 'Enter') runSectionEdit() }}
            placeholder='What should change? e.g. "make this a 3-tier pricing layout with a monthly/annual toggle"'
            rows={2}
            disabled={busy}
            style={{ ...inputStyle, width:'100%', resize:'vertical', fontFamily:'inherit', lineHeight:1.5 }}
          />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={() => { setSectionEdit(null); setMode('idle') }} disabled={busy}
              style={{ ...btnGhost, fontSize:12 }}>Cancel</button>
            <button onClick={runSectionEdit} disabled={busy || !sectionEdit.prompt?.trim()}
              style={{ ...btnPrimary, fontSize:12, opacity:(busy||!sectionEdit.prompt?.trim())?0.6:1 }}>
              {busy ? `Editing… ${elapsed}s` : 'Apply change'}
            </button>
          </div>
        </div>
      )}

      {/* ── Self-healing error banner ──────────────────────────────────── */}
      {pageError && mode !== 'section-edit' && (
        <div style={{ padding:'8px 12px', background:'var(--fin-neg-bg)', border:'1px solid var(--fin-neg-border)', borderRadius:'var(--radius, 8px)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, color:'var(--fin-negative)', flex:1, minWidth:0 }}>
            ⚠ Script error: {pageError.message.slice(0, 120)}
            {pageError.lineno > 0 && <span style={{ color:'var(--text-3)' }}> (line {pageError.lineno})</span>}
          </span>
          <button onClick={runFixError} disabled={busy}
            style={{ ...btnPrimary, padding:'4px 12px', fontSize:11, background:'var(--danger-btn)', color:'var(--danger-fg)', flexShrink:0 }}>
            {busy && mode === 'error-fix' ? `Fixing… ${elapsed}s` : '🔧 Auto-Fix with AI'}
          </button>
          <button onClick={() => setPageError(null)}
            style={{ ...btnGhost, padding:'4px 8px', fontSize:11 }}>Dismiss</button>
        </div>
      )}

      {/* ── Interview card ─────────────────────────────────────────────── */}
      {mode === 'interviewing' && interview?.questions?.length > 0 && (
        <AgentInterviewCard
          questions={interview.questions}
          onSubmit={(answers) => runStream(prompt, answers)}
          onSkip={() => runStream(prompt, null)}
          disabled={busy}
        />
      )}

      {/* ── Streaming status ───────────────────────────────────────────── */}
      {mode === 'streaming' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {thought && (
            <div style={{ fontSize:11, color:'var(--text-2)', fontStyle:'italic', padding:'4px 8px', background:'var(--bg-base)', borderRadius:'var(--radius, 8px)' }}>
              💭 {thought}
            </div>
          )}
          {plan && plan.sections?.length > 0 && (
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text-2)' }}>Sections:</span>
              {plan.sections.map(s => (
                <span key={s} style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'color-mix(in srgb, var(--accent) 10%, transparent)', color:'var(--accent)', fontWeight:500 }}>
                  {s}
                </span>
              ))}
            </div>
          )}
          {edits.length > 0 ? (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {edits.map((e, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'baseline', gap:8, fontSize:11,
                  padding:'5px 9px', borderRadius:6,
                  background: e.ok ? 'var(--bg-base)' : 'color-mix(in srgb, var(--fin-warning) 12%, transparent)',
                  border:'1px solid var(--border)',
                }}>
                  <span style={{ color: e.ok ? 'var(--fin-positive)' : 'var(--fin-warning)', fontWeight:700, flexShrink:0 }}>
                    {e.ok ? '✓' : '⚠'}
                  </span>
                  <code style={{
                    flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis',
                    whiteSpace:'nowrap', color:'var(--text-2)', fontSize:10,
                  }}>{e.search}</code>
                  <span style={{ color:'var(--text-2)', flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                    {e.ok ? `−${e.removed} +${e.added}` : 'not found'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <StreamingDraft
              content={streamDraft}
              label={streamMode === 'edit' ? 'Working out the edits' : 'Writing the page'}
            />
          )}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ flex:1, height:3, borderRadius:2, background:'var(--border)', overflow:'hidden' }}>
              <div style={{ width:'100%', height:'100%', background:'var(--accent)', animation:'indeterminate 1.5s infinite linear', transformOrigin:'left' }} />
            </div>
            <span style={{ fontSize:11, color:'var(--text-2)', flexShrink:0 }}>{elapsed}s</span>
            <button onClick={cancel} style={{ ...btnGhost, fontSize:11, padding:'2px 8px', color:'var(--fin-negative)' }}>Cancel</button>
          </div>
          <style>{`@keyframes indeterminate { 0% { transform:scaleX(0) translateX(-50%) } 50% { transform:scaleX(0.4) translateX(25%) } 100% { transform:scaleX(0) translateX(150%) } }`}</style>
        </div>
      )}

      {/* ── Prompt input (shown when not in interview/section-edit mode) ── */}
      {mode !== 'interviewing' && mode !== 'section-edit' && (
        <>
          <textarea
            value={prompt}
            onChange={e=>setPrompt(e.target.value)}
            onKeyDown={e=>{ if ((e.metaKey||e.ctrlKey) && e.key === 'Enter') run() }}
            placeholder={hasContent && refine
              ? 'What should change? e.g. "make the hero dark and add a testimonials section"'
              : 'Describe the page. e.g. "a Q3 client update with KPI cards and a timeline"'}
            rows={isMobile ? 3 : 2}
            disabled={busy}
            style={{ ...inputStyle, width:'100%', resize:'vertical', fontFamily:'inherit', lineHeight:1.5 }}
          />

          {!prompt && !busy && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {examples.map(ex=>(
                <button key={ex} onClick={()=>setPrompt(ex)} disabled={busy}
                  style={{ fontSize:11, border:'1px solid var(--border)', borderRadius:99, padding:'3px 10px', background:'var(--bg-base)', color:'var(--text-2)', cursor:'pointer', textAlign:'left' }}>
                  {ex.length > 58 ? ex.slice(0, 58) + '…' : ex}
                </button>
              ))}
            </div>
          )}

          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {hasContent && (
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-2)', cursor:'pointer' }}>
                <input type="checkbox" checked={refine} onChange={e=>setRefine(e.target.checked)} disabled={busy} />
                Revise the current page
              </label>
            )}
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button onClick={runClassic} disabled={busy || !prompt.trim()} title="Generate without streaming or interview"
                style={{ ...btnSecondary, fontSize:12, opacity:(busy||!prompt.trim())?0.6:1 }}>
                Classic
              </button>
              <button onClick={run} disabled={busy || !prompt.trim()}
                style={{ ...btnPrimary, opacity:(busy||!prompt.trim())?0.6:1 }}>
                {busy && mode !== 'streaming' ? `Generating… ${elapsed}s` : (hasContent && refine ? '✨ Revise' : '✨ Generate')}
              </button>
            </div>
          </div>
        </>
      )}

      {!busy && mode === 'idle' && (
        <div style={{ fontSize:10, color:'var(--text-2)', opacity:0.7 }}>
          💡 Tip: Click a section in Preview to edit it surgically. Runtime errors trigger auto-fix.
        </div>
      )}

      {err && <div style={{ fontSize:12, color:'var(--fin-negative)' }}>{err}</div>}
      {note && (
        <div style={{ fontSize:11, color:'var(--text-2)' }}>
          ✓ Generated with {note.model || 'AI'}. Review it in Preview before publishing.
          {note.warnings.length > 0 && (
            <span style={{ color:'var(--fin-warning)' }}>
              {' '}Check {note.warnings.join('; ')}.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// Expiry is entered and shown in IST. A live countdown makes it obvious how
// long the link has left without doing date arithmetic in your head.
function ExpiryField({ value, onChange, isMobile }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!value) return
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(iv)
  }, [value])
  const expired = !!value && msUntil(value, now) <= 0
  return (
    <div>
      <label style={labelStyle} htmlFor="ft-expiry">Link expires (IST)</label>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <input id="ft-expiry" type="datetime-local" value={toIstInput(value)}
          onChange={e=>onChange(fromIstInput(e.target.value))}
          style={{ ...inputStyle, width:isMobile?'100%':190, fontSize:12 }} />
        <select value="" aria-label="Quick expiry"
          onChange={e=>{ const v=e.target.value; if (v==='never') onChange(''); else if (v) onChange(expiryPreset(v)) }}
          style={{ ...inputStyle, width:'auto', fontSize:12 }}>
          <option value="">Quick…</option>
          <option value="1h">In 1 hour</option>
          <option value="eod">Tonight, 11:59 pm</option>
          <option value="24h">In 24 hours</option>
          <option value="7d">In 7 days</option>
          <option value="30d">In 30 days</option>
          <option value="never">Never expires</option>
        </select>
      </div>
      {value && (
        <div style={{ fontSize:11, marginTop:3, color:expired?'var(--fin-negative)':'var(--text-2)' }}>
          {expired ? '⛔ Expired: the link no longer opens' : `⏳ ${formatIst(value)} · ${countdown(value, now)}`}
        </div>
      )}
    </div>
  )
}

// Everything an auto-save compares: a change to any of these is saved. While a
// live editing session owns a document's content (`liveContent`), the content
// is left out: the server saves it.
function snapOf(f, liveContent = false) {
  return JSON.stringify({
    title:f.title||'', content_type:f.content_type||'markdown', content:liveContent ? null : (f.content||''), slug:f.slug||'',
    description:f.description||'', folder:(f.folder||'').trim(), protect_source:!!f.protect_source,
    expires_at:f.expires_at||'',
    sheet:f.content_type === 'csv' && f.sheet ? f.sheet : null,
    full_width:f.content_type === 'doc' && !!f.full_width,
  })
}

// Content carried across a type switch. Markdown and plain text become a
// block document; a block document going back to a text type is written out
// as Markdown, so nothing typed is lost either way.
function convertContent(content, from, to) {
  if (!content || !content.trim() || from === to) return content
  if (to === 'doc') {
    if (parseDoc(content)) return content
    return serializeDoc(from === 'markdown' ? markdownToDoc(content) : plainTextToDoc(content))
  }
  if (from === 'doc') {
    const d = parseDoc(content)
    return d ? docToMarkdown(d) : content
  }
  return content
}

// Uploads go through the existing page-asset endpoint; the URL is made
// absolute because published pages are served from another origin.
async function uploadDocImage(file) {
  const res = await api.pages.uploadAsset(file)
  if (!res || res.error || res.detail) throw new Error(res?.detail || res?.error?.message || res?.error || 'Upload failed')
  if (!res.is_image) throw new Error('That file is not an image')
  return absUrl(res.url)
}

// The block document canvas: a Notion-style title over the editor, centred at
// reading width unless the page is set to full width.
function DocCanvas({ form, set, setContent, isMobile, stats, belowTitle, pageId, onLiveMode, isContentSaved }) {
  const editorRef = useRef(null)
  const titleRef = useRef(null)
  const [presenceSlot, setPresenceSlot] = useState(null)
  useEffect(() => {
    const t = titleRef.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [form.title, form.full_width, isMobile])
  return (
    <div className="ft-doc-scroll" style={{ flex:1, overflowY:'auto', overflowX:'hidden', background:'var(--card-bg)' }}>
      <div style={{ maxWidth: form.full_width ? 'none' : (isMobile ? 'none' : 720 + 192), margin:'0 auto', padding: isMobile ? '12px 16px 0' : '28px 96px 0', boxSizing:'border-box' }}>
        <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, fontSize:12, color:'var(--text-2)', minHeight:24, marginBottom:isMobile?4:12 }}>
          <span ref={setPresenceSlot} style={{ display:'inline-flex', marginRight:'auto', minWidth:0 }} />
          {stats?.label && <span aria-live="polite">{stats.label}</span>}
          {!isMobile && (
            <button type="button" onClick={()=>set('full_width', !form.full_width)} aria-pressed={!!form.full_width}
              style={{ ...btnGhost, fontSize:12, padding:'3px 8px', display:'inline-flex', alignItems:'center', gap:5 }}
              title={form.full_width ? 'Use reading width' : 'Use the full width of the screen'}>
              {form.full_width ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {form.full_width ? 'Reading width' : 'Full width'}
            </button>
          )}
        </div>
        <textarea ref={titleRef} rows={1} aria-label="Page title" placeholder="Page title…" value={form.title}
          onChange={e=>set('title', e.target.value.replace(/\n/g, ' '))}
          onKeyDown={e=>{ if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) { e.preventDefault(); const ed = editorRef.current; if (ed && !ed.isDestroyed) { ed.view.focus(); ed.commands.focus('start') } } }}
          style={{ display:'block', width:'100%', resize:'none', overflow:'hidden', border:'none', outline:'none', background:'transparent', color:'var(--text-1)', fontFamily:'var(--font-sans)', fontSize:isMobile?30:40, fontWeight:700, lineHeight:1.2, letterSpacing:'-0.02em', padding:'0 2px', margin:'0 0 14px' }} />
        {belowTitle}
        <Suspense fallback={<div style={{ color:'var(--text-3)', fontSize:15, padding:'4px 2px' }}>Loading editor…</div>}>
          <CollabDoc pageId={pageId} value={form.content} onChange={setContent} uploadImage={uploadDocImage}
            onReady={ed => { editorRef.current = ed }} presenceSlot={presenceSlot}
            onModeChange={onLiveMode} isContentSaved={isContentSaved} />
        </Suspense>
      </div>
    </div>
  )
}

function PageDrawer({ page, onClose, onSaved, initialType, folders = [], onOpenPage, onCreateChild }) {
  const confirm = useConfirm()
  const { hasPerm } = useAuth()
  const isMobile = useIsMobile()
  const textareaRef = useRef(null)
  // currentId tracks the DB row: starts from the passed page, but auto-save can
  // create a draft on the server for a brand-new page, after which this holds
  // the new id so every later save PATCHes instead of creating duplicates.
  const [currentId, setCurrentId] = useState(page?.id || null)
  const isEdit = !!currentId
  const [form, setForm] = useState({
    title:                page?.title || '',
    content_type:         page?.content_type || initialType || 'markdown',
    content:              page?.content || (!page && initialType === 'csv' ? BLANK_SHEET.content : ''),
    slug:                 page?.slug || '',
    is_password_protected:page?.is_password_protected || false,
    password:             '',
    description:          page?.metadata?.description || '',
    folder:               page?.metadata?.folder || '',
    protect_source:       !!page?.metadata?.protect_source,
    expires_at:           page?.expires_at || '',
    sheet:                page?.metadata?.sheet,
    full_width:           !!page?.metadata?.full_width,
  })
  // Metadata keys this editor does not manage (set by other features) ride
  // along unchanged on every save instead of being dropped.
  const baseMetaRef = useRef(page?.metadata || {})
  const metadataOf = (f) => ({
    ...baseMetaRef.current,
    description: f.description,
    folder: (f.folder || '').trim() || undefined,
    protect_source: f.protect_source || undefined,
    // Sheet formatting belongs to spreadsheets; other types keep whatever
    // metadata.sheet they already carry.
    ...(f.content_type === 'csv' ? { sheet: f.sheet || undefined } : {}),
    ...(f.content_type === 'doc' ? { full_width: f.full_width || undefined } : {}),
  })
  const [slugManual, setSlugManual] = useState(!!page?.slug)
  const [tab, setTab] = useState('edit')
  // Mobile only: slug, description, password and document type live behind this
  // rather than above the editor. Open by default for a page that has no title
  // yet, since a brand-new page needs them before anything else makes sense.
  const [showSettings, setShowSettings] = useState(!page?.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState('') // '', 'saving', 'saved', 'error', 'offline'
  const [autoSaveError, setAutoSaveError] = useState('')
  // Desktop opens the gallery for a blank page; a phone does not, because the
  // row costs 60px above the editor. The "Use template" button in the tab row
  // is how it is reached there.
  const [showTemplates, setShowTemplates] = useState(!page?.content && !isMobile)
  const [slugStatus, setSlugStatus] = useState(null) // null | { available, suggestions }
  const charLimit = 5_000_000  // effectively unlimited; lets docs embed images/files
  const autoSaveKey = `pages_draft_${page?.id || 'new'}`
  const createdRef = useRef(false)   // guards against double-create races
  const createPromiseRef = useRef(null) // holds in-flight create promise so handleSave can await it
  const savedSnapRef = useRef(snapOf({ ...page, description:page?.metadata?.description, folder:page?.metadata?.folder, protect_source:page?.metadata?.protect_source, sheet:page?.metadata?.sheet, full_width:page?.metadata?.full_width }))
  const [converting, setConverting] = useState(false)
  // Live co-editing (block documents): while 'live' or 'reconnecting' the
  // server saves the content, so autosave sends everything but the content.
  const [liveMode, setLiveMode] = useState('off')
  const liveModeRef = useRef('off')
  const liveContent = liveMode === 'live' || liveMode === 'reconnecting'
  const formRef = useRef(form)
  formRef.current = form
  const [saveRetry, setSaveRetry] = useState(0)
  // Content counts as saved when the last successful save carried exactly it.
  const isContentSaved = useCallback(() => {
    try { return JSON.parse(savedSnapRef.current).content === (formRef.current.content || '') } catch { return false }
  }, [])
  const onLiveMode = useCallback((next, info = {}) => {
    const prev = liveModeRef.current
    if (prev === next) return
    liveModeRef.current = next
    const wasManaged = prev === 'live' || prev === 'reconnecting'
    const managed = next === 'live' || next === 'reconnecting'
    if (managed !== wasManaged) {
      // Keep the saved snapshot comparable: entering a session drops the
      // content from it; leaving one cleanly marks what the server holds as
      // saved, so only edits it has not seen go out through autosave.
      try {
        const snap = JSON.parse(savedSnapRef.current)
        snap.content = !managed && (prev === 'live' || info.contentSynced) ? (formRef.current.content || '') : null
        savedSnapRef.current = JSON.stringify(snap)
      } catch { /* nothing saved yet */ }
    }
    setLiveMode(next)
  }, [])

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), [])
  const setContent = useCallback((v) => setForm(f => ({ ...f, content: v })), [])
  const setSheet = useCallback((v) => setForm(f => ({ ...f, sheet: v })), [])
  const changeType = (type) => {
    setForm(f => {
      const content = convertContent(f.content, f.content_type, type)
      return { ...f, content_type: type, content, ...(type === 'csv' && !content.trim() ? { content: BLANK_SHEET.content } : {}) }
    })
    setShowTemplates(!page?.content && !isMobile)
  }

  // Debounced content for expensive child components (AttachmentsBar runs regex on every
  // render — pass a 400ms-debounced version so it only re-scans after typing pauses).
  const debouncedContent = useDebounce(form.content, 400)

  // ── Hydrate from the full record on edit ──────────────────────────────────
  // openEdit opens the drawer instantly with the lightweight list row (which has
  // NO `content`), then fetches the full page. Re-seed the form once the full
  // record (with content) arrives, so editing an existing page shows its data.
  const hydratedIdRef = useRef(null)
  useEffect(() => {
    if (!page?.id) return
    if (hydratedIdRef.current === page.id) return
    if (page.content == null) return   // wait for the full record
    hydratedIdRef.current = page.id
    const next = {
      title:                page.title || '',
      content_type:         page.content_type || 'markdown',
      content:              page.content || '',
      slug:                 page.slug || '',
      is_password_protected:page.is_password_protected || false,
      password:             '',
      description:          page?.metadata?.description || '',
      folder:               page?.metadata?.folder || '',
      protect_source:       !!page?.metadata?.protect_source,
      expires_at:           page.expires_at || '',
      sheet:                page?.metadata?.sheet,
      full_width:           !!page?.metadata?.full_width,
    }
    baseMetaRef.current = page.metadata || {}
    setForm(next)
    setShowTemplates(false)
    savedSnapRef.current = snapOf(next)
  }, [page?.id, page?.content])

  // Auto-slug
  useEffect(() => { if (!slugManual && form.title) set('slug', slugify(form.title)) }, [form.title, slugManual])

  // ── Duplicate-slug detection ──────────────────────────────────────────────
  // Check availability as the slug changes; warn + suggest alternatives if taken.
  const debouncedSlug = useDebounce(form.slug, 500)
  useEffect(() => {
    if (!debouncedSlug) { setSlugStatus(null); return }
    let cancelled = false
    api.pages.slugCheck(debouncedSlug, currentId || undefined)
      .then(r => { if (!cancelled) setSlugStatus(r) })
      .catch(() => { if (!cancelled) setSlugStatus(null) })
    return () => { cancelled = true }
  }, [debouncedSlug, currentId])

  // ── DB-backed auto-save ───────────────────────────────────────────────────
  // Debounce the whole savable payload (~1.2s). First change on a new page
  // creates an unpublished draft; thereafter we PATCH. localStorage is kept as
  // an offline backup so nothing is lost if the network drops.
  const payloadOf = (f) => ({
    title:        f.title,
    content_type: f.content_type,
    content:      liveContent ? undefined : f.content,
    slug:         f.slug || undefined,
    metadata:     metadataOf(f),
    expires_at:   f.expires_at || '',
  })
  const savePayload = useMemo(() => payloadOf(form), [form, liveContent]) // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => snapOf(form, liveContent), [form, liveContent])
  const debouncedSnap = useDebounce(snapshot, 1200)

  useEffect(() => {
    if (debouncedSnap === savedSnapRef.current) return   // nothing changed
    if (!form.title.trim()) return                        // need a title to persist
    let cancelled = false
    ;(async () => {
      setAutoSaveStatus('saving')
      // Always write a local backup first (instant, survives crashes)
      try { localStorage.setItem(autoSaveKey, JSON.stringify({ ...savePayload, ts:Date.now() })) } catch {}
      try {
        let saved
        if (currentId) {
          saved = await api.pages.update(currentId, savePayload)
        } else if (!createdRef.current) {
          createdRef.current = true
          createPromiseRef.current = api.pages.create(savePayload)
          saved = await createPromiseRef.current
          createPromiseRef.current = null
          if (saved?.id && !cancelled) setCurrentId(saved.id)
        } else {
          return  // a create is already in flight; wait for next tick
        }
        if (saved?.detail || saved?.error) throw new Error(saved.detail || saved.error)
        if (cancelled) return
        savedSnapRef.current = debouncedSnap
        setAutoSaveError('')
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus(s => s === 'saved' ? '' : s), 2500)
      } catch (e) {
        createdRef.current = false   // allow retry
        createPromiseRef.current = null
        if (!cancelled) { setAutoSaveStatus('error'); setAutoSaveError(e?.message || 'Save failed') }
        // 409: the page is open in a live session elsewhere; try again shortly.
        if (e?.status === 409) setTimeout(() => setSaveRetry(n => n + 1), 4000)
      }
    })()
    return () => { cancelled = true }
  }, [debouncedSnap, saveRetry]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore a local backup on open if the server copy is empty/older
  useEffect(() => {
    if (page?.content) return
    try {
      const d = localStorage.getItem(autoSaveKey)
      if (!d) return
      const parsed = JSON.parse(d)
      if (parsed.content && parsed.ts > Date.now() - 7 * 24 * 3600 * 1000) {
        // Effect body cannot await; the promise form keeps the same guard.
        confirm({
          title: 'Restore unsaved draft',
          message: 'An unsaved draft from your last session was found. Restore it?',
          confirmLabel: 'Restore draft',
          cancelLabel: 'Discard',
          tone: 'default',
        }).then(ok => {
          if (!ok) return
          set('content', parsed.content)
          if (parsed.metadata?.sheet) set('sheet', parsed.metadata.sheet)
          if (parsed.title && !form.title) set('title', parsed.title)
        })
      }
    } catch {}
  }, [])

  const handleSave = async (publish = false) => {
    if (!form.title.trim()) { setError('Title is required'); return }
    if (form.content.length > charLimit) { setError(`Content exceeds ${charLimit.toLocaleString()} characters`); return }
    setSaving(true); setError('')
    try {
      const payload = {
        title:                form.title,
        content_type:         form.content_type,
        content:              liveContent ? undefined : form.content,
        slug:                 form.slug || undefined,
        is_password_protected:form.is_password_protected,
        password:             form.is_password_protected && form.password ? form.password : undefined,
        metadata:             metadataOf(form),
        expires_at:           form.expires_at || '',
      }
      // If auto-save is mid-create, await that promise and use its ID instead of creating a duplicate
      let resolvedId = currentId
      if (!resolvedId && createPromiseRef.current) {
        try { const r = await createPromiseRef.current; if (r?.id) { resolvedId = r.id; setCurrentId(r.id) } } catch {}
      }
      let saved = resolvedId
        ? await api.pages.update(resolvedId, payload)
        : await api.pages.create(payload)
      if (saved?.detail || saved?.error) throw new Error(saved.detail || saved.error)
      if (saved?.id) setCurrentId(saved.id)
      // Publishing copies the working copy to the public version, so it runs
      // on Update too, not only the first time a page goes live.
      if (publish && saved?.id) saved = await api.pages.publish(saved.id, true)
      localStorage.removeItem(autoSaveKey)
      onSaved(saved)
    } catch (e) { setError(e?.message || 'Failed to save.') }
    finally { setSaving(false) }
  }

  // Closing the drawer should never lose work: if there are unsaved changes,
  // fire a save (fire-and-forget, also backed by localStorage) before closing.
  const flushAndClose = () => {
    if (snapshot !== savedSnapRef.current && form.title.trim()) {
      const payload = savePayload
      try { localStorage.setItem(autoSaveKey, JSON.stringify({ ...payload, ts:Date.now() })) } catch {}
      // Guard against creating a duplicate when an auto-save create is already
      // in flight (createdRef) but currentId hasn't been set yet.
      if (currentId) {
        api.pages.update(currentId, payload).catch(()=>{})
      } else if (!createdRef.current) {
        createdRef.current = true
        api.pages.create(payload).catch(()=>{})
      }
    }
    onClose()
  }

  // On a phone, opening Settings replaces the editor rather than pushing it
  // down. Sharing the screen left the textarea 66px tall — a form and an editor
  // cannot both fit a phone viewport, so only one is on screen at a time.
  const mobileSettingsMode = isMobile && showSettings

  const stats = useMemo(() => docStats(form.content, form.content_type), [form.content, form.content_type])
  const shareUrl = form.slug ? `${window.location.origin}/p/${form.slug}` : ''
  const isSpreadsheet = form.content_type === 'csv'
  const isHtml = form.content_type === 'html'
  const isMarkdown = form.content_type === 'markdown'
  const isDoc = form.content_type === 'doc'
  // The page generator writes Markdown; a block document hands it Markdown
  // and turns the result back into blocks.
  const aiContent = useMemo(() => (isDoc ? convertContent(form.content, 'doc', 'markdown') : form.content), [isDoc, form.content])

  // Markdown page -> block document. The current Markdown is kept as a named
  // version first (the same request writes it), so the switch can be undone
  // from History.
  const convertToBlocks = async () => {
    if (!(await confirm({
      title: 'Convert to blocks',
      message: 'This page becomes a block document: headings, lists, tables and images carry over. The Markdown version is saved in History first, so you can restore it at any time.',
      confirmLabel: 'Convert',
      tone: 'default',
    }))) return
    const next = { ...form, content_type: 'doc', content: serializeDoc(markdownToDoc(form.content)) }
    if (currentId) {
      setConverting(true); setError('')
      try {
        const saved = await api.pages.update(currentId, { ...payloadOf(next), version_note: 'Before converting to blocks' })
        if (!saved || saved.detail || saved.error) throw new Error(saved?.detail || saved?.error?.message || saved?.error || 'Conversion failed')
        savedSnapRef.current = snapOf(next)
      } catch (e) {
        setError(e?.message || 'Conversion failed')
        return
      } finally { setConverting(false) }
    }
    setForm(next)
    setTab('edit')
    setShowTemplates(false)
  }
  const isArtifact = form.content_type === 'artifact'
  // A database edits its own rows and schema; a row page shows its values above the content.
  const isDatabase = form.content_type === 'database'
  const rowPanel = currentId && !isDatabase ? <RowPropertiesPanel pageId={currentId} onOpenDatabase={p=>{ flushAndClose(); onOpenPage?.(p) }} /> : null

  const placeholders = {
    doc: '',
    markdown: '# Start writing…\n\nUse the toolbar above for formatting, or write markdown directly.',
    html: '<!DOCTYPE html>\n<html><head>…</head><body>…</body></html>',
    text: 'Start typing your plain text content…',
  }

  // height pinned to the dynamic viewport for the same reason as the panel:
  // inset:0 alone is measured against the large viewport on iOS while the
  // address bar is expanded, which pushes the top of the panel out of reach.
  const drawerBase = { position:'fixed', inset:0, height:'100dvh', display:'flex', justifyContent:'flex-end' }
  const drawerStyle = fullscreen
    ? { ...drawerBase, zIndex:2000, background:'rgba(0,0,0,0.6)' }
    : { ...drawerBase, zIndex:1000, background:'rgba(0,0,0,0.45)' }

  const panelStyle = {
    width: fullscreen ? '100vw' : isMobile ? '100vw' : '94vw',
    maxWidth: fullscreen ? '100vw' : 1200,
    // 100dvh, not 100%: on iOS the address bar expands and contracts, and a
    // fixed inset:0 panel measured against the large viewport gets its top
    // pushed off screen — which is what hid the document-type row.
    height: '100dvh',
    maxHeight: '100dvh',
    // The notch and home indicator overlay the viewport. Without these the
    // first header row sits under the status bar and cannot be tapped. The
    // rest of the app already does this; this drawer was the exception.
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    boxSizing: 'border-box',
    background: 'var(--bg-base)',
    overflowY: 'hidden',
    boxShadow: '-4px 0 32px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <Overlay>
    <div style={drawerStyle} onClick={flushAndClose}>
      <div style={panelStyle} onClick={e=>e.stopPropagation()}>

        {/* Header.
            Mobile gets a purpose-built layout rather than relying on flex-wrap.
            In the single-row version the type <select> sits at width:auto beside
            the stats text and four buttons; on a 390px screen it collapses to a
            few pixels wide and cannot be tapped, which is why the document type
            could not be changed on a phone. Here it gets a labelled row of its
            own and the actions get theirs. */}
        {isMobile ? (
          <>
            {/* One bar, not four. The old header stacked a type row, three
                full-width buttons and a stats line — and below it came the meta
                fields, an AI row, an upload row, tabs and a description banner,
                so on a 390x700 phone roughly 500px of chrome sat above a
                sliver of editor. Everything that is not "who am I and how do I
                publish" now lives behind Settings. */}
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 10px 8px 4px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <button onClick={flushAndClose} aria-label="Close editor" disabled={saving}
                style={{ ...btnGhost, padding:'4px 10px', fontSize:20, lineHeight:1.1, flexShrink:0 }}>×</button>
              {isDoc && !mobileSettingsMode ? (
                <span style={{ flex:1, minWidth:0, fontSize:14, fontWeight:600, color:'var(--text-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', padding:'4px 2px' }}>
                  {form.title || 'Untitled'}
                </span>
              ) : (
              <input
                aria-label="Page title"
                placeholder="Page title…"
                value={form.title}
                onChange={e=>set('title',e.target.value)}
                style={{ flex:1, minWidth:0, fontSize:16, fontWeight:700, border:'none', outline:'none', background:'transparent', color:'var(--text-1)', padding:'4px 2px' }} />
              )}
              {currentId && <CommentsToggle pageId={currentId} compact />}
              <button onClick={()=>handleSave(true)} disabled={saving}
                style={{ ...btnPrimary, padding:'8px 13px', flexShrink:0, whiteSpace:'nowrap' }}>
                {saving ? '…' : isEdit && page?.is_published ? 'Update' : 'Publish'}
              </button>
            </div>

            {/* The status line doubles as the disclosure, so it costs one row
                rather than two. Auto-save is what makes this safe: the state it
                reports is the reason an explicit Draft button no longer needs
                to be on screen at all times. */}
            <button
              onClick={()=>setShowSettings(s=>!s)}
              aria-expanded={showSettings}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'6px 12px', border:'none', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', color:'var(--text-2)', fontSize:11, cursor:'pointer', textAlign:'left', flexShrink:0 }}>
              <span style={{ flex:1, minWidth:0, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                /p/{form.slug || '…'}
              </span>
              {autoSaveStatus === 'saved'  && <span style={{ color:'var(--fin-positive)', flexShrink:0 }}>✓ Saved</span>}
              {autoSaveStatus === 'saving' && <span style={{ flexShrink:0 }}>☁ Saving…</span>}
              {autoSaveStatus === 'error'  && <span style={{ color:'var(--fin-negative)', flexShrink:0 }} title={autoSaveError}>⚠ Not saved</span>}
              <span style={{ flexShrink:0, fontWeight:700, color:'var(--accent)' }}>
                Settings {showSettings ? '▲' : '▼'}
              </span>
            </button>
            {error && <div style={{ padding:'6px 12px', fontSize:12, color:'var(--fin-negative)', flexShrink:0 }}>{error}</div>}
          </>
        ) : (
        <div style={{ padding:isMobile?'10px 14px':'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <select value={form.content_type} onChange={e=>changeType(e.target.value)} disabled={isDatabase}
              style={{ ...inputStyle, width:'auto', fontSize:12, padding:'5px 8px', fontWeight:600 }}>
              {isDatabase && <option value="database">🗃️ Database</option>}
              {CONTENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{ display:'flex', gap:6, fontSize:11, color:'var(--text-2)' }}>
              {stats.label && <span>{stats.label}</span>}
              {stats.readTime !== '—' && <span>· {stats.readTime}</span>}
              {form.content.length > charLimit * 0.8 && (
                <span style={{ color:form.content.length>charLimit?'var(--fin-negative)':'var(--fin-warning)', fontWeight:600 }}>
                  {form.content.length.toLocaleString()} / {charLimit.toLocaleString()} chars
                </span>
              )}
              {autoSaveStatus === 'saved' && <span style={{ color:'var(--fin-positive)' }}>✓ Saved to cloud</span>}
              {autoSaveStatus === 'saving' && <span style={{ color:'var(--text-3)' }}>☁ Saving…</span>}
              {autoSaveStatus === 'error' && <span style={{ color:'var(--fin-negative)' }} title={autoSaveError}>⚠ Save failed — {autoSaveError || 'kept local backup'}</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            {error && <span style={{ color:'var(--fin-negative)', fontSize:12 }}>{error}</span>}
            {currentId && <CommentsToggle pageId={currentId} />}
            <button onClick={()=>setFullscreen(f=>!f)} style={{ ...btnGhost, fontSize:14, padding:'5px 10px' }} title={fullscreen?'Exit fullscreen':'Fullscreen'}>{fullscreen?'⊡':'⊞'}</button>
            <button onClick={flushAndClose} style={btnGhost} disabled={saving}>Close</button>
            <button onClick={()=>handleSave(false)} style={btnSecondary} disabled={saving}>{saving?'Saving…':'Save Draft'}</button>
            <button onClick={()=>handleSave(true)} style={btnPrimary} disabled={saving}>
              {saving?'Publishing…':isEdit&&page?.is_published?'Update':'Publish'}
            </button>
          </div>
        </div>
        )}

        {currentId && <PageBreadcrumbs pageId={currentId} title={form.title} onOpen={p=>{ flushAndClose(); onOpenPage?.(p) }} />}

        {/* Meta fields. On a phone the whole block is behind Settings and gets
            its own scroll, so opening it can never push the editor off screen. */}
        {(!isMobile || showSettings) && (
        <div style={{ padding:isMobile?'12px 14px':'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', gap:isMobile?14:10, flexWrap:'wrap', alignContent:'flex-start', flexShrink:0, flex:mobileSettingsMode?'1 1 auto':'0 0 auto', minHeight:0, overflowY:isMobile?'auto':undefined, background:isMobile?'var(--card-bg)':undefined }}>
          {isMobile ? (
            <div style={{ flex:'1 1 100%' }}>
              <label style={labelStyle} htmlFor="ft-doctype">Document type</label>
              <select id="ft-doctype" value={form.content_type}
                onChange={e=>changeType(e.target.value)} disabled={isDatabase}
                style={{ ...inputStyle, width:'100%', fontWeight:600 }}>
                {isDatabase && <option value="database">🗃️ Database</option>}
                {CONTENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ fontSize:11, color:'var(--text-2)', marginTop:4 }}>
                {CONTENT_TYPES.find(t=>t.value===form.content_type)?.hint}
              </div>
            </div>
          ) : isDoc && tab === 'edit' ? null : (
            <div style={{ flex:'3 1 200px' }}>
              <input style={{ ...inputStyle, fontSize:16, fontWeight:700, border:'none', borderBottom:'2px solid var(--border)', borderRadius:0, padding:'6px 0', background:'transparent' }}
                placeholder="Page title…"
                value={form.title} onChange={e=>set('title',e.target.value)} />
            </div>
          )}
          <div style={{ flex:isMobile?'1 1 100%':'2 1 150px' }}>
            <label style={labelStyle}>Slug (URL)</label>
            <div style={{ position:'relative' }}>
              <input style={{ ...inputStyle, fontFamily:'monospace', fontSize:12, paddingLeft:38 }}
                placeholder="my-page-url"
                value={form.slug}
                onChange={e=>{setSlugManual(true);set('slug',e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'').replace(/--+/g,'-'))}}
              />
              <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', fontSize:11, color:'var(--text-2)', pointerEvents:'none' }}>/p/</span>
            </div>
            {shareUrl&&<div style={{ fontSize:10, color:'var(--accent)', marginTop:2, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{shareUrl}</div>}
            {slugStatus && !slugStatus.available && (
              <div style={{ marginTop:4, fontSize:11, color:'var(--fin-warning)' }}>
                ⚠ This URL is already taken{slugStatus.suggestions?.length ? ' — try:' : '.'}
                {slugStatus.suggestions?.length > 0 && (
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:3 }}>
                    {slugStatus.suggestions.map(s=>(
                      <button key={s} type="button" onClick={()=>{ setSlugManual(true); set('slug', s) }}
                        style={{ fontSize:11, fontFamily:'monospace', border:'1px solid var(--border)', borderRadius:5, padding:'2px 6px', background:'var(--bg-base)', color:'var(--accent)', cursor:'pointer' }}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {slugStatus && slugStatus.available && form.slug && (
              <div style={{ marginTop:4, fontSize:11, color:'var(--fin-positive)' }}>✓ URL is available</div>
            )}
          </div>
          <div style={{ flex:isMobile?'1 1 100%':'2 1 150px' }}>
            <label style={labelStyle}>Description (for SEO)</label>
            <input style={inputStyle} placeholder="Short description" value={form.description} onChange={e=>set('description',e.target.value)} />
          </div>
          <div style={{ flex:isMobile?'1 1 100%':'0 0 auto', display:'flex', alignItems:isMobile?'center':'flex-end', gap:8, flexWrap:'wrap' }}>
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={form.is_password_protected} onChange={e=>set('is_password_protected',e.target.checked)} />
              🔒 Password
            </label>
            {form.is_password_protected&&(
              <input style={{ ...inputStyle, width:isMobile?'100%':110, fontSize:12 }} type="password" placeholder="Set password" value={form.password} onChange={e=>set('password',e.target.value)} />
            )}
          </div>
          <div style={{ flex:isMobile?'1 1 100%':'1 1 160px' }}>
            <label style={labelStyle} htmlFor="ft-folder">Folder</label>
            <input id="ft-folder" list="ft-folders" style={inputStyle} placeholder="e.g. Clients" value={form.folder}
              onChange={e=>set('folder',e.target.value.slice(0,80))} />
            <datalist id="ft-folders">{folders.map(f=><option key={f} value={f} />)}</datalist>
          </div>
          <div style={{ flex:isMobile?'1 1 100%':'0 0 auto' }}>
            <ExpiryField value={form.expires_at} onChange={v=>set('expires_at',v)} isMobile={isMobile} />
          </div>
          <div style={{ flex:isMobile?'1 1 100%':'0 0 auto', display:'flex', alignItems:isMobile?'center':'flex-end' }}>
            <label title="Visitors cannot right-click, save the page, or open its source with keyboard shortcuts, and the code is not sent outside the page itself."
              style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap', paddingBottom:isMobile?0:6 }}>
              <input type="checkbox" checked={form.protect_source} onChange={e=>set('protect_source',e.target.checked)} />
              🛡 Protect code
            </label>
          </div>
          {isMobile && (stats.label || stats.readTime !== '—') && (
            <div style={{ flex:'1 1 100%', fontSize:11, color:'var(--text-2)' }}>
              {stats.label}{stats.readTime !== '—' ? ` · ${stats.readTime}` : ''}
            </div>
          )}
          {isMobile && (
            <div style={{ flex:'1 1 100%', display:'flex', gap:8, alignItems:'center', borderTop:'1px solid var(--border)', paddingTop:12 }}>
              <button onClick={()=>handleSave(false)} disabled={saving} style={{ ...btnSecondary, flex:1 }}>
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
              <button onClick={()=>setShowSettings(false)} style={{ ...btnGhost, flex:1 }}>Done</button>
            </div>
          )}
        </div>
        )}

        {!mobileSettingsMode && (<>
        {/* AI composer — Web Page and Document only. Spreadsheet and Plain
            Text are structured formats the generator has no useful contract for.
            The server refuses page generation without module.ai.use, as it does
            the AI Assistant, so the composer is hidden from whoever lacks it. */}
        {(isHtml || isMarkdown || isDoc) && tab === 'edit' && hasPerm('module.ai.use') && (
          <AiComposer
            contentType={isDoc ? 'markdown' : form.content_type}
            content={aiContent}
            isMobile={isMobile}
            onApply={c=>{ setContent(isDoc ? convertContent(c, 'markdown', 'doc') : c); setShowTemplates(false) }}
          />
        )}

        {/* Templates bar */}
        {showTemplates && tab !== 'history' && !isArtifact && (
          <TemplatePicker contentType={form.content_type} onSelect={t=>{
            setForm(f => ({ ...f, content:t.content, ...(f.content_type === 'csv' ? { sheet:t.sheet } : {}) }))
            setShowTemplates(false)
          }} />
        )}

        {/* Toolbar for markdown */}
        {isMarkdown && tab === 'edit' && (
          <MarkdownToolbar textareaRef={textareaRef} value={form.content} onChange={setContent} isMobile={isMobile} />
        )}
        {isHtml && tab === 'edit' && (
          <div style={{ display:'flex', gap:1, padding:'6px 8px', background:'var(--card-bg)', borderBottom:'1px solid var(--border)', alignItems:'center', flexShrink:0 }}>
            <ImportHtmlButton value={form.content} onChange={c=>{ setContent(c); setShowTemplates(false) }}
              onTitle={t=>{ if (!form.title.trim() && t) set('title', t) }} label={isMobile ? '📄 Upload HTML' : '📄 Upload HTML file'} />
            <AssetButton textareaRef={textareaRef} value={form.content} onChange={setContent} format={formatAssetHtml} label={isMobile ? '📎 Insert image' : '📎 Insert image / file'} />
            {/* The explanation is worth a line on a desktop toolbar and worth a
                row of a phone screen — which it is not. */}
            {!isMobile && <span style={{ fontSize:11, color:'var(--text-2)', marginLeft:6 }}>Uploads to secure cloud storage and inserts an &lt;img&gt;/&lt;a&gt; tag at the cursor</span>}
          </div>
        )}
        {(isMarkdown || isHtml) && tab === 'edit' && (
          <AttachmentsBar content={debouncedContent} onChange={setContent} />
        )}


        {/* Edit / Preview / History tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:`0 ${isMobile?'14px':'20px'}`, flexShrink:0 }}>
          {(isDatabase ? ['edit'] : isSpreadsheet || isArtifact ? ['edit','history'] : ['edit','preview','history']).map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="app-press"
              style={{ padding:'8px 14px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:tab===t?'var(--accent)':'var(--text-2)', borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent', textTransform:'capitalize', marginBottom:-1 }}>
              {t === 'history' ? '🕐 History' : t}
            </button>
          ))}
          {isMarkdown && tab !== 'history' && (
            <button onClick={convertToBlocks} disabled={converting} title="Turn this Markdown page into a block document. The current version is kept in History."
              style={{ marginLeft:'auto', alignSelf:'center', ...btnGhost, fontSize:11, padding:'4px 8px', display:'inline-flex', alignItems:'center', gap:5, color:'var(--accent)' }}>
              <Blocks size={13} /> {converting ? 'Converting…' : 'Convert to blocks'}
            </button>
          )}
          {!showTemplates && tab !== 'history' && !isArtifact && !isDatabase && (
            <button onClick={()=>setShowTemplates(true)} style={{ marginLeft:isMarkdown?0:'auto', alignSelf:'center', ...btnGhost, fontSize:11, padding:'4px 8px' }}>Use template</button>
          )}
        </div>

        {/* Editor-type banner. Desktop only: it is pure explanation, and the
            document type it names is one tap away under Settings on a phone,
            where the same two sentences cost a visible slice of the editor. */}
        {!isMobile && tab !== 'history' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 16px', fontSize:12, color:'var(--text-2)', background:'var(--bg-base)', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
            <span style={{ fontWeight:700, color:'var(--text-1)' }}>
              {isDatabase ? '🗃️ Database' : isSpreadsheet ? '📊 Spreadsheet' : isHtml ? '🌐 Web Page (HTML)' : isArtifact ? '🧩 Artifact' : isDoc ? '📝 Document' : isMarkdown ? '#️⃣ Markdown (classic)' : '📄 Plain Text'}
            </span>
            <span>
              {isDatabase ? 'Every row is a page. Click a cell to edit it, Open to write in the row. Views, filters and sorts save as you go.'
                : isSpreadsheet ? 'Type to fill a cell, = for a formula such as =SUM(B2:B9). Right-click a cell for rows, columns and sorting.'
                : isHtml ? 'Write raw HTML/CSS/JS — renders as a full web page'
                : isArtifact ? 'A working mini-app in one HTML file — runs sandboxed, shared like a web page'
                : isDoc ? 'Type / for blocks, select text to format, drag ⋮⋮ to reorder. Markdown shortcuts work: #, -, 1., [ ], >, ```'
                : isMarkdown ? 'Rich document — use the toolbar for headings, bold, tables, images'
                : 'Plain text / code'}
            </span>
          </div>
        )}

        {/* Content area */}
        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {rowPanel && tab === 'edit' && !isDoc && <div style={{ padding:isMobile?'8px 14px 0':'10px 20px 0', flexShrink:0, maxHeight:'40%', overflowY:'auto' }}>{rowPanel}</div>}
          {tab === 'history' ? (
            <VersionHistoryPanel
              pageId={currentId}
              currentContent={form.content}
              currentContentType={form.content_type}
              onRestore={(restoredPage, versionSheet) => {
                const restoredCsv = (restoredPage.content_type || form.content_type) === 'csv'
                setForm(f => ({
                  ...f,
                  title:        restoredPage.title || f.title,
                  content:      restoredPage.content ?? f.content,
                  content_type: restoredPage.content_type || f.content_type,
                  ...(restoredCsv ? { sheet: versionSheet } : {}),
                }))
                // The server still holds the current formatting; comparing with
                // it makes the next auto-save write the version's.
                savedSnapRef.current = snapOf({ ...form, title:restoredPage.title||'', content_type:restoredPage.content_type||'markdown', content:restoredPage.content||'', slug:restoredPage.slug||form.slug||'', sheet:restoredPage.metadata?.sheet, full_width:restoredPage.metadata?.full_width })
                setTab('edit')
                onSaved(restoredPage)
              }}
            />
          ) : isDatabase ? (
            <div style={{ flex:1, overflow:'auto', padding:isMobile?'8px 12px':'8px 20px' }}>
              {currentId ? (
                <Suspense fallback={<div style={{ color:'var(--text-3)', fontSize:14, padding:20 }}>Loading database…</div>}>
                  <DatabaseView pageId={currentId} isMobile={isMobile} onOpenRow={row=>{ flushAndClose(); onOpenPage?.(row) }} />
                </Suspense>
              ) : <div style={{ color:'var(--text-2)', fontSize:13, padding:20 }}>Create databases with the New database button.</div>}
            </div>
          ) : isArtifact ? (
            <ArtifactStudio
              content={form.content}
              onChange={setContent}
              onTitle={t=>setForm(f => f.title.trim() ? f : { ...f, title:t })}
              pageId={currentId}
              canUseAi={hasPerm('module.ai.use')}
              isMobile={isMobile}
            />
          ) : isSpreadsheet ? (
            <SheetEditor value={form.content} onChange={setContent} meta={form.sheet} onMetaChange={setSheet}
              fileName={form.title || form.slug} />
          ) : isDoc && tab === 'edit' ? (
            <DocCanvas form={form} set={set} setContent={setContent} isMobile={isMobile} stats={stats} belowTitle={rowPanel}
              pageId={page?.id && page.content == null ? null : currentId} onLiveMode={onLiveMode} isContentSaved={isContentSaved} />
          ) : tab === 'edit' ? (
            <textarea
              ref={textareaRef}
              style={{ flex:1, width:'100%', padding:isMobile?'14px':'20px 24px', fontFamily:isMarkdown?'-apple-system,sans-serif':'ui-monospace,monospace', fontSize:isMarkdown?15:13, lineHeight:isMarkdown?1.8:1.65, background:'var(--bg-base)', color:'var(--text-1)', border:'none', outline:'none', resize:'none', boxSizing:'border-box', overflowY:'auto' }}
              placeholder={placeholders[form.content_type]}
              value={form.content}
              onChange={e=>setContent(e.target.value)}
              spellCheck={isMarkdown}
            />
          ) : (
            <div style={{ flex:1, overflow:'auto', background:isDoc ? 'var(--card-bg)' : '#fff', borderTop:'1px solid var(--border)' }}>
              <ContentPreview contentType={form.content_type} content={form.content} />
            </div>
          )}
        </div>
        {currentId && tab !== 'history' && !isDatabase && <SubPagesList pageId={currentId} onOpen={p=>{ flushAndClose(); onOpenPage?.(p) }} onAdd={onCreateChild && (id=>{ flushAndClose(); onCreateChild(id) })} />}
        </>)}
      </div>
    </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <Overlay>
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onCancel}>
      <div style={{ background:'var(--bg-base)', borderRadius:'10px', padding:28, maxWidth:380, width:'100%', boxShadow:'var(--shadow-popover)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>Confirm</div>
        <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:22 }}>{message}</div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnPrimary, background:'var(--danger-btn)', color:'var(--danger-fg)' }}>Delete</button>
        </div>
      </div>
    </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------
// Page Card (mobile)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Desktop table row
// ---------------------------------------------------------------------------
const UNFILED = '\u0000unfiled'

// Small labels under a page's title: its folder, when its link expires, and
// whether its code is protected.
function PageTags({ page, onFolder }) {
  const folder = page.metadata?.folder
  const protect = page.metadata?.protect_source
  const exp = page.expires_at
  if (!folder && !protect && !exp) return null
  const expired = exp && msUntil(exp) <= 0
  const tag = { display:'inline-flex', alignItems:'center', gap:3, fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-base)', color:'var(--text-2)', whiteSpace:'nowrap' }
  return (
    <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center', marginTop:3 }}>
      {folder && (
        <button type="button" onClick={()=>onFolder?.(folder)} title="Show this folder" style={{ ...tag, cursor:'pointer' }}>
          <Folder size={10} /> {folder}
        </button>
      )}
      {/* An expired link is already flagged by the status pill. */}
      {exp && !expired && (
        <span style={tag} title={`Link expires ${formatIst(exp)}`}>
          <Timer size={10} /> {countdown(exp)}
        </span>
      )}
      {protect && <span style={tag} title="Code protection is on"><ShieldCheck size={10} /> Protected</span>}
    </div>
  )
}

// Move a page into a folder (or out of one) without opening the editor.
function FolderModal({ page, folders, onClose, onSave }) {
  const [value, setValue] = useState(page?.metadata?.folder || '')
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e?.preventDefault()
    setSaving(true)
    try { await onSave(page, value.trim().slice(0, 80)) } finally { setSaving(false) }
  }
  return (
    <Modal open={!!page} onClose={onClose} title="Move to folder" subtitle={page?.title} width={400}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <form onSubmit={submit}>
        <label style={labelStyle} htmlFor="ft-move-folder">Folder name</label>
        <input id="ft-move-folder" autoFocus list="ft-move-folders" style={inputStyle} value={value}
          placeholder="Leave empty for no folder" onChange={e=>setValue(e.target.value)} />
        <datalist id="ft-move-folders">{folders.map(f=><option key={f} value={f} />)}</datalist>
        {folders.length > 0 && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:10 }}>
            {folders.map(f=>(
              <button key={f} type="button" onClick={()=>setValue(f)}
                style={{ ...btnTiny, display:'inline-flex', alignItems:'center', gap:4, borderColor:value===f?'var(--accent)':'var(--border)' }}>
                <Folder size={11} /> {f}
              </button>
            ))}
          </div>
        )}
      </form>
    </Modal>
  )
}

// "just now", "12m ago", "3h ago", "yesterday", "5d ago", then a date.
function relTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
}

// The less frequent actions for a page, behind one "⋯" button so each row
// carries three clear actions instead of seven. Rendered into <body> so a row
// near the bottom of a scrolling table never clips it.
function RowMenu({ page, onPublish, onShare, onAnalytics, onDelete, onClone, onMove, cloning }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const w = 210, h = 290
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4
    setPos({ left, top })
  }
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    setTimeout(() => menuRef.current?.querySelector('button')?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  const run = (fn) => () => { setOpen(false); fn(page) }
  const item = (Icon, label, onClick, opts = {}) => (
    <button type="button" role="menuitem" onClick={onClick} disabled={opts.disabled}
      style={{ display:'flex', alignItems:'center', gap:10, width:'100%', minHeight:36, padding:'8px 12px', border:'none', background:'transparent', textAlign:'left', fontSize:13, fontWeight:500, cursor:'pointer', borderRadius:7, color:opts.danger?'var(--fin-negative)':'var(--text-1)' }}
      onMouseEnter={e=>e.currentTarget.style.background=opts.danger?'var(--fin-neg-bg)':'var(--bg-base)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <Icon size={14} strokeWidth={1.9} style={{ flexShrink:0, opacity:0.8 }} /> {label}
    </button>
  )
  return (
    <>
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${page.title || 'page'}`} title="More actions"
        onClick={()=>{ if (!open) place(); setOpen(o=>!o) }}
        style={{ ...btnTiny, padding:'6px 8px', borderRadius:8, color:'var(--text-2)', display:'inline-flex', alignItems:'center', background:open?'var(--bg-base)':'var(--card-bg)' }}>
        <MoreHorizontal size={15} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu" aria-label="Page actions" className="app-menu app-pop"
          style={{ position:'fixed', left:pos.left, top:pos.top, width:210, zIndex:3000, border:'1px solid var(--border)', borderRadius:12, boxShadow:'0 12px 32px rgba(0,0,0,0.16)', padding:5 }}>
          {item(page.is_published ? EyeOff : Globe, page.is_published ? 'Unpublish' : 'Publish', run(onPublish))}
          {page.is_published && item(Share2, 'Share…', run(onShare))}
          {item(BarChart2, 'Views & analytics', run(onAnalytics))}
          {item(Copy, cloning===page.id ? 'Duplicating…' : 'Duplicate as draft', run(onClone), { disabled: cloning===page.id })}
          {item(FolderInput, 'Move to folder…', run(onMove))}
          <div style={{ height:1, background:'var(--border)', margin:'4px 6px' }} />
          {item(Trash2, 'Delete', run(onDelete), { danger:true })}
        </div>,
        document.body,
      )}
    </>
  )
}

function CopyLinkButton({ page, onCopied, compact }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    const url = `${window.location.origin}/p/${page.slug}`
    const ok = () => { setDone(true); onCopied?.(); setTimeout(()=>setDone(false), 1500) }
    navigator.clipboard?.writeText(url).then(ok).catch(()=>{})
  }
  return (
    <button type="button" onClick={copy} disabled={!page.is_published}
      title={page.is_published ? 'Copy public link' : 'Publish the page to get a link'}
      style={{ ...btnTiny, padding:compact?'7px 9px':'6px 10px', borderRadius:8, display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:done?'var(--fin-positive)':'var(--text-1)', opacity:page.is_published?1:0.45, cursor:page.is_published?'pointer':'not-allowed' }}>
      {done ? <Check size={13} /> : <Link2 size={13} />}{!compact && (done ? 'Copied' : 'Copy link')}
    </button>
  )
}

function StatusPill({ page }) {
  const expired = page.expires_at && msUntil(page.expires_at) <= 0
  const s = expired ? { label:'Expired', bg:'var(--fin-neg-bg)', fg:'var(--fin-negative)', dot:'var(--fin-negative)' }
    : page.is_published ? { label:'Live', bg:'var(--fin-pos-bg)', fg:'var(--fin-positive)', dot:'var(--fin-positive)' }
    : { label:'Draft', bg:'var(--bg-base)', fg:'var(--text-2)', dot:'var(--text-3)' }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:999, fontSize:12, fontWeight:600, background:s.bg, color:s.fg, whiteSpace:'nowrap' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot }} />{s.label}
    </span>
  )
}

function PageRow({ page, idx, total, onEdit, onPublish, onShare, onAnalytics, onDelete, onClone, onMove, onFolder, onCopied, openingId, cloning }) {
  const [hover, setHover] = useState(false)
  const cell = { padding:'14px 16px', verticalAlign:'middle' }
  return (
    <tr
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{ borderBottom:idx<total-1?'1px solid var(--border)':'none', background:hover?'var(--bg-base)':'transparent', transition:'background 0.12s' }}
    >
      <td style={{ ...cell, maxWidth:0, width:'46%' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
          <div title={page.content_type} style={{ width:36, height:36, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--text-2)' }}>
            <TypeIcon type={page.content_type} size={15} />
          </div>
          <div style={{ minWidth:0 }}>
            <button type="button" onClick={()=>onEdit(page)} title="Edit page"
              style={{ all:'unset', cursor:'pointer', fontWeight:650, color:'var(--text-1)', fontSize:14, display:'flex', alignItems:'center', gap:6, maxWidth:'100%' }}>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{page.title||<span style={{ color:'var(--text-2)', fontStyle:'italic' }}>Untitled</span>}</span>
              {page.is_password_protected && <Lock size={12} style={{ color:'var(--text-3)', flexShrink:0 }} aria-label="Password protected" />}
            </button>
            <div style={{ fontSize:12, color:'var(--text-3)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>/p/{page.slug}</div>
            <PageTags page={page} onFolder={onFolder} />
          </div>
        </div>
      </td>
      <td style={cell}><StatusPill page={page} /></td>
      <td style={cell}>
        <button type="button" onClick={()=>onAnalytics(page)} title="Views & analytics"
          style={{ display:'inline-flex', alignItems:'center', gap:5, background:'transparent', border:'1px solid transparent', borderRadius:7, padding:'4px 8px', cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--text-1)', ...(hover?{border:'1px solid var(--border)', background:'var(--card-bg)'}:{}) }}>
          <Eye size={13} strokeWidth={2} style={{ color:'var(--text-3)' }} /> {(page.view_count??0).toLocaleString('en-IN')}
        </button>
      </td>
      <td style={{ ...cell, whiteSpace:'nowrap', color:'var(--text-2)', fontSize:12.5 }} title={page.updated_at ? new Date(page.updated_at).toLocaleString('en-IN') : ''}>
        {relTime(page.updated_at || page.created_at)}
      </td>
      <td style={{ ...cell, whiteSpace:'nowrap', textAlign:'right' }}>
        <div style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
          <button style={{ ...btnTiny, background:'var(--accent-btn)', color:'var(--accent-fg)', border:'none', padding:'6px 14px', borderRadius:8, fontWeight:600, fontSize:12, display:'inline-flex', alignItems:'center', gap:5 }} onClick={()=>onEdit(page)} disabled={openingId===page.id}>
            <PenLine size={12} /> {openingId===page.id ? 'Opening…' : 'Edit'}
          </button>
          <CopyLinkButton page={page} onCopied={onCopied} />
          <a href={page.is_published ? `/p/${page.slug}` : undefined} target="_blank" rel="noopener noreferrer" aria-label="Open live page" title={page.is_published ? 'Open live page' : 'Not published yet'}
            style={{ ...btnTiny, padding:'6px 8px', borderRadius:8, display:'inline-flex', alignItems:'center', color:'var(--text-2)', opacity:page.is_published?1:0.45, pointerEvents:page.is_published?'auto':'none' }}>
            <ExternalLink size={14} />
          </a>
          <RowMenu page={page} onPublish={onPublish} onShare={onShare} onAnalytics={onAnalytics} onDelete={onDelete} onClone={onClone} onMove={onMove} cloning={cloning} />
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Mobile card
// ---------------------------------------------------------------------------
function PageCard({ page, onEdit, onPublish, onShare, onAnalytics, onDelete, onClone, onMove, onFolder, onCopied, cloning }) {
  return (
    <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:14, padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <div style={{ width:36, height:36, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--text-2)' }}>
          <TypeIcon type={page.content_type} size={15} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <button type="button" onClick={()=>onEdit(page)} style={{ all:'unset', cursor:'pointer', fontWeight:650, fontSize:15, color:'var(--text-1)', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
            {page.title||'Untitled'}{page.is_password_protected && <Lock size={11} style={{ marginLeft:5, color:'var(--text-3)' }} />}
          </button>
          <div style={{ fontSize:11.5, color:'var(--text-3)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>/p/{page.slug}</div>
          <PageTags page={page} onFolder={onFolder} />
        </div>
        <RowMenu page={page} onPublish={onPublish} onShare={onShare} onAnalytics={onAnalytics} onDelete={onDelete} onClone={onClone} onMove={onMove} cloning={cloning} />
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:12, color:'var(--text-2)' }}>
        <StatusPill page={page} />
        <button type="button" onClick={()=>onAnalytics(page)} style={{ all:'unset', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4 }}>
          <Eye size={12} /> {(page.view_count??0).toLocaleString('en-IN')}
        </button>
        <span style={{ marginLeft:'auto' }}>Edited {relTime(page.updated_at || page.created_at)}</span>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <button style={{ ...btnPrimary, flex:1, padding:'9px 10px', fontSize:13, borderRadius:9 }} onClick={()=>onEdit(page)}>Edit</button>
        <CopyLinkButton page={page} onCopied={onCopied} />
        <a href={page.is_published ? `/p/${page.slug}` : undefined} target="_blank" rel="noopener noreferrer" aria-label="Open live page"
          style={{ ...btnTiny, padding:'9px 11px', borderRadius:9, display:'inline-flex', alignItems:'center', color:'var(--text-2)', opacity:page.is_published?1:0.45, pointerEvents:page.is_published?'auto':'none' }}>
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main PagesManager
// ---------------------------------------------------------------------------
export default function PagesManager() {
  const isMobile = useIsMobile()
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawerPage, setDrawerPage] = useState(null)
  const [newDbOpen, setNewDbOpen] = useState(false)
  const [analyticsPage, setAnalyticsPage] = useState(null)
  const [sharePage, setSharePage] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [toast, setToast] = useState({ msg:'', ok:true })
  const [search, setSearch] = useState('')
  const [filterTab, setFilterTab] = useState('all')
  // '' = every folder, UNFILED = pages with no folder, otherwise a folder name.
  const [folderFilter, setFolderFilter] = useState('')
  const [movePage, setMovePage] = useState(null)
  const [sortBy, setSortBy] = useState(() => { try { return localStorage.getItem('pages_sort') || 'updated' } catch { return 'updated' } })
  useEffect(() => { try { localStorage.setItem('pages_sort', sortBy) } catch {} }, [sortBy])
  const searchRef = useRef(null)
  // "/" jumps to search, as on most list screens.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault(); searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const [cloning, setCloning] = useState(null)

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast({msg:'',ok:true}),3500) }

  // Track IDs the user explicitly deleted so background refreshes can't restore them.
  const deletedIdsRef = useRef(new Set())

  const loadPages = useCallback(async (silent=false, forceFresh=false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      // Only bypass cache on explicit user actions (initial load / manual refresh).
      // Background polls skip fresh:true to avoid hammering the server.
      const data = await api.pages.list(forceFresh ? { fresh:true } : {})
      if (data?.detail) throw new Error(data.detail)
      const list = Array.isArray(data) ? data : []
      // Filter out pages the user already deleted (prevent respawn from background polls)
      setPages(list.filter(p => !deletedIdsRef.current.has(p.id)))
    } catch (e) { if (!silent) setError(e?.message||'Failed to load') }
    finally { if (!silent) setLoading(false) }
  }, [])

  // Initial load + keep the list live without manual refresh.
  useEffect(()=>{
    loadPages(false, true)  // initial: force fresh
    const onFocus = () => loadPages(true, false)  // focus: silent, no fresh
    window.addEventListener('focus', onFocus)
    const iv = setInterval(() => loadPages(true, false), 60000)  // poll every 60s, no fresh
    return () => { window.removeEventListener('focus', onFocus); clearInterval(iv) }
  }, [loadPages])

  const handleSaved = (saved) => {
    setPages(prev=>{ const idx=prev.findIndex(p=>p.id===saved.id); if(idx>=0){const n=[...prev];n[idx]=saved;return n} return [saved,...prev] })
    setDrawerPage(null); showToast('Page saved')
  }

  const handlePublishToggle = async (page) => {
    try {
      const updated = await api.pages.publish(page.id, !page.is_published)
      if (updated?.detail) throw new Error(updated.detail)
      setPages(prev=>prev.map(p=>p.id===updated.id?updated:p))
      showToast(updated.is_published?'✓ Published — link is now live':'Unpublished')
    } catch (e) { showToast(e?.message||'Failed',false) }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    const id = confirmDelete.id
    setConfirmDelete(null)  // close dialog immediately to prevent double-click
    // Optimistically remove from UI and mark as deleted so background polls don't restore it
    setPages(prev => prev.filter(p => p.id !== id))
    deletedIdsRef.current.add(id)
    try {
      await api.pages.delete(id)
      showToast('Deleted')
      // Clean up tombstone after 60s — server is authoritative by then
      setTimeout(() => deletedIdsRef.current.delete(id), 60_000)
    } catch (e) {
      // Restore the page if delete failed
      deletedIdsRef.current.delete(id)
      showToast(e?.message || 'Delete failed', false)
      loadPages(true)  // re-sync from server
    }
  }

  const handleClone = async (page) => {
    setCloning(page.id)
    try {
      const full = await api.pages.get(page.id)
      // A new, unpublished page: the live one is not touched. It keeps the
      // folder, description and protection setting, but not the expiry, since
      // a copy is usually made to send to someone new.
      const created = await api.pages.create({
        title:`${full.title} (Copy)`, content_type:full.content_type, content:full.content,
        slug:slugify(`${full.title}-copy-${Date.now().toString(36)}`), metadata:full.metadata||{},
      })
      if (created?.detail||created?.error) throw new Error(created.detail||created.error)
      setPages(prev=>[created,...prev])
      setDrawerPage(created)
      showToast('Duplicated as a draft. The original is unchanged.')
    } catch (e) { showToast(e?.message||'Clone failed',false) }
    finally { setCloning(null) }
  }

  const handleMove = async (page, folder) => {
    try {
      const updated = await api.pages.update(page.id, { metadata:{ ...(page.metadata||{}), folder: folder || undefined } })
      if (updated?.detail||updated?.error) throw new Error(updated.detail||updated.error)
      setPages(prev=>prev.map(p=>p.id===updated.id?{ ...p, ...updated }:p))
      setMovePage(null)
      showToast(folder ? `Moved to ${folder}` : 'Removed from folder')
    } catch (e) { showToast(e?.message||'Move failed', false) }
  }

  const [openingId, setOpeningId] = useState(null)
  const openEdit = async (page) => {
    // Fetch the FULL record (list rows have no `content`) BEFORE opening, so the
    // drawer is populated from the start — no empty-then-fill race that could
    // clobber edits or show a blank editor.
    setOpeningId(page.id)
    try {
      const full = await api.pages.get(page.id)
      setDrawerPage(full && full.id ? full : page)
    } catch {
      setDrawerPage(page)
    } finally {
      setOpeningId(null)
    }
  }

  // /pages?page=<id>&comments=1&thread=<id> (from a notification): open that
  // page, with its comments panel on the thread.
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const id = q.get('page')
    if (!id) return
    if (q.get('comments')) openCommentsPanel(id, q.get('thread'))
    if (drawerPage?.id !== id) openEdit({ id })
    navigate('/pages', { replace:true })
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  const folderCounts = useMemo(() => {
    const m = new Map()
    for (const p of pages) { const f = p.metadata?.folder; if (f) m.set(f, (m.get(f)||0)+1) }
    return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
  }, [pages])
  const folders = useMemo(() => folderCounts.map(([f])=>f), [folderCounts])
  const unfiledCount = pages.filter(p=>!p.metadata?.folder).length

  const filtered = pages.filter(p=>{
    if (p.metadata?.db_row) return false
    const expired = p.expires_at && msUntil(p.expires_at) <= 0
    const matchTab=filterTab==='all'||(filterTab==='published'&&p.is_published)||(filterTab==='drafts'&&!p.is_published)||(filterTab==='expired'&&expired)
    const f = p.metadata?.folder || ''
    const matchFolder = !folderFilter || (folderFilter===UNFILED ? !f : f===folderFilter)
    const q=search.trim().toLowerCase()
    const hay = [p.title, p.slug, p.metadata?.description, f].filter(Boolean).join(' ').toLowerCase()
    return matchTab&&matchFolder&&(!q||q.split(/\s+/).every(w=>hay.includes(w)))
  })
  const ts = (v) => (v ? new Date(v).getTime() : 0) || 0
  const SORTS = {
    updated: (a,b) => ts(b.updated_at||b.created_at) - ts(a.updated_at||a.created_at),
    created: (a,b) => ts(b.created_at) - ts(a.created_at),
    views:   (a,b) => (b.view_count||0) - (a.view_count||0),
    title:   (a,b) => (a.title||'').localeCompare(b.title||'', 'en', { sensitivity:'base', numeric:true }),
  }
  filtered.sort(SORTS[sortBy] || SORTS.updated)
  const anyFilter = search || filterTab!=='all' || folderFilter
  const clearFilters = () => { setSearch(''); setFilterTab('all'); setFolderFilter('') }

  const totalViews = pages.reduce((s,p)=>s+(p.view_count||0),0)

  // Sub-pages, from the tree panel or the editor: made on the server under
  // their parent, then opened like any new page.
  const handleCreateChild = async (parentId) => {
    try {
      const created = await api.pageTree.createChild(parentId, { title:'Untitled' })
      handleTreeCreated(created)
    } catch (e) { showToast(e?.message||'Could not add a sub-page', false) }
  }
  const handleTreeCreated = (created) => {
    if (!created?.id) return
    setPages(prev=>[created, ...prev.filter(p=>p.id!==created.id)])
    setDrawerPage(created)
  }

  return (
    <PageTreeShell isMobile={isMobile} refreshKey={pages} currentId={drawerPage?.id}
      onOpen={openEdit} onNewPage={()=>setDrawerPage({content_type:'markdown'})}
      onCreated={handleTreeCreated} onChanged={()=>loadPages(true, true)} onToast={showToast}>
    <div style={{ padding:isMobile?'16px':'28px 32px', maxWidth:1480, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, gap:12, flexWrap:'wrap' }}>
        <div>
          <h1 style={{ margin:0, fontSize:isMobile?20:26, fontWeight:800, color:'var(--text-1)', letterSpacing:'-0.02em' }}>Pages</h1>
          {!isMobile&&<p style={{ margin:'5px 0 0', fontSize:13, color:'var(--text-2)', lineHeight:1.5 }}>Create docs, spreadsheets & web pages — share publicly with full analytics on every view.</p>}
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={{ ...btnSecondary, padding:'9px 14px', borderRadius:10, fontSize:13, display:'flex', alignItems:'center', gap:6 }} onClick={()=>setDrawerPage({content_type:'artifact'})}>
            <Puzzle size={15} strokeWidth={2} /> New artifact
          </button>
          <button style={{ ...btnSecondary, padding:'9px 14px', borderRadius:10, fontSize:13, display:'flex', alignItems:'center', gap:6 }} onClick={()=>setNewDbOpen(true)}>
            <Database size={15} strokeWidth={2} /> New database
          </button>
          <button style={{ ...btnPrimary, padding:'9px 18px', borderRadius:10, fontSize:13, display:'flex', alignItems:'center', gap:6 }} onClick={()=>setDrawerPage({content_type:'doc'})}>
            <Plus size={15} strokeWidth={2.5} /> New Page
          </button>
        </div>
      </div>

      {/* Stats */}
      {pages.length>0&&(
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${isMobile?2:4},1fr)`, gap:10, marginBottom:22 }}>
          {[
            { label:'Total Pages', value:pages.length, Icon:Layers, accent:'var(--accent)' },
            { label:'Live', value:pages.filter(p=>p.is_published).length, Icon:CheckCircle2, accent:'var(--fin-positive)' },
            { label:'Drafts', value:pages.filter(p=>!p.is_published).length, Icon:PenLine, accent:'var(--fin-warning)' },
            { label:'Total Views', value:totalViews.toLocaleString(), Icon:BarChart2, accent:'var(--accent)' },
          ].map(({ label, value, Icon, accent })=>(
            <div key={label} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:isMobile?'12px 14px':'14px 18px', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:34, height:34, borderRadius:9, background:`${tint(accent, 0.08)}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:accent }}>
                <Icon size={16} strokeWidth={2} />
              </div>
              <div>
                <div style={{ fontSize:isMobile?18:20, fontWeight:700, color:'var(--text-1)', lineHeight:1 }}>{value}</div>
                <div style={{ fontSize:10, color:'var(--text-3)', marginTop:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter */}
      {pages.length>0&&(
        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ position:'relative', flex:isMobile?'1 1 100%':'0 0 auto' }}>
            <Search size={13} strokeWidth={2} style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color:'var(--text-3)' }} />
            <input ref={searchRef} aria-label="Search pages" style={{ ...inputStyle, width:isMobile?'100%':300, padding:'8px 30px 8px 32px', borderRadius:10, fontSize:13 }} placeholder="Search title, link, folder…" value={search} onChange={e=>setSearch(e.target.value)} />
            {!isMobile && !search && <kbd style={{ position:'absolute', right:9, top:'50%', transform:'translateY(-50%)', fontSize:10, color:'var(--text-3)', border:'1px solid var(--border)', borderRadius:4, padding:'0 5px', fontFamily:'inherit', pointerEvents:'none' }}>/</kbd>}
          </div>
          <div style={{ display:'flex', gap:2, background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:3 }}>
            {[['all','All'],['published','Live'],['drafts','Drafts'],['expired','Expired']].map(([val,label])=>(
              <button key={val} onClick={()=>setFilterTab(val)} style={{ padding:'6px 14px', borderRadius:8, border:'none', fontSize:12, fontWeight:600, cursor:'pointer', transition:'all 0.15s', background:filterTab===val?'var(--accent-btn)':'transparent', color:filterTab===val?'var(--accent-fg)':'var(--text-2)' }}>{label}</button>
            ))}
          </div>
          <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginLeft:isMobile?0:'auto', fontSize:12, color:'var(--text-2)' }}>
            <ArrowUpDown size={13} />
            <span className="sr-only">Sort by</span>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} aria-label="Sort pages"
              style={{ ...inputStyle, width:'auto', padding:'7px 10px', borderRadius:10, fontSize:12.5 }}>
              <option value="updated">Recently edited</option>
              <option value="created">Newest first</option>
              <option value="views">Most viewed</option>
              <option value="title">Name A–Z</option>
            </select>
          </label>
          {anyFilter&&<button onClick={clearFilters} style={{ ...btnGhost, fontSize:12, padding:'6px 12px', borderRadius:8, display:'inline-flex', alignItems:'center', gap:4 }}><X size={12} /> Clear</button>}
        </div>
      )}

      {/* Folders */}
      {folders.length>0&&(
        <div role="group" aria-label="Folders" style={{ display:'flex', gap:6, marginBottom:16, overflowX:'auto', paddingBottom:2 }}>
          {[['', 'All folders', pages.length], ...folderCounts.map(([f,n])=>[f,f,n]), [UNFILED, 'No folder', unfiledCount]].map(([val,label,n])=>{
            const on = folderFilter===val
            return (
              <button key={val||'__all'} onClick={()=>setFolderFilter(val)} aria-pressed={on}
                style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:999, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', border:`1px solid ${on?'var(--accent)':'var(--border)'}`, background:on?'var(--accent-btn)':'var(--card-bg)', color:on?'var(--accent-fg)':'var(--text-2)' }}>
                {val!=='' && val!==UNFILED && <Folder size={12} />}{label} <span style={{ opacity:0.7 }}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {error&&<div style={{ background:'var(--fin-neg-bg)', border:'1px solid var(--fin-neg-border)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--fin-negative)', marginBottom:16 }}>{error}</div>}

      {loading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {Array.from({length:3}).map((_,i)=>(
            <div key={i} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 18px', display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ width:34, height:34, borderRadius:8, background:'var(--border)', flexShrink:0, opacity:0.5 }} />
              <div style={{ flex:1 }}>
                <div style={{ height:12, background:'var(--border)', borderRadius:5, width:`${38+i*10}%`, marginBottom:8, opacity:0.5 }} />
                <div style={{ height:9, background:'var(--border)', borderRadius:5, width:'24%', opacity:0.35 }} />
              </div>
              <div style={{ height:26, width:110, background:'var(--border)', borderRadius:7, opacity:0.4 }} />
            </div>
          ))}
        </div>
      ) : !pages.length ? (
        <div style={{ textAlign:'center', padding:'60px 24px', border:'1px dashed var(--border)', borderRadius:16, color:'var(--text-2)' }}>
          <div style={{ width:48, height:48, borderRadius:12, background:'var(--card-bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', color:'var(--text-3)' }}>
            <FileText size={22} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize:15, fontWeight:600, marginBottom:6, color:'var(--text-1)' }}>No pages yet</div>
          <div style={{ fontSize:13, marginBottom:20, lineHeight:1.6, maxWidth:360, margin:'0 auto 20px', color:'var(--text-2)' }}>Create documents, spreadsheets, or full web pages — share with anyone via a public link.</div>
          <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
            {[{Icon:FileText,label:'Document',type:'doc'},{Icon:Table2,label:'Spreadsheet',type:'csv'},{Icon:Globe,label:'Web Page',type:'html'},{Icon:Puzzle,label:'Artifact',type:'artifact'}].map(b=>(
              <button key={b.label} onClick={()=>setDrawerPage({content_type:b.type})} style={{ ...btnSecondary, fontSize:12, borderRadius:8, padding:'8px 14px', display:'inline-flex', alignItems:'center', gap:6 }}>
                <b.Icon size={13} strokeWidth={1.75} /> {b.label}
              </button>
            ))}
          </div>
        </div>
      ) : !filtered.length ? (
        <div style={{ textAlign:'center', padding:'48px 24px', color:'var(--text-2)' }}>
          <div style={{ width:40, height:40, borderRadius:10, background:'var(--card-bg)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px', color:'var(--text-3)' }}>
            <Search size={18} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4, color:'var(--text-1)' }}>No pages match your search</div>
          <div style={{ fontSize:13, marginBottom:16 }}>Try different keywords or clear the filters.</div>
          <button onClick={clearFilters} style={{ ...btnSecondary, fontSize:12, borderRadius:8, display:'inline-flex', alignItems:'center', gap:5 }}><X size={12} /> Clear filters</button>
        </div>
      ) : isMobile ? (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(page=><PageCard key={page.id} page={page} onEdit={openEdit} onPublish={handlePublishToggle} onShare={setSharePage} onAnalytics={setAnalyticsPage} onDelete={setConfirmDelete} onClone={handleClone} onMove={setMovePage} onFolder={setFolderFilter} onCopied={()=>showToast('Link copied')} cloning={cloning} />)}
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 8px rgba(0,0,0,0.06)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--card-bg)', borderBottom:'1px solid var(--border)' }}>
                {[['Page'],['Status'],['Views'],['Last edited'],['Actions','right']].map(([h,align])=>(
                  <th key={h} style={{ padding:'11px 16px', textAlign:align||'left', fontWeight:700, color:'var(--text-2)', whiteSpace:'nowrap', fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                    {h==='Actions' ? <span className="sr-only">Actions</span> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((page,idx)=>(
                <PageRow key={page.id} page={page} idx={idx} total={filtered.length}
                  onEdit={openEdit} onPublish={handlePublishToggle} onShare={setSharePage}
                  onAnalytics={setAnalyticsPage} onDelete={setConfirmDelete}
                  onClone={handleClone} onMove={setMovePage} onFolder={setFolderFilter} onCopied={()=>showToast('Link copied')} openingId={openingId} cloning={cloning} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerPage!==null&&<PageDrawer key={drawerPage?.id||drawerPage?.content_type||'new'} page={drawerPage?.id?drawerPage:null} initialType={drawerPage?.id?undefined:(drawerPage?.content_type||'doc')} onClose={()=>setDrawerPage(null)} onSaved={handleSaved} folders={folders} onOpenPage={openEdit} onCreateChild={handleCreateChild} />}
      <NewDatabaseDialog open={newDbOpen} onClose={()=>setNewDbOpen(false)} onCreated={db=>{ loadPages(true, true); openEdit(db) }} />
      {movePage&&<FolderModal page={movePage} folders={folders} onClose={()=>setMovePage(null)} onSave={handleMove} />}
      {analyticsPage&&<AnalyticsDrawer page={analyticsPage} onClose={()=>setAnalyticsPage(null)} />}
      {sharePage&&<ShareModal page={sharePage} onClose={()=>setSharePage(null)} onCopy={()=>showToast('Link copied!')} />}
      {confirmDelete&&<ConfirmDialog message={`Delete "${confirmDelete.title}"? All view history will be removed. This cannot be undone.`} onConfirm={handleDelete} onCancel={()=>setConfirmDelete(null)} />}

      {toast.msg&&(
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:toast.ok?'var(--tooltip-bg)':'var(--danger-btn)', color:'var(--tooltip-fg)', padding:'11px 20px', borderRadius:'10px', fontSize:13, fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.3)', maxWidth:'calc(100vw - 48px)' }}>
          {toast.msg}
        </div>
      )}
    </div>
    </PageTreeShell>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const inputStyle = { display:'block', width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:'10px', background:'var(--card-bg)', color:'var(--text-1)', fontSize:13, outline:'none', boxSizing:'border-box' }
const labelStyle = { display:'block', fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em' }
const btnBase = { border:'none', borderRadius:'10px', padding:'8px 16px', fontSize:13, fontWeight:600, cursor:'pointer' }
const btnPrimary = { ...btnBase, background:'var(--accent-btn)', color:'var(--accent-fg)' }
const btnSecondary = { ...btnBase, background:'var(--card-bg)', color:'var(--text-1)', border:'1px solid var(--border)' }
const btnGhost = { ...btnBase, background:'transparent', color:'var(--text-2)', padding:'7px 12px' }
const btnTiny = { ...btnBase, padding:'4px 10px', fontSize:12, background:'var(--card-bg)', color:'var(--text-1)', border:'1px solid var(--border)' }
