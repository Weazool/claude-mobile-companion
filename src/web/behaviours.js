// Clawd's behaviours: which animation plays for each thing the companion reacts to.
// Pure: no DOM, no imports. Shared by mood.js and app.js (the phone), the behaviours editor page and the server.
// The defaults reproduce the companion as it was before the map existed (mood.js and the Player's calm idle).

// How a behaviour uses its animations. list: a list of names (else one name); max: the longest list;
// oneShots: only clips that finish (loop: false). No slot needs it now: a looping clip used as a moment plays one
// full cycle, then the companion moves on (the Player's once).
//   base: what he does while the state lasts (a one-shot plays once, then he holds still)
//   alt:  a base that alternates its names
//   play: one clip, played once
//   seq:  clips played once each, in order
//   pick: one clip picked at random each time
export const SLOTS = Object.freeze({
  base: Object.freeze({ list: false, max: 1, oneShots: false }),
  alt: Object.freeze({ list: true, max: 3, oneShots: false }),
  play: Object.freeze({ list: false, max: 1, oneShots: false, moment: true }),
  seq: Object.freeze({ list: true, max: 3, oneShots: false, moment: true }),
  pick: Object.freeze({ list: true, max: 4, oneShots: false, moment: true }),
});

export const GROUPS = Object.freeze([
  { key: 'work', label: 'When Claude works' },
  { key: 'you', label: 'When Claude needs you' },
  { key: 'limits', label: 'Your limits' },
  { key: 'errors', label: 'Errors' },
  { key: 'moments', label: 'Moments' },
  { key: 'idle', label: 'Idle and sleep' },
].map(Object.freeze));

// [group, key, label, slot, default, when, bubble?]. when: the moment, in the user's words. bubble: an example
// of the caption the phone shows meanwhile.
const ROWS = [
  ['work', 'thinking', 'Thinking', 'base', 'thinking', 'Claude is thinking between steps', 'Thinking…'],
  ['work', 'reading', 'Reading', 'base', 'reading', 'Claude reads or searches files', 'Reading app.js'],
  ['work', 'working', 'Working', 'base', 'working', 'Claude edits files or runs commands', 'Editing server.mjs'],
  ['work', 'compiling', 'Building / testing', 'base', 'compiling', 'A build or test command runs', 'Running npm test'],
  ['work', 'startle', 'Starts working', 'play', 'surprised', 'Clawd was idle and Claude starts a turn'],
  ['work', 'stillThinking', 'Still thinking', 'play', 'curious', 'Thinking for more than 8 s'],
  ['work', 'stillCompiling', 'Still building', 'play', 'look_left', 'A build runs for more than 8 s'],
  ['you', 'needsYou', 'Needs you', 'alt', ['surprised', 'curious'], 'A permission prompt or a question', 'Needs permission'],
  ['you', 'turnDone', 'Turn ends', 'play', 'surprised', 'Claude finishes its turn'],
  ['you', 'yourTurn', 'Your turn', 'base', 'happy_eyes', 'The 3 s after Claude finishes', 'Your turn'],
  ['limits', 'fiveHourWarn', '5-hour ≥ 50%', 'base', 'low_tokens', 'The 5-hour limit is at 50% or more (he is tired)', '5-hour at 55%'],
  ['limits', 'lowWarning', 'Getting tired', 'play', 'surprised', 'The 5-hour limit just crossed 50%'],
  ['limits', 'fiveHourLow', '5-hour ≥ 80%', 'base', 'sad', 'The 5-hour limit is at 80% or more', '5-hour at 84%'],
  ['limits', 'fiveHourCritical', '5-hour ≥ 95%', 'base', 'ending', 'The 5-hour limit is at 95% or more', '5-hour at 96%'],
  ['limits', 'weeklyNearlyUsed', 'Week or Fable ≥ 95%', 'base', 'ending', 'The weekly or Fable limit is at 95% or more', 'Week at 96%'],
  ['limits', 'limitReached', '5-hour limit reached', 'base', 'overloaded', 'The 5-hour limit is used up', 'Limit reached · resets in 3h 00m'],
  ['limits', 'weeklyLimitReached', 'Week or Fable limit reached', 'base', 'overloaded', 'The weekly or Fable limit is used up', 'Week limit reached'],
  ['limits', 'rateLimited', 'Rate limited', 'base', 'overloaded', 'A turn stopped on a rate limit', 'Rate limited'],
  ['limits', 'freshLimits', 'Limits reset', 'play', 'jumping_joy', 'A limit drops from 20% or more to under 10%'],
  ['limits', 'freshLimitsAfter', 'Celebrating', 'base', 'happy', 'The 5.6 s after the reset', 'Fresh limits!'],
  ['limits', 'afterglow', 'Afterglow', 'base', 'cool', 'The 8 s after celebrating'],
  ['errors', 'error', 'Error', 'base', 'error', 'A turn failed', 'Error'],
  ['errors', 'errorRepeated', 'Errors in a row', 'base', 'angry', 'Three failed turns in a row', 'Error'],
  ['moments', 'sessionStart', 'New session', 'play', 'curious', 'A Claude Code session starts while Clawd is idle'],
  ['moments', 'firstPromptOfDay', 'First prompt of the day', 'seq', ['love', 'surprised'], 'Your first prompt each day'],
  ['moments', 'tap', 'Tapped', 'pick', ['love', 'surprised', 'curious'], 'You tap Clawd'],
  ['moments', 'wakeUp', 'Wakes up', 'seq', ['yawning', 'surprised', 'love'], 'Activity wakes him from sleep', 'Good morning! / Hi!'],
  ['idle', 'idle', 'Idle', 'base', 'idle', 'Nothing to do: he holds still, with the blinks and glances below'],
  ['idle', 'coolMoment', 'Cool moment', 'base', 'cool', 'Now and then, when the 5-hour limit is at 5% or less'],
  ['idle', 'idleBlink', 'Blink', 'play', 'blink', 'About 26 times a minute while idle'],
  ['idle', 'idleGlance', 'Glance', 'pick', ['look_left', 'look_right'], 'About twice a minute while idle'],
  ['idle', 'idleLife', 'Idle life', 'pick', ['walk', 'hop'], 'Now and then while idle, a stroll or a hop'],
  ['idle', 'yawn', 'Yawn', 'base', 'yawning', 'Before he falls asleep'],
  ['idle', 'asleep', 'Asleep', 'base', 'sleeping', 'After 2 quiet minutes (the screensaver starts)', 'Zzz…'],
  ['idle', 'offline', 'PC offline', 'base', 'sleeping', 'The phone lost its connection to the PC'],
];

export const BEHAVIOURS = Object.freeze(ROWS.map(([group, key, label, slot, dflt, when, bubble]) => Object.freeze({
  key, group, label, when, slot,
  default: Array.isArray(dflt) ? Object.freeze([...dflt]) : dflt,
  ...(bubble ? { bubble } : {}),
})));

export const DEFAULT_MAP = Object.freeze(Object.fromEntries(BEHAVIOURS.map(b => [b.key, b.default])));

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// The kind of clip `name` is in `clips`: 'loop', 'once', or null when the rig does not have it. idle is always
// there and always loops (it is the Player's hold).
function kindOf(name, clips) {
  if (name === 'idle') return 'loop';
  if (typeof name !== 'string' || !own(clips, name)) return null;
  return clips[name] && clips[name].loop ? 'loop' : 'once';
}

const fits = (name, slot, clips) => {
  const k = kindOf(name, clips);
  // A moment (play, seq, pick) can be any clip but idle: idle is the hold, not something that plays and ends.
  return k !== null && (!slot.oneShots || k === 'once') && !(slot.moment && name === 'idle');
};

// The clip names a slot kind accepts, in the order of `clips` (idle first when it is not listed).
export function allowedClips(slotKind, clips) {
  const slot = own(SLOTS, slotKind) ? SLOTS[slotKind] : null;
  if (!slot) return [];
  const names = clips !== null && typeof clips === 'object' ? Object.keys(clips) : [];
  if (!names.includes('idle')) names.unshift('idle');
  return names.filter(n => fits(n, slot, clips));
}

// `clips` for validateMap: { [name]: { loop } } from a clip table such as the rig's SPEC (the server) or ANIMS
// (the page: pass NAMES as well, to leave out the Player's internal clips). idle is always included.
export function clipsFrom(registry, names = Object.keys(registry || {})) {
  const out = { idle: { loop: true } };
  for (const n of names) if (own(registry, n) && registry[n]) out[n] = { loop: !!registry[n].loop };
  return out;
}

// One behaviour's value if it is valid for its slot, else null.
function valid(b, value, clips) {
  const slot = SLOTS[b.slot];
  if (!slot.list) return fits(value, slot, clips) ? value : null;
  if (!Array.isArray(value) || value.length < 1 || value.length > slot.max) return null;
  return value.every(n => fits(n, slot, clips)) ? [...value] : null;
}

// The full map from untrusted input (a stored file, a POST, an SSE event): every behaviour's key, with each
// missing or bad value replaced by its default. clips: { [name]: { loop } }, see clipsFrom. A value is bad when
// its shape is wrong (one name vs a list, the list's length) or any name is unknown or not allowed in its slot.
export function validateMap(input, clips) {
  const map = {};
  for (const b of BEHAVIOURS) {
    const v = own(input, b.key) && !Array.isArray(input) ? valid(b, input[b.key], clips) : null;
    map[b.key] = v !== null ? v : Array.isArray(b.default) ? [...b.default] : b.default;
  }
  return map;
}
