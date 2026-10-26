import { buildDocument } from './base'

export default {
  id: 'currency-converter',
  name: 'Currency converter',
  description: 'Convert between rupees and other currencies at rates you set.',
  icon: '💱',
  html: buildDocument({
    title: 'Currency Converter',
    description: 'Convert between Indian rupees and other currencies using exchange rates you enter and keep up to date yourself.',
    css: `
.conv{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:end}
@media (max-width:520px){ .conv{grid-template-columns:minmax(0,1fr)} #swap{justify-self:start} }
.rates td input{width:8.5rem;text-align:right}
.rates td:first-child{font-weight:600}
`,
    body: `
<main class="wrap">
  <header class="top"><div><h1>Currency Converter</h1><p class="lede">Rates are entered by you — no live feed, so nothing changes under you mid-quote.</p></div></header>
  <section class="card" aria-labelledby="c-h">
    <h2 id="c-h">Convert</h2>
    <div class="field"><label for="amount">Amount</label><input id="amount" inputmode="decimal" value="1000"></div>
    <div class="conv">
      <div class="field" style="margin:0"><label for="from">From</label><select id="from"></select></div>
      <button type="button" id="swap" aria-label="Swap currencies">⇄</button>
      <div class="field" style="margin:0"><label for="to">To</label><select id="to"></select></div>
    </div>
    <div aria-live="polite" style="margin-top:14px">
      <div class="big" id="result">—</div>
      <div class="small mute" id="rateLine"></div>
    </div>
    <p class="hint" id="hint" role="status"></p>
  </section>
  <section class="card" style="margin-top:14px" aria-labelledby="r-h">
    <h2 id="r-h">Rates (₹ for 1 unit)</h2>
    <div class="table-wrap"><table class="rates">
      <thead><tr><th scope="col">Currency</th><th scope="col">Name</th><th scope="col" class="num">₹ per unit</th></tr></thead>
      <tbody id="rates"></tbody>
    </table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center">
      <button type="button" id="reset">Reset to sample rates</button>
      <span class="small mute" id="updated"></span>
    </div>
  </section>
  <footer class="note">Sample rates are illustrative only. Enter today's rates from your bank or RBI reference rate before quoting.</footer>
</main>`,
    script: `
var KEY = 'currency-converter';
var SAMPLE = { INR: 1, USD: 88.2, EUR: 102.6, GBP: 117.9, AED: 24.0, SGD: 68.4, AUD: 57.6, JPY: 0.59 };
var NAMES = { INR: 'Indian rupee', USD: 'US dollar', EUR: 'Euro', GBP: 'Pound sterling', AED: 'UAE dirham', SGD: 'Singapore dollar', AUD: 'Australian dollar', JPY: 'Japanese yen' };
var s = store.get(KEY, null) || { rates: JSON.parse(JSON.stringify(SAMPLE)), from: 'USD', to: 'INR', amount: '1000', updated: null };
function fmt(code, n){
  if (!isFinite(n)) return '—';
  try { return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: code, maximumFractionDigits: code === 'JPY' ? 0 : 2 }).format(n); }
  catch (e) { return n.toFixed(2) + ' ' + code; }
}
function save(){ store.set(KEY, s); }
function fillSelects(){
  ['from','to'].forEach(function(id){
    $(id).innerHTML = Object.keys(s.rates).map(function(c){ return '<option value="' + c + '">' + c + ' — ' + NAMES[c] + '</option>'; }).join('');
    $(id).value = s[id];
  });
}
function renderRates(){
  $('rates').innerHTML = Object.keys(s.rates).map(function(c){
    return '<tr><td>' + c + '</td><td>' + NAMES[c] + '</td><td class="num">' + (c === 'INR' ? '1' :
      '<label class="sr-only" for="rate-' + c + '">Rupees per ' + c + '</label><input id="rate-' + c + '" data-code="' + c + '" inputmode="decimal" value="' + s.rates[c] + '">') + '</td></tr>';
  }).join('');
  $('rates').querySelectorAll('input').forEach(function(inp){
    inp.addEventListener('input', function(){
      var v = num(inp.value);
      inp.setAttribute('aria-invalid', String(!(v > 0)));
      if (v > 0) { s.rates[inp.dataset.code] = v; s.updated = new Date().toISOString(); save(); calc(); }
    });
  });
  $('updated').textContent = s.updated ? 'Rates last edited ' + new Date(s.updated).toLocaleString('en-IN') : 'Using sample rates.';
}
function calc(){
  s.amount = $('amount').value; s.from = $('from').value; s.to = $('to').value; save();
  var amt = num(s.amount);
  if (!isFinite(amt) || amt < 0) { $('hint').textContent = 'Enter an amount of zero or more.'; $('result').textContent = '—'; $('rateLine').textContent = ''; return; }
  $('hint').textContent = '';
  var inInr = amt * s.rates[s.from], out = inInr / s.rates[s.to];
  $('result').textContent = fmt(s.to, out);
  $('rateLine').textContent = fmt(s.from, amt) + ' = ' + fmt(s.to, out) + ' · 1 ' + s.from + ' = ' + (s.rates[s.from] / s.rates[s.to]).toFixed(4) + ' ' + s.to;
  $('updated').textContent = s.updated ? 'Rates last edited ' + new Date(s.updated).toLocaleString('en-IN') : 'Using sample rates.';
}
fillSelects(); renderRates(); $('amount').value = s.amount;
['amount','from','to'].forEach(function(id){ $(id).addEventListener('input', calc); });
$('swap').addEventListener('click', function(){ var f = $('from').value; $('from').value = $('to').value; $('to').value = f; calc(); });
$('reset').addEventListener('click', function(){ s.rates = JSON.parse(JSON.stringify(SAMPLE)); s.updated = null; save(); renderRates(); calc(); });
calc();
`,
  }),
}
