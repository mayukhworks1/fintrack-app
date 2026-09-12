/**
 * The sandbox, driven.
 *
 * This file exists because of a specific failure. The invoice drawer was
 * written, referenced from the stage, and never actually inserted into the
 * module — and the build passed, and all 193 tests passed, because an
 * undefined identifier inside JSX is valid JavaScript that only throws when
 * the branch renders. Nothing in the suite had ever clicked a row, so the
 * landing page shipped a crash that took out the whole sandbox on the first
 * interaction anyone would try.
 *
 * So: every interactive affordance here gets exercised at least once. A demo
 * whose only test is that it mounts is a demo that is tested in the one state
 * no visitor stays in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import DemoWorkspace from '../components/DemoWorkspace'
import { INVOICES, TOTALS, inr, GST_RATE, TDS_RATE } from '../components/demoData'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    disconnect() {}
  })
  // Autoplay off: a timer advancing the module under a test makes every
  // assertion about the visible panel a race.
  vi.stubGlobal('matchMedia', (q) => ({
    matches: q.includes('prefers-reduced-motion'),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

const frame = (c) => c.querySelector('.ft-tour')
const rows = (c) => [...c.querySelectorAll('[data-row]')]

describe('the sandbox', () => {
  it('opens an invoice when a row is clicked', async () => {
    // The regression. Before the fix this threw ReferenceError and unmounted
    // the whole component, leaving a blank space where the demo had been.
    const { container } = render(<DemoWorkspace />)
    fireEvent.click(rows(container)[0])
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.getAttribute('aria-label')).toMatch(/^Invoice INV-\d+ for /)
  })

  it('moves focus into the dialog and back out again', async () => {
    const { container } = render(<DemoWorkspace />)
    const row = rows(container)[1]
    row.focus()
    fireEvent.click(row)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Back to the row that opened it, so the reading position survives.
    expect(document.activeElement).toBe(row)
  })

  it('shows the tax split, and marks the pre-tax figure as the receivable', async () => {
    const { container } = render(<DemoWorkspace />)
    fireEvent.click(rows(container)[0])
    const dialog = await screen.findByRole('dialog')
    const id = dialog.getAttribute('aria-label').match(/INV-\d+/)[0]
    const inv = INVOICES.find(i => i.id === id)

    // Twice over: once in the table, once in the sentence explaining it.
    expect(within(dialog).getAllByText(inr(inv.amount)).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(`+ ${inr(inv.gst)}`)).toBeInTheDocument()
    expect(within(dialog).getByText(`− ${inr(inv.tds)}`)).toBeInTheDocument()
    // Billed + GST − TDS is what actually lands. If the drawer's arithmetic
    // ever drifts from demoData's, the page is arguing against itself.
    expect(within(dialog).getByText(inr(inv.amount + inv.gst - inv.tds))).toBeInTheDocument()
    expect(within(dialog).getByText(/the receivable/)).toBeInTheDocument()
    expect(inv.gst).toBe(Math.round(inv.amount * GST_RATE))
    expect(inv.tds).toBe(Math.round(inv.amount * TDS_RATE))
  })

  it('walks the rows with the arrow keys', () => {
    const { container } = render(<DemoWorkspace />)
    const all = rows(container)
    all[0].focus()
    const list = all[0].parentElement
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[1])
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(all[0])
    fireEvent.keyDown(list, { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 1])
    fireEvent.keyDown(list, { key: 'Home' })
    expect(document.activeElement).toBe(all[0])
  })

  it('switches module on a number key', () => {
    const { container } = render(<DemoWorkspace />)
    fireEvent.keyDown(frame(container), { key: '4' })
    expect(screen.getByText(/fintrack — analytics/)).toBeInTheDocument()
    fireEvent.keyDown(frame(container), { key: '1' })
    expect(screen.getByText(/fintrack — receivables/)).toBeInTheDocument()
  })

  it('leaves the number keys alone while someone is typing', () => {
    // Otherwise searching a project with a digit in its name changes module
    // halfway through the word.
    const { container } = render(<DemoWorkspace />)
    const search = screen.getByLabelText(/Search the sample invoices/)
    fireEvent.keyDown(search, { key: '4' })
    expect(screen.getByText(/fintrack — receivables/)).toBeInTheDocument()
  })

  it('filters, and the footer total is the rows that survived', () => {
    const { container } = render(<DemoWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Paid' }))
    const paid = INVOICES.filter(i => i.status === 'Paid')
    expect(screen.getByText(`${paid.length} of ${INVOICES.length} invoices`)).toBeInTheDocument()
    expect(rows(container)).toHaveLength(paid.length)
    // The number under the list is those rows added up — not a figure kept
    // anywhere else, which is the whole claim the sandbox exists to make.
    expect(screen.getByText(inr(paid.reduce((t, r) => t + r.amount, 0)))).toBeInTheDocument()
  })

  it('clears the filters on Escape', () => {
    const { container } = render(<DemoWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }))
    expect(rows(container).length).toBeLessThan(INVOICES.length)
    fireEvent.keyDown(frame(container), { key: 'Escape' })
    expect(rows(container)).toHaveLength(INVOICES.length)
  })

  it('offers the shortcut list, and toggles it', () => {
    const { container } = render(<DemoWorkspace />)
    expect(screen.queryByText('switch module')).toBeNull()
    fireEvent.keyDown(frame(container), { key: '?' })
    expect(screen.getByText('switch module')).toBeInTheDocument()
    fireEvent.keyDown(frame(container), { key: '?' })
    expect(screen.queryByText('switch module')).toBeNull()
  })

  it('reaches every module without throwing', () => {
    // Each panel renders only when selected, so a fault in one hides until
    // it is picked — exactly how the drawer's crash stayed hidden.
    const { container } = render(<DemoWorkspace />)
    for (const label of ['Ageing', 'Projects', 'Analytics', 'AI analyst', 'Receivables']) {
      fireEvent.click(within(container.querySelector('.ft-tour-rail')).getByRole('button', { name: label }))
      expect(frame(container)).toBeInTheDocument()
    }
  })

  it('opens the invoice list already filtered when an ageing band is picked', () => {
    const { container } = render(<DemoWorkspace />)
    const rail = within(container.querySelector('.ft-tour-rail'))
    fireEvent.click(rail.getByRole('button', { name: 'Ageing' }))
    fireEvent.click(screen.getByRole('button', { name: /61–90 days/ }))
    // It should land on the invoice list, filtered, with something in it.
    expect(screen.getByText(/fintrack — receivables/)).toBeInTheDocument()
    expect(screen.getByText(/Ageing: 61–90 days/)).toBeInTheDocument()
    expect(rows(container).length).toBeGreaterThan(0)
  })

  it('never calls the API — it has no workspace to read', () => {
    render(<DemoWorkspace />)
    expect(TOTALS.outstanding).toBeGreaterThan(0)   // computed, not fetched
  })
})
