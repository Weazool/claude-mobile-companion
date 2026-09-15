import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEHAVIOURS, GROUPS, DEFAULT_MAP, SLOTS, validateMap, clipsFrom, allowedClips } from '../src/web/behaviours.js';
import { SPEC, NAMES, ANIMS } from '../src/web/clawd/index.js';

// The brief's table: [group, key, label, slot, default]. The defaults reproduce what mood.js and the Player did
// before the map existed.
const TABLE = [
  ['work', 'thinking', 'Thinking', 'base', 'thinking'],
  ['work', 'reading', 'Reading', 'base', 'reading'],
  ['work', 'working', 'Working', 'base', 'working'],
  ['work', 'compiling', 'Building / testing', 'base', 'compiling'],
  ['work', 'startle', 'Starts working', 'play', 'surprised'],
  ['work', 'stillThinking', 'Still thinking', 'play', 'curious'],
  ['work', 'stillCompiling', 'Still building', 'play', 'look_left'],
  ['you', 'needsYou', 'Needs you', 'alt', ['surprised', 'curious']],
  ['you', 'turnDone', 'Turn ends', 'play', 'surprised'],
  ['you', 'yourTurn', 'Your turn', 'base', 'happy_eyes'],
  ['limits', 'fiveHourWarn', '5-hour ≥ 50%', 'base', 'low_tokens'],
  ['limits', 'lowWarning', 'Getting tired', 'play', 'surprised'],
  ['limits', 'fiveHourLow', '5-hour ≥ 80%', 'base', 'sad'],
  ['limits', 'fiveHourCritical', '5-hour ≥ 95%', 'base', 'ending'],
  ['limits', 'weeklyNearlyUsed', 'Week or Fable ≥ 95%', 'base', 'ending'],
  ['limits', 'limitReached', '5-hour limit reached', 'base', 'overloaded'],
  ['limits', 'weeklyLimitReached', 'Week or Fable limit reached', 'base', 'overloaded'],
  ['limits', 'rateLimited', 'Rate limited', 'base', 'overloaded'],
  ['limits', 'freshLimits', 'Limits reset', 'play', 'jumping_joy'],
  ['limits', 'freshLimitsAfter', 'Celebrating', 'base', 'happy'],
  ['limits', 'afterglow', 'Afterglow', 'base', 'cool'],
  ['errors', 'error', 'Error', 'base', 'error'],
  ['errors', 'errorRepeated', 'Errors in a row', 'base', 'angry'],
  ['moments', 'sessionStart', 'New session', 'play', 'curious'],
  ['moments', 'firstPromptOfDay', 'First prompt of the day', 'seq', ['love', 'surprised']],
  ['moments', 'tap', 'Tapped', 'pick', ['love', 'surprised', 'curious']],
  ['moments', 'wakeUp', 'Wakes up', 'seq', ['yawning', 'surprised', 'love']],
  ['idle', 'idle', 'Idle', 'base', 'idle'],
  ['idle', 'coolMoment', 'Cool moment', 'base', 'cool'],
  ['idle', 'idleBlink', 'Blink', 'play', 'blink'],
  ['idle', 'idleGlance', 'Glance', 'pick', ['look_left', 'look_right']],
  ['idle', 'idleLife', 'Idle life', 'pick', ['walk', 'hop']],
  ['idle', 'yawn', 'Yawn', 'base', 'yawning'],
  ['idle', 'asleep', 'Asleep', 'base', 'sleeping'],
  ['idle', 'offline', 'PC offline', 'base', 'sleeping'],
];

// The bubble each behaviour shows on the phone, as an example.
const BUBBLES = {
  thinking: 'Thinking…', reading: 'Reading app.js', working: 'Editing server.mjs', compiling: 'Running npm test',
  needsYou: 'Needs permission', yourTurn: 'Your turn',
  fiveHourWarn: '5-hour at 55%', fiveHourLow: '5-hour at 84%', fiveHourCritical: '5-hour at 96%', weeklyNearlyUsed: 'Week at 96%',
  limitReached: 'Limit reached · resets in 3h 00m', weeklyLimitReached: 'Week limit reached', rateLimited: 'Rate limited',
  freshLimitsAfter: 'Fresh limits!', error: 'Error', errorRepeated: 'Error', wakeUp: 'Good morning! / Hi!', asleep: 'Zzz…',
};

const CLIPS = clipsFrom(SPEC);
const ONE_SHOTS = NAMES.filter(n => !SPEC[n].loop);
const LOOPS = NAMES.filter(n => SPEC[n].loop);
const withOnly = (key, value) => validateMap({ [key]: value }, CLIPS)[key];
const def = key => DEFAULT_MAP[key];

test('the table: every behaviour in the brief, in order, with its group, label, slot and default', () => {
  assert.deepEqual(BEHAVIOURS.map(b => [b.group, b.key, b.label, b.slot, b.default]), TABLE);
  assert.deepEqual(GROUPS, [
    { key: 'work', label: 'When Claude works' },
    { key: 'you', label: 'When Claude needs you' },
    { key: 'limits', label: 'Your limits' },
    { key: 'errors', label: 'Errors' },
    { key: 'moments', label: 'Moments' },
    { key: 'idle', label: 'Idle and sleep' },
  ]);
  assert.deepEqual(Object.keys(DEFAULT_MAP), TABLE.map(r => r[1]));
  for (const b of BEHAVIOURS) assert.deepEqual(DEFAULT_MAP[b.key], b.default, b.key);
});

test('the table: when texts are plain words, bubbles are the phone\'s examples', () => {
  const keys = new Set();
  for (const b of BEHAVIOURS) {
    assert.ok(!keys.has(b.key), `${b.key} is listed twice`);
    keys.add(b.key);
    assert.ok(GROUPS.some(g => g.key === b.group), `${b.key}: unknown group ${b.group}`);
    assert.ok(b.slot in SLOTS, `${b.key}: unknown slot ${b.slot}`);
    assert.equal(typeof b.when, 'string', b.key);
    assert.ok(b.when.length >= 8 && b.when.length <= 90, `${b.key}: when text "${b.when}"`);
    // Plain language: no clip names (happy_eyes), no code, no markup.
    assert.doesNotMatch(b.when, /[_<>`{}]/, `${b.key}: when text "${b.when}"`);
    assert.doesNotMatch(b.label, /[_<>`{}]/, `${b.key}: label "${b.label}"`);
  }
  assert.deepEqual(Object.fromEntries(BEHAVIOURS.filter(b => b.bubble).map(b => [b.key, b.bubble])), BUBBLES);
  for (const b of BEHAVIOURS) if (!(b.key in BUBBLES)) assert.equal(b.bubble, undefined, `${b.key} has no bubble`);
  assert.ok(GROUPS.every(g => BEHAVIOURS.some(b => b.group === g.key)), 'no empty group');
});

test('the table and the defaults are frozen, so nobody changes the defaults by accident', () => {
  assert.ok(Object.isFrozen(BEHAVIOURS) && BEHAVIOURS.every(Object.isFrozen));
  assert.ok(Object.isFrozen(GROUPS) && GROUPS.every(Object.isFrozen));
  assert.ok(Object.isFrozen(DEFAULT_MAP));
  for (const v of Object.values(DEFAULT_MAP)) if (Array.isArray(v)) assert.ok(Object.isFrozen(v));
  assert.ok(Object.isFrozen(SLOTS) && Object.values(SLOTS).every(Object.isFrozen));
});

test('slot kinds: one name or a list, the list limits; moments take any clip but idle', () => {
  assert.deepEqual(SLOTS, {
    base: { list: false, max: 1, oneShots: false },
    alt: { list: true, max: 3, oneShots: false },
    play: { list: false, max: 1, oneShots: false, moment: true },
    seq: { list: true, max: 3, oneShots: false, moment: true },
    pick: { list: true, max: 4, oneShots: false, moment: true },
  });
});

test('clipsFrom: the server (SPEC) and the page (ANIMS) see the same 26 clips and kinds', () => {
  assert.deepEqual(Object.keys(CLIPS).sort(), [...NAMES].sort());
  for (const n of NAMES) assert.deepEqual(CLIPS[n], { loop: !!SPEC[n].loop }, n);
  assert.deepEqual(clipsFrom(ANIMS, NAMES), CLIPS, 'ANIMS with the fixed names: no internal breath');
  assert.equal(clipsFrom(ANIMS).breath.loop, false, 'without names, every registered clip');
  assert.deepEqual(clipsFrom({}), { idle: { loop: true } }, 'idle is always there, and loops');
  assert.deepEqual(clipsFrom({ a: { loop: true }, b: {} }, ['b', 'zz']), { idle: { loop: true }, b: { loop: false } }, 'names it does not know are skipped');
});

test('allowedClips: base and alt take every clip; play, seq and pick take every clip but idle', () => {
  assert.deepEqual(allowedClips('base', CLIPS).sort(), [...NAMES].sort());
  assert.deepEqual(allowedClips('alt', CLIPS).sort(), [...NAMES].sort());
  for (const slot of ['play', 'seq', 'pick']) assert.deepEqual(allowedClips(slot, CLIPS).sort(), [...NAMES].filter(n => n !== 'idle').sort(), slot);
  assert.equal(ONE_SHOTS.length, 11);
  assert.deepEqual(allowedClips('base', {}), ['idle']);
  assert.deepEqual(allowedClips('play', {}), []);
  assert.deepEqual(allowedClips('nope', CLIPS), []);
});

test('the defaults are valid against the rig: every default survives validation unchanged', () => {
  assert.deepEqual(validateMap(DEFAULT_MAP, CLIPS), DEFAULT_MAP);
  assert.deepEqual(validateMap(DEFAULT_MAP, clipsFrom(ANIMS, NAMES)), DEFAULT_MAP);
  for (const b of BEHAVIOURS) {
    const slot = SLOTS[b.slot];
    const list = [].concat(b.default);
    assert.equal(Array.isArray(b.default), slot.list, `${b.key}: a list slot has a list default`);
    assert.ok(list.length >= 1 && list.length <= slot.max, b.key);
    for (const n of list) assert.ok(allowedClips(b.slot, CLIPS).includes(n), `${b.key}: ${n} is allowed in a ${b.slot} slot`);
  }
});

test('validateMap returns the full map: missing keys get their default, unknown keys are dropped', () => {
  assert.deepEqual(validateMap({}, CLIPS), DEFAULT_MAP);
  for (const bad of [undefined, null, 42, 'thinking', [], ['thinking'], true]) assert.deepEqual(validateMap(bad, CLIPS), DEFAULT_MAP, String(bad));
  const m = validateMap({ thinking: 'reading', nope: 'hop', tap: ['hop'] }, CLIPS);
  assert.deepEqual(Object.keys(m), Object.keys(DEFAULT_MAP));
  assert.equal(m.thinking, 'reading');
  assert.deepEqual(m.tap, ['hop']);
  assert.equal('nope' in m, false);
  assert.deepEqual({ ...m, thinking: def('thinking'), tap: def('tap') }, DEFAULT_MAP, 'the other keys keep their defaults');
});

test('validateMap: a base takes any clip (a one-shot plays once) or idle, as one name', () => {
  for (const n of [...LOOPS, ...ONE_SHOTS, 'idle']) assert.equal(withOnly('thinking', n), n, n);
  for (const bad of ['nope', '', 'breath', 42, null, ['reading'], { name: 'reading' }, 'Thinking']) {
    assert.equal(withOnly('thinking', bad), 'thinking', JSON.stringify(bad));
  }
});

test('validateMap: an alt takes 1 to 3 names, loops or one-shots', () => {
  assert.deepEqual(withOnly('needsYou', ['happy_eyes']), ['happy_eyes']);
  assert.deepEqual(withOnly('needsYou', ['thinking', 'hop', 'idle']), ['thinking', 'hop', 'idle']);
  assert.deepEqual(withOnly('needsYou', ['love', 'love']), ['love', 'love'], 'a name may repeat');
  for (const bad of [[], ['love', 'love', 'love', 'love'], ['love', 'nope'], 'love', [42], null, [['love']]]) {
    assert.deepEqual(withOnly('needsYou', bad), ['surprised', 'curious'], JSON.stringify(bad));
  }
});

test('validateMap: a play takes one clip, a loop too (it plays one cycle), but not idle', () => {
  for (const n of [...ONE_SHOTS, ...LOOPS].filter(n => n !== 'idle')) assert.equal(withOnly('turnDone', n), n, n);
  for (const bad of ['idle', 'nope', ['love'], 7]) assert.equal(withOnly('turnDone', bad), 'surprised', JSON.stringify(bad));
});

test('validateMap: a seq takes 1 to 3 clips, a pick 1 to 4', () => {
  assert.deepEqual(withOnly('wakeUp', ['hop']), ['hop']);
  assert.deepEqual(withOnly('wakeUp', ['hop', 'walk', 'love']), ['hop', 'walk', 'love']);
  assert.deepEqual(withOnly('wakeUp', ['hop', 'walk', 'love', 'blink']), def('wakeUp'), 'a seq of 4 is too long');
  assert.deepEqual(withOnly('wakeUp', ['hop', 'sleeping']), ['hop', 'sleeping'], 'a loop in a seq plays one cycle');
  assert.deepEqual(withOnly('tap', ['hop', 'walk', 'love', 'blink']), ['hop', 'walk', 'love', 'blink']);
  assert.deepEqual(withOnly('tap', ['hop', 'walk', 'love', 'blink', 'curious']), def('tap'), 'a pick of 5 is too long');
  assert.deepEqual(withOnly('tap', []), def('tap'));
  assert.deepEqual(withOnly('idleGlance', ['idle']), def('idleGlance'), 'idle is the hold, not a moment');
  assert.deepEqual(withOnly('idleLife', 'walk'), def('idleLife'), 'a list slot needs a list');
});

test('validateMap only trusts clip names the rig owns (no prototype names, no clips object means only idle)', () => {
  for (const n of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(withOnly('thinking', n), 'thinking', n);
    assert.equal(withOnly('turnDone', n), 'surprised', n);
  }
  const spec = validateMap({ thinking: 'constructor' }, SPEC); // SPEC itself, not clipsFrom: still own names only
  assert.equal(spec.thinking, 'thinking');
  const polluted = JSON.parse('{"__proto__": {"thinking": "hop"}, "reading": "hop"}');
  const m = validateMap(polluted, CLIPS);
  assert.equal(m.thinking, 'thinking');
  assert.equal(m.reading, 'hop');
  assert.equal({}.thinking, undefined, 'no prototype pollution');
  assert.deepEqual(validateMap({ thinking: 'idle', turnDone: 'love' }, undefined), { ...DEFAULT_MAP, thinking: 'idle' });
});

test('validateMap returns fresh lists: changing the result never changes the defaults', () => {
  const m = validateMap({}, CLIPS);
  m.tap.push('hop');
  m.needsYou[0] = 'love';
  assert.deepEqual(DEFAULT_MAP.tap, ['love', 'surprised', 'curious']);
  assert.deepEqual(DEFAULT_MAP.needsYou, ['surprised', 'curious']);
  const input = { tap: ['hop'] };
  const v = validateMap(input, CLIPS);
  input.tap.push('walk');
  assert.deepEqual(v.tap, ['hop']);
  assert.ok(!Object.isFrozen(v.tap));
});

test('a validated map round-trips through JSON (what the server stores and sends)', () => {
  const m = validateMap({ thinking: 'reading', needsYou: ['happy_eyes'], tap: ['hop'], idleLife: ['walk'] }, CLIPS);
  assert.deepEqual(validateMap(JSON.parse(JSON.stringify(m)), CLIPS), m);
});
