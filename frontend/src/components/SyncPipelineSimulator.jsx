/**
 * How a change in your base reaches the mirror, one sample event at a time.
 *
 * Everything here mirrors backend/app/db/sync.py and routers/webhooks.py:
 *
 *   - three routes feed the mirror: a webhook the base sends when a record
 *     changes, an incremental pass every 30 seconds (the 200 most recently
 *     modified records per table), and a full pass every 5 minutes (every
 *     record, which is how a deletion is noticed);
 *   - all three end in the same comparison against the stored row, so the
 *     result does not depend on which route arrived first;
 *   - a copy whose lastModifiedTime is older than the stored one is left
 *     alone, which is what stops a late webhook undoing a newer save;
 *   - a record missing from the full pass is marked deleted, not removed, so
 *     its history survives.
 *
 * The invoice is from the sandbox ledger (demoData) and nothing is sent
 * anywhere. Pressing an event runs it: a marker crosses the four stages and
 * each one lights as it is reached, then the statement and the history line
 * appear. Under reduced motion the result is simply shown.
 */
import { useState } from 'react'
import { Database, Webhook, Timer, RefreshCw, GitCompareArrows, Server, History } from 'lucide-react'
import { useReveal } from '../hooks/useReveal'
import { useInk } from '../hooks/useInk'
import { INVOICES, inr } from './demoData'

const PAID = INVOICES.find(i => i.id === 'INV-2340') || INVOICES[0]
const GONE = INVOICES.find(i => i.id === 'INV-2308') || INVOICES[1]

const ROUTES = [
  { id: 'webhook', icon: Webhook, label: 'Webhook', when: 'on each change' },
  { id: 'incremental', icon: Timer, label: 'Incremental', when: 'every 30 s' },
  { id: 'full', icon: RefreshCw, label: 'Full pass', when: 'every 5 min' },
]

const EVENTS = [
  {
    id: 'paid',
    label: 'An invoice is marked paid',
    inv: PAID,
    change: ['Payment Status', 'Sent', 'Paid'],
    route: 'webhook',
    routeNote: 'The base posts the changed record as soon as it is saved.',
    check: 'Fields differ from the stored row',
    outcome: 'Row updated',
    tone: 'ok',
    row: 'Paid',
    sql: 'UPDATE invoices_mirror\n   SET synced_at = NOW(), deleted_at = NULL,\n       fields = $1::jsonb, payment_status = $2, …\n WHERE teable_id = $9',
    history: 'Change history gets one line: Payment Status, Sent → Paid.',
  },
  {
    id: 'late',
    label: 'An older copy arrives late',
    inv: PAID,
    change: ['Payment Status', 'Paid', 'Sent'],
    route: 'incremental',
    routeNote: 'The 30-second pass picks up a copy taken before the save.',
    check: 'This copy is older than the stored row',
    outcome: 'Left alone',
    tone: 'hold',
    row: 'Paid',
    sql: '-- no statement: the copy\'s lastModifiedTime is\n-- earlier than the stored row\'s, so nothing is written',
    history: 'Nothing is written. A late copy cannot undo a newer save.',
  },
  {
    id: 'deleted',
    label: 'A record is deleted in the base',
    inv: GONE,
    change: ['Record', 'present', 'deleted'],
    route: 'full',
    routeNote: 'The 5-minute pass reads every record, so a missing one is noticed.',
    check: 'Missing from the full set of records',
    outcome: 'Marked deleted',
    tone: 'gone',
    row: 'Hidden from lists',
    sql: 'UPDATE invoices_mirror\n   SET synced_at = NOW(), deleted_at = NOW()\n WHERE teable_id = $1',
    history: 'The row is kept, so its change history still reads end to end.',
  },
]

const STAGES = [
  { icon: Database, label: 'Your base' },
  { icon: null, label: 'Route' },
  { icon: GitCompareArrows, label: 'Compared' },
  { icon: Server, label: 'Postgres mirror' },
]

export default function SyncPipelineSimulator() {
  const ref = useReveal({ threshold: 0.2 })
  const [at, setAt] = useState(0)
  const [run, setRun] = useState(0)
  const ink = useInk(at)
  const ev = EVENTS[at]
  const route = ROUTES.find(r => r.id === ev.route)
  const RouteIcon = route.icon

  const fire = (i) => { setAt(i); setRun(n => n + 1) }

  return (
    <div ref={ref} className="ft-s-sim" data-hold="">
      <div className="ft-s-sim-head">
        <p className="ft-s-kicker">Sample events · nothing is sent anywhere</p>
        <h3 className="ft-display">How a change in your base reaches the mirror</h3>
        <p>
          Three routes keep the mirror current, and all three end in the same
          comparison with the row already stored. Pick an event to run it.
        </p>
      </div>

      <div ref={ink} className="ft-m-ink ft-s-sim-events" role="group" aria-label="Sample events">
        {EVENTS.map((e, i) => (
          <button key={e.id} type="button" aria-pressed={i === at} onClick={() => fire(i)}>
            {e.label}
          </button>
        ))}
        <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
      </div>

      <ol className="ft-s-sim-flow" key={run}>
        {STAGES.map((s, i) => {
          const Icon = i === 1 ? RouteIcon : s.icon
          return (
            <li key={i} className="ft-s-sim-stage" style={{ '--i': i }}>
              <span className="ft-s-sim-step">
                <Icon size={14} aria-hidden="true" />
                {i + 1}. {i === 1 ? route.label : s.label}
              </span>
              {i === 0 && (
                <>
                  <span className="ft-s-sim-id">{ev.inv.id} · {ev.inv.client}</span>
                  <span className="ft-s-sim-change">
                    {ev.change[0]}: <s>{ev.change[1]}</s> → <b>{ev.change[2]}</b>
                  </span>
                </>
              )}
              {i === 1 && (
                <>
                  <span className="ft-s-sim-routes" aria-hidden="true">
                    {ROUTES.map(r => (
                      <span key={r.id} data-on={r.id === ev.route ? '' : undefined}>{r.when}</span>
                    ))}
                  </span>
                  <span className="ft-s-sim-note">{ev.routeNote}</span>
                </>
              )}
              {i === 2 && <span className="ft-s-sim-note ft-s-sim-check">{ev.check}</span>}
              {i === 3 && (
                <>
                  <span className="ft-s-sim-outcome" data-tone={ev.tone}>{ev.outcome}</span>
                  <span className="ft-s-sim-row" data-tone={ev.tone}>
                    <span>{ev.inv.id}</span>
                    <span className="tabular-nums">{inr(ev.inv.amount)}</span>
                    <span>{ev.row}</span>
                  </span>
                </>
              )}
              {i < 3 && <span className="ft-s-sim-link" aria-hidden="true"><i /></span>}
            </li>
          )
        })}
      </ol>

      <p className="sr-only" role="status">{run ? `${ev.label}: ${ev.outcome.toLowerCase()}.` : ''}</p>

      <div className="ft-s-sim-out" key={`o${run}`}>
        <pre className="ft-s-sim-sql"><code>{ev.sql}</code></pre>
        <p className="ft-s-sim-hist"><History size={14} aria-hidden="true" />{ev.history}</p>
      </div>
    </div>
  )
}
