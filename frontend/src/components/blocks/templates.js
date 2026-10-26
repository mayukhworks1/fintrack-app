// Starter documents for the block editor, built as TipTap JSON.
import { serializeDoc } from './docText'

const t = (text, ...marks) => (marks.length ? { type: 'text', text, marks: marks.map(m => (typeof m === 'string' ? { type: m } : m)) } : { type: 'text', text })
const inl = (parts) => parts.map(p => (typeof p === 'string' ? t(p) : p)).filter(p => p.text !== '')
const p = (...parts) => (parts.length ? { type: 'paragraph', content: inl(parts) } : { type: 'paragraph' })
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const bullets = (...items) => ({ type: 'bulletList', content: items.map(i => ({ type: 'listItem', content: [p(...[].concat(i))] })) })
const numbered = (...items) => ({ type: 'orderedList', content: items.map(i => ({ type: 'listItem', content: [p(...[].concat(i))] })) })
const todos = (...items) => ({ type: 'taskList', content: items.map(([checked, text]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })) })
const callout = (icon, tone, ...content) => ({ type: 'callout', attrs: { icon, tone }, content })
const toggle = (summary, ...content) => ({ type: 'details', attrs: { open: false }, content: [{ type: 'detailsSummary', content: [t(summary)] }, { type: 'detailsContent', content }] })
const hr = () => ({ type: 'horizontalRule' })
const quote = (...content) => ({ type: 'blockquote', content })
const cell = (text, header) => ({ type: header ? 'tableHeader' : 'tableCell', content: [p(...(text ? [text] : []))] })
const table = (head, ...rows) => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map(c => cell(c, true)) },
    ...rows.map(r => ({ type: 'tableRow', content: r.map(c => cell(c, false)) })),
  ],
})
const doc = (...content) => serializeDoc({ type: 'doc', content })

const today = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
const b = (s) => t(s, 'bold')

export function docTemplates() {
  return [
    { name: 'Blank', icon: '📄', content: '' },
    {
      name: 'Meeting notes', icon: '📋',
      content: doc(
        callout('🗓️', 'blue', p(b('Date: '), today(), '   ', b('Attendees: '), '@name, @name')),
        h(2, 'Agenda'),
        numbered('Updates since last meeting', 'Decisions needed', 'Open questions'),
        h(2, 'Notes'),
        bullets('Key point discussed', 'Another point worth recording'),
        h(2, 'Decisions'),
        bullets('What was agreed, and by whom'),
        h(2, 'Action items'),
        todos([false, 'Task — owner — due date'], [false, 'Task — owner — due date'], [false, 'Task — owner — due date']),
        toggle('Parking lot', p('Topics to pick up next time.')),
      ),
    },
    {
      name: 'Project brief', icon: '🎯',
      content: doc(
        callout('💡', 'default', p(b('In one sentence: '), 'what this project delivers, for whom, and by when.')),
        h(2, 'Background'),
        p('Why this matters now. What problem are we solving and what happens if we do nothing?'),
        h(2, 'Goals'),
        bullets('Primary outcome, stated so it can be measured', 'Secondary outcome'),
        h(2, 'Out of scope'),
        bullets('What this project will not do'),
        h(2, 'Milestones'),
        table(['Milestone', 'Owner', 'Target date', 'Status'],
          ['Discovery complete', '', '', 'Not started'],
          ['First release', '', '', 'Not started'],
          ['Launch', '', '', 'Not started']),
        h(2, 'Budget'),
        p('Estimated cost and how it is split.'),
        h(2, 'Risks'),
        callout('⚠️', 'yellow', p('The biggest risk, its likelihood, and the plan if it happens.')),
        toggle('Stakeholders', bullets('Sponsor —', 'Project lead —', 'Reviewers —')),
      ),
    },
    {
      name: 'Weekly update', icon: '🗞️',
      content: doc(
        p(t('Week of ', 'italic'), t(today(), 'italic')),
        callout('✅', 'green', p(b('Summary: '), 'one or two sentences a busy reader can stop at.')),
        h(2, 'Shipped this week'),
        bullets('What went out and why it matters'),
        h(2, 'In progress'),
        todos([false, 'Work item — expected finish'], [false, 'Work item — expected finish']),
        h(2, 'Blockers'),
        callout('🚫', 'red', p('Anything that needs a decision or help, and from whom.')),
        h(2, 'Numbers'),
        table(['Metric', 'This week', 'Last week', 'Change'], ['', '', '', ''], ['', '', '', '']),
        h(2, 'Next week'),
        bullets('Top priority', 'Second priority'),
      ),
    },
    {
      name: 'Client proposal', icon: '🤝',
      content: doc(
        p(t('Prepared for ', 'italic'), t('Client name', 'italic', 'bold'), t(' · ', 'italic'), t(today(), 'italic')),
        h(1, 'Proposal'),
        quote(p('A one-paragraph summary of what you will deliver and the outcome the client gets.')),
        h(2, 'Understanding your needs'),
        p('What we heard, in the client’s own words where possible.'),
        h(2, 'Scope of work'),
        bullets([b('Phase 1 — Discovery: '), 'workshops, audit, plan'], [b('Phase 2 — Build: '), 'design and delivery'], [b('Phase 3 — Launch: '), 'rollout and handover']),
        h(2, 'Timeline'),
        table(['Phase', 'Duration', 'Deliverables'], ['Discovery', '2 weeks', 'Findings report'], ['Build', '6 weeks', 'Working release'], ['Launch', '1 week', 'Live product, training']),
        h(2, 'Investment'),
        table(['Item', 'Amount (₹)'], ['Discovery', ''], ['Build', ''], ['Launch & support', ''], ['Total (excl. GST)', '']),
        callout('📌', 'purple', p(b('Payment terms: '), '40% on signing, 40% at first release, 20% on launch.')),
        h(2, 'Why us'),
        bullets('Relevant experience', 'How we work'),
        hr(),
        h(2, 'Next steps'),
        todos([false, 'Review this proposal'], [false, 'Schedule a call to confirm scope'], [false, 'Sign and kick off']),
      ),
    },
  ]
}
