/**
 * AuthUsersTab mirrors the API's role hierarchy: only a superadmin is offered
 * the superadmin role, in the create form and in each user's role picker
 * (which also drives approve and reactivate). A row that already holds it
 * keeps the option so its picker still shows the current role.
 *
 * Resend invite: when the email does not go out, only a superadmin gets the
 * link back (copied to the clipboard); anyone else is told to fix delivery.
 *
 * Timeline export: the CSV/JSON links were relative URLs with no token, so in
 * production they hit the static host and never downloaded anything. The
 * drawer now fetches the export through the API client and saves the file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = { authRole: 'admin', startImpersonation: vi.fn() }
const toast = vi.fn()
const confirm = vi.fn(async () => true)

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../services/api', () => ({
  api: {
    admin: {
      authRoles: vi.fn(),
      authUsers: vi.fn(),
      resendInvite: vi.fn(),
      userTimeline: vi.fn(),
      userTimelineExport: vi.fn(),
    },
  },
}))

import { api } from '../services/api'
import { AuthUsersTab } from '../pages/admin/AuthUsersTab'

const ROWS = [
  { id: 'u-boss', email: 'boss@x.test', status: 'active', roles: ['superadmin'] },
  { id: 'u-staff', email: 'staff@x.test', status: 'pending_approval', roles: ['user'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.admin.authRoles.mockResolvedValue({
    roles: [
      { role_key: 'superadmin', label: 'Superadmin' },
      { role_key: 'admin', label: 'Admin' },
      { role_key: 'user', label: 'User' },
    ],
  })
  api.admin.authUsers.mockResolvedValue({ rows: ROWS, total: ROWS.length, limit: 50, offset: 0 })
})

async function mountAs(authRole) {
  auth.authRole = authRole
  const view = render(<MemoryRouter><AuthUsersTab /></MemoryRouter>)
  await screen.findAllByText('staff@x.test')
  // Role options arrive with /auth/roles; wait until a picker lists Admin.
  await waitFor(() => expect(view.container.querySelector('select option[value="admin"]')).not.toBeNull())
  return view
}

const pickersShowing = (container, value) =>
  [...container.querySelectorAll('select')].filter(s => s.value === value)
const offers = (select, value) => [...select.options].some(o => o.value === value)

describe('role pickers', () => {
  it('do not offer superadmin to an admin', async () => {
    const { container } = await mountAs('admin')
    const staff = pickersShowing(container, 'user')
    expect(staff.length).toBeGreaterThan(0)
    for (const s of staff) expect(offers(s, 'superadmin')).toBe(false)
  })

  it('keep superadmin on a row that already holds it', async () => {
    const { container } = await mountAs('admin')
    const boss = pickersShowing(container, 'superadmin')
    expect(boss.length).toBeGreaterThan(0)
    for (const s of boss) expect(offers(s, 'superadmin')).toBe(true)
  })

  it('offer superadmin to a superadmin', async () => {
    const { container } = await mountAs('superadmin')
    for (const s of pickersShowing(container, 'user')) expect(offers(s, 'superadmin')).toBe(true)
  })

  it.each([['admin', false], ['superadmin', true]])('create form as %s offers superadmin: %s', async (role, expected) => {
    const { container } = await mountAs(role)
    const before = new Set(container.querySelectorAll('select'))
    fireEvent.click(screen.getByRole('button', { name: /Create \/ invite user/ }))
    const added = [...container.querySelectorAll('select')].filter(s => !before.has(s) && offers(s, 'admin'))
    expect(added).toHaveLength(1)
    expect(offers(added[0], 'superadmin')).toBe(expected)
  })
})

describe('resend invite when the email did not go out', () => {
  const resend = async () => {
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Resend invite/ })[0]) })
    await waitFor(() => expect(toast).toHaveBeenCalled())
  }

  it('tells an admin to fix delivery and hands over no link', async () => {
    api.admin.resendInvite.mockResolvedValue({
      ok: true, delivery: { sent: false, reason: 'email_not_configured' }, invite_url: null,
      message: 'Invite email not delivered (email_not_configured). Fix email delivery and resend.',
    })
    await mountAs('admin')
    await resend()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Fix email delivery'), 'error')
  })

  it('copies the link for a superadmin', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    api.admin.resendInvite.mockResolvedValue({
      ok: true, delivery: { sent: false, reason: 'email_not_configured' },
      invite_url: 'https://app.example/login?reset_token=abc&invite=1',
      message: 'Invite email not delivered (email_not_configured). Share the invite link with the user directly.',
    })
    await mountAs('superadmin')
    await resend()
    expect(writeText).toHaveBeenCalledWith('https://app.example/login?reset_token=abc&invite=1')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Link copied to clipboard'), 'warning')
  })
})

describe('timeline export', () => {
  let saved
  let spies
  beforeEach(() => {
    saved = []
    api.admin.userTimeline.mockResolvedValue({
      user: { id: 'u-staff', email: 'staff@x.test' }, timeline: [], sessions: [], audit_request_count: 0,
    })
    spies = [
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:timeline'),
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}),
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        saved.push({ href: this.getAttribute('href'), download: this.download })
      }),
    ]
  })
  afterEach(() => { for (const spy of spies) spy.mockRestore() })

  const openTimeline = async () => {
    await mountAs('admin')
    fireEvent.click(screen.getAllByRole('button', { name: /Timeline/ })[1])
    return screen.findByRole('button', { name: /CSV/ })
  }

  it('downloads through the API client instead of linking to a relative URL', async () => {
    const blob = new Blob(['timestamp\n'], { type: 'text/csv' })
    api.admin.userTimelineExport.mockResolvedValue({ blob, filename: null, contentType: 'text/csv' })
    const csv = await openTimeline()
    expect(document.querySelector('a[href*="timeline/export"]')).toBeNull()

    await act(async () => { fireEvent.click(csv) })

    expect(api.admin.userTimelineExport).toHaveBeenCalledWith('u-staff', 'csv')
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(saved).toEqual([{ href: 'blob:timeline', download: 'timeline_staff_at_x_test.csv' }])
  })

  it('keeps the server-provided file name when it is readable', async () => {
    api.admin.userTimelineExport.mockResolvedValue({ blob: new Blob(['{}']), filename: 'timeline_named.json' })
    await openTimeline()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /JSON/ })) })
    expect(api.admin.userTimelineExport).toHaveBeenCalledWith('u-staff', 'json')
    expect(saved.map(s => s.download)).toEqual(['timeline_named.json'])
  })

  it('reports a failed export instead of failing silently', async () => {
    api.admin.userTimelineExport.mockRejectedValue(new Error('Admin access required'))
    const csv = await openTimeline()
    await act(async () => { fireEvent.click(csv) })
    expect(toast).toHaveBeenCalledWith('Admin access required', 'error')
    expect(saved).toEqual([])
  })
})
