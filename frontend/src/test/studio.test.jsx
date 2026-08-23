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
      datasets: vi.fn(() => Promise.resolve({ datasets: [] })),
      health: vi.fn(() => Promise.resolve({ text_search: true, semantic: false, reason: '', chunks: 0, embedded: 0 })),
      analyze: vi.fn(),
      threads: vi.fn(() => Promise.resolve({ threads: [] })),
      thread: vi.fn(),
      deleteThread: vi.fn(),
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

// ---------------------------------------------------------------------------
// Data mode
// ---------------------------------------------------------------------------
const DATASETS = [
  {
    key: 'invoices', label: 'Invoices', description: '',
    metrics: [], dimensions: [],
    examples: ['Which projects have the most outstanding?', 'How much did we receive last quarter?'],
  },
  {
    key: 'projects', label: 'Projects', description: '',
    metrics: [], dimensions: [],
    examples: ['Total billed by client', 'Which clients have the best margin?'],
  },
]

describe('Studio data mode', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.documents.mockResolvedValue({ documents: [] })
    api.studio.usage.mockResolvedValue({ quota: { used: 0, limit: 200 } })
    api.studio.threads.mockResolvedValue({ threads: [] })
    api.studio.health.mockResolvedValue({ text_search: true, semantic: false, reason: '', chunks: 0, embedded: 0 })
    api.studio.datasets.mockResolvedValue({ datasets: DATASETS })
  })

  // The hole this closes: /datasets was built and served but never called, so
  // data mode was an empty box with no clue what it understands.
  it('offers starter questions drawn from the datasets the account may query', async () => {
    render(<Studio />)
    fireEvent.click(await screen.findByRole('tab', { name: /Finance data/ }))
    expect(await screen.findByRole('button', { name: 'Which projects have the most outstanding?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Total billed by client' })).toBeInTheDocument()
  })

  // Concatenating would put every invoice question first, reading as though
  // invoices were the only thing that can be asked about.
  it('interleaves the datasets rather than exhausting the first', async () => {
    render(<Studio />)
    fireEvent.click(await screen.findByRole('tab', { name: /Finance data/ }))
    await screen.findByRole('button', { name: 'Total billed by client' })
    const labels = screen.getAllByRole('button')
      .map(b => b.textContent)
      .filter(t => DATASETS.some(d => d.examples.includes(t)))
    expect(labels.slice(0, 2)).toEqual([
      'Which projects have the most outstanding?',
      'Total billed by client',
    ])
  })

  it('asks the analyst when a starter question is clicked', async () => {
    api.studio.analyze.mockResolvedValue({
      kind: 'data', answer: 'Ravensbourne is highest.', rows: [], columns: [],
      dataset_label: 'Invoices', model: 'x', latency_ms: 10,
    })
    render(<Studio />)
    fireEvent.click(await screen.findByRole('tab', { name: /Finance data/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Total billed by client' }))
    await screen.findByText(/Ravensbourne is highest/)
    expect(api.studio.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Total billed by client' })
    )
    expect(api.studio.ask).not.toHaveBeenCalled()
  })

  // Documents are a precondition for searching documents, not for querying
  // tables. The button previously took its colour and cursor from the document
  // count in both modes, so it read as disabled while still being clickable.
  it('can ask about data with no documents uploaded', async () => {
    render(<Studio />)
    fireEvent.click(await screen.findByRole('tab', { name: /Finance data/ }))
    const box = screen.getByLabelText('Your question')
    fireEvent.change(box, { target: { value: 'total billed' } })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
  })

  it('says so when the account may query nothing', async () => {
    api.studio.datasets.mockResolvedValue({ datasets: [] })
    render(<Studio />)
    fireEvent.click(await screen.findByRole('tab', { name: /Finance data/ }))
    expect(await screen.findByText(/cannot view any of the finance tables/)).toBeInTheDocument()
  })
})

// The same standard the quota is held to: report what is running, do not imply
// a capability the deployment does not have.
describe('Studio retrieval honesty', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.usage.mockResolvedValue({ quota: { used: 0, limit: 200 } })
    api.studio.threads.mockResolvedValue({ threads: [] })
    api.studio.datasets.mockResolvedValue({ datasets: [] })
    api.studio.documents.mockResolvedValue({
      documents: [{ id: 'd1', filename: 'msa.pdf', status: 'ready', page_count: 12, chunk_count: 30, byte_size: 90000 }],
    })
  })

  it('does not claim meaning-based search when no embeddings exist', async () => {
    api.studio.health.mockResolvedValue({
      text_search: true, semantic: false, chunks: 30, embedded: 0,
      reason: 'no passages have been embedded yet — check the OpenRouter key',
    })
    render(<Studio />)
    expect(await screen.findByText(/Keyword search over 30 passages/)).toBeInTheDocument()
    expect(screen.getByText(/Meaning-based search is off/)).toBeInTheDocument()
  })

  it('reports the hybrid index when it is genuinely running', async () => {
    api.studio.health.mockResolvedValue({
      text_search: true, semantic: true, chunks: 30, embedded: 30,
      reason: '30 of 30 passages carry embeddings',
    })
    render(<Studio />)
    expect(await screen.findByText(/Keyword and meaning-based search/)).toBeInTheDocument()
  })
})

// The reported symptom, in its second form: turns were saved, but a data answer
// was saved as prose alone — reopening a conversation replayed the sentence and
// silently dropped the figures it was describing.
describe('Studio conversation replay', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.documents.mockResolvedValue({ documents: [] })
    api.studio.usage.mockResolvedValue({ quota: { used: 0, limit: 200 } })
    api.studio.datasets.mockResolvedValue({ datasets: [] })
    api.studio.health.mockResolvedValue({ text_search: true, semantic: false, reason: '', chunks: 0, embedded: 0 })
  })

  // Anchored at the start: the row's delete control carries the same title in
  // its label, so an unanchored match finds two buttons.
  const openThread = (title) => {
    api.studio.threads.mockResolvedValue({
      threads: [{ id: 't1', title, turns: 1, updated_at: new Date().toISOString() }],
    })
  }

  it('redraws a saved data answer with its numbers, not just its prose', async () => {
    openThread('Outstanding by project')
    api.studio.thread.mockResolvedValue({
      id: 't1', title: 'Outstanding by project',
      turns: [{
        question: 'Which projects have the most outstanding?',
        answer: 'Ravensbourne leads at ₹91,000.',
        kind: 'data', chart: 'bar', unit: 'currency',
        columns: ['project', 'value'],
        rows: [{ project: 'Ravensbourne', value: 91000 }],
        metric_label: 'Outstanding', dataset_label: 'Invoices',
        dimension_labels: ['Project'], sql: 'SELECT project, SUM(x) FROM invoices_mirror',
        model: 'x', latency_ms: 900, sources: [],
      }],
    })
    render(<Studio />)
    fireEvent.click(await screen.findByRole('button', { name: /Conversations/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Outstanding by project/ }))

    await screen.findByText(/Ravensbourne leads/)
    // The table the answer is describing, and the query behind it.
    expect(screen.getByRole('cell', { name: 'Ravensbourne' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '₹91,000' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show query/ })).toBeInTheDocument()
  })

  // Sources arrive from a JSONB column. Handed back as a raw string, its
  // character count rendered as a source count in the hundreds.
  it('restores citations as citations', async () => {
    openThread('Payment terms')
    api.studio.thread.mockResolvedValue({
      id: 't1', title: 'Payment terms',
      turns: [{
        question: 'Payment terms?', answer: 'Net 30 [1].', kind: 'documents',
        verdict: 'pass', model: 'x', latency_ms: 100,
        sources: [{ n: 1, title: 'MSA', page: 4, excerpt: 'within thirty (30) days' }],
      }],
    })
    render(<Studio />)
    fireEvent.click(await screen.findByRole('button', { name: /Conversations/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Payment terms/ }))
    await screen.findByText(/Net 30/)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText(/within thirty \(30\) days/)).toBeInTheDocument()
    expect(screen.getByText('1 sources')).toBeInTheDocument()
  })
})
