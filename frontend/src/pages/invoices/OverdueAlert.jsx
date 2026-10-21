// Extracted from Invoices.jsx — OverdueAlert.
import { formatInr } from '../../utils/format'
import { AlertOctagon } from 'lucide-react'
import { AgingBadge } from './ui'

export function OverdueAlert({ overdue, allRecords, onViewAll, onOpenInvoice }) {
  const totalOutstanding = overdue.reduce((s, inv) => s + (inv.amount || 0), 0)
  const critical = overdue.filter(inv => inv.aging >= 60).length
  const urgent   = overdue.filter(inv => inv.aging >= 30 && inv.aging < 60).length

  // Enrich summary entries with full record fields (allRecords has r.fields nested)
  const enriched = overdue.map(inv => {
    const recObj = (allRecords || []).find(r =>
      (r.fields?.['Invoice Number'] || r['Invoice Number']) === inv.invoice_no
    )
    const f = recObj?.fields || recObj || {}
    return {
      ...inv,
      client:      f['Client Name']        || '',
      category:    f['Category']           || '',
      outstanding: Number(f['Outstanding Amount'] || inv.amount || 0),
      milestone:   f['Milestone']          || '',
      // Prefer full record's followup — summary API may omit it
      followup:    f['Next followup'] || f['Next Follow-up'] || inv.followup || null,
      raised_date: f['Raised Date']   || inv.raised_date || null,
    }
  })

  return (
    <section className="rounded-2xl animate-slide-down overflow-hidden"
      style={{ border: '1px solid color-mix(in srgb, var(--fin-negative) 22%, transparent)', background: 'color-mix(in srgb, var(--fin-negative) 4%, transparent)' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--fin-negative) 14%, transparent)', background: 'color-mix(in srgb, var(--fin-negative) 7%, transparent)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <AlertOctagon size={14} style={{ color: 'var(--fin-negative)', flexShrink: 0 }} />
          <span className="text-sm font-bold" style={{ color: 'var(--fin-negative)' }}>
            {overdue.length} Invoice{overdue.length !== 1 ? 's' : ''} Awaiting Collection
          </span>
          {critical > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--fin-negative) 18%, transparent)', color: 'var(--fin-negative)', border: '1px solid color-mix(in srgb, var(--fin-negative) 25%, transparent)' }}>
              {critical} critical 60d+
            </span>
          )}
          {urgent > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--fin-warning) 15%, transparent)', color: 'var(--fin-warning)', border: '1px solid color-mix(in srgb, var(--fin-warning) 25%, transparent)' }}>
              {urgent} urgent 30–60d
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Total outstanding</p>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--fin-negative)' }}>{formatInr(totalOutstanding)}</p>
          </div>
          <button type="button" onClick={onViewAll}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--fin-negative) 15%, transparent)', color: 'var(--fin-negative)', border: '1px solid color-mix(in srgb, var(--fin-negative) 30%, transparent)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--fin-negative) 28%, transparent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--fin-negative) 15%, transparent)'}>
            View all
          </button>
        </div>
      </div>

      {/* ── Invoice rows ── */}
      {enriched.map((inv, i) => {
        const accent = inv.aging >= 60 ? 'var(--fin-negative)' : inv.aging >= 30 ? 'var(--fin-warning)' : 'var(--fin-warning)'
        const urgencyLabel = inv.aging >= 60 ? 'Critical' : inv.aging >= 30 ? 'Urgent' : 'Pending'
        return (
          <button key={i} type="button" onClick={() => onOpenInvoice(inv.invoice_no)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderBottom: i < enriched.length - 1 ? '1px solid color-mix(in srgb, var(--fin-negative) 8%, transparent)' : 'none',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--fin-negative) 7%, transparent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 16px' }}>

              {/* Left: stripe + two rows of info */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                <div style={{ width: 3, minHeight: 44, borderRadius: 99, background: accent, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Row 1: invoice no · project · client · category */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text-1)', flexShrink: 0 }}>{inv.invoice_no}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{inv.project}</span>
                    {inv.client && inv.client !== inv.project && (
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>
                        {inv.client}
                      </span>
                    )}
                    {inv.category && (
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>
                        {inv.category}
                      </span>
                    )}
                    {inv.milestone && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>· {inv.milestone}</span>
                    )}
                  </div>
                  {/* Row 2: raised date + follow-up */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {inv.raised_date && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        Raised <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{String(inv.raised_date).slice(0,10)}</span>
                      </span>
                    )}
                    {inv.followup ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fin-positive)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        Follow-up <span style={{ textDecoration: 'underline dotted' }}>{String(inv.followup).slice(0,10)}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--fin-warning)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        No follow-up scheduled
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: amount + aging + urgency label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums', margin: 0 }}>{formatInr(inv.amount)}</p>
                  {inv.outstanding > 0 && inv.outstanding !== inv.amount && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '2px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                      {formatInr(inv.outstanding)} open
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <AgingBadge days={inv.aging} status="Pending" />
                  <p style={{ fontSize: 10, fontWeight: 700, color: accent, margin: '3px 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{urgencyLabel}</p>
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </section>
  )
}

/* ── Attachment thumbnail ────────────────────────────────────────────────── */
