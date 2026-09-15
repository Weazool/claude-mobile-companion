// Work animations: what the companion does while Claude Code is busy, and when a session needs you.
// Owns: thinking, reading, working, compiling, surprised, curious.
// Read ../ANIMATING.md first; base.js shows the style (walk, hop).
import { register, rest, defineGlyph, pixels, ease, keys, ramp, bump, osc, wobble, hopY, lerp, hash01, PALETTE } from '../core.js';

const { sineIn, sineOut, sineInOut, power1Out, power2In, power2Out, power2InOut, power3In, power3Out, backOut } = ease;

// ---------- glyphs (work_ prefix) ----------

// The page's third turn frame: the flap has come over onto the left half (page_turn1 is the right half lifting).
defineGlyph('work_page_turn3', [[-1.5, -4, 3, 4, PALETTE.white], [-1.5, -4.25, 1.5, 4, PALETTE.steam], [0.25, -3.25, 0.75, 0.25, PALETTE.ink], [0.25, -2.5, 0.75, 0.25, PALETTE.ink]]);
// One effort stroke, origin at its foot: three of them, each turned its own way, make a fan (3 rects, not 9).
defineGlyph('work_stroke', [[-0.25, -1.4, 0.5, 1.4, PALETTE.white]]);
// A small desk for the laptop: the top, and two legs down to the floor. Origin = the top's centre,
// placed 2.2 above the ground so the legs reach it. On its own, a laptop in front of Clawd sits inside the
// body's outline and reads as a bib or a mouth; on a desk that breaks the outline it reads as a laptop.
// The desk is grey, so the laptop's white base shows as a bright line between the lid and the desk top.
const DESK_Y = -2.2;
defineGlyph('work_desk', [
  [-8.5, 0, 17, 0.6, PALETTE.steam], [-7.8, 0.6, 0.6, -DESK_Y - 0.6, PALETTE.steam], [7.2, 0.6, 0.6, -DESK_Y - 0.6, PALETTE.steam],
]);
// The surprised gasp: a small ring.
defineGlyph('mouth_work_gasp', pixels(['.##.', '#..#', '#..#', '.##.'], { px: 0.35, ox: 2, oy: 2 }));

// ---------- shared helpers ----------

// The house blink (base.js): shut on power2In for 60 ms, hold 30, open on power2Out for 70. Returns 0..1 shut.
function blinkAt(t, t0) {
  const u = t - t0;
  if (u <= 0 || u >= 160) return 0;
  return u < 60 ? power2In(u / 60) : u < 90 ? 1 : 1 - power2Out((u - 90) / 70);
}
function blinkEyes(p, shut) {
  if (!shut) return;
  p.eyes.sy *= 1 - 0.82 * shut;
  p.eyes.sx *= 1 + 0.35 * shut;
  p.eyes.y += 0.45 * shut;
}
// 0 -> 1 with an overshoot over d ms from t0: a pop.
const pop = (t, t0, d, s = 2.2) => (t <= t0 ? 0 : t >= t0 + d ? 1 : backOut((t - t0) / d, s));
// A tap or keystroke: down to 1 over `down` ms (power2In, fastest at impact), back to 0 over `up` ms (sineOut).
function tap(t, t0, down, up) {
  const u = t - t0;
  if (u <= 0 || u >= down + up) return 0;
  return u < down ? power2In(u / down) : 1 - sineOut((u - down) / up);
}
const armOf = (p, side) => (side > 0 ? p.armR : p.armL);

// ---------- thinking: eyes up and aside, a hand at the chin, three thought dots in turn, a slow sway ----------
// The seed picks the side the dots rise on; the chin hand is the other one. The eyes follow each dot up
// as it appears, the hand taps the chin twice ("hmm"), the dots drift and leave in order, and a blink
// closes the loop.

const TH = { dur: 3600, fade: 2750 };
const TH_DOTS = [
  { t: 350, x: 4.6, y: -12.2, s: 1.3 },
  { t: 850, x: 7.0, y: -15.2, s: 1.9 },
  { t: 1350, x: 10.0, y: -19.2, s: 2.6 },
];
// The eyes step up to meet each dot: a quick power3Out dart that lands 60 ms before the dot, then a hold,
// so the steps read as steps and not as a slow drift.
const TH_LOOK = [[0, 0], [160, 0], [290, 1, power3Out], [660, 1], [790, 2, power3Out], [1160, 2], [1290, 3, power3Out], [2950, 3], [3300, 0, power2InOut]];

function thinkingPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  // A slow sway toward the dots' side, one swing per loop, and two breaths.
  const sway = osc(t, TH.dur);
  const breath = 0.5 - 0.5 * osc(t, TH.dur / 2, 0.25);
  p.body.rot = d * (1.2 + 1.5 * sway);
  p.body.sy = 1 + 0.025 * breath;
  p.body.sx = 1 - 0.008 * breath;

  // Eyes up and aside, stepping up with each dot.
  const look = keys(t, TH_LOOK);
  p.eyes.x = d * (0.3 + 0.25 * look);
  p.eyes.y = -0.3 - 0.27 * look;
  blinkEyes(p, blinkAt(t, 3380));

  // The chin hand: slid high up the side and tucked in against the face, nearly level; it taps the face
  // twice ("hmm") by pushing in and up, not by tilting (a tilted nub reads as a flipper).
  const chin = armOf(p, -d);
  const taps = tap(t, 1880, 70, 150) + tap(t, 2140, 70, 150);
  chin.y = -2.0 - 0.25 * taps + 0.12 * breath;
  chin.x = d * (0.5 + 0.3 * taps); // toward the body
  chin.rot = 6;
  // The free arm hangs relaxed and trails the sway.
  const free = armOf(p, d);
  free.rot = -4 + 3 * osc(t, TH.dur, -0.08) + 5 * breath;

  // Thought dots: pop in turn, bob in a wave, then leave in order, drifting up.
  for (let i = 0; i < TH_DOTS.length; i++) {
    const D = TH_DOTS[i];
    const leave = ramp(t, TH.fade + i * 120, TH.fade + 350 + i * 120, power2In);
    const o = ramp(t, D.t, D.t + 110, power1Out) * (1 - leave);
    if (o <= 0) continue;
    const s = D.s * pop(t, D.t, 320) * (1 - 0.3 * leave);
    p.fx.push({ glyph: 'dot', space: 'body', x: d * D.x, y: D.y + 0.22 * osc(t, 1200, -i * 0.18) - 0.7 * leave, s, o });
  }
  return p;
}
register('thinking', { dur: TH.dur, loop: true, grounded: true, pose: thinkingPose });

// ---------- reading: a page in one hand, eyes scanning line by line, a page turn every loop ----------
// The eyes read: three small saccades along a line, a quick sweep back and down a line, three lines per
// page. Then the eyes jump to the corner, the hand flicks, the page turns (page_turn1, page_turn2,
// work_page_turn3), and the body gives a little nod as the eyes go back to the top.
// The mood engine often shows reading for only its 1.5 s dwell before Claude flips back to thinking or
// working, so the clip starts `offset` ms into its cycle: the page turn lands about 120 ms after entry and
// says "reading" at once; the lines follow.

const RD = { dur: 3200, line: 700, lines: 3, turn: 2250, offset: 2150 };
const RD_TURN = [[0, 0], [RD.turn - 120, 0], [RD.turn, 1, power2Out], [RD.turn + 380, 1], [RD.turn + 520, 0, power2InOut]];

// Eye position along the page at t: x across a line (0..1), y down the page (0..1).
function readEyes(t) {
  if (t < RD.line * RD.lines) {
    const ln = Math.floor(t / RD.line);
    const u = t - ln * RD.line;
    // three steps across (each a 70 ms power3Out saccade, then a fixation), then a 110 ms sweep back
    let x = 0;
    for (let k = 0; k < 3; k++) x += ramp(u, 60 + k * 210, 130 + k * 210, power3Out) / 3;
    const back = ramp(u, RD.line - 110, RD.line, power2InOut);
    return { x: x * (1 - back), y: (ln + back) / RD.lines };
  }
  // after the last line: hold at the bottom, then up to the top for the new page
  const up = ramp(t, RD.turn + 120, RD.turn + 420, power2InOut);
  return { x: 0.6 * (1 - up) * ramp(t, RD.line * RD.lines, RD.line * RD.lines + 150, power3Out), y: 1 - up };
}

function readingPose(t, ctx) {
  t = (t + RD.offset) % RD.dur; // the cycle's own seam (t = 0) is seamless, so the shift keeps the loop seamless
  const p = rest();
  const d = ctx.side;
  const breath = 0.5 - 0.5 * osc(t, RD.dur / 2, 0.25);
  const e = readEyes(t);
  const turn = keys(t, RD_TURN);

  // Eyes down at the page, reading across it.
  p.eyes.x = d * (0.1 + 0.7 * e.x);
  p.eyes.y = 0.3 + 0.35 * e.y - 0.4 * turn;
  p.eyes.sy = 0.9;
  blinkEyes(p, blinkAt(t, 1500));

  // The head follows the reading a little: leans toward the page, nods down the lines, bobs at the turn.
  const nod = bump(t, RD.turn + 260, RD.turn + 700);
  p.body.rot = d * (1.2 + 0.8 * e.y) - d * 1.2 * turn + d * 1.2 * nod;
  p.body.y = 0.08 * breath + 0.12 * nod;
  p.body.sy = 1 + 0.02 * breath;

  // The holding hand grips the page's outer edge, low in front; it flicks the page over.
  const hold = armOf(p, d);
  const flick = tap(t, RD.turn + 20, 90, 260);
  const handY = 0.9 + 0.1 * breath - 0.5 * flick;
  hold.y = handY;
  hold.rot = 6 + 14 * flick;
  const other = armOf(p, -d);
  other.rot = 4 * breath - 3;

  // The page, held in front of the body's lower corner, cycling the turn frames.
  const k = t - RD.turn - 20;
  const glyph = k < 0 || k >= 440 ? 'page' : k < 110 ? 'page_turn1' : k < 220 ? 'page_turn2' : k < 330 ? 'work_page_turn3' : 'page';
  p.props.push({ glyph, on: 'body', x: d * 5.1, y: -1.45 + handY, s: 1.2, rot: -d * (3 + 5 * flick), id: 'work_page', blend: 'grow' });
  return p;
}
register('reading', { dur: RD.dur, loop: true, grounded: true, pose: readingPose });

// ---------- working: typing on a tiny laptop, two bursts and an Enter, then a quieter phrase ----------
// Hands alternate on quick keystrokes (power2In into the key, sineOut off it). The body takes a small
// dip on every stroke and leans toward the striking hand; the eyes track the line being typed and snap
// back between bursts. The Enter is wound up and slammed with a spark and a squash. The second half of
// the loop is calmer: a short line at an easier pace, a pause to read the screen (a lean in and a blink),
// and a few more keys, so the Enter and its spark come every 4.8 s, not every 2.4 s, for as long as
// Claude works.

const WK = { dur: 4800, gap: 125, calm: 150, enter: 2010 };
const WK_STROKES = [];
for (let i = 0; i < 8; i++) WK_STROKES.push([60 + i * WK.gap, i % 2 ? 1 : -1]);
for (let i = 0; i < 6; i++) WK_STROKES.push([1200 + i * WK.gap, i % 2 ? -1 : 1]);
const WK_LOUD = WK_STROKES.length; // the strokes before this index are the bursts: only they throw sparks
for (let i = 0; i < 6; i++) WK_STROKES.push([2500 + i * WK.calm, i % 2 ? 1 : -1]);
for (let i = 0; i < 4; i++) WK_STROKES.push([3900 + i * WK.calm, i % 2 ? -1 : 1]);
const WK_EYES = [
  [0, -0.4], [1000, 0.45, sineInOut], [1130, -0.4, power3Out], [1900, 0.4, sineInOut], [2150, 0.1, power2Out], [2400, -0.4, sineInOut],
  // the calm half: type a short line, then read the screen in three fixations, then a few more keys
  [2500, -0.4], [3330, 0.2, sineInOut], [3420, -0.35, power3Out], [3500, -0.35], [3570, 0, power3Out],
  [3780, 0], [3850, 0.3, power3Out], [3890, 0.3], [3960, -0.4, power3Out], [4480, 0, sineInOut], [WK.dur, -0.4, sineInOut],
];
const WK_WIND = [[0, 0], [1880, 0], [WK.enter - 10, 1, power2Out], [WK.enter + 45, -1.25, power3In], [WK.enter + 330, 0, backOut], [WK.dur, 0]];
const WK_PEER = [[0, 0], [3360, 0], [3520, 1, power2Out], [3830, 1], [4000, 0, sineInOut]]; // leaning in to read

function workingPose(t, ctx) {
  const p = rest();
  let L = 0;
  let R = 0;
  for (let i = 0; i < WK_STROKES.length; i++) {
    const [t0, hand] = WK_STROKES[i];
    const k = tap(t, t0, 40, 85) * (0.75 + 0.25 * hash01(ctx.seed, i)) * (i < WK_LOUD ? 1 : 0.85); // not every key is hit as hard
    if (hand > 0) R += k; else L += k;
  }
  const wind = keys(t, WK_WIND); // the Enter: +1 wound up, -1.25 slammed down
  const slam = Math.max(0, -wind);
  const peer = keys(t, WK_PEER);

  // Arms hover over the desk at the keyboard's sides and jab down on each stroke, just behind the desk
  // top's edge (the lowest corner stays above its underside, y -1.6, so no hand shows under the desk).
  const up = Math.max(0, wind);
  p.armL.y = 1.1 + 0.4 * L;
  p.armL.rot = 2 - 14 * L;
  p.armR.y = 1.1 + 0.4 * R - 2.6 * up + 0.1 * slam;
  p.armR.rot = 2 - 14 * R + 22 * up - 10 * slam;

  // Body: a small dip on every stroke, a lean toward the striking hand, a squash on the Enter, a lean in
  // to read the screen.
  const any = L + R;
  p.body.y = 0.14 * any + 0.35 * slam + 0.04 * osc(t, WK.dur / 2, 0.25) + 0.12 * peer;
  p.body.rot = 1 * (R - L) - 1.4 * up + 0.8 * slam;
  p.root.sy = 1 - 0.04 * slam;
  p.root.sx = 1 + 0.02 * slam;

  // Eyes down on the screen, following the line; a blink between the bursts and one while reading.
  p.eyes.y = 0.45;
  p.eyes.sy = 0.85 - 0.1 * peer;
  p.eyes.x = keys(t, WK_EYES);
  blinkEyes(p, blinkAt(t, 1040) + blinkAt(t, 3600));

  // The desk stands in front of the arms, so a striking hand dips behind its edge; the laptop sits on it
  // (in front of the body) and gives a little on the Enter.
  // On a clip change the desk fades (one colour, so it fades cleanly) and the laptop folds up out of it or
  // down into it (blend: 'grow'); a fading laptop would show as a pale bib on the body.
  p.props.push({ glyph: 'work_desk', on: 'root', x: 0, y: DESK_Y, z: 1, id: 'work_desk' });
  p.props.push({ glyph: 'laptop', on: 'root', x: 0, y: DESK_Y, s: 0.9, sy: 1 - 0.06 * slam, id: 'work_laptop', blend: 'grow' });

  // Key sparks: now and then (about 3 burst strokes in 10, picked by the seed) a stroke throws one up and
  // out from under the hand; the Enter throws a yellow one.
  for (let i = 0; i < WK_LOUD; i++) {
    const [t0, hand] = WK_STROKES[i];
    if (t < t0 + 35 || t > t0 + 300 || hash01(ctx.seed, 100 + i) > 0.3) continue;
    const u = ramp(t, t0 + 35, t0 + 300, power2Out);
    const o = 1 - ramp(t, t0 + 150, t0 + 300, power2In);
    if (o <= 0) continue;
    p.fx.push({ glyph: 'spark', space: 'world', x: hand * (5.8 + 3.2 * u), y: -2.9 - 4 * u + 1.4 * u * u, s: 0.8 * (1 - 0.4 * u), o, fill: PALETTE.white });
  }
  const so = 1 - ramp(t, WK.enter + 120, WK.enter + 360, power2In);
  if (t > WK.enter + 30 && so > 0) {
    const u = ramp(t, WK.enter + 30, WK.enter + 360, power2Out);
    p.fx.push({ glyph: 'spark', space: 'world', x: 6.2 + 3.6 * u, y: -3.2 - 5.4 * u + 1.2 * u * u, s: 1.3 * pop(t, WK.enter + 30, 150, 2.6) * (1 - 0.45 * u), o: so });
  }
  return p;
}
register('working', { dur: WK.dur, loop: true, grounded: true, pose: workingPose });

// ---------- compiling: dumbbell curls, a long hold at peak effort, a short rest between reps ----------
// A dip to gather, the curl (arms first, the body rising after), a trembling hold with squinted eyes and
// effort marks that grows until a last squeeze, a controlled lowering, and an exhale with a blink.

const CO = { dur: 3000, top: 760, hold: 1950, down: 2450 };
const CO_CURL = [[0, 0], [220, 0], [330, -0.15, sineInOut], [CO.top, 1, power2InOut], [CO.hold - 250, 1], [CO.hold - 120, 1.08, power2Out], [CO.hold, 1, sineInOut], [CO.down, 0, sineInOut], [CO.dur, 0]];
const CO_BODY = [[0, 0], [240, 0], [360, 0.3, sineOut], [CO.top + 80, -0.15, power2Out], [CO.hold, -0.1], [CO.down + 80, 0.25, sineInOut], [CO.dur, 0, sineInOut]];
const CO_BRACE = [[0, 0], [300, 0], [CO.top, 1, power2Out], [CO.hold, 1], [CO.down, 0, sineInOut]];
const CO_SPLAY = [-6, -2, 2, 6]; // the feet brace wider for the lift
const CO_FAN = [12, 45, 78]; // effort-stroke angles, degrees from straight up, fanning outward
const RAD = Math.PI / 180;

function compilingPose(t) {
  const p = rest();
  const curl = keys(t, CO_CURL);
  const hold = ramp(t, CO.top, CO.top + 200, sineOut) * (1 - ramp(t, CO.hold - 40, CO.hold + 80, sineIn));
  const effort = hold * (0.6 + 0.4 * ramp(t, CO.top + 300, CO.hold - 250, sineIn));
  const shake = effort * (osc(t, 100) + 0.5 * osc(t, 75, 0.3));

  // Arms curl together, the right a hair behind the left.
  const lag = keys(Math.max(0, t - 40), CO_CURL);
  p.armL.y = lerp(0.6, -2.6, curl) + 0.1 * shake;
  p.armL.rot = lerp(-16, 26, curl) + 2 * shake;
  p.armR.y = lerp(0.6, -2.6, lag) - 0.1 * shake;
  p.armR.rot = lerp(-16, 26, lag) - 2 * shake;

  // Body: dips to gather, rises with the curl, trembles through the hold, sinks on the exhale.
  p.body.y = keys(t, CO_BODY) + 0.05 * shake;
  p.body.x = 0.08 * shake;
  p.body.sy = 1 + 0.03 * curl - 0.02 * effort;
  // The legs brace into an A (feet wide of the hips) with the feet planted: each hip slides in against
  // the splay and against the body's tremble, so the feet neither slide out nor shake.
  const brace = keys(t, CO_BRACE);
  for (let i = 0; i < 4; i++) {
    const L = p.legs[i];
    L.rot = CO_SPLAY[i] * brace;
    const a = L.rot * RAD;
    const len = (2 - p.body.y - 0.5 * Math.abs(Math.sin(a))) / Math.cos(a); // the length the core gives it
    L.x = -p.body.x - Math.sin(a) * len;
  }

  // Squinting through the hold; a blink on the rest.
  p.eyes.style = hold > 0.5 ? 'squint' : 'open';
  p.eyes.y = -0.2 * curl;
  blinkEyes(p, blinkAt(t, 2620));

  // Dumbbells, upright in both hands; on a clip change they grow into the hands and shrink out of them.
  p.props.push({ glyph: 'dumbbell', on: 'armL', x: -7.5, y: -5, upright: true, s: 0.9, id: 'work_dbL', blend: 'grow' });
  p.props.push({ glyph: 'dumbbell', on: 'armR', x: 7.5, y: -5, upright: true, s: 0.9, id: 'work_dbR', blend: 'grow' });

  // Effort marks: a fan of strokes at each top corner of the head, pulsing out through the hold.
  if (effort > 0.01) {
    const beat = Math.max(0, osc(t, 300));
    const o = Math.min(1, 1.5 * effort) * (0.75 + 0.25 * beat);
    const r = 0.8 + 0.35 * beat;
    for (let c = -1; c <= 1; c += 2) {
      for (let j = 0; j < CO_FAN.length; j++) {
        const a = CO_FAN[j];
        p.fx.push({ glyph: 'work_stroke', space: 'body', x: c * (5.4 + r * Math.sin(a * RAD)), y: -10.4 - r * Math.cos(a * RAD), rot: c * a, s: 0.9 + 0.2 * beat, o });
      }
    }
  }
  return p;
}
register('compiling', { dur: CO.dur, loop: true, grounded: true, pose: compilingPose });

// ---------- surprised: a startle hop, "!" pops above with an overshoot, eyes wide, squash on landing ----------
// The eyes go wide at once, a tiny crouch, a short sharp hop (sine-out up, power3-in down) with the arms
// flung up, a hard squash on landing with the arms slamming past rest. The "!" pops with an overshoot,
// jiggles on the landing, and shrinks away; a blink hides the eyes' return to normal.

const SU = { dur: 900, t0: 70, up: 190, down: 130, h: 2.4 };
const SU_LAND = SU.t0 + SU.up + SU.down; // 390
const SU_SQUASH = [
  [0, 0], [SU.t0, -0.12, power2Out], [SU.t0 + 60, 0.12, power2Out], [SU.t0 + SU.up - 10, 0.02, sineInOut],
  [SU_LAND, 0.06, power2In], [SU_LAND + 50, -0.2, power2Out], [SU_LAND + 330, 0, backOut], [SU.dur, 0],
];
// The arms trail the launch a beat, fling up, float, then slam past rest on the landing and spring back.
const SU_ARM_ROT = [[0, 0], [SU.t0, -10, power2Out], [SU.t0 + 150, 30, power2Out], [SU_LAND - 40, 26, sineInOut], [SU_LAND + 70, -16, power2In], [SU_LAND + 330, 0, backOut], [SU.dur, 0]];
const SU_ARM_Y = [[0, 0], [SU.t0, 0.5, power2Out], [SU.t0 + 150, -2.4, power2Out], [SU_LAND - 40, -2.2, sineInOut], [SU_LAND + 70, 0.8, power2In], [SU_LAND + 330, 0, backOut], [SU.dur, 0]];
const SU_SPLAY = [-10, -4, 4, 10];
const SU_TUCK = [[0, 0], [SU.t0 + 10, 0], [SU.t0 + 100, 1, power2Out], [SU_LAND - 70, 1], [SU_LAND, 0, power2In]];

function surprisedPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  // Each play hops a little differently: it alternates with curious as the needs-you base, and the same
  // hop every three seconds would feel mechanical.
  p.root.y = hopY(t, SU.t0, SU.up, SU.down, SU.h * ctx.range(1, 0.85, 1.1));
  const s = keys(t, SU_SQUASH);
  p.root.sy = 1 + s;
  p.root.sx = 1 - 0.6 * s;
  p.body.rot = -d * 3 * bump(t, 20, SU_LAND); // a flinch
  p.armL.rot = p.armR.rot = keys(t, SU_ARM_ROT);
  p.armL.y = p.armR.y = keys(t, SU_ARM_Y);
  const tuck = keys(t, SU_TUCK);
  for (let i = 0; i < 4; i++) {
    p.legs[i].lift = 0.4 * tuck;
    p.legs[i].rot = SU_SPLAY[i] * tuck;
  }

  // Wide eyes at once and a little "o"; the blink at the end hides the switch back to open.
  p.eyes.style = t > 12 && t < 800 ? 'wide' : 'open';
  p.eyes.y = -0.35 * bump(t, 12, SU_LAND);
  blinkEyes(p, blinkAt(t, 735));
  const close = ramp(t, 560, 680, power2In);
  const mo = pop(t, 20, 160) * (1 - 0.6 * close);
  if (close < 1 && t > 20) p.mouth = { style: 'work_gasp', x: 0, y: 0.2, sx: 1.25 * mo, sy: 1.4 * mo, o: 1 - close };

  // "!" above the head: pops with an overshoot and rides the hop (and the flinch), dips and jiggles on the
  // landing, shrinks away. It rides on the body, with the root's squash divided back out so the landing
  // doesn't crush it three units down in one frame; the dip is a deliberate, smaller echo of the landing.
  const out = ramp(t, 660, 820, power2In);
  const k = pop(t, 30, 300, 2.4);
  if (t > 30 && out < 1) {
    const sz = 1.7 * k * (1 - 0.6 * out);
    p.fx.push({
      glyph: '!', space: 'body', x: 0, y: (-11.2 - 1.4 * k + 0.7 * bump(t, SU_LAND - 20, SU_LAND + 180)) / p.root.sy,
      s: sz, sx: 1 / p.root.sx, sy: 1 / p.root.sy, o: 1 - out, rot: 12 * wobble(t - SU_LAND, 200, 110), id: 'work_mark',
    });
  }
  return p;
}
register('surprised', { dur: SU.dur, pose: surprisedPose });

// ---------- curious: eyes first, a head tilt (about 8°), one arm up, a "?" that wobbles, a double blink ----------

const CU = { dur: 2000 };
const CU_EYES = [[0, 0], [150, 1, power3Out], [1500, 1], [1800, 0, power2InOut]];
const CU_TILT = [[0, 0], [130, -0.12, sineInOut], [500, 1, backOut], [1520, 1], [1900, 0, power2InOut]];
const CU_ARM = [[0, 0], [220, 0], [560, 1, backOut], [1480, 1], [1880, 0, power2InOut]];
// Two small lifts of the raised hand while it holds ("me? a question?"), the second smaller.
const CU_LIFT = [[0, 0], [800, 0], [900, 1, power2Out], [1020, 0, sineInOut], [1090, 0], [1180, 0.65, power2Out], [1300, 0, sineInOut]];

function curiousPose(t, ctx) {
  const p = rest();
  const d = ctx.side;
  const tilt = keys(t, CU_TILT);
  p.body.rot = d * 8 * tilt + d * 1.2 * wobble(t - 1900, 260, 90) * (1 - ramp(t, 1920, CU.dur));
  // It cranes up into the tilt, so the low side's legs are not crushed while the high side's stretch.
  p.body.y = -0.4 * tilt + 0.15 * bump(t, 560, 1520) * (0.5 - 0.5 * osc(t, 480, 0.25));

  p.eyes.x = d * 0.9 * keys(t, CU_EYES);
  p.eyes.y = -0.45 * keys(t, CU_EYES);
  p.eyes.sy = 1 - 0.2 * bump(t, 0, 150);
  blinkEyes(p, blinkAt(t, 900) + blinkAt(t, 1090));

  // One hand up on the high side, "a question?": slid up the side and tilted modestly (with the body's 8°
  // it shows about 24°, still a nub, not a diamond), with two small lifts while it holds.
  const up = keys(t, CU_ARM);
  const arm = armOf(p, -d);
  arm.y = -3.0 * up - 0.3 * keys(t, CU_LIFT);
  arm.rot = 16 * up;
  const other = armOf(p, d);
  other.rot = -5 * tilt;

  // "?" above, on the tilt side: pops, wobbles, shrinks away.
  const out = ramp(t, 1500, 1740, power2In);
  const k = pop(t, 260, 400, 2.4);
  if (t > 260 && out < 1) {
    p.fx.push({
      glyph: '?', space: 'body', x: d * 1.5, y: -11.4 - 1.2 * k, s: 1.5 * k * (1 - 0.6 * out), o: 1 - out,
      rot: d * (8 * osc(t, 700) * ramp(t, 500, 700)), id: 'work_mark',
    });
  }
  return p;
}
register('curious', { dur: CU.dur, grounded: true, pose: curiousPose });
