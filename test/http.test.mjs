import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, tokenMatches, isLoopback, isLoopbackHost } from '../src/server/http.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';

const TOKEN = 'f'.repeat(32);

function webRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>dash</h1>');
  fs.writeFileSync(path.join(dir, 'pair.html'), '<h1>pair</h1>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
  return dir;
}

async function start() {
  let loop = false;
  const hooks = [];
  const devLimits = [];
  const app = createApp({
    token: TOKEN, webRoot: webRoot(),
    getSnapshot: () => ({ v: 1, hello: true }),
    onHook: e => hooks.push(e), onDevLimits: l => devLimits.push(l),
    getPairInfo: () => ({ urls: ['http://x'] }),
    isLoopbackReq: () => loop,
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  return { app, hooks, devLimits, port: app.server.address().port, loopback: v => { loop = v; } };
}

function req(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.setTimeout(3000, () => r.destroy(new Error(`no response to ${method} ${p}`)));
    r.on('error', reject);
    r.end(body);
  });
}

function openSse(port, p) {
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
      resolve({ events, status: res.statusCode, close: () => r.destroy() });
    });
  });
}

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('timed out');
};

test('tokenMatches is exact', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches('f'.repeat(31), TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});

test('tokenMatches compares bytes, so non-ASCII input is just a mismatch', () => {
  assert.equal(tokenMatches('é'.repeat(32), TOKEN), false); // 32 chars, 64 bytes
  assert.equal(tokenMatches('é'.repeat(16), TOKEN), false); // 16 chars, 32 bytes
});

test('a non-ASCII token in the query or the cookie gets 403 and the server keeps serving', async t => {
  const { app, port } = await start();
  t.after(() => app.close());
  assert.equal((await req(port, 'GET', '/?k=' + '%C3%A9'.repeat(32))).status, 403);
  assert.equal((await req(port, 'GET', `/?k=${TOKEN}`)).status, 200);
  assert.equal((await req(port, 'GET', '/', { cookie: 'dc=' + 'é'.repeat(32) })).status, 403);
  assert.equal((await req(port, 'GET', `/?k=${TOKEN}`)).status, 200);
});

test('isLoopback accepts IPv4, IPv6 and IPv4-mapped loopback only', () => {
  const r = a => isLoopback({ socket: { remoteAddress: a } });
  assert.equal(r('127.0.0.1'), true);
  assert.equal(r('::1'), true);
  assert.equal(r('::ffff:127.0.0.1'), true);
  assert.equal(r('192.168.1.5'), false);
  assert.equal(r('::ffff:192.168.1.5'), false);
  assert.equal(r(undefined), false);
});

test('isLoopbackHost accepts only loopback host names, on any port', () => {
  for (const h of ['localhost:1', '127.0.0.1:5', '[::1]:9', 'LOCALHOST', 'localhost', '127.0.0.1:52193']) {
    assert.equal(isLoopbackHost(h), true, h);
  }
  for (const h of ['evil.example', 'evil.example:52193', '127.0.0.1.evil.example', 'localhost.evil.example:1', '', undefined, '::1', '192.168.1.5:52193']) {
    assert.equal(isLoopbackHost(h), false, String(h));
  }
});

test('a loopback address with a foreign Host is not exempt (DNS rebinding)', async t => {
  const { app, port, hooks, devLimits, loopback } = await start();
  t.after(() => app.close());
  loopback(true);
  const evil = { host: `evil.example:${port}` };
  for (const p of ['/', '/api/pair-info', '/pair', '/api/health', '/web/pair.html', '/web/style.css', '/events']) {
    assert.equal((await req(port, 'GET', p, evil)).status, 403, p);
  }
  const body = JSON.stringify({ hook_event_name: 'Stop', session_id: 's' });
  assert.equal((await req(port, 'POST', '/api/hook', { ...evil, 'x-dc-token': TOKEN }, body)).status, 403);
  assert.equal((await req(port, 'POST', '/api/dev/limits', { ...evil, 'x-dc-token': TOKEN }, '{}')).status, 403);
  assert.deepEqual([hooks, devLimits], [[], []]);
  // It can still log in with the token, but that never opens the loopback-only routes.
  assert.equal((await req(port, 'GET', `/?k=${TOKEN}`, evil)).status, 200);
  assert.equal((await req(port, 'GET', `/api/pair-info?k=${TOKEN}`, evil)).status, 403);
  // Loopback names on any port stay exempt.
  assert.equal((await req(port, 'GET', '/', { host: `localhost:${port}` })).status, 200);
  assert.equal((await req(port, 'GET', '/api/pair-info', { host: `localhost:${port}` })).status, 200);
});

test('pair.html stays loopback-only under /web/', async () => {
  const { app, port, loopback } = await start();
  assert.equal((await req(port, 'GET', `/web/pair.html?k=${TOKEN}`)).status, 403);
  loopback(true);
  assert.equal((await req(port, 'GET', '/web/pair.html')).status, 200);
  app.close();
});

test('dashboard needs the token from a remote client and sets the cookie', async () => {
  const { app, port } = await start();
  assert.equal((await req(port, 'GET', '/')).status, 403);
  const ok = await req(port, 'GET', `/?k=${TOKEN}`);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /dash/);
  assert.match(ok.headers['set-cookie'][0], new RegExp(`^dc=${TOKEN}; HttpOnly`));
  assert.equal((await req(port, 'GET', '/', { cookie: `dc=${TOKEN}` })).status, 200);
  app.close();
});

test('loopback requests get no token cookie (cookies are not port-scoped)', async t => {
  const { app, port, loopback } = await start();
  t.after(() => app.close());
  loopback(true);
  for (const p of ['/', `/?k=${TOKEN}`]) {
    const r = await req(port, 'GET', p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers['set-cookie'], undefined, p);
  }
});

test('static files: token or loopback required, manifest public, no traversal', async () => {
  const { app, port, loopback } = await start();
  assert.equal((await req(port, 'GET', '/web/style.css')).status, 403);
  assert.equal((await req(port, 'GET', '/web/style.css', { cookie: `dc=${TOKEN}` })).status, 200);
  assert.equal((await req(port, 'GET', '/web/manifest.webmanifest')).status, 200);
  assert.equal((await req(port, 'GET', `/web/..%2f..%2fpackage.json?k=${TOKEN}`)).status, 403);
  assert.equal((await req(port, 'GET', `/web/missing.css?k=${TOKEN}`)).status, 404);
  loopback(true);
  const css = await req(port, 'GET', '/web/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  app.close();
});

test('hook ingest needs loopback AND the token header', async () => {
  const { app, port, hooks, loopback } = await start();
  const body = JSON.stringify({ hook_event_name: 'Stop', session_id: 's' });
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, body)).status, 403);
  loopback(true);
  assert.equal((await req(port, 'POST', '/api/hook', {}, body)).status, 403);
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, body)).status, 204);
  assert.deepEqual(hooks, [{ hook_event_name: 'Stop', session_id: 's' }]);
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, '{bad')).status, 400);
  app.close();
});

test('dev limits endpoint has the same protection', async () => {
  const { app, port, devLimits, loopback } = await start();
  loopback(true);
  const body = JSON.stringify({ fiveHour: { pct: 55, resetsAt: 1 } });
  assert.equal((await req(port, 'POST', '/api/dev/limits', { 'x-dc-token': TOKEN }, body)).status, 204);
  assert.deepEqual(devLimits, [{ fiveHour: { pct: 55, resetsAt: 1 } }]);
  app.close();
});

test('health, pair and pair-info are loopback only', async () => {
  const { app, port, loopback } = await start();
  for (const p of ['/api/health', '/pair', '/api/pair-info']) assert.equal((await req(port, 'GET', p)).status, 403, p);
  loopback(true);
  assert.equal(JSON.parse((await req(port, 'GET', '/api/health')).body).ok, true);
  assert.match((await req(port, 'GET', '/pair')).body, /pair/);
  assert.deepEqual(JSON.parse((await req(port, 'GET', '/api/pair-info')).body), { urls: ['http://x'], pages: 0 });
  app.close();
});

test('SSE sends a snapshot on connect, then broadcasts', async () => {
  const { app, port } = await start();
  const s = await openSse(port, `/events?k=${TOKEN}`);
  assert.equal(s.status, 200);
  await until(() => s.events.length >= 1);
  assert.deepEqual(s.events[0], { type: 'snapshot', data: { v: 1, hello: true } });
  await until(() => app.clients.size === 1);
  app.broadcast('event', { type: 'stop', sessionId: 's' });
  await until(() => s.events.length >= 2);
  assert.deepEqual(s.events[1], { type: 'event', data: { type: 'stop', sessionId: 's' } });
  s.close();
  await until(() => app.clients.size === 0);
  app.close();
});

test('buildSnapshot shape', () => {
  const store = { list: () => [{ id: 'a' }], focusId: () => 'a' };
  assert.deepEqual(buildSnapshot(store, null, 42),
    { v: 1, serverTime: 42, sessions: [{ id: 'a' }], focusId: 'a', limits: EMPTY_LIMITS });
});
