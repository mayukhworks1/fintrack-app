import { Link } from 'react-router-dom'

// The public viewer's view of the tree. The server sends only published,
// live pages here (children, and the unbroken run of published parents), so
// these components just lay them out. The breadcrumbs sit right above the
// page title, so they list the parents only.

const linkStyle = { color:'var(--pv-mute)', textDecoration:'none' }

export function PublicBreadcrumbs({ page }) {
  const crumbs = Array.isArray(page?.breadcrumbs) ? page.breadcrumbs : []
  if (!crumbs.length) return null
  return (
    <nav aria-label="Breadcrumb" style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:6, marginBottom:14, fontSize:13, color:'var(--pv-mute)' }}>
      {crumbs.map((c, i) => (
        <span key={c.slug} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
          {i > 0 && <span aria-hidden="true">/</span>}
          <Link to={`/p/${encodeURIComponent(c.slug)}`} style={linkStyle}>
            {c.icon && <span aria-hidden="true" style={{ marginRight:4 }}>{c.icon}</span>}{c.title || 'Untitled'}
          </Link>
        </span>
      ))}
    </nav>
  )
}

export function PublicSubPages({ page }) {
  const kids = Array.isArray(page?.children) ? page.children : []
  if (!kids.length) return null
  return (
    <section aria-label="Sub-pages" style={{ marginTop:48 }}>
      <h2 style={{ fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--pv-mute)', margin:'0 0 12px' }}>Sub-pages</h2>
      <ul style={{ listStyle:'none', margin:0, padding:0, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10 }}>
        {kids.map(k => (
          <li key={k.slug}>
            <Link to={`/p/${encodeURIComponent(k.slug)}`}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', border:'1px solid var(--pv-line)', borderRadius:10, background:'var(--pv-subtle)', color:'var(--pv-ink)', textDecoration:'none', fontSize:14, fontWeight:600 }}>
              <span aria-hidden="true" style={{ fontSize:18, lineHeight:1 }}>{k.icon || '📄'}</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{k.title || 'Untitled'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
