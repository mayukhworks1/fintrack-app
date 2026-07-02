# FinTrack Working Memory

## Current State
- Primary workspace: `/Users/Mayuk/fintrack-app`
- Branch in use: `main`
- Source of truth for operational CRUD remains Teable-first; PostgreSQL is mirror/audit/analytics support.
- Auth stack supports legacy password, email-password auth, Google SSO, Zoho SSO, approval workflow, and admin-managed users.

## Code-Review Fixes — branch `claude/code-review-gaps-f1x9af` (2026-07-02)
Security + correctness pass following a full read-only review. Commits:
- **XSS (fix/security):** the hand-rolled markdown renderers (`PageViewer`,
  `PagesManager`, `ProjectDetail`) injected user/AI content via
  `dangerouslySetInnerHTML` without escaping, and public HTML pages used
  `document.write()` into the top document — both = arbitrary script on the app
  origin. Added `frontend/src/utils/sanitize.js` (escapeAttr/escapeHtml/safeUrl);
  markdown now escapes `<` before parsing and attribute-escapes + scheme-checks
  every URL; HTML pages render in a sandboxed iframe **without allow-same-origin**
  (author script runs in an opaque origin, can't read the parent token).
- **Webhook fail-closed:** `/api/webhooks/teable` now rejects unsigned requests
  when `TEABLE_WEBHOOK_SECRET` is unset (was accept-all). Escape hatch:
  `WEBHOOK_ALLOW_UNSIGNED=true` for local dev. Incremental/full sync still keep
  the mirror fresh when the instant path is disabled.
- **Invoice summary:** owner-scoped users got an empty summary when Teable
  returned None, and the Teable error path 500'd instead of falling back. The PG
  fallback was unscoped (org-wide leak). Now `get_summary_from_pg(raised_by=…)`
  is scoped and the endpoint falls back to it (503 only if mirror also down).
- **Background tasks:** added `backend/app/utils/tasks.spawn()` to retain strong
  refs for fire-and-forget tasks (audit/session-touch/login-log/SSO-avatar/
  webhook-bust could be GC'd mid-flight). Failures are now logged.
- **Small correctness:** fixed `sync._coerce_str` operator precedence (linked-
  record fallback), and removed the misleading `token_hint[:20]` re-slice in
  `deps._attach_auth_session` (hint is a shared 16 chars).
- **CI:** `backend-smoke` now runs `pytest tests/` (9 pass / 10 skip locally).

### Open decisions (flagged, NOT changed)
- **Primary AI model is contradictory:** `config.py` defaults primary to
  `llama-4-scout:free`, but `render.yaml` forces `nvidia/nemotron-3-super-120b`
  as primary — which `openrouter.py` itself marks "last resort, heavy reasoning
  leakage" — and the frontend advertises "Nemotron 120B". Pick one intended
  primary; changing it affects AI output quality, so left for a product call.
- **CORS** still falls back to `*` when `FRONTEND_URL` is unset (warned at
  startup; `allow_credentials=False` limits the blast radius). Accepted as a dev
  default; set `FRONTEND_URL` in every real deployment.
- **Large page components** (AdminDashboard 5.2k, WebInvoices 4.5k, Invoices 4k,
  StatusBoard 3.6k lines) — decomposition is the biggest maintainability follow-up.
- **No CSP header** anywhere — would add defense-in-depth behind the XSS fix.

## Recent Fixes
- Shared public invoice/status views now support:
  - safer live event logging via `/api/public/view/{token}/event`
  - `record_detail` and `attachment_open` analytics
  - highlight-column persistence in shared links
  - stronger full-column highlight rendering in list view
- Admin shared-links tab now consumes aggregated stats and exposes:
  - unique viewers
  - page views
  - record opens
  - attachment opens
  - edits
  - location/device breakdown
  - event timeline
- Status attachment handling was hardened:
  - attachments are sanitized before Teable PATCH
  - attachment presence is surfaced in status cards and detail headers
  - edit flow now sends cleaned attachment payloads

## Files Touched In This Tranche
- `backend/app/routers/shared_views.py`
- `backend/app/services/shared_views.py`
- `backend/app/services/status.py`
- `frontend/src/services/api.js`
- `frontend/src/pages/SharedView.jsx`
- `frontend/src/pages/StatusBoard.jsx`
- `frontend/src/pages/AdminDashboard.jsx`

## Verification Completed
- `python3 -m compileall backend/app` passed
- `npm run build` in `frontend/` passed

## Known Follow-up Areas
- Shared link management UX can still be refined further for bulk operations and clearer edit/read-only affordances.
- Shared invoice data correctness should still be checked against live Teable records after deploy, especially for dynamic filtered links.
- Status creation/update latency likely needs another pass if Teable writes remain slow in production.
- Root-level smoke coverage is still lighter than ideal; admin/shared/public view paths deserve browser-driven checks.

## Next High-Value Checks
- Verify live shared invoice links on production:
  - correct record set
  - correct highlighted columns
  - attachment analytics visible in admin
- Verify status attachment removal persists to Teable after edit.
- Verify admin shared-links analytics render cleanly in light and dark themes.
