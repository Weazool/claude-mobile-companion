import fs from 'node:fs';

export const TAIL_BYTES = 65536;

const empty = () => ({ model: null, effort: null, contextTokens: null });

// Scans lines newest-first. Content is never returned; only model id, effort and a token count.
export function parseTail(text, dropFirstLine = false) {
  let lines = text.split('\n');
  if (dropFirstLine) lines = lines.slice(1);
  let model = null;
  let effort = null;
  let contextTokens = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || o.isSidechain === true) continue;
    if (effort === null && typeof o.effort === 'string') effort = o.effort;
    const msg = o.type === 'assistant' ? o.message : null;
    if (msg && msg.model && msg.model !== '<synthetic>') {
      if (model === null) model = msg.model;
      const u = msg.usage;
      if (contextTokens === null && u) {
        contextTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    }
    if (model !== null && effort !== null && contextTokens !== null) break;
  }
  return { model, effort, contextTokens };
}

// Reads only the last `bytes` of the file; a line cut in half at the start is dropped.
export function readTail(file, bytes = TAIL_BYTES) {
  if (!file) return empty();
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return empty(); }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return parseTail(buf.toString('utf8'), start > 0);
  } catch {
    return empty();
  } finally {
    fs.closeSync(fd);
  }
}

// Measured on this machine: Opus 5, Fable 5.1, Sonnet 5 and Opus 4.x sessions all reach ~1M tokens.
export function contextWindow(modelId, overrides = {}) {
  const o = modelId ? overrides[modelId] : undefined;
  if (Number.isFinite(o) && o > 0) return o;
  if (modelId && /haiku/i.test(modelId)) return 200_000;
  return 1_000_000;
}

export function contextPct(tokens, modelId, overrides) {
  if (!Number.isFinite(tokens)) return null;
  return Math.max(0, Math.min(100, Math.round((100 * tokens) / contextWindow(modelId, overrides))));
}
