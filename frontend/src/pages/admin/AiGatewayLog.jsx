// AI gateway › Logs: usage totals per task, how each model is doing, and every
// provider call, newest first, with why a failed one failed in plain words.
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../services/api'
import Modal from '../../components/Modal'
import { Badge, Empty, Err, Pager, Skeleton, statusBadge } from './ui'
import { Field, Notice, STATUS_BADGE, istDay, istShort, istStamp, num, shiftDay, useDomId } from './AiGatewayShared'

const PAGE_SIZE = 50
const MAX_RANGE_DAYS = 92
const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']]
const STATUSES = [['', 'All statuses'], ['ok', 'Answered'], ['failed', 'Failed'], ['not_sent', 'Not sent']]
const LATENCIES = [['', 'Any time'], ['1000', 'Over 1 s'], ['5000', 'Over 5 s'], ['15000', 'Over 15 s'], ['30000', 'Over 30 s']]
const STAT_DAYS = [[1, 'Today'], [7, '7 days'], [30, '30 days']]

function StatusPill({ status }) {
  const [color, label] = STATUS_BADGE[status] || ['default', status || '—']
  return <Badge color={color}>{label}</Badge>
}

const tokens = (a, b) => `${num(a ?? 0)} / ${num(b ?? 0)}`
const ms = (v) => (v != null ? `${num(v)} ms` : '—')

export function AiGatewayLog({ day, tasks, providers, labels, catalog = [] }) {
  const uid = useDomId()
  const today = day || istDay()
  const [range, setRange] = useState('today')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [task, setTask] = useState('')
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [model, setModel] = useState('')
  const [minMs, setMinMs] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true); setError(null)
    try {
      const params = { from, to, task, provider, status, limit: PAGE_SIZE, offset }
      if (model) params.model = model
      if (minMs) params.min_ms = Number(minMs)
      const res = await api.admin.aiGateway.calls(params)
      if (id === seq.current) setData(res)
    } catch (e) {
      if (id === seq.current) setError(e.message || 'Could not load the call log')
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [from, to, task, provider, status, model, minMs, offset])

  useEffect(() => { load() }, [load])

  const pickRange = (r) => {
    setRange(r)
    setTo(today)
    setFrom(r === '7d' ? shiftDay(today, -6) : r === '30d' ? shiftDay(today, -29) : today)
    setOffset(0)
  }
  const changeFrom = (v) => {
    if (!v) return
    setRange('custom'); setOffset(0); setFrom(v)
    if (v > to) setTo(v)
    else if (shiftDay(v, MAX_RANGE_DAYS - 1) < to) setTo(shiftDay(v, MAX_RANGE_DAYS - 1))
  }
  const changeTo = (v) => {
    if (!v) return
    setRange('custom'); setOffset(0); setTo(v)
    if (v < from) setFrom(v)
    else if (shiftDay(v, -(MAX_RANGE_DAYS - 1)) > from) setFrom(shiftDay(v, -(MAX_RANGE_DAYS - 1)))
  }
  const filter = (setter) => (e) => { setter(e.target.value); setOffset(0) }

  const totals = data?.totals || {}
  const byTask = data?.by_task || []
  const rows = data?.rows || []
  const taskLabel = (key, fallback) => fallback || tasks.find(t => t.key === key)?.label || key || '—'
  const modelIds = [...new Set([
    ...catalog.filter(m => !provider || m.provider === provider).map(m => m.model),
    ...tasks.flatMap(t => (t.effective_route || t.route || []).filter(s => !provider || s.provider === provider).map(s => s.model)),
  ])].sort()

  return (
    <div className="space-y-4">
      <ModelStats labels={labels} onPick={(p, m) => { setProvider(p || ''); setModel(m); setStatus('failed'); setOffset(0) }} />

      <section className="card space-y-3" aria-labelledby={`${uid}-usage`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${uid}-usage`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Usage</h3>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs px-3 py-1.5">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <div role="group" aria-label="Date range" className="col-span-2 inline-flex self-end gap-1 p-1 rounded-xl w-fit"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            {RANGES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={range === id} onClick={() => pickRange(id)}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                style={range === id
                  ? { background: 'var(--card-bg)', color: 'var(--text-1)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                  : { color: 'var(--text-3)', background: 'transparent' }}>
                {label}
              </button>
            ))}
          </div>
          <Field label="From" htmlFor={`${uid}-from`} className="sm:w-36">
            <input id={`${uid}-from`} type="date" value={from} max={today} onChange={e => changeFrom(e.target.value)}
              className="input text-xs py-1.5" />
          </Field>
          <Field label="To" htmlFor={`${uid}-to`} className="sm:w-36">
            <input id={`${uid}-to`} type="date" value={to} max={today} onChange={e => changeTo(e.target.value)}
              className="input text-xs py-1.5" />
          </Field>
          <Field label="Task" htmlFor={`${uid}-task`} className="sm:w-48">
            <select id={`${uid}-task`} value={task} onChange={filter(setTask)} className="input text-xs py-1.5">
              <option value="">All tasks</option>
              {tasks.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Provider" htmlFor={`${uid}-provider`} className="sm:w-36">
            <select id={`${uid}-provider`} value={provider} onChange={filter(setProvider)} className="input text-xs py-1.5">
              <option value="">All providers</option>
              {providers.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor={`${uid}-status`} className="sm:w-36">
            <select id={`${uid}-status`} value={status} onChange={filter(setStatus)} className="input text-xs py-1.5">
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Model" htmlFor={`${uid}-model`} className="col-span-2 sm:col-span-1 sm:w-56">
            <select id={`${uid}-model`} value={model} onChange={filter(setModel)} className="input text-xs py-1.5">
              <option value="">All models</option>
              {model && !modelIds.includes(model) && <option value={model}>{model}</option>}
              {modelIds.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Latency" htmlFor={`${uid}-latency`} className="sm:w-32">
            <select id={`${uid}-latency`} value={minMs} onChange={filter(setMinMs)} className="input text-xs py-1.5">
              {LATENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Days run midnight to midnight IST. Prompts and answers are never stored, only the details of each call.
        </p>

        {error && !data ? <Err msg={error} onRetry={load} /> : !data ? <Skeleton rows={4} /> : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)', opacity: loading ? 0.6 : 1 }}
            aria-busy={loading}>
            <table className="w-full text-xs">
              <caption className="sr-only">Usage for the selected days</caption>
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Task', 'Requests', 'Answered', 'Failed', 'Not sent', 'Tokens in / out', 'Avg time'].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-semibold whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}
                      style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <TotalsRow label="All" row={totals} strong />
                {byTask.map(r => <TotalsRow key={r.task ?? ''} label={taskLabel(r.task, r.label)} row={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-0 overflow-hidden" aria-labelledby={`${uid}-calls`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 id={`${uid}-calls`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Calls</h3>
          {data && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{num(data.total || 0)} calls · newest first</span>}
        </div>
        {error && data && <div className="px-4 pt-3"><Notice tone="error">{error}</Notice></div>}
        {!data ? (error ? null : <div className="px-4"><Skeleton rows={6} /></div>) : !rows.length ? (
          <Empty label="No calls for these filters." />
        ) : (
          <div className="overflow-x-auto" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
            <table className="w-full text-xs">
              <caption className="sr-only">AI calls, newest first</caption>
              <thead>
                <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                  {['Time (IST)', 'Task', 'Provider · model', 'Status', 'Tokens in / out', 'Time', 'User'].map(h => (
                    <th key={h} scope="col" className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="cursor-pointer transition-colors" style={{ borderBottom: '1px solid var(--border)' }}
                    onClick={() => setOpenId(r.id)}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-input)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '' }}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button type="button" className="text-left hover:underline tabular-nums" style={{ color: 'var(--text-1)' }}
                        aria-label={`Call ${r.id} at ${istStamp(r.ts)}: open details`}
                        onClick={e => { e.stopPropagation(); setOpenId(r.id) }}>
                        {istShort(r.ts)}
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{taskLabel(r.task, r.task_label)}</td>
                    <td className="px-3 py-2 max-w-[280px]">
                      {r.provider || r.model ? (
                        <span className="block truncate" title={`${labels[r.provider] || r.provider || ''} · ${r.model || ''}`}>
                          <span style={{ color: 'var(--text-1)' }}>{labels[r.provider] || r.provider || '—'}</span>
                          <span style={{ color: 'var(--text-3)' }}> · </span>
                          <span className="font-mono" style={{ color: 'var(--text-2)' }}>{r.model || '—'}</span>
                        </span>
                      ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} />
                      {r.why && <span className="block mt-1 text-[11px] leading-snug max-w-[260px]" style={{ color: 'var(--text-3)' }}>{r.why}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-2)' }}>{tokens(r.prompt_tokens, r.answer_tokens)}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-2)' }}>{ms(r.latency_ms)}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--text-3)' }} title={r.user_email || ''}>{r.user_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="px-4 pb-3">
            <Pager total={data.total || 0} limit={PAGE_SIZE} offset={offset} onPage={setOffset} />
          </div>
        )}
      </section>

      {openId != null && (
        <CallDetailModal id={openId} labels={labels} taskLabel={taskLabel} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

function TotalsRow({ label, row, strong = false }) {
  const cell = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'
  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: strong ? 'var(--bg-2)' : undefined }}>
      <th scope="row" className={`px-3 py-2 text-left whitespace-nowrap ${strong ? 'font-semibold' : 'font-normal'}`}
        style={{ color: 'var(--text-1)' }}>{label}</th>
      <td className={cell} style={{ color: 'var(--text-1)', fontWeight: strong ? 600 : 400 }}>{num(row.requests ?? 0)}</td>
      <td className={cell} style={{ color: 'var(--text-2)' }}>{num(row.answered ?? 0)}</td>
      <td className={cell} style={{ color: row.failed ? 'var(--fin-negative)' : 'var(--text-3)' }}>{num(row.failed ?? 0)}</td>
      <td className={cell} style={{ color: row.not_sent ? 'var(--fin-warning)' : 'var(--text-3)' }}>{num(row.not_sent ?? 0)}</td>
      <td className={cell} style={{ color: 'var(--text-2)' }}>{tokens(row.tokens_in, row.tokens_out)}</td>
      <td className={cell} style={{ color: 'var(--text-2)' }}>{ms(row.avg_ms)}</td>
    </tr>
  )
}

function KV({ k, children, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{k}</dt>
      <dd className={`text-xs mt-0.5 break-words ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--text-1)' }}>{children}</dd>
    </div>
  )
}

function CallDetailModal({ id, labels, taskLabel, onClose }) {
  const [row, setRow] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.admin.aiGateway.call(id)
      .then(res => { if (alive) setRow(res) })
      .catch(e => { if (alive) setError(e.message || 'Could not load this call') })
    return () => { alive = false }
  }, [id])

  const extra = row?.extra && typeof row.extra === 'object' && Object.keys(row.extra).length ? row.extra : null

  return (
    <Modal open onClose={onClose} title={`Call ${id}`} subtitle={row ? istStamp(row.ts) : undefined} width={640}
      footer={<button type="button" className="btn-ghost" onClick={onClose}>Close</button>}>
      {error ? <Err msg={error} /> : !row ? <Skeleton rows={5} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <KV k="Time (IST)">{istStamp(row.ts)}</KV>
            <KV k="Task">{taskLabel(row.task, row.task_label)}</KV>
            <KV k="Status"><StatusPill status={row.status} /></KV>
            <KV k="Provider">{labels[row.provider] || row.provider || '—'}</KV>
            <KV k="Model" mono>{row.model || '—'}</KV>
            <KV k="HTTP status">{row.http_status ? statusBadge(row.http_status) : '—'}</KV>
            <KV k="Attempt">{row.attempt ?? '—'}</KV>
            <KV k="Time">{ms(row.latency_ms)}</KV>
            <KV k="Tokens in / out">{tokens(row.prompt_tokens, row.answer_tokens)}</KV>
            <KV k="User">{row.user_email || '—'}</KV>
            <KV k="Endpoint" mono>{row.endpoint || '—'}</KV>
            <KV k="Request ID" mono>{row.request_id || '—'}</KV>
            <KV k="Session ID" mono>{row.session_id || '—'}</KV>
          </dl>
          {row.why && <Notice tone={row.status === 'not_sent' ? 'warn' : 'error'}><strong>Why: </strong>{row.why}</Notice>}
          {row.error && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Error</p>
              <pre className="text-xs whitespace-pre-wrap break-words rounded-lg border p-3"
                style={{ background: 'var(--fin-neg-bg)', borderColor: 'var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
                {row.error}
              </pre>
            </div>
          )}
          {extra && (
            <details className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                Raw details
              </summary>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words px-3 pb-3" style={{ color: 'var(--text-2)' }}>
                {JSON.stringify(extra, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  )
}

const rateColor = (r) => (r == null ? 'var(--text-3)' : r >= 0.95 ? 'var(--fin-positive)' : r >= 0.8 ? 'var(--fin-warning)' : 'var(--fin-negative)')

// Per model: requests, success rate, median and p95 latency of answered
// calls, and the last failure in plain words.
function ModelStats({ labels, onPick }) {
  const uid = useDomId()
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setError(null)
    api.admin.aiGateway.modelStats(days)
      .then(res => { if (alive) setData(res) })
      .catch(e => { if (alive) setError(e.message || 'Could not load the model statistics') })
    return () => { alive = false }
  }, [days])

  const models = data?.models || []
  return (
    <section className="card space-y-3" aria-labelledby={`${uid}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${uid}-title`} className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Models</h3>
        <div role="group" aria-label="Model statistics period" className="inline-flex gap-1 p-1 rounded-xl"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {STAT_DAYS.map(([d, label]) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              aria-label={`Model statistics: ${label.toLowerCase()}`}
              className="px-3 py-1 rounded-lg text-xs font-medium"
              style={days === d
                ? { background: 'var(--card-bg)', color: 'var(--text-1)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-3)', background: 'transparent' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : !data ? <Skeleton rows={3} /> : !models.length ? (
        <Empty label="No model calls in this period." />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs">
            <caption className="sr-only">Success rate and latency per model</caption>
            <thead>
              <tr style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                {['Provider · model', 'Requests', 'Success', 'Median', 'p95', 'Last failure'].map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-2 font-semibold whitespace-nowrap ${i && i < 5 ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--text-2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={`${m.provider}|${m.model}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <th scope="row" className="px-3 py-2 text-left font-normal max-w-[260px]">
                    <span className="block truncate" title={m.model}>
                      <span style={{ color: 'var(--text-1)' }}>{labels[m.provider] || m.provider || '—'}</span>
                      <span style={{ color: 'var(--text-3)' }}> · </span>
                      <span className="font-mono" style={{ color: 'var(--text-2)' }}>{m.label || m.model}</span>
                    </span>
                    {m.benched && <span className="block text-[11px]" style={{ color: 'var(--fin-warning)' }}>{m.benched}</span>}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{num(m.requests)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="tabular-nums" style={{ color: rateColor(m.success_rate) }}>
                        {m.success_rate == null ? '—' : `${Math.round(m.success_rate * 1000) / 10}%`}
                      </span>
                      <span aria-hidden="true" className="hidden sm:inline-block h-1.5 w-12 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        <span className="block h-full" style={{ width: `${Math.round((m.success_rate || 0) * 100)}%`, background: rateColor(m.success_rate) }} />
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{ms(m.p50_ms)}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{ms(m.p95_ms)}</td>
                  <td className="px-3 py-2 min-w-[200px]">
                    {m.why ? (
                      <button type="button" className="text-left hover:underline" style={{ color: 'var(--text-2)' }}
                        onClick={() => onPick(m.provider, m.model)} aria-label={`Show failed calls to ${m.model}`}>
                        {m.why}
                      </button>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
