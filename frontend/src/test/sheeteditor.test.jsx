/**
 * The Pages spreadsheet editor: select and edit modes, keyboard movement,
 * ranges and the status bar, clipboard, undo, structural edits that rewrite
 * formulas, fill, sort, formats, find, the context menu, and how PagesManager
 * saves the sheet's formatting with the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SheetEditor from '../components/sheet/SheetEditor'
import { tidyFormula, fnFragment, fnContext, canPoint, fillTo, autoSumRange, percentEntry } from '../components/sheet/editorModel'
import { createEvaluator, csvToGrid } from '../utils/sheet'

const { calls, PAGES } = vi.hoisted(() => ({
  calls: { update: [], create: [] },
  PAGES: [{
    id: 's1', slug: 'budget', title: 'Budget', content_type: 'csv', is_published: false, view_count: 0,
    metadata: { folder: 'Finance', sheet: { v: 1, header: true, colFormats: { 1: { type: 'inr', decimals: 0 } } } },
  }],
}))

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok(PAGES),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 't', expires_in: 900 }),
        versions: ok({ items: [] }),
        get: vi.fn(async (id) => ({ ...PAGES.find(p => p.id === id), content: 'Item,Amount\nRent,45000\nFood,12000\nTotal,=SUM(B2:B3)' })),
        create: vi.fn(async (body) => { calls.create.push(body); return { id: 'new1', ...body, is_published: false } }),
        update: vi.fn(async (id, body) => { calls.update.push([id, body]); return { ...PAGES.find(p => p.id === id), ...body } }),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ status: 'authed', role: 'editor', authRole: 'user', user: { email: 'm@example.com' }, hasPerm: () => false }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
  calls.update = []
  calls.create = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})

const SAMPLE = 'Item,Qty,Price,Total\nPens,2,10,=B2*C2\nBooks,3,50,=B3*C3\nBags,1,400,=B4*C4\nSum,,,=SUM(D2:D4)'

// Holds value and meta the way PagesManager's form does, so changes round-trip.
function Harness({ csv, sheet, spy }) {
  const [value, setValue] = useState(csv)
  const [meta, setMeta] = useState(sheet)
  return (
    <div style={{ height: 600 }}>
      <SheetEditor value={value} meta={meta} height={600}
        onChange={(v) => { spy.change(v); setValue(v) }}
        onMetaChange={(m) => { spy.meta(m); setMeta(m) }} />
      <button type="button" onClick={() => setValue('A,B\n1,2')}>external</button>
    </div>
  )
}

function setup(csv = SAMPLE, sheet) {
  const spy = { change: vi.fn(), meta: vi.fn() }
  const utils = render(<Harness csv={csv} sheet={sheet} spy={spy} />)
  const root = utils.container
  const cell = (r, c) => root.querySelector(`[data-k="cell"][data-r="${r}"][data-c="${c}"]`)
  const text = (r, c) => cell(r, c)?.querySelector('.ft-sheet-txt')?.textContent
  const ta = () => root.querySelector('.ft-sheet-input')
  const name = () => screen.getByLabelText('Cell reference').value
  const click = (r, c, opts = {}) => {
    fireEvent.pointerDown(cell(r, c), { button: 0, pointerType: 'mouse', ...opts })
    fireEvent.pointerUp(window)
  }
  const key = (k, opts = {}) => fireEvent.keyDown(document.activeElement && root.contains(document.activeElement) ? document.activeElement : ta(), { key: k, ...opts })
  const type = (value) => fireEvent.change(ta(), { target: { value } })
  const lastCsv = () => spy.change.mock.calls.at(-1)?.[0]
  const lastMeta = () => spy.meta.mock.calls.at(-1)?.[0]
  const status = () => root.querySelector('.ft-sheet-status').textContent
  return { ...utils, root, spy, cell, text, ta, name, click, key, type, lastCsv, lastMeta, status }
}

describe('SheetEditor: select and edit modes', () => {
  it('computes formulas and renders a grid with headers', () => {
    const s = setup()
    expect(s.text(1, 3)).toBe('20')
    expect(s.text(4, 3)).toBe('570')
    const grid = screen.getByRole('grid')
    expect(grid).toHaveAttribute('aria-rowcount', '101')
    expect(grid).toHaveAttribute('aria-colcount', '27')
    expect(grid.querySelector('textarea, button')).toBeNull()
    expect(screen.getAllByRole('columnheader').map(h => h.textContent).slice(1, 5)).toEqual(['A', 'B', 'C', 'D'])
    expect(s.cell(0, 0)).toHaveClass('is-head')
  })

  it('typing replaces the active cell, Enter commits and moves down', () => {
    const s = setup()
    s.click(1, 0)
    expect(s.name()).toBe('A2')
    s.type('Markers')
    expect(s.ta()).not.toHaveClass('is-idle')
    expect(screen.getByLabelText('Cell contents').value).toBe('Markers')
    s.key('Enter')
    expect(s.text(1, 0)).toBe('Markers')
    expect(s.name()).toBe('A3')
    expect(s.lastCsv().split('\n')[1]).toBe('Markers,2,10,=B2*C2')
    expect(s.ta()).toHaveClass('is-idle')
  })

  it('Tab commits and moves right, Shift+Tab moves back; Esc cancels an edit', () => {
    const s = setup()
    s.click(1, 1)
    s.type('5')
    s.key('Tab')
    expect(s.name()).toBe('C2')
    expect(s.text(1, 3)).toBe('50')
    s.key('Tab', { shiftKey: true })
    expect(s.name()).toBe('B2')
    s.type('9')
    s.key('Escape')
    expect(s.text(1, 1)).toBe('5')
  })

  it('Enter and F2 edit in place keeping the content; arrows move the selection', () => {
    const s = setup()
    s.click(1, 3)
    s.key('Enter')
    expect(s.ta().value).toBe('=B2*C2')
    s.key('Escape')
    s.key('ArrowDown')
    expect(s.name()).toBe('D3')
    s.key('F2')
    expect(s.ta().value).toBe('=B3*C3')
    s.key('Escape')
    s.key('ArrowLeft')
    s.key('ArrowUp')
    expect(s.name()).toBe('C2')
    s.key('ArrowDown', { ctrlKey: true })
    expect(s.name()).toBe('C4')
  })

  it('tidies a committed formula: upper case and closing brackets', () => {
    const s = setup()
    s.click(4, 2)
    s.type('=sum(c2:c4')
    s.key('Enter')
    expect(s.lastCsv().split('\n')[4]).toBe('Sum,,=SUM(C2:C4),=SUM(D2:D4)')
    expect(s.text(4, 2)).toBe('460')
  })
})

describe('SheetEditor: ranges, clipboard and history', () => {
  it('Shift+arrow extends the range and the status bar sums it', () => {
    const s = setup()
    s.click(1, 3)
    s.key('ArrowDown', { shiftKey: true })
    s.key('ArrowDown', { shiftKey: true })
    expect(s.name()).toBe('D2:D4')
    expect(s.status()).toMatch(/Sum\s*570/)
    expect(s.status()).toMatch(/Average\s*190/)
    expect(s.status()).toMatch(/Count\s*3/)
    expect(s.cell(2, 3)).toHaveAttribute('aria-selected', 'true')
  })

  it('drag-selects a range with the mouse', () => {
    const s = setup()
    fireEvent.pointerDown(s.cell(1, 1), { button: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(s.cell(3, 2))
    fireEvent.pointerUp(window)
    expect(s.name()).toBe('B2:C4')
  })

  it('Delete clears the selection', () => {
    const s = setup()
    s.click(1, 1)
    s.click(2, 2, { shiftKey: true })
    s.key('Delete')
    expect(s.text(1, 1)).toBe('')
    expect(s.text(2, 2)).toBe('')
    expect(s.text(4, 3)).toBe('400')
    expect(s.lastCsv().split('\n').slice(1, 3)).toEqual(['Pens,,,=B2*C2', 'Books,,,=B3*C3'])
  })

  it('undoes and redoes cell edits and formatting', () => {
    const s = setup()
    s.click(1, 1)
    s.type('7')
    s.key('Enter')
    expect(s.text(1, 3)).toBe('70')
    fireEvent.change(screen.getByLabelText('Column format'), { target: { value: 'percent' } })
    expect(s.lastMeta().colFormats).toEqual({ 1: { type: 'percent' } })
    s.key('z', { ctrlKey: true })
    expect(s.lastMeta()?.colFormats).toBeUndefined()
    s.key('z', { ctrlKey: true })
    expect(s.text(1, 3)).toBe('20')
    expect(s.lastCsv().split('\n')[1]).toBe('Pens,2,10,=B2*C2')
    s.key('y', { ctrlKey: true })
    expect(s.text(1, 3)).toBe('70')
    s.key('z', { ctrlKey: true, shiftKey: true })
    expect(s.lastMeta().colFormats).toEqual({ 1: { type: 'percent' } })
  })

  it('copies the selection as TSV', () => {
    const s = setup()
    s.click(1, 0)
    s.click(2, 3, { shiftKey: true })
    const setData = vi.fn()
    fireEvent.copy(s.ta(), { clipboardData: { setData, getData: () => '' } })
    expect(setData).toHaveBeenCalledWith('text/plain', 'Pens\t2\t10\t20\nBooks\t3\t50\t150')
  })

  it('pastes TSV from Excel, growing the sheet to fit', () => {
    const s = setup()
    s.click(4, 3)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => 'x\ty\tz\r\n1\t"two\nlines"\t3\r\n' } })
    expect(s.status()).toMatch(/6 rows × 6 columns/)
    expect(s.name()).toBe('D5:F6')
    const rows = s.lastCsv().split('\n')
    expect(rows[4]).toBe('Sum,,,x,y,z')
    expect(s.lastCsv()).toContain('1,"two\nlines",3')
  })

  it('pastes formulas copied inside the sheet with their references shifted', () => {
    const s = setup('A,B,C,D,E\n1,2,=A2*B2,,\n3,4,,,')
    s.click(1, 2)
    let copied = ''
    fireEvent.copy(s.ta(), { clipboardData: { setData: (_, v) => { copied = v } } })
    expect(copied).toBe('2')
    s.click(2, 2)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => copied } })
    expect(s.lastCsv().split('\n')[2]).toBe('3,4,=A3*B3,,')
    expect(s.text(2, 2)).toBe('12')
    s.click(1, 4)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => 'plain' } })
    expect(s.text(1, 4)).toBe('plain')
  })

  it('cut leaves the cells until the paste, which moves them unchanged', () => {
    const s = setup('A,B,C,D,E\n1,2,=A2*B2,,\n3,4,,,')
    s.click(1, 2)
    let copied = ''
    fireEvent.cut(s.ta(), { clipboardData: { setData: (_, v) => { copied = v } } })
    expect(s.text(1, 2)).toBe('2')
    expect(s.spy.change).not.toHaveBeenCalled()
    expect(s.root.querySelector('.ft-sheet-cut')).not.toBeNull()
    s.click(1, 4)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => copied } })
    expect(s.lastCsv().split('\n')[1]).toBe('1,2,,,=A2*B2')
    expect(s.root.querySelector('.ft-sheet-cut')).toBeNull()
    s.key('z', { ctrlKey: true })
    expect(s.lastCsv().split('\n')[1]).toBe('1,2,=A2*B2,,')
  })

  it('pasting a cut makes the formulas that used the cells follow them', () => {
    const s = setup('Item,Qty,Price,Total,,\nPens,2,10,=B2*C2,,')
    s.click(1, 1)
    let copied = ''
    fireEvent.cut(s.ta(), { clipboardData: { setData: (_, v) => { copied = v } } })
    s.click(1, 5)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => copied } })
    expect(s.lastCsv().split('\n')[1]).toBe('Pens,,10,=F2*C2,,2')
    expect(s.text(1, 3)).toBe('20')
    s.click(1, 4)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => copied } })
    expect(s.lastCsv().split('\n')[1]).toBe('Pens,,10,=F2*C2,2,2')
  })

  it('Esc or an edit cancels a cut', () => {
    const s = setup('A,B\n1,2')
    s.click(1, 0)
    let copied = ''
    fireEvent.cut(s.ta(), { clipboardData: { setData: (_, v) => { copied = v } } })
    s.key('Escape')
    expect(s.root.querySelector('.ft-sheet-cut')).toBeNull()
    s.click(1, 1)
    fireEvent.paste(s.ta(), { clipboardData: { getData: () => copied } })
    expect(s.lastCsv().split('\n')[1]).toBe('1,1')
    s.click(1, 0)
    fireEvent.cut(s.ta(), { clipboardData: { setData: (_, v) => { copied = v } } })
    s.click(0, 0)
    s.type('Head')
    s.key('Enter')
    expect(s.root.querySelector('.ft-sheet-cut')).toBeNull()
    expect(s.text(1, 0)).toBe('1')
  })

  it('an external value change resets the grid and can be undone', () => {
    const s = setup()
    s.click(1, 0)
    s.type('Edited')
    s.key('Enter')
    fireEvent.click(screen.getByText('external'))
    expect(s.text(1, 0)).toBe('1')
    expect(s.status()).toMatch(/2 rows × 2 columns/)
    s.key('z', { ctrlKey: true })
    expect(s.text(1, 0)).toBe('Edited')
  })
})

describe('SheetEditor: structure, fill, sort and formats', () => {
  it('inserting and deleting rows rewrites a dependent formula', () => {
    const s = setup()
    s.click(2, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Insert row above' }))
    let rows = s.lastCsv().split('\n')
    expect(rows).toHaveLength(6)
    expect(rows[2]).toBe(',,,')
    expect(rows[5]).toBe('Sum,,,=SUM(D2:D5)')
    expect(rows[3]).toBe('Books,3,50,=B4*C4')
    s.click(1, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete row' }))
    rows = s.lastCsv().split('\n')
    expect(rows[4]).toBe('Sum,,,=SUM(D2:D4)')
    expect(s.text(4, 3)).toBe('550')
  })

  it('inserting a column shifts formulas and the column formats', () => {
    const s = setup(SAMPLE, { v: 1, colFormats: { 3: { type: 'inr' } }, colWidths: { 3: 150 } })
    s.click(1, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Insert column left' }))
    expect(s.lastCsv().split('\n')[1]).toBe('Pens,,2,10,=C2*D2')
    expect(s.lastMeta().colFormats).toEqual({ 4: { type: 'inr' } })
    expect(s.lastMeta().colWidths).toEqual({ 4: 150 })
    expect(s.text(1, 4)).toBe('₹20.00')
  })

  it('Ctrl+D fills down, shifting relative references', () => {
    const s = setup('A,B,C\n1,2,=A2*B2\n3,4,\n5,6,')
    s.click(1, 2)
    s.click(3, 2, { shiftKey: true })
    s.key('d', { ctrlKey: true })
    const rows = s.lastCsv().split('\n')
    expect(rows[2]).toBe('3,4,=A3*B3')
    expect(rows[3]).toBe('5,6,=A4*B4')
    expect(s.text(3, 2)).toBe('30')
  })

  it('the fill handle continues a series and copies formulas', () => {
    const s = setup('N,F\n1,=A2*10\n2,\n,\n,')
    s.click(1, 0)
    s.click(2, 0, { shiftKey: true })
    const handle = s.root.querySelector('[data-k="fill"]')
    expect(handle).not.toBeNull()
    fireEvent.pointerDown(handle, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(s.cell(4, 0))
    fireEvent.pointerUp(window)
    expect(s.lastCsv().split('\n').map(r => r.split(',')[0])).toEqual(['N', '1', '2', '3', '4'])
    s.click(1, 1)
    fireEvent.pointerDown(s.root.querySelector('[data-k="fill"]'), { button: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(s.cell(3, 1))
    fireEvent.pointerUp(window)
    expect(s.lastCsv().split('\n')[3]).toBe('3,=A4*10')
    expect(s.text(3, 1)).toBe('30')
  })

  it('sorting keeps the header row on top', () => {
    const s = setup()
    s.click(2, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Sort Z to A by this column' }))
    const rows = s.lastCsv().split('\n')
    expect(rows[0]).toBe('Item,Qty,Price,Total')
    expect(rows[1]).toBe('Bags,1,400,=B2*C2')
    expect(rows[3]).toBe('Pens,2,10,=B4*C4')
    expect(rows[4]).toBe('Sum,,,=SUM(D2:D4)')
  })

  it('the column format, decimals, alignment and wrap are written to meta', () => {
    const s = setup()
    s.click(1, 2)
    fireEvent.change(screen.getByLabelText('Column format'), { target: { value: 'inr' } })
    expect(s.lastMeta()).toEqual({ v: 1, colFormats: { 2: { type: 'inr' } } })
    expect(s.text(3, 2)).toBe('₹400.00')
    fireEvent.click(screen.getByRole('button', { name: /fewer decimal places/ }))
    expect(s.lastMeta().colFormats[2]).toEqual({ type: 'inr', decimals: 1 })
    expect(s.text(3, 2)).toBe('₹400.0')
    fireEvent.click(screen.getByRole('button', { name: 'Align centre' }))
    expect(s.lastMeta().colAlign).toEqual({ 2: 'center' })
    expect(screen.getByRole('button', { name: 'Align centre' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Wrap text' }))
    expect(s.lastMeta().wrap).toEqual({ 2: true })
    fireEvent.click(screen.getByRole('button', { name: 'Header row' }))
    expect(s.lastMeta().header).toBe(false)
    expect(s.cell(0, 0)).not.toHaveClass('is-head')
  })

  it('resizing a column header writes its width', () => {
    const s = setup()
    const grip = s.root.querySelector('[data-k="resize"][data-c="1"]')
    fireEvent.pointerDown(grip, { button: 0, pointerType: 'mouse', clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 160 })
    fireEvent.pointerUp(window)
    expect(s.lastMeta().colWidths).toEqual({ 1: 180 })
  })

  it('AutoSum on a multi-row selection writes SUM formulas below it', () => {
    const s = setup('A,B\n1,2\n3,4')
    s.click(1, 0)
    s.click(2, 1, { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'AutoSum' }))
    expect(s.lastCsv().split('\n')[3]).toBe('=SUM(A2:A3),=SUM(B2:B3)')
    expect(s.text(3, 1)).toBe('6')
  })
})

describe('SheetEditor: formulas, find and menus', () => {
  it('suggests functions while a formula is typed and Tab picks one', () => {
    const s = setup()
    s.click(4, 1)
    s.type('=SU')
    const list = screen.getByRole('listbox', { name: 'Functions' })
    expect(within(list).getAllByRole('option').map(o => o.textContent.split('(')[0])).toEqual(['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT'])
    expect(screen.getByText('Adds the numbers.')).toBeInTheDocument()
    s.key('ArrowDown')
    s.key('Tab')
    expect(s.ta().value).toBe('=SUMIF(')
  })

  it('clicking a cell while a formula waits for an argument inserts its reference', () => {
    const s = setup()
    s.click(4, 1)
    s.type('=SUM(')
    s.click(1, 1)
    expect(s.ta().value).toBe('=SUM(B2')
    s.click(3, 1, { shiftKey: true })
    expect(s.ta().value).toBe('=SUM(B2:B4')
    expect(s.cell(2, 1).style.boxShadow).toMatch(/inset/)
    s.key('Enter')
    expect(s.text(4, 1)).toBe('6')
  })

  it('find highlights matches and moves between them', async () => {
    const s = setup()
    s.key('f', { ctrlKey: true })
    const input = screen.getByLabelText('Find in sheet')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'b' } })
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument())
    expect(s.cell(2, 0).style.backgroundImage).toMatch(/ft-sheet-find/)
    expect(s.cell(3, 0).style.backgroundImage).toMatch(/ft-sheet-find/)
    expect(s.name()).toBe('A3')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.name()).toBe('A4')
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Find in sheet')).toBeNull()
  })

  it('opens the context menu from the keyboard and runs an item', () => {
    const s = setup()
    s.click(2, 0)
    s.key('F10', { shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Cell actions' })
    const items = within(menu).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    expect(items.map(i => i.textContent)).toEqual(expect.arrayContaining(['Insert row above', 'Delete row 3', 'Clear contents' + 'Del']))
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    s.key('ContextMenu')
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete row 3'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(s.lastCsv().split('\n')).toHaveLength(4)
    expect(s.lastCsv().split('\n')[3]).toBe('Sum,,,=SUM(D2:D3)')
  })

  it('opens the context menu on right-click', () => {
    const s = setup()
    fireEvent.pointerDown(s.cell(3, 1), { button: 2, pointerType: 'mouse' })
    fireEvent.contextMenu(s.cell(3, 1), { clientX: 50, clientY: 60 })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(s.name()).toBe('B4')
  })

  it('shows an error with its meaning', () => {
    const s = setup('A,B\n1,=A2/0')
    expect(s.text(1, 1)).toBe('#DIV/0!')
    expect(s.cell(1, 1)).toHaveClass('is-err')
    expect(s.cell(1, 1).title).toMatch(/Division by zero/)
  })

  it('jumps to a reference typed in the name box', () => {
    const s = setup()
    const box = screen.getByLabelText('Cell reference')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'c3:d5' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(s.name()).toBe('C3:D5')
  })

  it('announces the active cell to screen readers', async () => {
    const s = setup()
    s.click(1, 3)
    await waitFor(() => expect(s.root.querySelector('[aria-live="polite"].sr-only').textContent).toBe('D2, 20, formula =B2*C2'))
  })

  it('renders only the visible part of a 5,000-row sheet', () => {
    const rows = ['A,B,C,D']
    for (let i = 2; i <= 5001; i++) rows.push(`${i},${i * 2},x,=A${i}+B${i}`)
    const s = setup(rows.join('\n'))
    expect(s.root.querySelectorAll('[role="gridcell"]').length).toBeLessThan(400)
    expect(s.status()).toMatch(/5,001 rows × 4 columns/)
    s.key('End', { ctrlKey: true })
    expect(s.name()).toBe('D5001')
    expect(screen.getByLabelText('Cell contents').value).toBe('=A5001+B5001')
  })
})

describe('SheetEditor: like Excel past the data', () => {
  it('shows blank rows and columns past the data and writes only what is typed', () => {
    const s = setup('A,B\n1,2')
    s.click(1, 1)
    s.key('ArrowDown')
    expect(s.name()).toBe('B3')
    s.key('ArrowRight')
    expect(s.name()).toBe('C3')
    s.type('7')
    s.key('Tab')
    expect(s.name()).toBe('D3')
    expect(s.lastCsv()).toBe('A,B,\n1,2,\n,,7')
    expect(s.status()).toMatch(/3 rows × 3 columns/)
    s.key('ArrowDown', { ctrlKey: true })
    expect(s.name()).toBe('D100')
  })

  it('Enter after a run of Tabs goes to the next row of the column the run began in', () => {
    const s = setup('Item,Budget,Actual,Diff\n,,,')
    s.click(1, 0)
    s.type('Rent')
    s.key('Tab')
    s.type('25000')
    s.key('Tab')
    s.type('24000')
    s.key('Tab')
    s.type('=B2-C2')
    s.key('Enter')
    expect(s.name()).toBe('A3')
    s.type('Food')
    s.key('Tab')
    s.key('Tab')
    s.key('Enter')
    expect(s.name()).toBe('A4')
    expect(s.lastCsv().split('\n').slice(1, 3)).toEqual(['Rent,25000,24000,=B2-C2', 'Food,,,'])
    s.key('Tab')
    s.key('ArrowDown')
    s.key('Enter')
    expect(s.ta()).not.toHaveClass('is-idle')
  })

  it('sorts only the selected rows, leaving a total row below alone', () => {
    const s = setup('Item,Amount\nRent,100\nFood,300\nTravel,200\nTotal,=SUM(B2:B4)')
    s.click(1, 0)
    s.click(3, 1, { shiftKey: true })
    s.key('Tab')
    fireEvent.click(screen.getByRole('button', { name: 'Sort Z to A by this column' }))
    expect(s.lastCsv().split('\n')).toEqual(['Item,Amount', 'Food,300', 'Travel,200', 'Rent,100', 'Total,=SUM(B2:B4)'])
    expect(s.text(4, 1)).toBe('600')
    expect(s.status()).toMatch(/Sorted A2:B4 by column B/)
  })

  it('reads a whole number typed into a Percent column as that many percent', () => {
    const s = setup('Name,Share\nA,\nB,\nC,', { v: 1, colFormats: { 1: { type: 'percent', decimals: 1 } } })
    s.click(1, 1)
    s.type('15')
    s.key('Enter')
    s.type('0.25')
    s.key('Enter')
    s.type('=1/8')
    s.key('Enter')
    expect(s.lastCsv().split('\n').slice(1)).toEqual(['A,15%', 'B,0.25', 'C,=1/8'])
    expect([s.text(1, 1), s.text(2, 1), s.text(3, 1)]).toEqual(['15.0%', '25.0%', '12.5%'])
  })

  it('shows the selection total in the column format', () => {
    const s = setup('Name,Share,Amount\nA,0.1,100\nB,0.25,250', { v: 1, colFormats: { 1: { type: 'percent', decimals: 1 }, 2: { type: 'inr', decimals: 0 } } })
    s.click(1, 1)
    s.click(2, 1, { shiftKey: true })
    expect(s.status()).toMatch(/Sum\s*35\.0%/)
    expect(s.status()).toMatch(/Average\s*17\.5%/)
    s.click(1, 2)
    s.click(2, 2, { shiftKey: true })
    expect(s.status()).toMatch(/Average\s*₹175/)
    s.click(1, 1)
    s.click(2, 2, { shiftKey: true })
    expect(s.status()).toMatch(/Sum\s*350\.35/)
  })

  it('AutoSum steps over a blank spacer row', () => {
    const s = setup('Amount\n10\n20\n\nx')
    s.click(4, 0)
    s.key('=', { altKey: true })
    expect(s.ta().value).toBe('=SUM(A2:A4)')
  })
})

describe('SheetEditor: keyboard and screen readers', () => {
  it('Tab at the last column and Shift+Tab at the first leave the grid; Esc goes to the toolbar', () => {
    const s = setup('A,B\n1,2')
    s.click(1, 0)
    expect(fireEvent.keyDown(s.ta(), { key: 'Tab', shiftKey: true })).toBe(true)
    const box = screen.getByLabelText('Cell reference')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'Z2' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(s.name()).toBe('Z2')
    expect(fireEvent.keyDown(s.ta(), { key: 'Tab' })).toBe(true)
    s.click(1, 1)
    expect(fireEvent.keyDown(s.ta(), { key: 'Tab' })).toBe(false)
    s.key('Escape')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Insert row above' }))
  })

  it('keeps focus on a toolbar button used from the keyboard', () => {
    const s = setup()
    s.click(1, 0)
    const btn = screen.getByRole('button', { name: 'Insert row below' })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'Enter' })
    fireEvent.click(btn, { detail: 0 })
    expect(s.lastCsv().split('\n')).toHaveLength(6)
    expect(document.activeElement).toBe(btn)
    fireEvent.pointerDown(btn)
    fireEvent.click(btn, { detail: 1 })
    expect(document.activeElement).toBe(s.ta())
  })

  it('menu buttons say they open a menu, and focus comes back to them', () => {
    setup()
    const freeze = screen.getByRole('button', { name: 'Freeze rows and columns' })
    expect(freeze).toHaveAttribute('aria-haspopup', 'menu')
    expect(freeze).toHaveAttribute('aria-expanded', 'false')
    freeze.focus()
    fireEvent.keyDown(freeze, { key: 'Enter' })
    fireEvent.click(freeze, { detail: 0 })
    const menu = screen.getByRole('menu', { name: 'Freeze' })
    expect(freeze).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(freeze)
  })

  it('announces a range and its sum while it is extended', async () => {
    const s = setup()
    s.click(1, 3)
    s.key('ArrowDown', { shiftKey: true })
    s.key('ArrowDown', { shiftKey: true })
    await waitFor(() => expect(s.root.querySelector('[aria-live="polite"].sr-only').textContent).toBe('D2:D4 selected, 3 cells, sum 570'))
  })

  it('keeps one status region mounted for messages', () => {
    const s = setup()
    const region = s.root.querySelector('[role="status"]')
    expect(region).not.toBeNull()
    s.click(1, 0)
    fireEvent.copy(s.ta(), { clipboardData: { setData: () => {} } })
    expect(s.root.querySelector('[role="status"]')).toBe(region)
    expect(region.textContent).toBe('Copied A2')
  })

  it('changes a column width from the keyboard and the column menu', () => {
    const s = setup()
    s.click(1, 1)
    s.key('ArrowRight', { altKey: true, shiftKey: true })
    expect(s.lastMeta().colWidths).toEqual({ 1: 128 })
    fireEvent.pointerDown(s.root.querySelector('[data-k="col"][data-c="2"]'), { button: 2, pointerType: 'mouse' })
    fireEvent.contextMenu(s.root.querySelector('[data-k="col"][data-c="2"]'), { clientX: 50, clientY: 20 })
    fireEvent.click(within(screen.getByRole('menu')).getByText('Column width…'))
    const input = screen.getByLabelText('Width of column C')
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '200' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(s.lastMeta().colWidths).toEqual({ 1: 128, 2: 200 })
    expect(within(screen.getByRole('grid')).queryByRole('menuitem')).toBeNull()
  })

  it('labels the delete buttons with the words they show', () => {
    const s = setup()
    s.click(1, 0)
    expect(screen.getByRole('button', { name: 'Delete row' })).toHaveTextContent('Row')
    expect(screen.getByRole('button', { name: 'Delete column' })).toHaveTextContent('Column')
    s.click(2, 1, { shiftKey: true })
    expect(screen.getByRole('button', { name: 'Delete rows' })).toHaveTextContent('Rows')
    expect(screen.getByRole('button', { name: 'Delete columns' })).toHaveTextContent('Columns')
  })
})

describe('editor helpers', () => {
  it('tidyFormula upper-cases names and references and closes brackets', () => {
    expect(tidyFormula('=sum(a1:b2')).toBe('=SUM(A1:B2)')
    expect(tidyFormula('=if(a1>0,"keep lower",b:b')).toBe('=IF(A1>0,"keep lower",B:B)')
    expect(tidyFormula('plain text')).toBe('plain text')
  })

  it('knows when a reference can be pointed at and what function is being typed', () => {
    expect(canPoint('=SUM(', 5)).toBe(true)
    expect(canPoint('=A1', 3)).toBe(false)
    expect(canPoint('="a', 3)).toBe(false)
    expect(fnFragment('=ro', 3).matches).toEqual(['ROUND', 'ROUNDDOWN', 'ROUNDUP'])
    expect(fnFragment('=A1', 3)).toBeNull()
    expect(fnContext('=IF(A1>0, SUM(B1', 16)).toEqual({ name: 'SUM', arg: 0 })
    expect(fnContext('=IF(A1>0, 2', 11)).toEqual({ name: 'IF', arg: 1 })
  })

  it('fills up and left as well as down and right', () => {
    const grid = csvToGrid(',\n,\n3,=A3\n4,')
    const up = fillTo(grid, { r1: 2, c1: 0, r2: 3, c2: 0 }, 0, 0)
    expect(up.grid.map(r => r[0])).toEqual(['1', '2', '3', '4'])
    const left = fillTo(csvToGrid(',=C1,5'), { r1: 0, c1: 1, r2: 0, c2: 1 }, 0, 0)
    expect(left.grid[0][0]).toBe('=B1')
    const off = fillTo(csvToGrid(',=A1'), { r1: 0, c1: 1, r2: 0, c2: 1 }, 0, 0)
    expect(off.grid[0][0]).toBe('=#REF!')
  })

  it('AutoSum finds the numbers above a cell, stepping over blanks', () => {
    const ev = createEvaluator(csvToGrid('Amount\n10\n20\n'))
    expect(autoSumRange(ev, 3, 0)).toEqual({ r1: 1, c1: 0, r2: 2, c2: 0 })
    const gap = createEvaluator(csvToGrid('Amount,\n10,\n20,\n,\n,\n,'))
    expect(autoSumRange(gap, 5, 0)).toEqual({ r1: 1, c1: 0, r2: 4, c2: 0 })
    expect(autoSumRange(createEvaluator(csvToGrid('a,,5,,')), 0, 4)).toEqual({ r1: 0, c1: 2, r2: 0, c2: 3 })
    expect(autoSumRange(createEvaluator(csvToGrid('Head\n\n')), 2, 0)).toBeNull()
  })

  it('percentEntry follows Excel for typed numbers', () => {
    expect(percentEntry('15')).toBe('15%')
    expect(percentEntry('-2.5')).toBe('-2.5%')
    expect(percentEntry('1,200')).toBe('1,200%')
    expect(percentEntry('0.15')).toBe('0.15')
    expect(percentEntry('15%')).toBe('15%')
    expect(percentEntry('=A1')).toBe('=A1')
    expect(percentEntry('n/a')).toBe('n/a')
  })
})

describe('PagesManager spreadsheet pages', () => {
  async function openSheet() {
    const PagesManager = (await import('../pages/PagesManager')).default
    render(<MemoryRouter><PagesManager /></MemoryRouter>)
    fireEvent.click((await screen.findAllByRole('button', { name: /Edit/ }))[0])
    await waitFor(() => expect(document.querySelector('.ft-sheet [data-r="3"][data-c="1"]')?.textContent).toBe('₹57,000'))
  }

  it('opens a sheet with its saved formats and saves format changes with the page', async () => {
    await openSheet()
    const cell = document.querySelector('.ft-sheet [data-k="cell"][data-r="1"][data-c="1"]')
    fireEvent.pointerDown(cell, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(window)
    fireEvent.change(screen.getByLabelText('Column format'), { target: { value: 'number' } })
    await waitFor(() => expect(calls.update.length).toBeGreaterThan(0), { timeout: 3000 })
    const [id, body] = calls.update.at(-1)
    expect(id).toBe('s1')
    expect(body.metadata.sheet.colFormats).toEqual({ 1: { type: 'number', decimals: 0 } })
    expect(body.metadata.folder).toBe('Finance')
    expect(body.content).toBe('Item,Amount\nRent,45000\nFood,12000\nTotal,=SUM(B2:B3)')
  })

  it('a template brings its formulas and formats', async () => {
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Budget vs actual/ })) })
    await waitFor(() => expect(document.querySelector('.ft-sheet [data-r="8"][data-c="1"]')?.textContent).toBe('₹5,18,000'))
    expect(document.querySelector('.ft-sheet [data-r="2"][data-c="4"]').textContent).toBe('-3.4%')
    await waitFor(() => expect(calls.update.length).toBeGreaterThan(0), { timeout: 3000 })
    const body = calls.update.at(-1)[1]
    expect(body.metadata.sheet.colFormats[4]).toEqual({ type: 'percent', decimals: 1 })
    expect(body.content.split('\n')[8]).toBe('Total,=SUM(B2:B8),=SUM(C2:C8),=B9-C9,"=IF(B9=0,0,D9/B9)",')
  })

  it('previews a saved version with that version\'s formats', async () => {
    const { api } = await import('../services/api')
    const ver = {
      id: 9, version_num: 2, title: 'Budget', content_type: 'csv', saved_at: '2026-10-01T10:00:00Z',
      content: 'Item,Amount\nRent,45000', metadata: { sheet: { v: 1, colFormats: { 1: { type: 'inr', decimals: 2 } } } },
    }
    api.pages.versions.mockResolvedValueOnce({ items: [ver] })
    api.pages.getVersion = vi.fn(async () => ver)
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(await screen.findByText('v2'))
    await waitFor(() => expect(document.querySelector('.ft-sv tbody td:nth-child(2)')?.textContent).toBe('₹45,000.00'))
  })

  it('restoring a version brings back that version\'s formatting too', async () => {
    const { api } = await import('../services/api')
    const ver = {
      id: 9, version_num: 2, title: 'Budget', content_type: 'csv', saved_at: '2026-10-01T10:00:00Z',
      content: 'Item,Amount\nRent,45000', metadata: { sheet: { v: 1, colFormats: { 1: { type: 'inr', decimals: 2 } } } },
    }
    api.pages.versions.mockResolvedValue({ items: [ver] })
    api.pages.getVersion = vi.fn(async () => ver)
    api.pages.restoreVersion = vi.fn(async () => ({ ok: true, page: { ...PAGES[0], content: ver.content } }))
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(await screen.findByText('v2'))
    fireEvent.click(await screen.findByRole('button', { name: /Restore this version/ }))
    await waitFor(() => expect(calls.update).toHaveLength(1))
    const [id, body] = calls.update[0]
    expect(id).toBe('s1')
    expect(body).toEqual({ metadata: { folder: 'Finance', sheet: ver.metadata.sheet } })
    api.pages.versions.mockResolvedValue({ items: [] })
  })

  it('a new spreadsheet starts from the Blank template', async () => {
    const { api } = await import('../services/api')
    api.pages.list.mockResolvedValueOnce([])
    const PagesManager = (await import('../pages/PagesManager')).default
    render(<MemoryRouter><PagesManager /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Spreadsheet' }))
    await waitFor(() => expect(document.querySelector('.ft-sheet [data-r="0"][data-c="5"]')?.textContent).toBe('Column F'))
    expect(document.querySelector('.ft-sheet-status').textContent).toMatch(/21 rows × 6 columns/)
  })
})
