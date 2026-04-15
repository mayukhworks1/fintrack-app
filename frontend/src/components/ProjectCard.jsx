import { useNavigate } from 'react-router-dom'
import { Calendar, Users, TrendingUp, TrendingDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

function StatusBadge({ status }) {
  if (!status) return null
  if (status.includes('Active'))    return <span className="badge-active">{status}</span>
  if (status.includes('Completed')) return <span className="badge-completed">{status}</span>
  if (status.includes('Hold'))      return <span className="badge-hold">{status}</span>
  return <span className="badge-cancelled">{status}</span>
}

function HealthBar({ health, profitPct }) {
  if (!health) return null
  const isGood    = health.includes('🟢')
  const isWarning = health.includes('🟡')
  const color  = isGood ? '#4ade80' : isWarning ? '#facc15' : '#f87171'
  const width  = Math.min(Math.max((profitPct / 40) * 100, 5), 100)
  const label  = health.replace(/^\p{Emoji}\s*/u, '') || health
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color }}>● {label}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }} />
      </div>
    </div>
  )
}

export default function ProjectCard({ record }) {
  const navigate   = useNavigate()
  const f          = record?.fields || {}
  const profitPct  = parseFloat(f['Profit percentage'] || 0)
  const billed     = parseFloat(f['Amount Billed So far'] || 0)
  const target     = parseFloat(f['Target Revenue'] || 0)
  const targetPct  = target > 0 ? Math.min((billed / target) * 100, 100) : 0
  const isProfit   = profitPct >= 0

  return (
    <article
      className="card-hover group animate-slide-up"
      onClick={() => navigate(`/projects/${record.id}`)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && navigate(`/projects/${record.id}`)}
      tabIndex={0} role="button"
      aria-label={`${f['Project Name']} — click for details`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-bold text-sm truncate" style={{ color: 'var(--text-1)' }}>{f['Project Name'] || '—'}</h3>
          <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{f['Client'] || '—'}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusBadge status={f['Project Status']} />
          <ChevronRight size={14} style={{ color: 'var(--text-3)' }}
            className="group-hover:translate-x-0.5 group-hover:text-brand-400 transition-all" />
        </div>
      </div>

      {/* Health */}
      <div className="mb-4">
        <HealthBar health={f['Health']} profitPct={profitPct} />
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 mb-4 text-xs" style={{ color: 'var(--text-3)' }}>
        {f['Resource Count'] && (
          <span className="flex items-center gap-1"><Users size={11} />{f['Resource Count']} res.</span>
        )}
        {f['Duration (Months)'] && (
          <span className="flex items-center gap-1"><Calendar size={11} />{f['Duration (Months)']} mo</span>
        )}
      </div>

      {/* Target progress */}
      {target > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-3)' }}>
            <span>Target progress</span>
            <span style={{ color: targetPct >= 100 ? '#4ade80' : 'var(--text-2)' }}>{targetPct.toFixed(0)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${targetPct}%`,
                background: targetPct >= 100
                  ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                  : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-end justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>Billed</p>
          <p className="font-bold text-sm tabular-nums" style={{ color: 'var(--text-1)' }}>
            ₹{billed.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>Profit</p>
          <p className="font-bold text-sm flex items-center gap-1 tabular-nums"
            style={{ color: isProfit ? '#4ade80' : '#f87171' }}>
            {isProfit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {profitPct.toFixed(1)}%
          </p>
        </div>
      </div>
    </article>
  )
}
