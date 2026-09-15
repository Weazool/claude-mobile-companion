# <img src="docs/images/clawd/happy_eyes.png" height="56" alt="" align="absmiddle"> desk-companion

**Turn the phone on your desk into a live window on Claude Code, with Clawd keeping you company.**

desk-companion is a Claude Code plugin. Prop your phone up next to your keyboard and it becomes an always-on dashboard for everything Claude is doing: how much of your 5-hour, weekly and Fable limits you've used and when they reset, every active session with its model, effort, context and current step, and Clawd, Claude's little mascot, acting it all out.

Clawd isn't a looping GIF. He's a live SVG rig with 26 hand-timed animations that follow your sessions as they happen:
- **Your sessions at work:** he taps at a tiny laptop while Claude edits, lifts a dumbbell while it builds and runs tests, and ponders with thought dots while it thinks.
- **When Claude needs you:** he hops with a "!" when there's a permission prompt, and waves the checkered flag when it's your turn.
- **Your limits:** he gets tired and then worried as they run down, turns red and steams when one is used up, and throws confetti when they reset.
- **When nothing's happening:** he blinks, glances around, strolls across the desk, and after a quiet spell yawns and curls up to sleep. Tap him to say hi.

Everything runs on your own machine. The plugin starts a small web server on your PC, and any phone or tablet browser on the same Wi-Fi opens the dashboard. There's no app to install, no account and no cloud.

<p align="center">
  <img src="docs/images/dashboard-landscape.png" width="68%" alt="The dashboard on a phone held sideways: Clawd typing at his laptop while Claude runs a command, the 5-hour, week and Fable limit rings, and the active session">
  <img src="docs/images/dashboard-phone-portrait.png" width="25%" alt="The same dashboard upright">
</p>

<p align="center"><img src="docs/images/clawd/working.png" height="64" alt="working"> <img src="docs/images/clawd/thinking.png" height="64" alt="thinking"> <img src="docs/images/clawd/reading.png" height="64" alt="reading"> <img src="docs/images/clawd/compiling.png" height="64" alt="compiling"> <img src="docs/images/clawd/surprised.png" height="64" alt="surprised"> <img src="docs/images/clawd/cool.png" height="64" alt="cool"> <img src="docs/images/clawd/overloaded.png" height="64" alt="overloaded"> <img src="docs/images/clawd/celebration.png" height="64" alt="celebration"> <img src="docs/images/clawd/love.png" height="64" alt="love"> <img src="docs/images/clawd/sleeping.png" height="64" alt="sleeping"></p>

Independent project, not affiliated with Anthropic.

## <img src="docs/images/clawd/working.png" height="40" alt="" align="absmiddle"> How it works

```
Claude Code hooks  ──►  local server on your PC  ──►  phone browser on your Wi-Fi
(what each session        (sessions, limits via          (limit rings, sessions,
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

## <img src="docs/images/clawd/cool.png" height="40" alt="" align="absmiddle"> On the phone

- **✕** blanks the screen until you tap it (night mode).
- **⟲** turns the layout 90° at a time, so it works with rotation lock on. The choice is remembered.

The page keeps the screen awake while it's open. If your phone still locks, set iPhone Settings → Display & Brightness → Auto-Lock → Never, or turn on Android Developer options → Stay awake while charging.

## <img src="docs/images/clawd/celebration.png" height="40" alt="" align="absmiddle"> Customise Clawd

You choose which animation Clawd plays for each thing he reacts to: Claude thinking, a permission prompt, your limits running low, a tap, falling asleep and more. In Claude Code, run `/claude-companion-configure`, open **Customise Clawd's behaviours →** on the pair page, or go to `http://localhost:<port>/behaviours`. The page only opens on the PC itself.

Every behaviour has a live preview, and a gallery at the bottom plays all 26 animations. Pick animations per behaviour and click **Save**: the phone switches over at once, with no reload. **Reset to defaults** puts everything back. The map is stored in `~/.desk-companion/behaviours.json` (Windows: `%USERPROFILE%\.desk-companion\behaviours.json`).

<p align="center"><img src="docs/images/behaviours.png" width="90%" alt="The behaviours editor: every behaviour with its animation, a dropdown and a live preview"></p>

## <img src="docs/images/clawd/reading.png" height="40" alt="" align="absmiddle"> Privacy

The phone sees:
- project folder names, model, effort and context %;
- for Bash, only the program name, plus one subcommand for common dev tools (`git status`, `npm test`); a leading `cd …` is skipped;
- for file tools, only the file name;
- for MCP tools, only the tool's own name.

Prompts, file contents and command arguments are never sent. The plugin never reads your Claude credentials; limits come from Claude Code's own `get_usage`. The page is plain HTTP on your LAN, protected by a random token in the link.

## <img src="docs/images/clawd/overloaded.png" height="40" alt="" align="absmiddle"> Troubleshooting

- **The phone can't connect.** Open `/pair` on the PC and click one of the other addresses under the QR code. The first one isn't always the real Wi-Fi adapter: a virtual adapter, such as VirtualBox or Hyper-V, can sort first.
- **Windows Firewall.** The first time the server starts, allow Node on **Private networks** when asked.
- **A new port after a restart.** Windows sometimes reserves the configured port block. The server then switches to a new port by itself and logs the switch. Re-pair with `/claude-companion-pair`.
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
