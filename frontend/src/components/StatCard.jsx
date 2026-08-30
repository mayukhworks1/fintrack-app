import { formatPct } from '../utils/format'
import { useTilt } from '../hooks/useTilt'

/**
 * Neutral stat card. Accent is applied only to the value via semantic prop
 * ('positive' | 'warning' | 'negative') — icon container stays neutral.
 */
export default function StatCard({ label, value, sub, icon: Icon, accent, trend }) {
  // Depth on the tile, not on any figure it carries — see hooks/useTilt.
  const tilt = useTilt({ max: 6 })
  const accentColor =
    accent === 'positive' ? '#22c55e'
    : accent === 'warning' ? '#fbbf24'
    : accent === 'negative' ? '#f87171'
    : 'var(--text-1)'
  return (
    <div ref={tilt} className="card tilt tilt-sheen animate-slide-up p-3 sm:p-5">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <Icon size={16} style={{ color: 'var(--text-2)' }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-0.5"
            style={{ color: 'var(--text-3)' }}>
            {label}
          </p>
          <p className="font-semibold tabular-nums break-words leading-tight"
            style={{
              fontSize: 'clamp(1.05rem, 3vw, 1.375rem)',
              color: accentColor,
              wordBreak: 'break-word',
            }}>
            {value}
          </p>
          {sub && <p className="text-[10px] sm:text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
          {trend != null && Number.isFinite(trend) && (
            <p className="text-[10px] sm:text-xs mt-1 font-semibold flex items-center gap-1 tabular-nums"
              style={{ color: trend >= 0 ? '#22c55e' : '#f87171' }}>
              {trend >= 0 ? '↑' : '↓'} {formatPct(Math.abs(trend), 2)} avg profit
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
