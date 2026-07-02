import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, API_BASE_URL } from '../services/api'
import { parseLine, csvToGrid, gridToCSV, cellDisplay, FORMULA_FUNCTIONS } from '../utils/sheet'
import { escapeAttr, safeUrl } from '../utils/sanitize'

// Asset URLs from the upload endpoint are backend-relative (/api/...). The
// published viewer lives on a different origin, so embed the ABSOLUTE backend
// URL or images 404 against the frontend domain.
function absUrl(u) {
  if (!u) return u
  if (/^https?:\/\//.test(u)) return u
  return `${API_BASE_URL}${u}`
}

// ---------------------------------------------------------------------------
// Mobile hook
// ---------------------------------------------------------------------------
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return mobile
}

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
function CSVPreview({ text }) {
  if (!text) return <div style={{ color:'var(--text-2)',padding:12,fontSize:13 }}>Empty.</div>
  const lines = text.trim().split('\n').filter(Boolean)
  const grid = csvToGrid(text)
  const headers = parseLine(lines[0])
  const rows = lines.slice(1,11).map(parseLine)
  const show = (v,r,c) => (typeof v==='string'&&v.trim().startsWith('=')) ? cellDisplay(grid,r,c) : v
  return (
    <div style={{ overflowX:'auto', padding:12 }}>
      <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
        <thead><tr>{headers.map((h,i)=><th key={i} style={{ border:'1px solid var(--border)', padding:'6px 10px', background:'var(--bg-card)', textAlign:'left', fontWeight:600 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row,ri)=><tr key={ri} style={{ background:ri%2?'var(--bg-card)':'var(--bg-base)' }}>{row.map((cell,ci)=><td key={ci} style={{ border:'1px solid var(--border)', padding:'5px 10px' }}>{show(cell,ri+1,ci)}</td>)}</tr>)}</tbody>
      </table>
      {lines.length > 11 && <div style={{ fontSize:11, color:'var(--text-2)', marginTop:6 }}>Showing 10 of {lines.length-1} rows</div>}
    </div>
  )
}
function HTMLPreview({ content }) {
  const wrap = (html) => /^\s*<!DOCTYPE/i.test(html)||/^\s*<html/i.test(html) ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#1e293b}</style></head><body>${html}</body></html>`
  // No allow-same-origin: author HTML previews run in an opaque origin and
  // cannot reach the parent's auth token / localStorage even if they contain
  // <script>. (allow-scripts + allow-same-origin together would defeat the sandbox.)
  return <iframe srcDoc={wrap(content)} style={{ width:'100%', height:300, border:'none' }} sandbox="allow-scripts allow-popups allow-forms" title="preview" />
}
function ContentPreview({ contentType, content }) {
  if (!content) return <div style={{ color:'var(--text-2)', fontSize:13, padding:'20px', textAlign:'center' }}>No content yet.</div>
  if (contentType === 'html') return <HTMLPreview content={content} />
  if (contentType === 'csv') return <CSVPreview text={content} />
  if (contentType === 'text') return <pre style={{ margin:0, padding:12, fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.6 }}>{content}</pre>
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
// Badge
// ---------------------------------------------------------------------------
function Badge({ label, color }) {
  const map = {
    published:    { bg:'#d1fae5', text:'#065f46' },
    draft:        { bg:'#f3f4f6', text:'#6b7280' },
    markdown:     { bg:'#ede9fe', text:'#5b21b6' },
    html:         { bg:'#fef3c7', text:'#92400e' },
    csv:          { bg:'#d1fae5', text:'#065f46' },
    spreadsheet:  { bg:'#d1fae5', text:'#065f46' },
    text:         { bg:'#e0f2fe', text:'#0369a1' },
  }
  const c = map[color] || { bg:'var(--bg-card)', text:'var(--text-2)' }
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600, background:c.bg, color:c.text, textTransform:'capitalize' }}>{label}</span>
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
  const esc = v => v==null?'':`"${String(v).replace(/"/g,'""')}"`
  const rows = items.map(v => {
    const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const gps=v.metadata?.gps||{}; const loc=v.metadata?.location||{}
    return [v.viewed_at?new Date(v.viewed_at).toISOString():'',v.viewer_ip,loc.source||(gps.lat?'gps':'ip'),gps.lat,gps.lon,gps.accuracy,gps.city,gps.country,v.country,geo.country_code,geo.region||v.region,v.city,geo.zip,geo.lat,geo.lon,v.isp,geo.org,geo.as,cli.platform,cli.touch_support!=null?(cli.touch_support?'Yes':'No'):'',cli.screen_width?`${cli.screen_width}x${cli.screen_height}`:'',cli.viewport_width?`${cli.viewport_width}x${cli.viewport_height}`:'',cli.pixel_ratio,cli.color_depth,cli.language,cli.timezone||geo.timezone,fmtB(v.user_agent),cli.connection_type,cli.connection_downlink,v.referer,cli.page_url,cli.utm_source,cli.utm_medium,cli.utm_campaign].map(esc).join(',')
  })
  const csv=[headers.join(','),...rows].join('\n')
  const blob=new Blob([csv],{type:'text/csv'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=`analytics-${pageTitle||'page'}-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------
function ViewSparkline({ items }) {
  if (!items?.length) return null
  const now = new Date()
  const days = Array.from({length:14},(_,i)=>{ const d=new Date(now); d.setDate(d.getDate()-(13-i)); return d.toISOString().slice(0,10) })
  const counts = {}; items.forEach(v=>{ const d=v.viewed_at?.slice(0,10); if(d) counts[d]=(counts[d]||0)+1 })
  const vals = days.map(d=>counts[d]||0); const max=Math.max(...vals,1)
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:11, color:'var(--text-2)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Views — last 14 days</div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:40 }}>
        {vals.map((v,i)=>(
          <div key={i} title={`${days[i]}: ${v} view${v!==1?'s':''}`} style={{ flex:1, minWidth:8, borderRadius:3, background:v>0?'var(--accent)':'var(--border)', height:`${Math.max(4,(v/max)*40)}px`, opacity:v>0?0.85:0.3 }} />
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--text-2)', marginTop:3 }}>
        <span>{days[0].slice(5)}</span><span>{days[6].slice(5)}</span><span>{days[13].slice(5)}</span>
      </div>
    </div>
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
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(50)
  const [expandedRow, setExpandedRow] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const fmtBrowser = (ua) => {
    if (!ua) return '—'
    const m=/iPhone|iPad/i.test(ua)?'iPhone/iPad':/Android/i.test(ua)?'Android':''
    const b=/EdgA?\/|Edg\//i.test(ua)?'Edge':/OPR\//i.test(ua)?'Opera':/SamsungBrowser/i.test(ua)?'Samsung':/Chrome/i.test(ua)?'Chrome':/Firefox/i.test(ua)?'Firefox':/Safari/i.test(ua)?'Safari':''
    return [m,b].filter(Boolean).join(' · ')||ua.slice(0,28)
  }
  const fmtRef = (ref) => { if (!ref) return '—'; try { return new URL(ref).hostname } catch { return ref.slice(0,30) } }

  const handleDeleteView = async (e, viewId) => {
    e.stopPropagation()
    if (!window.confirm('Delete this view record?')) return
    setDeletingId(viewId)
    try {
      await api.pages.deleteView(page.id, viewId)
      setData(prev=>({...prev,total:prev.total-1,items:prev.items.filter(v=>v.id!==viewId)}))
      if (expandedRow===viewId) setExpandedRow(null)
    } catch {} finally { setDeletingId(null) }
  }

  useEffect(() => {
    if (!page) return
    setLoading(true)
    api.pages.analytics(page.id, {limit, offset:0})
      .then(d=>setData(d)).catch(()=>setData({items:[],total:0})).finally(()=>setLoading(false))
  }, [page?.id, limit])

  if (!page) return null
  const cols=['Time','IP Address','Location','ISP / Network','Device','Browser','Screen','Timezone','Language','Referer','']

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width:isMobile?'100vw':'96vw', maxWidth:1200, height:'100%', background:'var(--bg-base)', overflowY:'auto', boxShadow:'-4px 0 40px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:isMobile?'16px':'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:isMobile?15:17, fontWeight:700 }}>Viewer Analytics</div>
            <div style={{ fontSize:13, color:'var(--text-2)' }}>{page.title}</div>
            <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug}</a>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            {data?.items?.length>0 && <button onClick={()=>exportAnalyticsCSV(data.items,page.title)} style={{ ...btnSecondary, fontSize:11, padding:'5px 10px' }}>↓ Export CSV</button>}
            <button onClick={onClose} style={{ ...btnGhost, fontSize:18, padding:'4px 10px' }}>✕</button>
          </div>
        </div>
        {data && (
          <div style={{ padding:isMobile?'12px 16px':'14px 24px', borderBottom:'1px solid var(--border)', display:'flex', gap:isMobile?16:28, flexWrap:'wrap', flexShrink:0, background:'var(--bg-card)', overflowX:'auto' }}>
            <Stat label="Total Views" value={data.total} />
            <Stat label="Unique IPs" value={new Set(data.items?.map(v=>v.viewer_ip).filter(Boolean)).size} />
            <Stat label="Countries" value={new Set(data.items?.map(v=>v.country).filter(Boolean)).size} />
            {!isMobile&&<Stat label="Timezones" value={new Set(data.items?.map(v=>v.metadata?.client?.timezone).filter(Boolean)).size} />}
            <Stat label="Mobile" value={data.items?.filter(v=>v.metadata?.client?.touch_support===true).length??0} />
            <Stat label="Desktop" value={data.items?.filter(v=>v.metadata?.client?.touch_support===false).length??0} />
          </div>
        )}
        <div style={{ flex:1, padding:isMobile?'12px 16px':'16px 24px', overflow:'auto' }}>
          {loading ? (
            <div style={{ color:'var(--text-2)', fontSize:14, padding:40, textAlign:'center' }}>Loading…</div>
          ) : !data?.items?.length ? (
            <div style={{ color:'var(--text-2)', fontSize:14, padding:'60px 0', textAlign:'center' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>👁</div>No views yet.
            </div>
          ) : (
            <>
              <ViewSparkline items={data.items} />
              <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:12 }}>Showing {data.items.length} of {data.total} views — <span style={{ color:'var(--accent)' }}>click row for full detail</span></div>
              {isMobile ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {data.items.map(v=>{
                    const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const exp=expandedRow===v.id
                    return (
                      <div key={v.id} style={{ background:'var(--bg-card)', border:`1px solid ${exp?'var(--accent)':'var(--border)'}`, borderRadius:10, overflow:'hidden' }}>
                        <div onClick={()=>setExpandedRow(exp?null:v.id)} style={{ padding:'12px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600 }}>{v.country?<>{flagEmoji(geo.country_code||v.country)} {v.city||v.country}</>:v.viewer_ip||'—'}</div>
                            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>{new Date(v.viewed_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
                            <div style={{ fontSize:11, color:'var(--text-2)' }}>{cli.touch_support===true?'📱 ':cli.touch_support===false?'🖥️ ':''}{fmtBrowser(v.user_agent)}</div>
                          </div>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <button onClick={e=>handleDeleteView(e,v.id)} disabled={deletingId===v.id} style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>{deletingId===v.id?'…':'Del'}</button>
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
                      <tr style={{ borderBottom:'2px solid var(--border)', background:'var(--bg-card)', position:'sticky', top:0, zIndex:2 }}>
                        {cols.map(h=><th key={h} style={{ padding:'9px 12px', textAlign:'left', color:'var(--text-2)', fontWeight:700, whiteSpace:'nowrap', fontSize:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((v,i)=>{
                        const geo=v.metadata?.geo||{}; const cli=v.metadata?.client||{}; const exp=expandedRow===v.id
                        return [
                          <tr key={v.id} onClick={()=>setExpandedRow(exp?null:v.id)} style={{ borderBottom:exp?'none':'1px solid var(--border)', background:exp?'var(--bg-card)':i%2?'var(--bg-card)':'var(--bg-base)', cursor:'pointer' }}>
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
                              <button onClick={e=>handleDeleteView(e,v.id)} disabled={deletingId===v.id} style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>{deletingId===v.id?'…':'Delete'}</button>
                            </td>
                          </tr>,
                          exp&&<tr key={`${v.id}-exp`} style={{ background:'var(--bg-card)', borderBottom:'2px solid var(--accent)' }}>
                            <td colSpan={11} style={{ padding:'20px 24px' }}><DetailGrid geo={geo} cli={cli} v={v} isMobile={false} /></td>
                          </tr>
                        ]
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {data.total>limit&&<button onClick={()=>setLimit(l=>l+50)} style={{ ...btnSecondary, marginTop:16, fontSize:12 }}>Load more ({data.total-limit} remaining)</button>}
            </>
          )}
        </div>
      </div>
    </div>
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
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ background:'var(--bg-base)', borderRadius:16, padding:28, maxWidth:420, width:'100%', boxShadow:'0 16px 64px rgba(0,0,0,0.25)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>Share Page</div>
          <button onClick={onClose} style={{ ...btnGhost, padding:'2px 8px', fontSize:18 }}>✕</button>
        </div>
        <div style={{ textAlign:'center', marginBottom:20 }}>
          <img src={qr} alt="QR code" width={180} height={180} style={{ borderRadius:12, border:'1px solid var(--border)' }} />
          <div style={{ fontSize:12, color:'var(--text-2)', marginTop:8 }}>Scan to open on mobile</div>
        </div>
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:12, display:'flex', gap:8, alignItems:'center' }}>
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
  )
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const TEMPLATES = {
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
  csv: [
    { name: 'Blank', icon: '📄', content: 'Column A,Column B,Column C\n,,\n,,\n,,' },
    { name: 'Budget Tracker', icon: '💰', content: 'Category,Item,Planned,Actual,Difference,Notes\nHousing,Rent,1500,1500,0,\nHousing,Utilities,200,180,20,\nFood,Groceries,400,350,50,\nFood,Dining Out,150,200,-50,Over budget\nTransport,Fuel,100,90,10,\nTransport,Insurance,80,80,0,\nHealth,Gym,50,50,0,\nEntertainment,Streaming,30,30,0,\nSavings,Emergency Fund,500,500,0,' },
    { name: 'Inventory', icon: '📦', content: 'SKU,Product Name,Category,Quantity,Unit Price,Total Value,Reorder Level,Supplier\nPRD-001,Product Alpha,Electronics,100,29.99,2999,20,Supplier A\nPRD-002,Product Beta,Clothing,250,14.99,3747.5,50,Supplier B\nPRD-003,Product Gamma,Food,500,4.99,2495,100,Supplier C' },
    { name: 'Contact List', icon: '👥', content: 'First Name,Last Name,Email,Phone,Company,Title,City,Country,Tags\nJohn,Doe,john@example.com,+1-555-0101,Acme Corp,CEO,New York,USA,client;vip\nJane,Smith,jane@example.com,+1-555-0102,Tech Inc,CTO,San Francisco,USA,partner' },
    { name: 'Project Tasks', icon: '✅', content: 'Task ID,Task Name,Assigned To,Priority,Status,Start Date,Due Date,% Complete,Notes\nT-001,Design mockups,Alice,High,In Progress,2024-01-01,2024-01-07,60,\nT-002,Backend API,Bob,High,Not Started,2024-01-05,2024-01-15,0,\nT-003,Frontend UI,Carol,Medium,Not Started,2024-01-08,2024-01-20,0,' },
  ],
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

// Lists uploaded attachments referenced in the content with a delete action.
function AttachmentsBar({ content, onChange }) {
  const [deleting, setDeleting] = useState(null)
  const assets = useMemo(() => extractAssets(content), [content])
  if (!assets.length) return null
  const remove = async (a) => {
    if (!window.confirm(`Remove "${a.name}"? This deletes the file from storage and its reference from the page.`)) return
    setDeleting(a.path)
    onChange(removeAssetRef(content, a.path))      // remove reference immediately
    try { await api.pages.deleteAsset(a.path) } catch { /* best-effort; reference already gone */ }
    setDeleting(null)
  }
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', padding:'8px 12px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', alignItems:'center', flexShrink:0 }}>
      <span style={{ fontSize:11, fontWeight:600, color:'var(--text-2)', marginRight:4 }}>📎 {assets.length} attachment{assets.length!==1?'s':''}</span>
      {assets.map(a=>(
        <div key={a.path} style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 6px 3px 4px', border:'1px solid var(--border)', borderRadius:6, background:'var(--bg-base)' }}>
          {a.isImg
            ? <img src={a.url} alt="" style={{ width:24, height:24, objectFit:'cover', borderRadius:4 }} />
            : <span style={{ fontSize:14 }}>📄</span>}
          <span style={{ fontSize:11, color:'var(--text-1)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={a.name}>{a.name}</span>
          <button type="button" title="Delete attachment" disabled={deleting===a.path}
            onClick={()=>remove(a)}
            style={{ border:'none', background:'transparent', color:'#ef4444', cursor:'pointer', fontSize:13, lineHeight:1, padding:'0 2px' }}>
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

function MarkdownToolbar({ textareaRef, value, onChange }) {
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
    <div style={{ display:'flex', gap:1, padding:'6px 8px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', flexWrap:'wrap', alignItems:'center', flexShrink:0 }}>
      {tools.map((group, gi) => (
        <div key={gi} style={{ display:'flex', gap:1, marginRight:8 }}>
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
      <div style={{ width:1, background:'var(--border)', margin:'2px 4px' }} />
      <AssetButton textareaRef={textareaRef} value={value} onChange={onChange} format={formatAssetMd} label="📎 Image / File" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spreadsheet Editor (Excel-like grid)
// ---------------------------------------------------------------------------
function SpreadsheetEditor({ value, onChange }) {
  const [grid, setGrid] = useState(() => csvToGrid(value))
  const [selectedCell, setSelectedCell] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [formulaBar, setFormulaBar] = useState('')
  const [suggest, setSuggest] = useState([])   // formula autosuggest list
  const inputRefs = useRef({})

  // Autosuggest: when the value being typed starts with '=', suggest functions
  const computeSuggest = (text) => {
    if (typeof text !== 'string' || !text.trim().startsWith('=')) return setSuggest([])
    const m = /([A-Za-z]+)$/.exec(text)
    const frag = (m ? m[1] : '').toUpperCase()
    if (!frag) return setSuggest(FORMULA_FUNCTIONS.slice(0, 6))
    setSuggest(FORMULA_FUNCTIONS.filter(f => f.startsWith(frag)).slice(0, 6))
  }
  const applySuggest = (fn) => {
    if (!selectedCell) return
    const cur = formulaBar || '='
    const next = cur.replace(/([A-Za-z]+)$/, '') + fn + '('
    setFormulaBar(next); setSuggest([])
    updateCell(selectedCell[0], selectedCell[1], next)
    inputRefs.current['fx']?.focus()
  }

  // Keep value in sync (external resets like template load)
  const lastExternal = useRef(value)
  useEffect(() => {
    if (value !== lastExternal.current && value !== gridToCSV(grid)) {
      lastExternal.current = value
      setGrid(csvToGrid(value))
    }
  }, [value])

  const commit = (newGrid) => {
    const csv = gridToCSV(newGrid)
    lastExternal.current = csv
    onChange(csv)
  }

  const updateCell = (r, c, val) => {
    const g = grid.map(row => [...row])
    g[r][c] = val; setGrid(g); commit(g)
  }

  const addRow = () => { const g=[...grid, Array(grid[0]?.length||3).fill('')]; setGrid(g); commit(g) }
  const addCol = () => { const g=grid.map(row=>[...row,'']); setGrid(g); commit(g) }
  const deleteRow = (ri) => { if(grid.length<=1) return; const g=grid.filter((_,i)=>i!==ri); setGrid(g); commit(g) }
  const deleteCol = (ci) => { if(grid[0]?.length<=1) return; const g=grid.map(row=>row.filter((_,i)=>i!==ci)); setGrid(g); commit(g) }

  const colLetter = (i) => { let s=''; i++; while(i>0){s=String.fromCharCode(64+((i-1)%26+1))+s;i=Math.floor((i-1)/26)} return s }

  const handleKeyDown = (e, r, c) => {
    if (e.key==='Tab') { e.preventDefault(); const nc=e.shiftKey?c-1:c+1; if(nc>=0&&nc<grid[r].length) setSelectedCell([r,nc]); else if(nc>=grid[r].length&&r<grid.length-1){setSelectedCell([r+1,0])} }
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); if(r<grid.length-1) setSelectedCell([r+1,c]) }
    if (e.key==='ArrowUp'&&r>0) { e.preventDefault(); setSelectedCell([r-1,c]) }
    if (e.key==='ArrowDown'&&r<grid.length-1) { e.preventDefault(); setSelectedCell([r+1,c]) }
  }

  useEffect(() => {
    if (selectedCell) {
      const [r,c]=selectedCell; setFormulaBar(grid[r]?.[c]||'')
      inputRefs.current[`${r}-${c}`]?.focus()
    }
  }, [selectedCell])

  const rows=grid; const cols=rows[0]?.length||3

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg-base)' }}>
      {/* Formula bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', borderBottom:'2px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
        <div style={{ background:'#e2e8f0', borderRadius:4, padding:'4px 10px', fontSize:12, fontFamily:'monospace', fontWeight:700, color:'var(--text-2)', minWidth:50, textAlign:'center' }}>
          {selectedCell?`${colLetter(selectedCell[1])}${selectedCell[0]+1}`:'—'}
        </div>
        <div style={{ color:'var(--text-2)', fontSize:16, fontWeight:300 }}>fx</div>
        <div style={{ flex:1, position:'relative' }}>
          <input ref={el=>inputRefs.current['fx']=el} value={formulaBar} onChange={e=>{
            setFormulaBar(e.target.value); computeSuggest(e.target.value)
            if(selectedCell) updateCell(selectedCell[0],selectedCell[1],e.target.value)
          }} onBlur={()=>setTimeout(()=>setSuggest([]),150)}
            placeholder="Value or =SUM(A1:A5) …" style={{ width:'100%', boxSizing:'border-box', border:'1px solid var(--border)', borderRadius:4, padding:'4px 8px', fontSize:13, fontFamily:'monospace', background:'var(--bg-base)', color:'var(--text-1)', outline:'none' }} />
          {suggest.length>0 && (
            <div style={{ position:'absolute', top:'100%', left:0, zIndex:20, marginTop:2, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:6, boxShadow:'0 4px 12px rgba(0,0,0,0.15)', minWidth:180, overflow:'hidden' }}>
              {suggest.map(fn=>(
                <div key={fn} onMouseDown={e=>{e.preventDefault();applySuggest(fn)}}
                  style={{ padding:'6px 10px', fontSize:12, fontFamily:'monospace', cursor:'pointer', color:'var(--text-1)', borderBottom:'1px solid var(--border)' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--bg-base)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <span style={{ fontWeight:700, color:'var(--accent)' }}>{fn}</span>()
                </div>
              ))}
            </div>
          )}
        </div>
        <button title="Add row" onClick={addRow} style={{ ...btnTiny, fontSize:11, padding:'3px 8px' }}>+ Row</button>
        <button title="Add column" onClick={addCol} style={{ ...btnTiny, fontSize:11, padding:'3px 8px' }}>+ Col</button>
      </div>
      {/* Grid */}
      <div style={{ flex:1, overflowAuto:'auto', overflow:'auto' }}>
        <table style={{ borderCollapse:'collapse', tableLayout:'fixed', minWidth:'100%', fontSize:13 }}>
          <thead>
            <tr>
              <th style={{ width:40, background:'#f1f5f9', border:'1px solid #d1d5db', padding:'4px', textAlign:'center', fontSize:11, color:'#94a3b8', position:'sticky', top:0, left:0, zIndex:3 }}>#</th>
              {Array.from({length:cols},(_,c)=>(
                <th key={c} style={{ minWidth:110, width:130, background:'#f1f5f9', border:'1px solid #d1d5db', padding:'4px 8px', textAlign:'center', fontSize:11, fontWeight:700, color:'#475569', position:'sticky', top:0, zIndex:2, cursor:'pointer', userSelect:'none' }}
                  title={`Column ${colLetter(c)}`}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                    {colLetter(c)}
                    {cols>1&&<span onClick={e=>{e.stopPropagation();deleteCol(c)}} style={{ fontSize:10, color:'#ef4444', cursor:'pointer', opacity:0.6, lineHeight:1 }} title="Delete column">✕</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row,r)=>(
              <tr key={r}>
                <td style={{ background:'#f8fafc', border:'1px solid #d1d5db', padding:'4px', textAlign:'center', fontSize:11, color:'#94a3b8', fontWeight:700, position:'sticky', left:0, zIndex:1, cursor:'pointer', userSelect:'none' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}>
                    {r+1}
                    {rows.length>1&&<span onClick={()=>deleteRow(r)} style={{ fontSize:10, color:'#ef4444', cursor:'pointer', opacity:0.6 }} title="Delete row">✕</span>}
                  </div>
                </td>
                {row.map((cell,c)=>{
                  const isSel=selectedCell?.[0]===r&&selectedCell?.[1]===c
                  const isHdr=r===0
                  const isFormula = typeof cell==='string' && cell.trim().startsWith('=')
                  // Show computed result when not focused; raw formula when editing
                  const display = isSel ? cell : (isFormula ? cellDisplay(grid,r,c) : cell)
                  const isErr = isFormula && typeof display==='string' && display.startsWith('#')
                  return (
                    <td key={c} style={{ border:`1px solid ${isSel?'#2563eb':'#d1d5db'}`, padding:0, background:isSel?'#eff6ff':isHdr?'#f8fafc':isFormula&&!isSel?'#f0fdf4':'#fff', outline:isSel?'2px solid #2563eb':' none', outlineOffset:-1 }}
                      title={isFormula&&!isSel?cell:undefined}>
                      <input
                        ref={el=>inputRefs.current[`${r}-${c}`]=el}
                        value={display}
                        onChange={e=>{ updateCell(r,c,e.target.value); setFormulaBar(e.target.value); computeSuggest(e.target.value) }}
                        onFocus={()=>{ setSelectedCell([r,c]); setFormulaBar(cell) }}
                        onKeyDown={e=>handleKeyDown(e,r,c)}
                        style={{ width:'100%', height:32, padding:'0 8px', border:'none', outline:'none', background:'transparent', fontSize:13, fontFamily:isHdr?'inherit':'monospace', fontWeight:isHdr?700:400, color:isErr?'#dc2626':(isFormula&&!isSel?'#15803d':'var(--text-1)'), boxSizing:'border-box' }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding:'4px 12px', background:'var(--bg-card)', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--text-2)', flexShrink:0 }}>
        {rows.length} rows × {cols} columns · Tab/Enter to move · Type <code style={{ fontFamily:'monospace' }}>=SUM(A1:A5)</code>, <code style={{ fontFamily:'monospace' }}>=A1*B1</code> for formulas
      </div>
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
    const lines = content.split('\n').filter(Boolean).length
    return { words:0, chars, readTime:'—', lines, label:`${lines} rows` }
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
    <div style={{ display:'flex', gap:8, padding:'8px 12px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', overflowX:'auto', flexShrink:0 }}>
      <span style={{ fontSize:11, color:'var(--text-2)', fontWeight:600, whiteSpace:'nowrap', alignSelf:'center' }}>Templates:</span>
      {list.map(t=>(
        <button key={t.name} onClick={()=>onSelect(t.content)} style={{ ...btnTiny, whiteSpace:'nowrap', fontSize:11, padding:'4px 10px', flexShrink:0 }}>
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
    if (!window.confirm(`Restore to version ${ver.version_num} from ${new Date(ver.saved_at).toLocaleString()}?\n\nYour current content will be saved as a new version first.`)) return
    setRestoring(ver.id)
    try {
      const r = await api.pages.restoreVersion(pageId, ver.id)
      if (r.ok && r.page) {
        setToast('✓ Restored! Reloading editor…')
        setTimeout(() => { onRestore(r.page); setToast('') }, 1500)
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
          <div style={{ padding:'10px 16px', background:'#d1fae5', color:'#065f46', fontSize:12, fontWeight:600, borderBottom:'1px solid var(--border)' }}>{toast}</div>
        )}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Version History</span>
          <button onClick={()=>{ setLoading(true); api.pages.versions(pageId).then(r=>{setVersions(r.items||[]);setLoading(false)}).catch(()=>setLoading(false)) }}
            style={{ fontSize:12, color:'var(--accent)', border:'none', background:'none', cursor:'pointer', padding:'2px 4px' }}>↻</button>
        </div>
        {loading ? (
          <div style={{ padding:20, fontSize:13, color:'var(--text-2)', textAlign:'center' }}>Loading…</div>
        ) : !versions?.length ? (
          <div style={{ padding:'24px 16px', fontSize:13, color:'var(--text-2)', textAlign:'center' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
            No versions yet. Versions are captured automatically every 5 minutes while editing.
          </div>
        ) : (
          <div>
            {/* Current state indicator */}
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', background:'#f0fdf4' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#15803d' }}>● Current version</div>
              <div style={{ fontSize:11, color:'#16a34a', marginTop:2 }}>
                {currentContent ? `${currentContent.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words` : '—'}
              </div>
            </div>
            {versions.map(ver => {
              const isSelected = previewVer?.id === ver.id
              const isRestoring = restoring === ver.id
              return (
                <div key={ver.id} style={{ borderBottom:'1px solid var(--border)', padding:'10px 14px', background:isSelected?'var(--bg-card)':'transparent', cursor:'pointer' }}
                  onClick={() => loadPreview(ver)}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--accent)', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'1px 6px', flexShrink:0 }}>
                      v{ver.version_num}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-1)', fontWeight:isSelected?700:400, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {ver.title || 'Untitled'}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>
                    {fmtTime(ver.saved_at)}
                    {ver.word_count > 0 && ` · ${ver.word_count.toLocaleString()} words`}
                    {ver.note && <span style={{ color:'#7c3aed' }}> · {ver.note}</span>}
                  </div>
                  {ver.saved_by_name && <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2 }}>by {ver.saved_by_name}</div>}
                  {isSelected && (
                    <button
                      onClick={e=>{ e.stopPropagation(); handleRestore(ver) }}
                      disabled={isRestoring}
                      style={{ marginTop:8, width:'100%', padding:'5px 10px', fontSize:12, fontWeight:600, border:'1px solid var(--accent)', borderRadius:6, background:'var(--accent)', color:'#fff', cursor:'pointer', opacity:isRestoring?0.6:1 }}>
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
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, background:'var(--bg-card)', flexShrink:0 }}>
            <span style={{ fontSize:12, fontWeight:700 }}>Preview: v{previewVer.version_num}</span>
            <span style={{ fontSize:11, color:'var(--text-2)' }}>{previewVer.title}</span>
            <span style={{ fontSize:11, color:'var(--text-2)', marginLeft:'auto' }}>{new Date(previewVer.saved_at).toLocaleString()}</span>
            <button onClick={()=>setPreviewVer(null)} style={{ fontSize:18, border:'none', background:'none', cursor:'pointer', color:'var(--text-2)', lineHeight:1 }}>×</button>
          </div>
          <div style={{ flex:1, overflow:'auto', background:'#fff', padding:'20px 24px' }}>
            <ContentPreview contentType={previewVer.content_type} content={previewVer.content} />
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
  { value:'markdown',    label:'📝 Document',    hint:'Rich text / markdown' },
  { value:'html',        label:'🌐 Web Page',     hint:'HTML / CSS / JS' },
  { value:'csv',         label:'📊 Spreadsheet',  hint:'Editable grid / table' },
  { value:'text',        label:'📄 Plain Text',   hint:'Plain text / code' },
]

function PageDrawer({ page, onClose, onSaved, initialType }) {
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
    content:              page?.content || '',
    slug:                 page?.slug || '',
    is_password_protected:page?.is_password_protected || false,
    password:             '',
    description:          page?.metadata?.description || '',
  })
  const [slugManual, setSlugManual] = useState(!!page?.slug)
  const [tab, setTab] = useState('edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState('') // '', 'saving', 'saved', 'error', 'offline'
  const [showTemplates, setShowTemplates] = useState(!page?.content)
  const [slugStatus, setSlugStatus] = useState(null) // null | { available, suggestions }
  const charLimit = 5_000_000  // effectively unlimited; lets docs embed images/files
  const autoSaveKey = `pages_draft_${page?.id || 'new'}`
  const createdRef = useRef(false)   // guards against double-create races
  const createPromiseRef = useRef(null) // holds in-flight create promise so handleSave can await it
  const savedSnapRef = useRef(JSON.stringify({ title:page?.title||'', content_type:page?.content_type||'markdown', content:page?.content||'', slug:page?.slug||'', description:page?.metadata?.description||'' }))

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), [])
  const setContent = useCallback((v) => setForm(f => ({ ...f, content: v })), [])

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
    }
    setForm(next)
    setShowTemplates(false)
    savedSnapRef.current = JSON.stringify({ title:next.title, content_type:next.content_type, content:next.content, slug:next.slug||'', description:next.description||'' })
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
  const savePayload = useMemo(() => ({
    title:        form.title,
    content_type: form.content_type,
    content:      form.content,
    slug:         form.slug || undefined,
    metadata:     { description: form.description },
  }), [form.title, form.content_type, form.content, form.slug, form.description])
  const snapshot = useMemo(() => JSON.stringify({
    title:form.title, content_type:form.content_type, content:form.content, slug:form.slug||'', description:form.description||'',
  }), [form.title, form.content_type, form.content, form.slug, form.description])
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
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus(s => s === 'saved' ? '' : s), 2500)
      } catch (e) {
        createdRef.current = false   // allow retry
        createPromiseRef.current = null
        if (!cancelled) setAutoSaveStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [debouncedSnap]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore a local backup on open if the server copy is empty/older
  useEffect(() => {
    if (page?.content) return
    try {
      const d = localStorage.getItem(autoSaveKey)
      if (!d) return
      const parsed = JSON.parse(d)
      if (parsed.content && parsed.ts > Date.now() - 7 * 24 * 3600 * 1000) {
        if (window.confirm('Restore unsaved draft from last session?')) {
          set('content', parsed.content)
          if (parsed.title && !form.title) set('title', parsed.title)
        }
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
        content:              form.content,
        slug:                 form.slug || undefined,
        is_password_protected:form.is_password_protected,
        password:             form.is_password_protected && form.password ? form.password : undefined,
        metadata:             { description: form.description },
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
      if (publish && !saved.is_published) saved = await api.pages.publish(saved.id, true)
      localStorage.removeItem(autoSaveKey)
      onSaved(saved)
    } catch (e) { setError(e?.message || 'Failed to save.') }
    finally { setSaving(false) }
  }

  // Closing the drawer should never lose work: if there are unsaved changes,
  // fire a save (fire-and-forget, also backed by localStorage) before closing.
  const flushAndClose = () => {
    if (snapshot !== savedSnapRef.current && form.title.trim()) {
      const payload = { title:form.title, content_type:form.content_type, content:form.content, slug:form.slug || undefined, metadata:{ description:form.description } }
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

  const stats = docStats(form.content, form.content_type)
  const shareUrl = form.slug ? `${window.location.origin}/p/${form.slug}` : ''
  const isSpreadsheet = form.content_type === 'csv'
  const isHtml = form.content_type === 'html'
  const isMarkdown = form.content_type === 'markdown'

  const placeholders = {
    markdown: '# Start writing…\n\nUse the toolbar above for formatting, or write markdown directly.',
    html: '<!DOCTYPE html>\n<html><head>…</head><body>…</body></html>',
    text: 'Start typing your plain text content…',
  }

  const drawerStyle = fullscreen
    ? { position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.6)', display:'flex', justifyContent:'flex-end' }
    : { position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.45)', display:'flex', justifyContent:'flex-end' }

  const panelStyle = {
    width: fullscreen ? '100vw' : isMobile ? '100vw' : '94vw',
    maxWidth: fullscreen ? '100vw' : 1200,
    height: '100%',
    background: 'var(--bg-base)',
    overflowY: 'hidden',
    boxShadow: '-4px 0 32px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <div style={drawerStyle} onClick={flushAndClose}>
      <div style={panelStyle} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:isMobile?'10px 14px':'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <select value={form.content_type} onChange={e=>{set('content_type',e.target.value);setShowTemplates(!page?.content)}}
              style={{ ...inputStyle, width:'auto', fontSize:12, padding:'5px 8px', fontWeight:600 }}>
              {CONTENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{ display:'flex', gap:6, fontSize:11, color:'var(--text-2)' }}>
              {stats.label && <span>{stats.label}</span>}
              {stats.readTime !== '—' && <span>· {stats.readTime}</span>}
              {form.content.length > charLimit * 0.8 && (
                <span style={{ color:form.content.length>charLimit?'#ef4444':'#f59e0b', fontWeight:600 }}>
                  {form.content.length.toLocaleString()} / {charLimit.toLocaleString()} chars
                </span>
              )}
              {autoSaveStatus === 'saved' && <span style={{ color:'#10b981' }}>✓ Saved to cloud</span>}
              {autoSaveStatus === 'saving' && <span style={{ color:'#94a3b8' }}>☁ Saving…</span>}
              {autoSaveStatus === 'error' && <span style={{ color:'#ef4444' }}>⚠ Save failed — kept local backup</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            {error && <span style={{ color:'#ef4444', fontSize:12 }}>{error}</span>}
            <button onClick={()=>setFullscreen(f=>!f)} style={{ ...btnGhost, fontSize:14, padding:'5px 10px' }} title={fullscreen?'Exit fullscreen':'Fullscreen'}>{fullscreen?'⊡':'⊞'}</button>
            <button onClick={flushAndClose} style={btnGhost} disabled={saving}>Close</button>
            <button onClick={()=>handleSave(false)} style={btnSecondary} disabled={saving}>{saving?'Saving…':'Save Draft'}</button>
            <button onClick={()=>handleSave(true)} style={btnPrimary} disabled={saving}>
              {saving?'Publishing…':isEdit&&page?.is_published?'Update':'Publish'}
            </button>
          </div>
        </div>

        {/* Meta fields */}
        <div style={{ padding:isMobile?'10px 14px':'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', gap:10, flexWrap:'wrap', flexShrink:0 }}>
          <div style={{ flex:'3 1 200px' }}>
            <input style={{ ...inputStyle, fontSize:16, fontWeight:700, border:'none', borderBottom:'2px solid var(--border)', borderRadius:0, padding:'6px 0', background:'transparent' }}
              placeholder="Page title…"
              value={form.title} onChange={e=>set('title',e.target.value)} />
          </div>
          <div style={{ flex:'2 1 150px' }}>
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
              <div style={{ marginTop:4, fontSize:11, color:'#b45309' }}>
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
              <div style={{ marginTop:4, fontSize:11, color:'#16a34a' }}>✓ URL is available</div>
            )}
          </div>
          <div style={{ flex:'2 1 150px' }}>
            <label style={labelStyle}>Description (for SEO)</label>
            <input style={inputStyle} placeholder="Short description" value={form.description} onChange={e=>set('description',e.target.value)} />
          </div>
          <div style={{ flex:'0 0 auto', display:'flex', alignItems:'flex-end', gap:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={form.is_password_protected} onChange={e=>set('is_password_protected',e.target.checked)} />
              🔒 Password
            </label>
            {form.is_password_protected&&(
              <input style={{ ...inputStyle, width:110, fontSize:12 }} type="password" placeholder="Set password" value={form.password} onChange={e=>set('password',e.target.value)} />
            )}
          </div>
        </div>

        {/* Templates bar */}
        {showTemplates && tab !== 'history' && (
          <TemplatePicker contentType={form.content_type} onSelect={c=>{ set('content',c); setShowTemplates(false) }} />
        )}

        {/* Toolbar for markdown */}
        {isMarkdown && tab === 'edit' && (
          <MarkdownToolbar textareaRef={textareaRef} value={form.content} onChange={setContent} />
        )}
        {isHtml && tab === 'edit' && (
          <div style={{ display:'flex', gap:1, padding:'6px 8px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', alignItems:'center', flexShrink:0 }}>
            <AssetButton textareaRef={textareaRef} value={form.content} onChange={setContent} format={formatAssetHtml} label="📎 Insert image / file" />
            <span style={{ fontSize:11, color:'var(--text-2)', marginLeft:6 }}>Uploads to secure cloud storage and inserts an &lt;img&gt;/&lt;a&gt; tag at the cursor</span>
          </div>
        )}
        {(isMarkdown || isHtml) && tab === 'edit' && (
          <AttachmentsBar content={debouncedContent} onChange={setContent} />
        )}


        {/* Edit / Preview / History tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:`0 ${isMobile?'14px':'20px'}`, flexShrink:0 }}>
          {(isSpreadsheet ? ['edit','history'] : ['edit','preview','history']).map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{ padding:'8px 14px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:tab===t?'var(--accent)':'var(--text-2)', borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent', textTransform:'capitalize', marginBottom:-1 }}>
              {t === 'history' ? '🕐 History' : t}
            </button>
          ))}
          {!showTemplates && tab !== 'history' && (
            <button onClick={()=>setShowTemplates(true)} style={{ marginLeft:'auto', alignSelf:'center', ...btnGhost, fontSize:11, padding:'4px 8px' }}>Use template</button>
          )}
        </div>

        {/* Editor-type banner — only when editing/previewing */}
        {tab !== 'history' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 16px', fontSize:12, color:'var(--text-2)', background:'var(--bg-base)', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
            <span style={{ fontWeight:700, color:'var(--text-1)' }}>
              {isSpreadsheet ? '📊 Spreadsheet' : isHtml ? '🌐 Web Page (HTML)' : isMarkdown ? '📝 Document' : '📄 Plain Text'}
            </span>
            <span>
              {isSpreadsheet ? 'Excel-like grid — type =SUM(A1:A5) for formulas, add rows/columns'
                : isHtml ? 'Write raw HTML/CSS/JS — renders as a full web page'
                : isMarkdown ? 'Rich document — use the toolbar for headings, bold, tables, images'
                : 'Plain text / code'}
            </span>
          </div>
        )}

        {/* Content area */}
        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {tab === 'history' ? (
            <VersionHistoryPanel
              pageId={currentId}
              currentContent={form.content}
              currentContentType={form.content_type}
              onRestore={(restoredPage) => {
                setForm(f => ({
                  ...f,
                  title:        restoredPage.title || f.title,
                  content:      restoredPage.content ?? f.content,
                  content_type: restoredPage.content_type || f.content_type,
                }))
                savedSnapRef.current = JSON.stringify({ title:restoredPage.title||'', content_type:restoredPage.content_type||'markdown', content:restoredPage.content||'', slug:restoredPage.slug||form.slug||'', description:form.description||'' })
                setTab('edit')
                onSaved(restoredPage)
              }}
            />
          ) : isSpreadsheet ? (
            <SpreadsheetEditor value={form.content} onChange={setContent} />
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
            <div style={{ flex:1, overflow:'auto', background:'#fff', borderTop:'1px solid var(--border)' }}>
              <ContentPreview contentType={form.content_type} content={form.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onCancel}>
      <div style={{ background:'var(--bg-base)', borderRadius:'var(--radius)', padding:28, maxWidth:380, width:'100%', boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>Confirm</div>
        <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:22 }}>{message}</div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnPrimary, background:'#ef4444' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page Card (mobile)
// ---------------------------------------------------------------------------
function PageCard({ page, onEdit, onPublish, onShare, onAnalytics, onDelete }) {
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>
            {page.title||'Untitled'}{page.is_password_protected&&<span style={{ marginLeft:5 }}>🔒</span>}
          </div>
          {page.is_published
            ? <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug} ↗</a>
            : <span style={{ fontSize:11, color:'var(--text-2)', fontFamily:'monospace' }}>/p/{page.slug}</span>
          }
        </div>
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          <Badge label={page.content_type} color={page.content_type} />
          <Badge label={page.is_published?'Live':'Draft'} color={page.is_published?'published':'draft'} />
        </div>
      </div>
      <button onClick={()=>onAnalytics(page)} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 12px', cursor:'pointer', fontSize:12, fontWeight:600, color:'var(--text-1)', textAlign:'left' }}>
        <span>👁</span><span>{page.view_count??0} views</span><span style={{ color:'var(--accent)', fontSize:11, marginLeft:'auto' }}>Analytics →</span>
      </button>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
        <button style={btnTiny} onClick={()=>onEdit(page)}>Edit</button>
        <button style={{ ...btnTiny, background:page.is_published?'#fef3c7':'#d1fae5', color:page.is_published?'#92400e':'#065f46', border:'none' }} onClick={()=>onPublish(page)}>{page.is_published?'Unpublish':'Publish'}</button>
        {page.is_published&&<button style={btnTiny} onClick={()=>onShare(page)}>Share ↗</button>}
        <button style={{ ...btnTiny, background:'#fef2f2', color:'#991b1b', border:'none' }} onClick={()=>onDelete(page)}>Delete</button>
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
  const [analyticsPage, setAnalyticsPage] = useState(null)
  const [sharePage, setSharePage] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [toast, setToast] = useState({ msg:'', ok:true })
  const [search, setSearch] = useState('')
  const [filterTab, setFilterTab] = useState('all')
  const [cloning, setCloning] = useState(null)

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast({msg:'',ok:true}),3500) }

  // Track IDs the user explicitly deleted so background refreshes can't restore them.
  const deletedIdsRef = useRef(new Set())

  const loadPages = useCallback(async (silent=false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const data = await api.pages.list({ fresh:true })
      if (data?.detail) throw new Error(data.detail)
      const list = Array.isArray(data) ? data : []
      // Filter out pages the user already deleted (prevent respawn from background polls)
      setPages(list.filter(p => !deletedIdsRef.current.has(p.id)))
    } catch (e) { if (!silent) setError(e?.message||'Failed to load') }
    finally { if (!silent) setLoading(false) }
  }, [])

  // Initial load + keep the list live without manual refresh: silently refetch
  // when the tab regains focus and on a 30s interval.
  useEffect(()=>{
    loadPages()
    const onFocus = () => loadPages(true)
    window.addEventListener('focus', onFocus)
    const iv = setInterval(() => loadPages(true), 30000)
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
      const created = await api.pages.create({
        title:`${full.title} (Copy)`, content_type:full.content_type, content:full.content,
        slug:slugify(`${full.title}-copy-${Date.now().toString(36)}`), metadata:full.metadata||{},
      })
      if (created?.detail||created?.error) throw new Error(created.detail||created.error)
      setPages(prev=>[created,...prev]); showToast('Cloned — edit and publish when ready')
    } catch (e) { showToast(e?.message||'Clone failed',false) }
    finally { setCloning(null) }
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

  const filtered = pages.filter(p=>{
    const matchTab=filterTab==='all'||(filterTab==='published'&&p.is_published)||(filterTab==='drafts'&&!p.is_published)
    const q=search.toLowerCase()
    return matchTab&&(!q||p.title?.toLowerCase().includes(q)||p.slug?.toLowerCase().includes(q))
  })

  const totalViews = pages.reduce((s,p)=>s+(p.view_count||0),0)

  return (
    <div style={{ padding:isMobile?'16px':'24px 28px', maxWidth:1200, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:12, flexWrap:'wrap' }}>
        <div>
          <h1 style={{ margin:0, fontSize:isMobile?18:22, fontWeight:700 }}>Pages</h1>
          {!isMobile&&<p style={{ margin:'4px 0 0', fontSize:13, color:'var(--text-2)' }}>Create docs, spreadsheets, web pages & text — share with a public link. Full analytics on every view.</p>}
        </div>
        <button style={btnPrimary} onClick={()=>setDrawerPage({content_type:'markdown'})}>+ New Page</button>
      </div>

      {/* Stats */}
      {pages.length>0&&(
        <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
          {[{label:'Total Pages',value:pages.length},{label:'Live',value:pages.filter(p=>p.is_published).length},{label:'Drafts',value:pages.filter(p=>!p.is_published).length},{label:'Total Views',value:totalViews.toLocaleString()}].map(s=>(
            <div key={s.label} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:isMobile?'10px 14px':'12px 18px', minWidth:80 }}>
              <div style={{ fontSize:isMobile?18:20, fontWeight:800 }}>{s.value}</div>
              <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter */}
      {pages.length>0&&(
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
          <input style={{ ...inputStyle, maxWidth:isMobile?'100%':240, padding:'7px 12px' }} placeholder="Search pages…" value={search} onChange={e=>setSearch(e.target.value)} />
          <div style={{ display:'flex', gap:2, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:2 }}>
            {[['all','All'],['published','Live'],['drafts','Drafts']].map(([val,label])=>(
              <button key={val} onClick={()=>setFilterTab(val)} style={{ padding:'5px 12px', borderRadius:6, border:'none', fontSize:12, fontWeight:600, cursor:'pointer', background:filterTab===val?'var(--accent)':'transparent', color:filterTab===val?'#fff':'var(--text-2)' }}>{label}</button>
            ))}
          </div>
          {(search||filterTab!=='all')&&<button onClick={()=>{setSearch('');setFilterTab('all')}} style={{ ...btnGhost, fontSize:12, padding:'5px 10px' }}>Clear</button>}
        </div>
      )}

      {error&&<div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'var(--radius)', padding:'10px 14px', fontSize:13, color:'#991b1b', marginBottom:16 }}>{error}</div>}

      {loading ? (
        <div style={{ color:'var(--text-2)', fontSize:14, padding:60, textAlign:'center' }}>Loading…</div>
      ) : !pages.length ? (
        <div style={{ textAlign:'center', padding:'60px 20px', border:'2px dashed var(--border)', borderRadius:'var(--radius)', color:'var(--text-2)' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
          <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>No pages yet</div>
          <div style={{ fontSize:13, marginBottom:6 }}>Create documents, spreadsheets, or full web pages — share with anyone via a public link.</div>
          <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop:16, flexWrap:'wrap' }}>
            {[{icon:'📝',label:'New Document',type:'markdown'},{icon:'📊',label:'New Spreadsheet',type:'csv'},{icon:'🌐',label:'New Web Page',type:'html'}].map(b=>(
              <button key={b.label} onClick={()=>setDrawerPage({content_type:b.type})} style={{ ...btnSecondary, fontSize:13 }}>{b.icon} {b.label}</button>
            ))}
          </div>
        </div>
      ) : !filtered.length ? (
        <div style={{ textAlign:'center', padding:'40px', color:'var(--text-2)' }}>No pages match.<button onClick={()=>{setSearch('');setFilterTab('all')}} style={{ ...btnGhost, display:'block', margin:'12px auto 0' }}>Clear filters</button></div>
      ) : isMobile ? (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(page=><PageCard key={page.id} page={page} onEdit={openEdit} onPublish={handlePublishToggle} onShare={setSharePage} onAnalytics={setAnalyticsPage} onDelete={setConfirmDelete} />)}
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--bg-card)', borderBottom:'1px solid var(--border)' }}>
                {['Title / URL','Type','Status','Views','Created','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:600, color:'var(--text-2)', whiteSpace:'nowrap', fontSize:11, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((page,idx)=>(
                <tr key={page.id} style={{ borderBottom:idx<filtered.length-1?'1px solid var(--border)':'none' }}>
                  <td style={{ padding:'12px 14px', maxWidth:260 }}>
                    <div style={{ fontWeight:600, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {page.title||<span style={{ color:'var(--text-2)' }}>Untitled</span>}
                      {page.is_password_protected&&<span style={{ marginLeft:5, fontSize:11 }}>🔒</span>}
                    </div>
                    {page.is_published
                      ? <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug} ↗</a>
                      : <span style={{ fontSize:11, color:'var(--text-2)', fontFamily:'monospace' }}>/p/{page.slug}</span>
                    }
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}><Badge label={page.content_type} color={page.content_type} /></td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}><Badge label={page.is_published?'Live':'Draft'} color={page.is_published?'published':'draft'} /></td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <button onClick={()=>setAnalyticsPage(page)} style={{ display:'inline-flex', alignItems:'center', gap:5, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:7, padding:'4px 10px', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                      <span>👁</span>{page.view_count??0}<span style={{ color:'var(--accent)', fontSize:10 }}>→</span>
                    </button>
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:12 }}>
                    {page.created_at?new Date(page.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'}
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      <button style={btnTiny} onClick={()=>openEdit(page)} disabled={openingId===page.id}>{openingId===page.id?'…':'Edit'}</button>
                      <button style={{ ...btnTiny, background:page.is_published?'#fef3c7':'#d1fae5', color:page.is_published?'#92400e':'#065f46', border:'none' }} onClick={()=>handlePublishToggle(page)}>{page.is_published?'Unpublish':'Publish'}</button>
                      <button style={btnTiny} onClick={()=>handleClone(page)} disabled={cloning===page.id}>{cloning===page.id?'…':'Clone'}</button>
                      {page.is_published&&<button style={{ ...btnTiny, background:'#eff6ff', color:'#1d4ed8', border:'none' }} onClick={()=>setSharePage(page)}>Share ↗</button>}
                      <button style={{ ...btnTiny, background:'#fef2f2', color:'#991b1b', border:'none' }} onClick={()=>setConfirmDelete(page)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerPage!==null&&<PageDrawer key={drawerPage?.id||drawerPage?.content_type||'new'} page={drawerPage?.id?drawerPage:null} initialType={drawerPage?.id?undefined:(drawerPage?.content_type||'markdown')} onClose={()=>setDrawerPage(null)} onSaved={handleSaved} />}
      {analyticsPage&&<AnalyticsDrawer page={analyticsPage} onClose={()=>setAnalyticsPage(null)} />}
      {sharePage&&<ShareModal page={sharePage} onClose={()=>setSharePage(null)} onCopy={()=>showToast('Link copied!')} />}
      {confirmDelete&&<ConfirmDialog message={`Delete "${confirmDelete.title}"? All view history will be removed. This cannot be undone.`} onConfirm={handleDelete} onCancel={()=>setConfirmDelete(null)} />}

      {toast.msg&&(
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:toast.ok?'#1e293b':'#dc2626', color:'#f8fafc', padding:'11px 20px', borderRadius:'var(--radius)', fontSize:13, fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.3)', maxWidth:'calc(100vw - 48px)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const inputStyle = { display:'block', width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:'var(--radius)', background:'var(--bg-card)', color:'var(--text-1)', fontSize:13, outline:'none', boxSizing:'border-box' }
const labelStyle = { display:'block', fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em' }
const btnBase = { border:'none', borderRadius:'var(--radius)', padding:'8px 16px', fontSize:13, fontWeight:600, cursor:'pointer' }
const btnPrimary = { ...btnBase, background:'var(--accent)', color:'#fff' }
const btnSecondary = { ...btnBase, background:'var(--bg-card)', color:'var(--text-1)', border:'1px solid var(--border)' }
const btnGhost = { ...btnBase, background:'transparent', color:'var(--text-2)', padding:'7px 12px' }
const btnTiny = { ...btnBase, padding:'4px 10px', fontSize:12, background:'var(--bg-card)', color:'var(--text-1)', border:'1px solid var(--border)' }
