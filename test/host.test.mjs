import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFlags, cornerBase, hostIdOf, stripLayout, stripOrder, CHIP, allTasks, pcBarShown, closable } from '../src/web/host.js';

test('hostFlags: the phone (no flag) keeps everything', () => {
  const phone = { mode: null, keepAwake: true, fullscreen: true, away: true, drift: true, rail: true };
  assert.deepEqual(hostFlags(''), phone);
  assert.deepEqual(hostFlags('?k=abc'), phone);
});
test('hostFlags: the corner shows Clawd only and never holds the PC awake', () => {
  assert.deepEqual(hostFlags('?corner'), { mode: 'corner', keepAwake: false, fullscreen: false, away: false, drift: false, rail: false });
});
test('hostFlags: the hover window drops the phone-only guards: keep-awake, full screen, away, drift and the rail', () => {
  assert.deepEqual(hostFlags('?pc'), { mode: 'pc', keepAwake: false, fullscreen: false, away: false, drift: false, rail: false });
  assert.equal(hostFlags('?settle&pc').mode, 'pc');
  assert.equal(hostFlags('?pc&corner').mode, 'corner');
});

test('cornerBase: at the laptop while any session works or runs background tasks, else idle', () => {
  assert.equal(cornerBase([]), 'idle');
  assert.equal(cornerBase([{ activity: 'done' }, { activity: 'working' }]), 'working');
  assert.equal(cornerBase([{ activity: 'done', background: 2 }]), 'working', 'background tasks count');
  assert.equal(cornerBase([{ activity: 'working', needsYou: true }]), 'idle', 'waiting on you is not work');
  assert.equal(cornerBase([{ activity: 'idle' }, { activity: 'done' }]), 'idle');
});

test('hostIdOf: the desktop session id, only in the shape the app accepts', () => {
  const id = 'local_85928310-1594-4374-85dd-026b99e9e0ea';
  assert.equal(hostIdOf({ hostId: id }), id);
  assert.equal(hostIdOf({ hostId: null }), null, 'a terminal session');
  assert.equal(hostIdOf({ hostId: 'local_x&y=1' }), null);
  assert.equal(hostIdOf(undefined), null);
});

test('stripLayout: two chips at most, then a "+N" chip; fewer when the window is narrow', () => {
  const { chip, gap, more } = CHIP;
  const two = 2 * chip + gap;
  assert.deepEqual(stripLayout(0, 2000), { shown: 0, more: 0, want: 0 });
  assert.deepEqual(stripLayout(2, 2000), { shown: 2, more: 0, want: two });
  assert.deepEqual(stripLayout(3, 2000), { shown: 2, more: 1, want: two + gap + more }, '"+1"');
  assert.deepEqual(stripLayout(5, 2000), { shown: 2, more: 3, want: two + gap + more }, '"+3"');
  assert.deepEqual(stripLayout(3, chip + gap + more), { shown: 1, more: 2, want: chip + gap + more }, 'room for one chip');
  assert.deepEqual(stripLayout(2, chip), { shown: 0, more: 2, want: more }, 'too narrow: just "+2"');
});

test('stripOrder: sessions waiting on you first, then the rest, each in start order', () => {
  const s = [{ id: 'a', activity: 'working' }, { id: 'b', activity: 'done' }, { id: 'c', needsYou: true }, { id: 'd', activity: 'idle', needsYou: true }];
  assert.deepEqual(stripOrder(s).map(x => x.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(stripOrder([]), []);
});

test("allTasks: every session's background tasks, each with its session, counted as the server counts them", () => {
  assert.deepEqual(allTasks([]), { count: 0, tasks: [] });
  const r = allTasks([
    { name: 'A', background: 3, tasks: [{ kind: 'shell', label: 'npm test', since: 1 }] },
    { name: 'B', background: 0, tasks: [] },
    { name: 'C', tasks: [{ kind: 'subagent', label: 'review', since: 2 }, { kind: 'workflow', label: 'wf', since: 3 }] },
  ]);
  assert.equal(r.count, 5, 'A says 3 though it lists 1; C lists 2');
  assert.deepEqual(r.tasks.map(t => [t.session, t.label]), [['A', 'npm test'], ['C', 'review'], ['C', 'wf']]);
});

test('pcBarShown: a limit the account has no window for is left out, unless limits are missing altogether', () => {
  assert.equal(pcBarShown({ status: 'ok' }, { pct: null }), false, 'no 5-hour window right now');
  assert.equal(pcBarShown({ status: 'ok' }, { pct: 0 }), true);
  assert.equal(pcBarShown({ status: 'signin' }, { pct: null }), true, 'signed out: the bars stay with the note');
  assert.equal(pcBarShown(null, { pct: null }), true);
});

test('closable: a ✕ for sessions that are done or idle, not for ones at work or waiting on you', () => {
  assert.equal(closable({ activity: 'done' }), true, 'your turn');
  assert.equal(closable({ activity: 'idle' }), true);
  assert.equal(closable({ activity: 'working' }), false);
  assert.equal(closable({ activity: 'done', background: 1 }), false, 'its background tasks still run');
  assert.equal(closable({ activity: 'done', needsYou: true }), false);
  assert.equal(closable(undefined), false);
});
