/**
 * Document intelligence: an answer, its citation, and the passage it came
 * from.
 *
 * The contract below is written for this demo and says so. What it shows is
 * the shape of an answer in Studio: a short reply with a numbered citation,
 * and the cited passage opened in place on its page. Picking a question
 * jumps the document to its passage and the highlight lands there.
 */
import { useState } from 'react'
import { FileSearch, ChevronRight } from 'lucide-react'

const SAMPLE_QUERIES = [
  {
    q: 'What is the late payment interest clause?',
    page: 2, section: '§4.3', heading: 'Late settlement and remedies',
    snippet:
      'In the event Client fails to remit payment within forty-five (45) days of invoice date, interest shall accrue at the rate of 1.5% per month or the statutory maximum rate, calculated daily from the due date until full settlement.',
    answer:
      'Interest accrues at 1.5% a month or the statutory maximum rate, calculated daily on anything unpaid after the 45-day terms.',
  },
  {
    q: 'When is a milestone deemed accepted?',
    page: 4, section: '§7.1', heading: 'Sign-off and client review period',
    snippet:
      'Client shall have ten (10) business days following delivery to review and provide written notice of non-conformity. In the absence of written rejection within said period, the milestone deliverable shall be deemed accepted and invoice ready.',
    answer:
      'After ten business days from delivery, unless the client has sent written notice that something does not conform.',
  },
  {
    q: 'When must TDS certificates be issued?',
    page: 5, section: '§9.4', heading: 'Tax withholding and Form 16A',
    snippet:
      'Where tax is deducted at source pursuant to Indian Income Tax Act Section 194J/194C, Client covenants to issue quarterly Form 16A certificates within forty-five (45) days of the calendar quarter ending.',
    answer:
      'Within 45 days of the end of each calendar quarter, for every deduction made under 194J or 194C.',
  },
]

export default function ContractCitationInspector() {
  const [active, setActive] = useState(0)
  const cur = SAMPLE_QUERIES[active]

  return (
    <div className="ft-f-demo ft-f-docs">
      <div className="ft-f-docs-ask">
        <p className="ft-f-kicker">Ask the agreement</p>
        <div role="group" aria-label="Sample questions" className="flex flex-col gap-1.5">
          {SAMPLE_QUERIES.map((sq, i) => (
            <button key={sq.q} type="button" aria-pressed={i === active} onClick={() => setActive(i)} className="ft-f-q">
              <span>{sq.q}</span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="ft-f-answer" aria-live="polite">
          <p key={cur.q} className="ft-f-swap">
            {cur.answer}<sup className="ft-f-cite">1</sup>
          </p>
          <p className="flex items-center gap-1.5 mt-2 mb-0 pt-2 text-[11.5px] text-[var(--text-3)]" style={{ borderTop: '1px solid var(--card-border)' }}>
            <span className="ft-f-cite">1</span> Master services agreement · page {cur.page}, {cur.section}
          </p>
        </div>
      </div>

      <div className="ft-f-page" aria-label={`Page ${cur.page} of the sample agreement`}>
        <div className="flex justify-between gap-2 mb-2.5 pb-2 text-[10px] font-semibold font-mono text-[var(--text-3)]" style={{ borderBottom: '1px solid var(--card-border)' }}>
          <span>Sample agreement · written for this demo</span>
          <span>Page {cur.page} of 8</span>
        </div>
        <p className="m-0 mb-2.5 text-[var(--text-3)]">
          {cur.section.replace('§', '')}.0 The parties agree the following terms, which apply to every
          statement of work executed under this agreement by authorised signatories of both parties…
        </p>
        <div key={cur.q} className="ft-f-passage">
          <span className="flex items-center gap-1 mb-1 text-[11px] font-bold font-sans text-[var(--accent-ink)]"><FileSearch size={12} aria-hidden="true" /> {cur.section} {cur.heading}</span>
          <p>&ldquo;{cur.snippet}&rdquo;</p>
        </div>
        <p className="m-0 mb-2.5 text-[var(--text-3)]">
          12.3 Governing law. This agreement shall be governed by the laws of India, and the courts of
          New Delhi shall have exclusive jurisdiction…
        </p>
      </div>
    </div>
  )
}
