import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIG, PALETTE, LEG_OVERLAP, VIEW, SPEC, NAMES, INTERNAL, ANIMS, GLYPHS, MISSING, BLEND_MS, BLEND_MAX_MS, PROP_BLEND_MS,
  rest, shapesAt, corners, shapesDiff, evalAnim, register, defineGlyph, pixels, mixPose, loopTime,
  idlePlan, Player, ease, keys, hopY, ramped, hash01, mountClawd, POOL_RECTS,
} from '../src/web/clawd/index.js';
import { createImage, drawShapes } from '../tools/lib/rast.mjs';

const lcg = (seed = 1) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
const run = (pl, ms, step = 16) => { for (let t = 0; t < ms; t += step) { if (pl.update(step)) pl.shapes(); } };
const copy = shapes => shapes.map(s => ({ ...s, m: [...s.m] }));
const bbox = s => {
  const c = corners(s);
  const xs = c.map(p => p[0]);
  const ys = c.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const SEEDS = [1, 2, 0xdeadbeef];
const samples = (def, n) => Array.from({ length: n }, (_, i) => (def.dur * i) / (n - 1));
const FRAME = 1000 / 60;
// Collect every failure in a test, then assert once, so one broken clip does not hide the next one.
const failures = () => {
  const list = [];
  return { fail: msg => list.push(msg), check: (ok, msg) => { if (!ok) list.push(msg); }, done: what => assert.deepEqual(list, [], what) };
};
// A private registry for tests that register their own clips.
const playerAnims = () => Object.assign(Object.create(null), ANIMS);

// The brief's table, exactly: the dashboard's mood engine calls these names.
const BRIEF = {
  idle: 'loop', blink: 'once', look_left: 'once', look_right: 'once', walk: 'once', hop: 'once',
  yawning: 'once', sleeping: 'loop', cool: 'loop', thinking: 'loop', reading: 'loop', working: 'loop', compiling: 'loop',
  surprised: 'once', curious: 'once', happy_eyes: 'loop', happy: 'loop', jumping_joy: 'once -> happy', celebration: 'once -> happy',
  love: 'once', low_tokens: 'loop', sad: 'loop', ending: 'loop', overloaded: 'loop', angry: 'loop', error: 'loop',
};
const kindOf = d => (d.loop ? 'loop' : d.next ? `once -> ${d.next}` : 'once');

// ---------- rig ----------

test('the rig matches the brief: rects, colours, pivots', () => {
  const r = (x, y, w, h, fill, pivot) => ({ x, y, w, h, fill, pivot });
  const B = '#D97757';
  const I = '#141413';
  assert.deepEqual({ ...RIG.body, pivot: [...RIG.body.pivot] }, r(-6, -10, 12, 8, B, [0, -2]));
  assert.deepEqual({ ...RIG.eyeL, pivot: [...RIG.eyeL.pivot] }, r(-4, -8, 1, 2, I, [-3.5, -7]));
  assert.deepEqual({ ...RIG.eyeR, pivot: [...RIG.eyeR.pivot] }, r(3, -8, 1, 2, I, [3.5, -7]));
  assert.deepEqual({ ...RIG.armL, pivot: [...RIG.armL.pivot] }, r(-8, -6, 2, 2, B, [-6, -5]));
  assert.deepEqual({ ...RIG.armR, pivot: [...RIG.armR.pivot] }, r(6, -6, 2, 2, B, [6, -5]));
  assert.deepEqual(RIG.legs.map(l => ({ ...l, pivot: [...l.pivot] })), [
    r(-5, -2, 1, 2, B, [-4.5, -2]), r(-3, -2, 1, 2, B, [-2.5, -2]), r(2, -2, 1, 2, B, [2.5, -2]), r(4, -2, 1, 2, B, [4.5, -2]),
  ]);
  assert.deepEqual(
    [PALETTE.body, PALETTE.ink, PALETTE.white, PALETTE.flush, PALETTE.heart, PALETTE.steam],
    ['#D97757', '#141413', '#F5F4ED', '#C4463A', '#E5566E', '#C9C3BA'],
  );
  assert.deepEqual([...PALETTE.confetti], ['#D97757', '#F2C14E', '#6A9BD8', '#7CC47F', '#F5F4ED']);
});

test('the rest pose draws exactly the brief\'s rects, axis-aligned, legs behind the body', () => {
  const s = shapesAt(rest());
  assert.deepEqual(s.map(x => x.part), ['leg', 'leg', 'leg', 'leg', 'body', 'glyph:eye_open', 'glyph:eye_open', 'armL', 'armR']);
  for (const x of s) {
    assert.ok(x.m[1] === 0 && x.m[2] === 0, `${x.part} is axis-aligned`); // === lets -0 pass
    assert.equal(x.o, 1);
  }
  const want = [RIG.body, RIG.eyeL, RIG.eyeR, RIG.armL, RIG.armR];
  s.slice(4).forEach((x, i) => {
    const b = bbox(x);
    const w = want[i];
    assert.deepEqual([b.x0, b.y0, b.x1, b.y1], [w.x, w.y, w.x + w.w, w.y + w.h], x.part);
    assert.equal(x.fill, w.fill);
  });
  s.slice(0, 4).forEach((x, i) => {
    const b = bbox(x);
    const w = RIG.legs[i];
    assert.deepEqual([b.x0, b.x1, b.y1], [w.x, w.x + w.w, 0]);
    assert.equal(b.y0, w.y - LEG_OVERLAP); // the overlap hides under the body, which is drawn after it
    assert.ok(b.y0 >= RIG.body.y);
    assert.equal(x.fill, PALETTE.body);
  });
});

test('parts pivot where the brief says', () => {
  const p = rest();
  p.body.rot = 90;
  let s = shapesAt(p).find(x => x.part === 'body');
  const bb = bbox(s);
  assert.ok(near(bb.x0, 0) && near(bb.x1, 8) && near(bb.y0, -8) && near(bb.y1, 4), JSON.stringify(bb)); // about (0, -2), top to the right
  const q = rest();
  q.armL.rot = 90; // raise: the left arm points up from its shoulder
  q.armR.rot = 90;
  s = shapesAt(q);
  const aL = bbox(s.find(x => x.part === 'armL'));
  const aR = bbox(s.find(x => x.part === 'armR'));
  assert.ok(near(aL.x0, -7) && near(aL.x1, -5) && near(aL.y0, -7) && near(aL.y1, -5), JSON.stringify(aL));
  assert.ok(near(aR.x0, 5) && near(aR.x1, 7) && near(aR.y0, -7) && near(aR.y1, -5), JSON.stringify(aR));
  const r = rest();
  r.root.sy = 0.5; // squash about the ground point: feet stay down
  const legs = shapesAt(r).filter(x => x.part === 'leg').map(bbox);
  for (const l of legs) assert.ok(near(l.y1, 0));
});

test('legs reach the ground by default, lift on request, and follow a leaning body', () => {
  const p = rest();
  p.body.rot = 6;
  p.body.y = 0.4;
  p.legs[0].rot = 20;
  p.legs[3].lift = 0.5;
  const legs = shapesAt(p).filter(x => x.part === 'leg').map(bbox);
  assert.ok(near(legs[0].y1, 0) && near(legs[1].y1, 0) && near(legs[2].y1, 0), JSON.stringify(legs));
  assert.ok(near(legs[3].y1, -0.5));
});

test('props ride on their part; upright ones keep the body\'s orientation', () => {
  const p = rest();
  p.armR.rot = 45;
  p.props.push({ glyph: 'block', on: 'armR', x: 8, y: -5 }, { glyph: 'block', on: 'armR', x: 8, y: -5, upright: true });
  const [turned, upright] = shapesAt(p).filter(x => x.part === 'glyph:block');
  const hand = [6 + 2 * Math.cos(Math.PI / 4), -5 - 2 * Math.sin(Math.PI / 4)]; // (8, -5) raised 45° about the shoulder
  for (const s of [turned, upright]) assert.ok(near(s.m[4], hand[0]) && near(s.m[5], hand[1]), JSON.stringify(s.m));
  assert.ok(Math.abs(turned.m[1]) > 0.5);
  assert.ok(near(upright.m[1], 0) && near(upright.m[2], 0) && near(upright.m[0], 1));
});

test('pixels() merges runs into rects and places the origin', () => {
  const r = pixels(['.##.', '.##.', 'w..w'], { px: 0.5, ox: 2, oy: 3 });
  assert.deepEqual(r, [
    { x: -0.5, y: -1.5, w: 1, h: 1, fill: PALETTE.ink },
    { x: -1, y: -0.5, w: 0.5, h: 0.5, fill: PALETTE.white },
    { x: 0.5, y: -0.5, w: 0.5, h: 0.5, fill: PALETTE.white },
  ]);
  assert.throws(() => defineGlyph('bad', [[0, 0, -1, 1, '#fff']]), /bad rect/);
});

test('the common glyphs exist', () => {
  for (const g of ['Z', 'dot', '!', '?', 'heart', 'steam', 'sweat', 'spark', 'confetti', 'flag1', 'flag2', 'flag3', 'flag4',
    'laptop', 'dumbbell', 'page', 'sunglasses', 'block']) assert.ok(GLYPHS[g], g);
  for (const e of ['open', 'closed', 'happy', 'wide', 'x', 'heart', 'squint_l', 'squint_r', 'half', 'sad_l', 'sad_r']) assert.ok(GLYPHS[`eye_${e}`], e);
  for (const m of ['o', 'smile']) assert.ok(GLYPHS[`mouth_${m}`], m);
});

// ---------- helpers ----------

test('eases run 0 -> 1; keys, hopY and ramped behave', () => {
  for (const [n, e] of Object.entries(ease)) {
    assert.ok(near(e(0), 0, 1e-9), n);
    assert.ok(near(e(1), 1, 1e-9), n);
  }
  const k = [[0, 0], [100, 10, ease.linear], [200, 0]];
  assert.equal(keys(-5, k), 0);
  assert.equal(keys(50, k), 5);
  assert.equal(keys(100, k), 10);
  assert.equal(keys(250, k), 0);
  assert.equal(hopY(0, 0, 400, 200, 5), 0);
  assert.ok(near(hopY(400, 0, 400, 200, 5), -5));
  assert.equal(hopY(600, 0, 400, 200, 5), 0);
  assert.ok(hopY(440, 0, 400, 200, 5) < -4.99); // power3-in hangs at the top...
  assert.ok(hopY(590, 0, 400, 200, 5) > -1); // ...and drops fast at the end
  assert.ok(near(ramped(0).s, 0) && near(ramped(1).s, 1) && near(ramped(0.5).s, 0.5) && near(ramped(0.5).v, 1));
  assert.equal(hash01(7, 3), hash01(7, 3));
  assert.notEqual(hash01(7, 3), hash01(7, 4));
});

// ---------- clips ----------

test('every animation in the brief\'s table is registered, with the kind the mood engine expects', () => {
  const f = failures();
  assert.deepEqual([...NAMES].sort(), Object.keys(BRIEF).sort(), 'SPEC lists exactly the brief\'s 26 names');
  for (const [name, kind] of Object.entries(BRIEF)) {
    const def = ANIMS[name];
    if (!def) { f.fail(`${name} is not registered`); continue; }
    f.check(kindOf(SPEC[name]) === kind, `${name}: SPEC says ${kindOf(SPEC[name])}, the brief ${kind}`);
    f.check(kindOf(def) === kind, `${name}: registered as ${kindOf(def)}, the brief says ${kind}`);
  }
  for (const name of Object.keys(ANIMS)) f.check(name in BRIEF || INTERNAL.includes(name), `${name} is not one of the brief's names`);
  for (const name of INTERNAL) f.check(!!ANIMS[name], `internal clip ${name} is missing`);
  assert.throws(() => register('idle', { dur: 1, pose: rest }), /already registered/);
  f.done('the brief\'s table');
});

test('clip lengths fit how the dashboard uses them', () => {
  const f = failures();
  const within = (name, lo, hi) => f.check(ANIMS[name].dur >= lo && ANIMS[name].dur <= hi, `${name}: ${ANIMS[name].dur} ms is outside ${lo}-${hi}`);
  within('blink', 120, 250);                                   // brief: ~160 ms
  within('look_left', 700, 1200); within('look_right', 700, 1200); // brief: ~900 ms
  within('yawning', 1500, 2200);                               // brief ~1.8 s; the mood engine gives it 2.5 s
  within('surprised', 500, 1200);                               // plays on every entry into thinking and working
  for (const [name, def] of Object.entries(ANIMS)) {
    if (!def.loop) f.check(def.dur >= 100 && def.dur <= 3500, `${name}: a one-shot of ${def.dur} ms`);
    else if (name !== 'idle') f.check(def.dur - def.loopFrom >= 1200 && def.dur - def.loopFrom <= 8000, `${name}: a loop of ${def.dur - def.loopFrom} ms`);
    f.check(!def.loopFrom || def.loopFrom <= 1200, `${name}: an intro of ${def.loopFrom} ms`);
  }
  f.done('clip lengths');
});

test('every registered animation evaluates to finite shapes at 20 sample times', () => {
  MISSING.clear();
  const f = failures();
  for (const [name, def] of Object.entries(ANIMS)) {
    for (const seed of SEEDS) {
      for (const t of samples(def, 20)) {
        const s = shapesAt(evalAnim(name, t, seed));
        f.check(s.length >= 5, `${name}@${t}: only ${s.length} shapes`);
        for (const x of s) {
          const nums = [x.x, x.y, x.w, x.h, x.o, ...x.m];
          f.check(nums.every(Number.isFinite), `${name}@${t} ${x.part} ${JSON.stringify(x)}`);
          f.check(x.w > 0 && x.h > 0 && x.o > 0 && x.o <= 1, `${name}@${t} ${x.part}: size or opacity`);
          f.check(/^#[0-9a-fA-F]{6}$/.test(x.fill), `${name}@${t} ${x.part}: fill ${x.fill}`);
        }
      }
    }
  }
  f.check(MISSING.size === 0, `glyphs, eye styles or mouths used but never defined: ${[...MISSING].join(', ')}`);
  f.done('finite shapes');
});

test('everything stays in view and within the rect budget', () => {
  const f = failures();
  let most = { n: 0 };
  for (const [name, def] of Object.entries(ANIMS)) {
    for (const seed of SEEDS) {
      for (const t of samples(def, 90)) {
        const s = shapesAt(evalAnim(name, t, seed));
        if (s.length > most.n) most = { n: s.length, name, t: Math.round(t) };
        for (const x of s) {
          if (x.o < 0.05) continue;
          const b = bbox(x);
          f.check(b.x0 >= VIEW.x && b.x1 <= VIEW.x + VIEW.w && b.y0 >= VIEW.y && b.y1 <= VIEW.y + VIEW.h,
            `${name}@${Math.round(t)} seed ${seed}: ${x.part} leaves the view ${JSON.stringify(b)}`);
        }
      }
    }
  }
  f.check(most.n <= 60, `the busiest frame draws ${most.n} rects (${most.name}@${most.t}); keep it under 60`);
  f.check(most.n < POOL_RECTS, `the busiest frame (${most.n}) must fit the renderer's pool (${POOL_RECTS})`);
  f.done('view and rect budget');
});

test('grounded clips keep feet at y = 0', () => {
  const f = failures();
  for (const [name, def] of Object.entries(ANIMS)) {
    if (!def.grounded) continue;
    for (const seed of SEEDS) {
      for (const t of samples(def, 60)) {
        const s = shapesAt(evalAnim(name, t, seed));
        const legs = s.filter(x => x.part === 'leg').map(bbox);
        const lowest = Math.max(...legs.map(b => b.y1));
        f.check(near(lowest, 0, 1e-6), `${name}@${t.toFixed(0)} seed ${seed}: lowest foot at ${lowest}`);
        for (const x of s.filter(v => v.part === 'body' || v.part.startsWith('arm'))) {
          f.check(bbox(x).y1 <= 1e-6, `${name}@${t.toFixed(0)}: ${x.part} below the ground`);
        }
      }
    }
  }
  f.done('grounded clips');
});

test('loops are seamless: the pose at dur equals the pose at loopFrom (0 unless the loop has an intro)', () => {
  const f = failures();
  for (const [name, def] of Object.entries(ANIMS)) {
    if (!def.loop) continue;
    for (const seed of SEEDS) {
      const d = shapesDiff(shapesAt(evalAnim(name, def.loopFrom, seed)), shapesAt(evalAnim(name, def.dur, seed)));
      f.check(d < 1e-3, `${name} seed ${seed}: seam differs by ${d}`);
      // and the frame across the seam moves the body, arms and legs no more than the clip moves them anyway
      const step = mainMove(copy(shapesAt(evalAnim(name, def.dur - FRAME, seed))), copy(shapesAt(evalAnim(name, def.loopFrom + 0.001, seed))));
      if (Number.isFinite(step)) f.check(step <= Math.max(0.05, 1.5 * speedOf(name)), `${name} seed ${seed}: steps ${step.toFixed(2)} across the seam (own speed ${speedOf(name).toFixed(2)})`);
    }
  }
  f.done('seamless loops');
});

test('one-shots start at rest and end at rest, or on their successor\'s first pose when chained', () => {
  const R = shapesAt(rest());
  const f = failures();
  for (const [name, def] of Object.entries(ANIMS)) {
    if (def.loop) continue;
    for (const seed of SEEDS) {
      const a = shapesDiff(shapesAt(evalAnim(name, 0, seed)), R);
      f.check(a < 0.02, `${name} seed ${seed} starts ${a} from rest`);
      const end = shapesAt(evalAnim(name, def.dur, seed));
      const target = def.next ? shapesAt(evalAnim(def.next, 0, seed)) : R;
      const b = shapesDiff(end, target);
      f.check(b < 0.02, `${name} seed ${seed} ends ${b} from ${def.next ? `${def.next}'s first pose` : 'rest'}`);
    }
  }
  f.done('one-shot ends');
});

test('walk: a few steps to one side and back, within ±6 units, with alternating lifted feet', () => {
  const def = ANIMS.walk;
  const sides = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    let far = 0;
    let lifts = 0;
    for (const t of samples(def, 120)) {
      const p = evalAnim('walk', t, seed);
      const body = bbox(shapesAt(p).find(x => x.part === 'body'));
      const cx = (body.x0 + body.x1) / 2;
      assert.ok(Math.abs(cx) <= 6, `centre ${cx}`);
      if (Math.abs(cx) > Math.abs(far)) far = cx;
      if (p.legs.some(l => l.lift > 0.2)) lifts++;
    }
    assert.ok(Math.abs(far) >= 2.5, `walks at least 2.5 units out (${far})`);
    assert.ok(lifts > 20, 'feet lift while walking');
    sides.add(Math.sign(far));
  }
  assert.equal(sides.size, 2, 'the seed picks the side');
});

test('hop: leaves the ground on an arc, stretches in the air, squashes on landing', () => {
  const def = ANIMS.hop;
  let apex = 0;
  let tallest = 0;
  let flattest = Infinity;
  for (const t of samples(def, 200)) {
    const s = shapesAt(evalAnim('hop', t));
    const body = bbox(s.find(x => x.part === 'body'));
    const feet = Math.max(...s.filter(x => x.part === 'leg').map(x => bbox(x).y1));
    apex = Math.min(apex, feet);
    const h = body.y1 - body.y0;
    if (feet < -0.5) tallest = Math.max(tallest, h);
    if (feet > -0.01) flattest = Math.min(flattest, h);
  }
  assert.ok(apex <= -2.5, `apex ${apex}`);
  assert.ok(tallest > 8.4, `stretch ${tallest}`);
  assert.ok(flattest < 7.2, `squash ${flattest}`);
});

// ---------- blending ----------

test('mixPose interpolates numbers and cross-fades items', () => {
  const a = rest();
  const b = rest();
  b.root.x = 4;
  b.eyes.style = 'happy';
  b.fx.push({ glyph: 'Z', x: 1, y: -14 });
  const m = mixPose(a, b, 0.25);
  assert.equal(m.root.x, 1);
  assert.equal(m.eyes.style, 'open');
  assert.equal(m.fx[0].o, 0.25);
  assert.equal(mixPose(a, b, 0.75).eyes.style, 'happy');
});

test('mixPose: a blend: \'grow\' item scales in and out at full opacity', () => {
  const a = rest();
  const b = rest();
  b.props.push({ glyph: 'flag1', on: 'armR', x: 7, y: -5, s: 1.25, blend: 'grow' });
  const inn = mixPose(a, b, 0.25).props[0];
  assert.ok(near(inn.s, 0.3125) && num1(inn.o), JSON.stringify(inn));
  const out = mixPose(b, a, 0.25).props[0];
  assert.ok(near(out.s, 0.9375) && num1(out.o), JSON.stringify(out));
  assert.equal(shapesAt(mixPose(b, a, 1)).filter(s => s.part.startsWith('glyph:flag')).length, 0, 'grown down to nothing: not drawn');
});
function num1(o) { return o === undefined || o === 1; }

test('mixPose: two different tints blend through their colours instead of jumping', () => {
  const a = rest();
  a.tint = { color: PALETTE.flush, k: 0.5 };
  const b = rest();
  b.tint = { color: '#8a817c', k: 0.12 };
  const skin = p => shapesAt(p).find(s => s.part === 'body').fill.toLowerCase();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const A = rgb(skin(a));
  const B = rgb(skin(b));
  assert.deepEqual(rgb(skin(mixPose(a, b, 0))), A);
  assert.deepEqual(rgb(skin(mixPose(a, b, 1))), B);
  let prev = A;
  for (let k = 0.1; k <= 1.0001; k += 0.1) {
    const c = rgb(skin(mixPose(a, b, k)));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(c[i] - prev[i]) <= Math.abs(A[i] - B[i]) * 0.1 + 2, `channel ${i} jumps at k ${k.toFixed(1)}`);
    prev = c;
  }
});

// ---------- Player (the semantics the dashboard's mood engine relies on, then the rig's refinements) ----------

test('idlePlan defaults: blink 1.15 s, glance 15 s; breaths and life share the rest of the moving budget', () => {
  const d = { blink: 160, glance: 900, breath: 2000, life: 2000 };
  const p = idlePlan({}, d);
  assert.ok(Math.abs(p.blinkMs - 30000 / 26) < 1);
  assert.equal(p.glanceMs, 15000);
  const free = 30000 - 26 * 160 - 2 * 900;
  assert.ok(Math.abs(p.breathMs - 30000 / ((free * 0.75) / 2000)) < 1);
  assert.ok(Math.abs(p.lifeMs - 30000 / ((free * 0.25) / 2000)) < 1);
});

test('idlePlan: no moving budget means no breaths and no idle life', () => {
  const d = { blink: 640, glance: 960, breath: 2000, life: 2000 };
  const p = idlePlan({ blinksPerMin: 60, glancesPerMin: 10, movingPct: 20 }, d);
  assert.equal(p.breathMs, Infinity);
  assert.equal(p.lifeMs, Infinity);
  assert.equal(idlePlan({ blinksPerMin: 0, glancesPerMin: 0, movingPct: 50 }, d).blinkMs, Infinity);
});

test('calm idle measures 26 blinks/min, 2 glances/min, 50% moving over 10 minutes, with breaths and idle life', () => {
  const pl = new Player({ rand: lcg(42) });
  const total = 10 * 60000;
  run(pl, total);
  assert.ok(Math.abs(pl.counts.blink / 10 - 26) <= 2.6, `blinks/min ${pl.counts.blink / 10}`);
  assert.ok(Math.abs(pl.counts.glance / 10 - 2) <= 0.5, `glances/min ${pl.counts.glance / 10}`);
  assert.ok(Math.abs(pl.movingMs / total - 0.5) <= 0.05, `moving ${pl.movingMs / total}`);
  assert.ok(pl.counts.breath > 30, `breaths ${pl.counts.breath}`);
  assert.ok(pl.counts.life > 10, `walks and hops ${pl.counts.life}`);
});

test('holding idle shows the rest pose and goes quiet', () => {
  const pl = new Player({ rand: () => 0.99 });
  assert.equal(pl.cur.hold, true);
  assert.equal(shapesDiff(copy(pl.shapes()), shapesAt(rest())), 0);
  assert.equal(pl.update(16), false);
  assert.equal(pl.update(16), false);
});

test('a finished idle event hands back to the hold without redrawing forever', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.play('blink');
  assert.equal(pl.update(16), true);
  run(pl, ANIMS.blink.dur + 200);
  assert.equal(pl.cur.hold, true);
  pl.shapes();
  assert.equal(pl.update(16), false);
  // after a whole loop's clip change as well
  pl.setBase('thinking');
  run(pl, 1000);
  pl.setBase('idle');
  run(pl, BLEND_MAX_MS + 100);
  pl.shapes();
  assert.equal(pl.update(16), false);
});

test('an entry one-shot plays, then the base loop', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play('surprised');
  assert.equal(pl.cur.name, 'surprised');
  run(pl, A.surprised.dur + 32);
  assert.equal(pl.cur.name, 'thinking');
});

test('jumping_joy chains to happy; a new base then takes over at once', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('happy');
  pl.play('jumping_joy');
  run(pl, A.jumping_joy.dur + 32);
  assert.equal(pl.cur.name, 'happy');
  pl.setBase('idle');
  assert.equal(pl.cur.name, 'idle');
  assert.equal(pl.cur.hold, true);
});

test('a base change made during a chained one-shot is not lost to the loop it chains to', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.play('jumping_joy');
  run(pl, A.jumping_joy.dur / 2);
  pl.setBase('working');
  assert.equal(pl.cur.name, 'jumping_joy'); // the one-shot finishes first
  run(pl, A.jumping_joy.dur);
  assert.equal(pl.cur.name, 'happy'); // chained and looping, but not the base
  pl.setBase('idle');
  assert.equal(pl.cur.name, 'idle');
  assert.equal(pl.cur.hold, true);
});

test('a two-item base cycles surprised and curious', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase(['surprised', 'curious']);
  assert.equal(pl.cur.name, 'surprised');
  run(pl, A.surprised.dur + 16);
  assert.equal(pl.cur.name, 'curious');
  run(pl, A.curious.dur);
  assert.equal(pl.cur.name, 'surprised');
});

test('queued one-shots play in order, then the base', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play(['yawning', 'surprised', 'love']);
  const seen = ['yawning'];
  const total = A.yawning.dur + A.surprised.dur + A.love.dur + 500;
  for (let t = 0; t < total; t += 16) { pl.update(16); if (seen.at(-1) !== pl.cur.name) seen.push(pl.cur.name); }
  assert.deepEqual(seen, ['yawning', 'surprised', 'love', 'thinking']);
});

test('setBase with the same base does not restart; unknown names are ignored', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('working');
  run(pl, 160);
  const t = pl.cur.t;
  pl.setBase(['working']);
  assert.equal(pl.cur.t, t);
  pl.play('nope');
  assert.equal(pl.cur.name, 'working');
  pl.setBase('nope');
  pl.setBase([]);
  assert.deepEqual(pl.base, ['working']);
  assert.doesNotThrow(() => run(pl, 2000));
  assert.ok(pl.shapes().length >= 9);
});

test('a single one-shot base plays once, then holds calm idle until the base changes (the mood engine\'s yawn)', () => {
  const pl = new Player({ rand: lcg(9) });
  pl.setBase('yawning'); // mood.js: the yawn transient's base, for 2.5 s (3 s when its tick lands late)
  const seen = [pl.cur.name];
  let yawnStarts = 1;
  for (let t = 0; t < 3000; t += 16) {
    const before = pl.cur;
    pl.update(16);
    if (pl.cur !== before && pl.cur.name === 'yawning') yawnStarts++;
    if (seen.at(-1) !== pl.cur.name) seen.push(pl.cur.name);
  }
  assert.equal(yawnStarts, 1, 'the yawn does not restart under its own base');
  assert.equal(seen[0], 'yawning');
  assert.equal(pl.cur.hold, true);
  pl.play('love'); // a tap in between plays, then the hold comes back, not a second yawn
  run(pl, ANIMS.love.dur + 100);
  assert.equal(pl.cur.hold, true);
  pl.setBase('sleeping');
  assert.equal(pl.cur.name, 'sleeping');
});

test('loops with an intro play it once, then wrap to loopFrom', () => {
  const A = playerAnims();
  register('test_intro', { dur: 1000, loop: true, loopFrom: 400, pose: t => { const p = rest(); p.root.x = t / 1000; return p; } }, A);
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('test_intro');
  run(pl, 1200, 10);
  assert.ok(near(pl.cur.t, 600, 1e-6), `after 1.2 s the clip is at ${pl.cur.t} ms`);
  assert.equal(loopTime(A.test_intro, 2200), 400);
  assert.equal(loopTime(A.test_intro, 999), 999);
  assert.equal(loopTime(A.walk, 5000), A.walk.dur);
  assert.throws(() => register('test_bad_intro', { dur: 1000, loopFrom: 200, pose: rest }, A), /needs loop/);
  assert.throws(() => register('test_bad_intro2', { dur: 1000, loop: true, loopFrom: 1000, pose: rest }, A), /loopFrom/);
});

test('calm idle\'s own clips (a breath, a walk) yield to a new base at once; played one-shots do not', () => {
  const pl = new Player({ rand: lcg(3), idle: { movingPct: 95, blinksPerMin: 0, glancesPerMin: 0 } });
  let guard = 0;
  while (!pl.cur.idle && guard++ < 20000) pl.update(16);
  assert.ok(pl.cur.idle, 'calm idle started one of its clips');
  const idleClip = pl.cur.name;
  pl.update(16);
  pl.setBase('thinking');
  assert.equal(pl.cur.name, 'thinking', `${idleClip} yielded`);
  pl.setBase('idle');
  run(pl, 600);
  pl.play('love');
  pl.setBase('working');
  assert.equal(pl.cur.name, 'love', 'a played one-shot finishes first');
});

test('setBase then play in the same tick keeps the outgoing clip moving (no freeze)', () => {
  const pl = new Player({ rand: () => 0.4 });
  pl.setBase(['surprised', 'curious']);
  run(pl, ANIMS.surprised.dur + 500); // into curious
  assert.equal(pl.cur.name, 'curious');
  const { ctx } = pl.cur;
  const t = pl.cur.t;
  pl.setBase('happy_eyes'); // the stop event: "Your turn" ...
  pl.play('surprised');     // ... after a surprised
  assert.ok(pl.blend.live && pl.blend.live.def.name === 'curious', 'curious keeps playing under the blend');
  pl.update(16);
  const d = shapesDiff(shapesAt(evalAnim('curious', t + 16, ctx.seed)), copy(pl.shapes()));
  assert.ok(d < 0.2, `the first frame strays ${d.toFixed(2)} from curious's own next frame`);
});

test('a clip change blends from the shown pose instead of cutting', () => {
  const A = playerAnims();
  const at = x => () => { const p = rest(); p.root.x = x; return p; };
  register('test_right', { dur: 1000, loop: true, pose: at(4) }, A);
  register('test_left', { dur: 1000, loop: true, pose: at(-4) }, A);
  const pl = new Player({ anims: A, rand: () => 0.99 });
  pl.setBase('test_right');
  run(pl, 400);
  const before = copy(pl.shapes());
  pl.setBase('test_left');
  pl.update(16);
  const first = shapesDiff(copy(pl.shapes()), before);
  assert.ok(first > 0 && first < 2, `first blended frame moved ${first} of 8 units`);
  assert.ok(pl.blend.dur > BLEND_MS, 'a long way back blends for longer');
  run(pl, BLEND_MAX_MS + 32);
  assert.ok(shapesDiff(copy(pl.shapes()), shapesAt(at(-4)())) < 1e-9);
});

test('a prop arriving or leaving blends for at least PROP_BLEND_MS', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('working'); // the desk and the laptop arrive
  assert.ok(pl.blend.dur >= PROP_BLEND_MS, `into working: ${pl.blend.dur} ms`);
  run(pl, 1000);
  pl.setBase('thinking'); // and leave
  assert.ok(pl.blend.dur >= PROP_BLEND_MS, `out of working: ${pl.blend.dur} ms`);
  run(pl, 1000);
  pl.setBase(['surprised', 'curious']); // no props on either side: a short blend
  assert.ok(pl.blend.dur < PROP_BLEND_MS, `thinking to surprised: ${pl.blend.dur} ms`);
});

test('blendMs: 0 cuts cleanly between clips', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: () => 0.99, blendMs: 0 });
  pl.setBase('thinking');
  pl.update(16);
  for (const s of pl.shapes()) assert.ok([s.x, s.y, s.w, s.h, s.o, ...s.m].every(Number.isFinite));
  pl.setBase('idle');
  assert.equal(pl.update(16), true);
});

test('clip changes never pop, even when the mood interrupts idle life far from home', () => {
  const A = playerAnims();
  const pl = new Player({ anims: A, rand: lcg(7), idle: { movingPct: 80, glancesPerMin: 6 } });
  let prev = null;
  let clip = pl.cur;
  let worst = 0;
  let changes = 0;
  for (let t = 0; t < 4 * 60000; t += 16) {
    if (t % 23000 === 0 && t) pl.play('surprised'); // interrupts whatever idle life is running
    pl.update(16);
    const cur = copy(pl.shapes());
    // Only the frame where the clip changes: fast motion within a clip (a hop's launch) is design.
    if (prev && pl.cur !== clip) {
      changes++;
      const d = shapesDiff(prev, cur);
      if (Number.isFinite(d)) worst = Math.max(worst, d); // eye-style swaps change the rect list by design
    }
    clip = pl.cur;
    prev = cur;
  }
  assert.ok(changes > 100, `clip changes seen: ${changes}`);
  assert.ok(worst < 0.3, `largest jump at a clip change ${worst.toFixed(2)} units`);

  // The worst case, on purpose: a walk interrupted at its far end, about 4 units from home. The walk keeps
  // playing as it fades, so the first frame is (almost) the walk's own next frame: no jump, no freeze.
  const p2 = new Player({ anims: A, rand: () => 0.99 });
  p2.play('walk');
  run(p2, 1500);
  const { seed } = p2.cur.ctx;
  const tw = p2.cur.t;
  p2.play('surprised');
  p2.update(16);
  const d = shapesDiff(shapesAt(evalAnim('walk', tw + 16, seed, A)), copy(p2.shapes()));
  assert.ok(d < 0.2, `interrupting a walk far out strayed ${d.toFixed(2)} units from its own motion`);
  run(p2, BLEND_MAX_MS);
  assert.equal(p2.blend, null);
});

// The body, arms and legs, matched part by part, frame to frame.
const MAIN = new Set(['leg', 'body', 'armL', 'armR']);
function mainMove(A, B) {
  const pick = S => S.filter(s => MAIN.has(s.part));
  const a = pick(A);
  const b = pick(B);
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].part !== b[i].part) return Infinity;
    const ca = corners(a[i]);
    const cb = corners(b[i]);
    for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(ca[j][0] - cb[j][0]), Math.abs(ca[j][1] - cb[j][1]));
  }
  return d;
}
const ownSpeed = new Map();
function speedOf(name) { // the fastest a clip moves its body, arms or legs by itself, per 60 fps frame
  if (ownSpeed.has(name)) return ownSpeed.get(name);
  const def = ANIMS[name];
  let d = 0;
  for (const seed of [1, 2]) {
    let prev = null;
    for (let t = 0; t <= def.dur; t += FRAME) {
      const s = copy(shapesAt(evalAnim(name, t, seed)));
      if (prev) d = Math.max(d, mainMove(prev, s));
      prev = s;
    }
  }
  ownSpeed.set(name, d);
  return d;
}

test('switching between any two base loops never pops (60 fps, body, arms and legs)', () => {
  const bases = [...NAMES.filter(n => SPEC[n].loop), 'needs'];
  const speed = b => (b === 'idle' ? 0 : b === 'needs' ? Math.max(speedOf('surprised'), speedOf('curious')) : speedOf(b));
  const set = b => (b === 'needs' ? ['surprised', 'curious'] : b);
  const f = failures();
  let worst = { d: 0 };
  for (const a of bases) {
    for (const b of bases) {
      if (a === b) continue;
      for (const phase of [700, 2300]) {
        const pl = new Player({ rand: lcg(3), idle: { blinksPerMin: 0, glancesPerMin: 0, movingPct: 5 } });
        pl.setBase(set(a));
        for (let t = 0; t < phase; t += FRAME) pl.update(FRAME);
        let prev = copy(pl.shapes());
        pl.setBase(set(b));
        const end = pl.blend ? pl.blend.dur + 2 * FRAME : 2 * FRAME;
        for (let t = 0; t < end; t += FRAME) {
          pl.update(FRAME);
          const cur = copy(pl.shapes());
          const d = mainMove(prev, cur);
          const allowed = Math.max(0.6, 1.1 * Math.max(speed(a), speed(b)));
          if (Number.isFinite(d)) {
            if (d / allowed > (worst.d || 0)) worst = { d: d / allowed, a, b, phase };
            f.check(d <= allowed, `${a} -> ${b} (switch at ${phase} ms): moved ${d.toFixed(2)} in one frame, allowed ${allowed.toFixed(2)}`);
          }
          prev = cur;
        }
      }
    }
  }
  f.done(`base-loop switches (worst ratio ${worst.d && worst.d.toFixed(2)} for ${worst.a} -> ${worst.b})`);
});

test('the dashboard\'s flows: yawn then sleep, wake, "Your turn", fresh limits', () => {
  const flow = (script, ms) => {
    const pl = new Player({ rand: lcg(11) });
    const seen = [];
    let si = 0;
    for (let t = 0; t < ms; t += FRAME) {
      while (si < script.length && script[si][0] <= t) script[si++][1](pl);
      pl.update(FRAME);
      pl.shapes();
      const n = pl.cur.hold ? 'idle' : pl.cur.name;
      if (seen.at(-1) !== n) seen.push(n);
    }
    return seen;
  };
  // mood.js: yawn transient (base yawning, 2.5 s), then asleep (base sleeping)
  assert.deepEqual(flow([[0, pl => pl.setBase('yawning')], [2500, pl => pl.setBase('sleeping')]], 6000), ['yawning', 'idle', 'sleeping']);
  // waking: base idle, then yawning, surprised, love
  const wake = flow([[0, pl => pl.setBase('sleeping')], [3000, pl => { pl.setBase('idle'); pl.play(['yawning', 'surprised', 'love']); }]], 9000);
  assert.deepEqual(wake.filter(n => n !== 'blink' && n !== 'breath' && n !== 'look_left' && n !== 'look_right').slice(0, 5), ['sleeping', 'yawning', 'surprised', 'love', 'idle']);
  // a turn ends while it needs you: surprised, then "Your turn"
  const turn = flow([[0, pl => pl.setBase(['surprised', 'curious'])], [2300, pl => { pl.setBase('happy_eyes'); pl.play('surprised'); }]], 5000);
  assert.deepEqual(turn.slice(-2), ['surprised', 'happy_eyes']);
  // fresh limits: jumping_joy, then happy
  assert.deepEqual(flow([[0, pl => { pl.setBase('happy'); pl.play('jumping_joy'); }]], 3000), ['jumping_joy', 'happy']);
});

// ---------- svg renderer (fake DOM) ----------

function fakeSvg() {
  let writes = 0;
  let created = 0;
  const el = tag => ({
    tag, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); writes++; },
    removeAttribute(k) { delete this.attrs[k]; writes++; },
    appendChild(c) { this.children.push(c); return c; },
  });
  const svg = el('svg');
  svg.ownerDocument = { createElementNS: (ns, tag) => { created++; return el(tag); } };
  return { svg, writes: () => writes, created: () => created };
}

test('the svg renderer reuses rects, skips unchanged attributes and hides unused rects', () => {
  const { svg, writes } = fakeSvg();
  const view = mountClawd(svg, { view: { x: -16, y: -28, w: 32, h: 32 } });
  assert.equal(svg.attrs.viewBox, '-16 -28 32 32');
  const p = rest();
  p.fx.push({ glyph: 'Z', x: 3, y: -14 });
  view.render(shapesAt(p));
  const g = svg.children[0];
  const n = g.children.length;
  assert.ok(n > 9);
  const w = writes();
  view.render(shapesAt(p));
  assert.equal(writes(), w, 'an unchanged frame writes nothing');
  view.render(shapesAt(rest()));
  assert.equal(g.children.length, n, 'no new elements');
  assert.equal(g.children.filter(r => r.attrs.display === 'none').length, n - 9);
  const body = g.children[4];
  assert.equal(body.attrs.fill, PALETTE.body);
  assert.equal(body.attrs['shape-rendering'], 'crispEdges');
  const q = rest();
  q.body.rot = 10;
  view.render(shapesAt(q));
  assert.equal(body.attrs['shape-rendering'], 'geometricPrecision');
  assert.match(body.attrs.transform, /^matrix\(/);
});

test('animating creates no DOM elements: the pool made at mount covers every clip and blend', () => {
  const { svg, created } = fakeSvg();
  const view = mountClawd(svg);
  const atMount = created();
  assert.equal(atMount, POOL_RECTS + 1); // the rects and their group
  const pl = new Player({ rand: lcg(5), idle: { movingPct: 60 } });
  let most = 0;
  for (const name of NAMES) {
    if (ANIMS[name].loop) pl.setBase(name); else pl.play(name);
    for (let t = 0; t < ANIMS[name].dur + 400; t += FRAME) {
      if (pl.update(FRAME)) { const s = pl.shapes(); most = Math.max(most, s.length); view.render(s); }
    }
  }
  assert.equal(created(), atMount, `rendered every clip and the blends between them (busiest frame ${most} rects) without creating an element`);
});

// ---------- rasterizer ----------

test('the rasterizer fills transformed rects with coverage and opacity', () => {
  const img = createImage(20, 20, '#000000');
  drawShapes(img, [{ x: 0, y: 0, w: 1, h: 1, fill: '#ff0000', m: [1, 0, 0, 1, 0, 0], o: 1 }], { view: { x: -1, y: -1 }, scale: 10 });
  const px = (x, y) => [...img.data.subarray((y * 20 + x) * 3, (y * 20 + x) * 3 + 3)];
  assert.deepEqual(px(15, 15), [255, 0, 0]);
  assert.deepEqual(px(5, 5), [0, 0, 0]);
  let red = 0;
  for (let i = 0; i < 400; i++) if (img.data[i * 3] === 255) red++;
  assert.equal(red, 100);
  drawShapes(img, [{ x: -1, y: -1, w: 2, h: 1, fill: '#0000ff', m: [1, 0, 0, 1, 0, 0], o: 0.5 }], { view: { x: -1, y: -1 }, scale: 10 });
  assert.deepEqual(px(5, 5), [0, 0, 128]);
});

test('working: Clawd types on the keyboard, not beside the laptop', () => {
  // The laptop's keyboard is the white base strip in front of the lid: x within ±3.15, y -2.65 .. -2.2.
  const KEYS = { x0: -3.15, x1: 3.15, top: -2.65, bottom: -2.2 };
  const paws = t => {
    const s = shapesAt(evalAnim('working', t, 1));
    return ['armL', 'armR'].map(part => bbox(s.find(x => x.part === part)));
  };
  // Throughout the loop both paws stay over the keyboard (the Enter wind-up lifts the right one, above it).
  for (let t = 0; t < ANIMS.working.dur; t += 20) {
    for (const [i, p] of paws(t).entries()) {
      assert.ok(p.x0 >= KEYS.x0 - 0.35 && p.x1 <= KEYS.x1 + 0.35, `t=${t} ${i ? 'right' : 'left'} paw x ${p.x0.toFixed(2)}..${p.x1.toFixed(2)} is over the keyboard`);
      assert.ok(p.y1 <= KEYS.bottom, `t=${t} ${i ? 'right' : 'left'} paw stays above the desk`);
    }
  }
  // On every keystroke (the burst at 60 ms, the left then the right paw) the striking paw reaches the keys.
  const [left] = paws(60 + 40), [, right] = paws(60 + 125 + 40);
  assert.ok(left.y1 >= KEYS.top - 0.05, `left paw touches the keys (bottom ${left.y1.toFixed(2)})`);
  assert.ok(right.y1 >= KEYS.top - 0.05, `right paw touches the keys (bottom ${right.y1.toFixed(2)})`);
});
