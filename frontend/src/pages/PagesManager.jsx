import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/api'

// ---------------------------------------------------------------------------
// Mobile hook
// ---------------------------------------------------------------------------
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

// ---------------------------------------------------------------------------
// Markdown preview
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw) return ''
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.replace(/```(\w*)\n([\s\S]*?)```/gm, (_, lang, code) => {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `\x02PRE${lang ? ` data-lang="${lang}"` : ''}>${esc.trimEnd()}\x03\n`
  })
  return s.split(/\n{2,}/).map(block => {
    const t = block.trim(); if (!t) return ''
    if (t.startsWith('\x02PRE')) return t.replace(/\x02PRE([^>]*)>([\s\S]*?)\x03/, (_, a, c) => `<pre style="background:#1e293b;color:#e2e8f0;padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:13px"${a}><code>${c}</code></pre>`)
    if (/^#{1,6} /.test(t)) return t.replace(/^(#{1,6}) (.+)$/, (_, h, tx) => `<h${h.length} style="margin:.8em 0 .3em;font-weight:700">${inl(tx)}</h${h.length}>`)
    if (t.startsWith('> ')) return `<blockquote style="border-left:3px solid #94a3b8;margin:.6em 0;padding:.3em .8em;background:#f1f5f9;color:#475569">${inl(t.replace(/^> /gm,''))}</blockquote>`
    if (/^[-*_]{3,}$/.test(t)) return '<hr style="border:none;border-top:1px solid #e2e8f0;margin:1em 0">'
    if (/^[\-*+] /.test(t)) return `<ul style="padding-left:1.4em;margin:.5em 0">${t.split('\n').filter(l=>/^[\-*+] /.test(l)).map(l=>`<li>${inl(l.replace(/^[\-*+] /,''))}</li>`).join('')}</ul>`
    if (/^\d+\. /.test(t)) return `<ol style="padding-left:1.4em;margin:.5em 0">${t.split('\n').filter(l=>/^\d+\. /.test(l)).map(l=>`<li>${inl(l.replace(/^\d+\. /,''))}</li>`).join('')}</ol>`
    return `<p style="margin:.6em 0;line-height:1.7">${inl(t.replace(/\n/g,'<br>'))}</p>`
  }).filter(Boolean).join('\n')
}
function inl(s) {
  return s
    .replace(/`([^`]+)`/g,'<code style="background:#f1f5f9;padding:.1em .35em;border-radius:3px;font-size:.875em;color:#be185d">$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener" style="color:#2563eb">$1</a>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<del>$1</del>')
}

// ---------------------------------------------------------------------------
// CSV preview
// ---------------------------------------------------------------------------
function parseLine(line) {
  const r=[]; let c=''; let q=false
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){if(q&&line[i+1]==='"'){c+='"';i++}else q=!q}
    else if(line[i]===','&&!q){r.push(c.trim());c=''}
    else c+=line[i]
  }
  r.push(c.trim()); return r
}
function CSVPreview({ text }) {
  if (!text) return <div style={{ color:'var(--text-2)',padding:12,fontSize:13 }}>Empty CSV.</div>
  const lines = text.trim().split('\n').filter(Boolean)
  const headers = parseLine(lines[0])
  const rows = lines.slice(1,11).map(parseLine)
  return (
    <div style={{ overflowX:'auto', padding:12 }}>
      <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
        <thead><tr>{headers.map((h,i)=><th key={i} style={{ border:'1px solid var(--border)', padding:'5px 10px', background:'var(--bg-card)', textAlign:'left', fontWeight:600 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row,ri)=><tr key={ri}>{row.map((cell,ci)=><td key={ci} style={{ border:'1px solid var(--border)', padding:'5px 10px' }}>{cell}</td>)}</tr>)}</tbody>
      </table>
      {lines.length > 11 && <div style={{ fontSize:11, color:'var(--text-2)', marginTop:6 }}>Showing 10 of {lines.length-1} rows</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HTML preview
// ---------------------------------------------------------------------------
function HTMLPreview({ content }) {
  const wrap = (html) => {
    if (/^\s*<!DOCTYPE/i.test(html)||/^\s*<html/i.test(html)) return html
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#1e293b}</style></head><body>${html}</body></html>`
  }
  return <iframe srcDoc={wrap(content)} style={{ width:'100%', height:300, border:'none' }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" title="HTML preview" />
}

// ---------------------------------------------------------------------------
// Content preview dispatcher
// ---------------------------------------------------------------------------
function ContentPreview({ contentType, content }) {
  if (!content) return <div style={{ color:'var(--text-2)', fontSize:13, padding:'20px', textAlign:'center' }}>No content to preview.</div>
  if (contentType === 'html') return <HTMLPreview content={content} />
  if (contentType === 'csv') return <CSVPreview text={content} />
  if (contentType === 'text') return <pre style={{ margin:0, padding:12, fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.6 }}>{content}</pre>
  return (
    <div style={{ padding:'12px 16px', lineHeight:1.7, fontSize:14, color:'var(--text-1)' }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
  )
}

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g,'').replace(/[\s_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'page'
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
function Badge({ label, color }) {
  const map = {
    published:{ bg:'#d1fae5', text:'#065f46' },
    draft:    { bg:'#f3f4f6', text:'#6b7280' },
    markdown: { bg:'#ede9fe', text:'#5b21b6' },
    html:     { bg:'#fef3c7', text:'#92400e' },
    csv:      { bg:'#d1fae5', text:'#065f46' },
    text:     { bg:'#e0f2fe', text:'#0369a1' },
  }
  const c = map[color] || { bg:'var(--bg-card)', text:'var(--text-2)' }
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600, background:c.bg, color:c.text, textTransform:'capitalize' }}>{label}</span>
}

// ---------------------------------------------------------------------------
// Flag emoji helper
// ---------------------------------------------------------------------------
function flagEmoji(code) {
  if (!code || code.length < 2) return ''
  try {
    return code.slice(0,2).toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('')
  } catch { return '' }
}

// ---------------------------------------------------------------------------
// Export analytics CSV
// ---------------------------------------------------------------------------
function exportAnalyticsCSV(items, pageTitle) {
  const headers = ['Time','IP','Country','CountryCode','Region','City','ZIP','Lat','Lon','ISP','Org','AS','Platform','TouchScreen','Screen','Viewport','PixelRatio','ColorDepth','Language','Timezone','Browser','ConnectionType','Downlink','Referer','PageURL','UTM_Source','UTM_Medium','UTM_Campaign']
  const fmtBrowser = (ua) => {
    if (!ua) return ''
    const m = /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Android/i.test(ua) ? 'Android' : ''
    const b = /EdgA?\/|Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /SamsungBrowser/i.test(ua) ? 'Samsung' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : ''
    return [m,b].filter(Boolean).join(' ')
  }
  const esc = v => v == null ? '' : `"${String(v).replace(/"/g,'""')}"`
  const rows = items.map(v => {
    const geo = v.metadata?.geo || {}
    const cli = v.metadata?.client || {}
    return [
      v.viewed_at ? new Date(v.viewed_at).toISOString() : '',
      v.viewer_ip, v.country, geo.country_code, geo.region||v.region, v.city, geo.zip,
      geo.lat, geo.lon, v.isp, geo.org, geo.as,
      cli.platform, cli.touch_support != null ? (cli.touch_support ? 'Yes' : 'No') : '',
      cli.screen_width ? `${cli.screen_width}x${cli.screen_height}` : '',
      cli.viewport_width ? `${cli.viewport_width}x${cli.viewport_height}` : '',
      cli.pixel_ratio, cli.color_depth,
      cli.language, cli.timezone || geo.timezone,
      fmtBrowser(v.user_agent),
      cli.connection_type, cli.connection_downlink,
      v.referer, cli.page_url, cli.utm_source, cli.utm_medium, cli.utm_campaign,
    ].map(esc).join(',')
  })
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type:'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `analytics-${pageTitle || 'page'}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Sparkline — views by day (last 14 days)
// ---------------------------------------------------------------------------
function ViewSparkline({ items }) {
  if (!items?.length) return null
  const now = new Date()
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (13 - i))
    return d.toISOString().slice(0, 10)
  })
  const counts = {}
  items.forEach(v => {
    const day = v.viewed_at?.slice(0, 10)
    if (day) counts[day] = (counts[day] || 0) + 1
  })
  const vals = days.map(d => counts[d] || 0)
  const max = Math.max(...vals, 1)
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:11, color:'var(--text-2)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Views — last 14 days</div>
      <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:40 }}>
        {vals.map((v, i) => (
          <div key={i} title={`${days[i]}: ${v} view${v!==1?'s':''}`} style={{ flex:1, minWidth:8, borderRadius:3, background: v > 0 ? 'var(--accent)' : 'var(--border)', height:`${Math.max(4, (v/max)*40)}px`, opacity: v > 0 ? 0.85 : 0.3, transition:'height 0.2s' }} />
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--text-2)', marginTop:3 }}>
        <span>{days[0].slice(5)}</span>
        <span>{days[6].slice(5)}</span>
        <span>{days[13].slice(5)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function DetailGrid({ geo, cli, v, isMobile }) {
  const rows = [
    { section:'Network', label:'IP Address',      value: v.viewer_ip },
    { section:'Network', label:'ISP',             value: v.isp },
    { section:'Network', label:'Organisation',    value: geo.org },
    { section:'Network', label:'AS Number',       value: geo.as },
    { section:'Network', label:'Connection Type', value: cli.connection_type },
    { section:'Network', label:'Downlink',        value: cli.connection_downlink != null ? `${cli.connection_downlink} Mbps` : null },
    { section:'Location (IP-based)', label:'Country',       value: geo.country ? `${flagEmoji(geo.country_code || geo.country)} ${geo.country}` : null },
    { section:'Location (IP-based)', label:'Country Code',  value: geo.country_code },
    { section:'Location (IP-based)', label:'Region',        value: geo.region },
    { section:'Location (IP-based)', label:'City',          value: geo.city },
    { section:'Location (IP-based)', label:'ZIP / Postcode',value: geo.zip },
    { section:'Location (IP-based)', label:'Latitude',      value: geo.lat != null ? String(geo.lat) : null },
    { section:'Location (IP-based)', label:'Longitude',     value: geo.lon != null ? String(geo.lon) : null },
    { section:'Location (IP-based)', label:'Timezone (IP)', value: geo.timezone },
    { section:'Device & Browser', label:'Platform / OS',       value: cli.platform },
    { section:'Device & Browser', label:'Touch Screen',         value: cli.touch_support != null ? (cli.touch_support ? 'Yes' : 'No') : null },
    { section:'Device & Browser', label:'Screen',               value: cli.screen_width ? `${cli.screen_width} × ${cli.screen_height}` : null },
    { section:'Device & Browser', label:'Viewport',             value: cli.viewport_width ? `${cli.viewport_width} × ${cli.viewport_height}` : null },
    { section:'Device & Browser', label:'Pixel Ratio',          value: cli.pixel_ratio != null ? `${cli.pixel_ratio}x` : null },
    { section:'Device & Browser', label:'Color Depth',          value: cli.color_depth != null ? `${cli.color_depth}-bit` : null },
    { section:'Device & Browser', label:'Language',             value: cli.language },
    { section:'Device & Browser', label:'All Languages',        value: cli.languages?.join(', ') },
    { section:'Device & Browser', label:'Timezone (Browser)',   value: cli.timezone },
    { section:'Device & Browser', label:'Cookies Enabled',      value: cli.cookie_enabled != null ? (cli.cookie_enabled ? 'Yes' : 'No') : null },
    { section:'Device & Browser', label:'Do Not Track',         value: cli.do_not_track },
    { section:'Device & Browser', label:'User Agent',           value: v.user_agent },
    { section:'Visit', label:'Viewed At',    value: v.viewed_at ? new Date(v.viewed_at).toLocaleString() : null },
    { section:'Visit', label:'Page URL',     value: cli.page_url },
    { section:'Visit', label:'Referer',      value: v.referer },
    { section:'Visit', label:'UTM Source',   value: cli.utm_source },
    { section:'Visit', label:'UTM Medium',   value: cli.utm_medium },
    { section:'Visit', label:'UTM Campaign', value: cli.utm_campaign },
  ].filter(r => r.value)

  const sections = [...new Set(rows.map(r => r.section))]
  const cols = isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))'

  return (
    <div style={{ display:'grid', gridTemplateColumns:cols, gap:16 }}>
      {sections.map(sec => (
        <div key={sec}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--accent)', marginBottom:8 }}>{sec}</div>
          {rows.filter(r => r.section === sec).map(r => (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'3px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
              <span style={{ color:'var(--text-2)', whiteSpace:'nowrap', flexShrink:0 }}>{r.label}</span>
              <span style={{ color:'var(--text-1)', fontFamily: r.label==='User Agent'||r.label==='IP Address'?'monospace':'inherit', fontSize: r.label==='User Agent'?10:12, textAlign:'right', wordBreak:'break-all' }}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
      {geo.lat && geo.lon && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--accent)', marginBottom:8 }}>Map</div>
          <div style={{ fontSize:11, color:'var(--text-2)', marginBottom:6, wordBreak:'break-all', fontFamily:'monospace' }}>
            {`https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}&zoom=14`}
          </div>
          <a href={`https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}&zoom=14`}
            target="_blank" rel="noopener noreferrer"
            style={{ display:'inline-block', fontSize:12, color:'var(--accent)', textDecoration:'none', border:'1px solid var(--border)', borderRadius:6, padding:'5px 10px' }}>
            📍 {geo.lat.toFixed(4)}, {geo.lon.toFixed(4)} — Open in map ↗
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

  const handleDeleteView = async (e, viewId) => {
    e.stopPropagation()
    if (!window.confirm('Delete this view record?')) return
    setDeletingId(viewId)
    try {
      await api.pages.deleteView(page.id, viewId)
      setData(prev => ({ ...prev, total: prev.total - 1, items: prev.items.filter(v => v.id !== viewId) }))
      if (expandedRow === viewId) setExpandedRow(null)
    } catch { /* ignore */ }
    finally { setDeletingId(null) }
  }

  useEffect(() => {
    if (!page) return
    setLoading(true)
    api.pages.analytics(page.id, { limit, offset: 0 })
      .then(d => setData(d))
      .catch(() => setData({ items: [], total: 0 }))
      .finally(() => setLoading(false))
  }, [page?.id, limit])

  if (!page) return null

  const fmtBrowser = (ua) => {
    if (!ua) return '—'
    const mobile = /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Android/i.test(ua) ? 'Android' : ''
    const browser = /EdgA?\/|Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /SamsungBrowser/i.test(ua) ? 'Samsung' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : /curl|python|go-http/i.test(ua) ? 'Bot' : ''
    return [mobile, browser].filter(Boolean).join(' · ') || ua.slice(0, 28)
  }

  const fmtReferer = (ref) => {
    if (!ref) return '—'
    try { return new URL(ref).hostname } catch { return ref.slice(0,30) }
  }

  // Mobile: show only key columns
  const mobileCols = ['Time', 'Location', 'Device', '']
  const desktopCols = ['Time', 'IP Address', 'Location', 'ISP / Network', 'Device', 'Browser', 'Screen', 'Timezone', 'Language', 'Referer', '']

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width: isMobile ? '100vw' : '96vw', maxWidth:1200, height:'100%', background:'var(--bg-base)', overflowY:'auto', boxShadow:'-4px 0 40px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: isMobile ? '16px' : '20px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexShrink:0 }}>
          <div>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight:700 }}>Page Analytics & Viewer Audit</div>
            <div style={{ fontSize:13, color:'var(--text-2)', marginTop:3 }}>{page.title}</div>
            <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug}</a>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            {data?.items?.length > 0 && (
              <button onClick={() => exportAnalyticsCSV(data.items, page.title)} style={{ ...btnSecondary, fontSize:11, padding:'5px 10px' }}>
                ↓ Export CSV
              </button>
            )}
            <button onClick={onClose} style={{ ...btnGhost, fontSize:18, padding:'4px 10px' }}>✕</button>
          </div>
        </div>

        {/* Stats bar */}
        {data && (
          <div style={{ padding: isMobile ? '12px 16px' : '14px 24px', borderBottom:'1px solid var(--border)', display:'flex', gap: isMobile ? 16 : 28, flexWrap:'wrap', flexShrink:0, background:'var(--bg-card)', overflowX:'auto' }}>
            <Stat label="Total Views"      value={data.total} />
            <Stat label="Unique IPs"       value={new Set(data.items?.map(v=>v.viewer_ip).filter(Boolean)).size} />
            <Stat label="Countries"        value={new Set(data.items?.map(v=>v.country).filter(Boolean)).size} />
            {!isMobile && <Stat label="Unique Timezones" value={new Set(data.items?.map(v=>v.metadata?.client?.timezone).filter(Boolean)).size} />}
            <Stat label="Mobile"           value={data.items?.filter(v=>v.metadata?.client?.touch_support===true).length ?? 0} />
            <Stat label="Desktop"          value={data.items?.filter(v=>v.metadata?.client?.touch_support===false).length ?? 0} />
            {data.items?.length > 0 && <Stat label="Last View" value={new Date(data.items[0].viewed_at).toLocaleDateString()} />}
          </div>
        )}

        {/* Content */}
        <div style={{ flex:1, padding: isMobile ? '12px 16px' : '16px 24px', overflow:'auto' }}>
          {loading ? (
            <div style={{ color:'var(--text-2)', fontSize:14, padding:40, textAlign:'center' }}>Loading…</div>
          ) : !data?.items?.length ? (
            <div style={{ color:'var(--text-2)', fontSize:14, padding:'60px 0', textAlign:'center' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>👁</div>
              No views recorded yet. Share the link to start tracking.
            </div>
          ) : (
            <>
              {/* Sparkline */}
              <ViewSparkline items={data.items} />

              <div style={{ fontSize:13, color:'var(--text-2)', marginBottom:12 }}>
                Showing {data.items.length} of {data.total} view{data.total !== 1 ? 's' : ''} — <span style={{ color:'var(--accent)' }}>tap any row for full details</span>
              </div>

              {isMobile ? (
                /* Mobile: card list */
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {data.items.map((v, i) => {
                    const geo = v.metadata?.geo || {}
                    const cli = v.metadata?.client || {}
                    const expanded = expandedRow === v.id
                    return (
                      <div key={v.id} style={{ background:'var(--bg-card)', border:`1px solid ${expanded ? 'var(--accent)' : 'var(--border)'}`, borderRadius:10, overflow:'hidden' }}>
                        <div onClick={() => setExpandedRow(expanded ? null : v.id)} style={{ padding:'12px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-1)' }}>
                              {v.country ? <>{flagEmoji(geo.country_code || v.country)} {v.city || v.country}</> : v.viewer_ip || '—'}
                            </div>
                            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>
                              {new Date(v.viewed_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                            </div>
                            <div style={{ fontSize:11, color:'var(--text-2)', marginTop:1 }}>
                              {cli.touch_support === true ? '📱 ' : cli.touch_support === false ? '🖥️ ' : ''}{fmtBrowser(v.user_agent)}
                            </div>
                          </div>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <button onClick={e => handleDeleteView(e, v.id)} disabled={deletingId===v.id}
                              style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                              {deletingId===v.id ? '…' : 'Del'}
                            </button>
                            <span style={{ color:'var(--text-2)', fontSize:14 }}>{expanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {expanded && (
                          <div style={{ padding:'12px 14px', borderTop:'1px solid var(--border)' }}>
                            <DetailGrid geo={geo} cli={cli} v={v} isMobile={true} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                /* Desktop: table */
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'2px solid var(--border)', background:'var(--bg-card)', position:'sticky', top:0, zIndex:2 }}>
                        {desktopCols.map(h => (
                          <th key={h} style={{ padding:'9px 12px', textAlign:'left', color:'var(--text-2)', fontWeight:700, whiteSpace:'nowrap', fontSize:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((v, i) => {
                        const geo = v.metadata?.geo || {}
                        const cli = v.metadata?.client || {}
                        const expanded = expandedRow === v.id
                        return [
                          <tr key={v.id} onClick={() => setExpandedRow(expanded ? null : v.id)}
                            style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)', background: expanded ? 'var(--bg-card)' : i%2 ? 'var(--bg-card)' : 'var(--bg-base)', cursor:'pointer' }}>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }}>
                              {new Date(v.viewed_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                            </td>
                            <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:'var(--text-1)' }}>{v.viewer_ip || '—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', fontSize:12 }}>
                              {v.country ? <>{flagEmoji(geo.country_code || v.country)} {v.city ? `${v.city}, ` : ''}{geo.country_code || v.country}</> : '—'}
                            </td>
                            <td style={{ padding:'9px 12px', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }} title={v.isp}>{v.isp || '—'}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', fontSize:12 }}>
                              {cli.touch_support === true ? '📱 ' : cli.touch_support === false ? '🖥️ ' : ''}{cli.platform || '—'}
                            </td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', fontSize:12 }} title={v.user_agent}>{fmtBrowser(v.user_agent)}</td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }}>
                              {cli.screen_width ? `${cli.screen_width}×${cli.screen_height}` : '—'}
                              {cli.pixel_ratio > 1 ? <span style={{ color:'var(--accent)', marginLeft:3, fontSize:10 }}>@{cli.pixel_ratio}x</span> : ''}
                            </td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis' }}>
                              {cli.timezone || geo.timezone || '—'}
                            </td>
                            <td style={{ padding:'9px 12px', whiteSpace:'nowrap', fontSize:11 }}>{cli.language || '—'}</td>
                            <td style={{ padding:'9px 12px', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:11 }} title={v.referer}>{fmtReferer(v.referer)}</td>
                            <td style={{ padding:'9px 8px', whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                              <button onClick={e => handleDeleteView(e, v.id)} disabled={deletingId===v.id}
                                title="Delete this view record"
                                style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'3px 8px', fontSize:11, fontWeight:600, cursor:'pointer', opacity: deletingId===v.id ? 0.5 : 1 }}>
                                {deletingId===v.id ? '…' : 'Delete'}
                              </button>
                            </td>
                          </tr>,
                          expanded && (
                            <tr key={`${v.id}-exp`} style={{ background:'var(--bg-card)', borderBottom:'2px solid var(--accent)', borderLeft:'3px solid var(--accent)' }}>
                              <td colSpan={11} style={{ padding:'20px 24px' }}>
                                <DetailGrid geo={geo} cli={cli} v={v} isMobile={false} />
                              </td>
                            </tr>
                          )
                        ]
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {data.total > limit && (
                <button onClick={() => setLimit(l => l + 50)} style={{ ...btnSecondary, marginTop:16, fontSize:12, width: isMobile ? '100%' : 'auto' }}>
                  Load more ({data.total - limit} remaining)
                </button>
              )}
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

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      onCopy?.()
    })
  }

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
          <span style={{ flex:1, fontSize:12, fontFamily:'monospace', color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{url}</span>
          <button onClick={copy} style={{ ...btnPrimary, padding:'5px 12px', fontSize:12, whiteSpace:'nowrap', flexShrink:0 }}>
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>

        <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer"
          style={{ display:'block', textAlign:'center', fontSize:13, color:'var(--accent)', textDecoration:'none', padding:'8px', border:'1px solid var(--border)', borderRadius:8 }}>
          Open page ↗
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page Drawer — Create / Edit
// ---------------------------------------------------------------------------
const CONTENT_TYPES = [
  { value:'markdown', label:'Markdown' },
  { value:'html',     label:'HTML / CSS / JS' },
  { value:'csv',      label:'CSV Table' },
  { value:'text',     label:'Plain Text' },
]

function PageDrawer({ page, onClose, onSaved }) {
  const isMobile = useIsMobile()
  const isEdit = !!page?.id
  const [form, setForm] = useState({
    title:                page?.title || '',
    content_type:         page?.content_type || 'markdown',
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

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!slugManual && form.title) set('slug', slugify(form.title))
  }, [form.title, slugManual])

  const handleSave = async (publish = false) => {
    if (!form.title.trim()) { setError('Title is required'); return }
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
      let saved = isEdit
        ? await api.pages.update(page.id, payload)
        : await api.pages.create(payload)
      if (saved?.detail || saved?.error) throw new Error(saved.detail || saved.error)
      if (publish && !saved.is_published) saved = await api.pages.publish(saved.id, true)
      onSaved(saved)
    } catch (e) {
      setError(e?.message || 'Failed to save.')
    } finally { setSaving(false) }
  }

  const shareUrl = form.slug ? `${window.location.origin}/p/${form.slug}` : ''

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.45)', display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width: isMobile ? '100vw' : '94vw', maxWidth:1100, height:'100%', background:'var(--bg-base)', overflowY:'auto', boxShadow:'-4px 0 32px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column' }} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: isMobile ? '12px 16px' : '16px 24px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, flexShrink:0 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>{isEdit ? 'Edit Page' : 'New Page'}</div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {error && <span style={{ color:'#ef4444', fontSize:12, maxWidth:220 }}>{error}</span>}
            <button onClick={onClose} style={btnGhost} disabled={saving}>Cancel</button>
            <button onClick={() => handleSave(false)} style={btnSecondary} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
            <button onClick={() => handleSave(true)} style={btnPrimary} disabled={saving}>
              {saving ? 'Publishing…' : isEdit && page?.is_published ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>

        {/* Meta fields */}
        <div style={{ padding: isMobile ? '12px 16px' : '14px 24px', borderBottom:'1px solid var(--border)', display:'flex', gap:12, flexWrap:'wrap', flexShrink:0 }}>
          <div style={{ flex:'2 1 180px' }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} placeholder="Page title" value={form.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div style={{ flex:'1 1 130px' }}>
            <label style={labelStyle}>Content Type</label>
            <select style={inputStyle} value={form.content_type} onChange={e => set('content_type', e.target.value)}>
              {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex:'2 1 160px' }}>
            <label style={labelStyle}>Slug (URL path)</label>
            <input style={{ ...inputStyle, fontFamily:'monospace', fontSize:12 }} placeholder="custom-slug"
              value={form.slug}
              onChange={e => { setSlugManual(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'').replace(/--+/g,'-')) }}
            />
            {shareUrl && <div style={{ fontSize:10, color:'var(--accent)', marginTop:3, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{shareUrl}</div>}
          </div>
          <div style={{ flex:'2 1 160px' }}>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} placeholder="For link previews" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div style={{ flex:'0 0 auto', display:'flex', alignItems:'flex-end', gap:10, paddingBottom:1 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
              <input type="checkbox" checked={form.is_password_protected} onChange={e => set('is_password_protected', e.target.checked)} />
              Password protect
            </label>
            {form.is_password_protected && (
              <input style={{ ...inputStyle, width:130 }} type="password" placeholder="Set password" value={form.password} onChange={e => set('password', e.target.value)} />
            )}
          </div>
        </div>

        {/* Edit / Preview tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:`0 ${isMobile ? '16px' : '24px'}`, flexShrink:0 }}>
          {['edit','preview'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:tab===t?'var(--accent)':'var(--text-2)', borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent', textTransform:'capitalize', marginBottom:-1 }}>{t}</button>
          ))}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', paddingRight:4 }}>
            <span style={{ fontSize:11, color:'var(--text-2)', fontFamily:'monospace' }}>{form.content.length.toLocaleString()} chars</span>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {tab === 'edit' ? (
            <textarea
              style={{ flex:1, width:'100%', padding: isMobile ? '12px 16px' : '16px 24px', fontFamily:form.content_type==='markdown'?'inherit':'ui-monospace,monospace', fontSize:13, lineHeight:1.65, background:'var(--bg-card)', color:'var(--text-1)', border:'none', outline:'none', resize:'none', boxSizing:'border-box' }}
              placeholder={placeholders[form.content_type]}
              value={form.content}
              onChange={e => set('content', e.target.value)}
              spellCheck={form.content_type === 'markdown'}
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

const placeholders = {
  markdown: '# Hello World\n\nWrite your **markdown** here.\n\n- Lists\n- Code blocks\n- Tables',
  html: '<!DOCTYPE html>\n<html>\n<head><style>body{font-family:sans-serif}</style></head>\n<body>\n  <h1>Hello</h1>\n</body></html>',
  csv: 'Name,Value,Notes\nRow 1,100,First entry\nRow 2,200,Second entry',
  text: 'Paste your plain text content here…',
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onCancel}>
      <div style={{ background:'var(--bg-base)', borderRadius:'var(--radius)', padding:28, maxWidth:380, width:'100%', boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>Confirm deletion</div>
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
// Page Card — mobile view
// ---------------------------------------------------------------------------
function PageCard({ page, onEdit, onPublish, onShare, onAnalytics, onDelete }) {
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:16, display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>
            {page.title || 'Untitled'}
            {page.is_password_protected && <span style={{ marginLeft:6, fontSize:11 }}>🔒</span>}
          </div>
          {page.is_published
            ? <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug} ↗</a>
            : <span style={{ fontSize:11, color:'var(--text-2)', fontFamily:'monospace' }}>/p/{page.slug}</span>
          }
        </div>
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          <Badge label={page.content_type} color={page.content_type} />
          <Badge label={page.is_published ? 'Published' : 'Draft'} color={page.is_published ? 'published' : 'draft'} />
        </div>
      </div>

      <button onClick={() => onAnalytics(page)} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 12px', cursor:'pointer', fontSize:12, fontWeight:600, color:'var(--text-1)', textAlign:'left' }}>
        <span>👁</span>
        <span>{page.view_count ?? 0} view{page.view_count !== 1 ? 's' : ''}</span>
        <span style={{ color:'var(--accent)', fontSize:11, marginLeft:'auto' }}>Audit →</span>
      </button>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button style={btnTiny} onClick={() => onEdit(page)}>Edit</button>
        <button style={{ ...btnTiny, background:page.is_published?'#fef3c7':'#d1fae5', color:page.is_published?'#92400e':'#065f46', border:'none' }} onClick={() => onPublish(page)}>
          {page.is_published ? 'Unpublish' : 'Publish'}
        </button>
        {page.is_published && <button style={btnTiny} onClick={() => onShare(page)}>Share ↗</button>}
        <button style={{ ...btnTiny, background:'#fef2f2', color:'#991b1b', border:'none' }} onClick={() => onDelete(page)}>Delete</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
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

  const showToast = (msg, ok=true) => { setToast({ msg, ok }); setTimeout(() => setToast({ msg:'', ok:true }), 3500) }

  const loadPages = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await api.pages.list()
      if (data?.detail) throw new Error(data.detail)
      setPages(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message || 'Failed to load pages')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPages() }, [loadPages])

  const handleSaved = (saved) => {
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === saved.id)
      if (idx >= 0) { const next=[...prev]; next[idx]=saved; return next }
      return [saved, ...prev]
    })
    setDrawerPage(null)
    showToast('Page saved successfully')
  }

  const handlePublishToggle = async (page) => {
    try {
      const updated = await api.pages.publish(page.id, !page.is_published)
      if (updated?.detail) throw new Error(updated.detail)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      showToast(updated.is_published ? '✓ Published — link is now live' : 'Unpublished')
    } catch (e) { showToast(e?.message || 'Failed to update', false) }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await api.pages.delete(confirmDelete.id)
      setPages(prev => prev.filter(p => p.id !== confirmDelete.id))
      showToast('Page deleted')
    } catch { showToast('Failed to delete', false) }
    finally { setConfirmDelete(null) }
  }

  const handleClone = async (page) => {
    setCloning(page.id)
    try {
      const full = await api.pages.get(page.id)
      const payload = {
        title:        `${full.title} (Copy)`,
        content_type: full.content_type,
        content:      full.content,
        slug:         slugify(`${full.title}-copy-${Date.now().toString(36)}`),
        metadata:     full.metadata || {},
      }
      const created = await api.pages.create(payload)
      if (created?.detail || created?.error) throw new Error(created.detail || created.error)
      setPages(prev => [created, ...prev])
      showToast('Page cloned — edit and publish when ready')
    } catch (e) { showToast(e?.message || 'Clone failed', false) }
    finally { setCloning(null) }
  }

  const openEdit = async (page) => {
    try { setDrawerPage(await api.pages.get(page.id)) }
    catch { setDrawerPage(page) }
  }

  // Filter + search
  const filtered = pages.filter(p => {
    const matchTab = filterTab === 'all' || (filterTab === 'published' && p.is_published) || (filterTab === 'drafts' && !p.is_published)
    const q = search.toLowerCase()
    const matchSearch = !q || p.title?.toLowerCase().includes(q) || p.slug?.toLowerCase().includes(q)
    return matchTab && matchSearch
  })

  const totalViews = pages.reduce((s, p) => s + (p.view_count || 0), 0)

  return (
    <div style={{ padding: isMobile ? '16px' : '24px 28px', maxWidth:1200, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:12, flexWrap:'wrap' }}>
        <div>
          <h1 style={{ margin:0, fontSize: isMobile ? 18 : 22, fontWeight:700 }}>Published Pages</h1>
          {!isMobile && <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--text-2)' }}>Create, publish and share content pages with a public URL. Track every view.</p>}
        </div>
        <button style={btnPrimary} onClick={() => setDrawerPage({})}>+ New Page</button>
      </div>

      {/* Summary stats */}
      {pages.length > 0 && (
        <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
          {[
            { label:'Total Pages', value:pages.length },
            { label:'Published',   value:pages.filter(p=>p.is_published).length },
            { label:'Drafts',      value:pages.filter(p=>!p.is_published).length },
            { label:'Total Views', value:totalViews.toLocaleString() },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding: isMobile ? '10px 14px' : '12px 20px', minWidth:90 }}>
              <div style={{ fontSize: isMobile ? 18 : 20, fontWeight:800, color:'var(--text-1)' }}>{s.value}</div>
              <div style={{ fontSize:10, color:'var(--text-2)', marginTop:2, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter tabs */}
      {pages.length > 0 && (
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <input
            style={{ ...inputStyle, maxWidth: isMobile ? '100%' : 260, padding:'8px 12px' }}
            placeholder="Search by title or slug…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display:'flex', gap:2, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:2 }}>
            {[['all','All'], ['published','Published'], ['drafts','Drafts']].map(([val, label]) => (
              <button key={val} onClick={() => setFilterTab(val)}
                style={{ padding:'5px 12px', borderRadius:6, border:'none', fontSize:12, fontWeight:600, cursor:'pointer',
                  background: filterTab===val ? 'var(--accent)' : 'transparent',
                  color: filterTab===val ? '#fff' : 'var(--text-2)' }}>
                {label}
              </button>
            ))}
          </div>
          {(search || filterTab !== 'all') && (
            <button onClick={() => { setSearch(''); setFilterTab('all') }} style={{ ...btnGhost, fontSize:12, padding:'5px 10px' }}>Clear</button>
          )}
        </div>
      )}

      {error && <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'var(--radius)', padding:'10px 14px', fontSize:13, color:'#991b1b', marginBottom:16 }}>{error}</div>}

      {loading ? (
        <div style={{ color:'var(--text-2)', fontSize:14, padding:60, textAlign:'center' }}>Loading…</div>
      ) : !pages.length ? (
        <div style={{ textAlign:'center', padding:'60px 20px', border:'2px dashed var(--border)', borderRadius:'var(--radius)', color:'var(--text-2)' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
          <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>No pages yet</div>
          <div style={{ fontSize:13, marginBottom:20 }}>Create your first page to share content with anyone via a public link.</div>
          <button style={btnPrimary} onClick={() => setDrawerPage({})}>+ Create First Page</button>
        </div>
      ) : !filtered.length ? (
        <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--text-2)' }}>
          <div style={{ fontSize:30, marginBottom:10 }}>🔍</div>
          <div style={{ fontSize:14 }}>No pages match your search.</div>
          <button onClick={() => { setSearch(''); setFilterTab('all') }} style={{ ...btnGhost, marginTop:12 }}>Clear filters</button>
        </div>
      ) : isMobile ? (
        /* Mobile: cards */
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(page => (
            <PageCard key={page.id} page={page}
              onEdit={openEdit}
              onPublish={handlePublishToggle}
              onShare={setSharePage}
              onAnalytics={setAnalyticsPage}
              onDelete={setConfirmDelete}
            />
          ))}
        </div>
      ) : (
        /* Desktop: table */
        <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--bg-card)', borderBottom:'1px solid var(--border)' }}>
                {['Title / URL', 'Type', 'Status', 'Views & Analytics', 'Created', 'Actions'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:600, color:'var(--text-2)', whiteSpace:'nowrap', fontSize:11, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((page, idx) => (
                <tr key={page.id} style={{ borderBottom:idx<filtered.length-1?'1px solid var(--border)':'none', background:'var(--bg-base)' }}>
                  <td style={{ padding:'12px 14px', maxWidth:260 }}>
                    <div style={{ fontWeight:600, marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {page.title || <span style={{ color:'var(--text-2)' }}>Untitled</span>}
                      {page.is_password_protected && <span style={{ marginLeft:6, fontSize:11 }} title="Password protected">🔒</span>}
                    </div>
                    {page.is_published
                      ? <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:'var(--accent)', fontFamily:'monospace', textDecoration:'none' }}>/p/{page.slug} ↗</a>
                      : <span style={{ fontSize:11, color:'var(--text-2)', fontFamily:'monospace' }}>/p/{page.slug}</span>
                    }
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <Badge label={page.content_type} color={page.content_type} />
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <Badge label={page.is_published ? 'Published' : 'Draft'} color={page.is_published ? 'published' : 'draft'} />
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <button onClick={() => setAnalyticsPage(page)}
                      title="View audit log"
                      style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 10px', cursor:'pointer', fontSize:12, fontWeight:600, color:'var(--text-1)' }}>
                      <span>👁</span>
                      <span>{page.view_count ?? 0} view{page.view_count !== 1 ? 's' : ''}</span>
                      <span style={{ color:'var(--accent)', fontSize:11 }}>Audit →</span>
                    </button>
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap', color:'var(--text-2)', fontSize:12 }}>
                    {page.created_at ? new Date(page.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                  </td>
                  <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      <button style={btnTiny} onClick={() => openEdit(page)}>Edit</button>
                      <button style={{ ...btnTiny, background:page.is_published?'#fef3c7':'#d1fae5', color:page.is_published?'#92400e':'#065f46', border:'none' }}
                        onClick={() => handlePublishToggle(page)}>
                        {page.is_published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button style={btnTiny} onClick={() => handleClone(page)} disabled={cloning===page.id}>
                        {cloning===page.id ? '…' : 'Clone'}
                      </button>
                      {page.is_published && (
                        <button style={{ ...btnTiny, background:'#eff6ff', color:'#1d4ed8', border:'none' }} onClick={() => setSharePage(page)}>Share ↗</button>
                      )}
                      <button style={{ ...btnTiny, background:'#fef2f2', color:'#991b1b', border:'none' }} onClick={() => setConfirmDelete(page)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerPage !== null && (
        <PageDrawer page={drawerPage?.id ? drawerPage : null} onClose={() => setDrawerPage(null)} onSaved={handleSaved} />
      )}
      {analyticsPage && <AnalyticsDrawer page={analyticsPage} onClose={() => setAnalyticsPage(null)} />}
      {sharePage && <ShareModal page={sharePage} onClose={() => setSharePage(null)} onCopy={() => showToast('🔗 Link copied!')} />}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.title}"? All view history will also be deleted. This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast.msg && (
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
const labelStyle = { display:'block', fontSize:11, fontWeight:600, color:'var(--text-2)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }
const btnBase = { border:'none', borderRadius:'var(--radius)', padding:'8px 16px', fontSize:13, fontWeight:600, cursor:'pointer' }
const btnPrimary = { ...btnBase, background:'var(--accent)', color:'#fff' }
const btnSecondary = { ...btnBase, background:'var(--bg-card)', color:'var(--text-1)', border:'1px solid var(--border)' }
const btnGhost = { ...btnBase, background:'transparent', color:'var(--text-2)', padding:'7px 12px' }
const btnTiny = { ...btnBase, padding:'4px 10px', fontSize:12, background:'var(--bg-card)', color:'var(--text-1)', border:'1px solid var(--border)' }
