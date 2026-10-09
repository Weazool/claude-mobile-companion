#!/usr/bin/env node
// desk-companion's start with Windows: bin/autostart.mjs --install copies this file to the data dir and puts a
// minimised shortcut to it in the Startup folder. At login it starts the server of the plugin version Claude Code
// has installed and exits. It stands alone (node built-ins only): the plugin's own folder changes with every version.
// A server already running stays (a starting server stands down for a same or newer one, src/server/version.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const parts = v => v.split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

// The installed plugin's server: Claude Code's record of it (installed_plugins.json), else the newest version in the
// plugin cache, else null.
export function serverPath(home = os.homedir()) {
  const plugins = path.join(home, '.claude', 'plugins');
  try {
    const record = JSON.parse(fs.readFileSync(path.join(plugins, 'installed_plugins.json'), 'utf8'));
    for (const e of [].concat((record.plugins || record)['desk-companion@desk-companion'] || [])) {
      const p = e && typeof e.installPath === 'string' ? path.join(e.installPath, 'bin', 'server.mjs') : null;
      if (p && fs.existsSync(p)) return p;
    }
  } catch { /* no record: look in the cache */ }
  const cache = path.join(plugins, 'cache', 'desk-companion', 'desk-companion');
  let best = null;
  try {
    for (const v of fs.readdirSync(cache)) {
      if (/^\d+\.\d+\.\d+$/.test(v) && fs.existsSync(path.join(cache, v, 'bin', 'server.mjs')) && (!best || newer(v, best))) best = v;
    }
  } catch { /* no cache */ }
  return best ? path.join(cache, best, 'bin', 'server.mjs') : null;
}

function main() {
  const server = serverPath();
  if (!server) return;
  spawn(process.execPath, [server], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() }).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
