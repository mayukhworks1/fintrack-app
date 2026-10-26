/**
 * The public viewer tells "not found" from "could not load": a network error,
 * a 5xx or a body that is not ours is retried and then offered as Try again,
 * never shown as "Page not found".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { answers } = vi.hoisted(() => ({ answers: [] }))

vi.mock('../services/api', () => ({
  api: { pages: {
    publicGet: vi.fn(async () => {
      const next = answers.length > 1 ? answers.shift() : answers[0]
      if (next instanceof Error) throw next
      return next
    }),
    publicLogView: vi.fn(async () => ({})),
  } },
  API_BASE_URL: 'https://api.example',
}))

const PAGE = { id: '1', slug: 'notes', title: 'Notes', content_type: 'text', content: 'Hello there', metadata: {} }

async function open() {
  const PageViewer = (await import('../pages/PageViewer')).default
  render(<MemoryRouter initialEntries={['/p/notes']}><Routes><Route path="/p/:slug" element={<PageViewer />} /></Routes></MemoryRouter>)
}

beforeEach(() => { answers.length = 0 })

describe('public viewer loading', () => {
  it('classifies what the server answered', async () => {
    const { loadOutcome } = await import('../pages/PageViewer')
    expect(loadOutcome(PAGE)).toBe('page')
    expect(loadOutcome({ requires_password: true, id: '1' })).toBe('page')
    expect(loadOutcome({ error: { code: 404, message: 'Page not found' } })).toBe('notfound')
    expect(loadOutcome({ detail: 'Not Found' })).toBe('notfound')
    expect(loadOutcome({ error: { code: 503, message: 'Service unavailable' } })).toBe('unavailable')
    expect(loadOutcome({})).toBe('unavailable')
    expect(loadOutcome(null)).toBe('unavailable')
  })

  it('retries a failed load on its own and shows the page when it answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      answers.push(new TypeError('Failed to fetch'), { error: { code: 503 } }, PAGE)
      await open()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await screen.findByText('Hello there')).toBeInTheDocument()
      expect(screen.queryByText('Page not found')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('after the automatic retries, offers Try again instead of "Page not found"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      answers.push(new TypeError('Failed to fetch'))
      await open()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(await screen.findByText("This page couldn't load")).toBeInTheDocument()
      expect(screen.queryByText('Page not found')).toBeNull()
      answers.length = 0
      answers.push(PAGE)
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Hello there')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('a real 404 is still "Page not found"', async () => {
    answers.push({ error: { code: 404, message: 'Page not found' } })
    await open()
    await waitFor(() => expect(screen.getByText('Page not found')).toBeInTheDocument())
  })
})
