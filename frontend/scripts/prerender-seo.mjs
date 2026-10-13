/**
 * After `vite build`: give every public page its own HTML entry point.
 *
 * The site is a single-page app, so every URL used to be served the same
 * index.html — one title, one description, one share card. Google runs the
 * JavaScript and eventually sees the right title; Bing, LinkedIn, WhatsApp and
 * most other crawlers do not. This writes dist/<route>/index.html for each
 * public route with that page's own title, description, canonical URL, share
 * tags and structured data, plus sitemap.xml. The app itself is unchanged:
 * the same bundle boots from every one of these files.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const { SITE, APP_LD, FAQ_LD, crumbs, graph } = await import('../src/content/publicContent.js')

// Titles lead with what the page is about, brand last: a result is truncated
// from the right, and the words someone searched for should be the ones shown.
export const PAGES = [
  {
    path: '/',
    title: 'FinTrack — Project finance, invoices, GST & TDS on one set of records',
    description: 'Track invoices, receivables and project margin with GST and TDS kept separate. Ageing bands, a live delivery board, and an AI analyst that shows the query behind every figure.',
    ld: graph(APP_LD, FAQ_LD),
    priority: '1.0',
  },
  {
    path: '/features',
    title: 'Features: invoice tracking, project profitability & tax ledger — FinTrack',
    description: 'Eleven modules on one set of records: invoices with ageing bands, projects and margin, GST and TDS ledger, analytics, executive reports, document search and an AI financial query engine.',
    crumb: 'Features',
    priority: '0.9',
  },
  {
    path: '/how-it-works',
    title: 'How it works: no migration, every figure checkable — FinTrack',
    description: 'FinTrack sits on the records your team already keeps, mirrors them into Postgres for speed, and compiles plain-language questions into SQL you can read.',
    crumb: 'How it works',
    priority: '0.8',
  },
  {
    path: '/security',
    title: 'Security & access control: roles, row scoping and audit — FinTrack',
    description: 'Invitation-only access with administrator approval, permissions down to the action, data scoped at the query, and every request recorded in the audit trail.',
    crumb: 'Security & access',
    priority: '0.8',
  },
  {
    path: '/customise',
    title: 'Customise: roles, white-label branding and your own domain — FinTrack',
    description: 'Shape FinTrack to how you work: per-person permissions, brand colours, your own domain and invoice numbering, and modules built for your process.',
    crumb: 'Made yours',
    priority: '0.7',
  },
  {
    path: '/faq',
    title: 'FinTrack FAQ: invoices, GST/TDS, data, AI and pricing questions',
    description: 'Answers about how FinTrack handles invoices, GST and TDS, where your data lives, how the AI analyst works, and what it takes to get started.',
    crumb: 'Questions',
    faq: true,
    priority: '0.7',
  },
  {
    path: '/privacy',
    title: 'Privacy policy — FinTrack',
    description: 'How FinTrack isolates your data, what it records, and why your records are never used to train AI models.',
    crumb: 'Privacy policy',
    priority: '0.3',
  },
  {
    path: '/terms',
    title: 'Terms of service — FinTrack',
    description: 'The terms that govern use of the FinTrack platform.',
    crumb: 'Terms of service',
    priority: '0.3',
  },
]

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\s*/?>`)
  const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

function pageHtml(base, page) {
  const url = SITE + (page.path === '/' ? '/' : page.path)
  let html = base.replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
  html = setMeta(html, 'name', 'description', page.description)
  html = setMeta(html, 'property', 'og:title', page.title)
  html = setMeta(html, 'property', 'og:description', page.description)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'name', 'twitter:title', page.title)
  html = setMeta(html, 'name', 'twitter:description', page.description)
  html = setMeta(html, 'name', 'robots', 'index, follow, max-image-preview:large')
  html = html.replace(/<link rel="canonical"[^>]*>\s*/g, '')
  html = html.replace('</head>', `    <link rel="canonical" href="${url}" />\n  </head>`)
  const ld = page.ld || graph(
    APP_LD,
    ...(page.faq ? [FAQ_LD] : []),
    crumbs([{ name: page.crumb, path: page.path }]),
  )
  html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`)
  return html
}

const base = readFileSync(join(DIST, 'index.html'), 'utf8')
const today = new Date().toISOString().slice(0, 10)

for (const page of PAGES) {
  const html = pageHtml(base, page)
  if (page.path === '/') {
    // The bare index.html also boots the signed-in app at every other URL, so
    // it carries the home page's tags — but is told not to be indexed under
    // those other addresses by robots.txt, not by a meta tag here.
    writeFileSync(join(DIST, 'index.html'), html)
  } else {
    const dir = join(DIST, page.path.slice(1))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), html)
  }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(p => `  <url><loc>${SITE}${p.path === '/' ? '/' : p.path}</loc><lastmod>${today}</lastmod><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`
writeFileSync(join(DIST, 'sitemap.xml'), sitemap)
console.log(`prerender-seo: wrote ${PAGES.length} page entries and sitemap.xml`)
