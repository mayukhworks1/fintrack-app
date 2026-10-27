/**
 * Admin → AI gateway: the screens that manage every provider, model, chain
 * and limit, against a mocked API client.
 *
 * Covers: the overview's health, alerts and usage-against-limit bars; adding
 * a preset or custom provider (a key goes out once and is never shown again,
 * a header that could hold a secret is refused before sending) and removing
 * one only after a confirmation; the model catalogue (add, switch off,
 * fetch-and-import, remove); the global default chain with drag-to-reorder
 * and per-step options; the circuit breaker and its bench; limits per period
 * and metric; and the logs' model and latency filters with "why" in plain words.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const toast = vi.fn()
const confirm = vi.fn(async () => true)

vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('../services/api', () => {
  const names = ['get', 'saveProvider', 'setKey', 'removeKey', 'testProvider', 'testAll', 'saveTask', 'prompt',
    'promptVersion', 'savePrompt', 'testTask', 'saveGlobal', 'calls', 'call', 'addProvider', 'deleteProvider',
    'fetchModels', 'saveModel', 'importModels', 'deleteModel', 'modelStats', 'saveDefaultRoute', 'saveBreaker',
    'resetBench', 'saveLimits']
  return { api: { admin: { aiGateway: Object.fromEntries(names.map(n => [n, vi.fn()])) } } }
})

import { api } from '../services/api'
import { AiGatewayTab } from '../pages/admin/AiGatewayTab'

const gw = api.admin.aiGateway
const G120 = { provider: 'groq', model: 'openai/gpt-oss-120b' }
const G20 = { provider: 'groq', model: 'openai/gpt-oss-20b' }
const ORFREE = { provider: 'openrouter', model: 'openrouter/free' }

const PRESETS = [
  { key: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', note: 'Fast open models.', builtin: true },
  { key: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', note: 'Many models.', builtin: true },
  { key: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1', note: 'GPT models.', builtin: false },
  { key: 'gemini', label: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', note: 'Gemini.', builtin: false },
]

function provider(over) {
  return {
    key: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', default_base_url: 'https://api.groq.com/openai/v1',
    preset: 'groq', builtin: true, flavor: 'groq', extra_headers: {}, in_default_route: [], benched: null, catalog_count: 1,
    enabled: true, key_source: 'stored', key_hint: 'TAt2', key_set_by: 'boss@x.test', key_set_at: '2026-10-11T09:00:00+00:00',
    key_unreadable: false, env_var: 'GROQ_API_KEY', timeout_s: 30, default_timeout_s: 30, daily_request_cap: 500,
    daily_token_cap: null, requests_today: 400, tokens_today: 3400, ready: true,
    last_test: { at: '2026-10-15T05:00:00+00:00', ok: true, ms: 278, error: null, model_count: 2 },
    models: [
      { id: 'openai/gpt-oss-120b', context: 131072, vision: null, free: null, max_output: 65536 },
      { id: 'openai/gpt-oss-20b', context: 131072, vision: null, free: null },
      { id: 'llama-3.3-70b-versatile', context: 131072, vision: null, free: null },
    ],
    used_by: { 'openai/gpt-oss-120b': ['chat'] },
    ...over,
  }
}

function makeState(over = {}) {
  return {
    storage_ok: true, v2: true, day: '2026-10-15',
    global: { daily_call_cap: 1000, daily_token_cap: null, calls_today: 450, tokens_today: 90000 },
    providers: [
      provider(),
      provider({
        key: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_base_url: 'https://openrouter.ai/api/v1',
        preset: 'openrouter', flavor: 'openrouter', key_source: 'env', key_hint: '0000', env_var: 'OPENROUTER_API_KEY',
        benched: 'provider benched for 4 more min after 3 failures in a row', models: [], last_test: null, used_by: { 'openrouter/free': ['chat'] },
        daily_request_cap: null, catalog_count: 0,
      }),
      provider({
        key: 'acme', label: 'Acme LLM', base_url: 'https://llm.acme.ai/v1', default_base_url: 'https://llm.acme.ai/v1', preset: null,
        builtin: false, flavor: 'openai', extra_headers: { 'X-Org': 'fin' }, env_var: '', key_source: 'none', key_hint: null,
        ready: false, models: [], last_test: null, used_by: {}, daily_request_cap: null, catalog_count: 0,
      }),
    ],
    removed_builtins: [],
    presets: PRESETS,
    tasks: [
      {
        key: 'chat', label: 'AI assistant chat', module: 'AI assistant', description: 'Answers questions.', output: 'stream',
        personal_data: true, enabled: true, route: [G120], route_custom: true, default_route: [G20, ORFREE],
        effective_route: [G120, { ...G20, fallback: true }, { ...ORFREE, fallback: true }], fallback_to_default: true,
        daily_cap: null, calls_today: 40, tokens_today: 9000, prompt: { editable: true, version: 0, overridden: false }, route_warnings: [],
      },
    ],
    catalog: [{
      provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', enabled: true, context_window: 131072,
      max_output_tokens: 32768, request_token_limit: 8000, input_cost_per_m: 0.15, output_cost_per_m: 0.6, vision: null,
      offered: true, used_by: ['chat'], in_default_route: false, benched: null,
      usage: { day: { calls: 30, tokens: 9000, spend: 0.0042 }, week: { calls: 90, tokens: 1, spend: 0 }, month: { calls: 90, tokens: 1, spend: 0 } },
    }],
    default_route: [G20, ORFREE], default_route_custom: true, builtin_default_route: [G120, G20, ORFREE],
    default_route_warnings: [], max_route_steps: 10,
    breaker: {
      failures: 3, minutes: 5,
      benched: [{ target: 'p:openrouter', kind: 'provider', provider: 'openrouter', model: null, failures: 3,
        last_error: 'HTTP 503', since: '2026-10-15T05:55:00+00:00', until: new Date(Date.now() + 4 * 60000).toISOString() }],
    },
    limits: [
      { scope: 'global', target: '', label: 'Workspace', limits: [
        { period: 'day', metric: 'requests', cap: 1000, used: 450, pct: 45 },
        { period: 'month', metric: 'spend', cap: 50, used: 41.5, pct: 83 },
      ] },
      { scope: 'provider', target: 'groq', label: 'Groq', limits: [{ period: 'day', metric: 'requests', cap: 500, used: 400, pct: 80 }] },
    ],
    usage: {
      day: { total: { calls: 450, tokens: 90000, spend: 1.25 }, by_provider: { groq: { calls: 400, tokens: 3400, spend: 1 } }, by_task: {}, by_model: {} },
      week: { total: { calls: 2000, tokens: 400000, spend: 9.5 }, by_provider: {}, by_task: {}, by_model: {} },
      month: { total: { calls: 9000, tokens: 1800000, spend: 41.5 }, by_provider: {}, by_task: {}, by_model: {} },
    },
    alerts: [
      { level: 'warn', message: 'Workspace: 83% of this month\'s spend limit used.' },
      { level: 'warn', message: 'Acme LLM is in a chain but has no key; its steps are skipped.' },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  confirm.mockImplementation(async () => true)
  gw.get.mockResolvedValue(makeState())
  gw.modelStats.mockResolvedValue({ days: 7, models: [
    { provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', requests: 40, ok: 38, failed: 2, success_rate: 0.95,
      p50_ms: 812, p95_ms: 2400, why: 'Rate-limited by the provider: too many requests or tokens for this minute. The next step was tried.',
      last_error: 'rate-limited', benched: null },
  ] })
  gw.calls.mockResolvedValue({ total: 0, limit: 50, offset: 0, totals: {}, by_task: [], rows: [] })
})

function mount(sub) {
  return render(<MemoryRouter initialEntries={[`/admin?tab=ai-gateway&sub=${sub}`]}><AiGatewayTab /></MemoryRouter>)
}

async function openDialog(name) {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('dialog')
}

describe('overview', () => {
  it('shows provider health, alerts, usage per period and limits as bars', async () => {
    mount('overview')
    const health = (await screen.findByRole('heading', { name: 'Provider health' })).closest('section')
    expect(within(health).getByText('Benched')).toBeInTheDocument()
    expect(within(health).getAllByText('No key').length).toBeGreaterThan(0)
    expect(screen.getByText(/83% of this month's spend limit used/)).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'This month' }).closest('tr')).toHaveTextContent('9,000')
    expect(screen.getByText('$41.50')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Monthly spend (usd)' })
    expect(bar).toHaveAttribute('aria-valuenow', '83')
    // Over half of a provider limit: listed among the closest.
    expect(screen.getByRole('progressbar', { name: 'Groq · daily requests' })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument()
  })
})

describe('providers', () => {
  it('adds a preset with its key, sending the key once and never showing it again', async () => {
    const SECRET = 'sk-proj-SuperSecret0123456789'
    gw.addProvider.mockResolvedValue({ key: 'openai', label: 'OpenAI', key_hint: '6789' })
    mount('providers')
    const dialog = await openDialog('Add provider')
    const d = within(dialog)
    fireEvent.click(d.getByRole('radio', { name: /OpenAI/ }))
    const key = d.getByLabelText('API key')
    expect(key).toHaveAttribute('autocomplete', 'off')
    fireEvent.change(key, { target: { value: `  ${SECRET} ` } })
    fireEvent.click(d.getByRole('button', { name: 'Add provider' }))
    await waitFor(() => expect(gw.addProvider).toHaveBeenCalledWith({ preset: 'openai', api_key: SECRET }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toast).toHaveBeenCalledWith('OpenAI added', 'success')
    expect(document.body.textContent).not.toContain(SECRET)
    expect(JSON.stringify(toast.mock.calls)).not.toContain(SECRET)
  })

  it('adds a custom provider with headers, refusing a URL or header that could leak the key', async () => {
    gw.addProvider.mockResolvedValue({ key: 'proxy', label: 'Company proxy' })
    mount('providers')
    const dialog = await openDialog('Add provider')
    const d = within(dialog)
    fireEvent.click(d.getByRole('radio', { name: /Custom/ }))
    const save = d.getByRole('button', { name: 'Add provider' })
    expect(save).toBeDisabled()
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'Company proxy' } })
    for (const bad of ['http://llm.corp.example/v1', 'https://10.1.2.3/v1', 'https://llm.internal/v1', 'https://x.example:8443/v1']) {
      fireEvent.change(d.getByLabelText('Base URL'), { target: { value: bad } })
      expect(save).toBeDisabled()
    }
    fireEvent.change(d.getByLabelText('Base URL'), { target: { value: 'https://llm.example.com/v1/' } })
    expect(save).toBeEnabled()
    fireEvent.click(d.getByRole('button', { name: 'Add header' }))
    fireEvent.change(d.getByLabelText('Header 1 name'), { target: { value: 'X-Api-Key' } })
    fireEvent.change(d.getByLabelText('Header 1 value'), { target: { value: 'abc' } })
    expect(d.getByText(/looks like it carries a secret/)).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(d.getByLabelText('Header 1 name'), { target: { value: 'X-Org-Id' } })
    fireEvent.click(save)
    await waitFor(() => expect(gw.addProvider).toHaveBeenCalledWith({
      label: 'Company proxy', base_url: 'https://llm.example.com/v1', extra_headers: { 'X-Org-Id': 'abc' },
    }))
  })

  it('removes a provider only after a confirmation that names its tasks', async () => {
    gw.deleteProvider.mockResolvedValue({ ok: true })
    confirm.mockImplementationOnce(async () => false)
    mount('providers')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Groq' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'danger', message: expect.stringContaining('AI assistant chat'),
    })))
    expect(gw.deleteProvider).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Groq' }))
    await waitFor(() => expect(gw.deleteProvider).toHaveBeenCalledWith('groq'))
  })

  it('shows a custom provider, its headers, its limits and the bench', async () => {
    mount('providers')
    const card = (await screen.findByRole('heading', { name: 'Acme LLM' })).closest('article')
    expect(within(card).getByText('Custom')).toBeInTheDocument()
    expect(within(card).getByText('X-Org')).toBeInTheDocument()
    expect(within(card).getByText(/only ever sent to llm\.acme\.ai/)).toBeInTheDocument()
    const groq = screen.getByRole('heading', { name: 'Groq' }).closest('article')
    expect(within(groq).getByRole('progressbar', { name: 'Daily requests' })).toHaveAttribute('aria-valuenow', '80')
    const or = screen.getByRole('heading', { name: 'OpenRouter' }).closest('article')
    expect(within(or).getByText(/Provider benched for 4 more min/)).toBeInTheDocument()
  })

  it('edits the name and extra headers', async () => {
    gw.saveProvider.mockResolvedValue({})
    mount('providers')
    const dialog = await openDialog('Edit Acme LLM')
    const d = within(dialog)
    fireEvent.change(d.getByLabelText('Name'), { target: { value: 'Acme' } })
    fireEvent.click(d.getByRole('button', { name: 'Remove header 1' }))
    fireEvent.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveProvider).toHaveBeenCalledWith('acme', { label: 'Acme', extra_headers: {} }))
  })

  it('says adding providers needs migration 0008 when it has not run', async () => {
    gw.get.mockResolvedValue(makeState({ v2: false }))
    mount('providers')
    expect(await screen.findByText(/needs database migration 0008/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove Groq' })).toBeNull()
  })
})

describe('models', () => {
  it('lists the catalogue with limits, prices and how each model is doing', async () => {
    mount('models')
    expect(await screen.findByText('GPT-OSS 120B')).toBeInTheDocument()
    expect(screen.getByText('8K')).toBeInTheDocument()            // per-request limit
    expect(screen.getByText('$0.15')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('95%')).toBeInTheDocument())
    expect(screen.getByText('812 ms')).toBeInTheDocument()
    expect(screen.getByText(/No OpenRouter models in the catalogue/)).toBeInTheDocument()
  })

  it('adds a model with its limits and prices', async () => {
    gw.saveModel.mockResolvedValue({ ok: true })
    mount('models')
    const dialog = await openDialog('Add a Groq model')
    const d = within(dialog)
    fireEvent.change(d.getByLabelText('Model id'), { target: { value: 'openai/gpt-oss-20b' } })
    fireEvent.change(d.getByLabelText('Per-request token limit'), { target: { value: '6000' } })
    fireEvent.change(d.getByLabelText('Input price per 1M tokens (USD)'), { target: { value: '0.1' } })
    fireEvent.change(d.getByLabelText('Context window'), { target: { value: 'big' } })
    expect(d.getByRole('button', { name: 'Add model' })).toBeDisabled()
    fireEvent.change(d.getByLabelText('Context window'), { target: { value: '131072' } })
    fireEvent.click(d.getByRole('button', { name: 'Add model' }))
    await waitFor(() => expect(gw.saveModel).toHaveBeenCalledWith({
      provider: 'groq', model: 'openai/gpt-oss-20b', context_window: 131072, request_token_limit: 6000, input_cost_per_m: 0.1,
    }))
  })

  it('switches a model off and removes one after confirming', async () => {
    gw.saveModel.mockResolvedValue({ ok: true })
    gw.deleteModel.mockResolvedValue({ ok: true })
    mount('models')
    fireEvent.click(await screen.findByRole('switch', { name: 'GPT-OSS 120B on' }))
    await waitFor(() => expect(gw.saveModel).toHaveBeenCalledWith({ provider: 'groq', model: 'openai/gpt-oss-120b', enabled: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove GPT-OSS 120B' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' })))
    await waitFor(() => expect(gw.deleteModel).toHaveBeenCalledWith('groq', 'openai/gpt-oss-120b'))
  })

  it('fetches the provider list and imports the chosen models', async () => {
    gw.fetchModels.mockResolvedValue({ ok: true, models: [
      { id: 'openai/gpt-oss-120b', context: 131072, in_catalog: true },
      { id: 'openai/gpt-oss-20b', context: 131072, in_catalog: false },
      { id: 'qwen/qwen3-32b', context: 131072, in_catalog: false },
    ] })
    gw.importModels.mockResolvedValue({ ok: true, added: 1 })
    mount('models')
    const dialog = await openDialog('Fetch Groq models')
    const d = within(dialog)
    await waitFor(() => expect(gw.fetchModels).toHaveBeenCalledWith('groq'))
    const inCatalog = await d.findByRole('checkbox', { name: /openai\/gpt-oss-120b/ })
    expect(inCatalog).toBeChecked()
    expect(inCatalog).toBeDisabled()
    fireEvent.change(d.getByLabelText('Search Groq models'), { target: { value: 'qwen' } })
    fireEvent.click(d.getByRole('checkbox', { name: /qwen\/qwen3-32b/ }))
    fireEvent.click(d.getByRole('button', { name: /Add 1 to catalogue/ }))
    await waitFor(() => expect(gw.importModels).toHaveBeenCalledWith('groq', ['qwen/qwen3-32b']))
  })

  it('reports a failed fetch in plain words', async () => {
    gw.fetchModels.mockResolvedValue({ ok: false, error: 'Key rejected by Groq', models: [] })
    mount('models')
    const dialog = await openDialog('Fetch Groq models')
    expect(await within(dialog).findByText('Key rejected by Groq')).toBeInTheDocument()
  })
})

describe('routing & fallbacks', () => {
  it('saves the default chain with per-step options, reordered by dragging', async () => {
    gw.saveDefaultRoute.mockResolvedValue({ default_route: [ORFREE, G20] })
    mount('routing')
    const section = (await screen.findByRole('heading', { name: 'Global default chain' })).closest('section')
    const s = within(section)
    expect(s.getByRole('button', { name: 'Save chain' })).toBeDisabled()
    // Drag step 2 onto step 1.
    const handle = s.getByLabelText('Model for step 2').closest('li').querySelector('[draggable]')
    const store = {}
    const dataTransfer = { setData: (k, v) => { store[k] = v }, getData: k => store[k], effectAllowed: '' }
    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragOver(s.getByLabelText('Model for step 1').closest('li'), { dataTransfer })
    fireEvent.drop(s.getByLabelText('Model for step 1').closest('li'), { dataTransfer })
    expect(s.getByLabelText('Model for step 1')).toHaveValue('openrouter/free')
    fireEvent.change(s.getByLabelText('Timeout for step 1 (seconds)'), { target: { value: '20' } })
    fireEvent.click(s.getByLabelText('Skip step 2 when over its limit'))
    fireEvent.click(s.getByRole('button', { name: 'Save chain' }))
    await waitFor(() => expect(gw.saveDefaultRoute).toHaveBeenCalledWith([
      { ...ORFREE, timeout_s: 20 }, { ...G20, skip_over_limit: false },
    ]))
  })

  it('refuses a bad timeout or the same model twice', async () => {
    mount('routing')
    const section = (await screen.findByRole('heading', { name: 'Global default chain' })).closest('section')
    const s = within(section)
    fireEvent.change(s.getByLabelText('Timeout for step 1 (seconds)'), { target: { value: '500' } })
    expect(s.getByText(/the timeout is 5 to 120 seconds/)).toBeInTheDocument()
    fireEvent.change(s.getByLabelText('Timeout for step 1 (seconds)'), { target: { value: '' } })
    fireEvent.change(s.getByLabelText('Provider for step 2'), { target: { value: 'groq' } })
    fireEvent.change(s.getByLabelText('Model for step 2'), { target: { value: 'openai/gpt-oss-20b' } })
    expect(s.getByText(/already in the chain/)).toBeInTheDocument()
    expect(s.getByRole('button', { name: 'Save chain' })).toBeDisabled()
  })

  it('goes back to the built-in default chain', async () => {
    gw.saveDefaultRoute.mockResolvedValue({ default_route: [G120, G20, ORFREE] })
    mount('routing')
    fireEvent.click(await screen.findByRole('button', { name: 'Use built-in' }))
    await waitFor(() => expect(gw.saveDefaultRoute).toHaveBeenCalledWith(null))
  })

  it('shows the default chain behind a task and lets the task opt out', async () => {
    gw.saveTask.mockResolvedValue({})
    mount('routing')
    const chain = await screen.findByRole('list', { name: 'Route' })
    expect(within(chain).getAllByText('(default chain)')).toHaveLength(2)
    const dialog = await openDialog('Settings for AI assistant chat')
    const toggle = within(dialog).getByRole('switch', { name: 'Fall back to the default chain' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveTask).toHaveBeenCalledWith('chat', { fallback_to_default: false }))
  })

  it('saves the circuit breaker and takes a provider off the bench', async () => {
    gw.saveBreaker.mockResolvedValue({})
    gw.resetBench.mockResolvedValue({ cleared: 1, benched: [] })
    mount('routing')
    const section = (await screen.findByRole('heading', { name: 'Circuit breaker' })).closest('section')
    const s = within(section)
    expect(s.getByText(/3 failures in a row · back in [45] min/)).toBeInTheDocument()
    fireEvent.change(s.getByLabelText('Failures in a row'), { target: { value: '5' } })
    fireEvent.change(s.getByLabelText('Minutes on the bench'), { target: { value: '2000' } })
    expect(s.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(s.getByLabelText('Minutes on the bench'), { target: { value: '10' } })
    fireEvent.click(s.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveBreaker).toHaveBeenCalledWith({ failures: 5, minutes: 10 }))
    fireEvent.click(s.getByRole('button', { name: 'Take OpenRouter off the bench' }))
    await waitFor(() => expect(gw.resetBench).toHaveBeenCalledWith('p:openrouter'))
  })
})

describe('limits', () => {
  it('shows usage against each limit and sets limits per period and metric', async () => {
    gw.saveLimits.mockResolvedValue({ limits: [] })
    mount('limits')
    const row = (await screen.findByRole('button', { name: 'Edit limits for AI assistant chat' })).closest('li')
    expect(within(row).getByText(/No limits/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Monthly spend (usd)' })).toHaveAttribute('aria-valuenow', '83')

    const dialog = await openDialog('Edit limits for AI assistant chat')
    const d = within(dialog)
    fireEvent.change(d.getByLabelText('Weekly requests limit'), { target: { value: '1.5' } })
    expect(d.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(d.getByLabelText('Weekly requests limit'), { target: { value: '700' } })
    fireEvent.change(d.getByLabelText('Monthly spend (usd) limit'), { target: { value: '12.5' } })
    fireEvent.change(d.getByLabelText('Daily tokens limit'), { target: { value: '200000' } })
    fireEvent.click(d.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gw.saveLimits).toHaveBeenCalledWith('task', 'chat', [
      { period: 'day', metric: 'tokens', cap: 200000 },
      { period: 'week', metric: 'requests', cap: 700 },
      { period: 'month', metric: 'spend', cap: 12.5 },
    ]))
  })

  it('removes every limit of a target after confirming', async () => {
    gw.saveLimits.mockResolvedValue({ limits: [] })
    mount('limits')
    const dialog = await openDialog('Edit limits for Groq')
    expect(within(dialog).getByLabelText('Daily requests limit')).toHaveValue('500')
    fireEvent.click(within(dialog).getByRole('button', { name: /Remove all/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' })))
    await waitFor(() => expect(gw.saveLimits).toHaveBeenCalledWith('provider', 'groq', []))
  })

  it('offers per-user and per-model limits, read-only before migration 0008', async () => {
    gw.get.mockResolvedValue(makeState({ v2: false }))
    mount('limits')
    expect(await screen.findByRole('button', { name: 'Edit limits for Each user' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit limits for Groq · GPT-OSS 120B' })).toBeDisabled()
    expect(screen.getByText(/Limits need database migration 0008/)).toBeInTheDocument()
  })
})

describe('logs', () => {
  it('filters by model and latency and shows why a call failed', async () => {
    gw.calls.mockResolvedValue({
      total: 1, limit: 50, offset: 0, totals: { requests: 1, failed: 1 }, by_task: [],
      rows: [{ id: 9, ts: '2026-10-15T06:30:00+00:00', task: 'chat', task_label: 'AI assistant chat', provider: 'groq',
        model: 'openai/gpt-oss-120b', status: 'failed', http_status: 401, latency_ms: 90, prompt_tokens: 0, answer_tokens: 0,
        user_email: null, endpoint: null, error: 'key rejected (HTTP 401)',
        why: 'The provider rejected the API key. Set a new key under Providers.', attempt: 1 }],
    })
    mount('log')
    expect(await screen.findByText('The provider rejected the API key. Set a new key under Providers.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'openai/gpt-oss-120b' } })
    fireEvent.change(screen.getByLabelText('Latency'), { target: { value: '5000' } })
    await waitFor(() => expect(gw.calls).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'openai/gpt-oss-120b', min_ms: 5000, offset: 0,
    })))
  })

  it('shows per-model success rate and median latency, and opens a model\'s failures', async () => {
    mount('log')
    const table = await screen.findByRole('table', { name: 'Success rate and latency per model' })
    const row = within(table).getByRole('rowheader', { name: /GPT-OSS 120B/ }).closest('tr')
    expect(within(row).getByText('95%')).toBeInTheDocument()
    expect(within(row).getByText('812 ms')).toBeInTheDocument()
    expect(within(row).getByText('2,400 ms')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Show failed calls to openai/gpt-oss-120b' }))
    await waitFor(() => expect(gw.calls).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: 'groq', model: 'openai/gpt-oss-120b', status: 'failed',
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Model statistics: 30 days' }))
    await waitFor(() => expect(gw.modelStats).toHaveBeenLastCalledWith(30))
  })
})
