import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFlags, cornerBase, hostIdOf, stripLayout, CHIP } from '../src/web/host.js';

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

test('stripLayout: every chip when they fit, else as many as fit and a "+N" chip', () => {
  const { chip, gap, more } = CHIP;
  assert.deepEqual(stripLayout(0, 500), { shown: 0, more: 0, want: 0 });
  assert.deepEqual(stripLayout(3, 3 * chip + 2 * gap), { shown: 3, more: 0, want: 3 * chip + 2 * gap });
  const w = 2 * (chip + gap) + more; // room for two chips and the "+N" chip
  assert.deepEqual(stripLayout(5, w), { shown: 2, more: 3, want: 5 * chip + 4 * gap });
  assert.deepEqual(stripLayout(2, chip), { shown: 0, more: 2, want: 2 * chip + gap }, 'too narrow: just "+2"');
});
