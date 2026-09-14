import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lanAddresses, phoneUrls, listenWithFallback } from '../src/server/net.mjs';

const IFACES = {
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
  'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
};

test('lanAddresses lists non-internal IPv4, 192.168 first', () => {
  assert.deepEqual(lanAddresses(IFACES), ['192.168.1.23', '172.20.0.1']);
});

// Shaped like os.networkInterfaces() entries.
const v4 = (address, mac = '0a:00:27:00:00:05') =>
  ({ address, netmask: '255.255.255.0', family: 'IPv4', mac, internal: false, cidr: `${address}/24` });

test('lanAddresses puts virtual adapters last, even with a home-range address', () => {
  assert.deepEqual(lanAddresses({
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'Wi-Fi': [v4('10.0.0.23')],
  }), ['10.0.0.23', '192.168.56.1']);
  assert.deepEqual(lanAddresses({
    'VMware Network Adapter VMnet8': [v4('192.168.80.1')],
    'Local Area Connection* 10': [v4('192.168.137.1')],
    'vEthernet (Default Switch)': [v4('172.30.48.1')],
    'Tailscale': [v4('100.101.102.103')],
    'Ethernet': [v4('10.1.2.3')],
    'Wi-Fi': [v4('172.16.5.9')],
  }), ['10.1.2.3', '172.16.5.9', '192.168.80.1', '192.168.137.1', '172.30.48.1', '100.101.102.103']);
});

// A server whose listen() fails with codeFor(port), or succeeds when that is undefined.
function fakeServer(codeFor) {
  const s = new EventEmitter();
  s.calls = [];
  s.listen = (port, host) => {
    s.calls.push([port, host]);
    const code = codeFor(port);
    process.nextTick(() => (code ? s.emit('error', Object.assign(new Error(`listen ${code}`), { code })) : s.emit('listening')));
  };
  return s;
}

function deps({ ours = [], picks = [51001, 51002, 51003, 51004, 51005, 51006] } = {}) {
  const d = { logs: [], healthAsked: [], picked: 0 };
  d.health = async port => { d.healthAsked.push(port); return ours.includes(port) ? { ok: true, pid: 7 } : null; };
  d.pickPort = () => picks[d.picked++];
  d.log = m => d.logs.push(m);
  return d;
}

test('listenWithFallback: the configured port when it binds', async () => {
  const s = fakeServer(() => undefined);
  const d = deps();
  assert.deepEqual(await listenWithFallback(s, 50500, d), { port: 50500, code: '' });
  assert.deepEqual(s.calls, [[50500, '0.0.0.0']]);
  assert.equal(d.picked, 0);
  assert.equal(s.listenerCount('error'), 0);
});

test('listenWithFallback: a reserved port (EACCES) moves to a new one', async () => {
  const s = fakeServer(p => (p === 50500 ? 'EACCES' : undefined));
  const d = deps();
  assert.deepEqual(await listenWithFallback(s, 50500, d), { port: 51001, code: 'EACCES' });
  assert.deepEqual(d.healthAsked, []);
  assert.equal(s.listenerCount('error'), 0);
  assert.equal(s.listenerCount('listening'), 0);
});

test('listenWithFallback: EADDRINUSE is a lost race if our server answers, a foreign holder otherwise', async () => {
  const busy = fakeServer(p => (p === 50500 ? 'EADDRINUSE' : undefined));
  assert.equal(await listenWithFallback(busy, 50500, deps({ ours: [50500] })), null);
  const d = deps();
  assert.deepEqual(await listenWithFallback(fakeServer(p => (p === 50500 ? 'EADDRINUSE' : undefined)), 50500, d),
    { port: 51001, code: 'EADDRINUSE' });
  assert.deepEqual(d.healthAsked, [50500]);
});

test('listenWithFallback: a busy new port is skipped without asking its health, and logged', async () => {
  const s = fakeServer(p => (p === 50500 ? 'EACCES' : p === 51001 ? 'EADDRINUSE' : undefined));
  const d = deps({ ours: [51001] });
  assert.deepEqual(await listenWithFallback(s, 50500, d), { port: 51002, code: 'EACCES' });
  assert.deepEqual(d.healthAsked, []);
  assert.deepEqual(d.logs, ['port 51001 unavailable (EADDRINUSE)']);
});

test('listenWithFallback: gives up after 5 attempts; other errors are not retried', async () => {
  const s = fakeServer(() => 'EACCES');
  const d = deps();
  await assert.rejects(listenWithFallback(s, 50500, d), /gave up after 5 ports \(EACCES\)/);
  assert.deepEqual(s.calls.map(c => c[0]), [50500, 51001, 51002, 51003, 51004]);
  const odd = fakeServer(() => 'EADDRNOTAVAIL');
  await assert.rejects(listenWithFallback(odd, 50500, deps()), { code: 'EADDRNOTAVAIL' });
  assert.equal(odd.calls.length, 1);
});

test('phoneUrls builds token URLs plus a .local hostname URL', () => {
  assert.deepEqual(phoneUrls({ port: 53943, token: 't' }, IFACES, 'DESKTOP-ABC'), [
    'http://192.168.1.23:53943/?k=t',
    'http://172.20.0.1:53943/?k=t',
    'http://desktop-abc.local:53943/?k=t',
  ]);
});
