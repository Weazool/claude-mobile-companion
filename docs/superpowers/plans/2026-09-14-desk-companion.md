# desk-companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that serves a live, full-screen dashboard to a phone browser on the same Wi-Fi. It shows plan limits, active sessions and an animated companion driven by Claude Code hooks.

**Architecture:** Hook commands forward sanitised events to one background Node server per user. The server tracks sessions, polls plan limits through Claude Code's `get_usage`, and pushes snapshots over Server-Sent Events to a plain HTML/JS page. The page runs the companion's state machine (`mood.js`) and draws Clawd with a live SVG rig (`src/web/clawd/`).

> **Superseded in part (v0.3.0).** The companion was first built from clawdio's sprites (Tasks 11–13, and the sprite steps of Tasks 15 and 17). Those are kept below as a record of how it was built; the sprite player, the sprites and their build pipeline have since been replaced by the Clawd SVG rig (spec §8–9). `tools/lib/png.mjs` from Task 11 remains.

**Tech Stack:** Node ≥ 18 (ESM, built-in modules only), `node:test`, vanilla HTML/CSS/JS, Server-Sent Events. Vendored MIT libraries: `qrcode-generator` 1.4.4 and `nosleep.js` 0.12.0.

**Spec:** `docs/superpowers/specs/2026-09-14-desk-companion-design.md`. Read it before starting any task; section numbers (§) below refer to it.

## Global Constraints

- Node ≥ 18. The dev machine has Node 22.19.0 on Windows 11. All code is ESM, with `"type": "module"`.
- **No npm dependencies**, runtime or dev. Tests use `node:test` and `node:assert/strict`; run them with `node --test`.
- Data directory is `~/.desk-companion/`, resolved as `process.env.DESK_COMPANION_HOME || os.homedir()` + `/.desk-companion`. Tests always set `DESK_COMPANION_HOME` to a temp dir.
- Plugin and marketplace name: `desk-companion`. The pairing skill is `/desk-companion:pair`.
- Hook forwarder: POST timeout 300 ms; always exit code 0; never write to stdout. On `SessionStart` only, it waits up to 2 s for a server it just started.
- Server port: random 50000–60000, persisted. Token: 128-bit hex (32 chars), persisted. Both in `config.json`.
- **Never** read Claude credential files or tokens. **Never** forward prompts, tool inputs or tool outputs; the forwarder whitelist is in §1.
- Limits child process: `claude -p --safe-mode --input-format stream-json --output-format stream-json --verbose`, with env `DESK_COMPANION_INTERNAL=1`.
- Limits schedule: every 5 min; 60 s after a `Stop`; at least 2 min between calls; back-off 10 / 20 / 30 min; stale after 15 min.
- Page: plain HTML/CSS/JS served as-is; no build step, no framework, no CDN at runtime.
- Ring colours: 5-hour `#f5a524`, week `#35c2b0`, Fable `#a78bfa`. The number turns red (`#ff6b5b`) at ≥ 80%.
- Defaults: mood thresholds 50 / 80 / 95; idle 26 blinks/min, 2 glances/min, 50% moving; sleep after 5 min.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `package.json`, `LICENSE`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Package and plugin manifests |
| `hooks/hooks.json` | Registers `bin/hook.mjs` for the 8 hook events |
| `skills/pair/SKILL.md` | `/desk-companion:pair` |
| `bin/hook.mjs` | Hook forwarder process (I/O only) |
| `bin/server.mjs` | Server entry: wiring, lifecycle, `--stop` |
| `bin/pair.mjs` | Ensures the server runs, prints phone URLs, opens the pair page |
| `src/hook/sanitize.mjs` | Pure: raw hook JSON → whitelisted event |
| `src/server/paths.mjs` | Data dir, config, JSON read, log rotation |
| `src/server/net.mjs` | LAN IPv4 discovery → phone URLs |
| `src/server/transcript.mjs` | Transcript tail → model, effort, context tokens |
| `src/server/sessions.mjs` | `SessionStore`: sessions, activity, focus, expiry |
| `src/server/limits.mjs` | `get_usage` client, parser, poller |
| `src/server/snapshot.mjs` | Builds the snapshot object |
| `src/server/http.mjs` | HTTP routes, auth, SSE, static files |
| `src/web/index.html`, `style.css`, `app.js` | Dashboard page shell and wiring |
| `src/web/format.js` | Pure display helpers (countdowns, ring tone, row text) |
| `src/web/clawd/*` | Clawd, the SVG rig: clips (`anims/`), `Player` with calm idle, renderer (`svg.js`), mock page |
| `src/web/mood.js` | `createMood`: the companion's state machine |
| `src/web/settings.js` | Settings defaults, load/save/validate, rotation geometry |
| `src/web/pair.html` | Pairing page (QR) |
| `src/web/manifest.webmanifest`, `src/web/icon.png` | Home Screen web-app metadata |
| `src/web/vendor/*` | `qrcode.js`, `NoSleep.min.js` and their licences |
| `tools/clawd-look.mjs`, `tools/lib/rast.mjs`, `tools/lib/png.mjs` | Renders Clawd's clips to PNG contact sheets, and the Home Screen icon |
| `tools/fake-events.mjs` | Replays scenarios into a running server |
| `test/*.test.mjs`, `test/fixtures/*` | Tests |

## Task order

- **Tasks 1–8** reach **milestone 1**: the plugin installed, and live sessions on the phone, without the creature yet.
- **Task 9** adds limits.
- **Task 10** adds pairing with a QR code.
- **Tasks 11–15** add the sprites and the creature, reaching **milestone 2** at Task 15.
- **Task 16** adds controls and settings.
- **Task 17** finishes: README and the on-device checks.

---

### Task 0: `get_usage` spike (DONE during planning)

Recorded here so nobody repeats it:

- `claude -p --safe-mode --input-format stream-json --output-format stream-json --verbose` on CLI 2.1.245. After writing `{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}` the reply is `control_response` with subtype `success` in about 1 s. Then `{"type":"control_request","request_id":"usage","request":{"subtype":"get_usage","skip_behaviors":true}}` replies with `success` within 30 ms.
- Signed out, the payload is `{"subscription_type":null,"rate_limits_available":false,"rate_limits":null}`. `claude auth status` showed `"loggedIn": false` for both the npm CLI and the desktop app's bundled CLI. The user must run `claude auth login` once.
- The response type is `SDKControlGetUsageResponse` in `@anthropic-ai/claude-agent-sdk` 0.3.270 `sdk.d.ts`. `rate_limits.five_hour` and `rate_limits.seven_day` are `{utilization: 0-100 | null, resets_at: ISO string | null}`, and `rate_limits.model_scoped` is an array of `{display_name, utilization, resets_at}`, e.g. `display_name: "Fable"`.

---

### Task 1: Project skeleton and config

**Files:**
- Create: `package.json`, `LICENSE`, `.gitattributes`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `src/server/paths.mjs`
- Test: `test/paths.test.mjs`
- Already present: `.gitignore` (`.superpowers/`, `node_modules/`, `tools/.cache/`, `*.log`) and the spec.

**Interfaces:**
- Produces:
  - `homeDir(): string`
  - `dataDir(home?): string`
  - `dataFile(name, home?): string`
  - `loadOrCreateConfig(home?, randomBytes?): {port: number, token: string, contextWindow: object}`
  - `readJson(file): any | null`
  - `appendLog(file, line, maxBytes): void`

- [ ] **Step 1: Create the manifests**

`package.json`:
```json
{
  "name": "desk-companion",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Live Claude Code dashboard with an animated companion, served to a phone on your Wi-Fi",
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test" }
}
```

`.claude-plugin/plugin.json`:
```json
{
  "name": "desk-companion",
  "version": "0.1.0",
  "description": "Live Claude Code dashboard with an animated companion, served to a phone on your Wi-Fi",
  "author": { "name": "Weazool" },
  "license": "MIT",
  "keywords": ["dashboard", "hooks", "usage", "limits", "companion"]
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "desk-companion",
  "description": "desk-companion: a live Claude Code dashboard for your phone",
  "owner": { "name": "Weazool" },
  "plugins": [
    {
      "name": "desk-companion",
      "description": "Live Claude Code dashboard with an animated companion, served to a phone on your Wi-Fi",
      "author": { "name": "Weazool" },
      "source": "./",
      "category": "productivity"
    }
  ]
}
```

`LICENSE`: the standard MIT licence text with the line `Copyright (c) 2026 Weazool`.

`.gitattributes`: this machine has `core.autocrlf=true`. LF keeps shebang lines and the skill frontmatter intact.
```
* text=auto eol=lf
*.png binary
```

- [ ] **Step 2: Write the failing test**

`test/paths.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOrCreateConfig, dataFile, appendLog, readJson } from '../src/server/paths.mjs';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dc-home-'));

test('creates a config with a port in 50000-60000 and a 32-hex token', () => {
  const home = tmpHome();
  const cfg = loadOrCreateConfig(home);
  assert.ok(cfg.port >= 50000 && cfg.port <= 60000, `port ${cfg.port}`);
  assert.match(cfg.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(cfg.contextWindow, {});
  assert.deepEqual(readJson(dataFile('config.json', home)), cfg);
});

test('returns the same config on the second call', () => {
  const home = tmpHome();
  assert.deepEqual(loadOrCreateConfig(home), loadOrCreateConfig(home));
});

test('repairs invalid fields and keeps valid ones', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.desk-companion'), { recursive: true });
  fs.writeFileSync(dataFile('config.json', home),
    JSON.stringify({ port: 55555, token: 'nope', contextWindow: { 'claude-x': 5 } }));
  const cfg = loadOrCreateConfig(home, n => Buffer.alloc(n, 0xab));
  assert.equal(cfg.port, 55555);
  assert.equal(cfg.token, 'ab'.repeat(16));
  assert.deepEqual(cfg.contextWindow, { 'claude-x': 5 });
});

test('random port uses randomBytes: 0xabab % 10001 + 50000 = 53943', () => {
  const cfg = loadOrCreateConfig(tmpHome(), n => Buffer.alloc(n, 0xab));
  assert.equal(cfg.port, 53943);
});

test('appendLog rotates when the file exceeds maxBytes', () => {
  const file = dataFile('x.log', tmpHome());
  appendLog(file, 'a'.repeat(100), 50);
  appendLog(file, 'second', 50);
  assert.ok(fs.existsSync(file + '.1'));
  assert.match(fs.readFileSync(file, 'utf8'), /second/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /aaaa/);
});

test('readJson returns null for a missing or malformed file', () => {
  const home = tmpHome();
  assert.equal(readJson(path.join(home, 'missing.json')), null);
  fs.writeFileSync(path.join(home, 'bad.json'), '{nope');
  assert.equal(readJson(path.join(home, 'bad.json')), null);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/paths.test.mjs`
Expected: FAIL with `Cannot find module ... src/server/paths.mjs`.

- [ ] **Step 4: Implement `src/server/paths.mjs`**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function homeDir() {
  return process.env.DESK_COMPANION_HOME || os.homedir();
}

export function dataDir(home = homeDir()) {
  return path.join(home, '.desk-companion');
}

export function dataFile(name, home = homeDir()) {
  return path.join(dataDir(home), name);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Creates ~/.desk-companion/config.json on first run and repairs invalid fields.
// Port and token persist so a bookmarked phone URL keeps working across restarts.
export function loadOrCreateConfig(home = homeDir(), randomBytes = crypto.randomBytes) {
  fs.mkdirSync(dataDir(home), { recursive: true });
  const file = dataFile('config.json', home);
  let cfg = readJson(file);
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) cfg = {};
  let changed = false;
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) {
    cfg.port = 50000 + (randomBytes(2).readUInt16BE(0) % 10001);
    changed = true;
  }
  if (typeof cfg.token !== 'string' || !/^[0-9a-f]{32}$/.test(cfg.token)) {
    cfg.token = randomBytes(16).toString('hex');
    changed = true;
  }
  if (typeof cfg.contextWindow !== 'object' || cfg.contextWindow === null || Array.isArray(cfg.contextWindow)) {
    cfg.contextWindow = {};
    changed = true;
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

// Appends one timestamped line; when the file is over maxBytes it is moved to `<file>.1` first.
// Never throws: logging must not break a hook or the server.
export function appendLog(file, line, maxBytes) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* no file yet */ }
    if (size > maxBytes) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/paths.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json LICENSE .gitattributes .claude-plugin src/server/paths.mjs test/paths.test.mjs
git commit -m "feat: project skeleton, plugin manifests and config store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Transcript tail reader

**Files:**
- Create: `src/server/transcript.mjs`, `test/fixtures/transcript.jsonl`
- Test: `test/transcript.test.mjs`

**Interfaces:**
- Produces:
  - `TAIL_BYTES = 65536`
  - `parseTail(text, dropFirstLine?): {model, effort, contextTokens}`, each field possibly `null`
  - `readTail(file, bytes?): {model, effort, contextTokens}`
  - `contextWindow(modelId, overrides?): number`
  - `contextPct(tokens, modelId, overrides?): number | null`

Background (§3): transcripts are JSONL. Assistant lines look like `{"type":"assistant","effort":"xhigh","message":{"model":"claude-opus-5","usage":{"input_tokens":…,"cache_read_input_tokens":…,"cache_creation_input_tokens":…}}}`. Ignore `isSidechain: true` lines and the model `<synthetic>`. Never log or forward line content.

- [ ] **Step 1: Create the fixture** `test/fixtures/transcript.jsonl`. It has exactly these 6 lines; the last line is deliberately malformed:

```
{"type":"user","message":{"role":"user","content":"x"}}
{"type":"assistant","effort":"high","message":{"model":"claude-opus-4-8","usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":5,"output_tokens":7}}}
{"type":"assistant","effort":"xhigh","message":{"model":"claude-opus-5","usage":{"input_tokens":2000,"cache_read_input_tokens":240000,"cache_creation_input_tokens":8000,"output_tokens":50}}}
{"type":"assistant","isSidechain":true,"message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":1,"cache_read_input_tokens":1,"cache_creation_input_tokens":1}}}
{"type":"assistant","message":{"model":"<synthetic>","usage":{"input_tokens":0}}}
{not json
```

- [ ] **Step 2: Write the failing test** `test/transcript.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTail, readTail, contextWindow, contextPct } from '../src/server/transcript.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.jsonl');

test('parseTail takes the newest real assistant line, skipping sidechain, synthetic and malformed lines', () => {
  const r = parseTail(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(r, { model: 'claude-opus-5', effort: 'xhigh', contextTokens: 250000 });
});

test('readTail drops a partial first line when it starts mid-file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-tr-'));
  const file = path.join(dir, 't.jsonl');
  const filler = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: 'user', n: i, pad: 'x'.repeat(40) })).join('\n');
  const last = JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1000 } } });
  fs.writeFileSync(file, filler + '\n' + last + '\n');
  assert.deepEqual(readTail(file, 150), { model: 'claude-sonnet-5', effort: null, contextTokens: 1000 });
});

test('readTail returns nulls for a missing file or empty path', () => {
  const empty = { model: null, effort: null, contextTokens: null };
  assert.deepEqual(readTail(path.join(os.tmpdir(), 'nope-' + Date.now() + '.jsonl')), empty);
  assert.deepEqual(readTail(''), empty);
});

test('contextWindow is 1M except Haiku, and honours overrides', () => {
  assert.equal(contextWindow('claude-opus-5'), 1_000_000);
  assert.equal(contextWindow('claude-fable-5-1'), 1_000_000);
  assert.equal(contextWindow('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(contextWindow(null), 1_000_000);
  assert.equal(contextWindow('claude-opus-5', { 'claude-opus-5': 500_000 }), 500_000);
});

test('contextPct rounds and clamps to 0..100', () => {
  assert.equal(contextPct(250_000, 'claude-opus-5'), 25);
  assert.equal(contextPct(150_000, 'claude-haiku-4-5'), 75);
  assert.equal(contextPct(5_000_000, 'claude-opus-5'), 100);
  assert.equal(contextPct(null, 'claude-opus-5'), null);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/transcript.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/server/transcript.mjs`**

```js
import fs from 'node:fs';

export const TAIL_BYTES = 65536;

const empty = () => ({ model: null, effort: null, contextTokens: null });

// Scans lines newest-first. Content is never returned; only model id, effort and a token count.
export function parseTail(text, dropFirstLine = false) {
  let lines = text.split('\n');
  if (dropFirstLine) lines = lines.slice(1);
  let model = null;
  let effort = null;
  let contextTokens = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || o.isSidechain === true) continue;
    if (effort === null && typeof o.effort === 'string') effort = o.effort;
    const msg = o.type === 'assistant' ? o.message : null;
    if (msg && msg.model && msg.model !== '<synthetic>') {
      if (model === null) model = msg.model;
      const u = msg.usage;
      if (contextTokens === null && u) {
        contextTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    }
    if (model !== null && effort !== null && contextTokens !== null) break;
  }
  return { model, effort, contextTokens };
}

// Reads only the last `bytes` of the file; a line cut in half at the start is dropped.
export function readTail(file, bytes = TAIL_BYTES) {
  if (!file) return empty();
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return empty(); }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return parseTail(buf.toString('utf8'), start > 0);
  } catch {
    return empty();
  } finally {
    fs.closeSync(fd);
  }
}

// Measured on this machine: Opus 5, Fable 5.1, Sonnet 5 and Opus 4.x sessions all reach ~1M tokens.
export function contextWindow(modelId, overrides = {}) {
  const o = modelId ? overrides[modelId] : undefined;
  if (Number.isFinite(o) && o > 0) return o;
  if (modelId && /haiku/i.test(modelId)) return 200_000;
  return 1_000_000;
}

export function contextPct(tokens, modelId, overrides) {
  if (!Number.isFinite(tokens)) return null;
  return Math.max(0, Math.min(100, Math.round((100 * tokens) / contextWindow(modelId, overrides))));
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/transcript.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/transcript.mjs test/transcript.test.mjs test/fixtures/transcript.jsonl
git commit -m "feat: transcript tail reader for model, effort and context" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Session store

**Files:**
- Create: `src/server/sessions.mjs`
- Test: `test/sessions.test.mjs`

**Interfaces:**
- Consumes: `contextPct(tokens, modelId, overrides)` from Task 2.
- Produces:
  - `EXPIRE_MS = 3600000`
  - `ACTIVE: Set<'thinking'|'reading'|'working'|'compiling'>`
  - `modelLabel(id): string | null`
  - `classify(evt): object | null`
  - `class SessionStore`:
    - `constructor({contextWindow} = {})`
    - `apply(evt, now, tail = null): {discrete: string | null} | null`
    - `expire(now): boolean`
    - `list(): SessionView[]`
    - `focusId(): string | null`
  - `SessionView = {id, name, modelLabel, effort, contextPct, activity, detail, needsYou, lastEventAt}`
  - `activity ∈ idle | thinking | reading | working | compiling | done | rateLimited | error`
  - `discrete ∈ sessionStart | prompt | needsYou | stop | rateLimited | error | null`

Events arrive already sanitised (Task 4 shape): `{hook_event_name, session_id, cwd, transcript_path, model?, effort?, envEffort?, tool_name?, target?, build?, notification_type?, error?, source?, receivedAt}`.

- [ ] **Step 1: Write the failing test** `test/sessions.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, classify, modelLabel, EXPIRE_MS } from '../src/server/sessions.mjs';

const ev = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: 's1', cwd: 'C:\\Users\\weazo\\GitHub\\my_claude_companion', ...extra });

test('modelLabel', () => {
  assert.equal(modelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-opus-5[1m]'), 'Opus 5');
  assert.equal(modelLabel('<synthetic>'), null);
  assert.equal(modelLabel('gpt-x'), 'gpt-x');
});

test('classify maps tools to activity and detail', () => {
  const pre = (tool_name, extra = {}) => classify({ hook_event_name: 'PreToolUse', tool_name, ...extra });
  assert.deepEqual(pre('Read', { target: 'hooks.json' }), { needsYou: false, activity: 'reading', detail: 'Reading hooks.json' });
  assert.equal(pre('Grep').detail, 'Searching');
  assert.equal(pre('WebFetch').detail, 'Browsing');
  assert.deepEqual(pre('Edit', { target: 'server.mjs' }), { needsYou: false, activity: 'working', detail: 'Editing server.mjs' });
  assert.equal(pre('Write', { target: 'a.md' }).detail, 'Writing a.md');
  assert.deepEqual(pre('Bash', { target: 'npm test', build: true }), { needsYou: false, activity: 'compiling', detail: 'Running npm test' });
  assert.deepEqual(pre('Bash', { target: 'git status' }), { needsYou: false, activity: 'working', detail: 'Running git status' });
  assert.equal(pre('Bash').detail, 'Running a command');
  assert.equal(pre('Task').detail, 'Delegating');
  assert.equal(pre('mcp__server__tool_with_a_long_name').detail, 'mcp__server__tool_with_a');
  assert.deepEqual(pre('AskUserQuestion'), { needsYou: true, detail: 'Has a question', discrete: 'needsYou' });
  assert.deepEqual(pre('ExitPlanMode'), { needsYou: true, detail: 'Plan ready for review', discrete: 'needsYou' });
  assert.equal(classify({ hook_event_name: 'Nope' }), null);
});

test('a turn: start, prompt, notification, tool, stop', () => {
  const st = new SessionStore();
  assert.deepEqual(st.apply(ev('SessionStart', { model: 'claude-opus-5' }), 1000), { discrete: 'sessionStart' });
  let [s] = st.list();
  assert.equal(s.name, 'my_claude_companion');
  assert.equal(s.modelLabel, 'Opus 5');
  assert.equal(s.activity, 'idle');

  assert.deepEqual(st.apply(ev('UserPromptSubmit'), 2000), { discrete: 'prompt' });
  assert.equal(st.list()[0].activity, 'thinking');

  assert.deepEqual(st.apply(ev('Notification', { notification_type: 'permission_prompt' }), 3000), { discrete: 'needsYou' });
  [s] = st.list();
  assert.equal(s.needsYou, true);
  assert.equal(s.activity, 'thinking');
  assert.equal(s.detail, 'Needs permission');

  st.apply(ev('PreToolUse', { tool_name: 'Bash', target: 'npm test', build: true }), 4000);
  [s] = st.list();
  assert.equal(s.needsYou, false);
  assert.equal(s.activity, 'compiling');

  assert.deepEqual(st.apply(ev('Stop'), 5000), { discrete: 'stop' });
  assert.equal(st.list()[0].activity, 'done');
  assert.equal(st.list()[0].detail, 'Your turn');
});

test('StopFailure distinguishes rate limits from other errors', () => {
  const st = new SessionStore();
  assert.deepEqual(st.apply(ev('StopFailure', { error: 'rate_limit' }), 1), { discrete: 'rateLimited' });
  assert.equal(st.list()[0].activity, 'rateLimited');
  assert.deepEqual(st.apply(ev('StopFailure', { error: 'server_error' }), 2), { discrete: 'error' });
  assert.equal(st.list()[0].activity, 'error');
});

test('effort precedence: payload, then CLAUDE_EFFORT, then transcript', () => {
  const st = new SessionStore();
  st.apply(ev('UserPromptSubmit'), 1, { model: null, effort: 'low', contextTokens: null });
  assert.equal(st.list()[0].effort, 'low');
  st.apply(ev('PreToolUse', { tool_name: 'Read', envEffort: 'high' }), 2, { model: null, effort: 'low', contextTokens: null });
  assert.equal(st.list()[0].effort, 'high');
  st.apply(ev('PreToolUse', { tool_name: 'Read', effort: 'max', envEffort: 'high' }), 3);
  assert.equal(st.list()[0].effort, 'max');
});

test('transcript tail supplies model and context percent', () => {
  const st = new SessionStore({ contextWindow: {} });
  st.apply(ev('UserPromptSubmit'), 1, { model: 'claude-fable-5-1', effort: null, contextTokens: 250000 });
  const [s] = st.list();
  assert.equal(s.modelLabel, 'Fable 5.1');
  assert.equal(s.contextPct, 25);
});

test('focus: needsYou beats active beats most recent', () => {
  const st = new SessionStore();
  st.apply({ ...ev('UserPromptSubmit'), session_id: 'A' }, 1000);
  st.apply({ ...ev('Stop'), session_id: 'B' }, 2000);
  assert.equal(st.focusId(), 'A');
  st.apply({ ...ev('Notification'), session_id: 'B' }, 3000);
  assert.equal(st.focusId(), 'B');
  st.apply({ ...ev('PostToolUse'), session_id: 'B' }, 4000);
  assert.equal(st.focusId(), 'B');
  st.apply({ ...ev('Stop'), session_id: 'A' }, 5000);
  st.apply({ ...ev('Stop'), session_id: 'B' }, 6000);
  assert.equal(st.focusId(), 'B');
  assert.equal(new SessionStore().focusId(), null);
});

test('SessionEnd removes, expire drops silent sessions, list is ordered by start', () => {
  const st = new SessionStore();
  st.apply({ ...ev('SessionStart'), session_id: 'A' }, 1000);
  st.apply({ ...ev('SessionStart'), session_id: 'B' }, 2000);
  st.apply({ ...ev('UserPromptSubmit'), session_id: 'A' }, 3000);
  assert.deepEqual(st.list().map(s => s.id), ['A', 'B']);
  assert.deepEqual(Object.keys(st.list()[0]).sort(),
    ['activity', 'contextPct', 'detail', 'effort', 'id', 'lastEventAt', 'modelLabel', 'name', 'needsYou']);
  st.apply({ ...ev('SessionEnd'), session_id: 'A' }, 4000);
  assert.deepEqual(st.list().map(s => s.id), ['B']);
  assert.equal(st.expire(2000 + EXPIRE_MS), false);
  assert.equal(st.expire(2001 + EXPIRE_MS), true);
  assert.deepEqual(st.list(), []);
});

test('unknown events and events without session_id change nothing', () => {
  const st = new SessionStore();
  assert.equal(st.apply({ hook_event_name: 'Weird', session_id: 's' }, 1), null);
  assert.equal(st.apply({ hook_event_name: 'Stop' }, 1), null);
  assert.deepEqual(st.list(), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/sessions.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/server/sessions.mjs`**

```js
import path from 'node:path';
import { contextPct } from './transcript.mjs';

export const EXPIRE_MS = 60 * 60 * 1000;
export const ACTIVE = new Set(['thinking', 'reading', 'working', 'compiling']);

const READ = new Set(['Read', 'NotebookRead']);
const SEARCH = new Set(['Grep', 'Glob', 'LS']);
const WEB = new Set(['WebFetch', 'WebSearch']);
const EDIT = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

// claude-opus-5 → "Opus 5", claude-fable-5-1 → "Fable 5.1", claude-haiku-4-5-20251001 → "Haiku 4.5".
export function modelLabel(id) {
  if (!id || id === '<synthetic>') return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

function classifyTool(name, target, build) {
  if (name === 'AskUserQuestion') return { needsYou: true, detail: 'Has a question', discrete: 'needsYou' };
  if (name === 'ExitPlanMode') return { needsYou: true, detail: 'Plan ready for review', discrete: 'needsYou' };
  const r = { needsYou: false };
  if (READ.has(name)) return { ...r, activity: 'reading', detail: target ? `Reading ${target}` : 'Reading' };
  if (SEARCH.has(name)) return { ...r, activity: 'reading', detail: 'Searching' };
  if (WEB.has(name)) return { ...r, activity: 'reading', detail: 'Browsing' };
  if (EDIT.has(name)) return { ...r, activity: 'working', detail: target ? `Editing ${target}` : 'Editing' };
  if (name === 'Write') return { ...r, activity: 'working', detail: target ? `Writing ${target}` : 'Writing' };
  if (name === 'Bash') return { ...r, activity: build ? 'compiling' : 'working', detail: target ? `Running ${target}` : 'Running a command' };
  if (name === 'Task' || name === 'Agent') return { ...r, activity: 'working', detail: 'Delegating' };
  return { ...r, activity: 'working', detail: name.slice(0, 24) || 'Working' };
}

// Returns the changes one sanitised hook event makes to its session (spec §3 table), or null.
export function classify(evt) {
  switch (evt.hook_event_name) {
    case 'SessionStart': return { activity: 'idle', detail: '', needsYou: false, discrete: 'sessionStart' };
    case 'SessionEnd': return { remove: true };
    case 'UserPromptSubmit': return { activity: 'thinking', detail: 'Thinking…', needsYou: false, discrete: 'prompt' };
    case 'PostToolUse': return { activity: 'thinking', detail: 'Thinking…', needsYou: false };
    case 'Notification': {
      const t = evt.notification_type;
      const detail = t === 'permission_prompt' ? 'Needs permission' : t === 'idle_prompt' ? 'Waiting for you' : 'Needs you';
      return { needsYou: true, detail, discrete: 'needsYou' };
    }
    case 'Stop': return { activity: 'done', detail: 'Your turn', needsYou: false, discrete: 'stop' };
    case 'StopFailure':
      return evt.error === 'rate_limit'
        ? { activity: 'rateLimited', detail: 'Rate limited', needsYou: false, discrete: 'rateLimited' }
        : { activity: 'error', detail: 'Error', needsYou: false, discrete: 'error' };
    case 'PreToolUse': return classifyTool(evt.tool_name || '', evt.target || '', evt.build === true);
    default: return null;
  }
}

export class SessionStore {
  constructor({ contextWindow = {} } = {}) {
    this.sessions = new Map();
    this.contextWindow = contextWindow;
  }

  apply(evt, now, tail = null) {
    const id = evt.session_id;
    if (!id) return null;
    const c = classify(evt);
    if (!c) return null;
    if (c.remove) {
      this.sessions.delete(id);
      return { discrete: null };
    }
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, name: '', model: null, modelLabel: null, effort: null, contextPct: null,
            activity: 'idle', detail: '', needsYou: false, startedAt: now, lastEventAt: now };
      this.sessions.set(id, s);
    }
    if (evt.cwd) s.name = path.posix.basename(evt.cwd.replace(/\\/g, '/').replace(/\/+$/, '')) || s.name;
    const model = evt.model || (tail && tail.model);
    if (model && model !== '<synthetic>') {
      s.model = model;
      s.modelLabel = modelLabel(model);
    }
    const effort = evt.effort || evt.envEffort || (tail && tail.effort);
    if (effort) s.effort = effort;
    if (tail && Number.isFinite(tail.contextTokens)) s.contextPct = contextPct(tail.contextTokens, s.model, this.contextWindow);
    if (c.activity) s.activity = c.activity;
    if ('detail' in c) s.detail = c.detail;
    if (c.needsYou !== undefined) s.needsYou = c.needsYou;
    s.lastEventAt = now;
    return { discrete: c.discrete || null };
  }

  expire(now) {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (now - s.lastEventAt > EXPIRE_MS) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(s => ({ id: s.id, name: s.name, modelLabel: s.modelLabel, effort: s.effort, contextPct: s.contextPct,
                   activity: s.activity, detail: s.detail, needsYou: s.needsYou, lastEventAt: s.lastEventAt }));
  }

  // Spec §3 focus rule: newest needsYou, else newest active, else newest overall.
  focusId() {
    const all = [...this.sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt);
    const pick = all.find(s => s.needsYou) || all.find(s => ACTIVE.has(s.activity)) || all[0];
    return pick ? pick.id : null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/sessions.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessions.mjs test/sessions.test.mjs
git commit -m "feat: session store with activity mapping and focus rule" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Hook sanitiser and forwarder

**Files:**
- Create: `src/hook/sanitize.mjs`, `bin/hook.mjs`
- Test: `test/sanitize.test.mjs`, `test/hook.test.mjs`

**Interfaces:**
- Consumes: `homeDir`, `dataFile`, `readJson`, `appendLog` from Task 1.
- Produces:
  - `BUILD_RE: RegExp`
  - `bashTarget(command): string`
  - `fileTarget(toolInput): string`
  - `sanitize(raw, env?, now?): SanitisedEvent`, where `SanitisedEvent = {hook_event_name, session_id, cwd, transcript_path, receivedAt, model?, effort?, envEffort?, tool_name?, target?, build?, notification_type?, error?, source?, permission_mode?}`
  - `bin/hook.mjs`: reads hook JSON on stdin and POSTs `SanitisedEvent` to `http://127.0.0.1:<config.port>/api/hook` with header `x-dc-token: <config.token>`.
  - Env switches: `DESK_COMPANION_HOME` (data dir root), `DESK_COMPANION_INTERNAL` (exit at once), `DESK_COMPANION_NO_SPAWN` (tests: never start a server).

- [ ] **Step 1: Write the failing sanitiser test** `test/sanitize.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, bashTarget, fileTarget, BUILD_RE } from '../src/hook/sanitize.mjs';

test('keeps only whitelisted fields and never leaks prompts, inputs or outputs', () => {
  const raw = {
    hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\p\\proj', transcript_path: 'C:\\t.jsonl',
    prompt: 'SECRET-PROMPT', message: 'SECRET-MESSAGE', tool_name: 'Edit',
    tool_input: { file_path: 'C:\\p\\proj\\src\\server.mjs', old_string: 'SECRET-OLD', new_string: 'SECRET-NEW' },
    tool_response: { output: 'SECRET-OUTPUT' }, effort: { level: 'high' }, permission_mode: 'default',
  };
  const e = sanitize(raw, { CLAUDE_EFFORT: 'xhigh' }, 123);
  assert.deepEqual(e, {
    hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\p\\proj', transcript_path: 'C:\\t.jsonl',
    receivedAt: 123, effort: 'high', envEffort: 'xhigh', tool_name: 'Edit', permission_mode: 'default', target: 'server.mjs',
  });
  assert.doesNotMatch(JSON.stringify(e), /SECRET/);
});

test('bashTarget keeps up to three safe leading words, max 24 chars', () => {
  assert.equal(bashTarget('npm run build'), 'npm run build');
  assert.equal(bashTarget('  git   status  '), 'git status');
  assert.equal(bashTarget('curl -H "Authorization: Bearer abc"'), 'curl -H');
  assert.equal(bashTarget('export API_KEY=abc123'), 'export');
  assert.equal(bashTarget('echo $SECRET'), 'echo');
  assert.equal(bashTarget('a-very-long-program-name-here --flag'), 'a-very-long-program-name');
  assert.equal(bashTarget(''), '');
});

test('build flag is computed from the full command', () => {
  const b = cmd => sanitize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: cmd } }).build;
  assert.equal(b('npm run build'), true);
  assert.equal(b('npm test'), true);
  assert.equal(b('cargo test --release'), true);
  assert.equal(b('pio run -t upload'), true);
  assert.equal(b('npm install'), false);
  assert.equal(b('git status'), false);
  assert.ok(BUILD_RE.test('pytest -q'));
});

test('fileTarget takes the basename of file_path, notebook_path or path', () => {
  assert.equal(fileTarget({ file_path: 'C:\\x\\y\\server.mjs' }), 'server.mjs');
  assert.equal(fileTarget({ notebook_path: '/a/b/n.ipynb' }), 'n.ipynb');
  assert.equal(fileTarget({ path: '/a/b/' }), 'b');
  assert.equal(fileTarget({ pattern: '**/*.js' }), '');
  assert.equal(fileTarget(undefined), '');
});

test('model, effort and error accept string or object forms', () => {
  const e = sanitize({ hook_event_name: 'StopFailure', session_id: 's', model: { id: 'claude-opus-5' }, effort: 'max', error: { type: 'rate_limit' } });
  assert.equal(e.model, 'claude-opus-5');
  assert.equal(e.effort, 'max');
  assert.equal(e.error, 'rate_limit');
  assert.equal(sanitize({ hook_event_name: 'StopFailure', session_id: 's', error: 'rate_limit' }).error, 'rate_limit');
});

test('garbage input yields empty required fields', () => {
  const e = sanitize(null, {}, 5);
  assert.deepEqual(e, { hook_event_name: '', session_id: '', cwd: '', transcript_path: '', receivedAt: 5 });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/sanitize.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/hook/sanitize.mjs`**

```js
import path from 'node:path';

// Spec §3 build/test pattern. It is tested against the FULL command here; only the boolean leaves the forwarder.
export const BUILD_RE = /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|^(pytest|jest|vitest|tsc|make|mvn|gradle)\b|^(cargo|go|dotnet)\s+(build|test)\b|^pio\s+run\b/;

const SAFE_WORD = /^[\w.\-/]+$/;
const PASS = ['tool_name', 'notification_type', 'source', 'permission_mode'];
const str = v => (typeof v === 'string' ? v : '');

// Up to three leading words, stopping at the first word that could carry a secret (quotes, =, $ …).
export function bashTarget(command) {
  const words = String(command || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words.slice(0, 3)) {
    if (!SAFE_WORD.test(w)) break;
    out.push(w);
  }
  return out.join(' ').slice(0, 24);
}

export function fileTarget(input) {
  const p = input && (input.file_path || input.notebook_path || input.path);
  if (typeof p !== 'string' || !p) return '';
  return path.posix.basename(p.replace(/\\/g, '/')).slice(0, 40);
}

// Whitelist only (spec §1). Prompts, tool inputs and tool outputs never pass.
export function sanitize(raw, env = {}, now = Date.now()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    hook_event_name: str(r.hook_event_name),
    session_id: str(r.session_id),
    cwd: str(r.cwd),
    transcript_path: str(r.transcript_path),
    receivedAt: now,
  };
  const model = typeof r.model === 'string' ? r.model : (r.model && typeof r.model.id === 'string' ? r.model.id : '');
  if (model) out.model = model;
  const effort = r.effort && typeof r.effort === 'object' ? r.effort.level : r.effort;
  if (typeof effort === 'string' && effort) out.effort = effort;
  if (typeof env.CLAUDE_EFFORT === 'string' && env.CLAUDE_EFFORT) out.envEffort = env.CLAUDE_EFFORT;
  for (const k of PASS) if (typeof r[k] === 'string') out[k] = r[k];
  const err = typeof r.error === 'string' ? r.error : (r.error && typeof r.error.type === 'string' ? r.error.type : '');
  if (err) out.error = err;
  if (out.tool_name) {
    const input = r.tool_input && typeof r.tool_input === 'object' ? r.tool_input : {};
    if (out.tool_name === 'Bash') {
      const cmd = String(input.command || '').trim();
      out.target = bashTarget(cmd);
      out.build = BUILD_RE.test(cmd);
    } else {
      out.target = fileTarget(input);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the sanitiser tests**

Run: `node --test test/sanitize.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing forwarder test** `test/hook.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'bin', 'hook.mjs');

function tmpHomeWithConfig(port, token) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-hook-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(path.join(home, '.desk-companion', 'config.json'), JSON.stringify({ port, token, contextWindow: {} }));
  return home;
}

function runHook(input, env) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.on('exit', code => resolve({ code, stdout, ms: Date.now() - t0 }));
    child.stdin.end(JSON.stringify(input));
  });
}

function recorder() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { got.push({ url: req.url, token: req.headers['x-dc-token'], body }); res.writeHead(204).end(); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, got, port: server.address().port })));
}

test('forwards a sanitised event with the token and prints nothing', async () => {
  const { server, got, port } = await recorder();
  const home = tmpHomeWithConfig(port, 'a'.repeat(32));
  const r = await runHook(
    { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/p/x', prompt: 'SECRET-PROMPT' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(got.length, 1);
  assert.equal(got[0].url, '/api/hook');
  assert.equal(got[0].token, 'a'.repeat(32));
  const evt = JSON.parse(got[0].body);
  assert.equal(evt.hook_event_name, 'UserPromptSubmit');
  assert.equal(evt.session_id, 's1');
  assert.doesNotMatch(got[0].body, /SECRET/);
});

test('exits 0 quickly when the server is down', async () => {
  const { server, port } = await recorder();
  server.close();
  const home = tmpHomeWithConfig(port, 'b'.repeat(32));
  const r = await runHook({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('does nothing inside our own get_usage child', async () => {
  const { server, got, port } = await recorder();
  const home = tmpHomeWithConfig(port, 'c'.repeat(32));
  const r = await runHook({ hook_event_name: 'Stop', session_id: 's1' },
    { DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1', DESK_COMPANION_INTERNAL: '1' });
  server.close();
  assert.equal(r.code, 0);
  assert.equal(got.length, 0);
});

test('invalid JSON on stdin still exits 0 silently', async () => {
  const home = tmpHomeWithConfig(1, 'd'.repeat(32));
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_SPAWN: '1' } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stdin.end('{not json');
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0);
  assert.equal(out, '');
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `node --test test/hook.test.mjs`
Expected: FAIL, because `bin/hook.mjs` doesn't exist (non-zero exit / assertion errors).

- [ ] **Step 7: Implement `bin/hook.mjs`**

```js
#!/usr/bin/env node
// Claude Code hook forwarder (spec §1). Never blocks Claude, never prints, always exits 0.
import http from 'node:http';
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

function spawnServer() {
  if (process.env.DESK_COMPANION_NO_SPAWN) return;
  try {
    spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')],
      { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
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
```

- [ ] **Step 8: Run both test files**

Run: `node --test test/sanitize.test.mjs test/hook.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 9: Commit**

```bash
git add src/hook/sanitize.mjs bin/hook.mjs test/sanitize.test.mjs test/hook.test.mjs
git commit -m "feat: hook sanitiser and forwarder" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: HTTP layer: routes, auth, SSE, static files

**Files:**
- Create: `src/server/http.mjs`, `src/server/snapshot.mjs`, `src/server/net.mjs`
- Test: `test/http.test.mjs`, `test/net.test.mjs`

**Interfaces:**
- Consumes: `SessionStore#list()` and `#focusId()` (Task 3), used through `buildSnapshot`.
- Produces:
  - `EMPTY_LIMITS = {status:'unavailable', asOf:null, fiveHour:null, week:null, fable:null}`
  - `buildSnapshot(store, limits, now): Snapshot`, with `Snapshot` as in spec §5
  - `lanAddresses(ifaces?): string[]`
  - `phoneUrls({port, token}, ifaces?, hostname?): string[]`
  - `isLoopback(req): boolean`
  - `tokenMatches(given, token): boolean`
  - `createApp({token, webRoot, getSnapshot, onHook, onDevLimits, getPairInfo, log?, isLoopbackReq?}): {server, broadcast(type, data), clients: Set, close()}`

Route rules (spec §2):
- `POST /api/hook` and `POST /api/dev/limits` need loopback **and** the `x-dc-token` header.
- `/api/health`, `/pair` and `/api/pair-info` are loopback only.
- `/web/*` needs the token (`?k=` or cookie `dc`), or a loopback client. `manifest.webmanifest` and `icon.png` are public.
- `/` and `/events` need the token or loopback. `/` sets the `dc` cookie.

- [ ] **Step 1: Write the failing tests**

`test/net.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddresses, phoneUrls } from '../src/server/net.mjs';

const IFACES = {
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
  'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
};

test('lanAddresses lists non-internal IPv4, 192.168 first', () => {
  assert.deepEqual(lanAddresses(IFACES), ['192.168.1.23', '172.20.0.1']);
});

test('phoneUrls builds token URLs plus a .local hostname URL', () => {
  assert.deepEqual(phoneUrls({ port: 53943, token: 't' }, IFACES, 'DESKTOP-ABC'), [
    'http://192.168.1.23:53943/?k=t',
    'http://172.20.0.1:53943/?k=t',
    'http://desktop-abc.local:53943/?k=t',
  ]);
});
```

`test/http.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, tokenMatches } from '../src/server/http.mjs';
import { buildSnapshot, EMPTY_LIMITS } from '../src/server/snapshot.mjs';

const TOKEN = 'f'.repeat(32);

function webRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>dash</h1>');
  fs.writeFileSync(path.join(dir, 'pair.html'), '<h1>pair</h1>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
  return dir;
}

async function start() {
  let loop = false;
  const hooks = [];
  const devLimits = [];
  const app = createApp({
    token: TOKEN, webRoot: webRoot(),
    getSnapshot: () => ({ v: 1, hello: true }),
    onHook: e => hooks.push(e), onDevLimits: l => devLimits.push(l),
    getPairInfo: () => ({ urls: ['http://x'] }),
    isLoopbackReq: () => loop,
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  return { app, hooks, devLimits, port: app.server.address().port, loopback: v => { loop = v; } };
}

function req(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

function openSse(port, p) {
  return new Promise(resolve => {
    const events = [];
    let buf = '';
    const r = http.get({ host: '127.0.0.1', port, path: p }, res => {
      res.setEncoding('utf8');
      res.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (ev && data) events.push({ type: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve({ events, status: res.statusCode, close: () => r.destroy() });
    });
  });
}

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('timed out');
};

test('tokenMatches is exact', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches('f'.repeat(31), TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});

test('dashboard needs the token from a remote client and sets the cookie', async () => {
  const { app, port } = await start();
  assert.equal((await req(port, 'GET', '/')).status, 403);
  const ok = await req(port, 'GET', `/?k=${TOKEN}`);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /dash/);
  assert.match(ok.headers['set-cookie'][0], new RegExp(`^dc=${TOKEN}; HttpOnly`));
  assert.equal((await req(port, 'GET', '/', { cookie: `dc=${TOKEN}` })).status, 200);
  app.close();
});

test('static files: token or loopback required, manifest public, no traversal', async () => {
  const { app, port, loopback } = await start();
  assert.equal((await req(port, 'GET', '/web/style.css')).status, 403);
  assert.equal((await req(port, 'GET', '/web/style.css', { cookie: `dc=${TOKEN}` })).status, 200);
  assert.equal((await req(port, 'GET', '/web/manifest.webmanifest')).status, 200);
  assert.equal((await req(port, 'GET', `/web/..%2f..%2fpackage.json?k=${TOKEN}`)).status, 403);
  assert.equal((await req(port, 'GET', `/web/missing.css?k=${TOKEN}`)).status, 404);
  loopback(true);
  const css = await req(port, 'GET', '/web/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  app.close();
});

test('hook ingest needs loopback AND the token header', async () => {
  const { app, port, hooks, loopback } = await start();
  const body = JSON.stringify({ hook_event_name: 'Stop', session_id: 's' });
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, body)).status, 403);
  loopback(true);
  assert.equal((await req(port, 'POST', '/api/hook', {}, body)).status, 403);
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, body)).status, 204);
  assert.deepEqual(hooks, [{ hook_event_name: 'Stop', session_id: 's' }]);
  assert.equal((await req(port, 'POST', '/api/hook', { 'x-dc-token': TOKEN }, '{bad')).status, 400);
  app.close();
});

test('dev limits endpoint has the same protection', async () => {
  const { app, port, devLimits, loopback } = await start();
  loopback(true);
  const body = JSON.stringify({ fiveHour: { pct: 55, resetsAt: 1 } });
  assert.equal((await req(port, 'POST', '/api/dev/limits', { 'x-dc-token': TOKEN }, body)).status, 204);
  assert.deepEqual(devLimits, [{ fiveHour: { pct: 55, resetsAt: 1 } }]);
  app.close();
});

test('health, pair and pair-info are loopback only', async () => {
  const { app, port, loopback } = await start();
  for (const p of ['/api/health', '/pair', '/api/pair-info']) assert.equal((await req(port, 'GET', p)).status, 403, p);
  loopback(true);
  assert.equal(JSON.parse((await req(port, 'GET', '/api/health')).body).ok, true);
  assert.match((await req(port, 'GET', '/pair')).body, /pair/);
  assert.deepEqual(JSON.parse((await req(port, 'GET', '/api/pair-info')).body), { urls: ['http://x'], pages: 0 });
  app.close();
});

test('SSE sends a snapshot on connect, then broadcasts', async () => {
  const { app, port } = await start();
  const s = await openSse(port, `/events?k=${TOKEN}`);
  assert.equal(s.status, 200);
  await until(() => s.events.length >= 1);
  assert.deepEqual(s.events[0], { type: 'snapshot', data: { v: 1, hello: true } });
  await until(() => app.clients.size === 1);
  app.broadcast('event', { type: 'stop', sessionId: 's' });
  await until(() => s.events.length >= 2);
  assert.deepEqual(s.events[1], { type: 'event', data: { type: 'stop', sessionId: 's' } });
  s.close();
  await until(() => app.clients.size === 0);
  app.close();
});

test('buildSnapshot shape', () => {
  const store = { list: () => [{ id: 'a' }], focusId: () => 'a' };
  assert.deepEqual(buildSnapshot(store, null, 42),
    { v: 1, serverTime: 42, sessions: [{ id: 'a' }], focusId: 'a', limits: EMPTY_LIMITS });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/net.test.mjs test/http.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/server/net.mjs`**

```js
import os from 'node:os';

const rank = ip => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);

// Non-internal IPv4 addresses, home-network ranges first (192.168, then 10, then 172.16-31).
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

export function phoneUrls({ port, token }, ifaces, hostname = os.hostname()) {
  const urls = lanAddresses(ifaces).map(ip => `http://${ip}:${port}/?k=${token}`);
  if (hostname) urls.push(`http://${hostname.toLowerCase()}.local:${port}/?k=${token}`);
  return urls;
}
```

- [ ] **Step 4: Implement `src/server/snapshot.mjs`**

```js
export const EMPTY_LIMITS = Object.freeze({ status: 'unavailable', asOf: null, fiveHour: null, week: null, fable: null });

// Spec §5.
export function buildSnapshot(store, limits, now) {
  return { v: 1, serverTime: now, sessions: store.list(), focusId: store.focusId(), limits: limits || EMPTY_LIMITS };
}
```

- [ ] **Step 5: Implement `src/server/http.mjs`**

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = new Set(['manifest.webmanifest', 'icon.png']); // browsers fetch manifests without cookies
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(req) {
  return LOOPBACK.has(req.socket.remoteAddress);
}

export function tokenMatches(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string' || given.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp({ token, webRoot, getSnapshot, onHook, onDevLimits, getPairInfo, log = () => {}, isLoopbackReq = isLoopback }) {
  const root = path.resolve(webRoot);
  const clients = new Set();
  const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type, data) => { for (const res of clients) send(res, type, data); };
  const ping = setInterval(() => broadcast('ping', {}), 20000);
  ping.unref();

  const deny = (res, code = 403) =>
    res.writeHead(code, { 'content-type': 'text/plain' }).end(code === 404 ? 'Not found' : code === 400 ? 'Bad request' : 'Forbidden');
  const json = (res, obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
  const serveFile = (res, abs, extra = {}) => fs.readFile(abs, (err, buf) => {
    if (err) return deny(res, 404);
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache', ...extra }).end(buf);
  });

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return deny(res, 400); }
    const p = url.pathname;
    const loop = isLoopbackReq(req);
    const authed = loop || tokenMatches(url.searchParams.get('k'), token) || tokenMatches(cookies(req).dc, token);
    try {
      if (req.method === 'POST' && (p === '/api/hook' || p === '/api/dev/limits')) {
        if (!loop || !tokenMatches(req.headers['x-dc-token'], token)) return deny(res);
        const body = JSON.parse(await readBody(req, 65536));
        if (p === '/api/hook') onHook(body); else onDevLimits(body);
        return res.writeHead(204).end();
      }
      if (req.method !== 'GET') return deny(res, 405);
      if (p === '/api/health') return loop ? json(res, { ok: true, pid: process.pid }) : deny(res);
      if (p === '/pair') return loop ? serveFile(res, path.join(root, 'pair.html')) : deny(res);
      if (p === '/api/pair-info') return loop ? json(res, { ...getPairInfo(), pages: clients.size }) : deny(res);
      if (p.startsWith('/web/')) {
        const rel = decodeURIComponent(p.slice(5));
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep)) return deny(res);
        if (!authed && !PUBLIC.has(rel)) return deny(res);
        return serveFile(res, abs);
      }
      if (!authed) return deny(res);
      if (p === '/') {
        return serveFile(res, path.join(root, 'index.html'),
          { 'set-cookie': `dc=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
      }
      if (p === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        send(res, 'snapshot', getSnapshot());
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      return deny(res, 404);
    } catch (e) {
      log(`http ${p}: ${e.message}`);
      if (!res.headersSent) deny(res, 400);
    }
  });

  return {
    server, broadcast, clients,
    close() {
      clearInterval(ping);
      for (const r of clients) r.end();
      server.close();
    },
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/net.test.mjs test/http.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/http.mjs src/server/snapshot.mjs src/server/net.mjs test/http.test.mjs test/net.test.mjs
git commit -m "feat: HTTP layer with token auth, SSE and static files" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Server process

**Files:**
- Create: `bin/server.mjs`
- Test: `test/server.test.mjs`

**Interfaces:**
- Consumes:
  - `loadOrCreateConfig`, `dataFile`, `readJson`, `appendLog`, `homeDir` (Task 1)
  - `readTail` (Task 2)
  - `SessionStore` (Task 3)
  - `createApp`, `buildSnapshot`, `EMPTY_LIMITS`, `phoneUrls` (Task 5)
- Produces:
  - `node bin/server.mjs` starts the server. It writes `~/.desk-companion/server.json` = `{pid, port, startedAt}` and exits 0 at once if another instance answers `/api/health`.
  - `node bin/server.mjs --stop` kills the pid in `server.json` and removes the file.
  - Env `DESK_COMPANION_NO_LIMITS=1` disables the limits poller (Task 9) for tests.
  - The marker comment `// LIMITS-POLLER` is where Task 9 plugs in.

- [ ] **Step 1: Write the failing end-to-end test** `test/server.test.mjs`:

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'bin', 'server.mjs');
const TOKEN = '1'.repeat(32);
let home;
let port;
let env;

async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

function req(method, p, headers = {}, body) {
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    r.end(body);
  });
}

function openSse(p) {
  return new Promise(resolve => {
    const events = [];
    let buf = '';
    const r = http.get({ host: '127.0.0.1', port, path: p }, res => {
      res.setEncoding('utf8');
      res.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (ev && data) events.push({ type: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve({ events, close: () => r.destroy() });
    });
  });
}

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timed out');
}

const run = args => new Promise(resolve => {
  const c = spawn(process.execPath, [SERVER, ...args], { env, stdio: 'ignore' });
  c.on('exit', code => resolve(code));
});

const hook = evt => req('POST', '/api/hook', { 'x-dc-token': TOKEN, 'content-type': 'application/json' }, JSON.stringify(evt));

before(async () => {
  port = await freePort();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-srv-'));
  fs.mkdirSync(path.join(home, '.desk-companion'));
  fs.writeFileSync(path.join(home, '.desk-companion', 'config.json'), JSON.stringify({ port, token: TOKEN, contextWindow: {} }));
  env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: '1' };
  spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  await until(async () => (await req('GET', '/api/health')).status === 200, 8000);
});

test('writes server.json with its pid and port', async () => {
  await until(() => fs.existsSync(path.join(home, '.desk-companion', 'server.json')));
  const st = JSON.parse(fs.readFileSync(path.join(home, '.desk-companion', 'server.json'), 'utf8'));
  assert.equal(st.port, port);
  assert.equal(typeof st.pid, 'number');
});

test('hook events become snapshots and discrete events', async () => {
  const s = await openSse(`/events?k=${TOKEN}`);
  await until(() => s.events.some(e => e.type === 'snapshot'));
  assert.equal((await hook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/x/proj', model: 'claude-opus-5' })).status, 204);
  assert.equal((await hook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/x/proj' })).status, 204);
  await until(() => s.events.some(e => e.type === 'event' && e.data.type === 'prompt'));
  const last = s.events.filter(e => e.type === 'snapshot').at(-1).data;
  assert.equal(last.v, 1);
  assert.equal(last.focusId, 's1');
  assert.equal(last.sessions[0].name, 'proj');
  assert.equal(last.sessions[0].modelLabel, 'Opus 5');
  assert.equal(last.sessions[0].activity, 'thinking');
  assert.equal(last.limits.status, 'unavailable');
  assert.ok(s.events.some(e => e.type === 'event' && e.data.type === 'sessionStart'));
  s.close();
});

test('dev limits endpoint updates the snapshot', async () => {
  const s = await openSse(`/events?k=${TOKEN}`);
  await req('POST', '/api/dev/limits', { 'x-dc-token': TOKEN }, JSON.stringify({ fiveHour: { pct: 55, resetsAt: Date.now() + 3600e3 } }));
  await until(() => s.events.some(e => e.type === 'snapshot' && e.data.limits.status === 'ok'));
  const snap = s.events.filter(e => e.type === 'snapshot').at(-1).data;
  assert.equal(snap.limits.fiveHour.pct, 55);
  s.close();
});

test('a second instance exits 0 at once', async () => {
  const t0 = Date.now();
  assert.equal(await run([]), 0);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal((await req('GET', '/api/health')).status, 200);
});

test('--stop ends the server and removes server.json', async () => {
  assert.equal(await run(['--stop']), 0);
  await until(async () => (await req('GET', '/api/health')).status === 0);
  assert.equal(fs.existsSync(path.join(home, '.desk-companion', 'server.json')), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/server.test.mjs`
Expected: FAIL; `before` times out because `bin/server.mjs` doesn't exist.

- [ ] **Step 3: Implement `bin/server.mjs`**

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/server.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: PASS, all tests from Tasks 1–6.

- [ ] **Step 6: Commit**

```bash
git add bin/server.mjs test/server.test.mjs
git commit -m "feat: background server process with single-instance guard and --stop" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard page v0 (rings, sessions, bubble, offline)

**Files:**
- Create: `src/web/index.html`, `src/web/style.css`, `src/web/format.js`, `src/web/app.js`
- Test: `test/format.test.mjs`

**Interfaces:**
- Consumes: the SSE stream from Task 5/6. `snapshot` carries a `Snapshot` (§5); `event` carries `{type, sessionId}`; `ping` is a keep-alive.
- Produces (`format.js`, pure, importable from Node):
  - `RINGS`, `STALE_MS`
  - `formatReset(resetsAt, now): string`
  - `limitsView(limits, now, skewMs): {rings: RingView[], note: string}`, where `RingView = {key, label, color, pct, text, reset, hot, stale}`
  - `sessionMeta(session): string`
  - `dotClass(session): 'need'|'work'|'bad'|'idle'`
  - `visibleSessions(list, focusId, max): {shown, more}`
- Produces (`app.js`, browser only; later tasks extend it):
  - module-level `snap`, `skew`
  - `setBubble(text, tone)`
  - `onEvent(ev)`, a stub filled in by Task 15
  - the element ids `app`, `mascot`, `bubble`, `rings`, `limitsNote`, `sessions`, `btnClose`, `btnRotate`, `btnSettings`, `offline`

Layout (spec §6): `#app` is a CSS size container, and every size uses `cqmin`, so the same CSS works in landscape and portrait. Classes on `#app`: `landscape` or `portrait` (Task 16 switches them) and `dim` (Task 15).

- [ ] **Step 1: Write the failing test** `test/format.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReset, limitsView, sessionMeta, dotClass, visibleSessions, STALE_MS } from '../src/web/format.js';

const MIN = 60000;

test('formatReset: minutes, hours, weekday+time, now', () => {
  assert.equal(formatReset(108 * MIN, 0), '1h 48m');
  assert.equal(formatReset(45 * MIN, 0), '45m');
  assert.equal(formatReset(30000, 0), '1m');
  assert.equal(formatReset(-1, 0), 'now');
  assert.equal(formatReset(null, 0), '');
  assert.match(formatReset(Date.UTC(2026, 8, 17, 7, 0), Date.UTC(2026, 8, 14, 7, 0)), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('limitsView: ok limits give three rings, red at 80+', () => {
  const now = 1_000_000;
  const v = limitsView({ status: 'ok', asOf: now, fiveHour: { pct: 83, resetsAt: now + 65 * MIN }, week: { pct: 34, resetsAt: null }, fable: null }, now, 0);
  assert.deepEqual(v.rings.map(r => [r.key, r.text, r.hot, r.reset]), [
    ['fiveHour', '83%', true, '1h 05m'], ['week', '34%', false, ''], ['fable', '—', false, ''],
  ]);
  assert.equal(v.note, '');
  assert.equal(v.rings[0].color, '#f5a524');
});

test('limitsView: stale after 15 min by server clock, signin and unavailable notes', () => {
  const asOf = 1_000_000;
  const stale = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10, resetsAt: null } }, asOf + STALE_MS + 1, 0);
  assert.equal(stale.rings[0].stale, true);
  assert.match(stale.note, /^as of \d{2}:\d{2}$/);
  const skewed = limitsView({ status: 'ok', asOf, fiveHour: { pct: 10 } }, asOf, STALE_MS + 1);
  assert.equal(skewed.rings[0].stale, true);
  assert.match(limitsView({ status: 'signin' }, 0, 0).note, /claude auth login/);
  assert.equal(limitsView(null, 0, 0).note, 'Limits unavailable');
  assert.equal(limitsView(null, 0, 0).rings[0].text, '—');
});

test('sessionMeta and dotClass', () => {
  assert.equal(sessionMeta({ modelLabel: 'Opus 5', effort: 'high', detail: 'Editing a.js' }), 'Opus 5 · high · Editing a.js');
  assert.equal(sessionMeta({ modelLabel: null, effort: null, detail: '' }), '— · —');
  assert.equal(dotClass({ needsYou: true, activity: 'working' }), 'need');
  assert.equal(dotClass({ needsYou: false, activity: 'compiling' }), 'work');
  assert.equal(dotClass({ needsYou: false, activity: 'rateLimited' }), 'bad');
  assert.equal(dotClass({ needsYou: false, activity: 'done' }), 'idle');
});

test('visibleSessions keeps the focus session visible', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id }));
  assert.deepEqual(visibleSessions(list, 'b', 5).shown.map(s => s.id), ['a', 'b', 'c', 'd', 'e']);
  const r = visibleSessions(list, 'g', 5);
  assert.deepEqual(r.shown.map(s => s.id), ['a', 'b', 'c', 'd', 'g']);
  assert.equal(r.more, 2);
  assert.deepEqual(visibleSessions([], null, 5), { shown: [], more: 0 });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/format.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/web/format.js`**

```js
export const RINGS = [
  { key: 'fiveHour', label: '5-hour', color: '#f5a524' },
  { key: 'week', label: 'Week', color: '#35c2b0' },
  { key: 'fable', label: 'Fable', color: '#a78bfa' },
];
export const STALE_MS = 15 * 60 * 1000;

const ACTIVE = ['thinking', 'reading', 'working', 'compiling'];
const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatReset(resetsAt, now) {
  if (!Number.isFinite(resetsAt)) return '';
  const ms = resetsAt - now;
  if (ms <= 0) return 'now';
  if (ms < 24 * 3600e3) {
    const mins = Math.ceil(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }
  return `${new Date(resetsAt).toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(resetsAt)}`;
}

// skewMs = serverTime - phone clock, so countdowns and staleness use the PC's clock.
export function limitsView(limits, now, skewMs = 0) {
  const L = limits || { status: 'unavailable' };
  const t = now + skewMs;
  const stale = L.status === 'stale' || (L.status === 'ok' && Number.isFinite(L.asOf) && t - L.asOf > STALE_MS);
  const rings = RINGS.map(r => {
    const w = L[r.key];
    const pct = w && Number.isFinite(w.pct) ? w.pct : null;
    return { ...r, pct, text: pct === null ? '—' : `${pct}%`, reset: w ? formatReset(w.resetsAt, t) : '', hot: pct !== null && pct >= 80, stale };
  });
  let note = '';
  if (L.status === 'signin') note = 'Run "claude auth login" on the PC to show limits';
  else if (L.status === 'unavailable') note = 'Limits unavailable';
  else if (stale && Number.isFinite(L.asOf)) note = `as of ${hhmm(L.asOf)}`;
  return { rings, note };
}

export function sessionMeta(s) {
  return [s.modelLabel || '—', s.effort || '—', s.detail].filter(Boolean).join(' · ');
}

export function dotClass(s) {
  if (s.needsYou) return 'need';
  if (ACTIVE.includes(s.activity)) return 'work';
  if (s.activity === 'error' || s.activity === 'rateLimited') return 'bad';
  return 'idle';
}

export function visibleSessions(list, focusId, max = 5) {
  if (list.length <= max) return { shown: list.slice(), more: 0 };
  let shown = list.slice(0, max);
  const focus = list.find(s => s.id === focusId);
  if (focus && !shown.includes(focus)) shown = shown.slice(0, max - 1).concat(focus);
  return { shown, more: list.length - max };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/format.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Create `src/web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0a0a0f">
  <title>desk-companion</title>
  <link rel="stylesheet" href="/web/style.css">
</head>
<body>
  <main id="app" class="landscape">
    <section class="stage">
      <div id="bubble" class="bubble"></div>
      <canvas id="mascot" width="256" height="256"></canvas>
    </section>
    <section class="data">
      <div id="rings" class="rings"></div>
      <div id="limitsNote" class="note"></div>
      <div id="sessions" class="sessions"></div>
    </section>
    <nav class="controls">
      <button id="btnClose" aria-label="Close">✕</button>
      <button id="btnRotate" aria-label="Rotate">⟲</button>
      <button id="btnSettings" aria-label="Settings">⚙</button>
    </nav>
  </main>
  <div id="offline" class="overlay" hidden><p>PC offline — waiting…</p></div>
  <script type="module" src="/web/app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `src/web/style.css`**

```css
:root {
  color-scheme: dark;
  --bg: #0a0a0f; --text: #e8e6e3; --dim: #8a8a93; --line: #1c1c24; --track: #23232c;
  --work: #5aa9ff; --need: #ffb020; --bad: #ff6b5b; --good: #a6e6a0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  height: 100%; background: #000; color: var(--text); overflow: hidden;
  font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
#app {
  position: fixed; left: 50%; top: 50%;
  width: var(--w, 100vw); height: var(--h, 100vh);
  transform: translate(calc(-50% + var(--dx, 0px)), calc(-50% + var(--dy, 0px))) rotate(var(--rot, 0deg));
  background: var(--bg); container-type: size; display: grid; overflow: hidden;
  transition: filter 2s ease;
}
#app.dim { filter: brightness(.32) saturate(.8); }
#app.landscape { grid-template-columns: 40% 60%; }
#app.portrait { grid-template-rows: 42% minmax(0, 1fr); }

.stage {
  position: relative; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2cqmin;
  background: radial-gradient(circle at 50% 62%, #1a1622 0%, var(--bg) 70%);
}
#mascot { aspect-ratio: 1; mix-blend-mode: lighten; cursor: pointer; }
#app.landscape #mascot { width: min(25.6cqw, 62cqh); }
#app.portrait #mascot { width: min(52cqw, 28cqh); }

.bubble {
  max-width: 90%; background: #1b1b24; border: 1px solid #2c2c38; border-radius: 2.4cqmin;
  padding: 1.4cqmin 2.6cqmin; font-size: 3.6cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  visibility: hidden; transition: border-color .3s, color .3s;
}
.bubble.show { visibility: visible; }
.bubble.need { border-color: var(--need); color: #ffcf70; }
.bubble.good { border-color: #3f8a3f; color: var(--good); }
.bubble.bad { border-color: #b23a3a; color: #ff9d8c; }

.data { min-width: 0; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: 3cqmin; padding: 6cqmin 5cqmin 4cqmin 2cqmin; }
#app.portrait .data { justify-content: flex-start; padding: 3cqmin 5cqmin 5cqmin; }
.rings { display: flex; gap: 4cqmin; }
#app.portrait .rings { justify-content: center; }
.ring { position: relative; width: 20cqmin; text-align: center; transition: opacity .4s; }
.ring.stale { opacity: .45; }
.ring svg { width: 100%; display: block; }
.ring .track { fill: none; stroke: var(--track); stroke-width: 4; }
.ring .val { fill: none; stroke-width: 4; stroke-linecap: round; transition: stroke-dasharray .9s ease; }
.ring .num { position: absolute; left: 0; right: 0; top: 0; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 5.2cqmin; font-weight: 700; }
.ring .num.hot { color: var(--bad); }
.ring .lbl { font-size: 2.7cqmin; color: var(--dim); margin-top: 1cqmin; white-space: nowrap; }
.note { font-size: 2.7cqmin; color: var(--dim); min-height: 3cqmin; }

.sessions { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.row { display: grid; grid-template-columns: 2.4cqmin minmax(0, 1fr) 18cqmin; gap: 2cqmin; align-items: center; padding: 1.6cqmin 1cqmin; border-top: 1px solid var(--line); border-radius: 1.2cqmin; }
.row.focus { background: #14141c; }
.name { font-size: 3.6cqmin; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { font-size: 2.8cqmin; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta.need { color: var(--need); }
.dot { width: 2.2cqmin; height: 2.2cqmin; border-radius: 50%; background: #4a4a55; }
.dot.work { background: var(--work); box-shadow: 0 0 1.6cqmin var(--work); }
.dot.need { background: var(--need); box-shadow: 0 0 2cqmin var(--need); animation: pulse 1.2s ease-in-out infinite; }
.dot.bad { background: var(--bad); }
@keyframes pulse { 50% { opacity: .35; } }
.ctx { height: 1.5cqmin; background: var(--track); border-radius: 1cqmin; overflow: hidden; }
.ctx i { display: block; height: 100%; background: #9d9daa; transition: width .6s; }
.ctxl { font-size: 2.5cqmin; color: var(--dim); text-align: right; margin-top: .6cqmin; }
.more { font-size: 2.7cqmin; color: var(--dim); padding: 1.4cqmin 1cqmin; }

.controls { position: absolute; top: 3cqmin; right: 4cqmin; display: flex; gap: 3cqmin; z-index: 5; }
.controls button { background: none; border: 0; color: var(--text); opacity: .45; font-size: 4.4cqmin; cursor: pointer; padding: 1cqmin; }

.overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .82); color: var(--dim); font-size: 18px; }
.overlay[hidden] { display: none; }
```

- [ ] **Step 7: Create `src/web/app.js`**

```js
import { limitsView, sessionMeta, dotClass, visibleSessions } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let snap = null;   // latest Snapshot (spec §5)
let skew = 0;      // serverTime - Date.now(), so countdowns use the PC's clock
let lastMsgAt = Date.now();
let downSince = null;

// ---------- rings ----------
function renderRings() {
  const { rings, note } = limitsView(snap && snap.limits, Date.now(), skew);
  const box = $('rings');
  if (!box.children.length) {
    box.innerHTML = rings.map(r => `<div class="ring" data-k="${r.key}"><svg viewBox="0 0 40 40">
      <circle class="track" cx="20" cy="20" r="16"/>
      <circle class="val" cx="20" cy="20" r="16" pathLength="100" transform="rotate(-90 20 20)" style="stroke:${r.color};stroke-dasharray:0 100"/>
      </svg><div class="num"></div><div class="lbl"></div></div>`).join('');
  }
  for (const r of rings) {
    const el = box.querySelector(`[data-k="${r.key}"]`);
    el.classList.toggle('stale', r.stale);
    el.querySelector('.val').style.strokeDasharray = `${r.pct === null ? 0 : Math.min(r.pct, 100)} 100`;
    const num = el.querySelector('.num');
    num.textContent = r.text;
    num.classList.toggle('hot', r.hot);
    el.querySelector('.lbl').textContent = r.label + (r.reset ? ' · ' + r.reset : '');
  }
  $('limitsNote').textContent = note;
}

// ---------- sessions ----------
function renderSessions() {
  const list = snap ? snap.sessions : [];
  const focusId = snap ? snap.focusId : null;
  const { shown, more } = visibleSessions(list, focusId, 5);
  $('sessions').innerHTML = shown.map(s => `
    <div class="row${s.id === focusId ? ' focus' : ''}">
      <span class="dot ${dotClass(s)}"></span>
      <div><div class="name">${esc(s.name || 'session')}</div><div class="meta${s.needsYou ? ' need' : ''}">${esc(sessionMeta(s))}</div></div>
      <div><div class="ctx"><i style="width:${s.contextPct ?? 0}%"></i></div><div class="ctxl">${s.contextPct == null ? 'ctx —' : `ctx ${s.contextPct}%`}</div></div>
    </div>`).join('')
    + (more ? `<div class="more">+${more} more</div>` : '')
    + (list.length ? '' : '<div class="more">No Claude Code sessions yet</div>');
}

// ---------- bubble ----------
function setBubble(text, tone) {
  const b = $('bubble');
  b.textContent = text || '';
  b.className = 'bubble' + (text ? ' show' : '') + (tone ? ' ' + tone : '');
}

// v0: the bubble shows the focus session's detail. Task 15 hands it to the companion.
function renderBubble() {
  const f = snap && snap.sessions.find(s => s.id === snap.focusId);
  setBubble(f && f.detail, f && f.needsYou ? 'need' : '');
}

function render() {
  renderRings();
  renderSessions();
  renderBubble();
}

function onEvent(ev) { /* Task 15: companion reactions */ }

// ---------- connection ----------
function seen() {
  lastMsgAt = Date.now();
  downSince = null;
  $('offline').hidden = true;
}

function connect() {
  const es = new EventSource('/events' + location.search);
  es.addEventListener('snapshot', e => { snap = JSON.parse(e.data); skew = snap.serverTime - Date.now(); seen(); render(); });
  es.addEventListener('event', e => { seen(); onEvent(JSON.parse(e.data)); });
  es.addEventListener('ping', seen);
  es.onerror = () => {
    if (downSince === null) downSince = Date.now();
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000); // e.g. a 403 after a restart
  };
}

setInterval(() => {
  const now = Date.now();
  $('offline').hidden = !((downSince !== null && now - downSince > 5000) || now - lastMsgAt > 45000);
}, 1000);
setInterval(renderRings, 30000);

render();
connect();
```

- [ ] **Step 8: Check it in a browser**

1. Start the server: `node bin/server.mjs`. Read the port with `node -e "console.log(JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.desk-companion/config.json')).port)"`.
2. Open `http://localhost:<port>/` in a desktop browser. Loopback needs no token.
3. Expected: dark page; three rings showing "—" and "Limits unavailable"; "No Claude Code sessions yet"; ✕ ⟲ ⚙ at top right; no console errors.
4. Stop the server with `node bin/server.mjs --stop`. Within about 5 s the page shows "PC offline — waiting…".
5. Start it again. The overlay disappears within about 3 s.

- [ ] **Step 9: Commit**

```bash
git add src/web/index.html src/web/style.css src/web/format.js src/web/app.js test/format.test.mjs
git commit -m "feat: dashboard page v0 with rings, sessions and offline overlay" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Hooks registration, fake-event driver, phone URL, first on-phone milestone

**Files:**
- Create: `hooks/hooks.json`, `tools/fake-events.mjs`, `bin/pair.mjs`
- Test: `test/manifest.test.mjs`

**Interfaces:**
- Consumes:
  - `bin/hook.mjs` (Task 4)
  - `/api/hook` and `/api/dev/limits` (Task 5)
  - `loadOrCreateConfig`, `readJson`, `dataFile`, `homeDir` (Task 1)
  - `phoneUrls` (Task 5)
- Produces:
  - `node tools/fake-events.mjs <turn|limits|idle|wake|end>` replays demo scenarios into the running server.
  - `node bin/pair.mjs` ensures the server runs and prints the phone URLs. The marker comment `// PAIR-PAGE` is where Task 10 adds opening the QR page.

- [ ] **Step 1: Write the failing manifest test** `test/manifest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'StopFailure'];
const CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs"';

test('hooks.json registers the forwarder for exactly the 8 events', () => {
  const { hooks } = read('hooks/hooks.json');
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort());
  for (const e of EVENTS) {
    assert.equal(hooks[e].length, 1, e);
    const entry = hooks[e][0];
    if (e === 'PreToolUse' || e === 'PostToolUse') assert.equal(entry.matcher, '*', e);
    assert.deepEqual(entry.hooks, [{ type: 'command', command: CMD, timeout: 5 }], e);
  }
});

test('plugin and marketplace manifests agree on the name', () => {
  assert.equal(read('.claude-plugin/plugin.json').name, 'desk-companion');
  const m = read('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'desk-companion');
  assert.equal(m.plugins[0].name, 'desk-companion');
  assert.equal(m.plugins[0].source, './');
  assert.equal(read('package.json').version, read('.claude-plugin/plugin.json').version);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/manifest.test.mjs`
Expected: FAIL, `hooks/hooks.json` missing.

- [ ] **Step 3: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }],
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs\"", "timeout": 5 }] }]
  }
}
```

- [ ] **Step 4: Run the manifest test**

Run: `node --test test/manifest.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Create `tools/fake-events.mjs`**

```js
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
    console.log('Now leave it: the companion falls asleep after the "sleep after" setting (default 5 min).');
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
```

- [ ] **Step 6: Create `bin/pair.mjs`** (first version; Task 10 extends it)

```js
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
```

- [ ] **Step 7: Smoke-test locally**

1. `node bin/server.mjs --stop`, then `node bin/pair.mjs`. Expected: "desk-companion is running." plus a `http://192.168.x.x:<port>/?k=<32 hex>` URL. Windows may show a Firewall prompt: allow **Private networks**.
2. Open `http://localhost:<port>/` on the PC and run `node tools/fake-events.mjs turn`. Expected: two sessions appear (`clauled` "Your turn", `my_claude_companion`). The focus row's dot goes blue while working and amber while "Needs permission", and the bubble follows the focus detail.
3. `node tools/fake-events.mjs end` removes both sessions.

- [ ] **Step 8: Commit**

```bash
git add hooks/hooks.json tools/fake-events.mjs bin/pair.mjs test/manifest.test.mjs
git commit -m "feat: hook registration, fake-event driver and phone URL printer" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: MILESTONE 1: install the plugin and check on the phone (user step)**

Installing changes the user's Claude Code configuration, so **ask the user to confirm before running these**, or hand them the commands:

```bash
claude plugin marketplace add C:/Users/weazo/GitHub/my_claude_companion
claude plugin install desk-companion@desk-companion
```

Then:
1. Restart Claude Code sessions. Hooks load at session start, in the terminal and in the desktop app's Code tab.
2. Run `node bin/pair.mjs` and open the printed URL on the phone.
3. Use Claude Code normally. The phone shows each session's name, model, effort, context and activity live.
4. **Check spec risk 3:** start a session in the desktop app's Code tab. If it doesn't appear, check `claude plugin list` and `~/.desk-companion/hook.log`, and write down what the desktop app needs.

**Development loop from here on.** The installed plugin runs from Claude Code's plugin cache. Its hooks only read the port and token from `~/.desk-companion/config.json`, so they feed whichever server is running.
- **Server or page changes:** run `node bin/server.mjs --stop && node bin/pair.mjs` from the repo, which restarts the server detached from this folder, then reload the phone.
- **Changes to `bin/hook.mjs`, `src/hook/*` or `hooks/hooks.json`:** bump `version` in `package.json` **and** `.claude-plugin/plugin.json`, then run `claude plugin marketplace update desk-companion && claude plugin update desk-companion@desk-companion` and restart the Claude Code sessions.

---

### Task 9: Plan limits via `get_usage`

**Files:**
- Create: `src/server/limits.mjs`
- Modify: `bin/server.mjs` (replace the `// LIMITS-POLLER` line and add one import)
- Test: `test/limits.test.mjs`

**Interfaces:**
- Consumes: Task 0's findings (exact protocol). In `bin/server.mjs` it uses `limits`, `onStop`, `app`, `snapshot` and `log`.
- Produces:
  - `CLAUDE_ARGS`
  - `normPct(u): number | null`
  - `parseUsage(resp, now): Limits`
  - `fetchUsage({spawnImpl?, command?, timeoutMs?, now?}): Promise<Limits & {reason?}>`
  - `createLimitsPoller({fetch?, onUpdate, now?, setTimer?, clearTimer?, log?}): {start(), onStop(), view(), stop()}`
  - `Limits = {status: 'ok'|'stale'|'signin'|'unavailable', asOf, fiveHour, week, fable}`, where each window is `{pct, resetsAt}` or `null`

- [ ] **Step 1: Write the failing test** `test/limits.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { normPct, parseUsage, fetchUsage, createLimitsPoller, CLAUDE_ARGS } from '../src/server/limits.mjs';

const OK = {
  subscription_type: 'max', rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 62, resets_at: '2026-09-14T12:00:00Z' },
    seven_day: { utilization: 34.4, resets_at: '2026-09-17T07:00:00Z' },
    model_scoped: [{ display_name: 'Opus', utilization: 5, resets_at: null }, { display_name: 'Fable', utilization: 71, resets_at: '2026-09-17T07:00:00Z' }],
  },
};

test('normPct', () => {
  assert.equal(normPct(62), 62);
  assert.equal(normPct(0.62), 62);
  assert.equal(normPct(0), 0);
  assert.equal(normPct(1), 1);
  assert.equal(normPct(104.4), 104);
  assert.equal(normPct(null), null);
});

test('parseUsage: ok, signin, unavailable', () => {
  assert.deepEqual(parseUsage(OK, 5), {
    status: 'ok', asOf: 5,
    fiveHour: { pct: 62, resetsAt: Date.parse('2026-09-14T12:00:00Z') },
    week: { pct: 34, resetsAt: Date.parse('2026-09-17T07:00:00Z') },
    fable: { pct: 71, resetsAt: Date.parse('2026-09-17T07:00:00Z') },
  });
  assert.equal(parseUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, 5).status, 'signin');
  assert.equal(parseUsage({ subscription_type: 'max', rate_limits_available: false, rate_limits: null }, 5).status, 'unavailable');
  assert.equal(parseUsage(null, 5).status, 'unavailable');
  const partial = parseUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null } } }, 5);
  assert.deepEqual([partial.status, partial.fiveHour, partial.week, partial.fable], ['ok', null, null, null]);
});

// A fake `claude` child: `script(msg, reply)` answers each control_request written to stdin.
function fakeSpawn(script, record = {}) {
  return (cmd, argsOrOpts, maybeOpts) => {
    record.cmd = cmd;
    record.opts = maybeOpts || argsOrOpts;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, enc, cb) {
        for (const line of String(chunk).split('\n').filter(Boolean)) script(JSON.parse(line), o => child.stdout.write(JSON.stringify(o) + '\n'));
        cb();
      },
    });
    child.kill = () => { record.killed = true; };
    return child;
  };
}

const reply = (id, subtype, response) => ({ type: 'control_response', response: { subtype, request_id: id, response } });

test('fetchUsage: initialize, then get_usage, then parse', async () => {
  const rec = {};
  const spawnImpl = fakeSpawn((msg, out) => {
    out({ type: 'system', subtype: 'init' });
    if (msg.request.subtype === 'initialize') out(reply(msg.request_id, 'success', {}));
    if (msg.request.subtype === 'get_usage') {
      assert.equal(msg.request.skip_behaviors, true);
      out(reply(msg.request_id, 'success', OK));
    }
  }, rec);
  const r = await fetchUsage({ spawnImpl, now: () => 9 });
  assert.equal(r.status, 'ok');
  assert.equal(r.fable.pct, 71);
  assert.equal(r.asOf, 9);
  assert.equal(rec.opts.env.DESK_COMPANION_INTERNAL, '1');
  assert.ok(CLAUDE_ARGS.includes('--safe-mode'));
});

test('fetchUsage: init error, timeout and spawn failure are unavailable', async () => {
  const initErr = await fetchUsage({ spawnImpl: fakeSpawn((m, out) => out(reply(m.request_id, 'error', {}))) });
  assert.deepEqual([initErr.status, initErr.reason], ['unavailable', 'init']);
  const slow = await fetchUsage({ spawnImpl: fakeSpawn(() => {}), timeoutMs: 50 });
  assert.deepEqual([slow.status, slow.reason], ['unavailable', 'timeout']);
  const boom = await fetchUsage({ spawnImpl: () => { throw new Error('ENOENT'); } });
  assert.deepEqual([boom.status, boom.reason], ['unavailable', 'spawn']);
});

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    set: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clear: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      t += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > t) break;
        await timers.shift().fn();
      }
    },
  };
}

const MIN = 60e3;

function poller(results) {
  const c = fakeClock();
  const calls = [];
  const updates = [];
  const p = createLimitsPoller({
    now: c.now, setTimer: c.set, clearTimer: c.clear,
    fetch: async ({ now }) => { calls.push(c.now()); const r = results.shift() || { status: 'unavailable' }; return r.status === 'ok' ? { ...r, asOf: now() } : r; },
    onUpdate: l => updates.push(l),
  });
  return { c, calls, updates, p };
}

test('poller: immediate first call, then every 5 minutes', async () => {
  const ok = { status: 'ok', fiveHour: { pct: 10, resetsAt: null }, week: null, fable: null };
  const { c, calls, updates, p } = poller([ok, ok, ok]);
  p.start();
  await c.advance(0);
  assert.deepEqual(calls, [0]);
  assert.equal(updates[0].status, 'ok');
  await c.advance(5 * MIN);
  assert.deepEqual(calls, [0, 5 * MIN]);
});

test('poller: back-off 10, 20, 30, 30 minutes on failure; values kept and go stale', async () => {
  const ok = { status: 'ok', fiveHour: { pct: 10, resetsAt: null }, week: null, fable: null };
  const { c, calls, p } = poller([ok]);
  p.start();
  await c.advance(0);
  await c.advance(5 * MIN);   // fails
  await c.advance(10 * MIN);  // fails
  await c.advance(20 * MIN);  // fails
  await c.advance(30 * MIN);  // fails
  await c.advance(30 * MIN);  // fails
  assert.deepEqual(calls.map(t => t / MIN), [0, 5, 15, 35, 65, 95]);
  assert.equal(p.view().status, 'stale');
  assert.equal(p.view().fiveHour.pct, 10);
});

test('poller: signin polls every 5 minutes without back-off', async () => {
  const { c, calls, p } = poller([{ status: 'signin' }, { status: 'signin' }]);
  p.start();
  await c.advance(0);
  assert.equal(p.view().status, 'signin');
  await c.advance(5 * MIN);
  assert.deepEqual(calls.map(t => t / MIN), [0, 5]);
});

test('poller: onStop pulls the next call forward, at least 2 minutes after the last one', async () => {
  const ok = { status: 'ok', fiveHour: null, week: null, fable: null };
  const { c, calls, p } = poller([ok, ok, ok]);
  p.start();
  await c.advance(0);
  await c.advance(10e3);
  p.onStop();                 // max(10s + 60s, 0 + 120s) = 120s
  await c.advance(110e3 - 1);
  assert.deepEqual(calls, [0]);
  await c.advance(1);
  assert.deepEqual(calls, [0, 120e3]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/limits.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/server/limits.mjs`**

```js
import { spawn as nodeSpawn } from 'node:child_process';

// Confirmed in the planning spike (Task 0). --safe-mode keeps our own plugin's hooks out of this child.
export const CLAUDE_ARGS = ['-p', '--safe-mode', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
export const POLL_MS = 5 * 60e3;
export const MIN_GAP_MS = 2 * 60e3;
export const AFTER_STOP_MS = 60e3;
export const BACKOFF_MS = [10 * 60e3, 20 * 60e3, 30 * 60e3];
export const STALE_MS = 15 * 60e3;
const EMPTY = Object.freeze({ status: 'unavailable', asOf: null, fiveHour: null, week: null, fable: null });

export function normPct(u) {
  if (!Number.isFinite(u)) return null;
  const v = u > 0 && u < 1 && !Number.isInteger(u) ? u * 100 : u;
  return Math.max(0, Math.round(v));
}

function windowOf(w) {
  if (!w || typeof w !== 'object') return null;
  const pct = normPct(w.utilization);
  if (pct === null) return null;
  const t = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
  return { pct, resetsAt: Number.isFinite(t) ? t : null };
}

// resp is SDKControlGetUsageResponse (Agent SDK 0.3.270).
export function parseUsage(resp, now) {
  if (!resp || typeof resp !== 'object') return { ...EMPTY };
  const rl = resp.rate_limits;
  if (!resp.rate_limits_available || !rl) return { ...EMPTY, status: resp.subscription_type ? 'unavailable' : 'signin' };
  const fable = Array.isArray(rl.model_scoped) ? rl.model_scoped.find(r => r && /fable/i.test(r.display_name || '')) : null;
  return { status: 'ok', asOf: now, fiveHour: windowOf(rl.five_hour), week: windowOf(rl.seven_day), fable: windowOf(fable) };
}

export function fetchUsage({ spawnImpl = nodeSpawn, command = 'claude', timeoutMs = 20000, now = Date.now } = {}) {
  return new Promise(resolve => {
    const fail = reason => ({ ...EMPTY, reason });
    const opts = { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, DESK_COMPANION_INTERNAL: '1' } };
    let child;
    try {
      child = process.platform === 'win32'
        ? spawnImpl(`${command} ${CLAUDE_ARGS.join(' ')}`, { ...opts, shell: true }) // resolves claude.cmd
        : spawnImpl(command, CLAUDE_ARGS, opts);
    } catch {
      resolve(fail('spawn'));
      return;
    }
    let buf = '';
    let settled = false;
    const send = o => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* closed */ } };
    const finish = r => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* closed */ } // EOF makes claude exit by itself
      const k = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 2000);
      if (k.unref) k.unref();
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail('timeout')), timeoutMs);
    child.on('error', () => finish(fail('spawn')));
    child.on('exit', () => finish(fail('exit')));
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (!m || m.type !== 'control_response' || !m.response) continue;
        const r = m.response;
        if (r.request_id === 'dc-init') {
          if (r.subtype !== 'success') { finish(fail('init')); return; }
          send({ type: 'control_request', request_id: 'dc-usage', request: { subtype: 'get_usage', skip_behaviors: true } });
        } else if (r.request_id === 'dc-usage') {
          finish(r.subtype === 'success' ? parseUsage(r.response, now()) : fail('usage'));
          return;
        }
      }
    });
    send({ type: 'control_request', request_id: 'dc-init', request: { subtype: 'initialize' } });
  });
}

export function createLimitsPoller({ fetch = fetchUsage, onUpdate, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  let current = { ...EMPTY };
  let failures = 0;
  let lastCallAt = -Infinity;
  let dueAt = Infinity;
  let timer = null;
  let running = false;

  const at = when => {
    if (timer) clearTimer(timer);
    dueAt = when;
    timer = setTimer(run, Math.max(0, when - now()));
  };

  const view = () => (current.status === 'ok' && now() - current.asOf > STALE_MS ? { ...current, status: 'stale' } : current);

  async function run() {
    timer = null;
    dueAt = Infinity;
    if (running) return;
    running = true;
    lastCallAt = now();
    let r;
    try { r = await fetch({ now }); } catch (e) { r = { ...EMPTY, reason: e.message }; }
    running = false;
    if (r.status === 'ok') {
      failures = 0;
      current = r;
    } else if (r.status === 'signin') {
      failures = 0;                      // keep polling every 5 min so limits appear soon after login
      current = { ...EMPTY, status: 'signin' };
    } else {
      failures += 1;
      if (current.status !== 'ok') current = { ...EMPTY }; // keep last good values; they go stale
      log(`limits unavailable${r.reason ? ` (${r.reason})` : ''}`);
    }
    onUpdate(view());
    at(now() + (failures ? BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] : POLL_MS));
  }

  return {
    start() { at(now()); },
    onStop() {
      if (failures) return;
      const when = Math.max(now() + AFTER_STOP_MS, lastCallAt + MIN_GAP_MS);
      if (when < dueAt) at(when);
    },
    view,
    stop() { if (timer) clearTimer(timer); timer = null; },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/limits.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the poller into `bin/server.mjs`**

Add this import next to the other `../src/server/*` imports:
```js
import { createLimitsPoller } from '../src/server/limits.mjs';
```
Replace the line `  // LIMITS-POLLER` with:
```js
  if (!process.env.DESK_COMPANION_NO_LIMITS) {
    const poller = createLimitsPoller({
      log,
      onUpdate(l) { limits = l; app.broadcast('snapshot', snapshot()); },
    });
    onStop = () => poller.onStop();
    poller.start();
  }
```

- [ ] **Step 6: Run the whole suite**

Run: `node --test`
Expected: PASS. `test/server.test.mjs` still passes because it sets `DESK_COMPANION_NO_LIMITS=1`.

- [ ] **Step 7: Check it for real (user step for the login)**

1. Ask the user to run `claude auth login` once in a terminal and complete the browser sign-in. The assistant must not enter credentials.
2. `node bin/server.mjs --stop && node bin/pair.mjs`. Within about 5 s the phone's rings show real 5-hour and weekly numbers with countdowns.
3. Check the Fable ring. If it stays "—" while claude.ai shows a Fable limit, record the actual `rate_limits` keys in the spec's risk 1. To see them, temporarily log `JSON.stringify(Object.keys(r.response.rate_limits || {}))` in `fetchUsage`, then remove the log.
4. Check that no stray `claude` processes pile up. `tasklist | findstr /i claude` run twice, 6 minutes apart, must not show a growing count.
5. Signed out, the note reads `Run "claude auth login" on the PC to show limits`.

- [ ] **Step 8: Commit**

```bash
git add src/server/limits.mjs bin/server.mjs test/limits.test.mjs
git commit -m "feat: plan limits via Claude Code get_usage with back-off" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Pairing page, QR code and `/desk-companion:pair`

**Files:**
- Create: `src/web/vendor/qrcode.js` (downloaded), `src/web/vendor/LICENSE-qrcode-generator.txt`, `src/web/pair.html`, `skills/pair/SKILL.md`
- Modify: `bin/pair.mjs` (replace the `// PAIR-PAGE` line)
- Test: `test/pair.test.mjs`

**Interfaces:**
- Consumes: `GET /pair` and `GET /api/pair-info` (Task 5), which return `{urls: string[], sessions: number, limits: string, pages: number}`; `bin/pair.mjs` (Task 8).
- Produces: `/desk-companion:pair`. It prints the phone URL and opens `http://localhost:<port>/pair` in the PC's default browser.

- [ ] **Step 1: Vendor the QR library** (MIT, Kazuhiko Arase, version pinned):

```bash
mkdir -p src/web/vendor
curl -sL https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js -o src/web/vendor/qrcode.js
head -5 src/web/vendor/qrcode.js
```
Expected: the header shows `Copyright (c) 2009 Kazuhiko Arase` and `Licensed under the MIT license`. Create `src/web/vendor/LICENSE-qrcode-generator.txt` with the standard MIT licence text and the line `Copyright (c) 2009 Kazuhiko Arase`, plus `Source: https://github.com/kazuhikoarase/qrcode-generator (npm qrcode-generator@1.4.4)`.

- [ ] **Step 2: Write the failing test** `test/pair.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vendored qrcode.js encodes a phone URL to an SVG', () => {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/web/vendor/qrcode.js'), 'utf8'), ctx);
  const qr = ctx.qrcode(0, 'M');
  qr.addData('http://192.168.1.23:53943/?k=' + 'a'.repeat(32));
  qr.make();
  assert.ok(qr.getModuleCount() >= 25);
  assert.match(qr.createSvgTag(6, 0), /^<svg /);
});

test('pair skill runs the pair script and is user-invoked only', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills/pair/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(md, /^---\nname: pair\n/);
  assert.match(md, /\ndisable-model-invocation: true\n/);
  assert.ok(md.includes('!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"`'));
});

test('pair page loads the vendored QR library and the pair-info API', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/web/pair.html'), 'utf8');
  assert.ok(html.includes('src="/web/vendor/qrcode.js"'));
  assert.ok(html.includes("fetch('/api/pair-info')"));
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/pair.test.mjs`
Expected: the first test passes and the other two FAIL, because `SKILL.md` and `pair.html` don't exist yet.

- [ ] **Step 4: Create `skills/pair/SKILL.md`** (LF line endings)

```markdown
---
name: pair
description: Show the desk-companion phone link and open a QR code to scan. Use when the user wants to open desk-companion on their phone.
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"`

Tell the user, in two or three short lines: the phone URL printed above, that a QR code has opened in their PC's browser, and that on iPhone they can use Share → Add to Home Screen for full screen. If the output says the server could not start, point them to ~/.desk-companion/server.log.
```

- [ ] **Step 5: Create `src/web/pair.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>desk-companion: pair your phone</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0f; color: #e8e6e3; font-family: system-ui, sans-serif; }
    main { text-align: center; max-width: 560px; padding: 24px; }
    #qr { background: #fff; padding: 16px; border-radius: 16px; display: inline-block; }
    #qr svg { display: block; width: 280px; height: 280px; }
    code { display: block; word-break: break-all; background: #1b1b24; padding: 10px 12px; border-radius: 8px; margin: 14px 0; }
    .dim { color: #8a8a93; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Scan with your phone</h1>
    <p class="dim">Use the same Wi-Fi as this PC. On iPhone, tap Share → Add to Home Screen for full screen.</p>
    <div id="qr"></div>
    <code id="url">…</code>
    <div id="alts" class="dim"></div>
    <p id="status" class="dim"></p>
  </main>
  <script src="/web/vendor/qrcode.js"></script>
  <script>
    fetch('/api/pair-info').then(r => r.json()).then(info => {
      const url = info.urls[0];
      if (!url) { document.getElementById('url').textContent = 'No Wi-Fi address found on this PC.'; return; }
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      document.getElementById('qr').innerHTML = qr.createSvgTag(6, 0);
      document.getElementById('url').textContent = url;
      document.getElementById('alts').textContent = info.urls.length > 1 ? 'Also: ' + info.urls.slice(1).join('  ·  ') : '';
      document.getElementById('status').textContent =
        `${info.sessions} session(s) tracked · limits: ${info.limits} · ${info.pages} phone page(s) open`;
    });
  </script>
</body>
</html>
```

- [ ] **Step 6: Make `bin/pair.mjs` open the pair page**

Replace the line `// PAIR-PAGE` with:
```js
if (up && !process.argv.includes('--no-open')) {
  const page = `http://localhost:${cfg.port}/pair`;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', page]] // '' is start's window title
    : process.platform === 'darwin' ? ['open', [page]] : ['xdg-open', [page]];
  try { spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* no browser */ }
  console.log(`A QR code opened in your browser: ${page}`);
}
```

- [ ] **Step 7: Run the tests**

Run: `node --test test/pair.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 8: Check it manually**

Run `node bin/pair.mjs`. Expected: the URL is printed and the default browser opens `/pair` showing a QR code. Scanning it with the phone camera opens the dashboard.

- [ ] **Step 9: Commit**

```bash
git add src/web/vendor/qrcode.js src/web/vendor/LICENSE-qrcode-generator.txt src/web/pair.html skills/pair/SKILL.md bin/pair.mjs test/pair.test.mjs
git commit -m "feat: pairing page with QR code and /desk-companion:pair skill" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Sprite maths, PNG codec and animation table

**Files:**
- Create: `tools/lib/png.mjs`, `tools/lib/sprite-math.mjs`, `src/web/anims.js`
- Test: `test/png.test.mjs`, `test/sprite-math.test.mjs`, `test/anims.test.mjs`

**Interfaces:**
- Produces (`png.mjs`):
  - `decodePng(buf): Image`, for 8-bit RGB/RGBA non-interlaced input; RGBA is dropped to RGB
  - `encodePng(img): Buffer`
  - `Image = {width, height, data: Buffer}`, RGB, 3 bytes per pixel, row-major
- Produces (`sprite-math.mjs`, all pure):
  - `median`, `makeImage`, `fillRect`, `getPixel`
  - `removeGridLines(img): {cols, rows}`
  - `dominantColor(img, rect?): [r,g,b] | null`
  - `colorMask(img, rect, color, tol?)`
  - `largestComponent(mask, w, h)`
  - `measureBody(img, rect, color): Body | null`, where `Body = {x0, x1, y0, y1, width, height, cx, feet}`
  - `cellRects(img, cols?, rows?)`
  - `frameMasks(bodies, cells, img, cols?)`
  - `sheetScale(bodies, targetWidth)`
  - `anchors(bodies, mode, cols?)`, with `mode` either `'frame'` or `'row'`
  - `renderFrame(img, maskRect, scale, cx, feet, size?, feetRow?, samples?)`
  - `blit(src, dst, dx)`
  - `measureFrame(img): Body | null`
  - Rects are `{x0, y0, x1, y1}` with exclusive `x1`/`y1`. `feet` is the row just below the body's lowest pixel.
- Produces (`anims.js`): `SHEETS`, `MOTION_SHEETS`, `FRAME_SIZE = 256`, `FRAMES = 8`, and `ANIMS: {[name]: {sheet, ms, loop?, next?}}`.

- [ ] **Step 1: Write the failing tests**

`test/png.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, encodePng } from '../tools/lib/png.mjs';

test('encode then decode round-trips RGB pixels', () => {
  const img = { width: 3, height: 2, data: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]) };
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 3);
  assert.equal(back.height, 2);
  assert.deepEqual([...back.data], [...img.data]);
});

test('rejects non-PNG input', () => {
  assert.throws(() => decodePng(Buffer.from('nope, not a png file')), /not a PNG/);
});
```

`test/anims.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMS, SHEETS, MOTION_SHEETS } from '../src/web/anims.js';

test('animation table is consistent', () => {
  assert.equal(SHEETS.length, 21);
  for (const [name, a] of Object.entries(ANIMS)) {
    assert.ok(SHEETS.includes(a.sheet), `${name} sheet`);
    assert.ok(a.ms > 0, `${name} ms`);
    if (a.next) assert.ok(ANIMS[a.next], `${name} next`);
  }
  for (const s of MOTION_SHEETS) assert.ok(SHEETS.includes(s));
  assert.deepEqual([ANIMS.reading.sheet, ANIMS.compiling.sheet, ANIMS.sad.sheet], ['thinking', 'working', 'ending']);
  assert.deepEqual([ANIMS.idle.ms, ANIMS.blink.ms, ANIMS.look_left.ms, ANIMS.sleeping.ms, ANIMS.overloaded.ms], [150, 80, 120, 200, 70]);
});
```

`test/sprite-math.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeImage, fillRect, getPixel, removeGridLines, dominantColor, largestComponent, colorMask, measureBody,
  cellRects, frameMasks, sheetScale, anchors, renderFrame, blit, measureFrame, median,
} from '../tools/lib/sprite-math.mjs';

const ORANGE = [206, 109, 72];

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('removeGridLines blacks out full-length neutral lines only', () => {
  const img = makeImage(40, 20);
  fillRect(img, 10, 0, 11, 20, [220, 220, 220]);   // white vertical separator
  fillRect(img, 0, 5, 40, 6, [63, 64, 64]);        // thin dark-grey horizontal separator
  fillRect(img, 20, 8, 30, 18, ORANGE);            // body
  fillRect(img, 32, 8, 33, 12, [249, 249, 249]);   // short white "!" – not a line
  assert.deepEqual(removeGridLines(img), { cols: [10], rows: [5] });
  assert.deepEqual(getPixel(img, 10, 15), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 3, 5), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 25, 10), ORANGE);
  assert.deepEqual(getPixel(img, 32, 9), [249, 249, 249]);
});

test('dominantColor picks the body colour, ignoring white and small effects', () => {
  const img = makeImage(50, 50);
  fillRect(img, 10, 10, 40, 40, ORANGE);
  fillRect(img, 0, 0, 5, 5, [74, 115, 190]);
  fillRect(img, 45, 45, 50, 50, [249, 249, 249]);
  const c = dominantColor(img);
  assert.ok(Math.abs(c[0] - ORANGE[0]) <= 8 && Math.abs(c[1] - ORANGE[1]) <= 8 && Math.abs(c[2] - ORANGE[2]) <= 8, String(c));
});

test('largestComponent ignores small same-colour blobs (Zzz, spinner dots)', () => {
  const img = makeImage(30, 30);
  fillRect(img, 2, 2, 12, 12, ORANGE);
  fillRect(img, 20, 20, 23, 23, ORANGE);
  const { mask, w, h } = colorMask(img, { x0: 0, y0: 0, x1: 30, y1: 30 }, ORANGE);
  assert.deepEqual(largestComponent(mask, w, h), { count: 100, x0: 2, y0: 2, x1: 11, y1: 11 });
});

test('measureBody includes arms and legs, reports centre and feet line', () => {
  const img = makeImage(100, 80);
  fillRect(img, 30, 20, 70, 50, ORANGE);   // body block 40 wide
  fillRect(img, 22, 30, 30, 36, ORANGE);   // left arm
  fillRect(img, 70, 30, 78, 36, ORANGE);   // right arm
  fillRect(img, 35, 50, 40, 60, ORANGE);   // leg
  fillRect(img, 60, 50, 65, 60, ORANGE);   // leg
  fillRect(img, 80, 5, 84, 9, ORANGE);     // a floating "z"
  const b = measureBody(img, { x0: 0, y0: 0, x1: 100, y1: 80 }, ORANGE);
  assert.deepEqual([b.x0, b.x1, b.width, b.y0, b.feet, b.cx], [22, 77, 56, 20, 60, 50]);
});

test('cellRects, frameMasks, sheetScale and anchors', () => {
  const img = makeImage(400, 200);
  const cells = cellRects(img);
  assert.equal(cells.length, 8);
  assert.deepEqual(cells[5], { x0: 100, x1: 200, y0: 100, y1: 200, row: 1, col: 1 });
  const bodies = cells.map((c, i) => ({ cx: c.x0 + 50 + (i % 2 ? 4 : 0), feet: c.y0 + 80 + (i === 2 ? -10 : 0), width: 60 + i }));
  const masks = frameMasks(bodies, cells, img);
  assert.deepEqual(masks[0], { x0: 0, x1: Math.round((50 + 154) / 2), y0: 0, y1: 100 });
  assert.equal(masks[3].x1, 400);
  assert.equal(sheetScale(bodies, 150), 150 / median(bodies.map(b => b.width)));
  const rowMode = anchors(bodies, 'row');
  assert.deepEqual(rowMode.slice(0, 4).map(a => a.feet), [80, 80, 80, 80]);
  assert.equal(anchors(bodies, 'frame')[2].feet, 70);
});

test('renderFrame centres the body, puts the feet on feetRow and scales it', () => {
  const src = makeImage(100, 60);
  fillRect(src, 30, 30, 50, 50, ORANGE);   // 20 wide, feet at 50, centre x 40
  const full = { x0: 0, y0: 0, x1: 100, y1: 60 };
  const out = renderFrame(src, full, 2, 40, 50, 64, 50);
  const b = measureFrame(out);
  assert.ok(Math.abs(b.width - 40) <= 1, `width ${b.width}`);
  assert.ok(Math.abs(b.feet - 50) <= 1, `feet ${b.feet}`);
  assert.ok(Math.abs(b.cx - 32) <= 1, `cx ${b.cx}`);
  assert.deepEqual(getPixel(out, 5, 30), [0, 0, 0]);
  const clipped = renderFrame(src, { x0: 0, y0: 0, x1: 40, y1: 60 }, 2, 40, 50, 64, 50);
  assert.deepEqual(getPixel(clipped, 45, 30), [0, 0, 0]);
  assert.deepEqual(getPixel(clipped, 20, 30), ORANGE);
});

test('blit copies a frame into a strip at an x offset', () => {
  const f = makeImage(2, 2);
  fillRect(f, 0, 0, 2, 2, ORANGE);
  const strip = makeImage(6, 2);
  blit(f, strip, 2);
  assert.deepEqual(getPixel(strip, 1, 1), [0, 0, 0]);
  assert.deepEqual(getPixel(strip, 2, 0), ORANGE);
  assert.deepEqual(getPixel(strip, 3, 1), ORANGE);
  assert.deepEqual(getPixel(strip, 4, 0), [0, 0, 0]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/png.test.mjs test/anims.test.mjs test/sprite-math.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `tools/lib/png.mjs`**

```js
import zlib from 'node:zlib';

// Minimal PNG codec: reads 8-bit RGB/RGBA non-interlaced (every clawdio sheet is 8-bit RGB), writes 8-bit RGB.
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      ct = d[9];
      if (d[8] !== 8 || (ct !== 2 && ct !== 6) || d[12] !== 0) throw new Error(`unsupported PNG (depth ${d[8]}, colour type ${ct}, interlace ${d[12]})`);
    } else if (type === 'IDAT') {
      idat.push(d);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = v & 255;
    }
  }
  if (bpp === 3) return { width: w, height: h, data: px };
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i];
    rgb[j + 1] = px[i + 1];
    rgb[j + 2] = px[i + 2];
  }
  return { width: w, height: h, data: rgb };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng({ width, height, data }) {
  const row = width * 3;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

- [ ] **Step 4: Implement `src/web/anims.js`**

```js
// Animation table (spec §8), ported from clawdio's anim_registry.cpp (cegware/clawdio, MIT).
// Single source of truth for the page and for tools/build-sprites.mjs.
export const SHEETS = [
  'angry', 'blink', 'celebration', 'cool', 'curious', 'ending', 'error', 'happy', 'happy_eyes', 'idle', 'jumping_joy',
  'look_left', 'look_right', 'love', 'low_tokens', 'overloaded', 'sleeping', 'surprised', 'thinking', 'working', 'yawning',
];
// Sheets whose drawn vertical motion (hops, jumps, stretches) must survive normalisation (spec §9).
export const MOTION_SHEETS = ['happy_eyes', 'surprised', 'jumping_joy', 'celebration', 'happy', 'yawning'];
export const FRAME_SIZE = 256;
export const FRAMES = 8;

export const ANIMS = {
  idle: { sheet: 'idle', ms: 150, loop: true },
  look_left: { sheet: 'look_left', ms: 120 },
  look_right: { sheet: 'look_right', ms: 120 },
  blink: { sheet: 'blink', ms: 80 },
  happy_eyes: { sheet: 'happy_eyes', ms: 100, loop: true },
  curious: { sheet: 'curious', ms: 130 },
  thinking: { sheet: 'thinking', ms: 100, loop: true },
  working: { sheet: 'working', ms: 80, loop: true },
  compiling: { sheet: 'working', ms: 90, loop: true },
  reading: { sheet: 'thinking', ms: 110, loop: true },
  surprised: { sheet: 'surprised', ms: 100 },
  cool: { sheet: 'cool', ms: 140, loop: true },
  happy: { sheet: 'happy', ms: 100, loop: true },
  jumping_joy: { sheet: 'jumping_joy', ms: 80, next: 'happy' },
  celebration: { sheet: 'celebration', ms: 90, next: 'happy' },
  love: { sheet: 'love', ms: 120 },
  low_tokens: { sheet: 'low_tokens', ms: 150, loop: true },
  ending: { sheet: 'ending', ms: 130, loop: true },
  sad: { sheet: 'ending', ms: 160, loop: true },
  overloaded: { sheet: 'overloaded', ms: 70, loop: true },
  angry: { sheet: 'angry', ms: 90, loop: true },
  error: { sheet: 'error', ms: 60, loop: true },
  sleeping: { sheet: 'sleeping', ms: 200, loop: true },
  yawning: { sheet: 'yawning', ms: 140 },
};
```

- [ ] **Step 5: Implement `tools/lib/sprite-math.mjs`**

```js
// Pure image maths for tools/build-sprites.mjs. Image = {width, height, data: RGB Buffer}.
// Rects are {x0, y0, x1, y1} with exclusive x1/y1.

export const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function makeImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 3) };
}

export function fillRect(img, x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 3;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
    }
  }
}

export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

// Threshold 10, not 30: the dry run showed faint anti-aliased line edges (values 10–30) otherwise survive as boxes.
const isLinePixel = (r, g, b) => Math.min(r, g, b) >= 10 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;

// Separator lines in clawdio's sheets are neutral grey/white and run the full width or height.
// Detected lines are painted black together with `halo` px on each side.
export function removeGridLines(img, share = 0.85, halo = 2) {
  const { width: W, height: H, data } = img;
  const cols = [];
  const rows = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 3; if (isLinePixel(data[i], data[i + 1], data[i + 2])) n++; }
    if (n >= share * H) cols.push(x);
  }
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (isLinePixel(data[i], data[i + 1], data[i + 2])) n++; }
    if (n >= share * W) rows.push(y);
  }
  for (const x of cols) fillRect(img, Math.max(0, x - halo), 0, Math.min(W, x + halo + 1), H, [0, 0, 0]);
  for (const y of rows) fillRect(img, 0, Math.max(0, y - halo), W, Math.min(H, y + halo + 1), [0, 0, 0]);
  return { cols, rows };
}

// Most frequent bright, saturated colour, as the centre of a 16-level bucket: the body colour.
export function dominantColor(img, rect = { x0: 0, y0: 0, x1: img.width, y1: img.height }) {
  const hist = new Map();
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const [r, g, b] = getPixel(img, x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx < 90 || mx - mn < 60) continue;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let best = -1;
  let bestN = 0;
  for (const [k, n] of hist) if (n > bestN) { best = k; bestN = n; }
  if (best < 0) return null;
  return [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
}

export function colorMask(img, rect, color, tol = 70) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = getPixel(img, rect.x0 + x, rect.y0 + y);
      if (Math.abs(r - color[0]) + Math.abs(g - color[1]) + Math.abs(b - color[2]) < tol) mask[y * w + x] = 1;
    }
  }
  return { mask, w, h };
}

// Largest 4-connected component: the body (arms and legs attached); floating effects are smaller.
export function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    let n = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; queue[tail++] = p + w; }
    }
    if (!best || n > best.count) best = { count: n, x0, y0, x1, y1 };
  }
  return best;
}

export function measureBody(img, rect, color) {
  if (!color) return null;
  const { mask, w, h } = colorMask(img, rect, color);
  const c = largestComponent(mask, w, h);
  if (!c || c.count < 50) return null;
  const x0 = rect.x0 + c.x0;
  const x1 = rect.x0 + c.x1;
  const y0 = rect.y0 + c.y0;
  const y1 = rect.y0 + c.y1;
  return { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, cx: (x0 + x1 + 1) / 2, feet: y1 + 1 };
}

export function measureFrame(img) {
  return measureBody(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }, dominantColor(img));
}

export function cellRects(img, cols = 4, rows = 2) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x0: Math.round((c * img.width) / cols), x1: Math.round(((c + 1) * img.width) / cols),
        y0: Math.round((r * img.height) / rows), y1: Math.round(((r + 1) * img.height) / rows),
        row: r, col: c,
      });
    }
  }
  return out;
}

// A frame may use pixels between the midpoints to its row neighbours' body centres, so neighbours never bleed in.
export function frameMasks(bodies, cells, img, cols = 4) {
  return cells.map((cell, i) => ({
    x0: cell.col === 0 ? 0 : Math.round((bodies[i - 1].cx + bodies[i].cx) / 2),
    x1: cell.col === cols - 1 ? img.width : Math.round((bodies[i].cx + bodies[i + 1].cx) / 2),
    y0: cell.y0,
    y1: cell.y1,
  }));
}

export function sheetScale(bodies, targetWidth) {
  return targetWidth / median(bodies.map(b => b.width));
}

// 'frame': each frame on its own feet line. 'row': a row shares its lowest feet line (the ground), so drawn hops survive.
export function anchors(bodies, mode, cols = 4) {
  return bodies.map((b, i) => {
    if (mode !== 'row') return { cx: b.cx, feet: b.feet };
    const start = Math.floor(i / cols) * cols;
    return { cx: b.cx, feet: Math.max(...bodies.slice(start, start + cols).map(o => o.feet)) };
  });
}

// Body centre lands on column size/2, the feet line on row feetRow; samples x samples supersampling.
export function renderFrame(img, maskRect, scale, cx, feet, size = 256, feetRow = 214, samples = 3) {
  const out = makeImage(size, size);
  const inv = 1 / scale;
  const n = samples * samples;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < samples; sy++) {
        const y = Math.floor(feet + (v + (sy + 0.5) / samples - feetRow) * inv);
        if (y < maskRect.y0 || y >= maskRect.y1 || y < 0 || y >= img.height) continue;
        for (let sx = 0; sx < samples; sx++) {
          const x = Math.floor(cx + (u + (sx + 0.5) / samples - size / 2) * inv);
          if (x < maskRect.x0 || x >= maskRect.x1 || x < 0 || x >= img.width) continue;
          const i = (y * img.width + x) * 3;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const o = (v * size + u) * 3;
      const R = Math.round(r / n);
      const G = Math.round(g / n);
      const B = Math.round(b / n);
      const floor = Math.max(R, G, B) < 12; // near-black noise and line halos become pure black
      out.data[o] = floor ? 0 : R;
      out.data[o + 1] = floor ? 0 : G;
      out.data[o + 2] = floor ? 0 : B;
    }
  }
  return out;
}

export function blit(src, dst, dx) {
  for (let y = 0; y < src.height; y++) src.data.copy(dst.data, (y * dst.width + dx) * 3, y * src.width * 3, (y + 1) * src.width * 3);
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/png.test.mjs test/anims.test.mjs test/sprite-math.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add tools/lib/png.mjs tools/lib/sprite-math.mjs src/web/anims.js test/png.test.mjs test/anims.test.mjs test/sprite-math.test.mjs
git commit -m "feat: PNG codec, sprite normalisation maths and animation table" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Build the sprites

**Files:**
- Create: `tools/build-sprites.mjs`
- Generated and committed: `src/web/sprites/<21 sheets>.png`, `src/web/sprites/sprites.json`, `src/web/sprites/LICENSE-clawdio.txt`, `src/web/icon.png`
- Test: `test/sprites.test.mjs`

**Interfaces:**
- Consumes: `png.mjs`, `sprite-math.mjs`, `anims.js` (Task 11).
- Produces:
  - one strip per entry in `SHEETS` at `/web/sprites/<sheet>.png`: 8 frames of 256×256, 2048×256 in total, black background, body centred at x = 128 with the feet line at y = 214;
  - `icon.png`, idle frame 0 at 256×256.

- [ ] **Step 1: Write the failing output test** `test/sprites.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../tools/lib/png.mjs';
import { SHEETS } from '../src/web/anims.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPRITES = path.join(ROOT, 'src', 'web', 'sprites');

test('every sheet has a 2048x256 strip', () => {
  for (const name of SHEETS) {
    const img = decodePng(fs.readFileSync(path.join(SPRITES, `${name}.png`)));
    assert.deepEqual([img.width, img.height], [2048, 256], name);
  }
});

test('metadata, licence and icon are present', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
  assert.equal(meta.source.commit, '76ee482fffa1cc602ca0dc524324a2880b9770e2');
  assert.deepEqual(Object.keys(meta.sheets).sort(), [...SHEETS].sort());
  assert.match(fs.readFileSync(path.join(SPRITES, 'LICENSE-clawdio.txt'), 'utf8'), /MIT/);
  const icon = decodePng(fs.readFileSync(path.join(ROOT, 'src', 'web', 'icon.png')));
  assert.deepEqual([icon.width, icon.height], [256, 256]);
});
```

Run: `node --test test/sprites.test.mjs`
Expected: FAIL, files missing.

- [ ] **Step 2: Create `tools/build-sprites.mjs`**

```js
#!/usr/bin/env node
// One-time sprite build (spec §9): re-cut clawdio's source sheets into normalised 256x256 frame strips.
// Usage: node tools/build-sprites.mjs          build, then check
//        node tools/build-sprites.mjs --check  check the committed output only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/png.mjs';
import {
  removeGridLines, cellRects, dominantColor, measureBody, frameMasks, anchors, renderFrame,
  blit, makeImage, measureFrame, median,
} from './lib/sprite-math.mjs';
import { SHEETS, MOTION_SHEETS, FRAME_SIZE, FRAMES } from '../src/web/anims.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'src', 'web', 'sprites');
const REPO = 'cegware/clawdio';
const COMMIT = '76ee482fffa1cc602ca0dc524324a2880b9770e2';
const TARGET_WIDTH = 150; // body width incl. arms, in output px, for every sheet
const FEET_ROW = 214;     // output row of the feet line
// Source-px body width to use instead of the measured median, for a sheet whose body detection is wrong.
// Leave empty unless Step 4 says otherwise; overridden sheets skip the width check.
const BODY_WIDTH_OVERRIDE = {};

async function cached(rel) {
  const file = path.join(CACHE, rel.replace(/\//g, '_'));
  if (!fs.existsSync(file)) {
    const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file);
}

function cropFrame(strip, i) {
  const f = makeImage(FRAME_SIZE, FRAME_SIZE);
  for (let y = 0; y < FRAME_SIZE; y++) {
    strip.data.copy(f.data, y * FRAME_SIZE * 3, (y * strip.width + i * FRAME_SIZE) * 3, (y * strip.width + (i + 1) * FRAME_SIZE) * 3);
  }
  return f;
}

function buildSheet(name, buf) {
  const img = decodePng(buf);
  const lines = removeGridLines(img);
  const cells = cellRects(img);
  const color = dominantColor(img);
  const bodies = cells.map(c => measureBody(img, c, color));
  const missing = bodies.findIndex(b => !b);
  if (missing >= 0) throw new Error(`${name}: no body found in frame ${missing}`);
  const masks = frameMasks(bodies, cells, img);
  const measured = median(bodies.map(b => b.width));
  const scale = TARGET_WIDTH / (BODY_WIDTH_OVERRIDE[name] || measured);
  const anc = anchors(bodies, MOTION_SHEETS.includes(name) ? 'row' : 'frame');
  const strip = makeImage(FRAME_SIZE * FRAMES, FRAME_SIZE);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const f = renderFrame(img, masks[i], scale, anc[i].cx, anc[i].feet, FRAME_SIZE, FEET_ROW);
    frames.push(f);
    blit(f, strip, i * FRAME_SIZE);
  }
  return {
    strip, frames,
    meta: { source: `${img.width}x${img.height}`, color, lineCount: lines.cols.length + lines.rows.length, medianBodyWidth: measured, scale: +scale.toFixed(4) },
  };
}

// Acceptance (spec §9): median body width within ±2% of TARGET_WIDTH, resting feet within ±2 px, no line remnants.
function check(name, frames) {
  const bodies = frames.map(measureFrame);
  const problems = [];
  if (bodies.some(b => !b)) return { width: null, problems: ['body not found in an output frame'] };
  const width = median(bodies.map(b => b.width));
  if (!BODY_WIDTH_OVERRIDE[name] && Math.abs(width - TARGET_WIDTH) > TARGET_WIDTH * 0.02) problems.push(`median width ${width}, want ${TARGET_WIDTH} ±2%`);
  for (let row = 0; row < 2; row++) {
    const ground = Math.max(...bodies.slice(row * 4, row * 4 + 4).map(b => b.feet));
    if (Math.abs(ground - FEET_ROW) > 2) problems.push(`row ${row} ground at ${ground}, want ${FEET_ROW} ±2`);
  }
  frames.forEach((f, i) => {
    const l = removeGridLines({ ...f, data: Buffer.from(f.data) });
    if (l.cols.length || l.rows.length) problems.push(`frame ${i} has separator-line remnants`);
  });
  return { width, problems };
}

const checkOnly = process.argv.includes('--check');
fs.mkdirSync(OUT, { recursive: true });
const report = {};
let failed = false;
for (const name of SHEETS) {
  let frames;
  if (checkOnly) {
    const strip = decodePng(fs.readFileSync(path.join(OUT, `${name}.png`)));
    frames = Array.from({ length: FRAMES }, (_, i) => cropFrame(strip, i));
  } else {
    const built = buildSheet(name, await cached(`imgs/expr_${name}.png`));
    fs.writeFileSync(path.join(OUT, `${name}.png`), encodePng(built.strip));
    if (name === 'idle') fs.writeFileSync(path.join(ROOT, 'src', 'web', 'icon.png'), encodePng(built.frames[0]));
    report[name] = built.meta;
    frames = built.frames;
  }
  const c = check(name, frames);
  console.log(`${name.padEnd(12)} width ${String(c.width ?? '?').padStart(5)}  ${c.problems.length ? 'FAIL: ' + c.problems.join('; ') : 'ok'}`);
  if (c.problems.length) failed = true;
}
if (!checkOnly) {
  fs.writeFileSync(path.join(OUT, 'sprites.json'), JSON.stringify({
    source: { repo: REPO, commit: COMMIT, license: 'MIT' },
    frameSize: FRAME_SIZE, frames: FRAMES, targetBodyWidth: TARGET_WIDTH, feetRow: FEET_ROW, sheets: report,
  }, null, 2) + '\n');
  const licence = (await cached('LICENSE')).toString('utf8');
  fs.writeFileSync(path.join(OUT, 'LICENSE-clawdio.txt'), `Sprites derived from https://github.com/${REPO} (commit ${COMMIT}).\n\n${licence}`);
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the build**

Run: `node tools/build-sprites.mjs`
Expected: it downloads 21 sheets (about 16.5 MB) plus clawdio's LICENSE into `tools/.cache/`, then prints one line per sheet. Every line should end in `ok`, and the process should exit with code 0. Once downloaded, the build itself takes about 10 s.

A planning dry run on the real sheets passed all 21 checks, with median widths 149.5–150.5 and no clipping, and the strips looked right on visual review. Steps 4–5 are there in case the real run differs.

- [ ] **Step 4: If any sheet fails the check**

- **"no body found" or a width far from its neighbours** (compare `medianBodyWidth` in `sprites.json`): the body colour or detection is off for that sheet, most likely `error`, whose body is drawn "glitched". Set `BODY_WIDTH_OVERRIDE['<sheet>']` to the median width of a similar sheet from the same source family. `sprites.json` `source` is `1672x941` or `1774x887`, and `ending` or `angry` suit `error`. Re-run.
- **"ground at …"**: the legs aren't connected to the body in the colour mask. Raise the `colorMask` tolerance from 70 to 90 in `sprite-math.mjs`, re-run `node --test test/sprite-math.test.mjs`, then rebuild.
- **"separator-line remnants"**: lower `removeGridLines`' share from 0.85 to 0.75, run the tests, and rebuild.

- [ ] **Step 5: Visual review (required)**

Open these strips with the Read tool and look at every frame: `src/web/sprites/idle.png`, `blink.png`, `look_right.png`, `love.png`, `thinking.png`, `surprised.png`, `sleeping.png`, `celebration.png`, `overloaded.png`. Check that:
- the creature is the same size and on the same feet line in every strip;
- no grey or white separator lines are visible;
- effects are not clipped at the top edge: love's heart, thinking's dots, surprised's "!", sleeping's Zzz.

If effects are clipped at the top, change `TARGET_WIDTH` to 140 and rebuild. If the creature looks too small, change it to 160. Keep the value the same for all sheets, and record the final value in the commit message.

- [ ] **Step 6: Run the tests and the check mode**

Run: `node --test test/sprites.test.mjs && node tools/build-sprites.mjs --check`
Expected: PASS, 2 tests; the check prints `ok` for all 21 sheets and exits 0.

- [ ] **Step 7: Commit**

```bash
git add tools/build-sprites.mjs src/web/sprites src/web/icon.png test/sprites.test.mjs
git commit -m "feat: normalised 256px sprites re-cut from clawdio (MIT)" -m "TARGET_WIDTH=150, FEET_ROW=214" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Sprite player with calm idle

**Files:**
- Create: `src/web/mascot.js`
- Test: `test/mascot.test.mjs`

**Interfaces:**
- Consumes: `ANIMS` (Task 11).
- Produces:
  - `idlePlan({blinksPerMin, glancesPerMin, movingPct}): {blinkMs, glanceMs, breathMs}`, the mean intervals in still time (spec §8)
  - `class Player`:
    - `constructor({anims?, idle?, rand?})`
    - `setIdle(idleSettings)`
    - `setBase(nameOrNames)`: an array cycles, e.g. `['surprised','curious']`
    - `play(nameOrNames)`: one-shots; extra names are queued
    - `update(dtMs): boolean`: true if the frame changed
    - `frame(): {sheet, index}`
  - Readable fields: `cur.name`, `cur.hold` (true while holding the idle pose), `counts.{blink, glance, breath}`, `movingMs`

Playback rules (spec §8, clawdio's `anim_engine.cpp`):
- Advance at most one frame per update and carry the remainder.
- A loop wraps.
- A one-shot then plays, in order: its `next`, else the queue, else the base.
- When the base is `'idle'`, the player holds idle frame 0 and runs the blink, glance and breath timers, which only count down while holding.

- [ ] **Step 1: Write the failing test** `test/mascot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player, idlePlan } from '../src/web/mascot.js';

const lcg = (seed = 1) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
const run = (pl, ms, step = 16) => { for (let t = 0; t < ms; t += step) { if (pl.update(step)) pl.frame(); } };

test('idlePlan defaults: blink 1.15 s, glance 15 s, breath ~3.7 s of stillness', () => {
  const p = idlePlan();
  assert.ok(Math.abs(p.blinkMs - 30000 / 26) < 1);
  assert.equal(p.glanceMs, 15000);
  assert.ok(Math.abs(p.breathMs - 30000 / ((30000 - 26 * 640 - 2 * 960) / 1400)) < 1);
});

test('idlePlan: no breath budget means no breaths', () => {
  assert.equal(idlePlan({ blinksPerMin: 60, glancesPerMin: 10, movingPct: 20 }).breathMs, Infinity);
  assert.equal(idlePlan({ blinksPerMin: 0, glancesPerMin: 0, movingPct: 50 }).blinkMs, Infinity);
});

test('calm idle measures 26 blinks/min, 2 glances/min, 50% moving over 10 minutes', () => {
  const pl = new Player({ rand: lcg(42) });
  const total = 10 * 60000;
  run(pl, total);
  assert.ok(Math.abs(pl.counts.blink / 10 - 26) <= 2.6, `blinks/min ${pl.counts.blink / 10}`);
  assert.ok(Math.abs(pl.counts.glance / 10 - 2) <= 0.5, `glances/min ${pl.counts.glance / 10}`);
  assert.ok(Math.abs(pl.movingMs / total - 0.5) <= 0.05, `moving ${pl.movingMs / total}`);
});

test('holding idle shows idle frame 0', () => {
  const pl = new Player({ rand: () => 0.99 });
  assert.equal(pl.cur.hold, true);
  assert.deepEqual(pl.frame(), { sheet: 'idle', index: 0 });
});

test('an entry one-shot plays, then the base loop', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play('surprised');
  assert.equal(pl.cur.name, 'surprised');
  run(pl, 800);
  assert.equal(pl.cur.name, 'thinking');
  assert.equal(pl.frame().sheet, 'thinking');
});

test('aliases draw from their shared sheet', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('reading');
  assert.equal(pl.frame().sheet, 'thinking');
  pl.setBase('compiling');
  assert.equal(pl.frame().sheet, 'working');
});

test('jumping_joy chains to happy; a new base then takes over at once', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('happy');
  pl.play('jumping_joy');
  run(pl, 640);
  assert.equal(pl.cur.name, 'happy');
  pl.setBase('idle');
  assert.equal(pl.cur.name, 'idle');
  assert.equal(pl.cur.hold, true);
});

test('a two-item base cycles surprised and curious', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase(['surprised', 'curious']);
  assert.equal(pl.cur.name, 'surprised');
  run(pl, 800);
  assert.equal(pl.cur.name, 'curious');
  run(pl, 1040);
  assert.equal(pl.cur.name, 'surprised');
});

test('queued one-shots play in order, then the base', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('thinking');
  pl.play(['yawning', 'surprised', 'love']);
  const seen = ['yawning'];
  for (let t = 0; t < 4000; t += 16) { pl.update(16); if (seen.at(-1) !== pl.cur.name) seen.push(pl.cur.name); }
  assert.deepEqual(seen, ['yawning', 'surprised', 'love', 'thinking']);
});

test('setBase with the same base does not restart; unknown names are ignored', () => {
  const pl = new Player({ rand: () => 0.99 });
  pl.setBase('working');
  run(pl, 160);
  const f = pl.fi;
  pl.setBase(['working']);
  assert.equal(pl.fi, f);
  pl.play('nope');
  assert.equal(pl.cur.name, 'working');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/mascot.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/web/mascot.js`**

```js
import { ANIMS as DEFAULT_ANIMS } from './anims.js';

const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const BREATH_FRAMES = [0, 1, 2, 3, 2, 1, 0];
export const BLINK_MS = 640;   // 8 x 80 ms
export const GLANCE_MS = 960;  // 8 x 120 ms
export const BREATH_MS = 1400; // 7 x 200 ms

// Spec §8: mean intervals, counted in still time only.
export function idlePlan({ blinksPerMin = 26, glancesPerMin = 2, movingPct = 50 } = {}) {
  const M = Math.min(0.95, Math.max(0.05, movingPct / 100));
  const S = 60000 * (1 - M);
  const B = Math.max(0, blinksPerMin);
  const G = Math.max(0, glancesPerMin);
  const R = Math.max(0, (60000 * M - B * BLINK_MS - G * GLANCE_MS) / BREATH_MS);
  return { blinkMs: B ? S / B : Infinity, glanceMs: G ? S / G : Infinity, breathMs: R ? S / R : Infinity };
}

export class Player {
  constructor({ anims = DEFAULT_ANIMS, idle = {}, rand = Math.random } = {}) {
    this.anims = anims;
    this.rand = rand;
    this.base = ['idle'];
    this.bi = 0;
    this.queue = [];
    this.movingMs = 0;
    this.counts = { blink: 0, glance: 0, breath: 0 };
    this.setIdle(idle);
    this._toBase();
  }

  setIdle(idle) {
    this.plan = idlePlan(idle);
    this.t = { blink: this._draw(this.plan.blinkMs), glance: this._draw(this.plan.glanceMs), breath: this._draw(this.plan.breathMs) };
  }

  _draw(mean) { return Number.isFinite(mean) ? mean * (0.6 + 0.8 * this.rand()) : Infinity; } // uniform, ±40% of the mean
  _baseName() { return this.base[this.bi % this.base.length]; }
  _set(clip) { this.cur = clip; this.fi = 0; this.el = 0; this.dirty = true; }

  _clip(name) {
    const a = this.anims[name];
    return { name, sheet: a.sheet, frames: ALL, ms: a.ms, loop: !!a.loop, next: a.next || null, isBase: name === this._baseName() };
  }

  _toBase() {
    const n = this._baseName();
    if (n === 'idle') this._set({ name: 'idle', sheet: this.anims.idle.sheet, frames: [0], ms: Infinity, loop: true, next: null, isBase: true, hold: true });
    else this._set(this._clip(n));
  }

  setBase(names) {
    const next = [].concat(names);
    if (next.length === this.base.length && next.every((n, i) => n === this.base[i])) return;
    this.base = next;
    this.bi = 0;
    if (this.cur.isBase) this._toBase(); // a running one-shot finishes first, then the new base plays
  }

  play(names) {
    const list = [].concat(names).filter(n => this.anims[n]);
    if (!list.length) return;
    this.queue = list.slice(1);
    this._set(this._clip(list[0]));
  }

  update(dt) {
    const c = this.cur;
    if (c.hold) {
      this.t.blink -= dt;
      this.t.glance -= dt;
      this.t.breath -= dt;
      if (this.t.glance <= 0) {
        this.t.glance = this._draw(this.plan.glanceMs);
        this.counts.glance++;
        this.play(this.rand() < 0.5 ? 'look_left' : 'look_right');
      } else if (this.t.blink <= 0) {
        this.t.blink = this._draw(this.plan.blinkMs);
        this.counts.blink++;
        this.play('blink');
      } else if (this.t.breath <= 0) {
        this.t.breath = this._draw(this.plan.breathMs);
        this.counts.breath++;
        this._set({ name: 'breath', sheet: this.anims.idle.sheet, frames: BREATH_FRAMES, ms: 200, loop: false, next: null, isBase: false });
      }
      return this.dirty;
    }
    this.movingMs += dt;
    this.el += dt;
    if (this.el >= c.ms) {
      this.el -= c.ms;
      this.fi++;
      this.dirty = true;
      if (this.fi >= c.frames.length) {
        if (c.loop) this.fi = 0;
        else if (c.next) this._set(this._clip(c.next));
        else if (this.queue.length) this._set(this._clip(this.queue.shift()));
        else {
          if (c.isBase && this.base.length > 1) this.bi++;
          this._toBase();
        }
      }
    }
    return this.dirty;
  }

  frame() {
    this.dirty = false;
    return { sheet: this.cur.sheet, index: this.cur.frames[this.fi] };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/mascot.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/mascot.js test/mascot.test.mjs
git commit -m "feat: sprite player with clawdio timings and calm idle" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Companion state machine (`mood.js`)

**Files:**
- Create: `src/web/mood.js`
- Test: `test/mood.test.mjs`

**Interfaces:**
- Consumes: `formatReset` (Task 7); the Snapshot and event shapes (Tasks 5–6).
- Produces:
  - `DEFAULT_MOOD = {warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null}`
  - `createMood(settings?, {rand?}) → {onSnapshot(snap, now), onEvent(ev, now), onTap(now), tick(now), setSettings(partial)}`
  - Every method returns a `Command` or `null` (nothing changed): `Command = {base: string | string[], play: string[], bubble: {text, tone} | null, dim: boolean}`
  - The page applies a command as `player.setBase(base); if (play.length) player.play(play); setBubble(...); setDim(dim)`, and calls `tick` every 500 ms.

Priority, highest first (spec §7):
1. overloaded (5-hour ≥ 100 or rate limited)
2. needs you
3. `done` / `error` transients
4. activity
5. quiet transients: wake, celebrate, cool, yawn
6. asleep
7. limit moods
8. idle

- [ ] **Step 1: Write the failing test** `test/mood.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMood } from '../src/web/mood.js';

const T0 = Date.UTC(2026, 8, 14, 9, 0);
const MIN = 60000;
const sess = (activity, extra = {}) => ({ id: 's1', name: 'p', modelLabel: 'Opus 5', effort: 'high', contextPct: 10, activity, detail: activity, needsYou: false, lastEventAt: 0, ...extra });
const snap = (sessions = [], limits = {}, focusId) => ({
  v: 1, serverTime: 0, sessions,
  focusId: focusId === undefined ? (sessions[0] ? sessions[0].id : null) : focusId,
  limits: { status: 'ok', asOf: 0, fiveHour: null, week: null, fable: null, ...limits },
});
const five = pct => ({ fiveHour: { pct, resetsAt: T0 + 12 * MIN } });
const mid = () => 0.5;

test('starts idle; an unchanged snapshot yields no command', () => {
  const m = createMood({}, { rand: mid });
  assert.deepEqual(m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0), { base: 'idle', play: [], bubble: null, dim: false });
  assert.equal(m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0 + 10), null);
});

test('a prompt: surprised into thinking; the first prompt of the day adds love', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 1000),
    { base: 'thinking', play: ['surprised'], bubble: { text: 'Thinking…', tone: '' }, dim: false });
  assert.deepEqual(m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 1001).play, ['love', 'surprised']);
  m.onSnapshot(snap([sess('done')]), T0 + 5000);
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 10000);
  assert.equal(m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 10001), null);
});

test('reading, working and compiling use their animation and the detail as bubble', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0);
  let t = T0;
  for (const [act, detail] of [['reading', 'Reading a.js'], ['working', 'Editing b.js'], ['compiling', 'Running npm test']]) {
    t += 2000;
    const c = m.onSnapshot(snap([sess(act, { detail })]), t);
    assert.deepEqual(c, { base: act, play: [], bubble: { text: detail, tone: '' }, dim: false });
  }
});

test('sideways activity changes wait 1.5 s to stop flicker', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('reading', { detail: 'Reading a' })]), T0);
  const c = m.onSnapshot(snap([sess('working', { detail: 'Editing b' })]), T0 + 500);
  assert.deepEqual([c.base, c.bubble.text], ['reading', 'Editing b']);
  assert.equal(m.tick(T0 + 1600).base, 'working');
});

test('thinking for 8 s adds one curious; compiling for 8 s adds one look_left', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0);
  assert.equal(m.tick(T0 + 7500), null);
  assert.deepEqual(m.tick(T0 + 8000).play, ['curious']);
  assert.equal(m.tick(T0 + 9000), null);
  m.onSnapshot(snap([sess('compiling', { detail: 'Running npm test' })]), T0 + 10000);
  assert.deepEqual(m.tick(T0 + 18000).play, ['look_left']);
});

test('needs you: surprised and curious alternate with an amber bubble, then back to work', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'Editing a.js' })]), T0);
  const c = m.onSnapshot(snap([sess('working', { needsYou: true, detail: 'Needs permission' })]), T0 + 1000);
  assert.deepEqual(c.base, ['surprised', 'curious']);
  assert.deepEqual(c.bubble, { text: 'Needs permission', tone: 'need' });
  assert.equal(m.onSnapshot(snap([sess('compiling', { detail: 'Running npm test' })]), T0 + 5000).base, 'compiling');
});

test('stop: surprised, then happy eyes for 3 s, then idle', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  m.onSnapshot(snap([sess('done', { detail: 'Your turn' })]), T0 + 1000);
  assert.deepEqual(m.onEvent({ type: 'stop', sessionId: 's1' }, T0 + 1001),
    { base: 'happy_eyes', play: ['surprised'], bubble: { text: 'Your turn', tone: 'good' }, dim: false });
  assert.equal(m.tick(T0 + 3500), null);
  assert.deepEqual(m.tick(T0 + 4002), { base: 'idle', play: [], bubble: null, dim: false });
});

test('a background session finishing does not interrupt the focus session', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { id: 'A', detail: 'a' }), sess('done', { id: 'B' })], {}, 'A'), T0);
  assert.equal(m.onEvent({ type: 'stop', sessionId: 'B' }, T0 + 10), null);
});

test('limit moods while idle: 50 low (with surprised), 80 sad, 95 ending; activity wins', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')], five(40)), T0);
  assert.deepEqual(m.onSnapshot(snap([sess('done')], five(55)), T0 + 1000),
    { base: 'low_tokens', play: ['surprised'], bubble: { text: '5-hour at 55%', tone: '' }, dim: false });
  assert.equal(m.onSnapshot(snap([sess('done')], five(83)), T0 + 2000).base, 'sad');
  assert.equal(m.onSnapshot(snap([sess('done')], five(96)), T0 + 3000).base, 'ending');
  assert.equal(m.onSnapshot(snap([sess('working', { detail: 'x' })], five(96)), T0 + 4000).base, 'working');
});

test('100% or rate limited is overloaded, even while working', () => {
  const m = createMood({}, { rand: mid });
  const c = m.onSnapshot(snap([sess('working', { detail: 'x' })], five(100)), T0);
  assert.deepEqual([c.base, c.bubble], ['overloaded', { text: 'Limit reached · resets in 12m', tone: 'bad' }]);
  const r = createMood({}, { rand: mid }).onSnapshot(snap([sess('rateLimited', { detail: 'Rate limited' })]), T0);
  assert.deepEqual([r.base, r.bubble.text], ['overloaded', 'Rate limited']);
});

test('week or Fable near the cap only shows while idle', () => {
  const m = createMood({}, { rand: mid });
  assert.deepEqual(m.onSnapshot(snap([sess('done')], { week: { pct: 96, resetsAt: null } }), T0).bubble, { text: 'Week at 96%', tone: 'bad' });
  assert.equal(m.onSnapshot(snap([sess('done')], { fable: { pct: 100, resetsAt: null } }), T0 + 1).base, 'overloaded');
  assert.equal(m.onSnapshot(snap([sess('reading', { detail: 'r' })], { fable: { pct: 100, resetsAt: null } }), T0 + 2).base, 'reading');
});

test('a reset celebrates (jumping joy, happy, cool, idle) and waits while busy', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('done')], five(100)), T0);
  const c = m.onSnapshot(snap([sess('done')], five(2)), T0 + 1000);
  assert.deepEqual([c.base, c.play, c.bubble.text], ['happy', ['jumping_joy'], 'Fresh limits!']);
  assert.equal(m.tick(T0 + 1000 + 5700).base, 'cool');
  assert.equal(m.tick(T0 + 1000 + 13700).base, 'idle');

  const busy = createMood({}, { rand: mid });
  busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(40)), T0);
  assert.equal(busy.onSnapshot(snap([sess('working', { detail: 'x' })], five(3)), T0 + 1000), null);
  assert.deepEqual(busy.onSnapshot(snap([sess('done')], five(3)), T0 + 5000).play, ['jumping_joy']);
});

test('errors show for 5 s; the third in a row is angry; a prompt resets the count', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('error', { detail: 'Error' })]), T0);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 1).base, 'error');
  m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 2);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 3).base, 'angry');
  assert.equal(m.tick(T0 + 5004).base, 'idle');
  m.onEvent({ type: 'prompt', sessionId: 's1' }, T0 + 6000);
  assert.equal(m.onEvent({ type: 'error', sessionId: 's1' }, T0 + 7000).base, 'error');
});

test('quiet for sleepAfter: yawn, then sleep dimmed; activity wakes with yawn, surprised, love', () => {
  const m = createMood({ sleepAfterMin: 5 }, { rand: mid });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.equal(m.tick(T0 + 4 * MIN), null);
  assert.equal(m.tick(T0 + 5 * MIN).base, 'yawning');
  assert.deepEqual(m.tick(T0 + 5 * MIN + 2500), { base: 'sleeping', play: [], bubble: { text: 'Zzz…', tone: '' }, dim: true });
  const w = m.onSnapshot(snap([sess('thinking', { detail: 'Thinking…' })]), T0 + 6 * MIN);
  assert.deepEqual([w.base, w.play, w.dim], ['thinking', ['yawning', 'surprised', 'love'], false]);
});

test('tap plays a random reaction and wakes a sleeping companion', () => {
  const m = createMood({}, { rand: () => 0.1 });
  m.onSnapshot(snap([sess('done')]), T0);
  assert.deepEqual(m.onTap(T0 + 1).play, ['love']);
  const sleepy = createMood({ sleepAfterMin: 1 }, { rand: () => 0.9 });
  sleepy.onSnapshot(snap([sess('done')]), T0);
  sleepy.tick(T0 + MIN);
  sleepy.tick(T0 + MIN + 2500);
  const w = sleepy.onTap(T0 + MIN + 10000);
  assert.deepEqual([w.play, w.dim, w.bubble.text], [['yawning', 'surprised', 'love'], false, 'Good morning!']);
});

test('plenty left: a rare cool moment while idle', () => {
  const m = createMood({}, { rand: () => 0 });
  m.onSnapshot(snap([sess('done')], five(3)), T0);
  assert.equal(m.tick(T0 + 500).base, 'cool');
  assert.equal(m.tick(T0 + 8600).base, 'idle');
});

test('a pinned session overrides the server focus', () => {
  const m = createMood({ pinnedId: 'B' }, { rand: mid });
  const c = m.onSnapshot(snap([sess('working', { id: 'A', detail: 'a' }), sess('reading', { id: 'B', detail: 'b' })], {}, 'A'), T0);
  assert.deepEqual([c.base, c.bubble.text], ['reading', 'b']);
  m.setSettings({ pinnedId: null });
  assert.equal(m.tick(T0 + 2000).base, 'working');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/mood.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/web/mood.js`**

```js
import { formatReset } from './format.js';

// The companion's state machine (spec §7), adapted from clawdio's state_machine.cpp (cegware/clawdio, MIT).
export const DEFAULT_MOOD = { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null };

const ACTIVE = new Set(['thinking', 'reading', 'working', 'compiling']);
const IDLEISH = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding', 'weekOver', 'done', 'cool', 'celebrate', 'sleep', 'yawn', 'wake', 'error']);
const QUIET = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding']);
const DWELL_MS = 1500;
const pctOf = w => (w && Number.isFinite(w.pct) ? w.pct : null);
const dayOf = t => new Date(t).toDateString();

export function createMood(settings = {}, { rand = Math.random } = {}) {
  let S = { ...DEFAULT_MOOD, ...settings };
  let snap = null;
  let lastKey = null;
  const st = {
    mode: null, since: 0, escalated: false, lastActiveAt: null, asleep: false,
    transient: null, plays: [], errors: 0, loveDay: null, pendingCelebrate: false,
  };

  const init = now => { if (st.lastActiveAt === null) { st.lastActiveAt = now; st.since = now; } };
  const touch = now => { st.lastActiveAt = now; };
  const live = now => (st.transient && st.transient.until > now ? st.transient : null);

  function focus() {
    if (!snap) return null;
    const id = S.pinnedId && snap.sessions.some(s => s.id === S.pinnedId) ? S.pinnedId : snap.focusId;
    return snap.sessions.find(s => s.id === id) || null;
  }
  const busy = f => !!f && (ACTIVE.has(f.activity) || f.needsYou);

  function target(now) {
    const f = focus();
    const L = (snap && snap.limits) || {};
    const p5 = pctOf(L.fiveHour);
    const pw = pctOf(L.week);
    const pf = pctOf(L.fable);
    if ((p5 !== null && p5 >= 100) || (f && f.activity === 'rateLimited')) {
      const text = p5 !== null && p5 >= 100 ? `Limit reached · resets in ${formatReset(L.fiveHour.resetsAt, now) || 'soon'}` : 'Rate limited';
      return { mode: 'overloaded', base: 'overloaded', bubble: { text, tone: 'bad' } };
    }
    if (f && f.needsYou) return { mode: 'needs', base: ['surprised', 'curious'], bubble: { text: f.detail || 'Needs you', tone: 'need' } };
    const tr = live(now);
    if (tr && tr.kind === 'done') return { mode: 'done', base: 'happy_eyes', bubble: { text: 'Your turn', tone: 'good' } };
    if (tr && (tr.kind === 'error' || tr.kind === 'angry')) return { mode: 'error', base: tr.kind, bubble: { text: 'Error', tone: 'bad' } };
    if (f && ACTIVE.has(f.activity)) return { mode: f.activity, base: f.activity, bubble: f.detail ? { text: f.detail, tone: '' } : null };
    if (tr && tr.kind === 'wake') return { mode: 'wake', base: 'idle', bubble: { text: tr.greet, tone: 'good' } };
    if (tr && tr.kind === 'celebrate') {
      return now - tr.since < 5640
        ? { mode: 'celebrate', base: 'happy', bubble: { text: 'Fresh limits!', tone: 'good' } }
        : { mode: 'cool', base: 'cool', bubble: null };
    }
    if (tr && tr.kind === 'cool') return { mode: 'cool', base: 'cool', bubble: null };
    if (tr && tr.kind === 'yawn') return { mode: 'yawn', base: 'yawning', bubble: null };
    if (st.asleep) return { mode: 'sleep', base: 'sleeping', bubble: { text: 'Zzz…', tone: '' }, dim: true };
    const wOver = pw !== null && pw >= 100;
    const fOver = pf !== null && pf >= 100;
    if (wOver || fOver) return { mode: 'weekOver', base: 'overloaded', bubble: { text: `${wOver ? 'Week' : 'Fable'} limit reached`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.crit) return { mode: 'ending', base: 'ending', bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    const wEnd = pw !== null && pw >= 95;
    const fEnd = pf !== null && pf >= 95;
    if (wEnd || fEnd) return { mode: 'weekEnding', base: 'ending', bubble: { text: wEnd ? `Week at ${pw}%` : `Fable at ${pf}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.low) return { mode: 'sad', base: 'sad', bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.warn) return { mode: 'low', base: 'low_tokens', bubble: { text: `5-hour at ${p5}%`, tone: '' } };
    return { mode: 'idle', base: 'idle', bubble: null };
  }

  function entryPlays(prev, next) {
    if (prev !== null && (next === 'thinking' || next === 'working') && IDLEISH.has(prev)) return ['surprised'];
    if (next === 'low' && prev === 'idle') return ['surprised'];
    return [];
  }

  function out(now) {
    let t = target(now);
    if (ACTIVE.has(t.mode) && ACTIVE.has(st.mode) && t.mode !== st.mode && now - st.since < DWELL_MS) {
      t = { ...t, mode: st.mode, base: st.mode }; // hold the animation, still update the bubble
    }
    const play = st.plays;
    st.plays = [];
    if (t.mode !== st.mode) {
      if (!play.length) play.push(...entryPlays(st.mode, t.mode));
      st.mode = t.mode;
      st.since = now;
      st.escalated = false;
    }
    const dim = !!t.dim;
    const key = JSON.stringify([t.base, t.bubble, dim]);
    if (key === lastKey && !play.length) return null;
    lastKey = key;
    return { base: t.base, play, bubble: t.bubble, dim };
  }

  function wake(now) {
    if (!st.asleep && !(st.transient && st.transient.kind === 'yawn')) return false;
    const newDay = st.loveDay !== dayOf(now);
    st.asleep = false;
    st.loveDay = dayOf(now);
    st.transient = { kind: 'wake', since: now, until: now + 2900, greet: newDay ? 'Good morning!' : 'Hi!' };
    st.plays = ['yawning', 'surprised', 'love'];
    return true;
  }

  function maybeCelebrate(now) {
    if (!st.pendingCelebrate || busy(focus())) return;
    st.pendingCelebrate = false;
    st.asleep = false;
    st.transient = { kind: 'celebrate', since: now, until: now + 13640 };
    st.plays = ['jumping_joy'];
  }

  return {
    onSnapshot(s, now) {
      init(now);
      const prev = snap && snap.limits;
      snap = s;
      if (busy(focus())) { touch(now); wake(now); }
      if (prev && s.limits) {
        for (const k of ['fiveHour', 'week', 'fable']) {
          const a = pctOf(prev[k]);
          const b = pctOf(s.limits[k]);
          if (a !== null && b !== null && a >= 20 && b < 10) st.pendingCelebrate = true;
        }
      }
      maybeCelebrate(now);
      return out(now);
    },

    onEvent(ev, now) {
      init(now);
      const f = focus();
      switch (ev.type) {
        case 'prompt':
          touch(now);
          st.errors = 0;
          if (st.transient && ['done', 'error', 'angry'].includes(st.transient.kind)) st.transient = null;
          if (!wake(now) && st.loveDay !== dayOf(now)) { st.loveDay = dayOf(now); st.plays = ['love', 'surprised']; }
          break;
        case 'stop':
          touch(now);
          st.errors = 0;
          if (!f || f.id === ev.sessionId || !busy(f)) { st.transient = { kind: 'done', since: now, until: now + 3000 }; st.plays = ['surprised']; }
          break;
        case 'error':
          touch(now);
          st.errors += 1;
          st.transient = { kind: st.errors >= 3 ? 'angry' : 'error', since: now, until: now + 5000 };
          break;
        case 'sessionStart':
          touch(now);
          if (!wake(now) && !busy(f)) st.plays = ['curious'];
          break;
        case 'needsYou':
        case 'rateLimited':
          touch(now);
          wake(now);
          break;
        default:
          break;
      }
      return out(now);
    },

    onTap(now) {
      init(now);
      touch(now);
      if (!wake(now)) st.plays = [['love', 'surprised', 'curious'][Math.floor(rand() * 3) % 3]];
      return out(now);
    },

    tick(now) {
      init(now);
      if (st.transient && st.transient.until <= now) {
        const kind = st.transient.kind;
        st.transient = null;
        if (kind === 'yawn') st.asleep = true;
      }
      maybeCelebrate(now);
      if (!st.escalated && now - st.since >= 8000 && (st.mode === 'thinking' || st.mode === 'compiling')) {
        st.escalated = true;
        st.plays = [st.mode === 'thinking' ? 'curious' : 'look_left'];
      }
      if (st.mode === 'idle' && !st.transient) {
        const p5 = pctOf(snap && snap.limits && snap.limits.fiveHour);
        if (p5 !== null && p5 <= 5 && rand() < 1 / 1200) st.transient = { kind: 'cool', since: now, until: now + 8000 };
      }
      if (QUIET.has(st.mode) && !st.asleep && !st.transient && now - st.lastActiveAt >= S.sleepAfterMin * 60000) {
        st.transient = { kind: 'yawn', since: now, until: now + 2500 };
      }
      return out(now);
    },

    setSettings(partial) { S = { ...S, ...partial }; },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/mood.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/mood.js test/mood.test.mjs
git commit -m "feat: companion state machine adapted from clawdio" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Put the creature on the page

**Files:**
- Modify: `src/web/mood.js` (add `setOffline`), `src/web/app.js`
- Test: `test/mood.test.mjs` (one new test)

**Interfaces:**
- Consumes:
  - `Player` (Task 13)
  - `createMood` (Task 14)
  - `SHEETS`, `FRAME_SIZE` (Task 11)
  - `/web/sprites/<sheet>.png` (Task 12)
- Produces:
  - `mood.setOffline(isOffline, now): Command | null`. While offline the creature sleeps: base `sleeping`, no bubble, no dim.
  - In `app.js`: `settings` (defaults here; Task 16 loads it from storage), `mood`, `player`, `apply(cmd)`.

- [ ] **Step 1: Add the failing test** to the end of `test/mood.test.mjs`:

```js
test('offline: the companion sleeps until the connection returns', () => {
  const m = createMood({}, { rand: mid });
  m.onSnapshot(snap([sess('working', { detail: 'x' })]), T0);
  assert.deepEqual(m.setOffline(true, T0 + 1), { base: 'sleeping', play: [], bubble: null, dim: false });
  assert.equal(m.setOffline(false, T0 + 2).base, 'working');
});
```

Run: `node --test test/mood.test.mjs`
Expected: FAIL with `m.setOffline is not a function`.

- [ ] **Step 2: Implement `setOffline` in `src/web/mood.js`**

After `let lastKey = null;` add:
```js
  let offline = false;
```
Make this the first line of `target(now)`:
```js
    if (offline) return { mode: 'offline', base: 'sleeping', bubble: null, dim: false };
```
Add this method next to `setSettings`:
```js
    setOffline(value, now) {
      init(now);
      offline = !!value;
      return out(now);
    },
```

Run: `node --test test/mood.test.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 3: Wire mood and player into `src/web/app.js`**

Add these imports below the existing `format.js` import:
```js
import { Player } from './mascot.js';
import { createMood } from './mood.js';
import { SHEETS, FRAME_SIZE } from './anims.js';
```

Add this block after the `let downSince = null;` line:
```js
// ---------- companion ----------
const settings = { mood: {}, idle: {} }; // Task 16 loads these from storage
const mood = createMood(settings.mood);
const player = new Player({ idle: settings.idle });
const ctx = $('mascot').getContext('2d');
const IMG = Object.fromEntries(SHEETS.map(s => {
  const img = new Image();
  img.src = `/web/sprites/${s}.png${location.search}`;
  return [s, img];
}));
let drawPending = true;

function draw() {
  const f = player.frame();
  const img = IMG[f.sheet];
  if (!img.complete || !img.naturalWidth) { drawPending = true; return; }
  drawPending = false;
  ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
  ctx.drawImage(img, f.index * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE, 0, 0, FRAME_SIZE, FRAME_SIZE);
}

function apply(cmd) {
  if (!cmd) return;
  player.setBase(cmd.base);
  if (cmd.play.length) player.play(cmd.play);
  setBubble(cmd.bubble && cmd.bubble.text, cmd.bubble && cmd.bubble.tone);
  $('app').classList.toggle('dim', cmd.dim);
}

let lastFrameAt = performance.now();
function loop(now) {
  const dt = Math.min(100, now - lastFrameAt);
  lastFrameAt = now;
  if (player.update(dt) || drawPending) draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => apply(mood.tick(Date.now())), 500);
$('mascot').addEventListener('click', () => apply(mood.onTap(Date.now())));
```

Hand the bubble to the companion:
- Delete the whole `renderBubble` function and its comment.
- Change `render()` to call only `renderRings(); renderSessions();`.
- Replace `function onEvent(ev) { /* Task 15: companion reactions */ }` with:
```js
function onEvent(ev) { apply(mood.onEvent(ev, Date.now())); }
```
- In `connect()`, change the `snapshot` listener to:
```js
  es.addEventListener('snapshot', e => {
    snap = JSON.parse(e.data);
    skew = snap.serverTime - Date.now();
    seen();
    render();
    apply(mood.onSnapshot(snap, Date.now()));
  });
```

Make the offline watchdog tell the companion. Replace the `setInterval(() => { … $('offline').hidden = … }, 1000);` block with:
```js
let offline = false;
setInterval(() => {
  const now = Date.now();
  const down = (downSince !== null && now - downSince > 5000) || now - lastMsgAt > 45000;
  $('offline').hidden = !down;
  if (down !== offline) {
    offline = down;
    apply(mood.setOffline(down, now));
  }
}, 1000);
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: MILESTONE 2: check the creature on the phone**

Restart the repo server (`node bin/server.mjs --stop && node bin/pair.mjs`), reload the phone, then:
1. Run `node tools/fake-events.mjs turn`. Expect a startled "!" into thinking with the "Thinking…" bubble, reading, typing, the "!"/head-tilt with an amber bubble at "Needs permission", compiling, then happy eyes and "Your turn". Between moves the calm idle holds still, blinks and glances.
2. Run `node tools/fake-events.mjs limits`. Expect tired (battery), sad, alarm, overloaded (red, bubble "Limit reached · resets in …"), then jumping joy, happy, sunglasses.
3. Tap the creature: hearts, a start, or a head tilt.
4. Run `node tools/fake-events.mjs idle` and wait 5 minutes: it yawns, sleeps, and the screen dims. Then run `node tools/fake-events.mjs wake`: yawn, start, hearts.
5. Stop the server: after about 5 s you see "PC offline — waiting…" and the creature asleep behind it. Start it again: it recovers.
6. Check the sprite has no visible square: the black background blends into the stage through `mix-blend-mode: lighten`.

- [ ] **Step 6: Commit**

```bash
git add src/web/mood.js src/web/app.js test/mood.test.mjs
git commit -m "feat: animated companion on the dashboard" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Controls, settings, full screen, keep-awake

**Files:**
- Create: `src/web/settings.js`, `src/web/manifest.webmanifest`, `src/web/vendor/NoSleep.min.js` (downloaded), `src/web/vendor/LICENSE-nosleep.txt`
- Modify: `src/web/index.html` (full replacement below), `src/web/style.css` (append), `src/web/app.js`
- Test: `test/settings.test.mjs`

**Interfaces:**
- Consumes: `mood.setSettings`, `player.setIdle`, `apply`, `snap`, `esc`, `$` (Tasks 7, 13–15).
- Produces:
  - `STORAGE_KEY`, `DEFAULTS`
  - `validate(s): Settings`
  - `loadSettings(storage): Settings`
  - `saveSettings(storage, s): Settings`, which returns the validated value
  - `nextRotation(deg)`
  - `rotationFor(deg, W, H): {w, h, layout}`
  - `Settings = {mood: {warn, low, crit, sleepAfterMin, pinnedId}, idle: {blinksPerMin, glancesPerMin, movingPct}, rotation: 0|90|180|270, keepAwake: boolean}`

- [ ] **Step 1: Write the failing test** `test/settings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSettings, saveSettings, rotationFor, nextRotation, STORAGE_KEY } from '../src/web/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEF = {
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0, keepAwake: true,
};

test('defaults', () => {
  assert.deepEqual(validate({}), DEF);
  assert.deepEqual(validate(null), DEF);
});

test('clamps values and keeps thresholds ordered', () => {
  const v = validate({
    mood: { warn: 90, low: 50, crit: 10, sleepAfterMin: 0, pinnedId: 's9' },
    idle: { blinksPerMin: 999, glancesPerMin: -1, movingPct: 'x' },
    rotation: 45, keepAwake: false,
  });
  assert.deepEqual(v.mood, { warn: 90, low: 90, crit: 90, sleepAfterMin: 1, pinnedId: 's9' });
  assert.deepEqual(v.idle, { blinksPerMin: 60, glancesPerMin: 0, movingPct: 50 });
  assert.equal(v.rotation, 0);
  assert.equal(v.keepAwake, false);
  assert.deepEqual(validate({ mood: { warn: '', low: null } }).mood.warn, 50);
});

test('load and save through a storage; bad JSON gives defaults', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSettings(storage), DEF);
  const saved = saveSettings(storage, { ...DEF, rotation: 90, idle: { blinksPerMin: '30', glancesPerMin: 3, movingPct: 40 } });
  assert.deepEqual(saved.idle, { blinksPerMin: 30, glancesPerMin: 3, movingPct: 40 });
  assert.deepEqual(loadSettings(storage), saved);
  mem.set(STORAGE_KEY, '{nope');
  assert.deepEqual(loadSettings(storage), DEF);
  assert.deepEqual(loadSettings(null), DEF);
});

test('rotation geometry', () => {
  assert.deepEqual(rotationFor(0, 390, 844), { w: 390, h: 844, layout: 'portrait' });
  assert.deepEqual(rotationFor(90, 390, 844), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual(rotationFor(180, 844, 390), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual([0, 90, 180, 270].map(nextRotation), [90, 180, 270, 0]);
});

test('web manifest keeps the tokenised start URL (no start_url) and uses the icon', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/web/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.start_url, undefined);
  assert.equal(m.icons[0].src, '/web/icon.png');
});
```

Run: `node --test test/settings.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement `src/web/settings.js`**

```js
// Phone-side settings (spec §6), kept in localStorage.
export const STORAGE_KEY = 'desk-companion.settings.v1';
export const DEFAULTS = Object.freeze({
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0,
  keepAwake: true,
});

const num = (v, lo, hi, d) => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function validate(s) {
  const src = s && typeof s === 'object' ? s : {};
  const m = src.mood || {};
  const i = src.idle || {};
  const warn = num(m.warn, 1, 99, 50);
  const low = Math.max(warn, num(m.low, 1, 99, 80));
  const crit = Math.max(low, num(m.crit, 1, 100, 95));
  return {
    mood: { warn, low, crit, sleepAfterMin: num(m.sleepAfterMin, 1, 120, 5), pinnedId: typeof m.pinnedId === 'string' && m.pinnedId ? m.pinnedId : null },
    idle: { blinksPerMin: num(i.blinksPerMin, 0, 60, 26), glancesPerMin: num(i.glancesPerMin, 0, 20, 2), movingPct: num(i.movingPct, 5, 95, 50) },
    rotation: [0, 90, 180, 270].includes(Number(src.rotation)) ? Number(src.rotation) : 0,
    keepAwake: src.keepAwake !== false,
  };
}

export function loadSettings(storage) {
  try {
    return validate(JSON.parse((storage && storage.getItem(STORAGE_KEY)) || '{}'));
  } catch {
    return validate({});
  }
}

export function saveSettings(storage, s) {
  const v = validate(s);
  try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private mode or full */ }
  return v;
}

export const nextRotation = deg => (deg + 90) % 360;

// Size #app so that, rotated by `deg`, it exactly covers a W x H screen.
export function rotationFor(deg, W, H) {
  const turned = deg % 180 !== 0;
  const w = turned ? H : W;
  const h = turned ? W : H;
  return { w, h, layout: w >= h ? 'landscape' : 'portrait' };
}
```

- [ ] **Step 3: Create `src/web/manifest.webmanifest`**

It deliberately has no `start_url`, so "Add to Home Screen" keeps the page URL with its `?k=` token.
```json
{
  "name": "desk-companion",
  "short_name": "Companion",
  "display": "fullscreen",
  "orientation": "any",
  "background_color": "#000000",
  "theme_color": "#0a0a0f",
  "icons": [{ "src": "/web/icon.png", "sizes": "256x256", "type": "image/png" }]
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/settings.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Vendor NoSleep** (MIT, pinned)

```bash
curl -sL https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/dist/NoSleep.min.js -o src/web/vendor/NoSleep.min.js
curl -sL https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/LICENSE -o src/web/vendor/LICENSE-nosleep.txt
head -c 300 src/web/vendor/LICENSE-nosleep.txt
```
Expected: the licence begins with "The MIT License". If the second download is empty or HTML, write the standard MIT text there instead, attributed to "Rich Tibbett", with the line `Source: https://github.com/richtr/NoSleep.js (npm nosleep.js@0.12.0)`.

- [ ] **Step 6: Replace `src/web/index.html`**

This adds the manifest and icon, and puts the overlays and settings panel inside `#app` so they rotate with it.
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0a0a0f">
  <title>desk-companion</title>
  <link rel="manifest" href="/web/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/web/icon.png">
  <link rel="stylesheet" href="/web/style.css">
</head>
<body>
  <main id="app" class="landscape">
    <section class="stage">
      <div id="bubble" class="bubble"></div>
      <canvas id="mascot" width="256" height="256"></canvas>
    </section>
    <section class="data">
      <div id="rings" class="rings"></div>
      <div id="limitsNote" class="note"></div>
      <div id="sessions" class="sessions"></div>
    </section>
    <nav class="controls">
      <button id="btnClose" aria-label="Close">✕</button>
      <button id="btnRotate" aria-label="Rotate">⟲</button>
      <button id="btnSettings" aria-label="Settings">⚙</button>
    </nav>
    <div id="offline" class="overlay" hidden><p>PC offline — waiting…</p></div>
    <div id="blank" class="overlay blank" hidden></div>
    <form id="settings" class="panel" hidden>
      <h2>Settings</h2>
      <fieldset><legend>Mood (5-hour limit %)</legend>
        <label>Tired at <input name="warn" type="number" min="1" max="99"></label>
        <label>Sad at <input name="low" type="number" min="1" max="99"></label>
        <label>Alarm at <input name="crit" type="number" min="1" max="100"></label>
      </fieldset>
      <fieldset><legend>Idle</legend>
        <label>Blinks per minute <input name="blinksPerMin" type="number" min="0" max="60"></label>
        <label>Glances per minute <input name="glancesPerMin" type="number" min="0" max="20"></label>
        <label>% of time moving <input name="movingPct" type="number" min="5" max="95"></label>
        <label>Sleep after (minutes) <input name="sleepAfterMin" type="number" min="1" max="120"></label>
      </fieldset>
      <fieldset><legend>Follow session</legend><select name="pinnedId"></select></fieldset>
      <label class="check"><input name="keepAwake" type="checkbox"> Keep the screen awake</label>
      <p class="hint">iPhone: Share → Add to Home Screen opens this full screen. If the screen still locks, set Settings → Display &amp; Brightness → Auto-Lock → Never. Android: Developer options → Stay awake while charging.</p>
      <button type="button" id="settingsDone">Done</button>
    </form>
  </main>
  <script src="/web/vendor/NoSleep.min.js"></script>
  <script type="module" src="/web/app.js"></script>
</body>
</html>
```

- [ ] **Step 7: Append to `src/web/style.css`**

```css
.overlay.blank { background: #000; }
.panel {
  position: fixed; z-index: 60; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(92%, 420px); max-height: 90%; overflow: auto;
  background: #14141c; border: 1px solid #2c2c38; border-radius: 16px; padding: 18px 20px; font-size: 15px;
}
.panel[hidden] { display: none; }
.panel h2 { font-size: 18px; margin-bottom: 10px; }
.panel fieldset { border: 1px solid #2c2c38; border-radius: 10px; padding: 8px 12px 10px; margin-bottom: 10px; }
.panel legend { color: var(--dim); font-size: 13px; padding: 0 4px; }
.panel label { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 6px 0; }
.panel input[type=number] { width: 90px; background: #0a0a0f; color: var(--text); border: 1px solid #2c2c38; border-radius: 6px; padding: 4px 6px; font-size: 15px; }
.panel select { width: 100%; background: #0a0a0f; color: var(--text); border: 1px solid #2c2c38; border-radius: 6px; padding: 6px; font-size: 15px; }
.panel .check { justify-content: flex-start; }
.panel .hint { color: var(--dim); font-size: 12px; line-height: 1.4; margin: 8px 0 12px; }
.panel button { width: 100%; padding: 10px; border-radius: 10px; border: 0; background: #2d6cdf; color: #fff; font-size: 15px; }
```

- [ ] **Step 8: Wire controls and settings into `src/web/app.js`**

Add the import:
```js
import { loadSettings, saveSettings, rotationFor, nextRotation } from './settings.js';
```
Replace the line `const settings = { mood: {}, idle: {} }; // Task 16 loads these from storage` with:
```js
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let settings = loadSettings(store);
```
Insert this block just above the final `render();` and `connect();` lines:
```js
// ---------- controls ----------
function applyLayout() {
  const { w, h, layout } = rotationFor(settings.rotation, window.innerWidth, window.innerHeight);
  const app = $('app');
  app.style.setProperty('--w', `${w}px`);
  app.style.setProperty('--h', `${h}px`);
  app.style.setProperty('--rot', `${settings.rotation}deg`);
  app.classList.toggle('landscape', layout === 'landscape');
  app.classList.toggle('portrait', layout === 'portrait');
}
window.addEventListener('resize', applyLayout);
applyLayout();

$('btnRotate').addEventListener('click', e => {
  e.stopPropagation();
  settings = saveSettings(store, { ...settings, rotation: nextRotation(settings.rotation) });
  applyLayout();
});

$('btnClose').addEventListener('click', e => {
  e.stopPropagation();
  $('blank').hidden = false; // a page can't close itself on iOS: blank the screen until tapped
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
$('blank').addEventListener('click', () => { $('blank').hidden = true; });

const noSleep = window.NoSleep ? new window.NoSleep() : null;
const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
document.addEventListener('click', () => {
  const el = document.documentElement;
  if (!standalone && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  if (settings.keepAwake && noSleep && !noSleep.isEnabled) Promise.resolve(noSleep.enable()).catch(() => {});
});

const form = $('settings');
function fillSettings() {
  const f = form.elements;
  for (const k of ['warn', 'low', 'crit', 'sleepAfterMin']) f[k].value = settings.mood[k];
  for (const k of ['blinksPerMin', 'glancesPerMin', 'movingPct']) f[k].value = settings.idle[k];
  f.keepAwake.checked = settings.keepAwake;
  const sessions = snap ? snap.sessions : [];
  f.pinnedId.innerHTML = '<option value="">Automatic</option>'
    + sessions.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}</option>`).join('');
  f.pinnedId.value = settings.mood.pinnedId || '';
}
function readSettings() {
  const f = form.elements;
  settings = saveSettings(store, {
    ...settings,
    mood: { warn: f.warn.value, low: f.low.value, crit: f.crit.value, sleepAfterMin: f.sleepAfterMin.value, pinnedId: f.pinnedId.value || null },
    idle: { blinksPerMin: f.blinksPerMin.value, glancesPerMin: f.glancesPerMin.value, movingPct: f.movingPct.value },
    keepAwake: f.keepAwake.checked,
  });
  mood.setSettings(settings.mood);
  player.setIdle(settings.idle);
  if (!settings.keepAwake && noSleep && noSleep.isEnabled) noSleep.disable();
  apply(mood.tick(Date.now()));
}
$('btnSettings').addEventListener('click', e => { e.stopPropagation(); fillSettings(); form.hidden = false; });
form.addEventListener('change', readSettings);
$('settingsDone').addEventListener('click', () => { form.hidden = true; fillSettings(); });

// Burn-in protection: shift the whole layout by up to 4 px every 10 minutes.
setInterval(() => {
  const app = $('app');
  app.style.setProperty('--dx', `${Math.round(Math.random() * 8 - 4)}px`);
  app.style.setProperty('--dy', `${Math.round(Math.random() * 8 - 4)}px`);
}, 10 * 60000);
```

- [ ] **Step 9: Run the whole suite**

Run: `node --test`
Expected: PASS.

- [ ] **Step 10: Check it on the phone**

1. ⟲ cycles through four orientations. With iPhone rotation lock on and the phone on its side, one of them reads correctly and fills the screen.
2. ✕ blanks the screen; a tap brings it back. On Android it also leaves full screen.
3. ⚙ opens the panel. Change blinks to 10: the idle visibly calms. Set "Sleep after" to 1: it sleeps after 1 minute. Pin a session: the creature and bubble follow it. The values survive a reload.
4. Android: the first tap goes full screen. iPhone: Share → Add to Home Screen, then open from the icon; it runs without browser bars and keeps the token.
5. Keep-awake: leave the phone untouched for longer than its auto-lock time. If it still locks over plain HTTP, record the result in the spec's risk 4 and use the Auto-Lock → Never hint.

- [ ] **Step 11: Commit**

```bash
git add src/web/settings.js src/web/manifest.webmanifest src/web/vendor/NoSleep.min.js src/web/vendor/LICENSE-nosleep.txt src/web/index.html src/web/style.css src/web/app.js test/settings.test.mjs
git commit -m "feat: close, rotate, settings panel, full screen and keep-awake" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: README, final verification, record results

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-14-desk-companion-design.md` (risks section, with the results)

- [ ] **Step 1: Write `README.md`**

````markdown
# desk-companion

A Claude Code plugin that turns a phone on your desk into a live dashboard: your 5-hour, weekly and Fable limits, every active Claude Code session (model, effort, context, what it's doing), and an animated companion that reacts to it all.

The plugin runs a small web server on your PC. Any phone or tablet browser on the same Wi-Fi opens the page. No app store, no account, no cloud.

Independent project, not affiliated with Anthropic.

## Requirements

- Claude Code (terminal CLI and/or the desktop app's Code tab) on the PC
- Node 18 or later
- For limits: the Claude Code CLI on PATH, signed in with your claude.ai account (`claude auth login`). The desktop app's sign-in isn't shared with the CLI.

## Install

```bash
claude plugin marketplace add C:/Users/weazo/GitHub/my_claude_companion
claude plugin install desk-companion@desk-companion
```

Restart your Claude Code sessions so the hooks load. The first time the server starts, Windows asks whether Node may accept connections: allow **Private networks**.

## Pair your phone

In Claude Code run `/desk-companion:pair`, or run `node bin/pair.mjs` in this folder. A QR code opens in your PC's browser; scan it with the phone.

- **iPhone:** Share → Add to Home Screen, then open it from the icon for full screen.
- **Android:** the first tap goes full screen.

## On the phone

- **✕** blanks the screen until you tap it (night mode).
- **⟲** turns the layout 90° at a time, so it works with rotation lock on.
- **⚙** sets mood thresholds, how lively the idle is, when it sleeps, which session to follow, and keep-awake.

If the screen still locks, use iPhone Settings → Display & Brightness → Auto-Lock → Never, or Android Developer options → Stay awake while charging.

## Privacy

The phone sees project folder names, model, effort, context %, tool names, file names and the first safe words of shell commands. It never sees prompts, file contents or command arguments. The plugin never reads your Claude credentials; limits come from Claude Code's own `get_usage`. The page is plain HTTP on your LAN, protected by a random token in the link.

## Development

```bash
node --test                                # all tests
node bin/server.mjs --stop && node bin/pair.mjs   # restart the server from this folder
node tools/fake-events.mjs turn            # also: limits, idle, wake, end
node tools/build-sprites.mjs --check       # verify the committed sprites
```

The installed plugin runs from Claude Code's plugin cache, but its hooks talk to whichever server is running. Server and page changes therefore only need the restart above.
- After changing `bin/hook.mjs`, `src/hook/*` or `hooks/hooks.json`, bump `version` in `package.json` and `.claude-plugin/plugin.json`, run `claude plugin marketplace update desk-companion && claude plugin update desk-companion@desk-companion`, and restart Claude Code.
- Logs: `~/.desk-companion/server.log` and `hook.log`. Config (port and token): `~/.desk-companion/config.json`.

## Credits and licences

- Companion sprites and behaviour are adapted from [clawdio](https://github.com/cegware/clawdio) by cegware (MIT); see `src/web/sprites/LICENSE-clawdio.txt`. The artwork is AI-generated and resembles Anthropic's Clawd mascot, so it's fine for personal use. Replace it before publishing this plugin anywhere.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT).
- [NoSleep.js](https://github.com/richtr/NoSleep.js) by Rich Tibbett (MIT).

MIT licence; see `LICENSE`.
````

- [ ] **Step 2: Full verification**

Run: `node --test`
Expected: every test passes, with no failures and no skipped tests.

Run: `node tools/build-sprites.mjs --check`
Expected: 21 × `ok`, exit code 0.

- [ ] **Step 3: On-device checklist** (spec §Testing), with the plugin installed and real Claude Code sessions:
1. Pair via `/desk-companion:pair` and the QR code.
2. Full screen from the iPhone Home Screen, and on Android.
3. Rotate with rotation lock on.
4. Close and the blank overlay.
5. Keep-awake.
6. The offline overlay, then recovery.
7. Real limits with countdowns, including the Fable ring.
8. A session in the **desktop app's Code tab** appears.
9. A session in the **terminal CLI** appears.

- [ ] **Step 4: Record the results in the spec**

In the spec's "Risks to verify early" section, replace items 3 and 4 with what was observed: does the desktop app load the plugin, does Home Screen full screen work, and does keep-awake hold over HTTP on the user's iPhone. Update item 1 with whether `model_scoped` lists Fable. Keep each entry to one or two sentences.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-14-desk-companion-design.md
git commit -m "docs: README and recorded on-device results" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

