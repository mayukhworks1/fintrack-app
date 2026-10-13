/**
 * SkeletonList — placeholder rows shown while a list loads, in the shape of
 * the content that is coming, so the screen does not jump when it arrives.
 * Uses the global .skeleton shimmer, which follows the light/dark theme.
 *
 *   <SkeletonList rows={5} />            list rows with an icon and two lines
 *   <SkeletonList rows={3} compact />    tighter rows for side panels
 */
export default function SkeletonList({ rows = 5, compact = false, label = 'Loading', className = '' }) {
  const widths = [72, 58, 66, 49, 61, 54, 69, 45]
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12, padding: compact ? '4px 0' : '8px 0' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!compact && <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="skeleton" style={{ height: compact ? 10 : 12, width: `${widths[i % widths.length]}%`, marginBottom: compact ? 6 : 8 }} />
            <div className="skeleton" style={{ height: compact ? 8 : 10, width: `${widths[(i + 3) % widths.length] - 20}%`, opacity: 0.7 }} />
          </div>
          {!compact && <div className="skeleton" style={{ width: 64, height: 22, borderRadius: 999, flexShrink: 0 }} />}
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  )
}
