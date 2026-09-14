import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, encodePng } from '../tools/lib/png.mjs';

test('encode then decode round-trips RGB pixels', () => {
  const img = { width: 3, height: 2, data: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]) };
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 3);
  assert.equal(back.height, 2);
  assert.deepEqual([...back.data], [...img.data]);
});

test('rejects non-PNG input', () => {
  assert.throws(() => decodePng(Buffer.from('nope, not a png file')), /not a PNG/);
});
