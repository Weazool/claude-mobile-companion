// Phone-side settings (spec §6), kept in localStorage.
export const STORAGE_KEY = 'desk-companion.settings.v1';
export const DEFAULTS = Object.freeze({
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0,
  keepAwake: true,
});

const num = (v, lo, hi, d) => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function validate(s) {
  const src = s && typeof s === 'object' ? s : {};
  const m = src.mood || {};
  const i = src.idle || {};
  const warn = num(m.warn, 1, 99, 50);
  const low = Math.max(warn, num(m.low, 1, 99, 80));
  const crit = Math.max(low, num(m.crit, 1, 100, 95));
  return {
    mood: { warn, low, crit, sleepAfterMin: num(m.sleepAfterMin, 1, 120, 5), pinnedId: typeof m.pinnedId === 'string' && m.pinnedId ? m.pinnedId : null },
    idle: { blinksPerMin: num(i.blinksPerMin, 0, 60, 26), glancesPerMin: num(i.glancesPerMin, 0, 20, 2), movingPct: num(i.movingPct, 5, 95, 50) },
    rotation: [0, 90, 180, 270].includes(Number(src.rotation)) ? Number(src.rotation) : 0,
    keepAwake: src.keepAwake !== false,
  };
}

export function loadSettings(storage) {
  try {
    return validate(JSON.parse((storage && storage.getItem(STORAGE_KEY)) || '{}'));
  } catch {
    return validate({});
  }
}

export function saveSettings(storage, s) {
  const v = validate(s);
  try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private mode or full */ }
  return v;
}

export const nextRotation = deg => (deg + 90) % 360;

// Size #app so that, rotated by `deg`, it exactly covers a W x H screen.
export function rotationFor(deg, W, H) {
  const turned = deg % 180 !== 0;
  const w = turned ? H : W;
  const h = turned ? W : H;
  return { w, h, layout: w >= h ? 'landscape' : 'portrait' };
}

// The area the dashboard must cover. A Home Screen web app on iPhone draws from the very top of the screen
// but reports innerHeight short by the status bar (measured: 873 of 932 on a 430x932 screen), which left a
// strip of the screen uncovered; there the screen's own size is the truth. Browsers keep innerWidth/Height.
// screen.width/height are the portrait dimensions on iOS, so they are matched to the current orientation.
export function screenBox({ iw, ih, sw, sh, standalone }) {
  if (!standalone || !(sw > 0) || !(sh > 0)) return { W: iw, H: ih };
  const portrait = ih >= iw;
  const fw = portrait ? Math.min(sw, sh) : Math.max(sw, sh);
  const fh = portrait ? Math.max(sw, sh) : Math.min(sw, sh);
  const use = (full, inner) => (full >= inner && full - inner <= 120 ? full : inner); // only a status-bar-sized gap
  return { W: use(fw, iw), H: use(fh, ih) };
}
