# How it was built

I built desk-companion with Claude Code (mainly Claude Opus 5), from a written spec and a test-first plan.

## 1. The specification

[The spec](superpowers/specs/2026-09-14-desk-companion-design.md) came out of a brainstorming session with the agent. Its main decisions:
- A web page served from the PC over the home Wi-Fi. No app, account or cloud.
- Claude Code **hooks** (commands it runs at fixed moments, such as a tool call) send events to a small local server, which updates the phone live.
- Privacy: only a fixed list of fields leaves the hook. Never prompts, file contents or command arguments.
- Security: a random token in the phone's link.

Later changes are listed in [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md).

## 2. How I guided the agent

- **A plan of 17 tasks** ([the plan](superpowers/plans/2026-09-14-desk-companion.md)), run with `superpowers:subagent-driven-development`: each task went to a fresh **sub-agent** (a separate agent with its own context).
- **Test first.** Every task writes a failing test, then the code, then commits with the message the plan gives. Example: Task 4, the privacy filter, is [3de4742].
- **Fixed rules for every task:** Node 18+, no dependencies, tests never touch real data, the privacy rules above.
- **Review rounds by sub-agents**, each fix with tests: [428dd94] (server hardening) and [97e7138] (page robustness).
- **Tools so the agent could check its own work without a phone:** [a fake-event driver](../tools/fake-events.mjs) and [a renderer for Clawd's animations](../tools/clawd-look.mjs).

## 3. How I verified it

- **304 automated tests** (`node --test`), run by CI (GitHub, on every push) on Linux and Windows with Node 18, 22 and 24. [The privacy rules as tests](../test/sanitize.test.mjs).
- **By hand:** sessions from the Claude desktop app show on the dashboard and live limits load; on an iPhone, Home Screen full screen and keep-awake work.
- **[A demo video](images/demo.webm)** of the dashboard replaying a scripted day.

## A 5-minute tour

1. [The spec](superpowers/specs/2026-09-14-desk-companion-design.md): "Decisions made during brainstorming" and §1 (2 minutes).
2. [The plan's Task 4](superpowers/plans/2026-09-14-desk-companion.md#task-4-hook-sanitiser-and-forwarder): one task, test first (1 minute).
3. [Commit 428dd94](https://github.com/Weazool/claude-mobile-companion/commit/428dd94): a review round and its tests (1 minute).
4. [test/sanitize.test.mjs](../test/sanitize.test.mjs): the privacy rules (30 seconds).
5. [CHANGES-SINCE-SPEC.md](superpowers/specs/CHANGES-SINCE-SPEC.md): what changed after the spec (30 seconds).

[3de4742]: https://github.com/Weazool/claude-mobile-companion/commit/3de4742
[428dd94]: https://github.com/Weazool/claude-mobile-companion/commit/428dd94
[97e7138]: https://github.com/Weazool/claude-mobile-companion/commit/97e7138
