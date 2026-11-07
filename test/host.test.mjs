import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFlags } from '../src/web/host.js';

test('hostFlags: the phone (no flag) keeps everything', () => {
  assert.deepEqual(hostFlags(''), { mode: null, keepAwake: true, fullscreen: true, away: true, drift: true });
  assert.deepEqual(hostFlags('?k=abc'), { mode: null, keepAwake: true, fullscreen: true, away: true, drift: true });
});
test('hostFlags: the corner shows Clawd only and never holds the PC awake', () => {
  assert.deepEqual(hostFlags('?corner'), { mode: 'corner', keepAwake: false, fullscreen: false, away: false, drift: false });
});
test('hostFlags: the hover window is the phone page minus keep-awake and full screen', () => {
  assert.deepEqual(hostFlags('?pc'), { mode: 'pc', keepAwake: false, fullscreen: false, away: true, drift: true });
  assert.equal(hostFlags('?settle&pc').mode, 'pc');
});
