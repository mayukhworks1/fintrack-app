# FinTrack — Project Memory

> Last updated: 2026-06-05
> Commit baseline: `1c0c516` on `main`
> Author: Mayukh · mayukhj2407@gmail.com

---

## What this project is

**FinTrack** is an AI-powered project finance tracker for a small agency. It tracks project billing, profit margins, overhead, invoice status, and live project status updates. A CXO/manager uses it daily to monitor portfolio health and outstanding receivables.

**Live URLs**
- Frontend: `https://twfinancetracker.mayukh.space` (Cloudflare Pages)
- Backend: Hugging Face Space (Docker), exposed as `/api/*`

---

## Architecture

```
frontend/          React 18 + Vite + Tailwind CSS → Cloudflare Pages
backend/           FastAPI (Python 3.11) → Hugging Face Space (Docker)
mirror DB          Aiven PostgreSQL 1 GB (asyncpg, SSL)
cache / rl         Aiven Valkey 1 GB (Redis-compatible, TLS → rediss://)
primary data       Teable (Airtable-like DB) — source of truth for all writes and reads
AI                 OpenRouter (free model cascade via openrouter.ai)
```

**Request flow:**  
Browser → Cloudflare Pages → `/api/*` → HF Space FastAPI → Teable (source of truth)  
PG mirrors used ONLY for AI context, admin views, audit, analytics — NOT for invoice/status/project reads  
Valkey used ONLY for rate limiting and geo-cache — NOT for invoice/project/status list reads

**Read path (critical):**
- Status: Teable-first always (no Valkey/PG for reads), PG only if Teable unreachable
- Invoices (main): Always live Teable — no in-process or Valkey cache on list endpoint
- Projects: Always live Teable — Valkey cache removed from list endpoint
- Web Invoices picklists: Always live Teable — cache removed
- All picklist endpoints: Always live Teable — no cache so new options appear immediately

---

## Repository layout

```
fintrack-app/
├── frontend/src/
│   ├── App.jsx                  # Router, lazy loading, auth gate (/view/:token bypasses auth)
│   ├── index.css                # Design system (CSS variables + components)
│   ├── pages/
│   │   ├── Dashboard.jsx        # KPI grid, client bars, at-risk, top projects
│   │   ├── Projects.jsx         # Project list with filters/sort/search
│   │   ├── ProjectDetail.jsx    # Single project view + edit/delete
│   │   ├── Invoices.jsx         # Invoice list, filters, CRUD drawer, view modal
│   │   ├── TaxLedger.jsx        # GST/TDS tax tracking module (NEW — /tax route)
│   │   ├── Analytics.jsx        # Cash flow chart, DSO, aging, concentration risk
│   │   ├── AIAssistant.jsx      # Chat UI wired to /api/ai/chat
│   │   ├── Report.jsx           # Two-mode AI report: Board Pack + Status Briefing tabs
│   │   ├── Login.jsx            # Password auth, token stored in localStorage
│   │   ├── WebInvoices.jsx      # Web-role isolated app: invoices + retainers + projects
│   │   ├── WebProjects.jsx      # All-role isolated app: projects + resources tracker
│   │   ├── StatusBoard.jsx      # Live project status board — Card/List/Board views
│   │   ├── SharedView.jsx       # Public shared view (/view/:token), no auth required
│   │   └── AdminDashboard.jsx   # Admin panel: embedded in Layout or standalone
│   ├── components/
│   │   ├── Layout.jsx           # Sidebar nav (Tax Ledger added; no AssociationLinkModal)
│   │   ├── ExecutiveUI.jsx      # Shared executive shell / hero / KPI / filter primitives
│   │   └── DocPreviewModal.jsx  # Shared inline document preview
│   ├── context/
│   │   ├── AuthContext.jsx      # 5 roles, logout calls server-side invalidation
│   │   ├── ThemeContext.jsx
│   │   └── ToastContext.jsx
│   ├── services/
│   │   └── api.js               # All API calls; request deduplication + retry
│   │                            # api.associations and api.projectInvoices REMOVED
│   └── utils/format.js
├── backend/app/
│   ├── main.py                  # FastAPI app, lifespan, audit middleware
│   │                            # associations_router and project_invoices_router REMOVED
│   ├── config.py                # Settings (pydantic, env vars)
│   ├── routers/
│   │   ├── auth.py
│   │   ├── deps.py
│   │   ├── admin.py
│   │   ├── projects.py          # No association hydration — raw Teable records returned
│   │   ├── invoices.py          # + GET /api/invoices/picklists endpoint
│   │   ├── web_invoices.py
│   │   ├── web_projects.py
│   │   ├── status.py            # + GET /api/status/stream SSE endpoint
│   │   ├── shared_views.py
│   │   ├── ai.py
│   │   └── webhooks.py
│   ├── db/
│   │   ├── postgres.py
│   │   ├── audit.py
│   │   ├── sync.py
│   │   ├── valkey.py
│   │   └── geo.py
│   ├── services/
│   │   ├── teable.py
│   │   ├── invoice.py           # + get_picklists() method; Client Name field added
│   │   ├── web_invoice.py       # picklists always live (no cache)
│   │   ├── web_project.py       # list_project_names() always live (no cache)
│   │   ├── status.py            # SSE subscriber registry; Teable-first reads
│   │   ├── shared_views.py      # dynamic live links (__dynamic__ sentinel)
│   │   ├── invoice_aging.py     # background aging refresh loop (1h interval)
│   │   ├── toon.py
│   │   └── openrouter.py
│   └── utils/cache.py
├── memory.md                    # ← this file (gitignored — local only)
└── README.md
```

---

## Authentication & RBAC

### Legacy password roles (still active)
| Role | Env var | Access |
|------|---------|--------|
| `editor` | `APP_PASSWORD` | Full CRUD, AI, admin panel via `/admin` |
| `viewer` | `APP_VIEW_PASSWORD` | Read-only main app |
| `web` | `APP_WEB_PASSWORD` | WebInvoices only |
| `all` | `APP_ALL_PASSWORD` | WebProjects + resources |
| `admin` | `APP_ADMIN_PASSWORD` | Standalone admin dashboard |

Token format: `base64url("{expiry}:{role}").base64url(HMAC-SHA256)` — 7 day TTL.  
`require_admin` dep accepts both `admin` and `editor` roles.

Server-side logout: `POST /api/auth/logout` marks `is_active=false, expires_at=NOW()`.

**Public routes**: `/view/:token` is checked BEFORE the auth gate in `App.jsx`.

### Email/password auth foundation (additive; not full RBAC enforcement yet)
- `POST /api/auth/email/bootstrap` creates first `superadmin` only when `APP_ADMIN_PASSWORD` is provided and no auth users exist.
- `POST /api/auth/email/register` creates users in `pending_approval`.
- `POST /api/auth/email/login` only allows users with `status='active'`; pending/rejected/disabled users are blocked.
- Password hashing uses PBKDF2-SHA256 with per-password salt in `backend/app/services/auth_master.py`.
- Email auth sessions are stored in `auth_sessions` and also mirrored into legacy `login_sessions` for current admin/session visibility compatibility.
- Frontend login defaults to email/password and keeps a “legacy password” toggle for fallback during rollout.
- Forgot/reset password is implemented through Zoho-compatible SMTP config:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `SMTP_USE_SSL`, `SMTP_USE_TLS`
  - `AUTH_ADMIN_NOTIFY_EMAIL` receives pending-user notifications.
  - `PASSWORD_RESET_TTL_MINUTES` controls reset-token expiry.
- Password reset tokens are random, stored only as SHA-256 hashes in `auth_password_resets`, single-use, expiry-bound, and revoke active `auth_sessions` after reset.
- Approval/reactivation attempts to email the user, but SMTP delivery failure does not rollback admin approval; failures are logged.

### Admin auth management (current local tranche)
- Backend endpoints added in `backend/app/routers/admin.py`:
  - `GET /api/admin/auth/roles`
  - `GET /api/admin/auth/users`
  - `PATCH /api/admin/auth/users/{user_id}/approve`
  - `PATCH /api/admin/auth/users/{user_id}/reject`
  - `PATCH /api/admin/auth/users/{user_id}/disable`
  - `PATCH /api/admin/auth/users/{user_id}/reactivate`
  - `POST /api/admin/auth/users/{user_id}/sessions/revoke`
- Frontend admin tab added: `Admin Panel → Auth Users`.
- Admin can filter users by status/role/search, assign a master role on approval/reactivation, disable users, reject pending users, and revoke active email-auth sessions.
- All auth admin mutations write `auth_events` in the same DB transaction as the user/session state change.
- `api.admin.authUsers()` bypasses the short frontend GET cache (`fresh: true`) so approval/disable/revoke actions reload live rows without browser refresh.
- This tranche does **not** yet enforce per-module/scoped RBAC on business data routes. Existing legacy route access remains intact intentionally.
- Validation so far: `python3 -m compileall backend/app`, `frontend npm run build`, `git diff --check`, `backend/.venv/bin/python -c "from app.main import app; print(app.title)"`, and direct PBKDF2 `hash_password/verify_password` smoke checks pass after SMTP/reset additions.
- Production push gate still should include a live admin Auth Users smoke test after deployment because these endpoints depend on the real PostgreSQL auth tables and request auth context.

---

## Teable tables

### Projects (`TEABLE_TABLE_ID = tbl4fi155DuWlh40By3`)
### Invoices (`TEABLE_INVOICE_TABLE_ID = tblyWvNkprE1HnaVZIH`)

**INVOICE_FIELD_IDS** (in `backend/app/services/invoice.py`):
```
Invoice Number   fldKSNWW3OwqTtsWLqD
Project          fldavbndGaQVJZ4spJs   ← singleSelect: Innovine, PMS, Maitrimetal Workspace migration
Client Name      fldVnXFCaHHxqsp6AHq   ← singleSelect: Birla Open Minds, Maitrimetal, Innovine  ← NEW
Category         flduUcIbAvyk4LeYmDB
Description      fldzeYOWTfJpQMIcF54
Milestone        fldInxvxnEH7VNkkBsN
Raised By        fldRWvhrcUCTRcIlhvk
Raised Date      fldpRoCEg6pv4Vgysgg
Cleared Date     fldRrKnhPcWFd1sk60n
Amount Raised    fldZhhhwRAeoQPwgshy
Amount with Tax  fldDlo5FZia8wwmwfK7
Amount Received  fldQRpzwsMK9U7bBQ1v
Payment Status   fldXpx2jzUyRrznjw7M
Remark           fld0HwxUQQ46t9uzvBv
Reference        fldsShRxunYRQZ03iYi   ← file attachments (Payment Confirmation)
Invoice PDF      fldErRKNwXVAsnUzWCH   ← file attachments
Agening (Days)   fld0m8lwVX4wyQeJrOG
Next followup    fldr11YNIf7EPSPObUF
Days To Clear    fldZcfdmoKjHRLDWY6o   READ-ONLY
Speed            fldY8J44ZaQi6DC1oW8   READ-ONLY
Outstanding Amt  fldn4mfpKXNQxSnDfc6   READ-ONLY
```

**INVOICE_PICKLIST_FIELDS** = `{"Project", "Client Name", "Category", "Milestone", "Raised By", "Payment Status"}`  
Endpoint: `GET /api/invoices/picklists` — always live from Teable schema, no cache

### Web Invoices (`TEABLE_WEB_INVOICE_TABLE_ID = tbllkYiaS68BlcOc1Jy`)

**PICKLIST_FIELDS** = `["Project", "Category", "Milestone", "Raised By", "Currency"]`  
All 5 fields are singleSelect and driven by Teable schema. No hardcoded options.  
Adding new options: `POST /api/web-invoices/picklists/{field_name}` → updates Teable schema.  
The `+` button in `PicklistSelect` calls this endpoint for all these fields including Project.

### Web Projects (`tbl4qgQkatguBwrzxtf`)
### Web Resources (`tblMjssDx55GOfLtgqo`)
### Current Status (`TEABLE_STATUS_TABLE_ID = tblgdbV6T4Ly9n6YNCU`)

Fields in Current Status table:
- `Client` → fldsBzy2dYYTRNKhpAD
- `Project` → fldWgtXYJN178I0jzeW
- `Current Status (Detailed)` → fld4MneRM2LeXS15cpv
- `Short Status` → fldyfl9bugT9bLJzWuv
- `Status` → fldKC43dvuXF91zMTaU ← singleSelect

---

## Associations layer — REMOVED

The entire project↔invoice association system was removed:
- **Removed from backend**: `services/associations.py`, `routers/associations.py`, `services/project_invoices.py`, `routers/project_invoices.py` — all unregistered from `main.py`
- **Removed from frontend**: `api.associations`, `api.projectInvoices`, `AssociationLinkModal.jsx`, `InvoicePicklist.jsx`; `hydrate_records()` calls removed from `invoices.py` and `projects.py` routers
- **StatusBoard**: "Linked Invoices" panel, link/unlink buttons, all `onInvoice` props removed; replaced with simple "View invoices" navigation link
- **DB bootstrap removed**: no association or project-invoice tables are created by application startup schema anymore. Existing historical DB tables must be dropped manually only after explicit approval/backups.

---

## PostgreSQL Schema

| Table | Key columns |
|-------|-------------|
| `audit_log` | id, ts, role, token_hint, method, path, status, duration_ms, ip, user_agent, os, browser, device, country, country_code, region, city, isp, lat, lon, timezone, org, referer, body_size, query_params, resp_size, extra JSONB |
| `login_sessions` | id UUID, token_hint, role, created_at, last_seen_at, expires_at, is_active, request_count, geo, device, session_status |
| `chat_sessions` | id UUID, started_at, last_at, role, ip, geo, os, browser, msg_count, title |
| `chat_messages` | id, session_id, ts, role, content, model, tokens_used, duration_ms |
| `projects_mirror` | teable_id PK, synced_at, fields JSONB, typed columns |
| `invoices_mirror` | teable_id PK, synced_at, fields JSONB, typed columns |
| `web_invoices_mirror` | teable_id PK, synced_at, fields JSONB, typed columns |
| `status_mirror` | teable_id PK, synced_at, fields JSONB, client, project, short_status, detail_status, status VARCHAR(100), modified_time |
| `record_history` | id, source_table, teable_id, change_type, old_fields JSONB, new_fields JSONB, changed_fields TEXT[], full actor attribution columns |
| `sync_log` | id, synced_at, source, total, created, updated, unchanged, duration_ms, error |
| `shared_views` | token, title, record_ids JSONB, expires_at, is_active, access_mode, view_config JSONB, resource_type |
| `shared_view_accesses` | id UUID, view_token, ip, country, city, os, browser, device_type, accessed_at |
Schema migrations: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` — idempotent on every startup.

**CRITICAL — asyncpg + JSONB**: Every JSONB column must be `json.dumps(value)` + `$N::jsonb` cast.

**Current truth contract**
- Teable = source of truth for ALL operational data — reads and writes
- PostgreSQL = mirrors for AI context, admin, analytics, audit/history only
- Valkey = rate limiting and geo-cache only

---

## Real-time sync (Status Board)

**SSE push** (`GET /api/status/stream?token=xxx`):
- Backend maintains `_sse_queues: set[asyncio.Queue]` in `services/status.py`
- `notify_status_change()` fires after every create/update/delete AND after webhook updates
- Auth via `?token=` query param (EventSource cannot send custom headers)
- 25s keepalive comments to prevent proxy/Cloudflare timeouts
- Frontend: EventSource uses `${API_BASE_URL}/api/status/stream?token=...` (absolute URL — critical for production where VITE_API_URL is set to HF Space URL)
- On `changed` event: bust client cache + silent background reload (no spinner)
- Exponential backoff reconnect: 3s → 6s → 12s → max 30s
- 30s fallback polling as safety net

**Cache bust order** (must happen before SSE notify):
1. In-process TTL cache busted (`cache.bust("status:")`)
2. Valkey cache busted (awaited — not fire-and-forget) so frontend reload reads fresh data
3. SSE notify fired

---

## Status Board

**Router:** `backend/app/routers/status.py` → `/api/status`  
**Service:** `backend/app/services/status.py`  
**Frontend:** `frontend/src/pages/StatusBoard.jsx`

Read path: **Always Teable-first** (no Valkey, no PG for live reads). PG only if Teable unreachable.  
Write path: POST/PATCH/DELETE to Teable → sync PG mirror → bust caches → notify SSE.

Linked Invoices panel **removed** — was part of the association layer.  
Detail panel now has "View invoices" link → navigates to `/invoices?project=X`.

---

## Tax Ledger

**Frontend:** `frontend/src/pages/TaxLedger.jsx`

Tax register calculations are paid-invoice-only:
- GST collected total = sum of paid invoices only (`Amount with Tax - Amount Raised`)
- TDS collected/deducted total = paid invoices only (`Amount with Tax - Amount Received`), percentage shown against taxable base
- Open/pending invoices are shown in a separate Open Invoices card and in the invoice scope filter, but are excluded from GST/TDS/tax filing totals
- Reports tab includes GST collected, TDS deducted, open receivable controls, and filing checklist for GST/TDS/ITR preparation
- Invoice-level table supports scope: Tax register only / Open invoices only / All invoices, and shows TDS amount plus TDS %

---

## Invoices module

**Frontend:** `frontend/src/pages/Invoices.jsx`

### Form fields
```
EMPTY_FORM keys: invoice_number, project, client_name, category, description,
  milestone, raised_by, raised_date, cleared_date, amount_raised, amount_with_tax,
  amount_received, payment_status, remark, next_followup, reference, invoice_pdf
```

### Picklists
- `GET /api/invoices/picklists` → always live from Teable schema (no cache)
- Returns options for: Project, Client Name, Category, Milestone, Raised By, Payment Status
- Frontend fetches on mount; options used in SelectInput for Project + Client Name
- `Project` is now a `SelectInput` (fixed picklist from schema), not a free-text input
- `Client Name` is a `SelectInput` (fixed picklist from schema)

### Dashboard calculations
- `lastThreeMonthBalance` and `recentProjectCards` use `allRecords` (all invoices, no filter)
- Status/project filters are applied client-side in `scopedRecords` only
- API call always fetches ALL 1000 invoices without server-side status/project filter
- This ensures monthly totals are correct even when a status filter is active

---

## Tax Ledger module

**Route:** `/tax` — `frontend/src/pages/TaxLedger.jsx`  
**Nav:** "Tax Ledger" with Landmark icon in sidebar

### Features
- Period selector: Financial year (Apr–Mar), calendar year, half-year, quarter, month, custom range
- Default period: current financial year
- 6 KPI cards: Taxable Value, GST Collected, TDS Deducted, Gross Invoiced, Net Receivable, Outstanding
- GST/TDS health bars (expected 18% GST, 10% TDS)
- 4 tabs:
  - **Summary**: GSTR-1 reference (CGST 9% + SGST 9% split), TDS reference, client contribution table
  - **Monthly**: month-by-month register with CGST/SGST columns, expandable invoice rows
  - **By Client**: client cards with GST%/TDS% badges, expandable invoice drilldown
  - **All Invoices**: full invoice-level register with every tax column, search filter
- Export CSV + Print support
- Uses `f['Client Name']` as primary grouping key (falls back to Project)
- Tax computation: `gstAmt = gross - base`, `tdsAmt = gross - received` for paid invoices

---

## Web Invoices (WebInvoices.jsx)

**Picklist source for ALL fields**: Teable field schema via `GET /api/web-invoices/picklists`  
No hardcoded options anywhere. All singleSelect fields driven from schema.

**Picklist fields**: Project, Category, Milestone, Raised By, Currency  
**Adding new options**: `PicklistSelect` component calls `POST /api/web-invoices/picklists/{field_name}`  
→ updates Teable schema → next form open shows new option

**Project field**: Now uses `PicklistSelect` (same as Category, Currency). No separate data source.  
Old `seedProjects()` / `allRecords` merge / `ProjectInput` datalist — all removed.

---

## Shared Views

### Dynamic live links
- `record_ids: ["__dynamic__"]` = sentinel for live view
- "Share View" button always creates a dynamic link
- On each access: fetches all records from Teable, applies view_config filters
- `_fetch_dynamic_records()` in `shared_views.py` handles this path
- `get_public_data()` returns `is_dynamic: true` in response

### Fixed snapshot links
- "Share selected" uses actual record IDs
- Only those specific records are returned

### Public endpoint
- `GET /api/public/view/{token}` — no auth required
- Tracks access: IP, geo, device, browser
- `update_public_record`: dynamic views allow editing any record (not just listed IDs)

---

## CSS variables (key ones)

| Variable | Light | Dark |
|---|---|---|
| `--bg-base` | `#f7f9fc` | `#0b1221` |
| `--bg-layer` | `#ffffff` | `#131a2c` |
| `--card-bg` | `#ffffff` | `#0d1525` |
| `--card-border` | `#cfd8e3` | `#1f2942` |
| `--bg-input` | `#f1f5f9` | `#1a2238` |
| `--text-1` | `#0f172a` | `#e2e8f0` |
| `--text-2` | `#4a5568` | `#8fa0b8` |
| `--text-3` | `#8fa0b8` | `#4a5a72` |
| `--border` | `#dde3ed` | `#1a2540` |

**NEVER hardcode `rgba(255,255,255,...)` or `#ffffff` for card/section backgrounds** — use `var(--card-bg)`.  
**`var(--bg-card)` doesn't exist** — correct variable is `var(--card-bg)`.

---

## Known gotchas / critical rules

1. **Teable link-field filtering doesn't work server-side** — always filter client-side on the `Project` link array.
2. **Teable multiple-select fields return arrays** — normalise with `safeStr()` / `Array.isArray(v) ? v.join(', ') : v`.
3. **React error #31** — "Objects are not valid as React children." Caused by rendering Teable link fields directly. Always use `safeStr()`.
4. **Whitelist fields for Teable POST/PATCH** — use `_PROJECT_EDITABLE` / `_RESOURCE_EDITABLE` sets.
5. **`var(--bg-card)` doesn't exist** — correct variable is `var(--card-bg)`.
6. **asyncpg JSONB must be json.dumps + ::jsonb cast** — raw Python dicts cause silent DataError.
7. **`CREATE TABLE IF NOT EXISTS` never adds columns** — use `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
8. **Teable `orderBy` may return HTTP 400** — catch and retry without sorting.
9. **Tags field in Teable** — multiple-select, returns array. On save, join with `, `.
10. **Paid invoice rule** — `Payment Status = Paid` requires `Amount Received` + `Cleared Date`.
11. **Teable sort/filter uses field IDs** — `WEB_PROJECT_FIELD_IDS` / `WEB_RESOURCE_FIELD_IDS` map names → IDs.
12. **`active_only` sessions filter** — `is_active = true AND expires_at > NOW()` (both required).
13. **`false` in URLSearchParams** — use `String(v)` so `false` → `"false"`.
14. **asyncpg DATE columns require `datetime.date` objects** — string raises silent error.
15. **Teable linked-record fields return arrays** — `[{"id":"recXXX","title":"..."}]`. Use `_coerce_str()`.
16. **ip-api.com free tier: 45 req/min** — geo lookups cached 24h in Valkey.
17. **status_mirror uses `modified_time` column** — not `created_time`.
18. **Passwords live in HF Secrets only** — `APP_ADMIN_PASSWORD` NEVER in code/commits.
19. **Reasoning model output leakage** — always use `===ANSWER===`/`===END===` markers.
20. **Status field in Teable is a single-select** — returns plain string, not an object.
21. **Optimistic UI for share link toggles/deletes** — flip/remove local state before API call; revert in catch.
22. **Board view needs horizontal scroll** — `overflow-x-auto` with `minWidth` on flex container.
23. **SSE EventSource URL must be absolute** — use `${API_BASE_URL}/api/status/stream?token=...` not `/api/status/stream`. In production `VITE_API_URL` is set to the HF Space URL and relative paths hit Cloudflare Pages instead.
24. **Valkey bust must be awaited before SSE notify** — if fire-and-forget, the frontend reload reads stale Valkey data. Use `await _bust_valkey_status()` not `create_task(...)`.
25. **Reference and Invoice PDF are linked-record / file fields** — sending `[]` to Teable raises 400 "Too small: expected array to have >=1 items". Always strip empty arrays in `_clean_fields()`: `v != []` added to guard.
26. **Picklist cache removed everywhere** — web invoice picklists, invoice picklists, web project names — all read live from Teable. Do not re-add cache; it causes stale options and broken dropdowns.
27. **Invoice Project field is a singleSelect in Teable** — use `SelectInput` not `SuggestInput` or `datalist`. Options come from `GET /api/invoices/picklists`.
28. **Web Invoice Project field** — same as Currency: options come from `GET /api/web-invoices/picklists`. Do NOT add a separate data source or merge logic.

---

## Backend details

### Config (`backend/app/config.py`)

| Var | Purpose |
|---|---|
| `TEABLE_API_TOKEN` | Teable auth (projects + main invoices) |
| `TEABLE_WEB_API_TOKEN` | Teable auth for web invoices |
| `TEABLE_ALL_API_TOKEN` | Teable auth for web projects |
| `TEABLE_BASE_URL` | Teable API base URL |
| `TEABLE_TABLE_ID` | Projects table |
| `TEABLE_INVOICE_TABLE_ID` | Invoices table |
| `TEABLE_WEB_INVOICE_TABLE_ID` | Web invoices table |
| `TEABLE_WEB_PROJECTS_TABLE_ID` | Web projects table |
| `TEABLE_WEB_RESOURCES_TABLE_ID` | Web resources table |
| `TEABLE_STATUS_TABLE_ID` | Current Status table |
| `APP_PASSWORD` | Editor role |
| `APP_VIEW_PASSWORD` | Viewer role |
| `APP_WEB_PASSWORD` | Web role |
| `APP_ALL_PASSWORD` | All role |
| `APP_ADMIN_PASSWORD` | Admin role — HF Secrets only, never in code |
| `APP_SECRET` | HMAC signing key |
| `POSTGRES_URL` | Aiven PostgreSQL DSN |
| `VALKEY_URL` | Aiven Valkey DSN |
| `TEABLE_WEBHOOK_SECRET` | Webhook auth header (optional) |
| `OPENROUTER_API_KEY` | AI model API key |

### Cache policy (current)

| What | Cache | TTL |
|------|-------|-----|
| Status list reads | **None** | Always live Teable |
| Invoice list reads | **None** | Always live Teable |
| Project list reads | **None** | Always live Teable |
| Invoice picklists | **None** | Always live Teable |
| Web invoice picklists | **None** | Always live Teable |
| Web project names | **None** | Always live Teable |
| `webproj:list` | In-process | 15s |
| `webproj:summary` | In-process | 30s |
| `webres:*` | In-process | 15s (busted via `?bust=true`) |
| `geo:{ip}` | Valkey | 24h |
| `ratelimit:{ip}` | Valkey | 60s sliding |
| `chat:context` | Valkey | 5 min |
| `report:executive` | Valkey | 10 min |
| `attrib:{teable_id}` | Valkey | 2 min |

---

## Local dev setup

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # :5173, proxies /api → :8000
```

Required `backend/.env`:
```
TEABLE_API_TOKEN=...
OPENROUTER_API_KEY=...
APP_PASSWORD=...
APP_SECRET=...
```

---

## Git

Branch: `main`. Direct push. No PRs.  
Frontend auto-deploys to Cloudflare Pages on push.  
Backend auto-deploys to HF Space on push.

---

## 2026-06-04 Tax Ledger / Invoice Contract

- Tax Ledger shared views use the same `shared_views` and `shared_view_accesses` infrastructure as Status Board, with `resource_type=tax-ledger`.
- Tax Ledger public links are intentionally read-only; compliance/tax register links should be trackable without allowing public financial edits.
- Tax Ledger live links re-fetch invoices from Teable and apply period, scope, and search filters server-side.
- All-invoice tax math contract: `Amount Raised` is taxable/base value, `Amount with Tax` is base + GST, `Amount Received` is net bank receipt after deductions.
- TDS is computed as `Amount with Tax - Amount Received` for paid invoices, and TDS percentage is computed on `Amount Raised` because GST is separately shown.
- Pending/open invoices are excluded from GST collected and TDS collected filing cards; they remain visible only in open receivable controls.
- `/invoices` now treats `Client Name` as a first-class field for filtering, table columns, shared links, and public invoice views.
- 2026-06-04 hardening: backend invoice summaries must never use `Amount Raised` as paid receipt. `total_received` and project received totals use `Amount Received`; pending/overdue amount chips use base `Amount Raised`; GST/TDS totals are separate summary fields.
- Session/device tracking already uses `X-Client-Hint` plus IP geo; browser GPS is attempted once per secure session and stored as `browserGeo` when the user grants permission. Do not make geolocation blocking for normal app loads.

---

## 2026-06-05 Auth Modernisation Tranche 1

Goal: introduce normal email/password login foundation without breaking the current password-role login or existing Teable/PG/Valkey business flows.

Implemented in this tranche:

- Added PG auth master/control-plane schema in `backend/app/db/postgres.py`.
- New tables:
  - `auth_users`
  - `auth_identities`
  - `auth_roles`
  - `auth_permissions`
  - `auth_role_permissions`
  - `auth_user_roles`
  - `auth_user_scopes`
  - `auth_sessions`
  - `auth_password_resets`
  - `auth_events`
- Seeded system roles:
  - `superadmin`
  - `admin`
  - `manager`
  - `finance`
  - `user`
  - `viewer`
- Seeded baseline permission keys for dashboard, projects, invoices, tax ledger, analytics, reports, AI, status, shared views, admin, sync, and role management.
- Added `backend/app/services/auth_master.py`.
- Password hashing uses built-in `hashlib.pbkdf2_hmac("sha256")` with per-user random salt and 390k iterations. No new dependency was added in this tranche to avoid deployment risk.
- Added new additive auth endpoints:
  - `POST /api/auth/email/bootstrap`
  - `POST /api/auth/email/register`
  - `POST /api/auth/email/login`
- Bootstrap rules:
  - Only works while `auth_users` is empty.
  - Requires `APP_ADMIN_PASSWORD`.
  - Creates first active `superadmin` user.
- Register rules:
  - Creates users as `pending_approval`.
  - Does not return an app token.
  - Login is blocked until approval flow is implemented and the user is active.
- Email login rules:
  - Requires active `auth_users.status = 'active'`.
  - Creates an `auth_sessions` row.
  - Writes `auth_events`.
  - Also writes legacy `login_sessions` for current admin/session visibility.
  - Returns existing compatible HMAC token so current route guards keep working.
- Compatibility bridge:
  - `superadmin`/`admin` currently map to legacy frontend/backend role `editor` so existing app modules remain reachable.
  - Other roles currently map to legacy `viewer` until full RBAC enforcement is implemented.
  - Existing password-only `/api/auth/login` remains available and unchanged.
  - Existing logout now also revokes matching `auth_sessions` rows.
- Frontend login:
  - `frontend/src/pages/Login.jsx` defaults to email/password login.
  - Includes a temporary “Use legacy password” toggle so current passwords still work during migration.
  - `frontend/src/context/AuthContext.jsx` supports both `login({ email, password })` and legacy `login(password)`.
  - `frontend/src/services/api.js` exposes `emailLogin`, `emailRegister`, and `emailBootstrap`.

Important safety boundary:

- This tranche does **not** enforce new RBAC on business routes yet.
- This tranche does **not** replace existing route dependencies (`require_editor`, `require_admin`, etc.).
- This tranche does **not** alter Teable CRUD, sync, invoice math, shared views, or Valkey attribution.
- This tranche does **not** add Google SSO, Zoho SSO, forgot-password email sending, or approval UI yet.

Validated:

- `python3 -m compileall backend/app`
- `cd frontend && npm run build`
- `git diff --check`

Next required tranche:

1. Build admin auth management backend endpoints:
   - list pending/active/rejected/disabled users
   - approve user with role
   - reject user
   - disable/reactivate user
   - reset password / force password change
   - revoke user sessions
   - list roles/permissions/scopes
2. Build admin UI tab for user approval and role/scope assignment.
3. Add forgot-password email service:
   - SMTP/Resend/Zoho Mail provider decision required
   - reset token must be hashed in `auth_password_resets`
   - reset link expiry should be short, ideally 30-60 minutes
4. Add DB-backed session verification:
   - current HMAC tokens remain compatible for now
   - future request auth must check `auth_sessions.revoked_at` and `auth_users.status`
5. Add full permission and data-scope enforcement endpoint by endpoint.
6. Only after this is stable, add Google SSO and Zoho SSO identities into `auth_identities`.

**This file is gitignored — local only. Do not commit.**

---

## 2026-06-05 Auth Modernisation Tranche 3

Goal: harden the email/password auth path so it can safely support RBAC, ownership-scoped invoices, and admin audit visibility before production rollout.

Implemented locally in this tranche:

- `backend/app/routers/deps.py`
  - `require_auth` is now async and still accepts legacy HMAC tokens.
  - If the token belongs to an email/password login, it now checks `auth_sessions`, `auth_users.status`, expiry, and revocation on every protected request.
  - Revoked/expired/disabled email-auth sessions now fail server-side instead of only being hidden in the UI.
  - Request state now carries:
    - `auth_session_id`
    - `auth_user_id`
    - `auth_user_email`
    - `auth_user_name`
    - `auth_role`
    - `is_email_auth`
  - Added `owner_scope_email(request)` helper. Email-auth users outside `superadmin/admin/manager/finance` are scoped to their own email for invoice ownership.

- `backend/app/routers/auth.py`
  - `/api/auth/verify` now returns `user`, `auth_role`, and `session_id` for DB-backed sessions.
  - `/api/auth/verify` rejects revoked, expired, inactive, or disabled email-auth sessions.
  - Legacy password-role tokens still return only `{ valid, role }`.

- `backend/app/main.py`
  - Request audit `extra` now records email-auth identity context:
    - `auth_user_id`
    - `auth_user_email`
    - `auth_role`
    - `auth_session_id`
    - `is_email_auth`

- `backend/app/db/postgres.py`
  - Added system role `web` (`Web Invoice User`) for scoped web-invoice access.
  - Added baseline invoice permissions for `web`.

- `backend/app/services/auth_master.py`
  - Legacy route mapping now maps:
    - `superadmin/admin/manager/finance` -> `editor`
    - `web` -> `web`
    - `viewer` -> `viewer`
    - `user` remains `viewer` until explicit module-level policy is finalized.

- `backend/app/services/invoice.py`
  - Added Teable-side `Raised By` filter to `list_invoices`.
  - Added scoped `raised_by` support for full invoice fetches used by summaries.
  - Added PG fallback filtering by `fields->>'Raised By'`.
  - Summary cache keys are separated by owner email to avoid cross-user data leakage.

- `backend/app/services/web_invoice.py`
  - Added Teable-side `Raised By` filter to list/full-summary reads.
  - Owner-scoped web invoice reads bypass the short shared list cache so CRUD reflects faster and cached payloads cannot leak across users.
  - Summary cache is only used for unscoped/full-workspace reads.

- `backend/app/routers/invoices.py`
  - Main invoice list/summary/get now apply `owner_scope_email`.
  - Scoped email users can create/update/delete/upload only their own records.
  - For scoped email users, writes always overwrite `Raised By` with the verified session email.
  - Existing editor/legacy users keep full access.

- `backend/app/routers/web_invoices.py`
  - Web invoice list/summary/get now apply `owner_scope_email`.
  - Scoped email users can create/update/delete/upload only records where `Raised By` equals their verified email.
  - For scoped email users, writes always overwrite `Raised By` with the verified session email.
  - Existing `web`/`all` legacy users keep full access until migration is complete.

- `frontend/src/context/AuthContext.jsx`
  - Stores `user`, `userEmail`, `authRole`, and `isEmailAuth` after email login or verify.
  - Clears DB-backed auth identity on logout/expiry.

- `frontend/src/pages/Invoices.jsx`
  - Email-auth scoped users see `Raised By` as a locked, non-editable email field.
  - Admin/manager/finance/legacy users retain the current selectable owner input.

- `frontend/src/pages/WebInvoices.jsx`
  - Same locked `Raised By` email behavior for scoped web invoice users.

Validated locally:

- `python3 -m compileall backend/app`
- `cd backend && .venv/bin/python -c "from app.main import app; print(app.title, app.version)"`
- `cd frontend && npm run build`
- `git diff --check`

Still required from user before production rollout:

1. Zoho SMTP env values:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USERNAME`
   - `SMTP_PASSWORD` (Zoho app password, not normal mailbox password)
   - `SMTP_FROM_EMAIL`
   - `SMTP_FROM_NAME`
   - `SMTP_USE_SSL` or `SMTP_USE_TLS`
   - `AUTH_ADMIN_NOTIFY_EMAIL`
2. Confirm `FRONTEND_URL` for reset links.
3. Confirm first production `superadmin` email.
4. Confirm whether Teable `Raised By` in both invoice tables is now text/email field. If it is still single-select, the backend can only write emails that already exist as options or the Teable token needs schema permission to add options.
5. Confirm role policy:
   - `web` role: web invoices only, owner-scoped by email.
   - `finance` role: all invoices/tax/report operations.
   - `manager` role: scoped team/client/project operations.
   - `user` role: current mapping is viewer until explicit edit permissions are approved.
6. Confirm whether existing legacy password users remain enabled during migration or should be disabled once email auth is proven.

Next safe tranche:

1. Add role/scope editor UI in Admin Auth Users.
2. Add permission/scopes enforcement by permission key, not only legacy role bridge.
3. Add Google SSO and Zoho SSO into `auth_identities`.
4. Add stricter CORS origins based on `FRONTEND_URL`.
5. Add route smoke tests for auth verify, revoked session, scoped invoice list, and scoped invoice write rejection.

## 2026-06-05 Auth/RBAC Completion Pass

User reported the auth rollout still felt incomplete:

- Superadmin must be able to create/invite users from Admin Panel.
- Users need profile records and approval lifecycle.
- Forgot-password email was not visibly working.
- Legacy password login must remain alive in parallel.
- Audit/user tracking must tie users to device, OS, browser, IP, geo/GPS if granted, sessions, and actions.
- Superadmin role changes from Auth Users must actually persist.

Implemented locally:

- `backend/app/services/emailer.py`
  - SMTP errors are now categorized without leaking credentials:
    - `smtp_auth_failed`
    - `smtp_connection_failed`
    - `recipient_refused`
    - `sender_refused`
    - fallback `smtp_error`
  - This makes Zoho SMTP diagnosis actionable from logs/admin UI.

- `backend/app/services/auth_master.py`
  - Added `create_admin_invited_user(...)`.
  - Admin-created users can be `active` or `pending_approval`.
  - Active invited users receive a set-password/reset-token email.
  - User is inserted into `auth_users`, `auth_identities`, `auth_user_roles`.
  - Creation/invite delivery metadata is written to `auth_events`.

- `backend/app/routers/admin.py`
  - Added request models:
    - `AuthUserCreate`
    - `AuthUserRoleUpdate`
    - `AuthSmtpTest`
  - `_write_auth_admin_event(...)` now stores `actor_user_id` when the actor is an email-auth admin/superadmin.
  - `GET /api/admin/auth/users` now returns:
    - `auth_event_count`
    - `audit_request_count`
    - `last_request_at`
    - existing session/activity fields
  - Added `POST /api/admin/auth/users` for create/invite.
  - Added `PATCH /api/admin/auth/users/{user_id}/role` for active user role changes.
  - Role changes revoke active DB-backed auth sessions by default because HMAC route-role is embedded in the token; user must sign in again for the new role to be trustworthy.
  - Added `POST /api/admin/auth/smtp/test` to send a test email from production config and log the result to `auth_events`.

- `frontend/src/services/api.js`
  - Added admin methods:
    - `createAuthUser`
    - `updateAuthUserRole`
    - `testSmtp`

- `frontend/src/pages/AdminDashboard.jsx`
  - Auth Users tab now has a real Create / Invite User panel.
  - Superadmin/admin can choose email, full name, role, status, and whether to send invite email.
  - Added SMTP test button with optional recipient.
  - Active-user role dropdown now shows a `Save role` button when changed.
  - `Save role` calls backend and revokes active sessions.
  - User cards/table show request count, auth event count, last request, sessions.

Validated locally:

- `python3 -m compileall backend/app`
- `cd backend && ./.venv/bin/python -c "import app.main; print('backend import ok')"`
- `cd frontend && npm run build`
- `git diff --check`

Important production notes:

- Legacy password login remains active.
- Email/password auth is additive and still uses DB-backed sessions.
- If forgot-password emails still do not arrive, first use Admin Panel -> Auth Users -> `Test SMTP`.
- If test returns `smtp_auth_failed`, check Zoho app password and username/from email match.
- If test returns `smtp_connection_failed`, check `SMTP_HOST`, port, SSL/TLS flags, and Hugging Face outbound SMTP support.
- Role changes revoke sessions intentionally; user must log in again.
- `APP_ADMIN_PASSWORD` remains the bootstrap password for `/api/auth/email/bootstrap`.

## 2026-06-06 Production Health / Safety Pass

User requested these next hardening areas:

- Production Health Screen in Admin for PostgreSQL, Teable, Valkey, Email, OpenRouter, auth sessions, cron jobs, sync freshness, failed webhooks, latest deployment version.
- Real-time CRUD confidence and audit traceability.
- Admin audit investigation improvements.
- Performance guardrails: lazy loading, chart splitting, cached dashboard summaries, stale-while-refresh.
- Runey-style UI consistency.
- One production checklist command before push/deploy.

Implemented in this pass:

- `backend/app/config.py`
  - Added `app_version` env-backed setting, default `2.3.0`.
  - Added optional `git_commit_sha` env-backed setting for deployment metadata.

- `backend/app/main.py`
  - FastAPI version now uses `settings.app_version`, so health/admin can reflect configured deployment version.

- `backend/app/routers/admin.py`
  - Expanded `GET /api/admin/deployment-health`.
  - It now reports:
    - PostgreSQL connectivity.
    - Valkey connectivity.
    - Teable table reachability for projects, invoices, web invoices, status.
    - Email provider config.
    - OpenRouter config/model.
    - Auth session counts: active, revoked, expired, last seen.
    - Sync freshness by source with stale/failed source lists.
    - Cron/background-job freshness inferred from recent sync output.
    - Failed webhook count in the last 24h.
    - Environment checks.
    - Deployment version, commit, frontend URL, HF space id.
  - Added `_health_item(...)` helper to keep health payloads consistent.
  - Added `_git_commit_sha(...)` best-effort helper using env first, then local git fallback.

- `frontend/src/services/api.js`
  - `api.admin.deploymentHealth(opts)` now accepts request options, allowing fresh bypass.

- `frontend/src/pages/AdminDashboard.jsx`
  - Added `DeploymentChecklist` component in Admin Overview.
  - Shows live health cards for PostgreSQL, Teable, Valkey, Email, OpenRouter, Auth Sessions, Cron Jobs, Sync Freshness, Failed Webhooks, and Environment.
  - Shows deployment version/commit/HF space id.
  - Includes a manual Refresh button.
  - Uses existing Admin card/badge styling for UI consistency.

- `scripts/production_check.sh`
  - New one-command production checklist:
    - backend import smoke
    - backend smoke tests
    - frontend tests
    - frontend production build
    - optional live health check via `HEALTH_URL=https://.../health`

- `backend/tests/smoke_test.py`
  - Added smoke coverage for the health payload helper.

Validation run:

- `./scripts/production_check.sh`
  - Backend import OK.
  - Backend smoke tests: `18 passed`.
  - Frontend tests: `15 passed`.
  - Frontend build OK.
  - Live health endpoint skipped because `HEALTH_URL` was not set.

Current performance notes:

- Route-level lazy loading already exists in `frontend/src/App.jsx`.
- Vite already splits `recharts` and `d3` into separate chart chunks in `frontend/vite.config.js`.
- Build output still shows large page chunks:
  - `WebInvoices`
  - `AdminDashboard`
  - `StatusBoard`
  - `Invoices`
  - `charts-recharts`
- Next safe performance tranche should avoid broad rewrites and instead:
  - lazy-load chart-heavy subcomponents inside page bodies;
  - add cached dashboard summary endpoints where missing;
  - use stale-while-refresh hooks consistently on heavy pages;
  - keep mutation paths fresh-only and optimistic.

Still pending from the user's larger request:

- Full optimistic CRUD reconciliation across all invoice/project/web-invoice forms.
- Stronger admin audit investigation UI for record-level direct open links from request logs, not only record history.
- More granular before/after change display in audit-log itself.
- Full Runey-style sidebar/theme unification across every module.
- Live health check should be run with `HEALTH_URL` before production push when production API is reachable.

## 2026-06-08 Admin Auth / Request Filters Hotfixes

Context:

- User reported Admin Panel access returning `403 Admin access required` when logging in with legacy password `Master@2026`.
- User also reported the Admin Panel -> Requests condition filter did not include a user filter, despite request rows showing user identity.
- User expected fixes to be pushed to `mayukhworks1/fintrack-app` on `main`.

Implemented and pushed commits:

- `ab8857f fix: make admin overview load resiliently`
  - Admin Overview/Production Health now uses shorter resilient health fetch behavior so a slow health dependency does not block the whole admin overview.

- `f22357c fix: prevent stale auth on admin access`
  - `frontend/src/services/api.js` now clears client cache on token set/clear.
  - Admin and auth verification routes bypass client cache so stale role/session data does not keep blocking access after login changes.

- `6736f64 fix: prefer admin password on legacy login`
  - Root cause: `/api/auth/login` checked `APP_PASSWORD` before `APP_ADMIN_PASSWORD`. If both shared the same value, legacy login returned `editor`, causing `/api/admin/*` to fail with `403 Admin access required`.
  - Backend auth now gives admin password precedence when legacy passwords overlap.
  - Added smoke coverage: `test_admin_password_wins_when_legacy_passwords_overlap`.

- `ef0e43f fix: add user filters to admin requests`
  - `frontend/src/pages/AdminDashboard.jsx` Admin Requests condition builder now exposes:
    - `User`
    - `User Email`
    - `User Name`
    - `User ID`
  - `User` is a derived field combining email/name/id for easier investigation filtering.
  - Condition filtering uses the derived field mapper against hydrated full rows, not only visible page rows.
  - Request exports now include user identity columns:
    - `User`
    - `User Email`
    - `User Name`
    - `User ID`
  - No backend/db change needed because `GET /api/admin/audit-log` already returns `user_id`, `user_email`, and `user_name`, and already supports top-level `user_email` query filtering.

Validation after latest fix:

- `backend/.venv/bin/python -m pytest backend/tests/smoke_test.py -q`
  - `19 passed`
  - one existing Pydantic v2 deprecation warning remains.
- `cd frontend && npm test -- --run`
  - `15 passed`
- `cd frontend && npm run build`
  - production build passed.
- `./scripts/production_check.sh`
  - backend import OK
  - backend smoke tests OK
  - frontend tests OK
  - frontend build OK
  - live health endpoint skipped because `HEALTH_URL` was not set.

Current state:

- Branch: `main`.
- Remote: `https://github.com/mayukhworks1/fintrack-app.git`.
- Latest pushed commit: `ef0e43f`.
- Admin Requests user filtering is fixed in frontend and uses existing backend audit identity fields.

Next likely follow-ups:

- Run live health verification with `HEALTH_URL` before the next production-sensitive push.
- If user reports Admin access still failing in browser, first clear frontend token/cache or sign out/in because backend precedence is fixed but old browser state can still hold stale tokens until replaced.
- Consider adding a frontend smoke test that asserts Admin Requests condition field list includes `User` / `User Email`.
