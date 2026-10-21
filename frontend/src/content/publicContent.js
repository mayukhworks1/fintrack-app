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

/** The one line that says what FinTrack is: the footer and the home page badge share it. */
export const TAGLINE = 'Project delivery and project finance on one set of records, for firms in India that bill by project.'

export const MODULES = [
  {
    visual: 'ledger', id: 'receivables',
    title: 'Invoices',
    body: 'Every invoice sits in an ageing band with a collection rate and the average days to collect. GST and TDS are kept as separate figures, so the outstanding total is money a client still owes.',
    points: ['Ageing bands of 0-30, 31-60, 61-90 and 90+ days', 'Follow-ups due today, overdue and next', 'Retainer templates for monthly billing'],
  },
  {
    visual: 'margin', id: 'projects',
    title: 'Projects',
    body: 'Billed, cost and realised profit for each project, with a margin health signal so a job that is losing money shows up while it can still be fixed.',
    points: ['Billed, profit and margin per project', 'Healthy, watch and at-risk from the margin', 'Client rollups and invoice history'],
  },
  {
    visual: 'bars', id: 'analytics',
    title: 'Analytics',
    body: 'Cash position, billing and overdue amounts over any period. Each chart opens to the invoices behind it.',
    points: ['Billed against collected, month by month', 'Breakdowns by client, project and category', 'When the figures were last synced'],
  },
  {
    visual: 'tax', id: 'tax',
    title: 'Tax ledger',
    body: 'Gross billed, GST collected and net receivable by month and by client, kept apart from the cash view so a filing figure is never read as a collections figure.',
    points: ['Monthly GST and net receivable', 'GST collection rate', 'A filing checklist and CSV export'],
  },
  {
    visual: 'analyst', id: 'reports',
    title: 'Executive reports',
    body: 'A written report for a period, drawn from your own figures, kept in a history you can reopen, with an assistant that already has the current numbers loaded.',
    points: ['Board, brief and detailed formats', 'Report history', 'Follow-up questions in context'],
  },
  {
    visual: 'docs', id: 'documents',
    title: 'Document intelligence',
    body: 'Ask a question of your contracts, scopes and statements. Each claim in the answer is numbered to the passage and page it came from.',
    points: ['PDF, text, Markdown, CSV and JSON', 'Citations to page and passage', 'Answers checked against their sources'],
  },
  {
    visual: 'table', id: 'analyst',
    title: 'Financial query engine',
    body: 'Ask about invoices and projects in plain words. The question is mapped to a measure and a grouping from a fixed list, the application writes the SQL, and the query is printed beside the answer.',
    points: ['Outstanding, collected, GST, TDS and collection rate', 'Grouped by project, client, category or month', 'Limited to the rows your account can see'],
  },
  {
    visual: 'pages', id: 'pages',
    title: 'Pages',
    body: 'Write a page or edit a spreadsheet, then publish it on a link with an optional password, protection code and expiry in IST. Links unfurl as previews in chat apps, and each page counts its views by day, device and country.',
    points: ['Pages and spreadsheets in folders, with formulas and ₹ formats', 'Password, protection code or expiry (IST) on a link', 'Views per day, device and country'],
  },
  {
    visual: 'board', id: 'status',
    title: 'Delivery & status',
    body: 'Where every project stands, as a kanban board or a list, grouped by client, project or state and updated live as anyone edits. The board reads the same records as the money, so each card shows what its project is still owed.',
    points: ['Kanban board or list', 'Live updates over an event stream', 'Status options you extend yourself'],
  },
  {
    visual: 'share', id: 'shared',
    title: 'Shared views',
    body: 'Send a client a filtered, read-only view on a link, and see what they opened.',
    points: ['Read-only links that keep your filters', 'Columns highlighted for the reader', 'Viewers, opens and a timeline'],
  },
  {
    visual: 'audit', id: 'admin',
    title: 'Admin & audit',
    body: 'Account approval, a permission matrix down to the single action, live sessions, and a record of every request, written in the background so it never slows the page it records.',
    points: ['Grant or revoke one permission for one person', 'Every request and every changed field', 'Sync log and deployment health', 'AI gateway: provider routes, daily caps, versioned prompts and a call log'],
  },
]

export const SECURITY = [
  { title: 'Nothing on this page is your data',
    body: 'These pages describe the product. Your figures, clients, projects and documents stay behind sign-in and are never rendered publicly.' },
  { title: 'Permissions down to the action',
    body: 'Roles carry defaults, and any single permission can be granted or revoked for one person. The change applies from their next request.' },
  { title: 'Rows are limited when the query is built',
    body: 'Row scoping comes from the session as the statement is assembled, so an account with narrower access cannot reach wider data by asking differently.' },
  { title: 'Every request is recorded',
    body: 'Who, what, when and from where, written in the background so the record never slows down the request it describes.' },
]

/* Why the product exists, stated as the three things that are actually wrong
   with how this work gets done today. Each one is a problem the modules above
   answer directly — a grievance with no corresponding feature is marketing. */

export const PROBLEMS = [
  {
    title: 'A total nobody can trace',
    body: 'A figure reaches a dashboard with no way back to the rows underneath. When two reports disagree, the argument is settled by whoever exported last.',
  },
  {
    title: 'Tax withheld counted as money owed',
    body: 'TDS is deducted by the client before they pay. Most receivables reports leave it in the outstanding column, which overstates what you can collect and hides the invoices that are genuinely late.',
  },
  {
    title: 'An answer with no query behind it',
    body: 'Ask a chat assistant for a total and it writes a number, with nothing you can read to say where it came from. Here the model only picks a measure and a grouping; the application writes and runs the SQL and prints it beside the figure.',
  },
]

/* The claim the rest of the product rests on. Every line here is a mechanism,
   not an adjective: something that is either in the code or is not. */

export const TRUST = [
  {
    title: 'The model never writes SQL',
    body: 'It chooses a measure and a grouping from a fixed set. The application compiles the statement, runs it and shows it next to the answer. There is no path from a sentence to arbitrary SQL, which is also why the analyst cannot be talked into reading something it should not.',
  },
  {
    title: 'Scoped where the query is built',
    body: 'Row limits come from the session at the moment the statement is assembled. What the screen happens to render has no say, so an account cannot widen its own results by changing what it asks for.',
  },
  {
    title: 'Document answers carry citations',
    body: 'Ask a contract a question and each claim in the reply is numbered to the passage and page it came from. The answer is checked against those sources before it reaches you, and you can open every one.',
  },
  {
    title: 'Everything is written down',
    body: 'Who did what, when, from where, and which fields changed. It is recorded in the background, so the audit trail is never the reason a page is slow.',
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
    kicker: 'You, in the app',
    title: 'Set up in the app by your own team',
    body: 'Permissions are records: each belongs to a module, roles map to them, and a single permission can be granted or revoked for one person without a new role. Views keep your filters, columns and grouping, and carry them into a shared link. Categories, clients and statuses come from your own records, so there is no chart of accounts to adopt.',
  },
  {
    kicker: 'Your infrastructure',
    title: 'Your database, your cloud',
    body: 'An instance is a container and an environment file. Every endpoint, table, model, mail server and storage target is a setting, so a dedicated deployment on your own Postgres and private cloud runs the same build as everyone else and keeps receiving its fixes.',
  },
  {
    kicker: 'Built for you',
    title: 'New modules for your case',
    body: 'Each module is a self-contained router, and permissions are keyed by module in the database. A module built for how your business works therefore arrives inside the access model and the audit trail: it appears in the permission matrix on day one, and every request it serves is recorded.',
  },
]

export const STEPS = [
  {
    title: 'Your records stay where they are',
    body: 'The base you already work in remains the system of record. FinTrack reads and writes it directly: no migration, no export, and no second place for someone to update.',
  },
  {
    title: 'Mirrored into Postgres for speed',
    body: 'A mirror is kept current by webhooks, an incremental pass every thirty seconds and a periodic full reconciliation. Lists filter and sort against the mirror, so a screen of invoices opens at once.',
  },
  {
    title: 'Questions compiled to SQL',
    body: 'A question in plain words is mapped to a known measure and grouping, and the application compiles that to parameterised SQL. The statement is shown with the answer.',
  },
]

/* Written as questions someone actually types, and answered properly. These
   are the page's most-read text after the hero — and, as a details/summary
   list, they are in the document whether or not anyone opens them. */

export const FAQ = [
  {
    q: 'What does FinTrack actually do?',
    group: 'The product',
    a: 'It runs receivables, projects, GST and reporting for businesses in India that bill by project: agencies, studios, consultancies and firms on retainers. Invoices carry ageing bands, collection rate and days-to-collect; projects carry billed, cost, realised profit and margin; tax sits in its own ledger; and an AI analyst answers questions across all of it while showing the query it ran.',
  },
  {
    q: 'Is the demo on this page real data?',
    group: 'The product',
    a: 'No. Every client, project, invoice and figure in the sandbox is computed client-side in your browser; the page makes no API call at all. What is real is the behaviour: the filters filter, the columns sort, the ageing bands are genuine predicates over those rows, and the analyst answers are produced by the same function that prints the SQL beside them. Add the columns up and they agree, because there is only one set of rows.',
  },
  {
    q: 'How is this different from a spreadsheet?',
    group: 'The product',
    a: 'A spreadsheet gives you a number with no way back to where it came from, and a second copy of that number the moment someone filters differently. Here every module reads the same records, so a figure on the dashboard and a figure in a report cannot disagree, and any total can be opened to the invoices behind it.',
  },
  {
    q: 'Can the AI analyst invent a figure?',
    group: 'Data & AI',
    a: 'No. The model never writes SQL: it selects a measure and a grouping from a fixed list, and the application compiles and runs the statement itself. The query is shown with every answer, so a figure about money can be checked. The same design is why the analyst cannot be prompted into reading data the signed-in account is not allowed to see: scoping is applied when the statement is built.',
  },
  {
    q: 'How does it handle GST and TDS?',
    group: 'The product',
    a: 'Separately, and on purpose. GST collected is tracked month by month and per client in its own ledger with a filing checklist, kept apart from the cash view so a filing figure is never mistaken for a collections figure. TDS is tax the client withholds at source before paying: it is reported, but it is never counted as outstanding, because it is not money a client still owes you.',
  },
  {
    q: 'Can I share something with a client without giving them an account?',
    group: 'The product',
    a: 'Yes. Any filtered view can be published as a read-only link, optionally password-protected and set to expire, with the columns you want read first highlighted. You then see unique viewers, page views, which records and attachments were opened, and a timeline of what happened, and you can revoke the link at any time.',
  },
  {
    q: 'What can it do with documents?',
    group: 'Data & AI',
    a: 'Upload contracts, scopes and notes as PDF, text, Markdown, CSV, JSON or logs, then ask questions about them in plain words. Each answer carries numbered citations you can open to the exact passage and page, and answers are verified against those sources before you see them. The interface also says which retrieval is actually running.',
  },
  {
    q: 'How much of this can we change ourselves?',
    group: 'Fit & deployment',
    a: 'Most of what a finance team wants different is a setting rather than a request. Permissions are records grouped by module: roles carry defaults, and any single permission can be granted or revoked for one person without inventing a new role for them. A change applies from their next request. Views keep your own filters, columns and grouping, and that configuration travels into a shared link. Categories, clients, projects and statuses come from your own records, so there is no chart of accounts to adopt.',
  },
  {
    q: 'Can we run it on our own database and our own cloud?',
    group: 'Fit & deployment',
    a: 'Yes. The backend is a container and every endpoint, table, model, mail server and storage target is an environment setting rather than a constant, so a dedicated instance on your own Postgres inside your own private cloud is a configuration of the same build. It is the same build as everyone else runs, so it keeps receiving the same fixes and features.',
  },
  {
    q: 'Can you build a module for how our business works?',
    group: 'Fit & deployment',
    a: 'Yes, and the architecture is why it is worth doing properly. Each module is a self-contained router, and permissions are keyed by module in the database: so a module built for your case arrives inside the access model and the audit trail. It appears in the permission matrix from the first day, every request it serves is recorded like any other, and it reads the same mirrored rows as everything else, so its figures cannot disagree with the rest of the product.',
  },
  {
    q: 'Is anything deliberately not configurable?',
    group: 'Data & AI',
    a: 'One thing: the set of measures the AI analyst is allowed to use. It picks a measure and a grouping from a closed list and the application compiles the SQL, which is the reason an answer here can be checked. Opening that set up at question time would make the analyst more flexible and its answers worth less. New measures are added deliberately and reviewed, the same way a new module is.',
  },
  {
    q: 'Can I publish a spreadsheet to a client?',
    group: 'The product',
    a: 'Yes. Pages keeps pages and spreadsheets in folders, and its spreadsheet editor has formulas and ₹ number formats. Publish a page or a sheet on a link, optionally with a password, a protection code and an expiry date and time in IST. The link unfurls as a preview card in chat apps, and each page shows its views per day, device and country.',
  },
  {
    q: 'Which AI providers does it use, and where are the keys?',
    group: 'Data & AI',
    a: 'Groq and OpenRouter, behind one gateway. Each AI task has an ordered route of provider and model steps, a daily cap and a versioned prompt, and every call is logged. Provider keys are stored encrypted on the server. A superadmin switches each task on or off, and the day behind every daily cap starts at midnight IST.',
  },
  {
    q: 'Who can see what?',
    group: 'Access',
    a: 'Roles carry sensible defaults and any individual permission can be granted or revoked per person. A change applies from the next request. Every request is recorded with method, path, status, duration and origin, and record-level history keeps which fields changed and who changed them.',
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
    'Delivery and the money for it, in one place, for businesses in India that bill by project. A live project status board, receivables with GST and TDS kept separate, project margin, document search, and an analyst that shows the query behind every figure.',
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
