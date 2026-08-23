/**
 * Studio answers are only worth anything if the citations are checkable.
 *
 * The failure this guards against: an answer that reads confidently while its
 * [1] markers point nowhere, or render as literal text the reader cannot open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: {
    studio: {
      documents: vi.fn(() => Promise.resolve({ documents: [] })),
      usage: vi.fn(() => Promise.resolve({ quota: { used: 3, limit: 200 } })),
      ask: vi.fn(),
      upload: vi.fn(),
      deleteDocument: vi.fn(),
    },
  },
  API_BASE_URL: '',
}))
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => vi.fn(() => Promise.resolve(true)) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: () => {} }))

const Studio = (await import('../pages/Studio')).default

const TURN = {
  question: 'What are the payment terms?',
  answer: 'Invoices are due within 30 days [1], and late payment carries 1.5% monthly interest [2].',
  sources: [
    { n: 1, document_id: 'd1', title: 'Master Agreement', page: 4, method: 'hybrid', excerpt: 'Payment shall be made within thirty (30) days' },
    { n: 2, document_id: 'd1', title: 'Master Agreement', page: 5, method: 'vector', excerpt: 'Interest accrues at one and one half percent' },
  ],
  model: 'llama-3.3-70b',
  verdict: 'pass',
  latency_ms: 4200,
}

async function askAndRender(api, turn = TURN) {
  api.studio.ask.mockResolvedValue(turn)
  render(<Studio />)
  const box = await screen.findByLabelText('Your question')
  fireEvent.change(box, { target: { value: 'What are the payment terms?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  // Wait on this answer's own opening words. Two only: citation markers are
  // rendered as separate elements, so a matcher spanning one never matches.
  const opening = turn.answer.split(' ').slice(0, 2).join(' ')
  return screen.findByText(new RegExp(opening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

describe('Studio citations', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.documents.mockResolvedValue({
      documents: [{ id: 'd1', filename: 'msa.pdf', status: 'ready', page_count: 12, chunk_count: 30, byte_size: 90000 }],
    })
    api.studio.usage.mockResolvedValue({ quota: { used: 3, limit: 200 } })
  })

  it('renders each citation marker as its own control, not as text', async () => {
    await askAndRender(api)
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
  })

  it('reveals the cited passage when a marker is clicked', async () => {
    await askAndRender(api)
    expect(screen.queryByText(/thirty \(30\) days/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText(/thirty \(30\) days/)).toBeInTheDocument()
    expect(screen.getByText(/Master Agreement, page 4/)).toBeInTheDocument()
  })

  it('shows one passage at a time', async () => {
    await askAndRender(api)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.queryByText(/thirty \(30\) days/)).not.toBeInTheDocument()
    expect(screen.getByText(/one and one half percent/)).toBeInTheDocument()
  })

  // A marker with no matching source must stay inert text rather than become a
  // control that opens nothing — that is the shape of a fabricated citation.
  it('leaves a marker with no matching source as plain text', async () => {
    await askAndRender(api, { ...TURN, answer: 'Something unsupported [7].', sources: [] })
    expect(screen.queryByRole('button', { name: '7' })).not.toBeInTheDocument()
    expect(screen.getByText(/Something unsupported/)).toBeInTheDocument()
  })

  it('surfaces the verification verdict', async () => {
    await askAndRender(api)
    expect(screen.getByText(/Checked against sources/)).toBeInTheDocument()
  })

  it('says so when the answer was corrected during checking', async () => {
    await askAndRender(api, { ...TURN, verdict: 'soft-fail' })
    expect(screen.getByText(/Corrected during checking/)).toBeInTheDocument()
  })
})

describe('Studio guards', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.usage.mockResolvedValue({ quota: { used: 0, limit: 200 } })
  })

  // Asking with no corpus can only produce "nothing matched", so the control
  // stays disabled rather than spending a model call to say so.
  it('cannot ask with no ready documents', async () => {
    api.studio.documents.mockResolvedValue({ documents: [] })
    render(<Studio />)
    const box = await screen.findByLabelText('Your question')
    fireEvent.change(box, { target: { value: 'anything' } })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('cannot ask while a document is still processing', async () => {
    api.studio.documents.mockResolvedValue({
      documents: [{ id: 'd1', filename: 'big.pdf', status: 'pending', byte_size: 100 }],
    })
    render(<Studio />)
    const box = await screen.findByLabelText('Your question')
    fireEvent.change(box, { target: { value: 'anything' } })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('reports an ingestion failure instead of hiding it', async () => {
    api.studio.documents.mockResolvedValue({
      documents: [{ id: 'd1', filename: 'scan.pdf', status: 'failed', error: 'No text could be extracted.', byte_size: 100 }],
    })
    render(<Studio />)
    fireEvent.click(await screen.findByRole('button', { name: /Documents/ }))
    expect(screen.getByText('No text could be extracted.')).toBeInTheDocument()
  })
})
