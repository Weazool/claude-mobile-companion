import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Runs a repo binary with a fresh temp home, capturing stdout+stderr.
function runNode(args, env) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    c.on('exit', code => resolve({ code, out }));
  });
}

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
  const md = fs.readFileSync(path.join(ROOT, 'skills/claude-companion-pair/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(md, /^---\nname: claude-companion-pair\n/);
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

test('configure skill opens the behaviours page, user-invoked only, with its command pre-approved', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills/claude-companion-configure/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(md, /^---\nname: claude-companion-configure\n/);
  assert.match(md, /\ndisable-model-invocation: true\n/);
  assert.ok(md.includes('!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs" --configure`'));
  assert.ok(md.includes('\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs" --configure)\n'));
});

test('pair skill pre-approves its injected command, so it does not abort under default permissions', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills/claude-companion-pair/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  // Must match the injected `!` line's command exactly, or the permission check still fails.
  assert.ok(md.includes('\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs")\n'));
});

test('bin/pair.mjs --no-open starts the server and prints a phone URL with the token', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-pairsmoke-'));
  const env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: 'yes' };
  delete env.DESK_COMPANION_NO_SPAWN;
  delete env.DESK_COMPANION_INTERNAL;
  t.after(async () => {
    await runNode([path.join(ROOT, 'bin', 'server.mjs'), '--stop'], env);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const r = await runNode([path.join(ROOT, 'bin', 'pair.mjs'), '--no-open'], env);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /desk-companion is running\./);
  assert.match(r.out, /http:\/\/\S+\?k=[0-9a-f]{32}/);
});
