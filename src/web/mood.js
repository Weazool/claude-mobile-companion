import { formatReset } from './format.js';

// The companion's state machine (spec §7), adapted from clawdio's state_machine.cpp (cegware/clawdio, MIT).
export const DEFAULT_MOOD = { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null };

const ACTIVE = new Set(['thinking', 'reading', 'working', 'compiling']);
const IDLEISH = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding', 'weekOver', 'done', 'cool', 'celebrate', 'sleep', 'yawn', 'wake', 'error']);
const QUIET = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding']);
const DWELL_MS = 1500;
const pctOf = w => (w && Number.isFinite(w.pct) ? w.pct : null);
const dayOf = t => new Date(t).toDateString();

export function createMood(settings = {}, { rand = Math.random } = {}) {
  let S = { ...DEFAULT_MOOD, ...settings };
  let snap = null;
  let lastKey = null;
  let offline = false;
  const st = {
    mode: null, since: 0, escalated: false, lastActiveAt: null, asleep: false,
    transient: null, plays: [], errors: 0, loveDay: null, pendingCelebrate: false,
  };

  const init = now => { if (st.lastActiveAt === null) { st.lastActiveAt = now; st.since = now; } };
  const touch = now => { st.lastActiveAt = now; };
  const live = now => (st.transient && st.transient.until > now ? st.transient : null);

  function focus() {
    if (!snap) return null;
    const id = S.pinnedId && snap.sessions.some(s => s.id === S.pinnedId) ? S.pinnedId : snap.focusId;
    return snap.sessions.find(s => s.id === id) || null;
  }
  const busy = f => !!f && (ACTIVE.has(f.activity) || f.needsYou);

  function target(now) {
    if (offline) return { mode: 'offline', base: 'sleeping', bubble: null, dim: false };
    const f = focus();
    const L = (snap && snap.limits) || {};
    const p5 = pctOf(L.fiveHour);
    const pw = pctOf(L.week);
    const pf = pctOf(L.fable);
    if ((p5 !== null && p5 >= 100) || (f && f.activity === 'rateLimited')) {
      const text = p5 !== null && p5 >= 100 ? `Limit reached · resets in ${formatReset(L.fiveHour.resetsAt, now) || 'soon'}` : 'Rate limited';
      return { mode: 'overloaded', base: 'overloaded', bubble: { text, tone: 'bad' } };
    }
    if (f && f.needsYou) return { mode: 'needs', base: ['surprised', 'curious'], bubble: { text: f.detail || 'Needs you', tone: 'need' } };
    const tr = live(now);
    if (tr && tr.kind === 'done') return { mode: 'done', base: 'happy_eyes', bubble: { text: 'Your turn', tone: 'good' } };
    if (tr && (tr.kind === 'error' || tr.kind === 'angry')) return { mode: 'error', base: tr.kind, bubble: { text: 'Error', tone: 'bad' } };
    if (f && ACTIVE.has(f.activity)) return { mode: f.activity, base: f.activity, bubble: f.detail ? { text: f.detail, tone: '' } : null };
    if (tr && tr.kind === 'wake') return { mode: 'wake', base: 'idle', bubble: { text: tr.greet, tone: 'good' } };
    if (tr && tr.kind === 'celebrate') {
      return now - tr.since < 5640
        ? { mode: 'celebrate', base: 'happy', bubble: { text: 'Fresh limits!', tone: 'good' } }
        : { mode: 'cool', base: 'cool', bubble: null };
    }
    if (tr && tr.kind === 'cool') return { mode: 'cool', base: 'cool', bubble: null };
    if (tr && tr.kind === 'yawn') return { mode: 'yawn', base: 'yawning', bubble: null };
    if (st.asleep) return { mode: 'sleep', base: 'sleeping', bubble: { text: 'Zzz…', tone: '' }, dim: true };
    const wOver = pw !== null && pw >= 100;
    const fOver = pf !== null && pf >= 100;
    if (wOver || fOver) return { mode: 'weekOver', base: 'overloaded', bubble: { text: `${wOver ? 'Week' : 'Fable'} limit reached`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.crit) return { mode: 'ending', base: 'ending', bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    const wEnd = pw !== null && pw >= 95;
    const fEnd = pf !== null && pf >= 95;
    if (wEnd || fEnd) return { mode: 'weekEnding', base: 'ending', bubble: { text: wEnd ? `Week at ${pw}%` : `Fable at ${pf}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.low) return { mode: 'sad', base: 'sad', bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.warn) return { mode: 'low', base: 'low_tokens', bubble: { text: `5-hour at ${p5}%`, tone: '' } };
    return { mode: 'idle', base: 'idle', bubble: null };
  }

  function entryPlays(prev, next) {
    if (prev !== null && (next === 'thinking' || next === 'working') && IDLEISH.has(prev)) return ['surprised'];
    if (next === 'low' && prev === 'idle') return ['surprised'];
    return [];
  }

  function out(now) {
    let t = target(now);
    if (ACTIVE.has(t.mode) && ACTIVE.has(st.mode) && t.mode !== st.mode && now - st.since < DWELL_MS) {
      t = { ...t, mode: st.mode, base: st.mode }; // hold the animation, still update the bubble
    }
    const play = st.plays;
    st.plays = [];
    if (t.mode !== st.mode) {
      if (!play.length) play.push(...entryPlays(st.mode, t.mode));
      st.mode = t.mode;
      st.since = now;
      st.escalated = false;
    }
    const dim = !!t.dim;
    const key = JSON.stringify([t.base, t.bubble, dim]);
    if (key === lastKey && !play.length) return null;
    lastKey = key;
    return { base: t.base, play, bubble: t.bubble, dim };
  }

  function wake(now) {
    if (!st.asleep && !(st.transient && st.transient.kind === 'yawn')) return false;
    const newDay = st.loveDay !== dayOf(now);
    st.asleep = false;
    st.loveDay = dayOf(now);
    st.transient = { kind: 'wake', since: now, until: now + 2900, greet: newDay ? 'Good morning!' : 'Hi!' };
    st.plays = ['yawning', 'surprised', 'love'];
    return true;
  }

  function maybeCelebrate(now) {
    if (!st.pendingCelebrate || busy(focus())) return;
    st.pendingCelebrate = false;
    st.asleep = false;
    st.transient = { kind: 'celebrate', since: now, until: now + 13640 };
    st.plays = ['jumping_joy'];
  }

  return {
    onSnapshot(s, now) {
      init(now);
      const prev = snap && snap.limits;
      snap = s;
      if (busy(focus())) { touch(now); wake(now); }
      if (prev && s.limits) {
        for (const k of ['fiveHour', 'week', 'fable']) {
          const a = pctOf(prev[k]);
          const b = pctOf(s.limits[k]);
          if (a !== null && b !== null && a >= 20 && b < 10) st.pendingCelebrate = true;
        }
      }
      maybeCelebrate(now);
      return out(now);
    },

    onEvent(ev, now) {
      init(now);
      const f = focus();
      switch (ev.type) {
        case 'prompt':
          touch(now);
          st.errors = 0;
          if (st.transient && ['done', 'error', 'angry'].includes(st.transient.kind)) st.transient = null;
          if (!wake(now) && st.loveDay !== dayOf(now)) { st.loveDay = dayOf(now); st.plays = ['love', 'surprised']; }
          break;
        case 'stop':
          touch(now);
          st.errors = 0;
          if (!f || f.id === ev.sessionId || !busy(f)) { st.transient = { kind: 'done', since: now, until: now + 3000 }; st.plays = ['surprised']; }
          break;
        case 'error':
          touch(now);
          st.errors += 1;
          st.transient = { kind: st.errors >= 3 ? 'angry' : 'error', since: now, until: now + 5000 };
          break;
        case 'sessionStart':
          touch(now);
          if (!wake(now) && !busy(f)) st.plays = ['curious'];
          break;
        case 'needsYou':
        case 'rateLimited':
          touch(now);
          wake(now);
          break;
        default:
          break;
      }
      return out(now);
    },

    onTap(now) {
      init(now);
      touch(now);
      if (!wake(now)) st.plays = [['love', 'surprised', 'curious'][Math.floor(rand() * 3) % 3]];
      return out(now);
    },

    tick(now) {
      init(now);
      if (st.transient && st.transient.until <= now) {
        const kind = st.transient.kind;
        st.transient = null;
        if (kind === 'yawn') st.asleep = true;
      }
      maybeCelebrate(now);
      if (!st.escalated && now - st.since >= 8000 && (st.mode === 'thinking' || st.mode === 'compiling')) {
        st.escalated = true;
        st.plays = [st.mode === 'thinking' ? 'curious' : 'look_left'];
      }
      if (st.mode === 'idle' && !st.transient) {
        const p5 = pctOf(snap && snap.limits && snap.limits.fiveHour);
        if (p5 !== null && p5 <= 5 && rand() < 1 / 1200) st.transient = { kind: 'cool', since: now, until: now + 8000 };
      }
      if (QUIET.has(st.mode) && !st.asleep && !st.transient && now - st.lastActiveAt >= S.sleepAfterMin * 60000) {
        st.transient = { kind: 'yawn', since: now, until: now + 2500 };
      }
      return out(now);
    },

    setSettings(partial) { S = { ...S, ...partial }; },

    setOffline(value, now) {
      init(now);
      offline = !!value;
      return out(now);
    },
  };
}
