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
- **Sanitises before sending.** Of the hook JSON it forwards only `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `model`, `effort`, `tool_name`, a derived `target`, a derived `build` flag, `notification_type`, `error`, `source`, and `permission_mode` when present, plus the two fields it adds itself (receivedAt, envEffort).
  - `target` is the basename of `tool_input.file_path` / `notebook_path` / `path` for file tools; for Bash it is the program name plus, for a short whitelist of dev tools, one subcommand word (the Bash target rule below), capped at 24 characters.
  - **Bash target rule.** Leading `cd <dir> &&` / `cd <dir>;` segments and `NAME=value` environment assignments are stripped first. `program` is the basename of the first remaining word (split on `/` and `\`, a trailing `.exe`/`.cmd`/`.bat` removed); it must match `/^[A-Za-z0-9][\w.+-]{0,23}$/` or the target is `''`. One subcommand word is appended only when `program` is in a fixed set of dev tools (`git`, `npm`, `cargo`, `docker`, …) and it matches `/^[a-z][a-z0-9-]{0,15}$/`. Every other word on the command line — arguments, paths, secrets — is dropped.
  - For Bash, `build` is the result of testing the command, after the same `cd`/assignment stripping, against the build/test pattern (§3). Only the boolean leaves the forwarder.
  - Prompts, tool inputs and tool outputs are never forwarded.
- Reads `~/.desk-companion/config.json` for the port and token and POSTs to the server with a 300 ms timeout.
- If that POST fails, it spawns `node bin/server.mjs` detached (`windowsHide: true`, `stdio: 'ignore'`, `unref()`, `cwd: os.homedir()`). On `SessionStart` it then polls `GET /api/health` (re-reading `config.json`) for up to 2 s and retries the POST once it answers. On any other event it drops that single event.
- It always exits 0 and prints nothing to stdout, so it never alters Claude's behaviour. Errors are appended to `~/.desk-companion/hook.log`, capped at 256 KB with one rotation.
- `~/.desk-companion/server.json` (`{pid, port, startedAt}`, no token) is written by the server on start, for `--stop` alone; the forwarder and `pair.mjs` never read it.

### 2. Server: `bin/server.mjs` + `src/server/*.mjs`

- **Single instance.** On start it reads `~/.desk-companion/config.json`; if `GET /api/health` on `config.port` answers with our JSON (`{ok: true, pid}`), the new process exits.
- **Stable address.** `config.json` is created on first run with `{ port, token }`. The port is random in 50000–60000, the token 128-bit hex (`crypto.randomBytes(16)`). Both persist, so a home-screen bookmark keeps working across restarts.
- **Cwd.** Right after loading the config it changes directory into the data dir, so it never holds a session's project folder as its cwd (Windows locks a process's cwd against rename and delete).
- **Binding.** It listens on `0.0.0.0:<port>`. The first time, Windows Firewall asks whether to allow Node on private networks; the README says so.
- **Port recovery.** `EACCES`, or `EADDRINUSE` where nothing answers our own health check, moves the server to a new random port in 50000–60000 (persisted into `config.json`, keeping the token and every other field) and logs the switch, up to 5 attempts before giving up. `EADDRINUSE` where our own health check does answer means another instance already won this race, and this process exits 0 as before.
- **Lifetime.** It runs until the PC shuts down or `node bin/server.mjs --stop`. `--stop` reads the pid out of `server.json` and kills it only if `GET /api/health` — tried on `server.json`'s port, then `config.port` — reports that same pid; `server.json` is removed in every case, so a stale pid left by a reboot or a crash is never acted on. The next hook after a stop or crash starts the server again.
- **Log.** `~/.desk-companion/server.log`, capped at 1 MB with one rotation.

Routes:

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/hook` | loopback (address **and** Host) **and** `x-dc-token` | Ingest one sanitised hook event |
| `GET /api/health` | loopback (address **and** Host) | `{ok, pid}` |
| `GET /` | loopback, or `?k=<token>`, or cookie | The dashboard page; a token login from a non-loopback request also sets an HttpOnly `dc` cookie |
| `GET /events` | loopback, cookie or `?k=` | SSE stream: `snapshot` on connect and on every change; `event` for discrete moments; `ping` every 20 s |
| `GET /web/*` | loopback, cookie or `?k=` | Static page assets, including `/web/sprites/*`. Exception: `manifest.webmanifest` and `icon.png` are public, because browsers fetch manifests without cookies |
| `GET /pair`, `GET /api/pair-info` | loopback (address **and** Host) only | Pairing page: phone URL as text and as QR code, a status summary, and a live preview of the dashboard (loopback needs no token) |
| `POST /api/dev/limits` | loopback (address **and** Host) **and** `x-dc-token` | Test helper: set the limits shown, for the fake-event driver |

The loopback exemption itself needs a loopback remote address **and** a `Host` header naming `localhost`, `127.0.0.1` or `[::1]` (any port): a page whose own DNS name was rebound to 127.0.0.1 still reaches the server from a loopback address, but its requests carry its own name in `Host`, so it gets no exemption — it can still log in with the token like any other device. No token cookie is set for a loopback request; loopback needs none, and cookies aren't port-scoped, so one set on localhost would reach every other local service. Requests that fail the route's required check get 403; an authenticated request for an unknown path gets 404, and any other non-GET request gets 405. Static paths are resolved inside `src/web/` only; `..` and absolute paths are rejected.

### 3. Sessions: `src/server/sessions.mjs` (pure logic, unit-tested)

Per `session_id` it keeps `{ id, name, model, modelLabel, effort, contextPct, activity, detail, needsYou, lastEventAt, startedAt }`:

- `name` is the basename of `cwd`.
- **Model.** From the `SessionStart` payload `model`, otherwise the newest assistant `message.model` in the transcript tail. `modelLabel` maps ids to labels: `claude-opus-5` → `Opus 5`, `claude-fable-5-1` → `Fable 5.1`, `claude-sonnet-5` → `Sonnet 5`, `claude-haiku-4-5-*` → `Haiku 4.5`. The generic rule drops `claude-`, capitalises the family, and joins version digits with `.`.
- **Effort.** From payload `effort.level`, otherwise `envEffort`, otherwise the transcript's top-level `effort`, otherwise `—`.
- **Context percent.** The newest assistant `usage` in the transcript tail: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, divided by the context window. The window is 1,000,000 for every model except Haiku (200,000). This machine's transcripts show Opus 5, Fable 5.1, Sonnet 5 and Opus 4.x all reaching about 1 M tokens. A `contextWindow` override per model id can be set in `config.json`.
- **Transcript tail.** On each event it reads the last 64 KB of `transcript_path`, parses complete JSON lines only, and ignores malformed lines, `isSidechain: true` lines and the `<synthetic>` model. The file is never read in full and its content is never forwarded.

Activity from events (the `detail` string is shown in the speech bubble):

| Event | activity | detail |
|---|---|---|
| `SessionStart` | `idle` (plus a `sessionStart` discrete event) | — |
| `UserPromptSubmit` | `thinking` | `Thinking…` |
| `PreToolUse` Read, Grep, Glob, LS, WebFetch, WebSearch, NotebookRead | `reading` | `Reading <target>` / `Searching` / `Browsing` |
| `PreToolUse` Edit, Write, MultiEdit, NotebookEdit | `working` | `Editing <target>` / `Writing <target>` |
| `PreToolUse` Bash with `build: true` (the forwarder matched the build/test pattern below) | `compiling` | `Running <target>` |
| `PreToolUse` other Bash, Task/Agent, any other tool | `working` | `Running <target>` / `Delegating` / `<tool_name>, max 24 chars; for MCP tools (mcp__<server>__<tool>) only the tool part, made readable ("Search threads")` |
| `PreToolUse` AskUserQuestion, ExitPlanMode | unchanged; sets `needsYou` | `Has a question` / `Plan ready for review` |
| `PostToolUse` | `thinking` | `Thinking…` |
| `Notification` `permission_prompt` | unchanged; sets `needsYou` | `Needs permission` |
| `Notification` `elicitation_dialog` | unchanged; sets `needsYou` | `Has a question` |
| `Notification` `idle_prompt` | unchanged; does **not** set `needsYou` | `Waiting for you` |
| `Notification` `auth_success` | ignored | — |
| `Notification` other | unchanged; sets `needsYou` | `Needs you` |
| `Stop` | `done` | `Your turn` |
| `StopFailure` `error=rate_limit` | `rateLimited` | `Rate limited` |
| `StopFailure` other | `error` | `Error` |
| `SessionEnd` | session removed | — |

- **Build/test pattern:** `^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)|^(pytest|jest|vitest|tsc|make|mvn|gradle)\b|^(cargo|go|dotnet)\s+(build|test)\b|^pio\s+run\b`.
- `activity` is one of `idle | thinking | reading | working | compiling | done | rateLimited | error`. `needsYou` is a separate boolean flag, so the session list can show both, e.g. "working · needs permission".
- `needsYou` clears on the session's next non-Notification event.
- `idle_prompt` arrives about a minute after every `Stop`, while Claude is merely idle rather than blocked, so it only softens the detail text: it must not steal the creature's focus from a working session or block sleep for up to an hour.
- A session with no event for 60 minutes is dropped.

**Focus rule.** The creature follows the most recent `needsYou` session, otherwise the most recently active one (`thinking`, `reading`, `working` or `compiling`), otherwise the most recent session overall. Settings can pin a session instead.

### 4. Limits: `src/server/limits.mjs`

- **Source.** Claude Code's `get_usage` control request, as implemented by the Agent SDK 0.3.270 (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`). Our code never reads credential files or tokens. Confirmed in a spike on this machine with CLI 2.1.245:
  - The server spawns `claude -p --safe-mode --input-format stream-json --output-format stream-json --verbose`. `--safe-mode` disables plugins and hooks, so the child never triggers our own hooks. The child's environment also carries `DESK_COMPANION_INTERNAL=1`, which the forwarder ignores.
  - It writes `{"type":"control_request","request_id":"dc-init","request":{"subtype":"initialize"}}`, then, after the success reply, `{"type":"control_request","request_id":"dc-usage","request":{"subtype":"get_usage","skip_behaviors":true}}`.
  - It reads `control_response` lines until the `dc-usage` reply arrives (about 1 s), then closes the child.
- **Sign-in prerequisite.** The CLI must be signed in with the claude.ai account (`claude auth login`). The desktop app's sign-in is not shared with standalone CLI processes; the spike returned `rate_limits_available: false` and `subscription_type: null` while signed out. That case is reported as status `signin`, and the page tells the user what to run.
- **Parsed fields** (`SDKControlGetUsageResponse`): `rate_limits.five_hour` and `rate_limits.seven_day` as `{utilization 0–100, resets_at ISO 8601}`, plus the first `rate_limits.model_scoped[]` entry whose `display_name` contains `Fable`. A utilisation below 1 that isn't an integer is treated as a fraction.
- **Schedule.** On server start; every 5 minutes; and 60 s after a `Stop` event. There are at least 2 minutes between calls.
- **Failure handling.** On failure or a 429 it backs off to 10, 20, then 30 minutes. It keeps the last good values with `asOf`, and marks them `stale` after 15 minutes.
- **Missing CLI.** If `claude` is not on PATH, or the version doesn't support `get_usage`, limits are `unavailable`. The page shows "—" rings, and everything else works.
- **Isolation.** This path is experimental. Nothing else in the design depends on limits.

### 5. Snapshot (server → page)

```json
{
  "v": 1,
  "serverTime": 1789360000000,
  "sessions": [
    { "id": "…", "name": "my_claude_companion", "modelLabel": "Opus 5", "effort": "high",
      "contextPct": 48, "activity": "working", "detail": "Editing server.mjs",
      "needsYou": false, "lastEventAt": 1789359990000 }
  ],
  "focusId": "…",
  "limits": {
    "status": "ok | stale | signin | unavailable",
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
- `#app` is sized with dynamic viewport units (100dvw/100dvh). Its four padding sides track `env(safe-area-inset-*)`, remapped per rotation class (`rot0`/`rot90`/`rot180`/`rot270`, set by `applyLayout`) so the inset always lands on whichever `#app` edge rotation put against that physical screen edge; the controls sit inside that padding, so iPhone browser toolbars, the notch and the Dynamic Island never hide them at any rotation. In portrait the stage's own top padding (no `env()` term of its own — `#app`'s padding already covers it) keeps the speech bubble clear of the controls.

**Controls.** Small icons, top right, 45% opacity:
- **✕ Close.** A black overlay covers the page until tapped (a "screen off" for night). On Android, if in full screen, it also exits full screen. A page cannot close its own tab on iOS, so no attempt is made.
- **⟲ Rotate.** Each tap turns the content a further 90° with CSS: 0°, 90°, 180°, 270°, then back to 0°. At 90° and 270° the page uses the other layout (landscape ↔ portrait), so it still fills the screen. This lets a phone with rotation lock on stand sideways in either direction and still read correctly. The choice is saved.
- Any control tap arms full screen and keep-awake exactly as a tap on the stage does — the controls stop the tap from reaching the document's own click handler, so each one calls the same activation step itself.
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

**Keep screen awake.** It uses `navigator.wakeLock` when available (secure contexts only). Otherwise it loops a tiny silent inline video, started by a tap anywhere, including the ✕, ⟲ and ⚙ controls. The OS drops the wake lock, or pauses the video, while the page is hidden, so `visibilitychange` to hidden disables it explicitly; the next tap after the page is visible again re-arms it. The Settings text names the fallback: iPhone Auto-Lock → Never, or Android "Stay awake while charging".

**Offline.** `EventSource` reconnects by itself on most errors. A half-open connection (the phone slept, or the PC dropped it without a TCP reset) raises no error, so the page also replaces a connection that has gone silent: after 45 s with no message, and no self-reconnect in the last 15 s, it closes the old `EventSource` and opens a new one. Returning to the tab (`visibilitychange` to visible) after more than 25 s of silence reconnects immediately rather than waiting for that 45 s check. After 5 s without a connection an overlay reads "PC offline — waiting…" and the creature sleeps. Stale limits are shown greyed, with "as of HH:MM".

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
| Reset | any window drops from ≥ 20 to < 10 between snapshots | waits out a live "Your turn" moment if one is running, then `jumping_joy` → `happy` 5 s → `cool` 8 s → idle |
| Plenty left | 5-hour ≤ 5, idle; 1/1200 chance per 500 ms | `cool` for 8 s |
| Error | `error` event | `error` for 5 s; the third error in a row uses `angry`; an error from a background session doesn't interrupt a busy focus session — it still counts toward the third-error escalation |
| Sleep | no activity for `sleepAfter` minutes, idle or at the week/Fable limit | `yawning` about 2.5 s → `sleeping`; `dim: true` (screen to about 30% brightness) |
| Wake | any activity while asleep | `yawning` → `surprised` → `love`, then the activity state |
| Tap | touch on the creature | random one-shot: `love`, `surprised` or `curious` |

- **Priority**, highest first: overloaded/rate-limited; needs you; activity; limit mood; idle.
- **Minimum dwell** between sideways activity changes is 1.5 s, as in clawdio. It stops rapid tool calls from flickering.

### 8. Sprite player and calm idle: `src/web/mascot.js`

- **Frames.** Plays 8-frame strips on a 256×256 `<canvas>` with CSS `mix-blend-mode: lighten`, so the black sprite background disappears into the dark stage.
- **Timing.** Frame durations follow clawdio's registry, e.g. idle 150, blink 80, look 120, thinking 100, working 80, surprised 100, love 120, sleeping 200, overloaded 70 ms. The table lives in `src/web/anims.js`.
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
- **Output.**
  - `src/web/sprites/<name>.png`: 8 frames of 256×256 in a 2048×256 strip on a black background.
  - `sprites.json`: the source repo and commit, plus per-sheet metrics.
  - `LICENSE-clawdio.txt`: clawdio's MIT notice.
  - `src/web/icon.png`: idle frame 0, used as the Home Screen icon.

  Timings are not in `sprites.json`; they live in `src/web/anims.js`. The README credits clawdio.
- **Aliases.** As in clawdio: `reading` → thinking art, `compiling` → working art, `sad` → ending art, each at its own timing.

### 10. Pairing: `skills/pair/SKILL.md` → `/desk-companion:pair`

It is a plugin **skill**, not a command file, because Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` only in plugin skills. The skill body has a dynamic-context line, `` !`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"` ``, which Claude Code runs before Claude sees the text. Frontmatter: `disable-model-invocation: true`. The script:
- makes sure the server is running;
- prints the phone URL `http://<LAN-IPv4>:<port>/?k=<token>` for the best-ranked adapter (real adapters before virtual ones, e.g. VirtualBox or Hyper-V; then home-network ranges), plus every other adapter's address and `http://<hostname>.local:<port>/?k=<token>` as alternatives;
- opens `http://localhost:<port>/pair` in the PC's default browser.

The pair page shows the QR code, the URL, and a status line: sessions tracked, limits status, and connected pages. Every alternative address is rendered as its own clickable element under the QR code; clicking one redraws the QR code and the URL text for that address, and puts the previous one back among the alternatives — useful when a virtual adapter's address would otherwise be the only one that sorts first. Next to the QR code it shows a live preview of the dashboard, since loopback clients need no token. The QR code is rendered in the PC's browser by `qrcode-generator` 1.4.4 (Kazuhiko Arase, MIT), vendored at `src/web/vendor/qrcode.js`.

Keeping the screen awake uses `nosleep.js` 0.12.0 (MIT), vendored at `src/web/vendor/NoSleep.min.js`. It uses the Wake Lock API when available, and otherwise the silent-video technique.

## Security and privacy

- **Page access.** Reaching the page and its stream needs the 128-bit token (in the URL or the HttpOnly cookie set from it), except for a request that is both from a loopback address and carries a loopback `Host` (`localhost`, `127.0.0.1` or `[::1]`, any port). A DNS-rebinding page that merely resolves to 127.0.0.1 still fails this check, because its own name stays in `Host`; it can still log in with the token like any other device.
- **Event injection.** Only loopback clients (address and Host) that present the token can post events. Other devices on the LAN can't inject events.
- **What reaches the phone:** project folder names, model, effort, context %, tool names (MCP: tool part only), file basenames, and for Bash the program name plus, for a short whitelist of dev tools, one subcommand word (24 characters max; §1's Bash target rule). Never prompts, file contents, full paths or command arguments beyond that.
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
  claude plugin marketplace add C:\Users\weazo\GitHub\my_claude_companion
  claude plugin install desk-companion@desk-companion
  ```
  The in-session equivalents are `/plugin marketplace add …` and `/plugin install …`. Then run `/desk-companion:pair` and scan the QR code with the phone.
- For limits, sign the CLI in once: `claude auth login`.
- Verify during the build that a plugin installed this way also loads in the Claude desktop app's Code tab. If it doesn't, document the extra step.

## Out of scope for v1

Home/lock screen widgets, native apps, cost display, API-key billing, multiple PCs, HTTPS, access from outside the LAN, the Claude Code status line, sound, and localisation.

## Risks to verify early (in the plan's first tasks)

1. ~~`get_usage` invocation~~: confirmed. Once the CLI is signed in (2.1.245), the response has `rate_limits.five_hour` / `seven_day` and `model_scoped` with `display_name` "Fable". A live check read 29% / 19% / 8%.
2. ~~Hook events~~: `StopFailure` exists since 2.1.78, and since 2.1.101 an unknown hook event no longer breaks settings loading.
3. ~~Plugin loading in the desktop app~~: confirmed 2026-09-15. Installed from the local marketplace (user scope), the plugin's hooks fire in the desktop app's Code tab, and that session appears on the dashboard with model, effort and activity.
4. **iOS behaviour over plain HTTP:** the user browses with Chrome on iPhone. The controls were first hidden by the toolbars and are fixed with dynamic viewport units and safe-area insets (see §6). Still to confirm on the device: Home Screen full screen, and whether keep-awake holds over HTTP. The settings panel already points to Auto-Lock → Never.
5. ~~Context window size~~: 1 M except Haiku, measured on this machine's transcripts (§3).
6. **Pair skill under default permissions:** `skills/pair/SKILL.md` now declares `allowed-tools` for its injected `bin/pair.mjs` command, and the script has an automated smoke test (`node --test`). A live `claude -p` run of `/desk-companion:pair` in a fresh, default-permission session is still pending.

## File layout

```
.claude-plugin/marketplace.json, plugin.json
hooks/hooks.json
skills/pair/SKILL.md
bin/hook.mjs, server.mjs, pair.mjs
src/hook/sanitize.mjs
src/server/http.mjs, sessions.mjs, limits.mjs, transcript.mjs, snapshot.mjs, paths.mjs, net.mjs
src/web/index.html, pair.html, app.js, format.js, anims.js, mood.js, mascot.js, settings.js, style.css,
        manifest.webmanifest, icon.png, sprites/, vendor/qrcode.js, vendor/NoSleep.min.js
tools/build-sprites.mjs, tools/lib/png.mjs, tools/lib/sprite-math.mjs, tools/fake-events.mjs
test/*.test.mjs, test/fixtures/
package.json ("type": "module", "scripts": { "test": "node --test" }), README.md, LICENSE
```

`src/web/anims.js` is the single source of truth for animation names, sheets and timings. Both the page and the sprite build import it.
