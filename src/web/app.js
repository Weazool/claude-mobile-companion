import { limitsView, sessionMeta, dotClass, visibleSessions, nextSpot, attnView, attnLimitsUp } from './format.js';
import { Player, mountClawd, VIEW, ANIMS, NAMES } from './clawd/index.js';
import { createMood } from './mood.js';
import { validateMap, clipsFrom } from './behaviours.js';
import { loadSettings, saveSettings, validate, rotationFor, nextRotation } from './settings.js';
import { drift, bounce, startState, createHush, keepAwakeWanted } from './saver.js';

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
  updateHush();
}

// ---------- screensaver (burn-in protection while Clawd sleeps) ----------
// The mood's dim is exactly "asleep": the screen goes black and a small card with Clawd and the limit bars glides
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
  if (on) renderLimits();
  drawPending = true;
}
function moveSaver(dt) {
  const card = document.querySelector('.saver-card');
  if (!saverBox) { const s = card.parentElement; saverBox = { W: s.clientWidth, H: s.clientHeight, w: card.offsetWidth, h: card.offsetHeight }; }
  const { W, H, w, h } = saverBox;
  saverState = saverState ? bounce(saverState, dt, W, H, w, h) : startState(W, H, w, h);
  card.style.transform = `translate(${saverState.x.toFixed(1)}px, ${saverState.y.toFixed(1)}px)`;
}

// ---------- half brightness (burn-in protection while awake) ----------
// Once the dashboard has shown one status for 2 minutes (saver.js createHush) a black layer over it fades in at
// half opacity. A new status or any tap lifts it at once; while it is up it takes the tap, so the first tap only
// brings the brightness back and never lands on ✕ or ⟲. ?hush forces it on (checks and screenshots).
const forceHush = new URLSearchParams(location.search).has('hush');
const hush = createHush();
let hushed = false;
let tapAt = 0;
function updateHush(now = Date.now()) {
  const on = forceHush || hush.update(saverOn ? null : mood.status(now), now);
  if (on === hushed) return;
  hushed = on;
  $('hush').classList.toggle('on', on);
}
document.addEventListener('click', () => { // capture: every tap counts, even one a control stops
  tapAt = Date.now();
  hush.tap(tapAt);
  updateHush(tapAt);
}, true);
// iOS WebKit only turns a tap into a click on an element (below <body>) with a click listener of its own; without
// this one a tap on the layer would never reach the listener above.
$('hush').addEventListener('click', () => {});

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
setInterval(() => {
  apply(mood.tick(Date.now()));
  updateSpot();
  updateHush();
  holdAwake();
}, 500);
$('mascot').addEventListener('click', () => { if (!saverOn) apply(mood.onTap(Date.now())); }); // in the screensaver, #saver handles the tap

// ---------- limits ----------
function renderLimits() {
  const { bars, note } = limitsView(snap && snap.limits, Date.now(), skew);
  drawBars($('limits'), bars);
  if (saverOn) drawBars($('saverLimits'), bars, true);
  $('limitsNote').textContent = note;
}
// A bar per limit: its name and reset, the fill, the percentage, and (not in the screensaver's compact card)
// ticks at the cell edges and the legend naming each hour or day, with the current one outlined.
function drawBars(box, bars, compact = false) {
  if (!box.children.length) {
    box.innerHTML = bars.map(b => `<div class="bar" data-k="${b.key}" style="--c:${b.color}">
      <div class="bar-head"></div><div class="bar-track"><i></i>${compact ? '' : '<span class="ticks"></span>'}</div><div class="bar-num"></div>
      ${compact ? '' : '<div class="bar-legend"></div>'}</div>`).join('');
  }
  for (const b of bars) {
    const el = box.querySelector(`[data-k="${b.key}"]`);
    el.classList.toggle('stale', b.stale);
    el.querySelector('.bar-track i').style.width = `${b.fill}%`;
    const num = el.querySelector('.bar-num');
    num.textContent = b.text;
    num.classList.toggle('hot', b.hot);
    const head = el.querySelector('.bar-head');
    if (compact) { head.textContent = b.short; continue; }
    head.innerHTML = `<b>${esc(b.label)}</b>${b.reset ? ` · ${esc(b.reset)}` : ''}`;
    const pc = f => `${(f * 100).toFixed(3)}%`;
    const key = b.slotList.map(x => `${x.label}${x.current ? '*' : ''}@${pc(x.at)}`).join('|');
    const legend = el.querySelector('.bar-legend');
    if (legend.dataset.key === key) continue;
    legend.dataset.key = key;
    legend.innerHTML = b.slotList.map(x => `<span${x.current ? ' class="now"' : ''} style="width:${pc(x.width)}">${esc(x.label)}</span>`).join('');
    el.querySelector('.ticks').innerHTML = b.slotList.slice(1).map(x => `<b style="left:${pc(x.at)}"></b>`).join('');
  }
}

// ---------- sessions ----------
function renderSessions() {
  const list = snap ? snap.sessions : [];
  const { shown, more } = visibleSessions(list, [spot.id, snap && snap.focusId], 5);
  $('sessions').innerHTML = shown.map(s => `
    <div class="row${s.id === spot.id ? ' focus' : ''}" data-id="${esc(s.id)}">
      <span class="dot ${dotClass(s)}"></span>
      <div><div class="name">${esc(s.name || 'session')}</div><div class="meta${s.needsYou ? ' need' : ''}">${esc(sessionMeta(s))}</div></div>
      <div><div class="ctx"><i style="width:${s.contextPct ?? 0}%"></i></div><div class="ctxl">${s.contextPct == null ? 'ctx —' : `ctx ${s.contextPct}%`}</div></div>
    </div>`).join('')
    + (more ? `<div class="more">+${more} more</div>` : '')
    + (list.length ? '' : '<div class="more">No Claude Code sessions yet</div>');
}

// ---------- the spotlight ----------
// One session at a time is in the spotlight (format.js nextSpot): the next one every 10 s, always, or the one you
// tap. Clawd shows it (mood.setFocus) and the layout follows it: when it needs you, its turn has ended or its turn
// failed, Clawd moves to the middle of the top 75% with the session's details centred under him (spotlight mode,
// #app.attn; mood.js keeps him acting it out all along), and 7 s in the limit bars take his place for the last
// 3 s (#app.limits-up, format.js attnLimitsUp); otherwise the dashboard as always.
let spot = { id: null, since: 0 };
let attnKey = null;
function updateSpot(now = Date.now(), tapped = null) {
  const next = tapped ? { id: tapped, since: now } : nextSpot(snap ? snap.sessions : [], spot, now, snap && snap.focusId);
  const moved = next.id !== spot.id;
  spot = next;
  if (moved) {
    renderSessions();
    apply(mood.setFocus(spot.id, now));
  }
  renderAttn(now);
}
function renderAttn(now) {
  const a = attnView(snap && snap.sessions.find(s => s.id === spot.id));
  const up = !!a && attnLimitsUp(spot, now);
  const key = a ? `${a.tone}|${a.title}|${a.meta}|${up}` : '';
  if (key === attnKey) return;
  attnKey = key;
  $('app').classList.toggle('attn', !!a);
  $('app').classList.toggle('limits-up', up);
  if (!a) return;
  $('attnTitle').textContent = a.title;
  $('attnTitle').className = `attn-title ${a.tone}`;
  $('attnMeta').textContent = a.meta;
}
$('sessions').addEventListener('click', e => { // its own listener, so iOS turns the tap into a click
  const row = e.target.closest('.row');
  if (row && row.dataset.id) updateSpot(Date.now(), row.dataset.id);
});

// ---------- bubble ----------
function setBubble(text, tone) {
  const b = $('bubble');
  b.textContent = text || '';
  b.className = 'bubble' + (text ? ' show' : '') + (tone ? ' ' + tone : '');
}

function render() {
  renderLimits();
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
    noteHooks(snap);
    seen();
    render();
    apply(mood.onSnapshot(snap, Date.now()));
    updateSpot();
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
setInterval(renderLimits, 30000);

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
// Over the LAN's plain http the page is not a secure context, so NoSleep keeps the screen on with a hidden looping
// video; on localhost it takes a wake lock. `arming` keeps a second request from starting while one is pending.
const noSleep = window.NoSleep ? new window.NoSleep() : null;
let arming = false;
function keepAwake() {
  if (!settings.keepAwake || !noSleep || noSleep.isEnabled || arming) return;
  arming = true;
  Promise.resolve(noSleep.enable()).catch(() => {}).finally(() => { arming = false; });
}
function activate() {
  const el = document.documentElement;
  if (!standalone && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  keepAwake();
}
document.addEventListener('click', activate);
// The page keeps the screen on while Claude works, and otherwise until 30 minutes pass with no Claude Code event
// and no tap (saver.js keepAwakeWanted); then it lets go, so the phone locks on its own Auto-Lock. Whenever it
// wants the screen and does not hold it (first load, back from the background, activity after a quiet spell) it
// asks for it again: best effort, as iOS may want a tap, and then the next tap does it. The pair page's preview
// (in an iframe on the PC) only arms on a tap, as before.
// Claude Code events are counted from the sessions' lastEventAt, not from snapshots: the limits poll sends one
// every 5 minutes even when nothing happens (an unanswered prompt, a turn stopped with Esc).
const embedded = window.top !== window;
let hookSeen = 0;        // the newest session event in the snapshots (PC clock)
let hookAt = Date.now(); // when this page saw it move (phone clock)
function noteHooks(s) {
  const t = Math.max(0, ...s.sessions.map(x => x.lastEventAt || 0));
  if (t > hookSeen) { hookSeen = t; hookAt = Date.now(); }
}
let released = true; // not holding the screen yet
function holdAwake(now = Date.now()) {
  if (document.visibilityState === 'hidden') return; // nothing to hold; the handler below let go
  const working = !offline && !!snap && snap.sessions.some(s => dotClass(s) === 'work'); // not the last snapshot of a PC that went away
  const wanted = working || keepAwakeWanted(now, hookAt, tapAt);
  if (wanted === !released) return;
  released = !wanted;
  if (released) { if (noSleep && noSleep.isEnabled) noSleep.disable(); }
  else if (!embedded) keepAwake();
}
// The OS pauses the keep-awake video (or drops the wake lock) while the page is hidden: let go, and the first tick
// back in view (or the next tap) takes it again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (noSleep && noSleep.isEnabled) noSleep.disable();
  released = true;
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
