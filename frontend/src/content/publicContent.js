/**
 * Everything the public pages say, in one place.
 *
 * These arrays used to live inside Landing.jsx, which was fine while there
 * was one public page and wrong the moment the page was split into six: a
 * component file is a strange place to keep the product's claims, and
 * importing a marketing list out of a route in order to test it is stranger
 * still. Pages render; this decides what they render.
 *
 * Every entry names something that ships. A public page describing a feature
 * the product does not have is the fastest way to lose the trust the rest of
 * it is trying to earn.
 */
import {
  Receipt, FolderKanban, BarChart3, Sparkles, Globe, Activity, ShieldCheck,
  Share2, Lock, Database, Zap, FileSearch, Landmark, FileText, Gauge,
  GitBranch, ScrollText, SlidersHorizontal, Server, Blocks,
} from 'lucide-react'

export const MODULES = [
  {
    icon: Receipt, span: 'span-3', visual: 'ledger',
    title: 'Receivables',
    body: 'Invoices with aging bands, collection rate and average days to collect. GST and TDS are tracked separately — tax withheld at source is not money a client still owes you.',
    points: ['Aging bands you can filter by', 'Collection rate and follow-up load', 'Missing docs and retainer templates'],
  },
  {
    icon: FolderKanban, span: 'span-3', visual: 'margin',
    title: 'Projects',
    body: 'Billing, cost and realised profit per project, with margin and health surfaced before a job quietly goes underwater.',
    points: ['Profit and margin per project', 'At-risk and critical health signals', 'Client rollups and invoice history'],
  },
  {
    icon: BarChart3, span: 'span-4', visual: 'bars',
    title: 'Analytics',
    body: 'Cash position, revenue, collection rate and overdue pressure over any period — plus signals worth noticing, surfaced rather than left to be found. Every chart is one click from the rows behind it.',
    points: ['Cash position and overdue pressure', 'Client, project and category breakdowns', 'Sync state, so you know how fresh it is'],
  },
  {
    icon: Landmark, span: 'span-2', visual: 'tax',
    title: 'Tax ledger',
    body: 'Gross billed, GST collected and net receivable, month by month — kept apart from the cash view so a filing figure is never mistaken for a collections figure.',
    points: ['Monthly GST and net receivable', 'GST collection rate', 'Filing checklist'],
  },
  {
    icon: FileText, span: 'span-2', visual: 'analyst',
    title: 'AI reports & assistant',
    body: 'A written period report over your own figures, kept in a history you can reopen — and an assistant that already has the current context loaded.',
    points: ['Brief, detailed or board-style', 'Report history', 'Assistant with live context'],
  },
  {
    icon: FileSearch, span: 'span-4', visual: 'docs',
    title: 'Studio — documents',
    body: 'Upload contracts and notes, then ask questions about them. Every answer carries numbered citations you can open to the exact page it came from, and the answer is checked against those sources before you see it.',
    points: ['PDF, text, Markdown, CSV, JSON', 'Page-level citations, opened inline', 'Answers checked against sources'],
  },
  {
    icon: Sparkles, span: 'span-6', visual: 'table',
    title: 'Studio — finance data',
    body: 'Ask your invoices and projects a question in plain words. The model picks measures and groupings; the code compiles the SQL. The statement is shown with every answer, so a figure about money can always be checked.',
    points: ['Outstanding, collected, GST, TDS, collection rate', 'Group by project, client, category, month or quarter', 'Scoped to what your account may already see'],
  },
  {
    icon: Globe, span: 'span-3', visual: 'pages',
    title: 'Pages',
    body: 'Describe a page and watch it get written, then publish it on a slug — optionally password-protected, optionally set to expire.',
    points: ['Streamed as it writes', 'Surgical revisions and version history', 'Password, expiry and view counts'],
  },
  {
    icon: Activity, span: 'span-3', visual: 'board',
    title: 'Delivery & status',
    body: 'Where every project actually stands — a kanban board or an operational list, grouped by client, project or state, updating live as anyone edits. Delivery sits on the same records as the money, so a card knows what its project is owed.',
    points: ['Kanban board or operational list', 'Live over an event stream, app or table', 'Extendable status options, AI-drafted updates'],
  },
  {
    icon: Share2, span: 'span-3', visual: 'share',
    title: 'Shared views',
    body: 'Send a filtered, read-only view to a client on a link, and see what they actually opened.',
    points: ['Read-only links with your filters', 'Column highlighting', 'Viewers, opens and an event timeline'],
  },
  {
    icon: ShieldCheck, span: 'span-3', visual: 'audit',
    title: 'Admin & audit',
    body: 'Account approval, a permission matrix down to the individual action, live sessions, and a full request trail written asynchronously so it never slows the page it is recording.',
    points: ['Permissions granted or revoked per person', 'Every request and every field change', 'Sync log, AI runs, deployment health'],
  },
]

export const SECURITY = [
  { icon: Lock,        title: 'Nothing on this page is your data',
    body: 'Everything above describes what the product does. Figures, clients, projects and documents live behind sign-in and are never rendered publicly.' },
  { icon: ShieldCheck, title: 'Permissions down to the action',
    body: 'Roles carry defaults and any individual permission can be granted or revoked per person. A change takes effect on the next request, not the next login.' },
  { icon: Database,    title: 'Scoped at the query, not the screen',
    body: 'Row scoping is applied when the query is built, from the session — so a narrower account cannot reach wider data by changing what it asks for.' },
  { icon: Zap,         title: 'Every request is recorded',
    body: 'Who, what, when and from where, written asynchronously so the audit trail never slows down the thing it is auditing.' },
]

/* Why the product exists, stated as the three things that are actually wrong
   with how this work gets done today. Each one is a problem the modules above
   answer directly — a grievance with no corresponding feature is marketing. */

export const PROBLEMS = [
  {
    icon: Gauge,
    title: 'The total is right. Nobody can prove it.',
    body: 'A figure arrives on a dashboard with no way back to the rows underneath. When two reports disagree — and they do — the argument is settled by whoever exported last, not by the data.',
  },
  {
    icon: Landmark,
    title: 'Tax withheld gets counted as money owed.',
    body: 'TDS is deducted by the client before they pay. Most receivables reports quietly leave it in the outstanding column, which overstates what you can actually collect and hides the invoices that are genuinely late.',
  },
  {
    icon: Sparkles,
    title: 'An assistant that guesses is worse than none.',
    body: 'Bolt a chat window onto a ledger and it will confidently invent a total. On money, an answer you cannot check is not a faster answer — it is a liability with better manners.',
  },
]

/* The claim the rest of the product rests on. Every line here is a mechanism,
   not an adjective: something that is either in the code or is not. */

export const TRUST = [
  {
    icon: ScrollText,
    title: 'The model never writes SQL',
    body: 'It chooses a measure and a grouping from a fixed set. The application compiles the statement, runs it, and shows it to you next to the answer. There is no path from a sentence to arbitrary SQL, which is the same reason the analyst cannot be talked into reading something it should not.',
  },
  {
    icon: Lock,
    title: 'Scoped where the query is built',
    body: 'Row limits come from the session at the moment the statement is assembled, not from what the screen chose to render. A narrower account cannot widen its own results by changing what it asks for.',
  },
  {
    icon: FileSearch,
    title: 'Document answers carry citations',
    body: 'Ask a contract a question and each claim in the reply is numbered to the passage and page it came from. The answer is checked against those sources before it reaches you, and you can open every one.',
  },
  {
    icon: ScrollText,
    title: 'Everything is written down',
    body: 'Who did what, when, from where, and which fields changed — recorded asynchronously so the audit trail never becomes the reason a page is slow.',
  },
]

/*
 * Three tiers, in the order a buyer meets them, and each one checked against
 * what the repository actually supports before it was written down. "Fully
 * customisable" on its own is the least believable sentence on a product page;
 * these say who does the work and what it touches.
 */

export const SHAPE = [
  {
    icon: SlidersHorizontal,
    kicker: 'You, in the app',
    title: 'Configured, not commissioned',
    body: 'Permissions are records, not code — every one belongs to a module, roles map to them, and a single permission can be granted or revoked for one person without inventing a role for them. Views keep your filters, your columns and your grouping, and the same configuration travels into a shared link. Categories, clients and statuses come from your own records; there is no chart of accounts to adopt.',
  },
  {
    icon: Server,
    kicker: 'Your infrastructure',
    title: 'Your database, your cloud',
    body: 'An instance is a container and an environment file. Every endpoint, table, model, mail server and storage target is a setting rather than a constant, so a dedicated deployment on your own Postgres and your own private cloud is a configuration of the same build — not a fork that drifts from it and stops receiving fixes.',
  },
  {
    icon: Blocks,
    kicker: 'Built for you',
    title: 'New modules for your case',
    body: 'Each module is a self-contained router, and permissions are keyed by module in the database. A module built for how your business works therefore arrives inside the access model and the audit trail rather than beside them: it appears in the permission matrix on day one, and every request it serves is recorded like every other.',
  },
]

export const STEPS = [
  {
    icon: Database,
    title: 'Your records stay where they are',
    body: 'The base you already work in remains the system of record. FinTrack reads and writes it directly. There is no migration, no export, and no second place for someone to update instead.',
  },
  {
    icon: GitBranch,
    title: 'Mirrored into Postgres for speed',
    body: 'A mirror is kept current by webhooks, a thirty-second incremental pass and a periodic full reconciliation. Lists filter and sort against the mirror, so a screen full of invoices is instant instead of a round trip per view.',
  },
  {
    icon: Sparkles,
    title: 'Ask it in plain words',
    body: 'Questions are mapped onto a fixed set of measures and groupings and compiled to SQL by the application. You get the answer, the chart and the statement that produced them, every time.',
  },
]

/* Written as questions someone actually types, and answered properly. These
   are the page's most-read text after the hero — and, as a details/summary
   list, they are in the document whether or not anyone opens them. */

export const FAQ = [
  {
    q: 'What does FinTrack actually do?',
    group: 'The product',
    a: 'It runs receivables, projects, GST and reporting for businesses that bill by project — agencies, studios, consultancies and firms working on retainers. Invoices carry ageing bands, collection rate and days-to-collect; projects carry billed, cost, realised profit and margin; tax sits in its own ledger; and an AI analyst answers questions across all of it while showing the query it ran.',
  },
  {
    q: 'Is the demo on this page real data?',
    group: 'The product',
    a: 'No. Every client, project, invoice and figure in the sandbox is invented and computed in your browser — the page makes no API call at all. What is real is the behaviour: the filters filter, the columns sort, the ageing bands are genuine predicates over those rows, and the analyst answers are produced by the same function that prints the SQL beside them. Add the columns up and they agree, because there is only one set of rows.',
  },
  {
    q: 'How is this different from a spreadsheet?',
    group: 'The product',
    a: 'A spreadsheet gives you a number with no way back to where it came from, and a second copy of that number the moment someone filters differently. Here every module reads the same records, so a figure on the dashboard and a figure in a report cannot disagree, and any total can be opened to the invoices behind it.',
  },
  {
    q: 'Can the AI analyst invent a figure?',
    group: 'Data & AI',
    a: 'It is not able to. The model never writes SQL — it selects a measure and a grouping from a fixed list, and the application compiles and runs the statement itself. The query is shown with every answer, so a figure about money can be checked rather than trusted. The same design is why the analyst cannot be prompted into reading data the signed-in account is not allowed to see: scoping is applied when the statement is built.',
  },
  {
    q: 'How does it handle GST and TDS?',
    group: 'The product',
    a: 'Separately, and on purpose. GST collected is tracked month by month and per client in its own ledger with a filing checklist, kept apart from the cash view so a filing figure is never mistaken for a collections figure. TDS is tax the client withholds at source before paying — it is reported, but it is never counted as outstanding, because it is not money a client still owes you.',
  },
  {
    q: 'Can I share something with a client without giving them an account?',
    group: 'The product',
    a: 'Yes. Any filtered view can be published as a read-only link, optionally password-protected and set to expire, with the columns you want read first highlighted. You then see unique viewers, page views, which records and attachments were opened, and a timeline of what happened — and you can revoke the link at any time.',
  },
  {
    q: 'What can it do with documents?',
    group: 'Data & AI',
    a: 'Upload contracts, scopes and notes as PDF, text, Markdown, CSV, JSON or logs, then ask questions about them in plain words. Each answer carries numbered citations you can open to the exact passage and page, and answers are verified against those sources before you see them. The interface also states which retrieval is actually running rather than implying a capability it does not have.',
  },
  {
    q: 'How much of this can we change ourselves?',
    group: 'Fit & deployment',
    a: 'Most of what a finance team wants different is a setting rather than a request. Permissions are records grouped by module: roles carry defaults, and any single permission can be granted or revoked for one person without inventing a new role for them — a change takes effect on their next request, not their next sign-in. Views keep your own filters, columns and grouping, and that configuration travels into a shared link. Categories, clients, projects and statuses come from your own records, so there is no chart of accounts to adopt.',
  },
  {
    q: 'Can we run it on our own database and our own cloud?',
    group: 'Fit & deployment',
    a: 'Yes. The backend is a container and every endpoint, table, model, mail server and storage target is an environment setting rather than a constant, so a dedicated instance on your own Postgres inside your own private cloud is a configuration of the same build. That matters more than it sounds: it is not a fork, so it keeps receiving the same fixes and features as everything else rather than drifting into a version only you are running.',
  },
  {
    q: 'Can you build a module for how our business works?',
    group: 'Fit & deployment',
    a: 'Yes, and the architecture is why it is worth doing properly. Each module is a self-contained router, and permissions are keyed by module in the database — so a module built for your case arrives inside the access model and the audit trail rather than bolted beside them. It appears in the permission matrix from the first day, every request it serves is recorded like any other, and it reads the same mirrored rows as everything else, so its figures cannot disagree with the rest of the product.',
  },
  {
    q: 'Is anything deliberately not configurable?',
    group: 'Data & AI',
    a: 'One thing: the set of measures the AI analyst is allowed to use. It picks a measure and a grouping from a closed list and the application compiles the SQL, which is the entire reason an answer here can be checked rather than trusted. Opening that set up at question time would make the analyst more flexible and its answers worth less. New measures are added to it deliberately and reviewed, the same way a new module is — never inferred in the moment someone asks.',
  },
  {
    q: 'Who can see what?',
    group: 'Access',
    a: 'Roles carry sensible defaults and any individual permission can be granted or revoked per person. A change takes effect on the next request rather than the next login. Every request is recorded with method, path, status, duration and origin, and record-level history keeps which fields changed and who changed them.',
  },
  {
    q: 'How do I get an account?',
    group: 'Access',
    a: 'Access is by invitation and an administrator approves each account before it can see anything. You can sign in with email, Google or Zoho. Nothing on this public page is read from a workspace, so there is nothing to see until an account exists.',
  },
]

/* Search engines read this; people read the page. Both should get the same
   claims, which is why every answer below is lifted from the FAQ above
   rather than written separately for a crawler. */

/* ── Structured data ────────────────────────────────────────────────────
   Search engines read this; people read the page. Both get the same claims,
   which is why the FAQ answers below are the array above rather than a
   second set written for a crawler. */
export const SITE = 'https://twfintracker.worksmayukh.space'

/** The FAQ, in the order the groups should be read. */
export const FAQ_GROUPS = [...new Set(FAQ.map(f => f.group))]
  .map(name => ({ name, items: FAQ.filter(f => f.group === name) }))

export const APP_LD = {
  '@type': 'SoftwareApplication',
  name: 'FinTrack',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Delivery and the money for it, in one place. A live project status board, receivables with GST and TDS kept separate, project profitability, document search, and an AI analyst that shows the query behind every figure — for businesses that bill by project.',
  url: SITE + '/',
  featureList: MODULES.map(m => m.title),
}

export const FAQ_LD = {
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

/** A page's breadcrumb, so a result shows where it sits rather than a bare URL. */
export const crumbs = (trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: 'Overview', path: '/' }, ...trail].map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: SITE + c.path,
  })),
})

export const graph = (...nodes) => ({ '@context': 'https://schema.org', '@graph': nodes })
