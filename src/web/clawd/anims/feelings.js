// Feelings: joy when a turn ends or limits reset, affection, and alarm when limits run out or things break.
// Owns: happy_eyes, happy, jumping_joy, celebration, love, overloaded, angry, error.
// Read ../ANIMATING.md first; base.js shows the style (walk, hop).
import { register, rest, defineGlyph, pixels, ease, keys, ramp, bump, osc, wobble, hopY, clamp, RIG, PALETTE } from '../core.js';

const { sineIn, sineOut, sineInOut, power2In, power2Out, power2InOut, power3In, power3Out, backOut } = ease;
const TAU = 2 * Math.PI;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// ---------- our glyphs ----------

defineGlyph('mouth_feel_zig', pixels(['.#.#.#', '#.#.#.'], { px: 0.35, ox: 3, oy: 1 })); // an overheated zigzag

// Heart eyes that read on the body: heart pink is almost the body's brightness (1.14:1), so the pink heart
// sits on an ink silhouette one pixel larger all round (the heart grown by one pixel, 0.3 units).
const HEART = ['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];
const HEART_RIM = ['..##.##..', '.#######.', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'];
defineGlyph('eye_feel_heart', [...pixels(HEART_RIM, { px: 0.3, ox: 4.5, oy: 4 }), ...pixels(HEART, { px: 0.3, ox: 3.5, oy: 3 })]);

// A bold x: two-pixel strokes that join, so it reads as an x at arm's length (the 3x3 x reads as a die's five).
defineGlyph('eye_feel_x', pixels(['##..##', '.####.', '..##..', '.####.', '##..##'], { px: 0.33, ox: 3, oy: 2.5 }));

// A small round puff (2 x 1.4): the core's small steam has half-width caps, so small it reads as a "+".
defineGlyph('feel_puff', pixels(['.gggg.', 'gggggg', 'gggggg', '.gggg.'], { px: 0.34, ox: 3, oy: 2 }));

// ---------- shared helpers ----------

// Feet stay where they stood while the body shifts its weight: each leg leans so its foot keeps its rest x.
function plant(p) {
  const b = p.body;
  const c = Math.cos(b.rot * RAD);
  const s = Math.sin(b.rot * RAD);
  for (let i = 0; i < 4; i++) {
    const hx = RIG.legs[i].pivot[0];
    const x = b.x + c * hx * b.sx;
    const h = 2 - b.y - s * hx * b.sx; // the hip's height above the ground
    p.legs[i].rot += Math.atan2(hx - x, h) * DEG;
  }
}

// A puff of steam: pops in, rises and drifts on sineOut, swells, and thins away late and quickly (a slow
// fade would leave a dark smudge hanging on the near-black stage). World space.
function puff(p, glyph, age, life, x0, y0, dx, rise, s0, s1, o = 0.95) {
  if (age <= 0 || age >= life) return;
  const k = age / life;
  const up = sineOut(k);
  p.fx.push({
    glyph, space: 'world', x: x0 + dx * up, y: y0 - rise * up,
    s: s0 + (s1 - s0) * power2Out(k),
    o: o * ramp(age, 0, 70, sineOut) * (1 - ramp(k, 0.5, 1, power2In)),
  });
}

// ---------- happy_eyes ("Your turn"): ^ ^ eyes, the checkered flag waved overhead, a planted sway ----------
// The flag arm sits raised on the body's top corner, as in the reference. The fist rocks side to side and
// the pole's tip lags the other way (the pole pivots in the fist); the cloth ripples through flag1..4, eight
// shapes per wave. The body sways over planted feet and dips as it passes the middle; the free arm trails
// the sway, the eyes lead it, and the unweighted outer foot taps up at each end.

const HE = { dur: 2640, wave: 880, sway: 1320, step: 110 };
const FLAGS = ['flag1', 'flag2', 'flag3', 'flag4'];

function happyEyesPose(t) {
  const p = rest();
  const sw = osc(t, HE.sway);
  const w = (TAU * t) / HE.wave;
  const mid = Math.cos((TAU * t) / HE.sway) ** 2; // 1 as the body passes the middle
  p.body.rot = 3.5 * sw;
  p.body.x = 0.22 * osc(t, HE.sway, -0.04);
  p.body.y = 0.2 * mid;
  p.body.sy = 1 - 0.025 * mid;
  plant(p);
  p.legs[0].lift = 0.4 * Math.max(0, sw) ** 3;
  p.legs[3].lift = 0.4 * Math.max(0, -sw) ** 3;

  // The flag arm: slid up onto the body's top corner and sunk a little into it, not turned, so the nub
  // stays square and a blend in or out slides it up or down the side. The fist rocks on an arc (it dips
  // at each end) and the pole's tip swings the other way, a beat behind.
  const sw1 = Math.sin(w);
  p.armR.rot = 3 * Math.sin(w - 0.4);
  p.armR.x = -2 - 0.75 * sw1;
  p.armR.y = -5.4 - 0.18 * Math.sin(2 * w - 0.6) + 0.3 * sw1 * sw1;
  // blend: 'grow': on entry the flag grows up out of the fist, and on exit shrinks back into it, instead of
  // ghosting in and out grey (a fading flag shows its ink checks through the white cloth).
  p.props.push({
    glyph: FLAGS[Math.floor(t / HE.step) % 4], id: 'feel_flag', on: 'armR', x: 7, y: -5, upright: true,
    rot: 13 * Math.sin(w - 0.9), s: 1.25, blend: 'grow',
  });

  // The free arm trails the sway; the eyes lead it.
  p.armL.rot = 7 * osc(t, HE.sway, -0.12);
  p.armL.y = 0.2 * osc(t, HE.sway / 2, -0.1);
  p.eyes.style = 'happy';
  p.eyes.x = 0.35 * osc(t, HE.sway, 0.06);
  p.eyes.sy = 1 - 0.12 * mid;
  return p;
}
register('happy_eyes', { dur: HE.dur, loop: true, grounded: true, pose: happyEyesPose });

// ---------- happy: ^ ^ eyes, a bouncy groove ----------
// Two knee bounces with a tilt to alternate sides, a deeper crouch that pops a small hop, the landing and
// a shimmy. The arms flap up as the body drops (they lag it) and settle as it rises; the right arm is a
// beat behind the left. The loop starts and ends standing tall, so it blends in from rest.

const HAPPY_DUR = 2400;
const HAPPY_HOP = { t0: 1450, up: 220, down: 130, h: 1.5 }; // lands at 1800
const HAPPY_BODY_Y = [
  [0, 0], [150, 0.5, power2Out], [230, 0.5], [420, -0.15, sineOut], [600, 0, sineInOut],
  [750, 0.5, power2Out], [830, 0.5], [1020, -0.15, sineOut], [1200, 0, sineInOut],
  [1380, 0.7, power2Out], [1430, 0.7], [1490, 0, power2In],
  [1800, 0], [1850, 0.35, power2Out], [2050, -0.1, sineOut], [2250, 0, sineInOut],
];
const HAPPY_SQUASH = [
  [0, 0], [1340, 0], [1440, -0.08, power2Out], [1500, 0.12, power2Out], [1640, 0, sineInOut],
  [1790, 0.05, power2In], [1850, -0.14, power2Out], [2010, 0.03, sineOut], [2160, 0, sineInOut],
];
const HAPPY_TILT = [
  [0, 0], [300, -3], [600, 0], [900, 3], [1200, 0], [1420, -1.5], [1650, 3.5, sineOut], [1800, 0, power2In],
  [1920, -2.2, sineOut], [2040, 1.8], [2160, -1], [2280, 0.4], [2400, 0],
];
const HAPPY_ARM = [
  [0, 0], [150, 14, power2Out], [330, -5, sineInOut], [600, 0, sineInOut],
  [750, 14, power2Out], [930, -5, sineInOut], [1200, 0, sineInOut],
  [1400, -12, power2Out], [1540, 28, power2Out], [1700, 24, sineInOut], [1800, 30, sineIn],
  [1890, -14, power2In], [2170, 0, backOut],
];
const HAPPY_ARM_Y = [
  [0, 0], [150, -0.4, power2Out], [330, 0.2, sineInOut], [600, 0, sineInOut],
  [750, -0.4, power2Out], [930, 0.2, sineInOut], [1200, 0, sineInOut],
  [1400, 0.5, power2Out], [1540, -2.4, power2Out], [1800, -2.6, sineIn], [1890, 0.6, power2In], [2170, 0, backOut],
];
const HAPPY_TUCK = [[0, 0], [1470, 0], [1580, 1, power2Out], [1700, 1], [1800, 0, power2In]];
const HAPPY_SPLAY = [-9, -3, 3, 9];
const wrap = (t, d) => ((t % d) + d) % d;

function happyPose(t) {
  const p = rest();
  p.root.y = hopY(t, HAPPY_HOP.t0, HAPPY_HOP.up, HAPPY_HOP.down, HAPPY_HOP.h);
  const s = keys(t, HAPPY_SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  const dip = keys(t, HAPPY_BODY_Y);
  p.body.y = dip;
  p.body.sy = 1 - 0.06 * Math.max(0, dip) + 0.1 * Math.max(0, -dip);
  p.body.sx = 1 + 0.04 * Math.max(0, dip);
  p.body.rot = keys(t, HAPPY_TILT);
  const lag = wrap(t - 50, HAPPY_DUR);
  p.armL.rot = keys(t, HAPPY_ARM);
  p.armR.rot = keys(lag, HAPPY_ARM);
  p.armL.y = keys(t, HAPPY_ARM_Y);
  p.armR.y = keys(lag, HAPPY_ARM_Y);
  const tuck = keys(t, HAPPY_TUCK);
  for (let i = 0; i < 4; i++) {
    p.legs[i].lift = 0.35 * tuck;
    p.legs[i].rot = HAPPY_SPLAY[i] * tuck;
  }
  p.eyes.style = 'happy';
  p.eyes.sy = 1 - 0.3 * Math.max(0, dip);
  p.eyes.y = 0.2 * Math.max(0, dip) - 0.35 * bump(t, HAPPY_HOP.t0, HAPPY_HOP.t0 + HAPPY_HOP.up + HAPPY_HOP.down);
  return p;
}
register('happy', { dur: HAPPY_DUR, loop: true, pose: happyPose });

// ---------- jumping_joy: fresh limits! a big jump, arms flung up ----------
// A deep crouch winds up; the launch stretches; the rise eases out (sineOut, 440 ms) to a 7.5-unit apex where
// it hangs, flutters its hands and sparkles; the fall eases in (power3In, 220 ms), stretching again; the
// landing squashes hard. The arms trail the launch, drag on the way down, slam past rest on contact and
// spring back (backOut): the weight. The legs tuck and splay in the air and reach for the floor. It ends
// as soon as the landing settles, so happy's groove takes over without a dead beat.

const J = { dur: 1230, t0: 240, up: 440, down: 220, h: 7.5 };
const JL = J.t0 + J.up + J.down; // 900: touchdown
const J_SQUASH = [
  [0, 0], [200, -0.2, power2Out], [J.t0, -0.2], [J.t0 + 70, 0.2, power2Out], [J.t0 + J.up - 40, 0, sineInOut],
  [JL, 0.12, power2In], [JL + 60, -0.28, power2Out], [JL + 180, 0.05, power2Out], [JL + 300, 0, sineInOut],
];
// Arms stay under ~30°: a 2x2 nub turned further reads as a diamond. Height comes from sliding (J_ARM_Y).
const J_ARM = [
  [0, 0], [200, -18, power2Out], [J.t0, -18], [J.t0 + 130, 26, power2Out], [J.t0 + J.up - 40, 22, sineInOut],
  [JL, 30, sineIn], [JL + 90, -24, power2In], [J.dur - 80, 0, backOut],
];
const J_ARM_Y = [
  [0, 0], [200, 0.6, power2Out], [J.t0, 0.6], [J.t0 + 140, -3, power2Out], [J.t0 + J.up - 40, -2.7, sineInOut],
  [JL, -3.2, sineIn], [JL + 90, 1, power2In], [J.dur - 80, 0, backOut],
];
const J_TUCK = [[0, 0], [J.t0 + 30, 0], [J.t0 + 180, 1, power2Out], [JL - 130, 1], [JL, 0, power2In]];
const J_SPLAY = [-14, -5, 5, 14];
const J_SPARKS = [[-9.5, -17, 600], [9.5, -16, 660], [0, -21, 720]]; // world x, y, pop time (the apex is at 680)

function jumpingJoyPose(t, ctx) {
  const p = rest();
  p.root.y = hopY(t, J.t0, J.up, J.down, J.h);
  const s = keys(t, J_SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  p.body.rot = ctx.side * 6 * bump(t, J.t0 + 60, JL - 40);
  const flutter = 5 * bump(t, J.t0 + 160, JL - 100) * Math.sin((TAU * t) / 150);
  p.armL.rot = keys(t, J_ARM) + flutter;
  p.armR.rot = keys(t, J_ARM) - flutter;
  p.armL.y = p.armR.y = keys(t, J_ARM_Y);
  const tuck = keys(t, J_TUCK);
  for (let i = 0; i < 4; i++) {
    p.legs[i].lift = 0.6 * tuck;
    p.legs[i].rot = J_SPLAY[i] * tuck;
  }
  // ^ ^ from the launch to the very end: a chained clip ends on its successor's first pose, and happy
  // starts at rest with ^ ^ eyes, so the eyes never flash open at the handover.
  p.eyes.style = t > J.t0 - 30 ? 'happy' : 'open';
  p.eyes.sy = 1 - 0.3 * bump(t, 60, J.t0 + 20) - 0.3 * bump(t, JL, JL + 220);
  p.eyes.y = -0.35 * bump(t, J.t0, JL) + 0.2 * bump(t, JL, JL + 220);
  const grin = ramp(t, J.t0 + 20, J.t0 + 110, backOut) * (1 - ramp(t, JL + 150, JL + 230, sineIn));
  if (grin > 0.01) p.mouth = { style: 'smile', x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: grin }; // faded, not scaled: no speck
  for (let i = 0; i < J_SPARKS.length; i++) {
    const sp = J_SPARKS[i];
    const a = t - sp[2];
    if (a <= 0 || a >= 300) continue;
    p.fx.push({ glyph: 'spark_small', space: 'world', x: sp[0], y: sp[1], s: 1.4 * (a < 90 ? backOut(a / 90) : 1 - sineIn((a - 90) / 210)), rot: a * 0.2 });
  }
  return p;
}
register('jumping_joy', { dur: J.dur, next: 'happy', pose: jumpingJoyPose });

// ---------- celebration: two fist pumps, confetti bursting from both hands at each peak ----------
// A dip winds up; the first pump throws both arms up with a small hop, and at the arms' peak confetti bursts
// out of both hands in two fans. It lands, dips, and pumps again (grounded, rising on its toes) for the
// second burst, then shakes its fists at the sky and lowers them with a back-out settle. Confetti is shot
// fast, air drag slows it, then it flutters down at a gentle terminal speed, tumbling and spinning, and
// shrinks away before the clip hands over to happy (it cannot outlive the clip).

const C = { dur: 2000, peak1: 380, peak2: 900 };
const C_HOP = { t0: 230, up: 190, down: 130, h: 1.8 }; // apex 420, lands 550
const C_ARM = [
  [0, 0], [200, -16, power2Out], [C.peak1, 30, power3Out], [470, 25, sineInOut], [600, -12, power2In], [680, -8, sineOut],
  [C.peak2, 30, power3Out], [1000, 24, sineInOut], [1280, 26, sineInOut], [1580, -8, power2InOut], [1840, 0, backOut],
];
const C_ARM_Y = [
  [0, 0], [200, 0.6, power2Out], [C.peak1, -3.2, power3Out], [470, -2.9, sineInOut], [600, 0.7, power2In], [680, 0.5],
  [C.peak2, -3.2, power3Out], [1280, -3, sineInOut], [1580, 0.4, power2InOut], [1840, 0, backOut],
];
const C_BODY_Y = [
  [0, 0], [200, 0.45, power2Out], [240, 0.45], [290, 0, power2In], [600, 0], [690, 0.4, power2Out],
  [C.peak2, -0.25, power2Out], [1280, -0.2], [1560, 0.15, sineInOut], [1800, 0, sineInOut],
];
const C_SQUASH = [
  [0, 0], [200, -0.06, power2Out], [240, -0.06], [300, 0.12, power2Out], [430, 0, sineInOut], [540, 0.05, power2In],
  [590, -0.17, power2Out], [760, 0, backOut],
];
const C_WIGGLE = [[0, 0], [C.peak2 + 60, 0], [1000, 1], [1240, 1], [1320, 0]];
// Confetti: 6 pieces per side per burst. Launch points are the hands at each peak (world units).
const C_BURSTS = [{ at: C.peak1, x: 7.6, y: -10.8, life: 1450 }, { at: C.peak2, x: 7.6, y: -9.4, life: 1020 }];
const C_PIECES = 6;

// One piece. Linear air drag: it shoots out along its fan line, slows over tau, then falls at a terminal
// speed vt with a flutter. The fan spans from a little inward (over the head) to nearly flat outward, and
// the kick is an ellipse (tall, narrow), so a burst opens as an arc of pieces instead of a clump. Every
// number comes from the seed: a replay is identical, the next celebration differs.
const C_FAN = [-18, 88]; // degrees from vertical: inner edge (toward the head) .. outer edge
function confetti(p, ctx, key, age, life, x0, y0, side, i) {
  if (age <= 0 || age >= life) return;
  const r = ctx.rnd;
  const q = key * 16; // this piece's stream of seeded numbers: r(q), r(q + 1), ...
  const phi = (C_FAN[0] + (C_FAN[1] - C_FAN[0]) * ((i + 0.15 + 0.7 * r(q)) / C_PIECES)) * RAD;
  const kick = 0.8 + 0.3 * r(q + 1);
  const reach = 5 * kick * Math.sin(phi);              // horizontal travel before drag stops it (x stays within ±14)
  const rise = 12 * kick * Math.cos(phi) + 1.5;        // vertical kick, before gravity eats into it
  const tau = 0.2 + 0.07 * r(q + 2);                   // drag time constant, s
  const vt = 6 + 3 * r(q + 3);                         // terminal fall, units/s
  const T = age / 1000;
  const k = 1 - Math.exp(-T / tau);
  const flutter = (0.25 + 0.4 * r(q + 4)) * ramp(T, 0.25, 0.6) * Math.sin((6 + 4 * r(q + 5)) * T + TAU * r(q + 6));
  const x = x0 + side * reach * k + flutter;
  const y = y0 - rise * k + vt * (T - tau * k);
  const spin = (400 + 500 * r(q + 7)) * (r(q + 8) < 0.5 ? -1 : 1);
  const tumble = 0.3 + 0.7 * Math.abs(Math.cos((8 + 6 * r(q + 9)) * T + TAU * r(q + 10)));
  p.fx.push({
    glyph: 'confetti', space: 'world', x, y, rot: 180 * r(q + 11) + spin * T, sx: 0.9 + 0.3 * r(q + 12), sy: tumble,
    // It pops in and, at the end, shrinks away still bright (a fade would muddy it on the dark stage).
    s: ramp(age, 0, 60, power2Out) * (1 - ramp(age, life - 420, life, power2In)), fill: PALETTE.confetti[(i + key) % 5], z: i % 3 === 0 ? -1 : 1,
    o: 1 - ramp(age, life - 140, life, sineIn),
  });
}

function celebrationPose(t, ctx) {
  const p = rest();
  p.root.y = hopY(t, C_HOP.t0, C_HOP.up, C_HOP.down, C_HOP.h);
  const s = keys(t, C_SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  const by = keys(t, C_BODY_Y);
  p.body.y = by;
  p.body.sy = 1 + 0.08 * Math.max(0, -by) - 0.05 * Math.max(0, by);
  const wig = keys(t, C_WIGGLE);
  p.body.rot = ctx.side * 3 * bump(t, C.peak2 - 100, 1500) + 1.5 * wig * Math.sin((TAU * t) / 240);
  const shake = 5 * wig * Math.sin((TAU * t) / 120);
  p.armL.rot = keys(t, C_ARM) + shake;
  p.armR.rot = keys(wrap(t - 40, C.dur), C_ARM) - shake;
  p.armL.y = keys(t, C_ARM_Y);
  p.armR.y = keys(wrap(t - 40, C.dur), C_ARM_Y);
  const tuck = bump(t, C_HOP.t0 + 20, C_HOP.t0 + C_HOP.up + C_HOP.down - 10);
  for (let i = 0; i < 4; i++) {
    p.legs[i].lift = 0.35 * tuck;
    p.legs[i].rot = HAPPY_SPLAY[i] * tuck;
  }
  p.eyes.style = t > 150 ? 'happy' : 'open'; // ^ ^ to the end: it hands over to happy's first pose (rest, ^ ^)
  p.eyes.sy = 1 - 0.3 * bump(t, 40, 240) - 0.25 * bump(t, 560, 720);
  p.eyes.y = -0.3 * (bump(t, 280, 560) + bump(t, 760, 1300));
  for (let bi = 0; bi < C_BURSTS.length; bi++) {
    const b = C_BURSTS[bi];
    const age = t - b.at;
    if (age <= 0 || age >= b.life) continue;
    for (let i = 0; i < C_PIECES; i++) {
      const a = age - 12 * (i % 3); // a ragged burst, not one frame of spawn
      confetti(p, ctx, bi * 20 + i, a, b.life, -b.x, b.y, -1, i);
      confetti(p, ctx, bi * 20 + 10 + i, a, b.life, b.x, b.y, 1, i);
    }
    if (age < 200) {
      const k = age < 70 ? backOut(age / 70) : 1 - sineIn((age - 70) / 130);
      p.fx.push({ glyph: 'spark_small', space: 'world', x: -b.x, y: b.y, s: 1.3 * k });
      p.fx.push({ glyph: 'spark_small', space: 'world', x: b.x, y: b.y, s: 1.3 * k });
    }
  }
  return p;
}
register('celebration', { dur: C.dur, next: 'happy', pose: celebrationPose });

// ---------- love: heart eyes, a small bounce, a heartbeat, hearts floating up ----------
// The eyes squeeze shut and pop open as hearts (back-out); a small hop; the heart eyes beat lub-dub twice
// while the body leans into a dreamy swoon, arms lifted; three hearts pop up, keep rising with a sway, and
// shrink away. A last squeeze turns the eyes back, and it settles at rest.

const LV = { dur: 1800 };
const LOVE_HOP = { t0: 170, up: 180, down: 110, h: 1.2 }; // lands at 460
const LOVE_SHUT = [[0, 0], [80, 1, power2In], [110, 1], [200, 0, power2Out], [1560, 0], [1630, 1, power2In], [1660, 1], [1760, 0, power2Out]];
const LOVE_PULSE = [
  [0, 0], [110, 0], [240, 0.35, power2Out], [400, 0, sineInOut],
  [700, 0], [760, 0.3, power2Out], [840, 0.04, sineIn], [900, 0.22, power2Out], [1030, 0, sineInOut],
  [1200, 0], [1260, 0.28, power2Out], [1340, 0.04, sineIn], [1400, 0.2, power2Out], [1530, 0, sineInOut],
];
const LOVE_SQUASH = [[0, 0], [150, -0.08, power2Out], [200, 0.08, power2Out], [330, 0, sineInOut], [450, 0.04, power2In], [490, -0.13, power2Out], [650, 0, backOut]];
const LOVE_SWOON = [[0, 0], [480, 0], [850, 1, sineInOut], [1300, 1], [1700, 0, sineInOut]];
const LOVE_ARMS = [[0, 0], [170, -8, power2Out], [300, 18, power2Out], [480, 14, sineInOut], [1400, 16], [1720, 0, sineInOut]];
const LOVE_ARMS_Y = [[0, 0], [170, 0.3, power2Out], [300, -1.6, power2Out], [1400, -1.5], [1720, 0, sineInOut]];
// x, y, start, size. All pop from just above the head, so the later ones trail the first: a rising cascade.
const LOVE_HEARTS = [[-3.4, -11.8, 220, 0.9], [3.8, -11.8, 430, 1], [0.2, -11.8, 640, 0.75]];

function lovePose(t, ctx) {
  const p = rest();
  p.root.y = hopY(t, LOVE_HOP.t0, LOVE_HOP.up, LOVE_HOP.down, LOVE_HOP.h);
  const s = keys(t, LOVE_SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  const pulse = keys(t, LOVE_PULSE);
  const swoon = keys(t, LOVE_SWOON);
  p.body.rot = ctx.side * 4 * swoon + 1.2 * swoon * Math.sin((TAU * (t - 480)) / 900);
  p.body.sx = 1 + 0.05 * pulse;
  p.body.sy = 1 + 0.05 * pulse;
  const arm = keys(t, LOVE_ARMS) + 8 * pulse;
  p.armL.rot = arm + ctx.side * 4 * swoon;
  p.armR.rot = arm - ctx.side * 4 * swoon;
  p.armL.y = p.armR.y = keys(t, LOVE_ARMS_Y);
  const shut = keys(t, LOVE_SHUT);
  p.eyes.style = t > 95 && t < 1645 ? 'feel_heart' : 'open';
  p.eyes.sx = (1 + pulse) * (1 + 0.3 * shut);
  p.eyes.sy = (1 + pulse) * (1 - 0.82 * shut);
  p.eyes.y = 0.45 * shut;
  p.eyes.x = 0.3 * ctx.side * swoon; // the eyes drift into the swoon
  // Each heart pops up out of the head, then keeps rising at a steady drift (it never parks), swaying,
  // and shrinks away at the top instead of fading in place.
  for (let i = 0; i < LOVE_HEARTS.length; i++) {
    const [x0, y0, at, size] = LOVE_HEARTS[i];
    const a = t - at;
    if (a <= 0 || a >= 1080) continue;
    const k = a / 1080;
    const sway = 0.7 * Math.sin(TAU * (a / 760) + i * 2) * ramp(a, 0, 200);
    p.fx.push({
      glyph: 'heart', space: 'world', x: x0 + sway + ctx.range(i, -0.6, 0.6),
      y: y0 - 2.5 * sineOut(Math.min(1, 4 * k)) - 7 * k,
      s: size * (a < 220 ? backOut(a / 220, 2.2) : 1) * (1 - ramp(k, 0.72, 1, power2In)),
      rot: 8 * Math.sin(TAU * (a / 760) + i * 2 + 0.8),
      o: 1 - ramp(k, 0.9, 1),
    });
  }
  return p;
}
register('love', { dur: LV.dur, pose: lovePose });

// ---------- overloaded (limit reached): red flush, a pressure build, steam, x eyes ----------
// A slow cycle a desk can live with (this state never sleeps): it pants, flushed, with a wisp of steam
// simmering off its head; the pressure builds, the body swells and flushes deeper and starts to shake;
// a hiss of steam escapes; then it vents, pfft, two big puffs out of both top corners, the arms jerk up,
// the body deflates and settles with a wobble, and the panting calm starts over.

const OV = { dur: 3600, pop: 1800, shake: 180, pant: 1200 };
const OV_P = [[0, 0], [OV.pop, 1, sineIn], [OV.pop + 80, -0.35, power2Out], [2250, 0.08, sineInOut], [2700, 0, sineInOut]];
const OV_FLING = [[0, 0], [OV.pop, 0], [OV.pop + 80, 1, power3Out], [2000, 0.8, sineInOut], [2600, 0, backOut]];

function overloadedPose(t, ctx) {
  const p = rest();
  const P = keys(t, OV_P);
  const A = 0.7 * clamp(P) ** 1.5; // the shake: none in the calm, growing with the pressure
  const pant = osc(t, OV.pant);
  p.tint = { color: PALETTE.flush, k: 0.5 + 0.3 * P };
  p.body.sx = 1 + 0.05 * P;
  p.body.sy = 1 + 0.08 * P + 0.035 * pant;
  p.body.x = 0.4 * A * osc(t, OV.shake);
  p.body.rot = 2.6 * A * osc(t, 2 * OV.shake, 0.3) + 2.2 * wobble(t - OV.pop - 60, 260, 220);
  plant(p);
  const fling = keys(t, OV_FLING);
  p.armL.rot = -10 * clamp(P) + 4 * A * osc(t, OV.shake, 0.5) + 26 * fling;
  p.armR.rot = -10 * clamp(P) + 4 * A * osc(t, OV.shake, 0.25) + 24 * fling;
  p.armL.y = p.armR.y = -1.6 * fling + 0.25 * osc(t, OV.pant, -0.12); // the arms ride the pant, a beat late
  p.eyes.style = 'feel_x';
  const pop = bump(t, OV.pop, OV.pop + 240);
  p.eyes.sx = p.eyes.sy = 1 + 0.25 * pop;
  p.mouth = { style: 'feel_zig', x: 0, y: 0.1, rot: 0, sx: 1, sy: 1 + 0.4 * pop, o: 1 };
  const top = -10 - 8 * 0.08 * clamp(P); // the head's top, swollen
  const sd = ctx.side;
  puff(p, 'feel_puff', t - 900, 650, sd * 5.4, top - 0.4, sd * 1.2, 3, 0.5, 1, 0.8);        // a hiss escapes
  puff(p, 'steam_big', t - OV.pop, 1150, -5.6, -10.8, -2.2, 6, 0.6, 1.5);               // pfft, both corners
  puff(p, 'steam_big', t - OV.pop - 30, 1150, 5.6, -10.8, 2.2, 6, 0.6, 1.5);
  puff(p, 'feel_puff', t - OV.pop - 160, 900, -4.8, -10.6, -1, 4.2, 0.5, 1.1, 0.85);        // and the trailing wisps
  puff(p, 'feel_puff', t - OV.pop - 200, 900, 4.8, -10.6, 1, 4.2, 0.5, 1.1, 0.85);
  puff(p, 'feel_puff', wrap(t - 2900, OV.dur), 1500, 0.4 * sd, top - 0.2, sd, 5, 0.5, 1.15, 0.7); // the simmer, across the seam
  return p;
}
register('overloaded', { dur: OV.dur, loop: true, grounded: true, pose: overloadedPose });

// ---------- angry: > < eyes, two stomps, a steaming huff ----------
// It leans away and lifts the left pair of feet, fists wound up, then stomps (power3In) and the fists slam
// down; the other side; then a huff: a shiver, fists pumping, steam jetting sideways out of both sides of
// the head (out of the "ears"; only overloaded plumes upward, so the two never look alike). A flush rises
// with each stomp and the huff and ebbs in the calm before the loop.

const AN = { dur: 2400 };
const AN_LIFT_L = [[0, 0], [200, 1, power2Out], [330, 1.1, sineOut], [420, 0, power3In]];
const AN_LIFT_R = [[0, 0], [600, 0], [800, 1, power2Out], [930, 1.1, sineOut], [1020, 0, power3In]];
const AN_LEAN = [
  [0, 0], [250, 5, sineOut], [400, 4.4], [430, -2.4, power3In], [560, 0.7, sineOut], [700, 0, sineInOut],
  [850, -5, sineOut], [1000, -4.4], [1030, 2.4, power3In], [1160, -0.7, sineOut], [1300, 0, sineInOut],
];
const AN_SQUASH = [[0, 0], [420, 0], [450, -0.1, power2Out], [600, 0, backOut], [1020, 0], [1050, -0.1, power2Out], [1200, 0, backOut]];
const AN_FIST = [
  [0, 0], [300, 16, power2Out], [430, -22, power3In], [620, -6, sineOut],
  [900, 16, power2Out], [1030, -22, power3In], [1220, -6, sineOut], [1450, -4], [2000, -6], [2400, 0, sineInOut],
];
const AN_HUFF = [[0, 0], [1420, 0], [1520, 1, power2Out], [1850, 1], [2050, 0, sineInOut]];
const AN_HEAT = [[0, 0], [420, 0], [470, 1, power2Out], [760, 0.3], [1020, 0.3], [1070, 1, power2Out], [1360, 0.4], [1520, 1.2, power2Out], [1900, 1], [2400, 0, sineInOut]];
// Steam jets out of the side of the head at eye level, shot outward: [time, side]. One with each stomp
// (on the stomping side), then the huff's two double blasts.
const AN_JETS = [[440, -1], [1040, 1], [1520, -1], [1540, 1], [1700, -1], [1720, 1]];
const jet = (p, age, side) => puff(p, 'feel_puff', age, 460, side * 6.4, -7.2, side * 3.6, 0.9, 0.55, 1.15, 0.95);

function angryPose(t, ctx) {
  const p = rest();
  const huff = keys(t, AN_HUFF);
  p.root.sy = 1 + keys(t, AN_SQUASH);
  p.root.sx = 1 - 0.5 * keys(t, AN_SQUASH);
  p.body.rot = keys(t, AN_LEAN) + 2.2 * huff * osc(t, 100);
  p.body.x = 0.12 * huff * osc(t, 100, 0.25);
  plant(p);
  const lL = keys(t, AN_LIFT_L);
  const lR = keys(t, AN_LIFT_R);
  p.legs[0].lift += 0.95 * lL; p.legs[1].lift += 0.85 * lL;
  p.legs[0].rot -= 10 * lL; p.legs[1].rot -= 5 * lL;
  p.legs[2].lift += 0.85 * lR; p.legs[3].lift += 0.95 * lR;
  p.legs[2].rot += 5 * lR; p.legs[3].rot += 10 * lR;
  const fist = keys(t, AN_FIST);
  const pump = 14 * huff * osc(t, 180);
  p.armL.rot = fist + pump;
  p.armR.rot = fist - pump;
  p.armL.y = p.armR.y = 0.3 * huff;
  const heat = keys(t, AN_HEAT);
  p.tint = { color: PALETTE.flush, k: 0.12 + 0.3 * heat };
  p.eyes.style = 'squint';
  p.eyes.y = 0.3;
  p.eyes.sy = 1 - 0.15 * bump(t, 420, 560) - 0.15 * bump(t, 1020, 1160);
  p.mouth = { style: 'frown', x: 0, y: 0.2, rot: 0, sx: 1, sy: 1, o: 1 };
  for (let i = 0; i < AN_JETS.length; i++) jet(p, t - AN_JETS[i][0], AN_JETS[i][1]);
  // Dust kicked out from under the stomping feet, low and sideways.
  puff(p, 'feel_puff', t - 425, 420, -5.6, -0.6, -1.8, 0.8, 0.55, 1.05, 0.6);
  puff(p, 'feel_puff', t - 425, 420, -2, -0.6, 1.3, 0.6, 0.45, 0.85, 0.5);
  puff(p, 'feel_puff', t - 1025, 420, 5.6, -0.6, 1.8, 0.8, 0.55, 1.05, 0.6);
  puff(p, 'feel_puff', t - 1025, 420, 2, -0.6, -1.3, 0.6, 0.45, 0.85, 0.5);
  return p;
}
register('angry', { dur: AN.dur, loop: true, grounded: true, pose: angryPose });

// ---------- error: x eyes and a glitch ----------
// Mostly a dazed stillness. Three times a loop, at an uneven rhythm, the signal breaks for a few frames:
// the figure jumps sideways, horizontal slices of the body slide out of register (the eyes going with
// theirs), the colour channels split into red and blue fringes, and the body flashes red. Glitches cut
// (they are digital); the recovery is eased: a shake of the head after the first two bursts.

const ER = { dur: 2000 };
// [from, to, jump x, slice index or -1, red flash k, chroma split]
// Three bursts at an uneven rhythm: a long one, a medium one, an aftershock.
const ER_FRAMES = [
  [250, 290, 0.8, 0, 0, 1],
  [290, 330, -0.6, 1, 0, 0],
  [330, 370, 0.35, 2, 0, 1],
  [370, 410, 0, -1, 0.75, 0],
  [410, 440, -0.25, -1, 0.35, 0],
  [1180, 1220, -0.7, 2, 0, 1],
  [1220, 1260, 0.4, -1, 0.8, 0],
  [1640, 1670, 0.45, 0, 0, 1],
];
const ER_SLICES = [
  { y: -4.2, h: 1.6, dx: 1.6 },
  { y: -10, h: 1.2, dx: -1.3 },
  { y: -8.25, h: 2.5, dx: 1.1, eyes: true },
];

function errorPose(t) {
  const p = rest();
  p.eyes.style = 'feel_x';
  // Dazed between bursts: slumped a little, arms hanging, a slow woozy sway; a shake of the head after each burst.
  const daze = osc(t, ER.dur, 0.1);
  p.body.y = 0.12;
  const shakeOff = 3 * wobble(t - 450, 170, 170) - 2 * wobble(t - 1270, 170, 140) * (1 - ramp(t, 1600, 1950));
  p.body.rot = 1.4 * daze + shakeOff;
  p.armL.rot = -6 + 3 * osc(t, ER.dur, 0.02);
  p.armR.rot = -6 - 3 * osc(t, ER.dur, 0.02);
  p.eyes.x = 0.25 * daze + 0.3 * wobble(t - 470, 200, 150);
  let f = null;
  for (let i = 0; i < ER_FRAMES.length; i++) if (t >= ER_FRAMES[i][0] && t < ER_FRAMES[i][1]) { f = ER_FRAMES[i]; break; }
  if (!f) return p;
  const jx = f[2];
  const si = f[3];
  const flash = f[4];
  const chroma = f[5];
  p.root.x = jx;
  if (flash > 0) p.tint = { color: PALETTE.flush, k: flash };
  if (chroma) {
    p.fx.push({ glyph: 'block', space: 'body', x: -6.6, y: -10, sx: 12, sy: 8, fill: PALETTE.flush, z: -1 });
    p.fx.push({ glyph: 'block', space: 'body', x: -5.4, y: -10, sx: 12, sy: 8, fill: PALETTE.blue, z: -1 });
  }
  if (si >= 0) {
    const s = ER_SLICES[si];
    p.fx.push({ glyph: 'block', space: 'body', x: -6 + s.dx, y: s.y, sx: 12, sy: s.h, z: 0 });
    p.fx.push({ glyph: 'block', space: 'body', x: s.dx > 0 ? -6 : 6 + s.dx, y: s.y, sx: Math.abs(s.dx), sy: s.h, fill: PALETTE.stage, z: 0 });
    if (s.eyes) {
      p.fx.push({ glyph: 'eye_feel_x', space: 'body', x: -3.5 + s.dx, y: -7, z: 0 });
      p.fx.push({ glyph: 'eye_feel_x', space: 'body', x: 3.5 + s.dx, y: -7, z: 0 });
    }
  }
  return p;
}
register('error', { dur: ER.dur, loop: true, grounded: true, pose: errorPose });
