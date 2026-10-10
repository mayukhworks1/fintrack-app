/**
 * A resource can sit on several projects; working on it from one project must
 * leave the others alone.
 *
 * Inside a project's detail view, saving a resource always sent
 * project_id = this project, and the backend turns that into Project=[this],
 * replacing the whole link list — so editing only the hours silently dropped
 * the resource from every other project. And the trash icon in the project's
 * Resources list deleted the record outright, taking it, and its cost, off
 * every other project too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

const { api, toast } = vi.hoisted(() => {
  const project = {
    id: 'recProjA',
    fields: { 'Project Name': 'Atlas Rebuild', 'Client': 'Acme', 'Status': 'In Progress', 'Priority': 'High' },
  }
  const resource = {
    id: 'recRes1',
    fields: {
      'Resource Name': 'Rahul Sharma', 'Role': 'Frontend Dev', 'Type': 'Employee',
      'Man Hours': 160, 'Rate (₹)': 90000, 'Units': 1, 'Rate Unit': 'Per Month',
      'Project': [{ id: 'recProjA', title: 'Atlas Rebuild' }, { id: 'recProjB', title: 'Beacon' }],
    },
  }
  const ok = (v) => vi.fn().mockResolvedValue(v)
  const api = {
    webProjects: {
      list: ok({ records: [project] }),
      summary: ok({}),
      names: ok([{ id: 'recProjA', name: 'Atlas Rebuild' }, { id: 'recProjB', name: 'Beacon' }]),
      get: ok(project),
      resources: {
        list: ok({ records: [resource] }),
        listAll: ok({ records: [resource] }),
        create: ok({ id: 'recNew' }),
        update: ok(resource),
        delete: ok(null),
        assign: ok({}),
        unassign: ok({}),
      },
    },
    webInvoices: { list: ok({ records: [] }) },
  }
  const toast = Object.assign(vi.fn(), { showToast: vi.fn() })
  return { api, toast }
})

vi.mock('../services/api', () => ({ api, API_BASE_URL: '' }))
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isEditor: true, hasPerm: () => true, authRole: 'superadmin' }),
}))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))

import { ProjectsWorkspace } from '../pages/WebProjects'

async function openResourceRow() {
  render(<ProjectsWorkspace />)
  fireEvent.click(await screen.findByRole('button', { name: /Atlas Rebuild/ }))
  const name = await screen.findByText('Rahul Sharma')
  // The row's own action buttons: edit, then remove.
  const row = name.closest('.p-3')
  return within(row).getAllByRole('button')
}

beforeEach(() => { vi.clearAllMocks() })

describe('project-scoped resource actions', () => {
  it('editing a resource does not rewrite its project links', async () => {
    const [edit] = await openResourceRow()
    fireEvent.click(edit)
    const dialog = await screen.findByRole('dialog')
    const picker = within(dialog).queryByText('— Select project —')

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/ })) })
    await waitFor(() => expect(api.webProjects.resources.update).toHaveBeenCalledTimes(1))
    const [id, payload] = api.webProjects.resources.update.mock.calls[0]
    expect(id).toBe('recRes1')
    expect(payload).not.toHaveProperty('project_id')
    expect(payload.man_hours).toBe(160)
    // No project picker when editing: a choice there was never kept.
    expect(picker).toBeNull()
  })

  it('a new resource is still created on the open project', async () => {
    render(<ProjectsWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /Atlas Rebuild/ }))
    await screen.findByText('Rahul Sharma')
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Rahul Sharma'), { target: { value: 'Priya' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Add Resource/ })) })
    await waitFor(() => expect(api.webProjects.resources.create).toHaveBeenCalledTimes(1))
    expect(api.webProjects.resources.create.mock.calls[0][0]).toMatchObject({ resource_name: 'Priya', project_id: 'recProjA' })
  })

  it('a new resource goes to the project picked in the drawer, not always the open one', async () => {
    render(<ProjectsWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /Atlas Rebuild/ }))
    await screen.findByText('Rahul Sharma')
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Rahul Sharma'), { target: { value: 'Priya' } })
    fireEvent.change(within(dialog).getByDisplayValue('Atlas Rebuild'), { target: { value: 'recProjB' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Add Resource/ })) })
    await waitFor(() => expect(api.webProjects.resources.create).toHaveBeenCalledTimes(1))
    expect(api.webProjects.resources.create.mock.calls[0][0]).toMatchObject({ resource_name: 'Priya', project_id: 'recProjB' })
  })

  it("the edit drawer's remove button unlinks from this project and says so", async () => {
    const [edit] = await openResourceRow()
    fireEvent.click(edit)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Remove$/ }))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Confirm\?/ })) })

    await waitFor(() => expect(api.webProjects.resources.unassign).toHaveBeenCalledWith('recRes1', 'recProjA'))
    expect(api.webProjects.resources.delete).not.toHaveBeenCalled()
  })

  it('removing a resource from the list unlinks it from this project only', async () => {
    const [, remove] = await openResourceRow()
    fireEvent.click(remove)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Yes/ })) })

    await waitFor(() => expect(api.webProjects.resources.unassign).toHaveBeenCalledWith('recRes1', 'recProjA'))
    expect(api.webProjects.resources.delete).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Rahul Sharma')).toBeNull())
  })
})
