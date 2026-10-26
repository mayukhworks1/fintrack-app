import { buildDocument } from './base'

export default {
  id: 'pomodoro-timer',
  name: 'Pomodoro timer',
  description: 'Focus and break timer with a session count for the day.',
  icon: '⏱️',
  html: buildDocument({
    title: 'Pomodoro Timer',
    description: 'A focus timer: 25-minute work blocks with short and long breaks, and a count of today’s sessions.',
    css: `
.timer{display:grid;place-items:center;gap:14px;text-align:center}
.ring{position:relative;width:min(70vw,260px);aspect-ratio:1}
.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring .time{position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(2.2rem,11vw,3.6rem);font-weight:800;font-variant-numeric:tabular-nums}
.controls{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.phase{font-weight:700;letter-spacing:.02em}
.settings{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr))}
`,
    body: `
<main class="wrap" style="max-width:620px">
  <header class="top"><div><h1>Pomodoro Timer</h1><p class="lede">Work in focused blocks; rest before you need to.</p></div></header>
  <section class="card timer" aria-labelledby="phase">
    <div class="seg" role="group" aria-label="Mode">
      <label><input type="radio" name="phase" value="focus" checked> Focus</label>
      <label><input type="radio" name="phase" value="short"> Short break</label>
      <label><input type="radio" name="phase" value="long"> Long break</label>
    </div>
    <div class="phase" id="phase">Focus</div>
    <div class="ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill="none" stroke="var(--soft)" stroke-width="10"></circle>
        <circle id="arc" cx="60" cy="60" r="54" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" stroke-dasharray="339.292" stroke-dashoffset="0"></circle>
      </svg>
      <div class="time" id="time" role="timer" aria-live="off">25:00</div>
    </div>
    <div class="controls">
      <button type="button" class="primary" id="start">Start</button>
      <button type="button" id="reset">Reset</button>
      <button type="button" id="skip">Skip</button>
    </div>
    <p class="small mute" id="count" aria-live="polite"></p>
    <p class="sr-only" id="announce" aria-live="assertive"></p>
  </section>
  <section class="card" style="margin-top:14px" aria-labelledby="s-h">
    <h2 id="s-h">Settings (minutes)</h2>
    <div class="settings">
      <div class="field"><label for="focusMin">Focus</label><input id="focusMin" type="number" min="1" max="120" value="25"></div>
      <div class="field"><label for="shortMin">Short break</label><input id="shortMin" type="number" min="1" max="60" value="5"></div>
      <div class="field"><label for="longMin">Long break</label><input id="longMin" type="number" min="1" max="60" value="15"></div>
      <div class="field"><label for="every">Long break every</label><input id="every" type="number" min="2" max="8" value="4"></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:500"><input type="checkbox" id="sound" checked style="width:auto"> Chime when a block ends</label>
  </section>
</main>`,
    script: `
var KEY = 'pomodoro-timer';
var C = 2 * Math.PI * 54;
var cfg = store.get(KEY, null) || {};
['focusMin','shortMin','longMin','every'].forEach(function(k){ if (cfg[k]) $(k).value = cfg[k]; });
if (cfg.sound === false) $('sound').checked = false;
var today = new Date().toDateString();
var done = cfg.day === today ? (cfg.done || 0) : 0;
var phase = 'focus', total = 0, left = 0, timer = null, endAt = 0;
var NAMES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
function minutes(p){ var v = num($(p === 'focus' ? 'focusMin' : p === 'short' ? 'shortMin' : 'longMin').value); return v > 0 && v <= 120 ? v : (p === 'focus' ? 25 : p === 'short' ? 5 : 15); }
function save(){ store.set(KEY, { focusMin: $('focusMin').value, shortMin: $('shortMin').value, longMin: $('longMin').value, every: $('every').value, sound: $('sound').checked, day: today, done: done }); }
function mmss(s){ s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function draw(){
  $('time').textContent = mmss(left);
  $('arc').setAttribute('stroke-dashoffset', String(C * (1 - left / total)));
  $('phase').textContent = NAMES[phase];
  $('count').textContent = done + ' focus session' + (done === 1 ? '' : 's') + ' today';
  document.title = (timer ? mmss(left) + ' · ' : '') + 'Pomodoro Timer';
}
function setPhase(p){
  stop(); phase = p; total = left = minutes(p) * 60;
  document.querySelector('input[name=phase][value=' + p + ']').checked = true; draw();
}
function chime(){
  if (!$('sound').checked) return;
  try {
    var A = window.AudioContext || window.webkitAudioContext; var ctx = new A();
    [0, 0.25, 0.5].forEach(function(t, i){
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i]; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
    });
  } catch (e) {}
}
function finish(skipped){
  stop(); if (!skipped) chime();
  var next;
  if (phase === 'focus') { if (!skipped) { done++; save(); } var every = Math.max(2, num($('every').value) || 4); next = !skipped && done % every === 0 ? 'long' : 'short'; }
  else next = 'focus';
  $('announce').textContent = NAMES[phase] + ' finished. ' + NAMES[next] + ' next.';
  setPhase(next);
}
function tick(){ left = (endAt - Date.now()) / 1000; if (left <= 0) { left = 0; draw(); finish(); return; } draw(); }
function start(){ if (timer) return; endAt = Date.now() + left * 1000; timer = setInterval(tick, 250); $('start').textContent = 'Pause'; draw(); }
function stop(){ if (timer) { clearInterval(timer); timer = null; } $('start').textContent = left < total && left > 0 ? 'Resume' : 'Start'; }
$('start').addEventListener('click', function(){ if (timer) { stop(); draw(); } else start(); });
$('reset').addEventListener('click', function(){ setPhase(phase); });
$('skip').addEventListener('click', function(){ finish(true); });
document.querySelectorAll('input[name=phase]').forEach(function(r){ r.addEventListener('change', function(){ setPhase(r.value); }); });
['focusMin','shortMin','longMin','every'].forEach(function(id){ $(id).addEventListener('change', function(){ save(); if (!timer) setPhase(phase); }); });
$('sound').addEventListener('change', save);
setPhase('focus');
`,
  }),
}
