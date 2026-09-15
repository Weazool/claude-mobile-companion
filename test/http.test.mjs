import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, tokenMatches, isLoopback, isLoopbackHost } from '../src/server/http.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';
import { DEFAULT_MAP } from '../src/web/behaviours.js';

const TOKEN = 'f'.repeat(32);

function webRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>dash</h1>');
  fs.writeFileSync(path.join(dir, 'pair.html'), '<h1>pair</h1>');
  fs.writeFileSync(path.join(dir, 'behaviours.html'), '<h1>behaviours</h1>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
  return dir;
}

async function start() {
  let loop = false;
  let failSave = false;
  const hooks = [];
  const devLimits = [];
  const saves = [];               // what setBehaviours was given
  let map = { tap: ['hop'] };     // the server's current behaviour map (validation is the server's job)
  const app = createApp({
    token: TOKEN, webRoot: webRoot(),
    getSnapshot: () => ({ v: 1, hello: true }),
    onHook: e => hooks.push(e), onDevLimits: l => devLimits.push(l),
    getPairInfo: () => ({ urls: ['http://x'] }),
    getBehaviours: () => map,
    setBehaviours(input) {
      saves.push(input);
      if (failSave) throw new Error('disk full');
      map = input.reset === true ? { reset: 'to defaults' } : { saved: input };
      return map;
    },
    isLoopbackReq: () => loop,
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  return {
    app, hooks, devLimits, saves, port: app.server.address().port,
    loopback: v => { loop = v; }, failSave: v => { failSave = v; },
  };
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

test('loopback requests get no token cookie and clear an old one (cookies are not port-scoped)', async t => {
  const { app, port, loopback } = await start();
  t.after(() => app.close());
  loopback(true);
  for (const p of ['/', `/?k=${TOKEN}`]) {
    const r = await req(port, 'GET', p);
    assert.equal(r.status, 200, p);
    const c = r.headers['set-cookie'] || [];
    assert.equal(c.length, 1, p);
    assert.match(c[0], /^dc=; .*Path=\/.*Max-Age=0/, p);
    assert.ok(!c[0].includes(TOKEN), p);
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

test('SSE sends a snapshot and the behaviour map on connect, then broadcasts', async t => {
  const { app, port } = await start();
  t.after(() => app.close());
  const s = await openSse(port, `/events?k=${TOKEN}`);
  t.after(() => s.close());
  assert.equal(s.status, 200);
  await until(() => s.events.length >= 2);
  assert.deepEqual(s.events[0], { type: 'snapshot', data: { v: 1, hello: true } });
  assert.deepEqual(s.events[1], { type: 'behaviours', data: { map: { tap: ['hop'] } } });
  await until(() => app.clients.size === 1);
  app.broadcast('event', { type: 'stop', sessionId: 's' });
  await until(() => s.events.length >= 3);
  assert.deepEqual(s.events[2], { type: 'event', data: { type: 'stop', sessionId: 's' } });
  s.close();
  await until(() => app.clients.size === 0);
});

// ---------- the behaviours editor ----------

const post = (port, p, body, headers = {}) =>
  req(port, 'POST', p, { 'content-type': 'application/json', ...headers }, typeof body === 'string' ? body : JSON.stringify(body));

test('the behaviours page is loopback only, at /behaviours and under /web/', async t => {
  const { app, port, loopback } = await start();
  t.after(() => app.close());
  for (const p of ['/behaviours', '/web/behaviours.html']) {
    assert.equal((await req(port, 'GET', p)).status, 403, p);
    assert.equal((await req(port, 'GET', `${p}?k=${TOKEN}`)).status, 403, `${p} with the token`);
    assert.equal((await req(port, 'GET', p, { cookie: `dc=${TOKEN}` })).status, 403, `${p} with the cookie`);
  }
  loopback(true);
  const page = await req(port, 'GET', '/behaviours');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.equal(page.body, '<h1>behaviours</h1>');
  assert.equal((await req(port, 'GET', '/web/behaviours.html')).status, 200);
  assert.equal((await req(port, 'GET', '/behaviours', { host: `evil.example:${port}` })).status, 403, 'DNS rebinding');
});

test('the loopback-only pages cannot be reached with the token by another spelling of their path', async t => {
  const { app, port } = await start();
  t.after(() => app.close());
  // %5c is a separator on Windows only (elsewhere it names a file that does not exist: 404); upper case
  // reaches the same file on a case-insensitive disk.
  for (const name of ['pair.html', 'behaviours.html']) {
    for (const p of [`/web/vendor%2f..%2f${name}`, `/web/vendor%5c..%5c${name}`, `/web/${name.toUpperCase()}`]) {
      const r = await req(port, 'GET', `${p}?k=${TOKEN}`);
      assert.ok(r.status === 403 || r.status === 404, `${p}: ${r.status}`);
    }
  }
  assert.equal((await req(port, 'GET', `/web/vendor%2f..%2fstyle.css?k=${TOKEN}`)).status, 200, 'other files are unaffected');
});

test('GET /api/behaviours: loopback or the token; the map and the defaults', async t => {
  const { app, port, loopback } = await start();
  t.after(() => app.close());
  const want = { map: { tap: ['hop'] }, defaults: JSON.parse(JSON.stringify(DEFAULT_MAP)) };
  assert.equal((await req(port, 'GET', '/api/behaviours')).status, 403);
  for (const headers of [{}, { host: `evil.example:${port}` }]) {
    const r = await req(port, 'GET', `/api/behaviours?k=${TOKEN}`, headers);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(r.body), want);
  }
  assert.deepEqual(JSON.parse((await req(port, 'GET', '/api/behaviours', { cookie: `dc=${TOKEN}` })).body), want);
  loopback(true);
  assert.deepEqual(JSON.parse((await req(port, 'GET', '/api/behaviours')).body), want);
  assert.equal((await req(port, 'GET', '/api/behaviours', { host: `evil.example:${port}` })).status, 403, 'DNS rebinding');
});

test('POST /api/behaviours is loopback only (address AND Host): a LAN client with the token can read but not save', async t => {
  const { app, port, saves, loopback } = await start();
  t.after(() => app.close());
  const map = { thinking: 'reading' };
  assert.equal((await post(port, `/api/behaviours?k=${TOKEN}`, map)).status, 403);
  assert.equal((await post(port, '/api/behaviours', map, { cookie: `dc=${TOKEN}`, 'x-dc-token': TOKEN })).status, 403);
  loopback(true);
  assert.equal((await post(port, `/api/behaviours?k=${TOKEN}`, map, { host: `evil.example:${port}` })).status, 403, 'a foreign Host');
  assert.deepEqual(saves, []);
  const r = await post(port, '/api/behaviours', map);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(r.body), { map: { saved: map }, pages: 0 });
  assert.deepEqual(saves, [map]);
});

test('POST /api/behaviours refuses another site open in the PC\'s browser (a foreign Origin)', async t => {
  const { app, port, saves, loopback } = await start();
  t.after(() => app.close());
  loopback(true);
  // A cross-site form or no-cors fetch reaches us from a loopback address with a loopback Host; its Origin gives it away.
  for (const origin of ['https://evil.example', `http://localhost:${port + 1}`, `http://localhost:${port}`, 'null']) {
    assert.equal((await post(port, '/api/behaviours', { thinking: 'reading' }, { origin })).status, 403, origin);
  }
  assert.deepEqual(saves, []);
  // The editor page itself: a same-origin fetch names this very server (Host is 127.0.0.1:<port> here).
  assert.equal((await post(port, '/api/behaviours', { thinking: 'reading' }, { origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal(saves.length, 1);
});

test('POST /api/behaviours: 400 on bad JSON or anything but an object, 413 over 16 KB', async t => {
  const { app, port, saves, loopback } = await start();
  t.after(() => app.close());
  loopback(true);
  for (const body of ['{bad', '', '[]', 'null', '"thinking"', '42']) {
    assert.equal((await post(port, '/api/behaviours', body)).status, 400, JSON.stringify(body));
  }
  const pad = n => JSON.stringify({ thinking: 'reading', pad: 'x'.repeat(n) });
  const at = 16 * 1024 - pad(0).length;
  assert.equal((await post(port, '/api/behaviours', pad(at + 1))).status, 413);
  assert.equal(saves.length, 0);
  assert.equal((await post(port, '/api/behaviours', pad(at))).status, 200, 'exactly 16 KB is fine');
  // Without a length up front (chunked), the connection is cut once the body passes 16 KB.
  await assert.rejects(req(port, 'POST', '/api/behaviours', { 'transfer-encoding': 'chunked' }, pad(at + 1)));
  assert.equal(saves.length, 1);
  assert.equal((await req(port, 'GET', '/api/behaviours')).status, 200, 'and the server keeps serving');
});

test('POST /api/behaviours: 500 when the map cannot be saved, and nothing is sent to the pages', async t => {
  const { app, port, loopback, failSave } = await start();
  t.after(() => app.close());
  const s = await openSse(port, `/events?k=${TOKEN}`);
  t.after(() => s.close());
  await until(() => s.events.length >= 2);
  loopback(true);
  failSave(true);
  const r = await post(port, '/api/behaviours', { thinking: 'reading' });
  assert.equal(r.status, 500);
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.equal(r.body, 'the map could not be stored (disk full)', 'a text the editor can show');
  failSave(false);
  assert.equal((await post(port, '/api/behaviours', { thinking: 'working' })).status, 200);
  await until(() => s.events.length >= 3);
  assert.deepEqual(s.events.slice(2), [{ type: 'behaviours', data: { map: { saved: { thinking: 'working' } } } }]);
});

test('a save reaches every open page as a behaviours event, and so does a reset', async t => {
  const { app, port, saves, loopback } = await start();
  t.after(() => app.close());
  const a = await openSse(port, `/events?k=${TOKEN}`);
  const b = await openSse(port, `/events?k=${TOKEN}`);
  t.after(() => { a.close(); b.close(); });
  await until(() => a.events.length >= 2 && b.events.length >= 2 && app.clients.size === 2);
  loopback(true);
  // pages: how many dashboards the map was sent to, for the editor's status line.
  const r = await post(port, '/api/behaviours', { tap: ['love'] });
  assert.deepEqual(JSON.parse(r.body), { map: { saved: { tap: ['love'] } }, pages: 2 });
  const reset = await post(port, '/api/behaviours', { reset: true });
  assert.deepEqual(JSON.parse(reset.body), { map: { reset: 'to defaults' }, pages: 2 });
  assert.deepEqual(saves, [{ tap: ['love'] }, { reset: true }]);
  for (const s of [a, b]) {
    await until(() => s.events.length >= 4);
    assert.deepEqual(s.events.slice(2), [
      { type: 'behaviours', data: { map: { saved: { tap: ['love'] } } } },
      { type: 'behaviours', data: { map: { reset: 'to defaults' } } },
    ]);
  }
  // A page that connects later gets the map as it is now.
  const c = await openSse(port, `/events?k=${TOKEN}`);
  t.after(() => c.close());
  await until(() => c.events.length >= 2);
  assert.deepEqual(c.events[1], { type: 'behaviours', data: { map: { reset: 'to defaults' } } });
});

test('buildSnapshot shape', () => {
  const store = { list: () => [{ id: 'a' }], focusId: () => 'a' };
  assert.deepEqual(buildSnapshot(store, null, 42),
    { v: 1, serverTime: 42, sessions: [{ id: 'a' }], focusId: 'a', limits: EMPTY_LIMITS });
});
