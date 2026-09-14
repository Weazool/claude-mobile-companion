import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddresses, phoneUrls } from '../src/server/net.mjs';

const IFACES = {
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
  'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
};

test('lanAddresses lists non-internal IPv4, 192.168 first', () => {
  assert.deepEqual(lanAddresses(IFACES), ['192.168.1.23', '172.20.0.1']);
});

test('phoneUrls builds token URLs plus a .local hostname URL', () => {
  assert.deepEqual(phoneUrls({ port: 53943, token: 't' }, IFACES, 'DESKTOP-ABC'), [
    'http://192.168.1.23:53943/?k=t',
    'http://172.20.0.1:53943/?k=t',
    'http://desktop-abc.local:53943/?k=t',
  ]);
});
