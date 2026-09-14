import path from 'node:path';
import { contextPct } from './transcript.mjs';

export const EXPIRE_MS = 60 * 60 * 1000;
export const ACTIVE = new Set(['thinking', 'reading', 'working', 'compiling']);

const READ = new Set(['Read', 'NotebookRead']);
const SEARCH = new Set(['Grep', 'Glob', 'LS']);
const WEB = new Set(['WebFetch', 'WebSearch']);
const EDIT = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

// claude-opus-5 → "Opus 5", claude-fable-5-1 → "Fable 5.1", claude-haiku-4-5-20251001 → "Haiku 4.5".
export function modelLabel(id) {
  if (!id || id === '<synthetic>') return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

// mcp__<server>__<tool_name> → "Tool name"; other tool names pass through. Max 24 chars.
function toolLabel(name) {
  if (name.startsWith('mcp__') && name.lastIndexOf('__') > 3) {
    const tool = name.slice(name.lastIndexOf('__') + 2).replace(/_/g, ' ').trim();
    if (tool) return (tool[0].toUpperCase() + tool.slice(1)).slice(0, 24);
  }
  return name.slice(0, 24);
}

function classifyTool(name, target, build) {
  if (name === 'AskUserQuestion') return { needsYou: true, detail: 'Has a question', discrete: 'needsYou' };
  if (name === 'ExitPlanMode') return { needsYou: true, detail: 'Plan ready for review', discrete: 'needsYou' };
  const r = { needsYou: false };
  if (READ.has(name)) return { ...r, activity: 'reading', detail: target ? `Reading ${target}` : 'Reading' };
  if (SEARCH.has(name)) return { ...r, activity: 'reading', detail: 'Searching' };
  if (WEB.has(name)) return { ...r, activity: 'reading', detail: 'Browsing' };
  if (EDIT.has(name)) return { ...r, activity: 'working', detail: target ? `Editing ${target}` : 'Editing' };
  if (name === 'Write') return { ...r, activity: 'working', detail: target ? `Writing ${target}` : 'Writing' };
  if (name === 'Bash') return { ...r, activity: build ? 'compiling' : 'working', detail: target ? `Running ${target}` : 'Running a command' };
  if (name === 'Task' || name === 'Agent') return { ...r, activity: 'working', detail: 'Delegating' };
  return { ...r, activity: 'working', detail: toolLabel(name) || 'Working' };
}

// Returns the changes one sanitised hook event makes to its session (spec §3 table), or null.
export function classify(evt) {
  switch (evt.hook_event_name) {
    case 'SessionStart': return { activity: 'idle', detail: '', needsYou: false, discrete: 'sessionStart' };
    case 'SessionEnd': return { remove: true };
    case 'UserPromptSubmit': return { activity: 'thinking', detail: 'Thinking…', needsYou: false, discrete: 'prompt' };
    case 'PostToolUse': return { activity: 'thinking', detail: 'Thinking…', needsYou: false };
    case 'Notification': {
      const t = evt.notification_type;
      const detail = t === 'permission_prompt' ? 'Needs permission' : t === 'idle_prompt' ? 'Waiting for you' : 'Needs you';
      return { needsYou: true, detail, discrete: 'needsYou' };
    }
    case 'Stop': return { activity: 'done', detail: 'Your turn', needsYou: false, discrete: 'stop' };
    case 'StopFailure':
      return evt.error === 'rate_limit'
        ? { activity: 'rateLimited', detail: 'Rate limited', needsYou: false, discrete: 'rateLimited' }
        : { activity: 'error', detail: 'Error', needsYou: false, discrete: 'error' };
    case 'PreToolUse': return classifyTool(evt.tool_name || '', evt.target || '', evt.build === true);
    default: return null;
  }
}

export class SessionStore {
  constructor({ contextWindow = {} } = {}) {
    this.sessions = new Map();
    this.contextWindow = contextWindow;
  }

  apply(evt, now, tail = null) {
    const id = evt.session_id;
    if (!id) return null;
    const c = classify(evt);
    if (!c) return null;
    if (c.remove) {
      this.sessions.delete(id);
      return { discrete: null };
    }
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, name: '', model: null, modelLabel: null, effort: null, contextPct: null,
            activity: 'idle', detail: '', needsYou: false, startedAt: now, lastEventAt: now };
      this.sessions.set(id, s);
    }
    if (evt.cwd) s.name = path.posix.basename(evt.cwd.replace(/\\/g, '/').replace(/\/+$/, '')) || s.name;
    const model = evt.model || (tail && tail.model);
    if (model && model !== '<synthetic>') {
      s.model = model;
      s.modelLabel = modelLabel(model);
    }
    const effort = evt.effort || evt.envEffort || (tail && tail.effort);
    if (effort) s.effort = effort;
    if (tail && Number.isFinite(tail.contextTokens)) s.contextPct = contextPct(tail.contextTokens, s.model, this.contextWindow);
    if (c.activity) s.activity = c.activity;
    if ('detail' in c) s.detail = c.detail;
    if (c.needsYou !== undefined) s.needsYou = c.needsYou;
    s.lastEventAt = now;
    return { discrete: c.discrete || null };
  }

  expire(now) {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (now - s.lastEventAt > EXPIRE_MS) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(s => ({ id: s.id, name: s.name, modelLabel: s.modelLabel, effort: s.effort, contextPct: s.contextPct,
                   activity: s.activity, detail: s.detail, needsYou: s.needsYou, lastEventAt: s.lastEventAt }));
  }

  // Spec §3 focus rule: newest needsYou, else newest active, else newest overall.
  focusId() {
    const all = [...this.sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt);
    const pick = all.find(s => s.needsYou) || all.find(s => ACTIVE.has(s.activity)) || all[0];
    return pick ? pick.id : null;
  }
}
