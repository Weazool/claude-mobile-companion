# How it was built

desk-companion is a Claude Code plugin. It turns a phone on the desk into a live dashboard of Claude Code sessions and plan limits, with Clawd, an animated mascot. I built it with an AI coding agent: Claude Code, running Claude Opus 5 for the first version.

This page answers three questions:
1. [What was the specification?](#1-the-specification)
2. [How did I guide the agent?](#2-how-i-guided-the-agent)
3. [How did I verify the result?](#3-how-i-verified-it)

Everything here comes from this repo and its git history. Where the history does not show something, this page says **not recorded**.

Short on time? Jump to [the 5-minute tour](#a-5-minute-tour-for-a-reviewer).

## 1. The specification

**The spec:** [docs/superpowers/specs/2026-09-14-desk-companion-design.md](superpowers/specs/2026-09-14-desk-companion-design.md), 351 lines.

**What changed since:** [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md).

The spec was written on 14 Sep 2026 in a brainstorming session with the agent ([7a5cf7d]). Its table "Decisions made during brainstorming" records what was settled there. The brainstorm itself is not in git. The agent wrote the spec.

The spec was updated four times: after a planning spike ([321a94e]), with the on-device results ([7fc2502]), after the final review ([a6aa022]), and when the mascot was rebuilt ([e694fe6]). Commit [7a4776b] then deleted it, though its message does not say so; the message of [baa2169] says "remove the design spec", but that commit does not touch it. On this branch the e694fe6 version is restored, word for word.

### What it decided

- **Delivery.** A web page served by the plugin on the home Wi-Fi. No native app, no app store, no account, no cloud.
- **Data flow.** Claude Code **hooks** (commands it runs at fixed moments: a prompt, a tool call, the end of a turn) send events to one small Node server on the PC. The server pushes updates to the phone with **Server-Sent Events** (SSE: one long HTTP response the server keeps writing to).
- **Division of work.** The server sends facts. The page decides behaviour, in one tested module, `mood.js`.
- **What the phone shows.** The 5-hour, weekly and Fable limits; every session's model, effort, context and current step; and the mascot acting it out.
- **Privacy.** The hook forwards a fixed list of fields. It never forwards prompts, file contents or command arguments. For a shell command it sends only the program name and, for common dev tools, one subcommand. The plugin never reads Claude credentials.
- **Security.** A random 128-bit token in the link protects the page. Only the PC itself, with the token, can post events.
- **Tests.** The spec lists what the unit tests, the integration tests and a fake-event driver must cover (spec "Testing").

### Goals and non-goals

- **Goals** (spec "Overview"): show limits, sessions and a companion on any phone browser on the same Wi-Fi, updated the moment a hook fires.
- **Non-goals** (spec "Out of scope for v1"): home or lock screen widgets, native apps, cost display, API-key billing, more than one PC, HTTPS, access from outside the home network, the Claude Code status line, sound and translations.

### What the planning spike changed ([321a94e])

A **spike** is a small experiment run to answer a question before building. While writing the plan, the agent tried the risky parts on this machine, and the spec was updated with what it found:
- **Limits.** The exact way to ask Claude Code for usage (`get_usage`) was confirmed. It needs the CLI signed in, so a new `signin` status tells the user what to run. The spec had made this spike the plan's first build task; it was done during planning instead (the plan's Task 0).
- **Context window.** It was measured on real transcripts: 1 million tokens for every model except Haiku. This replaced a rule that assumed 200,000.
- **Pairing** became a plugin skill instead of a command file. Claude Code fills in the plugin's folder path only in skills.
- **Libraries.** A QR-code library and a keep-awake library were picked and vendored, meaning copied into the repo. Nothing is fetched at run time.
- **Hook events.** `StopFailure` was confirmed to exist in the installed Claude Code.
- **Privacy, tightened.** The hook works out whether a shell command is a build or a test itself, and forwards only that yes or no.
- **A test route.** `POST /api/dev/limits` lets the fake-event driver set the limits shown.

## 2. How I guided the agent

### The flow

| When | Step | Commit |
|---|---|---|
| 14 Sep, 08:57 | Spec written in a brainstorming session | [7a5cf7d] |
| 09:10 | Spec updated with the planning spike | [321a94e] |
| 10:00 | Implementation plan: 17 tasks, 120 steps | [1d79212] |
| 22:39 – 01:11 | Tasks 1–17 carried out, one commit per task, plus eight follow-up commits | [d19d461] … [7fc2502] |
| 15 Sep, 02:18 – 02:47 | Final review fixes; spec and README brought up to date; version 0.2.0 | [428dd94], [97e7138], [a6aa022] |
| 15 Sep – 9 Oct | Changes one at a time, from 0.3.0 to 0.13.0 | [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md) |

**The plan** is [docs/superpowers/plans/2026-09-14-desk-companion.md](superpowers/plans/2026-09-14-desk-companion.md). Its header tells the agent to carry it out task by task, with one of two skills: `superpowers:subagent-driven-development` (recommended), which hands each task to a fresh **sub-agent** (a separate agent with its own context), or `superpowers:executing-plans`. It ran with `superpowers:subagent-driven-development`: sub-agents did the tasks. The commits show all 17 tasks landing one by one, between 22:39 and 01:11.

Every task follows the same steps, as in **test-driven development** (TDD):
1. Write the failing test.
2. Run it and watch it fail.
3. Write the code.
4. Run the tests and see them pass, with the expected count.
5. Commit, with the exact message the plan gives.

The plan commit ([1d79212]) records that a dry run of every file the plan creates passed all 108 planned tests.

### The plan's global rules

The plan sets rules that hold for every task:
- **Node 18 or later.** The dev machine had Node 22.19.0 on Windows 11.
- **ESM only.** All code uses JavaScript modules (`import`/`export`, `"type": "module"`).
- **No npm dependencies**, at run time or for development. Tests use Node's built-in test runner, `node:test`, with `node:assert/strict`, and run with `node --test`.
- **Tests never touch real data.** They point the data folder at a temporary directory (`DESK_COMPANION_HOME`).
- **Privacy is fixed.** Never read Claude credential files or tokens. Never forward prompts, tool inputs or tool outputs.
- **The page is plain HTML, CSS and JavaScript,** with no build step, no framework and nothing loaded from a CDN.
- **Fixed numbers.** Timeouts, the limits schedule and back-off, colours and the companion's defaults are written down once, in the plan.
- **Every commit ends with** `Co-Authored-By: Claude Opus 5`. All 83 commits carry a Claude co-author line: 77 name Claude Opus 5, 5 name Claude Opus 5.5 and 1 names Claude Fable 5.1.

### Plan tasks and their commits

The commit messages match the plan's commit steps word for word.

| Plan task | What it built | Commit | Follow-ups not in the plan |
|---|---|---|---|
| 0 | `get_usage` spike | done during planning ([321a94e]) | |
| 1 | Project skeleton, plugin manifests, config store | [d19d461] | |
| 2 | Transcript tail reader | [09bb5f9] | |
| 3 | Session store, activity mapping, focus rule | [9665ac4] | |
| 4 | Hook sanitiser and forwarder | [3de4742] | [fb3a808] adds a test for the SessionStart wait-and-retry |
| 5 | HTTP layer: token auth, SSE, static files | [e247e76] | [aef8fe9] keeps the pair page loopback-only and tests `isLoopback` |
| 6 | Background server process, single instance, `--stop` | [f47f7a2] | |
| 7 | Dashboard page v0 | [4ebf692] | |
| 8 | Hook registration, fake-event driver, phone URL | [e546200] | |
| 9 | Plan limits via `get_usage` | [c72dfa3] | [be7fc11] keeps polling after errors, kills hung `claude` processes on Windows; [1fbe37d] keeps the controls visible on iPhone |
| 10 | Pairing page, QR code, pair skill | [4f957bc] | [7d0cac5] version bump |
| 11 | PNG codec, sprite maths, animation table | [127415d] | |
| 12 | Sprites re-cut from clawdio | [8501ec1] | |
| 13 | Sprite player with calm idle | [562abff] | |
| 14 | Companion state machine (`mood.js`) | [c409699] | |
| 15 | The companion on the page | [d0a87de] | |
| 16 | Controls, settings, full screen, keep-awake | [20ddb50] | [2cf8c74], [5ba4a2d], [cd3d32c]: see the reviews below |
| 17 | README and on-device results | [7fc2502] | |

What prompted the follow-up commits is **not recorded**.

### Tools for checking without a phone

The spec and plan asked for tools that let the agent check its own work without a phone or a live Claude session. The agent built them as part of the tasks:

| Tool | What it does | Added in |
|---|---|---|
| [`tools/fake-events.mjs`](../tools/fake-events.mjs) | Replays scenarios into a running server: `turn` (a session reading, editing, asking permission, running tests, ending its turn), `limits` (the 5-hour limit climbing to 100%, a rate limit, a reset), `idle`, `wake`, `end`. | Task 8, [e546200] |
| `POST /api/dev/limits` | A server route that sets the limits shown, for the driver above. Only the PC itself, with the token, can call it. | Tasks 5 and 8 |
| [`tools/clawd-look.mjs`](../tools/clawd-look.mjs), [`tools/lib/rast.mjs`](../tools/lib/rast.mjs), [`tools/lib/png.mjs`](../tools/lib/png.mjs) | Renders Clawd's animations to PNG contact sheets (a grid of frames) without a browser. It can also render one frame, a change from one animation to another, or the Home Screen icon. | [050c045] (png.mjs: Task 11) |
| [`src/web/clawd/mock.html`](../src/web/clawd/mock.html) | Plays every animation and the mood engine's sequences in a browser, at full or quarter speed, with a slider to freeze and scrub. | [050c045] |
| [`src/web/clawd/ANIMATING.md`](../src/web/clawd/ANIMATING.md) | The guide to writing animations for the rig. | [050c045] |
| [`tools/clawd-apng.mjs`](../tools/clawd-apng.mjs) | Renders Clawd to animated PNGs, as in the README. | [8987e1b] |
| `?settle`, `?away` page flags | `?settle` holds Clawd still, so a headless browser can screenshot him. `?away` forces the away view. | [8987e1b], [f2cdd0c] |

Added later, for this write-up: a `day` scenario in `tools/fake-events.mjs`, and [`tools/record-demo.mjs`](../tools/record-demo.mjs), which runs a separate server, replays that day and records the dashboard in a phone-sized browser window to [`docs/images/demo.webm`](images/demo.webm).

### The review rounds

| Commit | What the history says it is | What it changed |
|---|---|---|
| [2cf8c74] | A fix commit after Task 16. Its message does not mention a review. | `setBase` ignores unknown animation names instead of breaking. Upright, the speech bubble stays clear of the controls. MCP tool names read as words ("Search threads"). Tests added for the first and third. |
| [5ba4a2d] | "address review of fix wave A" | Changes the bubble rule that 2cf8c74 added: pins the buttons' line height, then sizes the gap from it, with the sum written in a comment. |
| [428dd94] | "server hardening from final review" | A crash when comparing a non-ASCII token. The PC-only exemption now also checks the `Host` header, which blocks **DNS rebinding** (a web page that points its own name at your PC). Shell targets cut down to the program and one subcommand, for privacy. The server no longer holds a project folder open. Port recovery. `--stop` never kills an unrelated process. Network adapters ranked, real before virtual. `idle_prompt` no longer counts as "needs you". 17 files, 683 lines added, with a new lifecycle test file. |
| [97e7138] | "page robustness from final review" | Its message lists: SSE reconnect, keep-awake arming, safe areas that follow the rotation, sleep at the weekly limit, error scoping, the celebration, a looping clip, overlay stacking and zoom on iOS. Tests added in the mood, player and settings files. |
| [a6aa022] | "spec and README catch up with final-review fixes" | The spec and README updated to match, and the pair skill pre-approves its own command. Version 0.2.0. |

Sub-agents did the reviews.

### Where I changed direction

- **Sprites to an SVG rig (0.3.0).** The plan built the mascot from clawdio's sprite sheets: images cut into frames (Tasks 11–13, and parts of 15 and 17). The day after, [050c045] built Clawd as a live **SVG rig** instead: he is drawn from a few rectangles in the page and posed by code, with 26 animations. [e694fe6] swapped the rig in and deleted the sprites, their build pipeline and their tests. It also rewrote spec §8–9 and added a note to the plan. The superseded tasks were kept in the plan as a record of how it was built. I switched because the sprites looked poor.
- **The spec stopped being updated after 0.3.0** and was deleted at 0.3.2. After that, each change was one request, one commit with a detailed message, a version bump, and the README and screenshots brought up to date. The requests themselves are **not recorded**; the commit messages are the record. [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md) lists them all.
- **Other turns the history shows:**
  - The settings panel was removed (0.3.2).
  - Bars replaced the limit rings (0.6.0).
  - The screen-saving modes were tried and dropped: a screensaver in 0.5.0, half brightness in 0.7.0, then a brightness slider in 0.9.0 and an "away" view in 0.13.0.
  - Moving to a new port when the old one was taken was dropped after it went wrong for real (0.9.8, [f23666a]).

## 3. How I verified it

### The test suite

`node --test` runs **304 tests in 23 files**. All 304 pass on Node 24.21.0 on Windows 11, run on 3 Nov 2026. They need no npm packages, no network and no Claude account.

| Area | Files (tests) | Tests |
|---|---|---|
| Hook forwarder and privacy | `sanitize` (12), `hook` (5), `manifest` (2) | 19 |
| Server: routes, auth, start and stop, network | `http` (25), `server` (6), `lifecycle` (6), `net` (8), `paths` (6) | 51 |
| Sessions and transcripts | `sessions` (21), `transcript` (7) | 28 |
| Limits | `limits` (15), `limit-slots` (6) | 21 |
| Companion behaviour (`mood.js`) | `mood` (42) | 42 |
| Clawd's rig, player and look tools | `clawd` (54), `png` (2) | 56 |
| Behaviours editor | `behaviours` (15), `behaviours-page` (27), `behaviours-server` (8) | 50 |
| Page: layout, stylesheet, display helpers, burn-in | `settings` (16), `format` (10), `saver` (2) | 28 |
| Pairing and skills | `pair` (7) | 7 |
| Start with Windows | `autostart` (2) | 2 |
| **Total** | **23 files** | **304** |

Each file is `test/<name>.test.mjs`. There are three kinds of test:
- **Unit tests** of pure modules: the sanitiser, the session store, the limits parser and schedule, the mood engine, the rig, the display helpers. The mood engine and the limits poller run on a fake clock.
- **Integration tests** start the real server, the hook forwarder or the pair script as child processes, each on a temporary data folder and its own port. They then post events, read the SSE stream and check the snapshots: `server`, `lifecycle`, `hook`, `pair`, `behaviours-server`.
- **Stylesheet checks.** The `settings` tests named "style: …" read `style.css`, `index.html` and `app.js` as text and check rules in them. They do not draw the page.

**The fixture.** [`test/fixtures/transcript.jsonl`](../test/fixtures/transcript.jsonl) is a sample Claude Code transcript. The transcript tests read model, effort, context and the session title from it. Other tests build their inputs inline.

**CI** (continuous integration: tests run on GitHub for every push and pull request). [`.github/workflows/test.yml`](../.github/workflows/test.yml), new on this branch, runs `node --test` on Ubuntu and Windows with Node 18, 22 and 24. Its first run happens when the branch is pushed.

### What was checked on the phone

What [7fc2502] recorded, in the spec's "Risks to verify early":
- **Plugin in the desktop app:** confirmed on 15 Sep. The hooks fire in the desktop app's Code tab, and that session appears on the dashboard with model, effort and activity.
- **Limits:** a live check, with the CLI signed in, read 29%, 19% and 8%.
- **iPhone, Chrome, plain HTTP:** the browser toolbars first hid the controls; fixed in [1fbe37d]. "Still to confirm on the device: Home Screen full screen, and whether keep-awake holds over HTTP."

7fc2502 also put a nine-item on-device checklist in the README: pairing, full screen on iPhone and Android, rotation, close, keep-awake, offline, real limits, desktop-app and terminal sessions. Results for each item are **not recorded**.

Later commit messages record these observations:
- [7a4776b]: "Measured on the phone". As a Home Screen app, the page reported a height of 873 on a 932-pixel screen, which left a strip uncovered.
- [389b82c]: iOS does not let a Home Screen app draw into that strip, so the strip is painted to match.
- [a17fe80]: grey text "all but vanished" once the brightness slider dimmed the screen.
- [f23666a]: the server moved port "for real" that day, and the phone showed nothing new.

These checks were in a desktop browser, not on a phone:
- [cd3d32c]: "Browser-checked at 390x844, 768x1024, 800x969, 600x705 and all four rotations of 844x390".
- [d459752]: a README screenshot in headless Edge.
- [0adfcdc]: README screenshots "against an isolated server".

Home Screen full screen and keep-awake were confirmed on the iPhone later. Nothing was checked on Android.

### Spec requirements and their tests

Sections are numbered as in the spec. Rows marked "changed" point to [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md).

| Spec | Requirement | Test file |
|---|---|---|
| §1 | Forward only listed fields; never prompts, tool inputs or outputs | `sanitize.test.mjs` |
| §1 | Shell target: the program, plus one subcommand for common dev tools; no arguments | `sanitize.test.mjs` |
| §1 | The build/test flag, from the command after `cd` and variable settings | `sanitize.test.mjs` |
| §1 | Always exit 0, print nothing, give up fast when the server is down | `hook.test.mjs` |
| §1 | On SessionStart, wait up to 2 s for a server it started | `hook.test.mjs` |
| §1 | Ignore events from its own `get_usage` child process | `hook.test.mjs` |
| §1 | `hooks.json` registers the 8 hook events | `manifest.test.mjs` |
| §1, §2 | Logs capped, with one rotation | `paths.test.mjs` |
| §2 | Config: port 50000–60000, 32-character token, kept across restarts | `paths.test.mjs` |
| §2 | One server at a time; `--stop` kills only its own process | `server.test.mjs`, `lifecycle.test.mjs` |
| §2 | The server never holds a project folder as its working folder | `lifecycle.test.mjs` |
| §2 | Port recovery (changed in 0.9.8: the port never moves by itself) | `lifecycle.test.mjs`, `net.test.mjs` test the new rule |
| §2 | Listens on all addresses; the Windows Firewall prompt | No automated test |
| §2 | Each route's auth: token, cookie, or PC-only by address and `Host`; 403, 404, 405 | `http.test.mjs` |
| §2 | No token cookie for the PC itself; static files cannot escape `src/web/` | `http.test.mjs` |
| §3 | Model labels; effort precedence | `sessions.test.mjs` |
| §3 | Context %: 1 M window except Haiku | `transcript.test.mjs` |
| §3 | Transcript tail: last 64 KB; skip sub-agent, synthetic and broken lines | `transcript.test.mjs` |
| §3 | Activity table, including notification types and failed turns | `sessions.test.mjs` |
| §3 | Focus rule; drop a session silent for 60 minutes | `sessions.test.mjs` |
| §4 | `get_usage` handshake: initialize, then get usage | `limits.test.mjs` |
| §4 | ok, signin and unavailable; usage as a fraction or a percent | `limits.test.mjs` |
| §4 | Every 5 minutes, after a Stop, 2 minutes apart at least; back-off 10, 20, 30 minutes | `limits.test.mjs` |
| §4 | Stale after 15 minutes | `format.test.mjs` |
| §4 | Never read credentials | No automated test |
| §5 | Snapshot shape; discrete events | `http.test.mjs`, `server.test.mjs` |
| §6 | Layout A: rings and a session list (changed: bars, a session card, two modes) | `settings.test.mjs`, `format.test.mjs` test the current layout |
| §6 | Reset countdowns | `format.test.mjs` |
| §6 | Safe areas at every rotation; rotation geometry | `settings.test.mjs` |
| §6 | Home Screen manifest and icon | `settings.test.mjs` |
| §6 | Full screen on Android | No automated test; not checked on a device |
| §6 | Keep the screen awake | No automated test of the lock itself; `saver.test.mjs` tests when the page lets go (added in 0.7.0) |
| §6 | Offline overlay; SSE reconnect | No automated test of the reconnect; `mood.test.mjs` tests that Clawd rests while offline |
| §6 | Burn-in shift (changed: a slow drift) | `saver.test.mjs` |
| §7 | Every row of the behaviour table; priority; the 1.5 s wait between changes | `mood.test.mjs` |
| §8 | Rig: shapes, colours, pivots; stays in view and in its rectangle budget | `clawd.test.mjs` |
| §8 | Seamless loops; one-shots start and end at rest; feet on the ground | `clawd.test.mjs` |
| §8 | Player rules; blends never jump | `clawd.test.mjs` |
| §8 | Calm idle: 26 blinks and 2 glances a minute, moving 50% of the time | `clawd.test.mjs` |
| §8 | The renderer creates no page elements while animating | `clawd.test.mjs` |
| §9 | Look tool: rasterizer and PNG encoder | `clawd.test.mjs`, `png.test.mjs` |
| §9 | Mock page | No automated test |
| §10 | Pair skill: runs the pair script, user-invoked only, command pre-approved | `pair.test.mjs` |
| §10 | Phone URLs; real adapters ranked before virtual ones | `net.test.mjs` |
| §10 | Pair page PC-only; other addresses clickable, inserted as text only | `http.test.mjs`, `pair.test.mjs` |
| Security | DNS rebinding blocked by the `Host` check | `http.test.mjs` |
| Security | Only the PC, with the token, can post events | `http.test.mjs` |
| Errors | Server down: the event is lost, except SessionStart | `hook.test.mjs` |
| Errors | Unknown events and fields ignored | `sessions.test.mjs`, `sanitize.test.mjs` |
| Install | Node 18 or later | CI, new on this branch, not yet run |
| Install | The plugin loads in the desktop app's Code tab | No automated test; checked by hand, recorded in [7fc2502] |
| Risks, item 6 | The pair skill in a fresh session with default permissions | `pair.test.mjs` checks the pre-approval; the spec calls the live run "still pending", and its result is **not recorded** |

## A 5-minute tour for a reviewer

1. [The spec](superpowers/specs/2026-09-14-desk-companion-design.md): read "Decisions made during brainstorming", §1 and "Out of scope for v1" (2 minutes).
2. [The plan's header, its global rules and Task 4](superpowers/plans/2026-09-14-desk-companion.md#task-4-hook-sanitiser-and-forwarder): one task, step by step, failing test first (1 minute).
3. [Commit 428dd94](https://github.com/Weazool/claude-mobile-companion/commit/428dd94): a review round and the tests it added (1 minute).
4. [test/sanitize.test.mjs](../test/sanitize.test.mjs): the privacy rules, as tests (30 seconds).
5. [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md): what changed after the spec, and which tests cover it (30 seconds).

[7a5cf7d]: https://github.com/Weazool/claude-mobile-companion/commit/7a5cf7d
[321a94e]: https://github.com/Weazool/claude-mobile-companion/commit/321a94e
[1d79212]: https://github.com/Weazool/claude-mobile-companion/commit/1d79212
[d19d461]: https://github.com/Weazool/claude-mobile-companion/commit/d19d461
[09bb5f9]: https://github.com/Weazool/claude-mobile-companion/commit/09bb5f9
[9665ac4]: https://github.com/Weazool/claude-mobile-companion/commit/9665ac4
[3de4742]: https://github.com/Weazool/claude-mobile-companion/commit/3de4742
[fb3a808]: https://github.com/Weazool/claude-mobile-companion/commit/fb3a808
[e247e76]: https://github.com/Weazool/claude-mobile-companion/commit/e247e76
[aef8fe9]: https://github.com/Weazool/claude-mobile-companion/commit/aef8fe9
[f47f7a2]: https://github.com/Weazool/claude-mobile-companion/commit/f47f7a2
[4ebf692]: https://github.com/Weazool/claude-mobile-companion/commit/4ebf692
[e546200]: https://github.com/Weazool/claude-mobile-companion/commit/e546200
[c72dfa3]: https://github.com/Weazool/claude-mobile-companion/commit/c72dfa3
[be7fc11]: https://github.com/Weazool/claude-mobile-companion/commit/be7fc11
[1fbe37d]: https://github.com/Weazool/claude-mobile-companion/commit/1fbe37d
[4f957bc]: https://github.com/Weazool/claude-mobile-companion/commit/4f957bc
[7d0cac5]: https://github.com/Weazool/claude-mobile-companion/commit/7d0cac5
[127415d]: https://github.com/Weazool/claude-mobile-companion/commit/127415d
[8501ec1]: https://github.com/Weazool/claude-mobile-companion/commit/8501ec1
[562abff]: https://github.com/Weazool/claude-mobile-companion/commit/562abff
[c409699]: https://github.com/Weazool/claude-mobile-companion/commit/c409699
[d0a87de]: https://github.com/Weazool/claude-mobile-companion/commit/d0a87de
[20ddb50]: https://github.com/Weazool/claude-mobile-companion/commit/20ddb50
[2cf8c74]: https://github.com/Weazool/claude-mobile-companion/commit/2cf8c74
[5ba4a2d]: https://github.com/Weazool/claude-mobile-companion/commit/5ba4a2d
[cd3d32c]: https://github.com/Weazool/claude-mobile-companion/commit/cd3d32c
[7fc2502]: https://github.com/Weazool/claude-mobile-companion/commit/7fc2502
[428dd94]: https://github.com/Weazool/claude-mobile-companion/commit/428dd94
[97e7138]: https://github.com/Weazool/claude-mobile-companion/commit/97e7138
[a6aa022]: https://github.com/Weazool/claude-mobile-companion/commit/a6aa022
[050c045]: https://github.com/Weazool/claude-mobile-companion/commit/050c045
[e694fe6]: https://github.com/Weazool/claude-mobile-companion/commit/e694fe6
[7a4776b]: https://github.com/Weazool/claude-mobile-companion/commit/7a4776b
[baa2169]: https://github.com/Weazool/claude-mobile-companion/commit/baa2169
[389b82c]: https://github.com/Weazool/claude-mobile-companion/commit/389b82c
[8987e1b]: https://github.com/Weazool/claude-mobile-companion/commit/8987e1b
[d459752]: https://github.com/Weazool/claude-mobile-companion/commit/d459752
[a17fe80]: https://github.com/Weazool/claude-mobile-companion/commit/a17fe80
[f23666a]: https://github.com/Weazool/claude-mobile-companion/commit/f23666a
[0adfcdc]: https://github.com/Weazool/claude-mobile-companion/commit/0adfcdc
[f2cdd0c]: https://github.com/Weazool/claude-mobile-companion/commit/f2cdd0c
