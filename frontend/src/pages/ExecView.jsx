import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  IndianRupee, TrendingUp, Wallet, Clock, Hourglass, AlertTriangle,
  Sparkles, ArrowRight, RefreshCw, ChevronRight,
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { formatInr as inr, formatPct } from '../utils/format'
import ExecutiveSummary from '../components/ExecutiveSummary'
import clsx from 'clsx'

/**
 * /exec — single-screen executive briefing.
 *
 * Designed for a phone in a meeting: AI summary + 5 hero numbers
 * + 3 alerts + the forecast. One viewport. Zero noise.
 */
export default function ExecView() {
  const fetchAll = useCallback(() =>
    Promise.all([
      api.projects.summary(),
      api.invoices.summary(),
    ]).then(([proj, inv]) => ({ proj, inv }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 15_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const proj = data?.proj
  const inv  = data?.inv

  const margin = proj && proj.total_billed > 0 ? (proj.total_profit / proj.total_billed) * 100 : 0
  const overdueAmount = (inv?.overdue_invoices || []).reduce((s, i) => s + Number(i.amount || 0), 0)

  // Forecast: pending × historical collection rate
  const forecast = inv && inv.total_outstanding > 0 && inv.collection_rate >= 30
    ? inv.total_outstanding * (inv.collection_rate / 100)
    : null

  return (
    <div className="min-h-full">

      {/* Hero gradient header */}
      <header className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 35%, #4338ca 75%, #6d28d9 100%)',
          paddingBottom: '2rem',
        }}>
        {/* Decorative blobs */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute" style={{
            top: -100, right: -60, width: 320, height: 320,
            background: 'radial-gradient(circle, rgba(167,139,250,0.4) 0%, transparent 60%)',
            filter: 'blur(28px)',
          }} />
          <div className="absolute" style={{
            bottom: -80, left: -40, width: 280, height: 280,
            background: 'radial-gradient(circle, rgba(96,165,250,0.3) 0%, transparent 60%)',
            filter: 'blur(24px)',
          }} />
        </div>

        <div className="relative px-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: 'rgba(255,255,255,0.65)' }}>
                Executive View
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold mt-1"
                style={{ color: '#fff', letterSpacing: '-0.025em', textShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                Today at a glance
              </h1>
              <p className="text-xs mt-1.5 flex items-center gap-2"
                style={{ color: 'rgba(255,255,255,0.65)' }}>
                {syncing
                  ? <span className="animate-pulse">syncing live data…</span>
                  : <>Live · {updatedLabel || 'just now'}</>}
              </p>
            </div>
            <button onClick={refresh} disabled={loading}
              aria-label="Refresh"
              className="rounded-lg p-2 flex-shrink-0 transition-all"
              style={{
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.10)'}>
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </header>

      {/* Card stack — pulled up over the hero */}
      <div className="px-4 sm:px-6 -mt-6 space-y-3 pb-6 animate-fade-in">

        {/* AI Summary card */}
        <ExecutiveSummary />

        {/* Error */}
        {error && (
          <div role="alert" className="card flex items-center gap-2 text-sm"
            style={{ background: 'var(--fin-neg-bg)', borderColor: 'var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* 5 hero numbers — 2-col on phone, 5-col on desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <HeroStat tone="blue"   icon={IndianRupee} label="Revenue"      value={inr(proj?.total_billed)} loading={loading && !data} />
          <HeroStat tone="green"  icon={TrendingUp}  label="Net Profit"   value={inr(proj?.total_profit)} sub={`${formatPct(margin, 1)} margin`} loading={loading && !data} />
          <HeroStat tone="amber"  icon={Wallet}      label="Collected"    value={inr(inv?.total_received)}  sub={inv ? `${(inv.collection_rate ?? 0).toFixed(0)}% rate` : ''} loading={loading && !data} />
          <HeroStat tone="pink"   icon={Clock}       label="Outstanding"  value={inr(inv?.total_outstanding)} sub={`${inv?.by_status?.Pending || 0} pending`} loading={loading && !data} />
          <HeroStat tone="violet" icon={Hourglass}   label="Forecast 30d" value={forecast != null ? inr(forecast) : '—'} sub="next collection" loading={loading && !data} />
        </div>

        {/* Critical alerts */}
        <Section title="Needs your attention">
          {(!inv || (inv.overdue_invoices || []).length === 0) ? (
            <div className="card text-center py-6 text-sm" style={{ color: 'var(--text-3)' }}>
              {loading && !data ? 'Loading…' : '✓ No overdue invoices'}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Aggregate alert */}
              <Alert
                tone="negative"
                icon={AlertTriangle}
                title={`${(inv.overdue_invoices || []).length} invoice${inv.overdue_invoices.length === 1 ? '' : 's'} overdue · ${inr(overdueAmount)}`}
                body="Pending more than 30 days — needs follow-up this week."
                href="/invoices?status=Pending"
              />
              {/* Top overdue items */}
              {inv.overdue_invoices.slice(0, 3).map(o => (
                <Link key={o.id || o.invoice_no} to="/invoices"
                  className="card flex items-center justify-between gap-3 p-3 transition-all"
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--fin-neg-border)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--card-border)'}>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold truncate" style={{ color: 'var(--text-1)' }}>{o.invoice_no}</p>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{o.project}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-sm tabular-nums" style={{ color: 'var(--text-1)' }}>{inr(o.amount)}</p>
                    <p className="text-[10px] font-semibold tabular-nums mt-0.5" style={{ color: 'var(--fin-negative)' }}>
                      {Math.round(Number(o.aging || 0))}d overdue
                    </p>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* Quick links */}
        <Section title="Drill in">
          <div className="grid grid-cols-2 gap-2">
            <QuickLink to="/" icon={Sparkles} label="Full dashboard" />
            <QuickLink to="/analytics" icon={TrendingUp} label="Analytics" />
            <QuickLink to="/invoices" icon={IndianRupee} label="Invoices" />
            <QuickLink to="/report" icon={ArrowRight} label="Board pack" />
          </div>
        </Section>

      </div>
    </div>
  )
}

/* ── Hero stat card ───────────────────────────────────────────────── */
const TONES = {
  blue:   { bg: '#dbeafe', fg: '#2563eb' },
  green:  { bg: '#dcfce7', fg: '#16a34a' },
  amber:  { bg: '#fef3c7', fg: '#d97706' },
  pink:   { bg: '#fce7f3', fg: '#db2777' },
  violet: { bg: '#ede9fe', fg: '#7c3aed' },
}
function HeroStat({ tone, icon: Icon, label, value, sub, loading }) {
  const t = TONES[tone] || TONES.blue
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <div className="rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ width: 28, height: 28, background: t.bg, color: t.fg }}>
          <Icon size={14} />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</p>
      </div>
      {loading
        ? <div className="skeleton h-5 w-3/4 rounded" />
        : <p className="display-num tabular-nums leading-tight"
            style={{ color: 'var(--text-1)', fontSize: 'clamp(0.95rem, 3.5vw, 1.25rem)' }}>
            {value ?? '—'}
          </p>}
      {sub && <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

/* ── Section wrapper ──────────────────────────────────────────────── */
function Section({ title, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.10em] px-1 mb-2 mt-4"
        style={{ color: 'var(--text-3)' }}>{title}</p>
      {children}
    </div>
  )
}

/* ── Alert card ───────────────────────────────────────────────────── */
function Alert({ tone, icon: Icon, title, body, href }) {
  const map = {
    negative: { bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)', fg: 'var(--fin-negative)' },
    warning:  { bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', fg: 'var(--fin-warning)' },
  }
  const m = map[tone] || map.warning
  return (
    <Link to={href}
      className="rounded-xl p-3 flex items-start gap-3 transition-all"
      style={{ background: m.bg, border: `1px solid ${m.border}` }}>
      <div className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.6)', color: m.fg }}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-tight" style={{ color: m.fg }}>{title}</p>
        <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
      </div>
      <ChevronRight size={14} style={{ color: m.fg }} className="mt-1 flex-shrink-0" />
    </Link>
  )
}

/* ── Quick link tile ──────────────────────────────────────────────── */
function QuickLink({ to, icon: Icon, label }) {
  return (
    <Link to={to}
      className="card flex items-center justify-between gap-2 transition-all"
      style={{ padding: '0.75rem 0.875rem' }}>
      <span className="flex items-center gap-2.5">
        <Icon size={15} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{label}</span>
      </span>
      <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />
    </Link>
  )
}
