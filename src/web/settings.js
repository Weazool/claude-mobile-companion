// Phone-side settings (spec §6), kept in localStorage.
export const STORAGE_KEY = 'desk-companion.settings.v1';
export const DEFAULTS = Object.freeze({
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 2, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0,
  keepAwake: true,
  brightness: 1,
});
// Brightness, set by the slider in the rail and nothing else: a black layer over the dashboard at 1 - brightness,
// with the screen's edges as dark. Never quite off, so the slider can still be seen to turn it back up.
export const BRIGHT_MIN = 0.1;

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
    mood: { warn, low, crit, sleepAfterMin: num(m.sleepAfterMin, 1, 120, 2), pinnedId: typeof m.pinnedId === 'string' && m.pinnedId ? m.pinnedId : null },
    idle: { blinksPerMin: num(i.blinksPerMin, 0, 60, 26), glancesPerMin: num(i.glancesPerMin, 0, 20, 2), movingPct: num(i.movingPct, 5, 95, 50) },
    rotation: [0, 90, 180, 270].includes(Number(src.rotation)) ? Number(src.rotation) : 0,
    keepAwake: src.keepAwake !== false,
    brightness: num(src.brightness, BRIGHT_MIN, 1, 1),
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

// The slider: p runs 0 (its bottom, BRIGHT_MIN) to 1 (its top, full brightness), in whole percents of brightness.
export const brightFrom = p => Math.round((BRIGHT_MIN + (1 - BRIGHT_MIN) * p) * 100) / 100;
export const sliderFrom = b => (b - BRIGHT_MIN) / (1 - BRIGHT_MIN);
// Where a touch lands on the slider, given how far it is (dx, dy px on the physical screen) from the middle of the
// track and how far the knob travels. #app is turned `deg` clockwise, so the track's "up" points along
// (sin deg, -cos deg) on the screen: at 90 deg, to the physical right.
export function sliderAt(deg, dx, dy, travel) {
  const a = (deg * Math.PI) / 180;
  const along = dx * Math.sin(a) - dy * Math.cos(a);
  return Math.min(1, Math.max(0, 0.5 + along / travel));
}

// Size #app so that, rotated by `deg`, it exactly covers a W x H screen.
export function rotationFor(deg, W, H) {
  const turned = deg % 180 !== 0;
  const w = turned ? H : W;
  const h = turned ? W : H;
  return { w, h, layout: w >= h ? 'landscape' : 'portrait' };
}

