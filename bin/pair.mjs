#!/usr/bin/env node
// Prints the phone URLs, starting the server first if needed.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeDir, loadOrCreateConfig } from '../src/server/paths.mjs';
import { phoneUrls } from '../src/server/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadOrCreateConfig(homeDir()); // the port and the token, the same ones every time

function health() {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/health', timeout: 500 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Always start this copy, even when a server already answers: the server itself decides, leaving a same or
// newer one alone and replacing an older one (version.mjs), so a session with an old plugin root cannot leave a
// stale server on the port. Never the session's project folder as its cwd (Windows would lock that folder).
async function ensureServer() {
  spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')],
    { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() }).unref();
  for (let i = 0; i < 40; i++) {
    if (await health()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

const up = await ensureServer();
const urls = phoneUrls(cfg);
console.log(up ? 'desk-companion is running.' : 'Could not start the desk-companion server; see ~/.desk-companion/server.log');
console.log('Open this on your phone (same Wi-Fi):');
console.log('  ' + (urls[0] || `http://<this-PC-IP>:${cfg.port}/?k=${cfg.token}`));
if (urls.length > 1) {
  console.log('Alternatives:');
  for (const u of urls.slice(1)) console.log('  ' + u);
}
const configure = process.argv.includes('--configure'); // open the behaviours page instead of the QR page
if (up && !process.argv.includes('--no-open')) {
  const page = `http://localhost:${cfg.port}/${configure ? 'behaviours' : 'pair'}`;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', page]] // '' is start's window title
    : process.platform === 'darwin' ? ['open', [page]] : ['xdg-open', [page]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* no browser */ }
  console.log(configure ? `Clawd's behaviours page opened in your browser: ${page}` : `A QR code and a live dashboard preview opened in your browser: ${page}`);
}
