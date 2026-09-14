import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateConfig, dataFile, appendLog, readJson } from '../src/server/paths.mjs';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dc-home-'));

test('creates a config with a port in 50000-60000 and a 32-hex token', () => {
  const home = tmpHome();
  const cfg = loadOrCreateConfig(home);
  assert.ok(cfg.port >= 50000 && cfg.port <= 60000, `port ${cfg.port}`);
  assert.match(cfg.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(cfg.contextWindow, {});
  assert.deepEqual(readJson(dataFile('config.json', home)), cfg);
});

test('returns the same config on the second call', () => {
  const home = tmpHome();
  assert.deepEqual(loadOrCreateConfig(home), loadOrCreateConfig(home));
});

test('repairs invalid fields and keeps valid ones', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.desk-companion'), { recursive: true });
  fs.writeFileSync(dataFile('config.json', home),
    JSON.stringify({ port: 55555, token: 'nope', contextWindow: { 'claude-x': 5 } }));
  const cfg = loadOrCreateConfig(home, n => Buffer.alloc(n, 0xab));
  assert.equal(cfg.port, 55555);
  assert.equal(cfg.token, 'ab'.repeat(16));
  assert.deepEqual(cfg.contextWindow, { 'claude-x': 5 });
});

test('random port uses randomBytes: 0xabab % 10001 + 50000 = 53943', () => {
  const cfg = loadOrCreateConfig(tmpHome(), n => Buffer.alloc(n, 0xab));
  assert.equal(cfg.port, 53943);
});

test('appendLog rotates when the file exceeds maxBytes', () => {
  const file = dataFile('x.log', tmpHome());
  appendLog(file, 'a'.repeat(100), 50);
  appendLog(file, 'second', 50);
  assert.ok(fs.existsSync(file + '.1'));
  assert.match(fs.readFileSync(file, 'utf8'), /second/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /aaaa/);
});

test('readJson returns null for a missing or malformed file', () => {
  const home = tmpHome();
  assert.equal(readJson(path.join(home, 'missing.json')), null);
  fs.writeFileSync(path.join(home, 'bad.json'), '{nope');
  assert.equal(readJson(path.join(home, 'bad.json')), null);
});
