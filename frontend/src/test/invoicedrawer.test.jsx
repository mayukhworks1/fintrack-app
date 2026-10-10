/**
 * The invoice drawers across more than one session.
 *
 * Both pages keep their drawer mounted between opens so the exit animation can
 * play, and every "new" open passes invoice=null. The drawers reset their
 * per-session state only when invoice?.id changed, which it never does from
 * one "new" open to the next. Two defects followed:
 *   - uploading a file to a new invoice creates a draft and remembers its id;
 *     the next "New invoice" then saved with update(thatId) and overwrote the
 *     earlier invoice instead of creating a second one;
 *   - an armed "Confirm?" delete carried over to the next invoice opened, so a
 *     single click deleted it.
 * The harnesses below derive the drawer's props exactly as the pages do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const { api } = vi.hoisted(() => {
  const api = {
    invoices: {
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), upload: vi.fn(), parse: vi.fn(),
    },
    webInvoices: {
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), upload: vi.fn(), parse: vi.fn(),
      picklists: { addOption: vi.fn() },
    },
  }
  return { api }
})

vi.mock('../services/api', () => ({ api, API_BASE_URL: '', getAuthToken: () => '' }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    userEmail: 'finance@example.com', authRole: 'superadmin', isEmailAuth: true,
    hasPerm: () => true,
  }),
}))

import { InvoiceDrawer } from '../pages/invoices/InvoiceDrawer'
import { InvoiceDrawer as WebInvoiceDrawer } from '../pages/webinvoices/InvoiceDrawer'

const record = (id, number) => ({
  id,
  fields: { 'Invoice Number': number, 'Project': 'Rebrand', 'Payment Status': 'Pending', 'Amount Raised': 1000 },
})

/* Mirrors Invoices.jsx: one drawer, always rendered, props derived from `drawer`. */
function InvoicesHarness() {
  const [drawer, setDrawer] = useState(null)
  return (
    <>
      <button onClick={() => setDrawer({ mode: 'new', invoice: null })}>open new</button>
      <button onClick={() => setDrawer({ mode: 'edit', invoice: record('recA', 'INV-A') })}>edit A</button>
      <button onClick={() => setDrawer({ mode: 'edit', invoice: record('recB', 'INV-B') })}>edit B</button>
      <InvoiceDrawer
        open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
        invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
        prefill={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.prefill : null}
        paymentOnly={drawer?.mode === 'payment'}
        onClose={() => setDrawer(null)}
        onSaved={() => setDrawer(null)}
        onDeleted={() => setDrawer(null)}
      />
    </>
  )
}

/* Mirrors WebInvoices.jsx, including the retainer "Record raised invoice" path,
   which opens a new-mode drawer without bumping the remount key. */
function WebInvoicesHarness() {
  const [drawer, setDrawer] = useState(null)
  return (
    <>
      <button onClick={() => setDrawer({ mode: 'new', invoice: null, draft: null })}>open new</button>
      <button onClick={() => setDrawer({ mode: 'new', invoice: null, draft: { project: 'Retainer Co', invoice_number: '' } })}>record raised</button>
      <button onClick={() => setDrawer({ mode: 'edit', invoice: record('recA', 'INV-A') })}>edit A</button>
      <button onClick={() => setDrawer({ mode: 'edit', invoice: record('recB', 'INV-B') })}>edit B</button>
      <WebInvoiceDrawer
        key="form-0"
        open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
        invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
        draft={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.draft : null}
        paymentOnly={drawer?.mode === 'payment'}
        onClose={() => setDrawer(null)}
        onSaved={() => setDrawer(null)}
        onDeleted={() => setDrawer(null)}
        picklists={{}}
        onOptionsUpdate={() => {}}
        canEditPicklists={false}
        onPicklistPermissionError={() => {}}
      />
    </>
  )
}

const pdf = () => new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })

async function uploadInvoicePdf() {
  const zone = await screen.findByLabelText('Upload Invoice PDF')
  const input = zone.querySelector('input[type="file"]')
  await act(async () => { fireEvent.change(input, { target: { files: [pdf()] } }) })
}

async function closeAndSettle() {
  // Let the drawer's exit timer run so the next open is a genuine re-open.
  await act(async () => { await new Promise(r => setTimeout(r, 320)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.invoices.create.mockResolvedValue({ id: 'recA' })
  api.invoices.update.mockImplementation(async (id) => ({ id }))
  api.invoices.upload.mockResolvedValue({ attachments: [{ name: 'invoice.pdf', token: 't1' }] })
  api.invoices.delete.mockResolvedValue(null)
  api.webInvoices.create.mockResolvedValue({ id: 'recA' })
  api.webInvoices.update.mockImplementation(async (id) => ({ id }))
  api.webInvoices.upload.mockResolvedValue({ attachments: [{ name: 'invoice.pdf', token: 't1' }] })
  api.webInvoices.delete.mockResolvedValue(null)
})

describe('Invoices drawer', () => {
  it('creates a second invoice after a first one was drafted for an upload', async () => {
    render(<InvoicesHarness />)
    fireEvent.click(screen.getByText('open new'))
    await uploadInvoicePdf()
    await waitFor(() => expect(api.invoices.upload).toHaveBeenCalledWith('recA', 'Invoice PDF', expect.any(File)))
    expect(api.invoices.create).toHaveBeenCalledTimes(1)

    // First session: the drafted record is finished with an update — correct.
    fireEvent.change(screen.getByPlaceholderText('WM/25-26/001'), { target: { value: 'INV-1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create invoice/ })) })
    expect(api.invoices.update).toHaveBeenCalledTimes(1)
    expect(api.invoices.update).toHaveBeenLastCalledWith('recA', expect.objectContaining({ invoice_number: 'INV-1' }))
    await closeAndSettle()

    // Second session: a brand-new invoice must be created, not recA rewritten.
    api.invoices.create.mockResolvedValueOnce({ id: 'recB' })
    fireEvent.click(screen.getByText('open new'))
    fireEvent.change(await screen.findByPlaceholderText('WM/25-26/001'), { target: { value: 'INV-2' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create invoice/ })) })

    expect(api.invoices.create).toHaveBeenCalledTimes(2)
    expect(api.invoices.create).toHaveBeenLastCalledWith(expect.objectContaining({ invoice_number: 'INV-2' }))
    expect(api.invoices.update).toHaveBeenCalledTimes(1)
  })

  it('does not carry an armed delete over to the next invoice', async () => {
    render(<InvoicesHarness />)
    fireEvent.click(screen.getByText('edit A'))
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }))
    expect(screen.getByRole('button', { name: /Confirm\?/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await closeAndSettle()

    fireEvent.click(screen.getByText('edit B'))
    const del = await screen.findByRole('button', { name: /^Delete$/ })
    await act(async () => { fireEvent.click(del) })
    expect(api.invoices.delete).not.toHaveBeenCalled()

    // The deliberate second click still deletes the record that is open.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirm\?/ })) })
    expect(api.invoices.delete).toHaveBeenCalledWith('recB')
  })
})

describe('Web invoices drawer', () => {
  it('creates a new invoice from the retainer flow after an earlier draft', async () => {
    render(<WebInvoicesHarness />)
    fireEvent.click(screen.getByText('open new'))
    await uploadInvoicePdf()
    await waitFor(() => expect(api.webInvoices.upload).toHaveBeenCalledWith('recA', 'Invoice PDF', expect.any(File)))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save changes/ })) })
    expect(api.webInvoices.update).toHaveBeenCalledTimes(1)
    await closeAndSettle()

    api.webInvoices.create.mockResolvedValueOnce({ id: 'recB' })
    fireEvent.click(screen.getByText('record raised'))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Create invoice/ })) })

    expect(api.webInvoices.create).toHaveBeenCalledTimes(2)
    expect(api.webInvoices.create).toHaveBeenLastCalledWith(expect.objectContaining({ project: 'Retainer Co' }))
    expect(api.webInvoices.update).toHaveBeenCalledTimes(1)
  })

  it('does not carry an armed delete over to the next invoice', async () => {
    render(<WebInvoicesHarness />)
    fireEvent.click(screen.getByText('edit A'))
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await closeAndSettle()

    fireEvent.click(screen.getByText('edit B'))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ })) })
    expect(api.webInvoices.delete).not.toHaveBeenCalled()
  })
})
