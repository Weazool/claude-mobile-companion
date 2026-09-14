import path from 'node:path';

// Spec §3 build/test pattern. It is tested against the FULL command here; only the boolean leaves the forwarder.
export const BUILD_RE = /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|^(pytest|jest|vitest|tsc|make|mvn|gradle)\b|^(cargo|go|dotnet)\s+(build|test)\b|^pio\s+run\b/;

const SAFE_WORD = /^[\w.\-/]+$/;
const PASS = ['tool_name', 'notification_type', 'source', 'permission_mode'];
const str = v => (typeof v === 'string' ? v : '');

// Up to three leading words, stopping at the first word that could carry a secret (quotes, =, $ …).
export function bashTarget(command) {
  const words = String(command || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words.slice(0, 3)) {
    if (!SAFE_WORD.test(w)) break;
    out.push(w);
  }
  return out.join(' ').slice(0, 24);
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
      const cmd = String(input.command || '').trim();
      out.target = bashTarget(cmd);
      out.build = BUILD_RE.test(cmd);
    } else {
      out.target = fileTarget(input);
    }
  }
  return out;
}
