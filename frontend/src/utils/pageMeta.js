/**
 * Route → page title and description.
 *
 * Kept in one table rather than scattered across the page components: these are
 * the strings that show up in tabs, bookmarks and browser history, and they read
 * better when they can be seen next to each other.
 *
 * Pages whose title depends on loaded data (a project name, a shared view's
 * title) call usePageMeta directly and override the entry here once their data
 * arrives. Order matters — the first matching pattern wins, so more specific
 * paths are listed before the ones that would also match them.
 */
export const BRAND = 'FinTrack'

// Title first, brand last: a browser tab truncates from the right, so the part
// that distinguishes one tab from another has to lead.
export const titleFor = (page) => (page ? `${page} — ${BRAND}` : `${BRAND} — AI Project Finance Manager`)

const ROUTES = [
  ['/projects/:id', 'Project',       'Project billing, budget and delivery detail.'],
  ['/projects',     'Projects',      'Every project with billing, budget and health at a glance.'],
  ['/invoices',     'Invoices',      'Invoice tracker with aging analysis and payment status.'],
  ['/tax',          'Tax Ledger',    'GST and TDS ledger across raised and cleared invoices.'],
  ['/analytics',    'Analytics',     'Cash flow, DSO and client concentration risk.'],
  ['/ai',           'AI Assistant',  'Ask questions across your full portfolio.'],
  ['/report',       'Report',        'Generate a board pack or a delivery status briefing.'],
  ['/status',       'Status Board',  'Live delivery status across every active project.'],
  ['/admin',        'Admin',         'Users, sessions, permissions and sync health.'],
  ['/pages',        'Pages',         'Publish and share pages with clients.'],
  ['/profile',      'Profile',       'Your account, appearance and session settings.'],
  ['/view/:token',  'Shared view',   'A view shared with you from FinTrack.'],
  // PageViewer replaces both of these with the page's own title and summary
  // once it loads; this is only what the tab reads in the meantime.
  ['/p/:slug',      'Page',          'A page shared with you from FinTrack.'],
  ['/',             'Dashboard',     'Receivables, project health and invoice activity at a glance.'],
]

/** Matches a concrete pathname against the table, honouring `:param` segments. */
export function metaForPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const [pattern, page, description] of ROUTES) {
    if (pattern === '/') {
      if (path === '/') return { title: titleFor(page), description }
      continue
    }
    const p = pattern.split('/').filter(Boolean)
    const a = path.split('/').filter(Boolean)
    if (p.length !== a.length) continue
    if (p.every((seg, i) => seg.startsWith(':') || seg === a[i])) {
      return { title: titleFor(page), description }
    }
  }
  return { title: titleFor('Page not found'), description: null }
}
