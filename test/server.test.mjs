import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'bin', 'server.mjs');
const TOKEN = '1'.repeat(32);
let home;
let port;
let env;

async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

function req(method, p, headers = {}, body) {
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    r.end(body);
  });
}

function openSse(p) {
  return new Promise(resolve => {
    const events = [];
    let buf = '';
    const r = http.get({ host: '127.0.0.1', port, path: p }, res => {
      res.setEncoding('utf8');
      res.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (ev && data) events.push({ type: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve({ events, close: () => r.destroy() });
    });
  });
}

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timed out');
}

const run = args => new Promise(resolve => {
  const c = spawn(process.execPath, [SERVER, ...args], { env, stdio: 'ignore' });
  c.on('exit', code => resolve(code));
});

const hook = evt => req('POST', '/api/hook', { 'x-dc-token': TOKEN, 'content-type': 'application/json' }, JSON.stringify(evt));

before(async () => {
  port = await freePort();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-srv-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(path.join(home, '.desk-companion', 'config.json'), JSON.stringify({ port, token: TOKEN, contextWindow: {} }));
  env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: '1' };
  spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  await until(async () => (await req('GET', '/api/health')).status === 200, 8000);
});

test('writes server.json with its pid and port', async () => {
  await until(() => fs.existsSync(path.join(home, '.desk-companion', 'server.json')));
  const st = JSON.parse(fs.readFileSync(path.join(home, '.desk-companion', 'server.json'), 'utf8'));
  assert.equal(st.port, port);
  assert.equal(typeof st.pid, 'number');
});

test('hook events become snapshots and discrete events', async () => {
  const s = await openSse(`/events?k=${TOKEN}`);
  await until(() => s.events.some(e => e.type === 'snapshot'));
  assert.equal((await hook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/x/proj', model: 'claude-opus-5' })).status, 204);
  assert.equal((await hook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/x/proj' })).status, 204);
  await until(() => s.events.some(e => e.type === 'event' && e.data.type === 'prompt'));
  const last = s.events.filter(e => e.type === 'snapshot').at(-1).data;
  assert.equal(last.v, 1);
  assert.equal(last.focusId, 's1');
  assert.equal(last.sessions[0].name, 'proj');
  assert.equal(last.sessions[0].modelLabel, 'Opus 5');
  assert.equal(last.sessions[0].activity, 'thinking');
  assert.equal(last.limits.status, 'unavailable');
  assert.ok(s.events.some(e => e.type === 'event' && e.data.type === 'sessionStart'));
  s.close();
});

test('dev limits endpoint updates the snapshot', async () => {
  const s = await openSse(`/events?k=${TOKEN}`);
  await req('POST', '/api/dev/limits', { 'x-dc-token': TOKEN }, JSON.stringify({ fiveHour: { pct: 55, resetsAt: Date.now() + 3600e3 } }));
  await until(() => s.events.some(e => e.type === 'snapshot' && e.data.limits.status === 'ok'));
  const snap = s.events.filter(e => e.type === 'snapshot').at(-1).data;
  assert.equal(snap.limits.fiveHour.pct, 55);
  s.close();
});

test('untrack: the session leaves the snapshots, its moments stay off the phone, and a prompt brings it back', async () => {
  const s = await openSse(`/events?k=${TOKEN}`);
  const one = { session_id: 'u1', cwd: '/x/one' };
  await hook({ hook_event_name: 'SessionStart', ...one });
  await hook({ hook_event_name: 'Stop', ...one });
  const untrack = id => req('POST', `/api/untrack?k=${TOKEN}`, { 'content-type': 'application/json' }, JSON.stringify({ id }));
  assert.equal((await untrack('u1')).status, 204);
  const lastSnap = () => s.events.filter(e => e.type === 'snapshot').at(-1).data;
  await until(() => !lastSnap().sessions.some(x => x.id === 'u1'));
  const from = s.events.length;
  await hook({ hook_event_name: 'Stop', ...one });
  await hook({ hook_event_name: 'UserPromptSubmit', ...one });
  await until(() => s.events.some(e => e.type === 'event' && e.data.type === 'prompt' && e.data.sessionId === 'u1'));
  const later = s.events.slice(from);
  assert.ok(!later.some(e => e.type === 'event' && e.data.type === 'stop'), 'the stop of an untracked session is not sent');
  assert.ok(lastSnap().sessions.some(x => x.id === 'u1' && x.activity === 'thinking'), 'back with the prompt');
  assert.equal((await untrack('nope')).status, 204, 'an unknown id changes nothing');
  s.close();
});

test('a second instance exits 0 at once', async () => {
  const t0 = Date.now();
  assert.equal(await run([]), 0);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal((await req('GET', '/api/health')).status, 200);
});

test('--stop ends the server and removes server.json', async () => {
  assert.equal(await run(['--stop']), 0);
  await until(async () => (await req('GET', '/api/health')).status === 0);
  assert.equal(fs.existsSync(path.join(home, '.desk-companion', 'server.json')), false);
});
