import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverPath } from '../src/server/launcher.mjs';
import { shortcutScript, startupDir, SHORTCUT } from '../src/server/autostart.mjs';

function home(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-autostart-'));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return root;
}
const CACHE = '.claude/plugins/cache/desk-companion/desk-companion';

test('launcher: the server of the version Claude Code has installed, else the newest in the cache, else none', () => {
  const h = home({ [`${CACHE}/0.9.8/bin/server.mjs`]: '', [`${CACHE}/0.12.0/bin/server.mjs`]: '', [`${CACHE}/0.11.0/bin/server.mjs`]: '' });
  assert.equal(serverPath(h), path.join(h, CACHE, '0.12.0', 'bin', 'server.mjs'), '0.12.0 is newer than 0.9.8, by number');
  const record = { version: 2, plugins: { 'desk-companion@desk-companion': [{ scope: 'user', installPath: path.join(h, CACHE, '0.11.0'), version: '0.11.0' }] } };
  fs.writeFileSync(path.join(h, '.claude/plugins/installed_plugins.json'), JSON.stringify(record));
  assert.equal(serverPath(h), path.join(h, CACHE, '0.11.0', 'bin', 'server.mjs'), 'the installed one wins');
  record.plugins['desk-companion@desk-companion'][0].installPath = path.join(h, CACHE, '0.4.0');
  fs.writeFileSync(path.join(h, '.claude/plugins/installed_plugins.json'), JSON.stringify(record));
  assert.equal(serverPath(h), path.join(h, CACHE, '0.12.0', 'bin', 'server.mjs'), 'a record whose folder is gone falls back to the cache');
  assert.equal(serverPath(home({})), null);
});

test('autostart: a minimised Startup shortcut to node and the launcher, every path quoted for PowerShell', () => {
  const s = shortcutScript({ lnk: "C:\\Users\\o'neil\\Startup\\desk-companion.lnk", node: 'C:\\Program Files\\nodejs\\node.exe', launcher: "C:\\Users\\o'neil\\.desk-companion\\autostart.mjs", cwd: "C:\\Users\\o'neil" });
  assert.match(s, /CreateShortcut\('C:\\Users\\o''neil\\Startup\\desk-companion\.lnk'\)/);
  assert.match(s, /\.TargetPath = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(s, /\.Arguments = '"C:\\Users\\o''neil\\\.desk-companion\\autostart\.mjs"'/);
  assert.match(s, /\.WindowStyle = 7/, 'minimised: no window at login');
  assert.match(s, /\.Save\(\)/);
  assert.equal(SHORTCUT, 'desk-companion.lnk');
  assert.equal(startupDir({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }), path.join('C:\\Users\\x\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
});
