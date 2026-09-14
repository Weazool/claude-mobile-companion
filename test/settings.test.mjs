import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSettings, saveSettings, rotationFor, nextRotation, STORAGE_KEY } from '../src/web/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEF = {
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0, keepAwake: true,
};

test('defaults', () => {
  assert.deepEqual(validate({}), DEF);
  assert.deepEqual(validate(null), DEF);
});

test('clamps values and keeps thresholds ordered', () => {
  const v = validate({
    mood: { warn: 90, low: 50, crit: 10, sleepAfterMin: 0, pinnedId: 's9' },
    idle: { blinksPerMin: 999, glancesPerMin: -1, movingPct: 'x' },
    rotation: 45, keepAwake: false,
  });
  assert.deepEqual(v.mood, { warn: 90, low: 90, crit: 90, sleepAfterMin: 1, pinnedId: 's9' });
  assert.deepEqual(v.idle, { blinksPerMin: 60, glancesPerMin: 0, movingPct: 50 });
  assert.equal(v.rotation, 0);
  assert.equal(v.keepAwake, false);
  assert.deepEqual(validate({ mood: { warn: '', low: null } }).mood.warn, 50);
});

test('load and save through a storage; bad JSON gives defaults', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSettings(storage), DEF);
  const saved = saveSettings(storage, { ...DEF, rotation: 90, idle: { blinksPerMin: '30', glancesPerMin: 3, movingPct: 40 } });
  assert.deepEqual(saved.idle, { blinksPerMin: 30, glancesPerMin: 3, movingPct: 40 });
  assert.deepEqual(loadSettings(storage), saved);
  mem.set(STORAGE_KEY, '{nope');
  assert.deepEqual(loadSettings(storage), DEF);
  assert.deepEqual(loadSettings(null), DEF);
});

test('rotation geometry', () => {
  assert.deepEqual(rotationFor(0, 390, 844), { w: 390, h: 844, layout: 'portrait' });
  assert.deepEqual(rotationFor(90, 390, 844), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual(rotationFor(180, 844, 390), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual([0, 90, 180, 270].map(nextRotation), [90, 180, 270, 0]);
});

test('web manifest keeps the tokenised start URL (no start_url) and uses the icon', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/web/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.start_url, undefined);
  assert.equal(m.icons[0].src, '/web/icon.png');
});
