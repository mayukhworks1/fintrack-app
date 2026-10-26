import { buildDocument } from './base'

export default {
  id: 'feedback-form',
  name: 'Feedback form',
  description: 'A short client feedback form. Responses stay on the device; the owner copies them out.',
  icon: '💬',
  html: buildDocument({
    title: 'Project Feedback',
    description: 'A two-minute feedback form: rate the project, say what worked and what to improve.',
    css: `
.stars{display:flex;gap:6px;flex-wrap:wrap;border:0;padding:0;margin:0}
.stars input{position:absolute;opacity:0;width:1px;height:1px}
.stars label{font-size:1.6rem;line-height:1;padding:6px 8px;border:1px solid var(--line);border-radius:10px;cursor:pointer;color:var(--mute);background:var(--card)}
.stars input:checked + label{background:var(--soft);color:var(--ink);border-color:var(--accent)}
.stars input:focus-visible + label{outline:2px solid var(--accent);outline-offset:2px}
.thanks{text-align:center;padding:28px 12px}
.thanks .tick{font-size:2.6rem}
.owner{margin-top:22px;text-align:center}
.owner button{font-size:.8rem;font-weight:500;padding:5px 10px;color:var(--mute);background:transparent}
.resp{border-top:1px solid var(--line);padding:10px 0;font-size:.9rem}
.resp:first-child{border-top:0}
`,
    body: `
<main class="wrap" style="max-width:640px">
  <header class="top"><div><h1>How did we do?</h1><p class="lede">Two minutes, and it genuinely shapes how we work with you.</p></div></header>
  <section class="card" id="formCard">
    <form id="form" novalidate>
      <div class="field"><label for="name">Your name (optional)</label><input id="name" autocomplete="name"></div>
      <div class="field"><label for="company">Company (optional)</label><input id="company" autocomplete="organization"></div>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 12px">
        <legend class="label">Overall rating <span aria-hidden="true">*</span></legend>
        <div class="stars" id="stars"></div>
      </fieldset>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 12px">
        <legend class="label">Would you recommend us?</legend>
        <div class="seg">
          <label><input type="radio" name="rec" value="Yes" checked> Yes</label>
          <label><input type="radio" name="rec" value="Maybe"> Maybe</label>
          <label><input type="radio" name="rec" value="No"> No</label>
        </div>
      </fieldset>
      <div class="field"><label for="good">What worked well?</label><textarea id="good" rows="3" style="font-family:var(--font)"></textarea></div>
      <div class="field"><label for="better">What should we do better?</label><textarea id="better" rows="3" style="font-family:var(--font)"></textarea></div>
      <p class="hint" id="hint" role="alert"></p>
      <button class="primary" type="submit">Send feedback</button>
    </form>
  </section>
  <section class="card thanks" id="thanks" hidden tabindex="-1" aria-live="polite">
    <div class="tick" aria-hidden="true">✓</div>
    <h2>Thank you!</h2>
    <p class="mute">Your feedback has been recorded.</p>
    <button type="button" id="again">Send another response</button>
  </section>
  <div class="owner"><button type="button" id="ownerBtn" aria-expanded="false" aria-controls="ownerPanel">Owner: view responses</button></div>
  <section class="card" id="ownerPanel" hidden style="margin-top:10px" aria-labelledby="o-h">
    <h2 id="o-h">Responses on this device</h2>
    <div id="lock">
      <div class="field"><label for="pin">Owner PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off"></div>
      <button type="button" id="unlock">Unlock</button>
      <p class="hint" id="pinHint" role="status"></p>
    </div>
    <div id="list" hidden>
      <p class="small mute" id="countLine"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="primary" id="copy">Copy as CSV</button>
        <button type="button" id="download">Download CSV</button>
        <button type="button" id="wipe">Delete all</button>
        <span class="small" id="copyMsg" aria-live="polite"></span>
      </div>
      <div id="responses"></div>
    </div>
  </section>
  <footer class="note">Responses are kept only in this browser on this device — nothing is sent anywhere. Change the owner PIN in the code (OWNER_PIN).</footer>
</main>`,
    script: `
var OWNER_PIN = '2468';
var KEY = 'feedback-form:responses';
var LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
LABELS.forEach(function(l, i){
  var v = i + 1;
  $('stars').insertAdjacentHTML('beforeend', '<input type="radio" name="rating" id="r' + v + '" value="' + v + '"><label for="r' + v + '" title="' + l + '"><span aria-hidden="true">' + '★'.repeat(v) + '</span><span class="sr-only">' + v + ' – ' + l + '</span></label>');
});
function all(){ return store.get(KEY, []); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
$('form').addEventListener('submit', function(e){
  e.preventDefault();
  var r = document.querySelector('input[name=rating]:checked');
  if (!r) { $('hint').textContent = 'Please choose a rating.'; document.getElementById('r1').focus(); return; }
  $('hint').textContent = '';
  var list = all();
  list.push({
    at: new Date().toISOString(), name: $('name').value.trim(), company: $('company').value.trim(),
    rating: +r.value, recommend: document.querySelector('input[name=rec]:checked').value,
    good: $('good').value.trim(), better: $('better').value.trim()
  });
  store.set(KEY, list);
  $('form').reset();
  $('formCard').hidden = true; $('thanks').hidden = false; $('thanks').focus();
  if (!$('list').hidden) renderList();
});
$('again').addEventListener('click', function(){ $('thanks').hidden = true; $('formCard').hidden = false; $('name').focus(); });
$('ownerBtn').addEventListener('click', function(){
  var open = $('ownerPanel').hidden;
  $('ownerPanel').hidden = !open; this.setAttribute('aria-expanded', String(open));
  if (open && !$('lock').hidden) $('pin').focus();
});
function unlock(){
  if ($('pin').value !== OWNER_PIN) { $('pinHint').textContent = 'That PIN is not right.'; return; }
  $('lock').hidden = true; $('list').hidden = false; renderList();
}
$('unlock').addEventListener('click', unlock);
$('pin').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });
function csv(){
  var cols = ['at','name','company','rating','recommend','good','better'];
  var q = function(v){ v = String(v == null ? '' : v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(',')].concat(all().map(function(r){ return cols.map(function(c){ return q(r[c]); }).join(','); })).join('\\n');
}
function renderList(){
  var list = all();
  var avg = list.length ? list.reduce(function(s, r){ return s + r.rating; }, 0) / list.length : 0;
  $('countLine').textContent = list.length ? list.length + ' response(s), average rating ' + avg.toFixed(1) + ' / 5.' : 'No responses yet on this device.';
  $('responses').innerHTML = list.slice().reverse().map(function(r){
    return '<div class="resp"><strong>' + '★'.repeat(r.rating) + '</strong> · ' + esc(r.recommend) + ' · <span class="mute">' + esc(new Date(r.at).toLocaleString('en-IN')) + '</span><br>' +
      esc(r.name || 'Anonymous') + (r.company ? ', ' + esc(r.company) : '') +
      (r.good ? '<br><span class="mute">Worked:</span> ' + esc(r.good) : '') +
      (r.better ? '<br><span class="mute">Improve:</span> ' + esc(r.better) : '') + '</div>';
  }).join('');
}
$('copy').addEventListener('click', function(){
  copyText(csv(), function(ok){ $('copyMsg').textContent = ok ? 'Copied ' + all().length + ' response(s).' : 'Copy was blocked — use Download instead.'; });
});
$('download').addEventListener('click', function(){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' }));
  a.download = 'feedback-responses.csv'; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('wipe').addEventListener('click', function(){
  if ($('wipe').dataset.armed) { store.del(KEY); delete $('wipe').dataset.armed; $('wipe').textContent = 'Delete all'; renderList(); return; }
  $('wipe').dataset.armed = '1'; $('wipe').textContent = 'Click again to delete';
});
`,
  }),
}
