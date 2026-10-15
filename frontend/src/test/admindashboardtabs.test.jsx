/**
 * The AI gateway tab is for email superadmins only. Admins and the legacy
 * admin password never see it, and a direct ?tab=ai-gateway link falls back
 * to the overview for them, matching the API's require_superadmin.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = { authRole: 'superadmin', logout: vi.fn() }

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../services/api', () => ({ api: {} }))

const { stub } = vi.hoisted(() => ({ stub: (name, text) => ({ [name]: () => text }) }))
vi.mock('../pages/admin/AiGatewayTab', () => stub('AiGatewayTab', 'gateway panel'))
vi.mock('../pages/admin/OverviewTab', () => stub('OverviewTab', 'overview panel'))
vi.mock('../pages/admin/AiRunsTab', () => stub('AiRunsTab', 'runs panel'))
vi.mock('../pages/admin/AuditLogTab', () => stub('AuditLogTab', 'audit panel'))
vi.mock('../pages/admin/AuthUsersTab', () => stub('AuthUsersTab', 'users panel'))
vi.mock('../pages/admin/ChatsTab', () => stub('ChatsTab', 'chats panel'))
vi.mock('../pages/admin/DeploymentHealthTab', () => stub('DeploymentHealthTab', 'health panel'))
vi.mock('../pages/admin/HfLogsTab', () => stub('HfLogsTab', 'logs panel'))
vi.mock('../pages/admin/HistoryTab', () => stub('HistoryTab', 'history panel'))
vi.mock('../pages/admin/InsightsTab', () => stub('InsightsTab', 'insights panel'))
vi.mock('../pages/admin/InvoicesTab', () => stub('InvoicesTab', 'invoices panel'))
vi.mock('../pages/admin/PermissionsTab', () => stub('PermissionsTab', 'permissions panel'))
vi.mock('../pages/admin/ProjectsMirrorTab', () => stub('ProjectsMirrorTab', 'projects panel'))
vi.mock('../pages/admin/SessionsTab', () => stub('SessionsTab', 'sessions panel'))
vi.mock('../pages/admin/SharedLinksTab', () => stub('SharedLinksTab', 'shared panel'))
vi.mock('../pages/admin/SyncLogTab', () => stub('SyncLogTab', 'sync panel'))

import AdminDashboard from '../pages/AdminDashboard'

function mountAs(authRole, path = '/admin') {
  auth.authRole = authRole
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminDashboard embedded />
    </MemoryRouter>,
  )
}

describe('AI gateway tab visibility', () => {
  it('is listed right after the AI tab for a superadmin and opens from the URL', () => {
    mountAs('superadmin', '/admin?tab=ai-gateway')
    const labels = screen.getAllByRole('button').map(b => b.textContent.trim())
    expect(labels.indexOf('AI gateway')).toBe(labels.indexOf('AI') + 1)
    expect(screen.getByText('gateway panel')).toBeInTheDocument()
  })

  it.each([
    ['an admin', 'admin'],
    ['the legacy admin password', ''],
  ])('is hidden from %s, and its link falls back to the overview', (_, role) => {
    mountAs(role, '/admin?tab=ai-gateway')
    expect(screen.queryByRole('button', { name: 'AI gateway' })).toBeNull()
    expect(screen.getByRole('button', { name: 'AI' })).toBeInTheDocument()
    expect(screen.queryByText('gateway panel')).toBeNull()
    expect(screen.getByText('overview panel')).toBeInTheDocument()
  })
})
