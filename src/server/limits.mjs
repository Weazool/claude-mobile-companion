import { spawn as nodeSpawn } from 'node:child_process';

// On Windows the child is cmd.exe (shell: true); taskkill /T also ends the claude process under it.
export function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    try {
      nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } catch { /* ignore */ }
    return;
  }
  try { child.kill(); } catch { /* already gone */ }
}

// Confirmed in the planning spike (Task 0). --safe-mode keeps our own plugin's hooks out of this child.
export const CLAUDE_ARGS = ['-p', '--safe-mode', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
export const POLL_MS = 5 * 60e3;
export const MIN_GAP_MS = 2 * 60e3;
export const AFTER_STOP_MS = 60e3;
export const BACKOFF_MS = [10 * 60e3, 20 * 60e3, 30 * 60e3];
export const STALE_MS = 15 * 60e3;
const EMPTY = Object.freeze({ status: 'unavailable', asOf: null, fiveHour: null, week: null, fable: null });

export function normPct(u) {
  if (!Number.isFinite(u)) return null;
  const v = u > 0 && u < 1 && !Number.isInteger(u) ? u * 100 : u;
  return Math.max(0, Math.round(v));
}

function windowOf(w) {
  if (!w || typeof w !== 'object') return null;
  const pct = normPct(w.utilization);
  if (pct === null) return null;
  const t = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
  return { pct, resetsAt: Number.isFinite(t) ? t : null };
}

// resp is SDKControlGetUsageResponse (Agent SDK 0.3.270).
export function parseUsage(resp, now) {
  if (!resp || typeof resp !== 'object') return { ...EMPTY };
  const rl = resp.rate_limits;
  if (!resp.rate_limits_available || !rl) return { ...EMPTY, status: resp.subscription_type ? 'unavailable' : 'signin' };
  const fable = Array.isArray(rl.model_scoped) ? rl.model_scoped.find(r => r && /fable/i.test(r.display_name || '')) : null;
  return { status: 'ok', asOf: now, fiveHour: windowOf(rl.five_hour), week: windowOf(rl.seven_day), fable: windowOf(fable) };
}

export function fetchUsage({ spawnImpl = nodeSpawn, command = 'claude', timeoutMs = 20000, now = Date.now, killAfterMs = 2000, kill = killTree } = {}) {
  return new Promise(resolve => {
    const fail = reason => ({ ...EMPTY, reason });
    const opts = { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, DESK_COMPANION_INTERNAL: '1' } };
    let child;
    try {
      child = process.platform === 'win32'
        ? spawnImpl(`${command} ${CLAUDE_ARGS.join(' ')}`, { ...opts, shell: true }) // resolves claude.cmd
        : spawnImpl(command, CLAUDE_ARGS, opts);
    } catch {
      resolve(fail('spawn'));
      return;
    }
    let buf = '';
    let settled = false;
    let exited = false;
    const send = o => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch { /* closed */ } };
    const finish = r => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* closed */ } // EOF makes claude exit by itself
      const k = setTimeout(() => { if (!exited) kill(child); }, killAfterMs);
      if (k.unref) k.unref();
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail('timeout')), timeoutMs);
    child.on('error', () => finish(fail('spawn')));
    child.on('exit', () => { exited = true; finish(fail('exit')); });
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (!m || m.type !== 'control_response' || !m.response) continue;
        const r = m.response;
        if (r.request_id === 'dc-init') {
          if (r.subtype !== 'success') { finish(fail('init')); return; }
          send({ type: 'control_request', request_id: 'dc-usage', request: { subtype: 'get_usage', skip_behaviors: true } });
        } else if (r.request_id === 'dc-usage') {
          finish(r.subtype === 'success' ? parseUsage(r.response, now()) : fail('usage'));
          return;
        }
      }
    });
    send({ type: 'control_request', request_id: 'dc-init', request: { subtype: 'initialize' } });
  });
}

export function createLimitsPoller({ fetch = fetchUsage, onUpdate, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  let current = { ...EMPTY };
  let failures = 0;
  let lastCallAt = -Infinity;
  let dueAt = Infinity;
  let timer = null;
  let running = false;

  const at = when => {
    if (timer) clearTimer(timer);
    dueAt = when;
    timer = setTimer(run, Math.max(0, when - now()));
  };

  const view = () => (current.status === 'ok' && now() - current.asOf > STALE_MS ? { ...current, status: 'stale' } : current);

  async function run() {
    timer = null;
    dueAt = Infinity;
    if (running) return;
    running = true;
    lastCallAt = now();
    let r;
    try { r = await fetch({ now }); } catch (e) { r = { ...EMPTY, reason: e.message }; }
    running = false;
    if (r.status === 'ok') {
      failures = 0;
      current = r;
    } else if (r.status === 'signin') {
      failures = 0;                      // keep polling every 5 min so limits appear soon after login
      current = { ...EMPTY, status: 'signin' };
    } else {
      failures += 1;
      if (current.status !== 'ok') current = { ...EMPTY }; // keep last good values; they go stale
      log(`limits unavailable${r.reason ? ` (${r.reason})` : ''}`);
    }
    try {
      onUpdate(view());
    } catch (e) {
      log(`limits update failed: ${e && e.message}`);
    } finally {
      at(now() + (failures ? BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] : POLL_MS));
    }
  }

  return {
    start() { at(now()); },
    onStop() {
      if (failures) return;
      const when = Math.max(now() + AFTER_STOP_MS, lastCallAt + MIN_GAP_MS);
      if (when < dueAt) at(when);
    },
    view,
    stop() { if (timer) clearTimer(timer); timer = null; },
  };
}
