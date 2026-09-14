export const RINGS = [
  { key: 'fiveHour', label: '5-hour', color: '#f5a524' },
  { key: 'week', label: 'Week', color: '#35c2b0' },
  { key: 'fable', label: 'Fable', color: '#a78bfa' },
];
export const STALE_MS = 15 * 60 * 1000;

const ACTIVE = ['thinking', 'reading', 'working', 'compiling'];
const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

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

// skewMs = serverTime - phone clock, so countdowns and staleness use the PC's clock.
export function limitsView(limits, now, skewMs = 0) {
  const L = limits || { status: 'unavailable' };
  const t = now + skewMs;
  const stale = L.status === 'stale' || (L.status === 'ok' && Number.isFinite(L.asOf) && t - L.asOf > STALE_MS);
  const rings = RINGS.map(r => {
    const w = L[r.key];
    const pct = w && Number.isFinite(w.pct) ? w.pct : null;
    return { ...r, pct, text: pct === null ? '—' : `${pct}%`, reset: w ? formatReset(w.resetsAt, t) : '', hot: pct !== null && pct >= 80, stale };
  });
  let note = '';
  if (L.status === 'signin') note = 'Run "claude auth login" on the PC to show limits';
  else if (L.status === 'unavailable') note = 'Limits unavailable';
  else if (stale && Number.isFinite(L.asOf)) note = `as of ${hhmm(L.asOf)}`;
  return { rings, note };
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
