# FinTrack — Project Memory

> Last updated: 2026-06-04  
> Commit baseline: `82b5a9f` on `main`  
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

## Authentication & RBAC (5 roles)

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

**This file is gitignored — local only. Do not commit.**
