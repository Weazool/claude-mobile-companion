import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player, idlePlan } from '../src/web/mascot.js';

const lcg = (seed = 1) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
const run = (pl, ms, step = 16) => { for (let t = 0; t < ms; t += step) { if (pl.update(step)) pl.frame(); } };

test('idlePlan defaults: blink 1.15 s, glance 15 s, breath ~3.7 s of stillness', () => {
  const p = idlePlan();
  assert.ok(Math.abs(p.blinkMs - 30000 / 26) < 1);
  assert.equal(p.glanceMs, 15000);
  assert.ok(Math.abs(p.breathMs - 30000 / ((30000 - 26 * 640 - 2 * 960) / 1400)) < 1);
});

test('idlePlan: no breath budget means no breaths', () => {
  assert.equal(idlePlan({ blinksPerMin: 60, glancesPerMin: 10, movingPct: 20 }).breathMs, Infinity);
  assert.equal(idlePlan({ blinksPerMin: 0, glancesPerMin: 0, movingPct: 50 }).blinkMs, Infinity);
});

test('calm idle measures 26 blinks/min, 2 glances/min, 50% moving over 10 minutes', () => {
  const pl = new Player({ rand: lcg(42) });
  const total = 10 * 60000;
  run(pl, total);
  assert.ok(Math.abs(pl.counts.blink / 10 - 26) <= 2.6, `blinks/min ${pl.counts.blink / 10}`);
  assert.ok(Math.abs(pl.counts.glance / 10 - 2) <= 0.5, `glances/min ${pl.counts.glance / 10}`);
  assert.ok(Math.abs(pl.movingMs / total - 0.5) <= 0.05, `moving ${pl.movingMs / total}`);
});

test('holding idle shows idle frame 0', () => {
  const pl = new Player({ rand: () => 0.99 });
  assert.equal(pl.cur.hold, true);
  assert.deepEqual(pl.frame(), { sheet: 'idle', index: 0 });
});

test('an entry one-shot plays, then the base loop', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play('surprised');
  assert.equal(pl.cur.name, 'surprised');
  run(pl, 800);
  assert.equal(pl.cur.name, 'thinking');
  assert.equal(pl.frame().sheet, 'thinking');
});

test('aliases draw from their shared sheet', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('reading');
  assert.equal(pl.frame().sheet, 'thinking');
  pl.setBase('compiling');
  assert.equal(pl.frame().sheet, 'working');
});

test('jumping_joy chains to happy; a new base then takes over at once', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('happy');
  pl.play('jumping_joy');
  run(pl, 640);
  assert.equal(pl.cur.name, 'happy');
  pl.setBase('idle');
  assert.equal(pl.cur.name, 'idle');
  assert.equal(pl.cur.hold, true);
});

test('a base change made during a chained one-shot is not lost to the loop it chains to', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.play('jumping_joy');
  run(pl, 320);
  pl.setBase('working');
  assert.equal(pl.cur.name, 'jumping_joy'); // the one-shot finishes first
  run(pl, 640);
  assert.equal(pl.cur.name, 'happy'); // chained and looping, but not the base
  pl.setBase('idle');
  assert.equal(pl.cur.name, 'idle');
  assert.equal(pl.cur.hold, true);
});

test('a two-item base cycles surprised and curious', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase(['surprised', 'curious']);
  assert.equal(pl.cur.name, 'surprised');
  run(pl, 800);
  assert.equal(pl.cur.name, 'curious');
  run(pl, 1040);
  assert.equal(pl.cur.name, 'surprised');
});

test('queued one-shots play in order, then the base', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play(['yawning', 'surprised', 'love']);
  const seen = ['yawning'];
  for (let t = 0; t < 4000; t += 16) { pl.update(16); if (seen.at(-1) !== pl.cur.name) seen.push(pl.cur.name); }
  assert.deepEqual(seen, ['yawning', 'surprised', 'love', 'thinking']);
});

test('setBase with the same base does not restart; unknown names are ignored', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('working');
  run(pl, 160);
  const f = pl.fi;
  pl.setBase(['working']);
  assert.equal(pl.fi, f);
  pl.play('nope');
  assert.equal(pl.cur.name, 'working');
  pl.setBase('nope');
  pl.setBase([]);
  assert.deepEqual(pl.base, ['working']);
  assert.doesNotThrow(() => run(pl, 2000));
  assert.equal(pl.frame().sheet, pl.anims.working.sheet);
});
