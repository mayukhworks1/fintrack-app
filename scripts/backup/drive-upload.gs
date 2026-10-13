/**
 * FinTrack nightly backup receiver (Google Apps Script).
 *
 * Runs in YOUR Google account and saves each backup the GitHub workflow sends
 * into a "FinTrack Backups" folder in your Drive, keeping the last KEEP_DAYS
 * days. Nothing else can write here: every upload must carry SECRET.
 *
 * Setup: see docs/BACKUPS.md. In short — paste this file into a new Apps
 * Script project, set SECRET, Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone), and copy the web app URL.
 */

// Paste the same long random value you saved as the BACKUP_SECRET GitHub secret.
const SECRET = 'PASTE-YOUR-BACKUP-SECRET-HERE';
const FOLDER_NAME = 'FinTrack Backups';
const KEEP_DAYS = 30;

function doPost(e) {
  try {
    if (SECRET.indexOf('PASTE-') === 0 || SECRET.length < 24) {
      return reply({ ok: false, error: 'SECRET is not set in the Apps Script' });
    }
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SECRET) return reply({ ok: false, error: 'unauthorized' });

    const name = String(body.name || '');
    if (!/^fintrack-[0-9A-Za-z_.-]{1,80}\.sql\.gz$/.test(name)) {
      return reply({ ok: false, error: 'bad file name' });
    }
    const bytes = Utilities.base64Decode(String(body.data || ''));
    if (bytes.length < 100) return reply({ ok: false, error: 'backup is empty' });

    const folder = getFolder_();
    const file = folder.createFile(Utilities.newBlob(bytes, 'application/gzip', name));
    const removed = prune_(folder);
    return reply({ ok: true, name: file.getName(), size: file.getSize(), removed: removed });
  } catch (err) {
    return reply({ ok: false, error: String(err).slice(0, 200) });
  }
}

// Visiting the URL in a browser just confirms the script is deployed.
function doGet() {
  return reply({ ok: true, service: 'FinTrack backup receiver' });
}

function getFolder_() {
  const found = DriveApp.getFoldersByName(FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
}

// Remove this workflow's own backups older than KEEP_DAYS. Other files in the
// folder are never touched.
function prune_(folder) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const files = folder.getFiles();
  let removed = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (/^fintrack-.*\.sql\.gz$/.test(f.getName()) && f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  }
  return removed;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
