/**
 * EmptyState — consistent zero-data illustration used across all pages.
 *
 * Usage:
 *   <EmptyState
 *     icon={<Receipt size={26} />}
 *     title="No invoices found"
 *     subtitle="Try adjusting your filters or create your first invoice."
 *     action={<button className="btn-primary …" onClick={…}>New Invoice</button>}
 *   />
 */
export default function EmptyState({ icon, title, subtitle, action, compact = false, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10 px-4' : 'py-20 px-6'} ${className}`}
      role="status"
      aria-label={title}
    >
      {icon && (
        <div
          className="flex items-center justify-center rounded-2xl mb-4 flex-shrink-0"
          style={{
            width: compact ? '2.75rem' : '3.5rem',
            height: compact ? '2.75rem' : '3.5rem',
            background: 'var(--bg-input)',
            border: '1px solid var(--card-border)',
            color: 'var(--text-3)',
          }}
        >
          {icon}
        </div>
      )}

      {title && (
        <p
          className={`font-bold leading-snug ${compact ? 'text-sm' : 'text-base'}`}
          style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}
        >
          {title}
        </p>
      )}

      {subtitle && (
        <p
          className={`mt-1 max-w-xs leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}
          style={{ color: 'var(--text-3)' }}
        >
          {subtitle}
        </p>
      )}

      {action && (
        <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
          {action}
        </div>
      )}
    </div>
  )
}
