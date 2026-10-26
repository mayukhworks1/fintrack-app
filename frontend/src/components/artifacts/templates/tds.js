import { buildDocument } from './base'

export default {
  id: 'tds-calculator',
  name: 'TDS calculator',
  description: 'TDS by section with thresholds, the no-PAN rate and net payable.',
  icon: '🏛️',
  html: buildDocument({
    title: 'TDS Calculator',
    description: 'Work out TDS on a payment by section (194C, 194J, 194H, 194I, 194A, 194Q), with thresholds, the no-PAN rate and the net amount payable.',
    css: `
.lines div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--line);padding:6px 0;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--soft)}
`,
    body: `
<main class="wrap">
  <header class="top">
    <div><h1>TDS Calculator</h1><p class="lede">Tax to deduct at source on a payment, and what the payee actually receives.</p></div>
  </header>
  <div class="grid">
    <section class="card" aria-labelledby="in-h">
      <h2 id="in-h">Payment</h2>
      <div class="field">
        <label for="section">Nature of payment</label>
        <select id="section"></select>
      </div>
      <div class="row">
        <div class="field"><label for="amount">Payment, excluding GST (₹)</label><input id="amount" inputmode="decimal" value="75000"></div>
        <div class="field"><label for="gst">GST shown separately (₹)</label><input id="gst" inputmode="decimal" value="13500"></div>
      </div>
      <div class="row">
        <div class="field"><label for="rate">TDS rate (%)</label><input id="rate" inputmode="decimal"></div>
        <div class="field"><label for="threshold">Threshold (₹)</label><input id="threshold" inputmode="decimal"></div>
      </div>
      <div class="field"><label for="ytd">Already paid to this payee this year (₹)</label><input id="ytd" inputmode="decimal" value="0"></div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:500">
        <input type="checkbox" id="nopan" style="width:auto"> Payee has not furnished a PAN
      </label>
      <p class="hint" id="hint" role="status"></p>
    </section>
    <section class="card" aria-labelledby="out-h">
      <h2 id="out-h">TDS</h2>
      <div aria-live="polite">
        <div class="mute small">Deduct</div>
        <div class="big" id="tds">—</div>
        <p id="status" class="small" style="margin:6px 0 10px"></p>
        <div class="lines" id="lines"></div>
      </div>
    </section>
  </div>
  <footer class="note">Rates and thresholds are editable defaults. Confirm them against the Income-tax Act for the year before you deduct. TDS is computed on the amount excluding GST when GST is shown separately on the invoice.</footer>
</main>`,
    script: `
var SECTIONS = [
  { id: '194C-ind', label: '194C — Contractor (individual / HUF)', rate: 1, threshold: 30000, note: 'Single payment threshold; ₹1,00,000 aggregate in a year.', aggregate: 100000 },
  { id: '194C-oth', label: '194C — Contractor (others)', rate: 2, threshold: 30000, aggregate: 100000 },
  { id: '194J-prof', label: '194J — Professional fees', rate: 10, threshold: 50000 },
  { id: '194J-tech', label: '194J — Technical services / royalty (film)', rate: 2, threshold: 50000 },
  { id: '194H', label: '194H — Commission or brokerage', rate: 2, threshold: 20000 },
  { id: '194I-land', label: '194-I — Rent: land, building, furniture', rate: 10, threshold: 50000, note: 'Threshold is ₹50,000 a month: enter one month of rent.' },
  { id: '194I-plant', label: '194-I — Rent: plant and machinery', rate: 2, threshold: 50000, note: 'Threshold is ₹50,000 a month: enter one month of rent.' },
  { id: '194A', label: '194A — Interest (other than securities)', rate: 10, threshold: 10000 },
  { id: '194Q', label: '194Q — Purchase of goods (over ₹50 lakh)', rate: 0.1, threshold: 5000000, noPanRate: 5 }
];
var KEY = 'tds-calculator';
var sel = $('section');
SECTIONS.forEach(function(s){ var o = document.createElement('option'); o.value = s.id; o.textContent = s.label; sel.appendChild(o); });
function current(){ for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === sel.value) return SECTIONS[i]; return SECTIONS[0]; }
function applyDefaults(){ var s = current(); $('rate').value = s.rate; $('threshold').value = s.threshold; }
var saved = store.get(KEY, null);
if (saved) {
  sel.value = saved.section; ['amount','gst','rate','threshold','ytd'].forEach(function(k){ if (saved[k] != null) $(k).value = saved[k]; });
  $('nopan').checked = !!saved.nopan;
} else { sel.value = '194J-prof'; applyDefaults(); }
function calc(){
  var s = current();
  var amount = num($('amount').value), gst = num($('gst').value || 0), rate = num($('rate').value), threshold = num($('threshold').value), ytd = num($('ytd').value || 0);
  store.set(KEY, { section: sel.value, amount: $('amount').value, gst: $('gst').value, rate: $('rate').value, threshold: $('threshold').value, ytd: $('ytd').value, nopan: $('nopan').checked });
  var bad = [amount, gst, rate, threshold, ytd].some(function(v){ return !isFinite(v) || v < 0; });
  if (bad) { $('hint').textContent = 'Every figure must be a number of zero or more.'; $('tds').textContent = '—'; $('lines').innerHTML = ''; $('status').textContent = ''; return; }
  $('hint').textContent = '';
  var effRate = rate;
  if ($('nopan').checked) effRate = s.noPanRate != null ? Math.max(s.noPanRate, rate) : Math.max(20, rate * 2);
  var aggregate = ytd + amount;
  var crosses = amount > threshold || (s.aggregate && aggregate > s.aggregate);
  if (s.id === '194Q') crosses = aggregate > threshold;
  var base = s.id === '194Q' ? Math.max(0, Math.min(amount, aggregate - threshold)) : amount;
  var tds = crosses ? Math.round(base * effRate / 100) : 0;
  $('tds').textContent = inr0(tds);
  $('status').innerHTML = crosses
    ? '<span class="badge">Deduct</span> Threshold crossed' + ($('nopan').checked ? ' — higher rate for no PAN applies.' : '.')
    : '<span class="badge">No TDS</span> Below the threshold' + (s.aggregate ? ' (and the yearly aggregate).' : '.');
  var rows = [
    ['Section', s.label.split(' — ')[0]],
    ['TDS base', inr(base)],
    ['Rate applied', effRate + '%'],
    ['GST on invoice', inr(gst)],
    ['Invoice total', inr(amount + gst)],
    ['Net payable to payee', inr(amount + gst - tds)]
  ];
  if (s.note) rows.push(['Note', s.note]);
  $('lines').innerHTML = rows.map(function(r){ return '<div><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>'; }).join('');
}
sel.addEventListener('change', function(){ applyDefaults(); calc(); });
['amount','gst','rate','threshold','ytd'].forEach(function(id){ $(id).addEventListener('input', calc); });
$('nopan').addEventListener('change', calc);
calc();
`,
  }),
}
