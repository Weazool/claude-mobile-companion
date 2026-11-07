# Changes since the spec

The [spec](2026-09-14-desk-companion-design.md) describes version 0.3.0. These are the main changes up to 0.14.6.

## Added

- **Behaviours editor (0.4).** The spec fixed one animation per situation. A page on the PC now lets you pick them, with a live preview, and the phone switches at once.
- **Limit bars (0.6).** Bars replace the three rings, each with a legend of the hours or days in its window.
- **Brightness slider (0.9).** It replaces the settings panel. The dashboard also drifts slowly, so the screen doesn't burn in.
- **Session names (0.9.7).** Sessions show the title the Claude app shows.
- **Session card (0.10).** One session at a time, in a card along the bottom that turns every 30 s.
- **Background tasks (0.11, 0.12).** Clawd keeps working while tasks run after a turn. Tasks mode lists each task with its kind and running time; shell arguments are never sent.
- **Limits mode and tasks mode (0.12).** The dashboard alternates between the limit bars and the session's background tasks.
- **Away view (0.13).** When all is quiet, the limit bars fill the screen.
- **Start with Windows (0.13).** An optional shortcut starts the server at login.
- **Faster usage checks (0.13).** Every 90 s while usage is moving, every 5 minutes otherwise.
- **Windows taskbar program (0.14).** An optional program puts Clawd in the taskbar's left corner, at his laptop while any session works, with a chip per session next to him: each chip has its own Clawd, a click opens the session in the Claude desktop app, and a ✕ clears a finished one. Rest the pointer on Clawd and a popup shows the limits and every session's background tasks. It is a separate download and never starts the server.

## Removed

- The settings panel (0.3.2) and the ✕ night screen (0.9.3).
- The limit rings (0.6).
- Clawd falling asleep, and the screensaver (0.13), replaced by the away view.
- Moving to a new port by itself (0.9.8): one server, one port, one token.

The tests are in [test/](../../../test/); `node --test` runs them.
