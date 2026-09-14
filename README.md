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
claude plugin marketplace add Weazool/claude-mobile-companion
claude plugin install desk-companion@desk-companion
```

For development, add the local clone instead: `claude plugin marketplace add C:/path/to/claude-mobile-companion`.

Restart your Claude Code sessions so the hooks load. The first time the server starts, Windows asks whether Node may accept connections: allow **Private networks**.

## Pair your phone

In Claude Code run `/desk-companion:pair`, or run `node bin/pair.mjs` in a clone. A page opens in your PC's browser with the QR code and a live preview of the dashboard. Scan the code with the phone. On the PC itself, `http://localhost:<port>/` opens the dashboard without the token (the port is in `~/.desk-companion/config.json`, Windows: `%USERPROFILE%\.desk-companion\config.json`).

- **iPhone** (Safari or Chrome): Share → Add to Home Screen, then open it from the icon for full screen.
- **Android:** the first tap goes full screen.

## On the phone

- **✕** blanks the screen until you tap it (night mode).
- **⟲** turns the layout 90° at a time, so it works with rotation lock on.
- **⚙** sets mood thresholds, how lively the idle is, when it sleeps, which session to follow, and keep-awake.

If the screen still locks, use iPhone Settings → Display & Brightness → Auto-Lock → Never, or Android Developer options → Stay awake while charging.

## Privacy

The phone sees project folder names, model, effort and context %. Beyond that: Bash shows only the program name, plus one subcommand for common dev tools (`git status`, `npm test`) — a leading `cd …` is skipped; file tools show only the file name; MCP tools show only the tool's own name. Prompts, file contents and command arguments are never sent. The plugin never reads your Claude credentials; limits come from Claude Code's own `get_usage`. The page is plain HTTP on your LAN, protected by a random token in the link.

## On-device checklist

1. Pair via `/desk-companion:pair` and the QR code.
2. Full screen from the iPhone Home Screen, and on Android.
3. Rotate with rotation lock on.
4. Close and the blank overlay.
5. Keep-awake.
6. The offline overlay, then recovery.
7. Real limits with countdowns, including the Fable ring.
8. A session in the desktop app's Code tab appears.
9. A session in the terminal CLI appears.

## Troubleshooting

- **Phone can't connect:** open `/pair` on the PC and click one of the other addresses listed under the QR code — the first one isn't always the real Wi-Fi adapter (a virtual adapter, like VirtualBox or Hyper-V, can sort first).
- **Windows Firewall:** the first time the server starts, allow Node on **Private networks** when asked.
- **A new port after a restart:** Windows sometimes reserves the configured port block; the server then switches to a new one on its own and logs the switch. Re-pair with `/desk-companion:pair`.
- **Logs** are in the data dir: `~/.desk-companion/server.log` and `hook.log` (Windows: `%USERPROFILE%\.desk-companion\`).

## Development

```bash
node --test                                # all tests
node bin/server.mjs --stop
node bin/pair.mjs                          # restart the server from a clone
node tools/fake-events.mjs turn            # also: limits, idle, wake, end
node tools/build-sprites.mjs --check       # verify the committed sprites
```

Hooks and `/desk-companion:pair` start the server from Claude Code's plugin cache whenever none is running — for example after a reboot, a crash, or the `--stop` above. So after any change under `bin/`, `src/`, `skills/` or `hooks/`, bump `version` in `package.json` and `.claude-plugin/plugin.json`, then run:

```bash
claude plugin marketplace update desk-companion
claude plugin update desk-companion@desk-companion
```

and restart Claude Code. The restart above only lasts until the next reboot; it's a quick way to check a change locally, not a substitute for updating the installed plugin.

- Logs: `~/.desk-companion/server.log` and `hook.log` (Windows: `%USERPROFILE%\.desk-companion\`). Config (port and token): `~/.desk-companion/config.json`.

## Credits and licences

- Companion sprites and behaviour are adapted from [clawdio](https://github.com/cegware/clawdio), © Anthrive3D, MIT, via github.com/cegware/clawdio; see `src/web/sprites/LICENSE-clawdio.txt`. The artwork is AI-generated and resembles Anthropic's Clawd mascot. This is an unofficial fan project; consider replacing the art before sharing the plugin widely.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT).
- [NoSleep.js](https://github.com/richtr/NoSleep.js) by Rich Tibbett (MIT).

MIT licence; see `LICENSE`.
