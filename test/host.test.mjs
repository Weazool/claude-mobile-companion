import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFlags, openTarget } from '../src/web/host.js';

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

test('openTarget: the desktop session to open while it waits on you or it is your turn', () => {
  const id = 'local_85928310-1594-4374-85dd-026b99e9e0ea';
  assert.equal(openTarget({ needsYou: true, activity: 'working', hostId: id }), id);
  assert.equal(openTarget({ needsYou: false, activity: 'done', hostId: id }), id);
  assert.equal(openTarget({ needsYou: false, activity: 'working', hostId: id }), null, 'busy: nothing to open');
  assert.equal(openTarget({ needsYou: true, activity: 'done' }), null, 'a terminal session has no desktop id');
  assert.equal(openTarget({ needsYou: true, hostId: 'local_x&y=1' }), null, 'only the shape the app accepts');
  assert.equal(openTarget(undefined), null);
});
