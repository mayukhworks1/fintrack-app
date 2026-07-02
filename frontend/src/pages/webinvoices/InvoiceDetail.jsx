// Extracted from WebInvoices.jsx — InvoiceDetail.
import Drawer from '../../components/Drawer'
import { CheckCircle2 } from 'lucide-react'
import { AttachCard, RaisedByBadge, StatusPill } from './ui'
import { currencySymbol, fmtCurrency, fmtDateFull, parseAttachments } from './utils'

export function InvoiceDetail({ open, invoice, onClose, onEdit, onRecordPayment, isEditor, onPreview, avatarMap = {} }) {
  const f = (open && invoice) ? (invoice.fields || {}) : {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const cur = f['Currency'] || 'RS'

  const actions = open && invoice ? (
    <>
      {isEditor && onRecordPayment && f['Payment Status'] === 'Pending' && (
        <button onClick={onRecordPayment} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          <CheckCircle2 size={12} />Record Payment
        </button>
      )}
      {onEdit && <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Edit</button>}
    </>
  ) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <span>{f['Invoice Number'] || '—'}</span>
          {open && invoice && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
              {currencySymbol(cur)}{cur}
            </span>
          )}
        </div>
      }
      subtitle={[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
      width={500}
      accent={false}
      actions={actions}
      footer={
        <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
      }
    >
      <div className="p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                {f['Speed']}
              </span>
            )}
            {f['Raised By'] && (
              <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                <RaisedByBadge email={f['Raised By']} avatarMap={avatarMap} size={14} />
              </span>
            )}
          </div>

          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{f['Description']}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],      'var(--text-1)'],
              ['With GST',        f['Amount with Tax'],    'var(--text-1)'],
              ['Received',        f['Amount Received'],    'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'], outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmtCurrency(val, cur)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Raised',        fmtDateFull(f['Raised Date'])],
              ['Cleared',       fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']   != null ? `${f['Days To Clear']} days`   : '—'],
              ['Aging',         f['Agening (Days)']  != null ? `${f['Agening (Days)']} days`  : '—'],
              ['Milestone',     f['Milestone']       || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {(refs.length > 0 || pdfs.length > 0) && (
            <div className="space-y-3">
              {refs.length > 0 && (
                <div>
                  <p className="label mb-2">Payment Reference{refs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{refs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, i) : undefined} />)}</div>
                </div>
              )}
              {pdfs.length > 0 && (
                <div>
                  <p className="label mb-2">Invoice PDF{pdfs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{pdfs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, refs.length + i) : undefined} />)}</div>
                </div>
              )}
            </div>
          )}
      </div>
    </Drawer>
  )
}

/* ── Form drawer ── */
