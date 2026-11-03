# How it was built

desk-companion is a Claude Code plugin that turns a phone into a live dashboard of Claude Code sessions and plan limits, with an animated mascot, Clawd. I built it with an AI coding agent: Claude Code, running Claude Opus 5 for the first version.

1. [The specification](#1-the-specification)
2. [How I guided the agent](#2-how-i-guided-the-agent)
3. [How I verified it](#3-how-i-verified-it)

Facts come from the repo, its git history and my own account; gaps say **not recorded**. Short on time? See [the 5-minute tour](#a-5-minute-tour-for-a-reviewer).

## 1. The specification

[The spec](superpowers/specs/2026-09-14-desk-companion-design.md) (351 lines) was written by the agent on 14 Sep 2026, in a brainstorming session ([7a5cf7d]). It was updated four times ([321a94e], [7fc2502], [a6aa022], [e694fe6]), deleted in [7a4776b], and is restored here word for word from e694fe6. [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md) lists every change after it.

**What it decided:**
- **Delivery:** a web page served from the PC over the home Wi-Fi. No app, no account, no cloud.
- **Data flow:** Claude Code **hooks** (commands it runs at fixed moments, such as a tool call) post events to a small Node server, which pushes updates to the phone over **SSE** (Server-Sent Events: one HTTP response the server keeps writing to).
- **Privacy:** the hook forwards a fixed list of fields; never prompts, file contents or command arguments.
- **Security:** a random token in the phone's link. Only the PC itself, with the token, can post events.
- **Out of scope:** widgets, native apps, cost, more than one PC, HTTPS, access from outside the home network.

**The planning spike** ([321a94e]; a spike is a small experiment before building) confirmed how to read usage limits, measured the context window (1 million tokens, except Haiku), made pairing a plugin skill and picked two libraries, copied into the repo.

## 2. How I guided the agent

| When | Step | Commit |
|---|---|---|
| 14 Sep, 08:57 | Spec | [7a5cf7d] |
| 09:10 | Spec updated after the spike | [321a94e] |
| 10:00 | Implementation plan: 17 tasks | [1d79212] |
| 22:39 – 01:11 | Tasks 1–17, one commit each, plus eight follow-up fixes | [d19d461] … [7fc2502] |
| 15 Sep, 02:18 – 02:47 | Final review fixes; version 0.2.0 | [428dd94], [97e7138], [a6aa022] |
| 15 Sep – 9 Oct | One change at a time, 0.3.0 to 0.13.0 | [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md) |

**[The plan](superpowers/plans/2026-09-14-desk-companion.md)** ran with `superpowers:subagent-driven-development`: each task went to a fresh **sub-agent** (a separate agent with its own context). Every task is **test first**: write a failing test, watch it fail, write the code, see the tests pass, commit with the plan's exact message.

**Its rules for every task:** Node 18+, no npm dependencies, tests on Node's built-in runner (`node --test`), tests never touch real data, plain HTML/CSS/JS with no build step, and the privacy rules above.

### Plan tasks and their commits

| Task | What it built | Commit | Follow-up fixes |
|---|---|---|---|
| 0 | Usage-limits spike | [321a94e] | |
| 1 | Skeleton, manifests, config | [d19d461] | |
| 2 | Transcript reader | [09bb5f9] | |
| 3 | Session store | [9665ac4] | |
| 4 | Hook sanitiser and forwarder | [3de4742] | [fb3a808] |
| 5 | HTTP layer: auth, SSE, files | [e247e76] | [aef8fe9] |
| 6 | Background server | [f47f7a2] | |
| 7 | Dashboard page v0 | [4ebf692] | |
| 8 | Hook registration, fake-event driver | [e546200] | |
| 9 | Plan limits | [c72dfa3] | [be7fc11], [1fbe37d] |
| 10 | Pairing page and skill | [4f957bc] | [7d0cac5] |
| 11–13 | Sprites and their player | [127415d], [8501ec1], [562abff] | |
| 14 | Behaviour engine (`mood.js`) | [c409699] | |
| 15 | The companion on the page | [d0a87de] | |
| 16 | Controls, full screen, keep-awake | [20ddb50] | [2cf8c74], [5ba4a2d], [cd3d32c] |
| 17 | README and on-device results | [7fc2502] | |

What prompted the follow-up fixes is **not recorded**.

### Reviews

Sub-agents reviewed the work:
- [428dd94] "server hardening from final review": a token crash, a **DNS rebinding** block (a web page pointing its own name at your PC), shorter shell targets for privacy, safer `--stop`, and a new test file.
- [97e7138] "page robustness from final review": reconnects, keep-awake, safe areas, iOS zoom, with tests.
- [2cf8c74] and [5ba4a2d] ("address review of fix wave A"): fixes after Task 16.

### Tools that let the agent check its work without a phone

- [`tools/fake-events.mjs`](../tools/fake-events.mjs) replays Claude Code events into the server ([e546200]).
- [`tools/clawd-look.mjs`](../tools/clawd-look.mjs) renders Clawd's animations to PNG frame grids, without a browser ([050c045]).
- [`src/web/clawd/mock.html`](../src/web/clawd/mock.html) plays every animation in a browser, frame by frame if needed ([050c045]).
- Added for this write-up: [`tools/record-demo.mjs`](../tools/record-demo.mjs), which records [the demo video](images/demo.webm) from made-up events.

### Changes of direction

- **Sprites to an SVG rig (0.3.0).** The sprites looked poor, so [050c045] rebuilt Clawd from shapes drawn and posed by code, and [e694fe6] replaced the sprites.
- **After 0.3.0** each change was one commit with a detailed message; what I asked for each time is **not recorded**.
- **Dropped along the way:** the settings panel (0.3.2), limit rings (0.6.0), a screensaver (0.5.0), and moving to a new port by itself ([f23666a], 0.9.8).

## 3. How I verified it

### Tests

`node --test` runs **304 tests in 23 files**, all passing on Node 24 on Windows 11 (3 Nov 2026). **CI** (tests run by GitHub on every push) runs them on Linux and Windows with Node 18, 22 and 24: [test.yml](../.github/workflows/test.yml).

| Area | Test files | Tests |
|---|---|---|
| Hook and privacy | `sanitize`, `hook`, `manifest` | 19 |
| Server, auth, start and stop | `http`, `server`, `lifecycle`, `net`, `paths` | 51 |
| Sessions and transcripts | `sessions`, `transcript` | 28 |
| Limits | `limits`, `limit-slots` | 21 |
| Behaviour engine | `mood` | 42 |
| Clawd's animations | `clawd`, `png` | 56 |
| Behaviours editor | `behaviours`, `behaviours-page`, `behaviours-server` | 50 |
| Page layout and helpers | `settings`, `format`, `saver` | 28 |
| Pairing | `pair` | 7 |
| Start with Windows | `autostart` | 2 |

- **Unit tests** cover the pure modules, on a fake clock where time matters.
- **Integration tests** start the real server and hook as separate processes, on a temporary folder and port.
- **Layout tests** read the stylesheet as text; they don't draw the page.
- **Sample data:** [a recorded transcript](../test/fixtures/transcript.jsonl).

### Spec requirements and their tests

| Spec | Requirements | Tests |
|---|---|---|
| §1 Hook | Fixed fields only; no command arguments; exits fast and silently | `sanitize`, `hook`, `manifest` |
| §2 Server | One server; `--stop` kills only its own; config kept; §5 snapshot | `server`, `lifecycle`, `paths`, `net` |
| §2 Security | Token, PC-only routes, DNS rebinding blocked | `http` |
| §3 Sessions | Models, activity, focus, expiry, context % | `sessions`, `transcript` |
| §4 Limits | Reading usage, statuses, schedule, back-off | `limits`, `format` |
| §6 Page | Layout, countdowns, rotation, Home Screen icon | `settings`, `format`, `saver` |
| §7 Behaviour | Every row of the behaviour table | `mood` |
| §8–9 Clawd | Animations loop cleanly, stay in view | `clawd`, `png` |
| §10 Pairing | Pair skill, phone links, PC-only pair page | `pair`, `net`, `http` |

No automated test: the keep-awake lock, reconnecting after a silent drop, full screen on Android, the Windows Firewall prompt, the mock page, and "never reads credentials".

### On the phone

- **Recorded in [7fc2502]:** hooks work in the desktop app; a live limits read (29%, 19%, 8%); on iPhone the browser bars hid the controls, fixed in [1fbe37d].
- **Confirmed later:** Home Screen full screen and keep-awake on iPhone. **Not checked on Android.**
- **Not recorded:** the results of the README's 9-item phone checklist, and whether `/pair` ran without a permission prompt in a fresh session (spec risk 6).

## A 5-minute tour for a reviewer

1. [The spec](superpowers/specs/2026-09-14-desk-companion-design.md): "Decisions made during brainstorming", §1 and "Out of scope for v1" (2 minutes).
2. [The plan's Task 4](superpowers/plans/2026-09-14-desk-companion.md#task-4-hook-sanitiser-and-forwarder): one task, failing test first (1 minute).
3. [Commit 428dd94](https://github.com/Weazool/claude-mobile-companion/commit/428dd94): a review round and its tests (1 minute).
4. [test/sanitize.test.mjs](../test/sanitize.test.mjs): the privacy rules as tests (30 seconds).
5. [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md): what changed after the spec (30 seconds).

[7a5cf7d]: https://github.com/Weazool/claude-mobile-companion/commit/7a5cf7d
[321a94e]: https://github.com/Weazool/claude-mobile-companion/commit/321a94e
[7fc2502]: https://github.com/Weazool/claude-mobile-companion/commit/7fc2502
[a6aa022]: https://github.com/Weazool/claude-mobile-companion/commit/a6aa022
[e694fe6]: https://github.com/Weazool/claude-mobile-companion/commit/e694fe6
[7a4776b]: https://github.com/Weazool/claude-mobile-companion/commit/7a4776b
[1d79212]: https://github.com/Weazool/claude-mobile-companion/commit/1d79212
[d19d461]: https://github.com/Weazool/claude-mobile-companion/commit/d19d461
[428dd94]: https://github.com/Weazool/claude-mobile-companion/commit/428dd94
[97e7138]: https://github.com/Weazool/claude-mobile-companion/commit/97e7138
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
[050c045]: https://github.com/Weazool/claude-mobile-companion/commit/050c045
[f23666a]: https://github.com/Weazool/claude-mobile-companion/commit/f23666a
