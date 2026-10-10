/**
 * A conversation the server will not continue is dropped, not resent.
 *
 * The server now refuses a thread id that is not the caller's, or no longer
 * exists, before it reads or appends to it. The page keeps the open thread in
 * the URL (?t=) and sends it with every question, so a deleted conversation or
 * a pasted link would otherwise have every following question refused until
 * the user found "New conversation" on their own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: {
    studio: {
      documents: vi.fn(),
      usage: vi.fn(() => Promise.resolve({ quota: { used: 0, limit: 200 } })),
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

const ANSWER = {
  answer: 'Net 30 [1].', verdict: 'pass', model: 'x', latency_ms: 100, thread_id: 'fresh',
  sources: [{ n: 1, document_id: 'd1', title: 'MSA', page: 4, method: 'lexical', excerpt: 'within thirty (30) days' }],
}

const notFound = () => Object.assign(new Error('Conversation not found'), { status: 404 })

async function ask(text = 'What are the payment terms?') {
  const box = await screen.findByLabelText('Your question')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

describe('Studio conversations the server refuses', () => {
  let api
  beforeEach(async () => {
    vi.clearAllMocks()
    api = (await import('../services/api')).api
    api.studio.documents.mockResolvedValue({
      documents: [{ id: 'd1', filename: 'msa.pdf', status: 'ready', page_count: 12, chunk_count: 30, byte_size: 90000 }],
    })
  })
  afterEach(() => window.history.replaceState({}, '', '/'))

  it('forgets a linked conversation that cannot be opened', async () => {
    window.history.replaceState({}, '', '/studio?t=someone-elses')
    api.studio.thread.mockRejectedValue(notFound())
    api.studio.ask.mockResolvedValue(ANSWER)
    render(<Studio />)

    await waitFor(() => expect(window.location.search).not.toContain('t=someone-elses'))
    await ask()
    await screen.findByText(/Net 30/)
    expect(api.studio.ask.mock.calls[0][0].thread_id).toBeUndefined()
  })

  it('keeps the conversation when opening it failed for another reason', async () => {
    window.history.replaceState({}, '', '/studio?t=t1')
    api.studio.thread.mockRejectedValue(Object.assign(new Error('Request timed out'), { status: undefined }))
    api.studio.ask.mockResolvedValue({ ...ANSWER, thread_id: 't1' })
    render(<Studio />)

    await ask()
    await screen.findByText(/Net 30/)
    expect(api.studio.ask.mock.calls[0][0].thread_id).toBe('t1')
  })

  it('starts afresh after a question is refused for a deleted conversation', async () => {
    window.history.replaceState({}, '', '/studio?t=t1')
    api.studio.thread.mockResolvedValue({ id: 't1', title: 'Old', turns: [] })
    api.studio.ask.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(ANSWER)
    render(<Studio />)

    await ask()
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument()
    expect(api.studio.ask.mock.calls[0][0].thread_id).toBe('t1')

    await ask()
    await screen.findByText(/Net 30/)
    expect(api.studio.ask.mock.calls[1][0].thread_id).toBeUndefined()
  })
})
