# Nightly database backups to Google Drive

Every night at **2:00 AM IST** a GitHub workflow (`.github/workflows/backup.yml`)
makes a full copy of the PostgreSQL database, compresses it, and saves it to a
**FinTrack Backups** folder in your Google Drive. The last **30 days** are kept;
older copies are moved to the Drive bin automatically.

What it protects: Pages (content, versions, settings), page views, login
accounts and everything else in the database. Invoices and projects also live
in Teable, so they are covered twice.

If a backup ever fails, GitHub emails you.

---

## One-time setup (about 10 minutes)

### 1. Make a secret password for the backups

Any long random text, 30+ characters. One way: open
<https://www.random.org/strings/?num=1&len=32&digits=on&upperalpha=on&loweralpha=on&unique=on&format=html&rnd=new>
and copy the result. Keep it handy for steps 2 and 3.

### 2. Create the Google script (it saves files to your Drive)

1. Open <https://script.google.com> with the Google account whose Drive should
   hold the backups, and click **New project**.
2. Delete what is in the editor and paste the whole of
   `scripts/backup/drive-upload.gs` from this repository.
3. On the line `const SECRET = 'PASTE-YOUR-BACKUP-SECRET-HERE';` replace the
   text between the quotes with your secret from step 1. Click **Save**.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and
   choose **Web app**. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   ("Anyone" only means GitHub can reach it; without your secret it refuses
   every upload.)
5. Click **Deploy**, then **Authorize access** and allow it to use your Drive.
   Google may say the app isn't verified: click **Advanced → Go to (project)**.
   It is your own script.
6. Copy the **Web app URL** (ends in `/exec`).

### 3. Add three secrets to GitHub

In the GitHub repository: **Settings → Secrets and variables → Actions → New
repository secret**. Add:

| Name | Value |
|---|---|
| `BACKUP_DATABASE_URL` | The database address from Aiven: open the PostgreSQL service → **Overview → Connection information → Service URI** (starts with `postgres://`, includes the password and `?sslmode=require`) |
| `BACKUP_DRIVE_URL` | The Web app URL from step 2 |
| `BACKUP_SECRET` | The secret from step 1 |

### 4. Run it once to check

**Actions → Nightly database backup → Run workflow**. After about a minute it
turns green and a file like `fintrack-2026-10-13-0200.sql.gz` appears in the
**FinTrack Backups** folder in your Drive.

---

## Restoring from a backup

Only needed if the database is lost or damaged. Restoring writes into the
database you point it at, so restore into a **new, empty** database first and
check it before switching the app over.

1. Download the backup file you want from the **FinTrack Backups** folder.
2. On a computer with PostgreSQL 17 tools installed:

   ```bash
   gunzip -c fintrack-2026-10-13-0200.sql.gz | psql "postgres://…new-database-service-uri…"
   ```

3. Point the app at the restored database by updating `POSTGRES_URL` in the
   Hugging Face Space secrets, then restart the Space.

## Changing things later

- **Time of day:** the `cron` line in `.github/workflows/backup.yml`
  (`30 20 * * *` is 20:30 UTC = 02:00 IST).
- **How many days to keep:** `KEEP_DAYS` in the Google script; redeploy it
  (**Deploy → Manage deployments → Edit → New version**).
- **Database password changed:** update `BACKUP_DATABASE_URL` in GitHub.
