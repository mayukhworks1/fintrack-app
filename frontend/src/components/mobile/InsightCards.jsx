/**
 * Insight cards on the phone screens (≤640px): a short, swipeable row of
 * plain-language findings ("2 invoices overdue over 45 days · ₹4,65,600"),
 * each with one tap to the list that shows them.
 *
 * The findings and the summary cards' series come from GET /api/insights
 * (fixed rules over the mirrors, ranked on the server). A card dismissed here
 * stays hidden for the rest of that day, on this device (localStorage).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, TrendingUp, TrendingDown, Info, X, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../services/api'

export const MAX_INSIGHT_CARDS = 3
export const DISMISS_KEY = 'fintrack-insights-dismissed'

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Card ids dismissed today; yesterday's list counts for nothing. */
export function dismissedToday(today = new Date()) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || 'null')
    return raw && raw.day === isoDay(today) && Array.isArray(raw.ids) ? raw.ids : []
  } catch {
    return []
  }
}

/** Hide card `id` until the end of today. */
export function dismissForToday(id, today = new Date()) {
  const ids = [...new Set([...dismissedToday(today), id])]
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: isoDay(today), ids }))
  } catch { /* private mode: hidden for this visit only */ }
  return ids
}

/** GET /api/insights for `scope`: { cards, charts, today } or null while loading. */
export function useInsights(scope, { enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    api.insights.cards(scope)
      .then(d => { if (live) { setData(d || { cards: [] }); setError(null) } })
      .catch(e => { if (live) { setData({ cards: [] }); setError(e?.message || 'Insights are unavailable') } })
    return () => { live = false }
  }, [scope, enabled])
  return { data, error }
}

const TONE_ICON = {
  negative: AlertTriangle,
  warning: CalendarClock,
  positive: TrendingUp,
  info: Info,
}

function InsightCard({ card, onAction, onDismiss }) {
  const Icon = card.rule === 'collections_trend' && card.tone !== 'positive' ? TrendingDown : TONE_ICON[card.tone] || Info
  return (
    <li className={clsx('m-insight', `is-${card.tone || 'info'}`)}>
      <div className="m-insight-top">
        <span className="m-insight-icon" aria-hidden="true"><Icon size={16} /></span>
        <button type="button" className="m-insight-dismiss" onClick={() => onDismiss(card)}
          aria-label={`Hide “${card.title}” for today`}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="m-insight-title">
        {card.title}
        {card.value && <><span aria-hidden="true"> · </span><span className="m-insight-value">{card.value}</span></>}
      </p>
      {card.detail && <p className="m-insight-detail">{card.detail}</p>}
      {card.action?.href && (
        <button type="button" className="m-insight-action" onClick={() => onAction(card)}>
          {card.action.label || 'Open'}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      )}
    </li>
  )
}

/**
 * The row of cards. `cards` are the server's, best first; up to three that
 * were not dismissed today are shown. Nothing renders when none are left.
 */
export default function InsightCards({ cards, label = 'Insights' }) {
  const navigate = useNavigate()
  const [hidden, setHidden] = useState(() => dismissedToday())
  const shown = (cards || []).filter(c => !hidden.includes(c.id)).slice(0, MAX_INSIGHT_CARDS)
  const onDismiss = useCallback((card) => setHidden(dismissForToday(card.id)), [])
  const onAction = useCallback((card) => navigate(card.action.href), [navigate])
  if (!shown.length) return null
  return (
    <section className="m-insights" aria-label={label}>
      <ul className={clsx('m-insights-row', shown.length === 1 && 'is-single')} role="list">
        {shown.map(c => <InsightCard key={c.id} card={c} onAction={onAction} onDismiss={onDismiss} />)}
      </ul>
    </section>
  )
}
