import clsx from 'clsx'

export default function StatCard({ label, value, sub, icon: Icon, color = 'green', trend }) {
  const colors = {
    green: 'text-brand-400 bg-brand-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    yellow: 'text-yellow-400 bg-yellow-500/10',
    red: 'text-red-400 bg-red-500/10',
  }
  return (
    <div className="card flex items-start gap-4">
      {Icon && (
        <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', colors[color])}>
          <Icon size={20} className={colors[color].split(' ')[0]} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        {trend != null && (
          <p className={clsx('text-xs mt-1 font-medium', trend >= 0 ? 'text-brand-400' : 'text-red-400')}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}
