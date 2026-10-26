/**
 * The pages tree: nesting, sub-pages, moving with the picker, trash/restore,
 * and the public viewer's breadcrumbs and sub-pages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { tree, calls } = vi.hoisted(() => ({
  tree: { pages: [], favourites: [] },
  calls: [],
}))

vi.mock('../services/api', () => {
  const rec = (name, value) => vi.fn(async (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value })
  return {
    api: {
      pages: { update: rec('update', (id, b) => ({ id, ...b })) },
      pageTree: {
        tree: vi.fn(async () => ({ ready: true, ...tree })),
        recent: vi.fn(async () => []),
        trash: vi.fn(async () => [{ id: 'k', title: 'Kid', deleted_at: '2026-10-26T10:00:00Z' }]),
        createChild: rec('createChild', (id, b) => ({ id: 'new', parent_id: id, ...b })),
        move: rec('move', (id, b) => ({ id, ...b })),
        trashPage: rec('trashPage', { ok: true }),
        restore: rec('restore', { ok: true }),
        deleteForever: rec('deleteForever', { ok: true }),
        favourite: rec('favourite', { ok: true }),
        appearance: rec('appearance', (id, b) => ({ id, ...b })),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

const NODES = [
  { id: 'r', title: 'Root', parent_id: null, position: 1, content_type: 'markdown', is_published: true },
  { id: 'k', title: 'Kid', parent_id: 'r', position: 1, content_type: 'markdown' },
  { id: 'g', title: 'Grandkid', parent_id: 'k', position: 1, content_type: 'markdown', icon: '🚀' },
  { id: 'o', title: 'Other', parent_id: null, position: 2, content_type: 'html' },
]

beforeEach(() => {
  calls.length = 0
  tree.pages = NODES
  tree.favourites = []
  try { localStorage.clear() } catch {}
})

async function mountPanel(props = {}) {
  const PageTreePanel = (await import('../components/pagetree/PageTreePanel')).default
  const utils = render(<PageTreePanel {...props} />)
  await screen.findByRole('tree', { name: 'Pages' })
  return utils
}

describe('tree model', () => {
  it('groups by parent and refuses drops into a page\'s own branch', async () => {
    const { buildTree, dropPlacement, descendantIds } = await import('../components/pagetree/treeModel')
    const t = buildTree(NODES)
    expect(t.childrenOf(null).map(n => n.id)).toEqual(['r', 'o'])
    expect([...descendantIds(t, 'r')].sort()).toEqual(['g', 'k'])
    expect(dropPlacement(t, 'r', 'g', 'inside')).toBeNull()
    expect(dropPlacement(t, 'r', 'r', 'after')).toBeNull()
    expect(dropPlacement(t, 'o', 'r', 'inside')).toEqual({ parent_id: 'r', index: 1 })
    expect(dropPlacement(t, 'o', 'r', 'before')).toEqual({ parent_id: null, index: 0 })
    expect(dropPlacement(t, 'g', 'o', 'after')).toEqual({ parent_id: null, index: 2 })
  })

  it('shows a page whose parent was not sent at the top level', async () => {
    const { buildTree } = await import('../components/pagetree/treeModel')
    const t = buildTree([{ id: 'x', parent_id: 'gone', position: 1 }])
    expect(t.childrenOf(null).map(n => n.id)).toEqual(['x'])
  })
})

describe('PageTreePanel', () => {
  it('renders nested pages and expands a branch', async () => {
    await mountPanel()
    const t = screen.getByRole('tree', { name: 'Pages' })
    expect(within(t).getByRole('treeitem', { name: 'Root' })).toBeTruthy()
    expect(within(t).getByRole('treeitem', { name: 'Other' })).toBeTruthy()
    expect(within(t).queryByRole('treeitem', { name: 'Kid' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }))
    const kid = within(t).getByRole('treeitem', { name: 'Kid' })
    expect(kid.getAttribute('aria-level')).toBe('2')
    fireEvent.click(within(kid).getByRole('button', { name: 'Expand Kid' }))
    expect(within(t).getByRole('treeitem', { name: 'Grandkid' }).getAttribute('aria-level')).toBe('3')
  })

  it('expands the branch holding the open page', async () => {
    await mountPanel({ currentId: 'g' })
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Grandkid' })).toBeTruthy())
    expect(screen.getByRole('treeitem', { name: 'Grandkid' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens a page when its title is clicked', async () => {
    const onOpen = vi.fn()
    await mountPanel({ onOpen })
    fireEvent.click(screen.getByTitle('Other'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'o' }))
  })

  it('creates a sub-page with the inline +', async () => {
    const onCreated = vi.fn()
    const onChanged = vi.fn()
    await mountPanel({ onCreated, onChanged })
    fireEvent.click(screen.getByRole('button', { name: 'Add a sub-page to Other' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(calls).toContainEqual(['createChild', 'o', expect.objectContaining({ title: 'Untitled', content_type: 'doc', client_request_id: expect.any(String) })])
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'new', parent_id: 'o' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('moves a page with the Move to… picker, never into its own sub-pages', async () => {
    await mountPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Page options for Root' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).queryByRole('button', { name: 'Move into Kid' })).toBeNull()
    expect(within(dlg).queryByRole('button', { name: 'Move into Grandkid' })).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Move into Other' }))
    await waitFor(() => expect(calls).toContainEqual(['move', 'r', { parent_id: 'o' }]))
  })

  it('moves a nested page to the top level', async () => {
    await mountPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Root' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page options for Kid' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Move to the top level' }))
    await waitFor(() => expect(calls).toContainEqual(['move', 'k', { parent_id: null }]))
  })

  it('renames inline with a double-click', async () => {
    await mountPanel()
    fireEvent.doubleClick(screen.getByTitle('Other'))
    const input = screen.getByRole('textbox', { name: 'Page name' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(calls).toContainEqual(['update', 'o', { title: 'Renamed' }]))
  })

  it('sets an icon from the picker', async () => {
    await mountPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Change icon for Other' }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(within(dlg).getByRole('option', { name: 'Icon 🚀' }))
    await waitFor(() => expect(calls).toContainEqual(['appearance', 'o', { icon: '🚀' }]))
  })

  it('moves to the trash, then restores and deletes forever from the Trash', async () => {
    const onChanged = vi.fn()
    await mountPanel({ onChanged })
    fireEvent.click(screen.getByRole('button', { name: 'Page options for Other' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }))
    await waitFor(() => expect(calls).toContainEqual(['trashPage', 'o']))
    expect(onChanged).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Restore Kid' }))
    await waitFor(() => expect(calls).toContainEqual(['restore', 'k']))
    await waitFor(() => expect(within(dlg).queryByRole('button', { name: 'Restore Kid' })).toBeNull())
  })

  it('asks before deleting forever', async () => {
    await mountPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Delete Kid forever' }))
    await waitFor(() => expect(calls).toContainEqual(['deleteForever', 'k']))
  })

  it('lists favourites above the tree', async () => {
    tree.favourites = ['g']
    await mountPanel()
    const favs = screen.getByRole('region', { name: 'Favourites' })
    expect(within(favs).getByText('Grandkid')).toBeTruthy()
  })
})

describe('public viewer family', () => {
  it('links published sub-pages and published parents', async () => {
    const { PublicBreadcrumbs, PublicSubPages } = await import('../components/pagetree/PublicPageFamily')
    const page = {
      title: 'Mid',
      breadcrumbs: [{ title: 'Root', slug: 'root', icon: null }],
      children: [{ title: 'Leaf', slug: 'leaf', icon: '🌿' }],
    }
    render(<MemoryRouter><PublicBreadcrumbs page={page} /><PublicSubPages page={page} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Root' }).getAttribute('href')).toBe('/p/root')
    const sub = screen.getByRole('region', { name: 'Sub-pages' })
    expect(within(sub).getByRole('link', { name: /Leaf/ }).getAttribute('href')).toBe('/p/leaf')
  })

  it('renders nothing for a page outside any tree', async () => {
    const { PublicBreadcrumbs, PublicSubPages } = await import('../components/pagetree/PublicPageFamily')
    const { container } = render(<MemoryRouter><PublicBreadcrumbs page={{ title: 'x' }} /><PublicSubPages page={{ title: 'x' }} /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })
})
