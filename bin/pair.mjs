#!/usr/bin/env node
// Prints the phone URLs, starting the server first if needed.
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homeDir, loadOrCreateConfig } from '../src/server/paths.mjs';
import { phoneUrls } from '../src/server/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadOrCreateConfig(homeDir());

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

async function ensureServer() {
  if (await health()) return true;
  spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
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
// PAIR-PAGE
