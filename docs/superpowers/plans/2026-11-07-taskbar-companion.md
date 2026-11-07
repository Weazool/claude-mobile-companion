# Taskbar Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional Windows program that keeps an animated Clawd in the taskbar's left corner and opens the full dashboard in a small window when the mouse rests on him.

**Architecture:** Two page flags (`?corner`, `?pc`) let the existing dashboard page run inside a desktop host: the corner flag shows only Clawd, and both flags turn off the phone-only behaviour (keep-awake, full screen). A C# WinForms program in `windows/` hosts two WebView2 windows on `http://localhost:<port>/`: a borderless corner window kept above the taskbar and a hover window. One 100 ms timer drives placement, top-most, hover and hiding.

**Tech Stack:** Vanilla JS ES modules + `node --test` (page); C# on .NET Framework 4.8, WinForms, `Microsoft.Web.WebView2` (NuGet), built with the .NET 9 SDK.

**Spec:** `docs/superpowers/specs/2026-11-07-taskbar-companion-design.md`

## Global Constraints

- Windows 11 only; the program targets `net48` (built into Windows 11), so users install no runtime.
- Nothing changes for the phone: with neither flag, the page behaves exactly as today. All 304 existing tests stay green.
- The program never changes Windows settings, never starts the server, and never takes focus on hover.
- URL: `http://localhost:<port>/?corner` and `http://localhost:<port>/?pc`, with the port read from `%USERPROFILE%\.desk-companion\config.json` (`"port": <n>`). Loopback needs no token, so the program never reads the token.
- The WebView2 user-data folder is `%LOCALAPPDATA%\desk-companion\taskbar\WebView2`.
- Only the primary monitor's taskbar.
- Work on `main`, and stage only this plan's files. Commit after each task; never push unless the user asks.
- After changing `src/`, bump the version to **0.14.0** in `package.json` and `.claude-plugin/plugin.json` (the marketplace file has no version). This happens in Task 5.

## Review Focus

1. **Explorer restarts or the taskbar changes** (a new `Shell_TrayWnd` handle, small taskbar icons, a different DPI). Clawd should come back at the right size within a second. This is a manual check in Task 2.
2. **The program starts before the server** (login order), or the server moves port. The corner should show the page's offline state, then come alive without a restart. This is a manual check in Task 4.
3. **Typing in another app while the pointer drifts over Clawd.** The hover window may open, but the keyboard focus must stay where it was. This is a manual check in Task 3.
4. **Two copies running** (Startup plus a manual start). The second copy should exit silently. This is a manual check in Task 2.
5. **The corner page lets the PC sleep** and never asks for full screen. This is a node test in Task 1 (`hostFlags`), plus a check in Task 1 that `navigator.wakeLock` is never requested.

---

### Task 1: Page flags and the corner view

**Files:**
- Create: `src/web/host.js`
- Modify: `src/web/app.js` (wire the flags; sections: companion, away, controls, drift; the Clawd click at line 163)
- Modify: `src/web/style.css` (append a `/* corner */` block)
- Test: `test/host.test.mjs`

**Interfaces:**
- Produces: `hostFlags(search: string) -> { mode: 'corner'|'pc'|null, keepAwake: boolean, fullscreen: boolean, away: boolean, drift: boolean }` in `src/web/host.js`.
- Produces messages from the page to the host: in corner mode, `chrome.webview.postMessage('click')` on a left click on `#mascot` and `'menu'` on `contextmenu` anywhere (default prevented); in pc mode, `'esc'` on `keydown` Escape. Guard every post with `window.chrome?.webview`.
- Produces a host-to-page message: a JSON `{ "bg": "#rrggbb" }` sets `document.body.style.background`. Task 2 uses it only if transparency fails.

- [ ] **Step 1: Write the failing test** `test/host.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostFlags } from '../src/web/host.js';

test('hostFlags: the phone (no flag) keeps everything', () => {
  assert.deepEqual(hostFlags(''), { mode: null, keepAwake: true, fullscreen: true, away: true, drift: true });
  assert.deepEqual(hostFlags('?k=abc'), { mode: null, keepAwake: true, fullscreen: true, away: true, drift: true });
});
test('hostFlags: the corner shows Clawd only and never holds the PC awake', () => {
  assert.deepEqual(hostFlags('?corner'), { mode: 'corner', keepAwake: false, fullscreen: false, away: false, drift: false });
});
test('hostFlags: the hover window is the phone page minus keep-awake and full screen', () => {
  assert.deepEqual(hostFlags('?pc'), { mode: 'pc', keepAwake: false, fullscreen: false, away: true, drift: true });
  assert.equal(hostFlags('?settle&pc').mode, 'pc');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/host.test.mjs`
Expected: FAIL, with "Cannot find module" for `host.js`.

- [ ] **Step 3: Implement `hostFlags` in `src/web/host.js`.** Use `URLSearchParams(search).has(...)`. If both flags are present, `corner` wins.

- [ ] **Step 4: Run it and see it pass**

Run: `node --test test/host.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the flags into `app.js`** (`const host = hostFlags(location.search)` near the top).
  - `keepAwake()`: return early when `!host.keepAwake`. The `holdAwake` path then never enables NoSleep.
  - `activate()`: skip `requestFullscreen` when `!host.fullscreen`.
  - `setAway()`: return when `!host.away`, so the corner keeps Clawd up while the mood is away.
  - `applyDrift()`: return (leaving `--dx/--dy` at 0) when `!host.drift`.
  - Add a class `host-corner` / `host-pc` on `<html>`.
  - Add the three `postMessage` hooks listed in Interfaces.
  - Add the `{bg}` listener.

- [ ] **Step 6: Add the corner CSS** (all scoped to `html.host-corner`):
  - `html`, `body` and `#app` backgrounds are `transparent`. `#app` has padding 0 and one grid cell.
  - `.data`, `.tasks`, `.deck`, `.rail`, `#offline`, `#dimmer`, `#bubble` and `.stage::before` get `display: none`.
  - `.stage` has `grid-area: 1/1/2/2`, `--cx: 50%`, `--cy: 50cqh` and `--mascot: calc(2.6 * 100cqh)`. Clawd's body (10 of the square's 32 units) then fills about 80% of the window's height. Effects that run past the window are clipped, and that's accepted.
  - `#mascot` has `cursor: default`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests (304 + 3).

- [ ] **Step 8: Check the views in headless Chrome against an isolated server** (the `DESK_COMPANION_HOME` scratch-server pattern; never the live server). Use a window 72×48 for `?corner&settle` and 960×443 for `?pc&settle`.
  - Expected for the corner: only Clawd, centred, with a transparent background (screenshot with `Emulation.setDefaultBackgroundColorOverride` alpha 0 shows no dark box).
  - Expected for pc: the normal dashboard.
  - Expected for both: `navigator.wakeLock.request` is never called. Wrap it in a prelude that counts calls; the count is 0 after a click.
  - Expected for the phone URL without flags: unchanged (a screenshot matches the current one).

- [ ] **Step 9: Commit**

```bash
git add src/web/host.js src/web/app.js src/web/style.css test/host.test.mjs
git commit -m "feat(web): ?corner and ?pc views for the Windows taskbar companion"
```

### Task 2: The corner window

**Files:**
- Create: `windows/DeskCompanionTaskbar.csproj`, `windows/Program.cs`, `windows/Dashboard.cs`, `windows/Taskbar.cs`, `windows/Placement.cs`, `windows/WebForm.cs`, `windows/CornerForm.cs`, `windows/Controller.cs`, `windows/.gitignore` (`bin/`, `obj/`)

**Interfaces:**
- Consumes: the `?corner` page and its `'click'` / `'menu'` messages (Task 1).
- Produces:
  - `Dashboard.BaseUrl() -> string?`: `http://localhost:<port>/`, or null when `config.json` is missing or has no port. Parse the port with the regex `"port"\s*:\s*(\d+)`, since there's no JSON library on net48.
  - `Taskbar.Read() -> TaskbarInfo?` with `Rectangle Bounds`, `bool AutoHide`, `bool LeftAligned`, `Rectangle? Tray`.
    - `Bounds` comes from `GetWindowRect(FindWindow("Shell_TrayWnd", null))`.
    - `AutoHide` comes from `SHAppBarMessage(ABM_GETSTATE) & ABS_AUTOHIDE`.
    - `LeftAligned` comes from `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced\TaskbarAl == 0`.
    - `Tray` is the rect of the `TrayNotifyWnd` child, if found.
  - `Placement.Corner(TaskbarInfo tb) -> Rectangle`: the height is `tb.Bounds.Height` and the width is `round(1.5 × height)`. Centred taskbar: at `tb.Bounds.Left`. Left-aligned taskbar: just left of `tb.Tray` (if `Tray` is null, at `tb.Bounds.Right − 25% of the width − the window's width`).
  - `WebForm : Form` (the WebView2 setup and window styles below) with `Task InitAsync(string url)`, `void Navigate(string url)`, `event Action<string> Message`, and `void PostJson(string json)`. `CornerForm : WebForm` adds only the transparency branch.
  - `Controller : ApplicationContext` owns the forms and one `System.Windows.Forms.Timer` (100 ms) with `void Tick()`.

- [ ] **Step 1: Scaffold the project.**
  - `Microsoft.NET.Sdk`, `<TargetFramework>net48</TargetFramework>`, `<UseWindowsForms>true</UseWindowsForms>`, `<OutputType>WinExe</OutputType>`, `<PlatformTarget>x64</PlatformTarget>`.
  - `<ApplicationManifest>` with PerMonitorV2 DPI awareness.
  - A `PackageReference` to `Microsoft.Web.WebView2` (the latest stable).
  - `AssemblyName` `DeskCompanionTaskbar`.

  Run: `dotnet build windows -c Release`
  Expected: Build succeeded, with `windows/bin/Release/net48/DeskCompanionTaskbar.exe` and `WebView2Loader.dll` in the output (copy the loader to the exe's folder if the package leaves it under `runtimes/`).

- [ ] **Step 2: `Program.Main`.**
  - A named mutex `Local\desk-companion-taskbar` keeps it to one instance; a second copy exits with code 0.
  - Then `Application.Run(new Controller())`.
  - The `--install` / `--remove` / `--status` arguments come in Task 4.

- [ ] **Step 3: `WebForm` and `CornerForm`.**
  - `FormBorderStyle.None`, `ShowInTaskbar = false`, `TopMost = true`.
  - Override `CreateParams` to add `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, and override `ShowWithoutActivation => true`.
  - A WebView2 docked to fill, created with `CoreWebView2Environment.CreateAsync(null, <user-data folder>)`.
  - Set `AreDefaultContextMenusEnabled = false`, `AreDevToolsEnabled = false`, `IsZoomControlEnabled = false`.
  - Raise `Message` from `WebMessageReceived` (`TryGetWebMessageAsString`).

- [ ] **Step 4: Transparency spike (decides one branch, then delete the other).**
  - **A, preferred:** set `BackColor = TransparencyKey = Color.FromArgb(255, 0, 255)` and `webView.DefaultBackgroundColor = Color.Transparent`.
  - Run it over the taskbar. Pass means you see the taskbar around Clawd, with no magenta or black box.
  - **B, if A fails:** keep an opaque window. On every `Tick`, read the screen pixel 2 px to the right of the corner window's right edge, at mid-height (`Graphics.CopyFromScreen` of a 1×1 bitmap). When it changes, call `PostJson("{\"bg\":\"#rrggbb\"}")`.
  - Write which branch won, and why, as one line in `windows/README.md` (created in Task 5, so note it in the commit message for now).

- [ ] **Step 5: `Controller.Tick`, placement and top-most.**
  1. `Taskbar.Read()`. If null (Explorer restarting), hide the corner and return.
  2. Hide the corner when `AutoHide`.
  3. Set `Bounds = Placement.Corner(tb)` when it changed.
  4. Call `SetWindowPos(corner, HWND_TOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)`. This keeps him above the taskbar after it's clicked.

  Load the URL from `Dashboard.BaseUrl() + "?corner"` once at start. If it's null, retry every 5 s.

- [ ] **Step 6: Manual check on the PC** (Widgets turned off, the live server running; the page needs the Task 1 change, so point it at an isolated server running from the repo with `config.json`'s port, or restart the live server from the repo as in project memory).
  - Clawd animates in the left corner at taskbar height.
  - Clicking the taskbar and opening Start leaves him visible.
  - `taskkill /f /im explorer.exe && start explorer.exe` brings him back within a second.
  - Switching the taskbar to left-aligned moves him next to the tray.
  - At 125% and 150% scaling he still fills the taskbar's height.
  - Starting a second copy changes nothing.

- [ ] **Step 7: Commit**

```bash
git add windows/
git commit -m "feat(windows): taskbar corner window with Clawd (transparency: <A|B>)"
```

### Task 3: The hover window

**Files:**
- Create: `windows/HoverForm.cs`
- Modify: `windows/Placement.cs`, `windows/Controller.cs`

**Interfaces:**
- Consumes: `CornerForm`, `Placement.Corner`, and the corner's `'click'` message (Task 2); the `?pc` page and its `'esc'` message (Task 1).
- Produces:
  - `Placement.Hover(Rectangle corner, Rectangle workArea) -> Rectangle`: the width is `round(workArea.Width / 2)` and the height is `round(width × 430 / 932)`. The bottom edge sits on the corner's top, and the left edge on the corner's left, clamped inside `workArea` (`Screen.PrimaryScreen.WorkingArea`).
  - `HoverForm : WebForm` loads `BaseUrl + "?pc"` once at start and stays hidden.

- [ ] **Step 1: Hover timing in `Tick`.** Read `Cursor.Position` against both windows' bounds. The constants are `OpenAfterMs = 300` and `CloseAfterMs = 1000`.
  - The pointer on the corner continuously for ≥ 300 ms → show the hover window with `ShowWindow(SW_SHOWNOACTIVATE)` and place it with `Placement.Hover`.
  - The pointer outside both windows continuously for ≥ 1000 ms, and not pinned → hide it.

- [ ] **Step 2: Pin.**
  - The corner's `'click'` toggles `pinned`. Pinning shows the hover window at once; unpinning hides it.
  - The hover window's `'esc'` unpins and hides it.
  - Clicking inside the pinned hover window may activate it (‹ › need clicks). Only the hover-open path must not.

- [ ] **Step 3: Manual check.**
  - Resting on Clawd opens the dashboard above him in about 0.3 s; passing quickly across doesn't.
  - Moving into the window keeps it open, and leaving closes it after about 1 s.
  - Clicking Clawd pins it; clicking him again or pressing Esc in it closes it.
  - ‹ › and the ✕ work inside it.
  - **Review Focus 3:** while typing in Notepad, rest the pointer on Clawd until the window opens. The typing still lands in Notepad.

- [ ] **Step 4: Commit**

```bash
git add windows/
git commit -m "feat(windows): hover window with the dashboard, pin and Esc"
```

### Task 4: Staying out of the way, the menu, and starting with Windows

**Files:**
- Create: `windows/Autostart.cs`
- Modify: `windows/Taskbar.cs`, `windows/Controller.cs`, `windows/Program.cs`

**Interfaces:**
- Consumes: `Controller`, `Taskbar`, the corner's `'menu'` message.
- Produces:
  - `Taskbar.FullscreenBusy() -> bool`: true when `SHQueryUserNotificationState` returns `QUNS_BUSY`, `QUNS_RUNNING_D3D_FULL_SCREEN` or `QUNS_PRESENTATION_MODE`.
  - `Autostart.Install() / Remove() -> (bool ok, string message)` and `Autostart.Status() -> string`. The shortcut is `desk-companion-taskbar.lnk` in the Startup folder (`Environment.SpecialFolder.Startup`), pointing at the running exe, made through `WScript.Shell` COM (`Type.GetTypeFromProgID` + `dynamic`). The messages mirror `src/server/autostart.mjs`.

- [ ] **Step 1: Hiding.** In `Tick`, when `FullscreenBusy()`, hide both windows and unpin; show the corner again once it's false.

- [ ] **Step 2: Right-click menu.**
  - On `'menu'`, show a `ContextMenuStrip` at `Cursor.Position` with three items:
    - **Pin**, checked when pinned.
    - **Start with Windows**, checked from `Autostart.Status()`; it toggles `Install`/`Remove`.
    - **Quit**, which exits the application.

- [ ] **Step 3: Arguments.**
  - `Program.Main` handles `--install`, `--remove` and `--status`. It prints the message to the parent console (`AttachConsole(ATTACH_PARENT_PROCESS)`, since it's a WinExe) and exits 0 on ok, 1 on failure, without starting the UI.

- [ ] **Step 4: Server down or moved.**
  - Every 5 s, re-read `Dashboard.BaseUrl()`. When the port differs from the loaded one, call `Navigate` on both views with the new URL.
  - Otherwise leave reconnection to the page (it already retries and shows its offline state).

- [ ] **Step 5: Manual check.**
  - A full-screen video or game hides Clawd, and he returns after.
  - The menu works, and Start with Windows creates and removes the `.lnk`.
  - `DeskCompanionTaskbar.exe --status` prints Off or On.
  - **Review Focus 2:** stop the server, so the corner shows Clawd offline; start it, and he comes alive with no restart. Change `config.json`'s port on an isolated server, and both views follow within 5 s.
  - Log off and on with autostart on: Clawd appears.

- [ ] **Step 6: Commit**

```bash
git add windows/
git commit -m "feat(windows): hide for full screen, right-click menu, start with Windows"
```

### Task 5: Docs, version and the release zip

**Files:**
- Create: `windows/README.md`, `windows/pack.ps1`
- Modify: `README.md` (a short "On your Windows taskbar" section after "Pair your phone"), `package.json`, `.claude-plugin/plugin.json` (0.14.0), `docs/superpowers/specs/CHANGES-SINCE-SPEC.md` (one entry)

**Interfaces:**
- Consumes: everything above.
- Produces: `windows/pack.ps1`, which runs `dotnet build windows -c Release` and zips the exe, the managed WebView2 DLLs and `WebView2Loader.dll` into `windows/dist/DeskCompanionTaskbar-<version>.zip`. The version comes from `package.json`. Add `dist/` to `windows/.gitignore`.

- [ ] **Step 1: `windows/README.md`.** Keep it short and in the main README's voice, covering:
  - What it is.
  - It needs desk-companion **0.14.0+** and the server running; `node bin/autostart.mjs --install` is recommended.
  - Turn off Widgets (Settings → Personalization → Taskbar → Widgets).
  - Unzip anywhere, run it, and use right-click → Start with Windows.
  - Hover, click to pin, Esc.
  - Build from source (`.NET SDK 6+`, `dotnet build windows -c Release`).
  - The transparency branch line from Task 2.

  The main README gets a three-line section linking to it.

- [ ] **Step 2: Bump to 0.14.0** in `package.json` and `plugin.json`. Run `npm test`; expected PASS (the manifest test checks they agree).

- [ ] **Step 3: Run `powershell -File windows/pack.ps1`.** Expected: the zip exists. Unzipped into a scratch folder, the exe runs from there and shows Clawd.

- [ ] **Step 4: Commit**

```bash
git add windows/README.md windows/pack.ps1 windows/.gitignore README.md package.json .claude-plugin/plugin.json docs/superpowers/specs/CHANGES-SINCE-SPEC.md
git commit -m "docs: Windows taskbar companion; 0.14.0"
```

Installing the plugin update, restarting the live server, pushing and the GitHub release (with the zip attached) happen only when the user asks.
