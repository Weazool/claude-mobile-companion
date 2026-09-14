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

const bash = command => sanitize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command } });

test('bashTarget: the program name, plus one subcommand for common dev tools', () => {
  const cases = [
    ['npm test', 'npm test'],
    ['git status', 'git status'],
    ['cargo build --release', 'cargo build'],
    ['cd /c/Users/weazo/GitHub/my_claude_companion && git status', 'git status'],
    ['mysql -uroot -pS3cr3tPw app', 'mysql'],
    ['sshpass -p hunter2 ssh host', 'sshpass'],
    ['redis-cli -a Pa55word ping', 'redis-cli'],
    ['echo hunter2', 'echo'],
    ['FOO=bar npm test', 'npm test'],
    ['/usr/local/bin/node --test', 'node'],
    ['"C:\\Program Files\\x.exe" y', ''],
    ['ls -la', 'ls'],
  ];
  for (const [cmd, want] of cases) {
    assert.equal(bashTarget(cmd), want, cmd);
    assert.equal(bash(cmd).target, want, `sanitize: ${cmd}`);
  }
});

test('bashTarget: arguments, paths and secrets never pass', () => {
  assert.equal(bashTarget('npm run build'), 'npm run'); // was 'npm run build' (three words)
  assert.equal(bashTarget('  git   status  '), 'git status');
  assert.equal(bashTarget('curl -H "Authorization: Bearer abc"'), 'curl'); // was 'curl -H'
  assert.equal(bashTarget('export API_KEY=abc123'), 'export');
  assert.equal(bashTarget('echo $SECRET'), 'echo');
  assert.equal(bashTarget('a-very-long-program-name-here --flag'), ''); // was cut to 24 chars; now not a program name
  assert.equal(bashTarget(''), '');
  assert.equal(bashTarget('cd "C:\\My Projects\\app"; cd sub && API_KEY=sk-123 TOKEN="a b" npm test'), 'npm test');
  assert.equal(bashTarget('C:\\tools\\git.exe -C /x status'), 'git');
  assert.equal(bashTarget('npm.cmd install left-pad'), 'npm install');
  assert.equal(bashTarget('git push https://tok@github.com/x.git'), 'git push');
  assert.equal(bashTarget('echo sk-ant-api03-AbCdEf'), 'echo');
  assert.equal(bashTarget('cat /Users/bob/.ssh/id_ed25519'), 'cat');
  assert.equal(bashTarget('cd /c/Users/bob/secret-project'), 'cd');
  assert.equal(bashTarget('API_KEY=abc'), '');
  assert.equal(bashTarget('$(cat secret) --x'), '');
  assert.equal(bashTarget('kubectl a-very-long-subcommand'), 'kubectl');
  assert.equal(bashTarget('git S3cret'), 'git');
  const e = bash('cd /c/Users/SECRET-USER/proj && mysql -uroot -pSECRET-PW app');
  assert.equal(e.target, 'mysql');
  assert.doesNotMatch(JSON.stringify(e), /SECRET/);
});

test('build flag is computed from the command after cd and assignment prefixes', () => {
  const b = cmd => bash(cmd).build;
  assert.equal(b('npm run build'), true);
  assert.equal(b('npm test'), true);
  assert.equal(b('cargo test --release'), true);
  assert.equal(b('pio run -t upload'), true);
  assert.equal(b('npm install'), false);
  assert.equal(b('git status'), false);
  assert.ok(BUILD_RE.test('pytest -q'));
});

test('build flag skips leading cd segments and assignments', () => {
  assert.deepEqual([bash('cd /x && npm run build').build, bash('cd /x && npm run build').target], [true, 'npm run']);
  assert.equal(bash('cd /x; FOO=1 cargo test').build, true);
  assert.equal(bash('cd /x && git status').build, false);
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
