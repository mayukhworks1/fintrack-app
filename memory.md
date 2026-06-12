# FinTrack Working Memory

## Current State
- Primary workspace: `/Users/Mayuk/fintrack-app`
- Branch in use: `main`
- Source of truth for operational CRUD remains Teable-first; PostgreSQL is mirror/audit/analytics support.
- Auth stack supports legacy password, email-password auth, Google SSO, Zoho SSO, approval workflow, and admin-managed users.

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
