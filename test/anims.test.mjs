import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMS, SHEETS, MOTION_SHEETS } from '../src/web/anims.js';

test('animation table is consistent', () => {
  assert.equal(SHEETS.length, 21);
  for (const [name, a] of Object.entries(ANIMS)) {
    assert.ok(SHEETS.includes(a.sheet), `${name} sheet`);
    assert.ok(a.ms > 0, `${name} ms`);
    if (a.next) assert.ok(ANIMS[a.next], `${name} next`);
  }
  for (const s of MOTION_SHEETS) assert.ok(SHEETS.includes(s));
  assert.deepEqual([ANIMS.reading.sheet, ANIMS.compiling.sheet, ANIMS.sad.sheet], ['thinking', 'working', 'ending']);
  assert.deepEqual([ANIMS.idle.ms, ANIMS.blink.ms, ANIMS.look_left.ms, ANIMS.sleeping.ms, ANIMS.overloaded.ms], [150, 80, 120, 200, 70]);
});
