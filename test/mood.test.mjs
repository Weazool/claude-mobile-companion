import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMood as makeMood } from '../src/web/mood.js';
import { ANIMS } from '../src/web/clawd/index.js';
import { BEHAVIOURS } from '../src/web/behaviours.js';

// Every animation name a command asks for, across all the scenarios below (the last test checks them
// against the Clawd rig the page plays them on).
const asked = new Set();
function createMood(...args) {
  const m = makeMood(...args);
  const note = c => { if (c) for (const n of [...[].concat(c.base), ...c.play]) asked.add(n); return c; };
  return Object.fromEntries(Object.entries(m).map(([k, f]) => [k, (...a) => note(f(...a))]));
}

const T0 = Date.UTC(2026, 8, 14, 9, 0);
const MIN = 60000;
const sess = (activity, extra = {}) => ({ id: 's1', name: 'p', modelLabel: 'Opus 5', effort: 'high', contextPct: 10, activity, detail: activity, needsYou: false, lastEventAt: 0, ...extra });
const snap = (sessions = [], limits = {}, focusId) => ({
  v: 1, serverTime: 0, sessions,
  focusId: focusId === undefined ? (sessions[0] ? sessions[0].id : null) : focusId,
  limits: { status: 'ok', asOf: 0, fiveHour: null, week: null, fable: null, ...limits },
});
const five = pct => ({ fiveHour: { pct, resetsAt: T0 + 12 * MIN } });
const mid = () => 0.5;

test('starts idle; an unchanged snapshot yields no command', () => {
  const m = createMood({}, { rand: mid });
  assert.deepEqual(m.onSnapshot(snap([sess('idle')]), T0), { base: 'idle', play: [], bubble: null, dim: false });
  assert.equal(m.onSnapshot(snap([sess('idle')]), T0 + 10), null);
});

test('a prompt: surprised into thinking; the first prompt of the day adds love', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 1000),
    { base: 'thinking', play: ['surprised'], bubble: { text: 'Thinking…', tone: '' }, dim: false });
  assert.deepEqual(m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 1001).play, ['love', 'surprised']);
  m.onSnapshot(snap([sess('done')]), T0 + 5000);
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 10000);
  assert.equal(m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 10001), null);
});

test('reading, working and compiling use their animation and the detail as bubble', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0);
  let t = T0;
  for (const [act, detail] of [['reading', 'Reading a.js'], ['working', 'Editing b.js'], ['compiling', 'Running npm test']]) {
    t += 2000;
    const c = m.onSnapshot(snap([sess(act, { detail })]), t);
    assert.deepEqual(c, { base: act, play: [], bubble: { text: detail, tone: '' }, dim: false });
  }
});

test('sideways activity changes wait 1.5 s to stop flicker', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('reading', { detail: 'Reading a' })]), T0);
  const c = m.onSnapshot(snap([sess('working', { detail: 'Editing b' })]), T0 + 500);
  assert.deepEqual([c.base, c.bubble.text], ['reading', 'Editing b']);
  assert.equal(m.tick(T0 + 1600).base, 'working');
});

test('thinking for 8 s adds one curious; compiling for 8 s adds one look_left', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0);
  assert.equal(m.tick(T0 + 7500), null);
  assert.deepEqual(m.tick(T0 + 8000).play, ['curious']);
  assert.equal(m.tick(T0 + 9000), null);
  m.onSnapshot(snap([sess('compiling', { detail: 'Running npm test' })]), T0 + 10000);
  assert.deepEqual(m.tick(T0 + 18000).play, ['look_left']);
});

test('needs you: surprised and curious alternate with an amber bubble, then back to work', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'Editing a.js' })]), T0);
  const c = m.onSnapshot(snap([sess('working', { needsYou: true, detail: 'Needs permission' })]), T0 + 1000);
  assert.deepEqual(c.base, ['surprised', 'curious']);
  assert.deepEqual(c.bubble, { text: 'Needs permission', tone: 'need' });
  assert.equal(m.onSnapshot(snap([sess('compiling', { detail: 'Running npm test' })]), T0 + 5000).base, 'compiling');
});

test('stop: surprised, then happy eyes for as long as it is your turn (spotlight mode), then back to work', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0 + 1000);
  assert.deepEqual(m.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 1001),
    { base: 'happy_eyes', play: ['surprised'], bubble: { text: 'Your turn', tone: 'good' }, dim: false });
  assert.equal(m.tick(T0 + 4002), null, 'the moment has passed, but it is still your turn');
  assert.equal(m.tick(T0 + MIN), null);
  assert.equal(m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + MIN + 1).base, 'thinking');
});

test('a background session finishing does not interrupt the focus session', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { id: 'A', detail: 'a' }), sess('done', { id: 'B' })], {}, 'A'), T0);
  assert.equal(m.onEvent({ type: 'stop', sessionId: 'B' }, T0 + 10), null);
});

test('limit moods while idle: 50 low (with surprised), 80 sad, 95 ending; activity wins', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('idle')], five(40)), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('idle')], five(55)), T0 + 1000),
    { base: 'low_tokens', play: ['surprised'], bubble: { text: '5-hour at 55%', tone: '' }, dim: false });
  assert.equal(m.onSnapshot(snap([sess('idle')], five(83)), T0 + 2000).base, 'sad');
  assert.equal(m.onSnapshot(snap([sess('idle')], five(96)), T0 + 3000).base, 'ending');
  assert.equal(m.onSnapshot(snap([sess('working', { detail: 'x' })], five(96)), T0 + 4000).base, 'working');
});

test('100% or rate limited is overloaded, even while working', () => {
  const m = createMood({}, { rand: mid });
  const c = m.onSnapshot(snap([sess('working', { detail: 'x' })], five(100)), T0);
  assert.deepEqual([c.base, c.bubble], ['overloaded', { text: 'Limit reached · resets in 12m', tone: 'bad' }]);
  const r = createMood({}, { rand: mid }).onSnapshot(snap([sess('rateLimited', { detail: 'Rate limited' })]), T0);
  assert.deepEqual([r.base, r.bubble.text], ['overloaded', 'Rate limited']);
});

test('week or Fable near the cap only shows while idle', () => {
  const m = createMood({}, { rand: mid });
  assert.deepEqual(m.onSnapshot(snap([sess('idle')], { week: { pct: 96, resetsAt: null } }), T0).bubble, { text: 'Week at 96%', tone: 'bad' });
  assert.equal(m.onSnapshot(snap([sess('idle')], { fable: { pct: 100, resetsAt: null } }), T0 + 1).base, 'overloaded');
  assert.equal(m.onSnapshot(snap([sess('reading', { detail: 'r' })], { fable: { pct: 100, resetsAt: null } }), T0 + 2).base, 'reading');
});

test('a week or Fable limit at 100% still yawns and sleeps once quiet', () => {
  const m = createMood({ sleepAfterMin: 5 }, { rand: mid });
  assert.equal(m.onSnapshot(snap([sess('idle')], { fable: { pct: 100, resetsAt: null } }), T0).base, 'overloaded');
  assert.equal(m.tick(T0 + 4 * MIN), null);
  assert.deepEqual(m.tick(T0 + 5 * MIN), { base: 'yawning', play: [], bubble: null, dim: false });
  assert.deepEqual(m.tick(T0 + 5 * MIN + 2500), { base: 'sleeping', play: [], bubble: { text: 'Zzz…', tone: '' }, dim: true });
});

test('a reset celebrates (jumping joy, happy, cool, idle) and waits while busy', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('idle')], five(100)), T0);
  const c = m.onSnapshot(snap([sess('idle')], five(2)), T0 + 1000);
  assert.deepEqual([c.base, c.play, c.bubble.text], ['happy', ['jumping_joy'], 'Fresh limits!']);
  assert.equal(m.tick(T0 + 1000 + 5700).base, 'cool');
  assert.equal(m.tick(T0 + 1000 + 13700).base, 'idle');

  const busy = createMood({}, { rand: mid });
  busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(40)), T0);
  assert.equal(busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(3)), T0 + 1000), null);
  assert.deepEqual(busy.onSnapshot(snap([sess('idle')], five(3)), T0 + 5000).play, ['jumping_joy']);
});

test('a celebration that waited for work survives the stop that ends the work', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })], five(40)), T0);
  assert.equal(m.onSnapshot(snap([sess('working', { detail: 'x' })], five(3)), T0 + 1000), null);
  m.onSnapshot(snap([sess('done')], five(3)), T0 + 5000); // the server sends the Stop snapshot first,
  const s = m.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 5005); // then the stop event
  assert.deepEqual([s.base, s.play], ['happy_eyes', ['surprised']]);
  assert.equal(m.onSnapshot(snap([sess('done')], five(3)), T0 + 6000), null); // "Your turn" is not cut short
  assert.equal(m.tick(T0 + 7000), null);
  const c = m.tick(T0 + 8005); // the done moment has passed
  assert.ok(c && c.play.includes('jumping_joy'), JSON.stringify(c));
  assert.equal(c.base, 'happy');
});

test('a failed turn shows error while its session is in the spotlight; the third in a row is angry; a prompt resets the count', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  const failed = snap([sess('error', { detail: 'Error' })]);
  assert.deepEqual(m.onSnapshot(failed, T0 + 1), { base: 'error', play: [], bubble: { text: 'Error', tone: 'bad' }, dim: false }); // the snapshot comes first,
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 2), null); // then its event: already showing
  m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 3);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 4).base, 'angry');
  assert.equal(m.tick(T0 + 5005), null, 'the moment has passed, the turn is still failed: still angry');
  m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 6000);
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 6001);
  assert.equal(m.onSnapshot(failed, T0 + 7000).base, 'error', 'the count starts again');
});

test('an error from a background session does not interrupt a busy focus session, but still counts', () => {
  const m = createMood({}, { rand: mid });
  const two = detail => snap([sess('working', { id: 'A', detail }), sess('error', { id: 'B', detail: 'Error' })], {}, 'A');
  m.onSnapshot(two('a'), T0);
  assert.equal(m.onEvent({ type: 'error', sessionId: 'B' }, T0 + 10), null);
  assert.deepEqual(m.onSnapshot(two('b'), T0 + 20), { base: 'working', play: [], bubble: { text: 'b', tone: '' }, dim: false });
  assert.equal(m.onEvent({ type: 'error', sessionId: 'A' }, T0 + 1000).base, 'error');
  assert.equal(m.onEvent({ type: 'error', sessionId: 'A' }, T0 + 2000).base, 'angry');
});

test('a new session: curious while idle, nothing while busy', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('idle')]), T0);
  assert.deepEqual(m.onEvent({ type: 'sessionStart', sessionId: 's2' }, T0 + 10), { base: 'idle', play: ['curious'], bubble: null, dim: false });
  const b = createMood({}, { rand: mid });
  b.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  assert.equal(b.onEvent({ type: 'sessionStart', sessionId: 's2' }, T0 + 10), null);
});

test('quiet for sleepAfter: yawn, then sleep dimmed; activity wakes with yawn, surprised, love', () => {
  const m = createMood({ sleepAfterMin: 5 }, { rand: mid });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.equal(m.tick(T0 + 4 * MIN), null);
  assert.equal(m.tick(T0 + 5 * MIN).base, 'yawning');
  assert.deepEqual(m.tick(T0 + 5 * MIN + 2500), { base: 'sleeping', play: [], bubble: { text: 'Zzz…', tone: '' }, dim: true });
  const w = m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 6 * MIN);
  assert.deepEqual([w.base, w.play, w.dim], ['thinking', ['yawning', 'surprised', 'love'], false]);
});

test('tap plays a random reaction and wakes a sleeping companion', () => {
  const m = createMood({}, { rand: () => 0.1 });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onTap(T0 + 1).play, ['love']);
  const sleepy = createMood({ sleepAfterMin: 1 }, { rand: () => 0.9 });
  sleepy.onSnapshot(snap([sess('done')]), T0);
  sleepy.tick(T0 + MIN);
  sleepy.tick(T0 + MIN + 2500);
  const w = sleepy.onTap(T0 + MIN + 10000);
  assert.deepEqual([w.play, w.dim, w.bubble.text], [['yawning', 'surprised', 'love'], false, 'Good morning!']);
});

test('plenty left: a rare cool moment while idle', () => {
  const m = createMood({}, { rand: () => 0 });
  m.onSnapshot(snap([sess('idle')], five(3)), T0);
  assert.equal(m.tick(T0 + 500).base, 'cool');
  assert.equal(m.tick(T0 + 8600).base, 'idle');
});

test('a pinned session overrides the server focus', () => {
  const m = createMood({ pinnedId: 'B' }, { rand: mid });
  const c = m.onSnapshot(snap([sess('working', { id: 'A', detail: 'a' }), sess('reading', { id: 'B', detail: 'b' })], {}, 'A'), T0);
  assert.deepEqual([c.base, c.bubble.text], ['reading', 'b']);
  m.setSettings({ pinnedId: null });
  assert.equal(m.tick(T0 + 2000).base, 'working');
});

test('offline: the companion sleeps until the connection returns', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  assert.deepEqual(m.setOffline(true, T0 + 1), { base: 'sleeping', play: [], bubble: null, dim: false });
  assert.equal(m.setOffline(false, T0 + 2).base, 'working');
});

test('by default he falls asleep after 2 quiet minutes', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.equal(m.tick(T0 + 2 * MIN - 1), null);
  assert.equal(m.tick(T0 + 2 * MIN).base, 'yawning');
  assert.equal(m.tick(T0 + 2 * MIN + 2500).dim, true);
});

test('a used-up 5-hour limit or a rate limit, once quiet, still yawns and sleeps; activity wakes him to it', () => {
  const m = createMood({ sleepAfterMin: 2 }, { rand: mid });
  assert.equal(m.onSnapshot(snap([sess('done')], five(100)), T0).base, 'overloaded');
  assert.equal(m.tick(T0 + 2 * MIN - 1).base, 'overloaded'); // the countdown moved on
  assert.deepEqual(m.tick(T0 + 2 * MIN), { base: 'yawning', play: [], bubble: null, dim: false });
  assert.deepEqual(m.tick(T0 + 2 * MIN + 2500), { base: 'sleeping', play: [], bubble: { text: 'Zzz…', tone: '' }, dim: true });
  const w = m.onSnapshot(snap([sess('working', { detail: 'x' })], five(100)), T0 + 3 * MIN);
  assert.deepEqual([w.base, w.dim], ['overloaded', false]);

  const r = createMood({ sleepAfterMin: 2 }, { rand: mid });
  assert.equal(r.onSnapshot(snap([sess('rateLimited', { detail: 'Rate limited' })]), T0).base, 'overloaded');
  r.tick(T0 + 2 * MIN);
  assert.equal(r.tick(T0 + 2 * MIN + 2500).dim, true);
});

test('status: every session\'s state counts; the spotlight moving between sessions does not', () => {
  const m = makeMood({}, { rand: mid }); // status() and setFocus() are read directly
  const a = sess('working', { id: 'a', detail: 'Editing x' });
  const b = sess('done', { id: 'b', detail: 'Your turn' });
  m.onSnapshot(snap([a, b]), T0);
  const s0 = m.status(T0);
  m.setFocus('b', T0 + 1000);
  assert.equal(m.status(T0 + 1000), s0, 'the rotation is not a new status');
  m.onSnapshot(snap([sess('thinking', { id: 'a', detail: 'Thinking…' }), b]), T0 + 2000);
  assert.equal(m.status(T0 + 2000), s0, 'reading, working, thinking: all one stretch of work');
  m.onSnapshot(snap([sess('working', { id: 'a', needsYou: true, detail: 'Needs permission' }), b]), T0 + 3000);
  assert.notEqual(m.status(T0 + 3000), s0, 'a permission prompt is');
  m.onSnapshot(snap([sess('done', { id: 'a' }), b], five(100)), T0 + 4000);
  const s1 = m.status(T0 + 4000);
  m.onSnapshot(snap([sess('done', { id: 'a' }), b], five(100)), T0 + 5000);
  assert.equal(m.status(T0 + 5000), s1);
  m.setOffline(true, T0 + 6000);
  assert.equal(m.status(T0 + 6000), 'offline');
});

test('setFocus: Clawd shows the spotlight session, without the startle or the dwell', () => {
  const m = createMood({}, { rand: mid });
  const a = sess('working', { id: 'a', detail: 'Editing x' });
  const b = sess('done', { id: 'b', detail: 'Your turn' });
  const c = sess('thinking', { id: 'c', detail: 'Thinking…' });
  assert.equal(m.onSnapshot(snap([a, b, c], {}, 'a'), T0).base, 'working');
  assert.deepEqual(m.setFocus('b', T0 + 10000), { base: 'happy_eyes', play: [], bubble: { text: 'Your turn', tone: 'good' }, dim: false });
  assert.deepEqual(m.setFocus('c', T0 + 20000), { base: 'thinking', play: [], bubble: { text: 'Thinking…', tone: '' }, dim: false }, 'no surprised');
  assert.equal(m.setFocus('a', T0 + 20100).base, 'working', 'no 1.5 s dwell either');
  assert.equal(m.setFocus('a', T0 + 20200), null, 'the same session again changes nothing');
});

test('spotlight mode: Your turn and a failed turn play while their session is in the spotlight; he still sleeps when all is quiet', () => {
  const m = createMood({ sleepAfterMin: 2 }, { rand: mid });
  const sessions = [sess('done', { id: 'a', detail: 'Your turn' }), sess('error', { id: 'b', detail: 'Error' }), sess('idle', { id: 'c' })];
  assert.deepEqual(m.onSnapshot(snap(sessions, {}, 'a'), T0), { base: 'happy_eyes', play: [], bubble: { text: 'Your turn', tone: 'good' }, dim: false });
  assert.equal(m.tick(T0 + 30000), null, 'not only in the moment after the stop');
  assert.deepEqual(m.setFocus('b', T0 + 40000), { base: 'error', play: [], bubble: { text: 'Error', tone: 'bad' }, dim: false });
  assert.deepEqual(m.setFocus('c', T0 + 50000), { base: 'idle', play: [], bubble: null, dim: false });
  assert.equal(m.setFocus('a', T0 + 60000).base, 'happy_eyes');
  assert.equal(m.tick(T0 + 2 * MIN).base, 'yawning', 'two quiet minutes: he yawns');
  assert.equal(m.tick(T0 + 2 * MIN + 2500).dim, true, 'and sleeps, so the screensaver takes over');
});

test('a Your turn or error moment stays with its session when the spotlight moves to a busy one', () => {
  const m = createMood({}, { rand: mid });
  const a = sess('working', { id: 'a', detail: 'Editing x' });
  const b = sess('working', { id: 'b', detail: 'Editing y' });
  m.onSnapshot(snap([a, b], {}, 'a'), T0);
  m.setFocus('a', T0);
  m.onSnapshot(snap([sess('done', { id: 'a' }), b], {}, 'b'), T0 + 8000);
  assert.equal(m.onEvent({ type: 'stop', sessionId: 'a' }, T0 + 8001).base, 'happy_eyes');
  assert.deepEqual(m.setFocus('b', T0 + 10000), { base: 'working', play: [], bubble: { text: 'Editing y', tone: '' }, dim: false });
  assert.equal(m.tick(T0 + 11500), null, 'no startle when the moment runs out');
});

test('when the spotlight\'s session ends, falling back to the server focus is silent', () => {
  const m = createMood({}, { rand: mid });
  const a = sess('done', { id: 'a' });
  const b = sess('working', { id: 'b', detail: 'Editing y' });
  m.onSnapshot(snap([a, b], {}, 'b'), T0);
  m.setFocus('a', T0 + 1000);
  const c = m.onSnapshot(snap([b], {}, 'b'), T0 + 5000);
  assert.deepEqual([c.base, c.play], ['working', []]);
});

test('with the spotlight on an idle session he stays awake while another works', () => {
  const m = createMood({ sleepAfterMin: 2 }, { rand: mid });
  const a = sess('compiling', { id: 'a', detail: 'Running npm test' });
  const b = sess('done', { id: 'b', detail: 'Your turn' });
  m.onSnapshot(snap([a, b], {}, 'a'), T0);
  m.setFocus('b', T0 + 1000);
  for (let t = T0 + 1500; t <= T0 + 6 * MIN; t += 500) {
    const c = m.tick(t);
    assert.ok(!c || (!c.dim && c.base !== 'yawning'), `t=${t - T0}`);
  }
  m.onSnapshot(snap([sess('done', { id: 'a' }), b], {}, 'a'), T0 + 6 * MIN);
  m.tick(T0 + 8 * MIN);
  assert.equal(m.tick(T0 + 8 * MIN + 2500).dim, true, 'all quiet: now he sleeps');
});

test('at a used-up limit he stays up while Claude works on, with no snapshot for minutes', () => {
  const m = createMood({ sleepAfterMin: 2 }, { rand: mid });
  m.onSnapshot(snap([sess('compiling', { detail: 'Running npm test' })], five(100)), T0);
  for (let t = T0 + 500; t <= T0 + 6 * MIN; t += 500) {
    const c = m.tick(t);
    assert.ok(!c || c.base === 'overloaded', `t=${t - T0}: ${c && c.base}`);
  }
});

// ---------- the behaviour map ----------
// These use makeMood directly: their remapped names are not what the defaults ask for (the last test's list).

test('remapped behaviours change the animations, not the moods (the brief\'s examples)', () => {
  const m = makeMood({}, { rand: () => 0.9, behaviours: { thinking: 'reading', startle: 'love', needsYou: ['happy_eyes'], tap: ['hop'] } });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 1000),
    { base: 'reading', play: ['love'], bubble: { text: 'Thinking…', tone: '' }, dim: false });
  assert.deepEqual(m.tick(T0 + 9000).play, ['curious'], 'still the thinking mode: it escalates after 8 s');
  assert.deepEqual(m.onTap(T0 + 9500), { base: 'reading', play: ['hop'], bubble: { text: 'Thinking…', tone: '' }, dim: false });
  const n = m.onSnapshot(snap([sess('thinking', { needsYou: true, detail: 'Needs permission' })]), T0 + 10000);
  assert.deepEqual(n, { base: ['happy_eyes'], play: [], bubble: { text: 'Needs permission', tone: 'need' }, dim: false });
});

test('the dwell hold keeps the mapped animation of the mode it holds', () => {
  const m = makeMood({}, { rand: mid, behaviours: { reading: 'sad', working: 'happy' } });
  assert.equal(m.onSnapshot(snap([sess('reading', { detail: 'Reading a' })]), T0).base, 'sad');
  const c = m.onSnapshot(snap([sess('working', { detail: 'Editing b' })]), T0 + 500);
  assert.deepEqual([c.base, c.bubble.text], ['sad', 'Editing b']);
  assert.equal(m.tick(T0 + 1600).base, 'happy');
});

test('sequences, reactions and sleep come from the map', () => {
  const m = makeMood({ sleepAfterMin: 1 }, {
    rand: mid,
    behaviours: { sessionStart: 'blink', firstPromptOfDay: ['walk', 'love', 'hop'], turnDone: 'love', yourTurn: 'cool', yawn: 'love', asleep: 'cool', wakeUp: ['hop'] },
  });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onEvent({ type: 'sessionStart', sessionId: 's2' }, T0 + 1).play, ['blink']);
  assert.deepEqual(m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 2).play, ['walk', 'love', 'hop']);
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0 + 1000);
  m.onSnapshot(snap([sess('done')]), T0 + 2000);
  const s = m.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 2001);
  assert.deepEqual([s.base, s.play, s.bubble.text], ['cool', ['love'], 'Your turn']);
  assert.equal(m.tick(T0 + 10000), null, 'still your turn: the mapped animation stays');
  assert.deepEqual(m.tick(T0 + 2001 + MIN), { base: 'love', play: [], bubble: null, dim: false }, 'the yawn');
  assert.deepEqual(m.tick(T0 + 2001 + MIN + 2500), { base: 'cool', play: [], bubble: { text: 'Zzz…', tone: '' }, dim: true });
  const w = m.onTap(T0 + 3 * MIN);
  assert.deepEqual([w.base, w.play, w.bubble.text, w.dim], ['idle', ['hop'], 'Hi!', false]);
});

test('a remapped celebration: its own reaction, then its base, then its afterglow', () => {
  const m = makeMood({}, { rand: mid, behaviours: { freshLimits: 'celebration', freshLimitsAfter: 'happy_eyes', afterglow: 'sad' } });
  m.onSnapshot(snap([sess('idle')], five(100)), T0);
  const c = m.onSnapshot(snap([sess('idle')], five(2)), T0 + 1000);
  assert.deepEqual([c.base, c.play, c.bubble.text], ['happy_eyes', ['celebration'], 'Fresh limits!']);
  assert.equal(m.tick(T0 + 1000 + 5700).base, 'sad');
  assert.equal(m.tick(T0 + 1000 + 13700).base, 'idle');
});

test('a tap picks from the tap list at random', () => {
  const tap = ['hop', 'walk', 'love', 'blink'];
  for (const [r, want] of [[0, 'hop'], [0.3, 'walk'], [0.6, 'love'], [0.99, 'blink']]) {
    const m = makeMood({}, { rand: () => r, behaviours: { tap } });
    m.onSnapshot(snap([sess('done')]), T0);
    assert.deepEqual(m.onTap(T0 + 1).play, [want], `rand ${r}`);
  }
});

test('setBehaviours: the next tick shows the current state with the new map; other states wait their turn', () => {
  const m = makeMood({}, { rand: mid });
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0);
  m.setBehaviours({ reading: 'hop' });
  assert.equal(m.tick(T0 + 100), null, 'reading is not on screen: nothing to redraw');
  m.setBehaviours({ thinking: 'working' });
  assert.deepEqual(m.tick(T0 + 200), { base: 'working', play: [], bubble: { text: 'Thinking…', tone: '' }, dim: false });
  m.setBehaviours({});
  assert.equal(m.tick(T0 + 300).base, 'thinking', 'a new map replaces the old one: what it leaves out is the default again');
  m.setBehaviours({ offline: 'cool' });
  assert.deepEqual(m.setOffline(true, T0 + 400), { base: 'cool', play: [], bubble: null, dim: false });
});

test('every state and moment reads its animation from the map (no animation name is left in mood.js)', () => {
  // Map every behaviour to its own made-up name, run through every state, and collect what the commands ask for.
  const X = Object.fromEntries(BEHAVIOURS.map(b => [b.key, Array.isArray(b.default) ? [`x_${b.key}`] : `x_${b.key}`]));
  const seen = new Set();
  const mood = (settings = {}, rand = mid) => {
    const m = makeMood(settings, { rand, behaviours: X });
    const note = c => { if (c) for (const n of [...[].concat(c.base), ...c.play]) seen.add(n); return c; };
    return Object.fromEntries(Object.entries(m).map(([k, f]) => [k, (...a) => note(f(...a))]));
  };

  const a = mood();
  a.onSnapshot(snap([sess('idle')]), T0);                                        // idle
  a.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 1);                         // first prompt of the day
  a.onEvent({ type: 'sessionStart', sessionId: 's2' }, T0 + 2);                   // new session
  a.onTap(T0 + 3);                                                                // tap
  a.onSnapshot(snap([sess('thinking', { detail: 't' })]), T0 + 1000);             // thinking, startle
  a.tick(T0 + 9000);                                                              // still thinking
  a.onSnapshot(snap([sess('reading', { detail: 'r' })]), T0 + 10000);             // reading
  a.onSnapshot(snap([sess('working', { detail: 'w' })]), T0 + 10500);             // (the dwell hold: still reading)
  a.onSnapshot(snap([sess('working', { detail: 'w' })]), T0 + 12000);             // working
  a.onSnapshot(snap([sess('compiling', { detail: 'c' })]), T0 + 14000);           // compiling
  a.tick(T0 + 22000);                                                             // still compiling
  a.onSnapshot(snap([sess('compiling', { needsYou: true, detail: 'n' })]), T0 + 23000); // needs you
  a.onSnapshot(snap([sess('done')]), T0 + 24000);
  a.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 24001);                       // turn done, your turn
  for (let i = 0; i < 3; i++) a.onEvent({ type: 'error', sessionId: 's1' }, T0 + 30000 + i); // error, errors in a row

  const b = mood();
  b.onSnapshot(snap([sess('idle')], five(40)), T0);
  b.onSnapshot(snap([sess('idle')], five(55)), T0 + 1000);                        // 5-hour >= 50%, getting tired
  b.onSnapshot(snap([sess('idle')], five(83)), T0 + 2000);                        // >= 80%
  b.onSnapshot(snap([sess('idle')], five(96)), T0 + 3000);                        // >= 95%
  b.onSnapshot(snap([sess('idle')], { ...five(40), week: { pct: 96, resetsAt: null } }), T0 + 4000);  // week >= 95%
  b.onSnapshot(snap([sess('idle')], { ...five(40), week: { pct: 100, resetsAt: null } }), T0 + 5000); // week reached
  b.onSnapshot(snap([sess('idle')], five(100)), T0 + 6000);                       // 5-hour reached
  b.onSnapshot(snap([sess('idle')], five(2)), T0 + 7000);                         // limits reset, celebrating
  b.tick(T0 + 7000 + 5700);                                                       // afterglow
  mood().onSnapshot(snap([sess('rateLimited', { detail: 'Rate limited' })]), T0); // rate limited

  const c = mood({}, () => 0);
  c.onSnapshot(snap([sess('idle')], five(3)), T0);
  c.tick(T0 + 500);                                                               // cool moment

  const d = mood({ sleepAfterMin: 5 });
  d.onSnapshot(snap([sess('idle')]), T0);
  d.tick(T0 + 5 * MIN);                                                           // yawn
  d.tick(T0 + 5 * MIN + 2500);                                                    // asleep
  d.onTap(T0 + 6 * MIN);                                                          // wakes up
  d.setOffline(true, T0 + 7 * MIN);                                               // PC offline

  assert.deepEqual([...seen].filter(n => !n.startsWith('x_')), [], 'animation names that bypass the map');
  const PLAYER = ['idleBlink', 'idleGlance', 'idleLife']; // calm idle's clips: app.js hands these to the Player
  assert.deepEqual([...seen].map(n => n.slice(2)).sort(), BEHAVIOURS.map(k => k.key).filter(k => !PLAYER.includes(k)).sort());
});

// Keep this test last: it reads what the scenarios above asked for.
test('every animation the scenarios asked for is a Clawd clip (base names, plays and chains)', t => {
  if (!asked.size) return t.skip('run the whole file: this test checks what the scenarios above asked for');
  assert.deepEqual([...asked].filter(n => !ANIMS[n]), [], 'names the Player would silently ignore');
  for (const n of asked) if (ANIMS[n].next) assert.ok(ANIMS[ANIMS[n].next], `${n} chains to ${ANIMS[n].next}`);
  assert.ok(ANIMS.jumping_joy.next === 'happy' && asked.has('happy'), 'fresh limits: jumping_joy flows into the happy base');
  // The scenarios reach every name mood.js can emit, so the check above covers all of them.
  assert.deepEqual([...asked].sort(), [
    'angry', 'compiling', 'cool', 'curious', 'ending', 'error', 'happy', 'happy_eyes', 'idle', 'jumping_joy', 'look_left',
    'love', 'low_tokens', 'overloaded', 'reading', 'sad', 'sleeping', 'surprised', 'thinking', 'working', 'yawning',
  ]);
});
