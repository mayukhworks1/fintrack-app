"""
Artifacts: small, self-contained web apps kept as pages.

An artifact is stored and served exactly like a Web Page (content_type "html"):
the same render URL, the same sandbox, the same Content-Security-Policy — see
services/page_render.py. What differs is what it is for. A Web Page is
something to read; an artifact is something to use — a calculator, a form, a
small dashboard. So it gets its own generation brief, and its link preview is
taken from the document itself when the author has not written one.
"""

from __future__ import annotations

import html as _html
import re

from . import artifact_design

CONTENT_TYPE = "artifact"

# Content types served through the HTML renderer.
RENDERED_TYPES = ("html", CONTENT_TYPE)

# Script and style hosts an artifact may load from. The renderer's policy is
# broader than this; the brief is narrower on purpose, so a generated artifact
# depends on a handful of long-lived public CDNs and nothing else.
CDN_ALLOWLIST = (
    "https://cdnjs.cloudflare.com",
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
)


def is_rendered(content_type: str | None) -> bool:
    """True for every type the HTML renderer serves."""
    return (content_type or "") in RENDERED_TYPES


ARTIFACT_RULES = f"""You build small, self-contained interactive web apps ("artifacts"):
anything from a calculator, to-do list or expense splitter to a CRM, booking
page, poll, quiz, habit tracker, inventory or small game. They should look and feel like a polished product made by a
good design team, not a demo: a real typeface, a considered layout, every state
designed, every control aligned.

THE ENVIRONMENT — the artifact is ONE HTML file served as its own document in a
sandboxed iframe with an opaque origin.
- Put everything in that one file: the <style> in <head>, one <script> before
  </body>. No relative URLs, no build step, no modules loaded from disk.
- NO network calls. Never use fetch, XMLHttpRequest, WebSocket, EventSource or
  sendBeacon, and never post a form anywhere. Everything the app needs is in
  the file or typed in by the person using it.
- External code only when it truly helps, and only from these hosts, pinned to an
  exact version: {", ".join(CDN_ALLOWLIST)}. Prefer plain JavaScript, inline
  <svg> for charts and the icon sprite below for icons.
- Data that should last or be seen by others goes through window.fintrack.db
  (see SHARED DATA below). localStorage is only for purely personal UI
  preferences (a theme, a collapsed panel), behind try/catch, under one key
  prefixed with the app's name. Never use cookies or IndexedDB.
- No alert(), confirm() or prompt() — use inline messages, toasts and undo.

{artifact_design.DESIGN_RULES}

OUTPUT FORMAT:
Return only the HTML document, <!DOCTYPE html> through </html>. No commentary,
no markdown code fences."""

# --- shared data ---------------------------------------------------------------
#
# Every artifact is given window.fintrack.db by the renderer (page_render.py,
# artifact_db_sdk.js): cloud data shared live between everyone who opens it,
# with the parent app doing the network calls. Kept in its own constant, and
# joined into ARTIFACT_RULES below, so the rest of the brief can change
# independently of it.
SHARED_DATA_RULES = """SHARED DATA — window.fintrack.db (always present; no setup, no keys)
Use it for ANY data that should persist or that other people should see: to-do
lists, sign-up sheets, polls, votes, likes, RSVPs, trackers, forms, guest books,
leaderboards, inventories, bookings, comments, scores, shared settings. Pure
calculators keep no data. Changes reach every open copy within about 2 seconds.

Cheat-sheet (every call returns a Promise):
  var db = window.fintrack.db;
  var c = db.collection('tasks');                 // shared: everyone sees the same records
  var mine = db.collection('notes', {scope: 'private'}); // each visitor sees only their own
  c.add({title: 'Milk', done: false})             // -> record
  c.update(id, {done: true})                      // field-level merge -> record
  c.update(id, {qty: 3}, {version: rec.version})  // fails if someone changed it first
  c.remove(id)
  c.get(id)                                       // -> record or null
  c.list({where: {done: false}, orderBy: 'createdAt', desc: true, limit: 50})
  c.count({done: true})                           // -> number
  c.increment(id, 'votes', 1)                     // atomic: polls, likes, counters, stock
  c.upsert('sku-42', {name: 'Pen', stock: 10})    // one record per key
  var off = c.subscribe(function(records){ render(records); }, {orderBy: 'createdAt'});
  db.doc('settings').get() / .set(obj) / .update(patch) / .increment('count') / .subscribe(cb)
  db.files.upload(fileInput.files[0])             // images/PDF up to 5 MB -> {id, url, name, type, size}
  db.me()                                         // -> {id, isOwner, canAdd, canEditOthers, signedIn}
  db.onStatus(function(s){ ... })                 // 'connecting' | 'synced' | 'syncing' | 'offline' | 'local'
A record is {id, data, key, mine, version, createdAt, updatedAt, pending}; your
fields are in record.data. Write data as plain JSON objects (under 16 KB each).
Collection and field names: letters, digits, _ and -, starting with a letter.

Rules for using it:
- Render from subscribe(): it fires at once with the current list and again on
  every change, local or remote. Do not keep a second copy of the data.
- Writes show immediately. Wrap them in try/catch (or .catch) and show a short,
  friendly message if one is refused (for example the owner made it read-only:
  check (await db.me()).canAdd and hide add forms when it is false).
- Show a small sync badge: "Synced" when synced, "Saving…" when syncing,
  "Offline — changes will sync" when offline, "Not shared (preview)" when local.
- Escape everything people typed before putting it in the page (textContent,
  never innerHTML with user text). Show an empty state and counts.
- Still no fetch/XHR/WebSocket of your own: window.fintrack.db is the only way
  data leaves the page.

Example, shared:
  var tasks = window.fintrack.db.collection('tasks');
  tasks.subscribe(function(list){ ul.replaceChildren.apply(ul, list.map(row)); count.textContent = list.length; });
  form.onsubmit = function(e){ e.preventDefault(); tasks.add({title: input.value.trim(), done: false}).catch(showError); input.value = ''; };
  function row(r){ var li = document.createElement('li'); li.textContent = r.data.title;
    li.onclick = function(){ tasks.update(r.id, {done: !r.data.done}); }; return li; }

Example, private (each visitor's own list, kept in the cloud):
  var notes = window.fintrack.db.collection('notes', {scope: 'private'});
  notes.subscribe(render, {orderBy: 'createdAt', desc: true});
  save.onclick = function(){ notes.add({text: box.value}); };"""

_OUTPUT_MARK = "\n\nOUTPUT FORMAT:"
ARTIFACT_RULES = (
    ARTIFACT_RULES.replace(_OUTPUT_MARK, "\n\n" + SHARED_DATA_RULES + _OUTPUT_MARK, 1)
    if _OUTPUT_MARK in ARTIFACT_RULES else ARTIFACT_RULES + "\n\n" + SHARED_DATA_RULES
)

# Appended to the search/replace brief when an artifact is being refined, so a
# revision keeps to the same constraints as the first build.
REVISION_NOTE = (
    "This document is an interactive artifact: a single self-contained HTML file "
    "in a sandboxed frame. Keep it that way: no network calls (fetch, XHR, "
    "WebSocket), external code only from "
    + ", ".join(CDN_ALLOWLIST)
    + ", labelled accessible inputs, responsive at 360px, and colours that work "
    "in both light and dark. Keep its design system: style anything new with the "
    "existing tokens and kit classes (.btn, .input, .card, .row, .badge …) so it "
    "matches what is there. Data that should persist or be shared goes through "
    "window.fintrack.db (collection(name, {scope}) with add/update/remove/list/"
    "subscribe/increment/upsert, doc(name), files.upload): keep using it where the "
    "artifact already does, render from subscribe(), and keep the sync status "
    "badge; localStorage only for personal UI preferences, behind try/catch."
)


# --- link preview text --------------------------------------------------------

_META_DESC = re.compile(
    r"<meta\b[^>]*\bname\s*=\s*[\"']description[\"'][^>]*>", re.IGNORECASE
)
_CONTENT_ATTR = re.compile(r"\bcontent\s*=\s*(\"([^\"]*)\"|'([^']*)')", re.IGNORECASE)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")

MAX_DESCRIPTION_CHARS = 200


def _clean(text: str) -> str:
    text = _html.unescape(_TAGS.sub(" ", text or ""))
    text = _SPACE.sub(" ", text).strip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        text = text[: MAX_DESCRIPTION_CHARS - 1].rstrip() + "…"
    return text


def describe(content: str | None) -> str:
    """
    A one-line description of an artifact for its link preview: the document's
    own meta description, else its <title>, else nothing.
    """
    doc = content or ""
    for tag in _META_DESC.findall(doc):
        m = _CONTENT_ATTR.search(tag)
        if m:
            text = _clean(m.group(2) if m.group(2) is not None else m.group(3))
            if text:
                return text
    m = _TITLE.search(doc)
    return _clean(m.group(1)) if m else ""


# --- compact brief ---------------------------------------------------------------
#
# Some providers cap a request at a few thousand tokens in total — prompt plus
# the answer it may write. The full brief alone nearly fills such a cap, so the
# provider refuses it (HTTP 413) before writing a word. This version keeps the
# rules that decide whether the app works and looks designed, in about a
# quarter of the size, so the answer keeps room to be a complete app.
COMPACT_RULES = """You build one self-contained interactive web app ("artifact") as a single
HTML file: <!DOCTYPE html>, the <style> in <head>, one <script> before </body>.
It must look like a polished product, not a demo, and the file MUST be complete.

ENVIRONMENT: sandboxed iframe, opaque origin. No fetch/XHR/WebSocket, no forms
posting anywhere, no alert/confirm/prompt (use inline messages and toasts).
External code only from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or
Google Fonts, pinned. Inline SVG for icons and charts, never emoji.

DESIGN (default; if the request asks for a look such as glass or gradients,
build that look instead, properly):
- Inter from Google Fonts (400–700) with a system fallback; 15px body.
- Tokens on :root and redefined in @media (prefers-color-scheme:dark):
  --bg --surface --surface-2 --border --text --text-2 --text-3 --accent
  --accent-soft --on-accent --success --warning --danger, radius 7/10/14px,
  spacing 4/8/12/16/20/24/32px, soft shadows, a 3px accent focus ring.
  Use the tokens everywhere, never raw hex in components.
- Layout: centred .app (max 760px; 1040px for tables/dashboards), a header with
  h1 + subtitle + actions, content in cards (16–20px padding, 14px radius).
- Rows are flex with align-items:center; inputs and buttons beside them share
  one 40px height; icon buttons are squares with aria-label. One primary
  button per view. Custom-styled checkboxes, selects and buttons — no browser
  defaults. Badges/chips for status, tabular numbers, ₹ via
  Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}), dates DD MMM YYYY.
- Every state designed: empty state (icon, line, action), skeleton while
  loading, a small "Saving… / Synced / Offline" badge when data is kept,
  inline errors with retry, undo toast for deletes, hover/focus/disabled.
- 150–200ms transitions, off under prefers-reduced-motion. Usable at 360px
  with nothing scrolling sideways. Labels on every input, aria-live on results.

FEATURES: build what the best app of its kind has (for a task list: add with
Enter, inline edit, complete, delete with undo, filters with counts, due dates,
assignees when asked), with keyboard shortcuts. Escape user text (textContent).

DATA: window.fintrack.db is always present and syncs live for everyone.
  var c = window.fintrack.db.collection('tasks');            // shared
  var p = window.fintrack.db.collection('notes',{scope:'private'}); // per visitor
  c.add(obj) · c.update(id, patch) · c.remove(id) · c.get(id) · c.count(where)
  c.list({where, orderBy, desc, limit}) · c.increment(id, field, by) · c.upsert(key, obj)
  c.subscribe(function(records){ render(records) })  // fires now and on every change
  window.fintrack.db.doc('settings').get()/.set(obj) · window.fintrack.db.me() -> {canAdd, isOwner}
  window.fintrack.db.onStatus(function(s){ /* synced | syncing | offline | local */ })
Records are {id, data, mine, version, createdAt, updatedAt}; fields live in record.data.
Render from subscribe(); writes are promises — catch and show a friendly message.
Use it for anything that should last or be shared; pure calculators keep no data.

Keep the CSS lean (no unused components) so the whole file fits: aim for
under 14 KB. Before answering, check: it works on first load, nothing is
misaligned, no default browser styling, dark mode correct.

OUTPUT FORMAT: only the HTML document, <!DOCTYPE html> through </html>. No
commentary, no code fences."""
