import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SheetView from '../components/sheet/SheetView'
import { downloadBlob } from '../utils/download'

vi.mock('../utils/download', () => ({ downloadBlob: vi.fn() }))

vi.mock('../services/api', () => ({
  api: { pages: {
    publicGet: vi.fn(),
    publicLogView: vi.fn(async () => ({})),
  } },
  API_BASE_URL: 'https://api.example',
}))

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').filter(tr => tr.parentElement.tagName === 'TBODY')
const firstColumn = () => bodyRows().map(tr => tr.cells[0].textContent)
const headerCell = name => screen.getByRole('columnheader', { name: new RegExp(name) })

beforeEach(() => vi.mocked(downloadBlob).mockClear())

describe('SheetView formats', () => {
  const csv = 'Item,Amount,Share,Due,Qty\nRent,120000,0.25,2026-10-15,3\nFees,=B2/4,=B3/B2,"=DATE(2026,1,5)",=E2*2\nBad,=1/0,,,'
  const meta = { colFormats: { 1: { type: 'inr', decimals: 2 }, 2: { type: 'percent' }, 3: { type: 'date' }, 4: { type: 'number', decimals: 1 } } }

  it('computes formulas and applies the column formats', () => {
    render(<SheetView text={csv} meta={meta} />)
    const [rent, fees, bad] = bodyRows()
    expect([...rent.cells].map(td => td.textContent)).toEqual(['Rent', '₹1,20,000.00', '25%', '15 Oct 2026', '3.0'])
    expect([...fees.cells].map(td => td.textContent)).toEqual(['Fees', '₹30,000.00', '25%', '05 Jan 2026', '6.0'])
    expect(bad.cells[1]).toHaveTextContent('#DIV/0!')
    expect(bad.cells[1]).toHaveClass('ft-sv-err')
    expect(bad.cells[1]).toHaveAttribute('title', 'Division by zero.')
  })

  it('right-aligns numbers and leaves text left unless the column says otherwise', () => {
    render(<SheetView text={csv} meta={{ ...meta, colAlign: { 0: 'center' } }} />)
    const [rent] = bodyRows()
    expect(rent.cells[0]).toHaveClass('ft-sv-c')
    expect(rent.cells[1]).toHaveClass('ft-sv-r')
    expect(headerCell('Amount')).toHaveClass('ft-sv-r')
  })

  it('shows old sheets without metadata as before: first row is the header', () => {
    render(<SheetView text={'Name,Total\nA,"=SUM(1,2)"'} />)
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Name', 'Total'])
    expect([...bodyRows()[0].cells].map(td => td.textContent)).toEqual(['A', '3'])
    expect(screen.getByText('1 row')).toBeInTheDocument()
  })

  it('treats every row as data when the header row is off', () => {
    render(<SheetView text={'b,2\na,1\nc,3'} meta={{ header: false }} />)
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['A', 'B'])
    expect(firstColumn()).toEqual(['b', 'a', 'c'])
    expect(screen.getByText('3 rows')).toBeInTheDocument()
    fireEvent.click(within(headerCell('A')).getByRole('button'))
    expect(firstColumn()).toEqual(['a', 'b', 'c'])
  })

  it('wraps and freezes the columns the sheet asks for', () => {
    render(<SheetView text={'Name,Note\nA,long text'} meta={{ wrap: { 1: true }, freezeCols: 1, colWidths: { 0: 140 } }} />)
    const [row] = bodyRows()
    expect(row.cells[0]).toHaveClass('ft-sv-fz')
    expect(row.cells[1]).toHaveClass('ft-sv-wrap')
    expect(row.cells[1]).not.toHaveClass('ft-sv-fz')
    expect(screen.getByRole('table').querySelector('col').style.width).toBe('140px')
    expect(headerCell('Name')).toHaveClass('ft-sv-pin')
  })

  it('does not stick the header row when the sheet freezes nothing', () => {
    render(<SheetView text={'Name\nA'} meta={{ freezeRows: 0 }} />)
    expect(headerCell('Name')).not.toHaveClass('ft-sv-pin')
  })

  it('drops trailing blank rows and columns but keeps blank rows inside the data', () => {
    render(<SheetView text={'Name,Total,,\nA,1,,\n,,,\nB,2,,\n,,,\n,,,'} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(firstColumn()).toEqual(['A', '', 'B'])
  })

  it('keeps frozen data rows in search and sort, and counts them', () => {
    const { unmount } = render(<SheetView text={'a,1\nb,2\nc,3\nd,4'} meta={{ header: false, freezeRows: 1 }} />)
    expect(screen.getByText('4 rows')).toBeInTheDocument()
    expect(screen.getByText('a').closest('td')).toHaveClass('ft-sv-pin')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'd' } })
    expect(firstColumn()).toEqual(['d'])
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.getByText('1 of 4 rows')).toBeInTheDocument()
    unmount()
    render(<SheetView text={'Name,N\nz,1\ny,2\nx,3\nw,4'} meta={{ freezeRows: 3 }} />)
    expect(screen.getByText('4 rows')).toBeInTheDocument()
    expect(firstColumn()).toEqual(['x', 'w'])
    expect(screen.getByText('z').closest('td')).toHaveClass('ft-sv-pin')
    fireEvent.click(within(headerCell('Name')).getByRole('button'))
    expect(firstColumn()).toEqual(['w', 'x', 'y', 'z'])
  })

  it('puts an error\'s meaning in the cell for touch screens and screen readers', () => {
    render(<SheetView text={'A,B\n1,=A2/0'} />)
    const cell = bodyRows()[0].cells[1]
    expect(cell.querySelector('.ft-sv-why')).toHaveTextContent('(Division by zero.)')
  })

  it('says so when the sheet is empty', () => {
    render(<SheetView text="" />)
    expect(screen.getByText('This sheet is empty.')).toBeInTheDocument()
  })
})

describe('SheetView sorting and search', () => {
  const csv = 'Client,Amount\nZeta,"1,200"\nalpha,"₹15,000"\nBeta,=B2*2\nNone,\nItem 10,5\nItem 2,7'

  it('cycles a header click through ascending, descending and the original order', () => {
    render(<SheetView text={csv} />)
    const original = firstColumn()
    const amount = headerCell('Amount')
    const button = within(amount).getByRole('button')
    fireEvent.click(button)
    expect(amount).toHaveAttribute('aria-sort', 'ascending')
    expect(firstColumn()).toEqual(['Item 10', 'Item 2', 'Zeta', 'Beta', 'alpha', 'None'])
    fireEvent.click(button)
    expect(amount).toHaveAttribute('aria-sort', 'descending')
    expect(firstColumn()).toEqual(['alpha', 'Beta', 'Zeta', 'Item 2', 'Item 10', 'None'])
    fireEvent.click(button)
    expect(amount).toHaveAttribute('aria-sort', 'none')
    expect(firstColumn()).toEqual(original)
  })

  it('sorts text naturally and clears the sort from the toolbar', () => {
    render(<SheetView text={csv} />)
    fireEvent.click(within(headerCell('Client')).getByRole('button'))
    expect(firstColumn()).toEqual(['alpha', 'Beta', 'Item 2', 'Item 10', 'None', 'Zeta'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear sort' }))
    expect(firstColumn()[0]).toBe('Zeta')
    expect(screen.queryByRole('button', { name: 'Clear sort' })).toBeNull()
  })

  it('filters rows on the displayed values, counts them and marks the matches', () => {
    render(<SheetView text={csv} meta={{ colFormats: { 1: { type: 'inr', decimals: 0 } } }} />)
    const search = screen.getByRole('searchbox', { name: 'Search rows' })
    fireEvent.change(search, { target: { value: 'item' } })
    expect(firstColumn()).toEqual(['Item 10', 'Item 2'])
    expect(screen.getByText('2 of 6 rows')).toBeInTheDocument()
    expect([...screen.getByRole('table').querySelectorAll('mark')].map(m => m.textContent)).toEqual(['Item', 'Item'])
    fireEvent.change(search, { target: { value: '₹2,400' } })
    expect(firstColumn()).toEqual(['Beta'])
    fireEvent.change(search, { target: { value: 'nothing here' } })
    expect(screen.getByText('No rows match “nothing here”.')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(bodyRows()).toHaveLength(6)
  })

  it('never filters or sorts away the header row', () => {
    render(<SheetView text={csv} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zeta' } })
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Client', 'Amount'])
  })
})

describe('SheetView download and protection', () => {
  it('downloads the computed values of the rows in view', async () => {
    render(<SheetView text={'Name,Total,When\nB,=1+1,"=DATE(2026,10,15)"\nA,"=HYPERLINK(""x"")",'} meta={{ colFormats: { 1: { type: 'inr' } } }} title="Q3 / budget" />)
    fireEvent.click(within(headerCell('Name')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0]
    expect(name).toBe('Q3 budget.csv')
    expect(await blob.text()).toBe('Name,Total,When\nA,#NAME?,\nB,2,15 Oct 2026')
  })

  it('neutralises text that a spreadsheet would run as a formula', async () => {
    render(<SheetView text={'Note\n"@SUM(1,2)"'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await vi.mocked(downloadBlob).mock.calls[0][0].text()).toBe(`Note\n"'@SUM(1,2)"`)
  })

  it('hides the download when the page protects its source', () => {
    render(<SheetView text={'Name\nA'} protect />)
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
  })
})

describe('SheetView large sheets', () => {
  const big = ['N,Double', ...Array.from({ length: 250 }, (_, i) => `${i + 1},=A${i + 2}*2`)].join('\n')

  it('renders only the rows in view and moves the window as the box scrolls', async () => {
    const { container } = render(<SheetView text={big} />)
    expect(bodyRows().length).toBeLessThan(100)
    expect(firstColumn()[0]).toBe('1')
    expect(screen.getByText('250 rows')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more|Next/ })).toBeNull()
    const box = container.querySelector('.ft-sv-box')
    const gapBelow = container.querySelector('tbody tr.ft-sv-gap:last-child td')
    expect(parseFloat(gapBelow.style.height)).toBeGreaterThan(0)
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 400 })
    box.scrollTop = 6000
    fireEvent.scroll(box)
    await waitFor(() => expect(Number(firstColumn()[0])).toBeGreaterThan(100))
    const shown = firstColumn().map(Number)
    expect(shown.length).toBeLessThan(100)
    expect(shown).toEqual(shown.map((_, i) => shown[0] + i))
    expect(bodyRows()[0]).toHaveAttribute('aria-rowindex', String(shown[0] + 1))
  })

  it('pages a sheet whose cells wrap, a hundred rows at a time', () => {
    render(<SheetView text={big} meta={{ wrap: { 0: true } }} />)
    expect(bodyRows()).toHaveLength(100)
    expect(screen.getByText('Rows 1–100 of 250')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(firstColumn()[0]).toBe('101')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(bodyRows()).toHaveLength(50)
    expect(screen.getByText('Rows 201–250 of 250')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '7' } })
    expect(firstColumn()[0]).toBe('7')
  })

  it('searches and sorts across rows that are not shown yet', () => {
    render(<SheetView text={big} />)
    fireEvent.click(within(headerCell('Double')).getByRole('button'))
    fireEvent.click(within(headerCell('Double')).getByRole('button'))
    expect(bodyRows()[0].cells[1]).toHaveTextContent('500')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '499' } })
    expect(screen.getByText('No rows match “499”.')).toBeInTheDocument()
    expect(screen.getByText('0 of 250 rows')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '249' } })
    expect(firstColumn()).toEqual(['249'])
  })

  it('opens a 5,000-row sheet quickly', () => {
    const rows = ['Date,Amount,Balance', ...Array.from({ length: 5000 }, (_, i) => `2026-01-01,${i},=C${i + 1}+B${i + 2}`)]
    rows[1] = '2026-01-01,0,0'
    const t = performance.now()
    render(<SheetView text={rows.join('\n')} meta={{ colFormats: { 1: { type: 'inr' } } }} />)
    expect(performance.now() - t).toBeLessThan(1500)
    expect(bodyRows().length).toBeLessThan(100)
    expect(screen.getByText('5,000 rows')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '5001')
  })
})

describe('SheetView in compact previews', () => {
  it('keeps the same values in a smaller layout', () => {
    const { container } = render(<SheetView text={'Name,Total\nA,=2*3'} compact />)
    expect(container.firstChild).toHaveClass('ft-sv-compact')
    expect(bodyRows()[0].cells[1]).toHaveTextContent('6')
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveTextContent('CSV')
  })
})

describe('public spreadsheet page', () => {
  async function openPage(page) {
    const { api } = await import('../services/api')
    api.pages.publicGet.mockResolvedValue({ id: '1', slug: 'budget', title: 'Budget', content_type: 'csv', ...page })
    const PageViewer = (await import('../pages/PageViewer')).default
    render(<MemoryRouter initialEntries={['/p/budget']}><Routes><Route path="/p/:slug" element={<PageViewer />} /></Routes></MemoryRouter>)
    return screen.findByRole('table', { name: 'Budget' })
  }

  it('renders the sheet with its saved formats', async () => {
    await openPage({ content: 'Head,Amount\nRent,1200\nTotal,=SUM(B2:B2)', metadata: { sheet: { colFormats: { 1: { type: 'inr', decimals: 0 } } } } })
    expect(bodyRows().map(tr => tr.cells[1].textContent)).toEqual(['₹1,200', '₹1,200'])
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
  })

  it('offers no download on a protected sheet', async () => {
    await openPage({ content: 'Head\nA', metadata: { protect_source: true } })
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
  })
})
