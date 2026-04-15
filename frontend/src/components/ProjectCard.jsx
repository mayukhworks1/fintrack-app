import { useNavigate } from 'react-router-dom'
import { Calendar, Users, TrendingUp, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

function StatusBadge({ status }) {
  if (!status) return null
  if (status.includes('Active')) return <span className="badge-active">{status}</span>
  if (status.includes('Completed')) return <span className="badge-completed">{status}</span>
  if (status.includes('Hold')) return <span className="badge-hold">{status}</span>
  return <span className="badge-cancelled">{status}</span>
}

function HealthDot({ health }) {
  if (!health) return null
  const map = {
    '🟢': 'bg-green-400',
    '🟡': 'bg-yellow-400',
    '🔴': 'bg-red-400',
  }
  const emoji = health.slice(0, 2)
  const color = map[emoji] || 'bg-gray-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className={clsx('w-2 h-2 rounded-full', color)} />
      <span className="text-xs text-gray-400">{health.replace(/^[\u{1F7E0}-\u{1F7E5}]\s*/u, '')}</span>
    </div>
  )
}

export default function ProjectCard({ record, onDelete }) {
  const navigate = useNavigate()
  const f = record?.fields || {}
  const profitPct = parseFloat(f['Profit percentage'] || 0)
  const billed = parseFloat(f['Amount Billed So far'] || 0)

  return (
    <div
      className="card cursor-pointer hover:border-brand-500/50 transition-colors group"
      onClick={() => navigate(`/projects/${record.id}`)}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate">{f['Project Name'] || '—'}</h3>
          <p className="text-sm text-gray-400">{f['Client'] || '—'}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={f['Project Status']} />
          <ChevronRight size={16} className="text-gray-600 group-hover:text-brand-400 transition-colors" />
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <HealthDot health={f['Health']} />
        <div className="flex items-center gap-4 text-xs text-gray-500">
          {f['Resource Count'] && (
            <span className="flex items-center gap-1">
              <Users size={11} /> {f['Resource Count']} resource{f['Resource Count'] > 1 ? 's' : ''}
            </span>
          )}
          {f['Duration (Months)'] && (
            <span className="flex items-center gap-1">
              <Calendar size={11} /> {f['Duration (Months)']} mo
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-surface-700 pt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-gray-500">Billed</p>
          <p className="font-semibold text-white text-sm">
            ₹{billed.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Profit</p>
          <p className={clsx('font-semibold text-sm flex items-center gap-1', profitPct >= 0 ? 'text-brand-400' : 'text-red-400')}>
            <TrendingUp size={12} /> {profitPct.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  )
}
