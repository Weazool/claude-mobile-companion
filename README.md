# <img src="docs/images/clawd/happy_eyes.png" height="56" alt="" align="absmiddle"> desk-companion

**Turn the phone on your desk into a live window on Claude Code, with Clawd keeping you company.**

desk-companion is a Claude Code plugin. Prop your phone up next to your keyboard and it becomes an always-on dashboard for everything Claude is doing: how much of your 5-hour, weekly and Fable limits you've used and when they reset, every active session with its model, effort, context and current step, and Clawd, Claude's little mascot, acting out each session in turn.

Clawd isn't a looping GIF. He's a live SVG rig with 26 hand-timed animations that follow your sessions as they happen:
- **Your sessions at work:** he taps at a tiny laptop while Claude edits, lifts a dumbbell while it builds and runs tests, and ponders with thought dots while it thinks.
- **When Claude needs you:** he hops with a "!" when there's a permission prompt, and waves the checkered flag when it's your turn.
- **Background tasks:** when a turn ends with agents, shells or workflows still running in the background, he keeps at it, typing at the laptop and reading a page in turn, with "2 background tasks" under him, until the last one finishes.
- **Your limits:** he gets tired and then worried as they run down, turns red and steams when one is used up, and throws confetti when they reset.
- **When nothing's happening:** he blinks, glances around, strolls across the desk, and after a quiet spell steps aside so your limits fill the screen. Tap him to say hi.

Everything runs on your own machine. The plugin starts a small web server on your PC, and any phone or tablet browser on the same Wi-Fi opens the dashboard. There's no app to install, no account and no cloud.

<p align="center">
  <img src="docs/images/dashboard-landscape-limits.png" width="68%" alt="The dashboard in limits mode on a phone held sideways: on the left the 5-hour, weekly and Fable limit bars at 43%, 42% and 11% with their hour and day legends, on the right Clawd lifting a dumbbell above &quot;Running npm test&quot;, along the bottom the session that's up in a card between the blue ‹ and › buttons (a blue dot, Companion screenshots, Opus 5.5 · high · Running npm test, its context bar at 34% and its ✕), and on the far right the blue rotate button above the brightness slider at 100%, lit up by a touch">
  <img src="docs/images/dashboard-portrait-limits.png" width="25%" alt="The same dashboard upright: Clawd above the limit bars, the session's card under them, and the rotate button and the brightness slider along the bottom">
</p>

<p align="center"><img src="docs/images/clawd/working.png" height="64" alt="working"> <img src="docs/images/clawd/thinking.png" height="64" alt="thinking"> <img src="docs/images/clawd/reading.png" height="64" alt="reading"> <img src="docs/images/clawd/compiling.png" height="64" alt="compiling"> <img src="docs/images/clawd/surprised.png" height="64" alt="surprised"> <img src="docs/images/clawd/cool.png" height="64" alt="cool"> <img src="docs/images/clawd/overloaded.png" height="64" alt="overloaded"> <img src="docs/images/clawd/celebration.png" height="64" alt="celebration"> <img src="docs/images/clawd/love.png" height="64" alt="love"> <img src="docs/images/clawd/sleeping.png" height="64" alt="sleeping"></p>

Independent project, not affiliated with Anthropic.

## <img src="docs/images/clawd/working.png" height="40" alt="" align="absmiddle"> How it works

```
Claude Code hooks  ──►  local server on your PC  ──►  phone browser on your Wi-Fi
(what each session        (sessions, limits via          (limit bars, sessions,
 is doing, sanitised)      Claude Code's get_usage)       Clawd, live over SSE)
```

## <img src="docs/images/clawd/thinking.png" height="40" alt="" align="absmiddle"> Requirements

- Claude Code on the PC: the terminal CLI and/or the desktop app's Code tab.
- Node 18 or later.
- For limits: the Claude Code CLI on PATH, signed in with your claude.ai account (`claude auth login`). The desktop app's sign-in isn't shared with the CLI.

## <img src="docs/images/clawd/hop.png" height="40" alt="" align="absmiddle"> Install

```bash
claude plugin marketplace add Weazool/claude-mobile-companion
claude plugin install desk-companion@desk-companion
```

For development, add a local clone instead: `claude plugin marketplace add C:/path/to/claude-mobile-companion`.

Restart your Claude Code sessions so the hooks load. The first time the server starts, Windows asks whether Node may accept connections: allow **Private networks**.

## <img src="docs/images/clawd/surprised.png" height="40" alt="" align="absmiddle"> Pair your phone

In Claude Code, run `/claude-companion-pair`. A page opens in your PC's browser with a QR code and a live preview of the dashboard; scan the code with your phone. On the PC itself, `http://localhost:<port>/` opens the dashboard without the token. The port is in `~/.desk-companion/config.json` (Windows: `%USERPROFILE%\.desk-companion\config.json`).

- **iPhone** (Safari or Chrome): Share → Add to Home Screen, then open it from the icon for full screen.
- **Android:** the first tap goes full screen.

**Start it with Windows.** The server starts with your first Claude Code session. To have it running from the moment you log in (handy if you mostly chat in the Claude app: your limits count every chat too), run this once in the plugin's folder:

```bash
node bin/autostart.mjs --install
```

It puts a shortcut in your Startup folder that starts whichever version of the plugin Claude Code has installed. `--remove` takes it away, `--status` says whether it's on. While your usage is moving, the limit bars refresh every 90 seconds; otherwise every 5 minutes.

## <img src="docs/images/clawd/cool.png" height="40" alt="" align="absmiddle"> On the phone

- **One session at a time, along the bottom.** The session that's up sits in a card between **‹** and **›**: its name, its model · effort · current step, its context bar and a **✕**. Every 30 seconds the card turns to the next session, sliding across like a carousel. ‹ and › turn it at once, and the cycle carries on from there; with a single session they're greyed out. Tap **✕** to stop tracking the session: it leaves the cycle until you next prompt it or restart it, or until it needs your permission or has a question.
- **Two modes, in turn.** Above the card, Clawd acts out the session that's up with the animations you picked (see Customise Clawd below), his caption under him. Every session gets a turn in one mode, then every session in the other, and round again.
  - **Limits mode:** Clawd on the right, your limit bars on the left (upright: Clawd above the bars).
  - **Tasks mode:** Clawd on the left, and on the right a card listing the session's background tasks: each one's kind (workflow, agent, shell or monitor), what it is, and how long it has been running, or "queued". As many as fit, then "+2 more"; with none, the card says so (upright: the card under Clawd). He glides across as the bars fade out and the card fades in, and back again for the next round.

<p align="center">
  <img src="docs/images/card-turning-limits.png" width="49%" alt="The card turning after a tap on ›: Companion screenshots' row slides out to the left and fades while The Planner bugs (Opus 5.5 · xhigh · Your turn) slides in from the right, and Clawd on the right already types at his laptop above &quot;4 background tasks&quot;; the controls on the right rest at 10%">
  <img src="docs/images/tasks-mode-landscape.png" width="49%" alt="Tasks mode: Clawd on the left typing at his laptop above &quot;4 background tasks&quot;, and on the right the Background tasks card with a count of 4: review-changes (Workflow · Review changed files across dimensions, 12m), Hook events for background tasks (Agent · claude-code-guide, 3m), npm test (Shell · Run the test suite, 1m) and Watch CI on PR 482 (Monitor · watch_checks, 25m), each with a blue dot; along the bottom The Planner bugs' card between ‹ and ›">
</p>

- **The rail on the right** (along the bottom when the layout is upright) holds two controls, one under the other:
  - **⟲** turns the layout 90° at a time, so it works with rotation lock on.
  - **The brightness slider** runs from 10% to 100%. Drag it or tap anywhere along it. The whole screen dims evenly, edges included. Nothing dims on its own; this slider is the only brightness control.

  The rail rests at 10% so it stays out of the way. Touch it to bring it up to full, then use the controls; that first touch never presses anything. It fades back 5 seconds after you last touch it. Both settings are remembered.
- **Burn-in protection.** Everything is built to keep an OLED screen from burning in:
  - **It drifts.** The whole dashboard moves slowly all the time, a few pixels either way, so no pixel stays lit in one place.
  - **Its bars flow.** Only the tip of each limit bar is in full colour. The rest is dimmed, with stripes that drift slowly along it.
  - **It steps aside.** After 2 quiet minutes (or 2 minutes after a limit runs out), Clawd and the session card make way for your three limit bars, full screen and larger. Any Claude activity or a tap brings the dashboard back.
  - **It lets the phone lock.** While Claude works, the screen stays on. Once 30 minutes pass with no Claude Code activity and no taps, the page stops keeping the screen awake, so your phone locks on its own Auto-Lock. Unlock it and tap once to keep it on again.

<p align="center"><img src="docs/images/away-limits-landscape.png" width="68%" alt="After 2 quiet minutes: Clawd and the session card have made way for the 5-hour, weekly and Fable limit bars at 43%, 42% and 11%, full screen and larger, with their hour and day legends; the controls on the right rest at 10%"></p>

The page keeps the screen awake while something is going on, so leave your phone's Auto-Lock at a normal setting (iPhone: Settings → Display & Brightness → Auto-Lock, e.g. 5 minutes). Keep-awake starts with your first tap on the dashboard. If the phone still locks while Claude is working, your browser isn't holding the screen awake, and Auto-Lock → Never (or Android Developer options → Stay awake while charging) is the fallback, without the lock after 30 quiet minutes.

## <img src="docs/images/clawd/celebration.png" height="40" alt="" align="absmiddle"> Customise Clawd

You choose which animation Clawd plays for each thing he reacts to: Claude thinking, a permission prompt, your limits running low, a tap, coming back and more. In Claude Code, run `/claude-companion-configure`, open **Customise Clawd's behaviours →** on the pair page, or go to `http://localhost:<port>/behaviours`. The page only opens on the PC itself.

Every behaviour has a live preview, and a gallery at the bottom plays all 26 animations. Pick animations per behaviour and click **Save**: the phone switches over at once, with no reload. **Reset to defaults** puts everything back. The map is stored in `~/.desk-companion/behaviours.json` (Windows: `%USERPROFILE%\.desk-companion\behaviours.json`).

<p align="center"><img src="docs/images/behaviours-tasks.png" width="90%" alt="The behaviours editor: every behaviour with its animation, a dropdown and a live preview; under When Claude works, Thinking and Starts working are changed, and Background tasks has working and reading taking turns"></p>

## <img src="docs/images/clawd/reading.png" height="40" alt="" align="absmiddle"> Privacy

The phone sees:
- session names as the Claude app shows them (or the project folder name for a session without one), model, effort and context %;
- for Bash, only the program name, plus one subcommand for common dev tools (`git status`, `npm test`); a leading `cd …` is skipped;
- for file tools, only the file name;
- for MCP tools, only the tool's own name;
- for background tasks: the short description Claude gives each one, a workflow's name or an agent's type, a monitor's MCP tool name, a shell's program name plus one subcommand for common dev tools (never its arguments), and when each one started.

Prompts, file contents and command arguments are never sent. The plugin never reads your Claude credentials; limits come from Claude Code's own `get_usage`. The page is plain HTTP on your LAN, protected by a random token in the link.

## <img src="docs/images/clawd/overloaded.png" height="40" alt="" align="absmiddle"> Troubleshooting

- **The phone can't connect.** Open `/pair` on the PC and click one of the other addresses under the QR code. The first one isn't always the real Wi-Fi adapter: a virtual adapter, such as VirtualBox or Hyper-V, can sort first.
- **Windows Firewall.** The first time the server starts, allow Node on **Private networks** when asked.
- **The phone shows nothing new.** There is only ever one server, on one port, with one token, and the link never changes by itself. If something else on the PC holds that port, the server says so in `server.log` and stops rather than moving: free the port, or move desk-companion on purpose with `node bin/server.mjs --port <number>` (then re-pair with `/claude-companion-pair`). A session you have had open since an older version of the plugin can start that older server; the next start of the current one replaces it, and restarting those sessions stops it happening.
- **Logs** are in `~/.desk-companion/server.log` and `hook.log` (Windows: `%USERPROFILE%\.desk-companion\`).

## <img src="docs/images/clawd/compiling.png" height="40" alt="" align="absmiddle"> Development

```bash
node --test                                # all tests
node bin/server.mjs --stop
node bin/pair.mjs                          # restart the server from a clone
node tools/fake-events.mjs turn            # also: limits, idle, wake, end
node tools/clawd-look.mjs <names|all>      # contact sheets of Clawd's animations, as PNGs
node tools/clawd-look.mjs --icon 256 --out src/web   # regenerate the Home Screen icon
node tools/clawd-apng.mjs working thinking ...       # animated PNGs of Clawd (the README ones: docs/images/clawd)
```

`src/web/clawd/mock.html` plays every animation and the mood engine's sequences in a browser. It's served at `/web/clawd/mock.html`, e.g. `http://localhost:<port>/web/clawd/mock.html`. `src/web/clawd/ANIMATING.md` is the guide to writing animations.

Hooks and `/claude-companion-pair` start the server from Claude Code's plugin cache whenever none is running, for example after a reboot, a crash or the `--stop` above. So after any change under `bin/`, `src/`, `skills/` or `hooks/`, bump `version` in `package.json` and `.claude-plugin/plugin.json`, then run:

```bash
claude plugin marketplace update desk-companion
claude plugin update desk-companion@desk-companion
```

Then restart Claude Code. Restarting the server from a clone only lasts until the next reboot.

## <img src="docs/images/clawd/love.png" height="40" alt="" align="absmiddle"> Credits and licences

- Clawd is Anthropic's mascot. This SVG rig is an unofficial fan recreation for personal use and is not affiliated with or endorsed by Anthropic. Check Anthropic's trademark guidelines before redistributing it.
- The companion's state machine (`src/web/mood.js`) is adapted from [clawdio](https://github.com/cegware/clawdio) (© Anthrive3D, MIT); see `src/web/LICENSE-clawdio.txt`.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT).
- [NoSleep.js](https://github.com/richtr/NoSleep.js) by Rich Tibbett (MIT).

MIT licence; see `LICENSE`.

<p align="center"><img src="docs/images/clawd/sleeping.png" height="56" alt="Clawd asleep"></p>
