import { useNavigate } from 'react-router-dom'
import { Calendar, Users, TrendingUp, TrendingDown, ChevronRight, Activity } from 'lucide-react'
import clsx from 'clsx'

function StatusBadge({ status }) {
  if (!status) return null
  if (status.includes('Active'))    return <span className="badge-active"    aria-label={`Status: ${status}`}>{status}</span>
  if (status.includes('Completed')) return <span className="badge-completed" aria-label={`Status: ${status}`}>{status}</span>
  if (status.includes('Hold'))      return <span className="badge-hold"      aria-label={`Status: ${status}`}>{status}</span>
  return                                   <span className="badge-cancelled" aria-label={`Status: ${status}`}>{status}</span>
}

function HealthBadge({ health }) {
  if (!health) return null
  const isGood    = health.includes('🟢')
  const isWarning = health.includes('🟡')
  const color = isGood ? 'bg-green-400' : isWarning ? 'bg-yellow-400' : 'bg-red-400'
  const label = health.replace(/^\p{Emoji}\s*/u, '') || health
  return (
    <div className="flex items-center gap-1.5" aria-label={`Health: ${label}`}>
      <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', color)} aria-hidden="true" />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  )
}

export default function ProjectCard({ record }) {
  const navigate = useNavigate()
  const f = record?.fields || {}
  const profitPct = parseFloat(f['Profit percentage'] || 0)
  const billed    = parseFloat(f['Amount Billed So far'] || 0)
  const isProfit  = profitPct >= 0

  return (
    <article
      className="card card-hover group animate-fade-in"
      onClick={() => navigate(`/projects/${record.id}`)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(`/projects/${record.id}`)}
      tabIndex={0}
      role="button"
      aria-label={`${f['Project Name'] || 'Project'} by ${f['Client'] || 'Unknown'} — click to view details`}
    >
      {/* Top */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate">{f['Project Name'] || '—'}</h3>
          <p className="text-sm text-gray-400 truncate">{f['Client'] || '—'}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusBadge status={f['Project Status']} />
          <ChevronRight size={15} className="text-gray-600 group-hover:text-brand-400 transition-colors" aria-hidden="true" />
        </div>
      </div>

      {/* Health + meta */}
      <div className="space-y-1.5 mb-4">
        <HealthBadge health={f['Health']} />
        <div className="flex items-center gap-4 text-xs text-gray-500">
          {f['Resource Count'] && (
            <span className="flex items-center gap-1">
              <Users size={11} aria-hidden="true" />
              {f['Resource Count']} resource{f['Resource Count'] > 1 ? 's' : ''}
            </span>
          )}
          {f['Duration (Months)'] && (
            <span className="flex items-center gap-1">
              <Calendar size={11} aria-hidden="true" />
              {f['Duration (Months)']} mo
            </span>
          )}
          {f['Target Achieved '] != null && (
            <span className={clsx('flex items-center gap-1', f['Target Achieved '] ? 'text-green-400' : 'text-gray-600')}>
              <Activity size={11} aria-hidden="true" />
              {f['Target Achieved '] ? 'On target' : 'Off target'}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-surface-700 pt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-gray-500">Billed</p>
          <p className="font-semibold text-white text-sm tabular-nums">
            ₹{billed.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Profit</p>
          <p className={clsx('font-semibold text-sm flex items-center gap-1 tabular-nums', isProfit ? 'text-brand-400' : 'text-red-400')}>
            {isProfit
              ? <TrendingUp size={12} aria-hidden="true" />
              : <TrendingDown size={12} aria-hidden="true" />}
            {profitPct.toFixed(1)}%
          </p>
        </div>
      </div>
    </article>
  )
}
