/**
 * AuthUsersTab mirrors the API's role hierarchy: only a superadmin is offered
 * the superadmin role, in the create form and in each user's role picker
 * (which also drives approve and reactivate). A row that already holds it
 * keeps the option so its picker still shows the current role.
 *
 * Resend invite: when the email does not go out, only a superadmin gets the
 * link back (copied to the clipboard); anyone else is told to fix delivery.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
