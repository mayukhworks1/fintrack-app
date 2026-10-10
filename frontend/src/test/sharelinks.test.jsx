/**
 * Public share links, from both ends.
 *
 * The public page renders only what the server says this link carries
 * (`shared_fields`), so a project card never prints the agency's profit and a
 * seeded filter on a field the link does not carry cannot hide every record.
 * Its edit form sends a blank amount as nothing at all, not '' (a 422). And the
 * share dialogs send the whole filter state, advanced rules included, then fall
 * back to a snapshot when the server refuses a live link it cannot re-apply.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../services/api', () => ({
  api: {
    sharedViews: {
      publicGet: vi.fn(),
      publicUpdate: vi.fn(),
      recordEvent: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { api } from '../services/api'
import SharedView, { publicEditPayload } from '../pages/SharedView.jsx'
import { ShareLinkModal } from '../components/SharedLinks.jsx'
import { ShareModal } from '../pages/statusboard/StatusModals.jsx'

function renderSharedView() {
  return render(
    <MemoryRouter initialEntries={['/view/tok']}>
      <Routes><Route path="/view/:token" element={<SharedView />} /></Routes>
    </MemoryRouter>
  )
}

const PROJECT = {
  id: 'p1',
  fields: { Client: 'Acme', 'Project Name': 'Rebrand', 'Project Status': 'Active', Health: 'On Track', 'Amount Billed So far': 500000 },
}

function projectLink(sharedFields, extraFields = {}) {
  return {
    token: 'tok', title: 'Projects', access_mode: 'read', resource_type: 'projects', is_dynamic: false,
    records: [{ ...PROJECT, fields: { ...PROJECT.fields, ...extraFields } }],
    total: 1, view_config: { type: 'card' }, shared_fields: sharedFields,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.sharedViews.recordEvent.mockResolvedValue(null)
})
afterEach(() => cleanup())

describe('public page renders only the fields the link carries', () => {
  it('a project card shows no Profit or Margin unless the link shares them', async () => {
    api.sharedViews.publicGet.mockResolvedValue(
      projectLink(['Client', 'Project Name', 'Project Status', 'Health', 'Amount Billed So far'])
    )
    renderSharedView()
    expect(await screen.findByText('Rebrand')).toBeInTheDocument()
    expect(screen.getByText('Billed')).toBeInTheDocument()
    expect(screen.queryByText('Profit')).not.toBeInTheDocument()
    expect(screen.queryByText('Margin')).not.toBeInTheDocument()
  })

  it('shows them when the owner chose those columns', async () => {
    api.sharedViews.publicGet.mockResolvedValue(projectLink(
      ['Client', 'Project Name', 'Project Status', 'Health', 'Actual Profit', 'Profit percentage'],
      { 'Actual Profit': 120000, 'Profit percentage': 24 },
    ))
    renderSharedView()
    expect(await screen.findByText('Profit')).toBeInTheDocument()
    expect(screen.getByText('24.0%')).toBeInTheDocument()
    expect(screen.queryByText('Billed')).not.toBeInTheDocument()
  })

  it('a seeded filter on a field the link does not carry does not hide every record', async () => {
    api.sharedViews.publicGet.mockResolvedValue({
      token: 'tok', title: 'Invoices', access_mode: 'read', resource_type: 'invoices', is_dynamic: true,
      records: [{ id: 'i1', fields: { 'Invoice Number': 'INV-1', 'Client Name': 'Acme', 'Payment Status': 'Pending' } }],
      total: 1,
      view_config: { type: 'list', raisedByFilter: 'staff@theworks.in', followupDueOnly: true, search: 'inv-1 ' },
      shared_fields: ['Invoice Number', 'Client Name', 'Payment Status'],
    })
    renderSharedView()
    expect(await screen.findByText('INV-1')).toBeInTheDocument()
    expect(screen.queryByText('No shared invoices match the current filters.')).not.toBeInTheDocument()
    // and the controls for fields it does not carry are not offered
    expect(screen.queryByText('All owners')).not.toBeInTheDocument()
    expect(screen.queryByText('Follow-up due', { selector: 'button' })).not.toBeInTheDocument()
  })
})

describe('public edit sends numbers the API accepts', () => {
  it('leaves a blank amount out instead of sending an empty string', () => {
    expect(publicEditPayload({ amount_received: '', remark: 'x' })).toEqual({ remark: 'x' })
    expect(publicEditPayload({ amount_billed: '1250.5' })).toEqual({ amount_billed: 1250.5 })
    expect(publicEditPayload({ amount_received: 0 })).toEqual({ amount_received: 0 })
    expect(publicEditPayload({ status: 'Completed' })).toEqual({ status: 'Completed' })
  })

  it('saving an unpaid invoice with no amount received posts no amount_received', async () => {
    api.sharedViews.publicGet.mockResolvedValue({
      token: 'tok', title: 'Invoices', access_mode: 'edit', resource_type: 'invoices', is_dynamic: false,
      records: [{ id: 'i1', fields: { 'Invoice Number': 'INV-1', 'Client Name': 'Acme', 'Payment Status': 'Pending', Remark: 'old' } }],
      total: 1, view_config: { type: 'list' }, shared_fields: null,
    })
    api.sharedViews.publicUpdate.mockResolvedValue({ id: 'i1', fields: {} })
    renderSharedView()
    fireEvent.click(await screen.findByTitle('Edit'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(api.sharedViews.publicUpdate).toHaveBeenCalledTimes(1))
    const [, recordId, payload] = api.sharedViews.publicUpdate.mock.calls[0]
    expect(recordId).toBe('i1')
    expect(payload).not.toHaveProperty('amount_received')
    expect(payload.remark).toBe('old')
  })

  it('shows a failed save inside the edit form, not behind it', async () => {
    api.sharedViews.publicGet.mockResolvedValue({
      token: 'tok', title: 'Invoices', access_mode: 'edit', resource_type: 'invoices', is_dynamic: false,
      records: [{ id: 'i1', fields: { 'Invoice Number': 'INV-1', 'Payment Status': 'Pending' } }],
      total: 1, view_config: { type: 'list' },
    })
    api.sharedViews.publicUpdate.mockRejectedValue(new Error('Record is not part of this shared view'))
    renderSharedView()
    fireEvent.click(await screen.findByTitle('Edit'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Record is not part of this shared view')
  })
})

const RECORDS = [
  { id: 'r1', fields: { 'Invoice Number': 'INV-1', Project: 'Rebrand', Client: 'Acme', 'Project Name': 'x' } },
  { id: 'r2', fields: { 'Invoice Number': 'INV-2', Project: 'Rebrand', Client: 'Acme', 'Project Name': 'y' } },
]

function refused() {
  const e = new Error('This view uses a filter a live link cannot re-apply on the server. Share a snapshot of the visible records instead.')
  e.status = 422
  return e
}

describe('invoice / tax / project share dialog', () => {
  const rule = { id: 'c1', field: 'Amount Raised', op: 'gt', value: '500000' }

  it('a live link carries the advanced rules and the owner UTC offset', async () => {
    api.sharedViews.create.mockResolvedValue({ token: 'new' })
    render(<ShareLinkModal resourceType="invoices" selectedRecords={RECORDS} enableLiveMode
      viewConfig={{ type: 'list', filterConditions: [rule] }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /generate link/i }))
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalledTimes(1))
    const payload = api.sharedViews.create.mock.calls[0][0]
    expect(payload.record_ids).toEqual(['__dynamic__'])
    expect(payload.view_config.filterConditions).toEqual([rule])
    expect(payload.view_config.utcOffsetMinutes).toBe(-new Date().getTimezoneOffset() || 0)
  })

  it('when the server refuses the live link, it switches to a snapshot of the visible records', async () => {
    api.sharedViews.create.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ token: 'snap' })
    render(<ShareLinkModal resourceType="invoices" selectedRecords={RECORDS} enableLiveMode
      viewConfig={{ type: 'list', filterConditions: [rule] }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /generate link/i }))
    expect(await screen.findByText(/Switched to a snapshot of the 2 visible invoices/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /generate link/i }))
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalledTimes(2))
    expect(api.sharedViews.create.mock.calls[1][0].record_ids).toEqual(['r1', 'r2'])
  })
})

describe('status board share dialog', () => {
  const rule = { id: 'c1', field: 'Client', op: 'contains', value: 'Birla' }

  it('keeps the advanced rules on a live view link', async () => {
    api.sharedViews.create.mockResolvedValue({ token: 'new' })
    render(<ShareModal selectedRecords={RECORDS} isViewShare
      viewConfig={{ type: 'card', filterClient: '', advancedConditions: [rule] }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /generate link/i }))
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalledTimes(1))
    const payload = api.sharedViews.create.mock.calls[0][0]
    expect(payload.record_ids).toEqual(['__dynamic__'])
    expect(payload.view_config.advancedConditions).toEqual([rule])
  })

  it('offers a snapshot of the visible projects when the live link is refused', async () => {
    api.sharedViews.create.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ token: 'snap' })
    render(<ShareModal selectedRecords={RECORDS} isViewShare
      viewConfig={{ type: 'card', advancedConditions: [rule] }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /generate link/i }))
    const offer = await screen.findByRole('button', { name: /share a snapshot of the 2 visible projects/i })
    fireEvent.click(offer)
    await waitFor(() => expect(api.sharedViews.create).toHaveBeenCalledTimes(2))
    const payload = api.sharedViews.create.mock.calls[1][0]
    expect(payload.record_ids).toEqual(['r1', 'r2'])
    expect(payload.access_mode).toBe('read')
  })
})
