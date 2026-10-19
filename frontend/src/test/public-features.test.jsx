/**
 * /features and /security: what the pages claim, checked against what the
 * product does.
 *
 * The permission matrix is compared with the seed in backend/app/db/
 * postgres.py (a copy is kept here, and the SQL itself is read when the
 * backend is checked out beside the frontend), the audit sandbox may only
 * show documentation addresses, and the removed claims and generated "3D"
 * media must not come back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import Features, { FEATURES } from '../pages/Features'
import Security from '../pages/Security'
import AuditTrailSandbox from '../components/AuditTrailSandbox'
import TaxFlowSimulator from '../components/TaxFlowSimulator'
import { ROLES, MATRIX } from '../components/features/PermissionMatrix'
import { MODULES } from '../content/publicContent'

vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')

const at = (Page) => render(<MemoryRouter><Page /></MemoryRouter>)

let wide = false
beforeEach(() => {
  wide = false
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 }]) }
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('matchMedia', (q) => ({
    matches: q.includes('prefers-reduced-motion') || (wide && q.includes('min-width')),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

/* The seed, role by role: permission keys granted to each in auth_role_permissions. */
const SEED = {
  superadmin: '*',
  admin: ['module.dashboard.view', 'module.projects.view', 'module.projects.create', 'module.projects.edit',
    'module.invoices.view', 'module.invoices.create', 'module.invoices.edit', 'module.invoices.payment',
    'module.tax.view', 'module.tax.export', 'module.analytics.view', 'module.reports.create',
    'module.reports.export', 'module.ai.use', 'module.status.view', 'module.status.edit',
    'module.shared.manage', 'module.admin.view', 'module.admin.audit.view', 'system.sync.trigger',
    'module.studio.view', 'module.studio.ask', 'module.studio.docs.manage'],
  manager: ['module.dashboard.view', 'module.projects.view', 'module.projects.edit',
    'module.invoices.view', 'module.invoices.edit', 'module.invoices.payment',
    'module.tax.view', 'module.analytics.view', 'module.reports.create',
    'module.ai.use', 'module.status.view', 'module.status.edit',
    'module.studio.view', 'module.studio.ask', 'module.studio.docs.manage'],
  finance: ['module.dashboard.view', 'module.invoices.view', 'module.invoices.create',
    'module.invoices.edit', 'module.invoices.payment', 'module.tax.view',
    'module.tax.export', 'module.reports.create', 'module.reports.export'],
  web_admin: ['module.dashboard.view', 'module.projects.view', 'module.projects.create', 'module.projects.edit',
    'module.projects.delete', 'module.invoices.view', 'module.invoices.create', 'module.invoices.edit',
    'module.invoices.delete', 'module.invoices.payment', 'module.tax.view', 'module.tax.export',
    'module.tax.share', 'module.analytics.view', 'module.reports.create', 'module.reports.export',
    'module.ai.use', 'module.shared.manage'],
  web: ['module.invoices.view', 'module.invoices.create', 'module.invoices.edit', 'module.invoices.payment'],
  user: ['module.dashboard.view', 'module.projects.view', 'module.invoices.view', 'module.status.view'],
  viewer: ['module.dashboard.view', 'module.projects.view', 'module.invoices.view',
    'module.tax.view', 'module.analytics.view', 'module.status.view'],
}
const has = (role, key) => {
  const keys = SEED[role]
  if (keys === '*') return true
  if (key.endsWith('.*')) return keys.some(k => k.startsWith(key.slice(0, -1)))
  return keys.includes(key)
}

describe('the permission matrix on /security', () => {
  it('shows all eight seeded roles', () => {
    expect(ROLES.map(r => r.key)).toEqual(['superadmin', 'admin', 'manager', 'finance', 'web_admin', 'web', 'user', 'viewer'])
  })

  it('grants exactly what the seed grants, cell by cell', () => {
    for (const row of MATRIX) {
      for (const r of ROLES) {
        expect(!!row.cells[r.key], `${row.cap} for ${r.key}`).toBe(has(r.key, row.key))
      }
    }
  })

  it('agrees with the seed SQL itself, when the backend is beside the frontend', () => {
    const sqlPath = join(SRC, '..', '..', 'backend', 'app', 'db', 'postgres.py')
    if (!existsSync(sqlPath)) return
    const sql = readFileSync(sqlPath, 'utf8')
    const blocks = [...sql.matchAll(/permission_key IN \(([\s\S]*?)\)\s*WHERE r\.role_key = '(\w+)'/g)]
    expect(blocks.length).toBeGreaterThanOrEqual(7)
    for (const [, list, role] of blocks) {
      const keys = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()
      expect(keys, `seed for ${role}`).toEqual([...SEED[role]].sort())
    }
  })

  it('marks only scoped roles as own-records for invoices', () => {
    const view = MATRIX.find(m => m.key === 'module.invoices.view')
    expect(Object.entries(view.cells).filter(([, v]) => v === 'own').map(([k]) => k)).toEqual(['web', 'user', 'viewer'])
  })

  it('renders the whole matrix on a wide screen, one role on a phone', () => {
    wide = true
    const { container, unmount } = at(Security)
    expect(container.querySelectorAll('.ft-f-table thead th').length).toBe(ROLES.length + 1)
    unmount()
    wide = false
    const phone = at(Security)
    expect(phone.container.querySelectorAll('.ft-f-table thead th').length).toBe(2)
  })

  it('flips one cell for one person and says so', () => {
    at(Security)
    const toggle = screen.getByRole('checkbox', { name: /grant one person/i })
    fireEvent.click(toggle)
    expect(screen.getByText('override')).toBeInTheDocument()
    expect(screen.getByText(/with one override/)).toBeInTheDocument()
  })
})

describe('the audit sandbox', () => {
  const RFC5737 = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/

  it('only ever shows documentation addresses and example.com accounts', () => {
    const { container } = render(<AuditTrailSandbox />)
    const check = () => {
      // Text node by text node, so neighbouring cells do not run together.
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      const parts = []
      while (walker.nextNode()) parts.push(walker.currentNode.nodeValue)
      const text = parts.join(' ')
      const ips = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []
      expect(ips.length).toBeGreaterThan(0)
      for (const ip of ips) expect(ip).toMatch(RFC5737)
      for (const email of text.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []) expect(email).toMatch(/@example\.com$/)
    }
    check()
    fireEvent.click(screen.getByRole('button', { name: /open an invoice/i }))
    fireEvent.click(screen.getByRole('button', { name: /revoke sessions/i }))
    check()
  })

  it('moves a revoked account to Revoked and refuses its next request', async () => {
    vi.useFakeTimers()
    try {
      render(<AuditTrailSandbox />)
      fireEvent.click(screen.getByRole('button', { name: /revoke sessions/i }))
      act(() => { vi.runAllTimers() })
      expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0)
      expect(screen.getByText('Session has been revoked')).toBeInTheDocument()
      expect(screen.getByText('401')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('/features', () => {
  it('names every panel after its module, never "undefined"', () => {
    at(Features)
    for (const f of FEATURES) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(f.label.replace(/[&]/g, '\\$&')) }))
      const group = screen.getByRole('tabpanel').querySelector('.ft-f-stage [role="group"][aria-label]')
      expect(group.getAttribute('aria-label')).not.toMatch(/undefined/)
      expect(group.getAttribute('aria-label')).toMatch(f.label)
    }
  })

  it('takes the Pages label from the shared module list', () => {
    const pages = FEATURES.find(f => f.id === 'pages')
    expect(pages.label).toBe(MODULES.find(m => m.visual === 'pages').title)
  })

  it('keeps an anchor for the recently shipped section', () => {
    const { container } = at(Features)
    expect(container.querySelector('#shipped')).not.toBeNull()
  })

  it('has no generated 3D media, Motion toggle or autoplaying video', () => {
    const src = readFileSync(join(SRC, 'pages', 'Features.jsx'), 'utf8')
    expect(src).not.toMatch(/FEATURE_MEDIA|LoopVideo|ProductMediaShowcase|viewMode/)
    expect(existsSync(join(SRC, 'components', 'ProductMediaShowcase.jsx'))).toBe(false)
    const { container } = at(Features)
    for (const f of FEATURES) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(f.label.replace(/[&]/g, '\\$&')) }))
      expect(within(screen.getByRole('tabpanel')).queryByText(/\b3D\b/)).toBeNull()
    }
    expect(container.querySelector('video[autoplay]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^motion$/i })).toBeNull()
  })

  it('leaves out the claims that were removed', () => {
    const banned = /escrow|ring-fenced|26AS|hallucinat|cosine|similarity|SHA-256|hash chain|immutable|redis|SOC-2|ISO-27001|tamper|cryptograph|100% (reconciled|automated|verifiable)|Live D3|<\s?0\.2ms|Immediate Liquidity|FinTrack: \d+ days/i
    for (const Page of [Features, Security]) {
      const { container, unmount } = at(Page)
      expect(container.textContent).not.toMatch(banned)
      unmount()
    }
  })
})

describe('the tax split', () => {
  it('follows the GST and TDS arithmetic at ₹10,00,000', () => {
    render(<TaxFlowSimulator />)
    // B = 10,00,000 at 18% GST and 10% TDS
    for (const figure of ['₹11,80,000', '₹10,80,000', '₹9,00,000', '₹1,00,000', '₹1,80,000']) {
      expect(screen.getByText(figure)).toBeInTheDocument()
    }
  })
})
