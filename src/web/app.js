import { limitsView, sessionMeta, dotClass, visibleSessions } from './format.js';
import { Player, mountClawd, VIEW } from './clawd/index.js';
import { createMood } from './mood.js';
import { loadSettings, saveSettings, rotationFor, nextRotation } from './settings.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let snap = null;   // latest Snapshot (spec §5)
let skew = 0;      // serverTime - Date.now(), so countdowns use the PC's clock
let lastMsgAt = Date.now();
let downSince = null;

// ---------- companion ----------
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let settings = loadSettings(store);
const mood = createMood(settings.mood);
const player = new Player({ idle: settings.idle });
const view = mountClawd($('mascot'), { view: VIEW }); // Clawd's rects, drawn into the inline <svg>
let drawPending = true;

function apply(cmd) {
  if (!cmd) return;
  player.setBase(cmd.base);
  if (cmd.play.length) player.play(cmd.play);
  setBubble(cmd.bubble && cmd.bubble.text, cmd.bubble && cmd.bubble.tone);
  $('app').classList.toggle('dim', cmd.dim);
}

let lastFrameAt = performance.now();
function loop(now) {
  const dt = Math.min(100, now - lastFrameAt);
  lastFrameAt = now;
  if (player.update(dt) || drawPending) { view.render(player.shapes()); drawPending = false; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => apply(mood.tick(Date.now())), 500);
$('mascot').addEventListener('click', () => apply(mood.onTap(Date.now())));

// ---------- rings ----------
function renderRings() {
  const { rings, note } = limitsView(snap && snap.limits, Date.now(), skew);
  const box = $('rings');
  if (!box.children.length) {
    box.innerHTML = rings.map(r => `<div class="ring" data-k="${r.key}"><svg viewBox="0 0 40 40">
      <circle class="track" cx="20" cy="20" r="16"/>
      <circle class="val" cx="20" cy="20" r="16" pathLength="100" transform="rotate(-90 20 20)" style="stroke:${r.color};stroke-dasharray:0 100"/>
      </svg><div class="num"></div><div class="lbl"></div></div>`).join('');
  }
  for (const r of rings) {
    const el = box.querySelector(`[data-k="${r.key}"]`);
    el.classList.toggle('stale', r.stale);
    el.querySelector('.val').style.strokeDasharray = `${r.pct === null ? 0 : Math.min(r.pct, 100)} 100`;
    const num = el.querySelector('.num');
    num.textContent = r.text;
    num.classList.toggle('hot', r.hot);
    el.querySelector('.lbl').textContent = r.label + (r.reset ? ' · ' + r.reset : '');
  }
  $('limitsNote').textContent = note;
}

// ---------- sessions ----------
function renderSessions() {
  const list = snap ? snap.sessions : [];
  const focusId = snap ? snap.focusId : null;
  const { shown, more } = visibleSessions(list, focusId, 5);
  $('sessions').innerHTML = shown.map(s => `
    <div class="row${s.id === focusId ? ' focus' : ''}">
      <span class="dot ${dotClass(s)}"></span>
      <div><div class="name">${esc(s.name || 'session')}</div><div class="meta${s.needsYou ? ' need' : ''}">${esc(sessionMeta(s))}</div></div>
      <div><div class="ctx"><i style="width:${s.contextPct ?? 0}%"></i></div><div class="ctxl">${s.contextPct == null ? 'ctx —' : `ctx ${s.contextPct}%`}</div></div>
    </div>`).join('')
    + (more ? `<div class="more">+${more} more</div>` : '')
    + (list.length ? '' : '<div class="more">No Claude Code sessions yet</div>');
}

// ---------- bubble ----------
function setBubble(text, tone) {
  const b = $('bubble');
  b.textContent = text || '';
  b.className = 'bubble' + (text ? ' show' : '') + (tone ? ' ' + tone : '');
}

function render() {
  renderRings();
  renderSessions();
}

function onEvent(ev) { apply(mood.onEvent(ev, Date.now())); }

// ---------- connection ----------
function seen() {
  lastMsgAt = Date.now();
  downSince = null;
  $('offline').hidden = true;
}

let es = null;       // the current EventSource
let reconnectAt = 0; // when the page last replaced a silent connection itself

function connect() {
  if (es) es.close();
  const src = new EventSource('/events' + location.search);
  es = src;
  src.addEventListener('snapshot', e => {
    snap = JSON.parse(e.data);
    skew = snap.serverTime - Date.now();
    seen();
    render();
    apply(mood.onSnapshot(snap, Date.now()));
  });
  src.addEventListener('event', e => { seen(); onEvent(JSON.parse(e.data)); });
  src.addEventListener('ping', seen);
  src.onerror = () => {
    if (src !== es) return; // already replaced
    if (downSince === null) downSince = Date.now();
    if (src.readyState === EventSource.CLOSED) setTimeout(() => { if (src === es) connect(); }, 5000); // e.g. a 403 after a restart
  };
}

// A half-open socket (the phone slept, the PC dropped it) never raises an error, so the page
// replaces a connection that has gone silent. connect() closes the old one.
function reconnect(now) {
  reconnectAt = now;
  connect();
}

let offline = false;
setInterval(() => {
  const now = Date.now();
  const down = (downSince !== null && now - downSince > 5000) || now - lastMsgAt > 45000;
  $('offline').hidden = !down;
  if (down !== offline) {
    offline = down;
    apply(mood.setOffline(down, now));
  }
  if (now - lastMsgAt > 45000 && now - reconnectAt >= 15000) reconnect(now);
}, 1000);
document.addEventListener('visibilitychange', () => {
  const now = Date.now();
  if (document.visibilityState === 'visible' && now - lastMsgAt > 25000) reconnect(now);
});
setInterval(renderRings, 30000);

// ---------- controls ----------
function applyLayout() {
  const { w, h, layout } = rotationFor(settings.rotation, window.innerWidth, window.innerHeight);
  const app = $('app');
  app.style.setProperty('--w', `${w}px`);
  app.style.setProperty('--h', `${h}px`);
  app.style.setProperty('--rot', `${settings.rotation}deg`);
  app.classList.toggle('landscape', layout === 'landscape');
  app.classList.toggle('portrait', layout === 'portrait');
  for (const r of [0, 90, 180, 270]) app.classList.toggle(`rot${r}`, r === settings.rotation); // safe-area mapping in style.css
}
window.addEventListener('resize', applyLayout);
applyLayout();

// Full screen and keep-awake need a tap. The controls stop propagation, so they call this themselves.
const noSleep = window.NoSleep ? new window.NoSleep() : null;
const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
function keepAwake() {
  if (settings.keepAwake && noSleep && !noSleep.isEnabled) Promise.resolve(noSleep.enable()).catch(() => {});
}
function activate() {
  const el = document.documentElement;
  if (!standalone && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  keepAwake();
}
document.addEventListener('click', activate);
// The OS pauses the keep-awake video (or drops the wake lock) while the page is hidden; disable it so the next tap re-arms it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && noSleep && noSleep.isEnabled) noSleep.disable();
});

$('btnRotate').addEventListener('click', e => {
  e.stopPropagation();
  activate();
  settings = saveSettings(store, { ...settings, rotation: nextRotation(settings.rotation) });
  applyLayout();
});

$('btnClose').addEventListener('click', e => {
  e.stopPropagation();
  keepAwake(); // night mode keeps the (black) screen on, but never enters full screen
  $('settings').hidden = true;
  $('blank').hidden = false; // a page can't close itself on iOS: blank the screen until tapped
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
$('blank').addEventListener('click', () => { $('blank').hidden = true; });

const form = $('settings');
function fillSettings() {
  const f = form.elements;
  for (const k of ['warn', 'low', 'crit', 'sleepAfterMin']) f[k].value = settings.mood[k];
  for (const k of ['blinksPerMin', 'glancesPerMin', 'movingPct']) f[k].value = settings.idle[k];
  f.keepAwake.checked = settings.keepAwake;
  const sessions = snap ? snap.sessions : [];
  f.pinnedId.innerHTML = '<option value="">Automatic</option>'
    + sessions.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}</option>`).join('');
  f.pinnedId.value = settings.mood.pinnedId || '';
}
function readSettings() {
  const f = form.elements;
  settings = saveSettings(store, {
    ...settings,
    mood: { warn: f.warn.value, low: f.low.value, crit: f.crit.value, sleepAfterMin: f.sleepAfterMin.value, pinnedId: f.pinnedId.value || null },
    idle: { blinksPerMin: f.blinksPerMin.value, glancesPerMin: f.glancesPerMin.value, movingPct: f.movingPct.value },
    keepAwake: f.keepAwake.checked,
  });
  mood.setSettings(settings.mood);
  player.setIdle(settings.idle);
  if (!settings.keepAwake && noSleep && noSleep.isEnabled) noSleep.disable();
  apply(mood.tick(Date.now()));
}
$('btnSettings').addEventListener('click', e => { e.stopPropagation(); activate(); fillSettings(); form.hidden = false; });
form.addEventListener('change', readSettings);
$('settingsDone').addEventListener('click', () => { form.hidden = true; fillSettings(); });

// Burn-in protection: shift the whole layout by up to 4 px every 10 minutes.
setInterval(() => {
  const app = $('app');
  app.style.setProperty('--dx', `${Math.round(Math.random() * 8 - 4)}px`);
  app.style.setProperty('--dy', `${Math.round(Math.random() * 8 - 4)}px`);
}, 10 * 60000);

render();
connect();
