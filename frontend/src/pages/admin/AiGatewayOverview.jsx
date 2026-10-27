// AI gateway › Overview: provider health, usage against limits, and what needs attention.
import { Activity, CheckCircle2, Gauge, Server } from 'lucide-react'
import { Badge } from './ui'
import { relTime } from './utils'
import {
  Dot, EmptyState, LimitBar, LimitBars, Notice, PERIODS, PERIOD_ADJ, METRIC_LABEL, istStamp, keyBadge, num, usd,
} from './AiGatewayShared'

function health(p) {
  if (!p.enabled) return ['default', 'Off', null]
  if (!p.ready) return ['red', 'No key', 'bad']
  if (p.benched) return ['amber', 'Benched', 'bad']
  if (p.last_test && !p.last_test.ok) return ['red', 'Test failed', 'bad']
  return ['green', 'Ready', 'ok']
}

export function AiGatewayOverview({ data, onOpen }) {
  const providers = data.providers || []
  const alerts = data.alerts || []
  const usage = data.usage || {}
  const groups = data.limits || []
  const workspace = groups.find(g => g.scope === 'global')
  const near = groups.filter(g => g.scope !== 'global')
    .flatMap(g => g.limits.map(l => ({ ...l, label: g.label, scope: g.scope })))
    .filter(l => l.pct >= 50)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)
  const anySpend = PERIODS.some(([p]) => usage[p]?.total?.spend)

  return (
    <div className="space-y-4">
      <section className="card space-y-2" aria-labelledby="gw-alerts">
        <h3 id="gw-alerts" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Alerts</h3>
        {!alerts.length ? (
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <CheckCircle2 size={13} aria-hidden="true" style={{ color: 'var(--fin-positive)' }} />
            All clear: every chain has a ready provider and no limit is close.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i}><Notice tone={a.level === 'error' ? 'error' : a.level === 'warn' ? 'warn' : 'info'}>{a.message}</Notice></li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card space-y-3" aria-labelledby="gw-health">
          <div className="flex items-center justify-between gap-2">
            <h3 id="gw-health" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Provider health</h3>
            <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => onOpen('providers')}>Manage</button>
          </div>
          {!providers.length ? (
            <EmptyState icon={Server} title="No providers">Add one under Providers so AI features can answer.</EmptyState>
          ) : (
            <ul className="space-y-1">
              {providers.map(p => {
                const [color, label, tone] = health(p)
                const [keyColor, keyLabel] = keyBadge(p)
                const today = usage.day?.by_provider?.[p.key]
                return (
                  <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <Dot tone={tone} />
                      <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{p.label}</span>
                      <Badge color={color}>{label}</Badge>
                      {label !== 'No key' && <Badge color={keyColor}>{keyLabel}</Badge>}
                    </span>
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}
                      title={p.last_test?.at ? istStamp(p.last_test.at) : undefined}>
                      {num(today?.calls || 0)} today
                      {p.last_test ? ` · tested ${relTime(p.last_test.at)}` : ' · not tested'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card space-y-3" aria-labelledby="gw-usage">
          <h3 id="gw-usage" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Usage</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <caption className="sr-only">Requests, tokens and estimated spend per period</caption>
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Period', 'Requests', 'Tokens', anySpend ? 'Est. spend' : null].filter(Boolean).map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map(([p, now]) => (
                  <tr key={p} style={{ borderTop: '1px solid var(--border)' }}>
                    <th scope="row" className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-1)' }}>{now}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{num(usage[p]?.total?.calls || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(usage[p]?.total?.tokens || 0)}</td>
                    {anySpend && <td className="px-3 py-2 text-right tabular-nums">{usd(usage[p]?.total?.spend || 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!anySpend && (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Add prices to models in the catalogue to estimate spend.</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card space-y-3" aria-labelledby="gw-ws-limits">
          <div className="flex items-center justify-between gap-2">
            <h3 id="gw-ws-limits" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Workspace limits</h3>
            <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => onOpen('limits')}>Edit</button>
          </div>
          <LimitBars limits={workspace?.limits} />
        </section>

        <section className="card space-y-3" aria-labelledby="gw-near">
          <h3 id="gw-near" className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Closest to a limit</h3>
          {!near.length ? (
            <EmptyState icon={Gauge} title="Nothing is past half its limit">Provider, model, task and user limits show here as they fill up.</EmptyState>
          ) : (
            <div className="space-y-2">
              {near.map((l, i) => (
                <LimitBar key={i} label={`${l.label} · ${PERIOD_ADJ[l.period].toLowerCase()} ${METRIC_LABEL[l.metric].toLowerCase()}`}
                  used={l.used} cap={l.cap} metric={l.metric} />
              ))}
            </div>
          )}
        </section>
      </div>

      {(data.breaker?.benched || []).length > 0 && (
        <section className="card space-y-2" aria-labelledby="gw-bench">
          <div className="flex items-center justify-between gap-2">
            <h3 id="gw-bench" className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
              <Activity size={14} aria-hidden="true" /> On the bench
            </h3>
            <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => onOpen('routing')}>Manage</button>
          </div>
          <ul className="text-xs space-y-1" style={{ color: 'var(--text-2)' }}>
            {data.breaker.benched.map(b => (
              <li key={b.target}>{b.provider}{b.model ? ` · ${b.model}` : ''} — {num(b.failures)} failures in a row{b.last_error ? ` (${b.last_error})` : ''}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
