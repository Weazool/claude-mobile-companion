// Burn-in protection for OLED phones: the pure motion behind the dashboard's drift and the screensaver card.
// No DOM; app.js applies the numbers.

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
