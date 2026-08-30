/**
 * Receivables by age.
 *
 * The panel this replaces was titled "Receivables heat map" and showed four
 * counts. A count answers the wrong question — ten small invoices at 90 days
 * matter less than one large one — so the amount is what the bars encode, and
 * the exact figures stay reachable.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AgingRunway from '../components/AgingRunway'

vi.mock('../hooks/useTilt', () => ({ useTilt: () => ({ current: null }) }))

const BUCKETS = [
  { label: '0-14d',  count: 3, amount: 100000 },
  { label: '15-30d', count: 1, amount:  50000 },
  { label: '31-60d', count: 2, amount: 250000 },
  { label: '60d+',   count: 4, amount: 600000 },
]

describe('AgingRunway', () => {
  it('shows the amount in each band, not just a count', () => {
    render(<AgingRunway buckets={BUCKETS} />)
    expect(screen.getByText('₹6.0L')).toBeInTheDocument()   // 60d+
    expect(screen.getByText('₹2.5L')).toBeInTheDocument()   // 31-60d
    expect(screen.getByText('3 invoices')).toBeInTheDocument()
  })

  it('leads with how much is genuinely old', () => {
    render(<AgingRunway buckets={BUCKETS} />)
    // 31-60d + 60d+ = 850000
    expect(screen.getByText('₹8.5L')).toBeInTheDocument()
    expect(screen.getByText(/past 60 days/)).toBeInTheDocument()
  })

  it('scales bars to the largest band so a small one stays visible', () => {
    const { container } = render(<AgingRunway buckets={BUCKETS} />)
    const widths = [...container.querySelectorAll('div[style*="width"]')]
      .map(d => d.style.width)
      .filter(Boolean)
    expect(widths).toContain('100%')            // the peak band
    expect(widths.every(w => parseFloat(w) >= 2)).toBe(true)
  })

  it('selects a band and reports it', () => {
    const onSelect = vi.fn()
    render(<AgingRunway buckets={BUCKETS} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: /60d\+/ }))
    expect(onSelect).toHaveBeenCalledWith('60d+')
  })

  it('clicking the selected band clears it', () => {
    const onSelect = vi.fn()
    render(<AgingRunway buckets={BUCKETS} selected="60d+" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: /60d\+/ }))
    expect(onSelect).toHaveBeenCalledWith('')
  })

  it('marks the selected band for assistive tech, not by colour alone', () => {
    render(<AgingRunway buckets={BUCKETS} selected="31-60d" />)
    expect(screen.getByRole('listitem', { name: /31-60d/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('listitem', { name: /60d\+/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('names the amount and invoice count in each control label', () => {
    render(<AgingRunway buckets={BUCKETS} />)
    expect(screen.getByRole('listitem', { name: /₹6,00,000 across 4 invoices/ })).toBeInTheDocument()
  })

  it('offers exact figures as a table', () => {
    render(<AgingRunway buckets={BUCKETS} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show exact figures/ }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('₹6,00,000')).toBeInTheDocument()
    expect(within(table).getByText('₹50,000')).toBeInTheDocument()
  })

  it('renders nothing when there are no bands', () => {
    const { container } = render(<AgingRunway buckets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('survives a band with no outstanding amount', () => {
    const empty = BUCKETS.map(b => ({ ...b, count: 0, amount: 0 }))
    render(<AgingRunway buckets={empty} />)
    expect(screen.getAllByText('0 invoices')).toHaveLength(4)
    expect(screen.getAllByText('₹0').length).toBeGreaterThan(0)
  })
})
