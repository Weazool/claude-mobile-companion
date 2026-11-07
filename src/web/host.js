// What the page does depends on who shows it. The phone (no flag) is the full dashboard that holds its screen on.
// The Windows taskbar program loads the same page in a WebView2: ?corner is Clawd alone on a see-through window, ?pc
// the whole page in a hover window. Neither may hold the PC awake or go full screen; the corner also never makes way
// for the limit bars and never drifts (no burn-in on a taskbar). If both flags are present, corner wins.
export function hostFlags(search) {
  const q = new URLSearchParams(search);
  const mode = q.has('corner') ? 'corner' : q.has('pc') ? 'pc' : null;
  return {
    mode,
    keepAwake: mode === null,
    fullscreen: mode === null,
    away: mode !== 'corner',
    drift: mode !== 'corner',
  };
}
