#!/usr/bin/env node
// Claude Code hook forwarder (spec §1). Never blocks Claude, never prints, always exits 0.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitize } from '../src/hook/sanitize.mjs';
import { homeDir, dataFile, readJson, appendLog } from '../src/server/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = homeDir();
const log = msg => appendLog(dataFile('hook.log', HOME), msg, 256 * 1024);

function readStdin(timeoutMs) {
  return new Promise(resolve => {
    let data = '';
    const t = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

function request(method, port, urlPath, token, body, timeoutMs) {
  return new Promise(resolve => {
    const headers = { 'content-type': 'application/json', 'x-dc-token': token || '' };
    if (body) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers, timeout: timeoutMs }, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(body || undefined);
  });
}

// Hooks run in the session's project folder. The server must not inherit it: Windows locks a process's cwd
// against rename and delete. The home dir always exists; the server then moves into its data dir.
function spawnServer() {
  if (process.env.DESK_COMPANION_NO_SPAWN) return;
  try {
    spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')],
      { detached: true, stdio: 'ignore', windowsHide: true, env: process.env, cwd: os.homedir() }).unref();
  } catch (e) {
    log(`spawn failed: ${e.message}`);
  }
}

async function waitForServer(limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const cfg = readJson(dataFile('config.json', HOME));
    if (cfg && await request('GET', cfg.port, '/api/health', '', null, 200)) return cfg;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

async function main() {
  if (process.env.DESK_COMPANION_INTERNAL) return;
  const text = await readStdin(1000);
  let raw;
  try { raw = JSON.parse(text || '{}'); } catch { log('invalid hook JSON on stdin'); return; }
  const evt = sanitize(raw, process.env);
  if (!evt.hook_event_name || !evt.session_id) return;
  const body = JSON.stringify(evt);
  const cfg = readJson(dataFile('config.json', HOME));
  if (cfg && await request('POST', cfg.port, '/api/hook', cfg.token, body, 300)) return;
  spawnServer();
  if (evt.hook_event_name !== 'SessionStart') return; // other events: drop this one
  const live = await waitForServer(2000);
  if (live) await request('POST', live.port, '/api/hook', live.token, body, 300);
}

main()
  .catch(e => log(`hook error: ${e && e.message}`))
  .finally(() => process.exit(0));
