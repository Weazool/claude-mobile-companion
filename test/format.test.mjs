import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReset, limitsView, sessionMeta, dotClass, visibleSessions, STALE_MS } from '../src/web/format.js';

const MIN = 60000;

test('formatReset: minutes, hours, weekday+time, now', () => {
  assert.equal(formatReset(108 * MIN, 0), '1h 48m');
  assert.equal(formatReset(45 * MIN, 0), '45m');
  assert.equal(formatReset(30000, 0), '1m');
  assert.equal(formatReset(-1, 0), 'now');
  assert.equal(formatReset(null, 0), '');
  assert.match(formatReset(Date.UTC(2026, 8, 17, 7, 0), Date.UTC(2026, 8, 14, 7, 0)), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('limitsView: ok limits give three rings, red at 80+', () => {
  const now = 1_000_000;
  const v = limitsView({ status: 'ok', asOf: now, fiveHour: { pct: 83, resetsAt: now + 65 * MIN }, week: { pct: 34, resetsAt: null }, fable: null }, now, 0);
  assert.deepEqual(v.rings.map(r => [r.key, r.text, r.hot, r.reset]), [
    ['fiveHour', '83%', true, '1h 05m'], ['week', '34%', false, ''], ['fable', '—', false, ''],
  ]);
  assert.equal(v.note, '');
  assert.equal(v.rings[0].color, '#f5a524');
});

test('limitsView: stale after 15 min by server clock, signin and unavailable notes', () => {
  const asOf = 1_000_000;
  const stale = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10, resetsAt: null } }, asOf + STALE_MS + 1, 0);
  assert.equal(stale.rings[0].stale, true);
  assert.match(stale.note, /^as of \d{2}:\d{2}$/);
  const skewed = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10 } }, asOf, STALE_MS + 1);
  assert.equal(skewed.rings[0].stale, true);
  assert.match(limitsView({ status: 'signin' }, 0, 0).note, /claude auth login/);
  assert.equal(limitsView(null, 0, 0).note, 'Limits unavailable');
  assert.equal(limitsView(null, 0, 0).rings[0].text, '—');
});

test('sessionMeta and dotClass', () => {
  assert.equal(sessionMeta({ modelLabel: 'Opus 5', effort: 'high', detail: 'Editing a.js' }), 'Opus 5 · high · Editing a.js');
  assert.equal(sessionMeta({ modelLabel: null, effort: null, detail: '' }), '— · —');
  assert.equal(dotClass({ needsYou: true, activity: 'working' }), 'need');
  assert.equal(dotClass({ needsYou: false, activity: 'compiling' }), 'work');
  assert.equal(dotClass({ needsYou: false, activity: 'rateLimited' }), 'bad');
  assert.equal(dotClass({ needsYou: false, activity: 'done' }), 'idle');
});

test('visibleSessions keeps the focus session visible', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id }));
  assert.deepEqual(visibleSessions(list, 'b', 5).shown.map(s => s.id), ['a', 'b', 'c', 'd', 'e']);
  const r = visibleSessions(list, 'g', 5);
  assert.deepEqual(r.shown.map(s => s.id), ['a', 'b', 'c', 'd', 'g']);
  assert.equal(r.more, 2);
  assert.deepEqual(visibleSessions([], null, 5), { shown: [], more: 0 });
});
