import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMood } from '../src/web/mood.js';

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
  assert.deepEqual(m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0), { base: 'idle', play: [], bubble: null, dim: false });
  assert.equal(m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0 + 10), null);
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

test('stop: surprised, then happy eyes for 3 s, then idle', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0 + 1000);
  assert.deepEqual(m.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 1001),
    { base: 'happy_eyes', play: ['surprised'], bubble: { text: 'Your turn', tone: 'good' }, dim: false });
  assert.equal(m.tick(T0 + 3500), null);
  assert.deepEqual(m.tick(T0 + 4002), { base: 'idle', play: [], bubble: null, dim: false });
});

test('a background session finishing does not interrupt the focus session', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { id: 'A', detail: 'a' }), sess('done', { id: 'B' })], {}, 'A'), T0);
  assert.equal(m.onEvent({ type: 'stop', sessionId: 'B' }, T0 + 10), null);
});

test('limit moods while idle: 50 low (with surprised), 80 sad, 95 ending; activity wins', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')], five(40)), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('done')], five(55)), T0 + 1000),
    { base: 'low_tokens', play: ['surprised'], bubble: { text: '5-hour at 55%', tone: '' }, dim: false });
  assert.equal(m.onSnapshot(snap([sess('done')], five(83)), T0 + 2000).base, 'sad');
  assert.equal(m.onSnapshot(snap([sess('done')], five(96)), T0 + 3000).base, 'ending');
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
  assert.deepEqual(m.onSnapshot(snap([sess('done')], { week: { pct: 96, resetsAt: null } }), T0).bubble, { text: 'Week at 96%', tone: 'bad' });
  assert.equal(m.onSnapshot(snap([sess('done')], { fable: { pct: 100, resetsAt: null } }), T0 + 1).base, 'overloaded');
  assert.equal(m.onSnapshot(snap([sess('reading', { detail: 'r' })], { fable: { pct: 100, resetsAt: null } }), T0 + 2).base, 'reading');
});

test('a reset celebrates (jumping joy, happy, cool, idle) and waits while busy', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')], five(100)), T0);
  const c = m.onSnapshot(snap([sess('done')], five(2)), T0 + 1000);
  assert.deepEqual([c.base, c.play, c.bubble.text], ['happy', ['jumping_joy'], 'Fresh limits!']);
  assert.equal(m.tick(T0 + 1000 + 5700).base, 'cool');
  assert.equal(m.tick(T0 + 1000 + 13700).base, 'idle');

  const busy = createMood({}, { rand: mid });
  busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(40)), T0);
  assert.equal(busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(3)), T0 + 1000), null);
  assert.deepEqual(busy.onSnapshot(snap([sess('done')], five(3)), T0 + 5000).play, ['jumping_joy']);
});

test('errors show for 5 s; the third in a row is angry; a prompt resets the count', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('error', { detail: 'Error' })]), T0);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 1).base, 'error');
  m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 2);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 3).base, 'angry');
  assert.equal(m.tick(T0 + 5004).base, 'idle');
  m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 6000);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 7000).base, 'error');
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
  m.onSnapshot(snap([sess('done')], five(3)), T0);
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
