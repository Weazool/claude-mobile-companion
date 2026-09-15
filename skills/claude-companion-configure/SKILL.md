---
name: claude-companion-configure
description: Open the page where the user picks which animation Clawd plays for each behaviour. Use when the user wants to configure or customise the desk companion.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs" --configure)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/pair.mjs" --configure`

Tell the user in one or two short lines that the behaviours page has opened in their PC's browser (give the URL printed above): they pick an animation per behaviour and click Save, and the phone switches over at once. If the output says the server could not start, point them to ~/.desk-companion/server.log.
