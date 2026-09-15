import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, DRIFT, bounce, startState, SAVER_SPEED } from '../src/web/saver.js';

test('drift: starts at rest, stays within ±2.5% of each side, and moves smoothly', () => {
  assert.deepEqual(drift(0, 844, 390), { dx: 0, dy: 0 });
  let prev = drift(0, 844, 390);
  let maxX = 0;
  let maxY = 0;
  for (let t = 0; t <= 80 * 60000; t += 2000) {
    const d = drift(t, 844, 390);
    assert.ok(Math.abs(d.dx) <= DRIFT.amp * 844 + 1e-9 && Math.abs(d.dy) <= DRIFT.amp * 390 + 1e-9, `t=${t}`);
    assert.ok(Math.abs(d.dx - prev.dx) < 1 && Math.abs(d.dy - prev.dy) < 1, `t=${t}: under a pixel per 2 s step`);
    maxX = Math.max(maxX, Math.abs(d.dx));
    maxY = Math.max(maxY, Math.abs(d.dy));
    prev = d;
  }
  assert.ok(maxX > 0.95 * DRIFT.amp * 844 && maxY > 0.95 * DRIFT.amp * 390, 'it really uses its range');
});

test('bounce: the card stays inside, reflects at the edges, keeps its speed, and reaches every edge', () => {
  const W = 844, H = 390, w = 150, h = 170;
  let s = startState(W, H, w, h, () => 0.3);
  const speed = Math.hypot(s.vx, s.vy);
  assert.ok(Math.abs(speed - SAVER_SPEED) < 1e-9);
  const seen = { left: false, right: false, top: false, bottom: false };
  for (let t = 0; t < 10 * 60000; t += 50) {
    s = bounce(s, 50, W, H, w, h);
    assert.ok(s.x >= 0 && s.x <= W - w && s.y >= 0 && s.y <= H - h, `t=${t}: inside`);
    assert.ok(Math.abs(Math.hypot(s.vx, s.vy) - SAVER_SPEED) < 1e-9, 'constant speed');
    if (s.x < 1) seen.left = true;
    if (s.x > W - w - 1) seen.right = true;
    if (s.y < 1) seen.top = true;
    if (s.y > H - h - 1) seen.bottom = true;
  }
  assert.deepEqual(seen, { left: true, right: true, top: true, bottom: true });
});

test('bounce: a card larger than the area just sits at the corner', () => {
  assert.deepEqual(bounce({ x: 5, y: 5, vx: 12, vy: 12 }, 1000, 100, 100, 200, 200), { x: 0, y: 0, vx: -12, vy: -12 });
});
