#!/usr/bin/env node
// desk-companion background server (spec §2). One per user, started by the hook forwarder.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir, dataFile, readJson, appendLog, loadOrCreateConfig } from '../src/server/paths.mjs';
import { SessionStore } from '../src/server/sessions.mjs';
import { readTail } from '../src/server/transcript.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';
import { createApp } from '../src/server/http.mjs';
import { phoneUrls } from '../src/server/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'src', 'web');
const HOME = homeDir();
const STATE = dataFile('server.json', HOME);
const log = msg => appendLog(dataFile('server.log', HOME), msg, 1024 * 1024);

function health(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 500 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function stop() {
  const st = readJson(STATE);
  if (st && st.pid) {
    try { process.kill(st.pid); } catch { /* already gone */ }
  }
  try { fs.unlinkSync(STATE); } catch { /* no state file */ }
}

async function start() {
  const config = loadOrCreateConfig(HOME);
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

  // LIMITS-POLLER

  app.server.on('error', e => {
    if (e.code === 'EADDRINUSE') process.exit(0); // lost a start-up race to another instance
    log(`server error: ${e.message}`);
    process.exit(1);
  });
  app.server.listen(config.port, '0.0.0.0', () => {
    fs.writeFileSync(STATE, JSON.stringify({ pid: process.pid, port: config.port, startedAt: Date.now() }));
    log(`listening on ${config.port}`);
  });
  setInterval(() => { if (store.expire(Date.now())) app.broadcast('snapshot', snapshot()); }, 60_000).unref();

  const bye = () => {
    try { if ((readJson(STATE) || {}).pid === process.pid) fs.unlinkSync(STATE); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

if (process.argv.includes('--stop')) stop();
else start().catch(e => { log(`start failed: ${e.message}`); process.exit(1); });
