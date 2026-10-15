import clsx from 'clsx'
import { useTilt } from '../hooks/useTilt'

export function ExecutiveShell({ children, className = '', flush = false }) {
  return (
    <div className={clsx('animate-fade-in space-y-5', flush ? '' : 'p-4 sm:p-6', className)}>
      {children}
    </div>
  )
}

export function ExecutiveHero({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  meta,
  children,
}) {
  return (
    <section className="executive-hero">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-4">
            {Icon && (
              <div className="executive-hero-icon">
                <Icon size={24} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <p className="executive-eyebrow">
                  {eyebrow}
                </p>
              )}
              <h1 className="executive-title">{title}</h1>
              {description && (
                <p className="executive-description">{description}</p>
              )}
              {meta && <div className="mt-3">{meta}</div>}
            </div>
          </div>
        </div>
        {actions && (
          <div className="executive-actions">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

export function ExecutiveStatGrid({ children, className = '' }) {
  return <div className={clsx('executive-stat-grid', className)}>{children}</div>
}

// Spelled out in full so Tailwind's content scan keeps these component rules.
const STAT_ACCENT_CLASS = {
  positive: 'executive-stat-positive',
  warning: 'executive-stat-warning',
  negative: 'executive-stat-negative',
}

export function ExecutiveStatCard({
  label,
  value,
  sub,
  accent = 'default',
  icon: Icon,
  children,
  compact = false,
}) {
  const tilt = useTilt({ max: 6 })
  return (
    <div
      ref={tilt}
      className={clsx('executive-stat-card', 'tilt', 'tilt-sheen', compact && 'executive-stat-card-compact')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="executive-stat-label">{label}</p>
          <p className={clsx('executive-stat-value', STAT_ACCENT_CLASS[accent])}>{value}</p>
          {sub && <p className="executive-stat-sub">{sub}</p>}
        </div>
        {Icon && (
          <div className="executive-stat-icon">
            <Icon size={16} />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

export function ExecutivePanel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={clsx('executive-panel', className)}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="executive-panel-title">{title}</h2>}
            {subtitle && <p className="executive-panel-subtitle">{subtitle}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function ExecutiveFilterBar({ children, className = '' }) {
  return <div className={clsx('executive-filter-bar', className)}>{children}</div>
}

export function ExecutiveChip({ children, accent = false }) {
  return (
    <span className={clsx('executive-chip', accent && 'executive-chip-accent')}>
      {children}
    </span>
  )
}
