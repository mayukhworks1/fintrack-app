# Incident response

What to do, in order, if FinTrack may have been broken into, a password or
key has leaked, or data looks wrong. Do the first two within minutes.

## 1. Stop access

- **Admin → Sync log → Emergency: sign out everyone.** Every signed-in person
  and every shared team-password login stops working at once. Data is not
  touched. You sign in again afterwards.
- One person only: **Admin → Users → the person → Revoke sessions**, or
  **Disable**.
- Change any password that may have leaked: your own (Profile), the shared role
  passwords (`APP_PASSWORD`, `APP_VIEW_PASSWORD`, `APP_WEB_PASSWORD`,
  `APP_ALL_PASSWORD`, `APP_ADMIN_PASSWORD` in the Hugging Face Space secrets).

## 2. Rotate keys that may be exposed

All server secrets live in the Hugging Face Space settings (Settings →
Variables and secrets), never in the repository. Rotate what may be affected:

| Secret | Where to make a new one |
| --- | --- |
| `APP_SECRET` | any long random string; signs everyone out as well |
| `DATABASE_URL` | Aiven console → reset the database user's password |
| `TEABLE_API_TOKEN`, `TEABLE_WEB_API_TOKEN` | Teable → Personal access tokens |
| `TEABLE_WEBHOOK_SECRET` | new random string, also in the Teable automation header |
| `HF_TOKEN` | huggingface.co → Settings → Access tokens (fine-grained, this dataset only) |
| AI provider keys | Admin → AI gateway → the provider → replace key |
| Cloudflare build token | Cloudflare → Workers & Pages → fintrack-app → Settings → Build |

The Space restarts with the new values when you save them.

## 3. Find out what happened

- **Admin → Audit log**: every request with time, user, IP and path
  (passwords and tokens in addresses are blanked).
- **Admin → Users → the person → Timeline** for one account.
- **Admin → Sync log** for Teable sync and deletions.
- Hugging Face Space → Logs for server errors around the time.

## 4. Recover data

- Teable keeps invoices and projects; it has its own record history.
- Everything else: **Admin → Sync log → Database backups** lists the nightly
  backups (last 30 days). Restore steps: `docs/BACKUPS.md`.
- Make a fresh backup (**Back up now**) before restoring anything, so the
  current state is kept too.

## 5. Afterwards

- Write down what happened, when it was noticed, and what was changed.
- If client data was exposed, tell the affected clients.
