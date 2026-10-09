import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, DRIFT, keepAwakeWanted, RELEASE_AFTER_MS } from '../src/web/saver.js';

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

test('keepAwakeWanted: lets go after 30 minutes with no activity and no tap', () => {
  assert.equal(RELEASE_AFTER_MS, 30 * 60000);
  assert.equal(keepAwakeWanted(RELEASE_AFTER_MS - 1, 0, 0), true);
  assert.equal(keepAwakeWanted(RELEASE_AFTER_MS, 0, 0), false);
  assert.equal(keepAwakeWanted(RELEASE_AFTER_MS + 5, 0, 10), true, 'a later tap holds it');
  assert.equal(keepAwakeWanted(RELEASE_AFTER_MS + 5, 10, 0), true, 'later activity holds it');
});
