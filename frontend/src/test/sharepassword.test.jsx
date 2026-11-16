/**
 * Password-protected share links, from both ends.
 *
 *   * the Share dialog's "Require a password" switch, Generate and Copy, and
 *     the password and domains it sends
 *   * the visitor's password screen: a wrong password is announced, the right
 *     one stores the unlock token and loads the view
 *   * the "request the password" form: validation, honeypot, sent screen
 *   * Links → Access requests: approve, deny with a note, and the manual
 *     hand-off when no mailer is configured
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../services/api', () => ({
  api: {
    sharedViews: {
      publicGet: vi.fn(),
      publicUpdate: vi.fn(),
      recordEvent: vi.fn(),
      create: vi.fn(),
      publicUnlock: vi.fn(),
      requestAccess: vi.fn(),
      accessRequests: vi.fn(),
      approveRequest: vi.fn(),
      denyRequest: vi.fn(),
    },
  },
}))

import { api } from '../services/api'
import SharedView from '../pages/SharedView.jsx'
import { ShareLinkModal } from '../components/SharedLinks.jsx'
import AccessRequestsPanel from '../components/share/AccessRequestsPanel.jsx'
import { ToastProvider } from '../context/ToastContext.jsx'
import { emailError, generateSharePassword, getViewUnlock } from '../utils/viewUnlock'

const RECORDS = [{ id: 'r1', fields: { 'Invoice Number': 'INV-1', Project: 'Atlas' } }]

function apiError(status, code, message) {
  const e = new Error(message || code)
  e.status = status
  if (code) e.code = code
  return e
}

function renderSharedView() {
  return render(
    <MemoryRouter initialEntries={['/view/tok']}>
      <Routes><Route path="/view/:token" element={<SharedView />} /></Routes>
    </MemoryRouter>
  )
}

const OPEN_VIEW = {
  token: 'tok', title: 'Atlas board', access_mode: 'read', resource_type: 'status', is_dynamic: false,
  records: [{ id: 'p1', fields: { Client: 'Acme', Project: 'Atlas', Status: 'In progress' } }],
  total: 1, view_config: { type: 'card' }, shared_fields: ['Client', 'Project', 'Status'],
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  api.sharedViews.recordEvent.mockResolvedValue(null)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => cleanup())

describe('password helpers', () => {
  it('generates strong, unambiguous passwords', () => {
    const a = generateSharePassword()
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}$/)
    expect(generateSharePassword()).not.toBe(a)
  })

  it('checks email addresses strictly', () => {
    expect(emailError('ana@theworks.in')).toBe('')
    for (const bad of ['', 'ana', 'ana@theworks', 'a b@x.com', 'a@x..com', 'a@@x.com', `${'a'.repeat(65)}@x.com`]) {
      expect(emailError(bad)).not.toBe('')
    }
  })
})

describe('Share dialog: Require a password', () => {
  it('toggle reveals the field; Generate fills it; Copy copies it; the create call carries it', async () => {
    api.sharedViews.create.mockResolvedValue({ token: 'new1', is_password_protected: true })
    render(<ShareLinkModal resourceType="invoices" selectedRecords={RECORDS} onClose={() => {}} />)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Require a password' }))
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: 'Generate a strong password' }))
    const generated = field.value
    expect(generated).toMatch(/^.{5}-.{5}-.{5}-.{5}$/)
    expect(field).toHaveAttribute('type', 'text')        // shown after Generate

    fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(generated))
    expect(await screen.findByText('Copied')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Auto-approve requests/), { target: { value: 'TheWorks.in, acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/ }))
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalled())
    const payload = api.sharedViews.create.mock.calls[0][0]
    expect(payload.password).toBe(generated)
    expect(payload.auto_approve_domains).toEqual(['theworks.in', 'acme.com'])
    expect(await screen.findByText('Share this URL and the password separately.')).toBeInTheDocument()
  })

  it('refuses a short password and announces why', async () => {
    render(<ShareLinkModal resourceType="invoices" selectedRecords={RECORDS} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Require a password' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(api.sharedViews.create).not.toHaveBeenCalled()
  })

  it('without the switch no password is sent', async () => {
    api.sharedViews.create.mockResolvedValue({ token: 'new2' })
    render(<ShareLinkModal resourceType="invoices" selectedRecords={RECORDS} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/ }))
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalled())
    expect(api.sharedViews.create.mock.calls[0][0]).not.toHaveProperty('password')
  })
})

describe('visitor: password screen', () => {
  it('a protected link shows the password screen, not the data', async () => {
    api.sharedViews.publicGet.mockRejectedValue(apiError(403, 'password_required'))
    renderSharedView()
    expect(await screen.findByRole('heading', { name: 'This shared view is protected' })).toBeInTheDocument()
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })

  it('a wrong password is announced; the right one stores the unlock token and loads the view', async () => {
    api.sharedViews.publicGet
      .mockRejectedValueOnce(apiError(403, 'password_required'))
      .mockResolvedValue(OPEN_VIEW)
    api.sharedViews.publicUnlock
      .mockRejectedValueOnce(apiError(403, 'incorrect_password'))
      .mockResolvedValue({ unlock_token: '999.sig', expires_in: 21600 })
    renderSharedView()
    const field = await screen.findByLabelText('Password')
    fireEvent.change(field, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open shared view' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That password isn’t right')
    expect(field).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(field, { target: { value: 'Sup3r-secret!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open shared view' }))
    expect((await screen.findAllByText('Atlas board')).length).toBeGreaterThan(0)
    expect(api.sharedViews.publicUnlock).toHaveBeenLastCalledWith('tok', 'Sup3r-secret!')
    expect(getViewUnlock('tok')).toBe('999.sig')
  })

  it('too many attempts says so', async () => {
    api.sharedViews.publicGet.mockRejectedValue(apiError(403, 'password_required'))
    api.sharedViews.publicUnlock.mockRejectedValue(apiError(429, null, 'Too many attempts. Wait a few minutes and try again.'))
    renderSharedView()
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open shared view' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  })
})

describe('visitor: request the password', () => {
  async function openForm() {
    api.sharedViews.publicGet.mockRejectedValue(apiError(403, 'password_required'))
    renderSharedView()
    fireEvent.click(await screen.findByRole('button', { name: 'Request it' }))
    return screen.findByRole('heading', { name: 'Request the password' })
  }

  it('validates name and email, focusing the first problem', async () => {
    await openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('Enter your name')).toBeInTheDocument()
    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Your name')).toHaveFocus()

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana Lee' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@theworks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText(/Enter a valid email address/)).toBeInTheDocument()
    expect(screen.getByLabelText('Work email')).toHaveFocus()
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true')
    expect(api.sharedViews.requestAccess).not.toHaveBeenCalled()
  })

  it('sends name, email, message and the (empty) honeypot, then confirms', async () => {
    api.sharedViews.requestAccess.mockResolvedValue({ ok: true })
    await openForm()
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: ' Ana Lee ' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@theworks.in' } })
    fireEvent.change(screen.getByLabelText(/Message to the owner/), { target: { value: 'For the Q3 review' } })
    expect(screen.getByLabelText('Website', { selector: 'input' })).toHaveAttribute('tabindex', '-1')
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('ana@theworks.in')
    expect(api.sharedViews.requestAccess).toHaveBeenCalledWith('tok', {
      name: 'Ana Lee', email: 'ana@theworks.in', message: 'For the Q3 review', website: '',
    })
  })

  it('an expired link shows the expired screen, with no form', async () => {
    api.sharedViews.publicGet.mockRejectedValue(apiError(404, null, 'This link has expired'))
    renderSharedView()
    expect(await screen.findByText('Link Expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request it' })).not.toBeInTheDocument()
  })
})

describe('Links → Access requests', () => {
  const PENDING = {
    id: 'req1', view_token: 'tok', view_title: 'Atlas board', name: 'Ana Lee', email: 'ana@acme.com',
    message: 'For the review', status: 'pending', created_at: '2026-11-16T09:00:00Z',
  }
  const renderPanel = () => render(<ToastProvider><AccessRequestsPanel resourceType="status" /></ToastProvider>)

  it('lists pending requests and approves one', async () => {
    api.sharedViews.accessRequests.mockResolvedValue({ requests: [PENDING], pending: 1, mailer_configured: true })
    api.sharedViews.approveRequest.mockResolvedValue({ status: 'approved', sent: true, request: { ...PENDING, status: 'approved' } })
    renderPanel()
    const row = (await screen.findByText('Ana Lee')).closest('li')
    expect(within(row).getByText('For the review')).toBeInTheDocument()
    expect(within(row).getByText('PENDING')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Approve and send password to Ana Lee' }))
    await waitFor(() => expect(api.sharedViews.approveRequest).toHaveBeenCalledWith('req1'))
    expect(await within(row).findByText('APPROVED')).toBeInTheDocument()
    expect(await screen.findByText('Password emailed to ana@acme.com')).toBeInTheDocument()
  })

  it('denies with an optional note', async () => {
    api.sharedViews.accessRequests.mockResolvedValue({ requests: [PENDING], pending: 1, mailer_configured: true })
    api.sharedViews.denyRequest.mockResolvedValue({ status: 'denied', sent: true })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Deny request from Ana Lee' }))
    const note = screen.getByLabelText(/Note to Ana Lee/)
    expect(note).toHaveFocus()
    fireEvent.change(note, { target: { value: 'Please ask Priya.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny request' }))
    await waitFor(() => expect(api.sharedViews.denyRequest).toHaveBeenCalledWith('req1', { note: 'Please ask Priya.', notify: true }))
    expect(await screen.findByText('DENIED')).toBeInTheDocument()
  })

  it('without a mailer, approval shows the password to share by hand', async () => {
    api.sharedViews.accessRequests.mockResolvedValue({ requests: [PENDING], pending: 1, mailer_configured: false })
    api.sharedViews.approveRequest.mockResolvedValue({
      status: 'approved', sent: false, reason: 'email_not_configured', password: 'Sup3r-secret!',
      url: 'https://app.test/view/tok', request: { ...PENDING, status: 'approved' },
    })
    renderPanel()
    expect(await screen.findByText(/Email isn’t set up on this server/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and send password to Ana Lee' }))
    const box = await screen.findByText('Approved. Share the password yourself.')
    const panel = box.closest('[role="alert"]')
    expect(within(panel).getByText('Sup3r-secret!')).toBeInTheDocument()
    expect(within(panel).getByText('https://app.test/view/tok')).toBeInTheDocument()
    expect(panel).toHaveFocus()
  })
})
