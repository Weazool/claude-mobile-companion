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

// The Claude desktop app's own id for a Code session (CLAUDE_CODE_HOST_SESSION_ID, forwarded by the hook). The app
// opens one from claude://code/continue?session=<id> and only accepts this shape.
export const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/;

// The desktop session a click on Clawd in the corner opens: the session he is acting out, while it waits on you
// (a permission prompt or a question) or it's your turn. Null otherwise, and for sessions outside the desktop app.
export function openTarget(s) {
  if (!s || !(s.needsYou || s.activity === 'done')) return null;
  return typeof s.hostId === 'string' && HOST_ID.test(s.hostId) ? s.hostId : null;
}
