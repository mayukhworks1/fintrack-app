// AI gateway › Providers: add, edit, test and remove any OpenAI-compatible
// provider; keys go in once and only their last four characters come back.
import { useState, useMemo } from 'react'
import {
  Pencil, PlugZap, Loader2, KeyRound, Trash2, Eye, EyeOff, Search, AlertTriangle, Plus, Download, Server, Moon, X,
} from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Toggle } from './ui'
import { relTime } from './utils'
import {
  Dot, EmptyState, Field, LimitBars, Notice, describedBy, envKeyApplies, keyBadge, istStamp, num, usd, useDomId,
} from './AiGatewayShared'
import { FetchModelsModal } from './AiGatewayModels'

export function AiGatewayProviders({ providers, tasks, presets = [], catalog = [], limits = [], usage = {}, v2 = false,
  removedBuiltins = [], readOnly, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState('')
  const close = () => setDialog(null)

  const taskLabels = useMemo(() => Object.fromEntries(tasks.map(t => [t.key, t.label])), [tasks])
  const limitsOf = (key) => limits.find(g => g.scope === 'provider' && g.target === key)?.limits || []

  const removeProvider = async (p) => {
    const uses = Object.values(p.used_by || {}).flat()
    const names = [...new Set(uses)].map(k => taskLabels[k] || k)
    const ok = await confirm({
      title: `Remove ${p.label}?`,
      message: `Its stored key, model catalogue and limits are deleted.${names.length
        ? ` ${names.join(', ')} ${names.length === 1 ? 'names it in its chain; that step' : 'name it in their chains; those steps'} will be skipped and the chain falls back to the next.`
        : ''}${p.builtin ? ` ${p.label} is built in: add it again from “Add provider” to bring it back.` : ''}`,
      confirmLabel: 'Remove provider',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`delete:${p.key}`)
    try {
      await api.admin.aiGateway.deleteProvider(p.key)
      toast(`${p.label} removed`, 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not remove the provider', 'error')
    } finally {
      setBusy('')
    }
  }

  const testOne = async (p) => {
    setBusy(`test:${p.key}`)
    try {
      const res = await api.admin.aiGateway.testProvider(p.key)
      if (res.ok) toast(`${p.label} connected · ${num(res.ms)} ms · ${num(res.model_count)} models offered`, 'success')
      else toast(res.error || `${p.label} test failed`, 'error')
      onChanged()
    } catch (e) {
      toast(e.message || `${p.label} test failed`, 'error')
    } finally {
      setBusy('')
    }
  }

  const testAll = async () => {
    setBusy('test-all')
    try {
      const { results = {} } = await api.admin.aiGateway.testAll() || {}
      const lines = providers
        .filter(p => results[p.key])
        .map(p => (results[p.key].ok ? `${p.label} connected` : `${p.label}: ${results[p.key].error || 'failed'}`))
      const allOk = Object.values(results).every(r => r.ok)
      toast(lines.join(' · ') || 'Connection test finished', allOk ? 'success' : 'warning', 6000)
      onChanged()
    } catch (e) {
      toast(e.message || 'Connection test failed', 'error')
    } finally {
      setBusy('')
    }
  }

  const removeKey = async (p) => {
    const ok = await confirm({
      title: `Remove the ${p.label} key?`,
      message: `The stored key is deleted. ${p.label} then uses ${p.env_var} from the server environment if it is set; otherwise its route steps are skipped.`,
      confirmLabel: 'Remove key',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(`remove:${p.key}`)
    try {
      await api.admin.aiGateway.removeKey(p.key)
      toast(`${p.label} key removed`, 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not remove the key', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs leading-relaxed max-w-2xl" style={{ color: 'var(--text-3)' }}>
          Any API that speaks OpenAI's chat completions works. A connection test asks the provider for its model list using
          the key in use; it isn't counted against limits or written to the call log, and it refreshes the model suggestions.
        </p>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={testAll}
            disabled={Boolean(busy) || !providers.length}>
            {busy === 'test-all' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <PlugZap size={12} aria-hidden="true" />}
            {busy === 'test-all' ? 'Testing…' : 'Test all'}
          </button>
          <button type="button" className="btn-primary text-xs px-3 py-1.5" onClick={() => setDialog({ kind: 'add' })}
            disabled={readOnly || !v2} title={!v2 ? 'Needs database migration 0008' : undefined}>
            <Plus size={12} aria-hidden="true" /> Add provider
          </button>
        </div>
      </div>
      {!v2 && !readOnly && (
        <Notice tone="info">Adding and removing providers needs database migration 0008, which has not run yet. Groq and OpenRouter keep working meanwhile.</Notice>
      )}

      {!providers.length ? (
        <section className="card">
          <EmptyState icon={Server} title="No providers"
            action={v2 && !readOnly && (
              <button type="button" className="btn-primary text-xs px-3 py-1.5" onClick={() => setDialog({ kind: 'add' })}>
                <Plus size={12} aria-hidden="true" /> Add provider
              </button>
            )}>
            Every AI feature is refused until a provider with a key is added. Groq and OpenRouter both have free tiers.
          </EmptyState>
        </section>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {providers.map(p => (
            <ProviderCard key={p.key} p={p} taskLabels={taskLabels} busy={busy} readOnly={readOnly} v2={v2}
              limits={limitsOf(p.key)} today={usage.day?.by_provider?.[p.key]}
              onTest={() => testOne(p)}
              onFetch={() => setDialog({ kind: 'fetch', provider: p })}
              onEdit={() => setDialog({ kind: 'edit', provider: p })}
              onSetKey={() => setDialog({ kind: 'key', provider: p })}
              onRemoveKey={() => removeKey(p)}
              onRemove={() => removeProvider(p)} />
          ))}
        </div>
      )}

      {dialog?.kind === 'add' && (
        <AddProviderModal presets={presets} providers={providers} removedBuiltins={removedBuiltins} onClose={close}
          onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'fetch' && (
        <FetchModelsModal provider={dialog.provider} catalog={catalog} readOnly={readOnly || !v2} onClose={close} onChanged={onChanged} />
      )}
      {dialog?.kind === 'key' && (
        <SetKeyModal provider={dialog.provider} readOnly={readOnly} onClose={close} onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'edit' && (
        <ProviderEditModal provider={dialog.provider} readOnly={readOnly} v2={v2} onClose={close} onSaved={() => { close(); onChanged() }} />
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <>
      <dt className="text-[10px] font-semibold uppercase tracking-wider sm:pt-0.5" style={{ color: 'var(--text-3)' }}>{label}</dt>
      <dd className="min-w-0 mb-1.5 sm:mb-0" style={{ color: 'var(--text-2)' }}>{children}</dd>
    </>
  )
}

function ProviderCard({ p, taskLabels, busy, readOnly, v2, limits, today, onTest, onFetch, onEdit, onSetKey, onRemoveKey, onRemove }) {
  const [keyColor, keyLabel] = keyBadge(p)
  const storedKey = p.key_source === 'stored' && !p.key_unreadable
  const used = Object.entries(p.used_by || {})
  const offered = new Set((p.models || []).map(m => m.id))
  const listKnown = Boolean(p.last_test?.ok) && offered.size > 0
  const test = p.last_test
  const testing = busy === `test:${p.key}`
  const removing = busy === `remove:${p.key}`
  const deleting = busy === `delete:${p.key}`
  const fallbackOnly = (p.in_default_route || []).filter(m => !used.some(([model]) => model === m))

  return (
    <article className="card space-y-3 min-w-0" aria-labelledby={`ai-gateway-provider-${p.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={`ai-gateway-provider-${p.key}`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{p.label}</h3>
            <Badge color={p.enabled ? 'green' : 'default'}>{p.enabled ? 'On' : 'Off'}</Badge>
            <Badge color={keyColor}>{keyLabel}</Badge>
            {p.benched && <Badge color="amber"><Moon size={10} aria-hidden="true" className="inline mr-0.5" />Benched</Badge>}
            {!p.builtin && <Badge color="default">{p.preset ? 'Preset' : 'Custom'}</Badge>}
          </div>
          <p className="text-[11px] font-mono mt-1 break-all" style={{ color: 'var(--text-3)' }}>{p.base_url}</p>
          {p.benched && <p className="text-[11px] mt-1" style={{ color: 'var(--fin-warning)' }}>{p.benched[0].toUpperCase() + p.benched.slice(1)}: tried last until then.</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={onTest} disabled={Boolean(busy)}
            aria-label={`Test ${p.label} connection`}>
            {testing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <PlugZap size={12} aria-hidden="true" />}
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={onFetch} disabled={Boolean(busy)}
            aria-label={`Fetch ${p.label} models`}>
            <Download size={12} aria-hidden="true" /> Fetch models
          </button>
          <button type="button" className="btn-ghost text-xs px-2.5 py-1" onClick={onEdit} aria-label={`Edit ${p.label}`}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
          {v2 && (
            <button type="button" className="btn-ghost text-xs px-2.5 py-1" onClick={onRemove} disabled={readOnly || Boolean(busy)}
              aria-label={`Remove ${p.label}`} style={{ color: 'var(--fin-negative)' }}>
              {deleting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />} Remove
            </button>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-1 sm:grid-cols-[92px_minmax(0,1fr)] gap-x-4 gap-y-1 sm:gap-y-3 text-xs">
        <Row label="Key">
          <div className="space-y-1.5">
            {p.key_unreadable ? (
              <p>
                <span style={{ color: 'var(--fin-negative)' }}>Stored key can't be read — set it again.</span>
                {p.key_source === 'env' && ` Using ${p.env_var} from the server environment meanwhile.`}
              </p>
            ) : storedKey ? (
              <p>
                <span className="font-mono" style={{ color: 'var(--text-1)' }}>•••• {p.key_hint}</span>
                {' · set by '}{p.key_set_by || 'unknown'}{p.key_set_at ? `, ${istStamp(p.key_set_at)}` : ''}
              </p>
            ) : p.key_source === 'env' ? (
              <p>Using <code className="font-mono">{p.env_var}</code> from the server environment</p>
            ) : !p.env_var ? (
              <p>No key — paste one here. It is stored encrypted and only ever sent to {p.base_url.split('/')[2]}.</p>
            ) : envKeyApplies(p) ? (
              <p>No key — paste one here or set <code className="font-mono">{p.env_var}</code> on the server</p>
            ) : (
              <p>No key for this base URL — paste one here. <code className="font-mono">{p.env_var}</code> is only sent to the default host.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={onSetKey} disabled={readOnly}
                aria-label={`${storedKey ? 'Replace' : 'Set'} ${p.label} key`}>
                <KeyRound size={12} aria-hidden="true" /> {storedKey ? 'Replace key' : 'Set key'}
              </button>
              {(storedKey || p.key_unreadable) && (
                <button type="button" className="btn-ghost text-xs px-2.5 py-1" onClick={onRemoveKey}
                  disabled={readOnly || Boolean(busy)} aria-label={`Remove ${p.label} key`}>
                  {removing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />} Remove key
                </button>
              )}
            </div>
          </div>
        </Row>

        <Row label="Connection">
          {!test ? (
            <span className="inline-flex items-center gap-1.5"><Dot /> Not tested</span>
          ) : test.ok ? (
            <span className="inline-flex items-start gap-1.5" title={istStamp(test.at)}>
              <span className="mt-1"><Dot tone="ok" /></span>
              <span>Connected · {num(test.ms)} ms · checked {relTime(test.at)} · {num(test.model_count)} models offered</span>
            </span>
          ) : (
            <span className="inline-flex items-start gap-1.5" title={istStamp(test.at)}>
              <span className="mt-1"><Dot tone="bad" /></span>
              <span><span style={{ color: 'var(--fin-negative)' }}>{test.error || 'Test failed'}</span> · checked {relTime(test.at)}</span>
            </span>
          )}
        </Row>

        <Row label="Today">
          <span className="tabular-nums">
            {num(today?.calls ?? p.requests_today ?? 0)} requests · {num(today?.tokens ?? p.tokens_today ?? 0)} tokens
            {today?.spend ? ` · ${usd(today.spend)}` : ''}
          </span>
        </Row>

        <Row label="Limits">
          <LimitBars limits={limits} />
        </Row>

        <Row label="Timeout">{p.timeout_s != null ? `${num(p.timeout_s)} s a request` : '—'}</Row>

        {Object.keys(p.extra_headers || {}).length > 0 && (
          <Row label="Headers">
            <span className="font-mono text-[11px] break-all">{Object.keys(p.extra_headers).join(', ')}</span>
          </Row>
        )}

        <Row label="Models">
          {!used.length ? (
            <span style={{ color: 'var(--text-3)' }}>
              No task chain names {p.label}{fallbackOnly.length ? `; the default chain uses ${fallbackOnly.join(', ')}` : ''}.
              {p.catalog_count ? ` ${num(p.catalog_count)} in the catalogue.` : ''}
            </span>
          ) : (
            <ul className="space-y-1.5">
              {used.map(([model, keys]) => {
                const missing = listKnown && !offered.has(model)
                const tone = p.enabled ? 'var(--fin-negative)' : 'var(--fin-warning)'
                return (
                  <li key={model} className="rounded-lg border px-2.5 py-1.5"
                    style={missing
                      ? { borderColor: p.enabled ? 'var(--fin-neg-border)' : 'var(--fin-warn-border)', background: p.enabled ? 'var(--fin-neg-bg)' : 'var(--fin-warn-bg)' }
                      : { borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] break-all" style={{ color: 'var(--text-1)' }}>{model}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        used by {keys.map(k => taskLabels[k] || k).join(', ')}
                      </span>
                    </div>
                    {missing && (
                      <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: tone }}>
                        <AlertTriangle size={11} aria-hidden="true" /> Not offered by {p.label} — calls to it will fail
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Row>
      </dl>

      <OfferedModels p={p} />
    </article>
  )
}

function OfferedModels({ p }) {
  const uid = useDomId()
  const [query, setQuery] = useState('')
  const models = p.models || []
  if (!models.length) {
    return (
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
        Run a connection test to load the models {p.label} offers.
      </p>
    )
  }
  const q = query.trim().toLowerCase()
  const shown = q ? models.filter(m => m.id.toLowerCase().includes(q)) : models
  return (
    <details className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        All offered models ({num(models.length)})
      </summary>
      <div className="px-3 pb-3 space-y-2">
        <label htmlFor={`${uid}-q`} className="sr-only">Search {p.label} models</label>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <input id={`${uid}-q`} type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search models" className="input text-xs py-1.5" style={{ paddingLeft: 28 }} />
        </div>
        <ul className="max-h-64 overflow-y-auto pr-1">
          {shown.map((m, i) => (
            <li key={m.id} className="flex flex-wrap items-center gap-1.5 py-1.5"
              style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
              <span className="font-mono text-[11px] break-all" style={{ color: 'var(--text-1)' }}>{m.id}</span>
              {m.free && <Badge color="green">free</Badge>}
              {m.vision && <Badge color="indigo">vision</Badge>}
              {m.context != null && (
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{num(m.context)} context</span>
              )}
            </li>
          ))}
          {!shown.length && (
            <li className="py-2 text-xs" style={{ color: 'var(--text-3)' }}>No model matches “{query.trim()}”.</li>
          )}
        </ul>
      </div>
    </details>
  )
}

// ── Modals ───────────────────────────────────────────────────────────────────

// The key box is a text input masked with CSS where the browser can: a
// password field makes the browser offer to save the provider key as this
// site's login password, and later to fill it in on the sign-in form.
const CAN_MASK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('-webkit-text-security', 'disc')

function SetKeyModal({ provider, readOnly, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const formId = `${uid}-form`
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const replacing = provider.key_source === 'stored' && !provider.key_unreadable
  const keyId = `${uid}-key`
  const keyHint = 'Sent once and stored encrypted on the server. It is never shown again — only its last four characters.'
    + (provider.key_source === 'env' ? ` It takes the place of ${provider.env_var} for ${provider.label}.` : '')

  const candidate = value.trim()
  const problem = !candidate ? null
    : /\s/.test(candidate) ? 'A key has no spaces or line breaks.'
    : /[^\x21-\x7e]/.test(candidate) ? 'A key has only letters, digits and punctuation.'
    : candidate.length < 8 ? 'That is too short to be an API key.'
    : candidate.length > 400 ? 'That is longer than 400 characters.'
    : null

  const dismiss = () => { setValue(''); onClose() }

  const submit = async (e) => {
    e.preventDefault()
    if (!candidate || problem || saving || readOnly) return
    setSaving(true); setError(null)
    try {
      await api.admin.aiGateway.setKey(provider.key, candidate)
      setValue('')
      setShow(false)
      toast(`${provider.label} key saved`, 'success')
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save the key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={dismiss} title={`${replacing ? 'Replace' : 'Set'} ${provider.label} key`} width={480}
      footer={<>
        <button type="button" className="btn-ghost" onClick={dismiss}>Cancel</button>
        <button type="submit" form={formId} className="btn-primary" disabled={!candidate || Boolean(problem) || saving || readOnly}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save key
        </button>
      </>}>
      <form id={formId} onSubmit={submit} className="space-y-3" autoComplete="off">
        <Field label="API key" htmlFor={keyId} hint={keyHint} error={problem}>
          <div className="relative">
            <input id={keyId} name="provider-api-key" type={show || CAN_MASK ? 'text' : 'password'} value={value}
              onChange={e => setValue(e.target.value)} autoComplete="off" spellCheck={false}
              autoCapitalize="off" autoCorrect="off" placeholder="Paste the key" className="input font-mono text-sm"
              data-1p-ignore="true" data-lpignore="true" data-form-type="other"
              aria-describedby={describedBy(keyId, { hint: keyHint, error: problem })} aria-invalid={problem ? true : undefined}
              style={{ paddingRight: 40, ...(CAN_MASK && !show ? { WebkitTextSecurity: 'disc' } : null) }} />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide key' : 'Show key'} aria-pressed={show}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md" style={{ color: 'var(--text-3)' }}>
              {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        {readOnly && <Notice tone="warn">Read-only until database migration 0003 has run.</Notice>}
      </form>
    </Modal>
  )
}

function cleanBaseUrl(text) {
  return String(text || '').trim().replace(/\/+$/, '')
}

// Names that only resolve inside a network; the server refuses them too.
const PRIVATE_TLDS = new Set(['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'arpa'])

// Blank is fine: it means the provider's built-in URL.
function baseUrlProblem(url) {
  if (!url) return null
  if (url.length > 200) return 'The base URL is longer than 200 characters.'
  if (!/^https:\/\/[A-Za-z0-9.-]+(:443)?(\/[A-Za-z0-9._~-]+)*$/.test(url)) {
    return 'The base URL must be https:// with a host name and a path only — no user name, port, query or fragment.'
  }
  const host = url.slice('https://'.length).split(/[:/]/)[0].toLowerCase()
  const tld = host.split('.').pop()
  if (!host.includes('.') || !/^[a-z]/.test(tld) || PRIVATE_TLDS.has(tld)) {
    return 'The base URL must name a public host, not an IP address or an internal name.'
  }
  return null
}

// Header names that usually carry a secret are refused (the server refuses
// them too): extra headers are shown back here, the key never is.
const SECRET_HEADER = /auth|key|token|secret|cookie|password|session|signature/i
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'te',
  'upgrade', 'keep-alive', 'expect', 'proxy-connection', 'http-referer', 'x-title', 'anthropic-version'])
const MAX_HEADERS = 10

let headerSeq = 0
const headerRows = (obj) => Object.entries(obj || {}).map(([name, value]) => ({ id: ++headerSeq, name, value }))

function headersProblem(rows) {
  const seen = new Set()
  for (const { name, value } of rows) {
    const n = name.trim()
    if (!n && !value.trim()) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(n)) return 'A header name is letters, digits and hyphens.'
    if (SECRET_HEADER.test(n)) return `${n} looks like it carries a secret — put the API key in the key field, which is stored encrypted.`
    if (RESERVED_HEADERS.has(n.toLowerCase())) return `${n} is set by the gateway itself.`
    if (!/^[\x20-\x7e]{0,500}$/.test(value)) return `The value of ${n} must be printable text of at most 500 characters.`
    if (seen.has(n.toLowerCase())) return `${n} is listed twice.`
    seen.add(n.toLowerCase())
  }
  return null
}

const headersObject = (rows) => Object.fromEntries(rows.filter(r => r.name.trim()).map(r => [r.name.trim(), r.value]))

function HeadersEditor({ rows, setRows, uid }) {
  const update = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <fieldset className="space-y-2">
      <legend className="label mb-1">Extra headers</legend>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
        Sent with every request, e.g. an organisation or project id. They are shown here, so never put a key in one.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} className="flex flex-wrap gap-2">
          <input aria-label={`Header ${i + 1} name`} value={r.name} onChange={e => update(r.id, { name: e.target.value })}
            placeholder="X-Org-Id" spellCheck={false} autoComplete="off" className="input text-xs py-1.5 font-mono"
            style={{ flex: '1 1 140px', minWidth: 0 }} />
          <input aria-label={`Header ${i + 1} value`} value={r.value} onChange={e => update(r.id, { value: e.target.value })}
            placeholder="value" spellCheck={false} autoComplete="off" className="input text-xs py-1.5 font-mono"
            style={{ flex: '2 1 180px', minWidth: 0 }} />
          <button type="button" className="btn-icon" aria-label={`Remove header ${i + 1}`}
            onClick={() => setRows(rs => rs.filter(x => x.id !== r.id))}><X size={13} aria-hidden="true" /></button>
        </div>
      ))}
      <button type="button" className="btn-ghost text-xs px-2.5 py-1" id={`${uid}-add-header`}
        disabled={rows.length >= MAX_HEADERS}
        onClick={() => setRows(rs => [...rs, { id: ++headerSeq, name: '', value: '' }])}>
        <Plus size={12} aria-hidden="true" /> Add header
      </button>
    </fieldset>
  )
}

function ProviderEditModal({ provider, readOnly, v2, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const [enabled, setEnabled] = useState(Boolean(provider.enabled))
  const [label, setLabel] = useState(provider.label || '')
  const [baseUrl, setBaseUrl] = useState(provider.base_url || '')
  const [timeoutS, setTimeoutS] = useState(provider.timeout_s != null ? String(provider.timeout_s) : '')
  const [headers, setHeaders] = useState(() => headerRows(provider.extra_headers))
  const [saving, setSaving] = useState(false)

  const url = cleanBaseUrl(baseUrl)
  const timeoutText = timeoutS.trim()
  const timeoutValue = !timeoutText ? null : /^\d+$/.test(timeoutText) ? Number(timeoutText) : NaN
  const name = label.trim()
  const problem = (v2 && (!name || name.length > 60) ? 'The name is 1 to 60 characters.' : null)
    || baseUrlProblem(url)
    || (timeoutValue !== null && !(timeoutValue >= 5 && timeoutValue <= 120)
      ? 'The timeout must be a whole number of seconds from 5 to 120, or blank for the default.' : null)
    || headersProblem(headers)

  const defaultUrl = provider.default_base_url
  const defaultTimeout = provider.default_timeout_s
  const keyNote = provider.env_var
    ? `A different host needs a key saved for it: the saved key is removed, and ${provider.env_var} is never sent there.`
    : 'A different host needs a key saved for it: the saved key is removed.'

  const save = async () => {
    if (problem || readOnly) return
    // Only what changed: a value sent back unchanged would be stored as an
    // explicit setting, and a later change to the built-in default would no
    // longer reach this provider.
    const patch = {}
    if (enabled !== Boolean(provider.enabled)) patch.enabled = enabled
    if (v2 && name !== provider.label) patch.label = name
    if (url !== (provider.base_url || '')) patch.base_url = url || null
    if (timeoutValue !== (provider.timeout_s ?? null)) patch.timeout_s = timeoutValue
    const hdrs = headersObject(headers)
    if (v2 && JSON.stringify(hdrs) !== JSON.stringify(provider.extra_headers || {})) patch.extra_headers = hdrs
    if (!Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    try {
      await api.admin.aiGateway.saveProvider(provider.key, patch)
      toast(`${name || provider.label} saved`, 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the provider', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${provider.label}`} width={560}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || Boolean(problem) || readOnly}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
        </button>
      </>}>
      <div className="space-y-4">
        {readOnly && <Notice tone="warn">Read-only until database migration 0003 has run.</Notice>}
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Provider on</p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              When off, chain steps on {provider.label} are skipped and the next step is tried.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Provider on" />
        </div>
        {v2 && (
          <Field label="Name" htmlFor={`${uid}-name`}>
            <input id={`${uid}-name`} value={label} onChange={e => setLabel(e.target.value)} maxLength={60}
              className="input text-sm" />
          </Field>
        )}
        <Field label="Base URL" htmlFor={`${uid}-url`}
          hint={`OpenAI-compatible API root (chat at /chat/completions, models at /models). Blank = the default${defaultUrl ? `, ${defaultUrl}` : ''}. ${keyNote}`}>
          <input id={`${uid}-url`} type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} maxLength={220}
            spellCheck={false} placeholder={defaultUrl || undefined} className="input font-mono text-sm" />
        </Field>
        <Field label="Timeout (seconds)" htmlFor={`${uid}-timeout`}
          hint={`5 to 120, per request; a chain step can set its own. Blank = the default${defaultTimeout ? ` (${defaultTimeout} s)` : ''}.`}>
          <input id={`${uid}-timeout`} type="number" inputMode="numeric" min="5" max="120" step="1" value={timeoutS}
            onChange={e => setTimeoutS(e.target.value)} placeholder={defaultTimeout ? String(defaultTimeout) : undefined}
            className="input text-sm" style={{ maxWidth: 200 }} />
        </Field>
        {v2 && <HeadersEditor rows={headers} setRows={setHeaders} uid={uid} />}
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Daily, weekly and monthly limits are set under Limits.</p>
        {problem && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}

// ── Add a provider ──

function keyProblem(candidate) {
  if (!candidate) return null
  if (/\s/.test(candidate)) return 'A key has no spaces or line breaks.'
  if (/[^\x21-\x7e]/.test(candidate)) return 'A key has only letters, digits and punctuation.'
  if (candidate.length < 8) return 'That is too short to be an API key.'
  if (candidate.length > 400) return 'That is longer than 400 characters.'
  return null
}

function AddProviderModal({ presets, providers, removedBuiltins, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const formId = `${uid}-form`
  const [choice, setChoice] = useState(() => {
    const live = new Set(providers.map(p => p.key))
    return presets.find(p => !live.has(p.key))?.key || 'custom'
  })
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [show, setShow] = useState(false)
  const [headers, setHeaders] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const live = new Set(providers.map(p => p.key))
  const preset = presets.find(p => p.key === choice) || null
  const custom = choice === 'custom'
  const url = cleanBaseUrl(baseUrl)
  const candidate = apiKey.trim()
  const kProblem = keyProblem(candidate)
  const name = label.trim()
  const problem = (custom && !name ? 'Give the provider a name.' : null)
    || (name.length > 60 ? 'The name is at most 60 characters.' : null)
    || (custom && !url ? 'Enter the API base URL, e.g. https://api.example.com/v1.' : null)
    || baseUrlProblem(url)
    || headersProblem(headers)
    || kProblem

  const dismiss = () => { setApiKey(''); onClose() }

  const submit = async (e) => {
    e.preventDefault()
    if (problem || saving) return
    const body = {}
    if (!custom) body.preset = choice
    if (name) body.label = name
    if (url) body.base_url = url
    const hdrs = headersObject(headers)
    if (Object.keys(hdrs).length) body.extra_headers = hdrs
    if (candidate) body.api_key = candidate
    setSaving(true); setError(null)
    try {
      const res = await api.admin.aiGateway.addProvider(body)
      setApiKey('')
      toast(`${res?.label || name || preset?.label || 'Provider'} added`, 'success')
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not add the provider')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={dismiss} title="Add provider" subtitle="Any API that speaks OpenAI's chat completions" width={640}
      footer={<>
        <button type="button" className="btn-ghost" onClick={dismiss}>Cancel</button>
        <button type="submit" form={formId} className="btn-primary" disabled={Boolean(problem) || saving}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Add provider
        </button>
      </>}>
      <form id={formId} onSubmit={submit} className="space-y-4" autoComplete="off">
        <fieldset>
          <legend className="label mb-2">Provider</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...presets, { key: 'custom', label: 'Custom', note: 'Any OpenAI-compatible base URL, with extra headers.' }].map(p => {
              const added = p.key !== 'custom' && live.has(p.key)
              const back = removedBuiltins.includes(p.key)
              const checked = choice === p.key
              return (
                <label key={p.key} className="flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer"
                  style={{ borderColor: checked ? 'var(--accent)' : 'var(--border)', background: checked ? 'var(--accent-dim)' : 'var(--bg-input)' }}>
                  <input type="radio" name={`${uid}-preset`} value={p.key} checked={checked}
                    aria-label={`${p.label}${added ? ' (added)' : back ? ' (removed)' : ''}`} aria-describedby={`${uid}-note-${p.key}`}
                    onChange={() => { setChoice(p.key); setBaseUrl(''); setError(null) }} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                      {p.label}{added ? ' · added' : back ? ' · removed' : ''}
                    </span>
                    <span id={`${uid}-note-${p.key}`} className="block text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>{p.note}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
        {preset && live.has(preset.key) && (
          <Notice tone="info">{preset.label} is already added; this adds a second account under its own id (e.g. {preset.key}-2).</Notice>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" htmlFor={`${uid}-name`} hint={custom ? undefined : `Blank = ${preset?.label}.`}>
            <input id={`${uid}-name`} value={label} onChange={e => setLabel(e.target.value)} maxLength={60}
              placeholder={custom ? 'e.g. Company proxy' : preset?.label} className="input text-sm" />
          </Field>
          <Field label="Base URL" htmlFor={`${uid}-url`}
            hint={custom ? 'https only, on a public host name.' : `Blank = ${preset?.base_url}.`}>
            <input id={`${uid}-url`} type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} maxLength={220}
              spellCheck={false} placeholder={custom ? 'https://api.example.com/v1' : preset?.base_url} className="input font-mono text-sm" />
          </Field>
        </div>
        <Field label="API key" htmlFor={`${uid}-key`} error={kProblem}
          hint="Optional now; you can set it later. Stored encrypted and never shown again — only its last four characters.">
          <div className="relative">
            <input id={`${uid}-key`} name="provider-api-key" type={show || CAN_MASK ? 'text' : 'password'} value={apiKey}
              onChange={e => setApiKey(e.target.value)} autoComplete="off" spellCheck={false}
              autoCapitalize="off" autoCorrect="off" placeholder="Paste the key" className="input font-mono text-sm"
              data-1p-ignore="true" data-lpignore="true" data-form-type="other"
              aria-describedby={describedBy(`${uid}-key`, { hint: true, error: kProblem })} aria-invalid={kProblem ? true : undefined}
              style={{ paddingRight: 40, ...(CAN_MASK && !show ? { WebkitTextSecurity: 'disc' } : null) }} />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide key' : 'Show key'} aria-pressed={show}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md" style={{ color: 'var(--text-3)' }}>
              {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            </button>
          </div>
        </Field>
        <HeadersEditor rows={headers} setRows={setHeaders} uid={uid} />
        {problem && problem !== kProblem && <Notice tone="error">{problem}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  )
}
