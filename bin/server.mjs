#!/usr/bin/env node
// desk-companion background server (spec §2). One per user, started by the hook forwarder.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir, dataDir, dataFile, readJson, appendLog, loadOrCreateConfig, randomPort } from '../src/server/paths.mjs';
import { SessionStore } from '../src/server/sessions.mjs';
import { readTail } from '../src/server/transcript.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';
import { createApp } from '../src/server/http.mjs';
import { phoneUrls, listenWithFallback } from '../src/server/net.mjs';
import { createLimitsPoller, fetchUsage } from '../src/server/limits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'src', 'web');
const HOME = path.resolve(homeDir()); // absolute, because start() changes the cwd
const DATA = dataDir(HOME);
const STATE = dataFile('server.json', HOME);
const CONFIG = dataFile('config.json', HOME);
const LISTEN_ATTEMPTS = 5;
const log = msg => appendLog(dataFile('server.log', HOME), msg, 1024 * 1024);

// A stray rejection must not take the dashboard down: log it and keep serving.
process.on('unhandledRejection', e => log(`unhandled rejection: ${(e && e.message) || e}`));

// Our /api/health answer on this port ({ ok: true, pid }), or null for silence or anything else.
function health(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 500 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(body); } catch { /* not ours */ }
        resolve(res.statusCode === 200 && j && j.ok === true && Number.isInteger(j.pid) ? j : null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// After a reboot the pid in server.json may belong to another program. Kill it only if our server, on the
// recorded port or else on config.port, reports that very pid. server.json goes in every case.
async function stop() {
  const st = readJson(STATE);
  if (st && Number.isInteger(st.pid)) {
    const cfg = readJson(CONFIG);
    for (const port of new Set([st.port, cfg && cfg.port])) {
      if (!Number.isInteger(port)) continue;
      const h = await health(port);
      if (h && h.pid === st.pid) {
        try { process.kill(st.pid); } catch { /* already gone */ }
        break;
      }
    }
  }
  try { fs.unlinkSync(STATE); } catch { /* no state file */ }
}

// Only the port changes; the token and every other field stay.
function savePort(config, port) {
  const disk = readJson(CONFIG);
  const base = disk && typeof disk === 'object' && !Array.isArray(disk) ? disk : config;
  fs.writeFileSync(CONFIG, JSON.stringify({ ...base, port }, null, 2) + '\n');
}

async function start() {
  const config = loadOrCreateConfig(HOME);
  process.chdir(DATA); // never hold a project folder: Windows locks a process's cwd against rename and delete
  if (await health(config.port)) return; // another instance already serves this port
  const store = new SessionStore({ contextWindow: config.contextWindow });
  let limits = EMPTY_LIMITS;
  let onStop = () => {};
  const snapshot = () => buildSnapshot(store, limits, Date.now());

  const app = createApp({
    token: config.token,
    webRoot: WEB,
    log,
    getSnapshot: snapshot,
    onHook(evt) {
      const tail = evt.transcript_path ? readTail(evt.transcript_path) : null;
      const r = store.apply(evt, Date.now(), tail);
      if (!r) return;
      app.broadcast('snapshot', snapshot());
      if (r.discrete) app.broadcast('event', { type: r.discrete, sessionId: evt.session_id });
      if (r.discrete === 'stop') onStop();
    },
    onDevLimits(l) {
      limits = { ...EMPTY_LIMITS, status: 'ok', asOf: Date.now(), ...l };
      app.broadcast('snapshot', snapshot());
    },
    getPairInfo: () => ({ urls: phoneUrls(config), sessions: store.list().length, limits: limits.status }),
  });

  // A reserved or foreign-held port moves the server to a new port, saved once bound, so the hook and the
  // pair page follow it; the phone must be re-paired.
  const bound = await listenWithFallback(app.server, config.port, { health, pickPort: randomPort, log, attempts: LISTEN_ATTEMPTS });
  if (!bound) process.exit(0); // another instance won the start-up race
  if (bound.port !== config.port) {
    savePort(config, bound.port);
    log(`port ${config.port} unavailable (${bound.code}); switched to ${bound.port}, re-pair the phone`);
    config.port = bound.port;
  }
  app.server.on('error', e => {
    log(`server error: ${e.message}`);
    process.exit(1);
  });
  fs.writeFileSync(STATE, JSON.stringify({ pid: process.pid, port: config.port, startedAt: Date.now() }));
  log(`listening on ${config.port}`);

  // Polling starts only once this process owns the port, so a process that loses never starts a claude child.
  if (!process.env.DESK_COMPANION_NO_LIMITS) {
    const poller = createLimitsPoller({
      log,
      fetch: opts => fetchUsage({ ...opts, cwd: DATA }),
      onUpdate(l) { limits = l; app.broadcast('snapshot', snapshot()); },
    });
    onStop = () => poller.onStop();
    poller.start();
  }
  setInterval(() => { if (store.expire(Date.now())) app.broadcast('snapshot', snapshot()); }, 60_000).unref();

  const bye = () => {
    try { if ((readJson(STATE) || {}).pid === process.pid) fs.unlinkSync(STATE); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

if (process.argv.includes('--stop')) stop().catch(e => log(`stop failed: ${e.message}`)).finally(() => process.exit(0));
else start().catch(e => { log(`start failed: ${e.message}`); process.exit(1); });
