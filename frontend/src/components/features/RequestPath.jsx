/**
 * What every signed-in request passes through, in order — the path in
 * backend/app/routers/deps.py.
 *
 *   1  Session    the session row for the token is looked up; a revoked or
 *                 expired one is refused there (401 "Session has been revoked")
 *   2  Permission role defaults, then that person's own grants and revocations
 *   3  Row scope  the account's scope goes into the SQL as it is compiled
 *   4  Response
 *   A  Audit      the request is queued and written by a background worker,
 *                 off the request path
 *
 * The rail fills stop by stop once, when it is first reached, and each stop
 * lands as the fill arrives. Under reduced motion it is drawn complete.
 */
import { useReveal } from '../../hooks/useReveal'

export const STOPS = [
  { n: '1', title: 'Session', body: 'The session row behind the token is looked up on every request.',
    short: 'Looked up on every request', deny: 'Revoked or expired: 401, refused here' },
  { n: '2', title: 'Permission', body: 'Role defaults, then this person’s own grants and revocations.',
    short: 'Role defaults, then per-person overrides' },
  { n: '3', title: 'Row scope', body: 'The account’s scope is compiled into the SQL, not filtered on screen.',
    short: 'Compiled into the SQL' },
  { n: '4', title: 'Response', body: 'Only what the three checks allowed.', short: 'Only what passed' },
]

export default function RequestPath() {
  const ref = useReveal({ threshold: 0.3 })
  return (
    <figure ref={ref} className="ft-f-path">
      <p className="ft-f-path-in"><span>Request</span> with a session token</p>
      <ol className="ft-f-path-list">
        {STOPS.map((s, i) => (
          <li key={s.n} style={{ '--i': i }}>
            <span className="ft-f-path-n" aria-hidden="true">{s.n}</span>
            <div>
              <b>{s.title}</b>
              <span className="is-long">{s.body}</span>
              <span className="is-short">{s.short}</span>
              {s.deny && <em>{s.deny}</em>}
            </div>
          </li>
        ))}
      </ol>
      <p className="ft-f-path-side" style={{ '--i': 4 }}>
        <span className="ft-f-path-n" data-side="" aria-hidden="true">A</span>
        <span>
          <b>Audit</b>
          <span className="is-long">Queued as the response leaves and written by a background worker, so recording never slows the request.</span>
          <span className="is-short">Written off the request path</span>
        </span>
      </p>
      <figcaption className="sr-only">
        Every request: 1, the session is checked and a revoked one is refused; 2, permissions; 3, row
        scope compiled into the query; 4, the response. The audit record is written off the request path.
      </figcaption>
    </figure>
  )
}
