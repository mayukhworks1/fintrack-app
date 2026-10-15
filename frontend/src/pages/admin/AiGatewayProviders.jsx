// AI gateway › Providers & caps: gateway-wide caps, keys, connection tests and provider settings.
import { useState, useMemo } from 'react'
import { Pencil, PlugZap, Loader2, KeyRound, Trash2, Eye, EyeOff, Search, AlertTriangle } from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Toggle } from './ui'
import { relTime } from './utils'
import { Dot, Field, Notice, describedBy, envKeyApplies, keyBadge, istStamp, num, parseCap, usage, useDomId } from './AiGatewayShared'

export function AiGatewayProviders({ global: g, providers, tasks, readOnly, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState('')
  const close = () => setDialog(null)

  const taskLabels = useMemo(() => Object.fromEntries(tasks.map(t => [t.key, t.label])), [tasks])

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
      <section className="card space-y-2" aria-labelledby="ai-gateway-caps-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="ai-gateway-caps-title" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Gateway caps</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              Limits across every task and provider. They reset at midnight IST.
            </p>
          </div>
          <button type="button" className="btn-secondary text-xs px-3 py-1.5" aria-label="Edit gateway caps"
            onClick={() => setDialog({ kind: 'caps' })}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
        </div>
        <p className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
          Today: {usage(g.calls_today, g.daily_call_cap, 'calls')} · {usage(g.tokens_today, g.daily_token_cap, 'tokens')}
          {g.daily_call_cap == null && g.daily_token_cap == null ? ' · no cap' : ''}
        </p>
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs leading-relaxed max-w-2xl" style={{ color: 'var(--text-3)' }}>
          A connection test asks each provider for its model list using the key in use. It isn't counted against caps
          or written to the call log, and it refreshes the model suggestions in each task's route editor.
        </p>
        <button type="button" className="btn-secondary text-xs px-3 py-1.5 self-start sm:self-auto" onClick={testAll}
          disabled={Boolean(busy)}>
          {busy === 'test-all' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <PlugZap size={12} aria-hidden="true" />}
          {busy === 'test-all' ? 'Testing…' : 'Test all'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {providers.map(p => (
          <ProviderCard key={p.key} p={p} taskLabels={taskLabels} busy={busy} readOnly={readOnly}
            onTest={() => testOne(p)}
            onEdit={() => setDialog({ kind: 'edit', provider: p })}
            onSetKey={() => setDialog({ kind: 'key', provider: p })}
            onRemoveKey={() => removeKey(p)} />
        ))}
      </div>

      {dialog?.kind === 'caps' && (
        <GatewayCapsModal global={g} readOnly={readOnly} onClose={close} onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'key' && (
        <SetKeyModal provider={dialog.provider} readOnly={readOnly} onClose={close} onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'edit' && (
        <ProviderEditModal provider={dialog.provider} readOnly={readOnly} onClose={close} onSaved={() => { close(); onChanged() }} />
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

function ProviderCard({ p, taskLabels, busy, readOnly, onTest, onEdit, onSetKey, onRemoveKey }) {
  const [keyColor, keyLabel] = keyBadge(p)
  const storedKey = p.key_source === 'stored' && !p.key_unreadable
  const used = Object.entries(p.used_by || {})
  const offered = new Set((p.models || []).map(m => m.id))
  const listKnown = Boolean(p.last_test?.ok) && offered.size > 0
  const test = p.last_test
  const testing = busy === `test:${p.key}`
  const removing = busy === `remove:${p.key}`

  const requests = usage(p.requests_today, p.daily_request_cap, 'requests')
  const tokens = usage(p.tokens_today, p.daily_token_cap, 'tokens')
  const noCaps = p.daily_request_cap == null && p.daily_token_cap == null

  return (
    <article className="card space-y-3 min-w-0" aria-labelledby={`ai-gateway-provider-${p.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={`ai-gateway-provider-${p.key}`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{p.label}</h3>
            <Badge color={p.enabled ? 'green' : 'default'}>{p.enabled ? 'On' : 'Off'}</Badge>
            <Badge color={keyColor}>{keyLabel}</Badge>
          </div>
          <p className="text-[11px] font-mono mt-1 break-all" style={{ color: 'var(--text-3)' }}>{p.base_url}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={onTest} disabled={Boolean(busy)}
            aria-label={`Test ${p.label} connection`}>
            {testing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <PlugZap size={12} aria-hidden="true" />}
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn-ghost text-xs px-2.5 py-1" onClick={onEdit} aria-label={`Edit ${p.label}`}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
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
          <span className="tabular-nums">{requests} · {tokens}{noCaps ? ' · no cap' : ''}</span>
        </Row>

        <Row label="Timeout">{p.timeout_s != null ? `${num(p.timeout_s)} s a request` : '—'}</Row>

        <Row label="Models">
          {!used.length ? (
            <span style={{ color: 'var(--text-3)' }}>No task route uses {p.label}.</span>
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

function ProviderEditModal({ provider, readOnly, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const [enabled, setEnabled] = useState(Boolean(provider.enabled))
  const [baseUrl, setBaseUrl] = useState(provider.base_url || '')
  const [timeoutS, setTimeoutS] = useState(provider.timeout_s != null ? String(provider.timeout_s) : '')
  const [requestCap, setRequestCap] = useState(provider.daily_request_cap != null ? String(provider.daily_request_cap) : '')
  const [tokenCap, setTokenCap] = useState(provider.daily_token_cap != null ? String(provider.daily_token_cap) : '')
  const [saving, setSaving] = useState(false)

  const url = cleanBaseUrl(baseUrl)
  const timeoutText = timeoutS.trim()
  const timeoutValue = !timeoutText ? null : /^\d+$/.test(timeoutText) ? Number(timeoutText) : NaN
  const reqValue = parseCap(requestCap)
  const tokValue = parseCap(tokenCap)
  const problem = baseUrlProblem(url)
    || (timeoutValue !== null && !(timeoutValue >= 5 && timeoutValue <= 120)
      ? 'The timeout must be a whole number of seconds from 5 to 120, or blank for the default.' : null)
    || (Number.isNaN(reqValue) ? 'The request cap must be a whole number of 1 or more, or blank for no cap.' : null)
    || (Number.isNaN(tokValue) ? 'The token cap must be a whole number of 1 or more, or blank for no cap.' : null)

  const defaultUrl = provider.default_base_url
  const defaultTimeout = provider.default_timeout_s

  const save = async () => {
    if (problem || readOnly) return
    // Only what changed: a value sent back unchanged would be stored as an
    // explicit setting, and a later change to the built-in default would no
    // longer reach this provider.
    const patch = {}
    if (enabled !== Boolean(provider.enabled)) patch.enabled = enabled
    if (url !== (provider.base_url || '')) patch.base_url = url || null
    if (timeoutValue !== (provider.timeout_s ?? null)) patch.timeout_s = timeoutValue
    if (reqValue !== (provider.daily_request_cap ?? null)) patch.daily_request_cap = reqValue
    if (tokValue !== (provider.daily_token_cap ?? null)) patch.daily_token_cap = tokValue
    if (!Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    try {
      await api.admin.aiGateway.saveProvider(provider.key, patch)
      toast(`${provider.label} saved`, 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the provider', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${provider.label}`} width={540}
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
              When off, route steps on {provider.label} are skipped and the next step is tried.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Provider on" />
        </div>
        <Field label="Base URL" htmlFor={`${uid}-url`}
          hint={`OpenAI-compatible API root (chat at /chat/completions, models at /models). Blank = the default${defaultUrl ? `, ${defaultUrl}` : ''}. A different host needs a key saved for it: the saved key is removed, and ${provider.env_var} is never sent there.`}>
          <input id={`${uid}-url`} type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} maxLength={220}
            spellCheck={false} placeholder={defaultUrl || undefined} className="input font-mono text-sm" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Timeout (seconds)" htmlFor={`${uid}-timeout`}
            hint={`5 to 120, per request. Blank = the default${defaultTimeout ? ` (${defaultTimeout} s)` : ''}.`}>
            <input id={`${uid}-timeout`} type="number" inputMode="numeric" min="5" max="120" step="1" value={timeoutS}
              onChange={e => setTimeoutS(e.target.value)} placeholder={defaultTimeout ? String(defaultTimeout) : undefined}
              className="input text-sm" />
          </Field>
          <Field label="Daily request cap" htmlFor={`${uid}-req`} hint="Blank for no cap.">
            <input id={`${uid}-req`} type="number" inputMode="numeric" min="1" step="1" value={requestCap}
              onChange={e => setRequestCap(e.target.value)} placeholder="No cap" className="input text-sm" />
          </Field>
          <Field label="Daily token cap" htmlFor={`${uid}-tok`} hint="Blank for no cap.">
            <input id={`${uid}-tok`} type="number" inputMode="numeric" min="1" step="1" value={tokenCap}
              onChange={e => setTokenCap(e.target.value)} placeholder="No cap" className="input text-sm" />
          </Field>
        </div>
        {problem && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}

function GatewayCapsModal({ global: g, readOnly, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const [calls, setCalls] = useState(g.daily_call_cap != null ? String(g.daily_call_cap) : '')
  const [tokens, setTokens] = useState(g.daily_token_cap != null ? String(g.daily_token_cap) : '')
  const [saving, setSaving] = useState(false)

  const callValue = parseCap(calls)
  const tokenValue = parseCap(tokens)
  const problem = Number.isNaN(callValue) || Number.isNaN(tokenValue)
    ? 'Caps must be whole numbers of 1 or more, or blank for no cap.'
    : null

  const save = async () => {
    if (problem || readOnly) return
    setSaving(true)
    try {
      await api.admin.aiGateway.saveGlobal({ daily_call_cap: callValue, daily_token_cap: tokenValue })
      toast('Gateway caps saved', 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the caps', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Gateway caps" subtitle="Across every task and provider · resets at midnight IST" width={460}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || Boolean(problem) || readOnly}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
        </button>
      </>}>
      <div className="space-y-4">
        {readOnly && <Notice tone="warn">Read-only until database migration 0003 has run.</Notice>}
        <Field label="Daily call cap" htmlFor={`${uid}-calls`}
          hint={`Provider calls a day. Today so far: ${num(g.calls_today || 0)}. Blank for no cap.`}>
          <input id={`${uid}-calls`} type="number" inputMode="numeric" min="1" step="1" value={calls}
            onChange={e => setCalls(e.target.value)} placeholder="No cap" className="input text-sm" />
        </Field>
        <Field label="Daily token cap" htmlFor={`${uid}-tokens`}
          hint={`Prompt plus answer tokens a day. Today so far: ${num(g.tokens_today || 0)}. Blank for no cap.`}>
          <input id={`${uid}-tokens`} type="number" inputMode="numeric" min="1" step="1" value={tokens}
            onChange={e => setTokens(e.target.value)} placeholder="No cap" className="input text-sm" />
        </Field>
        {problem && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}
