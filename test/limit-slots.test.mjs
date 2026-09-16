import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitSlots, BARS } from '../src/web/format.js';

// The legend follows the phone's clock and time zone, so each test pins the zone (this file runs in its own process).
const HOUR = 3600e3;
const week = BARS.find(b => b.key === 'week');
const five = BARS.find(b => b.key === 'fiveHour');
const view = slots => slots.map(s => [s.label, +(s.width * 168).toFixed(2), s.current]); // width in hours of 168

test('limitSlots: week cells are calendar days, so the current one is today', () => {
  process.env.TZ = 'Europe/Bucharest'; // UTC+3 in September
  const reset = Date.UTC(2026, 8, 18, 16, 0); // Fri 18 Sep 19:00 local
  const now = Date.UTC(2026, 8, 16, 20, 30);  // Wed 23:30 local: most of this 24-hour stretch is Thu, but today is Wed
  assert.deepEqual(view(limitSlots(week, reset, now)), [
    ['', 5, false], ['Sat', 24, false], ['Sun', 24, false], ['Mon', 24, false], ['Tue', 24, false],
    ['Wed', 24, true], ['Thu', 24, false], ['Fri', 19, false],
  ]);
  const slots = limitSlots(week, reset, now);
  assert.equal(slots[0].at, 0);
  assert.ok(Math.abs(slots.at(-1).at + slots.at(-1).width - 1) < 1e-9);
});

test('limitSlots: a midnight reset gives seven whole days; the window edges', () => {
  process.env.TZ = 'UTC';
  const reset = Date.UTC(2026, 8, 19, 0, 0); // Sat 00:00
  assert.deepEqual(limitSlots(week, reset, Date.UTC(2026, 8, 16, 12, 0)).map(s => s.label), ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.equal(limitSlots(week, reset, reset).some(s => s.current), false); // the window has ended
  assert.equal(limitSlots(week, reset, reset - 1).at(-1).current, true);
  assert.equal(limitSlots(week, reset, reset - 168 * HOUR).at(0).current, true);
  assert.equal(limitSlots(week, reset, reset - 168 * HOUR - 1).some(s => s.current), false);
  assert.deepEqual(limitSlots(week, null, reset), []);
  assert.deepEqual(limitSlots(week, undefined, reset), []);
});

test('limitSlots: a day under 12 hours goes unnamed; a DST day is 25 hours wide', () => {
  process.env.TZ = 'Europe/Bucharest'; // clocks go back at 04:00 on Sun 25 Oct 2026
  const reset = Date.UTC(2026, 9, 28, 7, 0); // Wed 28 Oct 09:00 local (UTC+2)
  const cells = view(limitSlots(week, reset, reset - HOUR));
  assert.deepEqual(cells.map(c => c[0]), ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', '']);
  assert.equal(cells[0][1], 14); // Wed 21 Oct 10:00 (UTC+3) to midnight
  assert.equal(cells[4][1], 25); // Sun 25 Oct
  assert.equal(cells.at(-1)[1], 9);
  assert.equal(cells.at(-1)[2], true);
  assert.equal(cells.reduce((n, c) => n + c[1], 0), 168);
});

test('limitSlots: five equal hours named by their start time', () => {
  process.env.TZ = 'Europe/Bucharest';
  const reset = Date.UTC(2026, 8, 16, 22, 20); // 01:20 local
  const slots = limitSlots(five, reset, reset - 90 * 60e3);
  assert.deepEqual(slots.map(s => s.label), ['20:20', '21:20', '22:20', '23:20', '00:20']);
  assert.deepEqual(slots.map(s => s.width), [0.2, 0.2, 0.2, 0.2, 0.2]);
  assert.equal(slots.findIndex(s => s.current), 3);
});
