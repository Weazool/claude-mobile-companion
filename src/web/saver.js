// Burn-in protection for OLED phones: the pure motion behind the dashboard's drift, and the clock behind letting the
// phone lock. No DOM; app.js applies the numbers.

const TAU = Math.PI * 2;

// While Claude works the whole dashboard drifts on a slow Lissajous path within ±2.5% of each side. The two
// periods (7 and 11 minutes) do not divide each other, so over time the path covers the whole area and no
// pixel keeps lighting the same spot.
export const DRIFT = Object.freeze({ amp: 0.025, px: 7 * 60000, py: 11 * 60000 });

export function drift(t, W, H) {
  return {
    dx: DRIFT.amp * W * Math.sin((TAU * t) / DRIFT.px),
    dy: DRIFT.amp * H * Math.sin((TAU * t) / DRIFT.py),
  };
}

// After this long with nothing going on (no Claude activity, no tap) the page lets go of the screen, so the phone
// locks on its own Auto-Lock. Activity or a tap takes it back.
export const RELEASE_AFTER_MS = 30 * 60000;
export const keepAwakeWanted = (now, lastActiveAt, lastTapAt) => now - Math.max(lastActiveAt, lastTapAt) < RELEASE_AFTER_MS;
