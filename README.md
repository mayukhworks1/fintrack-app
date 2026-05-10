# FinTrack — AI-Powered Project Finance Manager

Full-stack app to manage project billing, invoices, and portfolio health with an AI assistant, analytics, live admin dashboard, and full CRUD — deployed on Cloudflare Pages + Hugging Face Spaces (Docker).

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
                  │
                  │  REST /api/*
                  ▼
           HF Space  FastAPI
           ├── Auth (HMAC tokens, 5 roles)
           ├── Routers (projects, invoices, ai, admin, webhooks)
           ├── Services (Teable live API reads/writes)
           ├── Async audit queue  ──→  PostgreSQL  audit_log
           ├── Background sync    ──→  PostgreSQL  *_mirror tables
           └── Valkey  (geo cache, rate-limit, chat context cache)

Teable  ←→  FastAPI  (webhook: instant | 30 s incremental | 5 min full sync)
```

### Teable → PostgreSQL Mirror Sync (3-tier)

| Tier | Trigger | Scope |
|------|---------|-------|
| Instant | Teable Automation webhook → `POST /api/webhooks/teable` | Single record |
| Incremental | Every 30 s | 200 most-recently-modified records |
| Full | Every 5 min | All records (guaranteed consistency) |

Mirror tables: `projects_mirror`, `invoices_mirror`, `web_invoices_mirror`.  
Every sync busts the `chat:context` Valkey key so the AI always uses fresh data.

---

## Valkey Usage

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `geo:{ip}` | 24 h | IP → country/city/ISP cache (ipapi.co) |
| `ratelimit:{ip}` | sliding 60 s | Sliding-window rate limiter (Sorted Set) |
| `session_touch:{token_hint}` | 5 min | Prevents redundant DB writes on heartbeat |
| `chat:context` | 5 min | Formatted AI context string (busted on sync) |

---

## PostgreSQL Usage

| Table | Purpose |
|-------|---------|
| `audit_log` | Every HTTP request — role, path, status, geo, timing |
| `login_sessions` | Active tokens with 4-state status (online / idle / logged_out / expired) |
| `chat_sessions` | AI conversation groups |
| `chat_messages` | Individual AI turns — used as server-side history |
| `projects_mirror` | Full Teable projects replica (JSONB + typed columns) |
| `invoices_mirror` | Full Teable main invoices replica |
| `web_invoices_mirror` | Full Teable web invoices replica |
| `record_history` | Field-level change log (old_fields / new_fields JSONB diff) |
| `sync_log` | Sync run metadata (created/updated/unchanged counts, errors) |

Schema is bootstrapped idempotently at startup — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations so existing databases get new columns automatically.

---

## Async Logging Architecture

All HTTP request logging is **non-blocking fire-and-forget**:

```
HTTP request completes
  → middleware calls enqueue_audit(**kwargs)   ← synchronous, ~0 µs
  → response returned to client immediately

Background audit_worker coroutine:
  → drains queue in batches up to 100 rows
  → geo-enriches concurrently (Valkey cache makes most <1 ms)
  → executemany INSERT into audit_log
  → flush interval ≤ 500 ms
```

Queue is bounded at 2000 entries. Under extreme load (DB down / traffic spike) old entries are silently dropped — HTTP responses are never delayed for logging.

---

## AI Chat Optimization

Context for each chat message is built once and cached:

```
Chat request arrives
  ↓
Check Valkey "chat:context"
  ├── HIT  → ~1 ms   (most requests)
  └── MISS → query PG mirrors → format → cache for 5 min → ~10 ms

Old approach: 4 live Teable API calls per message → ~500–2000 ms
```

Chat history is server-side: the backend loads the last 12 message-pairs from `chat_messages` by `session_id`, so clients don't need to re-send growing history payloads.

---

## Authentication — 5 Roles

| Role | Password env | Access |
|------|-------------|--------|
| `editor` | `APP_PASSWORD` | Full CRUD, AI, admin panel |
| `viewer` | `APP_VIEW_PASSWORD` | Read-only main app |
| `web` | `APP_WEB_PASSWORD` | Web invoices only |
| `all` | `APP_ALL_PASSWORD` | Web projects + resources |
| `admin` | `APP_ADMIN_PASSWORD` | PostgreSQL admin dashboard |

Token format: `base64url("{expiry}:{role}").base64url(HMAC-SHA256)` — 7-day TTL, signed with `APP_SECRET`.

---

## Admin Dashboard (embedded)

Accessible at `/admin` for `editor` role (or standalone for `admin` role):

- **Overview** — aggregate stats, error rates, requests by role
- **Audit Log** — every request with expandable geo/device detail, click-to-expand rows
- **Sessions** — 4-state honest status (online/idle/logged_out/expired), active filter
- **AI Chats** — session list + full message thread viewer
- **Sync Log** — per-table sync history + "Trigger Full Sync Now" button
- **Projects/Invoices** — mirror table browser (All/Main/Web toggle for invoices)
- **History** — field-level change log

---

## Local Development

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in tokens
uvicorn app.main:app --reload --port 8000
```

Required `.env`:
```
TEABLE_API_TOKEN=...
TEABLE_WEB_API_TOKEN=...   # optional, falls back to TEABLE_API_TOKEN
OPENROUTER_API_KEY=...
APP_PASSWORD=...
APP_SECRET=...             # any random 32-char string
POSTGRES_URL=...           # optional but recommended
VALKEY_URL=...             # optional but recommended
```

### Frontend

```bash
cd frontend && npm install && npm run dev   # :5173, proxies /api → :8000
```

---

## HF Space Secrets

Set in your Hugging Face Space → Settings → Repository secrets:

| Secret | Purpose |
|--------|---------|
| `TEABLE_API_TOKEN` | Teable auth (projects + main invoices) |
| `TEABLE_WEB_API_TOKEN` | Teable auth (web invoices — falls back to main token) |
| `TEABLE_ALL_API_TOKEN` | Teable auth (web projects) |
| `OPENROUTER_API_KEY` | AI model API key |
| `APP_PASSWORD` | Editor role password |
| `APP_VIEW_PASSWORD` | Viewer role password |
| `APP_WEB_PASSWORD` | Web role password |
| `APP_ALL_PASSWORD` | All role password |
| `APP_ADMIN_PASSWORD` | Admin role password (default: `Master@2026`) |
| `APP_SECRET` | HMAC signing key (any random string) |
| `POSTGRES_URL` | Aiven PostgreSQL DSN (`postgres://...`) |
| `VALKEY_URL` | Aiven Valkey DSN (`rediss://...`) |
| `TEABLE_WEBHOOK_SECRET` | Shared secret for webhook auth (optional) |
