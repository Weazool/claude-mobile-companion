import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, bashTarget, fileTarget, BUILD_RE } from '../src/hook/sanitize.mjs';

test('keeps only whitelisted fields and never leaks prompts, inputs or outputs', () => {
  const raw = {
    hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\p\\proj', transcript_path: 'C:\\t.jsonl',
    prompt: 'SECRET-PROMPT', message: 'SECRET-MESSAGE', tool_name: 'Edit',
    tool_input: { file_path: 'C:\\p\\proj\\src\\server.mjs', old_string: 'SECRET-OLD', new_string: 'SECRET-NEW' },
    tool_response: { output: 'SECRET-OUTPUT' }, effort: { level: 'high' }, permission_mode: 'default',
  };
  const e = sanitize(raw, { CLAUDE_EFFORT: 'xhigh' }, 123);
  assert.deepEqual(e, {
    hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\p\\proj', transcript_path: 'C:\\t.jsonl',
    receivedAt: 123, effort: 'high', envEffort: 'xhigh', tool_name: 'Edit', permission_mode: 'default', target: 'server.mjs',
  });
  assert.doesNotMatch(JSON.stringify(e), /SECRET/);
});

test('bashTarget keeps up to three safe leading words, max 24 chars', () => {
  assert.equal(bashTarget('npm run build'), 'npm run build');
  assert.equal(bashTarget('  git   status  '), 'git status');
  assert.equal(bashTarget('curl -H "Authorization: Bearer abc"'), 'curl -H');
  assert.equal(bashTarget('export API_KEY=abc123'), 'export');
  assert.equal(bashTarget('echo $SECRET'), 'echo');
  assert.equal(bashTarget('a-very-long-program-name-here --flag'), 'a-very-long-program-name');
  assert.equal(bashTarget(''), '');
});

test('build flag is computed from the full command', () => {
  const b = cmd => sanitize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: cmd } }).build;
  assert.equal(b('npm run build'), true);
  assert.equal(b('npm test'), true);
  assert.equal(b('cargo test --release'), true);
  assert.equal(b('pio run -t upload'), true);
  assert.equal(b('npm install'), false);
  assert.equal(b('git status'), false);
  assert.ok(BUILD_RE.test('pytest -q'));
});

test('fileTarget takes the basename of file_path, notebook_path or path', () => {
  assert.equal(fileTarget({ file_path: 'C:\\x\\y\\server.mjs' }), 'server.mjs');
  assert.equal(fileTarget({ notebook_path: '/a/b/n.ipynb' }), 'n.ipynb');
  assert.equal(fileTarget({ path: '/a/b/' }), 'b');
  assert.equal(fileTarget({ pattern: '**/*.js' }), '');
  assert.equal(fileTarget(undefined), '');
});

test('model, effort and error accept string or object forms', () => {
  const e = sanitize({ hook_event_name: 'StopFailure', session_id: 's', model: { id: 'claude-opus-5' }, effort: 'max', error: { type: 'rate_limit' } });
  assert.equal(e.model, 'claude-opus-5');
  assert.equal(e.effort, 'max');
  assert.equal(e.error, 'rate_limit');
  assert.equal(sanitize({ hook_event_name: 'StopFailure', session_id: 's', error: 'rate_limit' }).error, 'rate_limit');
});

test('garbage input yields empty required fields', () => {
  const e = sanitize(null, {}, 5);
  assert.deepEqual(e, { hook_event_name: '', session_id: '', cwd: '', transcript_path: '', receivedAt: 5 });
});
