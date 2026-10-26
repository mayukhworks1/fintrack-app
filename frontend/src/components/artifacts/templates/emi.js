import { buildDocument } from './base'

export default {
  id: 'emi-calculator',
  name: 'EMI / loan calculator',
  description: 'Monthly EMI, total interest and a year-by-year repayment schedule.',
  icon: '🏦',
  html: buildDocument({
    title: 'EMI Calculator',
    description: 'Calculate the monthly EMI on a loan, the total interest you pay and a year-by-year repayment schedule, in rupees.',
    css: `
.donut{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px}
.donut svg{width:120px;height:120px;flex:0 0 auto}
.legend{display:grid;gap:6px;font-size:.88rem}
.legend span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:var(--c)}
input[type=range]{padding:0;border:0;accent-color:var(--accent)}
`,
    body: `
<main class="wrap">
  <header class="top">
    <div><h1>EMI Calculator</h1><p class="lede">Home, car or business loan — see the instalment and what the loan really costs.</p></div>
  </header>
  <div class="grid">
    <section class="card" aria-labelledby="in-h">
      <h2 id="in-h">Loan</h2>
      <div class="field"><label for="principal">Loan amount (₹)</label><input id="principal" inputmode="decimal" value="2500000"></div>
      <div class="field">
        <label for="rate">Interest rate (% a year): <output id="rateOut" for="rate"></output></label>
        <input id="rate" type="range" min="1" max="24" step="0.05" value="8.75">
      </div>
      <div class="row">
        <div class="field"><label for="tenure">Tenure</label><input id="tenure" inputmode="numeric" value="20"></div>
        <div class="field"><label for="unit">In</label><select id="unit"><option value="y">Years</option><option value="m">Months</option></select></div>
      </div>
      <p class="hint" id="hint" role="status"></p>
    </section>
    <section class="card" aria-labelledby="out-h">
      <h2 id="out-h">Monthly EMI</h2>
      <div aria-live="polite">
        <div class="big" id="emi">—</div>
        <div class="kpis" style="margin-top:12px">
          <div class="kpi"><div class="k">Total interest</div><div class="v" id="interest">—</div></div>
          <div class="kpi"><div class="k">Total payment</div><div class="v" id="total">—</div></div>
        </div>
        <div class="donut">
          <svg viewBox="0 0 42 42" role="img" aria-labelledby="donutTitle">
            <title id="donutTitle">Principal and interest share</title>
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--soft)" stroke-width="6"></circle>
            <circle id="arc" cx="21" cy="21" r="15.9155" fill="none" stroke="var(--accent)" stroke-width="6" stroke-dasharray="0 100" transform="rotate(-90 21 21)"></circle>
          </svg>
          <div class="legend">
            <span style="--c:var(--accent)" id="lp">Principal</span>
            <span style="--c:var(--soft)" id="li">Interest</span>
          </div>
        </div>
      </div>
    </section>
  </div>
  <section class="card" style="margin-top:14px" aria-labelledby="sch-h">
    <h2 id="sch-h">Repayment schedule</h2>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Year</th><th scope="col" class="num">Principal paid</th><th scope="col" class="num">Interest paid</th><th scope="col" class="num">Balance</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </section>
  <footer class="note">Assumes a fixed rate and monthly reducing balance. Processing fees and prepayments are not included.</footer>
</main>`,
    script: `
var KEY = 'emi-calculator';
var s = store.get(KEY, null);
if (s) { $('principal').value = s.p; $('rate').value = s.r; $('tenure').value = s.t; $('unit').value = s.u; }
function calc(){
  var P = num($('principal').value), annual = num($('rate').value), t = num($('tenure').value), unit = $('unit').value;
  $('rateOut').textContent = annual + '%';
  store.set(KEY, { p: $('principal').value, r: $('rate').value, t: $('tenure').value, u: unit });
  var n = Math.round(unit === 'y' ? t * 12 : t);
  if (!isFinite(P) || P <= 0 || !isFinite(n) || n <= 0 || n > 600) {
    $('hint').textContent = 'Enter a loan amount above zero and a tenure of up to 50 years.';
    ['emi','interest','total'].forEach(function(id){ $(id).textContent = '—'; }); $('rows').innerHTML = ''; return;
  }
  $('hint').textContent = '';
  var r = annual / 12 / 100;
  var emi = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  var total = emi * n, interest = total - P;
  $('emi').textContent = inr0(emi);
  $('interest').textContent = inr0(interest);
  $('total').textContent = inr0(total);
  var share = P / total * 100;
  $('arc').setAttribute('stroke-dasharray', share.toFixed(2) + ' ' + (100 - share).toFixed(2));
  $('lp').textContent = 'Principal ' + share.toFixed(1) + '%';
  $('li').textContent = 'Interest ' + (100 - share).toFixed(1) + '%';
  var bal = P, html = '', yp = 0, yi = 0;
  for (var m = 1; m <= n; m++) {
    var i = bal * r, pr = emi - i; bal = Math.max(0, bal - pr); yp += pr; yi += i;
    if (m % 12 === 0 || m === n) {
      html += '<tr><td>' + Math.ceil(m / 12) + '</td><td class="num">' + inr0(yp) + '</td><td class="num">' + inr0(yi) + '</td><td class="num">' + inr0(bal) + '</td></tr>';
      yp = 0; yi = 0;
    }
  }
  $('rows').innerHTML = html;
}
['principal','rate','tenure','unit'].forEach(function(id){ $(id).addEventListener('input', calc); });
calc();
`,
  }),
}
