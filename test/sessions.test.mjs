import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, classify, modelLabel, EXPIRE_MS } from '../src/server/sessions.mjs';

const ev = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: 's1', cwd: 'C:\\Users\\weazo\\GitHub\\my_claude_companion', ...extra });

test('modelLabel', () => {
  assert.equal(modelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-opus-5[1m]'), 'Opus 5');
  assert.equal(modelLabel('<synthetic>'), null);
  assert.equal(modelLabel('gpt-x'), 'gpt-x');
});

test('classify maps tools to activity and detail', () => {
  const pre = (tool_name, extra = {}) => classify({ hook_event_name: 'PreToolUse', tool_name, ...extra });
  assert.deepEqual(pre('Read', { target: 'hooks.json' }), { needsYou: false, activity: 'reading', detail: 'Reading hooks.json' });
  assert.equal(pre('Grep').detail, 'Searching');
  assert.equal(pre('WebFetch').detail, 'Browsing');
  assert.deepEqual(pre('Edit', { target: 'server.mjs' }), { needsYou: false, activity: 'working', detail: 'Editing server.mjs' });
  assert.equal(pre('Write', { target: 'a.md' }).detail, 'Writing a.md');
  assert.deepEqual(pre('Bash', { target: 'npm test', build: true }), { needsYou: false, activity: 'compiling', detail: 'Running npm test' });
  assert.deepEqual(pre('Bash', { target: 'git status' }), { needsYou: false, activity: 'working', detail: 'Running git status' });
  assert.equal(pre('Bash').detail, 'Running a command');
  assert.equal(pre('Task').detail, 'Delegating');
  assert.equal(pre('mcp__server__tool_with_a_long_name').detail, 'Tool with a long name');
  assert.equal(pre('mcp__4afbfe35-266b-44fc-b6f2-16c9d565cd93__search_threads').detail, 'Search threads');
  assert.equal(pre('mcp__plugin_x_srv__get_page_text_and_more_words').detail, 'Get page text and more w');
  assert.equal(pre('mcp__odd__').detail, 'mcp__odd__');
  assert.equal(pre('SomeBrandNewToolWithALongName').detail, 'SomeBrandNewToolWithALon');
  assert.deepEqual(pre('AskUserQuestion'), { needsYou: true, detail: 'Has a question', discrete: 'needsYou' });
  assert.deepEqual(pre('ExitPlanMode'), { needsYou: true, detail: 'Plan ready for review', discrete: 'needsYou' });
  assert.equal(classify({ hook_event_name: 'Nope' }), null);
});

test('a turn: start, prompt, notification, tool, stop', () => {
  const st = new SessionStore();
  assert.deepEqual(st.apply(ev('SessionStart', { model: 'claude-opus-5' }), 1000), { discrete: 'sessionStart' });
  let [s] = st.list();
  assert.equal(s.name, 'my_claude_companion');
  assert.equal(s.modelLabel, 'Opus 5');
  assert.equal(s.activity, 'idle');

  assert.deepEqual(st.apply(ev('UserPromptSubmit'), 2000), { discrete: 'prompt' });
  assert.equal(st.list()[0].activity, 'thinking');

  assert.deepEqual(st.apply(ev('Notification', { notification_type: 'permission_prompt' }), 3000), { discrete: 'needsYou' });
  [s] = st.list();
  assert.equal(s.needsYou, true);
  assert.equal(s.activity, 'thinking');
  assert.equal(s.detail, 'Needs permission');

  st.apply(ev('PreToolUse', { tool_name: 'Bash', target: 'npm test', build: true }), 4000);
  [s] = st.list();
  assert.equal(s.needsYou, false);
  assert.equal(s.activity, 'compiling');

  assert.deepEqual(st.apply(ev('Stop'), 5000), { discrete: 'stop' });
  assert.equal(st.list()[0].activity, 'done');
  assert.equal(st.list()[0].detail, 'Your turn');
});

test('classify: Notification types', () => {
  const n = notification_type => classify({ hook_event_name: 'Notification', notification_type });
  assert.deepEqual(n('permission_prompt'), { needsYou: true, detail: 'Needs permission', discrete: 'needsYou' });
  assert.deepEqual(n('elicitation_dialog'), { needsYou: true, detail: 'Has a question', discrete: 'needsYou' });
  assert.deepEqual(n('idle_prompt'), { detail: 'Waiting for you' });
  assert.equal(n('auth_success'), null);
  assert.deepEqual(n('something_new'), { needsYou: true, detail: 'Needs you', discrete: 'needsYou' });
  assert.deepEqual(n(undefined), { needsYou: true, detail: 'Needs you', discrete: 'needsYou' });
});

test('Notification types through the store: session A is done, session B is compiling', () => {
  const after = type => {
    const st = new SessionStore();
    st.apply({ ...ev('PreToolUse', { tool_name: 'Bash', target: 'npm test', build: true }), session_id: 'B' }, 1000);
    st.apply({ ...ev('Stop'), session_id: 'A' }, 2000);
    const r = st.apply({ ...ev('Notification', { notification_type: type }), session_id: 'A' }, 62000);
    const a = st.list().find(s => s.id === 'A');
    return { r, needsYou: a.needsYou, detail: a.detail, activity: a.activity, focus: st.focusId() };
  };
  assert.deepEqual(after('permission_prompt'),
    { r: { discrete: 'needsYou' }, needsYou: true, detail: 'Needs permission', activity: 'done', focus: 'A' });
  assert.deepEqual(after('elicitation_dialog'),
    { r: { discrete: 'needsYou' }, needsYou: true, detail: 'Has a question', activity: 'done', focus: 'A' });
  // idle_prompt comes about a minute after every Stop: a softer detail, never needsYou, never the focus.
  assert.deepEqual(after('idle_prompt'),
    { r: { discrete: null }, needsYou: false, detail: 'Waiting for you', activity: 'done', focus: 'B' });
  assert.deepEqual(after('auth_success'),
    { r: null, needsYou: false, detail: 'Your turn', activity: 'done', focus: 'B' });
  assert.deepEqual(after('something_new'),
    { r: { discrete: 'needsYou' }, needsYou: true, detail: 'Needs you', activity: 'done', focus: 'A' });
});

test('StopFailure distinguishes rate limits from other errors', () => {
  const st = new SessionStore();
  assert.deepEqual(st.apply(ev('StopFailure', { error: 'rate_limit' }), 1), { discrete: 'rateLimited' });
  assert.equal(st.list()[0].activity, 'rateLimited');
  assert.deepEqual(st.apply(ev('StopFailure', { error: 'server_error' }), 2), { discrete: 'error' });
  assert.equal(st.list()[0].activity, 'error');
});

test('effort precedence: payload, then CLAUDE_EFFORT, then transcript', () => {
  const st = new SessionStore();
  st.apply(ev('UserPromptSubmit'), 1, { model: null, effort: 'low', contextTokens: null });
  assert.equal(st.list()[0].effort, 'low');
  st.apply(ev('PreToolUse', { tool_name: 'Read', envEffort: 'high' }), 2, { model: null, effort: 'low', contextTokens: null });
  assert.equal(st.list()[0].effort, 'high');
  st.apply(ev('PreToolUse', { tool_name: 'Read', effort: 'max', envEffort: 'high' }), 3);
  assert.equal(st.list()[0].effort, 'max');
});

test('transcript tail supplies model and context percent', () => {
  const st = new SessionStore({ contextWindow: {} });
  st.apply(ev('UserPromptSubmit'), 1, { model: 'claude-fable-5-1', effort: null, contextTokens: 250000 });
  const [s] = st.list();
  assert.equal(s.modelLabel, 'Fable 5.1');
  assert.equal(s.contextPct, 25);
});

test('focus: needsYou beats active beats most recent', () => {
  const st = new SessionStore();
  st.apply({ ...ev('UserPromptSubmit'), session_id: 'A' }, 1000);
  st.apply({ ...ev('Stop'), session_id: 'B' }, 2000);
  assert.equal(st.focusId(), 'A');
  st.apply({ ...ev('Notification'), session_id: 'B' }, 3000);
  assert.equal(st.focusId(), 'B');
  st.apply({ ...ev('PostToolUse'), session_id: 'B' }, 4000);
  assert.equal(st.focusId(), 'B');
  st.apply({ ...ev('Stop'), session_id: 'A' }, 5000);
  st.apply({ ...ev('Stop'), session_id: 'B' }, 6000);
  assert.equal(st.focusId(), 'B');
  assert.equal(new SessionStore().focusId(), null);
});

test('SessionEnd removes, expire drops silent sessions, list is ordered by start', () => {
  const st = new SessionStore();
  st.apply({ ...ev('SessionStart'), session_id: 'A' }, 1000);
  st.apply({ ...ev('SessionStart'), session_id: 'B' }, 2000);
  st.apply({ ...ev('UserPromptSubmit'), session_id: 'A' }, 3000);
  assert.deepEqual(st.list().map(s => s.id), ['A', 'B']);
  assert.deepEqual(Object.keys(st.list()[0]).sort(),
    ['activity', 'contextPct', 'detail', 'effort', 'id', 'lastEventAt', 'modelLabel', 'name', 'needsYou']);
  st.apply({ ...ev('SessionEnd'), session_id: 'A' }, 4000);
  assert.deepEqual(st.list().map(s => s.id), ['B']);
  assert.equal(st.expire(2000 + EXPIRE_MS), false);
  assert.equal(st.expire(2001 + EXPIRE_MS), true);
  assert.deepEqual(st.list(), []);
});

test('unknown events and events without session_id change nothing', () => {
  const st = new SessionStore();
  assert.equal(st.apply({ hook_event_name: 'Weird', session_id: 's' }, 1), null);
  assert.equal(st.apply({ hook_event_name: 'Stop' }, 1), null);
  assert.deepEqual(st.list(), []);
});
