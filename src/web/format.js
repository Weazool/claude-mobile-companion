const HOUR = 3600e3;
const DAY = 24 * HOUR;
// Each limit's window ends at its reset and is cut into hours or days that the legend under the bar names, so
// the fill can be read against how much of the window has gone.
export const BARS = [
  { key: 'fiveHour', label: '5-hour limit', short: '5h', color: '#f5a524', slots: 5, slotMs: HOUR },
  { key: 'week', label: 'Weekly limit', short: 'Week', color: '#35c2b0', slots: 7, slotMs: DAY },
  { key: 'fable', label: 'Fable limit', short: 'Fable', color: '#a78bfa', slots: 7, slotMs: DAY },
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

// The legend's cells, as { label, at, width, current } with at and width as fractions of the window.
// Hours are equal slots named by their start time. Days are calendar days cut at local midnight, so the
// outlined day is today: a window from Fri 19:00 opens with a short Fri and closes with most of the next Fri.
// A day cell under 12 hours (and so too narrow for its name) goes unnamed; DST days are 23 or 25 hours.
// The cell holding now is current; none is once the window has ended.
export function limitSlots(bar, resetsAt, now) {
  if (!Number.isFinite(resetsAt)) return [];
  const span = bar.slots * bar.slotMs;
  const start = resetsAt - span;
  const edges = [start];
  if (bar.slotMs < DAY) for (let i = 1; i < bar.slots; i++) edges.push(start + i * bar.slotMs);
  else for (let d = nextMidnight(start); d < resetsAt; d = nextMidnight(d)) edges.push(d);
  edges.push(resetsAt);
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const label = bar.slotMs < DAY ? hhmm(from) : to - from >= DAY / 2 ? weekday(from) : '';
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
      reset: w ? resetLine(w.resetsAt, t) : '', slotList: w ? limitSlots(b, w.resetsAt, t) : [], hot: pct !== null && pct >= 80, stale,
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

export function visibleSessions(list, focusId, max = 5) {
  if (list.length <= max) return { shown: list.slice(), more: 0 };
  let shown = list.slice(0, max);
  const focus = list.find(s => s.id === focusId);
  if (focus && !shown.includes(focus)) shown = shown.slice(0, max - 1).concat(focus);
  return { shown, more: list.length - max };
}
