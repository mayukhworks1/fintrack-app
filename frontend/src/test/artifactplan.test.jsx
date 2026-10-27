/**
 * The plan step before an artifact is built: a skeleton while it loads, the
 * proposed features and questions with defaults selected, editing them, the
 * build prompt made from the choices, skipping, falling back when there is no
 * plan, the "Don't ask before building" preference, and that changes to an
 * existing artifact never ask.
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react'

const { plan } = vi.hoisted(() => ({ plan: { next: null } }))

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  const frames = (html) => {
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ type: 'done', content: html, model_short: 'm', warnings: [] })}\n\n`)
    let sent = false
    return { body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) }) } }
  }
  return {
    api: {
      pages: {
        preview: ok({ token: 'tok', expires_in: 900 }),
        artifactToken: ok({ token: 'embed-tok', expires_in: 3600 }),
        aiStream: vi.fn().mockImplementation(async () => frames('<!DOCTYPE html><html><head><title>Tasks</title></head><body>ok</body></html>')),
        aiPlan: vi.fn().mockImplementation(() => (typeof plan.next === 'function' ? plan.next() : Promise.resolve(plan.next))),
        aiFixError: ok({ content: '' }),
      },
    },
    API_BASE_URL: '',
  }
})
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

import { api } from '../services/api'
import ArtifactStudio from '../components/artifacts/ArtifactStudio'
import { DONT_ASK_KEY, MAX_BUILD_PROMPT, composeBuildPrompt, initialChoices, usablePlan } from '../components/artifacts/artifactPlan'

const PLAN = {
  fallback: false,
  title: 'Task Organiser',
  summary: 'A clean to-do list for planning your day.',
  features: ['Add tasks with Enter', 'Filter All / Active / Done', 'Delete with undo', 'Due dates and priorities', 'Saved to the cloud'],
  questions: [
    { id: 'data-sharing', question: 'Should everyone with the link see the same data?', options: ['Yes, one shared list', 'No, each person has their own'], multi: false, default: 'No, each person has their own' },
    { id: 'who-edits', question: 'Who can add or edit?', options: ['Anyone with the link', 'Only me'], multi: false, default: 'Only me' },
    { id: 'extras', question: 'Anything else?', options: ['Tags', 'Reminders', 'Subtasks'], multi: true, default: ['Tags'] },
  ],
  style_options: [
    { id: 'clean', label: 'Clean SaaS', description: 'Crisp white cards.' },
    { id: 'warm', label: 'Warm editorial', description: 'Paper tones.' },
    { id: 'pro', label: 'Dark pro dashboard', description: 'Dense, dark-first.' },
  ],
  style_default: 'clean',
}

beforeEach(() => {
  plan.next = PLAN
  vi.clearAllMocks()
  try { localStorage.clear() } catch { /* not available */ }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup() })

function Studio({ initial = '', onChangeSpy }) {
  const [content, setContent] = useState(initial)
  return <ArtifactStudio content={content} title="" canUseAi onChange={(v) => { onChangeSpy?.(v); setContent(v) }} />
}

async function ask(text = 'make a to do list organiser') {
  fireEvent.change(screen.getByLabelText('Describe the artifact'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Build artifact' })) })
}

describe('the plan card', () => {
  it('shows a skeleton while the plan loads, and lets you skip straight to building', async () => {
    let resolve
    plan.next = () => new Promise(r => { resolve = r })
    render(<Studio />)
    await ask()
    const loading = screen.getByRole('region', { name: 'Planning your app' })
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(api.pages.aiPlan).toHaveBeenCalledWith({ prompt: 'make a to do list organiser', content_type: 'artifact' })
    expect(api.pages.aiStream).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip and build now' })) })
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    expect(api.pages.aiStream.mock.calls[0][0].prompt).toBe('make a to do list organiser')
    // A plan arriving after the skip changes nothing.
    await act(async () => { resolve(PLAN) })
    expect(screen.queryByRole('heading', { name: 'Task Organiser' })).toBeNull()
  })

  it('preselects every feature, each default answer and the suggested style', async () => {
    render(<Studio />)
    await ask()
    const heading = await screen.findByRole('heading', { name: 'Task Organiser' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(PLAN.summary)).toBeTruthy()
    for (const f of PLAN.features) expect(screen.getByRole('checkbox', { name: f }).checked).toBe(true)
    expect(screen.getByRole('radio', { name: /No, each person has their own/ }).checked).toBe(true)
    expect(screen.getByRole('radio', { name: /Yes, one shared list/ }).checked).toBe(false)
    expect(screen.getByRole('radio', { name: /Only me/ }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Tags/ }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Reminders/ }).checked).toBe(false)
    expect(screen.getByRole('radio', { name: /Clean SaaS/ }).checked).toBe(true)
    // Each question is a labelled group.
    expect(screen.getByRole('group', { name: 'Who can add or edit?' })).toBeTruthy()
    // Nothing is built until asked.
    expect(api.pages.aiStream).not.toHaveBeenCalled()
  })

  it('builds with the edited features, the answers and the style', async () => {
    render(<Studio />)
    await ask()
    await screen.findByRole('heading', { name: 'Task Organiser' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Saved to the cloud' }))
    const extra = screen.getByLabelText('Add your own feature')
    fireEvent.change(extra, { target: { value: 'Export to CSV' } })
    fireEvent.keyDown(extra, { key: 'Enter' })
    expect(screen.getByRole('checkbox', { name: 'Export to CSV' }).checked).toBe(true)
    expect(extra.value).toBe('')
    fireEvent.click(screen.getByRole('radio', { name: /Yes, one shared list/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Reminders/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Warm editorial/ }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Build it' })) })
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    const body = api.pages.aiStream.mock.calls[0][0]
    expect(body.style).toBe('warm')
    expect(body.content_type).toBe('artifact')
    expect(body.prompt).toMatch(/^make a to do list organiser\n\nPlan: Task Organiser — A clean to-do list/)
    expect(body.prompt).toContain('Build these features:\n- Add tasks with Enter\n')
    expect(body.prompt).toContain('- Export to CSV')
    expect(body.prompt).not.toContain('- Saved to the cloud')
    expect(body.prompt).toContain('Leave out: Saved to the cloud')
    expect(body.prompt).toContain('- Should everyone with the link see the same data? Yes, one shared list')
    expect(body.prompt).toContain('- Anything else? Tags, Reminders')
    expect(body.prompt).toContain('Design direction: Warm editorial')
  })

  it('"Skip questions" builds from the request as typed', async () => {
    render(<Studio />)
    await ask('a habit tracker')
    await screen.findByRole('heading', { name: 'Task Organiser' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip questions' })) })
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    expect(api.pages.aiStream.mock.calls[0][0]).toMatchObject({ prompt: 'a habit tracker' })
    expect(api.pages.aiStream.mock.calls[0][0].style).toBeUndefined()
  })

  it('"Edit request" goes back to the prompt with the text kept', async () => {
    render(<Studio />)
    await ask('a poll for lunch')
    await screen.findByRole('heading', { name: 'Task Organiser' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit request' }))
    expect(screen.getByLabelText('Describe the artifact').value).toBe('a poll for lunch')
    expect(api.pages.aiStream).not.toHaveBeenCalled()
  })

  it('builds straight away when the plan falls back or fails', async () => {
    plan.next = { fallback: true, reason: 'timeout' }
    render(<Studio />)
    await ask('a quiz')
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    cleanup(); vi.clearAllMocks()

    plan.next = () => Promise.reject(new Error('Network down'))
    render(<Studio />)
    await ask('a quiz')
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    expect(api.pages.aiStream.mock.calls[0][0].prompt).toBe('a quiz')
  })

  it('remembers "Don’t ask before building" and then skips the plan', async () => {
    render(<Studio />)
    await ask()
    await screen.findByRole('heading', { name: 'Task Organiser' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Don’t ask before building' }))
    expect(localStorage.getItem(DONT_ASK_KEY)).toBe('1')
    cleanup(); vi.clearAllMocks()

    render(<Studio />)
    await ask('an inventory tracker')
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    expect(api.pages.aiPlan).not.toHaveBeenCalled()
  })

  it('"Make changes" to an existing artifact never asks', async () => {
    render(<Studio initial={'<!DOCTYPE html><html><head><title>Tasks</title></head><body>v1</body></html>'} />)
    const box = screen.getByLabelText('Describe a change')
    fireEvent.change(box, { target: { value: 'add a dark mode toggle' } })
    await act(async () => { fireEvent.submit(box.closest('form')) })
    await waitFor(() => expect(api.pages.aiStream).toHaveBeenCalledTimes(1))
    expect(api.pages.aiPlan).not.toHaveBeenCalled()
  })

  it('is keyboard reachable from top to bottom', async () => {
    render(<Studio />)
    await ask()
    const card = (await screen.findByRole('heading', { name: 'Task Organiser' })).closest('section')
    const focusables = [...card.querySelectorAll('input, button')]
    expect(focusables.every(el => !el.disabled ? el.tabIndex >= 0 : true)).toBe(true)
    // Every control has an accessible name.
    for (const el of within(card).getAllByRole('checkbox')) expect(el.closest('label')).not.toBeNull()
    for (const el of within(card).getAllByRole('radio')) expect(el.closest('label')).not.toBeNull()
  })
})

describe('composing the build prompt', () => {
  it('keeps to the server limit by dropping features from the end', () => {
    const p = usablePlan({ ...PLAN, features: Array.from({ length: 200 }, (_, i) => `Feature number ${i} with a fairly long description`) })
    const out = composeBuildPrompt('x', p, initialChoices(p))
    expect(out.length).toBeLessThanOrEqual(MAX_BUILD_PROMPT)
    expect(out).toContain('Design direction: Clean SaaS')
  })

  it('treats an empty or malformed plan as no plan', () => {
    expect(usablePlan(null)).toBeNull()
    expect(usablePlan({ fallback: true })).toBeNull()
    expect(usablePlan({ features: 'nope', questions: 'none' })).toBeNull()
  })
})
