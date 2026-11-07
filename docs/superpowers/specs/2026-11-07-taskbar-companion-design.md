# Taskbar companion for Windows: design

2026-11-07. Calls marked *(my call)* are Claude's, not the user's; everything else is what the user asked for.

## Why

The phone dashboard only helps when the phone is propped up next to the keyboard. The user wants the same view on the PC itself, without it getting in the way: Clawd small in a corner of the taskbar, the full dashboard a mouse-over away.

## What it is

```
 mouse over the corner:
 +--------------------------------------------+
 | 5h   ######----  43%   |                   |
 | week ####------  42%   |     (Clawd)       |
 | Fable #---------  11%  |   Running tests   |
 | <  [ Companion · Opus · high · ctx 34% ]  > |
 +--------------------------------------------+
 +--------+-------------------------------------------------+
 | Clawd  |        [Start] [Search] [apps ...]       12:04  |
 +--------+-------------------------------------------------+
   ^ always there, animated
```

- **The corner.** Clawd sits in the taskbar's left corner, where Windows 11 shows the weather, about taskbar height. He's the same live SVG rig as on the phone and animates with the same moods. Nothing else is shown there: no caption, bars or card.
- **The hover window.** Mousing over Clawd opens a small borderless window just above the corner. It shows exactly the page the phone shows: limits, Clawd, the session card and the rail. It's a bare browser with no address bar or tabs, loading the dashboard from the PC's own server.
- **Lightweight.** It's a small program that starts with Windows, alongside the server.

## Goals

- The corner Clawd is always visible on the primary monitor's taskbar while the taskbar is showing.
- Hovering opens the full dashboard quickly, and moving away closes it.
- It's optional, ships in the repo for Windows users, and is installed separately from the plugin.

## Non-goals

- The Windows Widgets board, a tray icon or a desktop gadget.
- macOS or Linux.
- Any change to the phone experience.
- A new dashboard layout for the PC: the hover window shows the phone's page as it is.

## Anti-goals (a failure even if it works)

- It steals focus, flickers, or covers things the user is clicking on.
- It keeps the PC awake. The page takes a wake lock on localhost today.
- It's heavy: a large download, noticeable memory use, or a runtime the user has to install.
- Installing it changes Windows settings without the user knowing.

## Constraints

- Windows 11 has no API for third-party content in the weather spot, and desk bands are gone. The corner is our own small top-most, borderless, click-through-safe window placed over that part of the taskbar, the way tools like TrafficMonitor do it. The user turns Windows' Widgets off so the corner is free. The README says how (Settings → Personalization → Taskbar → Widgets); the program does not change that setting itself.
- The server already serves the page to loopback without a token. The program reads the port from `%USERPROFILE%\.desk-companion\config.json`, and reads it again whenever the server can't be reached, because `--port` can move it.
- The plugin itself stays cross-platform and unchanged apart from the page flags below. The program lives in its own folder, `windows/` *(my call)*.

## How it's made *(my calls)*

- **C# WinForms with WebView2**, the Edge engine that ships with Windows 11. Target **.NET Framework 4.8**, which is built into Windows 11, so users install nothing. It's built with the .NET SDK, using the `Microsoft.NETFramework.ReferenceAssemblies` package. The output is one small exe plus the WebView2 loader DLLs.
- **Two WebView2 windows:**
  - **Corner:** the page with a new `?corner` flag. It shows only Clawd's stage on a transparent background (WebView2 `DefaultBackgroundColor` transparent), with no caption, bars, card or rail.
  - **Hover:** the normal page with a new `?pc` flag. It's loaded at start-up and kept hidden, so it opens instantly.
  - **Both flags** turn off keep-awake (no wake lock, no NoSleep) and the request for full screen on a click. Taps and clicks otherwise behave as on the phone.
- **Which session the corner Clawd acts out:** the corner and hover pages each run the page's own 30-second cycle and start together, so they roughly match. Exact lockstep with the phone isn't promised, because every screen runs its own cycle.
- **Hover behaviour:**
  - The window opens after the pointer rests on Clawd for about 300 ms, so a pointer passing through doesn't open it.
  - It hides about 1 s after the pointer leaves both Clawd and the window.
  - Clicking Clawd pins it open. Clicking him again, or Esc, unpins it and closes it.
  - It never takes focus when it opens on hover.
- **Size and place:** the hover window has the phone's sideways proportions (932:430) at about half the primary screen's width, anchored above the corner and kept on screen. It's DPI-aware per monitor.
- **Stays out of the way:**
  - Both windows hide while a full-screen app, game or presentation is running (`SHQueryUserNotificationState`).
  - The corner hides when the taskbar auto-hides.
  - With the taskbar's icons left-aligned, Start takes the left corner, so Clawd sits just left of the system tray instead.
- **Server down:** the page shows its existing offline state. The program retries quietly and never starts the server itself; the existing `bin/autostart.mjs --install` covers that, and the README says to use both.
- **Install:** `DeskCompanionTaskbar.exe --install` adds a Startup shortcut, `--remove` takes it away, and `--status` reports it, mirroring `bin/autostart.mjs`. Right-clicking Clawd gives a small menu: Pin, Start with Windows, Quit.
- **Distribution:** a zip on the GitHub release (exe + DLLs), plus build-from-source steps in `windows/README.md` and a short section in the main README.

## Left to the builder

- How to keep the corner above the taskbar reliably: re-asserting top-most on taskbar activation, parenting into `Shell_TrayWnd`, or similar. Pick what survives clicking the taskbar and Explorer restarts.
- Finding the taskbar's rectangle, alignment and auto-hide state (`SHAppBarMessage`, the `TaskbarAl` registry value).
- The corner window's exact width, and Clawd's scale inside it.
- Tests: node tests for the page-flag logic. The C# side is checked by hand on the PC, using the isolated-server pattern so the live server isn't touched.
- Whether CI builds the exe (a Windows runner job), or it's built locally at release time.
