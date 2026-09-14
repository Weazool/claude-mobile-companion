# desk-companion — Design Spec

## Overview

A Claude Code plugin that turns a phone on a desk stand into a live dashboard for Claude Code. The plugin runs a small web server on the PC. Any phone or tablet browser on the same Wi-Fi opens one page, which goes full screen and shows:

- the account's **5-hour, weekly and Fable limits** (percent used and reset countdown);
- every **active Claude Code session** (project, model, effort, context fill, what it is doing);
- an **animated companion** that mirrors Claude's activity, asks for attention, reacts to limits and has an idle life.

Updates are pushed the moment a Claude Code hook fires. No app store, no Apple account, no cloud.

Working name: `desk-companion`; it avoids "Claude" in the product name for trademark reasons. The repo lives in this folder, `my_claude_companion`.

## Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Delivery | Web page served by the plugin on the LAN; no native app, no widgets |
| Devices | Any modern mobile browser (iOS Safari, Android Chrome/Firefox) |
| Reach | Same Wi-Fi only |
| Sessions tracked | Claude desktop app (Code tab) and terminal CLI on this Windows PC |
| Plan | Max: show limits, not cost |
| Metrics | 5-hour limit, weekly limit, Fable weekly limit, per-session model, effort, context |
| Layout | "A · Companion stage": creature on the left 40%, rings and session list on the right; portrait variant stacks them |
| Controls | Close, Rotate, Settings |
| Animations | clawdio sprites and state machine (cegware/clawdio, MIT), adapted to our events |
| Idle pace | Calmer idle: 26 blinks/min, 2 glances/min, moving 50% of the time |
| Relationship to clauled | Independent; it neither uses nor touches clauled or its status-line shim |
| Status line | Not used, so no install step and no conflict with other status-line users |

## Architecture

```
Claude Code (desktop app + CLI)
  │  hooks: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, StopFailure
  ▼
bin/hook.mjs  (one short-lived process per hook; ≤300 ms; never blocks or fails a hook)
  │  HTTP POST 127.0.0.1:<port>/api/hook  (header: x-dc-token)
  ▼
bin/server.mjs  (one background Node process per user; no npm dependencies)
  ├─ sessions   – per-session state built from hook events + transcript tail
  ├─ limits     – polls Claude Code's get_usage for 5h / week / Fable
  ├─ snapshot   – merges both, pushes to every open page over Server-Sent Events
  └─ http       – serves the page, sprites, SSE stream, pairing page with QR code
  ▼
Phone browser:  src/web/index.html
  ├─ app.js     – SSE client, layout, rings, session list, controls, settings
  ├─ mood.js    – the companion's state machine (pure module, unit-tested)
  └─ mascot.js  – sprite player (clawdio timings) + calm idle scheduler
```

Division of work: the server sends **facts** (sessions, limits, discrete events). The page decides **behaviour** (which animation, when to sleep, what the bubble says). All creature logic therefore lives in one tested module, `mood.js`.

## Components

### 1. Hook forwarder: `bin/hook.mjs`

Registered in `hooks/hooks.json` as a `command` hook for each event listed above:
`node "${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs"`.

It does the following:
- Reads the hook JSON from stdin and adds `receivedAt` (epoch ms) and `envEffort` (`process.env.CLAUDE_EFFORT`, if set).
- **Sanitises before sending.** It forwards only `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `model`, `effort`, `tool_name`, a derived `target`, `notification_type`, `error`, `source`, and `permission_mode` when present. The `target` is the basename of `tool_input.file_path` / `notebook_path` / `path`, or for Bash the first two words of the command. Those words are kept only if they match `^[\w.\-/]+$`, and are capped at 24 characters. Prompts, tool inputs and tool outputs are never forwarded.
- Reads `~/.desk-companion/server.json` (`{pid, port, token}`) and POSTs to the server with a 300 ms timeout.
- If the server is unreachable or `server.json` is missing, it spawns `node bin/server.mjs` detached (`windowsHide: true`, `stdio: 'ignore'`, `unref()`). On `SessionStart` it waits up to 2 s for `server.json` and retries once. On any other event it drops that single event.
- It always exits 0 and prints nothing to stdout, so it never alters Claude's behaviour. Errors are appended to `~/.desk-companion/hook.log`, capped at 256 KB with one rotation.

### 2. Server: `bin/server.mjs` + `src/server/*.mjs`

- **Single instance.** On start it reads `~/.desk-companion/config.json`. If a live `pid` in `server.json` answers `GET /api/health`, the new process exits.
- **Stable address.** `config.json` is created on first run with `{ port, token }`. The port is random in 50000–60000, the token 128-bit hex (`crypto.randomBytes(16)`). Both persist, so a home-screen bookmark keeps working across restarts.
- **Binding.** It listens on `0.0.0.0:<port>`. The first time, Windows Firewall asks whether to allow Node on private networks; the README says so.
- **Lifetime.** It runs until the PC shuts down or `node bin/server.mjs --stop` (which kills the pid in `server.json`). The next hook after a stop or crash starts it again.
- **Log.** `~/.desk-companion/server.log`, capped at 1 MB with one rotation.

Routes:

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/hook` | loopback address **and** `x-dc-token` | Ingest one sanitised hook event |
| `GET /api/health` | loopback | `{ok, version, pid}` |
| `GET /` | `?k=<token>` or cookie | The dashboard page; sets an HttpOnly `dc` cookie |
| `GET /events` | cookie or `?k=` | SSE stream: `snapshot` on connect and on every change; `event` for discrete moments; `ping` every 20 s |
| `GET /web/*`, `GET /sprites/*` | cookie or `?k=` | Static page assets |
| `GET /pair` | loopback only | Pairing page: phone URL as text and as QR code (SVG), plus a status summary |

All other requests get 403. Static paths are resolved inside `src/web/` only; `..` and absolute paths are rejected.

### 3. Sessions: `src/server/sessions.mjs` (pure logic, unit-tested)

Per `session_id` it keeps `{ id, name, model, modelLabel, effort, contextPct, activity, detail, needsYou, lastEventAt, startedAt }`:

- `name` is the basename of `cwd`.
- **Model.** From the `SessionStart` payload `model`, otherwise the newest assistant `message.model` in the transcript tail. `modelLabel` maps ids to labels: `claude-opus-5` → `Opus 5`, `claude-fable-5-1` → `Fable 5.1`, `claude-sonnet-5` → `Sonnet 5`, `claude-haiku-4-5-*` → `Haiku 4.5`. The generic rule drops `claude-`, capitalises the family, and joins version digits with `.`.
- **Effort.** From payload `effort.level`, otherwise `envEffort`, otherwise the transcript's top-level `effort`, otherwise `—`.
- **Context percent.** The newest assistant `usage` in the transcript tail: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, divided by the context window. The window is 200,000 unless the model id carries `[1m]` or the observed tokens exceed 200,000, in which case it is 1,000,000. A `contextWindow` override per model id can be set in `config.json`.
- **Transcript tail.** On each event it reads the last 64 KB of `transcript_path`, parses complete JSON lines only, and ignores malformed ones. The file is never read in full and its content is never forwarded.

Activity from events (the `detail` string is shown in the speech bubble):

| Event | activity | detail |
|---|---|---|
| `SessionStart` | `idle` (marks `isNew` for one snapshot) | — |
| `UserPromptSubmit` | `thinking` | `Thinking…` |
| `PreToolUse` Read, Grep, Glob, LS, WebFetch, WebSearch, NotebookRead | `reading` | `Reading <target>` / `Searching` / `Browsing` |
| `PreToolUse` Edit, Write, MultiEdit, NotebookEdit | `working` | `Editing <target>` / `Writing <target>` |
| `PreToolUse` Bash matching the build/test pattern below | `compiling` | `Running <target>` |
| `PreToolUse` other Bash, Task/Agent, any other tool | `working` | `Running <target>` / `Delegating` / `<tool_name>` |
| `PreToolUse` AskUserQuestion, ExitPlanMode | unchanged; sets `needsYou` | `Has a question` / `Plan ready for review` |
| `PostToolUse` | `thinking` | `Thinking…` |
| `Notification` | unchanged; sets `needsYou` | `Needs permission` / `Waiting for you` |
| `Stop` | `done` | `Your turn` |
| `StopFailure` `error=rate_limit` | `rateLimited` | `Rate limited` |
| `StopFailure` other | `error` | `Error` |
| `SessionEnd` | session removed | — |

- **Build/test pattern:** `^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)|^(pytest|jest|vitest|tsc|make|mvn|gradle)\b|^(cargo|go|dotnet)\s+(build|test)\b|^pio\s+run\b`.
- `activity` is one of `idle | thinking | reading | working | compiling | done | rateLimited | error`. `needsYou` is a separate boolean flag, so the session list can show both, e.g. "working · needs permission".
- `needsYou` clears on the session's next non-Notification event.
- A session with no event for 60 minutes is dropped.

**Focus rule.** The creature follows the most recent `needsYou` session, otherwise the most recently active one (`thinking`, `reading`, `working` or `compiling`), otherwise the most recent session overall. Settings can pin a session instead.

### 4. Limits: `src/server/limits.mjs`

- **Source.** Claude Code's `get_usage` control request, as implemented by the Agent SDK (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`). The server spawns the `claude` CLI in stream-json SDK mode, sends the `get_usage` control request, reads the control response, and exits the child. Our code never reads credential files or tokens.
- **Parsed fields.** `five_hour` and `seven_day` (utilisation and `resets_at`), plus the first `model_scoped` / weekly-scoped entry whose display name contains `Fable`. Utilisation is normalised to 0–100, whether the source uses 0–1 or 0–100.
- **Schedule.** On server start; every 5 minutes; and 60 s after a `Stop` event. There are at least 2 minutes between calls.
- **Failure handling.** On failure or a 429 it backs off to 10, 20, then 30 minutes. It keeps the last good values with `asOf`, and marks them `stale` after 15 minutes.
- **Missing CLI.** If `claude` is not on PATH, or the version doesn't support `get_usage`, limits are `unavailable`. The page shows "—" rings, and everything else works.
- **First build task.** This path is experimental, so the plan's first task is a spike that confirms the exact invocation, response shape and minimum CLI version on this machine. If the spike fails, the fallback is: ship with `unavailable` limits and record the issue. Nothing else in the design depends on limits.

### 5. Snapshot (server → page)

```json
{
  "v": 1,
  "serverTime": 1789360000000,
  "sessions": [
    { "id": "…", "name": "my_claude_companion", "modelLabel": "Opus 5", "effort": "high",
      "contextPct": 48, "activity": "working", "detail": "Editing server.mjs",
      "needsYou": false, "isNew": false, "lastEventAt": 1789359990000 }
  ],
  "focusId": "…",
  "limits": {
    "status": "ok | stale | unavailable",
    "asOf": 1789359900000,
    "fiveHour": { "pct": 62, "resetsAt": 1789366000000 },
    "week":     { "pct": 34, "resetsAt": 1789545600000 },
    "fable":    { "pct": 71, "resetsAt": 1789545600000 }
  }
}
```

Discrete `event` messages, e.g. `{ "type": "stop", "sessionId": "…" }`, are also sent for moments the page must not miss: `prompt`, `stop`, `needsYou`, `sessionStart`, `rateLimited`, `error`.

### 6. Page: `src/web/`

Plain HTML/CSS/JS served as-is: no build step, no framework, no CDN.

**Layout A.** It matches the approved mockup.
- **Landscape:** the stage takes the left 40%: a dark radial background, the speech bubble, and the creature at 64% of the stage width. The right side holds three rings (5-hour amber `#f5a524`, week teal `#35c2b0`, Fable violet `#a78bfa`, each with a reset countdown) and the session list (status dot, name, "model · effort · detail", context bar). A ring's number turns red at 80% or more.
- **Portrait:** stage on top (about 40% of the height), rings in a row, then the list.
- **List length:** up to 5 rows; beyond that, a "+N more" line.
- **Countdowns** are computed on the page from `resetsAt` and re-rendered every 30 s, e.g. "1h 48m" or "Thu 09:00" when more than 24 h away.

**Controls.** Small icons, top right, 45% opacity:
- **✕ Close.** A black overlay covers the page until tapped (a "screen off" for night). On Android, if in full screen, it also exits full screen. A page cannot close its own tab on iOS, so no attempt is made.
- **⟲ Rotate.** Each tap turns the content a further 90° with CSS: 0°, 90°, 180°, 270°, then back to 0°. At 90° and 270° the page uses the other layout (landscape ↔ portrait), so it still fills the screen. This lets a phone with rotation lock on stand sideways in either direction and still read correctly. The choice is saved.
- **⚙ Settings.** A panel, saved in `localStorage`:
  - mood thresholds for the 5-hour limit: 50 / 80 / 95;
  - idle blinks per minute (26), glances per minute (2), and percentage of time moving (50);
  - sleep after N minutes without activity (5);
  - follow session: automatic, or one pinned session;
  - keep screen awake: on/off;
  - how to add the page to the Home Screen (text instructions).

**Full screen.**
- On the first tap anywhere, the page calls `requestFullscreen()` where supported (Android).
- iOS gets `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent` and a `manifest.webmanifest` with `display: fullscreen`, so "Add to Home Screen" opens without browser bars.

**Keep screen awake.** It uses `navigator.wakeLock` when available (secure contexts only). Otherwise it loops a tiny silent inline video, started by the first tap (the NoSleep technique). The Settings text names the fallback: iPhone Auto-Lock → Never, or Android "Stay awake while charging".

**Offline.** `EventSource` reconnects by itself. After 5 s without a connection an overlay reads "PC offline — waiting…" and the creature sleeps. Stale limits are shown greyed, with "as of HH:MM".

**Burn-in protection.** Every 10 minutes the whole layout shifts by up to 4 px in a random direction.

### 7. Companion behaviour: `src/web/mood.js` (pure, unit-tested)

API: `createMood(settings)` returns `{ onSnapshot(snap, now), onEvent(evt, now), onTap(now), tick(now) }`. Each call returns commands for the player: `{ base, play: [oneShots…], bubble: {text, tone}, dim: bool }`.

Rules, adapted from clawdio's `state_machine.cpp` (expression names are clawdio's):

| Moment | Input | Animation |
|---|---|---|
| Idle | no active focus session | calm idle (§8) |
| Prompt | `prompt` event / activity `thinking` | `surprised` → `thinking`; `curious` once after 8 s |
| Reading | activity `reading` | `reading` (thinking art, 110 ms/frame) |
| Writing | activity `working` | `working` |
| Build/test | activity `compiling` | `compiling` (working art, 90 ms/frame); `look_left` once after 8 s |
| Needs you | `needsYou` | base cycles `surprised` ⇄ `curious` until cleared; bubble tone `need` |
| Finished | `stop` event | `surprised` → `happy_eyes` for 3 s → idle; bubble "Your turn" |
| New session | `sessionStart` event | `curious` once |
| First activity of the day | first `prompt` of the local calendar day | `love` once |
| 5-hour ≥ warn / low / critical | limits, only while idle | `low_tokens` / `sad` / `ending` |
| Week or Fable ≥ 95 / ≥ 100 | limits, only while idle | `ending` / `overloaded` |
| 100% or rate-limited | 5-hour ≥ 100 or `rateLimited` | `overloaded` (overrides activity) |
| Reset | any window drops from ≥ 20 to < 10 between snapshots | `jumping_joy` → `happy` 5 s → `cool` 8 s → idle |
| Plenty left | 5-hour ≤ 5, idle; 1/1200 chance per 500 ms | `cool` for 8 s |
| Error | `error` event | `error` for 5 s; the third error in a row uses `angry` |
| Sleep | no activity for `sleepAfter` minutes, idle | `yawning` about 2.5 s → `sleeping`; `dim: true` (screen to about 30% brightness) |
| Wake | any activity while asleep | `yawning` → `surprised` → `love`, then the activity state |
| Tap | touch on the creature | random one-shot: `love`, `surprised` or `curious` |

- **Priority**, highest first: overloaded/rate-limited; needs you; activity; limit mood; idle.
- **Minimum dwell** between sideways activity changes is 1.5 s, as in clawdio. It stops rapid tool calls from flickering.

### 8. Sprite player and calm idle: `src/web/mascot.js`

- **Frames.** Plays 8-frame strips on a 256×256 `<canvas>` with CSS `mix-blend-mode: lighten`, so the black sprite background disappears into the dark stage.
- **Timing.** Frame durations follow clawdio's registry, e.g. idle 150, blink 80, look 120, thinking 100, working 80, surprised 100, love 120, sleeping 200, overloaded 70 ms. The table lives in `sprites.json`.
- **Playback rules.** Loop animations wrap. A one-shot plays its chained `next` if it has one, otherwise the queued one-shots, otherwise the base. There is no tweening, and it advances at most one frame per tick with the remainder carried forward.
- **Calm idle.** When the base is idle, the player holds idle frame 0. While standing still it runs three timers:
  - blink: the blink strip, 640 ms;
  - glance: `look_left` or `look_right`, 960 ms;
  - breath: idle frames `0,1,2,3,2,1,0` at 200 ms, 1.4 s.

  The timers count down only during stillness. Their intervals come from the settings: `B` blinks/min, `G` glances/min, moving fraction `M`.
  - Still time per minute: `S = 60 s × (1 − M)`.
  - Breaths per minute: `R = max(0, (60 s × M − B × 0.64 s − G × 0.96 s) / 1.4 s)`. If `R` is 0 there are no breaths, and the moving share is whatever blinks and glances produce.
  - Mean intervals, in still time: blinks `S / B`, glances `S / G`, breaths `S / R`.
  - Each interval is drawn uniformly within ±40% of its mean.

  With the defaults (26, 2, 50%): `S` = 30 s, `R` ≈ 8.2, and the intervals are about 1.15 s, 15 s and 3.7 s. This measured 26 / 2 / 50% over 10 simulated minutes in the brainstorm prototype.
- **No blinks during work.** Automatic blinks run only while idle. Clawdio also blinks during work loops, which briefly removes the thinking ring or typing hands.

### 9. Sprites: `tools/build-sprites.mjs` (run once; output committed)

- **Input.** clawdio's source sheets, `imgs/expr_*.png`, from `cegware/clawdio` (MIT), pinned to commit `76ee482fffa1cc602ca0dc524324a2880b9770e2` (2026-08-29). The script downloads them from `raw.githubusercontent.com` into `tools/.cache/` (gitignored), and records the commit in `sprites.json`.
- **Slicing.**
  - Sheets with separator lines: cut at the measured separator lines.
  - Sheets without lines (`look_left`, `love`, `low_tokens`, `overloaded`): cut by clustering non-black content.
  - Every frame must be free of separator-line remnants.
- **Normalisation.** This fixes the size and position jumps between animations.
  - Find the body in each frame as the pixels close to the sheet's dominant body colour.
  - Scale each sheet so its median body width, arms included, equals idle's.
  - Align every frame horizontally on its body centre.
  - Align vertically on the feet line: per frame for static-body sheets, and per sheet (the median of rest frames) for sheets whose drawn motion must survive. Those are `happy_eyes`, `surprised`, `jumping_joy`, `celebration`, `happy` and `yawning`.
  - Result: across all sheets, body width is within ±2% of idle's and the resting feet line within ±2 px.
- **Output.** `src/web/sprites/<name>.png`, 8 frames of 256×256 in a 2048×256 strip on a black background, plus `sprites.json` (frame timings, loop and next) and `LICENSE-clawdio.txt` (clawdio's MIT notice). The README credits clawdio.
- **Aliases.** As in clawdio: `reading` → thinking art, `compiling` → working art, `sad` → ending art, each at its own timing.

### 10. Pairing: `commands/pair.md` → `/desk-companion:pair`

The command runs `node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"` through the slash command's bash execution. The script:
- makes sure the server is running;
- prints the phone URL `http://<LAN-IPv4>:<port>/?k=<token>`, with `http://<hostname>.local:<port>/?k=<token>` as an alternative;
- opens `http://localhost:<port>/pair` in the PC's default browser.

The pair page shows the QR code (from a vendored MIT QR encoder in `src/server/vendor/`), the URL, and a status line: sessions tracked, limits status, and connected pages.

## Security and privacy

- **Page access.** Reaching the page and its stream needs the 128-bit token, in the URL or the HttpOnly cookie set from it.
- **Event injection.** Only loopback clients that present the token can post events. Other devices on the LAN can't inject events.
- **What reaches the phone:** project folder names, model, effort, context %, tool names, file basenames, and the first two words of safe-looking Bash commands. Never prompts, file contents, full paths or command arguments beyond that.
- **Credentials.** The plugin never reads Claude credentials or tokens. Limits come from Claude Code's own `get_usage`.
- **Transport.** HTTP only, on the LAN. HTTPS is out of scope; the token is not a secret against someone sniffing the same Wi-Fi.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Server down when a hook fires | The forwarder starts it; that one event is lost (except `SessionStart`, which waits up to 2 s) |
| Server crash | Restarted by the next hook; pages reconnect automatically |
| `get_usage` fails or is unsupported | Back-off; rings show last values greyed, or "—" |
| Transcript unreadable or malformed | Model, effort and context fall back to the previous or unknown value |
| Phone loses Wi-Fi or the PC sleeps | "PC offline — waiting…" overlay; resumes on reconnect |
| Unknown hook event or payload field | Ignored |

## Testing

- **Unit** (`node --test`):
  - `sessions.mjs`: event sequences to session state, focus rule, expiry, sanitisation;
  - `limits.mjs`: parsing fixtures in both utilisation scales, back-off schedule;
  - `mood.js`: scenario scripts with a fake clock to expected commands, including every row of the §7 table;
  - `mascot.js` idle scheduler: 10 simulated minutes within ±10% of the targets;
  - `hook.mjs` sanitisation: tool inputs never leak; the Bash word filter;
  - model label mapping;
  - transcript tail parser on fixture JSONL.
- **Integration:** start the server on a temporary home directory and random port, post fake hook events, read `/events`, and assert on the snapshots.
- **Manual driver:** `tools/fake-events.mjs <scenario>` replays the brainstorm scenarios (normal turn, limits, idle life) into a running server, for on-device checks without Claude.
- **On-device checklist**, in the README: pairing via QR; full screen on iPhone (Home Screen) and Android; rotate with rotation lock on; close/overlay; keep-awake; offline overlay; limits countdowns.

## Install and requirements

- Node 18 or later, and the Claude Code CLI on PATH (needed for limits only).
- The repo is its own plugin marketplace:
  ```
  /plugin marketplace add C:\Users\weazo\GitHub\my_claude_companion
  /plugin install desk-companion@desk-companion
  ```
  Then run `/desk-companion:pair` and scan the QR code with the phone.
- Verify during the build that a plugin installed this way also loads in the Claude desktop app's Code tab. If it doesn't, document the extra step.

## Out of scope for v1

Home/lock screen widgets, native apps, cost display, API-key billing, multiple PCs, HTTPS, access from outside the LAN, the Claude Code status line, sound, and localisation.

## Risks to verify early (in the plan's first tasks)

1. **`get_usage` invocation and minimum CLI version** (§4). Fallback: limits unavailable.
2. **Hook events.** `StopFailure` may not exist in the installed CLI (2.1.245). Check that `hooks.json` with this event list loads in both the CLI and the desktop app; drop `StopFailure` if it breaks loading.
3. **Plugin loading in the desktop app** (see Install).
4. **iOS behaviour over plain HTTP:** the Home Screen web app opens full screen, and the silent-video keep-awake works on the user's iPhone.
5. **Context window size** per model (§3). Verify against real transcripts and adjust the heuristic.

## File layout

```
.claude-plugin/marketplace.json, plugin.json
hooks/hooks.json
commands/pair.md
bin/hook.mjs, server.mjs, pair.mjs
src/server/http.mjs, sessions.mjs, limits.mjs, transcript.mjs, snapshot.mjs, paths.mjs, vendor/qr.mjs
src/web/index.html, app.js, mood.js, mascot.js, style.css, manifest.webmanifest, sprites/
tools/build-sprites.mjs, fake-events.mjs
test/*.test.mjs, test/fixtures/
package.json ("type": "module", "scripts": { "test": "node --test" }), README.md, LICENSE
```
