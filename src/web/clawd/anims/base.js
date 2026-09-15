// Base animations: Clawd at rest and the idle life the Player's calm idle draws on.
// Owns: idle, blink, look_left, look_right, walk, hop, and the internal breath.
// These set the house style: every part moves on its own eased curve, offset from its neighbours
// (eyes lead, the body follows, arms trail and overshoot); nothing is linear; clips start and end at rest.
import { register, rest, ease, keys, ramp, bump, wobble, ramped, hopY } from '../core.js';

const { sineIn, sineOut, sineInOut, power2In, power2Out, power2InOut, power3Out, backOut } = ease;

// ---------- idle: the rest pose (while the base is idle the Player holds rest and adds calm idle) ----------

register('idle', { dur: 2000, loop: true, grounded: true, pose: () => rest() });

// ---------- blink: the eyes squash onto the lower lid and spring back ----------

register('blink', {
  dur: 160,
  grounded: true,
  pose(t) {
    const p = rest();
    const shut = t < 60 ? power2In(t / 60) : t < 90 ? 1 : 1 - power2Out((t - 90) / 70);
    p.eyes.sy = 1 - 0.82 * shut;
    p.eyes.sx = 1 + 0.35 * shut; // the closed line is a little wider than the open eye
    p.eyes.y = 0.45 * shut;
    return p;
  },
});

// ---------- breath: a slow rise of the body; the arms follow a beat later ----------

const INHALE = [[0, 0], [900, 1, sineInOut], [2000, 0, sineInOut]];
const ARMS_FOLLOW = [[0, 0], [160, 0], [1100, 1, sineInOut], [2000, 0, sineInOut]];
register('breath', {
  dur: 2000,
  grounded: true,
  pose(t) {
    const p = rest();
    const b = keys(t, INHALE);
    p.body.sy = 1 + 0.045 * b;
    p.body.sx = 1 - 0.012 * b;
    const a = keys(t, ARMS_FOLLOW);
    p.armL.rot = p.armR.rot = 7 * a;
    p.eyes.y = -0.12 * a;
    return p;
  },
});

// ---------- look_left / look_right: the eyes dart, the body leans after them, holds, and comes back ----------

function look(d) {
  return t => {
    const p = rest();
    const k = ramp(t, 0, 140, power3Out) - ramp(t, 620, 800, power2InOut);
    p.eyes.x = d * 1.1 * k;
    p.eyes.sy = 1 - 0.22 * bump(t, 0, 140) - 0.12 * bump(t, 620, 800); // a squeeze while they travel
    const lean = ramp(t, 70, 340, sineOut) - ramp(t, 600, 900, sineInOut);
    p.body.rot = d * 3.2 * lean;
    p.body.x = d * 0.25 * lean;
    // The arm on the far side lifts a touch as the weight shifts, a little behind the lean.
    const arm = ramp(t, 140, 420, sineOut) - ramp(t, 620, 900, sineInOut);
    if (d < 0) p.armR.rot = 9 * arm; else p.armL.rot = 9 * arm;
    return p;
  };
}
register('look_left', { dur: 900, grounded: true, pose: look(-1) });
register('look_right', { dur: 900, grounded: true, pose: look(1) });

// ---------- walk: a few steps to one side (the seed picks it), a look back, and home ----------
// The travel eases in, cruises and eases out (ramped). The leg phase is driven by the distance covered,
// so the feet keep pace with the body and the gait settles by itself as it stops. Legs 0 and 2 swing
// against legs 1 and 3; the swinging pair lifts its feet. The body leans into the travel from the speed,
// tips back as it sets off and forward as it brakes, dips on every stride, and rocks once when it stops.

const W = { dur: 3200, out: [200, 1360], back: [1760, 2920], cycles: 2, amp: 22, lift: 0.45, bob: 0.35, lean: 3, brake: 1.6, rock: 1.6 };
const EYES_WALK = [[0, 0], [150, 1, power2Out], [1460, 1], [1640, -1, power2InOut], [2880, -1], [3060, 0, power2InOut]];

function travel(t, [t0, t1]) {
  if (t <= t0) return { s: 0, v: 0, acc: 0 };
  if (t >= t1) return { s: 1, v: 0, acc: 0 };
  return ramped((t - t0) / (t1 - t0), 0.3);
}

function walkPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const dist = ctx.range(1, 3.5, 5);
  const out = travel(t, W.out);
  const back = travel(t, W.back);
  const going = t < W.back[0];
  const dir = going ? d : -d;
  const leg = going ? out : back;
  const v = leg.v;

  p.root.x = d * dist * (out.s - back.s);

  // Gait: phase from distance covered, amplitude and lift from speed.
  const u = 2 * Math.PI * W.cycles * leg.s;
  const swing = dir * W.amp * v * Math.sin(u);
  const liftA = W.lift * v * Math.max(0, Math.cos(u));
  const liftB = W.lift * v * Math.max(0, -Math.cos(u));
  p.legs[0].rot = p.legs[2].rot = swing;
  p.legs[1].rot = p.legs[3].rot = -swing;
  p.legs[0].lift = p.legs[2].lift = liftA;
  p.legs[1].lift = p.legs[3].lift = liftB;

  // Body: dip on each stride (planted legs shorten on their own), a touch of squash with it.
  const dip = v * Math.sin(u) ** 2;
  p.body.y = W.bob * dip;
  p.body.sy = 1 - 0.03 * dip;
  p.body.sx = 1 + 0.015 * dip;

  // Lean: into the travel with speed; back when setting off, forward when braking; a waddle on every
  // stride, a little behind the legs; one rock when it stops.
  let lean = dir * (W.lean * v - W.brake * leg.acc) + W.rock * v * Math.sin(u - 0.5);
  lean -= d * 2 * bump(t, 30, 240);                                                // wind-up before the first step
  lean += d * 2 * bump(t, W.back[0] - 200, W.back[0] + 60);                       // and before the way home
  lean -= d * 2 * wobble(t - W.out[1], 380, 170) * (1 - ramp(t, W.out[1] + 200, W.back[0] - 100));
  lean += d * 2 * wobble(t - W.back[1], 380, 170) * (1 - ramp(t, W.back[1] + 120, W.dur, sineIn));
  p.body.rot = lean;

  // Arms swing against the waddle and dip a beat after the body does (follow-through); the trailing
  // arm lifts a touch with speed.
  const pump = 8 * v * Math.sin(u - 0.9);
  const trail = 4 * v;
  const armDip = 0.3 * (v * Math.sin(u - 0.8) ** 2 - dip);
  p.armL.rot = pump + (dir > 0 ? trail : 0);
  p.armR.rot = -pump + (dir < 0 ? trail : 0);
  p.armL.y = p.armR.y = armDip;

  // Eyes lead: they look where it is going before it moves, and turn back (with a blink) at the far end.
  p.eyes.x = d * 0.8 * keys(t, EYES_WALK);
  const blink = bump(t, W.out[1] + 150, W.out[1] + 290);
  p.eyes.sy = 1 - 0.8 * blink;
  p.eyes.y = 0.4 * blink;
  p.body.sy -= 0.03 * bump(t, 30, 240);                                            // settle into the wind-up
  return p;
}
register('walk', { dur: W.dur, grounded: true, pose: walkPose });

// ---------- hop: crouch, a parabolic arc (sine-out up, power3-in down), squash on landing ----------
// Squash and stretch act on the root, so they pivot at the feet. The arms trail the body up, float, then
// slam past rest on landing and spring back (the weight). The legs tuck in the air and reach for the
// ground just before contact.

const H = { dur: 1000, t0: 130, up: 380, down: 190, h: 3.6 };
const LAND = H.t0 + H.up + H.down; // 700
const SQUASH = [
  [0, 0], [H.t0, -0.16, power2Out], [H.t0 + 70, 0.14, power2Out], [H.t0 + H.up - 10, 0, sineInOut],
  [LAND, 0.08, power2In], [LAND + 60, -0.22, power2Out], [H.dur, 0, backOut],
];
// Arms rise by sliding up the body's sides with a modest tilt: a 2x2 nub turned far reads as a diamond.
const HOP_ARM_ROT = [[0, 0], [H.t0, -14, power2Out], [320, 26, power2Out], [520, 22, sineInOut], [LAND, 32, sineIn], [LAND + 90, -18, power2In], [H.dur, 0, backOut]];
const HOP_ARM_Y = [[0, 0], [H.t0, 0.6, power2Out], [330, -2.2, power2Out], [520, -2, sineInOut], [LAND, -2.6, sineIn], [LAND + 90, 0.9, power2In], [H.dur, 0, backOut]];
const SPLAY = [-11, -4, 4, 11]; // in the air the outer legs splay more than the inner ones
const TUCK = [[0, 0], [H.t0 + 20, 0], [H.t0 + 150, 1, power2Out], [LAND - 110, 1], [LAND, 0, power2In]];

function hopPose(t, ctx) {
  const p = rest();
  p.root.y = hopY(t, H.t0, H.up, H.down, H.h);
  const s = keys(t, SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  p.body.rot = ctx.side * 4 * bump(t, H.t0 + 60, LAND - 40); // a joyful tilt, to the seed's side
  p.armL.rot = p.armR.rot = keys(t, HOP_ARM_ROT);
  p.armL.y = p.armR.y = keys(t, HOP_ARM_Y);
  const tuck = keys(t, TUCK);
  for (let i = 0; i < 4; i++) {
    p.legs[i].lift = 0.45 * tuck;
    p.legs[i].rot = SPLAY[i] * tuck;
  }
  p.eyes.style = t > H.t0 - 20 && t < LAND + 140 ? 'happy' : 'open';
  p.eyes.sy = 1 - 0.25 * bump(t, 40, H.t0 + 40) - 0.3 * bump(t, LAND, LAND + 200);
  p.eyes.y = -0.3 * bump(t, H.t0, LAND) + 0.2 * bump(t, LAND, LAND + 200);
  return p;
}
register('hop', { dur: H.dur, pose: hopPose });
