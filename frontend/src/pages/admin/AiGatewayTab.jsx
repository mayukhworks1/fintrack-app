// AI gateway — providers, keys, the model catalogue, fallback chains, limits,
// prompts and the call log. Superadmin only; every endpoint behind it is
// require_superadmin.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Cpu, RefreshCw, LayoutDashboard, KeyRound, Boxes, Route, Gauge, ScrollText, ShieldAlert } from 'lucide-react'
import { api } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { Badge, Err, Skeleton, StatBox, SubTabBar } from './ui'
import { Notice, num } from './AiGatewayShared'
import { AiGatewayOverview } from './AiGatewayOverview'
import { AiGatewayProviders } from './AiGatewayProviders'
import { AiGatewayModels } from './AiGatewayModels'
import { AiGatewayRouting } from './AiGatewayRouting'
import { AiGatewayLimits } from './AiGatewayLimits'
import { AiGatewayLog } from './AiGatewayLog'

const SUBS = [
  { id: 'overview',  label: 'Overview',             icon: LayoutDashboard },
  { id: 'providers', label: 'Providers',            icon: KeyRound },
  { id: 'models',    label: 'Models',               icon: Boxes },
  { id: 'routing',   label: 'Routing & Fallbacks',  icon: Route },
  { id: 'limits',    label: 'Limits',               icon: Gauge },
  { id: 'log',       label: 'Logs',                 icon: ScrollText },
]
// Links from before the tabs were reorganised.
const LEGACY_SUBS = { tasks: 'routing' }

const DESCRIPTION = 'Every AI feature goes through here: any OpenAI-compatible provider, a model catalogue, a fallback chain per task with a global default behind it, daily, weekly and monthly limits, and a circuit breaker. Every call is logged; keys stay on the server.'

export function AiGatewayTab() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const rawSub = LEGACY_SUBS[searchParams.get('sub')] || searchParams.get('sub')
  const sub = SUBS.some(s => s.id === rawSub) ? rawSub : 'overview'
  const setSub = useCallback((id) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('sub', id)
      return next
    }, { replace: false })
  }, [setSearchParams])

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true); setError(null)
    try {
      const res = await api.admin.aiGateway.get()
      if (id === seq.current) setData(res)
    } catch (e) {
      if (id === seq.current) setError(e)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  // Re-reads the state after a change, keeping the current view on screen.
  const reload = useCallback(async ({ announce = false } = {}) => {
    const id = ++seq.current
    setRefreshing(true)
    try {
      const res = await api.admin.aiGateway.get()
      if (id === seq.current) { setData(res); setError(null) }
    } catch (e) {
      if (id === seq.current) {
        if (e.status === 403) setError(e)
        else if (announce) toast(e.message || 'Could not refresh the AI gateway', 'error')
      }
    } finally {
      if (id === seq.current) setRefreshing(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const labels = useMemo(
    () => Object.fromEntries((data?.providers || []).map(p => [p.key, p.label])),
    [data],
  )

  if (error?.status === 403) {
    return (
      <div className="card flex items-start gap-3">
        <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--fin-negative)' }} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Superadmins only</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            Only a superadmin signed in with email can see or change the AI gateway.
          </p>
        </div>
      </div>
    )
  }
  if (loading && !data) return <Skeleton rows={6} />
  if (error && !data) return <Err msg={error.message || 'Could not load the AI gateway'} onRetry={load} />
  if (!data) return null

  const providers = data.providers || []
  const tasks = data.tasks || []
  const g = data.global || {}
  const readOnly = !data.storage_ok
  const readyCount = providers.filter(p => p.ready).length
  const onCount = tasks.filter(t => t.enabled).length
  const callsCapped = g.daily_call_cap != null && (g.calls_today || 0) >= g.daily_call_cap
  const tokensCapped = g.daily_token_cap != null && (g.tokens_today || 0) >= g.daily_token_cap

  return (
    <div className="space-y-4">
      <section className="card space-y-3" aria-labelledby="ai-gateway-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="kpi-icon" style={{ background: 'var(--kpi-1-bg)', color: 'var(--kpi-1-fg)' }} aria-hidden="true">
              <Cpu size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="ai-gateway-title" className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>AI gateway</h2>
                {readOnly && <Badge color="amber">Read-only</Badge>}
                {readyCount === 0
                  ? <Badge color="red">No provider ready</Badge>
                  : !readOnly && <Badge color="green">Ready</Badge>}
              </div>
              <p className="text-xs mt-1 leading-relaxed max-w-3xl" style={{ color: 'var(--text-3)' }}>{DESCRIPTION}</p>
            </div>
          </div>
          <button type="button" onClick={() => reload({ announce: true })} disabled={refreshing}
            className="btn-secondary text-xs px-3 py-1.5">
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>
        {readOnly && (
          <Notice tone="warn">
            <strong>Read-only.</strong> The gateway's tables are missing because database migration 0003 has not run.
            AI calls use the built-in routes and the keys set in the server environment. Changes can be saved once the migration has run.
          </Notice>
        )}
        {readyCount === 0 && (
          <Notice tone="error">
            No provider is on with a usable key, so AI features can't answer. Set a key under Providers.
          </Notice>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Calls today" value={num(g.calls_today || 0)}
          color={callsCapped ? 'var(--fin-negative)' : undefined}
          sub={g.daily_call_cap != null ? `Gateway cap ${num(g.calls_today || 0)} of ${num(g.daily_call_cap)}` : 'No gateway cap'} />
        <StatBox label="Tokens today" value={num(g.tokens_today || 0)}
          color={tokensCapped ? 'var(--fin-negative)' : undefined}
          sub={g.daily_token_cap != null ? `Gateway cap ${num(g.tokens_today || 0)} of ${num(g.daily_token_cap)}` : 'No gateway cap'} />
        <StatBox label="Tasks on" value={`${onCount} of ${tasks.length}`} sub="Switched on by a superadmin" />
        <StatBox label="Providers ready" value={`${readyCount} of ${providers.length}`}
          color={readyCount === 0 ? 'var(--fin-negative)' : undefined} sub="On, with a key" />
      </div>

      <div className="overflow-x-auto">
        <SubTabBar tabs={SUBS} active={sub} onSelect={setSub} />
      </div>

      {sub === 'overview' && <AiGatewayOverview data={data} onOpen={setSub} />}
      {sub === 'providers' && (
        <AiGatewayProviders providers={providers} tasks={tasks} presets={data.presets || []} catalog={data.catalog || []}
          limits={data.limits || []} usage={data.usage || {}} v2={Boolean(data.v2)} removedBuiltins={data.removed_builtins || []}
          readOnly={readOnly} onChanged={reload} />
      )}
      {sub === 'models' && (
        <AiGatewayModels providers={providers} catalog={data.catalog || []} tasks={tasks} limits={data.limits || []}
          v2={Boolean(data.v2)} readOnly={readOnly} onChanged={reload} />
      )}
      {sub === 'routing' && <AiGatewayRouting data={data} labels={labels} readOnly={readOnly} onChanged={reload} />}
      {sub === 'limits' && <AiGatewayLimits data={data} readOnly={readOnly} onChanged={reload} />}
      {sub === 'log' && (
        <AiGatewayLog day={data.day} tasks={tasks} providers={providers} labels={labels} catalog={data.catalog || []} />
      )}
    </div>
  )
}
