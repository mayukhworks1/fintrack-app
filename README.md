# FinTrack — AI-Powered Project Finance Manager

Full-stack app for agency project billing, invoice tracking, and portfolio health monitoring. Built with React + FastAPI, deployed on Cloudflare Pages + Hugging Face Spaces.

---

## Stack

| Layer | Tech | Hosting |
|-------|------|---------|
| Frontend | React 18 + Vite + Tailwind | Cloudflare Pages |
| Backend | FastAPI (Python 3.11) | Hugging Face Spaces (Docker) |
| Primary DB | Teable REST API | app.teable.ai |
| Mirror DB | Aiven PostgreSQL (asyncpg) | Aiven Cloud |
| Cache / Rate-limit | Aiven Valkey (Redis-compatible, TLS) | Aiven Cloud |
| AI | OpenRouter (free model cascade) | openrouter.ai |

---

## Architecture

```
Browser  ──→  Cloudflare Pages (React/Vite)
                  │  REST /api/*
                  ▼
           HF Space — FastAPI (Python 3.11)
           ├── Auth (HMAC tokens, 5 roles)
           ├── Routers (projects, invoices, ai, status, admin, webhooks)
           ├── Services (Teable live API writes; PG mirrors for reads)
           ├── TOON encoder  ──→  Structured tokens for AI context
           ├── Async audit queue  ──→  PostgreSQL audit_log
           ├── Background sync    ──→  PostgreSQL *_mirror tables
           └── Valkey (geo cache, rate-limit, chat context, report cache)

Teable ←→ FastAPI (webhook: instant | 30 s incremental | 5 min full sync)
```

### 4-Table Teable → PostgreSQL Mirror Sync

| Tier | Trigger | Scope |
|------|---------|-------|
| Instant | Teable Automation webhook → `POST /api/webhooks/teable` | Single record |
| Incremental | Every 30 s | 200 most-recently-modified records |
| Full | Every 5 min | All records (guaranteed consistency) |

Mirror tables: `projects_mirror`, `invoices_mirror`, `web_invoices_mirror`, `status_mirror`.

---

## Teable Tables

| Name | Table ID | Purpose |
|------|----------|---------|
| Projects | `tbl4fi155DuWlh40By3` | Project billing + P&L |
| Invoices | `tblyWvNkprE1HnaVZIH` | Main invoice tracker |
| Web Invoices | `tbllkYiaS68BlcOc1Jy` | Client-facing invoice module |
| Web Projects | `tbl4qgQkatguBwrzxtf` | Web project tracker |
| Web Resources | `tblMjssDx55GOfLtgqo` | Resource management |
| **Current Status** | `tblgdbV6T4Ly9n6YNCU` | Live project status updates |

---

## Modules

### Main App (editor / viewer roles)
- **Dashboard** — KPI grid, client P&L bars, at-risk projects, top projects
- **Projects** — Full CRUD with filters, sort, search, AI autofill
- **Invoices** — Invoice tracker, AI PDF parser, aging analysis
- **Analytics** — Cash flow charts, DSO, concentration risk
- **AI Assistant** — Chat with full portfolio context (PG-backed, <10ms context build)
- **Report** — AI executive board report (TOON-enhanced, 4096 token, cached 10min)
- **Status Board** — Live project status updates per client/project (new)

### Status Board (`/status`)
- Cards grouped by client, collapsible detail view
- Editor: create/edit/delete inline via modal
- Data synced to PG mirror via 3-tier sync + webhook
- Changes bust `chat:context` + `report:executive` caches immediately

### TOON — Token Oriented Object Notation
All entities serialised as structured tokens: `[TYPE|key:value|key:value|...]`
```
[PROJECT|client:Birla Open Minds|name:PMS Phase 1.1|status:🟢 Active|margin:35.2|risk:LOW]
[INVOICE|num:INV-001|project:PMS Phase 1.1|outstanding:50000|status:Pending|aging:15d]
[STATUS|client:Birla Open Minds|project:PMS Phase 1.1|short:UAT in progress|detail:…]
```
Used in AI chat context + report generation for reliable structured AI parsing.

---

## Authentication — 5 Roles

| Role | Password env | Access |
|------|-------------|--------|
| `editor` | `APP_PASSWORD` | Full CRUD, AI, admin panel |
| `viewer` | `APP_VIEW_PASSWORD` | Read-only main app |
| `web` | `APP_WEB_PASSWORD` | Web invoices only |
| `all` | `APP_ALL_PASSWORD` | Web projects + resources |
| `admin` | `APP_ADMIN_PASSWORD` | PostgreSQL admin dashboard |

Token: `base64url("{expiry}:{role}").base64url(HMAC-SHA256)` — 7-day TTL.

---

## PostgreSQL Schema

| Table | Purpose |
|-------|---------|
| `audit_log` | Every HTTP request — role, path, status, geo, timing, device |
| `login_sessions` | Active tokens, last-seen, 4-state status |
| `chat_sessions` | AI conversation groups |
| `chat_messages` | Individual AI turns — server-side history |
| `projects_mirror` | Full Teable projects replica (JSONB + typed columns) |
| `invoices_mirror` | Main invoices replica |
| `web_invoices_mirror` | Web invoices replica |
| `status_mirror` | Current Status table replica |
| `record_history` | Field-level change log with full actor attribution |
| `sync_log` | Sync run metadata per table |

Schema is bootstrapped idempotently: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.

---

## Async Audit Architecture

```
HTTP request completes
  → middleware enqueue_audit(**kwargs)   ← sync, ~0 µs
  → response returned immediately

audit_worker (background):
  → drains queue in batches up to 100 rows
  → geo-enriches concurrently (Valkey 24h cache)
  → executemany INSERT into audit_log
  → flush interval ≤ 500 ms
```

Queue bounded at 2000 entries. HTTP responses never blocked for logging.

All writes (projects, invoices, status) also write to `record_history` via the attribution pipeline: HTTP handler → Valkey attribution set → sync loop pops and writes `record_history` row with full actor data (IP, geo, OS, browser, device).

---

## Valkey Usage

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `geo:{ip}` | 24 h | IP → country/city/ISP/lat/lon/tz cache |
| `ratelimit:{ip}` | 60 s | Sliding-window rate limiter |
| `session_touch:{token_hint}` | 5 min | Rate-limit session heartbeat DB writes |
| `chat:context` | 5 min | Formatted AI context (busted on sync + status write) |
| `report:executive` | 10 min | AI report cache (busted on sync + status write) |
| `attrib:{teable_id}` | 2 min | Actor attribution bridge (HTTP → sync loop) |
| `status:list:*` | 1 min | Status records cache |

---

## AI Optimization

### Chat context (<10ms)
```
Request → Valkey "chat:context" HIT → 1ms
                              MISS → PG mirrors + TOON encode → 10ms → cache 5min
```
Context includes projects, invoices, TOON tokens, and live status updates.

### Report (cached 10min)
- Data from PG mirrors (not Teable) + status records
- TOON-encoded structured context for precise AI parsing
- "Current Project Status:" section from status_mirror
- 4096 max tokens, 180s timeout (handles 12+ model fallbacks)
- Coalesced via `cache.get_or_set` — concurrent "Generate" clicks = 1 LLM call

---

## Rate Limiting

| Endpoint group | Limit |
|----------------|-------|
| AI chat | 20/min/IP |
| AI report force-regen | 10/min/IP |
| Status mutations | 30/min/IP |

---

## Admin Dashboard

Accessible at `/admin` (editor role) or standalone (admin role):

| Tab | Contents |
|-----|----------|
| Overview | Stats including status_mirror count |
| Audit Log | 12 filters, geo/device detail, purge controls |
| Sessions | 4-state status, active filter |
| AI Chats | Session list + thread viewer |
| Sync Log | Per-table history + trigger button |
| Projects | projects_mirror browser |
| Invoices | All/Main/Web toggle |
| Status | status_mirror browser (new) |
| History | Field-level change log with actor attribution |

---

## Local Development

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in tokens
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev   # :5173, proxies /api → :8000
```

Required `.env`:
```
TEABLE_API_TOKEN=...
OPENROUTER_API_KEY=...
APP_PASSWORD=...
APP_SECRET=...            # random 32-char string
POSTGRES_URL=...          # postgres://user:pass@host:port/db?sslmode=require
VALKEY_URL=...            # rediss://user:pass@host:port
```

---

## HF Space Secrets

| Secret | Purpose |
|--------|---------|
| `TEABLE_API_TOKEN` | Projects + main invoices |
| `TEABLE_WEB_API_TOKEN` | Web invoices |
| `TEABLE_ALL_API_TOKEN` | Web projects |
| `TEABLE_STATUS_TABLE_ID` | Current Status table (default: `tblgdbV6T4Ly9n6YNCU`) |
| `OPENROUTER_API_KEY` | AI API key |
| `APP_PASSWORD` | Editor role |
| `APP_VIEW_PASSWORD` | Viewer role |
| `APP_WEB_PASSWORD` | Web role |
| `APP_ALL_PASSWORD` | All role |
| `APP_ADMIN_PASSWORD` | Admin role (default: `Master@2026`) |
| `APP_SECRET` | HMAC signing key |
| `POSTGRES_URL` | Aiven PostgreSQL DSN |
| `VALKEY_URL` | Aiven Valkey DSN |
| `TEABLE_WEBHOOK_SECRET` | Webhook HMAC auth (optional) |

---

## CI/CD

- Push to `main` → GitHub Actions
  - `deploy-backend.yml` → Hugging Face Spaces (Docker)
  - `deploy-frontend.yml` → Cloudflare Pages
