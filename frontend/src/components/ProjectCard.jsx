import { useNavigate } from 'react-router-dom'
import { Calendar, Users, TrendingUp, TrendingDown, ChevronRight, AlertTriangle, Activity, ReceiptText } from 'lucide-react'
import { formatInr, formatPct } from '../utils/format'

function StatusBadge({ status }) {
  if (!status) return null
  if (status.includes('Active'))    return <span className="badge-active">{status}</span>
  if (status.includes('Completed')) return <span className="badge-completed">{status}</span>
  if (status.includes('Hold'))      return <span className="badge-hold">{status}</span>
  return <span className="badge-cancelled">{status}</span>
}

function SignalBadge({ signal, override }) {
  const severity = override || signal?.severity || 'muted'
  const palette = severity === 'danger'
    ? { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)' }
    : severity === 'warning'
      ? { color: 'var(--fin-warning)', bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)' }
      : severity === 'positive'
        ? { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)' }
        : { color: 'var(--text-2)', bg: 'var(--bg-input)', border: 'var(--border)' }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold"
      style={{ color: palette.color, background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.color }} />
      {signal?.title || 'Project signal'}
    </span>
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
  const negativeMargin = profitPct < 0
  const health = f['Health'] || 'Not tracked'
  const projectStatus = f['Project Status'] || 'Unknown'
  const primarySignal = negativeMargin
    ? {
        severity: 'danger',
        title: 'Negative margin',
        detail: `${formatPct(profitPct, 2)} margin on ${formatInr(billed)} billed so far.`,
      }
    : {
        severity: health === 'At Risk' ? 'warning' : health === 'Critical' ? 'danger' : 'positive',
        title: health,
        detail: `${projectStatus} project with ${formatInr(billed)} billed so far.`,
      }
  const SignalIcon = negativeMargin || health === 'Critical'
    ? AlertTriangle
    : health === 'At Risk'
      ? Activity
      : ReceiptText

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
          <ChevronRight size={14}
            className="transition-all group-hover:translate-x-0.5"
            style={{ color: 'var(--text-3)' }} />
        </div>
      </div>

      {/* Primary signal */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <SignalBadge signal={primarySignal} override={primarySignal?.severity} />
          {SignalIcon && (
            <SignalIcon size={13} style={{ color: primarySignal?.severity === 'danger' ? 'var(--fin-negative)' : primarySignal?.severity === 'warning' ? 'var(--fin-warning)' : 'var(--text-3)' }} />
          )}
        </div>
        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>
          {primarySignal?.detail || 'Project health and billing summary is based on the live project record.'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Target</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: target > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>
            {target > 0 ? formatInr(target) : '—'}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Progress</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: targetPct >= 100 ? 'var(--fin-positive)' : 'var(--text-1)' }}>
            {target > 0 ? formatPct(targetPct, 1) : '—'}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Health</p>
          <p className="text-xs font-bold tabular-nums truncate" style={{ color: health === 'Critical' ? 'var(--fin-negative)' : health === 'At Risk' ? 'var(--fin-warning)' : 'var(--text-1)' }}>
            {health}
          </p>
        </div>
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
            <span style={{ color: targetPct >= 100 ? 'var(--fin-positive)' : 'var(--text-2)' }}>{formatPct(targetPct, 1)}</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${targetPct}%`,
                background: targetPct >= 100 ? 'var(--fin-positive)' : 'var(--accent)',
              }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-end justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>Billed</p>
          <p className="font-bold text-sm tabular-nums break-words" style={{ color: 'var(--text-1)' }}>
            {formatInr(billed)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>
            Margin
          </p>
          <p className="font-bold text-sm flex items-center gap-1 tabular-nums"
            style={{ color: isProfit ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
            {isProfit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {formatPct(profitPct, 2)}
          </p>
        </div>
      </div>
    </article>
  )
}
