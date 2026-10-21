/**
 * Admin → AI gateway, against a mocked API client.
 *
 * Covers what the superadmin relies on: the state renders with Indian digit
 * grouping and route warnings; switches and the route editor send the payload
 * the API expects; a pasted key goes out once and is never shown again; prompt
 * versions save, revert and restore; a test run shows who answered; and the
 * call log turns its filters into query params.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const toast = vi.fn()
const confirm = vi.fn(async () => true)

vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../services/api', () => ({
  api: {
    admin: {
      aiGateway: {
        get: vi.fn(),
        saveProvider: vi.fn(),
        setKey: vi.fn(),
        removeKey: vi.fn(),
        testProvider: vi.fn(),
        testAll: vi.fn(),
        saveTask: vi.fn(),
        prompt: vi.fn(),
        promptVersion: vi.fn(),
        savePrompt: vi.fn(),
        testTask: vi.fn(),
        saveGlobal: vi.fn(),
        calls: vi.fn(),
        call: vi.fn(),
      },
    },
  },
}))

import { api } from '../services/api'
import { AiGatewayTab } from '../pages/admin/AiGatewayTab'

const gw = api.admin.aiGateway

const G120 = { provider: 'groq', model: 'openai/gpt-oss-120b' }
const G20 = { provider: 'groq', model: 'openai/gpt-oss-20b' }
const ORFREE = { provider: 'openrouter', model: 'openrouter/free' }
const DEFAULT_ROUTE = [G120, G20, ORFREE]

function makeState(overrides = {}) {
  return {
    storage_ok: true,
    day: '2026-10-15',
    global: { daily_call_cap: 5000, daily_token_cap: null, calls_today: 1234, tokens_today: 1234567 },
    providers: [
      {
        key: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', enabled: true,
        default_base_url: 'https://api.groq.com/openai/v1', default_timeout_s: 30,
        key_source: 'stored', key_hint: 'TAt2', key_set_by: 'boss@x.test', key_set_at: '2026-10-11T09:00:00+00:00',
        key_unreadable: false, env_var: 'GROQ_API_KEY', timeout_s: 30, daily_request_cap: null, daily_token_cap: null,
        requests_today: 12, tokens_today: 3400, ready: true,
        last_test: { at: '2026-10-15T05:00:00+00:00', ok: true, ms: 278, error: null, model_count: 2 },
        models: [
          { id: 'openai/gpt-oss-120b', context: 131072, vision: null, free: null },
          { id: 'openai/gpt-oss-20b', context: 131072, vision: null, free: null },
        ],
        used_by: { 'openai/gpt-oss-120b': ['chat', 'page_build'], 'llama-3.3-70b-versatile': ['judge'] },
      },
      {
        key: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', enabled: true,
        default_base_url: 'https://openrouter.ai/api/v1', default_timeout_s: 45,
        key_source: 'none', key_hint: null, key_set_by: null, key_set_at: null, key_unreadable: false,
        env_var: 'OPENROUTER_API_KEY', timeout_s: 45, daily_request_cap: 100, daily_token_cap: null,
        requests_today: 0, tokens_today: 0, ready: false, last_test: null, models: [],
        used_by: { 'openrouter/free': ['chat'] },
      },
    ],
    tasks: [
      {
        key: 'chat', label: 'AI assistant chat', module: 'AI assistant', description: 'Answers questions in the assistant.',
        output: 'stream', personal_data: true, enabled: true, route: [G120, ORFREE], route_custom: true, default_route: DEFAULT_ROUTE,
        daily_cap: 200, calls_today: 40, tokens_today: 9000,
        prompt: { editable: true, version: 2, overridden: true },
        route_warnings: [{ index: 1, level: 'error', message: 'No key set (OPENROUTER_API_KEY)' }],
      },
      {
        key: 'judge', label: 'Answer check', module: 'AI assistant', description: 'Checks an answer against the data.',
        output: 'json', personal_data: true, enabled: false, route: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }],
        route_custom: true, default_route: DEFAULT_ROUTE, daily_cap: null, calls_today: 3, tokens_today: 100,
        prompt: { editable: true, version: 0, overridden: false },
        route_warnings: [{ index: 0, level: 'error', message: 'Not offered by Groq — calls to it will fail' }],
      },
      {
        key: 'page_build', label: 'Build and revise pages', module: 'Pages', description: 'Writes and edits pages.',
        output: 'stream', personal_data: false, enabled: true, route: [G120], route_custom: true, default_route: DEFAULT_ROUTE,
        daily_cap: null, calls_today: 0, tokens_today: 0,
        prompt: { editable: false, version: 0, overridden: false }, route_warnings: [],
      },
    ],
    ...overrides,
  }
}

const CALLS = {
  total: 1, limit: 50, offset: 0,
  totals: { requests: 3, answered: 2, failed: 1, not_sent: 0, tokens_in: 1200, tokens_out: 300, avg_ms: 640 },
  by_task: [{ task: 'chat', label: 'AI assistant chat', requests: 3, answered: 2, failed: 1, not_sent: 0, tokens_in: 1200, tokens_out: 300, avg_ms: 640 }],
  rows: [{
    id: 7, ts: '2026-10-15T06:30:00+00:00', task: 'chat', task_label: 'AI assistant chat', provider: 'groq',
    model: 'openai/gpt-oss-120b', status: 'failed', http_status: 429, latency_ms: 812, prompt_tokens: 900, answer_tokens: 0,
    user_email: 'a@b.test', endpoint: '/api/ai/chat/stream', error: null, attempt: 1,
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  confirm.mockImplementation(async () => true)
  gw.get.mockResolvedValue(makeState())
  gw.calls.mockResolvedValue(CALLS)
})

function mount(sub) {
  const path = sub ? `/admin?tab=ai-gateway&sub=${sub}` : '/admin?tab=ai-gateway'
  return render(<MemoryRouter initialEntries={[path]}><AiGatewayTab /></MemoryRouter>)
}

async function openDialog(buttonName) {
  fireEvent.click(await screen.findByRole('button', { name: buttonName }))
  return screen.findByRole('dialog')
}

describe('state', () => {
  it('renders the header, the stat cards with Indian grouping and each task row', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'AI gateway' })).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('12,34,567')).toBeInTheDocument()
    expect(screen.getByText('Gateway cap 1,234 of 5,000')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    expect(screen.getByText('Today 40 of 200 calls')).toBeInTheDocument()
    expect(screen.getByText('Today 3 calls · no cap')).toBeInTheDocument()
    expect(screen.getByText('Prompt v2')).toBeInTheDocument()
    expect(screen.getByText('Built-in prompt')).toBeInTheDocument()
    expect(screen.getByText('Built-in prompt · fixed')).toBeInTheDocument()
    expect(screen.getAllByText('Personal data')).toHaveLength(2)
    expect(screen.getByText('JSON')).toBeInTheDocument()
    expect(screen.getByText('Step 2: No key set (OPENROUTER_API_KEY)')).toBeInTheDocument()
    expect(screen.getByText('Step 1: Not offered by Groq — calls to it will fail')).toBeInTheDocument()
  })

  it('says read-only when the gateway tables are missing, and flags no ready provider', async () => {
    const state = makeState({ storage_ok: false })
    state.providers = state.providers.map(p => ({ ...p, ready: false }))
    gw.get.mockResolvedValue(state)
    mount()
    expect(await screen.findByText('Read-only')).toBeInTheDocument()
    expect(screen.getByText('No provider ready')).toBeInTheDocument()
    expect(screen.queryByText('Ready')).toBeNull()
    expect(screen.getByText(/migration 0003 has not run/)).toBeInTheDocument()
  })

  it('shows a short message to anyone the API refuses', async () => {
    gw.get.mockRejectedValue(Object.assign(new Error('Superadmin access required'), { status: 403 }))
    mount()
    expect(await screen.findByText('Superadmins only')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI gateway' })).toBeNull()
  })
})

describe('task settings', () => {
  it('switches a task on and sends only what changed', async () => {
    gw.saveTask.mockResolvedValue({})
    mount()
    const dialog = await openDialog('Settings for Answer check')
    const toggle = within(dialog).getByRole('switch', { name: 'Task on' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(within(dialog).getByLabelText('Daily call cap'), { target: { value: '50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    // The untouched route stays out of the request, so it is not stored as an override.
    await waitFor(() => expect(gw.saveTask).toHaveBeenCalledWith('judge', { enabled: true, daily_cap: 50 }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Answer check saved', 'success'))
    await waitFor(() => expect(gw.get).toHaveBeenCalledTimes(2))
  })

  it('adds, moves and removes route steps and saves them in order', async () => {
    gw.saveTask.mockResolvedValue({})
    mount()
    const dialog = await openDialog('Settings for AI assistant chat')
    const d = within(dialog)
    expect(d.getByText('No key set (OPENROUTER_API_KEY)')).toBeInTheDocument()

    fireEvent.click(d.getByRole('button', { name: 'Add step' }))
    fireEvent.change(d.getByLabelText('Provider for step 3'), { target: { value: 'groq' } })
    fireEvent.change(d.getByLabelText('Model for step 3'), { target: { value: 'gpt-made-up' } })
    expect(d.getByText('Not offered by Groq. Calls to it will fail')).toBeInTheDocument()
    fireEvent.change(d.getByLabelText('Model for step 3'), { target: { value: ' openai/gpt-oss-20b ' } })

    fireEvent.click(d.getByRole('button', { name: 'Move step 3 up' }))
    expect(d.getByLabelText('Model for step 2')).toHaveValue(' openai/gpt-oss-20b ')
    fireEvent.click(d.getByRole('button', { name: 'Remove step 1' }))
    fireEvent.click(d.getByRole('button', { name: 'Move step 2 up' }))
    fireEvent.change(d.getByLabelText('Daily call cap'), { target: { value: '' } })
    fireEvent.click(d.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(gw.saveTask).toHaveBeenCalledWith('chat', {
      route: [ORFREE, G20],
      daily_cap: null,
    }))
  })

  it('saves the default route as null, so the task follows the built-in one', async () => {
    gw.saveTask.mockResolvedValue({})
    mount()
    const dialog = await openDialog('Settings for Answer check')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to default route' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveTask).toHaveBeenCalledWith('judge', { route: null }))
  })

  it('un-pins a saved copy of the default route, and sends nothing when nothing changed', async () => {
    const state = makeState()
    state.tasks[2] = { ...state.tasks[2], route: DEFAULT_ROUTE, route_custom: true }
    state.tasks[0] = { ...state.tasks[0], route: DEFAULT_ROUTE, route_custom: false, route_warnings: [] }
    gw.get.mockResolvedValue(state)
    gw.saveTask.mockResolvedValue({})
    mount()
    let dialog = await openDialog('Settings for Build and revise pages')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveTask).toHaveBeenCalledWith('page_build', { route: null }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    dialog = await openDialog('Settings for AI assistant chat')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(gw.saveTask).toHaveBeenCalledTimes(1)
  })

  it('caps the route at six steps and resets to the default route', async () => {
    mount()
    const dialog = await openDialog('Settings for Answer check')
    const d = within(dialog)
    fireEvent.click(d.getByRole('button', { name: 'Reset to default route' }))
    expect(d.getByLabelText('Model for step 3')).toHaveValue('openrouter/free')
    expect(d.getByRole('button', { name: 'Reset to default route' })).toBeDisabled()

    const add = d.getByRole('button', { name: 'Add step' })
    for (let i = 0; i < 5; i++) fireEvent.click(add)
    expect(d.getByLabelText('Model for step 6')).toBeInTheDocument()
    expect(d.queryByLabelText('Model for step 7')).toBeNull()
    expect(add).toBeDisabled()
    // Empty model ids block the save until they are filled in.
    expect(d.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(d.getByText(/Step 4: enter a model id/)).toBeInTheDocument()
  })
})

describe('providers', () => {
  it('switches a provider off from its edit dialog', async () => {
    gw.saveProvider.mockResolvedValue({})
    mount('providers')
    const dialog = await openDialog('Edit Groq')
    const toggle = within(dialog).getByRole('switch', { name: 'Provider on' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    fireEvent.change(within(dialog).getByLabelText('Base URL'), { target: { value: 'https://api.groq.com/openai/v1/' } })
    fireEvent.change(within(dialog).getByLabelText('Daily token cap'), { target: { value: '2000000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    // The base URL and timeout are unchanged, so they are not pinned as explicit values.
    await waitFor(() => expect(gw.saveProvider).toHaveBeenCalledWith('groq', {
      enabled: false,
      daily_token_cap: 2000000,
    }))
  })

  it('says the env key is not sent to a base URL on another host', async () => {
    const state = makeState()
    state.providers[1] = { ...state.providers[1], base_url: 'https://gw.example/api/v1' }
    gw.get.mockResolvedValue(state)
    mount('providers')
    expect(await screen.findByText(/No key for this base URL/)).toHaveTextContent('OPENROUTER_API_KEY is only sent to the default host')
  })

  it('takes a blank base URL or timeout as the built-in default', async () => {
    gw.saveProvider.mockResolvedValue({})
    mount('providers')
    const dialog = await openDialog('Edit OpenRouter')
    const d = within(dialog)
    expect(d.getByText(/Blank = the default, https:\/\/openrouter\.ai\/api\/v1/)).toBeInTheDocument()
    fireEvent.change(d.getByLabelText('Base URL'), { target: { value: '' } })
    fireEvent.change(d.getByLabelText('Timeout (seconds)'), { target: { value: '' } })
    fireEvent.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveProvider).toHaveBeenCalledWith('openrouter', { base_url: null, timeout_s: null }))
  })

  it('refuses a base URL that is an IP address or carries a user name', async () => {
    mount('providers')
    const dialog = await openDialog('Edit Groq')
    const d = within(dialog)
    for (const bad of ['https://127.0.0.1:6379', 'https://user:secret@proxy.example', 'https://localhost/v1', 'https://h.example/x?a=']) {
      fireEvent.change(d.getByLabelText('Base URL'), { target: { value: bad } })
      expect(d.getByRole('button', { name: 'Save' })).toBeDisabled()
    }
    expect(gw.saveProvider).not.toHaveBeenCalled()
  })

  it('shows key, connection, usage and model coverage per provider', async () => {
    mount('providers')
    expect(await screen.findByText('•••• TAt2')).toBeInTheDocument()
    expect(screen.getByText('Key set')).toBeInTheDocument()
    expect(screen.getByText('No key')).toBeInTheDocument()
    expect(screen.getByText(/Connected · 278 ms · checked .* · 2 models offered/)).toBeInTheDocument()
    expect(screen.getByText('Not tested')).toBeInTheDocument()
    expect(screen.getByText('0 of 100 requests · 0 tokens')).toBeInTheDocument()
    expect(screen.getByText('used by AI assistant chat, Build and revise pages')).toBeInTheDocument()
    // The stored Groq list lacks the judge's model; OpenRouter has no list yet, so nothing is flagged there.
    expect(screen.getAllByText(/Calls to it will fail/)).toHaveLength(1)
    expect(screen.getByText('All offered models (2)')).toBeInTheDocument()
  })

  it('sends a pasted key once and never shows it again', async () => {
    const SECRET = 'sk-or-v1-secret-abcd1234'
    gw.setKey.mockResolvedValue({ key: 'openrouter', key_hint: '1234' })
    mount('providers')
    const dialog = await openDialog('Set OpenRouter key')
    const input = within(dialog).getByLabelText('API key')
    // Masked with CSS where the browser can (as here), not a password field the
    // browser would offer to save as this site's login.
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore')
    fireEvent.change(input, { target: { value: `  ${SECRET}\n` } })
    const toggle = within(dialog).getByRole('button', { name: 'Show key' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(within(dialog).getByRole('button', { name: 'Hide key' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.submit(input.closest('form'))

    await waitFor(() => expect(gw.setKey).toHaveBeenCalledWith('openrouter', SECRET))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toast).toHaveBeenCalledWith('OpenRouter key saved', 'success')
    expect(document.body.textContent).not.toContain(SECRET)
    expect(screen.queryByDisplayValue(SECRET)).toBeNull()
    expect(JSON.stringify(toast.mock.calls)).not.toContain(SECRET)

    const again = await openDialog('Set OpenRouter key')
    expect(within(again).getByLabelText('API key')).toHaveValue('')
    expect(within(again).getByRole('button', { name: 'Show key' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('refuses a key with spaces or control characters before sending anything, and says why', async () => {
    mount('providers')
    const dialog = await openDialog('Set OpenRouter key')
    const input = within(dialog).getByLabelText('API key')
    fireEvent.change(input, { target: { value: 'two words here' } })
    const alert = within(dialog).getByRole('alert')
    expect(alert).toHaveTextContent('A key has no spaces or line breaks.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby').split(' ')).toContain(alert.id)
    expect(within(dialog).getByRole('button', { name: 'Save key' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'gsk_secret\u0000value' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A key has only letters, digits and punctuation.')
    expect(within(dialog).getByRole('button', { name: 'Save key' })).toBeDisabled()
    expect(gw.setKey).not.toHaveBeenCalled()
  })

  it('asks before removing a stored key', async () => {
    gw.removeKey.mockResolvedValue({})
    mount('providers')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Groq key' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' })))
    await waitFor(() => expect(gw.removeKey).toHaveBeenCalledWith('groq'))

    confirm.mockImplementation(async () => false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Groq key' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(gw.removeKey).toHaveBeenCalledTimes(1)
  })

  it('tests a connection and reports the result', async () => {
    gw.testProvider.mockResolvedValue({ ok: false, ms: 90, model_count: 0, error: 'Key rejected by Groq', provider: {} })
    mount('providers')
    fireEvent.click(await screen.findByRole('button', { name: 'Test Groq connection' }))
    await waitFor(() => expect(gw.testProvider).toHaveBeenCalledWith('groq'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Key rejected by Groq', 'error'))
  })

  it('saves the gateway caps, blank meaning no cap', async () => {
    gw.saveGlobal.mockResolvedValue({})
    mount('providers')
    const dialog = await openDialog('Edit gateway caps')
    fireEvent.change(within(dialog).getByLabelText('Daily call cap'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('Daily token cap'), { target: { value: '500000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveGlobal).toHaveBeenCalledWith({ daily_call_cap: null, daily_token_cap: 500000 }))
  })
})

describe('prompts', () => {
  const PROMPT = {
    editable: true,
    default: 'Built-in rules ===ANSWER=== ===END===',
    current: 'Custom v2 ===ANSWER=== ===END===',
    version: 2,
    overridden: true,
    history: [
      { version: 2, created_at: '2026-10-14T10:00:00+00:00', created_by: 'boss@x.test', reverted: false, chars: 33 },
      { version: 1, created_at: '2026-10-13T10:00:00+00:00', created_by: 'boss@x.test', reverted: false, chars: 28 },
    ],
  }

  it('saves a new version, goes back to the built-in prompt and restores an old one', async () => {
    gw.prompt.mockResolvedValue(PROMPT)
    gw.savePrompt
      .mockResolvedValueOnce({ ...PROMPT, current: 'New ===ANSWER=== ===END===', version: 3 })
      .mockResolvedValueOnce({ ...PROMPT, current: PROMPT.default, version: 4, overridden: false })
      .mockResolvedValueOnce({ ...PROMPT, current: 'Old ===ANSWER=== ===END===', version: 5 })
    gw.promptVersion.mockResolvedValue({ version: 1, prompt: 'Old ===ANSWER=== ===END===', created_at: '2026-10-13T10:00:00+00:00', created_by: 'boss@x.test' })
    mount()
    const dialog = await openDialog('Prompt for AI assistant chat')
    const d = within(dialog)
    const box = await d.findByLabelText('System prompt')
    expect(box).toHaveValue(PROMPT.current)
    expect(d.getByText(/Keep the/)).toBeInTheDocument()

    expect(d.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(box, { target: { value: 'New ===ANSWER=== ===END===' } })
    fireEvent.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.savePrompt).toHaveBeenNthCalledWith(1, 'chat', 'New ===ANSWER=== ===END==='))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Saved as version 3', 'success'))

    fireEvent.click(d.getByRole('button', { name: /Use built-in/ }))
    await waitFor(() => expect(gw.savePrompt).toHaveBeenNthCalledWith(2, 'chat', null))
    expect(confirm).toHaveBeenCalledTimes(1)

    fireEvent.click(await d.findByRole('button', { name: 'Restore version 1' }))
    await waitFor(() => expect(gw.promptVersion).toHaveBeenCalledWith('chat', 1))
    await waitFor(() => expect(gw.savePrompt).toHaveBeenNthCalledWith(3, 'chat', 'Old ===ANSWER=== ===END==='))
  })

  it('asks before closing over an unsaved draft', async () => {
    gw.prompt.mockResolvedValue(PROMPT)
    confirm.mockImplementation(async () => false)
    mount()
    const dialog = await openDialog('Prompt for AI assistant chat')
    const d = within(dialog)
    fireEvent.change(await d.findByLabelText('System prompt'), { target: { value: 'Half-written ===ANSWER===' } })
    fireEvent.click(d.getAllByRole('button', { name: 'Close' }).at(-1))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard your changes?' })))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(d.getByLabelText('System prompt')).toHaveValue('Half-written ===ANSWER===')

    confirm.mockImplementation(async () => true)
    fireEvent.click(d.getAllByRole('button', { name: 'Close' }).at(-1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not revert when the confirmation is cancelled', async () => {
    gw.prompt.mockResolvedValue(PROMPT)
    confirm.mockImplementation(async () => false)
    mount()
    const dialog = await openDialog('Prompt for AI assistant chat')
    await within(dialog).findByLabelText('System prompt')
    fireEvent.click(within(dialog).getByRole('button', { name: /Use built-in/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(gw.savePrompt).not.toHaveBeenCalled()
  })

  it('shows a fixed prompt read-only', async () => {
    gw.prompt.mockResolvedValue({ editable: false, default: 'Assembled from the design rules and the live page.', current: '', version: 0, overridden: false, history: [] })
    mount()
    const dialog = await openDialog('Prompt for Build and revise pages')
    expect(await within(dialog).findByText('Assembled from the design rules and the live page.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('test run', () => {
  it('runs the task and shows who answered and every attempt', async () => {
    gw.testTask.mockResolvedValue({
      ok: true, content: '{"verdict":"supported"}', model: 'openai/gpt-oss-120b', provider: 'groq', ms: 812, error: null,
      attempts: [
        { provider: 'openrouter', model: 'openrouter/free', ok: false, ms: 120, error: 'Key rejected by OpenRouter', skipped: false },
        { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', ok: false, ms: 0, error: 'skipped: key rejected on an earlier step', skipped: true },
        { provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, ms: 812, error: null, skipped: false },
      ],
    })
    mount()
    const dialog = await openDialog('Test Answer check')
    const d = within(dialog)
    expect(d.getByText(/Runs even when the task is off/)).toBeInTheDocument()
    fireEvent.change(d.getByLabelText('Input'), { target: { value: 'Is revenue up?' } })
    fireEvent.click(d.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(gw.testTask).toHaveBeenCalledWith('judge', 'Is revenue up?'))
    const line = await d.findByText(/Answered by Groq/)
    expect(line.textContent).toBe('Answered by Groq · openai/gpt-oss-120b in 812 ms')
    expect(d.getByText('{"verdict":"supported"}')).toBeInTheDocument()
    expect(d.getByText('Key rejected by OpenRouter')).toBeInTheDocument()
    expect(d.getByText('Failed')).toBeInTheDocument()
    expect(d.getByText('Answered')).toBeInTheDocument()
    // A step that was never sent is not a failure, and has no time to show.
    const skipped = d.getByText('Skipped').closest('li')
    expect(within(skipped).queryByText(/ ms$/)).toBeNull()
    expect(within(skipped).getByText('skipped: key rejected on an earlier step')).toBeInTheDocument()
  })

  it('explains a test that outlasted the browser timeout', async () => {
    gw.testTask.mockRejectedValue(new Error('Request timed out — check your connection'))
    mount()
    const dialog = await openDialog('Test Answer check')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/ran past the browser's time limit/)
  })

  it('sends no input when the box is empty and shows a failure in red', async () => {
    gw.testTask.mockResolvedValue({ ok: false, content: null, model: null, provider: null, ms: 0, attempts: [], error: 'No AI provider is available for Answer check.' })
    mount()
    const dialog = await openDialog('Test Answer check')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(gw.testTask).toHaveBeenCalledWith('judge', null))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No AI provider is available for Answer check.')
  })
})

describe('call log', () => {
  it('loads today and turns each filter into query params', async () => {
    mount('log')
    await waitFor(() => expect(gw.calls).toHaveBeenCalled())
    expect(gw.calls).toHaveBeenLastCalledWith({ from: '2026-10-15', to: '2026-10-15', task: '', provider: '', status: '', limit: 50, offset: 0 })

    fireEvent.change(await screen.findByLabelText('Task'), { target: { value: 'chat' } })
    await waitFor(() => expect(gw.calls).toHaveBeenLastCalledWith(expect.objectContaining({ task: 'chat', offset: 0 })))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'groq' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'not_sent' } })
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(gw.calls).toHaveBeenLastCalledWith({
      from: '2026-10-09', to: '2026-10-15', task: 'chat', provider: 'groq', status: 'not_sent', limit: 50, offset: 0,
    }))
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(gw.calls).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-15' })))
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows totals, rows in IST and a call\'s details', async () => {
    gw.call.mockResolvedValue({ ...CALLS.rows[0], error: 'Groq answered HTTP 429', request_id: 'req-1', session_id: 's-1', extra: { ok: false, attempt: 1 } })
    mount('log')
    expect(await screen.findByRole('rowheader', { name: 'All' })).toBeInTheDocument()
    expect(screen.getAllByText('1,200 / 300').length).toBeGreaterThan(0)
    // 06:30 UTC is noon in India.
    const open = await screen.findByRole('button', { name: /Call 7 at .*open details/ })
    expect(open.textContent).toMatch(/15 Oct, 12:00:00\s?pm/i)
    const row = within(open.closest('tr'))
    expect(row.getByText('Failed')).toBeInTheDocument()
    expect(row.getByText('900 / 0')).toBeInTheDocument()
    expect(row.getByText('812 ms')).toBeInTheDocument()

    fireEvent.click(open)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(gw.call).toHaveBeenCalledWith(7))
    expect(await within(dialog).findByText('Groq answered HTTP 429')).toBeInTheDocument()
    expect(within(dialog).getByText('req-1')).toBeInTheDocument()
  })

  it('says so when no call matches', async () => {
    gw.calls.mockResolvedValue({ ...CALLS, total: 0, rows: [], by_task: [] })
    mount('log')
    expect(await screen.findByText('No calls for these filters.')).toBeInTheDocument()
  })
})
