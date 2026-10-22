/**
 * Four facts about the software, each with a small mark that plays once.
 *
 * These describe the product, not anyone's workspace, and each is backed by
 * the code: eleven modules (MODULES), eight roles (the seeded role table:
 * Super Admin, Admin, Manager, Finance, Web Invoice Admin, Web Invoice User,
 * User, Viewer), an incremental sync every 30 seconds behind the webhook path,
 * and an analyst whose model picks a measure and a grouping while the code
 * writes the SQL. The last one is a zero, so it does not count up.
 *
 * The marks: the module icons pop into place, the role chips rise in order,
 * the 30-second ring draws once, and nothing loops.
 */
import { MODULES } from '../../content/publicContent'
import RollNumber from '../motion/RollNumber'
import { useReveal } from '../../hooks/useReveal'

export const ROLES = [
  'Super Admin', 'Admin', 'Manager', 'Finance',
  'Web Invoice Admin', 'Web Invoice User', 'User', 'Viewer',
]

const seconds = (n) => `${n} s`

function Fact({ value, format, label, sub, mark, still = false }) {
  return (
    <div className="ft-h-fact">
      <div className="ft-h-fact-mark" aria-hidden="true">{mark}</div>
      <p className="ft-h-fact-v ft-h-fig">
        {still ? <span className="tabular-nums">{format ? format(value) : value}</span>
               : <RollNumber value={value} format={format} align="start" />}
      </p>
      <p className="ft-h-fact-k">{label}</p>
      <p className="ft-h-fact-s">{sub}</p>
    </div>
  )
}

export default function Facts() {
  const ref = useReveal({ threshold: 0.2 })
  return (
    <div ref={ref} className="ft-h-facts" data-hold="">
      <Fact
        value={MODULES.length}
        label="Modules"
        sub="receivables to audit"
        mark={
          <span className="ft-h-mark-icons">
            {MODULES.map(({ icon: Icon, title }, i) => (
              <span key={title} className="ft-m-pop" style={{ '--d': `${i * 45}ms` }}><Icon size={12} /></span>
            ))}
          </span>
        }
      />
      <Fact
        value={ROLES.length}
        label="Permission roles"
        sub="each overridable per person"
        mark={
          <span className="ft-h-mark-roles ft-m-seq">
            {ROLES.map((r, i) => <span key={r} style={{ '--i': i }} title={r} />)}
          </span>
        }
      />
      <Fact
        value={30}
        format={seconds}
        label="Incremental sync"
        sub="behind instant webhooks"
        mark={
          <svg className="ft-h-mark-ring" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" className="ft-h-ring-track" />
            <circle cx="20" cy="20" r="16" pathLength="1" className="ft-h-ring ft-m-draw" />
            <path d="M20 11 V20 L26 23" className="ft-h-ring-hand" />
          </svg>
        }
      />
      <Fact
        still
        value={0}
        label="Lines of SQL written by the model"
        sub="it picks a measure and a grouping; the code writes the query"
        mark={<span className="font-mono text-[11px] font-bold text-[var(--text-3)]"><s className="text-[var(--bad)]">SQL</s> model · <b className="text-[var(--ok)]">SQL</b> code</span>}
      />
    </div>
  )
}
