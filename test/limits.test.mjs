import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { normPct, parseUsage, fetchUsage, createLimitsPoller, CLAUDE_ARGS } from '../src/server/limits.mjs';

const OK = {
  subscription_type: 'max', rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 62, resets_at: '2026-09-14T12:00:00Z' },
    seven_day: { utilization: 34.4, resets_at: '2026-09-17T07:00:00Z' },
    model_scoped: [{ display_name: 'Opus', utilization: 5, resets_at: null }, { display_name: 'Fable', utilization: 71, resets_at: '2026-09-17T07:00:00Z' }],
  },
};

test('normPct', () => {
  assert.equal(normPct(62), 62);
  assert.equal(normPct(0.62), 62);
  assert.equal(normPct(0), 0);
  assert.equal(normPct(1), 1);
  assert.equal(normPct(104.4), 104);
  assert.equal(normPct(null), null);
});

test('parseUsage: ok, signin, unavailable', () => {
  assert.deepEqual(parseUsage(OK, 5), {
    status: 'ok', asOf: 5,
    fiveHour: { pct: 62, resetsAt: Date.parse('2026-09-14T12:00:00Z') },
    week: { pct: 34, resetsAt: Date.parse('2026-09-17T07:00:00Z') },
    fable: { pct: 71, resetsAt: Date.parse('2026-09-17T07:00:00Z') },
  });
  assert.equal(parseUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, 5).status, 'signin');
  assert.equal(parseUsage({ subscription_type: 'max', rate_limits_available: false, rate_limits: null }, 5).status, 'unavailable');
  assert.equal(parseUsage(null, 5).status, 'unavailable');
  const partial = parseUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null } } }, 5);
  assert.deepEqual([partial.status, partial.fiveHour, partial.week, partial.fable], ['ok', null, null, null]);
});

// A fake `claude` child: `script(msg, reply)` answers each control_request written to stdin.
function fakeSpawn(script, record = {}) {
  return (cmd, argsOrOpts, maybeOpts) => {
    record.cmd = cmd;
    record.opts = maybeOpts || argsOrOpts;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, enc, cb) {
        for (const line of String(chunk).split('\n').filter(Boolean)) script(JSON.parse(line), o => child.stdout.write(JSON.stringify(o) + '\n'));
        cb();
      },
    });
    child.kill = () => { record.killed = true; };
    return child;
  };
}

const reply = (id, subtype, response) => ({ type: 'control_response', response: { subtype, request_id: id, response } });

test('fetchUsage: initialize, then get_usage, then parse', async () => {
  const rec = {};
  const spawnImpl = fakeSpawn((msg, out) => {
    out({ type: 'system', subtype: 'init' });
    if (msg.request.subtype === 'initialize') out(reply(msg.request_id, 'success', {}));
    if (msg.request.subtype === 'get_usage') {
      assert.equal(msg.request.skip_behaviors, true);
      out(reply(msg.request_id, 'success', OK));
    }
  }, rec);
  const r = await fetchUsage({ spawnImpl, now: () => 9 });
  assert.equal(r.status, 'ok');
  assert.equal(r.fable.pct, 71);
  assert.equal(r.asOf, 9);
  assert.equal(rec.opts.env.DESK_COMPANION_INTERNAL, '1');
  assert.ok(CLAUDE_ARGS.includes('--safe-mode'));
});

test('fetchUsage runs claude in the data dir, with no current-directory search for claude.cmd', async () => {
  const prev = process.env.DESK_COMPANION_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-lim-'));
  process.env.DESK_COMPANION_HOME = home;
  try {
    const rec = {};
    await fetchUsage({ spawnImpl: fakeSpawn((m, out) => out(reply(m.request_id, 'error', {})), rec) });
    assert.equal(rec.opts.cwd, path.join(home, '.desk-companion'));
    assert.equal(rec.opts.env.NoDefaultCurrentDirectoryInExePath, '1');
    assert.equal(rec.opts.env.DESK_COMPANION_INTERNAL, '1');
  } finally {
    if (prev === undefined) delete process.env.DESK_COMPANION_HOME; else process.env.DESK_COMPANION_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('fetchUsage survives an asynchronous EPIPE on the child stdin and still resolves', async () => {
  let child;
  const spawnImpl = () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({ write(chunk, enc, cb) { cb(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); } });
    return child;
  };
  const p = fetchUsage({ spawnImpl, timeoutMs: 1000, killAfterMs: 10, kill: () => {} });
  await new Promise(r => setTimeout(r, 20)); // the stdin 'error' event fires asynchronously
  child.emit('exit', 1);
  assert.equal((await p).reason, 'exit');
  // A child without a stdin pipe is tolerated too.
  const bare = await fetchUsage({ spawnImpl: () => { const c = new EventEmitter(); c.stdout = new PassThrough(); setTimeout(() => c.emit('exit', 1), 5); return c; }, killAfterMs: 10, kill: () => {} });
  assert.equal(bare.reason, 'exit');
});

test('fetchUsage: init error, timeout and spawn failure are unavailable', async () => {
  const initErr = await fetchUsage({ spawnImpl: fakeSpawn((m, out) => out(reply(m.request_id, 'error', {}))) });
  assert.deepEqual([initErr.status, initErr.reason], ['unavailable', 'init']);
  const slow = await fetchUsage({ spawnImpl: fakeSpawn(() => {}), timeoutMs: 50 });
  assert.deepEqual([slow.status, slow.reason], ['unavailable', 'timeout']);
  const boom = await fetchUsage({ spawnImpl: () => { throw new Error('ENOENT'); } });
  assert.deepEqual([boom.status, boom.reason], ['unavailable', 'spawn']);
});

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    set: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clear: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      t += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > t) break;
        await timers.shift().fn();
      }
    },
  };
}

const MIN = 60e3;

function poller(results) {
  const c = fakeClock();
  const calls = [];
  const updates = [];
  const p = createLimitsPoller({
    now: c.now, setTimer: c.set, clearTimer: c.clear,
    fetch: async ({ now }) => { calls.push(c.now()); const r = results.shift() || { status: 'unavailable' }; return r.status === 'ok' ? { ...r, asOf: now() } : r; },
    onUpdate: l => updates.push(l),
  });
  return { c, calls, updates, p };
}

test('poller: immediate first call, then every 5 minutes', async () => {
  const ok = { status: 'ok', fiveHour: { pct: 10, resetsAt: null }, week: null, fable: null };
  const { c, calls, updates, p } = poller([ok, ok, ok]);
  p.start();
  await c.advance(0);
  assert.deepEqual(calls, [0]);
  assert.equal(updates[0].status, 'ok');
  await c.advance(5 * MIN);
  assert.deepEqual(calls, [0, 5 * MIN]);
});

test('poller: back-off 10, 20, 30, 30 minutes on failure; values kept and go stale', async () => {
  const ok = { status: 'ok', fiveHour: { pct: 10, resetsAt: null }, week: null, fable: null };
  const { c, calls, p } = poller([ok]);
  p.start();
  await c.advance(0);
  await c.advance(5 * MIN);   // fails
  await c.advance(10 * MIN);  // fails
  await c.advance(20 * MIN);  // fails
  await c.advance(30 * MIN);  // fails
  await c.advance(30 * MIN);  // fails
  assert.deepEqual(calls.map(t => t / MIN), [0, 5, 15, 35, 65, 95]);
  assert.equal(p.view().status, 'stale');
  assert.equal(p.view().fiveHour.pct, 10);
});

test('poller: signin polls every 5 minutes without back-off', async () => {
  const { c, calls, p } = poller([{ status: 'signin' }, { status: 'signin' }]);
  p.start();
  await c.advance(0);
  assert.equal(p.view().status, 'signin');
  await c.advance(5 * MIN);
  assert.deepEqual(calls.map(t => t / MIN), [0, 5]);
});

test('poller: onStop pulls the next call forward, at least 2 minutes after the last one', async () => {
  const ok = { status: 'ok', fiveHour: null, week: null, fable: null };
  const { c, calls, p } = poller([ok, ok, ok]);
  p.start();
  await c.advance(0);
  await c.advance(10e3);
  p.onStop();                 // max(10s + 60s, 0 + 120s) = 120s
  await c.advance(110e3 - 1);
  assert.deepEqual(calls, [0]);
  await c.advance(1);
  assert.deepEqual(calls, [0, 120e3]);
});

test('fetchUsage kills a child that never exits, after killAfterMs', async () => {
  const killed = [];
  const r = await fetchUsage({ spawnImpl: fakeSpawn(() => {}), timeoutMs: 20, killAfterMs: 10, kill: c => killed.push(c) });
  assert.equal(r.reason, 'timeout');
  await new Promise(res => setTimeout(res, 40));
  assert.equal(killed.length, 1);
});

test('fetchUsage does not kill a child that already exited', async () => {
  const killed = [];
  let child;
  const spawnImpl = (...a) => { child = fakeSpawn(() => {})(...a); return child; };
  const p = fetchUsage({ spawnImpl, timeoutMs: 1000, killAfterMs: 10, kill: c => killed.push(c) });
  child.emit('exit', 0);
  const r = await p;
  assert.equal(r.reason, 'exit');
  await new Promise(res => setTimeout(res, 40));
  assert.equal(killed.length, 0);
});

test('poller keeps its schedule when onUpdate throws', async () => {
  const c = fakeClock();
  const calls = [];
  let first = true;
  const p = createLimitsPoller({
    now: c.now, setTimer: c.set, clearTimer: c.clear,
    fetch: async () => { calls.push(c.now()); return { status: 'ok', asOf: c.now(), fiveHour: null, week: null, fable: null }; },
    onUpdate: () => { if (first) { first = false; throw new Error('boom'); } },
  });
  p.start();
  await c.advance(0);
  await c.advance(5 * MIN);
  assert.deepEqual(calls, [0, 5 * MIN]);
});
