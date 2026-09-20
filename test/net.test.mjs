import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lanAddresses, phoneUrls, listenFixed } from '../src/server/net.mjs';

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

function deps({ ours = [] } = {}) {
  const d = { logs: [], healthAsked: [], waits: [] };
  d.health = async port => { d.healthAsked.push(port); return ours.includes(port) ? { ok: true, pid: 7, version: '0.9.0' } : null; };
  d.log = m => d.logs.push(m);
  d.sleep = async ms => { d.waits.push(ms); };
  return d;
}

test('listenFixed: the configured port when it binds, first try', async () => {
  const s = fakeServer(() => undefined);
  const d = deps();
  assert.deepEqual(await listenFixed(s, 50500, d), { bound: true });
  assert.deepEqual(s.calls, [[50500, '0.0.0.0']]);
  assert.deepEqual(d.healthAsked, []);
  assert.deepEqual(d.waits, []);
  assert.equal(s.listenerCount('error'), 0);
});

test('listenFixed: another desk-companion on the port comes back with its health, to compare versions', async () => {
  const d = deps({ ours: [50500] });
  assert.deepEqual(await listenFixed(fakeServer(() => 'EADDRINUSE'), 50500, d),
    { bound: false, ours: { ok: true, pid: 7, version: '0.9.0' } });
  assert.deepEqual(d.healthAsked, [50500]);
});

test('listenFixed: a port held by another program is tried again, then reported; never a different port', async () => {
  for (const code of ['EADDRINUSE', 'EACCES']) {
    const s = fakeServer(() => code);
    const d = deps();
    assert.deepEqual(await listenFixed(s, 50500, d), { bound: false, code }, code);
    assert.deepEqual(s.calls.map(c => c[0]), [50500, 50500, 50500, 50500], 'the same port every time');
    assert.deepEqual(d.waits, [400, 400, 400]);
    assert.deepEqual(d.logs, [
      `port 50500 unavailable (${code}), trying again`,
      `port 50500 unavailable (${code}), trying again`,
      `port 50500 unavailable (${code}), trying again`,
    ]);
  }
});

test('listenFixed: a port that frees up on the second try binds', async () => {
  let n = 0;
  const s = fakeServer(() => (n++ === 0 ? 'EADDRINUSE' : undefined));
  assert.deepEqual(await listenFixed(s, 50500, deps()), { bound: true });
  assert.deepEqual(s.calls.map(c => c[0]), [50500, 50500]);
});

test('listenFixed: an error that is not about the port is thrown', async () => {
  await assert.rejects(listenFixed(fakeServer(() => 'EPERM'), 50500, deps()), /listen EPERM/);
});

test('phoneUrls builds token URLs plus a .local hostname URL', () => {
  assert.deepEqual(phoneUrls({ port: 53943, token: 't' }, IFACES, 'DESKTOP-ABC'), [
    'http://192.168.1.23:53943/?k=t',
    'http://172.20.0.1:53943/?k=t',
    'http://desktop-abc.local:53943/?k=t',
  ]);
});
