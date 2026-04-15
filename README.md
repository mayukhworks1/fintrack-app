# FinTrack — AI-Powered Project Finance Manager

Full-stack app to manage your Fintrack Teable projects with an AI assistant, analytics, and CRUD — deployed free on Cloudflare Pages + Render.

---

## Stack

| Layer | Tech | Hosting |
|-------|------|---------|
| Frontend | React + Vite + Tailwind | Cloudflare Pages (free) |
| Backend | FastAPI (Python) | Render (free) |
| AI | OpenRouter (Mistral 7B free) | — |
| Data | Teable REST API | app.teable.ai |
| CI/CD | GitHub Actions | github.com/mayukhworks1 |

---

## Local Development

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill in .env with your keys
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# Runs at http://localhost:8000
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
# Set VITE_API_URL=http://localhost:8000 for local dev
npm install
npm run dev
# Runs at http://localhost:5173
```

---

## Deployment

### Step 1 — Push to GitHub

```bash
cd /Users/Mayuk/fintrack-app
git init
git remote add origin https://github.com/mayukhworks1/fintrack-app.git
git add .
git commit -m "feat: initial fintrack full-stack app"
git push -u origin main
```

### Step 2 — Deploy Backend to Render

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo → select `mayukhworks1/fintrack-app`
3. Set **Root Directory** = `backend`
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables from `backend/.env.example`:
   - `TEABLE_API_TOKEN` = your token
   - `OPENROUTER_API_KEY` = your OpenRouter key
   - `FRONTEND_URL` = your Cloudflare Pages URL (add after step 3)
7. Copy the **Deploy Hook URL** from Render dashboard → add to GitHub Secrets as `RENDER_DEPLOY_HOOK_URL`
8. Note your Render URL (e.g. `https://fintrack-api.onrender.com`)

### Step 3 — Deploy Frontend to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages → Create project
2. Connect GitHub → select `mayukhworks1/fintrack-app`
3. Set **Root Directory** = `frontend`
4. Build command: `npm install && npm run build`
5. Output directory: `dist`
6. Add environment variables:
   - `VITE_API_URL` = your Render backend URL
7. Deploy → note your Pages URL (e.g. `https://fintrack-app.pages.dev`)
8. Go back to Render → update `FRONTEND_URL` with this URL

### Step 4 — Connect Custom Domain (Cloudflare)

1. In Cloudflare Pages → your project → Custom Domains → Add domain
2. Enter your domain (e.g. `fintrack.yourdomain.com`)
3. Cloudflare will auto-create the CNAME DNS record
4. Done — SSL is automatic

For the backend API subdomain:
1. In Cloudflare DNS → Add CNAME record:
   - Name: `api` (or `fintrack-api`)
   - Target: your Render URL (without `https://`)
   - Proxy: **DNS only** (orange cloud OFF — Render handles SSL)

### Step 5 — GitHub Secrets

Add these in `github.com/mayukhworks1/fintrack-app` → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Edit Cloudflare Pages permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `VITE_API_URL` | Your Render backend URL |
| `VITE_AI_MODEL` | `Mistral 7B` |
| `RENDER_DEPLOY_HOOK_URL` | Deploy hook from Render dashboard |

---

## CI/CD Flow

```
git push main
    │
    ├── frontend/** changed → GitHub Actions → npm build → Cloudflare Pages
    └── backend/**  changed → GitHub Actions → Render deploy hook → Render redeploy
```

Every push to `main` auto-deploys the changed layer. PRs do not deploy.

---

## Features

- **Dashboard** — live stats, status breakdown, client breakdown, top projects
- **Projects** — list, filter by status/client, search, paginate
- **Project Detail** — full field view, edit, delete with confirmation
- **AI Autofill** — describe a project in plain text → AI fills the form
- **Analytics** — bar charts, pie charts, profit table (Recharts)
- **AI Assistant** — natural language chat with live data context
- **AI Analysis** — per-project health/risk analysis
- **AI Report** — full executive portfolio report, downloadable

---

## Notes

- Render free tier spins down after 15 min of inactivity — first request may take ~30s to wake
- OpenRouter free models have rate limits; upgrade to a paid model for production use
- The `.env` files are gitignored — never commit real tokens
