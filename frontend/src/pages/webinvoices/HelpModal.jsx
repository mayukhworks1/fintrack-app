// Extracted from WebInvoices.jsx — HelpModal.
import { BookOpen, Briefcase, Check, FileText, Globe, Mail, Repeat2, Users, X as XIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { HELP_CONTACT } from './utils'
import { useDialog } from '../../hooks/useDialog'

export function HelpModal({ open, onClose }) {
  // active: open — this component stays mounted while closed, so the Escape
  // handler would otherwise fire onClose for a dialog that is not on screen.
  const dialog = useDialog({ label: 'Help', onClose, active: open })
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div {...dialog.panelProps} className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-btn)' }}>
              <BookOpen size={14} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>App Guide</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>How to use TheWorks Web Tracker</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Overview */}
          <section className="rounded-xl p-4" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
            <h3 className="font-bold text-sm mb-1.5 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <Globe size={14} /> TheWorks Web Tracker
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Your all-in-one billing and project management hub. Start in the new <strong style={{ color: 'var(--text-1)' }}>Dashboard</strong> for a live billing command view, then move into <strong style={{ color: 'var(--text-1)' }}>Invoices</strong>, <strong style={{ color: 'var(--text-1)' }}>Retainers</strong>, and <strong style={{ color: 'var(--text-1)' }}>Projects</strong> (admin only) as needed. Everything stays synced live to Teable.
            </p>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Invoices */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FileText size={14} style={{ color: 'var(--accent)' }} /> Invoices
            </h3>
            <div className="space-y-2">
              {[
                ['Raise Externally', 'Opens the Zoho invoice request form for official client-facing invoices. Always raise through Zoho for formal billing.'],
                ['New Invoice', 'Records an invoice directly in the tracker — use this for internal entries, bulk import, or pre-raising before Zoho.'],
                ['Filters & Search', 'Filter by project, month, category, raised by, or billing type (Project vs Retainer). The search bar matches invoice number, project, description, category, and milestone.'],
                ['Status', 'Mark as Pending, Paid, or Cancelled. Invoices unpaid for more than 30 days appear as overdue at the top of the list.'],
                ['Paid Invoice Rule', 'When marking an invoice Paid, Amount Received and Cleared Date are mandatory. Attach a payment screenshot to the Reference field.'],
                ['Attachments', 'Drag & drop or click to attach Invoice PDFs and Payment References. Files upload directly to Teable — no size limit from the app side.'],
                ['Project Snapshot', 'The project cards at the top show raised/collected/outstanding per client. Click any card to filter the list to that project instantly.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Retainers */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Repeat2 size={14} style={{ color: 'var(--accent)' }} /> Retainers
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Retainer?', 'A recurring monthly billing arrangement. The Project field holds the client name. All retainer entries use a "Retainer" category type.'],
                ['Record a month', 'Navigate to the target month using the arrow buttons, then click Record Invoice. The form pre-fills from last month\'s entry — update only what changed.'],
                ['Pause a month', 'If billing is skipped, click Pause Month to record a zero-value Cancelled entry. This keeps the retainer history clean and shows a "Paused" pill in the timeline.'],
                ['Invoice number', 'You can leave this blank initially. Once the Zoho invoice is formally raised, the account manager updates the number here.'],
                ['Timeline view', 'Each retainer shows a month-by-month status strip — green (Paid), orange (Pending), grey (Paused), dashed (not yet raised). Click any month cell to jump to that entry.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Projects */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Briefcase size={14} style={{ color: 'var(--accent)' }} /> Projects
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['Create a project', 'Click + New Project. Fill in name, client, status, priority, timeline, and budget. The profit preview updates live as you type amounts.'],
                ['Project cards', 'Each card shows live status badge, priority, progress bar, client charge, and estimated profit. Click to open the full project detail view.'],
                ['Project detail', 'Full KPI breakdown — total cost, profit, margin %, man hours vs planned, and revenue. Also shows all resources assigned and matching invoices.'],
                ['Matching invoices', 'Invoices whose Project field exactly matches the project name are automatically listed with totals. Project name spelling must match precisely.'],
                ['Progress %', 'Use the slider in the edit form to update completion. This syncs directly to Teable and reflects on the project card.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Resources */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Users size={14} style={{ color: 'var(--accent)' }} /> Resources
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Resource?', 'Any person, tool, or vendor working on a project — Employee, Freelancer, Contractor, Tool/Software, or Cloud Infra.'],
                ['Add to a project', 'Open a project → click Add Resource or assign an existing one via the Assign Resources button. A resource can belong to multiple projects.'],
                ['Rate & cost', 'Set rate (₹), rate unit (Per Hour / Per Day / Per Month / Fixed), and units. Total cost is computed automatically in Teable.'],
                ['Man Hours', 'Log actual vs. planned hours. Teable computes the variance — red means over budget, green means under.'],
                ['Revenue tracking', 'Set a billing rate and billable units to track what you charge vs. what the resource costs. Gross margin is calculated automatically.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Tips */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              💡 Quick Tips
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {[
                ['Auto-sync', 'Invoice data refreshes every 10 seconds automatically — no manual refresh needed.'],
                ['Exact project names', 'Invoice ↔ Project linking is case-sensitive. "Riese Moto" ≠ "riese moto".'],
                ['Overdue alert', 'Pending invoices older than 30 days appear highlighted in red at the top.'],
                ['Follow-up filter', 'Use "Follow-up due" filter to surface invoices whose Next Followup date is today or past.'],
                ['Dropdown options', 'All dropdowns (Project, Category, Milestone, Raised By) pull live from Teable. Use the + button to add new options without leaving the form.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-2.5 items-start p-2.5 rounded-lg text-xs" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                  <Check size={11} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--fin-positive)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}:</strong> {desc}</p>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer — contact */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Question or found a bug?</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>We'll get back to you within a day.</p>
          </div>
          <a href={`mailto:${HELP_CONTACT}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff', textDecoration: 'none', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
            <Mail size={14} /> Contact us
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Mobile-only top header bar ── */
