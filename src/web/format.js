const HOUR = 3600e3;
const DAY = 24 * HOUR;
// Each limit's window ends at its reset and is cut into hours or days that the legend under the bar names, so
// the fill can be read against how much of the window has gone. gauge: its name under the overview's ring.
export const BARS = [
  { key: 'fiveHour', label: '5-hour limit', short: '5h', gauge: '5-hour', color: '#f5a524', slots: 5, slotMs: HOUR },
  { key: 'week', label: 'Weekly limit', short: 'Week', gauge: 'Week', color: '#35c2b0', slots: 7, slotMs: DAY },
  { key: 'fable', label: 'Fable limit', short: 'Fable', gauge: 'Fable', color: '#a78bfa', slots: 7, slotMs: DAY },
];
export const STALE_MS = 15 * 60 * 1000;

const ACTIVE = ['thinking', 'reading', 'working', 'compiling'];
const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const weekday = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });

export function formatReset(resetsAt, now) {
  if (!Number.isFinite(resetsAt)) return '';
  const ms = resetsAt - now;
  if (ms <= 0) return 'now';
  if (ms < 24 * 3600e3) {
    const mins = Math.ceil(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }
  return `${new Date(resetsAt).toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(resetsAt)}`;
}

const nextMidnight = t => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
// Steps back to the local hour's start, not setMinutes(60), which skips the repeated hour when DST ends.
const nextHour = t => { const d = new Date(t); return t - (d.getMinutes() * 60e3 + d.getSeconds() * 1e3 + d.getMilliseconds()) + HOUR; };
const hourName = t => `${String(new Date(t).getHours()).padStart(2, '0')}:xx`;
const SLIVER_MS = 60e3;

// The legend's cells, as { label, at, width, current } with at and width as fractions of the window.
// Cells are clock hours (named 20:xx) or calendar days (named Wed), cut at the local hour or midnight, so the
// outlined cell is this hour or today: a window from 20:20 opens with a short 20:xx and closes with a short
// 01:xx. A cell under half its size is too narrow for its name and goes unnamed; DST days are 23 or 25 hours.
// Resets land a fraction of a second past the hour (19:00:00.481), so a cut that close to either end is
// skipped rather than drawn as a sliver. The cell holding now is current; none is once the window has ended.
export function limitSlots(bar, resetsAt, now) {
  if (!Number.isFinite(resetsAt)) return [];
  const span = bar.slots * bar.slotMs;
  const start = resetsAt - span;
  const [next, name] = bar.slotMs < DAY ? [nextHour, hourName] : [nextMidnight, weekday];
  const edges = [start];
  for (let d = next(start); d < resetsAt - SLIVER_MS; d = next(d)) if (d - start >= SLIVER_MS) edges.push(d);
  edges.push(resetsAt);
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const label = to - from >= bar.slotMs / 2 ? name(from + SLIVER_MS) : '';
    return { label, at: (from - start) / span, width: (to - from) / span, current: now >= from && now < to };
  });
}

export function resetLine(resetsAt, now) {
  const r = formatReset(resetsAt, now);
  if (!r) return '';
  if (r === 'now') return 'resets now';
  return resetsAt - now < DAY ? `resets in ${r}` : `resets ${r}`;
}

// skewMs = serverTime - phone clock, so countdowns and staleness use the PC's clock.
export function limitsView(limits, now, skewMs = 0) {
  const L = limits || { status: 'unavailable' };
  const t = now + skewMs;
  const stale = L.status === 'stale' || (L.status === 'ok' && Number.isFinite(L.asOf) && t - L.asOf > STALE_MS);
  const bars = BARS.map(b => {
    const w = L[b.key];
    const pct = w && Number.isFinite(w.pct) ? w.pct : null;
    return {
      ...b, pct, fill: pct === null ? 0 : Math.min(pct, 100), text: pct === null ? '—' : `${pct}%`,
      reset: w ? resetLine(w.resetsAt, t) : '', until: w ? formatReset(w.resetsAt, t) : '',
      slotList: w ? limitSlots(b, w.resetsAt, t) : [], hot: pct !== null && pct >= 80, stale,
    };
  });
  let note = '';
  if (L.status === 'signin') note = 'Run "claude auth login" on the PC to show limits';
  else if (L.status === 'unavailable') note = 'Limits unavailable';
  else if (stale && Number.isFinite(L.asOf)) note = `as of ${hhmm(L.asOf)}`;
  return { bars, note };
}

export function sessionMeta(s) {
  return [s.modelLabel || '—', s.effort || '—', s.detail].filter(Boolean).join(' · ');
}

export function dotClass(s) {
  if (s.needsYou) return 'need';
  if (ACTIVE.includes(s.activity)) return 'work';
  if (s.activity === 'error' || s.activity === 'rateLimited') return 'bad';
  return 'idle';
}

// The dashboard's cycle (app.js): every session in turn in standard mode, then every session in turn in focus
// mode, then the overview, SLOT_MS each, and round again. A slot is { mode, id, at, since }: 'standard', 'focus'
// or 'overview', its session (none in the overview), that session's place in the list (the order they started)
// and when the slot began. A slot whose session has gone gives way at once to the one that took its place, or,
// past the end, to the next mode. With no sessions nothing goes round: standard mode, empty.
export const SLOT_MS = 10000;
const AFTER = { standard: 'focus', focus: 'overview', overview: 'standard' };

export function nextSlot(sessions, slot, now) {
  if (!sessions.length) return slot.mode === 'standard' && slot.id === null ? slot : { mode: 'standard', id: null, at: 0, since: now };
  const start = (mode, at) => (mode === 'overview' ? { mode, id: null, at: 0, since: now }
    : at < sessions.length ? { mode, id: sessions[at].id, at, since: now } : start(AFTER[mode], 0));
  if (slot.mode === 'overview') return now - slot.since < SLOT_MS ? slot : start('standard', 0);
  const i = sessions.findIndex(s => s.id === slot.id);
  if (i < 0) return start(slot.mode, slot.at);
  if (now - slot.since < SLOT_MS) return i === slot.at ? slot : { ...slot, at: i };
  return start(slot.mode, i + 1);
}

// A tap on a session brings it up at once for a whole slot, in the mode under way (from the overview, in standard
// mode), and the cycle carries on from there.
export function tapSlot(sessions, slot, id, now) {
  const at = sessions.findIndex(s => s.id === id);
  return at < 0 ? slot : { mode: slot.mode === 'focus' ? 'focus' : 'standard', id, at, since: now };
}

// Focus mode's text under Clawd, for any session: what it is doing, in the colour of its state.
export function focusView(s) {
  if (!s) return null;
  const meta = [s.name || 'session', s.modelLabel, s.effort, s.contextPct == null ? null : `ctx ${s.contextPct}%`].filter(Boolean).join(' · ');
  if (s.needsYou) return { tone: 'need', title: s.detail || 'Needs you', meta };
  if (s.activity === 'done') return { tone: 'good', title: 'Your turn', meta };
  if (s.activity === 'error') return { tone: 'bad', title: 'Turn failed', meta };
  if (s.activity === 'rateLimited') return { tone: 'bad', title: 'Rate limited', meta };
  if (ACTIVE.includes(s.activity)) return { tone: 'work', title: s.detail || 'Working', meta };
  return { tone: 'idle', title: 'Idle', meta };
}

// Focus mode gives Clawd a slot's first 7 s; for the rest of it (3 s of the 10) the limit bars take his place.
// A tap on a session starts its slot again, so Clawd comes first.
export const ATTN_CLAWD_MS = 7000;

export function attnLimitsUp(spot, now) {
  return now - spot.since >= ATTN_CLAWD_MS;
}
