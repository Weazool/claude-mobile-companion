import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapesBox, createFit, HOLD_MS } from '../src/web/fit.js';

const I = [1, 0, 0, 1, 0, 0];
const rect = (x, y, w, h, m = I, o = 1) => ({ x, y, w, h, m, o });
const inside = (inner, outer) => inner.x0 >= outer.x0 - 1e-9 && inner.y0 >= outer.y0 - 1e-9 && inner.x1 <= outer.x1 + 1e-9 && inner.y1 <= outer.y1 + 1e-9;

test('shapesBox: the drawn rects after their transforms, skipping hidden ones', () => {
  assert.deepEqual(shapesBox([rect(-6, -10, 12, 10), rect(50, 50, 1, 1, I, 0)]), { x0: -6, y0: -10, x1: 6, y1: 0 });
  assert.deepEqual(shapesBox([rect(0, 0, 2, 1, [1, 0, 0, 1, 3, -4])]), { x0: 3, y0: -4, x1: 5, y1: -3 }, 'translated');
  const r = shapesBox([rect(0, 0, 2, 2, [0, 1, -1, 0, 0, 0])]); // a quarter turn
  assert.ok(Math.abs(r.x0 + 2) < 1e-9 && Math.abs(r.x1) < 1e-9 && Math.abs(r.y1 - 2) < 1e-9);
  assert.equal(shapesBox([]), null);
});

test('fit: a taller frame (a flag) is never clipped, and the view eases back after it has gone', () => {
  const fit = createFit({ pad: 0 });
  const body = { x0: -6, y0: -10, x1: 6, y1: 0 };
  const flag = { x0: -6, y0: -24, x1: 10, y1: 0 };
  assert.deepEqual(fit(body, 0).view, body);
  const v = fit(flag, 16).view;
  assert.ok(inside(flag, v), 'the flag frame fits at once');
  let t = 16;
  for (; t < HOLD_MS - 100; t += 16) assert.ok(inside(flag, fit(body, t).view), 'held while the flag is recent');
  let r;
  for (t = HOLD_MS + 100; t < HOLD_MS + 5000; t += 16) r = fit(body, t);
  assert.ok(r.settled && Math.abs(r.view.y0 - body.y0) < 0.05, 'back to the body alone');
  for (t += 16; t < HOLD_MS + 5200; t += 16) assert.ok(inside(body, fit(body, t).view));
});

test('fit: keeps the last view while no frame is drawn', () => {
  const fit = createFit();
  assert.equal(fit(null, 0).view, null);
  const v = fit({ x0: 0, y0: 0, x1: 1, y1: 1 }, 10).view;
  assert.deepEqual(fit(null, 20).view, v);
});
