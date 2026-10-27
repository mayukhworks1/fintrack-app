// AI gateway › Limits: requests, tokens and estimated spend per day, week and
// month — for the workspace, each provider, model and task, and each user —
// with usage against every limit.
import { useState } from 'react'
import { Pencil, Loader2, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import {
  LimitBars, METRICS, Notice, PERIODS, PERIOD_ADJ, METRIC_LABEL, metricValue, num, parseAmount, useDomId,
} from './AiGatewayShared'

const SECTIONS = [
  ['global', 'Workspace', 'Everything the gateway sends, across every task, provider and user. When reached, AI calls are refused until the period resets.'],
  ['provider', 'Providers', 'When a provider reaches a limit, chain steps on it are skipped and the chain falls back to the next step.'],
  ['model', 'Models', 'When a model reaches a limit, its steps are skipped and the chain falls back. Models come from the catalogue.'],
  ['task', 'Tasks', 'When a task reaches a limit, that feature is refused until the period resets; other tasks carry on.'],
  ['user', 'Per user', 'Applies to each signed-in user on their own: one heavy user cannot use up everyone\'s allowance.'],
]

export function AiGatewayLimits({ data, readOnly, onChanged }) {
  const [dialog, setDialog] = useState(null)
  const v2 = Boolean(data.v2)
  const groups = data.limits || []
  const usage = data.usage || {}
  const find = (scope, target) => groups.find(g => g.scope === scope && g.target === target)

  const targets = {
    global: [{ target: '', label: 'Workspace' }],
    provider: (data.providers || []).map(p => ({ target: p.key, label: p.label })),
    model: [
      ...(data.catalog || []).map(m => ({
        target: `${m.provider}|${m.model}`,
        label: `${(data.providers || []).find(p => p.key === m.provider)?.label || m.provider} · ${m.label || m.model}`,
      })),
      ...groups.filter(g => g.scope === 'model' && !(data.catalog || []).some(m => `${m.provider}|${m.model}` === g.target))
        .map(g => ({ target: g.target, label: g.label })),
    ],
    task: (data.tasks || []).map(t => ({ target: t.key, label: t.label })),
    user: [{ target: '*', label: 'Each user' }],
  }

  const usedOf = (scope, target, period) => {
    const view = usage[period] || {}
    if (scope === 'global') return view.total
    if (scope === 'provider') return view.by_provider?.[target]
    if (scope === 'model') return view.by_model?.[target]
    if (scope === 'task') return view.by_task?.[target]
    return null
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed max-w-3xl" style={{ color: 'var(--text-3)' }}>
        Days run midnight to midnight IST; weeks start on Monday and months on the 1st. Spend is estimated from the prices in the
        model catalogue — calls to a model without a price count as free. Bars turn amber at 80% and red when a limit is reached.
      </p>
      {!v2 && (
        <Notice tone="info">
          Limits need database migration 0008, which has not run yet. Until it does, the daily caps saved before it still apply
          and are shown here read-only.
        </Notice>
      )}
      {SECTIONS.map(([scope, title, note]) => (
        <section key={scope} className="card p-0 overflow-hidden" aria-labelledby={`limits-${scope}`}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 id={`limits-${scope}`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{title}</h3>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>{note}</p>
          </div>
          {!targets[scope].length ? (
            <p className="px-4 py-6 text-xs text-center" style={{ color: 'var(--text-3)' }}>
              {scope === 'model' ? 'No models in the catalogue yet. Add them under Models to give them limits.' : 'Nothing to limit yet.'}
            </p>
          ) : (
            <ul>
              {targets[scope].map((t, i) => {
                const group = find(scope, t.target)
                return (
                  <li key={t.target || 'all'} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] gap-3 md:items-start"
                    style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words" style={{ color: 'var(--text-1)' }}>{t.label}</p>
                      {scope !== 'user' && (
                        <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                          Today {num(usedOf(scope, t.target, 'day')?.calls || 0)} requests · this month {num(usedOf(scope, t.target, 'month')?.calls || 0)}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0"><LimitBars limits={group?.limits} /></div>
                    <div className="flex md:justify-end">
                      <button type="button" className="btn-secondary text-xs px-2.5 py-1" disabled={readOnly || !v2}
                        aria-label={`Edit limits for ${t.label}`}
                        onClick={() => setDialog({ scope, target: t.target, label: t.label, limits: group?.limits || [] })}>
                        <Pencil size={12} aria-hidden="true" /> {group?.limits?.length ? 'Edit' : 'Set limits'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
      {dialog && (
        <LimitsModal {...dialog} usedOf={(period) => usedOf(dialog.scope, dialog.target, period)}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged() }} />
      )}
    </div>
  )
}

const cell = (limits, period, metric) => {
  const l = limits.find(x => x.period === period && x.metric === metric)
  return l ? String(l.cap) : ''
}

function LimitsModal({ scope, target, label, limits, usedOf, onClose, onSaved }) {
  const toast = useToast()
  const confirm = useConfirm()
  const uid = useDomId()
  const [values, setValues] = useState(() => Object.fromEntries(
    PERIODS.flatMap(([p]) => METRICS.map(([m]) => [`${p}:${m}`, cell(limits, p, m)]))))
  const [saving, setSaving] = useState(false)

  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => {
    const metric = k.split(':')[1]
    const n = parseAmount(v)
    if (n === null) return [k, null]
    if (Number.isNaN(n) || n <= 0) return [k, NaN]
    if (metric !== 'spend' && !Number.isInteger(n)) return [k, NaN]
    return [k, n]
  }))
  const bad = Object.entries(parsed).find(([, v]) => Number.isNaN(v))
  const problem = bad
    ? (bad[0].endsWith('spend') ? 'A spend limit is an amount in USD above 0, or blank.' : 'Request and token limits are whole numbers of 1 or more, or blank.')
    : null

  const body = () => Object.entries(parsed).filter(([, v]) => v != null)
    .map(([k, cap]) => { const [period, metric] = k.split(':'); return { period, metric, cap } })

  const write = async (list, message) => {
    setSaving(true)
    try {
      await api.admin.aiGateway.saveLimits(scope, target, list)
      toast(message, 'success')
      onSaved()
    } catch (e) {
      toast(e.message || 'Could not save the limits', 'error')
    } finally {
      setSaving(false)
    }
  }

  const clearAll = async () => {
    const ok = await confirm({
      title: `Remove every limit for ${label}?`,
      message: 'Only the providers\' own rate limits will apply to it.',
      confirmLabel: 'Remove limits',
      tone: 'danger',
    })
    if (ok) write([], `Limits for ${label} removed`)
  }

  return (
    <Modal open onClose={onClose} title={`Limits · ${label}`} subtitle="Blank means no limit" width={640}
      footer={<>
        {limits.length > 0 && (
          <button type="button" className="btn-ghost mr-auto" onClick={clearAll} disabled={saving} style={{ color: 'var(--fin-negative)' }}>
            <Trash2 size={13} aria-hidden="true" /> Remove all
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" onClick={() => write(body(), `Limits for ${label} saved`)}
          disabled={saving || Boolean(problem)}>
          {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
        </button>
      </>}>
      <div className="space-y-3">
        <div className="space-y-3">
          {PERIODS.map(([p, now, adj]) => {
            const used = usedOf(p)
            return (
              <fieldset key={p} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <legend className="px-1 text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{adj}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {METRICS.map(([m, mLabel]) => {
                    const id = `${uid}-${p}-${m}`
                    const hint = scope === 'user' ? null : `${now}: ${metricValue(m, m === 'requests' ? used?.calls || 0 : m === 'tokens' ? used?.tokens || 0 : used?.spend || 0)}`
                    return (
                      <div key={m} className="space-y-1 min-w-0">
                        <label htmlFor={id} className="label mb-0">{mLabel}</label>
                        <input id={id} inputMode={m === 'spend' ? 'decimal' : 'numeric'} value={values[`${p}:${m}`]}
                          aria-label={`${PERIOD_ADJ[p]} ${METRIC_LABEL[m].toLowerCase()} limit`}
                          aria-invalid={Number.isNaN(parsed[`${p}:${m}`]) ? true : undefined}
                          onChange={e => setValues(v => ({ ...v, [`${p}:${m}`]: e.target.value }))}
                          placeholder="No limit" className="input text-sm" />
                        {hint && <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>{hint}</p>}
                      </div>
                    )
                  })}
                </div>
              </fieldset>
            )
          })}
        </div>
        {scope === 'provider' || scope === 'model'
          ? <Notice tone="info">Over a limit, chain steps on it are skipped (a step can be set to run anyway in its chain).</Notice>
          : <Notice tone="info">Over a limit, calls are refused with a message saying when it resets.</Notice>}
        {problem && <Notice tone="error">{problem}</Notice>}
      </div>
    </Modal>
  )
}
