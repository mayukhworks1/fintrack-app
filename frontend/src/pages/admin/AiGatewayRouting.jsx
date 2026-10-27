// AI gateway › Routing & fallbacks: the global default chain, the circuit
// breaker and its bench, then each task's own chain.
import { useState } from 'react'
import { Loader2, RotateCcw, Moon, Save, ShieldCheck } from 'lucide-react'
import { api } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge } from './ui'
import { EmptyState, Field, Notice, WarningList, istStamp, num, useDomId } from './AiGatewayShared'
import { RouteEditor, routeProblem, sameRoute, toPayload, withIds } from './AiGatewayRouteEditor'
import { AiGatewayTasks } from './AiGatewayTasks'

// "in 4 min" for a time still ahead.
function untilText(iso) {
  const left = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(left)) return '—'
  if (left <= 60000) return 'within a minute'
  return `in ${Math.ceil(left / 60000)} min`
}

export function AiGatewayRouting({ data, labels, readOnly, onChanged }) {
  return (
    <div className="space-y-4">
      <DefaultChain data={data} readOnly={readOnly} onChanged={onChanged} />
      <Breaker data={data} labels={labels} readOnly={readOnly} onChanged={onChanged} />
      <AiGatewayTasks tasks={data.tasks || []} providers={data.providers || []} catalog={data.catalog || []}
        v2={Boolean(data.v2)} defaultRoute={data.default_route || []} labels={labels} readOnly={readOnly} onChanged={onChanged} />
    </div>
  )
}

function DefaultChain({ data, readOnly, onChanged }) {
  const toast = useToast()
  const uid = useDomId()
  const saved = data.default_route || []
  const [route, setRoute] = useState(() => withIds(saved))
  const [busy, setBusy] = useState('')
  const [seen, setSeen] = useState(saved)
  // A refresh with a different saved chain replaces an untouched editor.
  if (seen !== saved) {
    setSeen(saved)
    if (sameRoute(route, seen)) setRoute(withIds(saved))
  }

  const problem = routeProblem(route)
  const dirty = !sameRoute(route, saved)
  const builtIn = data.builtin_default_route || []

  const save = async (value, kind) => {
    setBusy(kind)
    try {
      const res = await api.admin.aiGateway.saveDefaultRoute(value)
      if (res?.default_route) setRoute(withIds(res.default_route))
      toast(value === null ? 'Default chain back to the built-in one' : 'Default chain saved', 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not save the default chain', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card space-y-3" aria-labelledby={`${uid}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${uid}-title`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Global default chain</h3>
            <Badge color={data.default_route_custom ? 'blue' : 'default'}>{data.default_route_custom ? 'Saved' : 'Built-in'}</Badge>
          </div>
          <p className="text-xs mt-0.5 leading-relaxed max-w-3xl" style={{ color: 'var(--text-3)' }}>
            Serves every task without a chain of its own, and follows every task's own chain as the last line of fallback
            (unless a task switches that off). Every AI feature therefore has at least this chain to fall back on.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn-ghost text-xs px-2.5 py-1" disabled={readOnly || Boolean(busy) || !data.default_route_custom}
            onClick={() => save(null, 'reset')}>
            {busy === 'reset' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />} Use built-in
          </button>
          <button type="button" className="btn-primary text-xs px-2.5 py-1" disabled={readOnly || Boolean(busy) || !dirty || Boolean(problem)}
            onClick={() => save(toPayload(route), 'save')}>
            {busy === 'save' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Save size={12} aria-hidden="true" />} Save chain
          </button>
        </div>
      </div>
      <WarningList warnings={data.default_route_warnings} />
      <RouteEditor uid={uid} route={route} setRoute={setRoute} providers={data.providers || []} catalog={data.catalog || []}
        maxSteps={data.max_route_steps || undefined} />
      {!data.default_route_custom && builtIn.length > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Built in: {builtIn.map(s => s.model).join(' → ')}.</p>
      )}
      {problem && dirty && <Notice tone="error">{problem}</Notice>}
    </section>
  )
}

function Breaker({ data, labels, readOnly, onChanged }) {
  const toast = useToast()
  const confirm = useConfirm()
  const uid = useDomId()
  const b = data.breaker || { failures: 3, minutes: 5, benched: [] }
  const [failures, setFailures] = useState(String(b.failures))
  const [minutes, setMinutes] = useState(String(b.minutes))
  const [busy, setBusy] = useState('')

  const f = /^\d+$/.test(failures.trim()) ? Number(failures) : NaN
  const m = /^\d+$/.test(minutes.trim()) ? Number(minutes) : NaN
  const problem = !(f >= 1 && f <= 100) ? 'Failures in a row: a whole number from 1 to 100.'
    : !(m >= 0 && m <= 1440) ? 'Minutes on the bench: 0 (breaker off) to 1440.' : null
  const dirty = f !== b.failures || m !== b.minutes
  const benched = b.benched || []

  const save = async () => {
    setBusy('save')
    try {
      const patch = {}
      if (f !== b.failures) patch.failures = f
      if (m !== b.minutes) patch.minutes = m
      await api.admin.aiGateway.saveBreaker(patch)
      toast('Circuit breaker saved', 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not save the circuit breaker', 'error')
    } finally {
      setBusy('')
    }
  }

  const reset = async (target, name) => {
    if (!target) {
      const ok = await confirm({
        title: 'Take everything off the bench?',
        message: 'Every benched provider and model goes back to its place in the chains at once, even if it is still failing.',
        confirmLabel: 'Clear the bench',
        tone: 'default',
      })
      if (!ok) return
    }
    setBusy(`reset:${target || 'all'}`)
    try {
      await api.admin.aiGateway.resetBench(target)
      toast(target ? `${name} is back in its chains` : 'Bench cleared', 'success')
      onChanged()
    } catch (e) {
      toast(e.message || 'Could not clear the bench', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card space-y-3" aria-labelledby={`${uid}-title`}>
      <div>
        <h3 id={`${uid}-title`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Circuit breaker</h3>
        <p className="text-xs mt-0.5 leading-relaxed max-w-3xl" style={{ color: 'var(--text-3)' }}>
          A provider or model that fails this many times in a row is benched: it moves to the end of every chain for a few
          minutes, then gets another try on its own. A benched step is still tried if nothing before it answers.
          A network failure, a server error or a refused key counts against the whole provider; anything else against the model.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Failures in a row" htmlFor={`${uid}-f`} className="w-40">
          <input id={`${uid}-f`} inputMode="numeric" value={failures} onChange={e => setFailures(e.target.value)} className="input text-sm" />
        </Field>
        <Field label="Minutes on the bench" htmlFor={`${uid}-m`} className="w-40">
          <input id={`${uid}-m`} inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} className="input text-sm" />
        </Field>
        <button type="button" className="btn-secondary text-xs px-3 py-2" onClick={save}
          disabled={readOnly || !dirty || Boolean(problem) || Boolean(busy)}>
          {busy === 'save' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />} Save
        </button>
      </div>
      {problem && <Notice tone="error">{problem}</Notice>}
      {b.minutes === 0 && <Notice tone="warn">The breaker is off: failing providers and models keep their place in every chain.</Notice>}

      <div className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: benched.length ? '1px solid var(--border)' : undefined }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>On the bench now ({num(benched.length)})</p>
          {benched.length > 1 && (
            <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => reset(null)} disabled={Boolean(busy)}>Clear all</button>
          )}
        </div>
        {!benched.length ? (
          <EmptyState icon={ShieldCheck} title="Nothing is benched">Every provider and model keeps its place in the chains.</EmptyState>
        ) : (
          <ul>
            {benched.map((e, i) => {
              const name = `${labels[e.provider] || e.provider}${e.model ? ` · ${e.model}` : ''}`
              return (
                <li key={e.target} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs"
                  style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                      <Moon size={12} aria-hidden="true" style={{ color: 'var(--fin-warning)' }} />
                      <span className="font-semibold break-all">{name}</span>
                      <Badge color="amber">{e.kind}</Badge>
                    </p>
                    <p style={{ color: 'var(--text-3)' }} title={istStamp(e.until)}>
                      {num(e.failures)} failures in a row · back {untilText(e.until)}
                      {e.last_error ? ` · last: ${e.last_error}` : ''}
                    </p>
                  </div>
                  <button type="button" className="btn-secondary text-xs px-2 py-1" disabled={Boolean(busy)}
                    onClick={() => reset(e.target, name)} aria-label={`Take ${name} off the bench`}>
                    {busy === `reset:${e.target}` && <Loader2 size={12} className="animate-spin" aria-hidden="true" />} Back in now
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
