# Changes since the spec

The [design spec](2026-09-14-desk-companion-design.md) was last updated in commit e694fe6 (version 0.3.0, 15 Sep 2026). Commit 7a4776b then deleted it. This page lists every product change made after e694fe6, up to version 0.13.0 (commit f2cdd0c, 9 Oct 2026). It is built from the git history only.

How to read the tables:
- **First in** is the first version that contains the change. Two commits (c73c343, 7a4776b) did not bump the version themselves, so they first appear in the next bump.
- **Tests** names the test file in `test/` that covers the change today, at v0.13.0. Every test runs with `node --test`. "No automated test" means no test checks it. "Gone" means a later version removed it.
- **Spec** is the section of the spec that the change makes out of date, or "new" when the spec has no such feature.
- The `settings.test.mjs` tests whose names start with "style:" read `src/web/style.css`, `index.html` and `app.js` as text and check the rules in them. They do not draw the page in a browser.

Only these versions have git tags: v0.4.3, v0.9.8, v0.10.0, v0.10.1, v0.11.0, v0.12.0 and v0.13.0. For the others, the commit is the record.

A few terms:
- **Clawd** is the mascot on the dashboard. The **SVG rig** draws him live from a few rectangles in the page, instead of playing image files.
- A **hook** is a command Claude Code runs at fixed moments: a prompt, a tool call, the end of a turn. The plugin's hook forwards a cleaned-up copy of each event to the local server.
- A **subagent** is a helper agent that a Claude Code session starts. A **background task** is work that keeps running after a turn ends: an agent, a shell command, a monitor or a workflow.
- **Burn-in** is a ghost image an OLED phone screen can keep when the same pixels stay lit for hours.

## Clawd and the stage (spec §6, §8)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| Clawd stands on the stage floor at full size, as big as the old sprite. The speech bubble no longer pushes him around. Redraws while asleep are capped at 20 a second. | 0.3.1 | c73c343 | §6, §8 | `settings.test.mjs` (style: Clawd stands in the middle of his box) |
| Clawd is centred on the stage at every size. The speech bubble becomes a caption under his feet. | 0.3.1 | 41e49b8 | §6 | `settings.test.mjs` (same test) |
| While typing, Clawd's paws sit over the laptop's keyboard, not beside it. | 0.3.3 | c8a24fc | §8 | `clawd.test.mjs` (working: Clawd types on his side of the laptop) |
| The laptop is drawn in front of his paws, which are half hidden behind the lid. | 0.4.1 | 45c3938 | §8 | `clawd.test.mjs` (same test) |
| An alternating list of looping animations now takes turns, each for whole cycles of about 9 s. Before, the first loop in the list played for good. | 0.11.0 | e9c2b0e | §8 Player | `clawd.test.mjs` (an alternating base of loops plays each for whole cycles) |

## Behaviours editor (new)

A **behaviour** is one thing Clawd reacts to, such as "Claude is thinking" or "a permission prompt". The spec fixed one animation for each. Now the user picks them.

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| A behaviour map (`src/web/behaviours.js`) replaces the animation names written into `mood.js`. The page at `/behaviours`, on the PC only, previews every behaviour and all 26 animations. Save writes `~/.desk-companion/behaviours.json`, and the phone switches at once. Reset puts back the defaults. | 0.4.0 | 2c0e424 | new; changes §7 | `behaviours.test.mjs`, `behaviours-page.test.mjs`, `behaviours-server.test.mjs`, `http.test.mjs` |
| `/claude-companion-configure` opens the editor. | 0.4.1 | 45c3938 | new | `pair.test.mjs` (configure skill opens the behaviours page) |
| Any animation can fill any behaviour. A looping animation played as a one-off moment runs one cycle, then hands back. | 0.4.2 | 389b82c | §7, §8 | `behaviours.test.mjs`, `clawd.test.mjs` (Player: a looping clip played as a moment runs one cycle) |

## Pairing (spec §10)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| `/desk-companion:pair` is renamed `/claude-companion-pair`. | 0.4.1 | 45c3938, bf88722 | §10 | `pair.test.mjs` |

## Limits (spec §4, §6)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| The limits check no longer inherits the Claude session that started the server. That session's proxy address and tokens had made every check fail once the session ended. | 0.5.1 | 98dd53b | §4 | `limits.test.mjs` (childEnv drops the launching Claude session env) |
| Bars replace the three limit rings. Under each bar is a legend: the 5-hour window's hours, or the week's days, with the current one outlined. | 0.6.0 | ce8473d | §6 | `format.test.mjs` (limitsView, resetLine), `limit-slots.test.mjs` |
| The 5-hour legend's cells are clock hours, so the outlined cell is the current hour. | 0.6.1 | 20f9e21 | §6 | `limit-slots.test.mjs` |
| Only the tip of each bar is in full colour. The rest is dimmed, with stripes that drift along it. | 0.7.0 | 669105c | §6 | No automated test |
| The usage check runs every 90 s while a limit rose in the last 10 minutes, and every 5 minutes otherwise. | 0.13.0 | f2cdd0c | §4 | `limits.test.mjs` (poller: every 90 s while the usage moves) |

## Burn-in protection and keeping the screen on (spec §6, §7)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| The whole dashboard drifts slowly along a smooth path, within 2.5% of the screen either way. The spec had a jump of up to 4 px every 10 minutes. | 0.5.0 | 3967a55 | §6 | `saver.test.mjs` (drift) |
| Screensaver: once Clawd slept, the screen went black and a small dim card glided around it. | 0.5.0 | 3967a55 | §6, §7 | Gone in 0.13.0 (f2cdd0c) |
| Half brightness after 2 minutes on one status. | 0.7.0 | 669105c | §6 | Gone in 0.9.0 (961249e) |
| Clawd sleeps after 2 quiet minutes, not 5. After 30 minutes with no Claude Code event and no tap, the page stops keeping the screen on, so the phone locks on its own. | 0.7.0 | 669105c | §6, §7 | `saver.test.mjs` (keepAwakeWanted), `mood.test.mjs` |
| The screen's edges darken with the dashboard, so the whole screen is one colour. | 0.8.7 | 5eb3d0f | §6 | `settings.test.mjs` (the root background is the colour the dashboard shows) |
| **Away view**, replacing sleep and the screensaver: after 2 quiet minutes, or 2 minutes after a limit runs out, the limit bars fill the screen. Any activity or a tap brings the dashboard back. The Yawn and Asleep behaviours are gone. | 0.13.0 | f2cdd0c | §7 Sleep, Wake | `mood.test.mjs` (quiet for sleepAfter: he makes way for the limits), `settings.test.mjs` (style: away) |

## Layout and modes (spec §3, §6)

The spec had one layout: Clawd on the left, then the rings and a list of up to 5 sessions. The layout went through several versions. The table lists them in order. Only the last two rows are still in the product.

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| Home Screen mode filled the whole iPhone screen by using the screen's own size. Measured on the phone (see the commit message). | 0.3.2 | 7a4776b | §6 | Gone in 0.4.2 |
| That stretch was undone, since iOS does not let a Home Screen app draw into that strip. Instead the strip is painted in the dashboard's colour. | 0.4.2 | 389b82c | §6 | `settings.test.mjs` (the root background is the colour the dashboard shows) |
| Spotlight: every 10 s the next session comes up and Clawd acts it out. A centred layout appears when that session needs you. | 0.8.0 | 52f484a | §3 focus rule, §6 | `mood.test.mjs` (setFocus) |
| Clawd centred both ways in the centred layout. | 0.8.1 | d893115 | §6 | No automated test; layout replaced in 0.10.0 |
| The centred layout gives Clawd 7 s, then the limit bars take his place for 3 s. | 0.8.2 | aa24952 | §6 | Gone in 0.10.0 (`settings.test.mjs` checks it is gone) |
| In the spotlight, the Your turn and Error animations last as long as the session is shown. | 0.8.3 | e78d37d | §7 | `mood.test.mjs` (Your turn and a failed turn play while their session is the one he shows) |
| Every session in a list that scrolls. A ✕ stops tracking a session until you prompt it again, it restarts or it needs you. | 0.8.4 | ffdc4ea | §6 | List gone in 0.10.0. Untracking stays: `sessions.test.mjs`, `server.test.mjs`, `http.test.mjs` (untrack) |
| A cycle of standard, focus and overview modes, 10 s each. | 0.8.5 | 90f8885 | §6 | Overview gone in 0.9.0. The cycle stays: `format.test.mjs` (nextSlot) |
| The overview's list centred, with rows twice as tall. Rows split 8 to 4. | 0.8.6 | 3b1627d | §6 | Gone with the overview and the list |
| Focus mode: Clawd lower, with his caption, over the session's row at twice the size. | 0.9.4 | ed10deb | §6 | Replaced in 0.10.0 |
| Focus mode's caption hides while the limit bars take Clawd's place. | 0.9.6 | d874d9f | §6 | Gone in 0.10.0 |
| **Session card**: the session that's up sits in a card along the bottom, between ‹ and ›. The card turns every 30 s, like a carousel. Clawd glides between the modes. | 0.10.0 | a5b7809 | §6 | `format.test.mjs` (nextSlot, stepSlot), `settings.test.mjs` (style: the session that's up is a card) |
| **Limits mode and tasks mode**: Clawd to the right of the limit bars, then to the left of a card listing the session's background tasks. | 0.12.0 | 7c635c3 | §6 | `format.test.mjs` (formatElapsed and taskRow), `settings.test.mjs` |
| Sideways, the left side keeps as far from the edge as the rail does on the right. | 0.13.0 | f2cdd0c | §6 | `settings.test.mjs` (style: Clawd stands in the middle of his box) |

## Controls: the rail (spec §6 Controls)

The spec had three icons at the top right: ✕ (a black screen for the night), ⟲ (rotate) and ⚙ (a settings panel). Only ⟲ is left. It now sits on a **rail** with a brightness slider.

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| The settings panel and ⚙ are gone. Only the rotation is remembered. | 0.3.2 | 7a4776b | §6 | `settings.test.mjs` (style: the rail above the offline overlay; no ✕, no night-mode blank, no settings panel) |
| A rail with ⟲ and a brightness slider from 10% to 100%. Nothing dims on its own any more. | 0.9.0 | 961249e | §6 | `settings.test.mjs` (brightness slider; style: the rail holds ⟲ and the brightness slider) |
| The rail moves to the right of the screen. | 0.9.1 | d8af2de | §6 | `settings.test.mjs` (same) |
| All text is white, never grey, and the controls are blue. Grey text all but vanished once the slider dimmed the screen. | 0.9.2 | a17fe80 | §6 | `settings.test.mjs` (style: every text is white) |
| The ✕ and its black screen are gone. The rail rests at 10% and comes up on a touch. That first touch never presses a control. | 0.9.3 | 13a2f6c | §6 | `settings.test.mjs` (style: the rail holds ⟲ …: opacity .1, 5 s fade) |
| Upright, the rail runs along the bottom, with the slider across it. | 0.9.5 | 75f3e51 | §6 | `settings.test.mjs` (same) |

## Sessions and background work (spec §1, §3)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| Sessions are named as the Claude app shows them, taken from the title Claude Code writes into the session's transcript. A session without a title keeps its folder's name. | 0.9.7 | 2d0bb3e | §3 name | `sessions.test.mjs` (a session is named as the Claude app shows it), `transcript.test.mjs` (custom-title, cleanTitle) |
| A background subagent's tool calls no longer turn "Your turn" or a question back into "Thinking…". The hook forwards only whether an event came from a subagent, not the subagent's id. | 0.10.1 | db66b11 | §1, §3 | `sessions.test.mjs` (a background agent …, a subagent …), `sanitize.test.mjs` (a subagent) |
| While background tasks run after a turn, Clawd keeps working with "N background tasks" under him. Such a session is kept for 12 hours without an event, instead of 1. The hook forwards only the count. | 0.11.0 | e9c2b0e | §1, §3, §7 | `sessions.test.mjs`, `sanitize.test.mjs`, `mood.test.mjs`, `format.test.mjs` (dotClass), `behaviours.test.mjs` |
| The hook forwards each background task: its kind, a short label and a detail, at most 20. A shell's arguments are never forwarded. Each task is timed from its launch. | 0.12.0 | 7c635c3 | §1 privacy | `sanitize.test.mjs` (Stop: each background task …), `sessions.test.mjs` (background tasks: the list from each Stop) |

## Server (spec §2)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| One server, one port, one token. The server never moves to a new port by itself; the spec's "port recovery" is gone. `node bin/server.mjs --port <n>` moves it on purpose. A newer server takes over from an older one. | 0.9.8 | f23666a | §2 | `lifecycle.test.mjs`, `net.test.mjs` (listenFixed) |
| A hook tries to start a server at most once every 10 s across all sessions. | 0.9.8 | f23666a | §1 | No automated test |

## Start with Windows (new)

| Change | First in | Commit | Spec | Tests |
|---|---|---|---|---|
| `node bin/autostart.mjs --install` puts a shortcut in the Windows Startup folder; `--remove` and `--status` too. At login, a launcher starts the server of the plugin version Claude Code has installed. | 0.13.0 | f2cdd0c | new | `autostart.test.mjs` checks which version the launcher picks and the shortcut's command line. No test installs a real shortcut. |

## Not product changes

These commits changed docs and tools only:
- `tools/clawd-apng.mjs` renders the animated PNGs of Clawd in the README (8987e1b). It has no automated test.
- New README (baa2169), and README screenshots retaken as the layout changed (8987e1b, d459752, 2632e3d, c0caa0a, be5740b, 9e80468, 3f5e903, 6b8b526, ef600cd, 0adfcdc).
- README text only (738b790, c908149), and a test that lets the README heading carry an animated Clawd (05611b4).
