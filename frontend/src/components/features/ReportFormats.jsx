/**
 * Executive reports: the formats the Report screen offers, and what each
 * one is made of.
 *
 * The five formats and their one-line descriptions are REPORT_TEMPLATES, the
 * same list the app's Report screen uses. The outline beside each is the
 * section headings the report builder writes for that format (Board Pack's
 * "Portfolio Overview", "Cash Flow & Collections" and so on). Headings only:
 * a report's figures are the reader's own data, and inventing some here
 * would be the one thing this page cannot do.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText } from 'lucide-react'
import { REPORT_TEMPLATES } from '../demoData'
import { useInk } from '../../hooks/useInk'

const BOARD = [
  'Portfolio Overview', 'Financial Performance', 'Per-Client Breakdown',
  'Cash Flow & Collections', 'Current Project Status', 'Project Health Analysis',
  'Risks & Concerns', 'Recommendations', 'Action Items This Week',
]
const OUTLINE = {
  board: { title: 'Board Pack', sections: BOARD },
  founder: {
    title: 'Weekly Founder Report',
    sections: ['Portfolio billed and profit', 'Outstanding invoices', 'At-risk projects', 'Then the full board pack'],
  },
  collections: {
    title: 'Collections Report',
    sections: ['Outstanding amount', 'Pending invoices', 'Collection rate', 'Priority queue', 'Recommended actions'],
  },
  health: {
    title: 'Project Health Review',
    sections: ['Tracked projects', 'Healthy projects', 'At-risk projects', 'Projects needing review', 'Review prompts'],
  },
  billing: { title: 'Client Billing Summary', sections: ['Top clients by billed amount', 'Billed, profit and project count for each'] },
}

export default function ReportFormats() {
  const [sel, setSel] = useState(0)
  const ink = useInk(sel, { axis: 'y' })
  const t = REPORT_TEMPLATES[sel]
  const o = OUTLINE[t.id] || { title: t.title, sections: [] }

  return (
    <div className="ft-f-demo ft-f-rep">
      <div ref={ink} className="ft-m-ink ft-f-rep-list" role="group" aria-label="Report formats">
        {REPORT_TEMPLATES.map((r, i) => (
          <button key={r.id} type="button" aria-pressed={i === sel} onClick={() => setSel(i)}>
            <b className="text-[13px] text-[var(--text-1)]">{r.title}</b>
            <span className="text-[11.5px] leading-snug text-[var(--text-3)]">{r.blurb}</span>
          </button>
        ))}
        <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
      </div>

      <div className="ft-f-rep-doc" aria-live="polite">
        <div key={t.id} className="ft-f-swap">
          <p className="flex items-center gap-2 m-0 font-extrabold text-[14px] text-[var(--text-1)]"><FileText size={14} aria-hidden="true" /> {o.title}</p>
          <p className="mt-0.5 mb-2.5 pb-2.5 text-[12px] text-[var(--text-3)]" style={{ borderBottom: '1px solid var(--card-border)' }}>{t.blurb}</p>
          <ol className="ft-f-rep-outline">
            {o.sections.map((s, i) => (
              <li key={s} style={{ '--i': Math.min(i, 8) }}>
                <span className="text-[12.5px] font-bold text-[var(--text-1)]">{s}</span>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>
        <Link to="/#try" className="ft-f-link">
          Generate one on sample data in the sandbox <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
