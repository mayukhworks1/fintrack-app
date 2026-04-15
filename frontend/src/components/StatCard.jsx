import clsx from 'clsx'

const COLORS = {
  green:  { icon: '#4ade80', bg: 'rgba(34,197,94,0.1)',  glow: 'rgba(34,197,94,0.2)'  },
  blue:   { icon: '#60a5fa', bg: 'rgba(59,130,246,0.1)', glow: 'rgba(59,130,246,0.2)' },
  purple: { icon: '#c084fc', bg: 'rgba(168,85,247,0.1)', glow: 'rgba(168,85,247,0.2)' },
  yellow: { icon: '#facc15', bg: 'rgba(234,179,8,0.1)',  glow: 'rgba(234,179,8,0.2)'  },
  red:    { icon: '#f87171', bg: 'rgba(239,68,68,0.1)',  glow: 'rgba(239,68,68,0.2)'  },
}

export default function StatCard({ label, value, sub, icon: Icon, color = 'green', trend }) {
  const c = COLORS[color] || COLORS.green
  return (
    <div className="card animate-slide-up">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: c.bg, boxShadow: `0 0 16px ${c.glow}` }}>
            <Icon size={19} style={{ color: c.icon }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
          <p className="text-2xl font-bold truncate" style={{ color: 'var(--text-1)' }}>{value}</p>
          {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
          {trend != null && (
            <p className="text-xs mt-1 font-semibold flex items-center gap-1" style={{ color: trend >= 0 ? '#4ade80' : '#f87171' }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}% avg profit
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
