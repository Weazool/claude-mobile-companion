// Burn-in protection for OLED phones: the pure motion behind the dashboard's drift and the screensaver card, and
// the clocks behind half brightness and letting the phone lock. No DOM; app.js applies the numbers.

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

// The screensaver card glides at a slow constant speed and bounces off the edges (like the old DVD logo).
export const SAVER_SPEED = 12; // px per second

// A random spot and a diagonal heading (30-60 degrees off an axis, in a random quadrant).
export function startState(W, H, w, h, rand = Math.random) {
  const a = TAU / 12 + (rand() * TAU) / 12 + Math.floor(rand() * 4) * (TAU / 4);
  return {
    x: rand() * Math.max(0, W - w),
    y: rand() * Math.max(0, H - h),
    vx: Math.cos(a) * SAVER_SPEED,
    vy: Math.sin(a) * SAVER_SPEED,
  };
}

// The card's next position after dt ms inside a W x H area (card w x h), reflecting off the edges.
export function bounce(s, dt, W, H, w, h) {
  const mx = Math.max(0, W - w);
  const my = Math.max(0, H - h);
  let { x, y, vx, vy } = s;
  x += (vx * dt) / 1000;
  y += (vy * dt) / 1000;
  if (x < 0) { x = -x; vx = Math.abs(vx); } else if (x > mx) { x = 2 * mx - x; vx = -Math.abs(vx); }
  if (y < 0) { y = -y; vy = Math.abs(vy); } else if (y > my) { y = 2 * my - y; vy = -Math.abs(vy); }
  return { x: Math.min(mx, Math.max(0, x)), y: Math.min(my, Math.max(0, y)), vx, vy };
}

// Half brightness: once the dashboard has shown the same status for HUSH_AFTER_MS (Claude thinking and working
// away, a permission prompt nobody has answered yet) it dims to half. A new status (your turn, a permission
// prompt, an error) or a tap brings it back to full at once. When all is quiet, Clawd's sleep takes over instead.
export const HUSH_AFTER_MS = 2 * 60000;

export function createHush(afterMs = HUSH_AFTER_MS) {
  let status = null;
  let since = 0;
  return {
    // Whether to dim now, given the status the dashboard shows (null: nothing to dim, e.g. the screensaver is up).
    update(next, now) {
      if (next !== status) { status = next; since = now; }
      return status !== null && now - since >= afterMs;
    },
    tap(now) { since = now; },
  };
}

// After this long with nothing going on (no Claude activity, no tap) the page lets go of the screen, so the phone
// locks on its own Auto-Lock. Activity or a tap takes it back.
export const RELEASE_AFTER_MS = 30 * 60000;
export const keepAwakeWanted = (now, lastActiveAt, lastTapAt) => now - Math.max(lastActiveAt, lastTapAt) < RELEASE_AFTER_MS;
