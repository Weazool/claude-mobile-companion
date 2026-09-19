import { limitsView, sessionMeta, dotClass, nextSlot, tapSlot, attnLimitsUp } from './format.js';
import { Player, mountClawd, VIEW, ANIMS, NAMES } from './clawd/index.js';
import { createMood } from './mood.js';
import { validateMap, clipsFrom } from './behaviours.js';
import { loadSettings, saveSettings, validate, rotationFor, nextRotation, brightFrom, sliderFrom, sliderAt } from './settings.js';
import { drift, bounce, startState, keepAwakeWanted } from './saver.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let snap = null;   // latest Snapshot (spec §5)
let skew = 0;      // serverTime - Date.now(), so countdowns use the PC's clock
let lastMsgAt = Date.now();
let downSince = null;

// ---------- companion ----------
const store = (() => { try { return window.localStorage; } catch { return null; } })();
// Only the rotation and the brightness are kept between visits; everything else uses the defaults (there is no
// settings panel).
const kept = loadSettings(store);
let settings = validate({ rotation: kept.rotation, brightness: kept.brightness });
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

// Every tap counts towards keeping the screen on (saver.js keepAwakeWanted), even one a control stops.
let tapAt = 0;
document.addEventListener('click', () => { tapAt = Date.now(); }, true);

// ---------- brightness (the slider in the rail) ----------
// A black layer over the dashboard at 1 - brightness, and the screen's edges as dark (style.css --edge; under the
// offline overlay, black at .82, they keep 18% of that). Nothing dims on its own: the slider is the only control,
// and it is remembered. A touch anywhere on the track sets it, and a drag follows the finger (settings.js sliderAt
// works out "up" on the track at every rotation).
const slider = $('bright');
function applyBrightness(b) {
  $('dimmer').style.opacity = (1 - b).toFixed(2);
  const root = document.documentElement.style;
  root.setProperty('--lvl', `${Math.round(b * 100)}%`);
  root.setProperty('--lvl-off', `${(b * 18).toFixed(1)}%`);
  slider.style.setProperty('--p', sliderFrom(b).toFixed(3));
  slider.setAttribute('aria-valuenow', String(Math.round(b * 100)));
  $('brightPct').textContent = `${Math.round(b * 100)}%`;
}
function setBrightness(b, save) {
  settings = { ...settings, brightness: b };
  applyBrightness(b);
  if (save) settings = saveSettings(store, settings);
}
applyBrightness(settings.brightness);
let dragId = null;
function brightAt(e) {
  const r = slider.getBoundingClientRect();
  const travel = slider.clientHeight - slider.querySelector('.bright-knob').offsetHeight;
  return brightFrom(sliderAt(settings.rotation, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), travel));
}
slider.addEventListener('pointerdown', e => {
  dragId = e.pointerId;
  slider.setPointerCapture(e.pointerId);
  tapAt = Date.now();
  setBrightness(brightAt(e), false);
});
slider.addEventListener('pointermove', e => { if (e.pointerId === dragId) setBrightness(brightAt(e), false); });
const endDrag = e => {
  if (e.pointerId !== dragId) return;
  dragId = null;
  setBrightness(settings.brightness, true);
  activate(); // keep-awake wants a tap, and a drag makes no click
};
slider.addEventListener('pointerup', endDrag);
slider.addEventListener('pointercancel', endDrag);
slider.addEventListener('keydown', e => {
  const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
  if (!step) return;
  e.preventDefault();
  setBrightness(validate({ brightness: Math.round((settings.brightness + step) * 100) / 100 }).brightness, true);
});
// iOS only shows :active (the ⟲ filling in) on an element with a touch listener.
$('btnRotate').addEventListener('touchstart', () => {}, { passive: true });

// The rail rests at 10% (style.css) and comes up to full on a touch. That first touch only brings it up: a ⟲ or a
// slider you can barely see is never pressed by accident. Once it is up, the controls work as usual, and 5 s after
// the last touch (or the end of a drag) it fades back.
const RAIL_AWAKE_MS = 5000;
const rail = $('rail');
let railTimer = 0;
let swallowClick = false;
function wakeRail() {
  rail.classList.add('awake');
  clearTimeout(railTimer);
  railTimer = setTimeout(() => { if (dragId === null) rail.classList.remove('awake'); else wakeRail(); }, RAIL_AWAKE_MS);
}
rail.addEventListener('pointerdown', e => { // capture: before the ⟲ and the slider see it
  swallowClick = !rail.classList.contains('awake');
  wakeRail();
  if (swallowClick) e.stopPropagation();
}, true);
rail.addEventListener('click', e => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);
rail.addEventListener('pointermove', () => { if (dragId !== null) wakeRail(); });
rail.addEventListener('pointerup', wakeRail);
rail.addEventListener('keydown', wakeRail, true);

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
// Every session, in the order they started, in a list that scrolls. Its rows are kept and updated in place: a
// snapshot comes with every hook event, and rebuilding the list would break a scroll or lose a tap on a row
// replaced under the finger. With none, the list's :empty rule says so (style.css).
const list = $('sessions');
const put = (el, text) => { if (el.textContent !== text) el.textContent = text; };
function makeRow(id) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.id = id;
  row.innerHTML = '<span class="dot"></span><div><div class="name"></div><div class="meta"></div></div>'
    + '<div><div class="ctx"><i></i></div><div class="ctxl"></div></div><button class="untrack" aria-label="Stop tracking">✕</button>';
  return row;
}
function fillRow(row, s) {
  row.classList.toggle('focus', s.id === spot.id);
  const dot = row.querySelector('.dot');
  if (dot.className !== `dot ${dotClass(s)}`) dot.className = `dot ${dotClass(s)}`;
  put(row.querySelector('.name'), s.name || 'session');
  const meta = row.querySelector('.meta');
  put(meta, sessionMeta(s));
  meta.classList.toggle('need', !!s.needsYou);
  row.querySelector('.ctx i').style.width = `${s.contextPct ?? 0}%`;
  put(row.querySelector('.ctxl'), s.contextPct == null ? 'ctx —' : `ctx ${s.contextPct}%`);
}
// Focus mode's bar under Clawd: the session's own row, as in the list, twice the size (style.css .attn-card).
const attnRow = makeRow('');
$('attnCard').appendChild(attnRow);
function renderSessions() {
  const old = new Map([...list.children].map(row => [row.dataset.id, row]));
  let at = list.firstElementChild;
  for (const s of snap ? snap.sessions : []) {
    const row = old.get(s.id) || makeRow(s.id);
    old.delete(s.id);
    fillRow(row, s);
    if (row === at) at = at.nextElementSibling; else list.insertBefore(row, at);
  }
  for (const row of old.values()) row.remove();
  edges();
}

// The list follows the slot's session, unless you touched it in the last 15 s. Focus mode lays the list out
// elsewhere, which loses its scroll, so the dashboard's is kept and put back. Faded edges say there is more.
const LEAVE_BE_MS = 15000;
let listTouchedAt = 0;
let listScroll = 0;
const attnOn = () => $('app').classList.contains('attn');
function edges() {
  list.classList.toggle('more-above', list.scrollTop > 1);
  list.classList.toggle('more-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
}
list.addEventListener('scroll', () => { if (!attnOn()) listScroll = list.scrollTop; edges(); }, { passive: true });
for (const type of ['touchstart', 'wheel', 'pointerdown']) list.addEventListener(type, () => { listTouchedAt = Date.now(); }, { passive: true });
function followSpot(now = Date.now()) {
  if (attnOn() || now - listTouchedAt < LEAVE_BE_MS) return;
  const row = [...list.children].find(r => r.dataset.id === spot.id);
  if (!row) return;
  const top = row.offsetTop, bottom = top + row.offsetHeight;
  if (top < list.scrollTop) list.scrollTo({ top, behavior: 'smooth' });
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight, behavior: 'smooth' });
}

// ✕ on a row, in the list or in focus mode: the server stops tracking the session until you prompt it again, it
// restarts or it needs you, and its next snapshot takes the session away. The control dims meanwhile, and
// comes back if the server says no (a server started before this version has no /api/untrack).
function untrack(id, el) {
  el.classList.add('closing');
  fetch(`/api/untrack${location.search}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch(() => el.classList.remove('closing'));
}

// ---------- the cycle ----------
// The dashboard goes round (format.js nextSlot), 10 s a slot: every session in turn in standard mode (Clawd on
// the left acting it out, the limit bars and the list on the right, its row lit); then every session in turn in
// focus mode (#app.attn): Clawd in the top 75% with his caption, the session's row twice the size under him, and 7 s
// in the limit bars in his place for the last 3 (#app.limits-up, format.js attnLimitsUp). Tap a session to bring
// it up at once; the cycle carries on from there. Clawd shows the slot's session (mood.setFocus).
let spot = { mode: 'standard', id: null, at: 0, since: 0 };
let modeKey = null;
function updateSpot(now = Date.now(), tapped = null) {
  const sessions = snap ? snap.sessions : [];
  const next = tapped ? tapSlot(sessions, spot, tapped, now) : nextSlot(sessions, spot, now);
  const moved = next.id !== spot.id || next.mode !== spot.mode;
  spot = next;
  if (moved) {
    renderSessions();
    apply(mood.setFocus(spot.id, now));
  }
  renderMode(now);
  if (moved) followSpot(now);
}
// In focus mode the session's row under Clawd follows it as its row in the list does.
function renderMode(now) {
  const s = spot.mode === 'focus' && snap ? snap.sessions.find(x => x.id === spot.id) : null;
  const up = !!s && attnLimitsUp(spot, now);
  if (s) {
    if (attnRow.dataset.id !== s.id) { attnRow.dataset.id = s.id; attnRow.classList.remove('closing'); }
    fillRow(attnRow, s);
  }
  const key = `${spot.mode}|${spot.id}|${!!s}|${up}`;
  if (key === modeKey) return;
  modeKey = key;
  const was = attnOn();
  $('app').classList.toggle('attn', !!s);
  $('app').classList.toggle('limits-up', up);
  if (!s) {
    if (was) list.scrollTop = listScroll;
    edges();
  }
}
list.addEventListener('click', e => { // its own listener, so iOS turns the tap into a click
  const row = e.target.closest('.row');
  if (!row || !row.dataset.id) return;
  if (e.target.closest('.untrack')) untrack(row.dataset.id, row);
  else updateSpot(Date.now(), row.dataset.id);
});
$('attnCard').addEventListener('click', e => { // its own listener, so iOS turns the tap into a click
  if (e.target.closest('.untrack') && attnRow.dataset.id) untrack(attnRow.dataset.id, attnRow);
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
  document.documentElement.classList.toggle('offline', down);
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
window.addEventListener('resize', () => { applyLayout(); saverBox = null; edges(); });
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
