---
name: pair
description: Show the desk-companion phone link and open a QR code to scan. Use when the user wants to open desk-companion on their phone.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs")
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs"`

Tell the user, in two or three short lines: the phone URL printed above, that a QR code and a live preview of the dashboard have opened in their PC's browser, and that on iPhone they can use Share → Add to Home Screen for full screen. If the output says the server could not start, point them to ~/.desk-companion/server.log.
