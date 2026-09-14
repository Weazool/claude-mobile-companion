// Server lifecycle on the real binaries: self-start from the hook, --stop, port recovery.
// Every test uses a fresh temp DESK_COMPANION_HOME, DESK_COMPANION_NO_LIMITS and ports the OS reports free,
// and stops the servers it started.
import { test } from 'node:test';
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
const HOOK = path.join(ROOT, 'bin', 'hook.mjs');
const TOKEN = '2'.repeat(32);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error('timed out');
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
}

async function freePort() {
  const s = net.createServer();
  await listen(s, 0, '127.0.0.1');
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

const file = (home, name) => path.join(home, '.desk-companion', name);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function tmpHome(port, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-life-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(file(home, 'config.json'), JSON.stringify({ port, token: TOKEN, contextWindow: {}, ...extra }));
  return home;
}

function envFor(home) {
  const env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: 'yes' };
  delete env.DESK_COMPANION_NO_SPAWN;
  delete env.DESK_COMPANION_INTERNAL;
  return env;
}

// GET on 127.0.0.1; resolves to the parsed JSON body of a 200, or null.
function getJson(port, p) {
  return new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port, path: p, timeout: 1000 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(b) : null); } catch { resolve(null); } });
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => resolve(null));
  });
}
const health = port => getJson(port, '/api/health');

function runNode(args, { env, cwd, input } = {}) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    c.on('exit', code => resolve({ code, out }));
    c.stdin.end(input);
  });
}

// Stops this home's server with --stop (same env), waits until it is gone, then removes the temp home.
async function cleanUp(home, env, knownPids = []) {
  const ports = new Set([readJson(file(home, 'server.json')), readJson(file(home, 'config.json'))]
    .map(j => j && j.port).filter(Number.isInteger));
  const pids = new Set([...knownPids, (readJson(file(home, 'server.json')) || {}).pid]);
  await runNode([SERVER, '--stop'], { env });
  for (const p of ports) {
    for (let i = 0; i < 60 && await health(p); i++) await sleep(50);
    const h = await health(p); // last resort, only for a server this test started
    if (h && pids.has(h.pid)) { try { process.kill(h.pid); } catch { /* gone */ } }
  }
  await sleep(100);
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temp dir */ }
}

test('a server started by the hook does not hold the hook cwd, so that folder can be renamed', async t => {
  const port = await freePort();
  const home = tmpHome(port);
  const env = envFor(home);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-proj-'));
  t.after(() => cleanUp(home, env));
  const evt = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd });
  const r = await runNode([HOOK], { env, cwd, input: evt });
  assert.deepEqual(r, { code: 0, out: '' });
  await until(async () => (await health(port)) !== null);
  assert.equal((await getJson(port, '/api/pair-info')).sessions, 1); // the SessionStart reached the new server
  fs.renameSync(cwd, cwd + '-moved'); // EBUSY on Windows while any process has the folder as its cwd
  fs.rmdirSync(cwd + '-moved');
});

test('--stop does not kill a foreign process that has the stale pid', async t => {
  const closed = await freePort();
  const home = tmpHome(closed);
  const env = envFor(home);
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  const other = http.createServer((q, s) => s.writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ ok: true, pid: foreign.pid + 1 })));
  t.after(async () => {
    try { process.kill(foreign.pid); } catch { /* gone */ }
    other.close();
    await cleanUp(home, env);
  });
  await until(() => alive(foreign.pid));
  const state = file(home, 'server.json');

  // Nothing answers on the recorded port or on config.port.
  fs.writeFileSync(state, JSON.stringify({ pid: foreign.pid, port: closed, startedAt: Date.now() }));
  assert.equal((await runNode([SERVER, '--stop'], { env })).code, 0);
  await sleep(300);
  assert.equal(alive(foreign.pid), true, 'killed although nothing answered health');
  assert.equal(fs.existsSync(state), false);

  // A server answers, but with another pid.
  await listen(other, 0, '127.0.0.1');
  fs.writeFileSync(state, JSON.stringify({ pid: foreign.pid, port: other.address().port, startedAt: Date.now() }));
  assert.equal((await runNode([SERVER, '--stop'], { env })).code, 0);
  await sleep(300);
  assert.equal(alive(foreign.pid), true, 'killed although health reported another pid');
  assert.equal(fs.existsSync(state), false);
});

test('--stop falls back to config.port when the port in server.json is stale', async t => {
  const port = await freePort();
  const home = tmpHome(port);
  const env = envFor(home);
  const srv = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  t.after(() => cleanUp(home, env, [srv.pid]));
  await until(async () => (await health(port)) !== null && fs.existsSync(file(home, 'server.json')));
  const st = readJson(file(home, 'server.json'));
  assert.equal(st.pid, srv.pid);
  fs.writeFileSync(file(home, 'server.json'), JSON.stringify({ ...st, port: await freePort() }));
  assert.equal((await runNode([SERVER, '--stop'], { env })).code, 0);
  await until(async () => (await health(port)) === null, 5000);
  assert.equal(fs.existsSync(file(home, 'server.json')), false);
});

test('a configured port held by a foreign process is replaced, persisted and logged', async t => {
  const port = await freePort();
  // Same address as the server: on Windows a 127.0.0.1 listener does not block a 0.0.0.0 bind.
  const blocker = net.createServer(s => s.destroy());
  await listen(blocker, port, '0.0.0.0');
  const home = tmpHome(port, { contextWindow: { 'claude-x': 5 } });
  const env = envFor(home);
  const srv = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  t.after(async () => {
    await cleanUp(home, env, [srv.pid]);
    blocker.close();
  });
  let cfg;
  await until(() => { cfg = readJson(file(home, 'config.json')); return cfg && cfg.port !== port; });
  assert.ok(cfg.port >= 50000 && cfg.port <= 60000, `new port ${cfg.port}`);
  assert.equal(cfg.token, TOKEN);
  assert.deepEqual(cfg.contextWindow, { 'claude-x': 5 });
  await until(async () => (await health(cfg.port)) !== null);
  assert.equal((await health(cfg.port)).pid, srv.pid);
  await until(() => fs.existsSync(file(home, 'server.json')));
  assert.equal(readJson(file(home, 'server.json')).port, cfg.port);
  const log = fs.readFileSync(file(home, 'server.log'), 'utf8');
  assert.match(log, new RegExp(`port ${port} unavailable \\(EADDRINUSE\\); switched to ${cfg.port}, re-pair the phone`));
});
