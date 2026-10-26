import { buildDocument } from './base'

const SAMPLE = [
  'invoice,client,amount,due_date,status',
  'INV-1041,Acme Retail,118000,2026-07-15,unpaid',
  'INV-1042,Bluefin Foods,54280,2026-08-30,unpaid',
  'INV-1043,Acme Retail,236000,2026-09-20,unpaid',
  'INV-1044,Kite Logistics,88500,2026-10-05,unpaid',
  'INV-1045,"Nair & Sons",42480,2026-10-28,unpaid',
  'INV-1046,Bluefin Foods,150000,2026-06-10,unpaid',
  'INV-1047,Kite Logistics,64900,2026-09-01,paid',
].join('\n')

export default {
  id: 'invoice-ageing',
  name: 'Invoice ageing dashboard',
  description: 'Paste a CSV of invoices; get 0–30–60–90+ buckets by client.',
  icon: '📊',
  html: buildDocument({
    title: 'Invoice Ageing Dashboard',
    description: 'Paste a CSV of open invoices and see receivables bucketed into current, 1–30, 31–60, 61–90 and 90+ days, by client, in rupees.',
    css: `
.bars{display:grid;gap:8px;margin-top:6px}
.bar{display:grid;grid-template-columns:minmax(0,7rem) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:.88rem}
.track{height:14px;background:var(--soft);border-radius:99px;overflow:hidden}
.fill{height:100%;background:var(--accent);border-radius:99px;min-width:2px}
.fill.b3{background:var(--warn)} .fill.b4{background:var(--bad)}
.bar strong{font-variant-numeric:tabular-nums}
`,
    body: `
<main class="wrap">
  <header class="top">
    <div><h1>Invoice Ageing</h1><p class="lede">Paste invoices as CSV — columns <code>invoice, client, amount, due_date</code> and optionally <code>status</code>.</p></div>
  </header>
  <section class="card" aria-labelledby="in-h">
    <h2 id="in-h">Data</h2>
    <div class="field">
      <label for="csv">CSV (dates as YYYY-MM-DD or DD/MM/YYYY; rows marked paid are skipped)</label>
      <textarea id="csv" rows="8" spellcheck="false"></textarea>
    </div>
    <div class="row" style="align-items:end">
      <div class="field"><label for="asof">Age as of</label><input id="asof" type="date"></div>
      <div class="field" style="flex-direction:row;gap:8px;flex-wrap:wrap">
        <button type="button" class="primary" id="run">Update</button>
        <button type="button" id="sample">Load sample</button>
        <button type="button" id="clear">Clear</button>
      </div>
    </div>
    <p class="hint" id="hint" role="status"></p>
  </section>
  <div aria-live="polite">
    <div class="kpis" style="margin:14px 0">
      <div class="kpi"><div class="k">Outstanding</div><div class="v" id="total">—</div></div>
      <div class="kpi"><div class="k">Overdue</div><div class="v" id="overdue">—</div></div>
      <div class="kpi"><div class="k">Over 90 days</div><div class="v" id="old">—</div></div>
      <div class="kpi"><div class="k">Open invoices</div><div class="v" id="count">—</div></div>
    </div>
    <div class="grid">
      <section class="card" aria-labelledby="b-h"><h2 id="b-h">By age</h2><div class="bars" id="bars"></div></section>
      <section class="card" aria-labelledby="c-h"><h2 id="c-h">By client</h2>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Client</th><th scope="col" class="num">Current</th><th scope="col" class="num">1–30</th><th scope="col" class="num">31–60</th><th scope="col" class="num">61–90</th><th scope="col" class="num">90+</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody id="clients"></tbody>
        </table></div>
      </section>
    </div>
  </div>
  <footer class="note">Nothing leaves this page: the CSV is read here and kept only on this device.</footer>
</main>`,
    script: `
var SAMPLE = ${JSON.stringify(SAMPLE)};
var KEY = 'invoice-ageing';
var BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days'];
function parseCSV(text){
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\\n' || c === '\\r') { if (c === '\\r' && text[i + 1] === '\\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(x){ return x.trim() !== ''; }); });
}
function parseDate(s){
  s = (s || '').trim(); var m;
  if ((m = s.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})$/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
function bucket(days){ return days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4; }
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function run(){
  var text = $('csv').value;
  store.set(KEY, { csv: text, asof: $('asof').value });
  var rows = parseCSV(text);
  if (!rows.length) { $('hint').textContent = 'Paste some rows, or load the sample.'; render([], 0); return; }
  var head = rows[0].map(function(h){ return h.trim().toLowerCase().replace(/[^a-z]/g, ''); });
  var col = function(names){ for (var i = 0; i < names.length; i++) { var k = head.indexOf(names[i]); if (k !== -1) return k; } return -1; };
  var ci = col(['client','customer','party','name']), ai = col(['amount','balance','outstanding','total']), di = col(['duedate','due','date']), si = col(['status']), ii = col(['invoice','invoiceno','number','id']);
  if (ci === -1 || ai === -1 || di === -1) { $('hint').textContent = 'The first row needs client, amount and due_date columns.'; render([], 0); return; }
  var asof = parseDate($('asof').value) || new Date();
  var skipped = 0, items = [];
  rows.slice(1).forEach(function(r){
    if (si !== -1 && /paid|closed|settled/i.test(r[si] || '') && !/unpaid/i.test(r[si] || '')) return;
    var amt = num(r[ai]), due = parseDate(r[di]);
    if (!isFinite(amt) || !due) { skipped++; return; }
    var days = Math.floor((asof - due) / 86400000);
    items.push({ inv: ii !== -1 ? r[ii] : '', client: (r[ci] || 'Unknown').trim(), amount: amt, b: bucket(days) });
  });
  $('hint').textContent = skipped ? skipped + ' row(s) skipped: amount or due date unreadable.' : '';
  render(items);
}
function render(items){
  var by = [0, 0, 0, 0, 0], clients = {};
  items.forEach(function(it){
    by[it.b] += it.amount;
    var c = clients[it.client] || (clients[it.client] = [0, 0, 0, 0, 0]); c[it.b] += it.amount;
  });
  var total = by.reduce(function(a, b){ return a + b; }, 0);
  $('total').textContent = items.length ? inr0(total) : '—';
  $('overdue').textContent = items.length ? inr0(total - by[0]) : '—';
  $('old').textContent = items.length ? inr0(by[4]) : '—';
  $('count').textContent = items.length ? String(items.length) : '—';
  var max = Math.max.apply(null, by.concat([1]));
  $('bars').innerHTML = BUCKETS.map(function(name, i){
    return '<div class="bar"><span>' + name + '</span><div class="track" role="presentation"><div class="fill b' + i + '" style="width:' + (by[i] / max * 100).toFixed(1) + '%"></div></div><strong>' + inr0(by[i]) + '</strong></div>';
  }).join('');
  var names = Object.keys(clients).sort(function(a, b){
    var sa = clients[a].reduce(function(x, y){ return x + y; }, 0), sb = clients[b].reduce(function(x, y){ return x + y; }, 0); return sb - sa;
  });
  $('clients').innerHTML = names.length ? names.map(function(n){
    var c = clients[n], t = c.reduce(function(x, y){ return x + y; }, 0);
    return '<tr><td>' + esc(n) + '</td>' + c.map(function(v, i){ return '<td class="num' + (i >= 3 && v ? ' bad' : '') + '">' + (v ? inr0(v) : '—') + '</td>'; }).join('') + '<td class="num"><strong>' + inr0(t) + '</strong></td></tr>';
  }).join('') : '<tr><td colspan="7" class="mute">No open invoices.</td></tr>';
}
var saved = store.get(KEY, null);
$('csv').value = saved && saved.csv != null ? saved.csv : SAMPLE;
var today = new Date();
$('asof').value = saved && saved.asof ? saved.asof : today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
$('run').addEventListener('click', run);
$('sample').addEventListener('click', function(){ $('csv').value = SAMPLE; run(); });
$('clear').addEventListener('click', function(){ $('csv').value = 'invoice,client,amount,due_date,status\\n'; run(); $('csv').focus(); });
$('asof').addEventListener('change', run);
var t; $('csv').addEventListener('input', function(){ clearTimeout(t); t = setTimeout(run, 400); });
run();
`,
  }),
}
