import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReset, resetLine, limitsView, sessionMeta, dotClass, visibleSessions, STALE_MS, nextSpot, attnView, ROTATE_MS } from '../src/web/format.js';

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

test('visibleSessions keeps the focus session visible', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id }));
  assert.deepEqual(visibleSessions(list, 'b', 5).shown.map(s => s.id), ['a', 'b', 'c', 'd', 'e']);
  const r = visibleSessions(list, 'g', 5);
  assert.deepEqual(r.shown.map(s => s.id), ['a', 'b', 'c', 'd', 'g']);
  assert.equal(r.more, 2);
  assert.deepEqual(visibleSessions([], null, 5), { shown: [], more: 0 });
});

test('nextSpot: the next session every 10 s in list order, wrapping round; a gone one moves to the focus', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(nextSpot(list, { id: null, since: 0 }, 5, 'b'), { id: 'b', since: 5 });
  const s = { id: 'b', since: 5 };
  assert.equal(nextSpot(list, s, 5 + ROTATE_MS - 1), s);
  assert.deepEqual(nextSpot(list, s, 5 + ROTATE_MS), { id: 'c', since: 5 + ROTATE_MS });
  assert.deepEqual(nextSpot(list, { id: 'c', since: 0 }, ROTATE_MS), { id: 'a', since: ROTATE_MS });
  assert.deepEqual(nextSpot(list, { id: 'x', since: 0 }, 7, 'zz'), { id: 'a', since: 7 });
  assert.deepEqual(nextSpot([], { id: 'a', since: 0 }, 9), { id: null, since: 9 });
  assert.deepEqual(nextSpot([{ id: 'a' }], { id: 'a', since: 0 }, ROTATE_MS), { id: 'a', since: ROTATE_MS }, 'one session stays');
});

test('attnView: needs you, your turn and a failed turn get the centred layout; work and idle do not', () => {
  const s = { id: 'a', name: 'proj', modelLabel: 'Opus 5', effort: 'high', contextPct: 38, activity: 'working', detail: 'Editing x', needsYou: false };
  assert.equal(attnView(s), null);
  assert.equal(attnView({ ...s, activity: 'idle', detail: '' }), null);
  assert.equal(attnView(null), null);
  assert.deepEqual(attnView({ ...s, needsYou: true, detail: 'Needs permission' }), { tone: 'need', title: 'Needs permission', meta: 'proj · Opus 5 · high · ctx 38%' });
  assert.deepEqual(attnView({ ...s, activity: 'done', detail: 'Your turn' }), { tone: 'good', title: 'Your turn', meta: 'proj · Opus 5 · high · ctx 38%' });
  assert.equal(attnView({ ...s, activity: 'error', contextPct: null }).meta, 'proj · Opus 5 · high');
  assert.equal(attnView({ ...s, activity: 'error' }).title, 'Turn failed');
});

test('visibleSessions keeps both the spotlight and the session waiting on you, in list order', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id }));
  const ids = r => r.shown.map(s => s.id).join('');
  assert.equal(ids(visibleSessions(list, ['b', null], 5)), 'abcde');
  assert.equal(ids(visibleSessions(list, ['f', 'g'], 5)), 'abcfg');
  assert.equal(ids(visibleSessions(list, ['g', 'g'], 5)), 'abcdg');
  assert.equal(visibleSessions(list, ['f', 'g'], 5).more, 2);
});
