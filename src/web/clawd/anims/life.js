// Life animations: the companion's quiet states and its tiredness as the 5-hour limit runs down.
// Owns: yawning, sleeping, cool, low_tokens, sad, ending.
// Read ../ANIMATING.md first; base.js shows the style (walk, hop).
import { register, rest, defineGlyph, pixels, ease, keys, ramp, bump, osc, wobble, lerp, clamp } from '../core.js';

const { sineIn, sineOut, sineInOut, power2In, power2Out, power2InOut, power3Out, backOut } = ease;

// Loops read every track at wrap(t): t = dur is then t = 0 exactly, and a track read at wrap(t - lag)
// trails its lead by `lag` ms across the seam as well.
const wrap = (t, d) => ((t % d) + d) % d;

// The hips' rest x. A body scaled by sx carries its hips with it, so the feet would skate: a leg's x
// offset of HIP * (1 / sx - 1) keeps each hip, and so each foot, where it stands.
const HIP = [-4.5, -2.5, 2.5, 4.5];
const pinHips = (p, sx) => { for (let i = 0; i < 4; i++) p.legs[i].x = HIP[i] * (1 / sx - 1); };

// ---------- glyphs ----------

// A Z with a three-step diagonal: the core Z's two-pixel stroke reads as an I-beam at phone size.
defineGlyph('life_Z', pixels(['wwwww', '...w.', '..w..', '.w...', 'wwwww'], { px: 0.45, ox: 2.5, oy: 2.5 }));
// Sad eyes: the outer top corner cut on a slant (the inner corner stays high). Teary adds a glint.
defineGlyph('eye_life_sad_l', pixels(['..#', '.##', '###', '###'], { px: 0.4, ox: 1.5, oy: 2 }));
defineGlyph('eye_life_sad_r', pixels(['#..', '##.', '###', '###'], { px: 0.4, ox: 1.5, oy: 2 }));
defineGlyph('eye_life_teary_l', pixels(['..#', '.#w', '###', '###'], { px: 0.4, ox: 1.5, oy: 2 }));
defineGlyph('eye_life_teary_r', pixels(['#..', 'w#.', '###', '###'], { px: 0.4, ox: 1.5, oy: 2 }));
defineGlyph('mouth_life_yawn', pixels(['.####.', '######', '######', '######', '######', '######', '.####.'], { px: 0.3, ox: 3, oy: 3.5 })); // a rounded "O"
defineGlyph('mouth_life_smirk', pixels(['....#', '####.'], { px: 0.4, ox: 2.5, oy: 1 }));  // curls up at +x; mirror with sx -1
defineGlyph('mouth_life_wavy', pixels(['.#.#.', '#.#.#'], { px: 0.4, ox: 2.5, oy: 1 }));  // a nervous squiggle

// The colour draining out of Clawd as the limit runs down (sad, ending): a dull warm grey.
const DRAIN = '#8a817c';

// ---------- yawning (one-shot, 1.8 s): heavy lids, a stretch on tiptoe with the arms up, a flop, a shake ----------
// 0-250 the lids come down; 80-380 it sinks a little (the anticipation). 380-850 it stretches tall: the
// body rises onto tiptoe and leans to the seed's side, the far arm reaches up first, the near arm reaches
// out from the shoulder a beat later, the mouth opens wide and the eyes scrunch shut (> <). 850-1100 it
// holds the stretch with a tremble. 1100-1300 it flops down past rest, arms dropping hard, the mouth
// closing to a line ("mm"). 1300-1800 it shakes it off and settles; the lids stay heavy until 1600 and
// open from the lower lid by 1780. The mood engine plays it once, over the sleeping base (going to sleep)
// or before surprised and love (waking).

const YD = 1800;
const Y_BODY_Y = [[0, 0], [80, 0], [380, 0.3, sineInOut], [860, -0.75, power2InOut], [1100, -0.68, sineInOut], [1290, 0.32, power2In], [1740, 0, backOut]];
const Y_BODY_SY = [[0, 1], [80, 1], [380, 0.955, sineInOut], [870, 1.15, power2InOut], [1100, 1.165, sineInOut], [1280, 0.9, power2In], [1740, 1, backOut]];
const Y_BODY_SX = [[0, 1], [80, 1], [380, 1.02, sineInOut], [870, 0.93, power2InOut], [1100, 0.925, sineInOut], [1280, 1.06, power2In], [1740, 1, backOut]];
const Y_LEAN = [[0, 0], [420, 0], [880, 1, sineInOut], [1100, 1.15, sineInOut], [1560, 0, sineInOut]];
const Y_STRETCH = [[0, 0], [400, 0], [860, 1, sineInOut], [1100, 1], [1280, 0, power2In]];
// Arms: the far arm (away from the lean) reaches up first; the near one reaches out 90 ms later. Both
// extend from the shoulder (sx) rather than sliding off the body, and tilt only a little: a 2x2 nub
// turned far inside the stretched body skews into a diamond.
const Y_HIGH_Y = [[0, 0], [60, 0], [380, 0.4, sineInOut], [880, -3.3, power2InOut], [1110, -3.45, sineInOut], [1300, 0.8, power2In], [1700, 0, backOut]];
const Y_HIGH_ROT = [[0, 0], [60, 0], [380, -10, sineInOut], [900, 16, backOut], [1110, 18, sineInOut], [1300, -16, power2In], [1700, 0, backOut]];
const Y_LOW_Y = [[0, 0], [150, 0], [470, 0.4, sineInOut], [970, -1.5, power2InOut], [1110, -1.65, sineInOut], [1310, 0.8, power2In], [1680, 0, backOut]];
const Y_LOW_ROT = [[0, 0], [150, 0], [470, -10, sineInOut], [990, 8, backOut], [1110, 10, sineInOut], [1310, -14, power2In], [1680, 0, backOut]];
const Y_ARM_OUT = [[0, 0], [420, 0], [900, 1, power2Out], [1110, 1.05, sineInOut], [1400, 0, sineInOut]];
const Y_MOUTH = [[0, 0], [430, 0], [800, 1, power2Out], [1080, 1.06, sineInOut], [1220, 0.1, power2In]];

function yawningPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const st = keys(t, Y_STRETCH);
  const shiver = bump(t, 860, 1110);
  const shake = d * 2.8 * wobble(t - 1290, 300, 220) * (1 - ramp(t, 1600, 1800)); // shaking it off after the flop
  p.body.y = keys(t, Y_BODY_Y);
  p.body.sy = keys(t, Y_BODY_SY) + 0.006 * shiver * Math.sin((2 * Math.PI * t) / 90);
  p.body.sx = keys(t, Y_BODY_SX);
  p.body.rot = d * 2.6 * keys(t, Y_LEAN) + shake;
  pinHips(p, p.body.sx);

  const high = d > 0 ? p.armL : p.armR;
  const low = d > 0 ? p.armR : p.armL;
  const tremble = 1.2 * shiver * Math.sin((2 * Math.PI * t) / 90 + 1);
  const out = keys(t, Y_ARM_OUT);
  high.y = keys(t, Y_HIGH_Y);
  high.rot = keys(t, Y_HIGH_ROT) + tremble;
  high.sx = 1 + 0.3 * out;
  low.y = keys(t, Y_LOW_Y);
  low.rot = keys(t, Y_LOW_ROT) - tremble;
  low.sx = 1 + 0.6 * out;

  // Eyes. The lower lid stays where the open eye's lower edge is (y = 1 below the eye centre) through
  // every glyph swap, until the stretch pulls the scrunched eyes up the face. Glyph extents at sy = 1:
  // open and squint span -1..1 about y, half 0..0.75 below it, closed 0..0.5; widths 1, 1.2, 1.5, 1.5.
  if (t < 250) {
    p.eyes.sy = 1 - 0.6 * ramp(t, 0, 250, power2Out); // lids down, quickly at first: 2 units tall -> 0.8
    p.eyes.y = 1 - p.eyes.sy;
  } else if (t < 430) {
    p.eyes.style = 'half';                              // heavy lids, 0.75 tall; widen from the open eye's 1 to 1.5
    p.eyes.sx = lerp(0.67, 1, ramp(t, 250, 400));
    p.eyes.y = 0.25;
  } else if (t < 700) {
    p.eyes.style = 'closed';                            // shut as the stretch starts
    p.eyes.sx = 1 + 0.1 * st;
    p.eyes.y = 0.5 - 0.85 * st;
  } else if (t < 1100) {
    p.eyes.style = 'squint';                            // > < : scrunched at the peak of the yawn
    p.eyes.sx = 1.3;
    p.eyes.sy = lerp(0.55, 0.75, ramp(t, 700, 860));
    p.eyes.y = 1 - 0.85 * st - p.eyes.sy;
  } else if (t < 1400) {
    p.eyes.style = 'closed';                            // the flop: shut, back down onto the lower lid
    p.eyes.sx = lerp(1.05, 1, ramp(t, 1100, 1400));
    p.eyes.y = 0.5 - 0.85 * st;
  } else if (t < 1600) {
    p.eyes.style = 'half';                              // heavy lids, narrowing to the open eye's width
    p.eyes.sx = lerp(1, 0.67, ramp(t, 1400, 1600));
    p.eyes.y = 0.25;
  } else {
    p.eyes.sy = lerp(0.375, 1, ramp(t, 1600, 1780, power2Out)); // open from the lower lid
    p.eyes.y = 1 - p.eyes.sy;
  }

  const mo = keys(t, Y_MOUTH);
  if (t < 1220 && mo > 0.01) {
    p.mouth = { style: 'life_yawn', x: 0, y: 0.5, rot: 0, sx: 0.6 + 0.4 * Math.min(1, mo), sy: 1.27 * mo, o: clamp(mo * 3) };
  } else if (t >= 1220 && t < 1420) {
    p.mouth = { style: 'flat', x: 0, y: 0.6, rot: 0, sx: 0.9, sy: 1, o: 1 - ramp(t, 1340, 1420) }; // "mm"
  }
  return p;
}
register('yawning', { dur: YD, grounded: true, pose: yawningPose });

// ---------- sleeping (loop): a low loaf, arms tucked, slow deep breaths, a "z Z" on each out-breath ----------
// The first time only (0-900 ms, loopFrom), it settles in: the lids grow heavy and close, the body sinks
// from standing into the loaf, and the arms tuck in 200 ms behind it; no Zs yet. Then the loop: the body
// sits almost on the floor (the legs shrink to stubs) and widens a little. It stays square to the view, so
// every rect keeps its hard pixel edges all night. The loop starts at the top of the in-breath: out over
// 1.9 s, a pause, in over 1.6 s. The face and the tucked arms follow the chest a beat later; a small mouth
// opens on the out-breath. Each out-breath sends a Z, then a small z; both are gone before the loop ends,
// so the seam starts with a clear sky. Every Z grows as it rises, so the pair reads "z Z" from the head up.

const SL_D = 4000;     // one breath: the loop
const SL_INTRO = 900;  // settling in, played once before the loop
const SL_LIDS = 380;   // the lids close over the start of the intro
const SL_BREATH = [[0, 1], [1900, 0, sineInOut], [2400, 0], [4000, 1, sineInOut]];
const Z_RISE = 3700; // ms to climb the whole path: both ride it at the same speed, so the pair keeps its spacing
const ZS = [{ at: 150, life: 3700, s: 1 }, { at: 1100, life: 2800, s: 0.72 }];

function risingZs(fx, tw, d) {
  for (const z of ZS) {
    const age = wrap(tw - z.at, SL_D);
    if (age >= z.life) continue;
    const k = age / Z_RISE;
    const o = ramp(age, 0, 450, power2Out) * (1 - ramp(age, z.life - 1400, z.life, sineIn));
    if (o <= 0.001) continue;
    fx.push({
      glyph: 'life_Z', space: 'world',
      x: d * (2.6 + 6 * k + 0.4 * Math.sin(k * 7)), // a small weave: the pair stays on a diagonal, never stacked
      y: -9.2 - 11 * (0.65 * k + 0.35 * sineOut(k)),
      s: z.s * (0.55 + 0.5 * sineOut(k)),
      rot: d * 4 * Math.sin(k * 6 + 0.5),
      o,
    });
  }
}

function sleepingPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const tl = t - SL_INTRO; // loop time (negative in the intro, where the breath is already rising)
  const tw = wrap(tl, SL_D);
  const b = keys(tw, SL_BREATH);
  const face = keys(wrap(tl - 120, SL_D), SL_BREATH);
  const arms = keys(wrap(tl - 260, SL_D), SL_BREATH);
  const sink = ramp(t, 0, SL_INTRO, sineInOut);     // standing -> the loaf; 1 once the loop runs
  const tuck = ramp(t, 200, SL_INTRO, sineInOut);   // the arms, 200 ms behind

  p.body.y = lerp(0, 1.45 - 0.16 * b, sink);
  p.body.sy = lerp(1, 0.9 + 0.055 * b, sink);
  p.body.sx = lerp(1, 1.05 + 0.012 * b, sink);
  pinHips(p, p.body.sx);

  if (t < SL_LIDS) {
    // Heavy lids: the open eye squeezes onto its lower lid (y + 1) and widens, until it is as tall and as
    // wide as the closed line it becomes.
    const c = ramp(t, 0, SL_LIDS, power2In);
    p.eyes.sy = 1 - 0.75 * c;
    p.eyes.sx = 1 + 0.35 * c;
    p.eyes.y = 0.75 * c;
  } else {
    const e = ramp(t, SL_LIDS, SL_INTRO, sineInOut);
    p.eyes.style = 'closed';
    p.eyes.sx = lerp(0.9, 1.1, e);
    p.eyes.y = lerp(0.5, 0.3 - 0.12 * face, e);
  }

  // Arms tucked in at the bottom corners, like paws; they rise a little with each breath.
  p.armL.x = 0.6 * tuck; p.armR.x = -0.6 * tuck;
  p.armL.y = p.armR.y = lerp(0, 1.5 - 0.3 * arms, tuck);

  if (tl >= 0) {
    const mo = ramp(tw, 150, 450, sineInOut) * (1 - ramp(tw, 1500, 1950, sineInOut));
    if (mo > 0.01) p.mouth = { style: 'o', x: 0, y: 0.45, rot: 0, sx: 0.55 + 0.1 * mo, sy: 0.4 + 0.25 * mo, o: mo };
    risingZs(p.fx, tw, d);
  }
  return p;
}
register('sleeping', { dur: SL_INTRO + SL_D, loopFrom: SL_INTRO, loop: true, grounded: true, pose: sleepingPose });

// ---------- cool (loop): shades on, leaning back with a hand behind the head, a slow sway, a toe tap ----------
// The first time only (0-900 ms, loopFrom), the shades arrive: they appear with the rim just above the
// head, then drop onto the face (power2In) and settle on the nose. Once a loop the shades slide down the
// nose and the eyes peek over them and glance aside; then the free hand comes up onto the lens and pushes
// the shades back up (they overshoot a touch), riding up with them. A smirk throughout.
// (The drop waits until 350 ms: the Player takes 300 ms or more to bring a prop in.)

const CD = 4000;       // the loop
const CO_INTRO = 900;  // the shades' entrance, played once before the loop
const CO_DROP = [[0, -8.8], [350, -8.8], [720, -7, power2In], [810, -6.88, sineOut], [900, -7, sineInOut]];
const CO_SLIDE = [[0, 0], [2250, 0], [2560, 1, power2InOut], [3150, 1], [3360, 0, backOut]];
const CO_GLANCE = [[0, 0], [2400, 0], [2560, 1, power3Out], [2980, 1], [3200, 0, power2InOut]];
const CO_PUSH = [[0, 0], [2870, 0], [3140, 1, power2InOut], [3380, 1], [3720, 0, sineInOut]];

function coolPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const intro = t < CO_INTRO;
  const tw = wrap(t - CO_INTRO, CD); // in the intro, the loop's last 900 ms: the sway flows into the loop
  const sway = osc(tw, CD);
  const lag = osc(tw - 280, CD);
  const bob = (1 - Math.cos((2 * Math.PI * tw) / (CD / 2))) / 2;

  p.body.rot = -d * 2 + 3.2 * sway; // the lean carries the sway; the hips stay over the feet
  p.body.y = 0.3 + 0.16 * bob;
  p.body.sy = 0.985 - 0.012 * bob;

  // The hand behind the head, on the side it leans toward; the other arm hangs loose and swings.
  const up = d > 0 ? p.armL : p.armR;
  const free = d > 0 ? p.armR : p.armL;
  up.y = -2.7 + 0.15 * lag;
  up.rot = 26 + 3 * lag;
  up.x = d * 0.35;
  const slide = intro ? 0 : keys(tw, CO_SLIDE);
  const push = intro ? 0 : keys(tw, CO_PUSH);
  const rise = tw >= 3150 ? 1 - slide : 0; // how far the shades have gone back up: the hand rides with them
  free.y = lerp(0.2, -1.5 - 0.95 * rise, push);
  free.rot = lerp(-6 + 6 * lag * d, 4, push);
  free.x = -d * 1.1 * push; // the nub lands on the lens's outer end and still shows past the body's edge

  // A lazy toe tap on the beat, twice a loop.
  const tap = bump(tw, 0, 260) + bump(tw, 2000, 2260);
  p.legs[d > 0 ? 3 : 0].lift = 0.4 * tap;

  p.eyes.y = -0.35 * slide;
  p.eyes.x = intro ? 0 : -d * 0.5 * keys(tw, CO_GLANCE);
  // blend: 'grow': the shades appear (and leave) by scaling from their centre, not by fading, which would
  // smear their ink and rim into a brown patch on the face.
  p.props.push({ glyph: 'sunglasses', on: 'body', x: 0, y: intro ? keys(t, CO_DROP) : -7 + 0.95 * slide, id: 'life_shades', blend: 'grow' });
  p.mouth = { style: 'life_smirk', x: d * 0.5, y: 0.35, rot: 0, sx: d, sy: 1, o: 1 };
  return p;
}
register('cool', { dur: CO_INTRO + CD, loopFrom: CO_INTRO, loop: true, grounded: true, pose: coolPose });

// ---------- the gloom ladder: low_tokens (tired) -> sad (droop) -> ending (worried) ----------
// Each step sits lower and loses a little more colour; sad slumps, ending cowers.

// low_tokens (8 s, two breaths): half-lidded eyes and a slow breath that sags past neutral on the way
// out. The first breath ends in one slow, heavy blink. In the second it dozes off (the lids close, the
// head nods down) and catches itself: the eyes jolt wide with a small pop up, hold, squeeze nearly shut,
// and reopen to the heavy half lids. A doze every 8 s, not every 4, so minutes of it read as tiredness.
const LD = 8000;
const LT_BREATH = [[0, 0], [1400, 1, sineInOut], [2700, -0.5, sineInOut], [4000, 0, sineInOut],
  [5400, 1, sineInOut], [6700, -0.5, sineInOut], [8000, 0, sineInOut]];
const LT_BLINK = [[0, 0], [2400, 0], [2800, 1, power2In], [2950, 1], [3450, 0, power2Out]];  // the heavy blink
const LT_LID = [[0, 0], [6250, 0], [6750, 1, power2In], [6950, 1]];                             // dozing: the half lids close
const LT_JOLT = [[6950, 0.45], [7040, 1, power3Out], [7450, 1], [7600, 0.1, power2In]];         // the wide eyes' sy
const LT_REOPEN = [[7600, 0.4], [7900, 1, power2Out]];                                          // the half lids' sy after the jolt
const LT_NOD = [[0, 0], [6250, 0], [6900, 1, sineIn], [7000, 1], [7200, -0.3, power2Out], [7700, 0, sineInOut]];

function lowTokensPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const tw = wrap(t, LD);
  const b = keys(tw, LT_BREATH);
  const arms = keys(wrap(t - 220, LD), LT_BREATH);
  const nod = keys(tw, LT_NOD);
  const armNod = keys(wrap(t - 120, LD), LT_NOD);
  const blink = keys(tw, LT_BLINK);

  p.body.y = 0.4 - 0.1 * b + 0.35 * nod + 0.08 * blink;
  p.body.sy = 0.97 + 0.035 * b - 0.02 * nod;
  p.body.rot = d * (0.9 * osc(tw, LD / 2) + 1.2 * Math.max(0, nod));
  p.armL.rot = p.armR.rot = -12 + 5 * arms - 6 * armNod;
  p.armL.y = p.armR.y = 0.45 - 0.25 * arms + 0.3 * armNod;

  // The half glyph's lower edge sits at 0.9 - 0.08 b whatever its sy; the wide eye is placed to match.
  if (tw >= 6950 && tw < 7600) {
    p.eyes.style = 'wide';                            // awake again: eyes wide, then a long squeeze
    p.eyes.sy = keys(tw, LT_JOLT);
    p.eyes.y = 0.9 - 0.08 * b - 1.5 * p.eyes.sy;
  } else {
    p.eyes.style = 'half';
    if (tw >= 7600) {
      p.eyes.sy = keys(tw, LT_REOPEN);
      p.eyes.sx = lerp(0.67, 1, ramp(tw, 7600, 7900)); // from the wide eye's width back to the lid's
    } else {
      p.eyes.sy = 1 - 0.85 * keys(tw, LT_LID) - 0.8 * blink;
    }
    p.eyes.y = 0.15 - 0.08 * b + 0.75 * (1 - p.eyes.sy);
  }
  return p;
}
register('low_tokens', { dur: LD, loop: true, grounded: true, pose: lowTokensPose });

// sad: slanted eyes looking down, a frown, arms hanging; a slow sigh (in, a catch, a long slump out) and
// a slow blink. The head hangs to one side only on the slump and comes back up with the next breath, so
// the body stands square (hard pixel edges) for most of the loop.
const SAD = 4000;
const SAD_SIGH = [[0, 0], [1250, 1, sineInOut], [1450, 1.05, sineInOut], [3100, -0.6, power2InOut], [4000, 0, sineInOut]];
const SAD_LID = [[0, 0], [3250, 0], [3450, 1, power2In], [3520, 1], [3760, 0, power2Out]];

function sadPose(t, ctx) {
  const p = rest();
  const tw = wrap(t, SAD);
  const s = keys(tw, SAD_SIGH);
  const arms = keys(wrap(t - 200, SAD), SAD_SIGH);
  const face = keys(wrap(t - 100, SAD), SAD_SIGH);
  const lid = keys(tw, SAD_LID);

  p.body.y = 0.85 - 0.14 * s;
  p.body.sy = 0.95 + 0.045 * s;
  p.body.sx = 1.012;
  p.body.rot = ctx.side * 2.4 * sineInOut(clamp(-face / 0.6)); // the head hangs on the slump
  p.armL.x = 0.25; p.armR.x = -0.25;
  p.armL.y = p.armR.y = 1.2 - 0.6 * arms;                  // the shoulders lift on the in-breath, drop after
  p.armL.rot = p.armR.rot = -26 + 9 * arms;

  p.eyes.style = 'life_sad';
  p.eyes.sy = 1 - 0.8 * lid;
  p.eyes.y = 0.65 - 0.3 * face + 0.6 * (1 - p.eyes.sy);
  p.mouth = { style: 'frown', x: 0, y: 0.55 - 0.1 * face, rot: 0, sx: 0.9, sy: 0.9, o: 1 };
  p.tint = { color: DRAIN, k: 0.12 };
  return p;
}
register('sad', { dur: SAD, loop: true, grounded: true, pose: sadPose });

// ending (6.4 s): it cowers where sad slumps: lower, narrower, arms pulled in tight, teary eyes, a wavy
// mouth, quick shallow breaths that never stop. A nervous glance each way (the body leans after the
// eyes), a sweat drop that swells, creeps down the forehead and drips off, a gulp, one blink, then a long
// worried hold, still panting.
const ED = 6400;
const EN_BREATH = 800; // one quick shallow breath
const EN_GLANCE = [[0, 0], [420, 0], [540, -1, power3Out], [900, -1], [1040, 1, power3Out], [1400, 1], [1620, 0, power2InOut]];
// The drop clings to the forehead above the eye and creeps down a little, then lets go and drips off the
// side of the head (never down past the eye, where it would read as a tear).
const EN_SWEAT_CREEP = [[0, 0], [300, 0], [2600, 1, sineInOut]];

function endingPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const tw = wrap(t, ED);
  const b = osc(tw, EN_BREATH);
  const ab = osc(tw - 100, EN_BREATH);
  const g = keys(tw, EN_GLANCE);
  const lean = keys(tw - 90, EN_GLANCE);
  const gulp = bump(tw, 3800, 4010);
  const blink = bump(tw, 4400, 4520);

  p.body.y = 1.35 + 0.1 * gulp;
  p.body.sy = 0.93 + 0.03 * b - 0.035 * gulp;
  p.body.sx = 0.96;
  p.body.rot = d * 1.6 * lean;
  pinHips(p, p.body.sx);
  p.armL.x = 0.8; p.armR.x = -0.8;
  p.armL.y = p.armR.y = 1.0 - 0.25 * ab;
  p.armL.rot = p.armR.rot = -12;

  p.eyes.style = 'life_teary';
  p.eyes.x = d * 0.9 * g;
  p.eyes.sy = 1 - 0.2 * (bump(tw, 420, 540) + bump(tw, 900, 1040) + 0.6 * bump(tw, 1400, 1620)) - 0.3 * gulp - 0.8 * blink;
  p.eyes.y = 0.45 + 0.6 * (1 - p.eyes.sy);
  p.mouth = { style: 'life_wavy', x: 0, y: 0.5, rot: 0, sx: 1 - 0.2 * gulp, sy: 1, o: 1 };
  p.tint = { color: DRAIN, k: 0.24 };

  const creep = keys(tw, EN_SWEAT_CREEP);
  const gone = ramp(tw, 2780, 3000, power2In);
  const so = ramp(tw, 300, 550, power2Out) * (1 - gone);
  if (so > 0.001) {
    const s = lerp(0.7, 1.6, ramp(tw, 300, 700, backOut)) * (1 - 0.3 * gone);
    const off = ramp(tw, 2600, 3000, power2In); // lets go of the head and falls away from it
    p.fx.push({ glyph: 'sweat', space: 'body', x: d * (5.1 + 1.6 * off), y: -9.4 + 0.6 * creep + 2.4 * off, s, o: so });
  }
  return p;
}
register('ending', { dur: ED, loop: true, grounded: true, pose: endingPose });
