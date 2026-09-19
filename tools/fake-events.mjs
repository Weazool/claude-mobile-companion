#!/usr/bin/env node
// Replays demo scenarios into the running server, for checking the page without Claude.
// Usage: node tools/fake-events.mjs <turn|limits|idle|wake|end>
import http from 'node:http';
import { homeDir, dataFile, readJson } from '../src/server/paths.mjs';

const cfg = readJson(dataFile('config.json', homeDir()));
if (!cfg) {
  console.error('No ~/.desk-companion/config.json yet. Start the server first: node bin/server.mjs');
  process.exit(1);
}

function post(p, body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: p, method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dc-token': cfg.token, 'content-length': Buffer.byteLength(data) } },
      res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end(data);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hook = (sid, name, { project = 'my_claude_companion', ...extra } = {}) =>
  post('/api/hook', { hook_event_name: name, session_id: sid, cwd: `C:\\demo\\${project}`, receivedAt: Date.now(), ...extra });
const limits = (fiveHour, week = 34, fable = 41) => post('/api/dev/limits', {
  fiveHour: { pct: fiveHour, resetsAt: Date.now() + 3 * 3600e3 },
  week: { pct: week, resetsAt: Date.now() + 3 * 86400e3 },
  fable: { pct: fable, resetsAt: Date.now() + 3 * 86400e3 },
});

const SCENARIOS = {
  async turn() {
    await limits(38);
    await hook('demo-2', 'SessionStart', { project: 'clauled', model: 'claude-fable-5-1', effort: 'xhigh' });
    await hook('demo-2', 'Stop', { project: 'clauled' });
    await hook('demo-1', 'SessionStart', { model: 'claude-opus-5', effort: 'high' });
    const steps = [
      [3000, 'UserPromptSubmit', {}],
      [4000, 'PreToolUse', { tool_name: 'Read', target: 'hooks.json' }],
      [3000, 'PostToolUse', {}],
      [1500, 'PreToolUse', { tool_name: 'Edit', target: 'server.mjs' }],
      [4000, 'Notification', { notification_type: 'permission_prompt' }],
      [6000, 'PreToolUse', { tool_name: 'Bash', target: 'npm test', build: true }],
      [4500, 'Stop', {}],
    ];
    for (const [wait, name, extra] of steps) {
      await sleep(wait);
      console.log(name, extra.tool_name || '');
      await hook('demo-1', name, { effort: 'high', ...extra });
    }
  },
  async limits() {
    await hook('demo-1', 'SessionStart', { model: 'claude-opus-5', effort: 'high' });
    await hook('demo-1', 'Stop', {});
    for (const [wait, pct] of [[0, 46], [3000, 55], [4000, 83], [4000, 96], [3500, 100]]) {
      await sleep(wait);
      console.log('5-hour', pct);
      await limits(pct);
    }
    await sleep(4000);
    console.log('StopFailure rate_limit');
    await hook('demo-1', 'StopFailure', { error: 'rate_limit' });
    await sleep(5000);
    console.log('reset to 2%');
    await limits(2);
    await hook('demo-1', 'Stop', {});
  },
  async idle() {
    await limits(38);
    await hook('demo-1', 'SessionStart', { model: 'claude-opus-5', effort: 'high' });
    await hook('demo-1', 'Stop', {});
    console.log('Now leave it: the companion falls asleep after the "sleep after" setting (default 2 min).');
    console.log('Then run: node tools/fake-events.mjs wake');
  },
  async wake() {
    await hook('demo-1', 'UserPromptSubmit', { effort: 'high' });
    await sleep(4000);
    await hook('demo-1', 'Stop', {});
  },
  async end() {
    for (const sid of ['demo-1', 'demo-2']) await hook(sid, 'SessionEnd', {});
  },
};

const name = process.argv[2] || 'turn';
if (!SCENARIOS[name]) {
  console.error(`Unknown scenario "${name}". Use one of: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}
await SCENARIOS[name]();
console.log('done');
