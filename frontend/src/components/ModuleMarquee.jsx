/**
 * ModuleMarquee — two rows of the product's modules drifting past in opposite
 * directions. Hover or focus pauses it; under reduced motion it is a still,
 * wrapped list. Each row is rendered twice so the loop has no seam; the copy
 * is hidden from assistive tech so the list is read once.
 */
import { Link } from 'react-router-dom'
import { MODULES } from '../content/publicContent'

function Row({ items, reverse }) {
  const chip = (m, hidden) => {
    const Icon = m.icon
    return (
      <li key={`${m.title}${hidden ? '-dup' : ''}`} aria-hidden={hidden || undefined} className="ft-marquee-chip">
        <Icon size={15} aria-hidden="true" />
        <span>{m.title}</span>
      </li>
    )
  }
  return (
    <div className="ft-marquee-row" data-reverse={reverse ? '' : undefined}>
      <ul className="ft-marquee-track">
        {items.map(m => chip(m, false))}
        {items.map(m => chip(m, true))}
      </ul>
    </div>
  )
}

export default function ModuleMarquee() {
  const half = Math.ceil(MODULES.length / 2)
  return (
    <Link to="/features" className="ft-marquee" aria-label="All FinTrack modules — see features">
      <Row items={MODULES.slice(0, half)} />
      <Row items={MODULES.slice(half)} reverse />
    </Link>
  )
}
