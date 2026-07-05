// Extracted from Invoices.jsx — InvoiceDetail.
import Drawer from '../../components/Drawer'
import { useToast } from '../../context/ToastContext'
import { api } from '../../services/api'
import { BellRing, Briefcase, CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AttachCard, RaisedByBadge, StatusPill } from './ui'
import { fmt, fmtDateFull, parseAttachments } from './utils'

export function InvoiceDetail({ open, invoice, onClose, onEdit, onRecordPayment, isEditor, canPayment = false, onPreview, avatarMap = {} }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)
  const [reminderEmail, setReminderEmail] = useState('')
  const f = (open && invoice) ? (invoice.fields || {}) : {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)

  async function handleSendReminder() {
    if (!invoice?.id) return
    setSendingReminder(true)
    setReminderModalOpen(false)
    try {
      await api.invoices.sendReminder(invoice.id, { to_email: reminderEmail.trim() })
      showToast('Payment reminder sent successfully', 'success')
      setReminderEmail('')
    } catch (e) {
      showToast(e.message || 'Failed to send reminder', 'error')
    } finally {
      setSendingReminder(false)
    }
  }
  const openProjects = () => {
    const params = new URLSearchParams()
    if (f['Client Name']) params.set('client', f['Client Name'])
    if (f['Project']) params.set('q', f['Project'])
    navigate(`/projects?${params.toString()}`)
  }
  const openStatus = () => {
    const cfg = {
      type: 'card',
      filterClient: f['Client Name'] || '',
      filterStatus: '',
      search: f['Project'] || '',
      columns: ['Client', 'Project', 'Status', 'Short Status'],
      boardGroupBy: 'Status',
      cardGroupBy: 'Client',
      cardGroupSort: 'count-desc',
      cardRecordSort: 'project-asc',
      advancedConditions: [],
      theme: 'cobalt',
      density: 'comfortable',
      showDashboard: true,
      showClientAccents: true,
    }
    navigate(`/status?v=${encodeURIComponent(btoa(JSON.stringify(cfg)))}`)
  }

  const actions = open && invoice ? (
    <>
      {canPayment && f["Payment Status"] === "Pending" && (
        <button onClick={onRecordPayment} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          <CheckCircle2 size={12} />Record Payment
        </button>
      )}
      {isEditor && f['Payment Status'] !== 'Paid' && (
        <button onClick={() => setReminderModalOpen(true)} disabled={sendingReminder} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          {sendingReminder ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
          {sendingReminder ? 'Sending…' : 'Send Reminder'}
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          Edit
        </button>
      )}
    </>
  ) : null

  return (
    <>
    <Drawer
      open={open}
      onClose={onClose}
      title={f['Invoice Number'] || '—'}
      subtitle={[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
      width={500}
      accent={false}
      actions={actions}
      footer={
        <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
      }
    >
      <div className="p-5 space-y-5">
          {/* Status row */}
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

          {/* Description */}
          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                {f['Description']}
              </p>
            </div>
          )}

          {(f['Project'] || f['Client Name']) && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Briefcase size={13} style={{ color: 'var(--accent)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Record context</p>
              </div>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-2)' }}>
                {f['Project'] && <p><strong style={{ color: 'var(--text-1)' }}>Project:</strong> {f['Project']}</p>}
                {f['Client Name'] && <p><strong style={{ color: 'var(--text-1)' }}>Client:</strong> {f['Client Name']}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={openProjects} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>Open projects</button>
                <button onClick={openStatus} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>Open status board</button>
              </div>
            </div>
          )}

          {/* Amount grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],       'var(--text-1)'],
              ['With GST (18%)',  f['Amount with Tax'],     'var(--text-1)'],
              ['Received',        f['Amount Received'],     'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'],  outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmt(val)}</p>
              </div>
            ))}
          </div>

          {/* Dates + computed */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Raised',      fmtDateFull(f['Raised Date'])],
              ['Cleared',     fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']    != null ? `${f['Days To Clear']} days`    : '—'],
              ['Aging',         f['Payment Status'] === 'Pending' && f['Agening (Days)'] != null ? `${f['Agening (Days)']} days` : '—'],
              ['Milestone',     f['Milestone']        || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Remark */}
          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {/* Attachments */}
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

    {reminderModalOpen && createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
        onClick={e => { if (e.target === e.currentTarget) { setReminderModalOpen(false); setReminderEmail('') } }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '28px 28px 24px', width: 380, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>Send Payment Reminder</h3>
          <p style={{ margin: '0 0 18px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Invoice <strong>{f['Invoice Number']}</strong> — {f['Client Name'] || f['Project'] || ''}
          </p>
          <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>Recipient email address</label>
          <input
            autoFocus
            type="email"
            autoComplete="off"
            value={reminderEmail}
            onChange={e => setReminderEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && reminderEmail.trim()) handleSendReminder() }}
            placeholder="client@example.com"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.875rem', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" style={{ fontSize: '0.8rem', padding: '6px 16px' }}
              onClick={() => { setReminderModalOpen(false); setReminderEmail('') }}>
              Cancel
            </button>
            <button className="btn-primary" style={{ fontSize: '0.8rem', padding: '6px 16px' }}
              disabled={!reminderEmail.trim()}
              onClick={handleSendReminder}>
              <BellRing size={12} /> Send
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

/* ── Invoice form drawer ─────────────────────────────────────────────────── */
