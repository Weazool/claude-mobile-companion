// Clawd, the live SVG rig: geometry, poses, glyphs, clips and the Player.
// Pure: no DOM. Runs in Node (tests, tools/clawd-look.mjs) and in the page (index.js, svg.js).
// Guide for animators: ANIMATING.md, next to this file.

// ---------- palette, view, rig (the brief's table; do not redraw Clawd) ----------

export const PALETTE = Object.freeze({
  body: '#D97757', ink: '#141413', white: '#F5F4ED', flush: '#C4463A', heart: '#E5566E', steam: '#C9C3BA',
  paw: '#B25E40', // an arm held in front of the body, a shade darker so it reads against him (arm.shade)
  yellow: '#F2C14E', blue: '#6A9BD8', green: '#7CC47F',
  confetti: Object.freeze(['#D97757', '#F2C14E', '#6A9BD8', '#7CC47F', '#F5F4ED']),
  stage: '#0a0a0f', glow: '#1a1622',
});

// SVG user units. Origin = the ground point under the body's centre; y grows downward; the ground is y = 0.
export const VIEW = Object.freeze({ x: -16, y: -28, w: 32, h: 32 });

const part = (x, y, w, h, fill, px, py) => Object.freeze({ x, y, w, h, fill, pivot: Object.freeze([px, py]) });
export const RIG = Object.freeze({
  body: part(-6, -10, 12, 8, PALETTE.body, 0, -2),
  eyeL: part(-4, -8, 1, 2, PALETTE.ink, -3.5, -7),
  eyeR: part(3, -8, 1, 2, PALETTE.ink, 3.5, -7),
  armL: part(-8, -6, 2, 2, PALETTE.body, -6, -5),
  armR: part(6, -6, 2, 2, PALETTE.body, 6, -5),
  legs: Object.freeze([
    part(-5, -2, 1, 2, PALETTE.body, -4.5, -2),
    part(-3, -2, 1, 2, PALETTE.body, -2.5, -2),
    part(2, -2, 1, 2, PALETTE.body, 2.5, -2),
    part(4, -2, 1, 2, PALETTE.body, 4.5, -2),
  ]),
});
// Each leg rect also reaches this far up under the body (drawn behind it), so a lean or a lift never
// opens a gap between the body and a leg. The visible rest geometry is exactly the brief's.
export const LEG_OVERLAP = 0.5;
export const MOUTH_AT = Object.freeze([0, -4.5]); // the mouth glyph's origin in rest (body) coordinates

// ---------- the fixed animation names (the dashboard's mood engine calls these) ----------

// owner: which file animates it. loop/next: the kind the mood engine and the Player rely on.
export const SPEC = Object.freeze({
  idle: { owner: 'base', loop: true },
  blink: { owner: 'base' },
  look_left: { owner: 'base' },
  look_right: { owner: 'base' },
  walk: { owner: 'base' },
  hop: { owner: 'base' },
  yawning: { owner: 'life' },
  sleeping: { owner: 'life', loop: true },
  cool: { owner: 'life', loop: true },
  low_tokens: { owner: 'life', loop: true },
  sad: { owner: 'life', loop: true },
  ending: { owner: 'life', loop: true },
  thinking: { owner: 'work', loop: true },
  reading: { owner: 'work', loop: true },
  working: { owner: 'work', loop: true },
  compiling: { owner: 'work', loop: true },
  surprised: { owner: 'work' },
  curious: { owner: 'work' },
  happy_eyes: { owner: 'feelings', loop: true },
  happy: { owner: 'feelings', loop: true },
  jumping_joy: { owner: 'feelings', next: 'happy' },
  celebration: { owner: 'feelings', next: 'happy' },
  love: { owner: 'feelings' },
  overloaded: { owner: 'feelings', loop: true },
  angry: { owner: 'feelings', loop: true },
  error: { owner: 'feelings', loop: true },
});
export const NAMES = Object.freeze(Object.keys(SPEC));
export const INTERNAL = Object.freeze(['breath']); // clips the Player uses on its own (calm idle)

// ---------- helpers: maths, easing, keyframes, arcs, randomness ----------

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a)));

const pIn = p => k => k ** p;
const pOut = p => k => 1 - (1 - k) ** p;
const pInOut = p => k => (k < 0.5 ? (2 * k) ** p / 2 : 1 - (2 * (1 - k)) ** p / 2);
const BACK = 1.70158;
// GSAP naming: power1 = quad, power2 = cubic, power3 = quart. Every ease maps 0 -> 0 and 1 -> 1.
export const ease = Object.freeze({
  linear: k => k,
  sineIn: k => 1 - Math.cos((k * Math.PI) / 2),
  sineOut: k => Math.sin((k * Math.PI) / 2),
  sineInOut: k => (1 - Math.cos(Math.PI * k)) / 2,
  power1In: pIn(2), power1Out: pOut(2), power1InOut: pInOut(2),
  power2In: pIn(3), power2Out: pOut(3), power2InOut: pInOut(3),
  power3In: pIn(4), power3Out: pOut(4), power3InOut: pInOut(4),
  backIn: (k, s = BACK) => k * k * ((s + 1) * k - s),
  backOut: (k, s = BACK) => { const u = k - 1; return u * u * ((s + 1) * u + s) + 1; },
  backInOut: (k, s = BACK * 1.525) => (k < 0.5
    ? ((2 * k) ** 2 * ((s + 1) * 2 * k - s)) / 2
    : ((2 * k - 2) ** 2 * ((s + 1) * (2 * k - 2) + s) + 2) / 2),
  elasticOut: (k, period = 0.3) => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin(((k - period / 4) * 2 * Math.PI) / period) + 1),
  expoOut: k => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  circOut: k => Math.sqrt(1 - (k - 1) ** 2),
});

// 0..1 progress of t through [t0, t1], shaped by an ease (default sineInOut).
export const ramp = (t, t0, t1, e = ease.sineInOut) => e(t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));
// 0 -> 1 -> 0 across [t0, t1] (a smooth half sine). Zero outside.
export const bump = (t, t0, t1) => (t <= t0 || t >= t1 ? 0 : Math.sin((Math.PI * (t - t0)) / (t1 - t0)));
// Seamless oscillation: sin over a period in ms. A loop stays seamless when its dur is a whole number of periods.
export const osc = (t, period, phase = 0) => Math.sin(2 * Math.PI * (t / period + phase));
// Decaying wobble after t = 0 (ms): starts at 0, swings, dies away. Zero before 0.
export const wobble = (t, period, decay) => (t <= 0 ? 0 : Math.exp(-t / decay) * Math.sin((2 * Math.PI * t) / period));

// Keyframes: keys(t, [[t0, v0], [t1, v1, ease], ...]). Each key's ease shapes the segment arriving at it
// (default sineInOut). Before the first key: its value; after the last: its value. Hoist the array to
// module scope when it does not depend on the seed.
export function keys(t, ks) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const k1 = ks[i];
    if (t < k1[0]) {
      const k0 = ks[i - 1];
      return k0[1] + (k1[1] - k0[1]) * (k1[2] || ease.sineInOut)((t - k0[0]) / (k1[0] - k0[0]));
    }
  }
  return ks[ks.length - 1][1];
}

// Parabola through 0 at k = 0 and k = 1, peaking at -h (up) at k = 0.5.
export const arc = (k, h) => -4 * h * k * (1 - k);
// The reference jump: rise for `up` ms (sineOut), fall for `down` ms (power3In). Returns y (<= 0).
export function hopY(t, t0, up, down, h, upEase = ease.sineOut, downEase = ease.power3In) {
  if (t <= t0 || t >= t0 + up + down) return 0;
  return t < t0 + up ? -h * upEase((t - t0) / up) : -h * (1 - downEase((t - t0 - up) / down));
}
// Projectile: p0 + v0 * s + g * s^2 / 2, with s in seconds (t in ms). y grows downward, so g > 0 falls.
export const ballistic = (t, p0, v0, g) => { const s = t / 1000; return p0 + v0 * s + 0.5 * g * s * s; };
// A move from 0 to 1 that eases in over the first `a` of k, cruises, and eases out over the last `a`.
// Returns { s: position 0..1, v: speed 0..1 of the cruise speed, acc: -1..1 }. A walk drives its leg
// phase from s, so the feet keep pace with the body and the legs settle as it stops.
export function ramped(k, a = 0.3) {
  k = clamp(k);
  a = clamp(a, 0.001, 0.5);
  const vmax = 1 / (1 - a);
  if (k <= a) {
    const q = (Math.PI * k) / a;
    return { s: vmax * (k / 2 - (a / (2 * Math.PI)) * Math.sin(q)), v: (1 - Math.cos(q)) / 2, acc: Math.sin(q) };
  }
  if (k >= 1 - a) {
    const r = ramped(1 - k, a);
    return { s: 1 - r.s, v: r.v, acc: -r.acc };
  }
  return { s: vmax * (a / 2 + (k - a)), v: 1, acc: 0 };
}

// Seeded randomness. hash01(seed, k) is a pure function: the same (seed, k) always gives the same value.
export function hash01(seed, k = 0) {
  let h = (seed ^ Math.imul((k + 0x9e3779b9) | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- glyphs: props, effects, eye styles and mouths, all built from rects ----------

export const GLYPHS = Object.create(null);
// Names of glyphs, eye styles or mouths a pose asked for but nobody defined (the tests assert it stays empty).
export const MISSING = new Set();
const faceCache = { eye__l: new Map(), eye__r: new Map(), mouth_: new Map() };
const clearFaces = () => { for (const m of Object.values(faceCache)) m.clear(); };

// rects: [{ x, y, w, h, fill }] or [[x, y, w, h, fill]] in the glyph's own units; (0, 0) is its origin,
// the point a prop or effect item places. Redefining a name replaces it.
export function defineGlyph(name, rects) {
  const list = rects.map(r => (Array.isArray(r) ? { x: r[0], y: r[1], w: r[2], h: r[3], fill: r[4] } : { ...r }));
  for (const r of list) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0 || typeof r.fill !== 'string') {
      throw new Error(`glyph ${name}: bad rect ${JSON.stringify(r)}`);
    }
  }
  GLYPHS[name] = Object.freeze({ name, tag: `glyph:${name}`, rects: Object.freeze(list.map(Object.freeze)) });
  clearFaces();
  return GLYPHS[name];
}

// Pixel-art authoring: one string per row, one character per pixel of `px` units; '.' or ' ' is empty.
// (ox, oy), in pixels, is the glyph's origin: e.g. ox = width / 2, oy = height for bottom centre.
// Runs of the same colour merge into one rect, across rows too, so glyphs stay cheap to draw.
export const PIXEL_KEY = Object.freeze({
  '#': PALETTE.ink, w: PALETTE.white, b: PALETTE.body, r: PALETTE.flush, h: PALETTE.heart, g: PALETTE.steam,
  y: PALETTE.yellow, u: PALETTE.blue, e: PALETTE.green,
});
export function pixels(rows, { px = 0.5, key = PIXEL_KEY, ox = 0, oy = 0 } = {}) {
  const runs = [];
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length;) {
      const fill = key[row[i]];
      if (!fill) { i++; continue; }
      let k = i + 1;
      while (k < row.length && row[k] === row[i]) k++;
      runs.push({ i, j, n: k - i, rows: 1, fill });
      i = k;
    }
  });
  const merged = [];
  for (const r of runs) {
    const up = merged.find(m => m.i === r.i && m.n === r.n && m.fill === r.fill && m.j + m.rows === r.j);
    if (up) up.rows++;
    else merged.push(r);
  }
  return merged.map(m => ({ x: (m.i - ox) * px, y: (m.j - oy) * px, w: m.n * px, h: m.rows * px, fill: m.fill }));
}

// Eye styles are glyphs named eye_<style> (both eyes), or eye_<style>_l / eye_<style>_r for mirrored pairs,
// drawn around each eye's centre. Mouths are glyphs named mouth_<style>, drawn around MOUTH_AT.
function faceGlyph(prefix, style, side) {
  const cache = faceCache[prefix + side];
  let g = cache.get(style);
  if (g) return g;
  g = GLYPHS[`${prefix}${style}${side}`] || GLYPHS[`${prefix}${style}`];
  if (!g) {
    MISSING.add(`${prefix}${style}`);
    return GLYPHS[`${prefix}open`] || null; // eyes fall back to open; an unknown mouth draws nothing
  }
  cache.set(style, g);
  return g;
}

// --- eyes (ink unless noted). Each fits its eye's area, 1-3 units.
const P = PALETTE;
defineGlyph('eye_open', [[-0.5, -1, 1, 2, P.ink]]);
defineGlyph('eye_closed', pixels(['###'], { ox: 1.5, oy: 0 }));             // a flat line on the lower lid
defineGlyph('eye_happy', pixels(['.##.', '#..#'], { ox: 2, oy: 1.5 }));   // ^
defineGlyph('eye_wide', [[-0.5, -1.5, 1, 3, P.ink]]);                       // taller: startled
defineGlyph('eye_x', pixels(['#.#', '.#.', '#.#'], { ox: 1.5, oy: 1.5 }));
defineGlyph('eye_heart', pixels(['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'], { px: 0.3, ox: 3.5, oy: 3 }));
defineGlyph('eye_squint_l', pixels(['#..', '.#.', '..#', '.#.', '#..'], { px: 0.4, ox: 1.5, oy: 2.5 })); // >
defineGlyph('eye_squint_r', pixels(['..#', '.#.', '#..', '.#.', '..#'], { px: 0.4, ox: 1.5, oy: 2.5 })); // <
defineGlyph('eye_half', pixels(['######', '.####.', '.####.'], { px: 0.25, ox: 3, oy: 0 })); // heavy lid, lower half
defineGlyph('eye_sad_l', pixels(['.#', '##', '##'], { ox: 1, oy: 1 }));  // shorter, the outer corner drooping
defineGlyph('eye_sad_r', pixels(['#.', '##', '##'], { ox: 1, oy: 1 }));
// --- mouths (optional, small)
defineGlyph('mouth_o', pixels(['.##.', '####', '####', '.##.'], { px: 0.4, ox: 2, oy: 2 }));    // yawn
defineGlyph('mouth_O', pixels(['.##.', '####', '####', '####', '.##.'], { px: 0.45, ox: 2, oy: 2.5 })); // big yawn
defineGlyph('mouth_smile', pixels(['#..#', '.##.'], { ox: 2, oy: 1 }));
defineGlyph('mouth_frown', pixels(['.##.', '#..#'], { ox: 2, oy: 1 }));
defineGlyph('mouth_flat', pixels(['###'], { ox: 1.5, oy: 0.5 }));
// --- effects (origin at the centre unless noted)
defineGlyph('Z', pixels(['wwww', '..w.', '.w..', 'wwww'], { ox: 2, oy: 2 }));
defineGlyph('dot', pixels(['.ww.', 'wwww', 'wwww', '.ww.'], { px: 0.25, ox: 2, oy: 2 }));            // thought dot
defineGlyph('!', pixels(['yy', 'yy', 'yy', 'yy', '..', 'yy'], { ox: 1, oy: 6 }));                      // bottom centre
defineGlyph('?', pixels(['.ww.', 'w..w', '...w', '..w.', '.w..', '....', '.w..'], { ox: 2, oy: 7 })); // bottom centre
defineGlyph('heart', pixels(['.hh.hh.', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'], { px: 0.4, ox: 3.5, oy: 3 }));
defineGlyph('steam', pixels(['.gg.', 'gggg', '.gg.'], { ox: 2, oy: 1.5 }));
defineGlyph('steam_big', pixels(['..gg..', '.gggg.', 'gggggg', '.gggg.'], { ox: 3, oy: 2 }));
defineGlyph('sweat', pixels(['..u..', '.uuu.', 'uuuuu', 'uwuuu', '.uuu.'], { px: 0.3, ox: 2.5, oy: 2.5 }));
defineGlyph('spark', pixels(['.y.', 'yyy', '.y.'], { ox: 1.5, oy: 1.5 }));
defineGlyph('spark_small', pixels(['..y..', '..y..', 'yy.yy', '..y..', '..y..'], { px: 0.25, ox: 2.5, oy: 2.5 }));
defineGlyph('confetti', [[-0.5, -0.25, 1, 0.5, P.yellow]]);  // set fill per piece, spin with rot
defineGlyph('block', [[0, 0, 1, 1, P.body]]);                  // a unit square: scale it for slices and flashes

// --- props
// Checkered flag on a pole: origin = the grip at the pole's foot; the pole rises 8 units, the cloth
// (6 x 4 checks of 0.75) hangs from its top toward -x. flag1..flag4 are ripple shapes: cycle them.
// Ink squares sit on a light backing so the flag reads on the dark stage.
function flagRects(offsets) {
  const s = 0.75;
  const top = -8;
  const rects = [[-0.5, top - 0.25, 1, 8.25, P.white]];
  offsets.forEach((dy, i) => {
    const x = -0.25 - (i + 1) * s;
    const outer = i === offsets.length - 1 ? 0.25 : 0;
    rects.push([x - outer, top + dy - 0.25, s + outer + (i === 0 ? 0.25 : 0), 4 * s + 0.5, P.white]);
    for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) rects.push([x, top + dy + j * s, s, s, P.ink]);
  });
  rects.push([-0.25, top, 0.5, 8, P.ink]); // the pole's core, over the cloth's backing
  return rects;
}
const RIPPLE = [0, 1, 2, 3].map(f => [0, 1, 2, 3, 4, 5].map(i => Math.round((i / 5) * 2 * Math.sin(i * 1.1 - (f * Math.PI) / 2)) * 0.25));
RIPPLE.forEach((o, f) => defineGlyph(`flag${f + 1}`, flagRects(o)));

// Laptop, lid toward Clawd so we see its back: origin = bottom centre of the base.
defineGlyph('laptop', [
  [-3, -4, 6, 3.5, P.steam], [-0.5, -2.75, 1, 1, P.body], [-3.5, -0.5, 7, 0.5, P.white],
]);
// Dumbbell: origin = the grip, the bar horizontal.
defineGlyph('dumbbell', pixels([
  '.gg.....gg.',
  'ggg.....ggg',
  'gggwwwwwggg',
  'ggg.....ggg',
  '.gg.....gg.',
], { ox: 5.5, oy: 2.5 }));
// A page of text: origin = bottom centre. page_turn1/2 are the page lifting mid-turn.
defineGlyph('page', [[-1.5, -4, 3, 4, P.white], [-1, -3.25, 2, 0.25, P.ink], [-1, -2.5, 1.5, 0.25, P.ink], [-1, -1.75, 2, 0.25, P.ink], [-1, -1, 1.25, 0.25, P.ink]]);
defineGlyph('page_turn1', [[-1.5, -4, 3, 4, P.white], [0, -4.25, 1.5, 4, P.steam], [-1, -3.25, 0.75, 0.25, P.ink], [-1, -2.5, 0.75, 0.25, P.ink]]);
defineGlyph('page_turn2', [[-1.5, -4, 3, 4, P.white], [-0.25, -4.5, 0.5, 4.25, P.steam], [-1, -3.25, 0.75, 0.25, P.ink], [0.5, -2.5, 0.75, 0.25, P.ink]]);
// Sunglasses: origin = the eye line's centre (place at [0, -7] on the body). A light rim on top.
defineGlyph('sunglasses', [
  [-5.5, -1, 4, 1.5, P.ink], [-5, 0.5, 3, 0.5, P.ink], [1.5, -1, 4, 1.5, P.ink], [2, 0.5, 3, 0.5, P.ink],
  [-1.5, -1, 3, 0.5, P.ink], [-5.5, -1.25, 11, 0.25, P.steam], [-5, -0.5, 0.5, 0.5, P.white], [2, -0.5, 0.5, 0.5, P.white],
]);

// ---------- poses ----------

// A pose is plain data. Angles are degrees. Sign rule: a positive angle moves the part's free end toward
// +x (the body's top leans right; a leg's foot swings right), except arms: positive raises the arm, on
// both sides. Offsets are in rig units; sx/sy scale about the part's pivot.
export function rest() {
  return {
    root: { x: 0, y: 0, rot: 0, sx: 1, sy: 1 },  // everything, pivot at the ground point (0, 0): walk, jump, squash
    body: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1 }, // pivot at the bottom centre (0, -2); eyes, mouth, arms ride on it
    armL: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1, shade: 0 }, // pivot at the shoulder (-6, -5); shade 0..1 toward PALETTE.paw
    armR: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1, shade: 0 }, // pivot at the shoulder (6, -5)
    // Legs hang from hips on the body's bottom edge. By default each stretches so its lowest corner
    // stands on the ground (y = 0 in root space); lift raises the foot, len (units) overrides the length.
    legs: [0, 1, 2, 3].map(() => ({ rot: 0, lift: 0, len: null, x: 0, o: 1 })),
    // style: an eye glyph name without the eye_ prefix; L / R override one eye's style. x/y offset both
    // eyes on the body; sx/sy scale each eye about its own centre.
    eyes: { style: 'open', L: null, R: null, x: 0, y: 0, sx: 1, sy: 1, o: 1 },
    mouth: null, // { style: 'o' | 'O' | 'smile' | 'frown' | 'flat', x, y, rot, sx, sy, o }
    tint: null,  // { color, k }: shift the body, arms and legs toward color by k (0..1), e.g. the red flush
    // Items: { glyph, x, y, rot, sx, sy, s, o, z, fill, id, upright, blend }. Props: on 'root' | 'body' |
    // 'armL' | 'armR' (x, y in that part's rest coordinates); effects: space 'world' | 'body'. rot is SVG's
    // (clockwise). upright: ride on the parent's point but keep the orientation one level up (a flag in
    // a raised hand stays vertical). z: -1 behind the character, 0 between the face and the arms (props'
    // default), 1 in front of everything (effects' default). blend: 'grow' makes the item scale in and out
    // from its origin when a clip change brings it or takes it away, instead of fading ('fade', default).
    props: [],
    fx: [],
  };
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const xf = (dst, a, b, k) => {
  for (const f of ['x', 'y', 'rot', 'sx', 'sy', 'o', 'shade']) if (f in dst) dst[f] = lerp(num(a && a[f], dst[f]), num(b && b[f], dst[f]), k);
};
const itemKey = it => it.id || it.glyph;
const sameSlot = (a, b) => itemKey(a) === itemKey(b) && (a.on || a.space) === (b.on || b.space);
// An item with no partner in the other pose appears or leaves: it fades, or with blend: 'grow' it scales
// from its origin at full opacity (a flag grows out of the fist instead of ghosting in; overlapping rects
// of a fading glyph show through each other). k is how much of it shows, 0..1.
const appear = (it, k) => (it.blend === 'grow' ? { ...it, s: num(it.s, 1) * k } : { ...it, o: num(it.o, 1) * k });
function mixItems(A = [], B = [], k) {
  const out = [];
  const used = new Set();
  for (const a of A) {
    const bi = B.findIndex((b, i) => !used.has(i) && sameSlot(a, b));
    if (bi < 0) { out.push(appear(a, 1 - k)); continue; }
    used.add(bi);
    const b = B[bi];
    const m = { ...(k < 0.5 ? a : b) };
    for (const f of ['x', 'y', 'rot', 'sx', 'sy', 's', 'o']) {
      if (f in a || f in b) m[f] = lerp(num(a[f], f === 'o' || f[0] === 's' ? 1 : 0), num(b[f], f === 'o' || f[0] === 's' ? 1 : 0), k);
    }
    out.push(m);
  }
  B.forEach((b, i) => { if (!used.has(i)) out.push(appear(b, k)); });
  return out;
}

// True when a visible prop in one pose has no partner (same id or glyph, same parent) in the other.
function propsDiffer(a, b) {
  const A = a.props || [];
  const B = b.props || [];
  const shown = it => num(it.o, 1) > 0.001;
  const lone = (L, M) => L.some(it => shown(it) && !M.some(o => shown(o) && sameSlot(it, o)));
  return lone(A, B) || lone(B, A);
}

// The skin colour two tints blend through: each side's tinted body colour, mixed. Only used while two
// different tint colours blend, so the string it builds is short-lived.
function mixTint(a, b, k) {
  const ta = a.tint && a.tint.color ? a.tint : null;
  const tb = b.tint && b.tint.color ? b.tint : null;
  const ka = ta ? num(ta.k, 0) : 0;
  const kb = tb ? num(tb.k, 0) : 0;
  if (!ta && !tb) return null;
  if (!ta || !tb || ta.color === tb.color) {
    const color = (tb || ta).color;
    return ka || kb ? { color, k: lerp(ka, kb, k) } : null;
  }
  const A = hex(tinted(PALETTE.body, ta.color, ka));
  const B = hex(tinted(PALETTE.body, tb.color, kb));
  return { color: `#${A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, '0')).join('')}`, k: 1 };
}

// Blend two poses (k = 0 is a, 1 is b): numbers interpolate, styles switch at the midpoint, items with the
// same id (or glyph) and parent interpolate, the others fade (or grow) in and out, and two different tints
// blend through their colours. The Player uses it between clips.
export function mixPose(a, b, k) {
  const p = rest();
  for (const n of ['root', 'body', 'armL', 'armR']) xf(p[n], a[n], b[n], k);
  for (let i = 0; i < 4; i++) {
    const la = (a.legs && a.legs[i]) || {};
    const lb = (b.legs && b.legs[i]) || {};
    const L = p.legs[i];
    L.rot = lerp(num(la.rot, 0), num(lb.rot, 0), k);
    L.lift = lerp(num(la.lift, 0), num(lb.lift, 0), k);
    L.x = lerp(num(la.x, 0), num(lb.x, 0), k);
    L.o = lerp(num(la.o, 1), num(lb.o, 1), k);
    L.len = la.len == null && lb.len == null ? null : k < 0.5 ? la.len ?? null : lb.len ?? null;
  }
  const ea = a.eyes || p.eyes;
  const eb = b.eyes || p.eyes;
  xf(p.eyes, ea, eb, k);
  const es = k < 0.5 ? ea : eb;
  p.eyes.style = es.style || 'open';
  p.eyes.L = es.L || null;
  p.eyes.R = es.R || null;
  if (a.mouth && b.mouth && a.mouth.style === b.mouth.style) {
    p.mouth = { style: b.mouth.style, x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1 };
    xf(p.mouth, a.mouth, b.mouth, k);
  } else {
    p.mouth = k < 0.5 ? a.mouth || null : b.mouth || null;
  }
  p.tint = mixTint(a, b, k);
  p.props = mixItems(a.props, b.props, k);
  p.fx = mixItems(a.fx, b.fx, k);
  return p;
}

// ---------- geometry: pose -> flat list of transformed rects ----------

// 2x3 affine matrices [a, b, c, d, e, f], as SVG's matrix(): (x, y) -> (a x + c y + e, b x + d y + f).
const RAD = Math.PI / 180;
function setLocal(m, tx, ty, px, py, deg, sx, sy) { // T(tx, ty) . T(p) . R(deg) . S(sx, sy) . T(-p)
  const r = deg * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  m[0] = a; m[1] = b; m[2] = c; m[3] = d;
  m[4] = tx + px - (a * px + c * py);
  m[5] = ty + py - (b * px + d * py);
  return m;
}
function mul(out, A, B) { // out = A . B (out may alias neither)
  out[0] = A[0] * B[0] + A[2] * B[1];
  out[1] = A[1] * B[0] + A[3] * B[1];
  out[2] = A[0] * B[2] + A[2] * B[3];
  out[3] = A[1] * B[2] + A[3] * B[3];
  out[4] = A[0] * B[4] + A[2] * B[5] + A[4];
  out[5] = A[1] * B[4] + A[3] * B[5] + A[5];
  return out;
}
const M = () => new Float64Array(6);
const ID = Float64Array.of(1, 0, 0, 1, 0, 0);
const S = { root: M(), bodyL: M(), body: M(), armL: M(), armR: M(), tmp: M(), tmp2: M(), item: M(), up: M() };

// Tint colours are cached so a steady flush allocates nothing per frame. A full tint (k = 1) is the colour
// itself and is not cached: mixPose hands over blended colours that way.
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const tintCache = new Map();
function tinted(base, color, k) {
  if (!color || !(k > 0)) return base;
  if (k >= 1) return color;
  const q = Math.round(clamp(k) * 64);
  let row = tintCache.get(color);
  if (!row) tintCache.set(color, (row = []));
  if (!row[q]) {
    const A = hex(base);
    const B = hex(color);
    row[q] = `#${A.map((v, i) => Math.round(lerp(v, B[i], q / 64)).toString(16).padStart(2, '0')).join('')}`;
  }
  return row[q];
}

function emit(out, n, x, y, w, h, fill, m, o, tag) {
  let s = out[n];
  if (!s) s = out[n] = { x: 0, y: 0, w: 0, h: 0, fill: '', m: [1, 0, 0, 1, 0, 0], o: 1, part: '' };
  s.x = x; s.y = y; s.w = w; s.h = h; s.fill = fill; s.o = o; s.part = tag;
  const d = s.m;
  d[0] = m[0]; d[1] = m[1]; d[2] = m[2]; d[3] = m[3]; d[4] = m[4]; d[5] = m[5];
  return n + 1;
}

function emitGlyph(out, n, g, m, o, fillOverride) {
  for (const r of g.rects) n = emit(out, n, r.x, r.y, r.w, r.h, fillOverride || r.fill, m, o, g.tag);
  return n;
}

// An item's parent matrix; with upright, the matrix whose orientation it keeps (one level up).
function parentOf(it, isProp, upright) {
  const where = isProp ? it.on || 'body' : it.space || 'world';
  switch (where) {
    case 'world': return ID;
    case 'root': return upright ? ID : S.root;
    case 'body': return upright ? S.root : S.body;
    case 'armL': return upright ? S.body : S.armL;
    case 'armR': return upright ? S.body : S.armR;
    default: MISSING.add(`parent:${where}`); return S.body;
  }
}

function emitItems(out, n, list, isProp, z) {
  if (!list) return n;
  for (const it of list) {
    if (num(it.z, isProp ? 0 : 1) !== z) continue;
    const o = num(it.o, 1);
    if (!(o > 0.001)) continue;
    const g = GLYPHS[it.glyph];
    if (!g) { MISSING.add(String(it.glyph)); continue; }
    const s = num(it.s, 1);
    if (!(Math.abs(s) > 0.001)) continue; // grown down to nothing (a blend: 'grow' item leaving)
    const x = num(it.x, 0);
    const y = num(it.y, 0);
    const P = parentOf(it, isProp, false);
    let M;
    if (it.upright) {
      // Ride on the parent's point (x, y) but keep the orientation one level up: a flag in a raised
      // hand stays upright with the body instead of turning with the arm.
      const U = parentOf(it, isProp, true);
      const A = S.up;
      A[0] = U[0]; A[1] = U[1]; A[2] = U[2]; A[3] = U[3];
      A[4] = P[0] * x + P[2] * y + P[4];
      A[5] = P[1] * x + P[3] * y + P[5];
      M = mul(S.item, A, setLocal(S.tmp, 0, 0, 0, 0, num(it.rot, 0), num(it.sx, 1) * s, num(it.sy, 1) * s));
    } else {
      M = mul(S.item, P, setLocal(S.tmp, x, y, 0, 0, num(it.rot, 0), num(it.sx, 1) * s, num(it.sy, 1) * s));
    }
    n = emitGlyph(out, n, g, M, clamp(o), it.fill);
  }
  return n;
}

function emitEye(out, n, E, rig, side, own) {
  const g = faceGlyph('eye_', own || E.style || 'open', side);
  if (!g) return n;
  setLocal(S.tmp, rig.pivot[0] + num(E.x, 0), rig.pivot[1] + num(E.y, 0), 0, 0, 0, num(E.sx, 1), num(E.sy, 1));
  return emitGlyph(out, n, g, mul(S.item, S.body, S.tmp), clamp(num(E.o, 1)), null);
}

function emitArm(out, n, arm, rig, m, skin, tag) {
  const o = num(arm && arm.o, 1);
  const shade = clamp(num(arm && arm.shade, 0));
  return o > 0.001 ? emit(out, n, rig.x, rig.y, rig.w, rig.h, shade > 0 ? tinted(skin, PALETTE.paw, shade) : skin, m, clamp(o), tag) : n;
}

function armMatrix(dst, arm, rig, side) {
  const a = arm || {};
  setLocal(S.tmp, num(a.x, 0), num(a.y, 0), rig.pivot[0], rig.pivot[1], side * num(a.rot, 0), num(a.sx, 1), num(a.sy, 1));
  return mul(dst, S.body, S.tmp);
}

// shapesAt(pose, out?) -> [{ x, y, w, h, fill, m: [a, b, c, d, e, f], o, part }], back to front.
// (x, y, w, h) is the rect in its local frame and m maps it into view (world) units. Pass the previous
// result as `out` to reuse its objects; the Player does, so a frame allocates nothing here.
export function shapesAt(pose, out = []) {
  const R = pose.root || {};
  const B = pose.body || {};
  setLocal(S.root, num(R.x, 0), num(R.y, 0), 0, 0, num(R.rot, 0), num(R.sx, 1), num(R.sy, 1));
  const bp = RIG.body.pivot;
  setLocal(S.bodyL, num(B.x, 0), num(B.y, 0), bp[0], bp[1], num(B.rot, 0), num(B.sx, 1), num(B.sy, 1));
  mul(S.body, S.root, S.bodyL);
  armMatrix(S.armL, pose.armL, RIG.armL, 1);
  armMatrix(S.armR, pose.armR, RIG.armR, -1);
  const tint = pose.tint;
  const skin = tint ? tinted(PALETTE.body, tint.color, num(tint.k, 0)) : PALETTE.body;
  let n = 0;

  n = emitItems(out, n, pose.props, true, -1);
  n = emitItems(out, n, pose.fx, false, -1);

  // Legs: hips follow the body's bottom edge; each leg keeps its own angle and reaches for the ground.
  const BL = S.bodyL;
  for (let i = 0; i < 4; i++) {
    const L = (pose.legs && pose.legs[i]) || {};
    const o = num(L.o, 1);
    const rig = RIG.legs[i];
    const hx0 = rig.pivot[0] + num(L.x, 0);
    const hy0 = rig.pivot[1];
    const hx = BL[0] * hx0 + BL[2] * hy0 + BL[4];
    const hy = BL[1] * hx0 + BL[3] * hy0 + BL[5];
    const deg = -num(L.rot, 0);
    const r = deg * RAD;
    const cos = Math.cos(r);
    const sin = Math.abs(Math.sin(r));
    let len = L.len;
    if (typeof len !== 'number' || !Number.isFinite(len)) len = (-hy - num(L.lift, 0) - 0.5 * sin) / Math.max(0.2, cos);
    len = clamp(len, 0.2, 6);
    if (!(o > 0.001)) continue;
    setLocal(S.tmp, hx, hy, 0, 0, deg, 1, 1);
    n = emit(out, n, -0.5, -LEG_OVERLAP, 1, len + LEG_OVERLAP, skin, mul(S.tmp2, S.root, S.tmp), clamp(o), 'leg');
  }

  const rb = RIG.body;
  if (num(B.o, 1) > 0.001) n = emit(out, n, rb.x, rb.y, rb.w, rb.h, skin, S.body, clamp(num(B.o, 1)), 'body');

  const E = pose.eyes || {};
  if (num(E.o, 1) > 0.001) {
    n = emitEye(out, n, E, RIG.eyeL, '_l', E.L);
    n = emitEye(out, n, E, RIG.eyeR, '_r', E.R);
  }
  const Mo = pose.mouth;
  if (Mo && Mo.style && num(Mo.o, 1) > 0.001) {
    const g = faceGlyph('mouth_', Mo.style, '');
    if (g) {
      setLocal(S.tmp, MOUTH_AT[0] + num(Mo.x, 0), MOUTH_AT[1] + num(Mo.y, 0), 0, 0, num(Mo.rot, 0), num(Mo.sx, 1), num(Mo.sy, 1));
      n = emitGlyph(out, n, g, mul(S.item, S.body, S.tmp), clamp(num(Mo.o, 1)), null);
    }
  }

  n = emitItems(out, n, pose.props, true, 0);
  n = emitItems(out, n, pose.fx, false, 0);

  n = emitArm(out, n, pose.armL, RIG.armL, S.armL, skin, 'armL');
  n = emitArm(out, n, pose.armR, RIG.armR, S.armR, skin, 'armR');

  n = emitItems(out, n, pose.props, true, 1);
  n = emitItems(out, n, pose.fx, false, 1);
  out.length = n;
  return out;
}

// World-space corners of a shape, [[x, y] x 4] (tests and tools).
export function corners(s) {
  const m = s.m;
  return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
}

// Largest difference between two shape lists, Infinity when their structure differs (tests, blends).
export function shapesDiff(A, B) {
  if (A.length !== B.length) return Infinity;
  let d = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = B[i];
    if (a.fill !== b.fill) return Infinity;
    const ca = corners(a);
    const cb = corners(b);
    for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(ca[j][0] - cb[j][0]), Math.abs(ca[j][1] - cb[j][1]));
    d = Math.max(d, Math.abs(a.o - b.o) * 4); // an opacity step of 0.25 weighs like a unit move
  }
  return d;
}

// ---------- clips ----------

export const ANIMS = Object.create(null);

// register(name, { dur, loop, loopFrom, next, grounded, pose(t, ctx) }). dur in ms. pose(t, ctx) must be a
// pure function of t (0..dur) and ctx: build the pose with rest(), never read the clock or Math.random.
// ctx = { name, dur, seed, side (+1 for odd seeds, -1 for even), rnd(k) in [0, 1), range(k, lo, hi) }.
// loopFrom (loops only, default 0): the first pass plays 0..dur, later passes loopFrom..dur, so 0..loopFrom
// is a one-time intro (sleeping sinks into its loaf, cool's shades slide down). The seam is then
// pose(dur) = pose(loopFrom).
export function register(name, def, registry = ANIMS) {
  if (typeof name !== 'string' || !name) throw new Error('register: name required');
  if (registry[name]) throw new Error(`register: ${name} is already registered`);
  const { dur, loop = false, loopFrom = 0, next = null, grounded = false, pose } = def || {};
  if (!(Number.isFinite(dur) && dur > 0)) throw new Error(`register ${name}: dur must be a positive number of ms`);
  if (typeof pose !== 'function') throw new Error(`register ${name}: pose(t, ctx) is required`);
  if (!(Number.isFinite(loopFrom) && loopFrom >= 0 && loopFrom < dur)) throw new Error(`register ${name}: loopFrom must be in [0, dur)`);
  if (loopFrom && !loop) throw new Error(`register ${name}: loopFrom needs loop: true`);
  registry[name] = Object.freeze({ name, dur, loop: !!loop, loopFrom, next, grounded: !!grounded, pose });
  return registry[name];
}

// Where a clip is after t ms of play: a loop runs 0..dur once, then wraps within loopFrom..dur; a one-shot
// stops at dur.
export function loopTime(def, t) {
  if (t < def.dur) return Math.max(0, t);
  if (!def.loop) return def.dur;
  const from = def.loopFrom || 0;
  return from + ((t - def.dur) % (def.dur - from));
}

export function makeCtx(def, seed = 1) {
  const s = seed >>> 0;
  return {
    name: def.name, dur: def.dur, seed: s,
    side: s & 1 ? 1 : -1, // odd seeds go right, even seeds left (the Player's seeds are random)
    rnd: k => hash01(s, k),
    range: (k, lo, hi) => lo + (hi - lo) * hash01(s, k),
  };
}

// The pose of clip `name` at t ms (clamped to 0..dur; loops are not wrapped, so t = dur is the seam).
export function evalAnim(name, t, seed = 1, anims = ANIMS) {
  const def = anims[name];
  if (!def) throw new Error(`evalAnim: unknown clip ${name}`);
  return def.pose(clamp(t, 0, def.dur), makeCtx(def, seed));
}

// ---------- the Player (what the dashboard's mood engine drives; the refinements are noted on the class) ----------

export const BLEND_MS = 130;         // the blend between clips, when the poses are close
export const BLEND_MS_PER_UNIT = 60; // plus this per unit the body, arms or legs must travel (an arm raised
export const BLEND_MAX_MS = 450;     // to the flag, a walk interrupted far out), so a big change never snaps
export const PROP_BLEND_MS = 300;    // at least this when a prop arrives or leaves (the desk, the flag, a page)
const TRAVEL_PARTS = new Set(['leg', 'body', 'armL', 'armR']);

// The largest distance any corner of the body, the arms or the legs moves between two shape lists.
function cornerGap(a, b) {
  const ma = a.m;
  const mb = b.m;
  let d = 0;
  for (let k = 0; k < 4; k++) {
    const u = k === 1 || k === 2 ? 1 : 0;
    const v = k >= 2 ? 1 : 0;
    const ax = a.x + u * a.w;
    const ay = a.y + v * a.h;
    const bx = b.x + u * b.w;
    const by = b.y + v * b.h;
    d = Math.max(d, Math.abs(ma[0] * ax + ma[2] * ay + ma[4] - mb[0] * bx - mb[2] * by - mb[4]),
      Math.abs(ma[1] * ax + ma[3] * ay + ma[5] - mb[1] * bx - mb[3] * by - mb[5]));
  }
  return d;
}
function travel(A, B) {
  let d = 0;
  let j = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    if (!TRAVEL_PARTS.has(a.part)) continue;
    while (j < B.length && B[j].part !== a.part) j++;
    if (j >= B.length) break;
    d = Math.max(d, cornerGap(a, B[j++]));
  }
  return d;
}
export const LIFE = Object.freeze([['walk', 0.6], ['hop', 0.4]]); // idle life, with pick weights
export const LIFE_SHARE = 0.25; // of the moving budget left after blinks and glances; breaths get the rest
// Calm idle's own clips until setIdleClips says otherwise (the behaviour map's idleBlink, idleGlance, idleLife).
const IDLE_CLIPS = Object.freeze({
  blink: 'blink', glance: Object.freeze(['look_left', 'look_right']), life: Object.freeze(LIFE.map(([n]) => n)),
});
const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

// Calm idle's budget (spec §8), with Clawd's clip lengths: mean intervals, counted in still time only.
export function idlePlan({ blinksPerMin = 26, glancesPerMin = 2, movingPct = 50 } = {}, { blink = 160, glance = 900, breath = 2000, life = 2000 } = {}) {
  const M = Math.min(0.95, Math.max(0.05, movingPct / 100));
  const Sm = 60000 * (1 - M);
  const B = Math.max(0, blinksPerMin);
  const G = Math.max(0, glancesPerMin);
  const free = Math.max(0, 60000 * M - B * blink - G * glance);
  const L = life > 0 ? (free * LIFE_SHARE) / life : 0;
  const R = breath > 0 ? (free * (1 - LIFE_SHARE)) / breath : 0;
  return {
    blinkMs: B ? Sm / B : Infinity, glanceMs: G ? Sm / G : Infinity,
    breathMs: R ? Sm / R : Infinity, lifeMs: L ? Sm / L : Infinity,
  };
}

const HOLD_POSE = rest();

// The dashboard's player: setBase (a base or an alternating list), play (a queue of one-shots), next chains
// and calm idle, as the mood engine expects them (spec §8). Beyond plain playback:
// - Every clip change is a blend whose length follows how far the body, arms and legs must travel, and is
//   longer when a prop arrives or leaves. The outgoing clip keeps playing while it fades.
// - Loops wrap to their loopFrom after the first pass (a one-time intro).
// - A base that is a single one-shot (the mood engine's yawning) plays once, then holds calm idle (without
//   walks or hops) until the base changes, instead of replaying and being cut off mid-yawn.
// - Calm idle's own clips (blink, glances, breaths, walk, hop) yield to a new base at once; one-shots the
//   caller played still finish first. Which clips calm idle uses is setIdleClips' choice; they never chain.
export class Player {
  constructor({ anims = ANIMS, idle = {}, rand = Math.random, blendMs = BLEND_MS } = {}) {
    this.anims = anims;
    this.rand = rand;
    this.blendMs = blendMs;
    this.base = ['idle'];
    this.bi = 0;
    this.baseDone = false; // the single one-shot base has played
    this.queue = [];
    this.movingMs = 0;
    this.counts = { blink: 0, glance: 0, breath: 0, life: 0 };
    this.pose = HOLD_POSE;
    this.blend = null;
    this.dirty = true;
    this._pool = [];
    this._cmpA = [];
    this._cmpB = [];
    this.idleClips = { blink: IDLE_CLIPS.blink, glance: [...IDLE_CLIPS.glance], life: [...IDLE_CLIPS.life] };
    this._life = LIFE; // idle life's pick weights: [[name, weight]]
    this.setIdle(idle);
    this._toBase();
  }

  // The clip lengths idlePlan budgets with: the glances' mean, and the pick-weighted mean of the life clips.
  _durs() {
    const a = this.anims;
    const d = n => (a[n] ? a[n].dur : 0);
    const { blink, glance } = this.idleClips;
    const life = this._life.filter(([n]) => a[n]);
    const w = life.reduce((s, [, p]) => s + p, 0);
    return {
      blink: d(blink),
      glance: glance.reduce((s, n) => s + d(n), 0) / glance.length,
      breath: d('breath'),
      life: w ? life.reduce((s, [n, p]) => s + (p / w) * a[n].dur, 0) : 0,
    };
  }

  setIdle(idle) {
    this.idleOpts = idle; // kept for setIdleClips, which re-plans with the same budget
    this.plan = idlePlan(idle, this._durs());
    const has = n => !!this.anims[n];
    if (!has(this.idleClips.blink)) this.plan.blinkMs = Infinity;
    if (!this.idleClips.glance.every(has)) this.plan.glanceMs = Infinity;
    if (!has('breath')) this.plan.breathMs = Infinity;
    if (!this._life.some(([n]) => has(n))) this.plan.lifeMs = Infinity;
    this.t = {
      blink: this._draw(this.plan.blinkMs), glance: this._draw(this.plan.glanceMs),
      breath: this._draw(this.plan.breathMs), life: this._draw(this.plan.lifeMs),
    };
  }

  // Calm idle's own clips: { blink: name, glance: [names], life: [names] } (the behaviour map's idleBlink,
  // idleGlance and idleLife). Glance and life are picked uniformly, except life ['walk', 'hop'], which keeps
  // LIFE's 0.6 / 0.4. Unknown names and loops (which would never hand back to the hold) are ignored; a field
  // left with no clip, or missing, is its default. The idle plan is recomputed with the new clips' lengths
  // (timers redrawn); the same clips again change nothing. The base and a clip already playing are untouched.
  setIdleClips(clips) {
    const c = clips !== null && typeof clips === 'object' ? clips : {};
    const ok = n => typeof n === 'string' && Object.prototype.hasOwnProperty.call(this.anims, n) && !this.anims[n].loop;
    const names = (v, dflt) => { const l = [].concat(v).filter(ok); return l.length ? l : [...dflt]; };
    const next = {
      blink: ok(c.blink) ? c.blink : IDLE_CLIPS.blink,
      glance: names(c.glance, IDLE_CLIPS.glance),
      life: names(c.life, IDLE_CLIPS.life),
    };
    const cur = this.idleClips;
    if (next.blink === cur.blink && sameList(next.glance, cur.glance) && sameList(next.life, cur.life)) return;
    this.idleClips = next;
    this._life = sameList(next.life, IDLE_CLIPS.life) ? LIFE : next.life.map(n => [n, 1]);
    this.setIdle(this.idleOpts);
  }

  _draw(mean) { return Number.isFinite(mean) ? mean * (0.6 + 0.8 * this.rand()) : Infinity; } // uniform, ±40% of the mean
  _baseName() { return this.base[this.bi % this.base.length]; }

  // Switch clips with a blend. The outgoing clip keeps playing while it fades (live), so its motion carries
  // on instead of freezing. A second switch in the same tick (the page calls setBase, then play) keeps the
  // first switch's outgoing clip live; a switch later in a blend fades from the pose on screen.
  _set(clip, carry = 0) {
    const b0 = this.blend;
    const from = this.pose;
    const prev = this.cur;
    let live = null;
    if (b0 && b0.t === 0) live = b0.live;
    else if (prev && !prev.hold && !b0) live = { def: prev.def, ctx: prev.ctx, t: prev.t, dur: prev.dur, loop: prev.loop };
    this.cur = clip;
    clip.t = carry;
    this.dirty = true;
    const to = clip.hold ? HOLD_POSE : clip.def.pose(clamp(carry, 0, clip.dur), clip.ctx);
    const A = shapesAt(from, this._cmpA);
    const B = shapesAt(to, this._cmpB);
    let dur = 0;
    if (this.blendMs > 0) {
      dur = Math.min(BLEND_MAX_MS, this.blendMs + BLEND_MS_PER_UNIT * travel(A, B));
      if (propsDiffer(from, to)) dur = Math.max(dur, PROP_BLEND_MS);
    }
    this.blend = { from, live, t: 0, dur };
    this._compute();
    // Entering the hold from a pose that already rests needs no blend, so update() can go quiet at once.
    if (clip.hold && shapesDiff(A, B) < 1e-3) {
      this.blend = null;
      this.pose = HOLD_POSE;
    }
  }

  // The idle hold: rest, with calm idle on top. life: false leaves out walks and hops.
  _hold(life = true) { return { name: 'idle', def: null, ctx: null, t: 0, dur: Infinity, loop: true, next: null, isBase: true, hold: true, life }; }

  // once: a clip played as a moment (play, a queued clip, calm idle's own) runs one full cycle even if it loops.
  _clip(name, once = false) {
    if (name === 'idle' && this._baseName() === 'idle') return this._hold();
    const def = this.anims[name];
    const seed = Math.floor(this.rand() * 4294967296) >>> 0;
    return { name, def, ctx: makeCtx(def, seed), t: 0, dur: def.dur, loop: once ? false : def.loop, next: def.next || null, isBase: name === this._baseName() };
  }

  _toBase(carry = 0) {
    const n = this._baseName();
    if (n === 'idle') return this._set(this._hold());
    // A single one-shot base that has played holds calm idle until the base changes.
    if (this.baseDone && this.base.length === 1 && !this.anims[n].loop) return this._set(this._hold(false));
    this._set(this._clip(n), carry);
  }

  setBase(names) {
    const next = [].concat(names).filter(n => this.anims[n]);
    if (!next.length) return; // unknown names keep the current base
    if (next.length === this.base.length && next.every((n, i) => n === this.base[i])) return;
    this.base = next;
    this.bi = 0;
    this.baseDone = false;
    // A running one-shot finishes first, then the new base plays. A looping clip that is not the base
    // (happy, chained from jumping_joy after a base change mid-jump) would never finish, so it yields now,
    // and so does calm idle's own clip (a breath or a walk is decoration of the hold, not something to finish).
    if (this.cur.isBase || this.cur.idle || (this.cur.loop && !this.queue.length)) this._toBase();
  }

  play(names) {
    const list = [].concat(names).filter(n => this.anims[n]);
    if (!list.length) return;
    this.queue = list.slice(1);
    this._set(this._clip(list[0], true));
  }

  // One of calm idle's own clips.
  _idle(name) {
    if (!this.anims[name]) return;
    this.queue = [];
    const c = this._clip(name, true);
    c.idle = true;
    this._set(c);
  }

  _compute() {
    const c = this.cur;
    let p = c.hold ? HOLD_POSE : c.def.pose(clamp(c.t, 0, c.dur), c.ctx);
    const b = this.blend;
    if (b) {
      const k = b.dur > 0 ? clamp(b.t / b.dur) : 1;
      if (k >= 1) this.blend = null;
      else {
        const L = b.live;
        const from = L ? L.def.pose(loopTime(L.def, L.t + b.t), L.ctx) : b.from;
        p = mixPose(from, p, ease.sineInOut(k));
      }
    }
    this.pose = p;
  }

  // Advance by dt ms. Returns true while anything moves (draw a frame), false while holding still.
  update(dt) {
    if (this.blend) this.blend.t += dt;
    const c = this.cur;
    if (c.hold) {
      this.t.blink -= dt;
      this.t.glance -= dt;
      this.t.breath -= dt;
      this.t.life -= dt;
      if (this.t.glance <= 0) {
        this.t.glance = this._draw(this.plan.glanceMs);
        this.counts.glance++;
        this._idle(this._pickGlance());
      } else if (this.t.blink <= 0) {
        this.t.blink = this._draw(this.plan.blinkMs);
        this.counts.blink++;
        this._idle(this.idleClips.blink);
      } else if (c.life && this.t.life <= 0) {
        this.t.life = this._draw(this.plan.lifeMs);
        this.counts.life++;
        this._idle(this._pickLife());
      } else if (this.t.breath <= 0) {
        this.t.breath = this._draw(this.plan.breathMs);
        this.counts.breath++;
        this._idle('breath');
      } else if (this.blend) {
        this._compute();
        this.dirty = true;
      }
      return this.dirty;
    }
    this.movingMs += dt;
    c.t += dt;
    if (c.t >= c.dur) {
      const over = c.t - c.dur;
      if (c.loop) c.t = loopTime(c.def, c.t);
      // Calm idle's clips do not chain: a celebration picked as idle life would stay in its happy loop.
      else if (c.next && !c.idle && this.anims[c.next]) { this._set(this._clip(c.next), over); return true; }
      else if (this.queue.length) { this._set(this._clip(this.queue.shift(), true), over); return true; }
      else {
        if (c.isBase) {
          if (this.base.length > 1) this.bi++;
          else this.baseDone = true;
        }
        this._toBase(over);
        return true;
      }
    }
    this._compute();
    this.dirty = true;
    return true;
  }

  // One rand() each, as before: the default glances look left below 0.5, right above.
  _pickGlance() {
    const g = this.idleClips.glance;
    return g[Math.min(g.length - 1, Math.floor(this.rand() * g.length))];
  }

  _pickLife() {
    const life = this._life.filter(([n]) => this.anims[n]);
    let r = this.rand() * life.reduce((s, [, p]) => s + p, 0);
    for (const [n, p] of life) if ((r -= p) < 0) return n;
    return life[life.length - 1][0];
  }

  // The current frame's rects (a reused array: draw it before the next update).
  shapes() {
    this.dirty = false;
    return shapesAt(this.pose, this._pool);
  }
}
