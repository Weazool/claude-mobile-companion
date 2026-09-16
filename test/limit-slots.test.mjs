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

const hours = slots => slots.map(s => [s.label, Math.round(s.width * 300), s.current]); // width in minutes of 300

test('limitSlots: 5-hour cells are clock hours, so the current one is this hour', () => {
  process.env.TZ = 'Europe/Bucharest';
  const reset = Date.UTC(2026, 8, 16, 22, 20); // 01:20 local; the window opens at 20:20
  assert.deepEqual(hours(limitSlots(five, reset, reset - 90 * 60e3)), [ // now 23:50
    ['20:xx', 40, false], ['21:xx', 60, false], ['22:xx', 60, false], ['23:xx', 60, true], ['00:xx', 60, false], ['', 20, false],
  ]);
  // Opening at 20:40, the first 20 minutes are too short to name; the last 40 minutes are 01:xx.
  assert.deepEqual(limitSlots(five, Date.UTC(2026, 8, 16, 22, 40), 0).map(s => s.label), ['', '21:xx', '22:xx', '23:xx', '00:xx', '01:xx']);
});

test('limitSlots: a reset a fraction of a second past the hour leaves no sliver cell', () => {
  process.env.TZ = 'Europe/Bucharest';
  const reset = Date.UTC(2026, 8, 16, 22, 0, 0, 480); // 01:00:00.480 local
  assert.deepEqual(hours(limitSlots(five, reset, reset - 60e3)), [
    ['20:xx', 60, false], ['21:xx', 60, false], ['22:xx', 60, false], ['23:xx', 60, false], ['00:xx', 60, true],
  ]);
  const before = Date.UTC(2026, 8, 18, 15, 59, 59, 480); // 18:59:59.480 local, like a real weekly reset
  assert.deepEqual(limitSlots(five, before, 0).map(s => s.label), ['14:xx', '15:xx', '16:xx', '17:xx', '18:xx']);
  const midnight = Date.UTC(2026, 8, 17, 21, 0, 0, 481); // Fri 00:00:00.481 local
  assert.deepEqual(limitSlots(week, midnight, 0).map(s => s.label), ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
});

test('limitSlots: the hour repeated when DST ends is two cells', () => {
  process.env.TZ = 'Europe/Bucharest'; // 04:00 EEST becomes 03:00 EET on Sun 25 Oct 2026
  const reset = Date.UTC(2026, 9, 25, 4, 0); // 06:00 EET; the window opens at 02:00 EEST
  assert.deepEqual(hours(limitSlots(five, reset, 0)).map(c => c.slice(0, 2)), [
    ['02:xx', 60], ['03:xx', 60], ['03:xx', 60], ['04:xx', 60], ['05:xx', 60],
  ]);
});
