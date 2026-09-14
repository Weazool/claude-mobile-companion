import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'StopFailure'];
const CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hook.mjs"';

test('hooks.json registers the forwarder for exactly the 8 events', () => {
  const { hooks } = read('hooks/hooks.json');
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort());
  for (const e of EVENTS) {
    assert.equal(hooks[e].length, 1, e);
    const entry = hooks[e][0];
    if (e === 'PreToolUse' || e === 'PostToolUse') assert.equal(entry.matcher, '*', e);
    assert.deepEqual(entry.hooks, [{ type: 'command', command: CMD, timeout: 5 }], e);
  }
});

test('plugin and marketplace manifests agree on the name', () => {
  assert.equal(read('.claude-plugin/plugin.json').name, 'desk-companion');
  const m = read('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'desk-companion');
  assert.equal(m.plugins[0].name, 'desk-companion');
  assert.equal(m.plugins[0].source, './');
  assert.equal(read('package.json').version, read('.claude-plugin/plugin.json').version);
});
