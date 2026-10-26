import { buildDocument } from './base'

export default {
  id: 'project-margin',
  name: 'Project margin calculator',
  description: 'Team hours × cost rates against the fee, with a price for a target margin.',
  icon: '📐',
  html: buildDocument({
    title: 'Project Margin Calculator',
    description: 'Cost a project from team hours and rates plus overheads, see the gross margin on the fee, and the fee needed to hit a target margin.',
    css: `
.team{display:grid;gap:8px}
.member{display:grid;gap:8px;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) auto;align-items:end}
.member .cost{font-variant-numeric:tabular-nums;padding:9px 0;text-align:right}
@media (max-width:560px){ .member{grid-template-columns:minmax(0,1fr) minmax(0,1fr)} .member .cost{text-align:left} }
.meter{height:12px;background:var(--soft);border-radius:99px;overflow:hidden;margin-top:8px}
.meter div{height:100%;background:var(--ok)}
button.icon{padding:8px 11px}
`,
    body: `
<main class="wrap">
  <header class="top">
    <div><h1>Project Margin</h1><p class="lede">Will this project make money? Put in the fee, the team and the extras.</p></div>
  </header>
  <section class="card" aria-labelledby="t-h">
    <h2 id="t-h">Team</h2>
    <div class="team" id="team"></div>
    <button type="button" id="add" style="margin-top:10px">+ Add person</button>
  </section>
  <div class="grid" style="margin-top:14px">
    <section class="card" aria-labelledby="f-h">
      <h2 id="f-h">Fee and costs</h2>
      <div class="field"><label for="fee">Project fee, excluding GST (₹)</label><input id="fee" inputmode="decimal" value="850000"></div>
      <div class="row">
        <div class="field"><label for="other">Other direct costs (₹)</label><input id="other" inputmode="decimal" value="45000"></div>
        <div class="field"><label for="overhead">Overhead on labour (%)</label><input id="overhead" inputmode="decimal" value="15"></div>
      </div>
      <div class="field"><label for="target">Target margin (%)</label><input id="target" inputmode="decimal" value="35"></div>
      <p class="hint" id="hint" role="status"></p>
    </section>
    <section class="card" aria-labelledby="r-h">
      <h2 id="r-h">Margin</h2>
      <div aria-live="polite">
        <div class="big" id="margin">—</div>
        <div class="meter" aria-hidden="true"><div id="meter" style="width:0"></div></div>
        <p class="small" id="verdict"></p>
        <div class="kpis">
          <div class="kpi"><div class="k">Labour</div><div class="v" id="labour">—</div></div>
          <div class="kpi"><div class="k">Total cost</div><div class="v" id="cost">—</div></div>
          <div class="kpi"><div class="k">Gross profit</div><div class="v" id="profit">—</div></div>
          <div class="kpi"><div class="k">Fee for target</div><div class="v" id="needed">—</div></div>
        </div>
      </div>
    </section>
  </div>
</main>`,
    script: `
var KEY = 'project-margin';
var DEFAULT = { team: [
  { role: 'Project lead', hours: 80, rate: 2200 },
  { role: 'Designer', hours: 120, rate: 1400 },
  { role: 'Developer', hours: 220, rate: 1600 }
] };
var state = store.get(KEY, null) || DEFAULT;
var uid = 0;
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function memberRow(m){
  var id = 'm' + (uid++);
  var d = document.createElement('div'); d.className = 'member';
  d.innerHTML =
    '<div class="field" style="margin:0"><label for="' + id + 'r">Role</label><input id="' + id + 'r" data-k="role" value="' + esc(m.role) + '"></div>' +
    '<div class="field" style="margin:0"><label for="' + id + 'h">Hours</label><input id="' + id + 'h" data-k="hours" inputmode="decimal" value="' + esc(m.hours) + '"></div>' +
    '<div class="field" style="margin:0"><label for="' + id + 'c">₹ / hour</label><input id="' + id + 'c" data-k="rate" inputmode="decimal" value="' + esc(m.rate) + '"></div>' +
    '<div class="cost" data-cost>—</div>' +
    '<button type="button" class="icon" aria-label="Remove ' + esc(m.role || 'person') + '">✕</button>';
  d.querySelector('button').addEventListener('click', function(){ d.remove(); calc(); });
  d.addEventListener('input', calc);
  return d;
}
state.team.forEach(function(m){ $('team').appendChild(memberRow(m)); });
if (state.fee != null) { ['fee','other','overhead','target'].forEach(function(k){ $(k).value = state[k]; }); }
$('add').addEventListener('click', function(){ var r = memberRow({ role: '', hours: 0, rate: 0 }); $('team').appendChild(r); r.querySelector('input').focus(); calc(); });
function calc(){
  var team = [], labour = 0, bad = false;
  $('team').querySelectorAll('.member').forEach(function(row){
    var get = function(k){ return row.querySelector('[data-k=' + k + ']').value; };
    var h = num(get('hours')), r = num(get('rate'));
    var c = (isFinite(h) ? h : 0) * (isFinite(r) ? r : 0);
    if ((get('hours') && !isFinite(h)) || (get('rate') && !isFinite(r)) || h < 0 || r < 0) bad = true;
    row.querySelector('[data-cost]').textContent = inr0(c);
    labour += c; team.push({ role: get('role'), hours: get('hours'), rate: get('rate') });
  });
  var fee = num($('fee').value), other = num($('other').value || 0), oh = num($('overhead').value || 0), target = num($('target').value);
  store.set(KEY, { team: team, fee: $('fee').value, other: $('other').value, overhead: $('overhead').value, target: $('target').value });
  if (bad || !isFinite(fee) || fee <= 0 || !isFinite(other) || !isFinite(oh) || !isFinite(target) || target >= 100) {
    $('hint').textContent = 'Use numbers only: a fee above zero and a target margin below 100%.';
    ['margin','labour','cost','profit','needed'].forEach(function(id){ $(id).textContent = '—'; }); $('verdict').textContent = ''; $('meter').style.width = '0'; return;
  }
  $('hint').textContent = '';
  var cost = labour * (1 + oh / 100) + other, profit = fee - cost, pct = profit / fee * 100;
  var needed = cost / (1 - target / 100);
  $('margin').textContent = pct.toFixed(1) + '%';
  $('meter').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  $('meter').style.background = pct >= target ? 'var(--ok)' : pct >= 0 ? 'var(--warn)' : 'var(--bad)';
  $('verdict').textContent = pct >= target ? 'On target — ' + (pct - target).toFixed(1) + ' points of headroom.'
    : pct >= 0 ? 'Below the ' + target + '% target. Raise the fee to ' + inr0(needed) + ', or cut costs by ' + inr0(cost - fee * (1 - target / 100)) + '.'
    : 'This project loses money at the current fee.';
  $('labour').textContent = inr0(labour);
  $('cost').textContent = inr0(cost);
  $('profit').textContent = inr0(profit);
  $('needed').textContent = inr0(needed);
}
['fee','other','overhead','target'].forEach(function(id){ $(id).addEventListener('input', calc); });
calc();
`,
  }),
}
