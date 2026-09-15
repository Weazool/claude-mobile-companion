# Animating Clawd

Clawd is a live SVG rig: rectangles from the brief's table, moved by smooth transforms. A clip is a pure function
from time to a **pose** (plain data). The core turns poses into rects, the Player sequences clips and blends
between them, and `svg.js` draws them. You write poses.

| File | Owner | Names |
|---|---|---|
| `anims/base.js` | done: read it first | idle, blink, look_left, look_right, walk, hop (+ internal `breath`) |
| `anims/life.js` | life | yawning, sleeping, cool, low_tokens, sad, ending |
| `anims/work.js` | work | thinking, reading, working, compiling, surprised, curious |
| `anims/feelings.js` | feelings | happy_eyes, happy, jumping_joy, celebration, love, overloaded, angry, error |

Work only in your file. Do not edit `core.js` or `base.js`, and do not redraw Clawd. If you need a core change,
ask for it. Names and kinds are fixed in `SPEC` (core.js): loops stay loops, and `jumping_joy` and
`celebration` must have `next: 'happy'`. The tests enforce this.

## A clip

```js
import { register, rest, ease, keys, ramp, bump, osc } from '../core.js';
const { sineInOut, power2Out, backOut } = ease;

const SWAY = [[0, 0], [700, 1, sineInOut], [1400, -1, sineInOut], [2100, 0, sineInOut]]; // hoisted: no per-frame array

register('thinking', {
  dur: 2100,         // ms
  loop: true,        // base loops: seamless, played until the base changes
  grounded: true,    // feet on the floor the whole time (tested)
  pose(t, ctx) {     // t: 0..dur. ctx: { seed, side (+1 odd seed / -1 even), rnd(k), range(k, lo, hi), dur, name }
    const p = rest();
    p.body.rot = 2 * keys(t, SWAY);
    p.eyes.x = 0.6; p.eyes.y = -0.5;                       // eyes up and aside
    p.armR.rot = 20; p.armR.y = -1.5;                      // a hand to the "chin"
    p.fx.push({ glyph: 'dot', space: 'body', x: 5, y: -12, s: 0.6, o: ramp(t, 200, 400) - ramp(t, 1700, 1900) }); // in and out: seamless
    return p;
  },
});
```

`pose(t, ctx)` must be pure: build the pose from `rest()` every call, and never read the clock, `Math.random`
or module state. For per-play variety use `ctx` (the Player picks a random seed each time a clip starts).

A loop can have a one-time **intro**: `register(name, { dur, loop: true, loopFrom: 900, ... })` plays 0..dur the
first time, then loops loopFrom..dur, so the seam is pose(dur) = pose(loopFrom). `sleeping` sinks into its loaf
over its first 900 ms and `cool`'s shades slide down onto the face; neither repeats. A simple way to write one:
read the loop's tracks at `t - loopFrom` (wrapped), and in the intro (t < loopFrom) ease from the entry pose to them.

## Coordinates and signs

- Units are the rig's. The origin is the ground point under the body's centre; **y grows down**; the ground is y = 0.
  The view is `-16 -28 32 32`: about 18 units of headroom above the body (body top y = -10), x from -16 to 16.
- **Angles are degrees. A positive angle moves the part's free end toward +x.** body/root: the top leans
  right. legs: the foot swings right. **Arms are the exception: positive raises the arm, on both sides**, so
  symmetric poses use the same number for both.
- Item (prop/effect) `rot` is SVG's own: positive is clockwise.

## The pose

| Field | Meaning (pivot) |
|---|---|
| `root {x, y, rot, sx, sy}` | the whole character (pivot at the ground point (0,0)): walk offset, jump height (y < 0 is up), squash and stretch. Grounded clips keep `root.y = 0` and `root.rot = 0`. |
| `body {x, y, rot, sx, sy, o}` | the body (pivot at the bottom centre (0,-2)): lean, bob, breathe. Eyes, mouth and arms ride on it. |
| `armL`, `armR {x, y, rot, sx, sy, o}` | pivot at the shoulder, the arm's inner edge ((-6,-5) and (6,-5)). |
| `legs[0..3] {rot, lift, len, x, o}` | legs hang from hips on the body's bottom edge and **reach the ground by themselves**: lean or lower the body and they stretch or shorten. `lift` raises a foot (units), `len` overrides the length, `x` slides the hip. |
| `eyes {style, L, R, x, y, sx, sy, o}` | `style` is an eye glyph name without `eye_`; `L`/`R` override one eye (a wink). `x`/`y` offset both eyes; `sx`/`sy` scale each about its own centre (a blink is `sy` toward 0.15). |
| `mouth` | `null`, or `{style, x, y, rot, sx, sy, o}` drawn around `MOUTH_AT` (0, -4.5). |
| `tint` | `null`, or `{color, k}`: shifts the body, arms and legs toward `color` (`PALETTE.flush` for the red flush). |
| `props[]` | `{glyph, on, x, y, rot, sx, sy, s, o, z, fill, id, upright, blend}`, `on` = `'root'`, `'body'`, `'armL'` or `'armR'`. `x, y` are in the parent's **rest** coordinates, so a prop at the hand (7.5, -5.5) on `armR` moves with the arm. `upright: true` rides on the hand but keeps the body's orientation (a flag stays vertical). |
| `fx[]` | the same items with `space` = `'world'` or `'body'`: world stays put (confetti, rising Zs), body follows the lean and jumps ("!", thought dots). |

Draw order: items with `z: -1` go behind the character; then legs, body, eyes, mouth; then `z: 0` (props'
default) is in front of the face and behind the arms, so hands hold things; then arms; then `z: 1` (effects'
default). `o` is opacity; an item below 0.001 is not drawn. `fill` recolours a whole glyph (confetti).
`id` pairs an item across a clip change so the blend moves it instead of cross-fading it.
An item with no partner in the other clip fades in or out during the blend. A glyph whose rects overlap (ink
checks on white cloth, a logo on a lid) shows through itself while it fades and reads as a grey ghost, so give
it `blend: 'grow'`: it then scales in from its origin, and out to it, at full opacity. The flag grows out of
the fist, the laptop folds up out of the desk, the page and the dumbbells grow in the hands, the shades from
their centre. One-colour glyphs (the desk) fade cleanly.

## Helpers (all from `core.js`)

- `ease.*` (GSAP names): `sineIn/Out/InOut`, `power1..3 In/Out/InOut` (quad, cubic, quart), `backIn/Out/InOut(k, s)`,
  `elasticOut`, `expoOut`, `circOut`, `linear`.
- `keys(t, [[t0, v0], [t1, v1, ease], ...])` keyframes; each key's ease shapes the segment arriving at it (default sineInOut).
- `ramp(t, t0, t1, ease)` gives 0→1 across a window. `bump(t, t0, t1)` gives 0→1→0 (half sine). `osc(t, period, phase)` is a seamless sine.
  `wobble(t, period, decay)` is a dying wobble after t = 0.
- `hopY(t, t0, up, down, h)`: the reference jump, rising `up` ms on sineOut and falling `down` ms on power3In.
  `arc(k, h)` is a parabola, `ballistic(t, p0, v0, g)` a projectile (confetti), and `ramped(k, a)` gives { s, v, acc } for an eased trip.
- `lerp`, `clamp`, `invLerp`, `hash01(seed, k)`, `mulberry32(seed)`, `mixPose(a, b, k)`.

## Glyphs

Built in: eyes `open closed happy wide x heart squint half sad`; mouths `o O smile frown flat`; effects
`Z dot ! ? heart steam steam_big sweat spark spark_small confetti block`; props `flag1..flag4` (ripple shapes:
cycle them; the origin is the grip at the pole's foot), `laptop`, `dumbbell`, `page`, `page_turn1`, `page_turn2`,
`sunglasses` (place at body (0, -7)). `block` is a unit square: scale it for slices, flashes or bars.
All of them are defined at the top of `core.js`; see them in the mock page or with clawd-look (below).

Define your own in your file, at module level:

```js
import { defineGlyph, pixels, PALETTE } from '../core.js';
defineGlyph('bolt', pixels(['..y', '.yy', 'yy.', 'y..'], { px: 0.5, ox: 1.5, oy: 4 })); // origin bottom centre
defineGlyph('eye_dizzy', pixels(['##', '#.', '##'], { ox: 1, oy: 1.5 }));             // a new eye style: eyes.style = 'dizzy'
defineGlyph('mouth_grin', [[-1, 0, 2, 0.5, PALETTE.ink]]);                              // raw rects work too
```

`pixels(rows, { px, key, ox, oy })`: one character per pixel of `px` units; `.` is empty. The default key is
`#` ink, `w` white, `b` body, `r` flush, `h` heart, `g` steam grey, `y` yellow, `u` blue, `e` green. Runs merge
into single rects, so keep glyphs small: each rect is a DOM element on the phone. Mirrored eyes are
`eye_<style>_l` / `eye_<style>_r`. Prefix your glyph names with your file's theme to avoid clashes. The stage is
near-black: ink props need a light outline or must sit on the body (see the flag and the sunglasses).

## Conventions (the tests check 1–4, the lengths in 5, and 8–9)

1. **Loops are seamless.** The pose at `dur` equals the pose at `loopFrom` (0 unless the loop has an intro), and
   the frame across the seam moves no more than the clip moves anyway. Make the loop's length a whole number of
   every `osc` period, and return `keys` tracks to their first value. Items fade to the same opacity at both ends.
2. **One-shots start and end at rest.** The Player returns to the base afterwards. Use `backOut` or `wobble`
   into the end, but land exactly on rest at `dur`. A chained one-shot (`next`) ends on its successor's first
   pose instead: `jumping_joy` and `celebration` keep their ^ ^ eyes to the end, because `happy` starts at rest
   with ^ ^ eyes, so nothing flashes open at the handover.
3. **Grounded clips keep a foot on the floor.** Lean with `body.rot` (legs compensate), bob with `body.y`,
   squash with `root.sy`. Never use `root.y` or `root.rot` in a grounded clip.
4. **Only defined glyphs.** A typo shows up in `MISSING` and fails the tests. Everything must be finite.
5. **Durations.** One-shots should take 0.6–2 s: `surprised` about 0.8–1 s, `yawning` about 1.8 s (the mood engine
   makes it the base for 2.5 s, then sleeps; the Player plays it once and holds calm idle for the rest). Base
   loops should take 1.2–4 s; the quiet states that sit on screen for minutes may run longer (`low_tokens` 8 s,
   `ending` 6.4 s) so their beats read as a mood, not a tic. The tests allow 1.2–8 s. Base loops must read at
   arm's length: thinking, working, compiling, surprised, sleeping and overloaded should be told apart at a
   glance. `sleeping` is shown **dimmed** (brightness 0.32), so check it with `--dim` or in the mock.
6. **The house style (see base.js).** Nothing linear. Offset the parts: the eyes lead, the body follows, the arms
   trail and overshoot. Every motion has an ease. Anticipate big moves and settle after them.
7. **Arms are 2×2 nubs.** Turned past ~35° they read as diamonds. To raise them, slide them up the body's side
   with `y` (down to about -3) and tilt modestly.
8. **Stay in view.** x within ±14 including the arms; nothing above y = -27. (The test fails anything outside the
   viewBox itself.)
9. **Keep the rect count modest.** Every rect is a DOM element on the phone. The busiest frame (love's heart
   eyes and hearts) draws 53; the test caps a clip's frame at 60.

How the mood engine uses clips by default (`src/web/mood.js`; the page calls `setBase`, then `play`, in the same
tick). The user can remap each of these on the behaviours page (`src/web/behaviours.js` lists them):
- surprised plays on entering thinking or working. Busy sessions flip between thinking, working and reading
  every 1.5–5 s, so those loops are often seen for only a second or two, entry blend included.
- The needs-you base alternates surprised and curious, so both are one-shots.
- A finished turn plays surprised, then the happy_eyes base ("Your turn", 3 s).
- Fresh limits play jumping_joy, then the happy base (5.6 s), then cool.
- Going to sleep: the base is yawning for 2.5 s, then sleeping.
- Waking plays yawning, surprised, love over the idle base.
- A tap plays love, surprised or curious.
- After 8 s, thinking escalates to curious and compiling to look_left.

## Look at your work

```bash
node tools/clawd-look.mjs thinking --onion --out <scratch>/look        # a contact sheet: 10 frames across one dur
node tools/clawd-look.mjs all --out <scratch>/look                     # every registered clip, plus what is pending
node tools/clawd-look.mjs walk --span 600:890 --frames 10 --onion      # one stride, finely sampled
node tools/clawd-look.mjs --at hop:420 --scale 24                      # one large frame
node tools/clawd-look.mjs sleeping --dim                               # as the dashboard shows it asleep
node tools/clawd-look.mjs --switch thinking:working:1500               # the real Player changing base, frame by frame
node tools/clawd-look.mjs --icon 256 --out src/web                     # regenerate the Home Screen icon (the rest pose)
node --test test/clawd.test.mjs                                        # the rules above
```

Each sheet is a grid of frames on the dashboard's stage, labelled with t in ms. Loops sample 0..dur (the seam
is the step from the last cell back to the first); one-shots include both ends. The faint line is the ground
(y = 0) and the tick is x = 0. `--onion` overlays every sampled frame to show arcs and spacing, and `--seed 2`
gives the other `ctx.side`. Open the PNGs and look: do the feet stay on the line, does the motion have arcs,
does every part move at its own time? Sample finer (`--frames 24 --span a:b`) where it moves fast. Default out
is `<os tmp>/clawd-look`.

The live page is `http://localhost:<port>/web/clawd/mock.html`. It has chips for every clip with the dashboard's
bubbles, flows that replay the mood engine's sequences (yawn then sleep, wake, "Your turn", fresh limits, a busy
session, limits running down), 0.25x speed, a freeze-and-scrub slider, `?anim=walk&t=1200&seed=2` for a frozen
frame, and `clawdDebug.freeze(name, ms)` / `clawdDebug.play(name)` / `clawdDebug.flow('flow_turn')` in the console.

## How base.js does it (the style to match)

**blink** (160 ms): `eyes.sy` squeezes to 0.18 on `power2In`, holds 30 ms, and opens on `power2Out`. `eyes.y`
drops so the line sits on the lower lid, and `eyes.sx` widens it a little. Three fields and a curve per phase.

**look_left/right** (900 ms): the eyes dart first (`power3Out`, 140 ms) and squeeze slightly while they travel.
The body leans 3° after them (`sineOut`, starting 70 ms later), and the far arm lifts later still. All of it
holds, then returns on `power2InOut`/`sineInOut`. The three parts start at three different times: that offset
is what makes it feel alive.

**walk** (3.2 s): the seed picks the side and distance (3.5–5 units).
- `ramped()` eases the trip in and out, and the leg phase comes from the **distance covered** (`u = 2π · cycles · s`).
  So the legs slow down with the body and stop vertical, with no foot sliding and no end-of-clip snap.
- Legs 0 and 2 swing against 1 and 3 (`±22° · speed · sin u`). The swinging pair lifts its feet (`lift`), and the
  planted pair shortens by itself as the body dips (`body.y`) on each stride.
- The lean follows speed. The body tips back as it sets off and forward as it brakes (`-acc`), waddles once per
  stride, and rocks once when it stops (`wobble`, faded out before the next move).
- The arms swing against the waddle and dip a beat after the body (follow-through).
- The eyes lead: they look where it is going before it moves, and turn home with a blink at the far end.

**hop** (1 s): a crouch squash (root `sy` 0.84) anticipates the launch.
- `hopY` rises on sineOut for 380 ms and falls on power3In for 190 ms. It stretches at take-off and again as it
  falls, then squashes flat on contact and recovers with `backOut`.
- The arms trail the body up, float, then slam past rest on landing and spring back: the weight.
- The legs tuck and splay in the air and reach for the ground just before contact. The eyes go ^ ^ for the
  airtime, and the body tilts toward the seed's side.
- Every track is a hoisted `keys` array, so the whole clip reads as a timing sheet.

**breath** (2 s, internal): a 4.5% rise of the body, with the arms following 160 ms later. It is subtle on purpose.

## The Player (what plays your clip)

`new Player({ idle, rand })` is what the dashboard (`src/web/app.js`) drives:
- `setBase(names)`: a base or an alternating list. Unknown names are ignored, and the same base does not restart.
- `play(names)`: a queue of one-shots. `next` chains, and a chained loop yields to a new base.
- `setIdle({ blinksPerMin, glancesPerMin, movingPct })` sets the calm idle budget.
- `setIdleClips({ blink, glance, life })` picks calm idle's own clips (default `blink`, `[look_left, look_right]`,
  `[walk, hop]`): glances and life are picked uniformly, except walk and hop keep their 0.6 / 0.4. Unknown names
  and loops are ignored, and the budget is recomputed from the new clips' lengths.
- `update(dt)` returns false while holding still. `shapes()` returns the frame.

With the base `idle` it holds rest and adds blinks, glances, breaths and idle life (walk, hop) from the moving
budget. Beyond plain playback:
- **Every clip change is a blend** of 130 ms plus 60 ms for each unit the body, arms or legs must travel, up to
  450 ms, and at least 300 ms when a prop arrives or leaves. The outgoing clip keeps playing while it fades, so
  your first frame is reached smoothly from wherever Clawd was, with no jump and no freeze; a `setBase` and a
  `play` in the same tick keep the first clip playing too. Two different tints blend through their colours.
- **Loops with `loopFrom`** play their intro once, then wrap to `loopFrom`.
- **A base that is a single one-shot** (the mood engine's `yawning`) plays once, then holds calm idle without
  walks or hops until the base changes; it does not replay.
- **Calm idle's own clips** (blink, glances, breath, walk, hop) yield to a new base at once. One-shots the
  caller played still finish first. They never chain: a celebration picked as idle life returns to the hold.

Draw with `mountClawd(svg).render(player.shapes())`. The renderer makes its pool of `POOL_RECTS` (72) rects at
mount and reuses them, so animating never creates an element; the busiest frame draws about 60.
