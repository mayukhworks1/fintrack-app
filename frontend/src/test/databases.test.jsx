/**
 * Databases: the model (filters, sorts, board moves, calendar grid), the
 * editor (inline cell edit, adding a property, filtering) and the read-only
 * views (board drag handler, calendar, public viewer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const { calls, state } = vi.hoisted(() => ({ calls: [], state: { schema: null, rows: [] } }))

vi.mock('../services/api', () => {
  const rec = (name, fn) => vi.fn(async (...args) => { calls.push([name, ...args]); return fn(...args) })
  return {
    api: {
      databases: {
        get: rec('get', (id) => ({ id, title: 'Tasks', is_published: false, database: state.schema })),
        people: vi.fn(async () => [{ name: 'Asha' }]),
        query: rec('query', () => ({ rows: state.rows, total: state.rows.length })),
        saveSchema: rec('saveSchema', (id, s) => ({ database: { ...state.schema, ...s } })),
        updateRow: rec('updateRow', (id, rowId, patch) => {
          const r = state.rows.find(x => x.id === rowId)
          return { ...r, ...(patch.title != null ? { title: patch.title } : {}), props: { ...r.props, ...(patch.props || {}) } }
        }),
        createRow: rec('createRow', (id, b) => ({ id: 'new', title: b.title, props: b.props, position: 99 })),
        bulkUpdate: rec('bulkUpdate', (id, updates) => ({ rows: [] })),
        deleteRows: rec('deleteRows', () => ({ ok: true })),
        rowContext: rec('rowContext', () => ({ database: null })),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

import {
  cleanFilter, filterMatches, groupRows, monthGrid, moveCard, presetFromFilter, propsById, sortRows, viewRows, NO_GROUP,
  formatNumber, uniqueName,
} from '../components/database/dbModel'

const SCHEMA = {
  version: 1,
  properties: [
    { id: 'title', name: 'Task', type: 'title' },
    { id: 'status', name: 'Status', type: 'select', options: [
      { id: 'todo', name: 'To do', color: 'gray' }, { id: 'doing', name: 'Doing', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
    { id: 'amount', name: 'Amount', type: 'number', format: 'inr' },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'tags', name: 'Tags', type: 'multi_select', options: [{ id: 'fin', name: 'Finance', color: 'green' }] },
    { id: 'ok', name: 'OK', type: 'checkbox' },
  ],
  views: [
    { id: 'v1', name: 'Table', type: 'table', filter: null, sort: [], hidden: [], order: [], widths: {} },
    { id: 'v2', name: 'Board', type: 'board', group_by: 'status', card_props: ['amount'], filter: null, sort: [] },
    { id: 'v3', name: 'Calendar', type: 'calendar', date_prop: 'due', filter: null, sort: [] },
  ],
  default_view: 'v1',
  row_type: 'doc',
}
const ROWS = [
  { id: 'a', title: 'File GST', position: 1, props: { status: 'todo', amount: 1200, due: '2026-10-05', tags: ['fin'] } },
  { id: 'b', title: 'Pay rent', position: 2, props: { status: 'doing', amount: 50000, due: '2026-10-05' } },
  { id: 'c', title: 'Close books', position: 3, props: { status: 'todo', due: '2026-10-20', ok: true } },
]

beforeEach(() => {
  calls.length = 0
  state.schema = JSON.parse(JSON.stringify(SCHEMA))
  state.rows = JSON.parse(JSON.stringify(ROWS))
  try { localStorage.clear() } catch {}
})

// ── Model ─────────────────────────────────────────────────────────────────

describe('dbModel', () => {
  const props = propsById(SCHEMA)

  it('filters with and / or and nested groups', () => {
    const f = { op: 'or', rules: [
      { prop: 'status', cmp: 'eq', value: 'doing' },
      { op: 'and', rules: [{ prop: 'amount', cmp: 'gt', value: 1000 }, { prop: 'tags', cmp: 'contains', value: 'fin' }] },
    ] }
    expect(ROWS.filter(r => filterMatches(r, f, props)).map(r => r.id)).toEqual(['a', 'b'])
    expect(ROWS.filter(r => filterMatches(r, { op: 'and', rules: [{ prop: 'amount', cmp: 'empty' }] }, props)).map(r => r.id)).toEqual(['c'])
    expect(ROWS.filter(r => filterMatches(r, { op: 'and', rules: [{ prop: 'title', cmp: 'contains', value: 'PAY' }] }, props)).map(r => r.id)).toEqual(['b'])
  })

  it('sorts by option order, numbers with empties last, then position', () => {
    expect(sortRows(ROWS, [{ prop: 'status', dir: 'desc' }], props).map(r => r.id)).toEqual(['b', 'a', 'c'])
    expect(sortRows(ROWS, [{ prop: 'amount', dir: 'desc' }], props).map(r => r.id)).toEqual(['b', 'a', 'c'])
    expect(viewRows(ROWS, { sort: [{ prop: 'amount', dir: 'asc' }] }, SCHEMA).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops half-typed rules before they reach the server', () => {
    const f = { op: 'and', rules: [{ prop: 'amount', cmp: 'gt', value: '' }, { prop: 'status', cmp: 'eq', value: 'done' }] }
    expect(cleanFilter(f, SCHEMA)).toEqual({ op: 'and', rules: [{ prop: 'status', cmp: 'eq', value: 'done' }] })
    expect(cleanFilter({ op: 'and', rules: [{ prop: 'amount', cmp: 'gt', value: 'x' }] }, SCHEMA)).toBeNull()
    expect(presetFromFilter(cleanFilter(f, SCHEMA), SCHEMA)).toEqual({ status: 'done' })
  })

  it('moves a card into another column between two others', () => {
    const cols = groupRows(ROWS, props.status)
    expect(cols.map(c => c.key)).toEqual([NO_GROUP, 'todo', 'doing', 'done'])
    const updates = moveCard(cols, 'b', 'todo', 1, 'status')
    expect(updates).toEqual([{ id: 'b', position: 2, props: { status: 'todo' } }])
    const tight = moveCard(groupRows([{ ...ROWS[0], position: 1 }, { ...ROWS[2], position: 1 }, ROWS[1]], props.status), 'b', 'todo', 1, 'status')
    expect(tight[0]).toMatchObject({ id: 'b', position: 2048, props: { status: 'todo' } })
    expect(tight.slice(1)).toEqual([{ id: 'a', position: 1024 }, { id: 'c', position: 3072 }])
  })

  it('lays a month out in six Monday-first weeks', () => {
    const days = monthGrid(2026, 9) // October 2026 starts on a Thursday
    expect(days).toHaveLength(42)
    expect(days[0].date).toBe('2026-09-28')
    expect(days[3]).toMatchObject({ date: '2026-10-01', inMonth: true })
  })

  it('formats rupees and keeps property names unique', () => {
    expect(formatNumber(123456.5, 'inr')).toMatch(/₹\s?1,23,456\.5/)
    expect(formatNumber(12, 'percent')).toBe('12%')
    expect(uniqueName(SCHEMA, 'Status')).toBe('Status 2')
  })
})

// ── Editor ────────────────────────────────────────────────────────────────

async function mountEditor(props = {}) {
  const DatabaseView = (await import('../components/database/DatabaseView')).default
  const utils = render(<DatabaseView pageId="db1" onOpenRow={props.onOpenRow || vi.fn()} />)
  await screen.findByRole('tab', { name: /Table/ })
  await screen.findByText('File GST')
  return utils
}

describe('DatabaseView', () => {
  it('edits a cell in place and saves the row', async () => {
    await mountEditor()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Amount' })[0])
    const input = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.change(input, { target: { value: '₹2,500' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(calls.find(c => c[0] === 'updateRow')).toBeTruthy())
    expect(calls.find(c => c[0] === 'updateRow')).toEqual(['updateRow', 'db1', 'a', { props: { amount: 2500 } }])
    expect(await screen.findByText(/2,500/)).toBeInTheDocument()
  })

  it('renames a row through its title cell', async () => {
    await mountEditor()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Task' })[1])
    const input = screen.getByRole('textbox', { name: 'Task' })
    fireEvent.change(input, { target: { value: 'Pay office rent' } })
    fireEvent.blur(input)
    await waitFor(() => expect(calls.some(c => c[0] === 'updateRow' && c[3].title === 'Pay office rent')).toBe(true))
  })

  it('adds a property and saves the schema', async () => {
    await mountEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add a property' }))
    const dialog = await screen.findByRole('dialog', { name: 'New property' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Property name' }), { target: { value: 'Client' } })
    fireEvent.click(within(dialog).getByRole('menuitem', { name: /Text/ }))
    await waitFor(() => expect(calls.some(c => c[0] === 'saveSchema')).toBe(true))
    const saved = calls.find(c => c[0] === 'saveSchema')[2]
    expect(saved.properties.at(-1)).toMatchObject({ name: 'Client', type: 'text' })
    expect(await screen.findByRole('button', { name: 'Client' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit Client' })).toHaveLength(3)
  })

  it('builds a filter and queries the server with it', async () => {
    await mountEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Filter' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Property' }), { target: { value: 'status' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Value for Status' }), { target: { value: 'doing' } })
    await waitFor(() => {
      const q = calls.filter(c => c[0] === 'query').at(-1)
      expect(q[2].filter).toEqual({ op: 'and', rules: [{ prop: 'status', cmp: 'eq', value: 'doing' }] })
    }, { timeout: 2000 })
    await waitFor(() => expect(calls.some(c => c[0] === 'saveSchema')).toBe(true), { timeout: 2000 })
  })

  it('switches to the board and moves a card with the move handler', async () => {
    await mountEditor()
    fireEvent.click(screen.getByRole('tab', { name: /Board/ }))
    const board = await screen.findByRole('list', { name: 'Board by Status' })
    const doing = within(board).getByRole('listitem', { name: 'Doing' })
    const card = within(board).getByRole('button', { name: /^File GST/ })
    fireEvent.dragStart(card)
    fireEvent.dragOver(doing)
    fireEvent.drop(doing)
    await waitFor(() => expect(calls.some(c => c[0] === 'bulkUpdate')).toBe(true))
    const [, , updates] = calls.find(c => c[0] === 'bulkUpdate')
    expect(updates[0]).toMatchObject({ id: 'a', props: { status: 'doing' } })
    expect(updates[0].position).toBeGreaterThan(2)
    await waitFor(() => expect(within(within(board).getByRole('listitem', { name: 'Doing' })).getByText('File GST')).toBeInTheDocument())
  })
})

describe('BoardView', () => {
  it('calls onMove with the target column and index on drop', async () => {
    const BoardView = (await import('../components/database/BoardView')).default
    const onMove = vi.fn()
    render(<div className="fdb"><BoardView schema={SCHEMA} view={SCHEMA.views[1]} rows={ROWS} onMove={onMove} onAddRow={vi.fn()} /></div>)
    const todo = screen.getByRole('listitem', { name: 'To do' })
    fireEvent.dragStart(screen.getByRole('button', { name: /^Pay rent/ }))
    fireEvent.dragOver(todo)
    fireEvent.drop(todo)
    expect(onMove).toHaveBeenCalledWith('b', 'todo', 2)
    // the keyboard / touch alternative
    fireEvent.click(screen.getByRole('button', { name: 'Move Close books to another column' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Move card' })).getByText('Done'))
    expect(onMove).toHaveBeenLastCalledWith('c', 'done', 0)
  })
})

describe('CalendarView', () => {
  it('renders rows on their days and reschedules on drop', async () => {
    const CalendarView = (await import('../components/database/CalendarView')).default
    const onReschedule = vi.fn()
    render(<div className="fdb"><CalendarView schema={SCHEMA} view={SCHEMA.views[2]} rows={ROWS} initial={{ y: 2026, m: 9 }}
      onReschedule={onReschedule} onAddRow={vi.fn()} onUpdateView={vi.fn()} /></div>)
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    const fifth = screen.getByRole('gridcell', { name: /^2026-10-05, 2 entries/ })
    expect(within(fifth).getByText('File GST')).toBeInTheDocument()
    expect(within(fifth).getByText('Pay rent')).toBeInTheDocument()
    fireEvent.dragStart(screen.getByText('Close books'))
    const target = screen.getByRole('gridcell', { name: '2026-10-22' })
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(onReschedule).toHaveBeenCalledWith('c', '2026-10-22')
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
  })
})

describe('PublicDatabase', () => {
  it('renders the default view read-only with view tabs and links to published rows', async () => {
    const PublicDatabase = (await import('../components/database/PublicDatabase')).default
    const page = {
      content_type: 'database', metadata: { database: SCHEMA },
      database_rows: ROWS.map((r, i) => ({ ...r, slug: i === 0 ? 'file-gst' : null })),
    }
    render(<PublicDatabase page={page} />)
    expect(screen.getByRole('tab', { name: 'Table', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'File GST' })).toHaveAttribute('href', '/p/file-gst')
    expect(screen.queryByRole('link', { name: 'Pay rent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a property' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    expect(screen.getByRole('list', { name: 'Board by Status' })).toBeInTheDocument()
  })
})
