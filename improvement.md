# FinTrack Improvement Review

Date: 2026-05-10
Method: Read-only project review. No application code was changed. The only edited file is this document.

## Review Scope

I reviewed the authored repository files across:

- root docs and config
- GitHub Actions workflows
- backend app, services, routers, DB helpers, config, Dockerfile, env example
- frontend app, pages, components, hooks, contexts, styles, Vite/Tailwind config, env example
- `memory.md`

I intentionally excluded generated or vendor content from conclusions:

- `frontend/node_modules`
- `frontend/dist`
- Python cache folders
- Git object storage and metadata
- local editor/system artifacts

That means this review is based on the full maintained codebase, not just selected screens or a partial pass.

## Files Reviewed

Root and repo config:

- `README.md`
- `.gitignore`
- `vercel.json`
- `memory.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-frontend.yml`
- `.github/workflows/deploy-backend.yml`

Backend:

- `backend/.env.example`
- `backend/.gitignore`
- `backend/README.md`
- `backend/Dockerfile`
- `backend/render.yaml`
- `backend/requirements.txt`
- `backend/app/config.py`
- `backend/app/main.py`
- `backend/app/models.py`
- `backend/app/routers/*.py`
- `backend/app/services/*.py`
- `backend/app/db/*.py`
- `backend/app/utils/*.py`

Frontend:

- `frontend/.env.example`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/postcss.config.js`
- `frontend/tailwind.config.js`
- `frontend/vite.config.js`
- `frontend/vercel.json`
- `frontend/public/_redirects`
- `frontend/public/favicon.svg`
- `frontend/src/App.jsx`
- `frontend/src/main.jsx`
- `frontend/src/context/*.jsx`
- `frontend/src/hooks/*.js`
- `frontend/src/components/*.jsx`
- `frontend/src/pages/*.jsx`
- `frontend/src/services/api.js`
- `frontend/src/utils/format.js`
- `frontend/src/index.css`

## What The Project Is Now

This is no longer a small CRUD app. It is a real internal finance operations system with:

- a main project and invoice app
- a separate web invoice tracker
- a separate web projects/resources workspace
- an admin/ops surface
- AI-assisted finance Q&A and invoice parsing
- Teable as write source of truth
- PostgreSQL mirrors for analytics, AI context, and ops history
- Valkey for cache, throttling, and session support

The architecture is materially better than a typical internal tool. The next improvement stage is not "add more features fast". It is "reduce operational risk and reduce drift".

## Strong Areas

### 1. Backend layering is fundamentally sound

The backend split between routers, services, DB helpers, and utility code is sensible. `backend/app/main.py`, `backend/app/db/sync.py`, `backend/app/db/audit.py`, and the service modules show a clear attempt to separate transport, domain logic, and persistence concerns.

### 2. The mirror strategy is the right long-term move

Using PostgreSQL mirrors instead of reading Teable directly for every analytics or AI query is the correct architectural direction. The sync layer is already meaningful, not cosmetic.

### 3. The frontend request layer is stronger than average

`frontend/src/services/api.js` has dedupe, timeout handling, simple retry logic, auth-expiry behavior, and endpoint grouping. For a Vite React app of this size, that is a good foundation.

### 4. The product logic is real and domain-specific

The invoice rules, retainer handling, audit/session tracking, and AI answer cleanup are clearly built around a real workflow rather than sample-app abstractions.

### 5. Operational surfaces already exist

The admin dashboard, audit log, sync APIs, webhook handling, and role-separated routes give this project the beginnings of a real ops platform, not just a UI over a table.

## Highest-Priority Improvements

### 1. Tighten security defaults before adding more surface area

This is the biggest repo-level weakness.

Observed in code:

- `backend/app/main.py` allows wildcard CORS
- `backend/app/config.py` defaults `frontend_url="*"`
- `backend/app/config.py` defaults `app_secret="fintrack-dev-secret-change-me"`
- `backend/app/config.py` defaults `app_admin_password="Master@2026"`
- auth is still password-to-role based in `backend/app/routers/auth.py`

Why this matters:

- the system now has editor, viewer, web, all, and admin-style capabilities
- the rest of the codebase has become more operationally serious than these defaults
- default-like secrets and wildcard origins are now out of proportion with the app's real responsibility

Recommended improvement:

- fail fast in production when `APP_SECRET` is default-like
- fail fast in production when admin password is default-like or blank
- move to explicit allowed origins from env
- separate dev permissiveness from production startup rules
- define a real auth roadmap if the app will keep expanding

### 2. Add real automated tests, not just build and import smoke

The current CI floor is too thin for the size of the workflow logic.

Observed:

- `.github/workflows/ci.yml` builds the frontend and imports the backend app
- there are no route or service tests in the repo
- the project now has fragile behavior around auth, sync, retainers, uploads, and field coercion

Why this matters:

- the project changes often in user-facing finance workflows
- most future bugs here will be flow regressions, not syntax errors
- current CI catches "won't start" better than "works correctly"

Recommended improvement:

- backend tests for auth tokens, role gates, web invoice validation, webhook payload normalization, sync fallback behavior, and Teable coercion
- frontend tests for login flow, web invoice drawer rules, upload-before-save behavior, filter logic, retainer month states, and role-gated routing
- a small fixture layer for Teable-like payloads so field-shape regressions are testable

### 3. Reduce documentation, env, and deployment drift

The repo has clear signs of configuration drift.

Observed:

- `backend/.env.example` still points to older assumptions like `mistralai/mistral-7b-instruct:free`
- `frontend/.env.example` still points to older hosting assumptions and older model labeling
- both root `vercel.json` and `frontend/vercel.json` still exist while Cloudflare Pages is now central to frontend deploy flow
- `backend/app/main.py` still reports version `2.2.0`
- `memory.md` contains important truths, but it is local-only and gitignored
- `backend/app/services/openrouter.py` still hardcodes a Vercel-era referer string

Why this matters:

- deployment and runtime truth is spread across docs, code, workflow files, and local notes
- the app is now operational enough that stale setup knowledge becomes a production risk

Recommended improvement:

- choose one repo-tracked operational source of truth for hosting, env vars, and deploy paths
- keep examples current whenever deployment changes
- align versioning with actual released behavior
- remove or clearly mark legacy deployment config once the active model is settled

### 4. Make stale-data behavior observable to users and operators

The mirror architecture is good, but stale-data signaling is still underpowered relative to the business domain.

Observed:

- sync is substantial in `backend/app/db/sync.py`
- admin endpoints expose sync diagnostics
- app startup only runs sync when PostgreSQL exists and a Teable token is available
- user surfaces rely heavily on mirrored freshness but do not appear to foreground stale-state clearly

Why this matters:

- in finance workflows, stale but plausible data is more dangerous than obvious failure
- mirror-based reads need freshness visibility to be trustworthy

Recommended improvement:

- show last successful sync and lag state in admin
- expose "mirror stale" or "direct-source fallback" explicitly where relevant
- standardize health indicators for PG, Valkey, webhook arrival, and sync freshness
- make it easy to answer "is the data current?" without reading logs

## Medium-Priority Improvements

### 5. Reduce the concentration of UI and domain logic inside huge page files

This is the clearest maintainability pressure point on the frontend.

Current file sizes:

- `frontend/src/pages/WebInvoices.jsx`: 2494 lines
- `frontend/src/pages/WebProjects.jsx`: 2083 lines
- `frontend/src/pages/Invoices.jsx`: 1911 lines
- `frontend/src/pages/AdminDashboard.jsx`: 1313 lines

Why this matters:

- these files now hold multiple concerns at once: data fetching, mutations, local state machines, filtering, layout, and workflow copy
- large page files make regression review and onboarding materially harder
- reuse becomes accidental rather than deliberate

Recommended improvement:

- extract feature modules by concern, not just by visual section
- split drawers/forms/tables/filters/summary logic into dedicated components or hooks
- keep page files orchestration-focused

### 6. Standardize invoice behavior across the main and web invoice products

There is now visible product drift between `frontend/src/pages/Invoices.jsx` and `frontend/src/pages/WebInvoices.jsx`.

This is not automatically wrong, but the app is duplicating patterns around:

- filters
- table interactions
- attachment flows
- month logic
- summary cards
- form validation and workflow affordances

Why this matters:

- duplicate interaction logic becomes duplicate bug surface
- UI improvements made in one invoice surface will keep lagging in the other

Recommended improvement:

- extract shared invoice interaction primitives
- keep domain differences separate, but unify common table, filter, drawer, and attachment behaviors
- define one design language for status, due-ness, docs, and workflow CTAs

### 7. Centralize Teable field contracts instead of re-deriving them per module

The backend works, but the integration contract is still spread across services.

Relevant modules:

- `backend/app/services/teable.py`
- `backend/app/services/invoice.py`
- `backend/app/services/web_invoice.py`
- `backend/app/services/web_project.py`
- `backend/app/db/sync.py`

Why this matters:

- field names, field ids, date coercion, attachments, link values, and picklists are still normalized in multiple places
- schema changes remain expensive because contract knowledge is duplicated

Recommended improvement:

- define per-domain field maps in one place
- centralize number/date/link/attachment coercion
- centralize read-only/computed field exclusions
- make sync and CRUD layers consume the same adapters where possible

### 8. Formalize the retainer operating model before adding more retainer features

The retainer workflow has been improved a lot, but it is still process-led more than data-model-led.

Observed:

- retainer behavior is now layered onto the web invoice table
- the workflow relies on category conventions, month heuristics, and status interpretation
- invoice raising is external, invoice recording is internal

Why this matters:

- retainers are recurring finance operations, not ad hoc records
- if more logic is added without a canonical model, the workflow will become harder to reason about than it needs to be

Recommended improvement:

- write down the canonical retainer state machine
- define authoritative versus derived fields
- define what "expected", "raised externally", "recorded internally", "paused", and "missed" mean
- if table constraints ever loosen, consider a dedicated retainer schedule entity instead of only invoice rows

### 9. Expand admin from data browser into an operations console

The admin area is already useful, but it can become more decisive.

Observed:

- `frontend/src/pages/AdminDashboard.jsx` is large and feature-rich
- backend admin routes cover stats, sessions, chats, sync, history, audit, mirrors

Recommended improvement:

- lead with system health, not just tabs
- prioritize active issues over raw data access
- add clearer pivots for recent failures, stale sync, invalid sessions, and webhook recency
- make "what is broken right now?" answerable within seconds

## Lower-Level Engineering Improvements

### 10. Strengthen contracts and typing where the system is fragile

The main bug risk in this project is shape drift, not complex algorithms.

Observed:

- backend uses Pydantic models, but many cross-layer payloads still depend on flexible dict shapes
- frontend is plain React JSX, which keeps iteration fast but makes large flow-heavy pages easier to break silently

Recommended improvement:

- tighten request and response models at the backend edge
- introduce more typed view-model thinking, even before any full TypeScript migration
- if TypeScript is adopted later, start at API contracts and shared domain shapes, not at cosmetic components

### 11. Add linting and formatting as explicit repo standards

The codebase is now big enough that consistency should not depend on review discipline alone.

Recommended improvement:

- frontend linting with ESLint
- backend linting with Ruff
- optional formatter standardization so style churn stops showing up as decision overhead

### 12. Review deploy workflow risk and repo hygiene

There are a few operational smells worth cleaning up.

Observed:

- frontend deploy and backend deploy use different hosting models
- backend deploy workflow force-pushes to a Hugging Face Space mirror
- legacy deployment config remains in the repo
- analytics integrations have been added directly into frontend runtime files

Why this matters:

- deployment complexity is manageable now, but drift will accumulate quickly if old paths stay half-active

Recommended improvement:

- clearly declare the active production path for each surface
- mark legacy configs as legacy or remove them once safe
- periodically audit env vars, analytics scripts, and deploy assumptions together rather than one by one

## Specific Repo Findings Worth Reviewing Soon

1. `backend/app/services/openrouter.py` still carries a hardcoded Vercel-era referer, which is stale relative to the current frontend hosting shape.
2. `backend/.env.example` and `frontend/.env.example` are both behind the current production model and current model naming.
3. `backend/app/main.py` versioning does not appear aligned with current shipped capability.
4. `backend/app/db/sync.py` mirrors projects, invoices, and web invoices, but the newer web-projects/resource surface does not appear mirrored in the same way yet.
5. `frontend/src/index.css` and the biggest page components now carry a lot of product-level behavior, which makes visual and behavioral changes more coupled than they should be.
6. `memory.md` is useful, but because it is excluded from git, it should not be the only place where operational truth lives.

## Suggested Improvement Order

1. Security and production-env hardening
2. Real automated tests for finance workflows
3. Documentation, version, and deployment alignment
4. Sync freshness and stale-state observability
5. Frontend decomposition of oversized page modules
6. Shared invoice interaction primitives
7. Centralized Teable field adapters
8. Retainer workflow formalization
9. Admin-console triage improvements
10. Linting and typed contract strengthening

## Bottom Line

This is already a capable internal operations app. The core architecture is not the main problem. The main risks are:

- security defaults that are too loose for the app's current responsibility
- limited regression protection
- deployment and config drift
- oversized workflow-heavy UI modules
- business logic that is growing faster than shared contracts

The best next phase is not feature expansion by default. It is controlled hardening:

- make runtime assumptions explicit
- make behavior testable
- make sync trust visible
- reduce duplication
- formalize the growing finance workflows before they spread further
