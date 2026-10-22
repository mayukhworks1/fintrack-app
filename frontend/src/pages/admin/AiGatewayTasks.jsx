// AI gateway › Tasks & prompts: each task's route, cap and prompt, plus a test run.
import { useState, useEffect, useMemo } from 'react'
import {
  Settings2, FileText, Play, ArrowUp, ArrowDown, Trash2, Plus, RotateCcw, Loader2, CheckCircle2, AlertTriangle, Eye, Undo2,
} from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Err, Skeleton, Toggle } from './ui'
import {
  Field, Notice, RouteChain, WarningList, OUTPUT_BADGE, MAX_ROUTE_STEPS, MAX_PROMPT_CHARS, MAX_TEST_INPUT, MODEL_ID_RE,
  istStamp, localRouteWarnings, num, parseCap, useDomId,
} from './AiGatewayShared'

const CHAT_MARKERS = ['===ANSWER===', '===END===']

let stepSeq = 0
const withIds = (route) => (route || []).map(s => ({ provider: s.provider, model: s.model || '', id: ++stepSeq }))
const sameRoute = (a, b) => a.length === (b || []).length
  && a.every((s, i) => s.provider === b[i].provider && s.model.trim() === b[i].model)

export function AiGatewayTasks({ tasks, providers, labels, readOnly, onChanged }) {
  const [dialog, setDialog] = useState(null)
  const close = () => setDialog(null)

  const groups = useMemo(() => {
    const byModule = new Map()
    for (const t of tasks) {
      const key = t.module || 'Other'
      if (!byModule.has(key)) byModule.set(key, [])
      byModule.get(key).push(t)
    }
    return [...byModule.entries()]
  }, [tasks])

  return (
    <>
      <section className="card p-0 overflow-hidden" aria-labelledby="ai-gateway-tasks-title">
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 id="ai-gateway-tasks-title" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Tasks</h3>
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Each task tries its route in order and moves to the next step when a model fails or its provider is unavailable.
          </p>
        </div>
        {groups.map(([module, list]) => (
          <div key={module} className="px-4 pb-1">
            <p className="pt-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{module}</p>
            <ul>
              {list.map((task, i) => (
                <TaskRow key={task.key} task={task} labels={labels} first={i === 0}
                  onOpen={(kind) => setDialog({ kind, task })} />
              ))}
            </ul>
          </div>
        ))}
        {!tasks.length && (
          <p className="px-4 py-8 text-sm text-center" style={{ color: 'var(--text-3)' }}>No tasks returned by the server.</p>
        )}
      </section>

      {dialog?.kind === 'settings' && (
        <TaskSettingsModal task={dialog.task} providers={providers} readOnly={readOnly} onClose={close}
          onSaved={() => { close(); onChanged() }} />
      )}
      {dialog?.kind === 'prompt' && (
        <TaskPromptModal task={dialog.task} readOnly={readOnly} onClose={close} onChanged={onChanged} />
      )}
      {dialog?.kind === 'test' && (
        <TaskTestModal task={dialog.task} labels={labels} onClose={close} onRan={onChanged} />
      )}
    </>
  )
}

function TaskRow({ task, labels, first, onOpen }) {
  const [outColor, outLabel] = OUTPUT_BADGE[task.output] || ['default', task.output || '—']
  const today = task.daily_cap != null
    ? `Today ${num(task.calls_today || 0)} of ${num(task.daily_cap)} calls`
    : `Today ${num(task.calls_today || 0)} calls · no cap`
  const prompt = !task.prompt?.editable
    ? 'Built-in prompt · fixed'
    : task.prompt.overridden ? `Prompt v${task.prompt.version}` : 'Built-in prompt'
  const capReached = task.daily_cap != null && (task.calls_today || 0) >= task.daily_cap

  return (
    <li className="py-3 flex flex-col lg:flex-row lg:items-start gap-3"
      style={first ? undefined : { borderTop: '1px solid var(--border)' }}>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{task.label}</h4>
          <Badge color={task.enabled ? 'green' : 'default'}>{task.enabled ? 'On' : 'Off'}</Badge>
          {task.personal_data && <Badge color="orange">Personal data</Badge>}
          <Badge color={outColor}>{outLabel}</Badge>
        </div>
        {task.description && (
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>{task.description}</p>
        )}
        <RouteChain route={task.route} warnings={task.route_warnings} labels={labels} />
        <WarningList warnings={task.route_warnings} />
      </div>
      <div className="flex flex-col gap-2 lg:items-end lg:text-right flex-shrink-0 lg:w-64">
        <div className="text-xs space-y-0.5">
          <p className="tabular-nums" style={{ color: capReached ? 'var(--fin-negative)' : 'var(--text-2)' }}>{today}</p>
          <p style={{ color: 'var(--text-3)' }}>{prompt}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" aria-label={`Settings for ${task.label}`}
            onClick={() => onOpen('settings')}>
            <Settings2 size={12} aria-hidden="true" /> Settings
          </button>
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" aria-label={`Prompt for ${task.label}`}
            onClick={() => onOpen('prompt')}>
            <FileText size={12} aria-hidden="true" /> Prompt
          </button>
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" aria-label={`Test ${task.label}`}
            onClick={() => onOpen('test')}>
            <Play size={12} aria-hidden="true" /> Test
          </button>
        </div>
      </div>
    </li>
  )
}

// ── Settings: on/off, route, daily cap ───────────────────────────────────────

function modelHint(m) {
  return [m.free && 'free', m.vision && 'vision', m.context && `${num(m.context)} context`].filter(Boolean).join(' · ')
}

function TaskSettingsModal({ task, providers, readOnly, onClose, onSaved }) {
  const toast = useToast()
  const uid = useDomId()
  const [enabled, setEnabled] = useState(Boolean(task.enabled))
  const [route, setRoute] = useState(() => withIds(task.route))
  const [cap, setCap] = useState(task.daily_cap != null ? String(task.daily_cap) : '')
  const [saving, setSaving] = useState(false)

  const capValue = parseCap(cap)
  const badStep = route.findIndex(s => !MODEL_ID_RE.test(s.model.trim()))
  const warnings = useMemo(() => localRouteWarnings(route, providers), [route, providers])
  const problem = !route.length ? 'Add at least one step.'
    : badStep >= 0 ? `Step ${badStep + 1}: enter a model id (letters, digits and . _ : / @ + - only, up to 120 characters).`
    : Number.isNaN(capValue) ? 'The daily cap must be a whole number of 1 or more, or blank for no cap.'
    : null
  const isDefault = sameRoute(route, task.default_route)

  const update = (i, patch) => setRoute(r => r.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i, delta) => setRoute(r => {
    const next = [...r]
    ;[next[i], next[i + delta]] = [next[i + delta], next[i]]
    return next
  })
  const remove = (i) => setRoute(r => r.filter((_, j) => j !== i))
  const add = () => setRoute(r => (r.length >= MAX_ROUTE_STEPS ? r : [
    ...r, { id: ++stepSeq, provider: r[r.length - 1]?.provider || providers[0]?.key || '', model: '' },
  ]))

  const save = async () => {
    if (problem || readOnly) return
    // Only what changed. The default route goes as null, so the task follows
    // the built-in route — a saved copy of it would pin today's model ids and
    // miss a release that changes them.
    const patch = {}
    if (enabled !== Boolean(task.enabled)) patch.enabled = enabled
    if (capValue !== (task.daily_cap ?? null)) patch.daily_cap = capValue
    if (isDefault) {
      if (task.route_custom) patch.route = null
    } else if (!sameRoute(route, task.route)) {
      patch.route = route.map(s => ({ provider: s.provider, model: s.model.trim() }))
    }
    if (!Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    try {
      await api.admin.aiGateway.saveTask(task.key, patch)
      toast(`${task.label} saved`, 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the task', 'error')
    } finally {
      setSaving(false)
    }
  }

  const listId = (key) => `${uid}-models-${key}`

  return (
    <Modal open onClose={onClose} title={`${task.label} settings`} subtitle={task.description} width={760}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || Boolean(problem) || readOnly}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
        </button>
      </>}>
      <div className="space-y-5">
        {readOnly && <Notice tone="warn">Read-only until database migration 0003 has run.</Notice>}

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Task on</p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              When off, features that use this task show “switched off by the administrator” instead of calling a model.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Task on" />
        </div>

        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Route</p>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Tried top to bottom. Up to {MAX_ROUTE_STEPS} steps. Model suggestions come from each provider's last connection test.
            </p>
          </div>
          <ol className="space-y-2">
            {route.map((step, i) => {
              const stepWarnings = warnings.filter(w => w.index === i)
              const level = stepWarnings.some(w => w.level === 'error') ? 'error' : stepWarnings.length ? 'warn' : null
              return (
                <li key={step.id} className="rounded-lg border p-2 space-y-1.5"
                  style={{
                    background: 'var(--bg-input)',
                    borderColor: level === 'error' ? 'var(--fin-neg-border)' : level === 'warn' ? 'var(--fin-warn-border)' : 'var(--border)',
                  }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                      style={{ background: 'var(--card-bg)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                      aria-hidden="true">{i + 1}</span>
                    <select aria-label={`Provider for step ${i + 1}`} value={step.provider}
                      onChange={e => update(i, { provider: e.target.value })}
                      className="input text-xs py-1.5" style={{ width: 140, flex: '0 0 auto' }}>
                      {!providers.some(p => p.key === step.provider) && <option value={step.provider}>{step.provider}</option>}
                      {providers.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <input aria-label={`Model for step ${i + 1}`} value={step.model} list={listId(step.provider)}
                      aria-invalid={level === 'error' || !MODEL_ID_RE.test(step.model.trim()) ? true : undefined}
                      aria-describedby={stepWarnings.length ? stepWarnings.map((_, j) => `${uid}-step${step.id}-w${j}`).join(' ') : undefined}
                      onChange={e => update(i, { model: e.target.value })}
                      placeholder="Model id, e.g. openai/gpt-oss-120b" spellCheck={false} autoComplete="off"
                      className="input text-xs py-1.5 font-mono" style={{ flex: '1 1 200px', minWidth: 0 }} />
                    <div className="flex gap-1 ml-auto">
                      <button type="button" className="btn-icon" aria-label={`Move step ${i + 1} up`}
                        disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} aria-hidden="true" /></button>
                      <button type="button" className="btn-icon" aria-label={`Move step ${i + 1} down`}
                        disabled={i === route.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} aria-hidden="true" /></button>
                      <button type="button" className="btn-icon" aria-label={`Remove step ${i + 1}`}
                        disabled={route.length === 1} onClick={() => remove(i)}><Trash2 size={13} aria-hidden="true" /></button>
                    </div>
                  </div>
                  {stepWarnings.map((w, j) => (
                    <p key={j} id={`${uid}-step${step.id}-w${j}`} className="text-[11px] flex items-center gap-1 pl-8"
                      style={{ color: w.level === 'error' ? 'var(--fin-negative)' : 'var(--fin-warning)' }}>
                      <AlertTriangle size={11} aria-hidden="true" /> {w.message}
                    </p>
                  ))}
                </li>
              )
            })}
          </ol>
          {providers.map(p => (
            <datalist key={p.key} id={listId(p.key)}>
              {[...(p.models || [])]
                .sort((a, b) => (Boolean(b.free) - Boolean(a.free)) || a.id.localeCompare(b.id))
                .map(m => <option key={m.id} value={m.id} label={modelHint(m) || undefined} />)}
            </datalist>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={add}
              disabled={route.length >= MAX_ROUTE_STEPS}>
              <Plus size={12} aria-hidden="true" /> Add step
            </button>
            <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={() => setRoute(withIds(task.default_route))}
              disabled={isDefault}>
              <RotateCcw size={12} aria-hidden="true" /> Reset to default route
            </button>
          </div>
        </div>

        <Field label="Daily call cap" htmlFor={`${uid}-cap`}
          hint="Provider calls a day for this task, counted from midnight IST. Leave blank for no cap.">
          <input id={`${uid}-cap`} type="number" inputMode="numeric" min="1" step="1" value={cap}
            onChange={e => setCap(e.target.value)} placeholder="No cap" className="input text-sm" style={{ maxWidth: 200 }} />
        </Field>

        {problem && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}

// ── Prompt: edit, revert, history ────────────────────────────────────────────

function TaskPromptModal({ task, readOnly, onClose, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const uid = useDomId()
  const [info, setInfo] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [viewing, setViewing] = useState(null)

  const apply = (res) => { setInfo(res); setDraft(res?.current || '') }

  useEffect(() => {
    let alive = true
    api.admin.aiGateway.prompt(task.key)
      .then(res => { if (alive) apply(res) })
      .catch(e => { if (alive) setLoadError(e.message || 'Could not load the prompt') })
    return () => { alive = false }
  }, [task.key])

  const write = async (prompt, kind, message) => {
    setBusy(kind)
    try {
      const res = await api.admin.aiGateway.savePrompt(task.key, prompt)
      apply(res)
      setViewing(null)
      toast(message(res), 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not save the prompt', 'error')
    } finally {
      setBusy('')
    }
  }

  const useBuiltIn = async () => {
    const ok = await confirm({
      title: 'Use the built-in prompt?',
      message: `${task.label} goes back to the prompt that ships with the app. Your text stays in the version history, so you can restore it later.`,
      confirmLabel: 'Use built-in',
      tone: 'default',
    })
    if (ok) write(null, 'builtin', () => 'Back to the built-in prompt')
  }

  const view = async (version) => {
    if (viewing?.version === version) { setViewing(null); return }
    setBusy(`view:${version}`)
    try { setViewing(await api.admin.aiGateway.promptVersion(task.key, version)) }
    catch (e) { toast(e.message || 'Could not load that version', 'error') }
    finally { setBusy('') }
  }

  const restore = async (version) => {
    setBusy(`restore:${version}`)
    try {
      const saved = viewing?.version === version ? viewing : await api.admin.aiGateway.promptVersion(task.key, version)
      const res = await api.admin.aiGateway.savePrompt(task.key, saved.prompt)
      apply(res)
      setViewing(null)
      toast(`Version ${version} restored as version ${res.version}`, 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not restore that version', 'error')
    } finally {
      setBusy('')
    }
  }

  const editable = Boolean(info?.editable)
  const dirty = info ? draft !== (info.current || '') : false

  // Closing by Escape, the backdrop or Close would drop an edited prompt
  // without a word, so an unsaved draft asks first.
  const requestClose = async () => {
    if (dirty && !(await confirm({
      title: 'Discard your changes?',
      message: 'The edited prompt has not been saved. Closing throws it away.',
      confirmLabel: 'Discard',
      tone: 'danger',
    }))) return
    onClose()
  }
  const tooLong = draft.length > MAX_PROMPT_CHARS
  const missingMarkers = task.key === 'chat' && editable && CHAT_MARKERS.some(m => !draft.includes(m))
  const subtitle = !info ? undefined
    : !editable ? 'Assembled at run time · view only'
    : info.overridden ? `Version ${info.version} in use` : 'Built-in prompt in use'

  const footer = editable ? (
    <>
      <button type="button" className="btn-ghost mr-auto" onClick={useBuiltIn}
        disabled={!info.overridden || readOnly || Boolean(busy)}>
        {busy === 'builtin' ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />} Use built-in
      </button>
      <button type="button" className="btn-ghost" onClick={requestClose}>Close</button>
      <button type="button" className="btn-primary" onClick={() => write(draft, 'save', r => `Saved as version ${r.version}`)}
        disabled={!dirty || !draft.trim() || tooLong || readOnly || Boolean(busy)}>
        {busy === 'save' && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
      </button>
    </>
  ) : (
    <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
  )

  return (
    <Modal open onClose={requestClose} title={`${task.label} prompt`} subtitle={subtitle} width={820} footer={footer}>
      {loadError ? <Err msg={loadError} /> : !info ? <Skeleton rows={6} /> : !editable ? (
        <div className="space-y-3">
          <Notice tone="info">
            This prompt is put together each time the task runs, from fixed rules and live data, so it can't be overridden here.
          </Notice>
          <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed rounded-lg border p-3 max-h-[55vh] overflow-auto"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-1)' }}>
            {info.default || info.current || '—'}
          </pre>
        </div>
      ) : (
        <div className="space-y-4">
          {readOnly && <Notice tone="warn">Read-only until database migration 0003 has run.</Notice>}
          {task.key === 'chat' && (
            <Notice tone={missingMarkers ? 'error' : 'warn'}>
              Keep the <code className="font-mono">===ANSWER===</code> and <code className="font-mono">===END===</code> markers.
              The chat shows only the text between them, so without them answers come out empty.
            </Notice>
          )}
          <Field label="System prompt" htmlFor={`${uid}-prompt`}>
            <textarea id={`${uid}-prompt`} value={draft} onChange={e => setDraft(e.target.value)} rows={14}
              spellCheck={false} className="input font-mono text-xs leading-relaxed" style={{ resize: 'vertical', minHeight: 200 }} />
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span style={{ color: 'var(--text-3)' }}>{dirty ? 'Unsaved changes · saving creates a new version' : ''}</span>
              <span className="tabular-nums" style={{ color: tooLong ? 'var(--fin-negative)' : 'var(--text-3)' }}>
                {num(draft.length)} / {num(MAX_PROMPT_CHARS)} characters
              </span>
            </div>
          </Field>

          <details className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              Built-in prompt
            </summary>
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed px-3 pb-3 max-h-64 overflow-auto"
              style={{ color: 'var(--text-2)' }}>{info.default || '—'}</pre>
          </details>

          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Version history</p>
            {!info.history?.length ? (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>No saved versions yet. Saving creates version 1.</p>
            ) : (
              <ul>
                {info.history.map((h, i) => {
                  const current = h.version === info.version
                  return (
                    <li key={h.version} className="py-2" style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-semibold" style={{ color: 'var(--text-1)' }}>v{h.version}</span>
                            {current && <Badge color="green">In use</Badge>}
                            {h.reverted
                              ? <Badge>Back to built-in</Badge>
                              : <span style={{ color: 'var(--text-3)' }}>{num(h.chars)} characters</span>}
                          </div>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {istStamp(h.created_at)}{h.created_by ? ` · ${h.created_by}` : ''}
                          </p>
                        </div>
                        {!h.reverted && (
                          <div className="flex gap-1.5">
                            <button type="button" className="btn-secondary text-xs px-2.5 py-1" aria-label={`View version ${h.version}`}
                              aria-expanded={viewing?.version === h.version} onClick={() => view(h.version)} disabled={Boolean(busy)}>
                              {busy === `view:${h.version}` ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />} View
                            </button>
                            <button type="button" className="btn-secondary text-xs px-2.5 py-1" aria-label={`Restore version ${h.version}`}
                              onClick={() => restore(h.version)} disabled={current || readOnly || Boolean(busy)}>
                              {busy === `restore:${h.version}` ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />} Restore
                            </button>
                          </div>
                        )}
                      </div>
                      {viewing?.version === h.version && (
                        <pre className="mt-2 text-xs font-mono whitespace-pre-wrap leading-relaxed rounded-lg border p-3 max-h-64 overflow-auto"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-1)' }}>
                          {viewing.prompt ?? 'Built-in prompt (no text stored for this version).'}
                        </pre>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Test run ─────────────────────────────────────────────────────────────────

function TaskTestModal({ task, labels, onClose, onRan }) {
  const uid = useDomId()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const run = async () => {
    if (running) return
    setRunning(true); setError(null); setResult(null)
    try {
      setResult(await api.admin.aiGateway.testTask(task.key, input.trim() ? input : null))
      onRan()
    } catch (e) {
      setError(/timed out/i.test(e.message || '')
        ? 'The test ran past the browser\'s time limit. The attempts it made are in the call log.'
        : e.message || 'The test could not run')
    } finally {
      setRunning(false)
    }
  }

  const providerName = (key) => labels[key] || key || '—'

  return (
    <Modal open onClose={onClose} title={`Test ${task.label}`} width={720}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        <button type="button" className="btn-primary" onClick={run} disabled={running}>
          {running ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {running ? 'Running…' : 'Run'}
        </button>
      </>}>
      <div className="space-y-4">
        <Notice tone="info">Runs even when the task is off; counts toward caps and appears in the call log.</Notice>
        <Field label="Input" htmlFor={`${uid}-input`}
          hint={`Up to ${num(MAX_TEST_INPUT)} characters. Ctrl + Enter runs the test.`}>
          <textarea id={`${uid}-input`} value={input} rows={5} maxLength={MAX_TEST_INPUT}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run() } }}
            placeholder="Leave empty to use this task's sample input" className="input text-sm" style={{ resize: 'vertical' }} />
        </Field>

        <div aria-live="polite" className="space-y-3">
          {error && <Notice tone="error">{error}</Notice>}
          {result && (
            <>
              {result.ok ? (
                <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: 'var(--fin-positive)' }}>
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Answered by {providerName(result.provider)} · <span className="font-mono">{result.model}</span> in {num(result.ms)} ms
                </p>
              ) : (
                <Notice tone="error">{result.error || 'No model answered.'}</Notice>
              )}
              {result.content != null && (
                <pre className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg border p-3 max-h-72 overflow-auto"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-1)' }}>
                  {result.content || '(empty answer)'}
                </pre>
              )}
              {result.attempts?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Attempts</p>
                  <ol className="space-y-1.5">
                    {result.attempts.map((a, i) => (
                      <li key={i} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold" style={{ color: 'var(--text-3)' }}>{i + 1}.</span>
                          <span style={{ color: 'var(--text-1)' }}>
                            {providerName(a.provider)} · <span className="font-mono">{a.model}</span>
                          </span>
                          <Badge color={a.ok ? 'green' : a.skipped ? 'amber' : 'red'}>
                            {a.ok ? 'Answered' : a.skipped ? 'Skipped' : 'Failed'}
                          </Badge>
                          {a.ms != null && !a.skipped && <span className="tabular-nums" style={{ color: 'var(--text-3)' }}>{num(a.ms)} ms</span>}
                        </div>
                        {a.error && (
                          <p className="mt-1 break-words" style={{ color: a.skipped ? 'var(--text-3)' : 'var(--fin-negative)' }}>{a.error}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
