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
