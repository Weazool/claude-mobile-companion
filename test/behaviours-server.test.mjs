// The behaviour map end to end: the real bin/server.mjs (a temp DESK_COMPANION_HOME, ports the OS reports
// free), and the dashboard (src/web/app.js) applying the map it sends.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_MAP } from '../src/web/behaviours.js';
import { Player } from '../src/web/clawd/index.js';
import { EMPTY_LIMITS } from '../src/server/snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'bin', 'server.mjs');
const WEB = path.join(ROOT, 'src', 'web');
const TOKEN = '3'.repeat(32);
const DEFAULTS = JSON.parse(JSON.stringify(DEFAULT_MAP));
let home;
let env;
let port;
let server; // the running child

const file = name => path.join(home, '.desk-companion', name);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error('timed out');
}

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
    r.setTimeout(3000, () => r.destroy());
    r.on('error', () => resolve({ status: 0, body: '' }));
    r.end(body);
  });
}
const post = (body, headers = {}) =>
  req('POST', '/api/behaviours', { 'content-type': 'application/json', ...headers }, typeof body === 'string' ? body : JSON.stringify(body));
const getMap = async () => JSON.parse((await req('GET', '/api/behaviours')).body);

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
          if (ev && data && ev[1] !== 'ping') events.push({ type: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve({ events, close: () => r.destroy() });
    });
    r.on('error', () => {});
  });
}

const run = args => new Promise(resolve => {
  const c = spawn(process.execPath, [SERVER, ...args], { env, stdio: 'ignore' });
  c.on('exit', code => resolve(code));
});

// Starts the server and waits until this very process serves (after a restart, on the port it recorded).
async function startServer() {
  server = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  let st;
  await until(() => { st = readJson(file('server.json')); return st && st.pid === server.pid; });
  port = st.port;
  await until(async () => (await req('GET', '/api/health')).status === 200);
}

async function stopServer() {
  await run(['--stop']);
  await until(async () => (await req('GET', '/api/health')).status === 0);
}

// A stored map as a user might leave it: good entries, and some the rig does not allow there.
const STORED = {
  thinking: 'reading', tap: ['hop', 'love'], needsYou: ['happy_eyes'],
  idleBlink: 'sleeping',  // a loop in a moment slot: allowed now, it plays one cycle
  startle: 'nope',        // no such clip
  bogus: 'hop',           // no such behaviour
};
const LOADED = { ...DEFAULTS, thinking: 'reading', tap: ['hop', 'love'], needsYou: ['happy_eyes'], idleBlink: 'sleeping' };

before(async () => {
  port = await freePort();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-beh-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(file('config.json'), JSON.stringify({ port, token: TOKEN, contextWindow: {} }));
  fs.writeFileSync(file('behaviours.json'), JSON.stringify(STORED));
  env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: '1' };
  delete env.DESK_COMPANION_NO_SPAWN;
  delete env.DESK_COMPANION_INTERNAL;
  await startServer();
});

after(async () => {
  await run(['--stop']);
  if (server && server.exitCode === null) { try { server.kill(); } catch { /* gone */ } }
  await sleep(100);
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// ---------- the server ----------

test('server: behaviours.json is validated at start; GET /api/behaviours has the map and the defaults', async () => {
  assert.deepEqual(await getMap(), { map: LOADED, defaults: DEFAULTS });
  assert.deepEqual(readJson(file('behaviours.json')), STORED, 'loading never rewrites the file');
});

test('server: every page gets the map right after the snapshot, and again on every save', async t => {
  const s = await openSse(`/events?k=${TOKEN}`);
  t.after(() => s.close());
  await until(() => s.events.length >= 2);
  assert.deepEqual(s.events.map(e => e.type), ['snapshot', 'behaviours']);
  assert.deepEqual(s.events[1].data, { map: LOADED });

  // A save replaces the whole map: what it leaves out, or gets wrong, is the default.
  const next = { thinking: 'working', yawn: 'love', idleLife: ['walk'], firstPromptOfDay: ['love', 'happy'] };
  const want = { ...DEFAULTS, thinking: 'working', yawn: 'love', idleLife: ['walk'], firstPromptOfDay: ['love', 'happy'] };
  const r = await post(next);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { map: want, pages: 1 });
  await until(() => s.events.length >= 3);
  assert.deepEqual(s.events[2], { type: 'behaviours', data: { map: want } });
  assert.deepEqual(readJson(file('behaviours.json')), want, 'the file holds the validated map');
  assert.deepEqual(fs.readdirSync(path.join(home, '.desk-companion')).filter(n => n.startsWith('behaviours')), ['behaviours.json'],
    'no temp file left behind');
  assert.deepEqual((await getMap()).map, want);
});

test('server: a bad save changes nothing', async () => {
  const before = await getMap();
  const stored = fs.readFileSync(file('behaviours.json'), 'utf8');
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('["thinking"]')).status, 400);
  assert.deepEqual(await getMap(), before);
  assert.equal(fs.readFileSync(file('behaviours.json'), 'utf8'), stored);
});

test('server: only the PC saves; the token reads from anywhere', async () => {
  const before = await getMap();
  const evil = { host: `evil.example:${port}` }; // what a LAN client or a rebound name looks like: not a loopback Host
  assert.equal((await req('GET', `/api/behaviours?k=${TOKEN}`, evil)).status, 200);
  assert.equal((await req('GET', '/api/behaviours', evil)).status, 403);
  assert.equal((await post({ thinking: 'sleeping' }, evil)).status, 403);
  assert.equal((await post({ thinking: 'sleeping' }, { ...evil, cookie: `dc=${TOKEN}` })).status, 403);
  assert.equal((await post({ thinking: 'sleeping' }, { origin: 'https://evil.example' })).status, 403, 'another site in the PC\'s browser');
  assert.equal((await req('GET', `/behaviours?k=${TOKEN}`, evil)).status, 403);
  assert.deepEqual(await getMap(), before);
});

test('server: the saved map survives a restart', async () => {
  const saved = (await getMap()).map;
  assert.notDeepEqual(saved, DEFAULTS);
  await stopServer();
  await startServer();
  assert.deepEqual(await getMap(), { map: saved, defaults: DEFAULTS });
});

test('server: reset deletes behaviours.json and sends the defaults to every page', async t => {
  const s = await openSse(`/events?k=${TOKEN}`);
  t.after(() => s.close());
  await until(() => s.events.length >= 2);
  const r = await post({ reset: true, thinking: 'working' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { map: DEFAULTS, pages: 1 });
  assert.equal(fs.existsSync(file('behaviours.json')), false);
  await until(() => s.events.length >= 3);
  assert.deepEqual(s.events[2], { type: 'behaviours', data: { map: DEFAULTS } });
  assert.deepEqual((await getMap()).map, DEFAULTS);
  assert.equal((await post({ reset: true })).status, 200, 'resetting again, with no file, is fine');
  await stopServer();
  await startServer();
  assert.deepEqual((await getMap()).map, DEFAULTS, 'and after a restart');
});

// ---------- the dashboard ----------

// Runs src/web/app.js in this process against a stand-in page: stub elements, an EventSource the test drives,
// timers and animation frames that never fire, and the real modules it imports (all but the SVG drawing).
async function loadDashboard() {
  const src = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const out = { es: null, player: null };
  const stubs = {
    mountClawd: () => ({ render() {} }),
    Player: class extends Player { constructor(o) { super(o); out.player = this; } },
  };
  const names = [];
  const values = [];
  for (const [, list, spec] of src.matchAll(/^import \{([^}]*)\} from '([^']+)';$/mg)) {
    const mod = await import(pathToFileURL(path.join(WEB, spec)).href);
    for (const n of list.split(',').map(s => s.trim()).filter(Boolean)) {
      assert.ok(n in mod, `${spec} exports ${n}`);
      names.push(n);
      values.push(Object.hasOwn(stubs, n) ? stubs[n] : mod[n]);
    }
  }
  const el = () => ({
    hidden: false, textContent: '', className: '', innerHTML: '', children: [], dataset: {},
    style: { setProperty() {} }, classList: { toggle() {} }, addEventListener() {}, querySelector: () => el(),
  });
  const byId = new Map();
  const document = {
    getElementById: id => { if (!byId.has(id)) byId.set(id, el()); return byId.get(id); },
    addEventListener() {}, visibilityState: 'visible', documentElement: el(), fullscreenElement: null,
  };
  class EventSource {
    static CLOSED = 2;
    constructor(url) { this.url = url; this.on = {}; out.es = this; }
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
    close() {}
    emit(type, data) { for (const fn of this.on[type] || []) fn({ data: JSON.stringify(data) }); }
  }
  const globals = {
    document, EventSource,
    window: { localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false }), addEventListener() {}, innerWidth: 390, innerHeight: 844 },
    screen: { width: 390, height: 844 }, navigator: {}, location: { search: '' },
    requestAnimationFrame() {}, setInterval() {}, setTimeout() {},
  };
  const body = '"use strict";\n' + src.replace(/^import .*$/mg, '');
  new Function(...names, ...Object.keys(globals), body)(...values, ...Object.values(globals));
  assert.ok(out.es && out.player, 'app.js connected and made its Player');
  return out;
}

const snapshot = sessions => ({ v: 1, serverTime: Date.now(), sessions, focusId: sessions.length ? sessions[0].id : null, limits: EMPTY_LIMITS });
const thinking = { id: 's1', name: 'proj', activity: 'thinking', needsYou: false, detail: 'Thinking…', modelLabel: 'Opus 5', contextPct: 10 };

test('dashboard: the map re-renders the current state at once, and gives calm idle its clips', async () => {
  const { es, player } = await loadDashboard();
  es.emit('snapshot', snapshot([]));
  assert.deepEqual(player.base, ['idle']);
  es.emit('behaviours', { map: { ...DEFAULTS, idle: 'cool', idleBlink: 'love', idleGlance: ['hop'], idleLife: ['love', 'curious'] } });
  assert.deepEqual(player.base, ['cool'], 'no wait for the next tick');
  assert.deepEqual(player.idleClips, { blink: 'love', glance: ['hop'], life: ['love', 'curious'] });

  es.emit('snapshot', snapshot([thinking]));
  assert.deepEqual(player.base, ['thinking']);
  es.emit('behaviours', { map: { ...DEFAULTS, thinking: 'reading' } });
  assert.deepEqual(player.base, ['reading']);
  assert.deepEqual(player.idleClips, { blink: 'blink', glance: ['look_left', 'look_right'], life: ['walk', 'hop'] }, 'back to the defaults');
});

test('dashboard: the same map again (every reconnect) leaves Clawd alone, and a map the rig cannot play falls back to the defaults', async () => {
  const { es, player } = await loadDashboard();
  const map = { ...DEFAULTS, idle: 'cool', idleBlink: 'love' };
  es.emit('snapshot', snapshot([]));
  es.emit('behaviours', { map });
  assert.deepEqual([player.base, player.idleClips.blink], [['cool'], 'love']);
  const timers = player.t;
  const clip = player.cur;
  es.emit('snapshot', snapshot([]));
  es.emit('behaviours', { map });
  assert.equal(player.t, timers, 'calm idle keeps its timers');
  assert.equal(player.cur, clip, 'the clip playing goes on');

  // 'breath' is the Player's own clip, not one the map may name: the dashboard checks the map against the rig too.
  es.emit('behaviours', { map: { ...DEFAULTS, idle: 'breath', idleBlink: 'breath' } });
  assert.deepEqual([player.base, player.idleClips.blink], [['idle'], 'blink']);
  es.emit('behaviours', { map: { ...DEFAULTS, idle: 'cool' } });
  assert.deepEqual(player.base, ['cool']);
  es.emit('behaviours', {});
  assert.deepEqual(player.base, ['idle'], 'no map at all is the defaults');
});
