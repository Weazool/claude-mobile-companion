import { dotClass } from './format.js';

// What the page does depends on who shows it. The phone (no flag) is the full dashboard that holds its screen on.
// The Windows taskbar program loads the same page in a WebView2: ?corner is Clawd alone on a see-through window, ?pc
// the whole page in a hover window. Neither may hold the PC awake or go full screen, and neither needs what guards a
// phone's screen against burn-in: the drift, the limit bars taking over after a quiet spell, and the rail (rotate,
// brightness). The limits/tasks cycle stays. If both flags are present, corner wins.
export function hostFlags(search) {
  const q = new URLSearchParams(search);
  const mode = q.has('corner') ? 'corner' : q.has('pc') ? 'pc' : null;
  const phone = mode === null;
  return { mode, keepAwake: phone, fullscreen: phone, away: phone, drift: phone, rail: phone };
}

// The corner's Clawd has two states only: at his laptop while any session works (its turn, or its background
// tasks), else idle. The sessions themselves are acted out on the strip's chips.
export const cornerBase = sessions => (sessions.some(s => dotClass(s) === 'work') ? 'working' : 'idle');

// The Claude desktop app's own id for a Code session (CLAUDE_CODE_HOST_SESSION_ID, forwarded by the hook). The app
// opens one from claude://code/continue?session=<id> and only accepts this shape. Null for terminal sessions.
export const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/;
export const hostIdOf = s => (s && typeof s.hostId === 'string' && HOST_ID.test(s.hostId) ? s.hostId : null);

// The strip's chips (strip.js), in CSS px: two session cards at most. Sessions waiting on you take them first, then
// finished ones (done, idle, failed), then working ones; the working sessions left without a card go in the "+N"
// chip's menu (the menu chip shows only when there are some). `want` is the width the strip needs for these
// sessions, whatever the window's width is now, so the taskbar program can size the window to it (from what fits
// now, a narrow window would never grow).
export const CHIP = Object.freeze({ chip: 176, gap: 6, more: 40, max: 2 });
const rank = s => { const d = dotClass(s); return d === 'need' ? 0 : d === 'work' ? 2 : 1; };
export const stripOrder = sessions => [0, 1, 2].flatMap(r => sessions.filter(s => rank(s) === r));
export function stripPlan(sessions, width, { chip, gap, more, max } = CHIP) {
  const order = stripOrder(sessions);
  const extraFrom = n => order.slice(n).filter(s => dotClass(s) === 'work');
  const size = n => {
    const x = extraFrom(n).length > 0;
    return n * chip + (x ? more : 0) + Math.max(0, n + (x ? 1 : 0) - 1) * gap;
  };
  const ideal = Math.min(order.length, max);
  let shown = ideal;
  while (shown > 0 && size(shown) > width) shown--;
  return { cards: order.slice(0, shown), extra: extraFrom(shown), want: size(ideal) };
}

// A session's state as the menu chip's list says it.
export function menuState(s) {
  switch (dotClass(s)) {
    case 'need': return 'Needs you';
    case 'work': return s.activity === 'done' ? 'Background tasks' : 'Working';
    case 'bad': return 'Error';
    default: return s.activity === 'done' ? 'Your turn' : 'Idle';
  }
}

// The hover window's tasks card: every session's background tasks together, each with its session's name (the
// phone's card shows the session that's up).
export function allTasks(sessions) {
  let count = 0;
  const tasks = [];
  for (const s of sessions) {
    const list = s.tasks || [];
    count += Math.max(s.background || 0, list.length);
    for (const t of list) tasks.push({ ...t, session: s.name || '' });
  }
  return { count, tasks };
}

// The hover window leaves out a limit the account doesn't have right now (the usage data has no window for it, e.g.
// no 5-hour window) rather than show an empty bar. While limits are missing altogether (signed out, unavailable)
// every bar stays, empty, with the note saying why.
export const pcBarShown = (limits, bar) => !(limits && limits.status === 'ok' && bar.pct === null);

// A chip gets a ✕ once its session is done or idle (not at work, not waiting on you): finished sessions linger on
// the taskbar until they expire, and the ✕ stops tracking one (as the phone's card ✕ does) until its next prompt.
export const closable = s => !!s && dotClass(s) === 'idle';
