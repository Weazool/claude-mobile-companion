import { limitsView, sessionMeta, dotClass, visibleSessions } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let snap = null;   // latest Snapshot (spec §5)
let skew = 0;      // serverTime - Date.now(), so countdowns use the PC's clock
let lastMsgAt = Date.now();
let downSince = null;

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

// v0: the bubble shows the focus session's detail. Task 15 hands it to the companion.
function renderBubble() {
  const f = snap && snap.sessions.find(s => s.id === snap.focusId);
  setBubble(f && f.detail, f && f.needsYou ? 'need' : '');
}

function render() {
  renderRings();
  renderSessions();
  renderBubble();
}

function onEvent(ev) { /* Task 15: companion reactions */ }

// ---------- connection ----------
function seen() {
  lastMsgAt = Date.now();
  downSince = null;
  $('offline').hidden = true;
}

function connect() {
  const es = new EventSource('/events' + location.search);
  es.addEventListener('snapshot', e => { snap = JSON.parse(e.data); skew = snap.serverTime - Date.now(); seen(); render(); });
  es.addEventListener('event', e => { seen(); onEvent(JSON.parse(e.data)); });
  es.addEventListener('ping', seen);
  es.onerror = () => {
    if (downSince === null) downSince = Date.now();
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000); // e.g. a 403 after a restart
  };
}

setInterval(() => {
  const now = Date.now();
  $('offline').hidden = !((downSince !== null && now - downSince > 5000) || now - lastMsgAt > 45000);
}, 1000);
setInterval(renderRings, 30000);

render();
connect();
