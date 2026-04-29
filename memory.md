# FinTrack — Project Memory

> Last updated: 2026-04-29  
> Commit: `c3e9893`  
> Author: Mayukh · mayukhj2407@gmail.com

---

## What this project is

**FinTrack** is an AI-powered project finance tracker for a small agency. It tracks project billing, profit margins, overhead, and invoice status. A CXO/manager uses it daily to monitor portfolio health and outstanding receivables.

**Live URLs**
- Frontend: `https://twfinancetracker.mayukh.space` (Cloudflare Pages)
- Backend: Hugging Face Space (Docker), exposed as `/api/*`

---

## Architecture

```
frontend/          React 18 + Vite + Tailwind CSS → Cloudflare Pages
backend/           FastAPI (Python 3.11) → Hugging Face Space (Docker)
data layer         Teable (Airtable-like DB, two tables)
AI                 OpenRouter (free model cascade via openrouter.ai)
```

**Request flow:**  
Browser → Cloudflare Pages → (API calls) → HF Space FastAPI → Teable API  
AI requests: FastAPI → OpenRouter → LLM model

---

## Repository layout

```
fintrack-app/
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Router, lazy loading, auth gate
│   │   ├── index.css                # Design system (CSS variables + components)
│   │   ├── main.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx        # KPI grid, client bars, at-risk, top projects
│   │   │   ├── Projects.jsx         # Project list with filters/sort/search
│   │   │   ├── ProjectDetail.jsx    # Single project view + edit/delete
│   │   │   ├── Invoices.jsx         # Invoice list, filters, CRUD drawer, view modal
│   │   │   ├── Analytics.jsx        # Cash flow chart, DSO, aging, concentration risk
│   │   │   ├── AIAssistant.jsx      # Chat UI wired to /api/ai/chat
│   │   │   ├── Report.jsx           # Printable board-pack PDF (window.print())
│   │   │   └── Login.jsx            # Password auth, token stored in localStorage
│   │   ├── components/
│   │   │   ├── Layout.jsx           # Desktop sidebar (collapsible) + mobile bottom nav
│   │   │   ├── ProjectCard.jsx      # Card used on Dashboard and Projects grid
│   │   │   ├── ProjectForm.jsx      # Create/edit project form
│   │   │   ├── StatCard.jsx         # Simple stat tile (legacy, may be unused)
│   │   │   └── ErrorBoundary.jsx    # React error boundary for lazy chunks
│   │   ├── context/
│   │   │   ├── AuthContext.jsx      # Login/logout, token management, auth-expired event
│   │   │   ├── ThemeContext.jsx     # Dark/light toggle, persisted in localStorage
│   │   │   └── ToastContext.jsx     # Global toast notifications
│   │   ├── hooks/
│   │   │   ├── useAutoRefresh.js    # Polling hook with stale-closure fix (useRef pattern)
│   │   │   ├── useMediaQuery.js     # CSS media query hook; useIsMobile() shorthand
│   │   │   └── (other hooks)
│   │   ├── services/
│   │   │   └── api.js               # All API calls; request deduplication + retry
│   │   └── utils/
│   │       └── format.js            # formatInr(), formatPct(), formatInt()
│   ├── vite.config.js               # Proxy /api → localhost:8000; manualChunks for code split
│   └── package.json
├── backend/
│   └── app/
│       ├── main.py                  # FastAPI app, CORS, request-ID middleware, error envelope
│       ├── config.py                # Settings (env vars / .env)
│       ├── models.py                # Pydantic models + FIELD_IDS dict + STATUS_ALIAS
│       ├── routers/
│       │   ├── auth.py              # POST /api/auth/login, GET /api/auth/verify
│       │   ├── projects.py          # CRUD + search + summary for projects
│       │   ├── invoices.py          # CRUD + summary for invoices
│       │   └── ai.py                # /api/ai/chat, /api/ai/autofill, /api/ai/analyze, /api/ai/report
│       ├── services/
│       │   ├── teable.py            # TeableService — projects table CRUD + get_summary()
│       │   ├── invoice.py           # InvoiceService — invoices table CRUD + get_summary()
│       │   └── openrouter.py        # AI layer — model cascade, answer extraction, reasoning filter
│       └── utils/
│           └── cache.py             # TTLCache singleton — async-safe, in-flight coalescing
├── vercel.json                      # Cloudflare/Vercel build config (SPA rewrites)
├── memory.md                        # ← this file
└── README.md
```

---

## Backend details

### Config (`backend/app/config.py`)

| Env var | Default | Purpose |
|---|---|---|
| `TEABLE_API_TOKEN` | — | Teable auth token (required) |
| `TEABLE_BASE_URL` | `https://app.teable.ai` | Teable API base |
| `TEABLE_TABLE_ID` | `tbl4fi155DuWlh40By3` | Projects table |
| `TEABLE_INVOICE_TABLE_ID` | `tblyWvNkprE1HnaVZIH` | Invoices table |
| `OPENROUTER_API_KEY` | — | OpenRouter key (required for AI) |
| `APP_PASSWORD` | `tw@2026` | Single shared password (case-insensitive) |
| `APP_SECRET` | `fintrack-dev-secret-change-me` | HMAC signing key for tokens |
| `APP_SESSION_TTL` | `604800` (7 days) | Token TTL in seconds |

All secrets live in HF Space secrets (never committed).

### Authentication

- Single shared password; verified server-side via HMAC
- Returns an opaque token stored in `localStorage` under key `fintrack-auth-token`
- Client sends `Authorization: Bearer <token>` on every request
- Auto-logout on 401: `window.dispatchEvent(new CustomEvent('fintrack:auth-expired'))`

### Teable tables

**Projects table** `tbl4fi155DuWlh40By3`  
Key fields (from `models.py FIELD_IDS`):
- `Client`, `Project Name`, `Project Status`, `Health`
- `Amount Billed So far`, `Actual Profit`, `Profit percentage`
- `Input cost so far`, `Total Overhead Cost`
- `Target Revenue`, `Target Achieved ` (trailing space in field name — intentional)
- `Resource Count`, `Duration (Months)`

**Invoices table** `tblyWvNkprE1HnaVZIH`  
Key fields (from `invoice.py INVOICE_FIELD_IDS`):
- `Invoice Number`, `Project`, `Category`, `Description`, `Milestone`
- `Raised By`, `Raised Date`, `Cleared Date`
- `Amount Raised` (pre-GST), `Amount with Tax`, `Amount Received`
- `Payment Status` (`Paid` | `Pending` | `Cancelled`)
- `Days To Clear`, `Speed`, `Agening (Days)`, `Outstanding Amount` — **READ-ONLY** (computed by Teable)
- `Next followup`, `Remark`, `Reference`, `Invoice PDF`

### Financial KPI logic (invoices)

```
Total Raised    = sum(Amount Raised) for Paid + Pending  (excludes Cancelled)
Total Collected = sum(Amount Raised) for Paid only
Total Outstanding = sum(Amount Raised) for Pending only
Collection Rate = Total Collected / Total Raised × 100
DSO             = avg(Cleared Date - Raised Date) for Paid invoices only
```

**Important:** "Collected" uses `Amount Raised` (pre-GST), not `Amount Received` field. This means Collected = Total Raised when all invoices are paid — matching the user's mental model.

### Cache (`backend/app/utils/cache.py`)

Single `TTLCache` singleton. Key behaviours:
- `get_or_set(key, ttl, loader)` — async-safe, coalesces concurrent calls (only one upstream request per key)
- `bust(prefix=)` — namespace-scoped invalidation: `cache.bust("project:")` or `cache.bust("invoice:")`
- `stats()` — returns hit rate, hits, misses, inflight count (exposed on `/health`)

TTLs:
| Cache key | TTL |
|---|---|
| `project:list:*` | 15s |
| `project:summary` | 30s |
| `invoice:list:*` | 15s |
| `invoice:all` | 30s |
| `invoice:summary` | 30s |

### AI layer (`backend/app/services/openrouter.py`)

**Model cascade** (tried in order, falls back on failure):
1. `meta-llama/llama-3.3-70b-instruct:free` (leakage=0)
2. `google/gemini-2.0-flash-exp:free` (leakage=0)
3. `mistralai/mistral-7b-instruct:free` (leakage=1)
4. `nvidia/nemotron-3-super-120b-a12b:free` (leakage=5, last resort)

**Answer extraction protocol** — every prompt instructs the model to wrap its answer:
```
===ANSWER===
...actual answer here...
===END===
```

Three-layer extraction in `_extract_answer()`:
1. Extract content between `===ANSWER===` and `===END===`
2. Strip XML-style reasoning tags (`<think>`, `<reasoning>`, etc.)
3. Drop plan-line prefixes (`Sentence 1:`, `Step 1:`, `Output:`, etc.)

Retries only on 5xx/transient errors (not 4xx). Shared `httpx.AsyncClient` with connection pooling.

### API routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Returns token |
| `GET` | `/api/auth/verify` | Validates token |
| `GET` | `/api/projects` | List with filter/sort/pagination |
| `GET` | `/api/projects/summary` | Aggregated KPIs |
| `GET` | `/api/projects/search` | Text search |
| `GET` | `/api/projects/{id}` | Single record |
| `POST` | `/api/projects` | Create |
| `PATCH` | `/api/projects/{id}` | Update |
| `DELETE` | `/api/projects/{id}` | Delete |
| `GET` | `/api/invoices` | List with filter/sort |
| `GET` | `/api/invoices/summary` | Invoice KPIs |
| `GET` | `/api/invoices/{id}` | Single invoice |
| `POST` | `/api/invoices` | Create |
| `PATCH` | `/api/invoices/{id}` | Update |
| `DELETE` | `/api/invoices/{id}` | Delete |
| `POST` | `/api/ai/chat` | Conversational AI (90s timeout) |
| `POST` | `/api/ai/autofill` | Fill project fields from description |
| `POST` | `/api/ai/analyze` | Analyze a single project record |
| `GET` | `/api/ai/report` | Generate full portfolio narrative |
| `GET` | `/health` | Full health + cache stats |
| `GET` | `/health/live` | Cheap liveness probe |

**Error envelope** (all errors return this shape):
```json
{ "error": { "code": 422, "type": "HTTPException", "message": "...", "request_id": "abc123" } }
```

**Middleware:** Every response gets `X-Request-ID` and `X-Response-Time-Ms` headers.

---

## Frontend details

### Design system (`frontend/src/index.css`)

Blue & white theme. CSS custom properties:

| Variable | Light | Dark |
|---|---|---|
| `--bg-base` | `#f7f9fc` | `#0b1221` |
| `--card-bg` | `#ffffff` | `#131a2c` |
| `--card-border` | `#e5e9f0` | `#1f2942` |
| `--accent` | `#2563eb` | `#3b82f6` |
| `--accent-btn` | `#2563eb` | `#2563eb` |
| `--accent-dim` | `#eff6ff` | `rgba(59,130,246,0.12)` |
| `--fin-positive` | `#16a34a` | `#4ade80` |
| `--fin-warning` | `#ea580c` | `#fb923c` |
| `--fin-negative` | `#dc2626` | `#f87171` |
| `--sidebar-bg` | `#ffffff` | `#0f1626` |
| `--text-1` | `#0f172a` | `#e2e8f0` |
| `--text-2` | `#475569` | `#94a3b8` |
| `--text-3` | `#94a3b8` | `#64748b` |

Key CSS component classes: `.card`, `.card-hover`, `.card-elevated`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-icon`, `.input`, `.label`, `.section-title`, `.page-title`, `.badge-active/completed/hold/cancelled`, `.tbl-head`, `.tbl-row`, `.tbl-cell`, `.kpi-icon`, `.skeleton`, `.live-dot`, `.login-bg`

Dark mode: toggled by adding `html.dark` class. Default is **light mode**.

### Code splitting (App.jsx)

Dashboard and Login are eagerly loaded. All other pages are lazy:
```js
const Projects    = React.lazy(() => import('./pages/Projects'))
const Invoices    = React.lazy(() => import('./pages/Invoices'))
const Analytics   = React.lazy(() => import('./pages/Analytics'))
const AIAssistant = React.lazy(() => import('./pages/AIAssistant'))
const Report      = React.lazy(() => import('./pages/Report'))
```

Vite manual chunks: `react-vendor`, `icons` (lucide-react), `charts` (recharts).  
Initial bundle: ~232KB gzipped (was 725KB before split).

### Navigation

- **Desktop:** Collapsible sidebar (224px expanded, 56px collapsed). State persisted in `localStorage` as `ft-sidebar-collapsed`.
- **Mobile:** Bottom nav bar with 5 primary destinations (Home, Projects, Invoices, Stats, AI). Hamburger opens a drawer for theme toggle and sign-out.

### Request layer (`frontend/src/services/api.js`)

- `_dedupedFetch`: coalesces identical concurrent GETs into one promise (keyed by `"METHOD path"`). Only for GET without external `signal`.
- Retry: 2 retries on non-4xx errors, 600ms delay between retries. No retry when caller provides external `signal`.
- Timeout: 20s default, 90s for AI endpoints.
- Token: `Authorization: Bearer <token>` from `localStorage['fintrack-auth-token']`.

### Known patterns / gotchas

1. **Stale closures in `useAutoRefresh`**: Solved with `useRef` pattern — `fetchRef.current` is always the latest function, preventing stale closures from polling intervals.

2. **Modal/drawer z-index trap**: Elements with CSS `transform` (e.g. `animate-scale-in`) create new stacking contexts trapping `position:fixed` children. Fixed by wrapping drawers in `ReactDOM.createPortal(_, document.body)`.

3. **Teable filter params**: Filters must use field IDs (not field names) in `filterSet`. Field name lookup uses `FIELD_IDS` dict in `models.py` (projects) and `INVOICE_FIELD_IDS` in `invoice.py` (invoices).

4. **Read-only invoice fields**: `Days To Clear`, `Speed`, `Agening (Days)`, `Outstanding Amount` are computed by Teable — never send these in create/update payloads. Handled by `_clean_fields()` in `invoice.py`.

5. **`Target Achieved ` has a trailing space** in the Teable field name — must be preserved in code.

6. **AI timeout**: AI endpoints use 90s client timeout + 90s backend timeout. The frontend passes `timeout: AI_TIMEOUT_MS` in the request options.

---

## Pages — purpose and key data

| Page | Route | Data source | Refresh interval |
|---|---|---|---|
| Dashboard | `/` | `/api/projects/summary` + `/api/projects?limit=6` | 5s |
| Projects | `/projects` | `/api/projects` | 30s |
| ProjectDetail | `/projects/:id` | `/api/projects/:id` | — |
| Invoices | `/invoices` | `/api/invoices` + `/api/invoices/summary` | 30s |
| Analytics | `/analytics` | `/api/invoices/summary` (+ all invoices) | 60s |
| AI Assistant | `/ai` | `/api/ai/chat` (on send) | — |
| Report | `/report` | `/api/ai/report` + `/api/projects/summary` | on demand |

---

## Design decisions (history)

- **No green anywhere except semantic** — the entire green accent from the original design was removed. Green is now reserved for `--fin-positive` (positive financial values, live indicator dots). All UI chrome uses blue (`--accent`).
- **Single password auth** — no user accounts; one shared password. Token is HMAC-signed opaque string; password never stored client-side.
- **Collected = pre-GST Amount Raised of Paid invoices** — not `Amount Received` field. This makes Collected = Total Raised when everything is paid (user's mental model).
- **Cancelled invoices excluded from all KPI totals** — only Paid + Pending count toward revenue.
- **No Executive Summary / ExecView** — removed. Was added then removed per user request (too gimmicky).
- **PDF board pack** = `window.print()` with `@media print` CSS. No library needed.

---

## What was removed (do not re-add)

- `ExecutiveSummary.jsx` — removed
- `ExecView.jsx` — removed  
- `/exec` route — removed
- `api.ai.executiveSummary` method — removed
- `GET /api/ai/executive-summary` endpoint — removed
- "Revenue by Category" chart on Analytics — removed
- Colorful gradient blob background on Dashboard/Login — removed (replaced with dot-grid on Login)

---

## Local dev setup

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (in another terminal)
cd frontend
npm install
npm run dev          # Vite dev server on :5173, proxies /api → :8000
```

Required `.env` in `backend/`:
```
TEABLE_API_TOKEN=your_teable_token
OPENROUTER_API_KEY=your_openrouter_key
APP_PASSWORD=tw@2026
APP_SECRET=some-random-secret
```

---

## Git workflow

Main branch: `main`. Direct push to `main`. No PRs.  
Deploy: Cloudflare Pages auto-deploys frontend on push. HF Space auto-deploys backend.

Recent significant commits:
```
c3e9893  design: comprehensive UI polish (Login blue, AI blue, greeting)
ef4299a  Remove ExecutiveSummary + ExecView; rebuild AI layer; better system design
ba98475  CXO-tier features: AI Executive Summary, /exec, board-pack PDF
c1b2520  Analytics v2: period filter, sparklines, DSO, concentration risk
95f3d92  Rebuild KPI cards (horizontal tile layout) + harden AI reasoning filter
b78090f  Revamp to blue & white theme
e043464  Simplify financial KPIs: collected = pre-GST raised of Paid invoices only
```
