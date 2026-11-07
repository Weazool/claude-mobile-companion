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

// The strip's chips (strip.js), in CSS px: how many fit in `width`, and how many the last "+N" chip stands for.
// `want` is the width every chip would take, so the taskbar program can size the window.
export const CHIP = Object.freeze({ chip: 176, gap: 6, more: 40 });
export function stripLayout(count, width, { chip, gap, more } = CHIP) {
  const want = count * chip + Math.max(0, count - 1) * gap;
  if (want <= width) return { shown: count, more: 0, want };
  const shown = Math.max(0, Math.min(count - 1, Math.floor((width - more) / (chip + gap))));
  return { shown, more: count - shown, want };
}
