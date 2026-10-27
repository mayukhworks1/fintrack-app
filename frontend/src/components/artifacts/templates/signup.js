import { buildDocument } from './base'

/** The sync badge every shared-data template shows. */
const SYNC_CSS = `
.sync{display:inline-flex;align-items:center;gap:6px;font-size:.78rem;font-weight:600;color:var(--mute);
  background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 10px;white-space:nowrap}
.sync::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--mute)}
.sync[data-s="synced"]::before{background:var(--ok)}
.sync[data-s="syncing"]::before,.sync[data-s="connecting"]::before{background:var(--warn)}
.sync[data-s="offline"]::before{background:var(--bad)}
`

const SYNC_JS = `
var SYNC_TEXT = { connecting: 'Connecting…', synced: 'Synced', syncing: 'Saving…', offline: 'Offline — changes will sync', local: 'Not shared (preview)' };
function syncBadge(el){
  window.fintrack.db.onStatus(function(s){ el.dataset.s = s; el.textContent = SYNC_TEXT[s] || s; });
}
`


export default {
  id: 'signup-sheet',
  name: 'Sign-up sheet',
  description: 'Slots people sign up for with their name. Everyone sees who has signed up, live.',
  icon: '📝',
  html: buildDocument({
    title: 'Sign-up Sheet',
    description: 'Pick a slot and add your name. Everyone with the link sees the sheet fill up, live.',
    css: `
${SYNC_CSS}
body{background:linear-gradient(180deg,var(--soft),var(--bg) 280px)}
.wrap{max-width:760px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.eyebrow{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(1.6rem,4.4vw,2.1rem);letter-spacing:-.02em;margin:2px 0 4px}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.pill{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:.85rem;font-weight:600}
.pill b{font-variant-numeric:tabular-nums}
.me{display:flex;gap:8px;align-items:flex-end;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:var(--shadow);margin-bottom:16px;flex-wrap:wrap}
.me .field{flex:1 1 220px;margin:0}
.slots{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))}
.slot{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}
.slot h2{font-size:1rem;margin:0}
.slot .cap{font-size:.78rem;color:var(--mute);font-weight:600}
.meter{height:6px;border-radius:99px;background:var(--line);overflow:hidden}
.meter i{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width .3s}
.slot.full .meter i{background:var(--ok)}
.names{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.names li{display:inline-flex;align-items:center;gap:4px;background:var(--soft);border-radius:999px;padding:3px 4px 3px 10px;font-size:.85rem;max-width:100%}
.names li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.names li.pending{opacity:.6}
.names button{border:0;background:transparent;padding:0 6px;font-size:1rem;line-height:1.4;color:var(--mute);border-radius:99px}
.names button:hover{color:var(--bad)}
.slot .join{margin-top:auto}
.none{font-size:.82rem;color:var(--mute)}
.msg{min-height:1.2em;font-size:.82rem;color:var(--bad);margin:0 2px 10px}
.admin{margin-top:22px}
.admin summary{cursor:pointer;font-weight:600;color:var(--mute);font-size:.85rem}
.admin form{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.admin input{flex:1 1 160px}
`,
    body: `
<main class="wrap">
  <div class="head">
    <div>
      <div class="eyebrow">Sign-up sheet</div>
      <h1 id="title">Volunteer shifts</h1>
      <p class="lede">Add your name to a slot. Everyone with this link sees the sheet fill up, live.</p>
    </div>
    <span class="sync" id="sync" role="status" aria-live="polite">Connecting…</span>
  </div>
  <div class="summary" aria-live="polite">
    <span class="pill"><b id="nPeople">0</b> signed up</span>
    <span class="pill"><b id="nOpen">0</b> places left</span>
  </div>
  <div class="me">
    <div class="field"><label for="name">Your name</label><input id="name" maxlength="60" autocomplete="name" placeholder="e.g. Asha Rao"></div>
  </div>
  <p class="msg" id="msg" role="alert"></p>
  <div class="slots" id="slots" aria-label="Slots"></div>
  <details class="admin" id="admin" hidden>
    <summary>Owner: add a slot</summary>
    <form id="slotForm" autocomplete="off">
      <label class="sr-only" for="slotName">Slot name</label>
      <input id="slotName" maxlength="60" placeholder="Slot, e.g. Sat 10–12" required>
      <label class="sr-only" for="slotCap">Places</label>
      <input id="slotCap" type="number" min="1" max="200" value="4" style="max-width:110px" required>
      <button class="primary" type="submit">Add slot</button>
    </form>
  </details>
</main>`,
    script: `
${SYNC_JS}
var db = window.fintrack.db;
var slotsC = db.collection('slots'), signups = db.collection('signups');
var slots = [], people = [], me = null;
syncBadge($('sync'));
$('name').value = store.get('signup-sheet:name', '');
$('name').oninput = function(){ store.set('signup-sheet:name', $('name').value.trim()); };

function say(t){ $('msg').textContent = t || ''; if (t) setTimeout(function(){ if ($('msg').textContent === t) $('msg').textContent = ''; }, 4000); }
function oops(e){ say(e && e.message ? e.message : 'That did not save. Try again.'); }

// A sheet that has no slots yet gets three to start from, once.
var seeded = false;
function seed(){
  if (seeded || !me || !me.isOwner) return;
  seeded = true;
  [['Saturday, 9–11 am', 4], ['Saturday, 11 am–1 pm', 4], ['Sunday, 10 am–12 pm', 3]].forEach(function(s, i){
    slotsC.upsert('slot-' + (i + 1), { name: s[0], capacity: s[1], order: i + 1 }).catch(oops);
  });
}

function render(){
  var total = 0, taken = 0;
  var box = $('slots');
  box.replaceChildren();
  slots.forEach(function(s){
    var cap = Math.max(1, Number(s.data.capacity) || 1);
    var here = people.filter(function(p){ return p.data.slot === s.id; });
    total += cap; taken += Math.min(cap, here.length);
    var card = document.createElement('section');
    card.className = 'slot' + (here.length >= cap ? ' full' : '');
    var h = document.createElement('h2'); h.textContent = s.data.name || 'Slot';
    var c = document.createElement('div'); c.className = 'cap';
    c.textContent = here.length >= cap ? 'Full · ' + cap + ' of ' + cap : (cap - here.length) + ' of ' + cap + ' places left';
    var m = document.createElement('div'); m.className = 'meter';
    var i = document.createElement('i'); i.style.width = Math.min(100, here.length * 100 / cap) + '%'; m.appendChild(i);
    var ul = document.createElement('ul'); ul.className = 'names';
    here.forEach(function(p){
      var li = document.createElement('li'); if (p.pending) li.className = 'pending';
      var n = document.createElement('span'); n.textContent = p.data.name; li.appendChild(n);
      if (p.mine || (me && me.isOwner)) {
        var x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
        x.setAttribute('aria-label', 'Remove ' + p.data.name + ' from ' + (s.data.name || 'slot'));
        x.onclick = function(){ signups.remove(p.id).catch(oops); };
        li.appendChild(x);
      }
      ul.appendChild(li);
    });
    if (!here.length) { var none = document.createElement('p'); none.className = 'none'; none.textContent = 'No one yet. Be the first.'; card.append(h, c, m, none); }
    else card.append(h, c, m, ul);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'join primary';
    b.textContent = here.length >= cap ? 'Full' : 'Sign up';
    b.disabled = here.length >= cap || (me && me.canAdd === false);
    b.onclick = function(){
      var name = $('name').value.trim();
      if (!name) { say('Add your name first.'); $('name').focus(); return; }
      if (here.some(function(p){ return p.mine && p.data.name === name; })) { say('You are already on this slot.'); return; }
      signups.add({ slot: s.id, name: name }).catch(oops);
    };
    card.appendChild(b);
    box.appendChild(card);
  });
  if (!slots.length) {
    var e = document.createElement('div'); e.className = 'card';
    e.style.textAlign = 'center'; e.style.gridColumn = '1 / -1';
    e.textContent = me && me.isOwner ? 'Setting up your first slots…' : 'No slots yet. Check back soon.';
    box.appendChild(e);
  }
  $('nPeople').textContent = people.length;
  $('nOpen').textContent = Math.max(0, total - taken);
}

var slotsLoaded = false;
slotsC.subscribe(function(list){ slots = list; slotsLoaded = true; render(); if (!list.length) seed(); }, { orderBy: 'order' });
signups.subscribe(function(list){ people = list; render(); }, { orderBy: 'createdAt' });
db.me().then(function(m){ me = m; $('admin').hidden = !(m && m.isOwner); render(); if (slotsLoaded && !slots.length) seed(); });

$('slotForm').onsubmit = function(e){
  e.preventDefault();
  var name = $('slotName').value.trim(), cap = Math.round(num($('slotCap').value));
  if (!name || !(cap > 0)) return;
  slotsC.add({ name: name, capacity: cap, order: slots.length + 1 }).catch(oops);
  $('slotName').value = '';
};
`,
  }),
}
