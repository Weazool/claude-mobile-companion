import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vendored qrcode.js encodes a phone URL to an SVG', () => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/web/vendor/qrcode.js'), 'utf8'), ctx);
  const qr = ctx.qrcode(0, 'M');
  qr.addData('http://192.168.1.23:53943/?k=' + 'a'.repeat(32));
  qr.make();
  assert.ok(qr.getModuleCount() >= 25);
  assert.match(qr.createSvgTag(6, 0), /^<svg /);
});

test('pair skill runs the pair script and is user-invoked only', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills/pair/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(md, /^---\nname: pair\n/);
  assert.match(md, /\ndisable-model-invocation: true\n/);
  assert.ok(md.includes('!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"`'));
});

test('pair page loads the vendored QR library and the pair-info API', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/web/pair.html'), 'utf8');
  assert.ok(html.includes('src="/web/vendor/qrcode.js"'));
  assert.ok(html.includes("fetch('/api/pair-info')"));
  assert.ok(html.includes('<iframe id="dash" src="/"'));
});

test('pair page alternatives are clickable, and data only ever goes in as text', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/web/pair.html'), 'utf8');
  assert.ok(html.includes('data-url'));
  assert.equal(html.match(/innerHTML/g).length, 1); // the generated QR SVG only
  assert.match(html, /\.innerHTML = qr\.createSvgTag\(/);
});
