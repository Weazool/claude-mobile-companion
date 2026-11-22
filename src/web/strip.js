// The taskbar program's strip (strip.html): one chip per session, each with its own Clawd acting that session out
// (his own mood engine, focused on it) and the session's name. A click on a chip opens the session in the Claude
// desktop app: the window is click-through, so the program catches the click and finds the chip from the layout
// this page sends it ("strip:" + JSON: want, chips [{x0, x1, host, closeX, id}], menu {x0, x1} or null, extra
// [{name, host, state}], chats {x0, x1}, device px); the menu chip's list is `extra`, the working sessions without a
// card, and the Chats chip (first) opens the Claude app's Chat tab. A click on a done session's ✕ comes back as
// { untrack: <session id> }, and the page asks the server to stop tracking it.
import { Player, mountClawd, VIEW, ANIMS, NAMES } from './clawd/index.js';
import { createMood } from './mood.js';
import { validateMap, clipsFrom } from './behaviours.js';
import { validate } from './settings.js';
import { shapesBox, createFit, viewBoxOf } from './fit.js';
import { hostIdOf, stripPlan, menuState, closable } from './host.js';

const CLIPS = clipsFrom(ANIMS, NAMES);
const DEFAULTS = validate({});
const NS = 'http://www.w3.org/2000/svg';
const toHost = msg => { try { window.chrome?.webview?.postMessage(msg); } catch {} };
const box = document.getElementById('chips');
const more = Object.assign(document.createElement('div'), { className: 'more' });
const chatsChip = Object.assign(document.createElement('div'), { className: 'more chats', title: 'Chats' });
chatsChip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>';

const chips = new Map(); // session id -> chip
let snap = null;
let behaviours = null;

function setBehaviours(c, B) {
  c.mood.setBehaviours(B);
  c.player.setIdleClips({ blink: B.idleBlink, glance: B.idleGlance, life: B.idleLife });
}

function apply(c, cmd) {
  if (!cmd) return;
  c.player.setBase(cmd.base);
  if (cmd.play.length) c.player.play(cmd.play);
}

function makeChip(id, now) {
  const el = document.createElement('div');
  el.className = 'chip';
  const svg = document.createElementNS(NS, 'svg');
  const name = document.createElement('span');
  name.className = 'name';
  const x = Object.assign(document.createElement('span'), { className: 'x', textContent: '✕', hidden: true });
  el.append(svg, name, x);
  const c = { id, el, svg, name, x, hostId: null, mood: createMood(DEFAULTS.mood), player: new Player({ idle: DEFAULTS.idle }),
              view: mountClawd(svg, { view: VIEW }), fit: createFit(), settled: true, dirty: true };
  if (behaviours) setBehaviours(c, behaviours);
  c.mood.setFocus(id, now);
  return c;
}

let sent = '';
function layout() {
  const { cards, extra, want } = stripPlan(snap ? snap.sessions.filter(s => chips.has(s.id)) : [], window.innerWidth);
  const list = cards.map(s => chips.get(s.id));
  more.textContent = `+${extra.length}`;
  box.replaceChildren(chatsChip, ...list.map(c => c.el), ...(extra.length ? [more] : []));
  const dpr = window.devicePixelRatio || 1;
  const px = v => Math.round(v * dpr);
  const chipsAt = list.map(c => {
    const r = c.el.getBoundingClientRect();
    const closeX = c.x.hidden ? -1 : px(c.x.getBoundingClientRect().left) - 6; // a little room for a miss
    return { x0: px(r.left), x1: px(r.right), host: c.hostId, closeX, id: c.id };
  });
  const m = extra.length ? more.getBoundingClientRect() : null;
  const menu = m && { x0: px(m.left), x1: px(m.right) };
  const ch = chatsChip.getBoundingClientRect();
  const msg = 'strip:' + JSON.stringify({ want: px(want), chips: chipsAt, menu, extra: extra.map(s => ({ name: s.name || '', host: hostIdOf(s), state: menuState(s) })), chats: { x0: px(ch.left), x1: px(ch.right) } });
  if (msg !== sent) { sent = msg; toHost(msg); }
}
window.addEventListener('resize', layout);

// The program's ✕ clicks: stop tracking that session (the server's /api/untrack, as the phone's card ✕).
try {
  window.chrome?.webview?.addEventListener('message', e => {
    const id = e.data && e.data.untrack;
    if (typeof id === 'string' && chips.has(id)) {
      fetch('/api/untrack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    }
  });
} catch {}

function onSnapshot(s) {
  snap = s;
  const now = Date.now();
  const live = new Set(s.sessions.map(x => x.id));
  for (const id of chips.keys()) if (!live.has(id)) chips.delete(id);
  for (const x of s.sessions) {
    let c = chips.get(x.id);
    if (!c) chips.set(x.id, c = makeChip(x.id, now));
    c.hostId = hostIdOf(x);
    c.name.textContent = x.name || ''; // strip.css ends a long one in an ellipsis
    c.x.hidden = !closable(x);
    apply(c, c.mood.onSnapshot(s, now));
  }
  layout();
}

// ---------- connection (as app.js: a silent connection is replaced, offline after 5 s down or 45 s quiet) ----------
let es = null, lastMsgAt = Date.now(), downSince = null, offline = false;
const seen = () => { lastMsgAt = Date.now(); downSince = null; };
function connect() {
  if (es) es.close();
  const src = es = new EventSource('/events');
  src.addEventListener('snapshot', e => { seen(); onSnapshot(JSON.parse(e.data)); });
  src.addEventListener('event', e => {
    seen();
    const ev = JSON.parse(e.data);
    for (const c of chips.values()) apply(c, c.mood.onEvent(ev, Date.now()));
  });
  src.addEventListener('behaviours', e => {
    seen();
    behaviours = validateMap((JSON.parse(e.data) || {}).map, CLIPS);
    for (const c of chips.values()) setBehaviours(c, behaviours);
  });
  src.addEventListener('ping', seen);
  src.onerror = () => {
    if (src !== es) return;
    if (downSince === null) downSince = Date.now();
    if (src.readyState === EventSource.CLOSED) setTimeout(() => { if (src === es) connect(); }, 5000);
  };
}
setInterval(() => {
  const now = Date.now();
  const down = (downSince !== null && now - downSince > 5000) || now - lastMsgAt > 45000;
  if (down !== offline) { offline = down; for (const c of chips.values()) apply(c, c.mood.setOffline(down, now)); }
  if (now - lastMsgAt > 45000) { lastMsgAt = now; connect(); }
  for (const c of chips.values()) apply(c, c.mood.tick(now));
}, 1000);

// ---------- drawing: every chip's Clawd, fitted to its icon-high box (fit.js) ----------
let lastFrameAt = performance.now();
function loop(now) {
  const dt = Math.min(100, now - lastFrameAt);
  lastFrameAt = now;
  for (const c of chips.values()) {
    const moving = c.player.update(dt);
    let b = null;
    if (c.dirty || moving) {
      const shapes = c.player.shapes();
      c.view.render(shapes);
      b = shapesBox(shapes);
      c.dirty = false;
    }
    if (b || !c.settled) {
      const r = c.fit(b, now);
      c.settled = r.settled;
      if (r.view) c.svg.setAttribute('viewBox', viewBoxOf(r.view));
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
connect();
