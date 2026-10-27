// AI gateway › Models: each provider's model catalogue — label, on/off,
// context window, output and per-request token limits, and prices for spend
// estimates — with how each model has been doing.
import { useState, useEffect, useMemo } from 'react'
import { Plus, Download, Pencil, Trash2, Loader2, Search, Boxes, Moon, Eye as EyeIcon } from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Toggle } from './ui'
import {
  EmptyState, Field, LimitBars, MODEL_ID_RE, Notice, compact, num, parseAmount, usd, useDomId,
} from './AiGatewayShared'

const pct = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`)
const secs = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${num(ms)} ms`)

export function AiGatewayModels({ providers, catalog, tasks, limits = [], v2, readOnly, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const uid = useDomId()
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null)
  const [stats, setStats] = useState({})
  const [busy, setBusy] = useState('')
  const close = () => setDialog(null)

  useEffect(() => {
    let alive = true
    api.admin.aiGateway.modelStats(7)
      .then(res => {
        if (!alive) return
        setStats(Object.fromEntries((res?.models || []).map(m => [`${m.provider}|${m.model}`, m])))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const taskLabels = useMemo(() => Object.fromEntries(tasks.map(t => [t.key, t.label])), [tasks])
  const q = query.trim().toLowerCase()
  const shown = providers.filter(p => !filter || p.key === filter)
  const limitsOf = (target) => limits.find(g => g.scope === 'model' && g.target === target)?.limits || []

  const toggle = async (m) => {
    setBusy(`toggle:${m.provider}|${m.model}`)
    try {
      await api.admin.aiGateway.saveModel({ provider: m.provider, model: m.model, enabled: !m.enabled })
      toast(`${m.label || m.model} switched ${m.enabled ? 'off' : 'on'}`, 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not change the model', 'error')
    } finally {
      setBusy('')
    }
  }

  const remove = async (m) => {
    const ok = await confirm({
      title: `Remove ${m.label || m.model} from the catalogue?`,
      message: `Its token limits, prices and limits are deleted.${m.used_by?.length
        ? ` ${m.used_by.map(k => taskLabels[k] || k).join(', ')} still ${m.used_by.length === 1 ? 'names' : 'name'} it in a chain and will call it with nothing known about it.`
        : ''}`,
      confirmLabel: 'Remove model',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`delete:${m.provider}|${m.model}`)
    try {
      await api.admin.aiGateway.deleteModel(m.provider, m.model)
      toast(`${m.label || m.model} removed`, 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not remove the model', 'error')
    } finally {
      setBusy('')
    }
  }

  const locked = readOnly || !v2

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <Field label="Provider" htmlFor={`${uid}-provider`} className="sm:w-48">
          <select id={`${uid}-provider`} value={filter} onChange={e => setFilter(e.target.value)} className="input text-xs py-1.5">
            <option value="">All providers</option>
            {providers.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        <div className="relative sm:w-64">
          <label htmlFor={`${uid}-q`} className="sr-only">Search models</label>
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <input id={`${uid}-q`} type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search models" className="input text-xs py-1.5" style={{ paddingLeft: 28 }} />
        </div>
        <p className="text-[11px] sm:ml-auto max-w-md leading-relaxed" style={{ color: 'var(--text-3)' }}>
          A model's per-request token limit sizes each request before it is sent; prices turn tokens into estimated spend.
          Success rate and median latency cover the last 7 days.
        </p>
      </div>
      {!v2 && !readOnly && (
        <Notice tone="info">The model catalogue needs database migration 0008, which has not run yet. Chains keep working with the model ids they name.</Notice>
      )}

      {!providers.length && (
        <section className="card"><EmptyState icon={Boxes} title="No providers yet">Add a provider first, then fetch its model list.</EmptyState></section>
      )}

      {shown.map(p => {
        const models = catalog.filter(m => m.provider === p.key)
          .filter(m => !q || m.model.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q))
        return (
          <section key={p.key} className="card space-y-3" aria-labelledby={`${uid}-${p.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id={`${uid}-${p.key}`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{p.label}</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {num(catalog.filter(m => m.provider === p.key).length)} in the catalogue
                  {p.models?.length ? ` · ${num(p.models.length)} offered at the last test` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn-secondary text-xs px-2.5 py-1" disabled={locked}
                  onClick={() => setDialog({ kind: 'fetch', provider: p })} aria-label={`Fetch ${p.label} models`}>
                  <Download size={12} aria-hidden="true" /> Fetch models
                </button>
                <button type="button" className="btn-primary text-xs px-2.5 py-1" disabled={locked}
                  onClick={() => setDialog({ kind: 'edit', provider: p, model: null })} aria-label={`Add a ${p.label} model`}>
                  <Plus size={12} aria-hidden="true" /> Add model
                </button>
              </div>
            </div>
            {!models.length ? (
              <EmptyState icon={Boxes} title={q ? `No ${p.label} model matches “${query.trim()}”` : `No ${p.label} models in the catalogue`}>
                {q ? null : 'Chains can still name any model id. Add the ones you use to set their limits and prices, or fetch the provider\'s list.'}
              </EmptyState>
            ) : (
              <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {models.map(m => (
                  <ModelCard key={m.model} m={m} stat={stats[`${m.provider}|${m.model}`]} taskLabels={taskLabels}
                    limits={limitsOf(`${m.provider}|${m.model}`)} locked={locked} busy={busy}
                    onToggle={() => toggle(m)} onEdit={() => setDialog({ kind: 'edit', provider: p, model: m })}
                    onRemove={() => remove(m)} />
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {dialog?.kind === 'edit' && (
        <ModelModal provider={dialog.provider} model={dialog.model} catalog={catalog} onClose={close}
          onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'fetch' && (
        <FetchModelsModal provider={dialog.provider} catalog={catalog} readOnly={locked} onClose={close} onChanged={onChanged} />
      )}
    </div>
  )
}

function Spec({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</dt>
      <dd className="text-xs tabular-nums truncate" style={{ color: 'var(--text-1)' }}>{children}</dd>
    </div>
  )
}

function ModelCard({ m, stat, taskLabels, limits, locked, busy, onToggle, onEdit, onRemove }) {
  const name = m.label || m.model
  const rate = stat?.success_rate
  return (
    <li className="rounded-lg border p-3 space-y-2 min-w-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold break-all" style={{ color: 'var(--text-1)' }}>{name}</span>
            {!m.enabled && <Badge color="default">Off</Badge>}
            {m.vision && <Badge color="indigo">vision</Badge>}
            {m.benched && <Badge color="amber"><Moon size={10} aria-hidden="true" className="inline mr-0.5" />Benched</Badge>}
            {m.offered === false && <Badge color="red">Not offered</Badge>}
          </div>
          {m.label && <p className="font-mono text-[11px] break-all" style={{ color: 'var(--text-3)' }}>{m.model}</p>}
        </div>
        <Toggle checked={m.enabled} onChange={onToggle} label={`${name} on`} disabled={locked}
          busy={busy === `toggle:${m.provider}|${m.model}`} />
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <Spec label="Context">{compact(m.context_window)}</Spec>
        <Spec label="Max output">{compact(m.max_output_tokens)}</Spec>
        <Spec label="Per request">{compact(m.request_token_limit)}</Spec>
        <Spec label="In / 1M">{m.input_cost_per_m != null ? usd(m.input_cost_per_m) : '—'}</Spec>
        <Spec label="Out / 1M">{m.output_cost_per_m != null ? usd(m.output_cost_per_m) : '—'}</Spec>
        <Spec label="Today">{num(m.usage?.day?.calls || 0)} req{m.usage?.day?.spend ? ` · ${usd(m.usage.day.spend)}` : ''}</Spec>
        <Spec label="Success (7d)">
          <span style={{ color: rate == null ? undefined : rate >= 0.95 ? 'var(--fin-positive)' : rate >= 0.8 ? 'var(--fin-warning)' : 'var(--fin-negative)' }}>
            {pct(rate)}
          </span>
        </Spec>
        <Spec label="Median">{secs(stat?.p50_ms)}</Spec>
        <Spec label="Requests (7d)">{num(stat?.requests || 0)}</Spec>
      </dl>
      {limits.length > 0 && <LimitBars limits={limits} />}
      {stat?.why && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--fin-warning)' }}>Last failure: {stat.why}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] min-w-0" style={{ color: 'var(--text-3)' }}>
          {m.used_by?.length ? `Used by ${m.used_by.map(k => taskLabels[k] || k).join(', ')}` : 'In no task chain'}
          {m.in_default_route ? ' · in the default chain' : ''}
        </p>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={onEdit} disabled={locked} aria-label={`Edit ${name}`}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
          <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={onRemove} disabled={locked || Boolean(busy)}
            aria-label={`Remove ${name}`} style={{ color: 'var(--fin-negative)' }}>
            <Trash2 size={12} aria-hidden="true" /> Remove
          </button>
        </div>
      </div>
    </li>
  )
}

const TOKEN_FIELDS = [
  ['context_window', 'Context window', 'Prompt and answer together.'],
  ['max_output_tokens', 'Max output tokens', 'Answers are cut to this.'],
  ['request_token_limit', 'Per-request token limit', 'Prompt + answer one request may carry; requests are sized to fit before sending.'],
]

const asText = (v) => (v == null ? '' : String(v))

function ModelModal({ provider, model, catalog, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const editing = Boolean(model)
  const [id, setId] = useState(model?.model || '')
  const [label, setLabel] = useState(model?.label || '')
  const [enabled, setEnabled] = useState(model ? Boolean(model.enabled) : true)
  const [vision, setVision] = useState(model?.vision == null ? '' : model.vision ? 'yes' : 'no')
  const [tokens, setTokens] = useState(() => Object.fromEntries(TOKEN_FIELDS.map(([k]) => [k, asText(model?.[k])])))
  const [costIn, setCostIn] = useState(asText(model?.input_cost_per_m))
  const [costOut, setCostOut] = useState(asText(model?.output_cost_per_m))
  const [saving, setSaving] = useState(false)

  const offered = (provider.models || []).find(m => m.id === id.trim())
  const fill = () => {
    if (!offered) return
    setTokens(t => ({
      ...t,
      context_window: t.context_window || asText(offered.context),
      max_output_tokens: t.max_output_tokens || asText(offered.max_output),
    }))
    if (!label && offered.label) setLabel(offered.label)
    if (!costIn && offered.input_cost_per_m != null) setCostIn(asText(offered.input_cost_per_m))
    if (!costOut && offered.output_cost_per_m != null) setCostOut(asText(offered.output_cost_per_m))
    if (vision === '' && offered.vision != null) setVision(offered.vision ? 'yes' : 'no')
  }

  const parsedTokens = Object.fromEntries(TOKEN_FIELDS.map(([k]) => {
    const s = tokens[k].trim()
    return [k, !s ? null : /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 100000000 ? Number(s) : NaN]
  }))
  const cin = parseAmount(costIn)
  const cout = parseAmount(costOut)
  const exists = !editing && catalog.some(m => m.provider === provider.key && m.model === id.trim())
  const problem = !MODEL_ID_RE.test(id.trim()) ? 'Enter the model id exactly as the provider names it.'
    : exists ? 'That model is already in the catalogue.'
    : label.trim().length > 80 ? 'The label is at most 80 characters.'
    : Object.values(parsedTokens).some(Number.isNaN) ? 'Token limits are whole numbers from 1 to 100,000,000, or blank.'
    : [cin, cout].some(Number.isNaN) ? 'Prices are amounts in USD per 1M tokens, or blank.'
    : null

  const save = async () => {
    if (problem) return
    const next = {
      label: label.trim() || null, enabled, ...parsedTokens,
      input_cost_per_m: cin, output_cost_per_m: cout,
      vision: vision === '' ? null : vision === 'yes',
    }
    const patch = {}
    for (const [k, v] of Object.entries(next)) {
      const before = model ? (model[k] ?? null) : (k === 'enabled' ? true : null)
      if (v !== before) patch[k] = v
    }
    if (editing && !Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    try {
      await api.admin.aiGateway.saveModel({ provider: provider.key, model: id.trim(), ...patch })
      toast(`${label.trim() || id.trim()} ${editing ? 'saved' : 'added'}`, 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the model', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${model.label || model.model}` : `Add a ${provider.label} model`} width={600}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || Boolean(problem)}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} {editing ? 'Save' : 'Add model'}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Model id" htmlFor={`${uid}-id`} hint={offered ? 'Offered by the provider.' : 'As the provider names it.'}>
            <input id={`${uid}-id`} value={id} onChange={e => setId(e.target.value)} disabled={editing} list={`${uid}-offered`}
              spellCheck={false} autoComplete="off" placeholder="e.g. openai/gpt-oss-120b" className="input text-sm font-mono" />
          </Field>
          <datalist id={`${uid}-offered`}>
            {(provider.models || []).map(m => <option key={m.id} value={m.id} />)}
          </datalist>
          <Field label="Label" htmlFor={`${uid}-label`} hint="Shown instead of the id. Optional.">
            <input id={`${uid}-label`} value={label} onChange={e => setLabel(e.target.value)} maxLength={80} className="input text-sm" />
          </Field>
        </div>
        {offered && (
          <button type="button" className="btn-ghost text-xs px-2.5 py-1" onClick={fill}>
            Fill in what {provider.label} reports
          </button>
        )}
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Model on</p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>When off, chain steps on it are skipped.</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Model on" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TOKEN_FIELDS.map(([k, l, hint]) => (
            <Field key={k} label={l} htmlFor={`${uid}-${k}`} hint={hint}>
              <input id={`${uid}-${k}`} inputMode="numeric" value={tokens[k]} placeholder="Unknown"
                onChange={e => setTokens(t => ({ ...t, [k]: e.target.value }))} className="input text-sm" />
            </Field>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Input price per 1M tokens (USD)" htmlFor={`${uid}-cin`}>
            <input id={`${uid}-cin`} inputMode="decimal" value={costIn} onChange={e => setCostIn(e.target.value)} placeholder="Not set" className="input text-sm" />
          </Field>
          <Field label="Output price per 1M tokens (USD)" htmlFor={`${uid}-cout`}>
            <input id={`${uid}-cout`} inputMode="decimal" value={costOut} onChange={e => setCostOut(e.target.value)} placeholder="Not set" className="input text-sm" />
          </Field>
          <Field label="Reads images" htmlFor={`${uid}-vision`}>
            <select id={`${uid}-vision`} value={vision} onChange={e => setVision(e.target.value)} className="input text-sm">
              <option value="">Guess from the id</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        {problem && id.trim() && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}

// Asks the provider for its model list and adds the chosen ones to the catalogue.
export function FetchModelsModal({ provider, catalog, readOnly, onClose, onChanged }) {
  const toast = useToast()
  const uid = useDomId()
  const [state, setState] = useState({ loading: true, error: null, models: [] })
  const [picked, setPicked] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api.admin.aiGateway.fetchModels(provider.key)
      .then(res => {
        if (!alive) return
        const inCatalog = new Set(catalog.filter(m => m.provider === provider.key).map(m => m.model))
        const models = (res?.models || []).map(m => ({ ...m, in_catalog: m.in_catalog ?? inCatalog.has(m.id) }))
        setState({ loading: false, error: res?.ok === false ? (res.error || 'The provider did not answer') : null, models })
        onChanged()
      })
      .catch(e => { if (alive) setState({ loading: false, error: e.message || 'Could not fetch the model list', models: [] }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.key])

  const q = query.trim().toLowerCase()
  const shown = state.models.filter(m => !q || m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q))
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const add = async () => {
    if (!picked.size || readOnly) return
    setSaving(true)
    try {
      const res = await api.admin.aiGateway.importModels(provider.key, [...picked])
      toast(`${num(res?.added ?? picked.size)} ${provider.label} ${(res?.added ?? picked.size) === 1 ? 'model' : 'models'} added to the catalogue`, 'success')
      onChanged()
      onClose()
    } catch (e) {
      toast(e.message || 'Could not add the models', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`${provider.label} models`} subtitle="From the provider's own model list" width={640}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="btn-primary" onClick={add} disabled={!picked.size || saving || readOnly}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
          Add {picked.size ? num(picked.size) : ''} to catalogue
        </button>
      </>}>
      <div className="space-y-3">
        {state.loading ? (
          <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-3)' }} role="status">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Asking {provider.label} for its models…
          </p>
        ) : state.error ? (
          <Notice tone="error">{state.error}</Notice>
        ) : null}
        {readOnly && !state.loading && <Notice tone="warn">The catalogue needs database migration 0008; the list is shown read-only.</Notice>}
        {state.models.length > 0 && (
          <>
            <div className="relative">
              <label htmlFor={`${uid}-q`} className="sr-only">Search {provider.label} models</label>
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
              <input id={`${uid}-q`} type="search" value={query} onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${num(state.models.length)} models`} className="input text-xs py-1.5" style={{ paddingLeft: 28 }} />
            </div>
            <ul className="max-h-80 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              {shown.map((m, i) => (
                <li key={m.id} style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
                  <label className="flex items-start gap-2 px-3 py-2 cursor-pointer text-xs">
                    <input type="checkbox" className="mt-0.5" disabled={m.in_catalog || readOnly}
                      checked={m.in_catalog || picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono break-all" style={{ color: 'var(--text-1)' }}>{m.id}</span>
                      <span className="flex flex-wrap gap-1 mt-0.5">
                        {m.in_catalog && <Badge color="blue">in catalogue</Badge>}
                        {m.free && <Badge color="green">free</Badge>}
                        {m.vision && <Badge color="indigo"><EyeIcon size={10} aria-hidden="true" className="inline mr-0.5" />vision</Badge>}
                        {m.context != null && <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{compact(m.context)} context</span>}
                        {m.input_cost_per_m != null && (
                          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                            {usd(m.input_cost_per_m)} / {usd(m.output_cost_per_m)} per 1M
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {!shown.length && <li className="px-3 py-3 text-xs" style={{ color: 'var(--text-3)' }}>No model matches “{query.trim()}”.</li>}
            </ul>
          </>
        )}
        {!state.loading && !state.error && !state.models.length && (
          <EmptyState icon={Boxes} title="No chat models listed">{provider.label} answered, but listed no chat models.</EmptyState>
        )}
      </div>
    </Modal>
  )
}
