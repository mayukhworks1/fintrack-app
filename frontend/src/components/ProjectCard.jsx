import { useNavigate } from 'react-router-dom'
import { Calendar, Users, TrendingUp, TrendingDown, ChevronRight, Link2, AlertTriangle, Activity, ReceiptText } from 'lucide-react'
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
      {signal?.title || 'Linked context'}
    </span>
  )
}

export default function ProjectCard({ record }) {
  const navigate   = useNavigate()
  const f          = record?.fields || {}
  const assoc      = record?.association
  const related    = assoc?.related_counts?.project || {}
  const insight    = assoc?.insights?.project
  const invoiceSummary = insight?.invoice_summary || {}
  const statusSummary = insight?.status_summary || {}
  const profitPct  = parseFloat(f['Profit percentage'] || 0)
  const billed     = parseFloat(f['Amount Billed So far'] || 0)
  const target     = parseFloat(f['Target Revenue'] || 0)
  const targetPct  = target > 0 ? Math.min((billed / target) * 100, 100) : 0
  const isProfit   = profitPct >= 0
  const outstanding = Number(invoiceSummary.outstanding_total || 0)
  const blockedCount = Number(statusSummary.blocked_count || 0)
  const pendingCount = Number(invoiceSummary.pending_count || 0)
  const overdueCount = Number(invoiceSummary.overdue_count || 0)
  const latestHeadline = statusSummary.latest_headline || statusSummary.latest_detail || ''
  const negativeMargin = profitPct < 0
  const primarySignal = negativeMargin
    ? {
        severity: 'danger',
        title: 'Negative margin',
        detail: `${formatPct(profitPct, 2)} margin on ${formatInr(billed)} billed so far.`,
      }
    : insight?.signal
  const SignalIcon = negativeMargin
    ? AlertTriangle
    : blockedCount > 0
      ? Activity
      : outstanding > 0
        ? ReceiptText
        : Activity

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
          {assoc?.project?.name && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--accent)' }}>
              <Link2 size={10} />
              {related.invoices || 0} invoice{(related.invoices || 0) !== 1 ? 's' : ''} · {related.status || 0} status
            </div>
          )}
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
          {primarySignal?.detail || latestHeadline || f['Health'] || 'No linked delivery or billing context yet.'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Open</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-1)' }}>
            {formatInr(outstanding)}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Aging</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: overdueCount > 0 ? 'var(--fin-negative)' : pendingCount > 0 ? 'var(--fin-warning)' : 'var(--text-1)' }}>
            {overdueCount > 0 ? `${overdueCount} overdue` : `${pendingCount} pending`}
          </p>
        </div>
        <div className="rounded-xl px-2.5 py-2" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Blocked</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: blockedCount > 0 ? 'var(--fin-negative)' : 'var(--text-1)' }}>
            {blockedCount}
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
            {statusSummary.latest_status ? 'Latest status' : 'Margin'}
          </p>
          {statusSummary.latest_status ? (
            <p className="font-bold text-sm max-w-[140px] truncate" style={{ color: 'var(--text-1)' }}>
              {statusSummary.latest_status}
            </p>
          ) : (
          <p className="font-bold text-sm flex items-center gap-1 tabular-nums"
            style={{ color: isProfit ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
            {isProfit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {formatPct(profitPct, 2)}
          </p>
          )}
        </div>
      </div>
    </article>
  )
}
