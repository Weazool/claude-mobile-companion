import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReset, resetLine, limitsView, sessionMeta, dotClass, STALE_MS, nextSlot, stepSlot, SLOT_MS } from '../src/web/format.js';

const MIN = 60000;

test('formatReset: minutes, hours, weekday+time, now', () => {
  assert.equal(formatReset(108 * MIN, 0), '1h 48m');
  assert.equal(formatReset(45 * MIN, 0), '45m');
  assert.equal(formatReset(30000, 0), '1m');
  assert.equal(formatReset(-1, 0), 'now');
  assert.equal(formatReset(null, 0), '');
  assert.match(formatReset(Date.UTC(2026, 8, 17, 7, 0), Date.UTC(2026, 8, 14, 7, 0)), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('limitsView: ok limits give three bars, red at 80+, capped fill', () => {
  const now = 1_000_000;
  const v = limitsView({ status: 'ok', asOf: now, fiveHour: { pct: 83, resetsAt: now + 65 * MIN }, week: { pct: 134, resetsAt: null }, fable: null }, now, 0);
  assert.deepEqual(v.bars.map(r => [r.key, r.text, r.hot, r.reset, r.fill, r.slotList.length > 0]), [
    ['fiveHour', '83%', true, 'resets in 1h 05m', 83, true], ['week', '134%', true, '', 100, false], ['fable', '—', false, '', 0, false],
  ]);
  assert.equal(v.note, '');
  assert.equal(v.bars[0].color, '#f5a524');
  assert.equal(v.bars[0].slotList.filter(s => s.current).length, 1); // the cells themselves: limit-slots.test.mjs
});

test('limitsView: stale after 15 min by server clock, signin and unavailable notes', () => {
  const asOf = 1_000_000;
  const stale = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10, resetsAt: null } }, asOf + STALE_MS + 1, 0);
  assert.equal(stale.bars[0].stale, true);
  assert.match(stale.note, /^as of \d{2}:\d{2}$/);
  const skewed = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10 } }, asOf, STALE_MS + 1);
  assert.equal(skewed.bars[0].stale, true);
  assert.match(limitsView({ status: 'signin' }, 0, 0).note, /claude auth login/);
  assert.equal(limitsView(null, 0, 0).note, 'Limits unavailable');
  assert.equal(limitsView(null, 0, 0).bars[0].text, '—');
});

test('resetLine: in under a day, weekday and time beyond, now', () => {
  assert.equal(resetLine(117 * MIN, 0), 'resets in 1h 57m');
  assert.match(resetLine(Date.UTC(2026, 8, 17, 7, 0), Date.UTC(2026, 8, 14, 7, 0)), /^resets [A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.equal(resetLine(-1, 0), 'resets now');
  assert.equal(resetLine(null, 0), '');
});

test('sessionMeta and dotClass', () => {
  assert.equal(sessionMeta({ modelLabel: 'Opus 5', effort: 'high', detail: 'Editing a.js' }), 'Opus 5 · high · Editing a.js');
  assert.equal(sessionMeta({ modelLabel: null, effort: null, detail: '' }), '— · —');
  assert.equal(dotClass({ needsYou: true, activity: 'working' }), 'need');
  assert.equal(dotClass({ needsYou: false, activity: 'compiling' }), 'work');
  assert.equal(dotClass({ needsYou: false, activity: 'rateLimited' }), 'bad');
  assert.equal(dotClass({ needsYou: false, activity: 'done' }), 'idle');
});

test('nextSlot: every session in standard mode, then every session in focus mode, 30 s each, and round again', () => {
  assert.equal(SLOT_MS, 30000);
  const list = [{ id: 'a' }, { id: 'b' }];
  let s = nextSlot(list, { mode: 'standard', id: null, at: 0, since: 0 }, 5);
  assert.deepEqual(s, { mode: 'standard', id: 'a', at: 0, since: 5 }, 'the first session comes up at once');
  assert.equal(nextSlot(list, s, 5 + SLOT_MS - 1), s, 'for 30 s');
  const seq = [];
  for (let t = 5 + SLOT_MS; seq.length < 6; t += SLOT_MS) { s = nextSlot(list, s, t); seq.push(`${s.mode} ${s.id}`); }
  assert.deepEqual(seq, ['standard b', 'focus a', 'focus b', 'standard a', 'standard b', 'focus a']);
});

test('nextSlot: a session that goes gives way at once to the next; with none, standard mode, empty; one session goes round in a minute', () => {
  const slot = { mode: 'focus', id: 'b', at: 1, since: 0 };
  assert.deepEqual(nextSlot([{ id: 'a' }, { id: 'c' }], slot, 3), { mode: 'focus', id: 'c', at: 1, since: 3 }, 'c took its place');
  assert.deepEqual(nextSlot([{ id: 'a' }], slot, 3), { mode: 'standard', id: 'a', at: 0, since: 3 }, 'it was the last: standard mode');
  assert.deepEqual(nextSlot([{ id: 'a' }], { ...slot, mode: 'standard' }, 3), { mode: 'focus', id: 'a', at: 0, since: 3 });
  assert.deepEqual(nextSlot([{ id: 'b' }], slot, 3), { ...slot, at: 0 }, 'one before it went: its slot goes on from its new place');
  const empty = nextSlot([], slot, 4);
  assert.deepEqual(empty, { mode: 'standard', id: null, at: 0, since: 4 });
  assert.equal(nextSlot([], empty, 5), empty);
  const one = [{ id: 'a' }];
  let s = nextSlot(one, empty, 0);
  assert.deepEqual(s, { mode: 'standard', id: 'a', at: 0, since: 0 });
  const seq = [];
  for (let t = SLOT_MS; t <= 3 * SLOT_MS; t += SLOT_MS) { s = nextSlot(one, s, t); seq.push(s.mode); }
  assert.deepEqual(seq, ['focus', 'standard', 'focus']);
});

test('stepSlot: ‹ and › bring up the session before or after, round the ends, for a whole slot in the mode under way', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(stepSlot(list, { mode: 'standard', id: 'a', at: 0, since: 0 }, 1, 7), { mode: 'standard', id: 'b', at: 1, since: 7 });
  assert.deepEqual(stepSlot(list, { mode: 'focus', id: 'b', at: 1, since: 0 }, -1, 7), { mode: 'focus', id: 'a', at: 0, since: 7 });
  assert.deepEqual(stepSlot(list, { mode: 'focus', id: 'c', at: 2, since: 0 }, 1, 7), { mode: 'focus', id: 'a', at: 0, since: 7 }, 'past the last: the first, in the same mode');
  assert.deepEqual(stepSlot(list, { mode: 'standard', id: 'a', at: 0, since: 0 }, -1, 7), { mode: 'standard', id: 'c', at: 2, since: 7 }, 'before the first: the last');
  assert.deepEqual(stepSlot(list, { mode: 'standard', id: 'gone', at: 1, since: 0 }, 1, 7), { mode: 'standard', id: 'c', at: 2, since: 7 }, 'from the place of one that went');
  const s = { mode: 'standard', id: 'a', at: 0, since: 0 };
  assert.equal(stepSlot([{ id: 'a' }], s, 1, 7), s, 'one session: nowhere to go');
  assert.equal(stepSlot([], { ...s, id: null }, -1, 7).id, null);
  const next = nextSlot(list, stepSlot(list, s, 1, 7), 7 + SLOT_MS);
  assert.deepEqual([next.mode, next.id], ['standard', 'c'], 'the cycle carries on from there');
});
