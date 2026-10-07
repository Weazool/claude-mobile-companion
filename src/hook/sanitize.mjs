import path from 'node:path';

// Spec §3 build/test pattern. It is tested here against the command after any leading `cd <dir> &&` segments
// and NAME=value assignments; only the boolean leaves the forwarder.
export const BUILD_RE = /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|^(pytest|jest|vitest|tsc|make|mvn|gradle)\b|^(cargo|go|dotnet)\s+(build|test)\b|^pio\s+run\b/;

// Programs whose first argument is a subcommand worth showing: `git status`, `npm test`.
export const SUBCOMMAND_PROGRAMS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'cargo', 'go', 'dotnet', 'docker',
  'kubectl', 'gh', 'pip', 'pip3', 'uv', 'poetry', 'make', 'gradle', 'mvn', 'deno', 'brew', 'winget', 'claude']);
const PROGRAM_RE = /^[A-Za-z0-9][\w.+-]{0,23}$/;
const SUBCOMMAND_RE = /^[a-z][a-z0-9-]{0,15}$/;
// A leading `cd <dir> &&` or `cd <dir>;` segment, or a `NAME=value ` assignment.
const PREFIX = /^(?:cd\s+(?:"[^"]*"|'[^']*'|[^\s"';&|])+\s*(?:&&|;)|[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s"'])*(?=\s))\s*/;
// The first shell word, with its quotes kept, so a quoted path stays one word.
const WORD = /^(?:"[^"]*"?|'[^']*'?|[^\s"'])+/;
const PASS = ['tool_name', 'notification_type', 'source', 'permission_mode'];
const ENDED = new Set(['completed', 'failed', 'killed', 'stopped']);
const str = v => (typeof v === 'string' ? v : '');

// The command without its leading `cd <dir> &&` / `cd <dir>;` segments and NAME=value assignments.
export function commandBody(command) {
  let s = String(command || '').trim();
  for (let m = PREFIX.exec(s); m; m = PREFIX.exec(s)) s = s.slice(m[0].length);
  return s;
}

// What the phone may see of a command: the program's name and, for common dev tools, one plain subcommand
// word. Arguments carry passwords, tokens and paths, so nothing else from the command line is forwarded.
export function bashTarget(command) {
  const s = commandBody(command);
  const first = WORD.exec(s);
  if (!first) return '';
  const program = first[0].split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
  if (!PROGRAM_RE.test(program)) return '';
  const next = (/^\s*(\S+)/.exec(s.slice(first[0].length)) || [])[1] || '';
  const out = SUBCOMMAND_PROGRAMS.has(program) && SUBCOMMAND_RE.test(next) ? `${program} ${next}` : program;
  return out.slice(0, 24);
}

export function fileTarget(input) {
  const p = input && (input.file_path || input.notebook_path || input.path);
  if (typeof p !== 'string' || !p) return '';
  return path.posix.basename(p.replace(/\\/g, '/')).slice(0, 40);
}

// Free text from Claude Code (a task's description) as one short line, cut at max with an ellipsis.
export function oneLine(v, max = 80) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const MAX_TASKS = 20;
const KINDS = new Set(['shell', 'subagent', 'monitor', 'workflow']);
const WAITING = new Set(['pending', 'paused']);
// One background task as the phone may see it: its kind, a label and a detail line. The label is a shell's program
// (and one subcommand, as for Bash: never its arguments), a workflow's name, else the description Claude gave the
// task; the detail is that description, an agent's type or a monitor's MCP tool. A shell's description stays behind
// when it looks like the command itself (Claude Code falls back to the command when there is none). The id only
// goes as far as the server, which times the task by it.
function taskOf(t) {
  const kind = KINDS.has(t.type) ? t.type : 'task';
  const desc = oneLine(t.description);
  let label = desc;
  let detail = '';
  if (kind === 'shell') {
    const cmd = commandBody(str(t.command));
    const target = bashTarget(cmd);
    const program = target.split(' ')[0].toLowerCase();
    const isCommand = !desc || (program && desc.toLowerCase().startsWith(program)) || cmd.startsWith(desc);
    label = target || (isCommand ? '' : desc);
    detail = isCommand || label === desc ? '' : desc;
  } else if (kind === 'workflow') {
    label = oneLine(t.name, 60) || desc;
    detail = label === desc ? '' : desc;
  } else if (kind === 'subagent') {
    detail = oneLine(t.agent_type, 40);
    if (!label) [label, detail] = [detail, ''];
  } else if (kind === 'monitor') {
    detail = oneLine(t.tool, 40);
  }
  const status = WAITING.has(t.status) ? t.status : 'running';
  return { id: oneLine(t.id, 64), kind, label: label || '', detail, status };
}

// Whitelist only (spec §1). Prompts, tool inputs and tool outputs never pass.
export function sanitize(raw, env = {}, now = Date.now()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    hook_event_name: str(r.hook_event_name),
    session_id: str(r.session_id),
    cwd: str(r.cwd),
    transcript_path: str(r.transcript_path),
    receivedAt: now,
  };
  const model = typeof r.model === 'string' ? r.model : (r.model && typeof r.model.id === 'string' ? r.model.id : '');
  if (model) out.model = model;
  const effort = r.effort && typeof r.effort === 'object' ? r.effort.level : r.effort;
  if (typeof effort === 'string' && effort) out.effort = effort;
  if (typeof env.CLAUDE_EFFORT === 'string' && env.CLAUDE_EFFORT) out.envEffort = env.CLAUDE_EFFORT;
  for (const k of PASS) if (typeof r[k] === 'string') out[k] = r[k];
  // A subagent's hooks (an Agent call, a workflow's agents) carry its parent's session id and its own agent_id.
  if (typeof r.agent_id === 'string' && r.agent_id) out.subagent = true;
  // Stop lists the session's background work in flight: shells, subagents, monitors, workflows. How many, and each
  // one as the tasks card shows it (taskOf); the first MAX_TASKS of them.
  if (Array.isArray(r.background_tasks)) {
    const live = r.background_tasks.filter(t => t && typeof t === 'object' && !ENDED.has(t.status));
    out.background = live.length;
    out.tasks = live.slice(0, MAX_TASKS).map(taskOf);
  }
  // A tool call that sends work to the background says which task it started, so the card can time it from then.
  const res = r.tool_response && typeof r.tool_response === 'object' ? r.tool_response : null;
  const launched = res && (res.backgroundTaskId || (res.status === 'async_launched' ? res.agentId || res.taskId : ''));
  if (out.hook_event_name === 'PostToolUse' && typeof launched === 'string' && launched) out.launched = launched.slice(0, 64);
  const err = typeof r.error === 'string' ? r.error : (r.error && typeof r.error.type === 'string' ? r.error.type : '');
  if (err) out.error = err;
  if (out.tool_name) {
    const input = r.tool_input && typeof r.tool_input === 'object' ? r.tool_input : {};
    if (out.tool_name === 'Bash') {
      const cmd = String(input.command || '');
      out.target = bashTarget(cmd);
      out.build = BUILD_RE.test(commandBody(cmd));
    } else {
      out.target = fileTarget(input);
    }
  }
  return out;
}
