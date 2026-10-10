/**
 * The All Resources edit drawer has a single Project picker, filled with the
 * resource's first link. A PATCH carrying a lone project_id now only adds that
 * link (it used to replace the whole list, unlinking every other project), so
 * the drawer must say what it means: nothing when the pick is unchanged, and
 * the full list with the shown project swapped out when the user moves it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

const { api, toast, state } = vi.hoisted(() => {
  const state = { links: [] }
  const ok = (v) => vi.fn().mockResolvedValue(v)
  const api = {
    webProjects: {
      names: ok([
        { id: 'recProjA', name: 'Atlas Rebuild' },
        { id: 'recProjB', name: 'Beacon' },
        { id: 'recProjC', name: 'Comet' },
      ]),
      resources: {
        listAll: vi.fn(async () => ({
          records: [{
            id: 'recRes1',
            fields: {
              'Resource Name': 'Rahul Sharma', 'Role': 'Frontend Dev', 'Type': 'Employee',
              'Man Hours': 160, 'Rate (₹)': 90000, 'Units': 1, 'Rate Unit': 'Per Month',
              'Project': state.links.map(id => ({ id, title: id })),
            },
          }],
        })),
        create: ok({ id: 'recNew' }),
        update: ok({ id: 'recRes1' }),
        delete: ok(null),
      },
    },
  }
  const toast = Object.assign(vi.fn(), { showToast: vi.fn() })
  return { api, toast, state }
})

vi.mock('../services/api', () => ({ api, API_BASE_URL: '' }))
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isEditor: true, hasPerm: () => true, authRole: 'superadmin' }),
}))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))

import { AllResourcesView } from '../pages/WebProjects'

async function editAndSave(pick) {
  render(<AllResourcesView />)
  await screen.findAllByText('Rahul Sharma')
  fireEvent.click(screen.getAllByRole('button', { name: /Edit/ })[0])
  const dialog = await screen.findByRole('dialog')
  if (pick) {
    const picker = within(dialog).getAllByRole('combobox')
      .find(s => [...s.options].some(o => o.value === 'recProjB'))
    fireEvent.change(picker, { target: { value: pick } })
  }
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/ })) })
  await waitFor(() => expect(api.webProjects.resources.update).toHaveBeenCalledTimes(1))
  return api.webProjects.resources.update.mock.calls[0]
}

beforeEach(() => { vi.clearAllMocks() })

describe('All Resources edit drawer and project links', () => {
  it('an unchanged pick sends no link change', async () => {
    state.links = ['recProjA', 'recProjB']
    const [id, payload] = await editAndSave(null)
    expect(id).toBe('recRes1')
    expect(payload).not.toHaveProperty('project_id')
    expect(payload).not.toHaveProperty('project_ids')
    expect(payload.man_hours).toBe(160)
  })

  it('moving a single-project resource replaces its link', async () => {
    state.links = ['recProjA']
    const [, payload] = await editAndSave('recProjB')
    expect(payload).not.toHaveProperty('project_id')
    expect(payload.project_ids).toEqual(['recProjB'])
  })

  it('moving one link of a shared resource keeps the others', async () => {
    state.links = ['recProjA', 'recProjB']
    const [, payload] = await editAndSave('recProjC')
    expect(payload.project_ids).toEqual(['recProjC', 'recProjB'])
  })

  it('picking a project for an unlinked resource links it', async () => {
    state.links = []
    const [, payload] = await editAndSave('recProjB')
    expect(payload.project_ids).toEqual(['recProjB'])
  })
})
