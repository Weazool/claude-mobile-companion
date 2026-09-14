import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'bin', 'hook.mjs');

function tmpHomeWithConfig(port, token) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-hook-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(path.join(home, '.desk-companion', 'config.json'), JSON.stringify({ port, token, contextWindow: {} }));
  return home;
}

function runHook(input, env) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.on('exit', code => resolve({ code, stdout, ms: Date.now() - t0 }));
    child.stdin.end(JSON.stringify(input));
  });
}

function recorder() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { got.push({ url: req.url, token: req.headers['x-dc-token'], body }); res.writeHead(204).end(); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, got, port: server.address().port })));
}

test('forwards a sanitised event with the token and prints nothing', async () => {
  const { server, got, port } = await recorder();
  const home = tmpHomeWithConfig(port, 'a'.repeat(32));
  const r = await runHook(
    { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/p/x', prompt: 'SECRET-PROMPT' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(got.length, 1);
  assert.equal(got[0].url, '/api/hook');
  assert.equal(got[0].token, 'a'.repeat(32));
  const evt = JSON.parse(got[0].body);
  assert.equal(evt.hook_event_name, 'UserPromptSubmit');
  assert.equal(evt.session_id, 's1');
  assert.doesNotMatch(got[0].body, /SECRET/);
});

test('exits 0 quickly when the server is down', async () => {
  const { server, port } = await recorder();
  server.close();
  const home = tmpHomeWithConfig(port, 'b'.repeat(32));
  const r = await runHook({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('does nothing inside our own get_usage child', async () => {
  const { server, got, port } = await recorder();
  const home = tmpHomeWithConfig(port, 'c'.repeat(32));
  const r = await runHook({ hook_event_name: 'Stop', session_id: 's1' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1', DESK_COMPANION_INTERNAL: '1' });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(got.length, 0);
});

test('invalid JSON on stdin still exits 0 silently', async () => {
  const home = tmpHomeWithConfig(1, 'd'.repeat(32));
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stdin.end('{not json');
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0);
  assert.equal(out, '');
});

test('SessionStart waits for a server that comes up late, then delivers', async () => {
  const probe = http.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const home = tmpHomeWithConfig(port, 'e'.repeat(32));
  const got = [];
  const late = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); return; }
      got.push({ url: req.url, token: req.headers['x-dc-token'], body });
      res.writeHead(204).end();
    });
  });
  const timer = setTimeout(() => late.listen(port, '127.0.0.1'), 600);
  const r = await runHook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p/x' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' });
  clearTimeout(timer);
  late.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(got.length, 1);
  assert.equal(got[0].url, '/api/hook');
  assert.equal(got[0].token, 'e'.repeat(32));
  assert.equal(JSON.parse(got[0].body).hook_event_name, 'SessionStart');
  assert.ok(r.ms < 3500, `took ${r.ms} ms`);
});
