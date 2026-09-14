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

In Claude Code run `/desk-companion:pair`, or run `node bin/pair.mjs` in this folder. A page opens in your PC's browser with the QR code and a live preview of the dashboard. Scan the code with the phone. On the PC itself, `http://localhost:<port>/` opens the dashboard without the token (the port is in `~/.desk-companion/config.json`).

- **iPhone** (Safari or Chrome): Share → Add to Home Screen, then open it from the icon for full screen.
- **Android:** the first tap goes full screen.

## On the phone

- **✕** blanks the screen until you tap it (night mode).
- **⟲** turns the layout 90° at a time, so it works with rotation lock on.
- **⚙** sets mood thresholds, how lively the idle is, when it sleeps, which session to follow, and keep-awake.

If the screen still locks, use iPhone Settings → Display & Brightness → Auto-Lock → Never, or Android Developer options → Stay awake while charging.

## Privacy

The phone sees project folder names, model, effort, context %, tool names (for MCP tools, only the tool's own name), file names and the first safe words of shell commands. It never sees prompts, file contents or command arguments. The plugin never reads your Claude credentials; limits come from Claude Code's own `get_usage`. The page is plain HTTP on your LAN, protected by a random token in the link.

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
