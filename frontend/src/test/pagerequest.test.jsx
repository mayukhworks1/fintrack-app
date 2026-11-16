/**
 * "Request the password" on a published page or artifact, from both ends.
 *
 *   * the visitor: the shared request form, pointed at the page route,
 *     validates name and email and sends the honeypot field
 *   * the owner: the Share popover's "Show password", auto-approve domains
 *     and the page's access requests (approve, deny, and the manual approval
 *     for a password set before encrypted copies were kept)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: {
    pages: {
      publicGet: vi.fn(),
      publicVerify: vi.fn(),
      publicLogView: vi.fn(async () => ({})),
      publicRequestAccess: vi.fn(),
      access: vi.fn(),
      updateAccess: vi.fn(),
      revealPassword: vi.fn(),
      accessRequests: vi.fn(),
      approveRequest: vi.fn(),
      denyRequest: vi.fn(),
    },
    sharedViews: { requestAccess: vi.fn() },
  },
  API_BASE_URL: 'https://api.example',
}))

import { api } from '../services/api'
import { RequestPane } from '../pages/sharedview/ProtectedLink.jsx'
import PageAccessSection from '../components/pages/PageAccessSection.jsx'
import { ToastProvider } from '../context/ToastContext.jsx'

function apiError(status, code, message) {
  const e = new Error(message || code)
  e.status = status
  if (code) e.code = code
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => cleanup())

describe('visitor: the request form sends to the page route', () => {
  function renderPane(onSent = vi.fn()) {
    render(<RequestPane token="q3-plan" noun="page" sendRequest={(d) => api.pages.publicRequestAccess('q3-plan', d)}
      onSent={onSent} onBack={vi.fn()} onGone={vi.fn()} />)
    return onSent
  }

  it('validates, then sends name, email, message and the honeypot to the page', async () => {
    api.pages.publicRequestAccess.mockResolvedValue({ ok: true })
    const onSent = renderPane()
    expect(screen.getByText(/The owner of this page will see your name/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('Enter your name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana Lee' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await screen.findByText(/valid email/i)
    expect(api.pages.publicRequestAccess).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@acme.com' } })
    fireEvent.change(screen.getByLabelText(/Message to the owner/), { target: { value: 'For the board pack' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('ana@acme.com'))
    expect(api.pages.publicRequestAccess).toHaveBeenCalledWith('q3-plan', {
      name: 'Ana Lee', email: 'ana@acme.com', message: 'For the board pack', website: '',
    })
    expect(api.sharedViews.requestAccess).not.toHaveBeenCalled()
  })

  it('shows the rate limit message', async () => {
    api.pages.publicRequestAccess.mockRejectedValue(apiError(429, null, 'Too many requests. Please try again later.'))
    renderPane()
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'ana@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('Too many requests. Please try again later.')).toBeTruthy()
  })
})

describe('owner: the page Share popover', () => {
  const summary = (over = {}) => ({ is_password_protected: true, password_stored: true, auto_approve_domains: [], pending: 1, mailer_configured: true, ...over })
  const REQ = { id: 'r1', page_id: 'pid', view_title: 'Q3 plan', name: 'Ana Lee', email: 'ana@acme.com', message: 'Board pack', status: 'pending', created_at: '2026-11-16T05:00:00Z' }
  const renderSection = (props = {}) => render(<ToastProvider><PageAccessSection pageId="pid" {...props} /></ToastProvider>)

  it('shows the password on request and saves auto-approve domains', async () => {
    api.pages.access.mockResolvedValue(summary())
    api.pages.revealPassword.mockResolvedValue({ password: 'Page-secret-1!' })
    api.pages.updateAccess.mockResolvedValue(summary({ auto_approve_domains: ['theworks.in'] }))
    const onPending = vi.fn()
    renderSection({ onPending })
    fireEvent.click(await screen.findByRole('button', { name: 'Show password' }))
    expect(await screen.findByText('Page-secret-1!')).toBeTruthy()
    expect(api.pages.revealPassword).toHaveBeenCalledWith('pid')
    expect(onPending).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.queryByText('Page-secret-1!')).toBeNull()

    fireEvent.change(screen.getByLabelText(/Auto-approve requests from/), { target: { value: 'TheWorks.in,  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Requests from these domains get the password at once/)
    expect(api.pages.updateAccess).toHaveBeenCalledWith('pid', { auto_approve_domains: ['TheWorks.in'] })
    expect(screen.getByLabelText(/Auto-approve requests from/).value).toBe('theworks.in')
  })

  it('says so when the password predates stored copies', async () => {
    api.pages.access.mockResolvedValue(summary({ password_stored: false, pending: 0 }))
    renderSection()
    expect(await screen.findByText(/set before FinTrack kept a copy/)).toBeTruthy()
  })

  it('lists the page requests and approves one by email', async () => {
    api.pages.access.mockResolvedValue(summary())
    api.pages.accessRequests.mockResolvedValue({ requests: [REQ], pending: 1, mailer_configured: true })
    api.pages.approveRequest.mockResolvedValue({ status: 'approved', sent: true, request: { ...REQ, status: 'approved' } })
    renderSection({ openRequests: true })
    await screen.findByText('Ana Lee')
    expect(api.pages.accessRequests).toHaveBeenCalledWith('pid')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send password to Ana Lee' }))
    await waitFor(() => expect(api.pages.approveRequest).toHaveBeenCalledWith('pid', 'r1', {}))
    await screen.findByText(/Password emailed to ana@acme.com/)
  })

  it('denies with a note', async () => {
    api.pages.access.mockResolvedValue(summary())
    api.pages.accessRequests.mockResolvedValue({ requests: [REQ], pending: 1, mailer_configured: true })
    api.pages.denyRequest.mockResolvedValue({ status: 'denied', sent: true })
    renderSection({ openRequests: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Deny request from Ana Lee' }))
    fireEvent.change(screen.getByLabelText(/Note to Ana Lee/), { target: { value: 'Ask Priya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny request' }))
    await waitFor(() => expect(api.pages.denyRequest).toHaveBeenCalledWith('pid', 'r1', { note: 'Ask Priya', notify: true }))
  })

  it('an old password: asks to set it again, or approves without email for a manual hand-off', async () => {
    api.pages.access.mockResolvedValue(summary({ password_stored: false }))
    api.pages.accessRequests.mockResolvedValue({ requests: [REQ], pending: 1, mailer_configured: true })
    api.pages.approveRequest
      .mockRejectedValueOnce(apiError(409, 'password_not_stored', 'This page’s password was set before FinTrack kept a copy it can email. Set the password again in Share → Password, then approve.'))
      .mockResolvedValueOnce({ status: 'approved', sent: false, reason: 'manual', password: null, url: 'https://app.test/p/q3-plan', request: { ...REQ, status: 'approved' } })
    renderSection({ openRequests: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and send password to Ana Lee' }))
    expect(await screen.findByText(/Set the password again in Share/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Approve without email/ }))
    await waitFor(() => expect(api.pages.approveRequest).toHaveBeenLastCalledWith('pid', 'r1', { manual: true }))
    expect(await screen.findByText('Approved. Share the password yourself.')).toBeTruthy()
    expect(screen.getByText('https://app.test/p/q3-plan')).toBeTruthy()
  })

  it('without a mailer the approval shows the password to share', async () => {
    api.pages.access.mockResolvedValue(summary({ mailer_configured: false }))
    api.pages.accessRequests.mockResolvedValue({ requests: [REQ], pending: 1, mailer_configured: false })
    api.pages.approveRequest.mockResolvedValue({ status: 'approved', sent: false, reason: 'email_not_configured', password: 'Page-secret-1!', url: 'https://app.test/p/q3-plan', request: { ...REQ, status: 'approved' } })
    renderSection({ openRequests: true })
    expect(await screen.findByText(/Email isn’t set up on this server/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send password to Ana Lee' }))
    expect(await screen.findByText('Page-secret-1!')).toBeTruthy()
  })
})
