// The taskbar corner shows Clawd at icon height, as big as fits: the SVG's viewBox follows what he draws instead of
// the rig's fixed square, so a flag, a "!" or confetti shrink him to fit rather than being clipped. The view never
// leaves out the current frame; it reaches the smallest box that holds every frame of the last HOLD_MS gradually
// (EASE_MS), so he doesn't pump in and out within one animation.

export const HOLD_MS = 1500;
export const EASE_MS = 400;
export const PAD = 0.5; // rig units of air around him

// The box (rig units) of the rects a frame draws, after each one's transform. Null when nothing shows.
export function shapesBox(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    if (!(s.o > 0) || !(s.w > 0) || !(s.h > 0)) continue;
    const [a, b, c, d, e, f] = s.m;
    for (const [x, y] of [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]]) {
      const X = a * x + c * y + e, Y = b * x + d * y + f;
      if (X < x0) x0 = X; if (X > x1) x1 = X;
      if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// An SVG viewBox attribute for a box.
export const viewBoxOf = v => `${v.x0.toFixed(3)} ${v.y0.toFixed(3)} ${(v.x1 - v.x0).toFixed(3)} ${(v.y1 - v.y0).toFixed(3)}`;

const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const near = (a, b) => Math.abs(a.x0 - b.x0) + Math.abs(a.y0 - b.y0) + Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) < 0.01;

// fit(box, now) -> { view: {x0,y0,x1,y1}, settled }. box is this frame's shapesBox (null: keep the last one).
export function createFit({ hold = HOLD_MS, ease = EASE_MS, pad = PAD } = {}) {
  let view = null, frame = null, last = 0;
  const recent = []; // [time, box] of the frames in the last `hold` ms
  return function fit(box, now) {
    if (box) {
      frame = { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
      recent.push([now, frame]);
    }
    if (!frame) return { view: null, settled: true };
    while (recent.length > 1 && now - recent[0][0] > hold) recent.shift();
    const target = recent.reduce((u, [, b]) => union(u, b), frame);
    if (!view) view = target;
    const k = 1 - Math.exp(-Math.max(0, now - last) / ease);
    last = now;
    const eased = { x0: view.x0 + (target.x0 - view.x0) * k, y0: view.y0 + (target.y0 - view.y0) * k,
                    x1: view.x1 + (target.x1 - view.x1) * k, y1: view.y1 + (target.y1 - view.y1) * k };
    view = union(eased, frame); // this frame always fits, however the eased box lags
    return { view, settled: near(view, target) };
  }
}
