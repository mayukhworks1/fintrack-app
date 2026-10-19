/**
 * "Your database, your cloud", drawn out.
 *
 * It replaces a white-label section that described brand colours, custom
 * domains and invoice prefixes the product has no settings for. What the
 * repository does support is narrower and more useful: the backend is one
 * container, and everything it connects to — the database, the mail sender,
 * file storage, the base it mirrors — is read from its environment
 * (backend/app/config.py). So a dedicated instance is the same build with a
 * different environment file, and it keeps receiving the same fixes.
 *
 * One build at the top, two homes under it, identical except for whose each
 * setting points at. The lines draw once and the dedicated column's settings
 * light in order; under reduced motion it is simply drawn.
 */
import { Container, Database, Mail, HardDrive, GitBranch, ShieldCheck } from 'lucide-react'
import { useReveal } from '../../hooks/useReveal'

const SETTINGS = [
  [Database, 'Database'],
  [Mail, 'Mail sender'],
  [HardDrive, 'File storage'],
  [GitBranch, 'Source base'],
]

const FACTS = [
  ['A container and an environment file', 'The backend is one container. Every endpoint, table, model, mail server and storage target is read from its environment.'],
  ['Your Postgres, on your cloud', 'Point the database, the mail sender and file storage at your own, inside your own private cloud.'],
  ['The same build, not a fork', 'A dedicated instance runs the same code as everyone else, so it keeps receiving the same fixes and features.'],
  ['The same permission model', 'Roles, per-person overrides and the request log work exactly as they do here.'],
]

function Home({ title, sub, mine }) {
  return (
    <div className="ft-s-home" data-mine={mine ? '' : undefined}>
      <span className="ft-s-home-title">{title}</span>
      <span className="ft-s-home-sub">{sub}</span>
      <ul className={mine ? 'ft-m-seq' : undefined}>
        {SETTINGS.map(([Icon, label], i) => (
          <li key={label} style={{ '--i': i + 3 }}>
            <Icon size={13} aria-hidden="true" />
            <span>{label}</span>
            <b>{mine ? 'yours' : 'ours'}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function DedicatedInstance() {
  const ref = useReveal({ threshold: 0.25 })
  return (
    <div ref={ref} className="ft-s-inst" data-hold="">
      <ul className="ft-s-inst-facts ft-m-seq">
        {FACTS.map(([title, body], i) => (
          <li key={title} style={{ '--i': i }}>
            <b>{title}</b>
            <span>{body}</span>
          </li>
        ))}
      </ul>

      <figure className="ft-s-inst-fig">
        <div className="ft-s-build ft-m-pop">
          <Container size={16} aria-hidden="true" />
          <span><b>One build</b> the same container image</span>
        </div>
        <div className="ft-s-inst-lines" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="ft-s-homes">
          <Home title="Shared" sub="our cloud" />
          <Home title="Dedicated" sub="your cloud" mine />
        </div>
        <figcaption>
          <ShieldCheck size={14} aria-hidden="true" />
          Only the environment differs. Nothing here is a fork that drifts away from the product.
        </figcaption>
      </figure>
    </div>
  )
}
