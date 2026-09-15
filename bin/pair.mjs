#!/usr/bin/env node
// Prints the phone URLs, starting the server first if needed.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeDir, dataFile, readJson, loadOrCreateConfig } from '../src/server/paths.mjs';
import { phoneUrls } from '../src/server/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cfg = loadOrCreateConfig(homeDir());

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

// A server that finds its port reserved moves to a new one and saves it in config.json.
function reloadConfig() {
  const c = readJson(dataFile('config.json', homeDir()));
  if (c && Number.isInteger(c.port) && typeof c.token === 'string') cfg = c;
}

async function ensureServer() {
  if (await health()) return true;
  // Never the session's project folder as the server's cwd (Windows would lock that folder).
  spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')],
    { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    reloadConfig();
    if (await health()) return true;
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
