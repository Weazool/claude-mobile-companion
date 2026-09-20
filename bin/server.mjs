#!/usr/bin/env node
// desk-companion background server (spec §2). One per user, started by the hook forwarder.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir, dataDir, dataFile, readJson, appendLog, loadOrCreateConfig } from '../src/server/paths.mjs';
import { SessionStore } from '../src/server/sessions.mjs';
import { readTail } from '../src/server/transcript.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';
import { createApp } from '../src/server/http.mjs';
import { phoneUrls, listenFixed } from '../src/server/net.mjs';
import { startupAction } from '../src/server/version.mjs';
import { createLimitsPoller, fetchUsage } from '../src/server/limits.mjs';
import { validateMap, clipsFrom } from '../src/web/behaviours.js';
import { SPEC } from '../src/web/clawd/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'src', 'web');
const HOME = path.resolve(homeDir()); // absolute, because start() changes the cwd
const DATA = dataDir(HOME);
const STATE = dataFile('server.json', HOME);
const CONFIG = dataFile('config.json', HOME);
const BEHAVIOURS = dataFile('behaviours.json', HOME);
const CLIPS = clipsFrom(SPEC); // the rig's clips and kinds: what a behaviour map may name
const VERSION = (readJson(path.join(ROOT, 'package.json')) || {}).version || '0.0.0';
const log = msg => appendLog(dataFile('server.log', HOME), msg, 1024 * 1024);

// A stray rejection must not take the dashboard down: log it and keep serving.
process.on('unhandledRejection', e => log(`unhandled rejection: ${(e && e.message) || e}`));

// Our /api/health answer on this port ({ ok: true, pid, version }; no version before 0.9.8), or null for
// silence or anything else.
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

// The port moves only when asked (--port), never by itself: the phone's saved link carries it. The token and
// every other field stay as they are, and the phone has to be paired again afterwards.
async function setPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Usage: server.mjs --port <1024-65535>');
    process.exit(2);
  }
  const cfg = loadOrCreateConfig(HOME);
  await stop();
  fs.writeFileSync(CONFIG, JSON.stringify({ ...cfg, port }, null, 2) + '\n');
  log(`port set to ${port} by hand (was ${cfg.port}); re-pair the phone`);
  console.log(`desk-companion port set to ${port}. Start it again and re-pair the phone.`);
}

// An older desk-companion on our port (a session that still has an older plugin root can launch one): stop it,
// so there is one server, on one port, with one token. Waits for the port to fall quiet.
async function takeOver(running, port) {
  log(`replacing desk-companion ${running.version || '(pre-0.9.8)'} (pid ${running.pid}) with ${VERSION}`);
  try { process.kill(running.pid); } catch { /* already gone */ }
  for (let i = 0; i < 30; i++) {
    const h = await health(port);
    if (!h || h.pid !== running.pid) return;
    await new Promise(r => setTimeout(r, 100));
  }
  log(`desk-companion ${running.version || '(pre-0.9.8)'} (pid ${running.pid}) would not stop`);
}

// The behaviour map the editor at /behaviours saved: every behaviour, anything missing, unreadable or not
// allowed by the rig being its default.
const loadBehaviours = () => validateMap(readJson(BEHAVIOURS), CLIPS);

// Stores a new map from the editor, validated, and returns it. The file is written whole to a temp file
// that then replaces it, so a crash never leaves half a map. { reset: true } deletes the file: the defaults.
// Throws when the disk refuses, leaving the file as it was.
function saveBehaviours(input) {
  if (input && input.reset === true) {
    try { fs.unlinkSync(BEHAVIOURS); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return validateMap({}, CLIPS);
  }
  const map = validateMap(input, CLIPS);
  const tmp = `${BEHAVIOURS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
  fs.renameSync(tmp, BEHAVIOURS);
  return map;
}

async function start() {
  const config = loadOrCreateConfig(HOME);
  process.chdir(DATA); // never hold a project folder: Windows locks a process's cwd against rename and delete
  // One server on the configured port: the newer version serves and the other stands down (version.mjs).
  const running = await health(config.port);
  const action = startupAction(VERSION, running);
  if (action === 'stand-down') return;
  if (action === 'take-over') await takeOver(running, config.port);
  const store = new SessionStore({ contextWindow: config.contextWindow });
  let limits = EMPTY_LIMITS;
  let behaviours = loadBehaviours();
  let onStop = () => {};
  const snapshot = () => buildSnapshot(store, limits, Date.now());

  const app = createApp({
    token: config.token,
    version: VERSION,
    webRoot: WEB,
    log,
    getSnapshot: snapshot,
    onHook(evt) {
      const tail = evt.transcript_path ? readTail(evt.transcript_path) : null;
      const r = store.apply(evt, Date.now(), tail);
      if (!r) return;
      app.broadcast('snapshot', snapshot());
      // An untracked session's moments stay off the phone; its stop still refreshes the limits.
      if (r.discrete && !r.hidden) app.broadcast('event', { type: r.discrete, sessionId: evt.session_id });
      if (r.discrete === 'stop') onStop();
    },
    onUntrack(id) {
      if (store.untrack(id)) app.broadcast('snapshot', snapshot());
    },
    onDevLimits(l) {
      limits = { ...EMPTY_LIMITS, status: 'ok', asOf: Date.now(), ...l };
      app.broadcast('snapshot', snapshot());
    },
    getPairInfo: () => ({ urls: phoneUrls(config), sessions: store.list().length, limits: limits.status }),
    // The editor's save: createApp sends the result to every page (the SSE behaviours event).
    getBehaviours: () => behaviours,
    setBehaviours(input) {
      behaviours = saveBehaviours(input);
      return behaviours;
    },
  });

  // The configured port or nothing: a server that wandered to another port would leave the phone's link and the
  // sessions' events on different endpoints. Somebody else's program on the port is reported, not worked around.
  const bound = await listenFixed(app.server, config.port, { health, log });
  if (!bound.bound) {
    if (bound.ours) log(`desk-companion ${bound.ours.version || '(pre-0.9.8)'} (pid ${bound.ours.pid}) serves port ${config.port}; standing down`);
    else log(`port ${config.port} is held by another program (${bound.code}); desk-companion did not start. `
      + `Free that port, or move desk-companion to another one on purpose: node bin/server.mjs --port <number>, then re-pair the phone.`);
    process.exit(bound.ours ? 0 : 1);
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

const portArg = process.argv.indexOf('--port');
if (process.argv.includes('--stop')) stop().catch(e => log(`stop failed: ${e.message}`)).finally(() => process.exit(0));
else if (portArg >= 0) setPort(Number.parseInt(process.argv[portArg + 1], 10)).catch(e => { log(`--port failed: ${e.message}`); process.exit(1); }).finally(() => process.exit(0));
else start().catch(e => { log(`start failed: ${e.message}`); process.exit(1); });
