import { buildDocument } from './base'

export default {
  id: 'gst-calculator',
  name: 'GST calculator',
  description: 'Add or extract GST at any slab, with the CGST/SGST or IGST split.',
  icon: '🧾',
  html: buildDocument({
    title: 'GST Calculator',
    description: 'Add GST to a price or extract it from an inclusive amount, with the CGST + SGST or IGST split, in rupees.',
    css: `
.split{display:grid;gap:8px;margin-top:12px}
.split div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--line);padding-bottom:6px;font-variant-numeric:tabular-nums}
`,
    body: `
<main class="wrap">
  <header class="top">
    <div><h1>GST Calculator</h1><p class="lede">Add GST to a price, or pull it out of a GST-inclusive amount.</p></div>
  </header>
  <div class="grid">
    <section class="card" aria-labelledby="in-h">
      <h2 id="in-h">Inputs</h2>
      <div class="field">
        <label for="amount">Amount (₹)</label>
        <input id="amount" inputmode="decimal" value="10000" autocomplete="off">
      </div>
      <div class="row">
        <div class="field">
          <label for="rate">GST rate</label>
          <select id="rate">
            <option value="0">0%</option><option value="0.25">0.25%</option><option value="3">3%</option>
            <option value="5">5%</option><option value="12">12%</option><option value="18" selected>18%</option>
            <option value="28">28%</option><option value="40">40%</option><option value="custom">Custom…</option>
          </select>
        </div>
        <div class="field" id="customWrap" hidden>
          <label for="custom">Custom rate (%)</label>
          <input id="custom" inputmode="decimal" value="18">
        </div>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 12px">
        <legend class="label">The amount is</legend>
        <div class="seg">
          <label><input type="radio" name="mode" value="exclusive" checked> Before GST</label>
          <label><input type="radio" name="mode" value="inclusive"> GST-inclusive</label>
        </div>
      </fieldset>
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="label">Supply</legend>
        <div class="seg">
          <label><input type="radio" name="supply" value="intra" checked> Within state (CGST + SGST)</label>
          <label><input type="radio" name="supply" value="inter"> Inter-state (IGST)</label>
        </div>
      </fieldset>
      <p class="hint" id="hint" role="status"></p>
    </section>
    <section class="card" aria-labelledby="out-h">
      <h2 id="out-h">Result</h2>
      <div aria-live="polite">
        <div class="mute small">Total payable</div>
        <div class="big" id="total">—</div>
        <div class="split" id="split"></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="copy">Copy breakdown</button>
        <span class="small mute" id="copied" aria-live="polite"></span>
      </div>
    </section>
  </div>
  <footer class="note">Rates are a pick-list, not advice — check the slab for your HSN/SAC code.</footer>
</main>`,
    script: `
var KEY = 'gst-calculator';
var saved = store.get(KEY, null);
if (saved) {
  $('amount').value = saved.amount; $('rate').value = saved.rate; $('custom').value = saved.custom;
  document.querySelector('input[name=mode][value=' + saved.mode + ']').checked = true;
  document.querySelector('input[name=supply][value=' + saved.supply + ']').checked = true;
}
function val(name){ return document.querySelector('input[name=' + name + ']:checked').value; }
var lines = [];
function calc(){
  $('customWrap').hidden = $('rate').value !== 'custom';
  var amount = num($('amount').value);
  var rate = $('rate').value === 'custom' ? num($('custom').value) : num($('rate').value);
  var mode = val('mode'), supply = val('supply');
  store.set(KEY, { amount: $('amount').value, rate: $('rate').value, custom: $('custom').value, mode: mode, supply: supply });
  if (!isFinite(amount) || amount < 0) { $('hint').textContent = 'Enter an amount of zero or more.'; $('total').textContent = '—'; $('split').innerHTML = ''; return; }
  if (!isFinite(rate) || rate < 0 || rate > 100) { $('hint').textContent = 'Enter a rate between 0 and 100.'; $('total').textContent = '—'; $('split').innerHTML = ''; return; }
  $('hint').textContent = '';
  var base, tax;
  if (mode === 'exclusive') { base = amount; tax = amount * rate / 100; }
  else { base = amount * 100 / (100 + rate); tax = amount - base; }
  base = Math.round(base * 100) / 100; tax = Math.round(tax * 100) / 100;
  var total = base + tax;
  lines = [['Taxable value', base]];
  if (supply === 'intra') {
    var half = Math.round(tax / 2 * 100) / 100;
    lines.push(['CGST @ ' + rate / 2 + '%', half]);
    lines.push(['SGST @ ' + rate / 2 + '%', Math.round((tax - half) * 100) / 100]);
  } else {
    lines.push(['IGST @ ' + rate + '%', tax]);
  }
  lines.push(['Total GST', tax]);
  $('total').textContent = inr(total);
  $('split').innerHTML = lines.map(function(l){ return '<div><span>' + l[0] + '</span><strong>' + inr(l[1]) + '</strong></div>'; }).join('');
  lines.push(['Total payable', total]);
}
['amount','rate','custom'].forEach(function(id){ $(id).addEventListener('input', calc); });
document.querySelectorAll('input[type=radio]').forEach(function(r){ r.addEventListener('change', calc); });
$('copy').addEventListener('click', function(){
  var text = lines.map(function(l){ return l[0] + ': ' + inr(l[1]); }).join('\\n');
  copyText(text, function(ok){
    $('copied').textContent = ok ? 'Copied.' : 'Select and copy the lines above.';
    setTimeout(function(){ $('copied').textContent = ''; }, 2500);
  });
});
calc();
`,
  }),
}
