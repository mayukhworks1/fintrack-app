// One invoice in the desktop table: the row and its hover-expanded detail.
// Memoised, so hovering one row or loading the next page re-renders only the
// rows whose props changed.
import { Fragment, memo } from 'react'
import { CheckCircle2, Eye, Save } from 'lucide-react'
import clsx from 'clsx'
import { AgingBadge, AttachThumb, RaisedByBadge, StatusPill } from './ui'
import { STATUS_META, effectiveAging, fmt, fmtDate, parseAttachments } from './utils'
import { tint } from '../../utils/color'

export const InvoiceTableRow = memo(function InvoiceTableRow({
  r, index, isHovered, motion, columnVisibility, columnWidths, visibleColumnCount, avatarMap,
  canPayment, canEdit, onOpen, onPay, onEdit, onPreview, onEnter, onLeave,
}) {
  const f = r.fields || {}
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allFiles = [...refs, ...pdfs]
  const statusMeta = STATUS_META[f['Payment Status']] || {}
  const accentColor = statusMeta.color || 'var(--accent)'
  // Client and Project frequently hold the same name (a
  // retainer billed under the client's own name). Repeating
  // it in adjacent columns is noise, so the Project cell
  // shows only the description in that case.
  const clientLabel = f['Client Name'] || f['Client'] || ''
  const projectLabel = f['Project'] || ''
  const projectSameAsClient =
    !!clientLabel && !!projectLabel &&
    clientLabel.trim().toLowerCase() === projectLabel.trim().toLowerCase()

  const handleRowEnter = () => onEnter(r.id)
  const handleRowLeave = onLeave

  return (
    <Fragment>
    <tr
      className={clsx('tbl-row', motion && `ft-row-${motion}`)}
      style={{
        cursor: 'pointer',
        background: isHovered ? 'var(--table-row-hover)' : index % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)',
        borderLeft: isHovered ? `3px solid ${accentColor}` : '3px solid transparent',
        boxShadow: isHovered ? 'var(--table-row-shadow)' : 'none',
        transition: 'background-color 250ms cubic-bezier(0.4,0,0.2,1), border-color 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms cubic-bezier(0.4,0,0.2,1)',
      }}
      onClick={() => onOpen(r)}
      onMouseEnter={handleRowEnter}
      onMouseLeave={handleRowLeave}>

      <td className="tbl-cell" style={{ width: columnWidths.row }}>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
          {index + 1}
        </span>
      </td>

      {columnVisibility.invoice_number && (
        <td className="tbl-cell" style={{ width: columnWidths.invoice_number }}>
        <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>
          {f['Invoice Number'] || '—'}
        </span>
      </td>
      )}
      {columnVisibility.payment_status && (
        <td className="tbl-cell" style={{ width: columnWidths.payment_status }}>
        <StatusPill status={f['Payment Status']} />
      </td>
      )}
      {columnVisibility.amount_raised && (
        <td className="tbl-cell" style={{ width: columnWidths.amount_raised, textAlign: 'right' }}>
        <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>
          {fmt(f['Amount Raised'])}
        </span>
      </td>
      )}
      {columnVisibility.aging && (
        <td className="tbl-cell" style={{ width: columnWidths.aging }}>
        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
      </td>
      )}
      {columnVisibility.client_name && (
        <td className="tbl-cell align-top" style={{ width: columnWidths.client_name }}>
        <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Client Name'] || f['Client'] || '—'}</span>
      </td>
      )}
      {columnVisibility.project && (
        <td className="tbl-cell align-top" style={{ width: columnWidths.project }}>
        <div className="min-w-0">
          {/* Suppressed only when the Client column is on
              screen to show it — otherwise the name would
              disappear from the row entirely. */}
          {!(projectSameAsClient && columnVisibility.client_name) && (
            <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{projectLabel || '—'}</span>
          )}
          {f['Description'] && (
            <span className="block text-[11px] mt-1" style={{ color: 'var(--text-3)', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.5 }}>
              {f['Description']}
            </span>
          )}
          {/* A row with neither a name nor a description
              still needs a placeholder to read as empty. */}
          {projectSameAsClient && columnVisibility.client_name && !f['Description'] && (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
          )}
        </div>
      </td>
      )}
      {columnVisibility.raised_date && (
        <td className="tbl-cell" style={{ width: columnWidths.raised_date }}>
        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
      </td>
      )}
      {columnVisibility.outstanding_amount && (
        <td className="tbl-cell" style={{ width: columnWidths.outstanding_amount, textAlign: 'right' }}>
        {outstanding > 0
          ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</span>
          : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
      </td>
      )}
      {columnVisibility.amount_received && (
        <td className="tbl-cell" style={{ width: columnWidths.amount_received, textAlign: 'right' }}>
        <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>
          {fmt(f['Amount Received'])}
        </span>
      </td>
      )}
      {columnVisibility.amount_with_tax && (
        <td className="tbl-cell" style={{ width: columnWidths.amount_with_tax, textAlign: 'right' }}>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
          {fmt(f['Amount with Tax'])}
        </span>
      </td>
      )}
      {columnVisibility.category && (
        <td className="tbl-cell" style={{ width: columnWidths.category }}>
        <span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Category'] || '—'}</span>
      </td>
      )}
      {columnVisibility.milestone && (
        <td className="tbl-cell" style={{ width: columnWidths.milestone }}><span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Milestone'] || '—'}</span></td>
      )}
      {columnVisibility.raised_by && (
        <td className="tbl-cell min-w-0" style={{ width: columnWidths.raised_by, overflow: 'hidden' }}>
        {f['Raised By']
          ? <span className="inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" title={f['Raised By']} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
              <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
            </span>
          : <span style={{ color: 'var(--text-3)' }}>—</span>}
      </td>
      )}
      {columnVisibility.next_followup && (
        <td className="tbl-cell" style={{ width: columnWidths.next_followup }}>
        {f['Next followup']
          ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
              {fmtDate(f['Next followup'])}
            </span>
          : <span style={{ color: 'var(--text-3)' }}>—</span>}
      </td>
      )}

      {/* Attachment thumbs */}
      {columnVisibility.docs && (
      <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.docs }}>
        {allFiles.length > 0 ? (
          <div className="flex items-center gap-1">
            {allFiles.slice(0, 2).map((a, i) => (
              <AttachThumb key={i} a={a} size={28} onPreview={() => onPreview(allFiles, i)} />
            ))}
            {allFiles.length > 2 && (
              <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>
                +{allFiles.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
        )}
      </td>
      )}

      {/* View action */}
      <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.actions }}>
        <div className="flex flex-wrap gap-2">
          {canPayment && f["Payment Status"] === "Pending" && (
            <button
              onClick={() => onPay(r)}
              className="btn-ghost flex items-center gap-1.5"
              style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--fin-positive)', borderColor: 'color-mix(in srgb, var(--fin-positive) 30%, transparent)' }}
              aria-label={`Record payment for ${f['Invoice Number']}`}>
              <CheckCircle2 size={12} />
              <span className="text-[11px] font-semibold">Pay</span>
            </button>
          )}
          <button
            onClick={() => onOpen(r)}
            className="btn-ghost flex items-center gap-1.5"
            style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}
            aria-label={`View ${f['Invoice Number']}`}>
            <Eye size={12} />
            <span className="text-[11px] font-semibold">View</span>
          </button>
        </div>
      </td>
    </tr>

    {/* ── Hover-expand detail row ── */}
    <tr
      style={{ background: 'transparent' }}
      onMouseEnter={handleRowEnter}
      onMouseLeave={handleRowLeave}>
      <td colSpan={visibleColumnCount} style={{ padding: 0, border: 'none' }}>
        <div style={{
          maxHeight: isHovered ? 320 : 0,
          overflow: 'hidden',
          transition: `max-height 380ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1)`,
          opacity: isHovered ? 1 : 0,
        }}>
          {/* card */}
          <div
            onClick={() => onOpen(r)}
            style={{
              cursor: 'pointer',
              margin: '0 0 4px 0',
              background: 'var(--glass-bg)',
              borderLeft: `3px solid ${accentColor}`,
              borderTop: `1px solid var(--glass-border)`,
              borderBottom: `1px solid var(--glass-border)`,
            }}>

            {/* ── Section 1: Metrics strip ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              padding: '10px 20px 10px 18px',
              borderBottom: '1px solid var(--glass-border)',
              background: `linear-gradient(90deg, ${tint(accentColor, 0.03)} 0%, transparent 60%)`,
            }}>
              <StatusPill status={f['Payment Status']} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', fontFamily: 'monospace', marginLeft: 2 }}>
                {f['Invoice Number'] || ''}
              </span>
              <span style={{ width: 1, height: 16, background: 'var(--glass-border)', margin: '0 6px' }} />
              {[
                { label: 'Raised', value: fmt(f['Amount Raised']), color: 'var(--text-1)' },
                { label: 'Incl. GST', value: fmt(f['Amount with Tax']), color: 'var(--text-2)' },
                { label: 'Received', value: fmt(f['Amount Received']), color: 'var(--fin-positive)' },
                outstanding > 0 ? { label: 'Outstanding', value: fmt(outstanding), color: 'var(--fin-warning)' } : null,
              ].filter(Boolean).map((chip, ci) => (
                <span key={chip.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                  {ci > 0 && <span style={{ color: 'var(--text-3)', fontSize: 10 }}>·</span>}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>{chip.label}</span>
                  <span style={{ fontSize: 12, color: chip.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{chip.value}</span>
                </span>
              ))}
              <span style={{ marginLeft: 'auto' }}>
                <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
              </span>
            </div>

            {/* ── Section 2: Two-column body ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

              {/* Left: entity fields */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: '12px 20px 12px 18px',
                borderRight: '1px solid var(--glass-border)',
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                  {[
                    { label: 'Client', value: f['Client Name'] || f['Client'] },
                    { label: 'Project', value: f['Project'] },
                    { label: 'Category', value: f['Category'] },
                    { label: 'Milestone', value: f['Milestone'] },
                  ].filter(x => x.value).map(x => (
                    <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{x.label}</span>
                      <span style={{ fontSize: 12, color: x.label === 'Client' || x.label === 'Project' ? 'var(--text-1)' : 'var(--text-2)', fontWeight: x.label === 'Client' || x.label === 'Project' ? 600 : 400, lineHeight: 1.4 }}>{x.value}</span>
                    </div>
                  ))}
                </div>
                {f['Raised By'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised By</span>
                    <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={18} />
                  </div>
                )}
              </div>

              {/* Right: text + dates */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '12px 20px',
              }}>
                {f['Description'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Description']}</span>
                  </div>
                )}
                {f['Remark'] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Remark</span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f['Remark']}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {f['Raised Date'] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raised</span>
                      <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Raised Date'])}</span>
                    </div>
                  )}
                  {f['Cleared Date'] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cleared</span>
                      <span style={{ fontSize: 11, color: 'var(--fin-positive)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(f['Cleared Date'])}</span>
                    </div>
                  )}
                  {f['Next followup'] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next Followup</span>
                      <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>{fmtDate(f['Next followup'])}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Section 3: Footer — attachments + actions ── */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 20px 8px 18px',
                borderTop: '1px solid var(--glass-border)',
                background: 'var(--bg-input)',
                gap: 12,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {allFiles.length > 0 ? (
                  <>
                    {allFiles.slice(0, 5).map((a, i) => (
                      <AttachThumb key={i} a={a} size={28} onPreview={() => onPreview(allFiles, i)} />
                    ))}
                    {allFiles.length > 5 && (
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>+{allFiles.length - 5} more</span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>No attachments</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {canPayment && f["Payment Status"] === "Pending" && (
                  <button
                    onClick={() => onPay(r)}
                    className="btn-ghost flex items-center gap-1.5"
                    style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--fin-positive)', borderColor: 'color-mix(in srgb, var(--fin-positive) 35%, transparent)' }}>
                    <CheckCircle2 size={11} />
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Record Payment</span>
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => onEdit(r)}
                    className="btn-ghost flex items-center gap-1.5"
                    style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--text-2)', borderColor: 'var(--glass-border)' }}>
                    <Save size={11} />
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Edit</span>
                  </button>
                )}
                <button
                  onClick={() => onOpen(r)}
                  className="btn-ghost flex items-center gap-1.5"
                  style={{ fontSize: '0.6875rem', padding: '0.25rem 0.7rem', color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}>
                  <Eye size={11} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>View Details</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
    </Fragment>
  )
})
