/**
 * The Dashboard on a phone (≤640px): up to three insight cards (overdue
 * invoices, GST due, follow-ups, projects at a loss…), one summary card (the
 * collection rate as a ring, a sentence about what is still owed, six months
 * of cash in and pending invoices by age), then grouped lists: the
 * invoices that need chasing, the portfolio's figures and the top projects.
 * Custom dashboards and report exports sit at the foot; the date range for the
 * portfolio figures is behind the header's calendar button.
 *
 * The receivables come from the invoice list query (its workspace totals and
 * oldest pending invoices); the portfolio is the Dashboard's own data.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import {
  HeaderActions, RoundIconButton, SummaryCard, GroupedList, ListRow, SkeletonRows, InlineAddRow, Sheet, SheetField,
} from '../../components/mobile/MobileUI'
import { invoiceSummary, plural } from '../../components/mobile/summary'
import { DEFAULT_INVOICE_FILTERS, useInvoiceQuery } from '../invoices/useInvoiceQuery'
import { projectRowProps } from '../projects/ProjectsPhone'
import { formatInr, formatPct } from '../../utils/format'
import { OVERDUE_DAYS } from '../invoices/phoneSegments'
import { InvoiceCharts } from '../invoices/InvoicesPhone'
import InsightCards, { useInsights } from '../../components/mobile/InsightCards'
import { Avatar, invoicePill } from '../../components/mobile/Visuals'

export default function DashboardPhone({
  summary: s, projects, margin, healthOk, loading, error, refresh, isEditor, retainerSummary,
  kpiFrom, kpiTo, setKpiFrom, setKpiTo, workbench, customBlocks,
}) {
  const navigate = useNavigate()
  const [datesOpen, setDatesOpen] = useState(false)
  // One small page of the invoice list for its workspace totals.
  const { workspace: ws, error: invError } = useInvoiceQuery(DEFAULT_INVOICE_FILTERS, { pageSize: 1 })
  const { data: insights } = useInsights('dashboard')
  const receivables = invoiceSummary(ws)
  const chase = ws?.overdue_top || []
  const total = s?.total_projects ?? 0
  const retainersOwed = retainerSummary?.overdue_count || 0

  const figures = [
    { label: 'Revenue', value: formatInr(s?.total_billed || 0), meta: `${plural(total, 'project')}` },
    { label: 'Net profit', value: formatInr(s?.total_profit || 0), tone: (s?.total_profit ?? 0) < 0 ? 'var(--fin-negative)' : undefined, meta: `${formatPct(margin, 1)} margin` },
    { label: 'Healthy projects', value: `${healthOk} of ${total}`, meta: s?.at_risk?.length ? `${s.at_risk.length} at risk` : 'none at risk' },
    { label: 'Targets hit', value: `${s?.target_achieved_count ?? 0} of ${total}`, meta: 'revenue targets reached' },
  ]

  return (
    <div className="m-page">
      <HeaderActions>
        <RoundIconButton icon={CalendarDays} label="Date range" onClick={() => setDatesOpen(true)} active={!!(kpiFrom || kpiTo)} aria-haspopup="dialog" />
      </HeaderActions>

      <InsightCards cards={insights?.cards} />

      <SummaryCard
        loading={!ws}
        value={receivables?.value}
        ringLabel={receivables?.ringLabel}
        title={receivables?.title}
        sentence={receivables?.sentence}
        visual={insights?.charts ? <InvoiceCharts charts={insights.charts} onBucket={b => navigate(b.href)} /> : null}
      />

      {(error || invError) && (
        <div role="alert" className="m-note is-error">
          {error || invError} <button type="button" onClick={refresh} style={{ textDecoration: 'underline', minHeight: 0 }}>Retry</button>
        </div>
      )}

      {(chase.length > 0 || !ws) && (
        <GroupedList
          title="Needs a follow-up"
          action={<button type="button" onClick={() => navigate('/invoices?status=Pending')}>See all</button>}
        >
          {!ws ? <SkeletonRows count={3} avatar pill /> : chase.map(inv => {
            const aging = Math.round(Number(inv.aging || 0))
            const late = aging > OVERDUE_DAYS
            return (
              <ListRow
                key={inv.id}
                leading={<Avatar name={inv.client || inv.project || '?'} />}
                title={inv.invoice_no || 'Draft invoice'}
                mono
                meta={[inv.client, inv.project]}
                value={formatInr(inv.outstanding || inv.amount || 0)}
                pill={invoicePill('Pending', aging, OVERDUE_DAYS)}
                dot={late ? 'var(--fin-negative)' : 'var(--fin-warning)'}
                dotLabel={late ? `Overdue, ${aging} days` : `Pending, ${aging} days`}
                onClick={() => navigate(`/invoices?q=${encodeURIComponent(inv.invoice_no || '')}`)}
              />
            )
          })}
        </GroupedList>
      )}

      {retainerSummary?.total > 0 && (
        <GroupedList title="Retainers">
          <ListRow
            title={retainersOwed ? `${plural(retainersOwed, 'retainer')} with a balance` : 'All retainers cleared'}
            meta={[`${retainerSummary.healthy || 0} of ${retainerSummary.total} clear this month`]}
            dot={retainersOwed ? 'var(--fin-warning)' : 'var(--fin-positive)'}
            onClick={() => navigate('/invoices?billing=retainer&overdue=1')}
          />
        </GroupedList>
      )}

      <GroupedList
        title={kpiFrom || kpiTo ? `Portfolio · ${kpiFrom || 'start'} to ${kpiTo || 'today'}` : 'Portfolio'}
        action={<button type="button" onClick={() => navigate('/projects')}>Projects</button>}
      >
        {loading ? <SkeletonRows count={4} /> : figures.map(f => (
          <ListRow key={f.label} title={f.label} meta={f.meta} value={f.value} valueTone={f.tone} />
        ))}
      </GroupedList>

      {projects.length > 0 && (
        <GroupedList title="Top projects">
          {projects.map(r => {
            const row = projectRowProps(r)
            return <ListRow key={r.id} {...row} onClick={() => navigate(`/projects/${r.id}`)} />
          })}
        </GroupedList>
      )}

      {isEditor && <InlineAddRow label="New project" onClick={() => navigate('/projects/new')} />}

      {customBlocks}

      <div className="m-tools">{workbench}</div>

      <Sheet
        open={datesOpen}
        onClose={() => setDatesOpen(false)}
        title="Portfolio date range"
        footer={
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} disabled={!kpiFrom && !kpiTo}
              onClick={() => { setKpiFrom(''); setKpiTo('') }}>Clear</button>
            <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={() => setDatesOpen(false)}>Done</button>
          </div>
        }
      >
        <SheetField label="From">
          <input type="date" value={kpiFrom} onChange={e => setKpiFrom(e.target.value)} aria-label="From date" />
        </SheetField>
        <SheetField label="To">
          <input type="date" value={kpiTo} onChange={e => setKpiTo(e.target.value)} aria-label="To date" />
        </SheetField>
      </Sheet>
    </div>
  )
}
