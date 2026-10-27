// The fallback chain editor shared by the global default chain and each task:
// ordered provider · model steps, dragged (or moved with the arrow buttons)
// into order, each with an optional timeout and a "skip when over its limit"
// switch.
import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, Plus, GripVertical, AlertTriangle, Moon } from 'lucide-react'
import { MAX_ROUTE_STEPS, MODEL_ID_RE, compact, localRouteWarnings, num } from './AiGatewayShared'

let stepSeq = 0

// Steps as the editor holds them: a stable id for React and drag-and-drop.
export const withIds = (route) => (route || []).map(s => ({
  provider: s.provider,
  model: s.model || '',
  timeout: s.timeout_s != null ? String(s.timeout_s) : '',
  skip: s.skip_over_limit !== false,
  id: ++stepSeq,
}))

// What the API takes: options only where they differ from the default, so an
// untouched step saves exactly as { provider, model }.
export function toPayload(route) {
  return route.map(s => {
    const out = { provider: s.provider, model: s.model.trim() }
    if (s.timeout.trim()) out.timeout_s = Number(s.timeout.trim())
    if (!s.skip) out.skip_over_limit = false
    return out
  })
}

export function sameRoute(a, b) {
  const x = toPayload(a)
  const y = (b || []).map(s => {
    const out = { provider: s.provider, model: s.model }
    if (s.timeout_s != null) out.timeout_s = s.timeout_s
    if (s.skip_over_limit === false) out.skip_over_limit = false
    return out
  })
  return JSON.stringify(x) === JSON.stringify(y)
}

// The first thing wrong with a chain still being edited, or null.
export function routeProblem(route) {
  if (!route.length) return 'Add at least one step.'
  for (let i = 0; i < route.length; i++) {
    const s = route[i]
    if (!MODEL_ID_RE.test(s.model.trim())) {
      return `Step ${i + 1}: enter a model id (letters, digits and . _ : / @ + - only, up to 120 characters).`
    }
    const t = s.timeout.trim()
    if (t && (!/^\d+$/.test(t) || Number(t) < 5 || Number(t) > 120)) {
      return `Step ${i + 1}: the timeout is 5 to 120 seconds, or blank for the provider's own.`
    }
    if (route.findIndex(o => o.provider === s.provider && o.model.trim() === s.model.trim()) !== i) {
      return `Step ${i + 1}: that model is already in the chain.`
    }
  }
  return null
}

function modelHint(m) {
  return [m.label, m.free && 'free', m.vision && 'vision', m.context && `${compact(m.context)} context`]
    .filter(Boolean).join(' · ')
}

export function RouteEditor({ uid, route, setRoute, providers, catalog = [], maxSteps = MAX_ROUTE_STEPS }) {
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const warnings = useMemo(() => localRouteWarnings(route, providers, catalog), [route, providers, catalog])
  const update = (i, patch) => setRoute(r => r.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const moveTo = (from, to) => setRoute(r => {
    if (from === to || to < 0 || to >= r.length) return r
    const next = [...r]
    const [step] = next.splice(from, 1)
    next.splice(to, 0, step)
    return next
  })
  const remove = (i) => setRoute(r => r.filter((_, j) => j !== i))
  const add = () => setRoute(r => (r.length >= maxSteps ? r : [
    ...r, { id: ++stepSeq, provider: r[r.length - 1]?.provider || providers[0]?.key || '', model: '', timeout: '', skip: true },
  ]))
  const listId = (key) => `${uid}-models-${key}`

  // Catalogue models first (they carry what the admin knows), then what the
  // provider offered at its last connection test.
  const options = useMemo(() => {
    const byProvider = {}
    for (const p of providers) {
      const seen = new Set()
      const list = []
      for (const m of catalog.filter(c => c.provider === p.key)) {
        seen.add(m.model)
        list.push({ id: m.model, label: m.label, context: m.context_window, vision: m.vision })
      }
      for (const m of [...(p.models || [])].sort((a, b) => (Boolean(b.free) - Boolean(a.free)) || a.id.localeCompare(b.id))) {
        if (!seen.has(m.id)) list.push(m)
      }
      byProvider[p.key] = list
    }
    return byProvider
  }, [providers, catalog])

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {route.map((step, i) => {
          const stepWarnings = warnings.filter(w => w.index === i)
          const level = stepWarnings.some(w => w.level === 'error') ? 'error' : stepWarnings.length ? 'warn' : null
          const isOver = over === i && dragging != null && dragging !== i
          return (
            <li key={step.id}
              onDragOver={(e) => { if (dragging != null) { e.preventDefault(); setOver(i) } }}
              onDrop={(e) => { e.preventDefault(); if (dragging != null) moveTo(dragging, i); setDragging(null); setOver(null) }}
              className="rounded-lg border p-2 space-y-1.5"
              style={{
                background: 'var(--bg-input)',
                borderColor: isOver ? 'var(--accent)' : level === 'error' ? 'var(--fin-neg-border)' : level === 'warn' ? 'var(--fin-warn-border)' : 'var(--border)',
                opacity: dragging === i ? 0.5 : 1,
              }}>
              <div className="flex flex-wrap items-center gap-2">
                <span draggable onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  className="flex items-center gap-0.5 cursor-grab select-none" title="Drag to reorder" aria-hidden="true"
                  style={{ color: 'var(--text-3)' }}>
                  <GripVertical size={14} />
                  <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
                    style={{ background: 'var(--card-bg)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>{i + 1}</span>
                </span>
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
                    disabled={i === 0} onClick={() => moveTo(i, i - 1)}><ArrowUp size={13} aria-hidden="true" /></button>
                  <button type="button" className="btn-icon" aria-label={`Move step ${i + 1} down`}
                    disabled={i === route.length - 1} onClick={() => moveTo(i, i + 1)}><ArrowDown size={13} aria-hidden="true" /></button>
                  <button type="button" className="btn-icon" aria-label={`Remove step ${i + 1}`}
                    disabled={route.length === 1} onClick={() => remove(i)}><Trash2 size={13} aria-hidden="true" /></button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-8 text-[11px]" style={{ color: 'var(--text-3)' }}>
                <label className="inline-flex items-center gap-1.5">
                  <span>Timeout</span>
                  <input aria-label={`Timeout for step ${i + 1} (seconds)`} value={step.timeout} inputMode="numeric"
                    onChange={e => update(i, { timeout: e.target.value })} placeholder="auto" title="Blank: the provider's own timeout"
                    className="input text-[11px] py-1" style={{ width: 84 }} />
                  <span>s</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={step.skip} onChange={e => update(i, { skip: e.target.checked })}
                    aria-label={`Skip step ${i + 1} when over its limit`} />
                  <span>Skip when its provider or model is over a limit</span>
                </label>
              </div>
              {stepWarnings.map((w, j) => (
                <p key={j} id={`${uid}-step${step.id}-w${j}`} className="text-[11px] flex items-center gap-1 pl-8"
                  style={{ color: w.level === 'error' ? 'var(--fin-negative)' : 'var(--fin-warning)' }}>
                  {w.bench ? <Moon size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />} {w.message}
                </p>
              ))}
            </li>
          )
        })}
      </ol>
      {providers.map(p => (
        <datalist key={p.key} id={listId(p.key)}>
          {(options[p.key] || []).map(m => <option key={m.id} value={m.id} label={modelHint(m) || undefined} />)}
        </datalist>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={add} disabled={route.length >= maxSteps}>
          <Plus size={12} aria-hidden="true" /> Add step
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {num(route.length)} of {num(maxSteps)} steps · drag a step by its number, or use the arrows
        </span>
      </div>
    </div>
  )
}
