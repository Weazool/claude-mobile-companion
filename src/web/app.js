import { limitsView, sessionMeta, dotClass, visibleSessions } from './format.js';
import { Player, mountClawd, VIEW, ANIMS, NAMES } from './clawd/index.js';
import { createMood } from './mood.js';
import { validateMap, clipsFrom } from './behaviours.js';
import { loadSettings, saveSettings, validate, rotationFor, nextRotation } from './settings.js';
import { drift, bounce, startState } from './saver.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let snap = null;   // latest Snapshot (spec §5)
let skew = 0;      // serverTime - Date.now(), so countdowns use the PC's clock
let lastMsgAt = Date.now();
let downSince = null;

// ---------- companion ----------
const store = (() => { try { return window.localStorage; } catch { return null; } })();
// Only the rotation is kept between visits; everything else uses the defaults (there is no settings panel).
let settings = validate({ rotation: loadSettings(store).rotation });
const mood = createMood(settings.mood);
const player = new Player({ idle: settings.idle });
const view = mountClawd($('mascot'), { view: VIEW }); // Clawd's rects, drawn into the inline <svg>
let drawPending = true;
let dimmed = false;

function apply(cmd) {
  if (!cmd) return;
  player.setBase(cmd.base);
  if (cmd.play.length) player.play(cmd.play);
  setBubble(cmd.bubble && cmd.bubble.text, cmd.bubble && cmd.bubble.tone);
  dimmed = !!cmd.dim;
  setSaver(dimmed || forceSaver);
}

// ---------- screensaver (burn-in protection while Clawd sleeps) ----------
// The mood's dim is exactly "asleep": the screen goes black and a small card with Clawd and the rings glides
// around it (saver.js). The live mascot SVG moves into the card and back, so the one renderer keeps drawing.
// ?saver forces it on (checks and screenshots); a tap on the screensaver wakes Clawd and brings the dashboard back.
let forceSaver = new URLSearchParams(location.search).has('saver');
let saverOn = false;
let saverState = null;
let saverBox = null;
function setSaver(on) {
  if (on === saverOn) return;
  saverOn = on;
  const svg = $('mascot');
  if (on) document.querySelector('.saver-card').prepend(svg);
  else document.querySelector('.stage').appendChild(svg);
  $('saver').hidden = !on;
  $('app').classList.toggle('saver', on);
  document.documentElement.classList.toggle('saving', on);
  saverState = null;
  saverBox = null;
  if (on) renderRings();
  drawPending = true;
}
function moveSaver(dt) {
  const card = document.querySelector('.saver-card');
  if (!saverBox) { const s = card.parentElement; saverBox = { W: s.clientWidth, H: s.clientHeight, w: card.offsetWidth, h: card.offsetHeight }; }
  const { W, H, w, h } = saverBox;
  saverState = saverState ? bounce(saverState, dt, W, H, w, h) : startState(W, H, w, h);
  card.style.transform = `translate(${saverState.x.toFixed(1)}px, ${saverState.y.toFixed(1)}px)`;
}

// The behaviour map (edited on the PC at /behaviours) arrives on connect and after every save. It is checked
// against this page's rig (not its internal clips) in case the page and the server ever differ; the current
// state then re-renders at once with its new animation. The same map again changes nothing.
const CLIPS = clipsFrom(ANIMS, NAMES);
function setBehaviours(map) {
  const B = validateMap(map, CLIPS);
  mood.setBehaviours(B);
  player.setIdleClips({ blink: B.idleBlink, glance: B.idleGlance, life: B.idleLife });
  apply(mood.tick(Date.now()));
}

// Asleep (dimmed), Clawd's slow breathing needs no more than 20 redraws a second: spare the phone overnight.
const DIM_FRAME_MS = 50;
let lastFrameAt = performance.now();
let lastDrawAt = 0;
let saverDt = 0;
function loop(now) {
  const dt = Math.min(100, now - lastFrameAt);
  lastFrameAt = now;
  const moving = player.update(dt);
  if (saverOn) { saverDt += dt; if (saverDt >= DIM_FRAME_MS) { moveSaver(saverDt); saverDt = 0; } }
  if (drawPending || (moving && (!dimmed || now - lastDrawAt >= DIM_FRAME_MS))) {
    view.render(player.shapes());
    drawPending = false;
    lastDrawAt = now;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => apply(mood.tick(Date.now())), 500);
$('mascot').addEventListener('click', () => { if (!saverOn) apply(mood.onTap(Date.now())); }); // in the screensaver, #saver handles the tap

// ---------- rings ----------
function renderRings() {
  const { rings, note } = limitsView(snap && snap.limits, Date.now(), skew);
  drawRings($('rings'), rings);
  if (saverOn) drawRings($('saverRings'), rings, true);
  $('limitsNote').textContent = note;
}
function drawRings(box, rings, compact = false) {
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
    el.querySelector('.lbl').textContent = r.label + (r.reset && !compact ? ' · ' + r.reset : '');
  }
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

const SETTLE = new URLSearchParams(location.search).has('settle');
let settled = false;
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
    // ?settle (screenshots from headless browsers, which barely run animation frames): skip the entry
    // transitions of the first state, so the picture shows Clawd settled into it.
    if (SETTLE && !settled) { settled = true; for (let i = 0; i < 80; i++) player.update(50); view.render(player.shapes()); }
  });
  src.addEventListener('event', e => { seen(); onEvent(JSON.parse(e.data)); });
  src.addEventListener('behaviours', e => { seen(); setBehaviours((JSON.parse(e.data) || {}).map); });
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
const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

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
window.addEventListener('resize', () => { applyLayout(); saverBox = null; });
applyLayout();

// Full screen and keep-awake need a tap. The controls stop propagation, so they call this themselves.
const noSleep = window.NoSleep ? new window.NoSleep() : null;
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
  $('blank').hidden = false; // a page can't close itself on iOS: blank the screen until tapped
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
$('blank').addEventListener('click', () => { $('blank').hidden = true; });
$('saver').addEventListener('click', e => {
  e.stopPropagation();
  activate();
  forceSaver = false;
  setSaver(false);
  apply(mood.onTap(Date.now())); // wakes him: the wake-up plays and the dashboard is back
});

// Burn-in protection while awake: the whole dashboard drifts slowly and continuously (saver.js drift, eased by
// #app's 2 s transform transition), so no pixel keeps lighting the same spot.
function applyDrift() {
  const app = $('app');
  const { dx, dy } = drift(Date.now(), window.innerWidth, window.innerHeight); // physical screen axes
  app.style.setProperty('--dx', `${dx.toFixed(1)}px`);
  app.style.setProperty('--dy', `${dy.toFixed(1)}px`);
}
applyDrift();
setInterval(applyDrift, 2000);
if (forceSaver) setSaver(true);

render();
connect();
